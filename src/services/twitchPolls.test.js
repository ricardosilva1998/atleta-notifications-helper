'use strict';

// The polls and predictions Helix client (services/twitchPolls.js) with a fake Helix in place of fetch: the bodies it
// sends, one token refresh on a 401 (only a grant Twitch no longer accepts asks for a reconnect), and Twitch's refusals
// (as its API reference words them) as the card's codes. Its config, database and token refresh are stubs: nothing
// leaves the machine. All ids and tokens are synthetic.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const FILE = path.join(__dirname, 'twitchPolls.js');
const affiliateFlags = [];
const refreshes = [];
let refreshFailure = null; // what the shared token refresh throws, or null while it works
const stubs = {
  '../config': { twitch: { clientId: 'synthetic-client-id' } },
  '../db': { updateStreamerCpSync: (id, fields) => affiliateFlags.push([id, fields]) },
  './twitch': {
    refreshBroadcasterTokenShared: async (streamer) => {
      refreshes.push(streamer.id);
      if (refreshFailure) throw refreshFailure;
      return 'fresh-token';
    },
    hasPollsScope: (s) => /channel:manage:polls/.test(s.broadcaster_scopes || '') && /channel:manage:predictions/.test(s.broadcaster_scopes || ''),
  },
};

let polls;
let calls;
let answers; // what the fake Helix answers, in order: { status, body }, 'hang' or 'network'
const saved = {};

before(() => {
  saved.load = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === FILE && Object.hasOwn(stubs, request)) return stubs[request];
    return saved.load.call(this, request, parent, isMain);
  };
  delete require.cache[FILE];
  polls = require('./twitchPolls');
  Module._load = saved.load;
  saved.fetch = global.fetch;
});

after(() => { global.fetch = saved.fetch; });

beforeEach(() => {
  calls = [];
  answers = [];
  affiliateFlags.length = 0;
  refreshes.length = 0;
  refreshFailure = null;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), method: opts.method, body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers.Authorization, signal: opts.signal });
    const next = answers.shift() || { status: 200, body: { data: [] } };
    if (next === 'network') throw new TypeError('fetch failed');
    if (next === 'hang') {
      return new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(opts.signal.reason), { once: true }));
    }
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
  };
});

const streamer = (over = {}) => ({ id: 7, twitch_user_id: '9001', broadcaster_access_token: 'old-token', broadcaster_scopes: 'channel:manage:polls channel:manage:predictions', cp_affiliate_status: null, ...over });
const poll = { id: 'poll-1', title: 'Top 5?', status: 'ACTIVE', choices: [{ id: 'c1', title: 'Yes', votes: 0 }, { id: 'c2', title: 'No', votes: 0 }] };
const value = { kind: 'poll', title: 'Top 5?', choices: ['Yes', 'No'], durationSeconds: 60, pointsPerVote: null };
const refused = (status, message) => ({ status, body: { error: 'Bad Request', status, message } });
// What the shared refresh throws for a grant Twitch no longer accepts (twitch.js: the token endpoint answered 400).
const deadGrant = () => Object.assign(new Error('Token refresh failed: 400'), { code: 'INVALID_REFRESH_TOKEN' });
const code = async (promise) => { try { await promise; } catch (err) { return err.code; } return 'resolved'; };

