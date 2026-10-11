const Module = require("module");
const fs = require("fs");
const ROOT = process.env.AUDIT_ROOT;
const WORK = process.env.AUDIT_WORK;
const P = ROOT + "/src/";
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  const resolved = orig.call(this, request, ...rest);
  if (resolved === P + "lib/db.ts") return WORK + "/mocks/db.cjs";
  if (resolved === P + "lib/auth.ts") return WORK + "/mocks/auth.cjs";
  if (/\/actions\.ts$/.test(resolved)) return WORK + "/mocks/actions.cjs";
  return resolved;
};
const React = require("react"); globalThis.React = React;
const { renderToStaticMarkup } = require("react-dom/server");
const db = require(WORK + "/mocks/db.cjs");
const css = fs.readFileSync(P + "app/globals.css", "utf8");
const H = 3600000;
const d = (h) => new Date(Date.now() + h * H);
const p = (o) => Promise.resolve(o);
const others = [
  db.sumRow({ id: "22222222-2222-2222-2222-222222222222", code: "ZZ99YY88", starts_at: d(80), ends_at: d(80.5), service_name: "Pedicura" }),
  db.sumRow({ id: "33333333-3333-3333-3333-333333333333", code: "QQ11WW22", status: "CANCELLED", cancel_reason: "customer", starts_at: d(50), ends_at: d(50.5), service_name: "Lifting de pestañas" }),
];
const U = "11111111-1111-1111-1111-111111111111";
const T = "t".repeat(12);
const pages = [
  { name: "landing", mod: "app/page.tsx", args: [] },
  { name: "reservar", mod: "app/reservar/page.tsx", args: [{ searchParams: p({}) }] },
  { name: "reservar-staff2", mod: "app/reservar/page.tsx", args: [{ searchParams: p({ servicio: "manicura-semipermanente" }) }], variant: { staff2: true } },
  { name: "cita", mod: "app/(app)/cita/page.tsx", args: [{ searchParams: p({}) }], layout: "app/(app)/layout.tsx" },
  { name: "c-confirmed", mod: "app/c/[code]/page.tsx", args: [{ params: p({ code: "AB12CD34" }), searchParams: p({ t: T }) }], variant: { others } },
  { name: "c-cancelled", mod: "app/c/[code]/page.tsx", args: [{ params: p({ code: "AB12CD34" }), searchParams: p({ t: T }) }], variant: { booking: db.sumRow({ status: "CANCELLED", cancel_reason: "customer_reminder" }), others } },
  { name: "c-deposit-late", mod: "app/c/[code]/page.tsx", args: [{ params: p({ code: "AB12CD34" }), searchParams: p({ t: T }) }], variant: { booking: db.sumRow({ starts_at: d(5), ends_at: d(5.75), deposit_status: "PAID", deposit_cents: 5000, can_cancel: false }) } },
  { name: "c-valora", mod: "app/c/[code]/valora/page.tsx", args: [{ params: p({ code: "AB12CD34" }), searchParams: p({ t: T }) }], variant: { booking: db.sumRow({ starts_at: d(-30), ends_at: d(-29.25) }) } },
  { name: "baja", mod: "app/baja/[token]/page.tsx", args: [{ params: p({ token: require(P + "lib/optout.ts").optoutToken(5) }) }] },
  { name: "admin-valoraciones", mod: "app/admin/valoraciones/page.tsx", args: [] },
  { name: "admin-ofrecer", mod: "app/admin/ofrecer/page.tsx", args: [{ searchParams: p({ ok: "Avisadas 2 personas de la lista de espera." }) }] },
  { name: "c-cambiar", mod: "app/c/[code]/cambiar/page.tsx", args: [{ params: p({ code: "AB12CD34" }), searchParams: p({ t: T }) }] },
  { name: "admin-agenda", mod: "app/admin/page.tsx", args: [{ searchParams: p({}) }] },
  { name: "admin-semana", mod: "app/admin/semana/page.tsx", args: [{ searchParams: p({}) }] },
  { name: "admin-cita", mod: "app/admin/cita/[id]/page.tsx", args: [{ params: p({ id: U }), searchParams: p({ ok: "Hora cambiada" }) }] },
  { name: "admin-cita-cancelada", mod: "app/admin/cita/[id]/page.tsx", args: [{ params: p({ id: U }), searchParams: p({}) }], variant: { booking: db.sumRow({ status: "CANCELLED", cancel_reason: "centre" }) } },
  { name: "admin-clientas", mod: "app/admin/clientas/page.tsx", args: [{ searchParams: p({}) }] },
  { name: "admin-ficha", mod: "app/admin/clientas/[id]/page.tsx", args: [{ params: p({ id: "9" }), searchParams: p({}) }] },
  { name: "admin-ajustes", mod: "app/admin/ajustes/page.tsx", args: [{ searchParams: p({ ok: "Guardado" }) }] },
];
(async () => {
  const only = process.argv[2];
  for (const pg of pages) {
    if (only && pg.name !== only) continue;
    globalThis.__VARIANT__ = pg.variant || {};
    try {
      const mod = require(P + pg.mod);
      let el = await mod.default(...pg.args);
      if (pg.layout) el = require(P + pg.layout).default({ children: el });
      const body = renderToStaticMarkup(el);
      const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>${pg.name}</title>
<style>:root{--font-display:'DejaVu Sans',sans-serif;--font-body:'DejaVu Sans',sans-serif}</style><style>${css}</style>
<style>*,*::before,*::after{animation-duration:.001ms!important;animation-delay:0s!important;transition:none!important}</style></head><body>${body}</body></html>`;
      fs.writeFileSync(`${WORK}/out/${pg.name}.html`, html);
      console.log("✔", pg.name, body.length);
    } catch (e) {
      console.log("✘", pg.name, String(e.stack || e).split("\n").slice(0, 4).join(" | "));
    }
  }
})();
