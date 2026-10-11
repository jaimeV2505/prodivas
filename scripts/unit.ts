// Pruebas rápidas de la lógica pura (sin base de datos ni navegador):  npm run test:unit
import { es } from "../src/lib/i18n/es";
import { gl } from "../src/lib/i18n/gl";
import { en } from "../src/lib/i18n/en";
import { discounted, matchPack, suggest } from "../src/lib/combos";
import { answer, nextTrend, pairingTip, spontaneous, type DivaCtx } from "../src/lib/diva";
import { effectiveDeposit } from "../src/lib/deposit";
import { localParts, weekdayName } from "../src/lib/format";
import { usualOf } from "../src/lib/myBookings";
import { pickAlternatives } from "../src/lib/alternatives";
import { stampsOf } from "../src/lib/loyalty";
import { colorFromNotes, dueRetouch, lastColor } from "../src/lib/recs";
import { quizAddon, quizResult, quizServices } from "../src/lib/quiz";
import { inWindow, isQuiet } from "../src/lib/quiet";
import { msgDict, msgEs, msgGl, msgEn } from "../src/lib/i18n/msg";
import { optoutToken, parseOptoutToken } from "../src/lib/optout";

let fails = 0;
let total = 0;
const check = (ok: boolean, msg: string, extra = "") => {
  total++;
  if (!ok) fails++;
  console.log(`${ok ? "✔" : "✘"} ${msg}${!ok && extra ? "  →  " + extra : ""}`);
};

/* ---- idiomas: mismas claves y mismos huecos {x} en castellano, gallego e inglés ---- */
const ph = (t: string) => (t.match(/\{\w+\}/g) ?? []).sort().join(",");
const keys = Object.keys(es) as (keyof typeof es)[];
check(keys.every((k) => k in gl && k in en), `los tres idiomas tienen las ${keys.length} mismas claves`);
check(keys.every((k) => ph(es[k]) === ph((gl as Record<string, string>)[k]) && ph(es[k]) === ph((en as Record<string, string>)[k])), "los huecos {nombre} coinciden en los tres idiomas", keys.filter((k) => ph(es[k]) !== ph((gl as Record<string, string>)[k]) || ph(es[k]) !== ph((en as Record<string, string>)[k])).join(", "));
check(keys.every((k) => (gl as Record<string, string>)[k].trim() !== "" && (en as Record<string, string>)[k].trim() !== ""), "no hay textos vacíos");

/* ---- packs y sugerencias ---- */
const catalog = ["manicura-semipermanente", "manicura-clasica", "pedicura", "pedicura-semipermanente", "lifting-pestanas", "tinte-cejas", "hilo-cejas", "microblading"];
const packs = [
  { slug: "manos-y-pies", serviceSlugs: ["manicura-semipermanente", "pedicura-semipermanente"], discountPercent: 10 },
  { slug: "mirada-completa", serviceSlugs: ["lifting-pestanas", "tinte-cejas", "hilo-cejas"], discountPercent: 0 },
];
check(matchPack(["pedicura-semipermanente", "manicura-semipermanente"], packs)?.slug === "manos-y-pies", "un pack se reconoce aunque los servicios estén en otro orden");
check(matchPack(["manicura-semipermanente"], packs) === null, "un servicio suelto no es un pack");
check(matchPack(["manicura-semipermanente", "pedicura-semipermanente", "pedicura-semipermanente"], packs) === null, "con un servicio repetido ya no cuenta como pack (sin descuento)");
check(discounted(1800, 10) === 1620 && discounted(2800, 10) === 2520 && discounted(1999, 15) === 1699, "el descuento se redondea igual que en el servidor");
const sg = suggest({ have: ["manicura-semipermanente"], catalog, packs, maxServices: 6 });
check(sg.length === 1 && sg[0].kind === "pack" && sg[0].add[0] === "pedicura-semipermanente", "con una manicura se sugiere completar «manos y pies»");
check(suggest({ have: ["manicura-semipermanente"], catalog, packs, maxServices: 1 }).length === 0, "no se sugiere si ya no caben más servicios");
check(suggest({ have: [], catalog, packs, maxServices: 6 }).length === 0, "sin servicios elegidos no hay sugerencias");

