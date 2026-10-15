#!/usr/bin/env node
'use strict';
// Ports one family of the alert styles proposal into the overlay's family files:
//   public/overlay/objects/styles/<key>.js and .css, plus <out>/<key>.texts.json (the English texts) and
//   <out>/<key>.meta.json (fonts, class and keyframe prefixes, the looks that grow with a number).
// Usage: node port-family.js <proposal parts dir> <short> <key> <repo dir> <out dir>
//   short: the proposal's family prefix (spk, gp, ...); key: the product family key (spooky, grandprix, ...).
// The look code itself is copied as the proposal has it; only the wrapper, the look headers, the durations'
// leading zero and the texts change. "Grows with the amount" is a per-look change made after this script.

const fs = require('fs');
const path = require('path');
const loadProposal = require('./load-proposal.js');

const [partsDir, short, key, repo, outDir] = process.argv.slice(2);
if (!outDir) { console.error('usage: port-family.js <parts> <short> <key> <repo> <out>'); process.exit(2); }
const prop = loadProposal(partsDir);
const fam = prop.FAMS[short];
if (!fam) throw new Error('no family ' + short);
const looks = prop.P.filter((p) => p.fam === short);
if (looks.length !== 6) throw new Error(short + ': ' + looks.length + ' looks, not 6');

const CORE = fs.readFileSync(path.join(partsDir, '90-core.js'), 'utf8');
const SHARED_CSS = fs.readFileSync(path.join(partsDir, '40-styles.css'), 'utf8');
const HEAD = fs.readFileSync(path.join(partsDir, '10-head.html'), 'utf8');
const IN_CORE = { gp: ['Grand Prix', 'GRAND PRIX'], ck: ['Cockpit', 'COCKPIT'], ar: ['Arcade', 'ARCADE'] };

// The index of the bracket that closes the one opened just before `start`, aware of strings, template
// literals and comments well enough for this code.
function matchClose(src, start, open, close) {
  let depth = 1, i = start;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) return -1; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      i++;
      while (i < src.length && src[i] !== c) { if (src[i] === '\\') i++; i++; }
      i++; continue;
    }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
    i++;
  }
  return -1;
}
// Removes `NAME = {...};` (an object literal statement) from the source.
function dropObjectStatement(src, head) {
  const at = src.indexOf(head);
  if (at < 0) return src;
  const end = matchClose(src, at + head.length, '{', '}');
  let stop = end + 1;
  if (src[stop] === ';') stop++;
  if (src[stop] === '\n') stop++;
  let from = at; while (from > 0 && src[from - 1] === ' ') from--;
  return src.slice(0, from) + src.slice(stop);
}
// A top-level `var NAME = ...;` statement of the core, with brackets matched.
function coreVar(name) {
  const m = new RegExp('^var ' + name + ' = ', 'm').exec(CORE);
  if (!m) throw new Error('core has no var ' + name);
  let i = m.index + m[0].length, depth = 0;
  for (; i < CORE.length; i++) {
    const c = CORE[i];
    if (c === '\'' || c === '"' || c === '`') { i++; while (CORE[i] !== c) { if (CORE[i] === '\\') i++; i++; } continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ';' && depth === 0) break;
  }
  return CORE.slice(m.index, i + 1);
}

// ── The look code ─────────────────────────────────────────────────────────────────────────────────────
let doc = '', body;
if (IN_CORE[short]) {
  const lines = CORE.split('\n');
  const from = lines.findIndex((l) => l.startsWith('/* ── ' + IN_CORE[short][0] + ' ── */'));
  if (from < 0) throw new Error('no core section for ' + short);
  // The section ends at the next marker, or where the page's own code starts (after Arcade).
  let to = from + 1; while (to < lines.length && !lines[to].startsWith('/* ── ') && !lines[to].startsWith('// Every family the page shows')) to++;
  const section = lines.slice(from + 1, to).join('\n');
  // The core's constants this family uses, and the sounds of its looks (from the core's table).
  const consts = ['GP_EXIT', 'CK_IN', 'CK_EXIT', 'AR_IN', 'AR_EXIT', 'TYRE', 'TROPHY', 'GAUGE'].filter((n) => new RegExp('\\b' + n + '\\b').test(section));
  const sounds = [...new Set(looks.map((p) => p.sound))].map((k) => 'SOUNDS.' + k + ' = ' + String(prop.SOUNDS[k]) + ';');
  body = consts.map(coreVar).join('\n') + '\n\n' + sounds.join('\n') + '\n\n' + section.trim();
  body = body.split('\n').map((l) => (l ? '  ' + l : l)).join('\n');
} else {
  const src = fs.readFileSync(path.join(partsDir, 'fam', short + '.js'), 'utf8');
  // The file's leading comment is its description; the rest is its code, either wrapped in its own
  // function (opened right after the comment and closed at the very end) or run at the page's top level.
  const lead = /^\s*(\/\*[\s\S]*?\*\/)\s*/.exec(src);
  doc = lead ? lead[1] : '';
  const rest = src.slice(lead ? lead[0].length : 0).replace(/\s+$/, '');
  if (rest.startsWith('(function () {\n') && rest.endsWith('})();')) {
    body = rest.slice('(function () {\n'.length, -'})();'.length).replace(/\s+$/, '');
  } else {
    body = rest.split('\n').map((l) => (l ? '  ' + l : l)).join('\n');
  }
}
body = dropObjectStatement(body, 'FAMS.' + short + ' = {');
body = body.replace(/^[ \t]*SOUND_NAMES\.\w+ = '(?:[^'\\]|\\.)*';[ \t]*\n/gm, '');
if (/SOUND_NAMES|FAMS\./.test(body)) throw new Error(short + ': SOUND_NAMES or FAMS left in the code');

