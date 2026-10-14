'use strict';

// The account connections a streamer starts from the dashboard (Twitch,
// Twitch broadcaster, YouTube, Spotify) and the viewers' /link, end to end:
// the real src/routes/auth.js on a small Express app, the real src/db.js on an
// in-memory database with TOKEN_ENCRYPTION_KEY set, and a stub for every call
// to Twitch, Google and Spotify. All ids, names, codes and tokens are synthetic.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

// src/config.js exits without the first five; the rest are what these flows read.
for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) {
  process.env[key] = process.env[key] || 'synthetic';
}
process.env.SPOTIFY_CLIENT_ID = 'synthetic-spotify-client';
process.env.SPOTIFY_CLIENT_SECRET = 'synthetic-spotify-secret';
process.env.LINK_SIGNING_SECRET = 'synthetic-link-signing-secret';

const SRC = path.join(__dirname, '..');
const DB_FILE = path.join(SRC, 'db.js');
const AUTH_FILE = path.join(__dirname, 'auth.js');
const TOKEN_KEY = '0123456789abcdef'.repeat(4);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let db;
let server;
let port;
const saved = {};
const logs = [];
const eventSubStarts = [];

// ── Outbound calls ───────────────────────────────────────────────────────
// Each answer is { status, body }; a URL nobody set an answer for fails the test.
let answers = {};
const calls = [];
const timeoutOf = new WeakMap(); // AbortSignal -> ms it was made with

function fakeFetch(url, init = {}) {
  const key = String(url).split('?')[0];
  calls.push({ url: String(url), init });
  const answer = answers[key];
  if (!answer) return Promise.reject(new Error(`unexpected outbound request in a test: ${url}`));
  return Promise.resolve({ ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body });
}

const TWITCH_TOKEN = 'https://id.twitch.tv/oauth2/token';
const TWITCH_VALIDATE = 'https://id.twitch.tv/oauth2/validate';
const TWITCH_USERS = 'https://api.twitch.tv/helix/users';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const YOUTUBE_CHANNELS = 'https://www.googleapis.com/youtube/v3/channels';
const SPOTIFY_TOKEN = 'https://accounts.spotify.com/api/token';

const tokenAnswer = (prefix) => ({ status: 200, body: { access_token: `${prefix}-access`, refresh_token: `${prefix}-refresh`, expires_in: 3600 } });

// ── HTTP ─────────────────────────────────────────────────────────────────

function request(urlPath, { streamer, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (streamer) headers['x-test-streamer'] = String(streamer);
    if (cookie) headers.Cookie = cookie;
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET', agent: false, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end();
  });
}

const setCookies = (res) => res.headers['set-cookie'] || [];
const cookieHeader = (res) => setCookies(res).map((c) => c.split(';')[0]).join('; ');
const stateOf = (res) => new URL(res.headers.location).searchParams.get('state');
const clearsCookie = (res, name) => setCookies(res).some((c) => c.startsWith(`${name}=;`) && /Expires=Thu, 01 Jan 1970/.test(c));

before(async () => {
  saved.load = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    const from = parent && parent.filename;
    if (from === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
      if (request === './config') return { adminDiscordIds: [], tokenEncryption: { key: TOKEN_KEY } };
    }
    if (from === AUTH_FILE && request === '../services/eventsub') {
      return { eventSubManager: { startForStreamer: (id) => eventSubStarts.push(id) } };
    }
    return saved.load(request, parent, isMain);
  };
  for (const level of ['log', 'warn', 'error']) {
    saved[level] = console[level];
    console[level] = (...args) => logs.push([level, args.join(' ')]);
  }
  saved.fetch = global.fetch;
  global.fetch = fakeFetch;
  saved.timeout = AbortSignal.timeout;
  AbortSignal.timeout = (ms) => {
    const signal = saved.timeout.call(AbortSignal, ms);
    timeoutOf.set(signal, ms);
    return signal;
  };

  delete require.cache[DB_FILE];
  delete require.cache[AUTH_FILE];
  db = require(DB_FILE);
  // Production has the YouTube token columns; on a new database their migration
  // runs before the streamers table exists, so only a second boot adds them.
  const streamerColumns = new Set(db.db.pragma('table_info(streamers)').map((c) => c.name));
  for (const [name, type] of [['yt_access_token', 'TEXT'], ['yt_refresh_token', 'TEXT'], ['yt_token_expires_at', 'INTEGER'], ['yt_channel_name', 'TEXT']]) {
    if (!streamerColumns.has(name)) db.db.exec(`ALTER TABLE streamers ADD COLUMN ${name} ${type}`);
  }

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(SRC, 'views'));
  // As server.js.
  app.locals.secureCookie = (res, name, value, opts = {}) => res.cookie(name, value, { httpOnly: true, secure: false, sameSite: 'lax', ...opts });
  app.use(require('cookie-parser')());
  app.use((req, res, next) => {
    // What server.js's session middleware does here: log the header's streamer in.
    const id = Number(req.get('x-test-streamer'));
    req.streamer = id ? db.getStreamerById(id) : undefined;
    next();
  });
  app.use('/auth', require('./auth'));
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = server.address().port;
});

