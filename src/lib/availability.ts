import { CONFIG } from "./config";
import { run, type Runner } from "./db";

export type SlotRow = {
  day: string; // YYYY-MM-DD (hora del salón)
  time: string; // HH:MM (hora del salón)
  startsAt: string; // ISO UTC
  staffId: number;
  available: boolean;
};

export type Slot = {
  day: string;
  time: string;
  startsAt: string;
  available: boolean;
  staffIds: number[]; // profesionales libres en ese hueco
};

export type SlotMode = "smart" | "compact" | "flex";
export const SLOT_MODES: Record<SlotMode, { label: string; help: string }> = {
  smart: {
    label: "Sin restos (recomendado)",
    help: "Ofrece las horas redondas y también las pegadas a otras citas, pero nunca un hueco que deje un resto más corto que tu servicio más corto.",
  },
  compact: {
    label: "Compacto",
    help: "Solo ofrece horas pegadas al inicio o al final de un hueco libre. Mantiene el día lo más seguido posible, con menos opciones para elegir.",
  },
  flex: {
    label: "Libre",
    help: "Rejilla fija por servicio (huecos cada 30 min para un servicio de 30). Más sencillo, pero pueden quedar restos sueltos entre citas.",
  },
};

type Raw = { day: string; time: string; starts_at: Date; staff_id: number; available: boolean };

/**
 * Tramos libres: para cada profesional y bloque de trabajo (antes y después de la pausa, con su horario
 * propio si lo tiene) se restan las citas CONFIRMADAS (incluida su limpieza), los bloqueos en curso
 * (HOLD vivos) y el tiempo libre del salón o de esa profesional.
 *   $1 desde · $2 hasta · $3 zona horaria · $4 profesional (o NULL) · $5 cita a ignorar (al cambiar de hora)
 */
const WINDOWS = `
WITH days AS (
  SELECT d::date AS day FROM generate_series($1::date, $2::date, interval '1 day') AS d
),
segs AS (
  SELECT days.day, s.id AS staff_id, seg.s_from, seg.s_to
  FROM days
  CROSS JOIN staff s
  JOIN business_hours h ON h.weekday = EXTRACT(DOW FROM days.day)::int AND NOT h.closed
  LEFT JOIN staff_hours sh ON sh.staff_id = s.id AND sh.weekday = h.weekday
  CROSS JOIN LATERAL (
    SELECT CASE WHEN sh.staff_id IS NULL THEN h.open_time   ELSE sh.open_time   END AS open_time,
           CASE WHEN sh.staff_id IS NULL THEN h.close_time  ELSE sh.close_time  END AS close_time,
           CASE WHEN sh.staff_id IS NULL THEN h.break_start ELSE sh.break_start END AS break_start,
           CASE WHEN sh.staff_id IS NULL THEN h.break_end   ELSE sh.break_end   END AS break_end,
           COALESCE(sh.closed, false) AS closed
  ) e
  CROSS JOIN LATERAL (
    SELECT ((days.day + e.open_time) AT TIME ZONE $3::text) AS s_from,
           ((days.day + COALESCE(e.break_start, e.close_time)) AT TIME ZONE $3::text) AS s_to
    UNION ALL
    SELECT ((days.day + e.break_end) AT TIME ZONE $3::text),
           ((days.day + e.close_time) AT TIME ZONE $3::text)
    WHERE e.break_start IS NOT NULL AND e.break_end IS NOT NULL
  ) seg
  WHERE s.active AND ($4::int IS NULL OR s.id = $4::int)
    AND NOT e.closed AND e.open_time IS NOT NULL AND e.close_time IS NOT NULL
),
busy AS (
  SELECT sg.staff_id, sg.day, sg.s_from, sg.s_to,
         COALESCE(range_agg(tstzrange(x.ra, x.rb, '[)')) FILTER (WHERE x.ra IS NOT NULL), '{}'::tstzmultirange) AS busy
  FROM segs sg
  LEFT JOIN LATERAL (
    SELECT b.starts_at AS ra, b.blocked_until AS rb FROM bookings b
     WHERE b.staff_id = sg.staff_id
       AND (b.status = 'CONFIRMED' OR (b.status = 'HOLD' AND b.hold_expires_at > now()))
       AND ($5::uuid IS NULL OR b.id <> $5::uuid)
       AND tstzrange(b.starts_at, b.blocked_until, '[)') && tstzrange(sg.s_from, sg.s_to, '[)')
    UNION ALL
    SELECT t.starts_at, t.ends_at FROM time_off t
     WHERE (t.staff_id IS NULL OR t.staff_id = sg.staff_id)
       AND tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(sg.s_from, sg.s_to, '[)')
  ) x ON true
  GROUP BY sg.staff_id, sg.day, sg.s_from, sg.s_to
),
wins AS (
  SELECT bz.staff_id, bz.day, lower(w.r) AS wa, upper(w.r) AS wb
  FROM busy bz
  CROSS JOIN LATERAL unnest(tstzmultirange(tstzrange(bz.s_from, bz.s_to, '[)')) - bz.busy) AS w(r)
)`;

