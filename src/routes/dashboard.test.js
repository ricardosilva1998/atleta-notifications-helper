'use strict';

// The dashboard router end to end: the real src/routes/dashboard.js on a small
// Express app, the real src/db.js on an in-memory SQLite database, and stubs for
// everything that would leave the machine (Discord, Twitch, the connection
// managers). All ids, names and tokens are synthetic.

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');
const { Collection, PermissionFlagsBits } = require('discord.js');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');
const { DEFAULT_DURATION_SECONDS } = require('../services/overlaySettings');

// src/config.js exits without these; the values are never used.
for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) {
  process.env[key] = process.env[key] || 'test';
}

// The overlay pages, cards and links are hidden while config.features.overlays is off. These tests cover
// those pages, so the switch is on for the file whatever config.js ships; its sections turn it off.
require('../config').features.overlays = true;
// The same for YouTube and Kick (config.features.youtube and .kick, off by default): on for the file, so the
// tests of the YouTube pages and tabs keep covering them; the sections at the end turn them off.
require('../config').features.youtube = true;
require('../config').features.kick = true;
// The VTuber tab (config.features.vtuber, off by default) is on for the file too; its section turns it off.
require('../config').features.vtuber = true;

const SRC = path.join(__dirname, '..');
const DB_FILE = path.join(SRC, 'db.js');
const DASHBOARD_FILE = path.join(__dirname, 'dashboard.js');
const PAGE_LOOKUPS_FILE = path.join(SRC, 'services', 'pageLookups.js');

// ── Stubs the dashboard router is loaded with ────────────────────────────

const CH_LIVE = '500000000000000001';
const CH_CLIPS = '500000000000000002';

const guilds = new Map(); // id -> fake discord.js Guild
const twitch = { users: {}, lookups: [], failWith: null, beforeAnswer: null, stream: null, videos: [], hang: false, calls: [] };
// Rejects when the call's own signal aborts, like a fetch that was given a deadline.
const untilAborted = (options) => new Promise((_resolve, reject) => {
  const signal = options && options.signal;
  if (!signal) return;
  if (signal.aborted) return reject(signal.reason);
  signal.addEventListener('abort', () => reject(signal.reason), { once: true });
});
const managerCalls = [];

const discordStub = {
  client: { guilds: { cache: guilds }, application: { id: '1480000000000000000' } },
  // A saved channel id counts only if it is one of the two channels below.
  fetchGuildChannel: async (guildId, channelId) => ((channelId === CH_LIVE || channelId === CH_CLIPS) ? { id: channelId, guildId } : null),
  streamerGuildForChannel: () => null,
};
const twitchStub = {
  getStream: async (login, options) => { twitch.calls.push(['getStream', login]); return twitch.hang ? untilAborted(options) : twitch.stream; },
  getUserId: async (login, options) => { twitch.calls.push(['getUserId', login]); return twitch.hang ? untilAborted(options) : '4242'; },
  getVideos: async (id, _since, options) => { twitch.calls.push(['getVideos', id]); return twitch.hang ? untilAborted(options) : twitch.videos; },
  getUserProfile: async (login) => {
    twitch.lookups.push(login);
    if (twitch.beforeAnswer) await twitch.beforeAnswer(login);
    if (twitch.failWith) throw new Error(twitch.failWith);
    return twitch.users[login] || null;
  },
  hasRedemptionScope: () => true,
  needsBroadcasterReauth: () => false,
};
// What the stubbed YouTube API answers; the tests set these.
const youtubeApi = { refreshed: null, broadcast: null, fail: null, botToken: null, sent: [], channelInfo: null, infoCalls: [] };
const youtubeStub = {
  resolveChannelId: async () => null,
  getLatestVideos: async () => [],
  getChannelInfo: async (channelId) => { youtubeApi.infoCalls.push(channelId); return youtubeApi.channelInfo; },
  refreshStreamerYoutubeToken: async () => youtubeApi.refreshed,
  getActiveBroadcast: async () => {
    if (youtubeApi.fail) throw new Error(youtubeApi.fail);
    return youtubeApi.broadcast;
  },
  refreshYoutubeBotToken: async () => youtubeApi.botToken,
  sendYoutubeChatMessage: async (...args) => { youtubeApi.sent.push(args); },
};
const chatCalls = [];
const chatStub = {
  chatManager: {
    isConnected: () => false,
    sendEventMessage: (...args) => chatCalls.push(['event', ...args]),
    sendMessage: (...args) => chatCalls.push(['say', ...args]),
    startForStreamer: (...args) => managerCalls.push(['chat.start', ...args]),
    stopForStreamer: (...args) => managerCalls.push(['chat.stop', ...args]),
    moderatorStatus: () => null,
    recheckModerator: async (id) => { chatCalls.push(['recheck', id]); return true; },
  },
};
// The real one starts a polling interval when it loads.
// The AI analysis would call the Anthropic API; this records which issues it was asked for.
const analyses = [];
const agentTriageStub = {
  analyzeIssue: async (issueId) => {
    analyses.push(issueId);
    if (agentTriageStub.failWith) throw new Error(agentTriageStub.failWith);
  },
  failWith: null,
};
const ytPolling = new Set(); // streamer ids whose live chat is being polled
const youtubeChatStub = {
  youtubeChatManager: {
    isPolling: (id) => ytPolling.has(id),
    getLiveChatId: () => 'live-chat-1',
    startPolling: (...args) => managerCalls.push(['yt.start', ...args]),
    stopPolling: (...args) => managerCalls.push(['yt.stop', ...args]),
  },
};
const record = (name) => (...args) => managerCalls.push([name, ...args]);
const eventSubStub = { eventSubManager: { startForStreamer: record('eventsub.start'), stopForStreamer: record('eventsub.stop') } };
const streamElementsStub = { streamElementsManager: { startForStreamer: record('se.start'), stopForStreamer: record('se.stop') } };
// The sponsor rotations a save starts or stops are recorded apart from the connections (the real manager starts timers).
const sponsorCalls = [];
const timedNotificationsStub = {
  timedNotificationManager: {
    restartForStreamer: (id) => sponsorCalls.push(['sponsors.restart', id]),
    restartChatForStreamer: (id) => sponsorCalls.push(['sponsors.restartChat', id]),
    stopForStreamer: (id) => sponsorCalls.push(['sponsors.stop', id]),
  },
};

// The uploads and deletes the routes make go here, not onto the disk: tests
// must never write into the repo's data/ folder.
const fileWrites = [];
const fileRemovals = [];
const fakeFs = {
  ...realFs,
  promises: {
    ...realFs.promises,
    mkdir: async () => {},
    writeFile: async (file, data) => { fileWrites.push({ file, bytes: data.length }); },
    unlink: async (file) => { fileRemovals.push(file); },
  },
  unlinkSync: (file) => { fileRemovals.push(file); },
  rmSync: (file) => { fileRemovals.push(file); },
};

function fakeGuild(id, { manage = [], never = false } = {}) {
  const fetches = [];
  const gates = [];
  const guild = {
    id,
    name: `Server ${id}`,
    iconURL: () => null,
    fetches,
    gates,
    channels: {
      cache: new Collection([
        [CH_LIVE, { id: CH_LIVE, type: 0, name: 'live' }],
        [CH_CLIPS, { id: CH_CLIPS, type: 0, name: 'clips' }],
      ]),
    },
    roles: { cache: new Collection() },
    members: {
      me: { roles: { highest: { position: 10 } } },
      // With guild.hold set, each call waits on its own gate, so a test decides
      // when Discord "answers".
      fetch(arg) {
        const userId = typeof arg === 'string' ? arg : arg.user;
        fetches.push(userId);
        if (never) return new Promise(() => {});
        return new Promise((resolve, reject) => {
          const answer = () => (manage.includes(userId)
            ? resolve({ permissions: { has: (flag) => (PermissionFlagsBits.ManageGuild & flag) === flag } })
            : reject(Object.assign(new Error('Unknown Member'), { code: 10007 })));
          gates.push(answer);
          if (!guild.hold) answer();
        });
      },
    },
  };
  return guild;
}

// ── App ──────────────────────────────────────────────────────────────────

let db;
let server;
let port;
let t;
let esc;
let richFor;
const logs = [];
const saved = {};
const CSRF_SECRET = 'synthetic-csrf-secret';

// `body` is sent as JSON; `contentType` overrides the type of a raw or form body
// (the upload routes read the raw bytes, so those use application/octet-stream).
// A POST, PUT, PATCH or DELETE says it comes from this site's own page, as a
// browser's does (`origin` names another one, or false sends none); `csrf` is
// sent as the X-CSRF-Token header and `fetchMode` as Sec-Fetch-Mode. `admin` renders the page as an admin's.
function request(method, urlPath, { streamer, form, rawBody, body: jsonBody, contentType, json = false, cookie, origin = 'self', csrf, fetchMode, admin = false } = {}) {
  return new Promise((resolve, reject) => {
    const body = rawBody
      || (jsonBody !== undefined ? JSON.stringify(jsonBody) : null)
      || (form ? new URLSearchParams(form).toString() : null);
    const type = contentType || (jsonBody !== undefined ? 'application/json' : 'application/x-www-form-urlencoded');
    const headers = body ? { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) } : {};
    if (streamer) headers['x-test-streamer'] = String(streamer);
    if (json) headers['x-test-render'] = 'json';
    if (admin) headers['x-test-admin'] = '1';
    if (cookie) headers.Cookie = cookie;
    if (origin && !['GET', 'HEAD'].includes(method)) headers.Origin = origin === 'self' ? `http://127.0.0.1:${port}` : origin;
    if (csrf) headers['X-CSRF-Token'] = csrf;
    if (fetchMode) headers['Sec-Fetch-Mode'] = fetchMode;
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
  saved.load = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    const from = parent && parent.filename;
    if (from === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
    }
    // The page lookups load Twitch and YouTube themselves.
    if (from === PAGE_LOOKUPS_FILE) {
      if (request === './twitch') return twitchStub;
      if (request === './youtube') return youtubeStub;
    }
    if (from === DASHBOARD_FILE) {
      if (request === 'fs') return fakeFs;
      if (request === '../discord') return discordStub;
      if (request === '../services/twitch') return twitchStub;
      if (request === '../services/youtube') return youtubeStub;
      if (request === '../services/twitchChat') return chatStub;
      if (request === '../services/youtubeLiveChat') return youtubeChatStub;
      if (request === '../services/agentTriage') return agentTriageStub;
      if (request === '../services/eventsub') return eventSubStub;
      if (request === '../services/streamelements') return streamElementsStub;
      if (request === '../services/timedNotifications') return timedNotificationsStub;
    }
    return saved.load(request, parent, isMain);
  };
  for (const level of ['log', 'warn', 'error']) {
    saved[level] = console[level];
    console[level] = (...args) => logs.push([level, args.join(' ')]);
  }
  // Nothing here may reach the network: an outbound call nobody stubbed fails loudly.
  saved.fetch = global.fetch;
  global.fetch = async (url) => { throw new Error(`unexpected outbound request in a test: ${url}`); };

  delete require.cache[DB_FILE];
  delete require.cache[DASHBOARD_FILE];
  db = require(DB_FILE);
  ({ t, esc, richFor } = require('../i18n'));
  const { applyAccountStatus } = require('../services/streamerAccess');
  const { errorHandler } = require('../errorHandler');

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(SRC, 'views'));
  // As server.js: cookies are read, and set through app.locals.secureCookie (the OAuth state).
  app.locals.secureCookie = (res, name, value, opts = {}) => res.cookie(name, value, { httpOnly: true, sameSite: 'lax', ...opts });
  app.use(require('cookie-parser')());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json({ limit: '10mb' }));
  app.use((req, res, next) => {
    // What server.js's session middleware does for these tests: log the header's
    // streamer in, or the streamer of a real session cookie (the CSRF tests).
    const id = Number(req.get('x-test-streamer'));
    req.streamer = id ? db.getStreamerById(id) : undefined;
    const session = req.cookies.session ? db.getSession(req.cookies.session) : null;
    if (session) {
      req.sessionHash = session.sid;
      req.streamer = db.getStreamerById(session.streamer_id);
    }
    applyAccountStatus(req);
    res.locals.t = (key, params) => t('en', key, params);
    res.locals.lang = 'en'; // as server.js: the language, and the ones the language picker offers
    res.locals.SUPPORTED_LANGS = require('../i18n').SUPPORTED_LANGS;
    res.locals.esc = esc; // as server.js: the views print their sentences with rich() and escape their data with esc()
    res.locals.rich = richFor(res.locals.t);
    res.locals.features = require('../config').features; // as server.js
    res.locals.isAdmin = req.get('x-test-admin') === '1'; // server.js: db.isAdmin()
    res.locals.streamer = req.streamer || null;
    if (req.get('x-test-render') === 'json') res.render = (view, locals) => res.json({ view, locals });
    next();
  });
  // The real CSRF check, where server.js mounts it: after the session, before the routes.
  app.use(require('../csrf').csrfProtection({ appUrl: 'https://atleta.example', secret: CSRF_SECRET }));
  app.use('/dashboard', require('./dashboard'));
  app.use('/auth', require('./auth'));
  app.use('/racing/auth', require('./racing-auth'));
  app.use(errorHandler);

  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = server.address().port;
});

after(async () => {
  global.fetch = saved.fetch;
  for (const level of ['log', 'warn', 'error']) console[level] = saved[level];
  Module._load = saved.load;
  await new Promise((resolve) => server.close(resolve));
});

let counter = 0;
function addStreamer(over = {}) {
  const n = ++counter;
  const cols = { discord_user_id: `20000000000000${String(n).padStart(4, '0')}`, discord_username: `streamer${n}`, ...over };
  const names = Object.keys(cols);
  const info = db.db.prepare(`INSERT INTO streamers (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((k) => cols[k]));
  return Number(info.lastInsertRowid);
}
const discordId = (streamerId) => db.getStreamerById(streamerId).discord_user_id;
const count = (table, where = '1', ...params) => db.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params).n;
const messageOf = (res) => new URL(res.headers.location, 'http://x').searchParams.get('msg');

beforeEach(() => {
  logs.length = 0;
  managerCalls.length = 0;
  sponsorCalls.length = 0;
  fileWrites.length = 0;
  fileRemovals.length = 0;
  chatCalls.length = 0;
  analyses.length = 0;
  agentTriageStub.failWith = null;
  ytPolling.clear();
  Object.assign(youtubeApi, { refreshed: null, broadcast: null, fail: null, botToken: null, sent: [], channelInfo: null, infoCalls: [] });
  guilds.clear();
  twitch.users = {};
  twitch.lookups = [];
  twitch.failWith = null;
  twitch.beforeAnswer = null;
  twitch.stream = null;
  twitch.videos = [];
  twitch.hang = false;
  twitch.calls = [];
});

// ── The disabled-account guard ───────────────────────────────────────────

describe('the dashboard guard', () => {
  test('someone who is not logged in is sent to the login page', async () => {
    const res = await request('GET', '/dashboard/overlay');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/auth/login');
  });

  test('a disabled account gets the account-disabled page, not the dashboard', async () => {
    const id = addStreamer({ enabled: 0 });
    for (const route of ['/dashboard', '/dashboard/overlay', '/dashboard/account', '/dashboard/chatbot']) {
      const res = await request('GET', route, { streamer: id });
      assert.equal(res.status, 403, route);
      assert.match(res.text, /Account disabled/, route);
      assert.match(res.text, /<form method="POST" action="\/auth\/logout"[^>]*><button type="submit"/, route);
    }
  });

  test('a disabled account cannot change anything through a POST either', async () => {
    const id = addStreamer({ enabled: 0, overlay_follow_duration: 5 });
    const res = await request('POST', '/dashboard/overlay', { streamer: id, form: { overlay_follow_duration: '20', overlay_enabled: '1' } });
    assert.equal(res.status, 403);
    const row = db.getStreamerById(id);
    assert.equal(row.overlay_follow_duration, 5);
    assert.equal(row.overlay_enabled, 0);
    assert.deepEqual(managerCalls, []);
  });

  test('enabling the account gives the dashboard back', async () => {
    const id = addStreamer({ enabled: 0 });
    assert.equal((await request('GET', '/dashboard/overlay', { streamer: id, json: true })).status, 403);
    db.enableStreamer(id);
    const res = await request('GET', '/dashboard/overlay', { streamer: id, json: true });
    assert.equal(res.status, 200);
    assert.equal(res.json().view, 'overlay-config');
  });
});

// ── CSRF, with a real logged-in session (M1) ─────────────────────────────

describe('a logged-in streamer\'s changes carry the session\'s CSRF token', () => {
  const html = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&#34;').replace(/'/g, '&#39;');
  let id;
  let sid;
  let cookie;
  beforeEach(() => {
    id = addStreamer({ overlay_enabled: 1, overlay_follow_duration: 5 });
    sid = `synthetic-session-${id}`;
    db.createSession(sid, id, Date.now() + 60_000);
    cookie = `session=${sid}`;
  });

  // The token as a browser gets it: from the page, for public/js/csrf.js.
  async function pageToken(as = cookie) {
    const page = await request('GET', '/dashboard/overlay', { cookie: as });
    assert.equal(page.status, 200);
    return page.text.match(/<script src="\/js\/csrf\.js" data-csrf-token="([A-Za-z0-9_-]+)"><\/script>/)[1];
  }
  const upload = (options) => request('POST', '/dashboard/sponsors/upload?name=Acme&ext=png&dur=30', {
    cookie, rawBody: 'not-really-a-png', contentType: 'application/octet-stream', fetchMode: 'cors', ...options,
  });

  test('the page carries the token HMAC-SHA256(CSRF_SECRET, the stored hash of the session id)', async () => {
    const expected = require('crypto').createHmac('sha256', CSRF_SECRET).update(db.hashSessionId(sid)).digest('base64url');
    assert.equal(await pageToken(), expected);
  });

  test('a settings form sent without it is refused with a page that says to reload, and nothing is saved', async () => {
    const res = await request('POST', '/dashboard/overlay', { cookie, fetchMode: 'navigate', form: { overlay_enabled: '1', overlay_follow_duration: '20' } });
    assert.equal(res.status, 403);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.ok(res.text.includes(html(t('en', 'csrf.refused'))));
    assert.equal(db.getStreamerById(id).overlay_follow_duration, 5);
    assert.deepEqual(managerCalls, []);
    assert.ok(logs.some(([level, line]) => level === 'warn' && line === '[CSRF] Refused POST /dashboard/overlay: no token'));
  });

  test('with the page\'s token in its _csrf field it is saved', async () => {
    const res = await request('POST', '/dashboard/overlay', { cookie, form: { overlay_enabled: '1', overlay_follow_duration: '20', _csrf: await pageToken() } });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/dashboard/overlay');
    assert.equal(db.getStreamerById(id).overlay_follow_duration, 20);
  });

  test('the token is never stored by a route that saves every field it is sent (iRacing overlay settings)', async () => {
    const res = await request('POST', '/dashboard/iracing/overlays/standings', { cookie, form: { enabled: '1', rows: '12', _csrf: await pageToken() } });
    assert.equal(res.status, 302);
    assert.deepEqual(JSON.parse(db.getIracingOverlaySetting(id, 'standings').settings), { rows: '12' });
  });

  test('a raw-body upload without the X-CSRF-Token header is refused with JSON, before anything is written', async () => {
    const res = await upload();
    assert.equal(res.status, 403);
    assert.deepEqual(res.json(), { ok: false, error: t('en', 'csrf.refused') });
    assert.equal(fileWrites.length, 0);
    assert.equal(db.getSponsorImages(id).length, 0);
  });

  test('with the header, the upload is stored', async () => {
    const res = await upload({ csrf: await pageToken() });
    assert.equal(res.status, 200);
    assert.equal(fileWrites.length, 1);
    assert.equal(db.getSponsorImages(id).length, 1);
  });

  test('another session\'s token is refused', async () => {
    const other = addStreamer();
    db.createSession('synthetic-session-other', other, Date.now() + 60_000);
    const theirs = await pageToken('session=synthetic-session-other');
    assert.notEqual(theirs, await pageToken());
    assert.equal((await upload({ csrf: theirs })).status, 403);
    assert.equal(fileWrites.length, 0);
  });

  test('the right token sent from another site is refused', async () => {
    const res = await request('POST', '/dashboard/overlay', { cookie, origin: 'https://elsewhere.example', form: { overlay_enabled: '1', overlay_follow_duration: '20', _csrf: await pageToken() } });
    assert.equal(res.status, 403);
    assert.equal(db.getStreamerById(id).overlay_follow_duration, 5);
  });

  test('logging out takes a POST with the token; a GET logs nobody out', async () => {
    const token = await pageToken();
    const get = await request('GET', '/auth/logout', { cookie });
    assert.equal(get.status, 302);
    assert.equal(get.headers.location, '/');
    assert.ok(db.getSession(sid), 'a GET leaves the session');
    assert.equal((await request('POST', '/auth/logout', { cookie })).status, 403);
    assert.ok(db.getSession(sid), 'a POST without the token leaves it too');

    const res = await request('POST', '/auth/logout', { cookie, form: { _csrf: token } });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/');
    assert.equal(db.getSession(sid), undefined);
    assert.match(res.headers['set-cookie'].join('\n'), /^session=;/m);
  });

  test('the racing logout too; and the password pages its route writes out carry the token', async () => {
    const token = await pageToken();
    const forgot = await request('GET', '/racing/auth/forgot', { cookie });
    assert.ok(forgot.text.includes(`<script src="/js/csrf.js" data-csrf-token="${token}"></script>`));

    const get = await request('GET', '/racing/auth/logout', { cookie });
    assert.equal(get.headers.location, '/racing');
    assert.ok(db.getSession(sid), 'a GET leaves the session');
    assert.equal((await request('POST', '/racing/auth/logout', { cookie })).status, 403);
    const res = await request('POST', '/racing/auth/logout', { cookie, form: { _csrf: token } });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/racing');
    assert.equal(db.getSession(sid), undefined);
  });
});

// ── Adding a Twitch channel (N12, N13) ───────────────────────────────────

describe('adding a Twitch channel', () => {
  const G = '600000000000000001';
  let id;
  beforeEach(() => {
    id = addStreamer();
    db.upsertGuild(G, id, 'Server');
    guilds.set(G, fakeGuild(G)); // the bot sees the server (a channel edit needs it to)
  });
  const add = (name, over = {}) => request('POST', `/dashboard/guild/${G}/channels`, {
    streamer: id, form: { twitch_username: name, live_channel_id: CH_LIVE, clips_channel_id: '', ...over },
  });
  const watched = () => db.getWatchedChannelsForGuild(G, id).map((w) => w.twitch_username);

  test('adds a channel Twitch knows, cleaned up and in lower case', async () => {
    twitch.users.some_streamer = { id: '1', login: 'some_streamer', profile_image_url: 'https://img.test/a.png' };
    const res = await add('https://www.twitch.tv/Some_Streamer?sr=a');
    assert.equal(res.status, 302);
    assert.equal(messageOf(res), 'added');
    assert.deepEqual(watched(), ['some_streamer']);
    assert.deepEqual(twitch.lookups, ['some_streamer']);
    const row = db.getWatchedChannelsForGuild(G, id)[0];
    assert.equal(row.profile_image_url, 'https://img.test/a.png');
    assert.equal(row.live_channel_id, CH_LIVE);
  });

  test('accepts a handle with @ and stray spaces', async () => {
    twitch.users.other_one = { id: '2', login: 'other_one', profile_image_url: null };
    assert.equal(messageOf(await add('  @Other_One \n')), 'added');
    assert.deepEqual(watched(), ['other_one']);
  });

  test('a channel Twitch does not know is refused as not_found, and nothing is added', async () => {
    const res = await add('nobody_by_that_name');
    assert.equal(messageOf(res), 'not_found');
    assert.deepEqual(watched(), []);
    assert.deepEqual(twitch.lookups, ['nobody_by_that_name']);
  });

  test('something that cannot be a Twitch login is refused as not_found without asking Twitch', async () => {
    for (const bad of ['not a channel!', 'x'.repeat(26), 'https://example.com/foo', 'café']) {
      assert.equal(messageOf(await add(bad)), 'not_found', bad);
    }
    assert.deepEqual(twitch.lookups, []);
    assert.deepEqual(watched(), []);
  });

  test('a Twitch failure is reported as twitch_error, not a 500 page, and nothing is added', async () => {
    twitch.failWith = 'Twitch auth failed: 503';
    const res = await add('some_streamer');
    assert.equal(res.status, 302);
    assert.equal(messageOf(res), 'twitch_error');
    assert.deepEqual(watched(), []);
    assert.ok(logs.some(([level, line]) => level === 'error' && /Twitch lookup for some_streamer failed: Twitch auth failed: 503/.test(line)));
  });

  test('the same channel twice says duplicate the second time, and asks Twitch only once', async () => {
    twitch.users.some_streamer = { id: '1', login: 'some_streamer', profile_image_url: null };
    assert.equal(messageOf(await add('some_streamer')), 'added');
    assert.equal(messageOf(await add('Some_Streamer')), 'duplicate');
    assert.deepEqual(watched(), ['some_streamer']);
    assert.deepEqual(twitch.lookups, ['some_streamer']);
  });

  test('a request that adds the same channel while Twitch is being asked loses cleanly with duplicate', async () => {
    twitch.users.some_streamer = { id: '1', login: 'some_streamer', profile_image_url: null };
    twitch.beforeAnswer = async (login) => { db.addWatchedChannel(G, id, login, CH_LIVE, null, true, false, null); };
    const res = await add('some_streamer');
    assert.equal(messageOf(res), 'duplicate');
    assert.equal(count('watched_channels', 'streamer_id = ?', id), 1);
  });

  test('the same channel in another server is a different watcher', async () => {
    const other = '600000000000000002';
    db.upsertGuild(other, id, 'Other');
    twitch.users.some_streamer = { id: '1', login: 'some_streamer', profile_image_url: null };
    db.addWatchedChannel(other, id, 'some_streamer', CH_LIVE, null, true, false, null);
    assert.equal(messageOf(await add('some_streamer')), 'added');
  });

  test('a server can watch up to 25 channels; the 26th is refused with channel_limit', async () => {
    for (let i = 0; i < 25; i++) db.addWatchedChannel(G, id, `channel_${i}`, CH_LIVE, null, true, false, null);
    twitch.users.one_more = { id: '9', login: 'one_more', profile_image_url: null };
    const res = await add('one_more');
    assert.equal(messageOf(res), 'channel_limit');
    assert.equal(watched().length, 25);
    assert.deepEqual(twitch.lookups, [], 'the cap is checked before Twitch is asked');
  });

  test('the 25th channel can still be added', async () => {
    for (let i = 0; i < 24; i++) db.addWatchedChannel(G, id, `channel_${i}`, CH_LIVE, null, true, false, null);
    twitch.users.the_last = { id: '9', login: 'the_last', profile_image_url: null };
    assert.equal(messageOf(await add('the_last')), 'added');
    assert.equal(watched().length, 25);
  });

  test('a server that is already over the cap keeps its channels, and only adding is blocked', async () => {
    for (let i = 0; i < 30; i++) db.addWatchedChannel(G, id, `channel_${i}`, CH_LIVE, null, true, false, null);
    assert.equal(messageOf(await add('one_more')), 'channel_limit');
    assert.equal(watched().length, 30);
    // Editing and removing what is there still works.
    const first = db.getWatchedChannelsForGuild(G, id)[0];
    const edit = await request('POST', `/dashboard/guild/${G}/channels/${first.id}/edit`, { streamer: id, form: { live_channel_id: CH_CLIPS, clips_channel_id: '' } });
    assert.equal(messageOf(edit), 'updated');
    await request('POST', `/dashboard/guild/${G}/channels/${first.id}/remove`, { streamer: id });
    assert.equal(watched().length, 29);
  });

  test('the cap is per server, not per streamer', async () => {
    const other = '600000000000000003';
    db.upsertGuild(other, id, 'Other');
    for (let i = 0; i < 25; i++) db.addWatchedChannel(other, id, `channel_${i}`, CH_LIVE, null, true, false, null);
    twitch.users.some_streamer = { id: '1', login: 'some_streamer', profile_image_url: null };
    assert.equal(messageOf(await add('some_streamer')), 'added');
  });

  test('a missing name or Discord channel is missing_fields, and a channel of another server is invalid_channel', async () => {
    assert.equal(messageOf(await add('')), 'missing_fields');
    assert.equal(messageOf(await add('   ')), 'missing_fields');
    assert.equal(messageOf(await add('some_streamer', { live_channel_id: '' })), 'missing_fields');
    assert.equal(messageOf(await add('some_streamer', { live_channel_id: '999999999999999999' })), 'invalid_channel');
    assert.deepEqual(twitch.lookups, []);
  });

  test('a repeated name field (an array) is not a channel name', async () => {
    const res = await request('POST', `/dashboard/guild/${G}/channels`, {
      streamer: id, rawBody: `twitch_username=a&twitch_username=b&live_channel_id=${CH_LIVE}`,
    });
    assert.equal(messageOf(res), 'missing_fields');
    assert.deepEqual(watched(), []);
    assert.deepEqual(twitch.lookups, []);
  });

  test("another streamer's server is not reachable", async () => {
    const stranger = addStreamer();
    const res = await request('POST', `/dashboard/guild/${G}/channels`, { streamer: stranger, form: { twitch_username: 'x', live_channel_id: CH_LIVE } });
    assert.equal(res.headers.location, '/dashboard');
  });
});

describe('the server page says what happened when a channel is added', () => {
  const G = '600000000000000010';
  let id;
  beforeEach(() => {
    id = addStreamer();
    db.upsertGuild(G, id, 'Server');
    guilds.set(G, fakeGuild(G));
  });
  const page = (msg) => request('GET', `/dashboard/guild/${G}?tab=twitch&msg=${msg}`, { streamer: id });
  const escaped = (text) => text.replace(/'/g, '&#39;');

  test('every outcome has its own message, and none talks about a plan or upgrading', async () => {
    const expected = {
      not_found: t('en', 'guild.channelNotFound'),
      twitch_error: t('en', 'guild.twitchError'),
      duplicate: t('en', 'guild.channelDuplicate'),
      channel_limit: t('en', 'guild.channelCapReached', { max: 25 }),
    };
    for (const [msg, text] of Object.entries(expected)) {
      const res = await page(msg);
      assert.equal(res.status, 200, msg);
      assert.ok(res.text.includes(escaped(text)), `${msg}: ${text}`);
      assert.doesNotMatch(res.text, /Starter plan|your plan|\/pricing/, msg);
    }
  });

  test('the old tier messages are gone from the page, and so are the iRacing driver forms', async () => {
    for (const msg of ['upgrade_clips', 'upgrade_youtube', 'upgrade_social', 'social_limit', 'upgrade_iracing', 'iracing_limit']) {
      const res = await page(msg);
      assert.equal(res.status, 200);
      assert.doesNotMatch(res.text, /Starter plan|limit for your plan/, msg);
    }
    const res = await page('added');
    assert.doesNotMatch(res.text, /\/iracing\/|customer_id/);
  });

  test('the channel limit message names the configured limit', async () => {
    assert.match((await page('channel_limit')).text, /up to 25 Twitch channels/);
  });
});

// ── Saving the server page while Discord cannot be read ──────────────────

describe('the server page while the bot cannot see the server', () => {
  const G = '600000000000000030';
  const ROLE = '700000000000000005';
  const OTHER_ROLE = '700000000000000006';
  const fakeRole = (roleId, name) => ({ id: roleId, name, guild: { id: G }, managed: false, position: 3, permissions: { bitfield: 0n } });
  let id;

  beforeEach(() => {
    id = addStreamer();
    db.upsertGuild(G, id, 'Server');
    db.updateGuildConfig(G, id, {
      welcome_channel_id: CH_LIVE, sub_role_id: ROLE, welcome_message: 'Hello', welcome_enabled: true, sub_sync_enabled: true,
    });
  });
  // The bot can see the server: its channels and two plain roles are in the cache.
  const seeServer = () => {
    const guild = fakeGuild(G);
    guild.roles.cache.set(ROLE, fakeRole(ROLE, 'Subscribers'));
    guild.roles.cache.set(OTHER_ROLE, fakeRole(OTHER_ROLE, 'Supporters'));
    guilds.set(G, guild);
    return guild;
  };
  const stored = () => db.getGuildConfig(G, id);
  // The form as a page with empty pickers sends it.
  const save = (form = {}) => request('POST', `/dashboard/guild/${G}`, {
    streamer: id, form: { welcome_enabled: 'on', sub_sync_enabled: 'on', welcome_channel_id: '', sub_role_id: '', ...form },
  });
  const notice = (text) => text.includes(t('en', 'guild.listsUnavailable').replace(/'/g, '&#39;'));

  test('a save keeps the welcome channel and the sub role, and saves the other fields', async () => {
    const res = await save({ welcome_message: 'Changed text', recap_enabled: 'on', weekly_highlights_enabled: 'on' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, `/dashboard/guild/${G}?tab=discord&saved=1`);
    const row = stored();
    assert.equal(row.welcome_channel_id, CH_LIVE, 'the welcome channel stays');
    assert.equal(row.sub_role_id, ROLE, 'the sub role stays');
    assert.equal(row.welcome_message, 'Changed text');
    assert.equal(row.recap_enabled, 1);
    assert.equal(row.weekly_highlights_enabled, 1);
    assert.equal(row.milestones_enabled, 0, 'a switch left off is saved off');
    assert.equal(row.welcome_enabled, 1);
    assert.equal(row.sub_sync_enabled, 1);
  });

  test('a channel or role the form names is not taken either: nothing can be checked against Discord', async () => {
    await save({ welcome_channel_id: CH_CLIPS, sub_role_id: OTHER_ROLE });
    assert.equal(stored().welcome_channel_id, CH_LIVE);
    assert.equal(stored().sub_role_id, ROLE);
  });

  test('a server with no welcome channel or role saved stays without', async () => {
    db.updateGuildConfig(G, id, { welcome_enabled: true });
    await save({ welcome_channel_id: CH_CLIPS, sub_role_id: OTHER_ROLE });
    assert.equal(stored().welcome_channel_id, null);
    assert.equal(stored().sub_role_id, null);
  });

  test('a server Discord has marked unavailable counts the same', async () => {
    seeServer().available = false;
    await save({ welcome_message: 'During an outage' });
    assert.equal(stored().welcome_channel_id, CH_LIVE);
    assert.equal(stored().sub_role_id, ROLE);
    assert.equal(stored().welcome_message, 'During an outage');
  });

  test('once the bot sees the server the form decides again: an empty choice switches the setting off', async () => {
    seeServer();
    const res = await save();
    assert.equal(res.headers.location, `/dashboard/guild/${G}?tab=discord&saved=1`);
    assert.equal(stored().welcome_channel_id, null);
    assert.equal(stored().sub_role_id, null);
  });

  test('once the bot sees the server a new choice is saved, and one that is not the server\'s is still refused', async () => {
    seeServer();
    const ok = await save({ welcome_channel_id: CH_CLIPS, sub_role_id: OTHER_ROLE });
    assert.equal(ok.headers.location, `/dashboard/guild/${G}?tab=discord&saved=1`);
    assert.equal(stored().welcome_channel_id, CH_CLIPS);
    assert.equal(stored().sub_role_id, OTHER_ROLE);

    const wrongChannel = await save({ welcome_channel_id: '999999999999999999', sub_role_id: ROLE });
    assert.equal(messageOf(wrongChannel), 'invalid_channel');
    const wrongRole = await save({ welcome_channel_id: CH_LIVE, sub_role_id: '999999999999999999' });
    assert.equal(messageOf(wrongRole), 'invalid_role');
    assert.equal(stored().welcome_channel_id, CH_CLIPS, 'a refused save changes nothing');
    assert.equal(stored().sub_role_id, OTHER_ROLE);
  });

  test('the page says the lists cannot be loaded, and its pickers still show the saved channel and role', async () => {
    const res = await request('GET', `/dashboard/guild/${G}?tab=discord`, { streamer: id });
    assert.equal(res.status, 200);
    assert.ok(notice(res.text), 'the notice is on the page');
    assert.ok(res.text.includes(`<option value="${CH_LIVE}" selected>#${CH_LIVE}</option>`), 'the welcome channel picker');
    assert.ok(res.text.includes(`<option value="${ROLE}" selected>${ROLE}</option>`), 'the sub role picker');
    assert.equal((await request('GET', `/dashboard/guild/${G}`, { streamer: id, json: true })).json().locals.discordListsUnavailable, true);
  });

  test('with the bot in the server the page has no notice and the pickers list the server', async () => {
    seeServer();
    const res = await request('GET', `/dashboard/guild/${G}?tab=discord`, { streamer: id });
    assert.equal(res.status, 200);
    assert.ok(!notice(res.text));
    assert.ok(res.text.includes(`<option value="${CH_LIVE}" selected>#live</option>`));
    assert.ok(!res.text.includes(`>#${CH_LIVE}<`));
    assert.equal((await request('GET', `/dashboard/guild/${G}`, { streamer: id, json: true })).json().locals.discordListsUnavailable, false);
  });

  describe('the edit forms of a watched channel', () => {
    const YT = 'UC0000000000000000000001';
    let twitchRow;
    let youtubeRow;
    beforeEach(() => {
      db.addWatchedChannel(G, id, 'some_channel', CH_LIVE, CH_CLIPS, true, true, null);
      twitchRow = db.getWatchedChannelsForGuild(G, id)[0];
      db.addWatchedYoutubeChannel(G, id, YT, 'Some Channel', CH_LIVE, CH_CLIPS, null);
      youtubeRow = db.getWatchedYoutubeChannelsForGuild(G, id)[0];
    });
    const twitchEdit = (form) => request('POST', `/dashboard/guild/${G}/channels/${twitchRow.id}/edit`, { streamer: id, form });
    const youtubeEdit = (form) => request('POST', `/dashboard/guild/${G}/youtube/${youtubeRow.id}/edit`, { streamer: id, form });

    test('a save from empty pickers does not switch the channels off', async () => {
      const twitch = await twitchEdit({ live_channel_id: '', clips_channel_id: '' });
      assert.equal(twitch.headers.location, `/dashboard/guild/${G}?tab=twitch`);
      const youtube = await youtubeEdit({ videos_channel_id: '', live_channel_id: '' });
      assert.equal(youtube.headers.location, `/dashboard/guild/${G}?tab=youtube`);
      const twitchAfter = db.getWatchedChannelsForGuild(G, id)[0];
      assert.equal(twitchAfter.live_channel_id, CH_LIVE);
      assert.equal(twitchAfter.clips_channel_id, CH_CLIPS);
      const youtubeAfter = db.getWatchedYoutubeChannelsForGuild(G, id)[0];
      assert.equal(youtubeAfter.videos_channel_id, CH_LIVE);
      assert.equal(youtubeAfter.live_channel_id, CH_CLIPS);
    });

    test('with the bot in the server the same save does switch them off', async () => {
      seeServer();
      assert.equal(messageOf(await twitchEdit({ live_channel_id: '', clips_channel_id: '' })), 'updated');
      assert.equal(messageOf(await youtubeEdit({ videos_channel_id: '', live_channel_id: '' })), 'updated');
      assert.equal(db.getWatchedChannelsForGuild(G, id)[0].live_channel_id, null);
      assert.equal(db.getWatchedYoutubeChannelsForGuild(G, id)[0].videos_channel_id, null);
    });
  });
});

