# Channel Point Rewards

Native Twitch Channel Points → audio/video clips on the OBS overlay. Streamers create rewards in `/dashboard/redemptions`, viewers redeem on Twitch, and the matching clip plays on stream.

## Reward Configuration

- **Title:** 2–45 chars
- **Cost:** 1–1,000,000
- **Cooldown** and **prompt** optional
- **Media:** audio mp3/wav/ogg ≤5MB or video mp4/webm ≤20MB
- **Position:** preset (top-left, top-right, etc.) or custom rect
- **Volume:** 0.0–1.0
- **Max-play:** 1–60s (hard cap on playback duration)
- **Chat announcement template:** supports `{user}`, `{title}`, `{cost}` placeholders
- **Auto-fulfill toggle:** mark as completed in Twitch after `maxPlaySeconds + 1s`

## Storage

- DB: `channel_point_rewards` table holds local reward records. The Twitch reward id is stored in `twitch_reward_id` (returned from Helix POST).
- Files: `data/redemptions/{streamerId}/{rewardId}_{timestamp}.{ext}`. Served via `/redemptions/*` static route with Cache-Control 24h. Filenames include the timestamp so cache headers stay safe across replacements (replacement uploads delete the old file).
- Audio cap 5MB; video cap 20MB.

## Backend Flow

**Create a reward.** Backend POSTs to `/helix/channel_points/custom_rewards` and stores the returned `reward.id` in `channel_point_rewards`.

**Viewer redeems.** EventSub fires `channel.channel_points_custom_reward_redemption.add`. `eventsub.js` hands off to `redemptionDispatcher.handleRedemption()`:

1. Looks up reward by `twitch_reward_id`.
2. Verifies file on disk. If missing → auto-CANCELED + chat warning.
3. Emits `redemption` event to `overlayBus`.
4. Optionally posts chat message (template formatted via `redemptionTemplates.formatChatTemplate`).
5. Schedules auto-fulfill via Helix PATCH at `maxPlaySeconds + 1s`.

**Overlay plays.** `playRedemption()` in `public/overlay/overlay.js` queues the event and plays the clip in dedicated `<audio id="redemption-audio">` / `<video id="redemption-video">` elements (separate from the alert-card path). `finalVolume = overlayMaster × rewardVolume`.

**Test button.** `POST /dashboard/redemptions/:id/test` emits a synthetic redemption event straight to the overlay — no Twitch call, no chat send. Logged with `is_test=1`.

## Auth & Affiliate Gating

- Requires `channel:manage:redemptions` scope on broadcaster auth. Existing streamers see a yellow "Reconnect Twitch" banner until they re-auth.
- EventSub silently skips the redemption subscribe call for streamers without the scope (no log noise; other notifications keep working).
- Twitch Affiliate or Partner status required. `createReward` returns `{ affiliateGated: true }` on 403; UI shows red banner.

## Sync

`syncRewards()` reconciles local DB with upstream:
- **Twitch is source of truth** for title, cost, and prompt.
- **Local-only fields:** media file, position, volume, chat template.

## History

Logged to `channel_point_redemptions` with `outcome` ∈ `{ played, refunded_no_file, disabled, error, test }`.

## DB Columns Added on `streamers`

- `cp_rewards_enabled` (in `OVERLAY_COLUMNS` whitelist so `updateOverlayConfig()` accepts it via the existing settings route)
- `cp_affiliate_status` ∈ `{ unknown, ok, not_affiliate }`
- `cp_last_sync_at`

## Critical: EJS sandbox

The dashboard route MUST pre-compute `hasScope` via `hasRedemptionScope(req.streamer)` from `services/twitch.js` and pass it as a template local. Express's EJS integration does NOT expose `require()` to templates — calling `require('../services/twitch')` from within EJS will throw `require is not defined` and crash the page. This is a general convention (also documented in root CLAUDE.md), but it bit us specifically here.

## Pure Helper

`formatChatTemplate({user},{title},{cost})` lives in `redemptionTemplates.js` (no external deps) so it can be unit-tested without env vars. Same pattern as `incidentTracker.js` / `flagState.js` in bridge. Regex single-pass replacement prevents double-substitution when a user value contains a placeholder string (e.g., user=`{cost}`).

## Files

- `src/services/twitchRewards.js` — Helix client (list/create/update/delete, fulfill/cancel, syncRewards, Affiliate-gate detection)
- `src/services/redemptionDispatcher.js` — full redemption flow
- `src/services/redemptionTemplates.js` — pure `formatChatTemplate` helper
- `src/services/redemptionDispatcher.test.js` — unit tests
- `src/routes/dashboard.js` — `/dashboard/redemptions` GET/POST (precomputes `hasScope`)
- `src/views/redemptions-config.ejs` — UI: affiliate/scope banners, master toggle, sync button, drag-reorder reward cards, add/edit modal with media upload + position picker + live preview, recent redemptions table
- `public/overlay/overlay.js` — `playRedemption()`, `stopRedemption()`, `_redemptionCapTimer`
