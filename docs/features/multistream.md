# Multistream (Twitch + YouTube Passthrough)

Streamers point OBS at a self-hosted MediaMTX relay and the server forwards a single ingest into both Twitch and YouTube simultaneously — pure passthrough, no re-encoding, no PC-side cost.

For operator-side setup (Oracle VM + MediaMTX install + Cloudflare Tunnel + DNS) see `docs/multistream-relay-setup.md`. For the resume checklist (what's still pending on the live deployment) see `docs/multistream.md`.

## Switched off until the relay exists

`config.multistream.enabled` is true only with all four of `MEDIAMTX_API_URL`, `MEDIAMTX_INGEST_URL`, `MEDIAMTX_API_TOKEN` and `MEDIAMTX_WEBHOOK_SECRET`. Until then the dashboard card is hidden, `/dashboard/multistream` redirects to `/dashboard`, every `/api/multistream/*` route answers 404, and the boot neither reconciles broadcasts nor checks the relay. Saved settings are kept.

## Ingest

Streamer sets OBS to server `rtmp://ingest.atletanotifications.com/live` with their stream key (`multistream_token`), i.e. the relay path `live/<token>` (a self-hosted MediaMTX server, free on Oracle Cloud Always Free tier). "Regenerate stream key" on the page makes a new one (refused while live, or while the relay cannot say).

## Who may publish (`POST /api/multistream/auth`)

MediaMTX runs with `authMethod: http` and asks the website before every publish, read and control-API login (`services/multistreamAuth.js`): publish only to `live/<token>` of an enabled account with multistream on; read only from the relay itself (its forwarders); the control API only with `MEDIAMTX_API_USER` / `MEDIAMTX_API_TOKEN`; everything else refused. Every `/api/multistream` request must carry `MEDIAMTX_WEBHOOK_SECRET` (Bearer, or the Basic password of the address MediaMTX posts to).

## Relay Flow (`services/multistreamSessions.js`, one operation at a time per stream key)

**On stream start (`runOnAvailable` webhook → `POST /api/multistream/webhook/on-ready`):**

1. Ask the relay which forwarders the key already has; set up only what is missing.
2. Fetch the streamer's Twitch RTMP key via Helix `streams/key` (requires `channel:read:stream_key` scope on broadcaster auth).
3. YouTube: the stored reusable `liveStream` (a failed lookup is an error; only "no such stream" makes a new one). Reuse the current `liveBroadcast` while it is ready/testing/live; otherwise create one (title: the saved default, else the channel's Twitch title from Helix `GET /channels`, else the date; `<`/`>` removed, cut at 100 code points) and bind it. Broadcasts have `enableAutoStart` and `enableAutoStop`, so no transition to live is needed.
4. Call MediaMTX `/v3/config/paths/add/fwd_<token>_<dest>` (Basic auth) to spawn one `ffmpeg -c copy` forwarder per destination — pure passthrough.
5. A relay error answers 502 so MediaMTX's curl retries; a go-live that reached only some platforms is shown on the page (`multistream_last_error`).

**On stream stop (`runOnUnavailable` → `POST /api/multistream/webhook/on-not-ready`):** a minute later, unless the stream is back, remove the forwarders and `transition→complete` the broadcast. An OBS reconnect within the minute keeps the same broadcast.

**Every minute while enabled:** a stream on the relay missing a forwarder is set up again (retried 2/4/8/16 minutes later, then left until it reconnects); a stream of a disabled account or with multistream switched off loses its forwarders; forwarders whose stream is gone are stopped like a stream that ended. At boot, `youtubeBroadcast.reconcileActiveBroadcasts()` first finishes or closes broadcasts a restart interrupted.

## Dashboard

`/dashboard/multistream`:
- OAuth connection status (Connect Twitch / Connect YouTube buttons — never paste-key UI)
- Enable toggle
- Ingest URL + per-streamer stream key, and "Regenerate stream key"
- YouTube broadcast defaults (privacy and category limited to what the page offers)
- "You're live" from the relay's own view of `live/<token>` (asked with a 3 s deadline)
- Recommended OBS settings (1080p60 @ 6 Mbps, NVENC)

## DB Columns on `streamers`

- `multistream_enabled`
- `multistream_token` — unique base64url (the stream key); a disabled account's key finds nobody
- `multistream_youtube_stream_id` — reusable YT liveStream id
- `multistream_youtube_stream_key_enc` — unused (always empty: the YouTube key is read from YouTube at each go-live)
- `multistream_youtube_privacy`, `multistream_youtube_category_id`, `multistream_youtube_default_title`
- `multistream_active_broadcast_id`
- `multistream_last_started_at`, `multistream_last_error`, `multistream_last_error_at`

## Quota

About 150 YouTube units per session (liveStreams.list 1 + liveBroadcasts.insert 50 + bind 50 + transition→complete 50); a reconnect that reuses the broadcast costs 2. Default daily quota 10k.

## Files

- `src/services/multistreamRelay.js` — MediaMTX HTTP API client (Basic auth, timeouts; add/remove forwarders, path stats, lists for the minute check)
- `src/services/multistreamSessions.js` — go-live / stop / minute check, per-key lock
- `src/services/multistreamAuth.js` — who may publish, read and use the API
- `src/services/youtubeBroadcast.js` — YouTube Data API v3 broadcast lifecycle (getOrCreateLiveStream, createBroadcast, bind, status, transition complete, boot reconcile)
- `src/routes/multistream.js` — `dashboardRouter` (page, save, reset YouTube stream, regenerate key) and `apiRouter` (auth + webhooks), each mounted once in `server.js`
- `src/views/multistream.ejs` — dashboard UI

## Env Vars

- Required for the feature: `MEDIAMTX_API_URL`, `MEDIAMTX_INGEST_URL`, `MEDIAMTX_API_TOKEN`, `MEDIAMTX_WEBHOOK_SECRET`
- Optional: `MEDIAMTX_API_USER` (default `admin`), `MEDIAMTX_CF_ACCESS_CLIENT_ID` + `MEDIAMTX_CF_ACCESS_CLIENT_SECRET` (Cloudflare Access service token for the relay API hostname)
- `MULTISTREAM_KEY_SECRET` is no longer used.

## Status

Code shipped; the relay (Oracle VM + MediaMTX + DNS + Railway env vars) is not deployed, so the feature is switched off in production. Resume checklist at `docs/multistream.md`.
