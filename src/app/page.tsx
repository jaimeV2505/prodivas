import Link from "next/link";
import { preload } from "react-dom";
import { Clock, Instagram, MapPin, MessageCircle, Phone } from "lucide-react";
import HowItWorks from "@/components/HowItWorks";
import MobileCta from "@/components/MobileCta";
import Marquee from "@/components/Marquee";
import ReelWall from "@/components/ReelWall";
import RevealText from "@/components/RevealText";
import Hero from "@/components/Hero";
import ServiceReel, { type ReelGroup } from "@/components/ServiceReel";
import SiteHeader from "@/components/SiteHeader";
import TransitionLink from "@/components/TransitionLink";
import { CONFIG } from "@/lib/config";
import { HERO_PHOTO } from "@/lib/media";
import { todayIn } from "@/lib/dates";
import { siteUrl } from "@/lib/site";
import { query } from "@/lib/db";
import { WEEKDAYS } from "@/lib/format";

export const dynamic = "force-dynamic";

type ServiceRow = {
  id: number;
  slug: string;
  name: string;
  category: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
};
type HourRow = {
  weekday: number;
  closed: boolean;
  open_time: string | null;
  close_time: string | null;
  break_start: string | null;
  break_end: string | null;
};

const hm = (t: string | null) => (t ? t.slice(0, 5) : "");

function describeHours(h: HourRow): string {
  if (h.closed || !h.open_time || !h.close_time) return "Cerrado";
  if (h.break_start && h.break_end) {
    return `${hm(h.open_time)} a ${hm(h.break_start)} y ${hm(h.break_end)} a ${hm(h.close_time)}`;
  }
  return `${hm(h.open_time)} a ${hm(h.close_time)}`;
}

function groupHours(rows: HourRow[]): { label: string; hours: string }[] {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const byDay = new Map(rows.map((r) => [r.weekday, r]));
  const out: { days: number[]; hours: string }[] = [];
  for (const d of order) {
    const r = byDay.get(d);
    const hours = r ? describeHours(r) : "Cerrado";
    const last = out[out.length - 1];
    if (last && last.hours === hours) last.days.push(d);
    else out.push({ days: [d], hours });
  }
  return out.map((g) => ({
    label:
      g.days.length === 1
        ? WEEKDAYS[g.days[0]]
        : `${WEEKDAYS[g.days[0]]} a ${WEEKDAYS[g.days[g.days.length - 1]].toLowerCase()}`,
    hours: g.hours,
  }));
}

