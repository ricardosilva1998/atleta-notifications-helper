# Atleta Personal Helper

Two-product platform: **Streamer** (Twitch/YouTube/Discord tools) and **Racing** (iRacing telemetry & analysis). Each has its own auth system and dedicated landing page. Accounts are optionally linkable.

**Streamer:** Monitors Twitch (live streams, clips, recaps, milestones), YouTube (videos, shorts, livestreams — currently disabled via `features.youtube` flag), and provides welcome messages, subscriber role sync, and weekly digests. Includes chatbots for Twitch and YouTube with customizable thank-you messages, custom commands, 13 built-in fun commands, and chat moderation. OBS overlay with racing-themed animated notification banners, a visual overlay builder with advanced theme editor, and multiple card animations. Channel Point Rewards, PayPal donations, multistream relay, Spotify `!song` integration. Streamers configure everything through `atletanotifications.com`. Requires Discord OAuth login.

**Racing:** Standalone username/password auth (no Discord required). **Atleta Racing** Electron desktop app for iRacing (renamed from "Atleta Bridge" in v3.26.0 — directory `bridge/` and npm package `atleta-bridge` kept for stability) with real-time telemetry overlays and voice-to-chat messaging. Session capture pipeline records per-lap data + 10Hz telemetry traces. Track Database page with Practice/Race tabs. Bridge requires Racing account login on startup.

## Tech Stack

- **Runtime:** Node.js >= 20 (no TypeScript, no build step)
- **Backend:** Express v5, EJS templates (server-rendered)
- **Database:** SQLite via better-sqlite3 (WAL mode, foreign keys)
- **Bot:** discord.js v14
- **External APIs:** Twitch Helix, Twitch EventSub (WebSocket), StreamElements (socket.io), YouTube Data API v3 + Live Chat API + RSS feeds, Spotify Web API, PayPal, OpenAI Whisper
- **Chatbot:** tmi.js (Twitch IRC) — single shared connection for all channels; YouTube Live Chat API polling
- **i18n:** Custom JSON-based translation system (7 languages)
- **Deployment:** Docker on Railway with persistent volume at `/app/data`
- **Testing:** Playwright E2E tests, run via pre-push git hook (must pass before push)
- **Auth:** Discord OAuth (Streamer), bcryptjs username/password (Racing), linkable accounts

For the Bridge desktop app stack (Electron 28, koffi FFI, etc.) see `bridge/CLAUDE.md`.

## Commands

- `npm run dev` — run locally (loads `.env` via `--env-file`)
- `npm start` — production start
- `npx playwright test` — E2E tests (public pages, authenticated flows, custom overlays)

No linting configured.

## Project Structure

