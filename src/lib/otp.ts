import { createHash, randomInt } from "node:crypto";
import { query } from "./db";
import { BookingError } from "./errors";
import { limit } from "./ratelimit";
import { devMode, enabled, logSend, sendSms, sendWhatsAppTemplate } from "./messaging";
import { derivedSecret } from "./secrets";
import { gsm, phoneDigits } from "./site";

/**
 * Verificación del teléfono con un código de 6 cifras, para frenar reservas falsas y mensajes a números ajenos.
 *  PHONE_VERIFY = off | new (solo teléfonos nuevos, por defecto) | all
 * Quien ya vino alguna vez (o ya verificó su número) no vuelve a ver el código: cero fricción para las de siempre.
 */
export type VerifyMode = "off" | "new" | "all";
export function verifyMode(): VerifyMode {
  const v = (process.env.PHONE_VERIFY ?? "").toLowerCase();
  if (v === "off" || v === "all" || v === "new") return v;
  // por defecto: se pide si hay un canal real para mandar el código (o estamos en local para probarlo)
  return enabled.sms() || enabled.whatsapp() || devMode() ? "new" : "off";
}

const key9 = (phone: string) => phoneDigits(phone).slice(-9);
const hash = (phone: string, code: string) => createHash("sha256").update(`${derivedSecret("otp", 32)}:${key9(phone)}:${code}`).digest("hex");
const TTL_MIN = 10;

/** ¿Esta clienta es de confianza (ya vino o ya verificó su teléfono hace poco)? */
async function trusted(phone: string): Promise<boolean> {
  const k = key9(phone);
  const r = await query(
    `SELECT 1 FROM customers WHERE phone_key = $1 AND (visit_count > 0 OR verified_at IS NOT NULL)
     UNION ALL
     SELECT 1 FROM phone_otps WHERE phone_key = $1 AND used_at IS NOT NULL AND used_at > now() - interval '180 days' LIMIT 1`,
    [k],
  );
  return r.length > 0;
}

export async function needsVerification(phone: string): Promise<boolean> {
  const m = verifyMode();
  if (m === "off") return false;
  if (m === "all") return !(await recentlyVerified(phone));
  return !(await trusted(phone));
}

async function recentlyVerified(phone: string): Promise<boolean> {
  const r = await query(`SELECT 1 FROM phone_otps WHERE phone_key = $1 AND used_at IS NOT NULL AND used_at > now() - interval '30 minutes' LIMIT 1`, [key9(phone)]);
  return r.length > 0;
}

/** Manda un código nuevo (como mucho uno por minuto y 5 por hora y teléfono). Devuelve el código solo en local. */
export async function sendOtp(phone: string, ipKey: string): Promise<{ devCode?: string; sent: boolean }> {
  const k = key9(phone);
  const recent = await query(`SELECT 1 FROM phone_otps WHERE phone_key = $1 AND created_at > now() - interval '60 seconds' AND used_at IS NULL LIMIT 1`, [k]);
  if (recent.length) return { sent: false };
  await limit(`otp-phone:${k}`, 5, 3600, "Ya te hemos enviado varios códigos. Espera un rato o llámanos.");
  await limit(`otp-ip:${ipKey}`, 12, 3600, "Demasiados códigos pedidos desde esta conexión. Inténtalo más tarde.");
  const code = String(randomInt(100000, 1000000));
  await query(`INSERT INTO phone_otps (phone_key, code_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3::int))`, [k, hash(phone, code), TTL_MIN]);
  const text = `Pro Diva: tu codigo para reservar es ${code}. Caduca en ${TTL_MIN} min. No lo compartas.`;
  let delivered = false;
  if (enabled.whatsapp() && process.env.WA_TEMPLATE_OTP) {
    const r = await sendWhatsAppTemplate(phone, process.env.WA_TEMPLATE_OTP, [code], [{ kind: "url", suffix: code }]);
    await logSend(null, "otp", "whatsapp", r);
    delivered = r.ok;
  }
  if (!delivered && enabled.sms()) {
    const r = await sendSms(phone, gsm(text));
    await logSend(null, "otp", "sms", r);
    delivered = r.ok;
  }
  if (!delivered && devMode()) {
    await logSend(null, "otp", "dev", { ok: true, detail: `→ ${phone}: ${text}` });
    console.log(`[otp:dev] ${phone} → ${code}`);
    return { sent: true, devCode: code };
  }
  if (!delivered) throw new BookingError("INVALID", "No hemos podido enviarte el código. Llámanos para reservar.", 502);
  return { sent: true };
}

/** Comprueba el código (5 intentos por código). Si es correcto, marca el teléfono como verificado. */
export async function checkOtp(phone: string, code: string): Promise<void> {
  const k = key9(phone);
  const rows = await query<{ id: number; code_hash: string; attempts: number }>(
    `SELECT id, code_hash, attempts FROM phone_otps WHERE phone_key = $1 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`,
    [k],
  );
  const row = rows[0];
  if (!row) throw new BookingError("VERIFY", "El código ha caducado. Te enviamos uno nuevo.", 401);
  if (row.attempts >= 5) throw new BookingError("VERIFY", "Demasiados intentos. Te enviamos un código nuevo.", 401);
  if (row.code_hash !== hash(phone, code.trim())) {
    await query(`UPDATE phone_otps SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    throw new BookingError("VERIFY", `Ese código no es correcto (te quedan ${Math.max(0, 4 - row.attempts)} intentos).`, 401, { wrong: true });
  }
  await query(`UPDATE phone_otps SET used_at = now() WHERE id = $1`, [row.id]);
  await query(`UPDATE customers SET verified_at = COALESCE(verified_at, now()) WHERE phone_key = $1`, [k]);
}

/**
 * Puerta única para confirmar una reserva: si el teléfono necesita verificarse y aún no hay código, manda uno
 * y responde VERIFY (la pantalla pide el código y vuelve a enviar el formulario con `otp`).
 */
export async function requirePhoneProof(phone: string, otp: string | undefined, ipKey: string): Promise<void> {
  if (!(await needsVerification(phone))) return;
  if (otp && /^\d{6}$/.test(otp.trim())) {
    await checkOtp(phone, otp);
    return;
  }
  const r = await sendOtp(phone, ipKey);
  throw new BookingError(
    "VERIFY",
    r.sent ? "Te hemos enviado un código por mensaje. Escríbelo para confirmar tu cita." : "Te enviamos un código hace un momento. Escríbelo para confirmar.",
    401,
    r.devCode ? { devCode: r.devCode } : undefined,
  );
}
