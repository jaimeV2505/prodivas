/**
 * «¿Qué manicura eres?»: tres preguntas y una recomendación (un servicio o un pack ya pensado). Lógica pura, sin textos:
 * las preguntas y respuestas se escriben en el idioma de la clienta en src/lib/i18n.
 */
export type Time = "short" | "normal" | "long";
export type Style = "natural" | "classic" | "bold";
export type Last = "event" | "weeks" | "max";
export type QuizAnswers = { time: Time; style: Style; last: Last };
export type QuizResultId = "quick" | "daily" | "pair" | "full";

/** Qué servicios (por slug, en orden de preferencia) y qué extra recomienda cada resultado. */
export const QUIZ_SLUGS: Record<QuizResultId, string[]> = {
  quick: ["manicura-clasica"],
  daily: ["manicura-semipermanente"],
  pair: ["manicura-semipermanente", "pedicura-semipermanente"],
  full: ["manicura-semipermanente", "pedicura-semipermanente", "hilo-cejas"],
};

export function quizResult(a: QuizAnswers): QuizResultId {
  if (a.last === "event") return a.time === "long" ? "pair" : "quick";
  if (a.last === "weeks") return a.time === "long" ? "pair" : "daily";
  // «lo máximo posible»
  if (a.time === "short") return "daily";
  return a.style === "bold" && a.time === "long" ? "full" : "pair";
}

/** Los atrevidos suman un nail art sencillo (si existe ese extra). */
export const quizAddon = (a: QuizAnswers): string | null => (a.style === "bold" ? "nail-art-sencillo" : null);

/** Servicios del resultado que existen en el catálogo (si falta alguno se omite; si no queda ninguno, el primero del catálogo). */
export function quizServices(id: QuizResultId, catalog: string[]): string[] {
  const ok = QUIZ_SLUGS[id].filter((s) => catalog.includes(s));
  return ok.length ? ok : catalog.slice(0, 1);
}
