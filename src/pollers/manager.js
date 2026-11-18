const db = require('../db');
const config = require('../config');
const { sendNotification, buildRecapEmbed, buildMilestoneEmbed } = require('../discord');
const twitchLive = require('./twitchLive');
const twitchClips = require('./twitchClips');
const youtubeFeed = require('./youtubeFeed');
const youtubeLive = require('./youtubeLive');
const subSync = require('./subSync');
const { pollWeeklyDigest } = require('./weeklyDigest');
const { getFollowerCount, getSubscriberCount, getStreams, STREAMS_PER_REQUEST, refreshBroadcasterTokenShared } = require('../services/twitch');
const { getLatestVideos, getLiveVideos, quotaBackoffActive } = require('../services/youtube');
const { chunk } = require('../services/chunk');
const { exclusiveRun } = require('./exclusiveRun');
const { planMilestoneCheck } = require('./milestones');
const trackers = require('../services/trackers');

// --- Twitch polling (channel-centric) ---

// Whether the watched channels are live, a batch of them per Twitch request:
// each channel is asked about once, however many servers watch it (one request
// per channel per minute used up the shared app token's budget). Every enabled
// streamer's own linked channel is asked about too, watched by a server or not:
// Tracking needs to know when their stream starts (the top tipper of the
// stream). What is posted still goes only to a channel's watchers, so a channel
// no server watches only gets its channel_state.
async function pollAllTwitchLive() {
  const watched = db.getAllUniqueWatchedChannels().map((c) => c.twitch_username);
  const logins = [...new Set([...watched, ...db.getEnabledStreamerTwitchLogins()]
    .filter(Boolean).map((login) => String(login).toLowerCase()))];
  if (logins.length > 0 && !pollAllTwitchLive._logged) {
    console.log(`[TwitchLive] Polling ${logins.length} channels: ${logins.join(', ')}`);
    pollAllTwitchLive._logged = true;
  }

  for (const batch of chunk(logins, STREAMS_PER_REQUEST)) {
    let streams;
    try {
      streams = await getStreams(batch);
    } catch (error) {
      // A request that failed says nothing about whether these channels are
      // live: they keep their stored state until the next poll.
      console.error(`[TwitchLive] Could not check ${batch.length} channel(s): ${error.message}`);
      continue;
    }
    for (const login of batch) {
      try {
        await pollTwitchLiveChannel(login, streams.get(login) || null);
      } catch (error) {
        console.error(`[TwitchLive] Error for ${login}: ${error.message}`);
      }
    }
  }
}

// The streamer whose own channel this is (twitch_user_id is the broadcaster),
// else any watcher of the channel who holds a broadcaster token. Only the
// broadcaster's own token may read the channel's followers and subscribers.
function findBroadcasterStreamer(twitchUsername, broadcasterId, watcherStreamerIds) {
  if (broadcasterId) {
    const owner = db.getStreamerByTwitchId(String(broadcasterId));
    if (owner?.broadcaster_access_token) return owner;
  }
  for (const id of watcherStreamerIds) {
    const streamer = db.getStreamerById(id);
    if (streamer?.broadcaster_access_token) return streamer;
  }
  return null;
}

// A usable token for the streamer: one past its stored expiry is refreshed first.
async function broadcasterTokenOf(streamer) {
  if (streamer.broadcaster_token_expires_at && Date.now() >= streamer.broadcaster_token_expires_at) {
    return refreshBroadcasterTokenShared(streamer);
  }
  return streamer.broadcaster_access_token;
}

async function findBroadcasterToken(twitchUsername, broadcasterId) {
  const ids = db.getWatchersForChannel(twitchUsername).map((w) => w.streamer_id);
  const streamer = findBroadcasterStreamer(twitchUsername, broadcasterId, ids);
  if (!streamer) return null;
  try {
    return await broadcasterTokenOf(streamer);
  } catch (e) {
    console.warn(`[TwitchLive] No broadcaster token for ${twitchUsername}: ${e.message}`);
    return null;
  }
}

