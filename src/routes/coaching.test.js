'use strict';

// The public coaching booking page (src/routes/coaching.js), over HTTP: the real router and the real booking service on
// the real src/db.js over in-memory SQLite, with a fake src/discord.js (nothing reaches Discord). The step that loads
// the viewer here stands in for server.js's session middleware; src/server.app.test.js runs the real one, with the
// CSRF check, against this router. The real tip router is mounted too, to compare an unavailable page with an
// unknown tip page. All names, ids and times are synthetic.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const http = require('http');
const Module = require('module');
const express = require('express');
const RealDatabase = require('better-sqlite3');

for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) {
  process.env[key] = process.env[key] || 'test';
}
// The real escapeLinkText of src/discord.js, which the fake hands on (loading the module does not log in).
const { escapeLinkText } = require('../discord');
const { t, esc, richFor } = require('../i18n');
const coaching = require('../services/coaching');

const SRC = path.join(__dirname, '..');
const DB_FILE = path.join(SRC, 'db.js');
const ROUTE = path.join(__dirname, 'coaching.js');
const TIP = path.join(__dirname, 'tip.js');
const SERVICE = path.join(SRC, 'services', 'coachingBookings.js');
const MSG = path.join(SRC, 'services', 'coachingMessages.js');
const PAYMENTS = path.join(SRC, 'services', 'coachingPayments.js');
const PAYPAL = 'https://paypal.test';
const PAGE_SCRIPT = path.join(SRC, '..', 'public', 'js', 'coaching-page.js');

const discord = {
  member: true, memberCalls: 0, guild: 'Coach HQ',
  async isGuildMember() { this.memberCalls++; return this.member; },
  guildName() { return this.guild; },
  async sendDirectMessage() { return { ok: true }; },
  async fetchInvite() { return { ok: false, reason: 'unavailable' }; },
  escapeLinkText,
};

let db;
let bookings; // services/coachingBookings.js as the router loaded it
let server;
let port;
const restore = {};

before(async () => {
  restore.load = Module._load;
  Module._load = function (request, parent, isMain) {
    const from = parent && parent.filename;
    if (from === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...fs, existsSync: () => true, mkdirSync: () => {} };
      if (request === './config') return { adminDiscordIds: [] };
    }
    if ([ROUTE, SERVICE, MSG, PAYMENTS].includes(from)) {
      if (request === '../discord') return discord;
      if (request === '../config') return { app: { url: 'https://atleta.test' }, paypal: { clientId: 'c', clientSecret: 's', baseUrl: PAYPAL } };
    }
    if (from === TIP && request === '../config') return { app: { url: 'https://atleta.test' }, paypal: {} };
    return restore.load.apply(this, arguments);
  };
  restore.log = console.log;
  restore.error = console.error;
  console.log = () => {};
  console.error = () => {};
  let router;
  let tipRouter;
  try {
    for (const file of [DB_FILE, ROUTE, TIP, SERVICE, MSG, PAYMENTS]) delete require.cache[file];
    db = require(DB_FILE);
    router = require(ROUTE);
    bookings = require(SERVICE);
    tipRouter = require(TIP);
  } finally {
    Module._load = restore.load;
  }

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(SRC, 'views'));
  app.use(require('cookie-parser')());
  app.use(express.json());
  app.use((req, res, next) => {
    // As server.js's session step: the viewer's own sign-in wins; else a streamer signed in to the site (x-test-streamer).
    const session = req.cookies && req.cookies.viewer_session ? db.getViewerSession(req.cookies.viewer_session) : null;
    const streamer = Number(req.get('x-test-streamer')) ? db.getStreamerById(Number(req.get('x-test-streamer'))) : null;
    if (session) {
      req.viewer = {
        discordUserId: session.discord_user_id, username: session.discord_username,
        displayName: session.discord_display_name || session.discord_username, avatar: session.discord_avatar, fromStreamer: false,
      };
    } else if (streamer) {
      req.viewer = {
        discordUserId: streamer.discord_user_id, username: streamer.discord_username,
        displayName: streamer.discord_display_name || streamer.discord_username, avatar: streamer.discord_avatar, fromStreamer: true,
      };
    }
    const lang = req.get('x-lang') || 'en';
    res.locals.lang = lang;
    res.locals.t = (key, params) => t(lang, key, params);
    res.locals.esc = esc;
    res.locals.rich = richFor(res.locals.t);
    res.locals.csrfToken = 'synthetic-token';
    next();
  });
  app.use('/coaching', router);
  app.use('/tip', tipRouter);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = server.address().port;
});

after(async () => {
  console.log = restore.log;
  console.error = restore.error;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  discord.member = true;
  discord.memberCalls = 0;
  discord.guild = 'Coach HQ';
  bookings.forgetMembers(); // no membership answer kept from another test
});

// ── HTTP ─────────────────────────────────────────────────────────────────

