# Chatbot Moderation System — Design Spec

**Date:** 2026-03-30
**Status:** Approved

## Overview

Add a moderation system to the Twitch chatbot (Atleta) with per-feature toggles. Each moderation feature can be independently enabled/disabled via a new "Moderation" tab in the chatbot config UI. The bot is assumed to already have moderator permissions in each channel (`/mod Atleta`).

## Architecture

### Approach

Per-filter toggle with settings stored as columns on the `streamers` table (Approach A), consistent with how all other features work (overlay toggles, chatbot toggles, etc.). Banned words use a separate table since they are variable-length lists.

### Message Processing Flow

When a message arrives in `twitchChat.js`, moderation filters run before command processing:

```
Message received
  → Is sender mod/broadcaster? → skip all filters
  → Is sender VIP + mod_exempt_vips? → skip
  → Is sender sub + mod_exempt_subs? → skip
  → Run filters in order:
      1. Banned words
      2. Link protection (+ !permit system)
      3. Caps filter
      4. Emote spam
      5. Repetition filter
      6. Symbol spam
      7. Follow age check
      8. First-time chatter flag
  → If violation:
      - Escalation enabled? → track offense count, escalate action
      - Else → apply default action (delete/timeout)
      - Log to Discord if enabled
  → Continue to command processing
```

Filters short-circuit: first violation triggers the action, remaining filters are skipped.

## DB Schema

### New columns on `streamers` table

All columns default to disabled (0) or sensible defaults:

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `mod_banned_words_enabled` | INTEGER | 0 | Toggle banned words filter |
| `mod_link_protection_enabled` | INTEGER | 0 | Block links from non-privileged users |
| `mod_link_permit_seconds` | INTEGER | 60 | Duration of a `!permit` allowance |
| `mod_caps_enabled` | INTEGER | 0 | Block excessive caps |
| `mod_caps_min_length` | INTEGER | 10 | Min message length to check caps |
| `mod_caps_max_percent` | INTEGER | 70 | Max % uppercase allowed |
| `mod_emote_spam_enabled` | INTEGER | 0 | Limit emotes per message |
| `mod_emote_max_count` | INTEGER | 15 | Max emotes allowed |
| `mod_repetition_enabled` | INTEGER | 0 | Block repeated messages |
| `mod_repetition_window` | INTEGER | 30 | Seconds window for repeat detection |
| `mod_symbol_spam_enabled` | INTEGER | 0 | Block excessive symbols |
| `mod_symbol_max_percent` | INTEGER | 50 | Max % symbols allowed |
| `mod_slow_mode_cmd_enabled` | INTEGER | 0 | Enable `!slow` / `!slowoff` commands |
| `mod_raid_protection_enabled` | INTEGER | 0 | Auto-strict mode during raids |
| `mod_raid_protection_duration` | INTEGER | 120 | Seconds of raid protection |
| `mod_first_chatter_enabled` | INTEGER | 0 | Flag first-time chatters |
| `mod_follow_age_enabled` | INTEGER | 0 | Min follow age to chat |
| `mod_follow_age_minutes` | INTEGER | 10 | Required follow age in minutes |
| `mod_action_response` | TEXT | 'delete' | Default action: 'delete', 'timeout_10', 'timeout_60', 'timeout_600' |
| `mod_escalation_enabled` | INTEGER | 0 | Progressive punishment |
| `mod_log_discord_enabled` | INTEGER | 0 | Log mod actions to Discord |
| `mod_log_discord_channel_id` | TEXT | NULL | Discord channel ID for mod logs |
| `mod_exempt_subs` | INTEGER | 1 | Exempt subscribers from filters |
| `mod_exempt_vips` | INTEGER | 1 | Exempt VIPs from filters |

### New table: `banned_words`

```sql
CREATE TABLE IF NOT EXISTS banned_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  streamer_id INTEGER NOT NULL REFERENCES streamers(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  is_regex INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_banned_words_streamer ON banned_words(streamer_id);
```

## Moderation Features Detail

### 1. Banned Words
- Match against message text (case-insensitive)
- `is_regex = 0`: substring match
- `is_regex = 1`: regex pattern match
- UI: text input to add words, list with delete buttons, toggle for regex mode

### 2. Link Protection
- Detect URLs via regex (`https?://`, `www.`, common TLDs)
- Exempt: mods, broadcaster, and permitted users
- `!permit <username>` allows one link within `mod_link_permit_seconds`
- Permit state stored in-memory (Map of `channel:username → expiry timestamp`)

### 3. Caps Filter
- Only check messages longer than `mod_caps_min_length` characters
- Calculate % uppercase letters (ignore non-alpha characters)
- Trigger if % exceeds `mod_caps_max_percent`

### 4. Emote Spam Filter
- Count emotes using `tags.emotes` object from tmi.js (Twitch emotes)
- Also count emoji patterns in text for third-party emotes
- Trigger if count exceeds `mod_emote_max_count`

