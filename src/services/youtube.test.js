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
const realConsole = { log: console.log, error: console.error };
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
  console.log = () => {}; // the helpers log what they find and what fails
  console.error = () => {};
});

afterEach(() => {
  global.fetch = realFetch;
  Object.assign(console, realConsole);
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

// ── Batched video lookups, Shorts, the quota, and the bot token (M22, L6, M18) ──

// A fresh module per test: the quota pause and the bot token log notes are module state.
function freshYoutube() {
  delete require.cache[require.resolve('./youtube')];
  return require('./youtube');
}

// Answers each request in turn with respond(callNumber, url) -> { status, body } (body is an object or a string).
function stubResponses(respond) {
  calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), signal: opts.signal, method: opts.method, headers: opts.headers, body: opts.body });
    const { status = 200, body = {} } = respond(calls.length, String(url));
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, json: async () => (typeof body === 'string' ? JSON.parse(body) : body), text: async () => text };
  };
}

const quotaBody = { error: { code: 403, message: 'The request cannot be completed because you have exceeded your quota.', errors: [{ reason: 'quotaExceeded', domain: 'youtube.quota' }] } };
const idsOf = (url) => new URL(url).searchParams.get('id').split(',');
const manyIds = (n) => Array.from({ length: n }, (_, i) => `vid${String(i).padStart(4, '0')}`);

describe('durations and the Shorts threshold', () => {
  test('ISO 8601 durations are read in seconds', () => {
    const { parseIsoDuration } = freshYoutube();
    assert.equal(parseIsoDuration('PT1M30S'), 90);
    assert.equal(parseIsoDuration('PT59S'), 59);
    assert.equal(parseIsoDuration('PT3M'), 180);
    assert.equal(parseIsoDuration('PT1H'), 3600);
    assert.equal(parseIsoDuration('PT1H2M3S'), 3723);
    assert.equal(parseIsoDuration('P1DT2H'), 93600);
    assert.equal(parseIsoDuration('P0D'), 0, 'a broadcast that is still on air');
    for (const unreadable of ['', undefined, null, 'garbage', 'PT', '90']) assert.equal(parseIsoDuration(unreadable), 0, String(unreadable));
  });

  test('a Short is 180 seconds or less: 3 minutes counts, 3 minutes 1 second does not', () => {
    const { isShortDuration, SHORTS_MAX_SECONDS } = freshYoutube();
    assert.equal(SHORTS_MAX_SECONDS, 180);
    assert.equal(isShortDuration(1), true);
    assert.equal(isShortDuration(60), true, 'the old limit is still a Short');
    assert.equal(isShortDuration(61), true, 'and what is just over it now is too');
    assert.equal(isShortDuration(180), true);
    assert.equal(isShortDuration(181), false);
    assert.equal(isShortDuration(3600), false);
    assert.equal(isShortDuration(0), false, 'no duration is not a Short');
  });

  test('getVideoDetails marks Shorts with the new threshold', async () => {
    const yt = freshYoutube();
    const item = (id, duration) => ({ id, contentDetails: { duration } });
    stubResponses(() => ({ body: { items: [item('short60', 'PT1M'), item('short180', 'PT3M'), item('long181', 'PT3M1S'), item('long', 'PT12M40S')] } }));
    const details = await yt.getVideoDetails(['short60', 'short180', 'long181', 'long'], 'key');
    assert.deepEqual(Object.fromEntries(Object.entries(details).map(([id, d]) => [id, d.isShort])), { short60: true, short180: true, long181: false, long: false });
    assert.equal(details.short180.duration, 180);
  });
});

