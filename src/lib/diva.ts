import { PAIR_RULES, suggest } from "./combos";
import { fmtDuration, fmtPrice } from "./format";
import { fill, getDict, type Dict } from "./i18n";
import type { Trend } from "./trends";

/**
 * El «cerebro» de Diva, la chica del avatar. No usa inteligencia artificial ni servicios externos:
 * responde con reglas sencillas y con los datos reales del salón (servicios, precios, duraciones, packs) y las
 * tendencias que la dueña edita en /admin/ajustes. Si no entiende algo, lo dice y ofrece el teléfono.
 */
export type DivaService = { slug: string; name: string; category: string; durationMin: number; priceCents: number };
export type DivaPack = { slug: string; name: string; serviceSlugs: string[]; discountPercent: number; people?: number };
export type DivaCtx = { trends: Trend[]; services: DivaService[]; packs: DivaPack[]; selected: string[]; step: string; address: string };
export type DivaAction = { label: string; slug: string; kind: "service" | "pack" };
export type DivaMsg = { text: string; action?: DivaAction };
/** Contadores para ir rotando tendencias y consejos sin repetir siempre lo mismo. */
export type Rot = Record<string, number>;

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const PHONE = "670 424 348";
const T = (_c?: DivaCtx): Dict => getDict();

export const quickChips = (): { label: string; q: string }[] => {
  const d = getDict();
  return [
    { label: d.divaChipTrend, q: d.divaChipTrendQ },
    { label: d.divaChipRec, q: d.divaChipRecQ },
    { label: d.divaChipDur, q: d.divaChipDurQ },
    { label: d.divaChipPrice, q: d.divaChipPriceQ },
  ];
};

const svc = (ctx: DivaCtx, slug: string) => ctx.services.find((s) => s.slug === slug);

function offerService(ctx: DivaCtx, slug: string | null | undefined): DivaAction | undefined {
  if (!slug || ctx.selected.includes(slug)) return undefined;
  const s = svc(ctx, slug);
  if (!s) return undefined;
  const first = ctx.step === "service" || ctx.selected.length === 0;
  return { label: fill(first ? T(ctx).divaOfferChoose : T(ctx).divaOfferAdd, { name: s.name }), slug, kind: "service" };
}

/** Tendencia con su emoji, su título y su texto. */
export function trendMessage(tr: Trend, ctx: DivaCtx): DivaMsg {
  return { text: `${tr.emoji} ${tr.title}: ${tr.body}`, action: offerService(ctx, tr.serviceSlug) };
}

/** Siguiente tendencia (de un tema, o de cualquiera), rotando. */
export function nextTrend(ctx: DivaCtx, rot: Rot, topic?: string): DivaMsg {
  const d = T(ctx);
  const list = topic ? ctx.trends.filter((x) => x.topic === topic) : ctx.trends;
  if (!list.length) return { text: topic ? d.divaNoTrendTopic : d.divaNoTrendAny };
  const k = topic ?? "all";
  const tr = list[(rot[k] ?? 0) % list.length];
  rot[k] = (rot[k] ?? 0) + 1;
  const msg = trendMessage(tr, ctx);
  return { ...msg, text: `${msg.text} ${d.divaTrendSuffix}` };
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
    return { text: fill(d.divaPackTip, { missing, pack: pk.name, save }), action: { label: fill(d.divaOfferPack, { name: pk.name }), slug: pk.slug, kind: "pack" } };
  }
  return { text: `${d[sg.reason]} 💖`, action: offerService(ctx, sg.add[0]) };
}

/** Servicios a los que se refiere la pregunta («el lifting», «la manicura»…). */
function mentioned(q: string, ctx: DivaCtx): DivaService[] {
  const words = [...new Set(ctx.services.map((s) => norm(s.name).split(/[^a-z0-9]+/)[0]).filter((w) => w.length >= 5))];
  const hit = words.filter((w) => q.includes(w));
  return ctx.services.filter((s) => hit.some((w) => norm(s.name).includes(w)));
}

