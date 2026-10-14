const db = require('../db');
const config = require('../config');
const { sendNotification, buildRecapEmbed, buildMilestoneEmbed, buildInstagramEmbed, buildTikTokEmbed, buildTwitterEmbed, buildIracingResultEmbed } = require('../discord');
const twitchLive = require('./twitchLive');
const twitchClips = require('./twitchClips');
const youtubeFeed = require('./youtubeFeed');
const youtubeLive = require('./youtubeLive');
const subSync = require('./subSync');
const { pollWeeklyDigest } = require('./weeklyDigest');
const instagramFeed = require('./instagramFeed');
const tiktokFeed = require('./tiktokFeed');
const twitterFeed = require('./twitterFeed');
const iracingResults = require('./iracingResults');
const iracing = require('../services/iracing');
const { getFollowerCount, getSubscriberCount, getStreams, STREAMS_PER_REQUEST } = require('../services/twitch');
const { getLatestVideos, getLiveVideos, quotaBackoffActive } = require('../services/youtube');
const { chunk } = require('../services/chunk');
const { exclusiveRun } = require('./exclusiveRun');
const { planMilestoneCheck } = require('./milestones');

// --- Twitch polling (channel-centric) ---

// Whether the watched channels are live, a batch of them per Twitch request:
// each channel is asked about once, however many servers watch it (one request
// per channel per minute used up the shared app token's budget).
async function pollAllTwitchLive() {
  const logins = [...new Set(db.getAllUniqueWatchedChannels().map((c) => String(c.twitch_username).toLowerCase()))];
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

// A broadcaster token from any watcher of the channel.
function findBroadcasterToken(twitchUsername) {
  for (const w of db.getWatchersForChannel(twitchUsername)) {
    const streamer = db.getStreamerById(w.streamer_id);
    if (streamer?.broadcaster_access_token) return streamer.broadcaster_access_token;
  }
  return null;
}

// `stream` is what Twitch answered for the channel: the live stream, or null.
async function pollTwitchLiveChannel(twitchUsername, stream) {
  const state = db.getChannelState(twitchUsername);
  // The token is only used for the follower count of a recap.
  const broadcasterToken = state.is_live ? findBroadcasterToken(twitchUsername) : null;

  const result = await twitchLive.check(twitchUsername, state, broadcasterToken, stream);
  if (!result) return;

  // What was learned is stored before anything is posted, and the old
  // broadcast's session is cleared before a new one's is stored.
  if (result.clearSession) db.clearStreamSession(twitchUsername);
  if (result.stateUpdate) db.updateChannelState(twitchUsername, result.stateUpdate);

  if (result.kind === 'started' || result.kind === 'replaced') {
    console.log(`[TwitchLive] ${twitchUsername} went LIVE — "${result.stateUpdate.stream_title}" (${result.stateUpdate.stream_category})`);
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

  // Check if any watcher's streamer has a broadcaster token
  const streamersWithToken = new Map();
  for (const w of watchers) {
    if (!streamersWithToken.has(w.streamer_id)) {
      const streamer = db.getStreamerById(w.streamer_id);
      if (streamer?.broadcaster_access_token) {
        streamersWithToken.set(w.streamer_id, streamer);
      }
    }
  }
  if (streamersWithToken.size === 0) return;

  const streamer = streamersWithToken.values().next().value;
  const milestones = db.getChannelMilestones(twitchUsername);

  try {
    const followerCount = await getFollowerCount(broadcasterId, streamer.broadcaster_access_token);
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
      const subCount = await getSubscriberCount(broadcasterId, streamer.broadcaster_access_token);
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

// --- Social media polling (account-centric) ---

async function pollAllInstagram() {
  const accounts = db.getAllUniqueWatchedInstagram();
  if (accounts.length > 0) {
    console.log(`[Instagram] Polling ${accounts.length} accounts: ${accounts.map(a => a.instagram_username).join(', ')}`);
  }
  for (const { instagram_username } of accounts) {
    try {
      const state = db.getInstagramState(instagram_username);
      const result = await instagramFeed.check(instagram_username, state);
      if (!result) { console.log(`[Instagram] ${instagram_username}: no changes`); continue; }
      if (result.stateUpdate) db.updateInstagramState(instagram_username, result.stateUpdate);
      if (result.notify && result.items) {
        const watchers = db.getInstagramWatchersForAccount(instagram_username)
          .filter(w => w.notify_channel_id);
        for (const w of watchers) {
          const tier = db.getStreamerTier(w.streamer_id);
          const tierConfig = config.tiers[tier] || config.tiers.free;
          if (!tierConfig.instagram) continue;
          for (const item of result.items) {
            try {
              const embed = buildInstagramEmbed({
                username: instagram_username,
                displayName: w.display_name || instagram_username,
                profileImageUrl: w.profile_image_url,
                caption: item.caption,
                postUrl: item.url,
                imageUrl: item.imageUrl,
                timestamp: item.timestamp,
              });
              await sendNotification(w.notify_channel_id, embed, {
                streamerId: w.streamer_id, guildId: w.guild_id, type: 'instagram_post',
              });
            } catch (e) {
              console.error(`[Instagram] Send failed for ${instagram_username} to ${w.guild_id}: ${e.message}`);
            }
          }
        }
      }
    } catch (error) {
      console.error(`[Instagram] Error for ${instagram_username}: ${error.message}`);
    }
    // Rate limit: 2s between accounts
    if (accounts.length > 1) await new Promise(r => setTimeout(r, 2000));
  }
}

async function pollAllTikTok() {
  const accounts = db.getAllUniqueWatchedTikTok();
  if (accounts.length > 0) {
    console.log(`[TikTok] Polling ${accounts.length} accounts: ${accounts.map(a => a.tiktok_username).join(', ')}`);
  }
  for (const { tiktok_username } of accounts) {
    try {
      const state = db.getTikTokState(tiktok_username);
      const result = await tiktokFeed.check(tiktok_username, state);
      if (!result) { console.log(`[TikTok] ${tiktok_username}: no changes`); continue; }
      if (result.stateUpdate) db.updateTikTokState(tiktok_username, result.stateUpdate);
      if (result.notify && result.items) {
        const watchers = db.getTikTokWatchersForAccount(tiktok_username)
          .filter(w => w.notify_channel_id);
        for (const w of watchers) {
          const tier = db.getStreamerTier(w.streamer_id);
          const tierConfig = config.tiers[tier] || config.tiers.free;
          if (!tierConfig.tiktok) continue;
          for (const item of result.items) {
            try {
              const embed = buildTikTokEmbed({
                username: tiktok_username,
                displayName: w.display_name || tiktok_username,
                profileImageUrl: w.profile_image_url,
                description: item.description,
                videoUrl: item.url,
                thumbnailUrl: item.thumbnailUrl,
                timestamp: item.timestamp,
              });
              await sendNotification(w.notify_channel_id, embed, {
                streamerId: w.streamer_id, guildId: w.guild_id, type: 'tiktok_video',
              });
            } catch (e) {
              console.error(`[TikTok] Send failed for ${tiktok_username} to ${w.guild_id}: ${e.message}`);
            }
          }
        }
      }
    } catch (error) {
      console.error(`[TikTok] Error for ${tiktok_username}: ${error.message}`);
    }
    // Rate limit: 2s between accounts
    if (accounts.length > 1) await new Promise(r => setTimeout(r, 2000));
  }
}

async function pollAllTwitter() {
  const accounts = db.getAllUniqueWatchedTwitter();
  if (accounts.length > 0) {
    console.log(`[Twitter] Polling ${accounts.length} accounts: ${accounts.map(a => a.twitter_username).join(', ')}`);
  }
  for (const { twitter_username } of accounts) {
    try {
      const state = db.getTwitterState(twitter_username);
      console.log(`[Twitter] Checking ${twitter_username}, known tweets: ${(JSON.parse(state.known_tweet_ids || '[]')).length}`);
      const result = await twitterFeed.check(twitter_username, state);
      if (!result) { console.log(`[Twitter] ${twitter_username}: no changes`); continue; }
      if (result.stateUpdate) db.updateTwitterState(twitter_username, result.stateUpdate);
      if (result.notify && result.items) {
        const watchers = db.getTwitterWatchersForAccount(twitter_username)
          .filter(w => w.notify_channel_id);
        for (const w of watchers) {
          const tier = db.getStreamerTier(w.streamer_id);
          const tierConfig = config.tiers[tier] || config.tiers.free;
          if (!tierConfig.twitter) continue;
          for (const item of result.items) {
            try {
              const embed = buildTwitterEmbed({
                username: twitter_username,
                displayName: w.display_name || twitter_username,
                profileImageUrl: w.profile_image_url,
                text: item.text,
                tweetUrl: item.url,
                mediaUrl: item.mediaUrl,
                timestamp: item.timestamp,
              });
              await sendNotification(w.notify_channel_id, embed, {
                streamerId: w.streamer_id, guildId: w.guild_id, type: 'twitter_tweet',
              });
            } catch (e) {
              console.error(`[Twitter] Send failed for ${twitter_username} to ${w.guild_id}: ${e.message}`);
            }
          }
        }
      }
    } catch (error) {
      console.error(`[Twitter] Error for ${twitter_username}: ${error.message}`);
    }
    // Rate limit: 2s between accounts
    if (accounts.length > 1) await new Promise(r => setTimeout(r, 2000));
  }
}

// --- iRacing polling ---

async function pollAllIracingResults() {
  if (!iracing.isConfigured()) return;
  const drivers = db.getAllUniqueWatchedIracingDrivers();
  if (drivers.length > 0) {
    console.log(`[iRacing] Polling ${drivers.length} drivers: ${drivers.map(d => d.customer_id).join(', ')}`);
  }
  for (const { customer_id } of drivers) {
    try {
      const result = await iracingResults.check(customer_id, db);
      if (!result || !result.notify) continue;

      for (const race of result.races) {
        // Cache the race
        db.upsertIracingRaceCache(race);

        // Fan out notifications
        const watchers = db.getIracingWatchersForDriver(customer_id)
          .filter(w => w.notify_channel_id);
        for (const w of watchers) {
          const tier = db.getStreamerTier(w.streamer_id);
          const tierConfig = config.tiers[tier] || config.tiers.free;
          if (!tierConfig.iracing) continue;

          try {
            const embed = buildIracingResultEmbed(race);
            await sendNotification(w.notify_channel_id, embed, {
              streamerId: w.streamer_id,
              guildId: w.guild_id,
              type: 'iracing_result',
            });
          } catch (e) {
            console.error(`[iRacing] Send failed for ${customer_id} to ${w.guild_id}: ${e.message}`);
          }
        }
      }
    } catch (error) {
      console.error(`[iRacing] Error for ${customer_id}: ${error.message}`);
    }
    if (drivers.length > 1) await new Promise(r => setTimeout(r, 2000));
  }
}

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

  setInterval(run.twitchLive, config.intervals.twitchLive);
  setInterval(run.twitchClips, config.intervals.twitchClips);
  setInterval(run.youtubeFeed, config.intervals.youtubeFeed);
  setInterval(run.youtubeLive, config.intervals.youtubeLive);
  setInterval(run.subSync, config.intervals.subSync);
  setInterval(run.weeklyDigest, config.intervals.weeklyDigest);
  // Instagram and TikTok disabled — no reliable free API/scraping available
  // setInterval(pollAllInstagram, config.intervals.instagramFeed);
  // setInterval(pollAllTikTok, config.intervals.tiktokFeed);
  // Twitter disabled — no free API tier available
  // setInterval(pollAllTwitter, config.intervals.twitterFeed);
  // iRacing disabled — OAuth client credentials paused by iRacing
  // setInterval(pollAllIracingResults, config.intervals.iracingResults);

  console.log('[Manager] All pollers started');

  // First poll immediately
  run.twitchLive();
  run.twitchClips();
  run.subSync();
  // Also at once, so that a stream that is on when the server starts gets its chat back
  // within seconds (it does nothing without a YouTube API key).
  run.youtubeLive();
  // pollAllInstagram();
  // pollAllTikTok();
}

module.exports = { startAll, pollAllTwitchLive, pollAllTwitchClips, pollAllYouTubeFeed, pollAllYouTubeLive, pollAllSubSync };
