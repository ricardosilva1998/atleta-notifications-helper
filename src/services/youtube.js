const { XMLParser } = require('fast-xml-parser');
const config = require('../config');
const { chunk } = require('./chunk');

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

// How long the calls below wait for YouTube when the caller gives no deadline.
// A page that has to answer quickly passes its own `signal` in `options`
// (for example AbortSignal.timeout(3000)); it replaces this timeout.
const YOUTUBE_TIMEOUT_MS = 10_000;
const deadline = (options) => (options && options.signal) || AbortSignal.timeout(YOUTUBE_TIMEOUT_MS);

// videos.list takes 50 ids per request and costs one quota unit per request,
// however many ids it carries.
const VIDEOS_PER_REQUEST = 50;

// A video this long or shorter counts as a Short (Shorts may last up to three
// minutes). The duration is all the API says about it.
const SHORTS_MAX_SECONDS = 180;

// --- Quota ---

// When YouTube says the day's quota is used up, every call keeps failing until
// it resets. The pollers pause YouTube for an hour instead of asking again every
// few minutes.
const QUOTA_BACKOFF_MS = 60 * 60 * 1000;
let quotaBackoffUntil = 0;

function quotaBackoffActive(now = Date.now()) {
  return now < quotaBackoffUntil;
}

function noteQuotaExceeded(now = Date.now()) {
  if (quotaBackoffActive(now)) return;
  quotaBackoffUntil = now + QUOTA_BACKOFF_MS;
  console.error('[YouTube] API quota exceeded - pausing YouTube polling for 1 hour');
}

// YouTube reports an exhausted quota as a 403 whose error reason is quotaExceeded
// (dailyLimitExceeded when a daily cap was set on the key), not as a bad request.
function isQuotaExceeded(status, bodyText) {
  if (status !== 403) return false;
  try {
    const errors = JSON.parse(bodyText).error.errors || [];
    return errors.some((e) => e && (e.reason === 'quotaExceeded' || e.reason === 'dailyLimitExceeded'));
  } catch (e) {
    return false;
  }
}

