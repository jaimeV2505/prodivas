import type { Metadata } from "next";
import Link from "next/link";
import AdminNav from "@/components/AdminNav";
import { isAdmin } from "@/lib/auth";
import { CONFIG } from "@/lib/config";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clientas", robots: { index: false, follow: false } };

type Row = { id: number; name: string; phone: string; no_show_count: number; visit_count: number; total: number; last: string | null };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; f?: string }> }) {
  const sp = await searchParams;
  if (!(await isAdmin())) {
    return (
      <main className="container narrow admin">
        <section className="panel"><Link className="btn btn--primary" href="/admin">Entrar en la agenda</Link></section>
      </main>
    );
  }
  const q = (sp.q ?? "").trim().slice(0, 60);
  const rows = await query<Row>(
    `SELECT c.id, c.name, c.phone, c.no_show_count, c.visit_count,
            (SELECT count(*)::int FROM bookings b WHERE b.customer_id = c.id AND b.status = 'CONFIRMED') AS total,
            (SELECT to_char(max(b.starts_at) AT TIME ZONE $1::text, 'DD/MM/YYYY') FROM bookings b WHERE b.customer_id = c.id AND b.status = 'CONFIRMED') AS last
     FROM customers c
     WHERE ($2 = '' OR c.name ILIKE '%' || $2 || '%' OR c.phone_key LIKE '%' || regexp_replace($2, '\\D', '', 'g') || '%')
       AND ($3::boolean = false OR c.no_show_count > 0)
     ORDER BY c.no_show_count DESC, c.created_at DESC LIMIT 100`,
    [CONFIG.tz, q, sp.f === "plantones"],
  );

  return (
    <main className="container admin">
      <AdminNav active="clientas" />
      <h1 className="admin__h1">Clientas</h1>
      <form className="form form--grid" action="/admin/clientas">
        <label className="field field--wide"><span>Buscar por nombre o teléfono</span><input name="q" defaultValue={q} placeholder="María, 600…" /></label>
        <label className="check"><input type="checkbox" name="f" value="plantones" defaultChecked={sp.f === "plantones"} /><span>Solo con plantones</span></label>
        <button className="btn btn--primary" type="submit">Buscar</button>
      </form>
      {rows.length === 0 && <p className="panel muted">Todavía no hay clientas registradas: se crean solas con cada reserva.</p>}
      <ul className="agenda">
        {rows.map((c) => (
          <li key={c.id} className="agenda__item">
            <div className="agenda__time" aria-hidden="true">{c.total}<small>citas</small></div>
            <div className="agenda__main">
              <strong><Link href={`/admin/clientas/${c.id}`}>{c.name}</Link></strong>
              <span>{c.phone}{c.last ? ` · última cita ${c.last}` : ""}</span>
            </div>
            <div className="agenda__side">
              {c.no_show_count > 0 && <span className="badge badge--noshow">{c.no_show_count} {c.no_show_count === 1 ? "plantón" : "plantones"}</span>}
              {c.visit_count > 0 && <span className="badge badge--ok">{c.visit_count} {c.visit_count === 1 ? "visita" : "visitas"}</span>}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
