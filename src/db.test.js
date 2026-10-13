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

describe('Discord servers: removal, orphaned watchers, delivery errors', () => {
  const G1 = '400000000000000001';
  const G2 = '400000000000000002';
  // Every watcher table and the column that names what it watches. A new
  // watched_* table must be added here and to deleteGuild/deleteOrphanWatchers.
  const WATCHERS = {
    watched_channels: 'twitch_username',
    watched_youtube_channels: 'youtube_channel_id',
    watched_instagram_accounts: 'instagram_username',
    watched_tiktok_accounts: 'tiktok_username',
    watched_twitter_accounts: 'twitter_username',
    watched_iracing_drivers: 'customer_id',
  };

  function addWatchers(guildId, streamerId) {
    for (const [table, col] of Object.entries(WATCHERS)) {
      db.db.prepare(`INSERT INTO ${table} (guild_id, streamer_id, ${col}) VALUES (?, ?, ?)`).run(guildId, streamerId, `${table}-${guildId}-${streamerId}`);
    }
  }
  function watcherCount(guildId, streamerId) {
    return Object.keys(WATCHERS).reduce((n, table) =>
      n + db.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE guild_id = ? AND streamer_id = ?`).get(guildId, streamerId).n, 0);
  }

  test('the list above covers every watched_* table', () => {
    const tables = db.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'watched%'").all().map((r) => r.name).sort();
    assert.deepEqual(tables, Object.keys(WATCHERS).sort());
  });

  test('removing a server deletes that streamer\'s watchers in it, and nothing else', () => {
    db.upsertGuild(G1, streamerA, 'One');
    db.upsertGuild(G1, streamerB, 'One');
    db.upsertGuild(G2, streamerA, 'Two');
    addWatchers(G1, streamerA);
    addWatchers(G1, streamerB);
    addWatchers(G2, streamerA);

    db.deleteGuild(G1, streamerA);

    assert.equal(db.getGuildConfig(G1, streamerA), undefined);
    assert.equal(watcherCount(G1, streamerA), 0);
    assert.ok(db.getGuildConfig(G1, streamerB), 'another streamer keeps the same server');
    assert.equal(watcherCount(G1, streamerB), 6);
    assert.equal(watcherCount(G2, streamerA), 6);
  });

  test('the boot cleanup removes watchers whose streamer no longer has the server, and is idempotent', () => {
    db.upsertGuild(G1, streamerA, 'One');
    addWatchers(G1, streamerA); // claimed: kept
    addWatchers(G2, streamerA); // nobody claims G2
    addWatchers(G1, streamerB); // G1 is claimed, but not by B

    const first = db.deleteOrphanWatchers();
    assert.equal(first.total, 12);
    assert.equal(first.byTable.watched_channels, 2);
    assert.equal(watcherCount(G1, streamerA), 6);
    assert.equal(watcherCount(G2, streamerA), 0);
    assert.equal(watcherCount(G1, streamerB), 0);

    const second = db.deleteOrphanWatchers();
    assert.equal(second.total, 0);
    assert.equal(watcherCount(G1, streamerA), 6);
  });

  test('the delivery error columns exist after the migrations', () => {
    const cols = db.db.pragma('table_info(guilds)').map((c) => c.name);
    for (const col of ['last_delivery_error', 'last_delivery_error_at', 'last_delivery_error_channel_id']) assert.ok(cols.includes(col), col);
    assert.deepEqual(migrationErrors.filter((m) => /delivery/i.test(m)), []);
  });

  test('a failed delivery is kept per server and cleared by a later success in the same channel', () => {
    db.upsertGuild(G1, streamerA, 'One');
    db.upsertGuild(G1, streamerB, 'One');
    db.recordDeliveryError(G1, streamerA, '500000000000000001', 'Missing Permissions');

    let row = db.getGuildConfig(G1, streamerA);
    assert.equal(row.last_delivery_error, 'Missing Permissions');
    assert.equal(row.last_delivery_error_channel_id, '500000000000000001');
    assert.match(row.last_delivery_error_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    assert.equal(db.getGuildConfig(G1, streamerB).last_delivery_error, null, 'other streamers are not affected');

    db.clearDeliveryError(G1, streamerA, '500000000000000002');
    assert.equal(db.getGuildConfig(G1, streamerA).last_delivery_error, 'Missing Permissions', 'a success elsewhere keeps it');

    db.clearDeliveryError(G1, streamerA, '500000000000000001');
    row = db.getGuildConfig(G1, streamerA);
    assert.equal(row.last_delivery_error, null);
    assert.equal(row.last_delivery_error_at, null);
    assert.equal(row.last_delivery_error_channel_id, null);
  });

  test('a long error is shortened, and an unclaimed server is ignored', () => {
    db.upsertGuild(G1, streamerA, 'One');
    db.recordDeliveryError(G1, streamerA, '500000000000000001', 'e'.repeat(1000));
    assert.equal(db.getGuildConfig(G1, streamerA).last_delivery_error.length, 300);
    assert.doesNotThrow(() => db.recordDeliveryError(G2, streamerA, '500000000000000001', 'x'));
    assert.equal(db.getGuildConfig(G2, streamerA), undefined);
  });

  test('editing a watcher changes it only through its own server', () => {
    db.upsertGuild(G1, streamerA, 'One');
    db.upsertGuild(G2, streamerA, 'Two');
    db.addWatchedChannel(G1, streamerA, 'some_channel', 'L1', 'C1', true, true);
    db.addWatchedYoutubeChannel(G1, streamerA, 'UCsome', 'Some', 'V1', 'L1', null);
    const tw = db.getWatchedChannelsForGuild(G1, streamerA)[0];
    const yt = db.getWatchedYoutubeChannelsForGuild(G1, streamerA)[0];

    assert.equal(db.updateWatchedChannel(tw.id, streamerA, G2, 'L2', 'C2'), false);
    assert.equal(db.updateWatchedYoutubeChannel(yt.id, streamerA, G2, 'V2', 'L2'), false);
    assert.equal(db.getWatchedChannelsForGuild(G1, streamerA)[0].live_channel_id, 'L1');
    assert.equal(db.getWatchedYoutubeChannelsForGuild(G1, streamerA)[0].videos_channel_id, 'V1');

    assert.equal(db.updateWatchedChannel(tw.id, streamerA, G1, 'L2', null), true);
    assert.equal(db.updateWatchedYoutubeChannel(yt.id, streamerA, G1, null, 'L3'), true);
    const twAfter = db.getWatchedChannelsForGuild(G1, streamerA)[0];
    assert.equal(twAfter.live_channel_id, 'L2');
    assert.equal(twAfter.notify_clips, 0);
    assert.equal(db.getWatchedYoutubeChannelsForGuild(G1, streamerA)[0].live_channel_id, 'L3');
  });
});
