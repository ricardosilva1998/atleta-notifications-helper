# Chatbot Moderation System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-feature toggleable moderation system to the Twitch chatbot with message filtering, user management, raid protection, escalation, and Discord logging.

**Architecture:** Settings stored as columns on `streamers` table (matching existing patterns). Banned words in a separate table. Filter logic in a new `src/services/chatModeration.js` module. In-memory state for permits, repetition tracking, escalation counts. New "Moderation" tab on chatbot config page.

**Tech Stack:** Node.js, tmi.js (moderation methods), better-sqlite3, EJS, discord.js

---

### Task 1: Database Migration — Add moderation columns and banned_words table

**Files:**
- Modify: `src/db.js`

- [ ] **Step 1: Add moderation columns migration**

In `src/db.js`, after the last migration block that checks `cols.includes(...)`, add:

```javascript
if (!cols.includes('mod_banned_words_enabled')) {
  db.exec(`
    ALTER TABLE streamers ADD COLUMN mod_banned_words_enabled INTEGER DEFAULT 0;
    ALTER TABLE streamers ADD COLUMN mod_link_protection_enabled INTEGER DEFAULT 0;
    ALTER TABLE streamers ADD COLUMN mod_link_permit_seconds INTEGER DEFAULT 60;
    ALTER TABLE streamers ADD COLUMN mod_caps_enabled INTEGER DEFAULT 0;
    ALTER TABLE streamers ADD COLUMN mod_caps_min_length INTEGER DEFAULT 10;
    ALTER TABLE streamers ADD COLUMN mod_caps_max_percent INTEGER DEFAULT 70;
    ALTER TABLE streamers ADD COLUMN mod_emote_spam_enabled INTEGER DEFAULT 0;
    ALTER TABLE streamers ADD COLUMN mod_emote_max_count INTEGER DEFAULT 15;
    ALTER TABLE streamers ADD COLUMN mod_repetition_enabled INTEGER DEFAULT 0;
    ALTER TABLE streamers ADD COLUMN mod_repetition_window INTEGER DEFAULT 30;
    ALTER TABLE streamers ADD COLUMN mod_symbol_spam_enabled INTEGER DEFAULT 0;
    ALTER TABLE streamers ADD COLUMN mod_symbol_max_percent INTEGER DEFAULT 50;
    ALTER TABLE streamers ADD COLUMN mod_slow_mode_cmd_enabled INTEGER DEFAULT 0;
    ALTER TABLE streamers ADD COLUMN mod_raid_protection_enabled INTEGER DEFAULT 0;
    ALTER TABLE streamers ADD COLUMN mod_raid_protection_duration INTEGER DEFAULT 120;
    ALTER TABLE streamers ADD COLUMN mod_first_chatter_enabled INTEGER DEFAULT 0;
    ALTER TABLE streamers ADD COLUMN mod_follow_age_enabled INTEGER DEFAULT 0;
    ALTER TABLE streamers ADD COLUMN mod_follow_age_minutes INTEGER DEFAULT 10;
    ALTER TABLE streamers ADD COLUMN mod_action_response TEXT DEFAULT 'delete';
    ALTER TABLE streamers ADD COLUMN mod_escalation_enabled INTEGER DEFAULT 0;
    ALTER TABLE streamers ADD COLUMN mod_log_discord_enabled INTEGER DEFAULT 0;
    ALTER TABLE streamers ADD COLUMN mod_log_discord_channel_id TEXT;
    ALTER TABLE streamers ADD COLUMN mod_exempt_subs INTEGER DEFAULT 1;
    ALTER TABLE streamers ADD COLUMN mod_exempt_vips INTEGER DEFAULT 1;
  `);
  console.log('[DB] Added moderation columns to streamers');
}
```

- [ ] **Step 2: Add banned_words table**

Right after the migration above, add:

```javascript
db.exec(`
  CREATE TABLE IF NOT EXISTS banned_words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    streamer_id INTEGER NOT NULL,
    word TEXT NOT NULL,
    is_regex INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_banned_words_streamer ON banned_words(streamer_id)`);
```

- [ ] **Step 3: Add MODERATION_COLUMNS set and updateModerationConfig function**

Add near the existing `CHATBOT_COLUMNS` set and `updateChatbotConfig` function:

```javascript
const MODERATION_COLUMNS = new Set([
  'mod_banned_words_enabled', 'mod_link_protection_enabled', 'mod_link_permit_seconds',
  'mod_caps_enabled', 'mod_caps_min_length', 'mod_caps_max_percent',
  'mod_emote_spam_enabled', 'mod_emote_max_count',
  'mod_repetition_enabled', 'mod_repetition_window',
  'mod_symbol_spam_enabled', 'mod_symbol_max_percent',
  'mod_slow_mode_cmd_enabled',
  'mod_raid_protection_enabled', 'mod_raid_protection_duration',
  'mod_first_chatter_enabled',
  'mod_follow_age_enabled', 'mod_follow_age_minutes',
  'mod_action_response', 'mod_escalation_enabled',
  'mod_log_discord_enabled', 'mod_log_discord_channel_id',
  'mod_exempt_subs', 'mod_exempt_vips',
]);

function updateModerationConfig(streamerId, config) {
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(config)) {
    if (!MODERATION_COLUMNS.has(key)) continue;
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (fields.length === 0) return;
  values.push(streamerId);
  db.prepare(`UPDATE streamers SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}