// `stream` is what Twitch answered for the channel: the live stream, or null.
async function pollTwitchLiveChannel(twitchUsername, stream) {
  const state = db.getChannelState(twitchUsername);
  // The token is only used for the follower count of a recap.
  const broadcasterToken = state.is_live ? await findBroadcasterToken(twitchUsername, state.twitch_broadcaster_id) : null;

  const result = await twitchLive.check(twitchUsername, state, broadcasterToken, stream);
  if (!result) return;

  // What was learned is stored before anything is posted, and the old
  // broadcast's session is cleared before a new one's is stored.
  if (result.clearSession) db.clearStreamSession(twitchUsername);
  if (result.stateUpdate) db.updateChannelState(twitchUsername, result.stateUpdate);

  if (result.kind === 'started' || result.kind === 'replaced') {
    console.log(`[TwitchLive] ${twitchUsername} went LIVE — "${result.stateUpdate.stream_title}" (${result.stateUpdate.stream_category})`);
    // Tracking: the top tipper of the stream starts over now (the new start is stored above).
    trackers.streamStarted(twitchUsername);
  } else if (result.kind === 'resumed') {
    console.log(`[TwitchLive] ${twitchUsername} is live again with the broadcast announced before — not announcing it twice`);
  } else if (result.kind === 'ended') {
    console.log(`[TwitchLive] ${twitchUsername} went OFFLINE — clearing session`);
  }

  // Recap of the broadcast that ended; when another began meanwhile, it comes
  // before that one's announcement.
  if (result.recapData) {
    console.log(`[Recap] ${twitchUsername} went offline — duration: ${Math.floor(result.recapData.duration / 60)}m, clips: ${result.recapData.clips.length}`);
    await sendRecaps(twitchUsername, result.recapData);
  }

  // Go-live notification
  if (result.notify) {
    const watchers = db.getWatchersForChannel(twitchUsername).filter((w) => w.notify_live && w.live_channel_id);
    for (const w of watchers) {
      try {
        await sendNotification(w.live_channel_id, result.embed, {
          streamerId: w.streamer_id,
          guildId: w.guild_id,
          type: 'twitch_live',
        });
      } catch (e) {
        console.error(`[TwitchLive] Send failed for ${twitchUsername} to ${w.guild_id}: ${e.message}`);
      }
    }
  }

  // Milestones are looked at when a broadcast starts.
  if (result.kind === 'started' || result.kind === 'replaced') {
    await checkMilestones(twitchUsername, db.getChannelState(twitchUsername));
  }
}

async function sendRecaps(twitchUsername, recapData) {
  const watchers = db.getWatchersForChannelWithFeatures(twitchUsername)
    .filter((w) => w.recap_enabled && w.live_channel_id);

  for (const w of watchers) {
    const tier = db.getStreamerTier(w.streamer_id);
    const tierConfig = config.tiers[tier] || config.tiers.free;
    if (!tierConfig.recaps) continue;

    try {
      // Send VOD link first as plain text (Discord auto-generates video player)
      if (recapData.vodUrl) {
        await sendNotification(w.live_channel_id, null, {
          streamerId: w.streamer_id,
          guildId: w.guild_id,
          type: 'twitch_recap',
          contentOnly: `📺 **${twitchUsername} stream recap**\n${recapData.vodUrl}`,
        });
      }
      // Then send the stats embed below the VOD
      const embed = buildRecapEmbed(recapData);
      await sendNotification(w.live_channel_id, embed, {
        streamerId: w.streamer_id,
        guildId: w.guild_id,
        type: 'twitch_recap',
      });
    } catch (e) {
      console.error(`[Recap] Send failed for ${twitchUsername} to ${w.guild_id}: ${e.message}`);
    }
  }
}