describe('getVideoDetails', () => {
  test('tells uploads from broadcasts that are on air or announced', async () => {
    const yt = freshYoutube();
    stubResponses(() => ({ body: { items: [
      { id: 'upload', contentDetails: { duration: 'PT10M' } },
      { id: 'onair', contentDetails: { duration: 'P0D' }, liveStreamingDetails: { actualStartTime: '2026-10-13T20:00:00Z' } },
      { id: 'upcoming', contentDetails: { duration: 'P0D' }, liveStreamingDetails: { scheduledStartTime: '2026-10-14T20:00:00Z' } },
      { id: 'pastlive', contentDetails: { duration: 'PT2H' }, liveStreamingDetails: { actualStartTime: '2026-10-12T20:00:00Z', actualEndTime: '2026-10-12T22:00:00Z' } },
    ] } }));
    const details = await yt.getVideoDetails(['upload', 'onair', 'upcoming', 'pastlive'], 'key');
    assert.deepEqual(Object.fromEntries(Object.entries(details).map(([id, d]) => [id, d.isLiveOrUpcoming])), { upload: false, onair: true, upcoming: true, pastlive: false });
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get('part'), 'contentDetails,liveStreamingDetails');
  });

  test('a video YouTube does not list has no entry', async () => {
    const yt = freshYoutube();
    stubResponses(() => ({ body: { items: [{ id: 'there', contentDetails: { duration: 'PT5M' } }] } }));
    const details = await yt.getVideoDetails(['there', 'gone'], 'key');
    assert.deepEqual(Object.keys(details), ['there']);
  });

  test('120 videos are asked about in three requests of 50, 50 and 20, each id once', async () => {
    const yt = freshYoutube();
    stubResponses((n, url) => ({ body: { items: idsOf(url).map((id) => ({ id, contentDetails: { duration: 'PT5M' } })) } }));
    const ids = manyIds(120);
    const details = await yt.getVideoDetails([...ids, ...ids.slice(0, 10)], 'key');
    assert.deepEqual(calls.map((c) => idsOf(c.url).length), [50, 50, 20]);
    assert.equal(Object.keys(details).length, 120);
    assert.equal(yt.VIDEOS_PER_REQUEST, 50);
    for (const call of calls) assert.ok(call.signal instanceof AbortSignal, 'with a timeout');
  });

  test('without ids or without an API key nothing is asked', async () => {
    const yt = freshYoutube();
    stubResponses(() => ({ body: { items: [] } }));
    assert.deepEqual(await yt.getVideoDetails([], 'key'), {});
    assert.deepEqual(await yt.getVideoDetails(['a'], ''), {});
    assert.deepEqual(await yt.getVideoDetails(['a'], undefined), {});
    assert.equal(calls.length, 0);
  });

  test('a failed request throws, so the caller can tell it from a video with nothing special', async () => {
    const yt = freshYoutube();
    stubResponses(() => ({ status: 500, body: 'oops' }));
    await assert.rejects(() => yt.getVideoDetails(['a'], 'key'), /YouTube API error: 500/);
  });
});

