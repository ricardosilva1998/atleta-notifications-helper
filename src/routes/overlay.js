const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const db = require('../db');
const bus = require('../services/overlayBus');
const overlayPresence = require('../services/overlayPresence');
const customSounds = require('../services/customSounds');
const { buildOverlayConfig } = require('../services/overlayConfig');
const { accountDisabledChannel } = require('../services/streamerAccess');
const { setUserContentHeaders } = require('../services/userContentHeaders');
// Event streams are ended when the server shuts down; OBS reconnects to the new one.
const { holdStream } = require('../httpDrain');
const { t, SUPPORTED_LANGS } = require('../i18n');

// Unique ID per server process — changes on every restart/deploy
const SERVER_INSTANCE_ID = crypto.randomBytes(8).toString('hex');

// Every overlay route looks the streamer up by token with
// db.getStreamerByOverlayToken, which finds nobody for an account an admin has
// disabled, so a disabled account's links answer like an unknown token. A stream
// that was already open when the account was disabled is ended here.
function endStreamWhenAccountDisabled(streamerId, req, res) {
  const channel = accountDisabledChannel(streamerId);
  const end = () => res.end();
  bus.once(channel, end);
  req.on('close', () => bus.off(channel, end));
}

// The event types the alert overlay draws as an alert. While the streamer's overlay switch is off none of
// them reaches the stream; everything else on it still does (config updates, clears, sponsor images,
// redemption clips, and the chat lines the iRacing chat overlay reads, which twitchChat.js already sends only
// while the switch is on).
const ALERT_TYPES = new Set(['follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner', 'yt_superchat', 'yt_member', 'yt_giftmember']);

// SSE endpoint — MUST be before /:token to avoid being caught by the wildcard
router.get('/events/:token', (req, res) => {
  const streamer = db.getStreamerByOverlayToken(req.params.token);
  if (!streamer) return res.status(404).send('Invalid overlay token');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Send initial config: the same builder the dashboard's live pushes use
  const config = buildOverlayConfig(streamer);

  // Include overlay designs keyed by event type
  const designs = db.getAllOverlayDesigns(streamer.id);
  const designMap = {};
  designs.forEach(d => { designMap[d.event_type] = d; });

  res.write(`data: ${JSON.stringify({ type: 'config', config, designs: designMap, serverVersion: SERVER_INSTANCE_ID })}\n\n`);

  // Replay current sponsor image so new clients see it immediately
  try {
    const { timedNotificationManager } = require('../services/timedNotifications');
    const currentSponsor = timedNotificationManager.getCurrentSponsor(streamer.id);
    if (currentSponsor) {
      res.write(`data: ${JSON.stringify(currentSponsor)}\n\n`);
    }
  } catch (e) { /* timedNotifications not yet initialized */ }

  // Heartbeat every 30s to keep connection alive in OBS browser source
  const heartbeat = setInterval(() => {
    try { res.write(`:heartbeat\n\n`); } catch (e) { clearInterval(heartbeat); }
  }, 30000);

  // Listen for events on the bus. The listener runs inside the sender's emit, so nothing may throw out of it.
  const listener = (event) => {
    try {
      if (event && ALERT_TYPES.has(event.type) && !db.isOverlayEnabled(streamer.id)) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (e) { /* the switch could not be read (the alert is not shown), or the connection closed */ }
  };

  bus.on(`overlay:${streamer.id}`, listener);
  endStreamWhenAccountDisabled(streamer.id, req, res);
  holdStream(res);

  // The alert overlay names itself (?source=alerts): the dashboard says whether it is open in OBS.
  const isAlertOverlay = req.query.source === 'alerts';
  if (isAlertOverlay) overlayPresence.opened(streamer.id);

  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off(`overlay:${streamer.id}`, listener);
    if (isAlertOverlay) overlayPresence.closed(streamer.id);
  });
});

