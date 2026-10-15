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
  (t) => `/overlay/poll/${t}`,
  (t) => `/overlay/poll/events/${t}`,
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
    ['poll bar', (t) => `/overlay/poll/events/${t}`, (id) => `poll:${id}`],
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

// ── The overlay switch, and whether the overlay is open in OBS ───────────

describe('the overlay switch (overlay_enabled) decides whether alerts reach the alert overlay', () => {
  const ALERTS = ['follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner', 'yt_superchat', 'yt_member', 'yt_giftmember'];
  const OTHERS = ['sponsor', 'redemption', 'config-update', 'clear'];
  const setOverlay = (id, on) => db.db.prepare('UPDATE streamers SET overlay_enabled = ? WHERE id = ?').run(on ? 1 : 0, id);

  test('off: no alert reaches the stream; sponsor images, redemption clips, config updates and clears still do', async () => {
    const { id, token } = addStreamer();
    setOverlay(id, 0);
    const stream = await openStream(`/overlay/events/${token}?source=alerts`);
    for (const type of ALERTS) bus.emit(`overlay:${id}`, { type, data: { username: 'synthetic' } });
    for (const type of OTHERS) bus.emit(`overlay:${id}`, { type });
    await until(() => stream.chunks.join('').includes('"type":"clear"'), 'the clear arrived');
    const text = stream.chunks.join('');
    for (const type of OTHERS) assert.ok(text.includes(`"type":"${type}"`), type);
    for (const type of ALERTS) assert.ok(!text.includes(`"type":"${type}"`), type);
  });

  test('switched on, the next alert gets through at once, with no reconnect', async () => {
    const { id, token } = addStreamer();
    setOverlay(id, 0);
    const stream = await openStream(`/overlay/events/${token}?source=alerts`);
    bus.emit(`overlay:${id}`, { type: 'follow', data: { username: 'beforeSwitch' } });
    setOverlay(id, 1);
    bus.emit(`overlay:${id}`, { type: 'follow', data: { username: 'afterSwitch' } });
    await until(() => stream.chunks.join('').includes('afterSwitch'), 'the alert after the switch arrived');
    assert.ok(!stream.chunks.join('').includes('beforeSwitch'));
  });

  // The bus calls the stream's listener inside the sender's emit (eventsub.js logs the event, thanks and starts raid
  // protection after it): a switch that cannot be read must not throw back into the sender.
  test('a switch that cannot be read drops that alert and throws nothing back to whoever sent it', async () => {
    const { id, token } = addStreamer();
    setOverlay(id, 1);
    const stream = await openStream(`/overlay/events/${token}?source=alerts`);
    const isOverlayEnabled = db.isOverlayEnabled;
    db.isOverlayEnabled = () => { throw new Error('synthetic database failure'); };
    try {
      assert.doesNotThrow(() => bus.emit(`overlay:${id}`, { type: 'follow', data: { username: 'whileUnreadable' } }));
    } finally {
      db.isOverlayEnabled = isOverlayEnabled;
    }
    bus.emit(`overlay:${id}`, { type: 'follow', data: { username: 'onceReadable' } });
    await until(() => stream.chunks.join('').includes('onceReadable'), 'the next alert arrived');
    assert.ok(!stream.chunks.join('').includes('whileUnreadable'));
  });
});

describe('whether the alert overlay is open in OBS', () => {
  const presence = require('../services/overlayPresence');

  test('counts the streams the alert overlay opens (?source=alerts), not the chat overlay\'s', async () => {
    const { id, token } = addStreamer();
    assert.equal(presence.isOpen(id), false);
    const chat = await openStream(`/overlay/events/${token}`);
    assert.equal(presence.isOpen(id), false, 'the iRacing chat overlay reads the same stream without the marker');
    const alerts = await openStream(`/overlay/events/${token}?source=alerts`);
    assert.equal(presence.isOpen(id), true);
    alerts.request.destroy();
    await until(() => !presence.isOpen(id), 'closing the alert overlay counts it out');
    chat.request.destroy();
  });

  test('a stream the server ends (the account is disabled, the link regenerated) is counted out too', async () => {
    const { id, token } = addStreamer();
    const alerts = await openStream(`/overlay/events/${token}?source=alerts`);
    assert.equal(presence.isOpen(id), true);
    disable(id);
    await until(() => alerts.ended, 'the stream was ended');
    await until(() => !presence.isOpen(id), 'a stream the server ended no longer counts as open');
  });
});

