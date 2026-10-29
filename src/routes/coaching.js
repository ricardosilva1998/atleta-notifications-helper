'use strict';

// The public coaching booking page, /coaching/<twitch login> (docs/superpowers/specs/2026-10-29-coaching-design.md,
// "The viewer's side"). Anyone can look at it; booking needs a viewer, req.viewer, which server.js's session step
// sets from the viewer's own Discord sign-in (/auth/coaching-signin, viewer_sessions) or from a streamer signed in to
// the site. The page (views/coaching.ejs) is drawn by public/js/coaching-page.js from GET /state, and posts to /book
// and /bookings/:id/cancel with the CSRF token of the visitor's session. Every refusal is { ok: false, code, error },
// the error being the code's text in the page's language. Times travel as UTC milliseconds; the page shows them in
// the viewer's own time zone.

const { Router } = require('express');
const db = require('../db');
const discord = require('../discord');
const coaching = require('../services/coaching');
const coachingBookings = require('../services/coachingBookings');
const { isStreamerDisabled } = require('../services/streamerAccess');

const router = Router();

const DAY_MS = 86400e3;
const PAST_DAYS = 30; // the viewer's bookings of the last 30 days are listed under the upcoming ones

const REFUSAL_STATUS = {
  signin: 401, unavailable: 404, not_found: 404, bad_length: 400, bad_note: 400,
  not_open: 409, join_first: 409, bad_time: 409, taken: 409, limit: 409, too_late: 409,
};
// bad_time and taken read the same: a time someone holds is refused as bad_time (it is no longer a free start) before
// the insert's own check (taken) ever sees it, and for the viewer both mean "someone was quicker".
const ERROR_KEYS = {
  signin: 'coaching.error.signin', unavailable: 'coaching.error.pageUnavailable', not_found: 'coaching.error.not_found',
  bad_length: 'coaching.error.bad_length', bad_note: 'coaching.error.bad_note', not_open: 'coaching.error.not_open',
  join_first: 'coaching.error.join_first', bad_time: 'coaching.error.taken', taken: 'coaching.error.taken',
  limit: 'coaching.error.limit', too_late: 'coaching.error.too_late',
};

function refuse(res, code) {
  res.status(REFUSAL_STATUS[code] || 400).json({
    ok: false, code, error: res.locals.t(ERROR_KEYS[code] || 'coaching.error.failed', { max: coaching.MAX_UPCOMING }),
  });
}

// The texts public/js/coaching-page.js reads, as window.COACHING_TEXTS (name -> key; their {{fields}} are kept for the
// script, which fills them in one pass), and the states' names under `states`.
const PAGE_TEXT_KEYS = {
  zone: 'coaching.page.zone', minutes30: 'coaching.page.minutes30', minutes60: 'coaching.page.minutes60',
  noTimes: 'coaching.page.noTimes', noTimesDay: 'coaching.page.noTimesDay', pickTime: 'coaching.page.pickTime',
  request: 'coaching.page.request', requesting: 'coaching.page.requesting', requested: 'coaching.page.requested',
  unverified: 'coaching.page.unverified', joinFirst: 'coaching.page.joinFirst', serverFallback: 'coaching.page.serverFallback',
  notJoined: 'coaching.page.notJoined', limit: 'coaching.page.limit', cancel: 'coaching.page.cancel',
  cancelConfirm: 'coaching.page.cancelConfirm', withdrawn: 'coaching.page.withdrawn', signIn: 'coaching.page.signIn',
  failed: 'coaching.page.failed', offline: 'coaching.page.offline',
};
const STATE_KEYS = {
  waiting: 'coaching.state.waiting', confirmed: 'coaching.state.confirmed', declined: 'coaching.state.declined',
  cancelled: 'coaching.state.cancelled', withdrawn: 'coaching.state.withdrawn', unanswered: 'coaching.state.unanswered',
};
const KEEP_FIELDS = new Proxy({}, { get: (_, name) => `{{${String(name)}}}` });
function pageTexts(t) {
  const texts = {};
  for (const [name, key] of Object.entries(PAGE_TEXT_KEYS)) texts[name] = t(key, KEEP_FIELDS);
  texts.states = {};
  for (const [state, key] of Object.entries(STATE_KEYS)) texts.states[state] = t(key);
  return texts;
}

// The streamer of a booking page that is up: not disabled, coaching set up. Anything else answers like /tip/<unknown>.
function coachingPage(req) {
  const streamer = db.getStreamerByUsername(req.params.username);
  if (!streamer || isStreamerDisabled(streamer)) return null;
  const settings = db.getCoachingSettings(streamer.id);
  return settings ? { streamer, settings } : null;
}
const unavailablePage = (res) => res.status(404).send(res.locals.t('coaching.error.pageUnavailable'));

