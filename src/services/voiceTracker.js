'use strict';

// Speaking detection disabled — Railway's Docker containers don't support
// UDP connections needed for Discord voice. The overlay still shows members,
// avatars, mute/unmute, streaming, and camera status.
//
// To enable speaking detection in the future, the voice tracker would need
// to run on a server with UDP support (VPS, dedicated server, etc.)

function ensureConnected() { return Promise.resolve(null); }
function isSpeaking() { return false; }
function scheduleDisconnect() {}

module.exports = { ensureConnected, isSpeaking, scheduleDisconnect };
