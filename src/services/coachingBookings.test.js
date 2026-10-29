'use strict';

// The coaching booking service against the real src/db.js on in-memory SQLite and a fake src/discord.js.

const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const DB_FILE = path.join(__dirname, '..', 'db.js');
const SERVICE = path.join(__dirname, 'coachingBookings.js');
const MSG = path.join(__dirname, 'coachingMessages.js');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

let db;
let svc;
let counter = 0;
const discord = {
  sent: [], sendResult: { ok: true }, member: true, invite: { ok: true, guildId: '123', guildName: 'HQ' }, inviteCalls: 0,
  async sendDirectMessage(userId, payload) { this.sent.push({ userId, payload }); return this.sendResult; },
  async isGuildMember() { return this.member; },
  async fetchInvite() { this.inviteCalls++; return this.invite; },
  guildName() { return 'Coach HQ'; },
  escapeLinkText: (text) => String(text).replace(/[\\[\]]/g, '\\$&'),
};

before(() => {
  const origLoad = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
      if (request === './config') return { adminDiscordIds: [] };
    }
    if (parent && (parent.filename === SERVICE || parent.filename === MSG)) {
      if (request === '../discord') return discord;
      if (request === '../config') return { app: { url: 'https://atleta.test' } };
    }
    return origLoad(request, parent, isMain);
  };
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try {
    delete require.cache[DB_FILE];
    db = require(DB_FILE);
    delete require.cache[SERVICE];
    delete require.cache[MSG];
    svc = require(SERVICE);
  } finally {
    console.log = log;
    console.error = error;
    Module._load = origLoad;
  }
});

beforeEach(() => {
  discord.sent = []; discord.sendResult = { ok: true }; discord.member = true; discord.inviteCalls = 0;
  discord.invite = { ok: true, guildId: '123', guildName: 'HQ' };
});

const HOURS = Array.from({ length: 7 }, (_, i) => ({ on: i < 5, start: 1080, end: 1320 }));
const NOW = Date.UTC(2026, 10, 2, 19, 0); // Monday 19:00 Lisbon (UTC+0)
const HOUR = 3600e3;
const FREE = NOW + 25 * HOUR; // Tuesday 20:00
const NEXT_FREE = FREE + 30 * 60e3;

function addStreamer({ settings = {}, guild = true, twitch = true } = {}) {
  const n = ++counter;
  const discordId = `3000000000000${String(n).padStart(5, '0')}`;
  const id = Number(db.db.prepare('INSERT INTO streamers (discord_user_id, discord_username, twitch_username, twitch_display_name) VALUES (?, ?, ?, ?)')
    .run(discordId, `s${n}`, twitch ? `coach${n}` : null, twitch ? `Coach${n}` : null).lastInsertRowid);
  if (guild) db.db.prepare('INSERT INTO guilds (guild_id, streamer_id, guild_name) VALUES (?, ?, ?)').run('123', id, 'HQ');
  if (settings) {
    db.saveCoachingSettings(id, {
      timeZone: 'Europe/Lisbon', hours: HOURS, daysOff: [], guildId: '123', inviteCode: 'abc', whereText: 'Voice room',
      notifyRequests: 1, lang: 'en', ...settings,
    });
  }
  return { id, discord_user_id: discordId, twitch_username: twitch ? `coach${n}` : null, twitch_display_name: twitch ? `Coach${n}` : null };
}
const viewer = (id) => ({ discordUserId: `4000000000000000${id}`, username: `u${id}`, displayName: `U ${id}`, avatar: null });
const ask = (s, v, over = {}, opts = {}) => svc.request(s, v, { startsAt: FREE, minutes: 60, note: 'hi', lang: 'en', ...over }, { now: NOW, ...opts });
const tick = () => new Promise((r) => setImmediate(r));