describe('getLiveVideos', () => {
  const onAir = (id, extra = {}) => ({
    id,
    snippet: { title: `Title ${id}`, description: 'Race night', thumbnails: { high: { url: `https://img.test/${id}.jpg` } } },
    liveStreamingDetails: { actualStartTime: '2026-10-13T20:00:00Z', activeLiveChatId: `chat-${id}`, ...extra },
  });

  test('finds the broadcasts on air, with their chat, and leaves out finished ones and uploads', async () => {
    const yt = freshYoutube();
    stubResponses(() => ({ body: { items: [
      onAir('live1'),
      onAir('ended1', { actualEndTime: '2026-10-13T22:00:00Z' }),
      { id: 'upload1', snippet: { title: 'An upload', thumbnails: {} } },
      { id: 'upcoming1', snippet: { title: 'Soon', thumbnails: {} }, liveStreamingDetails: { scheduledStartTime: '2026-10-14T20:00:00Z' } },
    ] } }));
    const { live, failed } = await yt.getLiveVideos(['live1', 'ended1', 'upload1', 'upcoming1'], 'key');
    assert.deepEqual([...live.keys()], ['live1']);
    assert.deepEqual(live.get('live1'), { id: 'live1', title: 'Title live1', description: 'Race night', thumbnail: 'https://img.test/live1.jpg', liveChatId: 'chat-live1' });
    assert.equal(failed.size, 0);
    assert.equal(new URL(calls[0].url).searchParams.get('part'), 'liveStreamingDetails,snippet');
  });

  test('the videos of many channels share requests: 130 ids are 50 + 50 + 30, not one request per channel', async () => {
    const yt = freshYoutube();
    stubResponses(() => ({ body: { items: [] } }));
    await yt.getLiveVideos(manyIds(130), 'key');
    assert.deepEqual(calls.map((c) => idsOf(c.url).length), [50, 50, 30]);
    for (const call of calls) assert.ok(call.signal instanceof AbortSignal);
  });

  test('a request that fails marks only its own ids as unknown; the other requests still run', async () => {
    const yt = freshYoutube();
    const ids = manyIds(120);
    stubResponses((n) => (n === 2 ? { status: 500, body: 'oops' } : { body: { items: [] } }));
    const { live, failed } = await yt.getLiveVideos(ids, 'key');
    assert.equal(calls.length, 3);
    assert.deepEqual([...failed].sort(), ids.slice(50, 100));
    assert.equal(live.size, 0);
  });

  test('an exhausted quota stops the lookup, is thrown as QUOTA_EXCEEDED, and pauses YouTube for an hour', async () => {
    const yt = freshYoutube();
    stubResponses((n) => (n === 1 ? { body: { items: [] } } : { status: 403, body: quotaBody }));
    assert.equal(yt.quotaBackoffActive(), false);
    const logged = [];
    console.error = (...args) => logged.push(args.join(' '));

    await assert.rejects(() => yt.getLiveVideos(manyIds(200), 'key'), (err) => err.code === 'QUOTA_EXCEEDED');

    assert.equal(calls.length, 2, 'it did not go on asking after the quota ran out');
    assert.equal(yt.quotaBackoffActive(), true);
    assert.equal(logged.filter((line) => /quota exceeded.*pausing YouTube polling for 1 hour/.test(line)).length, 1, logged.join('\n'));
    const now = Date.now();
    assert.equal(yt.quotaBackoffActive(now + 59 * 60_000), true, 'still paused after 59 minutes');
    assert.equal(yt.quotaBackoffActive(now + 61 * 60_000), false, 'asked again after the hour');
  });

  test('without an API key nothing is asked', async () => {
    const yt = freshYoutube();
    stubResponses(() => ({ body: { items: [] } }));
    const { live, failed } = await yt.getLiveVideos(['a', 'b'], '');
    assert.equal(live.size + failed.size, 0);
    assert.equal(calls.length, 0);
  });
});

describe('recognising an exhausted quota', () => {
  const { isQuotaExceeded } = freshYoutube();
  const body = (reason) => JSON.stringify({ error: { errors: [{ reason }] } });

  test('quotaExceeded and dailyLimitExceeded on a 403 are an exhausted quota', () => {
    assert.equal(isQuotaExceeded(403, body('quotaExceeded')), true);
    assert.equal(isQuotaExceeded(403, body('dailyLimitExceeded')), true);
  });

  test('other refusals are not', () => {
    assert.equal(isQuotaExceeded(403, body('forbidden')), false);
    assert.equal(isQuotaExceeded(403, body('rateLimitExceeded')), false);
    assert.equal(isQuotaExceeded(400, body('quotaExceeded')), false, 'only a 403 says it');
    assert.equal(isQuotaExceeded(403, 'not json'), false);
    assert.equal(isQuotaExceeded(403, ''), false);
    assert.equal(isQuotaExceeded(403, JSON.stringify({ error: {} })), false);
    assert.equal(isQuotaExceeded(500, body('quotaExceeded')), false);
  });
});

describe('the pollers\' YouTube calls have a timeout', () => {
  test('the RSS feed, the live chat id, the chat messages and a sent chat message', async () => {
    const yt = freshYoutube();
    const rss = '<feed><entry><yt:videoId>vid1</yt:videoId><title>First</title><link href="https://www.youtube.com/watch?v=vid1"/><published>2026-10-13T10:00:00Z</published><author><name>Some Channel</name></author></entry></feed>';
    stubFetch({ html: rss, json: { items: [{ liveStreamingDetails: { activeLiveChatId: 'chat-1' } }], nextPageToken: 'n' } });

    const videos = await yt.getLatestVideos('UC1234567890123456789012');
    assert.deepEqual(videos.map((v) => v.id), ['vid1']);
    assert.equal(await yt.getLiveChatId('vid1', 'key'), 'chat-1');
    await yt.fetchLiveChatMessages('chat-1', null, 'token');
    await yt.sendYoutubeChatMessage('chat-1', 'hello', 'token');

    assert.equal(calls.length, 4);
    for (const call of calls) assert.ok(call.signal instanceof AbortSignal, call.url);
  });

  test('a chat message that times out is logged, not thrown at a caller that is not waiting for it', async () => {
    const yt = freshYoutube();
    global.fetch = async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };
    const logged = [];
    console.error = (...args) => logged.push(args.join(' '));
    await yt.sendYoutubeChatMessage('chat-1', 'hello', 'token');
    assert.ok(logged.some((line) => /Failed to send chat message.*timeout/.test(line)), logged.join('\n'));
  });
});

