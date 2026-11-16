'use strict';

// Coaching rooms (services/coachingRooms.js) against the real src/db.js on in-memory SQLite and a fake src/discord.js
// that records every call: nothing leaves the machine. All names, ids and texts are synthetic.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) {
  process.env[key] = process.env[key] || 'test';
}

const DB_FILE = path.join(__dirname, '..', 'db.js');
const ROOMS = path.join(__dirname, 'coachingRooms.js');
const TICK = path.join(__dirname, 'coachingTick.js');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

const GUILD = '123456789012345678';
const CATEGORY = '223456789012345678';
const BOT = '999999999999999999';
const MB = 1024 * 1024;

const calls = [];
let fail = {}; // method -> Error to throw (once if `once`)
const discord = {
  ready: true,
  intent: true,
  messages: [],
  sent: [],
  downloaded: [],
  client: { user: { id: BOT } },
  isReady() { return this.ready; },
  hasMessageContent() { return this.intent; },
  escapeLinkText: (s) => String(s),
  async createRole(guild, name) { return this.act('createRole', { guild, name }, () => 'role1'); },
  async deleteRole(guild, id) { return this.act('deleteRole', { guild, id }, () => undefined); },
  async addRoleToMember(guild, user, role) { return this.act('addRoleToMember', { guild, user, role }, () => undefined); },
  async createVoiceChannel(guild, opts) { return this.act('createVoiceChannel', { guild, ...opts }, () => 'chan1'); },
  async renameRole(guild, id, name) { return this.act('renameRole', { guild, id, name }, () => undefined); },
  async renameChannel(guild, id, name) { return this.act('renameChannel', { guild, id, name }, () => undefined); },
  async deleteChannel(guild, id) { return this.act('deleteChannel', { guild, id }, () => undefined); },
  async fetchAllMessages() { return this.act('fetchAllMessages', {}, () => this.messages); },
  async downloadAttachment(url) { this.downloaded.push(url); return Buffer.from('file'); },
  async sendDirectMessage(userId, payload) { this.sent.push({ userId, payload }); return { ok: true }; },
  guildName: () => 'Coach HQ',
  async act(name, args, ok) {
    calls.push({ fn: name, ...args });
    if (fail[name]) {
      const e = fail[name];
      if (e.once) delete fail[name];
      throw e;
    }
    return ok();
  },
};

let db;
let rooms;
let tick;
const saved = {};

before(() => {
  saved.load = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    const from = parent && parent.filename;
    if (from === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
      if (request === './config') return { adminDiscordIds: [] };
    }
    if (from === ROOMS && request === '../discord') return discord;
    return saved.load(request, parent, isMain);
  };
  saved.error = console.error;
  console.error = () => {};
  try {
    for (const f of [DB_FILE, ROOMS, TICK]) delete require.cache[f];
    db = require(DB_FILE);
    rooms = require(ROOMS);
    tick = require(TICK);
  } finally {
    Module._load = saved.load;
  }
});

after(() => { console.error = saved.error; });

beforeEach(() => {
  calls.length = 0;
  fail = {};
  discord.ready = true;
  discord.intent = true;
  discord.messages = [];
  discord.sent = [];
  discord.downloaded = [];
  db.db.exec('DELETE FROM coaching_rooms; DELETE FROM coaching_bookings;');
});

const HOURS = Array.from({ length: 7 }, () => ({ on: true, start: 1080, end: 1320 }));
const NOW = Date.UTC(2026, 10, 2, 12, 0);
const START = Date.UTC(2026, 10, 3, 18, 0); // Tuesday 18:00 Lisbon
const END = START + 3600e3;
const CLOSE_AT = END + 30 * 60e3;
let counter = 0;

function addStreamer({ category = CATEGORY } = {}) {
  const n = ++counter;
  const id = Number(db.db.prepare(`INSERT INTO streamers (discord_user_id, discord_username, twitch_username, twitch_display_name, paypal_email)
    VALUES (?, ?, ?, ?, ?)`).run(`3000000000000${String(n).padStart(5, '0')}`, `s${n}`, `coach${n}`, `Coach${n}`, 'c@example.com').lastInsertRowid);
  db.db.prepare('INSERT INTO guilds (guild_id, streamer_id, guild_name) VALUES (?, ?, ?)').run(GUILD, id, 'HQ');
  db.saveCoachingSettings(id, { timeZone: 'Europe/Lisbon', hours: HOURS, daysOff: [], guildId: GUILD, inviteCode: 'abc', whereText: 'Voice', notifyRequests: 1, lang: 'en', categoryId: category });
  return db.getStreamerById(id);
}

