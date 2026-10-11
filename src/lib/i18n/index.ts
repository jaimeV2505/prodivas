import { en } from "./en";
import { es, type Dict } from "./es";
import { gl } from "./gl";
import { CATEGORY_I18N, SERVICE_I18N } from "./services";

export type Lang = "es" | "gl" | "en";
export type { Dict };
export const LANGS: Lang[] = ["es", "gl", "en"];
export const LANG_LABEL: Record<Lang, string> = { es: "Castellano", gl: "Galego", en: "English" };
export const LOCALE: Record<Lang, string> = { es: "es-ES", gl: "gl-ES", en: "en-GB" };
/** Formato de precios: en gallego se escribe «18 €», igual que en castellano. */
export const MONEY_LOCALE: Record<Lang, string> = { es: "es-ES", gl: "es-ES", en: "en-GB" };
const DICTS: Record<Lang, Dict> = { es, gl, en };

export const isLang = (x: unknown): x is Lang => x === "es" || x === "gl" || x === "en";
export const getDict = (lang: Lang): Dict => DICTS[lang];

/** Idioma: ?lang= → cookie pd_lang → idioma del navegador → castellano. */
export function pickLang(param?: string | null, cookie?: string | null, acceptLanguage?: string | null): Lang {
  if (isLang(param)) return param;
  if (isLang(cookie)) return cookie;
  const first = (acceptLanguage ?? "").toLowerCase().split(",").map((x) => x.trim().slice(0, 2));
  for (const c of first) {
    if (c === "gl") return "gl";
    if (c === "en") return "en";
    if (c === "es" || c === "ca" || c === "eu") return "es";
  }
  return "es";
}

/** Sustituye {nombre} por su valor. */
export function fill(text: string, vars: Record<string, string | number> = {}): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

type I18nJson = Partial<Record<"gl" | "en", { name?: string; description?: string; title?: string; body?: string }>>;

/** Nombre y descripción traducidos de un servicio (diccionario por slug) o de cualquier fila con columna i18n. */
export function localized<T extends { slug?: string; name: string; description?: string | null; i18n?: I18nJson }>(item: T, lang: Lang): { name: string; description: string | null } {
  if (lang === "es") return { name: item.name, description: item.description ?? null };
  const fromRow = item.i18n?.[lang];
  const fromSvc = item.slug ? SERVICE_I18N[item.slug]?.[lang] : undefined;
  return {
    name: fromRow?.name ?? fromSvc?.name ?? item.name,
    description: fromRow?.description ?? fromSvc?.description ?? item.description ?? null,
  };
}
export const localCategory = (cat: string, lang: Lang): string => (lang === "es" ? cat : CATEGORY_I18N[cat]?.[lang] ?? cat);
