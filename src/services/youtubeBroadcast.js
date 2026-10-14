// YouTube Live Broadcast lifecycle for the multistream relay.
//
// Each streamer needs:
//   1. ONE reusable liveStream resource (created once, gives us a permanent RTMP key)
//   2. ONE liveBroadcast per session (created on go-live, reused while it is
//      still ready or live, transitioned to complete when the stream has ended)
//
// We persist the streamId on the streamer row so we don't burn quota
// recreating the stream every session.
//
// The broadcast starts by itself (enableAutoStart) once YouTube receives the
// stream, and ends by itself (enableAutoStop) some time after it stops.
// Quota cost per session (when streamer already has a stream):
//   liveStreams.list          1 unit
//   liveBroadcasts.insert     50 units
//   liveBroadcasts.bind       50 units
//   liveBroadcasts.transition 50 units (complete)
//   = about 150 units per session. Default daily quota is 10,000.

const db = require('../db');
const { refreshStreamerYoutubeToken } = require('./youtube');

const API = 'https://www.googleapis.com/youtube/v3';
// A YouTube call that hangs must not hold a go-live (it runs under a lock).
const REQUEST_TIMEOUT_MS = 10_000;
// YouTube's longest broadcast title, in characters.
const TITLE_MAX = 100;

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
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`YouTube API ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// A title YouTube takes: without '<' and '>' (YouTube refuses a title with
// them, and "<3" is common), on one line, at most 100 characters (code points,
// so an emoji is never cut in half).
function sanitizeBroadcastTitle(title, fallback = 'Live Stream') {
  const text = String(title ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, TITLE_MAX).join('').trim() || fallback;
}

// The RTMP key of a liveStream resource. Without one there is nothing to
// forward to (it would make an address ending in "undefined").
function streamKeyOf(liveStream) {
  const key = liveStream && liveStream.cdn && liveStream.cdn.ingestionInfo && liveStream.cdn.ingestionInfo.streamName;
  if (!key) throw new Error('YouTube returned no stream key');
  return key;
}

// Returns { streamId, streamKey } — creates the reusable stream on first call,
// reuses the persisted one thereafter.
async function getOrCreateLiveStream(streamer) {
  const token = await getFreshAccessToken(streamer);
  if (!token) throw new Error('YouTube not connected');

  if (streamer.multistream_youtube_stream_id) {
    // A failed lookup (a timeout, a spent quota) says nothing about the stream,
    // so it is an error, never a reason to make a new stream. Only YouTube
    // answering that it has no such stream is.
    const data = await ytFetch(token, 'GET', `/liveStreams?part=cdn&id=${encodeURIComponent(streamer.multistream_youtube_stream_id)}`);
    const item = data && Array.isArray(data.items) ? data.items[0] : null;
    if (item) return { streamId: item.id, streamKey: streamKeyOf(item) };
    console.warn(`[ytBroadcast] YouTube no longer has the stored stream of streamer ${streamer.id}; making a new one`);
    db.clearMultistreamYoutubeStream(streamer.id);
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

  return { streamId: created.id, streamKey: streamKeyOf(created) };
}

async function createBroadcast(streamer, { title, description, privacyStatus, categoryId, scheduledStartTime }) {
  const token = await getFreshAccessToken(streamer);
  if (!token) throw new Error('YouTube not connected');
  const startISO = scheduledStartTime || new Date(Date.now() + 5_000).toISOString();
  const body = {
    snippet: {
      title: sanitizeBroadcastTitle(title),
      description: (description || '').slice(0, 5000),
      scheduledStartTime: startISO,
      categoryId: categoryId || '20',
    },
    status: {
      privacyStatus: privacyStatus || 'public',
      selfDeclaredMadeForKids: false,
    },
    contentDetails: {
      // YouTube starts it once the stream arrives: no transition call, and no
      // wait that gives up if YouTube is slow to see the stream.
      enableAutoStart: true,
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

// A broadcast's life cycle status ('created', 'ready', 'testing', 'live',
// 'complete', ...), or null when YouTube has no broadcast with that id.
async function getBroadcastStatus(streamer, broadcastId) {
  const token = await getFreshAccessToken(streamer);
  if (!token) throw new Error('YouTube not connected');
  const data = await ytFetch(token, 'GET', `/liveBroadcasts?part=status&id=${encodeURIComponent(broadcastId)}`);
  return data?.items?.[0]?.status?.lifeCycleStatus || null;
}

async function transitionBroadcast(streamer, broadcastId, status) {
  // status = 'testing' | 'live' | 'complete'
  const token = await getFreshAccessToken(streamer);
  if (!token) throw new Error('YouTube not connected');
  return ytFetch(token, 'POST', `/liveBroadcasts/transition?broadcastStatus=${encodeURIComponent(status)}&id=${encodeURIComponent(broadcastId)}&part=id,status`);
}

// Whether YouTube is receiving the stream right now (one check). Used by the
// boot reconciler, which must not block startup waiting on an encoder that may
// never appear.
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

// A restart can leave multistream_active_broadcast_id set: a stream that ended
// during the minute before its broadcast is completed (multistreamSessions.js),
// or a broadcast made before it started by itself (enableAutoStart). Run this on
// boot to start it if the encoder is still pushing, or close it out if it isn't.
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
  sanitizeBroadcastTitle,
  getOrCreateLiveStream,
  createBroadcast,
  bindBroadcastToStream,
  getBroadcastStatus,
  transitionBroadcast,
  isStreamActive,
  reconcileActiveBroadcasts,
};
