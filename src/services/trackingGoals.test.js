'use strict';

// The follower and sub goals (services/trackingGoals.js) against the real src/db.js on an in-memory SQLite database
// (the stub pattern of src/db.tracking.test.js; nothing touches data/bot.db), with Twitch's reads stubbed, the bus
// captured and a clock the tests move. All ids and names are synthetic.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const DB_FILE = path.join(__dirname, '..', 'db.js');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

let db;
let createTrackingGoals;
let parseGoalFields;
let parseGoalEdit;
let counter = 0;

before(() => {
  const origLoad = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
      if (request === './config') return { adminDiscordIds: [] };
    }
    return origLoad(request, parent, isMain);
  };
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try {
    delete require.cache[DB_FILE];
    db = require(DB_FILE);
  } finally {
    console.log = log;
    console.error = error;
    Module._load = origLoad;
  }
  ({ createTrackingGoals, parseGoalFields, parseGoalEdit } = require('./trackingGoals'));
});

const MIN = 60e3;
const HOUR = 3600e3;
const DAY = 86400e3;
const sqlite = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

function addStreamer(over = {}) {
  const n = ++counter;
  const id = Number(db.db.prepare('INSERT INTO streamers (discord_user_id, discord_username, twitch_user_id, twitch_username) VALUES (?, ?, ?, ?)')
    .run(`73000000000000${String(n).padStart(4, '0')}`, `goal${n}`, `9100${n}`, `chan${n}`).lastInsertRowid);
  for (const [column, value] of Object.entries(over)) db.db.prepare(`UPDATE streamers SET ${column} = ? WHERE id = ?`).run(value, id);
  return id;
}