describe('what is sent to Twitch', () => {
  test('a poll: its choices, its time and its channel-points voting; the answer is Twitch\'s poll', async () => {
    answers.push({ status: 200, body: { data: [poll] } });
    const created = await polls.createPoll(streamer(), { ...value, durationSeconds: 120, pointsPerVote: 250 });
    assert.deepEqual(created, poll);
    assert.equal(calls[0].url, 'https://api.twitch.tv/helix/polls');
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(calls[0].body, { broadcaster_id: '9001', title: 'Top 5?', choices: [{ title: 'Yes' }, { title: 'No' }], duration: 120, channel_points_voting_enabled: true, channel_points_per_vote: 250 });
    assert.equal(calls[0].auth, 'Bearer old-token');
    assert.ok(calls[0].signal instanceof AbortSignal, 'every request has a deadline');
  });

  test('a poll without channel points sends no voting fields', async () => {
    answers.push({ status: 200, body: { data: [poll] } });
    await polls.createPoll(streamer(), value);
    assert.equal('channel_points_voting_enabled' in calls[0].body, false);
  });

  test('a prediction, its lock, its winner and its cancel; ending a poll; the newest of each', async () => {
    answers.push({ status: 200, body: { data: [{ id: 'pred-1' }] } }, { status: 200, body: { data: [{ id: 'pred-1' }] } },
      { status: 200, body: { data: [{ id: 'pred-1' }] } }, { status: 200, body: { data: [{ id: 'pred-1' }] } },
      { status: 200, body: { data: [poll] } }, { status: 200, body: { data: [] } }, { status: 200, body: { data: [{ id: 'pred-1' }] } });
    await polls.createPrediction(streamer(), { kind: 'prediction', title: 'Clean lap?', choices: ['Clean', 'Chaos'], durationSeconds: 60, pointsPerVote: null });
    await polls.lockPrediction(streamer(), 'pred-1');
    await polls.resolvePrediction(streamer(), 'pred-1', 'out-1');
    await polls.cancelPrediction(streamer(), 'pred-1');
    await polls.endPoll(streamer(), 'poll-1');
    assert.equal(await polls.latestPoll(streamer()), null);
    assert.deepEqual(await polls.latestPrediction(streamer()), { id: 'pred-1' });
    assert.deepEqual(calls.map((c) => [c.method, c.url.replace('https://api.twitch.tv/helix', ''), c.body]), [
      ['POST', '/predictions', { broadcaster_id: '9001', title: 'Clean lap?', outcomes: [{ title: 'Clean' }, { title: 'Chaos' }], prediction_window: 60 }],
      ['PATCH', '/predictions', { broadcaster_id: '9001', id: 'pred-1', status: 'LOCKED' }],
      ['PATCH', '/predictions', { broadcaster_id: '9001', id: 'pred-1', status: 'RESOLVED', winning_outcome_id: 'out-1' }],
      ['PATCH', '/predictions', { broadcaster_id: '9001', id: 'pred-1', status: 'CANCELED' }],
      ['PATCH', '/polls', { broadcaster_id: '9001', id: 'poll-1', status: 'TERMINATED' }],
      ['GET', '/polls?broadcaster_id=9001&first=1', null],
      ['GET', '/predictions?broadcaster_id=9001&first=1', null],
    ]);
  });
});

describe('the broadcaster token', () => {
  test('a 401 refreshes the token once and tries again', async () => {
    answers.push({ status: 401, body: { message: 'Invalid OAuth token' } }, { status: 200, body: { data: [poll] } });
    assert.deepEqual(await polls.latestPoll(streamer()), poll);
    assert.deepEqual(refreshes, [7]);
    assert.deepEqual(calls.map((c) => c.auth), ['Bearer old-token', 'Bearer fresh-token']);
  });

  test('a second 401 (a missing permission), or a grant Twitch no longer accepts, asks for a reconnect', async () => {
    answers.push(refused(401, 'The user access token is missing the channel:manage:polls scope.'), refused(401, 'The user access token is missing the channel:manage:polls scope.'));
    assert.equal(await code(polls.createPoll(streamer(), value)), 'needs_reconnect');
    refreshFailure = deadGrant();
    answers.push({ status: 401, body: {} });
    assert.equal(await code(polls.latestPoll(streamer())), 'needs_reconnect');
  });

  test('a token refresh that fails for a moment (a 5xx or a 429, no answer, no network) is twitch_failed, not a reconnect', async () => {
    const failures = [
      new Error('Token refresh failed: 503'),
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'), // its code is a number, not Twitch's
      new TypeError('fetch failed'),
    ];
    for (const failure of failures) {
      refreshFailure = failure;
      answers.push({ status: 401, body: {} });
      assert.equal(await code(polls.latestPoll(streamer())), 'twitch_failed', failure.message);
    }
    assert.deepEqual(refreshes, [7, 7, 7]);
    assert.equal(calls.length, 3, 'nothing is sent again after a refresh that failed');
  });

  test('without both permissions (or a linked channel, or a token) nothing is sent', async () => {
    assert.equal(await code(polls.createPoll(streamer({ broadcaster_scopes: 'channel:manage:polls' }), value)), 'needs_reconnect');
    assert.equal(await code(polls.latestPoll(streamer({ twitch_user_id: null }))), 'needs_reconnect');
    assert.equal(await code(polls.latestPoll(streamer({ broadcaster_access_token: null }))), 'needs_reconnect');
    assert.equal(calls.length, 0);
  });
});

