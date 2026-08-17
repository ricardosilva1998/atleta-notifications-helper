const { getClips, getUserId } = require('../services/twitch');
const { buildEmbed } = require('../discord');

// Twitch caps /clips at a one-week window when ended_at is omitted. A channel
// that goes a week without a clip then deadlocks: the only clip the query can
// still return is the one at last_clip_created_at itself, which the strictly
// newer filter below drops, so last_clip_created_at never advances and clip
// alerts stop for good. Always send an explicit window.
//
// The window start is also clamped to CLIP_LOOKBACK_MS so a channel that has
// been stalled for months resumes on its next clip instead of replaying the
// whole backlog into Discord at once.
const CLIP_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function computeClipWindow(lastClipCreatedAt, nowMs) {
  const floorMs = nowMs - CLIP_LOOKBACK_MS;
  const lastMs = lastClipCreatedAt ? Date.parse(lastClipCreatedAt) : NaN;
  const startMs = Number.isNaN(lastMs) ? floorMs : Math.max(lastMs, floorMs);

  return {
    startedAt: new Date(startMs).toISOString(),
    endedAt: new Date(nowMs).toISOString(),
  };
}

// Compared as instants, not strings: the stored value uses Twitch's
// second-precision format while generated timestamps carry milliseconds.
function selectNewClips(clips, lastClipCreatedAt) {
  const lastMs = lastClipCreatedAt ? Date.parse(lastClipCreatedAt) : NaN;
  if (Number.isNaN(lastMs)) return clips.slice();
  return clips.filter((clip) => Date.parse(clip.created_at) > lastMs);
}

async function check(twitchUsername, channelState, nowMs = Date.now()) {
  let broadcasterId = channelState.twitch_broadcaster_id;

  if (!broadcasterId) {
    broadcasterId = await getUserId(twitchUsername);
    if (!broadcasterId) return null;
    return { notify: false, stateUpdate: { twitch_broadcaster_id: broadcasterId } };
  }

  const { startedAt, endedAt } = computeClipWindow(channelState.last_clip_created_at, nowMs);
  const clips = await getClips(broadcasterId, startedAt, endedAt);

  if (clips.length > 0) {
    console.log(`[TwitchClips] ${twitchUsername}: found ${clips.length} clips since ${startedAt}`);
  }

  const newClips = selectNewClips(clips, channelState.last_clip_created_at);

  if (newClips.length === 0) return null;
  console.log(`[TwitchClips] ${twitchUsername}: ${newClips.length} NEW clips to notify`);

  const clipData = newClips.map((clip) => {
    const duration = `${Math.round(clip.duration)}s`;
    const message = `**New clip by ${clip.creator_name}** — ${clip.title}\n📊 ${clip.view_count} views · ⏱️ ${duration}\n${clip.url}`;
    return { message };
  });

  // Twitch orders /clips by view count, so the newest is not simply the last.
  const newest = newClips.reduce((a, b) => (Date.parse(a.created_at) > Date.parse(b.created_at) ? a : b));

  return {
    notify: true,
    clipData,
    stateUpdate: { last_clip_created_at: newest.created_at },
  };
}

module.exports = { check, computeClipWindow, selectNewClips, CLIP_LOOKBACK_MS };