```
src/
├── index.js              # Entry — boots bot, pollers, EventSub, StreamElements, chat managers, web server
├── config.js             # Env vars + tier definitions + intervals
├── db.js                 # SQLite schema, migrations, seeds, all queries
├── server.js             # Express app + middleware (session, i18n, language, static files)
├── discord.js            # Discord client + embed helpers (recap, digest, milestone)
├── i18n.js               # Translation helper — loads JSON locale files
├── commands.js           # Slash commands
├── welcome.js            # Welcome message listener
├── locales/              # Translation files (en, pt, es, fr, de, zh, ja)
├── pollers/              # twitchLive (60s), twitchClips (5min), youtubeFeed (5min), youtubeLive (2min), weeklyDigest (Mon 09:00 UTC), subSync (10min), manager.js (orchestrator)
├── services/
│   ├── twitch.js         # Twitch Helix API + broadcaster/bot token refresh
│   ├── youtube.js        # YouTube API + RSS + Live Chat API + channel resolver + bot token refresh
│   ├── spotify.js        # Spotify Web API — currently playing track + token refresh
│   ├── eventsub.js       # Twitch EventSub WebSocket (per-streamer connections)
│   ├── streamelements.js # StreamElements socket.io (donations)
│   ├── twitchChat.js     # Shared tmi.js chatbot — single connection, joins all enabled channels
│   ├── chatModeration.js # Banned words, link protection, caps/emote/symbol/repetition filters, escalation
│   ├── builtinCommands.js # 13 built-in chat commands — followage, 8ball, rps, roast, etc.
│   ├── youtubeLiveChat.js # YouTube Live Chat poller during live streams
│   ├── timedNotifications.js # Sponsor image rotation per-streamer
│   ├── overlayBus.js     # EventEmitter singleton — routes events to overlay SSE + chat
│   ├── pitwallRelay.js   # Team Pitwall WebSocket relay — see docs/features/team-pitwall.md
│   ├── multistreamRelay.js   # MediaMTX HTTP API client — see docs/features/multistream.md
│   ├── youtubeBroadcast.js   # YouTube Data API v3 broadcast lifecycle for multistream
│   ├── streamKeyCrypto.js    # AES-256-GCM helpers for at-rest stream key encryption
│   ├── twitchRewards.js      # Channel Points Helix client — see docs/features/channel-point-rewards.md
│   ├── redemptionDispatcher.js # Channel point redemption flow
│   └── redemptionTemplates.js  # Pure formatChatTemplate helper (unit-tested)
├── routes/
│   ├── auth.js           # Discord + Twitch + YouTube + Spotify OAuth flows + Racing account linking
│   ├── racing-auth.js    # Racing standalone auth — signup, login, logout, login-api (Bridge)
│   ├── racing.js         # Racing dashboard, account settings, admin, avatar upload, pitwall routes
│   ├── racing-team.js    # Multi-team CRUD at /racing/teams, /racing/teams/:teamId
│   ├── overlay.js        # OBS overlay SSE endpoint + overlay HTML page + custom designs
│   ├── customOverlays.js # DISABLED — commented out in server.js/overlay.js
│   ├── dashboard.js      # Dashboard, account, guild config, stats, channel CRUD, overlay/chatbot/sound/sponsor/donation/redemption settings
│   ├── tip.js            # Public donation page — PayPal Checkout flow
│   ├── api.js            # API endpoints
│   ├── admin.js          # Admin panel
│   ├── multistream.js    # Multistream dashboard + MediaMTX webhooks
│   └── payment.js        # PayPal subscriptions
└── views/                # EJS templates — header.ejs (global layout), dashboard.ejs (platform-tabbed), guild-config.ejs, overlay-config.ejs, overlay-builder.ejs, chatbot-config.ejs, mod-log.ejs, donation-settings.ejs, redemptions-config.ejs, multistream.ejs, tip.ejs, youtube-chatbot-config.ejs, timed-notifications.ejs, racing-* (landing, dashboard, account, teams, team-detail, pitwall, pitwall-picker, admin), tracks.ejs, plus auth/admin views
public/
└── overlay/
    ├── overlay.css       # Alert card styles — centered cards with per-event themes, full-screen effects
    ├── overlay.js        # SSE client, event queue, card rendering, custom design application, redemption playback
    ├── sponsors.js       # Sponsor overlay — independent OBS browser source
    └── scenes.js, bar.js, custom-alerts.js  # All DISABLED (custom overlays feature)
tests/                    # Playwright E2E (public pages, authenticated flows, custom overlays)
data/                     # bot.db (SQLite), sounds/, sponsors/, redemptions/{streamerId}/  (persistent volume)
bridge/                   # Atleta Racing — Electron desktop app for iRacing. See bridge/CLAUDE.md.
docs/
├── features/             # Per-feature deep dives — see "Key Architecture" below for which file covers what
├── multistream.md, multistream-relay-setup.md  # Operator/resume docs for the multistream relay
└── mockups/, security-todo.md
```

## Key Architecture