describe('the bot token', () => {
  const answer = { access_token: 'fresh-bot-token', expires_in: 3599 };
  const logged = [];

  beforeEach(() => {
    configStub.youtube.botRefreshToken = 'refresh-secret';
    logged.length = 0;
    console.error = (...args) => logged.push(args.join(' '));
  });
  afterEach(() => {
    delete configStub.youtube.botRefreshToken;
  });

  test('is exchanged for an access token with its expiry, a minute early', async () => {
    const yt = freshYoutube();
    stubResponses(() => ({ body: answer }));
    const before = Date.now();
    const token = await yt.requestYoutubeBotToken();
    assert.equal(token.accessToken, 'fresh-bot-token');
    assert.ok(token.expiresAt >= before + 3599_000 - 60_000 && token.expiresAt <= Date.now() + 3599_000 - 60_000);

    assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');
    assert.equal(calls[0].method, 'POST');
    assert.ok(calls[0].signal instanceof AbortSignal, 'with a timeout');
    const sent = new URLSearchParams(String(calls[0].body));
    assert.equal(sent.get('grant_type'), 'refresh_token');
    assert.equal(sent.get('refresh_token'), 'refresh-secret');
    assert.equal(await yt.refreshYoutubeBotToken(), 'fresh-bot-token', 'the older helper still gives just the token');
  });

  test('when YouTube chat is not set up there is nothing to ask and nothing to say', async () => {
    const yt = freshYoutube();
    delete configStub.youtube.botRefreshToken;
    stubResponses(() => ({ body: answer }));
    assert.equal(await yt.requestYoutubeBotToken(), null);
    assert.equal(await yt.refreshYoutubeBotToken(), null);
    assert.equal(calls.length, 0);
    assert.deepEqual(logged, []);
  });

  test('a refused refresh token is said plainly: what Google answered, and what to do about it, without any secret', async () => {
    const yt = freshYoutube();
    stubResponses(() => ({ status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }));
    assert.equal(await yt.requestYoutubeBotToken(), null);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /Bot token refresh failed \(400\): invalid_grant: Token has been expired or revoked\. - the refresh token was revoked or has expired; create a new YOUTUBE_BOT_REFRESH_TOKEN/);
    assert.ok(!logged[0].includes('refresh-secret') && !logged[0].includes('client-secret'));
  });

  test('a network failure or a timeout gives null and a log line, never an exception', async () => {
    const yt = freshYoutube();
    global.fetch = async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };
    assert.equal(await yt.requestYoutubeBotToken(), null);
    assert.match(logged[0], /Bot token refresh failed: The operation was aborted due to timeout/);
  });

  test('an answer without an access token is a failure too', async () => {
    const yt = freshYoutube();
    stubResponses(() => ({ body: { expires_in: 3599 } }));
    assert.equal(await yt.requestYoutubeBotToken(), null);
    assert.match(logged[0], /holds no access token/);
  });

  test('the same failure is logged once in ten minutes, not on every attempt, and again when it changes', async () => {
    const yt = freshYoutube();
    stubResponses(() => ({ status: 400, body: { error: 'invalid_grant' } }));
    for (let i = 0; i < 5; i++) await yt.requestYoutubeBotToken();
    assert.equal(logged.length, 1, 'five attempts, one line');

    stubResponses(() => ({ status: 503, body: {} }));
    await yt.requestYoutubeBotToken();
    assert.equal(logged.length, 2, 'a different failure is a new line');
  });
});
