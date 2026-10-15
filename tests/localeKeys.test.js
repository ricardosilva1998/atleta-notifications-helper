'use strict';

// scripts/locale-keys.js on a copy of locale files in a temp folder: adding a key puts it after the last
// "cards." line of every file and leaves every other line as it was; setting a language's values changes only those
// lines; a change that would break a file's JSON is refused. Nothing touches src/locales.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'locale-keys.js');
const LANGS = ['en', 'pt', 'es', 'fr', 'de', 'zh', 'ja'];
let dir;

const sample = (lang) => `{
  "nav.home": "Home ${lang}",

  "cards.common.add": "Add ${lang}",
  "cards.common.edit": "Edit \\u00b7 ${lang}",
  "lang.en": "English"
}
`;
const run = (...args) => execFileSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, LOCALES_DIR: dir }, encoding: 'utf8', stdio: 'pipe' });
const read = (lang) => fs.readFileSync(path.join(dir, `${lang}.json`), 'utf8');
const json = (name, value) => { const file = path.join(dir, name); fs.writeFileSync(file, JSON.stringify(value)); return file; };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-keys-'));
  for (const lang of LANGS) fs.writeFileSync(path.join(dir, `${lang}.json`), sample(lang));
});

describe('add', () => {
  test('puts each new key after the last cards. line of every file, keeps the rest byte for byte', () => {
    run('add', json('new.json', { 'cards.polls.title': 'Polls & predictions', 'cards.common.add': 'ignored: already there' }));
    for (const lang of LANGS) {
      const lines = read(lang).split('\n');
      assert.equal(lines[4], '  "cards.common.edit": "Edit \\u00b7 ' + lang + '",', 'the escape and the line before stay as they were');
      assert.equal(lines[5], '  "cards.polls.title": "Polls & predictions",');
      assert.equal(lines[6], '  "lang.en": "English"');
      assert.equal(lines[2], '', 'the blank line stays');
      assert.equal(JSON.parse(read(lang))['cards.common.add'], `Add ${lang}`, 'an existing key keeps its text');
    }
  });

  test('refuses a file without a cards. line, and leaves every file untouched', () => {
    fs.writeFileSync(path.join(dir, 'de.json'), '{\n  "nav.home": "Start"\n}\n');
    assert.throws(() => run('add', json('new.json', { 'cards.polls.title': 'x' })));
    assert.equal(read('de'), '{\n  "nav.home": "Start"\n}\n');
    assert.equal(read('en'), sample('en'), 'nothing is written when one file cannot take the keys');
  });
});

describe('set', () => {
  test('replaces the values of existing keys in one language only', () => {
    run('set', 'pt', json('pt-new.json', { 'cards.common.add': 'Adicionar "já"' }));
    assert.equal(JSON.parse(read('pt'))['cards.common.add'], 'Adicionar "já"');
    assert.equal(JSON.parse(read('es'))['cards.common.add'], 'Add es');
    assert.equal(read('pt').split('\n')[4], '  "cards.common.edit": "Edit \\u00b7 pt",');
  });

  test('refuses a key the language does not have', () => {
    assert.throws(() => run('set', 'pt', json('pt-bad.json', { 'cards.nope': 'x' })));
  });
});
