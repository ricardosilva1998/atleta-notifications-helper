'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildOverlayConfig, TWITCH_ALERTS, YOUTUBE_ALERTS } = require('./overlayConfig');
const { DEFAULT_DURATION_SECONDS } = require('./overlaySettings');

// A streamer row as the database returns it (the columns the config reads).
function streamer(over = {}) {
  return {
    id: 7, overlay_token: 'tok-config-test',
    overlay_follow_enabled: 1, overlay_sub_enabled: 1, overlay_bits_enabled: 1, overlay_donation_enabled: 1,
    overlay_raid_enabled: 1, overlay_giveaway_enabled: 1,
    overlay_follow_duration: 5, overlay_sub_duration: 7, overlay_bits_duration: 6, overlay_donation_duration: 6,
    overlay_raid_duration: 7, overlay_giveaway_duration: 8,
    yt_overlay_superchat_enabled: 1, yt_overlay_member_enabled: 1, yt_overlay_giftmember_enabled: 1,
    yt_overlay_superchat_duration: 6, yt_overlay_member_duration: 5, yt_overlay_giftmember_duration: 6,
    overlay_volume: 0.8,
    ...over,
  };
}

// Every test gets its own empty sounds folder.
let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'atleta-overlay-config-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
const build = (over) => buildOverlayConfig(streamer(over), { soundsRoot: root });

describe('buildOverlayConfig: which alerts it covers', () => {
  test('every alert the overlay can receive has an entry: the five Twitch ones, the giveaway winner and the three YouTube ones', () => {
    const config = build();
    for (const type of ['follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner', 'yt_superchat', 'yt_member', 'yt_giftmember']) {
      assert.deepEqual(Object.keys(config[type]).sort(), ['duration', 'enabled'], type);
    }
    assert.deepEqual(Object.keys(config).sort(), [
      'bits', 'donation', 'follow', 'giveaway_winner', 'raid', 'sounds', 'subscription', 'volume',
      'yt_giftmember', 'yt_member', 'yt_superchat',
    ]);
  });

  test('raid had no entry before: its toggle and duration now come through', () => {
    assert.deepEqual(build({ overlay_raid_enabled: 0, overlay_raid_duration: 12 }).raid, { enabled: false, duration: 12 });
    assert.deepEqual(build({ overlay_raid_enabled: 1, overlay_raid_duration: 9 }).raid, { enabled: true, duration: 9 });
  });

  test('the YouTube alerts read their own toggles and durations', () => {
    const config = build({
      yt_overlay_superchat_enabled: 0, yt_overlay_superchat_duration: 11,
      yt_overlay_member_enabled: 1, yt_overlay_member_duration: 4,
      yt_overlay_giftmember_enabled: 0, yt_overlay_giftmember_duration: 15,
    });
    assert.deepEqual(config.yt_superchat, { enabled: false, duration: 11 });
    assert.deepEqual(config.yt_member, { enabled: true, duration: 4 });
    assert.deepEqual(config.yt_giftmember, { enabled: false, duration: 15 });
  });

  test('each Twitch alert reads its own columns', () => {
    const config = build({
      overlay_follow_enabled: 0, overlay_follow_duration: 3, overlay_sub_duration: 20, overlay_bits_enabled: 0,
      overlay_donation_duration: 25,
    });
    assert.deepEqual(config.follow, { enabled: false, duration: 3 });
    assert.deepEqual(config.subscription, { enabled: true, duration: 20 });
    assert.deepEqual(config.bits, { enabled: false, duration: 6 });
    assert.deepEqual(config.donation, { enabled: true, duration: 25 });
  });

  test('the type names are the ones the overlay receives on the event bus', () => {
    const typesInList = [...TWITCH_ALERTS, ...YOUTUBE_ALERTS].map(([type]) => type);
    assert.deepEqual(typesInList.sort(), [
      'bits', 'donation', 'follow', 'giveaway_winner', 'raid', 'subscription', 'yt_giftmember', 'yt_member', 'yt_superchat',
    ]);
  });
});

