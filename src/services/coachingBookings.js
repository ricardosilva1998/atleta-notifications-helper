'use strict';

// Coaching bookings: a viewer asks for a time, the streamer answers, and the
// bot messages both sides on Discord. The rules are in coaching.js, the
// queries in db.js, the texts in coachingMessages.js. Every Discord failure is
// caught here: a message that fails is recorded (viewer side) or logged
// (streamer side), never thrown, and never undoes the booking.

const db = require('../db');
const discord = require('../discord');
const config = require('../config');
const { t } = require('../i18n');
const coaching = require('./coaching');
const messages = require('./coachingMessages');
const rooms = require('./coachingRooms');

const DAY_MS = 86400e3;
const MEMBER_KEEP_MS = 30e3; // how long Discord's answer about a viewer's membership is kept (Ruling 8)
const RECHECK_MS = 10e3; // "I've joined" asks Discord again at most this often per viewer
const SWEEP_MS = 60e3;
const ROOM_WAIT_MS = 8e3; // a confirmation waits this long for its room's link

const nameOf = (streamer) => streamer.twitch_display_name || streamer.twitch_username || '';
const bookingUrl = (streamer) => `${config.app.url}/coaching/${encodeURIComponent(streamer.twitch_username)}`;
const scheduleUrl = () => `${config.app.url}/dashboard/coaching`;
const claimedGuildIds = (streamer) => db.getGuildsForStreamer(streamer.id).map((g) => g.guild_id);

// The room's link while it is open; its error code while it failed; what became of the transcript afterwards.
// Only a session that is on (confirmed, or rescheduling with its room kept) shows a room: an ended one never does.
const ROOM_SHOWN_FOR = ['confirmed', 'rescheduling'];
function roomFields(room, row, { forViewer = false } = {}) {
  const open = room && ROOM_SHOWN_FOR.includes(row.status) && (room.state === 'open' || room.state === 'closing') && room.channel_id;
  return {
    roomUrl: open ? rooms.roomUrlOf(room) : null,
    roomError: !forViewer && room && room.state === 'failed' ? room.error || 'failed' : null,
    transcriptStatus: !forViewer && room && room.transcript_status ? room.transcript_status : null,
  };
}

// What a booking owes: a refund status read off its payments, the same for both sides (a flag, nothing about the payer).
function refundStateOf(payments) {
  if (payments.some((p) => p.refund_status === 'pending')) return 'pending';
  if (payments.some((p) => p.refund_status === 'refunded')) return 'refunded';
  return null;
}

// The coach's list of payments, one per capture, each with its refund status (null: nothing owed): the payer's PayPal
// details are in it, so it is built only for the coach's views (never for a viewer's).
function refundsOf(payments) {
  return payments.map((p) => ({
    orderId: p.order_id,
    amountCents: p.amount_cents,
    currency: p.currency,
    payerName: p.payer_name || null,
    payerEmail: p.payer_email || null,
    captureId: p.capture_id || null,
    status: p.refund_status,
    reason: p.refund_reason || null,
  }));
}

function bookingView(row, now, room = null, opts = {}) {
  const payments = opts.payments || db.listCoachingPaymentsForBookings([row.id]);
  if (opts.paymentPending === undefined && (row.status === 'awaiting_payment' || row.status === 'expired')) {
    opts = { ...opts, paymentPending: db.pendingCoachingPaymentBookingIds([row.id]).has(row.id) };
  }
  const refundState = refundStateOf(payments);
  const refundDuplicate = refundState != null && payments.filter((p) => p.refund_status === refundState).every((p) => p.refund_reason === 'double');
  const coachOnly = opts.forViewer || opts.noPayer ? {} : { refunds: refundsOf(payments) };
  return {
    id: row.id,
    startsAt: row.starts_at,
    minutes: row.minutes,
    state: opts.paymentPending && row.status === 'awaiting_payment' ? 'payment_processing'
      : opts.paymentPending && row.status === 'expired' ? 'payment_unsettled' : coaching.bookingState(row, now),
    viewerName: row.viewer_display_name || row.viewer_username,
    viewerUsername: row.viewer_username,
    viewerAvatar: row.viewer_avatar || null,
    note: row.note || '',
    messageError: row.message_error || null,
    // A booking made before prices existed has none (null) and is treated as free.
    priceCents: row.price_cents == null ? null : row.price_cents,
    currency: row.currency || null,
    payBy: row.pay_by || null,
    paid: row.paid_at != null,
    paidAmountCents: row.paid_amount_cents == null ? null : row.paid_amount_cents,
    paidCurrency: row.paid_currency || null,
    paymentIssue: row.payment_issue || null,
    cancelReason: row.cancel_reason || '',
    // While a session moves: the latest proposal (only one counts), when the reschedule started and when it closes.
    proposal: row.status === 'rescheduling' && row.proposal_starts_at != null
      ? { startsAt: row.proposal_starts_at, by: row.proposal_by, note: row.proposal_note || '', at: row.proposal_at || null }
      : null,
    rescheduleStartedAt: row.status === 'rescheduling' ? row.reschedule_started_at || null : null,
    rescheduleEndsAt: row.status === 'rescheduling' && row.reschedule_started_at != null ? row.reschedule_started_at + coaching.RESCHEDULE_WINDOW_MS : null,
    originalStartsAt: row.status === 'rescheduling' ? row.original_starts_at || null : null,
    refundState,
    refundDuplicate,
    refundPending: refundState === 'pending',
    ...coachOnly,
    ...roomFields(room, row, opts),
  };
}

