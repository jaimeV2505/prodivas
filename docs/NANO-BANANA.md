# Pro Diva · Guía de imágenes con Nano Banana

Todo lo necesario para generar el hero y las imágenes de referencia de TODA la web con el mismo estilo.
Los prompts van en inglés (el modelo responde con más precisión); las explicaciones, en español.

---

## 0. Qué modelo usar

| Modelo | Para qué |
| --- | --- |
| **Nano Banana 2** (el que trae la app de Gemini por defecto) | Borradores rápidos: probar composiciones y colores |
| **Nano Banana Pro** (Gemini 3 Pro Image) | Versiones finales: más calidad, hasta 4K y hasta 14 imágenes de referencia |

Cómo trabajar: borradores con el rápido → eliges la mejor → la rehaces en Pro a 2K o 4K.
Siempre elige el **formato (aspect ratio)** en los ajustes y escríbelo también en el prompt.

---

## 1. El concepto visual (en una frase)

> **Dentro de un pétalo de rosa**: un mundo rosa claro, luminoso, femenino y alegre; premium pero cercano, con flores magenta frescas y luz de ventana suave.

Por qué: es lo que ya se ve en el Instagram de Pro Diva (local rosa, flores, logotipo rosa y magenta) y es lo que usa la web (fondos blush, botones magenta). Las imágenes tienen que sentirse **la misma marca** que la página.

Tres reglas que no se tocan:
1. **Luminoso (high-key)**: nada oscuro ni dramático. El texto de la web va en ciruela oscuro encima, así que el fondo tiene que ser claro.
2. **Un solo acento**: el magenta. Todo lo demás son rosas suaves.
3. **Espacio vacío**: cada imagen deja una zona tranquila donde pueda ir texto o botones.

---

## 2. Paleta (sube `prodiva-paleta-referencia.png` como imagen de referencia)

| Color | Hex | Papel | Proporción en la imagen |
| --- | --- | --- | --- |
| Blush | `#FCE4EF` | Fondo dominante, sedas, paredes, luz | ~60 % |
| Rosa pétalo | `#F9C6DC` | Sombras suaves, pétalos claros, telas | ~14 % |
| Rosa chicle | `#F27AB9` | Esmalte, flores, objetos protagonistas | ~14 % |
| **Magenta** | `#B0206A` | **Único acento**: una flor, un frasco, un detalle | ~8 % |
| Verde hoja | `#6F9A6B` | Un tallo o una hoja, nada más | ~2 % |
| Ciruela | `#3A1230` | Solo puntos de sombra muy pequeños | ~2 % |
| Blanco | `#FFFFFF` | Cerámica, perla, reflejos | libre |

**Prohibido**: amarillos y tonos cálidos anaranjados, azules, grises fríos, negros duros, dorados llamativos.
Si una imagen sale con "tinte amarillo": edítala con *"remove the warm yellow cast, make the whites neutral-pink"*.

---

## 3. Escenografía (qué hay en el decorado)

**Superficies y materiales** (siempre los mismos): seda y satén rosa, vidrio esmerilado, cerámica blanca, perla, lino claro, mármol rosa muy pálido.

**Flores y detalles**: anémonas magenta frescas (son las flores de su cartelería), pétalos de cerezo rosa y blanco sueltos, una hoja verde a lo sumo.

**Luz**: ventana grande a un lado, luz natural difusa de mañana, sombras suaves teñidas de rosa. Sin flash, sin focos duros.

**Cámara** (para que todo parezca la misma sesión): fotografía editorial de belleza, cámara full-frame, objetivo macro 85 mm, f/2.8, fondo desenfocado cremoso, grano de película muy sutil, texturas reales (no piel de plástico).

**Ambiente**: boutique de belleza luminosa de pueblo con encanto, fresca, sin lujo frío. Alegre, no solemne.

**Lo que NO debe aparecer**: texto, letras, logos, marcas reales, personas reconocibles o caras completas, piedras de spa, bambú, orquídeas blancas ni velas (clichés de spa), purpurina excesiva, manos con dedos raros.

---

## 4. BLOQUE MAESTRO DE ESTILO (cópialo al principio de TODOS los prompts)

