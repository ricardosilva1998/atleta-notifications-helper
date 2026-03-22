const { getStream } = require('../services/twitch');
const { sendNotification, buildEmbed } = require('../discord');
const config = require('../config');
const state = require('../state');

let appState;

function formatThumbnail(url) {
  return url.replace('{width}', '1280').replace('{height}', '720');
}

async function poll() {
  try {
    const stream = await getStream(config.twitch.username);

    if (stream && !appState.twitchIsLive) {
      appState.twitchIsLive = true;
      state.save(appState);

      const embed = buildEmbed({
        color: 0x9146ff,
        author: { name: `${config.twitch.username} is live on Twitch!` },
        title: stream.title,
        url: `https://twitch.tv/${config.twitch.username}`,
        description: `Playing **${stream.game_name || 'Unknown'}**`,
        image: formatThumbnail(stream.thumbnail_url),
        footer: { text: 'Twitch' },
        timestamp: new Date(),
      });
      await sendNotification(embed);
      console.log(`[TwitchLive] Sent live notification: ${stream.title}`);
    } else if (!stream && appState.twitchIsLive) {
      appState.twitchIsLive = false;
      state.save(appState);
      console.log('[TwitchLive] Stream ended');
    }
  } catch (error) {
    console.error(`[TwitchLive] Poll failed: ${error.message}`);
  }
}

function start(sharedState) {
  appState = sharedState;
  setInterval(poll, config.intervals.twitchLive);
  console.log(`[TwitchLive] Polling every ${config.intervals.twitchLive / 1000}s`);
}

async function init(sharedState) {
  appState = sharedState;
  const stream = await getStream(config.twitch.username);
  appState.twitchIsLive = !!stream;
  console.log(`[TwitchLive] Initial state: ${appState.twitchIsLive ? 'LIVE' : 'offline'}`);
}

module.exports = { start, init };
