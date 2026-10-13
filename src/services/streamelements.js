const io = require('socket.io-client');
const db = require('../db');
const bus = require('./overlayBus');
const { chatManager } = require('./twitchChat');

// One StreamElements event. A real tip is logged once per StreamElements event
// id, and only a newly logged tip counts toward the tip goal: a replayed event
// (same id) plays the alert again but is not counted twice. Test tips from the
// StreamElements dashboard only play the alert and the chat message.
function handleTip(streamerId, event, isTest) {
  if (!event || event.type !== 'tip') return;
  const data = event.data || {};
  // Real tips count toward the tip goal even if the overlay alert is off
  if (!isTest) {
    let isNew = false;
    try {
      isNew = db.logDonation(streamerId, {
        source: 'streamelements', donor_name: data.username, amount: data.amount,
        currency: data.currency, message: data.message, external_id: event._id || null,
      });
    } catch (e) { console.error('[StreamElements] logDonation error:', e.message); }
    if (isNew) require('./tipGoals').recordDonation(streamerId, data.amount, data.currency);
  }
  const s = db.getStreamerById(streamerId);
  if (s && s.overlay_donation_enabled) {
    bus.emit(`overlay:${streamerId}`, {
      type: 'donation',
      data: {
        username: data.username,
        amount: data.amount,
        message: data.message || null,
        currency: data.currency || 'USD',
      },
    });
    // Test tips still play, but stay out of the dashboard's 7-day stats
    if (!isTest) {
      try { db.logOverlayEvent(streamerId, 'donation', data.username, { amount: data.amount, currency: data.currency }); } catch (e) {}
    }
    chatManager.sendEventMessage(streamerId, 'donation', {
      username: data.username,
      amount: data.amount,
      currency: data.currency || 'USD',
      message: data.message || '',
    });
  }
}

class StreamElementsClient {
  constructor(streamerId) {
    this.streamerId = streamerId;
    this.socket = null;
    this.running = false;
  }

  connect() {
    const streamer = db.getStreamerById(this.streamerId);
    if (!streamer || !streamer.streamelements_jwt) {
      console.log(`[StreamElements] Streamer ${this.streamerId}: no JWT token, skipping`);
      return;
    }

    this.running = true;
    console.log(`[StreamElements] Connecting for streamer ${streamer.twitch_display_name || this.streamerId}...`);

    this.socket = io('https://realtime.streamelements.com', {
      transports: ['websocket'],
    });

    this.socket.on('connect', () => {
      console.log(`[StreamElements] Connected for streamer ${this.streamerId}, authenticating...`);
      this.socket.emit('authenticate', { method: 'jwt', token: streamer.streamelements_jwt });
    });

    this.socket.on('authenticated', () => {
      console.log(`[StreamElements] Authenticated for streamer ${this.streamerId}`);
    });

    this.socket.on('unauthorized', () => {
      console.error(`[StreamElements] Auth failed for streamer ${this.streamerId} — check JWT token`);
    });

    this.socket.on('event', (event) => handleTip(this.streamerId, event, false));
    this.socket.on('event:test', (event) => handleTip(this.streamerId, event, true));

    this.socket.on('disconnect', () => {
      console.log(`[StreamElements] Disconnected for streamer ${this.streamerId}`);
    });
  }

  disconnect() {
    this.running = false;
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

const clients = new Map();

const streamElementsManager = {
  startAll() {
    const streamers = db.getOverlayEnabledStreamers();
    let count = 0;
    for (const s of streamers) {
      if (s.streamelements_jwt) {
        this.startForStreamer(s.id);
        count++;
      }
    }
    console.log(`[StreamElements] Started ${count} connections`);
  },

  startForStreamer(streamerId) {
    this.stopForStreamer(streamerId);
    const client = new StreamElementsClient(streamerId);
    clients.set(streamerId, client);
    client.connect();
  },

  stopForStreamer(streamerId) {
    const client = clients.get(streamerId);
    if (client) {
      client.disconnect();
      clients.delete(streamerId);
    }
  },

  stopAll() {
    for (const [id, client] of clients) {
      client.disconnect();
    }
    clients.clear();
  },
};

module.exports = { streamElementsManager, handleTip };
