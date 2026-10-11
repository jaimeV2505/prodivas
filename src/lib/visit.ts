import { run, type Runner } from "./db";
import { BookingError } from "./errors";

/** Servicios en un solo bloque (con acompañante puede haber varios) y citas separadas como máximo. */
export const MAX_SERVICES = 6;
export const MAX_LEGS = 4;

export type VisitItem = {
  id: number;
  slug: string;
  name: string;
  category: string;
  durationMin: number;
  priceCents: number;
  depositCents: number;
  depositAlways: boolean;
  bufferMin: number;
  stepMin: number;
  consentKind: string | null;
};

/** Extra que suma tiempo y precio (retirada de esmalte, nail art…). */
export type AddonItem = { id: number; slug: string; name: string; durationMin: number; priceCents: number };

/** Una visita = uno o varios servicios seguidos con la misma profesional, más los extras elegidos. */
export type Visit = {
  items: VisitItem[];
  addons: AddonItem[];
  name: string; // "Manicura + Pedicura"
  durationMin: number; // suma de duraciones (servicios + extras)
  priceCents: number; // servicios + extras, sin descuento de pack
  depositCents: number;
  bufferMin: number; // limpieza tras el último servicio
  stepMin: number; // el paso más fino de los servicios elegidos
};

type Row = {
  id: number;
  slug: string;
  name: string;
  category: string;
  duration_min: number;
  price_cents: number;
  deposit_cents: number;
  deposit_always: boolean;
  consent_kind: string | null;
  buffer_min: number;
  step_min: number;
};

type AddonRow = { id: number; slug: string; name: string; duration_min: number; price_cents: number; category: string | null };

export async function loadVisit(serviceIds: number[], q: Runner = run, addonIds: number[] = []): Promise<Visit> {
  // El mismo servicio puede repetirse (manicura para ti y para tu acompañante): se consulta una vez y se cuenta cada vez
  const ids = serviceIds;
  const distinct = Array.from(new Set(ids));
  if (ids.length < 1 || ids.length > MAX_SERVICES) throw new BookingError("INVALID", `Elige entre 1 y ${MAX_SERVICES} servicios.`, 400);
  const rows = (await q(
    `SELECT id, slug, name, category, duration_min, price_cents, deposit_cents, deposit_always, consent_kind, buffer_min,
            COALESCE(slot_step_min, duration_min) AS step_min
     FROM services WHERE id = ANY($1::int[]) AND active`,
    [distinct],
  )) as unknown as Row[];
  if (rows.length !== distinct.length) throw new BookingError("NOT_FOUND", "Alguno de los servicios ya no está disponible.", 404);

  const byId = new Map(rows.map((r) => [r.id, r]));
  const items: VisitItem[] = ids.map((id) => {
    const r = byId.get(id)!;
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      category: r.category,
      durationMin: r.duration_min,
      priceCents: r.price_cents,
      depositCents: r.deposit_cents,
      depositAlways: r.deposit_always,
      bufferMin: r.buffer_min,
      stepMin: r.step_min,
      consentKind: r.consent_kind,
    };
  });

  // Extras: tienen que existir, estar activos y ser compatibles con alguno de los servicios (por categoría)
  const aIds = Array.from(new Set(addonIds));
  if (aIds.length > 6) throw new BookingError("INVALID", "Demasiados extras.", 400);
  let addons: AddonItem[] = [];
  if (aIds.length) {
    const ar = (await q(`SELECT id, slug, name, duration_min, price_cents, category FROM addons WHERE id = ANY($1::int[]) AND active`, [aIds])) as unknown as AddonRow[];
    if (ar.length !== aIds.length) throw new BookingError("NOT_FOUND", "Alguno de los extras ya no está disponible.", 404);
    const cats = new Set(items.map((i) => i.category));
    const aById = new Map(ar.map((a) => [a.id, a]));
    addons = aIds.map((id) => {
      const a = aById.get(id)!;
      if (a.category && !cats.has(a.category)) throw new BookingError("INVALID", `«${a.name}» no se puede añadir a estos servicios.`, 400);
      return { id: a.id, slug: a.slug, name: a.name, durationMin: a.duration_min, priceCents: a.price_cents };
    });
  }

  return {
    items,
    addons,
    name: items.map((i) => i.name).join(" + "),
    durationMin: items.reduce((a, i) => a + i.durationMin, 0) + addons.reduce((a, x) => a + x.durationMin, 0),
    priceCents: items.reduce((a, i) => a + i.priceCents, 0) + addons.reduce((a, x) => a + x.priceCents, 0),
    depositCents: items.reduce((a, i) => a + i.depositCents, 0),
    bufferMin: items[items.length - 1].bufferMin,
    stepMin: Math.max(5, Math.min(...items.map((i) => i.stepMin))),
  };
}
