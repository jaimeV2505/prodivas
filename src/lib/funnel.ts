import { query } from "./db";
import { phoneDigits } from "./site";

export type Attr = { sid?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string; ref?: string; flow?: string };

const clip = (v: unknown, n: number) => (typeof v === "string" && v ? v.slice(0, n) : null);

/** Guarda de dónde vino la reserva (sesión anónima + UTM) y apunta el paso «confirmada» del embudo. */
export async function recordConfirmed(bookingIds: string[], attr: Attr | undefined, services: string): Promise<void> {
  try {
    if (!bookingIds.length) return;
    await query(
      `UPDATE bookings SET session_id = $2, utm_source = $3, utm_medium = $4, utm_campaign = $5, referral_code = $6 WHERE id = ANY($1::uuid[])`,
      [bookingIds, clip(attr?.sid, 40), clip(attr?.utm_source, 60), clip(attr?.utm_medium, 60), clip(attr?.utm_campaign, 60), clip(attr?.ref, 12)],
    );
    if (attr?.sid) {
      await query(
        `INSERT INTO funnel_events (session_id, event, flow, service_slugs, utm_source, utm_medium, utm_campaign)
         SELECT $1, 'confirmed', $2, $3, $4, $5, $6
         WHERE NOT EXISTS (SELECT 1 FROM funnel_events WHERE session_id = $1 AND event = 'confirmed' AND created_at > now() - interval '5 minutes')`,
        [attr.sid.slice(0, 40), clip(attr.flow, 8), clip(services, 200), clip(attr.utm_source, 60), clip(attr.utm_medium, 60), clip(attr.utm_campaign, 60)],
      );
    }
  } catch (e) {
    console.error("[funnel]", e);
  }
}

/** Quien reserva ya no es un contacto «pendiente»: sus abandonos pasan a recuperados. */
export async function markLeadsBooked(phone: string | null): Promise<void> {
  if (!phone) return;
  try {
    await query(`UPDATE leads SET status = 'BOOKED', updated_at = now() WHERE phone_key = $1 AND status IN ('NEW','MESSAGED')`, [phoneDigits(phone).slice(-9)]);
  } catch (e) {
    console.error("[leads]", e);
  }
}
