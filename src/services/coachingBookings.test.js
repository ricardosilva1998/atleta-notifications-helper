'use strict';

// The coaching booking service against the real src/db.js on in-memory SQLite and a fake src/discord.js.

const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) {
  process.env[key] = process.env[key] || 'test';
}
// The real escapeLinkText of src/discord.js (loading it needs the config's env; it does not log in).
const { escapeLinkText } = require('../discord');

const DB_FILE = path.join(__dirname, '..', 'db.js');
const SERVICE = path.join(__dirname, 'coachingBookings.js');
const MSG = path.join(__dirname, 'coachingMessages.js');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

let db;
let svc;
// The room hook (services/coachingRooms.js): records which bookings asked for a room.
const rooms = { made: [], url: null, async makeFor(id) { this.made.push(id); return this.url ? { url: this.url } : null; } };
let counter = 0;
const discord = {
  sent: [], sendResult: { ok: true }, member: true, memberCalls: 0, memberGate: null,
  invite: { ok: true, guildId: '123', guildName: 'HQ' }, inviteCalls: 0, inviteGate: null,
  async sendDirectMessage(userId, payload) { this.sent.push({ userId, payload }); return this.sendResult; },
  async isGuildMember() {
    this.memberCalls++;
    if (this.memberGate) await this.memberGate;
    if (this.member instanceof Error) throw this.member;
    return this.member;
  },
  async fetchInvite() { this.inviteCalls++; if (this.inviteGate) await this.inviteGate; return this.invite; },
  guildName() { return 'Coach HQ'; },
  escapeLinkText,
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
      if (request === './coachingRooms') return rooms;
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
  discord.sent = []; discord.sendResult = { ok: true }; discord.member = true; discord.memberCalls = 0; discord.memberGate = null;
  discord.inviteCalls = 0; discord.inviteGate = null;
  discord.invite = { ok: true, guildId: '123', guildName: 'HQ' };
  svc.forgetMembers(); // each test starts with no membership answer kept
  rooms.made = []; rooms.url = null;
});

const coachingRules = require('./coaching');
const HOURS = Array.from({ length: 7 }, (_, i) => ({ on: i < 5, start: 1080, end: 1320 }));
const NOW = Date.UTC(2026, 10, 2, 19, 0); // Monday 19:00 Lisbon (UTC+0)
const HOUR = 3600e3;
const FREE = NOW + 25 * HOUR; // Tuesday 20:00
const NEXT_FREE = FREE + 30 * 60e3;

// 30 min and 1 h free (accepted straight to confirmed), the longer lengths at the default prices.
const LENGTHS = { ...coachingRules.DEFAULT_LENGTHS, 30: { on: true, price: 0 }, 60: { on: true, price: 0 } };
function addStreamer({ settings = {}, guild = true, twitch = true, paypal = 'coach@example.com' } = {}) {
  const n = ++counter;
  const discordId = `3000000000000${String(n).padStart(5, '0')}`;
  const id = Number(db.db.prepare('INSERT INTO streamers (discord_user_id, discord_username, twitch_username, twitch_display_name, paypal_email) VALUES (?, ?, ?, ?, ?)')
    .run(discordId, `s${n}`, twitch ? `coach${n}` : null, twitch ? `Coach${n}` : null, paypal).lastInsertRowid);
  if (guild) db.db.prepare('INSERT INTO guilds (guild_id, streamer_id, guild_name) VALUES (?, ?, ?)').run('123', id, 'HQ');
  if (settings) {
    db.saveCoachingSettings(id, {
      timeZone: 'Europe/Lisbon', hours: HOURS, daysOff: [], guildId: '123', inviteCode: 'abc', whereText: 'Voice room',
      notifyRequests: 1, lang: 'en', lengths: LENGTHS, ...settings,
    });
  }
  return { id, discord_user_id: discordId, twitch_username: twitch ? `coach${n}` : null, twitch_display_name: twitch ? `Coach${n}` : null, paypal_email: paypal, donation_currency: 'EUR' };
}
const viewer = (id) => ({ discordUserId: `4000000000000000${id}`, username: `u${id}`, displayName: `U ${id}`, avatar: null });
const ask = (s, v, over = {}, opts = {}) => svc.request(s, v, { startsAt: FREE, minutes: 60, note: 'hi', lang: 'en', ...over }, { now: NOW, ...opts });
const tick = () => new Promise((r) => setImmediate(r));
const coaching = require('./coaching');

