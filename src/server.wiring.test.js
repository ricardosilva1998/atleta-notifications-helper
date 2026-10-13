'use strict';

// server.js cannot be loaded without booting the whole app, so two rules about
// its order are checked on the source text:
//   1. the session middleware applies the disabled-account step before it
//      exposes the logged-in streamer to routes and views;
//   2. the error handler is registered after every route and parser, so
//      anything they throw ends there (later tasks add parsers and routes:
//      they must go above it).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

test('a disabled account is moved out of req.streamer before res.locals.streamer is set', () => {
  const apply = source.indexOf('applyAccountStatus(req);');
  const expose = source.indexOf('res.locals.streamer = req.streamer');
  const crossLoad = source.indexOf('req.streamer = db.getStreamerById(req.racingUser.streamer_id)');
  assert.ok(apply > 0, 'the session middleware applies the account status');
  assert.ok(crossLoad > 0 && apply > crossLoad, 'after a Racing login has loaded its linked streamer');
  assert.ok(expose > apply, 'before the streamer is shared with routes and views');
});

test('the error handler is the last thing registered on the app', () => {
  const registration = source.indexOf('app.use(errorHandler);');
  assert.ok(registration > 0, 'server.js registers the error handler');
  assert.equal(source.indexOf('app.use(errorHandler);', registration + 1), -1, 'once');
  const after = source.slice(registration + 'app.use(errorHandler);'.length);
  const registeredLater = after.match(/\bapp\.(use|get|post|put|patch|delete|all)\(/g);
  assert.equal(registeredLater, null, `nothing is registered after the error handler (found ${registeredLater})`);
});

test('it is registered after the last route and parser', () => {
  const registration = source.indexOf('app.use(errorHandler);');
  const before = source.slice(0, registration);
  for (const needle of ["app.use('/overlay', overlayRoutes)", "app.use('/dashboard', dashboardRoutes)", 'app.use(express.json(', 'app.use(express.urlencoded(']) {
    assert.ok(before.includes(needle), `${needle} comes before the error handler`);
  }
});
