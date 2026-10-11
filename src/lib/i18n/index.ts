import { es, type Dict } from "./es";

/** Todos los textos de la web están en castellano. Este módulo solo reparte esos textos y rellena los {huecos}. */
export type { Dict };
export const getDict = (): Dict => es;
export const LOCALE = "es-ES";

/** Sustituye {nombre} por su valor. */
export function fill(text: string, vars: Record<string, string | number> = {}): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}
