'use strict';

// server.js cannot be loaded without booting the whole app, so the rules about
// its order are checked on the source text:
//   1. the session middleware applies the disabled-account step before it
//      exposes the logged-in streamer to routes and views;
//   2. the error handler is registered after every route and parser, so
//      anything they throw ends there (later tasks add parsers and routes:
//      they must go above it);
//   3. the body parsers come from bodyParsers.js only, and every /api route
//      sits behind one apiLimiter.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
// The same without its comments (whole-line and trailing "// ..." ones).
const code = source.replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

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
  for (const needle of ["app.use('/overlay', overlayRoutes)", "app.use('/dashboard', dashboardRoutes)", 'mountBodyParsers(app);']) {
    assert.ok(before.includes(needle), `${needle} comes before the error handler`);
  }
});

// Where a string first appears in server.js; fails the test when it does not.
function at(needle) {
  const index = source.indexOf(needle);
  assert.ok(index > 0, `server.js has ${needle}`);
  return index;
}

test('the body parsers are mounted once, from bodyParsers.js, before any route', () => {
  const mount = at('mountBodyParsers(app);');
  assert.equal(source.indexOf('mountBodyParsers(app);', mount + 1), -1, 'once');
  assert.ok(mount < at("app.get('/', (req, res)"), 'before the first route');
  // A parser on a route never runs (the global one has read the body already),
  // so a route that needs a larger body must be listed in bodyParsers.js.
  assert.equal(source.match(/express\.(json|urlencoded|raw|text)\(/g), null, 'no other parser in server.js');
});

test('every /api route is behind apiLimiter, which counts each request once', () => {
  const limiter = at("app.use('/api', apiLimiter);");
  const firstApiRoute = Math.min(...[...source.matchAll(/app\.(use|get|post|put|patch|delete|all)\('\/api/g)]
    .map((m) => m.index)
    .filter((index) => index !== limiter));
  assert.ok(limiter < firstApiRoute, 'the limiter comes before the first /api route');
  assert.equal(code.match(/\bapiLimiter\b/g).length, 2, 'declared once and mounted once, never again on a route');
});
