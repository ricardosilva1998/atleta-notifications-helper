'use strict';

/**
 * How long a tip's alert stays on screen when its message is read aloud: the voice
 * starts VOICE_START_MS after the alert (its own sound gets that second), and the
 * alert lingers VOICE_TAIL_MS after the last word. Never past ALERT_MAX_MS, so a long
 * reading cannot hold the queue; a streamer's own duration is never shortened.
 * Used by public/overlay/overlay.js (the OBS overlay).
 *
 * Dual-exported: a browser global for <script src>, CommonJS for node:test.
 * Do not add a build step; this file is served verbatim by express.static.
 */

(function () {
  var VOICE_START_MS = 1000;
  var VOICE_TAIL_MS = 300;
  var ALERT_MAX_MS = 30000;

  // The alert's hold in ms: `baseHoldMs`, or longer when the voice (`voiceSeconds` long)
  // needs it. A length that is not a finite number leaves the hold as it was.
  function voiceHoldMs(baseHoldMs, voiceSeconds) {
    if (typeof voiceSeconds !== 'number' || !isFinite(voiceSeconds)) return baseHoldMs;
    return Math.min(ALERT_MAX_MS, Math.max(baseHoldMs, VOICE_START_MS + voiceSeconds * 1000 + VOICE_TAIL_MS));
  }

  var TIP_VOICE = { VOICE_START_MS: VOICE_START_MS, VOICE_TAIL_MS: VOICE_TAIL_MS, ALERT_MAX_MS: ALERT_MAX_MS, voiceHoldMs: voiceHoldMs };

  if (typeof module !== 'undefined' && module.exports) module.exports = TIP_VOICE;
  if (typeof window !== 'undefined') window.ATLETA_TIP_VOICE = TIP_VOICE;
})();
