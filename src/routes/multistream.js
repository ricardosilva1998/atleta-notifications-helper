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
const ytBroadcast = require('../services/youtubeBroadcast');
const relay = require('../services/multistreamRelay');
const { decideRelayAuth, streamTokenFromPath, sameSecret } = require('../services/multistreamAuth');
const { requireActiveStreamer } = require('../services/streamerAccess');

const TWITCH_INGEST = 'rtmp://live.twitch.tv/app';
const YOUTUBE_INGEST = 'rtmp://a.rtmp.youtube.com/live2';

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

// The relay API settings (config.multistream) for services/multistreamRelay.js.
function relaySettings() {
  const { apiUrl, apiUser, apiToken, accessClientId, accessClientSecret } = config.multistream;
  return { apiUrl, apiUser, apiToken, accessClientId, accessClientSecret };
}

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

apiRouter.post('/webhook/on-ready', async (req, res) => {
  if (!authenticateRelay(req, res)) return;

  const token = streamTokenFromPath(req.body?.path);
  if (!token) return res.status(400).json({ error: 'not a stream path' });

  const streamer = db.getStreamerByMultistreamToken(token);
  if (!streamer) return res.status(404).json({ error: 'unknown stream key' });
  if (!streamer.multistream_enabled) {
    return res.json({ ok: true, forwarded: false, reason: 'disabled' });
  }

  const destinations = [];
  const failures = [];
  let youtubeBroadcastId = null;
  let youtubeStreamId = null;

  // --- Twitch destination ---
  try {
    const twitchKey = await twitch.getStreamKey(streamer);
    destinations.push({ name: 'twitch', url: `${TWITCH_INGEST}/${twitchKey}` });
  } catch (err) {
    console.error('[multistream on-ready] Twitch key fetch failed:', err.message);
    failures.push(`twitch: ${err.message}`);
  }

  // --- YouTube destination + broadcast lifecycle ---
  if (streamer.yt_access_token) {
    try {
      const { streamId, streamKey } = await ytBroadcast.getOrCreateLiveStream(streamer);
      youtubeStreamId = streamId;
      if (streamId !== streamer.multistream_youtube_stream_id) {
        db.setMultistreamYoutubeStream(streamer.id, streamId, null);
      }

      let title = streamer.multistream_youtube_default_title;
      if (!title && streamer.twitch_username) {
        try {
          const stream = await twitch.getStream(streamer.twitch_username);
          if (stream && stream.title) title = stream.title;
        } catch (e) { /* non-fatal */ }
      }
      if (!title) title = `Live — ${new Date().toLocaleDateString()}`;

      youtubeBroadcastId = await ytBroadcast.createBroadcast(streamer, {
        title,
        description: '',
        privacyStatus: streamer.multistream_youtube_privacy || 'public',
        categoryId: streamer.multistream_youtube_category_id || '20',
      });
      await ytBroadcast.bindBroadcastToStream(streamer, youtubeBroadcastId, streamId);
      db.setMultistreamActiveBroadcast(streamer.id, youtubeBroadcastId);
      destinations.push({ name: 'youtube', url: `${YOUTUBE_INGEST}/${streamKey}` });
    } catch (err) {
      console.error('[multistream on-ready] YouTube broadcast setup failed:', err.message);
      failures.push(`youtube: ${err.message}`);
      youtubeBroadcastId = null;
      youtubeStreamId = null;
    }
  }

  if (destinations.length === 0) {
    db.setMultistreamLastError(streamer.id, failures.join('; ') || 'No destinations available');
    return res.json({ ok: true, forwarded: false, reason: 'no destinations', failed: failures });
  }

  try {
    await relay.addForwardPaths({ ...relaySettings(), sourceToken: token, destinations });
    db.markMultistreamStarted(streamer.id);
  } catch (err) {
    console.error('[multistream on-ready] addForwardPaths failed:', err.message);
    db.setMultistreamLastError(streamer.id, `relay: ${err.message}`);
    return res.status(500).json({ error: 'relay add failed' });
  }

  // Going live on only some destinations is the dangerous case: the streamer
  // sees "live" and assumes both platforms. Persist it so the dashboard can say
  // which one dropped, and clear the warning after a clean start.
  db.setMultistreamLastError(streamer.id, failures.length ? failures.join('; ') : null);
  if (failures.length) {
    console.warn(
      `[multistream on-ready] PARTIAL forward for streamer ${streamer.id} — live on ${destinations.map((d) => d.name).join(', ')} only: ${failures.join('; ')}`
    );
  }

  // Async: wait for YouTube to detect the stream then transition to live.
  // Don't block the webhook response — MediaMTX has a short timeout.
  if (youtubeBroadcastId && youtubeStreamId) {
    setImmediate(async () => {
      try {
        const active = await ytBroadcast.waitForStreamActive(streamer, youtubeStreamId, 60_000);
        if (!active) {
          console.warn(`[multistream on-ready] YouTube stream did not go active within 60s for streamer ${streamer.id}`);
          return;
        }
        await ytBroadcast.transitionBroadcast(streamer, youtubeBroadcastId, 'live');
        console.log(`[multistream on-ready] YouTube broadcast ${youtubeBroadcastId} live for streamer ${streamer.id}`);
      } catch (err) {
        console.error('[multistream on-ready] YouTube transition→live failed:', err.message);
      }
    });
  }

  res.json({ ok: true, forwarded: true, destinations: destinations.map((d) => d.name), failed: failures });
});

apiRouter.post('/webhook/on-not-ready', async (req, res) => {
  if (!authenticateRelay(req, res)) return;

  const token = streamTokenFromPath(req.body?.path);
  if (!token) return res.status(400).json({ error: 'not a stream path' });

  const streamer = db.getStreamerByMultistreamToken(token);
  if (!streamer) return res.status(404).json({ error: 'unknown stream key' });

  try {
    await relay.removeForwardPaths({ ...relaySettings(), sourceToken: token, destinationNames: ['twitch', 'youtube'] });
  } catch (err) {
    console.error('[multistream on-not-ready] removeForwardPaths failed:', err.message);
  }

  if (streamer.multistream_active_broadcast_id) {
    const broadcastId = streamer.multistream_active_broadcast_id;
    try {
      const fresh = db.getStreamerByMultistreamToken(token);
      await ytBroadcast.transitionBroadcast(fresh, broadcastId, 'complete');
      console.log(`[multistream on-not-ready] YouTube broadcast ${broadcastId} completed for streamer ${streamer.id}`);
    } catch (err) {
      console.error('[multistream on-not-ready] YouTube transition→complete failed:', err.message);
    } finally {
      db.setMultistreamActiveBroadcast(streamer.id, null);
    }
  }

  res.json({ ok: true });
});

module.exports = { dashboardRouter, apiRouter };
