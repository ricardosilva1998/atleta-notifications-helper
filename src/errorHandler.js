'use strict';

// The app-level Express error handler. Anything a route throws, or an async
// route rejects, ends here instead of in Express's default page (which prints
// the stack whenever NODE_ENV is not "production"). The stack goes to the
// server log only; the visitor gets a generic page, or a small JSON body when
// the request was an API call or sent JSON.
//
// server.js registers it after every route. Keep it the LAST middleware.

const http = require('http');
const { t } = require('./i18n');

function wantsJson(req) {
  return req.path.startsWith('/api/')
    || !!req.xhr
    || !!req.is('json')
    || !!req.is('application/octet-stream') // raw uploads are sent with fetch() and read a JSON answer
    || !req.accepts('html');
}

// Only a client error (4xx) keeps its own status, for example a body that is
// too large or malformed JSON; anything else is a plain 500.
function statusOf(err) {
  const status = err && err.status;
  return Number.isInteger(status) && status >= 400 && status < 500 ? status : 500;
}

// A path segment that looks like a secret: 20 or more letters, digits, "-" or
// "_" (an overlay or share token, an id, a code).
const OPAQUE_SEGMENT = /^[A-Za-z0-9_-]{20,}$/;
const maskOpaque = (segment) => (OPAQUE_SEGMENT.test(segment) ? '***' : segment);
const segmentsOf = (path) => path.split('/').filter(Boolean);

// The address to put in the log for a failed request. Overlay, share and invite
// links carry a secret in the path, and the log must not keep a working link,
// so when a route matched, its pattern is logged ("/overlay/events/:token"),
// never the value in the request. A router only knows its pattern relative to
// where it is mounted, and by the time the error reaches this app-level handler
// req.baseUrl is empty again, so the mount prefix is taken from the request's
// own leading segments (masked like any other). When no route matched (the
// failure came before routing, for instance in a body parser), or the pattern
// is not a plain string pattern, every opaque-looking segment is masked instead.
function loggedPath(req) {
  const segments = segmentsOf(`${req.baseUrl || ''}${req.path}`);
  const pattern = req.route && typeof req.route.path === 'string' && !/[*{]/.test(req.route.path) ? req.route.path : null;
  if (!pattern) return `/${segments.map(maskOpaque).join('/')}`;
  const own = segmentsOf(pattern);
  const mounted = segments.slice(0, Math.max(0, segments.length - own.length));
  return `/${[...mounted.map(maskOpaque), ...own].join('/')}`;
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err); // the response has started; let Express close it
  const status = statusOf(err);
  const log = status >= 500 ? console.error : console.warn;
  log(`[Error] ${req.method} ${loggedPath(req)} -> ${status}:`, (err && err.stack) || err);

  if (wantsJson(req)) {
    return res.status(status).json({ error: status === 500 ? 'Internal error' : http.STATUS_CODES[status] });
  }
  const translate = res.locals.t || ((key, params) => t('en', key, params));
  res.status(status).render('error', { t: translate, status }, (renderErr, html) => {
    if (renderErr) return res.type('text/plain').send(status === 500 ? 'Something went wrong.' : http.STATUS_CODES[status]);
    res.send(html);
  });
}

module.exports = { errorHandler };
