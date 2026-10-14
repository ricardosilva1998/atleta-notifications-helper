'use strict';

// server.js cannot be loaded without booting the whole app, so the rules about
// its order are checked on the source text:
//   1. the session middleware applies the disabled-account step before it
//      exposes the logged-in streamer to routes and views;
//   2. the error handler is registered after every route and parser, so
//      anything they throw ends there (later tasks add parsers and routes:
//      they must go above it);
//   3. request tracking and /health come first, the body parsers come from
//      bodyParsers.js only, and every /api route sits behind one apiLimiter;
//   4. the CSRF check (csrf.js) runs after the session and the body parsers
//      and before every route, and pages name their origin to this site.

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

test('requests are tracked for the shutdown, and /health is answered, before anything else runs', () => {
  const track = at('app.use(httpDrain.track);');
  const health = at("app.get('/health', healthHandler(db));");
  assert.ok(track < health, 'the tracker counts the health check too');
  for (const later of ["req.get('x-forwarded-proto') === 'http'", 'app.use(helmet(', 'app.use(generalLimiter);', 'app.use(cookieParser());', 'const sid = req.cookies?.session;']) {
    assert.ok(health < at(later), `/health comes before ${later}`);
  }
  assert.equal(source.indexOf("app.get('/health'", health + 1), -1, 'one /health route');
});

test('the body parsers are mounted once, from bodyParsers.js, before any route', () => {
  const mount = at('mountBodyParsers(app);');
  assert.equal(source.indexOf('mountBodyParsers(app);', mount + 1), -1, 'once');
  assert.ok(mount < at("app.get('/', (req, res)"), 'before the first route');
  // A parser on a route never runs (the global one has read the body already),
  // so a route that needs a larger body must be listed in bodyParsers.js.
  assert.equal(source.match(/express\.(json|urlencoded|raw|text)\(/g), null, 'no other parser in server.js');
});

test('every route that serves uploaded files from data/ sends the user-content headers', () => {
  for (const [route, folder] of [['/sponsors', 'sponsors'], ['/redemptions', 'redemptions'], ['/avatars', 'avatars'], ['/issues-files', 'issues'], ['/vtuber-models', 'vtuber-models']]) {
    assert.ok(source.includes(`app.use('${route}', dataFiles('${folder}'`), `${route} is served by dataFiles('${folder}')`);
  }
  at('setUserContentHeaders(res, filePath);');
  // data/ itself (the database and its backups) is never served.
  const staticFolders = [...code.matchAll(/express\.static\(path\.join\(__dirname, '\.\.', ([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(staticFolders, ["'public'", "'bridge', 'overlays'", "'data', folder"]);
});

test('the public Discord voice route is served by routes/voice.js, behind its own rate limit', () => {
  // What it answers is tested on the route itself (routes/voice.test.js).
  at("app.use('/api/voice', voiceLimiter, require('./routes/voice'));");
  assert.equal(code.match(/\/api\/voice/g).length, 1, 'no other /api/voice route');
});

test('every /api route is behind apiLimiter, which counts each request once', () => {
  const limiter = at("app.use('/api', apiLimiter);");
  const firstApiRoute = Math.min(...[...source.matchAll(/app\.(use|get|post|put|patch|delete|all)\('\/api/g)]
    .map((m) => m.index)
    .filter((index) => index !== limiter));
  assert.ok(limiter < firstApiRoute, 'the limiter comes before the first /api route');
  assert.equal(code.match(/\bapiLimiter\b/g).length, 2, 'declared once and mounted once, never again on a route');
});

test('a refused /api request is answered before its body is read', () => {
  const limiter = at("app.use('/api', apiLimiter);");
  assert.ok(limiter < at('mountBodyParsers(app);'), 'the limiter comes before the body parsers');
  assert.ok(limiter < at('app.use(cookieParser());'), 'and needs nothing but the address');
});

test('multistream is two routers, each mounted once: the page under /dashboard, the relay\'s routes under /api', () => {
  // The same router used to be mounted at both paths, so the relay's webhooks
  // were also reachable under /dashboard/multistream, outside the /api limit.
  at("app.use('/dashboard/multistream', multistreamRoutes.dashboardRouter);");
  const api = at("app.use('/api/multistream', multistreamRoutes.apiRouter);");
  assert.ok(at("app.use('/api', apiLimiter);") < api, 'the relay\'s routes come after the /api limiter');
  assert.equal(code.match(/app\.\w+\('[^']*multistream/g).length, 2, 'no other multistream mount');
  assert.equal(code.match(/require\('\.\/routes\/multistream'\)/g).length, 1, 'loaded once');
});

test('the CSRF check runs once, after the session and the body parsers, before every route', () => {
  const csrf = at('app.use(csrfProtection({ appUrl: config.app.url }));');
  assert.equal(code.match(/csrfProtection\(/g).length, 1, 'mounted once');
  assert.ok(at('mountBodyParsers(app);') < csrf, 'after the body parsers (it reads the _csrf field)');
  assert.ok(at('req.sessionHash = session.sid;') < csrf, 'after the session middleware (the token comes from the session)');
  assert.ok(at('res.locals.currentPath = req.path;') < csrf, 'after the whole session middleware');
  // Between the parsers and the check, only files are served (GET and HEAD).
  const between = source.slice(at('mountBodyParsers(app);'), csrf).replace(/^\s*\/\/.*$/gm, '');
  const mounted = [...between.matchAll(/app\.(use|get|post|put|patch|delete|all)\('([^']*)'/g)].map((m) => m[2]);
  assert.deepEqual(mounted, ['/pitwall/overlays', '/sponsors', '/redemptions', '/avatars', '/issues-files', '/vtuber-models']);
  for (const route of ["app.get('/', (req, res)", "app.use('/auth', authRoutes);", "app.use('/dashboard', dashboardRoutes);",
    "app.use('/racing/auth', authLimiter, racingAuthRoutes);", "app.use('/tip', tipRoutes);", "app.use('/overlay', overlayRoutes);",
    "app.post('/api/session', (req, res)", "app.post('/set-language'", 'app.use(errorHandler);']) {
    assert.ok(csrf < at(route), `before ${route}`);
  }
});

test('pages tell this site which page a request comes from (the CSRF check reads it), and no other site', () => {
  // Under helmet's default (no-referrer) a form post arrives with "Origin: null".
  at("referrerPolicy: { policy: 'same-origin' },");
});
