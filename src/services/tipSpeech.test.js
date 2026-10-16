'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MESSAGE_MAX, TEMPLATE_MAX, RUN_MAX,
  cleanSpeech, spokenAmount, buildLine, speechDecision, defaultTemplates, prepareSpeech,
} = require('./tipSpeech');

const { t } = require('../i18n');

test('the limits', () => {
  assert.equal(MESSAGE_MAX, 200);
  assert.equal(TEMPLATE_MAX, 200);
  assert.equal(RUN_MAX, 3);
});

test('links are never spoken', () => {
  assert.equal(cleanSpeech('go to evil.com now'), 'go to now');
  assert.equal(cleanSpeech('https://x.y/z hi'), 'hi');
});

test('a run of one character cannot build a link', () => {
  assert.equal(cleanSpeech('wwwwwww.x hi'), 'hi');
});

test('invisible characters cannot hide a link', () => {
  assert.equal(cleanSpeech('evil​.com hi'), 'hi');
  assert.equal(cleanSpeech('evil­.com hi'), 'hi');
  assert.equal(cleanSpeech('ev‍il.c⁠om﻿ hi'), 'hi');
  assert.equal(cleanSpeech('he​llo'), 'hello');
  assert.equal(cleanSpeech('evil\u3164.com hi'), 'hi', 'Hangul filler');
  assert.equal(cleanSpeech('evil\u2800.com hi'), 'hi', 'braille blank');
  assert.equal(cleanSpeech('evil\uFE0F.com hi'), 'hi', 'variation selector');
  assert.equal(cleanSpeech('evil\u{E0100}.com hi'), 'hi', 'variation selector supplement');
  assert.equal(cleanSpeech('evil\u{E0041}.com hi'), 'hi', 'tag character');
  assert.equal(cleanSpeech('evil\u115F.\u1160com hi'), 'hi', 'Hangul choseong and jungseong fillers');
});

test('runs of one character are cut to three, emoji too', () => {
  assert.equal(cleanSpeech('woooooow'), 'wooow');
  assert.equal(cleanSpeech('🔥🔥🔥🔥🔥🔥'), '🔥🔥🔥');
});

test('markup is plain text and control characters go', () => {
  assert.equal(cleanSpeech('<b>x</b>\u0007'), '<b>x</b>');
});

test('line breaks and runs of spaces become one space; the ends are trimmed', () => {
  assert.equal(cleanSpeech('  a\n\nb \t c  '), 'a b c');
  assert.equal(cleanSpeech(null), '');
  assert.equal(cleanSpeech(undefined), '');
});

test('amounts are spoken in the language', () => {
  assert.equal(spokenAmount(25, 'EUR', 'en', t), '25 euros');
  assert.equal(spokenAmount('25.00', 'EUR', 'en', t), '25 euros');
  assert.equal(spokenAmount(1, 'USD', 'en', t), '1 dollar');
  assert.equal(spokenAmount(12.5, 'EUR', 'pt', t), '12,50 euros');
  assert.equal(spokenAmount(12.5, 'EUR', 'de', t), '12,50 Euro');
  assert.equal(spokenAmount(12.5, 'EUR', 'ja', t), '12.50 ユーロ');
  assert.equal(spokenAmount(3.456, 'USD', 'en', t), '3.46 dollars');
});

test('a currency with no spoken name is read by its code', () => {
  assert.equal(spokenAmount(5, 'XYZ', 'en', t), '5 XYZ');
});

test('the template is filled once; a donor cannot inject a placeholder', () => {
  assert.equal(buildLine({ template: '{name} tipped {amount}: {message}', emptyTemplate: '{name} tipped {amount}!', name: 'A', amountText: '5 euros', message: '{name}' }), 'A tipped 5 euros: {name}');
  assert.equal(buildLine({ template: 'x {message}', emptyTemplate: '{name} tipped {amount}!', name: 'A', amountText: '5 euros', message: '' }), 'A tipped 5 euros!');
});

test('a value with "$&" stays plain text', () => {
  assert.equal(buildLine({ template: '{name}: {message}', emptyTemplate: '{name}', name: 'A', amountText: '5', message: "$& $' $1" }), "A: $& $' $1");
});

test('who is read, in order of the reasons', () => {
  const s = { tts_enabled: 1, tts_min_amount: 5, donation_currency: 'EUR' };
  const ok = { overlayOn: true, alertOn: true, overlayOpen: true };
  assert.deepEqual(speechDecision({ streamer: { ...s, tts_enabled: 0 }, donation: { amount: 50, currency: 'EUR' }, ...ok }), { read: false, status: null });
  assert.equal(speechDecision({ streamer: s, donation: { amount: 50, currency: 'USD' }, ...ok }).status, 'other_currency');
  assert.equal(speechDecision({ streamer: s, donation: { amount: 4.99, currency: 'EUR' }, ...ok }).status, 'below_threshold');
  assert.deepEqual(speechDecision({ streamer: s, donation: { amount: 5, currency: 'EUR' }, ...ok }), { read: true, status: null });
  assert.equal(speechDecision({ streamer: s, donation: { amount: 5, currency: 'EUR' }, ...ok, alertOn: false }).status, 'blocked_off');
  assert.equal(speechDecision({ streamer: s, donation: { amount: 5, currency: 'EUR' }, ...ok, overlayOn: false }).status, 'blocked_off');
  assert.equal(speechDecision({ streamer: s, donation: { amount: 5, currency: 'EUR' }, ...ok, overlayOpen: false }).status, 'overlay_closed');
});