// Several bookings as views, their rooms read in one query.
function bookingViews(rows, now, opts = {}) {
  const byBooking = new Map(db.listCoachingRoomsForBookings(rows.map((r) => r.id)).map((r) => [r.booking_id, r]));
  const paid = new Map();
  for (const p of db.listCoachingPaymentsForBookings(rows.map((r) => r.id))) {
    if (!paid.has(p.booking_id)) paid.set(p.booking_id, []);
    paid.get(p.booking_id).push(p);
  }
  const processing = db.pendingCoachingPaymentBookingIds(rows.filter((r) => r.status === 'awaiting_payment' || r.status === 'expired').map((r) => r.id));
  return rows.map((r) => bookingView(r, now, byBooking.get(r.id) || null, { ...opts, payments: paid.get(r.id) || [], paymentPending: processing.has(r.id) }));
}

// The currency of a streamer's coaching prices: their tip page's.
const currencyOf = (streamer) => streamer.donation_currency || 'EUR';

// The lengths a viewer can pick: switched on, and a paid one only while the streamer has a PayPal email to be paid at
// (planning decision 5). [{ minutes, priceCents }] in LENGTHS order.
function offeredLengths(streamer, settings) {
  const lengths = settings && settings.lengths ? settings.lengths : coaching.lengthsFor(settings);
  return coaching.LENGTHS
    .filter((m) => lengths[m] && lengths[m].on && (lengths[m].price === 0 || !!streamer.paypal_email))
    .map((m) => ({ minutes: m, priceCents: lengths[m].price }));
}

// Whether a viewer is in the coaching server, as discord.isGuildMember answers it: true, false, or null when Discord
// cannot say (a lookup that throws reads null; it never rejects). The answer is kept 30 s per (server, viewer), so a
// page read again or a request sent again does not ask Discord each time, and a lookup in progress is shared.
// `recheck` ("I've joined" on the booking page) asks Discord at once, at most once every 10 s per viewer; within those
// 10 s it reads the kept answer.
const members = new Map(); // `${guildId}:${userId}` -> { at, answer: Promise<true|false|null> }
const rechecks = new Map(); // userId -> when "I've joined" last asked Discord
setInterval(() => {
  const now = Date.now();
  for (const [key, kept] of members) if (now - kept.at >= MEMBER_KEEP_MS) members.delete(key);
  for (const [userId, at] of rechecks) if (now - at >= RECHECK_MS) rechecks.delete(userId);
}, SWEEP_MS).unref();

function isMember(guildId, userId, { recheck = false, now = Date.now() } = {}) {
  const key = `${guildId}:${userId}`;
  const kept = members.get(key);
  const lastRecheck = rechecks.get(userId);
  const fresh = recheck && (lastRecheck === undefined || now - lastRecheck >= RECHECK_MS);
  if (kept && !fresh && now - kept.at < MEMBER_KEEP_MS) return kept.answer;
  if (fresh) rechecks.set(userId, now);
  const answer = Promise.resolve()
    .then(() => discord.isGuildMember(guildId, userId))
    .then((member) => (member === true || member === false ? member : null), () => null);
  members.set(key, { at: now, answer });
  return answer;
}

// Forgets every kept membership answer and recheck (the tests start each from nothing).
function forgetMembers() {
  members.clear();
  rechecks.clear();
}

