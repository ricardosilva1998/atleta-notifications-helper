'use strict';

// Coaching payments (planning decisions 6-8): after the streamer accepts a paid length, the viewer pays the booking's
// price with PayPal Checkout, straight to the streamer (payee = the streamer's PayPal email). Only a capture the server
// verified with PayPal confirms the booking, never the browser's word: the order must be one this server made for this
// streamer and booking (a coaching_payments row), the order and its capture COMPLETED, the payee the streamer's PayPal
// account, and the amount and currency exactly the booking's. A replayed return records nothing new (one capture id is
// recorded once, db.recordCoachingPayment), a lost or slow capture answer is recovered by reading the order back, and a
// capture that arrives after the booking expired or was cancelled is recorded and handled by the late rule in
// db.recordCoachingPayment.
//
// A coaching payment is not a tip: it writes no donations row and fires no tip alert, tip goal, tracker, voice or chat
// line. Only coaching_payments and coaching_bookings change.
//
// PayPal Orders v2 fields relied on (capture with Prefer: return=representation, or a GET of the order):
//   id, status (COMPLETED)
//   purchase_units[0].custom_id                      the booking id this server set
//   purchase_units[0].payee                          .merchant_id and/or .email_address
//   purchase_units[0].payments.captures[0]           .id, .status (COMPLETED), .amount.value, .amount.currency_code

const db = require('../db');
const config = require('../config');
const { t } = require('../i18n');
const { paypalClient, approveUrlOf } = require('./paypal');
const coachingBookings = require('./coachingBookings');

const paypal = paypalClient(config.paypal);

const MINUTE_MS = 60e3;
const STALE_MS = 24 * 3600e3; // an order not captured after a day is read back once, then dropped
const STALE_GIVE_UP_MS = 72 * 3600e3; // ... and dropped unread when PayPal could not be asked for two more days
const HOUR_MS = 3600e3;
const DAY_MS = 24 * HOUR_MS;
const PENDING_HOURLY_MS = DAY_MS; // a pending capture is read hourly for its first day ...
const PENDING_GIVE_UP_MS = 30 * DAY_MS; // ... then daily, until 30 days after it was first seen pending
const LAPSED_READ_MS = 7 * DAY_MS; // a lapsed payment is read back weekly ...
const LAPSED_GIVE_UP_MS = 90 * DAY_MS; // ... until 90 days after it was taken; never deleted
const PENDING_HOLD_LEAD_MS = 15 * MINUTE_MS; // a booking with a pending payment keeps its time until this long before its start
const EXPIRE_GRACE_MS = 30 * MINUTE_MS; // while PayPal cannot be asked, a booking past its deadline waits this long
const OPEN_ORDERS_MAX = 5; // Pay pressed again and again: at most this many unpaid orders per booking
const ORDER_ID = /^[A-Z0-9-]{10,64}$/i;

// The viewer is sent to whatever PayPal's order says; only an https PayPal page is ever handed on.
function isPayPalUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'paypal.com' || u.hostname.endsWith('.paypal.com'));
  } catch (e) { return false; }
}

// Reasons a capture is refused for good: the order was paid, but not as this booking needs (or not to this streamer).
const MISMATCH = ['order_mismatch', 'booking_mismatch', 'payee_mismatch', 'amount_mismatch', 'currency_mismatch'];

function sameEmail(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = a.trim().toLowerCase();
  return x !== '' && x === b.trim().toLowerCase();
}

// As in tipCapture.js: the PayPal account id named when the order was made is the strongest proof (the email PayPal
// shows can be another address of the same account); else the payee email must be the one the order was made for.
function payeeMatches(payee, payment) {
  if (!payee || typeof payee !== 'object') return false;
  if (payment.payee_merchant_id && payee.merchant_id) return payee.merchant_id === payment.payee_merchant_id;
  return sameEmail(payee.email_address, payment.payee_email);
}

function payeeMerchantIdOf(order) {
  const unit = order && Array.isArray(order.purchase_units) ? order.purchase_units[0] : null;
  const id = unit && unit.payee && unit.payee.merchant_id;
  return typeof id === 'string' && id.length > 0 && id.length <= 64 ? id : null;
}

