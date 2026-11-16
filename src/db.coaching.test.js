'use strict';

// Coaching tables and queries, against the real src/db.js on an in-memory SQLite database.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const DB_FILE = path.join(__dirname, 'db.js');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

let db;
let sql;
let counter = 0;

before(() => {
  const origLoad = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
      if (request === './config') return { adminDiscordIds: [] };
    }
    return origLoad(request, parent, isMain);
  };
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try {
    delete require.cache[DB_FILE];
    db = require(DB_FILE);
  } finally {
    console.log = log;
    console.error = error;
    Module._load = origLoad;
  }
  sql = db.db;
});

function addStreamer() {
  const n = ++counter;
  return Number(sql.prepare('INSERT INTO streamers (discord_user_id, discord_username) VALUES (?, ?)')
    .run(`2000000000000${String(n).padStart(5, '0')}`, `coach${n}`).lastInsertRowid);
}

const HOURS = Array.from({ length: 7 }, (_, i) => ({ on: i < 5, start: 1080, end: 1320 }));
const baseSettings = (over = {}) => ({
  timeZone: 'Europe/Lisbon', hours: HOURS, daysOff: ['2026-12-25'], guildId: '123', inviteCode: 'abc',
  whereText: 'Discord voice', notifyRequests: 1, lang: 'en', ...over,
});
const viewer = (id) => ({ discordUserId: id, username: `u${id}`, displayName: `U ${id}`, avatar: null });
const T = Date.UTC(2026, 10, 2, 19, 0); // a Monday 19:00 UTC
const MIN = 60000;
const book = (streamerId, v, startsAt, minutes, now = T - 24 * 3600e3) =>
  db.createCoachingBooking({ streamerId, viewer: viewer(v), startsAt, minutes, note: null, lang: 'en', now });

describe('coaching settings', () => {
  test('saveCoachingSettings round-trips hours and days off, opens on the first save and keeps open after', () => {
    const id = addStreamer();
    assert.equal(db.getCoachingSettings(id), null);
    const s = db.saveCoachingSettings(id, baseSettings());
    assert.equal(s.open, 1);
    assert.deepEqual(s.hours, HOURS);
    assert.deepEqual(s.days_off, ['2026-12-25']);
    assert.equal(s.time_zone, 'Europe/Lisbon');
    assert.equal(s.where_text, 'Discord voice');
    assert.equal(db.setCoachingOpen(id, 0), true);
    const again = db.saveCoachingSettings(id, baseSettings({ daysOff: [] }));
    assert.equal(again.open, 0);
    assert.deepEqual(again.days_off, []);
    assert.equal(db.setCoachingOpen(addStreamer(), 1), false);
  });

  test('a new invite code forgets the last check; recordInviteCheck ignores a check of an older code', () => {
    const id = addStreamer();
    db.saveCoachingSettings(id, baseSettings());
    db.recordInviteCheck(id, 'abc', 1, 5000);
    let s = db.getCoachingSettings(id);
    assert.equal(s.invite_ok, 1);
    assert.equal(s.invite_checked_at, 5000);
    db.saveCoachingSettings(id, baseSettings());
    assert.equal(db.getCoachingSettings(id).invite_ok, 1, 'same code keeps the check');
    db.saveCoachingSettings(id, baseSettings({ inviteCode: 'xyz' }));
    s = db.getCoachingSettings(id);
    assert.equal(s.invite_ok, null);
    assert.equal(s.invite_checked_at, null);
    db.recordInviteCheck(id, 'abc', 0, 9000);
    assert.equal(db.getCoachingSettings(id).invite_ok, null);
    db.recordInviteCheck(id, 'xyz', 0, 9000);
    assert.equal(db.getCoachingSettings(id).invite_ok, 0);
    // Discord did not answer (ok = null): the time of the check is written, the last answer stays (Ruling 9).
    db.recordInviteCheck(id, 'xyz', null, 9500);
    s = db.getCoachingSettings(id);
    assert.deepEqual([s.invite_ok, s.invite_checked_at], [0, 9500]);
    db.recordInviteCheck(id, 'xyz', 1, 9600);
    db.recordInviteCheck(id, 'xyz', null, 9700);
    s = db.getCoachingSettings(id);
    assert.deepEqual([s.invite_ok, s.invite_checked_at], [1, 9700]);
  });
});

