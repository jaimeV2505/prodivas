import { createHmac } from "node:crypto";

/** Secreto derivado de SESSION_SECRET para una finalidad concreta (calendario, avisos de Twilio…). */
export function derivedSecret(label: string, length = 32): string {
  let base = process.env.SESSION_SECRET;
  if (!base) {
    // Sin secreto propio los enlaces firmados serían predecibles: en producción es un error, no un valor por defecto.
    if (process.env.NODE_ENV === "production") throw new Error("Falta SESSION_SECRET en el entorno.");
    base = "dev-only-secret";
  }
  return createHmac("sha256", base).update(label).digest("hex").slice(0, length);
}
