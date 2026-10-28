import { randomInt } from "node:crypto";
import { query } from "./db";
import { phoneDigits, siteUrl } from "./site";

/** «Trae a una amiga»: cada clienta tiene un código; cuando su amiga viene por primera vez, las dos ganan un premio. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

export type ReferralSettings = { enabled: boolean; reward: string };

export async function getReferralSettings(): Promise<ReferralSettings> {
  const rows = await query<{ key: string; value: string }>(`SELECT key, value FROM settings WHERE key IN ('referral_enabled','referral_reward')`);
  const m = new Map(rows.map((r) => [r.key, r.value]));
  return { enabled: m.get("referral_enabled") !== "off", reward: m.get("referral_reward") || "un premio" };
}

/** Código de amiga de una clienta (se crea la primera vez que se pide). */
export async function ensureReferralCode(customerId: number): Promise<string> {
  const cur = await query<{ referral_code: string | null }>(`SELECT referral_code FROM customers WHERE id = $1::bigint`, [customerId]);
  if (cur[0]?.referral_code) return cur[0].referral_code;
  for (let i = 0; i < 6; i++) {
    const code = newCode();
    const r = await query<{ referral_code: string }>(
      `UPDATE customers SET referral_code = $2 WHERE id = $1::bigint AND referral_code IS NULL
         AND NOT EXISTS (SELECT 1 FROM customers WHERE referral_code = $2) RETURNING referral_code`,
      [customerId, code],
    );
    if (r[0]) return r[0].referral_code;
    const again = await query<{ referral_code: string | null }>(`SELECT referral_code FROM customers WHERE id = $1::bigint`, [customerId]);
    if (again[0]?.referral_code) return again[0].referral_code;
  }
  throw new Error("No se pudo crear el código de amiga");
}

export const referralLink = (code: string) => `${siteUrl()}/reservar?ref=${code}&utm_source=amiga`;

/**
 * Se llama justo después de confirmar una reserva con `?ref=CÓDIGO`: si quien reserva es nueva
 * (su ficha se acaba de crear) y el código es de otra clienta, queda como «traída por».
 */
export async function registerReferral(phone: string | null, ref: string | undefined | null): Promise<void> {
  if (!phone || !ref || !/^[A-Za-z0-9]{4,12}$/.test(ref)) return;
  try {
    if (!(await getReferralSettings()).enabled) return;
    const key = phoneDigits(phone).slice(-9);
    await query(
      `UPDATE customers c SET referred_by = r.id
       FROM customers r
       WHERE c.phone_key = $1 AND r.referral_code = $2 AND r.id <> c.id
         AND c.referred_by IS NULL AND c.visit_count = 0 AND c.created_at > now() - interval '30 minutes'`,
      [key, ref.toUpperCase()],
    );
  } catch (e) {
    console.error("[referral]", e);
  }
}