```

- [ ] **Step 4: Add banned_words query functions**

```javascript
function getBannedWords(streamerId) {
  return db.prepare('SELECT * FROM banned_words WHERE streamer_id = ? ORDER BY created_at DESC').all(streamerId);
}

function addBannedWord(streamerId, word, isRegex) {
  return db.prepare('INSERT INTO banned_words (streamer_id, word, is_regex) VALUES (?, ?, ?)').run(streamerId, word, isRegex ? 1 : 0);
}

function deleteBannedWord(streamerId, id) {
  return db.prepare('DELETE FROM banned_words WHERE id = ? AND streamer_id = ?').run(id, streamerId);
}
```

- [ ] **Step 5: Add new functions to module.exports**

Add to the `module.exports` object:

```javascript
  updateModerationConfig,
  getBannedWords,
  addBannedWord,
  deleteBannedWord,
```

- [ ] **Step 6: Commit**

```bash
git add src/db.js
git commit -m "feat: add moderation DB schema — columns, banned_words table, query functions"
```

---

### Task 2: Chat Moderation Filter Module

**Files:**
- Create: `src/services/chatModeration.js`

- [ ] **Step 1: Create the moderation module with in-memory state and all filter functions**

Create `src/services/chatModeration.js`:

```javascript
'use strict';

const db = require('../db');

// ─── In-memory state ──────────────────────────────────────────────────────────
const permits = new Map();       // "channel:username" → expiry timestamp
const lastMessages = new Map();  // "channel:username" → { text, timestamp }
const offenseCounts = new Map(); // "channel:username" → { count, lastOffense }
const followCache = new Map();   // "channel:username" → { following, followedAt, cachedAt }
const raidProtectionTimers = new Map(); // "channel" → timeoutId

// ─── URL detection regex ──────────────────────────────────────────────────────
const URL_REGEX = /(?:https?:\/\/|www\.)\S+|[\w-]+\.(?:com|net|org|io|gg|tv|co|me|info|xyz|live)\b/i;

// ─── Check if user is exempt from moderation ─────────────────────────────────
function isExempt(tags, streamer) {
  // Mods and broadcaster always exempt
  if (tags.mod || tags.badges?.broadcaster) return true;
  // VIP exemption
  if (streamer.mod_exempt_vips && tags.badges?.vip) return true;
  // Subscriber exemption
  if (streamer.mod_exempt_subs && tags.subscriber) return true;
  return false;
}

// ─── Filter functions ─────────────────────────────────────────────────────────
// Each returns { violated: true, reason: '...' } or null

function checkBannedWords(message, streamerId) {
  const words = db.getBannedWords(streamerId);
  if (!words.length) return null;
  const lower = message.toLowerCase();
  for (const w of words) {
    if (w.is_regex) {
      try {
        if (new RegExp(w.word, 'i').test(message)) {
          return { violated: true, reason: `Banned pattern: ${w.word}` };
        }
      } catch (e) { /* invalid regex, skip */ }
    } else {
      if (lower.includes(w.word.toLowerCase())) {
        return { violated: true, reason: `Banned word: ${w.word}` };
      }
    }
  }
  return null;
}

function checkLinks(message, channel, username, streamer) {
  if (!URL_REGEX.test(message)) return null;
  // Check permit
  const key = `${channel}:${username.toLowerCase()}`;
  const permitExpiry = permits.get(key);
  if (permitExpiry && Date.now() < permitExpiry) {
    permits.delete(key); // one-time use
    return null;
  }
  return { violated: true, reason: 'Link posted without permission' };
}

function checkCaps(message, streamer) {
  if (message.length < streamer.mod_caps_min_length) return null;
  const alpha = message.replace(/[^a-zA-Z]/g, '');
  if (alpha.length === 0) return null;
  const upper = alpha.replace(/[^A-Z]/g, '').length;
  const percent = Math.round((upper / alpha.length) * 100);
  if (percent > streamer.mod_caps_max_percent) {
    return { violated: true, reason: `Excessive caps (${percent}%)` };
  }
  return null;
}

function checkEmoteSpam(message, tags, streamer) {
  let count = 0;
  // Count Twitch emotes from tags
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
  // Always update last message
  lastMessages.set(key, { text: message.toLowerCase().trim(), timestamp: now });
  if (!last) return null;
  const windowMs = (streamer.mod_repetition_window || 30) * 1000;
  if (now - last.timestamp < windowMs && message.toLowerCase().trim() === last.text) {
    return { violated: true, reason: 'Repeated message' };
  }
  return null;
}

function checkSymbolSpam(message, streamer) {
  if (message.length < 5) return null;
  const nonAlphaSpace = message.replace(/[\w\s]/g, '').length;
  const percent = Math.round((nonAlphaSpace / message.length) * 100);
  if (percent > streamer.mod_symbol_max_percent) {
    return { violated: true, reason: `Symbol spam (${percent}%)` };
  }
  return null;
}

