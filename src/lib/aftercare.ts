import { query } from "./db";
import { AFTERCARE_I18N, LASER_AFTERCARE } from "./i18n/msg";
import type { Lang } from "./i18n";

/** Cuidados posteriores de los servicios de una cita, en el idioma de la clienta (o en castellano si no hay traducción). */
export async function aftercareFor(bookingId: string, lang: Lang): Promise<string | null> {
  const rows = await query<{ slug: string; aftercare: string }>(
    `SELECT s.slug, s.aftercare FROM booking_services bs JOIN services s ON s.id = bs.service_id
     WHERE bs.booking_id = $1::uuid AND s.aftercare IS NOT NULL AND s.aftercare <> '' ORDER BY bs.position`,
    [bookingId],
  );
  const texts = rows.map((r) => {
    if (lang === "es") return r.aftercare;
    if (r.slug.startsWith("laser-")) return LASER_AFTERCARE[lang];
    return AFTERCARE_I18N[r.slug]?.[lang] ?? r.aftercare;
  });
  const uniq = Array.from(new Set(texts));
  return uniq.length ? uniq.join(" ") : null;
}