describe('coaching bookings', () => {
  test('createCoachingBooking refuses an overlapping request (Review Focus 3)', () => {
    const id = addStreamer();
    const a = book(id, 'A', T, 60);
    assert.equal(a.ok, true);
    assert.equal(a.booking.status, 'waiting');
    assert.deepEqual(book(id, 'B', T + 30 * MIN, 30), { ok: false, code: 'taken' });
    assert.equal(book(id, 'C', T + 60 * MIN, 30).ok, true);
    assert.equal(book(id, 'D', T - 30 * MIN, 30).ok, true, 'ends exactly when A starts');
  });

  test('createCoachingBooking refuses a third upcoming booking for one viewer, and a declined one frees the place', () => {
    const id = addStreamer();
    const first = book(id, 'V', T, 30);
    assert.equal(book(id, 'V', T + 60 * MIN, 30).ok, true);
    assert.deepEqual(book(id, 'V', T + 120 * MIN, 30), { ok: false, code: 'limit' });
    // another streamer's bookings do not count
    assert.equal(book(addStreamer(), 'V', T, 30).ok, true);
    db.setCoachingBookingStatus(first.booking.id, id, ['waiting'], 'declined', T);
    assert.equal(book(id, 'V', T + 120 * MIN, 30).ok, true);
  });

  test('createCoachingBooking refuses a seventh request of one viewer within 24 h, whatever became of the six (Ruling 7)', () => {
    const id = addStreamer();
    const DAY = 24 * 3600e3;
    const first = T - 48 * 3600e3;
    for (let i = 0; i < 6; i++) {
      const made = book(id, 'R', T + i * 60 * MIN, 30, first + i * MIN);
      assert.equal(made.ok, true, `request ${i + 1}`);
      db.setCoachingBookingStatus(made.booking.id, id, ['waiting'], i % 2 ? 'withdrawn' : 'declined', first + i * MIN);
    }
    assert.deepEqual(book(id, 'R', T + 7 * 60 * MIN, 30, first + 10 * MIN), { ok: false, code: 'too_many' });
    assert.deepEqual(book(id, 'R', T + 7 * 60 * MIN, 30, first + DAY - 1), { ok: false, code: 'too_many' }, 'still inside the 24 h of the first');
    assert.equal(book(id, 'S', T + 7 * 60 * MIN, 30, first + 10 * MIN).ok, true, 'another viewer');
    assert.equal(book(addStreamer(), 'R', T, 30, first + 10 * MIN).ok, true, "another streamer's");
    assert.equal(book(id, 'R', T + 8 * 60 * MIN, 30, first + DAY).ok, true, 'the first request is 24 h old: five count');
  });

  test('a viewer at the limit of upcoming bookings who also made six requests reads too_many', () => {
    const id = addStreamer();
    const now = T - 48 * 3600e3;
    for (let i = 0; i < 4; i++) {
      const made = book(id, 'Q', T + i * 60 * MIN, 30, now);
      db.setCoachingBookingStatus(made.booking.id, id, ['waiting'], 'withdrawn', now);
    }
    assert.equal(book(id, 'Q', T + 5 * 60 * MIN, 30, now).ok, true);
    assert.equal(book(id, 'Q', T + 6 * 60 * MIN, 30, now).ok, true);
    assert.deepEqual(book(id, 'Q', T + 7 * 60 * MIN, 30, now), { ok: false, code: 'too_many' }, 'cancelling one would not help');
  });

  test('setCoachingBookingStatus moves only from the listed states and returns null otherwise', () => {
    const id = addStreamer();
    const { booking } = book(id, 'S', T, 30);
    assert.equal(db.setCoachingBookingStatus(booking.id, id, ['confirmed'], 'cancelled', T), null);
    assert.equal(db.setCoachingBookingStatus(booking.id, id + 999, ['waiting'], 'confirmed', T), null);
    const row = db.setCoachingBookingStatus(booking.id, id, ['waiting'], 'confirmed', T + 5);
    assert.equal(row.status, 'confirmed');
    assert.equal(row.decided_at, T + 5);
    assert.equal(db.setCoachingBookingStatus(booking.id, id, ['waiting'], 'declined', T), null);
    assert.equal(db.getCoachingBooking(booking.id, id).status, 'confirmed');
    assert.equal(db.getCoachingBooking(booking.id, id + 999), null);
  });

  test('reads: held, schedule, viewer list, waiting count, message error', () => {
    const id = addStreamer();
    const now = T - 24 * 3600e3;
    const a = book(id, 'R', T, 60).booking;
    const b = book(id, 'Q', T + 120 * MIN, 30).booking;
    db.setCoachingBookingStatus(b.id, id, ['waiting'], 'declined', now);
    const held = db.getHeldCoachingBookings(id, T + 30 * MIN);
    assert.deepEqual(held, [{ id: a.id, startsAt: T, minutes: 60, status: 'waiting' }]);
    assert.deepEqual(db.getHeldCoachingBookings(id, T + 60 * MIN), []);
    assert.equal(db.getCoachingSchedule(id, T - 1, T + 999 * MIN).length, 2);
    assert.equal(db.getCoachingSchedule(id, T - 1, T + 999 * MIN)[0].id, a.id);
    assert.equal(db.getViewerCoachingBookings(id, 'R', T - 1).length, 1);
    assert.equal(db.countWaitingCoaching(id, now), 1);
    assert.equal(db.countWaitingCoaching(id, T + 1), 0);
    db.recordCoachingMessageError(a.id, 'boom');
    assert.equal(db.getCoachingBooking(a.id, id).message_error, 'boom');
    db.recordCoachingMessageError(a.id, null);
    assert.equal(db.getCoachingBooking(a.id, id).message_error, null);
  });

  test('cleanupOldCoachingBookings keeps 90 days', () => {
    const id = addStreamer();
    const now = T + 200 * 86400e3;
    const old = book(id, 'O1', now - 91 * 86400e3, 30, now - 100 * 86400e3).booking;
    const recent = book(id, 'O2', now - 89 * 86400e3, 30, now - 100 * 86400e3).booking;
    db.cleanupOldCoachingBookings(now);
    assert.equal(db.getCoachingBooking(old.id, id), null);
    assert.ok(db.getCoachingBooking(recent.id, id));
  });
});