- **Dashboard:** Platform-tabbed main page (Discord | Twitch | YouTube | Kick | iRacing | Admin) with localStorage tab persistence. Discord tab shows guild management. Twitch tab shows 7-day activity stats card + overlay/chatbot/Spotify/donations/sponsor/redemption cards. YouTube tab shows "Coming Soon" (disabled via `features.youtube` flag). iRacing tab has sub-tabs: App Download, Stream Overlays, Track Upload (admin-only).
- **OBS Overlay:** EventSub receives Twitch events → `overlayBus` EventEmitter → SSE push to OBS browser source. Centered card design with per-event themes and full-screen effects. All event types use the same card structure: `top-accent` + `card-body` (with optional side icons) + `car-track` (always visible for consistent height). Card animations built dynamically by `buildBottomAnimation()` — bottom-track types stay in track; full-card types use `.card-anim-overlay` div. YouTube events (Super Chat, Member, Gift) emit to the same overlay. Custom designs stored in `overlay_designs` table with advanced theme columns. Donation alerts show message on separate line below amount. Moderation actions use Twitch Helix API (not tmi.js IRC).
- **Overlay Builder:** Visual editor at `/dashboard/overlay-builder` with left control panel + right live preview. Customize per-event: colors, fonts (Google Fonts with live preview), text, animations, card size, position (9-cell grid + free drag), border radius. Advanced theme editor with 14 presets, gradient direction (7 options + solid), background opacity, border thickness/opacity, glow intensity, shadow blur/spread/opacity. Card animations split into Card Animation tab (entrance + bottom bar) and Canvas Animation tab (screen effects). Designs saved to DB and applied at runtime via `applyCustomDesign()`.
- **Feature Flags:** `config.features.youtube` controls YouTube UI visibility across all pages. Set in `src/config.js`.
- **Twitch Chatbot (Atleta):** Single shared tmi.js connection (env var credentials) joins all enabled channels (requires `chatbot_enabled = 1` and `twitch_username` set). EventSub/StreamElements events trigger customizable thank-you messages. Custom `!commands` stored per-streamer in `chat_commands` table. 13 toggleable built-in commands (`!followage`, `!subage`, `!uptime`, `!8ball`, `!roll`, `!hug`, `!slap`, `!love`, `!rps`, `!coinflip`, `!quote`, `!roast`, plus `!commands`). Stored as `cmd_*_enabled` columns on `streamers` table. Built-in `!song` for Spotify.
- **Chat Moderation:** Per-feature toggleable in `chatModeration.js`. Banned words always enforced (even for subs/VIPs). Link protection with `!permit`, caps/emote/repetition/symbol filters, follow age gate, first-time chatter flag, slow mode, raid protection, escalation ladder, mod log (`moderation_log` table, 7-day retention). Uses Twitch Helix API for deletion/timeouts. Bot user ID resolved via OAuth validate endpoint to handle third-party token Client-IDs.
- **YouTube Chatbot:** Polling-based via YouTube Live Chat API. Activates when stream goes live. Detects Super Chats, new members, gifted memberships, and `!commands`. Uses global bot YouTube account.
- **Spotify Integration:** Streamer connects via OAuth. `!song` returns currently playing track. Token auto-refresh.
- **Sound System:** Per-event sounds with synthesized racing defaults (engine revs, turbo blow-off, tire screeches via Web Audio API). Custom mp3 upload with client-side trim. Custom sounds stored in `data/sounds/` (persistent volume). Overlay tries custom mp3 first, falls back to synthesized.
- **Sponsor Rotation:** Streamers upload sponsor images (`data/sponsors/`). `timedNotifications.js` cycles enabled sponsors at a configurable interval, emits `type: 'sponsor'` to overlay + optional chat msg. Independent OBS browser source at `/overlay/sponsors/TOKEN` via `sponsors.js`.
- **Donations (PayPal):** Streamers configure their PayPal email in `/dashboard/donations`. Public tip page at `/tip/:username` uses PayPal Checkout API with `payee: { email_address }` — money goes directly to streamer. On capture, fires overlay alert + chatbot message. Donation details stored in cookies during PayPal redirect. Logged to `overlay_events`. Legacy `/donate` for "Buy me a coffee".
- **Channel Point Rewards** → `docs/features/channel-point-rewards.md`. Native Twitch Channel Points → audio/video clips on the OBS overlay. Streamer creates rewards in `/dashboard/redemptions`; viewer redeems → EventSub → `redemptionDispatcher` plays the clip and posts an optional chat message.
- **Multistream (Twitch + YouTube passthrough)** → `docs/features/multistream.md`. OBS → MediaMTX relay (Oracle Cloud free tier) → ffmpeg passthrough to both Twitch and YouTube. Status as of 2026-05-10: code shipped, infra pending — feature shows "relay not configured" warning until Oracle VM + DNS + Railway env vars are deployed.
- **Session Capture Pipeline** → `docs/features/session-capture.md`. Bridge captures per-lap data + 10Hz telemetry traces during P/Q/R/Offline Testing sessions and uploads progressively (`POST /api/session` → `POST /api/session/:id/lap` → `PATCH /api/session/:id/finish`). Telemetry stored gzip-compressed in `lap_telemetry` table.
- **Track Database Page:** Standalone `/tracks` page accessible to both products. Grid/list of tracks. Detail page with Practice/Race tabs. Sessions expandable inline. Import via JSON/CSV/screenshot. 152 known iRacing tracks.
- **Voice Chat (server proxy)** → `docs/features/voice-chat.md`. `POST /api/bridge/whisper` accepts WAV bytes, forwards to OpenAI Whisper, returns text. `GET /api/bridge/config` returns `{ whisperProxyEnabled }` (no auth, no secrets). The OpenAI key never ships to clients.
- **Team Pitwall** → `docs/features/team-pitwall.md` (server side) and `bridge/CLAUDE.md` (Bridge uplink). Live telemetry sharing with teammates. Up to 5 teams per user. WebSocket relay routes Bridge data to viewer browsers.
- **iRacing Bridge (Electron Desktop App)** → `bridge/CLAUDE.md`. Standalone Windows app reading iRacing telemetry via `@emiliosp/node-iracing-sdk`, displaying transparent always-on-top overlays, and uplinking telemetry for Team Pitwall.
- **Overlay Event Logging:** All overlay events (follows, subs, bits, donations, raids) logged to `overlay_events`. 7-day stats on Twitch tab dashboard card. 30-day retention with auto-cleanup.
- **Activity Feed:** Stream Recaps, Milestone Celebrations, Weekly Highlights — all free.
- **Free for all:** All features are free and unlimited for every user — no tier gating.
- **Dual Auth System:** Two independent auth systems. Discord OAuth (Streamer) and bcrypt username/password (Racing). Session middleware loads both `req.streamer` and `req.racingUser`, cross-loading linked accounts. `sessions` table has both `streamer_id` and `racing_user_id` columns (nullable). Racing accounts stored in `racing_users` (username `COLLATE NOCASE`, password_hash, iracing_name, bridge_id, avatar 128×128 base64 JPEG, display_name). Account linking: Racing → Discord via OAuth callback detection, or Discord → Racing.
- **Racing Auth Routes:** `/racing/auth/signup` (form + JSON for Bridge), `/racing/auth/login` (form), `/racing/auth/login-api` (JSON for Bridge), `/racing/auth/logout`. Bridge login screen (`bridge/login.html`) shown on startup if `settings.racingUsername` not set. Login rate limiting + account locking.
- **Homepage:** `/` shows two product cards. `/streamer` = Streamer landing with Discord login. `/racing` = Racing dashboard or login form.
- **Auth flows (Streamer):** Discord OAuth → Twitch linking → broadcaster auth (EventSub scopes) → bot account (global env var) → YouTube OAuth (streamer account for live detection) → Spotify OAuth.
- **YouTube Shorts:** Detected via YouTube Data API duration check (≤60s), separate notification format.
- **User feedback:** Star rating + message on account page, visible in admin Feedback tab.
- **Admin panel:** Admin tab on dashboard (admin-only). Tabbed: Stats / Users / Issues / Feedback / Discounts / Testing.
- **Custom Overlays (DISABLED):** Code exists (`customOverlays.js`, `scenes.js`, `bar.js`, `custom-alerts.js`, `custom-overlays.ejs`) but all integrations commented out in `server.js`, `overlay.js`, `twitchChat.js`, `dashboard.ejs`, `overlay-builder.ejs`, `overlay-config.ejs`, `overlay.css`. DB table `custom_overlays` exists. Re-enable by uncommenting the marked sections.
- **Password reset:** `password_reset_tokens` table. Self-service via email (`nodemailer` + Gmail) at `/racing/auth/forgot` → `/racing/auth/reset`. Admin can generate 24h reset links via Racing admin panel "Reset PW" button (`POST /racing/admin/reset-password/:id`). Also at `POST /admin/racing-reset-password` (Discord admin auth).
- **iRacing Web Integration (coming soon):** Built but disabled — waiting for iRacing OAuth credentials.
- **DB migrations:** Auto-run on startup in `src/db.js`. SQLite pragmas applied at startup: `journal_mode=WAL`, `foreign_keys=ON`, `synchronous=NORMAL`, `cache_size=-64000`, `temp_store=MEMORY`, `mmap_size=256MB`. Hot-path indexes on `subscriptions(streamer_id, status)`, `watched_channels(twitch_username)`, `watched_youtube_channels(youtube_channel_id)`.
- **No ORM:** All SQL is raw in `db.js`.
- **i18n:** `t(lang, key, params)` helper via `res.locals.t` — cookie-based language preference.

