'use strict';

// The multistream session lifecycle with stubs for the database, Twitch,
// YouTube and the relay, and timers the tests fire by hand. Nothing leaves the
// machine; all ids, keys and titles are synthetic.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMultistreamSessions, STOP_GRACE_MS, RETRY_ATTEMPTS } = require('./multistreamSessions');

const KEY = 'KeyOfStreamerOne000000000000000A';
const KEY_TWO = 'KeyOfStreamerTwo000000000000000B';

// ── Stubs ────────────────────────────────────────────────────────────────

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle() { for (let i = 0; i < 20; i++) await tick(); }

let rows; // id -> streamer row
let calls; // [name, ...args]
let relayState; // { forwarders: Map(key -> Set), live: Set(key) }
let youtubeState; // { streamId, status: Map(broadcastId -> lifeCycleStatus), created: 0 }
let gates; // name -> deferred promise the stub waits on before answering
let failures; // name -> Error the stub throws
let timers; // [{ fn, ms, cleared }]
let repeats;
let clock;
let logs;
let sessions;

function streamerRow(over = {}) {
  return {
    id: 1, enabled: 1, multistream_enabled: 1, multistream_token: KEY,
    twitch_user_id: '4242', broadcaster_access_token: 'synthetic-broadcaster-token', broadcaster_scopes: 'channel:read:stream_key',
    yt_access_token: 'synthetic-yt-token', multistream_youtube_stream_id: 'yt-stream-1', multistream_active_broadcast_id: null,
    multistream_youtube_default_title: null, multistream_youtube_privacy: 'unlisted', multistream_youtube_category_id: '20',
    ...over,
  };
}

const db = {
  getStreamerByMultistreamToken: (token) => {
    const row = Object.values(rows).find((r) => r.multistream_token === token && r.enabled !== 0);
    return row ? { ...row } : undefined;
  },
  getStreamerById: (id) => (rows[id] ? { ...rows[id] } : undefined),
  setMultistreamYoutubeStream: (id, streamId) => { calls.push(['db.setStream', id, streamId]); rows[id].multistream_youtube_stream_id = streamId; },
  setMultistreamActiveBroadcast: (id, broadcastId) => { calls.push(['db.setBroadcast', id, broadcastId]); rows[id].multistream_active_broadcast_id = broadcastId; },
  setMultistreamLastError: (id, message) => { rows[id].multistream_last_error = message; },
  markMultistreamStarted: (id) => { rows[id].multistream_last_started_at = clock; },
};

async function step(name, args, answer) {
  calls.push([name, ...args]);
  if (gates[name]) await gates[name].promise;
  if (failures[name]) throw failures[name];
  return answer();
}

const twitch = {
  hasStreamKeyScope: (s) => (s.broadcaster_scopes || '').split(' ').includes('channel:read:stream_key'),
  getStreamKey: (s) => step('twitch.getStreamKey', [s.id], () => 'live_4242_synthetic'),
  getChannelTitle: (id) => step('twitch.getChannelTitle', [id], () => 'Channel title <3'),
};

const youtube = {
  getOrCreateLiveStream: (s) => step('yt.getOrCreateLiveStream', [s.id], () => ({ streamId: youtubeState.streamId, streamKey: `ytkey-${youtubeState.streamId}` })),
  getBroadcastStatus: (s, id) => step('yt.getBroadcastStatus', [id], () => youtubeState.status.get(id) || null),
  createBroadcast: (s, options) => step('yt.createBroadcast', [options], () => {
    youtubeState.created++;
    const id = `yt-broadcast-${youtubeState.created}`;
    youtubeState.status.set(id, 'created');
    return id;
  }),
  bindBroadcastToStream: (s, id, streamId) => step('yt.bind', [id, streamId], () => { youtubeState.status.set(id, 'ready'); return null; }),
  transitionBroadcast: (s, id, status) => step('yt.transition', [id, status], () => { youtubeState.status.set(id, status); return null; }),
};

