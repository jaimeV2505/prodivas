/**
 * Fases de pose y recursos: de qué tramos se compone una visita y qué ocupa cada uno.
 * Funciones puras (sin base de datos) para poder probarlas a fondo. Diseño: docs/DISENO-FASES-Y-RECURSOS.md
 */
export type Phase = { kind: "active" | "wait"; minutes: number };
export type ResourceReq = { kind: string; uses: "all" | "active" };
/** Un tramo: `o` minutos después del inicio de la visita, durante `l` minutos. */
export type Seg = { o: number; l: number };
export type Req = { kind: string; ranges: Seg[] };

export type ItemShape = { durationMin: number; phases?: Phase[] | null; resources?: ResourceReq[] | null };
export type Pattern = {
  /** Minutos totales que dura la visita para la clienta, limpieza incluida (es lo que ocupa hoy un bloque simple). */
  total: number;
  /** Tramos en que la profesional está ocupada de verdad, ya unidos. */
  active: Seg[];
  /** Qué recursos hacen falta y durante qué tramos. */
  reqs: Req[];
  /** ¿Lleva tiempos de espera o recursos? Si no, se calcula con el motor de siempre. */
  complex: boolean;
};

/** Une tramos que se tocan o se solapan (ordenados por inicio). */
export function mergeSegs(segs: Seg[]): Seg[] {
  const s = segs.filter((x) => x.l > 0).sort((a, b) => a.o - b.o);
  const out: Seg[] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.o <= last.o + last.l) last.l = Math.max(last.l, x.o + x.l - last.o);
    else out.push({ ...x });
  }
  return out;
}

/** Fases de un servicio: sin fases definidas, todo es «actúa». Si no suman la duración, se ignoran (datos mal puestos). */
export function normalizePhases(durationMin: number, phases?: Phase[] | null): Phase[] {
  if (!phases || !phases.length) return [{ kind: "active", minutes: durationMin }];
  const sum = phases.reduce((a, p) => a + p.minutes, 0);
  if (sum !== durationMin || phases.some((p) => !(p.minutes > 0))) return [{ kind: "active", minutes: durationMin }];
  return phases;
}

export function buildPattern(items: ItemShape[], addonMin = 0, bufferMin = 0): Pattern {
  const active: Seg[] = [];
  const reqs: Req[] = [];
  let o = 0;
  let hasWait = false;
  items.forEach((it, idx) => {
    const phases = normalizePhases(it.durationMin, it.phases);
    const last = idx === items.length - 1;
    const itemActive: Seg[] = [];
    let c = o;
    for (const p of phases) {
      if (p.kind === "active") itemActive.push({ o: c, l: p.minutes });
      else hasWait = true;
      c += p.minutes;
    }
    active.push(...itemActive);
    // extras y limpieza van detrás del último servicio, con la profesional actuando
    const tail = last ? addonMin + bufferMin : 0;
    for (const r of it.resources ?? []) {
      const ranges = r.uses === "active" ? mergeSegs(itemActive) : [{ o, l: it.durationMin + tail }];
      reqs.push({ kind: r.kind, ranges });
    }
    o += it.durationMin;
  });
  if (addonMin + bufferMin > 0) active.push({ o, l: addonMin + bufferMin });
  return { total: o + addonMin + bufferMin, active: mergeSegs(active), reqs, complex: hasWait || reqs.length > 0 };
}

/** Patrón de una visita simple (un solo bloque, como siempre). */
export const simplePattern = (totalMin: number): Pattern => ({ total: totalMin, active: [{ o: 0, l: totalMin }], reqs: [], complex: false });

export type Block = { staffId?: number; resourceId?: number; start: Date; end: Date };

/** Bloques que escribe la aplicación para una cita con fases o recursos. `unitIds[i]` = unidad elegida para `pattern.reqs[i]`. */
export function buildBlocks(pattern: Pattern, startsAt: Date, staffId: number, unitIds: number[]): Block[] {
  const at = (m: number) => new Date(startsAt.getTime() + m * 60000);
  const out: Block[] = pattern.active.map((s) => ({ staffId, start: at(s.o), end: at(s.o + s.l) }));
  pattern.reqs.forEach((r, i) => {
    for (const g of mergeSegs(r.ranges)) out.push({ resourceId: unitIds[i], start: at(g.o), end: at(g.o + g.l) });
  });
  return out;
}

/** «Tinte · 1 h 45 min (incluye 45 min de pose)» — texto para la clienta. */
export function waitMinutes(items: ItemShape[]): number {
  return items.reduce((a, it) => a + normalizePhases(it.durationMin, it.phases).filter((p) => p.kind === "wait").reduce((x, p) => x + p.minutes, 0), 0);
}

/** Interpreta lo que escribe la dueña: «30 + 45e + 30» (la «e» marca espera) → fases. Devuelve null si no es válido. */
export function parsePhases(text: string): Phase[] | null {
  const parts = text.split(/[+,;]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) return [];
  const out: Phase[] = [];
  for (const p of parts) {
    const m = /^(\d{1,3})\s*(e|espera|a|activo)?$/.exec(p);
    if (!m) return null;
    const minutes = Number(m[1]);
    if (minutes <= 0) return null;
    out.push({ kind: m[2] === "e" || m[2] === "espera" ? "wait" : "active", minutes });
  }
  return out;
}

export function formatPhases(phases: Phase[]): string {
  return phases.map((p) => `${p.minutes}${p.kind === "wait" ? "e" : ""}`).join(" + ");
}