// One videos.list request for at most VIDEOS_PER_REQUEST ids: the items YouTube
// returned. Throws on a failure; an exhausted quota starts the pause and throws
// an error with code QUOTA_EXCEEDED.
async function listVideos(ids, part, apiKey, options) {
  const params = new URLSearchParams({ part, id: ids.join(','), key: apiKey });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, { signal: deadline(options) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (isQuotaExceeded(res.status, body)) {
      noteQuotaExceeded();
      const error = new Error('YouTube API quota exceeded');
      error.code = 'QUOTA_EXCEEDED';
      throw error;
    }
    throw new Error(`YouTube API error: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.items || [];
}

async function getLatestVideos(youtubeChannelId, options) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${youtubeChannelId}`;
  const res = await fetch(url, { signal: deadline(options) });

  if (!res.ok) {
    throw new Error(`YouTube RSS fetch failed: ${res.status}`);
  }

  const xml = await res.text();
  const parsed = parser.parse(xml);
  const entries = parsed.feed?.entry;

  if (!entries) return [];

  const items = Array.isArray(entries) ? entries : [entries];
  return items.map((entry) => ({
    id: entry['yt:videoId'],
    title: entry.title,
    url: entry.link?.['@_href'] || `https://www.youtube.com/watch?v=${entry['yt:videoId']}`,
    published: entry.published,
    author: entry.author?.name,
  }));
}

// Which of these videos are on air right now: { live, failed }. `live` is a Map
// of video id -> { id, title, description, thumbnail, liveChatId }. The ids go
// to YouTube 50 per request, so the videos of many channels cost a handful of
// requests. `failed` holds the ids of requests that failed: their state is
// unknown, which is not the same as "not live". An exhausted quota ends the
// lookup and is thrown (error code QUOTA_EXCEEDED).
async function getLiveVideos(videoIds, apiKey, options) {
  const live = new Map();
  const failed = new Set();
  if (!apiKey) return { live, failed };

  for (const ids of chunk([...new Set(videoIds)], VIDEOS_PER_REQUEST)) {
    let items;
    try {
      items = await listVideos(ids, 'liveStreamingDetails,snippet', apiKey, options);
    } catch (error) {
      if (error.code === 'QUOTA_EXCEEDED') throw error;
      console.error(`[YouTube] Could not check ${ids.length} video(s) for a live broadcast: ${error.message}`);
      for (const id of ids) failed.add(id);
      continue;
    }
    for (const video of items) {
      const details = video.liveStreamingDetails;
      if (details?.actualStartTime && !details.actualEndTime) {
        live.set(video.id, {
          id: video.id,
          title: video.snippet.title,
          description: video.snippet.description,
          thumbnail:
            video.snippet.thumbnails?.maxres?.url ||
            video.snippet.thumbnails?.high?.url ||
            `https://i.ytimg.com/vi/${video.id}/maxresdefault.jpg`,
          liveChatId: details.activeLiveChatId || null,
        });
      }
    }
  }
  return { live, failed };
}

// ISO 8601 duration (PT1M30S, PT59S, P1DT2H) in seconds; 0 when it is missing or unreadable.
function parseIsoDuration(duration) {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(duration || ''));
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match;
  return (Number(days || 0) * 24 + Number(hours || 0)) * 3600 + Number(minutes || 0) * 60 + Number(seconds || 0);
}

function isShortDuration(seconds) {
  return seconds > 0 && seconds <= SHORTS_MAX_SECONDS;
}

// What YouTube says about these videos: { [id]: { duration, isShort, isLiveOrUpcoming } }.
// A video it does not list has no entry. A failed request throws, so the caller
// can tell "no details" from "nothing special about these videos".
async function getVideoDetails(videoIds, apiKey, options) {
  const details = {};
  if (!videoIds.length || !apiKey) return details;

  for (const ids of chunk([...new Set(videoIds)], VIDEOS_PER_REQUEST)) {
    for (const item of await listVideos(ids, 'contentDetails,liveStreamingDetails', apiKey, options)) {
      const seconds = parseIsoDuration(item.contentDetails?.duration);
      const broadcast = item.liveStreamingDetails;
      details[item.id] = {
        duration: seconds,
        isShort: isShortDuration(seconds),
        // On air now, or announced and not begun: the live poller's, not an upload.
        isLiveOrUpcoming: Boolean(broadcast) && !broadcast.actualEndTime,
      };
    }
  }
  return details;
}

function parseChannelPage(html) {
  // Extract channel ID
  const canonicalMatch = html.match(/https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/);
  const channelId = canonicalMatch?.[1] || null;

  // Extract channel name from <title>
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const channelName = titleMatch?.[1]?.replace(' - YouTube', '').trim() || null;

  // Extract profile image from og:image or JSON-LD
  let profileImageUrl = null;
  const ogImageMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (ogImageMatch) {
    profileImageUrl = ogImageMatch[1];
  }

  return { channelId, channelName, profileImageUrl };
}

async function fetchChannelPage(url, options) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Bot/1.0)' },
      redirect: 'follow',
      signal: deadline(options),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    console.error(`[YouTube] Failed to fetch ${url}: ${e.message}`);
    return null;
  }
}

async function resolveChannelId(input) {
  // If already a channel ID (starts with UC), fetch the channel page for name + image
  if (input.startsWith('UC') && input.length >= 20) {
    const html = await fetchChannelPage(`https://www.youtube.com/channel/${input}`);
    if (html) {
      const info = parseChannelPage(html);
      return { channelId: input, channelName: info.channelName, profileImageUrl: info.profileImageUrl };
    }
    return { channelId: input, channelName: null, profileImageUrl: null };
  }

  // Strip @ if present
  const handle = input.startsWith('@') ? input : `@${input}`;
  const html = await fetchChannelPage(`https://www.youtube.com/${handle}`);
  if (!html) return null;

  const info = parseChannelPage(html);
  if (!info.channelId) return null;

  return { channelId: info.channelId, channelName: info.channelName, profileImageUrl: info.profileImageUrl };
}

