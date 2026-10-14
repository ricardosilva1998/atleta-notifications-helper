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
  hasStreamKeyScope: () => true,
};
// What the relay answers about live/<key>: stats, null (no such path), or an Error.
const relayAnswer = { stats: null };
const relayStub = {
  relaySettings: require('../services/multistreamRelay').relaySettings, // the real one: it only picks fields
  addForwardPaths: record('relay.add', ['twitch']),
  removeForwardPaths: record('relay.remove', undefined),
  getPathStats: async (options) => {
    calls.push(['relay.stats', options.sourceToken, options.signal instanceof AbortSignal]);
    if (relayAnswer.stats instanceof Error) throw relayAnswer.stats;
    return relayAnswer.stats;
  },
  isLive: (stats) => !!stats && stats.available === true,
};
// The session lifecycle (services/multistreamSessions.js) has its own tests;
// here it answers what each test sets.
const session = { goLive: { status: 'ok', forwarding: ['twitch', 'youtube'], added: ['twitch', 'youtube'], failed: [], relayFailed: false } };
const sessionsStub = {
  STOP_GRACE_MS: 60_000,
  sessions: () => ({
    goLive: async (key) => {
      calls.push(['sessions.goLive', key]);
      if (session.goLive instanceof Error) throw session.goLive;
      return session.goLive;
    },
    streamEnded: (key) => { calls.push(['sessions.streamEnded', key]); },
    keyReplaced: async (key, streamerId) => {
      calls.push(['sessions.keyReplaced', key, streamerId]);
      if (session.keyReplaced) await session.keyReplaced; // a test holds the clean-up open
    },
  }),
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
      if (request === '../services/multistreamRelay') return relayStub;
      if (request === '../services/multistreamSessions') return sessionsStub;
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
  const { t, esc, richFor } = require('../i18n');
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
    res.locals.esc = esc; // as server.js: the views print their sentences with rich() and escape their data with esc()
    res.locals.rich = richFor(res.locals.t);
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
// MediaMTX's auth request: the secret is the password of the address it posts to.
const basic = (user, pass) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
const relayAuth = (body, authorization = basic('mediamtx', WEBHOOK_SECRET)) => request('POST', '/api/multistream/auth', {
  body,
  headers: authorization ? { Authorization: authorization } : {},
});

beforeEach(() => {
  calls.length = 0;
  logs.length = 0;
  relayAnswer.stats = null;
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
    const auth = await relayAuth({ action: 'publish', path: `live/${token}`, ip: '203.0.113.7' });
    assert.equal(auth.status, 404, 'the relay is told no for every publish');
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

// ── The relay's authentication requests (MS3) ────────────────────────────

describe('POST /api/multistream/auth (MediaMTX authMethod: http)', () => {
  beforeEach(() => relayConfigured(true));
  const KEY = 'tok-auth-on-00000000000000';

  test('a publish with the key of an enabled account that has multistream on is allowed (2xx)', async () => {
    addStreamer({ multistream_enabled: 1, multistream_token: KEY });
    const res = await relayAuth({ action: 'publish', path: `live/${KEY}`, ip: '203.0.113.7', protocol: 'rtmp', user: '', password: '', query: '' });
    assert.equal(res.status, 200);
  });

  test('a publish is refused for an unknown key, a disabled account, or multistream switched off', async () => {
    addStreamer({ multistream_enabled: 1, multistream_token: 'tok-auth-disabled-00000000', enabled: 0 });
    addStreamer({ multistream_enabled: 0, multistream_token: 'tok-auth-off-0000000000000' });
    for (const key of ['tok-auth-unknown-000000000', 'tok-auth-disabled-00000000', 'tok-auth-off-0000000000000']) {
      const res = await relayAuth({ action: 'publish', path: `live/${key}`, ip: '203.0.113.7' });
      assert.equal(res.status, 401, key);
    }
  });

  test('reads are allowed from the relay itself only, and the API only with the relay API login', async () => {
    assert.equal((await relayAuth({ action: 'read', path: `live/${KEY}`, ip: '127.0.0.1' })).status, 200);
    assert.equal((await relayAuth({ action: 'read', path: `live/${KEY}`, ip: '203.0.113.7' })).status, 401);
    assert.equal((await relayAuth({ action: 'api', user: 'admin', password: RELAY_SETTINGS.apiToken, ip: '127.0.0.1' })).status, 200);
    assert.equal((await relayAuth({ action: 'api', user: 'admin', password: 'wrong', ip: '127.0.0.1' })).status, 401);
    assert.equal((await relayAuth({ action: 'playback', path: `live/${KEY}`, ip: '127.0.0.1' })).status, 401);
  });

  test('only the relay may ask: without MEDIAMTX_WEBHOOK_SECRET (as Basic password or Bearer) the answer is 401', async () => {
    addStreamer({ multistream_enabled: 1, multistream_token: 'tok-auth-caller-0000000000' });
    const publish = { action: 'publish', path: 'live/tok-auth-caller-0000000000', ip: '203.0.113.7' };
    assert.equal((await relayAuth(publish, null)).status, 401);
    assert.equal((await relayAuth(publish, basic('mediamtx', 'wrong-secret'))).status, 401);
    assert.equal((await relayAuth(publish, `Bearer ${WEBHOOK_SECRET}x`)).status, 401);
    assert.equal((await relayAuth(publish, `Bearer ${WEBHOOK_SECRET}`)).status, 200);
  });

  test('the webhooks take the same secret, and refuse a path that is not live/<key>', async () => {
    const res = await request('POST', '/api/multistream/webhook/on-ready', { body: { path: `live/${KEY}` }, headers: { Authorization: 'Bearer wrong' } });
    assert.equal(res.status, 401);
    const notAKey = await hook('on-ready', `fwd_${KEY}_twitch`);
    assert.equal(notAKey.status, 400);
    assert.deepEqual(calls, []);
  });
});

// ── The relay's webhooks (MS4, MS5) ─────────────────────────────────────

describe('the webhooks', () => {
  beforeEach(() => relayConfigured(true));
  afterEach(() => {
    session.goLive = { status: 'ok', forwarding: ['twitch', 'youtube'], added: ['twitch', 'youtube'], failed: [], relayFailed: false };
  });
  const KEY = 'tok-webhook-key-0000000000';

  test('on-ready sets the stream up and says where it goes', async () => {
    const res = await hook('on-ready', `live/${KEY}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { ok: true, forwarded: true, destinations: ['twitch', 'youtube'], failed: [] });
    assert.deepEqual(calls, [['sessions.goLive', KEY]]);
  });

  test('on-ready: an unknown key (or a disabled account) is 404, multistream switched off is not forwarded', async () => {
    session.goLive = { status: 'unknown' };
    assert.equal((await hook('on-ready', `live/${KEY}`)).status, 404);
    session.goLive = { status: 'off' };
    const off = await hook('on-ready', `live/${KEY}`);
    assert.equal(off.status, 200);
    assert.equal(off.json().forwarded, false);
  });

  test('on-ready answers 502 when the relay failed, so the relay\'s curl tries again', async () => {
    session.goLive = { status: 'ok', forwarding: ['twitch'], added: ['twitch'], failed: ['relay: Relay add (youtube) failed: 500'], relayFailed: true };
    const partial = await hook('on-ready', `live/${KEY}`);
    assert.equal(partial.status, 502);
    assert.deepEqual(partial.json().destinations, ['twitch']);
    session.goLive = new Error('fetch failed');
    const down = await hook('on-ready', `live/${KEY}`);
    assert.equal(down.status, 502);
    assert.ok(logs.some(([level, line]) => level === 'error' && /\[multistream on-ready\] fetch failed/.test(line)));
  });

  test('a platform that failed (not the relay) is reported, and not retried by the relay', async () => {
    session.goLive = { status: 'ok', forwarding: ['twitch'], added: ['twitch'], failed: ['youtube: YouTube not connected'], relayFailed: false };
    const res = await hook('on-ready', `live/${KEY}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json().failed, ['youtube: YouTube not connected']);
  });

  test('on-not-ready starts the minute\'s wait before the stop', async () => {
    const res = await hook('on-not-ready', `live/${KEY}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { ok: true, stopsInSeconds: 60 });
    assert.deepEqual(calls, [['sessions.streamEnded', KEY]]);
  });
});

// ── The settings page: live state, saving, a new key (MS12, MS13) ─────────

describe('the settings page', () => {
  beforeEach(() => relayConfigured(true));
  const page = (id) => request('GET', '/dashboard/multistream', { streamer: id, json: true }).then((res) => res.json().locals);

  test('says "live" from the relay\'s own view of the stream, asked with a short deadline', async () => {
    const id = addStreamer({ multistream_active_broadcast_id: 'yt-broadcast-left-over' });
    const key = db.ensureMultistreamToken(id);
    relayAnswer.stats = { name: `live/${key}`, available: true };
    let locals = await page(id);
    assert.equal(locals.isLive, true);
    assert.equal(locals.liveUnknown, false);
    assert.deepEqual(calls, [['relay.stats', key, true]]);

    relayAnswer.stats = null; // the relay has no stream there, whatever the stored broadcast says
    locals = await page(id);
    assert.equal(locals.isLive, false);
    assert.equal(locals.liveUnknown, false);

    relayAnswer.stats = new Error('The operation was aborted due to timeout');
    locals = await page(id);
    assert.equal(locals.isLive, false);
    assert.equal(locals.liveUnknown, true);
    assert.ok(logs.some(([level, line]) => level === 'warn' && line.includes(`streamer ${id} is live`) && !line.includes(key)), 'logged, without the key');
  });

  test('saving keeps only the categories and privacy settings the page offers, and the title as YouTube will take it', async () => {
    const id = addStreamer();
    const save = (form) => request('POST', '/dashboard/multistream/save', { streamer: id, form });
    await save({ enabled: '1', youtube_privacy: 'unlisted', youtube_category_id: '17', youtube_default_title: '  Race <3 night  ' });
    let row = db.getMultistreamConfig(id);
    assert.deepEqual([row.multistream_enabled, row.multistream_youtube_privacy, row.multistream_youtube_category_id, row.multistream_youtube_default_title],
      [1, 'unlisted', '17', 'Race 3 night']);
    await save({ youtube_privacy: 'friends-only', youtube_category_id: '99', youtube_default_title: '<<>>' });
    row = db.getMultistreamConfig(id);
    assert.deepEqual([row.multistream_enabled, row.multistream_youtube_privacy, row.multistream_youtube_category_id, row.multistream_youtube_default_title],
      [0, 'public', '20', null]);
    await save({ youtube_category_id: '10', youtube_default_title: '🏁'.repeat(150) });
    row = db.getMultistreamConfig(id);
    assert.equal(row.multistream_youtube_category_id, '10');
    assert.equal(Array.from(row.multistream_youtube_default_title).length, 100);
  });

  test('offers exactly the categories that are saved', async () => {
    const { YOUTUBE_CATEGORY_IDS } = require(ROUTES_FILE);
    const id = addStreamer({ yt_access_token: 'synthetic-yt-token' });
    const res = await request('GET', '/dashboard/multistream', { streamer: id });
    assert.equal(res.status, 200);
    const select = res.text.match(/<select name="youtube_category_id"[\s\S]*?<\/select>/);
    assert.ok(select, 'the category list is on the page');
    const offered = [...select[0].matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual([...offered].sort(), [...YOUTUBE_CATEGORY_IDS].sort());
  });

  // The two lines that say which account is connected are built by the page around the names Twitch and YouTube gave.
  test('prints those names as text, whatever they hold', async () => {
    const { esc } = require('../i18n');
    const name = '<img src=x onerror=alert(1)> "double" \'single\' {{b}} $&';
    const id = addStreamer({
      twitch_display_name: name, broadcaster_access_token: 'synthetic-broadcaster-token', broadcaster_scopes: 'channel:read:stream_key',
      yt_access_token: 'synthetic-yt-token', yt_channel_name: name,
    });
    const res = await request('GET', '/dashboard/multistream', { streamer: id });
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes('<img src=x onerror'), 'a name\'s own markup was printed');
    assert.equal(res.text.split(`<strong>${esc(name)}</strong>`).length - 1, 2, 'once for Twitch and once for YouTube, as text');
  });

  test('offers a new stream key, asking first and saying OBS must be updated', async () => {
    const res = await request('GET', '/dashboard/multistream', { streamer: addStreamer() });
    const form = res.text.match(/<form id="regenerate-key-form"[^>]*>/);
    assert.ok(form, 'the form is on the page');
    assert.match(form[0], /action="\/dashboard\/multistream\/regenerate-key"/);
    assert.match(form[0], /data-confirm="[^"]*OBS[^"]*"/);
    assert.match(form[0], /onsubmit="return confirm\(this\.dataset\.confirm\)"/);
    assert.match(res.text, /<button type="submit" form="regenerate-key-form"/);
  });
});

describe('a new stream key (MS12)', () => {
  beforeEach(() => relayConfigured(true));
  const regenerate = (id) => request('POST', '/dashboard/multistream/regenerate-key', { streamer: id });

  test('replaces the key while the streamer is not live; the old key finds nobody, and what it still had on the relay is cleared', async () => {
    const id = addStreamer();
    const old = db.ensureMultistreamToken(id);
    const res = await regenerate(id);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/dashboard/multistream?regenerated=1');
    const fresh = db.getMultistreamConfig(id).multistream_token;
    assert.match(fresh, /^[A-Za-z0-9_-]{32}$/);
    assert.notEqual(fresh, old);
    assert.equal(db.getStreamerByMultistreamToken(old), undefined);
    assert.equal(db.getStreamerByMultistreamToken(fresh).id, id);
    assert.deepEqual(calls, [['relay.stats', old, true], ['sessions.keyReplaced', old, id]]);
  });

  test('shows the new key only once the old one is cleared, so no go-live on the new key overlaps the clean-up', async () => {
    const id = addStreamer();
    const old = db.ensureMultistreamToken(id);
    let release;
    session.keyReplaced = new Promise((resolve) => { release = resolve; });
    let answered = false;
    const pending = regenerate(id).then((res) => { answered = true; return res; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(calls.at(-1), ['sessions.keyReplaced', old, id]);
    assert.equal(answered, false, 'no answer while the old key is being cleared');
    release();
    const res = await pending;
    assert.equal(res.headers.location, '/dashboard/multistream?regenerated=1');
    session.keyReplaced = null;
  });

  test('a clean-up that fails is logged, and the new key is still shown', async () => {
    const id = addStreamer();
    session.keyReplaced = Promise.reject(new Error('Relay delete (twitch) failed: 500'));
    session.keyReplaced.catch(() => {});
    const res = await regenerate(id);
    session.keyReplaced = null;
    assert.equal(res.headers.location, '/dashboard/multistream?regenerated=1');
    assert.ok(logs.some(([level, line]) => level === 'error' && line.includes(`old stream key of streamer ${id}`)));
  });

  test('is refused while the streamer is live, and when the relay cannot say', async () => {
    const id = addStreamer();
    const key = db.ensureMultistreamToken(id);
    relayAnswer.stats = { available: true };
    let res = await regenerate(id);
    assert.equal(res.headers.location, '/dashboard/multistream?error=live');
    relayAnswer.stats = new Error('fetch failed');
    res = await regenerate(id);
    assert.equal(res.headers.location, '/dashboard/multistream?error=relay');
    assert.equal(db.getMultistreamConfig(id).multistream_token, key, 'unchanged');
    assert.deepEqual(calls.filter(([name]) => name === 'sessions.keyReplaced'), []);
  });

  test('the page says what happened', async () => {
    const id = addStreamer();
    const html = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&#34;').replace(/'/g, '&#39;');
    const { t } = require('../i18n');
    for (const [query, key] of [['regenerated=1', 'multistream.regenerate.done'], ['error=live', 'multistream.regenerate.refusedLive'], ['error=relay', 'multistream.regenerate.refusedUnknown']]) {
      const res = await request('GET', `/dashboard/multistream?${query}`, { streamer: id });
      assert.ok(res.text.includes(html(t('en', key))), query);
    }
    const other = await request('GET', '/dashboard/multistream?error=%3Cb%3Eanything%3C%2Fb%3E', { streamer: id });
    assert.ok(!other.text.includes('anything'), 'an error code that is not known shows nothing');
  });

  test('needs a logged-in streamer, and the relay to be configured', async () => {
    const anonymous = await request('POST', '/dashboard/multistream/regenerate-key');
    assert.equal(anonymous.headers.location, '/auth/login');
    relayConfigured(false);
    const id = addStreamer({ multistream_token: 'tok-regen-gated-000000000' });
    const res = await regenerate(id);
    assert.equal(res.headers.location, '/dashboard');
    assert.equal(db.getMultistreamConfig(id).multistream_token, 'tok-regen-gated-000000000');
  });
});
