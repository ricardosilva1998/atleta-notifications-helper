# Atleta Racing — Electron Desktop App

This directory holds the Electron app shipped to drivers as **Atleta Racing** (renamed from "Atleta Bridge" in v3.26.0 — directory name `bridge/` and npm package `atleta-bridge` kept for stability). It reads iRacing telemetry via `@emiliosp/node-iracing-sdk` (koffi FFI to shared memory), displays transparent always-on-top overlays, and uplinks telemetry to the server for Team Pitwall.

Settings live in `~/Documents/Atleta Racing/settings.json` (legacy `~/Documents/Atleta Bridge/` directory auto-migrates on first launch of v3.26.0+).

## Directory Tree

```
bridge/
├── main.js               # Electron main — tray, login window, control panel, overlay windows, IPC, camera switch
├── login.html            # Racing account login/signup screen (shown on startup if not authenticated)
├── telemetry.js          # iRacing telemetry reader — standings, relative, fuel, wind, session info, iRating estimation, session recorder + incident tracker integration
├── incidentTracker.js    # Pure state machine: per-session offtracks/penalties/slow-laps with attributed time loss
├── test-incidentTracker.js # node:test suite (28 tests)
├── sidebarState.js       # Pure data helpers for control-panel sidebar (pushRecent, toggleFavorite, pruneStaleIds, isFavorite)
├── test-sidebarState.js  # node:test suite (15 tests)
├── flagState.js          # Pure state machine: flag priority ladder, dwell, blue cooldown + dropout debounce
├── test-flagState.js     # node:test suite (27 tests)
├── sessionRecorder.js    # Session capture — buffers 10Hz telemetry per lap, progressive upload to server
├── websocket.js          # WebSocket server (ws://localhost:9100) — per-client channel subscriptions, driver selection
├── pitwallUplink.js      # Team Pitwall uplink — connects to wss://atletanotifications.com/ws/bridge, multi-team broadcast selection
├── settings.js           # Persistent settings in ~/Documents/Atleta Racing/settings.json
├── keyboardSim.js        # Windows keyboard sim + iRacing camera switch via broadcast messages
├── voiceInput.js         # Global hotkey hooks (uiohook-napi), Whisper transcription via server proxy (with SAPI fallback)
├── speechWorker.ps1      # PowerShell SAPI fallback (offline transcription)
├── control-panel.html    # Sidebar settings (search, Favorites, Recent, Broadcasting, Race/Car/Track/Stream, Account/Updates/Logs/About)
├── installer.nsh         # Custom NSIS script to kill running app before install
├── package.json          # Electron 28, ws, pako, @emiliosp/node-iracing-sdk, uiohook-napi, electron-updater
├── overlays/
│   ├── standings.html    # Race standings — class-grouped, configurable columns/header, iRating gain, per-class SOF
│   ├── relative.html     # Relative gaps — configurable columns/header, focusCar centering
│   ├── fuel.html         # Fuel calculator — avg/lap, laps of fuel, fuel to finish (timed + lap races)
│   ├── wind.html         # Wind compass — speed in km/h or mph, configurable colors
│   ├── proximity.html    # Car proximity (coming soon)
│   ├── trackmap.html     # Square track map — canvas with wind arrow, focused driver highlight
│   ├── inputs.html       # Driver inputs — trace graph, pedal bars, gear, speed, steering wheel
│   ├── raceduration.html # Race duration — time left, estimated laps with multiclass + pit stop awareness
│   ├── drivercard.html   # Driver card — focused driver: helmet, flag, name, position, iRating, class, laps
│   ├── stintlaps.html    # Session laps — all laps with P/Q/R tags, best (purple), delta to best
│   ├── weather.html      # Weather — animated sun/rain/clouds/fog, temps, humidity, wind, sky condition
│   ├── flags.html        # Flags — animated waving SVG for green/yellow/blue/white/black/checkered
│   ├── chat.html         # Streaming chat — Twitch channel overlay
│   ├── voicechat.html    # Voice chat — Whisper API transcription, push-to-talk, gamepad support
│   ├── combined.html     # Single-window mode host (v3.28.0+) — fullscreen iframe container
│   ├── overlay-utils.js  # Shared overlay utilities — header toggle, drag, click-through, CSS scale
│   └── helmets/          # Racing helmet PNG icons (2 styles) for driver card
└── tests/                # Overlay UI/UX test infrastructure
    ├── serve.js          # Test server — serves overlays with mocked Node.js APIs + mock WebSocket
    ├── mock-data.js      # Realistic mock data for all WebSocket channels (4 scenarios)
    ├── overlays.spec.js  # Playwright tests — bounds, scales, fonts, headers (496 tests)
    ├── playground.html   # Interactive visual playground for manual overlay testing
    ├── gallery.js        # Screenshot gallery server for reviewing test results
    └── playwright.config.js # Separate Playwright config for bridge tests
```

