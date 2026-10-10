const { chromium } = require("playwright");
const fs = require("fs");
const css = fs.readFileSync(process.env.AUDIT_ROOT + "/src/app/globals.css", "utf8");
const bundle = fs.readFileSync(process.env.AUDIT_WORK + "/bundle.js", "utf8");

const SERVICES = [
  [1, "manicura-semipermanente", "Manicura semipermanente", "Manicura y pedicura", "Limado, cutículas y esmaltado semipermanente.", 45, 1800, 0],
  [2, "manicura-clasica", "Manicura clásica", "Manicura y pedicura", "Limado, cutículas y esmalte tradicional.", 30, 1200, 0],
  [3, "pedicura", "Pedicura", "Manicura y pedicura", "Tratamiento completo de pies.", 50, 2200, 0],
  [5, "lifting-pestanas", "Lifting de pestañas", "Mirada", "Curvatura y definición natural de tus pestañas.", 60, 3500, 0],
  [7, "microblading", "Microblading de cejas", "Mirada", "Incluye diseño personalizado.", 120, 25000, 5000],
  [8, "hilo-cejas", "Cejas con hilo", "Depilación", null, 15, 600, 0],
].map(([id, slug, name, category, description, durationMin, priceCents, depositCents]) => ({ id, slug, name, category, description, durationMin, priceCents, depositCents }));

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
      : `<main class="${kind === "resched" ? "easy" : ""}"><div id="root"></div></main>`;
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
  await page.route("**/api/waitlist", (r) => r.fulfill({ json: { ok: true, already: false } }));
  await page.route("**/api/callback", (r) => r.fulfill({ json: { ok: true } }));
  await page.addInitScript(({ kind, props, extra }) => {
    window.__AUDIT__ = { component: kind, props };
    if (extra.saved) localStorage.setItem("pd_bookings", JSON.stringify([{ code: "AB12CD34", token: "t".repeat(48) }]));
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
      const props = { services: SERVICES, staff: [{ id: 1, name: "Pro Diva" }], today: TODAY, maxDate: MAX, whatsapp: "34670424348", address: "Rúa Rambla San Pablo, 6, 15800 Melide, A Coruña", depositEnabled: true, refundHours: 24, trends: TRENDS };
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
      await check(page, "web 5 · confirmación", vp, errors, "web-5-confirmacion");
      await page.click("text=Reservar otra cita");
      await page.waitForSelector(".pick");
      log("web 6 · 'Reservar otra cita' vuelve al menú", vp.name, []);
      await ctx.close();
    }
    // ===================== visita con cada servicio a su hora =====================
    {
      const props = { services: SERVICES, staff: [{ id: 1, name: "Pro Diva" }], today: TODAY, maxDate: MAX, whatsapp: "34670424348", address: "Rúa Rambla San Pablo, 6, 15800 Melide, A Coruña", depositEnabled: true, refundHours: 24, trends: TRENDS };
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
    const props = { services: SERVICES, staff: [{ id: 1, name: "Pro Diva" }], today: TODAY, maxDate: MAX, whatsapp: "34670424348", address: "Rúa Rambla San Pablo, 6, 15800 Melide, A Coruña", depositEnabled: true, refundHours: 24, trends: TRENDS };
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
