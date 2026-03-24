# Social Media Notifications — Design Spec

## Problem

The bot currently only monitors Twitch and YouTube. Streamers create content across Instagram, TikTok, and Twitter/X but have no way to automatically notify their Discord communities about new posts on those platforms.

## Solution

Add Instagram, TikTok, and Twitter/X monitoring using RSSHub (a free open-source RSS bridge) as the primary data source for all three platforms. When a creator posts new content on any platform, the bot sends a branded embed notification to a configured Discord channel. Follows the same UX pattern as the existing YouTube integration.

---

## Data Sources

**Critical design decision:** Instagram and TikTok serve JavaScript-rendered SPAs — plain `fetch()` returns no post data. Direct scraping is not viable. Instead, we use **RSSHub** (https://docs.rsshub.app/) which provides RSS feeds for all three platforms.

### Primary: RSSHub

RSSHub is an open-source RSS feed generator that supports 300+ sites. It provides structured RSS/Atom feeds:

- **Instagram:** `https://rsshub.app/instagram/user/{username}` — returns recent posts with image URLs, captions, timestamps
- **TikTok:** `https://rsshub.app/tiktok/user/{username}` — returns recent videos with thumbnails, descriptions, timestamps
- **Twitter/X:** `https://rsshub.app/twitter/user/{username}` — returns recent tweets with text, media, timestamps

All feeds return standard XML parseable with `fast-xml-parser` (already a dependency).

### Fallback: Multiple RSSHub instances

Public RSSHub instances can go down or rate-limit. The services should try multiple instances in order:
1. `https://rsshub.app` (official)
2. `https://rsshub.rssforever.com`
3. `https://rsshub-instance.zeabur.app`

If all instances fail for a platform, mark it as `unavailable` in the state table. Auto-recover on next successful fetch.

### Profile resolution

Profile images and display names cannot be reliably extracted from RSS feeds. Instead:
- **Instagram:** Fetch `https://www.instagram.com/{username}/` — the `og:image` meta tag works even on the JS-rendered shell, as it's in the initial HTML. Display name from `og:title`.
- **TikTok:** Fetch `https://www.tiktok.com/@{username}` — same approach with `og:image` and `og:title`.
- **Twitter/X:** Extract from RSSHub feed's channel image element, or fetch `https://unavatar.io/twitter/{username}` (free avatar API).

Profile info is cached in the watched account tables and backfilled on guild config page load (same pattern as Twitch/YouTube).

---

## Dashboard UI — New Platform Tabs

The guild config tab bar expands from 4 to 7 tabs:

**Twitch | YouTube | Instagram | TikTok | Twitter | Discord | Settings**

Each new tab follows the YouTube pattern:
- Single input for @username
- Dropdown to pick the Discord notification channel
- List of watched accounts with profile pictures, edit/remove buttons
- Platform-specific icon and color on the tab

**Tab colors and CSS classes:**
- `.tab-instagram.active { background: #E1306C; }` (pink)
- `.tab-tiktok.active { background: #000000; color: white; }` (black)
- `.tab-twitter.active { background: #1DA1F2; }` (blue)

**Twitter status indicator:** If the service is unavailable, the Twitter tab shows a warning badge. Each account in the list shows "Service unavailable" instead of a remove/edit button.

**Single notification channel:** Unlike Twitch (live + clips) and YouTube (videos + live), each social platform only needs one `notify_channel_id` since there's no content type distinction.

---

## Data Architecture

### Watched account tables

Add `display_name` column to persist resolved names (avoids re-scraping on every page load):

```sql
CREATE TABLE IF NOT EXISTS watched_instagram_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  streamer_id INTEGER NOT NULL REFERENCES streamers(id) ON DELETE CASCADE,
  instagram_username TEXT NOT NULL,
  display_name TEXT,
  profile_image_url TEXT,
  notify_channel_id TEXT,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(guild_id, streamer_id, instagram_username)
);

CREATE TABLE IF NOT EXISTS watched_tiktok_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  streamer_id INTEGER NOT NULL REFERENCES streamers(id) ON DELETE CASCADE,
  tiktok_username TEXT NOT NULL,
  display_name TEXT,
  profile_image_url TEXT,
  notify_channel_id TEXT,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(guild_id, streamer_id, tiktok_username)
);

CREATE TABLE IF NOT EXISTS watched_twitter_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  streamer_id INTEGER NOT NULL REFERENCES streamers(id) ON DELETE CASCADE,
  twitter_username TEXT NOT NULL,
  display_name TEXT,
  profile_image_url TEXT,
  notify_channel_id TEXT,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(guild_id, streamer_id, twitter_username)
);
```

### State tracking tables

```sql
CREATE TABLE IF NOT EXISTS instagram_account_state (
  instagram_username TEXT PRIMARY KEY,
  known_post_ids TEXT DEFAULT '[]',
  last_checked TEXT,
  available INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tiktok_account_state (
  tiktok_username TEXT PRIMARY KEY,
  known_video_ids TEXT DEFAULT '[]',
  last_checked TEXT,
  available INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS twitter_account_state (
  twitter_username TEXT PRIMARY KEY,
  known_tweet_ids TEXT DEFAULT '[]',
  last_checked TEXT,
  available INTEGER DEFAULT 1
);
```

Known ID arrays capped at 50 entries (matching YouTube's pattern in `youtubeFeed.js` line 12).

### Guild toggle columns — Migration 8

```js
// Migration 8: add social media toggle columns to guilds
try {
  const cols = db.prepare("PRAGMA table_info(guilds)").all();
  if (cols.length > 0 && !cols.find((c) => c.name === 'instagram_enabled')) {
    db.exec('ALTER TABLE guilds ADD COLUMN instagram_enabled INTEGER DEFAULT 0');
    db.exec('ALTER TABLE guilds ADD COLUMN tiktok_enabled INTEGER DEFAULT 0');
    db.exec('ALTER TABLE guilds ADD COLUMN twitter_enabled INTEGER DEFAULT 0');
    console.log('[DB] Added social media toggle columns to guilds');
  }
} catch {}
```

### Updated `_updateGuildConfig`

Extend the existing positional prepared statement. New parameter order (appending 3 new columns after `weekly_highlights_enabled`):

```sql
UPDATE guilds SET
  twitch_live_channel_id = ?,
  twitch_clips_channel_id = ?,
  youtube_channel_id = ?,
  welcome_channel_id = ?,
  sub_role_id = ?,
  welcome_message = ?,
  twitch_live_enabled = ?,
  twitch_clips_enabled = ?,
  youtube_enabled = ?,
  welcome_enabled = ?,
  sub_sync_enabled = ?,
  recap_enabled = ?,
  milestones_enabled = ?,
  weekly_highlights_enabled = ?,
  instagram_enabled = ?,
  tiktok_enabled = ?,
  twitter_enabled = ?
WHERE guild_id = ? AND streamer_id = ?
```

### Tier gating

| Property | Free | Starter | Pro | Enterprise |
|---|---|---|---|---|
| `instagram` | `false` | `true` | `true` | `true` |
| `tiktok` | `false` | `true` | `true` | `true` |
| `twitter` | `false` | `true` | `true` | `true` |
| `maxSocialAccounts` | `0` | `3` | `20` | `-1` |

`maxSocialAccounts` is the combined limit across all three platforms per guild.

---

## Services

### `src/services/instagram.js`

```js
const RSSHUB_INSTANCES = ['https://rsshub.app', 'https://rsshub.rssforever.com', 'https://rsshub-instance.zeabur.app'];
```

- `resolveProfile(username)` — fetch `https://www.instagram.com/{username}/`, extract `og:image` and `og:title` from HTML. Returns `{ username, displayName, profileImageUrl }` or null.
- `getLatestPosts(username)` — try each RSSHub instance: fetch `/instagram/user/{username}`, parse XML with fast-xml-parser. Extract post ID (from guid/link), image URL, caption, post link, timestamp. Returns array. Cap at 20 items.

### `src/services/tiktok.js`

Same `RSSHUB_INSTANCES` array.

- `resolveProfile(username)` — fetch `https://www.tiktok.com/@{username}`, extract `og:image` and `og:title`. Returns `{ username, displayName, profileImageUrl }` or null.
- `getLatestVideos(username)` — try each RSSHub instance: fetch `/tiktok/user/{username}`, parse XML. Extract video ID, thumbnail, description, video URL, timestamp. Returns array. Cap at 20 items.

### `src/services/twitter.js`

Same `RSSHUB_INSTANCES` array.

- `resolveProfile(username)` — fetch `https://unavatar.io/twitter/{username}` for profile image. Try RSSHub feed for display name. Returns `{ username, displayName, profileImageUrl }` or null.
- `getLatestTweets(username)` — try each RSSHub instance: fetch `/twitter/user/{username}`, parse XML. Extract tweet ID, text, media URLs, tweet link, timestamp. Returns array. Cap at 20 items.
- `checkAvailability()` — try fetching a known account's feed. Returns boolean.

**Rate limiting:** Add 2-second delay between requests when polling multiple accounts sequentially to avoid hammering RSSHub instances.

---

## Pollers

### `src/pollers/instagramFeed.js`

- `check(instagramUsername, accountState)` — fetch latest posts via service, compare against `known_post_ids`, return new posts. Cap known IDs at 50.
- Returns `{ notify, postData: [{ embed }], stateUpdate }` or null.
- On fetch failure: log warning, skip cycle. After 5 consecutive failures (tracked via counter in state or in-memory), set `available = 0` in state.

### `src/pollers/tiktokFeed.js`

- `check(tiktokUsername, accountState)` — same pattern. Returns `{ notify, videoData: [{ embed }], stateUpdate }` or null.

### `src/pollers/twitterFeed.js`

- `check(twitterUsername, accountState)` — same pattern. Returns `{ notify, tweetData: [{ embed }], stateUpdate }` or null.
- Checks `available` flag before fetching. If unavailable, tries once per cycle to see if service recovered.

### Polling intervals

All three poll every 10 minutes (configurable via env vars):
- `INSTAGRAM_FEED_INTERVAL` — default `600_000`
- `TIKTOK_FEED_INTERVAL` — default `600_000`
- `TWITTER_FEED_INTERVAL` — default `600_000`

### Registration in `manager.js`

Add `pollAllInstagram()`, `pollAllTikTok()`, `pollAllTwitter()` functions following the YouTube fan-out pattern. Register in `startAll()` with `setInterval`. **Do not call immediately on startup** (matching YouTube pattern, not Twitch) — first poll happens after the interval.

### Notification delivery

All three platforms use **custom embeds** (not plain text links), because Discord does not generate good auto-previews for Instagram and TikTok links. This is an intentional deviation from the YouTube/clips plain-text approach.

Profile image for the embed author icon comes from the `profile_image_url` column in the watched account table (joined via the watcher query).

---

## Discord Embeds

New embed builder functions in `src/discord.js`:

### `buildInstagramEmbed({ username, displayName, profileImageUrl, caption, postUrl, imageUrl, timestamp })`
- **Color:** `#E1306C`
- **Author:** `{displayName} posted on Instagram` with profile image
- **Title:** caption preview (first 100 chars)
- **URL:** post link
- **Image:** post image
- **Footer:** `Instagram` + timestamp

### `buildTikTokEmbed({ username, displayName, profileImageUrl, description, videoUrl, thumbnailUrl, timestamp })`
- **Color:** `#010101`
- **Author:** `{displayName} posted on TikTok` with profile image
- **Title:** description preview (first 100 chars)
- **URL:** video link
- **Image:** video thumbnail
- **Footer:** `TikTok` + timestamp

### `buildTwitterEmbed({ username, displayName, profileImageUrl, text, tweetUrl, mediaUrl, timestamp })`
- **Color:** `#1DA1F2`
- **Author:** `{displayName} tweeted` with profile image
- **Description:** full tweet text
- **URL:** tweet link
- **Image:** first media attachment if any
- **Footer:** `Twitter` + timestamp

---

## Notification Log Types

- `'instagram_post'`
- `'tiktok_video'`
- `'twitter_tweet'`

### Stats queries requiring update

The following queries in `db.js` enumerate specific notification types and need new `CASE WHEN` clauses:
- `_getGuildNotificationStats` (line ~561) — add `instagram_post_count`, `tiktok_video_count`, `twitter_tweet_count`
- `_getGuildStatsByPeriod` (line ~579) — same additions
- `_getGuildStatsLifetime` (line ~594) — same additions
- `_getGuildNotificationsByTypeOverTime` — works automatically (groups by `type`)

The dashboard chart `typeKeys`, `typeColors`, and `typeNames` arrays in `dashboard.ejs` need three new entries.

---

## Route Changes

### `src/routes/dashboard.js`

**Guild config route** (`GET /guild/:guildId`):
- Pass `watchedInstagramAccounts`, `watchedTikTokAccounts`, `watchedTwitterAccounts` to the template.
- Backfill missing profile images/display names on page load.

**New CRUD routes (same pattern per platform):**

Instagram:
- `POST /guild/:guildId/instagram` — add (resolve profile, pre-populate known IDs, check tier limit)
- `POST /guild/:guildId/instagram/:id/edit` — edit notification channel
- `POST /guild/:guildId/instagram/:id/remove` — remove

TikTok:
- `POST /guild/:guildId/tiktok` — add
- `POST /guild/:guildId/tiktok/:id/edit` — edit
- `POST /guild/:guildId/tiktok/:id/remove` — remove

Twitter:
- `POST /guild/:guildId/twitter` — add
- `POST /guild/:guildId/twitter/:id/edit` — edit
- `POST /guild/:guildId/twitter/:id/remove` — remove

**Tier check:** Validate `maxSocialAccounts` limit — count total across all three `watched_*_accounts` tables for the guild+streamer.

**Pre-population:** When adding an account, fetch current content via RSSHub and store IDs as known to prevent old content spam.

### `POST /guild/:guildId` (Discord config save)

Add `instagram_enabled`, `tiktok_enabled`, `twitter_enabled` to the config update. Match updated `_updateGuildConfig` parameter order.

---

## Config Changes

### `src/config.js`

Add to `intervals`:
```js
instagramFeed: parseInt(process.env.INSTAGRAM_FEED_INTERVAL) || 600_000,
tiktokFeed: parseInt(process.env.TIKTOK_FEED_INTERVAL) || 600_000,
twitterFeed: parseInt(process.env.TWITTER_FEED_INTERVAL) || 600_000,
```

Add to each tier:
```js
instagram: false/true,
tiktok: false/true,
twitter: false/true,
maxSocialAccounts: 0/3/20/-1,
```

---

## Files Changed / Created

**Created:**
- `src/services/instagram.js` — Instagram RSSHub client + profile resolver
- `src/services/tiktok.js` — TikTok RSSHub client + profile resolver
- `src/services/twitter.js` — Twitter RSSHub client + profile resolver
- `src/pollers/instagramFeed.js` — Instagram poller
- `src/pollers/tiktokFeed.js` — TikTok poller
- `src/pollers/twitterFeed.js` — Twitter poller

**Modified:**
- `src/config.js` — new tier flags (`instagram`, `tiktok`, `twitter`, `maxSocialAccounts`), new intervals
- `src/db.js` — Migration 8 (guild toggles), 6 new tables, CRUD queries, extended `updateGuildConfig`, updated stats queries
- `src/discord.js` — 3 new embed builders (`buildInstagramEmbed`, `buildTikTokEmbed`, `buildTwitterEmbed`)
- `src/pollers/manager.js` — register 3 new pollers, add `pollAllInstagram()`, `pollAllTikTok()`, `pollAllTwitter()` with 2s inter-request delay
- `src/routes/dashboard.js` — 9 new CRUD routes, guild config data consolidation, tier checks, backfill
- `src/views/guild-config.ejs` — 3 new tabs with add/edit/remove UI, platform icons and colors
- `src/views/header.ejs` — `.tab-instagram`, `.tab-tiktok`, `.tab-twitter` CSS classes
- `src/views/dashboard.ejs` — new types in chart `typeKeys`/`typeColors`/`typeNames` arrays

## Edge Cases

- **Private accounts:** Instagram/TikTok private accounts won't have RSS data. Show error "Could not find posts for this account — it may be private."
- **Account doesn't exist:** RSSHub returns 404 or empty feed. Show "Account not found."
- **Rate limiting:** 2-second delay between requests per platform when polling multiple accounts sequentially.
- **All RSSHub instances down:** Mark platform unavailable in state. Dashboard shows warning. Auto-recover on next success.
- **Old content spam:** Pre-populate known IDs on add (cap at 50).
- **Profile info changes:** Backfill on guild config page load refreshes stale data.
- **Known ID array growth:** Capped at 50 entries per account (`.slice(-50)`).

## Future Enhancements (Out of Scope)

- Cross-platform stats dashboard (separate spec)
- Content publishing to social platforms
- Kick, Facebook, Threads monitoring
- Filtering by content type (Reels only, etc.)
- Self-hosted RSSHub instance for reliability
