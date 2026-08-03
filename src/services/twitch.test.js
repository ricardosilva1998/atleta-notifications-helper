'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Minimal DB stub ──────────────────────────────────────────────────

let _savedTokens = null;

const dbStub = {
  updateStreamerBroadcasterTokens(streamerId, accessToken, refreshToken, expiresAt) {
    _savedTokens = { streamerId, accessToken, refreshToken, expiresAt };
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
