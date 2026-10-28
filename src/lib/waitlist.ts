import { CONFIG } from "./config";
import { addDays, todayIn } from "./dates";
import { getSlotRows, type SlotRow } from "./availability";
import { BookingError, type BookingSummary } from "./bookings";
import { query } from "./db";
import { notifyOwnerWaitlistOffered, notifyWaitlistSlot } from "./notify";
import { phoneDigits } from "./site";
import { loadVisit, type Visit } from "./visit";

export type Part = "ANY" | "MORNING" | "AFTERNOON";

const isUnique = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";

/** Apunta a una persona a la lista de espera de un servicio (un día concreto o cualquiera de los próximos 14). */
export async function joinWaitlist(input: {
  serviceIds: number[];
  day: string | null;
  part: Part;
  name: string;
  phone: string;
  email?: string | null;
  source: "web" | "app";
  ipHash: string;
}): Promise<{ already: boolean; serviceName: string }> {
  const visit = await loadVisit(input.serviceIds); // valida que existan, estén activos y sean 1 a 4

  const today = todayIn(CONFIG.tz);
  if (input.day && (input.day < today || input.day > addDays(today, CONFIG.maxDaysAhead))) {
    throw new BookingError("INVALID", "Esa fecha no es válida.", 400);
  }
  const cnt = await query<{ n: number }>(`SELECT count(*)::int AS n FROM waitlist WHERE status = 'ACTIVE' AND ip_hash = $1`, [input.ipHash]);
  if (cnt[0].n >= 8) throw new BookingError("INVALID", "Ya tienes varios avisos activos. Llámanos y lo vemos juntas.", 429);

  try {
    await query(
      `INSERT INTO waitlist (service_id, service_ids, day, part, name, phone, phone_key, email, source, ip_hash)
       VALUES ($1::int, $10::int[], $2::date, $3, $4, $5, $6, $7, $8, $9)`,
      [visit.items[0].id, input.day, input.part, input.name, input.phone, phoneDigits(input.phone).slice(-9), input.email || null, input.source, input.ipHash, visit.items.length > 1 ? visit.items.map((i) => i.id) : null],
    );
    return { already: false, serviceName: visit.name };
  } catch (e) {
    if (isUnique(e)) return { already: true, serviceName: visit.name }; // ya estaba apuntada
    throw e;
  }
}

const hourOf = (r: SlotRow) => Number(r.time.slice(0, 2));
const partOk = (part: string, r: SlotRow) => part === "ANY" || (part === "MORNING" ? hourOf(r) < 15 : hourOf(r) >= 15);

/**
 * Se llama cuando se cancela una cita. Busca a quienes esperaban ese servicio/día, comprueba con el
 * motor de disponibilidad que de verdad hay un hueco que encaja, y avisa a los primeros (por orden de
 * llegada). Quien reserve antes se lo queda: el bloqueo de huecos evita dobles reservas.
 */
export async function offerFreedSlot(b: BookingSummary, maxPeople = 3): Promise<number> {
  const freedStart = new Date(b.startsAt).getTime();
  if (freedStart < Date.now() + 30 * 60_000) return 0; // demasiado tarde para que alguien llegue
  const notified = await offerWindow(b.startsAt, b.endsAt, maxPeople);
  if (notified > 0) await notifyOwnerWaitlistOffered(b, notified);
  return notified;
}

/**
 * Avisa a quienes esperan, por orden de llegada, de que hay hueco dentro de la ventana [startsAt, endsAt):
 * comprueba con el motor de disponibilidad que de verdad les cabe su servicio. Devuelve a cuántas avisó.
 */
export async function offerWindow(startsAtIso: string, endsAtIso: string, maxPeople: number): Promise<number> {
  const freedStart = new Date(startsAtIso).getTime();
  const freedEnd = new Date(endsAtIso).getTime();
  const today = todayIn(CONFIG.tz);
  const freedDay = todayIn(CONFIG.tz, new Date(startsAtIso));

  const entries = await query<{
    id: string;
    name: string;
    phone: string;
    email: string | null;
    part: string;
    service_id: number;
    service_ids: number[] | null;
  }>(
    `SELECT w.id, w.name, w.phone, w.email, w.part, w.service_id, w.service_ids
     FROM waitlist w
     WHERE w.status = 'ACTIVE' AND (w.day = $1::date OR (w.day IS NULL AND $1::date <= $2::date + 14))
     ORDER BY w.created_at LIMIT 40`,
    [freedDay, today],
  );

  const cache = new Map<string, SlotRow[]>();
  const visits = new Map<string, Visit | null>();
  let notified = 0;
  for (const w of entries) {
    if (notified >= maxPeople) break;
    const ids = w.service_ids && w.service_ids.length ? w.service_ids : [w.service_id];
    const vkey = ids.join(",");
    if (!visits.has(vkey)) visits.set(vkey, await loadVisit(ids).catch(() => null)); // un servicio dado de baja: se salta
    const visit = visits.get(vkey);
    if (!visit) continue;

    const key = `${visit.durationMin}:${visit.stepMin}:${visit.bufferMin}`;
    let rows = cache.get(key);
    if (!rows) {
      rows = await getSlotRows({ from: freedDay, to: freedDay, durationMin: visit.durationMin, bufferMin: visit.bufferMin, stepMin: visit.stepMin, serviceIds: visit.items.map((i) => i.id), pattern: visit.pattern });
      cache.set(key, rows);
    }
    const dur = (visit.durationMin + visit.bufferMin) * 60_000;
    const fit = rows.find((r) => {
      const t = new Date(r.startsAt).getTime();
      return r.available && partOk(w.part, r) && t > Date.now() + 30 * 60_000 && t < freedEnd && t + dur > freedStart;
    });
    if (!fit) continue;
    const ok = await notifyWaitlistSlot({ id: w.id, name: w.name, phone: w.phone, email: w.email, serviceName: visit.name }, fit.startsAt);
    if (ok) {
      await query(`UPDATE waitlist SET status = 'NOTIFIED', notified_at = now(), notified_slot = $2::timestamptz WHERE id = $1::uuid`, [w.id, fit.startsAt]);
      notified++;
    }
  }
  return notified;
}

/** «Ofrecer a la lista» desde el panel: avisa a quienes esperan de que hay huecos libres ese día. */
export async function offerDay(day: string, maxPeople = 10): Promise<number> {
  const base = new Date(`${day}T12:00:00Z`).getTime();
  return offerWindow(new Date(base - 36 * 3600_000).toISOString(), new Date(base + 36 * 3600_000).toISOString(), maxPeople);
}

/** Cuando alguien reserva, deja de esperar ese día. */
export async function markWaitlistBooked(phone: string | null, startsAtIso: string): Promise<void> {
  if (!phone) return;
  await query(
    `UPDATE waitlist SET status = 'BOOKED'
     WHERE status IN ('ACTIVE','NOTIFIED') AND phone_key = $1 AND (day IS NULL OR day = $2::date)`,
    [phoneDigits(phone).slice(-9), todayIn(CONFIG.tz, new Date(startsAtIso))],
  );
}

/** Limpieza diaria: días pasados y avisos "cualquier día" con más de 14 días. */
export async function expireWaitlist(): Promise<void> {
  await query(
    `UPDATE waitlist SET status = 'CANCELLED'
     WHERE status IN ('ACTIVE','NOTIFIED')
       AND ((day IS NOT NULL AND day < $1::date) OR (day IS NULL AND created_at < now() - interval '14 days'))`,
    [todayIn(CONFIG.tz)],
  );
}
