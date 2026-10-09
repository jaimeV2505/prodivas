import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "pd_admin";
const MAX_AGE_S = 60 * 60 * 24 * 7;

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

export async function isAdmin(): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;
  const [exp, sig] = raw.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEq(sig, sign(exp));
}

export async function loginAdmin(password: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !safeEq(password, expected)) {
    await new Promise((r) => setTimeout(r, 500)); // frena la fuerza bruta
    return false;
  }
  const exp = String(Date.now() + MAX_AGE_S * 1000);
  (await cookies()).set(COOKIE, `${exp}.${sign(exp)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  });
  return true;
}

export async function logoutAdmin(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
