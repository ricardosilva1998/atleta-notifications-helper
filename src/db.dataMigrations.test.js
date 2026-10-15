'use strict';

// One-time data migrations in src/db.js. The real db.js is booted several times
// in a row against one temporary database file, as successive deploys would
// boot it: a data migration runs on the first boot that has it and never
// again. Nothing touches data/bot.db. All ids and names are synthetic.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const RealDatabase = require('better-sqlite3');

const DB_FILE = path.join(__dirname, 'db.js');
const SWITCH_MIGRATION = 'cp_rewards_enabled_for_existing_rewards';
const SESSION_HASH_MIGRATION = 'hash_web_session_ids';
const DURATIONS_MIGRATION = 'longer_alert_durations';
const C1_MIGRATION = 'c1_donation_for_andre_vilela';

let tmpDir;
before(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-data-migrations-')); });
after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// One boot: loads src/db.js afresh on `file`, lets `inspect` look at it, closes
// it. Returns the migration errors it printed. `stubs` replaces modules db.js
// requires, by the name it requires them with.
function boot(file, inspect, stubs = {}) {
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === DB_FILE) {
      if (Object.hasOwn(stubs, request)) return stubs[request];
      if (request === 'better-sqlite3') return function FileDatabase(_file, opts) { return new RealDatabase(file, opts); };
      if (request === 'fs') return { ...fs, existsSync: () => true, mkdirSync: () => {} };
      // src/config.js exits when the real env vars are missing; db.js only reads the admin ids.
      if (request === './config') return { adminDiscordIds: [] };
    }
    return origLoad.call(this, request, parent, isMain);
  };
  const { log, warn, error } = console;
  const errors = [];
  console.log = () => {};
  console.warn = () => {};
  console.error = (...args) => { errors.push(args.join(' ')); };
  let mod;
  try {
    delete require.cache[DB_FILE];
    mod = require(DB_FILE);
    if (inspect) inspect(mod);
  } finally {
    console.log = log;
    console.warn = warn;
    console.error = error;
    Module._load = origLoad;
    delete require.cache[DB_FILE];
    if (mod) mod.db.close();
  }
  return errors;
}

const ownErrors = (errors) => errors.filter((line) => /data_migrations|cp_rewards|hash_web_session_ids|longer_alert_durations|c1_donation_for_andre_vilela/i.test(line));

test('a fresh database boots twice: each data migration is recorded once, without errors', () => {
  const file = path.join(tmpDir, 'fresh.db');
  const errors = [...boot(file), ...boot(file)];
  assert.deepEqual(ownErrors(errors), []);

  const raw = new RealDatabase(file);
  try {
    assert.deepEqual(raw.prepare('SELECT name FROM data_migrations ORDER BY name').all().map((r) => r.name), [SWITCH_MIGRATION, SESSION_HASH_MIGRATION, DURATIONS_MIGRATION, C1_MIGRATION].sort());
  } finally {
    raw.close();
  }
});

test('on an existing database the switch goes on once for every streamer with an enabled reward, and stays as the streamer sets it', () => {
  const file = path.join(tmpDir, 'existing.db');
  boot(file); // the schema production has

  // Production before this change: the switch was never read (so rewards played
  // with it off) and no data migration had been recorded.
  const raw = new RealDatabase(file);
  let ids;
  try {
    let n = 0;
    const addStreamer = (switchOn) => Number(raw.prepare(
      'INSERT INTO streamers (discord_user_id, discord_username, cp_rewards_enabled) VALUES (?, ?, ?)'
    ).run(`60000000000000000${++n}`, `streamer${n}`, switchOn).lastInsertRowid);
    const addReward = (streamerId, enabled) => raw.prepare(
      "INSERT INTO channel_point_rewards (streamer_id, title, cost, media_type, media_filename, enabled) VALUES (?, 'Air Horn', 100, 'audio', 'synthetic.mp3', ?)"
    ).run(streamerId, enabled);

    ids = {
      enabledReward: addStreamer(0),
      onlyDisabledRewards: addStreamer(0),
      noRewards: addStreamer(0),
      alreadyOn: addStreamer(1),
      onWithoutRewards: addStreamer(1),
    };
    addReward(ids.enabledReward, 1);
    addReward(ids.enabledReward, 0);
    addReward(ids.onlyDisabledRewards, 0);
    addReward(ids.alreadyOn, 1);
    raw.exec('DROP TABLE data_migrations');
  } finally {
    raw.close();
  }

  const errors = boot(file, (db) => {
    const switchOf = (id) => db.getStreamerById(id).cp_rewards_enabled;
    assert.equal(switchOf(ids.enabledReward), 1, 'its rewards keep playing');
    assert.equal(switchOf(ids.onlyDisabledRewards), 0);
    assert.equal(switchOf(ids.noRewards), 0);
    assert.equal(switchOf(ids.alreadyOn), 1);
    assert.equal(switchOf(ids.onWithoutRewards), 1, 'a switch that is on is never turned off');

    // Afterwards the streamer switches Channel Point Rewards off.
    db.db.prepare('UPDATE streamers SET cp_rewards_enabled = 0 WHERE id = ?').run(ids.enabledReward);
  });
  assert.deepEqual(ownErrors(errors), []);

  boot(file, (db) => {
    assert.equal(db.getStreamerById(ids.enabledReward).cp_rewards_enabled, 0, 'a later boot does not switch it on again');
  });
});

