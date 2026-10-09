#!/usr/bin/env bash
# Convierte el vídeo del hero (generado con Higgsfield) en fotogramas para el scroll.
# Uso:  ./scripts/extract-frames.sh public/hero/hero.mp4 [fotogramas=90]
set -euo pipefail
IN="${1:?Uso: $0 vídeo.mp4 [fotogramas]}"
N="${2:-90}"
OUT="public/frames"
mkdir -p "$OUT"
rm -f "$OUT"/frame_*.webp

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
FPS=$(python3 -c "print($N / float($DUR))")

ffmpeg -y -i "$IN" -vf "fps=$FPS,scale=1600:-2" -frames:v "$N" -c:v libwebp -quality 78 "$OUT/frame_%04d.webp"
COUNT=$(ls "$OUT"/frame_*.webp | wc -l | tr -d ' ')
echo "✔ $COUNT fotogramas en $OUT"
echo "  Pon NEXT_PUBLIC_HERO_FRAMES=$COUNT en .env y reconstruye (docker compose up --build)."
