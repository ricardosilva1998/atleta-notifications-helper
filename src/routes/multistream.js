'use strict';

// Multistream: the streamer's settings page (/dashboard/multistream) and the
// routes the relay (MediaMTX) calls (/api/multistream). They are two routers,
// each mounted once in server.js; the relay's routes sit under /api, behind
// its one rate limit.
//
// Until the relay is configured (config.multistream.enabled, see
// docs/multistream-relay-setup.md) the page sends the streamer back to the
// dashboard and the relay's routes answer 404. Saved settings are kept.

const express = require('express');
const config = require('../config');
const db = require('../db');
const twitch = require('../services/twitch');
const relay = require('../services/multistreamRelay');
const { sanitizeBroadcastTitle } = require('../services/youtubeBroadcast');
const { decideRelayAuth, streamTokenFromPath, sameSecret, presentedSecret } = require('../services/multistreamAuth');
const { sessions, STOP_GRACE_MS } = require('../services/multistreamSessions');
const { requireActiveStreamer } = require('../services/streamerAccess');

// The YouTube categories the settings page offers (multistream.ejs), and the
// only ones saved. Anything else is saved as Gaming.
const YOUTUBE_CATEGORY_IDS = Object.freeze(['20', '22', '24', '17', '28', '10']);
const YOUTUBE_PRIVACY = Object.freeze(['public', 'unlisted', 'private']);
// The page asks the relay whether the streamer is live; it waits this long at most.
const RELAY_LOOKUP_TIMEOUT_MS = 3000;

const dashboardRouter = express.Router();
const apiRouter = express.Router();

// Read on every request (not once at load), so the gate follows the config.
dashboardRouter.use((req, res, next) => (config.multistream.enabled ? next() : res.redirect('/dashboard')));
dashboardRouter.use(requireActiveStreamer);
apiRouter.use((req, res, next) => (config.multistream.enabled ? next() : res.status(404).json({ error: 'not found' })));

// Whether the streamer's stream is on the relay right now, as the relay sees
// it: 'live', 'offline', or 'unknown' when the relay did not answer in time.
async function liveState(token, streamerId) {
  try {
    const stats = await relay.getPathStats({ ...relay.relaySettings(config.multistream), sourceToken: token, signal: AbortSignal.timeout(RELAY_LOOKUP_TIMEOUT_MS) });
    return relay.isLive(stats) ? 'live' : 'offline';
  } catch (err) {
    console.warn(`[multistream] could not ask the relay whether streamer ${streamerId} is live: ${err.message}`);
    return 'unknown';
  }
}

// --- Dashboard page ---

dashboardRouter.get('/', async (req, res) => {
  const streamer = req.streamer;
  const cfg = db.getMultistreamConfig(streamer.id) || {};
  const token = db.ensureMultistreamToken(streamer.id);
  const fresh = db.getStreamerById(streamer.id);
  const state = await liveState(token, streamer.id);

  res.render('multistream', {
    streamer: fresh,
    multistream: cfg,
    ingestUrl: config.multistream.ingestUrl,
    streamKey: token,
    twitchAuthorized: !!fresh.broadcaster_access_token,
    twitchHasStreamKeyScope: twitch.hasStreamKeyScope(fresh),
    youtubeConnected: !!fresh.yt_access_token,
    youtubeChannelName: fresh.yt_channel_name || null,
    // From the relay, not from the stored YouTube broadcast (which says
    // nothing about a stream that only goes to Twitch).
    isLive: state === 'live',
    liveUnknown: state === 'unknown',
    query: req.query,
  });
});

dashboardRouter.post('/save', (req, res) => {
  const { enabled, youtube_privacy, youtube_category_id, youtube_default_title } = req.body;
  db.setMultistreamConfig(req.streamer.id, {
    enabled: !!enabled,
    youtubePrivacy: YOUTUBE_PRIVACY.includes(youtube_privacy) ? youtube_privacy : 'public',
    youtubeCategoryId: YOUTUBE_CATEGORY_IDS.includes(youtube_category_id) ? youtube_category_id : '20',
    // Saved as YouTube will take it, so the page shows what will be used.
    youtubeDefaultTitle: typeof youtube_default_title === 'string' ? (sanitizeBroadcastTitle(youtube_default_title, '') || null) : null,
  });
  res.redirect('/dashboard/multistream?saved=1');
});