async function checkFollowAge(channel, username, streamer) {
  const key = `${channel}:${username.toLowerCase()}`;
  const now = Date.now();
  // Check cache first (cache for 5 minutes)
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
  // API call to check follow
  try {
    const { getFollowAge } = require('./twitch');
    const result = await getFollowAge(channel.replace(/^#/, ''), username);
    followCache.set(key, { following: result.following, followedAt: result.followedAt, cachedAt: now });
    if (!result.following) {
      return { violated: true, reason: 'Not following the channel' };
    }
    const ageMinutes = (now - new Date(result.followedAt).getTime()) / 60000;
    if (ageMinutes < streamer.mod_follow_age_minutes) {
      return { violated: true, reason: `Follow age too short (${Math.round(ageMinutes)}min)` };
    }
  } catch (e) {
    // If API fails, allow the message
    return null;
  }
  return null;
}

function checkFirstTimeChatter(tags) {
  if (tags['first-msg']) {
    return { flagOnly: true, reason: `First-time chatter: ${tags['display-name'] || tags.username}` };
  }
  return null;
}

// ─── Run all filters ──────────────────────────────────────────────────────────
async function runFilters(channel, tags, message, streamer) {
  const streamerId = streamer.id;
  const username = tags.username;

  // Banned words
  if (streamer.mod_banned_words_enabled) {
    const r = checkBannedWords(message, streamerId);
    if (r) return r;
  }

  // Link protection
  if (streamer.mod_link_protection_enabled) {
    const r = checkLinks(message, channel, username, streamer);
    if (r) return r;
  }

  // Caps filter
  if (streamer.mod_caps_enabled) {
    const r = checkCaps(message, streamer);
    if (r) return r;
  }

  // Emote spam
  if (streamer.mod_emote_spam_enabled) {
    const r = checkEmoteSpam(message, tags, streamer);
    if (r) return r;
  }

  // Repetition
  if (streamer.mod_repetition_enabled) {
    const r = checkRepetition(message, channel, username, streamer);
    if (r) return r;
  }

  // Symbol spam
  if (streamer.mod_symbol_spam_enabled) {
    const r = checkSymbolSpam(message, streamer);
    if (r) return r;
  }

  // Follow age
  if (streamer.mod_follow_age_enabled) {
    const r = await checkFollowAge(channel, username, streamer);
    if (r) return r;
  }

  // First-time chatter (flag only, no punishment)
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

  // Reset after 24 hours
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

// ─── Execute moderation action ────────────────────────────────────────────────
async function executeAction(client, channel, tags, action, reason, streamer) {
  const username = tags.username;
  try {
    switch (action) {
      case 'warn':
        await client.deletemessage(channel, tags.id).catch(() => {});
        await client.say(channel, `@${username}, warning: ${reason}`).catch(() => {});
        break;
      case 'delete':
        await client.deletemessage(channel, tags.id).catch(() => {});
        break;
      case 'timeout_10':
        await client.timeout(channel, username, 10, reason).catch(() => {});
        break;
      case 'timeout_60':
        await client.timeout(channel, username, 60, reason).catch(() => {});
        break;
      case 'timeout_600':
        await client.timeout(channel, username, 600, reason).catch(() => {});
        break;
      case 'timeout_1800':
        await client.timeout(channel, username, 1800, reason).catch(() => {});
        break;
    }
  } catch (e) {
    console.error(`[Mod] Failed to execute ${action} on ${username}:`, e.message);
  }

  // Discord mod log
  if (streamer.mod_log_discord_enabled && streamer.mod_log_discord_channel_id) {
    logToDiscord(streamer, username, reason, action, tags.id);
  }
}

// ─── Discord mod log ──────────────────────────────────────────────────────────
function logToDiscord(streamer, username, reason, action, messageId) {
  try {
    const { client: discordClient } = require('../discord');
    const ch = discordClient.channels.cache.get(streamer.mod_log_discord_channel_id);
    if (!ch) return;
    const actionLabels = {
      warn: 'Warning (message deleted)',
      delete: 'Message deleted',
      timeout_10: 'Timeout 10s',
      timeout_60: 'Timeout 60s',
      timeout_600: 'Timeout 10min',
      timeout_1800: 'Timeout 30min',
    };
    ch.send({
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
  } catch (e) {
    // Discord client may not be ready
  }
}

// ─── Permit system ────────────────────────────────────────────────────────────
function grantPermit(channel, username, durationSeconds) {
  const key = `${channel}:${username.toLowerCase()}`;
  permits.set(key, Date.now() + durationSeconds * 1000);
}

// ─── Raid protection ──────────────────────────────────────────────────────────
function activateRaidProtection(client, channel, streamer) {
  if (!streamer.mod_raid_protection_enabled) return;
  const duration = streamer.mod_raid_protection_duration || 120;
  const clean = channel.replace(/^#/, '').toLowerCase();

  // Clear existing timer
  const existing = raidProtectionTimers.get(clean);
  if (existing) clearTimeout(existing);

  // Enable followers-only mode
  client.followers(channel, 10).catch(() => {});
  client.say(channel, `Raid protection activated for ${duration} seconds. Followers-only mode enabled.`).catch(() => {});

  // Disable after duration
  const timer = setTimeout(() => {
    client.followersoff(channel).catch(() => {});
    client.say(channel, `Raid protection ended. Followers-only mode disabled.`).catch(() => {});
    raidProtectionTimers.delete(clean);
  }, duration * 1000);
  raidProtectionTimers.set(clean, timer);
}

module.exports = {
  isExempt,
  runFilters,
  getAction,
  executeAction,
  grantPermit,
  activateRaidProtection,
};
```

- [ ] **Step 2: Commit**

```bash
git add src/services/chatModeration.js
git commit -m "feat: add chat moderation filter module with all filter logic"
```

---

### Task 3: Integrate moderation into twitchChat.js

**Files:**
- Modify: `src/services/twitchChat.js`

- [ ] **Step 1: Add moderation import and update handleMessage**

At the top of `twitchChat.js`, add the require:

```javascript
const { isExempt, runFilters, getAction, executeAction, grantPermit, activateRaidProtection } = require('./chatModeration');
```

- [ ] **Step 2: Replace the handleMessage function**

Replace the existing `handleMessage` function. The key change is: process ALL messages (not just commands), run moderation filters first, then handle commands as before:

```javascript
async function handleMessage(channel, tags, message, self) {
  if (self) return;

  const streamerId = getStreamerIdForChannel(channel);
  if (!streamerId) return;

  const streamer = db.getStreamerById(streamerId);
  if (!streamer || !streamer.chatbot_enabled) return;

  // ─── Moderation filters (run on ALL messages, not just commands) ────────
  if (!isExempt(tags, streamer)) {
    const violation = await runFilters(channel, tags, message, streamer);
    if (violation) {
      if (violation.flagOnly) {
        // First-time chatter: just flag in chat, don't punish
        client.say(channel, `📋 ${violation.reason}`).catch(() => {});
      } else {
        const action = getAction(channel, tags.username, streamer);
        await executeAction(client, channel, tags, action, violation.reason, streamer);
        return; // Don't process commands from violated messages
      }
    }
  }

  // ─── Mod commands (!permit, !slow, !slowoff) ───────────────────────────
  if (message.startsWith('!') && (tags.mod || tags.badges?.broadcaster)) {
    const parts = message.split(' ');
    const cmd = parts[0].substring(1).toLowerCase();

    if (cmd === 'permit' && streamer.mod_link_protection_enabled && parts[1]) {
      const permitUser = parts[1].replace('@', '');
      const duration = streamer.mod_link_permit_seconds || 60;
      grantPermit(channel, permitUser, duration);
      client.say(channel, `@${permitUser} can post a link in the next ${duration} seconds.`).catch(() => {});
      return;
    }

    if (cmd === 'slow' && streamer.mod_slow_mode_cmd_enabled) {
      const seconds = parseInt(parts[1]) || 30;
      client.slow(channel, seconds).catch(() => {});
      return;
    }

    if (cmd === 'slowoff' && streamer.mod_slow_mode_cmd_enabled) {
      client.slowoff(channel).catch(() => {});
      return;
    }
  }

  // ─── Regular command processing (existing logic) ────────────────────────
  if (!message.startsWith('!')) return;

  const commandName = message.split(' ')[0].substring(1).toLowerCase();

  console.log(`[Chat] Command received: !${commandName} from ${tags.username} in ${channel}`);

  // Built-in !song command
  if (commandName === 'song') {
    const songCooldownKey = `${streamerId}:song`;
    const now = Date.now();
    const lastUsed = cooldowns.get(songCooldownKey) || 0;
    if (now - lastUsed < 5000) return;
    cooldowns.set(songCooldownKey, now);

    if (streamer) {
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
        if (client) client.say(channel, msg).catch(() => {});
      }).catch(() => {});
    }
    return;
  }

  const cmd = db.getChatCommand(streamerId, commandName);
  if (!cmd) return;

  const cooldownKey = `${streamerId}:${commandName}`;
  const now = Date.now();
  const lastUsed = cooldowns.get(cooldownKey) || 0;
  if (now - lastUsed < cmd.cooldown * 1000) return;

  cooldowns.set(cooldownKey, now);
  console.log(`[Chat] Sending response for !${commandName} in ${channel}`);
  client.say(channel, cmd.response).catch((err) => {
    console.error(`[Chat] Failed to send !${commandName} response:`, err.message);
  });
}
```

- [ ] **Step 3: Add raid protection hook to sendEventMessage**

In the `sendEventMessage` function, after the message is sent, add raid protection trigger:

```javascript
// At the end of sendEventMessage, after client.say():
if (eventType === 'raid' && client) {
  activateRaidProtection(client, streamer.twitch_username, streamer);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/services/twitchChat.js
git commit -m "feat: integrate moderation filters into chat message handling"
```

---

### Task 4: Add getFollowAge to Twitch service

**Files:**
- Modify: `src/services/twitch.js`

- [ ] **Step 1: Add getFollowAge function**

Find the `module.exports` in `src/services/twitch.js` and add this function before it:

```javascript
async function getFollowAge(broadcasterLogin, userLogin) {
  try {
    const token = await getAppToken();
    const broadcasterId = await getUserId(broadcasterLogin);
    const userId = await getUserId(userLogin);
    if (!broadcasterId || !userId) return { following: false, followedAt: null };

    const res = await fetch(
      `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}&user_id=${userId}`,
      { headers: { 'Client-ID': config.twitch.clientId, 'Authorization': `Bearer ${token}` } }
    );
    const data = await res.json();
    if (data.data && data.data.length > 0) {
      return { following: true, followedAt: data.data[0].followed_at };
    }
    return { following: false, followedAt: null };
  } catch (e) {
    console.error('[Twitch] getFollowAge error:', e.message);
    return { following: false, followedAt: null };
  }
}
```

Add `getFollowAge` to the `module.exports`.

- [ ] **Step 2: Commit**

```bash
git add src/services/twitch.js
git commit -m "feat: add getFollowAge for moderation follow-age filter"
```

---

### Task 5: Dashboard routes — moderation settings save + banned words CRUD

**Files:**
- Modify: `src/routes/dashboard.js`

- [ ] **Step 1: Add POST route for moderation config**

After the existing `router.post('/chatbot', ...)` route, add:

```javascript
router.post('/chatbot/moderation', (req, res) => {
  const b = req.body;
  db.updateModerationConfig(req.streamer.id, {
    mod_banned_words_enabled: b.mod_banned_words_enabled ? 1 : 0,
    mod_link_protection_enabled: b.mod_link_protection_enabled ? 1 : 0,
    mod_link_permit_seconds: parseInt(b.mod_link_permit_seconds) || 60,
    mod_caps_enabled: b.mod_caps_enabled ? 1 : 0,
    mod_caps_min_length: parseInt(b.mod_caps_min_length) || 10,
    mod_caps_max_percent: parseInt(b.mod_caps_max_percent) || 70,
    mod_emote_spam_enabled: b.mod_emote_spam_enabled ? 1 : 0,
    mod_emote_max_count: parseInt(b.mod_emote_max_count) || 15,
    mod_repetition_enabled: b.mod_repetition_enabled ? 1 : 0,
    mod_repetition_window: parseInt(b.mod_repetition_window) || 30,
    mod_symbol_spam_enabled: b.mod_symbol_spam_enabled ? 1 : 0,
    mod_symbol_max_percent: parseInt(b.mod_symbol_max_percent) || 50,
    mod_slow_mode_cmd_enabled: b.mod_slow_mode_cmd_enabled ? 1 : 0,
    mod_raid_protection_enabled: b.mod_raid_protection_enabled ? 1 : 0,
    mod_raid_protection_duration: parseInt(b.mod_raid_protection_duration) || 120,
    mod_first_chatter_enabled: b.mod_first_chatter_enabled ? 1 : 0,
    mod_follow_age_enabled: b.mod_follow_age_enabled ? 1 : 0,
    mod_follow_age_minutes: parseInt(b.mod_follow_age_minutes) || 10,
    mod_action_response: b.mod_action_response || 'delete',
    mod_escalation_enabled: b.mod_escalation_enabled ? 1 : 0,
    mod_log_discord_enabled: b.mod_log_discord_enabled ? 1 : 0,
    mod_log_discord_channel_id: b.mod_log_discord_channel_id || null,
    mod_exempt_subs: b.mod_exempt_subs ? 1 : 0,
    mod_exempt_vips: b.mod_exempt_vips ? 1 : 0,
  });
  res.redirect('/dashboard/chatbot?tab=moderation');
});
```

- [ ] **Step 2: Add banned words API routes**

Add these routes (they use AJAX from the UI, so return JSON):

```javascript
router.post('/chatbot/banned-words', (req, res) => {
  const { word, is_regex } = req.body;
  if (!word || !word.trim()) return res.json({ ok: false, error: 'Word is required' });
  db.addBannedWord(req.streamer.id, word.trim(), is_regex ? 1 : 0);
  res.json({ ok: true, words: db.getBannedWords(req.streamer.id) });
});

router.delete('/chatbot/banned-words/:id', (req, res) => {
  db.deleteBannedWord(req.streamer.id, parseInt(req.params.id));
  res.json({ ok: true, words: db.getBannedWords(req.streamer.id) });
});
```

- [ ] **Step 3: Update the GET /chatbot route to pass banned words and Discord channels**

Find the existing `router.get('/chatbot', ...)` route. Add banned words and Discord channels to the render data:

Add to the route handler before `res.render`:

```javascript
const bannedWords = db.getBannedWords(req.streamer.id);

// Get Discord channels for mod log dropdown
let discordChannels = [];
try {
  const { client: discordClient } = require('../discord');
  if (req.streamer.discord_guild_id) {
    const guild = discordClient.guilds.cache.get(req.streamer.discord_guild_id);
    if (guild) {
      discordChannels = guild.channels.cache
        .filter(c => c.type === 0) // text channels
        .map(c => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
  }
} catch (e) {}
```

Add `bannedWords` and `discordChannels` to the `res.render` call's data object.

- [ ] **Step 4: Commit**

```bash
git add src/routes/dashboard.js
git commit -m "feat: add moderation settings routes and banned words CRUD"
```

---

### Task 6: Moderation Tab UI

**Files:**
- Modify: `src/views/chatbot-config.ejs`

- [ ] **Step 1: Add tab button for Moderation**

After the "Custom Commands" tab button, add:

```html
  <button class="tab-btn tab-moderation" data-tab="moderation">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
    Moderation
  </button>
```

Add this CSS at the top in the `<style>` block:

```css
.tab-moderation.active { background: #ff4444; }
.mod-section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: var(--text-muted); margin: 20px 0 10px; font-family: var(--font-display); }
.mod-section-title:first-child { margin-top: 4px; }
.mod-card { padding: 16px 0; border-bottom: 1px solid var(--border); }
.mod-card:last-child { border-bottom: none; }
.mod-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.mod-card-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.mod-card-desc { font-size: 12px; color: var(--text-muted); }
.mod-card-settings { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; margin-top: 10px; }
.mod-setting { display: flex; align-items: center; gap: 6px; }
.mod-setting label { font-size: 11px; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
.mod-setting input[type=number] { width: 60px; padding: 5px 8px; background: var(--bg-base); border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary); font-size: 13px; text-align: center; }
.mod-setting select { padding: 5px 8px; background: var(--bg-base); border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary); font-size: 13px; }
.mod-note { background: rgba(145,70,255,0.08); border: 1px solid rgba(145,70,255,0.2); border-radius: var(--radius-sm); padding: 10px 14px; font-size: 12px; color: var(--text-secondary); margin-bottom: 16px; }
.banned-word-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.banned-word-tag { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 12px; font-size: 12px; color: var(--text-primary); }
.banned-word-tag.regex { border-color: rgba(255,68,68,0.3); background: rgba(255,68,68,0.08); }
.banned-word-tag button { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 14px; padding: 0; line-height: 1; }
.banned-word-tag button:hover { color: var(--danger); }
.banned-word-add { display: flex; gap: 6px; margin-top: 10px; }
.banned-word-add input[type=text] { flex: 1; padding: 6px 10px; background: var(--bg-base); border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary); font-size: 12px; }
```

- [ ] **Step 2: Add the Moderation tab content pane**

After the last `</div><!-- tab-commands -->` closing div, add:

```html
<div class="tab-content" id="tab-moderation">
  <form method="POST" action="/dashboard/chatbot/moderation">
    <div class="mod-note">
      <strong>Note:</strong> The bot must be a moderator in your channel for moderation to work. Type <code>/mod Atleta</code> in your Twitch chat.
    </div>

    <!-- MESSAGE FILTERS -->
    <div class="mod-section-title">Message Filters</div>

    <!-- Banned Words -->
    <div class="mod-card">
      <div class="mod-card-header">
        <div>
          <div class="mod-card-title">Banned Words</div>
          <div class="mod-card-desc">Block messages containing specific words or patterns</div>
        </div>
        <div class="toggle">
          <input type="checkbox" id="mod_banned_words_enabled" name="mod_banned_words_enabled" value="1" <%= streamer.mod_banned_words_enabled ? 'checked' : '' %>>
          <label for="mod_banned_words_enabled"></label>
        </div>
      </div>
      <div class="banned-word-list" id="banned-word-list">
        <% bannedWords.forEach(w => { %>
          <span class="banned-word-tag <%= w.is_regex ? 'regex' : '' %>">
            <% if (w.is_regex) { %><small style="opacity:0.5">regex:</small><% } %>
            <%= w.word %>
            <button type="button" onclick="removeBannedWord(<%= w.id %>)">×</button>
          </span>
        <% }) %>
      </div>
      <div class="banned-word-add">
        <input type="text" id="new-banned-word" placeholder="Add word or phrase...">
        <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted);white-space:nowrap;">
          <input type="checkbox" id="new-banned-regex"> Regex
        </label>
        <button type="button" class="btn btn-secondary" style="font-size:12px;padding:5px 12px;" onclick="addBannedWord()">Add</button>
      </div>
    </div>

    <!-- Link Protection -->
    <div class="mod-card">
      <div class="mod-card-header">
        <div>
          <div class="mod-card-title">Link Protection</div>
          <div class="mod-card-desc">Block URLs from non-mods/VIPs. Mods can use <code>!permit username</code></div>
        </div>
        <div class="toggle">
          <input type="checkbox" id="mod_link_protection_enabled" name="mod_link_protection_enabled" value="1" <%= streamer.mod_link_protection_enabled ? 'checked' : '' %>>
          <label for="mod_link_protection_enabled"></label>
        </div>
      </div>
      <div class="mod-card-settings">
        <div class="mod-setting">
          <label>Permit duration</label>
          <input type="number" name="mod_link_permit_seconds" value="<%= streamer.mod_link_permit_seconds || 60 %>" min="10" max="600">
          <span style="font-size:12px;color:var(--text-muted)">s</span>
        </div>
      </div>
    </div>

    <!-- Caps Filter -->
    <div class="mod-card">
      <div class="mod-card-header">
        <div>
          <div class="mod-card-title">Caps Filter</div>
          <div class="mod-card-desc">Block messages with excessive uppercase letters</div>
        </div>
        <div class="toggle">
          <input type="checkbox" id="mod_caps_enabled" name="mod_caps_enabled" value="1" <%= streamer.mod_caps_enabled ? 'checked' : '' %>>
          <label for="mod_caps_enabled"></label>
        </div>
      </div>
      <div class="mod-card-settings">
        <div class="mod-setting">
          <label>Min length</label>
          <input type="number" name="mod_caps_min_length" value="<%= streamer.mod_caps_min_length || 10 %>" min="3" max="100">
        </div>
        <div class="mod-setting">
          <label>Max caps %</label>
          <input type="number" name="mod_caps_max_percent" value="<%= streamer.mod_caps_max_percent || 70 %>" min="30" max="100">
          <span style="font-size:12px;color:var(--text-muted)">%</span>
        </div>
      </div>
    </div>

    <!-- Emote Spam -->
    <div class="mod-card">
      <div class="mod-card-header">
        <div>
          <div class="mod-card-title">Emote Spam</div>
          <div class="mod-card-desc">Limit the number of emotes per message</div>
        </div>
        <div class="toggle">
          <input type="checkbox" id="mod_emote_spam_enabled" name="mod_emote_spam_enabled" value="1" <%= streamer.mod_emote_spam_enabled ? 'checked' : '' %>>
          <label for="mod_emote_spam_enabled"></label>
        </div>
      </div>
      <div class="mod-card-settings">
        <div class="mod-setting">
          <label>Max emotes</label>
          <input type="number" name="mod_emote_max_count" value="<%= streamer.mod_emote_max_count || 15 %>" min="1" max="100">
        </div>
      </div>
    </div>

    <!-- Repetition -->
    <div class="mod-card">
      <div class="mod-card-header">
        <div>
          <div class="mod-card-title">Repetition Filter</div>
          <div class="mod-card-desc">Block users from spamming the same message</div>
        </div>
        <div class="toggle">
          <input type="checkbox" id="mod_repetition_enabled" name="mod_repetition_enabled" value="1" <%= streamer.mod_repetition_enabled ? 'checked' : '' %>>
          <label for="mod_repetition_enabled"></label>
        </div>
      </div>
      <div class="mod-card-settings">
        <div class="mod-setting">
          <label>Window</label>
          <input type="number" name="mod_repetition_window" value="<%= streamer.mod_repetition_window || 30 %>" min="5" max="300">
          <span style="font-size:12px;color:var(--text-muted)">s</span>
        </div>
      </div>
    </div>

    <!-- Symbol Spam -->
    <div class="mod-card">
      <div class="mod-card-header">
        <div>
          <div class="mod-card-title">Symbol Spam</div>
          <div class="mod-card-desc">Block messages with excessive special characters</div>
        </div>
        <div class="toggle">
          <input type="checkbox" id="mod_symbol_spam_enabled" name="mod_symbol_spam_enabled" value="1" <%= streamer.mod_symbol_spam_enabled ? 'checked' : '' %>>
          <label for="mod_symbol_spam_enabled"></label>
        </div>
      </div>
      <div class="mod-card-settings">
        <div class="mod-setting">
          <label>Max symbols %</label>
          <input type="number" name="mod_symbol_max_percent" value="<%= streamer.mod_symbol_max_percent || 50 %>" min="10" max="100">
          <span style="font-size:12px;color:var(--text-muted)">%</span>
        </div>
      </div>
    </div>

    <!-- USER MANAGEMENT -->
    <div class="mod-section-title">User Management</div>

    <!-- Slow Mode Command -->
    <div class="mod-card">
      <div class="mod-card-header">
        <div>
          <div class="mod-card-title">Slow Mode Command</div>
          <div class="mod-card-desc">Enable <code>!slow &lt;seconds&gt;</code> and <code>!slowoff</code> for mods</div>
        </div>
        <div class="toggle">
          <input type="checkbox" id="mod_slow_mode_cmd_enabled" name="mod_slow_mode_cmd_enabled" value="1" <%= streamer.mod_slow_mode_cmd_enabled ? 'checked' : '' %>>
          <label for="mod_slow_mode_cmd_enabled"></label>
        </div>
      </div>
    </div>

    <!-- Follow Age Gate -->
    <div class="mod-card">
      <div class="mod-card-header">
        <div>
          <div class="mod-card-title">Follow Age Gate</div>
          <div class="mod-card-desc">Require users to follow for a minimum time before chatting</div>
        </div>
        <div class="toggle">
          <input type="checkbox" id="mod_follow_age_enabled" name="mod_follow_age_enabled" value="1" <%= streamer.mod_follow_age_enabled ? 'checked' : '' %>>
          <label for="mod_follow_age_enabled"></label>
        </div>
      </div>
      <div class="mod-card-settings">
        <div class="mod-setting">
          <label>Min follow age</label>
          <input type="number" name="mod_follow_age_minutes" value="<%= streamer.mod_follow_age_minutes || 10 %>" min="1" max="1440">
          <span style="font-size:12px;color:var(--text-muted)">min</span>
        </div>
      </div>
    </div>

    <!-- First-Time Chatter -->
    <div class="mod-card">
      <div class="mod-card-header">
        <div>
          <div class="mod-card-title">First-Time Chatter Flag</div>
          <div class="mod-card-desc">Post a notice in chat when someone chats for the first time</div>
        </div>
        <div class="toggle">
          <input type="checkbox" id="mod_first_chatter_enabled" name="mod_first_chatter_enabled" value="1" <%= streamer.mod_first_chatter_enabled ? 'checked' : '' %>>
          <label for="mod_first_chatter_enabled"></label>
        </div>
      </div>
    </div>

    <!-- AUTOMATED PROTECTION -->
    <div class="mod-section-title">Automated Protection</div>

    <!-- Raid Protection -->
    <div class="mod-card">
      <div class="mod-card-header">
        <div>
          <div class="mod-card-title">Raid Protection</div>
          <div class="mod-card-desc">Auto-enable followers-only mode when a raid is detected</div>
        </div>
        <div class="toggle">
          <input type="checkbox" id="mod_raid_protection_enabled" name="mod_raid_protection_enabled" value="1" <%= streamer.mod_raid_protection_enabled ? 'checked' : '' %>>
          <label for="mod_raid_protection_enabled"></label>
        </div>
      </div>
      <div class="mod-card-settings">
        <div class="mod-setting">
          <label>Duration</label>
          <input type="number" name="mod_raid_protection_duration" value="<%= streamer.mod_raid_protection_duration || 120 %>" min="30" max="600">
          <span style="font-size:12px;color:var(--text-muted)">s</span>
        </div>
      </div>
    </div>

    <!-- ACTIONS & LOGGING -->
    <div class="mod-section-title">Actions & Logging</div>

    <!-- Default Action -->
    <div class="mod-card">
      <div class="mod-card-header">
        <div>
          <div class="mod-card-title">Default Action</div>
          <div class="mod-card-desc">What happens when a filter is triggered</div>
        </div>
      </div>
      <div class="mod-card-settings">
        <div class="mod-setting">
          <select name="mod_action_response">
            <option value="delete" <%= (streamer.mod_action_response || 'delete') === 'delete' ? 'selected' : '' %>>Delete message</option>
            <option value="timeout_10" <%= streamer.mod_action_response === 'timeout_10' ? 'selected' : '' %>>Timeout 10s</option>
            <option value="timeout_60" <%= streamer.mod_action_response === 'timeout_60' ? 'selected' : '' %>>Timeout 60s</option>
            <option value="timeout_600" <%= streamer.mod_action_response === 'timeout_600' ? 'selected' : '' %>>Timeout 10min</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Escalation -->
    <div class="mod-card">
      <div class="mod-card-header">
        <div>
          <div class="mod-card-title">Escalation</div>
          <div class="mod-card-desc">Progressive punishment: 1st = warning, 2nd = 10s timeout, 3rd = 10min, 4th+ = 30min. Resets after 24h.</div>
        </div>
        <div class="toggle">
          <input type="checkbox" id="mod_escalation_enabled" name="mod_escalation_enabled" value="1" <%= streamer.mod_escalation_enabled ? 'checked' : '' %>>
          <label for="mod_escalation_enabled"></label>
        </div>
      </div>
    </div>

    <!-- Exemptions -->
    <div class="mod-card">
      <div class="mod-card-header">
        <div>
          <div class="mod-card-title">Exemptions</div>
          <div class="mod-card-desc">Choose which user types bypass moderation filters</div>
        </div>
      </div>
      <div class="mod-card-settings">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-primary);cursor:pointer;">
          <input type="checkbox" name="mod_exempt_subs" value="1" <%= streamer.mod_exempt_subs !== 0 ? 'checked' : '' %>>
          Subscribers
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-primary);cursor:pointer;">
          <input type="checkbox" name="mod_exempt_vips" value="1" <%= streamer.mod_exempt_vips !== 0 ? 'checked' : '' %>>
          VIPs
        </label>
      </div>
    </div>

    <!-- Discord Mod Log -->
    <div class="mod-card">
      <div class="mod-card-header">
        <div>
          <div class="mod-card-title">Discord Mod Log</div>
          <div class="mod-card-desc">Send moderation actions to a Discord channel</div>
        </div>
        <div class="toggle">
          <input type="checkbox" id="mod_log_discord_enabled" name="mod_log_discord_enabled" value="1" <%= streamer.mod_log_discord_enabled ? 'checked' : '' %>>
          <label for="mod_log_discord_enabled"></label>
        </div>
      </div>
      <div class="mod-card-settings">
        <div class="mod-setting">
          <label>Channel</label>
          <select name="mod_log_discord_channel_id">
            <option value="">Select a channel...</option>
            <% discordChannels.forEach(ch => { %>
              <option value="<%= ch.id %>" <%= streamer.mod_log_discord_channel_id === ch.id ? 'selected' : '' %>>#<%= ch.name %></option>
            <% }) %>
          </select>
        </div>
      </div>
    </div>

    <!-- Save Button -->
    <div style="display: flex; justify-content: flex-end; margin-top: 20px;">
      <button type="submit" class="btn btn-primary" style="padding: 10px 28px; font-size: 14px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        Save Moderation Settings
      </button>
    </div>
  </form>
</div><!-- tab-moderation -->
```

- [ ] **Step 3: Add banned words JavaScript**

Add this script at the bottom of the file, before `<%- include('footer') %>`:

```html
<script>
function addBannedWord() {
  const input = document.getElementById('new-banned-word');
  const word = input.value.trim();
  if (!word) return;
  const isRegex = document.getElementById('new-banned-regex').checked;
  fetch('/dashboard/chatbot/banned-words', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word, is_regex: isRegex })
  }).then(r => r.json()).then(data => {
    if (data.ok) {
      input.value = '';
      document.getElementById('new-banned-regex').checked = false;
      renderBannedWords(data.words);
    }
  });
}