describe('the tab named in the server page URL', () => {
  const G = '600000000000000040';
  let id;
  beforeEach(() => {
    id = addStreamer();
    db.upsertGuild(G, id, 'Server');
    guilds.set(G, fakeGuild(G));
  });
  const activeTab = async (query) => (await request('GET', `/dashboard/guild/${G}${query}`, { streamer: id, json: true })).json().locals.activeTab;

  test('a tab of the page is used, and without one the page opens on Twitch', async () => {
    for (const tab of ['twitch', 'youtube', 'discord', 'iracing', 'settings']) assert.equal(await activeTab(`?tab=${tab}`), tab, tab);
    assert.equal(await activeTab(''), 'twitch');
    assert.equal(await activeTab('?tab='), 'twitch');
  });

  test('anything else is the default, so it cannot reach the page\'s script', async () => {
    const odd = ["x'); alert(1); ('", '\n', '\\', "'", '"', 'Twitch', 'twitch ', 'constructor', '__proto__', 'a'.repeat(5000)];
    for (const tab of odd) assert.equal(await activeTab(`?tab=${encodeURIComponent(tab)}`), 'twitch', JSON.stringify(tab.slice(0, 30)));
    assert.equal(await activeTab('?tab=discord&tab=settings'), 'twitch', 'a repeated parameter');
    assert.equal(await activeTab('?tab[x]=discord'), 'twitch', 'a parameter with a key');
  });

  test('the page script holds a tab name from the list and nothing from the URL', async () => {
    const res = await request('GET', `/dashboard/guild/${G}?tab=%0A%5C%27%22%3C`, { streamer: id });
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('const requestedTab = null;'));
    const ok = await request('GET', `/dashboard/guild/${G}?tab=discord`, { streamer: id });
    assert.ok(ok.text.includes('const requestedTab = "discord";'));
    assert.ok(ok.text.includes("switchTab([requestedTab, savedTab].find(onPage) || 'twitch');"));
    assert.ok(ok.text.includes("url.searchParams.delete('tab');"), 'the address forgets the tab once it is used');
  });
});

// ── Removed routes (N25) ─────────────────────────────────────────────────

describe('routes that were removed', () => {
  test('the Instagram, TikTok, Twitter and iRacing watcher routes and the YouTube key route are gone', async () => {
    const G = '600000000000000020';
    const id = addStreamer();
    db.upsertGuild(G, id, 'Server');
    const routes = [
      `/dashboard/guild/${G}/instagram`, `/dashboard/guild/${G}/instagram/1/edit`, `/dashboard/guild/${G}/instagram/1/remove`,
      `/dashboard/guild/${G}/tiktok`, `/dashboard/guild/${G}/tiktok/1/edit`, `/dashboard/guild/${G}/tiktok/1/remove`,
      `/dashboard/guild/${G}/twitter`, `/dashboard/guild/${G}/twitter/1/edit`, `/dashboard/guild/${G}/twitter/1/remove`,
      `/dashboard/guild/${G}/iracing`, `/dashboard/guild/${G}/iracing/1/edit`, `/dashboard/guild/${G}/iracing/1/remove`,
      '/dashboard/account/youtube-api-key',
    ];
    for (const route of routes) {
      const res = await request('POST', route, { streamer: id, form: { youtube_api_key: 'k', instagram_username: 'x', notify_channel_id: CH_LIVE } });
      assert.equal(res.status, 404, route);
    }
    assert.equal(count('watched_instagram_accounts'), 0);
    assert.equal(count('watched_iracing_drivers'), 0);
    assert.equal(db.getStreamerById(id).youtube_api_key, null);
  });

  test('the routes that stay still answer', async () => {
    const id = addStreamer();
    for (const route of ['/dashboard/iracing', '/dashboard/overlay', '/dashboard/donations']) {
      const res = await request('GET', route, { streamer: id, json: true });
      assert.equal(res.status, 200, route);
    }
  });
});

// ── Overlay settings (M5, N18) ───────────────────────────────────────────

describe('the overlay settings page', () => {
  const JWT = 'se.token.value';
  let id;
  beforeEach(() => {
    id = addStreamer({ overlay_enabled: 1, broadcaster_access_token: 'tok', streamelements_jwt: JWT, overlay_giveaway_duration: 8, overlay_raid_duration: 9 });
  });
  const save = (form) => request('POST', '/dashboard/overlay', { streamer: id, form });

  test('never puts the saved StreamElements token in the page, and offers to remove it', async () => {
    const res = await request('GET', '/dashboard/overlay', { streamer: id });
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes(JWT), 'the token is not in the HTML');
    assert.match(res.text, /A StreamElements token is saved/);
    assert.match(res.text, /name="streamelements_jwt_remove"/);
    assert.doesNotMatch(res.text, /name="streamelements_jwt"[^>]*value=/);
  });

  test('without a saved token there is nothing to remove', async () => {
    const other = addStreamer();
    const res = await request('GET', '/dashboard/overlay', { streamer: other });
    assert.doesNotMatch(res.text, /streamelements_jwt_remove/);
    assert.doesNotMatch(res.text, /A StreamElements token is saved/);
  });

  test('shows the giveaway duration in seconds, so the form can be saved', async () => {
    const res = await request('GET', '/dashboard/overlay', { streamer: id });
    assert.match(res.text, /name="overlay_giveaway_duration" value="8" min="1" max="60"/);
    assert.match(res.text, /name="overlay_raid_duration" value="9"/);
  });

  test('a giveaway duration of 0 in the database still renders as a value the form accepts', async () => {
    db.db.prepare('UPDATE streamers SET overlay_giveaway_duration = 0 WHERE id = ?').run(id);
    const res = await request('GET', '/dashboard/overlay', { streamer: id });
    assert.match(res.text, /name="overlay_giveaway_duration" value="1" min="1" max="60"/);
  });

  test('"Clear All Alerts" is a plain button, not a second way to submit the form', async () => {
    const res = await request('GET', '/dashboard/overlay', { streamer: id });
    const button = res.text.match(/<button[^>]*onclick="clearOverlayAlerts\(\)"[^>]*>/)[0];
    assert.match(button, /type="button"/);
  });

  // The page's <div>s, in document order, with the attributes of the ones still open at `needle`.
  // Scripts, styles and comments are blanked out first (their text has "<div" in it).
  function openDivsAt(html, needle) {
    const blank = (m) => m.replace(/[^\n]/g, ' ');
    const clean = html.replace(/<script\b[\s\S]*?<\/script>/gi, blank).replace(/<style\b[\s\S]*?<\/style>/gi, blank).replace(/<!--[\s\S]*?-->/g, blank);
    const at = needle ? clean.indexOf(needle) : clean.length;
    assert.ok(at >= 0, `${needle} is on the page`);
    const open = [];
    let depthLow = 0;
    for (const tag of clean.matchAll(/<(\/?)div\b([^>]*)>/gi)) {
      if (tag.index >= at) break;
      if (!tag[1]) open.push(tag[2]);
      else if (open.length) open.pop();
      else depthLow++;
    }
    return { open, closedMoreThanOpened: depthLow };
  }

  test('every <div> the page opens is closed, so the Kick tab and the StreamElements card are where they belong', async () => {
    const page = (await request('GET', '/dashboard/overlay', { streamer: id })).text;
    const whole = openDivsAt(page);
    assert.equal(whole.closedMoreThanOpened, 0, 'no </div> without a <div>');
    assert.deepEqual(whole.open, [], 'no <div> left open at the end of the page');

    // The Kick tab is a tab of the alerts section, not part of the YouTube one.
    const kick = openDivsAt(page, 'id="alert-tab-kick"').open.slice(0, -1); // minus the tab's own <div>
    assert.ok(kick.some((attributes) => attributes.includes('animate-in-delay-2')), 'the Kick tab is inside the alerts section');
    assert.ok(!kick.some((attributes) => attributes.includes('alert-tab-content')), 'but not inside another tab');

    // The StreamElements card follows the alerts section; it is not inside it.
    const streamElements = openDivsAt(page, 'id="streamelements_jwt"').open;
    assert.ok(!streamElements.some((attributes) => attributes.includes('animate-in-delay-2') || attributes.includes('alert-tab-content')),
      'the StreamElements card is outside the alerts section');
  });

  test('saves the raid and giveaway toggles and durations (they never were)', async () => {
    const res = await save({
      overlay_enabled: '1', overlay_follow_enabled: '1', overlay_sub_enabled: '1', overlay_bits_enabled: '1', overlay_donation_enabled: '1',
      overlay_follow_duration: '5', overlay_sub_duration: '7', overlay_bits_duration: '6', overlay_donation_duration: '6',
      overlay_raid_duration: '12', overlay_giveaway_duration: '20', overlay_volume: '0.4',
      // raid and giveaway switched off: their checkboxes are not sent
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/dashboard/overlay');
    const row = db.getStreamerById(id);
    assert.equal(row.overlay_raid_enabled, 0);
    assert.equal(row.overlay_giveaway_enabled, 0);
    assert.equal(row.overlay_raid_duration, 12);
    assert.equal(row.overlay_giveaway_duration, 20, 'seconds, like every other duration');
    assert.equal(row.overlay_volume, 0.4);
    assert.equal(row.overlay_follow_enabled, 1);
  });

  test('switching raid and giveaway back on is saved too', async () => {
    db.db.prepare('UPDATE streamers SET overlay_raid_enabled = 0, overlay_giveaway_enabled = 0 WHERE id = ?').run(id);
    await save({ overlay_enabled: '1', overlay_raid_enabled: '1', overlay_giveaway_enabled: '1' });
    const row = db.getStreamerById(id);
    assert.equal(row.overlay_raid_enabled, 1);
    assert.equal(row.overlay_giveaway_enabled, 1);
  });

  test('bounds the values on the server, whatever the page said', async () => {
    await save({ overlay_enabled: '1', overlay_follow_duration: '9999', overlay_sub_duration: '0', overlay_giveaway_duration: '500', overlay_raid_duration: 'abc', overlay_volume: '7' });
    const row = db.getStreamerById(id);
    assert.equal(row.overlay_follow_duration, 30);
    assert.equal(row.overlay_sub_duration, 1);
    assert.equal(row.overlay_giveaway_duration, 60);
    assert.equal(row.overlay_raid_duration, 10, 'an unreadable value gets the default');
    assert.equal(row.overlay_volume, 1);
  });

  test('saves the YouTube alerts\' durations and switches the page shows (they never were), and keeps them when a save leaves them out', async () => {
    await save({
      overlay_enabled: '1', yt_overlay_superchat_duration: '20', yt_overlay_member_duration: '4', yt_overlay_giftmember_duration: '45',
      yt_overlay_superchat_enabled: '1', // member and gift member switched off: their boxes are not sent
    });
    let row = db.getStreamerById(id);
    assert.equal(row.yt_overlay_superchat_duration, 20);
    assert.equal(row.yt_overlay_member_duration, 4);
    assert.equal(row.yt_overlay_giftmember_duration, 30, 'held to 30 s like the Twitch alerts');
    assert.equal(row.yt_overlay_superchat_enabled, 1);
    assert.equal(row.yt_overlay_member_enabled, 0);
    assert.equal(row.yt_overlay_giftmember_enabled, 0);

    await save({ overlay_enabled: '1' });
    row = db.getStreamerById(id);
    assert.equal(row.yt_overlay_superchat_duration, 20, 'a save without the YouTube fields keeps them');
    assert.equal(row.yt_overlay_superchat_enabled, 1);
    assert.equal(row.yt_overlay_member_enabled, 0);
  });

  test('an alert with no stored duration shows its default on the page', async () => {
    const columns = Object.keys(DEFAULT_DURATION_SECONDS);
    db.db.prepare(`UPDATE streamers SET ${columns.map((c) => `${c} = NULL`).join(', ')} WHERE id = ?`).run(id);
    const res = await request('GET', '/dashboard/overlay', { streamer: id });
    for (const [column, seconds] of Object.entries(DEFAULT_DURATION_SECONDS)) {
      assert.match(res.text, new RegExp(`name="${column}" value="${seconds}"`), column);
    }
  });

  // Settings reach an open OBS source as they are saved, so a save does not reconnect
  // Twitch (a restart drops events for a second or two): the connections are started
  // when the overlay is switched on, and StreamElements' when its token changes.
  test('a save while the overlay is on leaves the connections running', async () => {
    await save({ overlay_enabled: '1', overlay_follow_duration: '9', streamelements_jwt: '' });
    assert.equal(db.getStreamerById(id).overlay_follow_duration, 9, 'the settings are saved');
    assert.deepEqual(managerCalls, []);
  });

  test('a blank token field keeps the saved token', async () => {
    await save({ overlay_enabled: '1', streamelements_jwt: '' });
    assert.equal(db.getStreamerById(id).streamelements_jwt, JWT);
    assert.deepEqual(managerCalls, []);
  });

  test('a typed token replaces the saved one and reconnects StreamElements only', async () => {
    await save({ overlay_enabled: '1', streamelements_jwt: ' other.token.value ' });
    assert.equal(db.getStreamerById(id).streamelements_jwt, 'other.token.value');
    assert.deepEqual(managerCalls, [['se.start', id]]);
  });

  test('typing the token that is already saved changes nothing', async () => {
    await save({ overlay_enabled: '1', streamelements_jwt: JWT });
    assert.deepEqual(managerCalls, []);
  });

  test('the remove box clears the token and stops the StreamElements connection only', async () => {
    await save({ overlay_enabled: '1', streamelements_jwt: '', streamelements_jwt_remove: '1' });
    assert.equal(db.getStreamerById(id).streamelements_jwt, null);
    assert.deepEqual(managerCalls, [['se.stop', id]]);
  });

  test('switching the overlay on connects EventSub, and StreamElements when a token is saved', async () => {
    db.db.prepare('UPDATE streamers SET overlay_enabled = 0 WHERE id = ?').run(id);
    await save({ overlay_enabled: '1', streamelements_jwt: '' });
    assert.equal(db.getStreamerById(id).overlay_enabled, 1);
    assert.deepEqual(managerCalls, [['eventsub.start', id], ['se.start', id]]);
  });

  test('switching the overlay on without a StreamElements token connects EventSub only', async () => {
    const noToken = addStreamer({ overlay_enabled: 0, broadcaster_access_token: 'tok' });
    await request('POST', '/dashboard/overlay', { streamer: noToken, form: { overlay_enabled: '1' } });
    assert.ok(managerCalls.some(([name, who]) => name === 'eventsub.start' && who === noToken));
    assert.ok(!managerCalls.some(([name]) => name === 'se.start'), 'there is no token to connect with');
  });

  test('on, saved again, token changed, off, on again: the connections follow the switch', async () => {
    db.db.prepare('UPDATE streamers SET overlay_enabled = 0 WHERE id = ?').run(id);
    const steps = [
      [{ overlay_enabled: '1' }, [['eventsub.start', id], ['se.start', id]]],
      [{ overlay_enabled: '1', overlay_sub_duration: '10' }, []],
      [{ overlay_enabled: '1', streamelements_jwt: 'new.token.value' }, [['se.start', id]]],
      [{ overlay_enabled: '1', overlay_bits_duration: '12' }, []],
      [{}, [['eventsub.stop', id], ['se.stop', id]]],
      [{ overlay_enabled: '1' }, [['eventsub.start', id], ['se.start', id]]],
    ];
    for (const [form, expected] of steps) {
      managerCalls.length = 0;
      await save(form);
      assert.deepEqual(managerCalls, expected, JSON.stringify(form));
    }
  });

  test('turning the overlay off stops both connections and keeps the token', async () => {
    await save({ streamelements_jwt: '' });
    assert.equal(db.getStreamerById(id).overlay_enabled, 0);
    assert.equal(db.getStreamerById(id).streamelements_jwt, JWT);
    assert.deepEqual(managerCalls, [['eventsub.stop', id], ['se.stop', id]]);
  });

  test('the saved token never comes back in the page after a save either', async () => {
    await save({ overlay_enabled: '1', streamelements_jwt: ' other.token.value ' });
    const res = await request('GET', '/dashboard/overlay', { streamer: id });
    assert.ok(!res.text.includes('other.token.value'));
    assert.ok(!res.text.includes(JWT));
  });
});

// ── The event connections follow the overlay and the chatbot switches ────
//
// EventSub (the Twitch events behind the overlay's alerts and the chatbot's thank-yous), StreamElements and the
// sponsor rotation run while the overlay or the chatbot is on; the app starts them at boot on the same rule.
// A save that flips one of the two switches starts them when the first comes on and stops them when the last
// goes off, and leaves them alone while the other keeps them needed. With the overlay hidden, the chatbot
// page is the only place left that can switch them on.

describe('the event connections follow the overlay and the chatbot switches', () => {
  const JWT = 'synthetic.stream.elements.token';
  const STARTED = [['eventsub.start'], ['se.start']];
  const SPONSORS_STARTED = [['sponsors.restart'], ['sponsors.restartChat']];
  const forId = (id, calls) => calls.map(([name]) => [name, id]);
  // Two forms post to /dashboard/chatbot and name their part: the Connection tab's switch (form=connection; an
  // unchecked switch is not sent: off) and the Event Messages tab (form=events).
  const saveChatbot = (id, form) => request('POST', '/dashboard/chatbot', { streamer: id, form: { form: 'connection', ...form } });
  const saveMessages = (id, form) => request('POST', '/dashboard/chatbot', { streamer: id, form: { form: 'events', chat_follow_template: '', ...form } });
  const saveOverlay = (id, form) => request('POST', '/dashboard/overlay', { streamer: id, form: { overlay_volume: '0.8', ...form } });
  const make = (over = {}) => addStreamer({ overlay_enabled: 0, chatbot_enabled: 0, twitch_username: `synthetic_conn_${counter + 1}`, broadcaster_access_token: 'tok', streamelements_jwt: JWT, ...over });

  describe('the chatbot save', () => {
    test('switching the chatbot on with the overlay off joins chat, starts EventSub and StreamElements (a token is saved) and the sponsor rotation', async () => {
      const id = make();
      const res = await saveChatbot(id, { chatbot_enabled: '1' });
      assert.equal(res.status, 302);
      assert.equal(db.getStreamerById(id).chatbot_enabled, 1);
      assert.deepEqual(managerCalls, [['chat.start', id], ...forId(id, STARTED)]);
      assert.deepEqual(sponsorCalls, forId(id, SPONSORS_STARTED));
    });

    test('without a StreamElements token it starts EventSub and the sponsor rotation only', async () => {
      const id = make({ streamelements_jwt: null });
      await saveChatbot(id, { chatbot_enabled: '1' });
      assert.deepEqual(managerCalls, [['chat.start', id], ['eventsub.start', id]]);
      assert.deepEqual(sponsorCalls, forId(id, SPONSORS_STARTED));
    });

    test('a connection that fails to start does not keep the others from starting, and is logged', async () => {
      const id = make();
      const real = eventSubStub.eventSubManager.startForStreamer;
      eventSubStub.eventSubManager.startForStreamer = () => { throw new Error('synthetic failure'); };
      logs.length = 0;
      try {
        const res = await saveChatbot(id, { chatbot_enabled: '1' });
        assert.equal(res.status, 302);
        assert.deepEqual(managerCalls, [['chat.start', id], ['se.start', id]], 'StreamElements still starts');
        assert.deepEqual(sponsorCalls, forId(id, SPONSORS_STARTED), 'the sponsor rotation still starts');
        assert.ok(logs.some(([level, line]) => level === 'error' && line.includes('EventSub') && line.includes('synthetic failure')), 'the failure is logged');
      } finally {
        eventSubStub.eventSubManager.startForStreamer = real;
      }
    });

    test('switching it on while the overlay is already on changes nothing (they are running)', async () => {
      const id = make({ overlay_enabled: 1 });
      await saveChatbot(id, { chatbot_enabled: '1' });
      assert.deepEqual(managerCalls, [['chat.start', id]]);
      assert.deepEqual(sponsorCalls, []);
    });

    test('posting the switch again while it stays on does not reconnect anything', async () => {
      const id = make({ chatbot_enabled: 1 });
      await saveChatbot(id, { chatbot_enabled: '1' });
      assert.equal(db.getStreamerById(id).chatbot_enabled, 1);
      assert.deepEqual(managerCalls, [['chat.start', id]]);
      assert.deepEqual(sponsorCalls, []);
    });

    test('the switch changes only the switch: the thank-you messages and their switches stay as saved', async () => {
      const id = make({ chat_follow_enabled: 0, chat_follow_template: 'Keep me, {username}' });
      await saveChatbot(id, { chatbot_enabled: '1' });
      const row = db.getStreamerById(id);
      assert.equal(row.chatbot_enabled, 1);
      assert.equal(row.chat_follow_enabled, 0);
      assert.equal(row.chat_follow_template, 'Keep me, {username}');
    });

    test('saving the thank-you messages keeps the chatbot on and leaves chat and the connections alone', async () => {
      const id = make({ chatbot_enabled: 1 });
      const res = await saveMessages(id, { chat_follow_enabled: '1', chat_follow_template: 'Thanks {username}!' });
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/dashboard/chatbot?tab=events');
      const row = db.getStreamerById(id);
      assert.equal(row.chatbot_enabled, 1, 'the chatbot stays on');
      assert.equal(row.chat_follow_enabled, 1);
      assert.equal(row.chat_follow_template, 'Thanks {username}!');
      assert.equal(row.chat_sub_enabled, 0, 'an unchecked message switch is off');
      assert.deepEqual(managerCalls, [], 'the bot stays in chat');
      assert.deepEqual(sponsorCalls, []);
    });

    test('saving the thank-you messages never switches the chatbot on either', async () => {
      const id = make({ chatbot_enabled: 0 });
      await saveMessages(id, { chatbot_enabled: '1', chat_follow_template: 'Hi {username}' });
      assert.equal(db.getStreamerById(id).chatbot_enabled, 0);
      assert.deepEqual(managerCalls, []);
    });

    test('a post that names no part (a page opened before the forms named theirs) saves the messages and keeps the chatbot as it was', async () => {
      const id = make({ chatbot_enabled: 1 });
      await request('POST', '/dashboard/chatbot', { streamer: id, form: { chat_follow_template: 'Old page {username}' } });
      const row = db.getStreamerById(id);
      assert.equal(row.chatbot_enabled, 1);
      assert.equal(row.chat_follow_template, 'Old page {username}');
      assert.deepEqual(managerCalls, []);
    });

    test('switching it off with the overlay off leaves chat and stops EventSub, StreamElements and the sponsor rotation', async () => {
      const id = make({ chatbot_enabled: 1 });
      await saveChatbot(id, {});
      assert.equal(db.getStreamerById(id).chatbot_enabled, 0);
      assert.deepEqual(managerCalls, [['chat.stop', id], ['eventsub.stop', id], ['se.stop', id]]);
      assert.deepEqual(sponsorCalls, [['sponsors.stop', id]]);
    });

    test('switching it off while the overlay is on leaves the connections running', async () => {
      const id = make({ chatbot_enabled: 1, overlay_enabled: 1 });
      await saveChatbot(id, {});
      assert.deepEqual(managerCalls, [['chat.stop', id]]);
      assert.deepEqual(sponsorCalls, []);
    });

    test('a save that leaves the chatbot off does nothing to the connections', async () => {
      const id = make();
      await saveChatbot(id, {});
      assert.deepEqual(managerCalls, [['chat.stop', id]]);
      assert.deepEqual(sponsorCalls, []);
    });

    test('a manager that fails does not fail the save, and is logged', async () => {
      const id = make();
      const start = eventSubStub.eventSubManager.startForStreamer;
      eventSubStub.eventSubManager.startForStreamer = () => { throw new Error('eventsub exploded'); };
      try {
        const res = await saveChatbot(id, { chatbot_enabled: '1' });
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, '/dashboard/chatbot');
      } finally {
        eventSubStub.eventSubManager.startForStreamer = start;
      }
      assert.equal(db.getStreamerById(id).chatbot_enabled, 1, 'the setting is saved');
      assert.ok(logs.some(([level, line]) => level === 'error' && /Starting EventSub failed for streamer \d+: eventsub exploded/.test(line)));
    });
  });

  describe('the overlay save', () => {
    test('switching the overlay off while the chatbot is on stops nothing: the chatbot still needs the connections', async () => {
      const id = make({ overlay_enabled: 1, chatbot_enabled: 1 });
      const res = await saveOverlay(id, { streamelements_jwt: '' }); // the overlay switch is not sent: off
      assert.equal(res.status, 302);
      assert.equal(db.getStreamerById(id).overlay_enabled, 0);
      assert.deepEqual(managerCalls, []);
      assert.deepEqual(sponsorCalls, []);
    });

    test('switching the overlay on while the chatbot is on does not reconnect Twitch (it is running already)', async () => {
      const id = make({ overlay_enabled: 0, chatbot_enabled: 1 });
      await saveOverlay(id, { overlay_enabled: '1' });
      assert.equal(db.getStreamerById(id).overlay_enabled, 1);
      assert.deepEqual(managerCalls, []);
      assert.deepEqual(sponsorCalls, []);
    });

    test('a StreamElements token changed with the overlay off and the chatbot on reconnects StreamElements only', async () => {
      const id = make({ overlay_enabled: 0, chatbot_enabled: 1 });
      await saveOverlay(id, { streamelements_jwt: 'other.token.value' });
      assert.deepEqual(managerCalls, [['se.start', id]]);
      managerCalls.length = 0;
      await saveOverlay(id, { streamelements_jwt: '', streamelements_jwt_remove: '1' });
      assert.deepEqual(managerCalls, [['se.stop', id]]);
      assert.deepEqual(sponsorCalls, []);
    });

    test('with the chatbot off it is as it was: on starts EventSub, StreamElements and the sponsor rotation, off stops all three', async () => {
      const id = make();
      await saveOverlay(id, { overlay_enabled: '1' });
      assert.deepEqual(managerCalls, forId(id, STARTED));
      assert.deepEqual(sponsorCalls, forId(id, SPONSORS_STARTED));
      managerCalls.length = 0;
      sponsorCalls.length = 0;
      await saveOverlay(id, {});
      assert.deepEqual(managerCalls, [['eventsub.stop', id], ['se.stop', id]]);
      assert.deepEqual(sponsorCalls, [['sponsors.stop', id]]);
    });

    test('the two pages agree: overlay on, chatbot on, then each off in turn, the connections stop only after the second', async () => {
      const id = make({ overlay_enabled: 1, chatbot_enabled: 1 });
      await saveChatbot(id, {}); // the overlay is still on
      assert.deepEqual(managerCalls, [['chat.stop', id]]);
      managerCalls.length = 0;
      await saveOverlay(id, {}); // now neither is on
      assert.deepEqual(managerCalls, [['eventsub.stop', id], ['se.stop', id]]);
      assert.deepEqual(sponsorCalls, [['sponsors.stop', id]]);
    });
  });
});