## Architecture

**Telemetry core.** Standalone Windows app that reads iRacing telemetry via `@emiliosp/node-iracing-sdk` (koffi FFI to shared memory) and displays transparent always-on-top overlays. WebSocket server on `localhost:9100` with channel-based subscriptions (fuel 10Hz, wind 10Hz, proximity 10Hz, standings 1Hz, relative 2Hz, trackmap 2Hz). Overlays are frameless, transparent, `alwaysOnTop: 'screen-saver'` with 2-second re-assert interval. Draggable via IPC-based mouse handling (mousedown/mousemove on header → `drag-overlay` IPC). Position configurable via X/Y settings with live preview. Auto-updater via `electron-updater` with Windows system notifications. Built with GitHub Actions (`.github/workflows/build-bridge.yml`) producing NSIS Windows installer.

**Control Panel (v3.24+).** Sidebar-based settings window (1000x750, maximizable). Sidebar layout (top to bottom): live `🔎 Search overlays…` field → `⊞ Overview` / `★ Favorites` / `🕒 Recent` / `📡 Broadcasting` (all card-grid pages sharing the same renderer) → divider → categorized accordions (`Race`, `Car`, `Track`, `Stream`) collapsed by default with persisted state → spacer → `Account`, `Updates`, `Logs`, `About` anchored at the bottom. Per-overlay panels still have sub-tabs (General/Header/Content for standings/relative), drag-to-reorder columns, configurable session header items, font size, row height, position X/Y. The shared overlay card on Overview/Favorites/Recent shows icon + name + enable toggle + ⚙ jump-to-settings + ★ favorite. ⌘K / Ctrl+K focuses the search field. Search dims non-matching rows and auto-expands groups containing matches. UI state in `settings.json` keys: `uiFavorites`, `uiRecent` (max 5), `uiSidebarGroups`. Pure data helpers (`pushRecent`, `toggleFavorite`, `pruneStaleIds`) live in `sidebarState.js`. The 📡 Broadcasting page replaces the old Overview "Team Broadcasting" section; re-renders on every navigation so the toggle state always reflects persisted `pitwallBroadcastTeamIds`.

**Driver Selection.** Click a driver row in standings → iRacing camera switches via broadcast message API (`IRSDK_BROADCASTMSG` / `CamSwitchNum`). Standings/relative highlight follows selection (green for spectated, purple for player). Track map shows focused driver as green dot. Wind overlay uses focused driver's estimated heading. Selection resets when iRacing camera changes (2s grace period) or player enters car.

**Session Management.** Detects session changes via `SESSION_NUM`. Clears cached data on practice→qualify transitions. Keeps data on qualify→race. Excludes spectators (`IsSpectator`) and pace cars from standings. Session laps overlay clears on session number change.

**Pit Time Tracking.** Measures pit stop time loss per class by detecting `CAR_IDX_ON_PIT_ROAD` transitions. When a driver exits pit and completes the pit lap, delta = pitLapTime - bestLap. Running average per class with 5-120s sanity bounds. Persisted per track to `~/Documents/Atleta Racing/pittimes.json` — accumulates over time, loaded on session start so future races at the same track have historical pit data.

