'use strict';

// The server page lists the channels a server watches, each with a picture (and,
// for YouTube, a name). Some are missing. Looking them up while the page loaded
// made it wait on Twitch and YouTube for every missing one, on every load. They
// are filled in after the page has been sent instead, and a row is tried at most
// once every 24 hours (the time of the last try is kept on the row).

const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 3000;

// `attemptedAt` is the ISO time stored on the row, or null when never tried.
function lookupDue(attemptedAt, now = Date.now()) {
  if (!attemptedAt) return true;
  const at = Date.parse(attemptedAt);
  if (!Number.isFinite(at) || at > now) return true; // unreadable or from the future: try again
  return now - at >= RETRY_AFTER_MS;
}

// Twitch rows without a picture that are due for another try.
function twitchRowsDue(rows, now = Date.now()) {
  return rows.filter((row) => !row.profile_image_url && lookupDue(row.info_attempted_at, now));
}

// YouTube rows without a picture or a name that are due for another try.
function youtubeRowsDue(rows, now = Date.now()) {
  return rows.filter((row) => (!row.profile_image_url || !row.youtube_channel_name) && lookupDue(row.info_attempted_at, now));
}

// Stamps every row as tried first (so another page load, or a second server tab,
// does not start the same lookups), then looks the rows up one after the other.
// Each lookup has its own 3 s deadline. Returns a promise that never rejects; the
// page does not wait for it.
function backfillInBackground({ twitchRows = [], youtubeRows = [] }, { db, getUserProfile, getChannelInfo, now = Date.now, timeoutMs = LOOKUP_TIMEOUT_MS }) {
  const stamp = new Date(now()).toISOString();
  for (const row of twitchRows) db.markWatchedChannelInfoAttempt(row.id, stamp);
  for (const row of youtubeRows) db.markWatchedYoutubeChannelInfoAttempt(row.id, stamp);

  return (async () => {
    for (const row of twitchRows) {
      try {
        const profile = await getUserProfile(row.twitch_username, { signal: AbortSignal.timeout(timeoutMs) });
        if (profile && profile.profile_image_url) db.updateWatchedChannelProfileImage(row.id, profile.profile_image_url);
      } catch (e) {
        console.warn(`[Dashboard] Could not look up the picture of Twitch channel ${row.twitch_username}: ${e.message}`);
      }
    }
    for (const row of youtubeRows) {
      try {
        const info = await getChannelInfo(row.youtube_channel_id, { signal: AbortSignal.timeout(timeoutMs) });
        if (info && (info.profileImageUrl || info.channelName)) {
          // Keep the picture the row already has when the page gave only a name.
          db.updateWatchedYoutubeChannelInfo(row.id, info.profileImageUrl || row.profile_image_url, info.channelName);
        }
      } catch (e) {
        console.warn(`[Dashboard] Could not look up YouTube channel ${row.youtube_channel_id}: ${e.message}`);
      }
    }
  })();
}

module.exports = { RETRY_AFTER_MS, LOOKUP_TIMEOUT_MS, lookupDue, twitchRowsDue, youtubeRowsDue, backfillInBackground };
