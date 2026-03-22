const required = [
  'DISCORD_TOKEN',
  'DISCORD_CHANNEL_ID',
  'TWITCH_CLIENT_ID',
  'TWITCH_CLIENT_SECRET',
  'TWITCH_USERNAME',
  'YOUTUBE_CHANNEL_ID',
  'YOUTUBE_API_KEY',
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required environment variables:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

module.exports = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    channelId: process.env.DISCORD_CHANNEL_ID,
  },
  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID,
    clientSecret: process.env.TWITCH_CLIENT_SECRET,
    username: process.env.TWITCH_USERNAME,
  },
  youtube: {
    channelId: process.env.YOUTUBE_CHANNEL_ID,
    apiKey: process.env.YOUTUBE_API_KEY,
  },
  intervals: {
    twitchLive: parseInt(process.env.TWITCH_POLL_INTERVAL) || 60_000,
    twitchClips: parseInt(process.env.TWITCH_CLIPS_INTERVAL) || 300_000,
    youtubeFeed: parseInt(process.env.YOUTUBE_FEED_INTERVAL) || 300_000,
    youtubeLive: parseInt(process.env.YOUTUBE_LIVE_INTERVAL) || 120_000,
  },
};
