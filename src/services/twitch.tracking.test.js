'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

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

// src/config.js exits the process without the real env, so it is stubbed with the db.
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

const realFetch = global.fetch;
let calls; // { url, auth }

function reply(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body || {},
    text: async () => JSON.stringify(body || {}),
  };
}

// handler(call, n) -> a reply() or throws; the refresh endpoint is answered by `refresh` (default: a new token).
function stubFetch(handler, refresh) {
  calls = [];
  global.fetch = async (url, opts = {}) => {
    const call = { url: String(url), auth: opts.headers && opts.headers.Authorization };
    calls.push(call);
    if (call.url.startsWith('https://id.twitch.tv/oauth2/token')) {
      return refresh ? refresh() : reply(200, { access_token: 'new-token', refresh_token: 'new-refresh', expires_in: 3600 });
    }
    return handler(call, calls.filter((c) => !c.url.startsWith('https://id.twitch.tv')).length);
  };
}

function streamer(overrides) {
  return {
    id: 7,
    twitch_user_id: '555',
    broadcaster_access_token: 'old-token',
    broadcaster_refresh_token: 'old-refresh',
    broadcaster_token_expires_at: null,
    broadcaster_scopes: 'moderator:read:followers channel:read:subscriptions bits:read',
    ...overrides,
  };
}

const helix = () => calls.filter((c) => c.url.startsWith('https://api.twitch.tv'));

beforeEach(() => {
  _savedTokens = null;
  _clearedScopes = [];
});
afterEach(() => {
  global.fetch = realFetch;
});

describe('followerTotal / subscriberTotal', () => {
  test('followerTotal reads total from a one-entry page with the broadcaster token', async () => {
    stubFetch(() => reply(200, { total: 1234, data: [] }));
    assert.equal(await twitch.followerTotal(streamer()), 1234);
    const [call] = helix();
    assert.match(call.url, /\/helix\/channels\/followers\?/);
    assert.match(call.url, /broadcaster_id=555/);
    assert.match(call.url, /first=1(&|$)/);
    assert.equal(call.auth, 'Bearer old-token');
  });

  test('subscriberTotal reads total', async () => {
    stubFetch(() => reply(200, { total: 42, data: [] }));
    assert.equal(await twitch.subscriberTotal(streamer()), 42);
    assert.match(helix()[0].url, /\/helix\/subscriptions\?/);
  });

  test('a missing total reads as 0', async () => {
    stubFetch(() => reply(200, { data: [] }));
    assert.equal(await twitch.followerTotal(streamer()), 0);
  });

  test('an expired token is refreshed first, once, and the call uses the new token', async () => {
    stubFetch(() => reply(200, { total: 5 }));
    const s = streamer({ broadcaster_token_expires_at: Date.now() - 1000 });
    assert.equal(await twitch.followerTotal(s), 5);
    assert.equal(calls.filter((c) => c.url.startsWith('https://id.twitch.tv')).length, 1);
    assert.equal(helix().length, 1);
    assert.equal(helix()[0].auth, 'Bearer new-token');
    assert.equal(_savedTokens.accessToken, 'new-token');
  });

  test('a 401 refreshes once and retries the call', async () => {
    stubFetch((call) => (call.auth === 'Bearer old-token' ? reply(401) : reply(200, { total: 9 })));
    assert.equal(await twitch.subscriberTotal(streamer()), 9);
    assert.equal(calls.filter((c) => c.url.startsWith('https://id.twitch.tv')).length, 1);
    assert.equal(helix().length, 2);
    assert.equal(helix()[1].auth, 'Bearer new-token');
  });

  test('a 401 that survives the refresh is needs_reconnect, with one refresh only', async () => {
    stubFetch(() => reply(401));
    await assert.rejects(() => twitch.followerTotal(streamer()), { code: 'needs_reconnect' });
    assert.equal(calls.filter((c) => c.url.startsWith('https://id.twitch.tv')).length, 1);
  });

  test('a refresh token Twitch refuses is needs_reconnect and clears the scopes', async () => {
    stubFetch(() => reply(401), () => reply(400, { message: 'Invalid refresh token' }));
    await assert.rejects(() => twitch.followerTotal(streamer()), { code: 'needs_reconnect' });
    assert.deepEqual(_clearedScopes, [7]);
  });

  test('a refresh that fails otherwise is twitch_failed and keeps the scopes', async () => {
    stubFetch(() => reply(401), () => reply(503));
    await assert.rejects(() => twitch.followerTotal(streamer()), { code: 'twitch_failed' });
    assert.deepEqual(_clearedScopes, []);
  });

  test('a missing moderator:read:followers is needs_reconnect without calling Twitch', async () => {
    stubFetch(() => reply(200, { total: 1 }));
    const s = streamer({ broadcaster_scopes: 'channel:read:subscriptions' });
    await assert.rejects(() => twitch.followerTotal(s), { code: 'needs_reconnect' });
    assert.equal(calls.length, 0);
  });

  test('a missing channel:read:subscriptions is needs_reconnect without calling Twitch', async () => {
    stubFetch(() => reply(200, { total: 1 }));
    const s = streamer({ broadcaster_scopes: 'moderator:read:followers' });
    await assert.rejects(() => twitch.subscriberTotal(s), { code: 'needs_reconnect' });
    assert.equal(calls.length, 0);
  });

  test('no broadcaster token, or no linked Twitch channel, is needs_reconnect', async () => {
    stubFetch(() => reply(200, { total: 1 }));
    await assert.rejects(() => twitch.followerTotal(streamer({ broadcaster_access_token: null })), { code: 'needs_reconnect' });
    await assert.rejects(() => twitch.followerTotal(streamer({ twitch_user_id: null })), { code: 'needs_reconnect' });
    assert.equal(calls.length, 0);
  });

  test('subscriptions answering 403 or 400 is not_affiliate', async () => {
    stubFetch(() => reply(403, { message: 'not a partner' }));
    await assert.rejects(() => twitch.subscriberTotal(streamer()), { code: 'not_affiliate' });
    stubFetch(() => reply(400, { message: 'broadcaster does not have a subscription program' }));
    await assert.rejects(() => twitch.subscriberTotal(streamer()), { code: 'not_affiliate' });
  });

  test('a followers 403 is needs_reconnect, not not_affiliate', async () => {
    stubFetch(() => reply(403));
    await assert.rejects(() => twitch.followerTotal(streamer()), { code: 'needs_reconnect' });
  });

  test('429, 5xx, a network error and a timeout are twitch_failed', async () => {
    stubFetch(() => reply(429));
    await assert.rejects(() => twitch.followerTotal(streamer()), { code: 'twitch_failed' });
    stubFetch(() => reply(503));
    await assert.rejects(() => twitch.subscriberTotal(streamer()), { code: 'twitch_failed' });
    stubFetch(() => { throw new TypeError('fetch failed'); });
    await assert.rejects(() => twitch.followerTotal(streamer()), { code: 'twitch_failed' });
    stubFetch(() => { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; });
    await assert.rejects(() => twitch.subscriberTotal(streamer()), { code: 'twitch_failed' });
  });
});

