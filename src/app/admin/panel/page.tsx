import type { Metadata } from "next";
import Link from "next/link";
import AdminNav from "@/components/AdminNav";
import AutoRefresh from "@/components/AutoRefresh";
import { isAdmin } from "@/lib/auth";
import { CONFIG } from "@/lib/config";
import { addDays, todayIn } from "@/lib/dates";
import { query } from "@/lib/db";
import { fmtPrice } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Panel", robots: { index: false, follow: false } };

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

const STEPS: { key: string; label: string }[] = [
  { key: "landing", label: "Entran" },
  { key: "service", label: "Eligen servicio" },
  { key: "slots", label: "Ven huecos" },
  { key: "hold", label: "Bloquean un hueco" },
  { key: "details", label: "Rellenan sus datos" },
  { key: "lead", label: "Dejan su teléfono" },
  { key: "confirmed", label: "Reservan" },
];

/** Minutos abiertos (profesionales activas, con su horario propio y pausas) y minutos reservados por día. $1 desde · $2 hasta · $3 zona */
const DAYS_SQL = `
WITH days AS (SELECT d::date AS day FROM generate_series($1::date, $2::date, interval '1 day') AS d),
open AS (
  SELECT days.day,
    CASE WHEN h.closed OR COALESCE(sh.closed, false) THEN 0 ELSE GREATEST(0, COALESCE(
      EXTRACT(EPOCH FROM (CASE WHEN sh.staff_id IS NULL THEN h.close_time ELSE sh.close_time END - CASE WHEN sh.staff_id IS NULL THEN h.open_time ELSE sh.open_time END)) / 60
      - COALESCE(EXTRACT(EPOCH FROM (CASE WHEN sh.staff_id IS NULL THEN h.break_end ELSE sh.break_end END - CASE WHEN sh.staff_id IS NULL THEN h.break_start ELSE sh.break_start END)) / 60, 0), 0)) END AS mins
  FROM days
  CROSS JOIN staff s
  JOIN business_hours h ON h.weekday = EXTRACT(DOW FROM days.day)::int
  LEFT JOIN staff_hours sh ON sh.staff_id = s.id AND sh.weekday = h.weekday
  WHERE s.active
),
o AS (SELECT day, SUM(mins)::int AS open_min FROM open GROUP BY day),
bk AS (
  SELECT (b.starts_at AT TIME ZONE $3::text)::date AS day, SUM(EXTRACT(EPOCH FROM (b.ends_at - b.starts_at)) / 60)::int AS booked_min
  FROM bookings b
  WHERE b.status = 'CONFIRMED'
    AND b.starts_at >= ($1::date::timestamp AT TIME ZONE $3::text)
    AND b.starts_at <  (($2::date + 1)::timestamp AT TIME ZONE $3::text)
  GROUP BY 1
)
SELECT to_char(o.day, 'YYYY-MM-DD') AS day, o.open_min, COALESCE(bk.booked_min, 0)::int AS booked_min
FROM o LEFT JOIN bk USING (day) ORDER BY o.day`;

