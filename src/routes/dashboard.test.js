'use strict';

// The dashboard router end to end: the real src/routes/dashboard.js on a small
// Express app, the real src/db.js on an in-memory SQLite database, and stubs for
// everything that would leave the machine (Discord, Twitch, the connection
// managers). All ids, names and tokens are synthetic.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');
const { Collection, PermissionFlagsBits } = require('discord.js');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

// src/config.js exits without these; the values are never used.
for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) {
  process.env[key] = process.env[key] || 'test';
}

const SRC = path.join(__dirname, '..');
const DB_FILE = path.join(SRC, 'db.js');
const DASHBOARD_FILE = path.join(__dirname, 'dashboard.js');

// ── Stubs the dashboard router is loaded with ────────────────────────────

const CH_LIVE = '500000000000000001';
const CH_CLIPS = '500000000000000002';

const guilds = new Map(); // id -> fake discord.js Guild
const twitch = { users: {}, lookups: [], failWith: null, beforeAnswer: null };
const managerCalls = [];

const discordStub = {
  client: { guilds: { cache: guilds }, application: { id: '1480000000000000000' } },
  // A saved channel id counts only if it is one of the two channels below.
  fetchGuildChannel: async (guildId, channelId) => ((channelId === CH_LIVE || channelId === CH_CLIPS) ? { id: channelId, guildId } : null),
  streamerGuildForChannel: () => null,
};
const twitchStub = {
  getUserProfile: async (login) => {
    twitch.lookups.push(login);
    if (twitch.beforeAnswer) await twitch.beforeAnswer(login);
    if (twitch.failWith) throw new Error(twitch.failWith);
    return twitch.users[login] || null;
  },
  hasRedemptionScope: () => true,
  needsBroadcasterReauth: () => false,
};
const youtubeStub = { resolveChannelId: async () => null, getLatestVideos: async () => [], getChannelInfo: async () => null };
const chatStub = { chatManager: { isConnected: () => false, sendEventMessage() {} } };
const record = (name) => (...args) => managerCalls.push([name, ...args]);
const eventSubStub = { eventSubManager: { startForStreamer: record('eventsub.start'), stopForStreamer: record('eventsub.stop') } };
const streamElementsStub = { streamElementsManager: { startForStreamer: record('se.start'), stopForStreamer: record('se.stop') } };

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
const logs = [];
const saved = {};

function request(method, urlPath, { streamer, form, rawBody, json = false } = {}) {
  return new Promise((resolve, reject) => {
    const body = rawBody || (form ? new URLSearchParams(form).toString() : null);
    const headers = body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {};
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
  saved.load = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    const from = parent && parent.filename;
    if (from === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
    }
    if (from === DASHBOARD_FILE) {
      if (request === '../discord') return discordStub;
      if (request === '../services/twitch') return twitchStub;
      if (request === '../services/youtube') return youtubeStub;
      if (request === '../services/twitchChat') return chatStub;
      if (request === '../services/eventsub') return eventSubStub;
      if (request === '../services/streamelements') return streamElementsStub;
    }
    return saved.load(request, parent, isMain);
  };
  for (const level of ['log', 'warn', 'error']) {
    saved[level] = console[level];
    console[level] = (...args) => logs.push([level, args.join(' ')]);
  }

  delete require.cache[DB_FILE];
  delete require.cache[DASHBOARD_FILE];
  db = require(DB_FILE);
  ({ t } = require('../i18n'));
  const { applyAccountStatus } = require('../services/streamerAccess');

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(SRC, 'views'));
  app.use(express.urlencoded({ extended: true }));
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
  app.use('/dashboard', require('./dashboard'));

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
  guilds.clear();
  twitch.users = {};
  twitch.lookups = [];
  twitch.failWith = null;
  twitch.beforeAnswer = null;
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
      assert.match(res.text, /href="\/auth\/logout"/, route);
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
