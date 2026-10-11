import { aftercareFor } from "./aftercare";
import { CONFIG } from "./config";
import { envNumber as num, EVENING_HOUR, inWindow, isQuiet, localHour, OPTIONAL_WINDOW } from "./quiet";
import { query } from "./db";
import { getSummaryById } from "./bookings";
import { notifyAftercare, notifyOwnerUnconfirmed, notifyRebookNudge, notifyReminder } from "./notify";
import { optoutUrl } from "./optout";
import { runDeliveryFallback } from "./fallback";
import { runDailySummary, runTomorrowSummary } from "./summary";
import { expireWaitlist } from "./waitlist";

export type RunResult = {
  reminded: number;
  evening: number;
  failed: number;
  alerted: number;
  smsFallback: number;
  summary: boolean;
  tomorrow: boolean;
  aftercare: number;
  nudges: number;
};

/**
 * Citas a las que toca el recordatorio de la VÍSPERA: a partir de las 19:00 del día anterior, siempre que la cita
 * se reservara antes de esa hora, no sea ya demasiado cercana (para que el recordatorio de unas horas antes no se
 * pise) y la clienta aún no haya confirmado. Es la misma condición para enviar y para las pruebas.
 */
const EVENING_WHERE = `
  b.status = 'CONFIRMED' AND b.reminder_prev_sent_at IS NULL AND b.reminder_prev_attempts < 3
  AND b.customer_response IS NULL
  AND b.starts_at > now() + make_interval(hours => $1::int)
  AND b.starts_at < now() + interval '40 hours'
  AND now() >= (((b.starts_at AT TIME ZONE $2::text)::date - 1) + make_time($3::int, 0, 0)) AT TIME ZONE $2::text
  AND b.confirmed_at < (((b.starts_at AT TIME ZONE $2::text)::date - 1) + make_time($3::int, 0, 0)) AT TIME ZONE $2::text`;
const eveningParams = () => [num("REMINDER_HOURS_BEFORE", 4) + 1, CONFIG.tz, EVENING_HOUR()];

/** Qué citas recibirían ahora el recordatorio de la víspera (sin enviar nada). Para pruebas y para el panel. */
export async function peekEvening(): Promise<string[]> {
  return (await query<{ id: string }>(`SELECT b.id FROM bookings b WHERE ${EVENING_WHERE} ORDER BY b.starts_at`, eveningParams())).map((r) => r.id);
}

/**
 * Se ejecuta cada ~10 min desde el cron.
 *  0) La víspera por la tarde: «mañana a las 10:00, ¿vienes?» con un toque para confirmar.
 *  1) Unas horas antes: recordatorio a quien no confirmó (si ya confirmó, no se le molesta). Si la víspera no contestó,
 *     el mensaje es «seguimos sin saber si vienes». Nunca en horas de silencio (por defecto, de 22:00 a 08:00).
 *  2) Una hora después, si sigue sin responder, avisa a la dueña para que la llame.
 *  3) WhatsApp que no llegó → SMS de respaldo; resúmenes de la dueña (mañana por la mañana y a las 18:00 el de mañana).
 *  4) Después de la visita: gracias + cuidados + valoración, y «toca retoque» (mensajes opcionales: respetan la baja).
 * Es seguro ejecutarlo varias veces seguidas: cada cita se «reserva» antes de enviarse y se intenta como máximo 3 veces.
 */