const relay = {
  listForwarders: () => step('relay.listForwarders', [], () => new Map([...relayState.forwarders].map(([k, v]) => [k, new Set(v)]))),
  listLiveStreams: () => step('relay.listLiveStreams', [], () => new Set(relayState.live)),
  addForwardPaths: ({ sourceToken, destinations }) => step(`relay.add.${destinations[0].name}`, [sourceToken, destinations.map((d) => d.url)], () => {
    if (!relayState.forwarders.has(sourceToken)) relayState.forwarders.set(sourceToken, new Set());
    for (const d of destinations) relayState.forwarders.get(sourceToken).add(d.name);
    return destinations.map((d) => d.name);
  }),
  removeForwardPaths: ({ sourceToken, destinationNames }) => step('relay.remove', [sourceToken, destinationNames], () => {
    const set = relayState.forwarders.get(sourceToken);
    if (set) for (const n of destinationNames) set.delete(n);
    if (set && set.size === 0) relayState.forwarders.delete(sourceToken);
  }),
};

let settingsValue;

beforeEach(() => {
  rows = { 1: streamerRow() };
  calls = [];
  relayState = { forwarders: new Map(), live: new Set() };
  youtubeState = { streamId: 'yt-stream-1', status: new Map(), created: 0 };
  gates = {};
  failures = {};
  timers = [];
  repeats = [];
  clock = 1_000_000;
  logs = [];
  settingsValue = { enabled: true, apiUrl: 'http://relay.example.test', apiUser: 'admin', apiToken: 'synthetic-api-token' };
  sessions = createMultistreamSessions({
    db, twitch, youtube, relay,
    settings: () => settingsValue,
    isStreamerDisabled: (s) => s.enabled === 0,
    log: { log: (...a) => logs.push(['log', a.join(' ')]), warn: (...a) => logs.push(['warn', a.join(' ')]), error: (...a) => logs.push(['error', a.join(' ')]) },
    now: () => clock,
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (t) => { t.cleared = true; },
    setRepeat: (fn, ms) => { const r = { fn, ms, cleared: false }; repeats.push(r); return r; },
    clearRepeat: (r) => { r.cleared = true; },
  });
});

const named = (prefix) => calls.filter(([name]) => name.startsWith(prefix));
const fireStopTimers = () => { for (const t of timers.filter((x) => !x.cleared && x.ms === STOP_GRACE_MS)) { t.cleared = true; t.fn(); } };

// ── Going live ───────────────────────────────────────────────────────────

