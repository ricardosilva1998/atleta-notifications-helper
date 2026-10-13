'use strict';

// The admin panel's Disable / Enable / Remove buttons: the real routes in
// src/routes/admin.js and the real src/services/accountLifecycle.js over the
// real src/db.js on in-memory SQLite. The connection managers are stubs that
// record what they were asked to do. All ids and names are synthetic.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) {
  process.env[key] = process.env[key] || 'test';
}

const SRC = path.join(__dirname, '..');
const DB_FILE = path.join(SRC, 'db.js');
const ADMIN_FILE = path.join(__dirname, 'admin.js');
const LIFECYCLE_FILE = path.join(SRC, 'services', 'accountLifecycle.js');
const ADMIN_DISCORD_ID = '1424474220976672940'; // the built-in admin (src/adminAccess.js)

const calls = [];
const record = (name) => (...args) => calls.push([name, ...args]);
const managers = {
  './eventsub': { eventSubManager: { startForStreamer: record('eventsub.start'), stopForStreamer: record('eventsub.stop') } },
  './streamelements': { streamElementsManager: { startForStreamer: record('se.start'), stopForStreamer: record('se.stop') } },
  './twitchChat': { chatManager: { startForStreamer: record('chat.start'), stopForStreamer: record('chat.stop') } },
  './timedNotifications': {
    timedNotificationManager: {
      stopForStreamer: record('sponsors.stop'), restartForStreamer: record('sponsors.restart'), restartChatForStreamer: record('sponsors.restartChat'),
    },
  },
};

let db;
let bus;
let server;
let port;
const logs = [];
const saved = {};

function post(urlPath, streamer) {
  return new Promise((resolve, reject) => {
    // A browser form with a button and no fields still sends an (empty) urlencoded body.
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': '0' };
    if (streamer) headers['x-test-streamer'] = String(streamer);
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'POST', agent: false, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  saved.load = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    const from = parent && parent.filename;
    if (from === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
    }
    if (from === ADMIN_FILE) {
      if (request === '../discord') return {};
      if (request === '../services/twitch') return {};
      if (request === '../services/youtube') return {};
      if (request === '../services/iracing') return { isConfigured: () => false };
    }
    if (from === LIFECYCLE_FILE && managers[request]) return managers[request];
    return saved.load(request, parent, isMain);
  };
  for (const level of ['log', 'warn', 'error']) {
    saved[level] = console[level];
    console[level] = (...args) => logs.push([level, args.join(' ')]);
  }

  delete require.cache[DB_FILE];
  delete require.cache[ADMIN_FILE];
  db = require(DB_FILE);
  bus = require('../services/overlayBus');

  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    const id = Number(req.get('x-test-streamer'));
    req.streamer = id ? db.getStreamerById(id) : undefined;
    next();
  });
  app.use('/admin', require('./admin'));
  app.use((err, req, res, next) => { logs.push(['error', err.stack]); res.status(500).end(); });
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = server.address().port;
});

after(async () => {
  for (const level of ['log', 'warn', 'error']) console[level] = saved[level];
  Module._load = saved.load;
  await new Promise((resolve) => server.close(resolve));
});

