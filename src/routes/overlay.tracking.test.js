'use strict';

// The Tracking sources' OBS links (src/routes/overlay.js): the follower and sub goal bars and the six trackers, their
// event streams and their token-less previews; and that the tip goal's links answer as before. The real
// src/routes/overlay.js over the real src/db.js on in-memory SQLite. All ids, tokens and names are synthetic.

const { test, describe, before, after } = require('node:test');
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
const TRACKERS = ['latest_follower', 'latest_sub', 'latest_tip', 'latest_raid', 'latest_bits', 'top_tipper'];

let db;
let bus;
let lifecycle;
let trackingGoals;
let trackers;
let server;
let port;
const saved = {};
const openStreams = [];

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath, agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
    }).on('error', reject);
  });
}

// Opens an event stream; resolves once something has arrived (or the server answered with something other than 200).
// stream.messages() parses what arrived so far, heartbeats left out.
function openStream(urlPath) {
  return new Promise((resolve, reject) => {
    const stream = {
      chunks: [], ended: false, status: null, request: null,
      messages() {
        return this.chunks.join('').split('\n\n').filter((block) => block.startsWith('data: ')).map((block) => JSON.parse(block.slice(6)));
      },
    };
    const request = http.get({ host: '127.0.0.1', port, path: urlPath, agent: false }, (res) => {
      stream.status = res.statusCode;
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        stream.chunks.push(chunk);
        if (stream.chunks.length === 1) resolve(stream);
      });
      res.on('end', () => { stream.ended = true; if (res.statusCode !== 200) resolve(stream); });
      res.on('error', () => { stream.ended = true; });
    });
    stream.request = request;
    request.on('error', (e) => { stream.ended = true; reject(e); });
    openStreams.push(request);
  });
}

async function until(condition, message) {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

before(async () => {
  saved.load = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
    }
    return saved.load(request, parent, isMain);
  };
  saved.log = console.log;
  saved.error = console.error;
  console.log = () => {};
  console.error = () => {};

  delete require.cache[DB_FILE];
  db = require(DB_FILE);
  bus = require('../services/overlayBus');
  lifecycle = require('../services/accountLifecycle');
  trackingGoals = require('../services/trackingGoals');
  trackers = require('../services/trackers');

  const app = express();
  app.use('/overlay', require('./overlay'));
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = server.address().port;
});

after(async () => {
  for (const request of openStreams) request.destroy();
  console.log = saved.log;
  console.error = saved.error;
  Module._load = saved.load;
  await new Promise((resolve) => server.close(resolve));
});

let counter = 0;
function addStreamer() {
  const n = ++counter;
  const token = `tok-tracking-${n}`;
  const id = Number(db.db.prepare('INSERT INTO streamers (discord_user_id, discord_username, overlay_token) VALUES (?, ?, ?)')
    .run(`41000000000000${String(n).padStart(4, '0')}`, `user${n}`, token).lastInsertRowid);
  return { id, token };
}

function disable(id) {
  const noop = { startForStreamer() {}, stopForStreamer() {} };
  lifecycle.disableAccount(id, null, {
    db, bus,
    eventSubManager: noop, streamElementsManager: noop, chatManager: noop,
    timedNotificationManager: { stopForStreamer() {}, restartForStreamer() {}, restartChatForStreamer() {} },
  });
}

// A lifetime goal whose last Twitch total was `total` (no Twitch read: the total is handed in).
function startLifetimeGoal(id, kind, total) {
  return db.createTrackingGoal(id, kind, { title: `${kind} goal`, target: 100, period: 'lifetime', lifetimeTotal: total });
}

const GOALS = [['followers', 'follow'], ['subs', 'sub']];

