'use strict';

// Coaching payments (services/coachingPayments.js) against the real src/db.js on in-memory SQLite, the real
// services/paypal.js over a fake fetch standing in for PayPal, and a fake src/discord.js: nothing leaves the machine.
// All names, ids, emails and amounts are synthetic.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) {
  process.env[key] = process.env[key] || 'test';
}
const { escapeLinkText } = require('../discord');

const DB_FILE = path.join(__dirname, '..', 'db.js');
const PAYMENTS = path.join(__dirname, 'coachingPayments.js');
const SERVICE = path.join(__dirname, 'coachingBookings.js');
const MSG = path.join(__dirname, 'coachingMessages.js');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');
const PAYPAL = 'https://paypal.test';
const MERCHANT = 'MERCHANTCOACH1';

const discord = {
  sent: [],
  async sendDirectMessage(userId, payload) { this.sent.push({ userId, payload }); return { ok: true }; },
  async isGuildMember() { return true; },
  async fetchInvite() { return { ok: false, reason: 'unavailable' }; },
  guildName() { return 'Coach HQ'; },
  escapeLinkText,
};
const rooms = { made: [], async makeFor(id) { this.made.push(id); return null; } };
// Tip side effects: any of these modules required by the coaching files is a failure, and so is any overlay event.
const TIP_MODULES = ['tipGoals', 'tipVoice', 'trackers', 'twitchChat', 'tipCapture', '../routes/tip', 'overlayBus'];
const tipRequires = [];

let db;
let pay;
let svc;
let bus;
const busEvents = [];
const logs = [];
const saved = {};

// ── Fake PayPal ──────────────────────────────────────────────────────

let paypal;
let nextOrder = 1; // across tests: an order id is never reused
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// The order PayPal holds: what was asked for at creation, and whether it was captured.
function completed(order, over = {}) {
  return {
    id: order.id,
    status: 'COMPLETED',
    ...(over.payer ? { payer: over.payer } : {}),
    purchase_units: [{
      reference_id: 'default',
      custom_id: over.customId !== undefined ? over.customId : order.customId,
      payee: over.payee || { email_address: order.payeeEmail, merchant_id: MERCHANT },
      payments: {
        captures: [{
          id: `CAP-${order.id}`,
          status: over.captureStatus || 'COMPLETED',
          amount: { currency_code: over.currency || order.currency, value: over.value || order.value },
        }],
      },
    }],
  };
}
function approved(order) {
  return { id: order.id, status: order.approved ? 'APPROVED' : 'CREATED', purchase_units: [{ custom_id: order.customId, payee: { email_address: order.payeeEmail, merchant_id: MERCHANT } }] };
}

function resetPayPal() {
  paypal = {
    calls: [],
    orders: new Map(),
    down: false,
    // Per test: what a capture and a read answer for an order (default: a capture completes as asked).
    capture: (order) => { order.captured = true; return reply(201, completed(order)); },
    getOrder: (order) => reply(200, order.captured ? completed(order) : approved(order)),
  };
}

async function fakeFetch(url, opts = {}) {
  url = String(url);
  if (!url.startsWith(`${PAYPAL}/`)) throw new Error(`unexpected request to ${url}`);
  paypal.calls.push({ url, method: opts.method || 'GET', prefer: opts.headers && opts.headers.Prefer, timeout: opts.signal instanceof AbortSignal, body: opts.body });
  if (paypal.down) throw new Error('fetch failed');
  if (url === `${PAYPAL}/v1/oauth2/token`) return reply(200, { access_token: 'test-token' });
  if (url === `${PAYPAL}/v2/checkout/orders`) {
    const unit = JSON.parse(opts.body).purchase_units[0];
    const id = `COACHORDER${String(nextOrder++).padStart(6, '0')}`;
    const order = { id, customId: unit.custom_id, payeeEmail: unit.payee.email_address, currency: unit.amount.currency_code, value: unit.amount.value, captured: false };
    paypal.orders.set(id, order);
    return reply(201, {
      id, status: 'CREATED',
      purchase_units: [{ reference_id: 'default', custom_id: unit.custom_id, amount: unit.amount, payee: { email_address: unit.payee.email_address, merchant_id: MERCHANT } }],
      links: [{ rel: 'approve', href: paypal.approveHost ? `${paypal.approveHost}/checkoutnow?token=${id}` : `https://www.paypal.com/checkoutnow?token=${id}` }],
    });
  }
  const m = url.match(/\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/);
  const order = m && paypal.orders.get(decodeURIComponent(m[1]));
  if (!order) return reply(404, { name: 'RESOURCE_NOT_FOUND' });
  return m[2] ? paypal.capture(order) : paypal.getOrder(order);
}
const captureCalls = () => paypal.calls.filter((c) => c.url.endsWith('/capture'));

// ── Setup ────────────────────────────────────────────────────────────

before(() => {
  saved.load = Module._load.bind(Module);
  const ours = [PAYMENTS, SERVICE, MSG];
  Module._load = function (request, parent, isMain) {
    const from = parent && parent.filename;
    if (from === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
      if (request === './config') return { adminDiscordIds: [] };
    }
    if (ours.includes(from)) {
      if (TIP_MODULES.some((name) => request.endsWith(name))) tipRequires.push(`${path.basename(from)} -> ${request}`);
      if (request === '../discord') return discord;
      if (request === '../config') return { app: { url: 'https://atleta.test' }, paypal: { clientId: 'test-client', clientSecret: 'test-secret', baseUrl: PAYPAL } };
      if (request === './coachingRooms') return rooms;
    }
    return saved.load(request, parent, isMain);
  };
  saved.log = console.log;
  saved.error = console.error;
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => logs.push(args.join(' '));
  try {
    for (const f of [DB_FILE, PAYMENTS, SERVICE, MSG]) delete require.cache[f];
    db = require(DB_FILE);
    svc = require(SERVICE);
    pay = require(PAYMENTS);
  } finally {
    Module._load = saved.load;
  }
  bus = require('./overlayBus');
  saved.emit = bus.emit;
  bus.emit = function (...args) { busEvents.push(args[0]); return saved.emit.apply(this, args); };
  saved.fetch = global.fetch;
  global.fetch = fakeFetch;
});

after(() => {
  global.fetch = saved.fetch;
  bus.emit = saved.emit;
  console.log = saved.log;
  console.error = saved.error;
});

beforeEach(() => {
  resetPayPal();
  discord.sent = [];
  rooms.made = [];
  logs.length = 0;
  busEvents.length = 0;
  svc.forgetMembers();
  db.db.exec('DELETE FROM coaching_payments; DELETE FROM coaching_bookings;'); // each test sees only its own bookings
});

const HOURS = Array.from({ length: 7 }, () => ({ on: true, start: 1080, end: 1320 })); // every day 18:00-22:00
const HOUR = 3600e3;
const MIN = 60e3;
const NOW = Date.UTC(2026, 10, 2, 12, 0); // Monday 12:00 Lisbon (UTC+0)
const START = Date.UTC(2026, 10, 3, 18, 0); // Tuesday 18:00
let counter = 0;

