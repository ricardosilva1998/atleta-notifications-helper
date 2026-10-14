'use strict';

const db = require('../db');
const config = require('../config');
const { compileBannedWord, limitMessage, limitRegexInput } = require('./safePattern');
const { containsLink, capsPercent, symbolPercent } = require('./chatFilters');
const { createRegexBudget } = require('./regexBudget');

// ─── In-memory state ──────────────────────────────────────────────────────────
// All keyed by `${channel}:${username}`. They grow forever in a long-lived
// process unless we sweep — see the periodic cleanup below.
const permits = new Map();          // value: expiry timestamp
const lastMessages = new Map();     // value: { text, timestamp }
const offenseCounts = new Map();    // value: { count, lastAt }
const followCache = new Map();      // value: { age, fetchedAt }
const raidProtectionTimers = new Map();
// Compiled banned-word matchers keyed by `${is_regex}:${word}`, so each word is
// validated and compiled once instead of on every chat message. The key is the
// word itself, so an edited or deleted word can never reuse a stale matcher; it
// just stops being looked up and is swept.
const bannedWordMatchers = new Map(); // value: { regex, literal, usedAt }
const chatSettingsWarnedAt = new Map(); // streamerId -> when a missing-scope warning was logged
const followCheckWarnedAt = new Map(); // streamerId -> when a failed follow-age check was logged
// Per-streamer regex matching time; over budget, regex words match as text.
const regexBudget = createRegexBudget();

// Sweep stale entries once a minute. Caps:
//  - lastMessages: keep 5 min (only used for repetition window which defaults 30s)
//  - permits:      drop expired
//  - followCache:  keep 10 min (acts as a cache, not state)
//  - offenseCounts: keep 24 h (escalation ladder must remember through a stream)
//  - bannedWordMatchers: keep 10 min after last use
//  - chatSettingsWarnedAt: keep 24 h, so the warning repeats at most once a day
//  - followCheckWarnedAt: keep 1 h, so a failing follow check is logged once an hour
//  - regexBudget: drop idle streamers, end trips whose hour is over
const FIVE_MIN = 5 * 60 * 1000;
const TEN_MIN = 10 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of lastMessages) {
    if (now - (v?.timestamp || 0) > FIVE_MIN) lastMessages.delete(k);
  }
  for (const [k, expiry] of permits) {
    if (now >= expiry) permits.delete(k);
  }
  for (const [k, v] of followCache) {
    if (now - (v?.cachedAt || 0) > TEN_MIN) followCache.delete(k);
  }
  for (const [k, v] of offenseCounts) {
    if (now - (v?.lastOffense || 0) > ONE_DAY) offenseCounts.delete(k);
  }
  for (const [k, v] of bannedWordMatchers) {
    if (now - v.usedAt > TEN_MIN) bannedWordMatchers.delete(k);
  }
  for (const [k, warnedAt] of chatSettingsWarnedAt) {
    if (now - warnedAt > ONE_DAY) chatSettingsWarnedAt.delete(k);
  }
  for (const [k, warnedAt] of followCheckWarnedAt) {
    if (now - warnedAt >= ONE_HOUR) followCheckWarnedAt.delete(k);
  }
  regexBudget.sweep();
}, 60 * 1000).unref?.();

// ─── Check if user is exempt from moderation ─────────────────────────────────
function isExempt(tags, streamer) {
  if (tags.mod || tags.badges?.broadcaster) return true;
  if (streamer.mod_exempt_vips && tags.badges?.vip) return true;
  if (streamer.mod_exempt_subs && tags.subscriber) return true;
  return false;
}

// ─── Filter functions ─────────────────────────────────────────────────────────

function bannedWordMatcher(row) {
  const key = `${row.is_regex ? 1 : 0}:${row.word}`;
  let entry = bannedWordMatchers.get(key);
  if (!entry) {
    entry = { ...compileBannedWord(row.word, !!row.is_regex), usedAt: 0 };
    // V8 runs a new regex in its bytecode interpreter the first time and only
    // compiles it to native code for the next use, so that first run can be
    // dozens of times slower. Spend it here, on an empty string, instead of on
    // the first real chat message.
    if (entry.regex) entry.regex.test('');
    bannedWordMatchers.set(key, entry);
  }
  entry.usedAt = Date.now();
  return entry;
}

