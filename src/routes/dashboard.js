const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../db');
const { client, fetchGuildChannel, streamerGuildForChannel } = require('../discord');
const {
  canManageGuild, botInviteUrl: inviteUrlFor, subRoleEligibility, roleFacts, botTopRolePosition,
  clampWelcomeMessage, WELCOME_MESSAGE_MAX, DELIVERY_CHANNEL_UNAVAILABLE,
  guildListsAvailable, serverPagePicks,
} = require('../services/discordGuards');
const { getUserProfile } = require('../services/twitch');
const { resolveChannelId, getLatestVideos, getChannelInfo } = require('../services/youtube');
const { requireActiveStreamer, accountDisabledChannel } = require('../services/streamerAccess');
const { normalizeTwitchLogin } = require('../services/twitchLogin');
const { parseOverlaySettings, giveawayDurationSeconds, DEFAULT_DURATION_SECONDS } = require('../services/overlaySettings');
const { isAllowedScreenshot, redemptionMediaError, isAllowedSound } = require('../services/uploadValidation');
const customSounds = require('../services/customSounds');
const storageQuota = require('../services/storageQuota');
const { buildOverlayConfig, channelLettering } = require('../services/overlayConfig');
const {
  TIP_GOAL_CURRENCIES, SETTINGS_ERRORS, GOAL_ERRORS, MIN_AMOUNT_FLOOR, MIN_AMOUNT_CEIL, PAYPAL_EMAIL_MAX,
  parseDonationSettings, parseTipGoalFields, errorMessage, goalCurrencyMismatch,
} = require('../services/donationSettings');
const {
  validateBannedPattern, bannedWordLimitReason, MAX_PATTERN_LENGTH, MAX_BANNED_WORDS, MAX_BANNED_PATTERNS,
} = require('../services/safePattern');
const { sponsorDurationSeconds, sponsorChatIntervalMinutes, sponsorImageScale, moderationNumber, moderationAction, parseSwitch } = require('../services/inputLimits');
const { COMMAND_RESPONSE_MAX, COMMANDS_PER_STREAMER_MAX, COMMAND_ERRORS, parseCommand, singleLine, isUniqueViolation } = require('../services/chatCommands');
const { testCooldown } = require('../services/testCooldown');
const { EVENT_DEFAULTS, OVERLAY_FONTS, isBuilderEventType, validateOverlayDesign } = require('../services/overlayDesign');
const { bundle: alertStyleBundle } = require('../services/alertStyleBundle');
const { ALERTS: STYLED_ALERTS, DEFAULT_STYLES, canUseStyle, familyStyles, galleryFor, familyKeys, soundGroups, secondVersionOf, fontsOf } = require('../services/alertStyles');
const { findStreamThumbnail, youtubeLiveStatus } = require('../services/pageLookups');
const { ANALYSES_PER_DAY, analysisBlockedReason, dailyWindowStart, staleBefore } = require('../services/issueAnalysis');
const { twitchRowsDue, youtubeRowsDue, backfillInBackground } = require('../services/channelInfoBackfill');
const { SYNC_DELETE_FAILED } = require('../services/twitchRewards');
const dashboardSettings = require('../services/dashboardSettings');
const overlayPresence = require('../services/overlayPresence');
const { buildCards, cardTexts } = require('../services/dashboardCards');
const tipVoice = require('../services/tipVoice');
const { TTS_ERRORS, TTS_STATUS_TEXTS, checkTtsSettings, lastErrorKey } = require('../services/ttsSettings');
const { TTS_LANGUAGES, VOICES, defaultVoice, isVoice } = require('../services/ttsVoices');
const { defaultTemplates } = require('../services/tipSpeech');
const { setUserContentHeaders } = require('../services/userContentHeaders');
const { t: translateIn } = require('../i18n');

const router = Router();

// Longest the dashboard home waits for Discord to say whether the person manages
// one unclaimed server.
const UNCLAIMED_CHECK_TIMEOUT_MS = 2500;

// Helper: get tier limits for current user
function getTierLimits(streamerId) {
  const tier = db.getStreamerTier(streamerId);
  return { tier, limits: config.tiers[tier] || config.tiers.free };
}

// Read a raw body but enforce a hard byte cap up front (Content-Length header)
// AND abort the stream if the client tries to send more than the cap. The
// previous pattern accumulated chunks unconditionally and only checked size in
// `end`, so a hostile client could RAM-bomb the process.
function readBoundedBody(req, res, maxBytes) {
  return new Promise((resolve, reject) => {
    const declared = parseInt(req.headers['content-length'] || '0', 10);
    if (declared && declared > maxBytes) {
      res.status(413).json({ ok: false, error: res.locals.t('redemptions.error.fileTooLarge') });
      try { req.destroy(); } catch (e) {}
      return reject(new Error('content-length exceeds cap'));
    }
    const chunks = [];
    let received = 0;
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      received += chunk.length;
      if (received > maxBytes) {
        aborted = true;
        try { req.destroy(); } catch (e) {}
        if (!res.headersSent) res.status(413).json({ ok: false, error: res.locals.t('redemptions.error.fileTooLarge') });
        return reject(new Error('body exceeds cap'));
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!aborted) resolve(Buffer.concat(chunks, received)); });
    req.on('error', (err) => { if (!aborted) { aborted = true; reject(err); } });
  });
}

// An upload is not stored when the data volume (which also holds the database)
// would have less than 200 MB free, or when the streamer's stored media would
// pass 250 MB (services/storageQuota.js). Answers 507 and returns true then.
// `replacing`: the size of the file the upload replaces. `media: false` for the
// files that do not count toward the media quota (profile picture, issue screenshots).
function refuseUpload(req, res, bytes, { replacing = 0, media = true } = {}) {
  const reason = storageQuota.uploadRefusal({ streamerId: req.streamer.id, bytes, replacing, media });
  if (!reason) return false;
  const t = res.locals.t;
  const error = reason === 'disk'
    ? t('upload.error.diskFull')
    : t('upload.error.quota', { mb: Math.round(storageQuota.MEDIA_QUOTA_BYTES / (1024 * 1024)) });
  console.warn(`[Upload] Refused a ${Math.ceil(bytes / 1024)} KB upload for streamer ${req.streamer.id}: ${reason === 'disk' ? 'data volume nearly full' : 'media quota reached'}`);
  res.status(507).json({ ok: false, error });
  return true;
}

// All dashboard routes need a logged-in streamer whose account an admin has not
// disabled (a disabled one is shown the account-disabled page instead).
router.use(requireActiveStreamer);

// A page that exists only for the OBS overlay features (the overlay settings, the Overlay
// Builder, Channel Point Rewards). While config.features.overlays is off
// it sends the streamer back to the dashboard, which no longer links to it. The POST routes
// behind these pages stay as they are: nothing links to them either, and the OBS links
// (/overlay/*, /vtuber/*) are not served from here.
function overlayPage(req, res, next) {
  if (config.features.overlays) return next();
  res.redirect('/dashboard');
}

// The VTuber preview page: only while the VTuber tab is shown (config.features.vtuber, with the overlays).
function vtuberPage(req, res, next) {
  if (config.features.overlays && config.features.vtuber) return next();
  res.redirect('/dashboard');
}

// The same for a page that exists only for YouTube (the YouTube chatbot) while config.features.youtube is off.
// Its POST routes stay as they are, like the overlay pages' ones.
function youtubePage(req, res, next) {
  if (config.features.youtube) return next();
  res.redirect('/dashboard');
}

// The buttons that make the shared bots speak or spend shared API quota share
// one cooldown per streamer (see services/testCooldown.js).
function limitTests(req, res, next) {
  const waitMs = testCooldown.take(req.streamer.id);
  if (waitMs === 0) return next();
  const seconds = Math.ceil(waitMs / 1000);
  res.set('Retry-After', String(seconds));
  res.status(429).json({ ok: false, error: res.locals.t('dashboard.test.tooFast', { seconds }) });
}

