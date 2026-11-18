'use strict';

// The streamer's coaching page, /dashboard/coaching, and its JSON routes (docs/superpowers/specs/2026-10-29-coaching-
// design.md, "The streamer's side" and "A dead invite"), mounted inside the dashboard router, so behind its login, the
// disabled-account check and CSRF. The page (views/coaching-dashboard.ejs) is drawn by public/js/coaching-dashboard.js
// from window.COACHING_DASHBOARD_DATA, in four tabs: Bookings (the bookings to come, grouped by day in the streamer's
// zone, and the last 30 days below), Schedule (the weekly hours, the zone, the days off), Price (the lengths) and
// Settings (where we meet, the booking link). Every refusal is { ok: false, code, error }, the error being the code's text in the page's language. Times
// travel as UTC milliseconds.

const { Router } = require('express');
const db = require('../db');
const discord = require('../discord');
const config = require('../config');
const coaching = require('../services/coaching');
const coachingBookings = require('../services/coachingBookings');
const coachingRooms = require('../services/coachingRooms');
const { canonicalTimeZone } = require('../services/goalPeriods');
const { parseSwitch } = require('../services/inputLimits');
const { paypalEmailFrom } = require('../services/donationSettings');

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
  bad_paypal: [400, 'coaching.dashboard.error.bad_paypal'],
  bad_lengths: [400, 'coaching.dashboard.error.bad_lengths'],
  no_length: [400, 'coaching.dashboard.error.no_length'],
  bad_switch: [400, 'coaching.dashboard.error.bad_switch'],
  not_set_up: [409, 'coaching.dashboard.error.not_set_up'],
  not_found: [404, 'coaching.error.not_found'],
  too_late: [409, 'coaching.dashboard.error.too_late'],
  not_waiting: [409, 'coaching.dashboard.error.not_waiting'],
  not_active: [409, 'coaching.dashboard.error.not_active'],
  no_paypal: [409, 'coaching.dashboard.error.no_paypal'],
  too_close: [409, 'coaching.dashboard.error.too_close'],
  paid: [409, 'coaching.dashboard.error.paid'],
  bad_reason: [400, 'coaching.dashboard.error.bad_reason'],
  not_pending: [409, 'coaching.dashboard.error.not_pending'],
  not_confirmed: [409, 'coaching.dashboard.error.not_active'],
  bad_time: [409, 'coaching.error.taken'],
  taken: [409, 'coaching.error.taken'],
  bad_note: [400, 'coaching.error.bad_note'],
  bad_way: [400, 'coaching.page.failed'],
  not_rescheduling: [409, 'coaching.error.not_rescheduling'],
  not_yours_to_answer: [409, 'coaching.error.not_yours_to_answer'],
  no_proposal: [409, 'coaching.error.no_proposal'],
  proposal_too_close: [409, 'coaching.error.proposal_too_close'],
  bad_category: [400, 'coaching.dashboard.error.bad_category'],
  category_not_found: [400, 'coaching.dashboard.error.category_not_found'],
  category_permissions: [400, 'coaching.dashboard.error.category_permissions'],
  no_category: [409, 'coaching.dashboard.error.no_category'],
  room_not_failed: [409, 'coaching.dashboard.error.room_not_failed'],
  room_busy: [409, 'coaching.dashboard.error.room_busy'],
  server_gone: [409, 'coaching.dashboard.error.server_gone'],
  discord_down: [503, 'coaching.dashboard.error.discord_down'],
  failed: [500, 'coaching.page.failed'],
};
function refuse(res, code, extra = {}, params = {}) {
  const [status, key] = REFUSALS[code] || [400, 'coaching.page.failed'];
  res.status(status).json({ ok: false, code, error: res.locals.t(key, params), ...extra });
}

