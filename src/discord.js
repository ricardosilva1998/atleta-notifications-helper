const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const config = require('./config');
const { isChannelInGuild, isTextChannel, DELIVERY_CHANNEL_UNAVAILABLE } = require('./services/discordGuards');

// Posted text (clip and video titles, creator names) comes from third parties,
// so by default nothing the bot sends may ping @everyone, @here, roles or
// users. A send that should ping someone opts in with its own allowedMentions.
//
// Intents: Guilds (servers, channels, roles), GuildMembers (the welcome message
// and role sync), GuildVoiceStates (the Discord voice overlay). Nothing reads
// the messages people write in a server, so GuildMessages is not asked for:
// with it Discord sends the bot, and discord.js caches, every message in every
// server it is in.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates],
  allowedMentions: { parse: [] },
});

// The only way to reach a channel before posting: it must be a channel of the
// server the post is for, and one that holds messages (a saved category id
// would otherwise fail every post). A saved channel id is never trusted on its own.
async function fetchGuildChannel(guildId, channelId) {
  if (!guildId || typeof channelId !== 'string' || !/^\d{17,20}$/.test(channelId)) return null;
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) return null;
  const channel = guild.channels.cache.get(channelId)
    || await guild.channels.fetch(channelId).catch(() => null);
  return isChannelInGuild(channel, guildId) && isTextChannel(channel) ? channel : null;
}

// The moderation log has no server of its own: its channel must be a channel
// that holds messages in a server the streamer has claimed. Returns that
// server's id, or null.
function streamerGuildForChannel(streamerId, channelId) {
  if (!streamerId || !channelId) return null;
  const db = require('./db');
  const claim = db.getGuildsForStreamer(streamerId)
    .find((g) => isTextChannel(client.guilds.cache.get(g.guild_id)?.channels.cache.get(String(channelId))));
  return claim ? claim.guild_id : null;
}

// Bookkeeping must never turn a delivered post into a failure (or hide one).
function noteDelivery(guildId, streamerId, channelId, error) {
  if (!guildId || !streamerId) return;
  try {
    const db = require('./db');
    if (error) db.recordDeliveryError(guildId, streamerId, channelId, error);
    else db.clearDeliveryError(guildId, streamerId, channelId);
  } catch (e) {
    console.error(`[Discord] Could not record delivery status: ${e.message}`);
  }
}

// Posts into a channel of a claimed server for one streamer. Returns false when
// the channel isn't a channel of that server the bot can reach; rethrows what
// Discord rejects. Either failure is kept for the server's settings page, and
// a later success in the same channel clears it.
async function sendToGuildChannel(guildId, streamerId, channelId, payload) {
  const channel = await fetchGuildChannel(guildId, channelId);
  if (!channel) {
    noteDelivery(guildId, streamerId, channelId, DELIVERY_CHANNEL_UNAVAILABLE);
    return false;
  }
  try {
    await channel.send(payload);
  } catch (error) {
    noteDelivery(guildId, streamerId, channelId, error.message);
    throw error;
  }
  noteDelivery(guildId, streamerId, channelId, null);
  return true;
}

// Posts a notification. Returns whether it was posted: false when the channel is
// not one the bot can reach in that server (logged, and kept for the server's
// settings page). Rethrows what Discord rejects. A caller that records a post as
// done, or counts it, must look at the result: a normal return alone is not a post.
async function sendNotification(channelId, embed, meta) {
  const db = require('./db');
  const guildId = meta?.guildId;
  try {
    const payload = meta?.contentOnly ? meta.contentOnly : { embeds: [embed] };
    const sent = await sendToGuildChannel(guildId, meta?.streamerId, channelId, payload);
    if (!sent) console.error(`[Discord] Channel ${channelId} is not a channel of server ${guildId} the bot can reach`);
    if (meta) db.logNotification(meta.streamerId, guildId, meta.type, sent);
    return sent;
  } catch (error) {
    console.error(`Discord send error: ${error.message} (code: ${error.code}, status: ${error.status})`);
    if (meta) db.logNotification(meta.streamerId, guildId, meta.type, false);
    throw error;
  }
}

