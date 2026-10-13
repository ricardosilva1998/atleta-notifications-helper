'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  TOGGLES, DURATIONS, STREAMELEMENTS_JWT_MAX,
  parseOverlaySettings, decideStreamElementsJwt, giveawayDurationSeconds,
} = require('./overlaySettings');

// The jwt below is a synthetic stand-in.
const JWT = 'header.payload.signature';
const OTHER_JWT = 'other.header.signature';

describe('parseOverlaySettings: toggles', () => {
  test('a checked box stores 1 and an absent one stores 0, raid and giveaway included', () => {
    const { columns } = parseOverlaySettings({ overlay_enabled: '1', overlay_raid_enabled: '1', overlay_giveaway_enabled: '1' }, {});
    assert.equal(columns.overlay_enabled, 1);
    assert.equal(columns.overlay_raid_enabled, 1);
    assert.equal(columns.overlay_giveaway_enabled, 1);
    assert.equal(columns.overlay_follow_enabled, 0);
    assert.equal(columns.overlay_sub_enabled, 0);
    assert.equal(columns.overlay_bits_enabled, 0);
    assert.equal(columns.overlay_donation_enabled, 0);
  });

  test('switching the raid and giveaway alerts off is saved (they were never saved before)', () => {
    const { columns } = parseOverlaySettings({ overlay_enabled: '1', overlay_follow_enabled: '1' }, {});
    assert.equal(columns.overlay_raid_enabled, 0);
    assert.equal(columns.overlay_giveaway_enabled, 0);
  });

  test('every toggle and duration written here is a whitelisted overlay column', () => {
    const db = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'db.js'), 'utf8');
    const whitelist = db.match(/const OVERLAY_COLUMNS = new Set\(\[([\s\S]*?)\]\)/)[1];
    for (const name of [...TOGGLES, ...DURATIONS.map(([n]) => n), 'overlay_volume', 'streamelements_jwt']) {
      assert.ok(whitelist.includes(`'${name}'`), name);
    }
  });
});

describe('parseOverlaySettings: durations', () => {
  test('keeps a duration inside its range', () => {
    const { columns } = parseOverlaySettings({
      overlay_follow_duration: '4', overlay_sub_duration: '30', overlay_bits_duration: '1',
      overlay_donation_duration: '12', overlay_raid_duration: '9', overlay_giveaway_duration: '45',
    }, {});
    assert.equal(columns.overlay_follow_duration, 4);
    assert.equal(columns.overlay_sub_duration, 30);
    assert.equal(columns.overlay_bits_duration, 1);
    assert.equal(columns.overlay_donation_duration, 12);
    assert.equal(columns.overlay_raid_duration, 9);
    assert.equal(columns.overlay_giveaway_duration, 45);
  });

  test('clamps alert durations to 1-30 seconds and the giveaway one to 1-60', () => {
    const { columns } = parseOverlaySettings({
      overlay_follow_duration: '0', overlay_sub_duration: '-5', overlay_bits_duration: '31',
      overlay_donation_duration: '99999', overlay_raid_duration: '30', overlay_giveaway_duration: '61',
    }, {});
    assert.equal(columns.overlay_follow_duration, 1);
    assert.equal(columns.overlay_sub_duration, 1);
    assert.equal(columns.overlay_bits_duration, 30);
    assert.equal(columns.overlay_donation_duration, 30);
    assert.equal(columns.overlay_raid_duration, 30);
    assert.equal(columns.overlay_giveaway_duration, 60);
    assert.equal(parseOverlaySettings({ overlay_giveaway_duration: '0' }, {}).columns.overlay_giveaway_duration, 1);
    assert.equal(parseOverlaySettings({ overlay_giveaway_duration: '60' }, {}).columns.overlay_giveaway_duration, 60);
  });

  test('a missing or unreadable duration gets the alert\'s default', () => {
    const { columns } = parseOverlaySettings({ overlay_follow_duration: '', overlay_sub_duration: 'abc', overlay_giveaway_duration: ['x'] }, {});
    assert.equal(columns.overlay_follow_duration, 5);
    assert.equal(columns.overlay_sub_duration, 7);
    assert.equal(columns.overlay_bits_duration, 6);
    assert.equal(columns.overlay_donation_duration, 6);
    assert.equal(columns.overlay_raid_duration, 7);
    assert.equal(columns.overlay_giveaway_duration, 8);
  });

  test('keeps whole seconds (the page sends whole seconds, a crafted request may not)', () => {
    assert.equal(parseOverlaySettings({ overlay_follow_duration: '7.9' }, {}).columns.overlay_follow_duration, 7);
    assert.equal(parseOverlaySettings({ overlay_follow_duration: 6 }, {}).columns.overlay_follow_duration, 6);
  });

  test('the giveaway duration is stored as seconds, like the other alerts', () => {
    assert.equal(parseOverlaySettings({ overlay_giveaway_duration: '8' }, {}).columns.overlay_giveaway_duration, 8);
  });
});

