'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Minimal DB stub ──────────────────────────────────────────────────

let _savedTokens = null;
let _clearedScopes = [];

const dbStub = {
  updateStreamerBroadcasterTokens(streamerId, accessToken, refreshToken, expiresAt) {
    _savedTokens = { streamerId, accessToken, refreshToken, expiresAt };
  },
  clearStreamerBroadcasterScopes(streamerId) {
    _clearedScopes.push(streamerId);
  },
};

// ── Module isolation via _load hook ──────────────────────────────────

// src/config.js exits the process when the real env vars are absent, so it is
// stubbed here alongside the db — this keeps the test hermetic and runnable
// without a .env file.
const configStub = {
  twitch: { clientId: 'test-client-id', clientSecret: 'test-client-secret' },
};

const Module = require('module');
const origLoad = Module._load.bind(Module);
Module._load = function (request, parent, isMain) {
  const fromTwitchService = parent && parent.filename && parent.filename.includes('services/twitch.js');
  if (request === '../db' && fromTwitchService) return dbStub;
  if (request === '../config' && fromTwitchService) return configStub;
  return origLoad(request, parent, isMain);
};

delete require.cache[require.resolve('./twitch')];
const twitch = require('./twitch');

// ── fetch stubbing ───────────────────────────────────────────────────

const realFetch = global.fetch;

function stubFetch(status, bodyObj) {
  global.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => bodyObj || {},
    text: async () => JSON.stringify(bodyObj || {}),
  });
}

// A streamer row with a refresh token present. Values are synthetic.
function fakeStreamer() {
  return {
    id: 1,
    broadcaster_access_token: 'fake-access-token',
    broadcaster_refresh_token: 'fake-refresh-token',
  };
}

