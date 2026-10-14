'use strict';

// Headers for files people uploaded, served from the data volume (sponsor
// images, reward clips, avatars, issue screenshots, VTuber models, alert
// sounds). They are served from the site's own origin, so a file opened
// directly must never run as a page there:
//   - Content-Security-Policy "sandbox; default-src 'none'": no script, no
//     same-origin access, nothing loaded;
//   - X-Content-Type-Options: nosniff: the browser keeps the declared type;
//   - Content-Disposition: attachment for anything that is not an image,
//     sound, video or model, so it is downloaded instead of shown.
// None of this changes how an <img>, <audio>, <video> or fetch() on our own
// pages (the OBS overlay, the dashboard) uses the file.

const path = require('path');

const INLINE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', // images
  'mp3', 'wav', 'ogg', 'm4a', // audio
  'mp4', 'webm', // video
  'vrm', 'glb', // 3D models
]);

function isInlineFile(filePath) {
  return INLINE_EXTENSIONS.has(path.extname(String(filePath)).slice(1).toLowerCase());
}

function setUserContentHeaders(res, filePath) {
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!isInlineFile(filePath)) res.setHeader('Content-Disposition', 'attachment');
}

module.exports = { INLINE_EXTENSIONS, isInlineFile, setUserContentHeaders };