after(async () => {
  global.fetch = saved.fetch;
  AbortSignal.timeout = saved.timeout;
  for (const level of ['log', 'warn', 'error']) console[level] = saved[level];
  Module._load = saved.load;
  await new Promise((resolve) => server.close(resolve));
});

let counter = 0;
function addStreamer(over = {}) {
  const n = ++counter;
  const cols = { discord_user_id: `30000000000000${String(n).padStart(4, '0')}`, discord_username: `streamer${n}`, ...over };
  const names = Object.keys(cols);
  const info = db.db.prepare(`INSERT INTO streamers (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((k) => cols[k]));
  return Number(info.lastInsertRowid);
}
const rawRow = (id) => db.db.prepare('SELECT * FROM streamers WHERE id = ?').get(id);

beforeEach(() => {
  logs.length = 0;
  calls.length = 0;
  eventSubStarts.length = 0;
  answers = {};
});

// Starts the flow as the streamer: the state sent to the provider and the cookie set with it.
async function start(flow, streamer) {
  const res = await request(`/auth/${flow}`, { streamer });
  assert.equal(res.status, 302, `${flow}: ${res.text}`);
  return { res, state: stateOf(res), cookie: cookieHeader(res) };
}

// ── N10: the OAuth state ─────────────────────────────────────────────────

const FLOWS = {
  twitch: {
    authorize: 'https://id.twitch.tv/oauth2/authorize',
    refused: (res) => res.status === 403 && res.text === 'Invalid state',
  },
  broadcaster: {
    authorize: 'https://id.twitch.tv/oauth2/authorize',
    refused: (res) => res.status === 403 && res.text === 'Invalid state',
  },
  youtube: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    refused: (res) => res.status === 302 && res.headers.location === '/dashboard/youtube-chatbot?error=oauth_state',
  },
  spotify: {
    authorize: 'https://accounts.spotify.com/authorize',
    refused: (res) => res.status === 302 && res.headers.location === '/dashboard?msg=spotify_error',
  },
};

describe('the OAuth state of the four connections', () => {
  for (const [flow, { authorize, refused }] of Object.entries(FLOWS)) {
    test(`${flow}: the authorize URL carries a random state, kept in this flow's own short-lived cookie`, async () => {
      const id = addStreamer();
      const first = await start(flow, id);
      const second = await start(flow, id);

      assert.ok(first.res.headers.location.startsWith(`${authorize}?`), first.res.headers.location);
      assert.match(first.state, UUID);
      assert.notEqual(first.state, String(id), 'not the streamer id');
      assert.notEqual(first.state, second.state, 'a new state each time');

      const cookie = setCookies(first.res).find((c) => c.startsWith(`oauth_state_${flow}=`));
      assert.ok(cookie, setCookies(first.res).join(' | '));
      assert.equal(cookie.split(';')[0], `oauth_state_${flow}=${first.state}`);
      assert.match(cookie, /Max-Age=600/);
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /SameSite=Lax/);
    });

    test(`${flow}: a callback without this browser's state for this flow is refused before anything is asked of the provider`, async () => {
      const id = addStreamer({ twitch_user_id: `81${counter}` });
      const mine = await start(flow, id);
      const otherFlow = flow === 'spotify' ? 'twitch' : 'spotify';
      const other = await start(otherFlow, id);
      const callback = (state) => `/auth/${flow}/callback?code=synthetic-code&state=${encodeURIComponent(state)}`;

      const cases = [
        ['the streamer id as the state (the old form), no cookie', callback(String(id)), { streamer: id }],
        ['the right state, but no cookie', callback(mine.state), { streamer: id }],
        ['a cookie of this flow holding another value', callback(mine.state), { streamer: id, cookie: `oauth_state_${flow}=${other.state}` }],
        ['the state and the cookie of another flow', callback(other.state), { streamer: id, cookie: other.cookie }],
        ['the right state and cookie, but nobody logged in', callback(mine.state), { cookie: mine.cookie }],
        ['the right state sent twice', `${callback(mine.state)}&state=${mine.state}`, { streamer: id, cookie: mine.cookie }],
      ];
      for (const [label, url, options] of cases) {
        const res = await request(url, options);
        assert.ok(refused(res), `${label}: ${res.status} ${res.headers.location || res.text}`);
        assert.ok(clearsCookie(res, `oauth_state_${flow}`), `${label}: the cookie is cleared`);
      }
      assert.deepEqual(calls, [], 'nothing was asked of Twitch, Google or Spotify');
      const row = rawRow(id);
      for (const column of ['broadcaster_access_token', 'yt_access_token', 'spotify_access_token']) assert.equal(row[column], null, column);
    });
  }
});