// Never name the word: the reason is posted in chat by the shared bot account
// and also goes to the mod log and the Discord log.
function bannedWordViolation(row) {
  return { violated: true, reason: row.is_regex ? 'Banned pattern' : 'Banned word' };
}

// Runs on the shared event loop for every chat message. Regex words only run if
// they passed validateBannedPattern() (see safePattern.js), only see the first
// 500 UTF-16 code units, and are timed against the streamer's regex budget:
// while it is spent they are matched as plain text, like plain words, which see
// the first 500 characters.
function checkBannedWords(message, streamerId) {
  const words = db.getBannedWords(streamerId);
  if (!words.length) return null;
  const matchers = words.map((row) => ({ row, matcher: bannedWordMatcher(row) }));
  const regexOn = regexBudget.allows(streamerId);

  const text = limitMessage(message);
  for (const { row, matcher } of matchers) {
    if ((!matcher.regex || !regexOn) && matcher.literal(text)) return bannedWordViolation(row);
  }
  if (!regexOn || !matchers.some(({ matcher }) => matcher.regex)) return null;

  const regexText = limitRegexInput(message);
  const start = regexBudget.now();
  try {
    for (const { row, matcher } of matchers) {
      if (matcher.regex && matcher.regex.test(regexText)) return bannedWordViolation(row);
    }
    return null;
  } finally {
    const end = regexBudget.now();
    regexBudget.record(streamerId, end - start, end);
  }
}

function checkLinks(message, channel, username, streamer) {
  if (!containsLink(message)) return null;
  const key = `${channel}:${username.toLowerCase()}`;
  const permitExpiry = permits.get(key);
  if (permitExpiry && Date.now() < permitExpiry) {
    permits.delete(key);
    return null;
  }
  return { violated: true, reason: 'Link posted without permission' };
}

function checkCaps(message, tags, streamer) {
  if (message.length < streamer.mod_caps_min_length) return null;
  const percent = capsPercent(message, tags.emotes);
  if (percent !== null && percent > streamer.mod_caps_max_percent) {
    return { violated: true, reason: `Excessive caps (${percent}%)` };
  }
  return null;
}

function checkEmoteSpam(message, tags, streamer) {
  let count = 0;
  if (tags.emotes) {
    for (const emoteId in tags.emotes) {
      count += tags.emotes[emoteId].length;
    }
  }
  if (count > streamer.mod_emote_max_count) {
    return { violated: true, reason: `Emote spam (${count} emotes)` };
  }
  return null;
}

function checkRepetition(message, channel, username, streamer) {
  const key = `${channel}:${username.toLowerCase()}`;
  const now = Date.now();
  const last = lastMessages.get(key);
  lastMessages.set(key, { text: message.toLowerCase().trim(), timestamp: now });
  if (!last) return null;
  const windowMs = (streamer.mod_repetition_window || 30) * 1000;
  if (now - last.timestamp < windowMs && message.toLowerCase().trim() === last.text) {
    return { violated: true, reason: 'Repeated message' };
  }
  return null;
}

function checkSymbolSpam(message, streamer) {
  const percent = symbolPercent(message);
  if (percent !== null && percent > streamer.mod_symbol_max_percent) {
    return { violated: true, reason: `Symbol spam (${percent}%)` };
  }
  return null;
}

