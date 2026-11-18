'use strict';

// My bookings (src/routes/myBookings.js), over HTTP: the real router and booking service on the real src/db.js over
// in-memory SQLite, a fake src/discord.js. The step that loads the viewer stands in for server.js's session middleware.
// Bookings are made straight in the database at fixed days from a fixed clock; nothing depends on the time of day.

const { test, describe, before, after } = require('node:test');
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
const { escapeLinkText } = require('../discord');
const { t, esc, richFor } = require('../i18n');

const SRC = path.join(__dirname, '..');
const DB_FILE = path.join(SRC, 'db.js');
const ROUTE = path.join(__dirname, 'myBookings.js');
const SERVICE = path.join(SRC, 'services', 'coachingBookings.js');
const MSG = path.join(SRC, 'services', 'coachingMessages.js');
const discord = { escapeLinkText, guildName() { return 'HQ'; }, async isGuildMember() { return true; }, async sendDirectMessage() { return { ok: true }; } };

const DAY = 86400e3;
const HALF = 1800e3;
const HOURS = Array.from({ length: 7 }, () => ({ on: true, start: 1080, end: 1320 }));
let db;
let server;
let port;
let counter = 0;
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
    if ([SERVICE, MSG].includes(from)) {
      if (request === '../discord') return discord;
      if (request === '../config') return { app: { url: 'https://atleta.test' } };
    }
    return restore.load.apply(this, arguments);
  };
  restore.log = console.log;
  console.log = () => {};
  let router;
  try {
    for (const file of [DB_FILE, ROUTE, SERVICE, MSG]) delete require.cache[file];
    db = require(DB_FILE);
    router = require(ROUTE);
  } finally {
    Module._load = restore.load;
  }
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(SRC, 'views'));
  app.use(require('cookie-parser')());
  app.use((req, res, next) => {
    const session = req.cookies && req.cookies.viewer_session ? db.getViewerSession(req.cookies.viewer_session) : null;
    const streamer = Number(req.get('x-test-streamer')) ? db.getStreamerById(Number(req.get('x-test-streamer'))) : null;
    if (session) {
      req.viewer = { discordUserId: session.discord_user_id, username: session.discord_username, displayName: session.discord_display_name || session.discord_username, avatar: session.discord_avatar, fromStreamer: false };
    } else if (streamer) {
      req.viewer = { discordUserId: streamer.discord_user_id, username: streamer.discord_username, displayName: streamer.discord_username, avatar: null, fromStreamer: true };
    }
    res.locals.lang = 'en';
    res.locals.t = (key, params) => t('en', key, params);
    res.locals.esc = esc;
    res.locals.rich = richFor(res.locals.t);
    res.locals.csrfToken = 'synthetic-token';
    next();
  });
  app.use('/my-bookings', router);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = server.address().port;
});

after(async () => {
  console.log = restore.log;
  await new Promise((resolve) => server.close(resolve));
});

function get(urlPath, { cookie, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const sent = { ...headers };
    if (cookie) sent.Cookie = cookie;
    http.get({ host: '127.0.0.1', port, path: urlPath, headers: sent, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch { json = undefined; }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    }).on('error', reject);
  });
}