**Race Duration.** Multiclass-aware timed race prediction. Uses overall leader's last lap (race pace) to determine when checkered falls: `totalTimeToCheckered = timeRemain + overallLeaderLastLap`. Focus class laps = `floor((totalTime - pitTimeLoss) / focusClassPace)`. Pit stops estimated from fuel data (fuel/lap vs tank capacity). Shows `~20 (1p)` format when pit stops are factored in. Window height is `170px` by default to fit the v3.23.0 incident counter footer (3 rows: off-tracks / penalties / slow laps with attributed time loss). Saved height < 170 is auto-migrated on startup. Footer toggleable via `Incident counters` checkbox in raceduration panel (default on).

**Incident Counters (v3.23+).** Per-session tracker for off-tracks, penalties, and slow laps with attributed time loss. Lives in `incidentTracker.js` as a self-contained factory module (no electron/SDK imports — testable). `telemetry.js` calls `tick()` per poll, `onLapComplete()` from the lap-completion block, `onSessionChange()` from the session-num-change block, and embeds `getState()` into the `session` WS channel payload as `data.incidents`. Detection rules:
- **Off-track** = any positive delta in `PlayerCarMyIncidentCount` (v3.25.3+; the earlier surface-window gate silently dropped brief 4-wheel-offs that slipped between 10Hz polls).
- **Penalty** = edge transition into `CarIdxSessionFlags[playerCarIdx]` bits `0x10000` (black), `0x100000` (meatball/repair), `0x80000` (furled/move-over).
- **Slow lap** = lap time > `max(2.0s, cleanMedian × 5%)` slower than the rolling median of the last 5 valid clean laps.

Time-loss attribution priority: penalty > offtrack > slow lap (so the three `timeLost` numbers sum to total time lost vs clean pace, no double counting). Counters carry over P→Q transitions and reset on entry into a Race session. 28 unit tests in `test-incidentTracker.js`.

**Flag Overlay (v3.26.7+).** `overlays/flags.html` — small draggable waving-SVG overlay for green/yellow/blue/white/black/checkered flags. State lives in `flagState.js` as a self-contained factory module (same pattern as `incidentTracker.js`), consumed by `telemetry.js` per poll and broadcast on a `flags` WS channel. Priority ladder: **black > checkered > white > yellow > blue > green**. Minimum 3s on-screen dwell after iRacing clears a flag. Blue-flag cooldown: 15s after blue clears before it can re-trigger, preventing multi-class spam. Blue-dropout debounce of 300ms absorbs single-tick SDK polling races before committing to a cooldown. Client-side `showBlue` toggle hides blue entirely. Unit tests in `test-flagState.js` (27 tests).

Run all bridge unit tests: `cd bridge && node --test test-incidentTracker.js test-sidebarState.js test-flagState.js` (70 tests total).

**Weather Overlay.** Animated weather conditions inferred from telemetry. For dynamic weather (skies="Dynamic"), infers from humidity: >75% = cloudy, 45-75% = partly cloudy, <45% = clear. CSS animations: spinning sun with rays, drifting clouds, falling raindrops, fog layers. Shows track time, sky label, air/track temp (color-coded), humidity, rain, wind direction/speed. iRacing SDK does NOT expose weather forecast data — only current conditions available.

**Driver Card.** Shows focused driver's helmet icon (2 PNG styles selectable in config), country flag (SVG from flags/ directory, COUNTRY_TO_ISO mapping), name, position badge, iRating with gain/loss color, class badge (black text on white for light class colors), best/last lap times.

**Session Laps.** Tracks all laps for the focused driver with session type tags: P (gray/practice), Q (yellow/qualify), R (green/race). Tags determined from `SessionInfo.Sessions[sessionNum].SessionType` at the time each lap is recorded. Clears on session number change. Shows best (purple), last, avg, and scrollable lap list with delta to best.

