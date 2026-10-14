'use strict';

// The single-column writers behind the dashboard's working cards, against the real src/db.js on an
// in-memory SQLite database (nothing touches data/bot.db). The last test saves every key of the settings
// table (services/dashboardSettings.js) through the real save() and checks which column changed. All ids are
// synthetic.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const { SETTINGS, save } = require('./services/dashboardSettings');

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

function addStreamer(paypalEmail = null) {
  const n = ++counter;
  return Number(db.db.prepare('INSERT INTO streamers (discord_user_id, discord_username, twitch_username, paypal_email) VALUES (?, ?, ?, ?)')
    .run(`70000000000000${String(n).padStart(4, '0')}`, `cards${n}`, `cards_streamer_${n}`, paypalEmail).lastInsertRowid);
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
    // A new row has the interval at 15 and the switch off. None of the values below is one of those, so a
    // writer that writes nothing fails, and each write is followed by a look at the column it must leave alone
    // (always at a value other than the new row's, so a writer that resets it fails too).
    db.setSponsorChatSetting(a, 'sponsor_chat_interval_minutes', 45);
    assert.equal(db.getStreamerById(a).sponsor_chat_interval_minutes, 45);

    db.setSponsorChatSetting(a, 'sponsor_send_chat', 1);
    let row = db.getStreamerById(a);
    assert.equal(row.sponsor_send_chat, 1);
    assert.equal(row.sponsor_chat_interval_minutes, 45, 'switching it on leaves the interval alone');

    db.setSponsorChatSetting(a, 'sponsor_chat_interval_minutes', 60);
    row = db.getStreamerById(a);
    assert.equal(row.sponsor_chat_interval_minutes, 60);
    assert.equal(row.sponsor_send_chat, 1, 'changing the interval leaves the switch alone');

    db.setSponsorChatSetting(a, 'sponsor_send_chat', 0);
    row = db.getStreamerById(a);
    assert.equal(row.sponsor_send_chat, 0);
    assert.equal(row.sponsor_chat_interval_minutes, 60, 'switching it off leaves the interval alone');

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

// ── Every key of the settings table, saved through save() into the real database ─────────────────────
// The settings tests use a fake database, and a writer skips a column it does not list without a word, so a
// key whose name or writer is wrong would pass them and save nothing.

// The four rows a key can write to, as they are stored.
function storedRows(streamerId, guildId, watcherId, messageId) {
  const row = (sql, ...params) => db.db.prepare(sql).get(...params);
  return {
    streamers: row('SELECT * FROM streamers WHERE id = ?', streamerId),
    guilds: row('SELECT * FROM guilds WHERE guild_id = ? AND streamer_id = ?', guildId, streamerId),
    watched_channels: row('SELECT * FROM watched_channels WHERE id = ?', watcherId),
    sponsor_messages: row('SELECT * FROM sponsor_messages WHERE id = ?', messageId),
  };
}

// 'table.column' of every stored value that differs between two readings of those rows.
function changedColumns(before, after) {
  return Object.keys(before).flatMap((table) => Object.keys(before[table])
    .filter((column) => before[table][column] !== after[table][column])
    .map((column) => `${table}.${column}`));
}

// Where a key is written.
function columnOf(key, setting) {
  switch (setting.target) {
    case undefined: return { table: 'streamers', column: key };
    case 'guild': return { table: 'guilds', column: key };
    case 'watcher': return { table: 'watched_channels', column: key };
    case 'sponsorMessage': return { table: 'sponsor_messages', column: 'enabled' };
    default: throw new Error(`this test does not know where ${key} is written (target ${setting.target})`);
  }
}

// A valid value other than the stored one: the opposite switch; the largest number, or the smallest when that is
// what is stored; a text that names its key and the round.
function otherValue(key, setting, stored, round) {
  if (setting.kind === 'switch') return stored ? 0 : 1;
  if (setting.kind === 'text') return `Round ${round}: thanks, {username}! (${key})`;
  return Number(stored) === setting.max ? setting.min : setting.max;
}

describe('the settings table against the real database', () => {
  test('every key writes exactly its own column, to the value it is given, and nothing else on the rows it can reach', () => {
    // Whatever a key needs before it switches on is there: a streamer with a PayPal email, a server with a sub
    // role, the streamer's own channel in it with both Discord channels (its two switches start off, so the
    // first round switches them on through the check that they have a channel) and one sponsor message.
    const streamerId = addStreamer('tips@example.test');
    const login = db.getStreamerById(streamerId).twitch_username;
    const guildId = '600000000000000301';
    db.upsertGuild(guildId, streamerId, 'Cards');
    db.updateGuildConfig(guildId, streamerId, { sub_role_id: '800000000000000301' });
    db.addWatchedChannel(guildId, streamerId, login, '700000000000000301', '700000000000000302', 0, 0);
    const watcherId = db.getOwnWatcher(guildId, streamerId, login).id;
    const messageId = Number(db.addSponsorMessage(streamerId, 'Partner line', 'https://example.test').lastInsertRowid);

    // Two rounds: the second writes every key to yet another value, so a switch is written in both directions.
    for (const round of [1, 2]) {
      for (const [key, setting] of Object.entries(SETTINGS)) {
        const { table, column } = columnOf(key, setting);
        const before = storedRows(streamerId, guildId, watcherId, messageId);
        const value = otherValue(key, setting, before[table][column], round);
        if (setting.needs && round === 1) assert.equal(value, 1, `${key} starts off, so the first round switches it on through its check`);
        const change = { key, value };
        if (setting.target === 'guild' || setting.target === 'watcher') change.guildId = guildId;
        if (setting.target === 'sponsorMessage') change.id = messageId;

        const result = save(db.getStreamerById(streamerId), change, { db, followUps: { run() {} } });
        const after = storedRows(streamerId, guildId, watcherId, messageId);

        assert.deepEqual(result, { ok: true, values: { [key]: value } }, `${key}, round ${round}`);
        assert.equal(after[table][column], value, `${key}, round ${round}: ${table}.${column} holds what was saved`);
        assert.deepEqual(changedColumns(before, after), [`${table}.${column}`], `${key}, round ${round}: only its own column changes`);
      }
    }
  });
});
