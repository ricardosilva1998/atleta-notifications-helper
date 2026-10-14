'use strict';

// The nightly database backups (services/backups.js) on a temp folder: what is
// kept (7 days, and always the newest copy), what a run writes (a whole SQLite
// database, through a temporary name), what a failed or skipped night leaves,
// what each run logs (database size, free space, time taken), and when the
// schedule runs. Real SQLite (the async backup API), synthetic data; nothing
// touches data/.

const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const backups = require('./backups');

const MB = 1024 * 1024;
let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atleta-backups-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const names = () => fs.readdirSync(dir).sort();
const touch = (name) => fs.writeFileSync(path.join(dir, name), 'x');

// A small real database, and a backup function like db.backupInto (async).
function sampleDatabase(rows = 3) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE streamers (id INTEGER PRIMARY KEY, name TEXT)');
  const add = db.prepare('INSERT INTO streamers (name) VALUES (?)');
  for (let i = 1; i <= rows; i++) add.run(`streamer${i}`);
  return { db, backup: (file) => db.backup(file) };
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

// Collects what a run logs.
function recorder() {
  const lines = [];
  return { lines, log: { log: (m) => lines.push(m), error: (m) => lines.push(m) } };
}

describe('pruneBackups', () => {
  test('keeps today and the six days before it, and deletes older backups and what an unfinished copy left', () => {
    for (let day = 1; day <= 14; day++) touch(`bot-2026-10-${String(day).padStart(2, '0')}.db`);
    for (const leftover of ['bot-2026-10-13.db.tmp', 'bot-2026-10-13.db.tmp-journal', 'bot-2026-10-12.db.tmp-wal', 'bot-2026-10-12.db.tmp-shm']) touch(leftover);
    touch('notes.txt');
    touch('before-restore.db');

    const deleted = backups.pruneBackups({ dir, now: new Date('2026-10-14T03:30:00Z') });

    assert.deepEqual(names(), [
      'before-restore.db',
      'bot-2026-10-08.db', 'bot-2026-10-09.db', 'bot-2026-10-10.db', 'bot-2026-10-11.db',
      'bot-2026-10-12.db', 'bot-2026-10-13.db', 'bot-2026-10-14.db',
      'notes.txt',
    ]);
    assert.equal(deleted.length, 11, 'seven old backups and four leftovers');
  });

  test('always keeps the newest backup, even when every backup is older than 7 days', () => {
    for (const day of ['2026-09-01', '2026-09-10', '2026-09-20']) touch(`bot-${day}.db`);
    backups.pruneBackups({ dir, now: new Date('2026-10-14T03:30:00Z') });
    assert.deepEqual(names(), ['bot-2026-09-20.db']);
  });

  test('a folder that does not exist yet is fine', () => {
    assert.deepEqual(backups.pruneBackups({ dir: path.join(dir, 'missing') }), []);
  });
});

describe('runBackup', () => {
  test('writes today\'s backup as a whole database, through a temporary name', async () => {
    const { db, backup } = sampleDatabase(3);
    const seen = [];
    const file = await backups.runBackup({
      backup: async (target) => { seen.push(path.basename(target)); await backup(target); },
      dir,
      now: new Date('2026-10-14T03:30:00Z'),
    });
    assert.equal(file, path.join(dir, 'bot-2026-10-14.db'));
    assert.deepEqual(seen, ['bot-2026-10-14.db.tmp'], 'never written straight to the final name');
    assert.deepEqual(names(), ['bot-2026-10-14.db']);
    assert.equal(rowsIn(file), 3);
    db.close();
  });

  test('a second run on the same day replaces that day\'s backup, and old backups are pruned', async () => {
    const { db, backup } = sampleDatabase(3);
    touch('bot-2026-10-01.db');
    const now = new Date('2026-10-14T03:30:00Z');
    await backups.runBackup({ backup, dir, now });
    db.prepare('INSERT INTO streamers (name) VALUES (?)').run('streamer4');
    await backups.runBackup({ backup, dir, now });
    assert.deepEqual(names(), ['bot-2026-10-14.db']);
    assert.equal(rowsIn(path.join(dir, 'bot-2026-10-14.db')), 4, 'the newer copy');
    db.close();
  });

  test('a failed run leaves no partial file and deletes no old backup', async () => {
    touch('bot-2026-10-01.db');
    const failing = async (target) => {
      fs.writeFileSync(target, 'half a database');
      fs.writeFileSync(`${target}-journal`, 'its journal');
      throw new Error('database or disk is full');
    };
    await assert.rejects(backups.runBackup({ backup: failing, dir, now: new Date('2026-10-14T03:30:00Z') }), /disk is full/);
    assert.deepEqual(names(), ['bot-2026-10-01.db']);
  });
});