describe('followersSince', () => {
  const follow = (n, at) => ({ user_id: String(n), user_login: `user${n}`, followed_at: at });

  test('stops at the first follower older than since and is complete', async () => {
    stubFetch(() => reply(200, {
      total: 10,
      data: [follow(1, '2026-10-16T10:00:00Z'), follow(2, '2026-10-15T10:00:00Z'), follow(3, '2026-10-01T10:00:00Z'), follow(4, '2026-09-01T10:00:00Z')],
      pagination: { cursor: 'next' },
    }));
    const out = await twitch.followersSince(streamer(), '2026-10-10T00:00:00Z');
    assert.deepEqual(out, {
      followers: [
        { userId: '1', login: 'user1', followedAt: '2026-10-16T10:00:00Z' },
        { userId: '2', login: 'user2', followedAt: '2026-10-15T10:00:00Z' },
      ],
      complete: true,
    });
    assert.equal(helix().length, 1, 'no page after the one that held an older follower');
  });

  test('a follow exactly at since counts', async () => {
    stubFetch(() => reply(200, { data: [follow(1, '2026-10-10T00:00:00Z')] }));
    const out = await twitch.followersSince(streamer(), '2026-10-10T00:00:00Z');
    assert.equal(out.followers.length, 1);
  });

  test('follows the cursor across pages and is complete when the list ends', async () => {
    stubFetch((call, n) => (n === 1
      ? reply(200, { data: [follow(1, '2026-10-16T10:00:00Z')], pagination: { cursor: 'c1' } }
      )
      : reply(200, { data: [follow(2, '2026-10-15T10:00:00Z')], pagination: {} })));
    const out = await twitch.followersSince(streamer(), '2026-10-01T00:00:00Z');
    assert.equal(out.followers.length, 2);
    assert.equal(out.complete, true);
    assert.match(helix()[0].url, /first=100/);
    assert.doesNotMatch(helix()[0].url, /after=/);
    assert.match(helix()[1].url, /after=c1/);
  });

  test('reports complete:false when the page cap stops it with more to read', async () => {
    stubFetch((call, n) => reply(200, { data: [follow(n, '2026-10-16T10:00:00Z')], pagination: { cursor: `c${n}` } }));
    const out = await twitch.followersSince(streamer(), '2026-10-01T00:00:00Z', 3);
    assert.equal(helix().length, 3);
    assert.equal(out.followers.length, 3);
    assert.equal(out.complete, false);
  });

  test('a list that ends exactly at the cap is complete', async () => {
    stubFetch((call, n) => reply(200, { data: [follow(n, '2026-10-16T10:00:00Z')], pagination: n === 2 ? {} : { cursor: 'c' } }));
    const out = await twitch.followersSince(streamer(), '2026-10-01T00:00:00Z', 2);
    assert.equal(out.complete, true);
  });

  test('refreshes an expired token once across pages', async () => {
    stubFetch((call, n) => reply(200, { data: [follow(n, '2026-10-16T10:00:00Z')], pagination: n < 3 ? { cursor: 'c' } : {} }));
    const out = await twitch.followersSince(streamer({ broadcaster_token_expires_at: Date.now() - 1 }), '2026-10-01T00:00:00Z');
    assert.equal(out.followers.length, 3);
    assert.equal(calls.filter((c) => c.url.startsWith('https://id.twitch.tv')).length, 1);
    assert.ok(helix().every((c) => c.auth === 'Bearer new-token'));
  });

  test('a missing scope is needs_reconnect without calling Twitch', async () => {
    stubFetch(() => reply(200, { data: [] }));
    await assert.rejects(() => twitch.followersSince(streamer({ broadcaster_scopes: '' }), '2026-10-01T00:00:00Z'), { code: 'needs_reconnect' });
    assert.equal(calls.length, 0);
  });

  test('a failure on a later page rejects with twitch_failed', async () => {
    stubFetch((call, n) => (n === 1 ? reply(200, { data: [follow(1, '2026-10-16T10:00:00Z')], pagination: { cursor: 'c' } }) : reply(500)));
    await assert.rejects(() => twitch.followersSince(streamer(), '2026-10-01T00:00:00Z'), { code: 'twitch_failed' });
  });

  test('a start time that is not a date throws', async () => {
    stubFetch(() => reply(200, { data: [] }));
    await assert.rejects(() => twitch.followersSince(streamer(), 'not a date'), /valid start time/);
  });
});
