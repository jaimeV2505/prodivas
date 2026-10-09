import { Pool } from "pg";

const g = globalThis as unknown as { __pgPool?: Pool };

export const pool: Pool =
  g.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX ?? 5),
  });
g.__pgPool = pool;

/** Ejecuta una consulta y devuelve solo las filas. */
export type Runner = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

export const run: Runner = async (sql, params = []) => (await pool.query(sql, params)).rows;

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

/** Transacción: BEGIN / COMMIT / ROLLBACK con un cliente dedicado. */
export async function tx<T>(
  fn: (q: Runner, raw: import("pg").PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const q: Runner = async (sql, params = []) => (await client.query(sql, params)).rows;
    const out = await fn(q, client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