// Twitch is asked with the streamer's own token (twitch.getFollowAge). When it
// cannot answer, the message goes through: an error is not "not following".
async function checkFollowAge(channel, tags, streamer) {
  const username = tags.username;
  const key = `${channel}:${username.toLowerCase()}`;
  const now = Date.now();
  const cached = followCache.get(key);
  if (cached && now - cached.cachedAt < 5 * 60 * 1000) {
    if (!cached.following) {
      return { violated: true, reason: 'Not following the channel' };
    }
    const ageMinutes = (now - new Date(cached.followedAt).getTime()) / 60000;
    if (ageMinutes < streamer.mod_follow_age_minutes) {
      return { violated: true, reason: `Follow age too short (${Math.round(ageMinutes)}min < ${streamer.mod_follow_age_minutes}min)` };
    }
    return null;
  }
  try {
    const { getFollowAge } = require('./twitch');
    const result = await getFollowAge(streamer, tags['user-id']);
    followCache.set(key, { following: result.following, followedAt: result.followedAt, cachedAt: now });
    if (!result.following) {
      return { violated: true, reason: 'Not following the channel' };
    }
    const ageMinutes = (now - new Date(result.followedAt).getTime()) / 60000;
    if (ageMinutes < streamer.mod_follow_age_minutes) {
      return { violated: true, reason: `Follow age too short (${Math.round(ageMinutes)}min)` };
    }
  } catch (e) {
    noteFollowCheckFailed(streamer, e);
    return null;
  }
  return null;
}

// A streamer whose token cannot read followers would otherwise log on every message.
function noteFollowCheckFailed(streamer, err) {
  const now = Date.now();
  const warnedAt = followCheckWarnedAt.get(streamer.id);
  if (warnedAt !== undefined && now - warnedAt < ONE_HOUR) return;
  followCheckWarnedAt.set(streamer.id, now);
  console.warn(`[Mod] Follow-age check failed for streamer ${streamer.id}; messages go through until it works: ${err.message}`);
}

function checkFirstTimeChatter(tags) {
  if (tags['first-msg']) {
    return { flagOnly: true, reason: `First-time chatter: ${tags['display-name'] || tags.username}` };
  }
  return null;
}

// ─── Run the other filters ────────────────────────────────────────────────────
// Banned words are not checked here: the chat handler (twitchChat.js) checks
// them first for everyone but mods and the broadcaster, and testing the list a
// second time on every message only doubled the cost.
async function runFilters(channel, tags, message, streamer) {
  const username = tags.username;

  if (streamer.mod_link_protection_enabled) {
    const r = checkLinks(message, channel, username, streamer);
    if (r) return r;
  }
  if (streamer.mod_caps_enabled) {
    const r = checkCaps(message, tags, streamer);
    if (r) return r;
  }
  if (streamer.mod_emote_spam_enabled) {
    const r = checkEmoteSpam(message, tags, streamer);
    if (r) return r;
  }
  if (streamer.mod_repetition_enabled) {
    const r = checkRepetition(message, channel, username, streamer);
    if (r) return r;
  }
  if (streamer.mod_symbol_spam_enabled) {
    const r = checkSymbolSpam(message, streamer);
    if (r) return r;
  }
  if (streamer.mod_follow_age_enabled) {
    const r = await checkFollowAge(channel, tags, streamer);
    if (r) return r;
  }
  if (streamer.mod_first_chatter_enabled) {
    const r = checkFirstTimeChatter(tags);
    if (r) return r;
  }
  return null;
}

// ─── Determine action based on escalation ─────────────────────────────────────
function getAction(channel, username, streamer) {
  if (!streamer.mod_escalation_enabled) {
    return streamer.mod_action_response || 'delete';
  }
  const key = `${channel}:${username.toLowerCase()}`;
  const now = Date.now();
  const record = offenseCounts.get(key) || { count: 0, lastOffense: 0 };
  if (now - record.lastOffense > 24 * 60 * 60 * 1000) {
    record.count = 0;
  }
  record.count++;
  record.lastOffense = now;
  offenseCounts.set(key, record);

  switch (record.count) {
    case 1: return 'warn';
    case 2: return 'timeout_10';
    case 3: return 'timeout_600';
    default: return 'timeout_1800';
  }
}

// ─── Helix API helpers for moderation ─────────────────────────────────────────
let botUserId = null;
let botClientId = null;

