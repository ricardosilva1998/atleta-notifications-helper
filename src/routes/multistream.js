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
const { decideRelayAuth, streamTokenFromPath, sameSecret } = require('../services/multistreamAuth');
const { sessions, STOP_GRACE_MS } = require('../services/multistreamSessions');
const { requireActiveStreamer } = require('../services/streamerAccess');

const dashboardRouter = express.Router();
const apiRouter = express.Router();

// Read on every request (not once at load), so the gate follows the config.
dashboardRouter.use((req, res, next) => (config.multistream.enabled ? next() : res.redirect('/dashboard')));
dashboardRouter.use(requireActiveStreamer);
apiRouter.use((req, res, next) => (config.multistream.enabled ? next() : res.status(404).json({ error: 'not found' })));

// --- Dashboard page ---

dashboardRouter.get('/', (req, res) => {
  const streamer = req.streamer;
  const cfg = db.getMultistreamConfig(streamer.id) || {};
  const token = db.ensureMultistreamToken(streamer.id);
  const fresh = db.getStreamerById(streamer.id);

  res.render('multistream', {
    streamer: fresh,
    multistream: cfg,
    ingestUrl: config.multistream.ingestUrl,
    streamKey: token,
    twitchAuthorized: !!fresh.broadcaster_access_token,
    twitchHasStreamKeyScope: twitch.hasStreamKeyScope(fresh),
    youtubeConnected: !!fresh.yt_access_token,
    youtubeChannelName: fresh.yt_channel_name || null,
    isLive: !!cfg.multistream_active_broadcast_id,
    query: req.query,
  });
});

dashboardRouter.post('/save', (req, res) => {
  const { enabled, youtube_privacy, youtube_category_id, youtube_default_title } = req.body;
  db.setMultistreamConfig(req.streamer.id, {
    enabled: !!enabled,
    youtubePrivacy: ['public', 'unlisted', 'private'].includes(youtube_privacy) ? youtube_privacy : 'public',
    youtubeCategoryId: youtube_category_id || '20',
    youtubeDefaultTitle: youtube_default_title?.slice(0, 100) || null,
  });
  res.redirect('/dashboard/multistream?saved=1');
});

dashboardRouter.post('/reset-youtube-stream', (req, res) => {
  db.clearMultistreamYoutubeStream(req.streamer.id);
  res.redirect('/dashboard/multistream?reset=1');
});

// --- Routes the relay calls (MediaMTX, not the streamer) ---

// The secret a caller presents: "Authorization: Bearer <secret>" (the
// webhooks' curl), or the password of HTTP Basic (MediaMTX's auth requests,
// which carry it in the address they are sent to).
function presentedSecret(req) {
  const header = req.get('Authorization') || '';
  const bearer = /^Bearer (.+)$/.exec(header);
  if (bearer) return bearer[1];
  const basic = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(header);
  if (!basic) return '';
  const login = Buffer.from(basic[1], 'base64').toString('utf8');
  const colon = login.indexOf(':');
  return colon === -1 ? '' : login.slice(colon + 1);
}

// Everything under /api/multistream comes from the relay, with
// MEDIAMTX_WEBHOOK_SECRET.
function authenticateRelay(req, res) {
  if (!sameSecret(presentedSecret(req), config.multistream.webhookSecret)) {
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

module.exports = { dashboardRouter, apiRouter };
