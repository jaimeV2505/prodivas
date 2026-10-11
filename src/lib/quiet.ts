import { CONFIG } from "./config";

const num = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== undefined && process.env[k] !== "" ? v : d;
};
/** Horas de silencio (hora local del salón): no se mandan recordatorios entre QUIET_START y QUIET_END. */
export const QUIET = { start: () => num("QUIET_START", 22), end: () => num("QUIET_END", 8) };
/** Hora a la que sale el recordatorio de la víspera. */
export const EVENING_HOUR = () => num("REMINDER_EVENING_HOUR", 19);
/** Los mensajes opcionales (cómo ha ido, retoque) solo salen de día. */
export const OPTIONAL_WINDOW = { from: () => num("OPTIONAL_FROM", 10), to: () => num("OPTIONAL_TO", 20) };
export { num as envNumber };

/** Hora local del salón (0–23). */
export function localHour(d = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: CONFIG.tz, hour: "2-digit", hour12: false }).format(d)) % 24;
}
/** ¿Es hora de silencio? Soporta que cruce la medianoche (22 → 8). */
export function isQuiet(hour: number, start = QUIET.start(), end = QUIET.end()): boolean {
  return start === end ? false : start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
export const inWindow = (hour: number, from: number, to: number) => hour >= from && hour < to;
