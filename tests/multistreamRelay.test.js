'use strict';

// The relay (MediaMTX) API client. fetch is stubbed: nothing leaves the
// machine. Addresses, keys and logins are synthetic.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const relay = require('../src/services/multistreamRelay');

const SETTINGS = { apiUrl: 'http://relay.example.test:9997/', apiUser: 'admin', apiToken: 'tok' };
const TWITCH = { name: 'twitch', url: 'rtmp://live.twitch.tv/app/live_123456_AbCdEf' };
const YOUTUBE = { name: 'youtube', url: 'rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl-mnop' };
const basic = (user, pass) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

const realFetch = global.fetch;
let calls; // [{ url, opts }]
let answer; // (url, opts) => response

beforeEach(() => {
  calls = [];
  answer = () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return answer(url, opts); };
});
afterEach(() => { global.fetch = realFetch; });

describe('the forwarders', () => {
  test('one path per destination, each running ffmpeg from the relay\'s own stream with exactly this command', async () => {
    const added = await relay.addForwardPaths({ ...SETTINGS, sourceToken: 'src_abc', destinations: [TWITCH, YOUTUBE] });
    assert.deepEqual(added, ['twitch', 'youtube']);
    assert.deepEqual(calls.map((c) => c.url), [
      'http://relay.example.test:9997/v3/config/paths/add/fwd_src_abc_twitch',
      'http://relay.example.test:9997/v3/config/paths/add/fwd_src_abc_youtube',
    ]);
    for (const [i, dest] of [TWITCH, YOUTUBE].entries()) {
      assert.equal(calls[i].opts.method, 'POST');
      assert.equal(calls[i].opts.headers['Content-Type'], 'application/json');
      assert.deepEqual(JSON.parse(calls[i].opts.body), {
        source: 'rtmp://localhost/live/src_abc',
        sourceOnDemand: false,
        runOnAvailable: `ffmpeg -nostdin -loglevel warning -i rtmp://localhost/live/src_abc -c copy -f flv ${dest.url}`,
        runOnAvailableRestart: true,
      });
    }
  });

  test('the ffmpeg command has no HTTP-only input options (ffmpeg refuses -reconnect on an rtmp:// input)', () => {
    const cmd = relay.buildFfmpegCmd('rtmp://localhost/live/src_abc', TWITCH.url);
    assert.doesNotMatch(cmd, /reconnect/);
    assert.equal(cmd, `ffmpeg -nostdin -loglevel warning -i rtmp://localhost/live/src_abc -c copy -f flv ${TWITCH.url}`);
  });

  test('an address with anything but plain URL characters is refused, so nothing reaches ffmpeg\'s command line', async () => {
    for (const bad of ['rtmp://live.twitch.tv/app/key with space', 'rtmp://live.twitch.tv/app/key$HOME', "rtmp://live.twitch.tv/app/'quoted'", 'http://example.test/app/key', 'rtmp://live.twitch.tv/']) {
      assert.throws(() => relay.buildFfmpegCmd('rtmp://localhost/live/src_abc', bad), /unexpected characters/, bad);
    }
    await assert.rejects(relay.addForwardPaths({ ...SETTINGS, sourceToken: 'src_abc', destinations: [{ name: 'twitch', url: 'rtmp://x.test/app/a b' }] }), /unexpected characters/);
    assert.equal(calls.length, 0);
  });

  test('a destination without an address is skipped', async () => {
    const added = await relay.addForwardPaths({ ...SETTINGS, sourceToken: 'src_abc', destinations: [TWITCH, { name: 'youtube', url: '' }, { name: 'kick', url: null }] });
    assert.deepEqual(added, ['twitch']);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /fwd_src_abc_twitch$/);
  });

  test('a refused add throws, and the message never carries the stream key', async () => {
    answer = () => ({ ok: false, status: 400, text: async () => 'path fwd_src_secretkey_twitch already exists' });
    await assert.rejects(
      relay.addForwardPaths({ ...SETTINGS, sourceToken: 'src_secretkey', destinations: [TWITCH] }),
      (err) => /^Relay add \(twitch\) failed: 400/.test(err.message) && !err.message.includes('src_secretkey'),
    );
  });

  test('removing deletes both forwarders; one that is already gone is fine', async () => {
    answer = (url) => (url.endsWith('_youtube') ? { ok: false, status: 404, text: async () => 'not found' } : { ok: true, status: 200, text: async () => '' });
    await relay.removeForwardPaths({ ...SETTINGS, sourceToken: 'src_abc', destinationNames: ['twitch', 'youtube'] });
    assert.deepEqual(calls.map((c) => [c.opts.method, c.url.replace(/^.*\/v3/, '/v3')]), [
      ['DELETE', '/v3/config/paths/delete/fwd_src_abc_twitch'],
      ['DELETE', '/v3/config/paths/delete/fwd_src_abc_youtube'],
    ]);
  });

  test('a failed delete other than 404 throws', async () => {
    answer = () => ({ ok: false, status: 500, text: async () => 'internal error' });
    await assert.rejects(relay.removeForwardPaths({ ...SETTINGS, sourceToken: 'src_abc', destinationNames: ['twitch'] }), /Relay delete \(twitch\) failed: 500/);
  });
});

