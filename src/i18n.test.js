'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { t, SUPPORTED_LANGS, fromAcceptLanguage } = require('./i18n');

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
