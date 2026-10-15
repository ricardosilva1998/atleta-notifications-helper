'use strict';

// The Polls & predictions card's JSON routes (routes/polls.js) on an in-memory database, with a fake Twitch in place
// of twitchPolls and a real livePolls around fakes: the templates (a streamer's own only, Twitch's limits, at most 20),
// the buttons that start, end, lock, resolve and cancel, what the card gets back, and the refusals with their texts.
// Nothing reaches Twitch. All ids, names and tokens are synthetic.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const Module = require('module');
const express = require('express');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) {
  process.env[key] = process.env[key] || 'test';
}

const SRC = path.join(__dirname, '..');
const DB_FILE = path.join(SRC, 'db.js');
const POLLS_FILE = path.join(__dirname, 'polls.js');
const iso = (ms) => new Date(ms).toISOString();

// ── A fake Twitch in place of services/twitchPolls.js ────────────────────

class PollsError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const helix = { calls: [], refuse: null, hold: null };
async function answer(name, args, result) {
  helix.calls.push([name, ...args]);
  if (helix.hold) await helix.hold;
  if (helix.refuse) throw new PollsError(helix.refuse);
  return result;
}
const pollOf = (value, over = {}) => ({
  id: 'poll-1', title: value.title, status: 'ACTIVE', duration: value.durationSeconds, started_at: iso(Date.now()),
  choices: value.choices.map((title, i) => ({ id: `c${i + 1}`, title, votes: 0 })), ...over,
});
const predictionOf = (value, over = {}) => ({
  id: 'pred-1', title: value.title, status: 'ACTIVE', prediction_window: value.durationSeconds, created_at: iso(Date.now()),
  outcomes: value.choices.map((title, i) => ({ id: `o${i + 1}`, title, users: 0, channel_points: 0, color: i ? 'PINK' : 'BLUE' })), ...over,
});
const LAP = { title: 'Clean lap?', durationSeconds: 60, choices: ['Clean', 'Chaos'] };
const twitchPollsStub = {
  PollsError,
  createPoll: (s, value) => answer('createPoll', [s.id, value], pollOf(value)),
  createPrediction: (s, value) => answer('createPrediction', [s.id, value], predictionOf(value)),
  endPoll: (s, id) => answer('endPoll', [s.id, id], pollOf({ title: 'Top 5?', durationSeconds: 60, choices: ['Yes', 'No'] }, { id, status: 'TERMINATED', ended_at: iso(Date.now()) })),
  lockPrediction: (s, id) => answer('lockPrediction', [s.id, id], predictionOf(LAP, { id, status: 'LOCKED', locked_at: iso(Date.now()) })),
  resolvePrediction: (s, id, outcomeId) => answer('resolvePrediction', [s.id, id, outcomeId], predictionOf(LAP, { id, status: 'RESOLVED', winning_outcome_id: outcomeId, ended_at: iso(Date.now()) })),
  cancelPrediction: (s, id) => answer('cancelPrediction', [s.id, id], predictionOf(LAP, { id, status: 'CANCELED', ended_at: iso(Date.now()) })),
};
const twitchStub = {
  hasPollsScope: (s) => /channel:manage:polls/.test(s.broadcaster_scopes || '') && /channel:manage:predictions/.test(s.broadcaster_scopes || ''),
};
const said = []; // the bot's announcements: [streamerId, text]
const latest = { poll: null, prediction: null }; // what a read of Twitch finds
const livePollsStub = { livePolls: null }; // a real livePolls around fakes, made in before()

// ── App ──────────────────────────────────────────────────────────────────

let db;
let t;
let server;
let port;
const logs = [];
const saved = {};

function request(method, urlPath, { streamer, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {};
    if (streamer) headers['x-test-streamer'] = String(streamer);
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, agent: false, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

before(async () => {
  saved.load = Module._load;
  Module._load = function (request, parent, isMain) {
    const from = parent && parent.filename;
    if (from === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
    }
    if (from === POLLS_FILE) {
      if (request === '../services/twitchPolls') return twitchPollsStub;
      if (request === '../services/livePolls') return livePollsStub;
      if (request === '../services/twitch') return twitchStub;
    }
    return saved.load.call(this, request, parent, isMain);
  };
  for (const level of ['log', 'warn', 'error']) {
    saved[level] = console[level];
    console[level] = (...args) => logs.push(args.join(' '));
  }
  delete require.cache[DB_FILE];
  db = require(DB_FILE);
  ({ t } = require('../i18n'));
  const { createLivePolls } = require('../services/livePolls');
  livePollsStub.livePolls = createLivePolls({
    emit: () => {},
    send: (streamerId, text) => said.push([streamerId, text]),
    getStreamer: (id) => db.getStreamerById(id),
    fetchLatest: async () => latest,
  });
  const { requireActiveStreamer, applyAccountStatus } = require('../services/streamerAccess');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const id = Number(req.get('x-test-streamer'));
    req.streamer = id ? db.getStreamerById(id) : undefined;
    applyAccountStatus(req);
    res.locals.t = (key, params) => t('en', key, params);
    next();
  });
  app.use('/dashboard', requireActiveStreamer, require('./polls'));
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = server.address().port;
});