// ── Connecting: tokens go to the logged-in streamer, encrypted at rest ───

describe('connecting an account', () => {
  test('Twitch: the account is linked to the streamer who is logged in, and the cookie is cleared', async () => {
    const id = addStreamer();
    answers[TWITCH_TOKEN] = tokenAnswer('twitch-link');
    answers[TWITCH_USERS] = { status: 200, body: { data: [{ id: '7101', login: 'synthetic_linked', display_name: 'Synthetic_Linked' }] } };
    const { state, cookie } = await start('twitch', id);

    const res = await request(`/auth/twitch/callback?code=synthetic-code&state=${state}`, { streamer: id, cookie });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/dashboard?msg=twitch_linked');
    assert.ok(clearsCookie(res, 'oauth_state_twitch'));
    assert.equal(db.getStreamerById(id).twitch_user_id, '7101');
    assert.equal(calls.length, 2);
    for (const call of calls) assert.equal(timeoutOf.get(call.init.signal), 10_000, call.url);
  });

  test('YouTube: the tokens are stored for the logged-in streamer, encrypted, and both Google calls have a 10 s limit', async () => {
    const id = addStreamer();
    answers[GOOGLE_TOKEN] = tokenAnswer('youtube');
    answers[YOUTUBE_CHANNELS] = { status: 200, body: { items: [{ snippet: { title: 'Synthetic Channel' } }] } };
    const { state, cookie } = await start('youtube', id);

    const res = await request(`/auth/youtube/callback?code=synthetic-code&state=${state}`, { streamer: id, cookie });
    assert.equal(res.headers.location, '/dashboard/youtube-chatbot?connected_yt=1');
    assert.deepEqual(calls.map((c) => c.url.split('?')[0]), [GOOGLE_TOKEN, YOUTUBE_CHANNELS]);
    for (const call of calls) assert.equal(timeoutOf.get(call.init.signal), 10_000, call.url);

    const streamer = db.getStreamerById(id);
    assert.equal(streamer.yt_access_token, 'youtube-access');
    assert.equal(streamer.yt_refresh_token, 'youtube-refresh');
    assert.equal(streamer.yt_channel_name, 'Synthetic Channel');
    const row = rawRow(id);
    assert.match(row.yt_access_token, /^enc:v1:/);
    assert.match(row.yt_refresh_token, /^enc:v1:/);
  });

  test('Spotify: the tokens are stored for the logged-in streamer, encrypted', async () => {
    const id = addStreamer();
    answers[SPOTIFY_TOKEN] = tokenAnswer('spotify');
    const { state, cookie } = await start('spotify', id);

    const res = await request(`/auth/spotify/callback?code=synthetic-code&state=${state}`, { streamer: id, cookie });
    assert.equal(res.headers.location, '/dashboard?msg=spotify_connected');
    assert.equal(calls.length, 1);
    assert.equal(timeoutOf.get(calls[0].init.signal), 10_000);
    assert.equal(db.getStreamerById(id).spotify_refresh_token, 'spotify-refresh');
    assert.match(rawRow(id).spotify_refresh_token, /^enc:v1:/);
  });
});

// ── K-c: the broadcaster token must be the linked channel's own ──────────

