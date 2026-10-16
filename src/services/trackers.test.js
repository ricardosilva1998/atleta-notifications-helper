'use strict';

// The six trackers (services/trackers.js) against the real src/db.js on an in-memory SQLite database (the stub
// pattern of src/db.tracking.test.js; nothing touches data/bot.db), with the bus captured and a clock of their own.
// All ids and names are synthetic.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const DB_FILE = path.join(__dirname, '..', 'db.js');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

let db;
let trackers;
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
  trackers = require('./trackers');
});

const HOUR = 3600e3;
const sqlite = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

function addStreamer(over = {}) {
  const n = ++counter;
  const id = Number(db.db.prepare('INSERT INTO streamers (discord_user_id, discord_username, twitch_user_id, twitch_username) VALUES (?, ?, ?, ?)')
    .run(`74000000000000${String(n).padStart(4, '0')}`, `tracker${n}`, `9200${n}`, `Chan${n}`).lastInsertRowid);
  for (const [column, value] of Object.entries(over)) db.db.prepare(`UPDATE streamers SET ${column} = ? WHERE id = ?`).run(value, id);
  return id;
}

function addTip(streamerId, name, amount, currency, createdAt = sqlite(Date.now())) {
  db.db.prepare('INSERT INTO donations (streamer_id, source, donor_name, amount, currency, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(streamerId, 'paypal', name, amount, currency, createdAt);
}

// The channel_state row of the streamer's linked login (stored lower-cased, as the live poller keeps it).
function setStream(streamerId, { live, startedAt }) {
  const login = db.getStreamerById(streamerId).twitch_username.toLowerCase();
  db.db.prepare('INSERT OR REPLACE INTO channel_state (twitch_username, is_live, stream_started_at) VALUES (?, ?, ?)')
    .run(login, live ? 1 : 0, startedAt);
}

function setup({ t = Date.now() } = {}) {
  const world = { t, emitted: [], logs: [] };
  world.tr = trackers.createTrackers({
    db,
    emit: (channel, payload) => world.emitted.push({ channel, payload }),
    now: () => world.t,
    logger: Object.fromEntries(['log', 'warn', 'error'].map((level) => [level, (...args) => world.logs.push({ level, text: args.join(' ') })])),
  });
  return world;
}

describe('the trackers', () => {
  test('are the six, each streamer on a channel of their own', () => {
    assert.deepEqual(trackers.TRACKERS, ['latest_follower', 'latest_sub', 'latest_tip', 'latest_raid', 'latest_bits', 'top_tipper']);
    assert.equal(trackers.channel(12), 'tracker:12');
  });

  test('each Twitch event is stored as its tracker\'s value and broadcast', () => {
    const id = addStreamer();
    const w = setup();
    const events = [
      [{ type: 'follow', data: { username: 'NewFollower' } }, 'latest_follower', { name: 'NewFollower' }],
      [{ type: 'subscription', data: { username: 'Loyal', tier: '2', months: 14, message: 'hi' } }, 'latest_sub', { name: 'Loyal', months: 14, tier: '2' }],
      [{ type: 'giftsub', data: { username: 'Gifter', tier: '1', amount: 5, message: 'Gifted 5 subs!' } }, 'latest_sub', { name: 'Gifter', gifted: 5 }],
      [{ type: 'bits', data: { username: 'Cheerer', amount: 500, message: null } }, 'latest_bits', { name: 'Cheerer', amount: 500 }],
      [{ type: 'raid', data: { username: 'Raider', viewers: 42, login: 'raider', userId: '9002' } }, 'latest_raid', { name: 'Raider', viewers: 42 }],
    ];
    for (const [normalized, tracker, value] of events) {
      w.emitted.length = 0;
      w.tr.onEvent(id, normalized);
      assert.deepEqual(w.emitted, [{ channel: `tracker:${id}`, payload: { type: 'tracker', tracker, value } }], tracker);
      assert.deepEqual(JSON.parse(db.getTrackerValues(id)[tracker]), value, tracker);
    }
    const v = w.tr.values(id);
    assert.deepEqual(v.latest_follower, { name: 'NewFollower' });
    assert.deepEqual(v.latest_sub, { name: 'Gifter', gifted: 5 }, 'the gift came after the resub');
    assert.deepEqual(v.latest_bits, { name: 'Cheerer', amount: 500 });
    assert.deepEqual(v.latest_raid, { name: 'Raider', viewers: 42 });
    assert.equal(v.latest_tip, null);
    assert.equal(v.top_tipper, null);
    assert.deepEqual(Object.keys(v), trackers.TRACKERS);
  });

  test('other events (a redemption, a poll, nothing) change nothing and never throw', () => {
    const id = addStreamer();
    const w = setup();
    w.tr.onEvent(id, { type: 'redemption', data: { username: 'x' } });
    w.tr.onEvent(id, { type: 'poll', event: {} });
    w.tr.onEvent(id, null);
    assert.deepEqual(w.emitted, []);
    assert.deepEqual(db.getTrackerValues(id), {});
  });

  test('a value that cannot be read back is no value', () => {
    const id = addStreamer();
    db.setTrackerValue(id, 'latest_follower', 'not json {');
    assert.equal(setup().tr.values(id).latest_follower, null);
  });

  test('one tracker\'s value alone: a stored one is read back without working out the top tipper', () => {
    const id = addStreamer({ donation_currency: 'EUR' });
    const login = db.getStreamerById(id).twitch_username.toLowerCase();
    const w = setup();
    w.tr.onEvent(id, { type: 'follow', data: { username: 'Solo' } });
    const stateRows = () => db.db.prepare('SELECT COUNT(*) AS n FROM channel_state WHERE twitch_username = ?').get(login).n;
    assert.deepEqual(w.tr.valueOf(id, 'latest_follower'), { name: 'Solo' });
    assert.equal(w.tr.valueOf(id, 'latest_raid'), null);
    assert.equal(stateRows(), 0, 'no channel_state lookup for a stored tracker');
    db.setTrackerValue(id, 'latest_bits', 'not json {');
    assert.equal(w.tr.valueOf(id, 'latest_bits'), null);
    assert.equal(w.tr.valueOf(id, 'latest_hug'), null);

    addTip(id, 'Bob', 7, 'EUR');
    assert.deepEqual(w.tr.valueOf(id, 'top_tipper'), { name: 'Bob', amount: 7, currency: 'EUR' });
    assert.deepEqual(w.tr.valueOf(id, 'top_tipper'), w.tr.topTipper(id));
  });

  test('a tip in any currency is the latest tip; the top tipper follows', () => {
    const id = addStreamer({ donation_currency: 'EUR' });
    const w = setup();
    addTip(id, 'Bob', 7, 'EUR');
    w.tr.onTip(id, { name: 'Bob', amount: 7, currency: 'EUR' });
    addTip(id, 'Yankee', 50, 'USD');
    w.tr.onTip(id, { name: 'Yankee', amount: 50, currency: 'usd' });
    assert.deepEqual(w.emitted.map((e) => e.payload), [
      { type: 'tracker', tracker: 'latest_tip', value: { name: 'Bob', amount: 7, currency: 'EUR' } },
      { type: 'tracker', tracker: 'top_tipper', value: { name: 'Bob', amount: 7, currency: 'EUR' } },
      { type: 'tracker', tracker: 'latest_tip', value: { name: 'Yankee', amount: 50, currency: 'USD' } },
      { type: 'tracker', tracker: 'top_tipper', value: { name: 'Bob', amount: 7, currency: 'EUR' } },
    ]);
    assert.deepEqual(w.tr.values(id).latest_tip, { name: 'Yankee', amount: 50, currency: 'USD' });
    assert.ok(!('top_tipper' in db.getTrackerValues(id)), 'the top tipper is worked out, not stored');
  });
});

describe('the top tipper', () => {
  test('ranks only the tip page\'s currency, groups names whatever their case, and leaves Anonymous out', () => {
    const id = addStreamer({ donation_currency: 'EUR' });
    setStream(id, { live: true, startedAt: new Date(Date.now() - HOUR).toISOString() });
    addTip(id, 'Bob', 6, 'EUR');
    addTip(id, 'Alice', 10, 'EUR');
    addTip(id, 'bob', 5, 'EUR'); // Bob's 11 is more than Alice's 10
    addTip(id, 'Whale', 500, 'USD');
    addTip(id, 'Anonymous', 100, 'EUR');
    addTip(id, 'anonymous', 100, 'EUR');
    assert.deepEqual(setup().tr.topTipper(id), { name: 'bob', amount: 11, currency: 'EUR' });
  });

  test('counts this stream only while live, and the last stream\'s start when it is over', () => {
    const id = addStreamer({ donation_currency: 'EUR' });
    const start = Date.now() - 2 * HOUR;
    addTip(id, 'BeforeTheStream', 99, 'EUR', sqlite(start - HOUR));
    addTip(id, 'During', 3, 'EUR', sqlite(start + HOUR));
    setStream(id, { live: true, startedAt: new Date(start).toISOString() });
    assert.deepEqual(setup().tr.topTipper(id), { name: 'During', amount: 3, currency: 'EUR' });
    setStream(id, { live: false, startedAt: new Date(start).toISOString() });
    assert.deepEqual(setup().tr.topTipper(id), { name: 'During', amount: 3, currency: 'EUR' });
  });

  test('with no stream known, the last 12 hours', () => {
    const id = addStreamer({ donation_currency: 'EUR' });
    addTip(id, 'LongAgo', 99, 'EUR', sqlite(Date.now() - 13 * HOUR));
    addTip(id, 'Recent', 2, 'EUR', sqlite(Date.now() - 11 * HOUR));
    assert.deepEqual(setup().tr.topTipper(id), { name: 'Recent', amount: 2, currency: 'EUR' });
    setStream(id, { live: false, startedAt: null }); // a stream that ended clears its start
    assert.deepEqual(setup().tr.topTipper(id), { name: 'Recent', amount: 2, currency: 'EUR' });
  });

  test('is nobody without a tip, and for an unknown streamer', () => {
    const id = addStreamer();
    assert.equal(setup().tr.topTipper(id), null);
    assert.equal(setup().tr.topTipper(999999), null);
  });

  test('a tip without a currency counts in the tip page\'s, as the tip goal counts it', () => {
    const id = addStreamer({ donation_currency: 'GBP' });
    addTip(id, 'NoCurrency', 4, null);
    assert.deepEqual(setup().tr.topTipper(id), { name: 'NoCurrency', amount: 4, currency: 'GBP' });
  });
});

describe('the trackers\' settings', () => {
  test('settings() gives all six as their sources draw them: no row is on in the Atleta purple, a stored colour is kept', () => {
    const s = addStreamer();
    const world = setup();
    db.setTrackerSetting(s, 'latest_tip', { enabled: false, color: '#ff00aa' });
    db.setTrackerSetting(s, 'latest_raid', { color: 'red' });
    const settings = world.tr.settings(s);
    assert.deepEqual(Object.keys(settings), trackers.TRACKERS);
    assert.equal(trackers.DEFAULT_COLOR, '#9146FF');
    assert.deepEqual(settings.latest_follower, { enabled: true, color: '#9146FF', ownColor: false });
    assert.deepEqual(settings.latest_tip, { enabled: false, color: '#ff00aa', ownColor: true });
    assert.deepEqual(settings.latest_raid, { enabled: true, color: '#9146FF', ownColor: false }, 'a colour that is not #rrggbb is the default');
  });
});