let counter = 0;
function addStreamer(over = {}) {
  const n = ++counter;
  const cols = { discord_user_id: `30000000000000${String(n).padStart(4, '0')}`, discord_username: `user${n}`, ...over };
  const names = Object.keys(cols);
  return Number(db.db.prepare(`INSERT INTO streamers (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((k) => cols[k])).lastInsertRowid);
}
const count = (table, where = '1', ...params) => db.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params).n;
const messageOf = (res) => new URL(res.headers.location, 'http://x').searchParams.get('msg');

let admin;
beforeEach(() => {
  calls.length = 0;
  logs.length = 0;
  admin = db.getStreamerByDiscordId(ADMIN_DISCORD_ID)?.id || addStreamer({ discord_user_id: ADMIN_DISCORD_ID, discord_username: 'admin' });
});

const FULLY_ON = { overlay_enabled: 1, broadcaster_access_token: 'tok', streamelements_jwt: 'jwt', chatbot_enabled: 1, twitch_username: 'some_streamer' };

describe('Disable', () => {
  test('switches the account off, ends its web sessions and stops its live connections', async () => {
    const target = addStreamer(FULLY_ON);
    const bystander = addStreamer();
    db.createSession('target-session', target, Date.now() + 60_000);
    db.createSession('bystander-session', bystander, Date.now() + 60_000);
    const closed = [];
    bus.once(`overlay-disabled:${target}`, () => closed.push(target));

    const res = await post(`/admin/streamers/${target}/toggle`, admin);

    assert.equal(res.status, 302);
    assert.equal(messageOf(res), 'disabled');
    assert.equal(db.getStreamerById(target).enabled, 0);
    assert.equal(db.getStreamerById(target).admin_note, 'Disabled by admin');
    assert.equal(db.getSession('target-session'), undefined);
    assert.ok(db.getSession('bystander-session'));
    assert.deepEqual(calls.map((c) => c[0]).sort(), ['chat.stop', 'eventsub.stop', 'se.stop', 'sponsors.stop']);
    assert.ok(calls.every((c) => c[1] === target), 'only that streamer\'s connections were touched');
    assert.deepEqual(closed, [target], 'its open overlay streams were told to end');
  });

  test('a disabled account is no longer found by its overlay token', async () => {
    const target = addStreamer({ ...FULLY_ON, overlay_token: 'overlay-token-t1' });
    assert.ok(db.getStreamerByOverlayToken('overlay-token-t1'));
    await post(`/admin/streamers/${target}/toggle`, admin);
    assert.equal(db.getStreamerByOverlayToken('overlay-token-t1'), undefined);
  });

  test('you cannot disable your own account', async () => {
    db.createSession('admin-session', admin, Date.now() + 60_000);
    const res = await post(`/admin/streamers/${admin}/toggle`, admin);
    assert.equal(messageOf(res), 'self_disable');
    assert.equal(db.getStreamerById(admin).enabled, 1);
    assert.ok(db.getSession('admin-session'));
    assert.deepEqual(calls, []);
  });

  test('someone who is not an admin cannot disable anyone', async () => {
    const target = addStreamer();
    const stranger = addStreamer();
    const res = await post(`/admin/streamers/${target}/toggle`, stranger);
    assert.equal(res.headers.location, '/dashboard');
    assert.equal(db.getStreamerById(target).enabled, 1);
    assert.deepEqual(calls, []);
  });

  test('an unknown account is ignored', async () => {
    const res = await post('/admin/streamers/987654/toggle', admin);
    assert.equal(res.headers.location, '/admin/dashboard?tab=users');
    assert.deepEqual(calls, []);
  });
});

describe('Enable', () => {
  test('switches the account back on and restarts what it had on', async () => {
    const target = addStreamer(FULLY_ON);
    await post(`/admin/streamers/${target}/toggle`, admin);
    calls.length = 0;

    const res = await post(`/admin/streamers/${target}/toggle`, admin);

    assert.equal(messageOf(res), 'enabled');
    const row = db.getStreamerById(target);
    assert.equal(row.enabled, 1);
    assert.equal(row.admin_note, null);
    assert.deepEqual(calls.map((c) => c[0]).sort(),
      ['chat.start', 'eventsub.start', 'se.start', 'sponsors.restart', 'sponsors.restartChat']);
  });

  test('restarts only what was on: an account with everything off starts nothing', async () => {
    const target = addStreamer();
    await post(`/admin/streamers/${target}/toggle`, admin);
    calls.length = 0;
    await post(`/admin/streamers/${target}/toggle`, admin);
    assert.deepEqual(calls, []);
  });
});

describe('Remove', () => {
  // The kind of rows that used to make the delete fail on a foreign key.
  function giveChildren(id) {
    const run = (sql, ...params) => db.db.prepare(sql).run(...params);
    run('INSERT INTO chat_commands (streamer_id, command, response) VALUES (?, ?, ?)', id, '!hi', 'hello');
    const giveaway = Number(run('INSERT INTO giveaways (streamer_id, keyword) VALUES (?, ?)', id, '!win').lastInsertRowid);
    run('INSERT INTO giveaway_entries (giveaway_id, twitch_user_id, username) VALUES (?, ?, ?)', giveaway, 't1', 'viewer');
    run('INSERT INTO sponsor_images (streamer_id, filename) VALUES (?, ?)', id, 'a.png');
    run('INSERT INTO tip_goals (streamer_id, title, target_amount) VALUES (?, ?, ?)', id, 'Goal', 100);
    run('INSERT INTO vtuber_models (streamer_id, name, category, filename) VALUES (?, ?, ?, ?)', id, 'm', 'c', 'm.vrm');
    run('INSERT INTO guilds (guild_id, streamer_id) VALUES (?, ?)', `80000000000000${id}`, id);
    run('INSERT INTO donations (streamer_id, source, amount) VALUES (?, ?, ?)', id, 'paypal', 5);
    db.createSession(`session-${id}`, id, Date.now() + 60_000);
  }

  test('removes an active account and all its data instead of failing with a server error', async () => {
    const target = addStreamer(FULLY_ON);
    const other = addStreamer();
    giveChildren(target);
    giveChildren(other);

    const res = await post(`/admin/streamers/${target}/remove`, admin);

    assert.equal(res.status, 302, 'not a 500 page');
    assert.equal(messageOf(res), 'removed');
    assert.equal(db.getStreamerById(target), undefined);
    for (const table of ['chat_commands', 'giveaways', 'sponsor_images', 'tip_goals', 'vtuber_models', 'guilds', 'donations']) {
      assert.equal(count(table, 'streamer_id = ?', target), 0, table);
      assert.equal(count(table, 'streamer_id = ?', other), 1, `${table} of another streamer`);
    }
    assert.equal(db.getSession(`session-${target}`), undefined);
    assert.ok(db.getSession(`session-${other}`));
    assert.equal(count('giveaway_entries'), 1, 'only the other streamer\'s entry is left');
    assert.deepEqual(db.db.pragma('foreign_key_check'), []);
    assert.deepEqual(calls.map((c) => c[0]).sort(), ['chat.stop', 'eventsub.stop', 'se.stop', 'sponsors.stop'], 'its connections were stopped first');
  });

  test('you cannot remove your own account', async () => {
    const res = await post(`/admin/streamers/${admin}/remove`, admin);
    assert.equal(messageOf(res), 'self_remove');
    assert.ok(db.getStreamerById(admin));
    assert.deepEqual(calls, []);
  });

  test('someone who is not an admin cannot remove anyone', async () => {
    const target = addStreamer();
    const stranger = addStreamer();
    const res = await post(`/admin/streamers/${target}/remove`, stranger);
    assert.equal(res.headers.location, '/dashboard');
    assert.ok(db.getStreamerById(target));
  });
});

describe('the issues panel', () => {
  test('has no auto-fix: the route that applied AI patches and pushed a branch is gone', async () => {
    const reporter = addStreamer();
    const issueId = Number(db.createIssue(reporter, 'reporter', 'Overlay is blank', 'It shows nothing'));
    db.updateIssueAnalysis(issueId, JSON.stringify({ summary: 'x', root_cause: 'y', can_fix: true, confidence: 'high', patch: [{ file: 'a.js', old: 'a', new: 'b' }] }), 'done');

    const res = await post(`/admin/issues/${issueId}/fix`, admin);

    assert.equal(res.status, 404);
    assert.equal(db.getIssueById(issueId).status, 'open', 'the issue was not touched');
    assert.deepEqual(calls, []);
  });

  test('replying to an issue still works', async () => {
    const reporter = addStreamer();
    const issueId = Number(db.createIssue(reporter, 'reporter', 'Overlay is blank', 'It shows nothing'));
    const res = await new Promise((resolve, reject) => {
      const body = 'status=resolved&admin_reply=Fixed%20in%20the%20next%20release';
      const req = http.request({ host: '127.0.0.1', port, path: `/admin/issues/${issueId}`, method: 'POST', agent: false, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), 'x-test-streamer': String(admin) } }, (response) => {
        response.resume();
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers }));
      });
      req.on('error', reject);
      req.end(body);
    });
    assert.equal(res.status, 302);
    assert.equal(db.getIssueById(issueId).status, 'resolved');
    assert.equal(db.getIssueById(issueId).admin_reply, 'Fixed in the next release');
  });
});
