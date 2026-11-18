const { Client, GatewayIntentBits, EmbedBuilder, IntentsBitField, ChannelType, PermissionFlagsBits } = require('discord.js');
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
// server it is in. MessageContent is the exception, added for the coaching
// rooms' transcripts: it only makes the text of messages that REST reads
// available (no GuildMessages, so nothing is streamed). It is a privileged
// intent the owner switches on in the Developer Portal; when Discord refuses
// the login because of it, discordLogin.js calls dropMessageContent() and logs
// in again without it (hasMessageContent() then answers false).
const BASE_INTENTS = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates];
let messageContent = true;
const client = new Client({
  intents: [...BASE_INTENTS, GatewayIntentBits.MessageContent],
  allowedMentions: { parse: [] },
});

function hasMessageContent() {
  return messageContent;
}

// Logs in again without the Message Content intent (the next login uses the new options).
function dropMessageContent() {
  if (!messageContent) return false;
  messageContent = false;
  client.options.intents = new IntentsBitField(BASE_INTENTS).freeze();
  return true;
}

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

// A clip title is third-party text. Inside [text](url) its brackets would end the
// link early or start another one, and in a plain message they would make a link
// of their own (a masked link), so a backslash goes before each bracket and each
// backslash (a title ending in one would otherwise hide the closing bracket).
const escapeLinkText = (text) => String(text).replace(/[\\[\]]/g, '\\$&');

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
      .map((clip, i) => `${i + 1}. [${escapeLinkText(clip.title)}](${clip.url}) (${clip.view_count || 0} views)`)
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

// ── Coaching: direct messages, membership, invites ─────────────────────────

// Runs a promise against a deadline; the timer is cleared and never keeps the process alive.
function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('deadline')), ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// Sends one direct message. Never throws. 50007 (DMs closed) and 10013 (unknown user) are
// 'unreachable'; anything else, a timeout included, is 'failed'. No mention can ping anyone.
async function sendDirectMessage(userId, payload, { deadlineMs = 10000 } = {}) {
  if (typeof userId !== 'string' || !/^\d{17,20}$/.test(userId)) return { ok: false, reason: 'unreachable' };
  if (!client.isReady()) return { ok: false, reason: 'not_ready' };
  try {
    await withDeadline(client.users.send(userId, { ...payload, allowedMentions: { parse: [] } }), deadlineMs);
    return { ok: true };
  } catch (e) {
    if (e && (e.code === 50007 || e.code === 10013)) return { ok: false, reason: 'unreachable' };
    return { ok: false, reason: 'failed' };
  }
}

// Whether a user is a member of a server the bot is in: true, false, or null when that cannot be known.
async function isGuildMember(guildId, userId) {
  if (!client.isReady()) return null;
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild || typeof userId !== 'string' || !/^\d{17,20}$/.test(userId)) return null;
  if (guild.members.cache.has(userId)) return true;
  try {
    await withDeadline(guild.members.fetch(userId), 5000);
    return true;
  } catch (e) {
    return e && e.code === 10007 ? false : null;
  }
}