// A confirmed free 1 h session (the room is made on confirmation).
function confirmed(streamer, { who = 'Some.Viewer!' } = {}) {
  const n = ++counter;
  const viewer = { discordUserId: `4000000000000${String(n).padStart(5, '0')}`, username: who, displayName: `Viewer ${n}`, avatar: null };
  const made = db.createCoachingBooking({ streamerId: streamer.id, viewer, startsAt: START, minutes: 60, note: '', lang: 'en', now: NOW, priceCents: 0, currency: 'EUR' });
  assert.ok(made.ok, made.code);
  const row = db.acceptCoachingBooking(made.booking.id, streamer.id, NOW, null);
  assert.equal(row.status, 'confirmed');
  return { booking: row, viewer };
}
const names = () => calls.map((c) => c.fn);

describe('roomOverwrites and roomName', () => {
  test('the overwrites are exactly decision 10', () => {
    const o = rooms.roomOverwrites({ guildId: GUILD, roleId: 'R', coachId: 'C', botId: BOT });
    const view = ['ViewChannel', 'Connect', 'Speak', 'SendMessages', 'AttachFiles', 'ReadMessageHistory'];
    assert.deepEqual(o, [
      { id: GUILD, type: 0, allow: [], deny: ['ViewChannel', 'Connect'] },
      { id: 'R', type: 0, allow: view, deny: [] },
      { id: 'C', type: 1, allow: view, deny: [] },
      { id: BOT, type: 1, allow: [...view, 'ManageChannels'], deny: [] },
    ]);
  });

  test('the name is the lowercased username with safe characters, and the date in the streamer\'s zone', () => {
    assert.equal(rooms.roomName('Some.Viewer!', Date.UTC(2026, 10, 3, 23, 30), 'Europe/Lisbon'), 'coaching-some.viewer-2026-11-03');
    assert.equal(rooms.roomName('!!!', Date.UTC(2026, 10, 3, 23, 30), 'Asia/Tokyo'), 'coaching-viewer-2026-11-04');
    assert.equal(rooms.roomName('x'.repeat(300), START, 'UTC').length, 100);
  });
});

describe('makeFor', () => {
  test('makes the role, gives it, makes the channel in the category only, and writes every id', async () => {
    const s = addStreamer();
    const { booking, viewer } = confirmed(s);
    const made = await rooms.makeFor(booking.id, { now: NOW });
    assert.deepEqual(made, { url: `https://discord.com/channels/${GUILD}/chan1` });
    assert.deepEqual(names(), ['createRole', 'addRoleToMember', 'createVoiceChannel']);
    assert.equal(calls[0].guild, GUILD);
    assert.equal(calls[0].name, 'coaching-some.viewer-2026-11-03');
    assert.deepEqual(calls[1], { fn: 'addRoleToMember', guild: GUILD, user: viewer.discordUserId, role: 'role1' });
    const channel = calls[2];
    assert.equal(channel.parentId, CATEGORY);
    assert.deepEqual(channel.overwrites, rooms.roomOverwrites({ guildId: GUILD, roleId: 'role1', coachId: s.discord_user_id, botId: BOT }));
    assert.equal(channel.name, `coaching-some.viewer-2026-11-03`);
    const row = db.getCoachingRoom(booking.id);
    assert.equal(row.state, 'open');
    assert.equal(row.role_id, 'role1');
    assert.equal(row.channel_id, 'chan1');
    assert.equal(row.category_id, CATEGORY);
    assert.equal(row.close_at, CLOSE_AT);
  });

  test('without a Coaching category nothing is made and there is no row', async () => {
    const s = addStreamer({ category: null });
    const { booking } = confirmed(s);
    assert.equal(await rooms.makeFor(booking.id, { now: NOW }), null);
    assert.deepEqual(calls, []);
    assert.equal(db.getCoachingRoom(booking.id), null);
  });

  test('a booking from before prices (no price) gets no room', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    db.db.prepare('UPDATE coaching_bookings SET price_cents = NULL WHERE id = ?').run(booking.id);
    assert.equal(await rooms.makeFor(booking.id, { now: NOW }), null);
    assert.equal(db.getCoachingRoom(booking.id), null);
  });

  test('a role made but the channel refused: the row is failed with the role id, the booking stays confirmed', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    fail.createVoiceChannel = Object.assign(new Error('Missing Permissions'), { code: 50013 });
    assert.equal(await rooms.makeFor(booking.id, { now: NOW }), null);
    const row = db.getCoachingRoom(booking.id);
    assert.equal(row.state, 'failed');
    assert.equal(row.error, 'missing_permissions');
    assert.equal(row.role_id, 'role1');
    assert.equal(row.channel_id, null);
    assert.equal(db.getCoachingBookingById(booking.id).status, 'confirmed');
  });

  test('a viewer who left the server: failed with viewer_not_member', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    fail.addRoleToMember = Object.assign(new Error('Unknown Member'), { code: 10007 });
    await rooms.makeFor(booking.id, { now: NOW });
    assert.equal(db.getCoachingRoom(booking.id).error, 'viewer_not_member');
  });

  test('Discord down: no throw, failed with discord_down, the booking stays confirmed', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    discord.ready = false;
    assert.equal(await rooms.makeFor(booking.id, { now: NOW }), null);
    assert.equal(db.getCoachingRoom(booking.id).error, 'discord_down');
    assert.equal(db.getCoachingBookingById(booking.id).status, 'confirmed');
  });

  test('a coach who is not in the server: the channel is made again without their overwrite', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    fail.createVoiceChannel = Object.assign(new Error('Unknown Member'), { code: 10007, once: true });
    const made = await rooms.makeFor(booking.id, { now: NOW });
    assert.ok(made);
    const last = calls.filter((c) => c.fn === 'createVoiceChannel').at(-1);
    assert.ok(!last.overwrites.some((o) => o.id === s.discord_user_id));
  });
});

