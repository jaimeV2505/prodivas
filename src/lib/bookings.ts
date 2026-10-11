import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { getSlotRows } from "./availability";
import { CONFIG } from "./config";
import { addDays, todayIn } from "./dates";
import { query, tx, type Runner } from "./db";
import { BookingError, type ErrCode } from "./errors";
import { createCheckoutSession, settleDeposit, stripeEnabled } from "./payments";
import { effectiveDeposit, getDepositPolicy } from "./deposit";
import { phoneDigits, samePhone } from "./site";
import { loadVisit, type Visit } from "./visit";

export { BookingError };
export type { ErrCode };

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
/** Cambiar la hora online: hasta N horas antes (después, que llame). */
export const RESCHEDULE_HOURS = Number(process.env.RESCHEDULE_NOTICE_HOURS ?? 12);

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

/* ------------------------------------------------------------------ */
/* Resumen de una cita                                                 */
/* ------------------------------------------------------------------ */

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
  serviceIds: number[];
  priceCents: number;
  durationMin: number;
  depositCents: number;
  depositStatus: string;
  attendance: string | null;
  staffId: number;
  staffName: string;
  customerId: number | null;
  canCancel: boolean;
  customerResponse: string | null;
  cancelReason: string | null;
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
  service_ids: number[];
  price_cents: number;
  deposit_cents: number;
  deposit_status: string;
  attendance: string | null;
  staff_id: number;
  staff_name: string;
  customer_id: number | null;
  can_cancel: boolean;
  customer_response: string | null;
  cancel_reason: string | null;
};

