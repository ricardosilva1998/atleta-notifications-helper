const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const db = require('./db');
const { t, SUPPORTED_LANGS, esc, richFor } = require('./i18n');
const { clientIp } = require('./clientIp');
const { applyAccountStatus, isStreamerDisabled } = require('./services/streamerAccess');
const { errorHandler } = require('./errorHandler');
const { mountBodyParsers } = require('./bodyParsers');
const { csrfProtection } = require('./csrf');
const { isRelayRequest } = require('./services/multistreamAuth');
const { healthHandler } = require('./health');
const httpDrain = require('./httpDrain');
const { setUserContentHeaders } = require('./services/userContentHeaders');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const paymentRoutes = require('./routes/payment');
const tipRoutes = require('./routes/tip');
const overlayRoutes = require('./routes/overlay');
const vtuberRoutes = require('./routes/vtuber');
const syncRoutes = require('./routes/sync');
const multistreamRoutes = require('./routes/multistream');
// const customOverlayRoutes = require('./routes/customOverlays'); // DISABLED for now

const app = express();
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
// Trust the first proxy (Railway's edge): req.ip is the address that connected
// to it, and req.secure / req.protocol follow its X-Forwarded-Proto. Behind
// Cloudflare that address is a Cloudflare edge; the rate limits count the
// visitor's own address (clientIp.js).
app.set('trust proxy', 1);

// Every request is counted until it is answered, so a shutdown can wait for it
// (httpDrain.js, stop() below).
app.use(httpDrain.track);

// Railway's deploy check and CI (health.js). Ahead of the HTTPS redirect, the
// rate limits and the session lookup: the check comes over plain HTTP from
// inside Railway, carries no cookie, and must always be answered.
app.get('/health', healthHandler(db));

// HTTPS redirect in production
app.use((req, res, next) => {
  if (isProduction && req.get('x-forwarded-proto') === 'http') {
    return res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
  }
  next();
});

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // app uses inline scripts/styles extensively
  crossOriginEmbedderPolicy: false, // overlay pages are embedded in OBS
  // Pages tell this site, and only this site, which page a request comes
  // from. Under helmet's default (no-referrer) a browser sends a form post
  // with "Origin: null" and no Referer, which the CSRF check (csrf.js) must
  // refuse. Other sites still get no referrer: overlay and share links carry
  // a token in the address.
  referrerPolicy: { policy: 'same-origin' },
}));

// Rate limiters
// The multistream relay (MediaMTX) asks /api/multistream/auth before every
// publish, read and API login, all from its one address. Requests carrying
// MEDIAMTX_WEBHOOK_SECRET come from the relay and are not counted by the rate
// limits; a request without it gets 401 and is counted.
const fromRelay = (req) => config.multistream.enabled && isRelayRequest(req, config.multistream.webhookSecret);
// Every limit below counts per visitor: their own address behind Cloudflare
// (clientIp.js), and for IPv6 their /56 (the library's ipKeyGenerator).
const byVisitor = (req) => ipKeyGenerator(clientIp(req));
const generalLimiter = rateLimit({ windowMs: 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false, keyGenerator: byVisitor, skip: fromRelay });
// Every /api request, counted once per address. The relay's requests (above)
// are not counted.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: byVisitor,
  skip: fromRelay,
});
app.use(generalLimiter);
// Every /api route (the multistream webhooks, the api router) is behind this one limiter. It is mounted ahead of the body
// parsers, so a refused request is answered before its body (up to 10 MB on
// some routes) is read, and it counts each request once: no /api route may be
// given apiLimiter again.
app.use('/api', apiLimiter);
// The Racing product is gone (2026-11-16): the old desktop app's API paths
// answer 410 Gone, so an installed copy gets a clean answer.
const RETIRED_RACING_API = /^\/api\/(bridge(\/|-logs|-ids|-users|-bug-reports|$)|track-maps?(\/|$)|track-stats(\/|$)|live-session(\/|$)|sessions?(\/|$)|voice(\/|$))/;
app.use((req, res, next) => {
  if (RETIRED_RACING_API.test(req.path)) return res.status(410).json({ error: 'gone' });
  next();
});
function secureCookie(res, name, value, opts = {}) {
  res.cookie(name, value, { httpOnly: true, secure: isProduction, sameSite: 'lax', ...opts });
}
app.locals.secureCookie = secureCookie;

// Middleware
app.use(cookieParser());
// Bodies up to 100 kb; the routes allowed more are listed in bodyParsers.js.
mountBodyParsers(app);

