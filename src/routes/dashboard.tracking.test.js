'use strict';

// The Tracking page (/dashboard/tracking) and its JSON routes (/dashboard/api/tracking/*): the real
// src/routes/dashboard.js on a small Express app, the real src/db.js on an in-memory SQLite database, the real
// trackingGoals and trackers services with Twitch stubbed, and stubs for the connection managers (whose starts and
// stops are recorded). Nothing reaches the network. All ids, names and tokens are synthetic.

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
// The page exists only with the overlay features (config.features.overlays): on for the file, off in its own test.
require('../config').features.overlays = true;

const SRC = path.join(__dirname, '..');
const DB_FILE = path.join(SRC, 'db.js');
const DASHBOARD_FILE = path.join(__dirname, 'dashboard.js');
const GOALS_FILE = path.join(SRC, 'services', 'trackingGoals.js');
const PAGE_SCRIPT = path.join(SRC, '..', 'public', 'js', 'tracking-page.js');
const TRACKERS = ['latest_follower', 'latest_sub', 'latest_tip', 'latest_raid', 'latest_bits', 'top_tipper'];

// ── Stubs ────────────────────────────────────────────────────────────────

const managerCalls = [];
const record = (name) => (...args) => managerCalls.push([name, ...args]);
const eventSubCalls = () => managerCalls.filter(([name]) => name.startsWith('eventsub'));
// What the goals' Twitch reads answer: a number, or an Error (with a code) to throw.
const twitchTotals = { follow: 120, sub: 7 };
const answer = (value) => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value));
const goalsTwitchStub = {
  followerTotal: () => answer(twitchTotals.follow),
  subscriberTotal: () => answer(twitchTotals.sub),
  followersSince: async () => ({ followers: [], complete: true }),
};
const STUBS = {
  '../discord': { client: { guilds: { cache: new Map() }, application: { id: '1480000000000000000' } }, fetchGuildChannel: async () => null, streamerGuildForChannel: () => null },
  '../services/twitch': { getUserProfile: async () => null, hasRedemptionScope: () => true, hasPollsScope: () => false, needsBroadcasterReauth: () => false },
  '../services/youtube': { resolveChannelId: async () => null, getLatestVideos: async () => [], getChannelInfo: async () => null },
  '../services/twitchChat': { chatManager: { isConnected: () => false, sendEventMessage: () => {}, sendMessage: () => {}, startForStreamer: record('chat.start'), stopForStreamer: record('chat.stop'), moderatorStatus: () => null } },
  '../services/shoutouts': { shoutouts: { testInChat: async () => 'sent' } },
  '../services/youtubeLiveChat': { youtubeChatManager: { isPolling: () => false, getLiveChatId: () => null, startPolling: () => {}, stopPolling: () => {} } },
  '../services/agentTriage': { analyzeIssue: async () => {} },
  '../services/eventsub': { eventSubManager: { startForStreamer: record('eventsub.start'), stopForStreamer: record('eventsub.stop') } },
  '../services/streamelements': { streamElementsManager: { startForStreamer: record('se.start'), stopForStreamer: record('se.stop') } },
  '../services/timedNotifications': { timedNotificationManager: { restartForStreamer: () => {}, restartChatForStreamer: () => {}, stopForStreamer: () => {} } },
};

// ── App ──────────────────────────────────────────────────────────────────

let db;
let t;
let bus;
let server;
let port;
const saved = {};