describe('refreshBroadcasterToken error classification', () => {
  beforeEach(() => {
    _savedTokens = null;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  test('400 is terminal — marks INVALID_REFRESH_TOKEN', async () => {
    stubFetch(400, { status: 400, message: 'Invalid refresh token' });
    await assert.rejects(
      () => twitch.refreshBroadcasterToken(fakeStreamer()),
      (err) => {
        assert.equal(err.code, 'INVALID_REFRESH_TOKEN');
        assert.match(err.message, /Token refresh failed: 400/);
        return true;
      }
    );
  });

  test('a missing refresh token is terminal without any network call', async () => {
    let called = false;
    global.fetch = async () => { called = true; throw new Error('should not be called'); };
    const streamer = fakeStreamer();
    streamer.broadcaster_refresh_token = null;

    await assert.rejects(
      () => twitch.refreshBroadcasterToken(streamer),
      (err) => {
        assert.equal(err.code, 'INVALID_REFRESH_TOKEN');
        return true;
      }
    );
    assert.equal(called, false, 'must not hit the token endpoint with no refresh token');
  });

  test('500 stays transient — no terminal code, so callers keep retrying', async () => {
    stubFetch(500, {});
    await assert.rejects(
      () => twitch.refreshBroadcasterToken(fakeStreamer()),
      (err) => {
        assert.equal(err.code, undefined);
        assert.match(err.message, /Token refresh failed: 500/);
        return true;
      }
    );
  });

  test('401 stays transient — only 400 means a dead grant', async () => {
    stubFetch(401, {});
    await assert.rejects(
      () => twitch.refreshBroadcasterToken(fakeStreamer()),
      (err) => {
        assert.equal(err.code, undefined);
        return true;
      }
    );
  });

  test('429 stays transient — rate limiting must not clear scopes', async () => {
    stubFetch(429, {});
    await assert.rejects(
      () => twitch.refreshBroadcasterToken(fakeStreamer()),
      (err) => {
        assert.equal(err.code, undefined);
        return true;
      }
    );
  });

  test('success returns the new access token and persists both tokens', async () => {
    stubFetch(200, {
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600,
    });

    const before = Date.now();
    const token = await twitch.refreshBroadcasterToken(fakeStreamer());

    assert.equal(token, 'new-access-token');
    assert.ok(_savedTokens, 'tokens should be persisted');
    assert.equal(_savedTokens.streamerId, 1);
    assert.equal(_savedTokens.accessToken, 'new-access-token');
    assert.equal(_savedTokens.refreshToken, 'new-refresh-token');
    // expiry is epoch ms, one hour out minus the 60s safety margin
    assert.ok(_savedTokens.expiresAt >= before + 3600_000 - 60_000);
    assert.ok(_savedTokens.expiresAt <= Date.now() + 3600_000 - 60_000);
  });
});

// ── apiCall: 401 handling (exercised through getStream) ───────────────

describe('apiCall retries a 401 only once', () => {
  const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
  let calls;
  let helixSignals;

  // A fresh module per test, so the cached app token starts empty and the
  // first call always authenticates once before reaching Helix.
  function freshTwitch() {
    delete require.cache[require.resolve('./twitch')];
    return require('./twitch');
  }

  // The token endpoint always succeeds; Helix answers with `statuses` in
  // order (the last one repeats). A runaway loop fails fast instead of hanging.
  function stubTwitch(statuses) {
    calls = [];
    helixSignals = [];
    let helixCalls = 0;
    global.fetch = async (url, opts = {}) => {
      if (calls.length >= 20) throw new Error('runaway retry loop');
      if (String(url) === TOKEN_URL) {
        calls.push('token');
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: `app-token-${calls.length}`, expires_in: 3600 }),
          text: async () => '',
        };
      }
      const status = statuses[Math.min(helixCalls++, statuses.length - 1)];
      calls.push(`helix:${status}`);
      helixSignals.push(opts.signal);
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => ({ data: [{ id: '42', user_login: 'somestreamer' }] }),
        text: async () => (status === 401 ? 'Invalid OAuth token' : ''),
      };
    };
  }

  afterEach(() => {
    global.fetch = realFetch;
  });

  test('401 then 200 succeeds after exactly one re-auth', async () => {
    const tw = freshTwitch();
    stubTwitch([401, 200]);
    const stream = await tw.getStream('somestreamer');
    assert.deepEqual(stream, { id: '42', user_login: 'somestreamer' });
    assert.deepEqual(calls, ['token', 'helix:401', 'token', 'helix:200']);
    assert.ok(
      helixSignals.every((s) => s instanceof AbortSignal),
      'every Helix request carries a timeout signal'
    );
  });

  test('401 then 401 throws after exactly one retry', async () => {
    const tw = freshTwitch();
    stubTwitch([401, 401]);
    await assert.rejects(() => tw.getStream('somestreamer'), /Twitch API error: 401/);
    assert.deepEqual(calls, ['token', 'helix:401', 'token', 'helix:401']);
  });
});

// ── An optional deadline for the calls a page waits on (N23) ──────────

