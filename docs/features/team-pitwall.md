# Team Pitwall

Live telemetry sharing with teammates. Bridge desktop app uplinks telemetry to the server, viewers (in browsers) connect to the server and watch a chosen driver's data live. Users can be in up to 5 teams simultaneously.

The Bridge side (uplink, broadcast team selection, IPC) is documented in `bridge/CLAUDE.md`. This file documents the server-side relay and viewer page.

## DB Schema

- `teams` — name, owner, invite_code, picture, banner
- `team_members` — team_id, user_id, role; `UNIQUE(team_id, user_id)`
- `team_invites`

## Query Functions

- `getTeamsForUser(userId)` — array of all memberships
- `countTeamsForUser(userId)` — for max-5 cap
- `getTeamForUser(userId)` — first team (backward compat)

## Routes

- `/racing/teams` — list page
- `/racing/teams/:teamId` — detail page
- Old `/racing/team` redirects to `/racing/teams`

Team detail routes use `/racing/teams/:teamId/...` pattern (invite, kick, leave, delete, picture, banner). Max 5 teams per user enforced in both routes and DB transaction functions.

## Team Customization

Owners can upload:
- **Team picture** — circular, 128×128 JPEG, base64 in `teams.picture`
- **Team banner** — 800×200 JPEG, base64 in `teams.banner`

Both via interactive crop editors on team detail page. Same UX pattern as avatar crop editor on `racing-account.ejs`. Permission check uses `role === 'owner' || role === 'admin'` (admin role future-proofed but not yet implemented). `_getTeamMemberships` query returns `team_picture` and `team_banner` aliases.

## WebSocket Relay (`pitwallRelay.js`)

Initialized in `src/index.js` via `pitwallRelay.init(httpServer)`.

### Bridge connection: `/ws/bridge`

Bridge connects with userId + pitwall_token. Relay sends back the team list. Bridge sends `set-teams` to choose which teams see telemetry (multi-select, persisted as `pitwallBroadcastTeamIds`).

### Viewer connection: `/ws/pitwall`

Viewers connect via session cookie. Send `select-team` to pick which team to watch, then `subscribe` to channels + `view-driver` to select a driver. Relay stores `teamIds: Set` per bridge client and filters data via `driverClient.teamIds.has(viewer.teamId)`.

### Throttle Rates Per Channel

| Channel | Rate |
|---|---|
| inputs | 50ms |
| standings, fuel, session | 250ms |
| relative, wind, trackmap | 150ms |

These **must mirror** the Bridge-side `LOCAL_THROTTLE` map in `bridge/pitwallUplink.js:sendTelemetry` — anything sent faster is discarded server-side anyway. Update both maps together if you tune one.

## Viewer Page (`/racing/pitwall`)

Uses `gridstack.js` for free-form drag/resize/toggle layout with localStorage persistence. Overlay iframes use `?pitwall=1` param to detect pitwall mode — listen for `postMessage` from parent page instead of opening WebSocket. Parent page has single WS connection to relay, forwards `data` messages to iframes via `postMessage`. Users can view own telemetry. Shows team picker if 2+ teams, skips to pitwall if 1 team, redirects to `/racing/teams` if 0.

## Pitwall Edit Mode (v3.26.3+)

Discoverable `✎ Edit Layout` button in the top bar next to the ⚙ settings gear. Clicking applies an `.editing` class to `#pitwall-grid` which:

- Adds a 2px purple border + drag grip strip at the top of every tile
- Makes all eight gridstack resize handles visible (`handles: 'n,e,s,w,ne,nw,se,sw'`)
- **Crucially:** shows a transparent `.pitwall-iframe-shield` div on top of each iframe to intercept clicks gridstack would otherwise lose to the iframe's own document. The shield is the linchpin — without it, drag handles feel invisible because the iframe swallows every pointer event except the 1px tile border.

Gridstack config uses `float: true` (dropped panels stay where you put them) and `maxRow: 10` (so resizes can't push panels past the bottom of the viewport where they'd be unreachable).

Escape exits edit mode — but the pre-existing document-level Escape handler that navigates to `/racing/teams` is guarded with `if (isEditing) return;` so edit mode owns Escape entirely when active.

Layout persists in `localStorage.pitwall-gridstack-v2`. `loadLayout()` clamps any saved item with `y + h > 10` on load to recover layouts saved before `maxRow` was enforced.

The old `Lock Layout` button in the settings panel was removed — edit mode replaces it. `racing-pitwall.ejs:addWidget()` injects `.pitwall-drag-strip` and `.pitwall-iframe-shield` into every tile's content template; both are `display: none` by default and only shown under `#pitwall-grid.editing`.

## Static Route Cache-Control (load-bearing)

`src/server.js:64-74` serves `/pitwall/overlays/*` with **split Cache-Control headers**:

- `.html` / `.js` → `no-cache, no-store, must-revalidate` so deploys ship fresh overlay code immediately
- All other assets (SVG flags, PNG helmets, CSS, images) → `public, max-age=3600`

Without the split, `relative.html` and `standings.html` rebuild row HTML via `innerHTML = rows.join('')` every 2Hz/1Hz, each rebuild destroys+recreates every `<img class="flag-img">`, and `no-store` forced a fresh network round-trip per img — producing a visible flicker on every country flag. Keep this split in place if you ever change static-file headers.

## Files

- `src/services/pitwallRelay.js` — WebSocket relay (Bridge uplink + viewer connections, multi-team broadcast)
- `src/routes/racing.js` — pitwall routes
- `src/routes/racing-team.js` — team management
- `src/views/racing-pitwall.ejs` — viewer page
- `src/views/racing-pitwall-picker.ejs` — team picker (shown when user has 2+ teams)
- `src/views/racing-teams.ejs` — teams list
- `src/views/racing-team-detail.ejs` — per-team management

For the Bridge uplink, sidebar `📡 Broadcasting` tab, and IPC channels, see `bridge/CLAUDE.md`.
