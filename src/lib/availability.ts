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

type Raw = { day: string; time: string; starts_at: Date; staff_id: number; available: boolean };

// Una sola consulta genera la parrilla de huecos (horario - pausa), y marca cada
// uno como ocupado si choca con una cita CONFIRMADA, un bloqueo (HOLD vivo) o
// "time_off". Se descartan huecos pasados o dentro del preaviso mínimo.
const SQL = `
WITH days AS (
  SELECT d::date AS day FROM generate_series($1::date, $2::date, interval '1 day') AS d
),
cand AS (
  SELECT
    days.day,
    s.id AS staff_id,
    gs AS starts_at,
    gs + make_interval(mins => $4::int) AS ends_at,
    ((days.day + h.break_start) AT TIME ZONE $3::text) AS break_from,
    ((days.day + h.break_end)   AT TIME ZONE $3::text) AS break_to
  FROM days
  JOIN business_hours h
    ON h.weekday = EXTRACT(DOW FROM days.day)::int AND NOT h.closed
  CROSS JOIN staff s
  CROSS JOIN LATERAL generate_series(
    ((days.day + h.open_time) AT TIME ZONE $3::text),
    (((days.day + h.close_time) AT TIME ZONE $3::text) - make_interval(mins => $4::int)),
    make_interval(mins => $5::int)
  ) AS gs
  WHERE s.active AND ($7::int IS NULL OR s.id = $7::int)
)
SELECT
  c.day::text AS day,
  to_char(c.starts_at AT TIME ZONE $3::text, 'HH24:MI') AS time,
  c.starts_at,
  c.staff_id,
  (
    NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.staff_id = c.staff_id
        AND (b.status = 'CONFIRMED' OR (b.status = 'HOLD' AND b.hold_expires_at > now()))
        AND tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(c.starts_at, c.ends_at, '[)')
    )
    AND NOT EXISTS (
      SELECT 1 FROM time_off t
      WHERE (t.staff_id IS NULL OR t.staff_id = c.staff_id)
        AND tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(c.starts_at, c.ends_at, '[)')
    )
  ) AS available
FROM cand c
WHERE c.starts_at > now() + make_interval(mins => $6::int)
  AND (
    c.break_from IS NULL
    OR NOT (tstzrange(c.starts_at, c.ends_at, '[)') && tstzrange(c.break_from, c.break_to, '[)'))
  )
ORDER BY c.starts_at, c.staff_id
`;

export async function getSlotRows(
  opts: { from: string; to: string; durationMin: number; staffId?: number | null },
  q: Runner = run,
): Promise<SlotRow[]> {
  const rows = (await q(SQL, [
    opts.from,
    opts.to,
    CONFIG.tz,
    opts.durationMin,
    CONFIG.slotStepMin,
    CONFIG.minNoticeMin,
    opts.staffId ?? null,
  ])) as unknown as Raw[];

  return rows.map((r) => ({
    day: r.day,
    time: r.time,
    startsAt: new Date(r.starts_at).toISOString(),
    staffId: r.staff_id,
    available: r.available,
  }));
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