async function getBotUserId() {
  if (botUserId) return botUserId;
  const token = config.bot.twitchToken.replace(/^oauth:/, '');
  try {
    // Use validate endpoint — works regardless of Client-ID
    const res = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { 'Authorization': `OAuth ${token}` }
    });
    const data = await res.json();
    if (data.user_id) {
      botUserId = data.user_id;
      botClientId = data.client_id;
      console.log(`[Mod] Bot user ID resolved: ${botUserId} (${data.login}), client_id: ${botClientId}, scopes: ${data.scopes?.join(', ')}`);
    } else {
      console.error('[Mod] Failed to validate bot token:', JSON.stringify(data));
    }
  } catch (e) {
    console.error('[Mod] Failed to get bot user ID:', e.message);
  }
  return botUserId;
}

async function helixDeleteMessage(broadcasterId, messageId) {
  const modId = await getBotUserId();
  if (!modId) { console.error('[Mod] No bot user ID, cannot delete'); return; }
  const token = config.bot.twitchToken.replace(/^oauth:/, '');
  const clientId = botClientId || config.twitch.clientId;
  const url = `https://api.twitch.tv/helix/moderation/chat?broadcaster_id=${broadcasterId}&moderator_id=${modId}&message_id=${messageId}`;
  console.log(`[Mod] Helix DELETE message_id=${messageId} broadcaster_id=${broadcasterId} moderator_id=${modId} client_id=${clientId}`);
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[Mod] Helix delete failed (${res.status}):`, body);
  } else {
    console.log(`[Mod] Message deleted successfully`);
  }
}

async function helixBanUser(broadcasterId, userId, duration, reason) {
  const modId = await getBotUserId();
  if (!modId) return;
  const token = config.bot.twitchToken.replace(/^oauth:/, '');
  const body = { data: { user_id: userId, reason: reason || '' } };
  if (duration) body.data.duration = duration;
  const clientId = botClientId || config.twitch.clientId;
  const res = await fetch(`https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${modId}`, {
    method: 'POST',
    headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[Mod] Helix ban/timeout failed (${res.status}):`, text);
  }
}

// Twitch removed the IRC /slow and /followers commands in 2023, so chat settings
// go through Helix. That needs the moderator:manage:chat_settings scope on
// BOT_TWITCH_TOKEN and the bot to be a moderator in the channel.
const HELIX_TIMEOUT_MS = 10_000;

