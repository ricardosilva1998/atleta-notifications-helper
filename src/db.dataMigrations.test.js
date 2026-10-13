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

let tmpDir;
before(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-data-migrations-')); });
after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// One boot: loads src/db.js afresh on `file`, lets `inspect` look at it, closes
// it. Returns the migration errors it printed.
function boot(file, inspect) {
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === DB_FILE) {
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

const ownErrors = (errors) => errors.filter((line) => /data_migrations|cp_rewards/i.test(line));

test('a fresh database boots twice: the switch migration is recorded once, without errors', () => {
  const file = path.join(tmpDir, 'fresh.db');
  const errors = [...boot(file), ...boot(file)];
  assert.deepEqual(ownErrors(errors), []);

  const raw = new RealDatabase(file);
  try {
    assert.deepEqual(raw.prepare('SELECT name FROM data_migrations').all().map((r) => r.name), [SWITCH_MIGRATION]);
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