// "25.00" -> 2500; null for anything that is not a plain amount with at most two decimals.
function centsOf(value) {
  if (typeof value !== 'string' || !/^\d{1,9}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, frac = ''] = value.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

// Can the coaching_payments row be tied to this streamer and booking? null when it can, else the reason.
function checkPayment({ streamer, payment, booking }) {
  if (!payment) return 'no_order';
  if (Number(payment.streamer_id) !== Number(streamer.id)) return 'streamer_mismatch';
  if (!booking || Number(booking.id) !== Number(payment.booking_id) || Number(booking.streamer_id) !== Number(streamer.id)) {
    return 'booking_mismatch';
  }
  return null;
}

// Pure decision on PayPal's order (the capture answer, or the order read back). Returns
// { ok: true, captureId, amountCents, currency, payer } or { ok: false, reason }.
function decideCoachingCapture({ streamer, payment, booking, order }) {
  const early = checkPayment({ streamer, payment, booking });
  if (early) return { ok: false, reason: early };
  if (!order || typeof order !== 'object') return { ok: false, reason: 'not_completed' };
  if (order.id != null && order.id !== payment.order_id) return { ok: false, reason: 'order_mismatch' };
  if (order.status !== 'COMPLETED') return { ok: false, reason: 'not_completed' };
  const unit = Array.isArray(order.purchase_units) ? order.purchase_units[0] : null;
  const captures = unit && unit.payments && unit.payments.captures;
  const capture = Array.isArray(captures) ? captures[0] : null;
  if (!capture) return { ok: false, reason: 'not_completed' };
  // PENDING: PayPal took the payment but has not settled it. Not money yet, so not a confirmed session; a later read
  // (the expiry or the stale pass) finds it COMPLETED.
  if (capture.status === 'PENDING') return { ok: false, reason: 'pending' };
  if (capture.status !== 'COMPLETED' || typeof capture.id !== 'string' || !capture.id) return { ok: false, reason: 'not_completed' };
  if (unit.custom_id != null && String(unit.custom_id) !== String(booking.id)) return { ok: false, reason: 'booking_mismatch' };
  const amountCents = centsOf(capture.amount && capture.amount.value);
  const currency = capture.amount && capture.amount.currency_code;
  if (amountCents === null || amountCents !== Number(payment.amount_cents) || amountCents !== Number(booking.price_cents)) {
    return { ok: false, reason: 'amount_mismatch' };
  }
  if (typeof currency !== 'string' || currency !== payment.currency || currency !== booking.currency) {
    return { ok: false, reason: 'currency_mismatch' };
  }
  if (!payeeMatches(unit.payee, payment)) return { ok: false, reason: 'payee_mismatch' };
  return { ok: true, captureId: capture.id, amountCents, currency, payer: payerOf(order) };
}

// The payer's PayPal details from a verified order (name, email, payer id), kept for the coach to refund with. They are
// never logged and never shown to the viewer's page.
function payerOf(order) {
  const p = order && order.payer && typeof order.payer === 'object' ? order.payer : null;
  if (!p) return null;
  const name = p.name && typeof p.name === 'object'
    ? [p.name.given_name, p.name.surname].filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()).join(' ')
    : '';
  const out = {
    name: name || null,
    email: typeof p.email_address === 'string' ? p.email_address : null,
    payerId: typeof p.payer_id === 'string' ? p.payer_id : null,
  };
  return out.name || out.email || out.payerId ? out : null;
}

// What PayPal answered, for the server log — never payer details.
function paypalIssue(res) {
  if (!res || typeof res !== 'object') return '';
  if (res.name) {
    const issue = Array.isArray(res.details) && res.details[0] ? res.details[0].issue : '';
    return [res.name, issue, res.debug_id ? `debug_id=${res.debug_id}` : ''].filter(Boolean).join(' ');
  }
  const unit = Array.isArray(res.purchase_units) ? res.purchase_units[0] : null;
  const captures = unit && unit.payments && unit.payments.captures;
  const capture = Array.isArray(captures) ? captures[0] : null;
  return [`order=${res.status || '?'}`, capture ? `capture=${capture.status || '?'}` : ''].filter(Boolean).join(' ');
}

const isCaptureInProgress = (res) =>
  !!(res && Array.isArray(res.details) && res.details.some((d) => d && d.issue === 'PREVIOUS_REQUEST_IN_PROGRESS'));

