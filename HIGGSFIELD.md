# Vídeos con Higgsfield MCP

La web tiene 7 "ranuras" de vídeo. Cada una busca `public/videos/<nombre>.mp4`; si no existe, muestra un fondo animado.
Para cambiar un vídeo solo hay que sustituir el archivo: no hay que tocar código.

## 1. Conectar Higgsfield

Servidor MCP: `https://mcp.higgsfield.ai/mcp` (según su web, sin API key).
- **Claude (web/app):** Ajustes → Conectores → Añadir conector personalizado → pega la URL.
- **Claude Code:** `claude mcp add --transport http higgsfield https://mcp.higgsfield.ai/mcp`

Con el conector activo, escribe en un chat nuevo:
> Genera con Higgsfield los 7 vídeos de HIGGSFIELD.md con el mismo estilo, y dime cuándo estén listos para descargarlos.

## 2. Lista de planos (mismo estilo en todos)

Estilo común: luz de ventana suave, fondo blush, paleta rosa chicle (#F27AB9), magenta (#B0206A), blush (#FCE4EF), toques de hojas verdes.
Siempre: una sola toma continua, cámara estable, sin texto, sin logos, sin caras reconocibles.

| Archivo | Formato | Duración | Prompt |
| --- | --- | --- | --- |
| `hero.mp4` | 16:9 | 6 s (bucle, sin cortes) | Macro cinematográfico de manos con manicura semipermanente rosa brillante sobre seda rosa pálido en un salón luminoso. Pétalos rosas y blancos caen despacio. Dolly-in lento y continuo, poca profundidad de campo. |
| `nails.mp4` | 4:3 | 5 s | Primer plano de una mano mientras pintan una uña con esmalte rosa chicle; el pincel se desliza con suavidad. Fondo blush desenfocado, reflejos suaves. |
| `eyes.mp4` | 4:3 | 5 s | Primer plano de un ojo con pestañas naturales levantadas y cejas definidas, luz rosada de estudio; pétalos diminutos cruzan el plano. Empuje lento. |
| `wax.mp4` | 4:3 | 5 s | Hilo de depilación y piel suave en primer plano, hojas verdes y flores rosas desenfocadas al fondo, movimiento lento y limpio. |
| `reel-1.mp4` | 9:16 | 5 s | Vertical: manos con uñas rosas sosteniendo una flor, cámara que sube despacio. |
| `reel-2.mp4` | 9:16 | 5 s | Vertical: paleta de esmaltes rosas alineados, la cámara pasa de lado a lado con reflejos. |
| `reel-3.mp4` | 9:16 | 5 s | Vertical: pétalos cayendo sobre una superficie rosa con destellos suaves, bucle limpio. |

## 3. Del vídeo a la web

```bash
# deja los originales con esos nombres en una carpeta, p. ej. ~/Downloads/prodiva-videos
./scripts/optimize-videos.sh ~/Downloads/prodiva-videos     # crea public/videos/*.mp4 y *.jpg
git add public/videos && git commit -m "Vídeos de la web" && git push
```
