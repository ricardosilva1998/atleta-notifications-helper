'use strict';

// The streamer's coaching page, /dashboard/coaching, and its JSON routes (docs/superpowers/specs/2026-10-29-coaching-
// design.md, "The streamer's side" and "A dead invite"), mounted inside the dashboard router, so behind its login, the
// disabled-account check and CSRF. The page (views/coaching-dashboard.ejs) is drawn by public/js/coaching-dashboard.js
// from window.COACHING_DASHBOARD_DATA: the Schedule (the bookings to come, grouped by day in the streamer's zone, and
// the last 30 days below) and When I coach (the weekly hours, the zone, the days off, where we meet, the booking
// link). Every refusal is { ok: false, code, error }, the error being the code's text in the page's language. Times
// travel as UTC milliseconds.

const { Router } = require('express');
const db = require('../db');
const discord = require('../discord');
const config = require('../config');
const coaching = require('../services/coaching');
const coachingBookings = require('../services/coachingBookings');
const { canonicalTimeZone } = require('../services/goalPeriods');
const { parseSwitch } = require('../services/inputLimits');

const router = Router();

const DAY_MS = 86400e3;
const MINUTE_MS = 60e3;
const PAST_DAYS = 30; // the sessions of the last 30 days are listed under the schedule
// Every booking to come: one is made at most 14 days ahead, and a zone moved east can only push it a day further.
const AHEAD_DAYS = 60;

// code -> [status, text key]
const REFUSALS = {
  bad_zone: [400, 'coaching.dashboard.error.bad_zone'],
  bad_hours: [400, 'coaching.dashboard.error.bad_hours'],
  bad_days_off: [400, 'coaching.dashboard.error.bad_days_off'],
  bad_server: [400, 'coaching.dashboard.error.bad_server'],
  bad_invite: [400, 'coaching.dashboard.error.bad_invite'],
  invite_other_server: [400, 'coaching.dashboard.error.invite_other_server'],
  bad_where: [400, 'coaching.dashboard.error.bad_where'],
  bad_switch: [400, 'coaching.dashboard.error.bad_switch'],
  not_set_up: [409, 'coaching.dashboard.error.not_set_up'],
  not_found: [404, 'coaching.error.not_found'],
  too_late: [409, 'coaching.dashboard.error.too_late'],
  not_waiting: [409, 'coaching.dashboard.error.not_waiting'],
  not_active: [409, 'coaching.dashboard.error.not_active'],
};
function refuse(res, code) {
  const [status, key] = REFUSALS[code] || [400, 'coaching.page.failed'];
  res.status(status).json({ ok: false, code, error: res.locals.t(key) });
}

// The texts public/js/coaching-dashboard.js reads, as window.COACHING_DASHBOARD_TEXTS (name -> key; their {{fields}}
// are kept for the script, which fills them), and the states' names under `states` (the booking page's).
const TEXT_KEYS = {
  zone: 'coaching.dashboard.zone', empty: 'coaching.dashboard.empty', emptyNotSetUp: 'coaching.dashboard.emptyNotSetUp',
  minutes30: 'coaching.page.minutes30', minutes60: 'coaching.page.minutes60',
  accept: 'coaching.dashboard.accept', decline: 'coaching.dashboard.decline', cancel: 'coaching.dashboard.cancel',
  declineConfirm: 'coaching.dashboard.declineConfirm', cancelConfirm: 'coaching.dashboard.cancelConfirm',
  accepted: 'coaching.dashboard.accepted', declined: 'coaching.dashboard.declined', cancelled: 'coaching.dashboard.cancelled',
  messageError: 'coaching.dashboard.messageError', outside: 'coaching.dashboard.outside',
  statusOpen: 'coaching.dashboard.statusOpen', statusPaused: 'coaching.dashboard.statusPaused', statusNotSetUp: 'coaching.dashboard.statusNotSetUp',
  dayOn: 'coaching.dashboard.dayOn', from: 'coaching.dashboard.from', to: 'coaching.dashboard.to',
  daysOffNone: 'coaching.dashboard.daysOffNone', removeDayOff: 'coaching.dashboard.removeDayOff',
  save: 'coaching.dashboard.save', saveFirst: 'coaching.dashboard.saveFirst', saving: 'coaching.dashboard.saving',
  saved: 'coaching.dashboard.saved', savedOpened: 'coaching.dashboard.savedOpened', savedUnchecked: 'coaching.dashboard.savedUnchecked',
  outsideSaved: 'coaching.dashboard.outsideSaved', copied: 'coaching.dashboard.copied',
  sessionEnded: 'coaching.dashboard.sessionEnded', failed: 'coaching.page.failed', offline: 'coaching.page.offline',
};
const STATE_KEYS = {
  waiting: 'coaching.state.waiting', confirmed: 'coaching.state.confirmed', declined: 'coaching.state.declined',
  cancelled: 'coaching.state.cancelled', withdrawn: 'coaching.state.withdrawn', unanswered: 'coaching.state.unanswered',
};
const KEEP_FIELDS = new Proxy({}, { get: (_, name) => `{{${String(name)}}}` });
function pageTexts(t) {
  const texts = {};
  for (const [name, key] of Object.entries(TEXT_KEYS)) texts[name] = t(key, KEEP_FIELDS);
  texts.states = {};
  for (const [state, key] of Object.entries(STATE_KEYS)) texts.states[state] = t(key);
  return texts;
}

