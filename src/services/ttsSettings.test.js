'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const i18n = require('../i18n');
const { checkTtsSettings, TTS_ERRORS, TTS_STATUS_TEXTS } = require('./ttsSettings');
const { TTS_LANGUAGES, VOICES, defaultVoice, isVoice } = require('./ttsVoices');
const { defaultTemplates } = require('./tipSpeech');

test('numbers are clamped into their ranges', () => {
  const r = checkTtsSettings({ tts_min_amount: 0.1, tts_speed: 3, tts_expressiveness: -1, tts_volume: 2, tts_language: 'en' }, { tipMinimum: 1 });
  assert.equal(r.settings.tts_min_amount, 1); assert.equal(r.settings.tts_speed, 1.2);
  assert.equal(r.settings.tts_expressiveness, 0); assert.equal(r.settings.tts_volume, 1);
});

test('the minimum amount has a floor of 0.50, a ceiling of 10000 and two decimals', () => {
  const check = (body, tipMinimum) => checkTtsSettings({ tts_language: 'en', ...body }, { tipMinimum }).settings.tts_min_amount;
  assert.equal(check({ tts_min_amount: 0.1 }, 0.2), 0.5);
  assert.equal(check({ tts_min_amount: 99999 }, 1), 10000);
  assert.equal(check({ tts_min_amount: '2.456' }, 1), 2.46);
});

test('an unknown language is refused; an unknown voice falls back to the language default', () => {
  assert.deepEqual(checkTtsSettings({ tts_language: 'xx' }, { tipMinimum: 1 }), { ok: false, error: 'bad_language' });
  assert.equal(checkTtsSettings({ tts_language: 'pt', tts_voice: 'nope' }, { tipMinimum: 1 }).settings.tts_voice, defaultVoice('pt'));
});

test('a listed voice is kept', () => {
  const id = VOICES.en[1].id;
  assert.equal(checkTtsSettings({ tts_language: 'en', tts_voice: id }, { tipMinimum: 1 }).settings.tts_voice, id);
});

test('templates are cut to 200 characters and an empty one means the default', () => {
  const r = checkTtsSettings({ tts_language: 'en', tts_template: 'x'.repeat(250), tts_template_empty: '   ' }, { tipMinimum: 1 });
  assert.equal(r.settings.tts_template.length, 200); assert.equal(r.settings.tts_template_empty, null);
});

test('a template is cut by characters, not by UTF-16 units', () => {
  const r = checkTtsSettings({ tts_language: 'en', tts_template: '🔥'.repeat(250) }, { tipMinimum: 1 });
  assert.equal([...r.settings.tts_template].length, 200);
});

test('"0" is off', () => { assert.equal(checkTtsSettings({ tts_enabled: '0', tts_language: 'en' }, { tipMinimum: 1 }).settings.tts_enabled, 0); });

test('every language has its default templates, with the three placeholders where the English has them', () => {
  for (const lang of TTS_LANGUAGES) {
    const d = defaultTemplates(i18n.t, lang);
    for (const p of ['{name}', '{amount}', '{message}']) assert.ok(d.template.includes(p), `${lang} ${p}`);
    assert.ok(d.emptyTemplate.includes('{name}') && d.emptyTemplate.includes('{amount}') && !d.emptyTemplate.includes('{message}'), lang);
  }
});

test('the settings hold exactly the columns db.js saves', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
  const block = source.match(/const TTS_COLUMNS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(block, 'TTS_COLUMNS not found in db.js');
  const columns = [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  const r = checkTtsSettings({ tts_language: 'en' }, { tipMinimum: 1 });
  assert.deepEqual(Object.keys(r.settings).sort(), columns.sort());
});

test('every language lists voices, the default is one of them, and a foreign id is not', () => {
  for (const lang of TTS_LANGUAGES) {
    assert.ok(VOICES[lang].length >= 1, lang);
    assert.ok(isVoice(lang, defaultVoice(lang)), lang);
    assert.equal(isVoice(lang, 'nope'), false);
  }
  assert.equal(isVoice('xx', defaultVoice('en')), false);
});

test('the site floor has its own error code and its own history status, each with a text in all seven languages', () => {
  assert.equal(TTS_ERRORS.credit_floor, 'donations.tts.error.credit_floor');
  assert.equal(TTS_STATUS_TEXTS.credit_floor, 'donations.tts.status.credit_floor');
  for (const lang of ['en', 'pt', 'es', 'fr', 'de', 'zh', 'ja']) {
    for (const key of [TTS_ERRORS.credit_floor, TTS_STATUS_TEXTS.credit_floor]) {
      assert.notEqual(i18n.t(lang, key), key, `${lang} has ${key}`);
    }
  }
  assert.notEqual(i18n.t('en', TTS_STATUS_TEXTS.credit_floor), i18n.t('en', TTS_STATUS_TEXTS.limit));
});
