'use strict';

// The real src/server.js app, answering over HTTP on 127.0.0.1, on the real
// src/db.js over an in-memory SQLite database (nothing touches data/). The
// config is a stub, and the routers server.js mounts from routes/ are empty
// ones, except routes/racing-auth.js (its sign-in log is checked here) and
// routes/coaching.js (the viewer's sign-in and its CSRF token, with a fake
// src/discord.js).
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
const SPOTIFY_FILE = path.join(__dirname, 'services', 'spotify.js');
const DISCORD_FILE = path.join(__dirname, 'discord.js');
// The coaching page's files, which get the fake Discord below.
const COACHING_FILES = ['routes/coaching.js', 'services/coachingBookings.js', 'services/coachingMessages.js'].map((f) => path.join(__dirname, f));
const REAL_ROUTES = new Set(['./routes/racing-auth', './routes/coaching']);
const discordStub = {
  isGuildMember: async () => true, guildName: () => 'Coach HQ', sendDirectMessage: async () => ({ ok: true }),
  fetchInvite: async () => ({ ok: false, reason: 'unavailable' }), escapeLinkText: (text) => String(text),
};

// services/spotify.js as the Racing-app routes load it (on first use): no network.
const spotifyCalls = [];
const spotifyStub = {
  getCurrentlyPlaying: async (streamer) => { spotifyCalls.push(['playing', streamer.id]); return { status: 'playing', track: 'Synthetic Song' }; },
  refreshSpotifyToken: async (streamer) => { spotifyCalls.push(['refresh', streamer.id]); return 'synthetic-refreshed-token'; },
};
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
      if (request.startsWith('./routes/') && !REAL_ROUTES.has(request)) return realExpress.Router();
    }
    let resolved = null;
    try { resolved = Module._resolveFilename(request, parent, isMain); } catch { /* not a file */ }
    if (resolved === CONFIG_FILE) return config;
    if (resolved === DISCORD_FILE && parent && COACHING_FILES.includes(parent.filename)) return discordStub;
    return origLoad.apply(this, arguments);
  };
  try {
    require(SERVER_FILE);
    db = require(DB_FILE);
  } finally {
    Module._load = origLoad;
  }
  const spotify = new Module(SPOTIFY_FILE, module);
  Object.assign(spotify, { filename: SPOTIFY_FILE, loaded: true, exports: spotifyStub });
  require.cache[SPOTIFY_FILE] = spotify;
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  Object.assign(console, realConsole);
});

// A new private address for each request that does not name one, so tests
// never share a rate-limit counter by accident.
let peers = 0;
const nextPeer = () => { peers++; return `10.0.${Math.floor(peers / 250)}.${(peers % 250) + 1}`; };

