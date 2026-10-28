import { CONFIG } from "./config";
import { todayIn } from "./dates";
import { query } from "./db";
import { expireHolds, markAttendance } from "./bookings";
import { fmtPrice } from "./format";
import { notifyAbandoned, notifyOwnerDigest, notifyOwnerRaw, notifyReactivation } from "./notify";
import { localHour } from "./quiet";
import { optoutUrl } from "./optout";
import { purgeRateHits } from "./ratelimit";
import { siteUrl } from "./site";

/**
 * Tareas del ciclo de vida de la clienta que corren con el cron (cada ~10 min):
 * limpieza de bloqueos, «Vino» automático, recuperación de reservas a medias, reactivación y retención de datos.
 */

async function setting(key: string, def: string): Promise<string> {
  const r = await query<{ value: string }>(`SELECT value FROM settings WHERE key = $1`, [key]);
  return r[0]?.value ?? def;
}

/** Quien esperaba y no reservó tras el aviso vuelve a la lista (3 h después) para el siguiente hueco que se libere. */
export async function reviveWaitlist(): Promise<number> {
  const r = await query(
    `UPDATE waitlist w SET status = 'ACTIVE'
     WHERE w.status = 'NOTIFIED' AND w.notified_at < now() - interval '3 hours' AND (w.day IS NULL OR w.day >= $1::date)
       AND NOT EXISTS (SELECT 1 FROM waitlist o WHERE o.id <> w.id AND o.status = 'ACTIVE' AND o.service_id = w.service_id AND o.phone_key = w.phone_key AND COALESCE(o.day, DATE '1970-01-01') = COALESCE(w.day, DATE '1970-01-01'))
     RETURNING w.id`,
    [todayIn(CONFIG.tz)],
  );
  return r.length;
}

/**
 * «Vino» automático: las citas de hace 3 h o más que nadie marcó cuentan como que vino (la dueña solo corrige las que no),
 * así no se corta el ciclo de gracias, valoración, retoque y sellos si se le pasa marcar.
 */
export async function runAutoShowed(): Promise<number> {
  if ((await setting("auto_showed", "on")) !== "on") return 0;
  const rows = await query<{ id: string }>(
    `SELECT id FROM bookings WHERE status = 'CONFIRMED' AND attendance IS NULL
       AND ends_at < now() - interval '3 hours' AND ends_at > now() - interval '3 days' ORDER BY ends_at LIMIT 100`,
  );
  let n = 0;
  for (const { id } of rows) {
    try {
      await markAttendance(id, "SHOWED");
      n++;
    } catch (e) {
      console.error("[auto-showed]", e);
    }
  }
  if (n > 0) {
    await notifyOwnerRaw(
      `✅ Se han marcado «vino» ${n} cita${n === 1 ? "" : "s"} que nadie había marcado. Si alguna clienta no vino, corrígelo en la agenda (botón «No vino») para que no reciba el mensaje de gracias.`,
      "Citas marcadas como «vino» automáticamente",
    );
  }
  return n;
}

/** Reserva a medias: una sola vez, entre 25 min y 24 h después, y solo de día. */
export async function runAbandonRecovery(): Promise<number> {
  await query(`UPDATE leads SET status = 'EXPIRED', updated_at = now() WHERE status = 'NEW' AND created_at < now() - interval '24 hours'`);
  if ((await setting("abandon_recovery", "on")) !== "on") return 0;
  const claimed = await query<{ id: string; name: string | null; phone: string; service_ids: number[]; service_label: string | null; starts_at: Date | null }>(
    `UPDATE leads SET status = 'MESSAGED', messaged_at = now(), updated_at = now()
     WHERE id IN (
       SELECT l.id FROM leads l
       WHERE l.status = 'NEW' AND l.created_at <= now() - interval '25 minutes' AND l.created_at > now() - interval '24 hours'
         AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.status = 'CONFIRMED'
                           AND right(regexp_replace(coalesce(b.customer_phone, ''), '\\D', '', 'g'), 9) = l.phone_key AND b.confirmed_at > l.created_at - interval '10 minutes')
         AND NOT EXISTS (SELECT 1 FROM bookings h WHERE h.id = l.hold_id AND (h.status = 'CONFIRMED' OR (h.status = 'HOLD' AND h.hold_expires_at > now())))
         AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.phone_key = l.phone_key AND c.optout_at IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM leads l2 WHERE l2.phone_key = l.phone_key AND l2.status = 'MESSAGED' AND l2.messaged_at > now() - interval '3 days')
       ORDER BY l.created_at LIMIT 20 FOR UPDATE SKIP LOCKED
     ) RETURNING id, name, phone, service_ids, service_label, starts_at`,
  );
  let n = 0;
  for (const l of claimed) {
    const slugs = await query<{ slug: string }>(`SELECT slug FROM services WHERE id = ANY($1::int[]) ORDER BY array_position($1::int[], id)`, [l.service_ids]);
    if (!slugs.length) continue;
    const qs = new URLSearchParams({ servicio: slugs[0].slug, utm_source: "recovery", utm_medium: "msg" });
    if (slugs.length > 1) qs.set("extra", slugs.slice(1).map((x) => x.slug).join(","));
    if (l.starts_at) {
      const day = todayIn(CONFIG.tz, new Date(l.starts_at));
      if (day >= todayIn(CONFIG.tz)) qs.set("dia", day);
    }
    const ok = await notifyAbandoned({ name: l.name, phone: l.phone, whenIso: l.starts_at ? new Date(l.starts_at).toISOString() : null, service: l.service_label ?? "tu cita", link: `${siteUrl()}/reservar?${qs}` });
    if (ok) n++;
  }
  return n;
}

