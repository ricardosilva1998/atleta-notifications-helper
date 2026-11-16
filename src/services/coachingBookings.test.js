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
const rooms = {
  made: [], removed: [], rescheduled: [], url: null,
  async reschedule(id) { this.rescheduled.push(id); return this.url ? { url: this.url } : null; },
  async makeFor(id) { this.made.push(id); return this.url ? { url: this.url } : null; },
  async removeFor(id) { this.removed.push(id); return true; },
  roomUrlOf(room) { return `https://discord.com/channels/${room.guild_id}/${room.channel_id}`; },
};
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
  rooms.made = []; rooms.removed = []; rooms.rescheduled = []; rooms.url = null;
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
    const c = await svc.cancel(b.s, b.id, { reason: 'I am ill', now: NOW });
    assert.equal(c.booking.status, 'cancelled');
    assert.match(discord.sent[0].payload.embeds[0].title, /cancelled/);
    assert.deepEqual(await svc.cancel(b.s, b.id, { reason: 'I am ill', now: NOW }), { ok: false, code: 'not_active' });
    const late = await waiting();
    assert.equal((await svc.cancel(late.s, late.id, { reason: 'I am ill', now: FREE })).code, 'too_late');
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
    await svc.cancel(b.s, b.id, { reason: 'I am ill', now: NOW });
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
    const c = await svc.cancel(s, id, { reason: 'I am ill', now: NOW });
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
      'cancelReason', 'currency', 'id', 'messageError', 'minutes', 'note', 'originalStartsAt', 'paid', 'paidAmountCents', 'paidCurrency', 'payBy',
      'paymentIssue', 'priceCents', 'proposal', 'refundPending', 'refundState', 'rescheduleEndsAt', 'rescheduleStartedAt', 'roomError', 'roomUrl', 'startsAt', 'state',
      'transcriptStatus', 'viewerAvatar', 'viewerName', 'viewerUsername',
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

  test('Withdraw of a paid booking answers paid and changes nothing; before payment Withdraw and Cancel work', async () => {
    const s = addStreamer();
    const v = viewer(1);
    const r = await askPaid(s, v);
    await svc.accept(s, r.booking.id, { now: NOW });
    const rec = db.recordCoachingPayment({ bookingId: r.booking.id, orderId: 'ORDERPAID0001', captureId: 'CAPPAID0001', amountCents: 4500, currency: 'EUR', now: NOW + MIN });
    assert.equal(rec.result, 'recorded');
    assert.deepEqual(await svc.withdraw(s, v, r.booking.id, { now: NOW + 2 * MIN }), { ok: false, code: 'paid' });
    const row = db.getCoachingBooking(r.booking.id, s.id);
    assert.equal(row.status, 'confirmed');
    assert.ok(row.paid_at);

    const r2 = await askPaid(s, viewer(2), { startsAt: FREE + 24 * HOUR });
    await svc.accept(s, r2.booking.id, { now: NOW });
    assert.equal((await svc.withdraw(s, viewer(2), r2.booking.id, { now: NOW })).booking.status, 'withdrawn', 'awaiting payment: Withdraw works');
    const r3 = await askPaid(s, viewer(3), { startsAt: FREE + 48 * HOUR });
    await svc.accept(s, r3.booking.id, { now: NOW });
    assert.equal((await svc.cancel(s, r3.booking.id, { reason: 'I am ill', now: NOW })).booking.status, 'cancelled', 'awaiting payment: Cancel works');
  });

  test('a payment recorded between the check and the update is caught by the cancel: it owes a refund', async () => {
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
      const done = await svc.cancel(s, r.booking.id, { reason: 'I am ill', now: NOW });
      assert.equal(done.ok, true);
      assert.equal(done.refundPending, true, 'the payment that landed in between owes a refund');
    } finally { db.getCoachingBooking = real; }
    assert.equal(db.getCoachingBooking(r.booking.id, s.id).status, 'cancelled');
    assert.equal(db.getCoachingPayment('ORDERRACE0001').refund_status, 'pending');
  });

  test('offeredLengths lists the lengths that are on, a paid one only with a PayPal email', () => {
    const settings = { lengths: { ...coachingRules.DEFAULT_LENGTHS, 30: { on: true, price: 0 } } };
    assert.deepEqual(svc.offeredLengths({ paypal_email: 'a@b.c' }, settings).map((l) => [l.minutes, l.priceCents]),
      [[30, 0], [60, 2500], [120, 4500], [180, 6000], [240, 7000], [300, 8000]]);
    assert.deepEqual(svc.offeredLengths({ paypal_email: null }, settings).map((l) => l.minutes), [30]);
  });
});

