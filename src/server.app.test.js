'use strict';

// The real src/server.js app, answering over HTTP on 127.0.0.1, on the real
// src/db.js over an in-memory SQLite database (nothing touches data/). The
// config is a stub, and the routers server.js mounts from routes/ are empty
// ones, except routes/coaching.js (the viewer's sign-in and its CSRF token,
// with a fake src/discord.js).
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
const DISCORD_FILE = path.join(__dirname, 'discord.js');
// The coaching page's files, which get the fake Discord below.
const COACHING_FILES = ['routes/coaching.js', 'services/coachingBookings.js', 'services/coachingMessages.js'].map((f) => path.join(__dirname, f));
const REAL_ROUTES = new Set(['./routes/coaching']);
const discordStub = {
  isGuildMember: async () => true, guildName: () => 'Coach HQ', sendDirectMessage: async () => ({ ok: true }),
  fetchInvite: async () => ({ ok: false, reason: 'unavailable' }), escapeLinkText: (text) => String(text),
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

  test('a request that did not come through Cloudflare counts as its own address, whatever CF-Connecting-IP says', async () => {
    const api = (peer, cf) => send('GET', '/api/ping', { peer, cf });
    const direct = '203.0.113.50';
    assert.equal(remaining(await api(direct, '198.51.100.11')), 149);
    assert.equal(remaining(await api(direct, '198.51.100.99')), 148, 'a new CF-Connecting-IP value does not start a new counter');
    assert.equal(remaining(await api('203.0.113.51', '198.51.100.11')), 149, 'and no counter was kept for the addresses it named');
  });

  test('a Cloudflare edge without a valid CF-Connecting-IP counts as the edge', async () => {
    const edge = '104.16.0.9';
    const api = (cf) => send('GET', '/api/ping', { peer: edge, cf });
    assert.equal(remaining(await api('not-an-address')), 149);
    assert.equal(remaining(await api(undefined)), 148);
  });

  test('two visitors behind one edge have their own counters, and one visitor is the same through two data centres', async () => {
    const api = (peer, cf) => send('GET', '/api/ping', { peer, cf });
    assert.equal(remaining(await api(CF_LISBON, '198.51.100.1')), 149);
    assert.equal(remaining(await api(CF_LISBON, '198.51.100.2')), 149, 'visitor B behind the same edge');
    assert.equal(remaining(await api(CF_MADRID, '198.51.100.1')), 148, 'visitor A through another data centre');
    assert.equal(remaining(await api(CF_IPV6, '198.51.100.3')), 149, 'an IPv6 Cloudflare edge passes the visitor on too');
  });

  test('the /api limit (150 a minute) and the general limit (200 a minute) count the same way', async () => {
    const api = (cf, peer = CF_LISBON) => send('GET', '/api/ping', { peer, cf });
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

  test('IPv6 visitors are counted by their /56, the library\'s default', async () => {
    const api = (cf) => send('GET', '/api/ping', { peer: CF_LISBON, cf });
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

describe('the retired Racing API answers 410 Gone, and the old Racing pages redirect', () => {
  test('every route the Atleta Racing app called, before anything behind it runs', async () => {
    const retired = [
      ['GET', '/api/bridge-ids'], ['GET', '/api/bridge-users'], ['GET', '/api/bridge-logs/abc'],
      ['GET', '/api/bridge/account?bridge_id=3f1c2a9e-8b7d-4c6e-9f10-2a3b4c5d6e7f'], ['POST', '/api/bridge/whisper'],
      ['GET', '/api/sessions/Spa'], ['GET', '/api/session/1/telemetry/1'], ['POST', '/api/session'],
      ['DELETE', '/api/track-stats/Spa/GT3/Sprint'], ['GET', '/api/track-maps'], ['POST', '/api/live-session'],
      ['GET', '/api/voice/123456789012345678'],
    ];
    for (const [method, urlPath] of retired) {
      const res = await send(method, urlPath, { json: method === 'GET' ? undefined : {} });
      assert.equal(res.status, 410, `${method} ${urlPath}`);
      assert.deepEqual(res.json, { error: 'gone' });
    }
  });

  test('the old Racing pages lead to the home page', async () => {
    for (const urlPath of ['/racing', '/racing/', '/racing/teams', '/racing/account', '/tracks', '/tracks/Spa']) {
      const res = await send('GET', urlPath);
      assert.equal(res.status, 302, urlPath);
      assert.equal(res.headers.location, '/', urlPath);
    }
    assert.equal((await send('GET', '/pitwall/overlays/standings.html')).status, 404);
  });

  test('the streamer routes under /api are not touched', async () => {
    assert.notEqual((await send('GET', '/api/guild/1/channels')).status, 410);
    assert.notEqual((await send('POST', '/api/multistream/auth', { json: {} })).status, 410);
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
    for (const [urlPath, status] of [['/health', 200], ['/api/track-maps', 410], ['/js/csrf.js', 200]]) {
      const res = await send('GET', urlPath, { headers: { 'Accept-Language': 'pt' } });
      assert.equal(res.status, status, urlPath);
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
    streamerId = Number(db.db.prepare("INSERT INTO streamers (discord_user_id, discord_username, discord_display_name, twitch_username, paypal_email) VALUES ('300000000000009001', 'coachstreamer', 'Coach Streamer', ?, 'coach@example.com')").run(login).lastInsertRowid);
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

  test('the reschedule routes need the CSRF token and are limited to 30 in 10 minutes per visitor', async () => {
    const sid = viewerSession(3);
    const cookie = `viewer_session=${sid}`;
    const peer = '203.0.113.88';
    const call = (method, tail, headers) => send(method, `/coaching/${login}/bookings/999999/${tail}`, { peer, headers, ...(method === 'POST' ? { json: { startsAt: 1 } } : {}) });
    for (const tail of ['propose', 'accept-proposal']) {
      assert.equal((await call('POST', tail, { Cookie: cookie, ...SITE })).status, 403, `${tail}: no token`);
      assert.equal((await call('POST', tail, { Cookie: cookie, ...SITE, 'X-CSRF-Token': tokenOf(viewerSession(4)) })).status, 403, `${tail}: another session's token`);
    }
    const own = { Cookie: cookie, ...SITE, 'X-CSRF-Token': tokenOf(sid) };
    assert.equal((await call('POST', 'propose', own)).status, 404, 'a booking that is not theirs');
    assert.equal((await call('GET', 'starts', { Cookie: cookie })).status, 404);
    for (let i = 0; i < 30; i++) await call('GET', 'starts', { Cookie: cookie });
    assert.equal((await call('GET', 'starts', { Cookie: cookie })).status, 429);
    assert.equal((await call('POST', 'accept-proposal', own)).status, 429, 'one limit for the three routes');
  });

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

    const pay = (n, h) => send('POST', `/coaching/${login}/bookings/${n}/pay`, { peer: '203.0.113.77', headers: h });
    const payNoToken = await pay(ok.json.booking.id, { Cookie: cookie, ...SITE });
    assert.equal(payNoToken.status, 403, 'Pay needs the token too');
    const payOther = await pay(ok.json.booking.id, { Cookie: cookie, ...SITE, 'X-CSRF-Token': tokenOf(viewerSession(2)) });
    assert.equal(payOther.status, 403, 'another session\'s token');
    const own = { Cookie: cookie, ...SITE, 'X-CSRF-Token': tokenOf(sid) };
    const notMine = await pay(999999, own);
    assert.equal(notMine.status, 404, 'a booking that is not this viewer\'s answers not_found');
    const waiting = await pay(ok.json.booking.id, own);
    assert.equal(waiting.status, 409, 'a booking not awaiting payment is not payable');
    for (let i = 0; i < 20; i++) await pay(999999, own);
    assert.equal((await pay(999999, own)).status, 429, 'Pay is limited per visitor');

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

  test('a disabled streamer\'s web session gives no viewer: they cannot book as their Discord account', async () => {
    const disabledId = Number(db.db.prepare("INSERT INTO streamers (discord_user_id, discord_username, discord_display_name, enabled) VALUES ('300000000000009002', 'offstreamer', 'Off Streamer', 0)").run().lastInsertRowid);
    const webSid = 'c'.repeat(64);
    db.createSession(webSid, disabledId, Date.now() + 3600e3);
    const cookie = `session=${webSid}`;
    const state = await send('GET', `/coaching/${login}/state`, { headers: { Cookie: cookie } });
    assert.equal(state.status, 200, state.text);
    assert.equal(state.json.viewer, null, 'no fromStreamer viewer');
    const before = bookings();
    const book = await send('POST', `/coaching/${login}/book`, { headers: { Cookie: cookie, ...SITE, 'X-CSRF-Token': tokenOf(webSid) }, json: { startsAt: state.json.slots[60][0], minutes: 60 } });
    assert.equal(book.status, 401, book.text);
    assert.equal(book.json.code, 'signin');
    assert.equal(bookings(), before, 'nothing was booked');
  });
});
