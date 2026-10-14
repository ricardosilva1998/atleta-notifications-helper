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

**Viewer redeems.** EventSub fires `channel.channel_points_custom_reward_redemption.add` (for every custom reward on the channel, including ones this app did not make). `eventsub.js` drops a notification it has already seen (same `message_id`, remembered 10 minutes) and hands the rest to `redemptionDispatcher.handleRedemption()`:

1. Looks up reward by `twitch_reward_id`. A reward this app does not manage (made on Twitch itself or by another app) is left alone: no history row, no refund, no sync.
2. Records the redemption before anything else (`db.claimRedemption()`, outcome `pending`; the unique `twitch_redemption_id` index makes a repeat delivery a no-op), so a redemption Twitch delivers twice plays, refunds and fulfils once.
3. A reward that is switched off here, deleted here while Twitch still has it (`delete_failed`, see Edits and Deletes), or any reward while **Enable Channel Point Rewards** (`streamers.cp_rewards_enabled`) is off, does not play: the redemption is CANCELED on Twitch so the viewer gets their points back (`refundUnavailableReward()`; only a redemption still `unfulfilled` can be canceled). The outcome says which of the three it was (`refunded_disabled`, `refunded_deleted`, `refunded_switch_off`, see History); a reward that is itself off or waiting to be deleted wins over the switch.
4. Verifies file on disk. If missing → auto-CANCELED + chat warning.
5. Emits `redemption` event to `overlayBus`.
6. Optionally posts chat message (template formatted via `redemptionTemplates.formatChatTemplate`, sent with `chatManager.sendMessage()` so it goes through the shared chat dispatcher like every other line the bot posts).
7. Schedules auto-fulfill via Helix PATCH at `maxPlaySeconds + 1s`.
8. Sets the outcome on the history row (`db.setRedemptionOutcome()`).

**Overlay plays.** `playRedemption()` in `public/overlay/overlay.js` queues the event and plays the clip in dedicated `<audio id="redemption-audio">` / `<video id="redemption-video">` elements (separate from the alert-card path). `finalVolume = overlayMaster × rewardVolume`.

**Test button.** `POST /dashboard/redemptions/:id/test` emits a synthetic redemption event straight to the overlay — no Twitch call, no chat send. Logged with `is_test=1`.

## Auth & Affiliate Gating

- Requires `channel:manage:redemptions` scope on broadcaster auth. Existing streamers see a yellow "Reconnect Twitch" banner until they re-auth.
- EventSub silently skips the redemption subscribe call for streamers without the scope (no log noise; other notifications keep working).
- Twitch Affiliate or Partner status required. `createReward` returns `{ affiliateGated: true }` on 403; UI shows red banner.

## Edits and Deletes

An edit or delete in the dashboard is reported as done only when Twitch took it (`twitchRewards.js`). `channel_point_rewards.twitch_sync_status` records what is owed to Twitch, with the reason in `twitch_sync_error`:

| `twitch_sync_status` | Meaning |
|---|---|
| `ok` | In step with Twitch |
| `update_failed` | An edit is saved here but Twitch refused it. The reward shows a warning and a Retry button; the next edit (or a retry, or a sync) sends everything Twitch keeps (title, cost, prompt, cooldown, paused), not only that edit |
| `delete_failed` | Deleted here but Twitch refused to delete it (not a 404, which means it is already gone). The row is kept, hidden from the list and shown under "Not deleted on Twitch" with a Retry button; redemptions of it are refunded |
| `create_failed`, `no_affiliate`, `orphaned` | Unchanged: creation failed, not an affiliate, no longer on Twitch |

A PATCH or DELETE the dashboard sends answers `502 { ok: false, error, reward }` when Twitch refused it. `POST /dashboard/redemptions/:id/retry` retries whichever is pending. Every Helix request has a 10 s timeout.

## Sync

`syncRewards()` reconciles local DB with upstream:
- **Twitch is source of truth** for title, cost, prompt, **paused** (`is_paused` = disabled here) and the **cooldown** (an off cooldown is 0), for a reward that is in step. Twitch's list answer nests the cooldown (`global_cooldown_setting: { is_enabled, global_cooldown_seconds }`); the flat `is_global_cooldown_enabled` / `global_cooldown_seconds` are request fields only (`upstreamCooldownSeconds()`). A reward that says nothing about a cooldown keeps the local one.
- A reward with `update_failed` is **sent** to Twitch instead (what is here wins until Twitch has it); one with `delete_failed` is **deleted** again, or dropped when Twitch no longer lists it.
- A reward Twitch no longer lists is `orphaned`; a reward never created there is created.
- **Local-only fields:** media file, position, volume, chat template.

