'use strict';

// Per-streamer time budget for regex banned words. Every chat message is tested
// against a streamer's regex words on the shared event loop, so their cost grows
// with the message rate. When one streamer's regex matching takes more than
// 250 ms within any 10 s, their regex words are matched as plain text (like plain
// words) for an hour.

const LIMIT_MS = 250;
const WINDOW_MS = 10 * 1000;
const COOLDOWN_MS = 60 * 60 * 1000;

// `now` returns milliseconds (monotonic by default); tests pass a fake clock.
function createRegexBudget({
  now = () => performance.now(),
  log = console,
  limitMs = LIMIT_MS,
  windowMs = WINDOW_MS,
  cooldownMs = COOLDOWN_MS,
} = {}) {
  const streamers = new Map(); // streamerId -> { samples: [[at, ms], ...], spent, trippedUntil }

  // The streamer's state, after ending a trip whose hour is over (logged once).
  function current(streamerId, at) {
    const state = streamers.get(streamerId);
    if (state && state.trippedUntil && at >= state.trippedUntil) {
      state.trippedUntil = 0;
      log.log(`[Mod] Regex banned words are back on for streamer ${streamerId}`);
    }
    return state;
  }

  return {
    now,

    // False while the streamer's regex words are being matched as plain text.
    allows(streamerId) {
      const state = current(streamerId, now());
      return !state || !state.trippedUntil;
    },

    // Adds `ms` of regex matching that ended at `at`, and switches the regex
    // words off when the total within the last window exceeds the limit.
    record(streamerId, ms, at = now()) {
      let state = current(streamerId, at);
      if (!state) {
        state = { samples: [], spent: 0, trippedUntil: 0 };
        streamers.set(streamerId, state);
      }
      if (state.trippedUntil) return;
      state.samples.push([at, ms]);
      state.spent += ms;
      while (state.samples[0][0] <= at - windowMs) state.spent -= state.samples.shift()[1];
      if (state.spent > limitMs) {
        log.warn(`[Mod] Regex banned words for streamer ${streamerId} took ${Math.round(state.spent)} ms of matching within ${windowMs / 1000} s; matching them as plain text for ${cooldownMs / 60000} min`);
        state.trippedUntil = at + cooldownMs;
        state.samples = [];
        state.spent = 0;
      }
    },

    // For the periodic sweeper: ends trips whose hour is over and drops the
    // state of streamers with nothing recent left to count.
    sweep() {
      const at = now();
      for (const streamerId of [...streamers.keys()]) {
        const state = current(streamerId, at);
        const last = state.samples[state.samples.length - 1];
        if (!state.trippedUntil && (!last || last[0] <= at - windowMs)) streamers.delete(streamerId);
      }
    },

    get size() {
      return streamers.size;
    },
  };
}

module.exports = { createRegexBudget, LIMIT_MS, WINDOW_MS, COOLDOWN_MS };
