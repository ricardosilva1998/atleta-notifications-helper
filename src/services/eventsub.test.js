'use strict';

// EventSub with fake sockets, a fake Helix and a mocked clock: nothing connects
// to Twitch. A streamer must only ever have one live session (otherwise every
// alert, thank-you and redemption happens twice), each notification is acted on
// once, and none is lost when Twitch moves the session or a socket never gets its
// welcome. All ids and names are synthetic.

const { test, describe, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
const SUBSCRIPTION_TYPES = [
  'channel.follow', 'channel.subscribe', 'channel.subscription.gift', 'channel.subscription.message',
  'channel.cheer', 'channel.raid', 'channel.channel_points_custom_reward_redemption.add',
];

// ── Fakes ────────────────────────────────────────────────────────────────

const sockets = []; // every socket the code opened, in order

class FakeWebSocket {
  constructor(url, opts) {
    this.url = url;
    this.opts = opts;
    this.handlers = {};
    this.closedWith = undefined; // the code given to close(), or 'terminated'
    this.closeCalls = 0; // how many times the client closed or terminated it
    sockets.push(this);
  }
  on(event, fn) { (this.handlers[event] = this.handlers[event] || []).push(fn); return this; }
  emit(event, ...args) { for (const fn of this.handlers[event] || []) fn(...args); }
  close(code) { this.closeCalls += 1; if (this.closedWith === undefined) this.closedWith = code; }
  terminate() { this.closeCalls += 1; if (this.closedWith === undefined) this.closedWith = 'terminated'; }
  // What Twitch does on this socket.
  receive(message) { this.emit('message', Buffer.from(JSON.stringify(message))); }
  closeFromTwitch(code) { this.emit('close', code); }
}

let streamers;
const effects = { overlay: [], overlayLog: [], chat: [], raidProtection: [], redemptions: [] };
let subscribeCalls;

const dbStub = {
  getStreamerById: (id) => streamers[id] || null,
  getOverlayEnabledStreamers: () => Object.values(streamers),
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
    subscribeCalls.push({ url, body: JSON.parse(opts.body), signal: opts.signal, auth: opts.headers && opts.headers.Authorization });
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

  test('moves the session to the reconnect URL after its welcome, without subscribing again; the old socket keeps delivering what it was sent before the move until Twitch closes it', async () => {
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
    assert.equal(first.closedWith, undefined, 'the old socket may still deliver what it was sent before the switch');

    // A notification still in flight on the old socket counts; the new socket is the session.
    first.receive(follow('InFlightOnTheOldSocket'));
    second.receive(follow('FromTheNewSocket'));
    assert.deepEqual(followAlerts(), ['BeforeTheSwitch', 'InFlightOnTheOldSocket', 'FromTheNewSocket']);

    // Twitch closing the old socket does not start another session, and nothing it sends later counts.
    first.closeFromTwitch(4004);
    first.receive(follow('AfterItClosed'));
    mock.timers.tick(5000);
    assert.equal(sockets.length, 2);
    assert.deepEqual(followAlerts(), ['BeforeTheSwitch', 'InFlightOnTheOldSocket', 'FromTheNewSocket']);
  });

  test('an old socket Twitch never closes still counts for 30 s after the move, then the client closes it', async () => {
    const first = await connected();
    first.receive(reconnect('session-1', RECONNECT_URL));
    const second = sockets[1];
    second.receive(welcome('session-1'));
    await flush();

    mock.timers.tick(10_000);
    second.receive(keepalive()); // the live session keeps talking; the old socket may go quiet
    mock.timers.tick(10_000);
    second.receive(keepalive());
    mock.timers.tick(9_999);
    first.receive(follow('InTime'));
    assert.equal(first.closedWith, undefined, 'still draining 29.999 s after the move');
    assert.deepEqual(followAlerts(), ['InTime']);

    mock.timers.tick(1);
    assert.equal(first.closedWith, 1000, 'closed politely once the window is over');
    first.receive(follow('TooLate'));
    assert.deepEqual(followAlerts(), ['InTime']);
    assert.equal(second.closedWith, undefined, 'the live session is untouched');
    assert.equal(sockets.length, 2);
  });

  test('the old socket delivers notifications only: what else it sends neither keeps the session alive nor starts anything', async () => {
    const first = await connected();
    first.receive(reconnect('session-1', RECONNECT_URL));
    const second = sockets[1];
    second.receive(welcome('session-1'));
    await flush();

    mock.timers.tick(10_000);
    first.receive(keepalive());
    first.receive(welcome('session-9'));
    first.receive(reconnect('session-9', 'wss://eventsub.wss.twitch.tv/ws?challenge=from-the-old-socket'));
    await flush();
    assert.equal(sockets.length, 2, 'no reconnect socket is opened for the old socket');
    assert.equal(subscribeCalls.length, 7, 'and nothing is subscribed again');

    // The new socket has been silent for 15 s: the session is lost, whatever the old socket says.
    mock.timers.tick(5_000);
    assert.equal(second.closedWith, 'terminated');
    assert.equal(first.closedWith, 'terminated', 'the draining socket goes with the lost session');
  });

  test('a second move within the window closes the first old socket at once; the latest one drains', async () => {
    const first = await connected();
    first.receive(reconnect('session-1', RECONNECT_URL));
    const second = sockets[1];
    second.receive(welcome('session-1'));
    await flush();
    second.receive(reconnect('session-1', `${RECONNECT_URL}-again`));
    const third = sockets[2];
    third.receive(welcome('session-1'));
    await flush();

    assert.equal(first.closedWith, 1000);
    assert.equal(second.closedWith, undefined);
    first.receive(follow('FromTheFirst'));
    second.receive(follow('FromTheSecond'));
    third.receive(follow('FromTheThird'));
    assert.deepEqual(followAlerts(), ['FromTheSecond', 'FromTheThird']);
    assert.equal(subscribeCalls.length, 7);

    // Only the latest old socket is on the clock: the first one's window ended with its closing.
    for (let i = 0; i < 3; i++) {
      mock.timers.tick(10_000);
      third.receive(keepalive()); // the live session keeps talking
    }
    assert.equal(first.closeCalls, 1);
    assert.equal(second.closeCalls, 1);
    assert.equal(third.closeCalls, 0);
  });

  test('the timer that ends the window is cleared when the old socket closes first, and never keeps the process alive', async () => {
    const unreffed = [];
    const mocked = global.setTimeout;
    global.setTimeout = (fn, ms, ...args) => {
      const timer = mocked(fn, ms, ...args);
      const unref = timer.unref.bind(timer);
      timer.unref = () => { unreffed.push(ms); return unref(); };
      return timer;
    };
    try {
      const first = await connected();
      first.receive(reconnect('session-1', RECONNECT_URL));
      sockets[1].receive(welcome('session-1'));
      await flush();
      assert.deepEqual(unreffed, [30_000]);

      first.closeFromTwitch(4004);
      mock.timers.tick(30_000);
      assert.equal(first.closeCalls, 0, 'Twitch closed it: the client has nothing left to close');
    } finally {
      global.setTimeout = mocked;
    }
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

  test('a reconnect that names the session differently while the subscriptions are being made: the rest go to the id it has now', async () => {
    const gate = holdHelixAfter(3);
    eventSubManager.startForStreamer(1);
    const first = sockets[0];
    first.receive(welcome('session-1'));
    await flush();
    assert.equal(subscribeCalls.length, 3, 'Helix is answering slowly');

    first.receive(reconnect('session-1', RECONNECT_URL));
    sockets[1].receive(welcome('session-2'));
    gate.open();
    await flush();
    assert.deepEqual(subscribeCalls.map((c) => c.body.type), SUBSCRIPTION_TYPES, 'every event type is subscribed once, in order');
    // The request on its way when the session moved still names the old id; the rest name the new one.
    assert.deepEqual(subscribeCalls.map((c) => c.body.transport.session_id), [...Array(4).fill('session-1'), ...Array(3).fill('session-2')]);
    assert.equal(sockets.length, 2, 'and no new session was started');
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

// ── Subscribe requests ───────────────────────────────────────────────────

describe('the subscribe requests to Twitch', () => {
  test('each one has a timeout, so a Twitch that never answers cannot hold the subscribe loop', async () => {
    await connected();
    assert.equal(subscribeCalls.length, 7);
    for (const call of subscribeCalls) {
      assert.ok(call.signal instanceof AbortSignal, call.body.type);
      assert.equal(call.signal.aborted, false);
    }
  });

  test('one that times out leaves only its own event type unsubscribed; the rest are still made', async () => {
    const answer = global.fetch;
    let requests = 0;
    global.fetch = async (url, opts) => {
      requests += 1;
      if (requests === 3) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      return answer(url, opts);
    };
    const logged = [];
    console.error = (...args) => logged.push(args.join(' '));

    await connected();

    assert.equal(requests, 7, 'every event type was tried');
    assert.equal(subscribeCalls.length, 6, 'all but the one that timed out were subscribed');
    assert.equal(logged.filter((line) => /Subscribe request for channel\.subscription\.gift failed for streamer 1/.test(line)).length, 1, logged.join('\n'));
    assert.ok(!logged.some((line) => /Could not handle a message/.test(line)), 'the failure did not escape the subscribe loop');
  });

  test('after a 401 the retry with a refreshed token has a timeout too', async () => {
    const answer = global.fetch;
    let requests = 0;
    global.fetch = async (url, opts) => {
      requests += 1;
      if (requests === 1) {
        subscribeCalls.push({ url, body: JSON.parse(opts.body), signal: opts.signal, auth: opts.headers.Authorization });
        return { ok: false, status: 401, json: async () => ({ message: 'Invalid OAuth token' }) };
      }
      return answer(url, opts);
    };

    await connected();

    assert.equal(subscribeCalls.length, 8, 'the first type was asked twice');
    const [stale, retry] = subscribeCalls;
    assert.equal(stale.auth, 'Bearer synthetic-token');
    assert.equal(retry.auth, 'Bearer synthetic-fresh-token');
    assert.ok(retry.signal instanceof AbortSignal);
    assert.equal(retry.signal.aborted, false);
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

  test('a socket that opens but never gets its welcome is replaced', async () => {
    eventSubManager.startForStreamer(1);
    const first = sockets[0];
    assert.equal(first.opts && first.opts.handshakeTimeout, 10_000, 'an upgrade Twitch never answers times out');
    first.emit('open');
    mock.timers.tick(14_999);
    assert.equal(sockets.length, 1);
    mock.timers.tick(1);
    assert.equal(first.closedWith, 'terminated');
    mock.timers.tick(1000);
    assert.equal(sockets.length, 2, 'a new session is started');
    assert.equal(sockets[1].url, EVENTSUB_URL);
    assert.equal(sockets[1].opts.handshakeTimeout, 10_000);

    first.receive(welcome('session-from-the-dead-socket'));
    await flush();
    assert.equal(subscribeCalls.length, 0, 'the replaced socket can no longer start a session');
  });

  test('a socket that never even opens is replaced too (no welcome can come)', async () => {
    eventSubManager.startForStreamer(1);
    const first = sockets[0];
    mock.timers.tick(14_999);
    assert.equal(sockets.length, 1);
    mock.timers.tick(1);
    assert.equal(first.closedWith, 'terminated');
    mock.timers.tick(1000);
    assert.equal(sockets.length, 2);
  });

  test('a connection attempt that fails is retried with the usual delay, and its welcome timer is gone', async () => {
    eventSubManager.startForStreamer(1);
    const first = sockets[0];
    first.emit('error', new Error('connect ECONNREFUSED'));
    first.closeFromTwitch(1006);
    mock.timers.tick(999);
    assert.equal(sockets.length, 1);
    mock.timers.tick(1);
    assert.equal(sockets.length, 2);
    mock.timers.tick(14_000);
    assert.equal(first.closeCalls, 1, 'the dead attempt is not cut a second time by its old timer');
  });

  test('sockets that keep getting no welcome are replaced with the usual growing delay, not in a tight loop', async () => {
    eventSubManager.startForStreamer(1);
    mock.timers.tick(15_000); // the first is cut
    mock.timers.tick(999);
    assert.equal(sockets.length, 1);
    mock.timers.tick(1);
    assert.equal(sockets.length, 2);
    mock.timers.tick(15_000); // the second is cut
    mock.timers.tick(1_999);
    assert.equal(sockets.length, 2, 'the second delay is 2 s');
    mock.timers.tick(1);
    assert.equal(sockets.length, 3);
  });

  test('the welcome replaces that first timer with the session\'s own keepalive', async () => {
    eventSubManager.startForStreamer(1);
    const first = sockets[0];
    first.emit('open');
    mock.timers.tick(10_000);
    first.receive(welcome('session-1', 30)); // a session that may stay silent for 30 s (plus the grace)
    await flush();
    mock.timers.tick(34_999);
    assert.equal(first.closedWith, undefined);
    mock.timers.tick(1);
    assert.equal(first.closedWith, 'terminated');
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

  test('stopping while the old socket of a move still drains closes it with the others, once, and nothing it delivers counts', async () => {
    const first = await connected();
    first.receive(reconnect('session-1', 'wss://eventsub.wss.twitch.tv/ws?challenge=synthetic'));
    const second = sockets[1];
    second.receive(welcome('session-1'));
    await flush();
    first.receive(follow('WhileDraining'));
    eventSubManager.stopForStreamer(1);
    assert.equal(first.closedWith, 1000);
    assert.equal(second.closedWith, 1000);

    first.receive(follow('AfterStop'));
    second.receive(follow('AfterStop'));
    mock.timers.tick(120_000);
    assert.deepEqual(followAlerts(), ['WhileDraining']);
    assert.equal(first.closeCalls, 1, 'the end-of-window timer does not close it again');
    assert.equal(second.closeCalls, 1);
    assert.equal(sockets.length, 2);
  });
});

// ── The boot ─────────────────────────────────────────────────────────────

describe('starting every streamer at boot', () => {
  const logged = [];
  beforeEach(() => {
    logged.length = 0;
    console.log = (...args) => logged.push(args.join(' '));
  });

  test('the log counts the streamers that got a connection, not the ones that were skipped', () => {
    streamers = {
      1: { ...streamers[1] },
      2: { ...streamers[1], id: 2, twitch_user_id: null }, // a broadcaster token but no linked Twitch account
      3: { ...streamers[1], id: 3, broadcaster_access_token: null },
      4: { ...streamers[1], id: 4, enabled: 0 }, // disabled since the list was read
    };
    eventSubManager.startAll();
    assert.equal(sockets.length, 1);
    assert.ok(logged.includes('[EventSub] Started 1 connections (3 skipped: not set up for EventSub)'), logged.join('\n'));
  });

  test('without skipped streamers the line is the plain count', () => {
    streamers[2] = { ...streamers[1], id: 2 };
    eventSubManager.startAll();
    assert.equal(sockets.length, 2);
    assert.ok(logged.includes('[EventSub] Started 2 connections'), logged.join('\n'));
  });

  test('startForStreamer says whether the streamer got a connection', () => {
    streamers[2] = { ...streamers[1], id: 2, twitch_user_id: null };
    assert.equal(eventSubManager.startForStreamer(1), true);
    assert.equal(eventSubManager.startForStreamer(2), false);
    assert.equal(eventSubManager.startForStreamer(99), false, 'a streamer that does not exist');
    assert.equal(sockets.length, 1);
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

describe('gift subs', () => {
  // Twitch sends one channel.subscription.gift for the gift and, besides it, one
  // channel.subscribe (is_gift: true) for every viewer who received a sub.
  const gift = (total) => notification('channel.subscription.gift', {
    user_name: 'Gifter', total, tier: '1000', is_anonymous: false, cumulative_total: 12,
  });
  const giftedSub = (username) => notification('channel.subscribe', { user_name: username, tier: '1000', is_gift: true });

  test('a gift of 3 subs is one alert, one stats row and one thank-you, not one per recipient', async () => {
    const socket = await connected();
    socket.receive(gift(3));
    for (const name of ['RecipientA', 'RecipientB', 'RecipientC']) socket.receive(giftedSub(name));

    assert.equal(effects.overlay.length, 1);
    const [alert] = effects.overlay;
    assert.equal(alert.event.type, 'subscription', 'a gift shows as the subscription card');
    assert.equal(alert.event.isGift, true);
    assert.equal(alert.event.data.username, 'Gifter');
    assert.equal(alert.event.data.amount, 3);
    assert.deepEqual(effects.overlayLog.map((e) => e.type), ['giftsub']);
    assert.deepEqual(effects.chat.map((c) => c.type), ['giftsub']);
  });

  test('a sub that is not a gift is still an alert and a thank-you', async () => {
    const socket = await connected();
    socket.receive(notification('channel.subscribe', { user_name: 'NewSub', tier: '2000', is_gift: false }));
    assert.equal(effects.overlay.length, 1);
    assert.equal(effects.overlay[0].event.type, 'subscription');
    assert.equal(effects.overlay[0].event.isGift, false);
    assert.equal(effects.overlay[0].event.data.username, 'NewSub');
    assert.equal(effects.overlay[0].event.data.tier, '2');
    assert.deepEqual(effects.chat.map((c) => c.type), ['subscription']);
  });

  test('a resub with a message is still an alert, even right after a gift', async () => {
    const socket = await connected();
    socket.receive(gift(5));
    socket.receive(notification('channel.subscription.message', {
      user_name: 'Loyal', tier: '1000', cumulative_months: 14, message: { text: 'synthetic resub message' },
    }));
    assert.deepEqual(effects.overlay.map((e) => e.event.data.username), ['Gifter', 'Loyal']);
    assert.deepEqual(effects.chat.map((c) => c.type), ['giftsub', 'subscription']);
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
