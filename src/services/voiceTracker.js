'use strict';

const { joinVoiceChannel, VoiceConnectionStatus, entersState } = require('@discordjs/voice');

// Track speaking state per user
const speakingUsers = new Map(); // odId -> { speaking: bool, lastSeen: Date }
let currentConnection = null;
let currentChannelId = null;
let disconnectTimer = null;

/**
 * Join a voice channel and listen for speaking events.
 * Returns the connection or null on failure.
 */
async function ensureConnected(channel) {
  // Already in this channel
  if (currentConnection && currentChannelId === channel.id) {
    clearDisconnectTimer();
    return currentConnection;
  }

  // Disconnect from previous channel
  if (currentConnection) {
    try { currentConnection.destroy(); } catch(e) {}
    currentConnection = null;
    currentChannelId = null;
    speakingUsers.clear();
  }

  try {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,  // Don't receive audio (saves bandwidth)
      selfMute: true,   // Don't send audio
    });

    // Wait for connection
    await entersState(connection, VoiceConnectionStatus.Ready, 10000);

    // Listen for speaking events
    connection.receiver.speaking.on('start', (userId) => {
      speakingUsers.set(userId, { speaking: true, lastSeen: new Date() });
    });

    connection.receiver.speaking.on('end', (userId) => {
      const entry = speakingUsers.get(userId);
      if (entry) entry.speaking = false;
    });

    connection.on(VoiceConnectionStatus.Disconnected, () => {
      currentConnection = null;
      currentChannelId = null;
      speakingUsers.clear();
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      currentConnection = null;
      currentChannelId = null;
      speakingUsers.clear();
    });

    currentConnection = connection;
    currentChannelId = channel.id;
    console.log('[VoiceTracker] Joined channel: ' + channel.name);
    return connection;
  } catch(e) {
    console.log('[VoiceTracker] Failed to join: ' + e.message);
    return null;
  }
}

/**
 * Check if a user is currently speaking.
 */
function isSpeaking(userId) {
  const entry = speakingUsers.get(userId);
  return entry ? entry.speaking : false;
}

/**
 * Schedule auto-disconnect after 5 minutes of no polls.
 */
function scheduleDisconnect() {
  clearDisconnectTimer();
  disconnectTimer = setTimeout(() => {
    if (currentConnection) {
      console.log('[VoiceTracker] Auto-disconnecting (no polls for 5 minutes)');
      try { currentConnection.destroy(); } catch(e) {}
      currentConnection = null;
      currentChannelId = null;
      speakingUsers.clear();
    }
  }, 5 * 60 * 1000);
}

function clearDisconnectTimer() {
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
}

module.exports = { ensureConnected, isSpeaking, scheduleDisconnect };
