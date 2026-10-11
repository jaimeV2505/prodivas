import { createHmac, timingSafeEqual } from "node:crypto";
import { derivedSecret } from "./secrets";
import { siteUrl } from "./site";

/**
 * Enlace de baja de los mensajes opcionales («cómo ha ido», «toca retoque»). Va firmado para que nadie
 * pueda dar de baja a otra persona probando números; se confirma con un botón (POST), no con abrir el enlace.
 */
const sig = (id: number) => createHmac("sha256", derivedSecret("optout", 32)).update(String(id)).digest("hex").slice(0, 24);
export const optoutToken = (customerId: number): string => `${customerId}.${sig(customerId)}`;
export const optoutUrl = (customerId: number): string => `${siteUrl()}/baja/${optoutToken(customerId)}`;

export function parseOptoutToken(token: string): number | null {
  const m = /^(\d{1,9})\.([0-9a-f]{24})$/.exec(token);
  if (!m) return null;
  const id = Number(m[1]);
  const want = Buffer.from(sig(id));
  const got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}
