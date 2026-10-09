import Link from "next/link";
import { ArrowRight, Clock, Instagram, MapPin, MessageCircle, Phone } from "lucide-react";
import ScrollHero from "@/components/ScrollHero";
import SiteHeader from "@/components/SiteHeader";
import { CONFIG } from "@/lib/config";
import { query } from "@/lib/db";
import { fmtDuration, fmtPrice, WEEKDAYS } from "@/lib/format";

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

  const groups: { category: string; items: ServiceRow[] }[] = [];
  for (const s of services) {
    let g = groups.find((x) => x.category === s.category);
    if (!g) groups.push((g = { category: s.category, items: [] }));
    g.items.push(s);
  }
  const hours = groupHours(hoursRows);
  const { salon } = CONFIG;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(salon.address)}`;

  return (
    <>
      <SiteHeader />
      <main>
        <ScrollHero />

        <section id="servicios" className="section">
          <div className="container">
            <h2 className="section__title">Servicios y precios</h2>
            <p className="section__lead">
              Pulsa en cualquier servicio para ver los huecos libres. También tenemos tienda de productos de peluquería.
            </p>
            {groups.map((g) => (
              <div key={g.category} className="menu">
                <h3 className="menu__cat">{g.category}</h3>
                <ul>
                  {g.items.map((s) => (
                    <li key={s.id} className="menu__row">
                      <div className="menu__name">
                        <h4>{s.name}</h4>
                        {s.description && <p>{s.description}</p>}
                      </div>
                      <span className="menu__meta">{fmtDuration(s.durationMin)}</span>
                      <span className="menu__price">{fmtPrice(s.priceCents)}</span>
                      <Link className="menu__cta" href={`/reservar?servicio=${s.slug}`} aria-label={`Reservar ${s.name}`}>
                        Reservar <ArrowRight size={15} aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section id="donde" className="section section--tint">
          <div className="container where">
            <div>
              <h2 className="section__title">Dónde estamos</h2>
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
              <Link href="/reservar" className="btn btn--primary btn--lg">Reservar cita</Link>
            </div>
          </div>
        </section>
      </main>
      <footer className="footer">
        <div className="container">
          <p>© {new Date().getFullYear()} Pro Diva · Centro de estética y tienda de peluquería en Melide.</p>
        </div>
      </footer>
    </>
  );
}
