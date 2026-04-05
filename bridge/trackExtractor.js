'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const logPath = path.join(os.homedir(), 'atleta-bridge.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(msg);
  try { fs.appendFileSync(logPath, line); } catch(e) {}
}

const IBT_DIR = path.join(os.homedir(), 'Documents', 'iRacing', 'telemetry');

/**
 * Extract track layout from an iRacing .ibt telemetry file.
 * Reads Lat, Lon, and LapDistPct to build a track shape.
 * Returns array of {x, y, pct} points or null if not found.
 */
async function extractTrackFromIBT(trackDisplayName) {
  try {
    if (!fs.existsSync(IBT_DIR)) {
      log('[TrackExtract] Telemetry dir not found: ' + IBT_DIR);
      return null;
    }

    // Find .ibt files, sorted by most recent first
    const files = fs.readdirSync(IBT_DIR)
      .filter(f => f.endsWith('.ibt'))
      .map(f => {
        try {
          return { file: f, mtime: fs.statSync(path.join(IBT_DIR, f)).mtime.getTime() };
        } catch(e) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) {
      log('[TrackExtract] No .ibt files found');
      return null;
    }

    log('[TrackExtract] Found ' + files.length + ' .ibt files, scanning for ' + trackDisplayName);

    // Try the most recent files first (up to 10)
    for (const entry of files.slice(0, 10)) {
      const result = tryExtractFromFile(path.join(IBT_DIR, entry.file), trackDisplayName);
      if (result) return result;
    }

    log('[TrackExtract] No matching .ibt file found for ' + trackDisplayName);
    return null;
  } catch(e) {
    log('[TrackExtract] Error: ' + e.message);
    return null;
  }
}

function tryExtractFromFile(filePath, trackDisplayName) {
  let ibt = null;
  try {
    const { IBT } = require('@emiliosp/node-iracing-sdk');
    ibt = new IBT();
    ibt.open(filePath);

    // Check if this file has Lat/Lon variables
    const vars = ibt.varHeadersNamesList;
    if (!vars || !vars.includes('Lat') || !vars.includes('Lon')) {
      ibt.close();
      return null;
    }

    const recordCount = ibt.sessionRecordCount;
    if (recordCount < 100) {
      ibt.close();
      return null;
    }

    log('[TrackExtract] Reading ' + path.basename(filePath) + ' (' + recordCount + ' frames)');

    // Sample every Nth frame to keep it fast (target ~500 points per lap)
    // At 60Hz, a 90s lap = 5400 frames. Sample every 10th = 540 points.
    const sampleRate = Math.max(1, Math.floor(recordCount / 2000));
    const SLOT_COUNT = 500;
    const slots = new Array(SLOT_COUNT).fill(null);
    let filled = 0;

    for (let i = 0; i < recordCount; i += sampleRate) {
      try {
        const lat = ibt.get(i, 'Lat');
        const lon = ibt.get(i, 'Lon');
        const pctArr = ibt.get(i, 'LapDistPct');

        const latVal = Array.isArray(lat) ? lat[0] : lat;
        const lonVal = Array.isArray(lon) ? lon[0] : lon;
        const pctVal = Array.isArray(pctArr) ? pctArr[0] : pctArr;

        if (latVal && lonVal && pctVal >= 0 && pctVal <= 1 && latVal !== 0 && lonVal !== 0) {
          const slotIdx = Math.floor(pctVal * SLOT_COUNT) % SLOT_COUNT;
          if (!slots[slotIdx]) filled++;
          slots[slotIdx] = { x: lonVal, y: latVal, pct: pctVal };
        }
      } catch(e) { /* skip bad frames */ }
    }

    ibt.close();
    ibt = null;

    log('[TrackExtract] Extracted ' + filled + '/' + SLOT_COUNT + ' slots from ' + path.basename(filePath));

    if (filled < SLOT_COUNT * 0.7) return null; // Need at least 70% coverage

    // Build continuous path from filled slots
    const points = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      if (slots[i]) points.push(slots[i]);
    }

    // Smooth with moving average
    const win = 3;
    const smoothed = [];
    for (let i = 0; i < points.length; i++) {
      let sx = 0, sy = 0, count = 0;
      for (let j = -win; j <= win; j++) {
        const idx = (i + j + points.length) % points.length;
        sx += points[idx].x;
        sy += points[idx].y;
        count++;
      }
      smoothed.push({ x: sx / count, y: sy / count, pct: points[i].pct });
    }

    log('[TrackExtract] Track extracted: ' + smoothed.length + ' points');
    return smoothed;
  } catch(e) {
    log('[TrackExtract] File error: ' + e.message);
    if (ibt) try { ibt.close(); } catch(e2) {}
    return null;
  }
}

module.exports = { extractTrackFromIBT };
