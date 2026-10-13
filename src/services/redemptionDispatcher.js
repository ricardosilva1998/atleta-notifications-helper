const path = require('path');
const fs = require('fs');
const db = require('../db');
const bus = require('./overlayBus');
const { chatManager } = require('./twitchChat');
const { formatChatTemplate } = require('./redemptionTemplates');
const { unavailableReason, refundRedemption } = require('./twitchRewards');

// A redemption of a reward that must not play (switched off here, deleted here
// while Twitch still has it, or Channel Point Rewards switched off): the viewer's
// channel points go back to them (the redemption is canceled on Twitch) and the
// outcome goes on the redemption's history row (logId).
//   refunded_disabled / refunded_deleted - canceled
//   disabled - nothing to cancel: only a redemption still waiting in the queue
//              (status unfulfilled) can be, and this one was not
//   error - Twitch did not cancel it (the reason is in error_message)
async function refundUnavailableReward(streamerId, logId, eventData, reason) {
  const { twitchRedemptionId, twitchRewardId, status } = eventData;
  let outcome = 'disabled';
  let errorMessage = null;

  if (String(status).toLowerCase() === 'unfulfilled') {
    try {
      await refundRedemption(db.getStreamerById(streamerId), twitchRewardId, twitchRedemptionId);
      outcome = reason === 'deleted' ? 'refunded_deleted' : 'refunded_disabled';
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
  const unavailable = unavailableReason(reward) || (streamer && streamer.cp_rewards_enabled ? null : 'disabled');
  if (unavailable) {
    await refundUnavailableReward(streamerId, logId, eventData, unavailable);
    return;
  }

  // Step 4: verify file exists
  const mediaPath = path.join(__dirname, '..', '..', 'data', 'redemptions', String(streamerId), reward.media_filename);
  if (!fs.existsSync(mediaPath)) {
    db.setRedemptionOutcome(logId, 'refunded_no_file', 'media file missing');
    try {
      const { fulfillRedemption } = require('./twitchRewards');
      await fulfillRedemption(streamer, twitchRewardId, twitchRedemptionId, 'CANCELED');
      if (streamer && streamer.twitch_username && streamer.chatbot_enabled) {
        chatManager.sendRawMessage(
          streamer.twitch_username,
          `[Atleta] Reward "${reward.title}" had a missing media file — redemption refunded.`
        );
      }
    } catch (e) {
      console.error('[Redemption] refund/chat failed:', e.message);
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
      if (msg) chatManager.sendRawMessage(streamer.twitch_username, msg);
    }
  }

  // Step 7: auto-fulfill after playback window
  if (reward.auto_fulfill) {
    const delay = (reward.max_play_seconds * 1000) + 1000;
    const timer = setTimeout(async () => {
      try {
        const latest = db.getStreamerById(streamerId); // its token may have been refreshed since
        if (!latest) return;
        const { fulfillRedemption } = require('./twitchRewards');
        await fulfillRedemption(latest, twitchRewardId, twitchRedemptionId, 'FULFILLED');
      } catch (e) {
        console.error('[Redemption] auto-fulfill error:', e.message);
      }
    }, delay);
    timer.unref();
  }

  // Step 8: the outcome
  db.setRedemptionOutcome(logId, 'played', null);
}

module.exports = { handleRedemption, formatChatTemplate };