describe('request', () => {
  test('refuses join_first when the viewer is not in the server, and books with unverified when Discord cannot say', async () => {
    const s = addStreamer();
    discord.member = false;
    assert.deepEqual(await ask(s, viewer(1)), { ok: false, code: 'join_first' });
    discord.member = null;
    const r = await ask(s, viewer(1));
    assert.equal(r.ok, true);
    assert.equal(r.unverified, true);
    discord.member = true;
    const r2 = await ask(s, viewer(2), { startsAt: FREE + 24 * HOUR });
    assert.equal(r2.unverified, false);
  });

  test('refuses a closed streamer, a time that is not free, a length of 45 and a note of 301 characters', async () => {
    const s = addStreamer();
    assert.equal((await ask(s, viewer(1), { startsAt: FREE + 3 * HOUR })).code, 'bad_time');
    assert.equal((await ask(s, viewer(1), { minutes: 45 })).code, 'bad_length');
    assert.equal((await ask(s, viewer(1), { note: 'x'.repeat(301) })).code, 'bad_note');
    assert.equal((await ask(s, viewer(1), { note: undefined })).ok, true);
    db.setCoachingOpen(s.id, 0);
    assert.equal((await ask(s, viewer(2))).code, 'not_open');
    assert.equal((await ask(addStreamer({ settings: null }), viewer(1))).code, 'not_open');
  });

  test('a held time is not offered, a lost race answers taken and a third booking of one viewer answers limit', async () => {
    const s = addStreamer();
    assert.equal((await ask(s, viewer(1))).ok, true);
    assert.equal((await ask(s, viewer(2), { startsAt: NEXT_FREE })).code, 'bad_time'); // already held: not offered
    const real = db.createCoachingBooking;
    db.createCoachingBooking = () => ({ ok: false, code: 'taken' }); // another request won the race
    try { assert.equal((await ask(s, viewer(3), { startsAt: FREE + 24 * HOUR })).code, 'taken'); } finally { db.createCoachingBooking = real; }
    assert.equal((await ask(s, viewer(1), { startsAt: FREE + 24 * HOUR })).ok, true);
    assert.equal((await ask(s, viewer(1), { startsAt: FREE + 48 * HOUR })).code, 'limit');
  });

  test('messages the streamer only while notify_requests is on', async () => {
    const s = addStreamer();
    await ask(s, viewer(1));
    await tick();
    assert.equal(discord.sent.length, 1);
    assert.equal(discord.sent[0].userId, s.discord_user_id);
    assert.match(discord.sent[0].payload.embeds[0].description, /https:\/\/atleta\.test\/dashboard\/coaching/);
    const quiet = addStreamer({ settings: { notifyRequests: 0 } });
    discord.sent = [];
    await ask(quiet, viewer(1));
    await tick();
    assert.equal(discord.sent.length, 0);
  });

  test('a failing streamer message never throws', async () => {
    const s = addStreamer();
    discord.sendResult = { ok: false, reason: 'unreachable' };
    const { error } = console; console.error = () => {}; console.log = () => {};
    try { assert.equal((await ask(s, viewer(1))).ok, true); await tick(); } finally { console.error = error; delete console.log; }
  });
});

