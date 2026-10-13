'use strict';

// The YouTube helpers that the slow dashboard pages call take an optional
// deadline. fetch is stubbed and config/db are replaced; nothing leaves the machine.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const savedTokens = [];
const dbStub = { updateStreamerYoutubeTokens: (...args) => savedTokens.push(args) };
const configStub = { youtube: { botClientId: 'client-id', botClientSecret: 'client-secret' } };

const origLoad = Module._load.bind(Module);
Module._load = function (request, parent, isMain) {
  const fromYoutubeService = parent && parent.filename && parent.filename.includes('services/youtube.js');
  if (fromYoutubeService && request === '../config') return configStub;
  if (fromYoutubeService && request === '../db') return dbStub;
  return origLoad(request, parent, isMain);
};
delete require.cache[require.resolve('./youtube')];
const youtube = require('./youtube');

const realFetch = global.fetch;
const realConsoleError = console.error;
let calls; // [{ url, signal }]

// Answers with `json`; `hang` leaves the request pending until its own signal aborts, like fetch does.
function stubFetch({ json = {}, html = '', status = 200, hang = false } = {}) {
  calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), signal: opts.signal });
    if (hang) {
      return new Promise((_resolve, reject) => {
        if (opts.signal && opts.signal.aborted) return reject(opts.signal.reason);
        if (opts.signal) opts.signal.addEventListener('abort', () => reject(opts.signal.reason), { once: true });
      });
    }
    return { ok: status >= 200 && status < 300, status, json: async () => json, text: async () => html };
  };
}

beforeEach(() => {
  savedTokens.length = 0;
  console.error = () => {}; // the helpers log failed page fetches
});

afterEach(() => {
  global.fetch = realFetch;
  console.error = realConsoleError;
});

describe('getActiveBroadcast', () => {
  const live = { items: [{ status: { lifeCycleStatus: 'live' }, snippet: { title: 'Race night', liveChatId: 'chat-1' } }] };

  test('sends the caller\'s signal with the request', async () => {
    stubFetch({ json: live });
    const signal = AbortSignal.timeout(5000);
    const result = await youtube.getActiveBroadcast('access-token', { signal });
    assert.deepEqual(result, { liveChatId: 'chat-1', title: 'Race night' });
    assert.equal(calls[0].signal, signal);
  });

  test('has its own 10 s timeout when the caller gives none', async () => {
    stubFetch({ json: live });
    await youtube.getActiveBroadcast('access-token');
    assert.ok(calls[0].signal instanceof AbortSignal);
    assert.equal(calls[0].signal.aborted, false);
  });

  test('a slow answer is cut at the caller\'s deadline', async () => {
    stubFetch({ hang: true });
    const started = Date.now();
    await assert.rejects(() => youtube.getActiveBroadcast('access-token', { signal: AbortSignal.timeout(40) }), (err) => err.name === 'TimeoutError');
    assert.ok(Date.now() - started < 1000);
  });
});

describe('refreshStreamerYoutubeToken', () => {
  const streamer = { id: 1, yt_refresh_token: 'refresh-token', yt_channel_name: 'Chan' };

  test('sends the caller\'s signal, and saves the new token', async () => {
    stubFetch({ json: { access_token: 'new-access', expires_in: 3600 } });
    const signal = AbortSignal.timeout(5000);
    assert.equal(await youtube.refreshStreamerYoutubeToken(streamer, { signal }), 'new-access');
    assert.equal(calls[0].signal, signal);
    assert.equal(savedTokens.length, 1);
    assert.equal(savedTokens[0][0], 1);
    assert.equal(savedTokens[0][1], 'new-access');
  });

  test('has its own timeout when the caller gives none', async () => {
    stubFetch({ json: { access_token: 'new-access', expires_in: 3600 } });
    await youtube.refreshStreamerYoutubeToken(streamer);
    assert.ok(calls[0].signal instanceof AbortSignal);
  });

  test('a slow answer is cut at the caller\'s deadline and saves nothing', async () => {
    stubFetch({ hang: true });
    await assert.rejects(() => youtube.refreshStreamerYoutubeToken(streamer, { signal: AbortSignal.timeout(40) }), (err) => err.name === 'TimeoutError');
    assert.equal(savedTokens.length, 0);
  });

  test('without a refresh token there is nothing to ask', async () => {
    stubFetch();
    assert.equal(await youtube.refreshStreamerYoutubeToken({ id: 2 }), null);
    assert.equal(calls.length, 0);
  });
});

describe('getChannelInfo (a scraped channel page)', () => {
  const page = '<html><head><title>Some Channel - YouTube</title><meta property="og:image" content="https://img.test/a.jpg"></head></html>';

  test('sends the caller\'s signal and reads the name and picture', async () => {
    stubFetch({ html: page });
    const signal = AbortSignal.timeout(5000);
    const info = await youtube.getChannelInfo('UC1234567890123456789012', { signal });
    assert.equal(info.channelName, 'Some Channel');
    assert.equal(info.profileImageUrl, 'https://img.test/a.jpg');
    assert.equal(calls[0].signal, signal);
  });

  test('every page fetch has a timeout, even for callers that pass none', async () => {
    stubFetch({ html: page });
    await youtube.getChannelInfo('UC1234567890123456789012');
    await youtube.resolveChannelId('@somehandle');
    assert.equal(calls.length, 2);
    for (const call of calls) assert.ok(call.signal instanceof AbortSignal, call.url);
  });

  test('a slow page gives null at the caller\'s deadline instead of holding the caller', async () => {
    stubFetch({ hang: true });
    const started = Date.now();
    assert.equal(await youtube.getChannelInfo('UC1234567890123456789012', { signal: AbortSignal.timeout(40) }), null);
    assert.ok(Date.now() - started < 1000);
  });
});
