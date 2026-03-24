const { getLatestVideos } = require('../services/tiktok');

async function check(tiktokUsername, accountState) {
  const videos = await getLatestVideos(tiktokUsername);
  if (videos === null) return null; // service unavailable

  const knownIds = JSON.parse(accountState.known_video_ids || '[]');
  const newVideos = videos.filter((v) => !knownIds.includes(v.id));
  const allIds = [...new Set([...knownIds, ...videos.map((v) => v.id)])].slice(-50);

  if (newVideos.length === 0) {
    if (allIds.length !== knownIds.length) {
      return { notify: false, stateUpdate: { known_video_ids: JSON.stringify(allIds) } };
    }
    return null;
  }

  return {
    notify: true,
    items: newVideos,
    stateUpdate: { known_video_ids: JSON.stringify(allIds), last_checked: new Date().toISOString() },
  };
}

module.exports = { check };
