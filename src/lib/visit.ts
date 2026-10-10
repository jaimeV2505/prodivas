import { run, type Runner } from "./db";
import { BookingError } from "./errors";

export type VisitItem = {
  id: number;
  name: string;
  durationMin: number;
  priceCents: number;
  depositCents: number;
  bufferMin: number;
  stepMin: number;
};

/** Una visita = uno o varios servicios seguidos con la misma profesional. */
export type Visit = {
  items: VisitItem[];
  name: string; // "Manicura + Pedicura"
  durationMin: number; // suma de duraciones
  priceCents: number;
  depositCents: number;
  bufferMin: number; // limpieza tras el último servicio
  stepMin: number; // el paso más fino de los servicios elegidos
};

type Row = {
  id: number;
  name: string;
  duration_min: number;
  price_cents: number;
  deposit_cents: number;
  buffer_min: number;
  step_min: number;
};

export async function loadVisit(serviceIds: number[], q: Runner = run): Promise<Visit> {
  const ids = Array.from(new Set(serviceIds));
  if (ids.length < 1 || ids.length > 4) throw new BookingError("INVALID", "Elige entre 1 y 4 servicios.", 400);
  const rows = (await q(
    `SELECT id, name, duration_min, price_cents, deposit_cents, buffer_min, COALESCE(slot_step_min, duration_min) AS step_min
     FROM services WHERE id = ANY($1::int[]) AND active`,
    [ids],
  )) as unknown as Row[];
  if (rows.length !== ids.length) throw new BookingError("NOT_FOUND", "Alguno de los servicios ya no está disponible.", 404);

  const byId = new Map(rows.map((r) => [r.id, r]));
  const items: VisitItem[] = ids.map((id) => {
    const r = byId.get(id)!;
    return {
      id: r.id,
      name: r.name,
      durationMin: r.duration_min,
      priceCents: r.price_cents,
      depositCents: r.deposit_cents,
      bufferMin: r.buffer_min,
      stepMin: r.step_min,
    };
  });
  return {
    items,
    name: items.map((i) => i.name).join(" + "),
    durationMin: items.reduce((a, i) => a + i.durationMin, 0),
    priceCents: items.reduce((a, i) => a + i.priceCents, 0),
    depositCents: items.reduce((a, i) => a + i.depositCents, 0),
    bufferMin: items[items.length - 1].bufferMin,
    stepMin: Math.max(5, Math.min(...items.map((i) => i.stepMin))),
  };
}