// A streamer's custom alert sound, from their own folder. 404 when they have
// none for this type; the overlay then plays its synthesized default.
router.get('/sounds/:token/:type', async (req, res) => {
  const streamer = db.getStreamerByOverlayToken(req.params.token);
  const file = streamer ? customSounds.soundFilePath(streamer.id, req.params.type) : null;
  const mimeType = file ? await customSounds.storedSoundMimeType(file) : null;
  if (!mimeType) return res.status(404).end();

  // The overlay asks for ?v=<mtimeMs>, so a replaced sound has a new URL;
  // no-cache also makes OBS revalidate a URL it has played before.
  res.set('Cache-Control', 'no-cache');
  setUserContentHeaders(res, file); // an uploaded file: never run as a page here
  res.type(mimeType);
  res.sendFile(path.basename(file), { root: path.dirname(file) }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// Clear overlay — removes all queued alerts and cards
router.post('/clear', (req, res) => {
  if (!req.streamer) return res.status(401).json({ error: 'Not authenticated' });
  bus.emit(`overlay:${req.streamer.id}`, { type: 'clear' });
  console.log(`[Overlay] Cleared for streamer ${req.streamer.id}`);
  res.json({ ok: true });
});

// Sponsor-only SSE endpoint
router.get('/sponsors/events/:token', (req, res) => {
  const streamer = db.getStreamerByOverlayToken(req.params.token);
  if (!streamer) return res.status(404).send('Invalid overlay token');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Send design config for sponsor positioning
  const designs = db.getAllOverlayDesigns(streamer.id);
  const designMap = {};
  designs.forEach(d => { designMap[d.event_type] = d; });
  res.write(`data: ${JSON.stringify({ type: 'config', designs: designMap, serverVersion: SERVER_INSTANCE_ID })}\n\n`);

  // Replay current sponsor
  try {
    const { timedNotificationManager } = require('../services/timedNotifications');
    const currentSponsor = timedNotificationManager.getCurrentSponsor(streamer.id);
    if (currentSponsor) {
      res.write(`data: ${JSON.stringify(currentSponsor)}\n\n`);
    }
  } catch (e) {}

  const heartbeat = setInterval(() => {
    try { res.write(`:heartbeat\n\n`); } catch (e) { clearInterval(heartbeat); }
  }, 30000);

  const listener = (event) => {
    // Only forward sponsor events
    if (event.type !== 'sponsor') return;
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch (e) {}
  };

  bus.on(`overlay:${streamer.id}`, listener);
  endStreamWhenAccountDisabled(streamer.id, req, res);
  holdStream(res);
  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off(`overlay:${streamer.id}`, listener);
  });
});

// Sponsor-only overlay page
router.get('/sponsors/:token', (req, res) => {
  const streamer = db.getStreamerByOverlayToken(req.params.token);
  if (!streamer) return res.status(404).send('Invalid overlay token');

  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Sponsor Overlay</title>
  <link rel="stylesheet" href="/overlay/overlay.css">
</head>
<body>
  <div id="timed-container"></div>
  <script>window.OVERLAY_TOKEN = ${JSON.stringify(streamer.overlay_token)};</script>
  <script src="/overlay/sponsors.js"></script>
</body>
</html>`);
});

// Tip goal SSE endpoint — progress bar overlay
router.get('/goal/events/:token', (req, res) => {
  const streamer = db.getStreamerByOverlayToken(req.params.token);
  if (!streamer) return res.status(404).send('Invalid overlay token');

  const tipGoals = require('../services/tipGoals');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  res.write(`data: ${JSON.stringify({ type: 'config', serverVersion: SERVER_INSTANCE_ID })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'tip_goal', goal: tipGoals.toPayload(db.getActiveTipGoal(streamer.id)) })}\n\n`);

  const heartbeat = setInterval(() => {
    try { res.write(`:heartbeat\n\n`); } catch (e) { clearInterval(heartbeat); }
  }, 30000);

  const listener = (event) => {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch (e) {}
  };

  bus.on(tipGoals.channel(streamer.id), listener);
  endStreamWhenAccountDisabled(streamer.id, req, res);
  holdStream(res);
  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off(tipGoals.channel(streamer.id), listener);
  });
});

function goalPageHtml(bootScript) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Tip Goal Overlay</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/overlay/goal.css">
</head>
<body>
  <div id="goal-root"></div>
  <script>${bootScript}</script>
  <script src="/overlay/goal.js"></script>
</body>
</html>`;
}

