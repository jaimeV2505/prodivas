// Anota qué vídeos hay en public/videos para que la web no pregunte por los que no existen (evita 404 en cada visita).
// Se ejecuta solo antes de `npm run dev` y `npm run build`.
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "public", "videos");
const names = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".mp4")).map((f) => f.slice(0, -4)).sort() : [];
writeFileSync(
  path.join(root, "src", "lib", "videos.generated.ts"),
  `// Generado por scripts/video-manifest.mjs (no se edita a mano): vídeos que existen en public/videos\nexport const VIDEOS: string[] = ${JSON.stringify(names)};\n`,
);
console.log(`[videos] ${names.length ? names.join(", ") : "ninguno (la web usa los fondos animados)"}`);
