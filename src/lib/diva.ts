import { PAIR_RULES, suggest } from "./combos";
import { CONFIG } from "./config";
import { addDays, todayIn } from "./dates";
import { fmtDuration, fmtPrice } from "./format";
import { fill, getDict, type Dict } from "./i18n";
import type { Trend } from "./trends";

/**
 * El «cerebro» de Diva, la chica del avatar. Funciona SIN inteligencia artificial: responde con reglas y con los
 * datos reales del salón (servicios, precios, duraciones, packs, horario, cuidados, política de cancelación) y las
 * tendencias que la dueña edita en /admin/ajustes. Entiende sinónimos y erratas comunes, nunca da consejos médicos
 * (deriva al teléfono) y no inventa nada que no esté en los datos. Para lo abierto, el chat puede apoyarse en la IA
 * opcional (src/lib/divaAi.ts + /api/diva), pero las respuestas con datos exactos salen siempre de aquí.
 */
export type DivaService = {
  slug: string;
  name: string;
  category: string;
  durationMin: number;
  priceCents: number;
  /** Datos extra, si el que llama los tiene (el chat los completa con /api/diva). */
  id?: number;
  description?: string | null;
  waitMin?: number;
  aftercare?: string | null;
  depositCents?: number;
};
export type DivaPack = { slug: string; name: string; serviceSlugs: string[]; discountPercent: number; people?: number };
/** Lo que solo sabe el servidor (se pide a GET /api/diva): horario, política, cuidados, pose y señal por servicio. */
export type DivaInfo = {
  hours?: string[];
  services?: Record<string, { id: number; waitMin: number; aftercare: string | null; depositCents: number }>;
  policy?: { cancelHours: number; refundHours: number; rescheduleHours: number };
};
export type DivaCtx = {
  trends: Trend[];
  services: DivaService[];
  packs: DivaPack[];
  selected: string[];
  step: string;
  address: string;
  /** Día de hoy (AAAA-MM-DD, hora del salón); si falta se calcula. Sirve para entender «mañana», «el viernes»… */
  today?: string;
  info?: DivaInfo;
};
export type DivaAction = { label: string; slug: string; kind: "service" | "pack" };
export type DivaCard = { slug: string; kind: "service" | "pack"; title: string; meta: string; note?: string };
/** Pregunta por huecos: el chat la resuelve consultando /api/availability. */
export type AvailAsk = { day: string; days: number; part: "any" | "morning" | "afternoon"; label: string; slugs: string[] };
export type DivaMsg = {
  text: string;
  action?: DivaAction;
  /** Tarjetas con botón «Reservar esto» (servicios o packs). */
  cards?: DivaCard[];
  links?: { label: string; href: string }[];
  /** Hay que consultar huecos reales. */
  ask?: AvailAsk;
  /** Qué ha entendido (para pruebas y para que el chat decida entre reglas e IA). */
  intent?: string;
  /** true = respuesta con datos exactos: manda sobre la IA. */
  exact?: boolean;
};
/** Contadores para ir rotando tendencias y consejos sin repetir siempre lo mismo. */
export type Rot = Record<string, number>;

/* ------------------------------------------------------------------ */
/* Texto: tildes, erratas y parecidos                                  */
/* ------------------------------------------------------------------ */