const inviteLink = (code) => (code ? `https://discord.gg/${code}` : '');

// What the page and a save's answer say about the settings; before the first save, what the form starts with.
function settingsView(settings, now, servers) {
  if (!settings) {
    return {
      open: false, timeZone: null, hours: coaching.DEFAULT_HOURS, daysOff: [],
      guildId: servers.length ? servers[0].id : null, invite: '', inviteOk: null, where: '', notifyRequests: true,
    };
  }
  const today = coaching.localDateOf(now, settings.time_zone);
  return {
    open: !!settings.open,
    timeZone: settings.time_zone,
    hours: settings.hours,
    daysOff: settings.days_off.filter((d) => d >= today),
    guildId: settings.guild_id,
    invite: inviteLink(settings.invite_code),
    inviteOk: settings.invite_ok == null ? null : !!settings.invite_ok,
    where: settings.where_text || '',
    notifyRequests: !!settings.notify_requests,
  };
}

const rulesOf = (settings) => ({ hours: settings.hours, timeZone: settings.time_zone, daysOff: settings.days_off });

// Waiting or confirmed, not started, and no longer inside the hours (a day off or a shorter window added after it).
function isOutside(row, rules, now) {
  return coaching.HOLDING.includes(row.status) && row.starts_at > now && coaching.outsideHours(row, rules);
}

// A booking as the schedule shows it: the booking page's view plus whether it fell outside the hours.
function viewOf(row, settings, now) {
  return { ...coachingBookings.bookingView(row, now), outside: settings ? isOutside(row, rulesOf(settings), now) : false };
}

// The bookings not over yet, by day in the streamer's zone (in time order), and those of the last 30 days, newest first.
function scheduleOf(streamerId, settings, now) {
  const days = [];
  const past = [];
  if (!settings) return { days, past };
  for (const row of db.getCoachingSchedule(streamerId, now - PAST_DAYS * DAY_MS, now + AHEAD_DAYS * DAY_MS)) {
    const view = viewOf(row, settings, now);
    if (row.starts_at + row.minutes * MINUTE_MS <= now) {
      past.unshift(view);
      continue;
    }
    const date = coaching.localDateOf(row.starts_at, settings.time_zone);
    let day = days[days.length - 1];
    if (!day || day.date !== date) days.push(day = { date, bookings: [] });
    day.bookings.push(view);
  }
  return { days, past };
}

function botsName(guildId) {
  try { return discord.guildName(guildId); } catch (e) { return null; }
}

// The servers the page offers: the streamer's claimed servers the bot is in, and the saved one even while the bot
// cannot see it (Discord down or not ready), so a save then keeps it; by the bot's name, else the one stored with the
// claim.
function serverOptions(claims, settings) {
  const saved = settings ? settings.guild_id : null;
  const servers = [];
  for (const claim of claims) {
    const name = botsName(claim.guild_id);
    if (name === null && claim.guild_id !== saved) continue;
    servers.push({ id: claim.guild_id, name: name || claim.guild_name || claim.guild_id });
  }
  return servers;
}

function bookingUrl(req, streamer) {
  if (!streamer.twitch_username) return null;
  const base = (config.app && config.app.url) || `${req.protocol}://${req.get('host')}`;
  return `${base}/coaching/${encodeURIComponent(streamer.twitch_username)}`;
}

// Asks Discord about the saved invite once the page is sent, at most once an hour (checkInvite keeps the hour); what
// it learns shows on the next visit.
function checkInviteLater(streamerId) {
  Promise.resolve()
    .then(() => coachingBookings.checkInvite(streamerId))
    .catch((e) => console.error(`[Coaching] invite check for streamer ${streamerId} failed:`, e && e.message));
}

