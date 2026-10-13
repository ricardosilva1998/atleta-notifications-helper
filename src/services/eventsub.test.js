'use strict';

// EventSub with fake sockets, a fake Helix and a mocked clock: nothing connects
// to Twitch. A streamer must only ever have one live session (otherwise every
// alert, thank-you and redemption happens twice), and each notification is
// acted on once. All ids and names are synthetic.

const { test, describe, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';

// ── Fakes ────────────────────────────────────────────────────────────────

const sockets = []; // every socket the code opened, in order

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.handlers = {};
    this.closedWith = undefined; // the code given to close(), or 'terminated'
    sockets.push(this);
  }
  on(event, fn) { (this.handlers[event] = this.handlers[event] || []).push(fn); return this; }
  emit(event, ...args) { for (const fn of this.handlers[event] || []) fn(...args); }
  close(code) { if (this.closedWith === undefined) this.closedWith = code; }
  terminate() { if (this.closedWith === undefined) this.closedWith = 'terminated'; }
  // What Twitch does on this socket.
  receive(message) { this.emit('message', Buffer.from(JSON.stringify(message))); }
  closeFromTwitch(code) { this.emit('close', code); }
}

let streamers;
const effects = { overlay: [], overlayLog: [], chat: [], raidProtection: [], redemptions: [] };
let subscribeCalls;

const dbStub = {
  getStreamerById: (id) => streamers[id] || null,
  logOverlayEvent: (streamerId, type, username) => effects.overlayLog.push({ streamerId, type, username }),
  clearStreamerBroadcasterScopes: () => {},
};

const stubs = {
  ws: FakeWebSocket,
  '../config': { twitch: { clientId: 'synthetic-client-id' } },
  '../db': dbStub,
  './overlayBus': { emit: (channel, event) => effects.overlay.push({ channel, event }) },
  './twitch': { refreshBroadcasterToken: async () => 'synthetic-fresh-token', hasRedemptionScope: () => true },
  './twitchChat': {
    chatManager: {
      sendEventMessage: (streamerId, type, data) => effects.chat.push({ streamerId, type, data }),
      startRaidProtection: (streamerId) => effects.raidProtection.push(streamerId),
    },
  },
  './redemptionDispatcher': { handleRedemption: async (streamerId, data) => { effects.redemptions.push({ streamerId, data }); } },
};

let eventSubManager;
let NOTIFICATION_DEDUPE_TTL_MS;
const saved = {};

// The stubs stay in place for the whole file: eventsub.js loads the redemption
// flow only when a redemption arrives, and the real one would load the app's
// config (which exits without its environment variables).
before(() => {
  saved.load = Module._load;
  Module._load = function (request, parent, isMain) {
    const from = parent && parent.filename;
    if (from && from.endsWith(`${path.sep}eventsub.js`) && Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return saved.load.call(this, request, parent, isMain);
  };
  ({ eventSubManager, NOTIFICATION_DEDUPE_TTL_MS } = require('./eventsub'));
});

beforeEach(() => {
  for (const level of ['log', 'warn', 'error']) { saved[level] = console[level]; console[level] = () => {}; }
  saved.fetch = global.fetch;
  subscribeCalls = [];
  global.fetch = async (url, opts) => {
    subscribeCalls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, status: 202, json: async () => ({}) };
  };
  sockets.length = 0;
  for (const list of Object.values(effects)) list.length = 0;
  streamers = {
    1: {
      id: 1, enabled: 1, twitch_user_id: '9001', twitch_display_name: 'Streamer One', broadcaster_access_token: 'synthetic-token',
      overlay_follow_enabled: 1, overlay_sub_enabled: 1, overlay_bits_enabled: 1, overlay_raid_enabled: 1,
    },
  };
  mock.timers.enable({ apis: ['setTimeout'] });
});

afterEach(() => {
  eventSubManager.stopAll();
  mock.timers.reset();
  global.fetch = saved.fetch;
  for (const level of ['log', 'warn', 'error']) console[level] = saved[level];
});

