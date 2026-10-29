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

const DAY_MS = 86400e3;

const nameOf = (streamer) => streamer.twitch_display_name || streamer.twitch_username || '';
const bookingUrl = (streamer) => `${config.app.url}/coaching/${encodeURIComponent(streamer.twitch_username)}`;
const scheduleUrl = () => `${config.app.url}/dashboard/coaching`;
const claimedGuildIds = (streamer) => db.getGuildsForStreamer(streamer.id).map((g) => g.guild_id);

function bookingView(row, now) {
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
  };
}

// The viewer's message, awaited: a failure's reason is stored and returned.
async function messageViewer(streamer, settings, row, kind) {
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
      t: (key, params) => t(lang, key, params),
    });
    const sent = await discord.sendDirectMessage(row.viewer_discord_id, payload);
    if (!sent.ok) reason = sent.reason || 'failed';
  } catch (e) {
    reason = 'failed';
  }
  if (reason) {
    try { db.recordCoachingMessageError(row.id, reason); } catch (e) { console.error('[Coaching] could not record the message error:', e.message); }
  }
  return reason;
}

// The streamer's message: started, never awaited by the caller, failures logged.
function messageStreamer(streamer, settings, row, kind) {
  if (!settings || !settings.notify_requests) return;
  (async () => {
    try {
      const lang = settings.lang || 'en';
      const payload = messages.streamerMessage(kind, {
        booking: row,
        scheduleUrl: scheduleUrl(),
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
  const parsed = coaching.parseNote(note == null ? '' : note);
  if (!parsed.ok) return { ok: false, code: parsed.code };
  const member = await discord.isGuildMember(settings.guild_id, viewer.discordUserId);
  if (member === false) return { ok: false, code: 'join_first' };
  const free = coaching.freeStarts({
    hours: settings.hours, timeZone: settings.time_zone, daysOff: settings.days_off,
    held: db.getHeldCoachingBookings(streamer.id, now), now, minutes,
  });
  if (!free.includes(startsAt)) return { ok: false, code: 'bad_time' };
  const made = db.createCoachingBooking({ streamerId: streamer.id, viewer, startsAt, minutes, note: parsed.note, lang, now });
  if (!made.ok) return { ok: false, code: made.code };
  messageStreamer(streamer, settings, made.booking, 'request');
  return { ok: true, booking: made.booking, unverified: member === null };
}

// accept/decline: a waiting booking that has not started. cancel: waiting or confirmed, not started.
async function decide(streamer, id, { from, to, kind, noCode }, now) {
  const row = db.getCoachingBooking(id, streamer.id);
  if (!row) return { ok: false, code: 'not_found' };
  if (!from.includes(row.status)) return { ok: false, code: noCode };
  if (row.starts_at <= now) return { ok: false, code: 'too_late' };
  const updated = db.setCoachingBookingStatus(id, streamer.id, from, to, now);
  if (!updated) return { ok: false, code: noCode };
  const reason = await messageViewer(streamer, db.getCoachingSettings(streamer.id), updated, kind);
  return { ok: true, booking: { ...updated, message_error: reason, messageError: reason } };
}

const accept = (streamer, id, { now = Date.now() } = {}) =>
  decide(streamer, id, { from: ['waiting'], to: 'confirmed', kind: 'accepted', noCode: 'not_waiting' }, now);
const decline = (streamer, id, { now = Date.now() } = {}) =>
  decide(streamer, id, { from: ['waiting'], to: 'declined', kind: 'declined', noCode: 'not_waiting' }, now);
const cancel = (streamer, id, { now = Date.now() } = {}) =>
  decide(streamer, id, { from: ['waiting', 'confirmed'], to: 'cancelled', kind: 'cancelled', noCode: 'not_active' }, now);

async function withdraw(streamer, viewer, id, { now = Date.now() } = {}) {
  const row = db.getCoachingBooking(id, streamer.id);
  if (!row || row.viewer_discord_id !== viewer.discordUserId) return { ok: false, code: 'not_found' };
  if (!coaching.HOLDING.includes(row.status) || row.starts_at <= now) return { ok: false, code: 'too_late' };
  const updated = db.setCoachingBookingStatus(id, streamer.id, coaching.HOLDING, 'withdrawn', now);
  if (!updated) return { ok: false, code: 'too_late' };
  messageStreamer(streamer, db.getCoachingSettings(streamer.id), updated, 'withdrawn');
  return { ok: true, booking: updated };
}

// Asks Discord about the saved invite at most once an hour (or when forced) and records the answer.
async function checkInvite(streamerId, { now = Date.now(), force = false } = {}) {
  const settings = db.getCoachingSettings(streamerId);
  if (!settings || !settings.invite_code) return settings;
  if (!force && settings.invite_checked_at && now - settings.invite_checked_at < coaching.INVITE_CHECK_MS) return settings;
  let result;
  try { result = await discord.fetchInvite(settings.invite_code); } catch (e) { return settings; }
  if (result.ok) {
    db.recordInviteCheck(streamerId, settings.invite_code, result.guildId === settings.guild_id ? 1 : 0, now);
  } else if (result.reason === 'unknown') {
    db.recordInviteCheck(streamerId, settings.invite_code, 0, now);
  } else {
    return settings;
  }
  return db.getCoachingSettings(streamerId);
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
  const confirmed = upcoming.find((r) => r.status === 'confirmed');
  return {
    setup,
    open: !!(settings && settings.open),
    bookable: coaching.bookable(settings, claimed),
    inviteBroken: !!(settings && settings.invite_code && settings.invite_ok === 0),
    waiting: waiting.slice(0, 5).map((r) => bookingView(r, now)),
    waitingCount: settings ? db.countWaitingCoaching(streamer.id, now) : 0,
    next: confirmed ? bookingView(confirmed, now) : null,
  };
}

module.exports = { bookingView, request, accept, decline, cancel, withdraw, checkInvite, cardData };