describe('buildOverlayConfig: the giveaway duration is in seconds', () => {
  test('the stored seconds are passed through, not divided by 1000 or read as milliseconds', () => {
    assert.equal(build({ overlay_giveaway_duration: 8 }).giveaway_winner.duration, 8);
    assert.equal(build({ overlay_giveaway_duration: 20 }).giveaway_winner.duration, 20);
  });

  test('a duration outside what the settings page allows is brought into it, as a save would', () => {
    assert.equal(build({ overlay_giveaway_duration: 500 }).giveaway_winner.duration, 60);
    assert.equal(build({ overlay_giveaway_duration: 8000 }).giveaway_winner.duration, 60);
    assert.equal(build({ overlay_giveaway_duration: 0 }).giveaway_winner.duration, 1);
    assert.equal(build({ overlay_giveaway_duration: -4 }).giveaway_winner.duration, 1);
  });

  test('a missing or unreadable duration gets its default', () => {
    for (const bad of [null, undefined, 'abc', NaN]) {
      assert.equal(build({ overlay_giveaway_duration: bad }).giveaway_winner.duration, 10, String(bad));
      assert.equal(build({ overlay_follow_duration: bad }).follow.duration, 8, String(bad));
      assert.equal(build({ overlay_raid_duration: bad }).raid.duration, 10, String(bad));
      assert.equal(build({ overlay_donation_duration: bad }).donation.duration, 12, String(bad));
      assert.equal(build({ yt_overlay_member_duration: bad }).yt_member.duration, 8, String(bad));
      assert.equal(build({ yt_overlay_superchat_duration: bad }).yt_superchat.duration, 12, String(bad));
    }
  });

  test('the other Twitch durations stay within 1-30 seconds', () => {
    assert.equal(build({ overlay_follow_duration: 9999 }).follow.duration, 30);
    assert.equal(build({ overlay_raid_duration: 31 }).raid.duration, 30);
    assert.equal(build({ yt_overlay_superchat_duration: 500 }).yt_superchat.duration, 30);
  });
});

describe('buildOverlayConfig: enabled flags', () => {
  test('0 is off, 1 is on, and a missing flag is on (the columns default to 1)', () => {
    assert.equal(build({ overlay_follow_enabled: 0 }).follow.enabled, false);
    assert.equal(build({ overlay_follow_enabled: 1 }).follow.enabled, true);
    assert.equal(build({ overlay_follow_enabled: null }).follow.enabled, true);
    assert.equal(build({ overlay_follow_enabled: undefined }).follow.enabled, true);
    assert.equal(build({ yt_overlay_member_enabled: undefined }).yt_member.enabled, true);
  });

  test('is a real boolean, so the overlay\'s check reads it the same whatever the column holds', () => {
    for (const value of [0, 1, '0', '1', true, false]) {
      assert.equal(typeof build({ overlay_bits_enabled: value }).bits.enabled, 'boolean', String(value));
    }
    assert.equal(build({ overlay_bits_enabled: '0' }).bits.enabled, false);
  });
});

describe('buildOverlayConfig: volume', () => {
  test('0 stays 0: a silent overlay is not turned into 0.8', () => {
    assert.equal(build({ overlay_volume: 0 }).volume, 0);
  });

  test('any other saved volume is passed through', () => {
    assert.equal(build({ overlay_volume: 0.3 }).volume, 0.3);
    assert.equal(build({ overlay_volume: 1 }).volume, 1);
  });

  test('a missing or unreadable volume gets the default 0.8', () => {
    for (const bad of [null, undefined, '', 'loud', NaN]) assert.equal(build({ overlay_volume: bad }).volume, 0.8, String(bad));
  });

  test('a volume outside 0-1 is brought into that range', () => {
    assert.equal(build({ overlay_volume: 7 }).volume, 1);
    assert.equal(build({ overlay_volume: -2 }).volume, 0);
  });
});

