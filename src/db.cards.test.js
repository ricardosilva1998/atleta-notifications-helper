'use strict';

// The single-column writers behind the dashboard's working cards, against the real src/db.js on an
// in-memory SQLite database (nothing touches data/bot.db). All ids are synthetic.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const DB_FILE = path.join(__dirname, 'db.js');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

let db;
let counter = 0;

before(() => {
  const origLoad = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
      if (request === './config') return { adminDiscordIds: [] };
    }
    return origLoad(request, parent, isMain);
  };
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try {
    delete require.cache[DB_FILE];
    db = require(DB_FILE);
  } finally {
    console.log = log;
    console.error = error;
    Module._load = origLoad;
  }
});

function addStreamer() {
  const n = ++counter;
  return Number(db.db.prepare('INSERT INTO streamers (discord_user_id, discord_username, twitch_username) VALUES (?, ?, ?)')
    .run(`70000000000000${String(n).padStart(4, '0')}`, `cards${n}`, `cards_streamer_${n}`).lastInsertRowid);
}

describe('a claimed server\'s switches', () => {
  test('change one column of the streamer\'s own server only', () => {
    const a = addStreamer();
    const b = addStreamer();
    db.upsertGuild('600000000000000101', a, 'A');
    db.upsertGuild('600000000000000102', b, 'B');
    assert.equal(db.setGuildSwitch('600000000000000101', a, 'recap_enabled', 1), true);
    assert.equal(db.getGuildConfig('600000000000000101', a).recap_enabled, 1);
    assert.equal(db.setGuildSwitch('600000000000000102', a, 'recap_enabled', 1), false, 'not this streamer\'s server');
    assert.equal(db.getGuildConfig('600000000000000102', b).recap_enabled, 0);
    assert.throws(() => db.setGuildSwitch('600000000000000101', a, 'sub_role_id', 1), /not a server switch/);
  });
});

describe('the watcher row of the streamer\'s own channel', () => {
  test('is found per server, and its go-live and clips switches change without its channels', () => {
    const a = addStreamer();
    const login = db.getStreamerById(a).twitch_username;
    db.upsertGuild('600000000000000201', a, 'One');
    db.upsertGuild('600000000000000202', a, 'Two');
    db.addWatchedChannel('600000000000000201', a, login, '700000000000000001', '700000000000000002', 1, 1);
    db.addWatchedChannel('600000000000000202', a, login, '700000000000000003', null, 1, 0);
    const one = db.getOwnWatcher('600000000000000201', a, login.toUpperCase());
    assert.equal(one.live_channel_id, '700000000000000001');
    assert.equal(db.setWatcherNotify(one.id, a, 'notify_live', 0), true);
    assert.equal(db.getOwnWatcher('600000000000000201', a, login).notify_live, 0);
    assert.equal(db.getOwnWatcher('600000000000000201', a, login).live_channel_id, '700000000000000001', 'the channel stays');
    assert.equal(db.getOwnWatcher('600000000000000202', a, login).notify_live, 1, 'the other server is untouched');
    assert.equal(db.getOwnWatcher('600000000000000299', a, login), null);
    assert.throws(() => db.setWatcherNotify(one.id, a, 'live_channel_id', 1), /not a watcher switch/);
  });
});

describe('sponsor messages and the sponsor chat settings', () => {
  test('a message\'s switch changes only the streamer\'s own message', () => {
    const a = addStreamer();
    const b = addStreamer();
    const id = Number(db.addSponsorMessage(a, 'Partner line', 'https://example.test').lastInsertRowid);
    assert.equal(db.setSponsorMessageEnabled(id, b, 0), false);
    assert.equal(db.setSponsorMessageEnabled(id, a, 0), true);
    const row = db.getSponsorMessages(a).find((m) => m.id === id);
    assert.equal(row.enabled, 0);
    assert.equal(row.url, 'https://example.test', 'the link stays');
  });

  test('the switch and the interval are written one at a time', () => {
    const a = addStreamer();
    db.setSponsorChatSetting(a, 'sponsor_chat_interval_minutes', 15);
    db.setSponsorChatSetting(a, 'sponsor_send_chat', 1);
    db.setSponsorChatSetting(a, 'sponsor_send_chat', 0);
    const row = db.getStreamerById(a);
    assert.equal(row.sponsor_chat_interval_minutes, 15);
    assert.equal(row.sponsor_send_chat, 0);
    assert.throws(() => db.setSponsorChatSetting(a, 'paypal_email', 'x'), /not a sponsor chat setting/);
  });
});

describe('runInTransaction', () => {
  test('writes everything or nothing', () => {
    const a = addStreamer();
    assert.throws(() => db.runInTransaction(() => {
      db.setSponsorChatSetting(a, 'sponsor_chat_interval_minutes', 30);
      throw new Error('stop');
    }), /stop/);
    assert.notEqual(db.getStreamerById(a).sponsor_chat_interval_minutes, 30);
  });
});
