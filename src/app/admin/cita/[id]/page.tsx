import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import AdminNav from "@/components/AdminNav";
import StatusTag from "@/components/StatusTag";
import { isAdmin } from "@/lib/auth";
import { getSummaryById } from "@/lib/bookings";
import { CONFIG } from "@/lib/config";
import { query } from "@/lib/db";
import { fmtDuration, fmtLong, fmtPrice, waLink } from "@/lib/format";
import { attendanceAction, adminRescheduleAction, cancelBookingAction, refundDepositAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cita", robots: { index: false, follow: false } };

const DEPOSIT: Record<string, string> = { NONE: "Sin señal", PENDING: "Pagando…", PAID: "Pagada", REFUNDED: "Devuelta", FORFEITED: "Retenida (no vino o cancelación tardía)" };
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", sms: "SMS", email: "Email", telegram: "Telegram" };
const KIND: Record<string, string> = {
  created: "Confirmación",
  reminder: "Recordatorio",
  reminder_evening: "Recordatorio de la víspera",
  reminder_second: "Segundo recordatorio",
  aftercare: "Gracias y cuidados",
  rebook_nudge: "Toca retoque",
  rescheduled: "Cambio de hora",
  cancelled_by_centre: "Cancelación del centro",
  waitlist: "Hueco libre",
};

export default async function BookingDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!(await isAdmin())) {
    return (
      <main className="container narrow admin">
        <section className="panel"><Link className="btn btn--primary" href="/admin">Entrar en la agenda</Link></section>
      </main>
    );
  }
  if (!z.string().uuid().safeParse(id).success) notFound();
  const b = await getSummaryById(id);
  if (!b) return notFound();

  const [staff, parts, log, local, extra] = await Promise.all([
    query<{ id: number; name: string }>(`SELECT id, name FROM staff WHERE active ORDER BY sort, id`),
    query<{ name: string; duration_min: number; price_cents: number; deposit_cents: number; is_addon: boolean }>(
      `SELECT name, duration_min, price_cents, deposit_cents, is_addon FROM booking_services WHERE booking_id = $1::uuid ORDER BY position`,
      [id],
    ),
    query<{ kind: string; channel: string; status: string; delivery_status: string | null; detail: string | null; at: string }>(
      `SELECT kind, channel, status, delivery_status, detail, to_char(created_at AT TIME ZONE $2::text, 'DD/MM HH24:MI') AS at
       FROM notification_log WHERE booking_id = $1::uuid AND kind NOT LIKE 'owner%' ORDER BY created_at DESC LIMIT 20`,
      [id, CONFIG.tz],
    ),
    query<{ day: string; time: string }>(
      `SELECT to_char(starts_at AT TIME ZONE $2::text, 'YYYY-MM-DD') AS day, to_char(starts_at AT TIME ZONE $2::text, 'HH24:MI') AS time FROM bookings WHERE id = $1::uuid`,
      [id, CONFIG.tz],
    ),
    query<{ package_slug: string | null; consent_acks: string[] | null; consent_at: string | null }>(
      `SELECT package_slug, consent_acks, to_char(consent_at AT TIME ZONE $2::text, 'DD/MM/YYYY HH24:MI') AS consent_at FROM bookings WHERE id = $1::uuid`,
      [id, CONFIG.tz],
    ).catch(() => []),
  ]);
  const active = b.status === "CONFIRMED";
  const back = `/admin/cita/${id}`;

  return (
    <main className="container admin">
      <AdminNav active="cita" />
      <Link className="back" href={`/admin?d=${local[0].day}`}>← Volver a la agenda</Link>
      {sp.ok && <p className="notice notice--info" role="status">{sp.ok}</p>}
      {sp.err && <p className="notice notice--error" role="alert">{sp.err}</p>}

      <section className="panel">
        <h1 className="panel__title">{b.serviceName}</h1>
        {b.status === "CONFIRMED" && b.customerPhone && log.some((l) => l.kind === "created") && log.filter((l) => l.kind === "created").every((l) => l.status === "FAILED" || l.delivery_status === "failed" || l.delivery_status === "undelivered") && (
          <p className="notice notice--error" role="alert">⚠️ Ningún aviso de confirmación ha llegado a la clienta. <a href={`tel:${b.customerPhone}`}>Llámala</a> para asegurarte de que sabe su cita.</p>
        )}
        <p><StatusTag status={b.status} attendance={b.attendance} startsAt={b.startsAt} cancelReason={b.cancelReason} /></p>
        <dl className="details">
          <dt>Cuándo</dt><dd>{fmtLong(b.startsAt)} ({fmtDuration(b.durationMin)})</dd>
          <dt>Estado</dt><dd>{b.status === "CONFIRMED" ? "Confirmada" : b.status === "CANCELLED" ? "Cancelada" : b.status}{b.attendance === "SHOWED" ? " · vino" : b.attendance === "NO_SHOW" ? " · no vino" : ""}</dd>
          <dt>Clienta</dt>
          <dd>
            {b.customerId ? <Link href={`/admin/clientas/${b.customerId}`}>{b.customerName}</Link> : b.customerName}
            {b.customerPhone && (<> · <a href={`tel:${b.customerPhone}`}>{b.customerPhone}</a> · <a href={waLink(b.customerPhone)} target="_blank" rel="noopener noreferrer">WhatsApp</a></>)}
            {b.customerEmail && <> · {b.customerEmail}</>}
          </dd>
          {b.notes && (<><dt>Comentarios</dt><dd>{b.notes}</dd></>)}
          <dt>Servicios</dt>
          <dd>
            {parts.map((p) => `${p.is_addon ? "＋ extra: " : ""}${p.name} (${fmtDuration(p.duration_min)}, ${fmtPrice(p.price_cents)})`).join(" + ")} · Total {fmtPrice(b.priceCents)}
            {extra[0]?.package_slug && <><br />🎁 Pack «{extra[0].package_slug}» (descuento ya aplicado)</>}
            {extra[0]?.consent_acks?.length ? <><br />✔ Confirmó las casillas de seguridad ({extra[0].consent_acks.join(", ")}) el {extra[0].consent_at}</> : null}
          </dd>
          <dt>Señal</dt>
          <dd>{b.depositCents > 0 ? `${fmtPrice(b.depositCents)} · ${DEPOSIT[b.depositStatus] ?? b.depositStatus}` : "No lleva"}</dd>
          <dt>Código</dt><dd>{b.code}</dd>
        </dl>
      </section>

      {active && (
        <>
          <section className="panel">
            <h2 className="panel__title panel__title--sm">Asistencia</h2>
            <div className="agenda__att">
              {["SHOWED", "NO_SHOW", "CLEAR"].map((v) => (
                <form key={v} action={attendanceAction}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="value" value={v} />
                  <input type="hidden" name="next" value={back} />
                  <button className={`btn ${v === "SHOWED" ? "btn--primary" : "btn--ghost"} btn--sm`} type="submit" disabled={(v === "CLEAR" && !b.attendance) || b.attendance === v}>
                    {v === "SHOWED" ? "Llegó" : v === "NO_SHOW" ? "No vino" : "Deshacer"}
                  </button>
                </form>
              ))}
            </div>
            <p className="muted small">Si no vino, se suma un plantón a su ficha y la señal (si pagó) se retiene.</p>
          </section>

          <section className="panel">
            <h2 className="panel__title panel__title--sm">Cambiar la hora</h2>
            <p className="muted small">Aquí puedes poner cualquier hora (aunque no sea de la rejilla); el sistema solo impide solapes con otra cita.</p>
            <form action={adminRescheduleAction} className="form form--grid">
              <input type="hidden" name="id" value={id} />
              <label className="field"><span>Día</span><input type="date" name="day" defaultValue={local[0].day} required /></label>
              <label className="field"><span>Hora</span><input type="time" name="time" defaultValue={local[0].time} required /></label>
              {staff.length > 1 ? (
                <label className="field"><span>Profesional</span>
                  <select name="staffId" defaultValue={b.staffId}>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                </label>
              ) : (
                <input type="hidden" name="staffId" value={b.staffId} />
              )}
              {b.customerPhone && <label className="check field--wide"><input type="checkbox" name="notify" defaultChecked /><span>Avisar a la clienta del cambio</span></label>}
              <button className="btn btn--primary" type="submit">Cambiar hora</button>
            </form>
          </section>

          <section className="panel">
            <h2 className="panel__title panel__title--sm">Cancelar</h2>
            <form action={cancelBookingAction}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="day" value={local[0].day} />
              <button className="btn btn--ghost" type="submit">Cancelar esta cita{b.depositStatus === "PAID" ? " y devolver la señal" : ""}</button>
            </form>
          </section>
        </>
      )}

      {b.depositStatus === "PAID" && (
        <section className="panel">
          <h2 className="panel__title panel__title--sm">Señal</h2>
          <form action={refundDepositAction}>
            <input type="hidden" name="id" value={id} />
            <button className="btn btn--ghost" type="submit">Devolver la señal ({fmtPrice(b.depositCents)})</button>
          </form>
        </section>
      )}

      <section className="panel">
        <h2 className="panel__title panel__title--sm">Mensajes enviados</h2>
        {log.length === 0 ? (
          <p className="muted">Todavía no se ha enviado ningún mensaje a la clienta.</p>
        ) : (
          <ul className="timeoff">
            {log.map((l, i) => (
              <li key={i}>
                <span>
                  <b>{KIND[l.kind] ?? l.kind}</b> · {CHANNEL[l.channel] ?? l.channel} · {l.at}
                </span>
                <span className={`badge ${l.status === "FAILED" || l.delivery_status === "failed" || l.delivery_status === "undelivered" ? "badge--noshow" : l.delivery_status === "delivered" || l.delivery_status === "read" ? "badge--ok" : ""}`}>
                  {l.status === "FAILED" ? "No se envió" : l.delivery_status === "read" ? "Leído" : l.delivery_status === "delivered" ? "Entregado" : l.delivery_status === "failed" || l.delivery_status === "undelivered" ? "No entregado" : "Enviado"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