// The viewer's message, awaited: a failure's reason is stored and returned; a message that goes out clears the
// reason a previous one left.
async function messageViewer(streamer, settings, row, kind, { roomUrl = null, reason: cancelReason = null, refund = false, bookingLink = null, tooClose = false } = {}) {
  const lang = row.lang || 'en';
  let reason = null;
  try {
    const guildName = settings && settings.guild_id ? discord.guildName(settings.guild_id) : null;
    const payload = messages.viewerMessage(kind, {
      booking: row,
      streamerName: nameOf(streamer),
      guildName,
      inviteUrl: settings && settings.invite_code ? `https://discord.gg/${settings.invite_code}` : null,
      whereText: settings && settings.where_text ? settings.where_text : '',
      bookingUrl: bookingUrl(streamer),
      bookingLink,
      myBookingsUrl: `${config.app.url}/my-bookings?booking=${encodeURIComponent(row.id)}`,
      roomUrl,
      reason: cancelReason,
      refund,
      tooClose,
      lang,
      t: (key, params) => t(lang, key, params),
    });
    const sent = await discord.sendDirectMessage(row.viewer_discord_id, payload);
    if (!sent.ok) reason = sent.reason || 'failed';
  } catch (e) {
    reason = 'failed';
  }
  try { db.recordCoachingMessageError(row.id, reason); } catch (e) { console.error('[Coaching] could not record the message error:', e.message); }
  return reason;
}

// The streamer's message: started, never awaited by the caller (the promise is returned for the tests), failures
// logged. `always`: sent even with "Message me about new requests" off (a payment to refund cannot wait for a visit).
function messageStreamer(streamer, settings, row, kind, { always = false, refund = false, tooClose = false } = {}) {
  if (!settings || (!settings.notify_requests && !always)) return Promise.resolve();
  return (async () => {
    try {
      const lang = settings.lang || 'en';
      const payload = messages.streamerMessage(kind, {
        booking: row,
        scheduleUrl: scheduleUrl(),
        refund,
        tooClose,
        lang,
        t: (key, params) => t(lang, key, params),
      });
      const sent = await discord.sendDirectMessage(streamer.discord_user_id, payload);
      if (!sent.ok) console.error(`[Coaching] could not message streamer ${streamer.id} (${kind}): ${sent.reason}`);
    } catch (e) {
      console.error(`[Coaching] could not message streamer ${streamer.id} (${kind}):`, e.message);
    }
  })();
}

async function request(streamer, viewer, { startsAt, minutes, note, lang } = {}, { now = Date.now() } = {}) {
  const settings = db.getCoachingSettings(streamer.id);
  if (!coaching.bookable(settings, claimedGuildIds(streamer))) return { ok: false, code: 'not_open' };
  if (!coaching.LENGTHS.includes(minutes)) return { ok: false, code: 'bad_length' };
  const length = settings.lengths[minutes];
  if (!length || !length.on) return { ok: false, code: 'bad_length' };
  if (length.price > 0 && !streamer.paypal_email) return { ok: false, code: 'no_paypal' };
  const parsed = coaching.parseNote(note == null ? '' : note);
  if (!parsed.ok) return { ok: false, code: parsed.code };
  // The free times first: Discord is asked only about a request that could be booked.
  const free = coaching.freeStarts({
    hours: settings.hours, timeZone: settings.time_zone, daysOff: settings.days_off,
    held: db.getHeldCoachingBookings(streamer.id, now), now, minutes,
  });
  if (!free.includes(startsAt)) return { ok: false, code: 'bad_time' };
  const member = await isMember(settings.guild_id, viewer.discordUserId, { now });
  if (member === false) return { ok: false, code: 'join_first' };
  // The transaction counts the viewer's requests of the last 24 h (too_many), their upcoming ones (limit), then
  // looks for an overlap (taken).
  // The price and currency are the booking's own from here on: a later change of either never changes it.
  const made = db.createCoachingBooking({
    streamerId: streamer.id, viewer, startsAt, minutes, note: parsed.note, lang, now,
    priceCents: length.price, currency: currencyOf(streamer),
  });
  if (!made.ok) return { ok: false, code: made.code };
  messageStreamer(streamer, settings, made.booking, 'request');
  return { ok: true, booking: made.booking, unverified: member === null };
}

// decline/cancel: a booking that has not started. cancel: waiting, awaiting payment or confirmed, never once paid (no
// cancel after payment, planning decision 9: the update itself skips a paid booking, so a payment recorded in between
// wins).
async function decide(streamer, id, { from, to, kind, noCode, unpaidOnly = false }, now) {
  const row = db.getCoachingBooking(id, streamer.id);
  if (!row) return { ok: false, code: 'not_found' };
  if (unpaidOnly && row.paid_at != null) return { ok: false, code: 'paid' };
  if (!from.includes(row.status)) return { ok: false, code: noCode };
  if (row.starts_at <= now) return { ok: false, code: 'too_late' };
  const updated = db.setCoachingBookingStatus(id, streamer.id, from, to, now, { unpaidOnly });
  if (!updated) {
    const again = db.getCoachingBooking(id, streamer.id);
    return { ok: false, code: unpaidOnly && again && again.paid_at != null ? 'paid' : noCode };
  }
  const reason = await messageViewer(streamer, db.getCoachingSettings(streamer.id), updated, kind);
  return { ok: true, booking: { ...updated, message_error: reason, messageError: reason } };
}

