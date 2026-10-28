import { query } from "./db";

/** Anota qué se hizo en el panel (quién, qué y sobre qué). Nunca rompe la acción si falla. */
export async function audit(action: string, target?: string | null, detail?: string | null): Promise<void> {
  try {
    await query(`INSERT INTO audit_log (action, target, detail) VALUES ($1, $2, $3)`, [action, target ?? null, detail ? detail.slice(0, 500) : null]);
  } catch (e) {
    console.error("[audit]", e);
  }
}