export default async function Home() {
  if (HERO_PHOTO) preload(HERO_PHOTO.src, { as: "image", fetchPriority: "high" }); // la foto de la portada se pide cuanto antes
  const [services, hoursRows] = await Promise.all([
    query<ServiceRow>(
      `SELECT id, slug, name, category, description, duration_min AS "durationMin", price_cents AS "priceCents"
       FROM services WHERE active ORDER BY sort, id`,
    ),
    query<HourRow>(
      `SELECT weekday, closed, open_time::text, close_time::text, break_start::text, break_end::text
       FROM business_hours ORDER BY weekday`,
    ),
  ]);

  // Servicios destacados del mini-asistente del hero: los dos primeros de cada categoría (máx. 6)
  const today = todayIn(CONFIG.tz);
  const perCat = new Map<string, number>();
  const featured = services
    .filter((x) => {
      const n = perCat.get(x.category) ?? 0;
      perCat.set(x.category, n + 1);
      return n < 2;
    })
    .slice(0, 6)
    .map((x) => ({ id: x.id, slug: x.slug, name: x.name, durationMin: x.durationMin, priceCents: x.priceCents }));

  const groups: ReelGroup[] = [];
  for (const s of services) {
    let g = groups.find((x) => x.category === s.category);
    if (!g) groups.push((g = { category: s.category, items: [] }));
    g.items.push({
      id: s.id,
      slug: s.slug,
      name: s.name,
      description: s.description,
      durationMin: s.durationMin,
      priceCents: s.priceCents,
    });
  }
  const marqueeItems = Array.from(new Set(services.map((s) => s.name))).slice(0, 8);
  const hours = groupHours(hoursRows);
  const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const openingHours = hoursRows
    .filter((h) => !h.closed && h.open_time && h.close_time)
    .flatMap((h) =>
      h.break_start && h.break_end
        ? [
            { "@type": "OpeningHoursSpecification", dayOfWeek: DAY[h.weekday], opens: hm(h.open_time), closes: hm(h.break_start) },
            { "@type": "OpeningHoursSpecification", dayOfWeek: DAY[h.weekday], opens: hm(h.break_end), closes: hm(h.close_time) },
          ]
        : [{ "@type": "OpeningHoursSpecification", dayOfWeek: DAY[h.weekday], opens: hm(h.open_time), closes: hm(h.close_time) }],
    );
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BeautySalon",
    name: "Pro Diva",
    url: siteUrl(),
    telephone: `+34${CONFIG.salon.phoneMobile.replace(/\s/g, "")}`,
    address: {
      "@type": "PostalAddress",
      streetAddress: "Rúa Rambla San Pablo, 6",
      postalCode: "15800",
      addressLocality: "Melide",
      addressRegion: "A Coruña",
      addressCountry: "ES",
    },
    sameAs: [`https://www.instagram.com/${CONFIG.salon.instagram}/`],
    openingHoursSpecification: openingHours,
  };
  const { salon } = CONFIG;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(salon.address)}`;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <SiteHeader />
      <main>
        <Hero services={featured} today={today} />
        <Marquee items={marqueeItems} />

        <section id="servicios" className="section section--tight">
          <div className="container">
            <RevealText as="h2" text="Servicios y precios" className="section__title" />
            <p className="section__lead">
              Pulsa cualquier servicio para ver los huecos libres. También tenemos tienda de productos de peluquería.
            </p>
          </div>
        </section>
        <ServiceReel groups={groups} />

        <section className="section">
          <HowItWorks holdMinutes={CONFIG.holdMinutes} />
        </section>

        <section className="section section--tint">
          <ReelWall instagram={salon.instagram} />
        </section>

        <section id="donde" className="section">
          <div className="container where">
            <div>
              <RevealText as="h2" text="Dónde estamos" className="section__title" />
              <address className="where__address">
                <p>
                  <MapPin size={18} aria-hidden="true" />
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer">{salon.address}</a>
                </p>
                <p>
                  <Phone size={18} aria-hidden="true" />
                  <a href={`tel:+34${salon.phoneFixed.replace(/\s/g, "")}`}>{salon.phoneFixed}</a>
                  <span> / </span>
                  <a href={`tel:+34${salon.phoneMobile.replace(/\s/g, "")}`}>{salon.phoneMobile}</a>
                </p>
                <p>
                  <MessageCircle size={18} aria-hidden="true" />
                  <a href={`https://wa.me/${salon.whatsapp}`} target="_blank" rel="noopener noreferrer">Escríbenos por WhatsApp</a>
                </p>
                <p>
                  <Instagram size={18} aria-hidden="true" />
                  <a href={`https://www.instagram.com/${salon.instagram}/`} target="_blank" rel="noopener noreferrer">@{salon.instagram}</a>
                </p>
              </address>
            </div>
            <div>
              <h2 className="section__title section__title--sm"><Clock size={20} aria-hidden="true" /> Horario</h2>
              <dl className="hours">
                {hours.map((h) => (
                  <div key={h.label} className="hours__row">
                    <dt>{h.label}</dt>
                    <dd>{h.hours}</dd>
                  </div>
                ))}
              </dl>
              <TransitionLink href="/reservar" className="btn btn--primary btn--lg">Reservar cita</TransitionLink>
            </div>
          </div>
        </section>
      </main>
      <footer className="footer">
        <div className="footer__word" aria-hidden="true">Pro Diva</div>
        <div className="container footer__in">
          <p>© {new Date().getFullYear()} Pro Diva. Centro de estética y tienda de peluquería en Melide.</p>
          <Link href="/reservar">Reservar cita</Link>
        </div>
      </footer>
      <MobileCta whatsapp={salon.whatsapp} />
    </>
  );
}