function addStreamer({ currency = 'EUR' } = {}) {
  const n = ++counter;
  const email = `Coach-${n}@Example.com`;
  const id = Number(db.db.prepare(`INSERT INTO streamers (discord_user_id, discord_username, twitch_username, twitch_display_name, paypal_email, donation_currency)
    VALUES (?, ?, ?, ?, ?, ?)`).run(`3000000000000${String(n).padStart(5, '0')}`, `s${n}`, `coach${n}`, `Coach${n}`, email, currency).lastInsertRowid);
  db.db.prepare('INSERT INTO guilds (guild_id, streamer_id, guild_name) VALUES (?, ?, ?)').run('123', id, 'HQ');
  db.saveCoachingSettings(id, { timeZone: 'Europe/Lisbon', hours: HOURS, daysOff: [], guildId: '123', inviteCode: 'abc', whereText: 'Voice', notifyRequests: 1, lang: 'en' });
  return db.getStreamerById(id);
}
const viewer = (n) => ({ discordUserId: `4000000000000${String(n).padStart(5, '0')}`, username: `u${n}`, displayName: `U ${n}`, avatar: null });

// A booking of 2 h (EUR 45.00 by default) the streamer accepted: awaiting payment until NOW + 2 h.
let viewers = 0;
async function awaiting(streamer, { startsAt = START } = {}) {
  const v = viewer(++viewers);
  const r = await svc.request(streamer, v, { startsAt, minutes: 120, note: '', lang: 'en' }, { now: NOW });
  assert.ok(r.ok, r.code);
  const a = await svc.accept(streamer, r.booking.id, { now: NOW });
  assert.equal(a.booking.status, 'awaiting_payment');
  discord.sent = [];
  return { booking: a.booking, viewer: v };
}
// ... and its PayPal order, the viewer sent to PayPal.
async function ordered(streamer, opts) {
  const { booking, viewer: v } = await awaiting(streamer, opts);
  const started = await pay.startPayment(streamer, v, booking.id, { lang: 'en', now: NOW + MIN });
  assert.equal(started.ok, true, started.code);
  const orderId = new URL(started.approveUrl).searchParams.get('token');
  return { booking, viewer: v, orderId, order: paypal.orders.get(orderId) };
}
const bookingNow = (id) => db.getCoachingBookingById(id);
const donations = () => db.db.prepare('SELECT COUNT(*) AS n FROM donations').get().n;
const overlayEvents = () => db.db.prepare('SELECT COUNT(*) AS n FROM overlay_events').get().n;
function assertNoTipEffects() {
  assert.equal(donations(), 0, 'no donations row');
  assert.equal(overlayEvents(), 0, 'no overlay event');
  assert.deepEqual(busEvents, [], 'nothing on the overlay bus (no tip alert, goal, tracker)');
  assert.deepEqual(tipRequires, [], 'the coaching files load none of the tip modules');
}
function assertUnpaid(id) {
  const row = bookingNow(id);
  assert.equal(row.status, 'awaiting_payment');
  assert.equal(row.paid_at, null);
  assert.equal(row.paypal_capture_id, null);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM coaching_payments WHERE booking_id = ? AND status = 'captured'").get(id).n, 0);
}

// ── The decision, pure ───────────────────────────────────────────────

describe('decideCoachingCapture', () => {
  const streamer = { id: 7, paypal_email: 'coach@example.com' };
  const booking = { id: 31, streamer_id: 7, price_cents: 4500, currency: 'EUR' };
  const payment = { order_id: 'ORDER0000001', booking_id: 31, streamer_id: 7, amount_cents: 4500, currency: 'EUR', payee_email: 'coach@example.com', payee_merchant_id: null };
  const order = { id: 'ORDER0000001', customId: '31', payeeEmail: 'COACH@example.com', currency: 'EUR', value: '45.00' };
  const decide = (over = {}) => pay.decideCoachingCapture({ streamer, booking, payment, order: completed(order), ...over });

  test('a completed capture to the streamer, of the booking\'s amount and currency, counts', () => {
    assert.deepEqual(decide(), { ok: true, captureId: 'CAP-ORDER0000001', amountCents: 4500, currency: 'EUR', payer: null });
  });

  test('the payer of a verified order is read: name from given name and surname, email, payer id', () => {
    const payer = { name: { given_name: 'Pat', surname: 'Payer' }, email_address: 'pat@example.com', payer_id: 'PAYERID001' };
    assert.deepEqual(decide({ order: completed(order, { payer }) }).payer, { name: 'Pat Payer', email: 'pat@example.com', payerId: 'PAYERID001' });
    assert.deepEqual(decide({ order: completed(order, { payer: { email_address: 'only@example.com' } }) }).payer, { name: null, email: 'only@example.com', payerId: null });
    assert.equal(decide({ order: completed(order, { payer: {} }) }).payer, null);
  });

  test('wrong payee, amount, currency, booking, order or streamer is refused', () => {
    const reason = (over) => decide(over).reason;
    assert.equal(reason({ order: completed(order, { payee: { email_address: 'someone@example.com' } }) }), 'payee_mismatch');
    assert.equal(reason({ order: completed(order, { payee: {} }) }), 'payee_mismatch');
    const withMerchant = { ...payment, payee_merchant_id: 'MERCHANTA' };
    assert.equal(reason({ payment: withMerchant, order: completed(order, { payee: { email_address: 'coach@example.com', merchant_id: 'MERCHANTB' } }) }), 'payee_mismatch',
      'the account id wins over a matching email');
    assert.equal(decide({ payment: withMerchant, order: completed(order, { payee: { email_address: 'other@example.com', merchant_id: 'MERCHANTA' } }) }).ok, true,
      'another address of the same account counts');
    assert.equal(reason({ order: completed(order, { value: '44.99' }) }), 'amount_mismatch');
    assert.equal(reason({ order: completed(order, { value: '45.001' }) }), 'amount_mismatch');
    assert.equal(reason({ order: completed(order, { value: '4500' }) }), 'amount_mismatch');
    assert.equal(reason({ order: completed(order, { currency: 'USD' }) }), 'currency_mismatch');
    assert.equal(reason({ order: completed(order, { customId: '32' }) }), 'booking_mismatch');
    assert.equal(reason({ order: { ...completed(order), id: 'ORDER0000002' } }), 'order_mismatch');
    assert.equal(reason({ streamer: { id: 8 } }), 'streamer_mismatch');
    assert.equal(reason({ booking: { ...booking, id: 99 } }), 'booking_mismatch');
    assert.equal(reason({ booking: { ...booking, price_cents: 2500 } }), 'amount_mismatch', 'the booking\'s own price too');
    assert.equal(reason({ payment: null }), 'no_order');
  });

  test('an order not completed, a capture declined or pending is not counted', () => {
    assert.equal(decide({ order: { ...completed(order), status: 'APPROVED' } }).reason, 'not_completed');
    assert.equal(decide({ order: completed(order, { captureStatus: 'DECLINED' }) }).reason, 'not_completed');
    assert.equal(decide({ order: completed(order, { captureStatus: 'PENDING' }) }).reason, 'pending');
    assert.equal(decide({ order: null }).reason, 'not_completed');
    assert.equal(decide({ order: { name: 'UNPROCESSABLE_ENTITY' } }).reason, 'not_completed');
  });

  test('centsOf reads plain amounts only', () => {
    assert.equal(pay.centsOf('45.00'), 4500);
    assert.equal(pay.centsOf('45.5'), 4550);
    assert.equal(pay.centsOf('45'), 4500);
    for (const bad of ['', '-1.00', '1e3', '45.001', ' 45', 45]) assert.equal(pay.centsOf(bad), null, String(bad));
  });
});

