# Social Media Notifications — Design Spec

## Problem

The bot currently only monitors Twitch and YouTube. Streamers create content across Instagram, TikTok, and Twitter/X but have no way to automatically notify their Discord communities about new posts on those platforms.

## Solution

Add Instagram, TikTok, and Twitter/X monitoring using free scraping/RSS approaches. When a creator posts new content on any platform, the bot sends a branded notification to a configured Discord channel. Follows the same UX pattern as the existing YouTube integration.

---

## Dashboard UI — New Platform Tabs

The guild config tab bar expands from 4 to 7 tabs:

**Twitch | YouTube | Instagram | TikTok | Twitter | Discord | Settings**

Each new tab follows the YouTube pattern:
- Single input for @username
- Dropdown to pick the Discord notification channel
- List of watched accounts with profile pictures, edit/remove buttons
- Platform-specific icon and color on the tab

**Tab colors:**
- Instagram: `#E1306C` (pink gradient)
- TikTok: `#000000` (black)
- Twitter/X: `#1DA1F2` (blue)

**Twitter status indicator:** If the Nitter bridge is down, the Twitter tab shows a warning badge and a message explaining the service is temporarily unavailable.

---

## Data Architecture

### New watched account tables

```sql
CREATE TABLE IF NOT EXISTS watched_instagram_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  streamer_id INTEGER NOT NULL REFERENCES streamers(id) ON DELETE CASCADE,
  instagram_username TEXT NOT NULL,
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
  last_checked TEXT
);

CREATE TABLE IF NOT EXISTS tiktok_account_state (
  tiktok_username TEXT PRIMARY KEY,
  known_video_ids TEXT DEFAULT '[]',
  last_checked TEXT
);

CREATE TABLE IF NOT EXISTS twitter_account_state (
  twitter_username TEXT PRIMARY KEY,
  known_tweet_ids TEXT DEFAULT '[]',
  last_checked TEXT,
  available INTEGER DEFAULT 1
);
```

### Guild toggle columns

Add to `guilds` table:
- `instagram_enabled INTEGER DEFAULT 0`
- `tiktok_enabled INTEGER DEFAULT 0`
- `twitter_enabled INTEGER DEFAULT 0`

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

- `resolveProfile(username)` — fetch `https://www.instagram.com/{username}/`, extract profile image from `og:image`, display name from `<title>`. Returns `{ username, displayName, profileImageUrl }` or null.
- `getLatestPosts(username)` — scrape the public profile page HTML for recent post data. Extract post shortcode (ID), image URL, caption preview, post URL, and timestamp. Returns array of post objects.

### `src/services/tiktok.js`

- `resolveProfile(username)` — fetch `https://www.tiktok.com/@{username}`, extract profile image from `og:image`, display name from `<title>`. Returns `{ username, displayName, profileImageUrl }` or null.
- `getLatestVideos(username)` — scrape the public profile page for recent videos. Extract video ID, thumbnail, description, video URL, and timestamp. Returns array of video objects.

### `src/services/twitter.js`

- `resolveProfile(username)` — fetch from Nitter instance to verify account exists and extract profile info. Returns `{ username, displayName, profileImageUrl }` or null.
- `getLatestTweets(username)` — fetch Nitter RSS feed at `https://nitter.net/{username}/rss`, parse XML with fast-xml-parser (already a dependency). Extract tweet ID, text, media URLs, tweet link, and timestamp. Returns array of tweet objects.
- `isAvailable()` — health check on Nitter instance. Returns boolean.

**Nitter fallback:** The Twitter service should try multiple Nitter instances. If the primary is down, try alternatives. List of instances stored in the service file, rotated on failure.

---

## Pollers

### `src/pollers/instagramFeed.js`

- `check(instagramUsername, accountState)` — fetch latest posts, compare against `known_post_ids`, return new posts.
- Same pattern as `youtubeFeed.js`: returns `{ notify, postData, stateUpdate }` or null.
- `postData` is an array of `{ message }` objects (plain text with link for Discord auto-embed, or null if embed is used).

### `src/pollers/tiktokFeed.js`

- `check(tiktokUsername, accountState)` — fetch latest videos, compare against `known_video_ids`, return new videos.
- Returns `{ notify, videoData, stateUpdate }` or null.

### `src/pollers/twitterFeed.js`

- `check(twitterUsername, accountState)` — fetch latest tweets from Nitter RSS, compare against `known_tweet_ids`, return new tweets.
- Returns `{ notify, tweetData, stateUpdate }` or null.
- On failure: increment failure count in state. After 5 consecutive failures, set `available = 0`. Continue polling — auto-recovers when bridge comes back.

### Polling intervals

