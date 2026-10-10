/** URL pública del sitio (para los enlaces de los mensajes). */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3100";
}

/** Enlace corto de gestión: código + 12 primeros caracteres del token (cabe en un SMS). */
export function manageLink(code: string, token: string): string {
  return `${siteUrl()}/c/${code}?t=${token.slice(0, 12)}`;
}

/** Teléfono → solo dígitos con prefijo de país (asume España si son 9 dígitos). */
export function phoneDigits(phone: string): string {
  let d = phone.replace(/\D/g, "");
  if (phone.trim().startsWith("00")) d = d.slice(2);
  if (d.length === 9) d = `34${d}`;
  return d;
}

export const samePhone = (a: string, b: string) => phoneDigits(a).slice(-9) === phoneDigits(b).slice(-9);

/** Quita tildes (excepto la ñ) para que un SMS quepa en codificación GSM-7 y cueste menos. */
export function gsm(s: string): string {
  return s
    .replace(/ñ/g, "\u0001")
    .replace(/Ñ/g, "\u0002")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0001/g, "ñ")
    .replace(/\u0002/g, "Ñ");
}
