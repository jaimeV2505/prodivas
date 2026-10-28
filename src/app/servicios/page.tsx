import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { CONFIG } from "@/lib/config";
import { fmtPrice } from "@/lib/format";
import { durationText, listSeoServices, reserveHref } from "@/lib/seoServices";

// Se renderiza al pedirla (la compilación no necesita base de datos); la caché de CDN la da el propio encabezado
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Servicios y precios en Melide",
  description: `Manicura, pedicura, pestañas, depilación con hilo y láser, microblading y más en ${CONFIG.salon.name} (${CONFIG.salon.city}). Precios claros y cita online.`,
  alternates: { canonical: "/servicios" },
};

export default async function ServiciosPage() {
  const services = await listSeoServices();
  const groups: { category: string; items: typeof services }[] = [];
  for (const s of services) {
    let g = groups.find((x) => x.category === s.category);
    if (!g) groups.push((g = { category: s.category, items: [] }));
    g.items.push(s);
  }
  return (
    <>
      <SiteHeader />
      <main className="container seo">
        <h1 className="seo__title">Servicios y precios en {CONFIG.salon.city}</h1>
        <p className="seo__lead">Elige tu servicio, mira los huecos libres en tiempo real y reserva con un toque. Sin llamadas ni esperas.</p>
        {groups.map((g) => (
          <section key={g.category} className="seo__group" aria-labelledby={`cat-${g.category}`}>
            <h2 id={`cat-${g.category}`} className="seo__h2">{g.category}</h2>
            <ul className="seo__cards">
              {g.items.map((s) => (
                <li key={s.id} className="seo__card">
                  <Link href={`/servicios/${s.slug}`} className="seo__card-main">
                    <strong>{s.name}</strong>
                    <span className="seo__muted">{durationText(s.durationMin)} · {fmtPrice(s.priceCents)}</span>
                  </Link>
                  <Link href={reserveHref(s.slug)} className="btn btn--primary btn--sm">Reservar</Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
      <SiteFooter />
    </>
  );
}
