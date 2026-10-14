const tmi = require('tmi.js');
const config = require('../config');
const db = require('../db');
const bus = require('./overlayBus');
const { isExempt, runFilters, getAction, executeAction, handleModCommand, activateRaidProtection, checkBannedWords } = require('./chatModeration');
const { isStreamerDisabled } = require('./streamerAccess');
const { commandCooldownSeconds } = require('./chatCommands');
const { fillChatTemplate } = require('./chatTemplate');
const { createChatDispatcher } = require('./chatDispatcher');

let client = null;
// Every line the bot posts goes out through it: the bot-wide rate limit, the
// gap per channel, priorities and merged thank-yous (chatDispatcher.js).
// Made by connect().
let dispatcher = null;
const channelMap = new Map(); // channelName -> streamerId
const cooldowns = new Map(); // "streamerId:command" -> timestamp

const chatTypeMap = { subscription: 'sub', follow: 'follow', giftsub: 'giftsub', bits: 'bits', donation: 'donation', raid: 'raid' };

// Thank-yous of these kinds that arrive close together share one line
// ("Welcome to the pit crew, A, B and C!"). The others carry amounts or viewer
// counts (bits, gifts, donations, raids) that would read as a total.
const MERGED_EVENT_TYPES = new Set(['follow', 'subscription']);

