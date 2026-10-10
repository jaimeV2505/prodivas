import { createHash, randomBytes, randomInt } from "node:crypto";
import { CONFIG } from "./config";
import { query, tx, type Runner } from "./db";
import { getSlotRows } from "./availability";
import { addDays, todayIn } from "./dates";
import { samePhone } from "./site";

export type ErrCode = "SLOT_TAKEN" | "HOLD_EXPIRED" | "NOT_FOUND" | "TOO_LATE" | "INVALID";

export class BookingError extends Error {
  code: ErrCode;
  status: number;
  constructor(code: ErrCode, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const isExclusionViolation = (e: unknown) =>
  typeof e === "object" && e !== null && (e as { code?: string }).code === "23P01";

/**
 * Cuándo enviar el recordatorio: N horas antes (4 por defecto), nunca de madrugada.
 * - Si la cita se reservó con menos de N+1 horas de antelación: sin recordatorio (ya basta con la confirmación).
 * - Si N horas antes cae antes de las 08:30, se avisa la tarde anterior a las 19:00.
 */
export const REMINDER_HOURS = Number(process.env.REMINDER_HOURS_BEFORE ?? 4);
function remindAtSql(starts: string, tz: string, hours: string): string {
  const eve = `((date_trunc('day', ${starts} AT TIME ZONE ${tz}) - interval '1 day' + interval '19 hours') AT TIME ZONE ${tz})`;
  return `CASE
    WHEN now() > ${starts} - make_interval(hours => ${hours} + 1) THEN NULL
    WHEN ((${starts} - make_interval(hours => ${hours})) AT TIME ZONE ${tz})::time < time '08:30' THEN
      CASE WHEN ${eve} > now() + interval '1 hour' THEN ${eve} ELSE NULL END
    ELSE ${starts} - make_interval(hours => ${hours})
  END`;
}

/** Los enlaces de los mensajes llevan solo los 12 primeros caracteres del token. */
const tokenOk = (t: string) => t.length >= 12;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}
const newToken = () => randomBytes(24).toString("hex");

export function hashIp(ip: string): string {
  return createHash("sha256")
    .update(ip + (process.env.SESSION_SECRET ?? "dev"))
    .digest("hex")
    .slice(0, 32);
}

export type BookingSummary = {
  id: string;
  code: string;
  token: string;
  status: string;
  startsAt: string;
  endsAt: string;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  notes: string | null;
  serviceName: string;
  priceCents: number;
  staffName: string;
  canCancel: boolean;
  customerResponse: string | null;
};

type SummaryRow = {
  id: string;
  code: string;
  hold_token: string;
  status: string;
  starts_at: Date;
  ends_at: Date;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  notes: string | null;
  service_name: string;
  price_cents: number;
  staff_name: string;
  can_cancel: boolean;
  customer_response: string | null;
};

const SUMMARY_SELECT = `
  SELECT b.id, b.code, b.hold_token, b.status, b.starts_at, b.ends_at,
         b.customer_name, b.customer_phone, b.customer_email, b.notes,
         b.customer_response, s.name AS service_name, s.price_cents, st.name AS staff_name,
         (b.starts_at - now()) >= make_interval(hours => ${CONFIG.cancelNoticeHours}) AS can_cancel
  FROM bookings b
  JOIN services s ON s.id = b.service_id
  JOIN staff st ON st.id = b.staff_id
`;

function mapSummary(r: SummaryRow): BookingSummary {
  return {
    id: r.id,
    code: r.code,
    token: r.hold_token,
    status: r.status,
    startsAt: new Date(r.starts_at).toISOString(),
    endsAt: new Date(r.ends_at).toISOString(),
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    customerEmail: r.customer_email,
    notes: r.notes,
    serviceName: r.service_name,
    priceCents: r.price_cents,
    staffName: r.staff_name,
    canCancel: r.can_cancel,
    customerResponse: r.customer_response,
  };
}

async function loadSummary(q: Runner, id: string): Promise<BookingSummary> {
  const rows = (await q(`${SUMMARY_SELECT} WHERE b.id = $1::uuid`, [id])) as unknown as SummaryRow[];
  if (!rows[0]) throw new BookingError("NOT_FOUND", "No encontramos esa reserva.", 404);
  return mapSummary(rows[0]);
}

export async function getSummaryById(id: string): Promise<BookingSummary | null> {
  const rows = await query<SummaryRow>(`${SUMMARY_SELECT} WHERE b.id = $1::uuid`, [id]);
  return rows[0] ? mapSummary(rows[0]) : null;
}

export async function getBookingByCode(code: string, token: string): Promise<BookingSummary | null> {
  if (!tokenOk(token)) return null;
  const rows = await query<SummaryRow>(`${SUMMARY_SELECT} WHERE b.code = $1 AND starts_with(b.hold_token, $2)`, [
    code,
    token,
  ]);
  return rows[0] ? mapSummary(rows[0]) : null;
}

/* ------------------------------------------------------------------ */
/* 1) BLOQUEAR HUECO (HOLD)                                            */
/* ------------------------------------------------------------------ */

export type HoldResult = {
  holdId: string;
  holdToken: string;
  expiresInSec: number;
  staffId: number;
  staffName: string;
};

export async function createHold(input: {
  serviceId: number;
  staffId: number | null;
  startsAt: string;
  ipHash: string;
}): Promise<HoldResult> {
  return tx(async (q) => {
    // Limpieza perezosa de bloqueos caducados
    await q(`UPDATE bookings SET status = 'EXPIRED' WHERE status = 'HOLD' AND hold_expires_at <= now()`);

    const svc = (await q(`SELECT id, duration_min FROM services WHERE id = $1::int AND active`, [
      input.serviceId,
    ])) as unknown as { id: number; duration_min: number }[];
    if (!svc[0]) throw new BookingError("NOT_FOUND", "Ese servicio ya no está disponible.", 404);

    // Anti-abuso: como mucho N bloqueos vivos por IP; el más antiguo se libera
    const cnt = (await q(
      `SELECT count(*)::int AS n FROM bookings WHERE status = 'HOLD' AND ip_hash = $1`,
      [input.ipHash],
    )) as unknown as { n: number }[];
    const excess = cnt[0].n - CONFIG.maxHoldsPerIp + 1;
    if (excess > 0) {
      await q(
        `UPDATE bookings SET status = 'EXPIRED'
         WHERE id IN (
           SELECT id FROM bookings WHERE status = 'HOLD' AND ip_hash = $1
           ORDER BY created_at ASC LIMIT $2::int
         )`,
        [input.ipHash, excess],
      );
    }

    // ¿Es un hueco válido de la parrilla (horario, pausa, bloqueos, preaviso)?
    const dayRow = (await q(
      `SELECT to_char($1::timestamptz AT TIME ZONE $2::text, 'YYYY-MM-DD') AS d`,
      [input.startsAt, CONFIG.tz],
    )) as unknown as { d: string }[];
    const day = dayRow[0].d;
    const today = todayIn(CONFIG.tz);
    if (day < today || day > addDays(today, CONFIG.maxDaysAhead)) {
      throw new BookingError("INVALID", "Esa fecha no se puede reservar.", 400);
    }

    const rows = await getSlotRows(
      { from: day, to: day, durationMin: svc[0].duration_min, staffId: input.staffId },
      q,
    );
    const target = new Date(input.startsAt).getTime();
    const free = rows.filter((r) => r.available && new Date(r.startsAt).getTime() === target);
    if (!free.length) {
      throw new BookingError("SLOT_TAKEN", "Ese hueco acaba de ocuparse. Elige otro.", 409);
    }
    const staffId = free[0].staffId;

    const holdToken = newToken();
    try {
      const ins = (await q(
        `INSERT INTO bookings (staff_id, service_id, starts_at, ends_at, status, hold_expires_at, hold_token, ip_hash)
         VALUES ($1::int, $2::int, $3::timestamptz, $3::timestamptz + make_interval(mins => $4::int),
                 'HOLD', now() + make_interval(mins => $5::int), $6, $7)
         RETURNING id, EXTRACT(EPOCH FROM (hold_expires_at - now()))::int AS ttl`,
        [staffId, input.serviceId, input.startsAt, svc[0].duration_min, CONFIG.holdMinutes, holdToken, input.ipHash],
      )) as unknown as { id: string; ttl: number }[];

      const st = (await q(`SELECT name FROM staff WHERE id = $1::int`, [staffId])) as unknown as {
        name: string;
      }[];

      return {
        holdId: ins[0].id,
        holdToken,
        expiresInSec: ins[0].ttl,
        staffId,
        staffName: st[0]?.name ?? "",
      };
    } catch (e) {
      if (isExclusionViolation(e)) {
        throw new BookingError("SLOT_TAKEN", "Ese hueco acaba de ocuparse. Elige otro.", 409);
      }
      throw e;
    }
  });
}

export async function releaseHold(id: string, token: string): Promise<void> {
  await query(
    `UPDATE bookings SET status = 'EXPIRED' WHERE id = $1::uuid AND hold_token = $2 AND status = 'HOLD'`,
    [id, token],
  );
}

/* ------------------------------------------------------------------ */
/* 2) CONFIRMAR                                                        */
/* ------------------------------------------------------------------ */

export async function confirmBooking(input: {
  holdId: string;
  holdToken: string;
  name: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
}): Promise<BookingSummary> {
  return tx(async (q) => {
    const found = (await q(
      `SELECT status, (starts_at > now()) AS future
       FROM bookings WHERE id = $1::uuid AND hold_token = $2 FOR UPDATE`,
      [input.holdId, input.holdToken],
    )) as unknown as { status: string; future: boolean }[];
    const row = found[0];
    if (!row) throw new BookingError("NOT_FOUND", "No encontramos tu reserva. Vuelve a elegir hueco.", 404);
    if (row.status === "CANCELLED") throw new BookingError("HOLD_EXPIRED", "Esta reserva fue cancelada.", 410);
    if (!row.future) throw new BookingError("HOLD_EXPIRED", "Ese horario ya ha pasado.", 410);

    if (row.status !== "CONFIRMED") {
      // Si el bloqueo caducó pero nadie más cogió el hueco, se recupera; si alguien
      // lo cogió, el candado de la BD lanza una violación de exclusión.
      try {
        await q(
          `UPDATE bookings
             SET status = 'CONFIRMED', code = COALESCE(code, $2), hold_expires_at = NULL,
                 customer_name = $3, customer_phone = $4, customer_email = $5, notes = $6,
                 confirmed_at = now(),
                 remind_at = ${remindAtSql("starts_at", "$7::text", "$8::int")}
           WHERE id = $1::uuid`,
          [input.holdId, newCode(), input.name, input.phone, input.email || null, input.notes || null, CONFIG.tz, REMINDER_HOURS],
        );
      } catch (e) {
        if (isExclusionViolation(e)) {
          throw new BookingError("SLOT_TAKEN", "Lo sentimos, ese hueco acaba de ocuparse.", 409);
        }
        throw e;
      }
    }
    return loadSummary(q, input.holdId);
  });
}

/* ------------------------------------------------------------------ */
/* 3) CANCELAR                                                         */
/* ------------------------------------------------------------------ */

export async function cancelByCustomer(code: string, token: string): Promise<BookingSummary> {
  return tx(async (q) => {
    const found = (await q(
      `SELECT id, status, (starts_at - now()) >= make_interval(hours => $3::int) AS ok
       FROM bookings WHERE code = $1 AND starts_with(hold_token, $2) FOR UPDATE`,
      [code, tokenOk(token) ? token : "~invalid~", CONFIG.cancelNoticeHours],
    )) as unknown as { id: string; status: string; ok: boolean }[];
    const row = found[0];
    if (!row) throw new BookingError("NOT_FOUND", "No encontramos esa cita.", 404);
    if (row.status === "CANCELLED") return loadSummary(q, row.id);
    if (!row.ok) {
      throw new BookingError(
        "TOO_LATE",
        `Con menos de ${CONFIG.cancelNoticeHours} horas de antelación no se puede cancelar online. Llámanos al ${CONFIG.salon.phoneMobile}.`,
        409,
      );
    }
    await q(`UPDATE bookings SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1::uuid`, [row.id]);
    return loadSummary(q, row.id);
  });
}

/* ------------------------------------------------------------------ */
/* Administración                                                      */
/* ------------------------------------------------------------------ */

export async function adminCancel(id: string): Promise<void> {
  await query(
    `UPDATE bookings SET status = 'CANCELLED', cancelled_at = now()
     WHERE id = $1::uuid AND status IN ('CONFIRMED','HOLD')`,
    [id],
  );
}

export async function createManualBooking(input: {
  serviceId: number;
  staffId: number;
  day: string;
  time: string;
  name: string;
  phone: string;
  notes?: string | null;
}): Promise<void> {
  try {
    const rows = await query<{ id: string }>(
      `INSERT INTO bookings (staff_id, service_id, starts_at, ends_at, status, hold_token, code,
                             customer_name, customer_phone, notes, source, confirmed_at, remind_at)
       SELECT $1::int, sv.id, t.s, t.s + make_interval(mins => sv.duration_min),
              'CONFIRMED', $3, $4, $5, $6, $7, 'admin', now(),
              ${remindAtSql("t.s", "$10::text", "$11::int")}
       FROM services sv
       CROSS JOIN LATERAL (SELECT (($8::date + $9::time) AT TIME ZONE $10::text) AS s) t
       WHERE sv.id = $2::int
       RETURNING id`,
      [
        input.staffId,
        input.serviceId,
        newToken(),
        newCode(),
        input.name,
        input.phone,
        input.notes || null,
        input.day,
        input.time,
        CONFIG.tz,
        REMINDER_HOURS,
      ],
    );
    if (!rows.length) throw new BookingError("NOT_FOUND", "Servicio no encontrado.", 404);
  } catch (e) {
    if (isExclusionViolation(e)) {
      throw new BookingError("SLOT_TAKEN", "Ya hay una cita en ese horario para esa profesional.", 409);
    }
    throw e;
  }
}

export async function addTimeOff(input: {
  staffId: number | null;
  day: string;
  from?: string | null;
  to?: string | null;
  reason?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO time_off (staff_id, starts_at, ends_at, reason)
     VALUES (
       $1::int,
       ($2::date + COALESCE($3::time, '00:00'::time)) AT TIME ZONE $5::text,
       CASE WHEN $4::time IS NULL
            THEN (($2::date + 1) + '00:00'::time) AT TIME ZONE $5::text
            ELSE ($2::date + $4::time) AT TIME ZONE $5::text END,
       $6
     )`,
    [input.staffId, input.day, input.from || null, input.to || null, CONFIG.tz, input.reason || null],
  );
}

export async function removeTimeOff(id: number): Promise<void> {
  await query(`DELETE FROM time_off WHERE id = $1::int`, [id]);
}


/* ------------------------------------------------------------------ */
/* Respuesta al recordatorio: "Confirmo" / "No puedo ir"               */
/* ------------------------------------------------------------------ */

export type ResponseState = "confirmed" | "cancelled" | "already_cancelled";

/**
 * La clienta responde desde un enlace (token) o desde WhatsApp (teléfono verificado por Meta).
 * Cancelar desde el recordatorio SIEMPRE se permite, aunque falten pocas horas: un hueco avisado
 * a tiempo se puede volver a ocupar; un "no show" no.
 */
export async function respondToBooking(input: {
  code: string;
  action: "confirm" | "cancel";
  token?: string;
  phone?: string;
}): Promise<{ state: ResponseState; changed: boolean; booking: BookingSummary }> {
  return tx(async (q) => {
    const found = (await q(
      `SELECT id, status, hold_token, customer_phone, customer_response, (starts_at > now()) AS future
       FROM bookings WHERE code = $1 FOR UPDATE`,
      [input.code],
    )) as unknown as {
      id: string;
      status: string;
      hold_token: string;
      customer_phone: string | null;
      customer_response: string | null;
      future: boolean;
    }[];
    const row = found[0];
    const authorised =
      !!row &&
      ((input.token && tokenOk(input.token) && row.hold_token.startsWith(input.token)) ||
        (!!input.phone && !!row.customer_phone && samePhone(input.phone, row.customer_phone)));
    if (!row || !authorised) throw new BookingError("NOT_FOUND", "No encontramos esa cita.", 404);

    if (row.status === "CANCELLED") {
      return { state: "already_cancelled" as const, changed: false, booking: await loadSummary(q, row.id) };
    }
    if (row.status !== "CONFIRMED" || !row.future) {
      throw new BookingError("HOLD_EXPIRED", "Esta cita ya ha pasado.", 410);
    }

    if (input.action === "confirm") {
      const changed = row.customer_response !== "CONFIRMED";
      if (changed) {
        await q(`UPDATE bookings SET customer_response = 'CONFIRMED', responded_at = now() WHERE id = $1::uuid`, [row.id]);
      }
      return { state: "confirmed" as const, changed, booking: await loadSummary(q, row.id) };
    }

    await q(
      `UPDATE bookings
         SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = 'customer_reminder',
             customer_response = 'CANCELLED', responded_at = now()
       WHERE id = $1::uuid`,
      [row.id],
    );
    return { state: "cancelled" as const, changed: true, booking: await loadSummary(q, row.id) };
  });
}
