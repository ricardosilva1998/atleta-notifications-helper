const config = require('../config');
const db = require('../db');
const { refreshBroadcasterToken } = require('./twitch');

const HELIX_BASE = 'https://api.twitch.tv/helix';

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
    } else if (upstreamById.has(local.twitch_reward_id)) {
      // Upstream exists — Twitch is source of truth for title/cost/prompt
      const up = upstreamById.get(local.twitch_reward_id);
      db.updateReward(local.id, streamerId, {
        title: up.title,
        cost: up.cost,
        prompt: up.prompt || null,
        twitch_sync_status: 'ok',
        twitch_sync_error: null,
      });
      count++;
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
  helixBroadcaster,
  listManageableRewards,
  createReward,
  updateReward,
  deleteReward,
  fulfillRedemption,
  syncRewards,
};