describe('the optional signal of the Twitch getters', () => {
  const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
  let helix; // [{ url, signal }]

  // A fresh module per test, so the cached app token starts empty.
  function freshTwitch() {
    delete require.cache[require.resolve('./twitch')];
    return require('./twitch');
  }

  // Answers the token request and Helix with `body`. `hang` leaves a request
  // pending until its own signal aborts, like fetch does.
  function stubTwitch({ body = { data: [{ id: '42' }] }, hangHelix = false, hangToken = false } = {}) {
    helix = [];
    const waitForAbort = (opts) => new Promise((_resolve, reject) => {
      if (opts.signal && opts.signal.aborted) return reject(opts.signal.reason); // like fetch
      if (opts.signal) opts.signal.addEventListener('abort', () => reject(opts.signal.reason), { once: true });
    });
    global.fetch = async (url, opts = {}) => {
      if (String(url) === TOKEN_URL) {
        if (hangToken) return new Promise(() => {}); // never answers, and has no signal of its own
        return { ok: true, status: 200, json: async () => ({ access_token: 'app-token', expires_in: 3600 }), text: async () => '' };
      }
      helix.push({ url: String(url), signal: opts.signal });
      if (hangHelix) return waitForAbort(opts);
      return { ok: true, status: 200, json: async () => body, text: async () => '' };
    };
  }

  afterEach(() => {
    global.fetch = realFetch;
  });

  test('the caller\'s signal is the one sent to Helix, for every getter that takes it', async () => {
    const tw = freshTwitch();
    stubTwitch({ body: { data: [{ id: '42', login: 'someone', display_name: 'Someone', profile_image_url: 'https://img.test/a.png' }] } });
    const signal = AbortSignal.timeout(5000);

    await tw.getStream('someone', { signal });
    await tw.getUserId('someone', { signal });
    await tw.getUserProfile('someone', { signal });
    await tw.getVideos('42', undefined, { signal });

    assert.equal(helix.length, 4);
    for (const call of helix) assert.equal(call.signal, signal, call.url);
  });

  test('without a signal every call still has its own default timeout', async () => {
    const tw = freshTwitch();
    stubTwitch();
    await tw.getStream('someone');
    await tw.getUserId('someone', undefined);
    await tw.getVideos('42', '2026-01-01T00:00:00Z');
    for (const call of helix) {
      assert.ok(call.signal instanceof AbortSignal, call.url);
      assert.equal(call.signal.aborted, false);
    }
  });

  test('a slow Helix answer is cut at the caller\'s deadline', async () => {
    const tw = freshTwitch();
    stubTwitch({ hangHelix: true });
    const started = Date.now();
    await assert.rejects(() => tw.getStream('someone', { signal: AbortSignal.timeout(40) }), (err) => err.name === 'TimeoutError');
    assert.ok(Date.now() - started < 1000, 'it did not wait for the default 10 s');
  });

  test('one signal is one deadline for several calls: once it has passed, the next call is cut straight away', async () => {
    const tw = freshTwitch();
    stubTwitch({ hangHelix: true });
    const signal = AbortSignal.timeout(40);
    await assert.rejects(() => tw.getStream('someone', { signal }), (err) => err.name === 'TimeoutError');
    const before = helix.length;
    await assert.rejects(() => tw.getUserId('someone', { signal }), (err) => err.name === 'TimeoutError');
    assert.equal(helix.length, before + 1, 'Helix was asked, and the passed signal ended it at once');
  });

  test('the wait for a token request someone else started also ends at the deadline', async () => {
    const tw = freshTwitch();
    stubTwitch({ hangToken: true });
    const started = Date.now();
    await assert.rejects(() => tw.getStream('someone', { signal: AbortSignal.timeout(40) }), (err) => err.name === 'TimeoutError');
    assert.ok(Date.now() - started < 1000);
    assert.equal(helix.length, 0, 'Helix was never reached');
  });

  test('a signal that is already aborted fails without any request', async () => {
    const tw = freshTwitch();
    stubTwitch({ hangToken: true });
    const controller = new AbortController();
    controller.abort(new Error('page gave up'));
    await assert.rejects(() => tw.getStream('someone', { signal: controller.signal }), /page gave up/);
    assert.equal(helix.length, 0);
  });
});

// ── Follow checks use the streamer's own token (M10) ──────────────────