const nameOf = (streamer) => streamer.twitch_display_name || streamer.twitch_username;

// The server's name: the bot's view of it, else the name stored with the claim (Discord down or not ready).
function serverName(settings, claims) {
  let name = null;
  try { name = settings.guild_id ? discord.guildName(settings.guild_id) : null; } catch (e) { name = null; }
  if (name) return name;
  const claim = claims.find((g) => g.guild_id === settings.guild_id);
  return claim && claim.guild_name ? claim.guild_name : null;
}

// What the page draws: the free starts of both lengths (none while nothing can be booked), the viewer and their own
// bookings of the last 30 days and to come, and where to join. Never waits on Discord (see withMembership).
function pageState(streamer, settings, viewer, now) {
  const claims = db.getGuildsForStreamer(streamer.id);
  const bookable = coaching.bookable(settings, claims.map((g) => g.guild_id));
  const held = bookable ? db.getHeldCoachingBookings(streamer.id, now) : [];
  const slots = {};
  for (const minutes of coaching.LENGTHS) {
    slots[minutes] = bookable ? coaching.freeStarts({
      hours: settings.hours, timeZone: settings.time_zone, daysOff: settings.days_off, held, now, minutes,
    }) : [];
  }
  return {
    open: !!settings.open,
    bookable,
    slots,
    viewer: viewer ? { displayName: viewer.displayName, username: viewer.username, avatar: viewer.avatar || null, fromStreamer: !!viewer.fromStreamer } : null,
    inviteUrl: settings.invite_code ? `https://discord.gg/${encodeURIComponent(settings.invite_code)}` : null,
    guildName: serverName(settings, claims),
    bookings: viewer
      ? db.getViewerCoachingBookings(streamer.id, viewer.discordUserId, now - PAST_DAYS * DAY_MS).map((row) => coachingBookings.bookingView(row, now))
      : [],
    maxUpcoming: coaching.MAX_UPCOMING,
    horizonDays: coaching.HORIZON_DAYS,
  };
}

// Whether the viewer is in the coaching server, from the bot's own view (one member lookup, 5 s at most): true, false,
// or null when Discord cannot say (down, not ready), which lets them book. Asked only while something can be booked.
async function withMembership(state, settings, viewer) {
  if (!viewer) return state;
  let member = null;
  if (state.bookable) {
    try { member = await discord.isGuildMember(settings.guild_id, viewer.discordUserId); } catch (e) { member = null; }
  }
  return { ...state, member };
}

router.get('/:username', (req, res) => {
  const page = coachingPage(req);
  if (!page) return unavailablePage(res);
  const { streamer, settings } = page;
  const viewer = req.viewer || null;
  // Sent without asking Discord: the page's script reads /state at once for the membership.
  const state = pageState(streamer, settings, viewer, Date.now());
  res.render('coaching', {
    login: streamer.twitch_username,
    streamerName: nameOf(streamer),
    avatarUrl: streamer.twitch_profile_image || null,
    viewer,
    state,
    coachingData: { login: streamer.twitch_username, name: nameOf(streamer), lang: res.locals.lang, state },
    coachingTexts: pageTexts(res.locals.t),
  });
});

router.get('/:username/state', async (req, res) => {
  const page = coachingPage(req);
  if (!page) return refuse(res, 'unavailable');
  const viewer = req.viewer || null;
  const state = pageState(page.streamer, page.settings, viewer, Date.now());
  res.json(await withMembership(state, page.settings, viewer));
});

// JSON { startsAt, minutes, note }; the booking keeps the page's language for the viewer's Discord messages.
router.post('/:username/book', async (req, res) => {
  const page = coachingPage(req);
  if (!page) return refuse(res, 'unavailable');
  if (!req.viewer) return refuse(res, 'signin');
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const now = Date.now();
  const result = await coachingBookings.request(page.streamer, req.viewer, {
    startsAt: body.startsAt, minutes: body.minutes, note: body.note, lang: res.locals.lang,
  }, { now });
  if (!result.ok) return refuse(res, result.code);
  res.json({ ok: true, booking: coachingBookings.bookingView(result.booking, now), unverified: !!result.unverified });
});

// The viewer's own booking only (another's answers not_found), until it starts; it becomes Withdrawn.
router.post('/:username/bookings/:id/cancel', async (req, res) => {
  const page = coachingPage(req);
  if (!page) return refuse(res, 'unavailable');
  if (!req.viewer) return refuse(res, 'signin');
  const id = /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : 0;
  if (!id) return refuse(res, 'not_found');
  const now = Date.now();
  const result = await coachingBookings.withdraw(page.streamer, req.viewer, id, { now });
  if (!result.ok) return refuse(res, result.code);
  res.json({ ok: true, booking: coachingBookings.bookingView(result.booking, now) });
});

module.exports = router;