**iRating Estimation.** Exact iRacing formula from official spreadsheet (source: `github.com/arrecio/ircalculator`). Calculated **per-class** in multiclass races. Formula:

```
BR = 1600 / ln(2)  ≈ 2308.31
chance(a, b) = Qa / (Qa + Qb)
  where Qa = (1 - exp(-a/BR)) * exp(-b/BR)
        Qb = (1 - exp(-b/BR)) * exp(-a/BR)
expected[i] = -0.5 + SUM(chance(iR[i], iR[j])) for all j in class
factor = ((N - nNonStarters/2) / 2 - pos) / 100
change = round((N - pos - expected[i] - factor) * 200 / nStarters)
```

Key: uses `exp()` not `pow(10)`, divisor is `1600/ln(2)` not `1600`. The `-0.5` offset accounts for self-pairing. The `factor` is a position-based correction. Shows green +N or red -N next to iRating on standings/relative. SOF calculated as harmonic mean of class iRatings, rounded to nearest 100. Matches iOverlay within ±1-2 points for most drivers.

**Track Map System.** Browser-side .ibt parser extracts Lat/Lon (radians→degrees) + track name from session YAML. Uploads to server under both geoId and display name. Bridge fetches by geoKey then by name. Track database viewer on dashboard shows canvas previews. Missing tracks list compares against ~50 known iRacing tracks.

**Voice Chat.** Push-to-talk (global hotkey via `uiohook-napi` with key-down/key-up detection, supports keyboard keys, mouse side buttons, and gamepad buttons via Gamepad API) and wake word ("message") always-listening mode. Whisper transcription via server-side proxy at `POST /api/bridge/whisper` — Bridge uploads raw WAV bytes via Node `https.request`, server forwards multipart to OpenAI, returns transcribed text. Bridge falls back to PowerShell SAPI (`speechWorker.ps1`) on Windows if proxy unreachable. Bridge feature-detects via `GET /api/bridge/config` returning `{ whisperProxyEnabled }`. Users can also bring their own OpenAI key via `settings.voiceChat.openaiKey` which short-circuits the proxy. Voice parsing: "all [text]", "number [#] [text]", "[name] [text]", "team [text]" with Levenshtein fuzzy matching. Confirmation UI. Sends to iRacing via `keyboardSim.js` — clipboard paste into iRacing chat. Configurable chat open key (T/Y/U/Enter). See `docs/features/voice-chat.md` for the server-proxy contract.

**Team Pitwall (Bridge side).** Bridge connects to `wss://atletanotifications.com/ws/bridge` with userId + pitwall_token, receives team list, sends `set-teams` to choose which teams see telemetry (multi-select, persisted as `pitwallBroadcastTeamIds`). The 📡 Broadcasting sidebar tab (v3.25.0+) has one card per team with a toggle each — re-renders on every navigation. Talks to main via `get-pitwall-teams` / `set-pitwall-broadcast` / `pitwall-teams` IPC channels (renderer cannot `require('./pitwallUplink')` directly because renderer windows get separate module instances). See `docs/features/team-pitwall.md` for the relay protocol and viewer side.

**Single-window mode (v3.28.0+).** Experimental architecture that hosts every overlay (except `voicechat`) as an `<iframe>` inside one fullscreen transparent click-through window (`overlays/combined.html`) instead of N separate `BrowserWindow`s. Single Electron renderer process for the entire overlay set — cuts per-overlay-window RAM (each `BrowserWindow` is ~50–150MB) down to one shared process. Enabled by setting `singleWindowMode: true` in `~/Documents/Atleta Racing/settings.json` (no UI toggle in v3.28.0; UI lands in a follow-up). The combined window uses `webPreferences.nodeIntegrationInSubFrames: true` so each iframe still gets `require('electron')` for `overlay-utils.js`. `set-ignore-mouse` IPC works unchanged because iframe `event.sender` resolves to the parent window. `drag-overlay`, `auto-resize-height`, `resize-overlay-wh` IPCs no-op when `isFromCombinedWindow(event)` is true. Per-overlay IPCs that take an `overlayId` (`move-overlay`, `resize-overlay`, etc.) check `combinedOverlayIds.has(overlayId)` and forward to `combined.html` via `combinedSend(...)`. Voice chat always falls through to a classic per-window because `voiceInput.js` holds a window reference for global hotkey + audio routing. Drag-to-position is **not** supported in single-window mode v1 — user uses control panel X/Y inputs; drag IPCs from inside iframes are intentionally dropped. `persistSettings()` writes the union of `Object.keys(overlayWindows)` and `combinedOverlayIds` into `settings.enabledOverlays` so combined-mode entries survive restart. Toggling `singleWindowMode` requires app restart in v1.

