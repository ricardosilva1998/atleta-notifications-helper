const { test } = require('node:test');
const assert = require('node:assert');

function withMockedFetch(fn) {
  return async (t) => {
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    };
    delete require.cache[require.resolve('../src/services/multistreamRelay')];
    const relay = require('../src/services/multistreamRelay');
    try {
      await fn(t, relay, calls);
    } finally {
      global.fetch = originalFetch;
    }
  };
}

test('addForwardPaths posts one config per destination', withMockedFetch(async (t, relay, calls) => {
  const added = await relay.addForwardPaths({
    apiUrl: 'http://relay.example:9997',
    apiToken: 'tok',
    sourceToken: 'src_abc',
    destinations: [
      { name: 'twitch', url: 'rtmp://live.twitch.tv/app/live_xxx' },
      { name: 'youtube', url: 'rtmp://a.rtmp.youtube.com/live2/xxxx-xxxx-xxxx' },
    ],
  });
  assert.deepStrictEqual(added, ['twitch', 'youtube']);
  assert.strictEqual(calls.length, 2);
  assert.match(calls[0].url, /\/v3\/config\/paths\/add\/fwd_src_abc_twitch$/);
  assert.match(calls[1].url, /\/v3\/config\/paths\/add\/fwd_src_abc_youtube$/);
  for (const c of calls) {
    assert.strictEqual(c.opts.method, 'POST');
    assert.strictEqual(c.opts.headers['Authorization'], 'Bearer tok');
    const body = JSON.parse(c.opts.body);
    assert.strictEqual(body.source, 'rtmp://localhost/live/src_abc');
    assert.match(body.runOnReady, /^ffmpeg.*-c copy.*-f flv.*rtmp:/);
  }
}));

test('addForwardPaths skips destinations without a URL', withMockedFetch(async (t, relay, calls) => {
  const added = await relay.addForwardPaths({
    apiUrl: 'http://relay.example:9997',
    apiToken: 'tok',
    sourceToken: 'src_abc',
    destinations: [
      { name: 'twitch', url: 'rtmp://live.twitch.tv/app/live_xxx' },
      { name: 'youtube', url: '' },
      { name: 'kick', url: null },
    ],
  });
  assert.deepStrictEqual(added, ['twitch']);
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].url, /twitch$/);
}));

test('addForwardPaths omits Authorization header when no token configured', withMockedFetch(async (t, relay, calls) => {
  await relay.addForwardPaths({
    apiUrl: 'http://relay.example:9997',
    apiToken: '',
    sourceToken: 'src_abc',
    destinations: [{ name: 'twitch', url: 'rtmp://live.twitch.tv/app/live_xxx' }],
  });
  assert.strictEqual(calls[0].opts.headers['Authorization'], undefined);
}));

test('removeForwardPaths deletes both forwarders', withMockedFetch(async (t, relay, calls) => {
  await relay.removeForwardPaths({
    apiUrl: 'http://relay.example:9997',
    apiToken: 'tok',
    sourceToken: 'src_abc',
    destinationNames: ['twitch', 'youtube'],
  });
  assert.strictEqual(calls.length, 2);
  for (const c of calls) {
    assert.strictEqual(c.opts.method, 'DELETE');
    assert.match(c.url, /\/v3\/config\/paths\/delete\/fwd_src_abc_(twitch|youtube)$/);
  }
}));

test('removeForwardPaths treats 404 as success (idempotent)', async (t) => {
  const originalFetch = global.fetch;
  let attempts = 0;
  global.fetch = async () => {
    attempts++;
    return { ok: false, status: 404, text: async () => 'path not found' };
  };
  delete require.cache[require.resolve('../src/services/multistreamRelay')];
  const relay = require('../src/services/multistreamRelay');
  try {
    await relay.removeForwardPaths({
      apiUrl: 'http://relay.example:9997',
      apiToken: 'tok',
      sourceToken: 'src_abc',
      destinationNames: ['twitch'],
    });
    assert.strictEqual(attempts, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('addForwardPaths throws on non-OK non-404 status', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500, text: async () => 'internal error' });
  delete require.cache[require.resolve('../src/services/multistreamRelay')];
  const relay = require('../src/services/multistreamRelay');
  try {
    await assert.rejects(
      relay.addForwardPaths({
        apiUrl: 'http://relay.example:9997',
        apiToken: 'tok',
        sourceToken: 'src_abc',
        destinations: [{ name: 'twitch', url: 'rtmp://live.twitch.tv/app/live_xxx' }],
      }),
      /MediaMTX add fwd_src_abc_twitch failed: 500/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('getPathStats returns null on 404', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  delete require.cache[require.resolve('../src/services/multistreamRelay')];
  const relay = require('../src/services/multistreamRelay');
  try {
    const result = await relay.getPathStats({
      apiUrl: 'http://relay.example:9997',
      apiToken: 'tok',
      sourceToken: 'src_abc',
    });
    assert.strictEqual(result, null);
  } finally {
    global.fetch = originalFetch;
  }
});
