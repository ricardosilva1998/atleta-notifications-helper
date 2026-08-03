const config = require('../config');
const db = require('../db');

let accessToken = null;
let tokenExpiresAt = 0;

// In-flight auth promise — multiple concurrent callers should share one fetch.
// Without this, a cold start under load triggers N parallel /oauth2/token
// requests that race and can clobber each other's tokens.
let _authInFlight = null;

// App-level auth (client credentials) — shared across all streamers
async function authenticate() {
  if (_authInFlight) return _authInFlight;
  _authInFlight = (async () => {
    const params = new URLSearchParams({
      client_id: config.twitch.clientId,
      client_secret: config.twitch.clientSecret,
      grant_type: 'client_credentials',
    });

    const res = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: params,
    });

    if (!res.ok) {
      throw new Error(`Twitch auth failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    accessToken = data.access_token;
    tokenExpiresAt = Date.now() + data.expires_in * 1000 - 60_000;
  })().finally(() => { _authInFlight = null; });
  return _authInFlight;
}

async function apiCall(endpoint) {
  if (!accessToken || Date.now() >= tokenExpiresAt) {
    await authenticate();
  }

  const res = await fetch(`https://api.twitch.tv/helix${endpoint}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': config.twitch.clientId,
    },
  });

  if (res.status === 401) {
    await authenticate();
    return apiCall(endpoint);
  }

  if (!res.ok) {
    throw new Error(`Twitch API error: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

async function getStream(username) {
  const data = await apiCall(`/streams?user_login=${encodeURIComponent(username)}`);
  return data.data?.[0] || null;
}

async function getUserId(username) {
  const data = await apiCall(`/users?login=${encodeURIComponent(username)}`);
  return data.data?.[0]?.id || null;
}

async function getUserProfile(username) {
  const data = await apiCall(`/users?login=${encodeURIComponent(username)}`);
  const user = data.data?.[0];
  if (!user) return null;
  return { id: user.id, login: user.login, display_name: user.display_name, profile_image_url: user.profile_image_url };
}

async function getUserInfo(username) {
  const data = await apiCall(`/users?login=${encodeURIComponent(username)}`);
  const user = data.data?.[0];
  if (!user) return null;
  return { id: user.id, login: user.login, display_name: user.display_name, created_at: user.created_at };
}

async function getClips(broadcasterId, startedAt, endedAt) {
  const params = new URLSearchParams({
    broadcaster_id: broadcasterId,
    started_at: startedAt,
    first: '10',
  });
  if (endedAt) params.set('ended_at', endedAt);
  const data = await apiCall(`/clips?${params}`);
  return data.data || [];
}

async function getSubscribers(broadcasterId, broadcasterAccessToken) {
  const subs = [];
  let cursor = null;

  do {
    const params = new URLSearchParams({
      broadcaster_id: broadcasterId,
      first: '100',
    });
    if (cursor) params.set('after', cursor);

    const res = await fetch(`https://api.twitch.tv/helix/subscriptions?${params}`, {
      headers: {
        Authorization: `Bearer ${broadcasterAccessToken}`,
        'Client-Id': config.twitch.clientId,
      },
    });

    if (!res.ok) {
      throw new Error(`Subscriptions API error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    subs.push(...data.data);
    cursor = data.pagination?.cursor || null;
  } while (cursor);

  return subs;
}

async function getVideos(broadcasterId, startedAfter) {
  const params = new URLSearchParams({
    user_id: broadcasterId,
    type: 'archive',
    first: '20',
  });
  const data = await apiCall(`/videos?${params}`);
  const videos = data.data || [];
  if (startedAfter) {
    return videos.filter((v) => v.created_at >= startedAfter);
  }
  return videos;
}

async function getFollowerCount(broadcasterId, broadcasterAccessToken) {
  const params = new URLSearchParams({
    broadcaster_id: broadcasterId,
    first: '1',
  });

  const res = await fetch(`https://api.twitch.tv/helix/channels/followers?${params}`, {
    headers: {
      Authorization: `Bearer ${broadcasterAccessToken}`,
      'Client-Id': config.twitch.clientId,
    },
  });

  if (!res.ok) {
    throw new Error(`Followers API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.total || 0;
}

async function getGameNames(gameIds) {
  if (!gameIds || gameIds.length === 0) return [];
  const params = new URLSearchParams();
  for (const id of gameIds) {
    params.append('id', id);
  }
  const data = await apiCall(`/games?${params}`);
  return (data.data || []).map((g) => g.name);
}

// Throws with err.code = 'INVALID_REFRESH_TOKEN' when the grant is permanently
// dead (Twitch answers 400 after the streamer disconnects the app, changes
// their password, or revokes access). Callers must treat that as terminal —
// retrying can never succeed and just hammers id.twitch.tv with a bad grant on
// the shared client id. Every other failure stays transient and retryable.
async function refreshBroadcasterToken(streamer) {
  if (!streamer.broadcaster_refresh_token) {
    const err = new Error('No broadcaster refresh token');
    err.code = 'INVALID_REFRESH_TOKEN';
    throw err;
  }

  const params = new URLSearchParams({
    client_id: config.twitch.clientId,
    client_secret: config.twitch.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: streamer.broadcaster_refresh_token,
  });

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: params,
  });

  if (!res.ok) {
    const err = new Error(`Token refresh failed: ${res.status}`);
    if (res.status === 400) err.code = 'INVALID_REFRESH_TOKEN';
    throw err;
  }

  const data = await res.json();
  db.updateStreamerBroadcasterTokens(
    streamer.id,
    data.access_token,
    data.refresh_token,
    Date.now() + data.expires_in * 1000 - 60_000
  );

  return data.access_token;
}

async function refreshBotToken(streamer) {
  if (!streamer.bot_refresh_token) throw new Error('No bot refresh token');

  const params = new URLSearchParams({
    client_id: config.twitch.clientId,
    client_secret: config.twitch.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: streamer.bot_refresh_token,
  });

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: params,
  });

  if (!res.ok) throw new Error(`Bot token refresh failed: ${res.status}`);

  const data = await res.json();
  db.updateBotTokens(
    streamer.id,
    data.access_token,
    data.refresh_token,
    Date.now() + data.expires_in * 1000 - 60_000,
    streamer.bot_username
  );

  return data.access_token;
}

async function getFollowAge(broadcasterLogin, userLogin) {
  try {
    const token = await (async () => {
      if (!accessToken || Date.now() >= tokenExpiresAt) await authenticate();
      return accessToken;
    })();
    const broadcasterId = await getUserId(broadcasterLogin);
    const userId = await getUserId(userLogin);
    if (!broadcasterId || !userId) return { following: false, followedAt: null };

    const res = await fetch(
      `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}&user_id=${userId}`,
      { headers: { 'Client-ID': config.twitch.clientId, 'Authorization': `Bearer ${token}` } }
    );
    const data = await res.json();
    if (data.data && data.data.length > 0) {
      return { following: true, followedAt: data.data[0].followed_at };
    }
    return { following: false, followedAt: null };
  } catch (e) {
    console.error('[Twitch] getFollowAge error:', e.message);
    return { following: false, followedAt: null };
  }
}

function hasRedemptionScope(streamer) {
  return (streamer.broadcaster_scopes || '').split(' ').includes('channel:manage:redemptions');
}

function hasStreamKeyScope(streamer) {
  return (streamer.broadcaster_scopes || '').split(' ').includes('channel:read:stream_key');
}

// Scopes the overlay's core alerts depend on. A streamer missing any of them
// either never finished broadcaster auth, or had their scopes cleared after the
// refresh token died — see refreshBroadcasterToken's INVALID_REFRESH_TOKEN path.
const REQUIRED_BROADCASTER_SCOPES = ['moderator:read:followers', 'bits:read'];

function needsBroadcasterReauth(streamer) {
  if (!streamer) return false;
  const scopes = (streamer.broadcaster_scopes || '').split(' ');
  return REQUIRED_BROADCASTER_SCOPES.some((scope) => !scopes.includes(scope));
}

// Fetch the broadcaster's RTMP stream key. Requires the channel:read:stream_key scope.
// Auto-refreshes the broadcaster token if expired.
async function getStreamKey(streamer) {
  if (!streamer.twitch_user_id) throw new Error('Twitch not linked');
  if (!streamer.broadcaster_access_token) throw new Error('Broadcaster not authorized');
  if (!hasStreamKeyScope(streamer)) {
    throw new Error('Missing channel:read:stream_key scope — re-authorize broadcaster');
  }

  let token = streamer.broadcaster_access_token;
  if (streamer.broadcaster_token_expires_at && Date.now() >= streamer.broadcaster_token_expires_at) {
    token = await refreshBroadcasterToken(streamer);
  }

  const doFetch = async (bearer) => fetch(
    `https://api.twitch.tv/helix/streams/key?broadcaster_id=${encodeURIComponent(streamer.twitch_user_id)}`,
    { headers: { Authorization: `Bearer ${bearer}`, 'Client-Id': config.twitch.clientId } }
  );

  let res = await doFetch(token);
  if (res.status === 401) {
    token = await refreshBroadcasterToken(streamer);
    res = await doFetch(token);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Twitch streams/key failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  const key = data.data?.[0]?.stream_key;
  if (!key) throw new Error('Twitch returned no stream key');
  return key;
}

module.exports = { getStream, getUserId, getUserProfile, getUserInfo, getClips, getSubscribers, getVideos, getFollowerCount, getGameNames, refreshBroadcasterToken, refreshBotToken, getFollowAge, hasRedemptionScope, hasStreamKeyScope, getStreamKey, needsBroadcasterReauth };