/** «Te echamos de menos»: clientas que no vienen desde hace N días (ajustes) y no tienen otra cita. Una vez cada 4 meses como máximo. */
export async function runReactivation(): Promise<number> {
  const days = Number(await setting("reactivation_days", "75"));
  if (!Number.isFinite(days) || days < 14) return 0;
  const rows = await query<{ id: number; name: string; phone: string; email: string | null; slug: string; service: string; weeks: number; pro: number | null }>(
    `SELECT c.id, c.name, c.phone, c.email, sv.slug, sv.name AS service, COALESCE(c.preferred_staff_id, lb.staff_id) AS pro, (EXTRACT(EPOCH FROM (now() - lb.starts_at)) / 604800)::int AS weeks
     FROM customers c
     JOIN LATERAL (SELECT b.id, b.starts_at, b.staff_id FROM bookings b WHERE b.customer_id = c.id AND b.status = 'CONFIRMED' AND b.attendance = 'SHOWED' ORDER BY b.starts_at DESC LIMIT 1) lb ON true
     JOIN LATERAL (SELECT s.slug, s.name FROM booking_services bs JOIN services s ON s.id = bs.service_id WHERE bs.booking_id = lb.id AND NOT bs.is_addon ORDER BY bs.position LIMIT 1) sv ON true
     WHERE c.optout_at IS NULL AND c.phone <> '' AND lb.starts_at < now() - make_interval(days => $1::int) AND lb.starts_at > now() - interval '18 months'
       AND (c.last_reactivation_at IS NULL OR c.last_reactivation_at < now() - interval '120 days')
       AND NOT EXISTS (SELECT 1 FROM bookings f WHERE f.customer_id = c.id AND f.status = 'CONFIRMED' AND f.starts_at > now())
     ORDER BY lb.starts_at LIMIT 12`,
    [Math.floor(days)],
  );
  let n = 0;
  for (const r of rows) {
    const claim = await query(`UPDATE customers SET last_reactivation_at = now() WHERE id = $1::bigint AND (last_reactivation_at IS NULL OR last_reactivation_at < now() - interval '120 days') RETURNING id`, [r.id]);
    if (!claim.length) continue;
    const qs = new URLSearchParams({ servicio: r.slug, utm_source: "reactivation", utm_medium: "msg" });
    if (r.pro) qs.set("pro", String(r.pro));
    const link = `${siteUrl()}/reservar?${qs}`;
    if (await notifyReactivation({ name: r.name, phone: r.phone, email: r.email, service: r.service, weeks: r.weeks, link, optout: optoutUrl(r.id) })) n++;
  }
  return n;
}

