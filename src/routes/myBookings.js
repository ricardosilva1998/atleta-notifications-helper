'use strict';

// My bookings, /my-bookings: a viewer's coaching bookings with every coach. The viewer is req.viewer (server.js's
// session step: their own Discord sign-in, else a streamer signed in to the site). Bookings are the viewer's own views
// (coachingBookings.bookingViews with forViewer: no payer details) plus the coach's name, picture and whether their
// page can be booked now.

const { Router } = require('express');
const db = require('../db');
const coaching = require('../services/coaching');
const coachingBookings = require('../services/coachingBookings');
const { RETURN_ERROR_KEYS } = require('./coaching');

const router = Router();

// The texts public/js/my-bookings.js reads, as window.MYBOOKINGS_TEXTS (name -> key; their {{fields}} are kept for the
// script, which fills them in one pass), and the states' and the PayPal return errors' texts under `states` and
// `returnErrors`. The coaching booking page's texts are reused where the line is the same.
const PAGE_TEXT_KEYS = {
  lengthMin: 'coaching.page.lengthMin', lengthHour: 'coaching.page.lengthHour', free: 'coaching.page.free',
  payBy: 'coaching.page.payBy', pay: 'coaching.page.pay', paying: 'coaching.page.paying', room: 'coaching.page.room',
  paidOk: 'coaching.page.paidOk', checkAgain: 'coaching.page.checkAgain', paidAmount: 'coaching.page.paidAmount',
  cancel: 'coaching.page.cancel', cancelConfirm: 'coaching.page.cancelConfirm', withdrawn: 'coaching.page.withdrawn',
  signIn: 'coaching.page.signIn', failed: 'coaching.page.failed', offline: 'coaching.page.offline',
  payNote: 'coaching.page.payNote', cancelReason: 'coaching.page.cancelReason', refundPending: 'coaching.page.refundPending',
  refunded: 'coaching.page.refunded', refundPendingDuplicate: 'coaching.page.refundPendingDuplicate', refundedDuplicate: 'coaching.page.refundedDuplicate', reschedProposed: 'coaching.page.reschedProposed', reschedAsk: 'coaching.page.reschedAsk',
  reschedMine: 'coaching.page.reschedMine', reschedUntil: 'coaching.page.reschedUntil', reschedOriginal: 'coaching.page.reschedOriginal',
  reschedAccept: 'coaching.page.reschedAccept', reschedOther: 'coaching.page.reschedOther', reschedPick: 'coaching.page.reschedPick',
  reschedSend: 'coaching.page.reschedSend', reschedNote: 'coaching.page.reschedNote', reschedLoading: 'coaching.page.reschedLoading',
  reschedNoTimes: 'coaching.page.reschedNoTimes', reschedSent: 'coaching.page.reschedSent', reschedAgreed: 'coaching.page.reschedAgreed',
  reschedClose: 'coaching.page.reschedClose', reschedPicked: 'coaching.page.reschedPicked',
  toCome: 'myBookings.toCome', past: 'myBookings.past', none: 'myBookings.none',
  requestSent: 'myBookings.requestSent', unavailable: 'myBookings.unavailable',
};
const STATE_KEYS = {
  waiting: 'coaching.state.waiting', confirmed: 'coaching.state.confirmed', declined: 'coaching.state.declined',
  cancelled: 'coaching.state.cancelled', awaiting_payment: 'coaching.state.awaiting_payment', payment_processing: 'coaching.state.payment_processing', payment_unsettled: 'coaching.state.payment_unsettled', expired: 'coaching.state.expired',
  withdrawn: 'coaching.state.withdrawn', unanswered: 'coaching.state.unanswered',
  rescheduling: 'coaching.state.rescheduling', not_rescheduled: 'coaching.state.not_rescheduled',
};
const KEEP_FIELDS = new Proxy({}, { get: (_, name) => `{{${String(name)}}}` });
function pageTexts(t) {
  const texts = {};
  for (const [name, key] of Object.entries(PAGE_TEXT_KEYS)) texts[name] = t(key, KEEP_FIELDS);
  texts.states = {};
  for (const [state, key] of Object.entries(STATE_KEYS)) texts.states[state] = t(key);
  texts.returnErrors = {};
  for (const [code, key] of Object.entries(RETURN_ERROR_KEYS)) texts.returnErrors[code] = t(key);
  return texts;
}

const DAY_MS = 86400e3;
const RETENTION_DAYS = 90; // bookings are deleted 90 days after their start

function viewerOf(viewer) {
  return viewer
    ? { displayName: viewer.displayName, username: viewer.username, avatar: viewer.avatar || null, fromStreamer: !!viewer.fromStreamer }
    : null;
}

function bookingsOf(viewer, now) {
  const rows = db.getViewerBookingsAllCoaches(viewer.discordUserId, now - RETENTION_DAYS * DAY_MS);
  const views = coachingBookings.bookingViews(rows, now, { forViewer: true });
  return views.map((view, i) => ({
    ...view,
    coach: {
      login: rows[i].coach_login,
      name: rows[i].coach_name || rows[i].coach_login,
      avatar: rows[i].coach_avatar || null,
      available: !!rows[i].coach_available,
    },
  }));
}

// leadMs and horizonDays are the rules the reschedule picker filters the viewer's offered starts with.
function stateOf(viewer) {
  return {
    viewer: viewerOf(viewer),
    bookings: viewer ? bookingsOf(viewer, Date.now()) : [],
    leadMs: coaching.LEAD_MS,
    horizonDays: coaching.HORIZON_DAYS,
  };
}

router.get('/', (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const viewer = req.viewer || null;
  const data = { lang: res.locals.lang, signInUrl: '/auth/coaching-signin', ...stateOf(viewer) };
  res.render('my-bookings', { viewer: data.viewer, lang: res.locals.lang, data, texts: pageTexts(res.locals.t) });
});

router.get('/state', (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  if (!req.viewer) return res.status(401).json({ ok: false, error: res.locals.t('coaching.error.signin') });
  res.json(stateOf(req.viewer));
});

module.exports = router;