describe('answering', () => {
  async function waiting(s = addStreamer(), v = viewer(1)) {
    const r = await ask(s, v);
    discord.sent = [];
    return { s, id: r.booking.id, v };
  }

  test('accept confirms and messages the viewer in their language with the invite', async () => {
    const { s, id, v } = await waiting();
    const r = await svc.accept(s, id, { now: NOW });
    assert.equal(r.ok, true);
    assert.equal(r.booking.status, 'confirmed');
    assert.equal(r.booking.messageError, null);
    assert.equal(discord.sent[0].userId, v.discordUserId);
    assert.match(discord.sent[0].payload.embeds[0].description, /discord\.gg\/abc/);
    assert.match(discord.sent[0].payload.embeds[0].description, /Coach HQ/);
    assert.match(discord.sent[0].payload.embeds[0].title, new RegExp(s.twitch_display_name));
  });

  test('a refused message is kept as messageError and the booking stays confirmed', async () => {
    const { s, id } = await waiting();
    discord.sendResult = { ok: false, reason: 'unreachable' };
    const r = await svc.accept(s, id, { now: NOW });
    assert.equal(r.ok, true);
    assert.equal(r.booking.messageError, 'unreachable');
    assert.equal(db.getCoachingBooking(id, s.id).status, 'confirmed');
    assert.equal(db.getCoachingBooking(id, s.id).message_error, 'unreachable');
  });

  test('accept after the start answers too_late (Review Focus 4)', async () => {
    const { s, id } = await waiting();
    assert.deepEqual(await svc.accept(s, id, { now: FREE + 1 }), { ok: false, code: 'too_late' });
    assert.equal(db.getCoachingBooking(id, s.id).status, 'waiting');
  });

  test('accept twice answers not_waiting', async () => {
    const { s, id } = await waiting();
    await svc.accept(s, id, { now: NOW });
    assert.deepEqual(await svc.accept(s, id, { now: NOW }), { ok: false, code: 'not_waiting' });
    assert.deepEqual(await svc.decline(s, id, { now: NOW }), { ok: false, code: 'not_waiting' });
  });

  test('decline and cancel message the viewer', async () => {
    const a = await waiting();
    const d = await svc.decline(a.s, a.id, { now: NOW });
    assert.equal(d.booking.status, 'declined');
    assert.match(discord.sent[0].payload.embeds[0].title, /declined/);
    assert.match(discord.sent[0].payload.embeds[0].description, /atleta\.test\/coaching\/coach/);
    const b = await waiting();
    await svc.accept(b.s, b.id, { now: NOW });
    discord.sent = [];
    const c = await svc.cancel(b.s, b.id, { now: NOW });
    assert.equal(c.booking.status, 'cancelled');
    assert.match(discord.sent[0].payload.embeds[0].title, /cancelled/);
    assert.deepEqual(await svc.cancel(b.s, b.id, { now: NOW }), { ok: false, code: 'not_active' });
    const late = await waiting();
    assert.equal((await svc.cancel(late.s, late.id, { now: FREE })).code, 'too_late');
  });

  test('a booking id of another streamer answers not_found (Review Focus 4)', async () => {
    const { id } = await waiting();
    const other = addStreamer();
    for (const fn of ['accept', 'decline', 'cancel']) assert.deepEqual(await svc[fn](other, id, { now: NOW }), { ok: false, code: 'not_found' });
    assert.deepEqual(await svc.accept(other, 999999, { now: NOW }), { ok: false, code: 'not_found' });
  });

  test("withdraw refuses another viewer's booking with not_found, frees the time and messages the streamer (Review Focus 4)", async () => {
    const { s, id, v } = await waiting();
    assert.deepEqual(await svc.withdraw(s, viewer(9), id, { now: NOW }), { ok: false, code: 'not_found' });
    assert.deepEqual(await svc.withdraw(addStreamer(), v, id, { now: NOW }), { ok: false, code: 'not_found' });
    const r = await svc.withdraw(s, v, id, { now: NOW });
    assert.equal(r.ok, true);
    assert.equal(r.booking.status, 'withdrawn');
    await tick();
    assert.equal(discord.sent[0].userId, s.discord_user_id);
    assert.match(discord.sent[0].payload.embeds[0].title, /withdrew/);
    assert.equal((await ask(s, viewer(2))).ok, true);
    assert.deepEqual(await svc.withdraw(s, v, id, { now: NOW }), { ok: false, code: 'too_late' });
  });
});

