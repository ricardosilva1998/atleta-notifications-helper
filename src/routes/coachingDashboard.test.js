'use strict';

// The streamer's coaching page (src/routes/coachingDashboard.js), over HTTP: the real router and the real booking
// service on the real src/db.js over in-memory SQLite, behind the dashboard's login and disabled-account check
// (requireActiveStreamer), with a fake src/discord.js (nothing reaches Discord). The step that loads the streamer here
// stands in for server.js's session middleware; the CSRF check is server.js's (src/csrf.test.js). All names, ids and
// times are synthetic.

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
const ROUTE = path.join(__dirname, 'coachingDashboard.js');
const SERVICE = path.join(SRC, 'services', 'coachingBookings.js');
const MSG = path.join(SRC, 'services', 'coachingMessages.js');
const PAGE_SCRIPT = path.join(SRC, '..', 'public', 'js', 'coaching-dashboard.js');

// What the bot sees (guild id -> name), Discord's answer about an invite, and the direct messages it was asked to send.
const discord = {
  guilds: {}, invite: null, inviteCalls: [], dm: { ok: true }, sent: [],
  guildName(id) { return Object.hasOwn(this.guilds, id) ? this.guilds[id] : null; },
  async fetchInvite(code) { this.inviteCalls.push(code); return this.invite; },
  async sendDirectMessage(userId, payload) { this.sent.push({ userId, payload }); return this.dm; },
  async isGuildMember() { return true; },
  escapeLinkText,
};

let db;
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
    if ([ROUTE, SERVICE, MSG].includes(from)) {
      if (request === '../discord') return discord;
      if (request === '../config') return { app: { url: 'https://atleta.test' } };
    }
    return restore.load.apply(this, arguments);
  };
  restore.log = console.log;
  restore.error = console.error;
  console.log = () => {};
  console.error = () => {};
  let router;
  let access;
  try {
    for (const file of [DB_FILE, ROUTE, SERVICE, MSG]) delete require.cache[file];
    db = require(DB_FILE);
    router = require(ROUTE);
    access = require('../services/streamerAccess');
  } finally {
    Module._load = restore.load;
  }

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(SRC, 'views'));
  app.use(express.json());
  app.use((req, res, next) => {
    // As server.js's session step: the streamer signed in (x-test-streamer), and the page's language (x-lang).
    const id = Number(req.get('x-test-streamer'));
    req.streamer = id ? db.getStreamerById(id) : undefined;
    access.applyAccountStatus(req);
    const lang = req.get('x-lang') || 'en';
    Object.assign(res.locals, {
      lang, t: (key, params) => t(lang, key, params), esc, csrfToken: 'synthetic-token',
      racingUser: null, isAdmin: false, features: { youtube: false, overlays: true }, currentPath: req.path,
      notifications: [], unreadNotifCount: 0, streamerTier: 'free', SUPPORTED_LANGS: ['en'],
    });
    res.locals.rich = richFor(res.locals.t);
    next();
  });
  app.use('/dashboard', access.requireActiveStreamer, router);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = server.address().port;
});

after(async () => {
  console.log = restore.log;
  console.error = restore.error;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  discord.guilds = { 123: 'Coach HQ' };
  discord.invite = { ok: true, guildId: '123', guildName: 'Coach HQ' };
  discord.inviteCalls = [];
  discord.dm = { ok: true };
  discord.sent = [];
});

// ── HTTP ─────────────────────────────────────────────────────────────────