describe('retry', () => {
  test('deletes the half-made role first, then makes the room again', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    fail.createVoiceChannel = Object.assign(new Error('x'), { code: 50013, once: true });
    await rooms.makeFor(booking.id, { now: NOW });
    calls.length = 0;
    const r = await rooms.retry(s, booking.id, { now: NOW });
    assert.equal(r.ok, true);
    assert.deepEqual(names(), ['deleteChannel', 'deleteRole', 'createRole', 'addRoleToMember', 'createVoiceChannel']);
    assert.equal(calls[1].id, 'role1');
    assert.equal(db.getCoachingRoom(booking.id).state, 'open');
    assert.equal(db.getCoachingRoom(booking.id).error, null);
  });

  test('a room that is not failed, a missing category and a finished session are refused', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    await rooms.makeFor(booking.id, { now: NOW });
    assert.deepEqual(await rooms.retry(s, booking.id, { now: NOW }), { ok: false, code: 'room_not_failed' });
    assert.deepEqual(await rooms.retry(s, booking.id, { now: END + 1 }), { ok: false, code: 'too_late' });
    assert.deepEqual(await rooms.retry(s, 99999, { now: NOW }), { ok: false, code: 'not_found' });
    db.saveCoachingSettings(s.id, { timeZone: 'Europe/Lisbon', hours: HOURS, daysOff: [], guildId: GUILD, inviteCode: 'abc', whereText: '', notifyRequests: 1, lang: 'en', categoryId: null });
    assert.deepEqual(await rooms.retry(s, booking.id, { now: NOW }), { ok: false, code: 'no_category' });
  });

  test('a confirmed booking that never got a room can be given one', async () => {
    const s = addStreamer({ category: null });
    const { booking } = confirmed(s);
    db.saveCoachingSettings(s.id, { timeZone: 'Europe/Lisbon', hours: HOURS, daysOff: [], guildId: GUILD, inviteCode: 'abc', whereText: '', notifyRequests: 1, lang: 'en', categoryId: CATEGORY });
    const r = await rooms.retry(s, booking.id, { now: NOW });
    assert.equal(r.ok, true);
    assert.equal(db.getCoachingRoom(booking.id).state, 'open');
  });

  test('when the half-made pair cannot be deleted nothing new is made', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    fail.createVoiceChannel = Object.assign(new Error('x'), { code: 50013, once: true });
    await rooms.makeFor(booking.id, { now: NOW });
    fail.deleteRole = new Error('boom');
    calls.length = 0;
    const r = await rooms.retry(s, booking.id, { now: NOW });
    assert.equal(r.ok, false);
    assert.ok(!names().includes('createRole'));
  });
});

