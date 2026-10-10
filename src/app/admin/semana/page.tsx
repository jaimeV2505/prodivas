import type { Metadata } from "next";
import Link from "next/link";
import AdminNav from "@/components/AdminNav";
import AutoRefresh from "@/components/AutoRefresh";
import { isAdmin } from "@/lib/auth";
import { CONFIG } from "@/lib/config";
import { addDays, isDay, todayIn } from "@/lib/dates";
import { query } from "@/lib/db";
import { fmtDayLabel } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Semana", robots: { index: false, follow: false } };

type Bk = {
  id: string;
  day: string;
  sm: number;
  em: number;
  name: string | null;
  service: string;
  status: string;
  response: string | null;
  attendance: string | null;
  deposit: string;
  staff_id: number;
};
type Off = { s: string; e: string; staff_id: number | null; reason: string | null };
type Hr = { weekday: number; closed: boolean; open: string | null; close: string | null; bs: string | null; be: string | null };

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const dow = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
};
const PPM = 1.05; // píxeles por minuto

export default async function WeekPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const sp = await searchParams;
  if (!(await isAdmin())) {
    return (
      <main className="container narrow admin">
        <section className="panel">
          <p>Necesitas entrar en la agenda primero.</p>
          <Link className="btn btn--primary" href="/admin">Ir a la agenda</Link>
        </section>
      </main>
    );
  }

  const today = todayIn(CONFIG.tz);
  const ref = sp.d && isDay(sp.d) ? sp.d : today;
  const monday = addDays(ref, -((dow(ref) + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const sunday = days[6];

  const [bookings, offs, hours, staff] = await Promise.all([
    query<Bk>(
      `SELECT b.id, to_char(b.starts_at AT TIME ZONE $3::text, 'YYYY-MM-DD') AS day,
              (EXTRACT(HOUR FROM b.starts_at AT TIME ZONE $3::text) * 60 + EXTRACT(MINUTE FROM b.starts_at AT TIME ZONE $3::text))::int AS sm,
              (EXTRACT(HOUR FROM b.ends_at AT TIME ZONE $3::text) * 60 + EXTRACT(MINUTE FROM b.ends_at AT TIME ZONE $3::text))::int AS em,
              b.customer_name AS name, b.status, b.customer_response AS response, b.attendance, b.deposit_status AS deposit, b.staff_id,
              COALESCE((SELECT string_agg(bs.name, ' + ' ORDER BY bs.position) FROM booking_services bs WHERE bs.booking_id = b.id), s.name) AS service
       FROM bookings b JOIN services s ON s.id = b.service_id
       WHERE (b.starts_at AT TIME ZONE $3::text)::date BETWEEN $1::date AND $2::date
         AND (b.status IN ('CONFIRMED','CANCELLED') OR (b.status = 'HOLD' AND b.hold_expires_at > now()))
       ORDER BY b.starts_at`,
      [monday, sunday, CONFIG.tz],
    ),
    query<Off>(
      `SELECT to_char(t.starts_at AT TIME ZONE $3::text, 'YYYY-MM-DD"T"HH24:MI') AS s,
              to_char(t.ends_at AT TIME ZONE $3::text, 'YYYY-MM-DD"T"HH24:MI') AS e, t.staff_id, t.reason
       FROM time_off t
       WHERE t.ends_at > ($1::date AT TIME ZONE $3::text) AND t.starts_at < (($2::date + 1) AT TIME ZONE $3::text)`,
      [monday, sunday, CONFIG.tz],
    ),
    query<Hr>(
      `SELECT weekday, closed, to_char(open_time,'HH24:MI') AS open, to_char(close_time,'HH24:MI') AS close,
              to_char(break_start,'HH24:MI') AS bs, to_char(break_end,'HH24:MI') AS be FROM business_hours`,
    ),
    query<{ id: number; name: string }>(`SELECT id, name FROM staff WHERE active ORDER BY sort, id`),
  ]);

  const hr = new Map(hours.map((h) => [h.weekday, h]));
  const opens = hours.filter((h) => !h.closed && h.open).map((h) => mins(h.open!));
  const closes = hours.filter((h) => !h.closed && h.close).map((h) => mins(h.close!));
  const startMin = Math.floor((Math.min(...opens, bookings.length ? Math.min(...bookings.map((b) => b.sm)) : 600, 600) - 30) / 60) * 60;
  const endMin = Math.ceil((Math.max(...closes, bookings.length ? Math.max(...bookings.map((b) => b.em)) : 1200, 1200) + 30) / 60) * 60;
  const height = (endMin - startMin) * PPM;
  const staffIdx = new Map(staff.map((s, i) => [s.id, i]));
  const n = Math.max(1, staff.length);

  const hourMarks: number[] = [];
  for (let m = startMin; m <= endMin; m += 60) hourMarks.push(m);

  return (
    <main className="container admin">
      <AutoRefresh />
      <AdminNav active="semana" />
      <nav className="admin__days" aria-label="Cambiar de semana">
        <Link className="btn btn--ghost btn--icon" href={`/admin/semana?d=${addDays(monday, -7)}`} aria-label="Semana anterior">‹</Link>
        <strong className="admin__date">{fmtDayLabel(monday).replace(/^[^ ]+ /, "")} al {fmtDayLabel(sunday).replace(/^[^ ]+ /, "")}</strong>
        <Link className="btn btn--ghost btn--icon" href={`/admin/semana?d=${addDays(monday, 7)}`} aria-label="Semana siguiente">›</Link>
        <Link className="btn btn--ghost btn--sm admin__today" href="/admin/semana">Esta semana</Link>
      </nav>

      <div className="week" style={{ ["--ppm" as string]: `${PPM}px` } as React.CSSProperties}>
        <div className="week__scroll">
          <div className="week__grid">
            <div className="week__corner" />
            {days.map((d) => (
              <Link key={d} href={`/admin?d=${d}`} className={`week__head ${d === today ? "is-today" : ""}`}>
                {fmtDayLabel(d).split(" ").slice(0, 2).join(" ")}
              </Link>
            ))}
            <div className="week__hours" style={{ height }}>
              {hourMarks.map((m) => (
                <span key={m} style={{ top: (m - startMin) * PPM }}>{hm(m)}</span>
              ))}
            </div>
            {days.map((d) => {
              const h = hr.get(dow(d));
              const closed = !h || h.closed || !h.open || !h.close;
              const dayBk = bookings.filter((b) => b.day === d);
              const dayOff = offs
                .map((o) => {
                  const s = o.s < `${d}T00:00` ? 0 : mins(o.s.slice(11));
                  const e = o.e > `${d}T23:59` && o.e.slice(0, 10) !== d ? 24 * 60 : mins(o.e.slice(11));
                  return o.e.slice(0, 10) < d || o.s.slice(0, 10) > d ? null : { s, e: o.e.slice(0, 10) > d ? 24 * 60 : e, staff_id: o.staff_id, reason: o.reason };
                })
                .filter((x): x is { s: number; e: number; staff_id: number | null; reason: string | null } => !!x && x.e > x.s);
              return (
                <div key={d} className={`week__col ${closed ? "is-closed" : ""}`} style={{ height }}>
                  {hourMarks.map((m) => (
                    <i key={m} className="week__line" style={{ top: (m - startMin) * PPM }} />
                  ))}
                  {closed && <span className="week__closed">Cerrado</span>}
                  {!closed && h?.bs && h?.be && (
                    <span className="week__break" style={{ top: (mins(h.bs) - startMin) * PPM, height: (mins(h.be) - mins(h.bs)) * PPM }}>Pausa</span>
                  )}
                  {dayOff.map((o, i) => (
                    <span key={i} className="week__off" title={o.reason ?? "Bloqueado"} style={{ top: (Math.max(o.s, startMin) - startMin) * PPM, height: (Math.min(o.e, endMin) - Math.max(o.s, startMin)) * PPM }}>
                      {o.reason ?? "Bloqueado"}
                    </span>
                  ))}
                  {dayBk.map((b) => {
                    const idx = staffIdx.get(b.staff_id) ?? 0;
                    const cls = b.status === "CANCELLED" ? "is-cancelled" : b.status === "HOLD" ? "is-hold" : b.attendance === "NO_SHOW" ? "is-noshow" : b.attendance === "SHOWED" ? "is-showed" : b.response === "CONFIRMED" ? "is-confirmed" : "";
                    return (
                      <Link
                        key={b.id}
                        href={`/admin/cita/${b.id}`}
                        className={`week__bk ${cls}`}
                        style={{ top: (b.sm - startMin) * PPM, height: Math.max((b.em - b.sm) * PPM - 2, 24), left: `${(idx / n) * 100}%`, width: `calc(${100 / n}% - 3px)` }}
                        title={`${hm(b.sm)} ${b.service} · ${b.name ?? ""}`}
                      >
                        <b>{hm(b.sm)}</b> {b.service}
                        <small>{b.status === "CANCELLED" ? "✕ Cancelada" : b.status === "HOLD" ? "Reservando…" : b.name}</small>
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <p className="muted small">
        Verde: la clienta ha confirmado · Rojo: no vino · Gris: ya vino · Rojo punteado y tachado: cancelada (el hueco está libre) · Punteado: alguien está reservando ese hueco. Pulsa una cita para ver el detalle o cambiar la hora.
      </p>
    </main>
  );
}
