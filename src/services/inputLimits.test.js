'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  clampNumber, clampInt, sponsorDurationSeconds, sponsorChatIntervalMinutes, sponsorImageScale,
  SPONSOR_DURATION_SECONDS, SPONSOR_CHAT_INTERVAL_MINUTES, SPONSOR_IMAGE_SCALE,
} = require('./inputLimits');

describe('clampNumber', () => {
  test('keeps a value inside the range and pulls an outside one to the nearest bound', () => {
    assert.equal(clampNumber(7, 5, 10, 8), 7);
    assert.equal(clampNumber(4, 5, 10, 8), 5);
    assert.equal(clampNumber(11, 5, 10, 8), 10);
    assert.equal(clampNumber(-1e9, 5, 10, 8), 5);
    assert.equal(clampNumber(5, 5, 10, 8), 5);
    assert.equal(clampNumber(10, 5, 10, 8), 10);
  });

  test('reads numeric strings, as a form or JSON body sends them', () => {
    assert.equal(clampNumber('7.5', 5, 10, 8), 7.5);
    assert.equal(clampNumber(' 9 ', 5, 10, 8), 9);
    assert.equal(clampNumber('-3', 5, 10, 8), 5);
  });

  test('anything that is not a finite number gets the fallback', () => {
    for (const bad of [undefined, null, '', 'abc', NaN, Infinity, -Infinity, true, [], [7], {}, () => 7]) {
      assert.equal(clampNumber(bad, 5, 10, 8), 8, String(bad));
    }
  });
});

describe('clampInt', () => {
  test('clamps, then rounds to a whole number', () => {
    assert.equal(clampInt(7.4, 5, 10, 8), 7);
    assert.equal(clampInt(7.6, 5, 10, 8), 8);
    assert.equal(clampInt('9.9', 5, 10, 8), 10);
    assert.equal(clampInt(-4, 5, 10, 8), 5);
    assert.equal(clampInt(10.4, 5, 10, 8), 10, 'the bound itself, not a rounded value past it');
  });

  test('the fallback is returned as given', () => {
    assert.equal(clampInt('x', 5, 10, 8), 8);
    assert.equal(clampInt(undefined, 5, 10, 8.5), 8.5);
  });
});

describe('sponsor image time (seconds)', () => {
  test('the builder range is 5 to 300', () => {
    assert.deepEqual({ ...SPONSOR_DURATION_SECONDS }, { min: 5, max: 300, fallback: 30 });
  });

  test('negative, zero and tiny values become 5, so a timer is never a 1 ms loop', () => {
    for (const bad of [-100, -1, 0, 0.4, 1, 4]) assert.equal(sponsorDurationSeconds(bad), 5, String(bad));
  });

  test('a huge value becomes 300', () => {
    assert.equal(sponsorDurationSeconds(99999), 300);
    assert.equal(sponsorDurationSeconds('1e9'), 300);
  });

  test('a good value is kept, and a missing or unreadable one is 30', () => {
    assert.equal(sponsorDurationSeconds(45), 45);
    assert.equal(sponsorDurationSeconds('120'), 120);
    assert.equal(sponsorDurationSeconds(300), 300);
    for (const missing of [undefined, null, '', 'soon', NaN]) assert.equal(sponsorDurationSeconds(missing), 30, String(missing));
  });
});

describe('sponsor chat interval (minutes)', () => {
  test('the range is 1 to 1440 (a day), default 10', () => {
    assert.deepEqual({ ...SPONSOR_CHAT_INTERVAL_MINUTES }, { min: 1, max: 1440, fallback: 10 });
  });

  test('negative and zero become 1 minute; more than a day becomes a day', () => {
    for (const bad of [-60, -1, 0]) assert.equal(sponsorChatIntervalMinutes(bad), 1, String(bad));
    assert.equal(sponsorChatIntervalMinutes(5000), 1440);
  });

  test('good values are kept, missing ones are 10', () => {
    assert.equal(sponsorChatIntervalMinutes(15), 15);
    assert.equal(sponsorChatIntervalMinutes('30'), 30);
    for (const missing of [undefined, null, '', 'x']) assert.equal(sponsorChatIntervalMinutes(missing), 10, String(missing));
  });
});

describe('sponsor image scale', () => {
  test('the builder slider runs 30% to 100%', () => {
    assert.deepEqual({ ...SPONSOR_IMAGE_SCALE }, { min: 0.3, max: 1, fallback: 1 });
  });

  test('a scale outside the slider is pulled into it', () => {
    assert.equal(sponsorImageScale(-2), 0.3);
    assert.equal(sponsorImageScale(0), 0.3);
    assert.equal(sponsorImageScale(0.1), 0.3);
    assert.equal(sponsorImageScale(5), 1);
  });

  test('a good scale is kept to two decimals, a missing one is full size', () => {
    assert.equal(sponsorImageScale(0.55), 0.55);
    assert.equal(sponsorImageScale('0.75'), 0.75);
    assert.equal(sponsorImageScale(0.3333), 0.33);
    for (const missing of [undefined, null, '', 'big', NaN]) assert.equal(sponsorImageScale(missing), 1, String(missing));
  });
});

describe('moderation numbers and actions', () => {
  const { MODERATION_LIMITS, moderationNumber, MODERATION_ACTIONS, moderationAction } = require('./inputLimits');

  test('every number has the chatbot page\'s range and today\'s default', () => {
    assert.deepEqual(MODERATION_LIMITS, {
      mod_link_permit_seconds: { min: 10, max: 600, fallback: 60 },
      mod_caps_min_length: { min: 3, max: 100, fallback: 10 },
      mod_caps_max_percent: { min: 30, max: 100, fallback: 70 },
      mod_emote_max_count: { min: 1, max: 100, fallback: 15 },
      mod_repetition_window: { min: 5, max: 300, fallback: 30 },
      mod_symbol_max_percent: { min: 10, max: 100, fallback: 50 },
      mod_follow_age_minutes: { min: 1, max: 1440, fallback: 10 },
      mod_raid_protection_duration: { min: 30, max: 600, fallback: 120 },
    });
  });

  test('a number past its range is brought into it, one that is not a number gets the default', () => {
    assert.equal(moderationNumber('mod_link_permit_seconds', '99999'), 600);
    assert.equal(moderationNumber('mod_link_permit_seconds', '-5'), 10);
    assert.equal(moderationNumber('mod_link_permit_seconds', '0'), 10);
    assert.equal(moderationNumber('mod_link_permit_seconds', 'abc'), 60);
    assert.equal(moderationNumber('mod_link_permit_seconds', undefined), 60);
    assert.equal(moderationNumber('mod_caps_max_percent', '55.6'), 56);
  });

  test('the action is one the bot knows, else delete', () => {
    assert.deepEqual(MODERATION_ACTIONS, ['delete', 'warn', 'timeout_10', 'timeout_60', 'timeout_600', 'timeout_1800']);
    assert.equal(moderationAction('timeout_60'), 'timeout_60');
    assert.equal(moderationAction('ban_forever'), 'delete');
    assert.equal(moderationAction(undefined), 'delete');
  });
});
