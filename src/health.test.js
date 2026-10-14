'use strict';

// GET /health: 200 {"ok":true} while the database answers, 503 {"ok":false}
// when it does not. The real src/db.js on an in-memory SQLite database, served
// by a small Express app; nothing else is in the answer.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');
const { healthHandler } = require('./health');

for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) {
  process.env[key] = process.env[key] || 'test';
}

const DB_FILE = path.join(__dirname, 'db.js');
const saved = {};
const errors = [];

function serve(db) {
  const app = express();
  app.get('/health', healthHandler(db));
  return new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
}

function get(server, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: urlPath, agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    }).on('error', reject);
  });
}

let db;
before(() => {
  saved.load = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
    }
    return saved.load(request, parent, isMain);
  };
  saved.log = console.log;
  saved.error = console.error;
  console.log = () => {}; // the migrations log on load
  console.error = (...args) => errors.push(args.join(' '));
  delete require.cache[DB_FILE];
  db = require(DB_FILE);
});

after(() => {
  console.log = saved.log;
  console.error = saved.error;
  Module._load = saved.load;
});

test('answers 200 {"ok":true} while the database answers', async () => {
  const server = await serve(db);
  try {
    const res = await get(server, '/health');
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.text), { ok: true });
    assert.equal(res.headers['cache-control'], 'no-store');
  } finally {
    server.close();
  }
});

test('answers 503 {"ok":false} when the database fails, and logs why', async () => {
  const failing = { ping() { throw new Error('disk I/O error'); } };
  const server = await serve(failing);
  try {
    errors.length = 0;
    const res = await get(server, '/health');
    assert.equal(res.status, 503);
    assert.deepEqual(JSON.parse(res.text), { ok: false }, 'nothing about the failure in the answer');
    assert.match(errors.join('\n'), /Database check failed: disk I\/O error/);
  } finally {
    server.close();
  }
});

test('answers 503 once the real database connection is closed', async () => {
  const server = await serve(db);
  try {
    db.closeDb();
    errors.length = 0;
    const res = await get(server, '/health');
    assert.equal(res.status, 503);
    assert.deepEqual(JSON.parse(res.text), { ok: false });
  } finally {
    server.close();
  }
});