// The texts public/js/coaching-dashboard.js reads, as window.COACHING_DASHBOARD_TEXTS (name -> key; their {{fields}}
// are kept for the script, which fills them), and the states' names under `states` (the booking page's).
const TEXT_KEYS = {
  zone: 'coaching.dashboard.zone', empty: 'coaching.dashboard.empty', emptyNotSetUp: 'coaching.dashboard.emptyNotSetUp',
  lengthMin: 'coaching.page.lengthMin', lengthHour: 'coaching.page.lengthHour', free: 'coaching.page.free',
  payBy: 'coaching.page.payBy', priceFor: 'coaching.dashboard.priceFor', paid: 'coaching.dashboard.paid', openRoom: 'coaching.dashboard.openRoom',
  retryRoom: 'coaching.dashboard.retryRoom', retrying: 'coaching.dashboard.retrying', roomRetried: 'coaching.dashboard.roomRetried',
  paymentLate: 'coaching.dashboard.paymentLate', categoryNone: 'coaching.dashboard.categoryNone',
  categoryAfterSave: 'coaching.dashboard.categoryAfterSave', categoryUnavailable: 'coaching.dashboard.categoryUnavailable',
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
  cancelTitle: 'coaching.dashboard.cancelTitle', reasonRequired: 'coaching.dashboard.error.bad_reason', reasonGiven: 'coaching.dashboard.reasonGiven',
  reschedule: 'coaching.dashboard.reschedule', rescheduleTitle: 'coaching.dashboard.rescheduleTitle', proposeAnotherTitle: 'coaching.dashboard.proposeAnotherTitle',
  rescheduleWayAsk: 'coaching.dashboard.rescheduleWayAsk', rescheduleLoading: 'coaching.dashboard.rescheduleLoading', rescheduleNoTimes: 'coaching.dashboard.rescheduleNoTimes',
  reschedCoachProposed: 'coaching.dashboard.reschedCoachProposed', reschedViewerProposed: 'coaching.dashboard.reschedViewerProposed',
  reschedWaitingViewer: 'coaching.dashboard.reschedWaitingViewer', reschedEnds: 'coaching.dashboard.reschedEnds',
  acceptProposal: 'coaching.dashboard.acceptProposal', proposeAnother: 'coaching.dashboard.proposeAnother',
  proposalAccepted: 'coaching.dashboard.proposalAccepted', proposalSent: 'coaching.dashboard.proposalSent', askSent: 'coaching.dashboard.askSent',
  refundPending: 'coaching.dashboard.refundPending', refunded: 'coaching.dashboard.refunded', refundedButton: 'coaching.dashboard.refundedButton',
  refundTitle: 'coaching.dashboard.refundTitle', refundTitleDuplicate: 'coaching.dashboard.refundTitleDuplicate', refundPayer: 'coaching.dashboard.refundPayer', refundNoPayer: 'coaching.dashboard.refundNoPayer',
  refundCapture: 'coaching.dashboard.refundCapture', refundConfirm: 'coaching.dashboard.refundConfirm', refundedDone: 'coaching.dashboard.refundedDone',
  connDiscordOk: 'coaching.dashboard.connDiscordOk', connDiscordWarn: 'coaching.dashboard.connDiscordWarn',
  connPaypalOn: 'coaching.dashboard.connPaypalOn', connPaypalOff: 'coaching.dashboard.connPaypalOff',
  connTwitchOk: 'coaching.dashboard.connTwitchOk', connTwitchNone: 'coaching.dashboard.connTwitchNone',
};
const STATE_KEYS = {
  waiting: 'coaching.state.waiting', awaiting_payment: 'coaching.state.awaiting_payment', payment_processing: 'coaching.state.payment_processing', expired: 'coaching.state.expired', confirmed: 'coaching.state.confirmed', declined: 'coaching.state.declined',
  cancelled: 'coaching.state.cancelled', withdrawn: 'coaching.state.withdrawn', unanswered: 'coaching.state.unanswered',
  rescheduling: 'coaching.state.rescheduling', not_rescheduled: 'coaching.state.not_rescheduled',
};
const ROOM_ERRORS = ['missing_permissions', 'viewer_not_member', 'discord_down', 'server_gone', 'failed'];
const TRANSCRIPT_STATUSES = ['sent', 'partial', 'failed', 'no_intent', 'no_channel'];
const KEEP_FIELDS = new Proxy({}, { get: (_, name) => `{{${String(name)}}}` });
function pageTexts(t) {
  const texts = {};
  for (const [name, key] of Object.entries(TEXT_KEYS)) texts[name] = t(key, KEEP_FIELDS);
  texts.states = {};
  for (const [state, key] of Object.entries(STATE_KEYS)) texts.states[state] = t(key);
  texts.roomError = {};
  for (const code of ROOM_ERRORS) texts.roomError[code] = t(`coaching.dashboard.roomError.${code}`);
  texts.transcript = {};
  for (const code of TRANSCRIPT_STATUSES) texts.transcript[code] = t(`coaching.dashboard.transcript.${code}`);
  return texts;
}

