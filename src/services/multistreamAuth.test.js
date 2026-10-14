'use strict';

// Who may publish, read and use the API on the multistream relay. All keys
// and logins are synthetic.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { decideRelayAuth, streamTokenFromPath, isLoopback, sameSecret } = require('./multistreamAuth');

const KEY_ON = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const KEY_OFF = 'Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0Pp';
const accounts = {
  [KEY_ON]: { id: 1, multistream_enabled: 1 },
  [KEY_OFF]: { id: 2, multistream_enabled: 0 },
  // A disabled account is not found by its key at all (db.getStreamerByMultistreamToken).
};
const lookups = [];
const deps = {
  findStreamer: (token) => { lookups.push(token); return accounts[token]; },
  apiUser: 'admin',
  apiToken: 'synthetic-api-token',
};
const decide = (request) => decideRelayAuth(request, deps);

describe('publishing', () => {
  test('is allowed to live/<key> with the key of an enabled account that has multistream on', () => {
    assert.equal(decide({ action: 'publish', path: `live/${KEY_ON}`, ip: '203.0.113.7', protocol: 'rtmp' }).allow, true);
  });

  test('is refused with an unknown key, the key of a disabled account, or multistream switched off', () => {
    assert.equal(decide({ action: 'publish', path: 'live/UnknownKeyUnknownKeyUnknownKey' }).allow, false);
    assert.equal(decide({ action: 'publish', path: `live/${KEY_OFF}` }).allow, false);
  });

  test('is refused anywhere but live/<key>, and a malformed path is never cleaned up into a key', () => {
    lookups.length = 0;
    for (const path of [KEY_ON, `fwd_${KEY_ON}_twitch`, `live/${KEY_ON}/extra`, `live/${KEY_ON}?x=1`, `xlive/${KEY_ON}`,
      `live/${KEY_ON} `, 'live/short', `live/${'a'.repeat(129)}`, '', undefined, null, 42, { toString: () => `live/${KEY_ON}` }]) {
      assert.equal(decide({ action: 'publish', path }).allow, false, String(path));
    }
    assert.deepEqual(lookups, [], 'no account is looked up for a path that is not live/<key>');
  });

  test('a publisher from the relay itself gets no special treatment', () => {
    assert.equal(decide({ action: 'publish', path: 'live/UnknownKeyUnknownKeyUnknownKey', ip: '127.0.0.1' }).allow, false);
  });
});

describe('reading', () => {
  test('is allowed only from the relay itself (its forwarders)', () => {
    for (const ip of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) {
      assert.equal(decide({ action: 'read', path: `live/${KEY_ON}`, ip }).allow, true, ip);
    }
    for (const ip of ['203.0.113.7', '10.0.0.1', '::ffff:10.0.0.1', '2001:db8::1', '', undefined, '127.0.0.1.evil.test', '1127.0.0.1']) {
      assert.equal(decide({ action: 'read', path: `live/${KEY_ON}`, ip }).allow, false, String(ip));
    }
  });
});

describe('the control API', () => {
  test('is allowed only with the relay API login, from anywhere (the API reaches the relay through a tunnel, from localhost)', () => {
    assert.equal(decide({ action: 'api', user: 'admin', password: 'synthetic-api-token', ip: '127.0.0.1' }).allow, true);
    assert.equal(decide({ action: 'api', user: 'admin', password: 'synthetic-api-token', ip: '203.0.113.7' }).allow, true);
  });

  test('is refused without it, even from localhost', () => {
    for (const login of [{}, { user: 'admin', password: '' }, { user: 'admin', password: 'wrong' }, { user: 'root', password: 'synthetic-api-token' },
      { user: 'admin', password: 'synthetic-api-token ' }, { token: 'synthetic-api-token' }]) {
      assert.equal(decide({ action: 'api', ip: '127.0.0.1', ...login }).allow, false, JSON.stringify(login));
    }
  });

  test('is refused when no API token is configured, whatever is presented', () => {
    const noToken = { ...deps, apiToken: '' };
    assert.equal(decideRelayAuth({ action: 'api', user: 'admin', password: '' }, noToken).allow, false);
    assert.equal(decideRelayAuth({ action: 'api', user: 'admin', password: 'anything' }, noToken).allow, false);
  });

  test('the user is admin when none is configured', () => {
    assert.equal(decideRelayAuth({ action: 'api', user: 'admin', password: 'synthetic-api-token' }, { ...deps, apiUser: '' }).allow, true);
  });
});

describe('everything else', () => {
  test('is refused: playback, metrics, pprof, an unknown or missing action, a request that is not an object', () => {
    for (const action of ['playback', 'metrics', 'pprof', 'delete', '', undefined]) {
      assert.equal(decide({ action, path: `live/${KEY_ON}`, ip: '127.0.0.1', user: 'admin', password: 'synthetic-api-token' }).allow, false, String(action));
    }
    for (const request of [null, undefined, 'publish', [], 7]) {
      assert.equal(decide(request).allow, false, String(request));
    }
  });
});

describe('helpers', () => {
  test('streamTokenFromPath takes the key out of live/<key> only', () => {
    assert.equal(streamTokenFromPath(`live/${KEY_ON}`), KEY_ON);
    assert.equal(streamTokenFromPath(KEY_ON), null);
    assert.equal(streamTokenFromPath(`live/${KEY_ON}/x`), null);
  });

  test('isLoopback', () => {
    assert.equal(isLoopback('127.0.0.1'), true);
    assert.equal(isLoopback(' ::1 '), true);
    assert.equal(isLoopback('128.0.0.1'), false);
  });

  test('sameSecret compares whole strings, and an empty expected secret never matches', () => {
    assert.equal(sameSecret('abc', 'abc'), true);
    assert.equal(sameSecret('abc', 'abcd'), false);
    assert.equal(sameSecret('', ''), false);
    assert.equal(sameSecret(undefined, 'abc'), false);
    assert.equal(sameSecret('abc', undefined), false);
  });
});