### 5. Repetition Filter
- Track last message per user per channel in-memory (Map)
- If same message sent within `mod_repetition_window` seconds, trigger
- Comparison is case-insensitive, trimmed

### 6. Symbol Spam Filter
- Calculate % of non-alphanumeric, non-space characters
- Trigger if % exceeds `mod_symbol_max_percent`
- Min message length of 5 to avoid false positives on short messages

### 7. Slow Mode Command
- `!slow <seconds>` — mods only, calls `client.slow(channel, seconds)`
- `!slowoff` — mods only, calls `client.slowoff(channel)`

### 8. Raid Protection
- When a raid event is detected (via overlayBus), auto-enable followers-only mode
- After `mod_raid_protection_duration` seconds, disable followers-only mode
- Only triggers if `mod_raid_protection_enabled` is on
- Sends chat message: "Raid protection activated for X seconds"

### 9. First-Time Chatter Flag
- Check `tags['first-msg']` from tmi.js (Twitch provides this)
- Send a whisper or chat message to mods: "First-time chatter: {username}"
- No punishment, just a flag

### 10. Follow Age Gate
- Check if user has been following for at least `mod_follow_age_minutes`
- Requires Twitch API call to check follow date
- Cache follow status in-memory to avoid excessive API calls
- Non-followers or too-new followers get their message deleted

### 11. Escalation System
When `mod_escalation_enabled`:
- Track offense count per user per channel in-memory
- 1st offense: delete message + send warning in chat
- 2nd offense: 10-second timeout
- 3rd offense: 10-minute timeout
- 4th+ offense: 30-minute timeout
- Offense count resets after 24 hours of no violations

When disabled: apply `mod_action_response` directly every time.

### 12. Discord Mod Log
- When a moderation action is taken, send an embed to `mod_log_discord_channel_id`
- Embed includes: username, violation type, message content, action taken, timestamp
- Uses existing Discord client from `src/discord.js`

## Actions

tmi.js methods used for enforcement:

| Action | Method |
|--------|--------|
| Delete message | `client.deletemessage(channel, tags.id)` |
| Timeout 10s | `client.timeout(channel, username, 10)` |
| Timeout 60s | `client.timeout(channel, username, 60)` |
| Timeout 600s | `client.timeout(channel, username, 600)` |
| Followers-only | `client.followers(channel, minutes)` |
| Slow mode | `client.slow(channel, seconds)` |

Message `tags.id` is already available in the tmi.js `message` event handler for deleting specific messages.

## UI: Moderation Tab

New 4th tab on `chatbot-config.ejs`: **Connection | Event Messages | Custom Commands | Moderation**

### Layout

Toggle cards matching existing UI style, grouped into sections:

**Message Filters**
- Banned Words — toggle + word list management (add/remove/regex toggle)
- Link Protection — toggle + permit duration slider
- Caps Filter — toggle + min length + max % sliders
- Emote Spam — toggle + max count slider
- Repetition — toggle + window seconds slider
- Symbol Spam — toggle + max % slider

**User Management**
- Slow Mode Command — toggle (enables `!slow`/`!slowoff` for mods)
- Follow Age Gate — toggle + minutes input
- First-Time Chatter — toggle

**Automated Protection**
- Raid Protection — toggle + duration slider

**Actions & Logging**
- Default Action — dropdown (Delete / Timeout 10s / 60s / 600s)
- Escalation — toggle with description of the ladder
- Exemptions — checkboxes for Subscribers and VIPs
- Discord Mod Log — toggle + channel selector dropdown (populated from bot's guilds)

A note at the top of the tab: "The bot must be a moderator in your channel for moderation to work. Type `/mod Atleta` in your Twitch chat."

### Routes

- `POST /dashboard/chatbot/moderation` — save all moderation settings
- `GET /api/banned-words/:streamerId` — list banned words
- `POST /api/banned-words/:streamerId` — add banned word
- `DELETE /api/banned-words/:streamerId/:id` — remove banned word

## In-Memory State

Stored in the twitchChat module (not DB, resets on restart):

- `permits`: `Map<"channel:username", expiryTimestamp>` — active link permits
- `lastMessages`: `Map<"channel:username", {text, timestamp}>` — for repetition detection
- `offenseCounts`: `Map<"channel:username", {count, lastOffense}>` — for escalation
- `followCache`: `Map<"channel:username", {following, followedAt, cachedAt}>` — follow age cache
- `raidProtectionTimers`: `Map<"channel", timeoutId>` — active raid protection timers

## Files Modified

- `src/db.js` — migration for new columns + `banned_words` table + query functions
- `src/services/twitchChat.js` — message interception, filter logic, mod commands, permit system, raid protection
- `src/views/chatbot-config.ejs` — new Moderation tab with all toggle cards
- `src/routes/dashboard.js` — POST route for moderation settings, banned words CRUD
- `src/routes/api.js` — banned words API endpoints (if needed for AJAX)