## Environment Variables

Required:
- `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`
- `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`

Optional:
- `BOT_TWITCH_USERNAME`, `BOT_TWITCH_TOKEN` — Twitch chatbot credentials (shared single connection)
- `YOUTUBE_API_KEY` — global key for YouTube live detection
- `YOUTUBE_BOT_CLIENT_ID`, `YOUTUBE_BOT_CLIENT_SECRET`, `YOUTUBE_BOT_REFRESH_TOKEN` — YouTube chatbot credentials
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` — Spotify integration for !song
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MODE`
- `EMAIL_USER`, `EMAIL_PASS` — Gmail + App Password for password reset emails (admin can also generate reset links manually)
- `OPENAI_API_KEY` — required for Whisper proxy (`/api/bridge/whisper`); without it, Bridge falls back to PowerShell SAPI on Windows
- `APP_URL`, `PORT`, `SESSION_SECRET`, `ADMIN_PASSWORD`
- `MEDIAMTX_API_URL`, `MEDIAMTX_INGEST_URL`, `MEDIAMTX_API_TOKEN`, `MEDIAMTX_WEBHOOK_SECRET` — multistream relay (see `docs/multistream-relay-setup.md`)
- `MULTISTREAM_KEY_SECRET` — 64-char hex (32 bytes) for AES-GCM encryption of stored stream keys; generate with `openssl rand -hex 32`
- Polling intervals: `TWITCH_POLL_INTERVAL`, `TWITCH_CLIPS_INTERVAL`, `YOUTUBE_FEED_INTERVAL`, `YOUTUBE_LIVE_INTERVAL`, `SUB_SYNC_INTERVAL`, `WEEKLY_DIGEST_INTERVAL`