// ── Settings reach an open OBS source (M6) and a new link ends the old ones (L5) ──

describe('a save is pushed to the overlays that are open', () => {
  const bus = require('../services/overlayBus');
  const { accountDisabledChannel } = require('../services/streamerAccess');
  let id;
  beforeEach(() => {
    id = addStreamer({ overlay_enabled: 1, broadcaster_access_token: 'tok', overlay_token: `tok-push-${counter}` });
  });

  // Everything the streamer's overlay would receive while `action` runs.
  async function overlayMessagesDuring(action, streamerId = id) {
    const seen = [];
    const listener = (event) => seen.push(event);
    bus.on(`overlay:${streamerId}`, listener);
    try { await action(); } finally { bus.off(`overlay:${streamerId}`, listener); }
    return seen;
  }

  test('saving the overlay settings sends the new config: volume 0, raid and giveaway included', async () => {
    const seen = await overlayMessagesDuring(() => request('POST', '/dashboard/overlay', {
      streamer: id,
      form: {
        overlay_enabled: '1', overlay_follow_enabled: '1', overlay_follow_duration: '9',
        overlay_raid_duration: '12', overlay_giveaway_duration: '20', overlay_volume: '0',
        // raid and giveaway are switched off: their checkboxes are not sent
      },
    }));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].type, 'config-update');
    const { config } = seen[0];
    assert.equal(config.volume, 0, 'a silent overlay is told 0, not the default');
    assert.deepEqual(config.follow, { enabled: true, duration: 9 });
    assert.deepEqual(config.raid, { enabled: false, duration: 12 });
    assert.deepEqual(config.giveaway_winner, { enabled: false, duration: 20 });
  });

  test('what is pushed is what was saved: the same builder reads the row afterwards', async () => {
    const { buildOverlayConfig } = require('../services/overlayConfig');
    const seen = await overlayMessagesDuring(() => request('POST', '/dashboard/overlay', {
      streamer: id, form: { overlay_enabled: '1', overlay_bits_enabled: '1', overlay_bits_duration: '99', overlay_volume: '0.35' },
    }));
    assert.deepEqual(seen[0].config, buildOverlayConfig(db.getStreamerById(id)));
    assert.equal(seen[0].config.bits.duration, 30, 'bounded like the save');
  });

  test('the push goes to this streamer\'s overlays only', async () => {
    const other = addStreamer({ overlay_enabled: 1 });
    const seenByOther = await overlayMessagesDuring(() => request('POST', '/dashboard/overlay', { streamer: id, form: { overlay_enabled: '1' } }), other);
    assert.deepEqual(seenByOther, []);
  });

  test('saving the YouTube overlay toggles sends them too', async () => {
    const seen = await overlayMessagesDuring(() => request('POST', '/dashboard/youtube-chatbot', {
      streamer: id, form: { yt_overlay_member_enabled: '1' }, // superchat and gift alerts switched off
    }));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].type, 'config-update');
    assert.equal(seen[0].config.yt_member.enabled, true);
    assert.equal(seen[0].config.yt_superchat.enabled, false);
    assert.equal(seen[0].config.yt_giftmember.enabled, false);
  });

  test('a rejected save (disabled account) pushes nothing', async () => {
    const disabled = addStreamer({ enabled: 0, overlay_enabled: 1 });
    const seen = await overlayMessagesDuring(() => request('POST', '/dashboard/overlay', { streamer: disabled, form: { overlay_enabled: '1' } }), disabled);
    assert.deepEqual(seen, []);
  });

  describe('regenerating the overlay link', () => {
    test('gives the streamer a new token, and the streams that are open on the old link are ended', async () => {
      const before = db.getStreamerById(id).overlay_token;
      let ended = 0;
      const onEnd = () => { ended++; };
      bus.on(accountDisabledChannel(id), onEnd);
      let res;
      try { res = await request('POST', '/dashboard/overlay/generate-token', { streamer: id }); } finally { bus.off(accountDisabledChannel(id), onEnd); }
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/dashboard/overlay');
      const after = db.getStreamerById(id).overlay_token;
      assert.ok(after && after !== before, 'a new token');
      assert.equal(db.getStreamerByOverlayToken(before), undefined, 'the old link no longer finds the streamer');
      assert.equal(db.getStreamerByOverlayToken(after).id, id, 'the new link does');
      assert.equal(ended, 1, 'the open streams were told to end');
    });

    test('another streamer\'s streams are left alone', async () => {
      const other = addStreamer({ overlay_enabled: 1, overlay_token: 'tok-bystander-regen' });
      let ended = 0;
      const onEnd = () => { ended++; };
      bus.on(accountDisabledChannel(other), onEnd);
      try { await request('POST', '/dashboard/overlay/generate-token', { streamer: id }); } finally { bus.off(accountDisabledChannel(other), onEnd); }
      assert.equal(ended, 0);
      assert.equal(db.getStreamerById(other).overlay_token, 'tok-bystander-regen');
    });

    test('a visitor who is not logged in cannot regenerate anything', async () => {
      const before = db.getStreamerById(id).overlay_token;
      const res = await request('POST', '/dashboard/overlay/generate-token', {});
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/auth/login');
      assert.equal(db.getStreamerById(id).overlay_token, before);
    });

    test('the settings page offers a button that asks first, and says OBS must be updated', async () => {
      const res = await request('GET', '/dashboard/overlay', { streamer: id });
      assert.equal(res.status, 200);
      const form = res.text.match(/<form[^>]*action="\/dashboard\/overlay\/generate-token"[^>]*>[\s\S]*?<\/form>/);
      assert.ok(form, 'a form posting to generate-token is on the page while a link exists');
      assert.match(form[0], /data-confirm="[^"]*OBS[^"]*"/, 'the confirmation names OBS');
      assert.match(form[0], /onsubmit="return confirm\(this\.dataset\.confirm\)"/);
      assert.match(form[0], /<button type="submit"/);
    });

    // The VTuber browser source (/vtuber/<token>) is opened with the same link.
    test('the warning names the VTuber source too, in every language', async () => {
      const { SUPPORTED_LANGS } = require('../i18n');
      for (const lang of SUPPORTED_LANGS) {
        assert.match(t(lang, 'overlay.regenerate.confirm'), /VTuber/, lang);
      }
      const res = await request('GET', '/dashboard/overlay', { streamer: id });
      assert.match(res.text.match(/data-confirm="([^"]*)"/)[1], /VTuber/);
    });
  });
});

// ── Claiming a server (C-a) and the server list (C-c) ────────────────────

describe('claiming a server', () => {
  test('two managers claiming at the same moment: only one gets it', async () => {
    const G = '700000000000000001';
    const a = addStreamer();
    const b = addStreamer();
    const guild = fakeGuild(G, { manage: [discordId(a), discordId(b)] });
    guild.hold = true; // Discord's answers wait until the test lets them through
    guilds.set(G, guild);

    const first = request('POST', `/dashboard/claim/${G}`, { streamer: a });
    const second = request('POST', `/dashboard/claim/${G}`, { streamer: b });
    // Both are now waiting on Discord, past the "already claimed?" check.
    for (let i = 0; i < 200 && guild.gates.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(guild.gates.length, 2, 'both requests reached Discord');
    guild.gates.forEach((answer) => answer());

    const results = await Promise.all([first, second]);
    const locations = results.map((r) => r.headers.location).sort();
    assert.deepEqual(locations, [`/dashboard/guild/${G}`, '/dashboard?msg=already_claimed']);
    assert.equal(count('guilds', 'guild_id = ?', G), 1, 'the server has exactly one owner');
  });

  test('a manager can claim a server nobody has', async () => {
    const G = '700000000000000002';
    const a = addStreamer();
    guilds.set(G, fakeGuild(G, { manage: [discordId(a)] }));
    const res = await request('POST', `/dashboard/claim/${G}`, { streamer: a });
    assert.equal(res.headers.location, `/dashboard/guild/${G}`);
    assert.ok(db.getGuildConfig(G, a));
  });

  test('someone who does not manage the server is refused', async () => {
    const G = '700000000000000003';
    const a = addStreamer();
    guilds.set(G, fakeGuild(G, { manage: [] }));
    const res = await request('POST', `/dashboard/claim/${G}`, { streamer: a });
    assert.equal(res.headers.location, '/dashboard?msg=claim_not_allowed');
    assert.equal(count('guilds', 'guild_id = ?', G), 0);
  });

  test('a server somebody already has is refused before Discord is asked', async () => {
    const G = '700000000000000004';
    const a = addStreamer();
    const b = addStreamer();
    db.upsertGuild(G, a, 'Taken');
    const guild = fakeGuild(G, { manage: [discordId(b)] });
    guilds.set(G, guild);
    const res = await request('POST', `/dashboard/claim/${G}`, { streamer: b });
    assert.equal(res.headers.location, '/dashboard?msg=already_claimed');
    assert.deepEqual(guild.fetches, []);
  });
});

describe('the dashboard home and Discord answering slowly', () => {
  test('a server whose answer is slow is left off the list for now, and the page does not wait for it', async () => {
    const a = addStreamer();
    guilds.set('700000000000000010', fakeGuild('700000000000000010', { manage: [discordId(a)] }));
    guilds.set('700000000000000011', fakeGuild('700000000000000011', { never: true }));
    guilds.set('700000000000000012', fakeGuild('700000000000000012', { manage: [] }));

    const started = Date.now();
    const res = await request('GET', '/dashboard', { streamer: a, json: true });
    const took = Date.now() - started;

    assert.equal(res.status, 200);
    assert.deepEqual(res.json().locals.unclaimedGuilds.map((g) => g.id), ['700000000000000010']);
    assert.ok(took >= 2000, `it waited for the slow server up to the limit (${took} ms)`);
    assert.ok(took < 5000, `and no longer than that (${took} ms)`);
  });
});

// ── The dashboard home before the Discord bot is ready ──────────────────

describe('the dashboard home before the Discord bot is ready', () => {
  const inviteFor = (clientId) => `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&amp;permissions=`;

  test('renders while discord.js has no application yet, with the invite built from the OAuth client id', async () => {
    // discord.js holds application = null until its gateway READY (always, with DISCORD_DISABLED=1).
    const ready = discordStub.client.application;
    discordStub.client.application = null;
    try {
      const res = await request('GET', '/dashboard', { streamer: addStreamer() });
      assert.equal(res.status, 200);
      assert.ok(res.text.includes(inviteFor(require('../config').discord.clientId)), 'the invite uses DISCORD_CLIENT_ID');
    } finally {
      discordStub.client.application = ready;
    }
  });

  test('once Discord is ready, the invite uses the application id discord.js reports', async () => {
    const res = await request('GET', '/dashboard', { streamer: addStreamer() });
    assert.equal(res.status, 200);
    assert.ok(res.text.includes(inviteFor(discordStub.client.application.id)));
  });
});

// ── The Multistream card (MS6) ───────────────────────────────────────────

describe('the Multistream card', () => {
  const multistream = require('../config').multistream;
  const saved = multistream.enabled;
  afterEach(() => { multistream.enabled = saved; });

  test('is not on the dashboard while the relay is not configured', async () => {
    multistream.enabled = false;
    const res = await request('GET', '/dashboard', { streamer: addStreamer({ multistream_enabled: 1 }) });
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes('/dashboard/multistream'), 'no link to the page');
    assert.ok(!res.text.includes('point OBS at your ingest URL'));
  });

  test('is shown once the relay is configured', async () => {
    multistream.enabled = true;
    const res = await request('GET', '/dashboard', { streamer: addStreamer() });
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('href="/dashboard/multistream"'));
  });
});

// ── A broadcaster authorization refused for another Twitch account (N10) ─

describe('the dashboard after a broadcaster authorization from another Twitch account', () => {
  const html = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&#34;').replace(/'/g, '&#39;');

  test('says which account to sign in with, naming the linked one from the account itself, never from the URL', async () => {
    const linked = addStreamer({ twitch_user_id: 'tw-banner-1', twitch_username: 'synthetic_banner', twitch_display_name: 'Synthetic_Banner' });
    const res = await request('GET', '/dashboard?msg=broadcaster_wrong_account&name=Someone%20Else', { streamer: linked });
    assert.equal(res.status, 200);
    assert.ok(res.text.includes(html(t('en', 'dashboard.broadcasterWrongAccount', { name: 'Synthetic_Banner' }))));
    assert.ok(!res.text.includes('Someone Else'));

    const unlinked = await request('GET', '/dashboard?msg=broadcaster_wrong_account', { streamer: addStreamer() });
    assert.equal(unlinked.status, 200);
    assert.ok(unlinked.text.includes(html(t('en', 'dashboard.broadcasterNeedsTwitch'))));
  });
});

// ── Sponsor timing is clamped when it is saved (H11) ─────────────────────

describe('sponsor timing on save', () => {
  let id;
  beforeEach(() => { id = addStreamer(); });
  const firstImage = () => db.getSponsorImages(id)[0];

  test('an image update keeps the duration at 5-300 s and the scale on the builder slider', async () => {
    db.addSponsorImage(id, 'a.png', 'A', null, 30);
    const imageId = firstImage().id;
    const update = (over) => request('POST', `/dashboard/sponsors/${imageId}/update`, {
      streamer: id, body: { display_name: 'A', chat_message: '', enabled: '1', display_duration: 30, image_scale: 1, ...over },
    });

    await update({ display_duration: -5, image_scale: -1 });
    assert.deepEqual([firstImage().display_duration, firstImage().image_scale], [5, 0.3]);

    await update({ display_duration: 99999, image_scale: 9 });
    assert.deepEqual([firstImage().display_duration, firstImage().image_scale], [300, 1]);

    await update({ display_duration: 'soon', image_scale: 'big' });
    assert.deepEqual([firstImage().display_duration, firstImage().image_scale], [30, 1]);

    const res = await update({ display_duration: 45, image_scale: 0.55 });
    assert.equal(res.status, 200);
    assert.deepEqual([firstImage().display_duration, firstImage().image_scale], [45, 0.55]);
  });

  test('an upload takes ?dur= through the same clamp', async () => {
    const upload = (dur) => request('POST', `/dashboard/sponsors/upload?name=Acme&ext=png&dur=${dur}`, {
      streamer: id, rawBody: 'not-really-a-png', contentType: 'application/octet-stream',
    });
    for (const dur of [-9, 0, 100000, '', 60]) assert.equal((await upload(dur)).status, 200);
    // (Read from the table: uploads in the same millisecond share a file name.)
    assert.deepEqual(db.getSponsorImages(id).map((i) => i.display_duration), [5, 5, 300, 30, 60]);
    assert.equal(fileWrites.length, 5, 'the files went to the fake disk, not the real one');
  });

  test('the sponsor chat interval is saved as 1 to 1440 minutes', async () => {
    const save = (interval) => request('POST', '/dashboard/sponsor-messages/settings', { streamer: id, body: { enabled: '1', interval_minutes: interval } });
    const interval = () => db.getStreamerById(id).sponsor_chat_interval_minutes;
    await save(-15);
    assert.equal(interval(), 1);
    await save(0);
    assert.equal(interval(), 1);
    await save(1_000_000);
    assert.equal(interval(), 1440);
    await save('');
    assert.equal(interval(), 10);
    await save(20);
    assert.equal(interval(), 20);
  });

  test('the rotation settings seconds field is clamped like an image duration', async () => {
    const save = (seconds) => request('POST', '/dashboard/sponsors/settings', { streamer: id, body: { sponsor_rotation_enabled: '1', sponsor_interval_seconds: seconds, sponsor_send_chat: '' } });
    const seconds = () => db.getStreamerById(id).sponsor_interval_seconds;
    await save(-30);
    assert.equal(seconds(), 5);
    await save(5000);
    assert.equal(seconds(), 300);
    await save(40);
    assert.equal(seconds(), 40);
  });
});

// ── Custom commands: add and update follow the same rules (N16) ──────────

describe('custom chat commands', () => {
  let id;
  beforeEach(() => { id = addStreamer(); });
  const add = (form, streamer = id) => request('POST', '/dashboard/chatbot/commands', { streamer, form });
  const update = (commandId, form, streamer = id) => request('POST', `/dashboard/chatbot/commands/${commandId}/update`, { streamer, form });
  const stored = (streamer = id) => db.getChatCommands(streamer).map((c) => [c.command, c.response, c.cooldown, c.enabled]);
  const errorOf = (res) => new URL(res.headers.location, 'http://x').searchParams.get('cmd_error');
  const tabOf = (res) => new URL(res.headers.location, 'http://x').searchParams.get('tab');

  // What a browser makes of an attribute value: each entity once.
  const attributeValue = (html) => html.replace(/&(#\d+|amp|lt|gt|quot|apos);/g, (m, name) => (
    { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name] || String.fromCharCode(Number(name.slice(1)))));

  test('the Test button hands the script the response exactly as it was typed, quotes and all', async () => {
    const responses = ['Say "hello" to chat', "it's a 'quoted' <b>bold</b> & more", 'plain', '5 &quot; is not an entity here'];
    responses.forEach((response, i) => db.addChatCommand(id, `cmd${i}`, response, 5));
    const page = (await request('GET', '/dashboard/chatbot', { streamer: id })).text;
    const sent = [...page.matchAll(/data-response="([^"]*)" onclick="testCustomCommand\(this\.dataset\.response, this\)"/g)].map((m) => attributeValue(m[1]));
    assert.deepEqual(sent.sort(), [...responses].sort());
  });

  test('the response reaches chat as it was typed: the route takes it as plain text', async () => {
    db.db.prepare('UPDATE streamers SET twitch_username = ? WHERE id = ?').run('somechannel', id);
    const typed = 'Say "hello" & <b>wave</b>';
    const res = await request('POST', `/dashboard/chatbot/test/custom?response=${encodeURIComponent(typed)}`, { streamer: id });
    assert.equal(res.status, 200);
    assert.deepEqual(chatCalls, [['say', id, typed, { priority: 'high' }]]);
  });

  test('adds a command with a cleaned name and response, and a cooldown held to 5-3600 s', async () => {
    const res = await add({ command: '!Socials ', response: '  Follow us!  ', cooldown: '-30' });
    assert.equal(res.status, 302);
    assert.equal(tabOf(res), 'commands');
    assert.equal(errorOf(res), null);
    await add({ command: 'slow', response: 'x', cooldown: '99999' });
    await add({ command: 'blank', response: 'x', cooldown: '' });
    assert.deepEqual(stored(), [['blank', 'x', 5, 1], ['slow', 'x', 3600, 1], ['socials', 'Follow us!', 5, 1]]);
  });

  test('a blank or invalid name, a missing response or one over 500 characters is refused with a code, and nothing is stored', async () => {
    assert.equal(errorOf(await add({ command: '', response: 'hi' })), 'name_invalid');
    assert.equal(errorOf(await add({ command: '!', response: 'hi' })), 'name_invalid');
    assert.equal(errorOf(await add({ command: 'two words', response: 'hi' })), 'name_invalid');
    assert.equal(errorOf(await add({ command: 'hi', response: '' })), 'response_required');
    assert.equal(errorOf(await add({ command: 'hi' })), 'response_required');
    assert.equal(errorOf(await add({ command: 'hi', response: 'x'.repeat(501) })), 'response_too_long');
    assert.deepEqual(stored(), []);
  });

  test('a repeated field (an array) is an invalid command, not a crash', async () => {
    const res = await request('POST', '/dashboard/chatbot/commands', { streamer: id, rawBody: 'command=a&command=b&response=hi' });
    assert.equal(res.status, 302);
    assert.equal(errorOf(res), 'name_invalid');
    assert.deepEqual(stored(), []);
  });

  test('adding a name already in use says duplicate, and the first command is kept', async () => {
    await add({ command: 'socials', response: 'first' });
    const res = await add({ command: '!SOCIALS', response: 'second' });
    assert.equal(res.status, 302);
    assert.equal(errorOf(res), 'duplicate');
    assert.deepEqual(stored(), [['socials', 'first', 5, 1]]);
  });

  test('the same name for another streamer is fine', async () => {
    const other = addStreamer();
    await add({ command: 'socials', response: 'mine' });
    assert.equal(errorOf(await add({ command: 'socials', response: 'theirs' }, other)), null);
    assert.deepEqual(stored(other), [['socials', 'theirs', 5, 1]]);
  });

  test('an update with a blank name is refused: the command keeps its name (it used to answer every lone "!")', async () => {
    await add({ command: 'socials', response: 'Follow us!' });
    const commandId = db.getChatCommands(id)[0].id;
    for (const name of ['', '   ', '!']) {
      const res = await update(commandId, { command: name, response: 'Follow us!', enabled: '1' });
      assert.equal(errorOf(res), 'name_invalid', JSON.stringify(name));
    }
    assert.deepEqual(stored(), [['socials', 'Follow us!', 5, 1]]);
  });

  test('renaming onto a name already in use is duplicate, not a 500, and changes nothing', async () => {
    await add({ command: 'a', response: 'one' });
    await add({ command: 'b', response: 'two' });
    const [first] = db.getChatCommands(id);
    const res = await update(first.id, { command: 'b', response: 'changed', enabled: '1' });
    assert.equal(res.status, 302);
    assert.equal(errorOf(res), 'duplicate');
    assert.deepEqual(stored(), [['a', 'one', 5, 1], ['b', 'two', 5, 1]]);
  });

  test('an update without a response is response_required, not a 500', async () => {
    await add({ command: 'a', response: 'one' });
    const commandId = db.getChatCommands(id)[0].id;
    const res = await update(commandId, { command: 'a', enabled: '1' });
    assert.equal(res.status, 302);
    assert.equal(errorOf(res), 'response_required');
    assert.deepEqual(stored(), [['a', 'one', 5, 1]]);
  });

  test('a good update renames, changes the response, switches off, and holds the cooldown to 5-3600 s', async () => {
    await add({ command: 'a', response: 'one' });
    const commandId = db.getChatCommands(id)[0].id;
    let res = await update(commandId, { command: '!Renamed', response: ' new text ', cooldown: '-5' });
    assert.equal(errorOf(res), null);
    assert.deepEqual(stored(), [['renamed', 'new text', 5, 0]], 'no "enabled" field means switched off');
    res = await update(commandId, { command: 'renamed', response: 'new text', enabled: '1', cooldown: '120' });
    assert.deepEqual(stored(), [['renamed', 'new text', 120, 1]]);
    await update(commandId, { command: 'renamed', response: 'new text', enabled: '1', cooldown: '123456' });
    assert.equal(stored()[0][2], 3600);
  });

  test('renaming a command to its own name is not a duplicate', async () => {
    await add({ command: 'a', response: 'one' });
    const commandId = db.getChatCommands(id)[0].id;
    const res = await update(commandId, { command: 'a', response: 'edited', enabled: '1' });
    assert.equal(errorOf(res), null);
    assert.deepEqual(stored(), [['a', 'edited', 5, 1]]);
  });

  test('a streamer cannot update another streamer\'s command', async () => {
    const other = addStreamer();
    await add({ command: 'theirs', response: 'keep' }, other);
    const theirId = db.getChatCommands(other)[0].id;
    await update(theirId, { command: 'stolen', response: 'changed', enabled: '1' });
    assert.deepEqual(stored(other), [['theirs', 'keep', 5, 1]]);
  });

  test('the chatbot page shows the message for a known code, and nothing for text made up in the URL', async () => {
    const shown = (query) => request('GET', `/dashboard/chatbot?tab=commands${query}`, { streamer: id });
    const duplicate = await shown('&cmd_error=duplicate');
    assert.equal(duplicate.status, 200);
    assert.ok(duplicate.text.includes('id="command-error"'));
    assert.ok(duplicate.text.includes(t('en', 'chatbot.commands.error.duplicate')));
    const tooLong = await shown('&cmd_error=response_too_long');
    assert.ok(tooLong.text.includes('A command response can be at most 500 characters.'));
    const forged = await shown('&cmd_error=Your%20account%20is%20suspended');
    assert.ok(!forged.text.includes('Your account is suspended'));
    assert.ok(!forged.text.includes('id="command-error"'), 'no banner at all');
    const none = await shown('');
    assert.ok(!none.text.includes('chatbot.commands.error'));
  });
});

// ── Test buttons: one cooldown per streamer, and a text cap (N11) ────────