// Helper: get text channels for a guild
function getDiscordChannels(guildId) {
  const discordGuild = client.guilds.cache.get(guildId);
  if (!discordGuild) return [];
  return discordGuild.channels.cache
    .filter((c) => c.type === 0)
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Every Discord channel id saved for a server must be one of that server's
// channels (empty ids mean "off" and are fine).
async function channelsInGuild(guildId, channelIds) {
  for (const channelId of channelIds) {
    if (channelId && !(await fetchGuildChannel(guildId, channelId))) return false;
  }
  return true;
}

// Sub sync gives and takes its role, so only a plain role below the bot will do.
async function subRoleUsable(guildId, roleId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return false;
  return subRoleEligibility(roleFacts(guild.roles.cache.get(roleId)), await botTopRolePosition(guild)).ok;
}

// The server's last failed post, while that channel is still used by one of
// its settings (an error about a channel already replaced is not shown).
function lastDeliveryError(guildConfig, channels, twitchWatchers, youtubeWatchers, streamer) {
  const channelId = guildConfig.last_delivery_error_channel_id;
  if (!guildConfig.last_delivery_error || !channelId) return null;
  const inUse = new Set([
    guildConfig.welcome_channel_id,
    streamer.mod_log_discord_enabled ? streamer.mod_log_discord_channel_id : null,
    ...twitchWatchers.flatMap((w) => [w.live_channel_id, w.clips_channel_id]),
    ...youtubeWatchers.flatMap((w) => [w.videos_channel_id, w.live_channel_id]),
  ].filter(Boolean));
  if (!inUse.has(channelId)) return null;
  const known = channels.find((c) => c.id === channelId);
  return {
    channel: known ? `#${known.name}` : channelId,
    when: `${guildConfig.last_delivery_error_at} UTC`,
    unavailable: guildConfig.last_delivery_error === DELIVERY_CHANNEL_UNAVAILABLE,
    error: guildConfig.last_delivery_error,
  };
}

// Claim a guild for this streamer
router.post('/claim/:guildId', async (req, res) => {
  const { guildId } = req.params;
  const discordGuild = client.guilds.cache.get(guildId);
  if (!discordGuild) return res.redirect('/dashboard');

  // A server that anyone has claimed cannot be claimed again.
  if (db.isGuildClaimed(guildId)) {
    return res.redirect('/dashboard?msg=already_claimed');
  }

  // Only someone who may manage the Discord server can claim it (asked fresh).
  if (!(await canManageGuild(discordGuild, req.streamer.discord_user_id, { fresh: true }))) {
    console.warn(`[Dashboard] ${req.streamer.discord_username} cannot manage guild ${guildId}; claim refused`);
    return res.redirect('/dashboard?msg=claim_not_allowed');
  }

  // Asking Discord takes a moment, and another manager may have claimed the
  // server meanwhile. Nothing below waits, so this check and the claim are one step.
  if (db.isGuildClaimed(guildId)) {
    return res.redirect('/dashboard?msg=already_claimed');
  }

  // Check tier guild limit
  const { limits } = getTierLimits(req.streamer.id);
  const currentGuilds = db.getGuildsForStreamer(req.streamer.id);
  if (limits.maxGuilds !== -1 && currentGuilds.length >= limits.maxGuilds) {
    return res.redirect('/dashboard?msg=guild_limit');
  }

  db.upsertGuild(guildId, req.streamer.id, discordGuild.name);
  console.log(`[Dashboard] ${req.streamer.discord_username} claimed guild ${discordGuild.name}`);
  res.redirect(`/dashboard/guild/${guildId}`);
});

// Account page
router.get('/account', (req, res) => {
  const { tier, limits } = getTierLimits(req.streamer.id);
  const stats = db.getStreamerStats(req.streamer.id);
  const notificationsOverTime = db.getStreamerNotificationsOverTime(req.streamer.id, '%Y-%m-%d', 30);
  const notificationsByType = db.getStreamerNotificationsByType(req.streamer.id);
  const subscription = db.getSubscription(req.streamer.id);

  res.render('account', {
    streamer: req.streamer,
    tier,
    limits,
    stats,
    notificationsOverTime,
    notificationsByType,
    subscription,
    feedbackMsg: req.query.feedback,
  });
});

// Upload profile picture (raw body)
router.post('/account/avatar', async (req, res) => {
  const allowed = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
  const ext = (req.query.ext || 'png').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (!allowed.includes(ext)) return res.status(400).json({ ok: false, error: res.locals.t('account.error.invalidType') });

  let buf;
  try { buf = await readBoundedBody(req, res, 2 * 1024 * 1024); }
  catch (e) { return; /* helper already responded */ }
  if (buf.length === 0) return res.status(400).json({ ok: false, error: res.locals.t('account.error.empty') });
  if (refuseUpload(req, res, buf.length, { media: false })) return;

  const streamerId = req.streamer.id;
  const avatarDir = path.join(__dirname, '..', '..', 'data', 'avatars', String(streamerId));
  try { await fs.promises.mkdir(avatarDir, { recursive: true }); } catch (e) {}

  // Delete previous avatar file if exists
  if (req.streamer.profile_picture) {
    const old = path.join(avatarDir, req.streamer.profile_picture);
    try { await fs.promises.unlink(old); } catch (e) {}
  }

  const filename = `avatar_${Date.now()}.${ext}`;
  try { await fs.promises.writeFile(path.join(avatarDir, filename), buf); }
  catch (e) { return res.status(500).json({ ok: false, error: res.locals.t('account.error.writeFailed') }); }
  db.updateProfilePicture(streamerId, filename);
  console.log(`[Dashboard] ${req.streamer.discord_username} uploaded profile picture: ${filename}`);
  res.json({ ok: true, url: `/avatars/${streamerId}/${filename}` });
});

// Remove profile picture
router.delete('/account/avatar', (req, res) => {
  const streamerId = req.streamer.id;
  if (req.streamer.profile_picture) {
    const avatarDir = path.join(__dirname, '..', '..', 'data', 'avatars', String(streamerId));
    const old = path.join(avatarDir, req.streamer.profile_picture);
    if (fs.existsSync(old)) fs.unlinkSync(old);
    db.clearProfilePicture(streamerId);
    console.log(`[Dashboard] ${req.streamer.discord_username} removed profile picture`);
  }
  res.json({ ok: true });
});

// The Twitch tab's "Discord notifications" card: for each server the streamer has claimed, what it posts about
// the streamer's own Twitch channel. Each state is decided as the pollers decide it, from the database and the
// bot's cache only (nothing is asked of Discord or Twitch):
//   goLive, clips  the streamer's own watcher row for the channel in that server: enabled, with its switch on
//                  and a Discord channel (pollers/manager.js); `where` names the channel when the bot sees it;
//   recaps         the server's switch; recaps go into that row's go-live channel;
//   milestones     the same, and they need a working broadcaster authorization: 'wait' without one (the poller
//                  could also use another streamer's who watches the channel; the card does not count on it);
//   highlights     the server's switch, when the server's digest is this streamer's (pollers/weeklyDigest.js:
//                  the lowest streamer id that switched it on there), the channel is in it, and there is a go-live
//                  channel in the server to post in;
//   subRoles       the server's switch and role (pollers/subSync.js); 'wait' without a working authorization.
// `servers`: the dashboard's server rows, each with the bot's view of the server (discordGuild, when it sees it)
// and the streamer's Twitch watcher rows there. `needsReauth`: the authorization stopped working.
function discordNotificationsCard(streamer, servers, { needsReauth }) {
  const login = (streamer.twitch_username || '').toLowerCase();
  const twitchLinked = !!(streamer.twitch_user_id && login);
  const authorized = !!streamer.broadcaster_access_token && !needsReauth;
  const card = {
    twitchLinked,
    servers: [],
    announcing: 0, // servers that post the go-live
    needsAuth: false, // a server waits for the authorization
    authAction: streamer.broadcaster_access_token ? 'reconnect' : 'enable', // the link that gives it
  };
  if (!twitchLinked) return card;

  const digestOwners = new Map(db.getGuildsWithWeeklyHighlights().map((row) => [row.guild_id, row.streamer_id]));
  for (const server of servers) {
    const own = server.watchers.find((w) => w.twitch_username === login && w.enabled);
    const channelName = (id) => {
      const channel = server.discordGuild && server.discordGuild.channels.cache.get(id);
      return channel ? `#${channel.name}` : null;
    };
    const onOff = (on) => (on ? 'on' : 'off');
    const goLive = !!(own && own.notify_live && own.live_channel_id);
    const clips = !!(own && own.notify_clips && own.clips_channel_id);
    const liveChannel = !!(own && own.live_channel_id);
    const row = {
      guildId: server.guild_id,
      name: server.name,
      icon: server.icon,
      botPresent: server.botPresent,
      goLive: { state: onOff(goLive), where: goLive ? channelName(own.live_channel_id) : null },
      clips: { state: onOff(clips), where: clips ? channelName(own.clips_channel_id) : null },
      recaps: onOff(server.recap_enabled && liveChannel),
      milestones: server.milestones_enabled && liveChannel ? (authorized ? 'on' : 'wait') : 'off',
      highlights: onOff(server.weekly_highlights_enabled && own && digestOwners.get(server.guild_id) === streamer.id
        && db.getDigestChannelForGuild(server.guild_id)),
      subRoles: server.sub_sync_enabled && server.sub_role_id ? (authorized ? 'on' : 'wait') : 'off',
      // The working card's switches (services/dashboardCards.js): what each one stores, where the posts go (the
      // channel names, when the bot sees them) and what is set.
      switches: {
        goLive,
        clips,
        recaps: !!server.recap_enabled,
        milestones: !!server.milestones_enabled,
        highlights: !!server.weekly_highlights_enabled,
        subRoles: !!server.sub_sync_enabled,
      },
      liveWhere: liveChannel ? channelName(own.live_channel_id) : null,
      clipsWhere: own && own.clips_channel_id ? channelName(own.clips_channel_id) : null,
      hasLiveChannel: liveChannel,
      hasClipsChannel: !!(own && own.clips_channel_id),
      hasSubRole: !!server.sub_role_id,
      // Its settings page; its Twitch tab, where the channel is added, while nothing of the channel is posted there.
      url: `/dashboard/guild/${server.guild_id}${goLive || clips ? '' : '?tab=twitch'}`,
    };
    if (goLive) card.announcing++;
    if (row.milestones === 'wait' || row.subRoles === 'wait') card.needsAuth = true;
    card.servers.push(row);
  }
  return card;
}

// Reading tips aloud: this month (UTC, 'YYYY-MM'), whose characters count toward the streamer's limit, and the limit
// (the admin's, else the default).
const utcMonth = (now = new Date()) => now.toISOString().slice(0, 7);
const ttsLimitOf = (streamer) => streamer.tts_monthly_limit ?? config.tts.monthlyLimit;

// Everything the Twitch tab's working cards show; services/dashboardCards.js decides each card's state from it.
// `discord` is discordNotificationsCard()'s result. Only our own tables and the bot's caches are read.
function gatherCards(req, discord, lang) {
  const s = req.streamer;
  const { chatManager } = require('../services/twitchChat');
  const { hasRedemptionScope, hasPollsScope } = require('../services/twitch');
  const { livePolls } = require('../services/livePolls');
  const giveaway = db.getActiveGiveaway(s.id);
  return buildCards({
    streamer: s,
    features: config.features,
    now: Date.now(),
    appUrl: config.app.url,
    bot: { connected: chatManager.isConnected(), moderator: chatManager.moderatorStatus(s.id), username: config.bot.twitchUsername },
    overlay: { url: s.overlay_token ? `${config.app.url}/overlay/${s.overlay_token}` : null, open: overlayPresence.isOpen(s.id) },
    discord,
    commands: db.getChatCommands(s.id),
    bannedWords: db.countBannedWords(s.id),
    modActionsThisWeek: db.countModLog(s.id),
    sponsorMessages: db.getSponsorMessages(s.id),
    tips: { recent: db.getDonations(s.id, { sinceDays: 90, limit: 3 }), count90d: db.countDonations(s.id, { sinceDays: 90 }) },
    tipGoal: db.getActiveTipGoal(s.id),
    tts: { available: Boolean(config.tts.apiKey), used: db.getTtsUsage(s.id, utcMonth()), limit: ttsLimitOf(s), lang },
    rewards: db.getRewards(s.id).filter((r) => !isPendingDelete(r)),
    rewardsAccess: { hasScope: hasRedemptionScope(s) },
    pollTemplates: db.getPollTemplates(s.id),
    polls: {
      hasScope: hasPollsScope(s),
      live: livePolls.snapshot(s.id),
      // The bar's texts follow the dashboard's language when the link is copied.
      barUrl: s.overlay_token ? `${config.app.url}/overlay/poll/${s.overlay_token}?lang=${encodeURIComponent(lang || 'en')}` : null,
    },
    giveaway: giveaway ? { ...giveaway, entryCount: db.getEntryCount(giveaway.id) } : null,
    spotifyConnected: !!s.spotify_access_token,
    multistreamAvailable: !!config.multistream.enabled && !!config.features.youtube,
  });
}

// Dashboard home — list guilds
router.get('/', async (req, res) => {
  const guilds = db.getGuildsForStreamer(req.streamer.id);
  const msg = req.query.msg;

  // The bot's view of each server, and the streamer's Twitch watchers there (for the Discord notifications card).
  const serverViews = guilds.map((g) => ({
    discordGuild: client.guilds.cache.get(g.guild_id),
    watchers: db.getWatchedChannelsForGuild(g.guild_id, req.streamer.id),
  }));
  const enrichedGuilds = guilds.map((g, i) => {
    const { discordGuild } = serverViews[i];
    const stats = db.getGuildNotificationStats(req.streamer.id, g.guild_id);
    const twitchCount = serverViews[i].watchers.length;
    const youtubeCount = db.getWatchedYoutubeChannelsForGuild(g.guild_id, req.streamer.id).length;
    const chartData = db.getGuildNotificationsByTypeOverTime(req.streamer.id, g.guild_id, '30d');
    return {
      ...g,
      name: discordGuild?.name || g.guild_name || res.locals.t('dashboard.unknownServer'),
      icon: discordGuild?.iconURL({ size: 64 }) || null,
      botPresent: !!discordGuild,
      stats,
      twitchCount,
      youtubeCount,
      chartData,
    };
  });

  // Servers nobody has claimed yet (including this user), listed only to
  // someone who may manage them — the same check a claim makes. A server whose
  // answer is slow is left off this load (and listed on a later one), so a slow
  // Discord cannot hold the dashboard up.
  const myGuildIds = new Set(guilds.map((g) => g.guild_id));
  const allClaimed = db.getAllClaimedGuildIds();
  const candidates = [...client.guilds.cache.values()].filter((g) => !myGuildIds.has(g.id) && !allClaimed.has(g.id));
  const manageable = await Promise.all(candidates.map((g) =>
    canManageGuild(g, req.streamer.discord_user_id, { timeoutMs: UNCLAIMED_CHECK_TIMEOUT_MS })));
  const unclaimedGuilds = candidates
    .filter((g, i) => manageable[i])
    .map((g) => ({ id: g.id, name: g.name, icon: g.iconURL({ size: 64 }) }));

  // discord.js has no application until the bot's gateway is ready (never, with
  // DISCORD_DISABLED=1); a bot's application id is its OAuth client id.
  const botInviteUrl = inviteUrlFor(client.application?.id ?? config.discord.clientId);

  // Twitch tab data
  const vtuberUrl = req.streamer.overlay_token
    ? `${config.app.url}/vtuber/${req.streamer.overlay_token}`
    : null;

  // 7-day overlay stats for Twitch tab
  let overlayStats = null;
  try { overlayStats = db.getOverlayStats7d(req.streamer.id); } catch (e) {}

  const { needsBroadcasterReauth } = require('../services/twitch');
  const needsReauth = needsBroadcasterReauth(req.streamer);

  const discordNotifications = discordNotificationsCard(req.streamer,
    enrichedGuilds.map((g, i) => ({ ...g, ...serverViews[i] })), { needsReauth });
  const cards = gatherCards(req, discordNotifications, res.locals.lang);

  res.render('dashboard', {
    streamer: req.streamer,
    guilds: enrichedGuilds,
    unclaimedGuilds,
    botInviteUrl,
    msg,
    overlayStats,
    vtuberUrl,
    needsReauth,
    discordNotifications,
    cards,
    wideLayout: true, // header.ejs: the dashboard uses the wide container
    // The Multistream card is shown only once the relay is configured, and while YouTube is shown (it streams
    // to Twitch and YouTube).
    multistreamAvailable: !!config.multistream.enabled && !!config.features.youtube,
  });
});

// The working cards' status lines and counts after a change (public/js/dashboard-cards.js asks after each save).
router.get('/api/cards', (req, res) => {
  const { needsBroadcasterReauth } = require('../services/twitch');
  const servers = db.getGuildsForStreamer(req.streamer.id).map((g) => {
    const discordGuild = client.guilds.cache.get(g.guild_id);
    return {
      ...g,
      name: discordGuild?.name || g.guild_name || res.locals.t('dashboard.unknownServer'),
      icon: null,
      botPresent: !!discordGuild,
      discordGuild,
      watchers: db.getWatchedChannelsForGuild(g.guild_id, req.streamer.id),
    };
  });
  const discord = discordNotificationsCard(req.streamer, servers, { needsReauth: needsBroadcasterReauth(req.streamer) });
  res.json({ ok: true, cards: cardTexts(gatherCards(req, discord, res.locals.lang), res.locals.t) });
});

// Disconnect Spotify (the Spotify card): the stored tokens are cleared, so !song answers that Spotify is not
// connected until the streamer connects again.
router.post('/spotify/disconnect', (req, res) => {
  db.updateSpotifyTokens(req.streamer.id, null, null, null);
  res.redirect('/dashboard?msg=spotify_disconnected');
});

// Guild stats page
router.get('/guild/:guildId/stats', (req, res) => {
  const { guildId } = req.params;
  const guildConfig = db.getGuildConfig(guildId, req.streamer.id);
  if (!guildConfig) return res.redirect('/dashboard');

  const discordGuild = client.guilds.cache.get(guildId);
  const period = req.query.period || '7d';
  const stats = db.getGuildStatsByPeriod(req.streamer.id, guildId, period);
  const chartData = db.getGuildNotificationsOverTime(req.streamer.id, guildId, period);
  const twitchCount = db.getWatchedChannelsForGuild(guildId, req.streamer.id).length;
  const youtubeCount = db.getWatchedYoutubeChannelsForGuild(guildId, req.streamer.id).length;

  res.render('guild-stats', {
    streamer: req.streamer,
    guild: guildConfig,
    guildName: discordGuild?.name || guildConfig.guild_name || 'Unknown',
    guildId,
    period,
    stats,
    chartData,
    twitchCount,
    youtubeCount,
  });
});

// The tabs of the server page (the YouTube one only while config.features.youtube is on). ?tab= may name one;
// the page prints it into its script, so anything else (a repeated parameter, any other text) counts as none.
const GUILD_PAGE_TABS = ['twitch', 'youtube', 'discord', 'iracing', 'settings'];
const guildPageTabs = () => (config.features.youtube ? GUILD_PAGE_TABS : GUILD_PAGE_TABS.filter((tab) => tab !== 'youtube'));

// Guild config page
router.get('/guild/:guildId', async (req, res) => {
  const { guildId } = req.params;
  const guildConfig = db.getGuildConfig(guildId, req.streamer.id);
  if (!guildConfig) return res.redirect('/dashboard');

  const discordGuild = client.guilds.cache.get(guildId);
  const channels = getDiscordChannels(guildId);
  // Before the bot is ready (the first seconds after a deploy), during a Discord
  // outage or after its login was refused, the cache holds no channels or roles:
  // the page says so, and a save keeps the stored welcome channel and role.
  const discordListsUnavailable = !guildListsAvailable(discordGuild);
  // Only roles sub sync may give and take; a saved role that no longer
  // qualifies is reported (sub sync skips it) instead of silently dropped.
  let roles = [];
  let subRoleProblem = null;
  if (discordGuild) {
    const botTop = await botTopRolePosition(discordGuild);
    roles = discordGuild.roles.cache
      .filter((r) => subRoleEligibility(roleFacts(r), botTop).ok)
      .map((r) => ({ id: r.id, name: r.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (guildConfig.sub_role_id) {
      const saved = subRoleEligibility(roleFacts(discordGuild.roles.cache.get(guildConfig.sub_role_id)), botTop);
      if (!saved.ok) subRoleProblem = saved.reason;
    }
  }

  // Live status only reads our own tables. A missing picture or name is not looked up
  // here (Twitch and YouTube would hold the page up): see the backfill below.
  const watchedTwitchChannels = db.getWatchedChannelsForGuild(guildId, req.streamer.id);
  for (const wc of watchedTwitchChannels) {
    wc.is_live = db.getChannelState(wc.twitch_username)?.is_live === 1;
  }
  const watchedYoutubeChannels = db.getWatchedYoutubeChannelsForGuild(guildId, req.streamer.id);
  for (const wc of watchedYoutubeChannels) {
    wc.is_live = db.getYoutubeChannelState(wc.youtube_channel_id)?.is_live === 1;
  }

  // Rows missing a picture (or a YouTube name) that have not been tried in the last 24 h.
  const missingInfo = {
    twitchRows: twitchRowsDue(watchedTwitchChannels),
    youtubeRows: youtubeRowsDue(watchedYoutubeChannels),
  };

  const { tier, limits } = getTierLimits(req.streamer.id);
  // The tab the address names (after a save, or from a dashboard link); the page opens it ahead of the one
  // picked last time.
  const requestedTab = guildPageTabs().includes(req.query.tab) ? req.query.tab : null;

  // Once the page has been sent, look the missing ones up; they show on the next load.
  if (missingInfo.twitchRows.length || missingInfo.youtubeRows.length) {
    res.once('finish', () => {
      try {
        backfillInBackground(missingInfo, { db, getUserProfile, getChannelInfo })
          .catch((e) => console.error('[Dashboard] Channel info backfill failed:', e.message));
      } catch (e) {
        console.error('[Dashboard] Channel info backfill failed:', e.message);
      }
    });
  }

  res.render('guild-config', {
    streamer: req.streamer,
    guild: guildConfig,
    guildName: discordGuild?.name || guildConfig.guild_name || 'Unknown',
    guildId,
    channels,
    roles,
    subRoleProblem,
    discordListsUnavailable,
    welcomeMessageMax: WELCOME_MESSAGE_MAX,
    deliveryError: lastDeliveryError(guildConfig, channels, watchedTwitchChannels, watchedYoutubeChannels, req.streamer),
    watchedTwitchChannels,
    watchedYoutubeChannels,
    maxTwitchChannels: config.limits.twitchChannelsPerGuild,
    hasBroadcasterToken: !!req.streamer.broadcaster_access_token,
    broadcasterAuthUrl: `${config.app.url}/auth/broadcaster`,
    tier,
    limits,
    msg: req.query.msg,
    saved: req.query.saved,
    requestedTab,
    activeTab: requestedTab || 'twitch',
  });
});

// Save guild config
router.post('/guild/:guildId', async (req, res) => {
  const { guildId } = req.params;
  const guildConfig = db.getGuildConfig(guildId, req.streamer.id);
  if (!guildConfig) return res.redirect('/dashboard');

  // The page's channel and role pickers come from Discord's cache. When the bot
  // cannot see the server they were empty, so what the form sent says nothing:
  // the stored welcome channel and sub role stay, and the other fields are saved.
  const { welcomeChannelId, subRoleId, kept } = serverPagePicks(
    guildListsAvailable(client.guilds.cache.get(guildId)), guildConfig, req.body,
  );
  if (!kept) {
    if (!(await channelsInGuild(guildId, [welcomeChannelId]))) {
      return res.redirect(`/dashboard/guild/${guildId}?tab=discord&msg=invalid_channel`);
    }
    if (subRoleId && !(await subRoleUsable(guildId, subRoleId))) {
      return res.redirect(`/dashboard/guild/${guildId}?tab=discord&msg=invalid_role`);
    }
  }

  db.updateGuildConfig(guildId, req.streamer.id, {
    // Legacy columns: not editable on the page and never used for posting,
    // so they keep their stored values instead of whatever the form sends.
    twitch_live_channel_id: guildConfig.twitch_live_channel_id,
    twitch_clips_channel_id: guildConfig.twitch_clips_channel_id,
    youtube_channel_id: guildConfig.youtube_channel_id,
    welcome_channel_id: welcomeChannelId,
    sub_role_id: subRoleId,
    welcome_message: clampWelcomeMessage(req.body.welcome_message) || null,
    twitch_live_enabled: req.body.twitch_live_enabled === 'on',
    twitch_clips_enabled: req.body.twitch_clips_enabled === 'on',
    // A hidden field the page sends only while YouTube is shown (config.features.youtube): a save without it
    // keeps the stored value.
    youtube_enabled: req.body.youtube_enabled === undefined ? !!guildConfig.youtube_enabled : req.body.youtube_enabled === 'on',
    welcome_enabled: req.body.welcome_enabled === 'on',
    sub_sync_enabled: req.body.sub_sync_enabled === 'on',
    recap_enabled: req.body.recap_enabled === 'on',
    milestones_enabled: req.body.milestones_enabled === 'on',
    weekly_highlights_enabled: req.body.weekly_highlights_enabled === 'on',
    instagram_enabled: req.body.instagram_enabled === 'on',
    tiktok_enabled: req.body.tiktok_enabled === 'on',
    twitter_enabled: req.body.twitter_enabled === 'on',
    iracing_enabled: req.body.iracing_enabled === 'on',
  });

  console.log(`[Dashboard] Guild ${guildId} config updated by ${req.streamer.discord_username}`);
  res.redirect(`/dashboard/guild/${guildId}?tab=discord&saved=1`);
});

// Remove a guild
router.post('/guild/:guildId/remove', async (req, res) => {
  const { guildId } = req.params;
  if (!db.getGuildConfig(guildId, req.streamer.id)) return res.redirect('/dashboard');
  db.deleteGuild(guildId, req.streamer.id);
  // Several streamers can share a server: the bot leaves only once nobody
  // has it claimed any more.
  if (!db.isGuildClaimed(guildId)) {
    try { await client.guilds.cache.get(guildId)?.leave(); } catch (e) { console.error('[Dashboard] Failed to leave guild:', e.message); }
  }
  console.log(`[Dashboard] ${req.streamer.discord_username} removed guild ${guildId}`);
  res.redirect('/dashboard?msg=guild_removed');
});

// --- Watched Twitch Channels ---

router.get('/guild/:guildId/channels', (req, res) => {
  res.redirect(`/dashboard/guild/${req.params.guildId}?tab=twitch`);
});

// Adds a Twitch channel to a server's list. The name is cleaned up and checked
// before Twitch is asked, only a channel Twitch knows is added, and the page
// says what happened: msg=added, or not_found / duplicate / channel_limit /
// twitch_error / invalid_channel / missing_fields.
router.post('/guild/:guildId/channels', async (req, res) => {
  const { guildId } = req.params;
  if (!db.getGuildConfig(guildId, req.streamer.id)) return res.redirect('/dashboard');
  const back = (msg) => res.redirect(`/dashboard/guild/${guildId}?tab=twitch&msg=${msg}`);

  const typedName = typeof req.body.twitch_username === 'string' ? req.body.twitch_username.trim() : '';
  const liveChannelId = req.body.live_channel_id;
  const clipsChannelId = req.body.clips_channel_id;

  if (!typedName || (!liveChannelId && !clipsChannelId)) return back('missing_fields');
  const twitchUsername = normalizeTwitchLogin(typedName);
  if (!twitchUsername) return back('not_found'); // not something a Twitch channel can be called
  if (!(await channelsInGuild(guildId, [liveChannelId, clipsChannelId]))) return back('invalid_channel');

  // A server that is already over the cap keeps what it has; it just cannot add more.
  const atCap = () => db.getWatchedChannelsForGuild(guildId, req.streamer.id).length >= config.limits.twitchChannelsPerGuild;
  if (db.getWatchedChannelsForGuild(guildId, req.streamer.id).some((w) => w.twitch_username === twitchUsername)) return back('duplicate');
  if (atCap()) return back('channel_limit');

  let profile;
  try {
    profile = await getUserProfile(twitchUsername);
  } catch (e) {
    console.error(`[Dashboard] Twitch lookup for ${twitchUsername} failed: ${e.message}`);
    return back('twitch_error');
  }
  if (!profile) return back('not_found');

  // Twitch took a moment: look at the cap again before adding.
  if (atCap()) return back('channel_limit');
  if (!db.addWatchedChannel(guildId, req.streamer.id, twitchUsername, liveChannelId, clipsChannelId, !!liveChannelId, !!clipsChannelId, profile.profile_image_url || null)) {
    return back('duplicate'); // added by a request that arrived first
  }
  console.log(`[Dashboard] Added Twitch channel ${twitchUsername} for guild ${guildId}`);
  back('added');
});

router.post('/guild/:guildId/channels/:channelId/remove', (req, res) => {
  const { guildId, channelId } = req.params;
  db.removeWatchedChannel(parseInt(channelId), req.streamer.id);
  res.redirect(`/dashboard/guild/${guildId}?tab=twitch&msg=removed`);
});

router.post('/guild/:guildId/channels/:channelId/edit', async (req, res) => {
  const { guildId, channelId } = req.params;
  if (!db.getGuildConfig(guildId, req.streamer.id)) return res.redirect('/dashboard');
  // The form's channel lists come from Discord's cache: when the bot cannot see
  // the server they are empty and a save would switch both channels off. The
  // page says why nothing changed.
  if (!guildListsAvailable(client.guilds.cache.get(guildId))) return res.redirect(`/dashboard/guild/${guildId}?tab=twitch`);
  const liveChannelId = req.body.live_channel_id || null;
  const clipsChannelId = req.body.clips_channel_id || null;
  if (!(await channelsInGuild(guildId, [liveChannelId, clipsChannelId]))) {
    return res.redirect(`/dashboard/guild/${guildId}?tab=twitch&msg=invalid_channel`);
  }
  console.log(`[Dashboard] Editing Twitch channel ${channelId}: live=${liveChannelId}, clips=${clipsChannelId}`);
  if (!db.updateWatchedChannel(parseInt(channelId), req.streamer.id, guildId, liveChannelId, clipsChannelId)) {
    return res.redirect(`/dashboard/guild/${guildId}?tab=twitch`); // not a watcher of this server
  }
  console.log(`[Dashboard] Updated Twitch channel ${channelId} for guild ${guildId}`);
  res.redirect(`/dashboard/guild/${guildId}?tab=twitch&msg=updated`);
});

// --- Watched YouTube Channels ---

router.get('/guild/:guildId/youtube', (req, res) => {
  res.redirect(`/dashboard/guild/${req.params.guildId}?tab=youtube`);
});

router.post('/guild/:guildId/youtube', async (req, res) => {
  const { guildId } = req.params;
  if (!db.getGuildConfig(guildId, req.streamer.id)) return res.redirect('/dashboard');

  const input = (req.body.youtube_channel || '').trim();
  const videosChannelId = req.body.videos_channel_id;
  const liveChannelId = req.body.live_channel_id;

  if (!input || (!videosChannelId && !liveChannelId)) {
    return res.redirect(`/dashboard/guild/${guildId}?tab=youtube&msg=missing_fields`);
  }
  if (!(await channelsInGuild(guildId, [videosChannelId, liveChannelId]))) {
    return res.redirect(`/dashboard/guild/${guildId}?tab=youtube&msg=invalid_channel`);
  }

  // Resolve @handle or channel ID
  let ytChannelId, ytChannelName, ytProfileImage;
  try {
    const resolved = await resolveChannelId(input);
    if (!resolved) {
      return res.redirect(`/dashboard/guild/${guildId}?tab=youtube&msg=yt_not_found`);
    }
    ytChannelId = resolved.channelId;
    ytChannelName = resolved.channelName || input;
    ytProfileImage = resolved.profileImageUrl || null;
  } catch (e) {
    console.error(`[Dashboard] YouTube resolve error: ${e.message}`);
    return res.redirect(`/dashboard/guild/${guildId}?tab=youtube&msg=yt_not_found`);
  }

  // Pre-populate known videos to avoid notifying about old content
  let knownVideoIds = null;
  try {
    const existingVideos = await getLatestVideos(ytChannelId);
    if (existingVideos.length > 0) {
      knownVideoIds = JSON.stringify(existingVideos.map(v => v.id));
    }
  } catch (e) {
    console.warn(`[Dashboard] Failed to fetch initial videos for ${ytChannelId}: ${e.message}`);
  }

  db.addWatchedYoutubeChannel(guildId, req.streamer.id, ytChannelId, ytChannelName, videosChannelId, liveChannelId, knownVideoIds);

  // Save profile image if available
  if (ytProfileImage) {
    const added = db.getWatchedYoutubeChannelsForGuild(guildId, req.streamer.id);
    const match = added.find(c => c.youtube_channel_id === ytChannelId);
    if (match) db.updateWatchedYoutubeChannelInfo(match.id, ytProfileImage, ytChannelName);
  }

  console.log(`[Dashboard] Added YouTube channel ${ytChannelId} (${ytChannelName}) for guild ${guildId}`);
  res.redirect(`/dashboard/guild/${guildId}?tab=youtube&msg=added`);
});

router.post('/guild/:guildId/youtube/:channelId/remove', (req, res) => {
  const { guildId, channelId } = req.params;
  db.removeWatchedYoutubeChannel(parseInt(channelId), req.streamer.id);
  res.redirect(`/dashboard/guild/${guildId}?tab=youtube&msg=removed`);
});

router.post('/guild/:guildId/youtube/:channelId/edit', async (req, res) => {
  const { guildId, channelId } = req.params;
  if (!db.getGuildConfig(guildId, req.streamer.id)) return res.redirect('/dashboard');
  if (!guildListsAvailable(client.guilds.cache.get(guildId))) return res.redirect(`/dashboard/guild/${guildId}?tab=youtube`); // as the Twitch edit above
  const videosChannelId = req.body.videos_channel_id || null;
  const liveChannelId = req.body.live_channel_id || null;
  if (!(await channelsInGuild(guildId, [videosChannelId, liveChannelId]))) {
    return res.redirect(`/dashboard/guild/${guildId}?tab=youtube&msg=invalid_channel`);
  }
  if (!db.updateWatchedYoutubeChannel(parseInt(channelId), req.streamer.id, guildId, videosChannelId, liveChannelId)) {
    return res.redirect(`/dashboard/guild/${guildId}?tab=youtube`); // not a watcher of this server
  }
  console.log(`[Dashboard] Updated YouTube channel ${channelId} for guild ${guildId}`);
  res.redirect(`/dashboard/guild/${guildId}?tab=youtube&msg=updated`);
});

// --- Feedback ---

router.post('/feedback', (req, res) => {
  const rating = parseInt(req.body.rating);
  const message = (req.body.message || '').trim();

  if (!rating || rating < 1 || rating > 5 || !message) {
    return res.redirect('/dashboard/account');
  }

  db.createFeedback(
    req.streamer.id,
    req.streamer.discord_display_name || req.streamer.discord_username,
    rating,
    message
  );
  console.log(`[Dashboard] Feedback from ${req.streamer.discord_username}: ${rating}/5`);
  res.redirect('/dashboard/account?feedback=submitted');
});

// --- Overlay Config ---

// Overlay config page
router.get('/overlay', overlayPage, (req, res) => {
  const streamer = req.streamer;
  const appUrl = config.app.url || `${req.protocol}://${req.get('host')}`;
  const overlayUrl = streamer.overlay_token ? `${appUrl}/overlay/${streamer.overlay_token}` : null;
  const needsReauth = require('../services/twitch').needsBroadcasterReauth(streamer);

  // The StreamElements token is never sent to the page: it only learns whether
  // one is saved (and offers to remove it).
  const { streamelements_jwt: savedJwt, ...pageStreamer } = streamer;

  res.render('overlay-config', {
    streamer: pageStreamer,
    hasStreamElementsJwt: !!savedJwt,
    giveawayDurationSeconds: giveawayDurationSeconds(streamer.overlay_giveaway_duration),
    durationDefaults: DEFAULT_DURATION_SECONDS,
    overlayUrl,
    needsReauth,
    appUrl,
  });
});

// EventSub (the Twitch events behind the overlay's alerts and the chatbot's
// thank-yous), StreamElements and the sponsor rotation run while the overlay or
// the chatbot is on; the managers start them at boot on the same rule
// (db.getOverlayOrChatbotStreamers). A save that changes one of the two
// switches goes through here: `wasNeeded` and `needed` say whether either was
// on before and is on after. They are started when the first of the two comes
// on, stopped when the last one goes off, and left alone while the other switch
// keeps them needed. Settings reach an open OBS source as they are saved, so
// nothing else reconnects Twitch (a restart drops events for a second or two);
// the StreamElements connection also follows its token, when that is added,
// replaced or removed (streamElementsChanged).
function syncLiveConnections(streamerId, { wasNeeded, needed, streamElementsJwt, streamElementsChanged = false }) {
  // Each step runs on its own, so one that fails does not keep the others from running.
  const attempt = (what, fn) => {
    try { fn(); } catch (e) { console.error(`[Dashboard] ${what} failed for streamer ${streamerId}:`, e.message); }
  };
  const { eventSubManager } = require('../services/eventsub');
  const { streamElementsManager } = require('../services/streamelements');
  const { timedNotificationManager } = require('../services/timedNotifications');
  if (needed) {
    if (!wasNeeded) {
      attempt('Starting EventSub', () => eventSubManager.startForStreamer(streamerId));
      attempt('Starting the sponsor rotation', () => {
        timedNotificationManager.restartForStreamer(streamerId);
        timedNotificationManager.restartChatForStreamer(streamerId);
      });
    }
    if (!wasNeeded || streamElementsChanged) {
      if (streamElementsJwt) attempt('Starting StreamElements', () => streamElementsManager.startForStreamer(streamerId));
      else if (streamElementsChanged) attempt('Stopping StreamElements', () => streamElementsManager.stopForStreamer(streamerId)); // token removed
    }
  } else {
    attempt('Stopping EventSub', () => eventSubManager.stopForStreamer(streamerId));
    attempt('Stopping StreamElements', () => streamElementsManager.stopForStreamer(streamerId));
    attempt('Stopping the sponsor rotation', () => timedNotificationManager.stopForStreamer(streamerId));
  }
}

// Save overlay settings. Toggles, durations and volume are read and bounded by
// parseOverlaySettings; a blank StreamElements field keeps the stored token.
router.post('/overlay', (req, res) => {
  const { columns, streamElementsJwt } = parseOverlaySettings(req.body, req.streamer);
  // Whether the overlay was on before this save: the connections were started
  // then (at boot, or by the save that switched it on). The chatbot has its own
  // page, so its switch is as stored.
  const wasEnabled = !!req.streamer.overlay_enabled;
  const chatbotOn = !!req.streamer.chatbot_enabled;
  db.updateOverlayConfig(req.streamer.id, columns);
  pushOverlayConfig(req.streamer.id);

  syncLiveConnections(req.streamer.id, {
    wasNeeded: wasEnabled || chatbotOn,
    needed: !!columns.overlay_enabled || chatbotOn,
    streamElementsJwt,
    streamElementsChanged: 'streamelements_jwt' in columns,
  });

  res.redirect('/dashboard/overlay');
});

// Generate overlay token
router.post('/overlay/generate-token', (req, res) => {
  db.generateOverlayToken(req.streamer.id);
  // The old link stops working: a source that is already open on it is ended
  // too (the streamer updates OBS with the new link), instead of carrying on
  // with a link that is no longer theirs to use. Same channel as a disabled account.
  require('../services/overlayBus').emit(accountDisabledChannel(req.streamer.id));
  res.redirect('/dashboard/overlay');
});

// The sample alert each "Preview Alert" button plays on the streamer's own overlay.
// Every alert type the overlay settings page lists is here: the five Twitch ones
// (which also post their thank-you in Twitch chat), the giveaway winner (the shape
// giveawayManager.pickWinners() emits) and the three YouTube ones (YOUTUBE_TEST_EVENTS).
const TWITCH_ALERT_TYPES = ['follow', 'subscription', 'bits', 'donation', 'raid'];
const YOUTUBE_TEST_EVENTS = {
  yt_superchat: { type: 'yt_superchat', data: { username: 'TestViewer', amount: '$10.00', message: 'Great stream!' } },
  yt_member: { type: 'yt_member', data: { username: 'NewFan', level: 'Member' } },
  yt_giftmember: { type: 'yt_giftmember', data: { username: 'GenerousViewer', amount: 5, level: 'Member' } },
};
const OVERLAY_TEST_EVENTS = {
  follow: { type: 'follow', data: { username: 'TestRacer' } },
  subscription: { type: 'subscription', data: { username: 'SpeedDemon', message: 'Love the stream!', tier: '1', months: 6 } },
  bits: { type: 'bits', data: { username: 'NitroFan', amount: 500, message: 'Take my bits!' } },
  donation: { type: 'donation', data: { username: 'BigSponsor', amount: 25, message: 'Keep racing!', currency: 'USD' } },
  raid: { type: 'raid', data: { username: 'RaidLeader', viewers: 42 } },
  giveaway_winner: { type: 'giveaway_winner', data: { username: 'LuckyViewer', prize: 'Signed poster', keyword: 'giveaway' } },
  ...YOUTUBE_TEST_EVENTS,
};

// A type the overlay does not have is refused before the shared cooldown starts,
// so a refused click does not hold up the next test.
function knownOverlayTestType(req, res, next) {
  if (!Object.hasOwn(OVERLAY_TEST_EVENTS, req.params.eventType)) {
    return res.status(400).json({ error: res.locals.t('overlay.test.invalidType') });
  }
  next();
}

// A test alert while the overlay switch is off would not reach the stream (routes/overlay.js): say so instead.
function overlayOn(req, res, next) {
  if (req.streamer.overlay_enabled) return next();
  res.status(409).json({ ok: false, code: 'overlay_off', error: res.locals.t('dashboard.settings.error.overlayOff') });
}

// Test notification
router.post('/overlay/test/:eventType', knownOverlayTestType, overlayOn, limitTests, (req, res) => {
  const bus = require('../services/overlayBus');
  const type = req.params.eventType;
  const event = OVERLAY_TEST_EVENTS[type];

  // Fire overlay alert (a copy: the samples above are shared by every request)
  bus.emit(`overlay:${req.streamer.id}`, { ...event, data: { ...event.data } });

  // Fire chatbot message in sync (a test is never merged with real thank-yous).
  // Only the Twitch alerts have a thank-you in Twitch chat; the Overlay Builder's Test (chat: false)
  // only plays the alert, so trying looks never posts in a live channel.
  if (TWITCH_ALERT_TYPES.includes(type) && !(req.body && req.body.chat === false)) {
    const { chatManager } = require('../services/twitchChat');
    chatManager.sendEventMessage(req.streamer.id, type, event.data, { test: true });
  }

  res.json({ ok: true });
});

// Send the streamer's open overlays their saved settings (which alerts are on,
// how long they stay, the volume), so a save applies to the next alert without
// reloading the OBS browser source. Built by the same function a newly opened
// overlay gets its config from.
function pushOverlayConfig(streamerId) {
  const streamer = db.getStreamerById(streamerId);
  if (!streamer) return;
  require('../services/overlayBus').emit(`overlay:${streamerId}`, {
    type: 'config-update',
    config: buildOverlayConfig(streamer),
  });
}

// What follows a working card's save (POST /dashboard/settings), once per save: the chat bot joins or leaves
// the channel, the Twitch event connections start or stop (needed while the overlay or the chatbot is on),
// an open OBS overlay gets the new settings, the sponsor chat rotation restarts.
function runSettingFollowUps({ before, after, steps }) {
  const id = after.id;
  if (steps.has('connections')) {
    if (!!before.chatbot_enabled !== !!after.chatbot_enabled) {
      try {
        const { chatManager } = require('../services/twitchChat');
        if (after.chatbot_enabled) chatManager.startForStreamer(id);
        else chatManager.stopForStreamer(id);
      } catch (e) {
        console.error('[Dashboard] Chatbot start/stop error:', e.message);
      }
    }
    const wasNeeded = !!(before.overlay_enabled || before.chatbot_enabled);
    const needed = !!(after.overlay_enabled || after.chatbot_enabled);
    if (wasNeeded !== needed) syncLiveConnections(id, { wasNeeded, needed, streamElementsJwt: after.streamelements_jwt });
  }
  if (steps.has('overlay')) {
    try {
      pushOverlayConfig(id);
    } catch (e) {
      console.error('[Dashboard] Overlay config push failed:', e.message);
    }
  }
  if (steps.has('sponsorChat')) {
    try {
      const { timedNotificationManager } = require('../services/timedNotifications');
      timedNotificationManager.restartChatForStreamer(id);
    } catch (e) {
      console.error('[Dashboard] Sponsor chat restart failed:', e.message);
    }
  }
}

// A working card's switch, number or short text, saved as it changes: one setting, or a few at once
// ({ changes }). services/dashboardSettings.js lists what may be saved and checks it.
router.post('/settings', (req, res) => {
  const result = dashboardSettings.save(req.streamer, req.body, {
    db, followUps: { run: runSettingFollowUps }, ttsAvailable: Boolean(config.tts.apiKey),
  });
  if (!result.ok) {
    return res.status(result.status).json({ ok: false, code: result.code, error: res.locals.t(dashboardSettings.ERRORS[result.code].text) });
  }
  if (Array.isArray((req.body || {}).changes)) return res.json({ ok: true, values: result.values });
  const [value] = Object.values(result.values);
  res.json({ ok: true, value });
});

// ── The working cards' text routes (JSON) ──

// A Commands card refusal: the chatbot page's texts, plus the limit and a command that is not there.
function commandJsonError(res, status, code) {
  const key = code === 'not_found' ? 'dashboard.settings.error.notFound'
    : code === 'too_many' ? 'chatbot.commands.error.tooMany'
      : COMMAND_ERRORS[code];
  const max = code === 'too_many' ? COMMANDS_PER_STREAMER_MAX : COMMAND_RESPONSE_MAX;
  res.status(status).json({ ok: false, code, error: res.locals.t(key, { max }) });
}

router.post('/api/commands', (req, res) => {
  const parsed = parseCommand(req.body);
  if (parsed.error) return commandJsonError(res, 400, parsed.error);
  if (db.countChatCommands(req.streamer.id) >= COMMANDS_PER_STREAMER_MAX) return commandJsonError(res, 409, 'too_many');
  try {
    const info = db.addChatCommand(req.streamer.id, parsed.command, parsed.response, parsed.cooldown);
    res.status(201).json({ ok: true, command: db.getChatCommandById(Number(info.lastInsertRowid), req.streamer.id) });
  } catch (e) {
    if (isUniqueViolation(e)) return commandJsonError(res, 409, 'duplicate');
    throw e;
  }
});

router.patch('/api/commands/:id', (req, res) => {
  const row = db.getChatCommandById(Number(req.params.id), req.streamer.id);
  if (!row) return commandJsonError(res, 404, 'not_found');
  const b = req.body || {};
  const parsed = parseCommand({
    command: b.command !== undefined ? b.command : row.command,
    response: b.response !== undefined ? b.response : row.response,
    cooldown: b.cooldown !== undefined ? b.cooldown : row.cooldown,
  });
  if (parsed.error) return commandJsonError(res, 400, parsed.error);
  try {
    db.updateChatCommand(row.id, req.streamer.id, parsed.command, parsed.response, row.enabled, parsed.cooldown);
  } catch (e) {
    if (isUniqueViolation(e)) return commandJsonError(res, 409, 'duplicate');
    throw e;
  }
  res.json({ ok: true, command: db.getChatCommandById(row.id, req.streamer.id) });
});

router.delete('/api/commands/:id', (req, res) => {
  if (!db.deleteChatCommand(Number(req.params.id), req.streamer.id)) return commandJsonError(res, 404, 'not_found');
  res.json({ ok: true });
});

// The Polls & predictions card's JSON routes (routes/polls.js), behind this router's login.
router.use(require('./polls'));

// The Donations card's tip goal: start, edit (title and target; the bar keeps its colour) and end.
function goalJsonError(res, status, code) {
  res.status(status).json({ ok: false, code, error: errorMessage(GOAL_ERRORS, code, res.locals.t) });
}

router.post('/api/tip-goal', (req, res) => {
  const b = req.body || {};
  const fields = parseTipGoalFields({ title: b.title, target_amount: b.target_amount });
  if (fields.error) return goalJsonError(res, 400, fields.error);
  const currency = TIP_GOAL_CURRENCIES.includes(req.streamer.donation_currency) ? req.streamer.donation_currency : 'EUR';
  const goal = db.createTipGoal(req.streamer.id, { ...fields, currency, current_amount: 0 });
  require('../services/tipGoals').broadcast(req.streamer.id);
  res.status(201).json({ ok: true, goal });
});

router.patch('/api/tip-goal', (req, res) => {
  const goal = db.getActiveTipGoal(req.streamer.id);
  if (!goal) return goalJsonError(res, 404, 'not_found');
  const b = req.body || {};
  const fields = parseTipGoalFields({
    title: b.title !== undefined ? b.title : goal.title,
    target_amount: b.target_amount !== undefined ? b.target_amount : goal.target_amount,
    bar_color: goal.bar_color,
  });
  if (fields.error) return goalJsonError(res, 400, fields.error);
  const updated = db.updateTipGoal(goal.id, req.streamer.id, fields);
  require('../services/tipGoals').broadcast(req.streamer.id);
  res.json({ ok: true, goal: updated });
});

router.post('/api/tip-goal/end', (req, res) => {
  const goal = db.getActiveTipGoal(req.streamer.id);
  if (!goal) return goalJsonError(res, 404, 'not_found');
  db.endTipGoal(goal.id, req.streamer.id);
  require('../services/tipGoals').broadcast(req.streamer.id);
  res.json({ ok: true });
});

// Custom alert sounds live in the logged-in streamer's own folder
// (data/sounds/<streamerId>/), never in a folder shared with other streamers.

// Send the streamer's open overlays their new sound URLs, so the next alert
// uses the changed sound without reloading the OBS browser source.
function pushSoundUrls(streamer) {
  require('../services/overlayBus').emit(`overlay:${streamer.id}`, {
    type: 'config-update',
    sounds: customSounds.soundUrls(streamer),
  });
}

// Upload custom sound for an event type
router.post('/overlay/sounds/:eventType', async (req, res) => {
  const t = res.locals.t;
  const file = customSounds.soundFilePath(req.streamer.id, req.params.eventType);
  if (!file) return res.status(400).json({ error: t('overlay.sounds.error.invalidType') });

  let buf;
  try { buf = await readBoundedBody(req, res, 10 * 1024 * 1024); }
  catch (e) { return; }
  if (!isAllowedSound(buf)) return res.status(400).json({ error: t('overlay.sounds.error.notAudio') });
  if (refuseUpload(req, res, buf.length, { replacing: storageQuota.fileBytes(file) })) return;

  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, buf);
  } catch (e) {
    return res.status(500).json({ error: t('overlay.sounds.error.writeFailed') });
  }
  pushSoundUrls(req.streamer);
  res.json({ ok: true });
});

// Delete custom sound
router.post('/overlay/sounds/:eventType/delete', (req, res) => {
  const file = customSounds.soundFilePath(req.streamer.id, req.params.eventType);
  if (!file) return res.status(400).json({ error: res.locals.t('overlay.sounds.error.invalidType') });

  fs.rmSync(file, { force: true });
  pushSoundUrls(req.streamer);
  res.json({ ok: true });
});

// Which custom sounds the streamer has, with the URLs to preview them
router.get('/overlay/sounds/status', (req, res) => {
  res.json(customSounds.soundStatus(req.streamer));
});

// --- Chatbot Config ---

// Donation settings page
router.get('/donations', (req, res) => {
  const t = res.locals.t;
  const goalOverlayUrl = req.streamer.overlay_token
    ? `${config.app.url}/overlay/goal/${req.streamer.overlay_token}`
    : null;
  const activeGoal = db.getActiveTipGoal(req.streamer.id);
  // PayPal tips only count toward a goal in the tip page's currency
  const mismatch = goalCurrencyMismatch(activeGoal, req.streamer);
  res.render('donation-settings', {
    streamer: req.streamer,
    appUrl: config.app.url,
    activeGoal,
    goalHistory: db.getTipGoalHistory(req.streamer.id, 10),
    goalOverlayUrl,
    // Only known error codes from the URL become messages; anything else shows nothing
    settingsError: errorMessage(SETTINGS_ERRORS, req.query.error, t, {
      min: MIN_AMOUNT_FLOOR.toFixed(2), max: MIN_AMOUNT_CEIL, length: PAYPAL_EMAIL_MAX,
    }),
    goalError: errorMessage(GOAL_ERRORS, req.query.goal_error, t),
    goalCurrencyWarning: mismatch ? t('donations.goal.currencyMismatch', mismatch) : null,
    tts: ttsSection(req.streamer, t),
    ttsError: errorMessage(TTS_ERRORS, req.query.error, t),
    ttsSaved: req.query.saved === 'tts',
  });
});

// The "Read tips aloud" section of the Donations page: the streamer's settings (before a first save, what a tip is
// read with: English and its first voice, as services/tipVoice.js does), every language's voices and default lines
// (the page switches them without a reload), and this month's use with the day it starts again (UTC).
function ttsSection(streamer, t) {
  const language = TTS_LANGUAGES.includes(streamer.tts_language) ? streamer.tts_language : 'en';
  const now = new Date();
  return {
    available: Boolean(config.tts.apiKey),
    settings: {
      enabled: !!streamer.tts_enabled,
      minAmount: streamer.tts_min_amount ?? 5,
      language,
      voice: isVoice(language, streamer.tts_voice) ? streamer.tts_voice : defaultVoice(language),
      speed: streamer.tts_speed ?? 1,
      expressiveness: streamer.tts_expressiveness ?? 0.5,
      volume: streamer.tts_volume ?? 0.8,
      template: streamer.tts_template || '',
      templateEmpty: streamer.tts_template_empty || '',
    },
    currency: streamer.donation_currency || 'EUR',
    minFloor: Math.max(Number(streamer.donation_min_amount) || 0, MIN_AMOUNT_FLOOR),
    languages: TTS_LANGUAGES,
    voices: VOICES,
    templates: Object.fromEntries(TTS_LANGUAGES.map((lang) => [lang, defaultTemplates(translateIn, lang)])),
    used: db.getTtsUsage(streamer.id, utcMonth(now)),
    limit: ttsLimitOf(streamer),
    resetsOn: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10),
    lastError: streamer.tts_last_error ? lastErrorKey(streamer.tts_last_error) : null, // a text key
    lastErrorAt: streamer.tts_last_error_at || null,
    errorTexts: Object.fromEntries(Object.entries(TTS_ERRORS).map(([code, key]) => [code, t(key)])),
  };
}

// The whole section's form: checked and clamped (services/ttsSettings.js), every field it sends stored. The form
// always sends every field except the switch, which a browser leaves out while it is unticked (stored as off).
router.post('/donations/tts', (req, res) => {
  if (!config.tts.apiKey) return res.redirect('/dashboard/donations?error=unavailable#tts');
  const checked = checkTtsSettings(req.body, { tipMinimum: req.streamer.donation_min_amount });
  if (!checked.ok) return res.redirect(`/dashboard/donations?error=${encodeURIComponent(checked.error)}#tts`);
  db.updateTtsSettings(req.streamer.id, checked.settings);
  res.redirect('/dashboard/donations?saved=tts#tts');
});

// "Test the voice": a sample tip read with the settings the form shows (saved or not; nothing is saved), through
// services/tipVoice.js (it counts toward the month, has its own 10 s cooldown, and plays in OBS when it is open).
// Answers the URL the page plays it from, or the reason it could not (a TTS_ERRORS code).
const TTS_TEST_STATUS = Object.freeze({ cooldown: 429, limit: 409, credit_floor: 503, unavailable: 503, failed: 502, bad_language: 400 });
router.post('/donations/tts/test', async (req, res) => {
  let streamer = req.streamer;
  const body = req.body || {};
  if (body.tts_language !== undefined) {
    const checked = checkTtsSettings(body, { tipMinimum: streamer.donation_min_amount });
    if (!checked.ok) return res.status(TTS_TEST_STATUS[checked.error]).json({ ok: false, error: checked.error });
    streamer = { ...streamer, ...checked.settings };
  }
  const result = await tipVoice.testVoice(streamer);
  if (!result.ok) return res.status(TTS_TEST_STATUS[result.error] || 500).json({ ok: false, error: result.error });
  res.json({ ok: true, url: `/dashboard/donations/tts/audio/${result.file}` });
});

// A test's audio, for the page that asked: only a file name tipVoice makes, only from the logged-in streamer's own
// folder (gone after an hour). Anything else is 404.
router.get('/donations/tts/audio/:file', (req, res) => {
  const file = tipVoice.ttsFilePath(req.streamer.id, req.params.file);
  if (!file) return res.status(404).end();
  res.set('Cache-Control', 'no-cache');
  setUserContentHeaders(res, file); // a file made from the streamer's text: never run as a page here
  res.type('audio/mpeg');
  res.sendFile(path.basename(file), { root: path.dirname(file) }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// --- Donation history (1 year) ---

const DONATION_RANGES = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
const DONATION_SOURCES = ['paypal', 'streamelements', 'legacy'];

function donationHistoryFilters(q) {
  const range = DONATION_RANGES[q.range] ? q.range : '30d';
  const source = DONATION_SOURCES.includes(q.source) ? q.source : '';
  return { range, source, sinceDays: DONATION_RANGES[range] };
}

router.get('/donations/history', (req, res) => {
  const f = donationHistoryFilters(req.query);
  const perPage = 50;
  const total = db.countDonations(req.streamer.id, f);
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(pages, Math.max(1, parseInt(req.query.page) || 1));
  const totals = db.getDonationTotals(req.streamer.id, f);

  // Chart one currency: the streamer's donation currency if they've received any, else the biggest
  const yearTotals = db.getDonationTotals(req.streamer.id, { sinceDays: 366, source: f.source });
  const preferred = req.streamer.donation_currency || 'EUR';
  const chartCurrency = yearTotals.some(t => t.currency === preferred) ? preferred : (yearTotals[0] && yearTotals[0].currency) || null;
  const byMonth = {};
  if (chartCurrency) db.getDonationMonthly(req.streamer.id, chartCurrency, f.source).forEach(m => { byMonth[m.month] = m; });
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    months.push({ month: key, total: byMonth[key] ? byMonth[key].total : 0, count: byMonth[key] ? byMonth[key].count : 0 });
  }

  // A donation with no donor name is stored under the name 'Anonymous' (db.logDonation); the
  // page shows it as the translated word, so those rows read like the rest of the page.
  // What happened to each tip's reading aloud (donations.tts_status), as a text key; the column shows while the
  // streamer reads tips or a tip on the page has a status, and never while the overlay features are hidden (a tip is
  // read only through the alert overlay; the CSV keeps the column).
  const donations = db.getDonations(req.streamer.id, { ...f, limit: perPage, offset: (page - 1) * perPage })
    .map((d) => ({ ...d, donor_name: d.donor_name === 'Anonymous' ? null : d.donor_name, ttsStatusKey: TTS_STATUS_TEXTS[d.tts_status] || null }));

  res.render('donation-history', {
    streamer: req.streamer,
    filters: f,
    donations,
    total, page, pages, totals, months, chartCurrency,
    showTts: !!config.features.overlays && (!!req.streamer.tts_enabled || donations.some((d) => d.ttsStatusKey)),
    otherCurrencies: yearTotals.filter(t => t.currency !== chartCurrency).map(t => t.currency),
  });
});

router.get('/donations/history.csv', (req, res) => {
  const f = donationHistoryFilters(req.query);
  const rows = db.getDonations(req.streamer.id, { ...f, limit: 100000, offset: 0 });
  // Quote every field; prefix spreadsheet formula triggers since donor names/messages are viewer-controlled
  const cell = (v) => {
    let str = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
    return '"' + str.replace(/"/g, '""') + '"';
  };
  const lines = [['date_utc', 'donor', 'amount', 'currency', 'source', 'message', 'tts_status'].join(',')];
  rows.forEach(r => lines.push([r.created_at, r.donor_name, r.amount.toFixed(2), r.currency, r.source, r.message, r.tts_status].map(cell).join(',')));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="donations-${f.range}${f.source ? '-' + f.source : ''}.csv"`);
  res.send('\uFEFF' + lines.join('\r\n'));
});

router.post('/donations/history/:id/delete', (req, res) => {
  db.deleteDonation(parseInt(req.params.id), req.streamer.id);
  const back = new URLSearchParams();
  ['range', 'source', 'page'].forEach(k => { if (req.body[k]) back.set(k, String(req.body[k])); });
  res.redirect('/dashboard/donations/history' + (back.toString() ? '?' + back : ''));
});

// --- Tip goals ---

// `error` is a GOAL_ERRORS code (services/donationSettings.js), shown translated on the page.
function goalRedirect(res, error) {
  res.redirect('/dashboard/donations' + (error ? `?goal_error=${encodeURIComponent(error)}` : '') + '#tip-goal');
}

router.post('/donations/goal', (req, res) => {
  const fields = parseTipGoalFields(req.body);
  if (fields.error) return goalRedirect(res, fields.error);
  const currency = TIP_GOAL_CURRENCIES.includes(req.body.currency) ? req.body.currency : (req.streamer.donation_currency || 'EUR');
  const start = parseFloat(req.body.current_amount);
  db.createTipGoal(req.streamer.id, { ...fields, currency, current_amount: Number.isFinite(start) ? start : 0 });
  require('../services/tipGoals').broadcast(req.streamer.id);
  goalRedirect(res);
});

// Test buttons — simulated state on the live OBS goal overlay (never saved, auto-reverts)
router.post('/donations/goal/test', (req, res) => {
  const tipGoals = require('../services/tipGoals');
  if (req.body && req.body.reset) {
    tipGoals.endTest(req.streamer.id);
    return res.json({ ok: true });
  }
  if (!tipGoals.sendTest(req.streamer.id, req.body)) return res.status(400).json({ error: 'Invalid test goal' });
  res.json({ ok: true, revertMs: tipGoals.TEST_REVERT_MS });
});

router.post('/donations/goal/:id/update', (req, res) => {
  const fields = parseTipGoalFields(req.body);
  if (fields.error) return goalRedirect(res, fields.error);
  db.updateTipGoal(parseInt(req.params.id), req.streamer.id, fields);
  require('../services/tipGoals').broadcast(req.streamer.id);
  goalRedirect(res);
});

// Manual correction — e.g. donations received outside Atleta or in another currency. Negative values subtract.
router.post('/donations/goal/:id/adjust', (req, res) => {
  const goal = db.getActiveTipGoal(req.streamer.id);
  const amount = Math.round(parseFloat(req.body.amount) * 100) / 100;
  if (!goal || goal.id !== parseInt(req.params.id)) return goalRedirect(res, 'not_found');
  if (!Number.isFinite(amount) || amount === 0) return goalRedirect(res, 'amount_invalid');
  const result = db.addToTipGoal(goal.id, amount);
  const justCompleted = !!result && !result.before.completed_at && !!result.after.completed_at;
  require('../services/tipGoals').broadcast(req.streamer.id, amount > 0 ? { added: amount, justCompleted } : {});
  goalRedirect(res);
});

router.post('/donations/goal/:id/end', (req, res) => {
  db.endTipGoal(parseInt(req.params.id), req.streamer.id);
  require('../services/tipGoals').broadcast(req.streamer.id);
  goalRedirect(res);
});

// The currency and minimum are used to build PayPal orders and are written into
// the tip page's script, so they are validated here, not only by the form.
router.post('/donations', (req, res) => {
  const parsed = parseDonationSettings(req.body);
  if (parsed.error) return res.redirect(`/dashboard/donations?error=${encodeURIComponent(parsed.error)}`);
  db.updateDonationSettings(req.streamer.id, parsed.settings);
  res.redirect('/dashboard/donations');
});

// iRacing page
router.get('/iracing', (req, res) => {
  res.render('iracing', { streamer: req.streamer });
});

// iRacing overlay settings
router.get('/iracing/overlays/:type', (req, res) => {
  const validTypes = ['standings', 'relative', 'fuel', 'chat', 'wind', 'proximity'];
  const type = req.params.type;
  if (!validTypes.includes(type)) return res.redirect('/dashboard/iracing');
  let setting = null;
  try { setting = db.getIracingOverlaySetting(req.streamer.id, type); } catch (e) {}
  const overlayUrl = req.streamer.overlay_token ? `${config.app.url}/overlay/iracing/${type}/${req.streamer.overlay_token}` : null;
  res.render('iracing-overlay-settings', { streamer: req.streamer, overlayType: type, setting, overlayUrl });
});

router.post('/iracing/overlays/:type', (req, res) => {
  const validTypes = ['standings', 'relative', 'fuel', 'chat', 'wind', 'proximity'];
  const type = req.params.type;
  if (!validTypes.includes(type)) return res.redirect('/dashboard/iracing');
  const enabled = req.body.enabled ? 1 : 0;
  const settings = {};
  for (const [key, value] of Object.entries(req.body)) {
    if (key !== 'enabled') settings[key] = value;
  }
  db.upsertIracingOverlaySetting(req.streamer.id, type, enabled, JSON.stringify(settings));
  res.redirect(`/dashboard/iracing/overlays/${type}`);
});

// Chatbot config page
router.get('/chatbot', (req, res) => {
  const streamer = req.streamer;
  const commands = db.getChatCommands(req.streamer.id);
  let botConnected = false;
  let botUsername = '';
  try {
    const { chatManager } = require('../services/twitchChat');
    botConnected = chatManager.isConnected();
    botUsername = require('../config').bot.twitchUsername;
  } catch (e) {}

  const bannedWords = db.getBannedWords(req.streamer.id);

  let discordChannels = [];
  try {
    const { client: discordClient } = require('../discord');
    if (req.streamer.discord_guild_id) {
      const guild = discordClient.guilds.cache.get(req.streamer.discord_guild_id);
      if (guild) {
        discordChannels = guild.channels.cache
          .filter(c => c.type === 0)
          .map(c => ({ id: c.id, name: c.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }
    }
  } catch (e) {}

  // Only a known error code from the URL becomes a message; anything else shows nothing.
  const commandError = errorMessage(COMMAND_ERRORS, req.query.cmd_error, res.locals.t, { max: COMMAND_RESPONSE_MAX });

  res.render('chatbot-config', { streamer, commands, botConnected, botUsername, bannedWords, discordChannels, commandError });
});

// Save chatbot settings. Two forms post here and each names its part: the Connection tab's switch
// (form=connection) and the Event Messages tab (form=events). Each changes only its own fields, so saving
// the thank-you messages never switches the chatbot off. A post that names no part (a page opened before the
// forms named theirs) is a messages save.
router.post('/chatbot', (req, res) => {
  const b = req.body || {};
  if (b.form !== 'connection') {
    db.updateChatbotConfig(req.streamer.id, {
      chat_follow_enabled: b.chat_follow_enabled ? 1 : 0,
      chat_sub_enabled: b.chat_sub_enabled ? 1 : 0,
      chat_giftsub_enabled: b.chat_giftsub_enabled ? 1 : 0,
      chat_bits_enabled: b.chat_bits_enabled ? 1 : 0,
      chat_donation_enabled: b.chat_donation_enabled ? 1 : 0,
      chat_raid_enabled: b.chat_raid_enabled ? 1 : 0,
      chat_follow_template: b.chat_follow_template || '',
      chat_sub_template: b.chat_sub_template || '',
      chat_giftsub_template: b.chat_giftsub_template || '',
      chat_bits_template: b.chat_bits_template || '',
      chat_donation_template: b.chat_donation_template || '',
      chat_raid_template: b.chat_raid_template || '',
    });
    return res.redirect('/dashboard/chatbot?tab=events');
  }

  db.updateChatbotConfig(req.streamer.id, { chatbot_enabled: b.chatbot_enabled ? 1 : 0 });

  // Start/stop chat bot
  try {
    const { chatManager } = require('../services/twitchChat');
    if (b.chatbot_enabled) {
      chatManager.startForStreamer(req.streamer.id);
    } else {
      chatManager.stopForStreamer(req.streamer.id);
    }
  } catch (e) {
    console.error('[Dashboard] Chatbot start/stop error:', e.message);
  }

  // The chatbot's thank-yous and sponsor messages need the event connections as
  // the overlay does (see syncLiveConnections): switching the chatbot on starts
  // them unless the overlay already has, switching it off stops them unless the
  // overlay still needs them. A save that leaves the switch where it was
  // changes nothing.
  const chatbotWasOn = !!req.streamer.chatbot_enabled;
  const chatbotIsOn = !!b.chatbot_enabled;
  if (chatbotWasOn !== chatbotIsOn) {
    const overlayOn = !!req.streamer.overlay_enabled;
    syncLiveConnections(req.streamer.id, {
      wasNeeded: overlayOn || chatbotWasOn,
      needed: overlayOn || chatbotIsOn,
      streamElementsJwt: req.streamer.streamelements_jwt,
    });
  }

  res.redirect('/dashboard/chatbot');
});

router.post('/chatbot/builtins', (req, res) => {
  const b = req.body;
  db.updateBuiltinCommands(req.streamer.id, {
    cmd_followage_enabled: b.cmd_followage_enabled ? 1 : 0,
    cmd_subage_enabled: b.cmd_subage_enabled ? 1 : 0,
    cmd_uptime_enabled: b.cmd_uptime_enabled ? 1 : 0,
    cmd_accountage_enabled: b.cmd_accountage_enabled ? 1 : 0,
    cmd_8ball_enabled: b.cmd_8ball_enabled ? 1 : 0,
    cmd_roll_enabled: b.cmd_roll_enabled ? 1 : 0,
    cmd_hug_enabled: b.cmd_hug_enabled ? 1 : 0,
    cmd_slap_enabled: b.cmd_slap_enabled ? 1 : 0,
    cmd_love_enabled: b.cmd_love_enabled ? 1 : 0,
    cmd_rps_enabled: b.cmd_rps_enabled ? 1 : 0,
    cmd_coinflip_enabled: b.cmd_coinflip_enabled ? 1 : 0,
    cmd_quote_enabled: b.cmd_quote_enabled ? 1 : 0,
    cmd_roast_enabled: b.cmd_roast_enabled ? 1 : 0,
  });
  res.redirect('/dashboard/chatbot?tab=commands');
});

router.post('/chatbot/moderation', (req, res) => {
  const b = req.body;
  // The Discord moderation log may only point at a channel of a server this streamer claimed.
  const modLogChannelId = streamerGuildForChannel(req.streamer.id, b.mod_log_discord_channel_id)
    ? String(b.mod_log_discord_channel_id) : null;
  db.updateModerationConfig(req.streamer.id, {
    mod_banned_words_enabled: b.mod_banned_words_enabled ? 1 : 0,
    mod_link_protection_enabled: b.mod_link_protection_enabled ? 1 : 0,
    mod_link_permit_seconds: moderationNumber('mod_link_permit_seconds', b.mod_link_permit_seconds),
    mod_caps_enabled: b.mod_caps_enabled ? 1 : 0,
    mod_caps_min_length: moderationNumber('mod_caps_min_length', b.mod_caps_min_length),
    mod_caps_max_percent: moderationNumber('mod_caps_max_percent', b.mod_caps_max_percent),
    mod_emote_spam_enabled: b.mod_emote_spam_enabled ? 1 : 0,
    mod_emote_max_count: moderationNumber('mod_emote_max_count', b.mod_emote_max_count),
    mod_repetition_enabled: b.mod_repetition_enabled ? 1 : 0,
    mod_repetition_window: moderationNumber('mod_repetition_window', b.mod_repetition_window),
    mod_symbol_spam_enabled: b.mod_symbol_spam_enabled ? 1 : 0,
    mod_symbol_max_percent: moderationNumber('mod_symbol_max_percent', b.mod_symbol_max_percent),
    mod_slow_mode_cmd_enabled: b.mod_slow_mode_cmd_enabled ? 1 : 0,
    mod_raid_protection_enabled: b.mod_raid_protection_enabled ? 1 : 0,
    mod_raid_protection_duration: moderationNumber('mod_raid_protection_duration', b.mod_raid_protection_duration),
    mod_first_chatter_enabled: b.mod_first_chatter_enabled ? 1 : 0,
    mod_follow_age_enabled: b.mod_follow_age_enabled ? 1 : 0,
    mod_follow_age_minutes: moderationNumber('mod_follow_age_minutes', b.mod_follow_age_minutes),
    mod_action_response: moderationAction(b.mod_action_response),
    mod_escalation_enabled: b.mod_escalation_enabled ? 1 : 0,
    mod_log_discord_enabled: b.mod_log_discord_enabled ? 1 : 0,
    mod_log_discord_channel_id: modLogChannelId,
    mod_exempt_subs: b.mod_exempt_subs ? 1 : 0,
    mod_exempt_vips: b.mod_exempt_vips ? 1 : 0,
  });
  res.redirect('/dashboard/chatbot?tab=moderation');
});

// validateBannedPattern() reasons -> locale keys for the dashboard error.
const BANNED_PATTERN_ERRORS = {
  too_long: 'chatbot.error.patternTooLong',
  unsupported: 'chatbot.error.patternUnsupported',
  backreference: 'chatbot.error.patternBackreference',
  lookaround: 'chatbot.error.patternLookaround',
  nested_quantifier: 'chatbot.error.patternNestedRepeat',
  overlapping_repeats: 'chatbot.error.patternOverlappingRepeats',
  too_complex: 'chatbot.error.patternTooComplex',
};

router.post('/chatbot/banned-words', (req, res) => {
  const t = res.locals.t;
  const body = req.body || {}; // Express 5 leaves it undefined when nothing was parsed
  const word = typeof body.word === 'string' ? body.word.trim() : '';
  const isRegex = !!body.is_regex;
  if (!word) return res.json({ ok: false, error: t('chatbot.error.wordRequired') });
  // Every word is tested against every chat message on the shared event loop,
  // so the list itself is capped as well as each pattern.
  const limit = bannedWordLimitReason(db.countBannedWords(req.streamer.id), isRegex);
  if (limit === 'too_many_words') {
    return res.json({ ok: false, error: t('chatbot.error.tooManyWords', { max: MAX_BANNED_WORDS }) });
  }
  if (limit === 'too_many_patterns') {
    return res.json({ ok: false, error: t('chatbot.error.tooManyPatterns', { max: MAX_BANNED_PATTERNS }) });
  }
  if (isRegex) {
    // Regex words run against every chat message, so only patterns that cannot
    // stall the shared event loop are accepted (see services/safePattern.js).
    const check = validateBannedPattern(word);
    if (!check.ok) {
      const key = BANNED_PATTERN_ERRORS[check.reason] || 'chatbot.error.patternInvalid';
      return res.json({ ok: false, error: t(key, { max: MAX_PATTERN_LENGTH }) });
    }
  }
  db.addBannedWord(req.streamer.id, word, isRegex ? 1 : 0);
  res.json({ ok: true, words: db.getBannedWords(req.streamer.id) });
});

router.delete('/chatbot/banned-words/:id', (req, res) => {
  db.deleteBannedWord(req.streamer.id, parseInt(req.params.id));
  res.json({ ok: true, words: db.getBannedWords(req.streamer.id) });
});

// The custom command and sponsor message tests post a plain line, which the bot drops for a streamer whose chatbot is
// off (chatManager.sendMessage): refused with the reason then, before the shared cooldown starts, as the thank-you
// tests are (chatTestReady below), so the button does not say "sent" for it.
function chatbotOnForTest(req, res, next) {
  if (req.streamer.chatbot_enabled) return next();
  res.status(409).json({ ok: false, code: 'chatbot_off', error: res.locals.t('chatbot.test.chatbotOff') });
}

// Test custom command — send raw message to chat (must be before :eventType wildcard)
router.post('/chatbot/test/custom', chatbotOnForTest, limitTests, (req, res) => {
  const t = res.locals.t;
  // One line of at most a chat message's length (the text is sent exactly as given).
  const raw = req.query.response || (req.body || {}).response;
  const message = typeof raw === 'string' ? singleLine(raw) : '';
  if (!message) return res.status(400).json({ ok: false, error: t('chatbot.test.noText') });
  if (message.length > COMMAND_RESPONSE_MAX) {
    return res.status(400).json({ ok: false, error: t('chatbot.test.tooLong', { max: COMMAND_RESPONSE_MAX }) });
  }
  try {
    const { chatManager } = require('../services/twitchChat');
    // Sent like the custom command reply it tries out.
    chatManager.sendMessage(req.streamer.id, message, { priority: 'high' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[Dashboard] Test chat message failed:', e.message);
    res.status(500).json({ ok: false, error: t('chatbot.test.failed') });
  }
});

// The thank-you tests: the event each one stands for and the example values it is sent with. The route's own name is
// also the suffix of the streamer's columns (chat_<name>_enabled, chat_<name>_template).
const CHAT_TEST_EVENTS = Object.freeze({
  follow: { eventType: 'follow', data: { username: 'TestRacer' } },
  sub: { eventType: 'subscription', data: { username: 'SpeedDemon', tier: '1', months: 6, message: 'Love the stream!' } },
  giftsub: { eventType: 'giftsub', data: { username: 'GiftKing', amount: 5, tier: '1' } },
  bits: { eventType: 'bits', data: { username: 'NitroFan', amount: 500, message: 'Take my bits!' } },
  donation: { eventType: 'donation', data: { username: 'BigSponsor', amount: 25, currency: 'USD', message: 'Keep racing!' } },
  raid: { eventType: 'raid', data: { username: 'RaidLeader', viewers: 42 } },
});

// The bot posts nothing for a streamer whose chatbot is off, for a thank-you that is switched off and for one with no
// text (chatManager.sendEventMessage returns without a word), so a test that would post nothing is refused here, with
// the reason: the button must not say "sent" for it. Refused before the shared cooldown starts, as the overlay test is,
// so the click that finds out why does not hold up the one after the fix.
function chatTestReady(req, res, next) {
  const t = res.locals.t;
  const type = req.params.eventType;
  if (!Object.hasOwn(CHAT_TEST_EVENTS, type)) return res.status(400).json({ error: t('chatbot.test.invalidType') });
  const refuse = (code, key) => res.status(409).json({ ok: false, code, error: t(key) });
  const streamer = req.streamer;
  if (!streamer.chatbot_enabled) return refuse('chatbot_off', 'chatbot.test.chatbotOff');
  if (!streamer[`chat_${type}_enabled`]) return refuse('message_off', 'chatbot.test.messageOff');
  if (!String(streamer[`chat_${type}_template`] || '').trim()) return refuse('no_message', 'chatbot.test.noMessage');
  next();
}

// Test chat message
router.post('/chatbot/test/:eventType', chatTestReady, limitTests, (req, res) => {
  const test = CHAT_TEST_EVENTS[req.params.eventType];
  try {
    const { chatManager } = require('../services/twitchChat');
    chatManager.sendEventMessage(req.streamer.id, test.eventType, { ...test.data }, { test: true });
    res.json({ ok: true });
  } catch (e) {
    console.error('[Dashboard] Test chat message failed:', e.message);
    res.status(500).json({ ok: false, error: res.locals.t('chatbot.test.failed') });
  }
});

// The Chat protection card's Check again: the bot asks Twitch again whether it is a moderator in the
// streamer's channel (it leaves and rejoins it). Shares the test buttons' cooldown: it makes the bot act.
router.post('/chatbot/check-moderator', limitTests, async (req, res) => {
  const { chatManager } = require('../services/twitchChat');
  const moderator = await chatManager.recheckModerator(req.streamer.id);
  res.json({ ok: true, moderator });
});

// The Shoutouts card's Test in chat: a shoutout for the streamer's own channel with the saved text (it skips the
// one-a-minute rule, so a second test works). A test that would post nothing is refused with the reason before the
// shared cooldown starts, like the thank-you tests.
function shoutoutTestReady(req, res, next) {
  if (String(req.streamer.shoutout_template || '').trim()) return next();
  res.status(409).json({ ok: false, code: 'no_message', error: res.locals.t('chatbot.test.noMessage') });
}

const SHOUTOUT_TEST_REFUSALS = Object.freeze({
  unknown: { status: 404, code: 'not_found', text: 'cards.shoutouts.error.unknown' },
  empty: { status: 409, code: 'no_message', text: 'chatbot.test.noMessage' },
  failed: { status: 502, code: 'twitch_failed', text: 'cards.polls.error.twitchFailed' },
});

router.post('/shoutouts/test', chatbotOnForTest, shoutoutTestReady, limitTests, async (req, res) => {
  const { shoutouts } = require('../services/shoutouts');
  const outcome = await shoutouts.testInChat(req.streamer);
  if (outcome === 'sent') return res.json({ ok: true });
  const refusal = SHOUTOUT_TEST_REFUSALS[outcome] || SHOUTOUT_TEST_REFUSALS.failed;
  res.status(refusal.status).json({ ok: false, code: refusal.code, error: res.locals.t(refusal.text) });
});

// Back to the commands tab; `error` is a COMMAND_ERRORS code the page shows as text.
function commandsBack(res, error) {
  res.redirect('/dashboard/chatbot?tab=commands' + (error ? `&cmd_error=${encodeURIComponent(error)}` : ''));
}

// Add command. Adding and updating follow the same rules (services/chatCommands.js).
router.post('/chatbot/commands', (req, res) => {
  const parsed = parseCommand(req.body);
  if (parsed.error) return commandsBack(res, parsed.error);

  try {
    db.addChatCommand(req.streamer.id, parsed.command, parsed.response, parsed.cooldown);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return commandsBack(res, 'duplicate');
  }
  commandsBack(res);
});

// Update command
router.post('/chatbot/commands/:id/update', (req, res) => {
  const parsed = parseCommand(req.body);
  if (parsed.error) return commandsBack(res, parsed.error);

  try {
    db.updateChatCommand(
      parseInt(req.params.id, 10),
      req.streamer.id,
      parsed.command,
      parsed.response,
      req.body.enabled ? 1 : 0,
      parsed.cooldown
    );
  } catch (err) {
    if (!isUniqueViolation(err)) throw err; // renamed onto a name this streamer already uses
    return commandsBack(res, 'duplicate');
  }
  commandsBack(res);
});

// Delete command
router.post('/chatbot/commands/:id/delete', (req, res) => {
  db.deleteChatCommand(parseInt(req.params.id), req.streamer.id);
  res.redirect('/dashboard/chatbot');
});

router.get('/chatbot/mod-log', (req, res) => {
  const modLog = db.getModLog(req.streamer.id, 200);
  res.render('mod-log', { streamer: req.streamer, modLog });
});

// --- YouTube Chatbot ---

// Error codes of the YouTube chatbot page -> locale keys. The URL carries only a
// code; the page turns a known one into text, so a link cannot make it say anything else.
const YT_CHATBOT_ERRORS = {
  not_connected: 'ytChatbot.error.notConnected',
  token_refresh: 'ytChatbot.error.tokenRefresh',
  no_live_stream: 'ytChatbot.error.noLiveStream',
  connect_failed: 'ytChatbot.error.connectFailed',
  // Sent by the Google sign-in callback in routes/auth.js
  oauth_denied: 'ytChatbot.error.oauthDenied',
  oauth_state: 'ytChatbot.error.oauthState',
  oauth_failed: 'ytChatbot.error.oauthFailed',
};

// YouTube chatbot config page
router.get('/youtube-chatbot', youtubePage, async (req, res) => {
  const commands = db.getChatCommands(req.streamer.id);
  let ytPolling = false;
  try {
    const { youtubeChatManager } = require('../services/youtubeLiveChat');
    ytPolling = youtubeChatManager.isPolling(req.streamer.id);
  } catch (e) {}

  // Is the streamer live on YouTube? Asked with a 3 s deadline; if YouTube does not
  // answer, the page says it could not check instead of waiting or claiming "offline".
  const liveStatus = await youtubeLiveStatus(req.streamer);

  const guilds = db.getGuildsForStreamer(req.streamer.id);
  res.render('youtube-chatbot-config', {
    streamer: req.streamer,
    commands,
    guilds,
    ytPolling,
    ytLive: liveStatus.live,
    ytLiveTitle: liveStatus.title,
    ytLiveUnknown: liveStatus.unknown,
    connected: req.query.connected,
    // The Google sign-in (routes/auth.js) lands here with ?connected_yt=1: the account is connected.
    connectedYt: req.query.connected_yt,
    disconnected: req.query.disconnected,
    error: errorMessage(YT_CHATBOT_ERRORS, req.query.error, res.locals.t),
  });
});

// Save YouTube chatbot settings
router.post('/youtube-chatbot', (req, res) => {
  const b = req.body;
  const settings = {
    yt_chatbot_enabled: b.yt_chatbot_enabled ? 1 : 0,
    yt_mod_enabled: b.yt_mod_enabled ? 1 : 0,
    yt_chat_superchat_enabled: b.yt_chat_superchat_enabled ? 1 : 0,
    yt_chat_member_enabled: b.yt_chat_member_enabled ? 1 : 0,
    yt_chat_giftmember_enabled: b.yt_chat_giftmember_enabled ? 1 : 0,
    yt_chat_superchat_template: b.yt_chat_superchat_template || '',
    yt_chat_member_template: b.yt_chat_member_template || '',
    yt_chat_giftmember_template: b.yt_chat_giftmember_template || '',
  };
  // The "show overlay banner" switches are on the page only while the overlay features are on. A save
  // without them would store every switch as off and silence the YouTube alerts of a browser source
  // that is already in use in OBS, so the stored values are left alone, whatever a form sends.
  if (config.features.overlays) {
    settings.yt_overlay_superchat_enabled = b.yt_overlay_superchat_enabled ? 1 : 0;
    settings.yt_overlay_member_enabled = b.yt_overlay_member_enabled ? 1 : 0;
    settings.yt_overlay_giftmember_enabled = b.yt_overlay_giftmember_enabled ? 1 : 0;
  }
  db.updateYoutubeChatbotConfig(req.streamer.id, settings);
  pushOverlayConfig(req.streamer.id);
  res.redirect('/dashboard/youtube-chatbot');
});

// Test YouTube chat event
router.post('/youtube-chatbot/test/:eventType', limitTests, async (req, res) => {
  const bus = require('../services/overlayBus');
  const type = req.params.eventType;
  const event = Object.hasOwn(YOUTUBE_TEST_EVENTS, type) ? YOUTUBE_TEST_EVENTS[type] : null;
  if (!event) return res.status(400).json({ error: res.locals.t('ytChatbot.error.invalidType') });

  // Send to overlay (a copy: the samples are shared by every request)
  bus.emit(`overlay:${req.streamer.id}`, { ...event, data: { ...event.data } });

  // Send chat message if bot is polling live chat
  let chatSent = false;
  try {
    const { youtubeChatManager } = require('../services/youtubeLiveChat');
    if (youtubeChatManager.isPolling(req.streamer.id)) {
      const streamer = req.streamer;
      const typeMap = { yt_superchat: 'superchat', yt_member: 'member', yt_giftmember: 'giftmember' };
      const mappedType = typeMap[type];
      const templateKey = `yt_chat_${mappedType}_template`;
      const template = streamer[templateKey];
      if (template) {
        let message = template;
        for (const [key, value] of Object.entries(event.data)) {
          message = message.replace(new RegExp(`\\{${key}\\}`, 'g'), value ?? '');
        }
        const { refreshYoutubeBotToken, sendYoutubeChatMessage } = require('../services/youtube');
        const token = await refreshYoutubeBotToken();
        if (token) {
          const liveChatId = youtubeChatManager.getLiveChatId(req.streamer.id);
          if (liveChatId) {
            await sendYoutubeChatMessage(liveChatId, message, token);
            chatSent = true;
          }
        }
      }
    }
  } catch (e) {
    console.error('[YT Chat] Test chat error:', e.message);
  }

  res.json({ ok: true, chatSent });
});

// Test YouTube chat message only (no overlay)
router.post('/youtube-chatbot/test-chat/:eventType', limitTests, async (req, res) => {
  const type = req.params.eventType;
  const testData = {
    superchat: { username: 'TestViewer', amount: '$10.00', message: 'Great stream!' },
    member: { username: 'NewFan', level: 'Member' },
    giftmember: { username: 'GenerousViewer', amount: '5', level: 'Member' },
  };

  const data = testData[type];
  if (!data) return res.status(400).json({ error: res.locals.t('ytChatbot.error.invalidType') });

  try {
    const { youtubeChatManager } = require('../services/youtubeLiveChat');
    if (!youtubeChatManager.isPolling(req.streamer.id)) {
      return res.json({ ok: false, error: res.locals.t('ytChatbot.error.botNotPolling') });
    }

    const streamer = req.streamer;
    const templateKey = `yt_chat_${type}_template`;
    const template = streamer[templateKey];
    if (!template) return res.json({ ok: false, error: res.locals.t('ytChatbot.error.noTemplate') });

    let message = template;
    for (const [key, value] of Object.entries(data)) {
      message = message.replace(new RegExp(`\\{${key}\\}`, 'g'), value ?? '');
    }

    const { refreshYoutubeBotToken, sendYoutubeChatMessage } = require('../services/youtube');
    const token = await refreshYoutubeBotToken();
    if (!token) return res.json({ ok: false, error: res.locals.t('ytChatbot.error.botToken') });

    const liveChatId = youtubeChatManager.getLiveChatId(req.streamer.id);
    await sendYoutubeChatMessage(liveChatId, message, token);

    res.json({ ok: true });
  } catch (e) {
    console.error('[YT Chat] Test chat-only error:', e.message);
    res.json({ ok: false, error: res.locals.t('ytChatbot.error.sendFailed') });
  }
});

// Connect to YouTube live stream
router.post('/youtube-chatbot/connect', async (req, res) => {
  const back = (code) => res.redirect(`/dashboard/youtube-chatbot?error=${code}`);
  try {
    const { refreshStreamerYoutubeToken, getActiveBroadcast } = require('../services/youtube');
    const streamer = req.streamer;

    if (!streamer.yt_access_token) {
      return back('not_connected');
    }

    // Refresh token if expired
    let accessToken = streamer.yt_access_token;
    if (streamer.yt_token_expires_at && Date.now() >= streamer.yt_token_expires_at) {
      accessToken = await refreshStreamerYoutubeToken(streamer);
      if (!accessToken) {
        return back('token_refresh');
      }
    }

    // Find active broadcast using the streamer's own token
    const broadcast = await getActiveBroadcast(accessToken);
    if (!broadcast || !broadcast.liveChatId) {
      return back('no_live_stream');
    }

    // Auto-enable chatbot when connecting
    if (!streamer.yt_chatbot_enabled) {
      db.updateYoutubeChatbotConfig(req.streamer.id, { yt_chatbot_enabled: 1 });
    }

    const { youtubeChatManager } = require('../services/youtubeLiveChat');
    youtubeChatManager.startPolling(req.streamer.id, broadcast.liveChatId);

    res.redirect('/dashboard/youtube-chatbot?connected=1');
  } catch (e) {
    console.error('[YT Chat] Connect error:', e.message);
    back('connect_failed');
  }
});

// Disconnect from YouTube live chat
router.post('/youtube-chatbot/disconnect', (req, res) => {
  try {
    const { youtubeChatManager } = require('../services/youtubeLiveChat');
    youtubeChatManager.stopPolling(req.streamer.id);
  } catch (e) {}
  res.redirect('/dashboard/youtube-chatbot?disconnected=1');
});

// --- Report an Issue ---

router.get('/report', (req, res) => {
  res.render('report-issue', { streamer: req.streamer });
});

router.post('/report', (req, res) => {
  const subject = (req.body.subject || '').trim();
  const description = (req.body.description || '').trim();

  if (!subject || !description) {
    return res.status(400).json({ ok: false, error: 'missing_fields' });
  }

  const issueId = db.createIssue(
    req.streamer.id,
    req.streamer.discord_display_name || req.streamer.discord_username,
    subject,
    description
  );
  console.log(`[Dashboard] Issue #${issueId} reported by ${req.streamer.discord_username}: ${subject}`);
  res.json({ ok: true, issueId });
});

// Upload screenshot for an issue (raw body, same pattern as sponsors/avatars)
router.post('/report/:id/screenshot', async (req, res) => {
  const issueId = parseInt(req.params.id);
  const issue = db.getIssueById(issueId);
  if (!issue || issue.streamer_id !== req.streamer.id) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }

  // Check max 3 screenshots
  const existing = issue.screenshots ? issue.screenshots.split(',').filter(Boolean) : [];
  if (existing.length >= 3) {
    return res.status(400).json({ ok: false, error: 'max_screenshots' });
  }

  let buf;
  try { buf = await readBoundedBody(req, res, 5 * 1024 * 1024); }
  catch (e) { return; }

  // Only real images are stored: the extension must be png/jpg/jpeg/webp/gif
  // and the file's leading bytes must match it.
  const ext = (req.query.ext || 'png').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'png';
  if (!isAllowedScreenshot(ext, buf)) {
    return res.status(400).json({ ok: false, error: 'invalid_image' });
  }
  if (refuseUpload(req, res, buf.length, { media: false })) return;

  const issueDir = path.join(__dirname, '..', '..', 'data', 'issues', String(issueId));
  try { await fs.promises.mkdir(issueDir, { recursive: true }); } catch (e) {}

  const filename = `shot_${Date.now()}.${ext}`;
  try { await fs.promises.writeFile(path.join(issueDir, filename), buf); }
  catch (e) { return res.status(500).json({ ok: false, error: 'write_failed' }); }

  existing.push(filename);
  db.updateIssueScreenshots(issueId, existing.join(','));
  res.json({ ok: true, filename });
});

// Trigger AI analysis for an issue. Every analysis costs API money: one at a time
// per issue, never again once done, and at most ANALYSES_PER_DAY a day per
// streamer (services/issueAnalysis.js).
router.post('/report/:id/analyze', (req, res) => {
  const t = res.locals.t;
  const issueId = parseInt(req.params.id, 10);
  const issue = db.getIssueById(issueId);
  if (!issue || issue.streamer_id !== req.streamer.id) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }

  if (!config.anthropic.apiKey) {
    console.log('[Dashboard] Skipping AI analysis — no ANTHROPIC_API_KEY');
    return res.json({ ok: true, status: 'skipped' });
  }

  const now = Date.now();
  const blocked = analysisBlockedReason(issue, now);
  if (blocked) {
    return res.status(409).json({ ok: false, status: blocked, error: t(`report.analyze.${blocked}`) });
  }
  if (db.countIssueAnalysesSince(req.streamer.id, dailyWindowStart(now)) >= ANALYSES_PER_DAY) {
    return res.status(429).json({ ok: false, status: 'limit', error: t('report.analyze.limit', { max: ANALYSES_PER_DAY }) });
  }
  // Only one request gets to start it, even when two arrive together.
  if (!db.claimIssueAnalysis(issueId, new Date(now).toISOString(), staleBefore(now))) {
    return res.status(409).json({ ok: false, status: 'analyzing', error: t('report.analyze.analyzing') });
  }
  res.json({ ok: true, status: 'analyzing' });

  // Fire async — don't await
  const { analyzeIssue } = require('../services/agentTriage');
  analyzeIssue(issueId).catch(err => {
    console.error(`[AgentTriage] Error analyzing issue #${issueId}:`, err.message);
    db.updateIssueAnalysis(issueId, JSON.stringify({ error: err.message }), 'error');
  });
});

// --- Sponsor Rotation (replaces Timed Notifications) ---

// Sponsor rotation page
router.get('/timed-notifications', (req, res) => {
  const messages = db.getSponsorMessages(req.streamer.id);
  res.render('timed-notifications', { streamer: req.streamer, messages });
});

// --- Sponsor Images (JSON API for overlay builder) ---

router.get('/sponsors/list', (req, res) => {
  res.json(db.getSponsorImages(req.streamer.id));
});

// Upload sponsor image (raw body)
router.post('/sponsors/upload', async (req, res) => {
  const ext = (req.query.ext || 'png').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'png';
  if (!['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
    return res.status(400).json({ error: res.locals.t('upload.error.imageType') });
  }

  let buf;
  try { buf = await readBoundedBody(req, res, 5 * 1024 * 1024); }
  catch (e) { return; }
  if (refuseUpload(req, res, buf.length)) return;

  const streamerId = req.streamer.id;
  const sponsorDir = path.join(__dirname, '..', '..', 'data', 'sponsors', String(streamerId));
  try { await fs.promises.mkdir(sponsorDir, { recursive: true }); } catch (e) {}

  const filename = `sponsor_${Date.now()}.${ext}`;
  try { await fs.promises.writeFile(path.join(sponsorDir, filename), buf); }
  catch (e) { return res.status(500).json({ error: res.locals.t('upload.error.writeFailed') }); }

  const displayName = req.query.name || res.locals.t('overlayBuilder.sponsors.defaultName');
  const displayDuration = sponsorDurationSeconds(req.query.dur);
  db.addSponsorImage(streamerId, filename, displayName, null, displayDuration);
  const newImage = db.getSponsorImages(streamerId).find(i => i.filename === filename);
  res.json({ ok: true, filename, image: newImage });
});

// Delete sponsor image
router.post('/sponsors/:id/delete', async (req, res) => {
  const streamerId = req.streamer.id;
  const images = db.getSponsorImages(streamerId);
  const img = images.find(i => i.id === parseInt(req.params.id));
  if (img) {
    const filePath = path.join(__dirname, '..', '..', 'data', 'sponsors', String(streamerId), img.filename);
    try { await fs.promises.unlink(filePath); } catch (e) {}
    db.deleteSponsorImage(parseInt(req.params.id), streamerId);
  }
  res.json({ ok: true });
});

// Update sponsor image
router.post('/sponsors/:id/update', (req, res) => {
  db.updateSponsorImage(
    parseInt(req.params.id), req.streamer.id,
    req.body.display_name, req.body.chat_message,
    req.body.enabled, sponsorDurationSeconds(req.body.display_duration),
    sponsorImageScale(req.body.image_scale)
  );
  try {
    const { timedNotificationManager } = require('../services/timedNotifications');
    timedNotificationManager.restartForStreamer(req.streamer.id);
  } catch(e) {}
  res.json({ ok: true });
});

// Reorder sponsor images
router.post('/sponsors/reorder', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
  db.updateSponsorImageOrder(req.streamer.id, ids);
  res.json({ ok: true });
});

// Save sponsor rotation settings
router.post('/sponsors/settings', (req, res) => {
  db.updateSponsorSettings(
    req.streamer.id,
    req.body.sponsor_rotation_enabled,
    sponsorDurationSeconds(req.body.sponsor_interval_seconds),
    req.body.sponsor_send_chat
  );
  try {
    const { timedNotificationManager } = require('../services/timedNotifications');
    timedNotificationManager.restartForStreamer(req.streamer.id);
  } catch(e) {}
  res.json({ ok: true });
});

router.post('/sponsors/toggle-rotation', (req, res) => {
  db.toggleSponsorRotation(req.streamer.id, req.body.enabled);
  try {
    const { timedNotificationManager } = require('../services/timedNotifications');
    timedNotificationManager.restartForStreamer(req.streamer.id);
  } catch(e) {}
  res.json({ ok: true });
});

// --- Sponsor Chat Messages ---

router.post('/sponsor-messages/add', (req, res) => {
  const t = res.locals.t;
  const b = req.body || {};
  const text = typeof b.message_text === 'string' ? b.message_text.trim() : '';
  if (!text) return res.status(400).json({ ok: false, code: 'required', error: t('sponsors.error.textRequired') });
  if (text.length > dashboardSettings.TEMPLATE_MAX) return res.status(400).json({ ok: false, code: 'too_long', error: t('dashboard.settings.error.tooLong') });
  const url = typeof b.url === 'string' ? b.url.trim() : '';
  const id = Number(db.addSponsorMessage(req.streamer.id, text, url).lastInsertRowid);
  // The rotation reads the enabled messages when it starts: with none before this one it was not running.
  try {
    const { timedNotificationManager } = require('../services/timedNotifications');
    timedNotificationManager.restartChatForStreamer(req.streamer.id);
  } catch (e) {
    console.error('[Dashboard] Sponsor chat restart failed:', e.message);
  }
  res.json({ ok: true, message: db.getSponsorMessages(req.streamer.id).find((m) => m.id === id) });
});

// A sponsor message's text, link or switch: only the fields given change (the page's switch and the
// Sponsor messages card send one at a time).
router.post('/sponsor-messages/:id/update', (req, res) => {
  const b = req.body || {};
  const id = parseInt(req.params.id, 10);
  const t = res.locals.t;
  const fields = {};
  if (b.message_text !== undefined) {
    const text = typeof b.message_text === 'string' ? b.message_text.trim() : '';
    if (!text) return res.status(400).json({ ok: false, code: 'required', error: t('sponsors.error.textRequired') });
    if (text.length > dashboardSettings.TEMPLATE_MAX) return res.status(400).json({ ok: false, code: 'too_long', error: t('dashboard.settings.error.tooLong') });
    fields.message_text = text;
  }
  if (b.url !== undefined) fields.url = typeof b.url === 'string' ? b.url.trim() : '';
  let enabled = null;
  if (b.enabled !== undefined) {
    enabled = parseSwitch(b.enabled);
    if (enabled === null) return res.status(400).json({ ok: false, code: 'invalid', error: t('dashboard.settings.error.invalid') });
  }
  if (!db.updateSponsorMessageFields(id, req.streamer.id, fields)) {
    return res.status(404).json({ ok: false, code: 'not_found', error: t('sponsors.error.notFound') });
  }
  if (enabled !== null) db.setSponsorMessageEnabled(id, req.streamer.id, enabled);
  try {
    const { timedNotificationManager } = require('../services/timedNotifications');
    timedNotificationManager.restartChatForStreamer(req.streamer.id);
  } catch (e) {
    console.error('[Dashboard] Sponsor chat restart failed:', e.message);
  }
  res.json({ ok: true });
});

router.post('/sponsor-messages/:id/delete', (req, res) => {
  db.deleteSponsorMessage(parseInt(req.params.id), req.streamer.id);
  try {
    const { timedNotificationManager } = require('../services/timedNotifications');
    timedNotificationManager.restartChatForStreamer(req.streamer.id);
  } catch(e) {}
  res.json({ ok: true });
});

router.post('/sponsor-messages/settings', (req, res) => {
  db.updateSponsorChatSettings(
    req.streamer.id,
    sponsorChatIntervalMinutes(req.body.interval_minutes),
    req.body.enabled
  );
  try {
    const { timedNotificationManager } = require('../services/timedNotifications');
    timedNotificationManager.restartChatForStreamer(req.streamer.id);
  } catch(e) {}
  res.json({ ok: true });
});

router.post('/sponsor-messages/:id/test', chatbotOnForTest, limitTests, (req, res) => {
  const msg = db.getSponsorMessages(req.streamer.id).find(m => m.id === parseInt(req.params.id));
  if (!msg) return res.json({ ok: false, error: res.locals.t('sponsors.error.notFound') });
  const { chatManager } = require('../services/twitchChat');
  let fullMessage = msg.message_text;
  if (msg.url) fullMessage += ' ' + msg.url;
  chatManager.sendMessage(req.streamer.id, fullMessage, { priority: 'low' });
  res.json({ ok: true });
});

// --- Channel Point Rewards ---

const VALID_POSITION_PRESETS = new Set(['center-large', 'fullscreen', 'top-right-small', 'bottom-banner', 'custom']);

function clamp(val, min, max) {
  const n = parseFloat(val);
  if (isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

// The message for a bad reward field, in the streamer's language (the page shows it).
function validateRewardFields(fields, res) {
  const t = res.locals.t;
  const { title, cost, prompt, position_preset } = fields;
  const titleStr = title ? String(title).trim() : '';
  if (titleStr.length < 2 || titleStr.length > 45) {
    res.status(400).json({ error: t('redemptions.error.titleLength') });
    return false;
  }
  const costNum = parseInt(cost, 10);
  if (isNaN(costNum) || costNum < 1 || costNum > 1000000) {
    res.status(400).json({ error: t('redemptions.error.costRange') });
    return false;
  }
  if (prompt && String(prompt).length > 200) {
    res.status(400).json({ error: t('redemptions.error.promptLength') });
    return false;
  }
  if (position_preset !== undefined && !VALID_POSITION_PRESETS.has(position_preset)) {
    res.status(400).json({ error: t('redemptions.error.position') });
    return false;
  }
  return true;
}

// A reward the streamer deleted but Twitch refused to delete is kept (delete_failed)
// so it is not forgotten while still live there; it is not part of the normal list.
function isPendingDelete(reward) {
  return reward.twitch_sync_status === SYNC_DELETE_FAILED;
}

router.get('/redemptions', overlayPage, (req, res) => {
  const { hasRedemptionScope } = require('../services/twitch');
  const streamerId = req.streamer.id;
  const allRewards = db.getRewards(streamerId);
  const rewards = allRewards.filter((r) => !isPendingDelete(r));
  const pendingDeletes = allRewards.filter(isPendingDelete);
  const recentRedemptions = db.getRedemptionsRecent(streamerId, 50);
  res.render('redemptions-config', {
    streamer: req.streamer,
    rewards,
    pendingDeletes,
    allRewards,
    recentRedemptions,
    cpRewardsEnabled: req.streamer.cp_rewards_enabled,
    affiliateStatus: req.streamer.cp_affiliate_status,
    lastSyncAt: req.streamer.cp_last_sync_at,
    hasScope: hasRedemptionScope(req.streamer),
  });
});

router.post('/redemptions/sync', async (req, res) => {
  try {
    const { syncRewards } = require('../services/twitchRewards');
    const result = await syncRewards(req.streamer.id);
    res.json(result);
  } catch (e) {
    // Twitch's own wording stays in the log; the streamer gets a message in their language
    console.error('[Redemptions] sync failed:', e.message);
    res.status(500).json({ error: res.locals.t('redemptions.error.syncFailed') });
  }
});

router.post('/redemptions/upload', async (req, res) => {
  const mediaType = (req.query.media_type || '').toLowerCase();
  const ext = (req.query.ext || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const mediaError = redemptionMediaError(mediaType, ext);
  if (mediaError) return res.status(400).json({ error: res.locals.t(mediaError) });

  const maxBytes = mediaType === 'video' ? 20 * 1024 * 1024 : 5 * 1024 * 1024;
  let buf;
  try { buf = await readBoundedBody(req, res, maxBytes); }
  catch (e) { return; }

  const title = String(req.query.title || '').trim();
  const cost = parseInt(req.query.cost, 10);
  const prompt = String(req.query.prompt || '').trim() || null;
  const positionPreset = req.query.position_preset || 'center-large';

  if (!validateRewardFields({ title, cost, prompt, position_preset: positionPreset }, res)) return;
  if (refuseUpload(req, res, buf.length)) return;

  const cooldownSeconds = Math.max(0, parseInt(req.query.cooldown_seconds, 10) || 0);
  const maxPlaySeconds = clamp(req.query.max_play_seconds, 1, 60);
  const volume = clamp(req.query.volume !== undefined ? req.query.volume : 1, 0, 1);
  const customX = req.query.custom_x != null ? clamp(req.query.custom_x, 0, 1) : null;
  const customY = req.query.custom_y != null ? clamp(req.query.custom_y, 0, 1) : null;
  const customW = req.query.custom_w != null ? clamp(req.query.custom_w, 0, 1) : null;
  const customH = req.query.custom_h != null ? clamp(req.query.custom_h, 0, 1) : null;
  const chatMessageTemplate = String(req.query.chat_message_template || '').trim() || null;
  const autoFulfill = req.query.auto_fulfill === '0' ? 0 : 1;

  const streamerId = req.streamer.id;
  // How many rewards the streamer already had: 0 makes this their first one.
  const rewardsBefore = db.getRewards(streamerId).length;

  // Step 1: insert local DB row (placeholder filename, will update after file write)
  const row = db.insertReward({
    streamer_id: streamerId,
    title,
    cost,
    prompt,
    cooldown_seconds: cooldownSeconds,
    enabled: 1,
    media_type: mediaType,
    media_filename: `pending_${Date.now()}.${ext}`,
    media_mime: mediaType === 'audio'
      ? { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg' }[ext]
      : { mp4: 'video/mp4', webm: 'video/webm' }[ext],
    media_size_bytes: buf.length,
    position_preset: positionPreset,
    custom_x: customX,
    custom_y: customY,
    custom_w: customW,
    custom_h: customH,
    volume,
    max_play_seconds: maxPlaySeconds,
    chat_message_template: chatMessageTemplate,
    auto_fulfill: autoFulfill,
    sort_order: rewardsBefore,
    twitch_sync_status: 'ok',
  });

  const rowId = row.id;

  // Step 2: write file
  const filename = `${rowId}_${Date.now()}.${ext}`;
  const rewardDir = path.join(__dirname, '..', '..', 'data', 'redemptions', String(streamerId));
  try { await fs.promises.mkdir(rewardDir, { recursive: true }); } catch (e) {}
  try { await fs.promises.writeFile(path.join(rewardDir, filename), buf); }
  catch (e) {
    db.deleteReward(rowId, streamerId);
    return res.status(500).json({ error: res.locals.t('redemptions.error.writeFailed') });
  }

  // Step 3: update media_filename in DB
  db.updateReward(rowId, streamerId, { media_filename: filename });

  // New streamers start with "Enable Channel Point Rewards" off, and while it is off
  // every redemption is refunded. Someone who creates their first reward wants it to
  // work, so the switch comes on with it. (After that the switch is theirs: a later
  // reward never turns it back on.)
  let switchedOn = false;
  if (rewardsBefore === 0 && !req.streamer.cp_rewards_enabled) {
    db.updateOverlayConfig(streamerId, { cp_rewards_enabled: 1 });
    switchedOn = true;
  }

  // Step 4: create reward on Twitch
  let affiliateGated = false;
  try {
    const { createReward: twitchCreate } = require('../services/twitchRewards');
    const created = await twitchCreate(req.streamer, {
      title,
      cost,
      prompt: prompt || undefined,
      is_global_cooldown_enabled: cooldownSeconds > 0,
      global_cooldown_seconds: cooldownSeconds > 0 ? cooldownSeconds : undefined,
      is_paused: false,
    });
    if (created && created.affiliateGated) {
      db.setRewardSyncStatus(rowId, 'no_affiliate', null);
      db.updateStreamerCpSync(streamerId, { affiliate_status: 'not_affiliate' });
      affiliateGated = true;
    } else if (created && created.id) {
      // Step 5: persist twitch_reward_id
      db.setRewardTwitchId(rowId, created.id, 'ok');
    }
  } catch (e) {
    db.setRewardSyncStatus(rowId, 'create_failed', e.message);
  }

  const reward = db.getRewardById(rowId, streamerId);
  res.json({ ok: true, reward, affiliateGated: affiliateGated || undefined, rewardsSwitchedOn: switchedOn || undefined });
});

router.patch('/redemptions/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const streamerId = req.streamer.id;
  const reward = db.getRewardById(id, streamerId);
  if (!reward || isPendingDelete(reward)) return res.status(404).json({ error: res.locals.t('redemptions.error.notFound') });

  const body = req.body || {};
  const updates = {};

  if (body.title !== undefined) {
    const t = String(body.title).trim();
    if (t.length < 2 || t.length > 45) return res.status(400).json({ error: res.locals.t('redemptions.error.titleLength') });
    updates.title = t;
  }
  if (body.cost !== undefined) {
    const c = parseInt(body.cost, 10);
    if (isNaN(c) || c < 1 || c > 1000000) return res.status(400).json({ error: res.locals.t('redemptions.error.costRange') });
    updates.cost = c;
  }
  if (body.prompt !== undefined) {
    if (body.prompt && String(body.prompt).length > 200) return res.status(400).json({ error: res.locals.t('redemptions.error.promptLength') });
    updates.prompt = body.prompt ? String(body.prompt).trim() : null;
  }
  if (body.cooldown_seconds !== undefined) updates.cooldown_seconds = Math.max(0, parseInt(body.cooldown_seconds, 10) || 0);
  if (body.enabled !== undefined) updates.enabled = body.enabled ? 1 : 0;
  if (body.volume !== undefined) updates.volume = clamp(body.volume, 0, 1);
  if (body.max_play_seconds !== undefined) updates.max_play_seconds = clamp(body.max_play_seconds, 1, 60);
  if (body.chat_message_template !== undefined) updates.chat_message_template = body.chat_message_template || null;
  if (body.auto_fulfill !== undefined) updates.auto_fulfill = body.auto_fulfill ? 1 : 0;
  if (body.position_preset !== undefined) {
    if (!VALID_POSITION_PRESETS.has(body.position_preset)) return res.status(400).json({ error: res.locals.t('redemptions.error.position') });
    updates.position_preset = body.position_preset;
  }
  if (body.custom_x !== undefined) updates.custom_x = clamp(body.custom_x, 0, 1);
  if (body.custom_y !== undefined) updates.custom_y = clamp(body.custom_y, 0, 1);
  if (body.custom_w !== undefined) updates.custom_w = clamp(body.custom_w, 0, 1);
  if (body.custom_h !== undefined) updates.custom_h = clamp(body.custom_h, 0, 1);

  db.updateReward(id, streamerId, updates);

  // Send what Twitch keeps (title, cost, prompt, cooldown, paused) to Twitch. The
  // edit stays saved here either way; if Twitch did not take it the row says so
  // (update_failed) and the answer is an error, not a success.
  const { pushRewardChanges } = require('../services/twitchRewards');
  const pushed = await pushRewardChanges(req.streamer, id, updates);
  const saved = db.getRewardById(id, streamerId);
  if (!pushed.ok) {
    return res.status(502).json({ ok: false, error: res.locals.t('redemptions.error.updateFailed'), reward: saved });
  }
  res.json({ ok: true, reward: saved });
});

router.post('/redemptions/:id/replace-media', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const streamerId = req.streamer.id;
  const reward = db.getRewardById(id, streamerId);
  if (!reward || isPendingDelete(reward)) return res.status(404).json({ error: res.locals.t('redemptions.error.notFound') });

  const mediaType = (req.query.media_type || reward.media_type || '').toLowerCase();
  const ext = (req.query.ext || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  // Same rules as the upload route: audio or video only, per-type extensions.
  const mediaError = redemptionMediaError(mediaType, ext);
  if (mediaError) return res.status(400).json({ error: res.locals.t(mediaError) });

  const maxBytes = mediaType === 'video' ? 20 * 1024 * 1024 : 5 * 1024 * 1024;
  let buf;
  try { buf = await readBoundedBody(req, res, maxBytes); }
  catch (e) { return; }

  const rewardDir = path.join(__dirname, '..', '..', 'data', 'redemptions', String(streamerId));
  const replacing = reward.media_filename ? storageQuota.fileBytes(path.join(rewardDir, reward.media_filename)) : 0;
  if (refuseUpload(req, res, buf.length, { replacing })) return;
  try { await fs.promises.mkdir(rewardDir, { recursive: true }); } catch (e) {}

  const newFilename = `${id}_${Date.now()}.${ext}`;
  try { await fs.promises.writeFile(path.join(rewardDir, newFilename), buf); }
  catch (e) { return res.status(500).json({ error: res.locals.t('redemptions.error.writeFailed') }); }

  // Update DB first, then delete old file
  db.updateReward(id, streamerId, {
    media_filename: newFilename,
    media_type: mediaType,
    media_size_bytes: buf.length,
    media_mime: mediaType === 'audio'
      ? { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg' }[ext]
      : { mp4: 'video/mp4', webm: 'video/webm' }[ext],
  });

  if (reward.media_filename && reward.media_filename !== newFilename) {
    try { fs.unlinkSync(path.join(rewardDir, reward.media_filename)); } catch (e) {}
  }

  res.json({ ok: true, reward: db.getRewardById(id, streamerId) });
});

router.delete('/redemptions/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const streamerId = req.streamer.id;
  const reward = db.getRewardById(id, streamerId);
  if (!reward) return res.status(404).json({ error: res.locals.t('redemptions.error.notFound') });

  // The reward is gone here only once Twitch no longer has it. If Twitch refuses,
  // the row is kept as delete_failed (listed with a retry, and redemptions of it are
  // refunded) instead of leaving a live reward this app has forgotten.
  const { removeReward } = require('../services/twitchRewards');
  const result = await removeReward(req.streamer, reward);
  if (!result.removed) {
    return res.status(502).json({ ok: false, error: res.locals.t('redemptions.error.deleteFailed'), reward: db.getRewardById(id, streamerId) });
  }
  res.json({ ok: true });
});

// Try again whatever Twitch has not taken yet: a delete or an edit.
router.post('/redemptions/:id/retry', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const streamerId = req.streamer.id;
  const reward = db.getRewardById(id, streamerId);
  if (!reward) return res.status(404).json({ error: res.locals.t('redemptions.error.notFound') });

  const { retryPending } = require('../services/twitchRewards');
  const result = await retryPending(req.streamer, reward);
  if (result.nothingToRetry) return res.status(400).json({ ok: false, error: res.locals.t('redemptions.error.nothingToRetry') });
  if (!result.ok) {
    const key = reward.twitch_sync_status === SYNC_DELETE_FAILED ? 'redemptions.error.deleteFailed' : 'redemptions.error.updateFailed';
    return res.status(502).json({ ok: false, error: res.locals.t(key), reward: db.getRewardById(id, streamerId) });
  }
  res.json({ ok: true, removed: !!result.removed, reward: db.getRewardById(id, streamerId) || null });
});

router.post('/redemptions/:id/test', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const streamerId = req.streamer.id;
  const reward = db.getRewardById(id, streamerId);
  if (!reward || isPendingDelete(reward)) return res.status(404).json({ error: res.locals.t('redemptions.error.notFound') });

  const bus = require('../services/overlayBus');
  const fakeRedemptionId = `test-${id}-${Date.now()}`;

  const overlayEvent = {
    type: 'redemption',
    data: {
      rewardId: reward.id,
      mediaUrl: `/redemptions/${streamerId}/${reward.media_filename}`,
      mediaType: reward.media_type,
      position: {
        preset: reward.position_preset,
        x: reward.custom_x,
        y: reward.custom_y,
        w: reward.custom_w,
        h: reward.custom_h,
      },
      volume: reward.volume,
      maxPlaySeconds: reward.max_play_seconds,
      title: reward.title,
      username: req.streamer.twitch_display_name || 'TestUser',
      userInput: null,
      twitchRedemptionId: fakeRedemptionId,
    },
  };

  bus.emit(`overlay:${streamerId}`, overlayEvent);

  const rowId = db.logRedemption({
    streamer_id: streamerId,
    reward_id: reward.id,
    twitch_redemption_id: fakeRedemptionId,
    twitch_reward_id: reward.twitch_reward_id,
    user_id: null,
    user_login: req.streamer.twitch_display_name || 'TestUser',
    cost: reward.cost,
    status: 'FULFILLED',
    outcome: 'test',
    is_test: 1,
    redeemed_at: new Date().toISOString(),
  });

  res.json({ ok: true, redemptionId: rowId });
});

router.post('/redemptions/reorder', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
  db.reorderRewards(req.streamer.id, ids);
  res.json({ ok: true });
});

router.post('/redemptions/settings', (req, res) => {
  const enabled = parseSwitch((req.body || {}).cp_rewards_enabled);
  if (enabled === null) {
    return res.status(400).json({ ok: false, code: 'invalid', error: res.locals.t('dashboard.settings.error.invalid') });
  }
  db.updateOverlayConfig(req.streamer.id, { cp_rewards_enabled: enabled });
  res.json({ ok: true });
});

// --- Giveaways ---

router.get('/giveaways', (req, res) => {
  const streamerId = req.streamer.id;
  const active = db.getActiveGiveaway(streamerId);
  const history = db.getGiveawaysHistory(streamerId, 25);
  let recentWinners = [];
  if (history.length > 0) {
    try { recentWinners = db.getWinners(history[0].id); } catch (e) {}
  }
  res.render('giveaways-config', { streamer: req.streamer, active, history, recentWinners });
});

router.post('/giveaways/start', (req, res) => {
  const streamerId = req.streamer.id;
  // The chatbot collects the entries in chat: without it nobody could enter.
  if (!req.streamer.chatbot_enabled) {
    return res.status(409).json({ ok: false, code: 'chatbot_off', error: res.locals.t('giveaways.error.chatbotOff') });
  }
  const { keyword, prize, subs_only, duration_seconds, winners_count } = req.body;
  try {
    const giveawayMgr = require('../services/giveawayManager');
    const row = giveawayMgr.startGiveaway(streamerId, {
      keyword,
      prize: prize || null,
      subsOnly: !!subs_only,
      durationSeconds: duration_seconds || null,
      winnersCount: winners_count || 1,
    });
    res.status(201).json(row);
  } catch (e) {
    const t = res.locals.t;
    if (e.message === 'already_active') return res.status(409).json({ error: t('giveaways.error.alreadyActive') });
    if (e.message === 'invalid_keyword') return res.status(400).json({ error: t('giveaways.error.invalidKeyword') });
    if (e.message === 'invalid_duration') return res.status(400).json({ error: t('giveaways.error.invalidDuration') });
    if (e.message === 'invalid_winners_count') return res.status(400).json({ error: t('giveaways.error.invalidWinners') });
    if (e.message === 'invalid_prize') return res.status(400).json({ error: t('giveaways.error.invalidPrize') });
    console.error('[Giveaway] start error:', e.message);
    res.status(500).json({ error: t('giveaways.error.internal') });
  }
});

router.post('/giveaways/:id/close', (req, res) => {
  const streamerId = req.streamer.id;
  const id = parseInt(req.params.id, 10);
  const giveaway = db.getGiveawayById(id, streamerId);
  if (!giveaway) return res.status(404).json({ error: res.locals.t('giveaways.error.notFound') });
  const giveawayMgr = require('../services/giveawayManager');
  const result = giveawayMgr.closeGiveaway(streamerId, { silent: false });
  if (!result) {
    // Already closed — return current state
    return res.json({ ok: true, giveaway: db.getGiveawayById(id, streamerId), entryCount: db.getEntryCount(id) });
  }
  res.json({ ok: true, giveaway: result.giveaway, entryCount: result.entryCount });
});

router.post('/giveaways/:id/pick', (req, res) => {
  const streamerId = req.streamer.id;
  const id = parseInt(req.params.id, 10);
  const giveaway = db.getGiveawayById(id, streamerId);
  if (!giveaway) return res.status(404).json({ error: res.locals.t('giveaways.error.notFound') });
  const redraw = !!(req.body && req.body.redraw);
  const giveawayMgr = require('../services/giveawayManager');
  const result = giveawayMgr.pickWinners(id, streamerId, { redraw });
  // pickWinners reports the giveaway being gone by a code; the page shows words
  if (result.error) return res.status(404).json({ error: res.locals.t('giveaways.error.notFound') });
  if (result.winners.length === 0) return res.json({ winners: [], message: res.locals.t('giveaways.error.noEligible') });
  res.json({ winners: result.winners });
});

router.get('/giveaways/:id/entries', (req, res) => {
  const streamerId = req.streamer.id;
  const id = parseInt(req.params.id, 10);
  const giveaway = db.getGiveawayById(id, streamerId);
  if (!giveaway) return res.status(404).json({ error: res.locals.t('giveaways.error.notFound') });
  res.json({
    count: db.getEntryCount(id),
    entries: db.getEntries(id),
    endsAt: giveaway.ends_at,
    status: giveaway.status,
  });
});

router.delete('/giveaways/:id', (req, res) => {
  const streamerId = req.streamer.id;
  const id = parseInt(req.params.id, 10);
  const giveaway = db.getGiveawayById(id, streamerId);
  if (!giveaway) return res.status(404).json({ error: res.locals.t('giveaways.error.notFound') });
  if (giveaway.status === 'open') return res.status(409).json({ error: res.locals.t('giveaways.error.closeFirst') });
  db.deleteGiveaway(id, streamerId);
  res.json({ ok: true });
});

// --- Overlay Builder ---

// What the builder's edit window is handed for the looks (alert styles): each alert's gallery (a look made for
// this streamer first), the default looks, the families and the sounds in the gallery's order, every
// name in the streamer's language, and the fonts Racing's name can take. The page has every family's
// code (styles.js), so it draws the looks itself.
function builderStyleData(streamer, t) {
  const gallery = {};
  const looks = {};
  for (const type of STYLED_ALERTS) {
    gallery[type] = galleryFor(type, streamer);
    for (const { id } of gallery[type]) looks[id] = { title: t(`overlayBuilder.looks.${id}.title`), desc: t(`overlayBuilder.looks.${id}.desc`) };
  }
  return {
    defaults: DEFAULT_STYLES,
    gallery,
    looks,
    families: familyKeys().map((key) => ({ key, name: t(`overlayBuilder.families.${key}.name`), desc: t(`overlayBuilder.families.${key}.desc`) })),
    // Each sound, then its second recording when it has one ("<name> (version 2)")
    sounds: soundGroups().map(({ family, sounds }) => ({
      family,
      sounds: sounds.flatMap((key) => {
        const name = t(`overlayBuilder.sounds.${key}`);
        const second = secondVersionOf(key);
        return second ? [{ key, name }, { key: second, name: t('overlayBuilder.soundVersion', { name }) }] : [{ key, name }];
      }),
    })),
    fonts: OVERLAY_FONTS,
  };
}

// The texts the Overlay Builder's cards and edit window need, in the streamer's language, keyed by what follows
// `overlayBuilder.`. The {{placeholders}} stay in them: the page fills them in.
const BUILDER_TEXT_KEYS = [
  'overlayBuilder.cards.subtitle', 'overlayBuilder.cards.edit', 'overlayBuilder.cards.editSponsors',
  'overlayBuilder.cards.test', 'overlayBuilder.cards.default', 'overlayBuilder.cards.uploaded',
  'overlayBuilder.cards.free', 'overlayBuilder.cards.sponsors', 'overlayBuilder.cards.rotationOn',
  'overlayBuilder.cards.rotationOff', 'overlayBuilder.cards.images', 'overlayBuilder.cards.twitch',
  'overlayBuilder.cards.youtube', 'overlayBuilder.cards.other', 'overlayBuilder.window.title',
  'overlayBuilder.window.close', 'overlayBuilder.window.cancel', 'overlayBuilder.window.done',
  'overlayBuilder.window.saving', 'overlayBuilder.window.leave', 'overlayBuilder.window.replay', 'overlayBuilder.window.replayPlain',
  'overlayBuilder.window.soundLoop', 'overlayBuilder.window.loopHint', 'overlayBuilder.tabs.animation',
  'overlayBuilder.tabs.customize', 'overlayBuilder.tabs.sound', 'overlayBuilder.tabs.location',
  'overlayBuilder.tabs.images', 'overlayBuilder.tabs.design', 'overlayBuilder.sound.thisLook',
  'overlayBuilder.sound.own', 'overlayBuilder.sound.second', 'overlayBuilder.sound.today',
  'overlayBuilder.sound.none', 'overlayBuilder.sound.silent', 'overlayBuilder.sound.current',
  'overlayBuilder.sound.search', 'overlayBuilder.sound.both', 'overlayBuilder.sound.uploaded',
  'overlayBuilder.sound.uploadedLink', 'overlayBuilder.sound.listen', 'overlayBuilder.custom.nothing',
  'overlayBuilder.custom.ownColour', 'overlayBuilder.custom.ownColours', 'overlayBuilder.custom.allSix',
  'overlayBuilder.custom.allSixConfirm', 'overlayBuilder.place.fixed', 'overlayBuilder.place.fixedHint',
  'overlayBuilder.place.free', 'overlayBuilder.place.freeHint', 'overlayBuilder.place.fixedNote',
  'overlayBuilder.place.freeNote', 'overlayBuilder.place.size', 'overlayBuilder.place.width',
  'overlayBuilder.place.top', 'overlayBuilder.place.mid', 'overlayBuilder.place.bot',
  'overlayBuilder.place.left', 'overlayBuilder.place.center', 'overlayBuilder.place.right',
  'overlayBuilder.saveFailed', 'overlayBuilder.saveFailedWith', 'overlayBuilder.resetConfirm', 'overlayBuilder.resetDone',
  'overlayBuilder.style.all', 'overlayBuilder.style.default', 'overlayBuilder.style.mine', 'overlayBuilder.style.failed',
  'overlayBuilder.style.familyDone', 'overlayBuilder.style.labelHint', 'overlayBuilder.style.fontOwn', 'overlayBuilder.style.testSent',
  'overlayBuilder.style.listenToday',
];
const KEEP_PLACEHOLDERS = new Proxy({}, { get: (_, name) => `{{${String(name)}}}` });
function builderTexts(t) {
  const texts = {};
  for (const key of BUILDER_TEXT_KEYS) texts[key.slice('overlayBuilder.'.length)] = t(key, KEEP_PLACEHOLDERS);
  return texts;
}

router.get('/overlay-builder', overlayPage, async (req, res) => {
  const designs = db.getAllOverlayDesigns(req.streamer.id);
  const overlayUrl = req.streamer.overlay_token
    ? `${config.app.url}/overlay/${req.streamer.overlay_token}`
    : null;

  // The canvas background: the live stream's or latest VOD's thumbnail, within 3 s
  // in total (the builder still works with its plain background without one).
  const streamThumbnail = await findStreamThumbnail(req.streamer);

  const sponsors = db.getSponsorImages(req.streamer.id);
  res.render('overlay-builder', {
    streamer: req.streamer,
    // The name on the rear window of the C1 any streamer can pick (services/overlayConfig.js).
    channel: JSON.stringify(channelLettering(req.streamer)).replace(/</g, '\\u003c'),
    // \u003c escaping: these are embedded raw into an inline <script> in the
    // builder, and JSON.stringify does NOT neutralise a literal "</script>" in
    // user-controlled text (event_label, detail_text, sponsor names).
    designs: JSON.stringify(designs).replace(/</g, '\\u003c'),
    sponsors: JSON.stringify(sponsors).replace(/</g, '\\u003c'),
    // What each alert starts from (the server's own table, see services/overlayDesign.js)
    eventDefaults: JSON.stringify(EVENT_DEFAULTS).replace(/</g, '\\u003c'),
    // The joined alert looks' version (services/alertStyleBundle.js), as the OBS overlay asks for them
    stylesVersion: alertStyleBundle().version,
    // The looks' gallery, sounds and fonts for the edit window, and every family's fonts in one stylesheet
    styleData: JSON.stringify(builderStyleData(req.streamer, res.locals.t)).replace(/</g, '\\u003c'),
    // Which alerts have a sound the streamer uploaded (OBS plays it instead of the look's sound), and the cards' texts
    uploadedSounds: JSON.stringify(customSounds.soundStatus(req.streamer).custom).replace(/</g, '\\u003c'),
    builderTexts: JSON.stringify(builderTexts(res.locals.t)).replace(/</g, '\\u003c'),
    styleFontsHref: 'https://fonts.googleapis.com/css2?' + fontsOf(familyKeys()).map((spec) => `family=${spec}`).join('&') + '&display=swap',
    overlayUrl,
    streamThumbnail
  });
});

// The streamer's designs, sent to their open overlays so a change applies without a reload.
function pushOverlayDesigns(streamerId) {
  const designMap = {};
  db.getAllOverlayDesigns(streamerId).forEach(d => { designMap[d.event_type] = d; });
  require('../services/overlayBus').emit(`overlay:${streamerId}`, { type: 'config-update', designs: designMap });
}

// Only what the builder itself can produce is saved (services/overlayDesign.js);
// anything else is a 400 that names the field. Next to the design comes the look the builder
// shows (`style`, alert styles): one that draws this alert, or the streamer's own private one;
// '' or null is the alert's default look. A page from before the looks sends none, and the
// stored look stays.
router.post('/overlay-builder/save', (req, res) => {
  const t = res.locals.t;
  const { eventType, design } = req.body || {};
  if (!isBuilderEventType(eventType)) {
    return res.status(400).json({ ok: false, error: t('overlayBuilder.error.eventType') });
  }
  const checked = validateOverlayDesign(design, eventType);
  if (!checked.ok) {
    return res.status(400).json({ ok: false, field: checked.field, error: t('overlayBuilder.error.invalidField', { field: checked.field }) });
  }
  const namesStyle = Object.prototype.hasOwnProperty.call(req.body, 'style');
  const style = req.body.style === '' ? null : req.body.style;
  if (namesStyle && !canUseStyle(style, eventType, req.streamer)) {
    return res.status(400).json({ ok: false, field: 'style', error: t('overlayBuilder.error.style') });
  }
  // The look first: another look starts from its own settings, then the design is what the builder sent.
  if (namesStyle) db.setOverlayDesignStyle(req.streamer.id, eventType, style);
  db.saveOverlayDesign(req.streamer.id, eventType, checked.design);
  pushOverlayDesigns(req.streamer.id);
  res.json({ ok: true });
});

// "Use <family> for all six alerts": the family's look on each of the six alerts, all or none (a
// row whose look changes starts from the look's own settings), one config-update to the open
// overlay, and the six rows for the builder.
router.post('/overlay-builder/family', (req, res) => {
  const styles = familyStyles(req.body && req.body.family);
  if (!styles) {
    return res.status(400).json({ ok: false, field: 'family', error: res.locals.t('overlayBuilder.error.family') });
  }
  db.setOverlayDesignStyles(req.streamer.id, styles);
  pushOverlayDesigns(req.streamer.id);
  const designs = {};
  for (const eventType of Object.keys(styles)) designs[eventType] = db.getOverlayDesign(req.streamer.id, eventType);
  res.json({ ok: true, designs });
});

router.post('/overlay-builder/reset', (req, res) => {
  const { eventType } = req.body || {};
  if (!isBuilderEventType(eventType)) {
    return res.status(400).json({ ok: false, error: res.locals.t('overlayBuilder.error.eventType') });
  }
  // Back to the defaults; the alert's look is kept (its own settings start again)
  db.resetOverlayDesign(req.streamer.id, eventType);
  pushOverlayDesigns(req.streamer.id);
  res.json({ ok: true });
});

// --- VTuber Preview (authenticated, no overlay token needed) ---

router.get('/vtuber-preview', vtuberPage, (req, res) => {
  const model = req.streamer.vtuber_model_id ? db.getVtuberModel(req.streamer.vtuber_model_id) : null;
  let modelUrl = null;
  if (model) {
    modelUrl = model.is_bundled
      ? `/vtuber/models/${model.filename}`
      : `/vtuber-models/${req.streamer.id}/${model.filename}`;
  }
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.render('vtuber', { mode: 'dashboard', modelUrl, streamerName: req.streamer.twitch_username || 'Streamer' });
});

// --- VTuber Model Endpoints ---

router.get('/api/vtuber/models', (req, res) => {
  const models = db.getVtuberModels(req.streamer.id);
  res.json({ ok: true, models });
});

router.post('/api/vtuber/models', async (req, res) => {
  const originalName = (req.query.name || 'custom').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${req.streamer.id}_${Date.now()}_${originalName}.vrm`;
  const modelDir = path.join(__dirname, '..', '..', 'data', 'vtuber-models', String(req.streamer.id));

  let buf;
  try { buf = await readBoundedBody(req, res, 50 * 1024 * 1024); }
  catch (e) { return; }
  if (refuseUpload(req, res, buf.length)) return;

  try { await fs.promises.mkdir(modelDir, { recursive: true }); } catch (e) {}
  try { await fs.promises.writeFile(path.join(modelDir, filename), buf); }
  catch (e) { return res.status(500).json({ error: res.locals.t('dashboard.vtuber.writeFailed') }); }

  const result = db.addVtuberModel(req.streamer.id, originalName, 'custom', filename);
  const model = db.getVtuberModel(result.lastInsertRowid);
  res.json({ ok: true, model });
});

router.delete('/api/vtuber/models/:id', (req, res) => {
  const model = db.getVtuberModel(parseInt(req.params.id));
  if (!model) return res.status(404).json({ error: 'Model not found' });
  if (model.is_bundled) return res.status(403).json({ error: 'Cannot delete bundled models' });
  if (model.streamer_id !== req.streamer.id) return res.status(403).json({ error: 'Not your model' });

  // Delete file
  const filePath = path.join(__dirname, '..', '..', 'data', 'vtuber-models', String(req.streamer.id), model.filename);
  try { fs.unlinkSync(filePath); } catch {}

  // Clear selection if this model was selected
  if (req.streamer.vtuber_model_id === model.id) {
    db.selectVtuberModel(req.streamer.id, null);
  }

  db.deleteVtuberModel(model.id, req.streamer.id);
  res.json({ ok: true });
});

router.put('/api/vtuber/select', (req, res) => {
  const { modelId } = req.body;
  if (modelId !== null) {
    const model = db.getVtuberModel(modelId);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    if (!model.is_bundled && model.streamer_id !== req.streamer.id) {
      return res.status(403).json({ error: 'Not your model' });
    }
  }
  db.selectVtuberModel(req.streamer.id, modelId);
  res.json({ ok: true });
});

module.exports = router;
