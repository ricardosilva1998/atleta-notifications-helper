const { getLatestVideos, checkLiveStatus } = require('../services/youtube');
const { sendNotification, buildEmbed } = require('../discord');
const config = require('../config');
const state = require('../state');

let appState;

async function poll() {
  try {
    const videos = await getLatestVideos();
    const videoIds = videos.map((v) => v.id);

    const liveVideo = await checkLiveStatus(videoIds);

    if (liveVideo && !appState.youtubeIsLive) {
      appState.youtubeIsLive = true;
      appState.youtubeLiveVideoId = liveVideo.id;
      state.save(appState);

      const embed = buildEmbed({
        color: 0xff0000,
        author: { name: `${config.twitch.username} is live on YouTube!` },
        title: liveVideo.title,
        url: `https://www.youtube.com/watch?v=${liveVideo.id}`,
        description: liveVideo.description?.substring(0, 200) || undefined,
        image: liveVideo.thumbnail,
        footer: { text: 'YouTube Live' },
        timestamp: new Date(),
      });
      await sendNotification(embed);
      console.log(`[YouTubeLive] Sent live notification: ${liveVideo.title}`);
    } else if (!liveVideo && appState.youtubeIsLive) {
      appState.youtubeIsLive = false;
      appState.youtubeLiveVideoId = null;
      state.save(appState);
      console.log('[YouTubeLive] Stream ended');
    }
  } catch (error) {
    console.error(`[YouTubeLive] Poll failed: ${error.message}`);
  }
}

function start(sharedState) {
  appState = sharedState;
  setInterval(poll, config.intervals.youtubeLive);
  console.log(`[YouTubeLive] Polling every ${config.intervals.youtubeLive / 1000}s`);
}

async function init(sharedState) {
  appState = sharedState;
  try {
    const videos = await getLatestVideos();
    const videoIds = videos.map((v) => v.id);
    const liveVideo = await checkLiveStatus(videoIds);
    appState.youtubeIsLive = !!liveVideo;
    appState.youtubeLiveVideoId = liveVideo?.id || null;
    console.log(`[YouTubeLive] Initial state: ${appState.youtubeIsLive ? 'LIVE' : 'offline'}`);
  } catch (error) {
    console.error(`[YouTubeLive] Init failed: ${error.message}`);
  }
}

module.exports = { start, init };