type DayRow = { day: string; open_min: number; booked_min: number };

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const hm = (min: number) => `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, "0")}` : ""}`;
const dayName = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", timeZone: "UTC" });
const WEEK = [
  { dow: 1, label: "L" },
  { dow: 2, label: "M" },
  { dow: 3, label: "X" },
  { dow: 4, label: "J" },
  { dow: 5, label: "V" },
  { dow: 6, label: "S" },
  { dow: 0, label: "D" },
];

export default async function PanelPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  if (!(await isAdmin())) {
    return (
      <main className="container narrow admin">
        <section className="panel"><Link className="btn btn--primary" href="/admin">Entrar en la agenda</Link></section>
      </main>
    );
  }
  const sp = await searchParams;
  const r: Range = (RANGES as readonly number[]).includes(Number(sp.r)) ? (Number(sp.r) as Range) : 30;
  const tz = CONFIG.tz;
  const today = todayIn(tz);

  const [kpi, funnel, aband, sources, bookSrc, devices, leads, top, heat, past, next7, retention, dormant, setting] = await Promise.all([
    query<{ online: number; showed: number; no_show: number; revenue: number; past_total: number; past_cancelled: number; new_c: number; rec_c: number }>(
      `WITH p AS (
         SELECT b.id, b.status, b.attendance,
                COALESCE((SELECT SUM(bs.price_cents) FROM booking_services bs WHERE bs.booking_id = b.id), 0)::int AS price
         FROM bookings b
         WHERE b.starts_at >= now() - make_interval(days => $1::int) AND b.starts_at < now() AND b.status IN ('CONFIRMED','CANCELLED')
       ),
       c AS (
         SELECT DISTINCT b.customer_id, (cu.created_at >= now() - make_interval(days => $1::int)) AS is_new
         FROM bookings b JOIN customers cu ON cu.id = b.customer_id
         WHERE b.status = 'CONFIRMED' AND b.confirmed_at >= now() - make_interval(days => $1::int)
       )
       SELECT (SELECT count(*) FROM bookings WHERE status = 'CONFIRMED' AND source <> 'admin' AND confirmed_at >= now() - make_interval(days => $1::int))::int AS online,
              (SELECT count(*) FROM p WHERE status = 'CONFIRMED' AND attendance = 'SHOWED')::int AS showed,
              (SELECT count(*) FROM p WHERE status = 'CONFIRMED' AND attendance = 'NO_SHOW')::int AS no_show,
              (SELECT COALESCE(SUM(price), 0) FROM p WHERE status = 'CONFIRMED' AND attendance = 'SHOWED')::int AS revenue,
              (SELECT count(*) FROM p)::int AS past_total,
              (SELECT count(*) FROM p WHERE status = 'CANCELLED')::int AS past_cancelled,
              (SELECT count(*) FROM c WHERE is_new)::int AS new_c,
              (SELECT count(*) FROM c WHERE NOT is_new)::int AS rec_c`,
      [r],
    ),
    query<{ event: string; n: number }>(
      `SELECT event, count(DISTINCT session_id)::int AS n FROM funnel_events WHERE created_at >= now() - make_interval(days => $1::int) GROUP BY event`,
      [r],
    ).catch(() => []),
    query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (
         SELECT session_id FROM funnel_events WHERE created_at >= now() - make_interval(days => $1::int)
         GROUP BY session_id HAVING bool_or(event = 'hold') AND NOT bool_or(event = 'confirmed')) x`,
      [r],
    ).catch(() => [{ n: 0 }]),
    query<{ src: string; sessions: number; confirmed: number }>(
      `WITH s AS (
         SELECT session_id, COALESCE(NULLIF(max(utm_source), ''), NULLIF(max(referrer), ''), 'directo') AS src, bool_or(event = 'confirmed') AS conf
         FROM funnel_events WHERE created_at >= now() - make_interval(days => $1::int) GROUP BY session_id)
       SELECT src, count(*)::int AS sessions, count(*) FILTER (WHERE conf)::int AS confirmed FROM s GROUP BY src ORDER BY 2 DESC LIMIT 12`,
      [r],
    ).catch(() => []),
    query<{ src: string; n: number }>(
      `SELECT COALESCE(NULLIF(utm_source, ''), 'directo') AS src, count(*)::int AS n FROM bookings
       WHERE status = 'CONFIRMED' AND source <> 'admin' AND confirmed_at >= now() - make_interval(days => $1::int) GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
      [r],
    ),
    query<{ dev: string; sessions: number; confirmed: number }>(
      `WITH s AS (
         SELECT session_id, COALESCE(max(device), 'desktop') AS dev, bool_or(event = 'confirmed') AS conf
         FROM funnel_events WHERE created_at >= now() - make_interval(days => $1::int) GROUP BY session_id)
       SELECT dev, count(*)::int AS sessions, count(*) FILTER (WHERE conf)::int AS confirmed FROM s GROUP BY dev ORDER BY 2 DESC`,
      [r],
    ).catch(() => []),
    query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM leads WHERE created_at >= now() - make_interval(days => $1::int) GROUP BY status`,
      [r],
    ).catch(() => []),
    query<{ name: string; citas: number; revenue: number }>(
      `SELECT bs.name, count(DISTINCT b.id)::int AS citas, COALESCE(SUM(bs.price_cents), 0)::int AS revenue
       FROM booking_services bs JOIN bookings b ON b.id = bs.booking_id
       WHERE b.status = 'CONFIRMED' AND b.attendance IS DISTINCT FROM 'NO_SHOW'
         AND b.starts_at >= now() - make_interval(days => $1::int) AND b.starts_at < now()
       GROUP BY bs.name ORDER BY 3 DESC, 2 DESC LIMIT 8`,
      [r],
    ),
    query<{ dow: number; h: number; n: number }>(
      `SELECT EXTRACT(DOW FROM b.starts_at AT TIME ZONE $2::text)::int AS dow, EXTRACT(HOUR FROM b.starts_at AT TIME ZONE $2::text)::int AS h, count(*)::int AS n
       FROM bookings b
       WHERE b.status = 'CONFIRMED' AND b.starts_at >= now() - make_interval(days => $1::int) AND b.starts_at < now()
       GROUP BY 1, 2`,
      [r, tz],
    ),
    query<DayRow>(DAYS_SQL, [addDays(today, -r), addDays(today, -1), tz]),
    query<DayRow>(DAYS_SQL, [today, addDays(today, 6), tz]),
    query<{ v1: number; v2: number; referred: number }>(
      `SELECT count(*) FILTER (WHERE visit_count >= 1)::int AS v1, count(*) FILTER (WHERE visit_count >= 2)::int AS v2,
              count(*) FILTER (WHERE referred_by IS NOT NULL)::int AS referred FROM customers`,
    ),
    query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (
         SELECT c.id, max(b.starts_at) AS last FROM customers c JOIN bookings b ON b.customer_id = c.id AND b.attendance = 'SHOWED' GROUP BY c.id) x
       WHERE x.last < now() - make_interval(days => COALESCE(NULLIF((SELECT value FROM settings WHERE key = 'reactivation_days' AND value ~ '^[0-9]+$')::int, 0), 75))
         AND NOT EXISTS (SELECT 1 FROM bookings f WHERE f.customer_id = x.id AND f.status = 'CONFIRMED' AND f.starts_at > now())`,
    ),
    query<{ value: string }>(`SELECT value FROM settings WHERE key = 'reactivation_days'`),
  ]);

  const k = kpi[0];
  const decided = k.showed + k.no_show;
  const revenue = k.revenue;
  const reactDays = Number(setting[0]?.value ?? 75) || 0;

  // Ocupación del periodo y huecos vacíos de los próximos 7 días
  const openPast = past.reduce((a, d) => a + d.open_min, 0);
  const bookedPast = past.reduce((a, d) => a + d.booked_min, 0);
  const occupancy = pct(bookedPast, openPast);
  const empties = next7.map((d) => ({ day: d.day, free: Math.max(0, d.open_min - d.booked_min), open: d.open_min }));
  const emptyTotal = empties.reduce((a, d) => a + d.free, 0);
  const maxFree = Math.max(1, ...empties.map((d) => d.free));

  // Embudo
  const counts = new Map(funnel.map((f) => [f.event, f.n]));
  const steps = STEPS.map((s) => ({ ...s, n: counts.get(s.key) ?? 0 }));
  const start = steps.find((s) => s.n > 0)?.n ?? 0;
  const hasFunnel = steps.some((s) => s.n > 0);
  let worst = -1;
  let worstLoss = 0;
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1].n;
    if (prev <= 0 || steps[i].key === "lead") continue; // «lead» es un desvío opcional, no un paso obligatorio
    const prevMain = steps[i].key === "confirmed" ? steps.slice(0, i).reverse().find((x) => x.key !== "lead")!.n : prev;
    const loss = prevMain - steps[i].n;
    if (loss > worstLoss) {
      worstLoss = loss;
      worst = i;
    }
  }
  const sessions = counts.get("landing") ?? start;
  const confirmedSessions = counts.get("confirmed") ?? 0;

  // Fuentes
  const bookMap = new Map(bookSrc.map((b) => [b.src, b.n]));
  const srcRows = sources.map((s) => ({ ...s, bookings: bookMap.get(s.src) ?? 0 }));
  for (const b of bookSrc) if (!srcRows.some((s) => s.src === b.src)) srcRows.push({ src: b.src, sessions: 0, confirmed: 0, bookings: b.n });

  // Leads
  const L = (s: string) => leads.find((l) => l.status === s)?.n ?? 0;
  const leadTotal = leads.reduce((a, l) => a + l.n, 0);
  const recovered = L("BOOKED");

  // Mapa de calor
  const heatMap = new Map(heat.map((h) => [`${h.dow}:${h.h}`, h.n]));
  const hours = heat.length ? Array.from({ length: Math.max(...heat.map((h) => h.h)) - Math.min(...heat.map((h) => h.h)) + 1 }, (_, i) => Math.min(...heat.map((h) => h.h)) + i) : [];
  const heatMax = Math.max(1, ...heat.map((h) => h.n));
  const maxTop = Math.max(1, ...top.map((t) => t.revenue));

  const re = retention[0];

  return (
    <main className="container admin">
      <AutoRefresh />
      <AdminNav active="panel" />

      <header className="kpi__head">
        <div>
          <h1 className="panel__title kpi__title">Panel</h1>
          <p className="muted">Cómo está yendo el negocio y por dónde se escapan las reservas.</p>
        </div>
        <nav className="kpi__range" aria-label="Periodo">
          {RANGES.map((n) => (
            <Link key={n} href={`/admin/panel?r=${n}`} className={`btn btn--sm ${n === r ? "btn--primary" : "btn--ghost"}`} aria-current={n === r ? "true" : undefined}>
              {n} días
            </Link>
          ))}
        </nav>
      </header>

      {/* 1 · Tarjetas */}
      <section className="kpi__cards" aria-label="Resumen">
        <article className="kpi__card">
          <span className="kpi__label">Citas online</span>
          <strong className="kpi__num">{k.online}</strong>
          <small>confirmadas en {r} días</small>
        </article>
        <article className="kpi__card">
          <span className="kpi__label">Ingresos</span>
          <strong className="kpi__num">{fmtPrice(revenue)}</strong>
          <small>de citas a las que vino</small>
        </article>
        <article className="kpi__card">
          <span className="kpi__label">Ticket medio</span>
          <strong className="kpi__num">{k.showed ? fmtPrice(Math.round(revenue / k.showed)) : "—"}</strong>
          <small>{k.showed} {k.showed === 1 ? "visita" : "visitas"}</small>
        </article>
        <article className={`kpi__card ${decided && pct(k.no_show, decided) >= 10 ? "kpi__card--warn" : ""}`}>
          <span className="kpi__label">Plantones</span>
          <strong className="kpi__num">{decided ? `${pct(k.no_show, decided)}%` : "—"}</strong>
          <small>{k.no_show} de {decided} citas cerradas</small>
        </article>
        <article className="kpi__card">
          <span className="kpi__label">Canceladas</span>
          <strong className="kpi__num">{k.past_total ? `${pct(k.past_cancelled, k.past_total)}%` : "—"}</strong>
          <small>{k.past_cancelled} de {k.past_total} citas</small>
        </article>
        <article className="kpi__card">
          <span className="kpi__label">Nuevas / recurrentes</span>
          <strong className="kpi__num">{k.new_c} <span className="kpi__sep">/</span> {k.rec_c}</strong>
          <small>clientas que reservaron</small>
        </article>
        <article className="kpi__card">
          <span className="kpi__label">Ocupación</span>
          <strong className="kpi__num">{openPast ? `${occupancy}%` : "—"}</strong>
          <small>{hm(bookedPast)} de {hm(openPast)} abiertas</small>
          <div className="kpi__bar" aria-hidden="true"><i style={{ width: `${Math.min(100, occupancy)}%` }} /></div>
        </article>
      </section>

      {/* 2 · Embudo */}
      <section className="panel">
        <h2 className="panel__title panel__title--sm">Embudo de reservas</h2>
        {!hasFunnel ? (
          <p className="muted">Todavía no hay visitas medidas. Se empieza a medir al instante: en cuanto alguien entre en la web o abra la reserva, verás aquí cuántas personas llegan a cada paso y dónde se quedan.</p>
        ) : (
          <>
            <p className="muted kpi__sum">
              <b>{sessions}</b> visitas · <b>{confirmedSessions}</b> reservas ({pct(confirmedSessions, sessions)}%) · <b>{aband[0]?.n ?? 0}</b> {(aband[0]?.n ?? 0) === 1 ? "persona bloqueó" : "personas bloquearon"} un hueco y no terminaron
            </p>
            <ol className="kpi__funnel">
              {steps.map((s, i) => {
                const prev = i > 0 ? (s.key === "confirmed" ? steps.slice(0, i).reverse().find((x) => x.key !== "lead")!.n : steps[i - 1].n) : 0;
                const width = start && s.n ? Math.max(2, Math.round((s.n / start) * 100)) : 0;
                return (
                  <li key={s.key} className={worst === i ? "is-worst" : ""}>
                    <div className="kpi__row">
                      <span className="kpi__step">{s.label}</span>
                      <span className="kpi__val">
                        <b>{s.n}</b>
                        {i > 0 && prev > 0 && s.key !== "lead" && <em> {Math.min(100, pct(s.n, prev))}% del paso anterior</em>}
                        {start > 0 && i > 0 && <em> · {Math.min(100, pct(s.n, start))}% del inicio</em>}
                      </span>
                    </div>
                    <div className="kpi__track"><i style={{ width: `${width}%` }} /></div>
                    {worst === i && <p className="kpi__flag">⚠ Aquí pierdes más gente: {steps[i - 1].key === "lead" ? "" : `${steps[i - 1].n - s.n} se quedan entre «${steps[i - 1].label}» y «${s.label}»`}</p>}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </section>

      {/* 3 y 4 · Origen y dispositivo */}
      <section className="panel">
        <h2 className="panel__title panel__title--sm">De dónde vienen</h2>
        {srcRows.length === 0 ? (
          <p className="muted">Aún no hay datos de origen. Cuando compartas enlaces con <code>?utm_source=instagram</code> (o similar), aparecerán aquí.</p>
        ) : (
          <div className="kpi__scroll">
            <table className="kpi__table">
              <thead><tr><th>Origen</th><th>Visitas</th><th>Reservas</th><th>Conversión</th><th>Citas</th></tr></thead>
              <tbody>
                {srcRows.map((s) => (
                  <tr key={s.src}><td>{s.src}</td><td>{s.sessions}</td><td>{s.confirmed}</td><td>{s.sessions ? `${pct(s.confirmed, s.sessions)}%` : "—"}</td><td>{s.bookings}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {devices.length > 0 && (
          <div className="kpi__devices">
            {devices.map((d) => (
              <div key={d.dev} className="kpi__dev">
                <span>{d.dev === "mobile" ? "📱 Móvil" : "💻 Ordenador"}</span>
                <b>{d.sessions ? `${pct(d.confirmed, d.sessions)}%` : "—"}</b>
                <small>{d.confirmed} de {d.sessions} visitas reservan</small>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 5 · Recuperación */}
      <section className="panel">
        <h2 className="panel__title panel__title--sm">Recuperación de abandonos</h2>
        {leadTotal === 0 ? (
          <p className="muted">Aún no hay contactos recogidos antes de confirmar. Cuando alguien deje su teléfono y no termine, se le escribirá una vez y verás aquí cuántas reservas se rescatan.</p>
        ) : (
          <div className="kpi__cards kpi__cards--sm">
            <article className="kpi__card"><span className="kpi__label">Pendientes</span><strong className="kpi__num">{L("NEW")}</strong><small>aún por si terminan</small></article>
            <article className="kpi__card"><span className="kpi__label">Avisadas</span><strong className="kpi__num">{L("MESSAGED")}</strong><small>con un mensaje</small></article>
            <article className="kpi__card"><span className="kpi__label">Recuperadas</span><strong className="kpi__num">{recovered}</strong><small>{pct(recovered, leadTotal)}% de {leadTotal} contactos</small></article>
          </div>
        )}
      </section>

      {/* 6 · Servicios y franjas */}
      <section className="panel">
        <h2 className="panel__title panel__title--sm">Servicios que más facturan</h2>
        {top.length === 0 ? (
          <p className="muted">Sin citas en este periodo.</p>
        ) : (
          <ul className="kpi__list">
            {top.map((t) => (
              <li key={t.name}>
                <div className="kpi__row"><span className="kpi__step">{t.name}</span><span className="kpi__val"><b>{fmtPrice(t.revenue)}</b><em> · {t.citas} {t.citas === 1 ? "cita" : "citas"}</em></span></div>
                <div className="kpi__track"><i style={{ width: `${Math.max(2, Math.round((t.revenue / maxTop) * 100))}%` }} /></div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2 className="panel__title panel__title--sm">Horas flojas y fuertes</h2>
        {hours.length === 0 ? (
          <p className="muted">Sin citas en este periodo para dibujar el mapa.</p>
        ) : (
          <div className="kpi__scroll">
            <table className="kpi__heat" aria-label="Citas por día y hora">
              <thead><tr><th />{WEEK.map((d) => <th key={d.dow}>{d.label}</th>)}</tr></thead>
              <tbody>
                {hours.map((h) => (
                  <tr key={h}>
                    <th>{String(h).padStart(2, "0")}h</th>
                    {WEEK.map((d) => {
                      const n = heatMap.get(`${d.dow}:${h}`) ?? 0;
                      return <td key={d.dow} title={`${n} ${n === 1 ? "cita" : "citas"}`} style={{ background: n ? `rgba(176, 32, 106, ${0.12 + 0.78 * (n / heatMax)})` : undefined, color: n / heatMax > 0.55 ? "#fff" : undefined }}>{n || ""}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted kpi__hint">Las casillas claras son tus horas flojas: ahí encajan ofertas de última hora o avisar a la lista de espera.</p>
      </section>

      <section className="panel">
        <h2 className="panel__title panel__title--sm">Huecos vacíos · próximos 7 días</h2>
        <p className="muted kpi__sum">Unas <b>{hm(emptyTotal)}</b> sin vender (aproximado: horas abiertas menos citas).</p>
        <ul className="kpi__list">
          {empties.map((d) => (
            <li key={d.day}>
              <div className="kpi__row"><span className="kpi__step">{dayName(d.day)}</span><span className="kpi__val">{d.open ? <><b>{hm(d.free)}</b><em> libres de {hm(d.open)}</em></> : <em>cerrado</em>}</span></div>
              <div className="kpi__track"><i style={{ width: d.open ? `${Math.max(2, Math.round((d.free / maxFree) * 100))}%` : "0%" }} /></div>
            </li>
          ))}
        </ul>
      </section>

      {/* 7 · Retención */}
      <section className="panel">
        <h2 className="panel__title panel__title--sm">Clientas que vuelven</h2>
        <div className="kpi__cards kpi__cards--sm">
          <article className="kpi__card"><span className="kpi__label">Repiten</span><strong className="kpi__num">{re.v1 ? `${pct(re.v2, re.v1)}%` : "—"}</strong><small>{re.v2} de {re.v1} clientas con visita</small></article>
          <article className={`kpi__card ${dormant[0]?.n ? "kpi__card--warn" : ""}`}><span className="kpi__label">Dormidas</span><strong className="kpi__num">{dormant[0]?.n ?? 0}</strong><small>sin venir hace +{reactDays > 0 ? reactDays : 75} días y sin cita</small></article>
          <article className="kpi__card"><span className="kpi__label">Traídas por amigas</span><strong className="kpi__num">{re.referred}</strong><small>clientas referidas</small></article>
        </div>
        <p className="muted kpi__hint">
          {reactDays > 0 ? `La reactivación automática escribe a las dormidas a los ${reactDays} días.` : "La reactivación automática está desactivada."}{" "}
          <Link href="/admin/clientas">Ver clientas →</Link>
        </p>
      </section>
    </main>
  );
}
