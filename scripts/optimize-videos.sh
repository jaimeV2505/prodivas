#!/usr/bin/env bash
# Comprime los vídeos generados (Higgsfield u otros) para web: mp4 h264 sin audio + póster .jpg
# Uso:  ./scripts/optimize-videos.sh carpeta_con_originales
# Los nombres de archivo deben ser: hero, nails, eyes, wax, reel-1, reel-2, reel-3
set -euo pipefail
SRC="${1:?Uso: $0 carpeta_con_originales}"
OUT="public/videos"
mkdir -p "$OUT"
shopt -s nullglob
for f in "$SRC"/*.mp4 "$SRC"/*.mov "$SRC"/*.webm; do
  n="$(basename "${f%.*}")"
  ffmpeg -y -loglevel error -i "$f" -an -vf "scale='min(1280,iw)':-2" \
    -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -movflags +faststart "$OUT/$n.mp4"
  ffmpeg -y -loglevel error -i "$OUT/$n.mp4" -frames:v 1 -q:v 4 "$OUT/$n.jpg"
  echo "✔ $n  ($(du -h "$OUT/$n.mp4" | cut -f1))"
done
echo "Listo. Haz commit de public/videos y despliega."