describe('the stream on the relay', () => {
  test('null when the relay has no such path', async () => {
    answer = () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' });
    assert.equal(await relay.getPathStats({ ...SETTINGS, sourceToken: 'src_abc' }), null);
    assert.equal(calls[0].url, 'http://relay.example.test:9997/v3/paths/get/live/src_abc');
  });

  test('live when a stream is coming in ("available", or "ready" before MediaMTX 1.20)', async () => {
    answer = () => ({ ok: true, status: 200, json: async () => ({ name: 'live/src_abc', available: true }) });
    assert.equal(relay.isLive(await relay.getPathStats({ ...SETTINGS, sourceToken: 'src_abc' })), true);
    assert.equal(relay.isLive({ ready: true }), true);
    assert.equal(relay.isLive({ available: false, ready: false }), false);
    assert.equal(relay.isLive(null), false);
  });
});

describe('logging in to the relay API (HTTP Basic)', () => {
  test('every request sends MEDIAMTX_API_USER and MEDIAMTX_API_TOKEN as Basic credentials', async () => {
    await relay.addForwardPaths({ ...SETTINGS, apiUser: 'operator', sourceToken: 'src_abc', destinations: [TWITCH] });
    await relay.removeForwardPaths({ ...SETTINGS, apiUser: 'operator', sourceToken: 'src_abc', destinationNames: ['twitch'] });
    await relay.getPathStats({ ...SETTINGS, apiUser: 'operator', sourceToken: 'src_abc' });
    assert.equal(calls.length, 3);
    for (const c of calls) assert.equal(c.opts.headers.Authorization, basic('operator', 'tok'));
  });

  test('the user is admin when MEDIAMTX_API_USER is not set', async () => {
    await relay.getPathStats({ apiUrl: SETTINGS.apiUrl, apiToken: 'tok', sourceToken: 'src_abc' });
    assert.equal(calls[0].opts.headers.Authorization, basic('admin', 'tok'));
  });

  test('without a token nothing is sent: every call fails', async () => {
    const noToken = { ...SETTINGS, apiToken: '' };
    await assert.rejects(relay.addForwardPaths({ ...noToken, sourceToken: 'src_abc', destinations: [TWITCH] }), /MEDIAMTX_API_TOKEN/);
    await assert.rejects(relay.removeForwardPaths({ ...noToken, sourceToken: 'src_abc', destinationNames: ['twitch'] }), /MEDIAMTX_API_TOKEN/);
    await assert.rejects(relay.getPathStats({ ...noToken, sourceToken: 'src_abc' }), /MEDIAMTX_API_TOKEN/);
    assert.equal(calls.length, 0);
  });

  test('a Cloudflare Access service token is sent along when both of its parts are set', async () => {
    await relay.getPathStats({ ...SETTINGS, sourceToken: 'src_abc', accessClientId: 'cf-id.access', accessClientSecret: 'cf-secret' });
    assert.equal(calls[0].opts.headers['CF-Access-Client-Id'], 'cf-id.access');
    assert.equal(calls[0].opts.headers['CF-Access-Client-Secret'], 'cf-secret');
    await relay.getPathStats({ ...SETTINGS, sourceToken: 'src_abc', accessClientId: 'cf-id.access' });
    assert.equal(calls[1].opts.headers['CF-Access-Client-Id'], undefined);
  });

  test('every request has a timeout, or the caller\'s own signal', async () => {
    await relay.getPathStats({ ...SETTINGS, sourceToken: 'src_abc' });
    assert.ok(calls[0].opts.signal instanceof AbortSignal);
    const signal = AbortSignal.timeout(3000);
    await relay.getPathStats({ ...SETTINGS, sourceToken: 'src_abc', signal });
    assert.equal(calls[1].opts.signal, signal);
  });
});

