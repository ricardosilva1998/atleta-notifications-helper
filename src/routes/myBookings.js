'use strict';

// My bookings, /my-bookings: a viewer's coaching bookings with every coach. The viewer is req.viewer (server.js's
// session step: their own Discord sign-in, else a streamer signed in to the site). Bookings are the viewer's own views
// (coachingBookings.bookingViews with forViewer: no payer details) plus the coach's name, picture and whether their
// page can be booked now.

const { Router } = require('express');
const db = require('../db');
const coachingBookings = require('../services/coachingBookings');

const router = Router();

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

router.get('/', (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const viewer = req.viewer || null;
  const data = { viewer: viewerOf(viewer), bookings: viewer ? bookingsOf(viewer, Date.now()) : [], signInUrl: '/auth/coaching-signin' };
  res.render('my-bookings', { viewer: data.viewer, lang: res.locals.lang, data });
});

router.get('/state', (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  if (!req.viewer) return res.status(401).json({ ok: false, error: res.locals.t('coaching.error.signin') });
  res.json({ viewer: viewerOf(req.viewer), bookings: bookingsOf(req.viewer, Date.now()) });
});

module.exports = router;