function insertEventAt(streamerId, kind, createdAt, over = {}) {
  db.db.prepare(`INSERT INTO tracking_events (streamer_id, kind, sub_type, twitch_user_id, username, count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(streamerId, kind, over.subType || null, over.twitchUserId || null, 'x', over.count || 1, createdAt);
}

const twitchError = (code) => Object.assign(new Error(`stub ${code}`), { code });

// A world: the service with stubbed Twitch reads (each answer is a value, an Error to throw, or a function of the
// streamer), the bus events it emitted, what it logged, and the clock.
function setup({ t = Date.now(), followerTotal = 0, subscriberTotal = 0, followersSince = { followers: [], complete: true } } = {}) {
  const world = { t, emitted: [], calls: [], logs: [], answers: { followerTotal, subscriberTotal, followersSince } };
  const answer = (name) => async (streamer, ...args) => {
    world.calls.push({ name, streamer, args });
    const a = world.answers[name];
    const v = typeof a === 'function' ? a(streamer, ...args) : a;
    if (v instanceof Error) throw v;
    return v;
  };
  world.tg = createTrackingGoals({
    db,
    twitch: { followerTotal: answer('followerTotal'), subscriberTotal: answer('subscriberTotal'), followersSince: answer('followersSince') },
    emit: (channel, payload) => world.emitted.push({ channel, payload }),
    now: () => world.t,
    logger: Object.fromEntries(['log', 'warn', 'error'].map((level) => [level, (...args) => world.logs.push({ level, text: args.join(' ') })])),
  });
  world.last = () => world.emitted[world.emitted.length - 1];
  world.reads = (name) => world.calls.filter((c) => c.name === name).length;
  return world;
}

const fields = (over = {}) => {
  const parsed = parseGoalFields({ title: 'Goal', target: 100, barColor: '#3366ff', period: 'lifetime', ...over });
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  return parsed.fields;
};

// The background read-back a period follower goal starts: the stubs answer at once, so one turn finishes it.
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('parseGoalFields', () => {
  test('reads a calendar month goal in a time zone, under camelCase or column names', () => {
    assert.deepEqual(parseGoalFields({ title: '  Road to 500  ', target: '500', barColor: '#AA00ff', period: 'month', mode: 'calendar', timeZone: 'Europe/Lisbon' }), {
      ok: true,
      fields: { title: 'Road to 500', target: 500, bar_color: '#AA00ff', period: 'month', mode: 'calendar', hours: null, time_zone: 'Europe/Lisbon' },
    });
    assert.equal(parseGoalFields({ title: 'x', target: 5, bar_color: '#000000', period: 'week', mode: 'rolling', time_zone: 'UTC' }).fields.bar_color, '#000000');
  });

  test('a goal without a colour gets the default; lifetime and hours goals keep no mode or zone', () => {
    assert.equal(parseGoalFields({ title: 'x', target: 5, period: 'lifetime' }).fields.bar_color, '#22c55e');
    assert.deepEqual(parseGoalFields({ title: 'x', target: 5, period: 'hours', hours: '24', timeZone: 'Mars/Base', mode: 'nonsense' }).fields,
      { title: 'x', target: 5, bar_color: '#22c55e', period: 'hours', mode: 'calendar', hours: 24, time_zone: null });
    assert.equal(parseGoalFields({ title: 'x', target: 5, period: 'day', mode: 'rolling', timeZone: 'Mars/Base' }).fields.time_zone, null);
  });

  test('refuses a time zone that is not an IANA name (Mars/Base), or none, for a calendar goal', () => {
    assert.deepEqual(parseGoalFields({ title: 'x', target: 5, period: 'month', mode: 'calendar', timeZone: 'Mars/Base' }), { ok: false, error: 'bad_zone' });
    assert.deepEqual(parseGoalFields({ title: 'x', target: 5, period: 'year', mode: 'calendar' }), { ok: false, error: 'bad_zone' });
  });

  test('names what is wrong', () => {
    const base = { title: 'x', target: 5, period: 'lifetime' };
    const cases = [
      [{ title: '   ' }, 'bad_title'], [{ title: 'y'.repeat(61) }, 'bad_title'], [{ title: 42 }, 'bad_title'],
      [{ target: 0 }, 'bad_target'], [{ target: 1.5 }, 'bad_target'], [{ target: 10000001 }, 'bad_target'], [{ target: 'abc' }, 'bad_target'],
      [{ barColor: 'red' }, 'bad_color'], [{ barColor: '#12345' }, 'bad_color'],
      [{ period: 'decade' }, 'bad_period'], [{ period: undefined }, 'bad_period'],
      [{ period: 'month', mode: 'sliding', timeZone: 'UTC' }, 'bad_mode'],
      [{ period: 'hours', hours: 0 }, 'bad_hours'], [{ period: 'hours', hours: 721 }, 'bad_hours'], [{ period: 'hours', hours: 2.5 }, 'bad_hours'],
    ];
    for (const [over, error] of cases) assert.deepEqual(parseGoalFields({ ...base, ...over }), { ok: false, error }, JSON.stringify(over));
    assert.deepEqual(parseGoalFields(null), { ok: false, error: 'bad_title' });
    assert.equal(parseGoalFields({ ...base, title: 'y'.repeat(60), target: 10000000 }).ok, true);
  });
});

describe('parseGoalEdit', () => {
  test('takes title, target and colour with the same rules and codes; no colour keeps the goal\'s', () => {
    assert.deepEqual(parseGoalEdit({ title: ' Next ', target: '60', barColor: '#ff0000', period: 'decade' }),
      { ok: true, fields: { title: 'Next', target: 60, bar_color: '#ff0000' } });
    assert.deepEqual(parseGoalEdit({ title: 'x', target: 5 }), { ok: true, fields: { title: 'x', target: 5, bar_color: null } });
    assert.deepEqual(parseGoalEdit({ title: 'x', target: 0 }), { ok: false, error: 'bad_target' });
    assert.deepEqual(parseGoalEdit({ title: '', target: 5 }), { ok: false, error: 'bad_title' });
    assert.deepEqual(parseGoalEdit({ title: 'x', target: 5, color: 'blue' }), { ok: false, error: 'bad_color' });
    assert.deepEqual(parseGoalEdit(undefined), { ok: false, error: 'bad_title' });
  });
});

describe('lifetime goals', () => {
  test('starting one reads the Twitch total with the streamer row from the database, and broadcasts it', async () => {
    const s = addStreamer();
    const w = setup({ followerTotal: 120 });
    const payload = await w.tg.startGoal({ id: s }, 'follow', fields({ target: 200 }));
    assert.equal(w.calls[0].streamer.twitch_user_id, `9100${counter}`);
    assert.deepEqual(payload, {
      id: payload.id, kind: 'follow', title: 'Goal', current: 120, target: 200, percent: 60, completed: false,
      barColor: '#3366ff', period: 'lifetime', mode: null, unavailable: null, capped: false,
    });
    assert.deepEqual(w.tg.progressOf(s, 'follow'), payload);
    assert.equal(w.last().channel, `trackgoal:${s}:follow`);
    assert.deepEqual(w.last().payload, { type: 'track_goal', goal: payload, justCompleted: false });
    assert.equal(w.tg.progressOf(s, 'sub'), null);
  });

  test('a follow adds 1 and broadcasts added: 1; a re-follow by the same viewer adds nothing', async () => {
    const s = addStreamer();
    const w = setup({ followerTotal: 120 });
    await w.tg.startGoal({ id: s }, 'follow', fields({ target: 200 }));
    w.tg.recordEvent(s, 'follow', { twitchUserId: '501', username: 'viewer' });
    assert.equal(w.last().payload.goal.current, 121);
    assert.equal(w.last().payload.added, 1);
    assert.equal(w.last().payload.justCompleted, false);
    w.tg.recordEvent(s, 'follow', { twitchUserId: '501', username: 'viewer' });
    assert.equal(w.last().payload.goal.current, 121);
    assert.equal(w.last().payload.added, undefined);
  });

  test('crossing the target sets justCompleted exactly once, and the bar stays full', async () => {
    const s = addStreamer();
    const w = setup({ followerTotal: 120 });
    await w.tg.startGoal({ id: s }, 'follow', fields({ target: 122 }));
    const seen = [];
    for (const id of ['1', '2', '3']) {
      w.tg.recordEvent(s, 'follow', { twitchUserId: id, username: `v${id}` });
      seen.push([w.last().payload.goal.current, w.last().payload.justCompleted, w.last().payload.goal.completed]);
    }
    assert.deepEqual(seen, [[121, false, false], [122, true, true], [123, false, true]]);
    w.tg.nudgeGoal(s, 'follow', -5);
    assert.equal(w.tg.progressOf(s, 'follow').current, 118);
    assert.equal(w.tg.progressOf(s, 'follow').percent, 100);
    assert.equal(w.tg.progressOf(s, 'follow').completed, true);
  });

  test('a sub goal adds new and gifted subs to Twitch\'s total, not resubs (already in it)', async () => {
    const s = addStreamer();
    const w = setup({ subscriberTotal: 40 });
    await w.tg.startGoal({ id: s }, 'sub', fields({ target: 50 }));
    w.tg.recordEvent(s, 'sub', { subType: 'new', twitchUserId: '1', username: 'a' });
    w.tg.recordEvent(s, 'sub', { subType: 'gift', twitchUserId: '2', username: 'b', count: 5 });
    assert.equal(w.last().payload.added, 5);
    w.tg.recordEvent(s, 'sub', { subType: 'resub', twitchUserId: '3', username: 'c' });
    assert.equal(w.tg.progressOf(s, 'sub').current, 46);
  });

  test('a token without the scope shows needs_reconnect, a channel without subs not_affiliate — never current: 0', async () => {
    const s = addStreamer();
    const w = setup({ followerTotal: twitchError('needs_reconnect'), subscriberTotal: twitchError('not_affiliate') });
    const follow = await w.tg.startGoal({ id: s }, 'follow', fields());
    const sub = await w.tg.startGoal({ id: s }, 'sub', fields());
    assert.equal(follow.unavailable, 'needs_reconnect');
    assert.equal(follow.current, null);
    assert.equal(sub.unavailable, 'not_affiliate');
    assert.equal(sub.current, null);
    w.tg.recordEvent(s, 'follow', { twitchUserId: '9', username: 'v' });
    assert.equal(w.last().payload.goal.current, null);
    assert.equal(w.last().payload.added, undefined);
  });

  test('a start Twitch does not answer is refused with twitch_failed and leaves the active goal alone', async () => {
    const s = addStreamer();
    const w = setup({ followerTotal: 10 });
    const first = await w.tg.startGoal({ id: s }, 'follow', fields({ title: 'First' }));
    w.answers.followerTotal = twitchError('twitch_failed');
    await assert.rejects(w.tg.startGoal({ id: s }, 'follow', fields({ title: 'Second' })), { code: 'twitch_failed' });
    assert.equal(w.tg.progressOf(s, 'follow').id, first.id);
    assert.equal(w.tg.progressOf(s, 'follow').title, 'First');
  });

  test('tick re-reads a total older than 10 minutes only while a source is connected', async () => {
    const s = addStreamer();
    const w = setup({ followerTotal: 100 });
    const t0 = w.t;
    await w.tg.startGoal({ id: s }, 'follow', fields({ target: 500 }));
    w.answers.followerTotal = 150;

    w.tg.connected(s, 'follow', +1);
    w.t = t0 + 5 * MIN;
    await w.tg.tick();
    assert.equal(w.reads('followerTotal'), 1, 'read 5 minutes ago: not yet');

    w.tg.connected(s, 'follow', -1);
    w.t = t0 + 11 * MIN;
    await w.tg.tick();
    assert.equal(w.reads('followerTotal'), 1, 'no source open: no read');

    w.tg.connected(s, 'follow', +1);
    await w.tg.tick();
    assert.equal(w.reads('followerTotal'), 2);
    assert.equal(w.tg.progressOf(s, 'follow').current, 150);
    assert.deepEqual(w.last().payload, { type: 'track_goal', goal: w.tg.progressOf(s, 'follow'), justCompleted: false });
  });

  test('a re-read Twitch does not answer keeps the last total; a needs_reconnect sets unavailable until a read works again', async () => {
    const s = addStreamer();
    const w = setup({ followerTotal: 100 });
    await w.tg.startGoal({ id: s }, 'follow', fields({ target: 500 }));
    w.tg.connected(s, 'follow', +1);

    w.t += 11 * MIN;
    w.answers.followerTotal = twitchError('twitch_failed');
    await w.tg.tick();
    assert.equal(w.reads('followerTotal'), 2);
    assert.equal(w.tg.progressOf(s, 'follow').current, 100);
    assert.equal(w.tg.progressOf(s, 'follow').unavailable, null);

    w.t += 11 * MIN;
    w.answers.followerTotal = twitchError('needs_reconnect');
    await w.tg.tick();
    assert.equal(w.tg.progressOf(s, 'follow').unavailable, 'needs_reconnect');
    assert.equal(w.tg.progressOf(s, 'follow').current, null);

    w.t += 11 * MIN;
    w.answers.followerTotal = 140;
    await w.tg.tick();
    assert.equal(w.tg.progressOf(s, 'follow').unavailable, null);
    assert.equal(w.tg.progressOf(s, 'follow').current, 140);
  });
});

describe('logging', () => {
  test('a read Twitch does not answer is logged once while reads keep failing, and again after one worked', async () => {
    const s = addStreamer();
    const w = setup({ followerTotal: 100 });
    await w.tg.startGoal({ id: s }, 'follow', fields());
    w.tg.connected(s, 'follow', +1);
    const failures = () => w.logs.filter((l) => l.level === 'warn' && /did not answer/.test(l.text)).length;
    w.answers.followerTotal = twitchError('twitch_failed');
    for (let i = 0; i < 3; i++) {
      w.t += 11 * MIN;
      await w.tg.tick();
    }
    assert.equal(w.reads('followerTotal'), 4);
    assert.equal(failures(), 1);
    w.answers.followerTotal = 120;
    w.t += 11 * MIN;
    await w.tg.tick();
    w.answers.followerTotal = twitchError('twitch_failed');
    w.t += 11 * MIN;
    await w.tg.tick();
    assert.equal(failures(), 2);
  });
});

describe('calendar goals', () => {
  test('a month goal at its end writes the period (reached) and starts over at 0 with the same target', async () => {
    const s = addStreamer();
    const w = setup({ t: Date.parse('2026-10-16T12:00:00Z') });
    await w.tg.startGoal({ id: s }, 'sub', fields({ target: 3, period: 'month', mode: 'calendar', timeZone: 'Europe/Lisbon' }));
    insertEventAt(s, 'sub', '2026-10-05 10:00:00', { subType: 'gift', count: 2 });
    insertEventAt(s, 'sub', '2026-10-06 10:00:00', { subType: 'resub' });
    insertEventAt(s, 'sub', '2026-09-30 22:59:59', { subType: 'new' }); // 23:59:59 on Sep 30 in Lisbon
    assert.equal(w.tg.progressOf(s, 'sub').current, 3);

    w.t = Date.parse('2026-10-31T23:59:00Z'); // 23:59 WET, still October
    await w.tg.tick();
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM tracking_goal_periods WHERE streamer_id = ?').get(s).n, 0);

    w.t = Date.parse('2026-11-01T00:00:30Z');
    await w.tg.tick();
    const periods = db.db.prepare('SELECT period_start, period_end, count, target, reached FROM tracking_goal_periods WHERE streamer_id = ?').all(s);
    assert.deepEqual(periods, [{ period_start: '2026-09-30 23:00:00', period_end: '2026-11-01 00:00:00', count: 3, target: 3, reached: 1 }]);
    const next = w.tg.progressOf(s, 'sub');
    assert.equal(next.current, 0);
    assert.equal(next.target, 3);
    assert.equal(next.completed, false);
    assert.deepEqual(w.last().payload, { type: 'track_goal', goal: next, justCompleted: false });
  });

  test('a missed period is written as missed; a nudge counts in its own period only', async () => {
    const s = addStreamer();
    const w = setup({ t: Date.parse('2026-10-16T12:00:00Z') });
    await w.tg.startGoal({ id: s }, 'sub', fields({ target: 5, period: 'month', mode: 'calendar', timeZone: 'UTC' }));
    insertEventAt(s, 'sub', '2026-10-05 10:00:00', { subType: 'new' });
    w.tg.nudgeGoal(s, 'sub', 2);
    assert.equal(w.tg.progressOf(s, 'sub').current, 3);
    w.t = Date.parse('2026-11-01T00:01:00Z');
    await w.tg.tick();
    assert.deepEqual(db.db.prepare('SELECT count, reached FROM tracking_goal_periods WHERE streamer_id = ?').all(s), [{ count: 3, reached: 0 }]);
    assert.equal(w.tg.progressOf(s, 'sub').current, 0);
  });

  test('periods missed while the app was down are each written', async () => {
    const s = addStreamer();
    const w = setup({ t: Date.parse('2026-10-16T12:00:00Z') });
    await w.tg.startGoal({ id: s }, 'sub', fields({ target: 1, period: 'day', mode: 'calendar', timeZone: 'UTC' }));
    insertEventAt(s, 'sub', '2026-10-17 08:00:00', { subType: 'new' });
    w.t = Date.parse('2026-10-19T00:00:30Z');
    await w.tg.tick();
    assert.deepEqual(db.db.prepare('SELECT period_start, count, reached FROM tracking_goal_periods WHERE streamer_id = ? ORDER BY id').all(s), [
      { period_start: '2026-10-16 00:00:00', count: 0, reached: 0 },
      { period_start: '2026-10-17 00:00:00', count: 1, reached: 1 },
      { period_start: '2026-10-18 00:00:00', count: 0, reached: 0 },
    ]);
    assert.equal(db.getActiveTrackingGoal(s, 'sub').period_start, '2026-10-19 00:00:00');
  });

  test('a period sub goal counts new, gifted and resubs, a gift of 5 as 5', async () => {
    const s = addStreamer();
    const w = setup();
    await w.tg.startGoal({ id: s }, 'sub', fields({ target: 100, period: 'week', mode: 'calendar', timeZone: 'UTC' }));
    w.tg.recordEvent(s, 'sub', { subType: 'new', twitchUserId: '1', username: 'a' });
    w.tg.recordEvent(s, 'sub', { subType: 'resub', twitchUserId: '2', username: 'b' });
    w.tg.recordEvent(s, 'sub', { subType: 'gift', twitchUserId: '3', username: 'c', count: 5 });
    assert.equal(w.last().payload.added, 5);
    assert.equal(w.tg.progressOf(s, 'sub').current, 7);
  });

  test('a period sub goal of a channel known not to be an Affiliate shows not_affiliate', async () => {
    const s = addStreamer({ cp_affiliate_status: 'not_affiliate' });
    const w = setup();
    const payload = await w.tg.startGoal({ id: s }, 'sub', fields({ period: 'month', mode: 'rolling' }));
    assert.equal(payload.unavailable, 'not_affiliate');
    assert.equal(payload.current, null);
  });
});

describe('rolling goals', () => {
  test('the count drops when an event ages out of the window, while completed stays true and is not celebrated again', async () => {
    const s = addStreamer();
    const t = Date.now();
    const w = setup({ t });
    insertEventAt(s, 'follow', sqlite(t - 6 * DAY), { twitchUserId: 'a' });
    insertEventAt(s, 'follow', sqlite(t - DAY), { twitchUserId: 'b' });
    const start = await w.tg.startGoal({ id: s }, 'follow', fields({ target: 2, period: 'week', mode: 'rolling' }));
    await flush();
    assert.equal(w.calls[0].args[0], new Date(t - 7 * DAY).toISOString());
    assert.equal(start.current, 2);
    assert.equal(start.completed, true);
    assert.equal(w.emitted.filter((e) => e.payload.justCompleted).length, 1, 'the start celebrated, the read-back did not again');

    w.t = t + 1.5 * DAY;
    const later = w.tg.progressOf(s, 'follow');
    assert.equal(later.current, 1);
    assert.equal(later.completed, true);
    assert.equal(later.percent, 50);
    assert.equal(later.mode, 'rolling');

    w.tg.recordEvent(s, 'follow', { twitchUserId: 'c', username: 'c' });
    assert.equal(w.last().payload.goal.current, 2);
    assert.equal(w.last().payload.justCompleted, false);
  });

  test('an event recorded in the same second as the clock counts (the window runs up to now, not to a cut-off)', async () => {
    const s = addStreamer();
    const w = setup({ t: Math.floor(Date.now() / 1000) * 1000 });
    await w.tg.startGoal({ id: s }, 'sub', fields({ target: 10, period: 'day', mode: 'rolling' }));
    w.tg.recordEvent(s, 'sub', { subType: 'new', twitchUserId: '1', username: 'a' });
    assert.equal(w.last().payload.added, 1);
    assert.equal(w.tg.progressOf(s, 'sub').current, 1);
  });
});

describe('hours goals', () => {
  test('end by themselves at their end time and leave the bar empty', async () => {
    const s = addStreamer();
    const t = Date.now();
    const w = setup({ t });
    await w.tg.startGoal({ id: s }, 'follow', fields({ period: 'hours', hours: 2 }));
    assert.equal(w.reads('followersSince'), 0, 'an hours goal starts now: nothing to read back');
    w.t = t + HOUR;
    await w.tg.tick();
    assert.notEqual(w.tg.progressOf(s, 'follow'), null);
    w.t = t + 2 * HOUR + MIN;
    await w.tg.tick();
    assert.equal(w.tg.progressOf(s, 'follow'), null);
    assert.equal(db.getActiveTrackingGoal(s, 'follow'), null);
    assert.equal(db.getTrackingGoalHistory(s, 'follow')[0].type, 'goal');
    assert.deepEqual(w.last(), { channel: `trackgoal:${s}:follow`, payload: { type: 'track_goal', goal: null } });
  });
});

describe('the follower read-back of a period goal', () => {
  const followers = [
    { userId: '3', login: 'c', followedAt: '2026-10-15T08:00:00Z' },
    { userId: '2', login: 'b', followedAt: '2026-10-10T09:00:00Z' },
    { userId: '1', login: 'a', followedAt: '2026-10-03T10:00:00Z' },
  ];

  test('the goal starts at once from the record; the read-back then records the follows Atleta lacks, once', async () => {
    const s = addStreamer();
    insertEventAt(s, 'follow', '2026-10-10 09:00:02', { twitchUserId: '2' });
    const w = setup({ t: Date.parse('2026-10-16T12:00:00Z'), followersSince: { followers, complete: true } });
    const payload = await w.tg.startGoal({ id: s }, 'follow', fields({ period: 'month', mode: 'calendar', timeZone: 'Europe/Lisbon' }));
    assert.equal(payload.current, 1, 'from the record, before the read-back is done');
    await flush();
    assert.equal(w.calls[0].args[0], '2026-09-30T23:00:00.000Z');
    assert.equal(w.calls[0].args[1], 50);
    assert.equal(w.tg.progressOf(s, 'follow').current, 3);
    assert.equal(w.last().payload.goal.current, 3, 'the sources get the new count');
    assert.equal(w.last().payload.added, undefined, 'a read-back is no new follow to pop');
    const rows = () => db.db.prepare("SELECT twitch_user_id AS id, username, created_at FROM tracking_events WHERE streamer_id = ? AND kind = 'follow' ORDER BY created_at").all(s);
    assert.deepEqual(rows(), [
      { id: '1', username: 'a', created_at: '2026-10-03 10:00:00' },
      { id: '2', username: 'x', created_at: '2026-10-10 09:00:02' },
      { id: '3', username: 'c', created_at: '2026-10-15 08:00:00' },
    ]);
    await w.tg.startGoal({ id: s }, 'follow', fields({ period: 'month', mode: 'calendar', timeZone: 'Europe/Lisbon' }));
    await flush();
    assert.equal(rows().length, 3);
    assert.equal(w.tg.progressOf(s, 'follow').current, 3);
  });

  test('a start does not wait for the read-back', async () => {
    const s = addStreamer();
    let answer;
    const w = setup({ followersSince: () => new Promise((resolve) => { answer = resolve; }) });
    const payload = await w.tg.startGoal({ id: s }, 'follow', fields({ period: 'week', mode: 'rolling' }));
    assert.equal(payload.current, 0);
    assert.notEqual(db.getActiveTrackingGoal(s, 'follow'), null);
    answer({ followers: [{ userId: '1', login: 'a', followedAt: new Date(w.t - HOUR).toISOString() }], complete: true });
    await flush();
    assert.equal(w.tg.progressOf(s, 'follow').current, 1);
  });

  test('read back again at most every 30 minutes while a source is open, recording only what the record lacks', async () => {
    const s = addStreamer();
    const t = Date.parse('2026-10-16T12:00:00Z');
    const w = setup({ t, followersSince: { followers, complete: true } });
    await w.tg.startGoal({ id: s }, 'follow', fields({ period: 'month', mode: 'calendar', timeZone: 'UTC' }));
    await flush();
    w.answers.followersSince = { followers: [{ userId: '9', login: 'missed', followedAt: '2026-10-16T12:10:00Z' }, ...followers], complete: true };
    w.t = t + 31 * MIN;
    await w.tg.tick();
    assert.equal(w.reads('followersSince'), 1, 'no source open: no read-back');
    w.tg.connected(s, 'follow', +1);
    w.t = t + 29 * MIN;
    await w.tg.tick();
    assert.equal(w.reads('followersSince'), 1, 'not within 30 minutes');
    w.t = t + 31 * MIN;
    await w.tg.tick();
    assert.equal(w.reads('followersSince'), 2);
    assert.equal(w.tg.progressOf(s, 'follow').current, 4);
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM tracking_events WHERE streamer_id = ? AND kind = 'follow'").get(s).n, 4);
    w.t = t + 45 * MIN;
    await w.tg.tick();
    assert.equal(w.reads('followersSince'), 2);
  });

  test('after a calendar rollover the new period is read back as soon as a source is open', async () => {
    const s = addStreamer();
    const w = setup({ t: Date.parse('2026-10-31T23:50:00Z'), followersSince: { followers: [], complete: true } });
    await w.tg.startGoal({ id: s }, 'follow', fields({ period: 'month', mode: 'calendar', timeZone: 'UTC' }));
    await flush();
    w.tg.connected(s, 'follow', +1);
    w.answers.followersSince = { followers: [{ userId: '7', login: 'g', followedAt: '2026-11-01T00:00:10Z' }], complete: true };
    w.t = Date.parse('2026-11-01T00:00:30Z');
    await w.tg.tick();
    assert.equal(w.reads('followersSince'), 2);
    assert.equal(w.calls[1].args[0], '2026-11-01T00:00:00.000Z');
    assert.equal(w.tg.progressOf(s, 'follow').current, 1);
  });

  test('a read-back stopped at its cap says so (capped), until the next calendar period starts', async () => {
    const s = addStreamer();
    const w = setup({ t: Date.parse('2026-10-16T12:00:00Z'), followersSince: { followers, complete: false } });
    await w.tg.startGoal({ id: s }, 'follow', fields({ period: 'month', mode: 'calendar', timeZone: 'UTC' }));
    await flush();
    assert.equal(w.tg.progressOf(s, 'follow').capped, true);
    w.t = Date.parse('2026-11-01T00:00:30Z');
    await w.tg.tick();
    assert.equal(w.tg.progressOf(s, 'follow').capped, false);
  });

  test('a rolling goal stops saying capped once its whole window is in Atleta\'s record', async () => {
    const s = addStreamer();
    const t = Date.now();
    const w = setup({ t, followersSince: { followers: [], complete: false } });
    await w.tg.startGoal({ id: s }, 'follow', fields({ period: 'week', mode: 'rolling' }));
    await flush();
    assert.equal(w.tg.progressOf(s, 'follow').capped, true);
    w.t = t + 6 * DAY;
    assert.equal(w.tg.progressOf(s, 'follow').capped, true);
    w.t = t + 7 * DAY + MIN;
    assert.equal(w.tg.progressOf(s, 'follow').capped, false);
  });

  test('a token without the scope shows needs_reconnect; a later read-back while a source is open heals it', async () => {
    const s = addStreamer();
    const t = Date.parse('2026-10-16T12:00:00Z');
    const w = setup({ t, followersSince: twitchError('needs_reconnect') });
    await w.tg.startGoal({ id: s }, 'follow', fields({ period: 'month', mode: 'calendar', timeZone: 'UTC' }));
    await flush();
    assert.equal(w.tg.progressOf(s, 'follow').unavailable, 'needs_reconnect');
    assert.equal(w.tg.progressOf(s, 'follow').current, null);
    assert.equal(w.last().payload.goal.unavailable, 'needs_reconnect');

    w.answers.followersSince = { followers, complete: true };
    w.tg.connected(s, 'follow', +1);
    w.t = t + 20 * MIN;
    await w.tg.tick();
    assert.equal(w.reads('followersSince'), 1, 'not again within 30 minutes');
    w.t = t + 31 * MIN;
    await w.tg.tick();
    assert.equal(w.reads('followersSince'), 2);
    assert.equal(w.tg.progressOf(s, 'follow').unavailable, null);
    assert.equal(w.tg.progressOf(s, 'follow').current, 3);
  });

  test('a read-back Twitch does not answer leaves the goal counting from Atleta\'s record and is tried again later', async () => {
    const s = addStreamer();
    const t = Date.parse('2026-10-16T12:00:00Z');
    insertEventAt(s, 'follow', '2026-10-10 09:00:00', { twitchUserId: '2' });
    const w = setup({ t, followersSince: twitchError('twitch_failed') });
    await w.tg.startGoal({ id: s }, 'follow', fields({ period: 'month', mode: 'calendar', timeZone: 'UTC' }));
    await flush();
    assert.equal(w.tg.progressOf(s, 'follow').unavailable, null);
    assert.equal(w.tg.progressOf(s, 'follow').current, 1);
    w.answers.followersSince = { followers, complete: true };
    w.tg.connected(s, 'follow', +1);
    w.t = t + 31 * MIN;
    await w.tg.tick();
    assert.equal(w.tg.progressOf(s, 'follow').current, 3);
  });
});

describe('editing, nudging and ending', () => {
  test('a nudge never takes the shown count below 0; it can reach the target and celebrate', async () => {
    const s = addStreamer();
    const w = setup();
    await w.tg.startGoal({ id: s }, 'sub', fields({ target: 4, period: 'week', mode: 'rolling' }));
    w.tg.recordEvent(s, 'sub', { subType: 'new', twitchUserId: '1', username: 'a' });
    assert.equal(w.tg.nudgeGoal(s, 'sub', -10).current, 0);
    assert.equal(w.tg.nudgeGoal(s, 'sub', 4).current, 4);
    assert.equal(w.last().payload.added, 4);
    assert.equal(w.last().payload.justCompleted, true);
    assert.equal(w.tg.nudgeGoal(s, 'sub', 0), null);
    assert.equal(w.tg.nudgeGoal(s, 'follow', 1), null, 'no follower goal');
  });

  test('an edit changes title, target and colour; a new target the count already passes celebrates again', async () => {
    const s = addStreamer();
    const w = setup({ followerTotal: 50 });
    await w.tg.startGoal({ id: s }, 'follow', fields({ target: 40 }));
    assert.equal(w.tg.progressOf(s, 'follow').completed, true);
    const result = w.tg.editGoal(s, 'follow', { title: 'Next', target: 60, barColor: '#ff0000' });
    assert.equal(result.ok, true);
    const edited = result.goal;
    assert.equal(edited.completed, false);
    assert.equal(edited.title, 'Next');
    assert.equal(edited.barColor, '#ff0000');
    assert.equal(edited.period, 'lifetime', 'the period stays');
    assert.equal(w.last().payload.justCompleted, false);
    w.tg.editGoal(s, 'follow', { title: 'Next', target: 45 });
    assert.equal(w.last().payload.justCompleted, true);
    assert.equal(w.tg.progressOf(s, 'follow').barColor, '#ff0000', 'no colour sent: the colour stays');
    assert.deepEqual(w.tg.editGoal(s, 'sub', { title: 'x', target: 1 }), { ok: false, error: 'not_found' });
  });

  test('an edit with a bad target (or title, or colour) is refused and changes nothing', async () => {
    const s = addStreamer();
    const w = setup({ followerTotal: 5 });
    await w.tg.startGoal({ id: s }, 'follow', fields({ target: 40 }));
    const sent = w.emitted.length;
    assert.deepEqual(w.tg.editGoal(s, 'follow', { title: 'Next', target: 0 }), { ok: false, error: 'bad_target' });
    assert.deepEqual(w.tg.editGoal(s, 'follow', { title: 'Next', target: 'lots' }), { ok: false, error: 'bad_target' });
    assert.deepEqual(w.tg.editGoal(s, 'follow', { title: '', target: 50 }), { ok: false, error: 'bad_title' });
    assert.deepEqual(w.tg.editGoal(s, 'follow', { title: 'Next', target: 50, barColor: 'red' }), { ok: false, error: 'bad_color' });
    assert.equal(w.tg.progressOf(s, 'follow').target, 40);
    assert.equal(w.emitted.length, sent);
  });

  test('ending a goal clears its bar and touches only that kind', async () => {
    const s = addStreamer();
    const w = setup({ followerTotal: 1, subscriberTotal: 1 });
    await w.tg.startGoal({ id: s }, 'follow', fields());
    await w.tg.startGoal({ id: s }, 'sub', fields());
    assert.equal(w.tg.endGoal(s, 'follow'), true);
    assert.deepEqual(w.last(), { channel: `trackgoal:${s}:follow`, payload: { type: 'track_goal', goal: null } });
    assert.equal(w.tg.progressOf(s, 'follow'), null);
    assert.notEqual(w.tg.progressOf(s, 'sub'), null);
    assert.equal(w.tg.endGoal(s, 'follow'), false);
  });
});

describe('the record', () => {
  test('every follow and sub is written even without a goal; other kinds are ignored', () => {
    const s = addStreamer();
    const w = setup();
    w.tg.recordEvent(s, 'follow', { twitchUserId: '1', username: 'a' });
    w.tg.recordEvent(s, 'sub', { subType: 'gift', twitchUserId: '2', username: 'b', count: 3 });
    w.tg.recordEvent(s, 'raid', { username: 'c' });
    assert.equal(db.countTrackingEvents(s, 'follow', null, null), 1);
    assert.equal(db.countTrackingEvents(s, 'sub', null, null), 3);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM tracking_events WHERE streamer_id = ?').get(s).n, 2);
    assert.equal(w.emitted.length, 0);
  });
});

describe('open sources', () => {
  test('the count per streamer and kind never goes below 0', async () => {
    const s = addStreamer();
    const w = setup({ followerTotal: 1 });
    const t0 = w.t;
    await w.tg.startGoal({ id: s }, 'follow', fields());
    w.tg.connected(s, 'follow', -1);
    w.tg.connected(s, 'follow', +1);
    w.t = t0 + 11 * MIN;
    await w.tg.tick();
    assert.equal(w.reads('followerTotal'), 2, 'one open source after a stray -1');
    w.tg.connected(s, 'follow', -1);
    w.tg.connected(s, 'sub', +1);
    w.t = t0 + 22 * MIN;
    await w.tg.tick();
    assert.equal(w.reads('followerTotal'), 2, 'the sub source does not keep the follower goal reading');
  });
});

describe('test mode', () => {
  test('plays on the live bar without saving and reverts to the real state after 10 s', async (t) => {
    const s = addStreamer();
    const w = setup({ followerTotal: 10 });
    await w.tg.startGoal({ id: s }, 'follow', fields({ target: 20 }));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const sent = w.tg.sendTest(s, 'follow', { added: 3 });
    assert.deepEqual(sent, w.last().payload, 'it returns the message it emitted (the page draws it in its preview)');
    assert.deepEqual(w.last().payload, {
      type: 'track_goal', test: true, added: 3, justCompleted: false,
      goal: { ...w.tg.progressOf(s, 'follow'), current: 13, percent: 65 },
    });
    assert.equal(w.tg.progressOf(s, 'follow').current, 10, 'nothing saved');

    assert.equal(w.tg.sendTest(s, 'follow', { reach: true }), w.last().payload);
    assert.equal(w.last().payload.goal.current, 20);
    assert.equal(w.last().payload.goal.completed, true);
    assert.equal(w.last().payload.justCompleted, true);

    const before = w.emitted.length;
    t.mock.timers.tick(9999);
    assert.equal(w.emitted.length, before);
    t.mock.timers.tick(1);
    assert.deepEqual(w.last().payload, { type: 'track_goal', goal: w.tg.progressOf(s, 'follow') });
  });

  test('endTest shows the real state at once; without a goal the test draws a sample bar, then clears it', (t) => {
    const s = addStreamer();
    const w = setup();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    assert.equal(w.tg.sendTest(s, 'sub', { added: 1, title: 'Sample' }), w.last().payload);
    const sample = w.last().payload.goal;
    assert.equal(sample.title, 'Sample');
    assert.equal(sample.kind, 'sub');
    assert.equal(sample.current, 1);
    assert.ok(sample.target > 1);
    w.tg.endTest(s, 'sub');
    assert.deepEqual(w.last(), { channel: `trackgoal:${s}:sub`, payload: { type: 'track_goal', goal: null } });
    const after = w.emitted.length;
    t.mock.timers.tick(10000);
    assert.equal(w.emitted.length, after, 'the revert timer was cleared');
    assert.equal(w.tg.sendTest(s, 'raid', {}), null);
  });

  test('a share of the target adds that part of it (at least 1, at most 1000), from the goal or the sample bar', async () => {
    const s = addStreamer();
    const w = setup();
    assert.equal(w.tg.sendTest(s, 'follow', { share: 0.05 }).added, 1, 'the sample bar (target 10): 5% is at least 1');
    w.tg.endTest(s, 'follow');
    await w.tg.startGoal({ id: s }, 'follow', fields({ target: 200 }));
    assert.equal(w.tg.sendTest(s, 'follow', { share: 0.05 }).added, 10);
    await w.tg.startGoal({ id: s }, 'follow', fields({ target: 1000000 }));
    assert.equal(w.tg.sendTest(s, 'follow', { share: 0.05 }).added, 1000, 'the cap');
    w.tg.endTest(s, 'follow');
  });
});

test('channel names the kind; KINDS are follow and sub', () => {
  const { channel, KINDS } = require('./trackingGoals');
  assert.equal(channel(7, 'follow'), 'trackgoal:7:follow');
  assert.deepEqual(KINDS, ['follow', 'sub']);
});
