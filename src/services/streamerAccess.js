'use strict';

// An account an admin has disabled keeps its row and settings (and can be
// enabled again) but has no access: it counts as logged out everywhere, its
// OBS overlay links stop serving, and /dashboard says why.

// True for an account an admin switched off (enabled = 0). A missing flag
// counts as enabled, so only an explicit 0 locks anyone out.
function isStreamerDisabled(streamer) {
  return !!streamer && streamer.enabled != null && Number(streamer.enabled) === 0;
}

// Session step: a disabled account moves from req.streamer to
// req.disabledStreamer, so every route that asks for a logged-in streamer
// sees nobody. This also covers a Racing login linked to a disabled streamer.
function applyAccountStatus(req) {
  if (req.streamer && isStreamerDisabled(req.streamer)) {
    req.disabledStreamer = req.streamer;
    req.streamer = null;
  }
}

// Guard for every /dashboard route.
function requireActiveStreamer(req, res, next) {
  if (req.streamer) return next();
  if (req.disabledStreamer) return res.status(403).render('account-disabled', { streamer: null });
  return res.redirect('/auth/login');
}

// Event-bus channel that ends a streamer's open OBS streams when the account
// is disabled (see accountLifecycle.js and the SSE routes in routes/overlay.js).
function accountDisabledChannel(streamerId) {
  return `overlay-disabled:${streamerId}`;
}

module.exports = { isStreamerDisabled, applyAccountStatus, requireActiveStreamer, accountDisabledChannel };
