'use strict';

// The working cards' pure helpers (public/js/dashboard-cards-core.js), loaded as Node loads them: packing, filling
// a text, reading an answer, saving the newest value of a control, the giveaway clock.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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

  // call() sends redirect: 'manual': the redirect to sign in (which leads off the site, to Discord, where fetch can only
  // fail) is not followed; it arrives as an opaque redirect (type 'opaqueredirect', status 0, no headers).
  test('a request sent to sign in again (an opaque redirect), or answered with a 401 or 403 page, is a session that ended', async () => {
    const redirect = { type: 'opaqueredirect', status: 0, headers: { get: () => null } };
    assert.deepEqual(await core.readAnswer(redirect), { ok: false, kind: 'session', status: 0 });
    assert.deepEqual(await core.readAnswer(response(403, '<html>disabled</html>', 'text/html')), { ok: false, kind: 'session', status: 403 });
    assert.deepEqual(await core.readAnswer(response(401, '<html>sign in</html>', 'text/html')), { ok: false, kind: 'session', status: 401 });
  });

  test('a 200 page is a failure, not a session that ended: with redirect "manual" the login page never arrives', async () => {
    assert.deepEqual(await core.readAnswer(response(200, '<html>login</html>', 'text/html')), { ok: false, kind: 'failed', status: 200 });
  });

  test('any other answer that is not JSON is a failure too: a rate limit page, a missing page, a server error page', async () => {
    for (const status of [429, 404, 500, 502]) {
      assert.deepEqual(await core.readAnswer(response(status, '<html>page</html>', 'text/html')), { ok: false, kind: 'failed', status }, String(status));
    }
  });

  test('a server error with a JSON body keeps its words; JSON that does not parse is a failure', async () => {
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

describe('the Polls & predictions card', () => {
  const P = {
    minutes: '{{minutes}} min', seconds: '{{seconds}} s',
    resultPollWon: '{{winner}} won with {{percent}}% of the votes ({{votes}})', resultTie: 'Tie: {{winner}}', resultNone: 'Nobody voted',
    resultPredictionWon: '{{outcome}} wins — {{winners}} viewers share {{points}} points',
    resultCancelled: 'Cancelled — everyone got their points back',
  };
  const ended = (kind, result, options, total = 0) => ({ kind, state: 'ended', result, options, total });

  test('a template\'s time and its row', () => {
    assert.equal(core.pollTime(120, P), '2 min');
    assert.equal(core.pollTime(30, P), '30 s');
    assert.equal(core.pollTime(90, P), '90 s');
    assert.equal(core.templateSummary({ choices: ['Yes', 'No'], durationSeconds: 300 }, P), 'Yes / No · 5 min');
  });

  test('the line of what ended: the winner, a tie, nobody, the prediction\'s winners, a cancel; nothing while it runs', () => {
    assert.equal(core.pollResultLine(ended('poll', 'won', [{ title: 'Yes', percent: 64, votes: 1048, won: true }, { title: 'No', percent: 36, votes: 27 }]), P, 'en'), 'Yes won with 64% of the votes (1,048)');
    assert.equal(core.pollResultLine(ended('poll', 'tie', [{ title: 'A', won: true }, { title: 'B', won: true }]), P, 'en'), 'Tie: A / B');
    assert.equal(core.pollResultLine(ended('poll', 'none', [{ title: 'A' }, { title: 'B' }]), P, 'en'), 'Nobody voted');
    assert.equal(core.pollResultLine(ended('prediction', 'won', [{ title: 'Clean', users: 18, won: true }, { title: 'Chaos', users: 9 }], 17500), P, 'en'), 'Clean wins — 18 viewers share 17,500 points');
    assert.equal(core.pollResultLine(ended('prediction', 'canceled', [{ title: 'Clean' }]), P, 'en'), 'Cancelled — everyone got their points back');
    assert.equal(core.pollResultLine({ kind: 'poll', state: 'running', options: [] }, P, 'en'), '');
    assert.equal(core.pollResultLine(null, P, 'en'), '');
  });

  test('it asks again every 2 seconds while something runs or just ended, else every 10', () => {
    assert.equal(core.pollsRefreshMs({ poll: { state: 'running' }, prediction: null }), 2000);
    assert.equal(core.pollsRefreshMs({ poll: null, prediction: { state: 'ended' } }), 2000);
    assert.equal(core.pollsRefreshMs({ poll: null, prediction: null }), 10000);
    assert.equal(core.pollsRefreshMs(null), 10000);
  });
});

describe('the browser files', () => {
  // CI's node --check covers src/ only, and these three are served as they are: a slip in the cards' script or its
  // helpers would stop every switch from saving, one in the polls card's script would stop that card, and the rest of
  // the suite would stay green.
  for (const name of ['dashboard-cards-core.js', 'dashboard-cards.js', 'dashboard-polls.js']) {
    test(`${name} compiles`, () => {
      const file = path.join(__dirname, '..', 'public', 'js', name);
      assert.doesNotThrow(() => new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }));
    });
  }
});