describe('Twitch\'s refusals', () => {
  test('not an Affiliate or Partner (whatever the status): not_affiliate, and the flag is stored', async () => {
    answers.push(refused(403, 'The broadcaster must be a partner or affiliate'), refused(400, 'channel is not a partner or affiliate'));
    assert.equal(await code(polls.createPoll(streamer(), value)), 'not_affiliate');
    assert.equal(await code(polls.createPrediction(streamer(), { ...value, kind: 'prediction' })), 'not_affiliate');
    assert.deepEqual(affiliateFlags, [[7, { affiliate_status: 'not_affiliate' }], [7, { affiliate_status: 'not_affiliate' }]]);
  });

  test('a message naming an Affiliate or Partner is not_affiliate whatever the status, 401 and 404 included', async () => {
    const message = 'The broadcaster must be an affiliate or partner to use this feature.';
    answers.push(refused(401, message), refused(401, message)); // a 401 is refreshed once first
    assert.equal(await code(polls.createPoll(streamer(), value)), 'not_affiliate');
    answers.push(refused(404, message));
    assert.equal(await code(polls.createPrediction(streamer(), { ...value, kind: 'prediction' })), 'not_affiliate');
    assert.deepEqual(affiliateFlags, [[7, { affiliate_status: 'not_affiliate' }], [7, { affiliate_status: 'not_affiliate' }]]);
  });

  test('a start that works sets a stored not-affiliate flag back to ok (the rewards client\'s value); otherwise nothing is stored', async () => {
    answers.push({ status: 200, body: { data: [poll] } }, { status: 200, body: { data: [poll] } });
    await polls.createPoll(streamer(), value);
    assert.deepEqual(affiliateFlags, []);
    await polls.createPoll(streamer({ cp_affiliate_status: 'not_affiliate' }), value);
    assert.deepEqual(affiliateFlags, [[7, { affiliate_status: 'ok' }]]);
  });

  test('one already running when starting: running; a text AutoMod refuses: automod', async () => {
    answers.push(refused(400, 'The broadcaster already has a poll that\'s running; you may not create another poll until the current poll completes.'));
    assert.equal(await code(polls.createPoll(streamer(), value)), 'running');
    answers.push(refused(400, 'The broadcaster already has a prediction that\'s running; you may not create another prediction until the current prediction is resolved or canceled.'));
    assert.equal(await code(polls.createPrediction(streamer(), { ...value, kind: 'prediction' })), 'running');
    answers.push(refused(400, 'The choice\'s title failed AutoMod checks.'));
    assert.equal(await code(polls.createPoll(streamer(), value)), 'automod');
  });

  test('"already running" on a call that is not a start is not running: only a start can find one running', async () => {
    answers.push(refused(400, 'The broadcaster already has a poll that\'s running; you may not create another poll until the current poll completes.'));
    assert.equal(await code(polls.endPoll(streamer(), 'poll-1')), 'twitch_failed');
    answers.push(refused(400, 'The broadcaster already has a prediction that\'s running; you may not create another prediction until the current prediction is resolved or canceled.'));
    assert.equal(await code(polls.cancelPrediction(streamer(), 'pred-1')), 'twitch_failed');
  });

  test('acting on one whose status changed meanwhile: changed', async () => {
    answers.push(refused(400, 'The poll must be active to terminate or archive it.'));
    assert.equal(await code(polls.endPoll(streamer(), 'poll-1')), 'changed');
    answers.push(refused(400, 'To update the prediction\'s status to LOCKED, its current status must be ACTIVE.'));
    assert.equal(await code(polls.lockPrediction(streamer(), 'pred-1')), 'changed');
  });

  test('an unknown prediction or outcome: not_found; any other refusal or a server error: twitch_failed', async () => {
    answers.push(refused(404, 'The prediction in the id field was not found.'), refused(400, 'Bad Request'), refused(403, 'Forbidden'), { status: 503, body: {} });
    assert.equal(await code(polls.resolvePrediction(streamer(), 'gone', 'out-1')), 'not_found');
    assert.equal(await code(polls.createPoll(streamer(), value)), 'twitch_failed');
    assert.equal(await code(polls.createPoll(streamer(), value)), 'twitch_failed');
    assert.equal(await code(polls.lockPrediction(streamer(), 'pred-1')), 'twitch_failed');
    assert.deepEqual(affiliateFlags, []);
  });

  test('no network, or no answer within the deadline: twitch_failed', async () => {
    answers.push('network');
    assert.equal(await code(polls.latestPoll(streamer())), 'twitch_failed');
    const realTimeout = AbortSignal.timeout;
    AbortSignal.timeout = () => realTimeout.call(AbortSignal, 20);
    try {
      answers.push('hang');
      assert.equal(await code(polls.latestPoll(streamer())), 'twitch_failed');
    } finally {
      AbortSignal.timeout = realTimeout;
    }
  });
});