describe('the minute check\'s lists', () => {
  const KEY_A = 'KeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const KEY_B = 'Key_B-with_underscores_and-dashes';

  test('the live streams: live/<key> paths with a stream coming in, from every page', async () => {
    const pages = {
      0: { pageCount: 2, items: [{ name: `live/${KEY_A}`, available: true }, { name: `live/${KEY_B}`, available: false }, { name: `fwd_${KEY_A}_twitch`, available: true }] },
      1: { pageCount: 2, items: [{ name: `live/${KEY_B}`, ready: true }, { name: 'live/short', available: true }, { name: 'other/path', available: true }] },
    };
    answer = (url) => ({ ok: true, status: 200, json: async () => pages[new URL(url).searchParams.get('page')] });
    assert.deepEqual(await relay.listLiveStreams(SETTINGS), new Set([KEY_A, KEY_B]));
    assert.deepEqual(calls.map((c) => c.url), [
      'http://relay.example.test:9997/v3/paths/list?itemsPerPage=500&page=0',
      'http://relay.example.test:9997/v3/paths/list?itemsPerPage=500&page=1',
    ]);
    for (const c of calls) assert.equal(c.opts.headers.Authorization, basic('admin', 'tok'));
  });

  test('the forwarders: each key with its destinations, read from the configured paths', async () => {
    answer = () => ({
      ok: true,
      status: 200,
      json: async () => ({ pageCount: 1, items: [
        { name: `fwd_${KEY_A}_twitch` }, { name: `fwd_${KEY_A}_youtube` }, { name: `fwd_${KEY_B}_youtube` },
        { name: '~^live/[A-Za-z0-9_-]{16,128}$' }, { name: `fwd_${KEY_A}_kick` }, { name: 'fwd_short_twitch' },
      ] }),
    });
    const forwarders = await relay.listForwarders(SETTINGS);
    assert.deepEqual([...forwarders.keys()].sort(), [KEY_A, KEY_B].sort());
    assert.deepEqual(forwarders.get(KEY_A), new Set(['twitch', 'youtube']));
    assert.deepEqual(forwarders.get(KEY_B), new Set(['youtube']));
    assert.equal(calls[0].url, 'http://relay.example.test:9997/v3/config/paths/list?itemsPerPage=500&page=0');
  });

  test('a failed list throws with the status only (its body could name stream keys)', async () => {
    answer = () => ({ ok: false, status: 500, text: async () => `path fwd_${KEY_A}_twitch is broken` });
    await assert.rejects(relay.listForwarders(SETTINGS), (err) => /failed: 500$/.test(err.message) && !err.message.includes(KEY_A));
  });
});

