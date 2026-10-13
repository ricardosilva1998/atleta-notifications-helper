const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../db');
const { refreshBroadcasterToken } = require('./twitch');

const HELIX_BASE = 'https://api.twitch.tv/helix';
// A slow Helix answer must not hold a dashboard request or a sync indefinitely.
const HELIX_TIMEOUT_MS = 10_000;

// twitch_sync_status of a reward row, besides 'ok', 'create_failed', 'no_affiliate'
// and 'orphaned':
//   update_failed - an edit is saved here but Twitch has not accepted it yet
//   delete_failed - deleted here, but Twitch has not deleted it yet; the row is kept
//                   (hidden from the list) until it is, and redemptions of it are refunded
const SYNC_UPDATE_FAILED = 'update_failed';
const SYNC_DELETE_FAILED = 'delete_failed';

const REDEMPTIONS_DIR = path.join(__dirname, '..', '..', 'data', 'redemptions');

// Broadcaster-token Helix client with automatic 401 retry.
// On 403 with affiliate-gating message returns { affiliateGated: true } instead of throwing.
async function helixBroadcaster(streamer, method, urlPath, body) {
  const makeReq = async (token) => {
    const opts = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Client-Id': config.twitch.clientId,
      },
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    opts.signal = AbortSignal.timeout(HELIX_TIMEOUT_MS);
    return fetch(`${HELIX_BASE}${urlPath}`, opts);
  };

  let res = await makeReq(streamer.broadcaster_access_token);

  if (res.status === 401) {
    const freshToken = await refreshBroadcasterToken(streamer);
    streamer = db.getStreamerById(streamer.id);
    res = await makeReq(freshToken);
  }

  if (res.status === 403) {
    const errBody = await res.json().catch(() => ({}));
    const msg = (errBody.message || '').toLowerCase();
    if (msg.includes('affiliate') || msg.includes('partner')) {
      return { affiliateGated: true };
    }
    const err = new Error(`Helix 403: ${errBody.message || 'forbidden'}`);
    err.status = 403;
    err.body = errBody;
    throw err;
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const err = new Error(`Helix ${res.status}: ${errBody.message || res.statusText}`);
    err.status = res.status;
    err.body = errBody;
    throw err;
  }

  // DELETE returns 204 with no body
  if (res.status === 204) return null;
  return res.json();
}

async function listManageableRewards(streamer) {
  const data = await helixBroadcaster(
    streamer, 'GET',
    `/channel_points/custom_rewards?broadcaster_id=${streamer.twitch_user_id}&only_manageable_rewards=true`
  );
  if (data && data.affiliateGated) return data;
  return (data && data.data) || [];
}

async function createReward(streamer, body) {
  const data = await helixBroadcaster(
    streamer, 'POST',
    `/channel_points/custom_rewards?broadcaster_id=${streamer.twitch_user_id}`,
    body
  );
  if (data && data.affiliateGated) return data;
  return (data && data.data && data.data[0]) || null;
}

async function updateReward(streamer, twitchRewardId, patch) {
  const data = await helixBroadcaster(
    streamer, 'PATCH',
    `/channel_points/custom_rewards?broadcaster_id=${streamer.twitch_user_id}&id=${twitchRewardId}`,
    patch
  );
  if (data && data.affiliateGated) return data;
  return (data && data.data && data.data[0]) || null;
}

async function deleteReward(streamer, twitchRewardId) {
  return helixBroadcaster(
    streamer, 'DELETE',
    `/channel_points/custom_rewards?broadcaster_id=${streamer.twitch_user_id}&id=${twitchRewardId}`
  );
}

async function fulfillRedemption(streamer, twitchRewardId, redemptionId, status) {
  return helixBroadcaster(
    streamer, 'PATCH',
    `/channel_points/custom_rewards/redemptions?broadcaster_id=${streamer.twitch_user_id}&reward_id=${twitchRewardId}&id=${redemptionId}`,
    { status }
  );
}

// ── Keeping Twitch and the local rows in step ───────────────────────────
//
// A change made here is only reported as done when Twitch took it. Otherwise the
// row records what is still owed to Twitch (twitch_sync_status 'update_failed' or
// 'delete_failed', and the reason in twitch_sync_error), the dashboard shows it
// with a retry, and syncRewards() retries it.

// helixBroadcaster answers { affiliateGated } for a 403 about affiliate/partner
// status instead of throwing. For an update or a delete that is a failure.
function affiliateRequired() {
  const err = new Error('Twitch Affiliate or Partner status is required');
  err.status = 403;
  return err;
}

