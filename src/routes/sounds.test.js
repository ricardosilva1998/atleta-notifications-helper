'use strict';

// Custom alert sounds end to end, through the real routers: the dashboard's
// upload / status / delete routes (routes/dashboard.js) and the OBS overlay's
// GET /overlay/sounds/:token/:type (routes/overlay.js), on one Express app with
// the real src/db.js on in-memory SQLite. The sounds folder is a temp folder:
// customSounds and storageQuota are the real modules, pointed at it. Each
// overlay token only ever reaches its own streamer's folder; anything else is a
// 404. Discord, Twitch and the connection managers are stubs; ids, names and
// tokens are synthetic.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');
const RealDatabase = require('better-sqlite3');

for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) {
  process.env[key] = process.env[key] || 'test';
}

const SRC = path.join(__dirname, '..');
const DB_FILE = path.join(SRC, 'db.js');
const OVERLAY_FILE = path.join(__dirname, 'overlay.js');
const DASHBOARD_FILE = path.join(__dirname, 'dashboard.js');
const OVERLAY_CONFIG_FILE = path.join(SRC, 'services', 'overlayConfig.js');
const PAGE_LOOKUPS_FILE = path.join(SRC, 'services', 'pageLookups.js');
const MB = 1024 * 1024;

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'atleta-sounds-'));
const SOUNDS = path.join(DATA, 'sounds');

const realSounds = require('../services/customSounds');
const realQuota = require('../services/storageQuota');

// The real modules, with the temp folder as their data folder.
const sounds = {
  ...realSounds,
  SOUNDS_DIR: SOUNDS,
  soundFilePath: (id, type) => realSounds.soundFilePath(id, type, SOUNDS),
  soundVersions: (id) => realSounds.soundVersions(id, SOUNDS),
  soundUrls: (streamer) => realSounds.soundUrls(streamer, SOUNDS),
  soundStatus: (streamer) => realSounds.soundStatus(streamer, SOUNDS),
};
const volume = { freeMb: 4000 }; // what the fake statfs reports
const quota = {
  ...realQuota,
  uploadRefusal: (options) => realQuota.uploadRefusal({
    ...options,
    root: DATA,
    statfs: () => ({ bsize: 4096, bavail: (volume.freeMb * MB) / 4096 }),
  }),
};

// What the dashboard router needs besides the database; nothing here is used by the sound routes.
const record = () => () => {};
const stubs = {
  '../discord': { client: { guilds: { cache: new Map() } }, fetchGuildChannel: async () => null, streamerGuildForChannel: () => null },
  '../services/twitch': { getUserProfile: async () => null, hasRedemptionScope: () => true, needsBroadcasterReauth: () => false },
  '../services/youtube': {},
  '../services/twitchChat': { chatManager: { isConnected: () => false, sendEventMessage: record(), sendMessage: record() } },
  '../services/youtubeLiveChat': { youtubeChatManager: { isPolling: () => false, startPolling: record(), stopPolling: record() } },
  '../services/agentTriage': { analyzeIssue: async () => {} },
  '../services/eventsub': { eventSubManager: { startForStreamer: record(), stopForStreamer: record() } },
  '../services/streamelements': { streamElementsManager: { startForStreamer: record(), stopForStreamer: record() } },
};

let db;
let bus;
let server;
let port;
const saved = {};
const logs = [];

before(async () => {
  saved.load = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    const from = parent && parent.filename;
    if (from === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...fs, existsSync: () => true, mkdirSync: () => {} };
    }
    if ((from === OVERLAY_FILE || from === DASHBOARD_FILE) && request === '../services/customSounds') return sounds;
    if (from === OVERLAY_CONFIG_FILE && request === './customSounds') return sounds;
    if (from === DASHBOARD_FILE) {
      if (request === '../services/storageQuota') return quota;
      if (Object.hasOwn(stubs, request)) return stubs[request];
    }
    if (from === PAGE_LOOKUPS_FILE && (request === './twitch' || request === './youtube')) return {};
    return saved.load(request, parent, isMain);
  };
  for (const level of ['log', 'warn', 'error']) {
    saved[level] = console[level];
    console[level] = (...args) => logs.push([level, args.join(' ')]);
  }
  saved.fetch = global.fetch;
  global.fetch = async (url) => { throw new Error(`unexpected outbound request in a test: ${url}`); };

  for (const file of [DB_FILE, OVERLAY_FILE, DASHBOARD_FILE, OVERLAY_CONFIG_FILE]) delete require.cache[file];
  db = require(DB_FILE);
  bus = require('../services/overlayBus');
  const { t } = require('../i18n');
  const { applyAccountStatus } = require('../services/streamerAccess');
  const { errorHandler } = require('../errorHandler');

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(SRC, 'views'));
  app.use(express.json());
  app.use((req, res, next) => {
    // What server.js's session middleware does here: log the header's streamer in.
    const id = Number(req.get('x-test-streamer'));
    req.streamer = id ? db.getStreamerById(id) : undefined;
    applyAccountStatus(req);
    res.locals.t = (key, params) => t('en', key, params);
    next();
  });
  app.use('/overlay', require('./overlay'));
  app.use('/dashboard', require('./dashboard'));
  app.use(errorHandler);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = server.address().port;
});

