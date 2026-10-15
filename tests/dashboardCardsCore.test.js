'use strict';

// The working cards' pure helpers (public/js/dashboard-cards-core.js), loaded as Node loads them: packing, filling
// a text, reading an answer, saving the newest value of a control, the giveaway clock.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../public/js/dashboard-cards-core.js');

// A fetch() Response as readAnswer() reads it.
const response = (status, body, type = 'application/json; charset=utf-8') => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (name) => (name.toLowerCase() === 'content-type' ? type : null) },
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
});

// A send() whose answers the test gives, one at a time.
function deferredSend() {
  const sent = [];
  const waiting = [];
  const send = (value) => new Promise((resolve) => { sent.push(value); waiting.push(resolve); });
  return { send, sent, answer: (result) => waiting.shift()(result) };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('rowSpan', () => {
  test('a card spans its height plus the 12 px gap, in 2 px rows', () => {
    assert.equal(core.rowSpan(100), 56);
    assert.equal(core.rowSpan(101), 57);
    assert.equal(core.rowSpan(0), 6);
  });
});

describe('fill', () => {
  test('fills each {{field}} once; a missing one is empty', () => {
    assert.equal(core.fill('{{on}} of {{total}} on', { on: 1, total: 6 }), '1 of 6 on');
    assert.equal(core.fill('Show all ({{count}})', {}), 'Show all ()');
    assert.equal(core.fill('{{a}}', { a: '{{b}}', b: 'x' }), '{{b}}', 'a value is not filled again');
  });
});

describe('readAnswer', () => {
  test('a route that did it', async () => {
    assert.deepEqual(await core.readAnswer(response(200, { ok: true, value: 1 })), { ok: true, status: 200, data: { ok: true, value: 1 } });
    assert.equal((await core.readAnswer(response(201, { id: 3, keyword: 'gw' }))).ok, true, 'an answer without ok counts as done');
  });

  test('a refusal keeps its code and its words', async () => {
    const answer = await core.readAnswer(response(409, { ok: false, code: 'no_email', error: 'Add your PayPal email first' }));
    assert.deepEqual([answer.ok, answer.kind, answer.code, answer.error, answer.status], [false, 'refused', 'no_email', 'Add your PayPal email first', 409]);
    assert.equal((await core.readAnswer(response(403, { ok: false, error: 'Reload the page' }))).kind, 'refused', 'the CSRF check');
    assert.equal((await core.readAnswer(response(429, { ok: false, error: 'Please wait' }))).error, 'Please wait');
  });

  test('a page instead of JSON is a session that ended; a server error is a failure', async () => {
    assert.deepEqual(await core.readAnswer(response(200, '<html>login</html>', 'text/html')), { ok: false, kind: 'session', status: 200 });
    assert.equal((await core.readAnswer(response(403, '<html>disabled</html>', 'text/html'))).kind, 'session');
    assert.equal((await core.readAnswer(response(502, '<html>bad gateway</html>', 'text/html'))).kind, 'failed');
    const failed = await core.readAnswer(response(502, { ok: false, error: 'Twitch did not take it', reward: { enabled: 1 } }));
    assert.deepEqual([failed.kind, failed.error, failed.data.reward.enabled], ['failed', 'Twitch did not take it', 1]);
    assert.equal((await core.readAnswer(response(200, 'not json'))).kind, 'failed', 'JSON that does not parse');
  });
});

describe('createLatestQueue', () => {
  test('quick changes: one request at a time, only the newest waiting value is sent next, the server ends with the last click', async () => {
    const { send, sent, answer } = deferredSend();
    const done = [];
    const queue = core.createLatestQueue(send, { confirmed: false, onDone: (result, held) => done.push([result.ok, held]) });
    queue.push(true);
    queue.push(false);
    queue.push(true);
    assert.deepEqual(sent, [true], 'one request at a time');
    answer({ ok: true });
    await tick();
    assert.deepEqual(sent, [true, true], 'the middle click is never sent');
    answer({ ok: true });
    await tick();
    assert.deepEqual(done, [[true, true]], 'one answer for the whole burst');
    assert.equal(queue.confirmed, true);
  });

  test('a refused last value gives back what the server holds; a send that throws counts as no network', async () => {
    const { send, answer } = deferredSend();
    const done = [];
    const queue = core.createLatestQueue(send, { confirmed: 0, onDone: (result, held) => done.push([result.ok, result.kind, held]) });
    queue.push(1);
    answer({ ok: true });
    await tick();
    queue.push(2);
    answer({ ok: false, kind: 'refused' });
    await tick();
    assert.deepEqual(done, [[true, undefined, 1], [false, 'refused', 1]]);
    const failing = core.createLatestQueue(() => { throw new Error('offline'); }, { confirmed: 5, onDone: (result, held) => done.push([result.ok, result.kind, held]) });
    failing.push(6);
    await tick();
    assert.deepEqual(done.at(-1), [false, 'network', 5]);
  });
});

describe('the giveaway clock', () => {
  test('formatLeft: m:ss, h:mm:ss from an hour on, 0:00 once over', () => {
    assert.equal(core.formatLeft(0), '0:00');
    assert.equal(core.formatLeft(-5000), '0:00');
    assert.equal(core.formatLeft(1), '0:01');
    assert.equal(core.formatLeft(61000), '1:01');
    assert.equal(core.formatLeft(3600000), '1:00:00');
  });

  test('parseUtc reads the database\'s UTC times, with or without their zone', () => {
    const want = Date.UTC(2026, 9, 14, 10, 0, 0);
    assert.equal(core.parseUtc('2026-10-14 10:00:00'), want);
    assert.equal(core.parseUtc('2026-10-14T10:00:00.000Z'), want);
    assert.equal(core.parseUtc('2026-10-14T12:00:00+02:00'), want);
    assert.ok(Number.isNaN(core.parseUtc('')));
    assert.ok(Number.isNaN(core.parseUtc('soon')));
  });
});
