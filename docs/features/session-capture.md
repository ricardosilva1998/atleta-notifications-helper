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

### What the routes store

Each value the app sends is brought to what its column holds before it is stored (the "What the Atleta Racing app's routes store" block in `src/server.js`). Everything the app sends today passes unchanged.

- **Numbers** (positions, times, temperatures, counts): a number, or text that is a number; anything else stores nothing. A lap needs a lap number and a lap time (`400 Missing lap data` otherwise); `sector_times` is stored only as a list of at most 64 numbers; the weather keeps the app's five keys (`airTemp`, `trackTemp`, `humidity`, `skies`, `windSpeed`).
- **Text** is cut to a length: iRacing name, car class and car name 100; track name 200; race type 40 (64 for track stats); country and city 80. The session type is a short word of letters (the app sends `practice`, `qualify` or `race`); without one the session is refused (`400 Missing session fields`). Telemetry is stored only as text.
- **`bridge_id`** is 8–64 letters, digits and dashes (`src/bridgeId.js`, the form of the app's `crypto.randomUUID()`). `POST /api/session`, `POST /api/bridge-logs` and `POST /api/bridge-bug-reports` answer 400 otherwise, and Racing sign-up and the app's login link an id only of that shape.
- **Track maps:** the length looks like `5.79 km` or `3.5 mi`; turns are a whole number from 1 to 200. A stored track keeps its details: an upload only fills in the empty ones, and replaces the outline only when it has more points.
- **Track stats:** `stats` must be an object (`400 Invalid stats`). Per car class the numbers are numbers or 0, the category is `road`, `formula`, `oval`, `dirt_oval` or `dirt_road` (else `road`), the class name is cut to 64 and the top car to 100.
- **Live session** (`POST /api/live-session`): only `trackName`, `eventType`, `classes` (at most 12 names), `driversCount`, `totalMinutes`, `timeRemain` and `raceType` are kept.
- The app's account and Spotify calls (`/api/bridge/account`, `/api/bridge/spotify`, `/api/bridge/spotify/control`) treat a disabled streamer as no linked streamer.

## Track Database Page (`/tracks`)

Standalone page accessible to both Streamer and Racing users. Grid/list view of all tracks. Detail page with **Practice** / **Race** tabs:
- **Practice tab** — recorded practice sessions
- **Race tab** — class-based race type statistics + recorded race sessions

Sessions expandable inline to show lap details (time, delta, fuel, temp). Import Race Data via modal popup (JSON / CSV / screenshot). 152 known iRacing tracks with category tags. The page and the iRacing page print every stored value as text, and a number that is not one shows `--` (`tests/racingViews.test.js`).

## Track Map System

Browser-side `.ibt` parser extracts Lat/Lon (radians→degrees) + track name from session YAML. Uploads to server under both geoId and display name. Bridge fetches by geoKey then by name. Track database viewer on dashboard shows canvas previews. Missing tracks list compares against ~50 known iRacing tracks.

Track map API endpoints (`GET /api/track-maps`, `GET /api/track-map/:name`, `POST /api/track-map`) are also public — placed BEFORE the `/api` auth middleware.

## Files

- `bridge/sessionRecorder.js` — capture and progressive upload
- `src/server.js` — the public session, track-map, track-stats, live-session, log and bug-report routes, and the rules above
- `src/bridgeId.js` — the bridge id check
- `src/db.js` — session schema, queries, telemetry compression
- `src/views/tracks.ejs` — Track Database page