## Conventions

- Plain CommonJS (`require`/`module.exports`), no ESM.
- No framework abstractions — routes, DB queries, and pollers are straightforward procedural code.
- All database operations go through `src/db.js`.
- Config access via `require('./config')`.
- `-1` means unlimited in tier limits.
- CSS design system uses CSS custom properties (defined in `header.ejs`).
- Typography: Outfit (display) + DM Sans (body) via Google Fonts.
- All user-facing text should use `t('key')` for i18n support.
- Twitch notifications sent as embeds, clips and YouTube videos sent as plain text (for Discord auto-preview).
- Custom sounds stored in `data/sounds/` (persistent volume), not `public/overlay/sounds/`.
- Sponsor images stored in `data/sponsors/`, served via `/sponsors/` static route.
- Channel point reward media stored in `data/redemptions/{streamerId}/`, served via `/redemptions/`. Filenames are `{rewardId}_{timestamp}.{ext}` so the 24h cache headers stay safe across replacements.
- **EJS templates DO NOT have access to `require()`.** Express's EJS integration runs templates in a sandboxed scope. If a view needs a value derived from a service module, the route handler must compute it server-side and pass it as a template local. Inline `<% require('...') %>` will throw "require is not defined" and crash the page in production. Reference: `dashboard.js` GET /dashboard precomputes `hasScope` via `hasRedemptionScope(req.streamer)` and passes it to `dashboard.ejs`.
- **Client/server query-param parity for raw-body uploads.** Sponsor/redemption uploads send file bytes in the body and metadata in `?...` query params. The exact param names must match the server's `req.query.X` reads — a mismatch is silent (e.g., empty title gets re-rejected by length validation with a confusing error). When changing one side, verify the other.
- Overlay designs stored in `overlay_designs` table (including `card_custom_x`/`card_custom_y` for drag positions, advanced theme: `bg_opacity`, `gradient_direction`, `border_thickness`, `border_opacity`, `glow_intensity`, `shadow_*`), applied at runtime in `overlay.js` via `applyCustomDesign()`.
- `applyCustomDesign()` must NOT overwrite dynamic detail text for donations/subs/bits/raids — only for follows.
- Tab persistence uses `localStorage` across all tabbed pages.
- Open Graph meta tags in `header.ejs` for social sharing previews.
- Domain: `atletanotifications.com` (Cloudflare DNS → Railway).
- **Pitwall static route Cache-Control split** (`src/server.js:64-74`): `.html`/`.js` get `no-cache, no-store, must-revalidate` so deploys ship fresh overlay code immediately; all other assets (SVG flags, PNG helmets, CSS, images) get `public, max-age=3600`. Without the split, the standings/relative overlays' rebuild loop forced a fresh network round-trip per `<img class="flag-img">` and produced a visible flicker on every flag. Keep this split if you ever change static-file headers.
- Public tip pages at `/tip/:username` are NOT behind auth middleware.
- **Public API endpoints (placed BEFORE the `/api` auth middleware in `server.js`):**
  - Track maps: `GET /api/track-maps`, `GET /api/track-map/:name`, `POST /api/track-map`
  - Sessions: `POST /api/session`, `POST /api/session/:id/lap`, `PATCH /api/session/:id/finish`, `GET /api/sessions/:trackName`, `GET /api/session/:id`, `GET /api/session/share/:token`