test('alert durations still on the earlier defaults move to the longer ones once; a duration a streamer chose stays', () => {
  const file = path.join(tmpDir, 'durations.db');
  boot(file); // the schema production has
  const { PREVIOUS_DEFAULT_SECONDS: earlier, DEFAULT_DURATION_SECONDS: now } = require('./services/overlaySettings');

  // Production before this change: streamers on the earlier defaults, one of
  // them with a 20 s follow alert and a 3 s YouTube member alert, and no
  // record of this migration.
  const raw = new RealDatabase(file);
  let onDefaults;
  let chose;
  let empty;
  try {
    let n = 0;
    const add = (values) => {
      const columns = ['discord_user_id', 'discord_username', ...Object.keys(values)];
      return Number(raw.prepare(`INSERT INTO streamers (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
        .run(`70000000000000000${++n}`, `streamer${n}`, ...Object.values(values)).lastInsertRowid);
    };
    onDefaults = add({ ...earlier });
    chose = add({ ...earlier, overlay_follow_duration: 20, yt_overlay_member_duration: 3 });
    empty = add({ ...earlier, overlay_bits_duration: null, yt_overlay_giftmember_duration: null });
    raw.prepare('DELETE FROM data_migrations WHERE name = ?').run(DURATIONS_MIGRATION);
  } finally {
    raw.close();
  }

  const errors = boot(file, (db) => {
    const row = db.getStreamerById(onDefaults);
    for (const column of Object.keys(earlier)) assert.equal(row[column], now[column], column);
    const theirs = db.getStreamerById(chose);
    assert.equal(theirs.overlay_follow_duration, 20, 'a duration the streamer chose stays');
    assert.equal(theirs.yt_overlay_member_duration, 3);
    assert.equal(theirs.overlay_sub_duration, now.overlay_sub_duration, 'their other alerts were still on the defaults');
    const blank = db.getStreamerById(empty);
    assert.equal(blank.overlay_bits_duration, now.overlay_bits_duration, 'an empty duration gets the new default');
    assert.equal(blank.yt_overlay_giftmember_duration, now.yt_overlay_giftmember_duration);

    // Afterwards the streamer sets the follow alert back to 5 s.
    db.db.prepare('UPDATE streamers SET overlay_follow_duration = 5 WHERE id = ?').run(onDefaults);
  });
  assert.deepEqual(ownErrors(errors), []);

  boot(file, (db) => {
    assert.equal(db.getStreamerById(onDefaults).overlay_follow_duration, 5, 'a later boot does not move it again');
  });
});

test('a new streamer starts with the overlay settings\' defaults, written by the insert rather than left to the column DEFAULTs', () => {
  const file = path.join(tmpDir, 'new-streamer.db');
  const real = require('./services/overlaySettings');
  // Values no column DEFAULT has, so the test tells the insert from the table's
  // defaults (a table made before 2026-10-14 still gives the earlier ones).
  const marked = Object.fromEntries(Object.keys(real.DEFAULT_DURATION_SECONDS).map((column, i) => [column, 21 + i]));

  const errors = boot(file, (db) => {
    const row = db.upsertStreamerDiscord('800000000000000001', 'newcomer', 'Newcomer', null);
    for (const [column, seconds] of Object.entries(marked)) assert.equal(row[column], seconds, column);

    // Signing in again changes only the Discord fields.
    db.db.prepare('UPDATE streamers SET overlay_follow_duration = 9 WHERE id = ?').run(row.id);
    const again = db.upsertStreamerDiscord('800000000000000001', 'newcomer_renamed', 'Newcomer', null);
    assert.equal(again.id, row.id);
    assert.equal(again.discord_username, 'newcomer_renamed');
    assert.equal(again.overlay_follow_duration, 9);
  }, { './services/overlaySettings': { ...real, DEFAULT_DURATION_SECONDS: marked } });
  assert.deepEqual(ownErrors(errors), []);
});

test('a database from before the live poller kept a stream id gets the two columns on the next boot, keeping its rows', () => {
  const file = path.join(tmpDir, 'before-stream-id.db');
  boot(file); // the schema production will have

  // What production has today: channel_state without the two columns, with a channel live.
  const raw = new RealDatabase(file);
  try {
    raw.exec('ALTER TABLE channel_state DROP COLUMN last_stream_id');
    raw.exec('ALTER TABLE channel_state DROP COLUMN offline_polls');
    raw.prepare("INSERT INTO channel_state (twitch_username, is_live, stream_title, peak_viewers) VALUES ('live_channel', 1, 'Race night', 42)").run();
  } finally {
    raw.close();
  }

  const stateErrors = (errors) => errors.filter((line) => /channel_state|last_stream_id|offline_polls/i.test(line));

  const errors = boot(file, (db) => {
    const cols = db.db.pragma('table_info(channel_state)').map((c) => c.name);
    assert.ok(cols.includes('last_stream_id'));
    assert.ok(cols.includes('offline_polls'));
    const row = db.getChannelState('live_channel');
    assert.equal(row.is_live, 1);
    assert.equal(row.stream_title, 'Race night');
    assert.equal(row.peak_viewers, 42);
    assert.equal(row.last_stream_id, null, 'unknown: the poller learns it from the next poll');
    assert.equal(row.offline_polls, 0);
    db.updateChannelState('live_channel', { last_stream_id: '123', offline_polls: 1 });
  });
  assert.deepEqual(stateErrors(errors), []);

  // And a second boot changes nothing.
  const again = boot(file, (db) => {
    const row = db.getChannelState('live_channel');
    assert.equal(row.last_stream_id, '123');
    assert.equal(row.offline_polls, 1);
  });
  assert.deepEqual(stateErrors(again), []);
});
