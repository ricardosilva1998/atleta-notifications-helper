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

module.exports = { isAllowedScreenshot };