## Conventions

- Bridge overlays follow same visual pattern: dark semi-transparent panel (`rgba(12,13,20,0.85)`), header with status dot, consistent color scheme.
- Bridge overlays are `transparent: true` + `alwaysOnTop: 'screen-saver'` — dragging via IPC (mousedown/mousemove on header → `drag-overlay` IPC, NOT `-webkit-app-region: drag` which doesn't work on Windows transparent windows).
- Bridge overlays connect to `ws://localhost:9100` and subscribe to channels for real-time data.
- Bridge uses `nodeIntegration: true` + `contextIsolation: false` in all overlay windows (local files only).
- Bridge overlay settings: per-overlay font size (scales ALL elements via proportional fsSmall/fsTiny/fsMed), row height, configurable columns (drag-to-reorder), session header items, position X/Y, color customization (wind arrow/compass, track map track/player/focus colors).
- `koffi` is available as a transitive dependency via `@emiliosp/node-iracing-sdk` — no need to list separately in package.json.
- GitHub Actions build: `.github/workflows/build-bridge.yml` → produces NSIS installer → publishes to GitHub Releases (version from package.json, proper semver).
- Control panel fetches release notes from GitHub Releases API (hardcoded array as fallback).
- `keyboardSim.js` also handles iRacing camera switching via `RegisterWindowMessageA('IRSDK_BROADCASTMSG')` + `SendNotifyMessageA`/`PostMessageA` with `HWND_BROADCAST`.
- Bridge overlay drag/click-through: ALL overlays use `overlay-utils.js` as single source. No inline drag/click-through handlers in overlay HTML files.
- Bridge overlay scale: `applyScale()` in overlay-utils.js uses CSS `transform: scale()` + `overflow: visible` without locking dimensions. ResizeObserver re-syncs window size when content changes.
- Auto-updater checks once, 5 seconds after startup. The per-minute `setInterval` was removed in v3.26.4 to cut background CPU/network on race machines — updates are picked up on next launch instead. Remote log upload (`uploadLogs` in `main.js`) also throttled from 60s to 5 min in v3.26.5.
- **Broadcast throttling (v3.27.0+).** Three layers cut hot-path work without changing what overlays/viewers see:
  1. `pitwallUplink.js:sendTelemetry` short-circuits when `broadcastTeamIds.length === 0` and applies a per-channel rate limit that **must mirror** `src/services/pitwallRelay.js:THROTTLE` — anything sent faster is discarded server-side anyway. Update both maps together if you tune one.
  2. `telemetry.js:broadcastToChannel` applies a `LOCAL_THROTTLE` map to data events for slow-changing channels (standings 4Hz, fuel 2Hz, wind/trackmap/proximity 10Hz, session 4Hz); `inputs` is uncapped because the trace graph genuinely needs 30Hz; `relative` is already gated to 6Hz at its broadcast site (`pollCount % 5`); `flags` only fires on state change; status/`_all` events bypass the throttle.
  3. `websocket.js:broadcastToChannel` skips `JSON.stringify` allocation when `clients.size === 0`.

  The poll loop itself still runs at 30Hz — only the broadcasts are throttled — because the SDK refresh feeds session-change detection, lap recording, and pit timing which all need full rate.
- **Always-on-top re-assert (v3.27.0+).** A single shared `_globalTopInterval` in `main.js` iterates `overlayWindows` (and `combinedWindow` if open) every 2s and calls `setAlwaysOnTop(true, 'screen-saver')` for each. `ensureGlobalTopInterval()` starts it on overlay creation; `maybeStopGlobalTopInterval()` clears it when the last overlay AND combined window are gone. Keep it as one timer — N overlays × N timers was wasted work for identical cadence.
- Bridge overlays hidden on startup when autoHide is on (shown when iRacing connects).
- iRacing WindDir from SDK is the SOURCE direction (N = wind coming FROM north). No flip needed in overlays.
- Race types use proper case: `VRS Sprint`, `VRS Open`, `VRS Endurance`, `IMSA Sprint`, `IMSA Open`, `IMSA Endurance`, `Global Endurance`, `Regionals`, `LMP2 Sprint`, `Proto Sprint`. DB migration normalizes old snake_case on startup. `getRaceType()` in `telemetry.js` returns proper case directly.
- UI state for the v3.24+ sidebar redesign lives in `settings.json` under three top-level keys: `uiFavorites: string[]`, `uiRecent: string[]` (max 5), `uiSidebarGroups: { race, car, track, stream }` (booleans, true = collapsed). Loaded by main.js after `loadSettings()`, exposed via `get-ui-state` (sync IPC) / `save-ui-state` (async IPC, partial-patch merge). Pure data helpers in `sidebarState.js` are the only place that mutate the arrays.
- `incidentTracker.js` is a self-contained factory module — `createIncidentTracker()` returns `{ init, tick, onLapComplete, onSessionChange, getState, reset }`. Same pattern for `flagState.js` and `sidebarState.js`. No electron / no SDK imports → unit-testable with `node:test`.
- Standings gap columns: in qualifying/practice, gap and gapLdr show best lap time difference to class leader. In race, show time-based `gapToLeader`. Controlled by `_isRaceSession` flag from session data `eventType`. Relative overlay uses the same `_isRaceSession` flag to gate the red/blue lap-diff name coloring — in P/Q, drivers with different lap counts are not treated as lapped. **Must be declared near the top of the script alongside `let ws`/`let bridgeConnected`** — declaring it below the top-level `renderDemo…()` call causes a temporal dead zone crash that silently stops `connectBridge()` from running and leaves the overlay stuck showing "Demo Mode".
- Pitwall overlay iframes: loaded with `?pitwall=1&driver=ID`. Overlays detect `PITWALL_MODE` and use `window.addEventListener('message')` instead of WebSocket. Parent page forwards relay data via `postMessage`. All `require()` calls in overlays wrapped in try/catch for browser compatibility.
- Control panel is a renderer process — communicates with main via IPC, NOT `require('./module')` (renderer gets separate module instances). Team broadcast uses `get-pitwall-teams` / `set-pitwall-broadcast` / `pitwall-teams` IPC channels.
- Logout: IPC `logout` handler clears credentials from settings, calls `app.relaunch()` + `app.quit()`.

## Testing

Automated UI/UX test infrastructure in `bridge/tests/`:

- `node bridge/tests/serve.js` — test server that serves overlays with mocked Node.js APIs (require, electron, fs) + mock WebSocket for data injection. Each overlay rendered at its real Electron window dimensions from `main.js` OVERLAYS array.
- `node bridge/tests/gallery.js` — screenshot gallery server at `http://localhost:9401` with filterable grid view.
- `cd bridge/tests && npx playwright test --config=playwright.config.js` — 496 automated tests across 14 overlays (trackmap excluded — canvas with aspect-ratio:1).
- Tests cover: bounds at 6 scales × 3 scenarios, 4 font sizes, header toggle × 3 scales, 6 stress combos, data rendering, scale visibility.
- `bridge/tests/playground.html` — interactive visual playground with all overlays in a grid.

Bridge unit tests (pure modules): `cd bridge && node --test test-incidentTracker.js test-sidebarState.js test-flagState.js` (70 tests total).
