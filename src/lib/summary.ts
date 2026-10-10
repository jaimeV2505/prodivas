import { getCapacity } from "./availability";
import { CONFIG } from "./config";
import { todayIn } from "./dates";
import { query } from "./db";
import { enabled } from "./messaging";
import { notifyOwnerRaw } from "./notify";

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);

/** Resumen del día para la dueña (Telegram/email), una vez al día a partir de SUMMARY_TIME (08:30 por defecto). */
export async function runDailySummary(): Promise<boolean> {
  if (!enabled.telegram() && !(process.env.OWNER_EMAIL && enabled.email())) return false;

  const [hh, mm] = (process.env.SUMMARY_TIME ?? "08:30").split(":").map(Number);
  const nowParts = new Intl.DateTimeFormat("en-GB", { timeZone: CONFIG.tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const nowMin = Number(nowParts.find((p) => p.type === "hour")!.value) * 60 + Number(nowParts.find((p) => p.type === "minute")!.value);
  if (nowMin < hh * 60 + mm) return false;

  const today = todayIn(CONFIG.tz);
  // Reclama el día de forma atómica: aunque el cron se solape, el resumen sale una sola vez
  const claimed = await query(
    `INSERT INTO settings (key, value) VALUES ('last_summary_day', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value WHERE settings.value <> EXCLUDED.value RETURNING value`,
    [today],
  );
  if (!claimed.length) return false;

  const open = await query<{ closed: boolean }>(
    `SELECT closed FROM business_hours WHERE weekday = EXTRACT(DOW FROM $1::date)::int`,
    [today],
  );
  if (!open[0] || open[0].closed) return true; // día cerrado: no se molesta

  const bookings = await query<{ t: string; service: string; name: string; response: string | null; deposit: string }>(
    `SELECT to_char(b.starts_at AT TIME ZONE $2::text, 'HH24:MI') AS t,
            COALESCE((SELECT string_agg(bs.name, ' + ' ORDER BY bs.position) FROM booking_services bs WHERE bs.booking_id = b.id), s.name) AS service,
            COALESCE(b.customer_name, '') AS name, b.customer_response AS response, b.deposit_status AS deposit
     FROM bookings b JOIN services s ON s.id = b.service_id
     WHERE b.status = 'CONFIRMED' AND (b.starts_at AT TIME ZONE $2::text)::date = $1::date
     ORDER BY b.starts_at`,
    [today, CONFIG.tz],
  );
  const shortest = (await query<{ id: number; name: string; duration_min: number; buffer_min: number }>(
    `SELECT id, name, duration_min, buffer_min FROM services WHERE active ORDER BY duration_min LIMIT 1`,
  ))[0];
  const capacity = shortest
    ? await getCapacity({ from: today, to: today, durationMin: shortest.duration_min, bufferMin: shortest.buffer_min })
    : 0;
  const waiting = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM waitlist WHERE status = 'ACTIVE' AND (day = $1::date OR day IS NULL)`, [today]))[0].n;
  const calls = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM callbacks WHERE status = 'NEW'`))[0].n;

  const unconfirmed = bookings.filter((b) => b.response !== "CONFIRMED").length;
  const lines = [
    `☀️ <b>Hoy en Pro Diva</b>`,
    bookings.length
      ? `${bookings.length} ${bookings.length === 1 ? "cita" : "citas"}, ${unconfirmed} sin confirmar todavía`
      : `Hoy no hay citas reservadas`,
    ...bookings.map((b) => `${b.t}  ${esc(b.service)} · ${esc(b.name)}${b.response === "CONFIRMED" ? " ✅" : ""}${b.deposit === "PAID" ? " 💳" : ""}`),
    shortest ? `\nQuedan unas ${capacity} citas de ${esc(shortest.name.toLowerCase())} libres hoy.` : "",
    waiting ? `📝 ${waiting} en lista de espera.` : "",
    calls ? `📞 ${calls} ${calls === 1 ? "persona quiere" : "personas quieren"} que las llames.` : "",
  ].filter(Boolean);
  await notifyOwnerRaw(lines.join("\n"), `Resumen de hoy: ${bookings.length} citas`);
  return true;
}
