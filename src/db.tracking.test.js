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