// Whether this server may take the money for the booking now. An unpaid booking waiting for payment, yes (also a minute
// past its deadline, before the tick expired it). One that expired unpaid, only while its time is still to come and
// still free (the late rule then confirms it). Anything else (paid already, declined, cancelled, withdrawn) is never
// captured: the order is only read back, in case PayPal captured it already.
function mayCapture(booking, now) {
  if (booking.paid_at != null) return false;
  if (booking.status === 'awaiting_payment') return true;
  if (booking.status !== 'expired' || booking.starts_at <= now) return false;
  const end = booking.starts_at + booking.minutes * MINUTE_MS;
  return !db.getHeldCoachingBookings(booking.streamer_id, now)
    .some((h) => h.id !== booking.id && booking.starts_at < h.startsAt + h.minutes * MINUTE_MS && h.startsAt < end);
}

// One capture attempt at a time per order: the return page, the viewer's Pay and the minute tick that find the same order
// share one PayPal call instead of capturing twice.
const captureRuns = new Map();
function captureOnce(orderId) {
  if (captureRuns.has(orderId)) return captureRuns.get(orderId);
  const run = Promise.resolve().then(() => paypal.capture(orderId)).finally(() => captureRuns.delete(orderId));
  captureRuns.set(orderId, run);
  return run;
}

// An order read back as APPROVED (the viewer approved it at PayPal, the return never reached us) is captured here, while
// the booking may still take the payment, and the capture's answer is what the caller decides on. Any other order, a
// payment already PENDING, or a failed capture leaves the order as read (the caller's decision then stands, and the next
// pass tries again).
async function captureIfApproved(payment, order, now) {
  if (!order || order.status !== 'APPROVED' || payment.status === 'pending') return order;
  const booking = db.getCoachingBookingById(payment.booking_id);
  if (!booking || !mayCapture(booking, now)) return order;
  try {
    const answer = await captureOnce(payment.order_id);
    if (answer && answer.status === 'COMPLETED') return answer;
    return await paypal.getOrder(payment.order_id);
  } catch (e) {
    console.error(`[Coaching] capture of approved order ${payment.order_id} failed:`, e.message);
    return order;
  }
}

// When a pending capture is read next: an hour from now during its first day, a day from now after that.
function nextPendingRead(pendingSince, now) {
  return now + (now - pendingSince < PENDING_HOURLY_MS ? HOUR_MS : DAY_MS);
}

// A capture PayPal reports PENDING is kept (never deleted) and read again on that schedule.
function keepPending(payment, now) {
  const since = payment.pending_since || now;
  if (db.markCoachingPaymentPending(payment.order_id, now, nextPendingRead(since, now))) {
    if (payment.status !== 'pending') console.log(`[Coaching] order ${payment.order_id} for booking ${payment.booking_id}: capture PENDING at PayPal, kept and read back`);
  }
}

// PayPal's answer says the payment will never settle: the order was voided, or its capture ended in anything but
// COMPLETED or PENDING (declined, failed, refunded).
function isDeadOrder(order) {
  if (!order || typeof order !== 'object') return false;
  if (order.status === 'VOIDED') return true;
  const unit = Array.isArray(order.purchase_units) ? order.purchase_units[0] : null;
  const captures = unit && unit.payments && unit.payments.captures;
  const capture = Array.isArray(captures) ? captures[0] : null;
  return !!(capture && typeof capture.status === 'string' && capture.status !== 'COMPLETED' && capture.status !== 'PENDING');
}

// A verified capture into the database, then what follows it (coachingBookings.afterPayment: the confirmation, the room
// hook, or the streamer told to refund). Returns { ok, result, booking, followUp } or { ok: false, reason }.
function record(streamer, payment, verdict, now) {
  // Every call is after a PayPal answer: the start check uses when the money moved, not when the request began.
  const at = Math.max(now, Date.now());
  let rec;
  try {
    rec = db.recordCoachingPayment({
      bookingId: Number(payment.booking_id), orderId: payment.order_id, captureId: verdict.captureId,
      amountCents: verdict.amountCents, currency: verdict.currency, now: at, payer: verdict.payer || null,
    });
  } catch (e) {
    console.error(`[Coaching] payment ${payment.order_id} could not be recorded:`, e.message);
    return { ok: false, reason: 'record_failed' };
  }
  if (!rec.ok) {
    console.error(`[Coaching] payment ${payment.order_id} not recorded: ${rec.code}`);
    return { ok: false, reason: 'record_failed' };
  }
  if (rec.result === 'duplicate') return { ok: true, result: 'duplicate', booking: rec.booking, followUp: Promise.resolve() };
  const d = `${verdict.currency} ${(verdict.amountCents / 100).toFixed(2)}`;
  if (rec.result === 'recorded' || rec.result === 'late_confirmed') {
    console.log(`[Coaching] booking ${payment.booking_id} of streamer ${streamer.id} paid (${d}, order ${payment.order_id}): confirmed${rec.result === 'late_confirmed' ? ' after it had expired' : ''}`);
  } else {
    console.error(`[Coaching] booking ${payment.booking_id} of streamer ${streamer.id}: payment ${payment.order_id} (${d}) arrived when the booking could not take it (${rec.result}); the streamer is told to refund it`);
  }
  const followUp = coachingBookings.afterPayment(streamer, rec.booking, rec.result);
  return { ok: true, result: rec.result, booking: rec.booking, followUp };
}

