const { getLatestVideos } = require('../services/youtube');

async function check(youtubeChannelId, channelState) {
  const videos = await getLatestVideos(youtubeChannelId);
  const knownIds = JSON.parse(channelState.known_video_ids || '[]');
  const liveVideoId = channelState.live_video_id;

  const newVideos = videos.filter(
    (v) => !knownIds.includes(v.id) && v.id !== liveVideoId
  );

  const allIds = [...new Set([...knownIds, ...videos.map((v) => v.id)])].slice(-50);

  if (newVideos.length === 0) {
    if (allIds.length !== knownIds.length) {
      return { notify: false, stateUpdate: { known_video_ids: JSON.stringify(allIds) } };
    }
    return null;
  }

  // Send as plain text messages so Discord auto-generates the video player
  const videoData = newVideos.map((video) => {
    const message = `**${video.author || 'New'} uploaded a new video!** — ${video.title}\n${video.url}`;
    return { message };
  });

  return {
    notify: true,
    videoData,
    stateUpdate: { known_video_ids: JSON.stringify(allIds) },
  };
}

module.exports = { check };