// ── Pay ──────────────────────────────────────────────────────────────

describe('startPayment', () => {
  test('makes a PayPal order to the streamer\'s PayPal email for the booking\'s price, with the booking\'s id', async () => {
    const s = addStreamer();
    const { booking, orderId } = await ordered(s);
    const create = paypal.calls.find((c) => c.url === `${PAYPAL}/v2/checkout/orders`);
    assert.equal(create.prefer, 'return=representation');
    assert.ok(paypal.calls.every((c) => c.timeout), 'every PayPal call has a deadline');
    const unit = JSON.parse(create.body).purchase_units[0];
    assert.deepEqual(unit.amount, { currency_code: 'EUR', value: '45.00' });
    assert.equal(unit.payee.email_address, s.paypal_email);
    assert.equal(unit.custom_id, String(booking.id));
    const body = JSON.parse(create.body);
    assert.equal(body.application_context.return_url, 'https://atleta.test/coaching/-/paid');
    assert.equal(body.application_context.cancel_url, 'https://atleta.test/my-bookings');
    const row = db.getCoachingPayment(orderId);
    assert.deepEqual([row.booking_id, row.streamer_id, row.amount_cents, row.currency, row.payee_email, row.payee_merchant_id, row.status],
      [booking.id, s.id, 4500, 'EUR', s.paypal_email, MERCHANT, 'created']);
    assertUnpaid(booking.id);
  });

  test('only the booking\'s own viewer, while it awaits payment and before its deadline', async () => {
    const s = addStreamer();
    const { booking, viewer: v } = await awaiting(s);
    assert.deepEqual(await pay.startPayment(s, viewer(999), booking.id, { now: NOW }), { ok: false, code: 'not_found' });
    assert.deepEqual(await pay.startPayment(addStreamer(), v, booking.id, { now: NOW }), { ok: false, code: 'not_found' }, "through another streamer's page");
    assert.deepEqual(await pay.startPayment(s, v, booking.id, { now: booking.pay_by }), { ok: false, code: 'pay_closed' });
    const r = await svc.request(s, viewer(++viewers), { startsAt: START + 24 * HOUR, minutes: 120, note: '', lang: 'en' }, { now: NOW });
    assert.deepEqual(await pay.startPayment(s, viewer(viewers), r.booking.id, { now: NOW }), { ok: false, code: 'not_awaiting' }, 'not accepted yet');
    assert.deepEqual(await pay.startPayment({ ...s, paypal_email: null }, v, booking.id, { now: NOW }), { ok: false, code: 'no_paypal' });
    assert.equal(paypal.calls.length, 0);
  });

  test('an approve link that is not a PayPal page is never handed on, and no order is stored', async () => {
    const s = addStreamer();
    const { booking, viewer: v } = await awaiting(s);
    for (const host of ['https://evil.example', 'https://paypal.com.evil.example', 'http://www.paypal.com', 'https://evilpaypal.com']) {
      paypal.approveHost = host;
      assert.deepEqual(await pay.startPayment(s, v, booking.id, { now: NOW }), { ok: false, code: 'payment_failed' }, host);
    }
    assert.equal(db.listOpenCoachingPaymentsFor(booking.id).length, 0);
    paypal.approveHost = null;
  });

  test('PayPal down answers payment_failed and stores nothing', async () => {
    const s = addStreamer();
    const { booking, viewer: v } = await awaiting(s);
    paypal.down = true;
    assert.deepEqual(await pay.startPayment(s, v, booking.id, { now: NOW }), { ok: false, code: 'payment_failed' });
    assert.equal(db.listOpenCoachingPaymentsFor(booking.id).length, 0);
  });

  test('an earlier order PayPal captured (its answer lost) is found first: the booking is paid, no second order', async () => {
    const s = addStreamer();
    const { booking, viewer: v, order } = await ordered(s);
    order.captured = true;
    const again = await pay.startPayment(s, v, booking.id, { now: NOW + 2 * MIN });
    assert.deepEqual(again, { ok: false, code: 'paid' });
    assert.equal(bookingNow(booking.id).status, 'confirmed');
    assert.equal(paypal.orders.size, 1, 'no second order');
  });

  test('at most five open orders per booking', async () => {
    const s = addStreamer();
    const { booking, viewer: v } = await awaiting(s);
    for (let i = 0; i < pay.OPEN_ORDERS_MAX; i++) assert.equal((await pay.startPayment(s, v, booking.id, { now: NOW })).ok, true);
    assert.deepEqual(await pay.startPayment(s, v, booking.id, { now: NOW }), { ok: false, code: 'too_many_payments' });
  });
});

// ── The return ───────────────────────────────────────────────────────