describe('getFollowAge', () => {
  const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
  const FOLLOWERS_URL = 'https://api.twitch.tv/helix/channels/followers?broadcaster_id=111&user_id=555';
  let calls;

  // A fresh module per test, so no token refresh is left over from another.
  function freshTwitch() {
    delete require.cache[require.resolve('./twitch')];
    return require('./twitch');
  }

  // Helix answers `answers` in order (the last one repeats): { status, follows }.
  // The token endpoint answers `refreshStatus`, with a fresh token on 200.
  function stubTwitch(answers, refreshStatus = 200) {
    calls = [];
    let helixCalls = 0;
    global.fetch = async (url, opts = {}) => {
      if (calls.length > 10) throw new Error('runaway retry loop');
      if (String(url) === TOKEN_URL) {
        calls.push({ to: 'token', signal: opts.signal });
        if (refreshStatus !== 200) return { ok: false, status: refreshStatus, json: async () => ({}), text: async () => '' };
        return { ok: true, status: 200, json: async () => ({ access_token: 'fresh-token', refresh_token: 'fresh-refresh', expires_in: 3600 }), text: async () => '' };
      }
      const answer = answers[Math.min(helixCalls++, answers.length - 1)];
      calls.push({ to: 'helix', url: String(url), auth: opts.headers && opts.headers.Authorization, clientId: opts.headers && opts.headers['Client-Id'], signal: opts.signal });
      return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => ({ data: answer.follows || [] }), text: async () => '' };
    };
  }

  // A synthetic streamer whose broadcaster token can read followers.
  const streamer = (overrides = {}) => ({
    id: 1,
    twitch_user_id: '111',
    broadcaster_access_token: 'broadcaster-token',
    broadcaster_refresh_token: 'refresh-token',
    broadcaster_token_expires_at: Date.now() + 3_600_000,
    broadcaster_scopes: 'channel:read:subscriptions moderator:read:followers bits:read',
    ...overrides,
  });

  beforeEach(() => {
    _savedTokens = null;
    _clearedScopes = [];
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  test('asks Twitch with the streamer\'s own broadcaster token, not the app token', async () => {
    const tw = freshTwitch();
    stubTwitch([{ status: 200, follows: [{ user_id: '555', followed_at: '2025-01-02T03:04:05Z' }] }]);
    assert.deepEqual(await tw.getFollowAge(streamer(), '555'), { following: true, followedAt: '2025-01-02T03:04:05Z' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, FOLLOWERS_URL);
    assert.equal(calls[0].auth, 'Bearer broadcaster-token');
    assert.equal(calls[0].clientId, 'test-client-id');
    assert.ok(calls[0].signal instanceof AbortSignal, 'the request has a timeout');
  });

  test('an empty answer means "not following"', async () => {
    const tw = freshTwitch();
    stubTwitch([{ status: 200, follows: [] }]);
    assert.deepEqual(await tw.getFollowAge(streamer(), '555'), { following: false, followedAt: null });
  });

  test('a 401 refreshes the token once and asks again with the new one', async () => {
    const tw = freshTwitch();
    stubTwitch([{ status: 401 }, { status: 200, follows: [{ followed_at: '2025-01-02T03:04:05Z' }] }]);
    assert.equal((await tw.getFollowAge(streamer(), '555')).following, true);
    assert.deepEqual(calls.map((c) => c.to), ['helix', 'token', 'helix']);
    assert.equal(calls[2].auth, 'Bearer fresh-token');
    assert.equal(_savedTokens.accessToken, 'fresh-token');
  });

  test('an expired token is refreshed before asking, and the refresh has a timeout', async () => {
    const tw = freshTwitch();
    stubTwitch([{ status: 200, follows: [] }]);
    await tw.getFollowAge(streamer({ broadcaster_token_expires_at: Date.now() - 1 }), '555');
    assert.deepEqual(calls.map((c) => c.to), ['token', 'helix']);
    assert.ok(calls[0].signal instanceof AbortSignal);
    assert.equal(calls[1].auth, 'Bearer fresh-token');
  });

  for (const status of [401, 403, 500]) {
    test(`Twitch answering ${status} is an error, never "not following"`, async () => {
      const tw = freshTwitch();
      stubTwitch([{ status }]);
      await assert.rejects(() => tw.getFollowAge(streamer(), '555'), new RegExp(`Followers API error: ${status}`));
      assert.equal(calls.filter((c) => c.to === 'token').length, status === 401 ? 1 : 0, 'only a 401 refreshes, once');
    });
  }

  test('without a token that can read followers, or without the ids, it is an error and Twitch is not asked', async () => {
    const tw = freshTwitch();
    stubTwitch([{ status: 200, follows: [] }]);
    for (const columns of [{ broadcaster_scopes: 'channel:read:subscriptions bits:read' }, { broadcaster_scopes: null }, { broadcaster_access_token: null }]) {
      await assert.rejects(() => tw.getFollowAge(streamer(columns), '555'), (err) => err.code === 'NO_FOLLOWER_ACCESS', JSON.stringify(columns));
    }
    await assert.rejects(() => tw.getFollowAge(streamer({ twitch_user_id: null }), '555'));
    await assert.rejects(() => tw.getFollowAge(streamer(), undefined));
    await assert.rejects(() => tw.getFollowAge(null, '555'));
    assert.equal(calls.length, 0);
  });

  test('a dead refresh token clears the scopes, so later checks stop at the scope test', async () => {
    const tw = freshTwitch();
    stubTwitch([{ status: 401 }], 400);
    const realWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      await assert.rejects(() => tw.getFollowAge(streamer(), '555'), (err) => err.code === 'INVALID_REFRESH_TOKEN');
    } finally {
      console.warn = realWarn;
    }
    assert.deepEqual(_clearedScopes, [1]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /streamer 1/);
  });

  test('checks that arrive together share one token refresh', async () => {
    const tw = freshTwitch();
    stubTwitch([{ status: 200, follows: [] }]);
    const expired = streamer({ broadcaster_token_expires_at: Date.now() - 1 });
    await Promise.all(['1', '2', '3'].map((userId) => tw.getFollowAge(expired, userId)));
    assert.equal(calls.filter((c) => c.to === 'token').length, 1);
    assert.equal(calls.filter((c) => c.to === 'helix').length, 3);
  });
});

// ── Batched live checks, and a timeout on what the pollers call (N12, M21) ──

describe('getStreams: one request for a batch of channels', () => {
  const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
  let requests; // Helix requests: { url, signal }

  // A fresh module per test, so the cached app token starts empty.
  function freshTwitch() {
    delete require.cache[require.resolve('./twitch')];
    return require('./twitch');
  }

  // Helix answers with `streams` (or `status` when it is not 200).
  function stubHelix({ streams = [], status = 200 } = {}) {
    requests = [];
    global.fetch = async (url, opts = {}) => {
      if (String(url) === TOKEN_URL) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'app-token', expires_in: 3600 }), text: async () => '' };
      }
      requests.push({ url: String(url), signal: opts.signal });
      return { ok: status === 200, status, json: async () => ({ data: streams }), text: async () => 'error body' };
    };
  }

  afterEach(() => {
    global.fetch = realFetch;
  });

  test('asks about all the logins in one request, with first=100 so no live channel is cut off', async () => {
    const tw = freshTwitch();
    stubHelix();
    await tw.getStreams(['alpha', 'bravo', 'charlie']);
    assert.equal(requests.length, 1);
    const url = new URL(requests[0].url);
    assert.equal(url.pathname, '/helix/streams');
    assert.deepEqual(url.searchParams.getAll('user_login'), ['alpha', 'bravo', 'charlie']);
    assert.equal(url.searchParams.get('first'), '100', 'Helix returns 20 by default');
    assert.ok(requests[0].signal instanceof AbortSignal, 'the request has a timeout');
  });

  test('answers with the live channels by lowercase login; offline channels have no entry', async () => {
    const tw = freshTwitch();
    stubHelix({ streams: [
      { id: '1', user_login: 'alpha', user_name: 'Alpha', title: 'one' },
      { id: '2', user_login: 'Charlie', user_name: 'Charlie', title: 'three' },
    ] });
    const streams = await tw.getStreams(['alpha', 'bravo', 'charlie']);
    assert.deepEqual([...streams.keys()].sort(), ['alpha', 'charlie']);
    assert.equal(streams.get('alpha').title, 'one');
    assert.equal(streams.get('charlie').id, '2');
    assert.equal(streams.has('bravo'), false);
  });

  test('100 logins are fine; 101 are refused before any request, because Helix takes 100', async () => {
    const tw = freshTwitch();
    stubHelix();
    const logins = (n) => Array.from({ length: n }, (_, i) => `login_${i}`);
    await tw.getStreams(logins(100));
    assert.equal(requests.length, 1);
    await assert.rejects(() => tw.getStreams(logins(101)), RangeError);
    assert.equal(requests.length, 1, 'no request for the oversized batch');
    assert.equal(tw.STREAMS_PER_REQUEST, 100);
  });

  test('no logins means no request', async () => {
    const tw = freshTwitch();
    stubHelix();
    assert.equal((await tw.getStreams([])).size, 0);
    assert.equal(requests.length, 0);
  });

  test('a failed request throws: it is never an empty map that reads as "everyone is offline"', async () => {
    const tw = freshTwitch();
    stubHelix({ status: 500 });
    await assert.rejects(() => tw.getStreams(['alpha']), /Twitch API error: 500/);
  });
});

