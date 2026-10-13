'use strict';

// Rules that keep a streamer's Discord settings inside servers they run and
// within Discord's limits: who may claim a server, which channels a server's
// settings may point at, how long a welcome message may be, and the
// permissions the bot asks for when it is invited.

const { PermissionFlagsBits } = require('discord.js');

// ─── Bot invite ───────────────────────────────────────────────────────────────
// Live/clip/recap/milestone/digest notifications, welcome messages and the
// moderation log only see and post in channels (embeds, link previews); sub
// sync gives and takes one role. Nothing else is used, so nothing else is asked.
const BOT_INVITE_PERMISSION_NAMES = [
  'ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory', 'ManageRoles',
];
const BOT_INVITE_PERMISSIONS = BOT_INVITE_PERMISSION_NAMES.reduce((bits, name) => bits | PermissionFlagsBits[name], 0n);

function botInviteUrl(clientId) {
  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}`
    + `&permissions=${BOT_INVITE_PERMISSIONS}&scope=bot%20applications.commands`;
}

// ─── Channels ─────────────────────────────────────────────────────────────────
// A channel id saved for a server (or about to be posted to) must be one of
// that server's channels.
function isChannelInGuild(channel, guildId) {
  return !!channel && !!guildId && channel.guildId != null && String(channel.guildId) === String(guildId);
}

// Stored as a server's last delivery error when a saved channel is gone, the
// bot can't see it, or it isn't a channel of that server.
const DELIVERY_CHANNEL_UNAVAILABLE = 'channel_unavailable';

// ─── Claiming a server ────────────────────────────────────────────────────────
// Only someone who may manage the Discord server can claim it. Answers are kept
// for a minute per user and server so the dashboard's server list doesn't ask
// Discord on every page load; a claim itself asks again ({ fresh: true }).
const MANAGE_CHECK_TTL_MS = 60_000;
const manageChecks = new Map(); // `${userId}:${guildId}` -> { ok, expiresAt }

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of manageChecks) {
    if (entry.expiresAt <= now) manageChecks.delete(key);
  }
}, 60_000).unref();

async function canManageGuild(guild, userId, { fresh = false } = {}) {
  if (!guild || !userId) return false;
  const key = `${userId}:${guild.id}`;
  if (!fresh) {
    const cached = manageChecks.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.ok;
  }
  let ok = false;
  try {
    const member = await guild.members.fetch(fresh ? { user: userId, force: true } : userId);
    ok = !!member && member.permissions.has(PermissionFlagsBits.ManageGuild);
  } catch {
    ok = false; // not a member of that server, or Discord could not answer
  }
  manageChecks.set(key, { ok, expiresAt: Date.now() + MANAGE_CHECK_TTL_MS });
  return ok;
}

// ─── Welcome message ──────────────────────────────────────────────────────────
// Sent as an embed description, which Discord rejects over 4096 characters.
const WELCOME_MESSAGE_MAX = 4000;

function clampWelcomeMessage(text) {
  if (typeof text !== 'string') return '';
  // Forms submit a textarea line break as \r\n but the browser counted it as one.
  let out = text.replace(/\r\n?/g, '\n');
  if (out.length > WELCOME_MESSAGE_MAX) {
    out = out.slice(0, WELCOME_MESSAGE_MAX);
    if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1); // don't leave half an emoji
  }
  return out;
}

module.exports = {
  BOT_INVITE_PERMISSIONS,
  botInviteUrl,
  isChannelInGuild,
  DELIVERY_CHANNEL_UNAVAILABLE,
  canManageGuild,
  WELCOME_MESSAGE_MAX,
  clampWelcomeMessage,
};
