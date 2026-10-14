'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { t, SUPPORTED_LANGS, fromAcceptLanguage, esc, richFor } = require('./i18n');

describe('fromAcceptLanguage', () => {
  test('takes the first language the site speaks, ignoring the region', () => {
    assert.equal(fromAcceptLanguage('pt-BR,pt;q=0.9,en;q=0.8'), 'pt');
    assert.equal(fromAcceptLanguage('de-AT'), 'de');
    assert.equal(fromAcceptLanguage('ja'), 'ja');
    assert.equal(fromAcceptLanguage('zh-TW,zh;q=0.9'), 'zh');
    assert.equal(fromAcceptLanguage('FR-ca'), 'fr');
  });

  test('goes by the weights, not by the order, and keeps the order for equal weights', () => {
    assert.equal(fromAcceptLanguage('en;q=0.5,es;q=0.9'), 'es');
    assert.equal(fromAcceptLanguage('xx,fr;q=0.7,de;q=0.7'), 'fr');
    assert.equal(fromAcceptLanguage('de;q=0.7, fr;q=0.9, es'), 'es');
  });

  test('skips the languages the site does not have and the ones the browser refuses', () => {
    assert.equal(fromAcceptLanguage('ru,it;q=0.9,es;q=0.5'), 'es');
    assert.equal(fromAcceptLanguage('pt;q=0,en'), 'en');
    assert.equal(fromAcceptLanguage('*'), null);
    assert.equal(fromAcceptLanguage('ru,it,ko'), null);
  });

  test('anything that is not a usable header answers null', () => {
    for (const header of [undefined, null, '', ' ', ',', ';q=1', 'q=1', 42, {}, ['pt']]) {
      assert.equal(fromAcceptLanguage(header), null, JSON.stringify(header));
    }
    assert.equal(fromAcceptLanguage('pt;q=abc,en'), 'en', 'an unreadable weight counts as a refusal');
  });

  test('a very long header is read only as far as the first twenty languages', () => {
    const noise = Array.from({ length: 25 }, (_, i) => `xx${i}`).join(',');
    assert.equal(fromAcceptLanguage(`${noise},pt`), null, 'the twenty-sixth entry is not looked at');
    assert.equal(fromAcceptLanguage(`${noise.split(',').slice(0, 5).join(',')},pt`), 'pt');
  });

  test('only ever answers a language that has a locale file', () => {
    for (const header of ['en', 'pt', 'es', 'fr', 'de', 'zh', 'ja', 'pt-PT,es']) {
      assert.ok(SUPPORTED_LANGS.includes(fromAcceptLanguage(header)), header);
    }
  });
});

describe('t()', () => {
  test('falls back to English for a language the site does not have, and to the key for an unknown key', () => {
    assert.equal(t('xx', 'tip.error.expired'), t('en', 'tip.error.expired'));
    assert.equal(t('en', 'no.such.key'), 'no.such.key');
    assert.equal(t('xx', 'no.such.key'), 'no.such.key');
  });

  test('fills {{placeholders}}, with an empty string for one that is not given', () => {
    assert.equal(t('en', 'subscription.notificationDelay', { minutes: 5 }), '5 min notification delay');
    assert.equal(t('en', 'subscription.notificationDelay', { minutes: 0 }), '0 min notification delay');
    assert.equal(t('en', 'subscription.notificationDelay'), ' min notification delay');
  });
});

describe('esc()', () => {
  test('turns the five characters that can open markup or end an attribute into entities', () => {
    assert.equal(esc(`<a href="x" title='y'>R&D</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;R&amp;D&lt;/a&gt;');
  });

  test('prints nothing for a missing value and the text of a number', () => {
    assert.equal(esc(null), '');
    assert.equal(esc(undefined), '');
    assert.equal(esc(0), '0');
    assert.equal(esc(12), '12');
  });

  test('leaves {{fields}}, dollar signs and ordinary text as they are', () => {
    assert.equal(esc('{{b}} $& $1 caf\u00e9'), '{{b}} $&amp; $1 caf\u00e9');
  });
});

describe('rich()', () => {
  // A translate() that reads its texts from a table and fills {{fields}} the way t() does.
  const TEXTS = {
    greet: 'Hello {{name}}, welcome.',
    link: 'Open {{a}}the settings{{aEnd}} first.',
    twice: '{{first}} and {{second}}',
    plain: 'Nothing to fill in.',
    own: 'Hi <img src=x onerror=alert(1)> {{name}} "quoted" \'single\' & more',
    proto: 'A {{constructor}} and a {{toString}}',
  };
  const translate = (key, params = {}) => TEXTS[key].replace(/\{\{(\w+)\}\}/g, (_, k) => (Object.hasOwn(params, k) ? params[k] : ''));
  const rich = richFor(translate);

  test('puts the page\'s markup in the fields it names and nothing else', () => {
    assert.equal(rich('greet', { name: '<strong>Ann</strong>' }), 'Hello <strong>Ann</strong>, welcome.');
    assert.equal(rich('link', { a: '<a href="/settings">', aEnd: '</a>' }), 'Open <a href="/settings">the settings</a> first.');
    assert.equal(rich('plain'), 'Nothing to fill in.');
  });

  test('escapes the translation first, so markup in a language file stays text', () => {
    assert.equal(
      rich('own', { name: '<b>x</b>' }),
      'Hi &lt;img src=x onerror=alert(1)&gt; <b>x</b> &quot;quoted&quot; &#39;single&#39; &amp; more',
    );
  });

  test('a field the page does not name is dropped, and one it names but the text lacks is ignored', () => {
    assert.equal(rich('twice', { first: '<i>1</i>' }), '<i>1</i> and ');
    assert.equal(rich('plain', { name: '<i>unused</i>' }), 'Nothing to fill in.');
  });

  test('reads the text once: a {{field}} inside the page\'s own markup is not filled in again', () => {
    assert.equal(rich('twice', { first: '<b>{{second}}</b>', second: 'two' }), '<b>{{second}}</b> and two');
  });

  test('puts the markup in as it is, without dollar patterns being read as replacements', () => {
    assert.equal(rich('greet', { name: '$& $1 $$ $` $\'' }), 'Hello $& $1 $$ $` $\', welcome.');
  });

  test('looks a field up among the names the page gave, never among the ones every object has', () => {
    const raw = richFor((key) => TEXTS[key]); // a translate that leaves the {{fields}} in the text
    assert.equal(raw('proto', {}), 'A {{constructor}} and a {{toString}}');
    assert.equal(raw('proto', { constructor: '<b>c</b>' }), 'A <b>c</b> and a {{toString}}');
  });

  test('is built on the translate it is given, so each request prints its own language', () => {
    const french = richFor((key, params) => `Bonjour ${params.name}`);
    assert.equal(french('greet', { name: '<strong>Ann</strong>' }), 'Bonjour <strong>Ann</strong>');
    assert.equal(rich('greet', { name: '<strong>Ann</strong>' }), 'Hello <strong>Ann</strong>, welcome.');
  });
});
