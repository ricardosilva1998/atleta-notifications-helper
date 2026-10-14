'use strict';

// Nightly copies of the database: data/backups/bot-YYYY-MM-DD.db (UTC date),
// written with SQLite's online backup API (db.backupInto: a consistent copy,
// made a few pages at a time while the app keeps running) and kept for 7 days.
// Nothing serves this folder: the static routes in server.js serve only their
// own data/ subfolders. How to download one and restore from it:
// docs/operations/backup-restore.md.

const fs = require('fs');
const path = require('path');
const storageQuota = require('./storageQuota');

const BACKUP_DIR = path.join(__dirname, '..', '..', 'data', 'backups');
const KEEP_DAYS = 7; // today's copy and the six before it
const RUN_AT_UTC = { hour: 3, minute: 30 };
const DAY_MS = 24 * 60 * 60 * 1000;
const BACKUP_NAME = /^bot-(\d{4}-\d{2}-\d{2})\.db$/;
// What a copy that never finished can leave: the copy and its journal files.
const PARTIAL_NAME = /^bot-\d{4}-\d{2}-\d{2}\.db\.tmp(-journal|-wal|-shm)?$/;
const PARTIAL_SUFFIXES = ['', '-journal', '-wal', '-shm'];

const utcDate = (date) => date.toISOString().slice(0, 10);
const megabytes = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

function backupFileName(date) {
  return `bot-${utcDate(date)}.db`;
}

// Deletes the backups dated more than KEEP_DAYS - 1 days before `now`, except
// the newest one, which is always kept (after nights with no room for a new
// copy it may be older than that), and anything a copy that never finished left
// behind. Other files in the folder are left alone. Returns the names deleted.
function pruneBackups({ dir = BACKUP_DIR, now = new Date(), keepDays = KEEP_DAYS } = {}) {
  const oldestKept = utcDate(new Date(now.getTime() - (keepDays - 1) * DAY_MS));
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return []; }
  const newest = names.filter((name) => BACKUP_NAME.test(name)).sort().pop();
  const deleted = [];
  for (const name of names) {
    const dated = BACKUP_NAME.exec(name);
    if ((dated && dated[1] < oldestKept && name !== newest) || PARTIAL_NAME.test(name)) {
      fs.rmSync(path.join(dir, name), { force: true });
      deleted.push(name);
    }
  }
  return deleted;
}

function removePartial(partial) {
  for (const suffix of PARTIAL_SUFFIXES) fs.rmSync(`${partial}${suffix}`, { force: true });
}

// Writes today's backup with `backup(path)` (async; replaces one written earlier
// today), then prunes. The copy is written under a temporary name and renamed
// when complete, so a file named bot-YYYY-MM-DD.db is always a whole database.
// Old backups are only pruned after a new one succeeded. Returns the backup's path.
async function runBackup({ backup, dir = BACKUP_DIR, now = new Date(), keepDays = KEEP_DAYS }) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, backupFileName(now));
  const partial = `${file}.tmp`;
  removePartial(partial);
  try {
    await backup(partial);
    fs.renameSync(partial, file);
  } catch (e) {
    removePartial(partial);
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

const fileSize = (file) => {
  try { return fs.statSync(file).size; } catch (e) { return 0; }
};

// One night's run: a new copy when the data volume has room for it, otherwise
// none (and only the copies past the 7 days are removed, the newest kept, so a
// full volume is not kept full by old backups). Every run logs the database
// size and the free space; a copy also logs how long it took.
async function nightlyRun({ backup, databaseFile, dir = BACKUP_DIR, freeBytes = () => storageQuota.freeBytes(), minFreeBytes = storageQuota.MIN_FREE_BYTES, log = console }) {
  const size = fileSize(databaseFile) + fileSize(`${databaseFile}-wal`);
  const free = freeBytes();
  const facts = `database ${megabytes(size)}, ${free === null ? 'free space unknown' : `${megabytes(free)} free`}`;
  if (free !== null && free - size < minFreeBytes) {
    const removed = pruneBackups({ dir });
    log.error(`[Backup] Skipped: a copy would leave less than ${megabytes(minFreeBytes)} free on the data volume (${facts}); removed ${removed.length} file(s) past ${KEEP_DAYS} days, kept the newest copy`);
    return null;
  }
  const started = Date.now();
  try {
    const file = await runBackup({ backup, dir });
    log.log(`[Backup] Database copied to ${path.relative(path.dirname(dir), file)} in ${((Date.now() - started) / 1000).toFixed(1)} s (${facts})`);
    return file;
  } catch (e) {
    log.error(`[Backup] Failed after ${((Date.now() - started) / 1000).toFixed(1)} s: ${e.message} (${facts})`);
    return null;
  }
}

// Runs nightlyRun every night at RUN_AT_UTC. The timers never keep the process alive.
function scheduleNightlyBackups(options) {
  const log = options.log || console;
  const run = () => { nightlyRun(options).catch((e) => log.error(`[Backup] Failed: ${e.message}`)); };
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
  nightlyRun,
  scheduleNightlyBackups,
};