```
Art direction for Pro Diva, a boutique beauty studio and hair-product shop in Melide, Galicia (Spain). Mood: fresh, feminine, joyful, premium but approachable — a bright blush-pink world, like the inside of a rose petal. High-key natural window light from one side, soft and diffused, gentle shadows tinted pink, no harsh contrast. Strict palette: blush pink #FCE4EF as the dominant background (about 60%), soft petal pink #F9C6DC and bubblegum pink #F27AB9 as secondary tones (about 28%), deep magenta #B0206A as the single accent (about 8%), tiny touches of leaf green #6F9A6B (about 2%), clean white, and very dark plum #3A1230 only for tiny deep accents. No yellow, no orange or warm cast, no teal, no blue, no cold grey. Materials: pink silk and satin, frosted glass, white ceramic, pearl, soft linen, fresh magenta anemones and cherry-blossom petals. Photography: editorial beauty still life, full-frame camera, 85mm macro lens, f/2.8, shallow depth of field, creamy bokeh, crisp focus on the subject, very subtle film grain, natural surface texture (never plastic or over-retouched). Clean, uncluttered composition with generous calm negative space. Absolutely no text, no letters, no logos, no watermarks, no brand names, no recognizable people or faces.
```

---

## 5. Lista de imágenes (nombres y dónde se usan)

| # | Archivo | Formato | Tamaño final | Dónde se usa |
| --- | --- | --- | --- | --- |
| 1 | `hero.jpg` | 16:9 | 2560×1440 | Portada. Imagen guía de TODO el estilo |
| 2 | `nails.jpg` | 4:3 | 1600×1200 | Panel «Manicura y pedicura» |
| 3 | `eyes.jpg` | 4:3 | 1600×1200 | Panel «Mirada» |
| 4 | `wax.jpg` | 4:3 | 1600×1200 | Panel «Depilación» |
| 5 | `reel-1.jpg` | 9:16 | 1080×1920 | Muro «Mira cómo queda» |
| 6 | `reel-2.jpg` | 9:16 | 1080×1920 | Muro «Mira cómo queda» |
| 7 | `reel-3.jpg` | 9:16 | 1080×1920 | Muro «Mira cómo queda» |
| 8 | `og.jpg` | 16:9 (recortar a 1200×630) | 1200×630 | Vista previa al compartir el enlace (WhatsApp, Instagram) |
| 9 | `tienda.jpg` | 4:3 | 1600×1200 | Sección de tienda de peluquería (opcional) |
| 10 | `textura.jpg` | 16:9 | 2560×1440 | Fondo suave de secciones (opcional) |

Se guardan en `public/images/` (hero, nails, eyes, wax, reel-1…3, tienda, textura) y `og.jpg` en `public/`. Cada imagen nueva se activa en `src/lib/media.ts` (ver README → «Imágenes de la web»).
**Si cambias `hero.jpg`**, hay que regenerar la máscara de las uñas: `python3 scripts/make-nail-mask.py`.

---

## 6. PROMPTS

> En cada uno: pega primero el **bloque maestro** (sección 4) y luego el texto de la imagen. Sube como referencia `prodiva-paleta-referencia.png`.

### 6.1 HERO (`hero.jpg`) — la imagen más importante

**Qué buscamos**: una mano con esmalte rosa chicle sosteniendo una anémona magenta, sobre seda blush. Es el símbolo de la marca (uñas + flores). La composición deja **vacía la mitad izquierda** (ahí van el titular y el buscador de huecos) y coloca el objeto en el tercio derecho.

```
[PEGAR BLOQUE MAESTRO]

IMAGE: Hero image for a beauty salon website. Aspect ratio 16:9, wide horizontal composition, high resolution.
Scene: on the right third of the frame, a relaxed woman's hand (only the hand and a bit of wrist, no face, no body) emerges from the right edge, palm slightly turned, gently holding a single fresh deep-magenta anemone with a green stem. The nails are medium-length almond shape, glossy bubblegum-pink gel polish (#F27AB9), flawless, with a soft window reflection on each nail. The hand rests above rippled blush-pink silk (#FCE4EF) with a few loose white and pink cherry-blossom petals scattered on it.
Composition: the entire left 55% of the frame is calm, smooth blush silk and soft out-of-focus pink light — empty, ready for a headline. The subject sits at about 70% from the left and slightly below the center. Subtle diagonal fold of silk leading the eye toward the hand. Background gently blurred, creamy pink bokeh at the top right.
Light: bright soft daylight from a large window on the left, pink-tinted soft shadows, a gentle highlight on the nails and petals.
Hand anatomy: natural, relaxed, exactly five fingers, realistic proportions and skin texture, no extra fingers, clean cuticles.
Result: bright, airy, high-key, joyful and premium.
```

**Variante B (si las manos salen mal)** — mismo hero sin manos:

```
[PEGAR BLOQUE MAESTRO]

IMAGE: Hero image, aspect ratio 16:9. Still life on the right third of the frame: five glass nail-polish bottles in a gradient from soft petal pink to bubblegum pink to deep magenta, one stands taller with a fresh magenta anemone lying against it, on rippled blush-pink silk with scattered white and pink cherry-blossom petals. The left 55% of the frame is calm empty blush silk and soft pink bokeh, ready for a headline. Bright window light from the left, pink-tinted soft shadows, shallow depth of field.
```

**Versión móvil (opcional, 9:16)**: pídela después con la imagen elegida como referencia:

```
Using the attached image as reference, recreate the same scene in 9:16 vertical format: keep the same hand, flower, silk, light and colors. Place the hand and anemone in the lower half of the frame, and leave the entire top 45% as calm empty blush silk with soft bokeh. Keep everything else identical.
```

### 6.2 MANICURA (`nails.jpg`)

```
[PEGAR BLOQUE MAESTRO]

IMAGE: Aspect ratio 4:3. Extreme macro close-up of a fine brush gliding a glossy bubblegum-pink (#F27AB9) polish stroke onto an almond-shaped natural nail; a tiny bead of polish shines at the brush tip. Only the fingers are visible (no face), the hand rests relaxed on pink satin. In the soft blurred background: a small frosted-glass polish bottle and one magenta anemone petal. Focus on the polish bead and nail surface. Calm negative space at the lower left. Natural skin texture, exactly five fingers, realistic proportions.
```

### 6.3 MIRADA (`eyes.jpg`)

```
[PEGAR BLOQUE MAESTRO]

IMAGE: Aspect ratio 4:3. Tight beauty close-up, cropped from the eyebrow to the cheekbone only (the face is NOT fully visible, not identifiable): a closed eye with long, naturally curled, lifted dark lashes and a softly defined, natural brow, delicate skin with a soft peachy-pink glow, a single tiny pink cherry-blossom petal resting on the cheekbone. Background: out-of-focus blush-pink silk. Soft side window light, pink-tinted shadows. Calm negative space on the right side. Realistic skin texture, symmetrical, no heavy makeup, no glitter.
```

### 6.4 DEPILACIÓN (`wax.jpg`)

Evitamos cuerpos: transmite «piel suave y limpieza» con objetos.

```
[PEGAR BLOQUE MAESTRO]

IMAGE: Aspect ratio 4:3. Clean, minimal treatment-tray still life on pale pink marble: a small spool of white cotton threading string with a loose strand curling gracefully, a folded white linen towel, a frosted-glass jar of soothing cream, a small white ceramic dish with two cherry-blossom petals, and one fresh magenta anemone with a green leaf. Soft window light from the left, pink-tinted shadows, shallow depth of field. Calm negative space in the upper right. Feels fresh, hygienic and gentle.
```

### 6.5 REEL 1 (`reel-1.jpg`)

```
[PEGAR BLOQUE MAESTRO]

IMAGE: Aspect ratio 9:16, vertical. Top-down view of two relaxed hands (no faces) holding a bunch of fresh magenta anemones, glossy bubblegum-pink almond nails, resting on rippled blush satin with petals scattered. Soft window light from the left, pink shadows. Leave the upper 25% of the frame calm and empty. Exactly five fingers per hand, natural proportions.
```

### 6.6 REEL 2 (`reel-2.jpg`) — la paleta de esmaltes

Conecta con el «Elige tu color» de la portada.

```
[PEGAR BLOQUE MAESTRO]

IMAGE: Aspect ratio 9:16, vertical. Eight identical frosted-glass nail-polish bottles standing in a neat row on glossy blush-pink acrylic, each filled with a different shade: bubblegum pink, deep magenta, nude beige, classic red, burgundy, off-white, lilac and coral. Soft reflections beneath them, one magenta anemone lying in front. Shallow depth of field, the first bottle in sharp focus and the rest softly blurring away. Window light from the left. Calm empty space in the upper third.
```

### 6.7 REEL 3 (`reel-3.jpg`) — fondo de pétalos

```
[PEGAR BLOQUE MAESTRO]

IMAGE: Aspect ratio 9:16, vertical. Pink and white cherry-blossom petals falling and floating in the air against a smooth blush-pink background, some sharp, many softly blurred as creamy bokeh, tiny soft sparkles of light. Very airy, minimal and dreamy. The center of the frame is calm for overlaying content.
```

### 6.8 OG para compartir enlaces (`og.jpg`)

Genera en 16:9 y recorta a 1200×630. El **logotipo lo añades tú después** (Canva, Figma) para que salga perfecto.