describe('finishOrCleanMaking (a restart)', () => {
  test('a stale making row with a role is finished from the stored id, not made twice', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    db.createCoachingRoom({ bookingId: booking.id, streamerId: s.id, guildId: GUILD, categoryId: CATEGORY, closeAt: CLOSE_AT, now: NOW - 10 * 60e3 });
    db.updateCoachingRoom(booking.id, { role_id: 'oldrole' }, NOW - 10 * 60e3);
    const r = await rooms.finishOrCleanMaking({ now: NOW });
    assert.equal(r.finished, 1);
    assert.ok(!names().includes('createRole'));
    const row = db.getCoachingRoom(booking.id);
    assert.equal(row.state, 'open');
    assert.equal(row.role_id, 'oldrole');
    assert.equal(row.channel_id, 'chan1');
  });

  test('a fresh making row is left alone', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    db.createCoachingRoom({ bookingId: booking.id, streamerId: s.id, guildId: GUILD, categoryId: CATEGORY, closeAt: CLOSE_AT, now: NOW });
    const r = await rooms.finishOrCleanMaking({ now: NOW + 30e3 });
    assert.deepEqual(r, { finished: 0, cleaned: 0 });
    assert.deepEqual(calls, []);
  });

  test('a making row of a booking that is no longer confirmed is cleaned up', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    db.createCoachingRoom({ bookingId: booking.id, streamerId: s.id, guildId: GUILD, categoryId: CATEGORY, closeAt: CLOSE_AT, now: NOW - 10 * 60e3 });
    db.updateCoachingRoom(booking.id, { role_id: 'oldrole', channel_id: 'oldchan' }, NOW - 10 * 60e3);
    db.db.prepare("UPDATE coaching_bookings SET status = 'cancelled' WHERE id = ?").run(booking.id);
    const r = await rooms.finishOrCleanMaking({ now: NOW });
    assert.equal(r.cleaned, 1);
    assert.deepEqual(names(), ['deleteChannel', 'deleteRole']);
    assert.equal(db.getCoachingRoom(booking.id).state, 'closed');
  });
});