function getStreamerIdForChannel(channel) {
  const clean = channel.replace(/^#/, '').toLowerCase();
  return channelMap.get(clean);
}

// Queues a line for a channel. priority: 'high' (moderation notices, command
// replies), 'normal' (thank-yous, announcements) or 'low' (sponsor and timed
// messages). merge: see chatDispatcher.js.
function post(channel, text, priority, merge) {
  if (!client || !dispatcher) return;
  dispatcher.enqueue({ channel, text, priority, merge });
}

// What the moderation and command helpers get in place of the tmi.js client:
// their warnings, !permit and !slow answers, raid protection notices and
// command replies go out through the dispatcher as the most important messages.
// A chat the bot has left (chatbot switched off, account disabled) gets nothing,
// not even a notice from a timer started before it left (raid protection's end).
const replies = {
  say(channel, text) {
    if (getStreamerIdForChannel(channel)) post(channel, text, 'high');
    return Promise.resolve();
  },
};

async function handleMessage(channel, tags, message, self) {
  if (self) return;

  const streamerId = getStreamerIdForChannel(channel);
  if (!streamerId) return;

  const streamer = db.getStreamerById(streamerId);
  if (!streamer || isStreamerDisabled(streamer)) return;

  // Banned words always enforced (except mods/broadcaster)
  if (!(tags.mod || tags.badges?.broadcaster) && streamer.mod_banned_words_enabled) {
    const bwViolation = checkBannedWords(message, streamer.id);
    if (bwViolation) {
      const action = getAction(channel, tags.username, streamer);
      await executeAction(replies, channel, tags, action, bwViolation.reason, streamer);
      return;
    }
  }

  // Run remaining moderation filters for non-exempt users
  if (!isExempt(tags, streamer)) {
    const violation = await runFilters(channel, tags, message, streamer);
    if (violation) {
      if (violation.flagOnly) {
        post(channel, `[Mod] ${violation.reason}`, 'high');
      } else {
        const action = getAction(channel, tags.username, streamer);
        await executeAction(replies, channel, tags, action, violation.reason, streamer);
        return;
      }
    }
  }

  // Chat overlay (iRacing chat): only after moderation, so a message the bot
  // removes never shows on stream.
  if (streamer.overlay_enabled) {
    bus.emit(`overlay:${streamerId}`, {
      type: 'chat',
      data: { platform: 'twitch', username: tags['display-name'] || tags.username, message, color: tags.color || '#9146ff' }
    });
  }

  // Mod-only commands (!permit, !slow, !slowoff)
  if (await handleModCommand(replies, channel, tags, message, streamer)) return;

  // Giveaway entry hook — keyword owned by the active giveaway while one is open
  if (message.startsWith('!')) {
    try {
      const giveawayMgr = require('./giveawayManager');
      const handled = giveawayMgr.tryAddEntry(streamer.id, tags, message);
      if (handled) return; // exclusive — keyword owned by the giveaway
    } catch (e) {
      console.error('[Giveaway] tryAddEntry error:', e.message);
      // fall through to !commands path
    }
  }

  if (!message.startsWith('!')) return;

  const commandName = message.split(' ')[0].substring(1).toLowerCase();
  // A lone "!" (or "! hello") names no command; a blank-named command saved
  // earlier would otherwise answer it.
  if (!commandName) return;
  const args = message.split(' ').slice(1);

  // Built-in commands (followage, 8ball, rps, etc.)
  const { handleBuiltinCommand } = require('./builtinCommands');
  if (await handleBuiltinCommand(replies, channel, tags, commandName, args, streamer)) return;

  // Built-in !song command
  if (commandName === 'song') {
    const songCooldownKey = `${streamerId}:song`;
    const now = Date.now();
    const lastUsed = cooldowns.get(songCooldownKey) || 0;
    if (now - lastUsed < 5000) return;
    cooldowns.set(songCooldownKey, now);

    const { getCurrentlyPlaying } = require('./spotify');
    getCurrentlyPlaying(streamer).then(result => {
      let msg;
      switch (result.status) {
        case 'playing': msg = `🎵 Now playing: ${result.track} by ${result.artist}`; break;
        case 'paused': msg = `⏸️ Paused: ${result.track} by ${result.artist}`; break;
        case 'nothing_playing': msg = `🔇 Nothing playing on Spotify right now`; break;
        case 'not_connected': msg = `Spotify not connected`; break;
        default: msg = `Could not fetch current song`;
      }
      post(channel, msg, 'high');
    }).catch(() => {});
    return;
  }

  // Custom overlay commands — DISABLED for now
  // const overlayCmd = db.getCustomOverlayByCommand(streamerId, commandName);
  // if (overlayCmd) { ... }

  const cmd = db.getChatCommand(streamerId, commandName);
  if (!cmd) return;

  const cooldownKey = `${streamerId}:${commandName}`;
  const now = Date.now();
  const lastUsed = cooldowns.get(cooldownKey) || 0;
  if (now - lastUsed < commandCooldownSeconds(cmd.cooldown) * 1000) return;

  cooldowns.set(cooldownKey, now);
  console.log(`[Chat] Sending response for !${commandName} in ${channel}`);
  post(channel, cmd.response, 'high');
}

// `promise`, or a rejection after `ms` (the timer is cleared either way).
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const chatManager = {
  connect() {
    const { twitchUsername, twitchToken } = config.bot;
    if (!twitchUsername || !twitchToken) {
      console.log('[Chat] Bot not configured (BOT_TWITCH_USERNAME / BOT_TWITCH_TOKEN not set)');
      return;
    }

    console.log(`[Chat] Connecting as ${twitchUsername}...`);

    if (dispatcher) dispatcher.clear();
    dispatcher = createChatDispatcher({
      send: (channel, line) => (client ? client.say(channel, line) : Promise.reject(new Error('Not connected'))),
      // While tmi.js is connecting or reconnecting a line cannot be sent: it would
      // be lost and still use up the rate limit, so the dispatcher holds it (up to
      // a minute) until the socket is open. This is the check say() makes itself.
      isReady: () => Boolean(client) && client.readyState() === 'OPEN',
      maxMessages: config.bot.chatMessagesPer30s,
    });

    client = new tmi.Client({
      options: { debug: false },
      connection: { reconnect: true, secure: true },
      identity: {
        username: twitchUsername,
        password: twitchToken.startsWith('oauth:') ? twitchToken : `oauth:${twitchToken}`,
      },
      channels: [],
    });

    client.on('connected', () => {
      console.log(`[Chat] Bot connected as ${twitchUsername}`);

      const streamers = db.getChatbotEnabledStreamers();
      let joinDelay = 0;
      for (const s of streamers) {
        if (s.twitch_username) {
          setTimeout(() => {
            this.joinChannel(s.id, s.twitch_username);
          }, joinDelay);
          joinDelay += 500;
        }
      }
      console.log(`[Chat] Queued ${streamers.length} channel joins`);
    });

    client.on('disconnected', (reason) => {
      console.log(`[Chat] Bot disconnected: ${reason}`);
    });

    client.on('notice', (channel, msgid, message) => {
      console.log(`[Chat] Notice in ${channel}: [${msgid}] ${message}`);
    });

    client.on('join', (channel, username, self) => {
      if (self) console.log(`[Chat] Joined ${channel}`);
    });

    client.on('part', (channel, username, self) => {
      if (self) console.log(`[Chat] Left ${channel}`);
    });

    client.on('message', handleMessage);

    client.connect().catch((err) => {
      console.error(`[Chat] Failed to connect:`, err.message);
    });
  },

  disconnect() {
    if (client) {
      client.disconnect().catch(() => {});
      client = null;
    }
    if (dispatcher) {
      dispatcher.clear();
      dispatcher = null;
    }
    channelMap.clear();
    cooldowns.clear();
  },

  joinChannel(streamerId, channel) {
    if (!client) return;
    const clean = channel.toLowerCase();
    channelMap.set(clean, streamerId);
    client.join(clean).catch((err) => {
      console.error(`[Chat] Failed to join #${clean}:`, err.message);
    });
  },

  partChannel(channel) {
    if (!client) return;
    const clean = channel.toLowerCase();
    channelMap.delete(clean);
    // Whatever still waits for this chat (the chatbot was switched off, or the
    // account was disabled) is not sent.
    if (dispatcher) dispatcher.dropChannel(clean);
    client.part(clean).catch((err) => {
      console.error(`[Chat] Failed to leave #${clean}:`, err.message);
    });
  },

  isConnected() {
    return Boolean(client) && client.readyState() === 'OPEN';
  },

  getJoinedChannels() {
    return Array.from(channelMap.keys());
  },

  // Whether the bot is a moderator in the streamer's channel, as Twitch last told it (when the bot joined the
  // channel or spoke there): true, false, or null while the bot is not in that channel.
  moderatorStatus(streamerId) {
    if (!client) return null;
    const streamer = db.getStreamerById(streamerId);
    const login = streamer && streamer.twitch_username ? streamer.twitch_username.toLowerCase() : null;
    if (!login || channelMap.get(login) !== streamerId) return null;
    const state = client.userstate && client.userstate[`#${login}`];
    if (!state) return null;
    const badges = state.badges || {};
    return state.mod === true || state.mod === '1' || state['user-type'] === 'mod'
      || Object.prototype.hasOwnProperty.call(badges, 'moderator')
      || Object.prototype.hasOwnProperty.call(badges, 'broadcaster');
  },

  // Asks Twitch again (the Chat protection card's Check again): the bot leaves the streamer's channel and
  // joins it again, which makes Twitch tell it its state there. Nothing is posted in chat. Resolves with
  // moderatorStatus(), or null when the chatbot is off or the join does not complete in time.
  async recheckModerator(streamerId, { timeoutMs = 5000 } = {}) {
    if (!client) return null;
    const streamer = db.getStreamerById(streamerId);
    if (!streamer || isStreamerDisabled(streamer) || !streamer.chatbot_enabled || !streamer.twitch_username) return null;
    const login = streamer.twitch_username.toLowerCase();
    try { await client.part(login); } catch (e) { /* the bot was not in it: it joins below */ }
    channelMap.set(login, streamerId);
    try {
      await withTimeout(client.join(login), timeoutMs);
    } catch (e) {
      console.error(`[Chat] Rejoining #${login} failed:`, e.message);
      return null;
    }
    return this.moderatorStatus(streamerId);
  },

  // An event thank-you from the streamer's template. Follows and subs that
  // arrive together share a line; a dashboard test (options.test) never does.
  sendEventMessage(streamerId, eventType, data, options = {}) {
    if (!client) return;

    const streamer = db.getStreamerById(streamerId);
    if (!streamer || isStreamerDisabled(streamer) || !streamer.chatbot_enabled || !streamer.twitch_username) return;

    const mappedType = chatTypeMap[eventType] || eventType;

    const enabledKey = `chat_${mappedType}_enabled`;
    if (!streamer[enabledKey]) return;

    const templateKey = `chat_${mappedType}_template`;
    const template = streamer[templateKey];
    if (!template) return;

    // Names and messages come from viewers: see chatTemplate.js.
    const values = data || {};
    const name = values.username;
    if (!options.test && MERGED_EVENT_TYPES.has(eventType) && typeof name === 'string' && name) {
      // Same kind and same details (tier, months, message): only the names differ.
      const details = { ...values };
      delete details.username;
      post(streamer.twitch_username, null, 'normal', {
        key: `${eventType}:${JSON.stringify(details)}`,
        name,
        // The whole line, not cut to length: the dispatcher adds a name only
        // when the line with it still fits, and a cut line would lose the name
        // and the template's ending while looking short enough.
        render: (names) => fillChatTemplate(template, { ...values, username: names }, { maxLength: Infinity }),
      });
      return;
    }
    post(streamer.twitch_username, fillChatTemplate(template, values), 'normal');
  },

  // Real raids only (EventSub). It is separate from sendEventMessage because the
  // dashboard's test alerts call that, and must never change chat settings; it
  // also no longer depends on the raid thank-you message being enabled.
  startRaidProtection(streamerId) {
    if (!client) return;
    const streamer = db.getStreamerById(streamerId);
    if (!streamer || isStreamerDisabled(streamer) || !streamer.chatbot_enabled || !streamer.twitch_username) return;
    activateRaidProtection(replies, streamer.twitch_username, streamer).catch((err) => {
      console.error(`[Mod] Raid protection failed for streamer ${streamerId}:`, err.message);
    });
  },

  // Any other line for a streamer's chat: giveaway and redemption messages
  // ('normal', the default), sponsor and timed messages ('low'), the dashboard's
  // custom-command test ('high'). Nothing is posted for a streamer whose chatbot
  // is switched off, or whose account is disabled.
  sendMessage(streamerId, text, { priority = 'normal' } = {}) {
    if (!client) return;
    const streamer = db.getStreamerById(streamerId);
    if (!streamer || isStreamerDisabled(streamer) || !streamer.chatbot_enabled || !streamer.twitch_username) return;
    post(streamer.twitch_username, text, priority);
  },

  // Backward-compatible aliases
  startAll() { this.connect(); },
  startForStreamer(streamerId) {
    const streamer = db.getStreamerById(streamerId);
    if (streamer && streamer.twitch_username && !isStreamerDisabled(streamer)) {
      this.joinChannel(streamerId, streamer.twitch_username);
    }
  },
  stopForStreamer(streamerId) {
    const streamer = db.getStreamerById(streamerId);
    if (streamer && streamer.twitch_username) {
      this.partChannel(streamer.twitch_username);
    }
  },
  stopAll() { this.disconnect(); },
};

module.exports = { chatManager };
