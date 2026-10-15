'use strict';

// Adds texts to the seven locale files, or sets one language's texts, line by line: the files keep their blank lines,
// their escapes and their order, so a change shows in a review as the lines it adds or changes.
//   node scripts/locale-keys.js add <file.json>         { key: englishText }: each key a file does not have yet goes
//                                                        right after its last "cards." line (all seven files)
//   node scripts/locale-keys.js set <lang> <file.json>  { key: text }: replaces those keys' texts in that language
// LOCALES_DIR overrides src/locales (the tests use a copy).

const fs = require('fs');
const path = require('path');

const DIR = process.env.LOCALES_DIR || path.join(__dirname, '..', 'src', 'locales');
const LANGS = ['en', 'pt', 'es', 'fr', 'de', 'zh', 'ja'];
const lineOf = (key, value) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`;

function readJsonArg(file) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${file}: expected { "key": "text" }`);
  for (const [key, text] of Object.entries(value)) {
    if (typeof text !== 'string' || !text.trim()) throw new Error(`${key}: the text is empty`);
  }
  return value;
}

function add(texts) {
  // Every file is changed in memory and checked first; only then are they written, so a refusal leaves all seven as
  // they were.
  const planned = LANGS.map((lang) => {
    const file = path.join(DIR, `${lang}.json`);
    const original = fs.readFileSync(file, 'utf8');
    const present = JSON.parse(original);
    const lines = original.split('\n');
    let at = -1;
    lines.forEach((line, i) => { if (line.startsWith('  "cards.')) at = i; });
    if (at < 0) throw new Error(`${lang}.json has no "cards." line to add after`);
    if (!lines[at].endsWith(',')) throw new Error(`${lang}.json: the last "cards." line must be followed by more keys`);
    const fresh = Object.entries(texts).filter(([key]) => !Object.hasOwn(present, key)).map(([key, text]) => `${lineOf(key, text)},`);
    lines.splice(at + 1, 0, ...fresh);
    const text = lines.join('\n');
    JSON.parse(text);
    return { file, text };
  });
  for (const { file, text } of planned) fs.writeFileSync(file, text);
}

function set(lang, texts) {
  if (!LANGS.includes(lang)) throw new Error(`unknown language ${lang}`);
  const file = path.join(DIR, `${lang}.json`);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (const [key, text] of Object.entries(texts)) {
    const prefix = `  ${JSON.stringify(key)}: `;
    const i = lines.findIndex((line) => line.startsWith(prefix));
    if (i < 0) throw new Error(`${lang}.json has no ${key}`);
    lines[i] = lineOf(key, text) + (lines[i].trimEnd().endsWith(',') ? ',' : '');
  }
  const out = lines.join('\n');
  JSON.parse(out);
  fs.writeFileSync(file, out);
}

const [command, a, b] = process.argv.slice(2);
if (command === 'add' && a) add(readJsonArg(a));
else if (command === 'set' && a && b) set(a, readJsonArg(b));
else {
  console.error('usage: node scripts/locale-keys.js add <file.json> | set <lang> <file.json>');
  process.exit(2);
}
