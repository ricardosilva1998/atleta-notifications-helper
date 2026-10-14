'use strict';

// Type checks for the dashboard's raw-body upload routes.

// Report screenshots must be raster images. SVG is left out on purpose: it is
// a document format that browsers can run script from.
const SCREENSHOT_FORMATS = new Map([
  ['png', 'png'],
  ['jpg', 'jpeg'],
  ['jpeg', 'jpeg'],
  ['webp', 'webp'],
  ['gif', 'gif'],
]);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Identify a raster image from its leading bytes; null when it isn't one.
function detectImageFormat(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  const head = buf.toString('latin1', 0, 6);
  if (head === 'GIF87a' || head === 'GIF89a') return 'gif';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// A screenshot is stored only when its extension is allowlisted and its bytes
// really are an image of that format.
function isAllowedScreenshot(ext, buf) {
  const format = SCREENSHOT_FORMATS.get(ext);
  return format !== undefined && detectImageFormat(buf) === format;
}

// Channel-point reward media: the extensions allowed per media type. Shared by
// the upload and replace-media routes so the two can't drift apart. `error` is a
// locale key: the routes translate it for the streamer's language.
const REDEMPTION_MEDIA = new Map([
  ['audio', { exts: new Set(['mp3', 'wav', 'ogg']), error: 'redemptions.error.audioExt' }],
  ['video', { exts: new Set(['mp4', 'webm']), error: 'redemptions.error.videoExt' }],
]);

// The locale key of the error for a reward media upload, or null when both the
// media type and the extension are allowed.
function redemptionMediaError(mediaType, ext) {
  const rule = REDEMPTION_MEDIA.get(mediaType);
  if (!rule) return 'redemptions.error.mediaType';
  return rule.exts.has(ext) ? null : rule.error;
}

// Custom alert sounds: the formats the dashboard uploader sends. Its file
// picker offers mp3/wav/ogg/m4a, and its trim tool always uploads WAV.
const SOUND_MIME_TYPES = new Map([
  ['mp3', 'audio/mpeg'],
  ['wav', 'audio/wav'],
  ['ogg', 'audio/ogg'],
  ['m4a', 'audio/mp4'],
]);

// Identify an audio file from its leading bytes; null when it isn't one.
function detectAudioFormat(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  // MP3 starts with an ID3 tag or directly with an MPEG frame sync
  // (0xFF then 0xE?/0xF?).
  if (buf.toString('latin1', 0, 3) === 'ID3') return 'mp3';
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE') return 'wav';
  if (buf.toString('latin1', 0, 4) === 'OggS') return 'ogg';
  if (buf.toString('latin1', 4, 8) === 'ftyp') return 'm4a';
  return null;
}

// A sound is stored only when its bytes really are one of those formats.
function isAllowedSound(buf) {
  return detectAudioFormat(buf) !== null;
}

// The Content-Type for a sound's leading bytes, or null when they are not a
// known audio format.
function soundMimeType(buf) {
  return SOUND_MIME_TYPES.get(detectAudioFormat(buf)) || null;
}

module.exports = { isAllowedScreenshot, redemptionMediaError, isAllowedSound, soundMimeType };
