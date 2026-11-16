'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  TOGGLES, YOUTUBE_TOGGLES, DURATIONS, YOUTUBE_DURATIONS, DEFAULT_DURATION_SECONDS, PREVIOUS_DEFAULT_SECONDS,
  parseOverlaySettings, giveawayDurationSeconds,
} = require('./overlaySettings');

// The jwt below is a synthetic stand-in.

describe('parseOverlaySettings: toggles', () => {
  test('a checked box stores 1 and an absent one stores 0, raid and giveaway included', () => {
    const columns = parseOverlaySettings({ overlay_enabled: '1', overlay_raid_enabled: '1', overlay_giveaway_enabled: '1' });
    assert.equal(columns.overlay_enabled, 1);
    assert.equal(columns.overlay_raid_enabled, 1);
    assert.equal(columns.overlay_giveaway_enabled, 1);
    assert.equal(columns.overlay_follow_enabled, 0);
    assert.equal(columns.overlay_sub_enabled, 0);
    assert.equal(columns.overlay_bits_enabled, 0);
    assert.equal(columns.overlay_donation_enabled, 0);
  });

  test('switching the raid and giveaway alerts off is saved (they were never saved before)', () => {
    const columns = parseOverlaySettings({ overlay_enabled: '1', overlay_follow_enabled: '1' });
    assert.equal(columns.overlay_raid_enabled, 0);
    assert.equal(columns.overlay_giveaway_enabled, 0);
  });

  test('every toggle and duration written here is a whitelisted overlay column', () => {
    const db = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'db.js'), 'utf8');
    const whitelist = db.match(/const OVERLAY_COLUMNS = new Set\(\[([\s\S]*?)\]\)/)[1];
    for (const name of [...TOGGLES, ...YOUTUBE_TOGGLES, ...DURATIONS.map(([n]) => n), ...YOUTUBE_DURATIONS.map(([n]) => n), 'overlay_volume']) {
      assert.ok(whitelist.includes(`'${name}'`), name);
    }
  });
});

describe('parseOverlaySettings: durations', () => {
  test('keeps a duration inside its range', () => {
    const columns = parseOverlaySettings({
      overlay_follow_duration: '4', overlay_sub_duration: '30', overlay_bits_duration: '1',
      overlay_donation_duration: '12', overlay_raid_duration: '9', overlay_giveaway_duration: '45',
    });
    assert.equal(columns.overlay_follow_duration, 4);
    assert.equal(columns.overlay_sub_duration, 30);
    assert.equal(columns.overlay_bits_duration, 1);
    assert.equal(columns.overlay_donation_duration, 12);
    assert.equal(columns.overlay_raid_duration, 9);
    assert.equal(columns.overlay_giveaway_duration, 45);
  });

  test('clamps alert durations to 1-30 seconds and the giveaway one to 1-60', () => {
    const columns = parseOverlaySettings({
      overlay_follow_duration: '0', overlay_sub_duration: '-5', overlay_bits_duration: '31',
      overlay_donation_duration: '99999', overlay_raid_duration: '30', overlay_giveaway_duration: '61',
    });
    assert.equal(columns.overlay_follow_duration, 1);
    assert.equal(columns.overlay_sub_duration, 1);
    assert.equal(columns.overlay_bits_duration, 30);
    assert.equal(columns.overlay_donation_duration, 30);
    assert.equal(columns.overlay_raid_duration, 30);
    assert.equal(columns.overlay_giveaway_duration, 60);
    assert.equal(parseOverlaySettings({ overlay_giveaway_duration: '0' }).overlay_giveaway_duration, 1);
    assert.equal(parseOverlaySettings({ overlay_giveaway_duration: '60' }).overlay_giveaway_duration, 60);
  });

  test('a missing or unreadable duration gets the alert\'s default', () => {
    const columns = parseOverlaySettings({ overlay_follow_duration: '', overlay_sub_duration: 'abc', overlay_giveaway_duration: ['x'] });
    assert.equal(columns.overlay_follow_duration, 8);
    assert.equal(columns.overlay_sub_duration, 10);
    assert.equal(columns.overlay_bits_duration, 10);
    assert.equal(columns.overlay_donation_duration, 12);
    assert.equal(columns.overlay_raid_duration, 10);
    assert.equal(columns.overlay_giveaway_duration, 10);
  });

  test('the defaults leave time to read who it was: 8 to 12 seconds by alert', () => {
    assert.deepEqual(DEFAULT_DURATION_SECONDS, {
      overlay_follow_duration: 8, overlay_sub_duration: 10, overlay_bits_duration: 10,
      overlay_donation_duration: 12, overlay_raid_duration: 10, overlay_giveaway_duration: 10,
      yt_overlay_superchat_duration: 12, yt_overlay_member_duration: 8, yt_overlay_giftmember_duration: 10,
    });
    // The earlier defaults, which db.js moves to these once (tables made before
    // then still give a column its earlier DEFAULT).
    assert.deepEqual(PREVIOUS_DEFAULT_SECONDS, {
      overlay_follow_duration: 5, overlay_sub_duration: 7, overlay_bits_duration: 6,
      overlay_donation_duration: 6, overlay_raid_duration: 7, overlay_giveaway_duration: 8,
      yt_overlay_superchat_duration: 6, yt_overlay_member_duration: 5, yt_overlay_giftmember_duration: 6,
    });
  });

  test('a YouTube alert duration is saved when the page sends it, held to 1-30 seconds', () => {
    const columns = parseOverlaySettings({
      yt_overlay_superchat_duration: '20', yt_overlay_member_duration: '0', yt_overlay_giftmember_duration: '99',
    });
    assert.equal(columns.yt_overlay_superchat_duration, 20);
    assert.equal(columns.yt_overlay_member_duration, 1);
    assert.equal(columns.yt_overlay_giftmember_duration, 30);
    assert.equal(parseOverlaySettings({ yt_overlay_member_duration: 'abc' }).yt_overlay_member_duration, 8);
  });

  test('a save without the YouTube fields (YouTube not shown on the page) keeps the stored YouTube durations and switches', () => {
    const columns = parseOverlaySettings({ overlay_follow_duration: '9', yt_overlay_member_enabled: '1' });
    for (const [name] of YOUTUBE_DURATIONS) assert.equal(Object.hasOwn(columns, name), false, name);
    for (const name of YOUTUBE_TOGGLES) assert.equal(Object.hasOwn(columns, name), false, name);
  });

  test('the YouTube alert switches are saved with their durations: a checked box stores 1, an absent one 0', () => {
    const shown = { yt_overlay_superchat_duration: '12', yt_overlay_member_duration: '8', yt_overlay_giftmember_duration: '10' };
    const columns = parseOverlaySettings({ ...shown, yt_overlay_superchat_enabled: '1' });
    assert.equal(columns.yt_overlay_superchat_enabled, 1);
    assert.equal(columns.yt_overlay_member_enabled, 0, 'an unchecked box is not sent');
    assert.equal(columns.yt_overlay_giftmember_enabled, 0);
  });

  test('keeps whole seconds (the page sends whole seconds, a crafted request may not)', () => {
    assert.equal(parseOverlaySettings({ overlay_follow_duration: '7.9' }).overlay_follow_duration, 7);
    assert.equal(parseOverlaySettings({ overlay_follow_duration: 6 }).overlay_follow_duration, 6);
  });

  test('the giveaway duration is stored as seconds, like the other alerts', () => {
    assert.equal(parseOverlaySettings({ overlay_giveaway_duration: '8' }).overlay_giveaway_duration, 8);
  });
});