// Static files — no-cache for overlay assets so OBS gets fresh JS/CSS after deploy. The looks'
// recordings and the tip voices' previews carry their content hash in their name (scripts/look-sounds.js,
// docs/features/tip-tts.md), so they keep for a year.
const HASHED_RECORDINGS = ['/overlay/objects/sounds/', '/tts/previews/'];
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.mp3') && HASHED_RECORDINGS.some((dir) => filePath.includes(dir))) {
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (filePath.includes('/overlay/')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));
// Files people uploaded, from the persistent data volume. Each is sent with the
// headers in services/userContentHeaders.js, so a file opened directly can
// never run as a page on this site. Custom alert sounds are per streamer and
// served by GET /overlay/sounds/:token/:type (routes/overlay.js) with the same
// headers. Nothing serves data/ itself (the database and its backups).
const dataFiles = (folder, extraHeaders) => express.static(path.join(__dirname, '..', 'data', folder), {
  setHeaders: (res, filePath) => {
    setUserContentHeaders(res, filePath);
    if (extraHeaders) extraHeaders(res);
  },
});
// Sponsor images
app.use('/sponsors', dataFiles('sponsors'));
// Channel point redemption media
app.use('/redemptions', dataFiles('redemptions', (res) => res.set('Cache-Control', 'public, max-age=86400')));
// Profile pictures
app.use('/avatars', dataFiles('avatars'));
// Issue screenshots
app.use('/issues-files', dataFiles('issues'));
// Custom VTuber models
app.use('/vtuber-models', dataFiles('vtuber-models'));
// Serve custom overlay uploads from persistent data volume — DISABLED for now
// app.use('/uploads/custom', express.static(path.join(__dirname, '..', 'data', 'uploads', 'custom')));

// EJS setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session middleware — attach the streamer and the coaching viewer to the request
app.use((req, res, next) => {
  const sid = req.cookies?.session;
  if (sid) {
    const session = db.getSession(sid);
    if (session) {
      // The stored hash of the session id, from which the CSRF check derives
      // this session's token (csrf.js).
      req.sessionHash = session.sid;
      if (session.streamer_id) {
        req.streamer = db.getStreamerById(session.streamer_id);
      }
    }
  }

  // An account an admin disabled is not logged in anywhere (/dashboard says why).
  applyAccountStatus(req);

  // Who books coaching (routes/coaching.js): a viewer's own Discord sign-in
  // (viewer_sessions, /auth/coaching-signin) wins; otherwise a streamer signed
  // in to the site books as their Discord account. With no web session, the
  // viewer session's stored hash gives the page its CSRF token (csrf.js).
  const viewerSession = req.cookies?.viewer_session ? db.getViewerSession(req.cookies.viewer_session) : null;
  if (viewerSession) {
    req.viewer = {
      discordUserId: viewerSession.discord_user_id,
      username: viewerSession.discord_username,
      displayName: viewerSession.discord_display_name || viewerSession.discord_username,
      avatar: viewerSession.discord_avatar || null,
      fromStreamer: false,
    };
    if (!req.sessionHash) req.sessionHash = viewerSession.sid;
  } else if (req.streamer && req.streamer.discord_user_id) {
    req.viewer = {
      discordUserId: req.streamer.discord_user_id,
      username: req.streamer.discord_username,
      displayName: req.streamer.discord_display_name || req.streamer.discord_username,
      avatar: req.streamer.discord_avatar || null,
      fromStreamer: true,
    };
  }

  res.locals.streamer = req.streamer || null;
  res.locals.streamerTier = req.streamer ? db.getStreamerTier(req.streamer.id) : 'free';
  res.locals.isAdmin = req.streamer ? db.isAdmin(req.streamer.id) : false;
  res.locals.features = config.features;

  // i18n
  // English, unless the visitor picked a language with the switcher (the lang
  // cookie). The browser's own language is not used.
  const lang = SUPPORTED_LANGS.includes(req.cookies?.lang) ? req.cookies.lang : 'en';
  req.lang = lang;
  res.locals.lang = lang;
  res.locals.SUPPORTED_LANGS = SUPPORTED_LANGS;
  res.locals.t = (key, params) => t(lang, key, params);
  // For the views: esc() for data inside markup a view prints itself, rich() for a sentence with a link, bold word or code in it
  // (src/i18n.js). No view defines its own.
  res.locals.esc = esc;
  res.locals.rich = richFor(res.locals.t);
  res.locals.currentPath = req.path;

  next();
});

// CSRF (csrf.js): a request that changes something must come from one of this
// site's pages and, from a logged-in visitor, carry the session's token. After
// the session middleware (the token comes from the session) and the body
// parsers (it reads the _csrf form field), ahead of every route. The routes
// that programs call and that skip the "from this site" part (the
// multistream relay's, the development sync, the public tip
// form) are listed in csrf.js; a logged-in request to them still needs the token.
app.use(csrfProtection({ appUrl: config.app.url }));

// Routes
// The home page: the streamer tools' features (views/home.ejs).
app.get('/', (req, res) => {
  res.render('home', {
    streamer: req.streamer || null,
    // YouTube go-live posts need the YouTube Data API key (pollers/manager.js
    // does nothing without it), so the page offers them only when it is set.
    youtubeLive: !!(config.features.youtube && config.youtube && config.youtube.apiKey),
  });
});

app.get('/tutorial', (req, res) => {
  res.render('tutorial', { streamer: req.streamer || null });
});