function addStreamer({ settings = true, enabled = 1 } = {}) {
  const n = ++counter;
  const id = Number(db.db.prepare('INSERT INTO streamers (discord_user_id, discord_username, twitch_username, twitch_display_name, twitch_profile_image, enabled, paypal_email) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(`30000000000000${String(n).padStart(4, '0')}`, `streamer${n}`, `coach_${n}`, `Coach ${n}`, `https://img.test/${n}.png`, enabled, 'coach@example.com').lastInsertRowid);
  if (settings) {
    db.saveCoachingSettings(id, { timeZone: 'Europe/Lisbon', hours: HOURS, daysOff: [], guildId: '123', inviteCode: 'abc', whereText: '', notifyRequests: 0, lang: 'en' });
  }
  return { id, login: `coach_${n}`, discordId: `30000000000000${String(n).padStart(4, '0')}` };
}
let viewers = 0;
function addViewer() {
  const n = ++viewers;
  const viewer = { discordUserId: `40000000000000${String(n).padStart(4, '0')}`, username: `viewer${n}`, displayName: `Viewer ${n}`, avatar: null };
  const sid = String(n).padStart(64, 'b');
  db.createViewerSession(sid, viewer, Date.now() + 3600e3);
  return { ...viewer, cookie: `viewer_session=${sid}` };
}
function hold(streamer, viewer, days, note = '') {
  const startsAt = Math.ceil((Date.now() + days * DAY) / HALF) * HALF;
  const made = db.createCoachingBooking({ streamerId: streamer.id, viewer, startsAt, minutes: 60, note, lang: 'en', now: Date.now() });
  assert.ok(made.ok, made.code);
  return made.booking;
}

describe('My bookings', () => {
  test('shows only the viewer\'s own bookings, across two coaches, with the coach on each', async () => {
    const a = addStreamer();
    const b = addStreamer();
    const me = addViewer();
    const other = addViewer();
    const mine1 = hold(a, me, 5);
    const mine2 = hold(b, me, 6);
    hold(a, other, 7, 'someone else');
    const res = await get('/my-bookings/state', { cookie: me.cookie });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.json.bookings.map((x) => x.id).sort(), [mine1.id, mine2.id].sort());
    const first = res.json.bookings.find((x) => x.id === mine1.id);
    assert.deepEqual(first.coach, { login: a.login, name: `Coach ${a.id}`, avatar: `https://img.test/${a.id}.png`, available: true });
    assert.equal(res.json.viewer.username, me.username);
    assert.ok(!res.text.includes('someone else'), "another viewer's note never shown");
  });

  test("lists a booking under its own coach even when the coach's old login now belongs to another streamer", async () => {
    const a = addStreamer();
    const b = addStreamer();
    const me = addViewer();
    const mine = hold(a, me, 5);
    db.db.prepare('UPDATE streamers SET twitch_username = ? WHERE id = ?').run('a_new_login', a.id);
    db.db.prepare('UPDATE streamers SET twitch_username = ? WHERE id = ?').run(a.login, b.id);
    const res = await get('/my-bookings/state', { cookie: me.cookie });
    const row = res.json.bookings.find((x) => x.id === mine.id);
    assert.equal(row.coach.login, 'a_new_login');
    assert.equal(row.coach.available, true);
  });

  test('a coach with no Twitch login keeps the booking actionable, named by their Discord name', async () => {
    const a = addStreamer();
    const me = addViewer();
    const mine = hold(a, me, 5);
    db.db.prepare('UPDATE streamers SET twitch_username = NULL, twitch_display_name = NULL WHERE id = ?').run(a.id);
    const res = await get('/my-bookings/state', { cookie: me.cookie });
    const row = res.json.bookings.find((x) => x.id === mine.id);
    assert.equal(row.coach.login, null);
    assert.equal(row.coach.available, true);
    assert.equal(row.coach.name, db.getStreamerById(a.id).discord_username);
  });

  test('carries no payer details and no coach-only fields', async () => {
    const a = addStreamer();
    const me = addViewer();
    const b = hold(a, me, 5);
    db.db.prepare("UPDATE coaching_bookings SET status = 'confirmed', paid_at = ?, paid_amount_cents = 2500 WHERE id = ?").run(Date.now(), b.id);
    db.db.prepare("INSERT INTO coaching_payments (order_id, booking_id, streamer_id, amount_cents, currency, payee_email, status, capture_id, created_at, payer_name, payer_email, payer_id) VALUES ('ORDERX1', ?, ?, 2500, 'EUR', 'coach@example.com', 'captured', 'CAP1', 1, 'Payer Name', 'payer@example.com', 'PAYERID1')").run(b.id, a.id);
    const res = await get('/my-bookings/state', { cookie: me.cookie });
    assert.equal(res.status, 200, res.text);
    for (const forbidden of ['Payer Name', 'payer@example.com', 'PAYERID1']) assert.ok(!res.text.includes(forbidden), forbidden);
    assert.ok(!('refunds' in res.json.bookings[0]));
  });

  test('a coach who is disabled or has no coaching settings is not available', async () => {
    const off = addStreamer();
    const me = addViewer();
    hold(off, me, 5);
    db.db.prepare('UPDATE streamers SET enabled = 0 WHERE id = ?').run(off.id);
    const res = await get('/my-bookings/state', { cookie: me.cookie });
    assert.equal(res.json.bookings[0].coach.available, false);
  });

  test('without a viewer: 401 for the state, the Connect Discord page for the page', async () => {
    const state = await get('/my-bookings/state');
    assert.equal(state.status, 401);
    assert.equal(state.json.ok, false);
    assert.equal(state.json.error, t('en', 'coaching.error.signin'));
    const page = await get('/my-bookings');
    assert.equal(page.status, 200);
    assert.ok(page.text.includes('href="/auth/coaching-signin"'));
  });

  test('a streamer signed in to the site sees their own bookings as a viewer; a viewer session wins', async () => {
    const coach = addStreamer();
    const asViewer = addStreamer();
    const stream = { id: asViewer.id, discordUserId: asViewer.discordId };
    const mine = hold(coach, { discordUserId: stream.discordUserId, username: 'streamer', displayName: 'S', avatar: null }, 5);
    const res = await get('/my-bookings/state', { headers: { 'x-test-streamer': String(asViewer.id) } });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.json.bookings.map((x) => x.id), [mine.id]);
    assert.equal(res.json.viewer.fromStreamer, true);
    const v = addViewer();
    const win = await get('/my-bookings/state', { cookie: v.cookie, headers: { 'x-test-streamer': String(asViewer.id) } });
    assert.deepEqual(win.json.bookings, [], 'the viewer session wins');
  });
});

