'use strict';

// What disabling, enabling or removing a streamer account does besides the
// database row: closing its web sessions (done by the db functions) and
// stopping or restarting the live connections that serve it. The managers'
// own stop and start functions do the work; nothing here opens a connection.
//
// `services` is injectable so the order of calls can be tested; by default the
// real modules are loaded on first use (they need the app's config).

const { accountDisabledChannel } = require('./streamerAccess');

// The YouTube live chat a disabled account was polling is remembered for this
// long. Enabling the account within it polls that chat again (the stream is
// probably still on); after it, the chat is left to the live poller or the
// dashboard's Connect button: the stream may be over, and the chat of a
// finished stream only ever fails to poll.
const YOUTUBE_CHAT_RESUME_MS = 30 * 60 * 1000;
const pausedYoutubeChats = new Map(); // streamerId -> { liveChatId, at }

function liveServices() {
  return {
    db: require('../db'),
    bus: require('./overlayBus'),
    eventSubManager: require('./eventsub').eventSubManager,
    streamElementsManager: require('./streamelements').streamElementsManager,
    chatManager: require('./twitchChat').chatManager,
    youtubeChatManager: require('./youtubeLiveChat').youtubeChatManager,
    timedNotificationManager: require('./timedNotifications').timedNotificationManager,
  };
}

// `services.now` is for tests.
const nowOf = (services) => (typeof services.now === 'function' ? services.now() : Date.now());

// One manager failing must not leave the others running.
function attempt(label, streamerId, fn) {
  try {
    fn();
  } catch (e) {
    console.error(`[Account] ${label} failed for streamer ${streamerId}: ${e.message}`);
  }
}

// pauseYoutubeChat: remember the YouTube chat being polled, so enabling the
// account again can pick it up (Disable), as opposed to Remove.
function stopLiveServices(streamerId, services, { pauseYoutubeChat = false } = {}) {
  attempt('EventSub stop', streamerId, () => services.eventSubManager.stopForStreamer(streamerId));
  attempt('StreamElements stop', streamerId, () => services.streamElementsManager.stopForStreamer(streamerId));
  attempt('Twitch chat stop', streamerId, () => services.chatManager.stopForStreamer(streamerId));
  attempt('YouTube chat stop', streamerId, () => {
    const liveChatId = services.youtubeChatManager.getLiveChatId(streamerId);
    services.youtubeChatManager.stopPolling(streamerId);
    if (pauseYoutubeChat && liveChatId) pausedYoutubeChats.set(streamerId, { liveChatId, at: nowOf(services) });
  });
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
  // The YouTube chat is polled only while a stream is live, so nothing else
  // brings it back at once: a chat the account was polling when it was disabled.
  const paused = pausedYoutubeChats.get(streamerId);
  pausedYoutubeChats.delete(streamerId);
  if (paused && streamer.yt_chatbot_enabled && nowOf(services) - paused.at <= YOUTUBE_CHAT_RESUME_MS) {
    attempt('YouTube chat start', streamerId, () => services.youtubeChatManager.startPolling(streamerId, paused.liveChatId));
  }
}

// Remembered chats that are too old to be used are dropped whenever an account is
// disabled, so the map keeps only recent ones (it holds at most one per account).
function forgetOldPausedChats(now) {
  for (const [streamerId, paused] of pausedYoutubeChats) {
    if (now - paused.at > YOUTUBE_CHAT_RESUME_MS) pausedYoutubeChats.delete(streamerId);
  }
}

// Switches the account off: flag set and web sessions deleted in one
// transaction, then the live connections stopped.
function disableAccount(streamerId, note, services = liveServices()) {
  services.db.disableStreamer(streamerId, note);
  forgetOldPausedChats(nowOf(services));
  stopLiveServices(streamerId, services, { pauseYoutubeChat: true });
}

function enableAccount(streamerId, services = liveServices()) {
  services.db.enableStreamer(streamerId);
  startLiveServices(streamerId, services);
}

// Connections go first so nothing keeps running for a row that is about to go.
function removeAccount(streamerId, services = liveServices()) {
  stopLiveServices(streamerId, services);
  pausedYoutubeChats.delete(streamerId);
  services.db.deleteStreamer(streamerId);
}

module.exports = { disableAccount, enableAccount, removeAccount };
