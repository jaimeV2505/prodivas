#!/usr/bin/env python3
"""
Detecta las uñas (esmalte rosa) de la foto del hero y guarda una máscara PNG con transparencia.
La web la usa para cambiar el color de las uñas REALES de la foto con el selector de esmaltes.

  python3 scripts/make-nail-mask.py [foto] [máscara]
  (por defecto: public/images/hero.jpg → public/images/hero-nails-mask.png)

Hace falta:  pip install pillow numpy scipy
Si cambias la foto del hero (otro encuadre o resolución), vuelve a ejecutarlo y revisa el resultado
con --preview (crea un .preview.png con las uñas marcadas en verde).
Pensado para la foto actual (cuatro uñas rosas en la mitad derecha). Con otra composición habrá que
ajustar las zonas ROI de abajo.
"""
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

args = [a for a in sys.argv[1:] if not a.startswith("--")]
src = args[0] if len(args) > 0 else "public/images/hero.jpg"
dst = args[1] if len(args) > 1 else "public/images/hero-nails-mask.png"
preview = "--preview" in sys.argv

im = Image.open(src).convert("RGB")
a = np.asarray(im).astype(float) / 255
H, W, _ = a.shape
r, g, b = a[..., 0], a[..., 1], a[..., 2]
mx, mn = a.max(-1), a.min(-1)
d = mx - mn
s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
h = np.zeros_like(mx)
m1 = (mx == r) & (d > 0)
h[m1] = (60 * ((g - b) / np.maximum(d, 1e-6)))[m1] % 360
m2 = (mx == g) & (d > 0) & ~m1
h[m2] = (60 * ((b - r) / np.maximum(d, 1e-6)) + 120)[m2]
m3 = (mx == b) & (d > 0) & ~m1 & ~m2
h[m3] = (60 * ((r - g) / np.maximum(d, 1e-6)) + 240)[m3]

# Zona donde están las uñas (fracciones de la imagen) y tamaño mínimo (se escala con la resolución)
roi = np.zeros((H, W), bool)
roi[int(H * 0.42):int(H * 0.59), int(W * 0.60):int(W * 0.79)] = True
min_area = 350 * (W * H) / (1280 * 714)
min_cy = H * 0.428

cand = roi & (h > 315) & (h < 352) & (s > 0.22) & (mx > 0.78)
cand = ndi.binary_fill_holes(ndi.binary_closing(cand, iterations=2))
lab, n = ndi.label(cand)
keep = np.zeros_like(cand)
for i in range(1, n + 1):
    ys, xs = np.where(lab == i)
    if len(xs) > min_area and ys.mean() > min_cy:
        keep |= lab == i
# Los brillos de la uña son rosa muy claro y se quedan fuera: se "rellenan" creciendo la máscara
# solo por píxeles rosados claros (nunca por la piel, de matiz naranja), unos pocos píxeles.
soft = roi & ((h > 318) | (h < 3)) & (s > 0.06) & (mx > 0.85)
grow = max(3, round(5 * W / 1280))
for _ in range(grow):
    keep = ndi.binary_dilation(keep) & (soft | keep)
keep = ndi.binary_fill_holes(ndi.binary_closing(keep, iterations=max(2, round(3 * W / 1280))))
keep = ndi.binary_dilation(keep, iterations=max(1, round(2 * W / 1280)))  # cubre el borde
_, count = ndi.label(keep)
print(f"{count} uñas detectadas (deberían ser 4)")
if count != 4:
    print("⚠️  Revisa la máscara con --preview: la foto no coincide con la esperada.")

alpha = Image.fromarray((keep * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(max(1.0, W / 1280)))
out = Image.new("RGBA", im.size, (255, 255, 255, 0))
out.putalpha(alpha)
out.save(dst)
print("máscara guardada en", dst)

if preview:
    vis = im.copy()
    vis.paste(Image.new("RGB", im.size, (0, 255, 120)), mask=Image.fromarray((keep * 150).astype(np.uint8)))
    p = dst.replace(".png", ".preview.png")
    vis.save(p)
    print("vista previa:", p)
