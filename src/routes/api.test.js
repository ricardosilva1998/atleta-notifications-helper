'use strict';

// The /api/guild routes: the channel list stays (for a server the streamer has
// claimed), and the role list is gone. It listed every role without the sub-sync
// eligibility rule and nothing called it. The real src/routes/api.js over the
// real src/db.js on in-memory SQLite; the Discord client is a stub.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');
const { Collection } = require('discord.js');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) {
  process.env[key] = process.env[key] || 'test';
}

const SRC = path.join(__dirname, '..');
const DB_FILE = path.join(SRC, 'db.js');
const API_FILE = path.join(__dirname, 'api.js');
const GUILD = '800000000000000001';

const guild = {
  id: GUILD,
  channels: {
    cache: new Collection([
      ['1', { id: '1', type: 0, name: 'general' }],
      ['2', { id: '2', type: 0, name: 'alerts' }],
      ['3', { id: '3', type: 4, name: 'a category' }],
    ]),
  },
  roles: { cache: new Collection([['9', { id: '9', name: 'Moderators', managed: false }]]) },
};
const discordStub = { client: { guilds: { cache: new Map([[GUILD, guild]]) } } };

let db;
let server;
let port;
const saved = {};

function get(urlPath, streamer) {
  return new Promise((resolve, reject) => {
    const headers = streamer ? { 'x-test-streamer': String(streamer) } : {};
    http.get({ host: '127.0.0.1', port, path: urlPath, agent: false, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    }).on('error', reject);
  });
}

before(async () => {
  saved.load = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    const from = parent && parent.filename;
    if (from === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
    }
    if (from === API_FILE && request === '../discord') return discordStub;
    return saved.load(request, parent, isMain);
  };
  // A fresh database prints a line per migration (and two known migration errors); keep the output clean.
  saved.log = console.log;
  saved.error = console.error;
  console.log = () => {};
  console.error = () => {};

  delete require.cache[DB_FILE];
  delete require.cache[API_FILE];
  db = require(DB_FILE);

  const app = express();
  app.use((req, res, next) => {
    const id = Number(req.get('x-test-streamer'));
    req.streamer = id ? db.getStreamerById(id) : undefined;
    next();
  });
  app.use('/api', require('./api'));
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = server.address().port;
});

after(async () => {
  console.log = saved.log;
  console.error = saved.error;
  Module._load = saved.load;
  await new Promise((resolve) => server.close(resolve));
});

describe('/api/guild', () => {
  let owner;
  let stranger;
  before(() => {
    const add = db.db.prepare('INSERT INTO streamers (discord_user_id, discord_username) VALUES (?, ?)');
    owner = Number(add.run('500000000000000001', 'owner').lastInsertRowid);
    stranger = Number(add.run('500000000000000002', 'stranger').lastInsertRowid);
    db.upsertGuild(GUILD, owner, 'Server');
  });

  test('the channel list is available to the streamer who claimed the server, text channels only', async () => {
    const res = await get(`/api/guild/${GUILD}/channels`, owner);
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.text), [{ id: '2', name: 'alerts' }, { id: '1', name: 'general' }]);
  });

  test('the channel list is refused to anyone else', async () => {
    assert.equal((await get(`/api/guild/${GUILD}/channels`, stranger)).status, 403);
    assert.equal((await get(`/api/guild/${GUILD}/channels`)).status, 401);
  });

  test('there is no role list any more', async () => {
    assert.equal((await get(`/api/guild/${GUILD}/roles`, owner)).status, 404);
  });
});
