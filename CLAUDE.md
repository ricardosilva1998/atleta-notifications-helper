# Atleta Personal Helper

One product: **Streamer** (Twitch/YouTube/Discord tools). A Racing product (iRacing telemetry, the Atleta Racing desktop app, its accounts, Team Pitwall) existed until 2026-11-16 and was removed whole; see "Racing removed" in `docs/operations/deploy.md`.

**Streamer:** Monitors Twitch (live streams, clips, recaps, milestones), YouTube (videos, Shorts, livestreams — hidden from streamers while the `features.youtube` flag is off, as it is now; the YouTube channels already watched keep posting, and livestream detection and the live chat bot also need `YOUTUBE_API_KEY`, which production does not have), and provides welcome messages, subscriber role sync, and weekly digests. Includes chatbots for Twitch and YouTube with customizable thank-you messages, custom commands, 13 built-in fun commands, and chat moderation. OBS overlay with racing-themed animated notification banners, a visual overlay builder with advanced theme editor, and multiple card animations. Channel Point Rewards, giveaways, Twitch polls and predictions, shoutouts, PayPal donations, a multistream relay (switched off until the relay exists), Spotify `!song` integration. Streamers configure everything through `atletanotifications.com`. Requires Discord OAuth login.

## Tech Stack

- **Runtime:** Node.js 24 (production image `node:24-slim`, pinned by digest in the `Dockerfile`, with `NODE_ENV=production`; no TypeScript, no build step)
- **Backend:** Express v5, EJS templates (server-rendered)
- **Database:** SQLite via better-sqlite3 (WAL mode, foreign keys)
- **Bot:** discord.js v14 (intents: Guilds, GuildMembers, GuildVoiceStates and the privileged MessageContent, which coaching transcripts need and the owner switches on in the Discord Developer Portal; a login Discord refuses for it is retried without it and no transcript is sent; nothing the bot posts can ping @everyone, roles or users unless that send opts in)
- **External APIs:** Twitch Helix, Twitch EventSub (WebSocket), YouTube Data API v3 + Live Chat API + RSS feeds, Spotify Web API, PayPal, Anthropic (AI analysis of reported issues), ElevenLabs (tips read aloud)
- **Chatbot:** tmi.js (Twitch IRC) — single shared connection for all channels; YouTube Live Chat API polling
- **i18n:** Custom JSON-based translation system (7 languages); every streamer page and the public tip page are translated (`docs/features/i18n.md`)
- **Deployment:** Docker on Railway with persistent volume at `/app/data`. `railway.json` records the build (the `Dockerfile`, whose `CMD` is the start command), the deploy healthcheck (`/health`, 120 s) and restart-on-failure (10 retries), but Railway is retiring Config as Code files, so the same values are set in the Railway dashboard too. A push to `main` deploys. Service settings, variables, the secrets rollout and rollback cautions: `docs/operations/deploy.md`; backups and restore: `docs/operations/backup-restore.md`.
- **CI:** `.github/workflows/server-ci.yml` runs on pushes and pull requests to `main`: `npm ci`, `node --check` on `src/**/*.js` and on every `public/**/*.js`, the unit suite, and two boots in a row on a fresh database with `DISCORD_DISABLED=1` (each must answer `/health` 200, print no `[DB migration]` line, and exit 0 on SIGTERM). No secrets; actions pinned by commit SHA.
- **Testing:** `node --test` unit suites (run explicitly; `npm test` is a no-op): `src/**/<name>.test.js` next to the module, `tests/*.test.js` for cross-cutting ones (overlay objects, placement, builder and client; the CSRF client; the translated pages; the shared layout, `headerView.test.js`, and the JSON embeds in views, `scriptEmbeds.test.js`; the multistream relay; the poll bar's model against `pollRules`, `pollBar.test.js`; the locale script, `localeKeys.test.js`; the tip voices and their previews, `ttsPreviews.test.js`). They never touch the network, production or `data/` (stubs, in-memory SQLite, temp dirs). A test that loads `src/db.js` stubs `better-sqlite3`, `fs` and `./config` through `Module._load` (pattern: `src/db.accounts.test.js`), because `db.js` requires `config.js`, which exits without the required env; `src/server.app.test.js` loads the real `server.js` on an in-memory database and talks to it over HTTP (rate-limit keys, the retired Racing API answering 410, the `/racing*` and `/tracks*` redirect, disabled accounts). The server's Playwright specs are the `tests/*.spec.js` files (never name a unit test `*.spec.js`): `alertObjects.spec.js` (the real overlay at `E2E_BASE_URL`, default `http://localhost:3000`; skipped without `E2E_OVERLAY_TOKEN`) is the only one, and honours `E2E_BASE_URL`. `tests/playwright.config.js` points `baseURL` at production, so specs must build absolute URLs from `E2E_BASE_URL` and guard with `test.skip` rather than relying on `baseURL`. NOTE: there is currently **no** pre-push git hook — `.git/hooks` contains only samples.
- **Auth:** Discord OAuth (Streamer), plus the coaching viewer's Discord sign-in (`identify` only, never creates a streamer)


## Commands

- `npm run dev` — run locally (loads `.env` via `--env-file`)
- `DISCORD_DISABLED=1 TWITCH_CLIENT_ID=x TWITCH_CLIENT_SECRET=x node src/index.js` — run the site without the Discord bot (dev/CI only; no Discord credentials needed)
- `node --test "src/**/*.test.js" "tests/**/*.test.js"` — the unit suite (what CI runs)
- `npm start` — production start
- `E2E_OVERLAY_TOKEN=<a streamer's overlay token> npx playwright test -c tests/playwright.config.js alertObjects.spec.js` — the Playwright spec that honours `E2E_BASE_URL` (default `http://localhost:3000`, so start the site first with the `DISCORD_DISABLED=1` command above; the token is the last part of the streamer's `/overlay/<token>` URL). Do not run a bare `npx playwright test`: from the repo root it also tries to run every spec

No linting configured.

## Project Structure

```
src/         index.js (entry), config.js, db.js (schema + all SQL), server.js (Express app), discord.js (the one place that posts)
  pollers/   Twitch, YouTube, digest and sub-sync pollers
  services/  Twitch/YouTube/Spotify/PayPal clients, chat bot, moderation, overlay, tracking, coaching, tips
  routes/    Express routes: auth, dashboard, overlay, tip, coaching, admin, api
  views/     EJS templates (header.ejs is the layout; cards/ holds the dashboard cards)
  locales/   Translation files (en, pt, es, fr, de, zh, ja)
public/
  js/        Page scripts (dashboard cards, builder, tracking, coaching, csrf)
  overlay/   OBS browser sources, alert looks and sounds
tests/       Cross-cutting unit suites and the Playwright spec
scripts/     Maintenance scripts (locale keys, look sounds, token rollback)
data/        bot.db, backups, uploads (persistent volume)
docs/        features/ (deep dives), operations/ (deploy, backup), superpowers/ (plans and specs)
```

Every file with what it does: docs/project-structure.md.

## Key Architecture

Each area's full notes are a section of docs/architecture.md, under the heading named here. Read the section before changing that area; update it in the same change.

- **Dashboard**: platform tabs, working cards, card settings API, Discord notifications card
- **OBS Overlay**: EventSub to SSE overlay, alert slots and durations, overlayConfig, presence
- **Overlay Builder**: card grid, edit window tabs, Location, save/reset/family routes; spec docs/superpowers/specs/2026-10-16-overlay-builder-cards-design.md
- **Alert styles**: looks and families, private/standalone looks, settings, adding a family; spec docs/superpowers/specs/2026-10-15-alert-styles-design.md
- **Feature Flags**: config.features: youtube, kick, overlays, vtuber, pricing and what each hides
- **Twitch Chatbot (Atleta)**: shared tmi.js connection, chatDispatcher, thank-yous, custom and built-in commands
- **Chat Moderation**: filters, banned words and regex, escalation, raid protection, mod log
- **YouTube Chatbot**: Live Chat polling, Super Chats, members, bot token refresh, moderation
- **Spotify Integration**: OAuth, !song, token refresh, disconnect
- **Shared OBS stream client**: public/overlay/sse.js reconnect rules, guarded look drawing
- **Migrations and their test**: _addColumn, _runOnce, tests/migrations.test.js and the oldest-schema fixture
- **Robustness rules (2026-11-18)**: digest/milestone/recap token rules, clip baseline, raid restore, form limits
- **Dev sync is scrubbed**: GET /sync/backup scrubbing, one sync at a time, dev restore
- **Look sounds**: ElevenLabs recordings per look, manifest, playback; also docs/features/look-sounds.md
- **Sound System**: per-streamer custom alert sounds, upload checks, served per token
- **Sponsor Rotation**: sponsor images, timedNotifications, OBS source, clamps
- **Donations (PayPal)**: tip page, PayPal Checkout, pending_tips, tipCapture, payee checks
- **Donation History**: donations table, retention, history page, CSV export, refunds
- **Tip Goals**: tip_goals, Tracking card and page routes, goal bar overlay, refunds and reconcile
- **Tracking**: follower/sub goals, six trackers, periods, OBS sources; also docs/features/tracking.md
- **Tips read aloud**: ElevenLabs voices for tips, limits, statuses; also docs/features/tip-tts.md
- **Channel Point Rewards**: rewards to overlay clips, redemption flow, refunds; also docs/features/channel-point-rewards.md
- **Multistream (Twitch + YouTube passthrough)**: MediaMTX relay, switched off until configured; also docs/features/multistream.md
- **Overlay Event Logging**: overlay_events, SSE write rules, preview iframe, Clear All, test buttons
- **Activity Feed**: stream recaps, milestones, weekly highlights
- **Free for all:** All features are free and unlimited for every user — no tier gating.
- **Auth**: Discord OAuth sessions stored hashed, viewer sessions, no passwords
- **Racing removed (2026-11-16)**: what stays for old clients: 410 paths, redirects, unused columns; see docs/operations/deploy.md
- **Homepage**: features page at /, redirects, language switcher; tests src/server.home.test.js
- **Auth flows (Streamer)**: Discord, Twitch, broadcaster, YouTube, Spotify OAuth flows, state cookies, /link
- **YouTube Shorts**: Shorts detection by duration, separate notification, live videos skipped
- **User feedback**: star rating and message, admin Feedback tab
- **Admin panel**: admin by Discord id, Disable/Remove, issues and AI analysis
- **DB migrations**: startup migrations, pragmas, indexes, _runOnce, CI double boot
- **Boot and shutdown (`src/index.js`)**: boot order, Discord login retry, SIGTERM sequence, minute ticks
- **Health**: GET /health, 200/503, registered first
- **Backups**: nightly SQLite backup, 7-day retention; also docs/operations/backup-restore.md
- **Request bodies**: 100 kb limit, LARGE_BODY_ROUTES in src/bodyParsers.js
- **CSRF** (full notes: docs/architecture.md, "CSRF"):
  - **Adding a form or a `fetch` to a page:** pages get the token as `res.locals.csrfToken`. `header.ejs` includes `views/csrf.ejs`, which loads `public/js/csrf.js` (adds `_csrf` to POST forms as they are sent, `form.submit()` included, and `X-CSRF-Token` to same-origin unsafe `fetch()`/`XMLHttpRequest`), so a page that includes the header needs nothing more. A view that does not include the header must include `csrf.ejs` in `<head>` itself (`overlay-builder.ejs`, `tip.ejs`); `src/csrf.test.js` checks every view and fails when one is missing.
  - **Adding a route that a program, not a browser page, calls with an unsafe method** (the multistream relay, a webhook): add it to `CSRF_EXEMPT` in `src/csrf.js` with its reason, or it gets 403 (`[CSRF] Refused ...` in the log). An exempt route skips only the Origin check: a request to it that carries a logged-in session still needs the token. Today's list: the multistream relay, `/sync/trigger`, the public tip form.
- **Rate limits**: byVisitor keys, general/api/coaching limiters, Cloudflare IPs, /sync/backup secret
- **Uploads and uploaded files**: storage quota, user-content headers, first-bytes checks, issue files
- **Discord servers**: claiming with Manage Server, channel checks, sub role rules, bot invite permissions
- **Secrets at rest**: TOKEN_ENCRYPTION_KEY sealing of OAuth tokens; also docs/operations/deploy.md
- **EventSub (`eventsub.js`)**: session sockets, reconnects, dedupe, subscription retries, gift subs
- **Pollers (`src/pollers/`)**: exclusiveRun, Twitch/YouTube checks, recaps, milestones, weekly digest
- **Giveaways**: chat keyword entries, draw once, winner card, boot behaviour
- **Polls & predictions**: Twitch polls and predictions card, livePolls, bot lines, OBS bar
- **Shoutouts**: !so and raid shoutout, template, limits
- **Coaching**: bookings, PayPal payments, Discord rooms, cancel/reschedule/refunds; also docs/features/coaching.md
- **Errors and deadlines**: errorHandler, error codes in URLs, outbound deadlines, test cooldown
- **No ORM:** All SQL is raw in `db.js`.
- **i18n**: t() helper, 7 languages, guard tests, pt-PT; also docs/features/i18n.md

## Environment Variables

`.env.example` lists every variable with a comment; production's are set on the Railway service (`docs/operations/deploy.md`).

Required:
- `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`
- `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` (not with `DISCORD_DISABLED=1`)

Secrets production should have set (each has a degraded fallback, so a missing one does not stop the boot):
- `TOKEN_ENCRYPTION_KEY` — 64 hex characters (`openssl rand -hex 32`) that seal the OAuth tokens in the database. Unset: they are stored unencrypted (one boot warning). Set but malformed: the boot stops. Never change or lose it; roll it out in two steps (`docs/operations/deploy.md`)
- `LINK_SIGNING_SECRET` — signs the `/link` URLs. Unset: a per-boot secret is used (one warning), so `/link` links still open stop working after a restart
- `CSRF_SECRET` — signs each web session's CSRF token (`src/csrf.js`); make one with `openssl rand -hex 32`. Unset: a per-boot secret is used (one warning), and every page opened before a restart must be reloaded before it can save
- `ELEVENLABS_API_KEY` — Atleta's ElevenLabs key, for tips read aloud (`src/services/elevenLabs.js`; it never reaches a browser). Unset: the Donations page says reading tips aloud is not available, and nothing is sent to ElevenLabs. The look-sounds pipeline in `.superpowers/sounds/` uses the same key from the development `.env`

Optional:
- `APP_URL`, `PORT`
- `ADMIN_DISCORD_IDS` — comma-separated Discord user ids that are admins besides the built-in one; entries that are not numeric ids are ignored (`src/adminAccess.js`)
- `DISCORD_DISABLED=1` — development and CI only: the site runs without the Discord bot (no login, slash commands, welcome messages or pollers). Never set it in production.
- `BOT_TWITCH_USERNAME`, `BOT_TWITCH_TOKEN` — Twitch chatbot credentials (shared single connection); for raid protection and `!slow` the token also needs `moderator:manage:chat_settings`
- `BOT_CHAT_RATE_LIMIT` — most messages the bot may post in any 30 s across all channels, 1–100 (default 20)
- `YOUTUBE_API_KEY` — global key for YouTube livestream detection (and with it the YouTube chat bot); the RSS feed poller works without it. **Unset in production.**
- `YOUTUBE_BOT_CLIENT_ID`, `YOUTUBE_BOT_CLIENT_SECRET`, `YOUTUBE_BOT_REFRESH_TOKEN` — YouTube chatbot credentials
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` — Spotify integration for !song
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MODE` (`sandbox` by default, or `live`)
- `ANTHROPIC_API_KEY`, `TRIAGE_MODEL` (default `claude-sonnet-5-5`) — AI analysis of reported issues
- `ELEVENLABS_TTS_MODEL` (default `eleven_multilingual_v2`) — the ElevenLabs model the tip voices speak with (Portuguese always uses `eleven_turbo_v2_5`: `MODEL_BY_LANGUAGE` in `ttsVoices.js`); `TTS_CREDIT_FLOOR` (default 20000) — no tip is read while the ElevenLabs account has fewer credits left
- `MEDIAMTX_API_URL` (an http(s) address), `MEDIAMTX_INGEST_URL`, `MEDIAMTX_API_TOKEN`, `MEDIAMTX_WEBHOOK_SECRET` — multistream relay; all four switch the feature on (see `docs/multistream-relay-setup.md`). Optional: `MEDIAMTX_API_USER` (relay API login user, default `admin`), `MEDIAMTX_CF_ACCESS_CLIENT_ID` + `MEDIAMTX_CF_ACCESS_CLIENT_SECRET` (Cloudflare Access service token for the relay API hostname)
- Polling intervals (ms): `TWITCH_POLL_INTERVAL`, `TWITCH_CLIPS_INTERVAL`, `YOUTUBE_FEED_INTERVAL`, `YOUTUBE_LIVE_INTERVAL`, `SUB_SYNC_INTERVAL`, `WEEKLY_DIGEST_INTERVAL` (default 15 minutes; leave it unset — an hourly value gives the digest one try per week instead of four)
- `SYNC_SOURCE_URL`, `SYNC_SECRET`, `SYNC_ON_STARTUP` — development only: copies production's data once a day (`src/services/sync.js`); production serves it to a caller that presents `SYNC_SECRET`

Read but unused: `SESSION_SECRET` and `ADMIN_PASSWORD` (sessions are random ids kept as hashes in the database, and admin is decided by Discord id). No longer read at all (unset them on Railway): `MULTISTREAM_KEY_SECRET`, `GITHUB_TOKEN`, `GITHUB_REPO` (the auto-fix feature is deleted). Set by the platform: `NODE_ENV=production` (the `Dockerfile`), `RAILWAY_ENVIRONMENT`; `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=15` is set on the Railway service for the graceful shutdown. `E2E_BASE_URL` and `E2E_OVERLAY_TOKEN` are for the Playwright specs.

## Operations

Runbooks: `docs/operations/deploy.md` (Railway service settings, variables, the `TOKEN_ENCRYPTION_KEY` rollout, rollback caution, the log lines to expect, the checklist for the 2026-10 stream fixes, the notes for Release B (the dashboard working cards), the release note for Vilela's C1 donation alert (with the SQL that checks it and switches it off or on), the notes for the polls, predictions and shoutouts release, the recorded look sounds, Glass as the default look, tips read aloud, Tracking, and Coaching with andre_vilela_'s `!coaching` step) and `docs/operations/backup-restore.md`. What to know before touching production:
- **Railway service:** Dockerfile build, **no custom start command**, healthcheck `/health` (120 s), restart On Failure ×10, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=15`, volume backups on. Set them in the Railway dashboard: `railway.json` is only a record, and Railway is retiring Config as Code files. A push to `main` deploys.
- **Secrets in two steps:** deploy without `TOKEN_ENCRYPTION_KEY`, check the boot log and logins, take a backup, then set the key. Once it is set, never roll back to a release from before it was introduced: older code would send the encrypted text to Twitch as a token and log everyone out (the one emergency way back is `scripts/decrypt-tokens.js`, described in `deploy.md`).
- **Discord:** a refused `DISCORD_TOKEN` no longer fails a deploy (`/health` checks only the database): after any change to the token, read the boot log for `LOGIN REFUSED`.
- **Owner-set variables** (not code): `TOKEN_ENCRYPTION_KEY`, `LINK_SIGNING_SECRET`, `CSRF_SECRET`, `ELEVENLABS_API_KEY` (before tips read aloud ships), a `BOT_TWITCH_TOKEN` with `moderator:manage:chat_settings`, Railway volume backups; remove `GITHUB_TOKEN`, `GITHUB_REPO`, `MULTISTREAM_KEY_SECRET`.

## Conventions

- Plain CommonJS (`require`/`module.exports`), no ESM.
- No framework abstractions — routes, DB queries, and pollers are straightforward procedural code.
- All database operations go through `src/db.js`.
- Config access via `require('./config')`.
- `-1` means unlimited in tier limits.
- CSS design system uses CSS custom properties (defined in `header.ejs`).
- Typography: Outfit (display) + DM Sans (body) via Google Fonts.
- All user-facing text uses `t('key')` — views, the texts a page's script needs, and the answers of routes. No English typed into a view; a new key goes into all 7 locale files (`tests/i18n.test.js` fails without them; `docs/features/i18n.md`).
- Twitch notifications sent as embeds, clips and YouTube videos sent as plain text (for Discord auto-preview).
- Custom alert sounds are stored per streamer in `data/sounds/<streamerId>/<type>.mp3` (persistent volume) and served by `GET /overlay/sounds/:token/:type`; there is no shared sound folder (`public/overlay/sounds/` is an empty placeholder, not a place for sounds). The looks' own recordings are not uploads: they live in `public/overlay/objects/sounds/<family>/` with their content hash in their names, and `node scripts/look-sounds.js` rewrites their manifest after one is added or replaced (docs/features/look-sounds.md).
- Sponsor images stored in `data/sponsors/<streamerId>/`, served via the `/sponsors/` static route.
- Channel point reward media stored in `data/redemptions/{streamerId}/`, served via `/redemptions/`. Filenames are `{rewardId}_{timestamp}.{ext}` so the 24h cache headers stay safe across replacements.
- **EJS templates DO NOT have access to `require()`.** Express's EJS integration runs templates in a sandboxed scope. If a view needs a value derived from a service module, the route handler must compute it server-side and pass it as a template local. Inline `<% require('...') %>` will throw "require is not defined" and crash the page in production. Reference: `routes/dashboard.js` `GET /redemptions` precomputes `hasScope` via `hasRedemptionScope(req.streamer)` and passes it to `redemptions-config.ejs`.
- **Views:** a view that includes `header.ejs` ends with `<%- include('footer') %>` (`tests/headerView.test.js`); a value a page prints into its own script as JSON ends in `.replace(/</g, '\\u003c')` so it cannot end the script (`tests/scriptEmbeds.test.js` checks every `<%- JSON.stringify(...) %>`). The icon library (lucide) loads from one exact version with its `integrity` sha384 in `header.ejs`; to move it, download the file, take `openssl dgst -sha384 -binary lucide.min.js | openssl base64 -A` and change both tags (a hash that does not match makes the browser refuse the script, and every icon disappears).
- **Client/server query-param parity for raw-body uploads.** Sponsor/redemption uploads send file bytes in the body and metadata in `?...` query params. The exact param names must match the server's `req.query.X` reads — a mismatch is silent (e.g., empty title gets re-rejected by length validation with a confusing error). When changing one side, verify the other.
- Overlay designs stored in `overlay_designs` table (including `card_custom_x`/`card_custom_y` for drag positions, advanced theme: `bg_opacity`, `gradient_direction`, `border_thickness`, `border_opacity`, `glow_intensity`, `shadow_*`), applied at runtime in `overlay.js` via `applyCustomDesign()`.
- `applyCustomDesign()` must NOT overwrite dynamic detail text for donations/subs/bits/raids — only for follows.
- Tab persistence uses `localStorage` across all tabbed pages.
- Open Graph meta tags in `header.ejs` for social sharing previews.
- Domain: `atletanotifications.com` (Cloudflare DNS → Railway).
- Public tip pages at `/tip/:username` are NOT behind auth middleware.
- `process.on('unhandledRejection')` and `uncaughtException` handlers in `src/index.js` log and continue (long-running server must not crash on a single bad promise).
- Token refresh paths in `src/services/twitch.js` and `src/services/spotify.js` use in-flight promise locks (per-streamer for spotify, single global for twitch app auth) to prevent concurrent callers from racing parallel refresh requests. The broadcaster token has a per-streamer lock too, `refreshBroadcasterTokenShared` in `twitch.js`, shared by the follow checks and the polls client (both refresh a token past its stored expiry before their request; the polls client refreshes at most once per call): a refresh token Twitch no longer accepts clears the stored scopes, and any other refresh failure stays retryable.
- In-memory Maps and caches get a sweeper that drops stale entries and is `.unref()`'d so it does not hold the process. Pattern: `chatModeration.js` (`permits`, `lastMessages`, `followCache`, `offenseCounts` and the compiled banned-word matchers, swept every 60 s); also `testCooldown.js`, `messageDedupe.js`.
- Security patterns: escape user content (EJS `<%= %>`, `textContent`, the escaping `rich()`); validate and clamp on the server — HTML `min`/`max` are a convenience; compare secrets with `crypto.timingSafeEqual`; give every outbound `fetch` an `AbortSignal.timeout()`; a new token column goes through `sealToken()`/`openToken()`.
- **Rate limits count per visitor address.** Behind Cloudflare that is the `CF-Connecting-IP` header, trusted only when the request reached Railway from one of Cloudflare's published address ranges (`CLOUDFLARE_RANGES` in `src/clientIp.js`, dated — update them if Cloudflare publishes new ranges: until then requests through a new range count as one shared Cloudflare address); otherwise `req.ip` (`trust proxy 1`).
- `.worktrees/` is gitignored — used for isolated branches during subagent-driven development.

## Overlay Consistency Rule

**The overlay builder (`overlay-builder.ejs`) is the source of truth for how alerts look.** The actual OBS overlay (`overlay.js` + `overlay.css`), the overlay config preview (`overlay-config.ejs` iframe), and the builder preview must all render cards identically:

- **Placement:** where an alert sits (the nine grid cells, a dragged `card_custom_x/y`, and `card_width`) is read from the saved design by `public/overlay/placement.js`, which both the OBS overlay (`applyPlacement()`) and the builder's stage (`placeStage()` in `public/js/builder-cards.js`) use. The five object types honour position and width; their colours and animations are not styled yet.
- **Object registry:** The five Twitch event types (`follow`, `subscription`, `bits`, `donation`, `raid`) render from `public/overlay/objects/`. Any change to an object's markup, keyframes or timing is made there and nowhere else — both render paths (the OBS overlay `overlay.js` and the builder preview `overlay-builder.ejs`) consume the same module. Styles (`STYLES` in `objects/index.js`, `window.ATLETA_OBJECT_STYLES` in the browser) are objects filed under a style id with the `eventType` they draw; both render paths pick an alert's object with the same rule (`objectFor()` in `overlay.js`, `previewObjectFor()` in the builder; `tests/overlayBuilder.test.js` fails when the two picks differ: "the preview and the OBS overlay pick the same object for every alert and style"). `STYLES` is a non-enumerable property of the CommonJS export, so `Object.keys(OBJECTS)` is still the five. `overlay-config.ejs` previews via an iframe of the real overlay and needs no parallel change. Every object-internal CSS class MUST be namespaced under its `.o-*` prefix; a bare `.rail` collides with the builder page's sticky control bar, as shown in the prototype at `docs/superpowers/specs/assets/2026-10-09-alert-objects-prototype.html`. Remaining event types still share the legacy `top-accent` + `card-body` + `car-track` structure, whose markup `buildBannerContent()` in `overlay.js` builds.
- **Looks:** the alert looks (`objects/kit.js`, `objects/styles/`) are drawn by both pages from the same files. The builder's `previewObjectFor` and the overlay's `objectFor` pick with the same rule (`tests/overlayBuilder.test.js` runs both). A look's data comes from `kit.lookData`, its colour and speed from `kit.slotVars`, its effect and sound from `kit.effectFor`/`kit.soundFor` (an alert with no look stored is handed its default look's own settings by both: `kit.ownSettings` through `designOf()` in the overlay, the same reset through `untouched()` in the builder; `tests/builderStylesCore.test.js` checks they agree), and its five new screen effects from `fx.js` (`spawnEffects` and `renderScreenEffect` both call `ATLETA_FX.spawn`).
- **Screen effects:** Direction-based effects (up/down/left/right) must work in both the builder preview (`renderScreenEffect()` in overlay-builder.ejs) and the OBS overlay (`spawnEffects()` in overlay.js). CSS classes for effects must NOT hardcode positional properties (`top`, `left`, etc.) — positions are set dynamically by JS based on direction.
- **Design application:** `applyCustomDesign()` in overlay.js and `updatePreview()` in overlay-builder.ejs (the legacy cards' stage: sponsor images and the YouTube alerts) must apply the same visual properties (colors, fonts, sizes, border-radius, animations, side icons). The default side icons are the builder's table: `DEFAULT_SIDE_ICONS` in overlay.js lists the alerts the builder gives one (`tests/overlayClient.test.js` fails when they differ). A legacy card fades out only once its entrance is taken off (`.entering` and the inline `animation`), because the entrance's last frame holds the opacity.
- **When adding/changing any visual property:** Update all three places — the builder preview (`updatePreview()` in `overlay-builder.ejs`), the OBS overlay (`buildBannerContent()` and `applyCustomDesign()` in `overlay.js` for the legacy cards; the five Twitch events come from `public/overlay/objects/`, which both pages already share), and the shared defaults and save schema in `src/services/overlayDesign.js` (`EVENT_DEFAULTS`, which the route injects into the builder page, and `FIELD_SPECS`; `overlayDesign.test.js` fails when the builder's controls drift from them).

## Team Activity Log
Older entries: docs/activity-log.md. Keep only the last 10 here; move older ones there (append) when adding.

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

Older entries are archived: `docs/team-log-archive/2026-05.md` (the May 2026 channel point rewards and giveaway rounds) and `docs/team-log-archive/2026-10.md` (October 2026, from the stream fixes to the end of Coaching, 2026-10-29 13:30) and `docs/team-log-archive/2026-11.md` (the coaching payment, rooms and sign-in first run, and the cancel, reschedule and refunds run, 2026-11-16).

### 2026-11-24 — backend-dev (T2, deep-review follow-ups)
**Task:** The after-start check uses the time the capture returned
**Files:** src/services/coachingPayments.js, src/services/coachingPayments.test.js
**Decisions:**
- `record()` takes `Math.max(now, Date.now())` at call time (every caller is after a PayPal answer), so a capture that returns after the session start is `late_issue` with Refund pending; pre-call `mayCapture` checks unchanged.
- The test file stubs `Date.now` (fixed 2026-11 week is in the past) via a `clock` variable.
**Open:** none

### 2026-11-24 — backend-dev (T3, deep-review follow-ups)
**Task:** A room delete Discord refuses for permissions is given up 24 h after close_at and the coach is told
**Files:** src/services/coachingRooms.js, src/services/coachingMessages.js, src/locales/*.json, src/services/coachingRooms.test.js, src/services/coachingMessages.test.js
**Decisions:**
- `clean()` still returns a boolean; on failure it sets `room.cleanError` (errorCode). `closeDue` closes the row (`error = 'missing_permissions'`) once `now - close_at >= 24 h`, logs one line and sends one `roomDeleteRefused` DM (always, in the coach's saved language); other errors keep the minute retry.
**Open:** none

### 2026-11-24 — backend-dev (T4)
**Task:** A channel added to a watch list again starts with a fresh clip baseline
**Files:** src/db.js, src/db.test.js
**Decisions:**
- `addWatchedChannel` runs in a transaction: when the insert is new and no other `watched_channels` row has that login (any server), `channel_state.last_clip_created_at` is set to NULL so the clips poller's first look posts nothing old; with another watcher the state is left alone.
**Open:** none

### 2026-11-24 — backend-dev (T5, deep-review follow-ups)
**Task:** Milestones and recaps never use another streamer's broadcaster token
**Files:** src/pollers/manager.js, src/pollers/twitchLive.js, src/services/twitch.js, src/pollers/manager.test.js
**Decisions:**
- `findBroadcasterStreamer(broadcasterId)` returns only the owner (`twitch_user_id`) with a token; no loop over watchers.
- Without the owner's token milestones are skipped and the recap has no follower count (Twitch's follower endpoint needs a user token; C1.1.1 removed the app-token fallback this entry first described).
**Open:** none

### 2026-11-24 — frontend-dev (T6, deep-review follow-ups)
**Task:** OBS stream probe deadline and the overlay settings button row on phones
**Files:** public/overlay/sse.js, tests/sseClient.test.js, src/views/overlay-config.ejs
**Decisions:**
- `retryDelay`'s probe is aborted after 10 s (AbortController + timeout, cleared on answer); a timeout counts as a non-404 failure (5 s retry).
- The Alerts header row and its button group wrap (`flex-wrap`), so `/dashboard/overlay` has no sideways scroll at 360/375 px in all 7 languages; English desktop row unchanged.
**Open:** none

### 2026-11-24 — claude (general-purpose, T7 of deep-review follow-ups)
**Task:** "catorze" in pt.json and the pt-PT guard
**Files:** src/locales/pt.json, tests/ptPt.test.js, CLAUDE.md
**Decisions:**
- `overlayBuilder.looks.raid-music.desc` says "catorze"; "quatorze" is now a Brazilian marker in `tests/ptPt.test.js` (fr.json untouched).
**Open:** none

### 2026-11-24 — claude (general-purpose, T8 of deep-review follow-ups)
**Task:** Docs, deploy note and the plan copy
**Files:** CLAUDE.md, docs/features/coaching.md, docs/operations/deploy.md, docs/superpowers/plans/2026-11-24-deep-review-follow-ups.md, .gitignore
**Decisions:**
- CLAUDE.md edits only the changed sentences (Coaching, Robustness rules, Shared OBS stream client); coaching.md has the lapsed-payment read-back, the 24 h room give-up and the `roomDeleteRefused` DM row.
- deploy.md has a short release note: no schema change; item 6 (`prev_unknown` rows) closed with no code; live checks and a plain-revert rollback.
**Open:** none

### 2026-11-24 — team-qa
**Task:** T9, full QA of the deep-review follow-ups branch (items 1-9)
**Tests added/changed:** none
**Suite result:** scratch copy (Node 26, better-sqlite3 rebuilt): 4076 tests, 4076 pass, 0 fail. `node --check` on all src and public files: no FAIL. Two boots on empty data/: `/health` 200, 0 `[DB migration]` lines, exit 0 on SIGTERM both times.
**Manual checks:** headless Chromium, seeded streamer, `/dashboard/overlay` in en, pt, es, fr, de, zh, ja at 360, 375 and 1280 px: no horizontal scroll in any of the 21; at 1280 px English the Clear All button sits at the same position and size as on `main`.
**Bugs found:** none. Items 1-5 and 7-8 each have a test; 9 is the browser check above. QA: pass.
**Open:** none

### 2026-11-24 — backend-dev (C1.1.1)
**Task:** Milestones and the recap follower count need the owner's token (no app-token fallback)
**Files:** src/services/twitch.js, src/pollers/manager.js, src/pollers/twitchLive.js, src/pollers/manager.test.js, CLAUDE.md, docs/operations/deploy.md, docs/superpowers/plans/2026-11-24-deep-review-follow-ups.md
**Decisions:**
- `getFollowerCount` is back to the user-token version; `checkMilestones` returns before any Twitch call without the owner's token; `buildRecap` reads followers only with a token.
- Twitch's follower endpoint needs a user token, so the app-token call 401'd and made `apiCall` fetch a new app token each time.
**Open:** none

### 2026-11-28 15:00 — team-qa (relay T5, tidy-up CLAUDE.md)
**Task:** QA gate for the CLAUDE.md tidy-up (nothing lost, no code changed)
**Files:** CLAUDE.md (log only), docs/activity-log.md
**Decisions:**
- CLAUDE.md went from 144,070 to 36,513 characters (145,435 to 36,614 bytes); the moved text is in the new docs/project-structure.md and docs/architecture.md; check_moved.py exits 0.
- Only CLAUDE.md and docs changed; unit suite 4076/4076 pass in a scratch copy (better-sqlite3 rebuilt for Node 26).
- Found: the Key Architecture index ends with its last two bullets (No ORM, i18n) twice (CLAUDE.md lines 108-112); the duplicate is left for the editor to remove.
**Open:** remove the duplicated No ORM and i18n index lines.
