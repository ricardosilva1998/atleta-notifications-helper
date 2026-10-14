'use strict';

// The OAuth state cookie: made by issueOAuthState, checked (once) by
// checkOAuthState. Requests and responses are small fakes; values are synthetic.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { STATE_TTL_MS, cookieName, issueOAuthState, checkOAuthState } = require('./oauthState');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fakeRes() {
  return {
    set: [],
    cleared: [],
    clearCookie(name) { this.cleared.push(name); },
  };
}
function fakeReq({ cookies, query } = {}) {
  return {
    app: { locals: { secureCookie: (res, name, value, opts) => res.set.push({ name, value, opts }) } },
    cookies,
    query: query || {},
  };
}

test('issueOAuthState makes a random UUID, keeps it in the flow\'s cookie for 10 minutes, and returns it', () => {
  const res = fakeRes();
  const state = issueOAuthState(fakeReq(), res, 'spotify');
  assert.match(state, UUID);
  assert.deepEqual(res.set, [{ name: 'oauth_state_spotify', value: state, opts: { maxAge: 10 * 60 * 1000 } }]);
  assert.equal(STATE_TTL_MS, 600_000);
  assert.notEqual(issueOAuthState(fakeReq(), fakeRes(), 'spotify'), state, 'a new value each time');
  assert.equal(cookieName('youtube'), 'oauth_state_youtube');
});

test('checkOAuthState accepts exactly the value of this flow\'s cookie, and clears the cookie', () => {
  const res = fakeRes();
  const state = issueOAuthState(fakeReq(), res, 'twitch');
  const check = fakeRes();
  assert.equal(checkOAuthState(fakeReq({ cookies: { oauth_state_twitch: state }, query: { state } }), check, 'twitch'), true);
  assert.deepEqual(check.cleared, ['oauth_state_twitch']);
});

test('checkOAuthState refuses anything else, and clears the cookie every time', () => {
  const state = '3f2b8c1e-6a4d-4e5f-9a7b-1c2d3e4f5a6b';
  const other = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';
  const cases = [
    ['no cookie', undefined, { state }],
    ['no cookie for this flow', { oauth_state_spotify: state }, { state }],
    ['another value', { oauth_state_twitch: other }, { state }],
    ['no state in the callback', { oauth_state_twitch: state }, {}],
    ['an empty state and an empty cookie', { oauth_state_twitch: '' }, { state: '' }],
    ['the state sent twice (an array)', { oauth_state_twitch: state }, { state: [state, state] }],
    ['a longer value that starts the same', { oauth_state_twitch: state }, { state: `${state}x` }],
    ['the streamer id, as the state used to be', { oauth_state_twitch: state }, { state: '13' }],
  ];
  for (const [label, cookies, query] of cases) {
    const res = fakeRes();
    assert.equal(checkOAuthState(fakeReq({ cookies, query }), res, 'twitch'), false, label);
    assert.deepEqual(res.cleared, ['oauth_state_twitch'], `${label}: cleared`);
  }
});

test('checkOAuthState copes with a request that has no cookies or query', () => {
  const res = fakeRes();
  assert.equal(checkOAuthState({ app: {}, cookies: undefined, query: undefined }, res, 'youtube'), false);
  assert.deepEqual(res.cleared, ['oauth_state_youtube']);
});
