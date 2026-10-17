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
    // A finished period hangs off its streamer's own goal (tracking_goals is filled just before it).
    if (table === 'tracking_goal_periods') values.goal_id = sql.prepare('SELECT id FROM tracking_goals WHERE streamer_id = ?').get(id).id;
    insertRow(table, values);
  }
  const giveaway = sql.prepare('SELECT id FROM giveaways WHERE streamer_id = ?').get(id).id;
  insertRow('giveaway_entries', { giveaway_id: giveaway });
}


// Runs fn and returns what it printed with console.warn.
function warningsDuring(fn) {
  const lines = [];
  const original = console.warn;
  console.warn = (...args) => lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return lines;
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

describe('what the managers start at boot, and what the overlay links and stream keys serve', () => {
  let a;
  let b;
  beforeEach(() => {
    sql.exec('DELETE FROM streamers');
    a = addStreamer({ overlay_enabled: 1, broadcaster_access_token: 'tok-a', chatbot_enabled: 1, twitch_username: 'streamer_a', overlay_token: 'tok-overlay-a', multistream_token: 'tok-multistream-a' });
    b = addStreamer({ overlay_enabled: 1, broadcaster_access_token: 'tok-b', chatbot_enabled: 1, twitch_username: 'streamer_b', overlay_token: 'tok-overlay-b', multistream_token: 'tok-multistream-b' });
  });

  const ids = (rows) => rows.map((r) => r.id).sort((x, y) => x - y);

  test('both are listed while enabled', () => {
    assert.deepEqual(ids(db.getOverlayEnabledStreamers()), [a, b]);
    assert.deepEqual(ids(db.getChatbotEnabledStreamers()), [a, b]);
    assert.equal(db.getStreamerByOverlayToken('tok-overlay-a').id, a);
    assert.equal(db.getStreamerByMultistreamToken('tok-multistream-a').id, a);
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

  test('a disabled account\'s multistream stream key finds nobody, so the relay neither lets it publish nor forwards it', () => {
    db.disableStreamer(a, null);
    assert.equal(db.getStreamerByMultistreamToken('tok-multistream-a'), undefined);
    assert.equal(db.getStreamerByMultistreamToken('tok-multistream-b').id, b);
    assert.equal(db.getStreamerByMultistreamToken('nope'), undefined);
  });

  test('enabling brings the account back into the lists and its link back to life', () => {
    db.disableStreamer(a, null);
    db.enableStreamer(a);
    assert.deepEqual(ids(db.getOverlayEnabledStreamers()), [a, b]);
    assert.deepEqual(ids(db.getChatbotEnabledStreamers()), [a, b]);
    assert.equal(db.getStreamerByOverlayToken('tok-overlay-a').id, a);
    assert.equal(db.getStreamerByMultistreamToken('tok-multistream-a').id, a);
  });

  test('a missing enabled flag counts as enabled', () => {
    sql.prepare('UPDATE streamers SET enabled = NULL WHERE id = ?').run(a);
    assert.deepEqual(ids(db.getOverlayEnabledStreamers()), [a, b]);
    assert.equal(db.getStreamerByOverlayToken('tok-overlay-a').id, a);
    assert.equal(db.getStreamerByMultistreamToken('tok-multistream-a').id, a);
  });

  // The event connections (EventSub, StreamElements, the sponsor rotation) serve the overlay and the chatbot:
  // the managers start them at boot for every streamer whose overlay or chatbot is on.
  describe('the streamers the connection managers start at boot (overlay or chatbot on)', () => {
    let overlayOnly;
    let chatbotOnly;
    let neither;
    beforeEach(() => {
      overlayOnly = addStreamer({ overlay_enabled: 1, chatbot_enabled: 0, broadcaster_access_token: 'tok-overlay-only', twitch_username: 'overlay_only' });
      chatbotOnly = addStreamer({ overlay_enabled: 0, chatbot_enabled: 1, broadcaster_access_token: 'tok-chatbot-only', twitch_username: 'chatbot_only' });
      neither = addStreamer({ overlay_enabled: 0, chatbot_enabled: 0, broadcaster_access_token: 'tok-neither', twitch_username: 'neither' });
    });

    test('lists a streamer whose chatbot is on though the overlay is off, and one whose overlay is on though the chatbot is off, once each', () => {
      assert.deepEqual(ids(db.getOverlayOrChatbotStreamers()), [a, b, overlayOnly, chatbotOnly].sort((x, y) => x - y));
    });

    test('leaves out a streamer with both off, and keeps the overlay list as it was', () => {
      assert.ok(!ids(db.getOverlayOrChatbotStreamers()).includes(neither));
      assert.deepEqual(ids(db.getOverlayEnabledStreamers()), [a, b, overlayOnly].sort((x, y) => x - y), 'a chatbot-only streamer is not an overlay streamer');
    });

    test('a streamer with the chatbot on and no broadcaster token is listed too: each manager applies its own conditions', () => {
      sql.prepare('UPDATE streamers SET broadcaster_access_token = NULL WHERE id = ?').run(chatbotOnly);
      assert.ok(ids(db.getOverlayOrChatbotStreamers()).includes(chatbotOnly));
    });

    test('a disabled account is skipped, and enabling it brings it back', () => {
      db.disableStreamer(chatbotOnly, null);
      db.disableStreamer(a, null);
      assert.deepEqual(ids(db.getOverlayOrChatbotStreamers()), [b, overlayOnly].sort((x, y) => x - y));
      db.enableStreamer(chatbotOnly);
      assert.ok(ids(db.getOverlayOrChatbotStreamers()).includes(chatbotOnly));
    });

    test('a missing enabled flag counts as enabled', () => {
      sql.prepare('UPDATE streamers SET enabled = NULL WHERE id = ?').run(chatbotOnly);
      assert.ok(ids(db.getOverlayOrChatbotStreamers()).includes(chatbotOnly));
    });

    test('switching the chatbot off takes a chatbot-only streamer out of the list, the overlay keeps an overlay streamer in it', () => {
      sql.prepare('UPDATE streamers SET chatbot_enabled = 0 WHERE id IN (?, ?)').run(chatbotOnly, a);
      const listed = ids(db.getOverlayOrChatbotStreamers());
      assert.ok(!listed.includes(chatbotOnly));
      assert.ok(listed.includes(a), 'its overlay is still on');
    });
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
      sql.prepare('INSERT INTO legacy_notes (streamer_id, note) VALUES (?, ?)').run(a, 'older');
      sql.prepare('INSERT INTO legacy_notes (streamer_id, note) VALUES (?, ?)').run(b, 'keep');
      const warnings = warningsDuring(() => assert.equal(db.deleteStreamer(a), true));
      assert.equal(count('legacy_notes', 'streamer_id = ?', a), 0);
      assert.equal(count('legacy_notes', 'streamer_id = ?', b), 1);
      assert.deepEqual(warnings, [`[DB] Removing streamers ${a}: also deleted 2 row(s) from legacy_notes (streamer_id), a table the removal does not list`]);
    } finally {
      sql.exec('DROP TABLE legacy_notes');
    }
  });

  test('a table the removal does not list is only logged when it actually had rows to clear', () => {
    sql.exec('CREATE TABLE legacy_notes (id INTEGER PRIMARY KEY, streamer_id INTEGER NOT NULL REFERENCES streamers(id), note TEXT)');
    try {
      const empty = addStreamer();
      assert.deepEqual(warningsDuring(() => db.deleteStreamer(empty)), []);
    } finally {
      sql.exec('DROP TABLE legacy_notes');
    }
  });

  test('a removal that the lists cover completely logs nothing from the safety net', () => {
    const a = addStreamer();
    fillStreamer(a);
    assert.deepEqual(warningsDuring(() => db.deleteStreamer(a)), []);
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

  test('another account that uses the same Bridge id keeps its own recordings, laps and telemetry', () => {
    // Nothing makes a Bridge id unique to an account: two accounts used from one install share it.
    const user = addRacingUser({ bridge_id: 'bridge-shared' });
    const other = addRacingUser({ bridge_id: 'bridge-shared' });
    const recording = (owner) => {
      const session = insertRow('racing_sessions', { racing_user_id: owner, bridge_id: 'bridge-shared' });
      const lap = insertRow('session_laps', { session_id: session });
      const telemetry = insertRow('lap_telemetry', { lap_id: lap });
      return { session, lap, telemetry };
    };
    const mine = recording(user);
    const theirs = recording(other);

    assert.equal(db.deleteRacingUser(user), true);

    assert.equal(count('racing_sessions', 'id = ?', mine.session), 0, 'the removed account\'s own recording is gone');
    assert.equal(count('session_laps', 'id = ?', mine.lap), 0);
    assert.equal(count('lap_telemetry', 'id = ?', mine.telemetry), 0);
    assert.equal(count('racing_sessions', 'id = ?', theirs.session), 1, 'the other account\'s recording stays');
    assert.equal(count('session_laps', 'id = ?', theirs.lap), 1, 'with its laps');
    assert.equal(count('lap_telemetry', 'id = ?', theirs.telemetry), 1, 'and its telemetry');
    assert.ok(db.getRacingUserById(other));
    assert.deepEqual(sql.pragma('foreign_key_check'), []);
  });

  test('a recording tied to no account goes with the account whose Bridge id it carries; other accounts\' recordings do not', () => {
    const user = addRacingUser({ bridge_id: 'bridge-shared-2' });
    const other = addRacingUser({ bridge_id: 'bridge-shared-2' });
    const untied = insertRow('racing_sessions', { racing_user_id: null, bridge_id: 'bridge-shared-2' });
    const untiedLap = insertRow('session_laps', { session_id: untied });
    const theirs = insertRow('racing_sessions', { racing_user_id: other, bridge_id: 'bridge-shared-2' });
    db.deleteRacingUser(user);
    assert.equal(count('racing_sessions', 'id = ?', untied), 0);
    assert.equal(count('session_laps', 'id = ?', untiedLap), 0);
    assert.equal(count('racing_sessions', 'id = ?', theirs), 1);
  });

  test('the logs and diagnostic reports kept per Bridge id are left for the install\'s other accounts', () => {
    const user = addRacingUser({ bridge_id: 'bridge-shared-3' });
    const other = addRacingUser({ bridge_id: 'bridge-shared-3' });
    sql.prepare('INSERT INTO bridge_logs (bridge_id, lines) VALUES (?, ?)').run('bridge-shared-3', 'log line');
    sql.prepare('INSERT INTO bridge_bug_reports (bridge_id, error_pattern, explanation, suggested_fix) VALUES (?, ?, ?, ?)').run('bridge-shared-3', 'p', 'e', 'f');
    db.deleteRacingUser(user);
    assert.equal(count('bridge_logs', 'bridge_id = ?', 'bridge-shared-3'), 1);
    assert.equal(count('bridge_bug_reports', 'bridge_id = ?', 'bridge-shared-3'), 1);
    assert.ok(db.getRacingUserById(other));
  });

  test('a table the removal does not know of, with a foreign key to the Racing user, is cleared and logged', () => {
    sql.exec('CREATE TABLE legacy_laps (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES racing_users(id), note TEXT)');
    try {
      const user = addRacingUser();
      const other = addRacingUser();
      sql.prepare('INSERT INTO legacy_laps (user_id, note) VALUES (?, ?)').run(user, 'old');
      sql.prepare('INSERT INTO legacy_laps (user_id, note) VALUES (?, ?)').run(other, 'keep');
      const warnings = warningsDuring(() => assert.equal(db.deleteRacingUser(user), true));
      assert.equal(count('legacy_laps', 'user_id = ?', user), 0);
      assert.equal(count('legacy_laps', 'user_id = ?', other), 1);
      assert.deepEqual(warnings, [`[DB] Removing racing_users ${user}: also deleted 1 row(s) from legacy_laps (user_id), a table the removal does not list`]);
    } finally {
      sql.exec('DROP TABLE legacy_laps');
    }
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
