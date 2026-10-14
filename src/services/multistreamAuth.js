'use strict';

// Who may do what on the multistream relay. MediaMTX runs with
// authMethod: http (docs/multistream-relay-setup.md): before anyone publishes,
// reads or uses its control API it asks the website, POST
// /api/multistream/auth (routes/multistream.js), sending
// { action, path, ip, user, password, ... }; a 2xx answer allows it.
//
//   publish   only to live/<stream key>, with the key of an account that is
//             enabled and has multistream switched on;
//   read      only from the relay itself (its forwarders read the stream from
//             localhost);
//   api       only with the relay API login the website uses
//             (MEDIAMTX_API_USER, MEDIAMTX_API_TOKEN);
//   anything else (playback, metrics, pprof, an unknown action) is refused.

const crypto = require('crypto');
const { LIVE_PATH } = require('./multistreamRelay');

// The stream key in live/<key>. Validated, never cleaned up: rewriting a
// malformed path could turn it into someone else's key.
function streamTokenFromPath(path) {
  const match = LIVE_PATH.exec(typeof path === 'string' ? path : '');
  return match ? match[1] : null;
}

// 127.0.0.0/8 and ::1 (also as an IPv4-mapped IPv6 address).
function isLoopback(ip) {
  const text = typeof ip === 'string' ? ip.trim().toLowerCase() : '';
  if (text === '::1') return true;
  const v4 = text.startsWith('::ffff:') ? text.slice('::ffff:'.length) : text;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

// Whether two secrets are equal, in constant time. Both are hashed first, so
// neither the contents nor the length of the expected one shows in the timing.
function sameSecret(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || expected === '') return false;
  const digest = (value) => crypto.createHash('sha256').update(value, 'utf8').digest();
  return crypto.timingSafeEqual(digest(given), digest(expected));
}

// The secret an Authorization header presents: "Bearer <secret>" (the
// webhooks' curl), or the password of HTTP Basic (MediaMTX's auth requests,
// which carry it in the address they post to). '' when there is none.
function presentedSecret(authorization) {
  const header = typeof authorization === 'string' ? authorization : '';
  const bearer = /^Bearer (.+)$/.exec(header);
  if (bearer) return bearer[1];
  const basic = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(header);
  if (!basic) return '';
  const login = Buffer.from(basic[1], 'base64').toString('utf8');
  const colon = login.indexOf(':');
  return colon === -1 ? '' : login.slice(colon + 1);
}

// A request from the relay: to /api/multistream/..., carrying its secret
// (MEDIAMTX_WEBHOOK_SECRET). The relay asks before every publish, read and API
// login, all from one address. Requests carrying MEDIAMTX_WEBHOOK_SECRET come
// from the relay and are not counted by the rate limits (server.js); a request
// without it gets 401 and is counted.
function isRelayRequest(req, secret) {
  const url = (req && (req.originalUrl || req.url)) || '';
  if (!url.startsWith('/api/multistream/')) return false;
  return sameSecret(presentedSecret(req.headers && req.headers.authorization), secret);
}

// request: what MediaMTX sent. findStreamer(token): the enabled account with
// that stream key, or nothing. apiUser and apiToken: the relay API login.
// Returns { allow, reason }; the reason is for logs and tests only.
function decideRelayAuth(request, { findStreamer, apiUser, apiToken }) {
  const req = request && typeof request === 'object' ? request : {};
  switch (req.action) {
    case 'publish': {
      const token = streamTokenFromPath(req.path);
      if (!token) return { allow: false, reason: 'not a stream path' };
      const streamer = findStreamer(token);
      if (!streamer) return { allow: false, reason: 'unknown stream key, or a disabled account' };
      if (!streamer.multistream_enabled) return { allow: false, reason: 'multistream is switched off' };
      return { allow: true, reason: 'stream key' };
    }
    case 'read':
      return isLoopback(req.ip)
        ? { allow: true, reason: 'the relay itself' }
        : { allow: false, reason: 'only the relay itself reads' };
    case 'api':
      return sameSecret(req.user, apiUser || 'admin') && sameSecret(req.password, apiToken)
        ? { allow: true, reason: 'relay API login' }
        : { allow: false, reason: 'not the relay API login' };
    default:
      return { allow: false, reason: 'action not allowed' };
  }
}

module.exports = { decideRelayAuth, streamTokenFromPath, isLoopback, sameSecret, presentedSecret, isRelayRequest };
