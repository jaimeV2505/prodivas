const { chromium } = require("playwright");
const fs = require("fs");
const VIEWPORTS = [
  { name: "se-320", width: 320, height: 568 },
  { name: "android-360", width: 360, height: 740 },
  { name: "iphone-375", width: 375, height: 812 },
  { name: "iphone-430", width: 430, height: 932 },
];
const pages = (process.argv[2] ? process.argv[2].split(",") : fs.readdirSync(process.env.AUDIT_WORK + "/out").filter((f) => f.endsWith(".html")).map((f) => f.replace(".html", "")));
const shotPages = new Set((process.argv[3] || "").split(",").filter(Boolean));

function auditInPage() {
  const vw = document.documentElement.clientWidth;
  const sel = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.className && typeof el.className === "string") s += "." + el.className.trim().split(/\s+/).slice(0, 2).join(".");
    const t = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 28);
    return t ? `${s} "${t}"` : s;
  };
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest("[aria-hidden='true'].hp, .hp"); };
  const clipped = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p); if (p !== document.body && p !== document.documentElement && /(auto|scroll|hidden|clip)/.test(o.overflowX)) return true; } return false; };
  const out = { pageOverflow: null, overflow: [], tap: [], smallText: [], inputFont: [], clippedText: [] };
  if (document.documentElement.scrollWidth > vw + 1) out.pageOverflow = `${document.documentElement.scrollWidth}px > ${vw}px`;

  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && !clipped(el) && getComputedStyle(el).position !== "fixed") out.overflow.push(`${sel(el)} → derecha ${Math.round(r.right)}px`);
  }
  // objetivos táctiles
  const ctrl = document.querySelectorAll("button, a.btn, a[class*='btn'], a.chip, a.bk__go, a.easy__btn, a.menu__cta, a.reel__row, a.hb__slot, a.admin__tab, a.spin, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, summary, [role=radio], [role=gridcell], label.check, label.mode, .swatch, a.back, a.easy__back");
  for (const el of ctrl) {
    if (!visible(el) || el.disabled) continue;
    const r = el.getBoundingClientRect();
    if (Math.min(r.width, r.height) < 44) out.tap.push(`${sel(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  // texto pequeño e inputs que provocan zoom en iOS
  const seen = new Set();
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 12) { const k = sel(el); if (!seen.has(k)) { seen.add(k); out.smallText.push(`${k} ${fs.toFixed(1)}px`); } }
  }
  for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea")) {
    if (!visible(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 16) out.inputFont.push(`${sel(el)} ${fs}px`);
  }
  // texto cortado dentro de cajas con overflow oculto
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    if (!el.classList.contains("sr-only") && /(hidden|clip)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 2 && el.children.length === 0 && (el.textContent || "").trim() && cs.textOverflow !== "ellipsis") out.clippedText.push(`${sel(el)} ${el.scrollWidth}>${el.clientWidth}`);
  }
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const report = {};
  for (const name of pages) {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      await page.goto("file://" + process.env.AUDIT_WORK + "/out/" + name + ".html");
      const r = await page.evaluate(auditInPage);
      report[`${name} @ ${vp.name}`] = r;
      if (shotPages.has(name) && (vp.name === "iphone-375" || vp.name === "se-320")) {
        await page.screenshot({ path: `${process.env.AUDIT_WORK}/shots/${name}-${vp.name}.png`, fullPage: true });
      }
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(process.env.AUDIT_WORK + "/report.json", JSON.stringify(report, null, 1));
  // resumen: agrupamos por problema, sin repetir entre tamaños
  const byPage = {};
  for (const [k, v] of Object.entries(report)) {
    const [name, vp] = k.split(" @ ");
    byPage[name] = byPage[name] || { pageOverflow: new Set(), overflow: new Set(), tap: new Set(), smallText: new Set(), inputFont: new Set(), clippedText: new Set() };
    if (v.pageOverflow) byPage[name].pageOverflow.add(`${vp}: ${v.pageOverflow}`);
    for (const key of ["overflow", "tap", "smallText", "inputFont", "clippedText"]) for (const x of v[key]) byPage[name][key].add(x.replace(/ \d+×\d+$/, (m) => m) + (key === "overflow" ? ` [${vp}]` : ""));
  }
  for (const [name, v] of Object.entries(byPage)) {
    const n = v.pageOverflow.size + v.overflow.size + v.tap.size + v.smallText.size + v.inputFont.size + v.clippedText.size;
    console.log(`\n=== ${name}: ${n} avisos`);
    for (const key of ["pageOverflow", "overflow", "tap", "smallText", "inputFont", "clippedText"]) {
      const arr = [...v[key]];
      if (!arr.length) continue;
      console.log(`  [${key}] ${arr.length}`);
      for (const x of arr.slice(0, 14)) console.log("     -", x);
      if (arr.length > 14) console.log(`     … y ${arr.length - 14} más`);
    }
  }
})();
