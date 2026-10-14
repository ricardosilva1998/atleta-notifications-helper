'use strict';

// The nightly database backups (services/backups.js) on a temp folder: what is
// kept (7 days), what a run writes (a whole SQLite database, through a
// temporary name), what a failed run leaves (nothing new, nothing deleted), and
// when the schedule runs. Real SQLite, synthetic data; nothing touches data/.

const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const backups = require('./backups');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atleta-backups-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const names = () => fs.readdirSync(dir).sort();
const touch = (name) => fs.writeFileSync(path.join(dir, name), 'x');

// A small real database and the vacuumInto that db.js gives the scheduler.
function sampleDatabase(rows = 3) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE streamers (id INTEGER PRIMARY KEY, name TEXT)');
  const add = db.prepare('INSERT INTO streamers (name) VALUES (?)');
  for (let i = 1; i <= rows; i++) add.run(`streamer${i}`);
  return { db, vacuumInto: (file) => db.prepare('VACUUM INTO ?').run(file) };
}

const rowsIn = (file) => {
  const copy = new Database(file, { readonly: true });
  try {
    assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
    return copy.prepare('SELECT COUNT(*) AS n FROM streamers').get().n;
  } finally {
    copy.close();
  }
};

describe('pruneBackups', () => {
  test('keeps today and the six days before it, and deletes older backups and half-written copies', () => {
    for (let day = 1; day <= 14; day++) touch(`bot-2026-10-${String(day).padStart(2, '0')}.db`);
    touch('bot-2026-10-13.db.tmp');
    touch('notes.txt');
    touch('pre-restore.db');

    const deleted = backups.pruneBackups({ dir, now: new Date('2026-10-14T03:30:00Z') });

    assert.deepEqual(names(), [
      'bot-2026-10-08.db', 'bot-2026-10-09.db', 'bot-2026-10-10.db', 'bot-2026-10-11.db',
      'bot-2026-10-12.db', 'bot-2026-10-13.db', 'bot-2026-10-14.db',
      'notes.txt', 'pre-restore.db',
    ]);
    assert.equal(deleted.length, 8, 'seven old backups and one half-written copy');
  });

  test('a folder that does not exist yet is fine', () => {
    assert.deepEqual(backups.pruneBackups({ dir: path.join(dir, 'missing') }), []);
  });
});

describe('runBackup', () => {
  test('writes today\'s backup as a whole database, through a temporary name', () => {
    const { db, vacuumInto } = sampleDatabase(3);
    const seen = [];
    const file = backups.runBackup({
      vacuumInto: (target) => { seen.push(path.basename(target)); vacuumInto(target); },
      dir,
      now: new Date('2026-10-14T03:30:00Z'),
    });
    assert.equal(file, path.join(dir, 'bot-2026-10-14.db'));
    assert.deepEqual(seen, ['bot-2026-10-14.db.tmp'], 'never written straight to the final name');
    assert.deepEqual(names(), ['bot-2026-10-14.db']);
    assert.equal(rowsIn(file), 3);
    db.close();
  });

  test('a second run on the same day replaces that day\'s backup, and old backups are pruned', () => {
    const { db, vacuumInto } = sampleDatabase(3);
    touch('bot-2026-10-01.db');
    const now = new Date('2026-10-14T03:30:00Z');
    backups.runBackup({ vacuumInto, dir, now });
    db.prepare('INSERT INTO streamers (name) VALUES (?)').run('streamer4');
    backups.runBackup({ vacuumInto, dir, now });
    assert.deepEqual(names(), ['bot-2026-10-14.db']);
    assert.equal(rowsIn(path.join(dir, 'bot-2026-10-14.db')), 4, 'the newer copy');
    db.close();
  });

  test('a failed run leaves no partial file and deletes no old backup', () => {
    touch('bot-2026-10-01.db');
    const failing = (target) => {
      fs.writeFileSync(target, 'half a database');
      throw new Error('database or disk is full');
    };
    assert.throws(() => backups.runBackup({ vacuumInto: failing, dir, now: new Date('2026-10-14T03:30:00Z') }), /disk is full/);
    assert.deepEqual(names(), ['bot-2026-10-01.db']);
  });
});

describe('the schedule', () => {
  test('runs next at 03:30 UTC: later today, or tomorrow once it has passed', () => {
    const at = (iso) => backups.msUntilNextRun(new Date(iso));
    assert.equal(at('2026-10-14T01:00:00Z'), 2.5 * 60 * 60 * 1000);
    assert.equal(at('2026-10-14T03:30:00Z'), 24 * 60 * 60 * 1000);
    assert.equal(at('2026-10-14T23:30:00Z'), 4 * 60 * 60 * 1000);
  });

  test('backs up every night, and skips a night the volume has no room for the copy', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: new Date('2026-10-14T01:00:00Z') });
    const { db, vacuumInto } = sampleDatabase(2);
    const dbFile = path.join(dir, 'live.db');
    fs.writeFileSync(dbFile, Buffer.alloc(4096));
    const room = { ok: false };
    const logs = [];
    const log = { log: (m) => logs.push(m), error: (m) => logs.push(m) };
    try {
      backups.scheduleNightlyBackups({ vacuumInto, databaseFile: dbFile, canWrite: (bytes) => { assert.equal(bytes, 4096); return room.ok; }, dir: path.join(dir, 'backups'), log });

      mock.timers.tick(2.5 * 60 * 60 * 1000 - 1);
      assert.equal(fs.existsSync(path.join(dir, 'backups')), false, 'nothing before 03:30 UTC');
      mock.timers.tick(1);
      assert.equal(fs.existsSync(path.join(dir, 'backups', 'bot-2026-10-14.db')), false, 'skipped: no room');
      assert.match(logs.join('\n'), /Skipped: not enough free space/);

      room.ok = true;
      mock.timers.tick(24 * 60 * 60 * 1000);
      assert.equal(rowsIn(path.join(dir, 'backups', 'bot-2026-10-15.db')), 2, 'the next night, with room');
    } finally {
      mock.timers.reset();
      db.close();
    }
  });
});