export async function runReminders(): Promise<RunResult> {
  const out: RunResult = { reminded: 0, evening: 0, failed: 0, alerted: 0, smsFallback: 0, summary: false, tomorrow: false, aftercare: 0, nudges: 0 };
  const quiet = isQuiet(localHour());

  // 0) La víspera
  if (!quiet) {
    const eve = await query<{ id: string }>(
      `UPDATE bookings SET reminder_prev_attempts = reminder_prev_attempts + 1
       WHERE id IN (SELECT b.id FROM bookings b WHERE ${EVENING_WHERE} ORDER BY b.starts_at LIMIT 50 FOR UPDATE OF b SKIP LOCKED)
       RETURNING id`,
      eveningParams(),
    );
    for (const { id } of eve) {
      const b = await getSummaryById(id);
      if (!b || b.status !== "CONFIRMED") continue;
      if (await notifyReminder(b, "evening")) {
        await query(`UPDATE bookings SET reminder_prev_sent_at = now() WHERE id = $1::uuid`, [id]);
        out.evening++;
      } else out.failed++;
    }
  }

  // 1) Unas horas antes (no a quien ya confirmó; no en horas de silencio)
  if (!quiet) {
    const due = await query<{ id: string; prev: boolean }>(
      `UPDATE bookings SET reminder_attempts = reminder_attempts + 1, remind_at = now() + interval '15 minutes'
       WHERE id IN (
         SELECT id FROM bookings
         WHERE status = 'CONFIRMED' AND remind_at IS NOT NULL AND remind_at <= now()
           AND reminder_sent_at IS NULL AND reminder_attempts < 3
           AND customer_response IS DISTINCT FROM 'CONFIRMED'
           AND starts_at > now() + interval '30 minutes'
         ORDER BY remind_at LIMIT 50
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, (reminder_prev_sent_at IS NOT NULL) AS prev`,
    );
    for (const { id, prev } of due) {
      const b = await getSummaryById(id);
      if (!b || b.status !== "CONFIRMED") continue;
      if (await notifyReminder(b, prev ? "second" : "final")) {
        await query(`UPDATE bookings SET reminder_sent_at = now() WHERE id = $1::uuid`, [id]);
        out.reminded++;
      } else out.failed++; // se reintentará en el próximo ciclo (hasta 3 veces)
    }
  }

  // 2) Sin respuesta tras el recordatorio → avisar a la dueña (una sola vez)
  const silent = await query<{ id: string }>(
    `UPDATE bookings SET owner_alerted_at = now()
     WHERE id IN (
       SELECT id FROM bookings
       WHERE status = 'CONFIRMED' AND reminder_sent_at IS NOT NULL AND reminder_sent_at <= now() - interval '60 minutes'
         AND customer_response IS NULL AND owner_alerted_at IS NULL AND starts_at > now()
       LIMIT 50 FOR UPDATE SKIP LOCKED
     )
     RETURNING id`,
  );
  for (const { id } of silent) {
    const b = await getSummaryById(id);
    if (b) {
      await notifyOwnerUnconfirmed(b);
      out.alerted++;
    }
  }

  // 3) WhatsApp que no llegó → SMS de respaldo
  const fb = await runDeliveryFallback();
  out.smsFallback = fb.sms;
  out.alerted += fb.alerted;

  // 4) Resúmenes de la dueña y limpieza
  try {
    out.summary = await runDailySummary();
    out.tomorrow = await runTomorrowSummary();
  } catch (e) {
    console.error("[summary]", e);
  }

  // 5) Después de la visita (solo de día; mensajes opcionales)
  const h = localHour();
  if (inWindow(h, OPTIONAL_WINDOW.from(), OPTIONAL_WINDOW.to())) {
    try {
      out.aftercare = await runAftercare();
      out.nudges = await runRebookNudges();
    } catch (e) {
      console.error("[aftercare]", e);
    }
  }
  await expireWaitlist();
  return out;
}

/** Gracias + cuidados + «¿qué tal ha ido?» a quien vino (la dueña marca «Vino»), 2 h después de acabar. Una sola vez. */
export async function runAftercare(): Promise<number> {
  const claimed = await query<{ id: string }>(
    `UPDATE bookings SET aftercare_sent_at = now()
     WHERE id IN (
       SELECT b.id FROM bookings b JOIN customers c ON c.id = b.customer_id
       WHERE b.status = 'CONFIRMED' AND b.attendance = 'SHOWED' AND b.aftercare_sent_at IS NULL
         AND b.ends_at <= now() - interval '2 hours' AND b.ends_at > now() - interval '3 days'
         AND c.optout_at IS NULL
       ORDER BY b.ends_at LIMIT 30 FOR UPDATE OF b SKIP LOCKED
     ) RETURNING id`,
  );
  let n = 0;
  for (const { id } of claimed) {
    const b = await getSummaryById(id);
    if (!b || b.customerId == null) continue;
    if (await notifyAftercare(b, await aftercareFor(id), optoutUrl(b.customerId))) n++;
  }
  return n;
}

/** «Toca retoque»: una semana antes de que se cumplan las semanas del servicio, si no tiene ya otra cita. Una sola vez. */
export async function runRebookNudges(): Promise<number> {
  const rows = await query<{ id: string; slug: string; name: string; weeks: number }>(
    `SELECT DISTINCT ON (b.id) b.id, s.slug, s.name, s.rebook_weeks AS weeks
     FROM bookings b
     JOIN booking_services bs ON bs.booking_id = b.id JOIN services s ON s.id = bs.service_id
     JOIN customers c ON c.id = b.customer_id
     WHERE b.status = 'CONFIRMED' AND b.attendance = 'SHOWED' AND b.rebook_nudge_sent_at IS NULL
       AND s.rebook_weeks >= 2 AND c.optout_at IS NULL
       AND b.starts_at + make_interval(days => s.rebook_weeks * 7 - 7) <= now()
       AND b.starts_at + make_interval(days => s.rebook_weeks * 7) > now()
       AND NOT EXISTS (SELECT 1 FROM bookings f WHERE f.customer_id = b.customer_id AND f.status = 'CONFIRMED' AND f.starts_at > now())
     ORDER BY b.id, s.rebook_weeks LIMIT 30`,
  );
  let n = 0;
  for (const r of rows) {
    const claim = await query<{ id: string }>(`UPDATE bookings SET rebook_nudge_sent_at = now() WHERE id = $1::uuid AND rebook_nudge_sent_at IS NULL RETURNING id`, [r.id]);
    if (!claim.length) continue;
    const b = await getSummaryById(r.id);
    if (!b || b.customerId == null) continue;
    if (await notifyRebookNudge(b, r.name, r.weeks, optoutUrl(b.customerId))) n++;
  }
  return n;
}
