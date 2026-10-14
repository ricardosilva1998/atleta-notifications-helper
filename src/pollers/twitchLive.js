const { getClips, getVideos, getFollowerCount } = require('../services/twitch');
const { buildEmbed } = require('../discord');

// A channel is marked offline only when this many polls in a row found no
// stream. One empty answer is as likely a hiccup of Twitch, or a stream that
// dropped and reconnected, as an ended stream; acting on it posts a recap in
// the middle of a stream and then a second "is live" post when it returns.
const OFFLINE_CONFIRM_POLLS = 2;

// Streams shorter than this get no recap.
const MIN_RECAP_SECONDS = 300;

function formatThumbnail(url) {
  return url.replace('{width}', '1280').replace('{height}', '720');
}

// What a poll means for a channel: the stream Twitch returned (null when the
// channel is not live) against what was stored. The stream id tells one
// broadcast from the next.
//   offline    still offline: nothing to do
//   started    went live: announce it
//   resumed    live with the broadcast announced before (it was marked offline
//              too soon): back to live, but not announced a second time
//   continuing still live
//   replaced   live with another broadcast than the one announced: that one
//              ended, and a new one began, between two polls
//   missed     no stream, but not for OFFLINE_CONFIRM_POLLS polls in a row yet
//   ended      no stream for OFFLINE_CONFIRM_POLLS polls in a row: it is over
function classifyPoll(channelState, stream) {
  const wasLive = Boolean(channelState.is_live);
  const announcedId = channelState.last_stream_id ? String(channelState.last_stream_id) : null;
  const streamId = stream && stream.id != null ? String(stream.id) : null;

  if (!stream) {
    if (!wasLive) return { kind: 'offline' };
    const missed = (Number(channelState.offline_polls) || 0) + 1;
    return missed >= OFFLINE_CONFIRM_POLLS ? { kind: 'ended' } : { kind: 'missed', missed };
  }
  if (!wasLive) {
    return announcedId && streamId === announcedId ? { kind: 'resumed' } : { kind: 'started' };
  }
  if (announcedId && streamId && streamId !== announcedId) return { kind: 'replaced' };
  return { kind: 'continuing' };
}

// What is stored about a broadcast that is on now.
function sessionFields(stream) {
  return {
    last_stream_id: stream.id != null ? String(stream.id) : undefined,
    stream_title: stream.title,
    stream_category: stream.game_name || 'Unknown',
    stream_thumbnail_url: formatThumbnail(stream.thumbnail_url),
    stream_started_at: stream.started_at,
    peak_viewers: stream.viewer_count || 0,
  };
}

function goLive(twitchUsername, stream) {
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
    kind: 'started',
    notify: true,
    embed,
    stateUpdate: { is_live: 1, offline_polls: 0, ...sessionFields(stream) },
  };
}

// The recap of the broadcast stored for the channel, or null when it was too
// short. `vod: false` leaves out the VOD link: when another broadcast has
// already begun, the newest VOD is that one's.
async function buildRecap(twitchUsername, channelState, broadcasterToken, { vod = true } = {}) {
  if (!channelState.stream_started_at) return null;

  const startedAt = new Date(channelState.stream_started_at);
  const now = new Date();
  const durationSec = Math.floor((now - startedAt) / 1000);
  if (durationSec < MIN_RECAP_SECONDS) return null;

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
    if (vod) {
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

  return {
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

// `stream` is what Twitch returned for the channel in this poll (null when it
// is not live); the caller looks channels up in batches. Returns null when
// there is nothing to do, otherwise { kind, notify, embed?, recapData?,
// stateUpdate?, clearSession? }. A clearSession is applied before the
// stateUpdate, so the update can start the next broadcast's session.
async function check(twitchUsername, channelState, broadcasterToken, stream) {
  const poll = classifyPoll(channelState, stream);

  switch (poll.kind) {
    case 'offline':
      return null;

    case 'missed':
      // Might be a hiccup: wait for one more poll before calling it offline.
      return { kind: 'missed', notify: false, stateUpdate: { offline_polls: poll.missed } };

    case 'continuing':
      return {
        kind: 'continuing',
        notify: false,
        stateUpdate: {
          offline_polls: 0,
          last_stream_id: stream.id != null ? String(stream.id) : undefined, // learned from the first poll after an upgrade
          peak_viewers: stream.viewer_count || 0,
          stream_title: stream.title,
          stream_category: stream.game_name || 'Unknown',
          stream_thumbnail_url: formatThumbnail(stream.thumbnail_url),
        },
      };

    case 'resumed':
      return { kind: 'resumed', notify: false, stateUpdate: { is_live: 1, offline_polls: 0, ...sessionFields(stream) } };

    case 'started':
      return goLive(twitchUsername, stream);

    case 'replaced': {
      const recapData = await buildRecap(twitchUsername, channelState, broadcasterToken, { vod: false });
      return { ...goLive(twitchUsername, stream), kind: 'replaced', recapData, clearSession: true };
    }

    case 'ended': {
      const recapData = await buildRecap(twitchUsername, channelState, broadcasterToken);
      return {
        kind: 'ended',
        notify: false,
        recapData,
        stateUpdate: { is_live: 0, offline_polls: 0 },
        clearSession: true,
      };
    }

    default:
      return null;
  }
}

module.exports = { check, classifyPoll, OFFLINE_CONFIRM_POLLS };