test('the reasons are checked in order', () => {
  const s = { tts_enabled: 1, tts_min_amount: 5, donation_currency: 'EUR' };
  const off = { overlayOn: false, alertOn: false, overlayOpen: false };
  // another currency wins over a low amount, a low amount over a switched-off overlay
  assert.equal(speechDecision({ streamer: s, donation: { amount: 1, currency: 'USD' }, ...off }).status, 'other_currency');
  assert.equal(speechDecision({ streamer: s, donation: { amount: 1, currency: 'EUR' }, ...off }).status, 'below_threshold');
  assert.equal(speechDecision({ streamer: s, donation: { amount: 9, currency: 'EUR' }, ...off }).status, 'blocked_off');
});

test('the amount may arrive as text', () => {
  const s = { tts_enabled: 1, tts_min_amount: 5, donation_currency: 'EUR' };
  const ok = { overlayOn: true, alertOn: true, overlayOpen: true };
  assert.equal(speechDecision({ streamer: s, donation: { amount: '4.99', currency: 'EUR' }, ...ok }).status, 'below_threshold');
  assert.equal(speechDecision({ streamer: s, donation: { amount: '5.00', currency: 'EUR' }, ...ok }).read, true);
});

test('the default templates are the locale texts with single-brace placeholders', () => {
  assert.deepEqual(defaultTemplates(t, 'en'), {
    template: '{name} tipped {amount}: {message}',
    emptyTemplate: '{name} tipped {amount}!',
  });
});

test('a banned message is not read; a banned or empty name is "Someone"', () => {
  const r = prepareSpeech({ streamer: { tts_language: 'en' }, donation: { donorName: 'badword', amount: 5, currency: 'EUR', message: 'badword here' }, t, bannedCheck: (x) => x.includes('badword') });
  assert.deepEqual(r, { text: 'Someone tipped 5 euros!', messageRead: false });
});

test('an empty name is "Someone"; a clean tip is read in full', () => {
  const none = prepareSpeech({ streamer: {}, donation: { donorName: '  ', amount: 5, currency: 'EUR', message: 'hi' }, t, bannedCheck: () => null });
  assert.deepEqual(none, { text: 'Someone tipped 5 euros: hi', messageRead: true });
  const empty = prepareSpeech({ streamer: {}, donation: { donorName: 'Ana', amount: 1, currency: 'USD', message: '' }, t, bannedCheck: () => null });
  assert.deepEqual(empty, { text: 'Ana tipped 1 dollar!', messageRead: false });
});

test('the streamer\'s own templates win over the defaults', () => {
  const streamer = { tts_language: 'en', tts_template: '{name} gave {amount} and says {message}', tts_template_empty: '{name} gave {amount}' };
  const base = { donorName: 'Ana', amount: 5, currency: 'EUR' };
  assert.equal(prepareSpeech({ streamer, donation: { ...base, message: 'yo' }, t, bannedCheck: () => null }).text, 'Ana gave 5 euros and says yo');
  assert.equal(prepareSpeech({ streamer, donation: { ...base, message: '' }, t, bannedCheck: () => null }).text, 'Ana gave 5 euros');
});

test('links in the message and the name are not read', () => {
  const r = prepareSpeech({ streamer: {}, donation: { donorName: 'evil.com', amount: 5, currency: 'EUR', message: 'see evil.com' }, t, bannedCheck: () => null });
  assert.deepEqual(r, { text: 'Someone tipped 5 euros: see', messageRead: true });
  const only = prepareSpeech({ streamer: {}, donation: { donorName: 'A', amount: 5, currency: 'EUR', message: 'https://evil.com' }, t, bannedCheck: () => null });
  assert.deepEqual(only, { text: 'A tipped 5 euros!', messageRead: false });
});

test('the message is cut to 200 characters', () => {
  const r = prepareSpeech({ streamer: { tts_language: 'en' }, donation: { donorName: 'A', amount: 5, currency: 'EUR', message: 'ab'.repeat(300) }, t, bannedCheck: () => null });
  assert.equal(r.text.length, 'A tipped 5 euros: '.length + 200);
});

test('the cut never splits an emoji', () => {
  const r = prepareSpeech({ streamer: {}, donation: { donorName: 'A', amount: 5, currency: 'EUR', message: '🔥a'.repeat(150) }, t, bannedCheck: () => null });
  assert.equal(Array.from(r.text.slice('A tipped 5 euros: '.length)).length, 200);
});
