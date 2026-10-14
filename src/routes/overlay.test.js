'use strict';

// The OBS overlay links of a disabled account: they stop serving, and a stream
// that was already open when the account was disabled is ended. The real
// src/routes/overlay.js over the real src/db.js on in-memory SQLite. All ids and
// tokens are synthetic.

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

let db;
let bus;
let lifecycle;
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
      res.on('end', () => resolve({ status: res.statusCode, text }));
    }).on('error', reject);
  });
}

// Opens an event stream and resolves once its first message has arrived. The
// result tells whether the server has ended the stream, and what it sent.
function openStream(urlPath) {
  return new Promise((resolve, reject) => {
    const stream = { chunks: [], ended: false, status: null, request: null };
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
  const token = `tok-overlay-${n}`;
  const id = Number(db.db.prepare('INSERT INTO streamers (discord_user_id, discord_username, overlay_token) VALUES (?, ?, ?)')
    .run(`40000000000000${String(n).padStart(4, '0')}`, `user${n}`, token).lastInsertRowid);
  return { id, token };
}

// Disables through the real lifecycle, with managers that do nothing.
function disable(id) {
  const noop = { startForStreamer() {}, stopForStreamer() {} };
  lifecycle.disableAccount(id, null, {
    db, bus,
    eventSubManager: noop, streamElementsManager: noop, chatManager: noop,
    timedNotificationManager: { stopForStreamer() {}, restartForStreamer() {}, restartChatForStreamer() {} },
  });
}

const PAGES = [
  (t) => `/overlay/${t}`,
  (t) => `/overlay/sponsors/${t}`,
  (t) => `/overlay/goal/${t}`,
  (t) => `/overlay/iracing/standings/${t}`,
  (t) => `/overlay/events/${t}`,
  (t) => `/overlay/sponsors/events/${t}`,
  (t) => `/overlay/goal/events/${t}`,
  (t) => `/overlay/sounds/${t}/follow`,
];

describe('overlay links of a disabled account', () => {
  test('an enabled account\'s links serve', async () => {
    const { token } = addStreamer();
    const page = await get(`/overlay/${token}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /window\.OVERLAY_TOKEN/);
    assert.equal((await get(`/overlay/goal/${token}`)).status, 200);
  });

  test('every link answers as an unknown token once the account is disabled', async () => {
    const { id, token } = addStreamer();
    disable(id);
    for (const link of PAGES) {
      const res = await get(link(token));
      assert.equal(res.status, 404, link(token));
      assert.doesNotMatch(res.text, /OVERLAY_TOKEN|"type":"config"/, link(token));
    }
  });

  test('enabling the account brings its links back', async () => {
    const { id, token } = addStreamer();
    disable(id);
    assert.equal((await get(`/overlay/${token}`)).status, 404);
    db.enableStreamer(id);
    assert.equal((await get(`/overlay/${token}`)).status, 200);
  });
});

describe('a stream that is already open when the account is disabled', () => {
  const STREAMS = [
    ['alerts', (t) => `/overlay/events/${t}`, (id) => `overlay:${id}`],
    ['sponsors', (t) => `/overlay/sponsors/events/${t}`, (id) => `overlay:${id}`],
    ['tip goal', (t) => `/overlay/goal/events/${t}`, (id) => `tipgoal:${id}`],
  ];

  for (const [name, link, channel] of STREAMS) {
    test(`the ${name} stream is ended, stops receiving events, and cannot be reopened`, async () => {
      const { id, token } = addStreamer();
      const stream = await openStream(link(token));
      assert.equal(stream.status, 200);
      assert.match(stream.chunks[0], /^data: /);

      // The sponsor stream only forwards sponsor events.
      const probe = name === 'sponsors' ? { type: 'sponsor', n: 1 } : { type: 'probe', n: 1 };
      bus.emit(channel(id), probe);
      await until(() => stream.chunks.join('').includes(`"type":"${probe.type}"`), 'the open stream gets events before the account is disabled');

      disable(id);
      await until(() => stream.ended, 'the stream was not ended');

      const received = stream.chunks.length;
      bus.emit(channel(id), { ...probe, n: 2 });
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(stream.chunks.length, received, 'nothing arrives after the account is disabled');
      assert.equal((await get(link(token))).status, 404);
    });
  }

  test('disabling one account leaves other accounts\' streams open', async () => {
    const target = addStreamer();
    const bystander = addStreamer();
    const stream = await openStream(`/overlay/events/${bystander.token}`);

    disable(target.id);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(stream.ended, false);

    bus.emit(`overlay:${bystander.id}`, { type: 'probe', n: 3 });
    await until(() => stream.chunks.join('').includes('"probe"'), 'the other stream still receives events');
  });

  test('a stream that closed on its own leaves no listener behind', async () => {
    const { id, token } = addStreamer();
    const stream = await openStream(`/overlay/events/${token}`);
    assert.equal(bus.listenerCount(`overlay-disabled:${id}`), 1);
    assert.equal(bus.listenerCount(`overlay:${id}`), 1);
    stream.request.destroy();
    await until(() => bus.listenerCount(`overlay-disabled:${id}`) === 0, 'the listener was not removed when the viewer left');
    assert.equal(bus.listenerCount(`overlay:${id}`), 0);
  });
});

// ── What a newly opened overlay is told (M6) ─────────────────────────────

describe('the config an overlay receives when it connects', () => {
  const UPDATE_COLUMNS = (id, columns) => {
    const names = Object.keys(columns);
    db.db.prepare(`UPDATE streamers SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`).run(...names.map((n) => columns[n]), id);
  };
  // The first message of the alerts stream is the config event.
  const firstEvent = async (token) => {
    const stream = await openStream(`/overlay/events/${token}`);
    return JSON.parse(stream.chunks[0].replace(/^data: /, ''));
  };

  test('has an entry for every alert, raid and YouTube included', async () => {
    const { token } = addStreamer();
    const event = await firstEvent(token);
    assert.equal(event.type, 'config');
    for (const type of ['follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner', 'yt_superchat', 'yt_member', 'yt_giftmember']) {
      assert.equal(typeof event.config[type].enabled, 'boolean', type);
      assert.equal(typeof event.config[type].duration, 'number', type);
    }
    assert.equal(typeof event.serverVersion, 'string');
  });

  test('carries what the streamer saved: volume 0, a switched-off raid, the giveaway duration in seconds', async () => {
    const { id, token } = addStreamer();
    UPDATE_COLUMNS(id, {
      overlay_volume: 0, overlay_raid_enabled: 0, overlay_raid_duration: 12, overlay_giveaway_duration: 20,
      yt_overlay_superchat_enabled: 0, yt_overlay_member_duration: 9,
    });
    const { config } = await firstEvent(token);
    assert.equal(config.volume, 0, 'a silent overlay stays silent');
    assert.deepEqual(config.raid, { enabled: false, duration: 12 });
    assert.deepEqual(config.giveaway_winner, { enabled: true, duration: 20 });
    assert.equal(config.yt_superchat.enabled, false);
    assert.equal(config.yt_member.duration, 9);
  });

  test('is the same config the dashboard pushes after a save', async () => {
    const { buildOverlayConfig } = require('../services/overlayConfig');
    const { id, token } = addStreamer();
    UPDATE_COLUMNS(id, { overlay_volume: 0.35, overlay_follow_duration: 11 });
    const { config } = await firstEvent(token);
    assert.deepEqual(config, buildOverlayConfig(db.getStreamerById(id)));
  });

  test('the diagnostic endpoint that listed the streamer id and the sponsor names is gone', async () => {
    const { id, token } = addStreamer();
    db.db.prepare('INSERT INTO sponsor_images (streamer_id, filename, display_name, enabled) VALUES (?, ?, ?, 1)').run(id, 'a.png', 'Secret Sponsor Name');
    for (const link of [`/overlay/debug/${token}`, `/overlay/debug/${encodeURIComponent('x')}`]) {
      const res = await get(link);
      assert.equal(res.status, 404, link);
      assert.doesNotMatch(res.text, /Secret Sponsor Name|streamerId/, link);
    }
  });
});