describe('cancel with a reason, the refund step and the payer details', () => {
  const MIN = 60e3;
  const PAYER = { name: 'Pat Payer', email: 'pat@example.com', payerId: 'PAYERID001' };
  let orderSeq = 0;
  async function paidConfirmed(s = addStreamer(), v = viewer(1), orderId = `ORDERCANCEL${String(++orderSeq).padStart(3, '0')}`) {
    const r = await ask(s, v, { minutes: 120 });
    await svc.accept(s, r.booking.id, { now: NOW });
    const rec = db.recordCoachingPayment({ bookingId: r.booking.id, orderId, captureId: `CAP${orderId}`, amountCents: 4500, currency: 'EUR', now: NOW + MIN, payer: PAYER });
    assert.equal(rec.result, 'recorded');
    discord.sent = [];
    return { s, v, id: r.booking.id, orderId };
  }

  test('a cancel needs a reason of 1 to 500 characters: nothing changes without one', async () => {
    const s = addStreamer();
    const r = await ask(s, viewer(1));
    await svc.accept(s, r.booking.id, { now: NOW });
    for (const reason of [undefined, null, '', '   \n ', 'x'.repeat(501), 42]) {
      assert.deepEqual(await svc.cancel(s, r.booking.id, { reason, now: NOW }), { ok: false, code: 'bad_reason' });
    }
    assert.equal(db.getCoachingBooking(r.booking.id, s.id).status, 'confirmed');
    const ok = await svc.cancel(s, r.booking.id, { reason: `${'x'.repeat(250)}\n${'y'.repeat(249)}`, now: NOW });
    assert.equal(ok.ok, true);
    assert.equal(db.getCoachingBooking(r.booking.id, s.id).cancel_reason.length, 500, 'line breaks become spaces');
    assert.ok(!db.getCoachingBooking(r.booking.id, s.id).cancel_reason.includes('\n'));
  });

  test('cancelling a paid confirmed session: cancelled, room removed, payment pending, the viewer is told the reason and the refund', async () => {
    const { s, v, id, orderId } = await paidConfirmed();
    const done = await svc.cancel(s, id, { reason: 'I have the flu, sorry', now: NOW + 2 * MIN });
    assert.equal(done.ok, true);
    assert.equal(done.refundPending, true);
    assert.equal(done.booking.status, 'cancelled');
    assert.deepEqual(rooms.removed, [id]);
    assert.equal(db.getCoachingPayment(orderId).refund_status, 'pending');
    assert.equal(db.getCoachingPayment(orderId).payer_email, 'pat@example.com');
    assert.equal(discord.sent[0].userId, v.discordUserId);
    const embed = discord.sent[0].payload.embeds[0];
    assert.match(embed.title, /cancelled/);
    assert.match(embed.description, /I have the flu, sorry/);
    assert.match(embed.description, /refund you/);
  });

  test('an unpaid cancel owes nothing; a booking after its start cannot be cancelled (too_late), a rescheduling one can', async () => {
    const s = addStreamer();
    const r = await ask(s, viewer(1));
    await svc.accept(s, r.booking.id, { now: NOW });
    const done = await svc.cancel(s, r.booking.id, { reason: 'Clash', now: NOW });
    assert.equal(done.refundPending, false);
    assert.doesNotMatch(discord.sent.at(-1).payload.embeds[0].description, /refund/);
    const late = await ask(s, viewer(2), { startsAt: NEXT_FREE + 24 * HOUR });
    await svc.accept(s, late.booking.id, { now: NOW });
    assert.equal((await svc.cancel(s, late.booking.id, { reason: 'Clash', now: NEXT_FREE + 25 * HOUR })).code, 'too_late');
    const re = db.startCoachingReschedule(late.booking.id, s.id, 'ask', null, NOW + MIN);
    assert.equal(re.ok, true);
    const after = await svc.cancel(s, late.booking.id, { reason: 'Clash', now: NEXT_FREE + 25 * HOUR });
    assert.equal(after.ok, true);
    assert.equal(after.booking.status, 'cancelled');
  });

  test('Discord down never fails a cancel: the failure is kept as messageError', async () => {
    const { s, id } = await paidConfirmed();
    discord.sendResult = { ok: false, reason: 'unreachable' };
    const done = await svc.cancel(s, id, { reason: 'Flu', now: NOW + 2 * MIN });
    assert.equal(done.ok, true);
    assert.equal(done.booking.messageError, 'unreachable');
    assert.equal(db.getCoachingBooking(id, s.id).status, 'cancelled');
  });

  test('a cancelled booking shows no room link, only a confirmed one does', async () => {
    const { s, id } = await paidConfirmed();
    db.createCoachingRoom({ bookingId: id, streamerId: s.id, guildId: '123', categoryId: '5', closeAt: NOW + 9 * HOUR, now: NOW });
    db.updateCoachingRoom(id, { channel_id: '555', role_id: '666', state: 'open' }, NOW);
    assert.match(svc.bookingViews([db.getCoachingBooking(id, s.id)], NOW)[0].roomUrl, /discord\.com\/channels\/123\/555/);
    await svc.cancel(s, id, { reason: 'Flu', now: NOW + 2 * MIN });
    const row = db.getCoachingBooking(id, s.id);
    assert.equal(svc.bookingViews([row], NOW)[0].roomUrl, null);
    assert.equal(svc.bookingViews([row], NOW, { forViewer: true })[0].roomUrl, null);
  });

  test('the coach sees the payer and each refund; no viewer view carries payer details or the payments', async () => {
    const { s, id, orderId } = await paidConfirmed();
    await svc.cancel(s, id, { reason: 'Flu', now: NOW + 2 * MIN });
    const row = db.getCoachingBooking(id, s.id);
    const coachView = svc.bookingViews([row], NOW)[0];
    assert.equal(coachView.cancelReason, 'Flu');
    assert.equal(coachView.refundPending, true);
    assert.deepEqual(coachView.refunds, [{
      orderId, amountCents: 4500, currency: 'EUR', payerName: 'Pat Payer', payerEmail: 'pat@example.com',
      captureId: `CAP${orderId}`, status: 'pending', reason: 'cancelled',
    }]);
    const viewerViews = [svc.bookingViews([row], NOW, { forViewer: true })[0], svc.bookingView(row, NOW, null, { forViewer: true })];
    for (const view of viewerViews) {
      const text = JSON.stringify(view);
      assert.doesNotMatch(text, /pat@example|Pat Payer|PAYERID001|refunds|payerEmail|CAPORDER/);
      assert.equal(view.refundPending, true, 'only the flag, for "your coach will refund you"');
      assert.equal(view.cancelReason, 'Flu');
    }
  });

  test('cardData counts the pending refunds', async () => {
    const { s, id } = await paidConfirmed();
    assert.equal(svc.cardData(s, { now: NOW, claimedGuildIds: ['123'] }).refundsPending, 0);
    await svc.cancel(s, id, { reason: 'Flu', now: NOW + 2 * MIN });
    assert.equal(svc.cardData(s, { now: NOW, claimedGuildIds: ['123'] }).refundsPending, 1);
  });

  test('the dashboard card never carries the payer\'s PayPal details, and no DM to the viewer does', async () => {
    const { s, id } = await paidConfirmed();
    discord.sent = [];
    await svc.cancel(s, id, { reason: 'Flu', now: NOW + 2 * MIN });
    const dm = JSON.stringify(discord.sent);
    assert.doesNotMatch(dm, /pat@example|Pat Payer|PAYERID001|CAPORDER/);
    const card = JSON.stringify(svc.cardData(s, { now: NOW, claimedGuildIds: ['123'] }));
    assert.doesNotMatch(card, /pat@example|Pat Payer|PAYERID001|payerEmail|"refunds"/);
    const open = await paidConfirmed();
    assert.doesNotMatch(JSON.stringify(svc.cardData(open.s, { now: NOW, claimedGuildIds: ['123'] })), /pat@example|Pat Payer|payerEmail|"refunds"/);
  });

  test('Refunded: only that payment\'s streamer, only from pending, and the viewer is messaged', async () => {
    const { s, v, id, orderId } = await paidConfirmed();
    await svc.cancel(s, id, { reason: 'Flu', now: NOW + 2 * MIN });
    discord.sent = [];
    const other = addStreamer();
    assert.deepEqual(await svc.markRefunded(other, orderId, { now: NOW + 3 * MIN }), { ok: false, code: 'not_found' });
    assert.deepEqual(await svc.markRefunded(s, 'NOSUCHORDER01', { now: NOW + 3 * MIN }), { ok: false, code: 'not_found' });
    assert.deepEqual(await svc.markRefunded(s, 'bad id!', { now: NOW + 3 * MIN }), { ok: false, code: 'not_found' });
    assert.equal(db.getCoachingPayment(orderId).refund_status, 'pending');
    assert.equal(discord.sent.length, 0);
    const done = await svc.markRefunded(s, orderId, { now: NOW + 3 * MIN });
    assert.equal(done.ok, true);
    assert.equal(done.payment.refund_status, 'refunded');
    assert.equal(db.getCoachingPayment(orderId).refunded_at, NOW + 3 * MIN);
    assert.equal(discord.sent[0].userId, v.discordUserId);
    assert.match(discord.sent[0].payload.embeds[0].title, /refunded your coaching session/);
    assert.deepEqual(await svc.markRefunded(s, orderId, { now: NOW + 4 * MIN }), { ok: false, code: 'not_pending' });
    assert.equal(svc.bookingViews([db.getCoachingBooking(id, s.id)], NOW)[0].refundState, 'refunded');
  });

  test('Refunded with Discord down still records it', async () => {
    const { s, id, orderId } = await paidConfirmed();
    await svc.cancel(s, id, { reason: 'Flu', now: NOW + 2 * MIN });
    discord.sendResult = { ok: false, reason: 'not_ready' };
    const done = await svc.markRefunded(s, orderId, { now: NOW + 3 * MIN });
    assert.equal(done.ok, true);
    assert.equal(done.booking.messageError, 'not_ready');
    assert.equal(db.getCoachingPayment(orderId).refund_status, 'refunded');
  });
});

