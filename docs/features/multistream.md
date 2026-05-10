# Multistream (Twitch + YouTube Passthrough)

Streamers point OBS at a self-hosted MediaMTX relay and the server forwards a single ingest into both Twitch and YouTube simultaneously — pure passthrough, no re-encoding, no PC-side cost.

For operator-side setup (Oracle VM + MediaMTX install + Cloudflare Tunnel + DNS) see `docs/multistream-relay-setup.md`. For the resume checklist (what's still pending on the live deployment) see `docs/multistream.md`.

## Ingest

Streamer sets OBS to `rtmp://ingest.atletanotifications.com/live/<token>` (a self-hosted MediaMTX server, free on Oracle Cloud Always Free tier).

## Relay Flow

**On stream start (`runOnReady` webhook → `POST /api/multistream/webhook/on-ready`):**

1. Fetch the streamer's Twitch RTMP key via Helix `streams/key` (requires `channel:read:stream_key` scope on broadcaster auth).
2. Create+bind a YouTube `liveBroadcast` via Data API v3 using stored defaults (privacy / category / optional default-title; falls back to current Twitch stream title).
3. Call MediaMTX `/v3/config/paths/add/*` to spawn one `ffmpeg -c copy` forwarder per destination — pure passthrough.

Async after the webhook returns: poll `liveStreams.status` until `streamStatus=active`, then `transition→live`.

**On stream stop (`runOnNotReady`):** remove forwarders + `transition→complete` for the broadcast.

## Dashboard

`/dashboard/multistream`:
- OAuth connection status (Connect Twitch / Connect YouTube buttons — never paste-key UI)
- Enable toggle
- Ingest URL + per-streamer stream key
- YouTube broadcast defaults
- Recommended OBS settings (1080p60 @ 6 Mbps, NVENC)

## DB Columns on `streamers`

- `multistream_enabled`
- `multistream_token` — unique base64url
- `multistream_youtube_stream_id` — reusable YT liveStream id
- `multistream_youtube_stream_key_enc` — AES-256-GCM via `services/streamKeyCrypto.js`, key from `MULTISTREAM_KEY_SECRET` (64-char hex, generate with `openssl rand -hex 32`)
- `multistream_youtube_privacy`, `multistream_youtube_category_id`, `multistream_youtube_default_title`
- `multistream_active_broadcast_id`

## Quota

~200 YouTube units/session (insert + bind + 2× transition). Default daily quota 10k = ~50 sessions/day before increase needed.

## Status as of 2026-05-10

Code shipped, 16 unit tests green, dashboard renders. Oracle VM + MediaMTX install + DNS + Railway env vars are still pending — feature shows "relay not configured" warning until those are done. Resume checklist at `docs/multistream.md`.

## Files

- `src/services/multistreamRelay.js` — MediaMTX HTTP API client (add/remove per-streamer ffmpeg forwarder paths)
- `src/services/youtubeBroadcast.js` — YouTube Data API v3 broadcast lifecycle (getOrCreateLiveStream, createBroadcast, bind, transition live/complete)
- `src/services/streamKeyCrypto.js` — AES-256-GCM helpers for at-rest encryption of platform stream keys
- `src/routes/multistream.js` — dashboard page + webhooks (on-ready / on-not-ready)
- `src/views/multistream.ejs` — dashboard UI

## Required Env Vars

- `MEDIAMTX_API_URL`, `MEDIAMTX_INGEST_URL`, `MEDIAMTX_API_TOKEN`, `MEDIAMTX_WEBHOOK_SECRET`
- `MULTISTREAM_KEY_SECRET`