describe('failures never carry a stream key (it would let anyone who reads the log publish as the streamer)', () => {
  const KEY = 'SecretStreamKey0000000000000000Z';

  test('fetch\'s own error, which quotes the address (and the forwarder name in it), is replaced', async () => {
    global.fetch = async (url) => { throw new TypeError(`Failed to parse URL from ${url}`, { cause: Object.assign(new TypeError('Invalid URL'), { code: 'ERR_INVALID_URL' }) }); };
    for (const call of [
      () => relay.addForwardPaths({ ...SETTINGS, sourceToken: KEY, destinations: [TWITCH] }),
      () => relay.removeForwardPaths({ ...SETTINGS, sourceToken: KEY, destinationNames: ['twitch'] }),
      () => relay.getPathStats({ ...SETTINGS, sourceToken: KEY }),
      () => relay.listForwarders(SETTINGS),
    ]) {
      await assert.rejects(call(), (err) => err.message === 'The relay could not be reached (ERR_INVALID_URL)' && !err.message.includes(KEY));
    }
  });

  test('with the real fetch, an address without its scheme fails before any request, and the message names no key', async () => {
    global.fetch = realFetch; // parsing the address fails before anything is sent
    await assert.rejects(
      relay.addForwardPaths({ ...SETTINGS, apiUrl: 'relay.example.test:9997', sourceToken: KEY, destinations: [TWITCH] }),
      (err) => /^The relay could not be reached/.test(err.message) && !err.message.includes(KEY) && !err.message.includes('fwd_'),
    );
  });

  test('a timeout and a refused connection say only that', async () => {
    global.fetch = async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };
    await assert.rejects(relay.getPathStats({ ...SETTINGS, sourceToken: KEY }), { message: 'The relay did not answer in time' });
    global.fetch = async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), { code: 'ECONNREFUSED' }) }); };
    await assert.rejects(relay.getPathStats({ ...SETTINGS, sourceToken: KEY }), { message: 'The relay could not be reached (ECONNREFUSED)' });
  });
});

describe('the one definition of the relay settings and of live/<key>', () => {
  test('relaySettings takes the API fields out of config.multistream, and nothing else', () => {
    const picked = relay.relaySettings({ ...SETTINGS, accessClientId: 'id', accessClientSecret: 'secret', webhookSecret: 'hook', ingestUrl: 'rtmp://x/live', enabled: true });
    assert.deepEqual(picked, { apiUrl: SETTINGS.apiUrl, apiUser: 'admin', apiToken: 'tok', accessClientId: 'id', accessClientSecret: 'secret' });
    assert.deepEqual(relay.relaySettings(undefined), { apiUrl: undefined, apiUser: undefined, apiToken: undefined, accessClientId: undefined, accessClientSecret: undefined });
  });

  test('LIVE_PATH matches live/<key> only', () => {
    assert.equal(relay.LIVE_PATH.exec('live/AbCdEfGhIjKlMnOp_-12')[1], 'AbCdEfGhIjKlMnOp_-12');
    for (const path of ['live/short', 'fwd_AbCdEfGhIjKlMnOp_-12_twitch', 'live/AbCdEfGhIjKlMnOp_-12/x', 'xlive/AbCdEfGhIjKlMnOp_-12']) {
      assert.equal(relay.LIVE_PATH.test(path), false, path);
    }
  });

  test('every module takes them from here: no second copy of the key pattern or of the settings picker', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
    for (const file of ['routes/multistream.js', 'services/multistreamSessions.js', 'services/multistreamAuth.js']) {
      const source = read(file);
      assert.doesNotMatch(source, /\{16,128\}/, `${file} has no key pattern of its own`);
      assert.doesNotMatch(source, /const \{ apiUrl, apiUser, apiToken/, `${file} picks no settings of its own`);
    }
    assert.match(read('services/multistreamAuth.js'), /require\('\.\/multistreamRelay'\)/);
    assert.match(read('services/multistreamSessions.js'), /relaySettings: pickRelaySettings \} = require\('\.\/multistreamRelay'\)/);
    assert.match(read('routes/multistream.js'), /relay\.relaySettings\(config\.multistream\)/);
  });
});