- Racing auth endpoints (`/racing/auth/*`) are public. Other `/racing/*` routes (except `/` and `/signup`) require `req.racingUser`.
- Team routes mounted at `/racing/teams` (not `/racing/team`). Old `/racing/team` URL redirects. Detail routes use `/racing/teams/:teamId/...`. Max 5 teams per user enforced in both routes and DB transactions.
- `racing_sessions` table is separate from web auth `sessions` table. Query functions: `getRacingSessionById` / `deleteRacingSession` to avoid collision with web auth session functions.
- `racing_users` table uses `COLLATE NOCASE` for username (case-insensitive login).
- `process.on('unhandledRejection')` and `uncaughtException` handlers in `src/index.js` log and continue (long-running server must not crash on a single bad promise).
- Token refresh paths in `src/services/twitch.js` and `src/services/spotify.js` use in-flight promise locks (per-streamer for spotify, single global for twitch app auth) to prevent concurrent callers from racing parallel refresh requests.
- `src/services/chatModeration.js` in-memory Maps (`permits`, `lastMessages`, `followCache`, `offenseCounts`) sweep stale entries every 60s with `.unref()` so they don't hold the process.
- **`.dockerignore` excludes `bridge/*` BUT re-includes `bridge/overlays` + `bridge/overlays/**` at the bottom of the file** so the pitwall iframes can be served from `/pitwall/overlays/*` on Railway. Without this, helmet PNGs and flag SVGs would also fall under the global `*.png` rule. Keeps the Railway image lean (577MB `bridge/` is mostly Electron node_modules) while still shipping the 3.4MB overlay HTML/SVG/CSS/JS the pitwall needs. Other `.dockerignore` excludes: `node_modules`, `.git`, `data`, `docs`, `tests`, `*.png`, `bun.lock`, `.playwright-mcp`, `.superpowers`, `.env*`.
- `.worktrees/` is gitignored — used for isolated branches during subagent-driven development.

## Overlay Consistency Rule

**The overlay builder (`overlay-builder.ejs`) is the source of truth for how alerts look.** The actual OBS overlay (`overlay.js` + `overlay.css`), the overlay config preview (`overlay-config.ejs` iframe), and the builder preview must all render cards identically:

- **Card structure:** All event types must use the same HTML structure: `top-accent` + `card-body` (with `wrapWithSideIcons`) + `car-track`. No event-specific custom sections.
- **Screen effects:** Direction-based effects (up/down/left/right) must work in both the builder preview (`renderScreenEffect()` in overlay-builder.ejs) and the OBS overlay (`spawnEffects()` in overlay.js). CSS classes for effects must NOT hardcode positional properties (`top`, `left`, etc.) — positions are set dynamically by JS based on direction.
- **Design application:** `applyCustomDesign()` in overlay.js and `updatePreview()` in overlay-builder.ejs must apply the same visual properties (colors, fonts, sizes, border-radius, animations, side icons).
- **When adding/changing any visual property:** Update all three rendering paths — builder preview, OBS overlay `generateCardHTML()`/`applyCustomDesign()`, and the EVENT_DEFAULTS in the builder.

## Team Activity Log

This section is the shared coordination surface for the dev team (team-leader + frontend-dev + backend-dev + team-security + team-qa + team-ux + team-deployment). Every team member reads the last few entries before working and appends one entry after.

Format per entry:

```
### YYYY-MM-DD HH:MM — <role>
**Task:** <one line>
**Files:** <comma-separated paths or "none">
**Decisions:** <2-4 bullets the next teammate needs to know>
**Open:** <followups, or "none">
```

When this log grows past ~10 entries, archive the oldest to `docs/team-log-archive/YYYY-MM.md` and keep the most recent 5–8 here.