// What a saved invite code points at, from Discord's public endpoint (no bot needed).
async function fetchInvite(code) {
  try {
    const res = await fetch('https://discord.com/api/v10/invites/' + encodeURIComponent(code), { signal: AbortSignal.timeout(10000) });
    if (res.status === 404) return { ok: false, reason: 'unknown' };
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    const body = await res.json();
    if (!body || !body.guild || !body.guild.id) return { ok: false, reason: 'unavailable' };
    return { ok: true, guildId: String(body.guild.id), guildName: String(body.guild.name || '') };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

// ── Coaching rooms: every call the rooms make to Discord, each under a 10 s deadline. They throw what Discord
// throws (error.code is Discord's), or Error('not_ready') while the bot is not logged in; the caller decides.

const ROOM_DEADLINE_MS = 10000;
const SNOWFLAKE = /^\d{17,20}$/;
const isSnowflake = (id) => typeof id === 'string' && SNOWFLAKE.test(id);

function readyGuild(guildId) {
  if (!client.isReady()) throw new Error('not_ready');
  const guild = client.guilds.cache.get(String(guildId));
  // The bot is logged in and the server is not among its servers: removed from it or deleted, not Discord being down.
  if (!guild) { const e = new Error('guild_gone'); e.code = 'guild_gone'; throw e; }
  return guild;
}

function isReady() {
  return client.isReady();
}

// What the bot needs on the Coaching category (a channel's Manage Permissions is the ManageRoles flag), by the id the
// page translates; and Manage Roles in the server, which creates the session roles.
const CATEGORY_PERMISSIONS = [
  ['manage_channels', PermissionFlagsBits.ManageChannels],
  ['manage_permissions', PermissionFlagsBits.ManageRoles],
  ['view_channel', PermissionFlagsBits.ViewChannel],
  ['connect', PermissionFlagsBits.Connect],
  ['speak', PermissionFlagsBits.Speak],
  ['send_messages', PermissionFlagsBits.SendMessages],
  ['attach_files', PermissionFlagsBits.AttachFiles],
  ['read_message_history', PermissionFlagsBits.ReadMessageHistory],
];

// The categories of a server, [{ id, name }] by position; null while Discord cannot say.
async function listCategories(guildId) {
  try {
    const guild = readyGuild(guildId);
    const channels = await withDeadline(guild.channels.fetch(), ROOM_DEADLINE_MS);
    return [...channels.values()]
      .filter((c) => c && c.type === ChannelType.GuildCategory)
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ id: c.id, name: c.name }));
  } catch (e) {
    return null;
  }
}

// { ok: true }, { ok: false, reason: 'not_found' }, { ok: false, reason: 'permissions', missing: [ids] }, or
// { ok: false, reason: 'unknown' } when Discord cannot say.
async function checkCategory(guildId, categoryId) {
  if (!isSnowflake(categoryId)) return { ok: false, reason: 'not_found' };
  try {
    const guild = readyGuild(guildId);
    const me = guild.members.me || await withDeadline(guild.members.fetchMe(), ROOM_DEADLINE_MS);
    const category = await withDeadline(guild.channels.fetch(categoryId), ROOM_DEADLINE_MS);
    if (!category || category.type !== ChannelType.GuildCategory || category.guildId !== String(guildId)) return { ok: false, reason: 'not_found' };
    const have = category.permissionsFor(me);
    const missing = CATEGORY_PERMISSIONS.filter(([, flag]) => !have || !have.has(flag)).map(([id]) => id);
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) missing.push('manage_roles');
    return missing.length ? { ok: false, reason: 'permissions', missing } : { ok: true };
  } catch (e) {
    if (e && e.code === 10003) return { ok: false, reason: 'not_found' };
    return { ok: false, reason: 'unknown' };
  }
}

// A role with no permissions and no mention; Discord places it below the bot's top role.
async function createRole(guildId, name) {
  const guild = readyGuild(guildId);
  const role = await withDeadline(guild.roles.create({ name, permissions: [], mentionable: false, hoist: false, reason: 'Atleta coaching session' }), ROOM_DEADLINE_MS);
  return role.id;
}

async function deleteRole(guildId, roleId) {
  if (!isSnowflake(roleId)) return;
  const guild = readyGuild(guildId);
  try {
    await withDeadline(guild.roles.delete(roleId, 'Atleta coaching session ended'), ROOM_DEADLINE_MS);
  } catch (e) {
    if (!(e && e.code === 10011)) throw e;
  }
}

// A rename keeps everything else of the role or channel as it is. Discord's own refusal is thrown to the caller.
async function renameRole(guildId, roleId, name) {
  if (!isSnowflake(roleId)) return;
  const guild = readyGuild(guildId);
  await withDeadline(guild.roles.edit(roleId, { name, reason: 'Atleta coaching session moved' }), ROOM_DEADLINE_MS);
}

async function renameChannel(guildId, channelId, name) {
  if (!isSnowflake(channelId)) return;
  const guild = readyGuild(guildId);
  await withDeadline(guild.channels.edit(channelId, { name, reason: 'Atleta coaching session moved' }), ROOM_DEADLINE_MS);
}