All three poll every 10 minutes (configurable via env vars):
- `INSTAGRAM_FEED_INTERVAL` — default `600_000`
- `TIKTOK_FEED_INTERVAL` — default `600_000`
- `TWITTER_FEED_INTERVAL` — default `600_000`

### Registration in `manager.js`

Add imports for all three pollers and register them in `startAll()` with their respective intervals. Add `pollAllInstagram()`, `pollAllTikTok()`, `pollAllTwitter()` functions following the same fan-out pattern as YouTube.

---

## Discord Embeds

### Instagram Post Embed
- **Color:** `#E1306C`
- **Author:** profile image + `{displayName} posted on Instagram`
- **Title:** caption preview (first 100 chars)
- **URL:** post link
- **Image:** post image thumbnail
- **Footer:** `Instagram` + timestamp

### TikTok Video Embed
- **Color:** `#000000`
- **Author:** profile image + `{displayName} posted on TikTok`
- **Title:** description preview (first 100 chars)
- **URL:** video link
- **Image:** video thumbnail
- **Footer:** `TikTok` + timestamp

### Twitter/X Tweet Embed
- **Color:** `#1DA1F2`
- **Author:** profile image + `{displayName} tweeted`
- **Description:** full tweet text
- **URL:** tweet link
- **Image:** first media attachment if any
- **Footer:** `Twitter` + timestamp

New embed builder functions in `src/discord.js`:
- `buildInstagramEmbed({ username, displayName, profileImageUrl, caption, postUrl, imageUrl, timestamp })`
- `buildTikTokEmbed({ username, displayName, profileImageUrl, description, videoUrl, thumbnailUrl, timestamp })`
- `buildTwitterEmbed({ username, displayName, profileImageUrl, text, tweetUrl, mediaUrl, timestamp })`

---

## Notification Log Types

- `'instagram_post'`
- `'tiktok_video'`
- `'twitter_tweet'`

These integrate with the existing stats system — dashboard inline charts, account page metrics, guild stats page — automatically via the notification_log table.

---

## Route Changes

### `src/routes/dashboard.js`

**Guild config route** (`GET /guild/:guildId`):
- Pass `watchedInstagramAccounts`, `watchedTikTokAccounts`, `watchedTwitterAccounts` to the template.
- Backfill missing profile images on page load (same as Twitch/YouTube).

**New CRUD routes:**
- `POST /guild/:guildId/instagram` — add Instagram account
- `POST /guild/:guildId/instagram/:id/edit` — edit notification channel
- `POST /guild/:guildId/instagram/:id/remove` — remove account
- Same pattern for `/tiktok/` and `/twitter/` routes

**Pre-population:** When adding an account, fetch current posts/videos/tweets and store as known to prevent old content spam.

**Tier check:** Validate `maxSocialAccounts` limit across all three platforms combined.

### `POST /guild/:guildId` (Discord config save)

Add `instagram_enabled`, `tiktok_enabled`, `twitter_enabled` to the config update.

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
- `src/services/instagram.js` — Instagram scraper
- `src/services/tiktok.js` — TikTok scraper
- `src/services/twitter.js` — Twitter/Nitter RSS client
- `src/pollers/instagramFeed.js` — Instagram poller
- `src/pollers/tiktokFeed.js` — TikTok poller
- `src/pollers/twitterFeed.js` — Twitter poller

**Modified:**
- `src/config.js` — new tier flags, intervals
- `src/db.js` — 6 new tables, migrations, CRUD queries, guild toggle columns, updateGuildConfig extension
- `src/discord.js` — 3 new embed builders
- `src/pollers/manager.js` — register 3 new pollers, add poll functions
- `src/routes/dashboard.js` — new CRUD routes, guild config data consolidation, tier checks
- `src/views/guild-config.ejs` — 3 new tabs (Instagram, TikTok, Twitter) with add/edit/remove UI
- `src/views/header.ejs` — new tab color classes

## Edge Cases

- **Private accounts:** Instagram/TikTok private accounts can't be scraped. Show an error "This account is private" when adding.
- **Account doesn't exist:** Return a clear error message in the dashboard.
- **Rate limiting:** Space out requests across accounts. Don't hammer one platform with all accounts at once.
- **Nitter instance down:** Try multiple instances. Mark unavailable after 5 failures. Auto-recover.
- **Old content spam:** Pre-populate known IDs on add (same fix as YouTube).
- **Account name changes:** Profile info is refreshed on guild config page load (backfill pattern).

## Future Enhancements (Out of Scope)

- Cross-platform stats dashboard (separate spec)
- Content publishing to social platforms
- Kick, Facebook, Threads monitoring
- Filtering by content type (Reels only, etc.)