after(() => {
  eventSubManager.stopAll();
  Module._load = saved.load;
});

// ── What Twitch sends ────────────────────────────────────────────────────

let counter = 0;
const nextId = (prefix) => `${prefix}-${++counter}`;

const welcome = (sessionId, keepaliveSeconds = 10) => ({
  metadata: { message_id: nextId('welcome'), message_type: 'session_welcome', message_timestamp: '2026-10-13T12:00:00Z' },
  payload: { session: { id: sessionId, status: 'connected', keepalive_timeout_seconds: keepaliveSeconds, reconnect_url: null } },
});
const keepalive = () => ({ metadata: { message_id: nextId('keepalive'), message_type: 'session_keepalive' }, payload: {} });
const reconnect = (sessionId, url) => ({
  metadata: { message_id: nextId('reconnect'), message_type: 'session_reconnect' },
  payload: { session: { id: sessionId, status: 'reconnecting', keepalive_timeout_seconds: null, reconnect_url: url } },
});
const notification = (subscriptionType, event, messageId = nextId('notification')) => ({
  metadata: { message_id: messageId, message_type: 'notification', subscription_type: subscriptionType },
  payload: { subscription: { type: subscriptionType }, event },
});
const follow = (username, messageId) => notification('channel.follow', { user_name: username }, messageId);

const flush = () => new Promise((resolve) => setImmediate(resolve));
const followAlerts = () => effects.overlay.filter((e) => e.event.type === 'follow').map((e) => e.event.data.username);

// A slow Twitch: Helix answers the first `n` subscribe requests at once and
// holds the rest until open() is called.
function holdHelixAfter(n) {
  let release;
  const opened = new Promise((resolve) => { release = resolve; });
  const answer = global.fetch;
  global.fetch = async (url, opts) => {
    if (subscribeCalls.length >= n) await opened;
    return answer(url, opts);
  };
  return { open: () => release() };
}

// A streamer whose first session is up and subscribed.
async function connected() {
  eventSubManager.startForStreamer(1);
  const socket = sockets[sockets.length - 1];
  socket.receive(welcome('session-1'));
  await flush();
  return socket;
}

// ── A reconnect requested by Twitch ──────────────────────────────────────