describe('the Polls & predictions bar', () => {
  const { t } = require('../i18n');

  test('its page has its texts in the language its link names, English otherwise', async () => {
    const { token } = addStreamer();
    const pt = await get(`/overlay/poll/${token}?lang=pt`);
    assert.equal(pt.status, 200);
    assert.match(pt.text, /<html lang="pt">/);
    assert.ok(pt.text.includes(`"locked":${JSON.stringify(t('pt', 'pollbar.locked'))}`));
    const fields = { count: '{{count}}', points: '{{points}}', viewers: '{{viewers}}' };
    assert.ok(pt.text.includes(`"winners":${JSON.stringify(t('pt', 'pollbar.winners', fields))}`), 'the numbers are filled in by the bar');
    assert.ok(t('pt', 'pollbar.winners', fields).includes('{{viewers}}'));
    assert.match(pt.text, /\/overlay\/pollModel\.js/);
    for (const lang of ['xx', '']) assert.match((await get(`/overlay/poll/${token}?lang=${lang}`)).text, /<html lang="en">/);
  });

  test('its page prints the token into its script with < escaped, like every script embed', async () => {
    const { id } = addStreamer();
    const token = `tok-</script>-${id}`;
    db.db.prepare('UPDATE streamers SET overlay_token = ? WHERE id = ?').run(token, id);
    const page = await get(`/overlay/poll/${encodeURIComponent(token)}`);
    assert.equal(page.status, 200);
    assert.ok(page.text.includes(`window.OVERLAY_TOKEN = "tok-\\u003c/script>-${id}";`));
    assert.ok(!page.text.includes(token), 'the stored token never ends the script');
  });

  test('its stream sends what runs when it opens, then every change on its own channel, and nothing of the alerts', async () => {
    const { id, token } = addStreamer();
    const stream = await openStream(`/overlay/poll/events/${token}`);
    assert.match(stream.chunks[0], /"type":"config"/);
    await until(() => stream.chunks.join('').includes('"type":"poll-state"'), 'the bar is told what runs when it opens');
    bus.emit(`overlay:${id}`, { type: 'follow', data: { username: 'Viewer' } });
    bus.emit(`poll:${id}`, { type: 'poll-state', poll: { id: 'poll-1' }, prediction: null, serverNow: 1 });
    await until(() => stream.chunks.join('').includes('"poll-1"'), 'a change on poll:<id> reaches the bar');
    assert.ok(!stream.chunks.join('').includes('"follow"'), 'an alert is not the bar\'s');
  });
});

// EventSub can lose an end, lock or result event; the bar must not stay on a finished poll at 0:00 or a prediction
// locked for good. The clock is mocked (setInterval and Date); livePolls' live() and barState() are replaced on the
// singleton the route reads on every turn of its timer.
describe('an open Polls & predictions bar asks Twitch again while what it shows may be stale', () => {
  const { livePolls } = require('../services/livePolls');
  const NOW = Date.parse('2026-10-15T20:00:00Z');
  const view = (kind, state, endsAt) => ({ kind, id: `${kind}-1`, title: 'Synthetic', state, endsAt, endedAt: state === 'ended' ? NOW : null });

  // Opens a bar whose barState() answers `bar.state`; live() records the streamer it is asked about and refuses as it
  // does for a streamer without the permissions (the route must catch it, as it does for the read when the bar opens).
  async function openBar(t, state) {
    t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: NOW });
    const real = { live: livePolls.live, barState: livePolls.barState };
    t.after(() => Object.assign(livePolls, real));
    const bar = { state, calls: [] };
    livePolls.live = (streamerId) => {
      bar.calls.push(streamerId);
      return Promise.reject(Object.assign(new Error('needs_reconnect'), { code: 'needs_reconnect' }));
    };
    livePolls.barState = () => ({ ...bar.state, serverNow: Date.now() });
    const { id, token } = addStreamer();
    bar.id = id;
    bar.stream = await openStream(`/overlay/poll/events/${token}`);
    return bar;
  }
  // Moves the clock 5 seconds at a time, so each turn of the bar's timer sees its own time.
  const advance = (t, ms) => { for (let done = 0; done < ms; done += 5000) t.mock.timers.tick(5000); };
  // OBS disconnects; the server has run its close handler once the bar's bus listener is gone.
  async function disconnect(bar) {
    bar.stream.request.destroy();
    await until(() => bus.listenerCount(`poll:${bar.id}`) === 0, 'the bar\'s bus listener was not removed when OBS disconnected');
  }

  test('every 5 seconds while a running poll or prediction is past its end, and not before its end', async (t) => {
    const bar = await openBar(t, { poll: view('poll', 'running', NOW + 15000), prediction: null });
    assert.deepEqual(bar.calls, [bar.id], 'the read when the bar opens');
    advance(t, 10000);
    assert.equal(bar.calls.length, 1, 'a running poll before its end');
    advance(t, 5000);
    assert.equal(bar.calls.length, 2, 'at its end');
    advance(t, 5000);
    assert.equal(bar.calls.length, 3, 'and every 5 seconds after it');
    bar.state = { poll: view('poll', 'ended', null), prediction: null };
    advance(t, 15000);
    assert.equal(bar.calls.length, 3, 'once a read has found the end');
    bar.state = { poll: null, prediction: view('prediction', 'running', NOW) };
    advance(t, 5000);
    assert.equal(bar.calls.length, 4, 'a running prediction past its end too');
    assert.ok(bar.calls.every((streamerId) => streamerId === bar.id), 'the bar asks about its own streamer');
    await disconnect(bar);
  });

  test('at most once a minute while a prediction stays locked', async (t) => {
    const bar = await openBar(t, { poll: null, prediction: view('prediction', 'locked', null) });
    assert.equal(bar.calls.length, 1, 'the read when the bar opens');
    advance(t, 55000);
    assert.equal(bar.calls.length, 1, 'not within a minute of the last read');
    advance(t, 5000);
    assert.equal(bar.calls.length, 2, 'a minute after it');
    advance(t, 55000);
    assert.equal(bar.calls.length, 2);
    advance(t, 5000);
    assert.equal(bar.calls.length, 3);
    await disconnect(bar);
  });

  test('a bar that OBS closes leaves no bus listener and no timer behind', async (t) => {
    const bar = await openBar(t, { poll: view('poll', 'running', NOW), prediction: null });
    assert.equal(bus.listenerCount(`poll:${bar.id}`), 1);
    assert.equal(bus.listenerCount(`overlay-disabled:${bar.id}`), 1);
    advance(t, 5000);
    assert.equal(bar.calls.length, 2, 'the timer asks while the bar is open');
    await disconnect(bar);
    assert.equal(bus.listenerCount(`overlay-disabled:${bar.id}`), 0);
    advance(t, 60000);
    assert.equal(bar.calls.length, 2, 'no read is asked for once OBS has disconnected');
  });
});