after(async () => {
  global.fetch = saved.fetch;
  for (const level of ['log', 'warn', 'error']) console[level] = saved[level];
  Module._load = saved.load;
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA, { recursive: true, force: true });
});

function request(method, urlPath, { streamer, body, type } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (streamer) headers['x-test-streamer'] = String(streamer);
    if (body) Object.assign(headers, { 'Content-Type': type || 'audio/mpeg', 'Content-Length': body.length });
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, agent: false, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: buf, json: () => JSON.parse(buf.toString('utf8')) });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

// Real file headers (what the upload route checks), then synthetic filler.
const mp3 = (fill, size = 64) => Buffer.concat([Buffer.from('ID3'), Buffer.alloc(size, fill)]);
const wav = (fill) => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(64, fill)]);

let counter = 0;
function addStreamer() {
  const n = ++counter;
  const token = `tok-sounds-${n}-${'x'.repeat(12)}`;
  const id = Number(db.db.prepare('INSERT INTO streamers (discord_user_id, discord_username, overlay_token) VALUES (?, ?, ?)')
    .run(`60000000000000${String(n).padStart(4, '0')}`, `sounds${n}`, token).lastInsertRowid);
  return { id, token };
}

const upload = (streamer, type, body) => request('POST', `/dashboard/overlay/sounds/${type}`, { streamer: streamer.id, body });
const play = (token, type) => request('GET', `/overlay/sounds/${encodeURIComponent(token)}/${type}`);
const stored = (streamer, type) => path.join(SOUNDS, String(streamer.id), `${type}.mp3`);

// A sparse file in a streamer's media folder (its size counts, nothing is written).
function mediaOf(streamer, folder, size) {
  const file = path.join(DATA, folder, String(streamer.id), 'big.bin');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  fs.truncateSync(file, size);
  return file;
}

beforeEach(() => {
  logs.length = 0;
  volume.freeMb = 4000;
});

describe('an overlay token reaches only its own streamer\'s sounds', () => {
  let a;
  let b;
  before(async () => {
    a = addStreamer();
    b = addStreamer();
    assert.equal((await upload(a, 'follow', mp3(1))).status, 200);
  });

  test('the upload lands in the uploader\'s own folder', () => {
    assert.deepEqual(fs.readFileSync(stored(a, 'follow')), mp3(1));
    assert.equal(fs.existsSync(path.join(SOUNDS, String(b.id))), false, 'nothing in anyone else\'s folder');
  });

  test('the owner\'s token plays it, with the headers of an uploaded file', async () => {
    const res = await play(a.token, 'follow');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, mp3(1));
    assert.equal(res.headers['content-type'], 'audio/mpeg');
    assert.equal(res.headers['cache-control'], 'no-cache');
    assert.equal(res.headers['content-security-policy'], "sandbox; default-src 'none'");
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['content-disposition'], undefined, 'a sound plays inline');
  });

  test('another streamer\'s token gets a 404 for that alert, not the other streamer\'s sound', async () => {
    assert.equal((await play(b.token, 'follow')).status, 404);
  });

  test('each token plays its own file when both streamers have one', async () => {
    assert.equal((await upload(b, 'follow', wav(2))).status, 200);
    const fromB = await play(b.token, 'follow');
    assert.deepEqual(fromB.body, wav(2));
    assert.equal(fromB.headers['content-type'], 'audio/wav', 'the type comes from the file itself');
    assert.deepEqual((await play(a.token, 'follow')).body, mp3(1));
  });

  test('an unknown token, an unknown alert type or a path that leaves the folder is a 404', async () => {
    assert.equal((await play('not-a-real-token-at-all', 'follow')).status, 404);
    for (const type of ['notatype', 'follow.mp3', '..%2F..%2Fbot.db', `..%2F${b.id}%2Ffollow`, '%2E%2E']) {
      assert.equal((await play(a.token, type)).status, 404, type);
    }
  });

  test('a sound left in the old shared folder plays for nobody', async () => {
    fs.mkdirSync(SOUNDS, { recursive: true });
    fs.writeFileSync(path.join(SOUNDS, 'raid.mp3'), mp3(9));
    assert.equal((await play(a.token, 'raid')).status, 404);
    assert.equal((await play(b.token, 'raid')).status, 404);
  });
});

