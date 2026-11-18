'use strict';
// Guard: src/locales/pt.json is European Portuguese (pt-PT), never Brazilian.
// Scans the VALUES only (never the keys) for Brazilian markers.
const test = require('node:test');
const assert = require('node:assert/strict');
const pt = require('../src/locales/pt.json');

const L = '(?<![\\p{L}])';
const E = '(?![\\p{L}])';
const word = (w) => new RegExp(L + '(?:' + w + ')' + E, 'iu');

const MARKERS = [
  ['você', word('você|vocês')],
  // "clicar" and its forms. The noun "clique" (a click, e.g. "com um clique", the
  // sound "Clique do rádio") is real pt-PT: only the Brazilian imperative
  // "clique em / para / aqui / no / na ..." is flagged.
  ['clicar', word('clicar|clicando|clicou|clicam|cliquem')],
  ['clique (imperativo)', new RegExp(L + 'clique\\s+(?:em|para|no|na|nos|nas|aqui|sobre|duas|duplo|com)' + E, 'iu')],
  ['prêmio', word('prêmios?')],
  ['arquivo', word('arquivos?')],
  ['usuário', word('usuários?')],
  ['tela', word('telas?')],
  ['registro', word('registros?')],
  ['contato', word('contatos?')],
  ['equipe', word('equipes?')],
  ['gerúndio após estar', new RegExp(L + '(?:está|estão|estamos|estou)\\s+\\p{L}+(?:ando|endo|indo|ondo)' + E, 'iu')],
];

test('pt.json values contain no Brazilian Portuguese markers', () => {
  const found = [];
  for (const [key, value] of Object.entries(pt)) {
    if (typeof value !== 'string') continue;
    for (const [name, re] of MARKERS) {
      if (re.test(value)) found.push(`${key} [${name}]: ${value.slice(0, 80)}`);
    }
  }
  assert.deepEqual(found, [], 'Brazilian wording in pt.json (use pt-PT):\n' + found.join('\n'));
});
