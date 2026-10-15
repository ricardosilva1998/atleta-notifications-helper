'use strict';

// The Shoutouts card: `!so @name` typed by the broadcaster or a moderator, and a shoutout for the raider after a raid
// of at least the streamer's minimum. The bot posts the streamer's text with the person's display name, last game,
// title and link (Twitch's Get Users and Get Channel Information with the app token; each name's answer is kept 10
// minutes). The same person gets at most one shoutout a minute per channel; an unknown name posts nothing (logged).
// `!so` posts at command priority and the raid shoutout at normal priority, through the chat dispatcher, which posts
// nothing while the streamer's chatbot is off.

const { normalizeTwitchLogin } = require('./twitchLogin');
const { fillChatTemplate } = require('./chatTemplate');

const COOLDOWN_MS = 60 * 1000;
const NAME_KEPT_MS = 10 * 60 * 1000;
const SWEEP_EVERY_MS = 10 * 60 * 1000;
// The card's "from N viewers" choices (dashboardSettings.js accepts only these).
const RAID_MIN_VIEWERS = Object.freeze([1, 2, 5, 10, 25, 50, 100]);

// Whether a chat message is a `!so` this streamer's bot acts on: the switch on, from the broadcaster or a moderator
// (by their badges). Anything else goes on to the other commands, so a custom !so keeps answering everyone else.
function isShoutoutCommand(streamer, tags, message) {
  if (!streamer || !streamer.shoutout_command_enabled || !tags) return false;
  const badges = tags.badges || {};
  if (!(tags.mod || badges.broadcaster || badges.moderator)) return false;
  return /^!so(\s|$)/i.test(String(message || '').trim());
}

// The streamer's text for one channel ({ login, name, game, title }); '' when it posts nothing.
function shoutoutLine(template, channel) {
  return fillChatTemplate(template, {
    name: channel.name, game: channel.game, title: channel.title, link: `https://twitch.tv/${channel.login}`,
  });
}

function createShoutouts({ lookup, send, getStreamer, log = console.warn, now = Date.now }) {
  const names = new Map(); // login → { at, channel } (channel null: Twitch has no such channel)
  const shoutedAt = new Map(); // `${streamerId}:${login}` → when its shoutout was posted (or started)

  async function channelFor(login) {
    const kept = names.get(login);
    if (kept && now() - kept.at < NAME_KEPT_MS) return kept.channel;
    const channel = (await lookup(login)) || null;
    names.set(login, { at: now(), channel });
    return channel;
  }

  // A test skips the one-a-minute rule and does not count toward it.
  async function shout(streamer, login, priority, { isTest = false } = {}) {
    const key = `${streamer.id}:${login}`;
    if (!isTest) {
      const last = shoutedAt.get(key);
      if (last !== undefined && now() - last < COOLDOWN_MS) return 'cooldown';
      shoutedAt.set(key, now()); // taken before the lookup, so a second !so meanwhile is refused too
    }
    let channel;
    try {
      channel = await channelFor(login);
    } catch (err) {
      if (!isTest) shoutedAt.delete(key);
      log(`[Shoutout] Twitch did not answer for "${login}" (streamer ${streamer.id}): ${err.message}`);
      return 'failed';
    }
    if (!channel) {
      if (!isTest) shoutedAt.delete(key);
      log(`[Shoutout] Twitch has no channel "${login}" (streamer ${streamer.id})`);
      return 'unknown';
    }
    const text = shoutoutLine(streamer.shoutout_template, channel);
    if (!text) return 'empty';
    send(streamer.id, text, priority);
    return 'sent';
  }

  // A `!so` that isShoutoutCommand let through: the first word after it names the channel.
  async function fromCommand(streamer, message) {
    const login = normalizeTwitchLogin(String(message || '').trim().split(/\s+/)[1] || '');
    if (!login) return 'no_name';
    return shout(streamer, login, 'high');
  }

  // EventSub's raid ({ login, viewers, … }): a shoutout for the raider when the streamer has it on and the raid
  // brought at least their minimum of viewers.
  async function afterRaid(streamerId, raid) {
    const streamer = getStreamer(streamerId);
    if (!streamer || !streamer.shoutout_raid_enabled) return 'off';
    const minimum = Number(streamer.shoutout_raid_min_viewers) || 1;
    if (!(Number(raid && raid.viewers) >= minimum)) return 'small';
    const login = normalizeTwitchLogin((raid && raid.login) || '');
    if (!login) return 'no_name';
    return shout(streamer, login, 'normal');
  }

  // The card's Test in chat: a shoutout for the streamer's own channel.
  async function testInChat(streamer) {
    const login = normalizeTwitchLogin(streamer.twitch_username || '');
    if (!login) return 'unknown';
    return shout(streamer, login, 'high', { isTest: true });
  }

  function sweep() {
    const t = now();
    for (const [login, kept] of names) if (t - kept.at >= NAME_KEPT_MS) names.delete(login);
    for (const [key, at] of shoutedAt) if (t - at >= COOLDOWN_MS) shoutedAt.delete(key);
  }

  return {
    fromCommand, afterRaid, testInChat, sweep,
    get size() { return { names: names.size, shoutouts: shoutedAt.size }; },
  };
}

// The app's instance. Twitch, the chat bot and the database are required when first used: they load the app's
// config, which this file's unit tests do without.
const shoutouts = createShoutouts({
  lookup: async (login) => {
    const twitch = require('./twitch');
    const user = await twitch.getUserProfile(login);
    if (!user) return null;
    const info = await twitch.getChannelInfo(user.id);
    return { login: user.login, name: user.display_name || user.login, game: (info && info.gameName) || '', title: (info && info.title) || '' };
  },
  send: (streamerId, text, priority) => require('./twitchChat').chatManager.sendMessage(streamerId, text, { priority }),
  getStreamer: (streamerId) => require('../db').getStreamerById(streamerId),
});
setInterval(() => shoutouts.sweep(), SWEEP_EVERY_MS).unref();

module.exports = { createShoutouts, shoutouts, isShoutoutCommand, shoutoutLine, RAID_MIN_VIEWERS, COOLDOWN_MS };
