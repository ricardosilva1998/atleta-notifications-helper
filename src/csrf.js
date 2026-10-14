'use strict';

// Protection against cross-site request forgery: another website making a
// visitor's browser send a request that changes something here (a form it
// submits, a fetch it starts) while the visitor is logged in.
//
// server.js mounts csrfProtection() after the session middleware (the token is
// derived from the session) and the body parsers (it reads the _csrf form
// field), ahead of every route. A request with any method other than GET, HEAD
// or OPTIONS must pass two checks:
//
//   1. It comes from this site's own pages: its Origin header, or its Referer
//      when it has no Origin, names this site (APP_URL's origin, or the origin
//      the request itself was sent to). Browsers name the page a request comes
//      from, and a page on another site cannot claim to be this one. Origin
//      "null" (a page with no origin of its own) does not count. The routes in
//      CSRF_EXEMPT below skip this check: programs call them, with no Origin.
//   2. When it carries a logged-in session, it also carries that session's
//      token, HMAC-SHA256(CSRF_SECRET, the session id's stored hash), in a
//      _csrf form field or an X-CSRF-Token header. This applies on every
//      route, CSRF_EXEMPT ones included. Every page gets the token as
//      res.locals.csrfToken; views/csrf.ejs loads public/js/csrf.js, which adds
//      it to the page's POST forms and to its fetch() and XMLHttpRequest calls.
//
// GET, HEAD and OPTIONS are never checked: the OBS overlay links, the pitwall
// pages, the Discord voice API and every other read need no entry below. The
// pitwall WebSockets are not Express routes at all (services/pitwallRelay.js).
//
// A refused request gets 403 with a message asking to reload the page: a JSON
// body for a request a script sent, the error page for a form post.

const crypto = require('crypto');
const { t } = require('./i18n');
const { wantsJson, loggedPath } = require('./errorHandler');

