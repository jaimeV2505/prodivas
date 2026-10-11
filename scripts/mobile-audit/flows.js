const { chromium } = require("playwright");
const fs = require("fs");
const css = fs.readFileSync(process.env.AUDIT_ROOT + "/src/app/globals.css", "utf8");
const bundle = fs.readFileSync(process.env.AUDIT_WORK + "/bundle.js", "utf8");

const SERVICES = [
  [1, "manicura-semipermanente", "Manicura semipermanente", "Manicura y pedicura", "Limado, cutículas y esmaltado semipermanente.", 45, 1800, 0],
  [2, "manicura-clasica", "Manicura clásica", "Manicura y pedicura", "Limado, cutículas y esmalte tradicional.", 30, 1200, 0],
  [3, "pedicura", "Pedicura", "Manicura y pedicura", "Tratamiento completo de pies.", 50, 2200, 0],
  [4, "pedicura-semipermanente", "Pedicura semipermanente", "Manicura y pedicura", "Pedicura con esmaltado semipermanente.", 60, 2800, 0],
  [5, "lifting-pestanas", "Lifting de pestañas", "Mirada", "Curvatura y definición natural de tus pestañas.", 60, 3500, 0],
  [6, "tinte-cejas", "Tinte de cejas", "Mirada", null, 20, 800, 0],
  [7, "microblading", "Microblading de cejas", "Mirada", "Incluye diseño personalizado.", 120, 25000, 5000],
  [8, "hilo-cejas", "Cejas con hilo", "Depilación", null, 15, 600, 0],
].map(([id, slug, name, category, description, durationMin, priceCents, depositCents]) => ({
  id, slug, name, category, description, durationMin, priceCents, depositCents,
  depositAlways: depositCents > 0,
  rebookWeeks: { "manicura-semipermanente": 3, "pedicura-semipermanente": 4, "lifting-pestanas": 6 }[slug] ?? null,
  consentKind: slug === "microblading" ? "microblading" : null,
}));
const ADDONS = [
  { id: 1, slug: "retirada-semipermanente", name: "Retirada de semipermanente", description: "Si llevas esmalte semipermanente.", durationMin: 15, priceCents: 500, category: "Manicura y pedicura", i18n: {} },
  { id: 2, slug: "nail-art-sencillo", name: "Nail art sencillo", description: null, durationMin: 15, priceCents: 500, category: "Manicura y pedicura", i18n: {} },
];
const PACKS = [
  { id: 1, slug: "manos-y-pies", name: "Manos y pies", emoji: "💅", description: "Manicura y pedicura a juego.", serviceSlugs: ["manicura-semipermanente", "pedicura-semipermanente"], discountPercent: 10, featured: true, occasion: null, people: 1, i18n: {} },
  { id: 3, slug: "madre-e-hija", name: "Madre e hija", emoji: "👩‍👧", description: "Manicura clásica para las dos, una detrás de otra.", serviceSlugs: ["manicura-clasica"], discountPercent: 10, featured: false, occasion: null, people: 2, i18n: {} },
  { id: 4, slug: "invitada", name: "Invitada de boda", emoji: "👗", description: "Manos y pies a juego y cejas.", serviceSlugs: ["manicura-semipermanente", "pedicura-semipermanente", "hilo-cejas"], discountPercent: 0, featured: false, occasion: "Boda", people: 1, i18n: {} },
  { id: 2, slug: "express", name: "Express", emoji: "⚡", description: "Lo básico en una visita corta.", serviceSlugs: ["manicura-clasica", "hilo-cejas"], discountPercent: 0, featured: false, occasion: null, people: 1, i18n: {} },
];

const TRENDS = [
  { id: 1, emoji: "🍷", title: "Burdeos con brillo glow", body: "Los tonos borgoña mandan este otoño.", topic: "nails", serviceSlug: "manicura-semipermanente" },
  { id: 2, emoji: "👁️", title: "Lifting de pestañas", body: "Mirada abierta sin extensiones.", topic: "lashes", serviceSlug: "lifting-pestanas" },
];
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => iso(new Date(Date.parse(d + "T00:00:00Z") + n * 86400000));
const TODAY = iso(new Date());
const MAX = addDays(TODAY, 60);

function slotsFor(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (d <= TODAY) continue;
    if (new Date(d + "T00:00:00Z").getUTCDay() === 0) continue;
    let i = 0;
    for (const [h0, h1] of [[10, 14], [16, 20]]) for (let m = h0 * 60; m < h1 * 60; m += 30, i++) {
      const hh = String(Math.floor(m / 60)).padStart(2, "0"), mm = String(m % 60).padStart(2, "0");
      out.push({ day: d, time: `${hh}:${mm}`, startsAt: `${d}T${hh}:${mm}:00+02:00`, available: i % 4 !== 3, staffIds: [1] });
    }
  }
  return out;
}

const AUDIT = `(${function auditInPage() {
  const vw = document.documentElement.clientWidth;
  const sel = (el) => { let s = el.tagName.toLowerCase(); if (el.className && typeof el.className === "string") s += "." + el.className.trim().split(/\s+/).slice(0, 2).join("."); const t = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 26); return t ? `${s} "${t}"` : s; };
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest(".hp"); };
  const clipped = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p); if (p !== document.body && p !== document.documentElement && /(auto|scroll|hidden|clip)/.test(o.overflowX)) return true; } return false; };
  const out = [];
  if (document.documentElement.scrollWidth > vw + 1) out.push(`PÁGINA MÁS ANCHA QUE LA PANTALLA: ${document.documentElement.scrollWidth}px > ${vw}px`);
  for (const el of document.querySelectorAll("body *")) { if (!visible(el)) continue; const r = el.getBoundingClientRect(); if ((r.right > vw + 1 || r.left < -1) && !clipped(el) && getComputedStyle(el).position !== "fixed") { out.push(`se sale: ${sel(el)} (${Math.round(r.left)}→${Math.round(r.right)})`); if (out.length > 8) break; } }
  const ctrl = document.querySelectorAll("button, a.btn, a[class*='btn'], a.chip, a.bk__go, a.easy__btn, a.hb__slot, a.back, a.easy__back, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, summary, [role=radio], [role=gridcell], label.check, .swatch, .slot, .cal__day:not(:disabled)");
  for (const el of ctrl) { if (!visible(el) || el.disabled) continue; const r = el.getBoundingClientRect(); if (Math.min(r.width, r.height) < 43.5 && !(el.classList.contains('cal__day') && r.width >= 34 && r.height >= 44)) out.push(`táctil pequeño: ${sel(el)} ${Math.round(r.width)}×${Math.round(r.height)}`); }
  const seen = new Set();
  for (const el of document.querySelectorAll("body *")) { if (!visible(el)) continue; if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) continue; const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 12) { const k = sel(el); if (!seen.has(k)) { seen.add(k); out.push(`letra pequeña: ${k} ${fs.toFixed(1)}px`); } } }
  for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea")) { if (!visible(el)) continue; const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 16) out.push(`zoom iOS (campo <16px): ${sel(el)} ${fs}px`); }
  return out;
}.toString()})()`;