```
[PEGAR BLOQUE MAESTRO]

IMAGE: Aspect ratio 16:9. Same visual world as the hero: blush silk, scattered cherry-blossom petals, one magenta anemone and a bubblegum-pink nail-polish bottle placed at the far right. The center and left of the frame are completely empty smooth blush silk (a logo and text will be added later). Bright, airy, centered calm.
```

### 6.9 TIENDA (`tienda.jpg`, opcional)

Para la sección de productos de peluquería. **Sin marcas reales**.

```
[PEGAR BLOQUE MAESTRO]

IMAGE: Aspect ratio 4:3. Flat-lay on blush linen: minimalist unbranded hair-care bottles and jars in white and pale pink frosted glass (blank labels, no text), a wide-tooth comb, a silk scrunchie in bubblegum pink, a small round brush, one magenta anemone. Soft window light, pink shadows, tidy asymmetrical arrangement, empty space on the left.
```

### 6.10 TEXTURA (`textura.jpg`, opcional)

Fondo para secciones: sin objetos.

```
[PEGAR BLOQUE MAESTRO]

IMAGE: Aspect ratio 16:9. Abstract close-up of rippled blush-pink satin fabric with soft gentle folds, light flowing from the left, subtle silky highlights, very low contrast, no objects, no petals. Calm and smooth, usable as a section background behind text.
```

### 6.11 Elementos recortables (opcional)

Para pegar pétalos/flores sobre la web: pídelos sobre blanco puro y quita el fondo después (Nano Banana no genera transparencias).

```
[PEGAR BLOQUE MAESTRO]

IMAGE: Aspect ratio 1:1. Six loose cherry-blossom petals and two magenta anemone blooms arranged with generous space between them on a flat pure white #FFFFFF background, crisp sharp edges, soft contact shadows, no other objects.
```

---

## 7. Cómo mantener TODO coherente (el truco)

1. **Empieza por el hero.** Genera 4 opciones, elige una. Esa es la **imagen guía**.
2. Para el resto, en la **misma conversación**, sube como referencias: `prodiva-paleta-referencia.png` + el hero elegido, y empieza el prompt con:
   > *Use the attached images as style and color reference. Keep the same lighting, palette, materials and mood. Create a new image:* …
3. **Retoca en vez de repetir**: cuando algo casi esté bien, pide solo el cambio:
   > *Change only the flower color to deep magenta #B0206A. Keep everything else exactly the same.*
   > *Make the background 10% lighter and remove the warm yellow cast.*
4. Genera **siempre 3–4 opciones** y elige. Descarta sin pena las que fallen.
5. Con Nano Banana Pro puedes subir hasta 14 referencias: añade también **fotos reales** de vuestro local y vuestros trabajos para acercar el estilo (no para copiar personas).

## 8. Revisión antes de subirla (checklist)

- [ ] Manos: cinco dedos, proporciones naturales, uñas limpias y sin deformaciones.
- [ ] Sin texto, letras raras, logos ni marcas.
- [ ] Colores: abre la imagen y compara con la paleta con el cuentagotas; sin tinte amarillo.
- [ ] Hay **zona vacía** donde irá el texto (pon encima el titular «Tu cita en Pro Diva» para comprobarlo).
- [ ] Prueba el **recorte móvil**: recorta el centro en 9:16 y mira que el objeto sigue visible.
- [ ] Nada de caras reconocibles.

**Exportar**: JPG calidad ~78 (o WebP). Hero ≤ 400 KB; el resto ≤ 250 KB cada una. Herramientas gratis: Squoosh (squoosh.app).
**Nombres**: exactamente como en la tabla (sección 5). Texto alternativo breve cuando se coloquen.

## 9. Después: darles vida con Higgsfield

Las imágenes sirven también como **primer fotograma** para generar vídeo (imagen a vídeo): sube `hero.jpg` y pide un movimiento lento («slow dolly-in, petals drifting, soft light shimmer, no cuts»). Así los vídeos mantienen exactamente el mismo mundo visual. Ver `HIGGSFIELD.md`.

## 10. Honestidad con las clientas

- Usa estas imágenes como **ambiente** (portada, fondos, paneles).
- Para enseñar **resultados reales** (uñas hechas, cejas, pestañas) usa **fotos reales de tu trabajo** con permiso de la clienta. Presentar una imagen creada con IA como resultado de vuestro servicio puede confundir y, según la normativa de consumo y publicidad, ser engañoso: revísalo.
- Comprueba las condiciones de uso comercial de tu plan de Gemini/Nano Banana.
