'use strict';

// Request bodies may be at most 100 kb, except on the few routes that
// legitimately send more (LARGE_BODY_ROUTES), which get a JSON parser of their
// own mounted ahead of the global ones.
//
// A body parser skips a body that another parser has already read, and the
// global parser runs first, so a larger limit set on the route itself never
// takes effect: the 100 kb parser would refuse the body before the route's own
// parser saw it. That is why every larger limit lives in the table below. A
// route that needs one must be added here.

const express = require('express');

const DEFAULT_LIMIT = '100kb';

const LARGE_BODY_ROUTES = Object.freeze([
  // Issue reports (a pasted log can be long)
  { method: 'post', path: '/dashboard/report', limit: '1mb' },
]);

// Registers the body parsers on the app: the large-body routes first, then the
// 100 kb parsers for everything else. Call it before any route.
function mountBodyParsers(app) {
  for (const { method, path, limit } of LARGE_BODY_ROUTES) {
    app[method](path, express.json({ limit }));
  }
  app.use(express.urlencoded({ extended: true, limit: DEFAULT_LIMIT }));
  app.use(express.json({ limit: DEFAULT_LIMIT }));
}

module.exports = { DEFAULT_LIMIT, LARGE_BODY_ROUTES, mountBodyParsers };
