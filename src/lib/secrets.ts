import { createHmac } from "node:crypto";

/** Secreto derivado de SESSION_SECRET para una finalidad concreta (calendario, avisos de Twilio…). */
export function derivedSecret(label: string, length = 32): string {
  const base = process.env.SESSION_SECRET || "dev-only-secret";
  return createHmac("sha256", base).update(label).digest("hex").slice(0, length);
}