async function getChannelInfo(channelId, options) {
  const html = await fetchChannelPage(`https://www.youtube.com/channel/${channelId}`, options);
  if (!html) return null;
  return parseChannelPage(html);
}

async function getLiveChatId(videoId, apiKey, options) {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}&key=${apiKey}`, { signal: deadline(options) });
  if (!res.ok) return null;
  const data = await res.json();
  return data.items?.[0]?.liveStreamingDetails?.activeLiveChatId || null;
}

// A failed refresh is the same every time it is tried, and the chat polling asks
// every 30 seconds: say so once in a while, not on every attempt.
const BOT_TOKEN_FAILURE_LOG_MS = 10 * 60 * 1000;
let lastBotTokenFailure = { message: null, at: 0 };

function logBotTokenFailure(message, now = Date.now()) {
  if (message === lastBotTokenFailure.message && now - lastBotTokenFailure.at < BOT_TOKEN_FAILURE_LOG_MS) return;
  lastBotTokenFailure = { message, at: now };
  console.error(`[YouTube] ${message}`);
}

// What Google's token endpoint said about a refusal, without anything secret.
async function describeTokenRefusal(res) {
  try {
    const body = await res.json();
    const reason = [body.error, body.error_description].filter(Boolean).join(': ');
    // The usual cause, and one only the owner can fix.
    const hint = body.error === 'invalid_grant' ? ' - the refresh token was revoked or has expired; create a new YOUTUBE_BOT_REFRESH_TOKEN' : '';
    return `${reason}${hint}`;
  } catch (e) {
    return 'no details';
  }
}

// Exchanges the bot's refresh token for an access token, which lasts about an
// hour: { accessToken, expiresAt } (epoch ms, with a minute to spare), or null
// when YouTube chat is not set up, or when the exchange fails (logged). Never throws.
async function requestYoutubeBotToken(options) {
  const { botRefreshToken, botClientId, botClientSecret } = config.youtube;
  if (!botRefreshToken || !botClientId || !botClientSecret) return null;

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: botClientId,
        client_secret: botClientSecret,
        refresh_token: botRefreshToken,
        grant_type: 'refresh_token',
      }),
      signal: deadline(options),
    });

    if (!res.ok) {
      logBotTokenFailure(`Bot token refresh failed (${res.status}): ${await describeTokenRefusal(res)}`);
      return null;
    }
    const data = await res.json();
    if (!data.access_token) {
      logBotTokenFailure('Bot token refresh failed: the answer holds no access token');
      return null;
    }
    return { accessToken: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60_000 };
  } catch (error) {
    logBotTokenFailure(`Bot token refresh failed: ${error.message}`);
    return null;
  }
}

async function refreshYoutubeBotToken(options) {
  const token = await requestYoutubeBotToken(options);
  return token ? token.accessToken : null;
}

async function sendYoutubeChatMessage(liveChatId, message, accessToken) {
  let res;
  try {
    res = await fetch('https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        snippet: {
          liveChatId,
          type: 'textMessageEvent',
          textMessageDetails: { messageText: message },
        },
      }),
      signal: deadline(),
    });
  } catch (error) {
    // The callers send and move on, with nobody to catch a rejection: log it, as the non-OK answer below is.
    console.error('[YouTube] Failed to send chat message:', error.message);
    return;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('[YouTube] Failed to send chat message:', res.status, JSON.stringify(err.error || err));
  } else {
    console.log('[YouTube] Chat message sent successfully');
  }
}

async function fetchLiveChatMessages(liveChatId, pageToken, accessToken) {
  const params = new URLSearchParams({
    liveChatId,
    part: 'id,snippet,authorDetails',
  });
  if (pageToken) params.set('pageToken', pageToken);

  const res = await fetch(`https://www.googleapis.com/youtube/v3/liveChat/messages?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: deadline(),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error(`[YouTube] fetchLiveChatMessages failed: ${res.status}`, err.substring(0, 200));
    return null;
  }
  return res.json();
}

