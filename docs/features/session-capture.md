# Session Capture Pipeline

Bridge captures per-lap data + 10Hz telemetry traces during P/Q/R/Offline Testing sessions and uploads progressively to the server. Drivers can review every lap they ever drove on the Track Database page.

## Bridge Side

`bridge/sessionRecorder.js` buffers 10Hz telemetry per lap and uploads progressively:

1. **Session created on first lap** — `POST /api/session`
2. **Each subsequent lap appended immediately** — `POST /api/session/:id/lap`
3. **Session finalized on end** — `PATCH /api/session/:id/finish`

Telemetry stored as gzip-compressed JSON arrays (pako) in `lap_telemetry` table.

Failed uploads queued to `pending-sessions.json` and retried on next startup.

## Server Side

### DB Tables

- `racing_sessions` — session metadata, privacy, share tokens. **Note:** separate from web auth `sessions` table; query functions are `getRacingSessionById` (not `getSessionById`) and `deleteRacingSession` (not `deleteSession`) to avoid collision with web auth session functions.
- `session_laps` — per-lap data
- `lap_telemetry` — compressed traces (gzip JSON)

### Public Endpoints (no auth middleware)

These are placed BEFORE the `/api` auth middleware in `server.js`:

- `POST /api/session` — create
- `POST /api/session/:id/lap` — append lap
- `PATCH /api/session/:id/finish` — finalize
- `GET /api/sessions/:trackName` — list by track
- `GET /api/session/:id` — get single (own session if logged in)
- `GET /api/session/share/:token` — get via shareable token

## Track Database Page (`/tracks`)

Standalone page accessible to both Streamer and Racing users. Grid/list view of all tracks. Detail page with **Practice** / **Race** tabs:
- **Practice tab** — recorded practice sessions
- **Race tab** — class-based race type statistics + recorded race sessions

Sessions expandable inline to show lap details (time, delta, fuel, temp). Import Race Data via modal popup (JSON / CSV / screenshot). 152 known iRacing tracks with category tags.

## Track Map System

Browser-side `.ibt` parser extracts Lat/Lon (radians→degrees) + track name from session YAML. Uploads to server under both geoId and display name. Bridge fetches by geoKey then by name. Track database viewer on dashboard shows canvas previews. Missing tracks list compares against ~50 known iRacing tracks.

Track map API endpoints (`GET /api/track-maps`, `GET /api/track-map/:name`, `POST /api/track-map`) are also public — placed BEFORE the `/api` auth middleware.

## Files

- `bridge/sessionRecorder.js` — capture and progressive upload
- `src/routes/api.js` — session + track-map endpoints
- `src/db.js` — session schema, queries, telemetry compression
- `src/views/tracks.ejs` — Track Database page