describe('parseOverlaySettings: volume', () => {
  test('0 stays 0 and the value is held to 0-1', () => {
    assert.equal(parseOverlaySettings({ overlay_volume: '0' }, {}).columns.overlay_volume, 0);
    assert.equal(parseOverlaySettings({ overlay_volume: '0.35' }, {}).columns.overlay_volume, 0.35);
    assert.equal(parseOverlaySettings({ overlay_volume: '1.5' }, {}).columns.overlay_volume, 1);
    assert.equal(parseOverlaySettings({ overlay_volume: '-2' }, {}).columns.overlay_volume, 0);
  });

  test('a missing or unreadable volume gets the default', () => {
    assert.equal(parseOverlaySettings({}, {}).columns.overlay_volume, 0.8);
    assert.equal(parseOverlaySettings({ overlay_volume: '' }, {}).columns.overlay_volume, 0.8);
    assert.equal(parseOverlaySettings({ overlay_volume: 'loud' }, {}).columns.overlay_volume, 0.8);
  });
});

describe('decideStreamElementsJwt', () => {
  test('a blank submit keeps the stored token', () => {
    for (const typed of ['', '   ', undefined, null]) {
      assert.deepEqual(decideStreamElementsJwt({ typed, remove: false, stored: JWT }), { value: JWT, changed: false });
    }
  });

  test('a typed token replaces the stored one (surrounding spaces dropped)', () => {
    assert.deepEqual(decideStreamElementsJwt({ typed: `  ${OTHER_JWT}\n`, remove: false, stored: JWT }), { value: OTHER_JWT, changed: true });
    assert.deepEqual(decideStreamElementsJwt({ typed: JWT, remove: false, stored: null }), { value: JWT, changed: true });
  });

  test('typing the stored token again changes nothing', () => {
    assert.deepEqual(decideStreamElementsJwt({ typed: JWT, remove: false, stored: JWT }), { value: JWT, changed: false });
  });

  test('the remove box clears it, and wins over a typed token', () => {
    assert.deepEqual(decideStreamElementsJwt({ typed: '', remove: true, stored: JWT }), { value: null, changed: true });
    assert.deepEqual(decideStreamElementsJwt({ typed: OTHER_JWT, remove: true, stored: JWT }), { value: null, changed: true });
  });

  test('removing when nothing is stored is not a change', () => {
    assert.deepEqual(decideStreamElementsJwt({ typed: '', remove: true, stored: null }), { value: null, changed: false });
    assert.deepEqual(decideStreamElementsJwt({ typed: '', remove: true, stored: '' }), { value: null, changed: false });
  });

  test('a blank submit with nothing stored stays empty', () => {
    assert.deepEqual(decideStreamElementsJwt({ typed: '', remove: false, stored: '' }), { value: null, changed: false });
  });

  test('something far too long to be a token is ignored', () => {
    const huge = 'a'.repeat(STREAMELEMENTS_JWT_MAX + 1);
    assert.deepEqual(decideStreamElementsJwt({ typed: huge, remove: false, stored: JWT }), { value: JWT, changed: false });
    const longest = 'a'.repeat(STREAMELEMENTS_JWT_MAX);
    assert.deepEqual(decideStreamElementsJwt({ typed: longest, remove: false, stored: null }), { value: longest, changed: true });
  });

  test('anything that is not text is ignored', () => {
    for (const typed of [42, ['a', 'b'], { token: 'x' }]) {
      assert.deepEqual(decideStreamElementsJwt({ typed, remove: false, stored: JWT }), { value: JWT, changed: false });
    }
  });
});

describe('parseOverlaySettings: the StreamElements token column', () => {
  test('is left out of the write when the submit keeps the stored token', () => {
    const result = parseOverlaySettings({ overlay_enabled: '1', streamelements_jwt: '' }, { streamelements_jwt: JWT });
    assert.equal('streamelements_jwt' in result.columns, false);
    assert.equal(result.streamElementsJwt, JWT);
  });

  test('is written when a new token is typed', () => {
    const result = parseOverlaySettings({ streamelements_jwt: OTHER_JWT }, { streamelements_jwt: JWT });
    assert.equal(result.columns.streamelements_jwt, OTHER_JWT);
    assert.equal(result.streamElementsJwt, OTHER_JWT);
  });

  test('is cleared by the remove box', () => {
    const result = parseOverlaySettings({ streamelements_jwt_remove: '1' }, { streamelements_jwt: JWT });
    assert.equal(result.columns.streamelements_jwt, null);
    assert.equal(result.streamElementsJwt, null);
  });

  test('a missing form or row does not throw', () => {
    assert.doesNotThrow(() => parseOverlaySettings(undefined, undefined));
    assert.equal(parseOverlaySettings(undefined, undefined).columns.overlay_enabled, 0);
  });
});

describe('giveawayDurationSeconds', () => {
  test('shows the stored seconds', () => {
    assert.equal(giveawayDurationSeconds(8), 8);
    assert.equal(giveawayDurationSeconds(45), 45);
  });

  test('never shows 0 or an out-of-range value, which would block the form', () => {
    assert.equal(giveawayDurationSeconds(0), 1);
    assert.equal(giveawayDurationSeconds(null), 8);
    assert.equal(giveawayDurationSeconds(undefined), 8);
    assert.equal(giveawayDurationSeconds(500), 60);
  });
});