// Tip goal preview page — no token, no SSE. Driven by postMessage from the
// donation settings page so streamers can see the bar before starting a goal.
router.get('/goal-demo', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(goalPageHtml('window.GOAL_DEMO = true;'));
});

// Tip goal overlay page — separate OBS browser source
router.get('/goal/:token', (req, res) => {
  const streamer = db.getStreamerByOverlayToken(req.params.token);
  if (!streamer) return res.status(404).send('Invalid overlay token');

  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(goalPageHtml(`window.OVERLAY_TOKEN = ${JSON.stringify(streamer.overlay_token)};`));
});

// The Polls & predictions bar (an OBS browser source of its own). Its stream says what runs when it opens — read from
// Twitch when EventSub said nothing lately (after a restart OBS reconnects here) — then every change on the bus
// channel poll:<streamerId>; it does not follow the alerts' switch. While something runs the bar asks livePolls again:
// a streamer whose overlay and chatbot are both off has no EventSub connection, and EventSub can lose an end, lock or
// result event. Asking costs nothing while EventSub talks: live() reads Twitch only when EventSub has been quiet for
// 30 s (or a running view is past its end), at most once every 5 s per streamer, one read shared by every caller, and
// what a read finds reaches every open bar on poll:<streamerId>.
const BAR_RUNNING_CHECK_MS = 5000; // every 5 s while a poll or prediction runs
const BAR_LOCKED_CHECK_MS = 60000; // at most once a minute while a prediction stays locked (a lock can last 24 h)

router.get('/poll/events/:token', (req, res) => {
  const streamer = db.getStreamerByOverlayToken(req.params.token);
  if (!streamer) return res.status(404).send('Invalid overlay token');
  const { livePolls } = require('../services/livePolls');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event) => {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch (e) {}
  };
  send({ type: 'config', serverVersion: SERVER_INSTANCE_ID });

  const heartbeat = setInterval(() => {
    try { res.write(`:heartbeat\n\n`); } catch (e) { clearInterval(heartbeat); }
  }, 30000);
  let askedAt = Date.now(); // the read when the bar opens, below
  const recheck = setInterval(() => {
    const now = Date.now();
    const { poll, prediction } = livePolls.barState(streamer.id);
    const running = [poll, prediction].some((view) => !!view && view.state === 'running');
    const locked = !!prediction && prediction.state === 'locked';
    if (!running && !(locked && now - askedAt >= BAR_LOCKED_CHECK_MS)) return;
    askedAt = now;
    livePolls.live(streamer.id).catch(() => null);
  }, BAR_RUNNING_CHECK_MS);
  const channel = `poll:${streamer.id}`;
  bus.on(channel, send);
  endStreamWhenAccountDisabled(streamer.id, req, res);
  holdStream(res);
  req.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(recheck);
    bus.off(channel, send);
  });

  livePolls.live(streamer.id).catch(() => null).then(() => send({ type: 'poll-state', ...livePolls.barState(streamer.id) }));
});

// The bar's texts: pollbar.* in the language the link names. {{count}}, {{points}} and {{viewers}} stay for the bar to
// fill in (POLL_BAR_FIELDS); exactly one vote takes voteOne or pollFootOne.
const POLL_BAR_TEXTS = Object.freeze({
  poll: 'pollbar.poll', prediction: 'pollbar.prediction', locked: 'pollbar.locked', result: 'pollbar.result',
  votes: 'pollbar.votes', voteOne: 'pollbar.voteOne', pointsViewers: 'pollbar.pointsViewers', pollFoot: 'pollbar.pollFoot',
  pollFootOne: 'pollbar.pollFootOne',
  predictionFoot: 'pollbar.predictionFoot', winners: 'pollbar.winners', tie: 'pollbar.tie', noVotes: 'pollbar.noVotes',
  cancelled: 'pollbar.cancelled',
});
const POLL_BAR_FIELDS = Object.freeze({ count: '{{count}}', points: '{{points}}', viewers: '{{viewers}}' });

