/**
 * «¿Mejor la movemos?»: de todos los huecos libres elige los 3 que mejor le vienen a quien iba a cancelar:
 * los más cercanos en el calendario y, a igualdad, a una hora parecida; en días distintos si es posible.
 * Lógica pura (sin base de datos) para poder probarla.
 */
export type AltSlot = { startsAt: string; day: string; minutes: number };

const dayNum = (d: string) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000);

export function pickAlternatives(free: AltSlot[], orig: { startsAt: string; day: string; minutes: number }, n = 3): AltSlot[] {
  const origDay = dayNum(orig.day);
  const scored = free
    .filter((s) => s.startsAt !== orig.startsAt)
    .map((s) => ({ s, score: Math.abs(dayNum(s.day) - origDay) * 1000 + Math.abs(s.minutes - orig.minutes) }))
    .sort((a, b) => a.score - b.score || (a.s.startsAt < b.s.startsAt ? -1 : 1));
  const out: AltSlot[] = [];
  const days = new Set<string>();
  for (const x of scored) {
    if (out.length >= n) break;
    if (days.has(x.s.day)) continue; // primero, un hueco por día
    days.add(x.s.day);
    out.push(x.s);
  }
  for (const x of scored) {
    if (out.length >= n) break;
    if (!out.includes(x.s)) out.push(x.s); // si no hay días suficientes, se completa con más horas
  }
  return out.sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
}