describe('handleReturn', () => {
  test('a verified capture confirms the booking, records the payment on it and tells both sides; no tip side effect', async () => {
    const s = addStreamer();
    const { booking, orderId, viewer: v } = await ordered(s);
    const result = await pay.handleReturn({ streamer: s, orderId, now: NOW + 5 * MIN });
    assert.equal(result.ok, true);
    assert.equal(result.outcome, 'paid');
    await result.followUp;
    const row = bookingNow(booking.id);
    assert.deepEqual([row.status, row.paid_amount_cents, row.paid_currency, row.paypal_order_id, row.paypal_capture_id, row.payment_issue],
      ['confirmed', 4500, 'EUR', orderId, `CAP-${orderId}`, null]);
    assert.equal(row.paid_at, NOW + 5 * MIN);
    assert.equal(db.getCoachingPayment(orderId).status, 'captured');
    assert.equal(captureCalls()[0].prefer, 'return=representation');
    assert.deepEqual(rooms.made, [booking.id], 'the room hook runs once confirmed');
    const toViewer = discord.sent.find((m) => m.userId === v.discordUserId);
    assert.match(toViewer.payload.embeds[0].title, /is confirmed/);
    const toStreamer = discord.sent.find((m) => m.userId === s.discord_user_id);
    assert.match(toStreamer.payload.embeds[0].title, /paid for their coaching session/);
    assertNoTipEffects();
  });

  test('the payer from the verified order is saved on the payment, and shown only in the coach\'s views', async () => {
    const s = addStreamer();
    const { booking, orderId } = await ordered(s);
    const payer = { name: { given_name: 'Pat', surname: 'Payer' }, email_address: 'pat@example.com', payer_id: 'PAYERID001' };
    paypal.capture = (order) => { order.captured = true; return reply(201, completed(order, { payer })); };
    const logged = [];
    const { log, error } = console;
    console.log = (...a) => logged.push(a.join(' '));
    console.error = (...a) => logged.push(a.join(' '));
    let result;
    try { result = await pay.handleReturn({ streamer: s, orderId, now: NOW + 5 * MIN }); } finally { console.log = log; console.error = error; }
    assert.equal(result.ok, true);
    await result.followUp;
    const stored = db.getCoachingPayment(orderId);
    assert.deepEqual([stored.payer_name, stored.payer_email, stored.payer_id], ['Pat Payer', 'pat@example.com', 'PAYERID001']);
    assert.equal(stored.refund_status, null, 'a normal payment owes no refund');
    assert.doesNotMatch(logged.join('\n'), /pat@example|Pat Payer|PAYERID001/, 'never logged');
    const row = bookingNow(booking.id);
    assert.doesNotMatch(JSON.stringify(svc.bookingViews([row], NOW, { forViewer: true })), /pat@example|Pat Payer|PAYERID001/);
    assert.match(JSON.stringify(svc.bookingViews([row], NOW)), /pat@example\.com/);
  });

  test('a replayed return records once and captures once', async () => {
    const s = addStreamer();
    const { booking, orderId } = await ordered(s);
    const first = await pay.handleReturn({ streamer: s, orderId, now: NOW + 5 * MIN });
    await first.followUp;
    discord.sent = [];
    const second = await pay.handleReturn({ streamer: s, orderId, now: NOW + 6 * MIN });
    assert.deepEqual(second, { ok: true, replay: true, outcome: 'paid' });
    assert.equal(captureCalls().length, 1);
    assert.equal(discord.sent.length, 0, 'told once');
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM coaching_payments WHERE booking_id = ?').get(booking.id).n, 1);
    assert.equal(bookingNow(booking.id).paid_at, NOW + 5 * MIN, 'the first record stands');
    // Two requests racing on one order: PayPal refuses the second capture, the read finds it captured, one record.
    const other = await ordered(s, { startsAt: START + 24 * HOUR });
    paypal.capture = (order) => {
      if (order.captured) return reply(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] });
      order.captured = true;
      return reply(201, completed(order));
    };
    const [a, b] = await Promise.all([
      pay.handleReturn({ streamer: s, orderId: other.orderId, now: NOW + 7 * MIN }),
      pay.handleReturn({ streamer: s, orderId: other.orderId, now: NOW + 7 * MIN }),
    ]);
    assert.ok(a.ok && b.ok);
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM coaching_payments WHERE booking_id = ? AND status = 'captured'").get(other.booking.id).n, 1);
    assert.equal(bookingNow(other.booking.id).status, 'confirmed');
  });

  for (const [what, over, reason] of [
    ['the wrong payee', { payee: { email_address: 'someone-else@example.com', merchant_id: 'MERCHANTOTHER' } }, 'payee_mismatch'],
    ['the wrong amount', { value: '4.50' }, 'amount_mismatch'],
    ['the wrong currency', { currency: 'USD' }, 'currency_mismatch'],
    ['another booking\'s id', { customId: '999999' }, 'booking_mismatch'],
  ]) {
    test(`a capture with ${what} is refused and nothing is recorded`, async () => {
      const s = addStreamer();
      const { booking, orderId } = await ordered(s);
      paypal.capture = (order) => { order.captured = true; return reply(201, completed(order, over)); };
      const result = await pay.handleReturn({ streamer: s, orderId, now: NOW + 5 * MIN });
      assert.equal(result.ok, false);
      assert.equal(result.reason, reason);
      assert.equal(pay.returnErrorCode(result.reason), reason === 'booking_mismatch' ? 'pay_invalid' : 'not_paid');
      assertUnpaid(booking.id);
      assert.equal(db.getCoachingPayment(orderId).status, 'refused', 'kept as refused, never read again');
      assert.deepEqual(rooms.made, []);
      assert.equal(discord.sent.length, 0);
      assert.ok(logs.some((l) => l.includes('REFUSED') && l.includes(reason)));
      // Its return again: still refused, PayPal not asked.
      const calls = paypal.calls.length;
      assert.equal((await pay.handleReturn({ streamer: s, orderId, now: NOW + 6 * MIN })).reason, 'refused');
      assert.equal(paypal.calls.length, calls);
      assertNoTipEffects();
    });
  }

  test("another streamer's order is refused before PayPal is asked, and nothing is recorded", async () => {
    const a = addStreamer();
    const b = addStreamer();
    const { booking, orderId } = await ordered(a);
    paypal.calls = [];
    const result = await pay.handleReturn({ streamer: b, orderId, now: NOW + 5 * MIN });
    assert.deepEqual(result, { ok: false, reason: 'streamer_mismatch' });
    assert.equal(paypal.calls.length, 0, 'not captured');
    assertUnpaid(booking.id);
    assert.deepEqual(await pay.handleReturn({ streamer: b, orderId: 'UNKNOWNORDER01', now: NOW }), { ok: false, reason: 'no_order' });
    assert.deepEqual(await pay.handleReturn({ streamer: b, orderId: '../../x', now: NOW }), { ok: false, reason: 'invalid_token' });
    assert.equal(paypal.calls.length, 0);
  });

  test('a lost capture answer is recovered by reading the order back', async () => {
    const s = addStreamer();
    const { booking, orderId } = await ordered(s);
    paypal.capture = (order) => { order.captured = true; throw new Error('socket hang up'); };
    const result = await pay.handleReturn({ streamer: s, orderId, now: NOW + 5 * MIN });
    assert.equal(result.ok, true);
    assert.equal(result.outcome, 'paid');
    await result.followUp;
    assert.equal(bookingNow(booking.id).status, 'confirmed');
    assert.equal(paypal.calls.filter((c) => c.method === 'GET' && c.url.includes('/v2/checkout/orders/')).length, 1);
  });

  test('a capture whose outcome stays unknown (PayPal down) is not counted and asks to check again', async () => {
    const s = addStreamer();
    const { booking, orderId } = await ordered(s);
    paypal.capture = () => { throw new Error('fetch failed'); };
    paypal.getOrder = () => { throw new Error('fetch failed'); };
    const result = await pay.handleReturn({ streamer: s, orderId, now: NOW + 5 * MIN });
    assert.equal(result.reason, 'capture_failed');
    assert.equal(pay.returnErrorCode(result.reason), 'pay_unconfirmed');
    assertUnpaid(booking.id);
    assert.equal(db.getCoachingPayment(orderId).status, 'created', 'left for the next read');
  });

  test('a pending capture is not a confirmed session', async () => {
    const s = addStreamer();
    const { booking, orderId } = await ordered(s);
    paypal.capture = (order) => { order.captured = true; return reply(201, completed(order, { captureStatus: 'PENDING' })); };
    paypal.getOrder = (order) => reply(200, completed(order, { captureStatus: 'PENDING' }));
    const result = await pay.handleReturn({ streamer: s, orderId, now: NOW + 5 * MIN });
    assert.equal(result.reason, 'pending');
    assertUnpaid(booking.id);
  });

  test('a booking withdrawn before the return is never captured; one PayPal captured anyway is recorded and the streamer told to refund', async () => {
    const s = addStreamer();
    const { booking, orderId, viewer: v } = await ordered(s);
    await svc.withdraw(s, v, booking.id, { now: NOW + 2 * MIN });
    const result = await pay.handleReturn({ streamer: s, orderId, now: NOW + 5 * MIN });
    assert.deepEqual([result.ok, result.reason], [false, 'closed']);
    assert.equal(captureCalls().length, 0, 'no money taken for a withdrawn booking');

    const other = await ordered(s, { startsAt: START + 24 * HOUR });
    other.order.captured = true; // captured at PayPal, its answer lost
    await svc.withdraw(s, other.viewer, other.booking.id, { now: NOW + 2 * MIN });
    discord.sent = [];
    const late = await pay.handleReturn({ streamer: s, orderId: other.orderId, now: NOW + 5 * MIN });
    assert.equal(late.ok, true);
    assert.equal(late.outcome, 'late');
    await late.followUp;
    const row = bookingNow(other.booking.id);
    assert.deepEqual([row.status, row.payment_issue], ['withdrawn', 'late']);
    assert.equal(captureCalls().length, 0);
    const msg = discord.sent.find((m) => m.userId === s.discord_user_id);
    assert.match(msg.payload.embeds[0].description, /refund it to the viewer in PayPal/);
  });

  test('a late return to an expired booking whose time is still free captures and confirms it; one whose time was taken is not captured', async () => {
    const s = addStreamer();
    const { booking, orderId } = await ordered(s);
    const pastDeadline = booking.pay_by + MIN;
    assert.ok(db.expireCoachingBooking(booking.id, pastDeadline));
    const result = await pay.handleReturn({ streamer: s, orderId, now: pastDeadline + MIN });
    assert.equal(result.ok, true);
    assert.equal(result.result, 'late_confirmed');
    assert.equal(bookingNow(booking.id).status, 'confirmed');

    const other = await ordered(s, { startsAt: START + 24 * HOUR });
    const deadline = other.booking.pay_by + MIN;
    db.expireCoachingBooking(other.booking.id, deadline);
    // Someone else books that time meanwhile.
    const taker = await svc.request(s, viewer(++viewers), { startsAt: START + 24 * HOUR, minutes: 120, note: '', lang: 'en' }, { now: deadline });
    assert.equal(taker.ok, true, taker.code);
    const calls = captureCalls().length;
    const refused = await pay.handleReturn({ streamer: s, orderId: other.orderId, now: deadline + MIN });
    assert.deepEqual([refused.ok, refused.reason], [false, 'closed']);
    assert.equal(captureCalls().length, calls, 'not captured: the time is someone else\'s');
    assert.equal(bookingNow(other.booking.id).status, 'expired');
  });

  test('a second order for a booking already paid is not captured', async () => {
    const s = addStreamer();
    const { booking, viewer: v } = await awaiting(s);
    const first = await pay.startPayment(s, v, booking.id, { now: NOW });
    const second = await pay.startPayment(s, v, booking.id, { now: NOW });
    const id1 = new URL(first.approveUrl).searchParams.get('token');
    const id2 = new URL(second.approveUrl).searchParams.get('token');
    assert.equal((await pay.handleReturn({ streamer: s, orderId: id1, now: NOW + MIN })).outcome, 'paid');
    const result = await pay.handleReturn({ streamer: s, orderId: id2, now: NOW + 2 * MIN });
    assert.deepEqual([result.ok, result.reason], [false, 'paid']);
    assert.equal(captureCalls().length, 1);
    assert.equal(pay.returnErrorCode('paid'), 'paid');
  });

  test('a second order PayPal already captured is a duplicate: its own outcome, the booking stands', async () => {
    const s = addStreamer();
    const { booking, viewer: v } = await awaiting(s);
    const first = await pay.startPayment(s, v, booking.id, { now: NOW });
    const second = await pay.startPayment(s, v, booking.id, { now: NOW });
    const id1 = new URL(first.approveUrl).searchParams.get('token');
    const id2 = new URL(second.approveUrl).searchParams.get('token');
    assert.equal((await pay.handleReturn({ streamer: s, orderId: id1, now: NOW + MIN })).outcome, 'paid');
    paypal.orders.get(id2).captured = true;
    const result = await pay.handleReturn({ streamer: s, orderId: id2, now: NOW + 2 * MIN });
    assert.deepEqual([result.ok, result.outcome, result.result], [true, 'duplicate', 'double']);
    assert.equal(db.getCoachingPayment(id2).refund_reason, 'double');
    assert.equal(bookingNow(booking.id).status, 'confirmed');
    const again = await pay.handleReturn({ streamer: s, orderId: id2, now: NOW + 3 * MIN });
    assert.deepEqual([again.replay, again.outcome], [true, 'duplicate']);
    assert.equal((await pay.handleReturn({ streamer: s, orderId: id1, now: NOW + 3 * MIN })).outcome, 'paid');
  });

  for (const ended of ['cancelled', 'expired']) {
    test(`a second payment for a paid booking that was then ${ended} is late with Refund pending, not a duplicate`, async () => {
      const s = addStreamer();
      const { booking, viewer: v } = await awaiting(s);
      const first = await pay.startPayment(s, v, booking.id, { now: NOW });
      const second = await pay.startPayment(s, v, booking.id, { now: NOW });
      const id1 = new URL(first.approveUrl).searchParams.get('token');
      const id2 = new URL(second.approveUrl).searchParams.get('token');
      assert.equal((await pay.handleReturn({ streamer: s, orderId: id1, now: NOW + MIN })).outcome, 'paid');
      db.db.prepare('UPDATE coaching_bookings SET status = ? WHERE id = ?').run(ended, booking.id);
      paypal.orders.get(id2).captured = true;
      discord.sent.length = 0;
      const result = await pay.handleReturn({ streamer: s, orderId: id2, now: NOW + 2 * MIN });
      assert.deepEqual([result.ok, result.outcome, result.result], [true, 'late', 'late_issue']);
      await result.followUp;
      const row = db.getCoachingPayment(id2);
      assert.deepEqual([row.refund_status, row.refund_reason], ['pending', 'late']);
      assert.equal(bookingNow(booking.id).status, ended);
      assert.ok(discord.sent.some((m) => m.userId === v.discordUserId), 'the viewer is told');
      assert.ok(discord.sent.some((m) => m.userId === s.discord_user_id), 'the coach is told');
      assert.doesNotMatch(JSON.stringify(discord.sent), /stands/);
      const again = await pay.handleReturn({ streamer: s, orderId: id2, now: NOW + 3 * MIN });
      assert.deepEqual([again.replay, again.outcome], [true, 'late']);
    });
  }
});

