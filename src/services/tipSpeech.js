'use strict';

// The line a tip is read aloud with (pure; no I/O): whether a tip is read at all
// (speechDecision), what the donor's words become once links, long runs and
// control characters are gone (cleanSpeech), how the amount sounds
// (spokenAmount) and the sentence the streamer's template makes of them
// (buildLine, prepareSpeech). The donor's name and message are viewer text that
// goes to a voice engine, so they are only ever filled into the template in one
// pass and never read as part of it.

const i18n = require('../i18n');
const { containsLink } = require('./chatFilters');

const MESSAGE_MAX = 200; // characters (code points) of a donor's message that are read
const TEMPLATE_MAX = 200; // characters of a streamer's template
const RUN_MAX = 3; // the same character at most this many times in a row

// '.' for English, Chinese and Japanese; ',' for the other four.
const DECIMAL_SEPARATOR = Object.freeze({ en: '.', zh: '.', ja: '.', pt: ',', es: ',', fr: ',', de: ',' });

const LINE_BREAKS = /[\t\n\r]+/g;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;
// Invisible formatting characters: every Unicode format character (\p{Cf}: soft hyphen, zero-width space and joiners,
// direction marks, word joiner, BOM, the tag characters), plus the invisible ones that are not in that class (the
// combining grapheme joiner, the Hangul fillers, the braille blank, the variation selectors). Nothing to say, and
// they would break up a link ("evil<ZWSP>.com") so the link test misses it. U+200D (the joiner) goes too.
const INVISIBLE_CHARACTERS = /[\p{Cf}\u034F\u115F\u1160\u3164\uFFA0\u2800\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu;
const WHITESPACE = /\s+/;
const LONG_RUN = /(.)\1{3,}/gsu;
const PLACEHOLDER = /\{(name|amount|message)\}/g;

// The first `max` characters (code points), so an emoji is never cut in two.
function limitCharacters(text, max) {
  const characters = Array.from(text);
  return characters.length <= max ? text : characters.slice(0, max).join('');
}

// What a donor's text becomes before it is spoken: runs of one character cut to
// three (so "woooooow" and a row of fire emoji stay short), control characters
// and invisible formatting characters removed, the words that are links dropped, whitespace collapsed.
function cleanSpeech(text) {
  if (text == null) return '';
  const plain = String(text).replace(LINE_BREAKS, ' ').replace(CONTROL_CHARACTERS, '').replace(INVISIBLE_CHARACTERS, '');
  // Runs first: "wwwwwww.x" is a link only once it is "www.x".
  const cut = plain.replace(LONG_RUN, (_, character) => character.repeat(RUN_MAX));
  return cut.split(WHITESPACE).filter((word) => word && !containsLink(word)).join(' ');
}

// 25 -> "25 euros", 1 -> "1 dollar", 12.5 in Portuguese -> "12,50 euros": at most
// two decimals (".00" dropped), the language's decimal separator, then the
// currency's spoken name from the locale (`tts.currency.<CODE>.one` / `.other`;
// a currency with no name is read by its code). `translate` is i18n.t().
function spokenAmount(amount, currency, lang, translate = i18n.t) {
  let value = Number(amount);
  if (!Number.isFinite(value)) value = 0;
  const fixed = value.toFixed(2);
  const number = fixed.replace(/\.00$/, '').replace('.', DECIMAL_SEPARATOR[lang] || '.');
  const form = Number(fixed) === 1 ? 'one' : 'other';
  const key = `tts.currency.${currency}.${form}`;
  const name = translate(lang, key);
  return `${number} ${name && name !== key ? name : currency}`;
}

// Fills {name}, {amount} and {message} in one pass: a value that holds "{name}" is
// not filled in again (the rule of chatTemplate.js), and "$&" in a value stays
// text. Without a message the `emptyTemplate` is used.
function buildLine({ template, emptyTemplate, name, amountText, message }) {
  const spokenMessage = typeof message === 'string' ? message.trim() : '';
  const chosen = spokenMessage ? template : emptyTemplate;
  const values = { name: name ?? '', amount: amountText ?? '', message: spokenMessage };
  return String(chosen ?? '').replace(PLACEHOLDER, (_, key) => values[key]).split(WHITESPACE).filter(Boolean).join(' ');
}

// Whether a tip is read, and when not, why (the status the dashboard shows).
// Checked in order: TTS off, another currency than the tip page's, below the
// minimum, the overlay or the donation alert switched off, the overlay not open.
function speechDecision({ streamer, donation, overlayOn, alertOn, overlayOpen }) {
  if (!streamer.tts_enabled) return { read: false, status: null };
  if (donation.currency !== streamer.donation_currency) return { read: false, status: 'other_currency' };
  if (Number(donation.amount) < Number(streamer.tts_min_amount)) return { read: false, status: 'below_threshold' };
  if (!overlayOn || !alertOn) return { read: false, status: 'blocked_off' };
  if (!overlayOpen) return { read: false, status: 'overlay_closed' };
  return { read: true, status: null };
}

// The language's two templates in their stored form (single braces), made from
// the locale texts, which write placeholders as {{name}}.
function defaultTemplates(t, lang) {
  const placeholders = { name: '{name}', amount: '{amount}', message: '{message}' };
  return {
    template: t(lang, 'tts.template.default', placeholders),
    emptyTemplate: t(lang, 'tts.template.empty', placeholders),
  };
}

// The text to speak for a donation, and whether the donor's message is in it.
// A message the banned-word check flags is left out (the no-message template is
// used); a flagged or empty name is read as "Someone".
function prepareSpeech({ streamer, donation, t, bannedCheck }) {
  const lang = streamer.tts_language || 'en';
  const banned = (text) => Boolean(bannedCheck && bannedCheck(text));

  let name = cleanSpeech(donation.donorName);
  if (!name || banned(name)) name = t(lang, 'tts.someone');

  let message = limitCharacters(cleanSpeech(donation.message), MESSAGE_MAX).trim();
  if (message && banned(message)) message = '';

  const defaults = defaultTemplates(t, lang);
  const text = buildLine({
    template: streamer.tts_template || defaults.template,
    emptyTemplate: streamer.tts_template_empty || defaults.emptyTemplate,
    name,
    amountText: spokenAmount(donation.amount, donation.currency, lang, t),
    message,
  });
  return { text, messageRead: message !== '' };
}

module.exports = {
  MESSAGE_MAX,
  TEMPLATE_MAX,
  RUN_MAX,
  cleanSpeech,
  spokenAmount,
  buildLine,
  speechDecision,
  defaultTemplates,
  prepareSpeech,
};