describe('buildOverlayConfig: custom sounds', () => {
  test('carries the same URLs the sound routes build, so every config path agrees', () => {
    fs.mkdirSync(path.join(root, '7'), { recursive: true });
    fs.writeFileSync(path.join(root, '7', 'follow.mp3'), 'x');
    fs.writeFileSync(path.join(root, '7', 'raid.mp3'), 'x');
    const customSounds = require('./customSounds');
    const config = build();
    assert.deepEqual(config.sounds, customSounds.soundUrls(streamer(), root));
    assert.deepEqual(Object.keys(config.sounds).sort(), ['follow', 'raid']);
    assert.match(config.sounds.follow, /^\/overlay\/sounds\/tok-config-test\/follow\?v=\d+$/);
  });

  test('is an empty object when the streamer has none, or no overlay token', () => {
    assert.deepEqual(build().sounds, {});
    fs.mkdirSync(path.join(root, '7'), { recursive: true });
    fs.writeFileSync(path.join(root, '7', 'follow.mp3'), 'x');
    assert.deepEqual(build({ overlay_token: null }).sounds, {});
  });

  test('another streamer\'s sounds are never included', () => {
    fs.mkdirSync(path.join(root, '8'), { recursive: true });
    fs.writeFileSync(path.join(root, '8', 'follow.mp3'), 'x');
    assert.deepEqual(build().sounds, {});
  });
});

describe('buildOverlayConfig: the result', () => {
  test('is plain data the SSE stream can send as it is', () => {
    const config = build();
    assert.deepEqual(JSON.parse(JSON.stringify(config)), config);
  });

  test('does not change the streamer row it was given', () => {
    const row = streamer({ overlay_volume: 0, overlay_giveaway_duration: 8000 });
    const before = JSON.stringify(row);
    buildOverlayConfig(row, { soundsRoot: root });
    assert.equal(JSON.stringify(row), before);
  });

  test('a fresh database gives every alert duration column the settings\' default', () => {
    const db = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
    for (const [column, seconds] of Object.entries(DEFAULT_DURATION_SECONDS)) {
      const declared = [...db.matchAll(new RegExp(`\\b${column} INTEGER DEFAULT (\\d+)`, 'g'))].map((m) => Number(m[1]));
      assert.ok(declared.length > 0, `${column} is declared with a default in db.js`);
      for (const value of declared) assert.equal(value, seconds, column);
    }
  });

  test('every alert the overlay gets has a duration default and limit', () => {
    for (const [type, , column] of [...TWITCH_ALERTS, ...YOUTUBE_ALERTS]) {
      assert.ok(Object.hasOwn(DEFAULT_DURATION_SECONDS, column), `${type}: ${column}`);
    }
  });
});

describe("channelLettering: the name on the C1's rear window", () => {
  const { channelLettering } = require('./overlayConfig');

  test("is the streamer's Twitch name in capitals", () => {
    assert.equal(channelLettering({ twitch_username: 'andre_vilela_' }), 'ANDRE_VILELA_');
    assert.equal(channelLettering({ twitch_username: 'ricardobsilva98', twitch_display_name: 'RicardoBSilva98' }), 'RICARDOBSILVA98');
  });

  test('is the login even when the display name is written in another script', () => {
    assert.equal(channelLettering({ twitch_username: 'vilela_jp', twitch_display_name: 'ヴィレラ' }), 'VILELA_JP');
  });

  test('is empty for a streamer without a linked Twitch account', () => {
    for (const s of [null, undefined, {}, { twitch_username: null }, { twitch_username: '' }]) {
      assert.equal(channelLettering(s), '', JSON.stringify(s));
    }
  });

  test('keeps only what a Twitch login can hold (letters, digits, _), at most 25 characters', () => {
    assert.equal(channelLettering({ twitch_username: 'a<b>c"d e' }), 'ABCDE');
    assert.equal(channelLettering({ twitch_username: 'x'.repeat(40) }), 'X'.repeat(25));
  });
});