function removeBannedWord(id) {
  fetch('/dashboard/chatbot/banned-words/' + id, { method: 'DELETE' })
    .then(r => r.json())
    .then(data => { if (data.ok) renderBannedWords(data.words); });
}

function renderBannedWords(words) {
  const list = document.getElementById('banned-word-list');
  list.innerHTML = words.map(w =>
    `<span class="banned-word-tag ${w.is_regex ? 'regex' : ''}">` +
    (w.is_regex ? '<small style="opacity:0.5">regex:</small>' : '') +
    `${w.word.replace(/</g,'&lt;')} <button type="button" onclick="removeBannedWord(${w.id})">×</button></span>`
  ).join('');
}

document.getElementById('new-banned-word').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); addBannedWord(); }
});
</script>
```

- [ ] **Step 4: Commit**

```bash
git add src/views/chatbot-config.ejs
git commit -m "feat: add Moderation tab UI with all filter toggles and banned words management"
```

---

### Task 7: Final integration and commit

**Files:**
- All modified files

- [ ] **Step 1: Verify the GET /chatbot route passes tab param for deep-linking**

In the existing tab-switching JS in `chatbot-config.ejs`, ensure it reads the `tab` query param (it should already do this based on the existing pattern). Check that after saving moderation settings (redirect to `/dashboard/chatbot?tab=moderation`), the moderation tab opens automatically.

The existing code should handle this:
```javascript
const urlTab = new URLSearchParams(window.location.search).get('tab');
if (urlTab) switchTab(urlTab);
```

If this code doesn't exist, add it after `switchTab('connection');`.

- [ ] **Step 2: Final commit and push**

```bash
git add -A
git commit -m "feat: complete chatbot moderation system with filters, escalation, and Discord logging"
git push
```