describe('coaching payment', () => {
  const paidBook = (id, v, startsAt, minutes, now = T - 24 * 3600e3) =>
    db.createCoachingBooking({ streamerId: id, viewer: viewer(v), startsAt, minutes, note: null, lang: 'en', now, priceCents: 4500, currency: 'EUR' });
  const cap = (bookingId, n, now) => db.recordCoachingPayment({ bookingId, orderId: `ORD${n}`, captureId: `CAP${n}`, amountCents: 4500, currency: 'EUR', now });

  test('lengths default for a row with none, round-trip once saved, and prices_saved_at is set once', () => {
    const id = addStreamer();
    const s = db.saveCoachingSettings(id, baseSettings());
    assert.equal(s.lengths[60].price, 2500);
    assert.equal(s.lengths[30].on, false);
    assert.equal(s.prices_saved_at, null);
    assert.equal(s.category_id, null);
    const lengths = { 30: { on: true, price: 0 }, 60: { on: false, price: 1 }, 120: { on: true, price: 99 }, 180: { on: false, price: 0 }, 240: { on: false, price: 0 }, 300: { on: false, price: 0 } };
    const saved = db.saveCoachingSettings(id, baseSettings({ lengths, savedAt: 111, categoryId: 'cat1' }));
    assert.deepEqual(saved.lengths, lengths);
    assert.equal(saved.prices_saved_at, 111);
    assert.equal(saved.category_id, 'cat1');
    const again = db.saveCoachingSettings(id, baseSettings({ daysOff: [] }));
    assert.deepEqual(again.lengths, lengths, 'a save without lengths keeps them');
    assert.equal(again.category_id, 'cat1');
  });

  test('a booking stores its price and currency; one made without a price keeps NULL', () => {
    const id = addStreamer();
    const a = paidBook(id, 'P1', T, 60).booking;
    assert.equal(a.price_cents, 4500);
    assert.equal(a.currency, 'EUR');
    const b = book(id, 'P2', T + 5 * 60 * MIN, 30).booking;
    assert.equal(b.price_cents, null);
    assert.equal(b.currency, null);
  });

  test('awaiting_payment holds its slot in the overlap; expired frees it', () => {
    const id = addStreamer();
    const a = paidBook(id, 'H1', T, 60).booking;
    const acc = db.acceptCoachingBooking(a.id, id, T - 1000, T - 900000);
    assert.equal(acc.status, 'awaiting_payment');
    assert.equal(acc.accepted_at, T - 1000);
    assert.equal(acc.pay_by, T - 900000);
    assert.equal(db.acceptCoachingBooking(a.id, id, T, null), null, 'only from waiting');
    assert.deepEqual(book(id, 'H2', T + 30 * MIN, 30), { ok: false, code: 'taken' });
    assert.equal(db.expireCoachingBooking(a.id, T - 900001), null, 'not before pay_by');
    assert.equal(db.listExpirableCoachingBookings(T - 900000).length >= 1, true);
    assert.equal(db.expireCoachingBooking(a.id, T - 900000).status, 'expired');
    assert.equal(book(id, 'H2', T + 30 * MIN, 30).ok, true);
  });

  test('accepting a free request confirms it at once', () => {
    const id = addStreamer();
    const a = book(id, 'F1', T, 30).booking;
    const row = db.acceptCoachingBooking(a.id, id, T - 5, null);
    assert.equal(row.status, 'confirmed');
    assert.equal(row.pay_by, null);
  });

  test('a double recordCoachingPayment with the same capture id writes once', () => {
    const id = addStreamer();
    const a = paidBook(id, 'D1', T, 60).booking;
    db.acceptCoachingBooking(a.id, id, T - 5000, T + 1e6);
    db.createCoachingPayment({ orderId: 'ORD1', bookingId: a.id, streamerId: id, amountCents: 4500, currency: 'EUR', payeeEmail: 'c@x.io', now: T - 4000 });
    const first = cap(a.id, 1, T - 3000);
    assert.equal(first.result, 'recorded');
    assert.equal(first.booking.status, 'confirmed');
    assert.equal(first.booking.paid_at, T - 3000);
    assert.equal(first.booking.paypal_capture_id, 'CAP1');
    const second = cap(a.id, 1, T - 1000);
    assert.equal(second.result, 'duplicate');
    assert.equal(db.getCoachingBooking(a.id, id).paid_at, T - 3000);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM coaching_payments WHERE capture_id = ?').get('CAP1').n, 1);
    assert.equal(db.getCoachingPayment('ORD1').status, 'captured');
    assert.equal(db.listOpenCoachingPaymentsFor(a.id).length, 0);
  });

  test('an order of another booking is refused', () => {
    const id = addStreamer();
    const a = paidBook(id, 'M1', T, 60).booking;
    const b = paidBook(id, 'M2', T + 5 * 60 * MIN, 60).booking;
    db.createCoachingPayment({ orderId: 'ORDM', bookingId: a.id, streamerId: id, amountCents: 4500, currency: 'EUR', payeeEmail: 'c@x.io', now: T });
    assert.deepEqual(db.recordCoachingPayment({ bookingId: b.id, orderId: 'ORDM', captureId: 'CAPM', amountCents: 4500, currency: 'EUR', now: T }), { ok: false, code: 'mismatch' });
    assert.equal(db.getCoachingBooking(b.id, id).paid_at, null);
  });

  test('a late capture confirms the booking when its time is still free', () => {
    const id = addStreamer();
    const a = paidBook(id, 'L1', T, 60).booking;
    db.acceptCoachingBooking(a.id, id, T - 9e6, T - 8e6);
    db.expireCoachingBooking(a.id, T - 7e6);
    const r = cap(a.id, 21, T - 6e6);
    assert.equal(r.result, 'late_confirmed');
    assert.equal(r.booking.status, 'confirmed');
    assert.equal(r.booking.payment_issue, null);
  });

  test('a late capture on a taken slot keeps the booking expired and flags it', () => {
    const id = addStreamer();
    const a = paidBook(id, 'L2', T, 60).booking;
    db.acceptCoachingBooking(a.id, id, T - 9e6, T - 8e6);
    db.expireCoachingBooking(a.id, T - 7e6);
    assert.equal(book(id, 'L3', T + 30 * MIN, 30).ok, true);
    const r = cap(a.id, 22, T - 6e6);
    assert.equal(r.result, 'late_issue');
    assert.equal(r.booking.status, 'expired');
    assert.equal(r.booking.payment_issue, 'late');
    assert.equal(r.booking.paid_at, T - 6e6);
    assert.equal(r.booking.paid_amount_cents, 4500);
  });

  test('stale orders list and drop; a captured one is never dropped', () => {
    const id = addStreamer();
    const a = paidBook(id, 'S1', T, 60).booking;
    db.createCoachingPayment({ orderId: 'ORDS1', bookingId: a.id, streamerId: id, amountCents: 4500, currency: 'EUR', payeeEmail: 'c@x.io', now: 1000 });
    assert.equal(db.listStaleCoachingPayments(2000).some((p) => p.order_id === 'ORDS1'), true);
    assert.equal(db.listStaleCoachingPayments(1000).some((p) => p.order_id === 'ORDS1'), false);
    assert.equal(db.deleteOpenCoachingPayment('ORDS1'), true);
    assert.equal(db.getCoachingPayment('ORDS1'), null);
  });
});

