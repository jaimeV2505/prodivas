// Auditoría móvil: renderiza las pantallas reales con datos de ejemplo y las mide en un Chromium con
// tamaño de móvil (320, 360, 375 y 430 px). Comprueba desbordes horizontales, objetivos táctiles < 44 px,
// letra < 12 px, campos < 16 px (iOS hace zoom) y recorre los flujos de reserva paso a paso.
//
//   npm run audit:mobile            (hace falta:  npm i -D playwright tsx esbuild  y  npx playwright install chromium)
const fs = require("fs");
const path = require("path");
const { spawnSync, execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const WORK = path.join(ROOT, ".audit");
const HERE = __dirname;

fs.rmSync(WORK, { recursive: true, force: true });
for (const d of ["out", "shots", "mocks", "node_modules"]) fs.mkdirSync(path.join(WORK, d), { recursive: true });
fs.cpSync(path.join(HERE, "mocks"), path.join(WORK, "mocks"), { recursive: true });
fs.cpSync(path.join(HERE, "shims"), path.join(WORK, "node_modules"), { recursive: true });
fs.copyFileSync(path.join(HERE, "entry.tsx"), path.join(WORK, "entry.tsx"));
fs.writeFileSync(
  path.join(WORK, "tsconfig.json"),
  JSON.stringify({ compilerOptions: { jsx: "react-jsx", module: "commonjs", target: "ES2022", moduleResolution: "node", esModuleInterop: true, baseUrl: ROOT, paths: { "@/*": ["src/*"] }, skipLibCheck: true, strict: false } }),
);

let globalRoot = "";
try { globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim(); } catch { /* sin npm global */ }
const NODE_PATH = [path.join(WORK, "node_modules"), path.join(ROOT, "node_modules"), globalRoot, path.join(globalRoot, "tsx", "node_modules")].filter(Boolean).join(path.delimiter);
const env = { ...process.env, AUDIT_ROOT: ROOT, AUDIT_WORK: WORK, NODE_PATH };

const run = (cmd, args, label) => {
  const r = spawnSync(cmd, args, { env, stdio: "inherit", cwd: ROOT });
  if (r.status !== 0) { console.error(`\n✘ Falló: ${label}`); process.exit(r.status || 1); }
};
const tsx = process.env.TSX || "tsx";
console.log("\n── 1/4 Renderizando las pantallas (servidor)…");
run(tsx, ["--tsconfig", path.join(WORK, "tsconfig.json"), path.join(HERE, "render.cjs")], "renderizado");
console.log("\n── 2/4 Auditando pantallas en 4 tamaños de móvil…");
run("node", [path.join(HERE, "audit.js")], "auditoría estática");
console.log("\n── 3/4 Empaquetando los componentes interactivos…");
run("node", [path.join(HERE, "bundle.cjs")], "empaquetado");
console.log("\n── 4/4 Recorriendo los flujos de reserva…");
run("node", [path.join(HERE, "flows.js")], "flujos");
console.log(`\nCapturas en ${path.relative(ROOT, WORK)}/shots`);
