const { buildEmbed } = require('../discord');

// How many of a channel's latest videos are looked at for a live broadcast.
const LIVE_CHECK_VIDEOS = 5;

// What a poll means for a channel, given the live video found among its latest
// videos (null when none is on air): the notification and the state to store, or
// null when nothing changed. The lookup itself is done for all channels at once
// (services/youtube.js getLiveVideos), so that the videos of many channels share
// requests and the daily quota.
function decide(channelState, liveVideo) {
  if (liveVideo && !channelState.is_live) {
    const embed = buildEmbed({
      color: 0xff0000,
      author: { name: 'Live on YouTube!' },
      title: liveVideo.title,
      url: `https://www.youtube.com/watch?v=${liveVideo.id}`,
      description: liveVideo.description?.substring(0, 200) || undefined,
      image: liveVideo.thumbnail,
      footer: { text: 'YouTube Live' },
      timestamp: new Date(),
    });

    return {
      notify: true,
      embed,
      stateUpdate: { is_live: 1, live_video_id: liveVideo.id },
    };
  }

  if (!liveVideo && channelState.is_live) {
    return { notify: false, stateUpdate: { is_live: 0, live_video_id: null } };
  }

  return null;
}

module.exports = { decide, LIVE_CHECK_VIDEOS };
