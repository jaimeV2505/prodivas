import { fmtDuration, fmtPrice } from "./format";
import type { Trend } from "./trends";

/**
 * El «cerebro» de Diva, la chica del avatar. No usa inteligencia artificial ni servicios externos:
 * responde con reglas sencillas y con los datos reales del salón (servicios, precios, duraciones) y las
 * tendencias que la dueña edita en /admin/ajustes. Si no entiende algo, lo dice y ofrece el teléfono.
 */
export type DivaService = { slug: string; name: string; category: string; durationMin: number; priceCents: number };
export type DivaCtx = { trends: Trend[]; services: DivaService[]; selected: string[]; step: string; address: string };
export type DivaMsg = { text: string; action?: { label: string; slug: string } };
/** Contadores para ir rotando tendencias y consejos sin repetir siempre lo mismo. */
export type Rot = Record<string, number>;

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const PHONE = "670 424 348";

export const QUICK: { label: string; q: string }[] = [
  { label: "¿Qué se lleva? 🔥", q: "¿qué se lleva ahora?" },
  { label: "Recomiéndame ✨", q: "recomiéndame algo" },
  { label: "¿Cuánto dura?", q: "¿cuánto dura?" },
  { label: "¿Cuánto cuesta?", q: "¿cuánto cuesta?" },
];

function offer(ctx: DivaCtx, slug: string | null | undefined): DivaMsg["action"] | undefined {
  if (!slug || ctx.selected.includes(slug)) return undefined;
  const s = ctx.services.find((x) => x.slug === slug);
  if (!s) return undefined;
  return { label: `${ctx.step === "service" || ctx.selected.length === 0 ? "Elegir" : "Añadir"} ${s.name}`, slug };
}

export function trendMessage(t: Trend, ctx: DivaCtx): DivaMsg {
  return { text: `${t.emoji} ${t.title}: ${t.body}`, action: offer(ctx, t.serviceSlug) };
}

/** Siguiente tendencia (de un tema, o de cualquiera), rotando. */
export function nextTrend(ctx: DivaCtx, rot: Rot, topic?: string): DivaMsg {
  const list = topic ? ctx.trends.filter((t) => t.topic === topic) : ctx.trends;
  if (!list.length) {
    return { text: topic ? "De eso aún no tengo ninguna tendencia apuntada 🙈. Cuéntame qué te apetece y te aconsejo." : "Hoy no tengo tendencias nuevas que contarte 🙈. ¿Quieres que te recomiende algo?" };
  }
  const k = topic ?? "all";
  const t = list[(rot[k] ?? 0) % list.length];
  rot[k] = (rot[k] ?? 0) + 1;
  const msg = trendMessage(t, ctx);
  return { ...msg, text: `${msg.text} (tendencia orientativa de esta temporada)` };
}

const PAIRS: { when: RegExp; then: string[]; text: string }[] = [
  { when: /manicura/, then: ["pedicura-semipermanente", "pedicura"], text: "¿Te animas con una pedicura a juego? Manos y pies a juego es un clásico que nunca falla 💅" },
  { when: /pedicura/, then: ["manicura-semipermanente", "manicura-clasica"], text: "¿Y unas manos a juego? Con los pies hechos, las uñas de las manos rematan el look ✨" },
  { when: /lifting|pestanas/, then: ["tinte-cejas", "hilo-cejas"], text: "Con el lifting de pestañas, unas cejas arregladas rematan la mirada 👁️" },
  { when: /cejas|microblading/, then: ["lifting-pestanas"], text: "Unas cejas bonitas y además el lifting de pestañas: mirada abierta sin esfuerzo 👁️" },
];

/** Un servicio que combina bien con lo que ya ha elegido. */
export function pairingTip(ctx: DivaCtx): DivaMsg | null {
  for (const slug of ctx.selected) {
    for (const r of PAIRS) {
      if (!r.when.test(slug)) continue;
      const pick = r.then.find((x) => ctx.services.some((s) => s.slug === x) && !ctx.selected.includes(x));
      if (pick) return { text: r.text, action: offer(ctx, pick) };
    }
  }
  return null;
}