describe('broadcaster authorization', () => {
  let channel = 7200;
  const linked = () => {
    channel += 1;
    return { id: addStreamer({ twitch_user_id: String(channel), twitch_username: `synthetic_channel_${channel}`, broadcaster_scopes: 'bits:read' }), twitchId: String(channel) };
  };
  const callback = async (id) => {
    const { state, cookie } = await start('broadcaster', id);
    return request(`/auth/broadcaster/callback?code=synthetic-code&state=${state}`, { streamer: id, cookie });
  };

  test('the linked channel\'s own token is stored (encrypted) with the scopes Twitch granted, and EventSub restarts', async () => {
    const { id, twitchId } = linked();
    answers[TWITCH_TOKEN] = tokenAnswer('broadcaster');
    answers[TWITCH_VALIDATE] = { status: 200, body: { user_id: twitchId, login: 'synthetic_channel', scopes: ['bits:read', 'moderator:read:followers'], expires_in: 3600 } };

    const res = await callback(id);
    assert.equal(res.headers.location, '/dashboard?msg=broadcaster_authorized');
    const validate = calls.find((c) => c.url === TWITCH_VALIDATE);
    assert.equal(validate.init.headers.Authorization, 'OAuth broadcaster-access');
    for (const call of calls) assert.equal(timeoutOf.get(call.init.signal), 10_000, call.url);

    const streamer = db.getStreamerById(id);
    assert.equal(streamer.broadcaster_access_token, 'broadcaster-access');
    assert.equal(streamer.broadcaster_refresh_token, 'broadcaster-refresh');
    assert.equal(streamer.broadcaster_scopes, 'bits:read moderator:read:followers', 'what was granted, not the five asked for');
    assert.match(rawRow(id).broadcaster_refresh_token, /^enc:v1:/);
    assert.deepEqual(eventSubStarts, [id]);
  });

  test('a token of another Twitch account is refused: nothing stored, nothing restarted, and the dashboard says why', async () => {
    const { id } = linked();
    answers[TWITCH_TOKEN] = tokenAnswer('other-account');
    answers[TWITCH_VALIDATE] = { status: 200, body: { user_id: '7299', login: 'synthetic_other', scopes: ['bits:read', 'moderator:read:followers'], expires_in: 3600 } };

    const res = await callback(id);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/dashboard?msg=broadcaster_wrong_account');
    const row = rawRow(id);
    assert.equal(row.broadcaster_access_token, null);
    assert.equal(row.broadcaster_refresh_token, null);
    assert.equal(row.broadcaster_scopes, 'bits:read', 'scopes unchanged');
    assert.deepEqual(eventSubStarts, []);
    const warning = logs.find(([level, line]) => level === 'warn' && line.includes('Broadcaster authorization refused'));
    assert.ok(warning, JSON.stringify(logs));
    assert.ok(!warning[1].includes('other-account-access') && !warning[1].includes('other-account-refresh'), 'no token in the log');
  });

  test('a streamer with no Twitch account linked is refused the same way', async () => {
    const id = addStreamer();
    answers[TWITCH_TOKEN] = tokenAnswer('unlinked');
    answers[TWITCH_VALIDATE] = { status: 200, body: { user_id: '7301', login: 'synthetic_someone', scopes: ['bits:read'], expires_in: 3600 } };

    const res = await callback(id);
    assert.equal(res.headers.location, '/dashboard?msg=broadcaster_wrong_account');
    assert.equal(rawRow(id).broadcaster_access_token, null);
  });

  test('when Twitch does not confirm the token, nothing is stored', async () => {
    const { id } = linked();
    answers[TWITCH_TOKEN] = tokenAnswer('unconfirmed');
    for (const answer of [{ status: 401, body: { status: 401, message: 'invalid access token' } }, { status: 200, body: { login: 'synthetic_channel' } }]) {
      answers[TWITCH_VALIDATE] = answer;
      const res = await callback(id);
      assert.equal(res.status, 500);
      assert.equal(rawRow(id).broadcaster_access_token, null);
    }
    assert.deepEqual(eventSubStarts, []);
  });
});

// ── K-a: /link always shows Twitch's consent screen ──────────────────────

describe('/link', () => {
  test('the Twitch authorize URL asks Twitch to show its consent screen (force_verify), with the state of the link cookie', async () => {
    const { signLink, linkSecret } = require('../services/linkSignature');
    const fields = signLink({ streamerId: 13, discordId: '123456789012345678' }, linkSecret());
    const res = await request(`/auth/link?${new URLSearchParams(fields)}`);
    assert.equal(res.status, 302);
    const target = new URL(res.headers.location);
    assert.equal(`${target.origin}${target.pathname}`, 'https://id.twitch.tv/oauth2/authorize');
    assert.equal(target.searchParams.get('force_verify'), 'true');
    assert.ok(setCookies(res).some((c) => c.startsWith(`link_state=${target.searchParams.get('state')};`)));
  });
});