describe('going live', () => {
  test('forwards to Twitch and YouTube: one new broadcast, bound to the stored stream, one forwarder per destination', async () => {
    const result = await sessions.goLive(KEY);
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.forwarding.sort(), ['twitch', 'youtube']);
    assert.deepEqual(result.failed, []);
    assert.equal(youtubeState.created, 1);
    assert.deepEqual(named('yt.bind'), [['yt.bind', 'yt-broadcast-1', 'yt-stream-1']]);
    assert.deepEqual(named('relay.add'), [
      ['relay.add.twitch', KEY, ['rtmp://live.twitch.tv/app/live_4242_synthetic']],
      ['relay.add.youtube', KEY, ['rtmp://a.rtmp.youtube.com/live2/ytkey-yt-stream-1']],
    ]);
    assert.equal(rows[1].multistream_active_broadcast_id, 'yt-broadcast-1');
    assert.equal(rows[1].multistream_last_error, null);
    assert.equal(rows[1].multistream_last_started_at, clock);
    await settle();
    assert.equal(sessions.lockCount(), 0, 'nothing is left in the lock map');
  });

  test('the broadcast gets the default title, else the channel\'s Twitch title (whether or not Twitch is live yet), else the date', async () => {
    rows[1].multistream_youtube_default_title = 'My saved title';
    await sessions.goLive(KEY);
    assert.equal(named('yt.createBroadcast')[0][1].title, 'My saved title');
    assert.deepEqual(named('twitch.getChannelTitle'), []);

    rows = { 1: streamerRow() };
    relayState.forwarders.clear();
    calls = [];
    await sessions.goLive(KEY);
    assert.deepEqual(named('twitch.getChannelTitle'), [['twitch.getChannelTitle', '4242']]);
    assert.equal(named('yt.createBroadcast')[0][1].title, 'Channel title <3', 'cleaned up by createBroadcast itself');
    assert.equal(named('yt.createBroadcast')[0][1].privacyStatus, 'unlisted');

    rows = { 1: streamerRow() };
    relayState.forwarders.clear();
    calls = [];
    failures['twitch.getChannelTitle'] = new Error('Twitch API error: 503');
    await sessions.goLive(KEY);
    assert.match(named('yt.createBroadcast')[0][1].title, /^Live — /);
  });

  test('a webhook sent twice at once makes one broadcast and one set of forwarders: the second waits for the first', async () => {
    gates['yt.createBroadcast'] = deferred();
    const first = sessions.goLive(KEY);
    await settle();
    const second = sessions.goLive(KEY);
    await settle();
    assert.equal(named('yt.createBroadcast').length, 1);
    assert.equal(named('relay.listForwarders').length, 1, 'the second has not started');
    gates['yt.createBroadcast'].resolve();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(youtubeState.created, 1, 'one broadcast');
    assert.equal(named('relay.add').length, 2, 'two forwarders, added once');
    assert.deepEqual(b.added, [], 'the second found everything in place');
    assert.deepEqual(b.forwarding.sort(), ['twitch', 'youtube']);
    assert.deepEqual(a.forwarding.sort(), ['twitch', 'youtube']);
    assert.deepEqual(named('yt.getBroadcastStatus'), [['yt.getBroadcastStatus', 'yt-broadcast-1']], 'the second reused it after asking its state');
  });

  test('the broadcast is reused while ready or live, and replaced once complete or gone', async () => {
    for (const [state, reused] of [['ready', true], ['testing', true], ['live', true], ['liveStarting', true], ['complete', false], ['revoked', false], [null, false]]) {
      rows = { 1: streamerRow({ multistream_active_broadcast_id: 'yt-broadcast-old' }) };
      youtubeState = { streamId: 'yt-stream-1', status: new Map(state ? [['yt-broadcast-old', state]] : []), created: 0 };
      relayState.forwarders.clear();
      calls = [];
      await sessions.goLive(KEY);
      assert.equal(youtubeState.created, reused ? 0 : 1, String(state));
      assert.equal(rows[1].multistream_active_broadcast_id, reused ? 'yt-broadcast-old' : 'yt-broadcast-1', String(state));
    }
  });

  test('a broadcast left unbound by a failed bind is bound, not made again', async () => {
    failures['yt.bind'] = new Error('YouTube API POST /liveBroadcasts/bind -> 500');
    const first = await sessions.goLive(KEY);
    assert.equal(youtubeState.created, 1);
    assert.match(first.failed.join(), /^youtube: YouTube API POST \/liveBroadcasts\/bind -> 500/);
    assert.deepEqual(first.forwarding, ['twitch']);
    delete failures['yt.bind'];
    const second = await sessions.goLive(KEY);
    assert.equal(youtubeState.created, 1, 'no second broadcast');
    assert.equal(named('yt.bind').length, 2);
    assert.deepEqual(second.forwarding.sort(), ['twitch', 'youtube']);
  });

  test('when YouTube cannot say what state the broadcast is in, no new broadcast is made; Twitch still goes out and the dashboard is told', async () => {
    rows[1].multistream_active_broadcast_id = 'yt-broadcast-old';
    failures['yt.getBroadcastStatus'] = new Error('YouTube API GET /liveBroadcasts -> 403: quotaExceeded');
    const result = await sessions.goLive(KEY);
    assert.equal(youtubeState.created, 0);
    assert.deepEqual(result.forwarding, ['twitch']);
    assert.match(rows[1].multistream_last_error, /^youtube: YouTube API GET \/liveBroadcasts -> 403/);
    assert.ok(logs.some(([level, line]) => level === 'warn' && /forwarding to twitch only/.test(line)));
  });

  test('a new YouTube stream (the stored one is gone) gets a new broadcast, and the forwarder to the old key is replaced', async () => {
    rows[1].multistream_active_broadcast_id = 'yt-broadcast-old';
    youtubeState.status.set('yt-broadcast-old', 'live');
    relayState.forwarders.set(KEY, new Set(['twitch', 'youtube']));
    youtubeState.streamId = 'yt-stream-2';
    const result = await sessions.goLive(KEY);
    assert.deepEqual(named('db.setStream'), [['db.setStream', 1, 'yt-stream-2']]);
    assert.deepEqual(named('relay.remove'), [['relay.remove', KEY, ['youtube']]]);
    assert.deepEqual(named('relay.add'), [['relay.add.youtube', KEY, ['rtmp://a.rtmp.youtube.com/live2/ytkey-yt-stream-2']]]);
    assert.equal(youtubeState.created, 1, 'the old broadcast was bound to the old stream');
    assert.deepEqual(result.added, ['youtube']);
  });

  test('a refused forwarder keeps the other: Twitch out, YouTube refused, and the answer says the relay failed', async () => {
    failures['relay.add.youtube'] = new Error('Relay add (youtube) failed: 500');
    const result = await sessions.goLive(KEY);
    assert.deepEqual(result.forwarding, ['twitch']);
    assert.equal(result.relayFailed, true);
    assert.match(rows[1].multistream_last_error, /relay: Relay add \(youtube\) failed: 500/);
  });

  test('without YouTube connected only Twitch is set up; without Twitch\'s stream-key permission only YouTube', async () => {
    rows[1].yt_access_token = null;
    let result = await sessions.goLive(KEY);
    assert.deepEqual(result.forwarding, ['twitch']);
    assert.deepEqual(named('yt.'), []);
    assert.deepEqual(result.expected, ['twitch']);

    rows = { 1: streamerRow({ broadcaster_scopes: 'bits:read' }) };
    relayState.forwarders.clear();
    calls = [];
    failures['twitch.getStreamKey'] = new Error('Missing channel:read:stream_key scope');
    result = await sessions.goLive(KEY);
    assert.deepEqual(result.forwarding, ['youtube']);
    assert.deepEqual(result.expected, ['youtube']);
  });

  test('an unknown key, a disabled account and multistream switched off are not forwarded, and nothing is asked', async () => {
    assert.equal((await sessions.goLive('UnknownKey00000000000000000000')).status, 'unknown');
    rows[1].enabled = 0;
    assert.equal((await sessions.goLive(KEY)).status, 'unknown');
    rows[1].enabled = 1;
    rows[1].multistream_enabled = 0;
    assert.equal((await sessions.goLive(KEY)).status, 'off');
    assert.deepEqual(calls, []);
  });

  test('a relay that does not answer fails the go-live (the webhook then answers 502 so the relay retries)', async () => {
    failures['relay.listForwarders'] = new Error('fetch failed');
    await assert.rejects(sessions.goLive(KEY), /fetch failed/);
    await settle();
    assert.equal(sessions.lockCount(), 0);
  });
});

