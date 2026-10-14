const { getLatestVideos, getVideoDetails } = require('../services/youtube');
const { escapeLinkText } = require('../discord');

// Said once per outage, not on every poll: the feed is read every five minutes.
let warnedAboutDetails = false;

// What YouTube says about new videos (length, and whether one is a live or
// upcoming broadcast): { [id]: details }. Without an API key there is nothing to
// ask, and nothing to say. When the lookup fails, or YouTube does not list a
// video, that video simply has no entry and is treated as a normal video: a
// missing duration must not stop an upload from being announced.
async function lookUpDetails(videoIds, apiKey) {
  if (!apiKey || videoIds.length === 0) return {};
  try {
    const details = await getVideoDetails(videoIds, apiKey);
    warnedAboutDetails = false;
    return details;
  } catch (error) {
    if (!warnedAboutDetails) {
      warnedAboutDetails = true;
      console.warn(`[YouTubeFeed] Could not read the details of new videos (${error.message}) - announcing them as normal videos`);
    }
    return {};
  }
}

async function check(youtubeChannelId, channelState, apiKey) {
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

  // Enrich with Shorts and live detection if API key is available
  const videoDetails = await lookUpDetails(newVideos.map((v) => v.id), apiKey);

  // A broadcast that is on air or announced is the live poller's to announce. It
  // is still remembered as known, so it is not announced as an upload later.
  const uploads = newVideos.filter((v) => !videoDetails[v.id]?.isLiveOrUpcoming);

  // Send as plain text messages so Discord auto-generates the video player (the
  // URL stays on its own line, as it is). The channel's name and the video's title
  // are the channel owner's own text: their brackets must not turn into a link.
  const videoData = uploads.map((video) => {
    const isShort = videoDetails[video.id]?.isShort || false;
    const author = video.author ? escapeLinkText(video.author) : 'New';
    const title = escapeLinkText(video.title);
    const message = isShort
      ? `📱 **${author} posted a Short!** — ${title}\n${video.url}`
      : `🎬 **${author} uploaded a new video!** — ${title}\n${video.url}`;
    return { message, isShort };
  });

  return {
    notify: videoData.length > 0,
    videoData,
    stateUpdate: { known_video_ids: JSON.stringify(allIds) },
  };
}

module.exports = { check };