describe('reschedule (the coach starts it; a proposal is held like a booking)', () => {
  const MIN = 60e3;
  const SAT_10 = NOW + 111 * HOUR; // Saturday 10:00: outside the weekly hours
  const PAYER = { name: 'Pat Payer', email: 'pat@example.com', payerId: 'PAYERID001' };
  let seq = 0;
  async function confirmed({ s = addStreamer(), v = viewer(1), startsAt = FREE, minutes = 60 } = {}) {
    const r = await ask(s, v, { startsAt, minutes });
    const done = await svc.accept(s, r.booking.id, { now: NOW });
    assert.equal(done.booking.status, 'confirmed');
    discord.sent = [];
    return { s, v, id: r.booking.id };
  }
  async function paidConfirmed() {
    const s = addStreamer();
    const v = viewer(1);
    const r = await ask(s, v, { minutes: 120 });
    await svc.accept(s, r.booking.id, { now: NOW });
    const orderId = `ORDERRESCH${String(++seq).padStart(3, '0')}`;
    assert.equal(db.recordCoachingPayment({ bookingId: r.booking.id, orderId, captureId: `CAP${orderId}`, amountCents: 4500, currency: 'EUR', now: NOW + MIN, payer: PAYER }).result, 'recorded');
    discord.sent = [];
    return { s, v, id: r.booking.id, orderId };
  }
  const row = (s, id) => db.getCoachingBooking(id, s.id);
  const to = (userId) => discord.sent.filter((m) => m.userId === userId);
  // The tick works on every rescheduling booking in the shared database: each test starts with none from another.
  beforeEach(() => { db.db.prepare("UPDATE coaching_bookings SET status = 'cancelled' WHERE status = 'rescheduling'").run(); });

  test('way 1: the coach proposes a time (outside the hours too); the original time is free at once; the viewer is told', async () => {
    const { s, v, id } = await confirmed();
    const r = await svc.startReschedule(s, id, { way: 'propose', startsAt: SAT_10, note: 'Sorry, a clash', now: NOW + MIN });
    assert.equal(r.ok, true);
    assert.equal(r.booking.status, 'rescheduling');
    const view = svc.bookingView(row(s, id), NOW + MIN, null, { forViewer: true });
    assert.deepEqual(view.proposal, { startsAt: SAT_10, by: 'coach', note: 'Sorry, a clash', at: NOW + MIN });
    assert.equal(view.rescheduleEndsAt, NOW + MIN + coaching.RESCHEDULE_WINDOW_MS);
    const msg = to(v.discordUserId)[0].payload.embeds[0];
    assert.match(msg.title, /proposed a new time/);
    assert.match(msg.description, /Sorry, a clash/);
    assert.match(msg.description, new RegExp(`booking=${id}`));
    const other = await ask(s, viewer(2)); // the original time is released: someone else can book it
    assert.equal(other.ok, true);
  });

  test('way 2: the viewer is sent a link and picks; the picker never offers the original or a held time; the coach always hears', async () => {
    const s = addStreamer({ settings: { notifyRequests: 0 } });
    const { v, id } = await confirmed({ s });
    const held = await ask(s, viewer(2), { startsAt: FREE + 24 * HOUR });
    await svc.accept(s, held.booking.id, { now: NOW });
    discord.sent = [];
    const r = await svc.startReschedule(s, id, { way: 'ask', now: NOW + MIN });
    assert.equal(r.ok, true);
    assert.match(to(v.discordUserId)[0].payload.embeds[0].title, /pick a new time/);
    assert.match(to(v.discordUserId)[0].payload.embeds[0].description, new RegExp(`/coach\\d+\\?booking=${id}`));
    const { starts } = svc.viewerStarts(s, v, id, { now: NOW + MIN });
    assert.ok(starts.length > 0);
    assert.ok(!starts.includes(FREE), 'never the original time');
    assert.ok(!starts.includes(FREE + 24 * HOUR), 'never a held time');
    assert.ok(!starts.includes(FREE + 24 * HOUR - 30 * MIN), 'nothing overlapping a held time');
    assert.equal((await svc.viewerPropose(s, v, id, { startsAt: FREE, now: NOW + MIN })).code, 'bad_time');
    assert.equal((await svc.viewerPropose(s, v, id, { startsAt: FREE + 24 * HOUR, now: NOW + MIN })).code, 'bad_time');
    assert.equal((await svc.viewerPropose(s, v, id, { startsAt: SAT_10, now: NOW + MIN })).code, 'bad_time', 'outside the hours');
    const pick = starts[0];
    assert.equal((await svc.viewerPropose(s, v, id, { startsAt: pick, note: 'x'.repeat(301), now: NOW + MIN })).code, 'bad_note');
    const ok = await svc.viewerPropose(s, v, id, { startsAt: pick, note: 'This works', now: NOW + MIN });
    assert.equal(ok.ok, true);
    await tick();
    const told = to(s.discord_user_id)[0].payload.embeds[0];
    assert.match(told.title, /proposed a new time/, 'the coach is told with "Message me about new requests" off');
    assert.match(told.description, /This works/);
  });

  test('a back and forth over several rounds; only the side that did not propose accepts; the room follows the agreement', async () => {
    const { s, v, id } = await confirmed();
    const a = NOW + 40 * HOUR;
    const b = NOW + 48 * HOUR;
    const c = NOW + 42 * HOUR;
    assert.equal((await svc.startReschedule(s, id, { way: 'propose', startsAt: a, now: NOW + MIN })).ok, true);
    assert.deepEqual(await svc.coachAccept(s, id, { now: NOW + MIN }), { ok: false, code: 'not_yours_to_answer' });
    assert.equal((await svc.viewerPropose(s, v, id, { startsAt: b, now: NOW + 2 * MIN })).ok, true);
    assert.deepEqual(await svc.viewerAccept(s, v, id, { now: NOW + 2 * MIN }), { ok: false, code: 'not_yours_to_answer' });
    assert.equal((await svc.coachPropose(s, id, { startsAt: c, note: 'How about this', now: NOW + 3 * MIN })).ok, true);
    assert.match(to(v.discordUserId).pop().payload.embeds[0].title, /another time/);
    assert.equal(row(s, id).proposal_starts_at, c, 'only the latest proposal counts');
    assert.equal(row(s, id).starts_at, FREE, 'the session keeps its time until agreed');
    discord.sent = [];
    rooms.url = 'https://discord.com/channels/1/2';
    const done = await svc.viewerAccept(s, v, id, { now: NOW + 4 * MIN });
    assert.equal(done.ok, true);
    assert.equal(done.booking.status, 'confirmed');
    assert.equal(done.booking.starts_at, c);
    assert.deepEqual(rooms.rescheduled, [id]);
    assert.match(to(v.discordUserId)[0].payload.embeds[0].description, /discord\.com\/channels\/1\/2/);
    assert.match(to(v.discordUserId)[0].payload.embeds[0].title, /new time/);
    assert.match(to(s.discord_user_id)[0].payload.embeds[0].title, /New time agreed/);
    assert.deepEqual(await svc.viewerAccept(s, v, id, { now: NOW + 5 * MIN }), { ok: false, code: 'not_rescheduling' });
  });

  test('the coach may propose the original time and times outside the hours; never under an hour, past 14 days or a held time', async () => {
    const s = addStreamer();
    const { id } = await confirmed({ s });
    const held = await ask(s, viewer(2), { startsAt: FREE + 24 * HOUR });
    await svc.accept(s, held.booking.id, { now: NOW });
    const { starts } = svc.coachStarts(s, id, { now: NOW });
    assert.ok(starts.includes(FREE), 'the original time');
    assert.ok(starts.includes(SAT_10), 'outside the hours');
    assert.ok(!starts.includes(FREE + 24 * HOUR));
    assert.ok(starts.every((t) => t >= NOW + HOUR && t <= NOW + 14 * 24 * HOUR));
    assert.equal((await svc.startReschedule(s, id, { way: 'propose', startsAt: NOW + 30 * MIN, now: NOW })).code, 'bad_time');
    assert.equal((await svc.startReschedule(s, id, { way: 'propose', startsAt: FREE + 24 * HOUR, now: NOW })).code, 'bad_time');
    assert.equal((await svc.startReschedule(s, id, { way: 'propose', startsAt: NOW + 15 * 24 * HOUR, now: NOW })).code, 'bad_time');
    assert.equal((await svc.startReschedule(s, id, { way: 'nope', now: NOW })).code, 'bad_way');
    assert.equal(row(s, id).status, 'confirmed', 'nothing changed');
    assert.equal((await svc.startReschedule(s, id, { way: 'propose', startsAt: FREE, now: NOW })).ok, true, 'the original time is allowed for the coach');
  });

  test('only a confirmed session before its start can be rescheduled; another coach and another viewer get not_found', async () => {
    const s = addStreamer();
    const { v, id } = await confirmed({ s });
    const waiting = await ask(s, viewer(2), { startsAt: FREE + 24 * HOUR });
    assert.equal((await svc.startReschedule(s, waiting.booking.id, { way: 'ask', now: NOW })).code, 'not_confirmed');
    assert.equal((await svc.startReschedule(s, id, { way: 'ask', now: FREE })).code, 'not_confirmed');
    const other = addStreamer();
    assert.equal((await svc.startReschedule(other, id, { way: 'ask', now: NOW })).code, 'not_found');
    assert.equal((await svc.startReschedule(s, id, { way: 'ask', now: NOW })).ok, true);
    assert.equal((await svc.viewerPropose(s, viewer(9), id, { startsAt: NOW + 40 * HOUR, now: NOW })).code, 'not_found');
    assert.equal((await svc.viewerAccept(s, viewer(9), id, { now: NOW })).code, 'not_found');
    assert.equal(svc.viewerStarts(s, viewer(9), id, { now: NOW }).code, 'not_found');
    assert.equal(svc.coachStarts(other, id, { now: NOW }).code, 'not_found');
    assert.equal((await svc.coachAccept(other, id, { now: NOW })).code, 'not_found');
    assert.equal(svc.viewerStarts(s, v, waiting.booking.id, { now: NOW }).code, 'not_found', 'not their booking');
  });

  test('two proposals for overlapping times: one wins; a proposal is held against new requests', async () => {
    const s = addStreamer();
    const a = await confirmed({ s });
    const b = await confirmed({ s, v: viewer(2), startsAt: FREE + 24 * HOUR });
    const t = NOW + 40 * HOUR;
    assert.equal((await svc.startReschedule(s, a.id, { way: 'propose', startsAt: t, now: NOW })).ok, true);
    assert.equal((await svc.startReschedule(s, b.id, { way: 'propose', startsAt: t + 30 * MIN, now: NOW })).code, 'bad_time', 'a held time is not on offer');
    const real = db.startCoachingReschedule;
    db.startCoachingReschedule = () => ({ ok: false, code: 'taken' }); // another proposal won the race
    try { assert.equal((await svc.startReschedule(s, b.id, { way: 'propose', startsAt: NOW + 60 * HOUR, now: NOW })).code, 'taken'); } finally { db.startCoachingReschedule = real; }
    assert.equal((await ask(s, viewer(3), { startsAt: t })).code, 'bad_time', 'held: not offered to a new request');
  });

  test('a viewer can withdraw an unpaid rescheduling session, never a paid one', async () => {
    const { s, v, id } = await confirmed();
    await svc.startReschedule(s, id, { way: 'ask', now: NOW });
    const w = await svc.withdraw(s, v, id, { now: NOW + MIN });
    assert.equal(w.ok, true);
    assert.equal(w.booking.status, 'withdrawn');
    assert.deepEqual(rooms.removed, [id]);
    const p = await paidConfirmed();
    await svc.startReschedule(p.s, p.id, { way: 'ask', now: NOW + 2 * MIN });
    assert.equal((await svc.withdraw(p.s, p.v, p.id, { now: NOW + 3 * MIN })).code, 'paid');
  });

  test('a viewer can withdraw an unpaid rescheduling session after its original time has passed', async () => {
    const { s, v, id } = await confirmed();
    await svc.startReschedule(s, id, { way: 'ask', now: NOW });
    const after = FREE + HOUR;
    const w = await svc.withdraw(s, v, id, { now: after });
    assert.equal(w.ok, true);
    assert.equal(w.booking.status, 'withdrawn');
    assert.ok(rooms.removed.includes(id));
  });

  test('the viewer cannot make a refund: no viewer action touches the payments', async () => {
    const { s, v, id, orderId } = await paidConfirmed();
    await svc.startReschedule(s, id, { way: 'ask', now: NOW + MIN });
    await svc.viewerPropose(s, v, id, { startsAt: NOW + 40 * HOUR, now: NOW + 2 * MIN });
    await svc.withdraw(s, v, id, { now: NOW + 3 * MIN });
    assert.equal(db.getCoachingPayment(orderId).refund_status, null);
  });

  describe('the minute tick', () => {
    async function proposed(by, { paid = false } = {}) {
      const made = paid ? await paidConfirmed() : await confirmed();
      const { s, v, id } = made;
      if (by === 'coach') await svc.startReschedule(s, id, { way: 'propose', startsAt: NOW + 96 * HOUR, now: NOW });
      else {
        await svc.startReschedule(s, id, { way: 'ask', now: NOW });
        await svc.viewerPropose(s, v, id, { startsAt: NOW + 96 * HOUR, now: NOW });
      }
      discord.sent = [];
      return made;
    }

    test('a coach proposal unanswered for 48 h is dropped, its time freed, and the viewer is asked to pick', async () => {
      const { s, v, id } = await proposed('coach');
      assert.deepEqual(await svc.runDueReschedules({ now: NOW + 47 * HOUR }), { dropped: 0, closed: 0 });
      assert.deepEqual(await svc.runDueReschedules({ now: NOW + 48 * HOUR }), { dropped: 1, closed: 0 });
      assert.equal(row(s, id).proposal_starts_at, null);
      assert.equal(row(s, id).status, 'rescheduling');
      const msg = to(v.discordUserId)[0].payload.embeds[0];
      assert.match(msg.title, /Pick a new time/);
      assert.match(msg.description, new RegExp(`booking=${id}`));
      assert.equal(to(s.discord_user_id).length, 0);
      assert.equal((await ask(s, viewer(2), { startsAt: NOW + 96 * HOUR })).ok, true, 'the freed time can be booked');
    });

    test('a proposal replaced while the tick is busy with an earlier row is kept, and no lapse message is sent', async () => {
      const s = addStreamer();
      const a = await confirmed({ s, v: viewer(1), startsAt: FREE });
      const b = await confirmed({ s, v: viewer(2), startsAt: FREE + 24 * HOUR });
      await svc.startReschedule(s, a.id, { way: 'propose', startsAt: NOW + 96 * HOUR, now: NOW });
      await svc.startReschedule(s, b.id, { way: 'propose', startsAt: NOW + 100 * HOUR, now: NOW + MIN });
      discord.sent = [];
      const later = NOW + 49 * HOUR;
      const fresh = NOW + 120 * HOUR;
      const realSend = discord.sendDirectMessage;
      let replaced = false;
      discord.sendDirectMessage = async function (userId, payload) {
        if (!replaced) {
          replaced = true;
          assert.equal(db.proposeCoachingTime(b.id, 'coach', fresh, 'new', later).ok, true);
        }
        return realSend.call(this, userId, payload);
      };
      try {
        const r = await svc.runDueReschedules({ now: later });
        assert.equal(r.dropped, 1);
      } finally { discord.sendDirectMessage = realSend; }
      assert.equal(row(s, b.id).proposal_starts_at, fresh);
      assert.equal(row(s, b.id).proposal_at, later);
      assert.equal(to(b.v.discordUserId).length, 0, 'no lapse message for the replaced proposal');
    });

    test('a viewer proposal unanswered for 48 h is dropped and the coach is reminded, whatever the notify switch says', async () => {
      const s = addStreamer({ settings: { notifyRequests: 0 } });
      const { v, id } = await confirmed({ s });
      await svc.startReschedule(s, id, { way: 'ask', now: NOW });
      await svc.viewerPropose(s, v, id, { startsAt: NOW + 96 * HOUR, now: NOW });
      discord.sent = [];
      assert.equal((await svc.runDueReschedules({ now: NOW + 49 * HOUR })).dropped, 1);
      assert.match(to(s.discord_user_id)[0].payload.embeds[0].title, /lapsed/);
      assert.equal(to(v.discordUserId).length, 0);
    });

    test('a proposal that comes within the hour is dropped, whoever made it', async () => {
      const a = await proposed('coach');
      assert.equal((await svc.runDueReschedules({ now: NOW + 96 * HOUR - 30 * MIN })).dropped, 1);
      assert.equal(to(a.v.discordUserId).length, 1);
      const b = await proposed('viewer');
      assert.equal((await svc.runDueReschedules({ now: NOW + 96 * HOUR - 30 * MIN })).dropped, 1);
      assert.equal(to(b.s.discord_user_id).length, 1);
    });

    test('7 days with no agreement: not rescheduled, the room is removed, both are told; a free session owes nothing', async () => {
      const { s, v, id } = await confirmed();
      await svc.startReschedule(s, id, { way: 'ask', now: NOW });
      discord.sent = [];
      assert.deepEqual(await svc.runDueReschedules({ now: NOW + 7 * 24 * HOUR }), { dropped: 0, closed: 1 });
      assert.equal(row(s, id).status, 'not_rescheduled');
      assert.deepEqual(rooms.removed, [id]);
      assert.match(to(v.discordUserId)[0].payload.embeds[0].title, /not rescheduled/);
      assert.doesNotMatch(to(v.discordUserId)[0].payload.embeds[0].description, /refund/);
      assert.match(to(s.discord_user_id)[0].payload.embeds[0].title, /not rescheduled/);
    });

    test('7 days on a paid session: the payment is pending, the viewer is told the coach will refund, the coach is told to', async () => {
      const { s, v, id, orderId } = await paidConfirmed();
      await svc.startReschedule(s, id, { way: 'ask', now: NOW + MIN });
      discord.sent = [];
      await svc.runDueReschedules({ now: NOW + MIN + 7 * 24 * HOUR });
      assert.equal(db.getCoachingPayment(orderId).refund_status, 'pending');
      assert.equal(db.getCoachingPayment(orderId).refund_reason, 'not_rescheduled');
      assert.match(to(v.discordUserId)[0].payload.embeds[0].description, /refund you/);
      assert.match(to(s.discord_user_id)[0].payload.embeds[0].description, /Refunded/);
    });

    test('Discord down never stops the tick or undoes a step; a second run finds nothing left to do', async () => {
      const { s, id } = await proposed('coach');
      discord.sendResult = { ok: false, reason: 'unreachable' };
      assert.equal((await svc.runDueReschedules({ now: NOW + 48 * HOUR })).dropped, 1);
      assert.equal(row(s, id).proposal_starts_at, null);
      assert.deepEqual(await svc.runDueReschedules({ now: NOW + 48 * HOUR }), { dropped: 0, closed: 0 });
    });
  });
});