describe('the dashboard\'s sound routes', () => {
  test('status lists the streamer\'s own sounds, with URLs on their own token', async () => {
    const a = addStreamer();
    const b = addStreamer();
    await upload(a, 'raid', mp3(3));
    const status = (await request('GET', '/dashboard/overlay/sounds/status', { streamer: a.id })).json();
    assert.equal(status.custom.raid, true);
    assert.equal(status.custom.follow, false);
    assert.match(status.urls.raid, new RegExp(`^/overlay/sounds/${a.token}/raid\\?v=\\d+$`));
    const other = (await request('GET', '/dashboard/overlay/sounds/status', { streamer: b.id })).json();
    assert.equal(other.custom.raid, false);
    assert.deepEqual(other.urls, {});
  });

  test('an upload for an unknown alert type, or of a file that is not a sound, is refused and nothing is written', async () => {
    const a = addStreamer();
    const badType = await upload(a, 'notatype', mp3(4));
    assert.equal(badType.status, 400);
    assert.equal(badType.json().error, 'This alert type cannot have a custom sound');
    const notAudio = await upload(a, 'bits', Buffer.from('<html><body>not a sound</body></html>'));
    assert.equal(notAudio.status, 400);
    assert.equal(notAudio.json().error, 'This file is not an MP3, WAV, OGG or M4A sound');
    assert.equal(fs.existsSync(path.join(SOUNDS, String(a.id))), false);
  });

  test('deleting removes only the deleting streamer\'s file', async () => {
    const a = addStreamer();
    const b = addStreamer();
    await upload(a, 'bits', mp3(5));
    await upload(b, 'bits', mp3(6));
    assert.equal((await request('POST', '/dashboard/overlay/sounds/bits/delete', { streamer: b.id })).status, 200);
    assert.equal((await play(b.token, 'bits')).status, 404);
    assert.deepEqual((await play(a.token, 'bits')).body, mp3(5));
  });

  test('replacing a sound gives it a new URL, so OBS fetches the new one', async () => {
    const a = addStreamer();
    await upload(a, 'donation', mp3(7));
    fs.utimesSync(stored(a, 'donation'), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    const before = (await request('GET', '/dashboard/overlay/sounds/status', { streamer: a.id })).json().urls.donation;
    await upload(a, 'donation', mp3(8));
    const after = (await request('GET', '/dashboard/overlay/sounds/status', { streamer: a.id })).json().urls.donation;
    assert.ok(before && after);
    assert.notEqual(after, before);
    assert.deepEqual((await play(a.token, 'donation')).body, mp3(8));
  });

  test('someone who is not logged in is sent to the login page', async () => {
    const res = await request('POST', '/dashboard/overlay/sounds/follow', { body: mp3(1) });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/auth/login');
  });
});

describe('room for uploads', () => {
  test('an upload that would take the streamer\'s media past 250 MB is refused, and nothing is written', async () => {
    const a = addStreamer();
    mediaOf(a, 'sponsors', 249 * MB);
    const res = await upload(a, 'follow', mp3(1, 2 * MB));
    assert.equal(res.status, 507);
    assert.match(res.json().error, /past 250 MB/);
    assert.equal(fs.existsSync(stored(a, 'follow')), false);
    assert.ok(logs.some(([level, line]) => level === 'warn' && /media quota reached/.test(line)));
  });

  test('replacing a sound counts the old one as gone', async () => {
    const a = addStreamer();
    assert.equal((await upload(a, 'follow', mp3(1, 2 * MB))).status, 200);
    mediaOf(a, 'vtuber-models', 247 * MB); // 249 MB with the sound
    assert.equal((await upload(a, 'follow', mp3(2, 2 * MB))).status, 200, '249 - 2 + 2 is within 250 MB');
    assert.equal((await upload(a, 'raid', mp3(3, 2 * MB))).status, 507, 'a new sound on top is not');
  });

  test('no upload is stored when the data volume would have less than 200 MB free', async () => {
    const a = addStreamer();
    volume.freeMb = 150;
    const res = await upload(a, 'follow', mp3(1));
    assert.equal(res.status, 507);
    assert.match(res.json().error, /short of storage space/);
    assert.equal(fs.existsSync(stored(a, 'follow')), false);
  });

  test('another streamer\'s media does not count toward this streamer\'s 250 MB', async () => {
    const a = addStreamer();
    const b = addStreamer();
    mediaOf(b, 'redemptions', 249 * MB);
    assert.equal((await upload(a, 'follow', mp3(1, 2 * MB))).status, 200);
  });
});

test('an open overlay is told when the streamer\'s sounds change', async () => {
  const a = addStreamer();
  const events = [];
  const listener = (event) => events.push(event);
  bus.on(`overlay:${a.id}`, listener);
  try {
    await upload(a, 'giveaway_winner', mp3(4));
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'config-update');
    assert.match(events[0].sounds.giveaway_winner, new RegExp(`^/overlay/sounds/${a.token}/giveaway_winner\\?v=`));
  } finally {
    bus.off(`overlay:${a.id}`, listener);
  }
});
