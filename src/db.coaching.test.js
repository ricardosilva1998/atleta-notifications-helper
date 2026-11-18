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

  test('a pending payment is kept: never listed as stale, never deleted, read when due, closed with its row kept', () => {
    const id = addStreamer();
    const a = paidBook(id, 'P1', T, 60).booking;
    db.createCoachingPayment({ orderId: 'ORDP1', bookingId: a.id, streamerId: id, amountCents: 4500, currency: 'EUR', payeeEmail: 'c@x.io', now: 1000 });
    assert.equal(db.markCoachingPaymentPending('ORDP1', 1500, 5000), true);
    assert.equal(db.markCoachingPaymentPending('ORDP1', 2500, 6000), true);
    const row = db.getCoachingPayment('ORDP1');
    assert.deepEqual([row.status, row.pending_since, row.next_read_at], ['pending', 1500, 6000], 'first sighting is kept');
    assert.equal(db.listStaleCoachingPayments(10 ** 9).some((p) => p.order_id === 'ORDP1'), false);
    assert.equal(db.listOpenCoachingPaymentsFor(a.id).length, 0);
    assert.equal(db.deleteOpenCoachingPayment('ORDP1'), false);
    assert.ok(db.getCoachingPayment('ORDP1'));
    assert.deepEqual(db.listDueCoachingPendingPayments(5999), []);
    assert.equal(db.listDueCoachingPendingPayments(6000).length, 1);
    assert.deepEqual([...db.pendingCoachingPaymentBookingIds([a.id, 999])], [a.id]);
    assert.equal(db.closeCoachingPayment('ORDP1'), true);
    assert.equal(db.getCoachingPayment('ORDP1').status, 'closed');
    assert.equal(db.pendingCoachingPaymentBookingIds([a.id]).size, 0);
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

describe('coaching reschedule and refunds', () => {
  const NOW = T - 2 * 24 * 3600e3;
  const START = T + 3 * 24 * 3600e3;
  const confirmed = (id, v, startsAt, minutes = 60, paid = false) => {
    const b = db.createCoachingBooking({ streamerId: id, viewer: viewer(v), startsAt, minutes, note: null, lang: 'en', now: NOW, priceCents: paid ? 4500 : 0, currency: 'EUR' }).booking;
    if (!paid) return db.acceptCoachingBooking(b.id, id, NOW, null);
    db.acceptCoachingBooking(b.id, id, NOW, NOW + 1e6);
    db.createCoachingPayment({ orderId: `RO${b.id}`, bookingId: b.id, streamerId: id, amountCents: 4500, currency: 'EUR', payeeEmail: 'c@x.io', now: NOW });
    db.recordCoachingPayment({ bookingId: b.id, orderId: `RO${b.id}`, captureId: `RC${b.id}`, amountCents: 4500, currency: 'EUR', now: NOW, payer: { name: 'Pat Payer', email: 'pat@x.io', payerId: 'PID1' } });
    return db.getCoachingBooking(b.id, id);
  };
  const held = (id) => db.getHeldCoachingBookings(id, NOW);

  test('the new columns exist on both tables', () => {
    const b = sql.prepare('PRAGMA table_info(coaching_bookings)').all().map((c) => c.name);
    for (const c of ['reschedule_started_at', 'reschedule_way', 'proposal_starts_at', 'proposal_by', 'proposal_at', 'proposal_note', 'cancel_reason', 'original_starts_at']) assert.ok(b.includes(c), c);
    const p = sql.prepare('PRAGMA table_info(coaching_payments)').all().map((c) => c.name);
    for (const c of ['payer_name', 'payer_email', 'payer_id', 'refund_status', 'refund_reason', 'refund_pending_at', 'refunded_at']) assert.ok(p.includes(c), c);
  });

  test('a rescheduling row holds its proposal and not its original time', () => {
    const id = addStreamer();
    const b = confirmed(id, 'R1', START);
    const r = db.startCoachingReschedule(b.id, id, 'propose', { startsAt: START + 5 * 3600e3, note: 'n' }, NOW);
    assert.equal(r.ok, true);
    assert.equal(r.booking.status, 'rescheduling');
    assert.equal(r.booking.original_starts_at, START);
    assert.equal(r.booking.starts_at, START);
    assert.deepEqual(held(id).map((h) => h.startsAt), [START + 5 * 3600e3]);
    assert.equal(book(id, 'R2', START, 60, NOW).ok, true, 'the original time is free');
    assert.deepEqual(book(id, 'R3', START + 5 * 3600e3, 60, NOW), { ok: false, code: 'taken' });
  });

  test('way ask holds nothing; a rescheduling row still counts as upcoming for the viewer', () => {
    const id = addStreamer();
    const b = confirmed(id, 'A1', START);
    assert.equal(db.startCoachingReschedule(b.id, id, 'ask', null, NOW).ok, true);
    assert.equal(held(id).length, 0);
    assert.equal(book(id, 'A1', START + 3600e3 * 2, 60, NOW).ok, true);
    assert.deepEqual(book(id, 'A1', START + 3600e3 * 4, 60, NOW), { ok: false, code: 'limit' });
  });

  test('startCoachingReschedule only from a confirmed session before its start, and a taken proposal is refused', () => {
    const id = addStreamer();
    const b = confirmed(id, 'S1', START);
    assert.equal(db.startCoachingReschedule(b.id, id, 'ask', null, START + 1).code, 'not_confirmed');
    const other = confirmed(id, 'S2', START + 10 * 3600e3);
    assert.equal(db.startCoachingReschedule(b.id, id, 'propose', { startsAt: other.starts_at + 30 * MIN }, NOW).code, 'taken');
    assert.equal(db.getCoachingBooking(b.id, id).status, 'confirmed');
    assert.equal(db.startCoachingReschedule(b.id, id + 99, 'ask', null, NOW).code, 'not_confirmed');
    assert.equal(db.startCoachingReschedule(b.id, id, 'ask', null, NOW).ok, true);
    assert.equal(db.startCoachingReschedule(b.id, id, 'ask', null, NOW).code, 'not_confirmed');
  });

  test('two overlapping proposals or a proposal and a request: exactly one wins', () => {
    const id = addStreamer();
    const a = confirmed(id, 'P1', START);
    const b = confirmed(id, 'P2', START + 8 * 3600e3);
    db.startCoachingReschedule(a.id, id, 'ask', null, NOW);
    db.startCoachingReschedule(b.id, id, 'ask', null, NOW);
    const slot = START + 20 * 3600e3;
    assert.equal(db.proposeCoachingTime(a.id, 'coach', slot, null, NOW).ok, true);
    assert.equal(db.proposeCoachingTime(b.id, 'coach', slot + 30 * MIN, null, NOW).code, 'taken');
    assert.deepEqual(book(id, 'P3', slot, 60, NOW), { ok: false, code: 'taken' });
    assert.equal(db.proposeCoachingTime(a.id, 'viewer', slot + 30 * MIN, null, NOW).ok, true, 'a proposal may replace its own');
    assert.equal(db.proposeCoachingTime(b.id, 'viewer', slot + 5 * MIN * 12 + 60 * MIN, null, NOW).ok, true);
    assert.equal(db.proposeCoachingTime(999999, 'coach', slot, null, NOW).code, 'not_rescheduling');
  });

  test('only the side that did not propose can accept; the proposal becomes the time', () => {
    const id = addStreamer();
    const b = confirmed(id, 'AC1', START);
    db.startCoachingReschedule(b.id, id, 'propose', { startsAt: START + 6 * 3600e3 }, NOW);
    assert.equal(db.acceptCoachingProposal(b.id, 'coach', NOW).code, 'own_proposal');
    const ok = db.acceptCoachingProposal(b.id, 'viewer', NOW);
    assert.equal(ok.ok, true);
    assert.equal(ok.booking.status, 'confirmed');
    assert.equal(ok.booking.starts_at, START + 6 * 3600e3);
    assert.equal(ok.booking.proposal_starts_at, null);
    assert.equal(db.acceptCoachingProposal(b.id, 'viewer', NOW).code, 'not_rescheduling');
    const c = confirmed(id, 'AC2', START + 30 * 3600e3);
    db.startCoachingReschedule(c.id, id, 'ask', null, NOW);
    assert.equal(db.acceptCoachingProposal(c.id, 'viewer', NOW).code, 'no_proposal');
    db.proposeCoachingTime(c.id, 'viewer', START + 40 * 3600e3, null, NOW);
    assert.equal(db.acceptCoachingProposal(c.id, 'viewer', NOW).code, 'own_proposal');
    assert.equal(db.acceptCoachingProposal(c.id, 'coach', START + 40 * 3600e3 - 10 * MIN).code, 'too_close');
    assert.equal(db.acceptCoachingProposal(c.id, 'coach', NOW).ok, true);
  });

  test('dropCoachingProposal frees the time and switches to asking', () => {
    const id = addStreamer();
    const b = confirmed(id, 'D1', START);
    db.startCoachingReschedule(b.id, id, 'propose', { startsAt: START + 6 * 3600e3 }, NOW);
    assert.equal(db.dropCoachingProposal(b.id, NOW + 1).code, 'not_due');
    const r = db.dropCoachingProposal(b.id, NOW + 49 * 3600e3);
    assert.equal(r.ok, true);
    assert.equal(r.dropped.by, 'coach');
    assert.equal(r.booking.reschedule_way, 'ask');
    assert.equal(held(id).length, 0);
    assert.equal(db.dropCoachingProposal(b.id, NOW + 49 * 3600e3).code, 'no_proposal');
  });

  test('coach cancel of a paid booking stores the reason and marks its captured payment pending, with the payer saved', () => {
    const id = addStreamer();
    const b = confirmed(id, 'C1', START, 60, true);
    assert.equal(db.getCoachingPayment(`RO${b.id}`).payer_email, 'pat@x.io');
    assert.equal(db.getCoachingPayment(`RO${b.id}`).refund_status, null);
    const r = db.cancelCoachingBookingByCoach(b.id, id, 'I am ill', NOW);
    assert.equal(r.ok, true);
    assert.equal(r.refundPending, true);
    assert.equal(r.booking.status, 'cancelled');
    assert.equal(r.booking.cancel_reason, 'I am ill');
    const p = db.getCoachingPayment(`RO${b.id}`);
    assert.equal(p.refund_status, 'pending');
    assert.equal(p.refund_reason, 'cancelled');
    assert.equal(p.refund_pending_at, NOW);
    assert.equal(db.countPendingCoachingRefunds(id), 1);
    assert.equal(db.listPendingCoachingRefunds(id)[0].payer_name, 'Pat Payer');
    assert.equal(db.cancelCoachingBookingByCoach(b.id, id, 'again', NOW).code, 'not_cancellable');
  });

  test('coach cancel: a free one has no refund, another streamer cannot, a started one cannot, a rescheduling one can', () => {
    const id = addStreamer();
    const f = confirmed(id, 'C2', START);
    assert.equal(db.cancelCoachingBookingByCoach(f.id, id + 50, 'x', NOW).code, 'not_cancellable');
    assert.equal(db.cancelCoachingBookingByCoach(f.id, id, 'x', START + 1).code, 'not_cancellable');
    const r = db.cancelCoachingBookingByCoach(f.id, id, 'x', NOW);
    assert.equal(r.ok, true);
    assert.equal(r.refundPending, false);
    const g = confirmed(id, 'C3', START + 20 * 3600e3);
    db.startCoachingReschedule(g.id, id, 'ask', null, NOW);
    assert.equal(db.cancelCoachingBookingByCoach(g.id, id, 'x', START + 99 * 3600e3).ok, true);
  });

  test('closeCoachingReschedule: not_rescheduled, paid payment pending, the held proposal freed', () => {
    const id = addStreamer();
    const b = confirmed(id, 'X1', START, 60, true);
    db.startCoachingReschedule(b.id, id, 'propose', { startsAt: START + 6 * 3600e3 }, NOW);
    const r = db.closeCoachingReschedule(b.id, NOW + 7 * 86400e3);
    assert.equal(r.ok, true);
    assert.equal(r.booking.status, 'not_rescheduled');
    assert.equal(r.refundPending, true);
    assert.equal(db.getCoachingPayment(`RO${b.id}`).refund_reason, 'not_rescheduled');
    assert.equal(held(id).length, 0);
    assert.equal(db.closeCoachingReschedule(b.id, NOW).code, 'not_rescheduling');
  });

  test('late and double captures mark their own payment pending with the payer saved; recorded and late_confirmed do not', () => {
    const id = addStreamer();
    const a = db.createCoachingBooking({ streamerId: id, viewer: viewer('LD1'), startsAt: START, minutes: 60, note: null, lang: 'en', now: NOW, priceCents: 4500, currency: 'EUR' }).booking;
    db.acceptCoachingBooking(a.id, id, NOW - 9e6, NOW - 8e6);
    db.expireCoachingBooking(a.id, NOW - 7e6);
    book(id, 'LD2', START + 30 * MIN, 30, NOW);
    const payer = { name: 'Lee', email: 'lee@x.io', payerId: 'P2' };
    const late = db.recordCoachingPayment({ bookingId: a.id, orderId: 'LDO1', captureId: 'LDC1', amountCents: 4500, currency: 'EUR', now: NOW, payer });
    assert.equal(late.result, 'late_issue');
    const lp = db.getCoachingPayment('LDO1');
    assert.equal(lp.refund_status, 'pending');
    assert.equal(lp.refund_reason, 'late');
    assert.equal(lp.payer_email, 'lee@x.io');
    const b = confirmed(id, 'LD3', START + 40 * 3600e3, 60, true);
    const dbl = db.recordCoachingPayment({ bookingId: b.id, orderId: 'LDO2', captureId: 'LDC2', amountCents: 4500, currency: 'EUR', now: NOW });
    assert.equal(dbl.result, 'double');
    assert.equal(db.getCoachingPayment('LDO2').refund_reason, 'double');
    assert.equal(dbl.booking.payment_issue, null, 'double lives on the payment, never on the booking');
    assert.equal(dbl.booking.status, 'confirmed');
    assert.equal(db.getCoachingPayment('LDO2').payer_name, null);
    assert.equal(db.getCoachingPayment(`RO${b.id}`).refund_status, null);
    const c = confirmed(id, 'LD4', START + 60 * 3600e3, 60, true);
    assert.equal(db.getCoachingPayment(`RO${c.id}`).refund_status, null);
  });

  test('a capture for an awaiting booking whose start has passed is late: Refund pending, never confirmed', () => {
    const id = addStreamer();
    const a = db.createCoachingBooking({ streamerId: id, viewer: viewer('PS1'), startsAt: START, minutes: 60, note: null, lang: 'en', now: NOW, priceCents: 4500, currency: 'EUR' }).booking;
    db.acceptCoachingBooking(a.id, id, NOW, START - 3600e3);
    const r = db.recordCoachingPayment({ bookingId: a.id, orderId: 'PSO1', captureId: 'PSC1', amountCents: 4500, currency: 'EUR', now: START + 60000 });
    assert.equal(r.result, 'late_issue');
    assert.notEqual(r.booking.status, 'confirmed');
    assert.equal(r.booking.payment_issue, 'late');
    assert.equal(db.getCoachingPayment('PSO1').refund_status, 'pending');
  });

  test('markCoachingRefunded only from pending and only for the payment\'s streamer', () => {
    const id = addStreamer();
    const b = confirmed(id, 'MR1', START, 60, true);
    assert.equal(db.markCoachingRefunded(`RO${b.id}`, id, NOW), null, 'not pending yet');
    db.cancelCoachingBookingByCoach(b.id, id, 'x', NOW);
    assert.equal(db.markCoachingRefunded(`RO${b.id}`, id + 77, NOW), null);
    const p = db.markCoachingRefunded(`RO${b.id}`, id, NOW + 5);
    assert.equal(p.refund_status, 'refunded');
    assert.equal(p.refunded_at, NOW + 5);
    assert.equal(db.markCoachingRefunded(`RO${b.id}`, id, NOW + 9), null);
    assert.equal(db.countPendingCoachingRefunds(id), 0);
  });

  test('listDueReschedules finds the 7-day, 48 h and too-close cases, and listDueCoachingRooms skips a rescheduling booking', () => {
    const id = addStreamer();
    const a = confirmed(id, 'DU1', START);
    const b = confirmed(id, 'DU2', START + 10 * 3600e3);
    const c = confirmed(id, 'DU3', START + 20 * 3600e3);
    db.startCoachingReschedule(a.id, id, 'ask', null, NOW);
    db.startCoachingReschedule(b.id, id, 'propose', { startsAt: START + 50 * 3600e3 }, NOW);
    db.startCoachingReschedule(c.id, id, 'propose', { startsAt: START + 60 * 3600e3 }, NOW);
    const mine = new Set([a.id, b.id, c.id]);
    const due = (now) => db.listDueReschedules(now).map((r) => r.id).filter((x) => mine.has(x)).sort();
    assert.equal(due(NOW + 3600e3).length, 0);
    assert.deepEqual(due(NOW + 49 * 3600e3), [b.id, c.id].sort());
    assert.deepEqual(due(NOW + 7 * 86400e3), [a.id, b.id, c.id].sort());
    assert.deepEqual(due(START + 50 * 3600e3 - 30 * MIN), [a.id, b.id, c.id].sort());
    db.createCoachingRoom({ bookingId: a.id, streamerId: id, guildId: 'g', categoryId: null, closeAt: NOW + 5, now: NOW });
    db.updateCoachingRoom(a.id, { state: 'open' }, NOW);
    const mineRooms = () => db.listDueCoachingRooms(NOW + 10).filter((r) => r.streamer_id === id).map((r) => r.booking_id);
    assert.equal(mineRooms().length, 0);
    db.updateCoachingRoomClose(a.id, NOW + 99);
    assert.equal(db.getCoachingRoom(a.id).close_at, NOW + 99);
    db.dropCoachingProposal(b.id, NOW);
    db.acceptCoachingProposal(c.id, 'viewer', NOW);
    db.createCoachingRoom({ bookingId: c.id, streamerId: id, guildId: 'g', categoryId: null, closeAt: NOW + 5, now: NOW });
    db.updateCoachingRoom(c.id, { state: 'open' }, NOW);
    assert.deepEqual(mineRooms(), [c.id]);
  });

  test('the 90-day cleanup removes payments, with the payer details, with their booking', () => {
    const id = addStreamer();
    const b = confirmed(id, 'CL1', START, 60, true);
    db.cleanupOldCoachingBookings(START + 91 * 86400e3 + 3600e3);
    assert.equal(db.getCoachingPayment(`RO${b.id}`), null);
  });
});

describe('getViewerBookingsAllCoaches', () => {
  test('lists one viewer\'s bookings with every coach from the since time, with the coach and availability', () => {
    const c1 = addStreamer();
    const c2 = addStreamer();
    const noSettings = addStreamer();
    db.saveCoachingSettings(c1, baseSettings());
    db.saveCoachingSettings(c2, baseSettings());
    const VIEW = '500000000000000001';
    const day = 86400e3;
    book(c1, VIEW, T + 2 * day, 60);
    book(c2, VIEW, T + 3 * day, 60);
    book(noSettings, VIEW, T + 4 * day, 60);
    book(c1, VIEW, T - 100 * day, 60);
    book(c1, '500000000000000002', T + 5 * day, 60);
    sql.prepare('UPDATE streamers SET twitch_username = ?, twitch_display_name = ? WHERE id = ?').run('login_one', 'Coach One', c1);
    sql.prepare('UPDATE streamers SET enabled = 0 WHERE id = ?').run(c2);
    const rows = db.getViewerBookingsAllCoaches(VIEW, T - 90 * day);
    assert.equal(rows.length, 3, 'the old one and the other viewer\'s are left out');
    assert.deepEqual(rows.map((r) => r.streamer_id), [c1, c2, noSettings], 'in start order');
    assert.equal(rows[0].coach_login, 'login_one');
    assert.equal(rows[0].coach_name, 'Coach One');
    assert.deepEqual(rows.map((r) => r.coach_available), [1, 0, 0]);
    const plan = sql.prepare('EXPLAIN QUERY PLAN SELECT * FROM coaching_bookings WHERE viewer_discord_id = ? AND starts_at >= ?').all(VIEW, 0);
    assert.ok(plan.some((p) => /idx_coaching_bookings_viewer/.test(p.detail)));
  });
});