// What Twitch keeps of a reward, from our row: sent whole when an earlier edit never arrived.
function twitchFieldsOf(row) {
  const fields = {
    title: row.title,
    cost: row.cost,
    prompt: row.prompt || '',
    is_global_cooldown_enabled: row.cooldown_seconds > 0,
    is_paused: !row.enabled, // enabled here is the opposite of paused there
  };
  if (row.cooldown_seconds > 0) fields.global_cooldown_seconds = row.cooldown_seconds;
  return fields;
}

// The Twitch fields behind the columns an edit changed (the other columns, such as
// the media or the position, are not on Twitch).
function twitchPatchOf(changes) {
  const patch = {};
  if (changes.title !== undefined) patch.title = changes.title;
  if (changes.cost !== undefined) patch.cost = changes.cost;
  if (changes.prompt !== undefined) patch.prompt = changes.prompt || '';
  if (changes.cooldown_seconds !== undefined) {
    patch.is_global_cooldown_enabled = changes.cooldown_seconds > 0;
    if (changes.cooldown_seconds > 0) patch.global_cooldown_seconds = changes.cooldown_seconds;
  }
  if (changes.enabled !== undefined) patch.is_paused = !changes.enabled;
  return patch;
}

// Sends an edit that was just saved on the row to Twitch, and records how it went:
// 'ok' when Twitch took it, 'update_failed' (with the reason) when it did not,
// 'orphaned' when the reward is gone from Twitch. While an earlier edit is still
// owed (update_failed), everything Twitch keeps is sent, not only this edit.
// Resolves { ok: true } or { ok: false, error }; it does not throw.
async function pushRewardChanges(streamer, rewardId, changes) {
  const row = db.getRewardById(rewardId, streamer.id);
  if (!row || !row.twitch_reward_id || row.twitch_sync_status === SYNC_DELETE_FAILED) return { ok: true, skipped: true };

  const patch = row.twitch_sync_status === SYNC_UPDATE_FAILED ? twitchFieldsOf(row) : twitchPatchOf(changes || {});
  if (Object.keys(patch).length === 0) return { ok: true, skipped: true };

  try {
    const result = await updateReward(streamer, row.twitch_reward_id, patch);
    if (result && result.affiliateGated) throw affiliateRequired();
    db.setRewardSyncStatus(row.id, 'ok', null);
    return { ok: true };
  } catch (e) {
    if (e.status === 404) {
      db.setRewardSyncStatus(row.id, 'orphaned', 'Reward no longer exists on Twitch');
    } else {
      console.error(`[Rewards] Twitch PATCH failed for reward ${row.id}: ${e.message}`);
      db.setRewardSyncStatus(row.id, SYNC_UPDATE_FAILED, e.message);
    }
    return { ok: false, error: e };
  }
}

// The local row and its media file, gone for good.
function dropLocalReward(row, mediaDir) {
  db.deleteReward(row.id, row.streamer_id);
  if (row.media_filename) {
    try {
      fs.unlinkSync(path.join(mediaDir || path.join(REDEMPTIONS_DIR, String(row.streamer_id)), row.media_filename));
    } catch (e) { /* the file may already be gone */ }
  }
}

// Deletes a reward. Twitch is asked first: when it no longer has the reward (deleted
// now, or it was already gone: 404) the row and its media file go too. If Twitch
// refuses, the row stays as 'delete_failed' (hidden from the list, retried by the
// sync) because a reward that is still live there must stay known here.
// `options.mediaDir` is only for tests. Resolves { removed: true } or
// { removed: false, error }; it does not throw.
async function removeReward(streamer, row, options = {}) {
  if (row.twitch_reward_id) {
    try {
      const result = await deleteReward(streamer, row.twitch_reward_id);
      if (result && result.affiliateGated) throw affiliateRequired();
    } catch (e) {
      if (e.status !== 404) {
        console.error(`[Rewards] Twitch delete failed for reward ${row.id}: ${e.message}`);
        db.setRewardSyncStatus(row.id, SYNC_DELETE_FAILED, e.message);
        return { removed: false, error: e };
      }
    }
  }
  dropLocalReward(row, options.mediaDir);
  return { removed: true };
}

// The retry button on a reward that is waiting for Twitch: a delete is retried,
// an edit is sent again. Resolves { ok, removed?, error? }; it does not throw.
async function retryPending(streamer, row, options = {}) {
  if (row.twitch_sync_status === SYNC_DELETE_FAILED) {
    const result = await removeReward(streamer, row, options);
    return { ok: result.removed, removed: result.removed, error: result.error };
  }
  if (row.twitch_sync_status === SYNC_UPDATE_FAILED) {
    return pushRewardChanges(streamer, row.id, {});
  }
  return { ok: false, nothingToRetry: true };
}

// Gives a viewer's channel points back (the redemption is canceled on Twitch).
// Only a redemption still waiting in the queue can be canceled.
async function refundRedemption(streamer, twitchRewardId, redemptionId) {
  return fulfillRedemption(streamer, twitchRewardId, redemptionId, 'CANCELED');
}