function buildEmbed({ color, author, title, url, description, image, fields, footer, timestamp }) {
  const embed = new EmbedBuilder();
  if (color) embed.setColor(color);
  if (author) embed.setAuthor(author);
  if (title) embed.setTitle(title);
  if (url) embed.setURL(url);
  if (description) embed.setDescription(description);
  if (image) embed.setImage(image);
  if (fields) embed.addFields(fields);
  if (footer) embed.setFooter(footer);
  if (timestamp) embed.setTimestamp(timestamp instanceof Date ? timestamp : new Date(timestamp));
  return embed;
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function buildRecapEmbed({ twitchUsername, title, category, duration, thumbnailUrl, clips, peakViewers, followerCount, vodUrl }) {
  const fields = [
    { name: 'Category', value: category || 'Unknown', inline: true },
    { name: 'Duration', value: formatDuration(duration), inline: true },
  ];

  if (peakViewers > 0) {
    fields.push({ name: 'Peak Viewers', value: peakViewers.toLocaleString(), inline: true });
  }

  if (followerCount !== null && followerCount !== undefined) {
    fields.push({ name: 'Followers', value: followerCount.toLocaleString(), inline: true });
  }

  if (clips && clips.length > 0) {
    const clipList = clips
      .map((clip, i) => `${i + 1}. [${clip.title}](${clip.url}) (${clip.view_count || 0} views)`)
      .join('\n');
    fields.push({ name: 'Top Clips', value: clipList });
  }

  return buildEmbed({
    color: 0x9146ff,
    author: { name: `${twitchUsername} stream recap` },
    title: title || 'Stream ended',
    url: vodUrl || `https://twitch.tv/${twitchUsername}`,
    image: thumbnailUrl || undefined,
    fields,
    footer: { text: 'Stream Recap' },
    timestamp: new Date(),
  });
}

// A clip title goes inside [text](url): brackets in it would end the link early.
const escapeLinkText = (text) => String(text).replace(/[\\[\]]/g, '\\$&');

// topClip is a Twitch clip: { title, url, view_count }. Discord refuses the
// whole message when an embed field has an empty value, so a field with nothing
// to show is left out: a week with streams but no clips has no categories.
function buildWeeklyDigestEmbed({ streamCount, totalHours, categories, topClip }) {
  const fields = [
    { name: 'Streams', value: String(streamCount), inline: true },
    { name: 'Total Hours', value: totalHours.toFixed(1), inline: true },
  ];
  const categoryList = (categories || []).filter(Boolean).join(', ');
  if (categoryList) {
    fields.push({ name: 'Categories', value: categoryList.slice(0, 1024) }); // 1024 is the limit of a field
  }
  if (topClip) {
    const views = Number(topClip.view_count);
    const link = `[${escapeLinkText(topClip.title)}](${topClip.url})`;
    fields.push({ name: 'Top Clip', value: Number.isFinite(views) ? `${link} (${views} views)` : link });
  }
  return buildEmbed({
    color: 0x3498db,
    author: { name: 'Weekly Highlights' },
    title: 'Your week in streaming',
    fields,
    footer: { text: 'Weekly Digest' },
    timestamp: new Date(),
  });
}

function buildMilestoneEmbed({ twitchUsername, milestoneType, count }) {
  const label = milestoneType === 'subscriber' ? 'subscribers' : 'followers';
  return buildEmbed({
    color: 0xf1c40f,
    title: `\u{1F389} ${twitchUsername} just hit ${count} ${label}!`,
    url: `https://twitch.tv/${twitchUsername}`,
    description: 'Congratulations! A new milestone has been reached.',
    footer: { text: 'Milestone Celebration' },
    timestamp: new Date(),
  });
}

function buildInstagramEmbed({ username, displayName, profileImageUrl, caption, postUrl, imageUrl, timestamp }) {
  return buildEmbed({
    color: 0xE1306C,
    author: { name: `${displayName || username} posted on Instagram`, iconURL: profileImageUrl || undefined },
    title: caption ? caption.slice(0, 100) : 'New post',
    url: postUrl,
    image: imageUrl || undefined,
    footer: { text: 'Instagram' },
    timestamp,
  });
}

function buildTikTokEmbed({ username, displayName, profileImageUrl, description, videoUrl, thumbnailUrl, timestamp }) {
  return buildEmbed({
    color: 0x010101,
    author: { name: `${displayName || username} posted on TikTok`, iconURL: profileImageUrl || undefined },
    title: description ? description.slice(0, 100) : 'New video',
    url: videoUrl,
    image: thumbnailUrl || undefined,
    footer: { text: 'TikTok' },
    timestamp,
  });
}

function buildTwitterEmbed({ username, displayName, profileImageUrl, text, tweetUrl, mediaUrl, timestamp }) {
  return buildEmbed({
    color: 0x1DA1F2,
    author: { name: `${displayName || username} tweeted`, iconURL: profileImageUrl || undefined },
    description: text,
    url: tweetUrl,
    image: mediaUrl || undefined,
    footer: { text: 'Twitter' },
    timestamp,
  });
}

function formatLapTime(seconds) {
  if (!seconds || seconds <= 0) return 'N/A';
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(3);
  return `${mins}:${secs.padStart(6, '0')}`;
}

function buildIracingResultEmbed(raceData) {
  const posChange = raceData.starting_position - raceData.finish_position;
  let posChangeStr = '';
  if (posChange > 0) posChangeStr = ` (started P${raceData.starting_position} — gained ${posChange})`;
  else if (posChange < 0) posChangeStr = ` (started P${raceData.starting_position} — lost ${Math.abs(posChange)})`;
  else posChangeStr = ` (started P${raceData.starting_position})`;

  let iratingStr = raceData.new_irating?.toLocaleString() || '0';
  if (raceData.irating_change > 0) iratingStr += ` (+${raceData.irating_change} ▲)`;
  else if (raceData.irating_change < 0) iratingStr += ` (${raceData.irating_change} ▼)`;
  else iratingStr += ' (±0)';

  const fields = [
    { name: 'Position', value: `P${raceData.finish_position} / ${raceData.field_size}${posChangeStr}`, inline: true },
    { name: 'iRating', value: iratingStr, inline: true },
    { name: 'Incidents', value: `${raceData.incidents}x`, inline: true },
    { name: 'Laps', value: `${raceData.laps_completed}`, inline: true },
    { name: 'Car', value: raceData.car_name || 'Unknown', inline: true },
    { name: 'SOF', value: raceData.strength_of_field?.toLocaleString() || '0', inline: true },
  ];

  if (raceData.fastest_lap_time) {
    fields.push({ name: 'Fastest Lap', value: formatLapTime(raceData.fastest_lap_time) });
  }
  if (raceData.qualifying_time) {
    fields.push({ name: 'Qualifying', value: `${formatLapTime(raceData.qualifying_time)} (P${raceData.starting_position})` });
  }

  return buildEmbed({
    color: 0x1a1a2e,
    author: { name: `${raceData.driver_name} finished a race` },
    title: `${raceData.series_name} — ${raceData.track_name}`,
    url: `https://members.iracing.com/membersite/member/EventResult.do?subsessionid=${raceData.subsession_id}`,
    fields,
    footer: { text: 'iRacing' },
    timestamp: raceData.race_date ? new Date(raceData.race_date) : new Date(),
  });
}

module.exports = { client, fetchGuildChannel, streamerGuildForChannel, sendToGuildChannel, sendNotification, buildEmbed, buildRecapEmbed, buildWeeklyDigestEmbed, buildMilestoneEmbed, buildInstagramEmbed, buildTikTokEmbed, buildTwitterEmbed, buildIracingResultEmbed, formatLapTime };
