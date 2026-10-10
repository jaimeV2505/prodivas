import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import StatusTag from "@/components/StatusTag";
import { isAdmin } from "@/lib/auth";
import { CONFIG } from "@/lib/config";
import { query } from "@/lib/db";
import { fmtPrice, waLink } from "@/lib/format";
import { saveCustomerNotesAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ficha de clienta", robots: { index: false, follow: false } };

type Customer = { id: number; name: string; phone: string; email: string | null; notes: string | null; no_show_count: number; visit_count: number; since: string };
type Hist = { id: string; when: string; iso: string; status: string; attendance: string | null; service: string; price: number; deposit: string };

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!(await isAdmin())) {
    return (
      <main className="container narrow admin">
        <section className="panel"><Link className="btn btn--primary" href="/admin">Entrar en la agenda</Link></section>
      </main>
    );
  }
  const cid = Number(id);
  if (!Number.isInteger(cid) || cid <= 0) notFound();
  const c = (
    await query<Customer>(
      `SELECT id, name, phone, email, notes, no_show_count, visit_count, to_char(created_at AT TIME ZONE $2::text, 'DD/MM/YYYY') AS since FROM customers WHERE id = $1::bigint`,
      [cid, CONFIG.tz],
    )
  )[0];
  if (!c) return notFound();
  const hist = await query<Hist>(
    `SELECT b.id, b.starts_at AS iso, to_char(b.starts_at AT TIME ZONE $2::text, 'DD/MM/YYYY HH24:MI') AS "when", b.status, b.attendance, b.deposit_status AS deposit,
            COALESCE((SELECT string_agg(bs.name, ' + ' ORDER BY bs.position) FROM booking_services bs WHERE bs.booking_id = b.id), s.name) AS service,
            COALESCE((SELECT SUM(bs.price_cents)::int FROM booking_services bs WHERE bs.booking_id = b.id), s.price_cents) AS price
     FROM bookings b JOIN services s ON s.id = b.service_id
     WHERE b.customer_id = $1::bigint AND b.status IN ('CONFIRMED','CANCELLED')
     ORDER BY b.starts_at DESC LIMIT 60`,
    [cid, CONFIG.tz],
  );
  const spent = hist.filter((h) => h.attendance === "SHOWED").reduce((a, h) => a + h.price, 0);

  return (
    <main className="container admin">
      <AdminNav active="clientas" />
      <Link className="back" href="/admin/clientas">← Todas las clientas</Link>
      {sp.ok && <p className="notice notice--info" role="status">{sp.ok}</p>}
      <section className="panel">
        <h1 className="panel__title">{c.name}</h1>
        <dl className="details">
          <dt>Teléfono</dt>
          <dd><a href={`tel:${c.phone}`}>{c.phone}</a> · <a href={waLink(c.phone)} target="_blank" rel="noopener noreferrer">WhatsApp</a></dd>
          {c.email && (<><dt>Email</dt><dd>{c.email}</dd></>)}
          <dt>Clienta desde</dt><dd>{c.since}</dd>
          <dt>Visitas</dt><dd>{c.visit_count} · {fmtPrice(spent)} en citas a las que vino</dd>
          <dt>Plantones</dt><dd className={c.no_show_count >= 2 ? "warn-inline" : ""}>{c.no_show_count}{c.no_show_count >= 2 ? " ⚠ conviene confirmar sus citas por teléfono" : ""}</dd>
        </dl>
      </section>
      <section className="panel">
        <h2 className="panel__title panel__title--sm">Notas</h2>
        <form action={saveCustomerNotesAction} className="form">
          <input type="hidden" name="id" value={c.id} />
          <label className="field"><span>Alergias, gustos, color favorito… (solo lo ves tú)</span>
            <textarea name="notes" rows={4} maxLength={2000} defaultValue={c.notes ?? ""} />
          </label>
          <button className="btn btn--primary" type="submit">Guardar notas</button>
        </form>
      </section>
      <section className="panel">
        <h2 className="panel__title panel__title--sm">Historial</h2>
        {hist.length === 0 ? <p className="muted">Sin citas.</p> : (
          <ul className="timeoff">
            {hist.map((h) => (
              <li key={h.id}>
                <span><Link href={`/admin/cita/${h.id}`}>{h.when}</Link> · {h.service} · {fmtPrice(h.price)}</span>
                <StatusTag status={h.status} attendance={h.attendance} startsAt={h.iso} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
