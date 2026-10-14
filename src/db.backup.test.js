'use strict';

// db.backupInto (the copy the nightly backup makes): the real src/db.js on a
// temporary database file in WAL mode, as in production. The copy is made a few
// pages at a time while the app keeps running, carries the writes made during
// it, and ends as one self-contained file in the rollback-journal mode, with no
// -wal/-shm/-journal files beside it. Nothing touches data/bot.db; all rows are
// synthetic.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const RealDatabase = require('better-sqlite3');

const DB_FILE = path.join(__dirname, 'db.js');
const PRODUCTION_DB = path.join(__dirname, '..', 'data', 'bot.db');

let tmpDir;
let db;
const saved = {};

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-backup-'));
  const liveFile = path.join(tmpDir, 'live.db');
  saved.load = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === DB_FILE) {
      // The app's own database goes to the temp file; the copy opens its real path.
      if (request === 'better-sqlite3') {
        return function FileDatabase(file, opts) { return new RealDatabase(file === PRODUCTION_DB ? liveFile : file, opts); };
      }
      if (request === 'fs') return { ...fs, existsSync: () => true, mkdirSync: () => {} };
      if (request === './config') return { adminDiscordIds: [] };
    }
    return saved.load.call(this, request, parent, isMain);
  };
  saved.log = console.log;
  saved.warn = console.warn;
  saved.error = console.error;
  console.log = () => {}; // the migrations log on a fresh database
  console.warn = () => {};
  console.error = () => {}; // (a few report columns a later boot adds; not this test's concern)
  delete require.cache[DB_FILE];
  try {
    db = require(DB_FILE);
  } finally {
    console.error = saved.error;
  }
});

after(() => {
  console.log = saved.log;
  console.warn = saved.warn;
  Module._load = saved.load;
  delete require.cache[DB_FILE];
  if (db) db.closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('copies the whole database without pausing the app, ending as one rollback-journal file', async () => {
  assert.equal(db.db.pragma('journal_mode', { simple: true }), 'wal', 'the live database is in WAL mode, as in production');
  db.db.exec('CREATE TABLE filler (v BLOB)');
  const fill = db.db.prepare('INSERT INTO filler (v) VALUES (?)');
  db.db.transaction(() => { for (let i = 0; i < 4000; i++) fill.run(Buffer.alloc(800)); })();
  const addStreamer = db.db.prepare('INSERT INTO streamers (discord_user_id, discord_username) VALUES (?, ?)');
  addStreamer.run('800000000000000001', 'backup1');

  // The app keeps writing while the copy is made, between its steps.
  let writesDuringCopy = 0;
  let copying = true;
  const writeWhileCopying = () => {
    if (!copying) return;
    writesDuringCopy += 1;
    addStreamer.run(`80000000000000${String(1000 + writesDuringCopy).padStart(4, '0')}`, `backup-during-${writesDuringCopy}`);
    setImmediate(writeWhileCopying);
  };
  setImmediate(writeWhileCopying);
  const copyFile = path.join(tmpDir, 'copy.db');
  await db.backupInto(copyFile);
  copying = false;

  assert.ok(writesDuringCopy > 0, 'the app answered other work while the copy was being made');
  assert.deepEqual(fs.readdirSync(tmpDir).filter((name) => name.startsWith('copy')), ['copy.db'], 'no -wal, -shm or -journal beside the copy');

  const copy = new RealDatabase(copyFile, { readonly: true });
  try {
    assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(copy.pragma('journal_mode', { simple: true }), 'delete');
    const live = db.db.prepare('SELECT COUNT(*) AS n FROM streamers').get().n;
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM streamers').get().n, live, 'the writes made during the copy are in it');
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM filler').get().n, 4000);
  } finally {
    copy.close();
  }
  assert.deepEqual(fs.readdirSync(tmpDir).filter((name) => name.startsWith('copy')), ['copy.db'], 'reading it leaves nothing beside it');
  assert.equal(db.db.pragma('journal_mode', { simple: true }), 'wal', 'the live database stays in WAL mode');
});