describe('a night\'s run', () => {
  let databaseFile;
  beforeEach(() => {
    databaseFile = path.join(dir, 'live.db');
    fs.writeFileSync(databaseFile, Buffer.alloc(3 * MB));
    fs.writeFileSync(`${databaseFile}-wal`, Buffer.alloc(1 * MB)); // counted with the database
  });
  const backupDir = () => path.join(dir, 'backups');

  test('makes a copy and logs where, how long it took, the database size and the free space', async () => {
    const { db, backup } = sampleDatabase(2);
    const { lines, log } = recorder();
    const file = await backups.nightlyRun({ backup, databaseFile, dir: backupDir(), freeBytes: () => 4000 * MB, minFreeBytes: 200 * MB, log });
    assert.ok(file && fs.existsSync(file));
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^\[Backup\] Database copied to backups\/bot-\d{4}-\d{2}-\d{2}\.db in \d+\.\d s \(database 4\.0 MB, 4000\.0 MB free\)$/);
    db.close();
  });

  test('with no room for a copy, makes none, removes the copies past 7 days but keeps the newest, and says why', async () => {
    fs.mkdirSync(backupDir());
    const today = new Date();
    const daysAgo = (n) => new Date(today.getTime() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    for (const n of [30, 20, 10]) fs.writeFileSync(path.join(backupDir(), `bot-${daysAgo(n)}.db`), 'x');
    let copied = false;
    const { lines, log } = recorder();
    const file = await backups.nightlyRun({ backup: async () => { copied = true; }, databaseFile, dir: backupDir(), freeBytes: () => 203 * MB, minFreeBytes: 200 * MB, log });
    assert.equal(file, null);
    assert.equal(copied, false);
    assert.deepEqual(fs.readdirSync(backupDir()), [`bot-${daysAgo(10)}.db`], 'only the newest copy is left');
    assert.match(lines[0], /^\[Backup\] Skipped: a copy would leave less than 200\.0 MB free on the data volume \(database 4\.0 MB, 203\.0 MB free\); removed 2 file\(s\) past 7 days, kept the newest copy$/);
  });

  test('a failed copy is logged with its time, the database size and the free space', async () => {
    const { lines, log } = recorder();
    const file = await backups.nightlyRun({ backup: async () => { throw new Error('disk I/O error'); }, databaseFile, dir: backupDir(), freeBytes: () => 4000 * MB, minFreeBytes: 200 * MB, log });
    assert.equal(file, null);
    assert.match(lines[0], /^\[Backup\] Failed after \d+\.\d s: disk I\/O error \(database 4\.0 MB, 4000\.0 MB free\)$/);
  });

  test('when the free space cannot be read, the copy is made and the log says so', async () => {
    const { db, backup } = sampleDatabase(1);
    const { lines, log } = recorder();
    assert.ok(await backups.nightlyRun({ backup, databaseFile, dir: backupDir(), freeBytes: () => null, minFreeBytes: 200 * MB, log }));
    assert.match(lines[0], /\(database 4\.0 MB, free space unknown\)$/);
    db.close();
  });
});

describe('the schedule', () => {
  test('runs next at 03:30 UTC: later today, or tomorrow once it has passed', () => {
    const at = (iso) => backups.msUntilNextRun(new Date(iso));
    assert.equal(at('2026-10-14T01:00:00Z'), 2.5 * 60 * 60 * 1000);
    assert.equal(at('2026-10-14T03:30:00Z'), 24 * 60 * 60 * 1000);
    assert.equal(at('2026-10-14T23:30:00Z'), 4 * 60 * 60 * 1000);
  });

  test('runs every night: skips a night the volume has no room, makes the copy the next', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: new Date('2026-10-14T01:00:00Z') });
    const { db, backup } = sampleDatabase(2);
    const databaseFile = path.join(dir, 'live.db');
    fs.writeFileSync(databaseFile, Buffer.alloc(4096));
    const room = { freeMb: 150 };
    const { lines, log } = recorder();
    const backupDir = path.join(dir, 'backups');
    // The copy itself steps through setImmediate, which is not mocked.
    const until = async (condition) => {
      for (let i = 0; i < 1000 && !condition(); i++) await new Promise((resolve) => setImmediate(resolve));
      assert.ok(condition());
    };
    try {
      backups.scheduleNightlyBackups({ backup, databaseFile, dir: backupDir, freeBytes: () => room.freeMb * MB, minFreeBytes: 200 * MB, log });
      assert.match(lines[0], /Nightly database backup at 03:30 UTC, kept 7 days/);

      mock.timers.tick(2.5 * 60 * 60 * 1000 - 1);
      await until(() => true);
      assert.equal(lines.length, 1, 'nothing before 03:30 UTC');
      mock.timers.tick(1);
      await until(() => lines.length === 2);
      assert.match(lines[1], /Skipped: .*150\.0 MB free/);
      assert.equal(fs.existsSync(path.join(backupDir, 'bot-2026-10-14.db')), false);

      room.freeMb = 4000;
      mock.timers.tick(24 * 60 * 60 * 1000);
      await until(() => lines.length === 3);
      assert.match(lines[2], /Database copied to backups\/bot-2026-10-15\.db/);
      assert.equal(rowsIn(path.join(backupDir, 'bot-2026-10-15.db')), 2);
    } finally {
      mock.timers.reset();
      db.close();
    }
  });
});
