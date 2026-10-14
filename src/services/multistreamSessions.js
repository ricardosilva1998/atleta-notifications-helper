'use strict';

// A streamer's multistream session on the relay (MediaMTX, see
// docs/multistream-relay-setup.md), by stream key:
//
//   goLive(key)       the stream reached the relay (the on-ready webhook, or the
//                     check below): forward it to Twitch and YouTube. Only what
//                     is missing is added, and a YouTube broadcast that is still
//                     ready or live is reused, so a webhook sent twice or an OBS
//                     reconnect never makes a second broadcast (each costs about
//                     100 units of the shared YouTube quota, and leaves a VOD).
//   streamEnded(key)  the stream left the relay (the on-not-ready webhook): a
//                     minute later, unless it is back by then, its forwarders are
//                     removed and its YouTube broadcast is completed.
//   check()           every minute while the relay is configured: a stream on
//                     the relay that is missing a forwarder gets it (a webhook
//                     can be lost); one that may no longer be forwarded (the
//                     account was disabled or switched multistream off) loses its
//                     forwarders; forwarders left behind by a stream that is gone
//                     are stopped as for a stream that ended.
//
// What happens to one stream key never overlaps: each operation starts after
// the previous one for that key has finished (withLock).

const TWITCH_INGEST = 'rtmp://live.twitch.tv/app';
const YOUTUBE_INGEST = 'rtmp://a.rtmp.youtube.com/live2';
const STOP_GRACE_MS = 60_000;
const CHECK_INTERVAL_MS = 60_000;
// A stream the check could not fully forward is tried again 2, 4, 8 and 16
// minutes later, then left alone until it reconnects (each try asks Twitch and
// YouTube, and can spend YouTube quota).
const RETRY_FIRST_MS = 2 * 60_000;
const RETRY_ATTEMPTS = 5;
// A broadcast in one of these states can carry the stream again.
const REUSABLE_BROADCAST = new Set(['ready', 'testStarting', 'testing', 'liveStarting', 'live']);