app.get('/donate', (req, res) => {
  res.render('donate', { streamer: req.streamer || null });
});

app.get('/pricing', (req, res) => {
  res.render('pricing', {
    streamer: req.streamer || null,
    tiers: config.tiers,
    currentTier: req.streamer ? db.getStreamerTier(req.streamer.id) : null,
    msg: req.query.msg,
  });
});

app.use('/auth', authRoutes);
// Multistream: the settings page, and the routes the relay calls (behind apiLimiter, mounted above).
app.use('/dashboard/multistream', multistreamRoutes.dashboardRouter);
app.use('/api/multistream', multistreamRoutes.apiRouter);
app.use('/dashboard', dashboardRoutes);
// app.use('/dashboard/custom-overlays', customOverlayRoutes); // DISABLED for now
app.use('/payment', paymentRoutes);
app.use('/tip', tipRoutes);
// The public coaching booking page (its viewers sign in with /auth/coaching-signin). Pay starts a PayPal order and
// /paid captures one: both talk to PayPal, so each visitor gets 15 of them in 10 minutes (the tick, not the browser,
// does the rest of the reading).
const coachingPayLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false, keyGenerator: byVisitor });
app.post('/coaching/:username/bookings/:id/pay', coachingPayLimiter);
app.get('/coaching/:username/paid', coachingPayLimiter);
// The viewer's reschedule routes (their times, a proposal, accepting the coach's): 30 in 10 minutes per visitor.
const coachingRescheduleLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: byVisitor });
app.get('/coaching/:username/bookings/:id/starts', coachingRescheduleLimiter);
app.post('/coaching/:username/bookings/:id/propose', coachingRescheduleLimiter);
app.post('/coaching/:username/bookings/:id/accept-proposal', coachingRescheduleLimiter);
app.use('/coaching', require('./routes/coaching'));
app.use('/my-bookings', require('./routes/myBookings'));

// The Racing product is gone: its old front doors lead home.
app.get(/^\/(racing|tracks)(\/.*)?$/, (req, res) => res.redirect('/'));

// The old Streamer landing page: its place is the home page now
// (views/streamer-landing.ejs is kept but not used).
app.get('/streamer', (req, res) => {
  res.redirect(req.streamer ? '/dashboard' : '/');
});
app.use('/api', apiRoutes); // apiLimiter is applied above, ahead of every /api route
app.use('/admin', adminRoutes);
app.use('/vtuber', vtuberRoutes);
app.use('/sync', syncRoutes);
app.use('/overlay', overlayRoutes);


// Language switch
app.post('/set-language', (req, res) => {
  const lang = SUPPORTED_LANGS.includes(req.body.lang) ? req.body.lang : 'en';
  secureCookie(res, 'lang', lang, { maxAge: 365 * 24 * 60 * 60 * 1000 });
  const referer = req.headers.referer || '/';
  res.redirect(referer);
});

// Error handler: keep it the LAST middleware, after every route and parser, so
// anything they throw ends in a generic page or JSON body instead of a stack.
app.use(errorHandler);

let httpServer = null;

function start() {
  const port = config.app.port;
  const server = app.listen(port, () => {
    console.log(`[Server] Dashboard at ${config.app.url}`);
  });
  httpServer = server;
  // A server that cannot listen (the port is taken) must not leave the process
  // running with no site: exit, so the platform restarts it.
  server.on('error', (err) => {
    if (server.listening) return console.error(`[Server] ${err.message}`);
    console.error(`[Server] Could not listen on port ${port}: ${err.message}`);
    process.exit(1);
  });

  // Ensure all streamers have a subscription record
  db.ensureFreeSubscriptions();

  // Clean expired sessions every hour
  setInterval(() => { db.cleanExpiredSessions(); db.cleanExpiredViewerSessions(); }, 60 * 60 * 1000);

  // Check for expired subscriptions every hour
  setInterval(() => db.expireSubscriptions(), 60 * 60 * 1000);

  // Daily data sync from prod (dev environment only)
  if (config.app.syncSourceUrl && config.app.syncSecret) {
    const { performSync } = require('./services/sync');

    if (process.env.SYNC_ON_STARTUP === 'true') {
      setTimeout(() => performSync(), 10_000);
    }

    // Schedule daily sync at 04:00 UTC
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(4, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    setTimeout(() => {
      performSync();
      setInterval(() => performSync(), 24 * 60 * 60 * 1000);
    }, next - now);

    console.log(`[Sync] Daily sync scheduled at 04:00 UTC (next: ${next.toISOString()})`);
  }

  return server;
}

// On SIGTERM/SIGINT (index.js): stop taking connections, end the overlay event
// streams and give the requests in progress up to timeoutMs to finish
// (httpDrain.js). Resolves with how many had not finished by then.
function stop({ timeoutMs = 10_000 } = {}) {
  if (!httpServer) return Promise.resolve(0);
  return httpDrain.drain(httpServer, { timeoutMs });
}

module.exports = { start, stop };
