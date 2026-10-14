'use strict';

// The real src/server.js app, answering over HTTP on 127.0.0.1, on the real
// src/db.js over an in-memory SQLite database (nothing touches data/). The
// config is a stub, and the routers server.js mounts from routes/ are empty
// ones, except routes/racing-auth.js (its sign-in log is checked here).
//
// Requests carry X-Forwarded-For the way Railway's edge sends them: with
// 'trust proxy' 1, its last entry is req.ip, the address that connected to the
// edge. A Cloudflare address there stands for a request through Cloudflare.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const Module = require('node:module');

const SERVER_FILE = path.join(__dirname, 'server.js');
const DB_FILE = path.join(__dirname, 'db.js');
const CONFIG_FILE = path.join(__dirname, 'config.js');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');
const realExpress = require('express');

const config = {
  adminDiscordIds: [],
  app: { url: 'http://localhost:3000', port: 0 },
  features: { youtube: true },
  multistream: { enabled: false },
  tiers: {},
  csrf: { secret: 'synthetic-csrf-secret' },
  email: {},
};

let app;
let db;
let server;
let port;

// What the app logs while it loads and answers (kept, not printed).
const logged = [];
const consoleMethods = ['log', 'warn', 'error'];
const realConsole = Object.fromEntries(consoleMethods.map((name) => [name, console[name]]));
const describeArg = (arg) => (arg instanceof Error ? `${arg.code || arg.name}: ${arg.message}` : String(arg));

before(async () => {
  for (const name of consoleMethods) console[name] = (...args) => logged.push(args.map(describeArg).join(' '));
  // server.js calls express() once: that is the app.
  const express = Object.assign(function expressForTest(...args) { app = realExpress(...args); return app; }, realExpress);
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
    }
    if (parent && parent.filename === SERVER_FILE) {
      if (request === 'express') return express;
      if (request === './routes/multistream') return { dashboardRouter: realExpress.Router(), apiRouter: realExpress.Router() };
      if (request.startsWith('./routes/') && request !== './routes/racing-auth') return realExpress.Router();
    }
    let resolved = null;
    try { resolved = Module._resolveFilename(request, parent, isMain); } catch { /* not a file */ }
    if (resolved === CONFIG_FILE) return config;
    return origLoad.apply(this, arguments);
  };
  try {
    require(SERVER_FILE);
    db = require(DB_FILE);
  } finally {
    Module._load = origLoad;
  }
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  Object.assign(console, realConsole);
});