describe('closeDue', () => {
  const msg = (author, content, at, attachments = [], bot = false) => ({ id: String(at), at, author, bot, content, attachments });

  async function open(s, booking) {
    await rooms.makeFor(booking.id, { now: NOW });
    calls.length = 0;
    return db.getCoachingRoom(booking.id);
  }

  test('nothing is due before close_at', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    await open(s, booking);
    assert.deepEqual(await rooms.closeDue({ now: CLOSE_AT - 1 }), { closed: 0 });
    assert.deepEqual(calls, []);
  });

  test('one transcript to each side, the channel and the role deleted, the row closed', async () => {
    const s = addStreamer();
    const { booking, viewer } = confirmed(s);
    await open(s, booking);
    discord.messages = [
      msg('Viewer', 'hello <@123>', START + 60e3),
      msg('Coach', 'hi', START + 120e3, [{ name: 'notes.png', url: 'https://cdn.discordapp.com/a/notes.png', size: 1000 }]),
      msg('Atleta', 'bot line', START + 130e3, [], true),
    ];
    assert.deepEqual(await rooms.closeDue({ now: CLOSE_AT }), { closed: 1 });
    const recipients = discord.sent.map((d) => d.userId);
    assert.deepEqual([...new Set(recipients)].sort(), [viewer.discordUserId, s.discord_user_id].sort());
    const transcripts = discord.sent.filter((d) => d.payload.files && d.payload.files[0].name === 'transcript.txt');
    assert.equal(transcripts.length, 2);
    const text = transcripts[0].payload.files[0].attachment.toString('utf8');
    assert.match(text, /Coaching session transcript/);
    assert.match(text, /2026-11-03 18:01 Viewer: hello <@123>/);
    assert.match(text, /2026-11-03 18:02 Coach: hi/);
    assert.match(text, /notes\.png\] \(attached\)/);
    assert.ok(!/bot line/.test(text));
    assert.equal(discord.sent.filter((d) => d.payload.files && d.payload.files[0].name === 'notes.png').length, 2);
    assert.deepEqual(names(), ['fetchAllMessages', 'deleteChannel', 'deleteRole']);
    const row = db.getCoachingRoom(booking.id);
    assert.equal(row.state, 'closed');
    assert.equal(row.transcript_status, 'sent');
    discord.sent = [];
    assert.deepEqual(await rooms.closeDue({ now: CLOSE_AT + 60e3 }), { closed: 0 });
    assert.deepEqual(discord.sent, []);
  });

  test('without the Message Content intent: no_intent, no DM, still deleted', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    await open(s, booking);
    discord.intent = false;
    await rooms.closeDue({ now: CLOSE_AT });
    assert.deepEqual(discord.sent, []);
    assert.ok(!names().includes('fetchAllMessages'));
    const row = db.getCoachingRoom(booking.id);
    assert.equal(row.transcript_status, 'no_intent');
    assert.equal(row.state, 'closed');
  });

  test('a room with no messages sends the one-line transcript', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    await open(s, booking);
    await rooms.closeDue({ now: CLOSE_AT });
    assert.match(discord.sent[0].payload.files[0].attachment.toString('utf8'), /No messages were written\./);
  });

  test('a 30 MB attachment is named as too big and never downloaded', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    await open(s, booking);
    discord.messages = [msg('Viewer', 'video', START + 60e3, [{ name: 'big.mp4', url: 'https://cdn.discordapp.com/a/big.mp4', size: 30 * MB }])];
    await rooms.closeDue({ now: CLOSE_AT });
    assert.match(discord.sent[0].payload.files[0].attachment.toString('utf8'), /big\.mp4\] \(too big to send\)/);
    assert.deepEqual(discord.downloaded, []);
    assert.equal(discord.sent.length, 2);
  });

  test('a side that cannot be messaged is recorded as partial and is not retried', async () => {
    const s = addStreamer();
    const { booking, viewer } = confirmed(s);
    await open(s, booking);
    const send = discord.sendDirectMessage;
    discord.sendDirectMessage = async function (userId, payload) { return userId === viewer.discordUserId ? { ok: false, reason: 'unreachable' } : send.call(this, userId, payload); };
    try { await rooms.closeDue({ now: CLOSE_AT }); } finally { discord.sendDirectMessage = send; }
    assert.equal(db.getCoachingRoom(booking.id).transcript_status, 'partial');
  });

  test('a deletion Discord refuses keeps the room closing and sends nothing twice', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    await open(s, booking);
    fail.deleteChannel = new Error('boom');
    assert.deepEqual(await rooms.closeDue({ now: CLOSE_AT }), { closed: 0 });
    assert.equal(db.getCoachingRoom(booking.id).state, 'closing');
    const sentBefore = discord.sent.length;
    fail = {};
    assert.deepEqual(await rooms.closeDue({ now: CLOSE_AT + 60e3 }), { closed: 1 });
    assert.equal(discord.sent.length, sentBefore);
  });

  test('Discord not ready: nothing happens and nothing throws', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    await open(s, booking);
    discord.ready = false;
    assert.deepEqual(await rooms.closeDue({ now: CLOSE_AT }), { closed: 0 });
    assert.equal(db.getCoachingRoom(booking.id).state, 'open');
  });
});

describe('removeFor (a cancelled session)', () => {
  test('deletes the channel and role at once, with no transcript, and closes the row as cancelled', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    await rooms.makeFor(booking.id, { now: NOW });
    calls.length = 0;
    assert.equal(await rooms.removeFor(booking.id, { now: NOW }), true);
    assert.deepEqual(names(), ['deleteChannel', 'deleteRole']);
    const row = db.getCoachingRoom(booking.id);
    assert.deepEqual([row.state, row.transcript_status], ['closed', 'cancelled']);
    assert.deepEqual(discord.sent, [], 'no transcript is sent');
    assert.equal(await rooms.removeFor(booking.id, { now: NOW }), true, 'again: nothing left to do');
    assert.equal(await rooms.removeFor(987654, { now: NOW }), true, 'a booking with no room');
  });

  test('with Discord down the row stays closing and cancelled; closeDue finishes it later without a transcript', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    await rooms.makeFor(booking.id, { now: NOW });
    calls.length = 0;
    discord.ready = false;
    assert.equal(await rooms.removeFor(booking.id, { now: NOW }), false);
    let row = db.getCoachingRoom(booking.id);
    assert.deepEqual([row.state, row.transcript_status], ['closing', 'cancelled']);
    discord.ready = true;
    await rooms.closeDue({ now: NOW + 1 });
    row = db.getCoachingRoom(booking.id);
    assert.equal(row.state, 'closed');
    assert.deepEqual(discord.sent, []);
  });

  test('a delete that fails never throws and leaves the row for closeDue', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    await rooms.makeFor(booking.id, { now: NOW });
    fail.deleteChannel = new Error('boom');
    assert.equal(await rooms.removeFor(booking.id, { now: NOW }), false);
    assert.equal(db.getCoachingRoom(booking.id).state, 'closing');
  });
});

