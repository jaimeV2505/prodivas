import { query } from "./db";

/** Cuidados posteriores de los servicios de una cita (el texto que escribes en /admin/ajustes). */
export async function aftercareFor(bookingId: string): Promise<string | null> {
  const rows = await query<{ aftercare: string }>(
    `SELECT s.aftercare FROM booking_services bs JOIN services s ON s.id = bs.service_id
     WHERE bs.booking_id = $1::uuid AND s.aftercare IS NOT NULL AND s.aftercare <> '' ORDER BY bs.position`,
    [bookingId],
  );
  const uniq = Array.from(new Set(rows.map((r) => r.aftercare)));
  return uniq.length ? uniq.join(" ") : null;
}