// Routes that skip the Origin check (check 1 above). Each is called by a
// program, not from a page of this site: the program sends no Origin and no
// session cookie, and is authenticated by something else (a bridge id, a
// racing login, a shared secret) or the route is public by design. The token
// check (check 2) still applies to them. A request that carries a logged-in
// session needs its token here too, so a browser cannot be made to use these
// routes with its visitor's login: Whisper and Spotify control accept the
// session as well, and the site's own pages that call some of these routes
// (Track Database, iRacing, the tip form) send the token.
// Matched on the method and on the path as Express routes it (in any letter
// case, with or without a trailing slash). A new route that one of these
// programs calls with an unsafe method must be added here, or its requests are
// refused with 403 and logged as "[CSRF] Refused ...".
const CSRF_EXEMPT = Object.freeze([
  // The Atleta Racing app (bridge/). Its requests come from Node's https module
  // (no Origin, no cookie) or from fetch() in its own windows (Origin "null"),
  // and name their racing account by bridge_id or log in to one.
  { method: 'POST', path: '/api/session', why: 'Atleta Racing app: a recorded session (sessionRecorder.js)' },
  { method: 'POST', path: '/api/session/:id/lap', why: 'Atleta Racing app: a lap of it (sessionRecorder.js)' },
  { method: 'PATCH', path: '/api/session/:id/finish', why: 'Atleta Racing app: its result (sessionRecorder.js)' },
  { method: 'PATCH', path: '/api/session/:id', why: 'Session API: share a session, by its bridge_id' },
  { method: 'DELETE', path: '/api/session/:id', why: 'Session API: delete a session, by its bridge_id' },
  { method: 'POST', path: '/api/track-map', why: 'Atleta Racing app: a track outline (telemetry.js)' },
  { method: 'POST', path: '/api/track-stats', why: 'Atleta Racing app: race statistics (telemetry.js)' },
  { method: 'POST', path: '/api/live-session', why: 'Atleta Racing app: the live session heartbeat (telemetry.js)' },
  { method: 'POST', path: '/api/bridge-logs', why: 'Atleta Racing app: its log upload (main.js)' },
  { method: 'POST', path: '/api/bridge-bug-reports', why: 'Bug reports about an Atleta Racing app, by bridgeId' },
  { method: 'PATCH', path: '/api/bridge-bug-reports/:id', why: 'The status of one, by bridgeId' },
  { method: 'POST', path: '/api/bridge/whisper', why: 'Atleta Racing app: voice to text (voiceInput.js)' },
  { method: 'POST', path: '/api/bridge/spotify/control', why: 'Atleta Racing app: the Spotify overlay buttons (overlays/spotify.html)' },
  { method: 'POST', path: '/racing/auth/login-api', why: 'Atleta Racing app: its login (login.html)' },
  // Only with a JSON body: the website's own sign-up form is a form post and is
  // checked. A page on another site cannot send JSON here, because the browser
  // first asks this site's permission (a CORS preflight), which it never gives.
  { method: 'POST', path: '/racing/auth/signup', json: true, why: 'Atleta Racing app: its sign-up (login.html, control-panel.html)' },
  // The multistream relay (MediaMTX), with MEDIAMTX_WEBHOOK_SECRET (routes/multistream.js).
  { method: 'POST', path: '/api/multistream/auth', why: 'Multistream relay: may this publish or read?' },
  { method: 'POST', path: '/api/multistream/webhook/on-ready', why: 'Multistream relay: a stream arrived' },
  { method: 'POST', path: '/api/multistream/webhook/on-not-ready', why: 'Multistream relay: a stream left' },
  // A development copy of the site pulling production's data, with SYNC_SECRET (routes/sync.js).
  { method: 'POST', path: '/sync/trigger', why: 'Development sync, with SYNC_SECRET' },
  // The public tip page. Anyone may start a donation, logged in or not, and
  // PayPal asks the donor to approve every payment.
  { method: 'POST', path: '/tip/:username/create', why: 'Public tip page: start a PayPal donation' },
]);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// An Express-style path ("/api/session/:id/lap") as a regular expression that
// matches it the way the router does: any letter case, optional trailing slash.
function routePattern(routePath) {
  const source = routePath.split('/')
    .map((segment) => (segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${source}/?$`, 'i');
}

const EXEMPT_ROUTES = CSRF_EXEMPT.map((entry) => ({ ...entry, pattern: routePattern(entry.path) }));

function isExempt(req) {
  return EXEMPT_ROUTES.some((route) => route.method === req.method
    && route.pattern.test(req.path)
    && (!route.json || !!req.is('application/json')));
}

let bootSecret = null;

// CSRF_SECRET, or a random secret made once per boot. With a per-boot secret
// every page opened before a restart holds a token that no longer matches, and
// must be reloaded before it can save.
function csrfSecret() {
  const configured = require('./config').csrf.secret;
  if (configured) return configured;
  if (!bootSecret) {
    bootSecret = crypto.randomBytes(32);
    console.warn('[CSRF] CSRF_SECRET is not set: form tokens use a per-boot secret, so pages opened before a restart must be reloaded before they can save. Set it to a long random value (openssl rand -hex 32).');
  }
  return bootSecret;
}

// The token for one web session: HMAC-SHA256(secret, the hash the sessions
// table keeps of its id). The token changes with the session, and a copy of
// the database (which holds only the hashes) does not give it without the secret.
function csrfToken(sessionHash, secret) {
  return crypto.createHmac('sha256', secret).update(String(sessionHash)).digest('base64url');
}

function sameToken(presented, expected) {
  if (typeof presented !== 'string' || !presented) return false;
  const given = Buffer.from(presented);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
}

// The token a request carries: the X-CSRF-Token header (fetch, uploads) or the
// _csrf field of a form or JSON body.
function presentedToken(req) {
  const header = req.get('x-csrf-token');
  if (header) return header;
  const field = req.body && typeof req.body === 'object' ? req.body._csrf : undefined;
  return typeof field === 'string' ? field : '';
}

// "https://host[:port]" for a URL, or null for anything else, including the
// opaque origin "null".
function originOf(url) {
  try {
    const { origin } = new URL(url);
    return origin === 'null' ? null : origin;
  } catch (e) {
    return null;
  }
}

// Where the request says it comes from: its Origin header, or the origin of its
// Referer when it has no Origin. Null when it names no site.
function sourceOrigin(req) {
  const origin = req.get('origin');
  if (origin !== undefined) return originOf(origin);
  const referer = req.get('referer');
  return referer ? originOf(referer) : null;
}

// What to log about the source: the Origin header as sent (not a secret, and
// it may be "null"), never the Referer (a page address can carry a token).
function describeSource(req) {
  const origin = req.get('origin');
  if (origin !== undefined) return `Origin ${JSON.stringify(origin.slice(0, 100))} is not this site`;
  return req.get('referer') ? 'its Referer is not this site' : 'it has no Origin or Referer';
}

function wantsJsonAnswer(req) {
  // Browsers say how a request was made: "navigate" for a form post, "cors" or
  // "same-origin" for fetch() and XMLHttpRequest.
  const mode = req.get('sec-fetch-mode');
  if (mode) return mode !== 'navigate';
  return !!req.get('x-csrf-token') || wantsJson(req);
}

function refuse(req, res, reason) {
  console.warn(`[CSRF] Refused ${req.method} ${loggedPath(req)}: ${reason}`);
  const translate = res.locals.t || ((key, params) => t('en', key, params));
  const message = translate('csrf.refused');
  if (wantsJsonAnswer(req)) return res.status(403).json({ ok: false, error: message });
  res.status(403).render('error', { t: translate, status: 403, heading: translate('csrf.title'), message }, (err, html) => {
    if (err) return res.type('text/plain').send(message);
    res.send(html);
  });
}

// The middleware. appUrl is the site's address (config.app.url); secret
// defaults to csrfSecret(). Reads req.sessionHash, which the session
// middleware sets to the stored hash of a valid session's id.
function csrfProtection({ appUrl, secret = csrfSecret() } = {}) {
  const siteOrigin = originOf(appUrl);
  return function csrfCheck(req, res, next) {
    const token = req.sessionHash ? csrfToken(req.sessionHash, secret) : '';
    res.locals.csrfToken = token;
    if (SAFE_METHODS.has(req.method)) return next();

    const presented = presentedToken(req);
    // No route ever sees the field: the iRacing overlay settings, for one,
    // save every field they are sent.
    if (req.body && typeof req.body === 'object') delete req.body._csrf;

    // 1. From this site, except on the routes programs call (CSRF_EXEMPT).
    if (!isExempt(req)) {
      const source = sourceOrigin(req);
      const host = req.get('host');
      const ownOrigin = host ? originOf(`${req.protocol}://${host}`) : null;
      if (!source || (source !== siteOrigin && source !== ownOrigin)) return refuse(req, res, describeSource(req));
    }
    // 2. With a logged-in session, its token, on every route.
    if (token && !sameToken(presented, token)) {
      return refuse(req, res, presented ? 'the token does not match the session' : 'no token');
    }
    next();
  };
}

module.exports = { CSRF_EXEMPT, isExempt, csrfSecret, csrfToken, csrfProtection };