describe('reschedule (a session moved to a new time)', () => {
  const NEW_START = Date.UTC(2026, 10, 7, 10, 0); // Saturday 10:00 Lisbon
  const NEW_CLOSE = NEW_START + 3600e3 + 30 * 60e3;
  const move = (booking, to = NEW_START) => db.db.prepare("UPDATE coaching_bookings SET status = 'confirmed', starts_at = ? WHERE id = ?").run(to, booking.id);

  test('the role and the channel are renamed to the new date and the close moves to 30 minutes after the new end', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    await rooms.makeFor(booking.id, { now: NOW });
    calls.length = 0;
    move(booking);
    assert.deepEqual(await rooms.reschedule(booking.id, { now: NOW }), { url: `https://discord.com/channels/${GUILD}/chan1` });
    assert.deepEqual(calls, [
      { fn: 'renameRole', guild: GUILD, id: 'role1', name: 'coaching-some.viewer-2026-11-07' },
      { fn: 'renameChannel', guild: GUILD, id: 'chan1', name: 'coaching-some.viewer-2026-11-07' },
    ]);
    assert.equal(db.getCoachingRoom(booking.id).close_at, NEW_CLOSE);
  });

  test('a rename Discord refuses leaves the room open, the close moved and nothing thrown', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    await rooms.makeFor(booking.id, { now: NOW });
    move(booking);
    fail.renameRole = Object.assign(new Error('no'), { code: 50013 });
    fail.renameChannel = new Error('down');
    const made = await rooms.reschedule(booking.id, { now: NOW });
    assert.deepEqual(made, { url: `https://discord.com/channels/${GUILD}/chan1` });
    const room = db.getCoachingRoom(booking.id);
    assert.equal(room.state, 'open');
    assert.equal(room.close_at, NEW_CLOSE);
  });

  test('Discord not ready: the close still moves, nothing is renamed; a confirmed session with no room gets one', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    await rooms.makeFor(booking.id, { now: NOW });
    calls.length = 0;
    move(booking);
    discord.ready = false;
    await rooms.reschedule(booking.id, { now: NOW });
    assert.deepEqual(calls, []);
    assert.equal(db.getCoachingRoom(booking.id).close_at, NEW_CLOSE);
    discord.ready = true;
    const s2 = addStreamer();
    const two = confirmed(s2);
    assert.equal(db.getCoachingRoom(two.booking.id), null);
    assert.ok(await rooms.reschedule(two.booking.id, { now: NOW }));
    assert.ok(db.getCoachingRoom(two.booking.id));
  });

  test('a booking that is not confirmed, or a closed room, is left alone', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    await rooms.makeFor(booking.id, { now: NOW });
    calls.length = 0;
    db.db.prepare("UPDATE coaching_bookings SET status = 'rescheduling' WHERE id = ?").run(booking.id);
    assert.equal(await rooms.reschedule(booking.id, { now: NOW }), null);
    assert.equal(await rooms.reschedule(987654, { now: NOW }), null);
    assert.deepEqual(calls, []);
  });

  test('closeDue does not close the room of a rescheduling session, and closes it again once it is confirmed', async () => {
    const s = addStreamer();
    const { booking } = confirmed(s);
    await rooms.makeFor(booking.id, { now: NOW });
    calls.length = 0;
    db.db.prepare("UPDATE coaching_bookings SET status = 'rescheduling' WHERE id = ?").run(booking.id);
    assert.deepEqual(await rooms.closeDue({ now: CLOSE_AT + 1 }), { closed: 0 });
    assert.deepEqual(calls, []);
    assert.equal(db.getCoachingRoom(booking.id).state, 'open');
    db.db.prepare("UPDATE coaching_bookings SET status = 'confirmed' WHERE id = ?").run(booking.id);
    assert.deepEqual(await rooms.closeDue({ now: CLOSE_AT + 1 }), { closed: 1 });
  });
});