const SUMMARY_SELECT = `
  SELECT b.id, b.code, b.hold_token, b.status, b.starts_at, b.ends_at, b.staff_id, b.customer_id,
         b.customer_name, b.customer_phone, b.customer_email, b.notes, b.customer_response, b.cancel_reason,
         b.deposit_cents, b.deposit_status, b.attendance,
         COALESCE((SELECT string_agg(bs.name, ' + ' ORDER BY bs.position) FROM booking_services bs WHERE bs.booking_id = b.id), s.name) AS service_name,
         COALESCE((SELECT SUM(bs.price_cents)::int FROM booking_services bs WHERE bs.booking_id = b.id), s.price_cents) AS price_cents,
         COALESCE((SELECT array_agg(bs.service_id ORDER BY bs.position) FILTER (WHERE bs.service_id IS NOT NULL) FROM booking_services bs WHERE bs.booking_id = b.id), ARRAY[b.service_id]) AS service_ids,
         st.name AS staff_name,
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
    serviceIds: r.service_ids,
    priceCents: r.price_cents,
    durationMin: Math.round((new Date(r.ends_at).getTime() - new Date(r.starts_at).getTime()) / 60000),
    depositCents: r.deposit_cents,
    depositStatus: r.deposit_status,
    attendance: r.attendance,
    staffId: r.staff_id,
    staffName: r.staff_name,
    customerId: r.customer_id,
    canCancel: r.can_cancel,
    customerResponse: r.customer_response,
    cancelReason: r.cancel_reason,
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
  const rows = await query<SummaryRow>(`${SUMMARY_SELECT} WHERE b.code = $1 AND starts_with(b.hold_token, $2)`, [code, token]);
  return rows[0] ? mapSummary(rows[0]) : null;
}

/**
 * Todas las citas de una clienta (futuras y las de las últimas semanas, también las canceladas, que se
 * muestran con su etiqueta roja). Se usa en «Mis citas».
 */
export async function listCustomerBookings(customerIds: number[], opts: { limit?: number } = {}): Promise<BookingSummary[]> {
  if (!customerIds.length) return [];
  const rows = await query<SummaryRow>(
    `${SUMMARY_SELECT}
     WHERE b.customer_id = ANY($1::bigint[]) AND b.status IN ('CONFIRMED','CANCELLED')
       AND b.starts_at > now() - interval '30 days'
     ORDER BY b.starts_at ASC LIMIT $2::int`,
    [customerIds, opts.limit ?? 40],
  );
  return rows.map(mapSummary);
}

/** El pack solo se aplica si los servicios elegidos son EXACTAMENTE los del pack (los extras no cuentan). */
async function matchPackage(q: Runner, visit: Visit, slug: string | null): Promise<{ slug: string; percent: number } | null> {
  if (!slug) return null;
  const r = (await q(`SELECT slug, discount_percent, service_slugs FROM packages WHERE slug = $1 AND active`, [slug])) as unknown as {
    slug: string;
    discount_percent: number;
    service_slugs: string[];
  }[];
  if (!r[0]) return null;
  const want = new Set(r[0].service_slugs);
  const have = new Set(visit.items.map((i) => i.slug));
  if (visit.items.length !== want.size || want.size !== have.size || [...want].some((x) => !have.has(x))) return null; // sin servicios repetidos
  return { slug: r[0].slug, percent: r[0].discount_percent };
}

/** Duración, limpieza y paso de huecos de una cita ya creada (incluye los extras en la duración). */
export async function bookingVisitMetrics(q: Runner, bookingId: string, fallbackMin = 30): Promise<{ duration: number; buffer: number; step: number }> {
  const svc = (await q(
    `SELECT bs.duration_min, bs.buffer_min, bs.is_addon, COALESCE(s.slot_step_min, bs.duration_min) AS step_min
     FROM booking_services bs LEFT JOIN services s ON s.id = bs.service_id
     WHERE bs.booking_id = $1::uuid ORDER BY bs.position`,
    [bookingId],
  )) as unknown as { duration_min: number; buffer_min: number; is_addon: boolean; step_min: number }[];
  const base = svc.filter((x) => !x.is_addon);
  const duration = svc.reduce((a, x) => a + x.duration_min, 0) || fallbackMin;
  return {
    duration,
    buffer: base.length ? base[base.length - 1].buffer_min : 0,
    step: Math.max(5, base.length ? Math.min(...base.map((x) => x.step_min)) : duration),
  };
}

/** Casillas de seguridad que pide cada cita según sus servicios (láser, microblading…). */
async function requiredConsents(q: Runner, bookingId: string): Promise<string[]> {
  const r = (await q(
    `SELECT DISTINCT s.consent_kind AS k FROM booking_services bs JOIN services s ON s.id = bs.service_id
     WHERE bs.booking_id = $1::uuid AND s.consent_kind IS NOT NULL`,
    [bookingId],
  )) as unknown as { k: string }[];
  return r.map((x) => x.k);
}
async function assertAndStoreConsents(q: Runner, bookingId: string, acks: string[]): Promise<void> {
  const need = await requiredConsents(q, bookingId);
  if (!need.length) return;
  const missing = need.filter((k) => !acks.includes(k));
  if (missing.length) throw new BookingError("INVALID", "Falta marcar las casillas de seguridad del tratamiento.", 400);
  await q(`UPDATE bookings SET consent_acks = $2::text[], consent_at = now() WHERE id = $1::uuid`, [bookingId, need]);
}

/** Vincula la cita con la ficha de la clienta (se crea si es nueva). Devuelve cuántos plantones lleva. */
const phoneKeySql = (col: string) => `right(regexp_replace(coalesce(${col}, ''), '\\D', '', 'g'), 9)`;

/**
 * Reglas por clienta (se comprueban al confirmar y al cambiar de hora):
 *  - no puede tener dos citas que se solapen en el tiempo (aunque sean con profesionales distintas);
 *  - tope de citas futuras por teléfono (MAX_ACTIVE_BOOKINGS, 6 por defecto) para que nadie acapare huecos.
 */
async function assertCustomerFree(
  q: Runner,
  phone: string,
  spans: { start: Date | string; end: Date | string }[],
  excludeIds: string[],
  newCount: number,
): Promise<void> {
  const key = phoneDigits(phone).slice(-9);
  if (key.length < 6) return;
  for (const sp of spans) {
    const clash = (await q(
      `SELECT 1 FROM bookings b
       WHERE ${phoneKeySql("b.customer_phone")} = $1
         AND (b.status = 'CONFIRMED' OR (b.status = 'HOLD' AND b.deposit_status = 'PENDING' AND b.hold_expires_at > now()))
         AND b.id <> ALL($2::uuid[])
         AND b.starts_at < $4::timestamptz AND $3::timestamptz < b.ends_at
       LIMIT 1`,
      [key, excludeIds, sp.start, sp.end],
    )) as unknown[];
    if (clash.length) throw new BookingError("CONFLICT", "Ya tienes otra cita a esa hora. Elige otra hora o cambia la que ya tienes.", 409);
  }
  if (newCount > 0) {
    const cnt = (await q(
      `SELECT count(*)::int AS n FROM bookings b
       WHERE ${phoneKeySql("b.customer_phone")} = $1 AND b.status = 'CONFIRMED' AND b.starts_at > now() AND b.id <> ALL($2::uuid[])`,
      [key, excludeIds],
    )) as unknown as { n: number }[];
    if (cnt[0].n + newCount > CONFIG.maxActiveBookings) {
      throw new BookingError("LIMIT", `Ya tienes ${cnt[0].n} citas pendientes. Para pedir más, llámanos al ${CONFIG.salon.phoneMobile}.`, 429);
    }
  }
}

async function linkCustomer(q: Runner, bookingId: string): Promise<number> {
  const b = (await q(`SELECT customer_name, customer_phone, customer_email FROM bookings WHERE id = $1::uuid`, [bookingId])) as unknown as {
    customer_name: string | null;
    customer_phone: string | null;
    customer_email: string | null;
  }[];
  const row = b[0];
  if (!row?.customer_phone || !row.customer_name) return 0;
  const c = (await q(
    `INSERT INTO customers (phone_key, name, phone, email) VALUES ($1, $2, $3, $4)
     ON CONFLICT (phone_key) DO UPDATE
       SET name = EXCLUDED.name, phone = EXCLUDED.phone, email = COALESCE(EXCLUDED.email, customers.email)
     RETURNING id, no_show_count`,
    [phoneDigits(row.customer_phone).slice(-9), row.customer_name, row.customer_phone, row.customer_email],
  )) as unknown as { id: number; no_show_count: number }[];
  await q(`UPDATE bookings SET customer_id = $2::bigint WHERE id = $1::uuid`, [bookingId, c[0].id]);
  return c[0].no_show_count;
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
  priceCents: number;
  durationMin: number;
  depositCents: number;
  /** Minutos que ocupa el bloqueo (duración + limpieza) y cuándo termina lo que la clienta ve. */
  blockedMin: number;
  endsAt: string;
  /** Bloqueos hermanos que se han alargado (los que no aparezcan ya habían caducado). */
  extendedIds: string[];
};

export async function createHold(input: {
  serviceIds: number[];
  staffId: number | null;
  startsAt: string;
  ipHash: string;
  /** Si la clienta ya tenía un hueco bloqueado y elige otro, se cambia en la misma operación: si el nuevo falla, conserva el antiguo. */
  replace?: { holdId: string; holdToken: string };
  /** Visita en horas distintas: al bloquear otra hora, los bloqueos hermanos se alargan para que caduquen a la vez. */
  extend?: { holdId: string; holdToken: string }[];
  /** Extras (retirada de esmalte, nail art…) y pack elegido (el servidor comprueba y aplica el descuento). */
  addonIds?: number[];
  packageSlug?: string | null;
}): Promise<HoldResult> {
  return tx(async (q) => {
    // Limpieza perezosa de bloqueos caducados
    await q(`UPDATE bookings SET status = 'EXPIRED' WHERE status = 'HOLD' AND hold_expires_at <= now()`);

    // Cambio de hueco: el bloqueo anterior se libera dentro de esta misma transacción. Si el nuevo hueco
    // no es válido, se lanza un error, la transacción se deshace y el hueco anterior sigue guardado.
    if (input.replace) {
      await q(`UPDATE bookings SET status = 'EXPIRED' WHERE id = $1::uuid AND hold_token = $2 AND status = 'HOLD'`, [
        input.replace.holdId,
        input.replace.holdToken,
      ]);
    }

    const visit = await loadVisit(input.serviceIds, q, input.addonIds ?? []);

    // Bloqueos hermanos (visita en horas distintas): se alargan y no cuentan para el tope por IP
    const kept: string[] = [];
    for (const e of (input.extend ?? []).slice(0, 3)) {
      const r = (await q(
        `UPDATE bookings SET hold_expires_at = now() + make_interval(mins => $3::int)
         WHERE id = $1::uuid AND hold_token = $2 AND status = 'HOLD' AND hold_expires_at > now() RETURNING id`,
        [e.holdId, e.holdToken, CONFIG.holdMinutes],
      )) as unknown as { id: string }[];
      if (r[0]) kept.push(r[0].id);
    }

    // Anti-abuso: como mucho N bloqueos vivos por IP (sin contar los hermanos); el más antiguo se libera
    const cnt = (await q(
      `SELECT count(*)::int AS n FROM bookings WHERE status = 'HOLD' AND ip_hash = $1 AND id <> ALL($2::uuid[])`,
      [input.ipHash, kept],
    )) as unknown as { n: number }[];
    const excess = cnt[0].n - CONFIG.maxHoldsPerIp + 1;
    if (excess > 0) {
      await q(
        `UPDATE bookings SET status = 'EXPIRED'
         WHERE id IN (SELECT id FROM bookings WHERE status = 'HOLD' AND ip_hash = $1 AND id <> ALL($3::uuid[]) ORDER BY created_at ASC LIMIT $2::int)`,
        [input.ipHash, excess, kept],
      );
    }

    // ¿Es un hueco válido (horario, pausa, bloqueos, preaviso, limpieza)?
    const dayRow = (await q(`SELECT to_char($1::timestamptz AT TIME ZONE $2::text, 'YYYY-MM-DD') AS d`, [input.startsAt, CONFIG.tz])) as unknown as { d: string }[];
    const day = dayRow[0].d;
    const today = todayIn(CONFIG.tz);
    if (day < today || day > addDays(today, CONFIG.maxDaysAhead)) {
      throw new BookingError("INVALID", "Esa fecha no se puede reservar.", 400);
    }

    const rows = await getSlotRows(
      { from: day, to: day, durationMin: visit.durationMin, bufferMin: visit.bufferMin, stepMin: visit.stepMin, staffId: input.staffId },
      q,
    );
    const target = new Date(input.startsAt).getTime();
    const free = rows.filter((r) => r.available && new Date(r.startsAt).getTime() === target);
    if (!free.length) throw new BookingError("SLOT_TAKEN", "Ese hueco acaba de ocuparse. Elige otro.", 409);
    const staffId = free[0].staffId;

    // Señal: con la política «solo a quien ya ha faltado», al reservar solo cuentan los servicios marcados «siempre»;
    // el resto se decide al confirmar, cuando ya se sabe quién es la clienta.
    const policy = await getDepositPolicy(q);
    const holdDeposit = policy.mode === "repeat" ? visit.items.filter((i) => i.depositAlways).reduce((a, i) => a + i.depositCents, 0) : visit.depositCents;
    // Pack: descuento (en %) sobre los servicios; los extras no se rebajan
    const pack = await matchPackage(q, visit, input.packageSlug ?? null);
    const svcPrice = (priceCents: number) => (pack ? Math.round((priceCents * (100 - pack.percent)) / 100) : priceCents);
    const totalPrice = visit.items.reduce((a, i) => a + svcPrice(i.priceCents), 0) + visit.addons.reduce((a, x) => a + x.priceCents, 0);

    const holdToken = newToken();
    try {
      const ins = (await q(
        `INSERT INTO bookings (staff_id, service_id, starts_at, ends_at, blocked_until, status, hold_expires_at, hold_token, ip_hash, deposit_cents, package_slug)
         VALUES ($1::int, $2::int, $3::timestamptz, $3::timestamptz + make_interval(mins => $4::int),
                 $3::timestamptz + make_interval(mins => $5::int), 'HOLD', now() + make_interval(mins => $6::int), $7, $8, $9::int, $10)
         RETURNING id, EXTRACT(EPOCH FROM (hold_expires_at - now()))::int AS ttl`,
        [staffId, visit.items[0].id, input.startsAt, visit.durationMin, visit.durationMin + visit.bufferMin, CONFIG.holdMinutes, holdToken, input.ipHash, holdDeposit, pack?.slug ?? null],
      )) as unknown as { id: string; ttl: number }[];

      for (let i = 0; i < visit.items.length; i++) {
        const it = visit.items[i];
        await q(
          `INSERT INTO booking_services (booking_id, service_id, position, name, duration_min, price_cents, deposit_cents, buffer_min)
           VALUES ($1::uuid, $2::int, $3::int, $4, $5::int, $6::int, $7::int, $8::int)`,
          [ins[0].id, it.id, i, it.name, it.durationMin, svcPrice(it.priceCents), it.depositCents, it.bufferMin],
        );
      }
      for (let i = 0; i < visit.addons.length; i++) {
        const ad = visit.addons[i];
        await q(
          `INSERT INTO booking_services (booking_id, service_id, position, name, duration_min, price_cents, deposit_cents, buffer_min, is_addon)
           VALUES ($1::uuid, NULL, $2::int, $3, $4::int, $5::int, 0, 0, true)`,
          [ins[0].id, visit.items.length + i, ad.name, ad.durationMin, ad.priceCents],
        );
      }

      const st = (await q(`SELECT name FROM staff WHERE id = $1::int`, [staffId])) as unknown as { name: string }[];
      return {
        holdId: ins[0].id,
        holdToken,
        expiresInSec: ins[0].ttl,
        staffId,
        staffName: st[0]?.name ?? "",
        priceCents: totalPrice,
        durationMin: visit.durationMin,
        depositCents: holdDeposit,
        blockedMin: visit.durationMin + visit.bufferMin,
        endsAt: new Date(new Date(input.startsAt).getTime() + visit.durationMin * 60000).toISOString(),
        extendedIds: kept,
      };
    } catch (e) {
      if (isExclusionViolation(e)) throw new BookingError("SLOT_TAKEN", "Ese hueco acaba de ocuparse. Elige otro.", 409);
      throw e;
    }
  });
}

export async function releaseHold(id: string, token: string): Promise<void> {
  await query(
    `UPDATE bookings SET status = 'EXPIRED', deposit_status = CASE WHEN deposit_status = 'PENDING' THEN 'NONE' ELSE deposit_status END
     WHERE id = $1::uuid AND hold_token = $2 AND status = 'HOLD'`,
    [id, token],
  );
}

/* ------------------------------------------------------------------ */
/* 2) CONFIRMAR (con o sin pago de señal)                              */
/* ------------------------------------------------------------------ */

export async function confirmBooking(input: {
  holdId: string;
  holdToken: string;
  name: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
  acks?: string[];
}): Promise<{ booking: BookingSummary; checkoutUrl?: string; noShowCount: number }> {
  const out = await tx(async (q) => {
    const found = (await q(
      `SELECT status, (starts_at > now()) AS future, deposit_cents, code, starts_at, ends_at
       FROM bookings WHERE id = $1::uuid AND hold_token = $2 FOR UPDATE`,
      [input.holdId, input.holdToken],
    )) as unknown as { status: string; future: boolean; deposit_cents: number; code: string | null; starts_at: Date; ends_at: Date }[];
    const row = found[0];
    if (!row) throw new BookingError("NOT_FOUND", "No encontramos tu reserva. Vuelve a elegir hueco.", 404);
    if (row.status === "CANCELLED") throw new BookingError("HOLD_EXPIRED", "Esta reserva fue cancelada.", 410);
    if (!row.future) throw new BookingError("HOLD_EXPIRED", "Ese horario ya ha pasado.", 410);
    let depositCents = row.deposit_cents;
    if (row.status !== "CONFIRMED") {
      await assertCustomerFree(q, input.phone, [{ start: row.starts_at, end: row.ends_at }], [input.holdId], 1);
      await assertAndStoreConsents(q, input.holdId, input.acks ?? []);
      depositCents = await effectiveDeposit(q, input.holdId, input.phone, row.deposit_cents, stripeEnabled());
    }

    const needsPayment = row.status !== "CONFIRMED" && depositCents > 0 && stripeEnabled();
    let noShowCount = 0;

    if (needsPayment) {
      // Se guardan los datos y se alarga el bloqueo mientras paga (Stripe necesita ≥ 30 min)
      try {
        await q(
          `UPDATE bookings
             SET status = 'HOLD', hold_expires_at = now() + interval '35 minutes', code = COALESCE(code, $2),
                 customer_name = $3, customer_phone = $4, customer_email = $5, notes = $6, deposit_status = 'PENDING'
           WHERE id = $1::uuid`,
          [input.holdId, newCode(), input.name, input.phone, input.email || null, input.notes || null],
        );
      } catch (e) {
        if (isExclusionViolation(e)) throw new BookingError("SLOT_TAKEN", "Lo sentimos, ese hueco acaba de ocuparse.", 409);
        throw e;
      }
    } else if (row.status !== "CONFIRMED") {
      // Si el bloqueo caducó pero nadie más cogió el hueco, se recupera; si alguien lo cogió, el candado salta.
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
        if (isExclusionViolation(e)) throw new BookingError("SLOT_TAKEN", "Lo sentimos, ese hueco acaba de ocuparse.", 409);
        throw e;
      }
      noShowCount = await linkCustomer(q, input.holdId);
    }
    return { booking: await loadSummary(q, input.holdId), needsPayment, noShowCount };
  });

  if (!out.needsPayment) return { booking: out.booking, noShowCount: out.noShowCount };

  // Pago de la señal: se crea la sesión de Stripe fuera de la transacción
  const session = await createCheckoutSession({
    bookingId: out.booking.id,
    code: out.booking.code,
    token: out.booking.token,
    amountCents: out.booking.depositCents,
    description: out.booking.serviceName,
    email: out.booking.customerEmail,
  });
  if ("error" in session) {
    console.error("[stripe:session]", session.error);
    await query(`UPDATE bookings SET deposit_status = 'NONE' WHERE id = $1::uuid`, [out.booking.id]);
    throw new BookingError("INVALID", "No hemos podido iniciar el pago de la señal. Inténtalo de nuevo o llámanos.", 502);
  }
  await query(`UPDATE bookings SET stripe_session_id = $2 WHERE id = $1::uuid`, [out.booking.id, session.id]);
  return { booking: out.booking, checkoutUrl: session.url, noShowCount: 0 };
}

/* ------------------------------------------------------------------ */
/* 2b) CONFIRMAR UNA VISITA EN HORAS DISTINTAS (varias citas a la vez)  */
/* ------------------------------------------------------------------ */

/** Citas de un grupo, ordenadas por hora. */
export async function listGroupIds(groupId: string): Promise<string[]> {
  const rows = await query<{ id: string }>(`SELECT id FROM bookings WHERE group_id = $1::uuid ORDER BY starts_at`, [groupId]);
  return rows.map((r) => r.id);
}

/**
 * Confirma de una vez todas las citas de una visita en horas distintas: o se confirman todas o ninguna
 * (si una falla —hueco ocupado, bloqueo caducado— se deshace todo y los demás bloqueos siguen guardados).
 * Con señal, se paga UNA vez por el total y el webhook confirma el grupo entero.
 */
export async function confirmGroup(input: {
  legs: { holdId: string; holdToken: string }[];
  name: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
  acks?: string[];
}): Promise<{ bookings: BookingSummary[]; checkoutUrl?: string; noShowCount: number; fresh: boolean }> {
  const ids = input.legs.map((l) => l.holdId);
  if (input.legs.length < 2 || input.legs.length > 4) throw new BookingError("INVALID", "Una visita en horas distintas lleva de 2 a 4 citas.", 400);
  if (new Set(ids).size !== ids.length) throw new BookingError("INVALID", "Hay una cita repetida.", 400);
  const tokenOf = new Map(input.legs.map((l) => [l.holdId, l.holdToken]));
  const groupId = randomUUID();

  const out = await tx(async (q) => {
    const rows = (await q(
      `SELECT id, hold_token, status, starts_at, ends_at, (starts_at > now()) AS future, deposit_cents, group_id
       FROM bookings WHERE id = ANY($1::uuid[]) ORDER BY starts_at FOR UPDATE`,
      [ids],
    )) as unknown as { id: string; hold_token: string; status: string; starts_at: Date; ends_at: Date; future: boolean; deposit_cents: number; group_id: string | null }[];
    if (rows.length !== ids.length || rows.some((r) => r.hold_token !== tokenOf.get(r.id))) {
      throw new BookingError("NOT_FOUND", "No encontramos tu reserva. Vuelve a elegir las horas.", 404);
    }
    if (rows.some((r) => r.status === "CANCELLED")) throw new BookingError("HOLD_EXPIRED", "Una de las citas fue cancelada.", 410);
    if (rows.some((r) => !r.future)) throw new BookingError("HOLD_EXPIRED", "Una de las horas ya ha pasado.", 410);

    // Doble clic o reintento: si ya estaban confirmadas, se devuelven tal cual
    if (rows.every((r) => r.status === "CONFIRMED")) {
      const list: BookingSummary[] = [];
      for (const r of rows) list.push(await loadSummary(q, r.id));
      return { list, needsPayment: false, noShowCount: 0, fresh: false, totalDeposit: 0 };
    }
    if (rows.some((r) => r.status === "CONFIRMED")) throw new BookingError("INVALID", "Parte de tu visita ya estaba confirmada. Revisa «Tus citas».", 409);

    // No se pueden solapar entre ellas
    for (let i = 1; i < rows.length; i++) {
      if (new Date(rows[i].starts_at) < new Date(rows[i - 1].ends_at)) {
        throw new BookingError("CONFLICT", "Dos de tus servicios coinciden en la hora. Cambia uno de ellos.", 409);
      }
    }
    await assertCustomerFree(q, input.phone, rows.map((r) => ({ start: r.starts_at, end: r.ends_at })), ids, rows.length);

    let totalDeposit = 0;
    for (const r of rows) {
      await assertAndStoreConsents(q, r.id, input.acks ?? []);
      totalDeposit += await effectiveDeposit(q, r.id, input.phone, r.deposit_cents, stripeEnabled());
    }
    const needsPayment = totalDeposit > 0 && stripeEnabled();
    let noShowCount = 0;
    try {
      for (const r of rows) {
        if (needsPayment) {
          await q(
            `UPDATE bookings
               SET status = 'HOLD', hold_expires_at = now() + interval '35 minutes', code = COALESCE(code, $2), group_id = $7::uuid,
                   customer_name = $3, customer_phone = $4, customer_email = $5, notes = $6,
                   deposit_status = CASE WHEN deposit_cents > 0 THEN 'PENDING' ELSE 'NONE' END
             WHERE id = $1::uuid`,
            [r.id, newCode(), input.name, input.phone, input.email || null, input.notes || null, groupId],
          );
        } else {
          await q(
            `UPDATE bookings
               SET status = 'CONFIRMED', code = COALESCE(code, $2), hold_expires_at = NULL, group_id = $9::uuid,
                   customer_name = $3, customer_phone = $4, customer_email = $5, notes = $6,
                   confirmed_at = now(),
                   remind_at = ${remindAtSql("starts_at", "$7::text", "$8::int")}
             WHERE id = $1::uuid`,
            [r.id, newCode(), input.name, input.phone, input.email || null, input.notes || null, CONFIG.tz, REMINDER_HOURS, groupId],
          );
          noShowCount = await linkCustomer(q, r.id);
        }
      }
    } catch (e) {
      if (isExclusionViolation(e)) throw new BookingError("SLOT_TAKEN", "Lo sentimos, una de las horas acaba de ocuparse. Elige otra para ese servicio.", 409);
      throw e;
    }
    const list: BookingSummary[] = [];
    for (const r of rows) list.push(await loadSummary(q, r.id));
    return { list, needsPayment, noShowCount, fresh: true, totalDeposit };
  });

  if (!out.needsPayment) return { bookings: out.list, noShowCount: out.noShowCount, fresh: out.fresh };

  // Una sola señal por el total; el grupo se confirma cuando Stripe avisa del pago
  const first = out.list[0];
  const session = await createCheckoutSession({
    bookingId: first.id,
    groupId,
    code: first.code,
    token: first.token,
    amountCents: out.totalDeposit,
    description: `${out.list.length} citas · ${out.list.map((b) => b.serviceName).join(" + ")}`.slice(0, 120),
    email: first.customerEmail,
  });
  if ("error" in session) {
    console.error("[stripe:session]", session.error);
    await query(`UPDATE bookings SET deposit_status = 'NONE' WHERE group_id = $1::uuid`, [groupId]);
    throw new BookingError("INVALID", "No hemos podido iniciar el pago de la señal. Inténtalo de nuevo o llámanos.", 502);
  }
  await query(`UPDATE bookings SET stripe_session_id = $2 WHERE group_id = $1::uuid`, [groupId, session.id]);
  return { bookings: out.list, checkoutUrl: session.url, noShowCount: 0, fresh: true };
}

/** Lo llama el webhook de Stripe cuando la señal está pagada. */
export async function finalizePaidBooking(
  bookingId: string,
  paymentIntent: string | null,
): Promise<{ state: "confirmed" | "already" | "conflict" | "missing"; booking?: BookingSummary; noShowCount?: number }> {
  return tx(async (q) => {
    const found = (await q(`SELECT status FROM bookings WHERE id = $1::uuid FOR UPDATE`, [bookingId])) as unknown as { status: string }[];
    if (!found[0]) return { state: "missing" as const };
    if (found[0].status === "CONFIRMED") return { state: "already" as const, booking: await loadSummary(q, bookingId) };
    if (found[0].status === "CANCELLED") return { state: "conflict" as const };
    try {
      await q(
        `UPDATE bookings
           SET status = 'CONFIRMED', hold_expires_at = NULL, confirmed_at = now(),
               deposit_status = CASE WHEN deposit_cents > 0 THEN 'PAID' ELSE 'NONE' END,
               stripe_payment_intent = $2, remind_at = ${remindAtSql("starts_at", "$3::text", "$4::int")}
         WHERE id = $1::uuid`,
        [bookingId, paymentIntent, CONFIG.tz, REMINDER_HOURS],
      );
    } catch (e) {
      if (isExclusionViolation(e)) return { state: "conflict" as const };
      throw e;
    }
    const noShowCount = await linkCustomer(q, bookingId);
    return { state: "confirmed" as const, booking: await loadSummary(q, bookingId), noShowCount };
  });
}

/* ------------------------------------------------------------------ */
/* 3) CANCELAR                                                         */
/* ------------------------------------------------------------------ */

export async function cancelByCustomer(code: string, token: string): Promise<BookingSummary> {
  const id = await tx(async (q) => {
    const found = (await q(
      `SELECT id, status, (starts_at - now()) >= make_interval(hours => $3::int) AS ok
       FROM bookings WHERE code = $1 AND starts_with(hold_token, $2) FOR UPDATE`,
      [code, tokenOk(token) ? token : "~invalid~", CONFIG.cancelNoticeHours],
    )) as unknown as { id: string; status: string; ok: boolean }[];
    const row = found[0];
    if (!row) throw new BookingError("NOT_FOUND", "No encontramos esa cita.", 404);
    if (row.status === "CANCELLED") return row.id;
    if (!row.ok) {
      throw new BookingError(
        "TOO_LATE",
        `Con menos de ${CONFIG.cancelNoticeHours} horas de antelación no se puede cancelar online. Llámanos al ${CONFIG.salon.phoneMobile}.`,
        409,
      );
    }
    await q(`UPDATE bookings SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = 'customer' WHERE id = $1::uuid`, [row.id]);
    return row.id;
  });
  await settleDeposit(id, "policy");
  return (await getSummaryById(id))!;
}

/** Cancelación desde el panel: el centro cancela, así que la señal se devuelve siempre. */
export async function adminCancel(id: string): Promise<void> {
  await query(
    `UPDATE bookings SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = COALESCE(cancel_reason, 'centre')
     WHERE id = $1::uuid AND status IN ('CONFIRMED','HOLD')`,
    [id],
  );
  await settleDeposit(id, "refund");
}

/* ------------------------------------------------------------------ */
/* Cambiar la hora                                                     */
/* ------------------------------------------------------------------ */

export async function rescheduleBooking(input: {
  bookingId?: string;
  code?: string;
  token?: string;
  startsAt: string;
  staffId?: number | null;
  admin?: boolean;
}): Promise<{ booking: BookingSummary; old: { startsAt: string; endsAt: string } }> {
  return tx(async (q) => {
    const where = input.bookingId ? `id = $1::uuid` : `code = $1 AND starts_with(hold_token, $2)`;
    const params = input.bookingId ? [input.bookingId] : [input.code ?? "", input.token && tokenOk(input.token) ? input.token : "~invalid~"];
    const found = (await q(
      `SELECT id, status, staff_id, starts_at, ends_at, customer_phone, (starts_at > now()) AS future,
              (starts_at - now()) >= make_interval(hours => ${RESCHEDULE_HOURS}) AS in_time
       FROM bookings WHERE ${where} FOR UPDATE`,
      params,
    )) as unknown as { id: string; status: string; staff_id: number; starts_at: Date; ends_at: Date; customer_phone: string | null; future: boolean; in_time: boolean }[];
    const row = found[0];
    if (!row) throw new BookingError("NOT_FOUND", "No encontramos esa cita.", 404);
    if (row.status !== "CONFIRMED" || !row.future) throw new BookingError("HOLD_EXPIRED", "Esta cita ya no se puede cambiar.", 410);
    if (!input.admin && !row.in_time) {
      throw new BookingError("TOO_LATE", `Con menos de ${RESCHEDULE_HOURS} horas de antelación no se puede cambiar online. Llámanos al ${CONFIG.salon.phoneMobile}.`, 409);
    }

    // Duración, limpieza y paso salen de la foto de servicios de la cita (los extras suman duración)
    const { duration, buffer, step } = await bookingVisitMetrics(q, row.id, Math.round((+new Date(row.ends_at) - +new Date(row.starts_at)) / 60000));

    const target = new Date(input.startsAt).getTime();
    if (!(target > Date.now())) throw new BookingError("INVALID", "Elige un momento futuro.", 400);

    let staffId = input.staffId ?? row.staff_id;
    if (!input.admin) {
      const day = ((await q(`SELECT to_char($1::timestamptz AT TIME ZONE $2::text, 'YYYY-MM-DD') AS d`, [input.startsAt, CONFIG.tz])) as unknown as { d: string }[])[0].d;
      const today = todayIn(CONFIG.tz);
      if (day < today || day > addDays(today, CONFIG.maxDaysAhead)) throw new BookingError("INVALID", "Esa fecha no se puede reservar.", 400);
      const rows = await getSlotRows(
        { from: day, to: day, durationMin: duration, bufferMin: buffer, stepMin: step, staffId: null, excludeBookingId: row.id },
        q,
      );
      const free = rows.filter((r) => r.available && new Date(r.startsAt).getTime() === target);
      if (!free.length) throw new BookingError("SLOT_TAKEN", "Ese hueco ya no está libre. Elige otro.", 409);
      staffId = (free.find((r) => r.staffId === row.staff_id) ?? free[0]).staffId;
    }

    if (row.customer_phone) {
      await assertCustomerFree(q, row.customer_phone, [{ start: input.startsAt, end: new Date(target + duration * 60000).toISOString() }], [row.id], 0);
    }

    try {
      await q(
        `UPDATE bookings
           SET staff_id = $2::int, starts_at = $3::timestamptz,
               ends_at = $3::timestamptz + make_interval(mins => $4::int),
               blocked_until = $3::timestamptz + make_interval(mins => $7::int),
               remind_at = ${remindAtSql("$3::timestamptz", "$5::text", "$6::int")},
               reminder_sent_at = NULL, reminder_attempts = 0, customer_response = NULL, responded_at = NULL,
               owner_alerted_at = NULL, reschedule_count = reschedule_count + 1
         WHERE id = $1::uuid`,
        [row.id, staffId, input.startsAt, duration, CONFIG.tz, REMINDER_HOURS, duration + buffer],
      );
    } catch (e) {
      if (isExclusionViolation(e)) throw new BookingError("SLOT_TAKEN", "Ese hueco ya está ocupado.", 409);
      throw e;
    }
    return {
      booking: await loadSummary(q, row.id),
      old: { startsAt: new Date(row.starts_at).toISOString(), endsAt: new Date(row.ends_at).toISOString() },
    };
  });
}

/* ------------------------------------------------------------------ */
/* Asistencia: "llegó" / "no vino"                                     */
/* ------------------------------------------------------------------ */

export async function markAttendance(
  id: string,
  value: "SHOWED" | "NO_SHOW" | null,
): Promise<{ booking: BookingSummary; noShowCount: number | null }> {
  const noShowCount = await tx(async (q) => {
    const found = (await q(`SELECT attendance, customer_id, deposit_status, status FROM bookings WHERE id = $1::uuid FOR UPDATE`, [id])) as unknown as {
      attendance: string | null;
      customer_id: number | null;
      deposit_status: string;
      status: string;
    }[];
    const row = found[0];
    if (!row) throw new BookingError("NOT_FOUND", "No encontramos esa cita.", 404);
    if (row.status !== "CONFIRMED") throw new BookingError("INVALID", "Solo se puede marcar la asistencia de citas confirmadas.", 400);

    await q(`UPDATE bookings SET attendance = $2, attended_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END WHERE id = $1::uuid`, [id, value]);

    let count: number | null = null;
    if (row.customer_id) {
      // Se deshace el efecto anterior y se aplica el nuevo
      const dNo = (value === "NO_SHOW" ? 1 : 0) - (row.attendance === "NO_SHOW" ? 1 : 0);
      const dVisit = (value === "SHOWED" ? 1 : 0) - (row.attendance === "SHOWED" ? 1 : 0);
      const c = (await q(
        `UPDATE customers SET no_show_count = GREATEST(0, no_show_count + $2::int), visit_count = GREATEST(0, visit_count + $3::int)
         WHERE id = $1::bigint RETURNING no_show_count`,
        [row.customer_id, dNo, dVisit],
      )) as unknown as { no_show_count: number }[];
      count = c[0]?.no_show_count ?? null;
    }
    // La señal se pierde si no vino; si se corrige, vuelve a "pagada"
    if (value === "NO_SHOW" && row.deposit_status === "PAID") {
      await q(`UPDATE bookings SET deposit_status = 'FORFEITED' WHERE id = $1::uuid`, [id]);
    } else if (row.attendance === "NO_SHOW" && value !== "NO_SHOW" && row.deposit_status === "FORFEITED") {
      await q(`UPDATE bookings SET deposit_status = 'PAID' WHERE id = $1::uuid`, [id]);
    }
    return count;
  });
  return { booking: (await getSummaryById(id))!, noShowCount };
}

/* ------------------------------------------------------------------ */
/* Respuesta al recordatorio: "Confirmo" / "No puedo ir"               */
/* ------------------------------------------------------------------ */

export type ResponseState = "confirmed" | "cancelled" | "already_cancelled";

/**
 * La clienta responde desde un enlace (token) o desde WhatsApp (teléfono verificado por Meta).
 * Cancelar desde el recordatorio SIEMPRE se permite, aunque falten pocas horas: un hueco avisado
 * a tiempo se puede volver a ocupar; un "no show" no. (Si hubo señal, se aplica la política de devolución.)
 */
export async function respondToBooking(input: {
  code: string;
  action: "confirm" | "cancel";
  token?: string;
  phone?: string;
}): Promise<{ state: ResponseState; changed: boolean; booking: BookingSummary }> {
  const out = await tx(async (q) => {
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
  if (out.state === "cancelled") {
    await settleDeposit(out.booking.id, "policy");
    return { ...out, booking: (await getSummaryById(out.booking.id)) ?? out.booking };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Administración                                                      */
/* ------------------------------------------------------------------ */

export async function createManualBooking(input: {
  serviceId: number;
  staffId: number;
  day: string;
  time: string;
  name: string;
  phone: string;
  notes?: string | null;
}): Promise<string> {
  return tx(async (q) => {
    const visit = await loadVisit([input.serviceId], q);
    try {
      const rows = (await q(
        `INSERT INTO bookings (staff_id, service_id, starts_at, ends_at, blocked_until, status, hold_token, code,
                               customer_name, customer_phone, notes, source, confirmed_at, remind_at)
         SELECT $1::int, $2::int, t.s, t.s + make_interval(mins => $3::int), t.s + make_interval(mins => $4::int),
                'CONFIRMED', $5, $6, $7, $8, $9, 'admin', now(),
                ${remindAtSql("t.s", "$12::text", "$13::int")}
         FROM (SELECT (($10::date + $11::time) AT TIME ZONE $12::text) AS s) t
         RETURNING id`,
        [
          input.staffId,
          input.serviceId,
          visit.durationMin,
          visit.durationMin + visit.bufferMin,
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
      )) as unknown as { id: string }[];
      const id = rows[0].id;
      const it = visit.items[0];
      await q(
        `INSERT INTO booking_services (booking_id, service_id, position, name, duration_min, price_cents, deposit_cents, buffer_min)
         VALUES ($1::uuid, $2::int, 0, $3, $4::int, $5::int, 0, $6::int)`,
        [id, it.id, it.name, it.durationMin, it.priceCents, it.bufferMin],
      );
      await linkCustomer(q, id);
      return id;
    } catch (e) {
      if (isExclusionViolation(e)) {
        throw new BookingError("SLOT_TAKEN", "Ya hay una cita en ese horario para esa profesional.", 409);
      }
      throw e;
    }
  });
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
