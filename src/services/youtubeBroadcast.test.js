'use strict';

// The YouTube broadcast calls multistream makes. fetch is stubbed, and the db
// and the token renewal are replaced: nothing leaves the machine. All ids,
// keys and tokens are synthetic.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const cleared = [];
const dbStub = { clearMultistreamYoutubeStream: (id) => cleared.push(id) };
const renewals = [];
const youtubeStub = {
  refreshStreamerYoutubeToken: async (streamer) => {
    renewals.push(streamer.id);
    streamer.yt_access_token = 'renewed-token';
    streamer.yt_token_expires_at = Date.now() + 3_600_000;
    return 'renewed-token';
  },
};

const origLoad = Module._load.bind(Module);
Module._load = function (request, parent, isMain) {
  const fromBroadcast = parent && parent.filename && parent.filename.endsWith('youtubeBroadcast.js');
  if (fromBroadcast && request === '../db') return dbStub;
  if (fromBroadcast && request === './youtube') return youtubeStub;
  return origLoad(request, parent, isMain);
};
delete require.cache[require.resolve('./youtubeBroadcast')];
const yt = require('./youtubeBroadcast');
Module._load = origLoad;

const realFetch = global.fetch;
const realWarn = console.warn;
let requests; // [{ url, opts }]
let answers; // queue of { status, json }

function stubFetch(...queue) {
  requests = [];
  answers = queue;
  global.fetch = async (url, opts = {}) => {
    requests.push({ url: String(url), opts });
    const next = answers.shift() || { status: 200, json: {} };
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.json,
      text: async () => JSON.stringify(next.json || {}),
    };
  };
}

const streamer = (over = {}) => ({ id: 7, yt_access_token: 'yt-token', yt_token_expires_at: Date.now() + 3_600_000, multistream_youtube_stream_id: 'stream-1', ...over });
const liveStream = (id, streamName) => ({ id, cdn: { ingestionInfo: { streamName } } });

beforeEach(() => {
  cleared.length = 0;
  renewals.length = 0;
  console.warn = () => {};
});
afterEach(() => {
  global.fetch = realFetch;
  console.warn = realWarn;
});

describe('the broadcast title (MS8)', () => {
  test('drops < and > (YouTube refuses them), keeps the rest', () => {
    assert.equal(yt.sanitizeBroadcastTitle('Race night <3 >>> GT3 <b>'), 'Race night 3 GT3 b');
  });

  test('is one line, at most 100 characters counted as code points, so an emoji is never cut in half', () => {
    const emoji = '🏁';
    const long = `${'a'.repeat(99)}${emoji}${emoji}`;
    const cut = yt.sanitizeBroadcastTitle(long);
    assert.equal(Array.from(cut).length, 100);
    assert.ok(cut.endsWith(emoji), 'the 100th character is the whole emoji');
    assert.equal(yt.sanitizeBroadcastTitle('  line one\nline two\t '), 'line one line two');
  });

  test('falls back when nothing is left', () => {
    assert.equal(yt.sanitizeBroadcastTitle('<<>>'), 'Live Stream');
    assert.equal(yt.sanitizeBroadcastTitle(''), 'Live Stream');
    assert.equal(yt.sanitizeBroadcastTitle(null), 'Live Stream');
  });

  test('createBroadcast sends the cleaned title and asks YouTube to start the broadcast by itself', async () => {
    stubFetch({ status: 200, json: { id: 'broadcast-1' } });
    const id = await yt.createBroadcast(streamer(), { title: 'Endurance <3', privacyStatus: 'unlisted', categoryId: '17' });
    assert.equal(id, 'broadcast-1');
    const body = JSON.parse(requests[0].opts.body);
    assert.equal(body.snippet.title, 'Endurance 3');
    assert.equal(body.snippet.categoryId, '17');
    assert.equal(body.status.privacyStatus, 'unlisted');
    assert.equal(body.contentDetails.enableAutoStart, true);
    assert.equal(body.contentDetails.enableAutoStop, true);
  });
});

describe('the stored YouTube stream (MS11)', () => {
  test('is reused when YouTube still has it', async () => {
    stubFetch({ status: 200, json: { items: [liveStream('stream-1', 'abcd-efgh-ijkl')] } });
    assert.deepEqual(await yt.getOrCreateLiveStream(streamer()), { streamId: 'stream-1', streamKey: 'abcd-efgh-ijkl' });
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/liveStreams\?part=cdn&id=stream-1$/);
    assert.deepEqual(cleared, []);
  });

  test('a failed lookup is an error: the stream is neither forgotten nor made again', async () => {
    stubFetch({ status: 500, json: { error: 'backendError' } });
    await assert.rejects(yt.getOrCreateLiveStream(streamer()), /YouTube API GET .* -> 500/);
    assert.equal(requests.length, 1, 'no liveStreams.insert');
    assert.deepEqual(cleared, []);
  });

  test('only YouTube saying it has no such stream makes a new one', async () => {
    stubFetch({ status: 200, json: { items: [] } }, { status: 200, json: liveStream('stream-2', 'wxyz-0000') });
    assert.deepEqual(await yt.getOrCreateLiveStream(streamer()), { streamId: 'stream-2', streamKey: 'wxyz-0000' });
    assert.deepEqual(cleared, [7]);
    assert.equal(requests[1].opts.method, 'POST');
    assert.match(requests[1].url, /\/liveStreams\?part=snippet,cdn,contentDetails$/);
  });

  test('a stream without a key is an error (never an address ending in "undefined")', async () => {
    stubFetch({ status: 200, json: { items: [{ id: 'stream-1', cdn: {} }] } });
    await assert.rejects(yt.getOrCreateLiveStream(streamer()), /no stream key/);
    stubFetch({ status: 200, json: { id: 'stream-3' } });
    await assert.rejects(yt.getOrCreateLiveStream(streamer({ multistream_youtube_stream_id: null })), /no stream key/);
  });
});

describe('the broadcast state', () => {
  test('is YouTube\'s life cycle status, or null when YouTube has no such broadcast', async () => {
    stubFetch({ status: 200, json: { items: [{ id: 'b-1', status: { lifeCycleStatus: 'live' } }] } }, { status: 200, json: { items: [] } });
    assert.equal(await yt.getBroadcastStatus(streamer(), 'b-1'), 'live');
    assert.equal(await yt.getBroadcastStatus(streamer(), 'b-gone'), null);
    assert.match(requests[0].url, /\/liveBroadcasts\?part=status&id=b-1$/);
  });

  test('a failed lookup is an error, not "no such broadcast"', async () => {
    stubFetch({ status: 403, json: { error: 'quotaExceeded' } });
    await assert.rejects(yt.getBroadcastStatus(streamer(), 'b-1'), /-> 403/);
  });
});

describe('every call', () => {
  test('has a timeout', async () => {
    stubFetch({ status: 200, json: { items: [] } });
    await yt.getBroadcastStatus(streamer(), 'b-1');
    assert.ok(requests[0].opts.signal instanceof AbortSignal);
  });

  test('renews an expired token once, and the later calls of the same go-live use the new one', async () => {
    const row = streamer({ yt_token_expires_at: Date.now() - 1000 });
    stubFetch({ status: 200, json: { items: [] } }, { status: 200, json: { items: [] } });
    await yt.getBroadcastStatus(row, 'b-1');
    await yt.getBroadcastStatus(row, 'b-1');
    assert.deepEqual(renewals, [7]);
    for (const r of requests) assert.equal(r.opts.headers.Authorization, 'Bearer renewed-token');
  });
});
