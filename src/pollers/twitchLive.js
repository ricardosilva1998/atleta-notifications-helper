const { getStream, getClips, getVideos, getFollowerCount } = require('../services/twitch');
const { buildEmbed } = require('../discord');

function formatThumbnail(url) {
  return url.replace('{width}', '1280').replace('{height}', '720');
}

async function check(twitchUsername, channelState, broadcasterToken) {
  const stream = await getStream(twitchUsername);

  // Channel just went LIVE
  if (stream && !channelState.is_live) {
    const embed = buildEmbed({
      color: 0x9146ff,
      author: { name: `${stream.user_name || twitchUsername} is live on Twitch!` },
      title: stream.title,
      url: `https://twitch.tv/${twitchUsername}`,
      description: `Playing **${stream.game_name || 'Unknown'}**`,
      image: formatThumbnail(stream.thumbnail_url),
      footer: { text: 'Twitch' },
      timestamp: new Date(),
    });

    return {
      notify: true,
      embed,
      stateUpdate: {
        is_live: 1,
        stream_title: stream.title,
        stream_category: stream.game_name || 'Unknown',
        stream_thumbnail_url: formatThumbnail(stream.thumbnail_url),
        stream_started_at: stream.started_at,
        peak_viewers: stream.viewer_count || 0,
      },
    };
  }

  // Channel is STILL LIVE — update peak viewers and current info
  if (stream && channelState.is_live) {
    return {
      notify: false,
      stateUpdate: {
        peak_viewers: stream.viewer_count || 0,
        stream_title: stream.title,
        stream_category: stream.game_name || 'Unknown',
        stream_thumbnail_url: formatThumbnail(stream.thumbnail_url),
      },
    };
  }

  // Channel just went OFFLINE — build recap data
  if (!stream && channelState.is_live) {
    let recapData = null;

    if (channelState.stream_started_at) {
      const startedAt = new Date(channelState.stream_started_at);
      const now = new Date();
      const durationSec = Math.floor((now - startedAt) / 1000);

      // Skip recap for very short streams (under 5 minutes)
      if (durationSec >= 300) {
        let clips = [];
        let vodUrl = null;
        let followerCount = null;
        let thumbnailFromVod = null;
        const broadcasterId = channelState.twitch_broadcaster_id;

        if (broadcasterId) {
          // Fetch top clips from the stream
          try {
            const allClips = await getClips(broadcasterId, channelState.stream_started_at, now.toISOString());
            clips = allClips
              .sort((a, b) => b.view_count - a.view_count)
              .slice(0, 3);
          } catch (e) {
            console.error(`[TwitchLive] Failed to fetch recap clips for ${twitchUsername}: ${e.message}`);
          }

          // Fetch the VOD (most recent archived video) + its thumbnail
          try {
            const videos = await getVideos(broadcasterId);
            if (videos.length > 0) {
              vodUrl = videos[0].url;
              // VOD thumbnails use %{width} and %{height} placeholders
              if (videos[0].thumbnail_url) {
                const vodThumb = videos[0].thumbnail_url
                  .replace('%{width}', '1280').replace('%{height}', '720')
                  .replace('{width}', '1280').replace('{height}', '720');
                if (vodThumb && !vodThumb.includes('_404')) {
                  thumbnailFromVod = vodThumb;
                }
              }
            }
          } catch (e) {
            console.error(`[TwitchLive] Failed to fetch VOD for ${twitchUsername}: ${e.message}`);
          }

          // Fetch follower count if broadcaster token available
          if (broadcasterToken) {
            try {
              followerCount = await getFollowerCount(broadcasterId, broadcasterToken);
            } catch (e) {
              // Silently skip
            }
          }
        }

        recapData = {
          twitchUsername,
          title: channelState.stream_title,
          category: channelState.stream_category,
          thumbnailUrl: thumbnailFromVod || channelState.stream_thumbnail_url,
          duration: durationSec,
          peakViewers: channelState.peak_viewers || 0,
          followerCount,
          vodUrl,
          clips,
        };
      }
    }

    return {
      notify: false,
      recapData,
      stateUpdate: { is_live: 0 },
      clearSession: true,
    };
  }

  return null;
}

module.exports = { check };
