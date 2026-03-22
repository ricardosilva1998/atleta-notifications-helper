const config = require('../config');

let accessToken = null;
let tokenExpiresAt = 0;

async function authenticate() {
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
  tokenExpiresAt = Date.now() + data.expires_in * 1000 - 60_000; // refresh 1min early
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

async function getClips(broadcasterId, startedAt) {
  const params = new URLSearchParams({
    broadcaster_id: broadcasterId,
    started_at: startedAt,
    first: '10',
  });
  const data = await apiCall(`/clips?${params}`);
  return data.data || [];
}

module.exports = { getStream, getUserId, getClips };
