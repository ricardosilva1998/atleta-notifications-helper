'use strict';

// Runs the real src/db.js (schema, migrations, queries) against an in-memory
// SQLite database, so nothing touches data/bot.db or the filesystem.

const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const DB_FILE = path.join(__dirname, 'db.js');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

let db;
let migrationErrors = [];

before(() => {
  const origLoad = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
      // src/config.js exits when the real env vars are missing; db.js only reads the admin ids.
      if (request === './config') return { adminDiscordIds: [] };
    }
    return origLoad(request, parent, isMain);
  };
  // A fresh database prints one line per migration; keep the test output clean.
  const { log, error } = console;
  console.log = () => {};
  console.error = (...args) => { migrationErrors.push(args.join(' ')); };
  try {
    delete require.cache[DB_FILE];
    db = require(DB_FILE);
  } finally {
    console.log = log;
    console.error = error;
    Module._load = origLoad;
  }
});

let streamerA;
let streamerB;
beforeEach(() => {
  db.db.exec('DELETE FROM pending_tips; DELETE FROM donations; DELETE FROM streamers;');
  const add = db.db.prepare('INSERT INTO streamers (discord_user_id, discord_username, twitch_username) VALUES (?, ?, ?)');
  streamerA = Number(add.run('100000000000000001', 'a', 'streamer_a').lastInsertRowid);
  streamerB = Number(add.run('100000000000000002', 'b', 'streamer_b').lastInsertRowid);
});

test('the donation and pending tip migrations run cleanly on a fresh database', () => {
  assert.deepEqual(migrationErrors.filter((m) => /donation|pending_tips/i.test(m)), []);
  const cols = db.db.pragma('table_info(pending_tips)').map((c) => c.name);
  assert.deepEqual(cols, ['order_id', 'streamer_id', 'donor_name', 'message', 'payee_merchant_id', 'captured_at', 'created_at']);
});

describe('logDonation', () => {
  const tip = { source: 'paypal', donor_name: 'Viewer', amount: '10.00', currency: 'eur', message: 'hi', external_id: 'ORDER-1' };

  test('reports a new row, then a duplicate of the same source and id', () => {
    assert.equal(db.logDonation(streamerA, tip), true);
    assert.equal(db.logDonation(streamerA, tip), false);
    assert.equal(db.logDonation(streamerA, { ...tip, amount: '99.00' }), false, 'a replay with another amount is still a duplicate');
    const rows = db.db.prepare('SELECT * FROM donations').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amount, 10);
    assert.equal(rows[0].currency, 'EUR');
  });

  test('the same id from another source is a different donation', () => {
    assert.equal(db.logDonation(streamerA, tip), true);
    assert.equal(db.logDonation(streamerA, { ...tip, source: 'streamelements' }), true);
  });

  test('donations without an id cannot be deduplicated and are always new', () => {
    const noId = { ...tip, source: 'streamelements', external_id: null };
    assert.equal(db.logDonation(streamerA, noId), true);
    assert.equal(db.logDonation(streamerA, noId), true);
  });

  test('invalid amounts are not logged', () => {
    for (const amount of [0, -5, 'abc', undefined]) {
      assert.equal(db.logDonation(streamerA, { ...tip, amount, external_id: `X-${amount}` }), false);
    }
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM donations').get().n, 0);
  });
});

describe('pending tips', () => {
  const row = (over) => ({ order_id: 'ORDER-1', streamer_id: streamerA, donor_name: 'Viewer', message: 'hi', payee_merchant_id: null, ...over });

  test('keeps the donor details by PayPal order id', () => {
    db.createPendingTip(row({ payee_merchant_id: 'MERCHANT12345' }));
    const got = db.getPendingTip('ORDER-1');
    assert.equal(got.streamer_id, streamerA);
    assert.equal(got.donor_name, 'Viewer');
    assert.equal(got.message, 'hi');
    assert.equal(got.payee_merchant_id, 'MERCHANT12345');
    assert.equal(got.captured_at, null);
    assert.equal(db.getPendingTip('ORDER-UNKNOWN'), null);
  });

  test('an order id can only be pending once', () => {
    db.createPendingTip(row());
    assert.throws(() => db.createPendingTip(row({ streamer_id: streamerB })), /UNIQUE|PRIMARY KEY/);
    assert.equal(db.getPendingTip('ORDER-1').streamer_id, streamerA);
  });

  test('markPendingTipCaptured marks the order once', () => {
    db.createPendingTip(row());
    assert.equal(db.markPendingTipCaptured('ORDER-1'), true);
    assert.ok(db.getPendingTip('ORDER-1').captured_at);
    assert.equal(db.markPendingTipCaptured('ORDER-1'), false);
    assert.equal(db.markPendingTipCaptured('ORDER-UNKNOWN'), false);
  });

  test('cleanupOldPendingTips removes rows older than 24 hours only', () => {
    db.createPendingTip(row({ order_id: 'ORDER-FRESH' }));
    db.createPendingTip(row({ order_id: 'ORDER-OLD' }));
    db.createPendingTip(row({ order_id: 'ORDER-ALMOST' }));
    db.db.prepare("UPDATE pending_tips SET created_at = datetime('now', '-25 hours') WHERE order_id = 'ORDER-OLD'").run();
    db.db.prepare("UPDATE pending_tips SET created_at = datetime('now', '-23 hours') WHERE order_id = 'ORDER-ALMOST'").run();
    const { log } = console;
    console.log = () => {};
    try { db.cleanupOldPendingTips(); } finally { console.log = log; }
    const left = db.db.prepare('SELECT order_id FROM pending_tips ORDER BY order_id').all().map((r) => r.order_id);
    assert.deepEqual(left, ['ORDER-ALMOST', 'ORDER-FRESH']);
  });
});
