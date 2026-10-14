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

// The moderation numbers (the chatbot page's Moderation fields): the page's range, and the default a value
// that is not a number gets.
const MODERATION_LIMITS = Object.freeze({
  mod_link_permit_seconds: Object.freeze({ min: 10, max: 600, fallback: 60 }),
  mod_caps_min_length: Object.freeze({ min: 3, max: 100, fallback: 10 }),
  mod_caps_max_percent: Object.freeze({ min: 30, max: 100, fallback: 70 }),
  mod_emote_max_count: Object.freeze({ min: 1, max: 100, fallback: 15 }),
  mod_repetition_window: Object.freeze({ min: 5, max: 300, fallback: 30 }),
  mod_symbol_max_percent: Object.freeze({ min: 10, max: 100, fallback: 50 }),
  mod_follow_age_minutes: Object.freeze({ min: 1, max: 1440, fallback: 10 }),
  mod_raid_protection_duration: Object.freeze({ min: 30, max: 600, fallback: 120 }),
});

function moderationNumber(column, value) {
  const { min, max, fallback } = MODERATION_LIMITS[column];
  return clampInt(value, min, max, fallback);
}

// What the bot does with a message a filter catches: the page's choices and the escalation ladder's steps.
const MODERATION_ACTIONS = Object.freeze(['delete', 'warn', 'timeout_10', 'timeout_60', 'timeout_600', 'timeout_1800']);

function moderationAction(value) {
  return MODERATION_ACTIONS.includes(value) ? value : 'delete';
}

// A switch's value as a form or a JSON body sends it: 1 (true, 1, "1", "true", "on"), 0 (false, 0, "0",
// "false", "off", "") or null for anything else, which is not a switch value.
function parseSwitch(value) {
  if (value === true || value === 1 || value === '1' || value === 'true' || value === 'on') return 1;
  if (value === false || value === 0 || value === '0' || value === 'false' || value === 'off' || value === '') return 0;
  return null;
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
  MODERATION_LIMITS,
  moderationNumber,
  MODERATION_ACTIONS,
  moderationAction,
  parseSwitch,
};