// A new stream key, for one that was shared or leaked. Refused while the
// streamer is live (or the relay cannot say), because the stream on the old
// key would lose its forwarders. What the old key still had on the relay (and
// its YouTube broadcast) is cleared before the page shows the new key, so no
// go-live on the new key can overlap that clean-up.
dashboardRouter.post('/regenerate-key', async (req, res) => {
  const streamer = req.streamer;
  const current = db.ensureMultistreamToken(streamer.id);
  const state = await liveState(current, streamer.id);
  if (state !== 'offline') return res.redirect(`/dashboard/multistream?error=${state === 'live' ? 'live' : 'relay'}`);
  db.rotateMultistreamToken(streamer.id);
  try {
    await sessions().keyReplaced(current, streamer.id);
  } catch (err) {
    console.error(`[multistream] clearing the old stream key of streamer ${streamer.id}: ${err.message}`);
  }
  res.redirect('/dashboard/multistream?regenerated=1');
});

dashboardRouter.post('/reset-youtube-stream', (req, res) => {
  db.clearMultistreamYoutubeStream(req.streamer.id);
  res.redirect('/dashboard/multistream?reset=1');
});

// --- Routes the relay calls (MediaMTX, not the streamer) ---

// Everything under /api/multistream comes from the relay, with
// MEDIAMTX_WEBHOOK_SECRET (as Bearer, or as the Basic password:
// services/multistreamAuth.js presentedSecret).
function authenticateRelay(req, res) {
  if (!sameSecret(presentedSecret(req.get('Authorization')), config.multistream.webhookSecret)) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

// MediaMTX's authMethod: http. The relay asks before every publish, read and
// control-API login; a 2xx answer allows it (services/multistreamAuth.js).
apiRouter.post('/auth', (req, res) => {
  if (!authenticateRelay(req, res)) return;
  const decision = decideRelayAuth(req.body, {
    findStreamer: (token) => db.getStreamerByMultistreamToken(token),
    apiUser: config.multistream.apiUser,
    apiToken: config.multistream.apiToken,
  });
  res.status(decision.allow ? 200 : 401).json({ ok: decision.allow });
});

// The stream reached the relay (MediaMTX runOnAvailable). Answers once the
// forwarders are set up. A relay error answers 502, so the relay's curl tries
// again (only what is still missing is added).
apiRouter.post('/webhook/on-ready', async (req, res) => {
  if (!authenticateRelay(req, res)) return;
  const token = streamTokenFromPath(req.body?.path);
  if (!token) return res.status(400).json({ error: 'not a stream path' });

  let result;
  try {
    result = await sessions().goLive(token);
  } catch (err) {
    console.error(`[multistream on-ready] ${err.message}`);
    return res.status(502).json({ error: 'relay unavailable' });
  }
  if (result.status === 'unknown') return res.status(404).json({ error: 'unknown stream key' });
  if (result.status === 'off') return res.json({ ok: true, forwarded: false, reason: 'multistream is switched off' });
  if (result.relayFailed) return res.status(502).json({ error: 'relay add failed', destinations: result.forwarding, failed: result.failed });
  res.json({ ok: true, forwarded: result.forwarding.length > 0, destinations: result.forwarding, failed: result.failed });
});

// The stream left the relay (MediaMTX runOnUnavailable): its forwarders and
// YouTube broadcast are stopped a minute later, unless it comes back first.
apiRouter.post('/webhook/on-not-ready', (req, res) => {
  if (!authenticateRelay(req, res)) return;
  const token = streamTokenFromPath(req.body?.path);
  if (!token) return res.status(400).json({ error: 'not a stream path' });
  sessions().streamEnded(token);
  res.json({ ok: true, stopsInSeconds: STOP_GRACE_MS / 1000 });
});

module.exports = { dashboardRouter, apiRouter, YOUTUBE_CATEGORY_IDS };
