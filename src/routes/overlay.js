const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const db = require('../db');
const bus = require('../services/overlayBus');
const customSounds = require('../services/customSounds');
const { buildOverlayConfig } = require('../services/overlayConfig');
const { accountDisabledChannel } = require('../services/streamerAccess');

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

  // Listen for events on the bus
  const listener = (event) => {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch (e) { /* connection closed */ }
  };

  bus.on(`overlay:${streamer.id}`, listener);
  endStreamWhenAccountDisabled(streamer.id, req, res);

  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off(`overlay:${streamer.id}`, listener);
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
