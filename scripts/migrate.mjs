// Aplica db/schema.sql (idempotente) y, solo la primera vez, db/seed.sql.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.warn("[migrate] DATABASE_URL no está definida: se omite la migración.");
  process.exit(0);
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 20; i++) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      return client;
    } catch (err) {
      await client.end().catch(() => {});
      if (i === 19) throw err;
      console.log(`[migrate] esperando a la base de datos (${i + 1}/20)...`);
      await sleep(1500);
    }
  }
}

const client = await connect();
try {
  // Evita carreras si varios despliegues migran a la vez
  await client.query("SELECT pg_advisory_lock(7412001)");
  await client.query(readFileSync(path.join(dir, "schema.sql"), "utf8"));
  const { rows } = await client.query("SELECT count(*)::int AS n FROM services");
  if (rows[0].n === 0 && process.env.SEED_ON_MIGRATE !== "false") {
    await client.query(readFileSync(path.join(dir, "seed.sql"), "utf8"));
    console.log("[migrate] datos iniciales cargados.");
  }
  await client.query("SELECT pg_advisory_unlock(7412001)");
  console.log("[migrate] OK");
} finally {
  await client.end();
}
