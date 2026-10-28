import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ldString } from "@/components/JsonLd";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { CONFIG } from "@/lib/config";
import { fmtPrice } from "@/lib/format";
import { aboutService, durationText, getSeoService, reserveHref } from "@/lib/seoServices";
import { siteUrl } from "@/lib/site";

// Se renderiza al pedirla (la compilación no necesita base de datos); la caché de CDN la da el propio encabezado
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const found = await getSeoService(slug);
  if (!found) return { title: "Servicio no encontrado", robots: { index: false } };
  const { service: s } = found;
  const title = `${s.name} en ${CONFIG.salon.city}`;
  const description = `${aboutService(s)} Duración ${durationText(s.durationMin)}, desde ${fmtPrice(s.priceCents)}. Reserva online en ${CONFIG.salon.name}.`.slice(0, 300);
  return {
    title,
    description,
    alternates: { canonical: `/servicios/${s.slug}` },
    openGraph: { type: "website", title: `${title} · ${CONFIG.salon.name}`, description, url: `/servicios/${s.slug}`, images: [{ url: "/og.jpg", width: 1200, height: 630 }] },
  };
}

export default async function ServicioPage({ params }: Params) {
  const { slug } = await params;
  const found = await getSeoService(slug);
  if (!found) notFound();
  const { service: s, related } = found;
  const { salon } = CONFIG;
  const base = siteUrl();
  const cancelH = s.cancelHours ?? CONFIG.cancelNoticeHours;

  const faqs: { q: string; a: string }[] = [
    { q: `¿Cuánto dura ${s.name.toLowerCase()}?`, a: `Dura aproximadamente ${durationText(s.durationMin)}. Al reservar, el hueco se bloquea entero para ti.` },
    { q: `¿Cuánto cuesta ${s.name.toLowerCase()}?`, a: `Desde ${fmtPrice(s.priceCents)}. El precio final se confirma en el centro si el servicio depende de una valoración previa.` },
    ...(s.depositCents > 0 ? [{ q: "¿Hay que pagar una señal?", a: `Sí, ${fmtPrice(s.depositCents)} al reservar, que se descuentan del precio final. Se devuelve si cancelas con ${cancelH} horas o más de antelación.` }] : []),
    { q: "¿Puedo cancelar o cambiar la hora?", a: `Sí, desde el enlace de tu cita. Para no perder la señal (si la hay), avísanos con ${cancelH} horas de antelación; el cambio de hora online es posible hasta ${Number(process.env.RESCHEDULE_NOTICE_HOURS ?? 12)} horas antes.` },
    ...(s.rebookWeeks ? [{ q: "¿Cada cuánto tiempo se repite?", a: `Lo habitual es repetirlo cada ${s.rebookWeeks} ${s.rebookWeeks === 1 ? "semana" : "semanas"}. Te avisamos cuando toca.` }] : []),
    { q: "¿Dónde estáis?", a: `${salon.name}, ${salon.address}. Teléfonos ${salon.phoneFixed} y ${salon.phoneMobile}.` },
  ];

  const url = `${base}/servicios/${s.slug}`;
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: s.name,
      serviceType: s.category,
      description: aboutService(s),
      url,
      areaServed: salon.city,
      provider: { "@type": "BeautySalon", "@id": `${base}/#salon`, name: salon.name },
      offers: { "@type": "Offer", priceCurrency: "EUR", price: (s.priceCents / 100).toFixed(2), url: `${base}${reserveHref(s.slug)}`, availability: "https://schema.org/InStock" },
    },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Inicio", item: base },
        { "@type": "ListItem", position: 2, name: "Servicios", item: `${base}/servicios` },
        { "@type": "ListItem", position: 3, name: s.name, item: url },
      ],
    },
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldString(ld) }} />
      <SiteHeader />
      <main className="container seo">
        <nav className="seo__crumbs" aria-label="Ruta">
          <Link href="/">Inicio</Link> › <Link href="/servicios">Servicios</Link> › <span>{s.name}</span>
        </nav>
        <p className="seo__kicker">{s.category}</p>
        <h1 className="seo__title">{s.name} en {salon.city}</h1>
        <p className="seo__lead">{aboutService(s)}</p>

        <dl className="seo__facts">
          <div><dt>Duración</dt><dd>{durationText(s.durationMin)}</dd></div>
          <div><dt>Precio</dt><dd>desde {fmtPrice(s.priceCents)}</dd></div>
          {s.depositCents > 0 && <div><dt>Señal</dt><dd>{fmtPrice(s.depositCents)}</dd></div>}
        </dl>

        <div className="seo__cta">
          <Link href={reserveHref(s.slug)} className="btn btn--primary btn--lg">Reservar {s.name.toLowerCase()}</Link>
          <span className="seo__muted">Huecos libres en tiempo real · cancelas desde tu enlace</span>
        </div>

        {s.aftercare && (
          <section className="seo__group">
            <h2 className="seo__h2">Cuidados después del tratamiento</h2>
            <p>{s.aftercare}</p>
          </section>
        )}

        <section className="seo__group">
          <h2 className="seo__h2">Preguntas frecuentes</h2>
          <div className="seo__faq">
            {faqs.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {related.length > 0 && (
          <section className="seo__group">
            <h2 className="seo__h2">Otros servicios de {s.category.toLowerCase()}</h2>
            <ul className="seo__cards">
              {related.map((r) => (
                <li key={r.id} className="seo__card">
                  <Link href={`/servicios/${r.slug}`} className="seo__card-main">
                    <strong>{r.name}</strong>
                    <span className="seo__muted">{durationText(r.durationMin)} · {fmtPrice(r.priceCents)}</span>
                  </Link>
                  <Link href={reserveHref(r.slug)} className="btn btn--ghost btn--sm">Reservar</Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