describe('parseOverlaySettings: volume', () => {
  test('0 stays 0 and the value is held to 0-1', () => {
    assert.equal(parseOverlaySettings({ overlay_volume: '0' }).overlay_volume, 0);
    assert.equal(parseOverlaySettings({ overlay_volume: '0.35' }).overlay_volume, 0.35);
    assert.equal(parseOverlaySettings({ overlay_volume: '1.5' }).overlay_volume, 1);
    assert.equal(parseOverlaySettings({ overlay_volume: '-2' }).overlay_volume, 0);
  });

  test('a missing or unreadable volume gets the default', () => {
    assert.equal(parseOverlaySettings({}).overlay_volume, 0.8);
    assert.equal(parseOverlaySettings({ overlay_volume: '' }).overlay_volume, 0.8);
    assert.equal(parseOverlaySettings({ overlay_volume: 'loud' }).overlay_volume, 0.8);
  });
});

describe('parseOverlaySettings: the StreamElements token', () => {
  test('a submitted token is never written: the form has no such column any more', () => {
    const columns = parseOverlaySettings({ overlay_enabled: '1', streamelements_jwt: 'header.payload.signature', streamelements_jwt_remove: '1' });
    assert.equal('streamelements_jwt' in columns, false);
    assert.equal(columns.overlay_enabled, 1);
  });

  test('a missing form does not throw', () => {
    assert.doesNotThrow(() => parseOverlaySettings(undefined));
    assert.equal(parseOverlaySettings(undefined).overlay_enabled, 0);
  });
});

describe('giveawayDurationSeconds', () => {
  test('shows the stored seconds', () => {
    assert.equal(giveawayDurationSeconds(8), 8);
    assert.equal(giveawayDurationSeconds(45), 45);
  });

  test('never shows 0 or an out-of-range value, which would block the form', () => {
    assert.equal(giveawayDurationSeconds(0), 1);
    assert.equal(giveawayDurationSeconds(null), 10);
    assert.equal(giveawayDurationSeconds(undefined), 10);
    assert.equal(giveawayDurationSeconds(500), 60);
  });
});
