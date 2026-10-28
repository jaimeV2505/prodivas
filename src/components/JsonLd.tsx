import { CONFIG } from "@/lib/config";
import { query } from "@/lib/db";
import { siteUrl } from "@/lib/site";

type HourRow = { weekday: number; closed: boolean; open_time: string | null; close_time: string | null; break_start: string | null; break_end: string | null };

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hm = (t: string | null) => (t ? t.slice(0, 5) : "");

/** Escapa `<` para que el JSON nunca cierre la etiqueta <script>. */
export const ldString = (o: unknown) => JSON.stringify(o).replace(/</g, "\\u003c");

/**
 * Datos estructurados de la empresa (BeautySalon). Todo sale de la configuración y de la base de datos;
 * la valoración media solo aparece si hay al menos 5 valoraciones reales.
 */
export default async function JsonLd() {
  const { salon } = CONFIG;
  const [hours, services, rating] = await Promise.all([
    query<HourRow>(`SELECT weekday, closed, open_time::text, close_time::text, break_start::text, break_end::text FROM business_hours ORDER BY weekday`).catch(() => []),
    query<{ slug: string; name: string; description: string | null; price_cents: number }>(`SELECT slug, name, description, price_cents FROM services WHERE active ORDER BY sort, id LIMIT 40`).catch(() => []),
    query<{ n: number; avg: string | null }>(`SELECT count(*)::int AS n, round(avg(rating)::numeric, 1)::text AS avg FROM reviews`).catch(() => []),
  ]);

  const openingHoursSpecification = hours
    .filter((h) => !h.closed && h.open_time && h.close_time)
    .flatMap((h) =>
      h.break_start && h.break_end
        ? [
            { "@type": "OpeningHoursSpecification", dayOfWeek: DAY[h.weekday], opens: hm(h.open_time), closes: hm(h.break_start) },
            { "@type": "OpeningHoursSpecification", dayOfWeek: DAY[h.weekday], opens: hm(h.break_end), closes: hm(h.close_time) },
          ]
        : [{ "@type": "OpeningHoursSpecification", dayOfWeek: DAY[h.weekday], opens: hm(h.open_time), closes: hm(h.close_time) }],
    );

  const base = siteUrl();
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BeautySalon",
    "@id": `${base}/#salon`,
    name: salon.name,
    url: base,
    image: `${base}/og.jpg`,
    telephone: [`+34${salon.phoneMobile.replace(/\s/g, "")}`, `+34${salon.phoneFixed.replace(/\s/g, "")}`],
    address: {
      "@type": "PostalAddress",
      streetAddress: "Rúa Rambla San Pablo, 6",
      postalCode: "15800",
      addressLocality: salon.city,
      addressRegion: "A Coruña",
      addressCountry: "ES",
    },
    sameAs: [`https://www.instagram.com/${salon.instagram}/`],
    openingHoursSpecification,
    potentialAction: { "@type": "ReserveAction", target: { "@type": "EntryPoint", urlTemplate: `${base}/reservar?utm_source=google`, actionPlatform: ["http://schema.org/DesktopWebPlatform", "http://schema.org/MobileWebPlatform"] }, result: { "@type": "Reservation", name: "Reservar cita" } },
  };
  if (services.length) {
    ld.hasOfferCatalog = {
      "@type": "OfferCatalog",
      name: "Servicios",
      itemListElement: services.map((s) => ({
        "@type": "Offer",
        url: `${base}/servicios/${s.slug}`,
        priceCurrency: "EUR",
        price: (s.price_cents / 100).toFixed(2),
        itemOffered: { "@type": "Service", name: s.name, ...(s.description ? { description: s.description } : {}) },
      })),
    };
  }
  if (rating[0] && rating[0].n >= 5 && rating[0].avg) {
    ld.aggregateRating = { "@type": "AggregateRating", ratingValue: rating[0].avg, reviewCount: rating[0].n, bestRating: "5", worstRating: "1" };
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldString(ld) }} />;
}
