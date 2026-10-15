#!/usr/bin/env node
'use strict';
// Adds one family's texts to the seven locale files: English from the converter's <out>/<key>.texts.json, the
// six translations from <i18n dir>/<lang>.json. In each file the family's three blocks (its name, its six looks,
// its sounds) follow the family before it in the gallery, or Racing's for the first one.
// Usage: node family-texts.js <repo> <key> <converter out dir> <i18n dir>
const fs = require('fs');
const path = require('path');
const [repo, key, outDir, i18nDir] = process.argv.slice(2);
if (!i18nDir) { console.error('usage: family-texts.js <repo> <key> <out dir> <i18n dir>'); process.exit(2); }
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const metas = fs.readdirSync(outDir).filter((f) => f.endsWith('.meta.json')).map((f) => read(path.join(outDir, f))).sort((a, b) => a.order - b.order);
const me = metas.find((m) => m.key === key);
if (!me) throw new Error('run port-family.js for ' + key + ' first');
const textsOf = (k) => read(path.join(outDir, k + '.texts.json'));
const soundsOf = (k) => Object.keys(textsOf(k)).filter((t) => t.startsWith('overlayBuilder.sounds.'));
const ALERTS = ['follow', 'subscriber', 'bits', 'donation', 'raid', 'giveaway'];
const blocks = {
  fam: ['name', 'desc'].map((p) => 'overlayBuilder.families.' + key + '.' + p),
  look: ALERTS.flatMap((a) => ['title', 'desc'].map((p) => 'overlayBuilder.looks.' + a + '-' + key + '.' + p)),
  sound: soundsOf(key),
};
for (const lang of ['en', 'pt', 'es', 'fr', 'de', 'zh', 'ja']) {
  const texts = lang === 'en' ? textsOf(key) : read(path.join(i18nDir, lang + '.json'));
  const file = path.join(repo, 'src', 'locales', lang + '.json');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const at = (k) => lines.findIndex((l) => l.startsWith('  ' + JSON.stringify(k) + ': '));
  if (at(blocks.fam[0]) >= 0) throw new Error(lang + ': ' + key + ' is already there');
  const prev = metas.filter((m) => m.order < me.order && at('overlayBuilder.families.' + m.key + '.name') >= 0).pop();
  const anchors = prev
    ? { fam: 'overlayBuilder.families.' + prev.key + '.desc', look: 'overlayBuilder.looks.giveaway-' + prev.key + '.desc', sound: soundsOf(prev.key).pop() }
    : { fam: 'overlayBuilder.families.racing.desc', look: 'overlayBuilder.looks.donation-c1-channel.desc', sound: 'overlayBuilder.sounds.rcVictory' };
  for (const block of ['sound', 'look', 'fam']) {   // bottom-up: the file has families, then looks, then sounds
    const i = at(anchors[block]);
    if (i < 0) throw new Error(lang + ': no ' + anchors[block]);
    const missing = blocks[block].filter((k) => typeof texts[k] !== 'string' || !texts[k]);
    if (missing.length) throw new Error(lang + ': no text for ' + missing.join(', '));
    lines.splice(i + 1, 0, ...blocks[block].map((k) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(texts[k]) + ','));
  }
  fs.writeFileSync(file, lines.join('\n'));
  read(file);   // still valid JSON
}
console.log(key + ': ' + (blocks.fam.length + blocks.look.length + blocks.sound.length) + ' texts in seven languages');