describe('the test buttons', () => {
  const post = (urlPath, streamer, extra = {}) => request('POST', urlPath, { streamer, ...extra });
  const customTest = (streamer, text) => post(`/dashboard/chatbot/test/custom?response=${encodeURIComponent(text)}`, streamer);

  // Every route that makes the shared bots speak or act, or spends shared API quota.
  const testRoutes = [
    '/dashboard/overlay/test/follow',
    '/dashboard/chatbot/test/custom?response=hello',
    '/dashboard/chatbot/test/follow',
    '/dashboard/chatbot/check-moderator',
    '/dashboard/youtube-chatbot/test/yt_member',
    '/dashboard/youtube-chatbot/test-chat/member',
    '/dashboard/sponsor-messages/1/test',
  ];

  test('the first test goes through; every other test button is then held for the cooldown', async () => {
    const id = addStreamer({ twitch_username: 'somechannel', overlay_enabled: 1 });
    const first = await customTest(id, 'hello chat');
    assert.equal(first.status, 200);
    assert.deepEqual(first.json(), { ok: true });
    assert.deepEqual(chatCalls, [['say', id, 'hello chat', { priority: 'high' }]], 'sent like a command reply');

    for (const route of testRoutes) {
      const res = await post(route, id);
      assert.equal(res.status, 429, route);
      const body = res.json();
      assert.equal(body.ok, false, route);
      assert.match(body.error, /^Please wait [1-5] seconds before sending another test\.$/, route);
      assert.match(res.headers['retry-after'], /^[1-5]$/, route);
    }
    assert.deepEqual(chatCalls, [['say', id, 'hello chat', { priority: 'high' }]], 'the bot was not asked again');
  });

  test('each streamer has their own cooldown', async () => {
    const a = addStreamer({ twitch_username: 'channel_a' });
    const b = addStreamer({ twitch_username: 'channel_b' });
    assert.equal((await customTest(a, 'from a')).status, 200);
    assert.equal((await customTest(a, 'again from a')).status, 429);
    assert.equal((await customTest(b, 'from b')).status, 200, 'another streamer is not held up');
    assert.deepEqual(chatCalls.map((c) => c[2]), ['from a', 'from b']);
  });

  test('every test button starts the cooldown, not only the custom one', async () => {
    for (const route of testRoutes.filter((r) => !r.includes('sponsor-messages'))) {
      const id = addStreamer({ twitch_username: 'somechannel', overlay_enabled: 1 });
      const first = await post(route, id);
      assert.notEqual(first.status, 429, `${route} should go through the first time`);
      assert.equal((await customTest(id, 'right after')).status, 429, `${route} should start the shared cooldown`);
    }
    const id = addStreamer({ twitch_username: 'somechannel' });
    db.addSponsorMessage(id, 'Thanks to our sponsors', null);
    const messageId = db.getSponsorMessages(id)[0].id;
    assert.equal((await post(`/dashboard/sponsor-messages/${messageId}/test`, id)).json().ok, true);
    assert.equal((await customTest(id, 'right after')).status, 429);
  });

  test('a test message can be at most 500 characters', async () => {
    const at500 = await customTest(addStreamer({ twitch_username: 'somechannel' }), 'x'.repeat(500));
    assert.equal(at500.status, 200);
    const over = await customTest(addStreamer({ twitch_username: 'somechannel' }), 'x'.repeat(501));
    assert.equal(over.status, 400);
    assert.deepEqual(over.json(), { ok: false, error: 'A test message can be at most 500 characters.' });
    assert.equal(chatCalls.length, 1, 'only the 500-character message was sent');
  });

  test('a test message needs text, and must be plain text (an array from a repeated parameter is not)', async () => {
    const empty = await post('/dashboard/chatbot/test/custom', addStreamer());
    assert.equal(empty.status, 400);
    assert.equal(empty.json().error, 'There is no text to send.');
    const blank = await customTest(addStreamer(), '   ');
    assert.equal(blank.status, 400);
    const repeated = await post('/dashboard/chatbot/test/custom?response=a&response=b', addStreamer());
    assert.equal(repeated.status, 400);
    assert.deepEqual(chatCalls, []);
  });

  test('the text of a test is sent as one line, so it cannot add IRC commands', async () => {
    const id = addStreamer({ twitch_username: 'somechannel' });
    const res = await customTest(id, 'hi\r\nPRIVMSG #other :spam');
    assert.equal(res.status, 200);
    assert.deepEqual(chatCalls, [['say', id, 'hi PRIVMSG #other :spam', { priority: 'high' }]]);
  });

  test('the text can also come in the body', async () => {
    const id = addStreamer({ twitch_username: 'somechannel' });
    const res = await post('/dashboard/chatbot/test/custom', id, { body: { response: 'from the body' } });
    assert.equal(res.status, 200);
    assert.deepEqual(chatCalls, [['say', id, 'from the body', { priority: 'high' }]]);
  });

  test('a failure to send is a generic message, not the internal error text', async () => {
    const id = addStreamer({ twitch_username: 'somechannel' });
    const original = chatStub.chatManager.sendMessage;
    chatStub.chatManager.sendMessage = () => { throw new Error('socket at 10.0.0.5 is on fire'); };
    try {
      const res = await customTest(id, 'hello');
      assert.equal(res.status, 500);
      assert.deepEqual(res.json(), { ok: false, error: 'The test message could not be sent.' });
      assert.ok(!res.text.includes('10.0.0.5'));
    } finally {
      chatStub.chatManager.sendMessage = original;
    }
  });

  test('the overlay test still sends the alert and the matching chat message', async () => {
    const id = addStreamer({ twitch_username: 'somechannel', overlay_enabled: 1 });
    const res = await post('/dashboard/overlay/test/follow', id);
    assert.deepEqual(res.json(), { ok: true });
    assert.deepEqual(chatCalls, [['event', id, 'follow', { username: 'TestRacer' }, { test: true }]], 'a test is never merged with real thank-yous');
  });

  describe('Preview Alert on the overlay settings page', () => {
    const bus = require('../services/overlayBus');
    const TWITCH_TYPES = ['follow', 'subscription', 'bits', 'donation', 'raid'];
    // The types the page's buttons ask for: openPreview('<type>') in the view.
    const buttonTypes = [...new Set([...realFs.readFileSync(path.join(SRC, 'views', 'overlay-config.ejs'), 'utf8').matchAll(/openPreview\('([a-z_]+)'\)/g)].map((m) => m[1]))];

    // Everything this streamer's overlay is sent while `action` runs.
    async function overlayDuring(streamerId, action) {
      const seen = [];
      const listener = (event) => seen.push(event);
      bus.on(`overlay:${streamerId}`, listener);
      try { await action(); } finally { bus.off(`overlay:${streamerId}`, listener); }
      return seen;
    }
    const preview = (streamerId, type) => post(`/dashboard/overlay/test/${type}`, streamerId);

    test('the page offers a button for each of the nine alerts', () => {
      assert.deepEqual([...buttonTypes].sort(), [...TWITCH_TYPES, 'giveaway_winner', 'yt_superchat', 'yt_member', 'yt_giftmember'].sort());
    });

    test('every button is answered with that alert on the overlay (the four that used to be refused included)', async () => {
      for (const type of buttonTypes) {
        const id = addStreamer({ twitch_username: 'somechannel', overlay_enabled: 1 }); // one streamer per button: the cooldown is per streamer
        let res;
        const events = await overlayDuring(id, async () => { res = await preview(id, type); });
        assert.equal(res.status, 200, type);
        assert.deepEqual(res.json(), { ok: true }, type);
        assert.equal(events.length, 1, `${type}: one alert is sent to the overlay`);
        assert.equal(events[0].type, type);
        assert.ok(events[0].data && typeof events[0].data.username === 'string' && events[0].data.username, `${type}: a name to show`);
      }
    });

    test('the giveaway winner is the card giveawayManager sends: a name, the prize and the keyword', async () => {
      const id = addStreamer({ overlay_enabled: 1 });
      const [event] = await overlayDuring(id, () => preview(id, 'giveaway_winner'));
      assert.deepEqual(Object.keys(event.data).sort(), ['keyword', 'prize', 'username']);
      assert.deepEqual(Object.keys(event).sort(), ['data', 'type']);
    });

    test('the YouTube alerts are the same samples the YouTube chatbot page plays', async () => {
      for (const type of ['yt_superchat', 'yt_member', 'yt_giftmember']) {
        const a = addStreamer({ overlay_enabled: 1 });
        const b = addStreamer();
        const [fromSettings] = await overlayDuring(a, () => preview(a, type));
        const [fromChatbot] = await overlayDuring(b, () => post(`/dashboard/youtube-chatbot/test/${type}`, b));
        assert.deepEqual(fromSettings, fromChatbot, type);
      }
    });

    test('only the five Twitch alerts post a thank-you in Twitch chat, and as a test', async () => {
      for (const type of buttonTypes) {
        chatCalls.length = 0;
        const id = addStreamer({ twitch_username: 'somechannel', overlay_enabled: 1 });
        const res = await preview(id, type);
        assert.equal(res.status, 200, type);
        if (TWITCH_TYPES.includes(type)) {
          assert.equal(chatCalls.length, 1, type);
          assert.deepEqual([chatCalls[0][0], chatCalls[0][1], chatCalls[0][2]], ['event', id, type]);
          assert.deepEqual(chatCalls[0][4], { test: true });
        } else {
          assert.deepEqual(chatCalls, [], `${type} is not a Twitch alert`);
        }
      }
    });

    test('a sample is not changed by being sent: the next test sends the same alert', async () => {
      const a = addStreamer({ overlay_enabled: 1 });
      const b = addStreamer({ overlay_enabled: 1 });
      const [first] = await overlayDuring(a, () => preview(a, 'giveaway_winner'));
      first.data.username = 'changed on the way';
      const [second] = await overlayDuring(b, () => preview(b, 'giveaway_winner'));
      assert.notEqual(second.data.username, 'changed on the way');
    });

    test('a type the overlay does not have is refused before the cooldown starts', async () => {
      const id = addStreamer({ twitch_username: 'somechannel', overlay_enabled: 1 });
      const seen = await overlayDuring(id, async () => {
        const refused = await preview(id, 'nope');
        assert.equal(refused.status, 400);
        assert.equal(refused.json().error, t('en', 'overlay.test.invalidType'));
        const next = await preview(id, 'follow'); // straight after: not held for 5 seconds
        assert.equal(next.status, 200);
        assert.deepEqual(next.json(), { ok: true });
        const held = await preview(id, 'raid'); // a real test does start it
        assert.equal(held.status, 429);
        const refusedAgain = await preview(id, 'nope'); // and a refusal inside it is still a refusal
        assert.equal(refusedAgain.status, 400);
      });
      assert.deepEqual(seen.map((event) => event.type), ['follow']);
    });

    test('names that are on every object are not alert types', async () => {
      const id = addStreamer({ twitch_username: 'somechannel' });
      const seen = await overlayDuring(id, async () => {
        for (const type of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
          assert.equal((await preview(id, type)).status, 400, type);
        }
      });
      assert.deepEqual(seen, []);
      assert.deepEqual(chatCalls, []);
    });
  });

  test('the chatbot test sends the thank-you as a test, and the sponsor test as a sponsor message', async () => {
    const id = addStreamer({ twitch_username: 'somechannel' });
    assert.deepEqual((await post('/dashboard/chatbot/test/follow', id)).json(), { ok: true });
    assert.deepEqual(chatCalls, [['event', id, 'follow', { username: 'TestRacer' }, { test: true }]]);

    const other = addStreamer({ twitch_username: 'otherchannel' });
    db.addSponsorMessage(other, 'Thanks to our sponsors', 'https://example.com');
    const messageId = db.getSponsorMessages(other)[0].id;
    assert.deepEqual((await post(`/dashboard/sponsor-messages/${messageId}/test`, other)).json(), { ok: true });
    assert.deepEqual(chatCalls[1], ['say', other, 'Thanks to our sponsors https://example.com', { priority: 'low' }]);
  });

  // The answers a test button's script shows are words from the language files, not text of the route's own.
  test('an event type that cannot be tested is answered with the translated message', async () => {
    const routes = [
      ['/dashboard/overlay/test/nope', 'overlay.test.invalidType'],
      ['/dashboard/chatbot/test/nope', 'chatbot.test.invalidType'],
      ['/dashboard/youtube-chatbot/test/nope', 'ytChatbot.error.invalidType'],
      ['/dashboard/youtube-chatbot/test-chat/nope', 'ytChatbot.error.invalidType'],
    ];
    for (const [route, key] of routes) {
      // one streamer per route: a second test within the cooldown would be held instead
      const res = await post(route, addStreamer({ twitch_username: 'somechannel' }));
      assert.equal(res.status, 400, route);
      assert.equal(res.json().error, t('en', key), route);
    }
  });
});

// The pages are rendered with stub locals in tests/streamerViewsI18n.test.js; this renders them with what their routes really pass
// (the account page is left out: it reads the language list server.js puts on every page, which this test app does not).
describe('the translated streamer pages render through their routes', () => {
  const html = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&#34;').replace(/'/g, '&#39;');

  test('each answers with its translated heading', async () => {
    const id = addStreamer({ twitch_username: 'somechannel' });
    const pages = [
      ['/dashboard/report', 'report.desc'],
      ['/dashboard/chatbot', 'chatbot.heading'],
      ['/dashboard/chatbot/mod-log', 'modLog.subtitle'],
      ['/dashboard/overlay', 'overlay.heading'],
      ['/dashboard/overlay-builder', 'overlayBuilder.heading'],
      ['/dashboard/youtube-chatbot', 'ytChatbot.heading'],
    ];
    for (const [route, key] of pages) {
      const res = await request('GET', route, { streamer: id });
      assert.equal(res.status, 200, route);
      assert.ok(res.text.includes(html(t('en', key))), `${route} shows ${key}`);
    }
  });

  test('the server pages (settings and statistics) too', async () => {
    const id = addStreamer({ twitch_username: 'somechannel' });
    db.upsertGuild('800000000000000001', id, 'Test Server');
    const settings = await request('GET', '/dashboard/guild/800000000000000001', { streamer: id });
    assert.equal(settings.status, 200);
    assert.ok(settings.text.includes(html(t('en', 'guild.addTwitchChannel'))));
    const stats = await request('GET', '/dashboard/guild/800000000000000001/stats', { streamer: id });
    assert.equal(stats.status, 200);
    assert.ok(stats.text.includes(html(t('en', 'guildStats.chartTitle'))));
  });
});

// A sentence that names a YouTube channel or the chat bot's account is built by the page around the name, which comes from the
// provider. The stub-based check of every such place is in tests/streamerViewsI18n.test.js; this one goes through the real routes.
describe('a name made of markup, printed in a sentence of a translated page', () => {
  const NAME = '<img src=x onerror=alert(1)> "double" \'single\' {{b}} $&';

  test('comes out as text on the YouTube chatbot page and on the chatbot page', async () => {
    const config = require('../config');
    const savedBot = config.bot.twitchUsername;
    config.bot.twitchUsername = NAME;
    try {
      const id = addStreamer({ twitch_username: 'somechannel', yt_access_token: 'synthetic-yt-token', yt_channel_name: NAME });
      for (const route of ['/dashboard/youtube-chatbot', '/dashboard/chatbot']) {
        const res = await request('GET', route, { streamer: id });
        assert.equal(res.status, 200, route);
        assert.ok(!res.text.includes('<img src=x onerror'), `${route} printed the name's own markup`);
        assert.ok(res.text.includes(`<strong>${esc(NAME)}</strong>`), `${route} prints the name once, in bold, as text`);
      }
    } finally {
      config.bot.twitchUsername = savedBot;
    }
  });
});

describe('the sponsor image upload', () => {
  test('an upload without a name is stored under the default sponsor name', async () => {
    // two streamers: a file is named by the millisecond, and one streamer's two quick uploads could share it
    const upload = (streamer, query) => request('POST', `/dashboard/sponsors/upload?${query}ext=png&dur=30`, { streamer, rawBody: 'not-really-a-png', contentType: 'application/octet-stream' });
    const unnamed = await upload(addStreamer(), '');
    assert.equal(unnamed.status, 200);
    assert.equal(unnamed.json().image.display_name, t('en', 'overlayBuilder.sponsors.defaultName'));
    const named = await upload(addStreamer(), 'name=Acme&');
    assert.equal(named.json().image.display_name, 'Acme');
  });

  test('a file type that is not an image is refused with the translated message', async () => {
    const res = await request('POST', '/dashboard/sponsors/upload?name=Acme&ext=exe', { streamer: addStreamer(), rawBody: 'x', contentType: 'application/octet-stream' });
    assert.equal(res.status, 400);
    assert.equal(res.json().error, t('en', 'upload.error.imageType'));
  });
});

describe('the profile picture upload', () => {
  const upload = (streamer, query, rawBody) => request('POST', `/dashboard/account/avatar${query}`, { streamer, rawBody, contentType: 'application/octet-stream' });

  test('a refused upload says why, with the translated message', async () => {
    const id = addStreamer();
    const wrongType = await upload(id, '?ext=exe', 'not a picture');
    assert.equal(wrongType.status, 400);
    assert.equal(wrongType.json().error, t('en', 'account.error.invalidType'));
    const empty = await upload(id, '?ext=png', '');
    assert.equal(empty.status, 400);
    assert.equal(empty.json().error, t('en', 'account.error.empty'));
  });
});

// ── Overlay builder: what may be saved (N17) ─────────────────────────────

describe('saving an overlay design', () => {
  const bus = require('../services/overlayBus');
  let id;
  beforeEach(() => { id = addStreamer(); });

  // What the builder's getControlValues() posts for a follow alert.
  const design = (over = {}) => ({
    bg_color: '#1a1a3e', accent_color: '#8888cc', border_color: '#8888cc', text_color: '#ffffff',
    font_family: 'Outfit', username_size: 24, event_label: 'New Pit Crew Member', detail_text: 'just joined the race',
    entrance_animation: 'slideDown', car_animation: 'zoomLR', screen_effect: 'default', animation_speed: 1,
    card_width: 420, card_position: 'top-center', card_custom_x: null, card_custom_y: null, border_radius: 16,
    sponsor_animation: 'fade', label_font_family: null, label_font_size: 10, label_font_weight: 700, label_color: null,
    username_font_family: null, username_font_weight: 800, username_color: null,
    detail_font_family: null, detail_font_size: 13, detail_font_weight: 400, detail_color: null,
    text_align: 'center', card_side_icon: null, effect_amount: 1, effect_size: 1, effect_direction: 'down',
    bg_opacity: 1, gradient_direction: '160deg', border_thickness: 2, border_opacity: 0.5,
    glow_intensity: 0.25, shadow_opacity: 0.6, shadow_blur: 32, shadow_spread: 0,
    ...over,
  });
  const save = (eventType, body, streamer = id) => request('POST', '/dashboard/overlay-builder/save', { streamer, body: { eventType, design: body } });
  const stored = (streamer = id) => db.getAllOverlayDesigns(streamer);

  test('saves what the builder sends and tells the open overlay', async () => {
    const pushed = [];
    const listener = (event) => pushed.push(event);
    bus.on(`overlay:${id}`, listener);
    try {
      const res = await save('follow', design({ bg_color: '#112233', card_side_icon: '\u{1F3C6}', username_size: 30 }));
      assert.equal(res.status, 200);
      assert.deepEqual(res.json(), { ok: true });
    } finally {
      bus.off(`overlay:${id}`, listener);
    }
    const [row] = stored();
    assert.equal(row.event_type, 'follow');
    assert.equal(row.bg_color, '#112233');
    assert.equal(row.card_side_icon, '\u{1F3C6}');
    assert.equal(row.username_size, 30);
    assert.equal(row.font_family, 'Outfit');
    assert.equal(pushed.length, 1);
    assert.equal(pushed[0].type, 'config-update');
    assert.equal(pushed[0].designs.follow.bg_color, '#112233');
  });

  test('every tab of the builder can be saved', async () => {
    const types = ['follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner', 'yt_superchat', 'yt_member', 'yt_giftmember', 'timed'];
    for (const type of types) assert.equal((await save(type, design())).status, 200, type);
    assert.deepEqual(stored().map((d) => d.event_type).sort(), [...types].sort());
  });

  test('another alert type is a 400 with a message, and nothing is stored', async () => {
    for (const type of ['chat', '', 'FOLLOW', "follow' OR '1'='1", '__proto__', undefined, 5, ['follow']]) {
      const res = await save(type, design());
      assert.equal(res.status, 400, String(type));
      assert.deepEqual(res.json(), { ok: false, error: 'That alert type cannot be designed here.' });
    }
    assert.deepEqual(stored(), []);
  });

  test('a design from an older builder is saved normalised, not refused', async () => {
    const res = await save('follow', design({
      username_size: 9999, card_width: 50, animation_speed: 99, shadow_blur: 1e9, border_radius: 18.5,
      font_family: 'Comic Sans MS', label_font_family: "x'; color: red",
      car_animation: 'bounce', screen_effect: 'goldRain', entrance_animation: 'explode', card_position: 'top-middle', text_align: 'justify',
      card_side_icon: '<img src=x onerror=alert(1)>',
      event_label: 'x'.repeat(101), detail_text: 'x'.repeat(301),
    }));
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { ok: true });
    const [row] = stored();
    assert.deepEqual([row.username_size, row.card_width, row.animation_speed, row.shadow_blur, row.border_radius], [52, 200, 2, 80, 19], 'numbers moved into range');
    assert.deepEqual([row.font_family, row.label_font_family], ['System Default', null], 'unknown fonts fall back');
    assert.deepEqual(
      [row.car_animation, row.screen_effect, row.entrance_animation, row.card_position, row.text_align],
      ['zoomLR', 'default', 'slideDown', 'top-center', 'center'],
      'unknown choices fall back to the default',
    );
    assert.equal(row.card_side_icon, null, 'an icon with markup in it is not stored');
    assert.equal(row.event_label, 'x'.repeat(100));
    assert.equal(row.detail_text, 'x'.repeat(300));
  });

  test('a value no builder could have sent is a 400 naming the field, and nothing is stored', async () => {
    const cases = [
      ['bg_color', 'red'], ['text_color', 'url(javascript:alert(1))'], ['accent_color', '#12345'],
      ['username_size', '24'], ['card_width', true], ['animation_speed', []], ['shadow_blur', {}],
      ['font_family', 5], ['label_font_family', ['Outfit']],
      ['entrance_animation', 5], ['card_position', true], ['label_font_weight', '700'],
      ['card_side_icon', 5], ['event_label', 5], ['detail_text', ['x']],
    ];
    for (const [field, value] of cases) {
      const res = await save('follow', design({ [field]: value }));
      assert.equal(res.status, 400, `${field}=${String(value).slice(0, 20)}`);
      const body = res.json();
      assert.equal(body.ok, false);
      assert.equal(body.field, field);
      assert.equal(body.error, `This design could not be saved: the value for "${field}" is not allowed.`);
    }
    assert.deepEqual(stored(), []);
  });

  test('a design that is missing, or not an object, is a 400 (it used to be a 500 when it was bad JSON text)', async () => {
    for (const bad of [undefined, null, 5, [], 'not json', '{"bg_color":']) {
      const res = await save('follow', bad);
      assert.equal(res.status, 400, JSON.stringify(bad));
      assert.equal(res.json().field, 'design');
    }
    assert.deepEqual(stored(), []);
  });

  test('a design sent as JSON text is still accepted', async () => {
    assert.equal((await save('follow', JSON.stringify(design({ bg_color: '#445566' })))).status, 200);
    assert.equal(stored()[0].bg_color, '#445566');
  });

  test('missing optional fields fall back to the stored defaults', async () => {
    assert.equal((await save('raid', { bg_color: '#010203' })).status, 200);
    const [row] = stored();
    assert.equal(row.bg_color, '#010203');
    assert.equal(row.accent_color, '#8888cc');
    assert.equal(row.username_size, 24);
    assert.equal(row.card_position, 'top-center');
  });

  test('extra fields in the post are not saved', async () => {
    const res = await save('follow', design({ id: 99, streamer_id: 12345, created_at: 'x', notes: '<script>' }));
    assert.equal(res.status, 200);
    const [row] = stored();
    assert.notEqual(row.id, 99);
    assert.equal(row.streamer_id, id);
    assert.equal('notes' in row, false);
  });

  test('saving never touches another streamer\'s designs', async () => {
    const other = addStreamer();
    await save('follow', design({ bg_color: '#aaaaaa' }), other);
    await save('follow', design({ bg_color: '#bbbbbb' }));
    assert.equal(stored(other)[0].bg_color, '#aaaaaa');
    assert.equal(stored()[0].bg_color, '#bbbbbb');
  });

  test('a value that is replaced takes its own alert\'s default, not the global one', async () => {
    assert.equal((await save('raid', design({ car_animation: 'bounce' }))).status, 200);
    assert.equal(stored().find((d) => d.event_type === 'raid').car_animation, 'none', 'the raid has no car');

    assert.equal((await save('timed', design({ car_animation: 'bounce', screen_effect: 'goldRain', card_position: 'nowhere' }))).status, 200);
    const timed = stored().find((d) => d.event_type === 'timed');
    assert.deepEqual([timed.car_animation, timed.screen_effect, timed.card_position], ['none', 'none', 'bot-center']);

    assert.equal((await save('bits', design({ car_animation: 'bounce', screen_effect: 'goldRain' }))).status, 200);
    const bits = stored().find((d) => d.event_type === 'bits');
    assert.deepEqual([bits.car_animation, bits.screen_effect], ['zoomLR', 'default'], 'the others keep the usual ones');
  });

  test('"Solid (no gradient)" is stored as "solid" and kept when the design is read back and saved again', async () => {
    assert.equal((await save('follow', design({ gradient_direction: 'solid' }))).status, 200);
    assert.equal(stored()[0].gradient_direction, 'solid');
    // the builder posts back what the page was given: the stored row's value
    assert.equal((await save('follow', design({ gradient_direction: stored()[0].gradient_direction, bg_color: '#223344' }))).status, 200);
    assert.equal(stored()[0].gradient_direction, 'solid');
    assert.equal(stored()[0].bg_color, '#223344');
    // the page that edits it is given the row with "solid" in it
    const page = await request('GET', '/dashboard/overlay-builder', { streamer: id });
    assert.match(page.text, /"gradient_direction":"solid"/);
  });

  test('an older builder page that sent an empty direction for solid still saves, as the diagonal it always became', async () => {
    assert.equal((await save('follow', design({ gradient_direction: '' }))).status, 200);
    assert.equal(stored()[0].gradient_direction, '160deg');
  });

  test('every gradient direction the builder offers is stored as chosen', async () => {
    for (const direction of ['160deg', '180deg', '0deg', '90deg', '270deg', '135deg', '45deg', 'solid']) {
      assert.equal((await save('follow', design({ gradient_direction: direction }))).status, 200, direction);
      assert.equal(stored()[0].gradient_direction, direction, direction);
    }
  });

  test('a label the server must cut is cut at what the builder lets a streamer type', async () => {
    assert.equal((await save('follow', design({ event_label: 'x'.repeat(100), detail_text: 'y'.repeat(300) }))).status, 200);
    assert.deepEqual([stored()[0].event_label.length, stored()[0].detail_text.length], [100, 300], 'what fits is kept whole');
  });

  test('reset needs one of the builder\'s alert types, and removes only that design', async () => {
    await save('follow', design());
    await save('raid', design());
    const reset = (eventType) => request('POST', '/dashboard/overlay-builder/reset', { streamer: id, body: { eventType } });
    for (const bad of ['', 'chat', undefined, 5]) {
      const res = await reset(bad);
      assert.equal(res.status, 400, String(bad));
      assert.equal(res.json().ok, false);
    }
    assert.equal(stored().length, 2);
    const res = await reset('follow');
    assert.deepEqual(res.json(), { ok: true });
    assert.deepEqual(stored().map((d) => d.event_type), ['raid']);
  });
});

// ── YouTube chatbot: errors are codes, not text from the URL (N22) ───────

describe('the YouTube chatbot page errors', () => {
  let id;
  beforeEach(() => { id = addStreamer({ yt_access_token: 'yt-access' }); });
  const connect = (streamer = id) => request('POST', '/dashboard/youtube-chatbot/connect', { streamer });
  const codeOf = (res) => new URL(res.headers.location, 'http://x').searchParams.get('error');
  const html = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&#34;').replace(/'/g, '&#39;');

  test('connecting without a linked YouTube account answers not_connected', async () => {
    const res = await connect(addStreamer());
    assert.equal(res.status, 302);
    assert.equal(codeOf(res), 'not_connected');
  });

  test('a token that cannot be refreshed answers token_refresh', async () => {
    db.db.prepare('UPDATE streamers SET yt_token_expires_at = ? WHERE id = ?').run(Date.now() - 1000, id);
    youtubeApi.refreshed = null;
    assert.equal(codeOf(await connect()), 'token_refresh');
  });

  test('no live stream answers no_live_stream', async () => {
    youtubeApi.broadcast = null;
    assert.equal(codeOf(await connect()), 'no_live_stream');
    youtubeApi.broadcast = { title: 'No chat id' };
    assert.equal(codeOf(await connect()), 'no_live_stream');
  });

  test('a failing YouTube call answers connect_failed, and its message never goes into the URL', async () => {
    youtubeApi.fail = 'socket hang up at 10.1.2.3';
    const res = await connect();
    assert.equal(codeOf(res), 'connect_failed');
    assert.ok(!decodeURIComponent(res.headers.location).includes('10.1.2.3'));
    assert.ok(logs.some(([level, line]) => level === 'error' && line.includes('socket hang up')), 'it is logged on the server');
  });

  test('every redirect carries a code of letters and underscores, never sentences', async () => {
    const outcomes = [];
    outcomes.push(codeOf(await connect(addStreamer())));
    youtubeApi.broadcast = null;
    outcomes.push(codeOf(await connect()));
    youtubeApi.fail = 'boom';
    outcomes.push(codeOf(await connect()));
    for (const code of outcomes) assert.match(code, /^[a-z_]+$/);
  });

  test('a live stream connects: the chatbot is switched on and polling starts', async () => {
    youtubeApi.broadcast = { liveChatId: 'abc123', title: 'Racing' };
    const res = await connect();
    assert.equal(res.headers.location, '/dashboard/youtube-chatbot?connected=1');
    assert.equal(db.getStreamerById(id).yt_chatbot_enabled, 1);
    assert.deepEqual(managerCalls, [['yt.start', id, 'abc123']]);
  });

  test('the page shows the translated message for each code', async () => {
    const messages = {
      not_connected: t('en', 'ytChatbot.error.notConnected'),
      token_refresh: t('en', 'ytChatbot.error.tokenRefresh'),
      no_live_stream: t('en', 'ytChatbot.error.noLiveStream'),
      connect_failed: t('en', 'ytChatbot.error.connectFailed'),
    };
    for (const [code, message] of Object.entries(messages)) {
      const res = await request('GET', `/dashboard/youtube-chatbot?error=${code}`, { streamer: addStreamer() });
      assert.equal(res.status, 200, code);
      assert.ok(res.text.includes('id="yt-error"'), code);
      assert.ok(res.text.includes(html(message)), `${code}: ${message}`);
    }
  });

  test('text made up in the URL is not shown as an error', async () => {
    const forged = 'Your channel was banned. Call 555-0100 to appeal.';
    const res = await request('GET', `/dashboard/youtube-chatbot?error=${encodeURIComponent(forged)}`, { streamer: addStreamer() });
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes('Call 555-0100'));
    assert.ok(!res.text.includes('id="yt-error"'), 'no error banner');
    const inherited = await request('GET', '/dashboard/youtube-chatbot?error=constructor', { streamer: addStreamer() });
    assert.ok(!inherited.text.includes('id="yt-error"'), 'a name that exists on every object is not a code');
  });

  // The Google sign-in lands on /auth/youtube/callback, which sends the streamer back
  // to this page: the page must be able to say what happened.
  test('the Google sign-in sends the streamer back with a code the page shows as a message', async () => {
    const owner = addStreamer();
    const cases = [
      ['access denied at Google', `/auth/youtube/callback?error=access_denied&state=${owner}`, 'oauth_denied', 'ytChatbot.error.oauthDenied'],
      ['no code and no state', '/auth/youtube/callback', 'oauth_state', 'ytChatbot.error.oauthState'],
      ['a state that is not this streamer', `/auth/youtube/callback?code=abc&state=${owner + 1000}`, 'oauth_state', 'ytChatbot.error.oauthState'],
    ];
    for (const [label, url, code, key] of cases) {
      const res = await request('GET', url, { streamer: owner });
      assert.equal(res.status, 302, label);
      assert.equal(res.headers.location, `/dashboard/youtube-chatbot?error=${code}`, label);
      const page = await request('GET', res.headers.location, { streamer: owner });
      assert.equal(page.status, 200, label);
      assert.ok(page.text.includes('id="yt-error"'), `${label}: the page shows a banner`);
      assert.ok(page.text.includes(html(t('en', key))), `${label}: ${t('en', key)}`);
    }
  });

  test('a failed token exchange sends oauth_failed, and what went wrong stays in the server log', async () => {
    const owner = addStreamer();
    // Started from the page, as a browser does: the state Google sends back, and its cookie.
    const start = await request('GET', '/auth/youtube', { streamer: owner });
    const state = new URL(start.headers.location).searchParams.get('state');
    const cookie = start.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
    const guard = global.fetch;
    const calls = [];
    global.fetch = async (url) => { calls.push(String(url)); return { ok: false, status: 400, json: async () => ({}) }; };
    let res;
    try {
      res = await request('GET', `/auth/youtube/callback?code=expired-code&state=${state}`, { streamer: owner, cookie });
    } finally {
      global.fetch = guard;
    }
    assert.deepEqual(calls, ['https://oauth2.googleapis.com/token']);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/dashboard/youtube-chatbot?error=oauth_failed');
    assert.ok(!decodeURIComponent(res.headers.location).includes('Token exchange'), 'our own error text is not put in the URL');
    assert.ok(logs.some(([level, line]) => level === 'error' && line.includes('Token exchange failed: 400')), 'it is logged on the server');
    const page = await request('GET', res.headers.location, { streamer: owner });
    assert.ok(page.text.includes(html(t('en', 'ytChatbot.error.oauthFailed'))));
  });

  // The Google sign-in ends with ?connected_yt=1 (the account is connected); ?connected=1 is
  // the other success: the bot joined the live chat. The page tells them apart.
  test('the page confirms a connected YouTube account for ?connected_yt=1, in words that differ from ?connected=1', async () => {
    const owner = addStreamer();
    const account = await request('GET', '/dashboard/youtube-chatbot?connected_yt=1', { streamer: owner });
    assert.equal(account.status, 200);
    assert.ok(account.text.includes('id="yt-account-connected"'), 'the notice is there');
    assert.ok(account.text.includes(html(t('en', 'ytChatbot.accountLinked', { button: t('en', 'ytChatbot.connectLive') }))));
    assert.ok(!account.text.includes(html(t('en', 'ytChatbot.connected'))), 'it is not the live-chat message');

    const live = await request('GET', '/dashboard/youtube-chatbot?connected=1', { streamer: owner });
    assert.ok(live.text.includes(html(t('en', 'ytChatbot.connected'))));
    assert.ok(!live.text.includes('id="yt-account-connected"'));

    const plain = await request('GET', '/dashboard/youtube-chatbot', { streamer: owner });
    assert.ok(!plain.text.includes('id="yt-account-connected"'), 'no notice without the query');
  });

  test('the chat-only test answers with translated messages', async () => {
    const test = () => request('POST', '/dashboard/youtube-chatbot/test-chat/member', { streamer: addStreamer({ yt_chat_member_template: '' }) });
    // not polling
    assert.equal((await test()).json().error, t('en', 'ytChatbot.error.botNotPolling'));
    // polling, but no template for the event
    const noTemplate = addStreamer({ yt_chat_member_template: '' });
    ytPolling.add(noTemplate);
    const res = await request('POST', '/dashboard/youtube-chatbot/test-chat/member', { streamer: noTemplate });
    assert.equal(res.json().error, t('en', 'ytChatbot.error.noTemplate'));
    // polling with a template, but the bot has no token
    const withTemplate = addStreamer({ yt_chat_member_template: 'Welcome {username}!' });
    ytPolling.add(withTemplate);
    youtubeApi.botToken = null;
    const noToken = await request('POST', '/dashboard/youtube-chatbot/test-chat/member', { streamer: withTemplate });
    assert.equal(noToken.json().error, t('en', 'ytChatbot.error.botToken'));
    // and a send that works
    const working = addStreamer({ yt_chat_member_template: 'Welcome {username}!' });
    ytPolling.add(working);
    youtubeApi.botToken = 'bot-token';
    const sent = await request('POST', '/dashboard/youtube-chatbot/test-chat/member', { streamer: working });
    assert.deepEqual(sent.json(), { ok: true });
    assert.deepEqual(youtubeApi.sent, [['live-chat-1', 'Welcome NewFan!', 'bot-token']]);
  });

  test('a send that throws is a generic message, not the internal error', async () => {
    const streamer = addStreamer({ yt_chat_member_template: 'Welcome {username}!' });
    ytPolling.add(streamer);
    youtubeApi.botToken = 'bot-token';
    const original = youtubeStub.sendYoutubeChatMessage;
    youtubeStub.sendYoutubeChatMessage = async () => { throw new Error('quota exceeded for key AIza-secret'); };
    try {
      const res = await request('POST', '/dashboard/youtube-chatbot/test-chat/member', { streamer });
      assert.deepEqual(res.json(), { ok: false, error: t('en', 'ytChatbot.error.sendFailed') });
      assert.ok(!res.text.includes('AIza-secret'));
    } finally {
      youtubeStub.sendYoutubeChatMessage = original;
    }
  });
});

