/** Citas reservadas desde este móvil (código + token), para «Tus citas». Solo se usa en el navegador. */
const KEY = "pd_bookings";
export type SavedRef = { code: string; token: string };

export function loadSaved(): SavedRef[] {
  try {
    const raw = localStorage.getItem(KEY);
    let arr: SavedRef[] = raw ? (JSON.parse(raw) as SavedRef[]) : [];
    // Migración: antes solo se guardaba la última cita
    const last = localStorage.getItem("pd_last");
    if (last) {
      const l = JSON.parse(last) as { code?: string; token?: string };
      if (l?.code && l?.token && !arr.some((a) => a.code === l.code)) arr = [...arr, { code: l.code, token: l.token }];
      localStorage.removeItem("pd_last");
      localStorage.setItem(KEY, JSON.stringify(arr.slice(-20)));
    }
    return Array.isArray(arr) ? arr.slice(-20) : [];
  } catch {
    return [];
  }
}

export function saveBooking(code: string, token: string): void {
  try {
    const arr = loadSaved().filter((x) => x.code !== code);
    arr.push({ code, token });
    localStorage.setItem(KEY, JSON.stringify(arr.slice(-20)));
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

/* ---------- Historial de visitas en este móvil: para «como siempre» y «repetir lo de la última vez» ---------- */
import { localParts } from "./format";

const HKEY = "pd_visits";
export type VisitRecord = { startsAt: string; slugs: string[]; color?: string };

export function loadVisitHistory(): VisitRecord[] {
  try {
    const raw = localStorage.getItem(HKEY);
    const arr = raw ? (JSON.parse(raw) as VisitRecord[]) : [];
    return Array.isArray(arr) ? arr.filter((x) => x && typeof x.startsAt === "string" && Array.isArray(x.slugs)).slice(-12) : [];
  } catch {
    return [];
  }
}

export function saveVisitHistory(rec: VisitRecord): void {
  try {
    const arr = loadVisitHistory().filter((x) => x.startsAt !== rec.startsAt);
    arr.push(rec);
    localStorage.setItem(HKEY, JSON.stringify(arr.slice(-12)));
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

/** Día de la semana y hora que suele elegir (el día más repetido; la hora, la mediana de ese día). */
export function usualOf(history: VisitRecord[]): { dow: number; minutes: number } | null {
  if (!history.length) return null;
  const parts = history.map((h) => localParts(h.startsAt));
  const count = new Map<number, number>();
  for (const p of parts) count.set(p.dow, (count.get(p.dow) ?? 0) + 1);
  const best = Math.max(...count.values());
  // en un empate, gana el día de la visita más reciente
  const dow = [...parts].reverse().find((p) => count.get(p.dow) === best)!.dow;
  const mins = parts.filter((p) => p.dow === dow).map((p) => p.minutes).sort((a, b) => a - b);
  const median = mins[Math.floor(mins.length / 2)];
  return { dow, minutes: Math.round(median / 5) * 5 };
}
