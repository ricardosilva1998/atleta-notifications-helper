'use strict';

// The lookups a page makes while it is built: fake Twitch and YouTube modules are
// injected, so no config, database or network is involved, and the deadline is
// shortened to tens of milliseconds.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { PAGE_LOOKUP_TIMEOUT_MS, findStreamThumbnail, youtubeLiveStatus } = require('./pageLookups');

const realLog = console.log;
const realWarn = console.warn;
let logs;
beforeEach(() => {
  logs = [];
  console.log = (...args) => logs.push(args.join(' '));
  console.warn = (...args) => logs.push(args.join(' '));
});
afterEach(() => {
  console.log = realLog;
  console.warn = realWarn;
});

// Resolves with `value` after `ms`, or rejects when the call's own signal aborts first (as fetch does).
const answer = (value, ms, options) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => resolve(value), ms);
  timer.unref();
  const signal = options && options.signal;
  if (!signal) return;
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
});

describe('the page deadline', () => {
  test('is 3 seconds', () => {
    assert.equal(PAGE_LOOKUP_TIMEOUT_MS, 3000);
  });
});

describe('findStreamThumbnail', () => {
  const streamer = { twitch_username: 'somestreamer', twitch_user_id: '42' };
  const stream = { thumbnail_url: 'https://img.test/live-{width}x{height}.jpg' };
  const vod = { thumbnail_url: 'https://img.test/vod-%{width}x%{height}.jpg' };

  function fakeTwitch(over = {}) {
    const calls = [];
    return {
      calls,
      getStream: async (login, options) => { calls.push(['getStream', login, options]); return stream; },
      getUserId: async (login, options) => { calls.push(['getUserId', login, options]); return '42'; },
      getVideos: async (id, startedAfter, options) => { calls.push(['getVideos', id, startedAfter, options]); return [vod]; },
      ...over,
    };
  }

  test('a live stream\'s thumbnail, sized for the preview', async () => {
    const twitch = fakeTwitch();
    assert.equal(await findStreamThumbnail(streamer, { twitch }), 'https://img.test/live-1280x720.jpg');
    assert.deepEqual(twitch.calls.map((c) => c[0]), ['getStream']);
  });

  test('not live: the latest VOD\'s thumbnail, using the stored Twitch user id', async () => {
    const twitch = fakeTwitch({ getStream: async () => null });
    assert.equal(await findStreamThumbnail(streamer, { twitch }), 'https://img.test/vod-1280x720.jpg');
    assert.deepEqual(twitch.calls.map((c) => c[0]), ['getVideos'], 'no id lookup needed');
    assert.equal(twitch.calls[0][1], '42');
  });

  test('without a stored Twitch user id it is looked up first', async () => {
    const twitch = fakeTwitch({ getStream: async () => null });
    const url = await findStreamThumbnail({ twitch_username: 'somestreamer' }, { twitch });
    assert.equal(url, 'https://img.test/vod-1280x720.jpg');
    assert.deepEqual(twitch.calls.map((c) => c[0]), ['getUserId', 'getVideos']);
  });

  test('all the calls share one signal, so they share one deadline', async () => {
    const twitch = fakeTwitch({ getStream: async (login, options) => { twitch.calls.push(['getStream', login, options]); return null; } });
    await findStreamThumbnail({ twitch_username: 'somestreamer' }, { twitch });
    const signals = twitch.calls.map((c) => c[c.length - 1].signal);
    assert.equal(signals.length, 3);
    assert.ok(signals[0] instanceof AbortSignal);
    assert.ok(signals.every((signal) => signal === signals[0]));
  });

  test('a streamer without a Twitch name gets nothing, without any call', async () => {
    const twitch = fakeTwitch();
    assert.equal(await findStreamThumbnail({ twitch_username: null }, { twitch }), null);
    assert.equal(await findStreamThumbnail({}, { twitch }), null);
    assert.deepEqual(twitch.calls, []);
  });

  test('a failing stream lookup falls back to the VOD', async () => {
    const twitch = fakeTwitch({ getStream: async () => { throw new Error('Twitch API error: 500'); } });
    assert.equal(await findStreamThumbnail(streamer, { twitch }), 'https://img.test/vod-1280x720.jpg');
  });

  test('no stream and no VOD is no thumbnail', async () => {
    assert.equal(await findStreamThumbnail(streamer, { twitch: fakeTwitch({ getStream: async () => null, getVideos: async () => [] }) }), null);
    assert.equal(await findStreamThumbnail(streamer, { twitch: fakeTwitch({ getStream: async () => null, getVideos: async () => [{ title: 'no picture' }] }) }), null);
    assert.equal(await findStreamThumbnail({ twitch_username: 'x' }, { twitch: fakeTwitch({ getStream: async () => null, getUserId: async () => null }) }), null);
  });

  test('a failing VOD lookup is logged and gives nothing', async () => {
    const twitch = fakeTwitch({ getStream: async () => null, getVideos: async () => { throw new Error('boom'); } });
    assert.equal(await findStreamThumbnail(streamer, { twitch }), null);
    assert.ok(logs.some((line) => line.includes('VOD thumbnail fetch error') && line.includes('boom')));
  });

  test('a Twitch that hangs costs the deadline, not more, and the VOD calls are not even tried', async () => {
    const twitch = fakeTwitch({ getStream: (login, options) => { twitch.calls.push(['getStream', login, options]); return answer(stream, 5000, options); } });
    const started = Date.now();
    assert.equal(await findStreamThumbnail(streamer, { twitch, timeoutMs: 60 }), null);
    const took = Date.now() - started;
    assert.ok(took >= 50 && took < 1000, `took ${took} ms`);
    assert.deepEqual(twitch.calls.map((c) => c[0]), ['getStream']);
  });

  test('a stream lookup that uses most of the time leaves the VOD only what is left', async () => {
    const twitch = fakeTwitch({
      getStream: async (login, options) => { twitch.calls.push(['getStream', login, options]); await answer(null, 50, options); return null; },
      getVideos: (id, startedAfter, options) => { twitch.calls.push(['getVideos', id, startedAfter, options]); return answer([vod], 5000, options); },
    });
    const started = Date.now();
    assert.equal(await findStreamThumbnail(streamer, { twitch, timeoutMs: 120 }), null);
    assert.ok(Date.now() - started < 1000, 'the total stays near the one deadline');
    assert.deepEqual(twitch.calls.map((c) => c[0]), ['getStream', 'getVideos']);
  });
});