// ── The deadline and the stale orders ────────────────────────────────

describe('expireDue', () => {
  test('reads back first: an order PayPal captured confirms the booking instead of expiring it', async () => {
    const s = addStreamer();
    const { booking, order } = await ordered(s);
    order.captured = true; // the viewer paid; the return never came
    const out = await pay.expireDue({ now: booking.pay_by + MIN });
    assert.deepEqual(out, { expired: 0, confirmed: 1 });
    const row = bookingNow(booking.id);
    assert.deepEqual([row.status, row.paid_amount_cents, row.payment_issue], ['confirmed', 4500, null]);
    assert.deepEqual(rooms.made, [booking.id]);
    assert.equal(captureCalls().length, 0, 'reads, never captures');
    assertNoTipEffects();
  });

  test('an unpaid booking past its deadline expires, frees its time and both sides are told', async () => {
    const s = addStreamer();
    const { booking, viewer: v } = await ordered(s); // approved, never captured
    assert.deepEqual(await pay.expireDue({ now: booking.pay_by - MIN }), { expired: 0, confirmed: 0 }, 'not before its deadline');
    const out = await pay.expireDue({ now: booking.pay_by });
    assert.deepEqual(out, { expired: 1, confirmed: 0 });
    assert.equal(bookingNow(booking.id).status, 'expired');
    assert.equal(db.getHeldCoachingBookings(s.id, NOW).some((h) => h.id === booking.id), false, 'the time is free');
    assert.match(discord.sent.find((m) => m.userId === v.discordUserId).payload.embeds[0].title, /not paid in time/);
    assert.match(discord.sent.find((m) => m.userId === s.discord_user_id).payload.embeds[0].title, /did not pay in time/);
    assert.equal(captureCalls().length, 0);
  });

  test('while PayPal cannot be asked, the booking waits up to 30 minutes past its deadline, then expires', async () => {
    const s = addStreamer();
    const { booking } = await ordered(s);
    paypal.down = true;
    assert.deepEqual(await pay.expireDue({ now: booking.pay_by + MIN }), { expired: 0, confirmed: 0 });
    assert.equal(bookingNow(booking.id).status, 'awaiting_payment');
    assert.deepEqual(await pay.expireDue({ now: booking.pay_by + pay.EXPIRE_GRACE_MS }), { expired: 1, confirmed: 0 });
  });

  test('a booking with no order expires without asking PayPal', async () => {
    const s = addStreamer();
    const { booking } = await awaiting(s);
    assert.deepEqual(await pay.expireDue({ now: booking.pay_by }), { expired: 1, confirmed: 0 });
    assert.equal(paypal.calls.length, 0);
  });
});

