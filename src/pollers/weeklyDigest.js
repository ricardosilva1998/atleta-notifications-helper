const db = require('../db');
const config = require('../config');
const { sendNotification, buildWeeklyDigestEmbed } = require('../discord');
const { getVideos, getClips, getUserId, getGameNames } = require('../services/twitch');

// The digest is due on Mondays from 09:00 UTC, in the hour the poller looks at.
// One that fails to go out (Discord rejects it, the channel is gone, Twitch does
// not answer) is tried again: the first try and up to three retries, for a
// server and week, no sooner than RETRY_GAP_MS after the last try. The poller
// ticks every 15 minutes (config.intervals.weeklyDigest), so the four ticks of
// that hour are four tries. Only a post that went out is recorded as posted.
const MAX_ATTEMPTS = 4;
const RETRY_GAP_MS = 10 * 60 * 1000;

// guild_id -> { date, count, lastAt }: this week's tries for a server that has
// not been posted yet. One entry per server at most; each poll first drops the
// entries of an earlier week.
const attempts = new Map();

function forgetOldAttempts(date) {
  for (const [guildId, tried] of attempts) {
    if (tried.date !== date) attempts.delete(guildId);
  }
}

function mayAttempt(guildId, nowMs) {
  const tried = attempts.get(guildId);
  return !tried || (tried.count < MAX_ATTEMPTS && nowMs - tried.lastAt >= RETRY_GAP_MS);
}

function noteAttempt(guildId, date, nowMs) {
  const count = (attempts.get(guildId)?.count || 0) + 1;
  attempts.set(guildId, { date, count, lastAt: nowMs });
  return count;
}

function parseTwitchDuration(duration) {
  // Twitch format: "1h2m3s", "45m12s", "30s"
  const text = String(duration || '');
  const hours = text.match(/(\d+)h/)?.[1] || 0;
  const mins = text.match(/(\d+)m/)?.[1] || 0;
  const secs = text.match(/(\d+)s/)?.[1] || 0;
  return Number(hours) * 3600 + Number(mins) * 60 + Number(secs);
}

// The week of one channel: { videos, clips, categories }. Anything Twitch fails
// to answer throws, so a half-read week is never posted as if it were the whole.
async function loadChannelWeek(username, since) {
  const state = db.getChannelState(username);
  let broadcasterId = state?.twitch_broadcaster_id;
  if (!broadcasterId) {
    broadcasterId = await getUserId(username);
    if (broadcasterId) db.updateChannelState(username, { twitch_broadcaster_id: broadcasterId });
  }
  if (!broadcasterId) return { videos: [], clips: [], categories: [] }; // not a channel Twitch knows

  const videos = await getVideos(broadcasterId, since);
  const clips = await getClips(broadcasterId, since);
  // Videos carry no game, so the categories come from the clips.
  const gameIds = [...new Set(clips.map((c) => c.game_id).filter(Boolean))];
  const categories = gameIds.length > 0 ? await getGameNames(gameIds) : [];
  return { videos, clips, categories };
}

// What the week looked like across a server's watched channels.
function summarizeWeek(weeks) {
  let streamCount = 0;
  let totalSeconds = 0;
  const categories = new Set();
  let topClip = null;

  for (const week of weeks) {
    for (const video of week.videos) {
      streamCount++;
      totalSeconds += parseTwitchDuration(video.duration);
    }
    for (const clip of week.clips) {
      if (!topClip || clip.view_count > topClip.view_count) topClip = clip;
    }
    for (const name of week.categories) categories.add(name);
  }

  return {
    streamCount,
    totalHours: totalSeconds / 3600,
    categories: [...categories],
    topClip: topClip ? { title: topClip.title, url: topClip.url, view_count: topClip.view_count } : null,
  };
}

async function pollWeeklyDigest(now = new Date()) {
  // Only trigger on Mondays between 09:00 and 09:59 UTC
  if (now.getUTCDay() !== 1 || now.getUTCHours() !== 9) return;

  const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const nowMs = now.getTime();
  const since = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString();
  forgetOldAttempts(todayStr);

  // Per-channel data cache to avoid duplicate API calls
  const channelCache = new Map();

  for (const { guild_id, streamer_id } of db.getGuildsWithWeeklyHighlights()) {
    try {
      // Check tier
      const tier = db.getStreamerTier(streamer_id);
      const tierConfig = config.tiers[tier] || config.tiers.free;
      if (!tierConfig.weeklyHighlights) continue;

      // Check if already posted this week
      const digestState = db.getWeeklyDigestState(guild_id);
      if (digestState?.last_digest_date === todayStr) continue;

      // Get posting channel
      const channelId = db.getDigestChannelForGuild(guild_id);
      if (!channelId) continue;

      if (!mayAttempt(guild_id, nowMs)) continue;
      const attempt = noteAttempt(guild_id, todayStr, nowMs);

      let outcome; // why this attempt did not post, when it did not
      try {
        // Gather data for all watched Twitch channels in this guild
        const weeks = [];
        for (const wc of db.getWatchedChannelsForGuild(guild_id, streamer_id)) {
          if (!channelCache.has(wc.twitch_username)) {
            channelCache.set(wc.twitch_username, await loadChannelWeek(wc.twitch_username, since));
          }
          weeks.push(channelCache.get(wc.twitch_username));
        }
        const summary = summarizeWeek(weeks);

        // Skip if no activity
        if (summary.streamCount === 0 && !summary.topClip) continue;

        const posted = await sendNotification(channelId, buildWeeklyDigestEmbed(summary), {
          streamerId: streamer_id,
          guildId: guild_id,
          type: 'weekly_digest',
        });
        if (posted) {
          // Only record after a post that went out: a refused channel returns normally.
          db.updateWeeklyDigestDate(guild_id, todayStr);
          attempts.delete(guild_id);
          console.log(`[WeeklyDigest] Posted digest for guild ${guild_id}${attempt > 1 ? ` (attempt ${attempt} of ${MAX_ATTEMPTS})` : ''}`);
          continue;
        }
        outcome = 'the channel is not one the bot can reach';
      } catch (e) {
        outcome = e.message;
      }

      console.error(`[WeeklyDigest] Attempt ${attempt} of ${MAX_ATTEMPTS} failed for guild ${guild_id}: ${outcome}${attempt >= MAX_ATTEMPTS ? ' - giving up until next week' : ''}`);
    } catch (e) {
      console.error(`[WeeklyDigest] Error for guild ${guild_id}: ${e.message}`);
    }
  }
}

module.exports = { pollWeeklyDigest, summarizeWeek, parseTwitchDuration, MAX_ATTEMPTS, RETRY_GAP_MS };