describe('a reconnect requested by Twitch (session_reconnect)', () => {
  const RECONNECT_URL = 'wss://eventsub.wss.twitch.tv/ws?challenge=synthetic-reconnect';

  test('moves the session to the reconnect URL after its welcome, without subscribing again, then closes the old socket', async () => {
    const first = await connected();
    assert.equal(first.url, EVENTSUB_URL);
    assert.equal(subscribeCalls.length, 7, 'one subscription per event type');
    assert.ok(subscribeCalls.every((c) => c.body.transport.session_id === 'session-1'));

    first.receive(reconnect('session-1', RECONNECT_URL));
    assert.equal(sockets.length, 2);
    const second = sockets[1];
    assert.equal(second.url, RECONNECT_URL, 'the reconnect URL is used as it is');

    // Until the new socket is welcomed the old one still delivers the events.
    first.receive(follow('BeforeTheSwitch'));
    assert.equal(first.closedWith, undefined, 'the old socket stays open until the welcome');

    second.receive(welcome('session-1'));
    await flush();
    assert.equal(subscribeCalls.length, 7, 'Twitch moved the subscriptions: none are created again');
    assert.equal(first.closedWith, 1000, 'the old socket is closed once the new one is welcomed');

    // From now on only the new socket counts.
    first.receive(follow('FromTheOldSocket'));
    second.receive(follow('FromTheNewSocket'));
    assert.deepEqual(followAlerts(), ['BeforeTheSwitch', 'FromTheNewSocket']);

    // Twitch closing the old socket does not start another session.
    first.closeFromTwitch(4004);
    mock.timers.tick(5000);
    assert.equal(sockets.length, 2);
  });

  test('the same notification on the old and the new socket is acted on once', async () => {
    const first = await connected();
    first.receive(reconnect('session-1', RECONNECT_URL));
    const second = sockets[1];
    first.receive(follow('Twice', 'synthetic-message-1'));
    second.receive(welcome('session-1'));
    await flush();
    second.receive(follow('Twice', 'synthetic-message-1'));
    assert.deepEqual(followAlerts(), ['Twice']);
    assert.equal(effects.chat.length, 1);
  });

  test('a reconnect socket that closes before its welcome changes nothing; losing the session then reconnects from scratch', async () => {
    const first = await connected();
    first.receive(reconnect('session-1', RECONNECT_URL));
    sockets[1].closeFromTwitch(1006);
    mock.timers.tick(5000);
    assert.equal(sockets.length, 2, 'the session is still on the old socket: no new connection');

    first.receive(follow('StillThere'));
    assert.deepEqual(followAlerts(), ['StillThere']);

    // Twitch drops the old socket when the reconnect never happened.
    first.closeFromTwitch(4004);
    mock.timers.tick(1000);
    assert.equal(sockets.length, 3);
    const third = sockets[2];
    assert.equal(third.url, EVENTSUB_URL, 'a new session, not the reconnect URL');
    third.receive(welcome('session-2'));
    await flush();
    assert.equal(subscribeCalls.length, 14, 'a new session starts without subscriptions, so they are created again');
    assert.ok(subscribeCalls.slice(7).every((c) => c.body.transport.session_id === 'session-2'));
  });

  test('a reconnect while the subscriptions are still being made: the rest are still made for the same session', async () => {
    const gate = holdHelixAfter(3);
    eventSubManager.startForStreamer(1);
    const first = sockets[0];
    first.receive(welcome('session-1'));
    await flush();
    assert.equal(subscribeCalls.length, 3, 'Helix is answering slowly');

    first.receive(reconnect('session-1', RECONNECT_URL));
    sockets[1].receive(welcome('session-1'));
    gate.open();
    await flush();
    assert.equal(subscribeCalls.length, 7, 'every event type is subscribed once');
    assert.ok(subscribeCalls.every((c) => c.body.transport.session_id === 'session-1'));
  });

  test('a later message on a reconnect socket that was not welcomed yet is not an event', async () => {
    const first = await connected();
    first.receive(reconnect('session-1', RECONNECT_URL));
    sockets[1].receive(follow('TooEarly'));
    assert.deepEqual(followAlerts(), []);
    first.receive(follow('FromTheSession'));
    assert.deepEqual(followAlerts(), ['FromTheSession']);
  });
});

// ── Connections that end ─────────────────────────────────────────────────

describe('a lost connection', () => {
  test('reconnects from scratch and subscribes again; the old socket no longer counts', async () => {
    const first = await connected();
    first.closeFromTwitch(4000);
    mock.timers.tick(999);
    assert.equal(sockets.length, 1);
    mock.timers.tick(1);
    assert.equal(sockets.length, 2);
    const second = sockets[1];
    assert.equal(second.url, EVENTSUB_URL);

    first.receive(follow('Ghost'));
    second.receive(welcome('session-2'));
    await flush();
    second.receive(follow('Live'));
    assert.deepEqual(followAlerts(), ['Live']);
    assert.equal(subscribeCalls.length, 14);
  });

  test('a session lost while its subscriptions are being made gets no more of them; the new session gets its own', async () => {
    const gate = holdHelixAfter(2);
    eventSubManager.startForStreamer(1);
    const first = sockets[0];
    first.receive(welcome('session-1'));
    await flush();
    assert.equal(subscribeCalls.length, 2);

    first.closeFromTwitch(4000);
    gate.open();
    await flush();
    assert.equal(subscribeCalls.length, 3, 'only the request already on its way');

    mock.timers.tick(1000);
    sockets[1].receive(welcome('session-2'));
    await flush();
    assert.equal(subscribeCalls.filter((c) => c.body.transport.session_id === 'session-2').length, 7);
  });

  test('a silent session (no message for longer than its keepalive) is dropped and replaced by a new one', async () => {
    const first = await connected(); // keepalive 10 s, plus 5 s grace
    mock.timers.tick(10_000);
    first.receive(keepalive()); // any message keeps the session alive
    mock.timers.tick(14_999);
    assert.equal(first.closedWith, undefined);
    assert.equal(sockets.length, 1);

    mock.timers.tick(1);
    assert.equal(first.closedWith, 'terminated', 'a dead connection is cut, not closed politely');
    mock.timers.tick(1000);
    assert.equal(sockets.length, 2);
    const second = sockets[1];
    assert.equal(second.url, EVENTSUB_URL);

    first.receive(follow('LateFromTheDeadSocket'));
    second.receive(welcome('session-2'));
    await flush();
    assert.deepEqual(followAlerts(), []);
    assert.equal(subscribeCalls.length, 14, 'the new session subscribes again');
  });
});

