/**
 * Qué servicios combinan bien: completar un pack (con ahorro) o los pares clásicos (manos y pies, pestañas y cejas).
 * Es lógica pura, sin textos: la pantalla pone las frases en el idioma de la clienta.
 */
export type PairReason = "pairFeet" | "pairHands" | "pairBrows" | "pairLashes";

export const PAIR_RULES: { when: RegExp; then: string[]; reason: PairReason }[] = [
  { when: /manicura/, then: ["pedicura-semipermanente", "pedicura"], reason: "pairFeet" },
  { when: /pedicura/, then: ["manicura-semipermanente", "manicura-clasica"], reason: "pairHands" },
  { when: /lifting|pestanas/, then: ["tinte-cejas", "hilo-cejas"], reason: "pairBrows" },
  { when: /cejas|microblading/, then: ["lifting-pestanas"], reason: "pairLashes" },
];

export type PackLike = { slug: string; serviceSlugs: string[]; discountPercent: number };
export type Suggestion =
  | { key: string; kind: "pack"; add: string[]; packSlug: string; percent: number }
  | { key: string; kind: "pair"; add: string[]; reason: PairReason };

/** `have`: servicios ya elegidos; `catalog`: servicios que existen; devuelve como mucho `max` sugerencias. */
export function suggest(o: { have: string[]; catalog: string[]; packs: PackLike[]; maxServices: number; max?: number }): Suggestion[] {
  const have = new Set(o.have);
  const exists = new Set(o.catalog);
  const out: Suggestion[] = [];
  const covered = new Set<string>();
  if (!o.have.length) return out;

  // 1) packs que ya empiezas a formar: todo lo que llevas está en el pack y faltan servicios
  for (const p of o.packs) {
    if (!o.have.every((s) => p.serviceSlugs.includes(s))) continue;
    const missing = p.serviceSlugs.filter((s) => !have.has(s));
    if (!missing.length || !missing.every((s) => exists.has(s))) continue;
    if (o.have.length + missing.length > o.maxServices) continue;
    out.push({ key: `pack-${p.slug}`, kind: "pack", add: missing, packSlug: p.slug, percent: p.discountPercent });
    missing.forEach((s) => covered.add(s));
  }
  // 2) pares clásicos que no estén ya cubiertos por un pack
  for (const slug of o.have) {
    for (const r of PAIR_RULES) {
      if (!r.when.test(slug)) continue;
      if (r.then.some((x) => covered.has(x))) continue; // ya hay un pack que cubre esta idea
      const pick = r.then.find((x) => exists.has(x) && !have.has(x) && !covered.has(x));
      if (pick && o.have.length < o.maxServices) {
        out.push({ key: `pair-${pick}`, kind: "pair", add: [pick], reason: r.reason });
        covered.add(pick);
      }
    }
  }
  return out.slice(0, o.max ?? 3);
}

/** ¿Los servicios elegidos son EXACTAMENTE los de algún pack? (el servidor aplica la misma regla) */
export function matchPack<T extends { serviceSlugs: string[] }>(have: string[], packs: T[]): T | null {
  const h = new Set(have);
  return packs.find((p) => p.serviceSlugs.length === have.length && p.serviceSlugs.length === h.size && p.serviceSlugs.every((s) => h.has(s))) ?? null;
}

/** Precio de un servicio con el descuento del pack (mismo redondeo que el servidor). */
export const discounted = (priceCents: number, percent: number): number => Math.round((priceCents * (100 - percent)) / 100);