## History

Logged to `channel_point_redemptions` with `outcome` ∈ `{ pending, played, refunded_no_file, refunded_disabled, refunded_deleted, refunded_switch_off, disabled, error, test }`. `pending` is a redemption being handled (it is recorded before anything is done for it). `refunded_disabled` / `refunded_deleted` / `refunded_switch_off` mean a redemption was canceled, and why: the reward is off here / is waiting to be deleted (`delete_failed`) / the **Enable Channel Point Rewards** switch is off while the reward itself is fine (so the history does not blame a reward that is on); `disabled` is such a redemption that could not be canceled (it was not `unfulfilled`); `error` with `refund failed: ...` is a cancel Twitch refused (or an affiliate-gated 403). Redemptions of rewards this app does not manage are not logged. The history page labels every outcome (`redemptions.outcome.*` keys) and never shows the raw code.

## DB Columns Added on `streamers`

- `cp_rewards_enabled` (in `OVERLAY_COLUMNS` whitelist so `updateOverlayConfig()` accepts it via the existing settings route). The master switch **Enable Channel Point Rewards**: while it is off, redemptions are refunded instead of played, and a hint under the switch says so (it turns warning-coloured while the switch is off). It was not read before; a one-time data migration (`cp_rewards_enabled_for_existing_rewards`, recorded in `data_migrations`) switched it on for every streamer who had an enabled reward, so nothing that played stopped. New streamers start with it off, and **creating their first reward switches it on** (`POST /dashboard/redemptions/upload` sees that the streamer had no reward and the switch was off, then answers `rewardsSwitchedOn: true`; the page says so and ticks the toggle). After that the switch is theirs: a later reward never turns it back on, and deleting every reward and adding one again switches it on again.
- `cp_affiliate_status` ∈ `{ unknown, ok, not_affiliate }`
- `cp_last_sync_at`

## Critical: EJS sandbox

The dashboard route MUST pre-compute `hasScope` via `hasRedemptionScope(req.streamer)` from `services/twitch.js` and pass it as a template local. Express's EJS integration does NOT expose `require()` to templates — calling `require('../services/twitch')` from within EJS will throw `require is not defined` and crash the page. This is a general convention (also documented in root CLAUDE.md), but it bit us specifically here.

## Pure Helper

`formatChatTemplate({user},{title},{cost})` lives in `redemptionTemplates.js` (no external deps) so it can be unit-tested without env vars. Same pattern as `incidentTracker.js` / `flagState.js` in bridge. Regex single-pass replacement prevents double-substitution when a user value contains a placeholder string (e.g., user=`{cost}`).

## Files

- `src/services/twitchRewards.js` — Helix client (list/create/update/delete, fulfill/cancel, syncRewards, Affiliate-gate detection) and the sync-status logic: `pushRewardChanges()`, `removeReward()`, `retryPending()`, `refundRedemption()`, `unavailableReason()`
- `src/services/redemptionDispatcher.js` — full redemption flow (`refundUnavailableReward()` for rewards that are off or waiting to be deleted)
- `src/services/redemptionTemplates.js` — pure `formatChatTemplate` helper
- `src/services/messageDedupe.js` — the 10-minute `message_id` memory `eventsub.js` uses to drop a notification Twitch delivers twice
- `src/services/redemptionDispatcher.test.js` — the template helper, and the redemption flow (a repeat delivery acted on once, recorded before anything happens, the master switch, rewards the app does not manage)
- `src/services/twitchRewards.test.js` — sync-status transitions, sync, refunds (in-memory DB, fake Helix)
- `src/routes/dashboard.js` — `/dashboard/redemptions` GET/POST (precomputes `hasScope`)
- `src/views/redemptions-config.ejs` — UI: affiliate/scope banners, master toggle, sync button, drag-reorder reward cards, add/edit modal with media upload + position picker + live preview, recent redemptions table
- `public/overlay/overlay.js` — `playRedemption()`, `stopRedemption()`, `_redemptionCapTimer`