describe('reconcileStale', () => {
  test('an order still open after a day is read once: a capture is recorded, the rest dropped, a mismatch refused', async () => {
    const s = addStreamer();
    const paid = await ordered(s);
    const unpaid = await ordered(s, { startsAt: START + 24 * HOUR });
    const wrong = await ordered(s, { startsAt: START + 48 * HOUR });
    // The bookings expired unpaid at their deadline (PayPal could not be asked then).
    for (const b of [paid, unpaid, wrong]) db.expireCoachingBooking(b.booking.id, b.booking.pay_by + 31 * MIN);
    paid.order.captured = true;
    wrong.order.captured = true;
    paypal.getOrder = (order) => reply(200, order === wrong.order ? completed(order, { value: '1.00' }) : (order.captured ? completed(order) : approved(order)));
    assert.deepEqual(await pay.reconcileStale({ now: NOW + 2 * HOUR }), { recorded: 0, dropped: 0 }, 'not before a day');
    const out = await pay.reconcileStale({ now: NOW + pay.STALE_MS + 2 * MIN });
    assert.deepEqual(out, { recorded: 1, dropped: 1 });
    assert.equal(db.getCoachingPayment(paid.orderId).status, 'captured');
    assert.equal(bookingNow(paid.booking.id).paid_amount_cents, 4500, 'recorded by the late rule');
    assert.equal(db.getCoachingPayment(unpaid.orderId), null, 'dropped');
    assert.equal(db.getCoachingPayment(wrong.orderId).status, 'refused');
    assert.equal(bookingNow(wrong.booking.id).paid_at, null);
    assertNoTipEffects();
  });

  test('an order PayPal cannot be asked about stays, for at most three days', async () => {
    const s = addStreamer();
    const { orderId } = await ordered(s);
    paypal.down = true;
    assert.deepEqual(await pay.reconcileStale({ now: NOW + pay.STALE_MS + 2 * MIN }), { recorded: 0, dropped: 0 });
    assert.ok(db.getCoachingPayment(orderId));
    assert.deepEqual(await pay.reconcileStale({ now: NOW + 72 * HOUR + 2 * MIN }), { recorded: 0, dropped: 1 });
  });
});

// ── An approved order is captured when read back ─────────────────────

describe('approved orders read back', () => {
  test('startPayment: APPROVED while the booking awaits payment is captured and confirmed', async () => {
    const s = addStreamer();
    const { booking, viewer: v, orderId, order } = await ordered(s);
    order.approved = true;
    const again = await pay.startPayment(s, v, booking.id, { now: NOW + 2 * MIN });
    assert.deepEqual(again, { ok: false, code: 'paid' });
    assert.equal(captureCalls().length, 1);
    assert.equal(bookingNow(booking.id).status, 'confirmed');
    assert.equal(db.getCoachingPayment(orderId).status, 'captured');
    assert.equal(paypal.orders.size, 1, 'no second order');
  });

  test('the stale pass: APPROVED on a booking that may take payment is captured; a booking that may not is only read', async () => {
    const s = addStreamer();
    const ok = await ordered(s);
    const closed = await ordered(s, { startsAt: START + 24 * HOUR });
    ok.order.approved = true;
    closed.order.approved = true;
    db.expireCoachingBooking(ok.booking.id, ok.booking.pay_by + 31 * MIN); // its time is still free and ahead: may capture
    db.db.prepare("UPDATE coaching_bookings SET status = 'cancelled' WHERE id = ?").run(closed.booking.id);
    const out = await pay.reconcileStale({ now: NOW + pay.STALE_MS + 2 * MIN });
    assert.equal(out.recorded, 1);
    assert.equal(captureCalls().length, 1, 'only the first order was captured');
    assert.equal(db.getCoachingPayment(ok.orderId).status, 'captured');
    assert.equal(paypal.orders.get(closed.orderId).captured, false);
    assert.equal(bookingNow(closed.booking.id).paid_at, null);
  });

  test('expireDue: APPROVED at the deadline is captured and confirms the booking', async () => {
    const s = addStreamer();
    const { booking, orderId, order } = await ordered(s);
    order.approved = true;
    const out = await pay.expireDue({ now: booking.pay_by + MIN });
    assert.deepEqual(out, { expired: 0, confirmed: 1 });
    assert.equal(captureCalls().length, 1);
    assert.equal(bookingNow(booking.id).status, 'confirmed');
    assert.equal(db.getCoachingPayment(orderId).status, 'captured');
  });

  test('expireDue: APPROVED whose capture answers PENDING ends pending, not expired', async () => {
    const s = addStreamer();
    const { booking, orderId, order } = await ordered(s);
    order.approved = true;
    paypal.capture = (o) => { o.captured = true; return reply(201, completed(o, { captureStatus: 'PENDING' })); };
    paypal.getOrder = (o) => reply(200, o.captured ? completed(o, { captureStatus: 'PENDING' }) : approved(o));
    const out = await pay.expireDue({ now: booking.pay_by + MIN });
    assert.deepEqual(out, { expired: 0, confirmed: 0 });
    assert.equal(db.getCoachingPayment(orderId).status, 'pending');
    assert.equal(bookingNow(booking.id).status, 'awaiting_payment');
  });

  test('a return and the tick finding the same order capture it once', async () => {
    const s = addStreamer();
    const { booking, orderId, order } = await ordered(s);
    order.approved = true;
    db.expireCoachingBooking(booking.id, booking.pay_by + 31 * MIN);
    const [ret, tick] = await Promise.all([
      pay.handleReturn({ streamer: s, orderId, now: NOW + pay.STALE_MS + 2 * MIN }),
      pay.reconcileStale({ now: NOW + pay.STALE_MS + 2 * MIN }),
    ]);
    assert.equal(captureCalls().length, 1, 'one capture call');
    assert.equal(ret.ok, true);
    assert.ok(tick.recorded <= 1);
    assert.equal(db.getCoachingPayment(orderId).status, 'captured');
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM coaching_payments WHERE order_id = ?').get(orderId).n, 1);
  });

  test('a capture answering PENDING is kept pending (T1)', async () => {
    const s = addStreamer();
    const { booking, viewer: v, orderId, order: placed } = await ordered(s);
    placed.approved = true;
    paypal.capture = (order) => { order.captured = true; return reply(201, completed(order, { captureStatus: 'PENDING' })); };
    paypal.getOrder = (order) => reply(200, order.captured ? completed(order, { captureStatus: 'PENDING' }) : approved(order));
    const again = await pay.startPayment(s, v, booking.id, { now: NOW + 2 * MIN });
    assert.deepEqual(again, { ok: false, code: 'payment_processing' });
    assert.equal(db.getCoachingPayment(orderId).status, 'pending');
    assert.equal(bookingNow(booking.id).paid_at, null);
  });
});