// The viewer's Pay: a PayPal order for the booking's price, paid to the streamer's PayPal email. Only the booking's own
// viewer, while it awaits payment and before its deadline. Open orders of the booking are read back first, so a payment
// PayPal took whose answer was lost confirms the booking instead of asking for a second one.
// Resolves to { ok: true, approveUrl } or { ok: false, code }.
async function startPayment(streamer, viewer, bookingId, { lang = 'en', now = Date.now() } = {}) {
  const booking = db.getCoachingBooking(bookingId, streamer.id);
  if (!booking || !viewer || booking.viewer_discord_id !== viewer.discordUserId) return { ok: false, code: 'not_found' };
  if (booking.paid_at != null) return { ok: false, code: 'paid' };
  if (booking.status !== 'awaiting_payment' || !(booking.price_cents > 0)) return { ok: false, code: 'not_awaiting' };
  if (!booking.pay_by || now >= booking.pay_by) return { ok: false, code: 'pay_closed' };
  if (!streamer.paypal_email) return { ok: false, code: 'no_paypal' };

  // A payment PayPal holds as PENDING is waiting to settle: a second order would be paid twice.
  if (db.listPendingCoachingPaymentsFor(booking.id).length) return { ok: false, code: 'payment_processing' };

  const open = db.listOpenCoachingPaymentsFor(booking.id);
  for (const payment of open) {
    let order;
    try { order = await paypal.getOrder(payment.order_id); } catch (e) { continue; }
    order = await captureIfApproved(payment, order, now);
    const verdict = decideCoachingCapture({ streamer, payment, booking, order });
    if (verdict.reason === 'pending') { keepPending(payment, now); return { ok: false, code: 'payment_processing' }; }
    if (verdict.ok) {
      const done = record(streamer, payment, verdict, now);
      if (done.ok) return { ok: false, code: 'paid' };
    }
  }
  if (open.length >= OPEN_ORDERS_MAX) return { ok: false, code: 'too_many_payments' };

  // The return path names no login: the coach's Twitch login can move to another streamer while the order is open, and
  // the return finds the coach by the order's booking. '-' is not a possible Twitch login.
  const login = '-';
  let order;
  try {
    order = await paypal.createOrder({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: booking.currency, value: (booking.price_cents / 100).toFixed(2) },
        // Shown to the viewer at PayPal, so in the language they are reading the page in
        description: t(lang, 'coaching.paypalDescription', {
          name: streamer.twitch_display_name || streamer.twitch_username, minutes: booking.minutes,
        }).slice(0, 127),
        custom_id: String(booking.id),
        payee: { email_address: streamer.paypal_email },
      }],
      application_context: {
        return_url: `${config.app.url}/coaching/${login}/paid`,
        cancel_url: `${config.app.url}/my-bookings`,
        brand_name: 'Atleta',
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
      },
    });
  } catch (e) {
    console.error(`[Coaching] PayPal order for booking ${booking.id} failed:`, e.message);
    return { ok: false, code: 'payment_failed' };
  }
  const approveUrl = approveUrlOf(order);
  if (!approveUrl || !ORDER_ID.test(order.id) || !isPayPalUrl(approveUrl)) {
    console.error(`[Coaching] PayPal order for booking ${booking.id} refused: ${paypalIssue(order)}`);
    return { ok: false, code: 'payment_failed' };
  }
  db.createCoachingPayment({
    orderId: order.id, bookingId: booking.id, streamerId: streamer.id, amountCents: booking.price_cents,
    currency: booking.currency, payeeEmail: streamer.paypal_email, payeeMerchantId: payeeMerchantIdOf(order), now,
  });
  return { ok: true, approveUrl };
}