// ── The stream ending ────────────────────────────────────────────────────

describe('a stream that ends', () => {
  beforeEach(async () => {
    await sessions.goLive(KEY);
    calls = [];
  });

  test('is stopped a minute later: forwarders removed, broadcast completed, pointer cleared', async () => {
    sessions.streamEnded(KEY);
    assert.deepEqual(calls, [], 'nothing at once');
    assert.equal(sessions.pendingStopCount(), 1);
    fireStopTimers();
    await settle();
    assert.deepEqual(named('relay.remove'), [['relay.remove', KEY, ['twitch', 'youtube']]]);
    assert.deepEqual(named('yt.transition'), [['yt.transition', 'yt-broadcast-1', 'complete']]);
    assert.equal(rows[1].multistream_active_broadcast_id, null);
    assert.equal(sessions.pendingStopCount(), 0);
  });

  test('an OBS reconnect within the minute keeps the same broadcast and its forwarders', async () => {
    sessions.streamEnded(KEY);
    youtubeState.status.set('yt-broadcast-1', 'live');
    const result = await sessions.goLive(KEY);
    assert.equal(sessions.pendingStopCount(), 0, 'the stop was cancelled');
    assert.ok(timers.find((t) => t.ms === STOP_GRACE_MS).cleared);
    assert.equal(youtubeState.created, 1, 'no second broadcast or VOD');
    assert.deepEqual(result.added, []);
    assert.deepEqual(named('relay.remove'), []);
    assert.deepEqual(named('yt.transition'), []);
  });

  test('a go-live that arrives after the minute but before the stop has run keeps the session', async () => {
    gates['relay.listForwarders'] = deferred();
    const busy = sessions.goLive(KEY); // holds the key's lock
    await settle();
    sessions.streamEnded(KEY);
    fireStopTimers(); // the stop queues behind the go-live in progress
    const back = sessions.goLive(KEY); // and the stream is back before it runs
    gates['relay.listForwarders'].resolve();
    await Promise.all([busy, back]);
    await settle();
    assert.deepEqual(named('relay.remove'), []);
    assert.deepEqual(named('yt.transition'), []);
    assert.equal(rows[1].multistream_active_broadcast_id, 'yt-broadcast-1');
  });

  test('a second "ended" while the first waits does not start another wait', () => {
    sessions.streamEnded(KEY);
    sessions.streamEnded(KEY);
    assert.equal(timers.filter((t) => t.ms === STOP_GRACE_MS).length, 1);
  });

  test('a disabled account loses its forwarders; its broadcast is left for YouTube to end', async () => {
    sessions.streamEnded(KEY);
    rows[1].enabled = 0;
    fireStopTimers();
    await settle();
    assert.deepEqual(named('relay.remove'), [['relay.remove', KEY, ['twitch', 'youtube']]]);
    assert.deepEqual(named('yt.transition'), []);
  });

  test('a failed removal is logged and the broadcast is still completed', async () => {
    failures['relay.remove'] = new Error('Relay delete (twitch) failed: 500');
    sessions.streamEnded(KEY);
    fireStopTimers();
    await settle();
    assert.ok(logs.some(([level, line]) => level === 'error' && /removing the forwarders failed for streamer 1/.test(line)));
    assert.deepEqual(named('yt.transition'), [['yt.transition', 'yt-broadcast-1', 'complete']]);
  });

  test('stopAll on shutdown cancels the waits', () => {
    sessions.streamEnded(KEY);
    sessions.stopAll();
    assert.equal(sessions.pendingStopCount(), 0);
    assert.ok(timers.every((t) => t.cleared));
  });
});

