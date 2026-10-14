'use strict';

// Nightly copies of the database: data/backups/bot-YYYY-MM-DD.db (UTC date),
// written with SQLite's VACUUM INTO (a consistent copy, taken while the app keeps
// running) and kept for 7 days. Nothing serves this folder: the static routes
// in server.js serve only their own data/ subfolders. How to download one and
// restore from it: docs/operations/backup-restore.md.

const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(__dirname, '..', '..', 'data', 'backups');
const KEEP_DAYS = 7; // today's copy and the six before it
const RUN_AT_UTC = { hour: 3, minute: 30 };
const DAY_MS = 24 * 60 * 60 * 1000;
const BACKUP_NAME = /^bot-(\d{4}-\d{2}-\d{2})\.db$/;
const PARTIAL_NAME = /^bot-\d{4}-\d{2}-\d{2}\.db\.tmp$/;

const utcDate = (date) => date.toISOString().slice(0, 10);

function backupFileName(date) {
  return `bot-${utcDate(date)}.db`;
}

// Deletes the backups dated more than KEEP_DAYS - 1 days before `now`, and any
// copy a crash left half-written. Other files in the folder are left alone.
// Returns the names deleted.
function pruneBackups({ dir = BACKUP_DIR, now = new Date(), keepDays = KEEP_DAYS } = {}) {
  const oldestKept = utcDate(new Date(now.getTime() - (keepDays - 1) * DAY_MS));
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return []; }
  const deleted = [];
  for (const name of names) {
    const dated = BACKUP_NAME.exec(name);
    if ((dated && dated[1] < oldestKept) || PARTIAL_NAME.test(name)) {
      fs.rmSync(path.join(dir, name), { force: true });
      deleted.push(name);
    }
  }
  return deleted;
}

// Writes today's backup (replacing one written earlier today), then prunes.
// The copy is written under a temporary name and renamed when complete, so a
// file named bot-YYYY-MM-DD.db is always a whole database. Old backups are only
// pruned after a new one succeeded. Returns the backup's path.
function runBackup({ vacuumInto, dir = BACKUP_DIR, now = new Date(), keepDays = KEEP_DAYS }) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, backupFileName(now));
  const partial = `${file}.tmp`;
  fs.rmSync(partial, { force: true });
  try {
    vacuumInto(partial);
    fs.renameSync(partial, file);
  } catch (e) {
    fs.rmSync(partial, { force: true });
    throw e;
  }
  pruneBackups({ dir, now, keepDays });
  return file;
}

// Milliseconds from `now` until the next RUN_AT_UTC.
function msUntilNextRun(now = new Date(), at = RUN_AT_UTC) {
  const next = new Date(now);
  next.setUTCHours(at.hour, at.minute, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next - now;
}

// Runs a backup every night at RUN_AT_UTC. `canWrite(bytes)` says whether the
// volume has room for a copy of that size (it is skipped, and the old backups
// kept, when it has not). The timers never keep the process alive.
function scheduleNightlyBackups({ vacuumInto, databaseFile, canWrite = () => true, dir = BACKUP_DIR, log = console }) {
  const run = () => {
    try {
      const size = fs.statSync(databaseFile).size;
      if (!canWrite(size)) {
        log.error('[Backup] Skipped: not enough free space on the data volume for a copy of the database');
        return;
      }
      const file = runBackup({ vacuumInto, dir });
      log.log(`[Backup] Database copied to ${path.relative(path.dirname(dir), file)}`);
    } catch (e) {
      log.error(`[Backup] Failed: ${e.message}`);
    }
  };
  const first = setTimeout(() => {
    run();
    setInterval(run, DAY_MS).unref();
  }, msUntilNextRun());
  first.unref();
  log.log(`[Backup] Nightly database backup at ${String(RUN_AT_UTC.hour).padStart(2, '0')}:${String(RUN_AT_UTC.minute).padStart(2, '0')} UTC, kept ${KEEP_DAYS} days`);
}

module.exports = {
  BACKUP_DIR,
  KEEP_DAYS,
  RUN_AT_UTC,
  backupFileName,
  pruneBackups,
  runBackup,
  msUntilNextRun,
  scheduleNightlyBackups,
};
