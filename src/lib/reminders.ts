import { query } from "./db";
import { getSummaryById } from "./bookings";
import { notifyOwnerUnconfirmed, notifyReminder } from "./notify";
import { runDeliveryFallback } from "./fallback";
import { runDailySummary } from "./summary";
import { expireWaitlist } from "./waitlist";

export type RunResult = { reminded: number; failed: number; alerted: number; smsFallback: number; summary: boolean };

/**
 * Se ejecuta cada ~10 min desde el cron.
 *  1) Envía los recordatorios vencidos (remind_at <= ahora) con "Confirmar / Cancelar".
 *  2) Una hora después, si la clienta no ha respondido, avisa a la dueña para que la llame.
 * Es seguro ejecutarlo varias veces seguidas: cada cita se "reserva" 15 min antes de enviarse,
 * y como máximo se intenta 3 veces.
 */
export async function runReminders(): Promise<RunResult> {
  const out: RunResult = { reminded: 0, failed: 0, alerted: 0, smsFallback: 0, summary: false };

  // 1) Recordatorios: reclamamos las citas (lease de 15 min) y enviamos
  const due = await query<{ id: string }>(
    `UPDATE bookings SET reminder_attempts = reminder_attempts + 1, remind_at = now() + interval '15 minutes'
     WHERE id IN (
       SELECT id FROM bookings
       WHERE status = 'CONFIRMED' AND remind_at IS NOT NULL AND remind_at <= now()
         AND reminder_sent_at IS NULL AND reminder_attempts < 3
         AND starts_at > now() + interval '30 minutes'
       ORDER BY remind_at LIMIT 50
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id`,
  );
  for (const { id } of due) {
    const b = await getSummaryById(id);
    if (!b || b.status !== "CONFIRMED") continue;
    const ok = await notifyReminder(b);
    if (ok) {
      await query(`UPDATE bookings SET reminder_sent_at = now() WHERE id = $1::uuid`, [id]);
      out.reminded++;
    } else {
      out.failed++; // se reintentará en el próximo ciclo (hasta 3 veces)
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

  // 4) Resumen diario para la dueña y limpieza
  try {
    out.summary = await runDailySummary();
  } catch (e) {
    console.error("[summary]", e);
  }
  await expireWaitlist();
  return out;
}