// ── Pages that wait on Twitch or YouTube have a deadline (N23) ───────────

// Waits until `check()` is true (a background job finishing), up to `ms`.
async function until(check, ms = 1500) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the background work');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('the overlay builder page and a slow Twitch', () => {
  let id;
  beforeEach(() => { id = addStreamer({ twitch_username: 'somestreamer' }); });
  const builder = () => request('GET', '/dashboard/overlay-builder', { streamer: id, json: true });

  test('shows the live stream\'s thumbnail', async () => {
    twitch.stream = { thumbnail_url: 'https://img.test/live-{width}x{height}.jpg' };
    const res = await builder();
    assert.equal(res.status, 200);
    assert.equal(res.json().locals.streamThumbnail, 'https://img.test/live-1280x720.jpg');
  });

  test('not live: the latest VOD\'s thumbnail', async () => {
    twitch.videos = [{ thumbnail_url: 'https://img.test/vod-%{width}x%{height}.jpg' }];
    const res = await builder();
    assert.equal(res.json().locals.streamThumbnail, 'https://img.test/vod-1280x720.jpg');
  });

  test('no stream and no VOD still gives the page, without a thumbnail', async () => {
    const res = await builder();
    assert.equal(res.status, 200);
    assert.equal(res.json().locals.streamThumbnail, null);
  });

  test('a Twitch that never answers holds the page for 3 seconds in total, then the page comes without a thumbnail', async () => {
    twitch.hang = true;
    const started = Date.now();
    const res = await builder();
    const took = Date.now() - started;
    assert.equal(res.status, 200);
    assert.equal(res.json().locals.streamThumbnail, null);
    assert.ok(took >= 2800 && took < 4500, `took ${took} ms`);
    assert.deepEqual(twitch.calls.map((c) => c[0]), ['getStream'], 'the deadline was used up by the first call; the VOD calls were not tried');
  });

  test('the page also renders in full (the template compiles with the new local)', async () => {
    twitch.stream = { thumbnail_url: 'https://img.test/live-{width}x{height}.jpg' };
    const res = await request('GET', '/dashboard/overlay-builder', { streamer: id });
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('https://img.test/live-1280x720.jpg'));
  });

  test('hands the page the server\'s default design for every alert, which is the table the save falls back to', async () => {
    const { EVENT_DEFAULTS } = require('../services/overlayDesign');
    const { locals } = (await builder()).json();
    assert.deepEqual(JSON.parse(locals.eventDefaults), JSON.parse(JSON.stringify(EVENT_DEFAULTS)));
    const page = await request('GET', '/dashboard/overlay-builder', { streamer: id });
    assert.match(page.text, /const EVENT_DEFAULTS = \{"follow":\{/);
    for (const type of ['follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner', 'yt_superchat', 'yt_member', 'yt_giftmember', 'timed']) {
      assert.ok(page.text.includes(`"${type}":{`), type);
    }
  });

  test('a "</script>" in nothing the page is given can end its inline script (the default table is escaped like the rest)', async () => {
    const page = await request('GET', '/dashboard/overlay-builder', { streamer: id });
    const defaultsLine = page.text.split('\n').find((line) => line.startsWith('const EVENT_DEFAULTS = '));
    assert.ok(defaultsLine, 'found the injected table');
    assert.ok(!defaultsLine.includes('<'), 'no "<" in the injected table');
  });
});

describe('the YouTube chatbot page and a slow YouTube', () => {
  const page = (over = {}) => request('GET', '/dashboard/youtube-chatbot', { streamer: addStreamer({ yt_access_token: 'yt-access', ...over }) });

  test('live: shows LIVE and the broadcast title', async () => {
    youtubeApi.broadcast = { liveChatId: 'chat-1', title: 'Race night' };
    const res = await page();
    assert.equal(res.status, 200);
    assert.match(res.text, /LIVE/);
    assert.ok(res.text.includes('Race night'));
    assert.ok(!res.text.includes('id="yt-live-unknown"'));
  });

  test('not live: shows Offline', async () => {
    const res = await page();
    assert.match(res.text, />Offline</);
    assert.ok(!res.text.includes('id="yt-live-unknown"'));
  });

  test('YouTube failing or not answering: the page still comes, and says it could not check instead of Offline', async () => {
    youtubeApi.fail = 'socket hang up';
    const res = await page();
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('id="yt-live-unknown"'));
    assert.ok(res.text.includes(t('en', 'ytChatbot.liveStatusUnknown')));
    assert.doesNotMatch(res.text, />Offline</);
  });

  test('an expired token that cannot be renewed also says it could not check', async () => {
    youtubeApi.refreshed = null;
    const res = await page({ yt_token_expires_at: Date.now() - 1000 });
    assert.ok(res.text.includes('id="yt-live-unknown"'));
  });

  test('without a connected account there is no live check at all', async () => {
    youtubeApi.fail = 'must not be called';
    const res = await request('GET', '/dashboard/youtube-chatbot', { streamer: addStreamer() });
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes('id="yt-live-unknown"'));
  });
});

