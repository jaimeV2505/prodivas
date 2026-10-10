#!/usr/bin/env bash
# Sube a Vercel (entorno Production) todas las variables de un archivo .env.production.
# Uso:  cp .env.example .env.production   (rellena los valores)   →   ./scripts/vercel-env.sh
# Requiere haber hecho antes:  npx vercel login  y  npx vercel link
set -euo pipefail
FILE="${1:-.env.production}"
[ -f "$FILE" ] || { echo "No existe $FILE"; exit 1; }

count=0
while IFS= read -r line || [ -n "$line" ]; do
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" =~ ^[[:space:]]*$ ]] && continue
  key="${line%%=*}"
  value="${line#*=}"
  value="${value%%  #*}"            # quita comentarios al final ("  # ...")
  value="${value%\"}"; value="${value#\"}"
  [ -z "$value" ] && continue       # las vacías no se suben
  printf '%s' "$value" | npx vercel env add "$key" production --force >/dev/null
  echo "✔ $key"
  count=$((count + 1))
done < "$FILE"
echo "Subidas $count variables. Haz un redeploy para que se apliquen."
