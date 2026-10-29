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
const LIFECYCLE_FILE = path.join(SRC, 'services', 'accountLifecycle.js');
const TOKEN_KEY = '0123456789abcdef'.repeat(4);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const { t, esc, richFor } = require('../i18n'); // the texts the pages print, and what server.js puts on res.locals for them

let db;
let server;
let port;
const saved = {};
const logs = [];
const eventSubStarts = [];
const rechecks = []; // trackingGoals.recheck: [streamer id, the scopes stored when it was called]
const twitchEvents = []; // what a change of Twitch account stopped, left and joined, in order
let failingManager = null; // a name from twitchEvents that throws instead, to see the redirect survive it

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

function request(urlPath, { streamer, cookie, headers: extra } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...extra };
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

// A form post (the coaching sign-out form).
function postForm(urlPath, fields, { cookie } = {}) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(fields).toString();
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) };
    if (cookie) headers.Cookie = cookie;
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'POST', agent: false, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body);
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
    if (from === AUTH_FILE && request === '../services/trackingGoals') {
      return { recheck: async (id) => { rechecks.push([id, db.getStreamerById(id).broadcaster_scopes]); } };
    }
    // The real accountLifecycle.js runs; only the connection managers it calls are recorded.
    if (from === LIFECYCLE_FILE && request === './eventsub') {
      return { eventSubManager: { stopForStreamer: (id) => manager('eventsub.stop', id) } };
    }
    if (from === LIFECYCLE_FILE && request === './twitchChat') {
      return { chatManager: { partChannel: (name) => manager('chat.part', name), startForStreamer: (id) => manager('chat.start', id) } };
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

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(SRC, 'views'));
  // As server.js.
  app.locals.secureCookie = (res, name, value, opts = {}) => res.cookie(name, value, { httpOnly: true, secure: false, sameSite: 'lax', ...opts });
  app.use(require('cookie-parser')());
  app.use(express.urlencoded({ extended: false })); // the coaching sign-out form
  app.use((req, res, next) => {
    // What server.js's session middleware does here: log the header's streamer in.
    const id = Number(req.get('x-test-streamer'));
    req.streamer = id ? db.getStreamerById(id) : undefined;
    // And t(), in the language of the request. x-show-keys prints each message as its key, to see which one a route sent.
    res.locals.t = req.get('x-show-keys') ? (key) => `[${key}]` : (key, params) => t('en', key, params);
    res.locals.esc = esc; // and esc() and rich() for the pages it renders
    res.locals.rich = richFor(res.locals.t);
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

function manager(name, argument) {
  twitchEvents.push([name, argument]);
  if (failingManager === name) throw new Error(`${name} exploded`);
}

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
  rechecks.length = 0;
  twitchEvents.length = 0;
  failingManager = null;
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
    refused: (res) => res.status === 403 && res.text === t('en', 'auth.error.invalidState'),
  },
  broadcaster: {
    authorize: 'https://id.twitch.tv/oauth2/authorize',
    refused: (res) => res.status === 403 && res.text === t('en', 'auth.error.invalidState'),
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

// ── When a sign-in or a connection stops ─────────────────────────────────

// The visitor reads these in the browser, in the language of the request. Each is asked for by its key (x-show-keys).
describe('a sign-in or connection that stops tells the visitor why, through t()', () => {
  const DISCORD_TOKEN = 'https://discord.com/api/oauth2/token';
  const showKeys = { 'x-show-keys': '1' };
  const says = (res, status, key) => {
    assert.equal(res.status, status, res.text);
    assert.equal(res.text, `[${key}]`);
    assert.match(res.headers['content-type'], /^text\/plain/, 'plain text, so a translation is never read as markup');
  };

  test('Discord login: a callback without this browser\'s state, then a token exchange that fails', async () => {
    says(await request('/auth/login/callback', { headers: showKeys }), 400, 'auth.error.invalidCallback');
    says(await request('/auth/login/callback?code=synthetic-code&state=one', { cookie: 'oauth_state=another', headers: showKeys }), 400, 'auth.error.invalidCallback');
    assert.deepEqual(calls, [], 'nothing was asked of Discord');

    answers[DISCORD_TOKEN] = { status: 400, body: {} };
    says(await request('/auth/login/callback?code=synthetic-code&state=one', { cookie: 'oauth_state=one', headers: showKeys }), 500, 'auth.error.loginFailed');
    assert.deepEqual(calls.map((c) => c.url), [DISCORD_TOKEN]);
  });

  for (const [flow, failed] of [['twitch', 'auth.error.twitchLinkFailed'], ['broadcaster', 'auth.error.authorizationFailed']]) {
    test(`${flow}: no code, no state, and a token exchange that fails`, async () => {
      const id = addStreamer();
      says(await request(`/auth/${flow}/callback`, { streamer: id, headers: showKeys }), 400, 'auth.error.missingParams');
      says(await request(`/auth/${flow}/callback?code=synthetic-code`, { streamer: id, headers: showKeys }), 400, 'auth.error.missingParams');
      says(await request(`/auth/${flow}/callback?code=synthetic-code&state=one`, { streamer: id, headers: showKeys }), 403, 'auth.error.invalidState');
      assert.deepEqual(calls, [], 'nothing was asked of Twitch');

      answers[TWITCH_TOKEN] = { status: 400, body: {} };
      const { state, cookie } = await start(flow, id);
      says(await request(`/auth/${flow}/callback?code=synthetic-code&state=${state}`, { streamer: id, cookie, headers: showKeys }), 500, failed);
    });
  }

  test('Spotify: the server has no client id', async () => {
    const config = require('../config');
    const saved = config.spotify.clientId;
    config.spotify.clientId = '';
    try {
      says(await request('/auth/spotify', { streamer: addStreamer(), headers: showKeys }), 500, 'auth.error.spotifyNotConfigured');
    } finally {
      config.spotify.clientId = saved;
    }
  });

  test('without x-show-keys the visitor reads the English sentence, whole', async () => {
    const res = await request('/auth/twitch/callback', { streamer: addStreamer() });
    assert.equal(res.status, 400);
    assert.equal(res.text, t('en', 'auth.error.missingParams'));
    assert.match(res.text, / /, 'a sentence, not a key');
  });
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

// ── Linking another Twitch account ───────────────────────────────────────

describe('linking a Twitch account to a streamer', () => {
  let twitchId = 7500;
  const authorize = (id) => {
    db.updateStreamerBroadcasterTokens(id, `access-of-${id}`, `refresh-of-${id}`, Date.now() + 3_600_000);
    db.updateBroadcasterScopes(id, 'moderator:read:followers bits:read channel:manage:redemptions');
  };
  // A streamer whose channel is linked and authorized, with the chat bot on unless said otherwise.
  const linkedStreamer = (over = {}) => {
    twitchId += 1;
    const id = addStreamer({ twitch_user_id: String(twitchId), twitch_username: `old_channel_${twitchId}`, twitch_display_name: `Old_Channel_${twitchId}`, chatbot_enabled: 1, ...over });
    authorize(id);
    return { id, twitchId: String(twitchId), login: `old_channel_${twitchId}` };
  };
  const link = async (id, twitchUser) => {
    answers[TWITCH_TOKEN] = tokenAnswer('twitch-link');
    answers[TWITCH_USERS] = { status: 200, body: { data: [twitchUser] } };
    const { state, cookie } = await start('twitch', id);
    return request(`/auth/twitch/callback?code=synthetic-code&state=${state}`, { streamer: id, cookie });
  };
  const authorization = (id) => {
    const row = rawRow(id);
    return [row.broadcaster_access_token, row.broadcaster_refresh_token, row.broadcaster_token_expires_at, row.broadcaster_scopes];
  };
  const NOTHING = [null, null, 0, null];

  test('another account: the old account\'s authorization is cleared, EventSub stops, the bot leaves the old chat and joins the new one', async () => {
    const old = linkedStreamer();
    const res = await link(old.id, { id: '7599', login: 'new_channel', display_name: 'New_Channel' });

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/dashboard?msg=twitch_linked');
    const row = db.getStreamerById(old.id);
    assert.equal(row.twitch_user_id, '7599');
    assert.equal(row.twitch_username, 'new_channel');
    assert.deepEqual(authorization(old.id), NOTHING, 'tokens and scopes are gone, so the dashboard asks for a new authorization');
    assert.deepEqual(twitchEvents, [['eventsub.stop', old.id], ['chat.part', old.login], ['chat.start', old.id]]);
    assert.deepEqual(eventSubStarts, [], 'EventSub is not started with nothing to connect with');
  });

  test('another account, chat bot off: the old chat is left and no new one joined', async () => {
    const old = linkedStreamer({ chatbot_enabled: 0 });
    await link(old.id, { id: '7598', login: 'new_channel', display_name: 'New_Channel' });
    assert.deepEqual(twitchEvents, [['eventsub.stop', old.id], ['chat.part', old.login]]);
  });

  test('the same account again: the names are updated and nothing else happens (authorization kept, EventSub and chat left alone)', async () => {
    const same = linkedStreamer();
    const before = authorization(same.id);
    const res = await link(same.id, { id: same.twitchId, login: 'renamed_channel', display_name: 'Renamed_Channel' });

    assert.equal(res.headers.location, '/dashboard?msg=twitch_linked');
    assert.equal(db.getStreamerById(same.id).twitch_username, 'renamed_channel');
    assert.deepEqual(authorization(same.id), before);
    assert.notDeepEqual(before, NOTHING);
    assert.deepEqual(twitchEvents, []);
    assert.deepEqual(eventSubStarts, []);
  });

  test('a first link: nothing to leave, and the chat bot joins the new channel if it is on', async () => {
    const id = addStreamer({ chatbot_enabled: 1 });
    await link(id, { id: '7597', login: 'first_channel', display_name: 'First_Channel' });
    assert.deepEqual(twitchEvents, [['eventsub.stop', id], ['chat.start', id]]);
  });

  test('taking over an account another streamer had linked: that streamer stops and leaves first, then the new owner joins', async () => {
    const holder = linkedStreamer();
    const taker = addStreamer({ chatbot_enabled: 1 });
    await link(taker, { id: holder.twitchId, login: holder.login, display_name: 'Same_Channel' });

    assert.equal(db.getStreamerById(holder.id).twitch_user_id, null);
    assert.deepEqual(authorization(holder.id), NOTHING, 'the one who lost the account cannot act as it any more');
    assert.equal(db.getStreamerById(taker).twitch_user_id, holder.twitchId);
    assert.deepEqual(twitchEvents, [
      ['eventsub.stop', holder.id], ['chat.part', holder.login],
      ['eventsub.stop', taker], ['chat.start', taker],
    ], 'the old owner leaves before the new one joins, or leaving would undo the join');
  });

  test('a manager that fails does not stop the others, or the redirect', async () => {
    const old = linkedStreamer();
    failingManager = 'eventsub.stop';
    const res = await link(old.id, { id: '7596', login: 'new_channel', display_name: 'New_Channel' });

    assert.equal(res.headers.location, '/dashboard?msg=twitch_linked');
    assert.deepEqual(twitchEvents.map(([name]) => name), ['eventsub.stop', 'chat.part', 'chat.start']);
    assert.equal(db.getStreamerById(old.id).twitch_user_id, '7596');
    assert.ok(logs.some(([level, line]) => level === 'error' && /EventSub stop failed for streamer/.test(line)));
  });

  test('the log says the authorization was cleared and why, without any token', async () => {
    const old = linkedStreamer();
    await link(old.id, { id: '7595', login: 'new_channel', display_name: 'New_Channel' });
    const line = logs.find(([, text]) => text.includes('Twitch account changed'));
    assert.ok(line, JSON.stringify(logs));
    assert.match(line[1], new RegExp(`streamer ${old.id}`));
    assert.ok(!line[1].includes(`access-of-${old.id}`) && !line[1].includes(`refresh-of-${old.id}`));
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

  test('asks for the stream key (channel:read:stream_key) only while multistream is configured', async () => {
    const multistream = require('../config').multistream;
    const saved = multistream.enabled;
    const scopesAskedFor = async () => {
      const { res } = await start('broadcaster', linked().id);
      return new URL(res.headers.location).searchParams.get('scope').split(' ');
    };
    try {
      multistream.enabled = false;
      const off = await scopesAskedFor();
      assert.deepEqual(off, ['channel:read:subscriptions', 'moderator:read:followers', 'bits:read', 'channel:manage:redemptions', 'channel:manage:polls', 'channel:manage:predictions']);
      multistream.enabled = true;
      const on = await scopesAskedFor();
      assert.deepEqual(on, [...off, 'channel:read:stream_key']);
    } finally {
      multistream.enabled = saved;
    }
  });

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
    assert.equal(streamer.broadcaster_scopes, 'bits:read moderator:read:followers', 'what was granted, not what was asked for');
    assert.match(rawRow(id).broadcaster_refresh_token, /^enc:v1:/);
    assert.deepEqual(eventSubStarts, [id]);
    // The follower and sub goals read Twitch again at once, with the new scopes, so "Reconnect Twitch" clears.
    assert.deepEqual(rechecks, [[id, 'bits:read moderator:read:followers']]);
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
    assert.deepEqual(rechecks, [], 'no goal reads Twitch again');
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

  // The page a subscriber lands on names the Twitch account just linked, with the name Twitch gives.
  test('the page prints that name as text, whatever it holds', async () => {
    const { signLink, linkSecret } = require('../services/linkSignature');
    const name = '<img src=x onerror=alert(1)> "double" \'single\' {{b}} $&';
    const id = addStreamer();
    const start = await request(`/auth/link?${new URLSearchParams(signLink({ streamerId: id, discordId: '123456789012345678' }, linkSecret()))}`);
    answers[TWITCH_TOKEN] = tokenAnswer('link');
    answers[TWITCH_USERS] = { status: 200, body: { data: [{ id: '7201', login: 'synthetic_viewer', display_name: name }] } };

    const res = await request(`/auth/link/callback?code=synthetic-code&state=${stateOf(start)}`, { cookie: cookieHeader(start) });
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes('<img src=x onerror'), 'the name\'s own markup was printed');
    assert.ok(res.text.includes(`<strong style="color: var(--accent);">${esc(name)}</strong>`), 'the name is in the sentence, once, as text');
  });
});

// ── Coaching: a viewer's own Discord sign-in, which never makes a streamer ──

describe('the coaching sign-in', () => {
  const DISCORD_AUTHORIZE = 'https://discord.com/oauth2/authorize';
  const DISCORD_TOKEN = 'https://discord.com/api/oauth2/token';
  const DISCORD_ME = 'https://discord.com/api/users/@me';
  const VIEWER = { id: '400000000000000123', username: 'synthetic_viewer', global_name: 'Synthetic Viewer', avatar: 'abc123' };
  const streamerCount = () => db.db.prepare('SELECT COUNT(*) AS n FROM streamers').get().n;
  const cookieValue = (res, name) => {
    const line = setCookies(res).find((c) => c.startsWith(`${name}=`));
    return line ? decodeURIComponent(line.split(';')[0].slice(name.length + 1)) : null;
  };
  // A streamer whose booking page is up: a Twitch login and coaching hours.
  function coachingStreamer(login) {
    const id = addStreamer({ twitch_username: login, twitch_display_name: login });
    db.saveCoachingSettings(id, {
      timeZone: 'Europe/Lisbon', hours: Array.from({ length: 7 }, () => ({ on: true, start: 1080, end: 1320 })), daysOff: [],
      guildId: '123', inviteCode: 'abc', whereText: '', notifyRequests: 1, lang: 'en',
    });
    return id;
  }

  test('a coaching sign-in creates a viewer session and no streamers row, and goes back to the coaching page', async () => {
    coachingStreamer('Coach_One');
    const start = await request('/auth/coaching-signin?for=coach_one');
    assert.equal(start.status, 302, start.text);
    const target = new URL(start.headers.location);
    assert.equal(`${target.origin}${target.pathname}`, DISCORD_AUTHORIZE);
    assert.equal(target.searchParams.get('scope'), 'identify', 'identify only');
    assert.equal(target.searchParams.get('redirect_uri'), `${require('../config').app.url}/auth/login/callback`, 'the redirect Discord already has');
    assert.equal(cookieValue(start, 'oauth_state'), target.searchParams.get('state'));
    assert.equal(cookieValue(start, 'oauth_purpose'), 'coaching:Coach_One', 'the stored login, in its own case');
    assert.ok(setCookies(start).every((c) => /HttpOnly/i.test(c) && /Max-Age=600\b/.test(c)), '10 minutes, out of reach of scripts');

    answers[DISCORD_TOKEN] = { status: 200, body: { access_token: 'synthetic-discord-access' } };
    answers[DISCORD_ME] = { status: 200, body: VIEWER };
    const before = streamerCount();
    const res = await request(`/auth/login/callback?code=synthetic-code&state=${target.searchParams.get('state')}`, { cookie: cookieHeader(start) });
    assert.equal(res.status, 302, res.text);
    assert.equal(res.headers.location, '/coaching/Coach_One');
    assert.equal(streamerCount(), before, 'no streamers row');
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM streamers WHERE discord_user_id = ?').get(VIEWER.id).n, 0);
    assert.ok(!setCookies(res).some((c) => c.startsWith('session=')), 'no streamer session');
    assert.ok(clearsCookie(res, 'oauth_purpose') && clearsCookie(res, 'oauth_state'));

    const sid = cookieValue(res, 'viewer_session');
    assert.match(sid, /^[0-9a-f]{64}$/);
    const line = setCookies(res).find((c) => c.startsWith('viewer_session='));
    assert.match(line, /Max-Age=604800\b/, '7 days');
    assert.match(line, /Path=\//);
    assert.match(line, /HttpOnly/i);
    const session = db.getViewerSession(sid);
    assert.equal(session.discord_user_id, VIEWER.id);
    assert.equal(session.discord_username, VIEWER.username);
    assert.equal(session.discord_display_name, VIEWER.global_name);
    assert.equal(session.discord_avatar, `https://cdn.discordapp.com/avatars/${VIEWER.id}/${VIEWER.avatar}.png`);
    assert.notEqual(session.sid, sid, 'the table holds the hash, not the cookie');
    assert.deepEqual(calls.map((c) => timeoutOf.get(c.init.signal)), [10_000, 10_000], 'both Discord calls have a 10 s limit');
  });

  test('the sign-in is only for a booking page that is up', async () => {
    const disabled = coachingStreamer('coach_off');
    db.db.prepare('UPDATE streamers SET enabled = 0 WHERE id = ?').run(disabled);
    addStreamer({ twitch_username: 'never_coached' });
    for (const login of ['nobody_here', 'coach_off', 'never_coached', 'a/b', '']) {
      const res = await request(`/auth/coaching-signin?for=${encodeURIComponent(login)}`);
      assert.equal(res.status, 404, login);
      assert.equal(res.text, t('en', 'coaching.error.pageUnavailable'));
      assert.deepEqual(setCookies(res), [], `${login}: no cookie`);
    }
  });

  test('a sign-in without the purpose cookie still creates a streamer as before', async () => {
    // A coaching sign-in left half-way: the streamer's own login forgets its purpose.
    const start = await request('/auth/login', { cookie: 'oauth_purpose=coaching%3Acoach_one' });
    assert.equal(start.status, 302);
    assert.ok(clearsCookie(start, 'oauth_purpose'));
    const state = stateOf(start);
    answers[DISCORD_TOKEN] = { status: 200, body: { access_token: 'synthetic-discord-access' } };
    answers[DISCORD_ME] = { status: 200, body: { ...VIEWER, id: '400000000000000456', username: 'new_streamer' } };
    const before = streamerCount();
    const res = await request(`/auth/login/callback?code=synthetic-code&state=${state}`, { cookie: `oauth_state=${state}` });
    assert.equal(res.status, 302, res.text);
    assert.equal(res.headers.location, '/dashboard');
    assert.equal(streamerCount(), before + 1);
    assert.ok(setCookies(res).some((c) => c.startsWith('session=')));
    assert.ok(!setCookies(res).some((c) => c.startsWith('viewer_session=')));
  });

  test('a purpose naming a login with a slash is refused', async () => {
    const before = streamerCount();
    const viewers = db.db.prepare('SELECT COUNT(*) AS n FROM viewer_sessions').get().n;
    for (const purpose of ['coaching:a/b', 'coaching:../dashboard', 'coaching:', 'coaching:x'.padEnd(40, 'y')]) {
      const res = await request('/auth/login/callback?code=synthetic-code&state=one', {
        cookie: `oauth_state=one; oauth_purpose=${encodeURIComponent(purpose)}`, headers: { 'x-show-keys': '1' },
      });
      assert.equal(res.status, 400, purpose);
      assert.equal(res.text, '[auth.error.invalidCallback]');
    }
    assert.deepEqual(calls, [], 'nothing was asked of Discord');
    assert.equal(streamerCount(), before);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM viewer_sessions').get().n, viewers);
  });

  test('signing out deletes the viewer session and goes back to that coaching page', async () => {
    const sid = 'f'.repeat(64);
    db.createViewerSession(sid, { discordUserId: VIEWER.id, username: VIEWER.username }, Date.now() + 3600e3);
    const res = await postForm('/auth/coaching-signout', { for: 'Coach_One' }, { cookie: `viewer_session=${sid}` });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/coaching/Coach_One');
    assert.ok(clearsCookie(res, 'viewer_session'));
    assert.equal(db.getViewerSession(sid), null);

    const odd = await postForm('/auth/coaching-signout', { for: 'https://evil.example/x' });
    assert.equal(odd.headers.location, '/', 'a "for" that is not a login goes home');
  });
});
