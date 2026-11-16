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
function roomFields(room, { forViewer = false } = {}) {
  const open = room && (room.state === 'open' || room.state === 'closing') && room.channel_id;
  return {
    roomUrl: open ? rooms.roomUrlOf(room) : null,
    roomError: !forViewer && room && room.state === 'failed' ? room.error || 'failed' : null,
    transcriptStatus: !forViewer && room && room.transcript_status ? room.transcript_status : null,
  };
}

function bookingView(row, now, room = null, opts = {}) {
  return {
    id: row.id,
    startsAt: row.starts_at,
    minutes: row.minutes,
    state: coaching.bookingState(row, now),
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
    ...roomFields(room, opts),
  };
}

// Several bookings as views, their rooms read in one query.
function bookingViews(rows, now, opts = {}) {
  const byBooking = new Map(db.listCoachingRoomsForBookings(rows.map((r) => r.id)).map((r) => [r.booking_id, r]));
  return rows.map((r) => bookingView(r, now, byBooking.get(r.id) || null, opts));
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
async function messageViewer(streamer, settings, row, kind, { roomUrl = null } = {}) {
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
      roomUrl,
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
function messageStreamer(streamer, settings, row, kind, { always = false } = {}) {
  if (!settings || (!settings.notify_requests && !always)) return Promise.resolve();
  return (async () => {
    try {
      const lang = settings.lang || 'en';
      const payload = messages.streamerMessage(kind, {
        booking: row,
        scheduleUrl: scheduleUrl(),
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
const cancel = (streamer, id, { now = Date.now() } = {}) =>
  decide(streamer, id, { from: coaching.HOLDING, to: 'cancelled', kind: 'cancelled', noCode: 'not_active', unpaidOnly: true }, now);

// The viewer's own booking, waiting, awaiting payment or confirmed (else not_active: answered or withdrawn already), until
// it starts; never once paid (paid).
async function withdraw(streamer, viewer, id, { now = Date.now() } = {}) {
  const row = db.getCoachingBooking(id, streamer.id);
  if (!row || row.viewer_discord_id !== viewer.discordUserId) return { ok: false, code: 'not_found' };
  if (row.paid_at != null) return { ok: false, code: 'paid' };
  if (!coaching.HOLDING.includes(row.status)) return { ok: false, code: 'not_active' };
  if (row.starts_at <= now) return { ok: false, code: 'too_late' };
  const updated = db.setCoachingBookingStatus(id, streamer.id, coaching.HOLDING, 'withdrawn', now, { unpaidOnly: true });
  if (!updated) {
    const again = db.getCoachingBooking(id, streamer.id);
    return { ok: false, code: again && again.paid_at != null ? 'paid' : 'not_active' }; // paid or answered in between
  }
  messageStreamer(streamer, db.getCoachingSettings(streamer.id), updated, 'withdrawn');
  return { ok: true, booking: updated };
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
      await messageStreamer(streamer, settings, booking, 'paymentLate', { always: true });
    }
  } catch (e) {
    console.error(`[Coaching] after the payment of booking ${booking.id}:`, e && e.message);
  }
}

// A booking that was not paid in time (coachingPayments.expireDue): both sides are told; never throws.
async function afterExpired(streamer, booking) {
  const settings = db.getCoachingSettings(streamer.id);
  try {
    await Promise.all([messageViewer(streamer, settings, booking, 'expired'), messageStreamer(streamer, settings, booking, 'unpaid')]);
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
    waiting: bookingViews(waiting.slice(0, 5), now),
    waitingCount: settings ? db.countWaitingCoaching(streamer.id, now) : 0,
    next: confirmed ? bookingViews([confirmed], now)[0] : null,
    roomErrors: upcoming.filter((r) => r.status === 'confirmed').length
      ? db.listCoachingRoomsForBookings(upcoming.filter((r) => r.status === 'confirmed').map((r) => r.id)).filter((r) => r.state === 'failed').length
      : 0,
  };
}

module.exports = {
  bookingView, bookingViews, offeredLengths, currencyOf, isMember, forgetMembers, request, accept, decline, cancel, withdraw,
  afterPayment, afterExpired, checkInvite, checkInviteLater, cardData,
};
