const { getClips, getUserId } = require('../services/twitch');
const { buildEmbed } = require('../discord');

async function check(twitchUsername, channelState) {
  let broadcasterId = channelState.twitch_broadcaster_id;

  if (!broadcasterId) {
    broadcasterId = await getUserId(twitchUsername);
    if (!broadcasterId) return null;
    return { notify: false, stateUpdate: { twitch_broadcaster_id: broadcasterId } };
  }

  const since = channelState.last_clip_created_at || new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const clips = await getClips(broadcasterId, since);

  if (clips.length > 0) {
    console.log(`[TwitchClips] ${twitchUsername}: found ${clips.length} clips since ${since}`);
  }

  const newClips = clips.filter(
    (clip) => !channelState.last_clip_created_at || clip.created_at > channelState.last_clip_created_at
  );

  if (newClips.length === 0) return null;
  console.log(`[TwitchClips] ${twitchUsername}: ${newClips.length} NEW clips to notify`);

  const clipData = newClips.map((clip) => {
    const duration = `${Math.round(clip.duration)}s`;
    const message = `**New clip by ${clip.creator_name}** — ${clip.title}\n📊 ${clip.view_count} views · ⏱️ ${duration}\n${clip.url}`;
    return { message };
  });

  const newest = newClips.reduce((a, b) => (a.created_at > b.created_at ? a : b));

  return {
    notify: true,
    clipData,
    stateUpdate: { last_clip_created_at: newest.created_at },
  };
}

module.exports = { check };