/** Retención de datos, una vez al día: lo que prometen la política de privacidad y el aviso legal. */
export async function runRetention(): Promise<boolean> {
  const today = todayIn(CONFIG.tz);
  if ((await setting("last_retention", "")) === today) return false;
  await query(`INSERT INTO settings (key, value) VALUES ('last_retention', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [today]);
  // Fichas sin actividad en 3 años: se anonimizan (el historial de citas queda sin datos personales)
  const old = await query<{ id: number }>(
    `SELECT c.id FROM customers c
     WHERE c.phone_key NOT LIKE 'anon-%' AND c.created_at < now() - interval '3 years'
       AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id = c.id AND b.starts_at > now() - interval '3 years')`,
  );
  for (const { id } of old) {
    await query(`UPDATE bookings SET customer_name = NULL, customer_phone = NULL, customer_email = NULL, notes = NULL WHERE customer_id = $1::bigint`, [id]);
    await query(`UPDATE customers SET name = 'Clienta anonimizada', phone = '', email = NULL, notes = NULL, phone_key = 'anon-' || id::text, referral_code = NULL WHERE id = $1::bigint`, [id]);
  }
  await query(`DELETE FROM leads WHERE created_at < now() - interval '90 days'`);
  await query(`DELETE FROM notification_log WHERE created_at < now() - interval '12 months'`);
  await query(`DELETE FROM funnel_events WHERE created_at < now() - interval '25 months'`);
  await query(`DELETE FROM phone_otps WHERE created_at < now() - interval '7 days'`);
  await query(`DELETE FROM audit_log WHERE at < now() - interval '24 months'`);
  await query(`DELETE FROM bookings WHERE status = 'EXPIRED' AND created_at < now() - interval '2 days'`);
  await purgeRateHits();
  return true;
}


const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);

/**
 * Resumen diario de reservas nuevas: a la hora que elijas en Ajustes (21:00 por defecto) le llega a la dueña, por Telegram,
 * email, SMS al teléfono de contacto y en la bandeja del panel, lo que ha entrado (y se ha cancelado) desde el último resumen.
 * Una sola vez al día; si no ha pasado nada, no molesta.
 */
export async function runNewBookingsDigest(): Promise<boolean> {
  if ((await setting("digest_enabled", "on")) !== "on") return false;
  const hour = Number(await setting("digest_hour", "21"));
  const today = todayIn(CONFIG.tz);
  if (localHour() < (Number.isFinite(hour) ? hour : 21)) return false;
  if ((await setting("last_digest", "")) === today) return false;
  const since = (await setting("last_digest_at", "")) || new Date(Date.now() - 24 * 3600_000).toISOString();
  // se «reserva» el día antes de enviar: si el cron se solapa, no sale dos veces
  const claim = await query(
    `INSERT INTO settings (key, value) VALUES ('last_digest', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value WHERE settings.value <> EXCLUDED.value RETURNING key`,
    [today],
  );
  if (!claim.length) return false;
  await query(`INSERT INTO settings (key, value) VALUES ('last_digest_at', now()::text) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);

  const fresh = await query<{ when: string; who: string | null; phone: string | null; service: string; cents: number; src: string }>(
    `SELECT to_char(b.starts_at AT TIME ZONE $2::text, 'DD/MM HH24:MI') AS "when", b.customer_name AS who, b.customer_phone AS phone,
            COALESCE((SELECT string_agg(bs.name, ' + ' ORDER BY bs.position) FROM booking_services bs WHERE bs.booking_id = b.id), s.name) AS service,
            COALESCE((SELECT SUM(bs.price_cents)::int FROM booking_services bs WHERE bs.booking_id = b.id), s.price_cents) AS cents, b.source AS src
     FROM bookings b JOIN services s ON s.id = b.service_id
     WHERE b.status = 'CONFIRMED' AND b.confirmed_at > $1::timestamptz AND b.customer_phone NOT LIKE '699000%'
     ORDER BY b.starts_at`,
    [since, CONFIG.tz],
  );
  const cancelled = await query<{ n: number }>(`SELECT count(*)::int AS n FROM bookings WHERE status = 'CANCELLED' AND cancelled_at > $1::timestamptz AND confirmed_at IS NOT NULL`, [since]);
  const nCancel = cancelled[0]?.n ?? 0;
  if (!fresh.length && !nCancel) return false;

  const total = fresh.reduce((a, r) => a + r.cents, 0);
  const lines = fresh.slice(0, 12).map((r) => `• ${esc(r.when)} · ${esc(r.service)} · ${esc(r.who ?? "")}${r.phone ? ` (${esc(r.phone)})` : ""}${r.src === "admin" ? " · manual" : ""}`);
  if (fresh.length > 12) lines.push(`… y ${fresh.length - 12} más`);
  const html =
    `📥 <b>Reservas nuevas de hoy: ${fresh.length}</b>${fresh.length ? ` · ${esc(fmtPrice(total))}` : ""}` +
    (lines.length ? `\n${lines.join("\n")}` : "") +
    (nCancel ? `\n❌ Canceladas: ${nCancel}` : "") +
    `\n${siteUrl()}/admin`;
  await notifyOwnerDigest(html, `Reservas nuevas de hoy: ${fresh.length}${nCancel ? ` · ${nCancel} canceladas` : ""}`);
  return true;
}

/** Todo junto, tolerante a fallos: una tarea que falle no impide las demás. */
export async function runLifecycle(daytime: boolean): Promise<{ expired: number; revived: number; autoShowed: number; recovered: number; reactivated: number; retention: boolean; digest: boolean }> {
  const out = { expired: 0, revived: 0, autoShowed: 0, recovered: 0, reactivated: 0, retention: false, digest: false };
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      console.error(`[lifecycle:${name}]`, e);
    }
  };
  await step("holds", async () => void (out.expired = await expireHolds()));
  await step("waitlist", async () => void (out.revived = await reviveWaitlist()));
  await step("auto-showed", async () => void (out.autoShowed = await runAutoShowed()));
  if (daytime) {
    await step("abandon", async () => void (out.recovered = await runAbandonRecovery()));
    await step("reactivation", async () => void (out.reactivated = await runReactivation()));
  }
  await step("digest", async () => void (out.digest = await runNewBookingsDigest()));
  await step("retention", async () => void (out.retention = await runRetention()));
  return out;
}
