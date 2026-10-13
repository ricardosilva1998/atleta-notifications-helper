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
const logs = [];
const saved = {};

// `body` is sent as JSON; `contentType` overrides the type of a raw or form body
// (the upload routes read the raw bytes, so those use application/octet-stream).
function request(method, urlPath, { streamer, form, rawBody, body: jsonBody, contentType, json = false } = {}) {
  return new Promise((resolve, reject) => {
    const body = rawBody
      || (jsonBody !== undefined ? JSON.stringify(jsonBody) : null)
      || (form ? new URLSearchParams(form).toString() : null);
    const type = contentType || (jsonBody !== undefined ? 'application/json' : 'application/x-www-form-urlencoded');
    const headers = body ? { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) } : {};
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
      if (request === 'fs') return fakeFs;
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
  const { errorHandler } = require('../errorHandler');

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(SRC, 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json({ limit: '10mb' }));
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
  app.use(errorHandler);

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
  fileWrites.length = 0;
  fileRemovals.length = 0;
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

// ── Adding a Twitch channel (N12, N13) ───────────────────────────────────

describe('adding a Twitch channel', () => {
  const G = '600000000000000001';
  let id;
  beforeEach(() => {
    id = addStreamer();
    db.upsertGuild(G, id, 'Server');
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
    assert.equal(row.overlay_raid_duration, 7);
    assert.equal(row.overlay_volume, 1);
  });

  test('a blank token field keeps the saved token, and EventSub and StreamElements keep running', async () => {
    await save({ overlay_enabled: '1', streamelements_jwt: '' });
    assert.equal(db.getStreamerById(id).streamelements_jwt, JWT);
    assert.deepEqual(managerCalls, [['eventsub.start', id], ['se.start', id]]);
  });

  test('a typed token replaces the saved one', async () => {
    await save({ overlay_enabled: '1', streamelements_jwt: ' other.token.value ' });
    assert.equal(db.getStreamerById(id).streamelements_jwt, 'other.token.value');
    assert.deepEqual(managerCalls, [['eventsub.start', id], ['se.start', id]]);
  });

  test('the remove box clears the token and stops the StreamElements connection', async () => {
    await save({ overlay_enabled: '1', streamelements_jwt: '', streamelements_jwt_remove: '1' });
    assert.equal(db.getStreamerById(id).streamelements_jwt, null);
    assert.deepEqual(managerCalls, [['eventsub.start', id], ['se.stop', id]]);
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
