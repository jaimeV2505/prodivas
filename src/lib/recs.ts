/**
 * Recomendaciones a partir de las visitas anteriores guardadas en el móvil de la clienta (sin servidor).
 * Lógica pura para poder probarla.
 */
export type VisitLike = { startsAt: string; slugs: string[]; color?: string };
export type RebookLike = { slug: string; rebookWeeks?: number | null };

const WEEK = 7 * 86400000;

/**
 * Servicios a los que «toca retoque»: los que tienen semanas de retoque, de la última vez que se los hizo, cuando ya
 * falta como mucho una semana para que se cumplan (hasta 26 semanas después) y no tiene otra cita futura con ellos.
 */
export function dueRetouch(history: VisitLike[], services: RebookLike[], nowMs: number): { slug: string; weeks: number; since: number }[] {
  const weeksOf = new Map(services.filter((s) => s.rebookWeeks && s.rebookWeeks >= 1).map((s) => [s.slug, s.rebookWeeks as number]));
  const last = new Map<string, number>();
  const booked = new Set<string>();
  for (const v of history) {
    const t = new Date(v.startsAt).getTime();
    for (const slug of v.slugs) {
      if (!weeksOf.has(slug)) continue;
      if (t > nowMs) booked.add(slug);
      else if (!last.has(slug) || t > (last.get(slug) as number)) last.set(slug, t);
    }
  }
  const out: { slug: string; weeks: number; since: number }[] = [];
  for (const [slug, t] of last) {
    if (booked.has(slug)) continue;
    const since = Math.floor((nowMs - t) / WEEK);
    const due = weeksOf.get(slug) as number;
    if (since >= due - 1 && since <= 26) out.push({ slug, weeks: since, since });
  }
  return out.sort((a, b) => b.since - a.since);
}

/** Color de esmalte que eligió la última vez («Color: Rosa chicle» en los comentarios de la cita). */
export function lastColor(history: VisitLike[]): string | null {
  for (const v of [...history].sort((a, b) => (a.startsAt < b.startsAt ? 1 : -1))) if (v.color) return v.color;
  return null;
}
export const colorFromNotes = (notes: string): string | undefined => /(?:^|\n)\s*Color:\s*([^\n]{1,40})/i.exec(notes)?.[1]?.trim() || undefined;
