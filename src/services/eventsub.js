const WebSocket = require('ws');
const config = require('../config');
const db = require('../db');
const bus = require('./overlayBus');
const { refreshBroadcasterToken, hasRedemptionScope } = require('./twitch');
const { chatManager } = require('./twitchChat');
const { isStreamerDisabled } = require('./streamerAccess');
const { createMessageDedupe } = require('./messageDedupe');

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
const SUBSCRIPTIONS_URL = 'https://api.twitch.tv/helix/eventsub/subscriptions';

// A subscribe request Twitch never answers must not hold the subscribe loop, and
// with it the whole session, for good.
const SUBSCRIBE_TIMEOUT_MS = 10_000;

// Twitch's default keepalive. A session that has been silent for its keepalive
// plus this grace is treated as lost.
const DEFAULT_KEEPALIVE_SECONDS = 10;
const KEEPALIVE_GRACE_SECONDS = 5;

// A connection attempt Twitch never answers is given up on after this long.
const HANDSHAKE_TIMEOUT_MS = 10_000;

// After Twitch moves a session to a reconnect socket, the old socket may still
// deliver notifications written before the move. It is kept for them until
// Twitch closes it, and at most this long.
const DRAIN_MS = 30_000;

// Twitch can deliver a notification more than once (same message_id), for
// example around a reconnect. Each one is acted on once.
const NOTIFICATION_DEDUPE_TTL_MS = 10 * 60 * 1000;
const seenNotifications = createMessageDedupe({ ttlMs: NOTIFICATION_DEDUPE_TTL_MS });
setInterval(() => seenNotifications.sweep(), 60 * 1000).unref();

// Closes a socket this client no longer uses. A connection that went silent is
// cut (terminate) rather than waiting for a closing handshake that will not come.
function closeSocket(ws, { terminate = false } = {}) {
  try {
    if (terminate) ws.terminate();
    else ws.close(1000);
  } catch (e) {
    // already closed
  }
}

const SUBSCRIPTION_TYPES = [
  { type: 'channel.follow', version: '2', needsModerator: true },
  { type: 'channel.subscribe', version: '1' },
  { type: 'channel.subscription.gift', version: '1' },
  { type: 'channel.subscription.message', version: '1' },
  { type: 'channel.cheer', version: '1' },
  { type: 'channel.raid', version: '1', conditionKey: 'to_broadcaster_user_id' },
  { type: 'channel.channel_points_custom_reward_redemption.add', version: '1' },
];

// One streamer's EventSub connection. The session lives on one socket (`ws`).
// `pendingWs` is a socket opened on Twitch's reconnect_url, waiting for its
// welcome. Once it is welcomed it becomes the session's socket and the old one
// drains (`drainingWs`): only its notifications still count, because Twitch may
// have written some just before the move. Whatever any other socket the client
// has let go of still delivers is ignored, so a streamer never has two live
// sessions (which made every alert, thank-you and redemption happen twice). A
// client is used once: after disconnect() it never connects again, and a restart
// builds a new client.
class EventSubClient {
  constructor(streamerId) {
    this.streamerId = streamerId;
    this.ws = null;
    this.pendingWs = null;
    this.drainingWs = null; // the socket a reconnect replaced: its notifications still count until it closes
    this.drainTimer = null;
    this.sessionId = null; // the live session's id; the session survives a move to a reconnect socket
    this.sessionRun = 0; // counts the sessions started, so a subscribe loop knows if its session is still the live one
    this.keepaliveTimer = null;
    this.keepaliveSeconds = DEFAULT_KEEPALIVE_SECONDS;
    this.reconnectTimer = null;
    this.reconnectDelay = 1000;
    this.stopped = false;
    this.needsReauth = false;
  }

  async connect() {
    // A stopped client never comes back, even from a reconnect timer that was
    // already running. Neither does one that has given up on a dead token:
    // re-authorizing builds a fresh client.
    if (this.stopped || this.needsReauth || this.ws) return;

    const streamer = db.getStreamerById(this.streamerId);
    if (!streamer || !streamer.broadcaster_access_token || !streamer.twitch_user_id) {
      console.log(`[EventSub] Streamer ${this.streamerId}: not configured, skipping`);
      return;
    }
    // A reconnect timer set before an admin disabled the account must not bring it back.
    if (isStreamerDisabled(streamer)) {
      console.log(`[EventSub] Streamer ${this.streamerId}: account disabled, skipping`);
      return;
    }

    console.log(`[EventSub] Connecting for streamer ${streamer.twitch_display_name || this.streamerId}...`);
    this.ws = this.openSocket(EVENTSUB_URL);
    // The silence timer runs from the start, with Twitch's default keepalive until
    // the welcome says otherwise: a socket that opens but never gets its welcome
    // is replaced like any silent one, instead of being kept for good.
    this.keepaliveSeconds = DEFAULT_KEEPALIVE_SECONDS;
    this.resetKeepalive();
  }

