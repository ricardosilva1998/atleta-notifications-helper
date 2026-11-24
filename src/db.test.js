'use strict';

// Runs the real src/db.js (schema, migrations, queries) against an in-memory
// SQLite database, so nothing touches data/bot.db or the filesystem.

const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
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
  assert.deepEqual(cols, ['order_id', 'streamer_id', 'donor_name', 'message', 'payee_merchant_id', 'payee_email', 'captured_at', 'created_at']);
});

test('a brand-new database prints no migration error on its first boot, and already has every streamer column', () => {
  // The streamer-column migrations used to run before the streamers table was
  // made, so a new database's first boot printed "[DB migration] ... no such
  // table" and had no YouTube or multistream columns until the second boot.
  assert.deepEqual(migrationErrors, []);
  const cols = new Set(db.db.pragma('table_info(streamers)').map((c) => c.name));
  for (const column of [
    'yt_access_token', 'yt_refresh_token', 'yt_token_expires_at', 'yt_channel_name', 'yt_chatbot_enabled',
    'multistream_enabled', 'multistream_token', 'multistream_youtube_stream_id', 'multistream_active_broadcast_id',
    'multistream_last_error', 'multistream_last_error_at',
  ]) {
    assert.ok(cols.has(column), column);
  }
  const indexes = db.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'streamers'").all().map((r) => r.name);
  assert.ok(indexes.includes('idx_streamers_multistream_token'));
  assert.ok(indexes.includes('idx_streamers_overlay_token'));
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
    db.createPendingTip(row({ payee_merchant_id: 'MERCHANT12345', payee_email: 'p@example.com' }));
    const got = db.getPendingTip('ORDER-1');
    assert.equal(got.streamer_id, streamerA);
    assert.equal(got.donor_name, 'Viewer');
    assert.equal(got.message, 'hi');
    assert.equal(got.payee_merchant_id, 'MERCHANT12345');
    assert.equal(got.payee_email, 'p@example.com');
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

describe('addWatchedChannel', () => {
  const GUILD = '400000000000000099';
  const count = () => db.db.prepare('SELECT COUNT(*) AS n FROM watched_channels WHERE streamer_id = ?').get(streamerA).n;

  test('says whether the channel was added: true once, false for the same channel in the same server', () => {
    assert.equal(db.addWatchedChannel(GUILD, streamerA, 'Some_Streamer', '1', null, true, false, null), true);
    assert.equal(db.addWatchedChannel(GUILD, streamerA, 'some_streamer', '2', null, true, false, null), false);
    assert.equal(count(), 1);
    assert.equal(db.db.prepare('SELECT live_channel_id FROM watched_channels WHERE streamer_id = ?').get(streamerA).live_channel_id, '1', 'the first one is kept as it was');
    assert.equal(db.addWatchedChannel('400000000000000098', streamerA, 'some_streamer', '1', null, true, false, null), true, 'another server is a different watcher');
  });
});

describe('addWatchedChannel clip baseline', () => {
  const G1 = '400000000000000091';
  const G2 = '400000000000000092';
  const clip = (login) => db.db.prepare('SELECT last_clip_created_at AS c FROM channel_state WHERE twitch_username = ?').get(login).c;
  const del = (login) => db.db.prepare('DELETE FROM watched_channels WHERE twitch_username = ?').run(login);

  test('a channel nobody else watches is added with a fresh baseline; a shared one keeps its state', () => {
    db.addWatchedChannel(G1, streamerA, 'baseline_one', '1', null, true, true);
    db.db.prepare('UPDATE channel_state SET last_clip_created_at = ? WHERE twitch_username = ?').run('2026-01-01T00:00:00Z', 'baseline_one');
    del('baseline_one');
    assert.equal(db.addWatchedChannel(G1, streamerA, 'baseline_one', '1', null, true, true), true);
    assert.equal(clip('baseline_one'), null);

    db.db.prepare('UPDATE channel_state SET last_clip_created_at = ? WHERE twitch_username = ?').run('2026-02-02T00:00:00Z', 'baseline_one');
    assert.equal(db.addWatchedChannel(G2, streamerA, 'baseline_one', '1', null, true, true), true);
    assert.equal(clip('baseline_one'), '2026-02-02T00:00:00Z', 'another watcher exists: state is current');
    assert.equal(db.addWatchedChannel(G2, streamerA, 'baseline_one', '1', null, true, true), false);
    assert.equal(clip('baseline_one'), '2026-02-02T00:00:00Z', 'an ignored insert changes nothing');
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
    assert.equal(watcherCount(G1, streamerB), 5);
    assert.equal(watcherCount(G2, streamerA), 5);
  });

  test('the boot cleanup removes watchers whose streamer no longer has the server, and is idempotent', () => {
    db.upsertGuild(G1, streamerA, 'One');
    addWatchers(G1, streamerA); // claimed: kept
    addWatchers(G2, streamerA); // nobody claims G2
    addWatchers(G1, streamerB); // G1 is claimed, but not by B

    const first = db.deleteOrphanWatchers(() => {});
    assert.equal(first.total, 10);
    assert.equal(first.byTable.watched_channels, 2);
    assert.equal(watcherCount(G1, streamerA), 5);
    assert.equal(watcherCount(G2, streamerA), 0);
    assert.equal(watcherCount(G1, streamerB), 0);

    const lines = [];
    const second = db.deleteOrphanWatchers((line) => lines.push(line));
    assert.equal(second.total, 0);
    assert.deepEqual(lines, [], 'nothing left to remove, nothing to log');
    assert.equal(watcherCount(G1, streamerA), 5);
  });

  test('the boot cleanup logs each row it removes, with the columns that identify it, before deleting it', () => {
    db.upsertGuild(G1, streamerA, 'One');
    addWatchers(G2, streamerA); // nobody claims G2
    addWatchers(G1, streamerB); // G1 is claimed, but not by B

    const lines = [];
    const existedWhenLogged = [];
    db.deleteOrphanWatchers((line) => {
      lines.push(line);
      const [, table, id] = line.match(/table=(\w+) id=(\d+)/);
      existedWhenLogged.push(!!db.db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(Number(id)));
    });

    assert.equal(lines.length, 10);
    assert.ok(existedWhenLogged.every(Boolean), 'each row is still there when its line is written');
    for (const [table, column] of Object.entries(WATCHERS)) {
      for (const [guildId, streamerId] of [[G2, streamerA], [G1, streamerB]]) {
        const expected = new RegExp(`^\\[DB\\] Removing orphaned watcher: table=${table} id=\\d+ guild_id=${guildId} streamer_id=${streamerId} ${column}=${table}-${guildId}-${streamerId}$`);
        assert.ok(lines.some((line) => expected.test(line)), `${table} ${guildId} ${streamerId}`);
      }
    }
    assert.equal(watcherCount(G2, streamerA) + watcherCount(G1, streamerB), 0);
  });

  test('without a logger the boot cleanup writes its lines to the console', () => {
    addWatchers(G2, streamerA);
    const printed = [];
    const original = console.log;
    console.log = (line) => printed.push(line);
    try { db.deleteOrphanWatchers(); } finally { console.log = original; }
    assert.equal(printed.length, 5);
    assert.ok(printed.every((line) => line.startsWith('[DB] Removing orphaned watcher: table=')));
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

describe('the channels the pollers watch', () => {
  const G1 = '400000000000000031';
  const G2 = '400000000000000032';
  const names = (rows, key) => rows.map((r) => r[key]).sort();
  const disable = (id) => db.db.prepare('UPDATE streamers SET enabled = 0 WHERE id = ?').run(id);

  test('a Twitch channel watched in several servers or by several streamers is listed once', () => {
    db.addWatchedChannel(G1, streamerA, 'shared_channel', '1', null, true, false);
    db.addWatchedChannel(G2, streamerA, 'shared_channel', '1', null, true, false);
    db.addWatchedChannel(G1, streamerB, 'shared_channel', '1', null, true, false);
    db.addWatchedChannel(G1, streamerA, 'solo_channel', '1', null, true, false);
    assert.deepEqual(names(db.getAllUniqueWatchedChannels(), 'twitch_username'), ['shared_channel', 'solo_channel']);
  });

  test('a channel only a disabled account watches is left out; one an active account also watches stays', () => {
    db.addWatchedChannel(G1, streamerA, 'disabled_only', '1', null, true, false);
    db.addWatchedChannel(G1, streamerA, 'both_watch', '1', null, true, false);
    db.addWatchedChannel(G1, streamerB, 'both_watch', '1', null, true, false);
    disable(streamerA);
    assert.deepEqual(names(db.getAllUniqueWatchedChannels(), 'twitch_username'), ['both_watch']);
    assert.deepEqual(db.getWatchersForChannel('both_watch').map((w) => w.streamer_id), [streamerB], 'the watchers agree with the list');
    assert.deepEqual(db.getWatchersForChannel('disabled_only'), []);
  });

  test('a watcher that is switched off does not keep its channel in the list', () => {
    db.addWatchedChannel(G1, streamerA, 'paused_channel', '1', null, true, false);
    db.db.prepare('UPDATE watched_channels SET enabled = 0 WHERE twitch_username = ?').run('paused_channel');
    assert.deepEqual(db.getAllUniqueWatchedChannels(), []);
  });

  test('the digest channel is the streamer\'s own enabled watcher in the server, not another streamer\'s', () => {
    db.addWatchedChannel(G1, streamerA, 'a_channel', '1', null, true, false);
    db.addWatchedChannel(G1, streamerB, 'b_channel', '1', null, true, false);
    db.db.prepare('UPDATE watched_channels SET live_channel_id = ? WHERE streamer_id = ?').run('CH-A', streamerA);
    db.db.prepare('UPDATE watched_channels SET live_channel_id = ? WHERE streamer_id = ?').run('CH-B', streamerB);
    assert.equal(db.getDigestChannelForGuild(G1, streamerB), 'CH-B');
    assert.equal(db.getDigestChannelForGuild(G1, streamerA), 'CH-A');
    db.db.prepare('UPDATE watched_channels SET enabled = 0 WHERE streamer_id = ?').run(streamerB);
    assert.equal(db.getDigestChannelForGuild(G1, streamerB), null, 'a paused watcher gives no channel');
  });

  test('the same rules hold for YouTube channels', () => {
    db.addWatchedYoutubeChannel(G1, streamerA, 'UCshared', 'Shared', 'V1', 'L1', null);
    db.addWatchedYoutubeChannel(G2, streamerA, 'UCshared', 'Shared', 'V1', 'L1', null);
    db.addWatchedYoutubeChannel(G1, streamerB, 'UCshared', 'Shared', 'V1', 'L1', null);
    db.addWatchedYoutubeChannel(G1, streamerA, 'UCdisabledonly', 'Mine', 'V1', 'L1', null);
    assert.deepEqual(names(db.getAllUniqueWatchedYoutubeChannels(), 'youtube_channel_id'), ['UCdisabledonly', 'UCshared']);

    disable(streamerA);
    assert.deepEqual(names(db.getAllUniqueWatchedYoutubeChannels(), 'youtube_channel_id'), ['UCshared']);
    assert.deepEqual(db.getYoutubeWatchersForChannel('UCshared').map((w) => w.streamer_id), [streamerB]);
  });
});

describe('channel_state: what the live poller remembers about a broadcast', () => {
  const login = (suffix) => `state_probe_${suffix}`;

  test('a fresh database has the stream id and the missed-poll count', () => {
    const cols = db.db.pragma('table_info(channel_state)').map((c) => c.name);
    assert.ok(cols.includes('last_stream_id'));
    assert.ok(cols.includes('offline_polls'));
    assert.deepEqual(migrationErrors.filter((m) => /channel_state|last_stream_id|offline_polls/i.test(m)), []);
  });

  test('a new channel starts with no stream id and no missed polls', () => {
    const state = db.getChannelState(login('new'));
    assert.equal(state.last_stream_id, null);
    assert.equal(state.offline_polls, 0);
  });

  test('the stream id and the count are saved, and an update that leaves them out keeps them', () => {
    const name = login('keep');
    db.getChannelState(name);
    db.updateChannelState(name, { is_live: 1, last_stream_id: '40000000001', offline_polls: 1 });
    db.updateChannelState(name, { stream_title: 'Race night' });
    const state = db.getChannelState(name);
    assert.equal(state.last_stream_id, '40000000001');
    assert.equal(state.offline_polls, 1);
    assert.equal(state.stream_title, 'Race night');
  });

  test('a count of 0 is written: it is a value, not "no change"', () => {
    const name = login('zero');
    db.getChannelState(name);
    db.updateChannelState(name, { offline_polls: 1 });
    db.updateChannelState(name, { offline_polls: 0 });
    assert.equal(db.getChannelState(name).offline_polls, 0);
  });

  test('ending a session clears the session and the missed polls but keeps the last stream id', () => {
    const name = login('end');
    db.getChannelState(name);
    db.updateChannelState(name, { is_live: 1, last_stream_id: '40000000002', offline_polls: 1, stream_title: 'T', stream_started_at: '2026-10-13T10:00:00Z', peak_viewers: 55 });
    db.clearStreamSession(name);
    const state = db.getChannelState(name);
    assert.equal(state.stream_title, null);
    assert.equal(state.stream_started_at, null);
    assert.equal(state.peak_viewers, 0);
    assert.equal(state.offline_polls, 0);
    assert.equal(state.last_stream_id, '40000000002', 'kept: it is how the same broadcast is recognised if it comes back');
  });
});

describe('getOverlayStats7d: the dashboard\'s 7-day tiles', () => {
  // What eventsub.js stores for a gift: the whole normalized event.
  const giftData = (amount) => ({ username: 'Gifter', tier: '1', amount, message: `Gifted ${amount} sub${amount > 1 ? 's' : ''}!` });

  // A row as stored: data is the JSON text (or anything a column can hold).
  function addEvent(streamerId, type, data, createdAt = null) {
    db.db.prepare("INSERT INTO overlay_events (streamer_id, event_type, username, data, created_at) VALUES (?, ?, 'Someone', ?, COALESCE(?, datetime('now')))")
      .run(streamerId, type, data === null || typeof data === 'string' ? data : JSON.stringify(data), createdAt);
  }

  test('a gift counts every sub in it, not one per gift event', () => {
    addEvent(streamerA, 'giftsub', giftData(50));
    addEvent(streamerA, 'giftsub', giftData(1));
    addEvent(streamerA, 'giftsub', null); // a row with nothing stored about its size
    assert.equal(db.getOverlayStats7d(streamerA).giftsubs, 52);
  });

  test('a row whose data cannot be read counts as one gift, and never breaks the query', () => {
    for (const data of [null, '', 'not json at all', '{"truncated":', '5', '"text"', '[1,2]', '{"username":"NoAmount"}', '{"amount":null}']) {
      addEvent(streamerA, 'giftsub', data);
    }
    assert.equal(db.getOverlayStats7d(streamerA).giftsubs, 9);
  });

  test('an amount that is zero, negative or not a number still counts as one gift', () => {
    for (const amount of [0, -4, 'abc', '']) addEvent(streamerA, 'giftsub', { amount });
    addEvent(streamerA, 'giftsub', { amount: '7' }); // a number stored as text is read as a number
    assert.equal(db.getOverlayStats7d(streamerA).giftsubs, 4 + 7);
  });

  test('the other tiles still count events, and the gift amounts are not added to Subs', () => {
    addEvent(streamerA, 'subscription', { username: 'NewSub', tier: '1', months: 1 });
    addEvent(streamerA, 'subscription', { username: 'Resub', tier: '1', months: 6 });
    addEvent(streamerA, 'giftsub', giftData(50));
    addEvent(streamerA, 'follow', { username: 'Follower' });
    addEvent(streamerA, 'bits', { username: 'Cheerer', amount: 500 });
    addEvent(streamerA, 'donation', { amount: 25, currency: 'USD' });
    addEvent(streamerA, 'raid', { username: 'Raider', viewers: 42 });
    assert.deepEqual(db.getOverlayStats7d(streamerA), {
      follows: 1, subs: 2, bits_events: 1, donations: 1, raids: 1, giftsubs: 50, total: 7,
    });
  });

  test('only this streamer\'s last seven days are counted', () => {
    const daysAgo = (days) => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    addEvent(streamerA, 'giftsub', giftData(10), daysAgo(6));
    addEvent(streamerA, 'giftsub', giftData(20), daysAgo(8));
    addEvent(streamerB, 'giftsub', giftData(30));
    assert.equal(db.getOverlayStats7d(streamerA).giftsubs, 10);
    assert.equal(db.getOverlayStats7d(streamerB).giftsubs, 30);
  });

  test('a streamer with no events has all zeros', () => {
    assert.deepEqual(db.getOverlayStats7d(streamerA), { follows: 0, subs: 0, bits_events: 0, donations: 0, raids: 0, giftsubs: 0, total: 0 });
  });
});

describe('a disabled account is left out of the lookups the bot uses', () => {
  const GUILD = '400000000000000041';
  const disable = (id) => db.db.prepare('UPDATE streamers SET enabled = 0 WHERE id = ?').run(id);

  test('the server lookup behind welcome messages and /link skips a disabled streamer\'s claim, and brings it back when enabled', () => {
    db.upsertGuild(GUILD, streamerA, 'Shared server');
    db.upsertGuild(GUILD, streamerB, 'Shared server');
    assert.deepEqual(db.getGuildConfigsByGuildId(GUILD).map((g) => g.streamer_id).sort(), [streamerA, streamerB].sort());

    disable(streamerA);
    assert.deepEqual(db.getGuildConfigsByGuildId(GUILD).map((g) => g.streamer_id), [streamerB]);
    assert.equal(db.getGuildConfigsByGuildId(GUILD)[0].twitch_username, 'streamer_b', 'and still names the Twitch channel');

    disable(streamerB);
    assert.deepEqual(db.getGuildConfigsByGuildId(GUILD), []);

    db.enableStreamer(streamerA);
    assert.deepEqual(db.getGuildConfigsByGuildId(GUILD).map((g) => g.streamer_id), [streamerA]);
  });

  test('an account with no enabled flag at all (an old row) still counts as enabled', () => {
    db.upsertGuild(GUILD, streamerA, 'Shared server');
    db.db.prepare('UPDATE streamers SET enabled = NULL WHERE id = ?').run(streamerA);
    assert.equal(db.getGuildConfigsByGuildId(GUILD).length, 1);
  });

  test('the YouTube chat bot\'s streamers leave out a disabled account', () => {
    db.db.prepare("UPDATE streamers SET yt_chatbot_enabled = 1, youtube_channel_id = 'UCsynthetic' WHERE id IN (?, ?)").run(streamerA, streamerB);
    assert.deepEqual(db.getYoutubeChatbotEnabledStreamers().map((s) => s.id).sort(), [streamerA, streamerB].sort());

    disable(streamerA);
    assert.deepEqual(db.getYoutubeChatbotEnabledStreamers().map((s) => s.id), [streamerB]);

    db.enableStreamer(streamerA);
    assert.equal(db.getYoutubeChatbotEnabledStreamers().length, 2);
  });
});

describe('linkTwitch: the broadcaster authorization belongs to the Twitch account that gave it', () => {
  const authorize = (id, over = {}) => {
    db.updateStreamerBroadcasterTokens(id, `access-of-${id}`, `refresh-of-${id}`, Date.now() + 3_600_000);
    db.updateBroadcasterScopes(id, over.scopes || 'moderator:read:followers bits:read channel:manage:redemptions');
  };
  const tokensOf = (id) => {
    const s = db.getStreamerById(id);
    return { access: s.broadcaster_access_token, refresh: s.broadcaster_refresh_token, expires: s.broadcaster_token_expires_at, scopes: s.broadcaster_scopes };
  };
  const NOTHING = { access: null, refresh: null, expires: 0, scopes: null };

  test('linking another Twitch account clears the old account\'s tokens and scopes, and says which channel the bot was in', () => {
    db.linkTwitch(streamerA, '9001', 'old_channel', 'Old_Channel');
    authorize(streamerA);

    const result = db.linkTwitch(streamerA, '9002', 'new_channel', 'New_Channel');

    assert.deepEqual(result, { accountChanged: true, previousUsername: 'old_channel', displaced: [] });
    const row = db.getStreamerById(streamerA);
    assert.equal(row.twitch_user_id, '9002');
    assert.equal(row.twitch_username, 'new_channel');
    assert.equal(row.twitch_display_name, 'New_Channel');
    assert.deepEqual(tokensOf(streamerA), NOTHING);
  });

  test('linking the same account again changes only its names: the authorization, scopes and everything else stay', () => {
    db.linkTwitch(streamerA, '9001', 'old_name', 'Old_Name');
    authorize(streamerA);
    const before = tokensOf(streamerA);

    const result = db.linkTwitch(streamerA, '9001', 'renamed', 'Renamed');

    assert.deepEqual(result, { accountChanged: false, previousUsername: 'old_name', displaced: [] });
    assert.deepEqual(tokensOf(streamerA), before);
    assert.equal(db.getStreamerById(streamerA).twitch_username, 'renamed');
    assert.equal(db.getStreamerById(streamerA).twitch_display_name, 'Renamed');
  });

  test('the account is compared as an id, not as a string of the right type', () => {
    db.linkTwitch(streamerA, '9001', 'channel', 'Channel');
    authorize(streamerA);
    assert.equal(db.linkTwitch(streamerA, 9001, 'channel', 'Channel').accountChanged, false);
    assert.notDeepEqual(tokensOf(streamerA), NOTHING);
  });

  test('a first link has no previous channel, and clears any authorization left behind from before', () => {
    authorize(streamerA, { scopes: 'bits:read' }); // a token with no account linked: whose it is, nobody knows
    const result = db.linkTwitch(streamerA, '9003', 'first_channel', 'First_Channel');
    assert.deepEqual(result, { accountChanged: true, previousUsername: null, displaced: [] });
    assert.deepEqual(tokensOf(streamerA), NOTHING);
    assert.equal(db.getStreamerById(streamerA).twitch_user_id, '9003');
  });

  test('another streamer who had the account linked loses the link and its authorization, and is named', () => {
    db.linkTwitch(streamerA, '9001', 'shared_channel', 'Shared_Channel');
    authorize(streamerA);

    const result = db.linkTwitch(streamerB, '9001', 'shared_channel', 'Shared_Channel');

    assert.deepEqual(result, { accountChanged: true, previousUsername: null, displaced: [{ id: streamerA, username: 'shared_channel' }] });
    const a = db.getStreamerById(streamerA);
    assert.equal(a.twitch_user_id, null);
    assert.equal(a.twitch_username, null);
    assert.deepEqual(tokensOf(streamerA), NOTHING, 'A can no longer act as that Twitch account');
    assert.equal(db.getStreamerById(streamerB).twitch_user_id, '9001');
  });

  test('other streamers are not touched', () => {
    db.linkTwitch(streamerA, '9001', 'a_channel', 'A_Channel');
    db.linkTwitch(streamerB, '9002', 'b_channel', 'B_Channel');
    authorize(streamerB);
    const before = tokensOf(streamerB);
    db.linkTwitch(streamerA, '9003', 'a_new_channel', 'A_New_Channel');
    assert.deepEqual(tokensOf(streamerB), before);
    assert.equal(db.getStreamerById(streamerB).twitch_user_id, '9002');
  });

  test('the account a streamer drops can be linked by another streamer afterwards', () => {
    db.linkTwitch(streamerA, '9001', 'first_channel', 'First_Channel');
    db.linkTwitch(streamerA, '9002', 'second_channel', 'Second_Channel');
    assert.deepEqual(db.linkTwitch(streamerB, '9001', 'first_channel', 'First_Channel').displaced, [], 'nobody has it linked any more');
    assert.equal(db.getStreamerByTwitchId('9001').id, streamerB);
  });
});

const RACING_TABLES = [
  'track_maps', 'track_stats', 'racing_sessions', 'session_laps', 'lap_telemetry', 'racing_users',
  'password_reset_tokens', 'auth_log', 'teams', 'team_members', 'team_invites', 'notifications',
  'bridge_logs', 'bridge_bug_reports', 'iracing_overlay_settings', 'watched_iracing_drivers',
  'iracing_driver_state', 'iracing_race_cache',
];

// One boot of src/db.js on a file; returns what it logged.
function bootFile(file, inspect) {
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === DB_FILE) {
      if (request === 'better-sqlite3') return function FileDatabase(_file, opts) { return new RealDatabase(file, opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
      if (request === './config') return { adminDiscordIds: [] };
    }
    return origLoad.call(this, request, parent, isMain);
  };
  const saved = { log: console.log, warn: console.warn, error: console.error };
  const logs = [];
  for (const level of ['log', 'warn', 'error']) console[level] = (...args) => logs.push(args.join(' '));
  let mod;
  try {
    delete require.cache[DB_FILE];
    mod = require(DB_FILE);
    if (inspect) inspect(mod);
  } finally {
    Object.assign(console, saved);
    Module._load = origLoad;
    delete require.cache[DB_FILE];
    if (mod) mod.db.close();
  }
  return logs;
}

describe('the Racing tables are dropped once', () => {
  test('an old database loses all 18 tables and its Racing-only sessions; the next boot logs no migration line', () => {
    const dir = realFs.mkdtempSync(path.join(os.tmpdir(), 'db-racing-drop-'));
    const file = path.join(dir, 'old.db');
    try {
      const fresh = bootFile(file);
      assert.deepEqual(fresh.filter((l) => /\[DB migration\]/.test(l)), [], 'a fresh database drops nothing noisily');
      const handle = new RealDatabase(file);
      try {
        for (const table of RACING_TABLES) assert.equal(handle.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(table), undefined, `${table} is not created on a fresh database`);
        assert.equal(handle.pragma('table_info(sessions)').some((c) => c.name === 'racing_user_id'), false, 'a fresh sessions table has no racing_user_id');

        // Shape an old database: Racing tables, the wider sessions table, a Racing-only session.
        handle.pragma('foreign_keys = ON');
        handle.exec(`
          CREATE TABLE racing_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, password_hash TEXT);
          CREATE TABLE teams (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, owner_id INTEGER REFERENCES racing_users(id));
          CREATE TABLE team_members (id INTEGER PRIMARY KEY AUTOINCREMENT, team_id INTEGER REFERENCES teams(id), user_id INTEGER REFERENCES racing_users(id));
          CREATE TABLE racing_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, bridge_id TEXT);
          CREATE TABLE session_laps (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER REFERENCES racing_sessions(id));
          CREATE TABLE lap_telemetry (id INTEGER PRIMARY KEY AUTOINCREMENT, lap_id INTEGER REFERENCES session_laps(id));
          CREATE TABLE iracing_overlay_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, streamer_id INTEGER);
          INSERT INTO racing_users (username, password_hash) VALUES ('racer', 'x');
          INSERT INTO teams (name, owner_id) VALUES ('t', 1);
          INSERT INTO team_members (team_id, user_id) VALUES (1, 1);
          INSERT INTO racing_sessions (bridge_id) VALUES ('b');
          INSERT INTO session_laps (session_id) VALUES (1);
          INSERT INTO lap_telemetry (lap_id) VALUES (1);
        `);
        for (const table of ['track_maps', 'track_stats', 'password_reset_tokens', 'auth_log', 'team_invites', 'notifications', 'bridge_logs', 'bridge_bug_reports', 'watched_iracing_drivers', 'iracing_driver_state', 'iracing_race_cache']) {
          handle.exec(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY AUTOINCREMENT)`);
        }
        handle.exec(`
          DROP TABLE sessions;
          CREATE TABLE sessions (sid TEXT PRIMARY KEY, streamer_id INTEGER, racing_user_id INTEGER, expires_at INTEGER NOT NULL);
          INSERT INTO streamers (discord_user_id, discord_username) VALUES ('100000000000000009', 'kept');
          INSERT INTO sessions (sid, streamer_id, racing_user_id, expires_at) VALUES ('streamer-sid', 1, NULL, 9999999999999);
          INSERT INTO sessions (sid, streamer_id, racing_user_id, expires_at) VALUES ('linked-sid', 1, 1, 9999999999999);
          INSERT INTO sessions (sid, streamer_id, racing_user_id, expires_at) VALUES ('racing-sid', NULL, 1, 9999999999999);
          DELETE FROM data_migrations WHERE name = 'drop_racing_tables';
        `);
      } finally {
        handle.close();
      }

      const upgrade = bootFile(file, (mod) => {
        mod.createSession('new-cookie', 1, Date.now() + 60_000);
        assert.ok(mod.getSession('new-cookie'), 'a session can still be made on the old-shaped table');
      });
      assert.deepEqual(upgrade.filter((l) => /\[DB migration\]/.test(l)), []);

      const after = new RealDatabase(file);
      try {
        for (const table of RACING_TABLES) assert.equal(after.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(table), undefined, `${table} is gone`);
        const sids = after.prepare('SELECT sid FROM sessions ORDER BY sid').all().map((r) => r.sid);
        assert.equal(sids.includes('racing-sid'), false, 'the Racing-only session is gone');
        assert.equal(sids.length, 3, 'the streamer sessions stay (the two old ones as stored, plus the new one)');
      } finally {
        after.close();
      }

      const again = bootFile(file);
      assert.deepEqual(again.filter((l) => /\[DB migration\]/.test(l)), []);
    } finally {
      realFs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