/** Servicios a los que se refiere la pregunta («el lifting», «la manicura»…). */
function mentioned(q: string, ctx: DivaCtx): DivaService[] {
  const words = [...new Set(ctx.services.map((s) => norm(s.name).split(/[^a-z0-9]+/)[0]).filter((w) => w.length >= 5))];
  const hit = words.filter((w) => q.includes(w));
  return ctx.services.filter((s) => hit.some((w) => norm(s.name).includes(w)));
}

function durationAnswer(ctx: DivaCtx, named: DivaService[] = []): DivaMsg {
  if (named.length) return { text: `${named.map((s) => `${s.name}: ${fmtDuration(s.durationMin)}`).join(" · ")} ⏱️` };
  const sel = ctx.services.filter((s) => ctx.selected.includes(s.slug));
  if (sel.length) {
    const total = sel.reduce((a, s) => a + s.durationMin, 0);
    return { text: sel.length === 1 ? `${sel[0].name} dura ${fmtDuration(sel[0].durationMin)}. ⏱️` : `Tu visita dura ${fmtDuration(total)} en total: ${sel.map((s) => `${s.name} (${fmtDuration(s.durationMin)})`).join(", ")}. ⏱️` };
  }
  const firsts = [...new Set(ctx.services.map((s) => s.category))].slice(0, 3).map((c) => ctx.services.find((s) => s.category === c)).filter((s): s is DivaService => !!s);
  return { text: `Depende del servicio. Por ejemplo: ${firsts.map((s) => `${s.name} ${fmtDuration(s.durationMin)}`).join(", ")}. Elige uno y te digo el tiempo exacto.` };
}

function priceAnswer(ctx: DivaCtx, named: DivaService[] = []): DivaMsg {
  if (named.length) return { text: `${named.map((s) => `${s.name}: ${fmtPrice(s.priceCents)}`).join(" · ")} 💶` };
  const sel = ctx.services.filter((s) => ctx.selected.includes(s.slug));
  if (sel.length) {
    const total = sel.reduce((a, s) => a + s.priceCents, 0);
    return { text: sel.length === 1 ? `${sel[0].name} cuesta ${fmtPrice(sel[0].priceCents)}. 💶` : `Tu visita suma ${fmtPrice(total)}: ${sel.map((s) => `${s.name} ${fmtPrice(s.priceCents)}`).join(", ")}. 💶` };
  }
  const cats = [...new Set(ctx.services.map((s) => s.category))].map((c) => {
    const min = Math.min(...ctx.services.filter((s) => s.category === c).map((s) => s.priceCents));
    return `${c} desde ${fmtPrice(min)}`;
  });
  return { text: `${cats.join(" · ")}. Elige un servicio y te doy el precio exacto. 💶` };
}

export function recommend(ctx: DivaCtx, rot: Rot): DivaMsg {
  const pair = pairingTip(ctx);
  if (pair) return pair;
  const withService = ctx.trends.filter((t) => t.serviceSlug && ctx.services.some((s) => s.slug === t.serviceSlug) && !ctx.selected.includes(t.serviceSlug));
  if (withService.length) {
    const t = withService[(rot.rec ?? 0) % withService.length];
    rot.rec = (rot.rec ?? 0) + 1;
    return trendMessage(t, ctx);
  }
  return { text: "Cuéntame qué te apetece: ¿uñas, mirada o depilación? Y te cuento lo que se lleva ✨" };
}

