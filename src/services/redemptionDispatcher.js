const path = require('path');
const fs = require('fs');
const db = require('../db');
const bus = require('./overlayBus');
const { chatManager } = require('./twitchChat');
const { formatChatTemplate } = require('./redemptionTemplates');

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

  // Step 1: look up reward in our DB
  const reward = db.getRewardByTwitchId(streamerId, twitchRewardId);
  if (!reward) {
    db.logRedemption({
      streamer_id: streamerId,
      twitch_redemption_id: twitchRedemptionId,
      twitch_reward_id: twitchRewardId,
      user_id: userId,
      user_login: username,
      user_input: userInput || null,
      cost: rewardCost,
      status,
      outcome: 'error',
      error_message: 'reward_not_in_db',
      redeemed_at: redeemedAt,
    });
    // Async sync — reward may have been just created on Twitch before local row was written
    const { syncRewards } = require('./twitchRewards');
    syncRewards(streamerId).catch(e => console.error('[Redemption] background sync error:', e.message));
    return;
  }

  // Step 2: check enabled
  if (!reward.enabled) {
    db.logRedemption({
      streamer_id: streamerId,
      reward_id: reward.id,
      twitch_redemption_id: twitchRedemptionId,
      twitch_reward_id: twitchRewardId,
      user_id: userId,
      user_login: username,
      user_input: userInput || null,
      cost: rewardCost,
      status,
      outcome: 'disabled',
      redeemed_at: redeemedAt,
    });
    return;
  }

  // Step 3: verify file exists
  const mediaPath = path.join(__dirname, '..', '..', 'data', 'redemptions', String(streamerId), reward.media_filename);
  if (!fs.existsSync(mediaPath)) {
    db.logRedemption({
      streamer_id: streamerId,
      reward_id: reward.id,
      twitch_redemption_id: twitchRedemptionId,
      twitch_reward_id: twitchRewardId,
      user_id: userId,
      user_login: username,
      user_input: userInput || null,
      cost: rewardCost,
      status,
      outcome: 'refunded_no_file',
      error_message: 'media file missing',
      redeemed_at: redeemedAt,
    });
    try {
      const streamer = db.getStreamerById(streamerId);
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

  // Step 4: emit to overlay
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

  // Step 5: optional chat message
  if (reward.chat_message_template) {
    const streamer = db.getStreamerById(streamerId);
    if (streamer && streamer.chatbot_enabled && streamer.twitch_username) {
      const msg = formatChatTemplate(reward.chat_message_template, {
        user: username,
        title: reward.title,
        cost: rewardCost,
      });
      if (msg) chatManager.sendRawMessage(streamer.twitch_username, msg);
    }
  }

  // Step 6: auto-fulfill after playback window
  if (reward.auto_fulfill) {
    const delay = (reward.max_play_seconds * 1000) + 1000;
    const timer = setTimeout(async () => {
      try {
        const streamer = db.getStreamerById(streamerId);
        if (!streamer) return;
        const { fulfillRedemption } = require('./twitchRewards');
        await fulfillRedemption(streamer, twitchRewardId, twitchRedemptionId, 'FULFILLED');
      } catch (e) {
        console.error('[Redemption] auto-fulfill error:', e.message);
      }
    }, delay);
    timer.unref();
  }

  // Step 7: log redemption
  db.logRedemption({
    streamer_id: streamerId,
    reward_id: reward.id,
    twitch_redemption_id: twitchRedemptionId,
    twitch_reward_id: twitchRewardId,
    user_id: userId,
    user_login: username,
    user_input: userInput || null,
    cost: rewardCost,
    status,
    outcome: 'played',
    redeemed_at: redeemedAt,
  });
}

module.exports = { handleRedemption, formatChatTemplate };