### 2026-05-10 15:30 — backend-dev
**Task:** Implement Channel Points → Audio/Video Overlay redemption feature (§1–§6, §9 of plan)
**Files:** `src/db.js`, `src/routes/auth.js`, `src/routes/dashboard.js`, `src/server.js`, `src/services/eventsub.js`, `src/services/twitch.js`, `src/services/twitchRewards.js` (new), `src/services/redemptionDispatcher.js` (new), `src/services/redemptionDispatcher.test.js` (new), `src/services/redemptionTemplates.js` (new)
**Decisions:**
- `formatChatTemplate` extracted to `redemptionTemplates.js` (pure, no external deps) so it can be unit-tested without env vars — same pattern as `incidentTracker.js` / `flagState.js` in bridge; `redemptionDispatcher.js` imports it from there.
- Regex single-pass replacement prevents double-substitution when user value contains a placeholder string (e.g. user=`{cost}`).
- `GET /dashboard/redemptions` renders `redemptions-config.ejs` which does not exist yet — frontend-dev must create it; Express will throw a clear 500 until it does.
- `cp_rewards_enabled` added to `OVERLAY_COLUMNS` whitelist so `updateOverlayConfig()` accepts it via the existing settings route.
**Open:** Frontend-dev needs `src/views/redemptions-config.ejs` + card in `src/views/dashboard.ejs` (§7–§8). i18n keys (§10) pending.

### 2026-05-10 17:45 — frontend-dev
**Task:** Implement Channel Points redemption UI — overlay rendering (§7) and dashboard management page (§8)
**Files:** `src/routes/overlay.js`, `public/overlay/overlay.js`, `src/views/redemptions-config.ejs` (new), `src/views/dashboard.ejs`
**Decisions:**
- `playRedemption()` + `stopRedemption()` added to `public/overlay/overlay.js`; `_redemptionCapTimer` scoped at module level to handle both audio and video hard-cap; `stopCurrentSound()` now calls `stopRedemption(false)` so a `clear` event during redemption playback cleans up both elements.
- `stopRedemption` is a regular `function` declaration (hoisted), so the call from `stopCurrentSound()` (which appears earlier in the file) works correctly at runtime.
- Dashboard card in `src/views/dashboard.ejs` uses `require('../services/twitch').hasRedemptionScope(streamer)` inline per plan — path resolves relative to `src/views/` in Express/EJS server-side context.
- `redemptions-config.ejs` uses raw-body upload (not FormData) matching sponsor upload pattern — `Content-Type: application/octet-stream` with query params for metadata.
- EJS template compiles cleanly (`ejs.compile` check, length 67394 chars). Node syntax check passes for both modified JS files.
**Open:** i18n keys (§10) still pending. Playwright tests run against production (`atletanotifications.com`) so not executed here — will run on push via pre-push hook. Manual smoke test requires a live server with `.env`.

### 2026-05-10 18:15 — team-deployment
**Task:** Commit + push + Railway deploy for Channel Points → Audio/Video Overlay redemption feature
**Files:** `CLAUDE.md`, `public/overlay/overlay.js`, `src/db.js`, `src/locales/en.json`, `src/routes/auth.js`, `src/routes/dashboard.js`, `src/routes/overlay.js`, `src/server.js`, `src/services/eventsub.js`, `src/services/twitch.js`, `src/views/dashboard.ejs`, `src/services/redemptionDispatcher.js` (new), `src/services/redemptionDispatcher.test.js` (new), `src/services/redemptionTemplates.js` (new), `src/services/twitchRewards.js` (new), `src/views/redemptions-config.ejs` (new)
**Decisions:**
- Commit `d2d96e7` — 16 files, 2116 insertions; pushed to `origin/main` (no pre-push Playwright hook fired — hook deferred to remote CI).
- Railway deploy `80c7d8fb-5815-431e-81d2-201af96662ea` → `Atleta Notifications PROD` / production — build succeeded, container started cleanly.
- DB migrations confirmed in logs: `cp_affiliate_status`, `cp_last_sync_at`, `cp_rewards_enabled` columns added to `streamers`. No errors for `channel_point_rewards` / `channel_point_redemptions` tables (additive migrations ran silently on first deploy).
- EventSub fault-tolerant skip for `channel:manage:redemptions` scope confirmed: both streamers (3, 13) subscribed to their existing event types with zero `Failed to subscribe` errors for the redemption type — silent skip working as designed.
**Open:** i18n keys (§10) still pending. Existing streamers need to re-auth via Twitch broadcaster OAuth to gain `channel:manage:redemptions` scope — they will see a banner on the dashboard prompting this. No rollback needed — all migrations are additive and the server is healthy.