router.get('/coaching', (req, res) => {
  const streamer = req.streamer;
  const now = Date.now();
  const settings = db.getCoachingSettings(streamer.id);
  const servers = serverOptions(db.getGuildsForStreamer(streamer.id), settings);
  const view = settingsView(settings, now, servers);
  const link = bookingUrl(req, streamer);
  if (settings) res.once('finish', () => checkInviteLater(streamer.id));
  res.render('coaching-dashboard', {
    streamer,
    setUp: !!settings,
    settings: view,
    servers,
    bookingUrl: link,
    coachingData: {
      lang: res.locals.lang || 'en',
      setUp: !!settings,
      settings: view,
      servers,
      bookingUrl: link,
      schedule: scheduleOf(streamer.id, settings, now),
      daysOffMax: coaching.DAYS_OFF_MAX,
    },
    coachingTexts: pageTexts(res.locals.t),
  });
});

// JSON { timeZone, hours, daysOff, guildId, invite, where, notifyRequests }. Everything that needs no Discord is
// checked first; then the invite is asked about: unknown is refused, another server's is refused, and no answer saves
// it unchecked (the hourly check follows). The first save opens bookings. Bookings outside the new hours are kept and
// listed in outsideHours.
router.post('/api/coaching/settings', async (req, res) => {
  const streamer = req.streamer;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const now = Date.now();

  const timeZone = canonicalTimeZone(body.timeZone);
  if (!timeZone) return refuse(res, 'bad_zone');
  const hours = coaching.parseHours(body.hours);
  if (!hours.ok) return refuse(res, hours.code);
  const daysOff = coaching.parseDaysOff(body.daysOff, coaching.localDateOf(now, timeZone));
  if (!daysOff.ok) return refuse(res, daysOff.code);
  const claims = db.getGuildsForStreamer(streamer.id);
  const guildId = typeof body.guildId === 'string' && claims.some((g) => g.guild_id === body.guildId) ? body.guildId : null;
  if (!guildId) return refuse(res, 'bad_server');
  const inviteCode = coaching.parseInvite(body.invite);
  if (!inviteCode) return refuse(res, 'bad_invite');
  const where = coaching.parseWhere(body.where == null ? '' : body.where);
  if (!where.ok) return refuse(res, where.code);
  const notify = parseSwitch(body.notifyRequests);
  if (notify === null) return refuse(res, 'bad_switch');

  let invite;
  try { invite = await discord.fetchInvite(inviteCode); } catch (e) { invite = { ok: false, reason: 'unavailable' }; }
  if (invite && invite.ok && invite.guildId !== guildId) return refuse(res, 'invite_other_server');
  if (invite && !invite.ok && invite.reason === 'unknown') return refuse(res, 'bad_invite');

  const saved = db.saveCoachingSettings(streamer.id, {
    timeZone, hours: hours.hours, daysOff: daysOff.daysOff, guildId, inviteCode, whereText: where.where,
    notifyRequests: notify, lang: res.locals.lang || 'en',
  });
  if (invite && invite.ok) db.recordInviteCheck(streamer.id, inviteCode, 1, now);
  const settings = db.getCoachingSettings(streamer.id) || saved;
  const rules = rulesOf(settings);
  const outsideHours = db.getHeldCoachingBookings(streamer.id, now)
    .filter((b) => b.startsAt > now && coaching.outsideHours({ starts_at: b.startsAt, minutes: b.minutes }, rules))
    .map((b) => b.id);
  const servers = serverOptions(claims, settings);
  res.json({ ok: true, settings: settingsView(settings, now, servers), outsideHours });
});

// JSON { open }: Bookings open, paused without losing the hours. A value that is not a switch value is refused.
router.post('/api/coaching/open', (req, res) => {
  const open = parseSwitch(req.body && typeof req.body === 'object' ? req.body.open : undefined);
  if (open === null) return refuse(res, 'bad_switch');
  if (!db.setCoachingOpen(req.streamer.id, open)) return refuse(res, 'not_set_up');
  res.json({ ok: true, open: !!open });
});

// Accept or Decline a waiting request, Cancel a waiting or confirmed booking; one of this streamer's, not started. The
// viewer's Discord message is awaited: a message that did not go out is in the answer's messageError.
const BOOKING_ID = /^\d{1,15}$/;
for (const action of ['accept', 'decline', 'cancel']) {
  router.post(`/api/coaching/bookings/:id/${action}`, async (req, res) => {
    const id = BOOKING_ID.test(req.params.id) ? Number(req.params.id) : 0;
    if (!id) return refuse(res, 'not_found');
    const now = Date.now();
    const result = await coachingBookings[action](req.streamer, id, { now });
    if (!result.ok) return refuse(res, result.code);
    res.json({ ok: true, booking: viewOf(result.booking, db.getCoachingSettings(req.streamer.id), now) });
  });
}

module.exports = router;
