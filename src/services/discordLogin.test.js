'use strict';

// The Discord login and its retries (services/discordLogin.js), with node:test's
// mocked timers and a fake client whose login fails as told: a failure is tried
// again after 30 s, then 60 s, 120 s ... up to every 10 minutes, a refused token
// is not tried again, and stop() cancels a retry that is waiting.

const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { startDiscordLogin, retryDelayMs, MAX_RETRY_MS } = require('./discordLogin');

const S = 1000;
// Lets the promise callbacks of a login attempt run (setImmediate is not mocked).
const settle = () => new Promise((resolve) => setImmediate(resolve));

// A client whose login answers with the next item of `outcomes` (an Error
// rejects, anything else resolves), then keeps answering with the last one.
function fakeClient(outcomes) {
  const client = {
    calls: 0,
    login(token) {
      client.calls += 1;
      client.lastToken = token;
      const outcome = outcomes[Math.min(client.calls, outcomes.length) - 1];
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    },
  };
  return client;
}

const networkError = () => new Error('getaddrinfo ENOTFOUND discord.com');
const refused = (code = 'TokenInvalid') => Object.assign(new Error('An invalid token was provided.'), { code });

let logs;
const log = { log: (m) => logs.push(['log', m]), error: (m) => logs.push(['error', m]) };

beforeEach(() => {
  logs = [];
  mock.timers.enable({ apis: ['setTimeout'] });
});
afterEach(() => mock.timers.reset());

describe('retryDelayMs', () => {
  test('waits 30 s, then twice as long each time, never more than 10 minutes', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 20].map((n) => retryDelayMs(n) / S), [30, 60, 120, 240, 480, 600, 600, 600]);
    assert.equal(MAX_RETRY_MS, 10 * 60 * S);
  });
});

describe('startDiscordLogin', () => {
  test('logs in at once, and does nothing more when that works', async () => {
    const client = fakeClient(['token']);
    const login = startDiscordLogin({ client, token: 'synthetic-token', log });
    await settle();
    assert.equal(client.calls, 1);
    assert.equal(client.lastToken, 'synthetic-token');
    assert.equal(login.retryPending, false);
    assert.deepEqual(logs, []);
  });

  test('a failed login is tried again after 30 s, 60 s, 120 s ..., and stops retrying once it works', async () => {
    const client = fakeClient([networkError(), networkError(), networkError(), 'token']);
    const login = startDiscordLogin({ client, token: 't', log });
    await settle();
    assert.equal(client.calls, 1);
    assert.equal(login.retryPending, true);
    assert.match(logs[0][1], /Login failed \(attempt 1\): getaddrinfo ENOTFOUND discord\.com\. Trying again in 30 s; the site keeps running/);

    for (const [waitSeconds, callsAfter] of [[30, 2], [60, 3], [120, 4]]) {
      mock.timers.tick(waitSeconds * S - 1);
      await settle();
      assert.equal(client.calls, callsAfter - 1, `not before ${waitSeconds} s`);
      mock.timers.tick(1);
      await settle();
      assert.equal(client.calls, callsAfter, `after ${waitSeconds} s`);
    }
    assert.equal(login.retryPending, false, 'the fourth try worked');
    assert.match(logs.at(-1)[1], /Logged in after 3 failed attempt\(s\)/);
    mock.timers.tick(60 * 60 * S);
    await settle();
    assert.equal(client.calls, 4, 'nothing more after that');
  });

  test('retries keep going, every 10 minutes at most, for as long as it fails', async () => {
    const client = fakeClient([networkError()]);
    startDiscordLogin({ client, token: 't', log });
    await settle();
    let elapsed = 0;
    for (const seconds of [30, 60, 120, 240, 480, 600, 600, 600]) {
      mock.timers.tick(seconds * S);
      elapsed += seconds;
      await settle();
    }
    assert.equal(client.calls, 9, `nine tries in ${elapsed} s`);
    assert.match(logs.at(-1)[1], /attempt 9\).*Trying again in 600 s/);
  });

  for (const code of ['TokenInvalid', 'DisallowedIntents']) {
    test(`a login Discord refuses for good (${code}) is logged loudly and not tried again, and nothing exits`, async () => {
      const exit = mock.method(process, 'exit', () => { throw new Error('process.exit must not be called'); });
      try {
        const client = fakeClient([refused(code)]);
        const login = startDiscordLogin({ client, token: 't', log });
        await settle();
        assert.equal(login.retryPending, false);
        assert.equal(logs.length, 1);
        assert.equal(logs[0][0], 'error');
        assert.match(logs[0][1], /LOGIN REFUSED: An invalid token was provided\. The bot will not try again: fix DISCORD_TOKEN/);
        assert.match(logs[0][1], /website, overlays and the Twitch chat bot keep running/);
        mock.timers.tick(60 * 60 * S);
        await settle();
        assert.equal(client.calls, 1);
        assert.equal(exit.mock.callCount(), 0);
      } finally {
        exit.mock.restore();
      }
    });
  }

  test('a refused token after network failures also stops the retries', async () => {
    const client = fakeClient([networkError(), refused()]);
    const login = startDiscordLogin({ client, token: 't', log });
    await settle();
    mock.timers.tick(30 * S);
    await settle();
    assert.equal(client.calls, 2);
    assert.equal(login.retryPending, false);
    mock.timers.tick(60 * 60 * S);
    await settle();
    assert.equal(client.calls, 2);
  });

  test('stop() (the graceful shutdown) cancels a retry that is waiting', async () => {
    const client = fakeClient([networkError()]);
    const login = startDiscordLogin({ client, token: 't', log });
    await settle();
    assert.equal(login.retryPending, true);
    login.stop();
    assert.equal(login.retryPending, false);
    mock.timers.tick(60 * 60 * S);
    await settle();
    assert.equal(client.calls, 1, 'no try after the shutdown');
  });

  test('a login that fails after stop() (the shutdown destroyed the client) schedules nothing', async () => {
    let fail;
    const client = { calls: 0, login() { client.calls += 1; return new Promise((resolve, reject) => { fail = reject; }); } };
    const login = startDiscordLogin({ client, token: 't', log });
    login.stop();
    fail(networkError());
    await settle();
    assert.equal(login.retryPending, false);
    assert.deepEqual(logs, []);
  });
});