function request(method, urlPath, { streamer, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {};
    if (streamer) headers['x-test-streamer'] = String(streamer);
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, agent: false, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    if (data) req.write(data);
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
    if (from === DASHBOARD_FILE && Object.hasOwn(STUBS, request)) return STUBS[request];
    if (from === GOALS_FILE && request === './twitch') return goalsTwitchStub;
    return saved.load.call(this, request, parent, isMain);
  };
  for (const level of ['log', 'warn', 'error']) {
    saved[level] = console[level];
    console[level] = () => {};
  }
  saved.fetch = global.fetch;
  global.fetch = async (url) => { throw new Error(`unexpected outbound request in a test: ${url}`); };

  delete require.cache[DB_FILE];
  delete require.cache[DASHBOARD_FILE];
  db = require(DB_FILE);
  bus = require('../services/overlayBus');
  const i18n = require('../i18n');
  t = i18n.t;
  const { applyAccountStatus } = require('../services/streamerAccess');
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(SRC, 'views'));
  app.use(express.json());
  app.use((req, res, next) => {
    // What server.js's session middleware and locals do for these tests: the header's streamer is logged in.
    const id = Number(req.get('x-test-streamer'));
    req.streamer = id ? db.getStreamerById(id) : undefined;
    applyAccountStatus(req);
    res.locals.t = (key, params) => t('en', key, params);
    res.locals.lang = 'en';
    res.locals.SUPPORTED_LANGS = i18n.SUPPORTED_LANGS;
    res.locals.esc = i18n.esc;
    res.locals.rich = i18n.richFor(res.locals.t);
    res.locals.features = require('../config').features;
    res.locals.isAdmin = false;
    res.locals.streamer = req.streamer || null;
    res.locals.csrfToken = 'token';
    next();
  });
  app.use('/dashboard', require('./dashboard'));
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
  const cols = {
    discord_user_id: `21000000000000${String(n).padStart(4, '0')}`, discord_username: `tracking${n}`,
    twitch_username: `chan${n}`, twitch_user_id: `9300${n}`, overlay_token: `synthetic-tracking-token-${n}`, ...over,
  };
  const names = Object.keys(cols);
  return Number(db.db.prepare(`INSERT INTO streamers (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((k) => cols[k])).lastInsertRowid);
}
const MONTHLY = { title: 'Road to 50', target: 50, barColor: '#ff8800', period: 'month', mode: 'calendar', timeZone: 'Europe/Lisbon' };
const LIFETIME = { title: 'All time', target: 500, period: 'lifetime' };
const state = async (streamer) => (await request('GET', '/dashboard/api/tracking/state', { streamer })).json().state;
// What goes out on a bus channel while `fn` runs.
async function heard(channel, fn) {
  const got = [];
  const listener = (event) => got.push(event);
  bus.on(channel, listener);
  try { await fn(); } finally { bus.off(channel, listener); }
  return got;
}

beforeEach(() => {
  managerCalls.length = 0;
  twitchTotals.follow = 120;
  twitchTotals.sub = 7;
});

// ── The page ─────────────────────────────────────────────────────────────

describe('the Tracking page', () => {
  test('renders for a logged-in streamer: both goals, the six trackers, their previews and OBS links, and the script with its texts', async () => {
    const s = addStreamer();
    const token = db.getStreamerById(s).overlay_token;
    const res = await request('GET', '/dashboard/tracking', { streamer: s });
    assert.equal(res.status, 200);
    const html = res.text;
    assert.match(html, /id="goal-follow"/);
    assert.match(html, /id="goal-sub"/);
    for (const tracker of TRACKERS) {
      assert.match(html, new RegExp(`id="tracker-${tracker}"`), tracker);
      assert.ok(html.includes(`/overlay/tracker/${tracker}/${token}?lang=en`), `${tracker}'s OBS link`);
    }
    assert.ok(html.includes(`/overlay/goal/followers/${token}?lang=en`));
    assert.ok(html.includes(`/overlay/goal/subs/${token}?lang=en`));
    assert.ok(html.includes('src="/overlay/goal-demo/tracking?lang=en"'));
    assert.ok(html.includes('src="/overlay/tracker-demo?lang=en"'));
    const texts = html.indexOf('window.TRACKING_TEXTS = ');
    const script = html.indexOf('<script src="/js/tracking-page.js"></script>');
    assert.ok(texts > 0 && texts < script, 'the texts come before the script');
    assert.ok(html.includes(t('en', 'tracking.title')));
  });

  test('without an OBS link the page says how to get one and shows no links', async () => {
    const html = (await request('GET', '/dashboard/tracking', { streamer: addStreamer({ overlay_token: null }) })).text;
    assert.ok(html.includes(t('en', 'tracking.noLink')));
    assert.ok(!html.includes('/overlay/goal/followers/'));
  });

  test('redirects to the dashboard while the overlay features are off', async () => {
    const { features } = require('../config');
    features.overlays = false;
    try {
      const res = await request('GET', '/dashboard/tracking', { streamer: addStreamer() });
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/dashboard');
    } finally {
      features.overlays = true;
    }
  });

  test('the first visit writes the six trackers\' rows (on), which starts the event connections; a later visit writes and starts nothing', async () => {
    const s = addStreamer();
    assert.equal(db.usesTracking(s), false);
    await request('GET', '/dashboard/tracking', { streamer: s });
    const rows = db.getTrackerSettings(s);
    assert.deepEqual(Object.keys(rows).sort(), [...TRACKERS].sort());
    assert.ok(Object.values(rows).every((row) => row.enabled === 1 && row.color === null));
    assert.deepEqual(eventSubCalls(), [['eventsub.start', s]]);
    managerCalls.length = 0;
    db.setTrackerSetting(s, 'latest_tip', { enabled: false });
    await request('GET', '/dashboard/tracking', { streamer: s });
    assert.equal(db.getTrackerSettings(s).latest_tip.enabled, 0, 'a switched-off tracker stays off');
    assert.deepEqual(managerCalls, []);
  });

  test('a streamer whose overlay is on already has the connections: the first visit starts nothing again', async () => {
    await request('GET', '/dashboard/tracking', { streamer: addStreamer({ overlay_enabled: 1 }) });
    assert.deepEqual(managerCalls, []);
  });
});