// Once a booking is confirmed (a free length accepted, or a payment recorded): its room is made (the hook
// coachingRooms.makeFor; nothing yet) and the viewer is messaged with the room's link, or the where text. Resolves to
// the viewer message's failure reason (null when it went out); never throws.
async function afterConfirmed(streamer, booking, kind) {
  // The room is made in the background if Discord is slow: the message then goes without its link.
  let room = null;
  let timer;
  try {
    room = await Promise.race([
      rooms.makeFor(booking.id),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), ROOM_WAIT_MS); timer.unref(); }),
    ]);
  } catch (e) {
    console.error(`[Coaching] room for booking ${booking.id} failed:`, e && e.message);
  } finally { clearTimeout(timer); }
  const settings = db.getCoachingSettings(streamer.id);
  return messageViewer(streamer, settings, booking, kind, { roomUrl: room && room.url ? room.url : null });
}

// Accept a waiting request that has not started. A paid length waits for the viewer's payment until
// coaching.payBy(now, start) (planning decision 6): refused without the streamer's PayPal email (no_paypal) or when
// the viewer would have under 10 minutes to pay (too_close). A free length (price 0, or a booking from before prices)
// is confirmed at once.
async function accept(streamer, id, { now = Date.now() } = {}) {
  const row = db.getCoachingBooking(id, streamer.id);
  if (!row) return { ok: false, code: 'not_found' };
  if (row.status !== 'waiting') return { ok: false, code: 'not_waiting' };
  if (row.starts_at <= now) return { ok: false, code: 'too_late' };
  const paid = row.price_cents > 0;
  if (paid && !streamer.paypal_email) return { ok: false, code: 'no_paypal' };
  if (paid && !coaching.canAcceptPaid(now, row.starts_at)) return { ok: false, code: 'too_close' };
  const updated = db.acceptCoachingBooking(id, streamer.id, now, paid ? coaching.payBy(now, row.starts_at) : null);
  if (!updated) return { ok: false, code: 'not_waiting' };
  const reason = paid
    ? await messageViewer(streamer, db.getCoachingSettings(streamer.id), updated, 'acceptedPay')
    : await afterConfirmed(streamer, updated, 'accepted');
  return { ok: true, booking: { ...updated, message_error: reason, messageError: reason } };
}

const decline = (streamer, id, { now = Date.now() } = {}) =>
  decide(streamer, id, { from: ['waiting'], to: 'declined', kind: 'declined', noCode: 'not_waiting' }, now);

// The coach's cancel: a waiting, awaiting-payment or confirmed booking before its start (paid ones too), or a
// rescheduling one at any time, always with a reason (1-500 characters). Its room and role are deleted at once, a paid
// booking's payments owe a refund (the coach refunds in PayPal and presses Refunded: Atleta never refunds), and the
// viewer is messaged with the reason. Discord being down never fails the cancel.
async function cancel(streamer, id, { reason, now = Date.now() } = {}) {
  const row = db.getCoachingBooking(id, streamer.id);
  if (!row) return { ok: false, code: 'not_found' };
  const parsed = coaching.parseCancelReason(reason);
  if (!parsed.ok) return { ok: false, code: parsed.code };
  if (!coaching.canCoachCancel(row, now)) {
    return { ok: false, code: coaching.HOLDING.includes(row.status) ? 'too_late' : 'not_active' };
  }
  if (db.pendingCoachingPaymentBookingIds([id]).has(row.id)) return { ok: false, code: 'payment_processing' };
  const done = db.cancelCoachingBookingByCoach(id, streamer.id, parsed.reason, now);
  if (!done.ok) return { ok: false, code: 'not_active' };
  const refund = done.refundPending === true;
  const [, messageError] = await Promise.all([
    rooms.removeFor(id, { now }),
    messageViewer(streamer, db.getCoachingSettings(streamer.id), done.booking, 'cancelled', { reason: parsed.reason, refund }),
  ]);
  return { ok: true, booking: { ...done.booking, message_error: messageError, messageError }, refundPending: refund };
}