/**
 * Huecos para una visita. $6 minutos necesarios (duración + limpieza) · $7 paso · $8 preaviso (min)
 * $9 modo · $10 resto mínimo (min)
 *
 * - Rejilla (anclada al inicio de cada bloque): se marca ocupada si choca con algo.
 * - Rejilla anclada al inicio de cada tramo libre + "pegado al final" del tramo.
 * - Regla de restos: no se ofrece un hueco que deje, antes o después, un resto libre (distinto de 0)
 *   más corto que el servicio más corto.
 */
const SLOTS_SQL = `${WINDOWS},
grid AS (
  SELECT bz.day, bz.staff_id, gs AS starts_at, gs + make_interval(mins => $6::int) AS ends_at
  FROM busy bz
  CROSS JOIN LATERAL generate_series(bz.s_from, bz.s_to - make_interval(mins => $6::int), make_interval(mins => $7::int)) AS gs
),
grid_eval AS (
  SELECT g.day, g.staff_id, g.starts_at, g.ends_at, w.wa, w.wb
  FROM grid g
  LEFT JOIN wins w ON w.staff_id = g.staff_id AND w.wa <= g.starts_at AND g.ends_at <= w.wb
),
anchored AS (
  SELECT w.day, w.staff_id, gs AS starts_at, gs + make_interval(mins => $6::int) AS ends_at, w.wa, w.wb
  FROM wins w
  CROSS JOIN LATERAL generate_series(w.wa, w.wb - make_interval(mins => $6::int), make_interval(mins => $7::int)) AS gs
  UNION
  SELECT w.day, w.staff_id, w.wb - make_interval(mins => $6::int), w.wb, w.wa, w.wb
  FROM wins w WHERE w.wb - w.wa >= make_interval(mins => $6::int)
),
offers AS (
  SELECT ge.day, ge.staff_id, ge.starts_at,
         (ge.wa IS NOT NULL) AS available,
         CASE WHEN ge.wa IS NULL THEN true
              ELSE ($9::text = 'flex') OR (
                ((ge.starts_at - ge.wa) = interval '0' OR (ge.starts_at - ge.wa) >= make_interval(mins => $10::int))
                AND ((ge.wb - ge.ends_at) = interval '0' OR (ge.wb - ge.ends_at) >= make_interval(mins => $10::int)))
         END AS visible
  FROM grid_eval ge
  WHERE $9::text <> 'compact'
  UNION ALL
  SELECT a.day, a.staff_id, a.starts_at, true,
         ((a.starts_at - a.wa) = interval '0' OR (a.starts_at - a.wa) >= make_interval(mins => $10::int))
         AND ((a.wb - a.ends_at) = interval '0' OR (a.wb - a.ends_at) >= make_interval(mins => $10::int))
  FROM anchored a
  WHERE $9::text <> 'flex'
)
SELECT * FROM (
  SELECT DISTINCT ON (r.staff_id, r.starts_at)
         r.day::text AS day,
         to_char(r.starts_at AT TIME ZONE $3::text, 'HH24:MI') AS time,
         r.starts_at, r.staff_id, r.available
  FROM offers r
  WHERE r.visible AND r.starts_at > now() + make_interval(mins => $8::int)
  ORDER BY r.staff_id, r.starts_at, r.available DESC
) d
ORDER BY d.starts_at, d.staff_id
`;

