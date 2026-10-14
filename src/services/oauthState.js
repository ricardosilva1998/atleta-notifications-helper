'use strict';

// The OAuth `state` of the connections a logged-in streamer starts from the
// dashboard (Twitch, Twitch broadcaster, YouTube, Spotify). The start route
// sends a random state to the provider and keeps the same value in a
// short-lived cookie for that flow only; the callback goes on only when the
// provider hands back exactly that value. A callback link someone else made
// (with their own code) therefore cannot attach their account to the streamer
// who opens it.

const crypto = require('crypto');

const STATE_TTL_MS = 10 * 60 * 1000;

const cookieName = (flow) => `oauth_state_${flow}`;

// Makes the state for `flow`, keeps it in the flow's cookie, and returns it
// for the authorize URL.
function issueOAuthState(req, res, flow) {
  const state = crypto.randomUUID();
  req.app.locals.secureCookie(res, cookieName(flow), state, { maxAge: STATE_TTL_MS });
  return state;
}

// True when the callback's `state` is the value this browser's cookie holds
// for `flow`. The cookie is cleared either way, so a state works once.
function checkOAuthState(req, res, flow) {
  const expected = req.cookies && req.cookies[cookieName(flow)];
  res.clearCookie(cookieName(flow));
  const given = req.query && req.query.state;
  if (typeof expected !== 'string' || typeof given !== 'string' || !expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { STATE_TTL_MS, cookieName, issueOAuthState, checkOAuthState };
