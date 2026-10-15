#!/bin/bash
# Build solo.html with only the named families (fam/<key>.js + .css), for checking looks
# while other family files are still being written. It also loads film.js (the filmstrip tool).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"; cd "$DIR/parts"
JS=""; CSS=""
for k in "$@"; do JS="$JS fam/$k.js"; CSS="$CSS fam/$k.css"; done
cat 90-core.js $JS 99-ui.js > "$DIR/.solo.js"
node --check "$DIR/.solo.js"
{ printf '%s' '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>'
  cat 10-head.html; echo '<style>'; cat 20-page.css 30-samurai.css 40-styles.css $CSS; echo '</style>'; cat 70-body.html
  echo '<script>'; cat 80-samurai.js; echo '</script><script>'; cat "$DIR/.solo.js"; echo '</script><script src="film.js?v='"$(date +%s)"'"></script><script src="compare.js?v='"$(date +%s)"'"></script>'; printf '%s' '</body></html>'; } > "$DIR/solo.html"
rm -f "$DIR/.solo.js"
echo "solo.html: $*"