describe('checkInvite', () => {
  test('records a dead invite and one to another server as 0, and asks Discord at most once an hour', async () => {
    const s = addStreamer();
    discord.invite = { ok: false, reason: 'unknown' };
    let set = await svc.checkInvite(s.id, { now: NOW });
    assert.equal(set.invite_ok, 0);
    assert.equal(discord.inviteCalls, 1);
    await svc.checkInvite(s.id, { now: NOW + 30 * 60e3 });
    assert.equal(discord.inviteCalls, 1);
    discord.invite = { ok: true, guildId: '123', guildName: 'HQ' };
    set = await svc.checkInvite(s.id, { now: NOW + 61 * 60e3 });
    assert.equal(set.invite_ok, 1);
    discord.invite = { ok: true, guildId: '999', guildName: 'Other' };
    set = await svc.checkInvite(s.id, { now: NOW + 61 * 60e3, force: true });
    assert.equal(set.invite_ok, 0);
    discord.invite = { ok: false, reason: 'unavailable' };
    set = await svc.checkInvite(s.id, { now: NOW + 10 * HOUR });
    assert.equal(set.invite_ok, 0);
    assert.equal(set.invite_checked_at, NOW + 61 * 60e3);
    assert.equal(await svc.checkInvite(addStreamer({ settings: null }).id, { now: NOW }), null);
  });
});

describe('cardData', () => {
  test('walks the setup steps twitch, server, hours', async () => {
    const noTwitch = addStreamer({ twitch: false, guild: false, settings: null });
    assert.equal(svc.cardData(noTwitch, { now: NOW, claimedGuildIds: [] }).setup, 'twitch');
    const noServer = addStreamer({ guild: false, settings: null });
    assert.equal(svc.cardData(noServer, { now: NOW, claimedGuildIds: [] }).setup, 'server');
    const noHours = addStreamer({ settings: null });
    assert.equal(svc.cardData(noHours, { now: NOW, claimedGuildIds: ['123'] }).setup, 'hours');
    const ready = addStreamer();
    const card = svc.cardData(ready, { now: NOW, claimedGuildIds: ['123'] });
    assert.equal(card.setup, null);
    assert.equal(card.open, true);
    assert.equal(card.bookable, true);
    assert.equal(card.inviteBroken, false);
    assert.equal(card.waitingCount, 0);
    assert.equal(card.next, null);
  });

  test('lists up to five waiting views, the count and the next confirmed session', async () => {
    const s = addStreamer();
    const ids = [];
    for (let i = 0; i < 7; i++) {
      const r = await ask(s, viewer(i), { minutes: 30, startsAt: i < 4 ? FREE + i * 30 * 60e3 : FREE + 24 * HOUR + (i - 4) * 30 * 60e3, note: i === 0 ? '<script>x</script>' : '' });
      if (r.ok) ids.push(r.booking.id);
    }
    assert.equal(ids.length, 7);
    await svc.accept(s, ids[1], { now: NOW });
    const card = svc.cardData(s, { now: NOW, claimedGuildIds: ['123'] });
    assert.equal(card.waitingCount, ids.length - 1);
    assert.equal(card.waiting.length, 5);
    assert.equal(card.waiting[0].note, '<script>x</script>');
    assert.equal(card.waiting[0].state, 'waiting');
    assert.equal(card.next.id, ids[1]);
    assert.equal(card.next.state, 'confirmed');
    assert.deepEqual(Object.keys(card.next).sort(), ['id', 'messageError', 'minutes', 'note', 'startsAt', 'state', 'viewerAvatar', 'viewerName', 'viewerUsername']);
    db.setCoachingOpen(s.id, 1);
    db.recordInviteCheck(s.id, 'abc', 0, NOW);
    const broken = svc.cardData(s, { now: NOW, claimedGuildIds: ['123'] });
    assert.equal(broken.inviteBroken, true);
    assert.equal(broken.bookable, false);
  });

  test('bookingView turns a stored waiting booking whose start has come into unanswered', () => {
    const v = svc.bookingView({ id: 1, starts_at: NOW - 1, minutes: 30, status: 'waiting', viewer_username: 'a', viewer_display_name: null, viewer_avatar: null, note: null, message_error: null }, NOW);
    assert.equal(v.state, 'unanswered');
    assert.equal(v.viewerName, 'a');
  });
});