// What a finished return tells the viewer, by the booking as it is now: paid (this order confirmed it), duplicate (a
// second order for a booking already paid) or late (the payment arrived when the booking could not take it; the
// streamer was told to refund it).
function outcomeOf(booking, orderId) {
  if (booking && booking.paypal_order_id === orderId && booking.status === 'confirmed' && !booking.payment_issue) return 'paid';
  const p = db.getCoachingPayment(orderId);
  if (p && p.refund_reason === 'double') return 'duplicate';
  return 'late';
}

// PayPal sends the viewer back with the order id (`token`): capture it (or read it back when the answer is lost or not
// a completed order), check it, record it once. Returns { ok: true, outcome: 'paid'|'late'|'duplicate', result?, followUp? } or
// { ok: false, reason, detail? }. The viewer's sign-in is not needed: the order alone says what was paid and to whom.
async function handleReturn({ streamer, orderId, now = Date.now() }) {
  if (typeof orderId !== 'string' || !ORDER_ID.test(orderId)) return { ok: false, reason: 'invalid_token' };
  const payment = db.getCoachingPayment(orderId);
  const booking = payment ? db.getCoachingBookingById(payment.booking_id) : null;
  const early = checkPayment({ streamer, payment, booking });
  if (early) return { ok: false, reason: early };
  if (payment.status === 'captured') return { ok: true, replay: true, outcome: outcomeOf(booking, orderId) };
  if (payment.status === 'refused') return { ok: false, reason: 'refused' };
  if (payment.status === 'closed' || payment.status === 'lapsed') return { ok: false, reason: 'closed' };

  // A payment PayPal already holds as PENDING is read, never captured again.
  const capturing = payment.status !== 'pending' && mayCapture(booking, now);
  let answer = null;
  let failure = null;
  if (capturing) {
    try { answer = await captureOnce(orderId); } catch (e) { failure = e.message; }
  }
  // Anything but a completed order leaves room for doubt (an answer lost or timed out, the order captured already, a
  // reload racing the first request): the order itself says what was paid.
  let order = answer;
  if (!capturing || failure || !answer || answer.status !== 'COMPLETED') {
    try { order = await paypal.getOrder(orderId); } catch (e) { order = null; failure = failure || e.message; }
  }

  const verdict = decideCoachingCapture({ streamer, payment, booking: db.getCoachingBookingById(payment.booking_id), order });
  if (!verdict.ok) {
    const now2 = db.getCoachingPayment(orderId);
    if (now2 && now2.status === 'captured') return { ok: true, replay: true, outcome: outcomeOf(db.getCoachingBookingById(payment.booking_id), orderId) };
    const detail = [paypalIssue(answer || order), failure].filter(Boolean).join('; ');
    if (verdict.reason === 'pending') keepPending(payment, now);
    if (MISMATCH.includes(verdict.reason) && order && order.status === 'COMPLETED') {
      // Money moved, but not as this booking needs: never counted. Kept as refused so it is not read again.
      db.markCoachingPaymentRefused(orderId);
      console.error(`[Coaching] order ${orderId} for booking ${payment.booking_id} REFUSED (${verdict.reason}): check it in PayPal`);
      return { ok: false, reason: verdict.reason, detail };
    }
    if (verdict.reason === 'not_completed' && !capturing) return { ok: false, reason: booking.paid_at != null ? 'paid' : 'closed', detail };
    const unsettled = !!failure || isCaptureInProgress(answer);
    const reason = unsettled && verdict.reason === 'not_completed' ? 'capture_failed' : verdict.reason;
    return { ok: false, reason, detail };
  }
  const done = record(streamer, payment, verdict, now);
  if (!done.ok) return done;
  if (done.result === 'duplicate') return { ok: true, replay: true, outcome: outcomeOf(done.booking, orderId) };
  return { ok: true, result: done.result, outcome: done.result === 'recorded' || done.result === 'late_confirmed' ? 'paid' : done.result === 'double' ? 'duplicate' : 'late', followUp: done.followUp };
}

// Where the return page sends the viewer: ?paid=1, or ?error=<code> (the codes the booking page knows).
function returnErrorCode(reason) {
  switch (reason) {
    case 'invalid_token': case 'no_order': case 'streamer_mismatch': case 'booking_mismatch':
      return 'pay_invalid';
    case 'capture_failed': case 'pending': case 'record_failed':
      return 'pay_unconfirmed';
    case 'paid':
      return 'paid';
    case 'closed':
      return 'pay_closed';
    default:
      return 'not_paid';
  }
}

