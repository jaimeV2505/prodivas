import type { Metadata } from "next";
import Link from "next/link";
import AdminNav from "@/components/AdminNav";
import AutoRefresh from "@/components/AutoRefresh";
import StatusTag from "@/components/StatusTag";
import { isAdmin } from "@/lib/auth";
import { CONFIG } from "@/lib/config";
import { addDays, isDay, todayIn } from "@/lib/dates";
import { query } from "@/lib/db";
import { fmtDayLabel, fmtPrice, waLink } from "@/lib/format";
import {
  addTimeOffAction,
  closeDayAction,
  cancelBookingAction,
  createManualAction,
  login,
  attendanceAction,
  removeTimeOffAction,
  removeWaitlistAction,
  doneCallbackAction,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agenda", robots: { index: false, follow: false } };

type Row = {
  id: string;
  code: string | null;
  status: string;
  t_start: string;
  t_end: string;
  customer_name: string | null;
  customer_phone: string | null;
  notes: string | null;
  source: string;
  service_name: string;
  price_cents: number;
  staff_name: string;
  customer_response: string | null;
  reminder_sent_at: string | null;
  attendance: string | null;
  deposit_status: string;
  deposit_cents: number;
  no_shows: number | null;
  customer_id: number | null;
  started: boolean;
  cancel_reason: string | null;
  reschedule_free: boolean;
  notified: boolean | null;
  cancelled_at: string | null;
  start_iso?: string;
};
type WaitRow = { id: string; day: string | null; part: string; name: string; phone: string; status: string; service_name: string };
type CallRow = { id: number; name: string; phone: string; created: string };
type OffRow = { id: number; day: string; t_start: string; t_end: string; staff_name: string | null; reason: string | null };

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string; err?: string; ok?: string; c?: string }>;
}) {
  const sp = await searchParams;

  if (!(await isAdmin())) {
    return (
      <main className="container narrow admin">
        <section className="panel">
          <h1 className="panel__title">Agenda de Pro Diva</h1>
          {sp.err && <p className="notice notice--error" role="alert">{sp.err}</p>}
          <form action={login} className="form">
            <label className="field">
              <span>Contraseña</span>
              <input name="password" type="password" required autoComplete="current-password" autoFocus />
            </label>
            <button className="btn btn--primary btn--block" type="submit">Entrar</button>
          </form>
        </section>
      </main>
    );
  }

  const today = todayIn(CONFIG.tz);
  const day = sp.d && isDay(sp.d) ? sp.d : today;

  const [bookings, services, staff, timeOff, waitlist, callbacks] = await Promise.all([
    query<Row>(
      `SELECT b.id, b.code, b.status, b.source,
              to_char(b.starts_at AT TIME ZONE $2::text, 'HH24:MI') AS t_start,
              to_char(b.ends_at   AT TIME ZONE $2::text, 'HH24:MI') AS t_end, b.starts_at AS start_iso,
              b.customer_name, b.customer_phone, b.notes, b.customer_response, b.reminder_sent_at,
              b.attendance, b.deposit_status, b.deposit_cents, b.customer_id, c.no_show_count AS no_shows, b.cancel_reason, b.reschedule_free,
            (SELECT bool_or(nl.status = 'SENT') FROM notification_log nl WHERE nl.booking_id = b.id AND nl.kind = 'created' AND nl.channel IN ('whatsapp','sms','email')) AS notified,
              to_char(b.cancelled_at AT TIME ZONE $2::text, 'DD/MM HH24:MI') AS cancelled_at,
              (b.starts_at <= now() + interval '3 hours') AS started,
              COALESCE((SELECT string_agg(bs.name, ' + ' ORDER BY bs.position) FROM booking_services bs WHERE bs.booking_id = b.id), s.name) AS service_name,
              COALESCE((SELECT SUM(bs.price_cents)::int FROM booking_services bs WHERE bs.booking_id = b.id), s.price_cents) AS price_cents,
              st.name AS staff_name
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       JOIN staff st ON st.id = b.staff_id
       LEFT JOIN customers c ON c.id = b.customer_id
       WHERE (b.starts_at AT TIME ZONE $2::text)::date = $1::date
         AND (b.status = 'CONFIRMED' OR (b.status = 'HOLD' AND b.hold_expires_at > now()) OR (NOT $3::boolean AND b.status = 'CANCELLED'))
       ORDER BY b.starts_at`,
      [day, CONFIG.tz, sp.c === "0"],
    ),
    query<{ id: number; name: string; duration_min: number }>(
      `SELECT id, name, duration_min FROM services WHERE active ORDER BY sort, id`,
    ),
    query<{ id: number; name: string }>(`SELECT id, name FROM staff WHERE active ORDER BY sort, id`),
    query<OffRow>(
      `SELECT t.id,
              to_char(t.starts_at AT TIME ZONE $1::text, 'YYYY-MM-DD') AS day,
              to_char(t.starts_at AT TIME ZONE $1::text, 'HH24:MI') AS t_start,
              to_char(t.ends_at   AT TIME ZONE $1::text, 'HH24:MI') AS t_end,
              st.name AS staff_name, t.reason
       FROM time_off t LEFT JOIN staff st ON st.id = t.staff_id
       WHERE t.ends_at > now() ORDER BY t.starts_at LIMIT 30`,
      [CONFIG.tz],
    ),
    query<WaitRow>(
      `SELECT w.id, to_char(w.day, 'YYYY-MM-DD') AS day, w.part, w.name, w.phone, w.status, s.name AS service_name
       FROM waitlist w JOIN services s ON s.id = w.service_id
       WHERE w.status IN ('ACTIVE','NOTIFIED')
       ORDER BY w.day NULLS LAST, w.created_at LIMIT 40`,
    ),
    query<CallRow>(
      `SELECT id, name, phone, to_char(created_at AT TIME ZONE $1::text, 'DD/MM HH24:MI') AS created
       FROM callbacks WHERE status = 'NEW' ORDER BY created_at LIMIT 20`,
      [CONFIG.tz],
    ),
  ]);

  const confirmed = bookings.filter((b) => b.status === "CONFIRMED");
  const cancelledCount = bookings.filter((b) => b.status === "CANCELLED").length;
  const revenue = confirmed.reduce((a, b) => a + b.price_cents, 0);

  return (
    <main className="container admin">
      <AutoRefresh />
      <AdminNav active="dia" />

      {sp.err && <p className="notice notice--error" role="alert">{sp.err}</p>}
      {sp.ok && <p className="notice notice--info" role="status">{sp.ok}</p>}

      <nav className="admin__days" aria-label="Cambiar de día">
        <Link className="btn btn--ghost btn--icon" href={`/admin?d=${addDays(day, -1)}`} aria-label="Día anterior">‹</Link>
        <strong className="admin__date">{fmtDayLabel(day)}{day === today ? " (hoy)" : ""}</strong>
        <Link className="btn btn--ghost btn--icon" href={`/admin?d=${addDays(day, 1)}`} aria-label="Día siguiente">›</Link>
        {day !== today && <Link className="btn btn--ghost btn--sm admin__today" href="/admin">Ir a hoy</Link>}
      </nav>

      <p className="muted">
        {confirmed.length} {confirmed.length === 1 ? "cita" : "citas"} · {fmtPrice(revenue)} previstos
        {" · "}
        {sp.c === "0" ? (
          <Link href={`/admin?d=${day}`}>Mostrar canceladas</Link>
        ) : (
          <Link href={`/admin?d=${day}&c=0`}>{cancelledCount > 0 ? `${cancelledCount} cancelada${cancelledCount === 1 ? "" : "s"} · ocultar` : "Ocultar canceladas"}</Link>
        )}
      </p>

      {bookings.length === 0 && <p className="panel muted">No hay citas este día.</p>}
      <ul className="agenda">
        {bookings.map((b) => (
          <li key={b.id} className={`agenda__item agenda__item--${b.status.toLowerCase()}`}>
            <div className="agenda__time">{b.t_start}<small>{b.t_end}</small></div>
            <div className="agenda__main">
              <strong>{b.service_name}</strong>
              <span>
                {b.status === "HOLD" ? "Una clienta está reservando este hueco…" : b.customer_name}
                {b.staff_name && staff.length > 1 ? ` · ${b.staff_name}` : ""}
                {(b.no_shows ?? 0) >= 2 && <b className="warn-inline"> · ⚠ {b.no_shows} plantones</b>}
              </span>
              {b.customer_phone && (
                <span>
                  <a href={`tel:${b.customer_phone}`}>{b.customer_phone}</a>{" · "}
                  <a href={waLink(b.customer_phone)} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                </span>
              )}
              {b.notes && <em>{b.notes}</em>}
            </div>
            <div className="agenda__side">
              {b.status === "CANCELLED" ? (
                <>
                  <StatusTag status={b.status} startsAt={b.start_iso ?? ""} cancelReason={b.cancel_reason ?? "customer"} />
                  {b.cancelled_at && <small className="muted">el {b.cancelled_at}</small>}
                </>
              ) : (
                <span className={`badge badge--${b.status.toLowerCase()}`}>
                  {b.status === "CONFIRMED" ? (b.source === "admin" ? "Manual" : "Online") : "En proceso"}
                </span>
              )}
              {b.deposit_status === "PAID" && <span className="badge badge--ok">Señal pagada</span>}
              {b.deposit_status === "PENDING" && <span className="badge badge--warn">Pagando señal</span>}
              {b.deposit_status === "FORFEITED" && <span className="badge badge--cancelled">Señal retenida</span>}
              {b.deposit_status === "REFUNDED" && <span className="badge badge--cancelled">Señal devuelta</span>}
              {b.reschedule_free && b.status === "CONFIRMED" && <span className="badge badge--warn">Por mover</span>}
              {b.status === "CONFIRMED" && b.notified === false && <span className="badge badge--noshow">Sin aviso · llámala</span>}
              {b.attendance === "SHOWED" && <span className="badge badge--ok">Vino</span>}
              {b.attendance === "NO_SHOW" && <span className="badge badge--noshow">No vino</span>}
              {b.status === "CONFIRMED" && !b.attendance && (
                <span className={`badge ${b.customer_response === "CONFIRMED" ? "badge--ok" : b.reminder_sent_at ? "badge--warn" : ""}`}>
                  {b.customer_response === "CONFIRMED" ? "Ha confirmado" : b.reminder_sent_at ? "Sin respuesta" : "Recordatorio pendiente"}
                </span>
              )}
              {b.status === "CONFIRMED" && !b.attendance && b.started && (
                <div className="agenda__att">
                  <form action={attendanceAction}>
                    <input type="hidden" name="id" value={b.id} />
                    <input type="hidden" name="value" value="SHOWED" />
                    <input type="hidden" name="next" value={`/admin?d=${day}`} />
                    <button className="btn btn--primary btn--sm" type="submit">Llegó</button>
                  </form>
                  <form action={attendanceAction}>
                    <input type="hidden" name="id" value={b.id} />
                    <input type="hidden" name="value" value="NO_SHOW" />
                    <input type="hidden" name="next" value={`/admin?d=${day}`} />
                    <button className="btn btn--ghost btn--sm" type="submit">No vino</button>
                  </form>
                </div>
              )}
              {b.status !== "HOLD" && <Link className="btn btn--ghost btn--sm" href={`/admin/cita/${b.id}`}>Detalle</Link>}
              {b.status !== "CANCELLED" && b.status !== "HOLD" && !b.attendance && (
                <form action={cancelBookingAction}>
                  <input type="hidden" name="id" value={b.id} />
                  <input type="hidden" name="day" value={day} />
                  <button className="btn btn--ghost btn--sm" type="submit">Cancelar</button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>

      {callbacks.length > 0 && (
        <section className="panel">
          <h2 className="panel__title panel__title--sm">Quieren que las llames ({callbacks.length})</h2>
          <ul className="timeoff">
            {callbacks.map((c) => (
              <li key={c.id}>
                <span>
                  <b>{c.name}</b> · <a href={`tel:${c.phone}`}>{c.phone}</a> · <a href={waLink(c.phone)} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                  <small className="muted"> ({c.created})</small>
                </span>
                <form action={doneCallbackAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="day" value={day} />
                  <button className="btn btn--ghost btn--sm" type="submit">Hecha</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {waitlist.length > 0 && (
        <section className="panel">
          <h2 className="panel__title panel__title--sm">Lista de espera ({waitlist.length})</h2>
          <p className="muted small">Cuando alguien cancela, avisamos solos a los primeros. Aquí puedes llamarles tú.</p>
          <ul className="timeoff">
            {waitlist.map((w) => (
              <li key={w.id}>
                <span>
                  <b>{w.name}</b> quiere {w.service_name}, {w.day ? fmtDayLabel(w.day) : "cualquier día"}
                  {w.part === "MORNING" ? ", por la mañana" : w.part === "AFTERNOON" ? ", por la tarde" : ""}
                  {w.status === "NOTIFIED" ? " (avisada)" : ""}
                  {" · "}
                  <a href={`tel:${w.phone}`}>{w.phone}</a>{" · "}
                  <a href={waLink(w.phone)} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                </span>
                <form action={removeWaitlistAction}>
                  <input type="hidden" name="id" value={w.id} />
                  <input type="hidden" name="day" value={day} />
                  <button className="btn btn--ghost btn--sm" type="submit">Quitar</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h2 className="panel__title panel__title--sm">Añadir cita a mano (teléfono, WhatsApp, en el salón)</h2>
        <form action={createManualAction} className="form form--grid">
          <label className="field"><span>Servicio</span>
            <select name="serviceId" required>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.duration_min} min)</option>)}
            </select>
          </label>
          {staff.length > 1 ? (
            <label className="field"><span>Profesional</span>
              <select name="staffId" required>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </label>
          ) : (
            <input type="hidden" name="staffId" value={staff[0]?.id} />
          )}
          <label className="field"><span>Día</span><input type="date" name="day" defaultValue={day} required /></label>
          <label className="field"><span>Hora</span><input type="time" name="time" step={300} required /></label>
          <label className="field"><span>Nombre</span><input name="name" required maxLength={80} /></label>
          <label className="field"><span>Teléfono</span><input name="phone" type="tel" required /></label>
          <label className="field field--wide"><span>Notas</span><input name="notes" maxLength={500} /></label>
          <button className="btn btn--primary" type="submit">Guardar cita</button>
        </form>
      </section>

      <section className="panel">
        <details className="closeday">
          <summary>🚨 Cerrar este día (enfermedad, imprevisto)</summary>
          <p className="muted small">
            Bloquea el día entero y deja sus citas «por mover». A cada clienta le llega un mensaje con un enlace para elegir otra hora (con propuestas) o cancelar sin coste; si pagó señal, se le devuelve.
            Las que no contesten aparecerán aquí como «Por mover» para que las llames.
          </p>
          <form action={closeDayAction} className="form form--grid">
            <label className="field"><span>Día</span><input type="date" name="day" defaultValue={day} required /></label>
            <label className="field field--wide"><span>Mensaje para las clientas <em>(opcional)</em></span><input name="note" maxLength={160} placeholder="Estoy mala y no puedo abrir. Lo siento mucho." /></label>
            <label className="check field--wide"><input type="checkbox" name="confirm" required /><span>Sí, cerrar el día y avisar a las clientas</span></label>
            <button className="btn btn--primary" type="submit">Cerrar el día y avisar</button>
          </form>
        </details>
      </section>

      <section className="panel">
        <h2 className="panel__title panel__title--sm">Bloquear horario (vacaciones, festivos, imprevistos)</h2>
        <form action={addTimeOffAction} className="form form--grid">
          <label className="field"><span>Día</span><input type="date" name="day" defaultValue={day} required /></label>
          <label className="field"><span>Desde <em>(vacío = todo el día)</em></span><input type="time" name="from" /></label>
          <label className="field"><span>Hasta</span><input type="time" name="to" /></label>
          {staff.length > 1 && (
            <label className="field"><span>Quién</span>
              <select name="staffId"><option value="">Todo el salón</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </label>
          )}
          <label className="field field--wide"><span>Motivo</span><input name="reason" maxLength={120} /></label>
          <button className="btn btn--primary" type="submit">Bloquear</button>
        </form>
        {timeOff.length > 0 && (
          <ul className="timeoff">
            {timeOff.map((t) => (
              <li key={t.id}>
                <span>
                  {fmtDayLabel(t.day)} {t.t_start === "00:00" && t.t_end === "00:00" ? "(todo el día)" : `${t.t_start}–${t.t_end}`}
                  {t.staff_name ? ` · ${t.staff_name}` : ""}{t.reason ? ` · ${t.reason}` : ""}
                </span>
                <form action={removeTimeOffAction}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="day" value={day} />
                  <button className="btn btn--ghost btn--sm" type="submit">Quitar</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