function send(method, urlPath, { cookie, json, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const body = json === undefined ? null : Buffer.from(JSON.stringify(json));
    const sent = { ...headers };
    if (cookie) sent.Cookie = cookie;
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
const get = (urlPath, opts) => send('GET', urlPath, opts);
const post = (urlPath, opts) => send('POST', urlPath, opts);

// ── Data ─────────────────────────────────────────────────────────────────

const HOURS = Array.from({ length: 7 }, () => ({ on: true, start: 1080, end: 1320 })); // every day 18:00-22:00
const HALF_HOUR = 30 * 60e3;
let counter = 0;

// Every length on: 30 min and 1 h free, the longer ones at the default prices (the payment tests switch 1 h to paid).
const LENGTHS = { ...coaching.DEFAULT_LENGTHS, 30: { on: true, price: 0 }, 60: { on: true, price: 0 } };
function addStreamer({ name, settings = {}, guild = true, paypal = 'coach@example.com' } = {}) {
  const n = ++counter;
  const login = `coach_${n}`;
  const discordName = `Streamer ${n}`;
  const id = Number(db.db.prepare('INSERT INTO streamers (discord_user_id, discord_username, discord_display_name, twitch_username, twitch_display_name, paypal_email, donation_currency) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(`30000000000000${String(n).padStart(4, '0')}`, `streamer${n}`, discordName, login, name || `Coach_${n}`, paypal, 'EUR').lastInsertRowid);
  if (guild) db.db.prepare('INSERT INTO guilds (guild_id, streamer_id, guild_name) VALUES (?, ?, ?)').run('123', id, 'Coach HQ');
  if (settings) {
    db.saveCoachingSettings(id, {
      timeZone: 'Europe/Lisbon', hours: HOURS, daysOff: [], guildId: '123', inviteCode: 'abc', whereText: '', notifyRequests: 0, lang: 'en', lengths: LENGTHS, ...settings,
    });
  }
  return { id, login, name: name || `Coach_${n}`, discordName };
}

let viewers = 0;
// A viewer signed in for coaching: their viewer_sessions row and the cookie that names it.
function addViewer(over = {}) {
  const n = ++viewers;
  const viewer = { discordUserId: `40000000000000${String(n).padStart(4, '0')}`, username: `viewer${n}`, displayName: `Viewer ${n}`, avatar: null, ...over };
  const sid = String(n).padStart(64, 'a');
  db.createViewerSession(sid, viewer, Date.now() + 3600e3);
  return { ...viewer, cookie: `viewer_session=${sid}` };
}

// What the page should offer now, by the rules of services/coaching.js.
function freeNow(streamer, minutes) {
  const now = Date.now();
  const settings = db.getCoachingSettings(streamer.id);
  return coaching.freeStarts({
    hours: settings.hours, timeZone: settings.time_zone, daysOff: settings.days_off,
    held: db.getHeldCoachingBookings(streamer.id, now), now, minutes,
  });
}
function hold(streamer, viewer, startsAt, minutes = 60, note = '') {
  const made = db.createCoachingBooking({ streamerId: streamer.id, viewer, startsAt, minutes, note, lang: 'en', now: Date.now() });
  assert.ok(made.ok, made.code);
  return made.booking;
}
const errorOf = (key, params) => t('en', key, params);
const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── The page ─────────────────────────────────────────────────────────────

describe('the booking page', () => {
  test('an unknown or disabled streamer and one without coaching answer like an unknown tip page', async () => {
    const tipPage = await get('/tip/nobody_at_all');
    assert.equal(tipPage.status, 404);
    const disabled = addStreamer();
    db.db.prepare('UPDATE streamers SET enabled = 0 WHERE id = ?').run(disabled.id);
    const neverSetUp = addStreamer({ settings: null });
    for (const login of ['nobody_at_all', disabled.login, neverSetUp.login]) {
      const res = await get(`/coaching/${login}`);
      assert.equal(res.status, tipPage.status, login);
      assert.equal(res.headers['content-type'], tipPage.headers['content-type'], login);
      assert.equal(res.text, t('en', 'coaching.error.pageUnavailable'), login);
      assert.notEqual(res.text, 'coaching.error.pageUnavailable', 'a sentence, not its key');
      const state = await get(`/coaching/${login}/state`);
      assert.equal(state.status, 404);
      assert.deepEqual(state.json, { ok: false, code: 'unavailable', error: t('en', 'coaching.error.pageUnavailable') });
    }
  });

  test('the page prints a display name and a note holding <script> as text (Review Focus 5)', async () => {
    const HOSTILE = '</script><script>alert(1)</script>';
    const s = addStreamer({ name: `Coach ${HOSTILE}` });
    const v = addViewer({ displayName: `Viewer ${HOSTILE}` });
    hold(s, v, freeNow(s, 60)[0], 60, `Note ${HOSTILE}`);
    const res = await get(`/coaching/${s.login}`, { cookie: v.cookie });
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes('<script>alert(1)'), 'a name or the note was printed as markup');
    assert.ok(res.text.includes(esc(`Coach ${HOSTILE}`)), "the streamer's name, as text");
    assert.ok(res.text.includes(`<b>${esc(`Viewer ${HOSTILE}`)}</b>`), '"Booking as" names the viewer, as text');
    // The note travels in the page's data, "<" written \u003c, and the script puts it in with textContent.
    assert.ok(res.text.includes('Note \\u003c/script>\\u003cscript>alert(1)\\u003c/script>'));
    assert.equal((res.text.match(/<script\b/g) || []).length, 4, "only the page's own scripts: csrf, data, core, page");
    const script = fs.readFileSync(PAGE_SCRIPT, 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(script), 'the page script builds with textContent only');
  });

  test('a visitor gets the sign-in button, which signs in as a viewer, never as a streamer', async () => {
    const s = addStreamer();
    const res = await get(`/coaching/${s.login}`);
    assert.equal(res.status, 200);
    assert.ok(res.text.includes(`href="/auth/coaching-signin?for=${s.login}"`));
    assert.ok(res.text.includes(esc(t('en', 'coaching.page.signIn'))));
    assert.ok(!res.text.includes('/auth/login'), 'no link that signs in as a streamer');
    assert.ok(res.text.includes('<script src="/js/csrf.js" data-csrf-token="synthetic-token"></script>'), 'the CSRF token script');
  });

  test('"not you?": a viewer signs out with a form; a streamer signed in to the site signs in as a viewer instead', async () => {
    const s = addStreamer();
    const asViewer = await get(`/coaching/${s.login}`, { cookie: addViewer().cookie });
    assert.match(asViewer.text, new RegExp(`<form method="POST" action="/auth/coaching-signout"[^>]*>\\s*<input type="hidden" name="for" value="${s.login}">`));
    const other = addStreamer();
    const asStreamer = await get(`/coaching/${s.login}`, { headers: { 'x-test-streamer': String(other.id) } });
    assert.ok(asStreamer.text.includes(`<b>${esc(other.discordName)}</b>`), 'books as their Discord account');
    assert.ok(asStreamer.text.includes(`href="/auth/coaching-signin?for=${s.login}"`));
    assert.ok(!asStreamer.text.includes('action="/auth/coaching-signout"'));
  });

  test("a paused streamer's page answers 200 and says not taking bookings", async () => {
    const s = addStreamer();
    const v = addViewer();
    hold(s, v, freeNow(s, 30)[0], 30);
    db.setCoachingOpen(s.id, 0);
    const page = await get(`/coaching/${s.login}`, { cookie: v.cookie });
    assert.equal(page.status, 200);
    const paused = esc(t('en', 'coaching.page.paused', { name: s.name }));
    assert.match(page.text, new RegExp(`<p class="cz-paused" id="cz-paused">${literal(paused)}</p>`), 'shown, not hidden');

    const state = await get(`/coaching/${s.login}/state`, { cookie: v.cookie });
    assert.equal(state.json.open, false);
    assert.equal(state.json.bookable, false);
    assert.deepEqual(state.json.slots, Object.fromEntries(coaching.LENGTHS.map((m) => [m, []])));
    assert.equal(state.json.bookings.length, 1, 'the viewer still sees their booking');
    assert.equal(discord.memberCalls, 0, 'Discord is not asked while nothing can be booked');

    const book = await post(`/coaching/${s.login}/book`, { cookie: v.cookie, json: { startsAt: Date.now() + 86400e3, minutes: 60 } });
    assert.equal(book.status, 409);
    assert.deepEqual(book.json, { ok: false, code: 'not_open', error: errorOf('coaching.error.not_open') });
  });

  test('the page script reads only texts the page hands it', async () => {
    const s = addStreamer();
    const res = await get(`/coaching/${s.login}`, { cookie: addViewer().cookie });
    const texts = JSON.parse(res.text.match(/window\.COACHING_TEXTS = (\{.*?\});<\/script>/)[1]);
    const script = fs.readFileSync(PAGE_SCRIPT, 'utf8');
    const read = [...new Set([...script.matchAll(/\bT\.(\w+)/g)].map((m) => m[1]))];
    assert.ok(read.length > 10);
    assert.deepEqual(read.filter((name) => !(name in texts)), [], 'the script reads texts the page does not hand over');
    assert.deepEqual(Object.keys(texts).filter((name) => !read.includes(name)), [], 'texts handed over but never read');
    // rescheduling and not_rescheduled get their page texts with the viewer's reschedule panel (a later task).
    for (const state of coaching.STATES.filter((st) => !['rescheduling', 'not_rescheduled'].includes(st)).concat('unanswered')) assert.equal(typeof texts.states[state], 'string', state);
  });
});

// ── GET /state ───────────────────────────────────────────────────────────

describe('the state', () => {
  test("state lists free starts for both lengths and only the viewer's own bookings", async () => {
    const s = addStreamer();
    const mine = addViewer();
    const theirs = addViewer();
    const hour = freeNow(s, 60);
    hold(s, mine, hour[0], 60, 'mine');
    hold(s, theirs, hour[4], 30, 'theirs');

    const expected = { 30: freeNow(s, 30), 60: freeNow(s, 60) };
    const res = await get(`/coaching/${s.login}/state`, { cookie: mine.cookie });
    const later = { 30: freeNow(s, 30), 60: freeNow(s, 60) };
    assert.equal(res.status, 200);
    const state = res.json;
    for (const minutes of [30, 60]) {
      // The answer is the rules' free starts as of the request (computed just before and just after it).
      assert.ok([JSON.stringify(expected[minutes]), JSON.stringify(later[minutes])].includes(JSON.stringify(state.slots[minutes])), `${minutes}`);
      assert.ok(state.slots[minutes].length > 0);
      for (const held of [hour[0], hour[0] + HALF_HOUR, hour[4]]) assert.ok(!state.slots[minutes].includes(held), `${minutes}: a held time is not offered`);
    }
    assert.ok(state.slots[30].length > state.slots[60].length, 'more half-hour starts than hour starts');
    assert.equal(state.open, true);
    assert.equal(state.bookable, true);
    assert.equal(state.member, true);
    assert.equal(state.maxUpcoming, coaching.MAX_UPCOMING);
    assert.equal(state.leadMs, coaching.LEAD_MS, 'the page keeps the hour of notice when it filters the starts');
    assert.equal(state.inviteUrl, 'https://discord.gg/abc');
    assert.equal(state.guildName, 'Coach HQ');
    assert.deepEqual(state.viewer, { displayName: mine.displayName, username: mine.username, avatar: null, fromStreamer: false });
    assert.deepEqual(state.bookings.map((b) => [b.startsAt, b.minutes, b.state, b.note]), [[hour[0], 60, 'waiting', 'mine']]);

    const visitor = await get(`/coaching/${s.login}/state`);
    assert.equal(visitor.json.viewer, null);
    assert.ok(!('member' in visitor.json), 'no membership without a viewer');
    assert.deepEqual(visitor.json.bookings, []);
  });

  test('the server name comes from the claim while the bot cannot see it, and Discord not answering gives member null', async () => {
    const s = addStreamer();
    const v = addViewer();
    discord.guild = null;
    discord.member = null;
    const res = await get(`/coaching/${s.login}/state`, { cookie: v.cookie });
    assert.equal(res.json.guildName, 'Coach HQ');
    assert.equal(res.json.member, null);
    assert.equal(res.json.bookable, true, 'an outage does not stop bookings');
  });

  test('a non-member\'s page asks Discord once per 30 s; "I\'ve joined" (?recheck=1) asks at once, at most every 10 s (Ruling 8)', async () => {
    const s = addStreamer();
    const v = addViewer();
    discord.member = false;
    assert.equal((await get(`/coaching/${s.login}/state`, { cookie: v.cookie })).json.member, false);
    assert.equal((await get(`/coaching/${s.login}/state`, { cookie: v.cookie })).json.member, false);
    assert.equal(discord.memberCalls, 1, 'the second read used the kept answer');
    discord.member = true;
    const joined = await get(`/coaching/${s.login}/state?recheck=1`, { cookie: v.cookie });
    assert.equal(joined.json.member, true);
    assert.equal(discord.memberCalls, 2);
    await get(`/coaching/${s.login}/state?recheck=1`, { cookie: v.cookie });
    assert.equal(discord.memberCalls, 2, 'a second "I\'ve joined" within 10 s reads the kept answer');
    const booked = await post(`/coaching/${s.login}/book`, { cookie: v.cookie, json: { startsAt: freeNow(s, 60)[0], minutes: 60 } });
    assert.equal(booked.status, 200, booked.text);
    assert.equal(discord.memberCalls, 2, 'the request read the answer "I\'ve joined" got');
    const script = fs.readFileSync(PAGE_SCRIPT, 'utf8');
    assert.match(script, /'\?recheck=1'/);
    assert.match(script, /\$\('cz-joined'\)\.addEventListener\('click', function \(\) \{\s*message\(''\);\s*refresh\(true\)/, '"I\'ve joined" asks with ?recheck=1');
  });
});

// ── Booking and cancelling ───────────────────────────────────────────────

describe('booking', () => {
  test('booking without a viewer answers signin; with one not in the server, join_first', async () => {
    const s = addStreamer();
    const startsAt = freeNow(s, 60)[0];
    const anonymous = await post(`/coaching/${s.login}/book`, { json: { startsAt, minutes: 60 } });
    assert.equal(anonymous.status, 401);
    assert.deepEqual(anonymous.json, { ok: false, code: 'signin', error: errorOf('coaching.error.signin') });

    const v = addViewer();
    discord.member = false;
    const outside = await post(`/coaching/${s.login}/book`, { cookie: v.cookie, json: { startsAt, minutes: 60 } });
    assert.equal(outside.status, 409);
    assert.deepEqual(outside.json, { ok: false, code: 'join_first', error: errorOf('coaching.error.join_first') });
    assert.equal(db.getViewerCoachingBookings(s.id, v.discordUserId, 0).length, 0);

    discord.member = true;
    await get(`/coaching/${s.login}/state?recheck=1`, { cookie: v.cookie }); // "I've joined"
    const booked = await post(`/coaching/${s.login}/book`, { cookie: v.cookie, headers: { 'x-lang': 'pt' }, json: { startsAt, minutes: 60, note: 'braking into T1' } });
    assert.equal(booked.status, 200, booked.text);
    assert.equal(booked.json.ok, true);
    assert.equal(booked.json.unverified, false);
    const b = booked.json.booking;
    assert.deepEqual([b.startsAt, b.minutes, b.state, b.note], [startsAt, 60, 'waiting', 'braking into T1']);
    const row = db.getViewerCoachingBookings(s.id, v.discordUserId, 0)[0];
    assert.equal(row.lang, 'pt', "the page's language is stored with the booking");
    assert.equal(row.viewer_display_name, v.displayName);
  });

  test('a time already held and one just taken read the same; other refusals have their own text', async () => {
    const s = addStreamer();
    const startsAt = freeNow(s, 60)[0];
    assert.equal((await post(`/coaching/${s.login}/book`, { cookie: addViewer().cookie, json: { startsAt, minutes: 60 } })).status, 200);
    const again = await post(`/coaching/${s.login}/book`, { cookie: addViewer().cookie, json: { startsAt: startsAt + HALF_HOUR, minutes: 30 } });
    assert.equal(again.status, 409);
    assert.equal(again.json.code, 'bad_time');
    assert.equal(again.json.error, errorOf('coaching.error.taken'));

    const v = addViewer();
    const later = freeNow(s, 60);
    for (const [body, code, status] of [
      [{ startsAt: later[1], minutes: 45 }, 'bad_length', 400],
      [{ startsAt: later[1], minutes: '60' }, 'bad_length', 400],
      [{ startsAt: later[1], minutes: 60, note: 'x'.repeat(301) }, 'bad_note', 400],
      [{ startsAt: String(later[1]), minutes: 60 }, 'bad_time', 409],
    ]) {
      const res = await post(`/coaching/${s.login}/book`, { cookie: v.cookie, json: body });
      assert.equal(res.status, status, code);
      assert.equal(res.json.code, code);
      assert.equal(typeof res.json.error, 'string');
      assert.ok(!res.json.error.startsWith('coaching.'), `${code}: a sentence, not its key`);
    }
    // The limit: two upcoming bookings, then a third is refused.
    assert.equal((await post(`/coaching/${s.login}/book`, { cookie: v.cookie, json: { startsAt: later[1], minutes: 60 } })).status, 200);
    assert.equal((await post(`/coaching/${s.login}/book`, { cookie: v.cookie, json: { startsAt: later[3], minutes: 60 } })).status, 200);
    const third = await post(`/coaching/${s.login}/book`, { cookie: v.cookie, json: { startsAt: later[5], minutes: 60 } });
    assert.equal(third.json.code, 'limit');
    assert.equal(third.json.error, errorOf('coaching.error.limit', { max: coaching.MAX_UPCOMING }));
  });

  test("cancel of another viewer's booking answers not_found", async () => {
    const s = addStreamer();
    const owner = addViewer();
    const booked = await post(`/coaching/${s.login}/book`, { cookie: owner.cookie, json: { startsAt: freeNow(s, 60)[0], minutes: 60 } });
    const id = booked.json.booking.id;

    const stranger = await post(`/coaching/${s.login}/bookings/${id}/cancel`, { cookie: addViewer().cookie });
    assert.equal(stranger.status, 404);
    assert.deepEqual(stranger.json, { ok: false, code: 'not_found', error: errorOf('coaching.error.not_found') });
    assert.equal((await post(`/coaching/${s.login}/bookings/${id}/cancel`)).json.code, 'signin');
    assert.equal((await post(`/coaching/${s.login}/bookings/abc/cancel`, { cookie: owner.cookie })).json.code, 'not_found');
    const elsewhere = addStreamer();
    assert.equal((await post(`/coaching/${elsewhere.login}/bookings/${id}/cancel`, { cookie: owner.cookie })).json.code, 'not_found', "through another streamer's page");

    const mine = await post(`/coaching/${s.login}/bookings/${id}/cancel`, { cookie: owner.cookie });
    assert.equal(mine.status, 200);
    assert.equal(mine.json.booking.state, 'withdrawn');
    const twice = await post(`/coaching/${s.login}/bookings/${id}/cancel`, { cookie: owner.cookie });
    assert.equal(twice.status, 409);
    assert.deepEqual(twice.json, { ok: false, code: 'not_active', error: errorOf('coaching.error.not_active') });
  });

  test('cancelling a booking the streamer declined answers not_active, in the page\'s language', async () => {
    const s = addStreamer();
    const v = addViewer();
    const row = hold(s, v, freeNow(s, 60)[0]);
    db.setCoachingBookingStatus(row.id, s.id, ['waiting'], 'declined', Date.now());
    const res = await post(`/coaching/${s.login}/bookings/${row.id}/cancel`, { cookie: v.cookie, headers: { 'x-lang': 'de' } });
    assert.equal(res.status, 409);
    assert.deepEqual(res.json, { ok: false, code: 'not_active', error: t('de', 'coaching.error.not_active') });
    assert.notEqual(res.json.error, 'coaching.error.not_active', 'a sentence, not its key');
  });

  test('a seventh request within 24 h answers too_many with its text (Ruling 7)', async () => {
    const s = addStreamer();
    const v = addViewer();
    const startsAt = freeNow(s, 60)[0];
    for (let i = 0; i < coaching.MAX_REQUESTS_PER_DAY; i++) {
      const booked = await post(`/coaching/${s.login}/book`, { cookie: v.cookie, json: { startsAt, minutes: 60 } });
      assert.equal(booked.status, 200, `request ${i + 1}: ${booked.text}`);
      assert.equal((await post(`/coaching/${s.login}/bookings/${booked.json.booking.id}/cancel`, { cookie: v.cookie })).status, 200);
    }
    const seventh = await post(`/coaching/${s.login}/book`, { cookie: v.cookie, json: { startsAt, minutes: 60 } });
    assert.equal(seventh.status, 429);
    assert.deepEqual(seventh.json, { ok: false, code: 'too_many', error: errorOf('coaching.error.too_many') });
    assert.notEqual(seventh.json.error, 'coaching.error.too_many', 'a sentence, not its key');
  });

  test('a streamer signed in to the site books as their own Discord account', async () => {
    const s = addStreamer();
    const other = addStreamer();
    const res = await post(`/coaching/${s.login}/book`, { headers: { 'x-test-streamer': String(other.id) }, json: { startsAt: freeNow(s, 60)[0], minutes: 60 } });
    assert.equal(res.status, 200, res.text);
    const row = db.getCoachingBooking(res.json.booking.id, s.id);
    assert.equal(row.viewer_discord_id, db.getStreamerById(other.id).discord_user_id);
  });
});

// ── Pay and the return from PayPal ──────────────────────────────────────

describe('payment', () => {
  // A fake PayPal: an order is made as asked, and its capture completes as asked.
  const orders = new Map();
  let calls = [];
  let nextOrder = 1;
  let realFetch;
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const completed = (o) => ({
    id: o.id, status: 'COMPLETED',
    purchase_units: [{ custom_id: o.customId, payee: { email_address: o.payee, merchant_id: 'MERCHANTROUTE' },
      payments: { captures: [{ id: `CAP-${o.id}`, status: 'COMPLETED', amount: { currency_code: o.currency, value: o.value } }] } }],
  });
  before(() => {
    realFetch = global.fetch;
    global.fetch = async (url, opts = {}) => {
      url = String(url);
      calls.push(url);
      if (url === `${PAYPAL}/v1/oauth2/token`) return reply(200, { access_token: 't' });
      if (url === `${PAYPAL}/v2/checkout/orders`) {
        const unit = JSON.parse(opts.body).purchase_units[0];
        const id = `ROUTEORDER${String(nextOrder++).padStart(6, '0')}`;
        orders.set(id, { id, customId: unit.custom_id, payee: unit.payee.email_address, currency: unit.amount.currency_code, value: unit.amount.value });
        return reply(201, { id, status: 'CREATED', purchase_units: [{ payee: { email_address: unit.payee.email_address, merchant_id: 'MERCHANTROUTE' } }],
          links: [{ rel: 'approve', href: `https://www.paypal.com/checkoutnow?token=${id}` }] });
      }
      const m = url.match(/\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/);
      const o = m && orders.get(m[1]);
      if (!o) return reply(404, { name: 'RESOURCE_NOT_FOUND' });
      return reply(m[2] ? 201 : 200, completed(o));
    };
  });
  after(() => { global.fetch = realFetch; });
  beforeEach(() => { calls = []; });

  // A 1 h booking at EUR 25.00 the streamer accepted.
  async function accepted(paypal = 'coach@example.com') {
    const s = addStreamer({ paypal, settings: { lengths: { ...LENGTHS, 60: { on: true, price: 2500 } } } });
    const v = addViewer();
    const startsAt = freeNow(s, 60)[0];
    const booked = await post(`/coaching/${s.login}/book`, { cookie: v.cookie, json: { startsAt, minutes: 60 } });
    assert.equal(booked.status, 200, booked.text);
    const streamer = db.getStreamerById(s.id);
    const a = await bookings.accept(streamer, booked.json.booking.id);
    assert.equal(a.ok, true, a.code);
    return { s, v, id: booked.json.booking.id };
  }

  test('state names the lengths with their prices and the currency, and each booking its price, deadline and payment', async () => {
    const { s, v, id } = await accepted();
    const state = (await get(`/coaching/${s.login}/state`, { cookie: v.cookie })).json;
    assert.equal(state.currency, 'EUR');
    assert.deepEqual(state.lengths.map((l) => [l.minutes, l.priceCents]), [[30, 0], [60, 2500], [120, 4500], [180, 6000], [240, 7000], [300, 8000]]);
    assert.deepEqual(Object.keys(state.slots).map(Number), [30, 60, 120, 180, 240, 300]);
    const b = state.bookings.find((x) => x.id === id);
    assert.deepEqual([b.state, b.priceCents, b.currency, b.paid, b.roomUrl], ['awaiting_payment', 2500, 'EUR', false, null]);
    assert.equal(typeof b.payBy, 'number');

    const noPaypal = addStreamer({ paypal: null });
    const other = (await get(`/coaching/${noPaypal.login}/state`)).json;
    assert.deepEqual(other.lengths.map((l) => l.minutes), [30, 60], 'without PayPal only the free lengths');
  });

  test('Pay answers the PayPal approve link for the booking\'s own viewer only', async () => {
    const { s, v, id } = await accepted();
    assert.equal((await post(`/coaching/${s.login}/bookings/${id}/pay`)).json.code, 'signin');
    const stranger = await post(`/coaching/${s.login}/bookings/${id}/pay`, { cookie: addViewer().cookie });
    assert.deepEqual([stranger.status, stranger.json.code], [404, 'not_found']);
    assert.equal(calls.length, 0, 'PayPal not asked for a stranger');
    const mine = await post(`/coaching/${s.login}/bookings/${id}/pay`, { cookie: v.cookie });
    assert.equal(mine.status, 200, mine.text);
    assert.equal(mine.json.ok, true);
    assert.match(mine.json.approveUrl, /^https:\/\/www\.paypal\.com\/checkoutnow\?token=ROUTEORDER\d+$/);
  });

  test('the return confirms the booking and sends the viewer back with paid=1; a replay too, recorded once', async () => {
    const { s, v, id } = await accepted();
    const approveUrl = (await post(`/coaching/${s.login}/bookings/${id}/pay`, { cookie: v.cookie })).json.approveUrl;
    const token = new URL(approveUrl).searchParams.get('token');
    const back = await get(`/coaching/${s.login}/paid?token=${token}`);
    assert.equal(back.status, 302);
    assert.equal(back.headers.location, `/coaching/${s.login}?paid=1`);
    const row = db.getCoachingBooking(id, s.id);
    assert.deepEqual([row.status, row.paid_amount_cents, row.paypal_order_id], ['confirmed', 2500, token]);
    const again = await get(`/coaching/${s.login}/paid?token=${token}`);
    assert.equal(again.headers.location, `/coaching/${s.login}?paid=1`);
    assert.equal(calls.filter((u) => u.endsWith('/capture')).length, 1);
    // Paid: no Withdraw any more.
    const withdraw = await post(`/coaching/${s.login}/bookings/${id}/cancel`, { cookie: v.cookie });
    assert.deepEqual([withdraw.status, withdraw.json.code, withdraw.json.error], [409, 'paid', errorOf('coaching.error.paid')]);
    assert.equal(db.getCoachingBooking(id, s.id).status, 'confirmed');
  });

  test("a return with another streamer's order, an unknown one or none goes back with error=pay_invalid", async () => {
    const { s, v, id } = await accepted();
    const token = new URL((await post(`/coaching/${s.login}/bookings/${id}/pay`, { cookie: v.cookie })).json.approveUrl).searchParams.get('token');
    const elsewhere = addStreamer();
    calls = [];
    for (const [login, query] of [[elsewhere.login, `token=${token}`], [s.login, 'token=NOSUCHORDER01'], [s.login, '']]) {
      const res = await get(`/coaching/${login}/paid?${query}`);
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, `/coaching/${login}?error=pay_invalid`);
    }
    assert.equal(calls.length, 0, 'nothing captured');
    assert.equal(db.getCoachingBooking(id, s.id).status, 'awaiting_payment');
    assert.equal((await get('/coaching/nobody_here/paid?token=ABCDEFGHIJ')).status, 404);
  });

  test('every code the return sends back has its text', () => {
    const { RETURN_ERROR_KEYS } = require(ROUTE);
    for (const code of ['pay_invalid', 'pay_unconfirmed', 'not_paid', 'late', 'paid', 'pay_closed']) {
      const key = RETURN_ERROR_KEYS[code];
      assert.ok(key, code);
      assert.notEqual(t('en', key), key, `${code} has an English text`);
    }
  });
});

describe('the bad_length text', () => {
  test('fits six lengths in every language: it names no fixed length', () => {
    assert.equal(t('en', 'coaching.error.bad_length'), 'Pick one of the lengths on offer.');
    for (const lang of ['en', 'pt', 'es', 'fr', 'de', 'zh', 'ja']) {
      const text = t(lang, 'coaching.error.bad_length');
      assert.notEqual(text, 'coaching.error.bad_length', lang);
      assert.doesNotMatch(text, /30|60|1 h/, lang);
    }
  });
});

describe('reschedule, the viewer\'s side', () => {
  function rescheduling(s, v, { way = 'ask' } = {}) {
    const made = db.createCoachingBooking({ streamerId: s.id, viewer: v, startsAt: freeNow(s, 60)[0], minutes: 60, note: '', lang: 'en', now: Date.now() });
    assert.ok(made.ok, made.code);
    assert.ok(db.acceptCoachingBooking(made.booking.id, s.id, Date.now(), null));
    const started = db.startCoachingReschedule(made.booking.id, s.id, way, null, Date.now());
    assert.ok(started.ok, started.code);
    return db.getCoachingBooking(made.booking.id, s.id);
  }
  const url = (s, b, tail) => `/coaching/${s.login}/bookings/${b.id}/${tail}`;

  test('starts: the viewer\'s own booking only, never the original time or a held time; a signed-out visitor gets 401', async () => {
    const s = addStreamer();
    const v = addViewer();
    const b = rescheduling(s, v);
    const held = hold(s, addViewer(), freeNow(s, 60)[3]);
    const res = await get(url(s, b, 'starts'), { cookie: v.cookie });
    assert.equal(res.status, 200);
    assert.equal(res.json.minutes, 60);
    assert.ok(res.json.starts.length > 0);
    assert.ok(!res.json.starts.includes(b.starts_at), 'never the original time');
    assert.ok(!res.json.starts.includes(held.starts_at), 'never a held time');
    assert.equal((await get(url(s, b, 'starts'))).status, 401);
    assert.equal((await get(url(s, b, 'starts'), { cookie: addViewer().cookie })).status, 404, 'another viewer');
    assert.equal((await get(`/coaching/${s.login}/bookings/abc/starts`, { cookie: v.cookie })).status, 404);
  });

  test('propose: a time from the list is held and the coach hears; the original time, a held time and a string are refused', async () => {
    const s = addStreamer();
    const v = addViewer();
    const b = rescheduling(s, v);
    const starts = (await get(url(s, b, 'starts'), { cookie: v.cookie })).json.starts;
    for (const bad of [b.starts_at, 'x', null, 1.5]) {
      const refused = await post(url(s, b, 'propose'), { cookie: v.cookie, json: { startsAt: bad } });
      assert.equal(refused.status, 409, String(bad));
      assert.equal(refused.json.code, 'bad_time');
    }
    const long = await post(url(s, b, 'propose'), { cookie: v.cookie, json: { startsAt: starts[0], note: 'x'.repeat(301) } });
    assert.equal(long.json.code, 'bad_note');
    const ok = await post(url(s, b, 'propose'), { cookie: v.cookie, json: { startsAt: starts[0], note: 'Works for me' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.booking.proposal.startsAt, starts[0]);
    assert.equal(ok.json.booking.proposal.by, 'viewer');
    assert.equal(ok.json.booking.refunds, undefined, 'no payer details in a viewer view');
    assert.equal((await post(url(s, b, 'propose'), { json: { startsAt: starts[1] } })).status, 401);
    assert.equal((await post(url(s, b, 'propose'), { cookie: addViewer().cookie, json: { startsAt: starts[1] } })).status, 404);
  });

  test('accept-proposal: only the coach\'s proposal, only by the booking\'s viewer', async () => {
    const s = addStreamer();
    const v = addViewer();
    const b = rescheduling(s, v);
    assert.equal((await post(url(s, b, 'accept-proposal'), { cookie: v.cookie })).json.code, 'no_proposal');
    const start = freeNow(s, 60).find((x) => x !== b.starts_at);
    assert.ok(db.proposeCoachingTime(b.id, 'viewer', start, null, Date.now()).ok);
    const own = await post(url(s, b, 'accept-proposal'), { cookie: v.cookie });
    assert.equal(own.status, 409);
    assert.equal(own.json.code, 'not_yours_to_answer');
    assert.ok(db.proposeCoachingTime(b.id, 'coach', start, null, Date.now()).ok);
    assert.equal((await post(url(s, b, 'accept-proposal'), { cookie: addViewer().cookie })).status, 404);
    assert.equal((await post(url(s, b, 'accept-proposal'))).status, 401);
    const done = await post(url(s, b, 'accept-proposal'), { cookie: v.cookie });
    assert.equal(done.status, 200);
    assert.equal(done.json.booking.state, 'confirmed');
    assert.equal(done.json.booking.startsAt, start);
    assert.equal((await post(url(s, b, 'accept-proposal'), { cookie: v.cookie })).json.code, 'not_rescheduling');
  });

  test('the viewer\'s refusal texts exist in the page language', async () => {
    const s = addStreamer();
    const v = addViewer();
    const b = rescheduling(s, v);
    const res = await post(url(s, b, 'accept-proposal'), { cookie: v.cookie, headers: { 'x-lang': 'pt' } });
    assert.equal(res.json.error, t('pt', 'coaching.error.no_proposal'));
  });
});
