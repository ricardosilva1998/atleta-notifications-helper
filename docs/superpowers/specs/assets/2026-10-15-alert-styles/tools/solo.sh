#!/bin/bash
# Build solo.html (next to build.sh) with only the named families (parts/fam/<key>.js + .css) and the
# checking tools: film.js (filmstrips, side-by-side gallery, size audit) and compare.js (layout with
# and without the overlay's border-box reset). Serve the folder (python3 -m http.server) and open solo.html.
set -e
TOOLS="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$TOOLS/.." && pwd)"; cd "$ROOT/parts"
JS=""; CSS=""
for k in "$@"; do JS="$JS fam/$k.js"; CSS="$CSS fam/$k.css"; done
cat 90-core.js $JS 99-ui.js > "$ROOT/.solo.js"
node --check "$ROOT/.solo.js"
V=$(date +%s)
{ printf '%s' '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>'
  cat 10-head.html; echo '<style>'; cat 20-page.css 30-samurai.css 40-styles.css $CSS; echo '</style>'; cat 70-body.html
  echo '<script>'; cat 80-samurai.js; echo '</script><script>'; cat "$ROOT/.solo.js"; echo '</script>'
  echo "<script src=\"tools/film.js?v=$V\"></script><script src=\"tools/compare.js?v=$V\"></script>"; printf '%s' '</body></html>'; } > "$ROOT/solo.html"
rm -f "$ROOT/.solo.js"
echo "solo.html: $*"
