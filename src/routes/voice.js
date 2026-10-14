'use strict';

// GET /api/voice/:discordUserId: public, used by the Atleta Racing app's Discord
// voice overlay, which asks every 2 s with only a Discord user id (server.js
// mounts it behind its own rate limit). Only a voice channel everyone in its
// server can see is reported; a private one answers like no channel
// (services/voicePresence.js).

const { Router } = require('express');
const { isSnowflake, findPublicVoiceChannel } = require('../services/voicePresence');

const router = Router();

router.get('/:discordUserId', async (req, res) => {
  try {
    const { discordUserId } = req.params;
    if (!isSnowflake(discordUserId)) return res.status(400).json({ error: 'Invalid Discord user id' });
    const { client } = require('../discord');
    const { ensureConnected, isSpeaking, scheduleDisconnect } = require('../services/voiceTracker');

    const channel = findPublicVoiceChannel(client.guilds.cache.values(), discordUserId);
    if (!channel) {
      return res.json({ channelName: null, members: [] });
    }

    // Join voice channel for speaking detection (non-blocking)
    ensureConnected(channel).catch(e => console.log('[VoiceTracker] ensureConnected error:', e.message));
    scheduleDisconnect(); // Auto-leave after 5 min of no polls

    // Filter out bots (like the Atleta bot itself)
    const humanMembers = channel.members.filter(m => !m.user.bot);

    const members = humanMembers.map(member => {
      // Re-fetch voice state from cache for latest mute/deaf status
      const freshVs = member.guild.voiceStates.cache.get(member.id);
      const vs = freshVs || member.voice;
      const user = member.user;
      const avatar = user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=64`
        : `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id) >> 22n) % 6n}.png`;
      return {
        id: user.id, username: user.username,
        displayName: member.displayName || user.displayName || user.username,
        avatar, selfMute: vs.selfMute || false, selfDeaf: vs.selfDeaf || false,
        serverMute: vs.serverMute || false, serverDeaf: vs.serverDeaf || false,
        streaming: vs.streaming || false, camera: vs.selfVideo || false,
        speaking: isSpeaking(user.id),
        isStreamer: user.id === discordUserId,
      };
    });
    res.json({ channelName: channel.name, members });
  } catch(e) {
    console.error('[Voice API]', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