// ── The minute check ─────────────────────────────────────────────────────

describe('the check every minute', () => {
  test('sets up a stream whose on-ready webhook was lost', async () => {
    relayState.live.add(KEY);
    await sessions.check();
    assert.deepEqual(relayState.forwarders.get(KEY), new Set(['twitch', 'youtube']));
    assert.equal(youtubeState.created, 1);
  });

  test('leaves a fully forwarded stream alone, asking nobody but the relay', async () => {
    relayState.live.add(KEY);
    relayState.forwarders.set(KEY, new Set(['twitch', 'youtube']));
    await sessions.check();
    assert.deepEqual(calls.map(([name]) => name).sort(), ['relay.listForwarders', 'relay.listLiveStreams']);
  });

  test('a leg that keeps failing is tried again 2, 4, 8 and 16 minutes later, then left alone until the stream reconnects', async () => {
    relayState.live.add(KEY);
    failures['yt.getOrCreateLiveStream'] = new Error('YouTube API GET /liveStreams -> 403');
    const tries = () => named('yt.getOrCreateLiveStream').length;
    await sessions.check();
    assert.equal(tries(), 1);
    await sessions.check();
    assert.equal(tries(), 1, 'not again within 2 minutes');
    for (const minutes of [2, 4, 8, 16]) {
      clock += minutes * 60_000;
      await sessions.check();
    }
    assert.equal(tries(), RETRY_ATTEMPTS);
    clock += 60 * 60_000;
    await sessions.check();
    assert.equal(tries(), RETRY_ATTEMPTS, 'left alone');
    relayState.live.delete(KEY);
    await sessions.check();
    relayState.live.add(KEY);
    await sessions.check();
    assert.equal(tries(), RETRY_ATTEMPTS + 1, 'a new stream starts over');
  });

  test('stops forwarding a stream whose account was disabled, or whose multistream was switched off, after it started', async () => {
    rows[2] = streamerRow({ id: 2, multistream_token: KEY_TWO, multistream_active_broadcast_id: 'yt-broadcast-two' });
    youtubeState.status.set('yt-broadcast-two', 'live');
    relayState.live = new Set([KEY, KEY_TWO]);
    relayState.forwarders = new Map([[KEY, new Set(['twitch', 'youtube'])], [KEY_TWO, new Set(['twitch'])]]);
    rows[1].enabled = 0;
    rows[2].multistream_enabled = 0;
    await sessions.check();
    assert.deepEqual(named('relay.remove').map(([, key]) => key).sort(), [KEY, KEY_TWO].sort());
    assert.deepEqual(named('yt.transition'), [['yt.transition', 'yt-broadcast-two', 'complete']], 'only the enabled account\'s broadcast is completed');
    assert.deepEqual(named('relay.add'), []);
  });

  test('forwarders whose stream is gone are stopped like a stream that ended', async () => {
    relayState.forwarders.set(KEY, new Set(['twitch']));
    await sessions.check();
    assert.equal(sessions.pendingStopCount(), 1);
    fireStopTimers();
    await settle();
    assert.deepEqual(named('relay.remove'), [['relay.remove', KEY, ['twitch', 'youtube']]]);
  });

  test('a relay that does not answer is logged, and nothing changes', async () => {
    relayState.live.add(KEY);
    failures['relay.listLiveStreams'] = new Error('fetch failed');
    await sessions.check();
    assert.ok(logs.some(([level, line]) => level === 'warn' && /relay check failed: fetch failed/.test(line)));
    assert.deepEqual(named('relay.add'), []);
  });

  test('does nothing while the relay is not configured', async () => {
    settingsValue = { ...settingsValue, enabled: false };
    relayState.live.add(KEY);
    await sessions.check();
    assert.deepEqual(calls, []);
  });

  test('runs at start and then every minute, never two at once, and stops on shutdown', async () => {
    gates['relay.listLiveStreams'] = deferred();
    sessions.startChecks();
    sessions.startChecks();
    assert.equal(repeats.length, 1);
    assert.equal(repeats[0].ms, 60_000);
    repeats[0].fn(); // the minute comes round while the first check still waits on the relay
    await settle();
    assert.equal(named('relay.listLiveStreams').length, 1);
    gates['relay.listLiveStreams'].resolve();
    await settle();
    repeats[0].fn();
    await settle();
    assert.equal(named('relay.listLiveStreams').length, 2);
    sessions.stopAll();
    assert.equal(repeats[0].cleared, true);
  });
});
