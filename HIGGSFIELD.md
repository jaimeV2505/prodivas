# Animaciones con Higgsfield MCP

El hero de la web hace *scroll-scrubbing*: el vídeo avanza o retrocede al ritmo del scroll.
Sin fotogramas en `public/frames/` la web funciona igual (hero con pétalos animados en CSS),
así que puedes publicar ya y añadir el vídeo después.

## 1. Conectar Higgsfield a Claude

Servidor MCP: `https://mcp.higgsfield.ai/mcp`
En Claude: Ajustes → Conectores → Añadir conector personalizado → pega la URL (según su web, no necesita API key).

## 2. Prompts (pégalos en Claude con el conector activo)

**Vídeo del hero (16:9, 5–6 s, cámara lenta y continua)**
> Cinematic macro shot of a woman's hands with glossy hot-pink semi-permanent manicure, resting on a soft blush-pink silk surface in a bright beauty salon. Pink and white flower petals drift slowly through the frame. Slow, steady dolly-in, shallow depth of field, soft window light, palette: bubblegum pink (#F27AB9), magenta (#B0206A), blush (#FCE4EF), touches of green leaves. No text, no logos, no cuts, one continuous camera move.

**Variante con pestañas / cejas (si prefieres otro foco)**
> Extreme close-up of a woman's eye with natural lifted lashes and defined brows, soft pink studio light, tiny pink petals floating past the lens, slow push-in, shallow depth of field, no text, no cuts.

**Fondo para la pantalla de confirmación (bucle corto, 3 s)**
> Seamless loop, pink and magenta flower petals falling slowly over a blush-pink background, soft bokeh, minimal, no text.

Consejos: pide siempre *una sola toma continua* (sin cortes) y *cámara estable*; así el scroll se siente fluido.

## 3. Del vídeo a la web

```bash
# guarda el vídeo como public/hero/hero.mp4
./scripts/extract-frames.sh public/hero/hero.mp4 90
# añade NEXT_PUBLIC_HERO_FRAMES=90 a .env y reconstruye
docker compose up --build
```
Para Vercel: haz commit de `public/frames/*.webp` (quita esa línea de `.gitignore`) y define
`NEXT_PUBLIC_HERO_FRAMES` en las variables de entorno del proyecto. 90 fotogramas a 1600 px pesan ~4–6 MB en total.