// ── A PENDING capture is kept, never lost ────────────────────────────

describe('pending captures', () => {
  const DAY = 24 * HOUR;
  const pendingAtPayPal = (order) => { order.captured = true; order.pending = true; };
  function useOrderStates() {
    paypal.capture = (order) => { pendingAtPayPal(order); return reply(201, completed(order, { captureStatus: 'PENDING' })); };
    paypal.getOrder = (order) => {
      if (order.voided) return reply(200, { id: order.id, status: 'VOIDED', purchase_units: [{ custom_id: order.customId }] });
      if (order.declined) return reply(200, completed(order, { captureStatus: 'DECLINED' }));
      if (order.pending) return reply(200, completed(order, { captureStatus: 'PENDING' }));
      return reply(200, order.captured ? completed(order) : approved(order));
    };
  }
  async function pendingBooking({ startsAt = START } = {}) {
    const s = addStreamer();
    const o = await ordered(s, { startsAt });
    useOrderStates();
    const result = await pay.handleReturn({ streamer: s, orderId: o.orderId, now: NOW + 5 * MIN });
    assert.equal(result.reason, 'pending');
    return { s, ...o };
  }

  test('the return stores the payment as pending with the next read an hour on, and the booking shows payment processing', async () => {
    const { s, booking, orderId, viewer: v } = await pendingBooking();
    const row = db.getCoachingPayment(orderId);
    assert.deepEqual([row.status, row.pending_since, row.next_read_at], ['pending', NOW + 5 * MIN, NOW + 5 * MIN + HOUR]);
    const view = svc.bookingView(bookingNow(booking.id), NOW + 6 * MIN, null, { forViewer: true });
    assert.equal(view.state, 'payment_processing');
    assert.equal(svc.bookingViews([bookingNow(booking.id)], NOW + 6 * MIN)[0].state, 'payment_processing');
    // not paid twice: no second order, no withdraw while PayPal holds it
    assert.deepEqual(await pay.startPayment(s, v, booking.id, { lang: 'en', now: NOW + 6 * MIN }), { ok: false, code: 'payment_processing' });
    assert.deepEqual(await svc.withdraw(s, v, booking.id, { now: NOW + 6 * MIN }), { ok: false, code: 'payment_processing' });
  });

  test('the coach cannot cancel while a payment is pending: nothing changes, no message (a cancel with no pending row is covered in coachingBookings.test.js)', async () => {
    const { s, booking, orderId } = await pendingBooking();
    const sentBefore = discord.sent.length;
    assert.deepEqual(await svc.cancel(s, booking.id, { reason: 'I am ill', now: NOW + 6 * MIN }), { ok: false, code: 'payment_processing' });
    assert.equal(bookingNow(booking.id).status, 'awaiting_payment');
    assert.equal(discord.sent.length, sentBefore);
    assert.equal(db.getCoachingPayment(orderId).status, 'pending');
  });

  test('it is kept past the deadline and past 72 hours: the booking holds its time, no pass deletes the row', async () => {
    const { booking, orderId } = await pendingBooking();
    assert.deepEqual(await pay.expireDue({ now: booking.pay_by + 31 * MIN }), { expired: 0, confirmed: 0 });
    assert.equal(bookingNow(booking.id).status, 'awaiting_payment');
    assert.equal(db.deleteOpenCoachingPayment(orderId), false, 'the delete refuses a pending row');
    const out = await pay.reconcileStale({ now: NOW + 80 * HOUR });
    assert.deepEqual(out, { recorded: 0, dropped: 0 });
    assert.equal(db.getCoachingPayment(orderId).status, 'pending');
  });

  test('released with the payment still pending: the viewer is not told it was unpaid, and the state says so', async () => {
    const { s, booking, orderId, viewer: v } = await pendingBooking();
    discord.sent = [];
    const out = await pay.expireDue({ now: booking.starts_at - 10 * MIN });
    assert.deepEqual(out, { expired: 1, confirmed: 0 });
    assert.equal(db.getCoachingPayment(orderId).status, 'pending');
    const toViewer = discord.sent.find((m) => m.userId === v.discordUserId).payload.embeds[0];
    assert.match(toViewer.title, /still processing at PayPal/);
    assert.doesNotMatch(toViewer.title + toViewer.description, /not paid in time/);
    assert.match(toViewer.description, /refunded/);
    const toCoach = discord.sent.find((m) => m.userId === s.discord_user_id).payload.embeds[0];
    assert.doesNotMatch(toCoach.title, /did not pay/);
    const row = bookingNow(booking.id);
    assert.equal(row.status, 'expired');
    assert.equal(svc.bookingView(row, booking.starts_at - 9 * MIN, null, { forViewer: true }).state, 'payment_unsettled');
    assert.equal(svc.bookingViews([row], booking.starts_at - 9 * MIN)[0].state, 'payment_unsettled');
  });

  test('a payment first seen pending by the expiry pass is kept too', async () => {
    const s = addStreamer();
    const { booking, orderId } = await ordered(s);
    useOrderStates();
    pendingAtPayPal(paypal.orders.get(orderId));
    assert.deepEqual(await pay.expireDue({ now: booking.pay_by + MIN }), { expired: 0, confirmed: 0 });
    assert.equal(db.getCoachingPayment(orderId).status, 'pending');
  });

  test('a stale open order that turns out pending is kept, not dropped', async () => {
    const s = addStreamer();
    const { booking, orderId } = await ordered(s);
    useOrderStates();
    db.expireCoachingBooking(booking.id, booking.pay_by + 31 * MIN);
    pendingAtPayPal(paypal.orders.get(orderId));
    assert.deepEqual(await pay.reconcileStale({ now: NOW + pay.STALE_MS + 2 * MIN }), { recorded: 0, dropped: 0 });
    assert.equal(db.getCoachingPayment(orderId).status, 'pending');
  });

  test('back-off: read hourly for the first day, then daily, and only when due', async () => {
    const { orderId } = await pendingBooking();
    const t0 = NOW + 5 * MIN;
    assert.equal(pay.nextPendingRead(t0, t0 + 3 * HOUR), t0 + 3 * HOUR + HOUR);
    assert.equal(pay.nextPendingRead(t0, t0 + 25 * HOUR), t0 + 25 * HOUR + DAY);
    const reads = () => paypal.calls.filter((c) => c.method === 'GET' && c.url.endsWith(`/orders/${orderId}`)).length;
    const before = reads();
    assert.deepEqual(await pay.readPending({ now: t0 + 30 * MIN }), { recorded: 0, closed: 0, pending: 0 }, 'not due yet');
    assert.equal(reads(), before);
    assert.deepEqual(await pay.readPending({ now: t0 + HOUR }), { recorded: 0, closed: 0, pending: 1 });
    assert.equal(db.getCoachingPayment(orderId).next_read_at, t0 + 2 * HOUR);
    const late = t0 + 26 * HOUR;
    assert.deepEqual(await pay.readPending({ now: late }), { recorded: 0, closed: 0, pending: 1 });
    assert.equal(db.getCoachingPayment(orderId).next_read_at, late + DAY, 'daily after the first day');
  });

  test('still pending 30 days after it was first seen: lapsed with a log line, the row stays', async () => {
    const { orderId } = await pendingBooking();
    const at = NOW + 5 * MIN + pay.PENDING_GIVE_UP_MS;
    assert.deepEqual(await pay.readPending({ now: at }), { recorded: 0, closed: 1, pending: 0 });
    const row = db.getCoachingPayment(orderId);
    assert.equal(row.status, 'lapsed');
    assert.ok(logs.some((l) => l.includes(orderId) && l.includes('30 days')));
  });

  test('a lapsed payment is read back weekly; COMPLETED is a late capture with Refund pending; past 90 days it is not read', async () => {
    const { orderId, booking } = await pendingBooking();
    const lapsedAt = NOW + 5 * MIN + pay.PENDING_GIVE_UP_MS;
    await pay.readPending({ now: lapsedAt });
    assert.equal(db.getCoachingPayment(orderId).status, 'lapsed');
    assert.equal(db.getCoachingPayment(orderId).next_read_at, lapsedAt + 7 * DAY);
    assert.equal(svc.bookingView(bookingNow(booking.id), lapsedAt, null, { forViewer: true }).state !== 'payment_processing', true);
    assert.equal(db.listDueCoachingPendingPayments(lapsedAt + 6 * DAY).length, 0);
    assert.equal(db.listDueCoachingPendingPayments(lapsedAt + 7 * DAY).length, 1);
    assert.deepEqual(await pay.readPending({ now: lapsedAt + 7 * DAY }), { recorded: 0, closed: 0, pending: 1 });
    assert.equal(db.getCoachingPayment(orderId).next_read_at, lapsedAt + 14 * DAY);
    const past = NOW + 5 * MIN + 90 * DAY;
    await pay.readPending({ now: past });
    assert.equal(db.getCoachingPayment(orderId).next_read_at, null);
    assert.equal(db.listDueCoachingPendingPayments(past + 400 * DAY).length, 0);
    assert.ok(logs.some((l) => l.includes(orderId) && l.includes('90 days')));
  });

  test('a lapsed payment that completes is recorded late_issue with Refund pending', async () => {
    const { orderId, booking } = await pendingBooking();
    const lapsedAt = NOW + 5 * MIN + pay.PENDING_GIVE_UP_MS;
    await pay.readPending({ now: lapsedAt });
    paypal.orders.get(orderId).pending = false;
    paypal.orders.get(orderId).captured = true;
    assert.deepEqual(await pay.readPending({ now: lapsedAt + 7 * DAY }), { recorded: 1, closed: 0, pending: 0 });
    const row = db.getCoachingPayment(orderId);
    assert.deepEqual([row.status, row.refund_status], ['captured', 'pending']);
    assert.notEqual(bookingNow(booking.id).status, 'confirmed');
  });

  test('at 15 minutes before the start the booking ends unpaid and the payment row stays pending', async () => {
    const { s, booking, orderId, viewer: v } = await pendingBooking();
    assert.deepEqual(await pay.expireDue({ now: booking.starts_at - 16 * MIN }), { expired: 0, confirmed: 0 });
    discord.sent = [];
    assert.deepEqual(await pay.expireDue({ now: booking.starts_at - 15 * MIN }), { expired: 1, confirmed: 0 });
    assert.equal(bookingNow(booking.id).status, 'expired');
    assert.equal(db.getCoachingPayment(orderId).status, 'pending');
    assert.ok(discord.sent.find((m) => m.userId === v.discordUserId), 'the viewer is told');
    assert.ok(discord.sent.find((m) => m.userId === s.discord_user_id), 'the coach is told');
    assert.equal(svc.bookingView(bookingNow(booking.id), booking.starts_at - 14 * MIN, null, { forViewer: true }).state, 'payment_unsettled');
  });

  test('a pending payment that completes later is recorded as late, Refund pending, the coach told', async () => {
    const { s, booking, orderId } = await pendingBooking();
    await pay.expireDue({ now: booking.starts_at - 15 * MIN });
    discord.sent = [];
    const order = paypal.orders.get(orderId);
    order.pending = false; // PayPal settled it
    const at = booking.starts_at - 10 * MIN; // the booking's time is still ahead and free, yet it is never re-confirmed
    db.db.prepare('UPDATE coaching_payments SET next_read_at = ? WHERE order_id = ?').run(at, orderId);
    const out = await pay.readPending({ now: at });
    assert.deepEqual(out, { recorded: 1, closed: 0, pending: 0 });
    const row = bookingNow(booking.id);
    assert.deepEqual([row.status, row.payment_issue], ['expired', 'late']);
    const payment = db.getCoachingPayment(orderId);
    assert.deepEqual([payment.status, payment.refund_status, payment.refund_reason], ['captured', 'pending', 'late']);
    const msg = discord.sent.find((m) => m.userId === s.discord_user_id);
    assert.match(msg.payload.embeds[0].description, /refund it to the viewer in PayPal/);
  });

  test('a pending payment that completes before the booking ended confirms it', async () => {
    const { booking, orderId } = await pendingBooking();
    paypal.orders.get(orderId).pending = false;
    const at = NOW + 2 * HOUR;
    db.db.prepare('UPDATE coaching_payments SET next_read_at = ? WHERE order_id = ?').run(at, orderId);
    assert.deepEqual(await pay.readPending({ now: at }), { recorded: 1, closed: 0, pending: 0 });
    assert.equal(bookingNow(booking.id).status, 'confirmed');
  });

  test('a voided or declined pending payment is closed with a log line and kept', async () => {
    const a = await pendingBooking();
    const b = await pendingBooking({ startsAt: START + 24 * HOUR });
    paypal.orders.get(a.orderId).voided = true;
    paypal.orders.get(b.orderId).declined = true;
    const at = NOW + 2 * HOUR;
    assert.deepEqual(await pay.readPending({ now: at }), { recorded: 0, closed: 2, pending: 0 });
    assert.equal(db.getCoachingPayment(a.orderId).status, 'closed');
    assert.equal(db.getCoachingPayment(b.orderId).status, 'closed');
    assert.ok(logs.some((l) => l.includes(a.orderId) && l.includes('closed')));
    assert.equal(bookingNow(a.booking.id).paid_at, null);
  });

  test('a read PayPal cannot answer keeps the payment pending', async () => {
    const { orderId } = await pendingBooking();
    paypal.down = true;
    assert.deepEqual(await pay.readPending({ now: NOW + 2 * HOUR }), { recorded: 0, closed: 0, pending: 1 });
    assert.equal(db.getCoachingPayment(orderId).status, 'pending');
  });
});
