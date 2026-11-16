const path = require('path');
const fs = require('fs');
const db = require('../db');
const bus = require('./overlayBus');
const { chatManager } = require('./twitchChat');
const { formatChatTemplate } = require('./redemptionTemplates');
const { unavailableReason, refundRedemption, fulfillRedemption } = require('./twitchRewards');

// A redemption of a reward that must not play (switched off here, deleted here
// while Twitch still has it, or Channel Point Rewards switched off): the viewer's
// channel points go back to them (the redemption is canceled on Twitch) and the
// outcome goes on the redemption's history row (logId). `reason` says why:
// 'disabled' (this reward is off), 'deleted' (deleted here, still live on Twitch)
// or 'switch_off' (the "Enable Channel Point Rewards" switch is off).
//   refunded_disabled / refunded_deleted / refunded_switch_off - canceled
//   disabled - nothing to cancel: only a redemption still waiting in the queue
//              (status unfulfilled) can be, and this one was not
//   error - Twitch did not cancel it (the reason is in error_message)
// The switch gets its own outcome so the history does not blame a reward that is on.
const REFUND_OUTCOME = { deleted: 'refunded_deleted', switch_off: 'refunded_switch_off' };

async function refundUnavailableReward(streamerId, logId, eventData, reason) {
  const { twitchRedemptionId, twitchRewardId, status } = eventData;
  let outcome = 'disabled';
  let errorMessage = null;

  if (String(status).toLowerCase() === 'unfulfilled') {
    try {
      await refundRedemption(db.getStreamerById(streamerId), twitchRewardId, twitchRedemptionId);
      outcome = REFUND_OUTCOME[reason] || 'refunded_disabled';
    } catch (e) {
      console.error(`[Redemption] could not refund ${twitchRedemptionId}: ${e.message}`);
      outcome = 'error';
      errorMessage = `refund failed: ${e.message}`;
    }
  }

  db.setRedemptionOutcome(logId, outcome, errorMessage);
}

