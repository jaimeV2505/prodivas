import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { audit } from "./audit";
import { query } from "./db";
import { siteUrl } from "./site";
import { blocked, hit } from "./ratelimit";

const COOKIE = "pd_admin";
const MAX_AGE_S = 60 * 60 * 24 * 3;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Falta SESSION_SECRET en el entorno.");
  }
  return "dev-only-secret";
}

const sign = (v: string) => createHmac("sha256", secret()).update(v).digest("hex");
const sha = (v: string) => createHash("sha256").update(v).digest();
const safeEq = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

/** «Época» de las sesiones: subirla cierra la sesión de todos los dispositivos a la vez. */
async function epoch(): Promise<string> {
  const r = await query<{ value: string }>(`SELECT value FROM settings WHERE key = 'admin_epoch'`);
  return r[0]?.value ?? "1";
}

export async function isAdmin(): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;
  const [exp, ep, sig] = raw.split(".");
  if (!exp || !ep || !sig || Number(exp) < Date.now()) return false;
  if (!safeEq(sig, sign(`${exp}.${ep}`))) return false;
  return ep === (await epoch());
}

async function ipKey(): Promise<string> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return createHash("sha256").update(ip + secret()).digest("hex").slice(0, 24);
}

export async function loginAdmin(password: string): Promise<{ ok: boolean; error?: string }> {
  const ip = await ipKey();
  // Fuerza bruta: 6 fallos en 15 min por conexión, y 40 por hora entre todas
  if ((await blocked(`login-fail:${ip}`, 6, 900)) || (await blocked("login-fail:all", 40, 3600))) {
    return { ok: false, error: "Demasiados intentos. Espera 15 minutos." };
  }
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !safeEq(password, expected)) {
    await hit(`login-fail:${ip}`);
    await hit("login-fail:all");
    await audit("login_fallido", ip);
    await new Promise((r) => setTimeout(r, 500));
    return { ok: false, error: "Contraseña incorrecta" };
  }
  const exp = String(Date.now() + MAX_AGE_S * 1000);
  const ep = await epoch();
  (await cookies()).set(COOKIE, `${exp}.${ep}.${sign(`${exp}.${ep}`)}`, {
    httpOnly: true,
    sameSite: "lax",
    // «Secure» solo si la web va por https (Safari rechaza esa cookie en http://localhost aunque sea una compilación de producción)
    secure: process.env.NODE_ENV === "production" && siteUrl().startsWith("https://"),
    path: "/",
    maxAge: MAX_AGE_S,
  });
  await audit("login", ip);
  return { ok: true };
}

export async function logoutAdmin(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** Cierra la sesión del panel en TODOS los dispositivos (por si se pierde un móvil o se comparte la contraseña). */
export async function revokeAllSessions(): Promise<void> {
  await query(
    `INSERT INTO settings (key, value) VALUES ('admin_epoch', '2')
     ON CONFLICT (key) DO UPDATE SET value = (settings.value::int + 1)::text`,
  );
  await audit("cerrar_todas_las_sesiones");
}
