import { query } from "./db";
import { enabled, logSend, sendSms } from "./messaging";
import { notifyOwnerRaw } from "./notify";

type Row = { id: number; booking_id: string | null; kind: string; fallback_sms: string; fallback_phone: string };

const KIND_LABEL: Record<string, string> = {
  created: "la confirmación",
  reminder: "el recordatorio",
  rescheduled: "el cambio de hora",
  waitlist: "el aviso de hueco libre",
};

/** Envía el SMS de respaldo de un WhatsApp que no llegó; si no hay SMS configurado, avisa a la dueña. */
async function sendFallback(row: Row, why: string): Promise<"sms" | "alert"> {
  if (enabled.sms()) {
    const r = await sendSms(row.fallback_phone, row.fallback_sms);
    await logSend(row.booking_id, row.kind, "sms", r);
    if (r.ok) return "sms";
  }
  await notifyOwnerRaw(
    `📵 El WhatsApp con ${KIND_LABEL[row.kind] ?? "un aviso"} no llegó a <b>${row.fallback_phone}</b> (${why}). Llámala o escríbele tú.`,
    "WhatsApp no entregado",
    row.booking_id,
  );
  return "alert";
}

/** WhatsApp enviados hace más de 15 min que siguen sin constar como entregados → SMS de respaldo. */
export async function runDeliveryFallback(): Promise<{ sms: number; alerted: number }> {
  const out = { sms: 0, alerted: 0 };
  const due = await query<Row>(
    `UPDATE notification_log SET fallback_done_at = now()
     WHERE id IN (
       SELECT id FROM notification_log
       WHERE channel = 'whatsapp' AND status = 'SENT' AND delivery_status = 'sent'
         AND created_at < now() - interval '15 minutes' AND created_at > now() - interval '12 hours'
         AND fallback_sms IS NOT NULL AND fallback_done_at IS NULL
       ORDER BY created_at LIMIT 30 FOR UPDATE SKIP LOCKED
     )
     RETURNING id, booking_id, kind, fallback_sms, fallback_phone`,
  );
  for (const row of due) {
    const r = await sendFallback(row, "sin confirmación de entrega");
    if (r === "sms") out.sms++;
    else out.alerted++;
  }
  return out;
}

/** Meta avisa de que un WhatsApp ha fallado: respaldo inmediato. */
export async function fallbackByProviderId(providerId: string, why: string): Promise<void> {
  const rows = await query<Row>(
    `UPDATE notification_log SET fallback_done_at = now()
     WHERE provider_id = $1 AND channel = 'whatsapp' AND fallback_sms IS NOT NULL AND fallback_done_at IS NULL
     RETURNING id, booking_id, kind, fallback_sms, fallback_phone`,
    [providerId],
  );
  for (const row of rows) await sendFallback(row, why);
}