async function addRoleToMember(guildId, userId, roleId) {
  const guild = readyGuild(guildId);
  const member = await withDeadline(guild.members.fetch(userId), ROOM_DEADLINE_MS);
  await withDeadline(member.roles.add(roleId, 'Atleta coaching session'), ROOM_DEADLINE_MS);
}

// A voice channel (its built-in text chat carries the messages and files) inside `parentId`, with the given
// permission overwrites: [{ id, type: 0 role | 1 member, allow: [flag names], deny: [flag names] }].
async function createVoiceChannel(guildId, { name, parentId, overwrites }) {
  const guild = readyGuild(guildId);
  const channel = await withDeadline(guild.channels.create({
    name, type: ChannelType.GuildVoice, parent: parentId, permissionOverwrites: overwrites, reason: 'Atleta coaching session',
  }), ROOM_DEADLINE_MS);
  return channel.id;
}

async function deleteChannel(guildId, channelId) {
  if (!isSnowflake(channelId)) return;
  const guild = readyGuild(guildId);
  try {
    await withDeadline(guild.channels.delete(channelId, 'Atleta coaching session ended'), ROOM_DEADLINE_MS);
  } catch (e) {
    if (!(e && e.code === 10003)) throw e;
  }
}

// Every message of a channel, oldest first, as plain data: [{ id, at, author, bot, content, attachments: [{ name, url,
// size }] }]. A channel that no longer exists answers null. Each page of 100 has its own deadline; at most 5000 messages.
async function fetchAllMessages(guildId, channelId, { max = 5000 } = {}) {
  const guild = readyGuild(guildId);
  let channel;
  try {
    channel = await withDeadline(guild.channels.fetch(channelId), ROOM_DEADLINE_MS);
  } catch (e) {
    if (e && e.code === 10003) return null;
    throw e;
  }
  if (!channel || typeof channel.messages?.fetch !== 'function') return null;
  const out = [];
  let before;
  while (out.length < max) {
    const page = await withDeadline(channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }), ROOM_DEADLINE_MS);
    if (!page.size) break;
    const batch = [...page.values()];
    for (const m of batch) {
      out.push({
        id: m.id,
        at: m.createdTimestamp,
        author: (m.member && m.member.displayName) || (m.author && (m.author.globalName || m.author.username)) || '?',
        bot: !!(m.author && m.author.bot),
        content: m.content || '',
        attachments: [...m.attachments.values()].map((a) => ({ name: a.name || 'file', url: a.url, size: a.size })),
      });
    }
    before = batch.reduce((oldest, m) => (m.createdTimestamp < oldest.createdTimestamp ? m : oldest)).id;
    if (page.size < 100) break;
  }
  return out.reverse();
}

// Only Discord's own file hosts are fetched (a message cannot point the bot at another server).
const ATTACHMENT_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

// The bytes of an attachment, never more than maxBytes (the declared size is not trusted: the body is read in chunks
// and stops past the limit). Throws on a foreign host, an answer that is not 200, or too many bytes.
async function downloadAttachment(url, { maxBytes, deadlineMs = 20000 } = {}) {
  let u;
  try { u = new URL(url); } catch (e) { throw new Error('bad_url'); }
  if (u.protocol !== 'https:' || !ATTACHMENT_HOSTS.has(u.hostname)) throw new Error('bad_host');
  const res = await fetch(u, { signal: AbortSignal.timeout(deadlineMs), redirect: 'error' });
  if (!res.ok || !res.body) throw new Error(`status_${res.status}`);
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('too_big');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function guildName(guildId) {
  const guild = client.guilds.cache.get(String(guildId));
  return guild ? guild.name : null;
}

module.exports = { client, hasMessageContent, dropMessageContent, isReady, listCategories, checkCategory, createRole, deleteRole, renameRole, renameChannel, addRoleToMember, createVoiceChannel, deleteChannel, fetchAllMessages, downloadAttachment, CATEGORY_PERMISSIONS, fetchGuildChannel, streamerGuildForChannel, sendToGuildChannel, sendDirectMessage, isGuildMember, fetchInvite, guildName, sendNotification, escapeLinkText, buildEmbed, buildRecapEmbed, buildWeeklyDigestEmbed, buildMilestoneEmbed };