function durationAnswer(ctx: DivaCtx, named: DivaService[] = []): DivaMsg {
  const d = T(ctx);
  if (named.length) return { text: `${named.map((s) => `${s.name}: ${fmtDuration(s.durationMin)}`).join(" · ")} ⏱️` };
  const sel = ctx.services.filter((s) => ctx.selected.includes(s.slug));
  if (sel.length) {
    const total = sel.reduce((a, s) => a + s.durationMin, 0);
    return { text: sel.length === 1 ? fill(d.divaDurOne, { name: sel[0].name, dur: fmtDuration(sel[0].durationMin) }) : fill(d.divaDurMany, { total: fmtDuration(total), list: sel.map((s) => `${s.name} (${fmtDuration(s.durationMin)})`).join(", ") }) };
  }
  const firsts = [...new Set(ctx.services.map((s) => s.category))].slice(0, 3).map((c) => ctx.services.find((s) => s.category === c)).filter((s): s is DivaService => !!s);
  return { text: fill(d.divaDurGeneric, { list: firsts.map((s) => `${s.name} ${fmtDuration(s.durationMin)}`).join(", ") }) };
}

function priceAnswer(ctx: DivaCtx, named: DivaService[] = []): DivaMsg {
  const d = T(ctx);
  const money = (c: number) => fmtPrice(c);
  if (named.length) return { text: `${named.map((s) => `${s.name}: ${money(s.priceCents)}`).join(" · ")} 💶` };
  const sel = ctx.services.filter((s) => ctx.selected.includes(s.slug));
  if (sel.length) {
    const total = sel.reduce((a, s) => a + s.priceCents, 0);
    return { text: sel.length === 1 ? fill(d.divaPriceOne, { name: sel[0].name, price: money(sel[0].priceCents) }) : fill(d.divaPriceMany, { total: money(total), list: sel.map((s) => `${s.name} ${money(s.priceCents)}`).join(", ") }) };
  }
  const cats = [...new Set(ctx.services.map((s) => s.category))].map((c) => fill(d.divaPriceFrom, { cat: c, price: money(Math.min(...ctx.services.filter((s) => s.category === c).map((s) => s.priceCents))) }));
  return { text: fill(d.divaPriceGeneric, { list: cats.join(" · ") }) };
}

export function recommend(ctx: DivaCtx, rot: Rot): DivaMsg {
  const pair = pairingTip(ctx);
  if (pair) return pair;
  const withService = ctx.trends.filter((x) => x.serviceSlug && svc(ctx, x.serviceSlug) && !ctx.selected.includes(x.serviceSlug));
  if (withService.length) {
    const tr = withService[(rot.rec ?? 0) % withService.length];
    rot.rec = (rot.rec ?? 0) + 1;
    return trendMessage(tr, ctx);
  }
  return { text: T(ctx).divaRecNone };
}

// Palabras clave (sin acentos) con las que Diva entiende lo que le escribe la clienta
const RX = {
  hello: /^(hola|buenas|buenos|hey|ey|que tal)/,
  thanks: /gracias|genial|perfecto|guay|estupendo|^vale\b|^ok\b/,
  price: /precio|cuesta|cuanto vale|tarifa|cuanto es\b|euros|coste|cuanto cobr/,
  duration: /cuanto dura|duracion|cuanto tarda|cuanto tiempo|\bdura\b/,
  several: /varios|varias|juntos|a la vez|seguid|separad|distint|diferent|otro dia|otra hora|por separado/,
  packs: /\bpacks?\b|paquete|oferta|descuento|promo|combo/,
  extras: /\bextras?\b|retirada|nail art|parafina/,
  companion: /acompan|amiga|madre|con alguien|venimos|vengo con/,
  trends: /tendenc|moda|se lleva|de moda|novedad|ultimo|lo nuevo|nuevo|que hay/,
  recommend: /recomien|sugier|aconsej|que me hago|que me pongo|que elijo|no se que/,
  nails: /\bunas\b|manicur|esmalte|color|pedicur/,
  lashes: /pesta|lifting|mirada/,
  brows: /ceja|laminad|microblad/,
  wax: /depil|laser|\bcera\b|hilo/,
  where: /donde|direccion|ubicaci|llegar|como llego|melide/,
  cancel: /cancel|cambiar|mover|anular/,
  help: /ayuda|como funciona|como reserv|como va/,
  book: /cita|reserv|hueco|hoy|manana|libre|disponib/,
  hours: /horario|abris|abre|cierra|hora de/,
};