// "Refunded": the coach says they refunded this payment in PayPal. Only that payment's streamer, only from pending;
// Atleta checks nothing with PayPal. The viewer is messaged (a failure is kept on the booking, never fails this).
async function markRefunded(streamer, orderId, { now = Date.now() } = {}) {
  if (typeof orderId !== 'string' || !/^[A-Z0-9-]{10,64}$/i.test(orderId)) return { ok: false, code: 'not_found' };
  const payment = db.getCoachingPayment(orderId);
  if (!payment || Number(payment.streamer_id) !== Number(streamer.id)) return { ok: false, code: 'not_found' };
  const updated = db.markCoachingRefunded(orderId, streamer.id, now);
  if (!updated) return { ok: false, code: 'not_pending' };
  const booking = db.getCoachingBooking(payment.booking_id, streamer.id);
  const kind = payment.refund_reason === 'double' ? 'duplicateRefunded' : 'refunded';
  const messageError = booking ? await messageViewer(streamer, db.getCoachingSettings(streamer.id), booking, kind) : null;
  return { ok: true, payment: updated, booking: booking ? { ...booking, message_error: messageError, messageError } : null };
}

// The viewer's own booking, waiting, awaiting payment or confirmed (else not_active: answered or withdrawn already), until
// it starts (a rescheduling one at any time: its original time no longer limits it); never once paid (paid).
async function withdraw(streamer, viewer, id, { now = Date.now() } = {}) {
  const row = db.getCoachingBooking(id, streamer.id);
  if (!row || row.viewer_discord_id !== viewer.discordUserId) return { ok: false, code: 'not_found' };
  if (row.paid_at != null) return { ok: false, code: 'paid' };
  if (row.status === 'awaiting_payment' && db.pendingCoachingPaymentBookingIds([id]).has(row.id)) return { ok: false, code: 'payment_processing' };
  if (!coaching.HOLDING.includes(row.status)) return { ok: false, code: 'not_active' };
  if (row.status !== 'rescheduling' && row.starts_at <= now) return { ok: false, code: 'too_late' }; // a rescheduling row's starts_at is the original time, which limits nothing
  const updated = db.setCoachingBookingStatus(id, streamer.id, coaching.HOLDING, 'withdrawn', now, { unpaidOnly: true });
  if (!updated) {
    const again = db.getCoachingBooking(id, streamer.id);
    return { ok: false, code: again && again.paid_at != null ? 'paid' : 'not_active' }; // paid or answered in between
  }
  // A session that was on has a room: it goes with it (no transcript), as with a cancel.
  if (ROOM_SHOWN_FOR.includes(row.status)) await rooms.removeFor(id, { now });
  messageStreamer(streamer, db.getCoachingSettings(streamer.id), updated, 'withdrawn');
  return { ok: true, booking: updated };
}

// ── Reschedule ──────────────────────────────────────────────────────────────
// Only the coach starts one (never the viewer), on a confirmed session before its start; the session keeps its length,
// price and payment. A proposal is held like a booking (db.js). Every Discord failure is caught here.

const bookingLinkOf = (streamer, id) => `${bookingUrl(streamer)}?booking=${id}`;

// The booking's own row is left out of the held times: its original time is not held while it moves, and the coach may
// propose it again.
const heldWithout = (streamerId, id, now) => db.getHeldCoachingBookings(streamerId, now).filter((h) => h.id !== id);

const PROPOSAL_CODES = { own_proposal: 'not_yours_to_answer', too_close: 'proposal_too_close' };
const mapProposalCode = (code) => PROPOSAL_CODES[code] || code;

function parseProposalNote(note) {
  const parsed = coaching.parseNote(note == null ? '' : note);
  return parsed.ok ? { ok: true, note: parsed.note } : { ok: false, code: 'bad_note' };
}

// The starts a coach can offer for this booking (confirmed or rescheduling): any half hour from an hour ahead to the
// horizon, not held by another booking, the original time included.
function coachStarts(streamer, id, { now = Date.now() } = {}) {
  const row = db.getCoachingBooking(id, streamer.id);
  if (!row) return { ok: false, code: 'not_found' };
  if (!coaching.canReschedule(row, now) && row.status !== 'rescheduling') return { ok: false, code: 'not_confirmed' };
  const settings = db.getCoachingSettings(streamer.id);
  if (!settings) return { ok: false, code: 'not_found' };
  return { ok: true, minutes: row.minutes, starts: coaching.coachProposalStarts({ timeZone: settings.time_zone, held: heldWithout(streamer.id, id, now), now, minutes: row.minutes }) };
}

