'use strict';

// The multistream routers end to end: the real src/routes/multistream.js on a
// small Express app, the real src/db.js on an in-memory SQLite database, and
// stubs for everything that would leave the machine (Twitch, YouTube, the
// relay). All ids, names, keys and secrets are synthetic.

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

// src/config.js exits without these; the values are never used.
for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) {
  process.env[key] = process.env[key] || 'test';
}

const SRC = path.join(__dirname, '..');
const DB_FILE = path.join(SRC, 'db.js');
const ROUTES_FILE = path.join(__dirname, 'multistream.js');

const WEBHOOK_SECRET = 'synthetic-webhook-secret';
const RELAY_SETTINGS = {
  apiUrl: 'http://relay.example.test:9997',
  ingestUrl: 'rtmp://ingest.example.test/live',
  apiToken: 'synthetic-api-token',
  webhookSecret: WEBHOOK_SECRET,
};

// ── Stubs the routes are loaded with ──────────────────────────────────────

const calls = []; // [name, ...args] of every stubbed outbound call
const record = (name, answer) => async (...args) => { calls.push([name, ...args]); return typeof answer === 'function' ? answer(...args) : answer; };
const twitchStub = {
  getStreamKey: record('twitch.getStreamKey', 'live_000000_synthetic'),
  getStream: record('twitch.getStream', null),
  hasStreamKeyScope: () => true,
};
const youtubeBroadcastStub = {
  getOrCreateLiveStream: record('yt.getOrCreateLiveStream', { streamId: 'yt-stream-1', streamKey: 'abcd-efgh-ijkl-mnop' }),
  createBroadcast: record('yt.createBroadcast', 'yt-broadcast-1'),
  bindBroadcastToStream: record('yt.bind', null),
  transitionBroadcast: record('yt.transition', null),
  waitForStreamActive: record('yt.waitForStreamActive', false),
};
const relayStub = {
  addForwardPaths: record('relay.add', ['twitch']),
  removeForwardPaths: record('relay.remove', undefined),
  getPathStats: record('relay.stats', null),
};

// ── App ──────────────────────────────────────────────────────────────────

let db;
let config;
let server;
let port;
const saved = {};
const logs = [];

