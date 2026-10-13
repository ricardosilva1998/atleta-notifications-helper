'use strict';

// Custom alert sounds, stored per streamer at data/sounds/<streamerId>/<type>.mp3
// and served to the OBS overlay at /overlay/sounds/<overlay token>/<type>.
// They used to live directly in data/sounds/ and play for every streamer.

const fs = require('fs');
const path = require('path');
const { soundMimeType } = require('./uploadValidation');

const SOUNDS_DIR = path.join(__dirname, '..', '..', 'data', 'sounds');

// The alert types that can have a custom sound.
const SOUND_TYPES = Object.freeze([
  'follow', 'subscription', 'bits', 'donation', 'raid',
  'yt_superchat', 'yt_member', 'yt_giftmember', 'giveaway_winner',
]);

// Where a streamer's sound for a type lives, or null when the streamer id or
// the type is not one we store. Only allowlisted types and positive integer
// ids get through, so the result is always inside the streamer's own folder.
function soundFilePath(streamerId, type, root = SOUNDS_DIR) {
  if (!Number.isSafeInteger(streamerId) || streamerId <= 0) return null;
  if (!SOUND_TYPES.includes(type)) return null;
  return path.join(root, String(streamerId), `${type}.mp3`);
}

// { type: version } for each sound the streamer has stored. The version is
// the file's modification time in ms, so a replaced sound gets a new URL.
function soundVersions(streamerId, root = SOUNDS_DIR) {
  const versions = {};
  for (const type of SOUND_TYPES) {
    const file = soundFilePath(streamerId, type, root);
    if (!file) continue;
    try {
      const stat = fs.statSync(file, { throwIfNoEntry: false });
      if (stat && stat.isFile()) versions[type] = Math.round(stat.mtimeMs);
    } catch (e) { /* unreadable: treat as not stored */ }
  }
  return versions;
}

function urlsFor(streamer, versions) {
  if (!streamer || !streamer.overlay_token) return {};
  const base = `/overlay/sounds/${encodeURIComponent(streamer.overlay_token)}/`;
  const urls = {};
  for (const [type, version] of Object.entries(versions)) urls[type] = `${base}${type}?v=${version}`;
  return urls;
}

// { type: url } for the overlay, e.g. /overlay/sounds/<token>/follow?v=<mtimeMs>.
// Empty without an overlay token, since no overlay can play them then.
function soundUrls(streamer, root = SOUNDS_DIR) {
  return streamer ? urlsFor(streamer, soundVersions(streamer.id, root)) : {};
}

// What the dashboard shows: which types have a custom sound, and the URLs to
// preview them with.
function soundStatus(streamer, root = SOUNDS_DIR) {
  const versions = streamer ? soundVersions(streamer.id, root) : {};
  const custom = {};
  for (const type of SOUND_TYPES) custom[type] = Object.hasOwn(versions, type);
  return { custom, urls: urlsFor(streamer, versions) };
}

// The Content-Type to serve a stored sound with, or null when there is no
// such file. Uploads are checked, so unrecognised bytes can only be a file
// stored before that check; those keep the audio/mpeg the old route sent.
async function storedSoundMimeType(file) {
  let handle;
  try {
    handle = await fs.promises.open(file, 'r');
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(12), 0, 12, 0);
    return soundMimeType(buffer.subarray(0, bytesRead)) || 'audio/mpeg';
  } catch (e) {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

// The four sounds that used to be shared by every streamer. Owner decision
// (2026-10-13): they belong to streamer #13.
const LEGACY_SOUND_TYPES = ['follow', 'subscription', 'bits', 'donation'];
const LEGACY_SOUND_OWNER_ID = 13;
const ARCHIVE_DIR = '_archive';

function isFile(file) {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  return !!stat && stat.isFile();
}

// An archive path for a legacy sound that never replaces an archived file.
function archivePath(root, type) {
  const plain = path.join(root, ARCHIVE_DIR, `${type}.mp3`);
  return fs.existsSync(plain) ? path.join(root, ARCHIVE_DIR, `${type}-${Date.now()}.mp3`) : plain;
}

// Boot migration, safe to run on every start: moves each legacy root sound
// into streamer #13's folder when that streamer exists and has no sound of
// that type yet, otherwise into data/sounds/_archive/. Nothing is deleted;
// later runs find nothing to move. Returns the moves made.
function migrateLegacySounds({ root = SOUNDS_DIR, ownerExists, logger = console } = {}) {
  const moves = [];
  for (const type of LEGACY_SOUND_TYPES) {
    const from = path.join(root, `${type}.mp3`);
    try {
      if (!isFile(from)) continue;
      const ownerFile = soundFilePath(LEGACY_SOUND_OWNER_ID, type, root);
      const to = ownerExists(LEGACY_SOUND_OWNER_ID) && !fs.existsSync(ownerFile)
        ? ownerFile
        : archivePath(root, type);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      moves.push({ type, from, to });
      logger.log(`[Sounds] Moved shared ${type}.mp3 to ${path.relative(root, to)}`);
    } catch (e) {
      logger.error(`[Sounds] Could not move shared ${type}.mp3: ${e.message}`);
    }
  }
  return moves;
}

module.exports = {
  SOUNDS_DIR,
  SOUND_TYPES,
  soundFilePath,
  soundVersions,
  soundUrls,
  soundStatus,
  storedSoundMimeType,
  migrateLegacySounds,
};