/* ---- Diva: entiende castellano, gallego e inglés y contesta en el mismo idioma ---- */
const services = catalog.map((slug, i) => ({ slug, name: slug.replace(/-/g, " "), category: i < 4 ? "Manicura y pedicura" : "Mirada", durationMin: 30 + i * 5, priceCents: 1000 + i * 300 }));
const trends = [{ id: 1, emoji: "🍷", title: "Burdeos", body: "El burdeos manda.", topic: "nails", serviceSlug: "manicura-semipermanente", i18n: { en: { title: "Burgundy", body: "Burgundy rules." } } }];
const ctxOf = (lang: "es" | "gl" | "en", selected: string[] = []): DivaCtx => ({ lang, trends, services, packs: packs.map((p) => ({ ...p, name: p.slug })), selected, step: "time", address: "Rúa Rambla San Pablo, 6, Melide" });
const rot = {};
check(answer("hay packs?", ctxOf("es"), rot).text.includes("manos-y-pies"), "Diva responde sobre packs (castellano)");
check(/pack/i.test(answer("do you have any offers?", ctxOf("en"), rot).text), "Diva entiende «offers» en inglés");
check(/prezo|custa|€/i.test(answer("canto custa?", ctxOf("gl"), rot).text), "Diva entiende «canto custa» en gallego");
check(answer("what's trending?", ctxOf("en"), rot).text.includes("Burgundy"), "la tendencia sale traducida cuando existe traducción");
check(answer("que se lleva", ctxOf("es"), rot).text.includes("Burdeos"), "y en castellano sale la original");
check(answer("how much is the lifting?", ctxOf("en"), rot).text.includes("lifting pestanas"), "pregunta por un servicio concreto (precio)");
check(!!pairingTip(ctxOf("es", ["manicura-semipermanente"]))?.action, "Diva sugiere con un botón lo que combina con lo elegido");
check(spontaneous(ctxOf("gl"), {}).text.length > 10 && nextTrend(ctxOf("es"), {}, "lashes").text.length > 5, "Diva habla sola y sabe decir cuándo no hay tendencias de un tema");
check(answer("qwertyuiop", ctxOf("en"), rot).text.includes("670 424 348"), "si no entiende, ofrece el teléfono");

/* ---- «como siempre»: día y hora habituales (hora local de Madrid, también con el cambio de hora) ---- */
const lp = localParts("2026-10-22T14:45:00Z"); // 16:45 en Madrid (verano)
check(lp.day === "2026-10-22" && lp.dow === 4 && lp.minutes === 16 * 60 + 45, "localParts: jueves 22 a las 16:45", JSON.stringify(lp));
const lw = localParts("2026-10-29T15:45:00Z"); // ya con hora de invierno: 16:45 en Madrid
check(lw.dow === 4 && lw.minutes === 16 * 60 + 45, "la misma hora local se mantiene tras el cambio de hora", JSON.stringify(lw));
const hist = [{ startsAt: "2026-09-10T15:00:00Z", slugs: [] }, { startsAt: "2026-09-24T15:15:00Z", slugs: [] }, { startsAt: "2026-10-01T10:00:00Z", slugs: [] }];
const u = usualOf(hist);
check(u?.dow === 4 && u.minutes >= 17 * 60 - 5 && u.minutes <= 17 * 60 + 20, "el día habitual es el más repetido y la hora la mediana", JSON.stringify(u));
check(usualOf([]) === null, "sin historial no hay «como siempre»");
check(weekdayName(4, "es-ES") === "jueves" && weekdayName(4, "en-GB") === "Thursday", "nombre del día en cada idioma");