// One request. peer: the address Railway's edge saw (X-Forwarded-For); cf: a
// CF-Connecting-IP header; json: a JSON body.
function send(method, urlPath, { peer = '192.0.2.1', cf, headers = {}, json } = {}) {
  return new Promise((resolve, reject) => {
    const body = json === undefined ? null : Buffer.from(JSON.stringify(json));
    const sent = { 'X-Forwarded-For': peer, ...headers };
    if (cf !== undefined) sent['CF-Connecting-IP'] = cf;
    if (body) Object.assign(sent, { 'Content-Type': 'application/json', 'Content-Length': body.length });
    const r = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: sent, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = undefined; }
        resolve({ status: res.statusCode, headers: res.headers, text, json: parsed });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

// Two Cloudflare edge addresses (two data centres) and the visitors behind them.
const CF_LISBON = '162.158.10.20';
const CF_MADRID = '172.71.30.40';
const CF_IPV6 = '2a06:98c0:3600::103';

describe('the rate limits count each visitor, not the Cloudflare edge in front of them', () => {
  const remaining = (res) => Number(res.headers['ratelimit-remaining']);

  test('the sign-in limit (5 per 15 minutes): two visitors behind one edge have their own counters', async () => {
    const forgot = (peer, cf) => send('GET', '/racing/auth/forgot', { peer, cf });
    for (let i = 1; i <= 5; i++) assert.equal((await forgot(CF_LISBON, '198.51.100.1')).status, 200, `visitor A, request ${i}`);
    assert.equal((await forgot(CF_LISBON, '198.51.100.1')).status, 429, 'visitor A has used the limit');
    assert.equal((await forgot(CF_LISBON, '198.51.100.2')).status, 200, 'visitor B behind the same edge has not');
    assert.equal((await forgot(CF_MADRID, '198.51.100.1')).status, 429, 'visitor A through another data centre is the same visitor');
    assert.equal((await forgot(CF_IPV6, '198.51.100.3')).status, 200, 'an IPv6 Cloudflare edge passes the visitor on too');
  });

  test('a request that did not come through Cloudflare counts as its own address, whatever CF-Connecting-IP says', async () => {
    const forgot = (peer, cf) => send('GET', '/racing/auth/forgot', { peer, cf });
    const direct = '203.0.113.50';
    for (let i = 1; i <= 5; i++) assert.equal((await forgot(direct, `198.51.100.${10 + i}`)).status, 200, `request ${i}`);
    assert.equal((await forgot(direct, '198.51.100.99')).status, 429, 'a new CF-Connecting-IP value does not start a new counter');
    assert.equal((await forgot('203.0.113.51', '198.51.100.11')).status, 200, 'and no counter was kept for the addresses it named');
  });

  test('a Cloudflare edge without a valid CF-Connecting-IP counts as the edge', async () => {
    const edge = '104.16.0.9';
    for (let i = 1; i <= 5; i++) assert.equal((await send('GET', '/racing/auth/forgot', { peer: edge, cf: 'not-an-address' })).status, 200);
    assert.equal((await send('GET', '/racing/auth/forgot', { peer: edge })).status, 429);
  });

  test('the /api limit (150 a minute) and the general limit (200 a minute) count the same way', async () => {
    const api = (cf, peer = CF_LISBON) => send('GET', '/api/bridge/config', { peer, cf });
    assert.equal(remaining(await api('198.51.100.20')), 149);
    assert.equal(remaining(await api('198.51.100.20', CF_MADRID)), 148, 'the same visitor through another data centre');
    assert.equal(remaining(await api('198.51.100.21')), 149, 'another visitor behind the same edge');
    const file = (cf) => send('GET', '/js/csrf.js', { peer: CF_LISBON, cf });
    const first = await file('198.51.100.22');
    assert.equal(first.status, 200);
    assert.equal(first.headers['ratelimit-limit'], '200');
    assert.equal(remaining(first), 199);
    assert.equal(remaining(await file('198.51.100.22')), 198);
    assert.equal(remaining(await file('198.51.100.23')), 199);
  });

  test('the Discord voice limit (60 a minute) too', async () => {
    const voice = (cf) => send('GET', '/api/voice/123456789012345678', { peer: CF_LISBON, cf });
    const first = await voice('198.51.100.30');
    assert.equal(first.headers['ratelimit-limit'], '60');
    assert.equal(remaining(first), 59);
    assert.equal(remaining(await voice('198.51.100.30')), 58);
    assert.equal(remaining(await voice('198.51.100.31')), 59);
  });

  test('IPv6 visitors are counted by their /56, the library\'s default', async () => {
    const api = (cf) => send('GET', '/api/bridge/config', { peer: CF_LISBON, cf });
    assert.equal(remaining(await api('2001:db8:aa:1100::1')), 149);
    assert.equal(remaining(await api('2001:db8:aa:11ff::2')), 148, 'the same /56');
    assert.equal(remaining(await api('2001:db8:aa:1200::1')), 149, 'another /56');
  });

  test('express-rate-limit reports no misconfiguration, at boot or on a request', () => {
    // Its checks print ERR_ERL_... / WRN_ERL_... once (a custom keyGenerator
    // that reads req.ip without ipKeyGenerator, a double count, and so on).
    assert.deepEqual(logged.filter((line) => /\b(ERR|WRN)_ERL_|express-rate-limit/.test(line)), []);
  });
});

describe('the Racing sign-in log records the visitor\'s address', () => {
  const loggedIp = (username) => db.db.prepare('SELECT ip FROM auth_log WHERE username = ? ORDER BY id DESC LIMIT 1').get(username).ip;

  test('through Cloudflare: the CF-Connecting-IP address', async () => {
    const res = await send('POST', '/racing/auth/login-api', { peer: CF_LISBON, cf: '198.51.100.40', json: { username: 'nobody-cf', password: 'wrong-password' } });
    assert.equal(res.status, 401);
    assert.equal(loggedIp('nobody-cf'), '198.51.100.40');
  });

  test('from anywhere else: the address that connected, not a header it sent', async () => {
    const res = await send('POST', '/racing/auth/login-api', { peer: '203.0.113.60', cf: '198.51.100.41', json: { username: 'nobody-direct', password: 'wrong-password' } });
    assert.equal(res.status, 401);
    assert.equal(loggedIp('nobody-direct'), '203.0.113.60');
  });
});