function send(method, urlPath, { streamer, json, lang } = {}) {
  return new Promise((resolve, reject) => {
    const body = json === undefined ? null : Buffer.from(JSON.stringify(json));
    const headers = {};
    if (streamer) headers['x-test-streamer'] = String(streamer.id || streamer);
    if (lang) headers['x-lang'] = lang;
    if (body) Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': body.length });
    const r = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers, agent: false }, (res) => {
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

const ZONE = 'Europe/Lisbon';
const HOURS = Array.from({ length: 7 }, () => ({ on: true, start: 1080, end: 1320 })); // every day 18:00-22:00
// Hours that are fine (Sunday off), to show that a refusal comes from the invite alone.
const SUNDAY_OFF = HOURS.map((d, i) => (i === 6 ? { ...d, on: false } : d));
let counter = 0;

// A streamer with claimed servers (guild id -> stored name) and, unless `settings` is null, coaching set up.
function addStreamer({ guilds = { 123: 'Coach HQ' }, settings = {} } = {}) {
  const n = ++counter;
  const id = Number(db.db.prepare('INSERT INTO streamers (discord_user_id, discord_username, discord_display_name, twitch_username, twitch_display_name) VALUES (?, ?, ?, ?, ?)')
    .run(`31000000000000${String(n).padStart(4, '0')}`, `streamer${n}`, `Streamer ${n}`, `coach_${n}`, `Coach_${n}`).lastInsertRowid);
  for (const [guildId, name] of Object.entries(guilds)) {
    db.db.prepare('INSERT INTO guilds (guild_id, streamer_id, guild_name) VALUES (?, ?, ?)').run(guildId, id, name);
  }
  if (settings) {
    db.saveCoachingSettings(id, {
      timeZone: ZONE, hours: HOURS, daysOff: [], guildId: '123', inviteCode: 'abc', whereText: '', notifyRequests: 0, lang: 'en', ...settings,
    });
  }
  return { id, login: `coach_${n}` };
}

let viewers = 0;
function viewer(over = {}) {
  const n = ++viewers;
  return { discordUserId: `41000000000000${String(n).padStart(4, '0')}`, username: `viewer${n}`, displayName: `Viewer ${n}`, avatar: null, ...over };
}

// What a viewer could book now, by the rules of services/coaching.js.
function freeNow(streamer, minutes = 60) {
  const now = Date.now();
  const settings = db.getCoachingSettings(streamer.id);
  return coaching.freeStarts({
    hours: settings.hours, timeZone: settings.time_zone, daysOff: settings.days_off,
    held: db.getHeldCoachingBookings(streamer.id, now), now, minutes,
  });
}
// The first free starts on two different local days.
function twoDays(streamer) {
  const starts = freeNow(streamer);
  const first = starts[0];
  const second = starts.find((s) => coaching.localDateOf(s, ZONE) !== coaching.localDateOf(first, ZONE));
  return [first, second];
}
function hold(streamer, who, startsAt, { minutes = 60, note = '', now = Date.now() } = {}) {
  const made = db.createCoachingBooking({ streamerId: streamer.id, viewer: who, startsAt, minutes, note, lang: 'en', now });
  assert.ok(made.ok, made.code);
  return made.booking;
}

// A settings save as the page sends it; `over` replaces fields.
const saveBody = (over = {}) => ({
  timeZone: ZONE, hours: HOURS, daysOff: [], guildId: '123', invite: 'https://discord.gg/abc', where: 'the Coaching Room', notifyRequests: true, ...over,
});
const errorOf = (code) => t('en', `coaching.dashboard.error.${code}`);
const pageData = (html) => JSON.parse(html.match(/window\.COACHING_DASHBOARD_DATA = (.*);\n/)[1]);
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
async function waitFor(check) {
  for (let i = 0; i < 100 && !check(); i++) await tick();
}

// ── Settings ─────────────────────────────────────────────────────────────

describe('When I coach', () => {
  test('settings save checks the zone, the hours, the server and the invite, and stores the canonical zone', async () => {
    const s = addStreamer({ guilds: { 123: 'Coach HQ', 456: 'Other HQ' }, settings: null });
    const other = addStreamer({ guilds: { 789: 'Not yours' } });
    const refusals = [
      [{ timeZone: 'Mars/Olympus' }, 'bad_zone'],
      [{ timeZone: '' }, 'bad_zone'],
      [{ hours: HOURS.slice(0, 6) }, 'bad_hours'],
      [{ hours: HOURS.map((d, i) => (i ? d : { on: true, start: 1320, end: 1080 })) }, 'bad_hours'],
      [{ daysOff: ['2026-02-30'] }, 'bad_days_off'],
      [{ daysOff: 'tomorrow' }, 'bad_days_off'],
      [{ guildId: '999' }, 'bad_server'],
      [{ guildId: '789' }, 'bad_server'], // another streamer's server
      [{ guildId: 123 }, 'bad_server'],
      [{ invite: 'not an invite!' }, 'bad_invite'],
      [{ invite: '' }, 'bad_invite'],
      [{ where: 'x'.repeat(coaching.WHERE_MAX + 1) }, 'bad_where'],
      [{ notifyRequests: 'maybe' }, 'bad_switch'],
    ];
    for (const [over, code] of refusals) {
      const res = await post('/dashboard/api/coaching/settings', { streamer: s, json: saveBody(over) });
      assert.equal(res.status, 400, `${JSON.stringify(over)}`);
      assert.deepEqual(res.json, { ok: false, code, error: errorOf(code) });
      assert.notEqual(res.json.error, `coaching.dashboard.error.${code}`, 'a sentence, not its key');
    }
    assert.deepEqual(discord.inviteCalls, [], 'Discord is asked only once the rest is right');
    assert.equal(db.getCoachingSettings(s.id), null, 'nothing was saved');
    assert.equal(db.getCoachingSettings(other.id).guild_id, '123', "the other streamer's settings are untouched");

    // A name Intl knows in another spelling is stored by its canonical name; the invite by its code; the page's language.
    const tomorrow = coaching.localDateOf(Date.now() + 86400e3, ZONE);
    const res = await post('/dashboard/api/coaching/settings', {
      streamer: s, lang: 'pt',
      json: saveBody({ timeZone: 'europe/lisbon', daysOff: [tomorrow, '2020-01-01'], where: '  the Coaching Room  ', notifyRequests: false }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.deepEqual(res.json.outsideHours, []);
    assert.deepEqual(discord.inviteCalls, ['abc']);
    const saved = db.getCoachingSettings(s.id);
    assert.equal(saved.time_zone, 'Europe/Lisbon');
    assert.deepEqual(saved.hours, HOURS);
    assert.deepEqual(saved.days_off, [tomorrow], 'a past day off is dropped');
    assert.equal(saved.guild_id, '123');
    assert.equal(saved.invite_code, 'abc');
    assert.equal(saved.where_text, 'the Coaching Room');
    assert.equal(saved.notify_requests, 0);
    assert.equal(saved.lang, 'pt');
    assert.equal(saved.open, 1, 'the first save opens bookings');
    assert.equal(saved.invite_ok, 1, 'the check made by the save is recorded');
    assert.ok(saved.invite_checked_at > 0);
    assert.equal(res.json.settings.timeZone, 'Europe/Lisbon');
    assert.equal(res.json.settings.invite, 'https://discord.gg/abc');
    assert.equal(res.json.settings.inviteOk, true);
    assert.equal(res.json.settings.open, true);
    assert.equal(res.json.settings.notifyRequests, false);
    assert.deepEqual(res.json.settings.daysOff, [tomorrow]);

    // The second server is claimed but the bot is not in it now: a save naming it is still one of the streamer's.
    discord.invite = { ok: true, guildId: '456', guildName: 'Other HQ' };
    const moved = await post('/dashboard/api/coaching/settings', { streamer: s, json: saveBody({ guildId: '456', invite: 'discord.gg/xyz' }) });
    assert.equal(moved.status, 200);
    assert.equal(db.getCoachingSettings(s.id).guild_id, '456');

    // Discord cannot answer: the save goes through with the invite unchecked.
    discord.invite = { ok: false, reason: 'unavailable' };
    const unchecked = await post('/dashboard/api/coaching/settings', { streamer: s, json: saveBody({ invite: 'https://discord.com/invite/new-code' }) });
    assert.equal(unchecked.status, 200);
    const after = db.getCoachingSettings(s.id);
    assert.equal(after.invite_code, 'new-code');
    assert.equal(after.invite_ok, null);
    assert.equal(after.invite_checked_at, null);
    assert.equal(unchecked.json.settings.inviteOk, null);
  });

  test('a dead invite answers bad_invite and one to another server invite_other_server', async () => {
    const s = addStreamer({ guilds: { 123: 'Coach HQ', 456: 'Other HQ' } });
    const before = db.getCoachingSettings(s.id);

    discord.invite = { ok: false, reason: 'unknown' };
    const dead = await post('/dashboard/api/coaching/settings', { streamer: s, json: saveBody({ invite: 'discord.gg/expired', hours: SUNDAY_OFF }) });
    assert.equal(dead.status, 400);
    assert.deepEqual(dead.json, { ok: false, code: 'bad_invite', error: errorOf('bad_invite') });

    discord.invite = { ok: true, guildId: '456', guildName: 'Other HQ' };
    const elsewhere = await post('/dashboard/api/coaching/settings', { streamer: s, json: saveBody({ invite: 'discord.gg/other', hours: SUNDAY_OFF }) });
    assert.equal(elsewhere.status, 400);
    assert.deepEqual(elsewhere.json, { ok: false, code: 'invite_other_server', error: errorOf('invite_other_server') });

    assert.deepEqual(discord.inviteCalls, ['expired', 'other']);
    assert.deepEqual(db.getCoachingSettings(s.id), before, 'nothing changed');
  });

  test('a save that leaves a booking outside the hours keeps it and lists it in outsideHours', async () => {
    const s = addStreamer();
    const [first, second] = twoDays(s);
    const off = hold(s, viewer(), first);
    const kept = hold(s, viewer(), second);
    const gone = hold(s, viewer(), first + 3600e3);
    db.setCoachingBookingStatus(gone.id, s.id, ['waiting'], 'cancelled', Date.now());
    const day = coaching.localDateOf(first, ZONE);

    const res = await post('/dashboard/api/coaching/settings', { streamer: s, json: saveBody({ daysOff: [day] }) });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.outsideHours, [off.id], 'only the held booking on the day off');
    assert.equal(db.getCoachingBooking(off.id, s.id).status, 'waiting', 'the booking is kept');
    assert.deepEqual(db.getCoachingSettings(s.id).days_off, [day]);

    // The second booking's weekday switched off as well: both are outside, both kept.
    const weekday = (new Date(`${coaching.localDateOf(second, ZONE)}T00:00:00Z`).getUTCDay() + 6) % 7;
    const fewer = HOURS.map((d, i) => (i === weekday ? { on: false, start: 1080, end: 1320 } : d));
    const again = await post('/dashboard/api/coaching/settings', { streamer: s, json: saveBody({ daysOff: [day], hours: fewer }) });
    assert.deepEqual(again.json.outsideHours.sort((a, b) => a - b), [off.id, kept.id].sort((a, b) => a - b));
    assert.equal(db.getCoachingBooking(kept.id, s.id).status, 'waiting');
  });

  test('open needs a strict switch value and settings', async () => {
    const fresh = addStreamer({ settings: null });
    const notSetUp = await post('/dashboard/api/coaching/open', { streamer: fresh, json: { open: true } });
    assert.equal(notSetUp.status, 409);
    assert.deepEqual(notSetUp.json, { ok: false, code: 'not_set_up', error: errorOf('not_set_up') });

    const s = addStreamer();
    for (const open of ['yes', 2, null, undefined, {}]) {
      const res = await post('/dashboard/api/coaching/open', { streamer: s, json: { open } });
      assert.equal(res.status, 400, String(open));
      assert.deepEqual(res.json, { ok: false, code: 'bad_switch', error: errorOf('bad_switch') });
    }
    assert.equal(db.getCoachingSettings(s.id).open, 1);

    const paused = await post('/dashboard/api/coaching/open', { streamer: s, json: { open: false } });
    assert.deepEqual(paused.json, { ok: true, open: false });
    assert.equal(db.getCoachingSettings(s.id).open, 0);
    const reopened = await post('/dashboard/api/coaching/open', { streamer: s, json: { open: '1' } });
    assert.deepEqual(reopened.json, { ok: true, open: true });
    assert.equal(db.getCoachingSettings(s.id).open, 1);
  });

  test('every route needs a signed-in streamer whose account is not disabled', async () => {
    const s = addStreamer();
    db.db.prepare('UPDATE streamers SET enabled = 0 WHERE id = ?').run(s.id);
    for (const [method, url] of [['GET', '/dashboard/coaching'], ['POST', '/dashboard/api/coaching/settings'], ['POST', '/dashboard/api/coaching/open'], ['POST', '/dashboard/api/coaching/bookings/1/accept']]) {
      const anonymous = await send(method, url, { json: method === 'POST' ? {} : undefined });
      assert.equal(anonymous.status, 302, `${method} ${url} without a streamer goes to sign in`);
      const disabled = await send(method, url, { streamer: s, json: method === 'POST' ? { open: false } : undefined });
      assert.equal(disabled.status, 403, `${method} ${url} for a disabled account`);
    }
    assert.equal(db.getCoachingSettings(s.id).open, 1);
  });
});

// ── The schedule's buttons ───────────────────────────────────────────────

describe('Accept, Decline and Cancel', () => {
  test('accept answers the booking with messageError when Discord refused', async () => {
    const s = addStreamer();
    const who = viewer();
    const booking = hold(s, who, freeNow(s)[0], { note: 'braking' });
    discord.dm = { ok: false, reason: 'unreachable' };
    const res = await post(`/dashboard/api/coaching/bookings/${booking.id}/accept`, { streamer: s });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.booking.id, booking.id);
    assert.equal(res.json.booking.state, 'confirmed');
    assert.equal(res.json.booking.messageError, 'unreachable');
    assert.equal(res.json.booking.viewerName, who.displayName);
    assert.equal(res.json.booking.note, 'braking');
    assert.equal(res.json.booking.outside, false);
    assert.equal(discord.sent.length, 1);
    assert.equal(discord.sent[0].userId, who.discordUserId);
    const row = db.getCoachingBooking(booking.id, s.id);
    assert.equal(row.status, 'confirmed', 'accepted even though the message did not go out');
    assert.equal(row.message_error, 'unreachable');

    // Then Decline on a confirmed booking is refused with its text; Cancel goes through, once.
    discord.dm = { ok: true };
    const declined = await post(`/dashboard/api/coaching/bookings/${booking.id}/decline`, { streamer: s });
    assert.equal(declined.status, 409);
    assert.deepEqual(declined.json, { ok: false, code: 'not_waiting', error: errorOf('not_waiting') });
    const cancelled = await post(`/dashboard/api/coaching/bookings/${booking.id}/cancel`, { streamer: s });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.json.booking.state, 'cancelled');
    assert.equal(cancelled.json.booking.messageError, null);
    const again = await post(`/dashboard/api/coaching/bookings/${booking.id}/cancel`, { streamer: s });
    assert.equal(again.status, 409);
    assert.deepEqual(again.json, { ok: false, code: 'not_active', error: errorOf('not_active') });
  });

  test('decline answers the declined booking', async () => {
    const s = addStreamer();
    const booking = hold(s, viewer(), freeNow(s)[0]);
    const res = await post(`/dashboard/api/coaching/bookings/${booking.id}/decline`, { streamer: s });
    assert.equal(res.status, 200);
    assert.equal(res.json.booking.state, 'declined');
    assert.equal(db.getCoachingBooking(booking.id, s.id).status, 'declined');
  });

  test('a waiting booking whose start has passed answers too_late', async () => {
    const s = addStreamer();
    const past = hold(s, viewer(), Date.now() - 3600e3, { now: Date.now() - 86400e3 });
    const res = await post(`/dashboard/api/coaching/bookings/${past.id}/accept`, { streamer: s });
    assert.equal(res.status, 409);
    assert.deepEqual(res.json, { ok: false, code: 'too_late', error: errorOf('too_late') });
    assert.equal(db.getCoachingBooking(past.id, s.id).status, 'waiting');
  });

  test("another streamer's booking answers not_found", async () => {
    const mine = addStreamer();
    const theirs = addStreamer();
    const booking = hold(theirs, viewer(), freeNow(theirs)[0]);
    for (const action of ['accept', 'decline', 'cancel']) {
      for (const id of [booking.id, 'abc', '0', '1e3', '99999999']) {
        const res = await post(`/dashboard/api/coaching/bookings/${id}/${action}`, { streamer: mine });
        assert.equal(res.status, 404, `${action} ${id}`);
        assert.deepEqual(res.json, { ok: false, code: 'not_found', error: t('en', 'coaching.error.not_found') });
      }
    }
    assert.equal(db.getCoachingBooking(booking.id, theirs.id).status, 'waiting');
    assert.equal(discord.sent.length, 0);
  });
});

// ── The page ─────────────────────────────────────────────────────────────

describe('the page', () => {
  test('the page lists waiting and confirmed bookings by day and prints notes as text', async () => {
    const HOSTILE = '</script><script>alert(1)</script>';
    const s = addStreamer();
    const [first, second] = twoDays(s);
    const waiting = hold(s, viewer({ displayName: `Name ${HOSTILE}` }), first, { note: `Note ${HOSTILE}` });
    const confirmed = hold(s, viewer(), first + 3600e3, { minutes: 30 });
    db.setCoachingBookingStatus(confirmed.id, s.id, ['waiting'], 'confirmed', Date.now());
    const later = hold(s, viewer(), second);
    const old = hold(s, viewer(), Date.now() - 5 * 86400e3, { now: Date.now() - 6 * 86400e3 });
    db.setCoachingBookingStatus(old.id, s.id, ['waiting'], 'confirmed', Date.now() - 6 * 86400e3);
    const tooOld = hold(s, viewer(), Date.now() - 40 * 86400e3, { now: Date.now() - 41 * 86400e3 });
    const other = addStreamer();
    const notMine = hold(other, viewer(), freeNow(other)[0]);
    // The second day becomes a day off: its booking stays and is marked outside the hours.
    db.saveCoachingSettings(s.id, {
      timeZone: ZONE, hours: HOURS, daysOff: [coaching.localDateOf(second, ZONE)], guildId: '123', inviteCode: 'abc', whereText: '', notifyRequests: 0, lang: 'en',
    });

    const res = await get('/dashboard/coaching', { streamer: s });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.ok(!res.text.includes('<script>alert(1)'), 'a name or the note was printed as markup');
    assert.ok(res.text.includes('Note \\u003c/script>\\u003cscript>alert(1)\\u003c/script>'), 'the note travels as text in the page data');
    assert.ok(res.text.includes(esc(t('en', 'coaching.dashboard.schedule'))));
    assert.ok(res.text.includes(esc(t('en', 'coaching.dashboard.hours'))));
    assert.ok(res.text.includes('<script src="/js/coaching-core.js"></script>'));
    assert.ok(res.text.includes('<script src="/js/coaching-dashboard.js"></script>'));
    assert.ok(res.text.trimEnd().endsWith('</html>'), 'the footer closes the page');

    const data = pageData(res.text);
    assert.equal(data.setUp, true);
    assert.equal(data.settings.timeZone, ZONE);
    assert.deepEqual(data.schedule.days.map((d) => d.date), [coaching.localDateOf(first, ZONE), coaching.localDateOf(second, ZONE)]);
    const [day1, day2] = data.schedule.days;
    assert.deepEqual(day1.bookings.map((b) => [b.id, b.state, b.minutes]), [[waiting.id, 'waiting', 60], [confirmed.id, 'confirmed', 30]]);
    assert.equal(day1.bookings[0].note, `Note ${HOSTILE}`);
    assert.equal(day1.bookings[0].viewerName, `Name ${HOSTILE}`);
    assert.equal(day1.bookings[0].outside, false);
    assert.deepEqual(day2.bookings.map((b) => [b.id, b.outside]), [[later.id, true]]);
    assert.deepEqual(data.schedule.past.map((b) => [b.id, b.state]), [[old.id, 'confirmed']], 'the last 30 days, not older');
    const ids = JSON.stringify(data.schedule);
    assert.ok(!ids.includes(`"id":${tooOld.id},`) && !ids.includes(`"id":${notMine.id},`), 'nothing older, nothing of another streamer');
    assert.equal(data.bookingUrl, `https://atleta.test/coaching/${s.login}`);

    const script = fs.readFileSync(PAGE_SCRIPT, 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(script), 'the page script builds with textContent only');
  });

  test('the server picker lists the claimed servers the bot is in, and the saved one while the bot cannot see it', async () => {
    discord.guilds = { 123: 'Coach HQ live', 456: 'Visible' };
    const s = addStreamer({ guilds: { 123: 'Coach HQ', 456: 'Visible stored', 789: 'Bot gone' } });
    const page = pageData((await get('/dashboard/coaching', { streamer: s })).text);
    assert.deepEqual(page.servers, [{ id: '123', name: 'Coach HQ live' }, { id: '456', name: 'Visible' }]);

    discord.guilds = {}; // Discord down or not ready
    const down = pageData((await get('/dashboard/coaching', { streamer: s })).text);
    assert.deepEqual(down.servers, [{ id: '123', name: 'Coach HQ' }], 'the saved server stays, by its stored name');

    await tick(); // the set-up streamer's own invite checks, after its pages above
    discord.inviteCalls = [];
    const none = addStreamer({ guilds: {}, settings: null });
    const res = await get('/dashboard/coaching', { streamer: none });
    assert.equal(res.status, 200);
    const empty = pageData(res.text);
    assert.deepEqual(empty.servers, []);
    assert.equal(empty.setUp, false);
    assert.deepEqual(empty.settings.hours, coaching.DEFAULT_HOURS);
    assert.ok(res.text.includes(esc(t('en', 'coaching.dashboard.noServer'))));
    await tick();
    assert.deepEqual(discord.inviteCalls, [], 'nothing to check before coaching is set up');
  });

  test('the page asks Discord about the invite after it is sent, at most once an hour, and warns when it is dead', async () => {
    const s = addStreamer();
    discord.invite = { ok: false, reason: 'unknown' };
    const first = await get('/dashboard/coaching', { streamer: s });
    assert.equal(first.status, 200);
    assert.equal(pageData(first.text).settings.inviteOk, null, 'the page is sent before the answer');
    await waitFor(() => db.getCoachingSettings(s.id).invite_checked_at);
    assert.deepEqual(discord.inviteCalls, ['abc']);
    assert.equal(db.getCoachingSettings(s.id).invite_ok, 0);

    const second = await get('/dashboard/coaching', { streamer: s });
    await tick();
    assert.deepEqual(discord.inviteCalls, ['abc'], 'checked less than an hour ago');
    assert.equal(pageData(second.text).settings.inviteOk, false);
    assert.ok(second.text.includes(esc(t('en', 'coaching.dashboard.inviteBroken'))));

    // A check that throws is caught: the page still answers.
    discord.fetchInvite = async () => { throw new Error('boom'); };
    db.db.prepare('UPDATE coaching_settings SET invite_checked_at = ? WHERE streamer_id = ?').run(Date.now() - 2 * 3600e3, s.id);
    try {
      const third = await get('/dashboard/coaching', { streamer: s });
      assert.equal(third.status, 200);
      await tick();
    } finally {
      delete discord.fetchInvite;
    }
  });
});
