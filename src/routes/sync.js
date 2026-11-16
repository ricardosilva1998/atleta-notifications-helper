const { Router } = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');

const router = Router();
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const BACKUP_FILE = 'bot.db.backup';

// Equal-length buffers for timingSafeEqual; an unset secret never matches.
function secretMatches(given, secret) {
  if (!secret || typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(String(secret)).digest();
  return crypto.timingSafeEqual(a, b);
}

function requireSyncSecret(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!secretMatches(token, config.app.syncSecret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// GET /sync/backup — stream tar.gz of /app/data (prod side)
router.get('/backup', requireSyncSecret, async (req, res) => {
  // One file per call, so two requests never share or delete each other's snapshot.
  // It sits in its own folder so the tarball still holds `bot.db.backup`, the name the
  // development side restores (services/sync.js).
  const tmpDir = path.join(DATA_DIR, `.sync-${crypto.randomBytes(8).toString('hex')}`);
  const backupPath = path.join(tmpDir, BACKUP_FILE);
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} };

  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    // Create consistent SQLite snapshot
    await db.backup(backupPath);
    console.log('[Sync] Database backup created');

    // Build list of items to include in tar
    const items = [BACKUP_FILE];
    for (const dir of ['sounds', 'sponsors', 'vtuber-models']) {
      if (fs.existsSync(path.join(DATA_DIR, dir))) items.push('-C', DATA_DIR, dir);
    }

    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Transfer-Encoding', 'chunked');

    const tar = spawn('tar', ['czf', '-', ...items], { cwd: tmpDir });

    tar.stdout.pipe(res);

    tar.stderr.on('data', (chunk) => {
      console.error(`[Sync] tar stderr: ${chunk}`);
    });

    tar.on('close', (code) => {
      // Clean up backup file
      cleanup();
      if (code !== 0) console.error(`[Sync] tar exited with code ${code}`);
    });

    // If client disconnects, kill tar
    req.on('close', () => {
      tar.kill();
      cleanup();
    });
  } catch (err) {
    console.error(`[Sync] Backup error: ${err.message}`);
    cleanup();
    if (!res.headersSent) res.status(500).json({ error: 'Backup failed' });
  }
});

// POST /sync/trigger — manually trigger a sync (dev side)
router.post('/trigger', requireSyncSecret, (req, res) => {
  if (!config.app.syncSourceUrl) {
    return res.status(400).json({ error: 'SYNC_SOURCE_URL not configured' });
  }

  const { performSync } = require('../services/sync');
  performSync();
  res.json({ status: 'started' });
});

// GET /sync/status — last sync info
router.get('/status', requireSyncSecret, (req, res) => {
  try {
    const { lastSync } = require('../services/sync');
    res.json(lastSync);
  } catch {
    res.json({ time: null, status: 'never' });
  }
});

module.exports = router;
module.exports.secretMatches = secretMatches;
