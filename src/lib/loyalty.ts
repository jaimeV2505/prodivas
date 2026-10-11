import type { Runner } from "./db";

/** Programa de sellos: cada visita a la que vino suma un sello; al completar la tarjeta hay un premio (se canjea a mano). */
export type Loyalty = { enabled: boolean; every: number; reward: string };

export async function getLoyalty(q?: Runner): Promise<Loyalty> {
  q ??= (await import("./db")).run; // carga perezosa: así la lógica se puede probar sin base de datos
  const rows = (await q(`SELECT key, value FROM settings WHERE key IN ('loyalty_enabled','loyalty_every','loyalty_reward')`)) as unknown as { key: string; value: string }[];
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const every = Number(m.get("loyalty_every") ?? 10);
  return {
    enabled: m.get("loyalty_enabled") === "on",
    every: Number.isFinite(every) && every >= 2 && every <= 50 ? Math.floor(every) : 10,
    reward: m.get("loyalty_reward") || "un premio",
  };
}

/**
 * Sellos de una clienta: `progress` de la tarjeta actual (0…every) y `rewards` premios pendientes de canjear.
 * Con 10 visitas y 0 canjes: tarjeta llena y 1 premio; al canjearlo, la tarjeta vuelve a empezar.
 */
export function stampsOf(visitCount: number, redeemed: number, every: number): { progress: number; rewards: number } {
  const earned = Math.floor(Math.max(0, visitCount) / every);
  const rewards = Math.max(0, earned - Math.max(0, redeemed));
  const progress = Math.min(every, Math.max(0, visitCount - Math.max(0, redeemed) * every));
  return { progress, rewards };
}