const inviteLink = (code) => (code ? `https://discord.gg/${code}` : '');

// What the page and a save's answer say about the settings; before the first save, what the form starts with.
function settingsView(settings, now, servers) {
  if (!settings) {
    return {
      open: false, timeZone: null, hours: coaching.DEFAULT_HOURS, daysOff: [],
      guildId: servers.length ? servers[0].id : null, categoryId: null, invite: '', inviteOk: null, where: '', notifyRequests: true,
      lengths: coaching.lengthsFor(null),
    };
  }
  const today = coaching.localDateOf(now, settings.time_zone);
  return {
    open: !!settings.open,
    timeZone: settings.time_zone,
    hours: settings.hours,
    daysOff: settings.days_off.filter((d) => d >= today),
    guildId: settings.guild_id,
    categoryId: settings.category_id || null,
    invite: inviteLink(settings.invite_code),
    inviteOk: settings.invite_ok == null ? null : !!settings.invite_ok,
    where: settings.where_text || '',
    notifyRequests: !!settings.notify_requests,
    lengths: coaching.lengthsFor(settings),
  };
}

// The money side of the page: the prices' currency (the tip page's), whether a PayPal email is set (a paid length needs
// it), and whether the prices still carry the defaults in a currency other than EUR (planning decision 4).
function moneyView(streamer, settings) {
  const currency = coachingBookings.currencyOf(streamer);
  return {
    currency,
    hasPaypal: !!streamer.paypal_email,
    checkPrices: currency !== 'EUR' && !(settings && settings.prices_saved_at),
  };
}

// What the Connections tab's Discord line says, from what the page already knows: whether the bot can see the
// coaching server now (a Discord outage or not-ready reads as it cannot), whether the saved category is one the bot
// named (a category kept by its id while Discord cannot see the server reads as not OK), and the invite's last check.
// null is "nothing to say": no coaching settings, no category chosen, invite not checked yet. The raw settings row's
// names (guild_id, category_id, invite_ok), as settingsView normalizes them for the form.
function discordStatus(settings, servers, categories) {
  if (!settings || !settings.guild_id) return { botSeen: null, categoryOk: null, inviteOk: null };
  return {
    botSeen: servers.some((s) => s.id === settings.guild_id) && botsName(settings.guild_id) !== null,
    categoryOk: settings.category_id ? categories.some((c) => c.id === settings.category_id && c.name !== c.id) : null,
    inviteOk: settings.invite_ok == null ? null : !!settings.invite_ok,
  };
}

// The Connections tab's three blocks: the PayPal email (the tip page's, with the currency coaching is paid in), the
// linked Twitch account the booking page is named after, and the Discord status above.
function connectionsView(streamer, money, settings, servers, categories, link) {
  return {
    paypal: { email: streamer.paypal_email || '', hasPaypal: money.hasPaypal, currency: money.currency },
    twitch: {
      username: streamer.twitch_username || null,
      displayName: streamer.twitch_display_name || streamer.twitch_username || null,
      avatar: streamer.twitch_profile_image || null,
      bookingUrl: link,
    },
    discord: discordStatus(settings, servers, categories),
  };
}

const rulesOf = (settings) => ({ hours: settings.hours, timeZone: settings.time_zone, daysOff: settings.days_off });

// Waiting or confirmed, not started, and no longer inside the hours (a day off or a shorter window added after it).
// A rescheduling booking holds its proposal's time (nothing without one), so that is the time tested.
function isOutside(row, rules, now) {
  if (!coaching.HOLDING.includes(row.status)) return false;
  const at = row.status === 'rescheduling' ? row.proposal_starts_at : row.starts_at;
  return at != null && at > now && coaching.outsideHours({ starts_at: at, minutes: row.minutes }, rules);
}