async function main() {
/* ---- fase 3: packs para dos, sellos, toca retoque, test ---- */
{
  const two = [{ slug: "madre-e-hija", serviceSlugs: ["manicura-clasica"], discountPercent: 10, people: 2 }, ...packs];
  check(matchPack(["manicura-clasica", "manicura-clasica"], two)?.slug === "madre-e-hija", "un pack «para dos» se reconoce con el servicio dos veces");
  check(matchPack(["manicura-clasica"], two) === null, "y con el servicio una sola vez no cuenta como pack");
  check(matchPack(["manicura-clasica", "manicura-clasica", "manicura-clasica"], two) === null, "ni con tres");
  check(suggest({ have: ["manicura-clasica"], catalog, packs: two, maxServices: 6 }).every((x) => x.kind !== "pack" || x.packSlug !== "madre-e-hija"), "los packs para dos no se sugieren como «completar el pack»");

  check(JSON.stringify(stampsOf(7, 0, 10)) === '{"progress":7,"rewards":0}', "sellos: 7 visitas, tarjeta a 7 de 10");
  check(JSON.stringify(stampsOf(10, 0, 10)) === '{"progress":10,"rewards":1}', "sellos: 10 visitas, tarjeta llena y 1 premio");
  check(JSON.stringify(stampsOf(10, 1, 10)) === '{"progress":0,"rewards":0}', "sellos: tras canjear, la tarjeta empieza de cero");
  check(JSON.stringify(stampsOf(12, 0, 10)) === '{"progress":10,"rewards":1}' && JSON.stringify(stampsOf(12, 1, 10)) === '{"progress":2,"rewards":0}', "sellos: las visitas de más cuentan para la siguiente tarjeta");
  check(stampsOf(25, 0, 10).rewards === 2, "sellos: dos premios acumulados si no los canjea");

  const wk = (n: number) => new Date(Date.now() - n * 7 * 86400000).toISOString();
  const svcs = [{ slug: "manicura-semipermanente", rebookWeeks: 3 }, { slug: "lifting-pestanas", rebookWeeks: 6 }, { slug: "manicura-clasica", rebookWeeks: null }];
  check(dueRetouch([{ startsAt: wk(3), slugs: ["manicura-semipermanente"] }], svcs, Date.now())[0]?.weeks === 3, "toca retoque: a las 3 semanas de una manicura semipermanente");
  check(dueRetouch([{ startsAt: wk(2), slugs: ["manicura-semipermanente"] }], svcs, Date.now())[0]?.weeks === 2, "toca retoque: ya a falta de una semana");
  check(dueRetouch([{ startsAt: wk(1), slugs: ["manicura-semipermanente"] }], svcs, Date.now()).length === 0, "todavía no: a la semana no toca");
  check(dueRetouch([{ startsAt: wk(3), slugs: ["manicura-clasica"] }], svcs, Date.now()).length === 0, "un servicio sin retoque nunca lo pide");
  check(dueRetouch([{ startsAt: wk(3), slugs: ["manicura-semipermanente"] }, { startsAt: new Date(Date.now() + 3 * 86400000).toISOString(), slugs: ["manicura-semipermanente"] }], svcs, Date.now()).length === 0, "si ya tiene otra cita futura con él, no insiste");
  check(dueRetouch([{ startsAt: wk(40), slugs: ["manicura-semipermanente"] }], svcs, Date.now()).length === 0, "pasadas más de 26 semanas, ya no (no es un retoque)");
  check(lastColor([{ startsAt: "2026-09-01T10:00:00Z", slugs: [], color: "Burdeos" }, { startsAt: "2026-10-01T10:00:00Z", slugs: [], color: "Rosa chicle" }, { startsAt: "2026-10-05T10:00:00Z", slugs: [] }]) === "Rosa chicle", "último color elegido: el más reciente que tenga");
  check(colorFromNotes("Color: Rosa chicle") === "Rosa chicle" && colorFromNotes("Acompañante: Ana\nColor: Burdeos\nAlergia") === "Burdeos" && colorFromNotes("sin color") === undefined, "el color se saca de los comentarios de la cita");

  check(quizResult({ time: "short", style: "natural", last: "event" }) === "quick", "test: poco tiempo y para hoy → clásica y rápida");
  check(quizResult({ time: "normal", style: "classic", last: "weeks" }) === "daily", "test: una hora y 2–3 semanas → semipermanente de diario");
  check(quizResult({ time: "long", style: "natural", last: "weeks" }) === "pair" && quizResult({ time: "normal", style: "natural", last: "max" }) === "pair", "test: con tiempo o buscando que dure → manos y pies");
  check(quizResult({ time: "long", style: "bold", last: "max" }) === "full" && quizResult({ time: "short", style: "bold", last: "max" }) === "daily", "test: look completo solo con tiempo, atrevida y que dure");
  check(quizAddon({ time: "long", style: "bold", last: "max" }) === "nail-art-sencillo" && quizAddon({ time: "long", style: "natural", last: "max" }) === null, "test: las atrevidas suman nail art");
  check(quizServices("full", ["manicura-clasica"]).join() === "manicura-clasica" && quizServices("pair", catalog).length === 2, "test: si falta un servicio se omite; si no queda ninguno, el primero del catálogo");
}

/* ---- mensajes a la clienta: mismos textos y mismos huecos en los tres idiomas ---- */
{
  const k = Object.keys(msgEs) as (keyof typeof msgEs)[];
  const ph2 = (t: string) => (t.match(/\{\w+\}/g) ?? []).sort().join(",");
  check(k.every((x) => x in msgGl && x in msgEn), `los mensajes tienen las ${k.length} mismas claves en castellano, gallego e inglés`);
  check(k.every((x) => ph2(msgEs[x]) === ph2((msgGl as Record<string, string>)[x]) && ph2(msgEs[x]) === ph2((msgEn as Record<string, string>)[x])), "los huecos {x} de los mensajes coinciden en los tres idiomas", k.filter((x) => ph2(msgEs[x]) !== ph2((msgEn as Record<string, string>)[x]) || ph2(msgEs[x]) !== ph2((msgGl as Record<string, string>)[x])).join(", "));
  check(msgDict("gl").remSms !== msgDict("es").remSms && msgDict("en").remSms !== msgDict("es").remSms, "el recordatorio sale distinto en cada idioma");
  check(k.filter((x) => x.endsWith("Sms")).every((x) => !/[áéíóúñ¿¡€]/i.test(msgEs[x])), "los SMS en castellano van sin tildes (un segmento más barato)", k.filter((x) => x.endsWith("Sms") && /[áéíóúñ¿¡€]/i.test(msgEs[x])).join(", "));
}

/* ---- horas de silencio ---- */
check(isQuiet(23, 22, 8) && isQuiet(0, 22, 8) && isQuiet(7, 22, 8), "22:00–08:00: de noche no se envían recordatorios");
check(!isQuiet(8, 22, 8) && !isQuiet(12, 22, 8) && !isQuiet(21, 22, 8), "y a las 08:00, a mediodía y a las 21:00 sí");
check(!isQuiet(3, 8, 8) && isQuiet(13, 12, 15) && !isQuiet(15, 12, 15), "los límites son [inicio, fin) y se puede cambiar el horario");
check(inWindow(10, 10, 20) && inWindow(19, 10, 20) && !inWindow(20, 10, 20) && !inWindow(9, 10, 20), "los mensajes opcionales solo salen entre las 10:00 y las 20:00");

/* ---- baja firmada ---- */
{
  const t = optoutToken(42);
  check(parseOptoutToken(t) === 42, "el enlace de baja firmado se reconoce");
  check(parseOptoutToken(t.replace(/^42\./, "43.")) === null, "no se puede dar de baja a otra clienta cambiando el número");
  check(parseOptoutToken("42.aaaaaaaaaaaaaaaaaaaaaaaa") === null && parseOptoutToken("x") === null && parseOptoutToken("") === null, "una firma falsa o un texto raro se rechazan");
}

/* ---- «¿mejor la movemos?»: los 3 huecos más parecidos ---- */
{
  const mk = (day: string, hhmm: string) => ({ startsAt: `${day}T${hhmm}:00Z`, day, minutes: Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) });
  const orig = mk("2026-10-22", "16:00");
  const free = [mk("2026-10-22", "16:00"), mk("2026-10-22", "17:00"), mk("2026-10-22", "10:00"), mk("2026-10-23", "16:00"), mk("2026-10-23", "11:00"), mk("2026-10-24", "16:30"), mk("2026-11-20", "16:00")];
  const alt = pickAlternatives(free, orig, 3);
  check(alt.length === 3 && !alt.some((a) => a.startsAt === orig.startsAt), "propone 3 huecos y nunca la hora que ya tiene");
  check(new Set(alt.map((a) => a.day)).size === 3, "los propone en días distintos si es posible", alt.map((a) => a.day).join(","));
  check(alt[0].startsAt === "2026-10-22T17:00:00Z" && !alt.some((a) => a.day === "2026-11-20"), "elige los más cercanos en el calendario y a hora parecida", alt.map((a) => a.startsAt).join(","));
  const same = pickAlternatives([mk("2026-10-22", "17:00"), mk("2026-10-22", "18:00"), mk("2026-10-22", "10:00")], orig, 3);
  check(same.length === 3, "si solo hay un día libre, completa con más horas de ese día");
  check(pickAlternatives([mk("2026-10-22", "16:00")], orig, 3).length === 0, "si no hay otros huecos, no propone nada");
}

