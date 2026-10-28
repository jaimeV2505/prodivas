import { query } from "./db";
import { BookingError } from "./errors";

/**
 * Límite de peticiones guardado en Postgres (vale en serverless, donde la memoria no se comparte).
 * Devuelve false si `key` ya alcanzó `max` golpes en los últimos `windowSec` segundos; si no, apunta uno y devuelve true.
 */
/** Solo para las pruebas automáticas (nunca en producción real): DISABLE_RATE_LIMITS=1 y NODE_ENV distinto de production, o DEMO_MODE=on. */
const off = () => process.env.DISABLE_RATE_LIMITS === "1" && (process.env.NODE_ENV !== "production" || process.env.DEMO_MODE === "on");

export async function allow(key: string, max: number, windowSec: number): Promise<boolean> {
  if (off()) return true;
  const r = await query(
    `WITH c AS (SELECT count(*)::int AS n FROM rate_hits WHERE key = $1 AND at > now() - make_interval(secs => $2::int))
     INSERT INTO rate_hits (key) SELECT $1 FROM c WHERE n < $3::int RETURNING id`,
    [key, windowSec, max],
  );
  return r.length > 0;
}

/** Igual que `allow`, pero lanza el error 429 con el mensaje que verá la clienta. */
export async function limit(key: string, max: number, windowSec: number, message = "Demasiados intentos. Espera un momento y vuelve a probar."): Promise<void> {
  if (!(await allow(key, max, windowSec))) throw new BookingError("LIMIT", message, 429);
}

/**
 * Máximo de valores DISTINTOS por clave (p. ej. teléfonos distintos desde una misma IP en un día).
 * Repetir un valor ya visto no cuenta.
 */
export async function distinctLimit(prefix: string, value: string, max: number, windowSec: number, message: string): Promise<void> {
  if (off()) return;
  const key = `${prefix}:${value}`;
  const seen = await query(`SELECT 1 FROM rate_hits WHERE key = $1 AND at > now() - make_interval(secs => $2::int) LIMIT 1`, [key, windowSec]);
  if (seen.length) return;
  const n = await query<{ n: number }>(
    `SELECT count(DISTINCT key)::int AS n FROM rate_hits WHERE key LIKE $1 || ':%' AND at > now() - make_interval(secs => $2::int)`,
    [prefix, windowSec],
  );
  if ((n[0]?.n ?? 0) >= max) throw new BookingError("LIMIT", message, 429);
  await query(`INSERT INTO rate_hits (key) VALUES ($1)`, [key]);
}

export async function purgeRateHits(): Promise<void> {
  await query(`DELETE FROM rate_hits WHERE at < now() - interval '2 days'`);
}

/** ¿Ya se alcanzó el límite? (sin apuntar nada). Se usa con `hit` para contar solo los fallos. */
export async function blocked(key: string, max: number, windowSec: number): Promise<boolean> {
  if (off()) return false;
  const r = await query<{ n: number }>(`SELECT count(*)::int AS n FROM rate_hits WHERE key = $1 AND at > now() - make_interval(secs => $2::int)`, [key, windowSec]);
  return (r[0]?.n ?? 0) >= max;
}
export async function hit(key: string): Promise<void> {
  await query(`INSERT INTO rate_hits (key) VALUES ($1)`, [key]);
}
