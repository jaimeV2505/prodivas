// Pruebas rápidas de la lógica pura (sin base de datos ni navegador):  npm run test:unit
import { es } from "../src/lib/i18n/es";
import { gl } from "../src/lib/i18n/gl";
import { en } from "../src/lib/i18n/en";
import { discounted, matchPack, suggest } from "../src/lib/combos";
import { answer, nextTrend, pairingTip, spontaneous, type DivaCtx } from "../src/lib/diva";
import { effectiveDeposit } from "../src/lib/deposit";
import { localParts, weekdayName } from "../src/lib/format";
import { usualOf } from "../src/lib/myBookings";

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
