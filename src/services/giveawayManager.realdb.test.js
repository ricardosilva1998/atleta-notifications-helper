'use strict';

// Drawing a giveaway's winners against the real src/db.js (on in-memory SQLite).
// giveawayManager.test.js runs the manager on a stub database; that stub offered a
// top-level transaction() the real module never had, so the stub hid that every
// draw ("Pick Winner Now", a re-draw, the end of a timed giveaway) threw
// "db.transaction is not a function". Nothing leaves the machine and nothing is
// written under data/. All ids and names are synthetic.

const { test, describe, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const realFs = require('fs');
const Module = require('module');
const RealDatabase = require('better-sqlite3');

describe('picking winners with the real database', () => {
  const DB_FILE = path.join(__dirname, '..', 'db.js');
  const MANAGER_FILE = path.join(__dirname, 'giveawayManager.js');
  const announced = { chat: [], overlay: [] };
  const saved = {};
  let db;
  let manager;
  let streamerId;

  before(() => {
    for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) {
      process.env[key] = process.env[key] || 'test';
    }
    saved.load = Module._load;
    Module._load = function (request, parent, isMain) {
      const from = parent && parent.filename;
      if (from === DB_FILE) {
        if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
        if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
      }
      if (from === MANAGER_FILE) {
        if (request === './twitchChat') return { chatManager: { sendMessage: (id, line) => announced.chat.push(line) } };
        if (request === './overlayBus') return { emit: (channel, event) => announced.overlay.push(event) };
      }
      return saved.load.call(this, request, parent, isMain);
    };
    for (const level of ['log', 'warn', 'error']) { saved[level] = console[level]; console[level] = () => {}; }
    db = require(DB_FILE);
    manager = require(MANAGER_FILE);
    streamerId = Number(db.db.prepare("INSERT INTO streamers (discord_user_id, discord_username, twitch_username, chatbot_enabled) VALUES ('700000000000000001', 'synthetic', 'synthetic_channel', 1)").run().lastInsertRowid);
  });

  after(() => {
    Module._load = saved.load;
    for (const level of ['log', 'warn', 'error']) console[level] = saved[level];
  });

  // The announcements of a draw wait on timers: none may run on into another test.
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'setImmediate'] });
    announced.chat.length = 0;
    announced.overlay.length = 0;
    db.db.exec('DELETE FROM giveaway_entries; DELETE FROM giveaways;');
  });
  afterEach(() => mock.timers.reset());

  const enter = (keyword, ...users) => users.forEach((user) => manager.tryAddEntry(streamerId, { 'user-id': `id-${user}`, 'display-name': user }, `!${keyword}`));
  const winnerNames = (giveawayId) => db.getWinners(giveawayId).map((w) => w.username);

  test('a draw records the winner, announces it, and a second pick answers the same winner', () => {
    const giveaway = manager.startGiveaway(streamerId, { keyword: 'gw', prize: 'Synthetic prize', winnersCount: 1 });
    enter('gw', 'Alice', 'Bob', 'Carol');

    const first = manager.pickWinners(giveaway.id, streamerId, {});
    assert.equal(first.winners.length, 1);
    assert.equal(winnerNames(giveaway.id).length, 1);
    assert.equal(winnerNames(giveaway.id)[0], first.winners[0].username);
    mock.timers.tick(5000);
    assert.equal(announced.overlay.filter((e) => e.type === 'giveaway_winner').length, 1);

    const again = manager.pickWinners(giveaway.id, streamerId, {});
    assert.equal(again.alreadyDrawn, true);
    assert.deepEqual(again.winners.map((w) => w.username), [first.winners[0].username]);
    assert.equal(db.getWinners(giveaway.id).length, 1, 'no second set was drawn');
  });

  test('a re-draw replaces the winner with someone who had not won', () => {
    const giveaway = manager.startGiveaway(streamerId, { keyword: 'gw', winnersCount: 1 });
    enter('gw', 'Alice', 'Bob', 'Carol');
    const first = manager.pickWinners(giveaway.id, streamerId, {}).winners[0];

    const second = manager.pickWinners(giveaway.id, streamerId, { redraw: true }).winners[0];

    assert.notEqual(second.username, first.username);
    const rows = db.getEntries(giveaway.id);
    assert.equal(rows.find((r) => r.username === first.username).is_redrawn_out, 1, 'the first winner is out');
    assert.deepEqual(db.getWinners(giveaway.id).filter((w) => !w.is_redrawn_out).map((w) => w.username), [second.username]);
  });

  test('a giveaway nobody entered has no winners, and says so by returning an empty list', () => {
    const giveaway = manager.startGiveaway(streamerId, { keyword: 'gw' });
    assert.deepEqual(manager.pickWinners(giveaway.id, streamerId, {}), { winners: [] });
    assert.equal(db.getWinners(giveaway.id).length, 0);
  });
});