// One run at a time per pass: a pass still going when the tick comes again is not started twice.
const running = new Map();
function once(name, fn) {
  if (running.has(name)) return running.get(name);
  const run = Promise.resolve().then(fn).finally(() => running.delete(name));
  running.set(name, run);
  return run;
}

// A disabled account's bookings still expire and its payments are still recorded: money moved either way.
const streamerOf = (id) => db.getStreamerById(id) || null;

// Bookings past their payment deadline (planning decision 7): every open order of the booking is read back first, and a
// capture found there confirms the booking instead. While PayPal cannot be asked, the booking waits up to 30 minutes
// past its deadline; then it expires (a capture found later still counts by the late rule). An expired booking frees
// its time and both sides are told. Resolves to { expired, confirmed }.
function expireDue({ now = Date.now() } = {}) {
  return once('expire', async () => {
    let expired = 0;
    let confirmed = 0;
    const followUps = [];
    for (const booking of db.listExpirableCoachingBookings(now)) {
      try {
        const streamer = streamerOf(booking.streamer_id);
        if (!streamer) continue;
        let unsure = false;
        let paid = false;
        for (const payment of db.listOpenCoachingPaymentsFor(booking.id)) {
          let order;
          try { order = await paypal.getOrder(payment.order_id); } catch (e) { unsure = true; continue; }
          order = await captureIfApproved(payment, order, now);
          const verdict = decideCoachingCapture({ streamer, payment, booking, order });
          if (verdict.reason === 'pending') keepPending(payment, now);
          if (!verdict.ok) continue;
          const done = record(streamer, payment, verdict, now);
          if (done.ok) { paid = true; confirmed++; followUps.push(done.followUp); break; }
          unsure = true;
        }
        if (paid) continue;
        // A payment PayPal holds as PENDING keeps the booking's time until shortly before it starts; the payment itself
        // is read by readPending and is never deleted.
        if (db.listPendingCoachingPaymentsFor(booking.id).length && now < booking.starts_at - PENDING_HOLD_LEAD_MS) continue;
        if (unsure && now - booking.pay_by < EXPIRE_GRACE_MS) continue;
        const row = db.expireCoachingBooking(booking.id, now);
        if (!row) continue;
        expired++;
        console.log(`[Coaching] booking ${booking.id} of streamer ${streamer.id} expired unpaid`);
        if (db.listPendingCoachingPaymentsFor(booking.id).length) console.log(`[Coaching] booking ${booking.id} ended unpaid with a payment still PENDING at PayPal: the payment is kept and read back`);
        followUps.push(coachingBookings.afterExpired(streamer, row));
      } catch (e) {
        console.error(`[Coaching] expiry of booking ${booking.id} failed:`, e.message);
      }
    }
    await Promise.all(followUps);
    return { expired, confirmed };
  });
}

// Orders still open after a day (planning decision 8): each is read back once; a capture that passes the checks is
// recorded (the late rule decides what the booking does), a paid order that does not pass is marked refused, and the
// rest are dropped. An order PayPal could not be asked about stays for the next pass, for at most three days.
// Resolves to { recorded, dropped }.
function reconcileStale({ now = Date.now() } = {}) {
  return once('stale', async () => {
    let recorded = 0;
    let dropped = 0;
    const followUps = [];
    for (const payment of db.listStaleCoachingPayments(now - STALE_MS)) {
      try {
        const streamer = streamerOf(payment.streamer_id);
        const booking = db.getCoachingBookingById(payment.booking_id);
        if (!streamer || !booking) { if (db.deleteOpenCoachingPayment(payment.order_id)) dropped++; continue; }
        let order;
        try { order = await paypal.getOrder(payment.order_id); } catch (e) {
          if (now - payment.created_at >= STALE_GIVE_UP_MS && db.deleteOpenCoachingPayment(payment.order_id)) dropped++;
          continue;
        }
        order = await captureIfApproved(payment, order, now);
        const verdict = decideCoachingCapture({ streamer, payment, booking, order });
        if (verdict.ok) {
          const done = record(streamer, payment, verdict, now);
          if (done.ok) { recorded++; followUps.push(done.followUp); }
          continue;
        }
        if (MISMATCH.includes(verdict.reason) && order && order.status === 'COMPLETED') {
          db.markCoachingPaymentRefused(payment.order_id);
          console.error(`[Coaching] stale order ${payment.order_id} REFUSED (${verdict.reason}): check it in PayPal`);
          continue;
        }
        if (verdict.reason === 'pending') { keepPending(payment, now); continue; }
        if (isDeadOrder(order)) console.log(`[Coaching] stale order ${payment.order_id} closed (${paypalIssue(order)})`);
        if (db.deleteOpenCoachingPayment(payment.order_id)) dropped++;
      } catch (e) {
        console.error(`[Coaching] stale order ${payment.order_id} failed:`, e.message);
      }
    }
    await Promise.all(followUps);
    return { recorded, dropped };
  });
}