describe('removeAllFor', () => {
  test('deletes the channel and role of every open room of the streamer, other streamers\' rooms are left', async () => {
    const a = addStreamer();
    const b = addStreamer();
    const one = confirmed(a);
    const two = confirmed(b);
    await rooms.makeFor(one.booking.id, { now: NOW });
    await rooms.makeFor(two.booking.id, { now: NOW });
    calls.length = 0;
    await rooms.removeAllFor(a.id);
    assert.deepEqual(names(), ['deleteChannel', 'deleteRole']);
  });

  test('never throws, with Discord down or the call failing', async () => {
    const a = addStreamer();
    const one = confirmed(a);
    await rooms.makeFor(one.booking.id, { now: NOW });
    fail.deleteChannel = new Error('boom');
    await rooms.removeAllFor(a.id);
    discord.ready = false;
    await rooms.removeAllFor(a.id);
  });
});

describe('planAttachments and buildTranscript', () => {
  test('files are packed 10 to a message and 10 MB to a message; over 10 MB each is too big', () => {
    const plan = rooms.planAttachments([
      { key: 'a', size: 6 * MB }, { key: 'b', size: 6 * MB }, { key: 'c', size: 11 * MB }, { key: 'd', size: 1 },
    ]);
    assert.deepEqual(plan, { batches: [['a'], ['b', 'd']], tooBig: ['c'] });
    const many = Array.from({ length: 23 }, (_, i) => ({ key: String(i), size: 1 }));
    assert.deepEqual(rooms.planAttachments(many).batches.map((b) => b.length), [10, 10, 3]);
  });

  test('a chat full of files holds at most 30 for the bot; the rest are named too big', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ key: String(i), size: 1 }));
    const plan = rooms.planAttachments(many);
    assert.equal(plan.batches.flat().length, 30);
    assert.equal(plan.tooBig.length, 50);
  });

  test('an attachment name from chat is cut to plain characters before it is uploaded', () => {
    assert.equal(rooms.safeFileName('../../etc/passwd'), '__.._etc_passwd');
    assert.equal(rooms.safeFileName('.hidden'), '_hidden');
    assert.equal(rooms.safeFileName('a\nb<c>.png'), 'a_b_c_.png');
    assert.equal(rooms.safeFileName('x'.repeat(300)).length, 100);
    assert.equal(rooms.safeFileName(''), 'file');
  });

  test('the transcript names the zone and lists each attachment\'s fate', () => {
    const t = (key, p = {}) => `${key}${p.name ? `:${p.name}` : ''}${p.zone ? `:${p.zone}` : ''}`;
    const text = rooms.buildTranscript({
      coachName: 'C', viewerName: 'V', startsAt: START, minutes: 60, timeZone: 'Asia/Tokyo', t,
      messages: [{ at: START, author: 'V', bot: false, content: 'a\nb', attachments: [{ name: 'x', key: '1' }, { name: 'y', key: '2' }] }],
      statusOf: (a) => (a.name === 'x' ? 'attached' : 'too_big'),
    });
    assert.match(text, /coaching\.transcript\.session:Asia\/Tokyo/);
    assert.match(text, /2026-11-04 03:00 V: a\n    b/);
    assert.match(text, /coaching\.transcript\.attached:x/);
    assert.match(text, /coaching\.transcript\.tooBig:y/);
  });
});

describe('the minute tick', () => {
  test('runs the four steps in order and a throwing step does not stop the others', async () => {
    const order = [];
    const deps = {
      payments: { expireDue: async () => { order.push('expire'); throw new Error('x'); }, reconcileStale: async () => { order.push('stale'); return 1; } },
      bookings: { runDueReschedules: async () => { order.push('reschedules'); return 4; } },
      rooms: { finishOrCleanMaking: async () => { order.push('making'); return 2; }, closeDue: async () => { order.push('close'); return 3; } },
    };
    const result = await tick.runOnce({ now: NOW, deps });
    assert.deepEqual(order, ['expire', 'stale', 'reschedules', 'making', 'close']);
    assert.deepEqual(result, { stale: 1, reschedules: 4, making: 2, close: 3 });
  });

  test('with Discord not ready the real steps resolve without throwing', async () => {
    discord.ready = false;
    const result = await tick.runOnce({ now: NOW, deps: {
      payments: { expireDue: async () => ({}), reconcileStale: async () => ({}) },
      bookings: { runDueReschedules: async () => ({}) },
      rooms,
    } });
    assert.deepEqual(result.close, { closed: 0 });
  });

  test('start and stop leave no timer behind', () => {
    tick.startTicks();
    tick.startTicks();
    tick.stopTicks();
  });
});