// The viewer's starts for their rescheduling booking: the coach's free starts, never the original time.
function viewerStarts(streamer, viewer, id, { now = Date.now() } = {}) {
  const row = db.getCoachingBooking(id, streamer.id);
  if (!row || row.viewer_discord_id !== viewer.discordUserId) return { ok: false, code: 'not_found' };
  if (row.status !== 'rescheduling') return { ok: false, code: 'not_rescheduling' };
  const settings = db.getCoachingSettings(streamer.id);
  if (!settings) return { ok: false, code: 'not_found' };
  return {
    ok: true, minutes: row.minutes,
    starts: coaching.viewerRescheduleStarts({
      originalStartsAt: row.original_starts_at, hours: settings.hours, timeZone: settings.time_zone, daysOff: settings.days_off,
      held: heldWithout(streamer.id, id, now), now, minutes: row.minutes,
    }),
  };
}

// Way 'propose' (with a time) or 'ask' (the viewer picks). The original time is released at once.
async function startReschedule(streamer, id, { way, startsAt, note, now = Date.now() } = {}) {
  const row = db.getCoachingBooking(id, streamer.id);
  if (!row) return { ok: false, code: 'not_found' };
  if (!coaching.canReschedule(row, now)) return { ok: false, code: 'not_confirmed' };
  if (way !== 'propose' && way !== 'ask') return { ok: false, code: 'bad_way' };
  const parsed = parseProposalNote(note);
  if (!parsed.ok) return parsed;
  let proposal = null;
  if (way === 'propose') {
    const allowed = coachStarts(streamer, id, { now });
    if (!allowed.ok || !allowed.starts.includes(startsAt)) return { ok: false, code: 'bad_time' };
    proposal = { startsAt, note: parsed.note };
  }
  const done = db.startCoachingReschedule(id, streamer.id, way, proposal, now);
  if (!done.ok) return { ok: false, code: done.code };
  const settings = db.getCoachingSettings(streamer.id);
  const messageError = await messageViewer(streamer, settings, done.booking, way === 'propose' ? 'rescheduleProposed' : 'rescheduleAsk', { bookingLink: bookingLinkOf(streamer, id) });
  return { ok: true, booking: { ...done.booking, message_error: messageError, messageError } };
}

// The coach answers with a different time (a back-and-forth, any number of rounds).
async function coachPropose(streamer, id, { startsAt, note, now = Date.now() } = {}) {
  const row = db.getCoachingBooking(id, streamer.id);
  if (!row) return { ok: false, code: 'not_found' };
  if (row.status !== 'rescheduling') return { ok: false, code: 'not_rescheduling' };
  const parsed = parseProposalNote(note);
  if (!parsed.ok) return parsed;
  const allowed = coachStarts(streamer, id, { now });
  if (!allowed.ok || !allowed.starts.includes(startsAt)) return { ok: false, code: 'bad_time' };
  const done = db.proposeCoachingTime(id, 'coach', startsAt, parsed.note, now);
  if (!done.ok) return { ok: false, code: done.code };
  const messageError = await messageViewer(streamer, db.getCoachingSettings(streamer.id), done.booking, 'proposal', { bookingLink: bookingLinkOf(streamer, id) });
  return { ok: true, booking: { ...done.booking, message_error: messageError, messageError } };
}

// The viewer answers with a time from viewerStarts; the coach is told (always).
async function viewerPropose(streamer, viewer, id, { startsAt, note, now = Date.now() } = {}) {
  const row = db.getCoachingBooking(id, streamer.id);
  if (!row || row.viewer_discord_id !== viewer.discordUserId) return { ok: false, code: 'not_found' };
  if (row.status !== 'rescheduling') return { ok: false, code: 'not_rescheduling' };
  const parsed = parseProposalNote(note);
  if (!parsed.ok) return parsed;
  const allowed = viewerStarts(streamer, viewer, id, { now });
  if (!allowed.ok || !allowed.starts.includes(startsAt)) return { ok: false, code: 'bad_time' };
  const done = db.proposeCoachingTime(id, 'viewer', startsAt, parsed.note, now);
  if (!done.ok) return { ok: false, code: done.code };
  messageStreamer(streamer, db.getCoachingSettings(streamer.id), done.booking, 'viewerProposed', { always: true });
  return { ok: true, booking: done.booking };
}

// The proposal becomes the session's time: the room is renamed to the new date (a rename that fails never fails this),
// the close moves, and both sides are told, the viewer with the room's link.
async function afterAgreement(streamer, done, now) {
  const settings = db.getCoachingSettings(streamer.id);
  let room = null;
  let timer;
  try {
    room = await Promise.race([
      rooms.reschedule(done.booking.id, { now }),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), ROOM_WAIT_MS); timer.unref(); }),
    ]);
  } catch (e) {
    console.error(`[Coaching] room of booking ${done.booking.id} after the new time:`, e && e.message);
  } finally { clearTimeout(timer); }
  const [messageError] = await Promise.all([
    messageViewer(streamer, settings, done.booking, 'rescheduleAgreed', { roomUrl: room && room.url ? room.url : null }),
    messageStreamer(streamer, settings, done.booking, 'agreedCoach', { always: true }),
  ]);
  return messageError;
}