async function handleRedemption(streamerId, eventData) {
  const {
    twitchRedemptionId,
    twitchRewardId,
    rewardTitle,
    rewardCost,
    username,
    userId,
    userInput,
    status,
    redeemedAt,
  } = eventData;

  // Step 1: look up reward in our DB. A reward this app does not manage (made on
  // Twitch itself or by another app) is not ours to play or refund: it is left
  // alone, with no history row and no sync.
  const reward = db.getRewardByTwitchId(streamerId, twitchRewardId);
  if (!reward) return;

  // Step 2: record the redemption before anything is done for it. Twitch can
  // deliver the same redemption more than once; only the first is acted on.
  const logId = db.claimRedemption({
    streamer_id: streamerId,
    reward_id: reward.id,
    twitch_redemption_id: twitchRedemptionId,
    twitch_reward_id: twitchRewardId,
    user_id: userId,
    user_login: username,
    user_input: userInput || null,
    cost: rewardCost,
    status,
    redeemed_at: redeemedAt,
  });
  if (!logId) return;

  // Step 3: a reward that is switched off here, or deleted here but still live on
  // Twitch (the delete was refused), or any reward while "Enable Channel Point
  // Rewards" is off, must not play: the viewer is refunded instead.
  const streamer = db.getStreamerById(streamerId);
  const unavailable = unavailableReason(reward) || (streamer && streamer.cp_rewards_enabled ? null : 'switch_off');
  if (unavailable) {
    await refundUnavailableReward(streamerId, logId, eventData, unavailable);
    return;
  }

  // Step 4: verify file exists. Only a redemption still waiting in the queue can be
  // canceled: the refund is asked for first and recorded only when Twitch took it.
  const mediaPath = path.join(__dirname, '..', '..', 'data', 'redemptions', String(streamerId), reward.media_filename);
  if (!fs.existsSync(mediaPath)) {
    if (String(status).toLowerCase() !== 'unfulfilled') {
      db.setRedemptionOutcome(logId, 'disabled', 'media file missing');
      return;
    }
    try {
      await fulfillRedemption(streamer, twitchRewardId, twitchRedemptionId, 'CANCELED');
    } catch (e) {
      console.error('[Redemption] refund failed:', e.message);
      db.setRedemptionOutcome(logId, 'error', `refund failed: ${e.message}`);
      return;
    }
    db.setRedemptionOutcome(logId, 'refunded_no_file', 'media file missing');
    if (streamer && streamer.twitch_username && streamer.chatbot_enabled) {
      try {
        chatManager.sendMessage(
          streamerId,
          `[Atleta] Reward "${reward.title}" had a missing media file — redemption refunded.`
        );
      } catch (e) {
        console.error('[Redemption] chat failed:', e.message);
      }
    }
    return;
  }

  // Step 5: emit to overlay
  const overlayEvent = {
    type: 'redemption',
    data: {
      rewardId: reward.id,
      mediaUrl: `/redemptions/${streamerId}/${reward.media_filename}`,
      mediaType: reward.media_type,
      position: {
        preset: reward.position_preset,
        x: reward.custom_x,
        y: reward.custom_y,
        w: reward.custom_w,
        h: reward.custom_h,
      },
      volume: reward.volume,
      maxPlaySeconds: reward.max_play_seconds,
      title: reward.title,
      username,
      userInput: userInput || null,
      twitchRedemptionId,
    },
  };
  bus.emit(`overlay:${streamerId}`, overlayEvent);

  // Step 6: optional chat message
  if (reward.chat_message_template) {
    if (streamer && streamer.chatbot_enabled && streamer.twitch_username) {
      const msg = formatChatTemplate(reward.chat_message_template, {
        user: username,
        title: reward.title,
        cost: rewardCost,
      });
      if (msg) chatManager.sendMessage(streamerId, msg);
    }
  }

  // Step 7: auto-fulfill after the playback window. The due time is stored, so a
  // restart settles it at boot; the timer only makes it prompt.
  if (reward.auto_fulfill) {
    const delay = (reward.max_play_seconds * 1000) + 1000;
    const dueMs = Date.now() + delay;
    db.setRedemptionAutoFulfillDue(logId, new Date(dueMs).toISOString());
    const timer = setTimeout(() => { settleDueAutoFulfills(dueMs).catch(() => {}); }, delay);
    timer.unref();
  }

  // Step 8: the outcome
  db.setRedemptionOutcome(logId, 'played', null);
}

// Redemptions that played and are due to be marked fulfilled on Twitch: at boot and on a minute tick.
// One that Twitch still refuses an hour after it was due is given up on (it was probably handled by hand).
const GIVE_UP_MS = 60 * 60 * 1000;
const settling = new Set();
let tickTimer = null;

async function settleDueAutoFulfills(nowMs) {
  const now = nowMs || Date.now();
  const due = db.getDueRedemptionAutoFulfills(new Date(now).toISOString(), 100);
  for (const row of due) {
    if (settling.has(row.id)) continue;
    settling.add(row.id);
    try {
      const latest = db.getStreamerById(row.streamer_id); // its token may have been refreshed since
      if (latest) {
        await fulfillRedemption(latest, row.twitch_reward_id, row.twitch_redemption_id, 'FULFILLED');
      }
      db.clearRedemptionAutoFulfillDue(row.id);
    } catch (e) {
      console.error('[Redemption] auto-fulfill error:', e.message);
      if (now - Date.parse(row.auto_fulfill_due_at) > GIVE_UP_MS) db.clearRedemptionAutoFulfillDue(row.id);
    } finally {
      settling.delete(row.id);
    }
  }
}

function startTicks() {
  if (tickTimer) return;
  settleDueAutoFulfills().catch((e) => console.error('[Redemption] boot settle failed:', e.message));
  tickTimer = setInterval(() => {
    settleDueAutoFulfills().catch((e) => console.error('[Redemption] tick failed:', e.message));
  }, 60 * 1000);
  tickTimer.unref();
}

function stopTicks() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

module.exports = { handleRedemption, formatChatTemplate, settleDueAutoFulfills, startTicks, stopTicks };
