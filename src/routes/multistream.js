const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const config = require('../config');
const db = require('../db');
const twitch = require('../services/twitch');
const ytBroadcast = require('../services/youtubeBroadcast');
const relay = require('../services/multistreamRelay');

const TWITCH_INGEST = 'rtmp://live.twitch.tv/app';
const YOUTUBE_INGEST = 'rtmp://a.rtmp.youtube.com/live2';

function requireStreamer(req, res, next) {
  if (!req.streamer) return res.redirect('/streamer');
  next();
}

// --- Dashboard pages ---

router.get('/', requireStreamer, (req, res) => {
  const streamer = req.streamer;
  const cfg = db.getMultistreamConfig(streamer.id) || {};
  const token = db.ensureMultistreamToken(streamer.id);
  const fresh = db.getStreamerById(streamer.id);

  res.render('multistream', {
    streamer: fresh,
    multistream: cfg,
    ingestUrl: config.multistream.ingestUrl,
    streamKey: token,
    relayConfigured: config.multistream.enabled,
    twitchAuthorized: !!fresh.broadcaster_access_token,
    twitchHasStreamKeyScope: twitch.hasStreamKeyScope(fresh),
    youtubeConnected: !!fresh.yt_access_token,
    youtubeChannelName: fresh.yt_channel_name || null,
    isLive: !!cfg.multistream_active_broadcast_id,
    query: req.query,
  });
});

router.post('/save', requireStreamer, express.urlencoded({ extended: false }), (req, res) => {
  const { enabled, youtube_privacy, youtube_category_id, youtube_default_title } = req.body;
  db.setMultistreamConfig(req.streamer.id, {
    enabled: !!enabled,
    youtubePrivacy: ['public', 'unlisted', 'private'].includes(youtube_privacy) ? youtube_privacy : 'public',
    youtubeCategoryId: youtube_category_id || '20',
    youtubeDefaultTitle: youtube_default_title?.slice(0, 100) || null,
  });
  res.redirect('/dashboard/multistream?saved=1');
});

router.post('/reset-youtube-stream', requireStreamer, (req, res) => {
  db.clearMultistreamYoutubeStream(req.streamer.id);
  res.redirect('/dashboard/multistream?reset=1');
});

// --- MediaMTX webhooks (called by the relay box, not the streamer) ---

function authenticateWebhook(req, res) {
  if (!config.multistream.webhookSecret) {
    res.status(503).json({ error: 'webhook secret not configured' });
    return false;
  }
  const presented = Buffer.from(req.get('Authorization') || '', 'utf8');
  const expected = Buffer.from(`Bearer ${config.multistream.webhookSecret}`, 'utf8');
  // timingSafeEqual throws on a length mismatch, so compare lengths first —
  // that leaks the secret's length only, never its contents.
  if (presented.length !== expected.length || !crypto.timingSafeEqual(presented, expected)) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

// Validate rather than sanitize. Stripping unexpected characters could silently
// rewrite one streamer's malformed path into another streamer's valid token, so
// anything that isn't already a well-formed token is rejected outright.
// Tokens are base64url from crypto.randomBytes(24) — see db.ensureMultistreamToken.
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

function tokenFromPath(path) {
  const candidate = String(path || '').replace(/^live\//, '');
  return TOKEN_RE.test(candidate) ? candidate : null;
}

router.post('/webhook/on-ready', express.json(), async (req, res) => {
  if (!authenticateWebhook(req, res)) return;

  const path = req.body?.path || '';
  const token = tokenFromPath(path);
  if (!token) return res.status(400).json({ error: 'missing path' });

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
    await relay.addForwardPaths({
      apiUrl: config.multistream.apiUrl,
      apiToken: config.multistream.apiToken,
      sourceToken: token,
      destinations,
    });
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

router.post('/webhook/on-not-ready', express.json(), async (req, res) => {
  if (!authenticateWebhook(req, res)) return;

  const path = req.body?.path || '';
  const token = tokenFromPath(path);
  if (!token) return res.status(400).json({ error: 'missing path' });

  const streamer = db.getStreamerByMultistreamToken(token);
  if (!streamer) return res.status(404).json({ error: 'unknown stream key' });

  try {
    await relay.removeForwardPaths({
      apiUrl: config.multistream.apiUrl,
      apiToken: config.multistream.apiToken,
      sourceToken: token,
      destinationNames: ['twitch', 'youtube'],
    });
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

module.exports = router;
