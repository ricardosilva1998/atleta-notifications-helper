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

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err); // the response has started; let Express close it
  const status = statusOf(err);
  const log = status >= 500 ? console.error : console.warn;
  log(`[Error] ${req.method} ${req.path} -> ${status}:`, (err && err.stack) || err);

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