describe('coaching rooms', () => {
  test('a room row is made once, updated by field, listed when making, due and to remove', () => {
    const id = addStreamer();
    const room = db.createCoachingRoom({ bookingId: 9001, streamerId: id, guildId: 'g1', categoryId: 'c1', closeAt: 5000, now: 100 });
    assert.equal(room.state, 'making');
    assert.equal(db.createCoachingRoom({ bookingId: 9001, streamerId: id, guildId: 'other', categoryId: 'c9', closeAt: 1, now: 200 }).guild_id, 'g1');
    assert.equal(db.listMakingCoachingRooms(101).length >= 1, true);
    assert.equal(db.listMakingCoachingRooms(100).some((r) => r.booking_id === 9001), false);
    const upd = db.updateCoachingRoom(9001, { role_id: 'r1', channel_id: 'ch1', state: 'open', bogus: 'x' }, 300);
    assert.equal(upd.state, 'open');
    assert.equal(upd.role_id, 'r1');
    assert.equal(upd.updated_at, 300);
    assert.equal(db.listDueCoachingRooms(4999).some((r) => r.booking_id === 9001), false);
    assert.equal(db.listDueCoachingRooms(5000).some((r) => r.booking_id === 9001), true);
    assert.equal(db.listCoachingRoomsToRemove(id).length, 1);
    db.updateCoachingRoom(9001, { state: 'closed' }, 400);
    assert.equal(db.listCoachingRoomsToRemove(id).length, 0);
    assert.equal(db.listCoachingRoomsForBookings([9001]).length, 1);
  });
});

describe('viewer sessions', () => {
  test('a viewer session is found by its raw id, stored hashed, and not after it expires', () => {
    const v = { discordUserId: '111', username: 'vi', displayName: 'Vi', avatar: 'a.png' };
    db.createViewerSession('raw-sid-1', v, Date.now() + 60000);
    const row = db.getViewerSession('raw-sid-1');
    assert.equal(row.discord_user_id, '111');
    assert.equal(row.discord_display_name, 'Vi');
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM viewer_sessions WHERE sid = 'raw-sid-1'").get().n, 0);
    assert.equal(sql.prepare('SELECT sid FROM viewer_sessions').get().sid, db.hashSessionId('raw-sid-1'));
    db.createViewerSession('raw-sid-2', v, Date.now() - 1);
    assert.equal(db.getViewerSession('raw-sid-2'), null);
    db.cleanExpiredViewerSessions();
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM viewer_sessions').get().n, 1);
    db.deleteViewerSession('raw-sid-1');
    assert.equal(db.getViewerSession('raw-sid-1'), null);
  });
});
