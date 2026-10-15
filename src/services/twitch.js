const config = require('../config');
const db = require('../db');

let accessToken = null;
let tokenExpiresAt = 0;

// A slow Twitch response must not hang a poller or a page indefinitely.
const HELIX_TIMEOUT_MS = 10_000;

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

    // The pollers call this on a cold start and on every 401: a token endpoint
    // that never answers must not hold every one of them.
    const res = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: params,
      signal: AbortSignal.timeout(HELIX_TIMEOUT_MS),
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

function helixFetch(endpoint, signal) {
  return fetch(`https://api.twitch.tv/helix${endpoint}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': config.twitch.clientId,
    },
    signal: signal || AbortSignal.timeout(HELIX_TIMEOUT_MS),
  });
}

// Settles like `promise`, but rejects as soon as `signal` aborts. A caller with a
// short deadline uses it to stop waiting on a token request that others share.
function untilAborted(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); }
    );
  });
}

// `signal` (optional): a page that has to answer quickly passes its own deadline,
// for example AbortSignal.timeout(3000). One signal can cover several calls, so
// they share a single deadline. It replaces the default 10 s timeout of the
// Helix request and also ends the wait for a token request.
async function apiCall(endpoint, { signal } = {}) {
  if (!accessToken || Date.now() >= tokenExpiresAt) {
    await untilAborted(authenticate(), signal);
  }

  let res = await helixFetch(endpoint, signal);

  // A 401 usually means the app token was revoked before it expired: get a
  // fresh one and retry once. If Twitch rejects the fresh token too, throw
  // below instead of looping on the token endpoint.
  if (res.status === 401) {
    await untilAborted(authenticate(), signal);
    res = await helixFetch(endpoint, signal);
  }

  if (!res.ok) {
    throw new Error(`Twitch API error: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

// The getters below that take `options` pass it on to apiCall ({ signal }).
async function getStream(username, options) {
  const data = await apiCall(`/streams?user_login=${encodeURIComponent(username)}`, options);
  return data.data?.[0] || null;
}

// Helix answers /streams with at most 100 streams per page, and takes 100
// logins per request: one request covers a whole batch of channels.
const STREAMS_PER_REQUEST = 100;

// Which of these channels (at most STREAMS_PER_REQUEST logins) are live right
// now: a Map of lowercase login -> stream. A channel that is offline, banned or
// unknown has no entry. A failed request throws: it must never be read as "all
// of these channels are offline".
async function getStreams(logins, options) {
  if (logins.length === 0) return new Map();
  if (logins.length > STREAMS_PER_REQUEST) {
    throw new RangeError(`Twitch /streams takes at most ${STREAMS_PER_REQUEST} logins per request, got ${logins.length}`);
  }
  const params = new URLSearchParams();
  for (const login of logins) params.append('user_login', login);
  params.set('first', String(STREAMS_PER_REQUEST));
  const data = await apiCall(`/streams?${params}`, options);

  const streams = new Map();
  for (const stream of data.data || []) {
    if (stream && stream.user_login) streams.set(String(stream.user_login).toLowerCase(), stream);
  }
  return streams;
}

// The title the channel is set to (Helix GET /channels), or null. Unlike a
// stream's title it is there whether or not the channel is live.
async function getChannelTitle(broadcasterId, options) {
  const data = await apiCall(`/channels?broadcaster_id=${encodeURIComponent(broadcasterId)}`, options);
  const title = data.data?.[0]?.title;
  return typeof title === 'string' && title.trim() ? title : null;
}

// A channel's category (its last game) and title (Helix GET /channels, app token), whether or not it is live; null
// when Twitch has no such channel. The shoutouts fill {game} and {title} with them.
async function getChannelInfo(broadcasterId, options) {
  const data = await apiCall(`/channels?broadcaster_id=${encodeURIComponent(broadcasterId)}`, options);
  const channel = data.data?.[0];
  if (!channel) return null;
  return {
    gameName: typeof channel.game_name === 'string' ? channel.game_name : '',
    title: typeof channel.title === 'string' ? channel.title : '',
  };
}

async function getUserId(username, options) {
  const data = await apiCall(`/users?login=${encodeURIComponent(username)}`, options);
  return data.data?.[0]?.id || null;
}

async function getUserProfile(username, options) {
  const data = await apiCall(`/users?login=${encodeURIComponent(username)}`, options);
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
      signal: AbortSignal.timeout(HELIX_TIMEOUT_MS),
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

// How many people subscribe to the channel: Twitch states the total on every
// page, so a single one-entry page answers it. Reading the whole list for a
// count (getSubscribers) is one request per hundred subscribers.
async function getSubscriberCount(broadcasterId, broadcasterAccessToken) {
  const params = new URLSearchParams({ broadcaster_id: broadcasterId, first: '1' });

  const res = await fetch(`https://api.twitch.tv/helix/subscriptions?${params}`, {
    headers: {
      Authorization: `Bearer ${broadcasterAccessToken}`,
      'Client-Id': config.twitch.clientId,
    },
    signal: AbortSignal.timeout(HELIX_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Subscriptions API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.total || 0;
}

async function getVideos(broadcasterId, startedAfter, options) {
  const params = new URLSearchParams({
    user_id: broadcasterId,
    type: 'archive',
    first: '20',
  });
  const data = await apiCall(`/videos?${params}`, options);
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
    signal: AbortSignal.timeout(HELIX_TIMEOUT_MS),
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
    signal: AbortSignal.timeout(HELIX_TIMEOUT_MS),
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

const FOLLOWERS_SCOPE = 'moderator:read:followers';

function hasBroadcasterScope(streamer, scope) {
  return (streamer.broadcaster_scopes || '').split(' ').includes(scope);
}

// One broadcaster-token refresh at a time per streamer for the follow checks:
// the follow-age filter can look up several chatters at the same moment.
const followTokenRefreshes = new Map(); // streamerId -> pending refresh (removed when it settles)

function refreshFollowToken(streamer) {
  let pending = followTokenRefreshes.get(streamer.id);
  if (!pending) {
    pending = refreshBroadcasterToken(streamer)
      .catch((err) => {
        // A dead grant never recovers: clear the scopes (as EventSub and the sub
        // sync do), so the dashboard asks for re-authorization and later checks
        // stop before asking Twitch again.
        if (err.code === 'INVALID_REFRESH_TOKEN') {
          db.clearStreamerBroadcasterScopes(streamer.id);
          console.warn(`[Twitch] Broadcaster token of streamer ${streamer.id} is permanently invalid; cleared scopes, re-authorization required`);
        }
        throw err;
      })
      .finally(() => followTokenRefreshes.delete(streamer.id));
    followTokenRefreshes.set(streamer.id, pending);
  }
  return pending;
}

// Whether a viewer (Twitch user id) follows the streamer's channel, and since
// when: { following: true, followedAt } or { following: false, followedAt: null }.
// Twitch only tells a user token of the broadcaster (or a moderator) with
// moderator:read:followers, so this uses the streamer's broadcaster token,
// refreshed once if Twitch says it expired. (It used the app token, which
// always got an error, and an error read as "not following".) Any failure
// throws: a caller must never take an error for "not following".
async function getFollowAge(streamer, userId) {
  if (!streamer || !streamer.twitch_user_id || !userId) {
    throw new Error('A follow check needs the channel and the viewer');
  }
  if (!streamer.broadcaster_access_token || !hasBroadcasterScope(streamer, FOLLOWERS_SCOPE)) {
    const err = new Error(`The broadcaster token cannot read followers (needs ${FOLLOWERS_SCOPE})`);
    err.code = 'NO_FOLLOWER_ACCESS';
    throw err;
  }

  const params = new URLSearchParams({ broadcaster_id: streamer.twitch_user_id, user_id: String(userId) });
  const ask = (token) => fetch(`https://api.twitch.tv/helix/channels/followers?${params}`, {
    headers: { Authorization: `Bearer ${token}`, 'Client-Id': config.twitch.clientId },
    signal: AbortSignal.timeout(HELIX_TIMEOUT_MS),
  });

  let token = streamer.broadcaster_access_token;
  if (streamer.broadcaster_token_expires_at && Date.now() >= streamer.broadcaster_token_expires_at) {
    token = await refreshFollowToken(streamer);
  }
  let res = await ask(token);
  if (res.status === 401) {
    token = await refreshFollowToken(streamer);
    res = await ask(token);
  }
  if (!res.ok) throw new Error(`Followers API error: ${res.status}`);

  const data = await res.json();
  const follow = Array.isArray(data && data.data) ? data.data[0] : null;
  return follow ? { following: true, followedAt: follow.followed_at || null } : { following: false, followedAt: null };
}

function hasRedemptionScope(streamer) {
  return (streamer.broadcaster_scopes || '').split(' ').includes('channel:manage:redemptions');
}

function hasStreamKeyScope(streamer) {
  return (streamer.broadcaster_scopes || '').split(' ').includes('channel:read:stream_key');
}

// The Polls & predictions card needs both permissions; a connection made before they were asked for has neither (the
// card then asks for one reconnect, and EventSub skips the poll and prediction events).
function hasPollsScope(streamer) {
  const scopes = ((streamer && streamer.broadcaster_scopes) || '').split(' ');
  return scopes.includes('channel:manage:polls') && scopes.includes('channel:manage:predictions');
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
    { headers: { Authorization: `Bearer ${bearer}`, 'Client-Id': config.twitch.clientId }, signal: AbortSignal.timeout(HELIX_TIMEOUT_MS) }
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

module.exports = { getStream, getStreams, STREAMS_PER_REQUEST, getChannelTitle, getChannelInfo, getUserId, getUserProfile, getUserInfo, getClips, getSubscribers, getSubscriberCount, getVideos, getFollowerCount, getGameNames, refreshBroadcasterToken, refreshBotToken, getFollowAge, hasRedemptionScope, hasStreamKeyScope, hasPollsScope, getStreamKey, needsBroadcasterReauth };