export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Quita tildes, abreviaturas de móvil y letras repetidas («holaaa», «q tal», «xq»). */
export function fix(raw: string): string {
  return norm(raw)
    .replace(/[¿¡?!.,;:"()]/g, " ")
    .replace(/(.)\1{2,}/g, "$1")
    .replace(/\bxq\b|\bpq\b|\bporq\b/g, "porque")
    .replace(/\bq\b|\bke\b|\bk\b/g, "que")
    .replace(/\bmanyana\b/g, "manana")
    .replace(/\bxfa\b|\bpls\b|\bporfa\b/g, "por favor")
    .replace(/\bhrs?\b/g, "horas")
    .replace(/\s+/g, " ")
    .trim();
}

/** Distancia de edición (para perdonar una letra mal puesta en palabras largas). */
export function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** ¿Hay en la frase una palabra igual o casi igual (1 letra) a alguna de estas? */
const close = (q: string, words: string[]) => q.split(" ").some((w) => w.length >= 5 && words.some((t) => t.length >= 5 && lev(w, t) <= 1));

const PHONE = CONFIG.salon.phoneMobile;
const WA = `https://wa.me/${CONFIG.salon.whatsapp}`;
const T = (_c?: DivaCtx): Dict => getDict();
const money = (c: number) => fmtPrice(c);

export const quickChips = (): { label: string; q: string }[] => {
  const d = getDict();
  return [
    { label: d.divaChipTrend, q: d.divaChipTrendQ },
    { label: d.divaChipRec, q: d.divaChipRecQ },
    { label: d.divaChipDur, q: d.divaChipDurQ },
    { label: d.divaChipPrice, q: d.divaChipPriceQ },
  ];
};

/** Preguntas rápidas según el paso en el que va la clienta. */
export function contextChips(step: string, chosen: number, done = false): { label: string; q: string }[] {
  if (done || step === "done") {
    return [
      { label: "Cuidados después ✨", q: "¿qué cuidados tengo que tener después?" },
      { label: "¿Cambio la hora?", q: "¿cómo cambio la hora?" },
      { label: "¿Dónde estáis? 📍", q: "¿dónde estáis?" },
    ];
  }
  if (step === "details") {
    return [
      { label: "¿Cómo cancelo?", q: "¿cómo cancelo mi cita?" },
      { label: "¿Lleva señal? 💳", q: "¿hay que pagar señal?" },
      { label: "¿Dónde estáis? 📍", q: "¿dónde estáis?" },
      { label: "Llego tarde 🏃", q: "¿y si llego tarde?" },
    ];
  }
  if (chosen > 0 || step === "time" || step === "day" || step === "staff") {
    return [
      { label: "¿Hay hueco hoy? 📅", q: "¿hay hueco hoy?" },
      { label: "¿Y mañana?", q: "¿hay hueco mañana?" },
      { label: "Esta tarde 🌇", q: "¿hay hueco esta tarde?" },
      { label: "¿Cuánto dura? ⏱️", q: "¿cuánto dura?" },
      { label: "¿Cuánto cuesta? 💶", q: "¿cuánto cuesta?" },
    ];
  }
  return [
    { label: "¿Qué se lleva? 🔥", q: "¿qué se lleva ahora?" },
    { label: "Recomiéndame ✨", q: "recomiéndame algo" },
    { label: "Algo rápido ⏱️", q: "algo rápido de menos de 30 minutos" },
    { label: "¿Hay hueco hoy? 📅", q: "¿hay hueco hoy?" },
    { label: "Packs 🎁", q: "¿qué packs tenéis?" },
  ];
}

export function greeting(ctx: Pick<DivaCtx, "step" | "selected" | "services">): string {
  const sel = ctx.services.filter((s) => ctx.selected.includes(s.slug));
  if (ctx.step === "done") return "¡Cita confirmada! 🎉 Si quieres te cuento qué cuidados te vienen bien después, o dónde estamos.";
  if (ctx.step === "details") return "¡Casi lista! 💖 Si dudas con la señal, cancelar o cómo llegar, pregúntame.";
  if (sel.length) return `Has elegido ${sel.map((s) => s.name).join(" + ")} 💅 Te busco huecos reales cuando quieras: pregúntame «¿hay hueco mañana?».`;
  return "¡Hola! Soy Diva 💖 Dime qué te apetece (o cuánto tiempo y presupuesto tienes) y te aconsejo, o te busco un hueco libre ahora mismo.";
}

/* ------------------------------------------------------------------ */
/* Servicios y datos                                                    */
/* ------------------------------------------------------------------ */

const svc = (ctx: DivaCtx, slug: string) => ctx.services.find((s) => s.slug === slug);

/** El servicio con los datos extra que sepa el servidor (pose, cuidados, señal). */
function full(ctx: DivaCtx, s: DivaService): DivaService {
  const i = ctx.info?.services?.[s.slug];
  return i ? { ...s, id: s.id ?? i.id, waitMin: s.waitMin ?? i.waitMin, aftercare: s.aftercare ?? i.aftercare, depositCents: s.depositCents ?? i.depositCents } : s;
}

function offerService(ctx: DivaCtx, slug: string | null | undefined): DivaAction | undefined {
  if (!slug || ctx.selected.includes(slug)) return undefined;
  const s = svc(ctx, slug);
  if (!s) return undefined;
  const first = ctx.step === "service" || ctx.selected.length === 0;
  return { label: fill(first ? T(ctx).divaOfferChoose : T(ctx).divaOfferAdd, { name: s.name }), slug, kind: "service" };
}

const cardOf = (s: DivaService, ctx: DivaCtx, note?: string): DivaCard => {
  const f = full(ctx, s);
  return { slug: s.slug, kind: "service", title: s.name, meta: `${fmtDuration(s.durationMin)}${f.waitMin ? ` (incluye ${f.waitMin} min de pose)` : ""} · ${money(s.priceCents)}`, note };
};
const packCard = (p: DivaPack, ctx: DivaCtx): DivaCard => {
  const names = p.serviceSlugs.map((x) => svc(ctx, x)?.name).filter(Boolean).join(" + ");
  const dur = p.serviceSlugs.reduce((a, x) => a + (svc(ctx, x)?.durationMin ?? 0), 0);
  return { slug: p.slug, kind: "pack", title: p.name, meta: `${names}${dur ? ` · ${fmtDuration(dur)}` : ""}${p.discountPercent > 0 ? ` · −${p.discountPercent} %` : ""}`, note: p.people === 2 ? "Para dos" : undefined };
};

/** Pone la primera tarjeta como `action` (así el avatar de la reserva completa, que solo muestra un botón, también la ofrece). */
function withCards(text: string, cards: DivaCard[], ctx: DivaCtx, extra: Partial<DivaMsg> = {}): DivaMsg {
  const c = cards[0];
  const action = c ? (c.kind === "service" ? offerService(ctx, c.slug) : { label: fill(T(ctx).divaOfferPack, { name: c.title }), slug: c.slug, kind: "pack" as const }) : undefined;
  return { text, cards: cards.length ? cards : undefined, action, ...extra };
}

/** Tendencia con su emoji, su título y su texto. */
export function trendMessage(tr: Trend, ctx: DivaCtx): DivaMsg {
  return { text: `${tr.emoji} ${tr.title}: ${tr.body}`, action: offerService(ctx, tr.serviceSlug), intent: "trend" };
}

/** Siguiente tendencia (de un tema, o de cualquiera), rotando. */
export function nextTrend(ctx: DivaCtx, rot: Rot, topic?: string): DivaMsg {
  const d = T(ctx);
  const list = topic ? ctx.trends.filter((x) => x.topic === topic) : ctx.trends;
  if (!list.length) return { text: topic ? d.divaNoTrendTopic : d.divaNoTrendAny, intent: "trend" };
  const k = topic ?? "all";
  const tr = list[(rot[k] ?? 0) % list.length];
  rot[k] = (rot[k] ?? 0) + 1;
  const msg = trendMessage(tr, ctx);
  return { ...msg, text: `${msg.text} ${d.divaTrendSuffix}`, exact: true };
}

/** Un servicio o un pack que combina bien con lo que ya ha elegido. */
export function pairingTip(ctx: DivaCtx): DivaMsg | null {
  const d = T(ctx);
  const sg = suggest({ have: ctx.selected, catalog: ctx.services.map((s) => s.slug), packs: ctx.packs, maxServices: 6, max: 1 })[0];
  if (!sg) return null;
  if (sg.kind === "pack") {
    const pk = ctx.packs.find((p) => p.slug === sg.packSlug);
    if (!pk) return null;
    const missing = sg.add.map((slug) => svc(ctx, slug)?.name).filter(Boolean).join(" + ");
    const save = pk.discountPercent > 0 ? fill(d.divaPackTipSave, { percent: pk.discountPercent }) : "";
    return { text: fill(d.divaPackTip, { missing, pack: pk.name, save }), action: { label: fill(d.divaOfferPack, { name: pk.name }), slug: pk.slug, kind: "pack" }, intent: "pairing" };
  }
  return { text: `${d[sg.reason]} 💖`, action: offerService(ctx, sg.add[0]), intent: "pairing" };
}

/**
 * Servicios a los que se refiere la pregunta. Primero los que aparecen con TODAS sus palabras («manicura clasica»);
 * si no hay, los que comparten la primera palabra («manicura») y, por último, los que se parecen con una letra de más o de menos.
 */
export function matchServices(q: string, ctx: DivaCtx): DivaService[] {
  const stop = new Set(["de", "con", "la", "el", "los", "las", "y", "para", "del"]);
  const words = q.split(" ");
  const toks = (s: DivaService) => norm(s.name).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !stop.has(t));
  const has = (t: string) => words.some((w) => w === t || (t.length >= 6 && w.length >= 6 && lev(w, t) <= 1)) || q.includes(t);
  const all = ctx.services.filter((s) => {
    const t = toks(s);
    return t.length > 0 && t.every(has);
  });
  // si hay una coincidencia completa más específica que otra («manicura semipermanente» ⊃ «manicura»), se quedan las más específicas
  if (all.length) {
    const max = Math.max(...all.map((s) => toks(s).length));
    return all.filter((s) => toks(s).length === max);
  }
  const first = [...new Set(ctx.services.map((s) => toks(s)[0]).filter((w): w is string => !!w && w.length >= 5))].filter(has);
  return ctx.services.filter((s) => first.includes(toks(s)[0]));
}

function durationAnswer(ctx: DivaCtx, named: DivaService[] = []): DivaMsg {
  const d = T(ctx);
  if (named.length) {
    const pose = named.map((s) => full(ctx, s)).filter((s) => s.waitMin);
    return { text: `${named.map((s) => `${s.name}: ${fmtDuration(s.durationMin)}`).join(" · ")} ⏱️${pose.length ? ` (${pose.map((s) => `${s.name} incluye ${s.waitMin} min de pose`).join("; ")})` : ""}`, intent: "duration", exact: true };
  }
  const sel = ctx.services.filter((s) => ctx.selected.includes(s.slug));
  if (sel.length) {
    const total = sel.reduce((a, s) => a + s.durationMin, 0);
    return { text: sel.length === 1 ? fill(d.divaDurOne, { name: sel[0].name, dur: fmtDuration(sel[0].durationMin) }) : fill(d.divaDurMany, { total: fmtDuration(total), list: sel.map((s) => `${s.name} (${fmtDuration(s.durationMin)})`).join(", ") }), intent: "duration", exact: true };
  }
  const firsts = [...new Set(ctx.services.map((s) => s.category))].slice(0, 3).map((c) => ctx.services.find((s) => s.category === c)).filter((s): s is DivaService => !!s);
  return { text: fill(d.divaDurGeneric, { list: firsts.map((s) => `${s.name} ${fmtDuration(s.durationMin)}`).join(", ") }), intent: "duration", exact: true };
}

function priceAnswer(ctx: DivaCtx, named: DivaService[] = []): DivaMsg {
  const d = T(ctx);
  if (named.length) return { text: `${named.map((s) => `${s.name}: ${money(s.priceCents)}`).join(" · ")} 💶`, intent: "price", exact: true };
  const sel = ctx.services.filter((s) => ctx.selected.includes(s.slug));
  if (sel.length) {
    const total = sel.reduce((a, s) => a + s.priceCents, 0);
    return { text: sel.length === 1 ? fill(d.divaPriceOne, { name: sel[0].name, price: money(sel[0].priceCents) }) : fill(d.divaPriceMany, { total: money(total), list: sel.map((s) => `${s.name} ${money(s.priceCents)}`).join(", ") }), intent: "price", exact: true };
  }
  const cats = [...new Set(ctx.services.map((s) => s.category))].map((c) => fill(d.divaPriceFrom, { cat: c, price: money(Math.min(...ctx.services.filter((s) => s.category === c).map((s) => s.priceCents))) }));
  return { text: fill(d.divaPriceGeneric, { list: cats.join(" · ") }), intent: "price", exact: true };
}

export function recommend(ctx: DivaCtx, rot: Rot): DivaMsg {
  const pair = pairingTip(ctx);
  if (pair) return { ...pair, exact: true };
  const withService = ctx.trends.filter((x) => x.serviceSlug && svc(ctx, x.serviceSlug) && !ctx.selected.includes(x.serviceSlug));
  if (withService.length) {
    const tr = withService[(rot.rec ?? 0) % withService.length];
    rot.rec = (rot.rec ?? 0) + 1;
    return { ...trendMessage(tr, ctx), intent: "recommend", exact: true };
  }
  return { text: T(ctx).divaRecNone, intent: "recommend" };
}

/* ------------------------------------------------------------------ */
/* Cuándo: «hoy», «mañana», «el viernes», «esta tarde»                  */
/* ------------------------------------------------------------------ */

const DAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const dowOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const today = (ctx?: Pick<DivaCtx, "today">) => ctx?.today ?? todayIn(CONFIG.tz);

/** Entiende el «cuándo» de una pregunta de huecos. Devuelve null si no hay ninguna referencia a un día o a una parte del día. */
export function parseWhen(q: string, base: string): { day: string; days: number; part: "any" | "morning" | "afternoon"; label: string } | null {
  let part: "any" | "morning" | "afternoon" = "any";
  let rest = q;
  // «por la mañana» es la franja, «mañana» a secas es el día siguiente
  if (/(por la|de|a la|esta|en la|toda la) manana/.test(rest)) {
    part = "morning";
    rest = rest.replace(/(por la|de|a la|esta|en la|toda la) manana/g, " ");
  }
  if (/\b(tarde|tardecita|despues de comer)\b/.test(rest)) part = "afternoon";
  if (/\bmediodia\b/.test(rest) && part === "any") part = "morning";
  const partLabel = part === "morning" ? " por la mañana" : part === "afternoon" ? " por la tarde" : "";
  if (/\bpasado manana\b/.test(rest)) return { day: addDays(base, 2), days: 1, part, label: `pasado mañana${partLabel}` };
  if (/\bmanana\b/.test(rest)) return { day: addDays(base, 1), days: 1, part, label: `mañana${partLabel}` };
  if (/\bhoy\b|\besta tarde\b|\besta noche\b/.test(rest) || (/esta manana/.test(q) && part === "morning")) return { day: base, days: 1, part, label: `hoy${partLabel}` };
  for (let i = 0; i < 7; i++) {
    const name = DAYS[i];
    if (new RegExp(`\\b${name}s?\\b`).test(rest)) {
      let d = base;
      for (let k = 0; k < 8 && dowOf(d) !== i; k++) d = addDays(d, 1);
      return { day: d, days: 1, part, label: `el ${DAY_NAMES[i]}${partLabel}` };
    }
  }
  if (/fin de semana|finde/.test(rest)) {
    let d = base;
    for (let k = 0; k < 8 && dowOf(d) !== 6; k++) d = addDays(d, 1);
    return { day: d, days: 2, part, label: "el fin de semana" };
  }
  if (/proxima semana|semana que viene/.test(rest)) {
    let d = addDays(base, 1);
    for (let k = 0; k < 8 && dowOf(d) !== 1; k++) d = addDays(d, 1);
    return { day: d, days: 7, part, label: "la semana que viene" };
  }
  if (/esta semana|estos dias|proximos dias|lo antes posible|cuanto antes|pronto/.test(rest)) return { day: base, days: 7, part, label: "esta semana" };
  if (part !== "any") return { day: base, days: 1, part, label: `hoy${partLabel}` };
  return null;
}

/** ¿Cuántos euros / minutos dice la frase? («menos de 20 euros», «en 30 minutos»). */
function budgetOf(q: string): { maxMin?: number; maxCents?: number; cheap?: boolean; quick?: boolean } {
  const out: { maxMin?: number; maxCents?: number; cheap?: boolean; quick?: boolean } = {};
  const m = /(?:menos de|hasta|maximo|max|como mucho|en|de)\s*(\d{1,3})\s*(?:min|minutos|m\b)/.exec(q);
  if (m) out.maxMin = Number(m[1]);
  const h = /(?:menos de|hasta|maximo|como mucho|en)\s*(\d{1,2})\s*(?:horas?|h\b)/.exec(q);
  if (h) out.maxMin = Number(h[1]) * 60;
  const e = /(?:menos de|hasta|maximo|max|como mucho|por)\s*(\d{1,3})\s*(?:euros?|eur|€)/.exec(q) ?? /(\d{1,3})\s*(?:euros?|eur|€)\s*(?:como mucho|maximo|o menos)/.exec(q);
  if (e) out.maxCents = Number(e[1]) * 100;
  if (/rapid|poco tiempo|express|corto|cortito|prisa|sin tiempo/.test(q)) out.quick = true;
  if (/barat|economic|poco dinero|ajustado|low ?cost|asequible/.test(q)) out.cheap = true;
  return out;
}

// Palabras clave (sin acentos) con las que Diva entiende lo que le escribe la clienta
const RX = {
  hello: /^(hola|buenas|buenos|hey|ey|que tal|saludos|ola)\b/,
  thanks: /gracias|genial|perfecto|guay|estupendo|^vale\b|^ok\b|^muchas/,
  bye: /^(adios|hasta luego|chao|nos vemos|hasta pronto)/,
  who: /quien eres|que eres|eres (una )?(persona|robot|ia|inteligencia|real|humana|bot)|hablo con (una )?(persona|maquina|robot)|eres de verdad/,
  human: /hablar con (alguien|una persona|el equipo|la duena)|persona real|que me llamen|llamadme|llamame/,
  medical: /alerg|embaraz|lactan|medic|enferm|diabet|piel sensible|dermat|irrit|infecc|hongo|herida|quimio|antibiot|roacuta|isotretin|anticoag|marcapasos|epilep|cancer|tiroid|psoria|eccema|urticaria|asma\b|operacion|cirug|tension alta|hipertens|reaccion|picor|escoz|quemadur|verruga|\bcicatriz|dolor/,
  price: /precio|cuesta|cuanto vale|tarifa|cuanto es\b|euros|coste|cuanto cobr|cuanto sale|\bcaro\b|\bvalen\b/,
  duration: /cuanto dura|duracion|cuanto tarda|cuanto tiempo|\bdura\b|cuantas horas|tardais/,
  compare: /compar|diferencia|cual es mejor|cual me|que es mejor|mejor (la|el|una|un)|\bvs\b|o mejor|entre (la|el)/,
  pose: /\bpose\b|espera|incluye.*min|tiempo de espera|tengo que esperar|rato de espera/,
  after: /cuidad|despues de|tras (la|el|mi)|mantener|mantenimiento|como cuido|no (mojar|puedo)|ducha|piscina|sol\b|playa|aftercare|que hago luego|que evito|recomendaciones/,
  deposit: /senal|deposito|fianza|\bpagar\b|\bpago\b|tarjeta|se paga|prepago|reembols|devuelv/,
  several: /varios|varias|juntos|a la vez|seguid|separad|distint|diferent|otro dia|otra hora|por separado/,
  packs: /\bpacks?\b|paquete|oferta|descuento|promo|combo|bono/,
  extras: /\bextras?\b|retirada|nail art|parafina/,
  companion: /acompan|amiga|madre|con alguien|venimos|vengo con|para dos|con mi (hija|hermana|madre|novia|amiga)/,
  trends: /tendenc|moda|se lleva|de moda|novedad|ultimo|lo nuevo|nuevo|que hay/,
  recommend: /recomien|sugier|aconsej|que me hago|que me pongo|que elijo|no se que|ideas?\b|inspir|sorprend/,
  nails: /\bunas\b|manicur|esmalte|color|pedicur/,
  lashes: /pesta|lifting|mirada/,
  brows: /ceja|laminad|microblad/,
  wax: /depil|laser|\bcera\b|hilo/,
  where: /donde|direccion|ubicaci|llegar|como llego|melide|mapa|aparcar|parking|aparcamiento/,
  cancel: /cancel|cambiar|mover|anular|aplazar|no puedo ir|no voy a poder/,
  late: /llego tarde|retras|voy tarde|tarde a mi cita|llegar tarde/,
  help: /ayuda|como funciona|como reserv|como va/,
  book: /cita|reserv|hueco|hoy|manana|libre|disponib/,
  hours: /horario|abris|abre\b|abren|cierr|hora de (apertura|cierre)|a que hora (abr|cierr)|sabados|domingos|festivos/,
  availability: /hueco|disponib|libre|hay cita|tienes cita|teneis cita|hora para|puedo ir|podria ir|me podeis|me puedes|tenis|alguna hora|queda(n)? (algo|sitio|hora)/,
  wantBook: /reserv|cita|quiero|quisiera|necesito|me gustaria|apuntar|pedir/,
};

const hasDayWord = (q: string) => /\b(hoy|manana|pasado manana|lunes|martes|miercoles|jueves|viernes|sabados?|domingos?|esta tarde|esta manana|esta semana|por la tarde|por la manana|fin de semana|finde|proxima semana|semana que viene|cuanto antes|lo antes posible|pronto)\b/.test(q);

/** Contesta a lo que escribe la clienta. */
export function answer(raw: string, ctx: DivaCtx, rot: Rot): DivaMsg {
  const d = T(ctx);
  const q = fix(raw);
  const has = (re: RegExp) => re.test(q);
  const named = matchServices(q, ctx);

  // Salud: nunca consejos; siempre derivar al equipo (antes que nada, aunque empiece con «hola»)
  if (has(RX.medical) || close(q, ["alergia", "embarazada", "medicacion", "sensible", "lactancia"])) {
    return {
      text: `Eso es mejor que lo valore una profesional del equipo antes de tu cita: no quiero darte un consejo que no sea el adecuado para ti 💖 Llámanos al ${PHONE} o escríbenos por WhatsApp y te lo resuelven.`,
      links: [{ label: `Llamar ${PHONE}`, href: `tel:${CONFIG.salon.phoneE164}` }, { label: "WhatsApp", href: WA }],
      intent: "medical",
      exact: true,
    };
  }
  if (has(RX.human)) {
    return { text: `¡Claro! El equipo te atiende en el ${PHONE} (o por WhatsApp) 💖`, links: [{ label: `Llamar ${PHONE}`, href: `tel:${CONFIG.salon.phoneE164}` }, { label: "WhatsApp", href: WA }], intent: "human", exact: true };
  }
  if (has(RX.who)) return { text: "Soy Diva, la asistente virtual de Pro Diva 💖 Te ayudo con servicios, precios, huecos y dudas de la reserva. Para algo personal, el equipo te atiende en el " + PHONE + ".", intent: "who", exact: true };
  if (has(RX.late)) {
    return { text: "Si vas a llegar tarde, avísanos cuanto antes por teléfono o WhatsApp y vemos cómo hacerlo 💖 Según cómo esté la agenda, puede que haya que acortar o mover tu cita.", links: [{ label: `Llamar ${PHONE}`, href: `tel:${CONFIG.salon.phoneE164}` }, { label: "WhatsApp", href: WA }], intent: "late", exact: true };
  }

  // Horario y dónde estamos (antes que «huecos»: «¿abrís el sábado?» es una pregunta de horario)
  if (has(RX.hours) && !/hueco|disponib|libre/.test(q)) {
    const lines = ctx.info?.hours;
    if (lines?.length) return { text: `Nuestro horario 🕙 ${lines.join(" · ")}. Los huecos libres de cada día los ves al reservar.`, intent: "hours", exact: true };
    return { text: fill(d.divaHours, { phone: PHONE }), intent: "hours", exact: true };
  }
  if (has(RX.where)) {
    return {
      text: fill(d.divaWhere, { address: ctx.address }),
      links: [{ label: "Abrir en Maps", href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ctx.address)}` }],
      intent: "where",
      exact: true,
    };
  }

  // Huecos reales: la respuesta la completa el chat consultando /api/availability
  const askWhen = parseWhen(q, today(ctx));
  const wantsSlots = has(RX.availability) || (has(RX.wantBook) && hasDayWord(q) && !has(RX.price) && !has(RX.duration));
  if (wantsSlots && !has(RX.packs)) {
    const slugs = named.length === 1 ? [named[0].slug] : ctx.selected;
    const when = askWhen ?? { day: today(ctx), days: 7, part: "any" as const, label: "estos días" };
    return { text: "", ask: { day: when.day, days: when.days, part: when.part, label: when.label, slugs }, intent: "availability", exact: true };
  }

  if (has(RX.cancel) || close(q, ["cancelar", "cancelacion"])) {
    const p = ctx.info?.policy;
    const policy = p
      ? `Puedes cancelar desde el enlace del mensaje de confirmación; si lo haces con ${p.cancelHours} h o más, otra persona aprovecha tu hueco y, si pagaste señal, te la devolvemos. La hora se cambia online hasta ${p.rescheduleHours} h antes. Para algo más urgente, llámanos al ${PHONE}.`
      : d.divaCancel;
    return { text: policy, intent: "cancel", exact: true };
  }
  if (has(RX.deposit)) {
    const withDeposit = ctx.services.map((s) => full(ctx, s)).filter((s) => (s.depositCents ?? 0) > 0);
    const list = withDeposit.slice(0, 4).map((s) => `${s.name} (${money(s.depositCents ?? 0)})`).join(", ");
    const refund = ctx.info?.policy ? ` Si cancelas con ${ctx.info.policy.refundHours} h o más, te la devolvemos.` : "";
    return {
      text: withDeposit.length
        ? `Algunos servicios llevan una señal que se descuenta del total: ${list}.${refund} Siempre te la enseñamos antes de pagar 💳`
        : "Ahora mismo ningún servicio pide señal: reservas sin pagar nada por adelantado. Si algún día la pide, te la enseñamos antes de confirmar 💖",
      intent: "deposit",
      exact: true,
    };
  }
  if (has(RX.after) && !has(RX.price)) {
    const target = (named.length ? named : ctx.services.filter((s) => ctx.selected.includes(s.slug))).map((s) => full(ctx, s)).filter((s) => s.aftercare);
    if (target.length) return { text: target.slice(0, 2).map((s) => `${s.name}: ${s.aftercare}`).join(" · ") + " ✨", intent: "aftercare", exact: true };
    return { text: `Te daremos las indicaciones exactas en tu cita, según el tratamiento 💖 Como idea general: hidrata la zona, evita productos agresivos y el agua muy caliente las primeras 24 h. Si dudas, llámanos al ${PHONE}.`, intent: "aftercare", exact: true };
  }
  if (has(RX.pose)) {
    const withPose = ctx.services.map((s) => full(ctx, s)).filter((s) => s.waitMin);
    return {
      text: withPose.length
        ? `Algunos servicios incluyen tiempo de pose, un rato en que el producto actúa y tú descansas: ${withPose.map((s) => `${s.name} (${s.waitMin} min)`).join(", ")}. La duración que ves ya lo incluye ⏳`
        : "Ahora mismo ningún servicio lleva tiempo de pose: la profesional está contigo todo el rato 💖",
      intent: "pose",
      exact: true,
    };
  }

  // Comparar dos servicios
  if (has(RX.compare) && named.length >= 2) {
    const [a, b] = named;
    const fa = full(ctx, a);
    const fb = full(ctx, b);
    const dd = a.durationMin - b.durationMin;
    const pd = a.priceCents - b.priceCents;
    const diffs = [dd !== 0 ? `${dd > 0 ? b.name : a.name} es ${fmtDuration(Math.abs(dd))} más corto` : "", pd !== 0 ? `${pd > 0 ? b.name : a.name} sale ${money(Math.abs(pd))} más barato` : ""].filter(Boolean).join(" y ");
    const desc = [fa.description, fb.description].some(Boolean) ? ` ${[fa, fb].map((s) => (s.description ? `${s.name}: ${s.description}` : "")).filter(Boolean).join(" ")}` : "";
    return withCards(`${a.name}: ${fmtDuration(a.durationMin)}, ${money(a.priceCents)}. ${b.name}: ${fmtDuration(b.durationMin)}, ${money(b.priceCents)}.${diffs ? ` ${diffs[0].toUpperCase()}${diffs.slice(1)}.` : ""}${desc}`.trim(), [cardOf(a, ctx), cardOf(b, ctx)], ctx, { intent: "compare", exact: true });
  }

  // «Algo rápido», «menos de 20 euros», «menos de 45 minutos»
  const b = budgetOf(q);
  if (b.maxMin || b.maxCents || b.cheap || b.quick) {
    const pool = ctx.services.filter((s) => (!b.maxMin || s.durationMin <= b.maxMin) && (!b.maxCents || s.priceCents <= b.maxCents) && (!b.quick || s.durationMin <= 30));
    const sorted = [...pool].sort((x, y) => (b.cheap || b.maxCents ? x.priceCents - y.priceCents : x.durationMin - y.durationMin) || x.priceCents - y.priceCents);
    const top = (sorted.length ? sorted : [...ctx.services].sort((x, y) => (b.cheap ? x.priceCents - y.priceCents : x.durationMin - y.durationMin))).slice(0, 3);
    const label = [b.maxMin ? `menos de ${fmtDuration(b.maxMin)}` : b.quick ? "rápido" : "", b.maxCents ? `menos de ${money(b.maxCents)}` : b.cheap ? "económico" : ""].filter(Boolean).join(" y ");
    return withCards(sorted.length ? `Para algo ${label} te propongo esto 💖` : `No tengo nada exactamente ${label}, pero esto es lo más parecido 💖`, top.map((s) => cardOf(s, ctx)), ctx, { intent: "budget", exact: true });
  }

  // Precio y duración de algo concreto
  if (has(RX.price) || close(q, ["precio", "presupuesto"])) return priceAnswer(ctx, named);
  if (has(RX.duration)) return durationAnswer(ctx, named);

  if (has(RX.several)) return { text: d.divaSeveral, intent: "several", exact: true };
  if (has(RX.packs)) {
    const list = ctx.packs.map((p) => `${p.name}${p.discountPercent > 0 ? ` (−${p.discountPercent} %)` : ""}`).join(", ");
    if (!list) return { text: d.divaPacksNone, intent: "packs", exact: true };
    return withCards(`Tenemos packs: ${list} 🎁 Elige el que te guste y te aplico el descuento al reservar.`, ctx.packs.slice(0, 3).map((p) => packCard(p, ctx)), ctx, { intent: "packs", exact: true });
  }
  if (has(RX.extras)) return { text: d.divaExtras, intent: "extras", exact: true };
  if (has(RX.companion)) return { text: d.divaCompanion, intent: "companion", exact: true };
  if (has(RX.trends)) {
    if (has(RX.lashes)) return nextTrend(ctx, rot, "lashes");
    if (has(RX.brows)) return nextTrend(ctx, rot, "brows");
    if (has(RX.nails)) return nextTrend(ctx, rot, "nails");
    return nextTrend(ctx, rot);
  }
  if (has(RX.recommend)) return recommend(ctx, rot);
  // Un servicio concreto: se enseña con su tarjeta
  if (named.length && named.length <= 3) {
    return withCards(`${named.map((s) => `${s.name}: ${fmtDuration(s.durationMin)}, ${money(s.priceCents)}`).join(" · ")} 💖`, named.map((s) => cardOf(s, ctx)), ctx, { intent: "service", exact: true });
  }
  if (has(RX.nails)) return nextTrend(ctx, rot, "nails");
  if (has(RX.lashes)) return nextTrend(ctx, rot, "lashes");
  if (has(RX.brows)) return nextTrend(ctx, rot, "brows");
  if (has(RX.wax)) {
    const w = ctx.services.filter((s) => /depil/.test(norm(s.category)));
    return w.length ? { text: fill(d.divaWaxList, { list: w.map((s) => `${s.name} (${money(s.priceCents)}, ${fmtDuration(s.durationMin)})`).join(", ") }), intent: "wax", exact: true } : { text: fill(d.divaWaxPhone, { phone: PHONE }), intent: "wax", exact: true };
  }
  if (has(RX.help)) return { text: d.divaHowTo, intent: "help", exact: true };
  if (has(RX.book)) return { text: d.divaBookNow, intent: "book", exact: true };
  if (has(RX.hello) && q.split(" ").length <= 4) return { text: d.divaHello, intent: "hello", exact: true };
  if (has(RX.bye)) return { text: "¡Hasta pronto! 💖 Aquí estaré cuando me necesites.", intent: "bye", exact: true };
  if (has(RX.thanks) && q.split(" ").length <= 5) return { text: d.divaThanks, intent: "thanks", exact: true };

  return { text: fill(d.divaFallback, { phone: PHONE }), intent: "fallback" };
}

/** Lo que Diva dice sola de vez en cuando: packs, consejos y tendencias según lo que lleva elegido. */
export function spontaneous(ctx: DivaCtx, rot: Rot): DivaMsg {
  const n = rot.auto ?? 0;
  rot.auto = n + 1;
  if (n % 4 === 1) {
    const tip = pairingTip(ctx);
    if (tip) return tip;
  }
  if (n % 4 === 3 && ctx.selected.length) {
    const s = svc(ctx, ctx.selected[0]);
    if (s) return { text: `¿Quieres que te busque ya un hueco para ${s.name}? Pregúntame «¿hay hueco mañana?» 📅`, intent: "nudge" };
  }
  if (n % 4 === 2 && ctx.info?.hours?.length) return { text: `Por si te viene bien: ${ctx.info.hours[0]} 🕙`, intent: "nudge" };
  const tr = nextTrend(ctx, rot);
  return { ...tr, text: `${T(ctx).divaLatest} ${tr.text}` };
}

export { PAIR_RULES };
