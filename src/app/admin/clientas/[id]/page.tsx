import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import StatusTag from "@/components/StatusTag";
import { isAdmin } from "@/lib/auth";
import { CONFIG } from "@/lib/config";
import { query } from "@/lib/db";
import { fmtPrice, waLink } from "@/lib/format";
import { getLoyalty, stampsOf } from "@/lib/loyalty";
import { redeemLoyaltyAction, redeemReferralAction, saveCustomerNotesAction } from "../../actions";
import { getReferralSettings } from "@/lib/referrals";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ficha de clienta", robots: { index: false, follow: false } };

type Customer = { id: number; name: string; phone: string; email: string | null; notes: string | null; no_show_count: number; visit_count: number; since: string; loyalty_redeemed: number; optout_at: string | null; referral_rewards: number; referral_redeemed: number; referred_by: number | null; referrer_name: string | null; referred_count: number; preferred_staff: string | null };
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
      `SELECT c.id, c.name, c.phone, c.email, c.notes, c.no_show_count, c.visit_count, c.loyalty_redeemed, c.optout_at::text AS optout_at, to_char(c.created_at AT TIME ZONE $2::text, 'DD/MM/YYYY') AS since,
              c.referral_rewards, c.referral_redeemed, c.referred_by, r.name AS referrer_name, (SELECT count(*)::int FROM customers x WHERE x.referred_by = c.id) AS referred_count, (SELECT name FROM staff WHERE id = c.preferred_staff_id) AS preferred_staff
       FROM customers c LEFT JOIN customers r ON r.id = c.referred_by WHERE c.id = $1::bigint`,
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
  const loyalty = await getLoyalty().catch(() => ({ enabled: false, every: 10, reward: "" }));
  const stamps = stampsOf(c.visit_count, c.loyalty_redeemed ?? 0, loyalty.every);
  const referral = await getReferralSettings().catch(() => ({ enabled: false, reward: "" }));
  const refPending = Math.max(0, (c.referral_rewards ?? 0) - (c.referral_redeemed ?? 0));
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
          {loyalty.enabled && (
            <>
              <dt>Sellos</dt>
              <dd>
                {stamps.progress} de {loyalty.every}
                {stamps.rewards > 0 ? ` · 🎁 ${stamps.rewards} premio${stamps.rewards === 1 ? "" : "s"} pendiente${stamps.rewards === 1 ? "" : "s"} (${loyalty.reward})` : ""}
                {stamps.rewards > 0 && (
                  <form action={redeemLoyaltyAction} className="inline-form">
                    <input type="hidden" name="id" value={c.id} />
                    <button className="btn btn--primary btn--sm" type="submit">Canjear premio</button>
                  </form>
                )}
              </dd>
            </>
          )}
          {(c.referred_by || c.referred_count > 0 || refPending > 0) && (
            <>
              <dt>Amigas</dt>
              <dd>
                {c.referrer_name ? `Vino de la mano de ${c.referrer_name}. ` : ""}
                {c.referred_count > 0 ? `Ha traído a ${c.referred_count}. ` : ""}
                {refPending > 0 ? `🎁 ${refPending} premio${refPending === 1 ? "" : "s"} pendiente${refPending === 1 ? "" : "s"} (${referral.reward})` : ""}
                {refPending > 0 && (
                  <form action={redeemReferralAction} className="inline-form">
                    <input type="hidden" name="id" value={c.id} />
                    <button className="btn btn--primary btn--sm" type="submit">Canjear premio</button>
                  </form>
                )}
              </dd>
            </>
          )}
          {c.optout_at && (<><dt>Mensajes</dt><dd>De baja de los mensajes opcionales (los avisos de la cita siguen llegando)</dd></>)}
          {c.preferred_staff && (<><dt>Profesional habitual</dt><dd>{c.preferred_staff}</dd></>)}
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