async function checkMilestones(twitchUsername, channelState) {
  const broadcasterId = channelState.twitch_broadcaster_id;
  if (!broadcasterId) return;

  // Find a streamer with a broadcaster token who watches this channel
  const watchers = db.getWatchersForChannelWithFeatures(twitchUsername)
    .filter((w) => w.milestones_enabled);
  if (watchers.length === 0) return;

  const streamer = findBroadcasterStreamer(twitchUsername, broadcasterId, [...new Set(watchers.map((w) => w.streamer_id))]);
  if (!streamer) return;
  let token;
  try {
    token = await broadcasterTokenOf(streamer);
  } catch (e) {
    console.warn(`[Milestones] No broadcaster token for ${twitchUsername}: ${e.message}`);
    return;
  }
  const milestones = db.getChannelMilestones(twitchUsername);

  try {
    const followerCount = await getFollowerCount(broadcasterId, token);
    const followers = planMilestoneCheck('follower', followerCount, milestones);
    if (followers.firstLook) {
      console.log(`[Milestones] ${twitchUsername}: ${followerCount} followers recorded as the starting point`);
    }
    if (followers.announce) {
      console.log(`[Milestones] ${twitchUsername} hit ${followers.announce} followers!`);
      const embed = buildMilestoneEmbed({
        twitchUsername,
        milestoneType: 'follower',
        count: followers.announce,
      });
      await sendMilestoneNotifications(twitchUsername, watchers, embed);
    }
    db.updateChannelMilestones(twitchUsername, followers.update);

    // Subscriber milestones. Twitch states the total on every page of the list,
    // so one request for a single entry gives the count.
    try {
      const subCount = await getSubscriberCount(broadcasterId, token);
      const subscribers = planMilestoneCheck('subscriber', subCount, milestones);
      if (subscribers.firstLook) {
        console.log(`[Milestones] ${twitchUsername}: ${subCount} subscribers recorded as the starting point`);
      }
      if (subscribers.announce) {
        console.log(`[Milestones] ${twitchUsername} hit ${subscribers.announce} subscribers!`);
        const embed = buildMilestoneEmbed({
          twitchUsername,
          milestoneType: 'subscriber',
          count: subscribers.announce,
        });
        await sendMilestoneNotifications(twitchUsername, watchers, embed);
      }
      db.updateChannelMilestones(twitchUsername, subscribers.update);
    } catch (e) {
      // Sub count may fail if token doesn't have the right scope — that's ok
      console.warn(`[Milestones] Sub count failed for ${twitchUsername}: ${e.message}`);
    }
  } catch (e) {
    console.warn(`[Milestones] Follower count failed for ${twitchUsername}: ${e.message}`);
  }
}

async function sendMilestoneNotifications(twitchUsername, watchers, embed) {
  for (const w of watchers) {
    if (!w.milestones_enabled || !w.live_channel_id) continue;
    const tier = db.getStreamerTier(w.streamer_id);
    const tierConfig = config.tiers[tier] || config.tiers.free;
    if (!tierConfig.milestones) continue;

    try {
      await sendNotification(w.live_channel_id, embed, {
        streamerId: w.streamer_id,
        guildId: w.guild_id,
        type: 'twitch_milestone',
      });
    } catch (e) {
      console.error(`[Milestones] Send failed for ${twitchUsername} to ${w.guild_id}: ${e.message}`);
    }
  }
}

async function pollAllTwitchClips() {
  const channels = db.getAllUniqueWatchedChannels();
  for (const { twitch_username } of channels) {
    try {
      const state = db.getChannelState(twitch_username);
      const result = await twitchClips.check(twitch_username, state);
      if (!result) continue;

      if (result.stateUpdate) {
        console.log(`[TwitchClips] ${twitch_username}: state update`, JSON.stringify(result.stateUpdate));
        db.updateChannelState(twitch_username, result.stateUpdate);
      }

      if (result.notify && result.clipData) {
        const watchers = db.getWatchersForChannel(twitch_username).filter((w) => w.notify_clips && w.clips_channel_id);
        for (const w of watchers) {
          for (const clip of result.clipData) {
            try {
              await sendNotification(w.clips_channel_id, null, {
                streamerId: w.streamer_id,
                guildId: w.guild_id,
                type: 'twitch_clip',
                contentOnly: clip.message,
              });
            } catch (e) {
              console.error(`[TwitchClips] Send failed for ${twitch_username} to ${w.guild_id}: ${e.message}`);
            }
          }
        }
      }
    } catch (error) {
      console.error(`[TwitchClips] Error for ${twitch_username}: ${error.message}`);
    }
  }
}

// --- YouTube polling (channel-centric) ---