function request(method, urlPath, { streamer, form, body: jsonBody, headers: extra = {}, json = false } = {}) {
  return new Promise((resolve, reject) => {
    const body = jsonBody !== undefined ? JSON.stringify(jsonBody) : (form ? new URLSearchParams(form).toString() : null);
    const headers = { ...extra };
    if (body) {
      headers['Content-Type'] = jsonBody !== undefined ? 'application/json' : 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    if (streamer) headers['x-test-streamer'] = String(streamer);
    if (json) headers['x-test-render'] = 'json';
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, agent: false, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

before(async () => {
  saved.load = Module._load;
  Module._load = function (request, parent, isMain) {
    const from = parent && parent.filename;
    if (from === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
    }
    if (from === ROUTES_FILE) {
      if (request === '../services/twitch') return twitchStub;
      if (request === '../services/youtubeBroadcast') return youtubeBroadcastStub;
      if (request === '../services/multistreamRelay') return relayStub;
    }
    return saved.load.call(this, request, parent, isMain);
  };
  for (const level of ['log', 'warn', 'error']) {
    saved[level] = console[level];
    console[level] = (...args) => logs.push([level, args.join(' ')]);
  }
  // Nothing here may reach the network: an outbound call nobody stubbed fails loudly.
  saved.fetch = global.fetch;
  global.fetch = async (url) => { throw new Error(`unexpected outbound request in a test: ${url}`); };

  delete require.cache[DB_FILE];
  delete require.cache[ROUTES_FILE];
  db = require(DB_FILE);
  config = require('../config');
  saved.multistream = { ...config.multistream };
  const { t } = require('../i18n');
  const { applyAccountStatus } = require('../services/streamerAccess');
  const { errorHandler } = require('../errorHandler');
  const routes = require(ROUTES_FILE);

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(SRC, 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use((req, res, next) => {
    // What server.js's session middleware does for these tests: log the header's streamer in.
    const id = Number(req.get('x-test-streamer'));
    req.streamer = id ? db.getStreamerById(id) : undefined;
    applyAccountStatus(req);
    res.locals.t = (key, params) => t('en', key, params);
    res.locals.features = { youtube: true };
    res.locals.streamer = req.streamer || null;
    if (req.get('x-test-render') === 'json') res.render = (view, locals) => res.json({ view, locals });
    next();
  });
  // As server.js: each router once.
  app.use('/dashboard/multistream', routes.dashboardRouter);
  app.use('/api/multistream', routes.apiRouter);
  app.use(errorHandler);

  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = server.address().port;
});

after(async () => {
  Object.assign(config.multistream, saved.multistream);
  global.fetch = saved.fetch;
  for (const level of ['log', 'warn', 'error']) console[level] = saved[level];
  Module._load = saved.load;
  await new Promise((resolve) => server.close(resolve));
});

function relayConfigured(on) {
  Object.assign(config.multistream, on ? { ...RELAY_SETTINGS, enabled: true } : { apiUrl: '', ingestUrl: '', apiToken: '', webhookSecret: '', enabled: false });
}

let counter = 0;
function addStreamer(over = {}) {
  const n = ++counter;
  const cols = { discord_user_id: `30000000000000${String(n).padStart(4, '0')}`, discord_username: `streamer${n}`, ...over };
  const names = Object.keys(cols);
  const info = db.db.prepare(`INSERT INTO streamers (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((k) => cols[k]));
  return Number(info.lastInsertRowid);
}
const hook = (name, path) => request('POST', `/api/multistream/webhook/${name}`, {
  body: { path },
  headers: { Authorization: `Bearer ${WEBHOOK_SECRET}` },
});

beforeEach(() => {
  calls.length = 0;
  logs.length = 0;
});
afterEach(() => relayConfigured(false));

// ── The gate (MS6) ───────────────────────────────────────────────────────

describe('while the relay is not configured', () => {
  beforeEach(() => relayConfigured(false));

  test('the settings page sends the streamer back to the dashboard', async () => {
    const id = addStreamer({ multistream_enabled: 1 });
    for (const who of [id, undefined]) {
      const res = await request('GET', '/dashboard/multistream', { streamer: who });
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/dashboard');
    }
  });

  test('its forms change nothing, and the saved settings are kept', async () => {
    const id = addStreamer({ multistream_enabled: 1, multistream_youtube_privacy: 'unlisted', multistream_token: 'tok-gate-kept-0000000000' });
    const save = await request('POST', '/dashboard/multistream/save', { streamer: id, form: { youtube_privacy: 'private' } });
    assert.equal(save.status, 302);
    assert.equal(save.headers.location, '/dashboard');
    const reset = await request('POST', '/dashboard/multistream/reset-youtube-stream', { streamer: id });
    assert.equal(reset.headers.location, '/dashboard');
    const row = db.getMultistreamConfig(id);
    assert.equal(row.multistream_enabled, 1);
    assert.equal(row.multistream_youtube_privacy, 'unlisted');
    assert.equal(row.multistream_token, 'tok-gate-kept-0000000000');
  });

  test('the relay\'s routes answer 404, even with the right secret, and call nothing', async () => {
    const token = 'tok-gate-webhook-00000000';
    addStreamer({ multistream_enabled: 1, multistream_token: token });
    Object.assign(config.multistream, { webhookSecret: WEBHOOK_SECRET }); // a secret alone does not switch the relay on
    for (const name of ['on-ready', 'on-not-ready']) {
      const res = await hook(name, `live/${token}`);
      assert.equal(res.status, 404, name);
    }
    assert.deepEqual(calls, []);
  });
});

describe('once the relay is configured', () => {
  beforeEach(() => relayConfigured(true));

  test('the settings page shows the ingest address and the streamer\'s own key', async () => {
    const id = addStreamer();
    const res = await request('GET', '/dashboard/multistream', { streamer: id, json: true });
    assert.equal(res.status, 200);
    const { view, locals } = res.json();
    assert.equal(view, 'multistream');
    assert.equal(locals.ingestUrl, RELAY_SETTINGS.ingestUrl);
    assert.match(locals.streamKey, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(locals.streamKey, db.getMultistreamConfig(id).multistream_token);
    assert.equal('relayConfigured' in locals, false);

    const page = await request('GET', '/dashboard/multistream', { streamer: id });
    assert.equal(page.status, 200);
    assert.ok(page.text.includes(`value="${RELAY_SETTINGS.ingestUrl}"`));
    assert.ok(!page.text.includes('MULTISTREAM_KEY_SECRET'));
  });

  test('someone who is not logged in is sent to log in, and a disabled account gets the account-disabled page', async () => {
    const anonymous = await request('GET', '/dashboard/multistream');
    assert.equal(anonymous.status, 302);
    assert.equal(anonymous.headers.location, '/auth/login');
    const disabled = await request('GET', '/dashboard/multistream', { streamer: addStreamer({ enabled: 0 }) });
    assert.equal(disabled.status, 403);
    assert.match(disabled.text, /Account disabled/);
  });

  test('the relay\'s webhooks are not served under /dashboard/multistream', async () => {
    const token = 'tok-gate-dashboard-path-0';
    addStreamer({ multistream_enabled: 1, multistream_token: token });
    const res = await request('POST', '/dashboard/multistream/webhook/on-ready', {
      body: { path: `live/${token}` },
      headers: { Authorization: `Bearer ${WEBHOOK_SECRET}` },
    });
    assert.notEqual(res.status, 200);
    assert.deepEqual(calls, []);
  });
});