// One request. peer: the address Railway's edge saw (X-Forwarded-For); cf: a
// CF-Connecting-IP header; json: a JSON body.
function send(method, urlPath, { peer = nextPeer(), cf, headers = {}, json } = {}) {
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

// ── What the Atleta Racing app uploads ───────────────────────────────────
// Payloads shaped exactly as bridge/sessionRecorder.js, bridge/telemetry.js and
// bridge/main.js send them, and values of the wrong kind or length in every
// field, which the routes must not store as they are.

const zlib = require('node:zlib');

const BRIDGE_ID = '3f1c2a9e-8b7d-4c6e-9f10-2a3b4c5d6e7f'; // crypto.randomUUID(), bridge/settings.js
const HOSTILE = ['<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>', "'><script>alert(1)</script>"];
// Telemetry as sessionRecorder.js compresses it: gzip of the samples, base64.
const TELEMETRY = zlib.gzipSync(JSON.stringify([[0.5, 0, 120.5, 4, 0.01, 0.1234]])).toString('base64');

const row = (sql, ...params) => db.db.prepare(sql).get(...params);
const rows = (sql, ...params) => db.db.prepare(sql).all(...params);

// A track outline as telemetry.js builds it: 500 slots of {x, y}.
const outline = (points = 500) => Array.from({ length: points }, (_, i) => ({ x: Math.cos(i / 80) * 300, y: Math.sin(i / 80) * 200 }));
// The metadata telemetry.js sends from iRacing's WeekendInfo.
const weekend = { trackLength: '5.79 km', trackTurns: 21, trackCountry: 'Germany', trackCity: 'Nürburg' };
const trackMeta = (name) => row('SELECT track_length, track_turns, track_country, track_city FROM track_maps WHERE track_name = ?', name);

describe('POST /api/track-map (telemetry.js uploadTrackToServer)', () => {
  test('the app\'s upload is stored as it was sent', async () => {
    const res = await send('POST', '/api/track-map', { json: { trackName: 'Nurburgring Combined', trackData: outline(), ...weekend } });
    assert.deepEqual(res.json, { status: 'ok', points: 500 });
    assert.deepEqual(trackMeta('Nurburgring Combined'), { track_length: '5.79 km', track_turns: 21, track_country: 'Germany', track_city: 'Nürburg' });
  });

  test('a length in miles, and the app\'s "unknown" values (empty text, 0 turns) store nothing, as before', async () => {
    await send('POST', '/api/track-map', { json: { trackName: 'Oval A', trackData: outline(), trackLength: '0.53 mi', trackTurns: 4, trackCountry: 'USA', trackCity: 'Bristol' } });
    assert.deepEqual(trackMeta('Oval A'), { track_length: '0.53 mi', track_turns: 4, track_country: 'USA', track_city: 'Bristol' });
    await send('POST', '/api/track-map', { json: { trackName: 'Unknown B', trackData: outline(), trackLength: '', trackTurns: 0, trackCountry: '', trackCity: '' } });
    assert.deepEqual(trackMeta('Unknown B'), { track_length: null, track_turns: null, track_country: null, track_city: null });
  });

  test('anything else is not stored: a length that is not "<number> km|mi", turns outside 0-200, places cut to 80 characters', async () => {
    for (const [i, bad] of HOSTILE.entries()) {
      const name = `Hostile track ${i}`;
      const res = await send('POST', '/api/track-map', { json: { trackName: name, trackData: outline(), trackLength: bad, trackTurns: bad, trackCountry: bad, trackCity: bad } });
      assert.equal(res.status, 200);
      const meta = trackMeta(name);
      assert.equal(meta.track_length, null);
      assert.equal(meta.track_turns, null);
      assert.equal(meta.track_country, bad, 'a place name is text (the pages escape it)');
    }
    for (const turns of [201, -1, 12.5, 'twelve', true, [12], { n: 12 }]) {
      await send('POST', '/api/track-map', { json: { trackName: `Turns ${JSON.stringify(turns)}`, trackData: outline(), trackTurns: turns } });
      assert.equal(trackMeta(`Turns ${JSON.stringify(turns)}`).track_turns, null, JSON.stringify(turns));
    }
    await send('POST', '/api/track-map', { json: { trackName: 'Turns as text', trackData: outline(), trackTurns: '12' } });
    assert.equal(trackMeta('Turns as text').track_turns, 12, 'a number sent as text is a number');
    for (const length of ['5.79', '5.79 km extra', '12345 km', '5.7912 km', 579, ['5.79 km']]) {
      await send('POST', '/api/track-map', { json: { trackName: `Length ${JSON.stringify(length)}`, trackData: outline(), trackLength: length } });
      assert.equal(trackMeta(`Length ${JSON.stringify(length)}`).track_length, null, JSON.stringify(length));
    }
    await send('POST', '/api/track-map', { json: { trackName: 'Long places', trackData: outline(), trackCountry: 'C'.repeat(300), trackCity: { city: 'x' } } });
    assert.deepEqual(trackMeta('Long places'), { track_length: null, track_turns: null, track_country: 'C'.repeat(80), track_city: null });
  });

  test('a track already stored keeps its details: an upload only fills the ones it does not have yet', async () => {
    const name = 'Spa Kept';
    await send('POST', '/api/track-map', { json: { trackName: name, trackData: outline(400), trackLength: '7.00 km' } });
    // A smaller or equal outline: the stored one stays; empty details are filled in.
    let res = await send('POST', '/api/track-map', { json: { trackName: name, trackData: outline(300), trackLength: '1.00 km', trackTurns: 19, trackCountry: 'Belgium', trackCity: 'Stavelot' } });
    assert.equal(res.json.status, 'exists');
    assert.deepEqual(trackMeta(name), { track_length: '7.00 km', track_turns: 19, track_country: 'Belgium', track_city: 'Stavelot' });
    // A better outline replaces the stored one, and still changes no detail it already has.
    res = await send('POST', '/api/track-map', { json: { trackName: name, trackData: outline(500), trackLength: '2.00 km', trackTurns: 3, trackCountry: 'Elsewhere', trackCity: 'Elsewhere' } });
    assert.equal(res.json.status, 'ok');
    assert.equal(row('SELECT point_count FROM track_maps WHERE track_name = ?', name).point_count, 500);
    assert.deepEqual(trackMeta(name), { track_length: '7.00 km', track_turns: 19, track_country: 'Belgium', track_city: 'Stavelot' });
  });
});

// The first upload of a session, as sessionRecorder.js createSessionOnServer() builds it.
function bridgeLap(lapNumber, lapTime, extra = {}) {
  return { lap_number: lapNumber, lap_time: lapTime, sector_times: null, fuel_used: null, air_temp: 21.5, track_temp: 30.25, is_pit_lap: false, position: 4, incidents: 2, is_valid: false, ...extra };
}
function bridgeSession(trackName, { session = {}, laps, ...rest } = {}) {
  const firstLap = bridgeLap(1, 95.123);
  return {
    bridge_id: BRIDGE_ID,
    iracing_name: 'Synthetic Driver',
    session: {
      track_name: trackName,
      car_class: 'GT3 Class',
      car_name: 'BMW M4 GT3',
      session_type: 'race',
      race_type: null,
      conditions: { airTemp: 21.5, trackTemp: 30.25, humidity: 55, skies: 'Partly Cloudy', windSpeed: 3.2 },
      sof: 2150,
      finish_position: null,
      irating_change: null,
      driver_count: 24,
      best_lap_time: 95.123,
      lap_count: 1,
      ...session,
    },
    laps: laps || [firstLap],
    telemetry: [{ lap_number: 1, data: TELEMETRY }],
    ...rest,
  };
}
const SESSION_COLUMNS = 'bridge_id, iracing_name, track_name, car_class, car_name, session_type, race_type, is_public, conditions, sof, finish_position, irating_change, driver_count, best_lap_time, lap_count';
const LAP_COLUMNS = 'lap_number, lap_time, sector_times, fuel_used, air_temp, track_temp, is_pit_lap, position, incidents, is_valid';
const storedSession = (id) => row(`SELECT ${SESSION_COLUMNS} FROM racing_sessions WHERE id = ?`, id);
const storedLaps = (id) => rows(`SELECT ${LAP_COLUMNS} FROM session_laps WHERE session_id = ? ORDER BY id`, id);
const storedTelemetry = (id) => rows('SELECT t.data FROM lap_telemetry t JOIN session_laps l ON l.id = t.lap_id WHERE l.session_id = ? ORDER BY l.id', id).map((r) => r.data);

describe('POST /api/session (sessionRecorder.js createSessionOnServer)', () => {
  test('the app\'s first upload is stored as it was sent', async () => {
    const res = await send('POST', '/api/session', { json: bridgeSession('Track S1') });
    assert.equal(res.status, 200);
    assert.ok(Number.isInteger(res.json.id) && typeof res.json.share_token === 'string');
    assert.deepEqual(storedSession(res.json.id), {
      bridge_id: BRIDGE_ID, iracing_name: 'Synthetic Driver', track_name: 'Track S1', car_class: 'GT3 Class', car_name: 'BMW M4 GT3',
      session_type: 'race', race_type: null, is_public: 0,
      conditions: JSON.stringify({ airTemp: 21.5, trackTemp: 30.25, humidity: 55, skies: 'Partly Cloudy', windSpeed: 3.2 }),
      sof: 2150, finish_position: null, irating_change: null, driver_count: 24, best_lap_time: 95.123, lap_count: 1,
    });
    assert.deepEqual(storedLaps(res.json.id), [{ lap_number: 1, lap_time: 95.123, sector_times: null, fuel_used: null, air_temp: 21.5, track_temp: 30.25, is_pit_lap: 0, position: 4, incidents: 2, is_valid: 0 }]);
    assert.deepEqual(storedTelemetry(res.json.id), [TELEMETRY]);
  });

  test('an older app\'s whole-session upload (every lap at the end) and every session type it names', async () => {
    const laps = [bridgeLap(1, 101.5), bridgeLap(2, 96.25, { fuel_used: 2.41, is_valid: true }), bridgeLap(3, 97.75, { fuel_used: 2.38, is_valid: true, is_pit_lap: true })];
    for (const type of ['practice', 'qualify', 'race']) {
      const payload = bridgeSession(`Track S2 ${type}`, { session: { session_type: type, race_type: 'sprint', lap_count: 3, finish_position: 7, irating_change: -23 }, laps });
      payload.telemetry = laps.map((l) => ({ lap_number: l.lap_number, data: TELEMETRY }));
      const res = await send('POST', '/api/session', { json: payload });
      assert.equal(res.status, 200, type);
      const stored = storedSession(res.json.id);
      assert.equal(stored.session_type, type);
      assert.deepEqual([stored.race_type, stored.lap_count, stored.finish_position, stored.irating_change], ['sprint', 3, 7, -23]);
      assert.deepEqual(storedLaps(res.json.id).map((l) => [l.lap_number, l.lap_time, l.fuel_used, l.is_valid, l.is_pit_lap]), [[1, 101.5, null, 0, 0], [2, 96.25, 2.41, 1, 0], [3, 97.75, 2.38, 1, 1]]);
      assert.equal(storedTelemetry(res.json.id).length, 3);
    }
  });

  test('numbers that are not numbers are stored as nothing; text is cut to its length', async () => {
    for (const [i, bad] of HOSTILE.entries()) {
      const payload = bridgeSession(`Track S3 ${i}`, {
        iracing_name: bad + 'N'.repeat(200),
        session: { car_name: bad, race_type: bad + 'R'.repeat(100), sof: bad, finish_position: bad, irating_change: bad, driver_count: bad, best_lap_time: bad, lap_count: bad },
      });
      const res = await send('POST', '/api/session', { json: payload });
      assert.equal(res.status, 200);
      const stored = storedSession(res.json.id);
      assert.deepEqual([stored.sof, stored.finish_position, stored.irating_change, stored.driver_count, stored.best_lap_time], [null, null, null, null, null]);
      assert.equal(stored.lap_count, 1, 'the number of laps sent');
      assert.equal(stored.iracing_name, (bad + 'N'.repeat(200)).slice(0, 100));
      assert.equal(stored.car_name, bad, 'text stays text (the pages escape it)');
      assert.equal(stored.race_type, (bad + 'R'.repeat(100)).slice(0, 40));
    }
  });

  test('lap values that are not numbers are stored as nothing', async () => {
    const res = await send('POST', '/api/session', { json: bridgeSession('Track S4', { laps: [bridgeLap(1, 95.5, { fuel_used: HOSTILE[0], air_temp: HOSTILE[1], track_temp: {}, position: HOSTILE[2], incidents: [3], sector_times: [HOSTILE[0]] })] }) });
    assert.equal(res.status, 200);
    assert.deepEqual(storedLaps(res.json.id), [{ lap_number: 1, lap_time: 95.5, sector_times: null, fuel_used: null, air_temp: null, track_temp: null, is_pit_lap: 0, position: null, incidents: null, is_valid: 0 }]);
    const sectors = await send('POST', '/api/session', { json: bridgeSession('Track S4b', { laps: [bridgeLap(1, 95.5, { sector_times: [31.2, 33.4, 30.9] })] }) });
    assert.equal(storedLaps(sectors.json.id)[0].sector_times, '[31.2,33.4,30.9]');
  });

  test('conditions keep the five values the app sends, as numbers and a short sky text', async () => {
    const conditions = { airTemp: HOSTILE[0], trackTemp: 30, humidity: null, skies: HOSTILE[1] + 'S'.repeat(50), windSpeed: 2, extra: 'dropped', nested: { deep: true } };
    const res = await send('POST', '/api/session', { json: bridgeSession('Track S5', { session: { conditions } }) });
    assert.equal(storedSession(res.json.id).conditions, JSON.stringify({ trackTemp: 30, humidity: null, skies: (HOSTILE[1] + 'S'.repeat(50)).slice(0, 40), windSpeed: 2 }));
    const none = await send('POST', '/api/session', { json: bridgeSession('Track S5b', { session: { conditions: 'sunny' } }) });
    assert.equal(storedSession(none.json.id).conditions, null);
  });

  test('refused, as before when a field was missing: a session type that is not a word, a lap without a number or time, a bridge id the app could not have made', async () => {
    for (const type of [HOSTILE[0], 'race2', 'x'.repeat(33), '', 42, null]) {
      const res = await send('POST', '/api/session', { json: bridgeSession('Track S6', { session: { session_type: type } }) });
      assert.equal(res.status, 400, JSON.stringify(type));
    }
    assert.equal((await send('POST', '/api/session', { json: bridgeSession('Track S6', { session: { session_type: 'Offline Testing' } }) })).status, 200, 'a word is kept');
    for (const lap of [bridgeLap(HOSTILE[0], 95), bridgeLap(1, HOSTILE[1]), bridgeLap(null, 95), 'lap']) {
      assert.equal((await send('POST', '/api/session', { json: bridgeSession('Track S6', { laps: [lap] }) })).status, 400, JSON.stringify(lap));
    }
    assert.equal((await send('POST', '/api/session', { json: bridgeSession('Track S6', { laps: { 0: bridgeLap(1, 95) } }) })).status, 400, 'laps is a list');
    for (const id of [HOSTILE[0], 'short', 'a'.repeat(65), 12345678]) {
      assert.equal((await send('POST', '/api/session', { json: bridgeSession('Track S6', { bridge_id: id }) })).status, 400, JSON.stringify(id));
    }
    const count = row("SELECT COUNT(*) AS n FROM racing_sessions WHERE track_name = 'Track S6'").n;
    assert.equal(count, 1, 'only the valid one was stored');
  });

  test('telemetry that is not the app\'s text is left out, the session is kept', async () => {
    const res = await send('POST', '/api/session', { json: bridgeSession('Track S7', { telemetry: [{ lap_number: 1, data: { not: 'text' } }] }) });
    assert.equal(res.status, 200);
    assert.deepEqual(storedTelemetry(res.json.id), []);
    const notList = await send('POST', '/api/session', { json: bridgeSession('Track S7b', { telemetry: 'x' }) });
    assert.equal(notList.status, 200);
  });
});

describe('POST /api/session/:id/lap and PATCH /api/session/:id/finish (sessionRecorder.js)', () => {
  async function newSession(trackName) {
    return (await send('POST', '/api/session', { json: bridgeSession(trackName) })).json.id;
  }

  test('the app\'s next lap is stored as it was sent', async () => {
    const id = await newSession('Track L1');
    const lap = bridgeLap(2, 94.875, { fuel_used: 2.45, is_valid: true });
    const res = await send('POST', `/api/session/${id}/lap`, { json: { bridge_id: BRIDGE_ID, lap, telemetry: TELEMETRY } });
    assert.equal(res.status, 200);
    assert.deepEqual(storedLaps(id)[1], { lap_number: 2, lap_time: 94.875, sector_times: null, fuel_used: 2.45, air_temp: 21.5, track_temp: 30.25, is_pit_lap: 0, position: 4, incidents: 2, is_valid: 1 });
    assert.deepEqual(storedTelemetry(id), [TELEMETRY, TELEMETRY]);
    assert.deepEqual([storedSession(id).lap_count, storedSession(id).best_lap_time], [2, 94.875]);
  });

  test('a lap without a number or time is refused; other values that are not numbers are stored as nothing', async () => {
    const id = await newSession('Track L2');
    for (const lap of [bridgeLap(HOSTILE[0], 95), bridgeLap(2, HOSTILE[1]), bridgeLap(0, 95), 'lap']) {
      assert.equal((await send('POST', `/api/session/${id}/lap`, { json: { bridge_id: BRIDGE_ID, lap } })).status, 400, JSON.stringify(lap));
    }
    const res = await send('POST', `/api/session/${id}/lap`, { json: { bridge_id: BRIDGE_ID, lap: bridgeLap(2, 96, { fuel_used: HOSTILE[0], position: HOSTILE[1], incidents: HOSTILE[2], sector_times: HOSTILE[0] }), telemetry: { not: 'text' } } });
    assert.equal(res.status, 200);
    assert.deepEqual(storedLaps(id)[1], { lap_number: 2, lap_time: 96, sector_times: null, fuel_used: null, air_temp: 21.5, track_temp: 30.25, is_pit_lap: 0, position: null, incidents: null, is_valid: 0 });
    assert.equal(storedTelemetry(id).length, 1, 'the telemetry that was not text was left out');
  });

  test('the app\'s result is stored; a result that is not a number changes nothing', async () => {
    const id = await newSession('Track F1');
    let res = await send('PATCH', `/api/session/${id}/finish`, { json: { bridge_id: BRIDGE_ID, finish_position: 3, irating_change: -12, best_lap_time: 94.5 } });
    assert.equal(res.status, 200);
    assert.deepEqual([storedSession(id).finish_position, storedSession(id).irating_change, storedSession(id).best_lap_time], [3, -12, 94.5]);
    res = await send('PATCH', `/api/session/${id}/finish`, { json: { bridge_id: BRIDGE_ID, finish_position: HOSTILE[0], irating_change: HOSTILE[1], best_lap_time: HOSTILE[2] } });
    assert.equal(res.status, 200);
    assert.deepEqual([storedSession(id).finish_position, storedSession(id).irating_change, storedSession(id).best_lap_time], [3, -12, 94.5]);
  });

  test('the race-result notification is written from the stored numbers', async () => {
    db.createRacingUser('notified-racer', 'x', 'Synthetic Driver', BRIDGE_ID);
    const user = db.getRacingUserByBridgeId(BRIDGE_ID);
    const id = await newSession('Track F2');
    await send('PATCH', `/api/session/${id}/finish`, { json: { bridge_id: BRIDGE_ID, finish_position: HOSTILE[0], irating_change: 17 } });
    const note = row("SELECT message FROM notifications WHERE user_id = ? AND type = 'race_result' ORDER BY id DESC LIMIT 1", user.id);
    assert.equal(note.message, ' at Track F2 (+17 iR)');
  });

  test('PATCH /api/session/:id without a body is a 400, not an error', async () => {
    const id = await newSession('Track P1');
    assert.equal((await send('PATCH', `/api/session/${id}`)).status, 400);
    assert.equal((await send('PATCH', `/api/session/${id}`, { json: { bridge_id: BRIDGE_ID, is_public: true } })).status, 200);
    assert.equal(storedSession(id).is_public, 1);
  });
});

describe('POST /api/live-session (telemetry.js heartbeat)', () => {
  const heartbeat = { trackName: 'Daytona International Speedway', eventType: 'Race', classes: ['GTP', 'LMP2', 'GT3 Class'], driversCount: 48, totalMinutes: 165, timeRemain: 5412, raceType: 'IMSA Endurance' };

  test('the app\'s heartbeat is shown as it was sent', async () => {
    assert.deepEqual((await send('POST', '/api/live-session', { json: heartbeat })).json, { ok: true });
    assert.deepEqual((await send('GET', '/api/live-session')).json, heartbeat);
    await send('POST', '/api/live-session', { json: { ...heartbeat, eventType: 'Practice', classes: [], raceType: null } });
    assert.deepEqual((await send('GET', '/api/live-session')).json, { ...heartbeat, eventType: 'Practice', classes: [], raceType: null });
  });

  test('only those fields are kept, with their types and lengths', async () => {
    await send('POST', '/api/live-session', { json: {
      trackName: HOSTILE[0], eventType: HOSTILE[1] + 'E'.repeat(60), raceType: { html: HOSTILE[2] },
      classes: [HOSTILE[0], 42, 'C'.repeat(60), ...Array.from({ length: 20 }, (_, i) => `Class ${i}`)],
      driversCount: HOSTILE[0], totalMinutes: '12', timeRemain: 'soon', extra: HOSTILE[0],
    } });
    const shown = (await send('GET', '/api/live-session')).json;
    assert.deepEqual(Object.keys(shown).sort(), ['classes', 'driversCount', 'eventType', 'raceType', 'timeRemain', 'totalMinutes', 'trackName']);
    assert.equal(shown.trackName, HOSTILE[0], 'text (the page shows it as text)');
    assert.equal(shown.eventType, (HOSTILE[1] + 'E'.repeat(60)).slice(0, 40));
    assert.equal(shown.raceType, null);
    assert.equal(shown.classes.length, 12);
    assert.deepEqual(shown.classes.slice(0, 3), [HOSTILE[0], '42', 'C'.repeat(40)]);
    assert.deepEqual([shown.driversCount, shown.totalMinutes, shown.timeRemain], [null, 12, null]);
    await send('POST', '/api/live-session', { json: { trackName: 'X', classes: 'GT3' } });
    assert.deepEqual((await send('GET', '/api/live-session')).json.classes, []);
  });
});

describe('POST /api/track-stats (telemetry.js collectAndUploadTrackStats)', () => {
  const stored = (track) => rows('SELECT car_class, race_type, avg_lap_time, avg_pit_time, avg_qualify_time, avg_sof, est_laps, avg_drivers, race_count, top_car, category FROM track_stats WHERE track_name = ? ORDER BY car_class', track);

  test('the app\'s statistics are stored as they were sent', async () => {
    const stats = {
      GT3: { avgLapTime: 98.512, avgPitTime: 31.4, avgQualifyTime: 97.9, avgSOF: 2210, estLaps: 24.35, samples: 18, topCar: 'Porsche 911 GT3 R (992)', category: 'road' },
      LMP2: { avgLapTime: 92.004, avgPitTime: 0, avgQualifyTime: 0, avgSOF: 1980, estLaps: 26.1, samples: 9, topCar: null, category: 'road' },
    };
    assert.deepEqual((await send('POST', '/api/track-stats', { json: { trackName: 'Stats T1', raceType: 'IMSA Sprint', stats } })).json, { ok: true });
    assert.deepEqual(stored('Stats T1'), [
      { car_class: 'GT3', race_type: 'IMSA Sprint', avg_lap_time: 98.512, avg_pit_time: 31.4, avg_qualify_time: 97.9, avg_sof: 2210, est_laps: 24.35, avg_drivers: 18, race_count: 1, top_car: 'Porsche 911 GT3 R (992)', category: 'road' },
      { car_class: 'LMP2', race_type: 'IMSA Sprint', avg_lap_time: 92.004, avg_pit_time: 0, avg_qualify_time: 0, avg_sof: 1980, est_laps: 26.1, avg_drivers: 9, race_count: 1, top_car: null, category: 'road' },
    ]);
  });

  test('numbers that are not numbers count as 0; text is cut to its length', async () => {
    const bad = HOSTILE[0];
    const stats = { [bad + 'K'.repeat(80)]: { avgLapTime: bad, avgPitTime: bad, avgQualifyTime: '97.5', avgSOF: {}, estLaps: [3], samples: bad, topCar: bad + 'T'.repeat(200), category: bad } };
    const res = await send('POST', '/api/track-stats', { json: { trackName: 'Stats T2', raceType: bad + 'R'.repeat(80), stats } });
    assert.equal(res.status, 200);
    assert.deepEqual(stored('Stats T2'), [{
      car_class: (bad + 'K'.repeat(80)).slice(0, 64), race_type: (bad + 'R'.repeat(80)).slice(0, 64),
      avg_lap_time: 0, avg_pit_time: 0, avg_qualify_time: 97.5, avg_sof: 0, est_laps: 0, avg_drivers: 0, race_count: 1,
      top_car: (bad + 'T'.repeat(200)).slice(0, 100), category: 'road',
    }]);
  });

  test('statistics that are not a list of classes are refused', async () => {
    for (const stats of ['GT3', [1, 2], 12]) {
      assert.equal((await send('POST', '/api/track-stats', { json: { trackName: 'Stats T3', raceType: 'Sprint', stats } })).status, 400, JSON.stringify(stats));
    }
    assert.equal((await send('POST', '/api/track-stats', { json: { trackName: { x: 1 }, raceType: 'Sprint', stats: {} } })).status, 400);
  });
});

describe('POST /api/bridge-logs and /api/bridge-bug-reports: the bridge id', () => {
  test('the app\'s log upload is stored with its iRacing name', async () => {
    const res = await send('POST', '/api/bridge-logs', { json: { bridgeId: BRIDGE_ID, lines: '[Telemetry] Connected\n', iracingName: 'Synthetic Driver' } });
    assert.deepEqual(res.json, { ok: true });
    assert.deepEqual(row('SELECT bridge_id, lines, iracing_name FROM bridge_logs WHERE bridge_id = ? ORDER BY id DESC LIMIT 1', BRIDGE_ID), { bridge_id: BRIDGE_ID, lines: '[Telemetry] Connected\n', iracing_name: 'Synthetic Driver' });
  });

  test('a bridge id the app could not have made is refused', async () => {
    for (const bridgeId of [...HOSTILE, 'short', 'a'.repeat(65), 'with space-12345', 12345678, ['3f1c2a9e-8b7d-4c6e-9f10-2a3b4c5d6e7f']]) {
      assert.equal((await send('POST', '/api/bridge-logs', { json: { bridgeId, lines: 'x\n' } })).status, 400, JSON.stringify(bridgeId));
      assert.equal((await send('POST', '/api/bridge-bug-reports', { json: { bridgeId, errorPattern: 'e', explanation: 'x', suggestedFix: 'y' } })).status, 400, JSON.stringify(bridgeId));
    }
    assert.equal(row('SELECT COUNT(*) AS n FROM bridge_logs WHERE bridge_id NOT IN (?)', BRIDGE_ID).n, 0);
    assert.equal(row('SELECT COUNT(*) AS n FROM bridge_bug_reports').n, 0);
  });

  test('the iRacing name is text cut to 100 characters', async () => {
    const id = 'aaaaaaaa-1111-4222-8333-444444444444';
    await send('POST', '/api/bridge-logs', { json: { bridgeId: id, lines: 'x\n', iracingName: HOSTILE[1] + 'N'.repeat(200) } });
    assert.equal(row('SELECT iracing_name FROM bridge_logs WHERE bridge_id = ?', id).iracing_name, (HOSTILE[1] + 'N'.repeat(200)).slice(0, 100));
    const other = 'bbbbbbbb-1111-4222-8333-444444444444';
    await send('POST', '/api/bridge-logs', { json: { bridgeId: other, lines: 'x\n', iracingName: { name: 'x' } } });
    assert.equal(row('SELECT iracing_name FROM bridge_logs WHERE bridge_id = ?', other).iracing_name, null);
  });

  test('a bug report with the app\'s bridge id is stored; one whose texts are not text is refused', async () => {
    const res = await send('POST', '/api/bridge-bug-reports', { json: { bridgeId: BRIDGE_ID, errorPattern: '[ERR] x', explanation: 'why', suggestedFix: 'fix' } });
    assert.equal(res.status, 200);
    assert.ok(Number.isInteger(res.json.id));
    assert.equal((await send('POST', '/api/bridge-bug-reports', { json: { bridgeId: BRIDGE_ID, errorPattern: { a: 1 }, explanation: 'why', suggestedFix: 'fix' } })).status, 400);
  });
});

// ── A disabled streamer and the Atleta Racing app ───────────────────────
// GET /api/bridge/account, GET /api/bridge/spotify and POST
// /api/bridge/spotify/control find the streamer through the racer's link (by
// session or by ?bridge_id=): a disabled one must answer as no linked streamer.

describe('a disabled streamer, through the Atleta Racing app\'s account and Spotify calls', () => {
  const { csrfToken } = require('./csrf');
  const BRIDGE_ENABLED = 'e0000000-0000-4000-8000-000000000001';
  const BRIDGE_DISABLED = 'd0000000-0000-4000-8000-000000000002';
  const BRIDGE_ALONE = 'a0000000-0000-4000-8000-000000000003';
  const ids = {};

  before(() => {
    const addStreamer = (n, enabled) => Number(db.db.prepare(`INSERT INTO streamers
      (discord_user_id, discord_username, twitch_username, twitch_display_name, spotify_access_token, spotify_refresh_token, spotify_token_expires_at, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(`90000000000000000${n}`, `streamer${n}`, `twitch_${n}`, `Twitch_${n}`, `synthetic-access-${n}`, `synthetic-refresh-${n}`, Date.now() + 3600_000, enabled).lastInsertRowid);
    const addRacer = (username, bridgeId, streamerId) => {
      const id = Number(db.createRacingUser(username, 'x', 'Synthetic Driver', bridgeId).lastInsertRowid);
      if (streamerId) db.linkRacingUserToStreamer(id, streamerId);
      return id;
    };
    ids.enabled = addStreamer(1, 1);
    ids.disabled = addStreamer(2, 0);
    ids.racerEnabled = addRacer('racer-enabled', BRIDGE_ENABLED, ids.enabled);
    ids.racerDisabled = addRacer('racer-disabled', BRIDGE_DISABLED, ids.disabled);
    ids.racerAlone = addRacer('racer-alone', BRIDGE_ALONE, null);
  });

  const linkedPart = (account) => [account.twitch_connected, account.twitch_username, account.spotify_connected];

  test('GET /api/bridge/account answers as for a racer with no linked streamer', async () => {
    const account = async (bridgeId) => (await send('GET', `/api/bridge/account?bridge_id=${bridgeId}`)).json;
    assert.deepEqual(linkedPart(await account(BRIDGE_ENABLED)), [true, 'Twitch_1', true]);
    const disabled = await account(BRIDGE_DISABLED);
    assert.deepEqual(linkedPart(disabled), linkedPart(await account(BRIDGE_ALONE)));
    assert.deepEqual(linkedPart(disabled), [false, null, false]);
    assert.equal(disabled.username, 'racer-disabled', 'the Racing account itself still answers');
  });

  test('GET /api/bridge/spotify answers "not connected", and Spotify is never asked', async () => {
    spotifyCalls.length = 0;
    assert.deepEqual((await send('GET', `/api/bridge/spotify?bridge_id=${BRIDGE_ENABLED}`)).json, { status: 'playing', track: 'Synthetic Song' });
    assert.deepEqual((await send('GET', `/api/bridge/spotify?bridge_id=${BRIDGE_DISABLED}`)).json, { status: 'not_connected' });
    assert.deepEqual((await send('GET', `/api/bridge/spotify?bridge_id=${BRIDGE_ALONE}`)).json, { status: 'not_connected' });
    assert.deepEqual(spotifyCalls, [['playing', ids.enabled]]);
  });

  test('POST /api/bridge/spotify/control answers { ok: false }, and nothing is sent to Spotify', async () => {
    const realFetch = globalThis.fetch;
    const outbound = [];
    globalThis.fetch = async (url, options = {}) => { outbound.push(`${options.method} ${url}`); return { ok: true, status: 204 }; };
    try {
      assert.deepEqual((await send('POST', '/api/bridge/spotify/control', { json: { bridge_id: BRIDGE_ENABLED, action: 'play' } })).json, { ok: true });
      assert.deepEqual((await send('POST', '/api/bridge/spotify/control', { json: { bridge_id: BRIDGE_DISABLED, action: 'play' } })).json, { ok: false });
      assert.deepEqual((await send('POST', '/api/bridge/spotify/control', { json: { bridge_id: BRIDGE_ALONE, action: 'next' } })).json, { ok: false });
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.deepEqual(outbound, ['PUT https://api.spotify.com/v1/me/player/play']);
  });

  test('the same through a website login: a Racing session, and a session linked to both accounts', async () => {
    const realFetch = globalThis.fetch;
    const outbound = [];
    globalThis.fetch = async (url, options = {}) => { outbound.push(`${options.method} ${url}`); return { ok: true, status: 204 }; };
    spotifyCalls.length = 0;
    try {
      const expires = Date.now() + 3600_000;
      db.createRacingSession('synthetic-racing-session', ids.racerDisabled, expires);
      db.createLinkedSession('synthetic-linked-session', ids.disabled, ids.racerDisabled, expires);
      for (const sid of ['synthetic-racing-session', 'synthetic-linked-session']) {
        const headers = { Cookie: `session=${sid}` };
        assert.deepEqual((await send('GET', '/api/bridge/spotify', { headers })).json, { status: 'not_connected' }, sid);
        const account = (await send('GET', '/api/bridge/account', { headers })).json;
        assert.equal(account.username, 'racer-disabled', sid);
        assert.deepEqual(linkedPart(account), [false, null, false], sid);
        const withToken = { ...headers, 'X-CSRF-Token': csrfToken(db.hashSessionId(sid), config.csrf.secret) };
        assert.deepEqual((await send('POST', '/api/bridge/spotify/control', { headers: withToken, json: { action: 'pause' } })).json, { ok: false }, sid);
      }
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.deepEqual(spotifyCalls, []);
    assert.deepEqual(outbound, []);
  });
});

// ── The page language ─────────────────────────────────────────────────────
// English, unless the visitor picked a language with the switcher (the lang
// cookie). The browser's own language is not used, so no answer varies by it.

describe('pages are in English unless the visitor picked a language', () => {
  const varies = (res) => (res.headers.vary || '').split(',').map((v) => v.trim().toLowerCase()).includes('accept-language');

  test('a browser set to another language still gets English', async () => {
    const res = await send('GET', '/', { headers: { 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5' } });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^text\/html/);
    assert.match(res.text, /<html lang="en">/);
    assert.ok(!varies(res), `Vary: ${res.headers.vary}`);
  });

  test('without Accept-Language too', async () => {
    const res = await send('GET', '/');
    assert.match(res.text, /<html lang="en">/);
    assert.ok(!varies(res));
  });

  test('the language the visitor picked (the lang cookie) is kept', async () => {
    const res = await send('GET', '/', { headers: { Cookie: 'lang=de', 'Accept-Language': 'pt' } });
    assert.match(res.text, /<html lang="de">/);
    assert.ok(!varies(res), `Vary: ${res.headers.vary}`);
  });

  test('the error page too', async () => {
    // A form post from another site: the CSRF check answers with the error page.
    const res = await send('POST', '/set-language', { headers: { 'Accept-Language': 'fr', Origin: 'https://elsewhere.example', 'Sec-Fetch-Mode': 'navigate' }, json: { lang: 'en' } });
    assert.equal(res.status, 403);
    assert.match(res.headers['content-type'], /^text\/html/);
    assert.ok(!varies(res));
  });

  test('no JSON answer or file says Vary: Accept-Language either', async () => {
    for (const urlPath of ['/api/track-maps', '/api/bridge/config', '/js/csrf.js']) {
      const res = await send('GET', urlPath, { headers: { 'Accept-Language': 'pt' } });
      assert.equal(res.status, 200, urlPath);
      assert.ok(!varies(res), `${urlPath}: Vary: ${res.headers.vary}`);
    }
  });
});

describe('recordings named by their content are kept a year', () => {
  const firstFile = (dir) => realFs.readdirSync(path.join(__dirname, '..', 'public', dir)).find((name) => name.endsWith('.mp3'));

  test('a look\'s recording (public/overlay/objects/sounds/)', async () => {
    const family = realFs.readdirSync(path.join(__dirname, '..', 'public', 'overlay', 'objects', 'sounds')).find((name) => !name.includes('.'));
    const res = await send('GET', `/overlay/objects/sounds/${family}/${firstFile(`overlay/objects/sounds/${family}`)}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable');
  });

  test('a voice preview (public/tts/previews/)', async () => {
    const res = await send('GET', `/tts/previews/${firstFile('tts/previews')}`);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^audio\/mpeg/);
    assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable');
  });
});

describe('coaching: the viewer\'s own Discord sign-in, on the real session step and CSRF check', () => {
  const { csrfToken } = require('./csrf');
  const SITE = { Origin: 'http://localhost:3000' };
  let login;
  let streamerId;
  const HOURS = Array.from({ length: 7 }, () => ({ on: true, start: 1080, end: 1320 }));

  before(() => {
    login = 'coach_on_server';
    streamerId = Number(db.db.prepare("INSERT INTO streamers (discord_user_id, discord_username, discord_display_name, twitch_username) VALUES ('300000000000009001', 'coachstreamer', 'Coach Streamer', ?)").run(login).lastInsertRowid);
    db.db.prepare("INSERT INTO guilds (guild_id, streamer_id, guild_name) VALUES ('123', ?, 'Coach HQ')").run(streamerId);
    db.saveCoachingSettings(streamerId, { timeZone: 'Europe/Lisbon', hours: HOURS, daysOff: [], guildId: '123', inviteCode: 'abc', whereText: '', notifyRequests: 0, lang: 'en' });
  });
  const viewerSession = (n) => {
    const sid = String(n).repeat(64).slice(0, 64);
    db.createViewerSession(sid, { discordUserId: `40000000000000900${n}`, username: `viewer${n}`, displayName: `Viewer ${n}` }, Date.now() + 3600e3);
    return sid;
  };
  const tokenOf = (sid) => csrfToken(db.hashSessionId(sid), config.csrf.secret);
  const bookings = () => db.db.prepare('SELECT COUNT(*) AS n FROM coaching_bookings WHERE streamer_id = ?').get(streamerId).n;

  test('booking needs the CSRF token of the viewer session', async () => {
    const sid = viewerSession(1);
    const cookie = `viewer_session=${sid}`;
    const state = await send('GET', `/coaching/${login}/state`, { headers: { Cookie: cookie } });
    assert.equal(state.status, 200, state.text);
    assert.equal(state.json.viewer.displayName, 'Viewer 1', 'the session step loaded the viewer');
    assert.equal(state.json.viewer.fromStreamer, false);
    const startsAt = state.json.slots[60][0];
    const page = await send('GET', `/coaching/${login}`, { headers: { Cookie: cookie } });
    assert.ok(page.text.includes(`data-csrf-token="${tokenOf(sid)}"`), 'the page carries the viewer session\'s token');

    const before = bookings();
    const noToken = await send('POST', `/coaching/${login}/book`, { headers: { Cookie: cookie, ...SITE }, json: { startsAt, minutes: 60 } });
    assert.equal(noToken.status, 403, noToken.text);
    const otherToken = await send('POST', `/coaching/${login}/book`, { headers: { Cookie: cookie, ...SITE, 'X-CSRF-Token': tokenOf(viewerSession(2)) }, json: { startsAt, minutes: 60 } });
    assert.equal(otherToken.status, 403, 'another session\'s token');
    const otherSite = await send('POST', `/coaching/${login}/book`, { headers: { Cookie: cookie, Origin: 'https://evil.example', 'X-CSRF-Token': tokenOf(sid) }, json: { startsAt, minutes: 60 } });
    assert.equal(otherSite.status, 403, 'from another site');
    assert.equal(bookings(), before, 'nothing was booked');

    const ok = await send('POST', `/coaching/${login}/book`, { headers: { Cookie: cookie, ...SITE, 'X-CSRF-Token': tokenOf(sid) }, json: { startsAt, minutes: 60 } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.ok, true);
    assert.equal(bookings(), before + 1);

    const signOut = await send('POST', '/auth/coaching-signout', { headers: { Cookie: cookie, ...SITE } });
    assert.equal(signOut.status, 403, 'signing out needs the token too');
  });

  test('the viewer session wins over a streamer\'s web session; a streamer alone books as their Discord account', async () => {
    const webSid = 'b'.repeat(64);
    db.createSession(webSid, streamerId, Date.now() + 3600e3);
    const viewerSid = viewerSession(3);
    const both = await send('GET', `/coaching/${login}/state`, { headers: { Cookie: `session=${webSid}; viewer_session=${viewerSid}` } });
    assert.equal(both.json.viewer.displayName, 'Viewer 3');
    assert.equal(both.json.viewer.fromStreamer, false);
    const asStreamer = await send('GET', `/coaching/${login}/state`, { headers: { Cookie: `session=${webSid}` } });
    assert.deepEqual(asStreamer.json.viewer, { displayName: 'Coach Streamer', username: 'coachstreamer', avatar: null, fromStreamer: true });
    // With both sessions the page's token is the web session's, as every other page of the site.
    const page = await send('GET', `/coaching/${login}`, { headers: { Cookie: `session=${webSid}; viewer_session=${viewerSid}` } });
    assert.ok(page.text.includes(`data-csrf-token="${tokenOf(webSid)}"`));
  });
});
