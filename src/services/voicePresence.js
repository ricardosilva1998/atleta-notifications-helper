'use strict';

// Who is in a Discord voice channel, for the Atleta Racing app's Discord voice
// overlay. The overlay asks with nothing but a Discord user id and no login
// (GET /api/voice/:discordUserId), so it is only ever answered about a voice
// channel that everyone in that server can see: a private channel, and who is
// in it, is never reported.

const { PermissionFlagsBits } = require('discord.js');

// A Discord id: a snowflake of 17 to 20 digits.
function isSnowflake(id) {
  return typeof id === 'string' && /^\d{17,20}$/.test(id);
}

// True when the server's @everyone role can view the channel.
function isPublicVoiceChannel(channel) {
  const everyone = channel && channel.guild && channel.guild.roles && channel.guild.roles.everyone;
  if (!everyone || typeof channel.permissionsFor !== 'function') return false;
  const permissions = channel.permissionsFor(everyone);
  return !!permissions && permissions.has(PermissionFlagsBits.ViewChannel);
}

// The voice channel the user is connected to in any of `guilds`, or null when
// they are in none, or in one @everyone cannot see.
function findPublicVoiceChannel(guilds, userId) {
  for (const guild of guilds) {
    const state = guild.voiceStates.cache.get(userId);
    if (state && state.channelId) return isPublicVoiceChannel(state.channel) ? state.channel : null;
  }
  return null;
}

module.exports = { isSnowflake, isPublicVoiceChannel, findPublicVoiceChannel };