async function pollAllYouTubeFeed() {
  // YouTube said its daily quota is used up: nothing to ask for an hour.
  if (quotaBackoffActive()) return;

  const channels = db.getAllUniqueWatchedYoutubeChannels();
  if (channels.length > 0 && !pollAllYouTubeFeed._logged) {
    console.log(`[YouTubeFeed] Polling ${channels.length} channels: ${channels.map(c => c.youtube_channel_id).join(', ')}`);
    pollAllYouTubeFeed._logged = true;
  }
  for (const { youtube_channel_id } of channels) {
    try {
      const state = db.getYoutubeChannelState(youtube_channel_id);
      const result = await youtubeFeed.check(youtube_channel_id, state, config.youtube.apiKey);
      if (!result) continue;

      if (result.stateUpdate) db.updateYoutubeChannelState(youtube_channel_id, result.stateUpdate);

      if (result.notify && result.videoData) {
        console.log(`[YouTubeFeed] ${youtube_channel_id}: ${result.videoData.length} new video(s) to notify`);
        const watchers = db.getYoutubeWatchersForChannel(youtube_channel_id)
          .filter((w) => w.notify_videos && w.videos_channel_id);
        console.log(`[YouTubeFeed] ${youtube_channel_id}: ${watchers.length} watcher(s) with videos_channel_id`);
        for (const w of watchers) {
          for (const video of result.videoData) {
            try {
              await sendNotification(w.videos_channel_id, null, {
                streamerId: w.streamer_id,
                guildId: w.guild_id,
                type: video.isShort ? 'youtube_short' : 'youtube_video',
                contentOnly: video.message,
              });
            } catch (e) {
              console.error(`[YouTubeFeed] Send failed for ${youtube_channel_id} to ${w.guild_id}: ${e.message}`);
            }
          }
        }
      }
    } catch (error) {
      console.error(`[YouTubeFeed] Error for ${youtube_channel_id}: ${error.message}`);
    }
  }
}

// The streamer whose own YouTube channel this is, among the watchers of it.
function ownerOfYoutubeChannel(youtubeChannelId, watchers) {
  for (const w of watchers) {
    const streamer = db.getStreamerById(w.streamer_id);
    if (streamer && streamer.youtube_channel_id === youtubeChannelId) return streamer;
  }
  return null;
}

// While the owner's channel is live its chat is polled. This runs on every poll
// that finds the channel live, not only when the stream goes live: after a
// restart in the middle of a stream nothing marks a change, so nothing else
// would start the chat again.
function ensureYoutubeChatPolling(owner, liveChatId) {
  if (!owner || !owner.yt_chatbot_enabled || !liveChatId) return;
  const { youtubeChatManager } = require('../services/youtubeLiveChat');
  if (youtubeChatManager.isPolling(owner.id) && youtubeChatManager.getLiveChatId(owner.id) === liveChatId) return;
  try {
    youtubeChatManager.startPolling(owner.id, liveChatId);
  } catch (e) {
    console.error('[YT Live] Failed to start chat polling:', e.message);
  }
}

// `target` is a channel with someone to tell and its latest video ids;
// `liveVideo` is the one of them that is on air, or null.
async function handleYouTubeLive({ channelId, watchers }, liveVideo) {
  const state = db.getYoutubeChannelState(channelId);
  const result = youtubeLive.decide(state, liveVideo);
  if (result?.stateUpdate) db.updateYoutubeChannelState(channelId, result.stateUpdate);

  const owner = ownerOfYoutubeChannel(channelId, watchers);
  if (liveVideo) {
    ensureYoutubeChatPolling(owner, liveVideo.liveChatId);
  } else if (result?.stateUpdate?.is_live === 0 && owner) {
    try {
      require('../services/youtubeLiveChat').youtubeChatManager.stopPolling(owner.id);
    } catch (e) {}
  }

  if (result?.notify) {
    for (const w of watchers) {
      try {
        await sendNotification(w.live_channel_id, result.embed, {
          streamerId: w.streamer_id,
          guildId: w.guild_id,
          type: 'youtube_live',
        });
      } catch (e) {
        console.error(`[YouTubeLive] Send failed for ${channelId} to ${w.guild_id}: ${e.message}`);
      }
    }
  }
}