describe('the pollers\' Twitch calls have a timeout', () => {
  const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
  let seen; // [{ url, signal }]

  function freshTwitch() {
    delete require.cache[require.resolve('./twitch')];
    return require('./twitch');
  }

  function stub(body = {}) {
    seen = [];
    global.fetch = async (url, opts = {}) => {
      seen.push({ url: String(url), signal: opts.signal });
      if (String(url) === TOKEN_URL) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'app-token', expires_in: 3600 }), text: async () => '' };
      }
      return { ok: true, status: 200, json: async () => body, text: async () => '' };
    };
  }

  afterEach(() => {
    global.fetch = realFetch;
  });

  test('the app token request (cold start, and every 401) is cut after a while instead of holding every poller', async () => {
    const tw = freshTwitch();
    stub({ data: [] });
    await tw.getStream('someone');
    const tokenRequest = seen.find((call) => call.url === TOKEN_URL);
    assert.ok(tokenRequest, 'the token was requested');
    assert.ok(tokenRequest.signal instanceof AbortSignal);
    assert.equal(tokenRequest.signal.aborted, false);
  });

  test('a token request that never answers fails instead of hanging', async () => {
    const tw = freshTwitch();
    global.fetch = (url, opts = {}) => new Promise((_resolve, reject) => {
      if (opts.signal) opts.signal.addEventListener('abort', () => reject(opts.signal.reason), { once: true });
    });
    // The default timeout is 10 s: mock the deadline instead of waiting for it.
    const realTimeout = AbortSignal.timeout;
    AbortSignal.timeout = () => realTimeout.call(AbortSignal, 30);
    try {
      await assert.rejects(() => tw.getStream('someone'), (err) => err.name === 'TimeoutError');
    } finally {
      AbortSignal.timeout = realTimeout;
    }
  });

  test('the follower count, the subscriber list and the subscriber total all have a timeout', async () => {
    const tw = freshTwitch();
    stub({ data: [], total: 7, pagination: {} });
    await tw.getFollowerCount('42', 'broadcaster-token');
    await tw.getSubscribers('42', 'broadcaster-token');
    await tw.getSubscriberCount('42', 'broadcaster-token');
    assert.equal(seen.length, 3);
    for (const call of seen) assert.ok(call.signal instanceof AbortSignal, call.url);
  });

  test('getSubscriberCount asks for one entry and reads the total, so it never walks the whole list', async () => {
    const tw = freshTwitch();
    stub({ data: [{ user_id: '1' }], total: 1234, pagination: { cursor: 'more' } });
    assert.equal(await tw.getSubscriberCount('42', 'broadcaster-token'), 1234);
    assert.equal(seen.length, 1, 'one request, whatever the size of the list');
    const url = new URL(seen[0].url);
    assert.equal(url.pathname, '/helix/subscriptions');
    assert.equal(url.searchParams.get('broadcaster_id'), '42');
    assert.equal(url.searchParams.get('first'), '1');
  });

  test('getSubscriberCount: no total means 0, and a rejected request is an error', async () => {
    const tw = freshTwitch();
    stub({ data: [] });
    assert.equal(await tw.getSubscriberCount('42', 'broadcaster-token'), 0);

    global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => 'Unauthorized' });
    await assert.rejects(() => tw.getSubscriberCount('42', 'stale-token'), /Subscriptions API error: 401/);
  });
});