/** Contesta a lo que escribe la clienta. */
export function answer(raw: string, ctx: DivaCtx, rot: Rot): DivaMsg {
  const q = norm(raw);
  const has = (re: RegExp) => re.test(q);
  const named = mentioned(q, ctx);
  if (has(/^(hola|buenas|hey|buenos|ey|que tal)/)) return { text: "¡Hola! 💖 Soy Diva. Pregúntame por tendencias, precios o cuánto dura algo, o dime qué te apetece y te aconsejo." };
  if (has(/gracias|genial|perfecto|guay|estupendo|^vale\b/)) return { text: "¡De nada! 💖 Aquí sigo por si necesitas algo más." };
  if (has(/precio|cuesta|cuanto vale|tarifa|cuanto es|euros|coste|cuanto cobr/)) return priceAnswer(ctx, named);
  if (has(/cuanto dura|duracion|cuanto tarda|cuanto tiempo|dura\b/)) return durationAnswer(ctx, named);
  if (has(/varios|juntos|a la vez|seguid|separad|distint|diferent|otro dia|otra hora|por separado/)) {
    return { text: "Si pides varios servicios puedes elegir «Todo seguido» (un solo bloque, sin esperas) o «Cada uno a su hora» (por ejemplo, uñas hoy y cejas el jueves). Lo ves justo encima del calendario cuando añades un segundo servicio 😉" };
  }
  const nails = /\bunas\b|manicur|esmalte|color|pedicur/;
  if (has(/tendenc|moda|se lleva|de moda|novedad|ultimo|lo nuevo|nuevo|trend|que hay/)) {
    if (has(/pesta|lifting|mirada/)) return nextTrend(ctx, rot, "lashes");
    if (has(/ceja|laminad/)) return nextTrend(ctx, rot, "brows");
    if (has(nails)) return nextTrend(ctx, rot, "nails");
    return nextTrend(ctx, rot);
  }
  if (has(/recomien|sugier|aconsej|que me hago|no se que|que me pongo|que elijo/)) return recommend(ctx, rot);
  if (has(nails)) return nextTrend(ctx, rot, "nails");
  if (has(/pesta|lifting/)) return nextTrend(ctx, rot, "lashes");
  if (has(/ceja|laminad|microblad/)) return nextTrend(ctx, rot, "brows");
  if (has(/depil|laser|\bcera\b|hilo/)) {
    const w = ctx.services.filter((s) => s.category.toLowerCase().includes("depil"));
    return w.length ? { text: `En depilación tenemos: ${w.map((s) => `${s.name} (${fmtPrice(s.priceCents)}, ${fmtDuration(s.durationMin)})`).join(", ")}.` } : { text: `De depilación te cuenta todo el equipo por teléfono: ${PHONE}.` };
  }
  if (has(/donde|direccion|ubicaci|llegar|como llego|melide/)) return { text: `Estamos en ${ctx.address} 📍` };
  if (has(/cancel|cambiar|mover|anular/)) return { text: "Puedes cancelar o cambiar la hora desde el enlace del mensaje de confirmación. Si cancelas, otra persona podrá aprovechar el hueco 💖" };
  if (has(/cita|reserv|hueco|hoy|manana|libre|disponib/)) return { text: "¡Claro! Elige lo que te hacemos y te enseño los huecos libres, que son reales. Si quieres, te cuento qué se lleva mientras eliges 😉" };
  if (has(/ayuda|como funciona|como reserv|como va/)) return { text: "Muy fácil: 1) elige lo que te hacemos, 2) elige un hueco (te lo guardamos unos minutos) y 3) pon tus datos. ¡Y listo! 🎉" };
  if (has(/horario|abris|abre|cierra|hora de/)) return { text: `Todos los huecos que ves en el calendario son reales y están libres. Para algo especial, llámanos al ${PHONE} 📞` };
  return { text: `Mmm, de eso no sé mucho 🙈. Pregúntame por tendencias, precios o cuánto dura algo; para lo demás, llámanos al ${PHONE}.` };
}

/** Lo que Diva dice sola de vez en cuando: tendencias y consejos según lo que lleva elegido. */
export function spontaneous(ctx: DivaCtx, rot: Rot): DivaMsg {
  const n = rot.auto ?? 0;
  rot.auto = n + 1;
  if (n % 3 === 1) {
    const tip = pairingTip(ctx);
    if (tip) return tip;
  }
  const t = nextTrend(ctx, rot);
  return { ...t, text: `Lo último: ${t.text}` };
}
