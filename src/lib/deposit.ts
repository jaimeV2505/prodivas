import type { Runner } from "./db";
import { phoneDigits } from "./site";

/**
 * Política de la señal (se cambia en /admin/ajustes):
 *  - "service": la pide cualquier servicio que tenga señal (como siempre).
 *  - "repeat": solo la paga quien ya ha faltado sin avisar (y los servicios marcados «siempre»).
 */
export type DepositPolicy = { mode: "service" | "repeat"; afterNoShows: number; defaultCents: number };

export async function getDepositPolicy(q?: Runner): Promise<DepositPolicy> {
  q ??= (await import("./db")).run; // carga perezosa: así la lógica se puede probar sin base de datos
  const rows = (await q(`SELECT key, value FROM settings WHERE key IN ('deposit_policy','deposit_after_no_shows','deposit_default_cents')`)) as unknown as { key: string; value: string }[];
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const after = Number(m.get("deposit_after_no_shows") ?? 1);
  const cents = Number(m.get("deposit_default_cents") ?? 1000);
  return {
    mode: m.get("deposit_policy") === "repeat" ? "repeat" : "service",
    afterNoShows: Number.isFinite(after) && after >= 1 ? Math.floor(after) : 1,
    defaultCents: Number.isFinite(cents) && cents >= 0 ? Math.floor(cents) : 1000,
  };
}

/** Veces que esta clienta no ha venido (0 si es nueva). Nunca se muestra a la clienta: solo decide si se le pide señal. */
export async function noShowsOf(q: Runner, phone: string): Promise<number> {
  const key = phoneDigits(phone).slice(-9);
  if (key.length < 6) return 0;
  const r = (await q(`SELECT no_show_count FROM customers WHERE phone_key = $1`, [key])) as unknown as { no_show_count: number }[];
  return r[0]?.no_show_count ?? 0;
}

/**
 * Señal que toca de verdad cuando ya se sabe quién es la clienta (señal inteligente: solo a quien ya ha faltado).
 * Si la política es «según el servicio», o hay cobros desactivados, o la clienta no tiene plantones, no cambia nada.
 */
export async function effectiveDeposit(q: Runner, bookingId: string, phone: string, holdDeposit: number, stripeOn: boolean): Promise<number> {
  if (!stripeOn) return holdDeposit;
  const pol = await getDepositPolicy(q);
  if (pol.mode !== "repeat") return holdDeposit;
  if ((await noShowsOf(q, phone)) < pol.afterNoShows) return holdDeposit;
  const sum = ((await q(`SELECT COALESCE(SUM(deposit_cents), 0)::int AS s FROM booking_services WHERE booking_id = $1::uuid`, [bookingId])) as unknown as { s: number }[])[0].s;
  const eff = Math.max(holdDeposit, sum, pol.defaultCents);
  if (eff !== holdDeposit) await q(`UPDATE bookings SET deposit_cents = $2::int WHERE id = $1::uuid`, [bookingId, eff]);
  return eff;
}
