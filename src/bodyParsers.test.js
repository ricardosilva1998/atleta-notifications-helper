'use strict';

// Request body limits (bodyParsers.js), mounted the way server.js mounts them
// on a small Express app with the real error handler: each route allowed a
// larger body takes one just under its limit and refuses one just over it, and
// every other route refuses a JSON or form body over 100 kb. The table's paths
// are also checked against the routes that really exist.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { DEFAULT_LIMIT, LARGE_BODY_ROUTES, mountBodyParsers } = require('./bodyParsers');
const { errorHandler } = require('./errorHandler');

// '100kb' / '5mb' in bytes, as body-parser reads them (1 kb = 1024 bytes).
function limitBytes(limit) {
  const match = /^(\d+)(kb|mb)$/.exec(limit);
  assert.ok(match, `a limit written as <n>kb or <n>mb: ${limit}`);
  return Number(match[1]) * (match[2] === 'kb' ? 1024 : 1024 * 1024);
}

// A concrete URL for a route path (":id" and ":teamId" filled in).
const concrete = (routePath) => routePath.replace(/:id\b/, '42').replace(/:teamId\b/, '7');

// Other routes that read a body: they must stay within 100 kb.
const ORDINARY_ROUTES = [
  { method: 'post', path: '/dashboard/overlay-builder/save' },
  { method: 'post', path: '/dashboard/chatbot/commands' },
  { method: 'post', path: '/api/live-session' },
  { method: 'post', path: '/api/track-stats' },
  { method: 'patch', path: '/api/session/:id/finish' },
  { method: 'post', path: '/racing/auth/login-api' },
  { method: 'post', path: '/tip/someone/create' },
];

let server;
let port;
const saved = {};

before(async () => {
  const app = express();
  // A refused form post gets the HTML error page, as in server.js.
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  mountBodyParsers(app);
  // Each route answers with the size of the body it received.
  const echo = (req, res) => res.json({ received: Buffer.byteLength(JSON.stringify(req.body || {})) });
  for (const route of [...LARGE_BODY_ROUTES, ...ORDINARY_ROUTES]) app[route.method](route.path, echo);
  app.use(errorHandler);
  saved.warn = console.warn;
  console.warn = () => {}; // the error handler logs each refused body
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = server.address().port;
});

after(async () => {
  console.warn = saved.warn;
  await new Promise((resolve) => server.close(resolve));
});

// A JSON body of exactly `size` bytes.
function jsonOfSize(size) {
  const shell = JSON.stringify({ pad: '' });
  return JSON.stringify({ pad: 'x'.repeat(size - shell.length) });
}

// A form body of exactly `size` bytes.
const formOfSize = (size) => `pad=${'x'.repeat(size - 4)}`;

function send(method, urlPath, body, type = 'application/json') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method: method.toUpperCase(), agent: false,
      headers: { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const MARGIN = 1024;

describe('the routes allowed a larger body', () => {
  for (const route of LARGE_BODY_ROUTES) {
    test(`${route.method.toUpperCase()} ${route.path} takes up to ${route.limit} and refuses more`, async () => {
      const limit = limitBytes(route.limit);
      const url = concrete(route.path);
      const under = await send(route.method, url, jsonOfSize(limit - MARGIN));
      assert.equal(under.status, 200, under.text.slice(0, 200));
      assert.equal(JSON.parse(under.text).received, limit - MARGIN);

      const over = await send(route.method, url, jsonOfSize(limit + MARGIN));
      assert.equal(over.status, 413);
      assert.deepEqual(JSON.parse(over.text), { error: 'Payload Too Large' });
    });
  }

  test('every one of them takes more than the 100 kb everything else gets', () => {
    for (const route of LARGE_BODY_ROUTES) assert.ok(limitBytes(route.limit) > limitBytes(DEFAULT_LIMIT), route.path);
  });
});

describe('every other route', () => {
  const limit = limitBytes(DEFAULT_LIMIT);

  for (const route of ORDINARY_ROUTES) {
    test(`${route.method.toUpperCase()} ${route.path} takes a JSON body up to 100 kb and refuses more`, async () => {
      const url = concrete(route.path);
      assert.equal((await send(route.method, url, jsonOfSize(limit - MARGIN))).status, 200);
      const over = await send(route.method, url, jsonOfSize(limit + MARGIN));
      assert.equal(over.status, 413);
    });
  }

  test('a form body over 100 kb is refused too', async () => {
    const type = 'application/x-www-form-urlencoded';
    assert.equal((await send('post', '/dashboard/chatbot/commands', formOfSize(limit - MARGIN), type)).status, 200);
    assert.equal((await send('post', '/dashboard/chatbot/commands', formOfSize(limit + MARGIN), type)).status, 413);
  });

  test('a larger limit applies to its own route only, not to the paths around it', async () => {
    // POST /api/session takes 10 MB; the finish PATCH on a session still gets
    // 100 kb, and a lap still stops at its own 5 MB.
    assert.equal((await send('patch', '/api/session/42/finish', jsonOfSize(limit + MARGIN))).status, 413);
    assert.equal((await send('post', '/api/session/42/lap', jsonOfSize(limitBytes('5mb') + MARGIN))).status, 413);
  });
});

describe('the table names routes that exist', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');
  // Where each route outside server.js is registered, and how it is written there.
  const registered = {
    '/dashboard/report': ['routes/dashboard.js', "router.post('/report',"],
    '/racing/account/avatar': ['routes/racing.js', "router.post('/account/avatar',"],
    '/racing/teams/:teamId/picture': ['routes/racing-team.js', "router.post('/:teamId/picture',"],
    '/racing/teams/:teamId/banner': ['routes/racing-team.js', "router.post('/:teamId/banner',"],
  };

  for (const route of LARGE_BODY_ROUTES) {
    test(`${route.method.toUpperCase()} ${route.path}`, () => {
      const [file, needle] = registered[route.path] || ['server.js', `app.${route.method}('${route.path}',`];
      assert.ok(read(file).includes(needle), `${file} registers ${needle}`);
    });
  }
});