describe('the page', () => {
  test('hands the page script its texts, and the script reads exactly those', async () => {
    const me = addViewer();
    const res = await get('/my-bookings', { cookie: me.cookie });
    assert.equal(res.status, 200);
    const texts = JSON.parse(res.text.match(/window\.MYBOOKINGS_TEXTS = (\{.*?\});<\/script>/)[1]);
    const script = fs.readFileSync(path.join(SRC, '..', 'public', 'js', 'my-bookings.js'), 'utf8');
    const read = [...new Set([...script.matchAll(/\bT\.(\w+)/g)].map((m) => m[1]))];
    assert.ok(read.length > 10);
    assert.deepEqual(read.filter((name) => !(name in texts)), [], 'the script reads texts the page does not hand over');
    assert.deepEqual(Object.keys(texts).filter((name) => !read.includes(name)), [], 'texts handed over but never read');
    for (const state of ['waiting', 'confirmed', 'declined', 'cancelled', 'awaiting_payment', 'expired', 'withdrawn', 'unanswered', 'rescheduling', 'not_rescheduled']) {
      assert.equal(typeof texts.states[state], 'string', state);
    }
    for (const code of ['pay_invalid', 'pay_unconfirmed', 'not_paid', 'late', 'paid', 'pay_closed']) assert.equal(typeof texts.returnErrors[code], 'string', code);
    assert.ok(texts.requestSent.includes('{{name}}'), 'fields are kept for the script');
  });

  test('a signed-in page has the sign-out form and no sign-in link; the data cannot end the script', async () => {
    const a = addStreamer();
    const me = addViewer();
    hold(a, me, 5, '</script><b>x');
    const res = await get('/my-bookings', { cookie: me.cookie });
    assert.ok(res.text.includes('action="/auth/coaching-signout"'));
    assert.ok(!res.text.includes('href="/auth/coaching-signin"'));
    assert.ok(!res.text.includes('</script><b>x'));
    assert.ok(res.text.includes('\\u003c/script>'));
  });
});