/* ---- señal inteligente: solo a quien ya ha faltado (con un «base de datos» de mentira) ---- */
type Row = Record<string, unknown>;
function fakeRunner(settings: Record<string, string>, noShows: number | null, svcDeposit: number) {
  const updates: unknown[][] = [];
  const q = (async (sql: string, params: unknown[] = []): Promise<Row[]> => {
    if (/FROM settings/.test(sql)) return Object.entries(settings).map(([key, value]) => ({ key, value }));
    if (/FROM customers/.test(sql)) return noShows === null ? [] : [{ no_show_count: noShows }];
    if (/FROM booking_services/.test(sql)) return [{ s: svcDeposit }];
    if (/UPDATE bookings/.test(sql)) updates.push(params);
    return [];
  }) as unknown as Parameters<typeof effectiveDeposit>[0];
  return { q, updates };
}
const repeat = { deposit_policy: "repeat", deposit_after_no_shows: "1", deposit_default_cents: "1000" };
{
  const f = fakeRunner({ deposit_policy: "service" }, 3, 5000);
  check((await effectiveDeposit(f.q, "b1", "600123456", 0, true)) === 0, "política «según el servicio»: no cambia la señal");
}
{
  const f = fakeRunner(repeat, 0, 5000);
  check((await effectiveDeposit(f.q, "b1", "600123456", 0, true)) === 0 && f.updates.length === 0, "clienta cumplidora: no se le pide señal");
}
{
  const f = fakeRunner(repeat, null, 5000);
  check((await effectiveDeposit(f.q, "b1", "600123456", 0, true)) === 0, "clienta nueva (sin ficha): no se le pide señal");
}
{
  const f = fakeRunner(repeat, 1, 0);
  check((await effectiveDeposit(f.q, "b1", "600123456", 0, true)) === 1000 && f.updates.length === 1, "ha faltado y el servicio no lleva señal: se pide la de por defecto (10 €)");
}
{
  const f = fakeRunner(repeat, 2, 5000);
  check((await effectiveDeposit(f.q, "b1", "600123456", 0, true)) === 5000, "ha faltado y el servicio lleva señal de 50 €: se pide esa");
}
{
  const f = fakeRunner(repeat, 1, 5000);
  check((await effectiveDeposit(f.q, "b1", "600123456", 5000, true)) === 5000 && f.updates.length === 0, "servicio con «señal siempre»: ya estaba pedida, no se toca nada");
}
{
  const f = fakeRunner(repeat, 5, 5000);
  check((await effectiveDeposit(f.q, "b1", "600123456", 0, false)) === 0, "con los cobros desactivados no se pide nada");
}
{
  const f = fakeRunner({ ...repeat, deposit_after_no_shows: "2" }, 1, 0);
  check((await effectiveDeposit(f.q, "b1", "600123456", 0, true)) === 0, "si se exigen 2 plantones y lleva 1, todavía no se pide");
}

  console.log(`\n${fails ? "✘" : "✔"} ${total - fails}/${total} pruebas correctas`);
  process.exit(fails ? 1 : 0);
}
void main();