// Returns true only when Twitch accepted the change (2xx).
async function updateChatSettings(channel, streamer, settings) {
  const broadcasterId = await resolveBroadcasterId(channel, streamer);
  const moderatorId = await getBotUserId();
  if (!broadcasterId || !moderatorId) {
    console.error(`[Mod] Cannot change chat settings in ${channel}: no broadcaster or bot user ID`);
    return false;
  }
  const token = config.bot.twitchToken.replace(/^oauth:/, '');
  const params = new URLSearchParams({ broadcaster_id: broadcasterId, moderator_id: moderatorId });
  let res;
  try {
    res = await fetch(`https://api.twitch.tv/helix/chat/settings?${params}`, {
      method: 'PATCH',
      headers: {
        'Client-ID': botClientId || config.twitch.clientId,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(settings),
      signal: AbortSignal.timeout(HELIX_TIMEOUT_MS),
    });
  } catch (e) {
    console.error(`[Mod] Chat settings update failed in ${channel}:`, e.message);
    return false;
  }
  if (res.ok) {
    chatSettingsWarnedAt.delete(streamer.id);
    return true;
  }
  const body = (await res.text().catch(() => '')).slice(0, 300);
  if (res.status === 401 || res.status === 403) {
    // Expected until the token is regenerated, so say it once per streamer a day.
    if (!chatSettingsWarnedAt.has(streamer.id)) {
      chatSettingsWarnedAt.set(streamer.id, Date.now());
      console.warn(`[Mod] Twitch refused a chat settings change in ${channel} (${res.status}): BOT_TWITCH_TOKEN needs the moderator:manage:chat_settings scope and the bot must be a moderator there. ${body}`);
    }
  } else {
    console.error(`[Mod] Chat settings update failed in ${channel} (${res.status}):`, body);
  }
  return false;
}

// ─── Resolve broadcaster ID ───────────────────────────────────────────────────
const broadcasterIdCache = new Map();

async function resolveBroadcasterId(channel, streamer) {
  if (streamer.twitch_user_id) return streamer.twitch_user_id;
  const clean = channel.replace(/^#/, '').toLowerCase();
  if (broadcasterIdCache.has(clean)) return broadcasterIdCache.get(clean);
  try {
    const { getUserId } = require('./twitch');
    const id = await getUserId(clean);
    if (id) {
      broadcasterIdCache.set(clean, id);
      console.log(`[Mod] Resolved broadcaster ID for ${clean}: ${id}`);
    }
    return id;
  } catch (e) {
    console.error(`[Mod] Failed to resolve broadcaster ID for ${clean}:`, e.message);
    return null;
  }
}

// ─── Execute moderation action ────────────────────────────────────────────────
async function executeAction(client, channel, tags, action, reason, streamer) {
  const username = tags.username;
  const broadcasterId = await resolveBroadcasterId(channel, streamer);
  const userId = tags['user-id'];

  if (!broadcasterId) {
    console.error(`[Mod] Cannot execute ${action}: no broadcaster ID for ${channel}`);
    return;
  }

  try {
    switch (action) {
      case 'warn':
        if (broadcasterId && tags.id) await helixDeleteMessage(broadcasterId, tags.id).catch(e => console.error('[Mod]', e.message));
        await client.say(channel, `@${username}, warning: ${reason}`).catch(() => {});
        break;
      case 'delete':
        if (broadcasterId && tags.id) await helixDeleteMessage(broadcasterId, tags.id).catch(e => console.error('[Mod]', e.message));
        break;
      case 'timeout_10':
        if (broadcasterId && userId) await helixBanUser(broadcasterId, userId, 10, reason).catch(e => console.error('[Mod]', e.message));
        break;
      case 'timeout_60':
        if (broadcasterId && userId) await helixBanUser(broadcasterId, userId, 60, reason).catch(e => console.error('[Mod]', e.message));
        break;
      case 'timeout_600':
        if (broadcasterId && userId) await helixBanUser(broadcasterId, userId, 600, reason).catch(e => console.error('[Mod]', e.message));
        break;
      case 'timeout_1800':
        if (broadcasterId && userId) await helixBanUser(broadcasterId, userId, 1800, reason).catch(e => console.error('[Mod]', e.message));
        break;
    }
    console.log(`[Mod] Executed ${action} on ${username} in ${channel} for: ${reason}`);
    // Save to DB log
    try {
      db.addModLogEntry(streamer.id, username, userId, action, reason, null);
    } catch (e) {
      console.error('[Mod] Failed to save mod log:', e.message);
    }
  } catch (e) {
    console.error(`[Mod] Failed to execute ${action} on ${username}:`, e.message);
  }

  if (streamer.mod_log_discord_enabled && streamer.mod_log_discord_channel_id) {
    logToDiscord(streamer, username, reason, action);
  }
}

// ─── Discord mod log ──────────────────────────────────────────────────────────
// Posted only into a channel of one of the streamer's claimed servers.
function logToDiscord(streamer, username, reason, action) {
  try {
    const { streamerGuildForChannel, sendToGuildChannel } = require('../discord');
    const channelId = streamer.mod_log_discord_channel_id;
    const guildId = streamerGuildForChannel(streamer.id, channelId);
    if (!guildId) return;
    const actionLabels = {
      warn: 'Warning (message deleted)',
      delete: 'Message deleted',
      timeout_10: 'Timeout 10s',
      timeout_60: 'Timeout 60s',
      timeout_600: 'Timeout 10min',
      timeout_1800: 'Timeout 30min',
    };
    sendToGuildChannel(guildId, streamer.id, channelId, {
      embeds: [{
        title: 'Moderation Action',
        color: 0xff4444,
        fields: [
          { name: 'User', value: username, inline: true },
          { name: 'Action', value: actionLabels[action] || action, inline: true },
          { name: 'Reason', value: reason, inline: false },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: `Channel: ${streamer.twitch_username}` },
      }],
    }).catch(() => {});
  } catch (e) {}
}

// ─── Permit system ────────────────────────────────────────────────────────────
function grantPermit(channel, username, durationSeconds) {
  const key = `${channel}:${username.toLowerCase()}`;
  permits.set(key, Date.now() + durationSeconds * 1000);
}

// parseInt with the "|| default" fallback the settings always had, then clamped.
function clampInt(value, min, max, fallback) {
  return Math.min(max, Math.max(min, parseInt(value, 10) || fallback));
}

// ─── Mod-only chat commands ───────────────────────────────────────────────────
// !permit <user>, plus !slow [seconds] and !slowoff when the streamer turned on
// the Slow Mode Command. Returns true when the message was one of them.
async function handleModCommand(client, channel, tags, message, streamer) {
  if (!message.startsWith('!') || !(tags.mod || tags.badges?.broadcaster)) return false;
  const parts = message.split(' ');
  const command = parts[0].substring(1).toLowerCase();

  if (command === 'permit' && parts[1]) {
    const target = parts[1].replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{1,25}$/.test(target)) return true; // not a Twitch login
    // The dashboard's "Permit duration" setting (10-600 s).
    const seconds = clampInt(streamer.mod_link_permit_seconds, 10, 600, 60);
    grantPermit(channel, target, seconds);
    client.say(channel, `@${target} has been permitted to post a link for ${seconds} seconds.`).catch(() => {});
    return true;
  }

  if ((command === 'slow' || command === 'slowoff') && streamer.mod_slow_mode_cmd_enabled) {
    if (command === 'slow') {
      const seconds = clampInt(parts[1], 3, 120, 30); // the range Helix accepts
      if (await updateChatSettings(channel, streamer, { slow_mode: true, slow_mode_wait_time: seconds })) {
        client.say(channel, `Slow mode enabled (${seconds}s).`).catch(() => {});
      }
    } else if (await updateChatSettings(channel, streamer, { slow_mode: false })) {
      client.say(channel, 'Slow mode disabled.').catch(() => {});
    }
    return true;
  }

  return false;
}

// ─── Raid protection ──────────────────────────────────────────────────────────
// After a real raid: followers-only mode (10-minute follow age, as before) for
// the configured time. Nothing is announced unless Twitch accepted the change.
const RAID_FOLLOWER_MINUTES = 10;

async function activateRaidProtection(client, channel, streamer) {
  if (!streamer.mod_raid_protection_enabled) return;
  const seconds = clampInt(streamer.mod_raid_protection_duration, 30, 600, 120);
  const key = channel.replace(/^#/, '').toLowerCase();

  const enabled = await updateChatSettings(channel, streamer, {
    follower_mode: true,
    follower_mode_duration: RAID_FOLLOWER_MINUTES,
  });
  if (!enabled) return;

  // Only replace the switch-off timer once followers-only mode is on, so a
  // failed request can never cancel the end of an earlier raid's protection.
  clearTimeout(raidProtectionTimers.get(key));
  client.say(channel, `Raid protection activated for ${seconds} seconds. Followers-only mode enabled.`).catch(() => {});
  const timer = setTimeout(async () => {
    raidProtectionTimers.delete(key);
    if (await updateChatSettings(channel, streamer, { follower_mode: false })) {
      client.say(channel, 'Raid protection ended. Followers-only mode disabled.').catch(() => {});
    }
  }, seconds * 1000);
  timer.unref?.();
  raidProtectionTimers.set(key, timer);
}

module.exports = {
  isExempt,
  checkBannedWords,
  runFilters,
  getAction,
  executeAction,
  grantPermit,
  handleModCommand,
  activateRaidProtection,
};