/** Contesta a lo que escribe la clienta. */
export function answer(raw: string, ctx: DivaCtx, rot: Rot): DivaMsg {
  const d = T(ctx);
  const q = norm(raw);
  const has = (re: RegExp) => re.test(q);
  const named = mentioned(q, ctx);
  if (has(RX.hello)) return { text: d.divaHello };
  if (has(RX.thanks)) return { text: d.divaThanks };
  if (has(RX.price)) return priceAnswer(ctx, named);
  if (has(RX.duration)) return durationAnswer(ctx, named);
  if (has(RX.several)) return { text: d.divaSeveral };
  if (has(RX.packs)) {
    const list = ctx.packs.map((p) => `${p.name}${p.discountPercent > 0 ? ` (−${p.discountPercent} %)` : ""}`).join(", ");
    return { text: list ? fill(d.divaPacks, { list }) : d.divaPacksNone };
  }
  if (has(RX.extras)) return { text: d.divaExtras };
  if (has(RX.companion)) return { text: d.divaCompanion };
  if (has(RX.trends)) {
    if (has(RX.lashes)) return nextTrend(ctx, rot, "lashes");
    if (has(RX.brows)) return nextTrend(ctx, rot, "brows");
    if (has(RX.nails)) return nextTrend(ctx, rot, "nails");
    return nextTrend(ctx, rot);
  }
  if (has(RX.recommend)) return recommend(ctx, rot);
  if (has(RX.nails)) return nextTrend(ctx, rot, "nails");
  if (has(RX.lashes)) return nextTrend(ctx, rot, "lashes");
  if (has(RX.brows)) return nextTrend(ctx, rot, "brows");
  if (has(RX.wax)) {
    const w = ctx.services.filter((s) => /depil/.test(norm(s.category)));
    const money = (c: number) => fmtPrice(c);
    return w.length ? { text: fill(d.divaWaxList, { list: w.map((s) => `${s.name} (${money(s.priceCents)}, ${fmtDuration(s.durationMin)})`).join(", ") }) } : { text: fill(d.divaWaxPhone, { phone: PHONE }) };
  }
  if (has(RX.where)) return { text: fill(d.divaWhere, { address: ctx.address }) };
  if (has(RX.cancel)) return { text: d.divaCancel };
  if (has(RX.help)) return { text: d.divaHowTo };
  if (has(RX.book)) return { text: d.divaBookNow };
  if (has(RX.hours)) return { text: fill(d.divaHours, { phone: PHONE }) };
  return { text: fill(d.divaFallback, { phone: PHONE }) };
}

/** Lo que Diva dice sola de vez en cuando: packs, consejos y tendencias según lo que lleva elegido. */
export function spontaneous(ctx: DivaCtx, rot: Rot): DivaMsg {
  const n = rot.auto ?? 0;
  rot.auto = n + 1;
  if (n % 3 === 1) {
    const tip = pairingTip(ctx);
    if (tip) return tip;
  }
  const tr = nextTrend(ctx, rot);
  return { ...tr, text: `${T(ctx).divaLatest} ${tr.text}` };
}

export { PAIR_RULES };