describe('the Tracking pages', () => {
  test('a goal bar and every tracker answer 200 for a real token, with the stream they read and their texts', async () => {
    const { token } = addStreamer();
    for (const [slug] of GOALS) {
      const page = await get(`/overlay/goal/${slug}/${token}`);
      assert.equal(page.status, 200, slug);
      assert.match(page.text, /<script src="\/overlay\/tracking\.js"><\/script>/);
      assert.ok(page.text.includes(`"events":"/overlay/goal/${slug}/events/${token}"`), slug);
      assert.match(page.text, /window\.TRACKING_TEXTS = \{/);
    }
    for (const tracker of TRACKERS) {
      const page = await get(`/overlay/tracker/${tracker}/${token}`);
      assert.equal(page.status, 200, tracker);
      assert.ok(page.text.includes(`"tracker":"${tracker}"`), tracker);
      assert.ok(page.text.includes(`"events":"/overlay/tracker/${tracker}/events/${token}"`), tracker);
    }
  });

  test('an unknown token, or a tracker that does not exist, is 404', async () => {
    const { token } = addStreamer();
    for (const link of [
      '/overlay/goal/followers/no-such-token', '/overlay/goal/subs/no-such-token',
      '/overlay/goal/followers/events/no-such-token', '/overlay/goal/subs/events/no-such-token',
      '/overlay/tracker/latest_follower/no-such-token', '/overlay/tracker/latest_follower/events/no-such-token',
      `/overlay/tracker/latest_hug/${token}`, `/overlay/tracker/latest_hug/events/${token}`,
      `/overlay/tracker/constructor/${token}`, `/overlay/goal/bits/${token}`,
    ]) {
      const res = await get(link);
      assert.equal(res.status, 404, link);
      assert.doesNotMatch(res.text, /TRACKING_PAGE|"type":"config"/, link);
    }
  });

  test('the texts come in the language the link names (?lang=), English otherwise', async () => {
    const { token } = addStreamer();
    const pt = require('../locales/pt.json');
    const en = require('../locales/en.json');
    const inPortuguese = await get(`/overlay/tracker/latest_follower/${token}?lang=pt`);
    assert.match(inPortuguese.text, /<html lang="pt">/);
    assert.ok(inPortuguese.text.includes(JSON.stringify(pt['tracking.source.latestFollower'])));
    const unknown = await get(`/overlay/goal/subs/${token}?lang=xx`);
    assert.match(unknown.text, /<html lang="en">/);
    assert.ok(unknown.text.includes(JSON.stringify(en['tracking.source.notAffiliate'])));
    // {{count}} stays for the page to fill in
    assert.ok(unknown.text.includes('{{count}}'));
  });

  test('the previews answer without a token and read no stream', async () => {
    for (const link of ['/overlay/goal-demo/tracking', '/overlay/tracker-demo', '/overlay/tracker-demo?lang=de']) {
      const page = await get(link);
      assert.equal(page.status, 200, link);
      assert.match(page.text, /"demo":true/, link);
      assert.doesNotMatch(page.text, /"events"/, link);
    }
  });
});

describe('the tip goal links answer as before', () => {
  test('the page, its stream and its preview', async () => {
    const { id, token } = addStreamer();
    const page = await get(`/overlay/goal/${token}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /\/overlay\/goal\.js/);
    assert.doesNotMatch(page.text, /tracking\.js/);
    assert.equal((await get('/overlay/goal/no-such-token')).status, 404);

    const stream = await openStream(`/overlay/goal/events/${token}`);
    await until(() => stream.messages().length >= 2, 'the tip goal stream sends its config and the goal');
    assert.deepEqual(stream.messages().map((m) => m.type), ['config', 'tip_goal']);
    bus.emit(`tipgoal:${id}`, { type: 'probe' });
    await until(() => stream.messages().some((m) => m.type === 'probe'), 'the tip goal stream passes its bus events');

    const demo = await get('/overlay/goal-demo');
    assert.equal(demo.status, 200);
    assert.match(demo.text, /window\.GOAL_DEMO = true/);
  });
});

describe('a goal bar\'s stream', () => {
  for (const [slug, kind] of GOALS) {
    test(`${slug}: the config, then the goal as it stands (a reload shows the same number), then its own events`, async () => {
      const { id, token } = addStreamer();
      startLifetimeGoal(id, kind, 42);
      const first = await openStream(`/overlay/goal/${slug}/events/${token}`);
      await until(() => first.messages().length >= 2, 'config and goal');
      const [config, goal] = first.messages();
      assert.equal(config.type, 'config');
      assert.equal(typeof config.serverVersion, 'string');
      assert.equal(goal.type, 'track_goal');
      assert.equal(goal.goal.kind, kind);
      assert.equal(goal.goal.current, 42);
      assert.equal(goal.goal.target, 100);

      first.request.destroy();
      const again = await openStream(`/overlay/goal/${slug}/events/${token}`);
      await until(() => again.messages().length >= 2, 'config and goal again');
      assert.equal(again.messages()[1].goal.current, 42);

      const other = kind === 'follow' ? 'sub' : 'follow';
      bus.emit(trackingGoals.channel(id, other), { type: 'track_goal', goal: { id: 999, kind: other } });
      bus.emit(trackingGoals.channel(id, kind), { type: 'track_goal', goal: { id: 1000, kind }, added: 1 });
      await until(() => again.messages().some((m) => m.goal && m.goal.id === 1000), 'its own goal\'s event arrives');
      assert.ok(!again.messages().some((m) => m.goal && m.goal.id === 999), 'the other goal\'s event does not');
    });
  }

  test('without an active goal the bar is told there is none', async () => {
    const { token } = addStreamer();
    const stream = await openStream(`/overlay/goal/subs/events/${token}`);
    await until(() => stream.messages().length >= 2, 'config and goal');
    assert.deepEqual(stream.messages()[1], { type: 'track_goal', goal: null });
  });

  test('counts as an open source while it is open, and stops counting once the viewer leaves', async () => {
    const { id, token } = addStreamer();
    const a = await openStream(`/overlay/goal/followers/events/${token}`);
    const b = await openStream(`/overlay/goal/followers/events/${token}`);
    assert.equal(trackingGoals.connected(id, 'follow', 0), 2);
    assert.equal(trackingGoals.connected(id, 'sub', 0), 0);
    a.request.destroy();
    await until(() => trackingGoals.connected(id, 'follow', 0) === 1, 'one left');
    b.request.destroy();
    await until(() => trackingGoals.connected(id, 'follow', 0) === 0, 'none left');
    assert.equal(bus.listenerCount(trackingGoals.channel(id, 'follow')), 0);
    assert.equal(bus.listenerCount(`overlay-disabled:${id}`), 0);
  });
});

describe('a tracker\'s stream', () => {
  test('the config with the tracker\'s settings (on, Atleta purple by default), then its stored value', async () => {
    const { id, token } = addStreamer();
    db.setTrackerValue(id, 'latest_follower', { name: 'viewer_a' });
    const stream = await openStream(`/overlay/tracker/latest_follower/events/${token}`);
    await until(() => stream.messages().length >= 2, 'config and value');
    const [config, value] = stream.messages();
    assert.equal(config.type, 'config');
    assert.deepEqual(config.settings, { enabled: true, color: '#9146FF' });
    assert.deepEqual(value, { type: 'tracker', tracker: 'latest_follower', value: { name: 'viewer_a' } });
  });

  test('a switched-off tracker is told so, with its colour; a tracker with nothing stored gets null', async () => {
    const { id, token } = addStreamer();
    db.setTrackerSetting(id, 'latest_bits', { enabled: false, color: '#ff0000' });
    const stream = await openStream(`/overlay/tracker/latest_bits/events/${token}`);
    await until(() => stream.messages().length >= 2, 'config and value');
    assert.deepEqual(stream.messages()[0].settings, { enabled: false, color: '#ff0000' });
    assert.deepEqual(stream.messages()[1], { type: 'tracker', tracker: 'latest_bits', value: null });
  });

  test('the top tipper is worked out when the source opens', async () => {
    const { id, token } = addStreamer();
    db.logDonation(id, { source: 'paypal', external_id: `order-${id}`, donor_name: 'Generous', amount: 12, currency: 'EUR' });
    const stream = await openStream(`/overlay/tracker/top_tipper/events/${token}`);
    await until(() => stream.messages().length >= 2, 'config and value');
    assert.deepEqual(stream.messages()[1].value, { name: 'Generous', amount: 12, currency: 'EUR' });
  });

  test('passes only its own tracker\'s values and settings', async () => {
    const { id, token } = addStreamer();
    const stream = await openStream(`/overlay/tracker/latest_raid/events/${token}`);
    await until(() => stream.messages().length >= 2, 'config and value');
    bus.emit(trackers.channel(id), { type: 'tracker', tracker: 'latest_bits', value: { name: 'other', amount: 5 } });
    bus.emit(trackers.channel(id), { type: 'tracker_settings', tracker: 'latest_bits', enabled: false, color: '#000000' });
    bus.emit(trackers.channel(id), { type: 'tracker_settings', tracker: 'latest_raid', enabled: false, color: '#123456' });
    bus.emit(trackers.channel(id), { type: 'tracker', tracker: 'latest_raid', value: { name: 'raider', viewers: 7 } });
    await until(() => stream.messages().some((m) => m.value && m.value.name === 'raider'), 'its own value arrives');
    const passed = stream.messages().slice(2);
    assert.deepEqual(passed.map((m) => [m.type, m.tracker]), [['tracker_settings', 'latest_raid'], ['tracker', 'latest_raid']]);
  });
});

describe('the Tracking links of a disabled account', () => {
  test('answer as an unknown token, and a stream already open is ended and stops counting', async () => {
    const { id, token } = addStreamer();
    const goal = await openStream(`/overlay/goal/followers/events/${token}`);
    const tracker = await openStream(`/overlay/tracker/latest_tip/events/${token}`);
    assert.equal(trackingGoals.connected(id, 'follow', 0), 1);
    disable(id);
    await until(() => goal.ended && tracker.ended, 'the streams were not ended');
    await until(() => trackingGoals.connected(id, 'follow', 0) === 0, 'the goal source still counts');
    for (const link of [
      `/overlay/goal/followers/${token}`, `/overlay/goal/subs/${token}`, `/overlay/goal/subs/events/${token}`,
      `/overlay/tracker/latest_tip/${token}`, `/overlay/tracker/latest_tip/events/${token}`,
    ]) {
      assert.equal((await get(link)).status, 404, link);
    }
  });
});
