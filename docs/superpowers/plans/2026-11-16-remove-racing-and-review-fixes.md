# Plan: Remove Racing, then fix the review findings

Brief: `brief.md`

Choosing agents: use the team agent whose lane fits (`frontend-dev`, `backend-dev`, `team-security`, `team-qa`, `team-ux`). Use `general-purpose` for docs, CI files and repo housekeeping.

Every worker runs on `sonnet`. Tasks run one at a time. No task pushes or deploys: the ship session does that after review.

## Common rules for every task (read before starting)

- Repo: `/Users/ricardsilva/Library/Mobile Documents/com~apple~CloudDocs/Projects/vilela-notifications`. Read the project `CLAUDE.md` (stack, conventions, i18n rules, Overlay Consistency Rule) before working.
- **Branches.** Part 1 (T1–T6) commits on `chore/remove-racing`, created from `main` (0007810) by T1. Parts 2–5 (T7–T19) commit on `fix/review-findings`, created by T7 from the tip of `chore/remove-racing` (stacked; the ship session opens two PRs). Never commit on `main`. Never push, force-push, `reset --hard`, `branch -D` or rewrite history. Leave the untracked `* 2.*` duplicate files and `HANDOFF-merge-pr5.md` alone.
- Commit at the end of each task with a conventional message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Off limits:** Coaching files (`src/routes/coaching*.js`, `src/routes/myBookings.js`, `src/services/coaching*.js`, `public/js/coaching-*.js`, `public/js/my-bookings.js`, `public/js/dashboard-coaching.js`, coaching views, `my-bookings.ejs`, `docs/features/coaching.md`), except T17's tab-flash fix in `src/views/coaching-dashboard.ejs`. Coaching viewer sign-in (`/auth/coaching-signin`, `/auth/coaching-signout`, the callback's coaching branch, `viewer_sessions`, `req.viewer` in `server.js`) must keep working. Don't touch `.env`, production data, Railway settings or `TOKEN_ENCRYPTION_KEY`. Don't delete `routes/payment.js`, `pricing.ejs`, `subscription.ejs` or the tier table.
- **Not Racing (keep):** the "Racing" alert-look family (`public/overlay/objects/styles/racing.*`, `*-racing` looks, `overlayBuilder.families.racing.*`, `racingGreen` preset, `anim.groupRacing`, the synthesized racing sounds in `overlay.js`), racing jokes in `builtinCommands.js`, Spotify `!song` and its OAuth, the `ws` package (EventSub uses it), `@anthropic-ai/sdk` (issue triage), `socket.io-client` until T9 removes it.
- **Tests and Node.** Local `node` is v26; `better-sqlite3` in the repo is built for Node 24, so DB-backed suites fail in the repo with `ERR_DLOPEN_FAILED`. Never edit `package.json`/lockfile to fix that and never rebuild in the repo. To run the full suite, make a scratch copy and rebuild there:
  ```
  S=/private/tmp/claude-501/relay-racing-suite; rm -rf "$S"; mkdir -p "$S"
  rsync -a --exclude .git --exclude data --exclude bridge "$PWD"/ "$S"/
  (cd "$S" && npm rebuild better-sqlite3 >/dev/null && node --test "src/**/*.test.js" "tests/**/*.test.js")
  ```
  (After T4 deletes `bridge/` the exclude is moot.) "Suite passes" below means this command ends with `fail 0` (one pre-existing skip is fine). Clean-boot check (from the scratch copy): `DISCORD_DISABLED=1 TWITCH_CLIENT_ID=x TWITCH_CLIENT_SECRET=x PORT=3999 node src/index.js` on an empty `data/`, `/health` answers 200, no `[DB migration]` line, exit 0 on SIGTERM; then boot a second time on the same data with the same result.
- Every user-facing text goes through `t()` in all 7 locales (`tests/i18n.test.js`); every Portuguese text is European Portuguese (pt-PT). Removing a key means removing it from all 7 locale files (`scripts/locale-keys.js` keeps the layout; or edit by key).
- Line numbers below are where an earlier read saw things; re-read before changing.

