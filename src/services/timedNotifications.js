const db = require('../db');
const bus = require('./overlayBus');

const activeRotations = new Map(); // streamerId -> { handle, currentIndex }

function stopRotation(streamerId) {
  const existing = activeRotations.get(streamerId);
  if (existing) {
    clearInterval(existing.handle);
    activeRotations.delete(streamerId);
  }
}

function startRotation(streamerId) {
  stopRotation(streamerId);
  const streamer = db.getStreamerById(streamerId);
  if (!streamer || !streamer.sponsor_rotation_enabled) return;

  const images = db.getEnabledSponsorImages(streamerId);
  if (images.length === 0) return;

  const intervalMs = (streamer.sponsor_interval_seconds || 30) * 1000;
  let currentIndex = 0;

  const handle = setInterval(() => {
    const imgs = db.getEnabledSponsorImages(streamerId);
    if (imgs.length === 0) return;
    currentIndex = currentIndex % imgs.length;
    const img = imgs[currentIndex];

    // Show on overlay
    bus.emit(`overlay:${streamerId}`, {
      type: 'sponsor',
      data: {
        imageUrl: `/sponsors/${streamerId}/${img.filename}`,
        name: img.display_name,
      },
    });

    // Send chat message if enabled
    const currentStreamer = db.getStreamerById(streamerId);
    if (currentStreamer && currentStreamer.sponsor_send_chat && img.chat_message) {
      try {
        const { chatManager } = require('./twitchChat');
        chatManager.sendRawMessage(currentStreamer.twitch_username, img.chat_message);
      } catch(e) {
        console.error('[Sponsor] Failed to send chat message:', e.message);
      }
    }

    currentIndex++;
    console.log(`[Sponsor] Rotated to "${img.display_name}" for streamer ${streamerId}`);
  }, intervalMs);

  activeRotations.set(streamerId, { handle, currentIndex: 0 });
  console.log(`[Sponsor] Started rotation for streamer ${streamerId} (${images.length} images, every ${streamer.sponsor_interval_seconds}s)`);
}

const timedNotificationManager = {
  startAll() {
    const streamers = db.getOverlayEnabledStreamers();
    let count = 0;
    for (const s of streamers) {
      if (s.sponsor_rotation_enabled) {
        startRotation(s.id);
        count++;
      }
    }
    console.log(`[Sponsor] Started rotations for ${count} streamers`);
  },

  restartForStreamer(streamerId) {
    stopRotation(streamerId);
    startRotation(streamerId);
  },

  stopAll() {
    for (const [, rotation] of activeRotations) {
      clearInterval(rotation.handle);
    }
    activeRotations.clear();
  },
};

module.exports = { timedNotificationManager };