describe('the server page and the channels with a missing picture', () => {
  const G = '800000000000000001';
  let id;
  beforeEach(() => {
    id = addStreamer();
    db.upsertGuild(G, id, 'Server');
    guilds.set(G, fakeGuild(G));
  });
  const page = () => request('GET', `/dashboard/guild/${G}?tab=twitch`, { streamer: id, json: true });
  const twitchRow = (name = 'somestreamer') => db.getWatchedChannelsForGuild(G, id).find((w) => w.twitch_username === name);
  const youtubeRow = () => db.getWatchedYoutubeChannelsForGuild(G, id)[0];

  test('the page does not wait for Twitch: it comes at once while the picture is looked up afterwards', async () => {
    db.addWatchedChannel(G, id, 'somestreamer', CH_LIVE, null, true, false, null);
    twitch.beforeAnswer = () => new Promise(() => {}); // Twitch never answers
    const started = Date.now();
    const res = await page();
    assert.equal(res.status, 200);
    assert.ok(Date.now() - started < 1000, 'it did not wait for the lookup');
    assert.equal(res.json().locals.watchedTwitchChannels[0].profile_image_url, null);
    await until(() => twitch.lookups.length === 1);
    assert.deepEqual(twitch.lookups, ['somestreamer']);
  });

  test('the picture that was found shows on the next load', async () => {
    db.addWatchedChannel(G, id, 'somestreamer', CH_LIVE, null, true, false, null);
    twitch.users.somestreamer = { id: '1', login: 'somestreamer', profile_image_url: 'https://img.test/a.png' };
    const first = await page();
    assert.equal(first.json().locals.watchedTwitchChannels[0].profile_image_url, null, 'not part of the first page');
    await until(() => twitchRow().profile_image_url);
    const second = await page();
    assert.equal(second.json().locals.watchedTwitchChannels[0].profile_image_url, 'https://img.test/a.png');
    assert.deepEqual(twitch.lookups, ['somestreamer'], 'a picture that is there is not looked up again');
  });

  test('a row is tried once per 24 hours: loading the page again does not repeat a failed or empty lookup', async () => {
    db.addWatchedChannel(G, id, 'somestreamer', CH_LIVE, null, true, false, null);
    twitch.failWith = 'Twitch API error: 500';
    assert.equal((await page()).status, 200);
    await until(() => twitchRow().info_attempted_at);
    assert.equal(twitch.lookups.length, 1);

    for (let i = 0; i < 3; i++) assert.equal((await page()).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(twitch.lookups.length, 1, 'no second attempt within 24 hours');

    // 25 hours later the row is tried again.
    db.db.prepare('UPDATE watched_channels SET info_attempted_at = ? WHERE id = ?').run(new Date(Date.now() - 25 * 3600_000).toISOString(), twitchRow().id);
    await page();
    await until(() => twitch.lookups.length === 2);
    assert.match(twitchRow().info_attempted_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(Date.now() - Date.parse(twitchRow().info_attempted_at) < 5000, 'the time of the new attempt was stored');
  });

  test('a row with a picture is never looked up, and neither is one tried an hour ago', async () => {
    db.addWatchedChannel(G, id, 'haspicture', CH_LIVE, null, true, false, 'https://img.test/there.png');
    db.addWatchedChannel(G, id, 'triedrecently', CH_LIVE, null, true, false, null);
    db.db.prepare('UPDATE watched_channels SET info_attempted_at = ? WHERE twitch_username = ?').run(new Date(Date.now() - 3600_000).toISOString(), 'triedrecently');
    assert.equal((await page()).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(twitch.lookups, []);
  });

  test('YouTube channels without a name or picture are filled in after the page too', async () => {
    db.addWatchedYoutubeChannel(G, id, 'UCabc', null, CH_LIVE, null, null);
    youtubeApi.channelInfo = { profileImageUrl: 'https://img.test/yt.png', channelName: 'Some Channel' };
    const first = await page();
    assert.equal(first.status, 200);
    assert.equal(first.json().locals.watchedYoutubeChannels[0].youtube_channel_name, null);
    await until(() => youtubeRow().youtube_channel_name);
    assert.equal(youtubeRow().youtube_channel_name, 'Some Channel');
    assert.equal(youtubeRow().profile_image_url, 'https://img.test/yt.png');
    assert.deepEqual(youtubeApi.infoCalls, ['UCabc']);
    await page();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(youtubeApi.infoCalls, ['UCabc'], 'filled in once, not looked up again');
  });

  test('live status is still shown (it only reads our own tables)', async () => {
    db.addWatchedChannel(G, id, 'somestreamer', CH_LIVE, null, true, false, 'https://img.test/a.png');
    db.updateChannelState('somestreamer', { is_live: 1 });
    const res = await page();
    assert.equal(res.json().locals.watchedTwitchChannels[0].is_live, true);
  });
});

// ── AI analysis of a reported issue: one at a time, once, five a day (N25) ──

describe('the AI analysis of a reported issue', () => {
  const config = require('../config');
  let apiKey;
  let id;
  before(() => { apiKey = config.anthropic.apiKey; config.anthropic.apiKey = 'test-key'; });
  after(() => { config.anthropic.apiKey = apiKey; });
  beforeEach(() => { id = addStreamer(); });

  const report = (streamer = id) => Number(db.createIssue(streamer, 'streamer', 'Overlay is blank', 'It shows nothing in OBS'));
  const analyze = (issueId, streamer = id) => request('POST', `/dashboard/report/${issueId}/analyze`, { streamer });
  const row = (issueId) => db.getIssueById(issueId);
  const setAnalysis = (issueId, status, minutesAgo) => db.db.prepare('UPDATE issues SET agent_status = ?, agent_analyzed_at = ? WHERE id = ?')
    .run(status, minutesAgo == null ? null : new Date(Date.now() - minutesAgo * 60_000).toISOString(), issueId);

  test('starts an analysis: the issue is marked analyzing with its start time, and the analysis runs', async () => {
    const issueId = report();
    const res = await analyze(issueId);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { ok: true, status: 'analyzing' });
    assert.equal(row(issueId).agent_status, 'analyzing');
    assert.ok(Date.now() - Date.parse(row(issueId).agent_analyzed_at) < 5000);
    assert.deepEqual(analyses, [issueId]);
  });

  test('refuses a second request while the issue is being analysed', async () => {
    const issueId = report();
    await analyze(issueId);
    const again = await analyze(issueId);
    assert.equal(again.status, 409);
    assert.deepEqual(again.json(), { ok: false, status: 'analyzing', error: 'This issue is already being analyzed.' });
    assert.deepEqual(analyses, [issueId], 'the analysis was not started a second time');
  });

  test('two requests at the same moment start one analysis', async () => {
    const issueId = report();
    const results = await Promise.all([analyze(issueId), analyze(issueId)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(analyses.length, 1);
  });

  test('refuses an issue that is done', async () => {
    const issueId = report();
    setAnalysis(issueId, 'done', 60 * 24 * 7);
    const res = await analyze(issueId);
    assert.equal(res.status, 409);
    assert.deepEqual(res.json(), { ok: false, status: 'done', error: 'This issue has already been analyzed.' });
    assert.deepEqual(analyses, []);
    assert.equal(row(issueId).agent_status, 'done');
  });

  test('allows another try after an error, and after an analysis that died with a restart', async () => {
    const failed = report();
    setAnalysis(failed, 'error', 5);
    assert.equal((await analyze(failed)).status, 200);

    const stuck = report();
    setAnalysis(stuck, 'analyzing', 20); // started 20 minutes ago: it never finished
    assert.equal((await analyze(stuck)).status, 200);

    const running = report();
    setAnalysis(running, 'analyzing', 5); // started 5 minutes ago: still running
    assert.equal((await analyze(running)).status, 409);

    const unknownStart = report();
    setAnalysis(unknownStart, 'analyzing', null);
    assert.equal((await analyze(unknownStart)).status, 200);
    assert.deepEqual(analyses, [failed, stuck, unknownStart]);
  });

  test('a streamer gets five analyses a day; the sixth is refused with a message and nothing is started', async () => {
    for (let i = 0; i < 5; i++) {
      const issueId = report();
      assert.equal((await analyze(issueId)).status, 200, `analysis ${i + 1}`);
    }
    const sixth = report();
    const res = await analyze(sixth);
    assert.equal(res.status, 429);
    assert.deepEqual(res.json(), { ok: false, status: 'limit', error: 'At most 5 issues can be analyzed per day. Please try again tomorrow.' });
    assert.equal(analyses.length, 5);
    assert.equal(row(sixth).agent_status, null, 'the refused issue was not claimed');
  });

  test('the limit counts the last 24 hours, and each streamer has their own', async () => {
    const old = [];
    for (let i = 0; i < 5; i++) { const issueId = report(); setAnalysis(issueId, 'done', 25 * 60); old.push(issueId); }
    assert.equal((await analyze(report())).status, 200, 'five analyses 25 hours ago do not count');

    const busy = addStreamer();
    for (let i = 0; i < 5; i++) setAnalysis(report(busy), 'done', 60);
    assert.equal((await analyze(report(busy), busy)).status, 429);
    assert.equal((await analyze(report(), id)).status, 200, 'another streamer is not held up');
  });

  test('another streamer\'s issue and an unknown issue are 404', async () => {
    const other = addStreamer();
    const theirs = report(other);
    const res = await analyze(theirs);
    assert.equal(res.status, 404);
    assert.equal((await analyze(99999)).status, 404);
    assert.equal(row(theirs).agent_status, null);
    assert.deepEqual(analyses, []);
  });

  test('without an API key it does nothing and claims nothing', async () => {
    const issueId = report();
    config.anthropic.apiKey = '';
    try {
      const res = await analyze(issueId);
      assert.deepEqual(res.json(), { ok: true, status: 'skipped' });
    } finally {
      config.anthropic.apiKey = 'test-key';
    }
    assert.equal(row(issueId).agent_status, null);
    assert.deepEqual(analyses, []);
  });

  test('an analysis that fails is stored as an error, so it can be tried again', async () => {
    const issueId = report();
    agentTriageStub.failWith = 'API down';
    assert.equal((await analyze(issueId)).status, 200);
    await until(() => row(issueId).agent_status === 'error');
    assert.deepEqual(JSON.parse(row(issueId).agent_analysis), { error: 'API down' });
    agentTriageStub.failWith = null;
    assert.equal((await analyze(issueId)).status, 200);
  });
});

// ── What the giveaway, sponsor-message, donation-history and server-list routes say is in the streamer's language ──

describe('the messages and names those routes show', () => {
  let id;
  beforeEach(() => { id = addStreamer({ chatbot_enabled: 1 }); });

  test('a giveaway cannot start while the chatbot is off: it says so and starts nothing', async () => {
    const off = addStreamer({ chatbot_enabled: 0 });
    const res = await request('POST', '/dashboard/giveaways/start', { streamer: off, body: { keyword: 'gw' } });
    assert.equal(res.status, 409);
    assert.deepEqual(res.json(), { ok: false, code: 'chatbot_off', error: t('en', 'giveaways.error.chatbotOff') });
    assert.equal(count('giveaways', 'streamer_id = ?', off), 0);
  });

  test('starting a giveaway with values that are not allowed says which, in words', async () => {
    const start = (body) => request('POST', '/dashboard/giveaways/start', { streamer: id, body });
    const answers = [
      [{ keyword: 'no spaces!' }, 'giveaways.error.invalidKeyword'],
      [{ keyword: 'ok', duration_seconds: 5 }, 'giveaways.error.invalidDuration'],
      [{ keyword: 'ok', winners_count: 99 }, 'giveaways.error.invalidWinners'],
      [{ keyword: 'ok', prize: 'p'.repeat(101) }, 'giveaways.error.invalidPrize'],
    ];
    for (const [body, key] of answers) {
      const res = await start(body);
      assert.equal(res.status, 400, key);
      assert.equal(res.json().error, t('en', key), key);
    }
    assert.equal(count('giveaways', 'streamer_id = ?', id), 0, 'nothing was started');
  });

  test('a second giveaway, a missing one and deleting an open one each get their own message', async () => {
    const open = db.insertGiveaway({ streamer_id: id, keyword: 'open', status: 'open' });
    const again = await request('POST', '/dashboard/giveaways/start', { streamer: id, body: { keyword: 'again' } });
    assert.equal(again.status, 409);
    assert.equal(again.json().error, t('en', 'giveaways.error.alreadyActive'));

    const missing = await request('POST', '/dashboard/giveaways/999999/pick', { streamer: id, body: {} });
    assert.equal(missing.status, 404);
    assert.equal(missing.json().error, t('en', 'giveaways.error.notFound'));

    const deleting = await request('DELETE', `/dashboard/giveaways/${open.id}`, { streamer: id });
    assert.equal(deleting.status, 409);
    assert.equal(deleting.json().error, t('en', 'giveaways.error.closeFirst'));
  });

  test('a pick that finds the giveaway gone is answered in words, never with the code', async () => {
    const giveaway = db.insertGiveaway({ streamer_id: id, keyword: 'gone', status: 'closed' });
    const manager = require('../services/giveawayManager');
    const original = manager.pickWinners;
    manager.pickWinners = () => ({ winners: [], error: 'not_found' }); // deleted between the lookup and the draw
    try {
      const res = await request('POST', `/dashboard/giveaways/${giveaway.id}/pick`, { streamer: id, body: {} });
      assert.equal(res.status, 404);
      assert.deepEqual(res.json(), { error: t('en', 'giveaways.error.notFound') });
      assert.ok(!res.text.includes('not_found'));
    } finally {
      manager.pickWinners = original;
    }
  });

  test('adding a sponsor message restarts the chat rotation, so the first one starts it', async () => {
    const res = await request('POST', '/dashboard/sponsor-messages/add', { streamer: id, body: { message_text: 'Thanks to our partner!' } });
    assert.equal(res.status, 200);
    assert.deepEqual(sponsorCalls, [['sponsors.restartChat', id]]);
  });

  test('a sponsor message with no text, and a test of one that is gone, are refused in words', async () => {
    const add = await request('POST', '/dashboard/sponsor-messages/add', { streamer: id, body: { message_text: '' } });
    assert.equal(add.status, 400);
    assert.equal(add.json().error, t('en', 'sponsors.error.textRequired'));

    const test = await request('POST', '/dashboard/sponsor-messages/999999/test', { streamer: id });
    assert.deepEqual(test.json(), { ok: false, error: t('en', 'sponsors.error.notFound') });
  });

  test('the donation history shows a donor with no name as the translated word, and keeps real names', async () => {
    db.logDonation(id, { source: 'paypal', donor_name: '', amount: 5, currency: 'EUR', external_id: 'route-anon-1' });
    db.logDonation(id, { source: 'paypal', donor_name: 'Synthetic Donor', amount: 6, currency: 'EUR', external_id: 'route-anon-2' });
    const rows = (await request('GET', '/dashboard/donations/history', { streamer: id, json: true })).json().locals.donations;
    assert.deepEqual(rows.map((d) => d.donor_name).sort(), ['Synthetic Donor', null]);
    const page = await request('GET', '/dashboard/donations/history', { streamer: id });
    assert.ok(page.text.includes(`<td class="dh-donor">${t('en', 'donations.history.anonymous')}</td>`));
    assert.ok(page.text.includes('<td class="dh-donor">Synthetic Donor</td>'));
    // the stored name and the CSV keep what was recorded
    assert.equal(db.getDonations(id, { sinceDays: 30, limit: 10, offset: 0 }).filter((d) => d.donor_name === 'Anonymous').length, 1);
  });

  test('a server the bot cannot see is listed under a translated name', async () => {
    db.upsertGuild('800000000000000001', id, '');
    const res = await request('GET', '/dashboard', { streamer: id, json: true });
    assert.equal(res.json().locals.guilds[0].name, t('en', 'dashboard.unknownServer'));
  });
});

// ── Channel point rewards: edits and deletes are only done when Twitch took them (N15) ──

describe('channel point rewards', () => {
  let id;
  let guard;
  let helix;
  let rewardCounter = 0; // makes titles, files, Twitch reward ids and Twitch user ids unique

  // A small fake Helix: `fail` makes every request with that method answer that status.
  function fakeHelix() {
    const state = { calls: [], fail: {} };
    global.fetch = async (url, opts = {}) => {
      const u = new URL(url);
      const method = opts.method || 'GET';
      state.calls.push({ method, path: u.pathname.replace('/helix', ''), query: Object.fromEntries(u.searchParams), body: opts.body ? JSON.parse(opts.body) : undefined });
      const failure = state.fail[method];
      if (failure) return { ok: false, status: failure.status, statusText: String(failure.status), json: async () => ({ message: failure.message || 'failed' }), text: async () => '' };
      if (method === 'DELETE') return { ok: true, status: 204, json: async () => null, text: async () => '' };
      return { ok: true, status: 200, json: async () => ({ data: [{}] }), text: async () => '' };
    };
    return state;
  }

  beforeEach(() => {
    guard = global.fetch;
    helix = fakeHelix();
    id = addStreamer({ twitch_user_id: `tw-user-${++rewardCounter}`, broadcaster_access_token: 'synthetic-token', broadcaster_refresh_token: 'synthetic-refresh' });
  });
  afterEach(() => { global.fetch = guard; });

  function addReward(streamerId, over = {}) {
    const row = db.insertReward({
      streamer_id: streamerId, title: `Reward ${++rewardCounter}`, cost: 500, prompt: null, cooldown_seconds: 0, enabled: 1,
      media_type: 'audio', media_filename: `zz-route-test-${rewardCounter}.mp3`, media_mime: 'audio/mpeg', media_size_bytes: 10,
      position_preset: 'center-large', custom_x: null, custom_y: null, custom_w: null, custom_h: null,
      volume: 1, max_play_seconds: 15, chat_message_template: null, auto_fulfill: 1, sort_order: rewardCounter, twitch_sync_status: 'ok',
      ...over,
    });
    db.setRewardTwitchId(row.id, over.twitch_reward_id || `route-tw-${rewardCounter}`, over.twitch_sync_status || 'ok');
    return Number(row.id);
  }
  const rewardRow = (rewardId, streamerId = id) => db.getRewardById(rewardId, streamerId);
  const patch = (rewardId, body, streamer = id) => request('PATCH', `/dashboard/redemptions/${rewardId}`, { streamer, body });
  const del = (rewardId, streamer = id) => request('DELETE', `/dashboard/redemptions/${rewardId}`, { streamer });
  const retry = (rewardId, streamer = id) => request('POST', `/dashboard/redemptions/${rewardId}/retry`, { streamer });

  test('an edit Twitch takes is saved and reported as done', async () => {
    const rewardId = addReward(id);
    const res = await patch(rewardId, { title: 'Big Horn', enabled: 0 });
    assert.equal(res.status, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.reward.title, 'Big Horn');
    assert.equal(body.reward.twitch_sync_status, 'ok');
    assert.deepEqual(helix.calls.find((c) => c.method === 'PATCH').body, { title: 'Big Horn', is_paused: true });
  });

  test('an edit Twitch refuses is saved here but reported as an error, and the reward is marked', async () => {
    const rewardId = addReward(id);
    helix.fail.PATCH = { status: 500, message: 'Twitch is having a problem' };
    const res = await patch(rewardId, { enabled: 0 });
    assert.equal(res.status, 502);
    const body = res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, t('en', 'redemptions.error.updateFailed'));
    assert.equal(body.reward.enabled, 0);
    assert.equal(body.reward.twitch_sync_status, 'update_failed');
    assert.equal(rewardRow(rewardId).enabled, 0, 'saved here');
    assert.equal(rewardRow(rewardId).twitch_sync_status, 'update_failed');
  });

  test('a bad value is still a 400 before anything is sent to Twitch', async () => {
    const rewardId = addReward(id);
    assert.equal((await patch(rewardId, { title: 'x' })).status, 400);
    assert.equal((await patch(rewardId, { cost: 0 })).status, 400);
    assert.deepEqual(helix.calls, []);
  });

  test('a delete Twitch takes removes the reward', async () => {
    const rewardId = addReward(id);
    const res = await del(rewardId);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { ok: true });
    assert.equal(rewardRow(rewardId), undefined);
    assert.equal(helix.calls.find((c) => c.method === 'DELETE').query.id, `route-tw-${rewardCounter}`);
  });

  test('a delete Twitch refuses is an error, and the reward is kept, marked, and listed apart', async () => {
    const rewardId = addReward(id, { title: 'Stubborn Reward' });
    const other = addReward(id, { title: 'Normal Reward' });
    helix.fail.DELETE = { status: 500, message: 'Twitch is having a problem' };

    const res = await del(rewardId);

    assert.equal(res.status, 502);
    const body = res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, t('en', 'redemptions.error.deleteFailed'));
    assert.equal(body.reward.twitch_sync_status, 'delete_failed');
    assert.equal(rewardRow(rewardId).twitch_sync_status, 'delete_failed');

    const list = await request('GET', '/dashboard/redemptions', { streamer: id, json: true });
    const { rewards, pendingDeletes, allRewards } = list.json().locals;
    assert.deepEqual(rewards.map((r) => r.id), [other], 'not in the normal list');
    assert.deepEqual(pendingDeletes.map((r) => r.id), [rewardId]);
    assert.equal(allRewards.length, 2);
  });

  test('a reward that is waiting to be deleted cannot be edited, replaced or tested', async () => {
    const rewardId = addReward(id, { twitch_sync_status: 'delete_failed' });
    assert.equal((await patch(rewardId, { title: 'New title' })).status, 404);
    assert.equal((await request('POST', `/dashboard/redemptions/${rewardId}/test`, { streamer: id })).status, 404);
    assert.equal((await request('POST', `/dashboard/redemptions/${rewardId}/replace-media?media_type=audio&ext=mp3`, { streamer: id, rawBody: 'x', contentType: 'application/octet-stream' })).status, 404);
    assert.deepEqual(helix.calls, []);
    assert.equal(fileWrites.length, 0);
  });

  test('deleting it again retries the delete', async () => {
    const rewardId = addReward(id, { twitch_sync_status: 'delete_failed' });
    const res = await del(rewardId);
    assert.deepEqual(res.json(), { ok: true });
    assert.equal(rewardRow(rewardId), undefined);
  });

  test('retry: a delete that works removes the reward', async () => {
    const rewardId = addReward(id, { twitch_sync_status: 'delete_failed' });
    const res = await retry(rewardId);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { ok: true, removed: true, reward: null });
    assert.equal(rewardRow(rewardId), undefined);
  });

  test('retry: an edit that works clears the warning', async () => {
    const rewardId = addReward(id, { title: 'Local title', twitch_sync_status: 'update_failed' });
    const res = await retry(rewardId);
    assert.equal(res.status, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.removed, false);
    assert.equal(body.reward.twitch_sync_status, 'ok');
    assert.equal(helix.calls.find((c) => c.method === 'PATCH').body.title, 'Local title');
  });

  test('retry that Twitch refuses again is an error and the reward keeps its status', async () => {
    const stuck = addReward(id, { twitch_sync_status: 'delete_failed' });
    const edited = addReward(id, { twitch_sync_status: 'update_failed' });
    helix.fail.DELETE = { status: 500 };
    helix.fail.PATCH = { status: 500 };
    const first = await retry(stuck);
    assert.equal(first.status, 502);
    assert.equal(first.json().error, t('en', 'redemptions.error.deleteFailed'));
    const second = await retry(edited);
    assert.equal(second.status, 502);
    assert.equal(second.json().error, t('en', 'redemptions.error.updateFailed'));
    assert.equal(rewardRow(stuck).twitch_sync_status, 'delete_failed');
    assert.equal(rewardRow(edited).twitch_sync_status, 'update_failed');
  });

  test('retry of a reward with nothing pending is a 400', async () => {
    const rewardId = addReward(id);
    const res = await retry(rewardId);
    assert.equal(res.status, 400);
    assert.equal(res.json().error, t('en', 'redemptions.error.nothingToRetry'));
    assert.deepEqual(helix.calls, []);
  });

  test('another streamer\'s reward can be neither edited, deleted nor retried', async () => {
    const other = addStreamer({ twitch_user_id: `tw-user-${++rewardCounter}`, broadcaster_access_token: 'tok2' });
    const theirs = addReward(other, { twitch_sync_status: 'delete_failed' });
    assert.equal((await patch(theirs, { title: 'Mine now' })).status, 404);
    assert.equal((await del(theirs)).status, 404);
    assert.equal((await retry(theirs)).status, 404);
    assert.equal(rewardRow(theirs, other).twitch_sync_status, 'delete_failed');
    assert.deepEqual(helix.calls, []);
  });

  test('the page shows the warning and retry for an edit Twitch did not take, and the rewards waiting to be deleted', async () => {
    addReward(id, { title: 'Edited Reward', twitch_sync_status: 'update_failed' });
    addReward(id, { title: 'Stubborn Reward', twitch_sync_status: 'delete_failed' });
    addReward(id, { title: 'Fine Reward' });
    const res = await request('GET', '/dashboard/redemptions', { streamer: id });
    assert.equal(res.status, 200);
    const html = (text) => text.replace(/&/g, '&amp;').replace(/"/g, '&#34;');
    assert.ok(res.text.includes(html(t('en', 'redemptions.updateFailed.warning'))));
    assert.ok(res.text.includes(t('en', 'redemptions.status.updateFailed')));
    assert.ok(res.text.includes('id="pending-deletes"'));
    assert.ok(res.text.includes(t('en', 'redemptions.deleteFailed.title')));
    assert.ok(res.text.includes(html(t('en', 'redemptions.deleteFailed.help'))));
    assert.match(res.text, /id="pending-delete-\d+"[\s\S]*Stubborn Reward/);
    const normalList = res.text.slice(res.text.indexOf('id="rewards-list"'));
    assert.ok(!normalList.slice(0, normalList.indexOf('reward-modal')).includes('Stubborn Reward'), 'not in the normal list');
    assert.ok(normalList.includes('Edited Reward') && normalList.includes('Fine Reward'));
  });

  test('without any problem the page has no warning and no pending list', async () => {
    addReward(id, { title: 'Fine Reward' });
    const res = await request('GET', '/dashboard/redemptions', { streamer: id });
    assert.ok(!res.text.includes('id="pending-deletes"'));
    assert.ok(!res.text.includes('class="reward-warning"'));
  });

  test('refunded redemptions are labelled in the history', async () => {
    const rewardId = addReward(id, { title: 'Off Reward', enabled: 0 });
    for (const [n, outcome] of [[1, 'refunded_disabled'], [2, 'refunded_deleted']]) {
      db.logRedemption({ streamer_id: id, reward_id: rewardId, twitch_redemption_id: `route-red-${id}-${n}`, twitch_reward_id: 'x', user_login: 'viewer', cost: 100, status: 'unfulfilled', outcome, redeemed_at: '2026-10-13T12:00:00Z' });
    }
    const res = await request('GET', '/dashboard/redemptions', { streamer: id });
    assert.ok(res.text.includes(t('en', 'redemptions.outcome.refundedDisabled')));
    assert.ok(res.text.includes(t('en', 'redemptions.outcome.refundedDeleted')));
    assert.ok(res.text.includes('Off Reward'));
  });

  test('every outcome has a translated label and a colour of its own, not its raw code', async () => {
    const rewardId = addReward(id, { title: 'Labelled Reward' });
    const outcomes = {
      played: 'redemptions.outcome.played',
      refunded_no_file: 'redemptions.outcome.refundedNoFile',
      refunded_disabled: 'redemptions.outcome.refundedDisabled',
      refunded_deleted: 'redemptions.outcome.refundedDeleted',
      refunded_switch_off: 'redemptions.outcome.refundedSwitchOff',
      disabled: 'redemptions.outcome.disabled',
      error: 'redemptions.outcome.error',
      pending: 'redemptions.outcome.pending',
    };
    let n = 0;
    for (const outcome of Object.keys(outcomes)) {
      db.logRedemption({ streamer_id: id, reward_id: rewardId, twitch_redemption_id: `route-label-${id}-${++n}`, twitch_reward_id: 'x', user_login: 'viewer', cost: 100, status: 'unfulfilled', outcome, redeemed_at: '2026-10-13T12:00:00Z' });
    }
    const res = await request('GET', '/dashboard/redemptions', { streamer: id });
    const chips = [...res.text.matchAll(/<span class="outcome-chip ([a-z_]+)">\s*([^<]*?)\s*<\/span>/g)].map((m) => [m[1], m[2]]);
    for (const [outcome, key] of Object.entries(outcomes)) {
      assert.ok(chips.some(([cls, label]) => cls === outcome && label === t('en', key)), `${outcome} is shown as "${t('en', key)}" in a chip of its own class`);
    }
    assert.ok(!chips.some(([, label]) => /_/.test(label)), 'no raw outcome code is shown');
    // pending and the switch have a colour: a rule for their class in the page's style
    assert.match(res.text, /\.outcome-chip\.pending\s*\{[^}]*color:/);
    assert.match(res.text, /\.outcome-chip\.refunded_switch_off[^{]*\{[^}]*color:/);
  });

  test('the page says redemptions are refunded while the switch is off', async () => {
    const hint = t('en', 'redemptions.master.hint');
    const off = await request('GET', '/dashboard/redemptions', { streamer: id });
    assert.ok(off.text.includes(hint));
    assert.match(off.text, /class="cp-master-hint off" id="cp-master-hint"/, 'shown as a warning while the switch is off');

    db.updateOverlayConfig(id, { cp_rewards_enabled: 1 });
    const on = await request('GET', '/dashboard/redemptions', { streamer: id });
    assert.ok(on.text.includes(hint));
    assert.match(on.text, /class="cp-master-hint " id="cp-master-hint"/, 'not a warning once it is on');
  });

  describe('creating a reward', () => {
    const upload = (streamer, query = {}) => {
      const params = new URLSearchParams({ media_type: 'audio', ext: 'mp3', title: `Horn ${++rewardCounter}`, cost: '500', ...query });
      return request('POST', `/dashboard/redemptions/upload?${params}`, { streamer, rawBody: 'synthetic-audio-bytes', contentType: 'application/octet-stream' });
    };
    const switchOf = (streamerId = id) => db.getStreamerById(streamerId).cp_rewards_enabled;

    test('the first reward switches "Enable Channel Point Rewards" on, and the answer says so', async () => {
      assert.equal(switchOf(), 0, 'a new streamer starts with the switch off');
      const res = await upload(id);
      assert.equal(res.status, 200);
      assert.equal(res.json().ok, true);
      assert.equal(res.json().rewardsSwitchedOn, true);
      assert.equal(switchOf(), 1);
      assert.equal(db.getRewards(id).length, 1);
    });

    test('a later reward leaves the switch as the streamer set it', async () => {
      addReward(id);
      assert.equal(switchOf(), 0, 'the streamer has a reward and the switch is off');
      const res = await upload(id);
      assert.equal(res.status, 200);
      assert.equal(res.json().rewardsSwitchedOn, undefined);
      assert.equal(switchOf(), 0);
    });

    test('with the switch already on, nothing changes and nothing is said', async () => {
      db.updateOverlayConfig(id, { cp_rewards_enabled: 1 });
      const res = await upload(id);
      assert.equal(res.status, 200);
      assert.equal(res.json().rewardsSwitchedOn, undefined);
      assert.equal(switchOf(), 1);
    });

    test('a reward that is refused does not switch it on', async () => {
      const res = await upload(id, { ext: 'exe' });
      assert.equal(res.status, 400);
      assert.equal(res.json().error, t('en', 'redemptions.error.audioExt'), 'the refusal is a translated message');
      assert.equal(switchOf(), 0);
      assert.equal(db.getRewards(id).length, 0);
    });

    test('a clip that cannot be saved leaves no reward behind and the switch off', async () => {
      const write = fakeFs.promises.writeFile;
      fakeFs.promises.writeFile = async () => { throw new Error('disk gone'); };
      try {
        const res = await upload(id);
        assert.equal(res.status, 500);
        assert.equal(res.json().error, t('en', 'redemptions.error.writeFailed'));
      } finally {
        fakeFs.promises.writeFile = write;
      }
      assert.equal(db.getRewards(id).length, 0);
      assert.equal(switchOf(), 0);
    });

    test('the other messages a streamer can get are in their language too', async () => {
      assert.equal((await upload(id, { title: 'x' })).json().error, t('en', 'redemptions.error.titleLength'));
      assert.equal((await upload(id, { cost: '0' })).json().error, t('en', 'redemptions.error.costRange'));
      assert.equal((await upload(id, { prompt: 'p'.repeat(201) })).json().error, t('en', 'redemptions.error.promptLength'));
      assert.equal((await upload(id, { position_preset: 'diagonal' })).json().error, t('en', 'redemptions.error.position'));
      assert.equal((await upload(id, { media_type: 'image' })).json().error, t('en', 'redemptions.error.mediaType'));
      const reward = addReward(id);
      assert.equal((await patch(reward, { title: 'x' })).json().error, t('en', 'redemptions.error.titleLength'));
      assert.equal((await patch(reward, { cost: 0 })).json().error, t('en', 'redemptions.error.costRange'));
      assert.equal((await patch(reward + 9999, { title: 'Fine title' })).json().error, t('en', 'redemptions.error.notFound'));
      assert.equal((await del(reward + 9999)).json().error, t('en', 'redemptions.error.notFound'));
    });
  });
});

// ── The OBS overlay features switched off (config.features.overlays) ─────

describe('with the OBS overlay features switched off', () => {
  const { features } = require('../config');
  beforeEach(() => { features.overlays = false; });
  afterEach(() => { features.overlays = true; });

  // The pages that exist only for the overlays, and the view each is while the features are on.
  const OVERLAY_PAGES = {
    '/dashboard/overlay': 'overlay-config',
    '/dashboard/overlay-builder': 'overlay-builder',
    '/dashboard/redemptions': 'redemptions-config',
    '/dashboard/vtuber-preview': 'vtuber',
  };

  test('the pages that exist only for the overlays send the streamer back to the dashboard', async () => {
    const id = addStreamer({ overlay_enabled: 1, overlay_token: 'synthetic-token-off-1' });
    for (const page of Object.keys(OVERLAY_PAGES)) {
      const res = await request('GET', page, { streamer: id, json: true });
      assert.equal(res.status, 302, page);
      assert.equal(res.headers.location, '/dashboard', page);
    }
  });

  test('switched on, the same addresses are the overlay pages', async () => {
    features.overlays = true;
    const id = addStreamer({ overlay_enabled: 1, overlay_token: 'synthetic-token-off-2' });
    for (const [page, view] of Object.entries(OVERLAY_PAGES)) {
      const res = await request('GET', page, { streamer: id, json: true });
      assert.equal(res.status, 200, page);
      assert.equal(res.json().view, view, page);
    }
  });

  test('a visitor who is not logged in still goes to the login page, as before', async () => {
    for (const page of Object.keys(OVERLAY_PAGES)) {
      const res = await request('GET', page);
      assert.equal(res.headers.location, '/auth/login', page);
    }
  });

  test('the POST routes of those pages are as they were (no page reaches them, an old tab may)', async () => {
    const id = addStreamer({ overlay_enabled: 1, overlay_follow_duration: 5 });
    const res = await request('POST', '/dashboard/overlay', { streamer: id, form: { overlay_enabled: '1', overlay_follow_duration: '20' } });
    assert.equal(res.status, 302);
    assert.equal(db.getStreamerById(id).overlay_follow_duration, 20);
  });

  describe('saving the YouTube chatbot', () => {
    const SWITCHES = ['yt_overlay_superchat_enabled', 'yt_overlay_member_enabled', 'yt_overlay_giftmember_enabled'];
    const storedSwitches = (id) => SWITCHES.map((column) => db.getStreamerById(id)[column]);

    test('keeps the stored overlay switches (it must not switch the alerts off), whatever the form says', async () => {
      const id = addStreamer({ yt_overlay_superchat_enabled: 1, yt_overlay_member_enabled: 0, yt_overlay_giftmember_enabled: 1 });
      const res = await request('POST', '/dashboard/youtube-chatbot', {
        streamer: id,
        form: { yt_chatbot_enabled: '1', yt_chat_superchat_enabled: '1', yt_chat_superchat_template: 'Thanks {username}!', yt_overlay_member_enabled: '1' },
      });
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/dashboard/youtube-chatbot');
      assert.deepEqual(storedSwitches(id), [1, 0, 1]);
      const row = db.getStreamerById(id);
      assert.equal(row.yt_chatbot_enabled, 1);
      assert.equal(row.yt_chat_superchat_enabled, 1);
      assert.equal(row.yt_chat_member_enabled, 0, 'the chat settings are saved as before: a switch the form leaves out is off');
      assert.equal(row.yt_chat_superchat_template, 'Thanks {username}!');
    });

    test('tells an overlay that is open the alerts it already had', async () => {
      const bus = require('../services/overlayBus');
      const id = addStreamer({ overlay_enabled: 1, yt_overlay_superchat_enabled: 1, yt_overlay_member_enabled: 0, yt_overlay_giftmember_enabled: 1 });
      const seen = [];
      const listener = (event) => seen.push(event);
      bus.on(`overlay:${id}`, listener);
      try { await request('POST', '/dashboard/youtube-chatbot', { streamer: id, form: { yt_chatbot_enabled: '1' } }); } finally { bus.off(`overlay:${id}`, listener); }
      assert.equal(seen.length, 1);
      assert.equal(seen[0].config.yt_superchat.enabled, true);
      assert.equal(seen[0].config.yt_member.enabled, false);
      assert.equal(seen[0].config.yt_giftmember.enabled, true);
    });

    test('switched on, writes the switches the form sends, as before', async () => {
      features.overlays = true;
      const id = addStreamer({ yt_overlay_superchat_enabled: 1, yt_overlay_member_enabled: 0, yt_overlay_giftmember_enabled: 1 });
      await request('POST', '/dashboard/youtube-chatbot', { streamer: id, form: { yt_overlay_member_enabled: '1' } });
      assert.deepEqual(storedSwitches(id), [0, 1, 0]);
    });
  });
});

// ── What a streamer sees while the OBS overlay features are off ──────────

describe('with the OBS overlay features switched off, the pages show nothing of them', () => {
  const { features } = require('../config');
  beforeEach(() => { features.overlays = false; });
  afterEach(() => { features.overlays = true; });

  // The page's own part: the layout (head, sidebar, lightbox and the script after it) comes before it.
  const body = (text) => {
    const layoutEnd = text.indexOf('</script>', text.indexOf('function toggleUserMenu'));
    assert.ok(layoutEnd > 0, 'the layout\'s last script is where the page starts');
    return text.slice(layoutEnd + '</script>'.length);
  };
  // A link or form that leads a streamer into the overlays: their pages, the Builder's sponsor list, the
  // tip goal, the VTuber, or an OBS link.
  const INTO_OVERLAYS = /\/dashboard\/(?:overlay|redemptions|vtuber|api\/vtuber|sponsors)|\/dashboard\/donations\/goal|\/overlay\/|\/vtuber\//;
  // Words that say a page is about the overlays.
  const OVERLAY_WORDS = /overlay|vtuber|browser source|\bOBS\b|channel point|experimental/i;
  const noOverlays = (html, label) => {
    const page = html.replace(/<style\b[\s\S]*?<\/style>/gi, ' '); // class names in a stylesheet are not what a streamer reads
    assert.ok(!INTO_OVERLAYS.test(page), `${label}: a link into the overlays: ${page.match(INTO_OVERLAYS)}`);
    const word = page.match(OVERLAY_WORDS);
    assert.ok(!word, `${label}: talks about the overlays: ${word && page.slice(Math.max(0, word.index - 60), word.index + 60).replace(/\s+/g, ' ')}`);
  };

  describe('the dashboard', () => {
    let made = 0;
    const streamerWithEverything = () => {
      made++;
      return addStreamer({
        overlay_enabled: 1, overlay_token: `synthetic-token-off-3-${made}`, twitch_user_id: `tw-off-3-${made}`, twitch_username: `synthetic_off_${made}`,
        broadcaster_access_token: 'synthetic-broadcaster', chatbot_enabled: 1, yt_chatbot_enabled: 1, cp_rewards_enabled: 1,
      });
    };

    test('has no overlay card, tab, link or wording: not the OBS Overlay card, the rewards card, the VTuber tab or the YouTube overlay card', async () => {
      const res = await request('GET', '/dashboard', { streamer: streamerWithEverything() });
      assert.equal(res.status, 200);
      const page = body(res.text);
      noOverlays(page, 'dashboard');
      for (const key of ['dashboard.cards.overlay.title', 'dashboard.cards.cpRewards', 'dashboard.vtuber.title', 'dashboard.tab.experimental', 'dashboard.youtube.overlayDesc']) {
        assert.ok(!page.includes(esc(t('en', key))), key);
      }
      assert.ok(!page.includes('data-tab="experimental"') && !page.includes('id="tab-experimental"'));
    });

    test('keeps the tabs and the cards that are not about the overlays, and words the giveaways, sponsor and kick texts without them', async () => {
      const res = await request('GET', '/dashboard', { streamer: streamerWithEverything() });
      const page = body(res.text);
      for (const tab of ['discord', 'twitch', 'youtube', 'kick']) assert.ok(page.includes(`data-tab="${tab}"`), tab);
      for (const href of ['/dashboard/chatbot', '/dashboard/timed-notifications', '/dashboard/donations', '/dashboard/donations/history', '/dashboard/giveaways', '/dashboard/youtube-chatbot', '/auth/spotify']) {
        assert.ok(page.includes(`href="${href}"`), href);
      }
      for (const key of ['dashboard.cards.giveaways.descChat', 'dashboard.cards.sponsors.descChat', 'dashboard.kick.comingSoonChat']) {
        assert.ok(page.includes(esc(t('en', key))), key);
      }
      for (const key of ['dashboard.cards.giveaways.desc', 'dashboard.cards.sponsors.desc', 'dashboard.kick.comingSoon']) {
        assert.ok(!page.includes(esc(t('en', key))), `${key} is the wording with the overlays`);
      }
    });

    test('the donations card does not promise overlay alerts', async () => {
      const res = await request('GET', '/dashboard', { streamer: addStreamer({ paypal_email: null }) });
      assert.ok(body(res.text).includes(esc(t('en', 'dashboard.cards.donations.setupChat'))));
    });

    test('switched on, it is the dashboard it was: both overlay cards, the rewards card, the VTuber tab and the original wording', async () => {
      features.overlays = true;
      const streamer = streamerWithEverything();
      const res = await request('GET', '/dashboard', { streamer });
      const page = body(res.text);
      for (const href of ['/dashboard/overlay', '/dashboard/overlay-builder', '/dashboard/redemptions']) assert.ok(page.includes(`href="${href}"`), href);
      for (const key of ['dashboard.cards.overlay.title', 'dashboard.cards.cpRewards', 'dashboard.vtuber.title', 'dashboard.tab.experimental', 'dashboard.youtube.overlayDesc',
        'dashboard.cards.giveaways.desc', 'dashboard.cards.sponsors.desc', 'dashboard.kick.comingSoon']) {
        assert.ok(page.includes(esc(t('en', key))), key);
      }
      assert.ok(page.includes('data-tab="experimental"') && page.includes('id="tab-experimental"'));
      assert.ok(page.includes(`/overlay/${db.getStreamerById(streamer).overlay_token}`), 'the OBS link');
    });

    test('a tab remembered from before that the page no longer has (Experimental) opens Twitch, not an empty dashboard', async () => {
      const res = await request('GET', '/dashboard', { streamer: addStreamer() });
      const twitchOpen = { html: 'twitch', open: ['button:twitch', 'pane:twitch'] };
      assert.deepEqual(openDashboardTab(res.text, 'experimental'), twitchOpen);
      assert.deepEqual(openDashboardTab(res.text, 'admin'), twitchOpen, 'the Admin tab is not on a non-admin\'s page either');
      assert.deepEqual(openDashboardTab(res.text, null), twitchOpen);
      assert.deepEqual(openDashboardTab(res.text, 'discord'), { html: 'discord', open: ['button:discord', 'pane:discord'] }, 'a tab that is there is opened');
    });

    test('switched on, the remembered Experimental tab opens, as before', async () => {
      features.overlays = true;
      const res = await request('GET', '/dashboard', { streamer: addStreamer() });
      assert.deepEqual(openDashboardTab(res.text, 'experimental'), { html: 'experimental', open: ['button:experimental', 'pane:experimental'] });
    });
  });

  describe('the donations page', () => {
    let made = 0;
    const streamerWithGoal = () => {
      made++;
      const id = addStreamer({ twitch_username: `synthetic_off_tip_${made}`, paypal_email: 'tips@example.test', donation_page_enabled: 1, overlay_token: `synthetic-token-off-4-${made}` });
      db.createTipGoal(id, { title: 'Synthetic goal title', target_amount: 100, current_amount: 5, currency: 'EUR', bar_color: '#22c55e' });
      db.createTipGoal(id, { title: 'Synthetic second goal', target_amount: 50, current_amount: 0, currency: 'EUR', bar_color: '#22c55e' }); // the first one is now in the history
      return id;
    };

    test('keeps the PayPal settings, the tip page link and the history link, and has no tip goal, goal bar or OBS link', async () => {
      const res = await request('GET', '/dashboard/donations', { streamer: streamerWithGoal() });
      assert.equal(res.status, 200);
      const page = body(res.text);
      noOverlays(page, 'donations');
      for (const gone of ['id="tip-goal"', 'goal-form', 'Synthetic goal title', 'Synthetic second goal', esc(t('en', 'donations.goal.title')), esc(t('en', 'donations.goalOverlay.title')), esc(t('en', 'donations.goal.past'))]) {
        assert.ok(!page.includes(gone), gone);
      }
      for (const kept of ['name="donation_page_enabled"', 'name="paypal_email"', 'name="donation_min_amount"', 'name="donation_currency"', 'href="/dashboard/donations/history"', `/tip/synthetic_off_tip_${made}`, 'id="tip-url"']) {
        assert.ok(page.includes(kept), kept);
      }
      assert.ok(page.includes(esc(t('en', 'donations.settings.introChat'))));
    });

    test('switched on, the tip goal, its preview and its OBS link are there', async () => {
      features.overlays = true;
      const res = await request('GET', '/dashboard/donations', { streamer: streamerWithGoal() });
      const page = body(res.text);
      for (const there of ['id="tip-goal"', '/overlay/goal-demo', `/overlay/goal/synthetic-token-off-4-${made}`, 'Synthetic second goal', 'Synthetic goal title', esc(t('en', 'donations.settings.intro'))]) {
        assert.ok(page.includes(there), there);
      }
    });
  });

  describe('the sponsor messages page', () => {
    test('does not send the streamer to the Overlay Builder, and keeps the chat settings and the messages', async () => {
      const id = addStreamer();
      db.addSponsorMessage(id, 'Synthetic sponsor message', null);
      const res = await request('GET', '/dashboard/timed-notifications', { streamer: id });
      assert.equal(res.status, 200);
      const page = body(res.text);
      noOverlays(page, 'sponsor messages');
      assert.ok(page.includes(esc(t('en', 'sponsors.introChat'))));
      for (const kept of ['id="chat-enabled"', 'id="chat-interval"', 'id="new-msg-text"', 'Synthetic sponsor message', '/dashboard/sponsor-messages/settings']) assert.ok(page.includes(kept), kept);
    });

    test('switched on, the intro links to the Overlay Builder', async () => {
      features.overlays = true;
      const res = await request('GET', '/dashboard/timed-notifications', { streamer: addStreamer() });
      assert.ok(res.text.includes('href="/dashboard/overlay-builder"'));
    });
  });

  describe('the YouTube chatbot page', () => {
    const SWITCHES = ['yt_overlay_superchat_enabled', 'yt_overlay_member_enabled', 'yt_overlay_giftmember_enabled'];

    test('has no "show overlay banner" switches and no overlay test buttons, and keeps the chat settings and chat tests', async () => {
      const res = await request('GET', '/dashboard/youtube-chatbot', { streamer: addStreamer({ yt_overlay_superchat_enabled: 1 }) });
      assert.equal(res.status, 200);
      const page = body(res.text);
      noOverlays(page, 'YouTube chatbot');
      for (const gone of [...SWITCHES, '/dashboard/youtube-chatbot/test/', esc(t('en', 'ytChatbot.showOverlay')), esc(t('en', 'ytChatbot.testOverlay')), esc(t('en', 'ytChatbot.events'))]) {
        assert.ok(!page.includes(gone), gone);
      }
      for (const kept of ['name="yt_chatbot_enabled"', 'name="yt_chat_superchat_enabled"', 'name="yt_chat_member_template"', 'name="yt_chat_giftmember_enabled"', 'name="yt_mod_enabled"', '/dashboard/youtube-chatbot/test-chat/',
        esc(t('en', 'ytChatbot.eventsChat')), esc(t('en', 'ytChatbot.eventsHintChat'))]) {
        assert.ok(page.includes(kept), kept);
      }
    });

    test('switched on, it has the switches and the overlay test buttons', async () => {
      features.overlays = true;
      const page = body((await request('GET', '/dashboard/youtube-chatbot', { streamer: addStreamer() })).text);
      for (const there of [...SWITCHES.map((name) => `name="${name}"`), '/dashboard/youtube-chatbot/test/', esc(t('en', 'ytChatbot.showOverlay')), esc(t('en', 'ytChatbot.testOverlay')), esc(t('en', 'ytChatbot.events'))]) {
        assert.ok(page.includes(there), there);
      }
    });
  });

  describe('the account-disabled page', () => {
    test('does not say OBS overlays are switched off', async () => {
      const res = await request('GET', '/dashboard', { streamer: addStreamer({ enabled: 0 }) });
      assert.equal(res.status, 403);
      assert.ok(res.text.includes(esc(t('en', 'account.disabled.bodyChat'))));
      noOverlays(body(res.text), 'account disabled');
    });

    test('switched on, it says so', async () => {
      features.overlays = true;
      const res = await request('GET', '/dashboard', { streamer: addStreamer({ enabled: 0 }) });
      assert.ok(res.text.includes(esc(t('en', 'account.disabled.body'))));
    });
  });
});

// ── Twitch at the centre of the dashboard ────────────────────────────────

// Which tab a rendered dashboard opens, from its own two tab scripts run against a fake page: the one above the
// tab bar names the tab on <html data-dashboard-tab> from what localStorage remembers, before anything is drawn;
// the one at the end marks that tab's button and pane. `saved` is what localStorage holds ('throws': a browser
// that refuses storage). Returns the tab <html> names and the buttons and panes marked open.
function openDashboardTab(pageHtml, saved) {
  const open = new Set();
  const attributes = {};
  const element = (kind, name) => ({
    dataset: { tab: name },
    id: `tab-${name}`,
    addEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    classList: { toggle: (cls, on) => { if (cls === 'active') { if (on) open.add(`${kind}:${name}`); else open.delete(`${kind}:${name}`); } } },
  });
  const tabs = [...pageHtml.matchAll(/class="tab-btn[^"]*" data-tab="(\w+)"/g)].map((m) => element('button', m[1]));
  const panes = [...pageHtml.matchAll(/class="tab-content[^"]*" id="tab-(\w+)"/g)].map((m) => element('pane', m[1]));
  const document = {
    documentElement: { setAttribute: (name, value) => { attributes[name] = String(value); }, getAttribute: (name) => attributes[name] ?? null },
    querySelectorAll: (selector) => ({ '.tab-btn': tabs, '.tab-content': panes }[selector] || []),
  };
  const refuse = () => { throw new Error('storage refused'); };
  const localStorage = saved === 'throws' ? { getItem: refuse, setItem: refuse } : { getItem: () => saved, setItem() {} };
  const scripts = [...pageHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.includes('dashboard_tab') || s.includes('data-dashboard-tab'));
  assert.equal(scripts.length, 2, 'the script above the tab bar and the page script at the end');
  for (const script of scripts) new Function('document', 'localStorage', script)(document, localStorage);
  return { html: attributes['data-dashboard-tab'] ?? null, open: [...open].sort() };
}

// The tab buttons of a rendered dashboard, in order.
const dashboardTabs = (html) => [...html.matchAll(/class="tab-btn[^"]*" data-tab="(\w+)"/g)].map((m) => m[1]);
// A pane of a rendered dashboard: from its opening tag to the next pane.
function dashboardPane(html, tab) {
  const start = html.indexOf(`id="tab-${tab}"`);
  assert.ok(start > 0, `the ${tab} pane is on the page`);
  const next = html.indexOf('<div class="tab-content', start);
  return html.slice(start, next > 0 ? next : html.length);
}
// The headings of the cards of the Twitch tab, in order.
const twitchCardTitles = (html) => [...dashboardPane(html, 'twitch').matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => m[1].replace(/<[^>]*>/g, '').trim());

describe('the dashboard puts Twitch first', () => {
  const { features } = require('../config');
  afterEach(() => Object.assign(features, { overlays: true, youtube: true, kick: true }));
  let made = 0;
  const linked = (over = {}) => { made++; return addStreamer({ twitch_user_id: `tw-first-${made}`, twitch_username: `synthetic_first_${made}`, ...over }); };

  test('the tabs are Twitch, then Discord, then the ones that are switched on, and Admin for an admin', async () => {
    const id = addStreamer();
    assert.deepEqual(dashboardTabs((await request('GET', '/dashboard', { streamer: id })).text), ['twitch', 'discord', 'youtube', 'kick', 'experimental']);
    assert.deepEqual(dashboardTabs((await request('GET', '/dashboard', { streamer: id, admin: true })).text), ['twitch', 'discord', 'youtube', 'kick', 'experimental', 'admin']);
    Object.assign(features, { overlays: false, youtube: false, kick: false });
    assert.deepEqual(dashboardTabs((await request('GET', '/dashboard', { streamer: id })).text), ['twitch', 'discord']);
    assert.deepEqual(dashboardTabs((await request('GET', '/dashboard', { streamer: id, admin: true })).text), ['twitch', 'discord', 'admin']);
  });

  test('a first visit opens Twitch, the tab picked last time opens the next time, and one the page no longer has opens Twitch', async () => {
    Object.assign(features, { overlays: false, youtube: false, kick: false });
    const html = (await request('GET', '/dashboard', { streamer: addStreamer() })).text;
    const twitchOpen = { html: 'twitch', open: ['button:twitch', 'pane:twitch'] };
    assert.deepEqual(openDashboardTab(html, null), twitchOpen, 'nothing remembered');
    assert.deepEqual(openDashboardTab(html, 'twitch'), twitchOpen);
    assert.deepEqual(openDashboardTab(html, 'discord'), { html: 'discord', open: ['button:discord', 'pane:discord'] });
    for (const gone of ['youtube', 'kick', 'experimental', 'admin', 'tab-twitch', '', 'constructor']) assert.deepEqual(openDashboardTab(html, gone), twitchOpen, JSON.stringify(gone));
    assert.deepEqual(openDashboardTab(html, 'throws'), twitchOpen, 'a browser that refuses storage');
  });

  test('switched on, a remembered YouTube or Kick tab opens as before, and an admin\'s Admin tab', async () => {
    const id = addStreamer();
    const html = (await request('GET', '/dashboard', { streamer: id })).text;
    for (const tab of ['youtube', 'kick']) assert.deepEqual(openDashboardTab(html, tab), { html: tab, open: [`button:${tab}`, `pane:${tab}`] });
    const admin = (await request('GET', '/dashboard', { streamer: id, admin: true })).text;
    assert.deepEqual(openDashboardTab(admin, 'admin'), { html: 'admin', open: ['button:admin', 'pane:admin'] });
  });

  test('the page is drawn on that tab from the start: the tab is named above the tab bar, and nothing is marked open in the page as sent', async () => {
    for (const on of [false, true]) {
      Object.assign(features, { overlays: on, youtube: on, kick: on });
      const html = (await request('GET', '/dashboard', { streamer: addStreamer(), admin: true })).text;
      const named = html.indexOf("localStorage.getItem('dashboard_tab')");
      assert.ok(named > 0 && named < html.indexOf('class="tab-bar'), 'the remembered tab is read before the tab bar');
      assert.ok(named < html.indexOf('class="tab-content'), 'and before the panes');
      assert.doesNotMatch(html, /class="tab-btn[^"]*\bactive\b/, 'no tab button is marked open as sent');
      assert.doesNotMatch(html, /class="tab-content[^"]*\bactive\b/, 'no pane is marked open as sent');
      // The stylesheet shows the pane and the button that <html data-dashboard-tab> names, for every tab of the page.
      for (const tab of dashboardTabs(html)) {
        assert.ok(html.includes(`html[data-dashboard-tab="${tab}"] #tab-${tab}`), `${tab}: its pane`);
        assert.ok(html.includes(`html[data-dashboard-tab="${tab}"] .tab-btn.tab-${tab}`), `${tab}: its button`);
      }
      assert.ok(html.includes('html:not([data-dashboard-tab]) #tab-twitch'), 'without that script (no JavaScript) the Twitch tab shows');
    }
  });

  test('the Twitch tab: the account row, then Chatbot, Discord notifications, Giveaways, Donations, Sponsor messages and Spotify', async () => {
    features.overlays = false;
    const html = (await request('GET', '/dashboard', { streamer: linked() })).text;
    const pane = dashboardPane(html, 'twitch');
    assert.deepEqual(twitchCardTitles(html), [t('en', 'dashboard.week.title'), t('en', 'dashboard.cards.chatbot.title'), t('en', 'dashboard.cards.discord.title'),
      t('en', 'dashboard.cards.giveaways'), t('en', 'dashboard.cards.donations.title'), t('en', 'sponsors.title'), 'Spotify']);
    assert.ok(pane.indexOf(`Twitch: synthetic_first_${made}`) < pane.indexOf('class="card'), 'the linked channel is above the cards');
  });

  test('switched on, the overlay cards come after those, and the Multistream card (relay configured) last', async () => {
    const multistream = require('../config').multistream;
    const relay = multistream.enabled;
    multistream.enabled = true;
    try {
      const html = (await request('GET', '/dashboard', { streamer: linked({ overlay_token: 'synthetic-token-first-1' }) })).text;
      assert.deepEqual(twitchCardTitles(html).slice(1), [t('en', 'dashboard.cards.chatbot.title'), t('en', 'dashboard.cards.discord.title'), t('en', 'dashboard.cards.giveaways'),
        t('en', 'dashboard.cards.donations.title'), t('en', 'sponsors.title'), 'Spotify', t('en', 'dashboard.cards.overlay.title'), t('en', 'dashboard.cards.cpRewards'),
        t('en', 'dashboard.cards.multistream.title')]);
    } finally {
      multistream.enabled = relay;
    }
  });

  test('every card has one main button, and says what state it is in', async () => {
    features.overlays = false;
    const pane = dashboardPane((await request('GET', '/dashboard', { streamer: linked({ chatbot_enabled: 1 }) })).text, 'twitch');
    const cards = pane.split('<div class="card').slice(2); // the 7-day activity card has no button
    assert.equal(cards.length, 6);
    for (const card of cards) {
      const title = (card.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/) || [])[1];
      assert.equal((card.match(/class="btn btn-(?:primary|discord)\b/g) || []).length, 1, `${title}: one main button`);
      assert.match(card, /<\/h3>\s*<span\b/, `${title}: a status line under its title`);
    }
  });

  test('the Twitch account row: link the account, give the broadcaster authorization, or reconnect when it stopped working', async () => {
    const row = async (id) => {
      const pane = dashboardPane((await request('GET', '/dashboard', { streamer: id })).text, 'twitch');
      return pane.slice(0, pane.indexOf('class="card'));
    };
    const notLinked = await row(addStreamer());
    assert.ok(notLinked.includes('href="/auth/twitch"') && notLinked.includes(esc(t('en', 'dashboard.linkTwitch'))));
    const noAuthorization = await row(linked());
    assert.ok(noAuthorization.includes(`Twitch: synthetic_first_${made}`));
    assert.ok(noAuthorization.includes('href="/auth/broadcaster"') && noAuthorization.includes(esc(t('en', 'dashboard.enableSubSync'))));
    const authorized = await row(linked({ broadcaster_access_token: 'synthetic-broadcaster' }));
    assert.ok(!authorized.includes('/auth/broadcaster'), 'nothing to do');
    const reauth = twitchStub.needsBroadcasterReauth;
    twitchStub.needsBroadcasterReauth = () => true;
    try {
      const stale = await row(linked({ broadcaster_access_token: 'synthetic-broadcaster' }));
      assert.ok(stale.includes('href="/auth/broadcaster"') && stale.includes(esc(t('en', 'dashboard.reconnectTwitch'))));
    } finally {
      twitchStub.needsBroadcasterReauth = reauth;
    }
  });
});

describe('the Discord notifications card on the Twitch tab', () => {
  let made = 0;
  let guildCount = 0;
  const nextGuild = () => `60000000000000${String(500 + ++guildCount).padStart(4, '0')}`;
  const linked = (over = {}) => { made++; return addStreamer({ twitch_user_id: `tw-dn-${made}`, twitch_username: `synthetic_dn_${made}`, ...over }); };
  const loginOf = (id) => db.getStreamerById(id).twitch_username;
  // A server the streamer has claimed, that the bot can see (unless seen: false).
  const claimed = (id, settings = {}, { seen = true, name = 'Synthetic Server' } = {}) => {
    const g = nextGuild();
    db.upsertGuild(g, id, name);
    db.updateGuildConfig(g, id, settings);
    if (seen) guilds.set(g, fakeGuild(g));
    return g;
  };
  const page = async (id) => {
    const res = await request('GET', '/dashboard', { streamer: id });
    assert.equal(res.status, 200);
    return res.text;
  };
  const cardOf = async (id) => {
    const html = await page(id);
    const start = html.indexOf('id="discord-notifications"');
    assert.ok(start > 0, 'the card is on the page');
    return html.slice(start, html.indexOf('<!-- end discord-notifications -->', start));
  };
  const dataOf = async (id) => (await request('GET', '/dashboard', { streamer: id, json: true })).json().locals.discordNotifications;
  // A state of a server's row: 'on', 'off' or 'wait', the words it shows, and the state in words for a screen reader.
  const state = (card, guildId, item) => {
    const row = card.slice(card.indexOf(`data-guild="${guildId}"`));
    const m = row.match(new RegExp(`<li class="dn-state dn-(on|off|wait)" data-item="${item}">([\\s\\S]*?)</li>`));
    assert.ok(m, `${item} is shown for ${guildId}`);
    const spoken = (m[2].match(/<span class="dn-sr">([\s\S]*?)<\/span>/) || [])[1];
    const shown = m[2].replace(/<span class="dn-sr">[\s\S]*?<\/span>/, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return { state: m[1], text: shown, spoken: spoken && spoken.replace(/[:\s]+$/, '') };
  };
  const states = (card, guildId) => Object.fromEntries(['goLive', 'clips', 'recaps', 'milestones', 'highlights', 'subRoles'].map((item) => [item, state(card, guildId, item).state]));
  const ALL_ON = { recap_enabled: true, milestones_enabled: true, weekly_highlights_enabled: true, sub_sync_enabled: true, sub_role_id: '700000000000000005' };

  test('without a linked Twitch account it says so, and offers to link it', async () => {
    const id = addStreamer();
    claimed(id, ALL_ON);
    const card = await cardOf(id);
    assert.ok(card.includes(esc(t('en', 'dashboard.cards.discord.statusNoTwitch'))));
    assert.ok(card.includes(esc(t('en', 'dashboard.cards.discord.noTwitch'))));
    assert.ok(card.includes('href="/auth/twitch"') && card.includes(esc(t('en', 'dashboard.linkTwitch'))));
    assert.ok(!card.includes('data-guild='), 'no server is listed: nothing can be said about a channel that is not linked');
    assert.equal((await dataOf(id)).twitchLinked, false);
  });

  test('with no server: what the bot would post, the bot invite, and a server the bot is already in to claim', async () => {
    const id = linked();
    let card = await cardOf(id);
    assert.ok(card.includes(esc(t('en', 'dashboard.cards.discord.statusNoServer'))));
    assert.ok(card.includes(esc(t('en', 'dashboard.cards.discord.noServer'))));
    assert.ok(card.includes('href="https://discord.com/oauth2/authorize?client_id=') && card.includes(esc(t('en', 'dashboard.addBot'))));
    assert.ok(!card.includes('/dashboard/claim/'));

    const g = nextGuild();
    guilds.set(g, fakeGuild(g, { manage: [discordId(id)] }));
    card = await cardOf(id);
    assert.ok(card.includes(`action="/dashboard/claim/${g}"`), 'the server the streamer manages can be claimed from the card');
    assert.ok(card.includes(esc(t('en', 'dashboard.claim'))));
  });

  test('a server that announces the streamer\'s channel: go-live and clips with their channels, the server\'s switches, sub roles, and one button to its settings', async () => {
    const id = linked({ broadcaster_access_token: 'synthetic-broadcaster' });
    const g = claimed(id, ALL_ON);
    db.addWatchedChannel(g, id, loginOf(id), CH_LIVE, CH_CLIPS, true, true, null);
    const card = await cardOf(id);
    assert.deepEqual(states(card, g), { goLive: 'on', clips: 'on', recaps: 'on', milestones: 'on', highlights: 'on', subRoles: 'on' });
    assert.equal(state(card, g, 'goLive').text, `${t('en', 'dashboard.cards.discord.goLive')} #live`);
    assert.equal(state(card, g, 'clips').text, `${t('en', 'dashboard.cards.discord.clips')} #clips`);
    assert.equal(state(card, g, 'goLive').spoken, t('en', 'dashboard.cards.discord.on'), 'the state is in words too, for a screen reader');
    assert.ok(card.includes(`Server ${g}`), 'the server\'s name as Discord has it');
    assert.ok(card.includes(esc(t('en', 'dashboard.cards.discord.statusAll'))));
    assert.deepEqual([...card.matchAll(/href="(\/dashboard\/guild\/[^"]*)"/g)].map((m) => m[1]), [`/dashboard/guild/${g}`], 'one way to its settings');
    assert.ok(card.includes(esc(t('en', 'dashboard.cards.discord.serverSettings'))));
    assert.ok(!card.includes(esc(t('en', 'dashboard.cards.discord.authNote', { link: '' }).slice(0, 20))), 'nothing waits for an authorization');
  });

  test('a server that does not watch the streamer\'s channel: nothing of it is posted there, whatever its switches; the card offers to set it up', async () => {
    const id = linked({ broadcaster_access_token: 'synthetic-broadcaster' });
    const g = claimed(id, ALL_ON);
    db.addWatchedChannel(g, id, 'someone_else', CH_LIVE, CH_CLIPS, true, true, null);
    const card = await cardOf(id);
    const shown = states(card, g);
    assert.deepEqual(shown, { goLive: 'off', clips: 'off', recaps: 'off', milestones: 'off', highlights: 'off', subRoles: 'on' }, 'recaps, milestones and highlights go into the go-live channel of the streamer\'s own row');
    assert.ok(card.includes(esc(t('en', 'dashboard.cards.discord.statusNone'))));
    assert.ok(card.includes(`href="/dashboard/guild/${g}?tab=twitch"`) && card.includes(esc(t('en', 'dashboard.cards.discord.setUpPosts'))));
    assert.equal(state(card, g, 'goLive').spoken, t('en', 'dashboard.cards.discord.off'));
  });

  test('go-live without clips; a channel the bot cannot see is not named; a watcher row that is off counts as off', async () => {
    const id = linked();
    const g = claimed(id);
    db.addWatchedChannel(g, id, loginOf(id), '599999999999999999', null, true, false, null);
    let card = await cardOf(id);
    assert.equal(state(card, g, 'goLive').state, 'on');
    assert.equal(state(card, g, 'goLive').text, t('en', 'dashboard.cards.discord.goLive'), 'no channel name');
    assert.equal(state(card, g, 'clips').state, 'off');
    db.db.prepare('UPDATE watched_channels SET enabled = 0 WHERE guild_id = ?').run(g);
    card = await cardOf(id);
    assert.equal(state(card, g, 'goLive').state, 'off', 'the pollers skip a row that is off');
  });

  test('sub roles: off without the switch or without a role, waiting without the broadcaster authorization, with the way to give it', async () => {
    const off = linked({ broadcaster_access_token: 'synthetic-broadcaster' });
    const noSwitch = claimed(off, { sub_role_id: '700000000000000005' });
    const noRole = claimed(off, { sub_sync_enabled: true });
    let card = await cardOf(off);
    assert.equal(state(card, noSwitch, 'subRoles').state, 'off');
    assert.equal(state(card, noRole, 'subRoles').state, 'off');

    const waiting = linked();
    const g = claimed(waiting, { sub_sync_enabled: true, sub_role_id: '700000000000000005' });
    card = await cardOf(waiting);
    assert.equal(state(card, g, 'subRoles').state, 'wait');
    assert.equal(state(card, g, 'subRoles').spoken, t('en', 'dashboard.cards.discord.wait'));
    const [before] = t('en', 'dashboard.cards.discord.authNote', { link: '\u0001' }).split('\u0001');
    assert.ok(card.includes(esc(before)), 'it says what is waiting');
    assert.ok(card.includes('href="/auth/broadcaster"') && card.includes(esc(t('en', 'dashboard.enableSubSync'))));
    assert.deepEqual(await dataOf(waiting).then((d) => [d.needsAuth, d.authAction]), [true, 'enable']);

    const reauth = twitchStub.needsBroadcasterReauth;
    twitchStub.needsBroadcasterReauth = () => true;
    try {
      const stale = linked({ broadcaster_access_token: 'synthetic-broadcaster' });
      const s = claimed(stale, { sub_sync_enabled: true, sub_role_id: '700000000000000005' });
      card = await cardOf(stale);
      assert.equal(state(card, s, 'subRoles').state, 'wait', 'an authorization that stopped working counts as none');
      assert.ok(card.includes(esc(t('en', 'dashboard.reconnect.cta'))));
    } finally {
      twitchStub.needsBroadcasterReauth = reauth;
    }
  });

  test('milestones wait for the broadcaster authorization too; recaps do not need it', async () => {
    const id = linked();
    const g = claimed(id, { recap_enabled: true, milestones_enabled: true });
    db.addWatchedChannel(g, id, loginOf(id), CH_LIVE, null, true, false, null);
    const card = await cardOf(id);
    assert.equal(state(card, g, 'recaps').state, 'on');
    assert.equal(state(card, g, 'milestones').state, 'wait');
  });

  test('weekly highlights: the server\'s switch, for the streamer the digest is made for (the first to switch it on in a shared server)', async () => {
    const first = linked();
    const second = linked();
    const g = nextGuild();
    guilds.set(g, fakeGuild(g));
    for (const id of [first, second]) {
      db.upsertGuild(g, id, 'Shared Server');
      db.updateGuildConfig(g, id, { weekly_highlights_enabled: true });
      db.addWatchedChannel(g, id, loginOf(id), CH_LIVE, null, true, false, null);
    }
    assert.equal(state(await cardOf(first), g, 'highlights').state, 'on');
    assert.equal(state(await cardOf(second), g, 'highlights').state, 'off', 'the digest of this server is made of the first streamer\'s channels');
  });

  test('several servers: how many announce the streamer\'s channel, and a link of its own on each; no big button', async () => {
    const id = linked();
    const announcing = claimed(id);
    db.addWatchedChannel(announcing, id, loginOf(id), CH_LIVE, CH_CLIPS, true, true, null);
    const quiet = claimed(id, {}, { seen: false, name: 'Stored Name' });
    const card = await cardOf(id);
    assert.ok(card.includes(esc(t('en', 'dashboard.cards.discord.statusSome', { count: 1, total: 2 }))));
    assert.deepEqual([...card.matchAll(/href="(\/dashboard\/guild\/[^"]*)"/g)].map((m) => m[1]), [`/dashboard/guild/${announcing}`, `/dashboard/guild/${quiet}?tab=twitch`]);
    assert.ok(!/class="btn btn-(?:primary|discord)\b/.test(card), 'the links of the rows are the actions');
    // the bot cannot see the second server: it is named as stored, and marked offline as on the Discord tab
    const row = card.slice(card.indexOf(`data-guild="${quiet}"`));
    assert.ok(row.includes('Stored Name') && row.includes(esc(t('en', 'dashboard.offline'))));
    const data = await dataOf(id);
    assert.equal(data.announcing, 1);
    assert.deepEqual(data.servers.map((s) => [s.guildId, s.botPresent]), [[announcing, true], [quiet, false]]);
  });

  test('a name made of markup is printed as text', async () => {
    const id = linked();
    claimed(id, {}, { seen: false, name: '<img src=x onerror=alert(1)>' });
    const card = await cardOf(id);
    assert.ok(!card.includes('<img src=x'));
    assert.ok(card.includes(esc('<img src=x onerror=alert(1)>')));
  });
});

// ── YouTube and Kick switched off (config.features.youtube, .kick) ───────

describe('with YouTube switched off', () => {
  const { features } = require('../config');
  beforeEach(() => { features.youtube = false; });
  afterEach(() => { features.youtube = true; });

  // A page says nothing of YouTube: not in its text, its links, its attributes or its comments (a class name in a
  // stylesheet, such as the layout's .tab-youtube, is not something a streamer reads).
  const YOUTUBE = /youtube|youtu\.be|super ?chat|\byt_/i;
  const noYoutube = (html, label) => {
    const page = html.replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
    const m = page.match(YOUTUBE);
    assert.ok(!m, `${label} talks about YouTube: ${m && page.slice(Math.max(0, m.index - 80), m.index + 60).replace(/\s+/g, ' ')}`);
  };
  let made = 0;
  const G = () => `60000000000000${String(700 + ++made).padStart(4, '0')}`;
  const YT = 'UC000000000000000000yt01';
  // A streamer with a server that watches a YouTube channel too, and has posted about it.
  const withYoutube = () => {
    const id = addStreamer({ twitch_user_id: `tw-yt-${made}`, twitch_username: `synthetic_yt_${made}`, yt_chatbot_enabled: 1, overlay_token: `synthetic-token-yt-${made}` });
    const g = G();
    db.upsertGuild(g, id, 'Server');
    db.updateGuildConfig(g, id, { youtube_enabled: true, youtube_channel_id: 'UC000000000000000legacy', welcome_enabled: true });
    guilds.set(g, fakeGuild(g));
    db.addWatchedChannel(g, id, `synthetic_yt_${made}`, CH_LIVE, CH_CLIPS, true, true, null);
    db.addWatchedYoutubeChannel(g, id, YT, 'Synthetic Tube', CH_LIVE, CH_CLIPS, null);
    db.logNotification(id, g, 'youtube_video', true);
    db.logNotification(id, g, 'twitch_live', true);
    return { id, g };
  };

  test('the dashboard has no YouTube tab, pane, card, count, link or word', async () => {
    const multistream = require('../config').multistream;
    const relay = multistream.enabled;
    multistream.enabled = true; // the multistream card streams to YouTube: hidden with it
    try {
      const { id, g } = withYoutube();
      const res = await request('GET', '/dashboard', { streamer: id, admin: true });
      assert.equal(res.status, 200);
      noYoutube(res.text, 'dashboard');
      assert.deepEqual(dashboardTabs(res.text), ['twitch', 'discord', 'kick', 'experimental', 'admin']);
      assert.ok(!res.text.includes('/dashboard/multistream'));
      // the Discord tab still has the server, its Twitch count and the notifications it sent
      const discord = dashboardPane(res.text, 'discord');
      assert.ok(discord.includes(`href="/dashboard/guild/${g}"`) && discord.includes('1 Twitch'));
      assert.ok(discord.includes(esc(t('en', 'dashboard.type.twitch_live'))), 'the Twitch posts are in the chart');
    } finally {
      multistream.enabled = relay;
    }
  });

  test('switched on, the dashboard is as it was: the YouTube tab and its cards, the YouTube counts, tile and chart', async () => {
    features.youtube = true;
    const { id } = withYoutube();
    const html = (await request('GET', '/dashboard', { streamer: id })).text;
    assert.deepEqual(dashboardTabs(html), ['twitch', 'discord', 'youtube', 'kick', 'experimental']);
    assert.ok(dashboardPane(html, 'youtube').includes('href="/dashboard/youtube-chatbot"'));
    const discord = dashboardPane(html, 'discord');
    for (const there of ['1 Twitch &middot; 1 YouTube', esc(t('en', 'dashboard.summary.youtubeLabel')), esc(t('en', 'dashboard.type.youtube_video')), esc(t('en', 'dashboard.youtubeBox.videoLabel'))]) {
      assert.ok(discord.includes(there), there);
    }
  });

  test('the YouTube chatbot page sends the streamer back to the dashboard; its saves are as they were (no page reaches them)', async () => {
    const { id } = withYoutube();
    const res = await request('GET', '/dashboard/youtube-chatbot', { streamer: id, json: true });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/dashboard');
    assert.equal((await request('GET', '/dashboard/youtube-chatbot')).headers.location, '/auth/login', 'a visitor who is not logged in still goes to the login page');
    const save = await request('POST', '/dashboard/youtube-chatbot', { streamer: id, form: { yt_chatbot_enabled: '1', yt_chat_member_template: 'Welcome {username}' } });
    assert.equal(save.status, 302);
    assert.equal(db.getStreamerById(id).yt_chat_member_template, 'Welcome {username}');
    features.youtube = true;
    const on = await request('GET', '/dashboard/youtube-chatbot', { streamer: id, json: true });
    assert.equal(on.status, 200);
    assert.equal(on.json().view, 'youtube-chatbot-config');
  });

  test('the server page has no YouTube tab, section, field or count, and ?tab=youtube opens Twitch', async () => {
    const { id, g } = withYoutube();
    const res = await request('GET', `/dashboard/guild/${g}`, { streamer: id });
    assert.equal(res.status, 200);
    noYoutube(res.text, 'server page');
    assert.ok(!res.text.includes('data-tab="youtube"') && !res.text.includes('id="tab-youtube"'));
    assert.ok(res.text.includes(`/dashboard/guild/${g}/channels`), 'the Twitch channels are there');
    const locals = (await request('GET', `/dashboard/guild/${g}?tab=youtube`, { streamer: id, json: true })).json().locals;
    assert.equal(locals.requestedTab, null);
    assert.equal(locals.activeTab, 'twitch');
    features.youtube = true;
    const on = await request('GET', `/dashboard/guild/${g}`, { streamer: id });
    for (const there of ['data-tab="youtube"', 'id="tab-youtube"', 'name="youtube_enabled"', 'Synthetic Tube', esc(t('en', 'guild.youtubeChannels'))]) assert.ok(on.text.includes(there), there);
  });

  test('a save of the server page keeps the YouTube channels it watches and the stored YouTube settings', async () => {
    const { id, g } = withYoutube();
    const watchers = () => db.getWatchedYoutubeChannelsForGuild(g, id).map((w) => [w.youtube_channel_id, w.videos_channel_id, w.live_channel_id, w.notify_videos, w.notify_live]);
    const before = watchers();
    // what the page sends while YouTube is hidden: no YouTube field at all
    const res = await request('POST', `/dashboard/guild/${g}`, { streamer: id, form: { twitch_live_enabled: 'on', twitch_clips_enabled: 'on', welcome_enabled: 'on', welcome_channel_id: CH_LIVE, recap_enabled: 'on' } });
    assert.equal(res.status, 302);
    const row = db.getGuildConfig(g, id);
    assert.equal(row.youtube_enabled, 1, 'the stored YouTube switch stays on');
    assert.equal(row.youtube_channel_id, 'UC000000000000000legacy');
    assert.equal(row.recap_enabled, 1, 'the rest is saved');
    assert.deepEqual(watchers(), before);
    assert.equal(before.length, 1);
    db.updateGuildConfig(g, id, { youtube_enabled: false });
    await request('POST', `/dashboard/guild/${g}`, { streamer: id, form: { welcome_enabled: 'on' } });
    assert.equal(db.getGuildConfig(g, id).youtube_enabled, 0, 'and an off one stays off');
    // with YouTube shown the page sends the field, as today
    features.youtube = true;
    await request('POST', `/dashboard/guild/${g}`, { streamer: id, form: { youtube_enabled: 'on' } });
    assert.equal(db.getGuildConfig(g, id).youtube_enabled, 1);
  });

  test('the server page\'s tabs: the one the address names, else the one picked last time, else Twitch; one the page does not have does not count', async () => {
    const { id, g } = withYoutube();
    const openTab = (html, saved) => {
      const open = new Set();
      const element = (kind, name) => ({ dataset: { tab: name }, id: `tab-${name}`, addEventListener() {}, classList: { toggle: (c, on) => { if (on) open.add(`${kind}:${name}`); else open.delete(`${kind}:${name}`); } } });
      const tabs = [...html.matchAll(/class="tab-btn[^"]*" data-tab="(\w+)"/g)].map((m) => element('button', m[1]));
      const panes = [...html.matchAll(/class="tab-content[^"]*" id="tab-(\w+)"/g)].map((m) => element('pane', m[1]));
      const document = { querySelectorAll: (selector) => ({ '.tab-btn': tabs, '.tab-content': panes }[selector] || []), getElementById: () => null };
      const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('guildconfig_tab'));
      new Function('document', 'localStorage', script)(document, { getItem: () => saved, setItem() {} });
      return [...open].sort();
    };
    const pageAt = async (query) => (await request('GET', `/dashboard/guild/${g}${query}`, { streamer: id })).text;
    assert.deepEqual(openTab(await pageAt(''), 'youtube'), ['button:twitch', 'pane:twitch'], 'a remembered YouTube tab');
    assert.deepEqual(openTab(await pageAt(''), 'discord'), ['button:discord', 'pane:discord'], 'the one picked last time');
    assert.deepEqual(openTab(await pageAt('?tab=twitch'), 'discord'), ['button:twitch', 'pane:twitch'], 'the address wins (a dashboard link to the Twitch tab)');
    assert.deepEqual(openTab(await pageAt('?tab=youtube'), 'settings'), ['button:settings', 'pane:settings'], 'a hidden tab in the address does not count');
    features.youtube = true;
    assert.deepEqual(openTab(await pageAt(''), 'youtube'), ['button:youtube', 'pane:youtube'], 'switched on, it opens as before');
  });

  test('the account page shows no YouTube channels and no YouTube posts', async () => {
    const { id } = withYoutube();
    const res = await request('GET', '/dashboard/account', { streamer: id });
    assert.equal(res.status, 200);
    noYoutube(res.text, 'account page');
    assert.ok(res.text.includes(esc(t('en', 'account.type.twitchLive'))), 'the Twitch posts are listed');
    features.youtube = true;
    const on = (await request('GET', '/dashboard/account', { streamer: id })).text;
    for (const there of [esc(t('en', 'guild.youtubeChannels')), esc(t('en', 'account.type.youtubeVideo'))]) assert.ok(on.includes(there), there);
  });

  test('the server statistics page shows no YouTube section', async () => {
    const { id, g } = withYoutube();
    const res = await request('GET', `/dashboard/guild/${g}/stats`, { streamer: id });
    assert.equal(res.status, 200);
    noYoutube(res.text, 'server statistics');
    features.youtube = true;
    assert.match((await request('GET', `/dashboard/guild/${g}/stats`, { streamer: id })).text, /YouTube/);
  });

  test('the overlay settings page and the Overlay Builder show no YouTube alerts (overlay features on)', async () => {
    const { id } = withYoutube();
    for (const url of ['/dashboard/overlay', '/dashboard/overlay-builder']) {
      const res = await request('GET', url, { streamer: id });
      assert.equal(res.status, 200, url);
      assert.ok(!/data-alert-tab="youtube"|data-type="yt_/.test(res.text), `${url}: a YouTube alert`);
    }
  });
});

describe('with Kick switched off', () => {
  const { features } = require('../config');
  beforeEach(() => { features.kick = false; });
  afterEach(() => { features.kick = true; });

  test('the dashboard has no Kick tab or pane, and the overlay pages no Kick tab or label', async () => {
    const id = addStreamer({ overlay_token: 'synthetic-token-kick-1' });
    const html = (await request('GET', '/dashboard', { streamer: id })).text;
    assert.ok(!html.includes('data-tab="kick"') && !html.includes('id="tab-kick"'));
    assert.ok(!html.includes(esc(t('en', 'dashboard.kick.comingSoon'))) && !html.includes(esc(t('en', 'dashboard.kick.comingSoonChat'))));
    const overlay = (await request('GET', '/dashboard/overlay', { streamer: id })).text;
    assert.ok(!overlay.includes('data-alert-tab="kick"') && !overlay.includes('id="alert-tab-kick"'));
    assert.ok(!overlay.includes(esc(t('en', 'overlay.kickTitle'))));
    const builder = (await request('GET', '/dashboard/overlay-builder', { streamer: id })).text;
    assert.ok(!builder.includes(esc(t('en', 'overlayBuilder.tab.kickSoon'))));
  });

  test('switched on, they are as they were', async () => {
    features.kick = true;
    const id = addStreamer({ overlay_token: 'synthetic-token-kick-2' });
    const html = (await request('GET', '/dashboard', { streamer: id })).text;
    assert.ok(html.includes('data-tab="kick"') && html.includes('id="tab-kick"'));
    assert.ok((await request('GET', '/dashboard/overlay', { streamer: id })).text.includes('data-alert-tab="kick"'));
    assert.ok((await request('GET', '/dashboard/overlay-builder', { streamer: id })).text.includes(esc(t('en', 'overlayBuilder.tab.kickSoon'))));
  });
});

// ── The giveaways page's times ───────────────────────────────────────────

describe('the giveaways page countdown', () => {
  test('reads the end time the giveaway stores (an ISO time) and the database\'s own times', async () => {
    const id = addStreamer({ chatbot_enabled: 1 });
    db.insertGiveaway({ streamer_id: id, keyword: 'gw', status: 'open', ends_at: '2026-10-14T18:05:00.000Z' });
    const page = await request('GET', '/dashboard/giveaways', { streamer: id });
    assert.equal(page.status, 200);
    const source = page.text.match(/function utcMs\(value\) \{[\s\S]*?\n\}/);
    assert.ok(source, 'the page has its time reader');
    const utcMs = new Function(`${source[0]}; return utcMs;`)();
    assert.equal(utcMs('2026-10-14T18:05:00.000Z'), Date.UTC(2026, 9, 14, 18, 5));
    assert.equal(utcMs('2026-10-14 18:05:00'), Date.UTC(2026, 9, 14, 18, 5));
    assert.ok(Number.isNaN(utcMs('not a time')));
    assert.doesNotMatch(page.text, /(?:ACTIVE_ENDS_AT|dateStr) \+ 'Z'\)/, 'no time is read by adding a Z to it');
  });
});

// ── The moderation save keeps its numbers in range ───────────────────────

describe('the moderation save keeps its settings in the page\'s ranges', () => {
  test('numbers past a range are brought into it, numbers that are not numbers get the default, an unknown action is delete', async () => {
    const id = addStreamer();
    const res = await request('POST', '/dashboard/chatbot/moderation', { streamer: id, form: {
      mod_link_permit_seconds: '99999', mod_caps_min_length: '-5', mod_caps_max_percent: 'abc',
      mod_emote_max_count: '0', mod_repetition_window: '1000', mod_symbol_max_percent: '5',
      mod_follow_age_minutes: '100000', mod_raid_protection_duration: '1', mod_action_response: 'ban_forever',
    } });
    assert.equal(res.status, 302);
    const row = db.getStreamerById(id);
    assert.deepEqual(
      [row.mod_link_permit_seconds, row.mod_caps_min_length, row.mod_caps_max_percent, row.mod_emote_max_count,
        row.mod_repetition_window, row.mod_symbol_max_percent, row.mod_follow_age_minutes, row.mod_raid_protection_duration],
      [600, 3, 70, 1, 300, 10, 1440, 30],
    );
    assert.equal(row.mod_action_response, 'delete');
  });
});

// ── Spotify disconnect, and the rewards switch ───────────────────────────

describe('disconnecting Spotify', () => {
  test('clears the stored Spotify tokens and says so on the dashboard', async () => {
    const id = addStreamer();
    db.updateSpotifyTokens(id, 'synthetic-access', 'synthetic-refresh', Date.now() + 3600e3);
    const res = await request('POST', '/dashboard/spotify/disconnect', { streamer: id, form: { go: '1' } });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/dashboard?msg=spotify_disconnected');
    const row = db.getStreamerById(id);
    assert.equal(row.spotify_access_token, null);
    assert.equal(row.spotify_refresh_token, null);
    const page = (await request('GET', '/dashboard?msg=spotify_disconnected', { streamer: id })).text;
    assert.ok(page.includes(t('en', 'dashboard.spotifyDisconnected')));
  });

  test('a connected Spotify card has a Disconnect button posting to that route', async () => {
    const id = addStreamer();
    db.updateSpotifyTokens(id, 'synthetic-access', 'synthetic-refresh', Date.now() + 3600e3);
    const page = (await request('GET', '/dashboard', { streamer: id })).text;
    assert.match(page, /<form method="POST" action="\/dashboard\/spotify\/disconnect"/);
  });
});

describe('the channel point rewards switch reads its value strictly', () => {
  test('"0" is off, 1 is on, anything else is refused and changes nothing', async () => {
    const id = addStreamer({ cp_rewards_enabled: 1 });
    const set = (value) => request('POST', '/dashboard/redemptions/settings', { streamer: id, body: { cp_rewards_enabled: value } });
    assert.equal((await set('0')).status, 200);
    assert.equal(db.getStreamerById(id).cp_rewards_enabled, 0);
    assert.equal((await set(1)).status, 200);
    assert.equal(db.getStreamerById(id).cp_rewards_enabled, 1);
    const bad = await set('yes');
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.json(), { ok: false, code: 'invalid', error: t('en', 'dashboard.settings.error.invalid') });
    assert.equal(db.getStreamerById(id).cp_rewards_enabled, 1);
  });
});

// ── The VTuber tab has its own switch (config.features.vtuber) ───────────

describe('with the VTuber tab switched off', () => {
  const { features } = require('../config');
  beforeEach(() => { features.vtuber = false; });
  afterEach(() => { features.vtuber = true; });

  test('the dashboard has no Experimental tab and the preview page sends the streamer back', async () => {
    const id = addStreamer({ overlay_token: 'synthetic-vtuber-token' });
    const page = (await request('GET', '/dashboard', { streamer: id })).text;
    assert.ok(!page.includes('data-tab="experimental"') && !page.includes('id="tab-experimental"'));
    const preview = await request('GET', '/dashboard/vtuber-preview', { streamer: id });
    assert.equal(preview.status, 302);
    assert.equal(preview.headers.location, '/dashboard');
  });

  test('a tab remembered from before (Experimental) opens Twitch, not an empty dashboard', async () => {
    const res = await request('GET', '/dashboard', { streamer: addStreamer() });
    assert.deepEqual(openDashboardTab(res.text, 'experimental'), { html: 'twitch', open: ['button:twitch', 'pane:twitch'] });
  });

  test('switched on (with the overlays), the tab is back', async () => {
    features.vtuber = true;
    const page = (await request('GET', '/dashboard', { streamer: addStreamer() })).text;
    assert.ok(page.includes('data-tab="experimental"') && page.includes('id="tab-experimental"'));
  });
});

// ── A test alert while the overlay switch is off ─────────────────────────

describe('a test alert while the overlay switch is off', () => {
  test('says the overlay is off and sends nothing; switched on, the alert goes out', async () => {
    const bus = require('../services/overlayBus');
    const id = addStreamer({ overlay_enabled: 0 });
    const seen = [];
    const listener = (event) => seen.push(event.type);
    bus.on(`overlay:${id}`, listener);
    try {
      const off = await request('POST', '/dashboard/overlay/test/follow', { streamer: id });
      assert.equal(off.status, 409);
      assert.deepEqual(off.json(), { ok: false, code: 'overlay_off', error: t('en', 'dashboard.settings.error.overlayOff') });
      assert.deepEqual(seen, []);
      db.updateOverlayConfig(id, { overlay_enabled: 1 });
      const on = await request('POST', '/dashboard/overlay/test/follow', { streamer: id });
      assert.equal(on.status, 200);
      assert.deepEqual(seen, ['follow']);
    } finally {
      bus.off(`overlay:${id}`, listener);
    }
  });
});

// ── Checking again whether the bot is a moderator ────────────────────────

describe('checking again whether the bot is a moderator', () => {
  test('asks the chat manager and answers what it found', async () => {
    const id = addStreamer({ chatbot_enabled: 1 });
    chatCalls.length = 0;
    const res = await request('POST', '/dashboard/chatbot/check-moderator', { streamer: id, body: {} });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { ok: true, moderator: true });
    assert.deepEqual(chatCalls, [['recheck', id]]);
  });
});

// ── POST /dashboard/settings (the working cards' switches) ───────────────

describe('a working card\'s switch (POST /dashboard/settings)', () => {
  const save = (id, body) => request('POST', '/dashboard/settings', { streamer: id, body });

  test('saves one column at once and answers what it saved; the other settings stay', async () => {
    const id = addStreamer({ chat_follow_enabled: 1, chat_follow_template: 'Keep me, {username}' });
    const res = await save(id, { key: 'chat_follow_enabled', value: false });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { ok: true, value: 0 });
    const row = db.getStreamerById(id);
    assert.equal(row.chat_follow_enabled, 0);
    assert.equal(row.chat_follow_template, 'Keep me, {username}');
  });

  test('switching the chatbot off and on leaves and joins chat and stops and starts the connections', async () => {
    const id = addStreamer({ chatbot_enabled: 1, overlay_enabled: 0, twitch_username: 'synthetic_card_bot', broadcaster_access_token: 'tok' });
    await save(id, { key: 'chatbot_enabled', value: 0 });
    assert.deepEqual(managerCalls, [['chat.stop', id], ['eventsub.stop', id], ['se.stop', id]]);
    assert.deepEqual(sponsorCalls, [['sponsors.stop', id]]);
    managerCalls.length = 0;
    sponsorCalls.length = 0;
    await save(id, { key: 'chatbot_enabled', value: 1 });
    assert.deepEqual(managerCalls, [['chat.start', id], ['eventsub.start', id]]);
    assert.deepEqual(sponsorCalls, [['sponsors.restart', id], ['sponsors.restartChat', id]]);
  });

  test('an overlay setting reaches an open overlay at once', async () => {
    const bus = require('../services/overlayBus');
    const id = addStreamer({ overlay_enabled: 1 });
    const seen = [];
    const listener = (event) => seen.push(event);
    bus.on(`overlay:${id}`, listener);
    try {
      await save(id, { key: 'overlay_follow_duration', value: 15 });
    } finally {
      bus.off(`overlay:${id}`, listener);
    }
    assert.equal(seen.length, 1);
    assert.equal(seen[0].type, 'config-update');
    assert.equal(db.getStreamerById(id).overlay_follow_duration, 15);
  });

  test('a key that is not on the list, or a value it cannot have, is refused with the reason and nothing changes', async () => {
    const id = addStreamer({ paypal_email: 'kept@example.test' });
    for (const body of [{ key: 'paypal_email', value: 'x@example.test' }, { key: 'overlay_follow_duration', value: 99 }, { key: 'mod_caps_enabled', value: 'maybe' }]) {
      const res = await save(id, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(res.json(), { ok: false, code: 'invalid', error: t('en', 'dashboard.settings.error.invalid') });
    }
    assert.equal(db.getStreamerById(id).paypal_email, 'kept@example.test');
  });

  test('the tip page needs a PayPal email to switch on', async () => {
    const id = addStreamer({ paypal_email: null, donation_page_enabled: 0 });
    const res = await save(id, { key: 'donation_page_enabled', value: 1 });
    assert.equal(res.status, 409);
    assert.deepEqual(res.json(), { ok: false, code: 'no_email', error: t('en', 'dashboard.settings.error.noEmail') });
    assert.equal(db.getStreamerById(id).donation_page_enabled, 0);
  });

  test('a server switch changes the streamer\'s own server; another streamer\'s answers 404', async () => {
    const id = addStreamer();
    const other = addStreamer();
    db.upsertGuild('600000000000000401', id, 'Mine');
    db.upsertGuild('600000000000000402', other, 'Theirs');
    assert.equal((await save(id, { key: 'recap_enabled', guildId: '600000000000000401', value: 1 })).status, 200);
    assert.equal(db.getGuildConfig('600000000000000401', id).recap_enabled, 1);
    const theirs = await save(id, { key: 'recap_enabled', guildId: '600000000000000402', value: 1 });
    assert.equal(theirs.status, 404);
    assert.equal(db.getGuildConfig('600000000000000402', other).recap_enabled, 0);
  });

  test('go-live in one server leaves the same channel\'s row in the streamer\'s other server alone', async () => {
    const id = addStreamer({ twitch_username: 'synthetic_two_servers' });
    for (const [guildId, channelId] of [['600000000000000501', '700000000000000501'], ['600000000000000502', '700000000000000502']]) {
      db.upsertGuild(guildId, id, 'Server');
      db.addWatchedChannel(guildId, id, 'synthetic_two_servers', channelId, null, 1, 0);
    }
    assert.equal((await save(id, { key: 'notify_live', guildId: '600000000000000501', value: 0 })).status, 200);
    assert.equal(db.getOwnWatcher('600000000000000501', id, 'synthetic_two_servers').notify_live, 0);
    assert.equal(db.getOwnWatcher('600000000000000502', id, 'synthetic_two_servers').notify_live, 1);
    const clips = await save(id, { key: 'notify_clips', guildId: '600000000000000501', value: 1 });
    assert.equal(clips.status, 409);
    assert.equal(clips.json().code, 'no_channel');
  });

  test('a batch is all or nothing and answers every value', async () => {
    const id = addStreamer({ cmd_uptime_enabled: 0, cmd_roll_enabled: 1 });
    const bad = await save(id, { changes: [{ key: 'cmd_uptime_enabled', value: 1 }, { key: 'cmd_roll_enabled', value: 'nope' }] });
    assert.equal(bad.status, 400);
    assert.equal(db.getStreamerById(id).cmd_uptime_enabled, 0, 'nothing was written');
    const good = await save(id, { changes: [{ key: 'cmd_uptime_enabled', value: 1 }, { key: 'cmd_roll_enabled', value: 0 }] });
    assert.deepEqual(good.json(), { ok: true, values: { cmd_uptime_enabled: 1, cmd_roll_enabled: 0 } });
  });

  test('a sponsor message switch changes the streamer\'s own message and restarts the rotation', async () => {
    const id = addStreamer();
    const other = addStreamer();
    const mine = Number(db.addSponsorMessage(id, 'Mine', null).lastInsertRowid);
    const theirs = Number(db.addSponsorMessage(other, 'Theirs', null).lastInsertRowid);
    assert.equal((await save(id, { key: 'sponsor_message_enabled', id: theirs, value: 0 })).status, 404);
    assert.equal((await save(id, { key: 'sponsor_message_enabled', id: mine, value: 0 })).status, 200);
    assert.equal(db.getSponsorMessages(id)[0].enabled, 0);
    assert.deepEqual(sponsorCalls, [['sponsors.restartChat', id]]);
  });

  test('a logged-out request changes nothing', async () => {
    const id = addStreamer({ chat_follow_enabled: 1 });
    const res = await request('POST', '/dashboard/settings', { body: { key: 'chat_follow_enabled', value: 0 } });
    assert.notEqual(res.status, 200);
    assert.equal(db.getStreamerById(id).chat_follow_enabled, 1);
  });

  test('a disabled account changes nothing', async () => {
    const id = addStreamer({ enabled: 0, chat_follow_enabled: 1 });
    const res = await save(id, { key: 'chat_follow_enabled', value: 0 });
    assert.equal(res.status, 403);
    assert.equal(db.getStreamerById(id).chat_follow_enabled, 1);
  });

  test('with a real session, a save without the page\'s CSRF token is refused; with it, it saves', async () => {
    const id = addStreamer({ chat_follow_enabled: 1 });
    const sid = `synthetic-session-settings-${id}`;
    db.createSession(sid, id, Date.now() + 60_000);
    const cookie = `session=${sid}`;
    const page = await request('GET', '/dashboard/chatbot', { cookie });
    const token = page.text.match(/<script src="\/js\/csrf\.js" data-csrf-token="([A-Za-z0-9_-]+)"><\/script>/)[1];
    const refused = await request('POST', '/dashboard/settings', { cookie, fetchMode: 'cors', body: { key: 'chat_follow_enabled', value: 0 } });
    assert.equal(refused.status, 403);
    assert.equal(db.getStreamerById(id).chat_follow_enabled, 1);
    const saved = await request('POST', '/dashboard/settings', { cookie, csrf: token, body: { key: 'chat_follow_enabled', value: 0 } });
    assert.equal(saved.status, 200);
    assert.equal(db.getStreamerById(id).chat_follow_enabled, 0);
  });

  test('the overlay switch starts and stops the connections unless the chatbot still needs them, and tells an open overlay either way', async () => {
    const bus = require('../services/overlayBus');
    const id = addStreamer({ overlay_enabled: 0, chatbot_enabled: 0, twitch_username: 'synthetic_overlay_switch' });
    const seen = [];
    const listener = (event) => seen.push(event.type);
    bus.on(`overlay:${id}`, listener);
    try {
      await save(id, { key: 'overlay_enabled', value: 1 });
      assert.deepEqual(managerCalls, [['eventsub.start', id]]);
      assert.deepEqual(sponsorCalls, [['sponsors.restart', id], ['sponsors.restartChat', id]]);
      managerCalls.length = 0;
      sponsorCalls.length = 0;
      await save(id, { key: 'overlay_enabled', value: 0 });
      assert.deepEqual(managerCalls, [['eventsub.stop', id], ['se.stop', id]]);
      assert.deepEqual(sponsorCalls, [['sponsors.stop', id]]);
      // With the chatbot on, the overlay switch leaves the connections (and the chat) alone.
      db.updateChatbotConfig(id, { chatbot_enabled: 1 });
      managerCalls.length = 0;
      sponsorCalls.length = 0;
      await save(id, { key: 'overlay_enabled', value: 1 });
      await save(id, { key: 'overlay_enabled', value: 0 });
      assert.deepEqual(managerCalls, []);
      assert.deepEqual(sponsorCalls, []);
    } finally {
      bus.off(`overlay:${id}`, listener);
    }
    assert.deepEqual(seen, ['config-update', 'config-update', 'config-update', 'config-update']);
  });

  test('a switch that is already as asked does not leave or join chat or touch the connections', async () => {
    const chatbotOn = addStreamer({ chatbot_enabled: 1, twitch_username: 'synthetic_same_switch_on' });
    const everythingOff = addStreamer({ overlay_enabled: 0, chatbot_enabled: 0, twitch_username: 'synthetic_same_switch_off' });
    assert.equal((await save(chatbotOn, { key: 'chatbot_enabled', value: 1 })).status, 200);
    assert.equal((await save(everythingOff, { key: 'overlay_enabled', value: 0 })).status, 200);
    assert.deepEqual(managerCalls, []);
    assert.deepEqual(sponsorCalls, []);
  });

  test('a follow-up that fails is logged; the save still answers ok and the other follow-ups still run', async () => {
    const id = addStreamer({ chatbot_enabled: 1, overlay_enabled: 0, twitch_username: 'synthetic_failing_steps' });
    const chat = chatStub.chatManager;
    const sponsors = timedNotificationsStub.timedNotificationManager;
    const original = { stop: chat.stopForStreamer, restartChat: sponsors.restartChatForStreamer };
    chat.stopForStreamer = () => { throw new Error('synthetic chat failure'); };
    sponsors.restartChatForStreamer = () => { throw new Error('synthetic sponsor failure'); };
    try {
      const off = await save(id, { key: 'chatbot_enabled', value: 0 });
      assert.equal(off.status, 200);
      assert.deepEqual(managerCalls, [['eventsub.stop', id], ['se.stop', id]], 'the connections were still stopped');
      const sponsor = await save(id, { key: 'sponsor_send_chat', value: 1 });
      assert.equal(sponsor.status, 200);
      assert.equal(db.getStreamerById(id).sponsor_send_chat, 1);
    } finally {
      chat.stopForStreamer = original.stop;
      sponsors.restartChatForStreamer = original.restartChat;
    }
    assert.ok(logs.some(([level, line]) => level === 'error' && line === '[Dashboard] Chatbot start/stop error: synthetic chat failure'));
    assert.ok(logs.some(([level, line]) => level === 'error' && line === '[Dashboard] Sponsor chat restart failed: synthetic sponsor failure'));
  });
});

// ── The working cards' text routes ───────────────────────────────────────

describe('the Commands card (JSON)', () => {
  const add = (id, body) => request('POST', '/dashboard/api/commands', { streamer: id, body });

  test('adds, edits and deletes the streamer\'s own commands with the chatbot page\'s rules', async () => {
    const id = addStreamer();
    const added = await add(id, { command: '!Discord', response: 'Join us', cooldown: 10 });
    assert.equal(added.status, 201);
    const command = added.json().command;
    assert.equal(command.command, 'discord');
    assert.equal(command.cooldown, 10);

    const edited = await request('PATCH', `/dashboard/api/commands/${command.id}`, { streamer: id, body: { response: 'Join our Discord' } });
    assert.equal(edited.status, 200);
    assert.equal(edited.json().command.command, 'discord', 'the name stays');
    assert.equal(edited.json().command.response, 'Join our Discord');

    const other = addStreamer();
    assert.equal((await request('PATCH', `/dashboard/api/commands/${command.id}`, { streamer: other, body: { response: 'x' } })).status, 404);
    assert.equal((await request('DELETE', `/dashboard/api/commands/${command.id}`, { streamer: other })).status, 404);
    assert.equal((await request('DELETE', `/dashboard/api/commands/${command.id}`, { streamer: id })).status, 200);
    assert.equal((await request('DELETE', `/dashboard/api/commands/${command.id}`, { streamer: id })).status, 404);
  });

  test('a bad name, a name in use and the 101st command are refused with their reason', async () => {
    const id = addStreamer();
    const bad = await add(id, { command: 'two words', response: 'x' });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.json(), { ok: false, code: 'name_invalid', error: t('en', 'chatbot.commands.error.nameInvalid') });
    assert.equal((await add(id, { command: 'socials', response: 'x' })).status, 201);
    const dup = await add(id, { command: 'socials', response: 'y' });
    assert.equal(dup.status, 409);
    assert.equal(dup.json().code, 'duplicate');
    for (let i = db.countChatCommands(id); i < 100; i++) db.addChatCommand(id, `cmd${i}`, 'x', 5);
    const tooMany = await add(id, { command: 'onemore', response: 'x' });
    assert.equal(tooMany.status, 409);
    assert.deepEqual(tooMany.json(), { ok: false, code: 'too_many', error: t('en', 'chatbot.commands.error.tooMany', { max: 100 }) });
  });

  test('an edit that breaks a rule is refused with its reason and leaves the command as it was; a good one keeps the switch', async () => {
    const id = addStreamer();
    db.addChatCommand(id, 'socials', 'Find me everywhere', 30);
    const mine = Number(db.addChatCommand(id, 'discord', 'Join us', 10).lastInsertRowid);
    db.db.prepare('UPDATE chat_commands SET enabled = 0 WHERE id = ?').run(mine);
    const edit = (body) => request('PATCH', `/dashboard/api/commands/${mine}`, { streamer: id, body });

    assert.equal((await edit({ command: 'two words' })).json().code, 'name_invalid');
    const inUse = await edit({ command: '!Socials' });
    assert.equal(inUse.status, 409);
    assert.deepEqual(inUse.json(), { ok: false, code: 'duplicate', error: t('en', 'chatbot.commands.error.duplicate') });
    const tooLong = await edit({ response: 'x'.repeat(501) });
    assert.equal(tooLong.status, 400);
    assert.deepEqual(tooLong.json(), { ok: false, code: 'response_too_long', error: t('en', 'chatbot.commands.error.responseTooLong', { max: 500 }) });
    assert.equal((await edit({ response: '   ' })).json().code, 'response_required');
    let row = db.getChatCommandById(mine, id);
    assert.deepEqual([row.command, row.response, row.cooldown, row.enabled], ['discord', 'Join us', 10, 0], 'the refusals wrote nothing');

    const renamed = await edit({ command: '!Chat', cooldown: 60 });
    assert.equal(renamed.status, 200);
    row = renamed.json().command;
    assert.deepEqual([row.command, row.response, row.cooldown, row.enabled], ['chat', 'Join us', 60, 0], 'a switched-off command stays off');
  });

  test('an id that is not a number is a command that is not there', async () => {
    const id = addStreamer();
    const expected = { ok: false, code: 'not_found', error: t('en', 'dashboard.settings.error.notFound') };
    assert.deepEqual((await request('PATCH', '/dashboard/api/commands/abc', { streamer: id, body: { response: 'x' } })).json(), expected);
    assert.deepEqual((await request('DELETE', '/dashboard/api/commands/abc', { streamer: id })).json(), expected);
  });
});

describe('a sponsor message edit changes only what it is given', () => {
  test('switching a message off keeps its text and link; an empty text is refused; another streamer\'s answers 404', async () => {
    const id = addStreamer();
    const msg = Number(db.addSponsorMessage(id, 'Partner line', 'https://example.test').lastInsertRowid);
    const update = (streamerId, body) => request('POST', `/dashboard/sponsor-messages/${msg}/update`, { streamer: streamerId, body });
    assert.equal((await update(id, { enabled: 0 })).status, 200);
    let row = db.getSponsorMessages(id)[0];
    assert.deepEqual([row.message_text, row.url, row.enabled], ['Partner line', 'https://example.test', 0]);
    assert.equal((await update(id, { message_text: 'New line' })).status, 200);
    row = db.getSponsorMessages(id)[0];
    assert.deepEqual([row.message_text, row.url, row.enabled], ['New line', 'https://example.test', 0]);
    const empty = await update(id, { message_text: '   ' });
    assert.equal(empty.status, 400);
    assert.equal(empty.json().code, 'required');
    assert.equal((await update(addStreamer(), { enabled: 1 })).status, 404);
  });

  test('adding answers with the new message, its text trimmed; an empty or too long text is refused', async () => {
    const id = addStreamer();
    const added = await request('POST', '/dashboard/sponsor-messages/add', { streamer: id, body: { message_text: '  Partner line  ', url: 'https://example.test' } });
    assert.equal(added.status, 200);
    const message = added.json().message;
    assert.deepEqual([message.message_text, message.url, message.enabled], ['Partner line', 'https://example.test', 1]);
    assert.equal(db.getSponsorMessages(id)[0].id, message.id);
    assert.equal((await request('POST', '/dashboard/sponsor-messages/add', { streamer: id, body: { message_text: '   ' } })).json().code, 'required');
    assert.equal((await request('POST', '/dashboard/sponsor-messages/add', { streamer: id, body: { message_text: 'x'.repeat(501) } })).json().code, 'too_long');
  });

  test('a switch that is not a switch, or a text past 500 characters, is refused before anything is written', async () => {
    const id = addStreamer();
    const msg = Number(db.addSponsorMessage(id, 'Partner line', 'https://example.test').lastInsertRowid);
    const update = (body) => request('POST', `/dashboard/sponsor-messages/${msg}/update`, { streamer: id, body });
    const maybe = await update({ message_text: 'Other line', enabled: 'maybe' });
    assert.equal(maybe.status, 400);
    assert.deepEqual(maybe.json(), { ok: false, code: 'invalid', error: t('en', 'dashboard.settings.error.invalid') });
    const long = await update({ message_text: 'x'.repeat(501), enabled: 0 });
    assert.equal(long.status, 400);
    assert.deepEqual(long.json(), { ok: false, code: 'too_long', error: t('en', 'dashboard.settings.error.tooLong') });
    const row = db.getSponsorMessages(id)[0];
    assert.deepEqual([row.message_text, row.url, row.enabled], ['Partner line', 'https://example.test', 1]);
    assert.deepEqual(sponsorCalls, [], 'a refused update does not restart the rotation');
  });

  // src/views/timed-notifications.ejs sends the text, the link and the switch together: null for no link,
  // '1' for on and '' for off.
  test('the sponsor messages page\'s own calls keep working: text, link and switch together', async () => {
    const id = addStreamer();
    const added = await request('POST', '/dashboard/sponsor-messages/add', { streamer: id, body: { message_text: 'Partner line', url: null } });
    const msg = added.json().message;
    assert.equal(msg.url, null);
    const update = (body) => request('POST', `/dashboard/sponsor-messages/${msg.id}/update`, { streamer: id, body });
    const stored = () => { const row = db.getSponsorMessages(id)[0]; return [row.message_text, row.url, row.enabled]; };

    assert.equal((await update({ message_text: 'Partner line', url: null, enabled: '' })).status, 200);
    assert.deepEqual(stored(), ['Partner line', null, 0], 'its switch off');
    assert.equal((await update({ message_text: 'New line', url: 'https://example.test', enabled: '1' })).status, 200);
    assert.deepEqual(stored(), ['New line', 'https://example.test', 1], 'a saved edit, which switches the message on');
    assert.equal((await update({ message_text: 'New line', url: null, enabled: '1' })).status, 200);
    assert.deepEqual(stored(), ['New line', null, 1], 'a link taken away');
  });
});

describe('the Donations card\'s tip goal (JSON)', () => {
  test('starts a goal in the tip page\'s currency, edits it keeping its bar colour, and ends it', async () => {
    const bus = require('../services/overlayBus');
    const id = addStreamer({ donation_currency: 'USD' });
    const told = [];
    const listener = () => told.push('goal');
    bus.on(`tipgoal:${id}`, listener);
    try {
      const started = await request('POST', '/dashboard/api/tip-goal', { streamer: id, body: { title: 'New wheel', target_amount: 500 } });
      assert.equal(started.status, 201);
      assert.equal(started.json().goal.currency, 'USD');
      db.db.prepare('UPDATE tip_goals SET bar_color = ? WHERE streamer_id = ?').run('#ff0000', id);
      const edited = await request('PATCH', '/dashboard/api/tip-goal', { streamer: id, body: { target_amount: 750 } });
      assert.equal(edited.status, 200);
      assert.equal(edited.json().goal.target_amount, 750);
      assert.equal(edited.json().goal.title, 'New wheel');
      assert.equal(edited.json().goal.bar_color, '#ff0000');
      const bad = await request('PATCH', '/dashboard/api/tip-goal', { streamer: id, body: { title: '' } });
      assert.equal(bad.status, 400);
      assert.equal(bad.json().code, 'title_required');
      assert.equal((await request('POST', '/dashboard/api/tip-goal/end', { streamer: id, body: {} })).status, 200);
      assert.equal(db.getActiveTipGoal(id), null);
      assert.equal((await request('POST', '/dashboard/api/tip-goal/end', { streamer: id, body: {} })).status, 404);
    } finally {
      bus.off(`tipgoal:${id}`, listener);
    }
    assert.equal(told.length, 3, 'the goal bar is told after the start, the edit and the end');
  });

  test('a goal needs a title and a target, and an edit with no goal is a goal that is not there; a new goal replaces the old', async () => {
    const bus = require('../services/overlayBus');
    const id = addStreamer();
    const told = [];
    const listener = () => told.push('goal');
    bus.on(`tipgoal:${id}`, listener);
    try {
      const noTarget = await request('POST', '/dashboard/api/tip-goal', { streamer: id, body: { title: 'New wheel', target_amount: 0 } });
      assert.equal(noTarget.status, 400);
      assert.deepEqual(noTarget.json(), { ok: false, code: 'target_invalid', error: t('en', 'donations.goal.error.targetInvalid') });
      assert.equal((await request('POST', '/dashboard/api/tip-goal', { streamer: id, body: { target_amount: 5 } })).json().code, 'title_required');
      assert.equal(db.getActiveTipGoal(id), null, 'a refused start creates nothing');
      const gone = await request('PATCH', '/dashboard/api/tip-goal', { streamer: id, body: { title: 'x' } });
      assert.equal(gone.status, 404);
      assert.deepEqual(gone.json(), { ok: false, code: 'not_found', error: t('en', 'donations.goal.error.notFound') });
      assert.deepEqual(told, [], 'a refusal does not tell the goal bar');

      const first = await request('POST', '/dashboard/api/tip-goal', { streamer: id, body: { title: 'New wheel', target_amount: '12.5' } });
      assert.equal(first.status, 201);
      assert.equal(first.json().goal.currency, 'EUR', 'the tip page\'s currency, EUR when it was never set');
      assert.equal(first.json().goal.target_amount, 12.5);
      const second = await request('POST', '/dashboard/api/tip-goal', { streamer: id, body: { title: 'Second', target_amount: 20 } });
      assert.equal(db.getActiveTipGoal(id).id, second.json().goal.id, 'one active goal per streamer');
      assert.equal(told.length, 2);
    } finally {
      bus.off(`tipgoal:${id}`, listener);
    }
  });
});