async function acceptProposal(streamer, row, by, now) {
  const done = db.acceptCoachingProposal(row.id, by, now);
  if (!done.ok) return { ok: false, code: mapProposalCode(done.code) };
  const messageError = await afterAgreement(streamer, done, now);
  return { ok: true, booking: { ...done.booking, message_error: messageError, messageError } };
}

async function coachAccept(streamer, id, { now = Date.now() } = {}) {
  const row = db.getCoachingBooking(id, streamer.id);
  if (!row) return { ok: false, code: 'not_found' };
  return acceptProposal(streamer, row, 'coach', now);
}

async function viewerAccept(streamer, viewer, id, { now = Date.now() } = {}) {
  const row = db.getCoachingBooking(id, streamer.id);
  if (!row || row.viewer_discord_id !== viewer.discordUserId) return { ok: false, code: 'not_found' };
  return acceptProposal(streamer, row, 'viewer', now);
}

// The minute tick's part: a proposal that went unanswered for 48 h or came within the hour is dropped (the viewer is
// asked to pick when it was the coach's, the coach is reminded when it was the viewer's), and a reschedule with no
// agreement after 7 days closes as not rescheduled (the room is deleted, a paid session owes a refund). All state is in
// the database, so a restart loses nothing; Discord being down never stops a step.
let reschedulesBusy = false;
async function runDueReschedules({ now = Date.now() } = {}) {
  if (reschedulesBusy) return null;
  reschedulesBusy = true;
  const result = { dropped: 0, closed: 0 };
  try {
    for (const row of db.listDueReschedules(now)) {
      try {
        const action = coaching.rescheduleDue(row, now);
        if (!action) continue;
        const streamer = db.getStreamerById(row.streamer_id);
        if (!streamer) continue;
        const settings = db.getCoachingSettings(streamer.id);
        if (action === 'close') {
          const done = db.closeCoachingReschedule(row.id, now);
          if (!done.ok) continue;
          result.closed++;
          const refund = done.refundPending === true;
          await Promise.all([
            rooms.removeFor(row.id, { now }),
            messageViewer(streamer, settings, done.booking, 'notRescheduled', { refund }),
            messageStreamer(streamer, settings, done.booking, 'notRescheduledCoach', { always: true, refund }),
          ]);
        } else {
          const done = db.dropCoachingProposal(row.id, now);
          if (!done.ok) continue;
          result.dropped++;
          if (done.dropped.by === 'viewer') await messageStreamer(streamer, settings, done.booking, 'viewerLapsed', { always: true, tooClose: action === 'too_close' });
          else await messageViewer(streamer, settings, done.booking, 'proposalLapsed', { bookingLink: bookingLinkOf(streamer, row.id), tooClose: action === 'too_close' });
        }
      } catch (e) {
        console.error(`[Coaching] reschedule of booking ${row.id}:`, e && e.message);
      }
    }
  } finally { reschedulesBusy = false; }
  return result;
}

// After a payment was recorded (services/coachingPayments.js), by recordCoachingPayment's result: a booking it
// confirmed gets its room and both sides are told; a payment the booking could not take ('late_issue', 'double') is
// told to the streamer, always, to refund in PayPal. Resolves when the messages are sent; never throws.
async function afterPayment(streamer, booking, result) {
  const settings = db.getCoachingSettings(streamer.id);
  try {
    if (result === 'recorded' || result === 'late_confirmed') {
      await Promise.all([afterConfirmed(streamer, booking, 'confirmed'), messageStreamer(streamer, settings, booking, 'paid')]);
    } else if (result === 'late_issue' || result === 'double') {
      const tasks = [messageStreamer(streamer, settings, booking, result === 'double' ? 'paymentDuplicate' : 'paymentLate', { always: true })];
      if (result === 'late_issue') tasks.push(messageViewer(streamer, settings, booking, 'paymentLateViewer'));
      await Promise.all(tasks);
    }
  } catch (e) {
    console.error(`[Coaching] after the payment of booking ${booking.id}:`, e && e.message);
  }
}