router.get('/poll/:token', (req, res) => {
  const streamer = db.getStreamerByOverlayToken(req.params.token);
  if (!streamer) return res.status(404).send('Invalid overlay token');

  const lang = SUPPORTED_LANGS.includes(req.query.lang) ? req.query.lang : 'en';
  const texts = Object.fromEntries(Object.entries(POLL_BAR_TEXTS).map(([name, key]) => [name, t(lang, key, POLL_BAR_FIELDS)]));
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(`<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <title>Poll Bar</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;700;800&family=DM+Sans:wght@500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/overlay/poll.css">
</head>
<body>
  <div id="poll-root"></div>
  <script>window.OVERLAY_TOKEN = ${JSON.stringify(streamer.overlay_token).replace(/</g, '\\u003c')}; window.POLL_BAR_TEXTS = ${JSON.stringify(texts).replace(/</g, '\\u003c')};</script>
  <script src="/overlay/pollModel.js"></script>
  <script src="/overlay/poll.js"></script>
</body>
</html>`);
});

// Custom overlay routes — DISABLED for now
// const { setupSSE: customSSE, servePage: customPage } = require('./customOverlays');
// router.get('/scenes/events/:token', (req, res) => customSSE(req, res, 'scene'));
// router.get('/scenes/:token', (req, res) => customPage(req, res, 'scene'));
// router.get('/bar/events/:token', (req, res) => customSSE(req, res, 'bar'));
// router.get('/bar/:token', (req, res) => customPage(req, res, 'bar'));
// router.get('/custom-alerts/events/:token', (req, res) => customSSE(req, res, 'custom-alert'));
// router.get('/custom-alerts/:token', (req, res) => customPage(req, res, 'custom-alert'));

// iRacing overlay pages
router.get('/iracing/:type/:token', (req, res) => {
  const validTypes = ['standings', 'relative', 'fuel', 'chat', 'wind', 'proximity'];
  const type = req.params.type;
  if (!validTypes.includes(type)) return res.status(404).send('Invalid overlay type');
  const streamer = db.getStreamerByOverlayToken(req.params.token);
  if (!streamer) return res.status(404).send('Invalid overlay token');

  let settings = {};
  try {
    const setting = db.getIracingOverlaySetting(streamer.id, type);
    if (setting) settings = JSON.parse(setting.settings || '{}');
  } catch (e) {}
  // Escape every "<" (as a JSON unicode escape) because the settings hold
  // streamer-entered text and are embedded raw in the inline <script> below;
  // same pattern as the builder and redemption pages.
  const settingsJson = JSON.stringify(settings).replace(/</g, '\\u003c');

  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>iRacing ${type.charAt(0).toUpperCase() + type.slice(1)} Overlay</title>
  <link rel="stylesheet" href="/overlay/iracing/shared.css">
  <link rel="stylesheet" href="/overlay/iracing/${type}.css">
</head>
<body>
  <div id="overlay-root"></div>
  <script>
    window.OVERLAY_TOKEN = ${JSON.stringify(req.params.token)};
    window.OVERLAY_TYPE = ${JSON.stringify(type)};
    window.OVERLAY_SETTINGS = ${settingsJson};
    window.STREAMER_ID = ${streamer.id};
  </script>
  <script src="/overlay/iracing/shared.js"></script>
  <script src="/overlay/iracing/${type}.js"></script>
</body>
</html>`);
});

// Serve overlay page — AFTER /events/:token so the wildcard doesn't catch SSE requests
router.get('/:token', (req, res) => {
  const streamer = db.getStreamerByOverlayToken(req.params.token);
  if (!streamer) return res.status(404).send('Invalid overlay token');

  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Stream Overlay</title>
  <link rel="stylesheet" href="/overlay/overlay.css">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oxanium:wght@400;600;700;800&family=Saira+Condensed:wght@400;500;600;700&display=swap">
  <link rel="stylesheet" href="/overlay/objects/objects.css">
</head>
<body>
  <div id="notification-container"></div>
  <div id="timed-container"></div>
  <video id="redemption-video" playsinline preload="auto"
         style="position:absolute; display:none; pointer-events:none; object-fit:contain; z-index:90;"></video>
  <audio id="redemption-audio" preload="auto"></audio>
  <script>window.OVERLAY_TOKEN = ${JSON.stringify(streamer.overlay_token)};</script>
  <script src="/overlay/objects/index.js"></script>
  <script src="/overlay/placement.js"></script>
  <script src="/overlay/overlay.js"></script>
</body>
</html>`);
});

module.exports = router;