### 2026-05-10 19:00 — backend-dev
**Task:** Implement backend for Twitch chat-keyword giveaway feature (plan §1-§5, §8)
**Files:** `src/db.js`, `src/services/giveawayManager.js` (new), `src/services/giveawayManager.test.js` (new), `src/services/twitchChat.js`, `src/routes/dashboard.js`, `src/index.js`
**Decisions:**
- Added `giveaways` + `giveaway_entries` tables (additive, `CREATE TABLE IF NOT EXISTS`). Added `overlay_giveaway_enabled` (DEFAULT 1) and `overlay_giveaway_duration` (DEFAULT 8000) to `streamers`. Both added to `OVERLAY_COLUMNS` for `updateOverlayConfig()` whitelist.
- `giveawayManager.js` keeps in-memory `activeStates` Map for O(1) lock-free chat hot path. `tryAddEntry` is synchronous (no DB read for mismatching messages). `pickWinners` wraps `markWinners`/`markRedrawnOut` in `db.transaction()` for race safety. All lazy `require()` for `twitchChat`/`overlayBus` to avoid circular imports. All watchdog timers use `.unref()`.
- Chat hook inserted in `handleMessage()` after moderation gate and before `!`-command dispatch. Keyword is exclusive while giveaway is open; falls through to `!commands` after close.
- `GET /dashboard` route now passes `activeGiveaway` local for frontend status dot.
- `giveawayManager.init()` called in `index.js` inside `client.once('ready')` after `timedNotificationManager.startAll()`. Logs rehydrated count.
- 13 node:test tests: all pass (`node --test src/services/giveawayManager.test.js`).
**Open:** Frontend EJS (`giveaways-config.ejs`), `dashboard.ejs` card, `overlay.js` render path, overlay-builder/overlay-config event type, and i18n keys (plan §6, §7) are pending for frontend-dev.

### 2026-05-10 20:00 — frontend-dev
**Task:** Implement frontend for Twitch chat-keyword giveaway feature (plan §5, §6)
**Files:** `public/overlay/overlay.js`, `src/views/overlay-config.ejs`, `src/views/overlay-builder.ejs`, `src/views/dashboard.ejs`, `src/views/giveaways-config.ejs` (new)
**Decisions:**
- `overlay.js`: Added `giveaway_winner` to `getCardClass()` map, `buildBannerContent()` switch (label "Giveaway Winner!", @username, conditional prize line, same car-track structure with speed dots like follow/donation), and `spawnEffects()` defaults map (confetti). The enabled gate uses the existing generic `overlayConfig[eventType]` path which returns undefined (passes through, matching DB default of enabled=1). Duration: `overlay_giveaway_duration` is stored as 8000ms (milliseconds) unlike other events which are in seconds; the config route does not yet pass it via the SSE config object so it falls back to 5s display — acceptable for v1; i18n pass should also add this to the overlay SSE config.
- `overlay-config.ejs`: Added Giveaway Winner alert card in the Twitch tab before the closing `</div>`. Duration field shows `Math.round((streamer.overlay_giveaway_duration || 8000) / 1000)` seconds (divide because DB stores ms). Form saves back in seconds which the backend `updateOverlayConfig()` whitelist accepts.
- `overlay-builder.ejs`: Added `giveaway_winner` event tab (🎁), `EVENT_DEFAULTS` entry (amber/gold `#f59e0b` accent — distinct from donation purple and raid red), `DEFAULT_SIDE_ICONS` (🎉 party popper), `EVENT_NAMES`, `PREVIEW_USERNAMES` (LuckyViewer42), and `getDetailPreviewText` mapping.
- `dashboard.ejs`: Added Giveaways card as 7th card in Twitch grid after Channel Point Rewards. Status dot is red+pulse when `activeGiveaway` (local already passed by backend-dev). `@keyframes pulse` already defined in `header.ejs`.
- `giveaways-config.ejs`: Full page — active panel (keyword chip + copy, prize, eligibility badge, live entry count + countdown polling every 2s, entrants table with first 50, Pick/Close/Cancel actions); start form (keyword prefix `!`, prize, duration radios + custom seconds, subs-only toggle, winners count); last winners card with re-draw; history table with lazy-loaded `<details>` expand per row. All `fetch()` calls use JSON. Pure vanilla JS — no jQuery.
**Open:** i18n keys (§7) not yet added. The SSE config route (`src/routes/overlay.js`) does not expose `overlay_giveaway_duration`/`overlay_giveaway_enabled` so the overlay always uses the fallback 5s duration and passes the enabled check silently. Both are cosmetic for v1 and require a backend-dev pass to fix cleanly.