// Live detection needs the API key; without one (as in production today) there
// is nothing to do, and nothing is logged. The latest videos of every channel
// come from the RSS feeds, which cost no quota; whether any of them is on air is
// then asked of YouTube for all channels together, 50 videos per request.
async function pollAllYouTubeLive() {
  const apiKey = config.youtube.apiKey;
  if (!apiKey) return;
  if (quotaBackoffActive()) return;

  const targets = [];
  for (const { youtube_channel_id } of db.getAllUniqueWatchedYoutubeChannels()) {
    try {
      const watchers = db.getYoutubeWatchersForChannel(youtube_channel_id)
        .filter((w) => w.notify_live && w.live_channel_id);
      if (watchers.length === 0) continue;

      const videos = await getLatestVideos(youtube_channel_id);
      targets.push({
        channelId: youtube_channel_id,
        watchers,
        videoIds: videos.slice(0, youtubeLive.LIVE_CHECK_VIDEOS).map((v) => v.id),
      });
    } catch (error) {
      console.error(`[YouTubeLive] Error for ${youtube_channel_id}: ${error.message}`);
    }
  }
  if (targets.length === 0) return;

  let lookup;
  try {
    lookup = await getLiveVideos(targets.flatMap((t) => t.videoIds), apiKey);
  } catch (error) {
    // An exhausted quota is already logged, and YouTube is paused for an hour.
    if (error.code !== 'QUOTA_EXCEEDED') console.error(`[YouTubeLive] ${error.message}`);
    return;
  }

  for (const target of targets) {
    try {
      // A lookup that failed says nothing about whether the channel is live.
      if (target.videoIds.some((id) => lookup.failed.has(id))) continue;
      const liveVideo = target.videoIds.map((id) => lookup.live.get(id)).find(Boolean) || null;
      await handleYouTubeLive(target, liveVideo);
    } catch (error) {
      console.error(`[YouTubeLive] Error for ${target.channelId}: ${error.message}`);
    }
  }
}

function getActiveStreamers() {
  return db.getAllStreamers().filter((s) => s.enabled);
}

async function pollAllSubSync() {
  const active = getActiveStreamers();
  const withToken = active.filter((s) => s.broadcaster_access_token);
  console.log(`[SubSync] Poll: ${active.length} active streamers, ${withToken.length} with broadcaster token`);
  if (active.length > 0 && withToken.length === 0) {
    console.log(`[SubSync] Active streamer IDs: ${active.map(s => `${s.id}(twitch=${s.twitch_username},token=${!!s.broadcaster_access_token})`).join(', ')}`);
  }
  for (const streamer of withToken) {
    try {
      await subSync.checkStreamer(streamer);
    } catch (error) {
      console.error(`[SubSync] Error for ${streamer.twitch_username}: ${error.message}`);
    }
  }
}

// The pollers' timers, so stopAll() can stop them (the shutdown in index.js).
const timers = [];

function startAll() {
  // A tick that fires while the previous run of the same poller is still going
  // is skipped: overlapping runs read the same stored state and both post.
  const run = {
    twitchLive: exclusiveRun('TwitchLive', pollAllTwitchLive),
    twitchClips: exclusiveRun('TwitchClips', pollAllTwitchClips),
    youtubeFeed: exclusiveRun('YouTubeFeed', pollAllYouTubeFeed),
    youtubeLive: exclusiveRun('YouTubeLive', pollAllYouTubeLive),
    subSync: exclusiveRun('SubSync', pollAllSubSync),
    weeklyDigest: exclusiveRun('WeeklyDigest', pollWeeklyDigest),
  };

  timers.push(
    setInterval(run.twitchLive, config.intervals.twitchLive),
    setInterval(run.twitchClips, config.intervals.twitchClips),
    setInterval(run.youtubeFeed, config.intervals.youtubeFeed),
    setInterval(run.youtubeLive, config.intervals.youtubeLive),
    setInterval(run.subSync, config.intervals.subSync),
    setInterval(run.weeklyDigest, config.intervals.weeklyDigest),
  );

  console.log('[Manager] All pollers started');

  // First poll immediately
  run.twitchLive();
  run.twitchClips();
  run.subSync();
  // Also at once, so that a stream that is on when the server starts gets its chat back
  // within seconds (it does nothing without a YouTube API key).
  run.youtubeLive();
}

// No poller starts a new run after this; a run already going is not waited for.
function stopAll() {
  while (timers.length > 0) clearInterval(timers.pop());
}

module.exports = { startAll, stopAll, pollAllTwitchLive, pollAllTwitchClips, pollAllYouTubeFeed, pollAllYouTubeLive, pollAllSubSync };
