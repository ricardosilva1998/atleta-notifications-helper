#!/bin/bash
# Assemble the proposal page from parts/ (each family lives in parts/fam/<key>.js + <key>.css).
# With an argument (a family key such as qs), only check that family with the core and the UI.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/parts"
TMPD="$(mktemp -d)"
JS="$TMPD/page.js"
trap 'rm -rf "$TMPD"' EXIT
if [ -n "$1" ]; then FAM_JS="fam/$1.js"; else FAM_JS=$(ls fam/*.js 2>/dev/null || true); fi
cat 90-core.js $FAM_JS 99-ui.js > "$JS"
node --check "$JS"
if [ -n "$1" ]; then
  { echo '<style>'; cat 30-samurai.css 40-styles.css "fam/$1.css"; echo '</style><script>'; cat "$JS"; echo '</script>'; } > "$TMPD/check.html"
  node "$DIR/check-keyframes.js" "$TMPD/check.html"
  echo "family $1: script ok"
  exit 0
fi
{ cat 10-head.html; echo '<style>'; cat 20-page.css 30-samurai.css 40-styles.css $(ls fam/*.css 2>/dev/null || true); echo '</style>'; cat 70-body.html; echo '<script>'; cat 80-samurai.js; echo '</script>'; echo '<script>'; cat "$JS"; echo '</script>'; } > "$DIR/atleta-alert-styles.html"
{ printf '%s' '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>'; cat "$DIR/atleta-alert-styles.html"; printf '%s' '</body></html>'; } > "$DIR/preview-local.html"
node "$DIR/check-keyframes.js" "$DIR/atleta-alert-styles.html"
echo "built $(wc -c < "$DIR/atleta-alert-styles.html") bytes"