// ── The goals ────────────────────────────────────────────────────────────

describe('the goals', () => {
  test('a started goal appears in the state, with its time zone; starting it starts the event connections', async () => {
    const s = addStreamer();
    const res = await request('POST', '/dashboard/api/tracking/goal/follow', { streamer: s, body: MONTHLY });
    assert.equal(res.status, 200);
    assert.equal(res.json().ok, true);
    const st = await state(s);
    assert.equal(st.goals.follow.goal.title, 'Road to 50');
    assert.equal(st.goals.follow.goal.target, 50);
    assert.equal(st.goals.follow.goal.barColor, '#ff8800');
    assert.equal(st.goals.follow.goal.period, 'month');
    assert.equal(st.goals.follow.timeZone, 'Europe/Lisbon');
    assert.equal(st.goals.sub.goal, null);
    assert.deepEqual(eventSubCalls(), [['eventsub.start', s]]);
  });

  test('a lifetime goal counts from Twitch\'s total', async () => {
    const s = addStreamer();
    twitchTotals.sub = 31;
    const res = await request('POST', '/dashboard/api/tracking/goal/sub', { streamer: s, body: LIFETIME });
    assert.equal(res.json().state.goals.sub.goal.current, 31);
  });

  test('a calendar goal in a time zone Atleta does not know is refused: 400 bad_zone, nothing started', async () => {
    const s = addStreamer();
    const res = await request('POST', '/dashboard/api/tracking/goal/follow', { streamer: s, body: { ...MONTHLY, timeZone: 'Mars/Olympus' } });
    assert.equal(res.status, 400);
    assert.deepEqual(res.json(), { ok: false, error: 'bad_zone' });
    assert.equal(db.getActiveTrackingGoal(s, 'follow'), null);
    assert.deepEqual(managerCalls, []);
  });

  test('the other refusals are codes too, and an unknown kind is 404', async () => {
    const s = addStreamer();
    const refused = async (body) => (await request('POST', '/dashboard/api/tracking/goal/follow', { streamer: s, body })).json().error;
    assert.equal(await refused({ ...MONTHLY, title: '' }), 'bad_title');
    assert.equal(await refused({ ...MONTHLY, target: 0 }), 'bad_target');
    assert.equal(await refused({ ...MONTHLY, period: 'decade' }), 'bad_period');
    assert.equal(await refused({ ...MONTHLY, period: 'hours', hours: 9999 }), 'bad_hours');
    assert.equal((await request('POST', '/dashboard/api/tracking/goal/bits', { streamer: s, body: MONTHLY })).status, 404);
  });

  test('a lifetime goal Twitch does not answer for is refused with twitch_failed, and the running goal stays', async () => {
    const s = addStreamer();
    await request('POST', '/dashboard/api/tracking/goal/sub', { streamer: s, body: LIFETIME });
    twitchTotals.sub = new Error('timeout');
    const res = await request('POST', '/dashboard/api/tracking/goal/sub', { streamer: s, body: { ...LIFETIME, title: 'Second' } });
    assert.equal(res.status, 502);
    assert.deepEqual(res.json(), { ok: false, error: 'twitch_failed' });
    assert.equal(db.getActiveTrackingGoal(s, 'sub').title, 'All time');
  });

  test('a token without the scope starts the goal showing needs_reconnect', async () => {
    const s = addStreamer();
    twitchTotals.follow = Object.assign(new Error('no scope'), { code: 'needs_reconnect' });
    const res = await request('POST', '/dashboard/api/tracking/goal/follow', { streamer: s, body: LIFETIME });
    assert.equal(res.status, 200);
    assert.equal(res.json().state.goals.follow.goal.unavailable, 'needs_reconnect');
  });

  test('edit, nudge and end: the state follows; the ended calendar goal is a past goal, ended, with its count; ending stops the connections', async () => {
    const s = addStreamer();
    await request('POST', '/dashboard/api/tracking/goal/follow', { streamer: s, body: MONTHLY });
    managerCalls.length = 0;

    const edited = await request('PATCH', '/dashboard/api/tracking/goal/follow', { streamer: s, body: { title: 'Road to 60', target: 60 } });
    assert.equal(edited.status, 200);
    assert.equal(edited.json().state.goals.follow.goal.title, 'Road to 60');
    assert.equal(edited.json().state.goals.follow.goal.barColor, '#ff8800', 'the colour stays when none is sent');
    assert.equal((await request('PATCH', '/dashboard/api/tracking/goal/follow', { streamer: s, body: { title: '', target: 60 } })).json().error, 'bad_title');

    const nudged = await request('POST', '/dashboard/api/tracking/goal/follow/nudge', { streamer: s, body: { delta: 3 } });
    assert.equal(nudged.json().state.goals.follow.goal.current, 3);
    const bad = await request('POST', '/dashboard/api/tracking/goal/follow/nudge', { streamer: s, body: { delta: 1.5 } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json().error, 'bad_delta');

    const ended = await request('POST', '/dashboard/api/tracking/goal/follow/end', { streamer: s });
    assert.equal(ended.status, 200);
    const st = ended.json().state;
    assert.equal(st.goals.follow.goal, null);
    assert.equal(st.goals.follow.history.length, 1);
    assert.equal(st.goals.follow.history[0].title, 'Road to 60');
    assert.equal(st.goals.follow.history[0].reached, false);
    // Ruling 12: a calendar goal ended in the middle of its period did not miss it.
    assert.equal(st.goals.follow.history[0].result, 'ended');
    assert.equal(st.goals.follow.history[0].count, 3, 'the count it showed when it ended');
    assert.equal(st.goals.follow.history[0].target, 60);
    assert.equal(st.goals.follow.history[0].timeZone, 'Europe/Lisbon');
    assert.deepEqual(eventSubCalls(), [['eventsub.stop', s]]);

    for (const [method, route] of [['PATCH', ''], ['POST', '/nudge'], ['POST', '/end']]) {
      const res = await request(method, `/dashboard/api/tracking/goal/follow${route}`, { streamer: s, body: { title: 'x', target: 5, delta: 1 } });
      assert.equal(res.status, 404, `${method} ${route}`);
      assert.equal(res.json().error, 'not_found');
    }
  });

  test('a reached goal that ended is a past goal, reached', async () => {
    const s = addStreamer();
    await request('POST', '/dashboard/api/tracking/goal/follow', { streamer: s, body: { ...MONTHLY, target: 2 } });
    await request('POST', '/dashboard/api/tracking/goal/follow/nudge', { streamer: s, body: { delta: 2 } });
    const st = (await request('POST', '/dashboard/api/tracking/goal/follow/end', { streamer: s })).json().state;
    assert.equal(st.goals.follow.history[0].reached, true);
    assert.equal(st.goals.follow.history[0].result, 'reached');
    assert.equal(st.goals.follow.history[0].count, 2);
  });

  test('a lifetime goal ended unreached is missed, with its count; it has no time zone', async () => {
    const s = addStreamer();
    await request('POST', '/dashboard/api/tracking/goal/follow', { streamer: s, body: LIFETIME });
    const row = (await request('POST', '/dashboard/api/tracking/goal/follow/end', { streamer: s })).json().state.goals.follow.history[0];
    assert.deepEqual([row.result, row.reached, row.count, row.target, row.timeZone], ['missed', false, 120, 500, null]);
  });

  // The page shows a finished period's days in the goal's time zone, the last one included: September in Lisbon runs
  // from 2026-08-31T23:00Z up to (not including) 2026-09-30T23:00Z, so its last moment is 22:59:59.999Z on the 30th.
  test('a finished period keeps reached or missed, with its count, its first moment and its last (inclusive), and the time zone', async () => {
    const s = addStreamer();
    const g = db.createTrackingGoal(s, 'follow', { title: 'Monthly', target: 50, bar_color: '#22c55e', period: 'month', mode: 'calendar', time_zone: 'Europe/Lisbon', period_start: '2026-08-31T23:00:00Z' });
    db.rollTrackingGoal(g.id, { periodStart: '2026-08-31T23:00:00Z', periodEnd: '2026-09-30T23:00:00Z', count: 12, target: 50, reached: false, nextStart: '2026-09-30T23:00:00Z' });
    const row = (await state(s)).goals.follow.history[0];
    assert.deepEqual(row, {
      title: 'Monthly', period: 'month', mode: 'calendar', target: 50, count: 12, reached: false, result: 'missed',
      start: '2026-08-31T23:00:00Z', end: '2026-09-30T22:59:59.999Z', timeZone: 'Europe/Lisbon',
    });
  });

  test('a test answers with the message the live bar got, so the preview draws the same; "small" is 5% of the target', async () => {
    const s = addStreamer();
    await request('POST', '/dashboard/api/tracking/goal/follow', { streamer: s, body: { ...MONTHLY, target: 200 } });
    let answer;
    const sent = await heard(`trackgoal:${s}:follow`, async () => {
      answer = (await request('POST', '/dashboard/api/tracking/goal/follow/test', { streamer: s, body: { test: 'small' } })).json();
    });
    assert.deepEqual(answer.message, sent[0]);
    assert.equal(answer.message.added, 10);
    assert.equal(answer.message.goal.title, 'Road to 50');
    assert.equal(answer.revertMs, 10000);
  });

  test('the test buttons play on the bar (a sample one titled in the page\'s language without a goal), share the test cooldown, and reset at once', async () => {
    const s = addStreamer();
    const sent = await heard(`trackgoal:${s}:follow`, async () => {
      const res = await request('POST', '/dashboard/api/tracking/goal/follow/test', { streamer: s, body: { test: 'small' } });
      assert.equal(res.status, 200);
      assert.equal(res.json().ok, true);
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].test, true);
    assert.equal(sent[0].goal.title, t('en', 'tracking.goal.follow.title'));
    assert.equal(sent[0].added, 1, 'the sample bar: 5% of its target, at least 1');

    const fast = await request('POST', '/dashboard/api/tracking/goal/sub/test', { streamer: s, body: { test: 'reach' } });
    assert.equal(fast.status, 429);
    assert.equal(fast.json().error, 'too_fast');
    assert.ok(fast.json().seconds >= 1);

    const reset = await heard(`trackgoal:${s}:follow`, async () => {
      assert.equal((await request('POST', '/dashboard/api/tracking/goal/follow/test', { streamer: s, body: { test: 'reset' } })).status, 200);
    });
    assert.deepEqual(reset, [{ type: 'track_goal', goal: null }], 'the real (no) goal again, with no wait');
    assert.equal((await request('POST', '/dashboard/api/tracking/goal/follow/test', { streamer: addStreamer(), body: { test: 'loud' } })).json().error, 'bad_test');
  });
});

// ── The trackers ─────────────────────────────────────────────────────────

describe('the trackers', () => {
  test('a switch and a colour persist, and the open sources are told at once', async () => {
    const s = addStreamer();
    await request('GET', '/dashboard/tracking', { streamer: s });
    const sent = await heard(`tracker:${s}`, async () => {
      const res = await request('POST', '/dashboard/api/tracking/tracker/latest_tip', { streamer: s, body: { enabled: false, color: '#ff00aa' } });
      assert.equal(res.status, 200);
      assert.deepEqual(res.json().state.trackers.latest_tip, { enabled: false, color: '#ff00aa', ownColor: true, value: null });
    });
    assert.deepEqual(db.getTrackerSettings(s).latest_tip, { enabled: 0, color: '#ff00aa' });
    assert.deepEqual(sent, [{ type: 'tracker_settings', tracker: 'latest_tip', enabled: false, color: '#ff00aa' }]);

    const cleared = await heard(`tracker:${s}`, async () => {
      await request('POST', '/dashboard/api/tracking/tracker/latest_tip', { streamer: s, body: { color: null } });
    });
    assert.deepEqual(cleared, [{ type: 'tracker_settings', tracker: 'latest_tip', enabled: false, color: '#9146FF' }], 'no colour: the default');
  });

  test('the last tracker switched off stops the connections, the first back on starts them', async () => {
    const s = addStreamer();
    await request('GET', '/dashboard/tracking', { streamer: s });
    managerCalls.length = 0;
    for (const tracker of TRACKERS) await request('POST', `/dashboard/api/tracking/tracker/${tracker}`, { streamer: s, body: { enabled: false } });
    assert.deepEqual(eventSubCalls(), [['eventsub.stop', s]]);
    managerCalls.length = 0;
    await request('POST', '/dashboard/api/tracking/tracker/latest_raid', { streamer: s, body: { enabled: true } });
    assert.deepEqual(eventSubCalls(), [['eventsub.start', s]]);
  });

  test('a test shows a sample on the source (named in the page\'s language), stores nothing, shares the test cooldown', async () => {
    const s = addStreamer();
    const sent = await heard(`tracker:${s}`, async () => {
      const res = await request('POST', '/dashboard/api/tracking/tracker/latest_bits/test', { streamer: s, body: {} });
      assert.equal(res.status, 200);
      assert.deepEqual(res.json(), { ok: true, revertMs: 10000 });
    });
    assert.deepEqual(sent, [{ type: 'tracker', tracker: 'latest_bits', value: { name: t('en', 'tracking.tracker.sampleName'), amount: 500 }, test: true }]);
    assert.equal(db.getTrackerValues(s).latest_bits, undefined, 'nothing stored');
    const fast = await request('POST', '/dashboard/api/tracking/tracker/latest_tip/test', { streamer: s, body: {} });
    assert.equal(fast.status, 429);
    assert.equal(fast.json().error, 'too_fast');
    assert.equal((await request('POST', '/dashboard/api/tracking/tracker/constructor/test', { streamer: addStreamer(), body: {} })).status, 404);
  });

  test('refusals: an unknown tracker is 404; a bad switch or colour, or nothing to change, is 400', async () => {
    const s = addStreamer();
    assert.equal((await request('POST', '/dashboard/api/tracking/tracker/constructor', { streamer: s, body: { enabled: true } })).status, 404);
    const refused = async (body) => (await request('POST', '/dashboard/api/tracking/tracker/latest_raid', { streamer: s, body })).json().error;
    assert.equal(await refused({ enabled: 'yes' }), 'bad_switch');
    assert.equal(await refused({ color: 'red' }), 'bad_color');
    assert.equal(await refused({}), 'bad_switch');
    assert.deepEqual(db.getTrackerSettings(s), {});
  });

  test('the state holds each tracker\'s value and the not-Affiliate flag', async () => {
    const s = addStreamer({ cp_affiliate_status: 'not_affiliate' });
    db.setTrackerValue(s, 'latest_raid', { name: 'Raider', viewers: 12 });
    const st = await state(s);
    assert.deepEqual(st.trackers.latest_raid.value, { name: 'Raider', viewers: 12 });
    assert.equal(st.trackers.latest_follower.value, null);
    assert.equal(st.notAffiliate, true);
    assert.equal((await state(addStreamer())).notAffiliate, false);
  });
});

// ── One streamer's routes reach only their own Tracking ──

describe('another streamer', () => {
  test('cannot see, change, test or end a streamer\'s goal, nor change their trackers', async () => {
    const a = addStreamer();
    const b = addStreamer();
    await request('GET', '/dashboard/tracking', { streamer: a });
    await request('POST', '/dashboard/api/tracking/goal/follow', { streamer: a, body: MONTHLY });
    const before = db.getActiveTrackingGoal(a, 'follow');

    assert.equal((await state(b)).goals.follow.goal, null, 'b sees no goal');
    assert.equal((await request('PATCH', '/dashboard/api/tracking/goal/follow', { streamer: b, body: { title: 'Hijacked', target: 1 } })).status, 404);
    assert.equal((await request('POST', '/dashboard/api/tracking/goal/follow/nudge', { streamer: b, body: { delta: 5 } })).status, 404);
    assert.equal((await request('POST', '/dashboard/api/tracking/goal/follow/end', { streamer: b })).status, 404);
    const tested = await heard(`trackgoal:${a}:follow`, async () => {
      await request('POST', '/dashboard/api/tracking/goal/follow/test', { streamer: b, body: { test: 'reach' } });
    });
    assert.deepEqual(tested, [], 'a\'s bar heard nothing');
    const told = await heard(`tracker:${a}`, async () => {
      await request('POST', '/dashboard/api/tracking/tracker/latest_tip', { streamer: b, body: { enabled: false, color: '#ff00aa' } });
    });
    assert.deepEqual(told, [], 'a\'s sources heard nothing');

    assert.deepEqual(db.getActiveTrackingGoal(a, 'follow'), before, 'a\'s goal is as it was');
    assert.deepEqual(db.getTrackerSettings(a).latest_tip, { enabled: 1, color: null }, 'a\'s tracker is as it was');
  });
});

// ── The page script's texts ──────────────────────────────────────────────

describe('the page script\'s texts', () => {
  const table = (html) => JSON.parse(html.match(/window\.TRACKING_TEXTS = (.*?);<\/script>/)[1]);

  // public/js/tracking-page.js reads its texts as T.name (the refusals as T.errors[code]). A text the table does not
  // hold would show as "undefined" only when its moment comes, and one it holds that the script never reads is dead.
  test('every text the script reads is handed over, and every text handed over is read', async () => {
    const T = table((await request('GET', '/dashboard/tracking', { streamer: addStreamer() })).text);
    const source = realFs.readFileSync(PAGE_SCRIPT, 'utf8');
    const reads = new Set([...source.matchAll(/\bT\.(\w+)/g)].map((m) => m[1]));
    assert.ok(reads.size >= 10, `the scan finds the texts the script reads (${reads.size})`);
    assert.deepEqual([...reads].filter((name) => !(name in T)), [], 'texts the script reads that the page does not give it');
    assert.deepEqual(Object.keys(T).filter((name) => !reads.has(name)), [], 'texts the page gives that the script never reads');
    for (const [name, text] of Object.entries(T)) if (typeof text === 'string') assert.ok(text, name);
  });

  test('every refusal the routes answer has its text', async () => {
    const T = table((await request('GET', '/dashboard/tracking', { streamer: addStreamer() })).text);
    for (const code of ['bad_title', 'bad_target', 'bad_color', 'bad_period', 'bad_mode', 'bad_zone', 'bad_hours', 'bad_delta', 'bad_switch', 'bad_test', 'not_found', 'twitch_failed', 'too_fast']) {
      assert.ok(T.errors[code], code);
    }
    assert.ok(T.errors.too_fast.includes('{{seconds}}'), 'the wait is filled in by the script');
  });
});
