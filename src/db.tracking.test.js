'use strict';

// The Tracking data in src/db.js (the follow/sub record, goals, finished goal periods, tracker values and settings),
// against the real file on an in-memory SQLite database (nothing touches data/bot.db). All ids are synthetic.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const DB_FILE = path.join(__dirname, 'db.js');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

let db;
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
});

function addStreamer(over = {}) {
  const n = ++counter;
  const id = Number(db.db.prepare('INSERT INTO streamers (discord_user_id, discord_username) VALUES (?, ?)')
    .run(`72000000000000${String(n).padStart(4, '0')}`, `track${n}`).lastInsertRowid);
  for (const [column, value] of Object.entries(over)) db.db.prepare(`UPDATE streamers SET ${column} = ? WHERE id = ?`).run(value, id);
  return id;
}

const goalFields = (over = {}) => ({ title: 'Goal', target: 100, bar_color: '#22c55e', period: 'month', mode: 'calendar', time_zone: 'Europe/Lisbon', ...over });
// A record row written with a created_at of our own (recordTrackingEvent always stamps "now").
function insertEventAt(streamerId, kind, createdAt, over = {}) {
  db.db.prepare(`INSERT INTO tracking_events (streamer_id, kind, sub_type, twitch_user_id, username, count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(streamerId, kind, over.subType || null, over.twitchUserId || null, over.username || 'x', over.count || 1, createdAt);
}
const n = (table, streamerId) => db.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE streamer_id = ?`).get(streamerId).n;

describe('the follow and sub record', () => {
  test('a re-follow by the same Twitch user inside a window counts once; a different user counts again', () => {
    const s = addStreamer();
    insertEventAt(s, 'follow', '2026-10-05 10:00:00', { twitchUserId: '100' });
    insertEventAt(s, 'follow', '2026-10-06 10:00:00', { twitchUserId: '100' });
    insertEventAt(s, 'follow', '2026-10-07 10:00:00', { twitchUserId: '200' });
    assert.equal(db.countTrackingEvents(s, 'follow', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'), 2);
  });

  test('follows without a Twitch user id count each', () => {
    const s = addStreamer();
    db.recordTrackingEvent(s, { kind: 'follow', username: 'a' });
    db.recordTrackingEvent(s, { kind: 'follow', username: 'a', twitchUserId: '' });
    db.recordTrackingEvent(s, { kind: 'follow', username: 'b', twitchUserId: '5' });
    assert.equal(db.countTrackingEvents(s, 'follow', null, null), 3);
  });

  test('a gift row of count 5 counts 5; sub types can be chosen', () => {
    const s = addStreamer();
    db.recordTrackingEvent(s, { kind: 'sub', subType: 'new', twitchUserId: '1', username: 'a' });
    db.recordTrackingEvent(s, { kind: 'sub', subType: 'gift', twitchUserId: '2', username: 'b', count: 5 });
    db.recordTrackingEvent(s, { kind: 'sub', subType: 'resub', twitchUserId: '3', username: 'c' });
    assert.equal(db.countTrackingEvents(s, 'sub', null, null), 7);
    assert.equal(db.countTrackingEvents(s, 'sub', null, null, { subTypes: ['gift'] }), 5);
    assert.equal(db.countTrackingEvents(s, 'sub', null, null, { subTypes: ['new', 'resub'] }), 2);
  });

  test('the window is [start, end): bounds as ISO or SQLite text, either side open, other kinds and streamers left out', () => {
    const s = addStreamer();
    const other = addStreamer();
    insertEventAt(s, 'follow', '2026-10-01 00:00:00', { twitchUserId: '1' });
    insertEventAt(s, 'follow', '2026-10-15 12:00:00', { twitchUserId: '2' });
    insertEventAt(s, 'follow', '2026-11-01 00:00:00', { twitchUserId: '3' });
    insertEventAt(s, 'sub', '2026-10-15 12:00:00', { subType: 'new' });
    insertEventAt(other, 'follow', '2026-10-15 12:00:00', { twitchUserId: '9' });
    assert.equal(db.countTrackingEvents(s, 'follow', '2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'), 2);
    assert.equal(db.countTrackingEvents(s, 'follow', '2026-10-01 00:00:00', '2026-11-01 00:00:00'), 2);
    assert.equal(db.countTrackingEvents(s, 'follow', '2026-10-02T00:00:00Z', null), 2);
    assert.equal(db.countTrackingEvents(s, 'follow', null, '2026-10-02T00:00:00Z'), 1);
    assert.equal(db.countTrackingEvents(s, 'sub', null, null), 1);
  });

  test('a row of a kind or sub type the record does not know is refused or cleaned', () => {
    const s = addStreamer();
    assert.equal(db.recordTrackingEvent(s, { kind: 'raid' }), null);
    db.recordTrackingEvent(s, { kind: 'sub', subType: 'weird', twitchUserId: '1' });
    db.recordTrackingEvent(s, { kind: 'sub', subType: 'new', twitchUserId: '2', count: 0 });
    assert.equal(db.db.prepare('SELECT sub_type FROM tracking_events WHERE streamer_id = ? AND twitch_user_id = ?').get(s, '1').sub_type, null);
    assert.equal(db.db.prepare('SELECT count FROM tracking_events WHERE streamer_id = ? AND twitch_user_id = ?').get(s, '2').count, 1);
  });

  test('a bound that is given but cannot be read as a time throws instead of opening the window', () => {
    const s = addStreamer();
    assert.throws(() => db.countTrackingEvents(s, 'follow', 'not a date', null), /time/i);
    assert.throws(() => db.countTrackingEvents(s, 'sub', null, '2026-13-45'), /time/i);
    assert.equal(db.countTrackingEvents(s, 'follow', '', ''), 0, 'an empty bound is an open bound');
  });

  test('cleanupOldTrackingEvents keeps a 399-day-old row and drops a 401-day-old one', () => {
    const s = addStreamer();
    db.db.prepare("INSERT INTO tracking_events (streamer_id, kind, twitch_user_id, created_at) VALUES (?, 'follow', 'keep', datetime('now', '-399 days'))").run(s);
    db.db.prepare("INSERT INTO tracking_events (streamer_id, kind, twitch_user_id, created_at) VALUES (?, 'follow', 'drop', datetime('now', '-401 days'))").run(s);
    db.cleanupOldTrackingEvents();
    const left = db.db.prepare('SELECT twitch_user_id FROM tracking_events WHERE streamer_id = ?').all(s).map((r) => r.twitch_user_id);
    assert.deepEqual(left, ['keep']);
  });

  // A follower goal's count runs on every follow and every tick while a source is open; with the Twitch id in the
  // index it never reads the table's rows.
  test('the record\'s index covers a follow count: (streamer, kind, time, Twitch id), the older three-column one gone', () => {
    const columns = db.db.prepare("PRAGMA index_info('idx_tracking_events_streamer_kind_date_user')").all().map((c) => c.name);
    assert.deepEqual(columns, ['streamer_id', 'kind', 'created_at', 'twitch_user_id']);
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'idx_tracking_events_streamer_kind_date'").get().n, 0);
    const plan = db.db.prepare(`EXPLAIN QUERY PLAN SELECT COUNT(DISTINCT NULLIF(twitch_user_id, '')) FROM tracking_events
      WHERE streamer_id = ? AND kind = 'follow' AND created_at >= ? AND created_at < ?`).all(1, '2026-10-01 00:00:00', '2026-11-01 00:00:00');
    assert.match(plan.map((p) => p.detail).join(' | '), /USING COVERING INDEX idx_tracking_events_streamer_kind_date_user/);
  });

  test('deleteTrackingEvents removes one streamer\'s whole record (another Twitch account linked) and no one else\'s', () => {
    const s = addStreamer();
    const other = addStreamer();
    insertEventAt(s, 'follow', '2026-10-05 10:00:00', { twitchUserId: '1' });
    insertEventAt(s, 'sub', '2026-10-06 10:00:00', { subType: 'new' });
    insertEventAt(other, 'follow', '2026-10-05 10:00:00', { twitchUserId: '1' });
    assert.equal(db.deleteTrackingEvents(s), 2);
    assert.equal(n('tracking_events', s), 0);
    assert.equal(n('tracking_events', other), 1);
  });
});

describe('goals', () => {
  test('a new goal is active with its fields and an empty nudge; another kind is left alone when one is replaced', () => {
    const s = addStreamer();
    const follow = db.createTrackingGoal(s, 'follow', goalFields({ title: 'F1' }));
    const sub = db.createTrackingGoal(s, 'sub', goalFields({ title: 'S1', period: 'lifetime', mode: 'calendar', time_zone: null }));
    assert.equal(follow.status, 'active');
    assert.equal(follow.title, 'F1');
    assert.equal(follow.target, 100);
    assert.equal(follow.period, 'month');
    assert.equal(follow.time_zone, 'Europe/Lisbon');
    assert.equal(follow.nudge, 0);
    assert.ok(follow.started_at);

    const follow2 = db.createTrackingGoal(s, 'follow', goalFields({ title: 'F2' }));
    assert.equal(db.getActiveTrackingGoal(s, 'follow').id, follow2.id);
    assert.equal(db.getActiveTrackingGoal(s, 'sub').id, sub.id);
    const old = db.db.prepare('SELECT * FROM tracking_goals WHERE id = ?').get(follow.id);
    assert.equal(old.status, 'ended');
    assert.ok(old.ended_at);
    assert.equal(db.getActiveTrackingGoal(addStreamer(), 'follow'), null);
  });

  test('camelCase field names work too, and a lifetime total given at the start is stamped as read', () => {
    const s = addStreamer();
    const g = db.createTrackingGoal(s, 'follow', { title: 'T', target: 5, barColor: '#ff0000', period: 'lifetime', timeZone: null, lifetimeTotal: 42 });
    assert.equal(g.bar_color, '#ff0000');
    assert.equal(g.lifetime_total, 42);
    assert.ok(g.lifetime_read_at);
  });

  test('updateTrackingGoal changes title, target and colour of the active goal only; a new target reopens completion', () => {
    const s = addStreamer();
    const other = addStreamer();
    const g = db.createTrackingGoal(s, 'follow', goalFields());
    db.setTrackingGoalCompleted(g.id);
    const same = db.updateTrackingGoal(g.id, s, { title: 'New title', target: 100, bar_color: '#112233' });
    assert.equal(same.title, 'New title');
    assert.equal(same.bar_color, '#112233');
    assert.ok(same.completed_at, 'the same target keeps the celebration');
    const bigger = db.updateTrackingGoal(g.id, s, { title: 'New title', target: 500, bar_color: '#112233' });
    assert.equal(bigger.target, 500);
    assert.equal(bigger.completed_at, null);
    assert.equal(db.updateTrackingGoal(g.id, other, { title: 'Hijack', target: 1, bar_color: '#000000' }), null);
    assert.equal(db.getActiveTrackingGoal(s, 'follow').title, 'New title');
    db.endTrackingGoal(g.id, s);
    assert.equal(db.updateTrackingGoal(g.id, s, { title: 'Late', target: 5, bar_color: '#000000' }).title, 'New title', 'an ended goal is not edited');
  });

  test('nudgeTrackingGoal never takes the shown count below 0', () => {
    const s = addStreamer();
    const g = db.createTrackingGoal(s, 'follow', goalFields());
    assert.equal(db.nudgeTrackingGoal(g.id, s, 10, 0).nudge, 10, 'a rise is never held back');
    // The goal shows 3 (base 3, nudge 0 after the rise is undone), so -50 stops at shown 0.
    const h = db.createTrackingGoal(s, 'sub', goalFields());
    assert.equal(db.nudgeTrackingGoal(h.id, s, -50, 3).nudge, -3);
    assert.equal(db.nudgeTrackingGoal(h.id, s, -1, 0).nudge, -3, 'already at 0: nothing lower');
    assert.equal(db.nudgeTrackingGoal(h.id, s, 2, 0).nudge, -1);
    assert.equal(db.nudgeTrackingGoal(g.id, addStreamer(), 5, 3), null, 'another streamer cannot nudge it');
  });

  test('nudgeTrackingGoal: floor is the count shown before the nudge (shown = base + nudge), from a nonzero base and nudge', () => {
    const s = addStreamer();
    // Base 10 from the record, nudge +5: the goal shows 15. A -100 stops at shown 0, never below.
    const a = db.createTrackingGoal(s, 'follow', goalFields());
    assert.equal(db.nudgeTrackingGoal(a.id, s, 5, 10).nudge, 5);
    assert.equal(db.nudgeTrackingGoal(a.id, s, -100, 15).nudge, -10, 'shown 15 - 15 = 0 with base 10');
    // Base 10, nudge -4: the goal shows 6. A -10 stops at shown 0 (nudge -10), not at shown 4.
    const b = db.createTrackingGoal(s, 'sub', goalFields());
    assert.equal(db.nudgeTrackingGoal(b.id, s, -4, 10).nudge, -4);
    assert.equal(db.nudgeTrackingGoal(b.id, s, -10, 6).nudge, -10, 'shown 6 - 6 = 0 with base 10');
    // A step that stays above 0 is taken whole; a rise is never held back.
    assert.equal(db.nudgeTrackingGoal(b.id, s, 3, 0).nudge, -7);
    assert.equal(db.nudgeTrackingGoal(b.id, s, -2, 3).nudge, -9, 'shown 3, -2 leaves 1');
  });

  test('setTrackingGoalCompleted stamps once and says whether this call did; setTrackingGoalLifetime stores the total and the read time', () => {
    const s = addStreamer();
    const g = db.createTrackingGoal(s, 'sub', goalFields({ period: 'lifetime' }));
    assert.equal(db.setTrackingGoalCompleted(g.id), true);
    const first = db.getActiveTrackingGoal(s, 'sub').completed_at;
    assert.ok(first);
    assert.equal(db.setTrackingGoalCompleted(g.id), false);
    assert.equal(db.getActiveTrackingGoal(s, 'sub').completed_at, first);
    db.setTrackingGoalLifetime(g.id, 1234);
    const row = db.getActiveTrackingGoal(s, 'sub');
    assert.equal(row.lifetime_total, 1234);
    assert.ok(row.lifetime_read_at);
  });

  test('a new goal has no Twitch state; setTrackingGoalTwitchState changes only what it is given', () => {
    const s = addStreamer();
    const g = db.createTrackingGoal(s, 'follow', goalFields());
    const state = () => db.db.prepare('SELECT twitch_unavailable, readback_at, readback_capped FROM tracking_goals WHERE id = ?').get(g.id);
    assert.deepEqual(state(), { twitch_unavailable: null, readback_at: null, readback_capped: 0 });
    db.setTrackingGoalTwitchState(g.id, { unavailable: 'needs_reconnect' });
    assert.deepEqual(state(), { twitch_unavailable: 'needs_reconnect', readback_at: null, readback_capped: 0 });
    db.setTrackingGoalTwitchState(g.id, { readbackAt: new Date('2026-10-16T12:30:00.700Z'), capped: true });
    assert.equal(state().twitch_unavailable, 'needs_reconnect');
    assert.equal(state().readback_at, '2026-10-16 12:30:00');
    assert.equal(state().readback_capped, 1);
    db.setTrackingGoalTwitchState(g.id, { unavailable: null, readbackAt: null, capped: false });
    assert.deepEqual(state(), { twitch_unavailable: null, readback_at: null, readback_capped: 0 });
    db.setTrackingGoalTwitchState(g.id, {});
    assert.deepEqual(state(), { twitch_unavailable: null, readback_at: null, readback_capped: 0 });
  });

  test('getActiveTrackingGoals lists the active goals of every streamer and kind', () => {
    const s = addStreamer();
    const t = addStreamer();
    const a = db.createTrackingGoal(s, 'follow', goalFields());
    const b = db.createTrackingGoal(s, 'sub', goalFields());
    const c = db.createTrackingGoal(t, 'follow', goalFields());
    db.endTrackingGoal(b.id, s);
    const ids = db.getActiveTrackingGoals().map((g) => g.id);
    assert.ok(ids.includes(a.id) && ids.includes(c.id));
    assert.ok(!ids.includes(b.id));
  });

  test('backfillTrackingFollows writes once each follower the record lacks since the start, at the time Twitch gives', () => {
    const s = addStreamer();
    insertEventAt(s, 'follow', '2026-10-10 09:00:00', { twitchUserId: '2' });
    insertEventAt(s, 'follow', '2026-09-20 09:00:00', { twitchUserId: '4' }); // before the window: not known in it
    const written = db.backfillTrackingFollows(s, [
      { userId: '1', login: 'a', followedAt: '2026-10-03T10:00:00Z' },
      { userId: '2', login: 'b', followedAt: '2026-10-10T09:00:00Z' },
      { userId: '1', login: 'a', followedAt: '2026-10-02T10:00:00Z' },
      { userId: '4', login: 'd', followedAt: '2026-10-05T10:00:00.500Z' },
      { userId: '', login: 'nobody', followedAt: '2026-10-05T10:00:00Z' },
      { userId: '5', login: 'e', followedAt: 'not a time' },
      null,
    ], '2026-10-01T00:00:00.000Z');
    assert.equal(written, 2);
    assert.deepEqual(db.db.prepare("SELECT twitch_user_id AS id, username, sub_type, count, created_at FROM tracking_events WHERE streamer_id = ? AND created_at >= '2026-10-01' ORDER BY created_at").all(s), [
      { id: '1', username: 'a', sub_type: null, count: 1, created_at: '2026-10-03 10:00:00' },
      { id: '4', username: 'd', sub_type: null, count: 1, created_at: '2026-10-05 10:00:00' },
      { id: '2', username: 'x', sub_type: null, count: 1, created_at: '2026-10-10 09:00:00' },
    ]);
    assert.equal(db.backfillTrackingFollows(s, [{ userId: '1', login: 'a', followedAt: '2026-10-03T10:00:00Z' }], '2026-10-01T00:00:00Z'), 0);
    assert.equal(db.backfillTrackingFollows(s, undefined, '2026-10-01T00:00:00Z'), 0);
  });

  test('endTrackingGoal ends the streamer\'s own active goal only', () => {
    const s = addStreamer();
    const g = db.createTrackingGoal(s, 'follow', goalFields());
    assert.equal(db.endTrackingGoal(g.id, addStreamer()).changes, 0);
    assert.equal(db.endTrackingGoal(g.id, s).changes, 1);
    assert.equal(db.getActiveTrackingGoal(s, 'follow'), null);
    assert.equal(db.endTrackingGoal(g.id, s).changes, 0);
  });

  test('rollTrackingGoal writes one period row and resets nudge and completion for the next period', () => {
    const s = addStreamer();
    const g = db.createTrackingGoal(s, 'follow', goalFields());
    db.nudgeTrackingGoal(g.id, s, 7, 0);
    db.setTrackingGoalCompleted(g.id);
    const rolled = db.rollTrackingGoal(g.id, {
      periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z',
      count: 120, target: 100, reached: true, nextStart: '2026-11-01T00:00:00.000Z',
    });
    assert.equal(rolled.nudge, 0);
    assert.equal(rolled.completed_at, null);
    assert.equal(rolled.period_start, '2026-11-01 00:00:00');
    assert.equal(rolled.status, 'active');
    const periods = db.db.prepare('SELECT * FROM tracking_goal_periods WHERE goal_id = ?').all(g.id);
    assert.equal(periods.length, 1);
    assert.equal(periods[0].streamer_id, s);
    assert.equal(periods[0].count, 120);
    assert.equal(periods[0].target, 100);
    assert.equal(periods[0].reached, 1);
    assert.equal(periods[0].period_start, '2026-10-01 00:00:00');
    assert.equal(periods[0].period_end, '2026-11-01 00:00:00');
    db.rollTrackingGoal(g.id, { periodStart: '2026-11-01T00:00:00Z', periodEnd: '2026-12-01T00:00:00Z', count: 3, target: 100, reached: false, nextStart: '2026-12-01T00:00:00Z' });
    assert.deepEqual(db.db.prepare('SELECT reached FROM tracking_goal_periods WHERE goal_id = ? ORDER BY id').all(g.id).map((r) => r.reached), [1, 0]);
  });

  test('rollTrackingGoal leaves an ended or unknown goal alone and writes nothing', () => {
    const s = addStreamer();
    const g = db.createTrackingGoal(s, 'follow', goalFields());
    db.nudgeTrackingGoal(g.id, s, 4, 0);
    db.endTrackingGoal(g.id, s);
    const roll = { periodStart: '2026-09-01T00:00:00Z', periodEnd: '2026-10-01T00:00:00Z', count: 1, target: 100, reached: false, nextStart: '2026-10-01T00:00:00Z' };
    assert.equal(db.rollTrackingGoal(g.id, roll), null);
    assert.equal(db.rollTrackingGoal(999999, roll), null);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM tracking_goal_periods WHERE goal_id = ?').get(g.id).n, 0);
    assert.equal(db.db.prepare('SELECT nudge FROM tracking_goals WHERE id = ?').get(g.id).nudge, 4, 'its nudge is untouched');
  });

  test('the history lists ended goals and finished periods, newest first, of that kind only, up to the limit', () => {
    const s = addStreamer();
    const g = db.createTrackingGoal(s, 'follow', goalFields({ title: 'Monthly' }));
    db.rollTrackingGoal(g.id, { periodStart: '2026-08-01T00:00:00Z', periodEnd: '2026-09-01T00:00:00Z', count: 10, target: 100, reached: false, nextStart: '2026-09-01T00:00:00Z' });
    db.rollTrackingGoal(g.id, { periodStart: '2026-09-01T00:00:00Z', periodEnd: '2026-10-01T00:00:00Z', count: 150, target: 100, reached: true, nextStart: '2026-10-01T00:00:00Z' });
    db.createTrackingGoal(s, 'sub', goalFields({ title: 'Sub goal' }));
    db.endTrackingGoal(g.id, s);

    const history = db.getTrackingGoalHistory(s, 'follow');
    assert.deepEqual(history.map((h) => h.type), ['goal', 'period', 'period']);
    assert.equal(history[0].title, 'Monthly');
    assert.equal(history[1].period_end, '2026-10-01 00:00:00');
    assert.equal(history[1].count, 150);
    assert.equal(history[1].reached, 1);
    assert.equal(history[1].title, 'Monthly');
    assert.equal(history[2].period_end, '2026-09-01 00:00:00');
    assert.equal(db.getTrackingGoalHistory(s, 'follow', 2).length, 2);
    assert.deepEqual(db.getTrackingGoalHistory(s, 'sub'), [], 'the sub goal is still active');
  });

  test('an ended goal keeps the count it showed (final_count): ended by hand, or replaced by a new goal; the history carries it and the time zone', () => {
    const s = addStreamer();
    const g = db.createTrackingGoal(s, 'follow', goalFields({ title: 'By hand' }));
    assert.equal(g.final_count, null);
    db.endTrackingGoal(g.id, s, 7);
    const replaced = db.createTrackingGoal(s, 'sub', goalFields({ title: 'Replaced' }));
    db.createTrackingGoal(s, 'sub', goalFields({ title: 'Replacing' }), { replacedCount: 12 });
    const final = (id) => db.db.prepare('SELECT final_count FROM tracking_goals WHERE id = ?').get(id).final_count;
    assert.equal(final(g.id), 7);
    assert.equal(final(replaced.id), 12);
    const quiet = db.createTrackingGoal(s, 'follow', goalFields({ title: 'No count' }));
    db.endTrackingGoal(quiet.id, s);
    assert.equal(final(quiet.id), null, 'no count given (an unavailable goal) stays unknown');

    const history = db.getTrackingGoalHistory(s, 'follow');
    assert.deepEqual(history.map((h) => [h.title, h.final_count, h.time_zone]), [['No count', null, 'Europe/Lisbon'], ['By hand', 7, 'Europe/Lisbon']]);
    const m = db.createTrackingGoal(s, 'follow', goalFields({ title: 'Rolled' }));
    db.rollTrackingGoal(m.id, { periodStart: '2026-08-31T23:00:00Z', periodEnd: '2026-09-30T23:00:00Z', count: 3, target: 100, reached: false, nextStart: '2026-09-30T23:00:00Z' });
    assert.equal(db.getTrackingGoalHistory(s, 'follow').find((h) => h.type === 'period').time_zone, 'Europe/Lisbon');
  });

  test('an ended goal in the history says whether it was reached (completed_at), so the page can show reached or missed', () => {
    const s = addStreamer();
    const missed = db.createTrackingGoal(s, 'sub', goalFields({ title: 'Missed', period: 'lifetime', mode: null, time_zone: null }));
    db.endTrackingGoal(missed.id, s);
    const reached = db.createTrackingGoal(s, 'sub', goalFields({ title: 'Reached', period: 'lifetime', mode: null, time_zone: null }));
    assert.equal(db.setTrackingGoalCompleted(reached.id), true);
    db.endTrackingGoal(reached.id, s);
    const byTitle = Object.fromEntries(db.getTrackingGoalHistory(s, 'sub').map((h) => [h.title, h]));
    assert.equal(byTitle.Missed.completed_at, null);
    assert.match(byTitle.Reached.completed_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  });
});

describe('trackers', () => {
  test('values are kept per streamer and tracker, replaced on set, and cleared together', () => {
    const s = addStreamer();
    const other = addStreamer();
    assert.deepEqual(db.getTrackerValues(s), {});
    db.setTrackerValue(s, 'latest_follower', '{"name":"a"}');
    db.setTrackerValue(s, 'latest_raid', { name: 'r', viewers: 9 });
    db.setTrackerValue(s, 'latest_follower', '{"name":"b"}');
    db.setTrackerValue(other, 'latest_follower', '{"name":"z"}');
    assert.deepEqual(db.getTrackerValues(s), { latest_follower: '{"name":"b"}', latest_raid: '{"name":"r","viewers":9}' });
    db.clearTrackerValues(s);
    assert.deepEqual(db.getTrackerValues(s), {});
    assert.deepEqual(db.getTrackerValues(other), { latest_follower: '{"name":"z"}' });
  });

  test('settings: a first save creates the row, a later one changes only what it is given', () => {
    const s = addStreamer();
    assert.deepEqual(db.getTrackerSettings(s), {});
    db.setTrackerSetting(s, 'latest_tip', { color: '#ff00aa' });
    assert.deepEqual(db.getTrackerSettings(s), { latest_tip: { enabled: 1, color: '#ff00aa' } });
    db.setTrackerSetting(s, 'latest_tip', { enabled: false });
    assert.deepEqual(db.getTrackerSettings(s), { latest_tip: { enabled: 0, color: '#ff00aa' } });
    db.setTrackerSetting(s, 'latest_tip', { enabled: true, color: null });
    assert.deepEqual(db.getTrackerSettings(s), { latest_tip: { enabled: 1, color: null } });
    db.setTrackerSetting(s, 'top_tipper', { enabled: false });
    assert.equal(Object.keys(db.getTrackerSettings(s)).length, 2);
  });

  test('ensureTrackerSettings writes a row, on and with no colour, for each tracker that has none, and leaves the others', () => {
    const s = addStreamer();
    db.setTrackerSetting(s, 'latest_tip', { enabled: false, color: '#ff00aa' });
    assert.equal(db.ensureTrackerSettings(s, ['latest_follower', 'latest_tip', 'top_tipper']), 2);
    assert.deepEqual(db.getTrackerSettings(s), {
      latest_follower: { enabled: 1, color: null },
      latest_tip: { enabled: 0, color: '#ff00aa' },
      top_tipper: { enabled: 1, color: null },
    });
    assert.equal(db.ensureTrackerSettings(s, ['latest_follower', 'latest_tip', 'top_tipper']), 0, 'a second time writes nothing');
  });
});

describe('getOverlayOrChatbotStreamers', () => {
  const ids = () => db.getOverlayOrChatbotStreamers().map((r) => r.id);

  test('keeps its rule for the overlay and the chatbot', () => {
    const overlay = addStreamer({ overlay_enabled: 1, chatbot_enabled: 0 });
    const chatbot = addStreamer({ overlay_enabled: 0, chatbot_enabled: 1 });
    const neither = addStreamer({ overlay_enabled: 0, chatbot_enabled: 0 });
    const off = addStreamer({ overlay_enabled: 1, enabled: 0 });
    assert.ok(ids().includes(overlay));
    assert.ok(ids().includes(chatbot));
    assert.ok(!ids().includes(neither));
    assert.ok(!ids().includes(off));
  });

  test('includes a streamer with the overlay and chatbot off but an active tracking goal', () => {
    const s = addStreamer({ overlay_enabled: 0, chatbot_enabled: 0 });
    assert.ok(!ids().includes(s));
    const g = db.createTrackingGoal(s, 'sub', goalFields());
    assert.ok(ids().includes(s));
    db.endTrackingGoal(g.id, s);
    assert.ok(!ids().includes(s), 'an ended goal does not count');
  });

  test('includes a streamer with an enabled tracker setting row, but not a disabled one, and never a disabled account', () => {
    const s = addStreamer({ overlay_enabled: 0, chatbot_enabled: 0 });
    db.setTrackerSetting(s, 'latest_follower', { enabled: false });
    assert.ok(!ids().includes(s));
    db.setTrackerSetting(s, 'latest_raid', { enabled: true });
    assert.ok(ids().includes(s));
    db.db.prepare('UPDATE streamers SET enabled = 0 WHERE id = ?').run(s);
    assert.ok(!ids().includes(s));
  });
});

describe('removing an account', () => {
  test('deletes the rows of all five tracking tables', () => {
    const s = addStreamer();
    const keep = addStreamer();
    for (const id of [s, keep]) {
      const g = db.createTrackingGoal(id, 'follow', goalFields());
      db.rollTrackingGoal(g.id, { periodStart: '2026-09-01T00:00:00Z', periodEnd: '2026-10-01T00:00:00Z', count: 1, target: 100, reached: false, nextStart: '2026-10-01T00:00:00Z' });
      db.recordTrackingEvent(id, { kind: 'follow', twitchUserId: '1', username: 'a' });
      db.setTrackerValue(id, 'latest_follower', 'x');
      db.setTrackerSetting(id, 'latest_follower', { enabled: true });
    }
    for (const t of ['tracking_events', 'tracking_goals', 'tracking_goal_periods', 'tracker_values', 'tracker_settings']) {
      assert.ok(n(t, s) > 0, `${t} has a row before`);
    }
    assert.equal(db.deleteStreamer(s), true);
    for (const t of ['tracking_events', 'tracking_goals', 'tracking_goal_periods', 'tracker_values', 'tracker_settings']) {
      assert.equal(n(t, s), 0, `${t} is empty after`);
      assert.ok(n(t, keep) > 0, `${t} keeps the other streamer's rows`);
    }
  });
});

describe('seeding the trackers at release (tracking_seed_trackers)', () => {
  const DAY_MS = 86400e3;
  const ago = (ms) => new Date(Date.now() - ms).toISOString().slice(0, 19).replace('T', ' ');
  const event = (streamerId, type, username, data, createdAt) => db.db.prepare(
    'INSERT INTO overlay_events (streamer_id, event_type, username, data, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(streamerId, type, username, typeof data === 'string' || data == null ? data : JSON.stringify(data), createdAt);
  const tip = (streamerId, name, amount, currency, createdAt) => db.db.prepare(
    "INSERT INTO donations (streamer_id, source, donor_name, amount, currency, created_at) VALUES (?, 'paypal', ?, ?, ?, ?)"
  ).run(streamerId, name, amount, currency, createdAt);
  const values = (streamerId) => Object.fromEntries(Object.entries(db.getTrackerValues(streamerId)).map(([k, v]) => [k, JSON.parse(v)]));

  test('fills each tracker from the newest event of its kind and the latest tip from the newest donation, as the trackers store them; no goal', () => {
    const s = addStreamer();
    event(s, 'follow', 'OldFan', { username: 'OldFan' }, ago(2 * DAY_MS));
    event(s, 'follow', 'NewFan', { username: 'NewFan' }, ago(3600e3));
    event(s, 'subscription', 'Loyal', { username: 'Loyal', tier: '2', months: 14 }, ago(3 * DAY_MS));
    event(s, 'giftsub', 'Gifter', { username: 'Gifter', tier: '1', amount: 5 }, ago(2 * DAY_MS)); // newer than the resub
    event(s, 'bits', 'Cheerer', { username: 'Cheerer', amount: 500 }, ago(DAY_MS));
    event(s, 'raid', 'Raider', { username: 'Raider', viewers: 42, login: 'raider', userId: '9002' }, ago(DAY_MS));
    event(s, 'donation', 'NotFromHere', { amount: 1000, currency: 'EUR' }, ago(60e3)); // the latest tip comes from donations
    tip(s, 'Older', 99, 'USD', ago(DAY_MS));
    tip(s, 'Tipper', 12.5, 'eur', ago(3600e3));

    assert.ok(db.seedTrackerValues() >= 5);

    assert.deepEqual(values(s), {
      latest_follower: { name: 'NewFan' },
      latest_sub: { name: 'Gifter', gifted: 5 },
      latest_bits: { name: 'Cheerer', amount: 500 },
      latest_raid: { name: 'Raider', viewers: 42 },
      latest_tip: { name: 'Tipper', amount: 12.5, currency: 'EUR' },
    });
    assert.equal(n('tracking_goals', s), 0, 'no goal is created');
  });

  test('an event past 30 days is not used, a value already stored is kept, a row without readable data uses its username, a tip without a name is Anonymous', () => {
    const s = addStreamer();
    event(s, 'follow', 'Ancient', { username: 'Ancient' }, ago(31 * DAY_MS));
    event(s, 'raid', 'PlainRaider', 'not json {', ago(DAY_MS));
    db.setTrackerValue(s, 'latest_bits', { name: 'Kept', amount: 1 });
    event(s, 'bits', 'Seeded', { username: 'Seeded', amount: 50 }, ago(DAY_MS));
    tip(s, null, 3, null, ago(DAY_MS));

    db.seedTrackerValues();
    db.seedTrackerValues(); // and again: nothing more changes

    assert.deepEqual(values(s), {
      latest_raid: { name: 'PlainRaider', viewers: 0 },
      latest_bits: { name: 'Kept', amount: 1 },
      latest_tip: { name: 'Anonymous', amount: 3, currency: null },
    });
  });
});

describe('the channel state the top tipper reads', () => {
  const stateRows = (login) => db.db.prepare('SELECT COUNT(*) AS n FROM channel_state WHERE twitch_username = ?').get(login).n;

  test('findChannelState reads a row without writing one; the last stream\'s start outlives clearStreamSession', () => {
    assert.equal(db.findChannelState('nobody_streams_here'), null);
    assert.equal(stateRows('nobody_streams_here'), 0);

    db.getChannelState('top_tipper_chan');
    db.updateChannelState('top_tipper_chan', { is_live: 1, stream_started_at: '2026-10-16T20:00:00Z' });
    assert.equal(db.findChannelState('Top_Tipper_Chan').last_stream_started_at, '2026-10-16T20:00:00Z');

    db.updateChannelState('top_tipper_chan', { offline_polls: 1 });
    db.clearStreamSession('top_tipper_chan');
    db.updateChannelState('top_tipper_chan', { is_live: 0, offline_polls: 0 });
    const ended = db.findChannelState('top_tipper_chan');
    assert.equal(ended.stream_started_at, null);
    assert.equal(ended.last_stream_started_at, '2026-10-16T20:00:00Z');

    db.updateChannelState('top_tipper_chan', { is_live: 1, stream_started_at: '2026-10-17T19:00:00Z' });
    assert.equal(db.findChannelState('top_tipper_chan').last_stream_started_at, '2026-10-17T19:00:00Z', 'a new stream replaces it');
  });

  test('getEnabledStreamerTwitchLogins: every enabled streamer\'s linked login, lower-cased, once', () => {
    addStreamer({ twitch_username: 'Own_Login_A' });
    addStreamer({ twitch_username: 'own_login_a' });
    addStreamer({ twitch_username: 'own_login_off', enabled: 0 });
    addStreamer({ twitch_username: '' });
    const logins = db.getEnabledStreamerTwitchLogins();
    assert.equal(logins.filter((l) => l === 'own_login_a').length, 1);
    assert.ok(!logins.includes('Own_Login_A'));
    assert.ok(!logins.includes('own_login_off'));
    assert.ok(!logins.includes(''));
    assert.ok(logins.every((l) => typeof l === 'string' && l === l.toLowerCase()));
  });
});