## Shipping
- **Ship:** yes. The project rule is that a push to `main` deploys, and the brief asks to ship. Two PRs, in order: **PR A** `chore/remove-racing` → `main` (Part 1 alone; it carries the table-drop migration), then **PR B** `fix/review-findings` (Parts 2–5; stacked on PR A; after PR A merges, change PR B's base to `main` with `gh pr edit --base main`, no rebase/force-push).
- **Where:** GitHub `main` (requires a review); merging deploys to Railway project `atleta-notification-helper` (this folder is linked; `railway logs` works). Panes cannot run `gh pr merge --admin`: the ship session asks main, and the owner runs `! gh pr merge <n> --admin --merge` in the main pane.
- **Checks before push:** none local (no pre-push hook). CI (`.github/workflows/server-ci.yml`: `npm ci`, `node --check`, unit suite, two clean boots) must pass on each PR before merge; the DB suites only run there.
- **Before merging PR A:** take a manual backup per `docs/operations/deploy.md` (the release note T5 writes) — the migration drops the Racing tables for good.
- **Verify live:** after each deploy, `https://atletanotifications.com/health` → 200; dashboard loads for a logged-in streamer. After PR A: `/racing`, `/tracks`, `/pitwall/overlays/x` answer 404 or redirect to `/`, and `/api/session`, `/api/bridge/config` answer 410; `railway logs` shows no `[DB migration]` error lines and `/my-bookings` still loads. After PR B: `/pricing` and `/payment` redirect, the overlay settings page has no StreamElements card, `/dashboard/coaching` opens on the remembered tab with no flash.

## Tasks

### T1: Racing out of the views, header and locales
- **What:** Create branch `chore/remove-racing` from `main`. Delete the Racing and iRacing views: `src/views/racing-*.ejs` (account, admin, dashboard, landing, pitwall, pitwall-picker, signup, team-detail, teams), `tracks.ejs`, `iracing.ejs`, `iracing-overlay-settings.ejs`, `login.ejs` (unused Streamer/Racing chooser). In `public/overlay/iracing/` **keep the Twitch chat overlay**: `chat.js`, `chat.css` and whatever of `shared.css` (and any HTML/view the chat page uses) it needs — it reads the site's SSE (`/overlay/events/<token>`) and shows the moderated `type:'chat'` lines, with no desktop app. Delete the Bridge-dependent types (fuel, proximity, relative, standings, wind: their JS/CSS/HTML) and the parts of `shared.js` that connect to `ws://localhost:9100`; if the chat page loads `shared.js`, strip it to what chat needs or stop loading it, so the chat page never tries the Bridge socket. Comments in kept files call it "a Twitch chat overlay", not iRacing. Check the chat page's view/HTML before deleting anything it includes. In `src/views/header.ejs` remove the Racing sidebar menu (~629-655, `hideRacingNav`), the Racing notification bell/dropdown with its CSS (~174-202) and JS (~825-835), the Racing avatar/name blocks (~770-798), `.tab-iracing` CSS (~553), and make logout depend only on the streamer (~675). The header must still render when locals `racingUser`, `hideRacingNav`, `notifications`, `unreadNotifCount` are absent (use none of them; T2 stops passing them). Remove the iRacing tab from `guild-config.ejs` (~76-78, ~425-434), the `iracing_result` label in `dashboard.ejs` (~201), the iRacing messages/test card in `admin-dashboard.ejs` (~16, ~445), the `home.ejs` comment. Remove locale keys in all 7 files: `nav.racing`, `nav.trackDatabase`, `nav.teams`, `nav.racingAdmin`, `nav.notifications`, `nav.noNotifications`, `landing.racing`, `landing.racingTagline`, `landing.racing.feature1`…`6`, `dashboard.type.iracing_result`, `guild.iracingTitle`, `guild.iracingDesc` (keep `nav.account`, `landing.loginDiscord`; drop other `landing.*` keys only if no remaining view uses them). Update view tests: delete `tests/racingViews.test.js`; fix `tests/headerView.test.js` (team-invite blocks ~29-59; `racing-pitwall.ejs` icon-library expectation ~67), `tests/csrfClient.test.js` sample actions (~206, 227-228, 254: use non-Racing paths), `tests/streamerViewsI18n.test.js` (~178-180, 317) and `tests/i18nViewsPart1.test.js` (~323) racing locals, `src/csrf.test.js` view list expecting `tracks.ejs` (~352).
- **Files:** as listed; `src/locales/*.json`.
- **Agent:** frontend-dev
- **Model:** sonnet
- **Depends on:** none
- **Verify:** `node --test tests/headerView.test.js tests/csrfClient.test.js tests/i18n.test.js tests/localeKeys.test.js tests/streamerViewsI18n.test.js tests/i18nViewsPart1.test.js tests/scriptEmbeds.test.js` passes locally (non-DB); `grep -rniE "racingUser|hideRacingNav|/racing|/tracks|iracing" src/views public/js` returns nothing except the alert-look family and anything the kept chat overlay page needs (its path and asset URLs under `/overlay/iracing/`). Commit.
- **Decisions that apply:** Racing removed entirely; the "Racing" alert look stays; coaching views untouched; `/` names no Racing already.

### T2: Racing out of the server, routes and services
- **What:** On `chore/remove-racing`. Delete `src/routes/racing-auth.js`, `racing.js`, `racing-team.js`, `voice.js`, `src/services/voicePresence.js`, `voiceTracker.js`, `ibtParser.js`, `pitwallRelay.js`, `iracing.js`, `src/pollers/iracingResults.js`, `src/bridgeId.js` and their tests (`src/bridgeId.test.js`, `src/routes/voice.test.js`, `src/services/voicePresence.test.js`). In `src/server.js` remove: `isBridgeId` import, `authLimiter` (only `/racing/auth` used it) and `voiceLimiter`, the apiLimiter's `track-map` skip and Racing comments, the `/pitwall/overlays` static mount and its Cache-Control split, the session middleware's `req.racingUser` loading, cross-loading, `res.locals.racingUser`, Racing notifications (`notifications`/`unreadNotifCount`) — keep `req.streamer` and `req.viewer` loading exactly as is — the `/` route's `racingUser`/`hideRacingNav` locals, the racing router mounts and `/racing/team` redirect, all `/api/bridge/*` routes (config, account, Whisper, Spotify), `/api/voice`, payload sanitisers, track-map/track-stats/import-screenshot/import-csv/live-session/bridge-logs/bridge-ids/bridge-users/bridge-bug-reports/session routes, `STRICT_SESSION_OWNERSHIP`, `/tracks` pages, `pitwallRelay.init`. **Keep the `RETIRED_RACING_API` 410 middleware** as one rule (old installed apps get a clean 410); add one tiny rule: any `GET /racing`, `/racing/*`, `/tracks*` redirects to `/` (302). In `src/bodyParsers.js` keep only `/dashboard/report` in `LARGE_BODY_ROUTES`; in `src/csrf.js` remove every Racing `CSRF_EXEMPT` entry (keep multistream, `/sync/trigger`, tip) and Racing comments. In `src/routes/auth.js` remove only the Racing link block in `/login/callback` (~141-151); coaching branch and logout unchanged. In `src/routes/admin.js` remove `POST /admin/racing-reset-password` and the iRacing test route (~163-164, ~474-523). In `src/routes/dashboard.js` remove `'iracing'` from `GUILD_PAGE_TABS`, the `iracing_enabled` handling (~691), `/dashboard/iracing` and its overlay settings routes (~1782-1809). In `src/routes/overlay.js` keep `/overlay/iracing/:type/:token` (~542-581) only for type `chat` (same URL, so existing OBS sources keep working); any other type answers 404; reword its comments as "the Twitch chat overlay". In `src/discord.js` remove `buildIracingResultEmbed` (keep the `GuildVoiceStates` intent; leave intents unchanged). In `src/pollers/manager.js` remove the iRacing parts. In `src/config.js` remove the `email` block, `iracingResults` interval and the `iracing`/`maxIracingDrivers` tier flags. In `src/index.js` remove the bridge log/bug report cleanups. Rewrite `src/services/agentTriage.js` context to the streamer side (no `BRIDGE_DIR`, no `routes/racing.js` read; system prompt describes the Twitch/Discord streamer tools; keep model and limits). Fix comment-only mentions (`clientIp.js`, `streamerAccess.js`, `spotify.js`, `twitchChat.js`/`overlayPresence.js`/`public/overlay/overlay.js` "iRacing chat overlay" → "the Twitch chat overlay"). **Keep emitting the `type:'chat'` SSE lines** (the chat overlay at `/overlay/iracing/chat/<token>` uses them). Update `src/routes/overlay.test.js` (~137): `/overlay/iracing/chat/<valid token>` still answers 200, `/overlay/iracing/standings/<token>` answers 404. Remove deps used only by Racing with `npm uninstall bcryptjs nodemailer` (this edits package files only to drop these two; nothing else). Update mixed tests: `src/server.app.test.js` (delete the skipped Racing blocks, the sign-in log block, helpers; re-point rate-limit tests to non-Racing routes; keep the 410 block and add the `/racing`→`/` redirect check; keep language, recordings and coaching blocks), `src/csrf.test.js`, `src/bodyParsers.test.js`, `src/server.wiring.test.js`, `src/server.home.test.js` (drop Racing fixtures and "other pages keep Racing" block), `src/routes/dashboard.test.js` (racing-auth mount, iRacing routes/tabs, Racing logout), `src/routes/overlay.test.js` (~137), `src/routes/admin.test.js` (~128), `src/pollers/manager.test.js` (~111, 131), `src/errorHandler.test.js` (keep). Don't change `src/db.js` in this task except nothing (T3 owns it); leaving now-unused db functions is fine here.
- **Files:** as listed.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T1
- **Verify:** `node --check` on every `src/**/*.js`; `grep -rnE "require\(['\"].*(racing|voice|bridgeId|pitwallRelay|ibtParser|voiceTracker|iracing)" src` returns nothing; the suite passes in the scratch copy (Common rules); one clean boot answers `/health` 200, `GET /racing` 302 to `/`, `POST /api/session` 410, `GET /my-bookings` 200 or redirect (not 500). Commit.
- **Decisions that apply:** Keep one 410 rule plus one redirect rule only; keep Spotify `!song`/OAuth; viewer sign-in and `req.viewer` intact; remove deps only if nothing else requires them (`ws` stays).

### T3: Drop the Racing tables and db functions
- **What:** On `chore/remove-racing`. In `src/db.js`: remove the Racing `CREATE TABLE`/`ALTER`/index/normalisation blocks for `track_maps`, `track_stats`, `racing_sessions`, `session_laps`, `lap_telemetry`, `racing_users`, `password_reset_tokens`, `auth_log`, `teams`, `team_members`, `team_invites`, `notifications` (Racing; not `notification_log`), `bridge_logs`, `bridge_bug_reports`, `iracing_overlay_settings`, `watched_iracing_drivers`, `iracing_driver_state`, `iracing_race_cache`; and the `sessions.racing_user_id` rebuild (~1246-1264). Add one `_runOnce('drop_racing_tables', …)` that runs `DROP TABLE IF EXISTS` for all 18 (children before parents, foreign keys on) and `DELETE FROM sessions WHERE streamer_id IS NULL` (Racing-only web sessions). Leave the `sessions.racing_user_id` and `guilds.iracing_enabled` columns in place (no table rebuild) but stop reading/writing them; a fresh DB must not create `racing_user_id` — check `sessions`' CREATE and every INSERT still work on both a fresh and an old-shaped DB. Remove the Racing query functions and exports (bridge logs, recorded sessions, racing users, lockout, auth log, teams, searchRacingUsers, Racing notifications, iRacing driver functions, iRacing overlay settings), `_deleteOtherSessionsByRacingUser` and the `{racingUserId}` option, the `racing_users` lines in `_deleteStreamerAndData`, `iracing_overlay_settings` and `watched_iracing_drivers` from `STREAMER_OWNED_ROWS`/`WATCHER_TABLES`/`WATCHER_IDENTITY_COLUMN`, and the `iracing_result` notification stats. The migration must be silent on a fresh DB (no `[DB migration]` line) and on a second boot. Update tests: `src/db.accounts.test.js` (Racing user removal and linked-session blocks), `src/db.secrets.test.js` (Racing/linked session hashing ~369-455), `src/db.test.js` (~174 watcher map); add a test in `src/db.test.js` (stub pattern of `src/db.accounts.test.js`) that an old-shaped DB with the Racing tables and a Racing-only session row ends with none of the 18 tables and no such session after boot, and that a second boot logs no `[DB migration]`.
- **Files:** `src/db.js`, `src/db.test.js`, `src/db.accounts.test.js`, `src/db.secrets.test.js`.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T2
- **Verify:** `grep -nE "racing_|track_maps|track_stats|lap_telemetry|session_laps|bridge_logs|bridge_bug|auth_log|team_members|team_invites|iracing" src/db.js` only shows the drop migration; the suite passes in the scratch copy; two clean boots per Common rules. Commit.
- **Decisions that apply:** Drop the tables (no Racing user data, emails included, stays on the server); the drop must be silent on a fresh DB; backups name no tables and stay unchanged.

### T4: Delete the desktop app and its CI
- **What:** On `chore/remove-racing`. `git rm -r bridge/`, `.github/workflows/bridge-tests.yml`, `.github/workflows/build-bridge.yml`. In `.github/workflows/server-ci.yml` drop the `bridge/**` paths-ignore and `"bridge/test-*.js"` from the test command, and the comments about it. In `.dockerignore` remove `bridge/*`, `!bridge/overlays`, `!bridge/overlays/**`. Delete `tests/pitwall.spec.js`. In `.env.example` remove the "Email (Racing password reset)" block (`EMAIL_USER/PASS/FROM`), `OPENAI_API_KEY`, `STRICT_SESSION_OWNERSHIP`, `IRACING_*`. GitHub Releases are not touched.
- **Files:** as listed.
- **Agent:** general-purpose
- **Model:** sonnet
- **Depends on:** T3
- **Verify:** `test ! -e bridge && git grep -n "bridge/" -- .github .dockerignore` returns nothing; `npx --yes js-yaml .github/workflows/server-ci.yml >/dev/null` exits 0 (or a python yaml load). Commit.
- **Decisions that apply:** Delete `bridge/` from the repo; git history keeps it; Releases stay.

### T5: Part 1 docs
- **What:** On `chore/remove-racing`. Delete `bridge/CLAUDE.md` if still present, `docs/features/session-capture.md`, `team-pitwall.md`, `voice-chat.md`. In `CLAUDE.md` remove every Racing/Bridge/iRacing/Pitwall/Track Database/Whisper/Racing-auth section and mention (intro paragraph, Tech Stack auth line, Testing mentions of bridge/pitwall/racingViews, Commands, Project Structure entries, Key Architecture bullets, env vars `EMAIL_*`, `OPENAI_API_KEY`, `STRICT_SESSION_OWNERSHIP`, `IRACING_*`, Conventions entries on pitwall Cache-Control, `.dockerignore` bridge re-include, racing tables/routes/teams; Racing rate limit). Describe the chat overlay as a Twitch chat overlay (an OBS source at `/overlay/iracing/chat/<token>`, kept at that URL for existing sources; it shows the moderated chat lines from the SSE stream; other `/overlay/iracing/*` types are gone and answer 404; a URL rename is out of scope) in the OBS Overlay bullet and Project Structure. Describe what remains: the 410 rule for the old app paths and the `/racing*`/`/tracks*` → `/` redirect, and the `drop_racing_tables` migration. Add a release note to `docs/operations/deploy.md`: "Racing removed": take a manual backup (how, per `docs/operations/backup-restore.md`) before deploying, what the migration drops, how to check it (`sqlite3` `.tables`), that a rollback below this release cannot bring the data back except from that backup; remove Racing items elsewhere in deploy.md and `docs/operations/backup-restore.md`. Update `docs/features/i18n.md` if it mentions Racing views. Append a Team Activity Log entry.
- **Files:** `CLAUDE.md`, `docs/operations/*.md`, `docs/features/*.md`.
- **Agent:** general-purpose
- **Model:** sonnet
- **Depends on:** T4
- **Verify:** `grep -niE "racing|bridge|pitwall|iracing|whisper|track database" CLAUDE.md` shows only the alert-look family, the removal note and the 410/redirect rule. Commit.
- **Decisions that apply:** Note the manual backup before deploying the drop; Twitch-only project.

### T6: QA checkpoint for Part 1
- **What:** On `chore/remove-racing`: full suite in the scratch copy, two clean boots, and a smoke walk on the booted scratch server: `/` (no Racing anywhere), `/racing`, `/racing/teams`, `/tracks` → `/`; `/api/session`, `/api/bridge/config`, `/api/voice/123456789012345678` → 410; `/pitwall/overlays/x` → 404; `/overlay/iracing/chat/<seeded token>` → 200 and its page loads no script that opens `ws://localhost:9100` (check in a browser: no WebSocket attempt), while `/overlay/iracing/standings/<token>` → 404; `/my-bookings` and `/auth/coaching-signin` behave as before (redirect to Discord); header renders on `/my-bookings`, `/tip/<unknown>`. Fix only trivial breakage in files this part touched; otherwise report it as blocked. Append a Team Activity Log entry and commit.
- **Agent:** team-qa
- **Model:** sonnet
- **Depends on:** T5
- **Verify:** suite `fail 0`; two boots clean; every smoke check as listed.
- **Decisions that apply:** Coaching viewer sign-in must keep working.

### T7: Hide pricing behind `features.pricing`
- **What:** Create branch `fix/review-findings` from the tip of `chore/remove-racing`. Add `pricing: false` to `config.features` (`src/config.js` ~134-151, with a comment: the legacy paid flow comes back later). While false, `GET /pricing` (`src/server.js` ~299-306) and every `/payment` route (mount ~314; `routes/payment.js` GET `/`, POST `/create`, `/success`, `/cancel`, `/subscription`, `/subscription/cancel`) redirect to `/dashboard` (one small gate middleware before the mount; don't delete code). Fix the dead `/dashboard/subscription` redirects in `payment.js` (~92, ~183, ~220) to `/payment/subscription` (keeping the `?msg=`). Confirm no view links to `/pricing`/`/payment` outside `pricing.ejs`/`subscription.ejs`. Add tests (`src/server.app.test.js` or a new `src/routes/payment.test.js`): with the flag false, `/pricing` and `POST /payment/create` redirect and never call PayPal.
- **Files:** `src/config.js`, `src/server.js`, `src/routes/payment.js`, a test file.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T6
- **Verify:** suite passes in the scratch copy; `grep -rn "/pricing\|/payment" src/views public | grep -v "pricing.ejs\|subscription.ejs"` empty. Commit.
- **Decisions that apply:** Don't delete `routes/payment.js`, `pricing.ejs` or the tier table.

### T8: Remove StreamElements (server)
- **What:** On `fix/review-findings`. Delete `src/services/streamelements.js` and `src/services/streamelements.test.js`. Remove its boot/shutdown in `src/index.js` (~56, 60, 225; reword the ~22 warning), its steps in `src/services/accountLifecycle.js` (~28, 65, 92-94), and in `src/routes/dashboard.js` the `hasStreamElementsJwt` local (~896-902), the `streamElementsJwt`/`streamElementsChanged` params of `syncLiveConnections` (~935-959) and its callers (~963-979, ~1081, ~1627, ~1895). In `src/services/overlaySettings.js` remove `STREAMELEMENTS_JWT_MAX`, `decideStreamElementsJwt`, the form fields; `parseOverlaySettings` returns only columns (adjust callers). Add `_runOnce('clear_streamelements_tokens', …)` in `src/db.js` setting `streamelements_jwt = NULL`. Keep the column and keep it in `TOKEN_COLUMNS` and `OVERLAY_COLUMNS` (so `src/db.secrets.test.js` stays valid unchanged; note it in a comment as "kept only for the sealed-column checks; nothing reads it"). Keep `'streamelements'` in `DONATION_SOURCES` (~1390) so past rows still filter/export. Comments in `tipGoals.js`, `trackers.js`, `db.js`, `config.js`, `admin.js`. `npm uninstall socket.io-client` (nothing else requires it). Update tests: `managersDisabled.test.js`, `dashboard.test.js`, `admin.test.js`, `dashboard.tracking.test.js`, `sounds.test.js`, `overlay.test.js`, `overlay.tracking.test.js`, `accountLifecycle.test.js`, `overlaySettings.test.js`; keep `db.test.js` uses of source `'streamelements'` (history rows). Add a db test that the migration clears a stored token. The view and locales are T9.
- **Files:** as listed.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T7
- **Verify:** `grep -rn "streamelements\|socket.io-client" src --include=*.js | grep -v test` shows only the column/TOKEN_COLUMNS/OVERLAY_COLUMNS, the migration, `DONATION_SOURCES`; suite passes in the scratch copy (it will fail only on T9's view fields if the view test reads `hasStreamElementsJwt` — if so, do T9's view edit's test part there and say so). Commit.
- **Decisions that apply:** Past `source='streamelements'` donation rows stay and show in history; stored tokens cleared by `_runOnce`; column kept (simplest, passes `db.secrets.test.js`).

### T9: Remove StreamElements (views and texts)
- **What:** On `fix/review-findings`. Remove the StreamElements card from `src/views/overlay-config.ejs` (~602-627). Keep `streamelements: 'StreamElements'` in `donation-history.ejs` `_sourceLabels` (old rows). Remove keys `overlay.se.saved`, `overlay.se.replace`, `overlay.se.remove`, `overlay.seTitle`, `overlay.seToken`, `overlay.seHelp` from all 7 locales; reword `donations.goal.intro`, `donations.history.intro`, `donations.history.empty`, `overlay.enable`, `overlay.enableHint`, `overlay.alert.donationDesc` in all 7 so they name only PayPal tips (pt in pt-PT). Update `tests/streamerViewsI18n.test.js` (~47 brand list may keep the name, ~60 JWT placeholder allowance, ~195-196 `hasStreamElementsJwt`) and `tests/i18nViewsPart1.test.js` (~29).
- **Files:** as listed, `src/locales/*.json`.
- **Agent:** frontend-dev
- **Model:** sonnet
- **Depends on:** T8
- **Verify:** `node --test tests/i18n.test.js tests/localeKeys.test.js tests/streamerViewsI18n.test.js tests/i18nViewsPart1.test.js` passes; `grep -rn "StreamElements" src/locales/en.json` empty. Commit.
- **Decisions that apply:** pt-PT; donation history still labels old StreamElements rows.

### T10: Raid protection that survives a restart; weekly digest per streamer
- **What:** On `fix/review-findings`. (a) `src/services/chatModeration.js` `activateRaidProtection` (~561-584): before turning followers-only on, read the channel's current chat settings (Helix `GET /chat/settings`, 10 s deadline) and store `{streamer_id, ends_at, prev_follower_mode, prev_follower_mode_duration}` in a new table `raid_protection` (one row per streamer, in `src/db.js`, add to `STREAMER_OWNED_ROWS`). The end restores the previous setting (not a blind `follower_mode:false`) and deletes the row. At boot (`src/index.js`, after the chat bot starts) finish overdue rows and re-arm timers for future ones; on SIGTERM leave the rows (the next boot finishes them). A failed restore keeps the row and retries on the next minute tick (max 1 h, then log and drop). (b) `src/pollers/weeklyDigest.js`: one digest per streamer per server — key the in-memory `attempts` Map and `weekly_digest_state` by guild + streamer (new keyed state, migrate existing guild rows to the guild's `MIN(streamer_id)` silently), and replace `getGuildsWithWeeklyHighlights`' `MIN(streamer_id)` with one row per (guild, streamer) whose weekly highlights are on. Tests next to the modules (fake timers, stubbed Helix and db).
- **Files:** `src/services/chatModeration.js`, `src/pollers/weeklyDigest.js`, `src/db.js`, `src/index.js`, tests.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T9
- **Verify:** new tests pass; suite passes in the scratch copy; two clean boots (no `[DB migration]`). Commit.
- **Decisions that apply:** Weekly digest is one per streamer per server.

### T11: EventSub retries, shared token refresh, Twitch chat rejoin
- **What:** On `fix/review-findings`. (a) `src/services/eventsub.js` `subscribeAll` (~296-320): types that fail are retried on the same session with backoff (e.g. 30 s, 2 min, 10 min; stop when the session ends or the client is stopped; a 4xx that is not 429 or 401-after-refresh is not retried). (b) Route broadcaster refreshes through `refreshBroadcasterTokenShared` (`src/services/twitch.js` ~358) in `twitchRewards.js` (~43), `pollers/subSync.js` (~67), `eventsub.js` (~487) and `twitch.js` `getStreamKey` (~575, 585). (c) `src/services/twitchChat.js` (~214, ~275): one rejoin mechanism — on `connected` join only channels in `channelMap` that tmi is not already rejoining, and part channels tmi rejoins that are no longer in `channelMap`; `partChannel` while disconnected removes the channel from tmi's list so it isn't rejoined; respect Twitch's 20 JOINs/10 s (queue joins). Tests next to each module.
- **Files:** as listed, tests.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T10
- **Verify:** new tests pass; suite passes in the scratch copy. Commit.
- **Decisions that apply:** none beyond the brief items 4, 13, 14.

### T12: Redemptions and outbound deadlines
- **What:** On `fix/review-findings`. (a) `src/services/redemptionDispatcher.js` (~86-102): only for an `unfulfilled` redemption, call CANCELED first, then record `refunded_no_file`; on failure record `error`. (b) Auto-fulfil (~141-155): store the due time (new column on the redemption record or a small table in `db.js`), settle due ones at boot and on a minute tick, clear on settle. (c) Add `AbortSignal.timeout(10000)` to: `src/services/spotify.js` (3 calls), `twitch.js` `refreshBotToken`, `youtube.js` `deleteYoutubeChatMessage`/`banYoutubeChatUser`/`findActiveLiveStream`, `src/routes/auth.js` `/link` callback token exchange (~555) and the Helix `/users` after it (don't touch the coaching code paths otherwise), `src/routes/payment.js` PayPal calls (15 s, like `services/paypal.js`). Tests for (a) and (b).
- **Files:** as listed, `src/db.js`, tests.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T11
- **Verify:** `grep -n "fetch(" src/services/spotify.js src/services/youtube.js src/routes/payment.js` — every call has a `signal`; suite passes in the scratch copy; clean boots. Commit.
- **Decisions that apply:** none beyond items 8, 16.

### T13: Server-side gaps in the dashboard routes
- **What:** On `fix/review-findings`. In `src/routes/dashboard.js`: tip-goal form routes `/donations/goal` (~1468) and `/donations/goal/adjust` (~1498) clamp like the JSON route (`Math.min(…, 10000000)`); `/donations/goal/test` (~1479) uses the shared test cooldown (`testCooldown.js`); `/sponsors/:id/update` (~2511) and `PATCH /redemptions/:id` (~2827) cap text with `TEMPLATE_MAX` and clamp the cooldown to Twitch's bound; `POST /giveaways/:id/close` (~3064) closes only the giveaway with that id when it is open (else 404/409). In `src/services/dashboardSettings.js` (~139) the `watcher` writer answers `not_found` when no row was changed. Part 5: `POST /donations/history/:id/delete` subtracts the donation from the active tip goal when it counted (goal's currency or no currency, created at/after the goal started, goal still active; never below 0; broadcast the goal on `tipgoal:<id>` without `added`). `GET /dashboard/tracking` no longer switches the six trackers on: `db.ensureTrackerSettings` inserts them off (existing rows unchanged), so opening the page doesn't start EventSub. Tests in `src/routes/dashboard.test.js` / `dashboard.tracking.test.js`.
- **Files:** `src/routes/dashboard.js`, `src/services/dashboardSettings.js`, `src/services/tipGoals.js`, `src/db.js`, tests.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T12
- **Verify:** new tests pass; suite passes in the scratch copy. Commit.
- **Decisions that apply:** Refund delete subtracts from the active goal; trackers start off.

### T14: Overlay server paths: sponsor designs, SSE write-after-end, late tips
- **What:** On `fix/review-findings`. (a) `src/routes/overlay.js` sponsor stream (~176): forward `config-update` events that carry designs (not only `type==='sponsor'`). (b) SSE write-after-end (~25 `endStreamWhenAccountDisabled`, `src/httpDrain.js` drain): every SSE `send` checks `res.writableEnded`/`res.destroyed` and the end path detaches bus listeners before `res.end()`. (c) Daily tip reconcile (`src/routes/tip.js` ~248 `countTip`, `src/services/trackers.js` ~126): a recovered tip only becomes "latest tip" when newer than the stored one, and the goal broadcast for a recovered tip has no `added` (no late animation). Tests next to each module.
- **Files:** `src/routes/overlay.js`, `src/httpDrain.js`, `src/routes/tip.js`, `src/services/tipCapture.js`, `src/services/trackers.js`, `src/services/tipGoals.js`, tests.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T13
- **Verify:** new tests pass; suite passes in the scratch copy. Commit.
- **Decisions that apply:** none beyond items 9 (server half), 11, 12.

### T15: Chat behaviour and PayPal payee
- **What:** On `fix/review-findings`. (a) First-time chatter (`src/services/twitchChat.js` ~75-76, `chatModeration.js` ~226-266): no longer posted in chat; written to the mod log (`moderation_log`) and the Discord mod log where set. (b) YouTube: moderators and the channel owner are exempt from the chat filters like on Twitch, banned words still apply to everyone (`src/services/youtubeModeration.js`); add the 60 s `.unref()` sweeper `chatModeration.js` uses for its Maps (`permits`, `lastMessages`, `offenseCounts`, `authorCache`); `src/services/youtubeLiveChat.js` `pollChat` (~217-257): after each await check `activePollers.get(id) === poller` (generation) before re-arming. (c) PayPal (`src/routes/tip.js` ~140-145, `src/db.js` `pending_tips` + `createPendingTip`, `src/services/tipCapture.js` `payeeMatches` ~64-68): store `payee_email` (and merchant id when known) on the pending tip when the order is created (silent `ALTER` migration), and check the capture against the stored values; fall back to the current email only for older rows without it. Tests next to each module.
- **Files:** as listed, tests.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T14
- **Verify:** new tests pass; suite passes in the scratch copy; clean boots. Commit.
- **Decisions that apply:** First-time chatter to mod log; YouTube mod/owner exemption; payee stored at order time.

### T16: Security hygiene: sync, issue screenshots, escaping
- **What:** On `fix/review-findings`. (a) `src/routes/sync.js`: compare the secret with `crypto.timingSafeEqual` (equal-length buffers; unset secret never matches), and give each `/sync/backup` call its own temp file (`data/bot.db.backup-<random>`), removed after the response. (b) Issue screenshots: stop serving `data/issues` with public `express.static` (`src/server.js` ~156-169); serve them through a route that allows only an admin (`db.isAdmin`) or the streamer who reported the issue, with `userContentHeaders.js`; new screenshots get random names (`crypto.randomBytes(16).toString('hex')`); update the admin view links (`admin-dashboard.ejs` ~202) and the save code (`src/routes/dashboard.js` ~2381-2414). (c) `public/overlay/overlay.js` `buildBannerContent` (~782-830): wrap `amount`, `currency`, `viewers`, `months`, `tier` in `esc()`. Tests for (a) and (b).
- **Files:** as listed, tests.
- **Agent:** team-security
- **Model:** sonnet
- **Depends on:** T15
- **Verify:** new tests pass; suite passes in the scratch copy; an unauthenticated `GET` of a screenshot path answers 403/404. Commit.
- **Decisions that apply:** none beyond item 19 and 18b.

### T17: Overlay client fixes, card Test buttons, coaching tab flash
- **What:** On `fix/review-findings`. In `public/overlay/overlay.js`: `playRedemption` calls `stopRedemption(true)` from the media `onerror` and on the `play()` rejection; Clear All stops a look's playing recording (`objects/kit.js` ~333 `recorded`) and cancels the synthesized sounds scheduled with `setTimeout` (`soundEffects` ~396); when the page URL has `?preview=1` it opens its stream without `source=alerts`. `src/views/overlay-config.ejs`: the Preview iframe adds `preview=1`. `public/overlay/sponsors.js`: apply design `config-update`s (T14 forwards them). OBS sources `overlay.js`, `sponsors.js`, `goal.js`, `poll.js`, `tracking.js`: on a stream error, check the URL once (`fetch`); on 404 stop retrying (or back off to 5 minutes), else keep the 5 s retry. `public/js/dashboard-cards.js` (~662-671): the alert Test buttons send `{ chat: false }`. Coaching tab flash (`src/views/coaching-dashboard.ejs`): move the `.cd-panel{display:none}` and active-tab rules into a `<style>` in the head/above the panels, next to the `data-coaching-tab` script, so only the remembered tab is ever drawn; change nothing else in coaching. Keep the overlay settings page's Preview chat line as documented. Follow the Overlay Consistency Rule (builder preview unaffected). Check the coaching page in a browser (Playwright MCP or headless Chromium) with the scripts delayed: only one panel visible at any time; screenshot to the scratchpad.
- **Files:** as listed.
- **Agent:** frontend-dev
- **Model:** sonnet
- **Depends on:** T16
- **Verify:** `node --test tests/overlayClient.test.js tests/trackingClient.test.js tests/pollBar.test.js tests/dashboardCardsCore.test.js tests/scriptEmbeds.test.js` passes; suite passes in the scratch copy; the coaching flash check as described. Commit.
- **Decisions that apply:** Card Test buttons are OBS-only (`chat:false`); overlay settings Preview keeps its chat line; coaching: only item 20.

### T18: Docs, CLAUDE.md and the plan copy
- **What:** On `fix/review-findings`. Update `CLAUDE.md`: remove StreamElements everywhere (Tech Stack APIs, EventSub/overlay/tip goal/donation history/trackers/admin mentions, `socket.io` mention), add `features.pricing` to the Feature Flags bullet, and describe the new behaviours (raid protection persisted and restored; EventSub retries; weekly digest per streamer per server; trackers start off; refund delete subtracts from the goal; first-time chatter to mod log; YouTube mod exemption; payee stored on the pending tip; card Test buttons OBS-only while the overlay settings Preview posts its chat line; issue screenshots behind an owner/admin route; OBS sources stop on 404; preview iframe not counted as open). Update `docs/operations/deploy.md` with a release note for PR B (migrations: StreamElements tokens cleared, `raid_protection` table, digest state, redemption due times, `pending_tips.payee_email`; checks after deploy), `docs/features/tracking.md`, `tip-tts.md` (preview not counted), `channel-point-rewards.md`, `i18n.md`, `docs/security-todo.md` (close the socket.io-client item), `.env.example` (StreamElements mentions). Copy `plan.md` from the run folder to `docs/superpowers/plans/2026-11-16-remove-racing-and-review-fixes.md`. Append a Team Activity Log entry (archive older entries per the log's rule if past ~10).
- **Files:** as listed.
- **Agent:** general-purpose
- **Model:** sonnet
- **Depends on:** T17
- **Verify:** `grep -ni streamelements CLAUDE.md` shows only the "past rows stay in history" note; the plan copy exists. Commit.
- **Decisions that apply:** Docs say which way the overlay settings Preview went (keeps its chat line).

### T19: Final QA
- **What:** On `fix/review-findings`: full suite in the scratch copy, two clean boots, then a smoke walk on the booted scratch server (seed a streamer; Discord, Twitch, PayPal stubbed as earlier QA runs did): dashboard loads; overlay settings has no StreamElements card and its Preview iframe URL has `preview=1`; a card Test sends `chat:false`; `/dashboard/tracking` opening leaves trackers off; `/pricing`, `/payment` redirect; `/racing` → `/`; `/api/session` 410; donation history shows a `streamelements` row; `/dashboard/coaching` with a remembered tab shows no other panel while loading (slowed scripts), at 1280 and 375 px; `/my-bookings` loads. Fix only trivial breakage; otherwise report blocked. Append a Team Activity Log entry and commit.
- **Agent:** team-qa
- **Model:** sonnet
- **Depends on:** T1–T18
- **Verify:** suite `fail 0`; boots clean; every smoke check passes.
- **Decisions that apply:** all of the brief's Part 5 decisions.