// A booking that was not paid in time (coachingPayments.expireDue): both sides are told; never throws.
async function afterExpired(streamer, booking) {
  const settings = db.getCoachingSettings(streamer.id);
  try {
    // A payment PayPal still holds as PENDING: the viewer is not told they did not pay.
    const held = db.pendingCoachingPaymentBookingIds([booking.id]).has(booking.id);
    await Promise.all([
      messageViewer(streamer, settings, booking, held ? 'expiredPending' : 'expired'),
      messageStreamer(streamer, settings, booking, held ? 'unpaidPending' : 'unpaid'),
    ]);
  } catch (e) {
    console.error(`[Coaching] after the expiry of booking ${booking.id}:`, e && e.message);
  }
}

// Asks Discord about the saved invite at most once an hour (or when forced) and records the answer: an unknown invite,
// or one to another server, is dead (0). No answer records when it was asked and keeps the last answer, so a Discord
// that is down is asked again an hour later, not on every page (Ruling 9). One check at a time per streamer: a call
// while one is in progress gets its answer.
const inviteChecks = new Map(); // streamerId -> the check in progress

function checkInvite(streamerId, options = {}) {
  const running = inviteChecks.get(streamerId);
  if (running) return running;
  const check = runInviteCheck(streamerId, options).finally(() => inviteChecks.delete(streamerId));
  inviteChecks.set(streamerId, check);
  return check;
}

async function runInviteCheck(streamerId, { now = Date.now(), force = false } = {}) {
  const settings = db.getCoachingSettings(streamerId);
  if (!settings || !settings.invite_code) return settings;
  if (!force && settings.invite_checked_at && now - settings.invite_checked_at < coaching.INVITE_CHECK_MS) return settings;
  let result;
  try { result = await discord.fetchInvite(settings.invite_code); } catch (e) { result = { ok: false, reason: 'unavailable' }; }
  let ok = null;
  if (result && result.ok) ok = result.guildId === settings.guild_id ? 1 : 0;
  else if (result && result.reason === 'unknown') ok = 0;
  db.recordInviteCheck(streamerId, settings.invite_code, ok, now);
  return db.getCoachingSettings(streamerId);
}

// checkInvite started once a page is sent (res.once('finish') on /dashboard and /dashboard/coaching): never awaited,
// a failure logged; what it learns shows on the next visit.
function checkInviteLater(streamerId) {
  Promise.resolve()
    .then(() => checkInvite(streamerId))
    .catch((e) => console.error(`[Coaching] invite check for streamer ${streamerId} failed:`, e && e.message));
}

function cardData(streamer, { now = Date.now(), claimedGuildIds: claimed = [] } = {}) {
  const settings = db.getCoachingSettings(streamer.id);
  let setup = null;
  if (!streamer.twitch_username) setup = 'twitch';
  else if (!claimed.length) setup = 'server';
  else if (!settings) setup = 'hours';
  const upcoming = settings
    ? db.getCoachingSchedule(streamer.id, now, now + 60 * DAY_MS).filter((r) => r.starts_at > now)
    : [];
  const waiting = upcoming.filter((r) => r.status === 'waiting');
  const confirmed = upcoming.find((r) => r.status === 'confirmed' || r.status === 'awaiting_payment');
  const money = {
    currency: currencyOf(streamer),
    hasPaypal: !!streamer.paypal_email,
    checkPrices: currencyOf(streamer) !== 'EUR' && !(settings && settings.prices_saved_at),
  };
  return {
    ...money,
    setup,
    open: !!(settings && settings.open),
    bookable: coaching.bookable(settings, claimed),
    inviteBroken: !!(settings && settings.invite_code && settings.invite_ok === 0),
    waiting: bookingViews(waiting.slice(0, 5), now, { noPayer: true }),
    waitingCount: settings ? db.countWaitingCoaching(streamer.id, now) : 0,
    // The dashboard card never carries the payer's PayPal details: they are for the coach's schedule page only.
    next: confirmed ? bookingViews([confirmed], now, { noPayer: true })[0] : null,
    refundsPending: settings ? db.countPendingCoachingRefunds(streamer.id) : 0,
    roomErrors: upcoming.filter((r) => r.status === 'confirmed').length
      ? db.listCoachingRoomsForBookings(upcoming.filter((r) => r.status === 'confirmed').map((r) => r.id)).filter((r) => r.state === 'failed').length
      : 0,
  };
}

module.exports = {
  bookingView, bookingViews, offeredLengths, currencyOf, isMember, forgetMembers, request, accept, decline, cancel, markRefunded, withdraw,
  coachStarts, viewerStarts, startReschedule, coachPropose, viewerPropose, coachAccept, viewerAccept, runDueReschedules,
  afterPayment, afterExpired, checkInvite, checkInviteLater, cardData,
};