after(async () => {
  for (const level of ['log', 'warn', 'error']) console[level] = saved[level];
  Module._load = saved.load;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  helix.calls = [];
  helix.refuse = null;
  helix.hold = null;
  said.length = 0;
  logs.length = 0;
  latest.poll = null;
  latest.prediction = null;
});

const SCOPES = 'channel:read:subscriptions channel:manage:polls channel:manage:predictions';
let counter = 0;
function addStreamer(over = {}) {
  const n = ++counter;
  const cols = { discord_user_id: `73000000000000${String(n).padStart(4, '0')}`, discord_username: `polls${n}`, twitch_user_id: `90${n}`, twitch_username: `synthetic_polls_${n}`, broadcaster_scopes: SCOPES, ...over };
  const names = Object.keys(cols);
  return Number(db.db.prepare(`INSERT INTO streamers (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((k) => cols[k])).lastInsertRowid);
}

const poll = { kind: 'poll', title: 'Top 5 finish?', choices: ['Yes', 'No'], durationSeconds: 120, pointsPerVote: null };
const prediction = { kind: 'prediction', title: 'Clean first lap?', choices: ['Clean', 'Chaos'], durationSeconds: 60 };
const start = (id, body) => request('POST', '/dashboard/api/polls/start', { streamer: id, body });

describe('templates', () => {
  test('added, changed and deleted — a streamer\'s own only', async () => {
    const id = addStreamer();
    const added = await request('POST', '/dashboard/api/poll-templates', { streamer: id, body: poll });
    assert.equal(added.status, 201);
    const template = added.json().template;
    assert.deepEqual({ ...template, id: 0 }, { id: 0, kind: 'poll', title: 'Top 5 finish?', choices: ['Yes', 'No'], durationSeconds: 120, pointsPerVote: null, sortOrder: 1 });
    const edited = await request('PATCH', `/dashboard/api/poll-templates/${template.id}`, { streamer: id, body: { title: 'Podium?' } });
    assert.equal(edited.status, 200);
    assert.equal(edited.json().template.title, 'Podium?');
    assert.deepEqual(edited.json().template.choices, ['Yes', 'No'], 'what the edit leaves out stays');
    const other = addStreamer();
    assert.equal((await request('PATCH', `/dashboard/api/poll-templates/${template.id}`, { streamer: other, body: { title: 'x' } })).status, 404);
    assert.equal((await request('DELETE', `/dashboard/api/poll-templates/${template.id}`, { streamer: other })).status, 404);
    assert.equal((await request('DELETE', `/dashboard/api/poll-templates/${template.id}`, { streamer: id })).status, 200);
    assert.deepEqual((await request('DELETE', `/dashboard/api/poll-templates/${template.id}`, { streamer: id })).json(),
      { ok: false, code: 'not_found', error: t('en', 'dashboard.settings.error.notFound') });
  });

  test('Twitch\'s limits are checked, each with its own text; the 21st template is refused', async () => {
    const id = addStreamer();
    const add = (body) => request('POST', '/dashboard/api/poll-templates', { streamer: id, body });
    const long = await add({ ...poll, title: 'x'.repeat(61) });
    assert.equal(long.status, 400);
    assert.deepEqual(long.json(), { ok: false, code: 'title_long', error: t('en', 'cards.polls.error.titleLong', { max: 60 }) });
    assert.equal((await add({ ...prediction, title: 'x'.repeat(46) })).json().error, t('en', 'cards.polls.error.titleLong', { max: 45 }));
    assert.equal((await add({ ...poll, choices: ['a', 'b', 'c', 'd', 'e', 'f'] })).json().error, t('en', 'cards.polls.error.choicesCount', { min: 2, max: 5 }));
    assert.equal((await add({ ...prediction, durationSeconds: 20 })).json().error, t('en', 'cards.polls.error.duration', { min: 30, max: 1800 }));
    for (let i = 0; i < 20; i++) db.addPollTemplate(id, { ...poll, title: `Poll ${i}` });
    const tooMany = await add(poll);
    assert.equal(tooMany.status, 409);
    assert.deepEqual(tooMany.json(), { ok: false, code: 'too_many', error: t('en', 'cards.polls.error.tooMany', { max: 20 }) });
  });
});

describe('starting', () => {
  test('a template starts on Twitch; the card gets it back running and the bot announces it', async () => {
    const id = addStreamer();
    const template = db.addPollTemplate(id, poll);
    const res = await start(id, { templateId: template.id });
    assert.equal(res.status, 200);
    assert.deepEqual(helix.calls, [['createPoll', id, poll]]);
    assert.equal(res.json().live.poll.title, 'Top 5 finish?');
    assert.equal(res.json().live.poll.state, 'running');
    assert.deepEqual(res.json().live.status, { text: t('en', 'cards.polls.status.pollRunning'), tone: 'ok' });
    assert.deepEqual(said, [[id, 'Poll: Top 5 finish? — vote now! (2:00 to vote)']]);
  });

  test('a one-off prediction starts without being saved', async () => {
    const id = addStreamer();
    const res = await start(id, prediction);
    assert.equal(res.status, 200);
    assert.deepEqual(helix.calls, [['createPrediction', id, { ...prediction, pointsPerVote: null }]]);
    assert.equal(db.countPollTemplates(id), 0);
    assert.equal(res.json().live.prediction.state, 'running');
  });

  test('one of the same kind running is refused without asking Twitch; a prediction may start beside a poll', async () => {
    const id = addStreamer();
    await start(id, poll);
    const again = await start(id, poll);
    assert.equal(again.status, 409);
    assert.deepEqual(again.json(), { ok: false, code: 'running', error: t('en', 'cards.polls.error.running') });
    assert.equal((await start(id, prediction)).status, 200);
    assert.deepEqual(helix.calls.map(([name]) => name), ['createPoll', 'createPrediction']);
  });

  test('two clicks at once start one poll', async () => {
    const id = addStreamer();
    let release;
    helix.hold = new Promise((resolve) => { release = resolve; });
    const first = start(id, poll);
    for (let i = 0; i < 200 && helix.calls.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await start(id, poll);
    release();
    assert.equal((await first).status, 200);
    assert.equal(second.status, 409);
    assert.equal(second.json().code, 'running');
    assert.equal(helix.calls.length, 1);
  });

  test('Twitch\'s refusals come back with their texts, and are logged', async () => {
    const id = addStreamer();
    helix.refuse = 'not_affiliate';
    const notAffiliate = await start(id, poll);
    assert.equal(notAffiliate.status, 409);
    assert.deepEqual(notAffiliate.json(), { ok: false, code: 'not_affiliate', error: t('en', 'cards.polls.error.notAffiliate') });
    helix.refuse = 'twitch_failed';
    const failed = await start(id, poll);
    assert.equal(failed.status, 502);
    assert.deepEqual(failed.json(), { ok: false, code: 'twitch_failed', error: t('en', 'cards.polls.error.twitchFailed') });
    helix.refuse = 'automod';
    assert.equal((await start(id, poll)).json().error, t('en', 'cards.polls.error.automod'));
    assert.ok(logs.some((line) => line.includes('twitch_failed')));
  });

  test('another streamer\'s template, or a one-off past a limit, is refused before Twitch', async () => {
    const id = addStreamer();
    const theirs = db.addPollTemplate(addStreamer(), poll);
    assert.equal((await start(id, { templateId: theirs.id })).status, 404);
    assert.equal((await start(id, { ...poll, choices: ['only'] })).json().code, 'choices_count');
    assert.deepEqual(helix.calls, []);
  });
});

describe('the running poll and prediction', () => {
  test('End now, Lock now, a winner and Cancel go to Twitch with the ids the card sends; the card gets the new state', async () => {
    const id = addStreamer();
    const ended = await request('POST', '/dashboard/api/polls/end', { streamer: id, body: { id: 'poll-1' } });
    assert.equal(ended.json().live.poll.state, 'ended');
    const locked = await request('POST', '/dashboard/api/predictions/lock', { streamer: id, body: { id: 'pred-1' } });
    assert.equal(locked.json().live.prediction.state, 'locked');
    const resolved = await request('POST', '/dashboard/api/predictions/resolve', { streamer: id, body: { id: 'pred-1', outcomeId: 'o1' } });
    assert.equal(resolved.json().live.prediction.result, 'won');
    await request('POST', '/dashboard/api/predictions/cancel', { streamer: id, body: { id: 'pred-2' } });
    assert.deepEqual(helix.calls, [['endPoll', id, 'poll-1'], ['lockPrediction', id, 'pred-1'], ['resolvePrediction', id, 'pred-1', 'o1'], ['cancelPrediction', id, 'pred-2']]);
  });

  test('an id that is not one, or a winner without its outcome, is refused before Twitch', async () => {
    const id = addStreamer();
    for (const [urlPath, body] of [
      ['/dashboard/api/polls/end', {}],
      ['/dashboard/api/polls/end', { id: 'x'.repeat(65) }],
      ['/dashboard/api/predictions/lock', { id: '../etc' }],
      ['/dashboard/api/predictions/resolve', { id: 'pred-1' }],
      ['/dashboard/api/predictions/cancel', { id: 42 }],
    ]) {
      const res = await request('POST', urlPath, { streamer: id, body });
      assert.equal(res.status, 400, `${urlPath} ${JSON.stringify(body)}`);
      assert.equal(res.json().code, 'invalid');
    }
    assert.deepEqual(helix.calls, []);
  });

  test('without the two permissions every Twitch button and the live view ask for a reconnect, and Twitch is not asked', async () => {
    const id = addStreamer({ broadcaster_scopes: 'channel:read:subscriptions' });
    for (const [method, urlPath, body] of [
      ['POST', '/dashboard/api/polls/start', poll], ['POST', '/dashboard/api/polls/end', { id: 'poll-1' }],
      ['POST', '/dashboard/api/predictions/lock', { id: 'pred-1' }], ['POST', '/dashboard/api/predictions/resolve', { id: 'pred-1', outcomeId: 'o1' }],
      ['POST', '/dashboard/api/predictions/cancel', { id: 'pred-1' }], ['GET', '/dashboard/api/polls/live', undefined],
    ]) {
      const res = await request(method, urlPath, { streamer: id, body });
      assert.equal(res.status, 409, urlPath);
      assert.deepEqual(res.json(), { ok: false, code: 'needs_reconnect', error: t('en', 'cards.polls.error.reconnect') }, urlPath);
    }
    assert.deepEqual(helix.calls, []);
  });
});

describe('the live view', () => {
  test('a poll started on Twitch\'s own dashboard shows, read from Twitch when no event came', async () => {
    const id = addStreamer();
    latest.poll = { id: 'poll-9', title: 'Started on Twitch', status: 'ACTIVE', duration: 120, started_at: iso(Date.now()), choices: [{ id: 'a', title: 'Yes', votes: 3 }, { id: 'b', title: 'No', votes: 1 }] };
    const res = await request('GET', '/dashboard/api/polls/live', { streamer: id });
    assert.equal(res.status, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.poll.id, 'poll-9');
    assert.deepEqual(body.poll.options.map((o) => o.percent), [75, 25]);
    assert.equal(body.prediction, null);
    assert.equal(typeof body.serverNow, 'number');
    assert.deepEqual(body.status, { text: t('en', 'cards.polls.status.pollRunning'), tone: 'ok' });
  });

  test('a streamer Twitch called not an Affiliate gets the card\'s status line, its one step, not "Ready"', async () => {
    const id = addStreamer({ cp_affiliate_status: 'not_affiliate' });
    db.addPollTemplate(id, poll);
    const res = await request('GET', '/dashboard/api/polls/live', { streamer: id });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json().status, { text: t('en', 'cards.polls.status.notAffiliate'), tone: 'warn' });
  });

  test('a logged-out request is sent to the login page', async () => {
    const res = await request('GET', '/dashboard/api/polls/live');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/auth/login');
  });
});

describe('Check again (not an Affiliate)', () => {
  test('forgets Twitch\'s earlier refusal, so the card offers its buttons again', async () => {
    const id = addStreamer({ cp_affiliate_status: 'not_affiliate' });
    const res = await request('POST', '/dashboard/api/polls/affiliate-check', { streamer: id });
    assert.equal(res.status, 200);
    assert.equal(db.getStreamerById(id).cp_affiliate_status, null);
  });
});