const shell = (kind) => {
  const body = kind === "easy"
    ? `<div class="appshell"><header class="appshell__bar"><span class="wordmark"><span class="wordmark__pro">Pro</span><span class="wordmark__diva">Diva</span></span><a class="appshell__call" href="tel:+34670424348">Llamar</a></header><main><div id="root"></div></main><footer class="appshell__help"><p>¿Prefieres que te ayudemos? Llámanos al</p><a href="tel:+34670424348">670 424 348</a></footer></div>`
    : kind === "booking"
      ? `<main class="container flow-page"><h1 class="flow-title">Reserva tu cita</h1><div id="root"></div></main>`
      : `<main class="${kind === "resched" || kind === "response" || kind === "review" || kind === "optout" || kind === "addto" ? "easy" : ""}"><div id="root"></div></main>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{--font-display:'DejaVu Sans',sans-serif;--font-body:'DejaVu Sans',sans-serif}</style><style>${css}</style><style>*,*::before,*::after{animation-duration:.001ms!important;animation-delay:0s!important;transition:none!important}</style></head><body>${body}</body></html>`;
};

const results = {};
const log = (label, vp, issues) => { (results[label] = results[label] || {})[vp] = issues; };

async function setup(browser, vp, kind, props, extra = {}) {
  const mobile = !vp.desktop;
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("ERROR JS: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("consola: " + m.text().slice(0, 140)); });
  await page.route("**/api/availability**", (r) => { const u = new URL(r.request().url()); return r.fulfill({ json: { slots: slotsFor(u.searchParams.get("from"), u.searchParams.get("to")), capacity: 7 } }); });
  await page.route("**/api/holds", (r) => {
    const b = JSON.parse(r.request().postData() || "{}");
    const end = new Date(Date.parse(b.startsAt) + 45 * 60000).toISOString();
    return r.fulfill({ json: { holdId: "h" + Math.random().toString(16).slice(2, 8), holdToken: "x".repeat(48), expiresInSec: 600, staffId: 1, staffName: "Pro Diva", priceCents: 1800, durationMin: 45, depositCents: 0, blockedMin: 55, endsAt: end, extendedIds: (b.extend || []).map((e) => e.holdId) } });
  });
  await page.route("**/api/holds/**", (r) => r.fulfill({ json: { ok: true } }));
  await page.route("**/api/bookings", (r) => { const b = JSON.parse(r.request().postData() || "{}"); return r.fulfill({ json: { booking: { id: "b1", code: "ABCD2345", token: "t".repeat(48), startsAt: `${addDays(TODAY, 3)}T17:30:00+02:00`, endsAt: `${addDays(TODAY, 3)}T18:15:00+02:00`, serviceName: "Manicura semipermanente", staffName: "Pro Diva", priceCents: 1800, customerName: b.name } } }); });
  await page.route("**/api/bookings/batch", (r) => {
    const b = JSON.parse(r.request().postData() || "{}");
    return r.fulfill({ json: { bookings: (b.legs || []).map((l, i) => ({ id: "g" + i, code: "GRP" + (1000 + i), token: "t".repeat(48), startsAt: `${addDays(TODAY, 3 + i)}T1${i}:30:00+02:00`, endsAt: `${addDays(TODAY, 3 + i)}T1${i}:45:00+02:00`, serviceName: i === 0 ? "Manicura semipermanente" : "Pedicura", staffName: "Pro Diva", priceCents: 1800 })) } });
  });
  await page.route("**/api/my-bookings", (r) => r.fulfill({ json: { bookings: [
    { code: "AB12CD34", token: "t".repeat(48), status: "CONFIRMED", startsAt: `${addDays(TODAY, 2)}T10:30:00+02:00`, serviceName: "Manicura semipermanente + Pedicura", cancelReason: null },
    { code: "ZZ99YY88", token: "u".repeat(48), status: "CONFIRMED", startsAt: `${addDays(TODAY, 5)}T16:00:00+02:00`, serviceName: "Lifting de pestañas", cancelReason: null },
    { code: "QQ11WW22", token: "v".repeat(48), status: "CANCELLED", startsAt: `${addDays(TODAY, 4)}T12:00:00+02:00`, serviceName: "Microblading de cejas", cancelReason: "customer" },
  ] } }));
  await page.route("**/api/bookings/*/alternatives**", (r) => r.fulfill({ json: { alternatives: [3, 4, 6].map((d) => ({ startsAt: `${addDays(TODAY, d)}T17:30:00+02:00`, endsAt: `${addDays(TODAY, d)}T18:15:00+02:00` })) } }));
  await page.route("**/api/respond", (r) => r.fulfill({ json: { state: JSON.parse(r.request().postData() || "{}").action === "confirm" ? "confirmed" : "cancelled" } }));
  await page.route("**/api/bookings/*/reschedule", (r) => r.fulfill({ json: { booking: { code: "AB12CD34" } } }));
  await page.route("**/api/bookings/*/transfer", (r) => r.fulfill({ json: { name: JSON.parse(r.request().postData() || "{}").name } }));
  await page.route("**/api/bookings/*/extras**", (r) => {
    if (r.request().method() === "POST") return r.fulfill({ json: { booking: { code: "AB12CD34" } } });
    return r.fulfill({ json: { services: [{ id: 4, name: "Pedicura semipermanente", durationMin: 60, priceCents: 2800 }, { id: 6, name: "Tinte de cejas", durationMin: 20, priceCents: 800 }] } });
  });
  await page.route("**/api/bookings/*/review", (r) => r.fulfill({ json: { saved: true } }));
  await page.route("**/api/optout", (r) => r.fulfill({ json: { ok: true } }));
  await page.route("**/api/bookings/*/cancel-all", (r) => r.fulfill({ json: { cancelled: 2 } }));
  await page.route("**/api/waitlist", (r) => r.fulfill({ json: { ok: true, already: false } }));
  await page.route("**/api/callback", (r) => r.fulfill({ json: { ok: true } }));
  await page.addInitScript(({ kind, props, extra }) => {
    window.__AUDIT__ = { component: kind, props };
    if (extra.saved) localStorage.setItem("pd_bookings", JSON.stringify([{ code: "AB12CD34", token: "t".repeat(48) }]));
    if (extra.visits) localStorage.setItem("pd_visits", JSON.stringify(extra.visits));
    if (extra.profile) localStorage.setItem("pd_profile", JSON.stringify({ name: "María García", phone: "600123456", slug: "manicura-semipermanente", serviceName: "Manicura semipermanente" }));
  }, { kind, props, extra });
  // las imágenes reales de la web (public/images) para que la foto del hero y su máscara carguen
  await page.route("http://audit.local/images/**", (r) => r.fulfill({ path: process.env.AUDIT_ROOT + "/public" + new URL(r.request().url()).pathname }));
  await page.route("http://audit.local/", (r) => r.fulfill({ contentType: "text/html", body: shell(kind) }));
  await page.goto("http://audit.local/");
  await page.addScriptTag({ content: bundle });
  return { ctx, page, errors };
}

async function check(page, label, vp, errors, shot) {
  await page.waitForTimeout(150);
  const issues = await page.evaluate(AUDIT);
  log(label, vp.name, issues.concat(errors.splice(0)));
  if (shot) await page.screenshot({ path: `${process.env.AUDIT_WORK}/shots/${shot}-${vp.name}.png`, fullPage: false });
}

(async () => {
  const browser = await chromium.launch();
  const VPS = [{ name: "se-320", width: 320, height: 568 }, { name: "iphone-375", width: 375, height: 812 }];
  for (const vp of VPS) {
    // ===================== reserva web =====================
    {
      const props = { services: SERVICES, staff: [{ id: 1, name: "Pro Diva" }], today: TODAY, maxDate: MAX, whatsapp: "34670424348", address: "Rúa Rambla San Pablo, 6, 15800 Melide, A Coruña", depositEnabled: true, refundHours: 24, trends: TRENDS, addons: ADDONS, packs: PACKS, lang: "es" };
      const { ctx, page, errors } = await setup(browser, vp, "booking", props);
      await page.waitForSelector(".pick");
      await check(page, "web 1 · servicios", vp, errors, "web-1-servicios");
      await page.click(".pick >> nth=0");
      await page.waitForSelector(".cal__day.is-free");
      await check(page, "web 2 · fecha y hora", vp, errors, "web-2-fecha");
      await page.click(".visit__add");
      await check(page, "web 2b · añadir otro servicio", vp, errors, "web-2b-anadir");
      await page.click(".visit__add");
      await page.click(".slot:not(.slot--taken) >> nth=0");
      await page.waitForSelector(".holdbar");
      const rangeCount = await page.locator(".slot--range").count();
      log("web 3a · el servicio bloquea todos sus huecos de golpe (tramo marcado)", vp.name, rangeCount >= 1 ? [] : ["no se marca el tramo bloqueado"]);
      await check(page, "web 3 · hueco bloqueado", vp, errors, "web-3-bloqueo");
      // con un hueco ya guardado, pulsar otra hora lo mueve (no hay que soltar el anterior)
      const other = page.locator(".slot:not(.slot--taken):not(.slot--mine)").nth(1);
      await other.evaluate((el) => el.scrollIntoView({ block: "center" })); // la barra de bloqueo tapa la parte baja: se baja el hueco al centro
      await other.click();
      await page.waitForTimeout(300);
      const heldCount = await page.locator(".slot--mine").count();
      log("web 3b · cambiar de hueco con uno ya guardado", vp.name, heldCount === 1 ? [] : [`hay ${heldCount} huecos marcados como tuyos`]);
      await page.click(".holdbar .btn");
      await page.waitForSelector("form.form");
      await page.fill("input[autocomplete=name]", "María García López");
      await page.fill("input[type=tel]", "600123456");
      await page.check("input[type=checkbox]");
      await check(page, "web 4 · datos", vp, errors, "web-4-datos");
      await page.click("form.form button[type=submit]");
      await page.waitForSelector(".done");
      await page.waitForSelector(".rebook__opt", { timeout: 5000 }).catch(() => {});
      const rb = await page.locator(".rebook__opt").count();
      log("web 5b · tras reservar se ofrece reservar ya el retoque", vp.name, rb >= 1 ? [] : ["no aparece la tarjeta de retoque"]);
      await check(page, "web 5 · confirmación", vp, errors, "web-5-confirmacion");
      if (rb) {
        await page.locator(".rebook__opt").first().click();
        const okRebook = await page.waitForSelector(".rebook--ok", { timeout: 5000 }).then(() => true).catch(() => false);
        log("web 5c · el retoque se reserva con un toque", vp.name, okRebook ? [] : ["no se confirma: " + (await page.locator(".rebook").first().innerText()).replace(/\s+/g, " ").slice(0, 160)]);
      }
      await page.click("text=Reservar otra cita");
      await page.waitForSelector(".pick");
      const rep = await page.locator(".repeat").count();
      log("web 6 · 'Reservar otra cita' vuelve al menú y ofrece repetir lo de la última vez", vp.name, rep === 1 ? [] : [`.repeat: ${rep}`]);
      await ctx.close();
    }
    // ===================== reserva completa: packs, sugerencias, extras, acompañante, atajos y casillas =====================
    {
      const props = { services: SERVICES, staff: [{ id: 1, name: "Pro Diva" }], today: TODAY, maxDate: MAX, whatsapp: "34670424348", address: "Rúa Rambla San Pablo, 6, 15800 Melide, A Coruña", depositEnabled: true, refundHours: 24, trends: TRENDS, addons: ADDONS, packs: PACKS, lang: "es" };
      const { ctx, page, errors } = await setup(browser, vp, "booking", props);
      const sent = { holds: [], book: null };
      page.on("request", (r) => {
        if (r.method() !== "POST") return;
        if (r.url().endsWith("/api/holds")) sent.holds.push(JSON.parse(r.postData() || "{}"));
        if (r.url().endsWith("/api/bookings")) sent.book = JSON.parse(r.postData() || "{}");
      });
      await page.waitForSelector(".pack");
      await check(page, "completa 1 · packs listos en el primer paso", vp, errors, "full-1-packs");
      await page.click(".pack >> nth=0"); // «Manos y pies» (-10 %)
      await page.waitForSelector(".visit__pack");
      const packLine = await page.locator(".visit__pack").innerText();
      log("completa 2 · al elegir el pack se aplica el descuento (ahorra 4,60 €)", vp.name, /Manos y pies/.test(packLine) && /4,60/.test(packLine) ? [] : [packLine]);
      // quitar un servicio rompe el pack y lo avisa
      await page.locator(".visit__list button").first().click();
      await page.waitForTimeout(250);
      const warn = await page.locator(".notice").first().innerText();
      log("completa 3 · quitar un servicio avisa de que ya no es el pack", vp.name, /pack/i.test(warn) ? [] : [warn]);
      // se sugiere completar el pack y al aceptar vuelve
      const sg = await page.locator(".sugg__chip").count();
      log("completa 4 · se sugiere completar el pack", vp.name, sg >= 1 ? [] : ["no hay sugerencias"]);
      await page.locator(".sugg__chip").first().click();
      await page.waitForSelector(".visit__pack");
      log("completa 5 · al aceptar la sugerencia vuelve el pack", vp.name, []);
      // extras: suman tiempo y precio
      const before = await page.locator(".visit__title").innerText();
      await page.locator(".extras__row .extra").first().click();
      await page.waitForTimeout(250);
      const after = await page.locator(".visit__title").innerText();
      log("completa 6 · un extra suma tiempo y precio", vp.name, before !== after ? [] : ["el total no cambia"]);
      // acompañante: sus servicios van seguidos
      await page.click(".comp__open");
      await page.fill(".comp__form input", "Ana");
      await page.locator(".comp__list .extra").nth(2).click();
      await page.click(".comp__form .btn");
      await page.waitForSelector(".comp__sum");
      const items = await page.locator(".visit__list li").count();
      const seg = await page.locator(".seg").count();
      log("completa 7 · el acompañante añade sus servicios al mismo bloque", vp.name, items === 3 && seg === 0 ? [] : [`líneas: ${items}, selector: ${seg}`]);
      // atajos
      await page.waitForSelector(".quick__chip", { timeout: 5000 });
      await check(page, "completa 8 · atajos, extras y acompañante", vp, errors, "full-3-visita");
      const chip = page.locator(".quick__chip").first();
      await chip.evaluate((e) => e.scrollIntoView({ block: "center" }));
      await chip.click();
      await page.waitForSelector(".holdbar");
      log("completa 9 · un atajo bloquea el hueco en un toque", vp.name, []);
      const lastHold = sent.holds[sent.holds.length - 1] ?? {};
      log("completa 10 · el bloqueo lleva los extras elegidos", vp.name, Array.isArray(lastHold.addonIds) && lastHold.addonIds.length === 1 ? [] : [JSON.stringify(lastHold)]);
      await page.click(".holdbar .btn");
      await page.waitForSelector("form.form");
      await page.fill("input[autocomplete=name]", "María García López");
      await page.fill("input[type=tel]", "600123456");
      await page.check("input[type=checkbox]");
      await page.click("form.form button[type=submit]");
      await page.waitForSelector(".done");
      log("completa 11 · el comentario para el salón lleva al acompañante", vp.name, /Ana/.test(sent.book?.notes ?? "") ? [] : [sent.book?.notes ?? "(vacío)"]);
      await ctx.close();
    }
    // ===================== casillas de seguridad (microblading) =====================
    {
      const props = { services: SERVICES, staff: [{ id: 1, name: "Pro Diva" }], today: TODAY, maxDate: MAX, whatsapp: "34670424348", address: "Rúa Rambla San Pablo, 6, 15800 Melide, A Coruña", depositEnabled: true, refundHours: 24, trends: TRENDS, addons: ADDONS, packs: PACKS, lang: "es", depositPolicy: "repeat" };
      const { ctx, page, errors } = await setup(browser, vp, "booking", props);
      let body = null;
      page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/api/bookings")) body = JSON.parse(r.postData() || "{}"); });
      await page.waitForSelector(".pick");
      await page.locator(".pick", { hasText: "Microblading" }).first().click();
      await page.waitForSelector(".cal__day.is-free");
      const slot = page.locator(".slot:not(.slot--taken)").first();
      await slot.evaluate((e) => e.scrollIntoView({ block: "center" }));
      await slot.click();
      await page.waitForSelector(".holdbar");
      await page.click(".holdbar .btn");
      await page.waitForSelector("form.form");
      await page.fill("input[autocomplete=name]", "María García López");
      await page.fill("input[type=tel]", "600123456");
      await page.check("input[type=checkbox] >> nth=-1");
      const off = await page.locator("form.form button[type=submit]").isDisabled();
      log("casillas 1 · sin marcar las casillas de seguridad no se puede confirmar", vp.name, off ? [] : ["el botón está activo"]);
      await check(page, "casillas 2 · casillas de seguridad y nota de señal", vp, errors, "full-4-casillas");
      for (const cb of await page.locator(".safety input[type=checkbox]").all()) await cb.check();
      const on = await page.locator("form.form button[type=submit]").isEnabled();
      log("casillas 3 · con todas marcadas se puede confirmar", vp.name, on ? [] : ["sigue desactivado"]);
      await page.click("form.form button[type=submit]");
      await page.waitForSelector(".done");
      log("casillas 4 · se envían las casillas marcadas, no datos de salud", vp.name, JSON.stringify(body?.acks) === '["microblading"]' ? [] : [JSON.stringify(body?.acks)]);
      await ctx.close();
    }
    // ===================== idiomas: gallego e inglés =====================
    for (const [lang, heading] of [["en", "What can we do for you?"], ["gl", "Que che facemos?"]]) {
      const props = { services: SERVICES, staff: [{ id: 1, name: "Pro Diva" }], today: TODAY, maxDate: MAX, whatsapp: "34670424348", address: "Rúa Rambla San Pablo, 6, 15800 Melide, A Coruña", depositEnabled: true, refundHours: 24, trends: TRENDS, addons: ADDONS, packs: PACKS, lang };
      const { ctx, page, errors } = await setup(browser, vp, "booking", props);
      await page.waitForSelector(".pick");
      const h = await page.locator(".panel__title").first().innerText();
      log(`idioma ${lang} · el primer paso está traducido`, vp.name, h.trim() === heading ? [] : [h]);
      await page.locator(".pick").first().click();
      await page.waitForSelector(".cal__day.is-free");
      const body = await page.locator("body").innerText();
      const spanish = ["Elige tu hueco", "Añadir otro servicio", "Cargando huecos", "Mañana", "Quitar"].filter((x) => body.includes(x));
      log(`idioma ${lang} · el paso de fecha y hora no deja textos en castellano`, vp.name, spanish.length ? [spanish.join(", ")] : []);
      await check(page, `idioma ${lang} · fecha y hora`, vp, errors, `full-lang-${lang}`);
      await ctx.close();
    }

    // ===================== cancelar con cabeza: rescate, motivo, aviso de señal, ceder, cancelar todas =====================
    {
      const base = { code: "AB12CD34", token: "t".repeat(48), initial: "pending", late: false, noticeHours: 24, depositLoss: 0, canMove: true, closedByCentre: false, legs: 1 };
      const open = async (props) => {
        const r = await setup(browser, vp, "response", { ...base, ...props });
        r.sent = [];
        r.page.on("request", (q) => { if (q.method() === "POST") r.sent.push({ url: q.url(), body: JSON.parse(q.postData() || "{}") }); });
        await r.page.waitForSelector(".resp");
        return r;
      };
      // a) «No puedo ir» → primero se ofrece mover; un toque cambia la cita
      {
        const { ctx, page, errors, sent } = await open({});
        await page.click(".resp__btn--no");
        await page.waitForSelector(".resp__alt");
        const n = await page.locator(".resp__alt").count();
        log("cancelar 1 · antes de cancelar se ofrecen 3 huecos para mover", vp.name, n === 3 ? [] : [`huecos: ${n}`]);
        await check(page, "cancelar 2 · «¿mejor la movemos?»", vp, errors, "cancel-1-rescate");
        await page.locator(".resp__alt").first().click();
        await page.waitForSelector(".resp--ok");
        const mv = sent.find((x) => x.url.endsWith("/reschedule"));
        log("cancelar 3 · un toque cambia la hora de la cita", vp.name, mv && /T17:30/.test(mv.body.startsAt) ? [] : [JSON.stringify(mv)]);
        await ctx.close();
      }
      // b) prefiero cancelar → motivo en un toque → cancelada con el motivo
      {
        const { ctx, page, errors, sent } = await open({});
        await page.click(".resp__btn--no");
        await page.waitForSelector(".resp__alt");
        await page.click("text=No, prefiero cancelar");
        await page.waitForSelector(".resp__chip");
        await page.locator(".resp__chip").first().click();
        await check(page, "cancelar 4 · motivo en un toque", vp, errors, "cancel-2-motivo");
        await page.click(".resp__btn--no");
        await page.waitForSelector("text=Cita cancelada");
        const c = sent.find((x) => x.url.endsWith("/api/respond"));
        log("cancelar 5 · se envía el motivo elegido", vp.name, c?.body.why === "sick" && c.body.action === "cancel" ? [] : [JSON.stringify(c?.body)]);
        await ctx.close();
      }
      // c) cancelar tarde con señal pagada: aviso claro y casilla obligatoria; también se puede ceder la cita
      {
        const { ctx, page, errors, sent } = await open({ late: true, noticeHours: 24, depositLoss: 1000, canMove: false });
        await page.click(".resp__btn--no");
        await page.waitForSelector(".resp__warn");
        const warn = await page.locator(".resp__warn").innerText();
        log("cancelar 6 · con poco aviso se explica qué pasa con la señal", vp.name, /10\s€|10,00/.test(warn) && /menos de 24 h/.test(warn) ? [] : [warn]);
        const off = await page.locator(".resp__btn--no").first().isDisabled();
        log("cancelar 7 · sin aceptar la pérdida de la señal no se puede cancelar", vp.name, off ? [] : ["el botón está activo"]);
        await check(page, "cancelar 8 · cancelación tardía con señal", vp, errors, "cancel-3-tardia");
        await page.click(".resp__inline");
        await page.waitForSelector(".resp__form");
        await page.fill(".resp__form input >> nth=0", "Ana López");
        await page.fill(".resp__form input >> nth=1", "611222333");
        await check(page, "cancelar 9 · ceder la cita a otra persona", vp, errors, "cancel-4-ceder");
        await page.click(".resp__form button[type=submit]");
        await page.waitForSelector("text=Cita cedida a Ana López");
        const t = sent.find((x) => x.url.endsWith("/transfer"));
        log("cancelar 10 · se envían nombre y teléfono de la otra persona", vp.name, t?.body.name === "Ana López" && t.body.phone === "611222333" ? [] : [JSON.stringify(t?.body)]);
        await ctx.close();
      }
      // d) visita en horas distintas: botón para cancelar todas
      {
        const { ctx, page, sent } = await open({ legs: 2 });
        await page.click(".resp__btn--no");
        await page.waitForSelector(".resp__alt");
        await page.click("text=No, prefiero cancelar");
        await page.waitForSelector(".resp__btn--soft");
        await page.click(".resp__btn--soft");
        await page.waitForSelector("text=Citas canceladas (2)");
        log("cancelar 11 · «cancelar las 2 citas» las cancela de una vez", vp.name, sent.some((x) => x.url.endsWith("/cancel-all")) ? [] : ["no llamó a cancelar todas"]);
        await ctx.close();
      }
      // e) el centro pide mover la cita (cerrar el día): entra directo a elegir hora y cancelar no cuesta nada
      {
        const { ctx, page, errors } = await open({ closedByCentre: true, late: true, depositLoss: 0 });
        await page.waitForSelector(".resp__alt");
        const title = await page.locator(".resp__big").first().innerText();
        log("cancelar 12 · si el centro cierra el día se entra directo a elegir hora nueva", vp.name, /Elige una hora nueva/.test(title) ? [] : [title]);
        await page.click("text=Prefiero cancelar mi cita");
        await page.waitForSelector(".resp__chip");
        const noWarn = (await page.locator(".resp__warn").count()) === 0;
        log("cancelar 13 · sin penalización cuando el centro pide moverla", vp.name, noWarn ? [] : ["sale el aviso de señal"]);
        await check(page, "cancelar 14 · cita por mover (cerrar el día)", vp, errors, "cancel-5-cerrado");
        await ctx.close();
      }
    }
    // ===================== después de la visita: valoración (privada primero) y baja =====================
    {
      const t = { revTitle: "¿Qué tal ha ido?", revStars: "{n} de 5", revGoodTitle: "¡Muchas gracias! 💖", revGoodBody: "Nos alegra mucho. ¿Nos ayudas con una reseña en Google?", revGoogle: "Dejar mi reseña en Google", revBadTitle: "Gracias por decírnoslo", revBadBody: "Lamentamos que no haya sido perfecto. Cuéntanos qué podemos mejorar.", revComment: "¿Qué podríamos mejorar?", revSend: "Enviar", revThanks: "Gracias. Lo hemos recibido.", revAlready: "Ya nos dejaste tu valoración. ¡Gracias!", revError: "No hemos podido guardarlo." };
      const open = async (kind, props) => {
        const r = await setup(browser, vp, kind, props);
        r.sent = [];
        r.page.on("request", (q) => { if (q.method() === "POST") r.sent.push({ url: q.url(), body: JSON.parse(q.postData() || "{}") }); });
        await r.page.waitForSelector(kind === "review" ? ".rev" : ".easy__btn, .resp__big");
        return r;
      };
      {
        const { ctx, page, errors, sent } = await open("review", { code: "AB12CD34", token: "t".repeat(48), t, googleUrl: "https://g.page/r/ejemplo/review", alreadyRated: false });
        await page.locator(".rev__star").nth(4).click();
        await page.waitForSelector(".rev__after a");
        const href = await page.locator(".rev__after a").getAttribute("href");
        log("valoración 1 · con 5 estrellas se invita a dejarla en Google", vp.name, href === "https://g.page/r/ejemplo/review" ? [] : [String(href)]);
        log("valoración 2 · la nota se guarda antes de ir a Google", vp.name, sent.some((x) => x.url.endsWith("/review") && x.body.rating === 5) ? [] : ["no se envió la nota"]);
        await check(page, "valoración 3 · buena valoración", vp, errors, "review-good");
        await ctx.close();
      }
      {
        const { ctx, page, errors, sent } = await open("review", { code: "AB12CD34", token: "t".repeat(48), t, googleUrl: "https://g.page/r/ejemplo/review", alreadyRated: false });
        await page.locator(".rev__star").nth(1).click();
        await page.waitForSelector(".rev__after textarea");
        const noGoogle = (await page.locator(".rev__after a").count()) === 0;
        log("valoración 4 · con 2 estrellas NO se manda a Google: se pregunta qué mejorar en privado", vp.name, noGoogle ? [] : ["aparece el enlace de Google"]);
        await page.fill(".rev__after textarea", "Tuve que esperar bastante.");
        await check(page, "valoración 5 · valoración baja, comentario privado", vp, errors, "review-bad");
        await page.click(".rev__after .easy__btn");
        await page.waitForSelector("text=Gracias. Lo hemos recibido.");
        log("valoración 6 · el comentario se envía", vp.name, sent.some((x) => x.body.comment === "Tuve que esperar bastante.") ? [] : ["no se envió el comentario"]);
        await ctx.close();
      }
      {
        const { ctx, page } = await open("review", { code: "AB12CD34", token: "t".repeat(48), t, googleUrl: null, alreadyRated: true });
        const txt = await page.locator(".rev").innerText();
        log("valoración 7 · si ya valoró, solo se le da las gracias", vp.name, /Ya nos dejaste/.test(txt) ? [] : [txt]);
        await ctx.close();
      }
      {
        const { ctx, page, errors, sent } = await open("optout", { token: "5.abcdefabcdefabcdefabcdef", label: "Confirmar baja", done: "Hecho. No te escribiremos más.", error: "No hemos podido guardarlo." });
        await check(page, "baja 1 · botón de baja", vp, errors, "optout");
        await page.click(".easy__btn");
        await page.waitForSelector("text=Hecho. No te escribiremos más.");
        log("baja 2 · la baja se confirma con un botón (POST), no al abrir el enlace", vp.name, sent.some((x) => x.url.endsWith("/api/optout") && x.body.token === "5.abcdefabcdefabcdefabcdef") ? [] : ["no se envió"]);
        await ctx.close();
      }
    }
    // ===================== fase 3: packs para dos / destacado / ocasión, toca retoque, test y añadir a la cita =====================
    {
      const props = { services: SERVICES, staff: [{ id: 1, name: "Pro Diva" }], today: TODAY, maxDate: MAX, whatsapp: "34670424348", address: "Rúa Rambla San Pablo, 6, 15800 Melide, A Coruña", depositEnabled: true, refundHours: 24, trends: TRENDS, addons: ADDONS, packs: PACKS, lang: "es" };
      // a) packs: destacado, de ocasión y para dos
      {
        const { ctx, page, errors } = await setup(browser, vp, "booking", props);
        const holds = [];
        page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/api/holds")) holds.push(JSON.parse(r.postData() || "{}")); });
        await page.waitForSelector(".pack");
        const tags = await page.locator(".pack__tag").allInnerTexts();
        log("fase3 1 · los packs muestran «destacado», la ocasión y «para dos»", vp.name, tags.some((t) => /destacado/i.test(t)) && tags.some((t) => /Boda/.test(t)) && tags.some((t) => /Para dos/.test(t)) ? [] : [tags.join(" | ")]);
        await check(page, "fase3 2 · packs destacado, ocasión y para dos", vp, errors, "p3-packs");
        await page.locator(".pack", { hasText: "Madre e hija" }).click();
        await page.waitForSelector(".pack-two");
        await page.fill(".pack-two input", "Ana");
        await check(page, "fase3 3 · pack para dos: nombre de la acompañante", vp, errors, "p3-dos");
        await page.click(".pack-two button[type=submit]");
        await page.waitForSelector(".visit__pack");
        const line = await page.locator(".visit__pack").innerText();
        const rows = await page.locator(".visit__list li").count();
        log("fase3 4 · el pack para dos suma sus servicios dos veces y aplica el descuento (2,40 €)", vp.name, rows === 2 && /2,40/.test(line) ? [] : [`líneas ${rows}: ${line}`]);
        await page.waitForSelector(".quick__chip", { timeout: 5000 });
        const chip = page.locator(".quick__chip").first();
        await chip.evaluate((e) => e.scrollIntoView({ block: "center" }));
        await chip.click();
        await page.waitForSelector(".holdbar");
        const h = holds[holds.length - 1] ?? {};
        log("fase3 5 · se pide el bloqueo con el pack para dos", vp.name, h.packageSlug === "madre-e-hija" && h.serviceIds?.length === 2 ? [] : [JSON.stringify(h)]);
        await ctx.close();
      }
      // b) «toca retoque» según las visitas guardadas en el móvil
      {
        const visits = [{ startsAt: new Date(Date.now() - 21 * 86400000).toISOString(), slugs: ["manicura-semipermanente"], color: "Rosa chicle" }];
        const { ctx, page, errors } = await setup(browser, vp, "booking", props, { visits });
        await page.waitForSelector(".retouch");
        const txt = await page.locator(".retouch").innerText();
        log("fase3 6 · «toca retoque» con las semanas y el color de la última vez", vp.name, /3 semanas/.test(txt) && /Rosa chicle/.test(txt) ? [] : [txt]);
        await check(page, "fase3 7 · toca retoque", vp, errors, "p3-retoque");
        await page.click(".retouch .btn");
        await page.waitForSelector(".visit__title");
        const list = await page.locator(".visit__list li, .legs li").allInnerTexts();
        log("fase3 8 · «Reservar retoque» deja elegida la manicura semipermanente", vp.name, list.some((x) => /Manicura semipermanente/.test(x)) ? [] : [list.join(" | ")]);
        await ctx.close();
      }
      // c) test «¿qué manicura eres?»
      {
        const { ctx, page, errors } = await setup(browser, vp, "booking", props);
        await page.waitForSelector(".quiz__cta");
        await page.click(".quiz__cta");
        await page.locator(".quiz__opt").nth(2).click(); // todo el tiempo
        await page.locator(".quiz__opt").nth(2).click(); // atrevida
        await check(page, "fase3 9 · test: tercera pregunta", vp, errors, "p3-quiz");
        await page.locator(".quiz__opt").nth(2).click(); // lo máximo posible
        await page.waitForSelector(".quiz__res");
        const t = await page.locator(".quiz__rt").innerText();
        log("fase3 10 · el test recomienda «Look completo» a quien tiene tiempo, es atrevida y quiere que dure", vp.name, /Look completo/.test(t) ? [] : [t]);
        await check(page, "fase3 11 · resultado del test", vp, errors, "p3-quiz-res");
        await page.click(".quiz__res .btn--primary");
        await page.waitForSelector(".visit__title");
        const items = await page.locator(".visit__list li").count();
        const extras = await page.locator(".extras__row .extra.is-on").count();
        log("fase3 12 · reservar desde el test elige los 3 servicios y el nail art sugerido", vp.name, items === 3 && extras === 1 ? [] : [`servicios ${items}, extras ${extras}`]);
        await ctx.close();
      }
      // d) añadir un servicio a una cita ya reservada
      {
        const r = await setup(browser, vp, "addto", { code: "AB12CD34", token: "t".repeat(48) });
        const sent = [];
        r.page.on("request", (q) => { if (q.method() === "POST" && q.url().includes("/extras")) sent.push(JSON.parse(q.postData() || "{}")); });
        await r.page.waitForSelector(".addto__btn");
        const n = await r.page.locator(".addto__btn").count();
        log("fase3 13 · se ofrecen los servicios que caben a continuación de la cita", vp.name, n === 2 ? [] : [`botones: ${n}`]);
        await check(r.page, "fase3 14 · añade algo a tu cita", vp, r.errors, "p3-addto");
        await r.page.locator(".addto__btn").first().click();
        await r.page.waitForTimeout(400);
        log("fase3 15 · al pulsar se pide añadir ese servicio", vp.name, sent[0]?.serviceId === 4 ? [] : [JSON.stringify(sent)]);
        await r.ctx.close();
      }
    }
    // ===================== visita con cada servicio a su hora =====================
    {
      const props = { services: SERVICES, staff: [{ id: 1, name: "Pro Diva" }], today: TODAY, maxDate: MAX, whatsapp: "34670424348", address: "Rúa Rambla San Pablo, 6, 15800 Melide, A Coruña", depositEnabled: true, refundHours: 24, trends: TRENDS, addons: ADDONS, packs: PACKS, lang: "es" };
      const { ctx, page, errors } = await setup(browser, vp, "booking", props);
      await page.waitForSelector(".pick");
      await page.click(".pick >> nth=0");
      await page.waitForSelector(".cal__day.is-free");
      await page.click(".visit__add");
      await page.click(".visit__pick button >> nth=1");
      await page.waitForSelector(".seg");
      await check(page, "separadas 1 · elegir «cada uno a su hora»", vp, errors, "apart-1-modo");
      await page.click(".seg__btn >> nth=1");
      await page.waitForSelector(".legs");
      await check(page, "separadas 2 · una cita por servicio", vp, errors, "apart-2-citas");
      const pick = async (n) => {
        await page.waitForSelector(".slots .slot");
        await page.waitForTimeout(250);
        const el = page.locator(".slot:not(.slot--taken):not(.slot--mine):not(.slot--yours):not(.slot--range)").nth(n);
        await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
        await el.click();
        await page.waitForTimeout(350);
      };
      await pick(0);
      const activeAfterFirst = await page.evaluate(() => Array.from(document.querySelectorAll(".leg")).findIndex((l) => l.classList.contains("is-active")));
      log("separadas 3 · tras elegir la primera hora pasa sola a la siguiente cita", vp.name, activeAfterFirst === 1 ? [] : [`la cita activa es la ${activeAfterFirst + 1}`]);
      const clashes = await page.locator(".slot--yours").count();
      log("separadas 4 · los huecos que coinciden con su otra cita se marcan", vp.name, clashes >= 1 ? [] : ["no hay huecos marcados como coincidentes"]);
      await check(page, "separadas 5 · segunda cita, con la primera ya guardada", vp, errors, "apart-3-segunda");
      if (false) { const info = await page.evaluate(() => { const els = Array.from(document.querySelectorAll('.slot:not(.slot--taken):not(.slot--mine):not(.slot--yours):not(.slot--range)')); const t = els[3]; const r = t && t.getBoundingClientRect(); const b = document.querySelector('.holdbar'); const rb = b && b.getBoundingClientRect(); return { n: els.length, target: r && [Math.round(r.top), Math.round(r.bottom)], bar: rb && [Math.round(rb.top), Math.round(rb.bottom)], vh: innerHeight, sy: Math.round(scrollY), docH: document.documentElement.scrollHeight, activeLeg: Array.from(document.querySelectorAll('.leg')).findIndex(l => l.classList.contains('is-active')) }; }); console.log('DBG', vp.name, JSON.stringify(info)); }
      await pick(3);
      await page.waitForSelector(".holdbar");
      const bar = await page.locator(".holdbar strong").first().innerText();
      log("separadas 6 · con todas las horas guardadas se ofrece continuar", vp.name, /Todas tus horas/.test(bar) ? [] : [`la barra dice: ${bar}`]);
      await check(page, "separadas 7 · todas las horas guardadas", vp, errors, "apart-4-todas");
      await page.click(".holdbar .btn");
      await page.waitForSelector("form.form");
      await page.fill("input[autocomplete=name]", "María García López");
      await page.fill("input[type=tel]", "600123456");
      await page.check("input[type=checkbox]");
      await check(page, "separadas 8 · datos de varias citas", vp, errors, "apart-5-datos");
      await page.click("form.form button[type=submit]");
      await page.waitForSelector(".done");
      const nDone = await page.locator(".donelist li").count();
      log("separadas 9 · la confirmación enseña las dos citas", vp.name, nDone === 2 ? [] : [`se muestran ${nDone}`]);
      await check(page, "separadas 10 · confirmación de varias citas", vp, errors, "apart-6-confirmacion");
      await ctx.close();
    }
    // ===================== modo fácil =====================
    {
      const props = { services: SERVICES, today: TODAY, address: "Rúa Rambla San Pablo, 6, 15800 Melide, A Coruña", mapsUrl: "https://maps.example", depositEnabled: true, refundHours: 24 };
      const { ctx, page, errors } = await setup(browser, vp, "easy", props, { saved: true, profile: true });
      await page.waitForSelector(".bk");
      await check(page, "fácil 1 · menú con varias citas y una cancelada", vp, errors, "facil-1-menu");
      await page.click("text=Pedir otra cosa");
      await page.waitForSelector(".easy__btn--tile");
      await check(page, "fácil 2 · categoría", vp, errors);
      await page.click(".easy__btn--tile >> nth=0");
      await page.waitForSelector(".easy__btn--row");
      await check(page, "fácil 3 · servicio", vp, errors);
      await page.click(".easy__btn--row >> nth=0");
      await page.waitForSelector(".easy__btn--tile");
      await check(page, "fácil 4 · día", vp, errors, "facil-4-dia");
      await page.click(".easy__btn--tile >> nth=0");
      await page.waitForSelector(".easy__btn--time");
      await check(page, "fácil 5 · hora", vp, errors, "facil-5-hora");
      await page.click(".easy__btn--time >> nth=0");
      await page.waitForSelector("form.easy__form");
      await check(page, "fácil 6 · datos", vp, errors, "facil-6-datos");
      await page.click("form.easy__form button[type=submit]");
      await page.waitForSelector(".easy__done");
      await check(page, "fácil 7 · confirmación (con atrás)", vp, errors, "facil-7-confirmacion");
      await page.click("text=Volver al menú");
      await page.waitForSelector(".easy__btn--main");
      log("fácil 8 · 'Volver al menú' funciona", vp.name, []);
      await ctx.close();
    }
    // ===================== hero =====================
    {
      const props = { services: SERVICES.slice(0, 5).map((s) => ({ id: s.id, slug: s.slug, name: s.name, durationMin: s.durationMin, priceCents: s.priceCents })), today: TODAY };
      const { ctx, page, errors } = await setup(browser, vp, "hero", props);
      await page.waitForSelector(".hb__slot");
      await page.click(".swatch >> nth=4"); // Burdeos
      await page.waitForTimeout(500);
      const name = await page.locator(".hand__name").innerText();
      await check(page, "hero · mini-reserva y mano", vp, errors, "hero");
      log("hero · al elegir Burdeos el selector lo recuerda", vp.name, /Burdeos/.test(name) ? [] : [`el selector dice: ${name}`]);
      await ctx.close();
    }
    // ===================== cambiar hora =====================
    {
      const props = { code: "AB12CD34", token: "t".repeat(12), serviceIds: [1], currentStartsAt: `${addDays(TODAY, 3)}T17:30:00+02:00`, today: TODAY };
      const { ctx, page, errors } = await setup(browser, vp, "resched", props);
      await page.waitForSelector(".easy__btn--tile");
      await page.click(".easy__btn--tile >> nth=0");
      await page.waitForSelector(".easy__btn--time");
      await page.click(".easy__btn--time >> nth=1");
      await check(page, "cambiar hora", vp, errors, "cambiar");
      await ctx.close();
    }
    // ===================== lista de espera =====================
    {
      const { ctx, page, errors } = await setup(browser, vp, "waitlist", { serviceId: 1, day: addDays(TODAY, 3), dayLabel: "Jueves 15 de octubre", source: "web", startOpen: true });
      await page.waitForSelector("form");
      await check(page, "lista de espera", vp, errors);
      await ctx.close();
    }
  }
  // ===================== reserva en escritorio: lateral con «Tu cita» y la chica del avatar =====================
  {
    const vp = { name: "desktop-1280", width: 1280, height: 900, desktop: true };
    const props = { services: SERVICES, staff: [{ id: 1, name: "Pro Diva" }], today: TODAY, maxDate: MAX, whatsapp: "34670424348", address: "Rúa Rambla San Pablo, 6, 15800 Melide, A Coruña", depositEnabled: true, refundHours: 24, trends: TRENDS, addons: ADDONS, packs: PACKS, lang: "es" };
    const { ctx, page, errors } = await setup(browser, vp, "booking", props);
    await page.waitForSelector(".pick");
    await page.click(".pick >> nth=0");
    await page.waitForSelector(".cal__day.is-free");
    await page.click(".slot:not(.slot--taken) >> nth=0");
    await page.waitForSelector(".holdbar");
    const side = await page.evaluate(() => {
      const a = document.querySelector(".flow__side .summary"), v = document.querySelector(".flow__side .avatar");
      if (!a || !v) return null;
      const ra = a.getBoundingClientRect(), rv = v.getBoundingClientRect();
      return { avatarBelow: rv.top >= ra.bottom - 1, visible: rv.height > 100, state: v.className };
    });
    log("escritorio · la chica aparece debajo de «Tu cita» y reacciona al hueco guardado", vp.name, side && side.avatarBelow && side.visible && /avatar--held/.test(side.state) ? [] : ["avatar mal colocado o sin estado: " + JSON.stringify(side)]);
    await check(page, "escritorio · reserva con avatar", vp, errors, "web-desktop");
    // Diva: pregunta por tendencias y añade el servicio con un toque
    await page.click(".avatar__chip >> nth=0");
    await page.waitForSelector(".avatar__bubble:not(.avatar__bubble--typing)", { timeout: 4000 });
    await page.waitForTimeout(700);
    const said = await page.locator(".avatar__bubble").innerText();
    log("Diva · responde con una tendencia al preguntarle", vp.name, /Burdeos|Lifting/.test(said) ? [] : [`dijo: ${said.slice(0, 60)}`]);
    const before = await page.locator(".summary dd").first().innerText();
    if (await page.locator(".avatar__act").count()) {
      await page.click(".avatar__act");
      await page.waitForTimeout(500);
    }
    const after = await page.locator(".summary dd").first().innerText();
    log("Diva · el botón añade el servicio a la cita", vp.name, after !== before || /Lifting|Manicura/.test(after) ? [] : ["el servicio no se añadió"]);
    await page.fill("#diva-q", "cuánto cuesta el lifting");
    await page.press("#diva-q", "Enter");
    await page.waitForTimeout(900);
    const price = await page.locator(".avatar__bubble").innerText();
    log("Diva · contesta a una pregunta escrita (precio)", vp.name, /35 €|€/.test(price) ? [] : [`dijo: ${price.slice(0, 60)}`]);
    await page.fill("#diva-q", "¿tenéis packs?");
    await page.press("#diva-q", "Enter");
    await page.waitForTimeout(900);
    const packsSaid = await page.locator(".avatar__bubble").innerText();
    log("Diva · conoce los packs", vp.name, /Manos y pies/.test(packsSaid) ? [] : [`dijo: ${packsSaid.slice(0, 70)}`]);
    await check(page, "escritorio · Diva conversando", vp, errors, "diva-chat");
    await ctx.close();
  }
  await browser.close();
  let total = 0;
  for (const [label, byVp] of Object.entries(results)) {
    const merged = new Set();
    for (const [vpn, issues] of Object.entries(byVp)) for (const i of issues) merged.add(`${i}  [${vpn}]`);
    total += merged.size;
    console.log(`\n${merged.size === 0 ? "✔" : "✘"} ${label}${merged.size ? ` — ${merged.size} avisos` : ""}`);
    for (const m of [...merged].slice(0, 12)) console.log("    -", m);
  }
  console.log(`\nTOTAL: ${total} avisos`);
  if (total > 0) process.exitCode = 1;
})().catch((e) => { console.error("FALLO DEL SCRIPT:", e.message); process.exit(1); });
