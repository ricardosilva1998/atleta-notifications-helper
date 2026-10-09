// YouTube Live Broadcast lifecycle for the multistream relay.
//
// Each streamer needs:
//   1. ONE reusable liveStream resource (created once, gives us a permanent RTMP key)
//   2. ONE liveBroadcast per session (created on go-live, transitioned to complete on stop)
//
// We persist the streamId + key on the streamer row so we don't burn quota
// recreating the stream every session.
//
// Quota cost per session (when streamer already has a stream):
//   liveBroadcasts.insert     50 units
//   liveBroadcasts.bind       50 units
//   liveBroadcasts.transition 50 units (live)
//   liveBroadcasts.transition 50 units (complete)
//   = 200 units per session. Default daily quota is 10,000.

const db = require('../db');
const { refreshStreamerYoutubeToken } = require('./youtube');

const API = 'https://www.googleapis.com/youtube/v3';

async function getFreshAccessToken(streamer) {
  if (!streamer.yt_access_token) return null;
  if (streamer.yt_token_expires_at && Date.now() >= streamer.yt_token_expires_at) {
    return refreshStreamerYoutubeToken(streamer);
  }
  return streamer.yt_access_token;
}

async function ytFetch(token, method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`YouTube API ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Returns { streamId, streamKey } — creates the reusable stream on first call,
// reuses the persisted one thereafter.
async function getOrCreateLiveStream(streamer) {
  const token = await getFreshAccessToken(streamer);
  if (!token) throw new Error('YouTube not connected');

  if (streamer.multistream_youtube_stream_id) {
    try {
      const data = await ytFetch(token, 'GET', `/liveStreams?part=snippet,cdn&id=${streamer.multistream_youtube_stream_id}`);
      if (data.items && data.items.length > 0) {
        const item = data.items[0];
        return {
          streamId: item.id,
          streamKey: item.cdn?.ingestionInfo?.streamName,
        };
      }
    } catch (e) {
      console.warn('[ytBroadcast] persisted stream lookup failed, recreating:', e.message);
      db.clearMultistreamYoutubeStream(streamer.id);
    }
  }

  const created = await ytFetch(token, 'POST', '/liveStreams?part=snippet,cdn,contentDetails', {
    snippet: { title: 'Atleta Multistream' },
    cdn: {
      format: '1080p',
      ingestionType: 'rtmp',
      frameRate: '60fps',
      resolution: '1080p',
    },
    contentDetails: { isReusable: true },
  });

  return {
    streamId: created.id,
    streamKey: created.cdn?.ingestionInfo?.streamName,
  };
}

async function createBroadcast(streamer, { title, description, privacyStatus, categoryId, scheduledStartTime }) {
  const token = await getFreshAccessToken(streamer);
  if (!token) throw new Error('YouTube not connected');
  const startISO = scheduledStartTime || new Date(Date.now() + 5_000).toISOString();
  const body = {
    snippet: {
      title: (title || 'Live Stream').slice(0, 100),
      description: (description || '').slice(0, 5000),
      scheduledStartTime: startISO,
      categoryId: categoryId || '20',
    },
    status: {
      privacyStatus: privacyStatus || 'public',
      selfDeclaredMadeForKids: false,
    },
    contentDetails: {
      enableAutoStart: false,
      enableAutoStop: true,
      enableDvr: true,
      recordFromStart: true,
    },
  };
  const created = await ytFetch(token, 'POST', '/liveBroadcasts?part=snippet,status,contentDetails', body);
  return created.id;
}

async function bindBroadcastToStream(streamer, broadcastId, streamId) {
  const token = await getFreshAccessToken(streamer);
  if (!token) throw new Error('YouTube not connected');
  return ytFetch(token, 'POST', `/liveBroadcasts/bind?id=${encodeURIComponent(broadcastId)}&streamId=${encodeURIComponent(streamId)}&part=id`);
}

async function transitionBroadcast(streamer, broadcastId, status) {
  // status = 'testing' | 'live' | 'complete'
  const token = await getFreshAccessToken(streamer);
  if (!token) throw new Error('YouTube not connected');
  return ytFetch(token, 'POST', `/liveBroadcasts/transition?broadcastStatus=${encodeURIComponent(status)}&id=${encodeURIComponent(broadcastId)}&part=id,status`);
}

// Wait for YouTube to detect the incoming RTMP feed before transitioning to live.
// Without this wait, transition→live often fails with "redundantTransition" or
// "errorStreamInactive" because YouTube hasn't seen bytes yet.
async function waitForStreamActive(streamer, streamId, timeoutMs = 30_000) {
  const token = await getFreshAccessToken(streamer);
  if (!token) throw new Error('YouTube not connected');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const data = await ytFetch(token, 'GET', `/liveStreams?part=status&id=${encodeURIComponent(streamId)}`);
      const status = data.items?.[0]?.status?.streamStatus;
      if (status === 'active') return true;
    } catch (e) {
      console.warn('[ytBroadcast] waitForStreamActive poll error:', e.message);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

// Single-shot version of the poll above — used by the boot reconciler, which
// must not block startup waiting on an encoder that may never appear.
async function isStreamActive(streamer, streamId) {
  const token = await getFreshAccessToken(streamer);
  if (!token) return false;
  try {
    const data = await ytFetch(token, 'GET', `/liveStreams?part=status&id=${encodeURIComponent(streamId)}`);
    return data.items?.[0]?.status?.streamStatus === 'active';
  } catch (e) {
    console.warn('[ytBroadcast] isStreamActive check failed:', e.message);
    return false;
  }
}

// The go-live flow transitions a broadcast to live *after* answering MediaMTX's
// webhook, so a deploy or crash in that window strands the broadcast in 'ready'
// with multistream_active_broadcast_id still set. Run this on boot to finish the
// transition if the encoder is still pushing, or close it out if it isn't.
async function reconcileActiveBroadcasts() {
  let rows = [];
  try {
    rows = db.getStreamersWithActiveMultistreamBroadcast();
  } catch (e) {
    console.error('[ytBroadcast] reconcile lookup failed:', e.message);
    return;
  }
  if (rows.length === 0) return;

  console.log(`[ytBroadcast] reconciling ${rows.length} in-flight broadcast(s)`);

  for (const streamer of rows) {
    const broadcastId = streamer.multistream_active_broadcast_id;
    try {
      const token = await getFreshAccessToken(streamer);
      if (!token) {
        db.setMultistreamActiveBroadcast(streamer.id, null);
        continue;
      }

      const data = await ytFetch(token, 'GET', `/liveBroadcasts?part=status&id=${encodeURIComponent(broadcastId)}`);
      const lifeCycle = data.items?.[0]?.status?.lifeCycleStatus;

      // Gone, already finished, or revoked — just drop our pointer.
      if (!lifeCycle || lifeCycle === 'complete' || lifeCycle === 'revoked') {
        db.setMultistreamActiveBroadcast(streamer.id, null);
        console.log(`[ytBroadcast] cleared stale broadcast ${broadcastId} for streamer ${streamer.id} (${lifeCycle || 'not found'})`);
        continue;
      }

      // Already live — the restart cost us nothing.
      if (lifeCycle === 'live') continue;

      const stillPushing = streamer.multistream_youtube_stream_id
        ? await isStreamActive(streamer, streamer.multistream_youtube_stream_id)
        : false;

      if (stillPushing) {
        await transitionBroadcast(streamer, broadcastId, 'live');
        console.log(`[ytBroadcast] resumed broadcast ${broadcastId} -> live for streamer ${streamer.id}`);
      } else {
        await transitionBroadcast(streamer, broadcastId, 'complete').catch((e) => {
          console.warn(`[ytBroadcast] could not complete ${broadcastId}:`, e.message);
        });
        db.setMultistreamActiveBroadcast(streamer.id, null);
        console.log(`[ytBroadcast] encoder gone — closed broadcast ${broadcastId} for streamer ${streamer.id}`);
      }
    } catch (err) {
      console.error(`[ytBroadcast] reconcile failed for streamer ${streamer.id}:`, err.message);
    }
  }
}

module.exports = {
  getOrCreateLiveStream,
  createBroadcast,
  bindBroadcastToStream,
  transitionBroadcast,
  waitForStreamActive,
  isStreamActive,
  reconcileActiveBroadcasts,
};