// Payments PayPal held as PENDING (planning decision: never lost): each is read back when its time comes (hourly for the
// first day, then daily, up to 30 days after it was first seen). A capture that settles is recorded (a booking that
// ended unpaid in the meantime takes it by the late rule: the streamer is told to refund it); a voided or declined one
// is closed with a log line; one still pending after 30 days is marked lapsed and logged. The row is never deleted.
// Resolves to { recorded, closed, pending }.
function readPending({ now = Date.now() } = {}) {
  return once('pending', async () => {
    let recorded = 0;
    let closed = 0;
    let pending = 0;
    const followUps = [];
    for (const payment of db.listDueCoachingPendingPayments(now)) {
      try {
        const streamer = streamerOf(payment.streamer_id);
        const booking = db.getCoachingBookingById(payment.booking_id);
        const since = payment.pending_since || payment.created_at;
        if (!streamer || !booking) {
          console.error(`[Coaching] pending order ${payment.order_id}: its streamer or booking is gone; the payment is kept, check it in PayPal`);
          db.closeCoachingPayment(payment.order_id, 'lapsed');
          closed++;
          continue;
        }
        let order = null;
        let asked = true;
        try { order = await paypal.getOrder(payment.order_id); } catch (e) { asked = false; }
        const verdict = asked ? decideCoachingCapture({ streamer, payment, booking, order }) : { ok: false, reason: 'unasked' };
        if (verdict.ok) {
          const done = record(streamer, payment, verdict, now);
          if (done.ok) { recorded++; followUps.push(done.followUp); continue; }
        } else if (MISMATCH.includes(verdict.reason) && order && order.status === 'COMPLETED') {
          db.markCoachingPaymentRefused(payment.order_id);
          console.error(`[Coaching] pending order ${payment.order_id} REFUSED (${verdict.reason}): check it in PayPal`);
          closed++;
          continue;
        } else if (asked && isDeadOrder(order)) {
          db.closeCoachingPayment(payment.order_id, 'closed');
          console.log(`[Coaching] pending order ${payment.order_id} closed: ${paypalIssue(order)}`);
          closed++;
          continue;
        }
        if (payment.status === 'lapsed') {
          const more = now - since < LAPSED_GIVE_UP_MS;
          db.scheduleCoachingPaymentRead(payment.order_id, more ? now + LAPSED_READ_MS : null);
          if (!more) console.error(`[Coaching] lapsed order ${payment.order_id} still not settled after 90 days: no longer read back, the payment is kept, check it in PayPal`);
          pending++;
          continue;
        }
        if (now - since >= PENDING_GIVE_UP_MS) {
          db.closeCoachingPayment(payment.order_id, 'lapsed');
          db.scheduleCoachingPaymentRead(payment.order_id, now + LAPSED_READ_MS);
          console.error(`[Coaching] pending order ${payment.order_id} still not settled after 30 days (${asked ? paypalIssue(order) : 'PayPal not reachable'}): the payment is kept, check it in PayPal`);
          closed++;
          continue;
        }
        db.scheduleCoachingPaymentRead(payment.order_id, nextPendingRead(since, now));
        pending++;
      } catch (e) {
        console.error(`[Coaching] pending order ${payment.order_id} failed:`, e.message);
      }
    }
    await Promise.all(followUps);
    return { recorded, closed, pending };
  });
}

module.exports = {
  decideCoachingCapture, centsOf, startPayment, handleReturn, returnErrorCode, expireDue, reconcileStale, readPending, nextPendingRead,
  STALE_MS, EXPIRE_GRACE_MS, PENDING_HOLD_LEAD_MS, PENDING_GIVE_UP_MS, OPEN_ORDERS_MAX,
};
