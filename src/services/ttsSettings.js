'use strict';

// What a save of the "Read tips aloud" settings (the Donations page) stores. Pure: the route passes the body and the
// tip page's minimum amount, and gets the values to store or an error code. The keys of `settings` are exactly the
// columns db.updateTtsSettings writes (TTS_COLUMNS in db.js).

const { clampNumber, parseSwitch } = require('./inputLimits');
const { TTS_LANGUAGES, defaultVoice, isVoice } = require('./ttsVoices');
const { TEMPLATE_MAX } = require('./tipSpeech');

const MIN_AMOUNT_FLOOR = 0.5;
const MIN_AMOUNT_CEIL = 10000;
const MIN_AMOUNT_DEFAULT = 5; // the column's default
const SPEED = Object.freeze({ min: 0.7, max: 1.2, fallback: 1 });
const EXPRESSIVENESS = Object.freeze({ min: 0, max: 1, fallback: 0.5 });
const VOLUME = Object.freeze({ min: 0, max: 1, fallback: 0.8 });

const twoDecimals = (n) => Math.round(n * 100) / 100;
const inRange = ({ min, max, fallback }, value) => twoDecimals(clampNumber(value, min, max, fallback));

// A template as stored: trimmed, at most TEMPLATE_MAX characters (code points), null when nothing is left.
function templateOf(value) {
  if (typeof value !== 'string') return null;
  const text = [...value.trim()].slice(0, TEMPLATE_MAX).join('').trim();
  return text === '' ? null : text;
}

function checkTtsSettings(body, { tipMinimum }) {
  const input = body || {};
  const lang = input.tts_language;
  if (!TTS_LANGUAGES.includes(lang)) return { ok: false, error: 'bad_language' };

  const floor = Math.max(Number(tipMinimum) || 0, MIN_AMOUNT_FLOOR);
  return {
    ok: true,
    settings: {
      tts_enabled: parseSwitch(input.tts_enabled) ?? 0,
      tts_min_amount: twoDecimals(clampNumber(input.tts_min_amount, floor, MIN_AMOUNT_CEIL, Math.max(floor, MIN_AMOUNT_DEFAULT))),
      tts_language: lang,
      tts_voice: isVoice(lang, input.tts_voice) ? input.tts_voice : defaultVoice(lang),
      tts_speed: inRange(SPEED, input.tts_speed),
      tts_expressiveness: inRange(EXPRESSIVENESS, input.tts_expressiveness),
      tts_volume: inRange(VOLUME, input.tts_volume),
      tts_template: templateOf(input.tts_template),
      tts_template_empty: templateOf(input.tts_template_empty),
    },
  };
}

module.exports = { checkTtsSettings };