// Where the schedule places a row: a rescheduling one by its proposal when there is one, else its original time.
const placedAt = (row) => (row.status === 'rescheduling' && row.proposal_starts_at != null ? row.proposal_starts_at : row.starts_at);

// A booking as the schedule shows it: the booking page's view plus whether it fell outside the hours.
function viewOf(row, settings, now, room, payments) {
  const rm = room === undefined ? db.getCoachingRoom(row.id) : room;
  return { ...coachingBookings.bookingView(row, now, rm, payments ? { payments } : {}), outside: settings ? isOutside(row, rulesOf(settings), now) : false };
}

// The bookings not over yet, by day in the streamer's zone (in time order), and those of the last 30 days, newest first.
function scheduleOf(streamerId, settings, now) {
  const days = [];
  const past = [];
  if (!settings) return { days, past };
  const rows = db.getCoachingSchedule(streamerId, now - PAST_DAYS * DAY_MS, now + AHEAD_DAYS * DAY_MS);
  const roomOf = new Map(db.listCoachingRoomsForBookings(rows.map((r) => r.id)).map((r) => [r.booking_id, r]));
  const paymentsOf = new Map();
  for (const p of db.listCoachingPaymentsForBookings(rows.map((r) => r.id))) {
    if (!paymentsOf.has(p.booking_id)) paymentsOf.set(p.booking_id, []);
    paymentsOf.get(p.booking_id).push(p);
  }
  // A rescheduling booking stays among the days to come until it is agreed, dropped or closed, whatever its original time.
  const placed = rows.slice().sort((a, b) => placedAt(a) - placedAt(b));
  for (const row of placed) {
    const view = viewOf(row, settings, now, roomOf.get(row.id) || null, paymentsOf.get(row.id) || []);
    if (row.status !== 'rescheduling' && row.starts_at + row.minutes * MINUTE_MS <= now) {
      past.unshift(view);
      continue;
    }
    const date = coaching.localDateOf(placedAt(row), settings.time_zone);
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

// The coaching server's categories for the picker; the saved one is kept in the list while Discord cannot name it.
async function categoryOptions(settings) {
  if (!settings || !settings.guild_id) return [];
  let list = null;
  try { list = await discord.listCategories(settings.guild_id); } catch (e) { list = null; }
  list = list || [];
  if (settings.category_id && !list.some((c) => c.id === settings.category_id)) list.push({ id: settings.category_id, name: settings.category_id });
  return list;
}

router.get('/coaching', async (req, res) => {
  const streamer = req.streamer;
  const now = Date.now();
  const settings = db.getCoachingSettings(streamer.id);
  const servers = serverOptions(db.getGuildsForStreamer(streamer.id), settings);
  const view = settingsView(settings, now, servers);
  const link = bookingUrl(req, streamer);
  const categories = await categoryOptions(settings);
  const money = moneyView(streamer, settings);
  const connections = connectionsView(streamer, money, settings, servers, categories, link);
  // Discord is asked about the saved invite once the page is sent, at most once an hour (checkInvite keeps the hour);
  // what it learns shows on the next visit. The dashboard (the Coaching card) does the same.
  if (settings) res.once('finish', () => coachingBookings.checkInviteLater(streamer.id));
  res.render('coaching-dashboard', {
    streamer,
    setUp: !!settings,
    settings: view,
    money,
    connections,
    servers,
    bookingUrl: link,
    coachingData: {
      lang: res.locals.lang || 'en',
      setUp: !!settings,
      settings: view,
      money,
      connections,
      servers,
      categories,
      bookingUrl: link,
      schedule: scheduleOf(streamer.id, settings, now),
      daysOffMax: coaching.DAYS_OFF_MAX,
      limits: { cancelReasonMax: coaching.CANCEL_REASON_MAX, noteMax: coaching.PROPOSAL_NOTE_MAX, proposalLapseMs: coaching.PROPOSAL_LAPSE_MS },
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
  // Absent keeps the saved lengths and prices; present is checked whole (every length, at least one on).
  let lengths;
  if (body.lengths !== undefined) {
    const parsed = coaching.parseLengths(body.lengths);
    if (!parsed.ok) return refuse(res, parsed.code);
    lengths = parsed.lengths;
  }

  // The Coaching category: absent keeps the saved one (cleared when the server changes), '' or null clears it, an id is
  // checked against the server (it must be one of its categories and hold the bot's permissions).
  const before = db.getCoachingSettings(streamer.id);
  let categoryId;
  if (body.categoryId === undefined) {
    if (before && before.guild_id !== guildId) categoryId = null;
  } else if (body.categoryId === null || body.categoryId === '') {
    categoryId = null;
  } else if (typeof body.categoryId === 'string' && /^\d{17,20}$/.test(body.categoryId)) {
    categoryId = body.categoryId;
    const unchanged = before && before.guild_id === guildId && before.category_id === categoryId;
    const check = await discord.checkCategory(guildId, categoryId);
    if (!check.ok && check.reason === 'not_found') return refuse(res, 'category_not_found');
    if (!check.ok && check.reason === 'permissions' && !unchanged) {
      const missing = check.missing.map((id) => res.locals.t(`coaching.dashboard.permission.${id}`)).join(', ');
      return refuse(res, 'category_permissions', { missing: check.missing }, { missing });
    }
  } else {
    return refuse(res, 'bad_category');
  }

  let invite;
  try { invite = await discord.fetchInvite(inviteCode); } catch (e) { invite = { ok: false, reason: 'unavailable' }; }
  if (invite && invite.ok && invite.guildId !== guildId) return refuse(res, 'invite_other_server');
  if (invite && !invite.ok && invite.reason === 'unknown') return refuse(res, 'bad_invite');

  const saved = db.saveCoachingSettings(streamer.id, {
    timeZone, hours: hours.hours, daysOff: daysOff.daysOff, guildId, inviteCode, whereText: where.where,
    notifyRequests: notify, lang: res.locals.lang || 'en', categoryId, lengths,
  });
  if (invite && invite.ok) db.recordInviteCheck(streamer.id, inviteCode, 1, now);
  const settings = db.getCoachingSettings(streamer.id) || saved;
  const rules = rulesOf(settings);
  const outsideHours = db.getHeldCoachingBookings(streamer.id, now)
    .filter((b) => b.startsAt > now && coaching.outsideHours({ starts_at: b.startsAt, minutes: b.minutes }, rules))
    .map((b) => b.id);
  const servers = serverOptions(claims, settings);
  const categories = await categoryOptions(settings);
  res.json({
    ok: true,
    settings: settingsView(settings, now, servers),
    money: moneyView(streamer, settings),
    outsideHours,
    categories,
    connections: { paypal: { email: streamer.paypal_email || '' }, discord: discordStatus(settings, servers, categories) },
  });
});

// JSON { open }: Bookings open, paused without losing the hours. A value that is not a switch value is refused.
router.post('/api/coaching/open', (req, res) => {
  const open = parseSwitch(req.body && typeof req.body === 'object' ? req.body.open : undefined);
  if (open === null) return refuse(res, 'bad_switch');
  if (!db.setCoachingOpen(req.streamer.id, open)) return refuse(res, 'not_set_up');
  res.json({ ok: true, open: !!open });
});

// The Connections tab's PayPal block: the streamer's PayPal email — the same field the tip page is paid to, with the
// same check as the Donations page (services/donationSettings.js); only that column is written. The answer carries
// the page's money view and the tab's status lines again, so the page can redraw them.
router.post('/api/coaching/paypal', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const email = paypalEmailFrom(body.paypalEmail);
  if (email.error) return refuse(res, 'bad_paypal');
  db.updateDonationSettings(req.streamer.id, { paypal_email: email.email });
  const streamer = db.getStreamerById(req.streamer.id);
  const settings = db.getCoachingSettings(req.streamer.id);
  const servers = serverOptions(db.getGuildsForStreamer(req.streamer.id), settings);
  res.json({
    ok: true,
    email: streamer.paypal_email || '',
    money: moneyView(streamer, settings),
    connections: { paypal: { email: streamer.paypal_email || '' }, discord: discordStatus(settings, servers, await categoryOptions(settings)) },
  });
});

// Accept or Decline a waiting request, Cancel a booking (waiting, awaiting payment, confirmed or rescheduling, paid
// ones too) with a required reason; one of this streamer's. The viewer's Discord message is awaited: a message that did
// not go out is in the answer's messageError.
const BOOKING_ID = /^\d{1,15}$/;
for (const action of ['accept', 'decline', 'cancel']) {
  router.post(`/api/coaching/bookings/:id/${action}`, async (req, res) => {
    const id = BOOKING_ID.test(req.params.id) ? Number(req.params.id) : 0;
    if (!id) return refuse(res, 'not_found');
    const now = Date.now();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await coachingBookings[action](req.streamer, id, action === 'cancel' ? { now, reason: body.reason } : { now });
    if (!result.ok) return refuse(res, result.code);
    res.json({ ok: true, booking: viewOf(result.booking, db.getCoachingSettings(req.streamer.id), now) });
  });
}

// Reschedule (the coach starts it on a confirmed session before its start): JSON { way: 'propose' | 'ask', startsAt?, note? };
// propose answers the viewer's proposal with a different time; accept-proposal takes the viewer's; proposal-starts lists
// the half hours the coach may offer (milliseconds). One of this streamer's bookings only.
const startOf = (body) => (body && Number.isInteger(body.startsAt) ? body.startsAt : null);
const bodyOf = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
const bookingIdOf = (req) => (BOOKING_ID.test(req.params.id) ? Number(req.params.id) : 0);
const answer = (req, res, result, now) => {
  if (!result.ok) return refuse(res, result.code);
  return res.json({ ok: true, booking: viewOf(result.booking, db.getCoachingSettings(req.streamer.id), now) });
};

router.post('/api/coaching/bookings/:id/reschedule', async (req, res) => {
  const id = bookingIdOf(req);
  if (!id) return refuse(res, 'not_found');
  const now = Date.now();
  const body = bodyOf(req);
  answer(req, res, await coachingBookings.startReschedule(req.streamer, id, { way: body.way, startsAt: startOf(body), note: body.note, now }), now);
});

router.post('/api/coaching/bookings/:id/propose', async (req, res) => {
  const id = bookingIdOf(req);
  if (!id) return refuse(res, 'not_found');
  const now = Date.now();
  const body = bodyOf(req);
  answer(req, res, await coachingBookings.coachPropose(req.streamer, id, { startsAt: startOf(body), note: body.note, now }), now);
});

router.post('/api/coaching/bookings/:id/accept-proposal', async (req, res) => {
  const id = bookingIdOf(req);
  if (!id) return refuse(res, 'not_found');
  const now = Date.now();
  answer(req, res, await coachingBookings.coachAccept(req.streamer, id, { now }), now);
});

router.get('/api/coaching/bookings/:id/proposal-starts', (req, res) => {
  const id = bookingIdOf(req);
  if (!id) return refuse(res, 'not_found');
  const result = coachingBookings.coachStarts(req.streamer, id, { now: Date.now() });
  if (!result.ok) return refuse(res, result.code);
  res.json({ ok: true, minutes: result.minutes, starts: result.starts });
});

// "Refunded": the coach says they refunded one payment in PayPal. Only this streamer's payment, only from pending.
router.post('/api/coaching/payments/:orderId/refunded', async (req, res) => {
  const result = await coachingBookings.markRefunded(req.streamer, req.params.orderId, { now: Date.now() });
  if (!result.ok) return refuse(res, result.code);
  const now = Date.now();
  res.json({
    ok: true,
    orderId: req.params.orderId,
    booking: result.booking ? viewOf(result.booking, db.getCoachingSettings(req.streamer.id), now) : null,
  });
});

// Retry room: a confirmed session's failed room is made again (the half-made role and channel are deleted first).
router.post('/api/coaching/bookings/:id/room', async (req, res) => {
  const id = BOOKING_ID.test(req.params.id) ? Number(req.params.id) : 0;
  if (!id) return refuse(res, 'not_found');
  const now = Date.now();
  const result = await coachingRooms.retry(req.streamer, id, { now });
  if (!result.ok) return refuse(res, result.code);
  const row = db.getCoachingBooking(id, req.streamer.id);
  res.json({ ok: true, booking: viewOf(row, db.getCoachingSettings(req.streamer.id), now) });
});

module.exports = router;
