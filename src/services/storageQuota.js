'use strict';

// Room on the data volume for uploads. The SQLite database lives on the same
// volume, and once it is full every write fails, so before an upload is stored:
//   - the volume must keep at least MIN_FREE_BYTES free after it, and
//   - a streamer's stored media (alert sounds, sponsor images, reward clips and
//     VTuber models, each kept in a data/<folder>/<streamer id>/ folder) must
//     stay within MEDIA_QUOTA_BYTES.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const MB = 1024 * 1024;
const MIN_FREE_BYTES = 200 * MB;
const MEDIA_QUOTA_BYTES = 250 * MB;
const MEDIA_FOLDERS = Object.freeze(['sounds', 'sponsors', 'redemptions', 'vtuber-models']);

// Free bytes on the volume holding `dir`, or null when the system can't say.
function freeBytes(dir = DATA_DIR, statfs = fs.statfsSync) {
  try {
    const { bavail, bsize } = statfs(dir);
    return Number(bavail) * Number(bsize);
  } catch (e) {
    return null;
  }
}

// Total size of the regular files under `dir` (0 when it does not exist).
function folderBytes(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return 0; }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += folderBytes(full);
    else if (entry.isFile()) {
      try { total += fs.statSync(full).size; } catch (e) { /* removed meanwhile */ }
    }
  }
  return total;
}

function streamerMediaBytes(streamerId, root = DATA_DIR) {
  return MEDIA_FOLDERS.reduce((sum, folder) => sum + folderBytes(path.join(root, folder, String(streamerId))), 0);
}

// Why an upload of `bytes` must not be stored, or null when it may be:
//   'disk'  - the volume would have less than MIN_FREE_BYTES left;
//   'quota' - (media uploads) the streamer's media would pass MEDIA_QUOTA_BYTES.
// `replacing` is the size of the file the upload replaces, which is removed.
// When the free space can't be read the disk check is skipped, not failed.
function uploadRefusal({ streamerId, bytes, replacing = 0, media = true, root = DATA_DIR, statfs = fs.statfsSync }) {
  const free = freeBytes(root, statfs);
  if (free !== null && free - bytes < MIN_FREE_BYTES) return 'disk';
  if (media && streamerMediaBytes(streamerId, root) - replacing + bytes > MEDIA_QUOTA_BYTES) return 'quota';
  return null;
}

// The size of a stored file, 0 when there is none (what an upload replaces).
function fileBytes(file) {
  try { return fs.statSync(file).size; } catch (e) { return 0; }
}

module.exports = {
  DATA_DIR,
  MIN_FREE_BYTES,
  MEDIA_QUOTA_BYTES,
  MEDIA_FOLDERS,
  freeBytes,
  streamerMediaBytes,
  uploadRefusal,
  fileBytes,
};