describe('a stopped client', () => {
  test('never reconnects, even when a reconnect was already scheduled (an overlay settings save restarts the client)', async () => {
    const first = await connected();
    first.closeFromTwitch(4000); // a reconnect is now scheduled in 1 s
    eventSubManager.startForStreamer(1); // the settings save: the old client stops, a new one starts
    assert.equal(sockets.length, 2);
    mock.timers.tick(120_000);
    assert.equal(sockets.length, 2, 'the old client did not come back');
  });

  test('stopping during a reconnect closes both sockets, and nothing they deliver counts', async () => {
    const first = await connected();
    first.receive(reconnect('session-1', 'wss://eventsub.wss.twitch.tv/ws?challenge=synthetic'));
    const second = sockets[1];
    eventSubManager.stopForStreamer(1);
    assert.equal(first.closedWith, 1000);
    assert.equal(second.closedWith, 1000);

    second.receive(welcome('session-1'));
    first.receive(follow('AfterStop'));
    second.receive(follow('AfterStop'));
    first.closeFromTwitch(1000);
    second.closeFromTwitch(4004);
    mock.timers.tick(120_000);
    assert.deepEqual(followAlerts(), []);
    assert.equal(sockets.length, 2);
  });
});

// ── Each notification once ───────────────────────────────────────────────

describe('a notification Twitch delivers twice', () => {
  test('is acted on once: one alert, one stats row, one thank-you', async () => {
    const socket = await connected();
    socket.receive(follow('Repeat', 'synthetic-message-7'));
    socket.receive(follow('Repeat', 'synthetic-message-7'));
    assert.deepEqual(followAlerts(), ['Repeat']);
    assert.equal(effects.overlayLog.length, 1);
    assert.equal(effects.chat.length, 1);
  });

  test('a channel point redemption delivered twice reaches the redemption flow once', async () => {
    const socket = await connected();
    const redemption = notification('channel.channel_points_custom_reward_redemption.add', {
      id: 'synthetic-redemption-1', reward: { id: 'synthetic-reward-1', title: 'Air Horn', cost: 500 },
      user_name: 'Viewer', user_id: '55', user_input: '', status: 'unfulfilled', redeemed_at: '2026-10-13T12:00:00Z',
    }, 'synthetic-message-8');
    socket.receive(redemption);
    socket.receive(redemption);
    await flush();
    assert.equal(effects.redemptions.length, 1);
    assert.equal(effects.redemptions[0].data.twitchRedemptionId, 'synthetic-redemption-1');
  });

  test('message ids are remembered for ten minutes', () => {
    assert.equal(NOTIFICATION_DEDUPE_TTL_MS, 10 * 60 * 1000);
  });
});

describe('a raid', () => {
  test('thanks the raider and starts raid protection, once', async () => {
    const socket = await connected();
    const raid = notification('channel.raid', { from_broadcaster_user_name: 'Raider', viewers: 42 }, 'synthetic-message-9');
    socket.receive(raid);
    socket.receive(raid);
    assert.deepEqual(effects.chat.map((c) => c.type), ['raid']);
    assert.deepEqual(effects.raidProtection, [1]);
  });
});
