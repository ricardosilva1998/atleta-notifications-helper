const { parseAdminDiscordIds } = require('./adminAccess');
const { isValidKey } = require('./services/secretBox');

// DISCORD_DISABLED=1 is for development and CI only: the site runs without the
// Discord bot (nothing logs in to Discord, no slash commands, welcome messages
// or pollers), so the three Discord variables are not needed. Never set it in
// production.
const discordDisabled = process.env.DISCORD_DISABLED === '1';

const required = [
  ...(discordDisabled ? [] : ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET']),
  'TWITCH_CLIENT_ID',
  'TWITCH_CLIENT_SECRET',
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required environment variables:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

// TOKEN_ENCRYPTION_KEY encrypts the OAuth tokens and the StreamElements token
// kept in the database (src/db.js, services/secretBox.js): 64 hex characters,
// made with `openssl rand -hex 32`. Unset, they are stored unencrypted and the
// boot log says so. Set but malformed, the boot stops: running anyway would
// keep new tokens unencrypted and leave the encrypted ones unreadable.
const tokenEncryptionKey = (process.env.TOKEN_ENCRYPTION_KEY || '').trim();
if (tokenEncryptionKey && !isValidKey(tokenEncryptionKey)) {
  console.error('TOKEN_ENCRYPTION_KEY must be 64 hex characters (make one with: openssl rand -hex 32)');
  process.exit(1);
}

// BOT_CHAT_RATE_LIMIT as a whole number from 1 to 100; 20 when unset or unreadable.
function chatRateLimit(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 100) : 20;
}

module.exports = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    disabled: discordDisabled, // DISCORD_DISABLED=1, see above
  },
  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID,
    clientSecret: process.env.TWITCH_CLIENT_SECRET,
  },
  bot: {
    twitchUsername: process.env.BOT_TWITCH_USERNAME || '',
    twitchToken: process.env.BOT_TWITCH_TOKEN || '',
    // Messages the shared Twitch bot may post in any 30 seconds, across all
    // channels (services/chatDispatcher.js). Twitch allows an ordinary account
    // 20; raise BOT_CHAT_RATE_LIMIT (up to 100) only if the bot's account may
    // post more.
    chatMessagesPer30s: chatRateLimit(process.env.BOT_CHAT_RATE_LIMIT),
  },
  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY || '',
    botRefreshToken: process.env.YOUTUBE_BOT_REFRESH_TOKEN || '',
    botClientId: process.env.YOUTUBE_BOT_CLIENT_ID || '',
    botClientSecret: process.env.YOUTUBE_BOT_CLIENT_SECRET || '',
  },
  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID || '',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
  },
  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
    mode: process.env.PAYPAL_MODE || 'sandbox',
    get baseUrl() {
      return this.mode === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';
    },
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    // The model that analyses reported issues (services/agentTriage.js).
    triageModel: process.env.TRIAGE_MODEL || 'claude-sonnet-5-5',
  },
  multistream: {
    apiUrl: process.env.MEDIAMTX_API_URL || '',
    ingestUrl: process.env.MEDIAMTX_INGEST_URL || 'rtmp://ingest.atletanotifications.com/live',
    apiToken: process.env.MEDIAMTX_API_TOKEN || '',
    webhookSecret: process.env.MEDIAMTX_WEBHOOK_SECRET || '',
    keySecret: process.env.MULTISTREAM_KEY_SECRET || '',
    enabled: !!(process.env.MEDIAMTX_API_URL && process.env.MULTISTREAM_KEY_SECRET),
  },
  email: {
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || '',
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@atletanotifications.com',
  },
  features: {
    youtube: true,
  },
  // Most Twitch channels one Discord server may watch. Adding past it is
  // refused; a server already over it keeps what it has.
  limits: {
    twitchChannelsPerGuild: 25,
  },
  // Signs the /link URLs the bot hands out (src/services/linkSignature.js).
  // Unset: a per-boot secret is used and links stop working after a restart.
  link: {
    signingSecret: process.env.LINK_SIGNING_SECRET || '',
  },
  // TOKEN_ENCRYPTION_KEY (see above); '' when unset.
  tokenEncryption: {
    key: tokenEncryptionKey,
  },
  // Discord user ids with admin access: the built-in admin plus any
  // comma-separated ids in ADMIN_DISCORD_IDS. Names never grant admin.
  adminDiscordIds: parseAdminDiscordIds(process.env.ADMIN_DISCORD_IDS),
  app: {
    url: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
    port: parseInt(process.env.PORT) || 3000,
    sessionSecret: process.env.SESSION_SECRET || 'change-me-in-production',
    adminPassword: process.env.ADMIN_PASSWORD || null,
    syncSecret: process.env.SYNC_SECRET || null,
    syncSourceUrl: process.env.SYNC_SOURCE_URL || null,
  },
  intervals: {
    twitchLive: parseInt(process.env.TWITCH_POLL_INTERVAL) || 60_000,
    twitchClips: parseInt(process.env.TWITCH_CLIPS_INTERVAL) || 300_000,
    youtubeFeed: parseInt(process.env.YOUTUBE_FEED_INTERVAL) || 300_000,
    youtubeLive: parseInt(process.env.YOUTUBE_LIVE_INTERVAL) || 120_000,
    subSync: parseInt(process.env.SUB_SYNC_INTERVAL) || 600_000,
    // Every 15 minutes: the digest only goes out on Monday from 09:00 UTC, and a
    // post that failed is tried again on the next tick (four tries in that hour).
    weeklyDigest: parseInt(process.env.WEEKLY_DIGEST_INTERVAL) || 900_000,
    instagramFeed: parseInt(process.env.INSTAGRAM_FEED_INTERVAL) || 600_000,
    tiktokFeed: parseInt(process.env.TIKTOK_FEED_INTERVAL) || 600_000,
    twitterFeed: parseInt(process.env.TWITTER_FEED_INTERVAL) || 600_000,
    iracingResults: parseInt(process.env.IRACING_POLL_INTERVAL) || 1_800_000,
  },
  tiers: {
    free: {
      name: 'Free',
      price: 0,
      maxGuilds: -1,
      maxTwitchChannels: -1,
      maxYoutubeChannels: -1,
      twitchLive: true,
      twitchClips: true,
      youtube: true,
      subSync: true,
      welcome: true,
      customEmbedColors: true,
      streamSummaries: true,
      goLiveThreads: true,
      webhooks: true,
      whiteLabel: true,
      delayMinutes: 0,
      recaps: true,
      milestones: true,
      weeklyHighlights: true,
      instagram: true,
      tiktok: true,
      twitter: true,
      maxSocialAccounts: -1,
      iracing: true,
      maxIracingDrivers: -1,
    },
    starter: {
      name: 'Starter',
      price: 0,
      maxGuilds: -1,
      maxTwitchChannels: -1,
      maxYoutubeChannels: -1,
      twitchLive: true,
      twitchClips: true,
      youtube: true,
      subSync: true,
      welcome: true,
      customEmbedColors: true,
      streamSummaries: true,
      goLiveThreads: true,
      webhooks: true,
      whiteLabel: true,
      delayMinutes: 0,
      recaps: true,
      milestones: true,
      weeklyHighlights: true,
      instagram: true,
      tiktok: true,
      twitter: true,
      maxSocialAccounts: -1,
      iracing: true,
      maxIracingDrivers: -1,
    },
    pro: {
      name: 'Pro',
      price: 0,
      maxGuilds: -1,
      maxTwitchChannels: -1,
      maxYoutubeChannels: -1,
      twitchLive: true,
      twitchClips: true,
      youtube: true,
      subSync: true,
      welcome: true,
      customEmbedColors: true,
      streamSummaries: true,
      goLiveThreads: true,
      webhooks: true,
      whiteLabel: true,
      delayMinutes: 0,
      recaps: true,
      milestones: true,
      weeklyHighlights: true,
      instagram: true,
      tiktok: true,
      twitter: true,
      maxSocialAccounts: -1,
      iracing: true,
      maxIracingDrivers: -1,
    },
    enterprise: {
      name: 'Enterprise',
      price: 25,
      maxGuilds: -1,
      maxTwitchChannels: -1,
      maxYoutubeChannels: -1,
      twitchLive: true,
      twitchClips: true,
      youtube: true,
      subSync: true,
      welcome: true,
      customEmbedColors: true,
      streamSummaries: true,
      goLiveThreads: true,
      webhooks: true,
      whiteLabel: true,
      delayMinutes: 0,
      recaps: true,
      milestones: true,
      weeklyHighlights: true,
      instagram: true,
      tiktok: true,
      twitter: true,
      maxSocialAccounts: -1,
      iracing: true,
      maxIracingDrivers: -1,
    },
  },
};