describe('request', () => {
  test('refuses join_first when the viewer is not in the server, and books with unverified when Discord cannot say', async () => {
    const s = addStreamer();
    discord.member = false;
    assert.deepEqual(await ask(s, viewer(1)), { ok: false, code: 'join_first' });
    discord.member = null;
    const r = await ask(s, viewer(1), {}, { now: NOW + 30e3 }); // Discord's answer is kept 30 s
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

  test('book then withdraw, again and again: the seventh request in 24 h answers too_many, after twelve messages to the streamer (Ruling 7)', async () => {
    const s = addStreamer();
    const v = viewer(1);
    for (let i = 0; i < coaching.MAX_REQUESTS_PER_DAY; i++) {
      const r = await ask(s, v);
      assert.equal(r.ok, true, `request ${i + 1}`);
      assert.equal((await svc.withdraw(s, v, r.booking.id, { now: NOW })).ok, true, `withdrawal ${i + 1}`);
    }
    assert.deepEqual(await ask(s, v), { ok: false, code: 'too_many' });
    await tick();
    assert.equal(discord.sent.filter((m) => m.userId === s.discord_user_id).length, 12, 'six requests and six withdrawals');
    assert.equal((await ask(s, viewer(2))).ok, true, 'another viewer still books');
    const nextDay = await ask(s, v, { startsAt: FREE + 24 * HOUR }, { now: NOW + 24 * HOUR });
    assert.equal(nextDay.ok, true, '24 h after the first request');
  });

  test('the time is checked before Discord is asked, and Discord is asked once per 30 s (Ruling 8)', async () => {
    const s = addStreamer();
    discord.member = false;
    assert.equal((await ask(s, viewer(1), { startsAt: FREE + 3 * HOUR })).code, 'bad_time', 'a time that is not free, first');
    assert.equal(discord.memberCalls, 0);
    assert.equal((await ask(s, viewer(1))).code, 'join_first');
    assert.equal((await ask(s, viewer(1))).code, 'join_first');
    assert.equal(discord.memberCalls, 1, 'the second request read the kept answer');
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
    assert.deepEqual(await svc.withdraw(s, v, id, { now: NOW }), { ok: false, code: 'not_active' }, 'withdrawn already');
  });

  test('withdrawing a booking already answered answers not_active; one that has started, too_late', async () => {
    const a = await waiting();
    await svc.decline(a.s, a.id, { now: NOW });
    assert.deepEqual(await svc.withdraw(a.s, a.v, a.id, { now: NOW }), { ok: false, code: 'not_active' }, 'declined');
    const b = await waiting(addStreamer(), viewer(2));
    await svc.accept(b.s, b.id, { now: NOW });
    await svc.cancel(b.s, b.id, { now: NOW });
    assert.deepEqual(await svc.withdraw(b.s, b.v, b.id, { now: NOW }), { ok: false, code: 'not_active' }, 'cancelled');
    const c = await waiting(addStreamer(), viewer(3));
    assert.deepEqual(await svc.withdraw(c.s, c.v, c.id, { now: FREE }), { ok: false, code: 'too_late' });
    assert.equal(db.getCoachingBooking(c.id, c.s.id).status, 'waiting');
    const d = await waiting(addStreamer(), viewer(4));
    const real = db.setCoachingBookingStatus;
    db.setCoachingBookingStatus = () => null; // the streamer answered in between
    try { assert.deepEqual(await svc.withdraw(d.s, d.v, d.id, { now: NOW }), { ok: false, code: 'not_active' }); } finally { db.setCoachingBookingStatus = real; }
  });

  test('a message that works after one that failed clears the warning', async () => {
    const { s, id } = await waiting();
    discord.sendResult = { ok: false, reason: 'unreachable' };
    await svc.accept(s, id, { now: NOW });
    assert.equal(db.getCoachingBooking(id, s.id).message_error, 'unreachable');
    discord.sendResult = { ok: true };
    const c = await svc.cancel(s, id, { now: NOW });
    assert.equal(c.ok, true);
    assert.equal(c.booking.messageError, null);
    assert.equal(db.getCoachingBooking(id, s.id).message_error, null);
  });
});

describe('membership', () => {
  test("Discord's answer is kept 30 s per server and viewer; \"I've joined\" asks again at most every 10 s (Ruling 8)", async () => {
    discord.member = false;
    assert.equal(await svc.isMember('123', 'u1', { now: NOW }), false);
    discord.member = true;
    assert.equal(await svc.isMember('123', 'u1', { now: NOW + 29e3 }), false, 'kept');
    assert.equal(discord.memberCalls, 1);
    assert.equal(await svc.isMember('124', 'u1', { now: NOW + 1 }), true, 'another server is asked about on its own');
    assert.equal(await svc.isMember('123', 'u2', { now: NOW + 1 }), true, 'and another viewer');
    assert.equal(discord.memberCalls, 3);
    assert.equal(await svc.isMember('123', 'u1', { now: NOW + 30e3 }), true, 'asked again after 30 s');
    assert.equal(discord.memberCalls, 4);
    discord.member = false;
    assert.equal(await svc.isMember('123', 'u1', { now: NOW + 31e3, recheck: true }), false, 'a recheck asks at once');
    assert.equal(discord.memberCalls, 5);
    discord.member = true;
    assert.equal(await svc.isMember('123', 'u1', { now: NOW + 40e3, recheck: true }), false, 'a second recheck within 10 s reads the kept answer');
    assert.equal(discord.memberCalls, 5);
    assert.equal(await svc.isMember('123', 'u1', { now: NOW + 41e3, recheck: true }), true);
    assert.equal(discord.memberCalls, 6);
  });

  test('a lookup in progress is shared, and one that throws reads null', async () => {
    let release;
    discord.memberGate = new Promise((r) => { release = r; });
    const both = Promise.all([svc.isMember('123', 'u3', { now: NOW }), svc.isMember('123', 'u3', { now: NOW + 1 })]);
    await tick();
    release();
    assert.deepEqual(await both, [true, true]);
    assert.equal(discord.memberCalls, 1);
    discord.memberGate = null;
    discord.member = new Error('gateway');
    assert.equal(await svc.isMember('123', 'u4', { now: NOW }), null);
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
    assert.equal(set.invite_ok, 0, 'no answer keeps the last one');
    assert.equal(set.invite_checked_at, NOW + 10 * HOUR, 'and the next question waits an hour (Ruling 9)');
    const calls = discord.inviteCalls;
    await svc.checkInvite(s.id, { now: NOW + 10 * HOUR + 30 * 60e3 });
    assert.equal(discord.inviteCalls, calls);
    assert.equal(await svc.checkInvite(addStreamer({ settings: null }).id, { now: NOW }), null);
  });

  test('one check at a time per streamer: a second call gets the answer of the one in progress (Ruling 9)', async () => {
    const s = addStreamer();
    let release;
    discord.inviteGate = new Promise((r) => { release = r; });
    const first = svc.checkInvite(s.id, { now: NOW });
    const second = svc.checkInvite(s.id, { now: NOW, force: true });
    await tick();
    assert.equal(discord.inviteCalls, 1);
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.deepEqual([a.invite_ok, b.invite_ok], [1, 1]);
    assert.equal(discord.inviteCalls, 1);
    discord.inviteGate = null;
    await svc.checkInvite(s.id, { now: NOW, force: true });
    assert.equal(discord.inviteCalls, 2, 'once it is over, the next one asks');
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
    assert.deepEqual(Object.keys(card.next).sort(), [
      'currency', 'id', 'messageError', 'minutes', 'note', 'paid', 'paidAmountCents', 'paidCurrency', 'payBy', 'paymentIssue',
      'priceCents', 'roomUrl', 'startsAt', 'state', 'viewerAvatar', 'viewerName', 'viewerUsername',
    ]);
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

describe('lengths, prices and the accept change (planning decisions 3, 5, 6, 9)', () => {
  const MIN = 60e3;
  // 2 h at the default price, EUR 45.00.
  const askPaid = (s, v, over = {}, opts = {}) => ask(s, v, { minutes: 120, ...over }, opts);

  test('a request stores the length\'s price and the tip page\'s currency; a length switched off or paid without PayPal is refused', async () => {
    const s = addStreamer();
    const r = await askPaid(s, viewer(1));
    assert.equal(r.ok, true);
    assert.equal(r.booking.price_cents, 4500);
    assert.equal(r.booking.currency, 'EUR');
    assert.equal(r.booking.status, 'waiting');
    const off = addStreamer({ settings: { lengths: { ...coachingRules.DEFAULT_LENGTHS } } }); // 30 min off by default
    assert.equal((await ask(off, viewer(2), { minutes: 30 })).code, 'bad_length');
    const noPaypal = addStreamer({ paypal: null });
    assert.equal((await askPaid(noPaypal, viewer(3))).code, 'no_paypal');
    assert.equal((await ask(noPaypal, viewer(3))).ok, true, 'a free length needs no PayPal');
  });

  test('accepting a paid request waits for payment until min(accept + 2 h, start - 15 min), and messages the viewer to pay', async () => {
    const s = addStreamer();
    const r = await askPaid(s, viewer(1));
    discord.sent = [];
    const a = await svc.accept(s, r.booking.id, { now: NOW });
    assert.equal(a.ok, true);
    assert.equal(a.booking.status, 'awaiting_payment');
    assert.equal(a.booking.accepted_at, NOW);
    assert.equal(a.booking.pay_by, NOW + 2 * HOUR, 'two hours: the start is a day away');
    assert.equal(rooms.made.length, 0, 'no room before the payment');
    const msg = discord.sent.find((m) => m.userId === viewer(1).discordUserId);
    assert.match(msg.payload.embeds[0].title, /pay to confirm/);
    assert.match(msg.payload.embeds[0].description, /€45\.00/);
    assert.ok(coachingRules.HOLDING.includes('awaiting_payment'));
    // Close to the start, the deadline is 15 minutes before it.
    const s2 = addStreamer();
    const r2 = await askPaid(s2, viewer(2));
    const late = FREE - 60 * MIN;
    const a2 = await svc.accept(s2, r2.booking.id, { now: late });
    assert.equal(a2.booking.pay_by, FREE - 15 * MIN);
  });

  test('a paid request is refused at 24 minutes before its start (too_close) and accepted at 26; without PayPal it is no_paypal', async () => {
    const s = addStreamer();
    const r = await askPaid(s, viewer(1));
    const at24 = await svc.accept(s, r.booking.id, { now: FREE - 24 * MIN });
    assert.deepEqual(at24, { ok: false, code: 'too_close' });
    assert.equal(db.getCoachingBooking(r.booking.id, s.id).status, 'waiting', 'still waiting: the streamer can decline it');
    const at26 = await svc.accept(s, r.booking.id, { now: FREE - 26 * MIN });
    assert.equal(at26.ok, true);
    assert.equal(at26.booking.pay_by, FREE - 15 * MIN);

    const s2 = addStreamer();
    const r2 = await askPaid(s2, viewer(2));
    const noPaypal = { ...s2, paypal_email: null }; // the email removed after the request
    assert.deepEqual(await svc.accept(noPaypal, r2.booking.id, { now: NOW }), { ok: false, code: 'no_paypal' });
    assert.equal((await svc.decline(noPaypal, r2.booking.id, { now: NOW })).ok, true, 'decline still works');
  });

  test('a free length is confirmed on accept, up to its start, and asks for its room', async () => {
    const s = addStreamer();
    const r = await ask(s, viewer(1)); // 1 h, free in these tests
    rooms.url = 'https://discord.com/channels/123/456';
    discord.sent = [];
    const a = await svc.accept(s, r.booking.id, { now: FREE - 5 * MIN });
    assert.equal(a.ok, true);
    assert.equal(a.booking.status, 'confirmed');
    assert.equal(a.booking.pay_by, null);
    assert.deepEqual(rooms.made, [r.booking.id]);
    assert.match(discord.sent[0].payload.embeds[0].description, /Your room: https:\/\/discord\.com\/channels\/123\/456/);
  });

  test('a booking made before prices (no price) is accepted as free', async () => {
    const s = addStreamer();
    const made = db.createCoachingBooking({ streamerId: s.id, viewer: viewer(1), startsAt: FREE, minutes: 120, note: '', lang: 'en', now: NOW });
    assert.equal(made.booking.price_cents, null);
    const a = await svc.accept(s, made.booking.id, { now: NOW });
    assert.equal(a.booking.status, 'confirmed');
  });

  test('Cancel and Withdraw of a paid booking answer paid and change nothing; before payment both work', async () => {
    const s = addStreamer();
    const v = viewer(1);
    const r = await askPaid(s, v);
    await svc.accept(s, r.booking.id, { now: NOW });
    const rec = db.recordCoachingPayment({ bookingId: r.booking.id, orderId: 'ORDERPAID0001', captureId: 'CAPPAID0001', amountCents: 4500, currency: 'EUR', now: NOW + MIN });
    assert.equal(rec.result, 'recorded');
    assert.deepEqual(await svc.cancel(s, r.booking.id, { now: NOW + 2 * MIN }), { ok: false, code: 'paid' });
    assert.deepEqual(await svc.withdraw(s, v, r.booking.id, { now: NOW + 2 * MIN }), { ok: false, code: 'paid' });
    const row = db.getCoachingBooking(r.booking.id, s.id);
    assert.equal(row.status, 'confirmed');
    assert.ok(row.paid_at);

    const r2 = await askPaid(s, viewer(2), { startsAt: FREE + 24 * HOUR });
    await svc.accept(s, r2.booking.id, { now: NOW });
    assert.equal((await svc.withdraw(s, viewer(2), r2.booking.id, { now: NOW })).booking.status, 'withdrawn', 'awaiting payment: Withdraw works');
    const r3 = await askPaid(s, viewer(3), { startsAt: FREE + 48 * HOUR });
    await svc.accept(s, r3.booking.id, { now: NOW });
    assert.equal((await svc.cancel(s, r3.booking.id, { now: NOW })).booking.status, 'cancelled', 'awaiting payment: Cancel works');
  });

  test('a payment recorded between the check and the update wins: Cancel answers paid', async () => {
    const s = addStreamer();
    const r = await askPaid(s, viewer(1));
    await svc.accept(s, r.booking.id, { now: NOW });
    const real = db.getCoachingBooking;
    let calls = 0;
    db.getCoachingBooking = (...args) => {
      const row = real(...args);
      if (++calls === 1) {
        db.recordCoachingPayment({ bookingId: r.booking.id, orderId: 'ORDERRACE0001', captureId: 'CAPRACE0001', amountCents: 4500, currency: 'EUR', now: NOW });
      }
      return row; // the row as it was read before the payment
    };
    try {
      assert.deepEqual(await svc.cancel(s, r.booking.id, { now: NOW }), { ok: false, code: 'paid' });
    } finally { db.getCoachingBooking = real; }
    assert.equal(db.getCoachingBooking(r.booking.id, s.id).status, 'confirmed');
  });

  test('offeredLengths lists the lengths that are on, a paid one only with a PayPal email', () => {
    const settings = { lengths: { ...coachingRules.DEFAULT_LENGTHS, 30: { on: true, price: 0 } } };
    assert.deepEqual(svc.offeredLengths({ paypal_email: 'a@b.c' }, settings).map((l) => [l.minutes, l.priceCents]),
      [[30, 0], [60, 2500], [120, 4500], [180, 6000], [240, 7000], [300, 8000]]);
    assert.deepEqual(svc.offeredLengths({ paypal_email: null }, settings).map((l) => l.minutes), [30]);
  });
});