describe('youtubeLiveStatus', () => {
  const connected = { id: 7, yt_access_token: 'access-token', yt_token_expires_at: null };

  function fakeYoutube(over = {}) {
    const calls = [];
    return {
      calls,
      refreshStreamerYoutubeToken: async (streamer, options) => { calls.push(['refresh', streamer.id, options]); return 'fresh-token'; },
      getActiveBroadcast: async (token, options) => { calls.push(['broadcast', token, options]); return { liveChatId: 'chat-1', title: 'Race night' }; },
      ...over,
    };
  }

  test('a streamer without a connected YouTube account is not live and nothing is unknown', async () => {
    const youtube = fakeYoutube();
    assert.deepEqual(await youtubeLiveStatus({ id: 7 }, { youtube }), { live: false, title: null, unknown: false });
    assert.deepEqual(youtube.calls, []);
  });

  test('live: the broadcast title', async () => {
    const youtube = fakeYoutube();
    assert.deepEqual(await youtubeLiveStatus(connected, { youtube }), { live: true, title: 'Race night', unknown: false });
    assert.deepEqual(youtube.calls.map((c) => [c[0], c[1]]), [['broadcast', 'access-token']]);
  });

  test('offline: no broadcast is a real answer, not unknown', async () => {
    const youtube = fakeYoutube({ getActiveBroadcast: async () => null });
    assert.deepEqual(await youtubeLiveStatus(connected, { youtube }), { live: false, title: null, unknown: false });
  });

  test('an expired token is renewed first, with the same deadline as the broadcast check', async () => {
    const youtube = fakeYoutube();
    const expired = { ...connected, yt_token_expires_at: Date.now() - 1000 };
    assert.deepEqual(await youtubeLiveStatus(expired, { youtube }), { live: true, title: 'Race night', unknown: false });
    assert.deepEqual(youtube.calls.map((c) => c[0]), ['refresh', 'broadcast']);
    assert.equal(youtube.calls[1][1], 'fresh-token');
    const [refreshOptions, broadcastOptions] = [youtube.calls[0][2], youtube.calls[1][2]];
    assert.ok(refreshOptions.signal instanceof AbortSignal);
    assert.equal(refreshOptions.signal, broadcastOptions.signal);
  });

  test('a token that cannot be renewed is unknown, and the broadcast is not asked', async () => {
    const youtube = fakeYoutube({ refreshStreamerYoutubeToken: async () => null });
    const expired = { ...connected, yt_token_expires_at: Date.now() - 1000 };
    assert.deepEqual(await youtubeLiveStatus(expired, { youtube }), { live: false, title: null, unknown: true });
    assert.deepEqual(youtube.calls, []);
  });

  test('a failing check is unknown, and logged', async () => {
    const youtube = fakeYoutube({ getActiveBroadcast: async () => { throw new Error('socket hang up'); } });
    assert.deepEqual(await youtubeLiveStatus(connected, { youtube }), { live: false, title: null, unknown: true });
    assert.ok(logs.some((line) => line.includes('socket hang up')));
  });

  test('a YouTube that hangs is unknown after the deadline', async () => {
    const youtube = fakeYoutube({ getActiveBroadcast: (token, options) => answer({ title: 'late' }, 5000, options) });
    const started = Date.now();
    assert.deepEqual(await youtubeLiveStatus(connected, { youtube, timeoutMs: 60 }), { live: false, title: null, unknown: true });
    const took = Date.now() - started;
    assert.ok(took >= 50 && took < 1000, `took ${took} ms`);
  });
});
