'use strict';

// The family files of the alert looks (public/overlay/objects/styles/) joined into one stylesheet and
// one script (docs/superpowers/specs/2026-10-15-alert-styles-design.md, 4.3). routes/overlay.js serves
// them at /overlay/objects/styles.css and /overlay/objects/styles.js, for the OBS overlay and the
// Overlay Builder. The repository keeps one readable file per family and there is no build step: the
// files are read when first asked for and kept for the life of the process. `version` changes when
// any of them does, so the pages ask for ?v=<version> and an open browser source never mixes releases.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STYLES_DIR = path.join(__dirname, '..', '..', 'public', 'overlay', 'objects', 'styles');

function familyFiles(extension) {
  return fs.readdirSync(STYLES_DIR).filter((f) => f.endsWith(extension)).sort()
    .map((name) => ({ name, text: fs.readFileSync(path.join(STYLES_DIR, name), 'utf8') }));
}

// The recorded sounds' table (sounds/manifest.js, written by scripts/look-sounds.js). It registers the
// recordings of sounds the families register, so it runs after them; it is part of the version, so a
// new recording reaches an open page with its next ?v=.
const SOUNDS_MANIFEST = path.join(STYLES_DIR, '..', 'sounds', 'manifest.js');
function soundsManifest() {
  return fs.existsSync(SOUNDS_MANIFEST) ? [{ path: 'sounds/manifest.js', text: fs.readFileSync(SOUNDS_MANIFEST, 'utf8') }] : [];
}

// Joins the given files ([{ name, text }], then `after`'s [{ path, text }]). Each family's script runs
// in a function of its own, so its 'use strict' still applies, inside a try: a family that throws while
// it registers is left out (its looks fall back to the alert's default look) and the families after it
// still register.
function join(cssFiles, jsFiles, after = []) {
  const wrap = (label, name, text) => `// ── ${label} ──\ntry { (function () {\n${text}\n})(); } catch (e) { console.error('[Alert styles] ${name} did not load: ' + (e && e.message)); }`;
  const css = cssFiles.map((f) => `/* ── styles/${f.name} ── */\n${f.text}`).join('\n');
  const js = jsFiles.map((f) => wrap(`styles/${f.name}`, f.name, f.text)).concat(after.map((f) => wrap(f.path, f.path, f.text))).join('\n');
  const version = crypto.createHash('sha256').update(css).update('\0').update(js).digest('hex').slice(0, 12);
  return { css, js, version };
}

let joined = null;
// { css, js, version } of the family files and the sounds' table, read once.
function bundle() {
  if (!joined) joined = join(familyFiles('.css'), familyFiles('.js'), soundsManifest());
  return joined;
}

module.exports = { bundle, join };