  // Each handler checks which role the socket has when its event arrives, so a
  // socket that was replaced or dropped can no longer do anything.
  openSocket(url) {
    const ws = new WebSocket(url, { handshakeTimeout: HANDSHAKE_TIMEOUT_MS });

    ws.on('open', () => {
      if (ws === this.ws) console.log(`[EventSub] Connected for streamer ${this.streamerId}`);
      else if (ws === this.pendingWs) console.log(`[EventSub] Reconnect socket open for streamer ${this.streamerId}`);
    });

    ws.on('message', (data) => {
      this.handleMessage(data, ws).catch((err) => {
        console.error(`[EventSub] Could not handle a message for streamer ${this.streamerId}:`, err.message);
      });
    });

    ws.on('close', (code) => this.handleClose(ws, code));

    ws.on('error', (err) => {
      if (ws === this.ws || ws === this.pendingWs) {
        console.error(`[EventSub] Error for streamer ${this.streamerId}:`, err.message);
      }
    });

    return ws;
  }

  handleClose(ws, code) {
    if (ws === this.drainingWs) {
      // Twitch closed the old socket after the move: nothing more to wait for.
      this.stopDraining();
      return;
    }
    if (ws === this.pendingWs) {
      // The reconnect socket went away before its welcome. The session stays on
      // its own socket until Twitch closes that one; then it starts over.
      this.pendingWs = null;
      console.warn(`[EventSub] Reconnect socket closed before its welcome for streamer ${this.streamerId} (code: ${code})`);
      return;
    }
    if (ws !== this.ws) return; // a socket this client already let go of

    console.log(`[EventSub] Disconnected for streamer ${this.streamerId} (code: ${code})`);
    this.releaseSockets();
    this.scheduleReconnect();
  }

  // Lets go of the session's socket, of a reconnect socket still waiting for its
  // welcome and of the socket a reconnect replaced: the session is over, and
  // nothing any of them delivers counts.
  releaseSockets({ terminate = false } = {}) {
    const sockets = [this.ws, this.pendingWs, this.drainingWs].filter(Boolean);
    this.ws = null;
    this.pendingWs = null;
    this.stopDraining();
    this.sessionId = null;
    this.clearKeepalive();
    for (const ws of sockets) closeSocket(ws, { terminate });
  }

  // Ends the draining of the socket a reconnect replaced (it closed, or its time
  // is up) and returns it, or null when there was none. It does not close it.
  stopDraining() {
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.drainTimer = null;
    const ws = this.drainingWs;
    this.drainingWs = null;
    return ws;
  }

