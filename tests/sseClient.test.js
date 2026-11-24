'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SSE_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'sse.js'), 'utf8');

// A fake browser: EventSource the test drives, a fetch that answers the URL check, timers held until the test fires them.
function load({ status = 200, fail = false, hang = false } = {}) {
  const sources = [];
  class FakeEventSource {
    constructor(url) { this.url = url; this.closed = false; sources.push(this); }
    close() { this.closed = true; }
    send(message) { this.onmessage({ data: JSON.stringify(message) }); }
  }
  const timers = [];
  const reloads = [];
  const fetched = [];
  const context = {
    window: {},
    EventSource: FakeEventSource,
    location: { reload() { reloads.push(1); } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    AbortController: hang ? AbortController : undefined,
    fetch: (url, opts) => {
      fetched.push(url);
      if (hang) return new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted'))));
      if (fail) return Promise.reject(new Error('offline'));
      return Promise.resolve({ status });
    },
    module: { exports: {} },
  };
  vm.createContext(context);
  vm.runInContext(SSE_JS, context, { filename: 'sse.js' });
  return { api: context.module.exports, browserApi: context.window.AtletaSSE, sources, timers, reloads, fetched };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('the shared stream client', () => {
  test('a URL check that never answers gives the 5 s retry once its 10 s deadline passes', async () => {
    const { api, timers } = load({ hang: true });
    const result = api.retryDelay('/overlay/x');
    await flush();
    const deadline = timers.find((t) => t.ms === 10000);
    assert.ok(deadline, 'a 10 s deadline timer is set');
    deadline.fn();
    assert.equal(await result, 5000);
  });

  test('it is exported to the page as window.AtletaSSE', () => {
    const { api, browserApi } = load();
    assert.equal(browserApi, api);
  });

  test('a 502 then a 200: it reopens the stream itself after 5 s and goes on delivering', async () => {
    const env = load({ status: 502 });
    const got = [];
    env.api.connect({ url: '/overlay/events/t', onMessage: (d) => got.push(d) });
    assert.equal(env.sources.length, 1);
    env.sources[0].onerror();
    assert.equal(env.sources[0].closed, true, 'the dead source is closed, not left to the browser');
    await flush();
    assert.equal(env.timers.length, 1);
    assert.equal(env.timers[0].ms, 5000);
    env.timers[0].fn();
    assert.equal(env.sources.length, 2, 'a new EventSource');
    env.sources[1].send({ type: 'follow' });
    assert.equal(JSON.stringify(got), JSON.stringify([{ type: 'follow' }]));
  });

  test('a 404 waits 5 minutes', async () => {
    const env = load({ status: 404 });
    env.api.connect({ url: '/overlay/events/t', onMessage() {} });
    env.sources[0].onerror();
    await flush();
    assert.equal(env.timers[0].ms, 300000);
  });

  test('a network error on the check retries in 5 s; the URL is checked once per error', async () => {
    const env = load({ fail: true });
    env.api.connect({ url: '/u', onMessage() {} });
    env.sources[0].onerror();
    env.sources[0].onerror();
    await flush();
    assert.equal(env.fetched.length, 1);
    assert.equal(env.timers.length, 1);
    assert.equal(env.timers[0].ms, 5000);
  });

  test('a changed serverVersion reloads the page; the same one does not', () => {
    const env = load();
    const got = [];
    env.api.connect({ url: '/u', onMessage: (d) => got.push(d.type) });
    env.sources[0].send({ type: 'config', serverVersion: 'v1' });
    env.sources[0].send({ type: 'config', serverVersion: 'v1' });
    assert.equal(env.reloads.length, 0);
    assert.deepEqual(got, ['config', 'config']);
    env.sources[0].send({ type: 'config', serverVersion: 'v2' });
    assert.equal(env.reloads.length, 1);
    assert.deepEqual(got, ['config', 'config'], 'the reloading message is not handed on');
  });

  test('the version is remembered across a reconnect', async () => {
    const env = load();
    env.api.connect({ url: '/u', onMessage() {} });
    env.sources[0].send({ type: 'config', serverVersion: 'v1' });
    env.sources[0].onerror();
    await flush();
    env.timers[0].fn();
    env.sources[1].send({ type: 'config', serverVersion: 'v2' });
    assert.equal(env.reloads.length, 1);
  });

  test('a message that is not JSON is ignored; close() stops reconnecting', async () => {
    const env = load();
    const got = [];
    const handle = env.api.connect({ url: '/u', onMessage: (d) => got.push(d) });
    env.sources[0].onmessage({ data: 'not json' });
    assert.equal(got.length, 0);
    handle.close();
    assert.equal(env.sources[0].closed, true);
    env.sources[0].onerror();
    await flush();
    assert.equal(env.timers.length, 0);
  });
});