// Why a redemption of this reward must not play: 'deleted' (deleted here, but Twitch
// still has it) or 'disabled' (switched off here). null when it may play.
function unavailableReason(reward) {
  if (reward.twitch_sync_status === SYNC_DELETE_FAILED) return 'deleted';
  if (!reward.enabled) return 'disabled';
  return null;
}

// Full reconciliation: syncs our local rows against the Twitch upstream list.
// Returns { ok, affiliate, count, errors }.
async function syncRewards(streamerId) {
  const streamer = db.getStreamerById(streamerId);
  if (!streamer || !streamer.broadcaster_access_token) {
    return { ok: false, affiliate: null, count: 0, errors: ['No broadcaster token'] };
  }

  const upstreamResult = await listManageableRewards(streamer).catch(e => ({ error: e.message }));
  if (upstreamResult && upstreamResult.affiliateGated) {
    db.updateStreamerCpSync(streamerId, { affiliate_status: 'not_affiliate', last_sync_at: new Date().toISOString() });
    return { ok: false, affiliate: 'not_affiliate', count: 0, errors: ['Not an affiliate or partner'] };
  }
  if (upstreamResult && upstreamResult.error) {
    return { ok: false, affiliate: null, count: 0, errors: [upstreamResult.error] };
  }

  const upstream = upstreamResult || [];
  const upstreamById = new Map(upstream.map(r => [r.id, r]));

  const localRows = db.getRewards(streamerId);
  const errors = [];
  let count = 0;

  for (const local of localRows) {
    if (!local.twitch_reward_id) {
      // No Twitch ID yet — try to create it
      try {
        const created = await createReward(streamer, {
          title: local.title,
          cost: local.cost,
          prompt: local.prompt || undefined,
          is_global_cooldown_enabled: local.cooldown_seconds > 0,
          global_cooldown_seconds: local.cooldown_seconds > 0 ? local.cooldown_seconds : undefined,
          is_paused: !local.enabled,
        });
        if (created && created.affiliateGated) {
          db.setRewardSyncStatus(local.id, 'no_affiliate', null);
          db.updateStreamerCpSync(streamerId, { affiliate_status: 'not_affiliate' });
        } else if (created && created.id) {
          db.setRewardTwitchId(local.id, created.id, 'ok');
          count++;
        }
      } catch (e) {
        db.setRewardSyncStatus(local.id, 'create_failed', e.message);
        errors.push(`Create failed for reward ${local.id}: ${e.message}`);
      }
    } else if (local.twitch_sync_status === SYNC_DELETE_FAILED) {
      // Deleted here, but Twitch kept it: delete it again. A reward Twitch no longer
      // lists has been deleted there in the meantime.
      if (upstreamById.has(local.twitch_reward_id)) {
        const result = await removeReward(streamer, local);
        if (!result.removed) errors.push(`Delete failed again for reward ${local.id}: ${result.error.message}`);
      } else {
        dropLocalReward(local);
      }
    } else if (upstreamById.has(local.twitch_reward_id)) {
      if (local.twitch_sync_status === SYNC_UPDATE_FAILED) {
        // An edit made here never reached Twitch: send it now rather than let
        // Twitch's older values overwrite it.
        const result = await pushRewardChanges(streamer, local.id, {});
        if (result.ok) count++;
        else errors.push(`Update failed again for reward ${local.id}: ${result.error.message}`);
      } else {
        // Upstream exists — Twitch is source of truth for title, cost, prompt,
        // paused/enabled and the cooldown
        const up = upstreamById.get(local.twitch_reward_id);
        db.updateReward(local.id, streamerId, {
          title: up.title,
          cost: up.cost,
          prompt: up.prompt || null,
          enabled: up.is_paused ? 0 : 1,
          cooldown_seconds: up.is_global_cooldown_enabled ? (up.global_cooldown_seconds || 0) : 0,
          twitch_sync_status: 'ok',
          twitch_sync_error: null,
        });
        count++;
      }
    } else {
      // Was on Twitch before, no longer there
      db.setRewardSyncStatus(local.id, 'orphaned', 'Reward no longer exists on Twitch');
    }
  }

  db.updateStreamerCpSync(streamerId, {
    affiliate_status: 'ok',
    last_sync_at: new Date().toISOString(),
  });

  return { ok: true, affiliate: 'ok', count, errors };
}

module.exports = {
  SYNC_UPDATE_FAILED,
  SYNC_DELETE_FAILED,
  helixBroadcaster,
  listManageableRewards,
  createReward,
  updateReward,
  deleteReward,
  fulfillRedemption,
  twitchFieldsOf,
  twitchPatchOf,
  pushRewardChanges,
  removeReward,
  retryPending,
  refundRedemption,
  unavailableReason,
  syncRewards,
};