  // At most one reconnect is ever waiting, and disconnect() cancels it.
  scheduleReconnect() {
    if (this.stopped) return;
    if (this.needsReauth) {
      console.warn(`[EventSub] Streamer ${this.streamerId} needs re-authorization — not reconnecting`);
      return;
    }
    if (this.reconnectTimer) return;
    console.log(`[EventSub] Reconnecting in ${this.reconnectDelay / 1000}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => {
        console.error(`[EventSub] Reconnect failed for streamer ${this.streamerId}:`, err.message);
      });
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60000);
  }

  // The broadcaster's refresh token is permanently dead. Clearing the scopes is
  // the same signal the 'revocation' handler uses, so the dashboard's existing
  // needsReauth banner lights up on its own. Then stop reconnecting — without
  // this the socket reopens every second forever, because the socket itself
  // always connects fine and only the subscribe calls fail.
  markNeedsReauth() {
    if (this.needsReauth) return;
    this.needsReauth = true;
    try {
      db.clearStreamerBroadcasterScopes(this.streamerId);
    } catch (e) {
      console.error(`[EventSub] Could not clear scopes for streamer ${this.streamerId}:`, e.message);
    }
    console.warn(`[EventSub] Broadcaster token is permanently invalid for streamer ${this.streamerId} — cleared scopes and stopped reconnecting until re-authorization`);
    this.disconnect();
  }

  async handleMessage(raw, ws) {
    if (this.stopped) return;
    const fromSession = ws === this.ws;
    const fromReconnect = ws === this.pendingWs;
    const fromDraining = ws === this.drainingWs;
    if (!fromSession && !fromReconnect && !fromDraining) return; // a socket this client already let go of

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      console.warn(`[EventSub] Unreadable message for streamer ${this.streamerId}`);
      return;
    }
    const messageType = msg && msg.metadata && msg.metadata.message_type;

    if (fromReconnect) {
      // The reconnect socket only matters once Twitch welcomes it; until then the
      // session's own socket still delivers the events.
      if (messageType === 'session_welcome') this.switchToReconnectSocket(ws, msg.payload && msg.payload.session);
      return;
    }
    if (fromDraining) {
      // Written on the old socket before Twitch moved the session, read after the
      // new socket's welcome: still acted on (once, thanks to the message_id dedupe).
      if (messageType === 'notification') this.handleNotification(msg);
      return;
    }

    // The welcome says how long the session may stay silent; any message from
    // the session shows it is alive.
    if (messageType === 'session_welcome') this.setKeepaliveSeconds(msg.payload && msg.payload.session && msg.payload.session.keepalive_timeout_seconds);
    this.resetKeepalive();

    switch (messageType) {
      case 'session_welcome':
        await this.subscribeAll(msg.payload.session.id);
        break;

      case 'session_keepalive':
        break;

      case 'notification':
        this.handleNotification(msg);
        break;

      case 'session_reconnect':
        this.openReconnectSocket(msg.payload && msg.payload.session && msg.payload.session.reconnect_url);
        break;

      case 'revocation': {
        const revokedType = msg.payload.subscription.type;
        const revokedStatus = msg.payload.subscription.status;
        console.warn(`[EventSub] Subscription revoked for streamer ${this.streamerId}:`, revokedType, revokedStatus);
        if (
          revokedType === 'channel.channel_points_custom_reward_redemption.add' &&
          revokedStatus === 'authorization_revoked'
        ) {
          db.clearStreamerBroadcasterScopes(this.streamerId);
          console.warn(`[EventSub] Cleared broadcaster scopes for streamer ${this.streamerId} — reconnect required`);
        }
        break;
      }
    }
  }

  // A new session starts with no subscriptions: create one per event type.
  async subscribeAll(sessionId) {
    this.sessionId = sessionId;
    const run = ++this.sessionRun;
    console.log(`[EventSub] Session ${sessionId} for streamer ${this.streamerId} (keepalive: ${this.keepaliveSeconds}s)`);

    let subscribed = 0;
    for (const subType of SUBSCRIPTION_TYPES) {
      // Stop once this session is over (stopped, lost, replaced by a newer one,
      // or the token died). A session Twitch moved to a reconnect socket is the
      // same session, even if Twitch names it differently there: go on with the
      // id it has now.
      if (this.needsReauth || this.stopped || this.sessionRun !== run || !this.sessionId) break;
      if (await this.createSubscription(this.sessionId, subType)) subscribed++;
    }

    // Only a session that actually subscribed to something earns a backoff
    // reset. Resetting on socket 'open' instead meant a dead token looped
    // forever at 1s, because the socket always opens and Twitch then closes
    // it with 4003 once no subscription shows up.
    if (subscribed > 0) {
      this.reconnectDelay = 1000;
    } else if (!this.needsReauth && !this.stopped) {
      console.warn(`[EventSub] No subscriptions created for streamer ${this.streamerId} — next retry in ${this.reconnectDelay / 1000}s`);
    }
  }

  handleNotification(msg) {
    if (seenNotifications.isRepeat(msg.metadata.message_id)) return; // Twitch delivered this one already

    const subType = msg.metadata.subscription_type;
    const event = msg.payload.event;

    const normalized = this.normalizeEvent(subType, event);
    if (!normalized) return;

    // Channel point redemptions are handled by the dispatcher — not the generic overlay path
    if (normalized.type === 'redemption') {
      const { handleRedemption } = require('./redemptionDispatcher');
      handleRedemption(this.streamerId, normalized.data)
        .catch(err => console.error('[Redemption] dispatch error:', err.message));
      return;
    }

    const streamer = db.getStreamerById(this.streamerId);

    // Emit to overlay — giftsub shows as subscription banner
    const isGift = normalized.type === 'giftsub';
    const overlayType = isGift ? 'subscription' : normalized.type;
    const typeMap = { follow: 'follow', subscription: 'sub', giftsub: 'sub', bits: 'bits', donation: 'donation', raid: 'raid' };
    const enabledKey = `overlay_${typeMap[overlayType] || overlayType}_enabled`;
    if (streamer && streamer[enabledKey]) {
      bus.emit(`overlay:${this.streamerId}`, { ...normalized, type: overlayType, isGift });
    }
    try { db.logOverlayEvent(this.streamerId, normalized.type, normalized.data?.username, normalized.data); } catch (e) {}

    // Emit to chat service
    chatManager.sendEventMessage(this.streamerId, normalized.type, normalized.data);
    if (normalized.type === 'raid') chatManager.startRaidProtection(this.streamerId);
  }

  // Twitch is moving the session to another server: connect to the URL it gave
  // (as it is). The session's own socket keeps delivering events until the new
  // socket is welcomed (switchToReconnectSocket).
  openReconnectSocket(url) {
    if (typeof url !== 'string' || !url) return;
    console.log(`[EventSub] Reconnect requested for streamer ${this.streamerId}`);
    const previous = this.pendingWs; // an earlier reconnect that never got its welcome
    this.pendingWs = null;
    if (previous) closeSocket(previous);
    this.pendingWs = this.openSocket(url);
  }

  // The reconnect socket is welcomed: it carries the session's subscriptions
  // (Twitch moves them), so nothing is subscribed again, and it is now the
  // session's socket. The old socket is not closed at once: Twitch may have
  // written notifications to it just before the move, and they would be lost.
  // It drains (handleMessage acts on its notifications only) until Twitch closes
  // it or DRAIN_MS pass, whichever comes first; a notification that reaches both
  // sockets is acted on once (the message_id dedupe).
  switchToReconnectSocket(ws, session) {
    const old = this.ws;
    this.ws = ws;
    this.pendingWs = null;
    if (session && session.id) this.sessionId = session.id;
    this.setKeepaliveSeconds(session && session.keepalive_timeout_seconds);
    this.resetKeepalive();
    if (old) {
      const earlier = this.stopDraining(); // a socket from a move not long ago
      if (earlier) closeSocket(earlier);
      this.drainingWs = old;
      this.drainTimer = setTimeout(() => {
        const expired = this.stopDraining();
        if (expired) closeSocket(expired);
      }, DRAIN_MS);
      this.drainTimer.unref?.();
    }
    console.log(`[EventSub] Streamer ${this.streamerId} moved to the reconnect socket (session ${session && session.id})`);
  }

  // Returns true only when Twitch accepted the subscription.
  async createSubscription(sessionId, subType) {
    if (this.needsReauth) return false;

    let streamer = db.getStreamerById(this.streamerId);

    if (subType.type === 'channel.channel_points_custom_reward_redemption.add' && !hasRedemptionScope(streamer)) {
      return false;
    }

    let token = streamer.broadcaster_access_token;

    const conditionKey = subType.conditionKey || 'broadcaster_user_id';
    const condition = { [conditionKey]: streamer.twitch_user_id };
    if (subType.needsModerator) {
      condition.moderator_user_id = streamer.twitch_user_id;
    }

    const body = {
      type: subType.type,
      version: subType.version,
      condition,
      transport: { method: 'websocket', session_id: sessionId },
    };

    const post = (bearer) => fetch(SUBSCRIPTIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Client-Id': config.twitch.clientId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SUBSCRIBE_TIMEOUT_MS),
    });

    let res;
    try {
      res = await post(token);
    } catch (err) {
      // No answer in time, or the network failed: this event type is not
      // subscribed, and the others still get their turn.
      console.error(`[EventSub] Subscribe request for ${subType.type} failed for streamer ${this.streamerId}:`, err.message);
      return false;
    }

    // Retry with refreshed token on 401
    if (res.status === 401) {
      try {
        streamer = db.getStreamerById(this.streamerId);
        token = await refreshBroadcasterToken(streamer);
        res = await post(token);
      } catch (err) {
        console.error(`[EventSub] Token refresh failed for streamer ${this.streamerId}:`, err.message);
        if (err.code === 'INVALID_REFRESH_TOKEN') this.markNeedsReauth();
        return false;
      }
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(`[EventSub] Failed to subscribe ${subType.type} for streamer ${this.streamerId}:`, err.message || res.status);
      return false;
    }

    console.log(`[EventSub] Subscribed to ${subType.type} for streamer ${this.streamerId}`);
    return true;
  }

  normalizeEvent(subType, event) {
    switch (subType) {
      case 'channel.follow':
        return { type: 'follow', data: { username: event.user_name } };

      case 'channel.subscribe':
        // A gifted sub. Twitch sends one of these per recipient, besides the single
        // channel.subscription.gift for the whole gift: that one is the alert and
        // the thank-you (a 50-sub gift is one alert and one chat message, not 51).
        if (event.is_gift) return null;
        return {
          type: 'subscription',
          data: {
            username: event.user_name,
            tier: event.tier === '1000' ? '1' : event.tier === '2000' ? '2' : '3',
            months: 1,
            message: null,
          },
        };

      case 'channel.subscription.gift':
        return {
          type: 'giftsub',
          data: {
            username: event.is_anonymous ? 'Anonymous' : event.user_name,
            tier: event.tier === '1000' ? '1' : event.tier === '2000' ? '2' : '3',
            amount: event.total,
            message: `Gifted ${event.total} sub${event.total > 1 ? 's' : ''}!`,
          },
        };

      case 'channel.subscription.message':
        return {
          type: 'subscription',
          data: {
            username: event.user_name,
            tier: event.tier === '1000' ? '1' : event.tier === '2000' ? '2' : '3',
            months: event.cumulative_months,
            message: event.message ? event.message.text : null,
          },
        };

      case 'channel.cheer':
        return {
          type: 'bits',
          data: {
            username: event.is_anonymous ? 'Anonymous' : event.user_name,
            amount: event.bits,
            message: event.message || null,
          },
        };

      case 'channel.raid':
        return {
          type: 'raid',
          data: {
            username: event.from_broadcaster_user_name,
            viewers: event.viewers,
          },
        };

      case 'channel.channel_points_custom_reward_redemption.add':
        return {
          type: 'redemption',
          data: {
            twitchRedemptionId: event.id,
            twitchRewardId: event.reward.id,
            rewardTitle: event.reward.title,
            rewardCost: event.reward.cost,
            username: event.user_name,
            userId: event.user_id,
            userInput: event.user_input || null,
            status: event.status,
            redeemedAt: event.redeemed_at,
          },
        };

      default:
        return null;
    }
  }

  // The session's keepalive, from its welcome (a reconnect message carries none).
  setKeepaliveSeconds(seconds) {
    const n = Number(seconds);
    if (Number.isFinite(n) && n > 0) this.keepaliveSeconds = n;
  }

  resetKeepalive() {
    this.clearKeepalive();
    this.keepaliveTimer = setTimeout(
      () => this.onKeepaliveTimeout(),
      (this.keepaliveSeconds + KEEPALIVE_GRACE_SECONDS) * 1000
    );
  }

  // Twitch: no message for longer than the keepalive means the connection is
  // lost. Connect again from scratch; the new session subscribes again.
  onKeepaliveTimeout() {
    this.keepaliveTimer = null;
    if (this.stopped || !this.ws) return;
    console.warn(`[EventSub] Keepalive timeout for streamer ${this.streamerId}`);
    this.releaseSockets({ terminate: true });
    this.scheduleReconnect();
  }

  clearKeepalive() {
    if (this.keepaliveTimer) {
      clearTimeout(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  disconnect() {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.releaseSockets();
  }
}

// Manager for all per-streamer connections
const clients = new Map();

const eventSubManager = {
  // Every streamer whose overlay or chatbot is on: the alerts and the chatbot's
  // thank-yous both come from these events. One with no broadcaster token or no
  // linked Twitch account is skipped (startForStreamer says so).
  startAll() {
    const streamers = db.getOverlayOrChatbotStreamers();
    let started = 0;
    for (const s of streamers) {
      if (this.startForStreamer(s.id)) started++;
    }
    const skipped = streamers.length - started;
    console.log(`[EventSub] Started ${started} connections${skipped ? ` (${skipped} skipped: not set up for EventSub)` : ''}`);
  },

  // Returns whether the streamer got a connection: false when there is nothing to
  // connect with (no linked Twitch account or broadcaster token) or the account is
  // disabled. connect() opens the socket before it first yields, so this is known
  // as it returns.
  startForStreamer(streamerId) {
    this.stopForStreamer(streamerId);
    const client = new EventSubClient(streamerId);
    clients.set(streamerId, client);
    client.connect();
    return client.ws !== null;
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

module.exports = { eventSubManager, NOTIFICATION_DEDUPE_TTL_MS };
