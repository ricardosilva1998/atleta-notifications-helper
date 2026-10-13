'use strict';

// Bounds for numbers a streamer types that end up as timers or sizes. A value
// is clamped when it is saved and again where a timer is created from it, so a
// bad stored value (negative, zero, huge) can never become a one-millisecond
// loop or a timer that never fires.

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number.parseFloat(value);
  return NaN; // undefined, null, booleans, arrays and objects are not numbers
}

// `value` as a number inside [min, max]. `fallback` stands in for anything that
// is not a finite number (undefined, "", "abc", NaN, Infinity).
function clampNumber(value, min, max, fallback) {
  const n = toNumber(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// The same, rounded to a whole number.
function clampInt(value, min, max, fallback) {
  const n = clampNumber(value, min, max, null);
  return n === null ? fallback : Math.round(n);
}

// How long a sponsor image stays on screen, in seconds (the builder's range).
const SPONSOR_DURATION_SECONDS = Object.freeze({ min: 5, max: 300, fallback: 30 });
// Minutes between sponsor chat messages.
const SPONSOR_CHAT_INTERVAL_MINUTES = Object.freeze({ min: 1, max: 1440, fallback: 10 });
// How large a sponsor image is drawn (the builder's slider, 30% to 100%).
const SPONSOR_IMAGE_SCALE = Object.freeze({ min: 0.3, max: 1, fallback: 1 });

function sponsorDurationSeconds(value) {
  const { min, max, fallback } = SPONSOR_DURATION_SECONDS;
  return clampInt(value, min, max, fallback);
}

function sponsorChatIntervalMinutes(value) {
  const { min, max, fallback } = SPONSOR_CHAT_INTERVAL_MINUTES;
  return clampInt(value, min, max, fallback);
}

function sponsorImageScale(value) {
  const { min, max, fallback } = SPONSOR_IMAGE_SCALE;
  return Math.round(clampNumber(value, min, max, fallback) * 100) / 100;
}

module.exports = {
  clampNumber,
  clampInt,
  SPONSOR_DURATION_SECONDS,
  SPONSOR_CHAT_INTERVAL_MINUTES,
  SPONSOR_IMAGE_SCALE,
  sponsorDurationSeconds,
  sponsorChatIntervalMinutes,
  sponsorImageScale,
};
