'use strict';

// One cooldown per streamer, shared by every dashboard button that makes the
// shared bots speak or spends shared API quota (the "test in chat" buttons, the
// sponsor message test, the YouTube tests). Without it a single streamer could
// push the shared bot past Twitch's send limits for every channel.

const TEST_COOLDOWN_MS = 5000;
const SWEEP_INTERVAL_MS = 60 * 1000;

// `now` returns milliseconds (monotonic by default); tests pass a fake clock.
function createTestCooldown({ now = () => performance.now(), cooldownMs = TEST_COOLDOWN_MS } = {}) {
  const lastTest = new Map(); // streamerId -> when the last test was let through

  return {
    // 0 when the test may go ahead (and the cooldown starts now), else the
    // milliseconds the streamer still has to wait.
    take(streamerId) {
      const at = now();
      const last = lastTest.get(streamerId);
      if (last !== undefined && at - last < cooldownMs) return cooldownMs - (at - last);
      lastTest.set(streamerId, at);
      return 0;
    },

    // For the periodic sweeper: forgets streamers whose cooldown is over.
    sweep() {
      const at = now();
      for (const [streamerId, last] of lastTest) {
        if (at - last >= cooldownMs) lastTest.delete(streamerId);
      }
    },

    get size() {
      return lastTest.size;
    },
  };
}

const testCooldown = createTestCooldown();
setInterval(() => testCooldown.sweep(), SWEEP_INTERVAL_MS).unref();

module.exports = { createTestCooldown, testCooldown, TEST_COOLDOWN_MS };
