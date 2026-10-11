import type { Metadata } from "next";
import Link from "next/link";
import AdminNav from "@/components/AdminNav";
import { isAdmin } from "@/lib/auth";
import { CONFIG } from "@/lib/config";
import { query } from "@/lib/db";
import { waLink } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Valoraciones", robots: { index: false, follow: false } };

type Row = { id: number; rating: number; comment: string | null; google_clicked: boolean; at: string; booking_id: string; name: string | null; phone: string | null; service: string };

export default async function ReviewsPage() {
  if (!(await isAdmin())) {
    return (
      <main className="container narrow admin">
        <section className="panel"><Link className="btn btn--primary" href="/admin">Entrar en la agenda</Link></section>
      </main>
    );
  }
  const rows = await query<Row>(
    `SELECT r.id, r.rating, r.comment, r.google_clicked, to_char(r.created_at AT TIME ZONE $1::text, 'DD/MM/YYYY') AS at, b.id AS booking_id, b.customer_name AS name, b.customer_phone AS phone,
            COALESCE((SELECT string_agg(bs.name, ' + ' ORDER BY bs.position) FROM booking_services bs WHERE bs.booking_id = b.id), s.name) AS service
     FROM reviews r JOIN bookings b ON b.id = r.booking_id JOIN services s ON s.id = b.service_id
     ORDER BY r.created_at DESC LIMIT 100`,
    [CONFIG.tz],
  ).catch(() => [] as Row[]);
  const avg = rows.length ? rows.reduce((a, r) => a + r.rating, 0) / rows.length : 0;
  const low = rows.filter((r) => r.rating <= 3).length;
  const google = rows.filter((r) => r.google_clicked).length;
  return (
    <main className="container admin">
      <AdminNav active="valoraciones" />
      <h1 className="admin__h1">Valoraciones</h1>
      <p className="muted">
        {rows.length ? `${rows.length} valoraciones · media ${avg.toFixed(1).replace(".", ",")} ★ · ${low} por debajo de 4 · ${google} han ido a dejarla en Google` : "Todavía no hay valoraciones. Llegan solas cuando marcas «Vino» y la clienta contesta al mensaje de después de la visita."}
      </p>
      <ul className="rev-list">
        {rows.map((r) => (
          <li key={r.id} className={`rev-item ${r.rating <= 3 ? "rev-item--low" : ""}`}>
            <p className="rev-item__top">
              <span className="rev-item__stars" aria-label={`${r.rating} de 5`}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
              <Link href={`/admin/cita/${r.booking_id}`}>{r.name ?? "Clienta"}</Link> · {r.service} · {r.at}
              {r.google_clicked && <span className="badge badge--ok">Fue a Google</span>}
            </p>
            {r.comment && <p className="rev-item__c">«{r.comment}»</p>}
            {r.rating <= 3 && r.phone && <p><a className="btn btn--ghost btn--sm" href={`tel:${r.phone}`}>Llamar</a> <a className="btn btn--ghost btn--sm" href={waLink(r.phone)} target="_blank" rel="noopener noreferrer">WhatsApp</a></p>}
          </li>
        ))}
      </ul>
    </main>
  );
}
