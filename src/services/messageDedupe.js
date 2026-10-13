'use strict';

// Remembers message ids for a while, so a message delivered more than once is
// acted on once. Twitch EventSub can send the same notification again with the
// same message_id, for example while a connection is being moved to another
// server.

// `now` returns milliseconds (monotonic by default); tests pass a fake clock.
function createMessageDedupe({ ttlMs, now = () => performance.now() }) {
  const firstSeen = new Map(); // message id -> when it was first seen

  return {
    // True when this id was already seen in the last ttlMs: a repeat, to be
    // ignored. Otherwise the id is remembered from now on and the answer is
    // false. A message without an id cannot be recognised, so it is never a repeat.
    isRepeat(id) {
      if (id === undefined || id === null || id === '') return false;
      const at = now();
      const seen = firstSeen.get(id);
      if (seen !== undefined && at - seen < ttlMs) return true;
      firstSeen.set(id, at);
      return false;
    },

    // For the periodic sweeper: forgets ids seen more than ttlMs ago.
    sweep() {
      const at = now();
      for (const [id, seen] of firstSeen) {
        if (at - seen >= ttlMs) firstSeen.delete(id);
      }
    },

    get size() {
      return firstSeen.size;
    },
  };
}

module.exports = { createMessageDedupe };
