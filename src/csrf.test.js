'use strict';

// The CSRF check (csrf.js) on a small Express app with the real middleware:
// which requests reach the route and which are refused, the token, the routes
// left alone (every request the Atleta Racing app makes among them), and a scan
// of the views: every page that sends a form or a request loads the token.
// All sessions, secrets and addresses are synthetic.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');

// src/config.js exits without these; the values are never used.
for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) {
  process.env[key] = process.env[key] || 'synthetic';
}

const { csrfProtection, csrfToken, isExempt, CSRF_EXEMPT } = require('./csrf');
const { t } = require('./i18n');

const SECRET = 'synthetic-csrf-secret';
const SITE = 'https://atleta.example';
const SESSION = 'a'.repeat(64); // a stored session id hash
const TOKEN = csrfToken(SESSION, SECRET);

let server;
let port;
const logs = [];
const saved = {};

before(async () => {
  saved.warn = console.warn;
  console.warn = (...args) => logs.push(args.join(' '));
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  // As server.js's session middleware: a valid session sets req.sessionHash.
  app.use((req, res, next) => {
    if (req.get('x-test-session')) req.sessionHash = req.get('x-test-session');
    res.locals.t = (key, params) => t('en', key, params);
    next();
  });
  app.use(csrfProtection({ appUrl: SITE, secret: SECRET }));
  // Every request that gets through lands here and says what the route saw.
  app.use((req, res) => res.json({ reached: true, body: req.body === undefined ? null : req.body, token: res.locals.csrfToken }));
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = server.address().port;
});

