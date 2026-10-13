'use strict';

// What disabling, enabling or removing a streamer account does besides the
// database row: closing its web sessions (done by the db functions) and
// stopping or restarting the live connections that serve it. The managers'
// own stop and start functions do the work; nothing here opens a connection.
//
// `services` is injectable so the order of calls can be tested; by default the
// real modules are loaded on first use (they need the app's config).

const { accountDisabledChannel } = require('./streamerAccess');

function liveServices() {
  return {
    db: require('../db'),
    bus: require('./overlayBus'),
    eventSubManager: require('./eventsub').eventSubManager,
    streamElementsManager: require('./streamelements').streamElementsManager,
    chatManager: require('./twitchChat').chatManager,
    timedNotificationManager: require('./timedNotifications').timedNotificationManager,
  };
}

// One manager failing must not leave the others running.
function attempt(label, streamerId, fn) {
  try {
    fn();
  } catch (e) {
    console.error(`[Account] ${label} failed for streamer ${streamerId}: ${e.message}`);
  }
}

function stopLiveServices(streamerId, services) {
  attempt('EventSub stop', streamerId, () => services.eventSubManager.stopForStreamer(streamerId));
  attempt('StreamElements stop', streamerId, () => services.streamElementsManager.stopForStreamer(streamerId));
  attempt('Twitch chat stop', streamerId, () => services.chatManager.stopForStreamer(streamerId));
  attempt('Sponsor rotation stop', streamerId, () => services.timedNotificationManager.stopForStreamer(streamerId));
  // OBS browser sources already connected keep their stream until it is ended.
  attempt('Overlay streams close', streamerId, () => services.bus.emit(accountDisabledChannel(streamerId)));
}

// Restarts what the streamer had switched on, under the same conditions the
// managers use when the app boots.
function startLiveServices(streamerId, services) {
  const streamer = services.db.getStreamerById(streamerId);
  if (!streamer) return;
  if (streamer.overlay_enabled && streamer.broadcaster_access_token) {
    attempt('EventSub start', streamerId, () => services.eventSubManager.startForStreamer(streamerId));
    if (streamer.streamelements_jwt) {
      attempt('StreamElements start', streamerId, () => services.streamElementsManager.startForStreamer(streamerId));
    }
    attempt('Sponsor rotation start', streamerId, () => {
      services.timedNotificationManager.restartForStreamer(streamerId);
      services.timedNotificationManager.restartChatForStreamer(streamerId);
    });
  }
  if (streamer.chatbot_enabled && streamer.twitch_username) {
    attempt('Twitch chat start', streamerId, () => services.chatManager.startForStreamer(streamerId));
  }
}

// Switches the account off: flag set and web sessions deleted in one
// transaction, then the live connections stopped.
function disableAccount(streamerId, note, services = liveServices()) {
  services.db.disableStreamer(streamerId, note);
  stopLiveServices(streamerId, services);
}

function enableAccount(streamerId, services = liveServices()) {
  services.db.enableStreamer(streamerId);
  startLiveServices(streamerId, services);
}

// Connections go first so nothing keeps running for a row that is about to go.
function removeAccount(streamerId, services = liveServices()) {
  stopLiveServices(streamerId, services);
  services.db.deleteStreamer(streamerId);
}

module.exports = { disableAccount, enableAccount, removeAccount };