function createMultistreamSessions(deps) {
  const {
    db, twitch, youtube, relay, settings,
    isStreamerDisabled,
    log = console,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    setRepeat = setInterval,
    clearRepeat = clearInterval,
  } = deps;

  const locks = new Map(); // stream key -> the last operation queued for it (removed once idle)
  const pendingStops = new Map(); // stream key -> { timer, streamerId } (removed when it runs or is cancelled)
  const retries = new Map(); // stream key -> { attempts, at } (removed once the stream leaves the relay)
  let repeat = null;
  let checking = null;

  function relaySettings() {
    const { apiUrl, apiUser, apiToken, accessClientId, accessClientSecret } = settings();
    return { apiUrl, apiUser, apiToken, accessClientId, accessClientSecret };
  }

  function withLock(key, operation) {
    const previous = locks.get(key) || Promise.resolve();
    const run = previous.then(operation);
    const settled = run.catch(() => {});
    locks.set(key, settled);
    settled.then(() => { if (locks.get(key) === settled) locks.delete(key); });
    return run;
  }

  // The destinations a stream of this streamer should reach: what goLive can
  // set up with the accounts they have connected.
  function expectedDestinations(streamer) {
    const names = [];
    if (streamer.twitch_user_id && streamer.broadcaster_access_token && twitch.hasStreamKeyScope(streamer)) names.push('twitch');
    if (streamer.yt_access_token) names.push('youtube');
    return names;
  }

  async function broadcastTitle(streamer) {
    if (streamer.multistream_youtube_default_title) return streamer.multistream_youtube_default_title;
    // "Leave empty to use your current Twitch title": the channel's title,
    // there before the stream is live on Twitch (it is not yet, at this point).
    if (streamer.twitch_user_id) {
      try {
        const title = await twitch.getChannelTitle(streamer.twitch_user_id);
        if (title) return title;
      } catch (err) {
        log.warn(`[multistream] Twitch title of streamer ${streamer.id} unavailable: ${err.message}`);
      }
    }
    return `Live — ${new Date(now()).toLocaleDateString()}`;
  }

  // The broadcast this stream goes to: the current one if YouTube still has it
  // ready or live (bound to this same stream), otherwise a new one. A failed
  // status lookup is an error, never a reason to make another broadcast.
  async function broadcastFor(streamer, streamId, sameStream) {
    const current = streamer.multistream_active_broadcast_id;
    if (current && sameStream) {
      const state = await youtube.getBroadcastStatus(streamer, current);
      if (REUSABLE_BROADCAST.has(state)) return current;
      if (state === 'created') {
        // Made, but its bind failed: bind it now.
        await youtube.bindBroadcastToStream(streamer, current, streamId);
        return current;
      }
    }
    const id = await youtube.createBroadcast(streamer, {
      title: await broadcastTitle(streamer),
      description: '',
      privacyStatus: streamer.multistream_youtube_privacy || 'public',
      categoryId: streamer.multistream_youtube_category_id || '20',
    });
    // Recorded before the bind, so a failed bind is finished next time instead
    // of making yet another broadcast.
    db.setMultistreamActiveBroadcast(streamer.id, id);
    await youtube.bindBroadcastToStream(streamer, id, streamId);
    return id;
  }

  async function startForwarding(key) {
    const streamer = db.getStreamerByMultistreamToken(key); // enabled accounts only
    if (!streamer) return { status: 'unknown' };
    if (!streamer.multistream_enabled) return { status: 'off' };

    const relayAccess = relaySettings();
    const existing = (await relay.listForwarders(relayAccess)).get(key) || new Set();
    const toAdd = [];
    const failed = [];

    if (!existing.has('twitch')) {
      try {
        toAdd.push({ name: 'twitch', url: `${TWITCH_INGEST}/${await twitch.getStreamKey(streamer)}` });
      } catch (err) {
        failed.push(`twitch: ${err.message}`);
      }
    }

    if (streamer.yt_access_token) {
      try {
        const { streamId, streamKey } = await youtube.getOrCreateLiveStream(streamer);
        const sameStream = streamId === streamer.multistream_youtube_stream_id;
        if (!sameStream) {
          db.setMultistreamYoutubeStream(streamer.id, streamId);
          // A forwarder to the previous stream's key would feed a stream that is gone.
          if (existing.has('youtube')) {
            await relay.removeForwardPaths({ ...relayAccess, sourceToken: key, destinationNames: ['youtube'] });
            existing.delete('youtube');
          }
        }
        await broadcastFor(streamer, streamId, sameStream);
        if (!existing.has('youtube')) toAdd.push({ name: 'youtube', url: `${YOUTUBE_INGEST}/${streamKey}` });
      } catch (err) {
        failed.push(`youtube: ${err.message}`);
      }
    }

    // One destination at a time, so a refusal for one keeps the other.
    const added = [];
    let relayFailed = false;
    for (const destination of toAdd) {
      try {
        added.push(...await relay.addForwardPaths({ ...relayAccess, sourceToken: key, destinations: [destination] }));
      } catch (err) {
        relayFailed = true;
        failed.push(`relay: ${err.message}`);
      }
    }

    const forwarding = [...existing, ...added];
    if (added.length) db.markMultistreamStarted(streamer.id);
    // Reaching only some platforms is what the streamer must be told: the
    // dashboard shows it until a go-live reaches them all.
    db.setMultistreamLastError(streamer.id, failed.length ? failed.join('; ') : null);
    if (failed.length) {
      log.warn(`[multistream] streamer ${streamer.id}: ${forwarding.length ? `forwarding to ${forwarding.join(', ')} only` : 'not forwarded'}: ${failed.join('; ')}`);
    } else if (added.length) {
      log.log(`[multistream] streamer ${streamer.id}: forwarding to ${forwarding.join(', ')}`);
    }
    return { status: 'ok', streamerId: streamer.id, forwarding, added, failed, relayFailed, expected: expectedDestinations(streamer) };
  }

  function cancelStop(key) {
    const pending = pendingStops.get(key);
    if (!pending) return false;
    clearTimer(pending.timer);
    pendingStops.delete(key);
    return true;
  }

  // Removes the key's forwarders; then completes the streamer's YouTube
  // broadcast, unless the account is disabled (YouTube ends it by itself).
  async function stopForwarding(key, streamerId) {
    try {
      await relay.removeForwardPaths({ ...relaySettings(), sourceToken: key, destinationNames: ['twitch', 'youtube'] });
    } catch (err) {
      log.error(`[multistream] removing the forwarders failed${streamerId ? ` for streamer ${streamerId}` : ''}: ${err.message}`);
    }
    const streamer = streamerId ? db.getStreamerById(streamerId) : null;
    if (!streamer || isStreamerDisabled(streamer) || !streamer.multistream_active_broadcast_id) return;
    const broadcastId = streamer.multistream_active_broadcast_id;
    try {
      await youtube.transitionBroadcast(streamer, broadcastId, 'complete');
      log.log(`[multistream] YouTube broadcast ${broadcastId} completed for streamer ${streamer.id}`);
    } catch (err) {
      // Usually YouTube ended it already (enableAutoStop).
      log.warn(`[multistream] completing YouTube broadcast ${broadcastId} of streamer ${streamer.id}: ${err.message}`);
    } finally {
      db.setMultistreamActiveBroadcast(streamer.id, null);
    }
  }

  function goLive(key) {
    cancelStop(key); // the stream is back (or still there): keep its broadcast
    return withLock(key, () => startForwarding(key));
  }

  function streamEnded(key) {
    if (pendingStops.has(key)) return;
    const streamer = db.getStreamerByMultistreamToken(key);
    const pending = { streamerId: streamer ? streamer.id : null, timer: null };
    pending.timer = setTimer(() => {
      withLock(key, async () => {
        // A go-live since then cancelled it: leave the session be.
        if (pendingStops.get(key) !== pending) return;
        pendingStops.delete(key);
        await stopForwarding(key, pending.streamerId);
      }).catch((err) => log.error(`[multistream] stop failed: ${err.message}`));
    }, STOP_GRACE_MS);
    if (pending.timer && pending.timer.unref) pending.timer.unref();
    pendingStops.set(key, pending);
  }

  async function check() {
    if (!settings().enabled) return;
    let live;
    let forwarders;
    try {
      [live, forwarders] = await Promise.all([relay.listLiveStreams(relaySettings()), relay.listForwarders(relaySettings())]);
    } catch (err) {
      log.warn(`[multistream] relay check failed: ${err.message}`);
      return;
    }

    for (const key of live) {
      const have = forwarders.get(key) || new Set();
      const streamer = db.getStreamerByMultistreamToken(key);
      if (!streamer || !streamer.multistream_enabled) {
        // Started before the account was disabled or multistream switched off.
        if (have.size) {
          log.log(`[multistream] a stream ${streamer ? `of streamer ${streamer.id} ` : ''}may no longer be forwarded: stopping it`);
          cancelStop(key);
          await withLock(key, () => stopForwarding(key, streamer ? streamer.id : null))
            .catch((err) => log.error(`[multistream] stop failed: ${err.message}`));
        }
        continue;
      }
      const missing = expectedDestinations(streamer).filter((name) => !have.has(name));
      if (missing.length === 0 && !pendingStops.has(key)) {
        retries.delete(key);
        continue;
      }
      const retry = retries.get(key);
      if (retry && (retry.attempts >= RETRY_ATTEMPTS || retry.at > now())) continue;
      log.log(`[multistream] streamer ${streamer.id} is on the relay${missing.length ? ` without ${missing.join(', ')}` : ''}: setting it up again`);
      const result = await goLive(key).catch((err) => ({ status: 'error', error: err }));
      const stillMissing = result.status === 'ok' ? result.expected.filter((name) => !result.forwarding.includes(name)) : missing;
      if (stillMissing.length === 0) {
        retries.delete(key);
      } else {
        const attempts = (retry ? retry.attempts : 0) + 1;
        retries.set(key, { attempts, at: now() + RETRY_FIRST_MS * 2 ** (attempts - 1) });
      }
    }

    // A stream that left the relay starts over on its next go-live.
    for (const key of retries.keys()) if (!live.has(key)) retries.delete(key);
    // Forwarders whose stream is gone (a lost on-not-ready, or a restart during
    // the minute's wait) are stopped like a stream that ended.
    for (const key of forwarders.keys()) if (!live.has(key)) streamEnded(key);
  }

  // The check runs now and then every minute (never two at once).
  function startChecks() {
    if (repeat) return;
    const run = () => {
      if (checking) return;
      checking = check()
        .catch((err) => log.error(`[multistream] check failed: ${err.message}`))
        .finally(() => { checking = null; });
    };
    run();
    repeat = setRepeat(run, CHECK_INTERVAL_MS);
    if (repeat && repeat.unref) repeat.unref();
  }

  // On shutdown. A stop that was waiting is not lost: the next boot completes
  // the broadcast (youtubeBroadcast.reconcileActiveBroadcasts) and its check
  // removes the forwarders.
  function stopAll() {
    if (repeat) clearRepeat(repeat);
    repeat = null;
    for (const key of [...pendingStops.keys()]) cancelStop(key);
  }

  return {
    goLive,
    streamEnded,
    check,
    startChecks,
    stopAll,
    // For tests.
    pendingStopCount: () => pendingStops.size,
    lockCount: () => locks.size,
  };
}

let shared = null;

// The app's one set of sessions, on the real services (made on first use).
function sessions() {
  if (!shared) {
    const config = require('../config');
    shared = createMultistreamSessions({
      db: require('../db'),
      twitch: require('./twitch'),
      youtube: require('./youtubeBroadcast'),
      relay: require('./multistreamRelay'),
      settings: () => config.multistream,
      isStreamerDisabled: require('./streamerAccess').isStreamerDisabled,
    });
  }
  return shared;
}

module.exports = {
  STOP_GRACE_MS,
  CHECK_INTERVAL_MS,
  RETRY_ATTEMPTS,
  createMultistreamSessions,
  sessions,
};
