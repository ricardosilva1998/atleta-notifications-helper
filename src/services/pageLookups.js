'use strict';

// Lookups a dashboard page makes from Twitch or YouTube while it is being built.
// Each one has a single deadline for all of its calls and falls back to "nothing
// found" when it passes, so a slow Twitch or YouTube cannot hold the page up.

const PAGE_LOOKUP_TIMEOUT_MS = 3000;

// Twitch gives thumbnail URLs with {width}x{height} (stream) or %{width}x%{height} (VOD) placeholders.
function sized(url) {
  return url.replace('%{width}', '1280').replace('%{height}', '720').replace('{width}', '1280').replace('{height}', '720');
}

// The picture behind the overlay builder's preview: the live stream's thumbnail,
// else the latest VOD's. null when there is none, or Twitch is too slow. The calls
// (up to three, one after another) share one deadline.
async function findStreamThumbnail(streamer, { twitch = require('./twitch'), timeoutMs = PAGE_LOOKUP_TIMEOUT_MS } = {}) {
  if (!streamer.twitch_username) return null;
  const signal = AbortSignal.timeout(timeoutMs);

  try {
    const stream = await twitch.getStream(streamer.twitch_username, { signal });
    if (stream && stream.thumbnail_url) return sized(stream.thumbnail_url);
  } catch (e) {
    // Twitch is slow or failing: go on to the last VOD below (nothing, if time is up).
  }
  if (signal.aborted) return null;

  try {
    const broadcasterId = streamer.twitch_user_id || await twitch.getUserId(streamer.twitch_username, { signal });
    if (!broadcasterId) return null;
    const videos = await twitch.getVideos(broadcasterId, undefined, { signal });
    if (videos && videos.length > 0 && videos[0].thumbnail_url) return sized(videos[0].thumbnail_url);
  } catch (e) {
    console.log('[Builder] VOD thumbnail fetch error:', e.message);
  }
  return null;
}

// Whether the streamer is live on YouTube now, for the chatbot page:
// { live, title, unknown }. `unknown` is true when YouTube did not answer in time
// (or the token could not be renewed), so the page can say it could not check
// instead of claiming the channel is offline.
async function youtubeLiveStatus(streamer, { youtube = require('./youtube'), timeoutMs = PAGE_LOOKUP_TIMEOUT_MS } = {}) {
  if (!streamer.yt_access_token) return { live: false, title: null, unknown: false };
  const options = { signal: AbortSignal.timeout(timeoutMs) };

  try {
    let accessToken = streamer.yt_access_token;
    if (streamer.yt_token_expires_at && Date.now() >= streamer.yt_token_expires_at) {
      accessToken = await youtube.refreshStreamerYoutubeToken(streamer, options);
    }
    if (!accessToken) return { live: false, title: null, unknown: true };

    const broadcast = await youtube.getActiveBroadcast(accessToken, options);
    return broadcast
      ? { live: true, title: broadcast.title, unknown: false }
      : { live: false, title: null, unknown: false };
  } catch (e) {
    console.warn(`[YT Chat] Could not check the live status of streamer ${streamer.id}: ${e.message}`);
    return { live: false, title: null, unknown: true };
  }
}

module.exports = { PAGE_LOOKUP_TIMEOUT_MS, findStreamThumbnail, youtubeLiveStatus };