async function findActiveLiveStream(channelId, apiKey) {
  if (!channelId || !apiKey) return null;

  const params = new URLSearchParams({
    part: 'id',
    channelId,
    type: 'video',
    eventType: 'live',
    key: apiKey,
  });

  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!res.ok) return null;

  const data = await res.json();
  if (!data.items || data.items.length === 0) return null;

  return data.items[0].id.videoId;
}

async function refreshStreamerYoutubeToken(streamer, options) {
  const db = require('../db');
  if (!streamer.yt_refresh_token) return null;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.youtube.botClientId,
      client_secret: config.youtube.botClientSecret,
      refresh_token: streamer.yt_refresh_token,
      grant_type: 'refresh_token',
    }),
    signal: deadline(options),
  });

  if (!res.ok) return null;
  const data = await res.json();

  const refreshToken = data.refresh_token || streamer.yt_refresh_token;
  const expiresAt = Date.now() + data.expires_in * 1000 - 60_000;
  // The tokens only: the channel name is not this call's to write (rows read
  // without it used to wipe it).
  db.updateStreamerYoutubeAccessToken(streamer.id, data.access_token, refreshToken, expiresAt);
  // The caller goes on using this row: with the new token in it, its next
  // YouTube call does not renew the token again.
  streamer.yt_access_token = data.access_token;
  streamer.yt_refresh_token = refreshToken;
  streamer.yt_token_expires_at = expiresAt;

  return data.access_token;
}

async function getActiveBroadcast(accessToken, options) {
  // Use mine=true to get all broadcasts, then filter for active ones
  const res = await fetch('https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status&mine=true&maxResults=10', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: deadline(options),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error(`[YouTube] liveBroadcasts.list failed: ${res.status}`, err);
    return null;
  }
  const data = await res.json();
  // Find one that is currently live
  const active = (data.items || []).find(item =>
    item.status?.lifeCycleStatus === 'live' || item.status?.lifeCycleStatus === 'liveStarting'
  );
  if (!active) {
    console.log(`[YouTube] No active broadcast found (${data.items?.length || 0} total broadcasts)`);
    return null;
  }
  console.log(`[YouTube] Found active broadcast: "${active.snippet.title}"`);
  return {
    liveChatId: active.snippet.liveChatId,
    title: active.snippet.title,
  };
}

async function deleteYoutubeChatMessage(messageId, accessToken) {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/liveChat/messages?id=${encodeURIComponent(messageId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error(`[YouTube] deleteMessage failed (${res.status}):`, err.substring(0, 200));
  }
}

async function banYoutubeChatUser(liveChatId, channelId, durationSeconds, accessToken) {
  const body = {
    snippet: {
      liveChatId,
      type: durationSeconds ? 'temporary' : 'permanent',
      bannedUserDetails: { channelId },
    },
  };
  if (durationSeconds) body.snippet.banDurationSeconds = durationSeconds;

  const res = await fetch('https://www.googleapis.com/youtube/v3/liveChat/bans?part=snippet', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error(`[YouTube] banUser failed (${res.status}):`, err.substring(0, 200));
  }
}

module.exports = { getLatestVideos, getLiveVideos, getVideoDetails, parseIsoDuration, isShortDuration, SHORTS_MAX_SECONDS, VIDEOS_PER_REQUEST, isQuotaExceeded, quotaBackoffActive, resolveChannelId, getChannelInfo, getLiveChatId, requestYoutubeBotToken, refreshYoutubeBotToken, sendYoutubeChatMessage, fetchLiveChatMessages, findActiveLiveStream, refreshStreamerYoutubeToken, getActiveBroadcast, deleteYoutubeChatMessage, banYoutubeChatUser };