/** Cuántas citas de esta visita caben de verdad en el rango (escasez honesta). $6 minutos necesarios · $7 preaviso */
const CAPACITY_SQL = `${WINDOWS}
SELECT COALESCE(SUM(FLOOR(
         EXTRACT(EPOCH FROM (w.wb - GREATEST(w.wa, now() + make_interval(mins => $7::int)))) / 60 / $6::int
       )), 0)::int AS n
FROM wins w
WHERE w.wb > now() + make_interval(mins => $7::int)
`;

export async function getSlotMode(q: Runner = run): Promise<SlotMode> {
  const r = (await q(`SELECT value FROM settings WHERE key = 'slot_mode'`)) as unknown as { value: string }[];
  const v = r[0]?.value ?? process.env.SLOT_MODE ?? "smart";
  return v === "compact" || v === "flex" ? v : "smart";
}

export async function getSlotRows(
  opts: {
    from: string;
    to: string;
    durationMin: number;
    bufferMin?: number | null;
    stepMin?: number | null;
    staffId?: number | null;
    excludeBookingId?: string | null;
  },
  q: Runner = run,
): Promise<SlotRow[]> {
  const mode = await getSlotMode(q);
  const md = (await q(`SELECT COALESCE(MIN(duration_min), 15) AS m FROM services WHERE active`)) as unknown as { m: number }[];
  const minRest = Math.min(60, Math.max(5, Number(md[0]?.m ?? 15)));

  const rows = (await q(SLOTS_SQL, [
    opts.from,
    opts.to,
    CONFIG.tz,
    opts.staffId ?? null,
    opts.excludeBookingId ?? null,
    opts.durationMin + (opts.bufferMin ?? 0),
    Math.max(5, opts.stepMin ?? opts.durationMin),
    CONFIG.minNoticeMin,
    mode,
    minRest,
  ])) as unknown as Raw[];

  return rows.map((r) => ({
    day: r.day,
    time: r.time,
    startsAt: new Date(r.starts_at).toISOString(),
    staffId: r.staff_id,
    available: r.available,
  }));
}

export async function getCapacity(
  opts: { from: string; to: string; durationMin: number; bufferMin?: number | null; staffId?: number | null },
  q: Runner = run,
): Promise<number> {
  const r = (await q(CAPACITY_SQL, [
    opts.from,
    opts.to,
    CONFIG.tz,
    opts.staffId ?? null,
    null,
    opts.durationMin + (opts.bufferMin ?? 0),
    CONFIG.minNoticeMin,
  ])) as unknown as {
    n: number;
  }[];
  return Number(r[0]?.n ?? 0);
}

/** Une las filas por (día, hora): un hueco está libre si lo está alguna profesional. */
export function groupSlots(rows: SlotRow[]): Slot[] {
  const map = new Map<string, Slot>();
  for (const r of rows) {
    const key = `${r.day}|${r.time}`;
    let s = map.get(key);
    if (!s) {
      s = { day: r.day, time: r.time, startsAt: r.startsAt, available: false, staffIds: [] };
      map.set(key, s);
    }
    if (r.available) {
      s.available = true;
      s.staffIds.push(r.staffId);
    }
  }
  return Array.from(map.values());
}