after(async () => {
  console.warn = saved.warn;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => { logs.length = 0; });

// `form` is sent urlencoded, `json` as JSON, `raw` as application/octet-stream.
function send(method, urlPath, { headers = {}, form, json, raw } = {}) {
  return new Promise((resolve, reject) => {
    let body = null;
    const all = { ...headers };
    if (form) { body = new URLSearchParams(form).toString(); all['Content-Type'] = 'application/x-www-form-urlencoded'; }
    if (json !== undefined) { body = JSON.stringify(json); all['Content-Type'] = 'application/json'; }
    if (raw !== undefined) { body = raw; all['Content-Type'] = 'application/octet-stream'; }
    if (body !== null) all['Content-Length'] = Buffer.byteLength(body);
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, agent: false, headers: all }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

const own = () => `http://127.0.0.1:${port}`; // the origin a request to this server is sent to
const reached = (res) => res.status === 200 && res.json().reached === true;

describe('requests that change something', () => {
  test('a GET is never checked, and the page gets the session\'s token', async () => {
    const res = await send('GET', '/dashboard/overlay', { headers: { 'x-test-session': SESSION } });
    assert.ok(reached(res));
    assert.equal(res.json().token, TOKEN);
  });

  test('without a session the page gets no token', async () => {
    assert.equal((await send('GET', '/racing')).json().token, '');
  });

  test('a logged-in POST from this site without the token is refused', async () => {
    const res = await send('POST', '/dashboard/overlay', { headers: { Origin: SITE, 'x-test-session': SESSION }, form: { overlay_enabled: '1' } });
    assert.equal(res.status, 403);
    assert.deepEqual(logs, ['[CSRF] Refused POST /dashboard/overlay: no token']);
  });

  test('with the token in its _csrf field it goes through, and the route never sees the field', async () => {
    const res = await send('POST', '/dashboard/overlay', { headers: { Origin: SITE, 'x-test-session': SESSION }, form: { overlay_enabled: '1', _csrf: TOKEN } });
    assert.ok(reached(res));
    assert.deepEqual(res.json().body, { overlay_enabled: '1' });
  });

  test('a raw upload carries it in the X-CSRF-Token header', async () => {
    const headers = { Origin: SITE, 'x-test-session': SESSION };
    assert.equal((await send('POST', '/dashboard/sponsors/upload?ext=png', { headers, raw: 'bytes' })).status, 403);
    assert.ok(reached(await send('POST', '/dashboard/sponsors/upload?ext=png', { headers: { ...headers, 'X-CSRF-Token': TOKEN }, raw: 'bytes' })));
  });

  test('PUT, PATCH and DELETE are checked like POST', async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const headers = { Origin: SITE, 'x-test-session': SESSION };
      assert.equal((await send(method, '/dashboard/redemptions/1', { headers })).status, 403, method);
      assert.ok(reached(await send(method, '/dashboard/redemptions/1', { headers: { ...headers, 'X-CSRF-Token': TOKEN } })), method);
    }
  });

  test('the token is tied to its session: another session\'s, or a wrong one, is refused', async () => {
    const other = csrfToken('b'.repeat(64), SECRET);
    assert.notEqual(other, TOKEN);
    for (const token of [other, TOKEN.slice(0, -1), `${TOKEN}x`, 'x']) {
      const res = await send('POST', '/dashboard/overlay', { headers: { Origin: SITE, 'x-test-session': SESSION, 'X-CSRF-Token': token } });
      assert.equal(res.status, 403, token);
    }
    assert.match(logs[0], /: the token does not match the session$/);
  });

  test('the token is HMAC-SHA256 of the stored session hash, under CSRF_SECRET', () => {
    assert.equal(TOKEN, crypto.createHmac('sha256', SECRET).update(SESSION).digest('base64url'));
    assert.notEqual(csrfToken(SESSION, 'another-secret'), TOKEN);
  });

  test('without a session no token is asked for, only that the request comes from this site', async () => {
    assert.ok(reached(await send('POST', '/racing/auth/login', { headers: { Origin: SITE }, form: { username: 'u', password: 'p' } })));
    assert.equal((await send('POST', '/racing/auth/login', { headers: { Origin: 'https://elsewhere.example' }, form: { username: 'u', password: 'p' } })).status, 403);
  });
});

describe('where a request comes from', () => {
  const post = (headers) => send('POST', '/dashboard/overlay', { headers: { 'x-test-session': SESSION, 'X-CSRF-Token': TOKEN, ...headers } });

  test('APP_URL\'s origin, or the origin the request was sent to, is this site', async () => {
    assert.ok(reached(await post({ Origin: SITE })));
    assert.ok(reached(await post({ Origin: own() })));
  });

  test('another site is refused even with the right token', async () => {
    for (const origin of ['https://elsewhere.example', 'https://atleta.example.elsewhere.example', 'http://atleta.example', 'https://atleta.example:8443']) {
      assert.equal((await post({ Origin: origin })).status, 403, origin);
    }
    assert.equal(logs[0], '[CSRF] Refused POST /dashboard/overlay: Origin "https://elsewhere.example" is not this site');
  });

  test('Origin "null" (a page with no origin of its own) is refused, whatever the Referer says', async () => {
    assert.equal((await post({ Origin: 'null', Referer: `${SITE}/dashboard` })).status, 403);
  });

  test('with no Origin, a Referer from this site will do', async () => {
    assert.ok(reached(await post({ Referer: `${SITE}/dashboard/overlay` })));
    assert.ok(reached(await post({ Referer: `${own()}/dashboard/overlay?tab=2` })));
  });

  test('with no Origin, a Referer from another site is refused', async () => {
    assert.equal((await post({ Referer: 'https://elsewhere.example/page' })).status, 403);
    assert.equal(logs[0], '[CSRF] Refused POST /dashboard/overlay: its Referer is not this site');
  });

  test('with neither, the request is refused', async () => {
    assert.equal((await post({})).status, 403);
    assert.equal(logs[0], '[CSRF] Refused POST /dashboard/overlay: it has no Origin or Referer');
  });
});

describe('the refusal', () => {
  const message = t('en', 'csrf.refused');

  test('a form post gets the error page, saying to reload', async () => {
    const res = await send('POST', '/dashboard/overlay', { headers: { Origin: SITE, 'x-test-session': SESSION, 'Sec-Fetch-Mode': 'navigate' }, form: { a: '1' } });
    assert.equal(res.status, 403);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.ok(res.text.includes(t('en', 'csrf.title')));
    assert.ok(res.text.includes('Reload the page and try again.'));
  });

  test('a request made by a script gets JSON with the message in error, which the pages show', async () => {
    for (const headers of [{ 'Sec-Fetch-Mode': 'cors' }, { 'Sec-Fetch-Mode': 'same-origin' }, { 'X-CSRF-Token': 'stale' }]) {
      const res = await send('POST', '/dashboard/overlay', { headers: { Origin: SITE, 'x-test-session': SESSION, ...headers }, json: { a: 1 } });
      assert.equal(res.status, 403);
      assert.deepEqual(res.json(), { ok: false, error: message });
    }
  });

  test('a link\'s token in the path is not written to the log', async () => {
    await send('POST', '/overlay/abcdefghijklmnopqrstuvwxyz012345/clear', { headers: { Origin: 'https://elsewhere.example' } });
    assert.equal(logs[0], '[CSRF] Refused POST /overlay/***/clear: Origin "https://elsewhere.example" is not this site');
  });
});

describe('the routes programs call (CSRF_EXEMPT): no Origin asked for', () => {
  // Every request with an unsafe method that the Atleta Racing app (bridge/)
  // sends to the site, as it sends them: no Origin, no cookie.
  const BRIDGE_CALLS = [
    ['POST', '/api/session', 'sessionRecorder.js'],
    ['POST', '/api/session/42/lap', 'sessionRecorder.js'],
    ['PATCH', '/api/session/42/finish', 'sessionRecorder.js'],
    ['POST', '/api/track-map', 'telemetry.js'],
    ['POST', '/api/track-stats', 'telemetry.js'],
    ['POST', '/api/live-session', 'telemetry.js'],
    ['POST', '/api/bridge-logs', 'main.js'],
    ['POST', '/api/bridge/whisper?bridge_id=00000000-0000-0000-0000-000000000000', 'voiceInput.js'],
    ['POST', '/api/bridge/spotify/control', 'overlays/spotify.html'],
    ['POST', '/racing/auth/login-api', 'login.html'],
    ['POST', '/racing/auth/signup', 'login.html, control-panel.html'],
  ];

  test('every request the Atleta Racing app makes goes through without an Origin or a token', async () => {
    for (const [method, urlPath, from] of BRIDGE_CALLS) {
      assert.ok(reached(await send(method, urlPath, { json: { bridge_id: 'synthetic' } })), `${method} ${urlPath} (${from})`);
    }
    // Its windows' fetch() sends Origin "null".
    assert.ok(reached(await send('POST', '/racing/auth/signup', { headers: { Origin: 'null' }, json: { username: 'u' } })));
  });

  test('the multistream relay, the development sync and the public tip form go through too', async () => {
    for (const urlPath of ['/api/multistream/auth', '/api/multistream/webhook/on-ready', '/api/multistream/webhook/on-not-ready', '/sync/trigger', '/tip/somestreamer/create']) {
      assert.ok(reached(await send('POST', urlPath, { json: {} })), urlPath);
    }
  });

  test('the rest of the session API is left alone, by bridge_id', async () => {
    assert.ok(reached(await send('PATCH', '/api/session/7?bridge_id=x', { json: { is_public: 1 } })));
    assert.ok(reached(await send('DELETE', '/api/session/7?bridge_id=x')));
  });

  // Whisper and Spotify control also log in through the session; the Track
  // Database, iRacing and tip pages call some of these routes while logged in.
  test('a request to one of them that carries a logged-in session still needs its token', async () => {
    for (const urlPath of ['/api/bridge/whisper', '/api/bridge/spotify/control', '/api/track-stats', '/api/track-map', '/tip/somestreamer/create']) {
      const refused = await send('POST', urlPath, { headers: { 'x-test-session': SESSION, Origin: SITE }, json: { action: 'next' } });
      assert.equal(refused.status, 403, `${urlPath} without the token`);
      assert.ok(reached(await send('POST', urlPath, { headers: { 'x-test-session': SESSION, Origin: SITE, 'X-CSRF-Token': TOKEN }, json: { action: 'next' } })), `${urlPath} with it`);
    }
    // Another session's token does not do, with or without an Origin.
    const other = csrfToken('b'.repeat(64), SECRET);
    assert.equal((await send('POST', '/api/bridge/spotify/control', { headers: { 'x-test-session': SESSION, 'X-CSRF-Token': other }, json: { action: 'next' } })).status, 403);
    // The Origin is still not asked for: the token is enough.
    assert.ok(reached(await send('PATCH', '/api/bridge-bug-reports/3', { headers: { 'x-test-session': SESSION, 'X-CSRF-Token': TOKEN }, json: { status: 'approved' } })));
    assert.match(logs[0], /^\[CSRF\] Refused POST \/api\/bridge\/whisper: no token$/);
  });

  test('they never see the _csrf field either', async () => {
    const anonymous = await send('POST', '/tip/somestreamer/create', { form: { amount: '5', _csrf: 'whatever-the-page-had' } });
    assert.deepEqual(anonymous.json().body, { amount: '5' });
    const loggedIn = await send('POST', '/tip/somestreamer/create', { headers: { 'x-test-session': SESSION, Origin: SITE }, form: { amount: '5', _csrf: TOKEN } });
    assert.deepEqual(loggedIn.json().body, { amount: '5' });
  });

  test('the website\'s own sign-up form (not JSON) is checked', async () => {
    assert.equal((await send('POST', '/racing/auth/signup', { form: { username: 'u', password: 'p' } })).status, 403);
    assert.ok(reached(await send('POST', '/racing/auth/signup', { headers: { Origin: SITE }, form: { username: 'u', password: 'p' } })));
  });

  test('an entry covers its own method and path only, as Express routes them', () => {
    const req = (method, p, json = false) => ({ method, path: p, is: () => (json ? 'application/json' : false) });
    assert.equal(isExempt(req('POST', '/API/Session/')), true, 'any letter case, a trailing slash');
    assert.equal(isExempt(req('POST', '/api/session/42/lap/')), true);
    assert.equal(isExempt(req('DELETE', '/api/track-map')), false, 'another method');
    assert.equal(isExempt(req('POST', '/api/session/42/lap/extra')), false, 'a longer path');
    assert.equal(isExempt(req('POST', '/api/sessionx')), false);
    // Track Database pages that need a login stay checked.
    assert.equal(isExempt(req('POST', '/api/track-stats/import-csv')), false);
    assert.equal(isExempt(req('POST', '/api/track-stats/import-screenshot')), false);
    assert.equal(isExempt(req('DELETE', '/api/track-stats/Spa/GT3/Sprint')), false);
    // Logged-in routes under these prefixes stay checked.
    assert.equal(isExempt(req('POST', '/overlay/clear')), false);
    assert.equal(isExempt(req('POST', '/racing/auth/logout')), false);
    assert.equal(isExempt(req('POST', '/racing/auth/signup')), false, 'sign-up only with a JSON body');
    assert.equal(isExempt(req('POST', '/racing/auth/signup', true)), true);
  });

  test('each entry says why it skips the Origin check', () => {
    for (const entry of CSRF_EXEMPT) {
      assert.ok(['POST', 'PUT', 'PATCH', 'DELETE'].includes(entry.method), entry.path);
      assert.ok(entry.why && entry.why.length > 10, entry.path);
    }
  });
});

describe('CSRF_SECRET', () => {
  // Loads csrf.js and config.js afresh with this CSRF_SECRET (undefined: unset).
  function freshCsrf(value) {
    const previous = process.env.CSRF_SECRET;
    if (value === undefined) delete process.env.CSRF_SECRET;
    else process.env.CSRF_SECRET = value;
    delete require.cache[require.resolve('./config')];
    delete require.cache[require.resolve('./csrf')];
    try {
      require('./config'); // read while the variable is set (csrf.js loads it when first asked)
      return require('./csrf');
    } finally {
      if (previous === undefined) delete process.env.CSRF_SECRET;
      else process.env.CSRF_SECRET = previous;
    }
  }

  test('is the secret when it is set', () => {
    assert.equal(freshCsrf('configured-secret').csrfSecret(), 'configured-secret');
  });

  test('unset, a random secret is made once per boot, with a warning', () => {
    const csrf = freshCsrf(undefined);
    const first = csrf.csrfSecret();
    assert.equal(first.length, 32);
    assert.equal(csrf.csrfSecret(), first, 'the same for the whole boot');
    assert.equal(logs.filter((line) => line.startsWith('[CSRF] CSRF_SECRET is not set')).length, 1);
    assert.notDeepEqual(freshCsrf(undefined).csrfSecret(), first, 'a new boot makes a new one');
  });
});

describe('every page that sends a form or a request loads the token', () => {
  const VIEWS = path.join(__dirname, 'views');
  const views = fs.readdirSync(VIEWS).filter((name) => name.endsWith('.ejs'));
  const read = (name) => fs.readFileSync(path.join(VIEWS, name), 'utf8');
  const sendsSomething = (text) => /<form\b/i.test(text) || /\bfetch\s*\(/.test(text) || /XMLHttpRequest/.test(text);
  const includesHeader = (text) => /include\(\s*['"]header['"]/.test(text);
  const PARTIAL = /<%-\s*include\(\s*['"]csrf['"]\s*\)\s*%>/;

  test('the header loads it in <head>, ahead of every script', () => {
    const header = read('header.ejs');
    const at = header.search(PARTIAL);
    assert.ok(at > 0, 'header.ejs includes the csrf partial');
    assert.ok(at < header.indexOf('</head>'));
    assert.ok(at < header.indexOf('<script'), 'before the first script');
  });

  test('every view with a form, fetch() or XMLHttpRequest includes the header or the partial', () => {
    const checked = [];
    for (const name of views) {
      if (['header.ejs', 'footer.ejs', 'csrf.ejs'].includes(name)) continue;
      const text = read(name);
      if (!sendsSomething(text)) continue;
      checked.push(name);
      assert.ok(includesHeader(text) || PARTIAL.test(text), `${name} sends a form or a request but loads no CSRF token`);
    }
    // The pages that do not include the header (overlay builder, tip page) are among them.
    for (const name of ['overlay-builder.ejs', 'tip.ejs', 'dashboard.ejs', 'tracks.ejs']) assert.ok(checked.includes(name), name);
  });

  test('a page that includes the partial itself has it in <head>, ahead of its scripts', () => {
    for (const name of views) {
      const text = read(name);
      if (name === 'header.ejs' || !PARTIAL.test(text)) continue;
      const at = text.search(PARTIAL);
      assert.ok(at < text.indexOf('</head>'), `${name}: in <head>`);
      assert.ok(text.indexOf('<script') === -1 || at < text.indexOf('<script'), `${name}: before its first script`);
    }
  });

  test('the forms a route writes out itself (not a view) load the token script', () => {
    const ROUTES = path.join(__dirname, 'routes');
    for (const name of fs.readdirSync(ROUTES).filter((n) => n.endsWith('.js') && !n.endsWith('.test.js'))) {
      const text = fs.readFileSync(path.join(ROUTES, name), 'utf8');
      const forms = (text.match(/<form\b/gi) || []).length;
      if (!forms) continue;
      const scripts = (text.match(/\$\{csrfScript\(res\)\}/g) || []).length;
      assert.equal(scripts, forms, `${name}: one token script per page with a form`);
    }
  });

  test('the partial passes the token, escaped, to public/js/csrf.js', () => {
    const ejs = require('ejs');
    const file = path.join(VIEWS, 'csrf.ejs');
    const render = (locals) => ejs.render(fs.readFileSync(file, 'utf8'), locals, { filename: file }).trim();
    assert.equal(render({ csrfToken: TOKEN }), `<script src="/js/csrf.js" data-csrf-token="${TOKEN}"></script>`);
    assert.equal(render({}), '<script src="/js/csrf.js" data-csrf-token=""></script>');
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'js', 'csrf.js')));
  });
});
