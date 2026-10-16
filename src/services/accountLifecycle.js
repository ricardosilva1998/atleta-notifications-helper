'use strict';

// What disabling, enabling or removing a streamer account does besides the
// database row: closing its web sessions (done by the db functions) and
// stopping or restarting the live connections that serve it. The same goes for
// a change of the streamer's linked Twitch account (twitchAccountChanged). The
// managers' own stop and start functions do the work; nothing here opens a
// connection.
//
// `services` is injectable so the order of calls can be tested; by default the
// real modules are loaded on first use (they need the app's config).

const { accountDisabledChannel, isStreamerDisabled } = require('./streamerAccess');

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

// The two managers a change of Twitch account touches, and the polls the card and the bar show.
function twitchServices() {
  return {
    db: require('../db'),
    eventSubManager: require('./eventsub').eventSubManager,
    chatManager: require('./twitchChat').chatManager,
    livePolls: require('./livePolls').livePolls,
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
// managers use when the app boots. The event connections (EventSub,
// StreamElements, the sponsor rotation) serve the overlay and the chatbot, so
// either one being on starts them (db.getOverlayOrChatbotStreamers); each
// keeps its own condition: EventSub needs the broadcaster authorization,
// StreamElements its token, and the sponsor manager starts only the rotations
// the streamer switched on.
function startLiveServices(streamerId, services) {
  const streamer = services.db.getStreamerById(streamerId);
  if (!streamer) return;
  if (streamer.overlay_enabled || streamer.chatbot_enabled) {
    if (streamer.broadcaster_access_token) {
      attempt('EventSub start', streamerId, () => services.eventSubManager.startForStreamer(streamerId));
    }
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

// A streamer's linked Twitch account changed, or the link was taken over by
// another streamer who linked the same account (db.linkTwitch has cleared the
// broadcaster authorization that belonged to the previous account). What ran for
// that account stops: EventSub; the poll and prediction the Polls & predictions
// card and the bar showed are forgotten (an open bar clears, and the card reads
// the new channel); and the chat bot leaves the previous channel
// (previousUsername, which the database no longer holds) and joins the new one
// if the chat bot is on. EventSub is not started again: there is no
// authorization to connect with until the streamer gives one for the new
// account, and giving it starts EventSub.
function twitchAccountChanged(streamerId, previousUsername, services = twitchServices()) {
  attempt('EventSub stop', streamerId, () => services.eventSubManager.stopForStreamer(streamerId));
  attempt('Polls forget', streamerId, () => services.livePolls.forget(streamerId));
  if (previousUsername) {
    attempt('Twitch chat leave', streamerId, () => services.chatManager.partChannel(previousUsername));
  }
  const streamer = services.db.getStreamerById(streamerId);
  if (streamer && streamer.chatbot_enabled && streamer.twitch_username && !isStreamerDisabled(streamer)) {
    attempt('Twitch chat join', streamerId, () => services.chatManager.startForStreamer(streamerId));
  }
}

module.exports = { disableAccount, enableAccount, removeAccount, twitchAccountChanged };
