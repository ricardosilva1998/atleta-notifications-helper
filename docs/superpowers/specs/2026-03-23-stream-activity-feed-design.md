# Stream Activity Feed — Design Spec

## Problem

Paid features (clips, YouTube, sub sync) don't feel compelling enough to justify upgrading from the free tier. Users care most about keeping their Discord community engaged, but servers go quiet between streams. We need features that fill the dead air automatically with zero effort.

## Solution

Three new automated features that keep Discord servers active around stream activity:

1. **Stream Recaps** — post-stream summary embeds
2. **Weekly Highlights** — weekly digest of streaming activity
3. **Milestone Celebrations** — automatic announcements when follower/sub thresholds are crossed

All features are set-and-forget: toggle on in the dashboard, no further configuration needed. Targets non-technical users (small and mid-tier streamers).

---

## Feature 1: Stream Recaps

### Behavior

When a monitored Twitch channel goes offline, the bot posts a recap embed to the same channel where go-live notifications are sent.

### Embed Content

- Stream title and category
- Duration (time from live detection to offline detection)
- Top 3 clips created during the stream session (by view count)
- Stream thumbnail (last captured)

### Implementation

- Hook into the existing `twitchLive` poller's offline transition (state change: live → offline).
- On offline detection:
  1. Calculate stream duration from the stored `started_at` timestamp to now.
  2. Fetch clips from the Twitch Helix API filtered to the stream's time window (`started_at` to now). Select top 3 by `view_count`.
  3. Compose a Discord embed with the recap data.
  4. Post to the configured notification channel for that watcher.
- Store stream session data (start time, title, category, thumbnail URL) in poller state when the channel goes live, so it's available at offline time.

### Data Changes

- Extend `channel_state` (or `poller_state`) to store `stream_title`, `stream_category`, `stream_thumbnail_url`, and `stream_started_at` when a channel goes live.

### Edge Cases

- If no clips were created during the stream, omit the clips section from the embed.
- If the stream was very short (under 5 minutes), skip the recap to avoid noise from test/accidental streams.
- If the bot was restarted mid-stream, the start time may be missing. In that case, use the Twitch API's `started_at` field from the last known stream.

### Tier Gating

Starter and above.

---

## Feature 2: Weekly Highlights

### Behavior

Every Monday at 09:00 UTC, the bot posts a weekly digest embed to each configured guild summarizing the past 7 days of streaming activity.

### Embed Content

- Number of streams and total hours streamed
- Most popular clip of the week (highest view count), with link
- Categories/games played (deduplicated list)

### Implementation

- New poller: `src/pollers/weeklyDigest.js`
- Runs on a 1-hour interval, but only triggers the digest when the current time crosses Monday 09:00 UTC and the digest hasn't been posted for the current week yet.
- On trigger:
  1. For each guild with weekly highlights enabled, look up all watched Twitch channels.
  2. Query Twitch API for videos (type: archive) from the past 7 days per channel.
  3. Query Twitch API for clips from the past 7 days per channel, pick the one with the most views.
  4. Aggregate: count streams, sum durations, collect unique categories.
  5. Compose and post the digest embed to the configured notification channel.
- Track last digest date in a new `weekly_digest_state` table to prevent duplicate posts.

### Data Changes

- New table: `weekly_digest_state`
  - `guild_id` TEXT PRIMARY KEY
  - `last_digest_date` TEXT (ISO date of last Monday digest was posted)

### Edge Cases

- If no streams happened that week, post a short "No streams this week" message or skip entirely (skip is simpler and less noisy — go with skip).
- If a guild was just added mid-week, wait until the next Monday.
- Rate limits: batch API calls and respect Twitch rate limits. For guilds watching the same channel, reuse cached API responses.

### Tier Gating

Pro and above.

---

## Feature 3: Milestone Celebrations

### Behavior

When a monitored Twitch channel crosses a follower or subscriber milestone, the bot posts a celebratory embed.

### Milestones

**Follower milestones** (adaptive):
- Under 1,000 followers: every 100
- 1,000–10,000: every 500
- 10,000+: every 1,000

**Subscriber milestones** (fixed thresholds):
- 10, 25, 50, 100, 250, 500, 1,000, 2,500, 5,000, 10,000

### Implementation

- New table: `channel_milestones`
  - `channel_id` TEXT (Twitch channel ID)
  - `last_follower_count` INTEGER
  - `last_subscriber_count` INTEGER
  - `last_follower_milestone` INTEGER (last milestone that was announced)
  - `last_subscriber_milestone` INTEGER
- Check milestones during the `twitchLive` poller cycle (piggyback on existing polling, no new poller needed).
- On each poll, fetch the channel's current follower count from the Twitch API.
- Compare against `last_follower_milestone`. If a new milestone was crossed, post a celebration embed to all guilds watching that channel (that have milestones enabled).
- Subscriber counts: only available if the streamer has linked their Twitch broadcaster token (existing flow). Use the subscriptions API endpoint.

### Embed Content

- Celebration message (e.g., "Channel X just hit 500 followers!")
- Current count
- A fun visual (use colored embed + party-themed description)

### Edge Cases

- If a channel jumps over multiple milestones between polls (e.g., a raid), only announce the highest one reached.
- If follower count drops below a milestone and comes back, don't re-announce.
- Subscriber count requires broadcaster token — if not linked, only track follower milestones.

### Tier Gating

Starter and above.

---

## Tier Distribution

| Feature | Free | Starter (5 EUR/yr) | Pro (10 EUR/yr) | Enterprise (25 EUR/yr) |
|---|---|---|---|---|
| Stream Recaps | No | Yes | Yes | Yes |
| Milestone Celebrations | No | Yes | Yes | Yes |
| Weekly Highlights | No | No | Yes | Yes |

## Dashboard Changes

Add a new "Activity Feed" section to the guild configuration page with three toggles:
- Stream Recaps (on/off)
- Milestone Celebrations (on/off)
- Weekly Highlights (on/off, shown only for Pro+ tiers)

Each toggle shows a brief description of what it does. Disabled toggles for insufficient tiers show an "Upgrade" link.

## Database Changes Summary

1. Extend `channel_state` or `poller_state`: add `stream_title`, `stream_category`, `stream_thumbnail_url`, `stream_started_at` columns.
2. New table: `weekly_digest_state` (guild_id, last_digest_date).
3. New table: `channel_milestones` (channel_id, last_follower_count, last_subscriber_count, last_follower_milestone, last_subscriber_milestone).
4. Extend `guilds` or create `guild_features` table with boolean columns: `recap_enabled`, `milestones_enabled`, `weekly_highlights_enabled`.

## Files Changed / Created

- **Modified:** `src/pollers/twitchLive.js` — add recap posting on offline transition, milestone checking on each poll
- **Modified:** `src/db.js` — new tables, migrations, query functions
- **Modified:** `src/config.js` — add new feature flags to tier definitions
- **Modified:** `src/discord.js` — new embed builder functions for recaps, digests, milestones
- **Modified:** `src/routes/dashboard.js` — activity feed toggle endpoints
- **Modified:** `src/views/guild-config.ejs` — activity feed toggle UI
- **Modified:** `src/pollers/manager.js` — register weekly digest poller
- **Created:** `src/pollers/weeklyDigest.js` — weekly digest poller