// The look headers: the proposal's id/alert/fam/isNew/title/amount line becomes the registry's fields; the
// English title and description move to the locale files.
const usesLabel = {};
looks.forEach((p) => { usesLabel[p.id] = /\blabel\(/.test(String(p.render)); });
let headers = 0;
body = body.replace(/^([ \t]*)id: '([a-z]+-[a-z0-9]+)', alert: '([a-z_]+)', fam: '[a-z]+'(?:, isNew: true)?(?:, title: '(?:[^'\\]|\\.)*')?(?:, amount: '(?:[^'\\]|\\.)*')?,[ \t]*$/gm,
  (m, indent, id, alert) => {
    headers++;
    const eventType = alert === 'giveaway' ? 'giveaway_winner' : alert;
    return indent + 'key: \'' + id + '\', eventType: \'' + eventType + '\', family: FAMILY, controls: ' + (usesLabel[id] ? 'CONTROLS' : 'CONTROLS_NO_TEXT') + ', grows: false,';
  });
if (headers !== 6) throw new Error(short + ': ' + headers + ' look headers rewritten, not 6');
const descs = (body.match(/^[ \t]*desc: '(?:[^'\\]|\\.)*',[ \t]*\n/gm) || []).length;
if (descs !== 6) throw new Error(short + ': ' + descs + ' descriptions, not 6');
body = body.replace(/^[ \t]*desc: '(?:[^'\\]|\\.)*',[ \t]*\n/gm, '');
body = body.replace(/^([ \t]*)add\(\{/gm, '$1K.register({');
const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
if (/(?<![\w$.])add\(/.test(code)) throw new Error(short + ': an add( call is left');
// Durations as "0.36s" (exitMs() in overlay.js reads seconds; the C1's shape test wants the leading zero).
body = body.replace(/'\.(\d+)s'/g, '\'0.$1s\'');   // a duration literal such as '.36s' (dur:, hold(), a family's own exit())

// ── The wrapper ───────────────────────────────────────────────────────────────────────────────────────
const KIT_NAMES = ['esc', 'money', 'fitStyle', 'nm', 'fmt', 'label', 'odo', 'typed', 'hash', 'rng', 'code3', 'intOf', 'rgbOf', 'onColour', 'isWide', 'tone', 'noise', 'engine'];
const own = new Set([...body.matchAll(/\bfunction ([A-Za-z_$][\w$]*)\(/g), ...body.matchAll(/\bvar ([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]));
const aliases = KIT_NAMES.filter((n) => !own.has(n) && new RegExp('(?<![\\w$.])' + n + '\\(').test(body));
const needsHold = /(?<![\w$.])hold\(/.test(body) && !own.has('hold');

function fontsOf(css) {
  const linkSpecs = {};
  for (const m of HEAD.matchAll(/family=([^&"]+)/g)) linkSpecs[m[1].split(':')[0].replace(/\+/g, ' ')] = m[1];
  // Every Google font the stylesheet names, in a font-family or in a custom property holding a font list.
  return Object.keys(linkSpecs).filter((name) => new RegExp('(^|[\\s,:"\'])' + name.replace(/ /g, '\\s') + '(["\',;}]|$)', 'm').test(css)).map((n) => linkSpecs[n]);
}

// ── The stylesheet ────────────────────────────────────────────────────────────────────────────────────
let css;
if (IN_CORE[short]) {
  const lines = SHARED_CSS.split('\n');
  const from = lines.findIndex((l) => l.startsWith('/* ═════════ ' + IN_CORE[short][1]));
  if (from < 0) throw new Error('no stylesheet section for ' + short);
  let to = from + 1; while (to < lines.length && !lines[to].startsWith('/* ═════════ ') && !lines[to].startsWith('/* ══ ')) to++;
  css = lines.slice(from, to).join('\n').trim() + '\n';
  if (short === 'gp') css = css.replace(/\n/, '\n/* Drawn and approved with content-box sizing; the overlay page sets border-box on every element. */\n.o-gp,.o-gp *{box-sizing:content-box}\n');
} else {
  css = fs.readFileSync(path.join(partsDir, 'fam', short + '.css'), 'utf8');
}
const fonts = fontsOf(css);

const header = [
  '\'use strict\';',
  '',
  '/**',
  ' * ' + fam.name + ' (docs/superpowers/specs/2026-10-15-alert-styles-design.md, Appendix A), ported from the proposal',
  ' * (docs/superpowers/specs/assets/2026-10-15-alert-styles/parts/' + (IN_CORE[short] ? '90-core.js and 40-styles.css' : 'fam/' + short + '.js and .css') + ').',
  ' * Its names and descriptions are in the locale files (overlayBuilder.families.' + key + ', overlayBuilder.looks.<id>,',
  ' * overlayBuilder.sounds.<key>). Its classes start with .o-' + short + ' and its keyframes with ' + short + '.',
  ' */',
  doc,
  '(function (root) {',
  '  var K = (root && root.ATLETA_KIT) || require(\'../kit.js\');',
  '  var FAMILY = \'' + key + '\';',
  aliases.length ? '  var ' + aliases.map((n) => n + ' = K.' + n).join(', ') + ';' : '',
  '  var SOUNDS = {};',
  needsHold ? '  function hold(dur) { return { in: \'hold\', dur: dur, ease: \'linear\' }; }' : '',
  '  // Every look takes the streamer\'s colour and its speed, and its main text when it shows one.',
  '  var CONTROLS = { colour: \'accent\', label: true, speed: true };',
  '  var CONTROLS_NO_TEXT = { colour: \'accent\', label: false, speed: true };',
  '  K.registerFamily({ key: FAMILY, order: ' + fam.order + ', fonts: ' + JSON.stringify(fonts) + ' });',
].filter((l) => l !== '').join('\n').replace('\n/**', '\n\n/**');
const footer = '\n\n  Object.keys(SOUNDS).forEach(function (k) { K.registerSound(k, FAMILY, SOUNDS[k]); });\n})(typeof window !== \'undefined\' ? window : null);\n';
const js = header + '\n\n' + body + footer;

// ── Texts, prefixes, growth ───────────────────────────────────────────────────────────────────────────
const texts = {
  ['overlayBuilder.families.' + key + '.name']: fam.name,
  ['overlayBuilder.families.' + key + '.desc']: fam.desc,
};
looks.forEach((p) => { texts['overlayBuilder.looks.' + p.id + '.title'] = p.title; texts['overlayBuilder.looks.' + p.id + '.desc'] = p.desc; });
[...new Set(looks.map((p) => p.sound))].forEach((k) => { texts['overlayBuilder.sounds.' + k] = prop.SOUND_NAMES[k]; });
const classes = [...new Set([...css.matchAll(/\.(o-[a-z0-9]+)/g)].map((m) => m[1]))];
const keyframes = [...new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]))];
const meta = {
  short, key, order: fam.order, fonts, controls: looks.map((p) => [p.id, usesLabel[p.id] ? 'text' : 'no text']),
  grows: looks.filter((p) => p.amount).map((p) => [p.id, p.amount]),
  classRoots: classes, keyframes,
};

const stylesDir = path.join(repo, 'public', 'overlay', 'objects', 'styles');
fs.writeFileSync(path.join(stylesDir, key + '.js'), js);
fs.writeFileSync(path.join(stylesDir, key + '.css'), css);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, key + '.texts.json'), JSON.stringify(texts, null, 1) + '\n');
fs.writeFileSync(path.join(outDir, key + '.meta.json'), JSON.stringify(meta, null, 1) + '\n');
console.log(key + ': ' + js.split('\n').length + ' + ' + css.split('\n').length + ' lines, ' + Object.keys(texts).length + ' texts, ' + fonts.length + ' fonts, aliases ' + aliases.join(','));
