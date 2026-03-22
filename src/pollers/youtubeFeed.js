const { getLatestVideos } = require('../services/youtube');
const { sendNotification, buildEmbed } = require('../discord');
const config = require('../config');
const state = require('../state');

let appState;

async function poll() {
  try {
    const videos = await getLatestVideos();

    for (const video of videos) {
      if (appState.knownVideoIds.includes(video.id)) continue;
      if (appState.youtubeLiveVideoId === video.id) continue; // skip live streams (handled by youtubeLive poller)

      appState.knownVideoIds.push(video.id);

      const embed = buildEmbed({
        color: 0xff0000,
        author: { name: `${video.author || config.twitch.username} uploaded a new video!` },
        title: video.title,
        url: video.url,
        image: `https://i.ytimg.com/vi/${video.id}/maxresdefault.jpg`,
        footer: { text: 'YouTube' },
        timestamp: video.published,
      });
      await sendNotification(embed);
      console.log(`[YouTubeFeed] Sent video notification: ${video.title}`);
    }

    // Keep array bounded
    if (appState.knownVideoIds.length > 50) {
      appState.knownVideoIds = appState.knownVideoIds.slice(-50);
    }
    state.save(appState);
  } catch (error) {
    console.error(`[YouTubeFeed] Poll failed: ${error.message}`);
  }
}

function start(sharedState) {
  appState = sharedState;
  setInterval(poll, config.intervals.youtubeFeed);
  console.log(`[YouTubeFeed] Polling every ${config.intervals.youtubeFeed / 1000}s`);
}

async function init(sharedState) {
  appState = sharedState;
  try {
    const videos = await getLatestVideos();
    const existingIds = videos.map((v) => v.id);
    // Merge with any previously known IDs
    for (const id of existingIds) {
      if (!appState.knownVideoIds.includes(id)) {
        appState.knownVideoIds.push(id);
      }
    }
    console.log(`[YouTubeFeed] Initialized with ${appState.knownVideoIds.length} known videos`);
  } catch (error) {
    console.error(`[YouTubeFeed] Init failed: ${error.message}`);
  }
}

module.exports = { start, init };
