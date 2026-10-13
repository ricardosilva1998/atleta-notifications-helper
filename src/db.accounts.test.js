'use strict';

// Disabling, re-enabling and removing accounts, against the real src/db.js on
// an in-memory SQLite database (nothing touches data/bot.db). Rows are written
// from the live schema, so a table added later that points at an account is
// covered without editing this file: the removal tests fail if it is left behind.

const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const DB_FILE = path.join(__dirname, 'db.js');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

let db;
let sql; // the raw better-sqlite3 handle
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
  sql = db.db;
});

// ── helpers ──────────────────────────────────────────────────────────────

const quote = (name) => `"${name}"`;
const tableNames = () => sql.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
const columnsOf = (table) => sql.pragma(`table_info(${quote(table)})`);
const count = (table, where = '1', ...params) => sql.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)} WHERE ${where}`).get(...params).n;

// Inserts one row, filling every required column that `values` leaves out with
// a placeholder (text unique per call, numbers 1 / 1.5).
function insertRow(table, values = {}) {
  const tag = `${table}-${++counter}`;
  const row = {};
  for (const c of columnsOf(table)) {
    if (c.name in values) row[c.name] = values[c.name];
    else if (c.notnull && c.dflt_value == null && !(c.pk && /int/i.test(c.type))) {
      row[c.name] = /int/i.test(c.type) ? 1 : /real|floa|doub/i.test(c.type) ? 1.5 : `${tag}.${c.name}`;
    }
  }
  const names = Object.keys(row);
  const info = sql.prepare(`INSERT INTO ${quote(table)} (${names.map(quote).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
    .run(...names.map((n) => row[n]));
  return Number(info.lastInsertRowid);
}

function addStreamer(over = {}) {
  const n = ++counter;
  return insertRow('streamers', { discord_user_id: `1000000000000${String(n).padStart(5, '0')}`, discord_username: `user${n}`, ...over });
}

function addRacingUser(over = {}) {
  const n = ++counter;
  return insertRow('racing_users', { username: `racer${n}`, password_hash: 'x', ...over });
}

// Tables whose rows belong to a streamer (racing_users only links to one: the
// link is let go when the streamer is removed, the account stays).
const streamerTables = () => tableNames().filter((t) => t !== 'racing_users' && columnsOf(t).some((c) => c.name === 'streamer_id'));

// Values a placeholder cannot guess: a primary key that is text, a CHECK list.
const PLACEHOLDER_EXCEPTIONS = {
  custom_overlays: { type: 'scene' },
};

// One row in every table that has a streamer_id column, plus the giveaway entry
// that hangs off the giveaway.
function fillStreamer(id) {
  for (const table of streamerTables()) {
    const values = { streamer_id: id, ...PLACEHOLDER_EXCEPTIONS[table] };
    if (table === 'sessions') values.sid = `sid-${id}-${++counter}`;
    insertRow(table, values);
  }
  const giveaway = sql.prepare('SELECT id FROM giveaways WHERE streamer_id = ?').get(id).id;
  insertRow('giveaway_entries', { giveaway_id: giveaway });
}


// ── disabling ────────────────────────────────────────────────────────────

describe('disabling an account', () => {
  test('sets the flag and note, and ends that streamer\'s web sessions (linked ones too)', () => {
    const a = addStreamer();
    const b = addStreamer();
    const racer = addRacingUser();
    db.createSession('plain-a', a, Date.now() + 60_000);
    db.createLinkedSession('linked-a', a, racer, Date.now() + 60_000);
    db.createSession('plain-b', b, Date.now() + 60_000);
    db.createRacingSession('racing-only', racer, Date.now() + 60_000);

    db.disableStreamer(a, 'Disabled by admin');

    const row = db.getStreamerById(a);
    assert.equal(row.enabled, 0);
    assert.equal(row.admin_note, 'Disabled by admin');
    assert.equal(db.getSession('plain-a'), undefined);
    assert.equal(db.getSession('linked-a'), undefined);
    assert.ok(db.getSession('plain-b'), 'another streamer keeps their session');
    assert.ok(db.getSession('racing-only'), 'a Racing-only session is not a streamer session');
    assert.equal(db.getStreamerById(b).enabled, 1);
  });

  test('enabling again clears the note; sessions are not brought back', () => {
    const a = addStreamer();
    db.createSession('plain-a2', a, Date.now() + 60_000);
    db.disableStreamer(a, 'abuse');
    db.enableStreamer(a);
    const row = db.getStreamerById(a);
    assert.equal(row.enabled, 1);
    assert.equal(row.admin_note, null);
    assert.equal(db.getSession('plain-a2'), undefined);
  });
});

describe('what the managers start at boot, and what the overlay links serve', () => {
  let a;
  let b;
  beforeEach(() => {
    sql.exec('DELETE FROM streamers');
    a = addStreamer({ overlay_enabled: 1, broadcaster_access_token: 'tok-a', chatbot_enabled: 1, twitch_username: 'streamer_a', overlay_token: 'tok-overlay-a' });
    b = addStreamer({ overlay_enabled: 1, broadcaster_access_token: 'tok-b', chatbot_enabled: 1, twitch_username: 'streamer_b', overlay_token: 'tok-overlay-b' });
  });

  const ids = (rows) => rows.map((r) => r.id).sort((x, y) => x - y);

  test('both are listed while enabled', () => {
    assert.deepEqual(ids(db.getOverlayEnabledStreamers()), [a, b]);
    assert.deepEqual(ids(db.getChatbotEnabledStreamers()), [a, b]);
    assert.equal(db.getStreamerByOverlayToken('tok-overlay-a').id, a);
  });

  test('a disabled account is skipped by the overlay and chatbot start-up lists', () => {
    db.disableStreamer(a, null);
    assert.deepEqual(ids(db.getOverlayEnabledStreamers()), [b]);
    assert.deepEqual(ids(db.getChatbotEnabledStreamers()), [b]);
  });

  test('a disabled account\'s overlay link finds nobody; an enabled one still does', () => {
    db.disableStreamer(a, null);
    assert.equal(db.getStreamerByOverlayToken('tok-overlay-a'), undefined);
    assert.equal(db.getStreamerByOverlayToken('tok-overlay-b').id, b);
    assert.equal(db.getStreamerByOverlayToken('nope'), undefined);
  });

  test('enabling brings the account back into the lists and its link back to life', () => {
    db.disableStreamer(a, null);
    db.enableStreamer(a);
    assert.deepEqual(ids(db.getOverlayEnabledStreamers()), [a, b]);
    assert.deepEqual(ids(db.getChatbotEnabledStreamers()), [a, b]);
    assert.equal(db.getStreamerByOverlayToken('tok-overlay-a').id, a);
  });

  test('a missing enabled flag counts as enabled', () => {
    sql.prepare('UPDATE streamers SET enabled = NULL WHERE id = ?').run(a);
    assert.deepEqual(ids(db.getOverlayEnabledStreamers()), [a, b]);
    assert.equal(db.getStreamerByOverlayToken('tok-overlay-a').id, a);
  });
});

// ── removing a streamer ──────────────────────────────────────────────────

describe('removing a streamer', () => {
  test('foreign keys are on, as they are in production (the delete used to fail on them)', () => {
    assert.equal(sql.pragma('foreign_keys', { simple: true }), 1);
  });

  test('deletes the streamer and every row that belongs to it, with no foreign key error', () => {
    const a = addStreamer();
    const b = addStreamer();
    fillStreamer(a);
    fillStreamer(b);
    const racer = addRacingUser({ streamer_id: a });
    const model = Number(sql.prepare('SELECT id FROM vtuber_models WHERE streamer_id = ?').get(a).id);
    sql.prepare('UPDATE streamers SET vtuber_model_id = ? WHERE id IN (?, ?)').run(model, a, b);

    // The data really is there to be removed, in every table that has a streamer_id.
    assert.ok(streamerTables().length >= 30, 'the schema has the tables this test is about');
    for (const table of streamerTables()) assert.equal(count(table, 'streamer_id = ?', a), 1, `${table} filled`);

    assert.equal(db.deleteStreamer(a), true);

    assert.equal(db.getStreamerById(a), undefined);
    for (const table of streamerTables()) {
      assert.equal(count(table, 'streamer_id = ?', a), 0, `${table}: nothing left for the removed streamer`);
      assert.equal(count(table, 'streamer_id = ?', b), 1, `${table}: the other streamer is untouched`);
    }
    assert.equal(count('giveaway_entries'), 1, 'only the other streamer\'s giveaway entry is left');
    assert.deepEqual(sql.pragma('foreign_key_check'), [], 'no row points at something that is gone');

    // Things that only referred to the streamer are let go, not deleted.
    assert.equal(db.getRacingUserById(racer).streamer_id, null, 'a linked Racing account stays, unlinked');
    assert.equal(db.getStreamerById(b).vtuber_model_id, null, 'another streamer\'s pick of that VTuber model is cleared');
  });

  test('removes the sessions of a linked login too', () => {
    const a = addStreamer();
    const racer = addRacingUser({ streamer_id: a });
    db.createLinkedSession('linked-remove', a, racer, Date.now() + 60_000);
    db.deleteStreamer(a);
    assert.equal(db.getSession('linked-remove'), undefined);
    assert.ok(db.getRacingUserById(racer), 'the Racing account is a separate account');
  });

  test('a streamer with nothing but the row is removed too, and an unknown id is not an error', () => {
    const a = addStreamer();
    assert.equal(db.deleteStreamer(a), true);
    assert.equal(db.deleteStreamer(a), false);
    assert.equal(db.deleteStreamer(987654321), false);
  });

  test('a table the removal does not know of, with a blocking foreign key, does not stop it', () => {
    sql.exec('CREATE TABLE legacy_notes (id INTEGER PRIMARY KEY, streamer_id INTEGER NOT NULL REFERENCES streamers(id), note TEXT)');
    try {
      const a = addStreamer();
      const b = addStreamer();
      sql.prepare('INSERT INTO legacy_notes (streamer_id, note) VALUES (?, ?)').run(a, 'old');
      sql.prepare('INSERT INTO legacy_notes (streamer_id, note) VALUES (?, ?)').run(b, 'keep');
      assert.equal(db.deleteStreamer(a), true);
      assert.equal(count('legacy_notes', 'streamer_id = ?', a), 0);
      assert.equal(count('legacy_notes', 'streamer_id = ?', b), 1);
    } finally {
      sql.exec('DROP TABLE legacy_notes');
    }
  });

  test('is all or nothing: a failure part-way leaves the account exactly as it was', () => {
    const a = addStreamer();
    fillStreamer(a);
    sql.exec("CREATE TRIGGER refuse_streamer_delete BEFORE DELETE ON streamers BEGIN SELECT RAISE(ABORT, 'refused'); END");
    try {
      assert.throws(() => db.deleteStreamer(a), /refused/);
      assert.ok(db.getStreamerById(a), 'the streamer is still there');
      for (const table of streamerTables()) assert.equal(count(table, 'streamer_id = ?', a), 1, `${table} still has its row`);
    } finally {
      sql.exec('DROP TRIGGER refuse_streamer_delete');
    }
  });
});

// ── removing a Racing user ───────────────────────────────────────────────

// Tables that point at a Racing user. The removal below handles each of them;
// this list is checked against the schema so a new one cannot be forgotten.
const RACING_REFERENCES = [
  'notifications.user_id',
  'password_reset_tokens.user_id', // no foreign key, same meaning
  'racing_sessions.racing_user_id',
  'sessions.racing_user_id',
  'team_invites.invited_by',
  'team_invites.invited_user_id',
  'team_members.user_id',
  'teams.owner_id',
];

describe('removing a Racing user', () => {
  test('the list of tables that point at a Racing user matches the schema', () => {
    const found = new Set();
    for (const table of tableNames()) {
      for (const fk of sql.pragma(`foreign_key_list(${quote(table)})`)) {
        if (fk.table === 'racing_users') found.add(`${table}.${fk.from}`);
      }
      if (columnsOf(table).some((c) => c.name === 'racing_user_id')) found.add(`${table}.racing_user_id`);
    }
    found.add('password_reset_tokens.user_id');
    assert.deepEqual([...found].sort(), RACING_REFERENCES.slice().sort());
  });

  // A user with a session, notification, reset token, a recorded session with a
  // lap and telemetry, a team of their own with a teammate, and a seat in
  // someone else's team.
  function fillRacer(id, bridgeId) {
    const other = addRacingUser();
    const result = { other };
    result.sessionRow = insertRow('sessions', { sid: `racer-sid-${id}`, racing_user_id: id });
    insertRow('notifications', { user_id: id });
    insertRow('password_reset_tokens', { user_id: id });
    result.recorded = insertRow('racing_sessions', { racing_user_id: id, bridge_id: bridgeId });
    result.lap = insertRow('session_laps', { session_id: result.recorded });
    insertRow('lap_telemetry', { lap_id: result.lap });
    result.ownTeam = insertRow('teams', { owner_id: id });
    insertRow('team_members', { team_id: result.ownTeam, user_id: id, role: 'owner' });
    insertRow('team_members', { team_id: result.ownTeam, user_id: other });
    insertRow('team_invites', { team_id: result.ownTeam, invited_user_id: other, invited_by: id });
    result.otherTeam = insertRow('teams', { owner_id: other });
    insertRow('team_members', { team_id: result.otherTeam, user_id: other, role: 'owner' });
    insertRow('team_members', { team_id: result.otherTeam, user_id: id });
    insertRow('team_invites', { team_id: result.otherTeam, invited_user_id: id, invited_by: other });
    return result;
  }

  test('deletes the user and everything they own, with no foreign key error', () => {
    const user = addRacingUser({ bridge_id: 'bridge-gone' });
    const stays = addRacingUser({ bridge_id: 'bridge-stays' });
    const mine = fillRacer(user, 'bridge-gone');
    fillRacer(stays, 'bridge-stays');

    assert.equal(db.deleteRacingUser(user), true);

    assert.equal(db.getRacingUserById(user), undefined);
    assert.equal(count('sessions', 'racing_user_id = ?', user), 0);
    assert.equal(count('notifications', 'user_id = ?', user), 0);
    assert.equal(count('password_reset_tokens', 'user_id = ?', user), 0);
    assert.equal(count('racing_sessions', 'racing_user_id = ?', user), 0);
    assert.equal(count('session_laps', 'session_id = ?', mine.recorded), 0, 'laps go with the recorded session');
    assert.equal(count('lap_telemetry', 'lap_id = ?', mine.lap), 0, 'telemetry goes with the lap');
    assert.equal(count('teams', 'owner_id = ?', user), 0);
    assert.equal(count('team_members', 'team_id = ?', mine.ownTeam), 0, 'a team the user owned goes with its members');
    assert.equal(count('team_invites', 'team_id = ?', mine.ownTeam), 0);
    assert.equal(count('team_members', 'user_id = ?', user), 0, 'their seat in another team is gone');
    assert.equal(count('team_invites', 'invited_user_id = ? OR invited_by = ?', user, user), 0);
    assert.ok(sql.prepare('SELECT 1 FROM teams WHERE id = ?').get(mine.otherTeam), 'the other team stays');
    assert.deepEqual(sql.pragma('foreign_key_check'), [], 'no row points at something that is gone');

    // The other racer is untouched.
    assert.equal(count('sessions', 'racing_user_id = ?', stays), 1);
    assert.equal(count('notifications', 'user_id = ?', stays), 1);
    assert.equal(count('racing_sessions', 'racing_user_id = ?', stays), 1);
    assert.equal(count('teams', 'owner_id = ?', stays), 1, 'the other racer\'s own team');
    assert.ok(db.getRacingUserById(mine.other), 'a teammate is not removed with the owner');
  });

  test('also removes sessions recorded under their Bridge id before they were tied to the account', () => {
    const user = addRacingUser({ bridge_id: 'bridge-old' });
    const untied = insertRow('racing_sessions', { racing_user_id: null, bridge_id: 'bridge-old' });
    const others = insertRow('racing_sessions', { racing_user_id: null, bridge_id: 'bridge-someone-else' });
    const blank = insertRow('racing_sessions', { racing_user_id: null, bridge_id: '' });
    db.deleteRacingUser(user);
    assert.equal(count('racing_sessions', 'id = ?', untied), 0);
    assert.equal(count('racing_sessions', 'id = ?', others), 1);
    assert.equal(count('racing_sessions', 'id = ?', blank), 1, 'an empty Bridge id matches nothing');
  });

  test('a user without a Bridge id removes nothing it should not', () => {
    const user = addRacingUser({ bridge_id: null });
    const blank = insertRow('racing_sessions', { racing_user_id: null, bridge_id: '' });
    assert.equal(db.deleteRacingUser(user), true);
    assert.equal(count('racing_sessions', 'id = ?', blank), 1);
  });

  test('leaves a linked streamer account alone', () => {
    const streamer = addStreamer();
    const user = addRacingUser({ streamer_id: streamer });
    db.deleteRacingUser(user);
    assert.ok(db.getStreamerById(streamer));
  });

  test('an unknown id is not an error', () => {
    assert.equal(db.deleteRacingUser(987654321), false);
  });

  test('is all or nothing', () => {
    const user = addRacingUser({ bridge_id: 'bridge-atomic' });
    fillRacer(user, 'bridge-atomic');
    sql.exec("CREATE TRIGGER refuse_racer_delete BEFORE DELETE ON racing_users BEGIN SELECT RAISE(ABORT, 'refused'); END");
    try {
      assert.throws(() => db.deleteRacingUser(user), /refused/);
      assert.equal(count('notifications', 'user_id = ?', user), 1);
      assert.equal(count('racing_sessions', 'racing_user_id = ?', user), 1);
      assert.equal(count('teams', 'owner_id = ?', user), 1);
    } finally {
      sql.exec('DROP TRIGGER refuse_racer_delete');
    }
  });
});
