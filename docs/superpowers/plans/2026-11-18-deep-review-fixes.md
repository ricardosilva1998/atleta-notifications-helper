# Plan: Deep review fixes

Brief: `brief.md` (item numbers A1…G36 below refer to it; every worker reads its items there, with the `file:line` hints, which are from 622c6ca: re-read before changing).

Choosing agents: use the team agent whose lane fits (`frontend-dev`, `backend-dev`, `team-security`, `team-qa`, `team-ux`). `general-purpose` for docs, locales, CI and deletions.

Every worker runs on `sonnet`. Tasks run one at a time. No task pushes or deploys: the ship session does that after review.

## Rules for every task

- **Branches (three stacked PRs).** `fix/deep-review-money` (T1–T9) is made from `main`; `fix/deep-review-robustness` (T10–T19) from the tip of the money branch; `chore/deep-review-language-cleanup` (T20–T25) from the tip of the robustness branch. Each task first runs `git checkout <its branch>` (the first task of a branch creates it with `git checkout -b`). Commit on that branch when the task is done (`git add` only the files you changed, never untracked files you did not create; message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Never push, never force, never `reset --hard`, `branch -D` or rebase. A later fix to an earlier branch is carried forward by `git merge` (never rebase).
- **Tests (scratch recipe).** Local Node is 26, the project's is 24, and `better-sqlite3` is built for 24. Never change `package.json`/`package-lock.json` or run `npm rebuild` in the repo. To run tests: copy the repo to the scratchpad (`rsync -a --exclude node_modules --exclude .git --exclude data ./ <scratch>/copy/`), there `npm ci && npm rebuild better-sqlite3`, then `node --test …`. Tests never touch the network, production or `data/`, and must not depend on the time of day (fix the clock with stubs).
- **Texts.** Every new user-facing text is a `t()` key added to all seven locales (`node scripts/locale-keys.js`); English is the source language; **Portuguese is always European Portuguese (pt-PT)**: "ecrã", "utilizador", "ficheiro", "carregar em", "prémio", "registo", "contacto", "a + infinitivo" (never a gerund like "está ouvindo"), no "você". `tests/i18n.test.js` must pass.
- Follow `CLAUDE.md` conventions (CommonJS, all SQL in `src/db.js`, `AbortSignal.timeout` on every fetch, unref'd sweepers, `_runOnce` for one-time data changes, Overlay Consistency Rule).
- Append one Team Activity Log entry to `CLAUDE.md` per task (format in that file).

## Shipping
- **Ship:** yes. The brief asks for it; the project deploys on a push/merge to `main`.
- **Where:** three PRs against `main`, opened by the ship session in order: `fix/deep-review-money`, then `fix/deep-review-robustness`, then `chore/deep-review-language-cleanup` (each stacked on the one before; merge in that order). CI (`Server CI`) must be green on each. **The owner merges** each one from the main pane with `! gh pr merge <n> --admin --merge` (panes may not run `--admin`). Railway (this folder is linked) deploys each merge.
- **Checks before push:** T9, T19 and T25 (full unit suite on a scratch copy, two clean boots with `DISCORD_DISABLED=1`: `/health` 200, no `[DB migration]` line, exit 0 on SIGTERM). There is no pre-push hook.
- **Verify live (after each merge):** Railway deployment SUCCESS; `https://atletanotifications.com/health` 200; `railway logs` show no `[DB migration]` and no `LOGIN REFUSED`; `/coaching/ricardobsilva98`, `/my-bookings`, `/dashboard` and an OBS overlay page load. After PR 1: `coaching_payments` has no rows deleted by the new code paths (log lines only). After PR 2: an OBS chat overlay recovers after the deploy's restart.

## Tasks

### T1: Coaching — a PENDING capture is kept, never lost (A1)
- **What:** In `coachingPayments.js`, a payment whose capture or read-back is PENDING gets a stored `pending` state (new column on `coaching_payments` via a migration in `db.js`, each column its own `PRAGMA table_info` check) with a next-read time; the tick reads it back hourly for the first 24 h, then daily, up to 30 days after capture. `expireDue` and `reconcileStale` never delete a payment whose last read was PENDING (`db.deleteOpenCoachingPayment` must refuse such rows). While pending, the booking keeps its time until 15 min before its start and its view (for viewer and coach) is a new status "payment processing" (not "expired"/"unpaid"); at start − 15 min still pending → the booking ends as unpaid but the payment row stays pending. A pending payment that later completes is recorded as a late capture (Refund pending, coach and viewer DMed, as late captures already are). VOIDED/DECLINED/refused → payment closed with a log line (order id, status). Expose the new status in the JSON the pages read (`forViewer` views and the coach's card/list data), with its texts in all seven locales (pt-PT).
- **Files:** `src/services/coachingPayments.js`, `src/services/coachingTick.js`, `src/services/coachingBookings.js` (views only), `src/db.js`, `src/services/coaching.js` (states), `src/locales/*.json`, tests next to each (`coachingPayments.test.js` etc.).
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** none (creates branch `fix/deep-review-money` from `main`)
- **Verify:** scratch recipe, `node --test "src/**/*coaching*.test.js" src/db.test.js tests/i18n.test.js` all pass; new tests cover: PENDING kept past `pay_by` and past 72 h, back-off schedule, still pending at start − 15 min (booking unpaid, row kept), later COMPLETED → late + Refund pending, VOIDED → closed.
- **Decisions that apply:** never delete a payment whose last read was PENDING; back-off hourly day 1, then daily to 30 days; booking held until start − 15 min; later completion is always recorded as late, never silently; no Atleta refunds.

### T2: Coaching — capture approved orders on read-back (A2)
- **What:** In the read-back paths (`startPayment` when it reuses an open order, and the minute tick's stale-order read), an order PayPal reports APPROVED is captured while the booking may still take payment (`mayCapture`), with the same verification as the return route (stored order of this streamer and booking, payee, amount, currency, COMPLETED). A capture that answers PENDING follows T1. One capture attempt at a time per order (no double capture with a concurrent return).
- **Files:** `src/services/coachingPayments.js`, `src/services/paypal.js` (read only unless a helper is missing), `src/services/coachingPayments.test.js`.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T1
- **Verify:** scratch recipe, `node --test "src/**/*coaching*.test.js"` pass; tests: APPROVED + mayCapture → captured and confirmed; APPROVED + not mayCapture → not captured; concurrent return and tick → one capture.
- **Decisions that apply:** capture only while `mayCapture`; same checks as the return.

### T3: Coaching — duplicate payment and late capture after start (A3, A4)
- **What:** (A3) A second capture for a booking keeps `double` on its **payment row** only, never `payment_issue='double'` on a booking that stands confirmed; `outcomeOf` decides from the booking's own `paypal_order_id`; refunding the duplicate DMs the viewer a new "duplicate payment refunded" text (the session stands) instead of "<coach> refunded your coaching session", and the pages' refund line says the same. (A4) In `_recordCoachingPayment`'s awaiting_payment branch, when `starts_at <= now` the capture is recorded as late (Refund pending), never confirming the booking. New texts in all seven locales (pt-PT).
- **Files:** `src/db.js` (~5100-5110), `src/services/coachingPayments.js` (~251), `src/services/coachingBookings.js` (~328, `outcomeOf`), `src/services/coachingMessages.js`, `src/locales/*.json`, their tests.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T2
- **Verify:** scratch recipe, `node --test "src/**/*coaching*.test.js" src/db.test.js tests/i18n.test.js` pass; tests for: double capture leaves the booking confirmed and clean; duplicate refund DM text; capture with `starts_at` in the past → late + Refund pending, status not confirmed.
- **Decisions that apply:** `double` lives on the payment; the valid order is the booking's `paypal_order_id`.

### T4: Tips — limiter, full reconcile, recovered time, refund on trackers (A5, A6, A7)
- **What:** (A5) `POST /tip/:username/create` gets a limiter like `coachingPayLimiter` (15 per 10 min per visitor, keyed `byVisitor`); the daily reconcile in `src/index.js` reads every unfinished `pending_tips` row in pages of 500 (oldest first) until done, before the 24 h cleanup runs; a COMPLETED capture that `tipCapture.js` refuses (~226 `if (!verdict.ok) continue;`) is logged with order id and reason (no donor data). (A6) A reconciled tip is stored with `created_at = pending.created_at`, and does not count toward a tip goal that started after it was paid. (A7) Deleting a donation as a refund (`routes/dashboard.js` ~1438-1455) re-broadcasts Top tipper and, when it was the latest tip, recomputes/clears Latest tip (`services/trackers.js`).
- **Files:** `src/routes/tip.js`, `src/server.js` (limiter), `src/index.js`, `src/db.js` (`getUnfinishedPendingTips`, `logDonation`), `src/services/tipCapture.js`, `src/services/tipGoals.js`, `src/services/trackers.js`, `src/routes/dashboard.js`, tests (`src/server.app.test.js` for the limiter, `tipCapture`/`trackers` tests).
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T3
- **Verify:** scratch recipe, `node --test "src/**/*.test.js"` passes; new tests: 16th create in 10 min → 429; reconcile over 1,200 rows reads all; refused COMPLETED logs order id; recovered tip keeps `created_at` and skips a later goal; refund deletes from Top tipper / Latest tip.
- **Decisions that apply:** limiter 15 per 10 min per visitor; reconcile fully before cleanup.

### T5: Coaching rooms — failed, orphaned and racing rooms (C11, C12, C13)
- **What:** (C11) `listDueCoachingRooms` also returns `failed` rows holding a `role_id`/`channel_id` once `close_at` passed; they are cleaned with no transcript and marked closed. (C12) When Discord answers that the guild is gone (Unknown Guild / bot not in it — not merely Discord down or not ready), the room row is marked closed (orphaned, with a log line) so it never blocks the `LIMIT 100` batch; Retry room answers a new `server_gone` code (text in seven locales, pt-PT) instead of `discord_down`. (C13) `build` re-reads the booking status before marking the room open and sending the "room ready" DM, and cleans up what it made when the booking was cancelled meanwhile; `finishOrCleanMaking` treats `rescheduling` like `confirmed`.
- **Files:** `src/services/coachingRooms.js`, `src/discord.js` (only if a helper to tell "guild gone" from "down" is missing), `src/db.js`, `src/routes/coachingDashboard.js` (Retry code), `src/locales/*.json`, tests.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T4
- **Verify:** scratch recipe, `node --test "src/**/*coaching*.test.js" tests/i18n.test.js` pass; tests for each of the three cases.
- **Decisions that apply:** "guild gone" must be distinguished from Discord down; a down Discord keeps retrying as today.

### T6: Coaching — bookings follow their coach; lapse texts (C14, C15)
- **What:** (C14) The per-booking viewer routes (`/coaching/:username/bookings/:id/...`, pay, `/paid`, starts, propose, accept-proposal, cancel/withdraw) and `/my-bookings/state` resolve the booking's coach by the booking's own `streamer_id`, not by the login in the URL, so a coach whose Twitch login moved to another streamer keeps working for existing bookings (a booking id that is not the signed-in viewer's still answers 404). (C15) `proposalLapsed`/`viewerLapsed` get separate texts for "48 h unanswered" and "dropped: within the hour of its time" (seven locales, pt-PT).
- **Files:** `src/routes/coaching.js`, `src/routes/myBookings.js`, `src/services/coachingBookings.js`, `src/services/coachingMessages.js`, `src/locales/*.json`, tests (`src/routes/coaching.test.js`, `myBookings` tests).
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T5
- **Verify:** scratch recipe, `node --test "src/**/*.test.js" tests/i18n.test.js` pass; a test where the coach's login now belongs to another streamer: My bookings lists the booking and Pay/Withdraw work.
- **Decisions that apply:** authorization stays by the viewer's Discord id; never widen access.

### T7: Coaching pages — show the new states (A1, A3, C12 display)
- **What:** `public/js/my-bookings.js`, the coach's coaching page and the Coaching card show "payment processing" for a pending payment (no Pay button), the duplicate-refund line, and the `server_gone` Retry answer, using the texts T1/T3/T5 added (via the pages' existing text objects `MYBOOKINGS_TEXTS`, `COACHING_DASHBOARD_TEXTS`, card texts). No layout change beyond that; check 360 and 1280 px for no horizontal scroll.
- **Files:** `public/js/my-bookings.js`, `public/js/coaching-dashboard.js`, `public/js/dashboard-coaching.js`, `src/views/my-bookings.ejs`, `src/views/coaching-dashboard.ejs` (text tables only), related tests in `tests/`.
- **Agent:** frontend-dev
- **Model:** sonnet
- **Depends on:** T6
- **Verify:** scratch recipe, `node --test "tests/**/*.test.js" src/routes/dashboard.test.js` pass (the text-table check included).
- **Decisions that apply:** texts only through the pages' JSON text objects; no innerHTML.

### T8: Docs for the money branch + plan copy (C16)
- **What:** Update `docs/features/coaching.md` (~558 PENDING, ~574-575, ~630-640) to match T1–T6; `CLAUDE.md` Coaching and Donations/Tip Goals bullets for the new behaviour (pending payments, approved-order capture, duplicate payment, tip limiter, full reconcile, refund on trackers); a release note in `docs/operations/deploy.md` (new column, what to check live); commit a copy of this plan as `docs/superpowers/plans/2026-11-18-deep-review-fixes.md`.
- **Files:** `docs/features/coaching.md`, `CLAUDE.md`, `docs/operations/deploy.md`, `docs/superpowers/plans/2026-11-18-deep-review-fixes.md`.
- **Agent:** general-purpose
- **Model:** sonnet
- **Depends on:** T7
- **Verify:** `git grep -n "PENDING" docs/features/coaching.md` shows the new text; docs describe only code that exists on the branch.
- **Decisions that apply:** English; describe behaviour, not history.

### T9: QA of the money branch
- **What:** On `fix/deep-review-money`: the full unit suite and two clean boots on a scratch copy; review that every A and C item has a test.
- **Files:** none in the repo (scratch only)
- **Agent:** team-qa
- **Model:** sonnet
- **Depends on:** T1–T8
- **Verify:** scratch recipe, `node --test "src/**/*.test.js" "tests/**/*.test.js"` 0 fail; two boots with `DISCORD_DISABLED=1 TWITCH_CLIENT_ID=x TWITCH_CLIENT_SECRET=x node src/index.js` on empty `data/`: `/health` 200, no `[DB migration]` line, exit 0 on SIGTERM.
- **Decisions that apply:** report failures, don't paper over them.

### T10: Pollers — digest, milestones, clips (B8, B9, B10)
- **What:** (B8) `_getDigestChannelForGuild` filters `wc.streamer_id = ? AND wc.enabled = 1` and `weeklyDigest.js` passes the streamer. (B9) `findBroadcasterToken`/`checkMilestones` and the recap's follower counts prefer the streamer whose `twitch_user_id` is the broadcaster and get the token through `refreshBroadcasterTokenShared`. (B10) `twitchClips.js`: the first look at a channel records the newest clip as the baseline and posts nothing.
- **Files:** `src/db.js`, `src/pollers/weeklyDigest.js`, `src/pollers/manager.js`, `src/pollers/twitchClips.js`, `src/services/twitch.js` (read), tests next to them.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T9 (creates `fix/deep-review-robustness` from the tip of `fix/deep-review-money`)
- **Verify:** scratch recipe, `node --test "src/pollers/*.test.js" src/db.test.js` pass; one new test per item.
- **Decisions that apply:** baseline-first like milestones.

### T11: One shared SSE client for the OBS sources (D17)
- **What:** New `public/overlay/sse.js` (dual-exported, tested in `tests/sseClient.test.js`): opens the stream, on error checks the URL once (404 → retry in 5 min, else the existing `retryDelay` back-off), reopens itself (never relies on EventSource's own reconnect, which stops on a non-200), and reloads the page when the `serverVersion` it gets changes. Used by all six sources: `overlay.js`, `goal.js`, `poll.js`, `sponsors.js`, `tracking.js`, `iracing/chat.js` (each page loads it; keep `?source=alerts` and `?preview=1` behaviour). In `chat.js` validate the user colour with `/^#[0-9a-f]{6}$/i` like `tracking.js`'s `colorOr`. Server side only if a route must serve the new file or send `serverVersion` to a source that lacks it.
- **Files:** `public/overlay/sse.js` (new), the six source scripts, the views/HTML that load them (`src/routes/overlay.js` page builders or views), `tests/sseClient.test.js`, existing overlay tests.
- **Agent:** frontend-dev
- **Model:** sonnet
- **Depends on:** T10
- **Verify:** scratch recipe, `node --test "tests/**/*.test.js" "src/routes/overlay*.test.js"` pass; tests: a 502 then 200 reconnects; 404 waits 5 min; changed `serverVersion` reloads.
- **Decisions that apply:** one client for all six; existing back-off and 404 rule kept.

### T12: Alert queue and builder preview survive a throwing look (D18, D19)
- **What:** (D18) `overlay.js` `playNext`/`showNotification` and the dismiss callback are guarded so any throw removes the slot and moves on (`alertTimer(playNext, 500)`). (D19) One guarded draw helper shared by the overlay's `drawAlert` and the builder preview (`public/js/builder-cards.js` ~97-110): a look that throws falls back to the alert's own object or card in both (Overlay Consistency Rule; `tests/overlayBuilder.test.js` keeps passing).
- **Files:** `public/overlay/overlay.js`, `public/js/builder-cards.js`, `public/overlay/objects/kit.js` (if the helper lives there), `tests/overlayClient.test.js`, `tests/builderCards.test.js`.
- **Agent:** frontend-dev
- **Model:** sonnet
- **Depends on:** T11
- **Verify:** scratch recipe, `node --test "tests/**/*.test.js"` pass; tests: a throwing alert is followed by the next one; a throwing look in the builder shows the fallback.
- **Decisions that apply:** builder and overlay share the same helper.

### T13: Raid protection and redemptions (D20, D21)
- **What:** (D20) When `readFollowerSettings` fails, store "unknown" and at the end leave the chat settings alone (never force follower mode off); restore through the stored `channel_login` even when the Twitch link was removed; a new raid while a restore runs waits for it (or re-applies follower mode after it). (D21) `channel_point_redemptions` rows left `pending` by a restart are settled at boot after N minutes (refund through `refundRedemption()`, or mark); the missing-media path (~95) uses `refundRedemption()` so an affiliate-gated answer is not recorded as refunded.
- **Files:** `src/services/chatModeration.js`, `src/services/redemptionDispatcher.js`, `src/db.js`, `src/index.js` (boot), tests next to them.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T12
- **Verify:** scratch recipe, `node --test "src/services/chatModeration*.test.js" "src/services/redemption*.test.js" src/db.test.js` pass; one test per sub-item.
- **Decisions that apply:** unknown previous settings are never overwritten.

### T14: Chat bots — YouTube re-check, bot token refused, flag batching, async catches (D22–D25)
- **What:** (D22) `youtubeLiveChat.js` re-checks `yt_chatbot_enabled` and account status each poll; the YouTube chatbot save route stops the poller when switched off. (D23) When Twitch refuses `BOT_TWITCH_TOKEN` (login failed/auth), log loudly once and expose it (`twitchChat.js` status → `dashboardCards.js` chatbot card status line with a new text in seven locales, pt-PT) instead of a silent "disconnected". (D24) First-time-chatter Discord mod-log embeds are capped/batched per streamer (e.g. at most one embed per minute listing the names, so a raid cannot flood). (D25) Scoped `.catch` on `youtubeLiveChat.js` ~250 (`handleChatMessage`, missing `superChatDetails`), `twitchChat.js` ~239, `commands.js` ~27-55 (`interaction.reply` on an expired interaction).
- **Files:** `src/services/youtubeLiveChat.js`, `src/services/twitchChat.js`, `src/services/chatModeration.js`, `src/services/dashboardCards.js`, `src/routes/dashboard.js` (YouTube chatbot save), `src/commands.js`, `src/views/cards/chatbot.ejs` (status line only), `src/locales/*.json`, tests.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T13
- **Verify:** scratch recipe, `node --test "src/**/*.test.js" tests/i18n.test.js` pass; tests for D22, D23 (card shows the refused state), D24 (100 first-timers → bounded embeds).
- **Decisions that apply:** never post in chat for a flag; texts in seven locales.

### T15: Dashboard and server input rules (E26–E29)
- **What:** (E26) `POST /dashboard/chatbot/commands` enforces `COMMANDS_PER_STREAMER_MAX` and the `chatCommands.js` rules; `POST /dashboard/chatbot` checks `chat_*_template` with the same parsers `dashboardSettings.js` uses (an array or bad value → 400/kept, never 500). (E27) One shared flag gate for JSON routes answering 404 JSON: `/api/vtuber/*` while `features.vtuber` is false; `/api/tracking/*` and `/donations/tts/test` while `features.overlays` is false. (E28) Cap sponsor messages at 50 and rewards at Twitch's limit (50 custom rewards); sponsor `url` http(s) only, ≤ 200 chars; `/sponsors/reorder` and `/redemptions/reorder` validate `ids` (400, not 500); the builder save writes the look and the design in one transaction. (E29) `(req.body || {})` in `/set-language` (`server.js` ~300) and `admin.js` (~119, 155, 455); `db.cleanupOldOverlayEvents()` in `index.js` wrapped in `try` like its neighbours. Refusal texts in seven locales (pt-PT).
- **Files:** `src/routes/dashboard.js`, `src/services/dashboardSettings.js`, `src/services/chatCommands.js`, `src/routes/admin.js`, `src/server.js`, `src/index.js`, `src/db.js`, `src/locales/*.json`, tests (`src/routes/dashboard.test.js`, `src/server.app.test.js`).
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T14
- **Verify:** scratch recipe, `node --test "src/**/*.test.js" tests/i18n.test.js` pass; a test per sub-item (101st command refused; array template → no 500; `/api/vtuber/x` 404 with vtuber off; 51st sponsor message refused; bad reorder ids 400; POST without body 4xx not 500).
- **Decisions that apply:** one source of rules: legacy routes reuse the card parsers.

### T16: Migrations hardening and the migration CI test (E30, CI part of G36)
- **What:** Rewrite the PR #21 hotfix (`db.js` ~3360-3375) so each column has its own `PRAGMA table_info` check and failures go to `_migrationLog`; replace the silent `catch {}` of migration blocks with `_migrationLog`; move every-boot data fixes (`design_version` backfill ~4021, the forced `sponsor_interval_seconds` ALTER) into `_runOnce` (silent on a fresh DB). Add `tests/migrations.test.js` (or `src/db.migrations.test.js`): build a database from the **oldest schema in history** — a committed fixture `tests/fixtures/schema-oldest.sql` made from the earliest `src/db.js` in git history (`git log --reverse -- src/db.js`, run it against an in-memory DB with stubs and dump `sqlite_master`; schema only, never rows) — boot today's `db.js` over it, and compare `PRAGMA table_info` per table with a fresh database (known, documented exception: `sessions`, which is not rebuilt). In `.github/workflows/server-ci.yml` add `node --check` over `public/**/*.js` next to the `src` syntax check (keep action SHAs pinned).
- **Files:** `src/db.js`, `tests/fixtures/schema-oldest.sql` (new), the new test, `.github/workflows/server-ci.yml`.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T15
- **Verify:** scratch recipe, `node --test src/db.test.js <new test>` pass; temporarily removing one column's ALTER makes the new test fail (then restore); two boots on empty `data/` print no `[DB migration]`; `find public -name '*.js' -print0 | xargs -0 -n1 node --check` passes.
- **Decisions that apply:** do NOT rebuild `sessions` (production's has nullable `streamer_id` and `racing_user_id`; record it in docs); `_runOnce` for one-time data fixes.

### T17: Dev sync hardening (E31)
- **What:** `src/services/sync.js` (development only): exit non-zero after a sync so Railway's ON_FAILURE restart brings dev back; exit in the `catch` once the DB is closed; `/sync/status` via a getter; `AbortSignal.timeout` on the fetch; an in-flight guard. `src/routes/sync.js` (production side): the snapshot it serves is scrubbed of personal data on the copy before sending (coaching payer names/emails, PayPal emails, viewer Discord ids where not needed, overlay/multistream tokens set to fresh random values), never touching the live DB.
- **Files:** `src/services/sync.js`, `src/routes/sync.js`, `src/db.js` (if a scrub helper on a backup file belongs there), tests (`src/routes/sync.test.js` or new).
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T16
- **Verify:** scratch recipe, `node --test "src/**/*sync*.test.js"` pass; a test that the served file has no payer email / PayPal email / original overlay token, and the source DB is unchanged.
- **Decisions that apply:** production behaviour of the live site unchanged; scrub only the copy.

### T18: Docs for the robustness branch (G36 docs)
- **What:** `CLAUDE.md`: remove the remaining StreamElements text (OBS Overlay, Disable, Boot and shutdown, Tip Goals bullets) except the donation-history note; add MessageContent to the Discord intents line if missing; add the `trackingGoals`, `coachingTick` and `trackers` ticks to Boot and shutdown; describe the shared SSE client (`public/overlay/sse.js`), the migration test and its fixture, the `public/**/*.js` syntax check in CI, and T10–T17 behaviour where bullets cover it. `docs/operations/deploy.md` release note (incl. "sessions differs from a fresh schema; not rebuilt, by decision").
- **Files:** `CLAUDE.md`, `docs/operations/deploy.md`, `docs/features/*.md` as touched.
- **Agent:** general-purpose
- **Model:** sonnet
- **Depends on:** T17
- **Verify:** `git grep -n -i streamelements CLAUDE.md` shows only the donation-history/removal note.
- **Decisions that apply:** docs describe only what exists on the branch.

### T19: QA of the robustness branch
- **What:** On `fix/deep-review-robustness`: full suite, two clean boots, and a headless-browser check that the alert overlay and the chat overlay reconnect after the server is stopped and started again.
- **Files:** none in the repo
- **Agent:** team-qa
- **Model:** sonnet
- **Depends on:** T10–T18
- **Verify:** as T9, plus the reconnect check passes for both overlays.
- **Decisions that apply:** report failures, don't paper over them.

### T20: English pass and unused keys (F33)
- **What:** Review `src/locales/en.json` texts touched by this run for plain, consistent English. Remove unused keys from all seven locales: `landing.*`, `subscription.notificationDelay` (after pointing the i18n test at a live key), unused coaching keys, and any other key no source names (find with a script over `src/`, `public/`, views; keys built dynamically must be kept — check prefixes used with template strings).
- **Files:** `src/locales/*.json`, `tests/i18n.test.js`.
- **Agent:** general-purpose
- **Model:** sonnet
- **Depends on:** T19 (creates `chore/deep-review-language-cleanup` from the tip of `fix/deep-review-robustness`)
- **Verify:** scratch recipe, `node --test "tests/**/*.test.js" "src/**/*.test.js"` pass.
- **Decisions that apply:** English is the main language.

### T21: pt.json to European Portuguese, part 1
- **What:** Rewrite every Portuguese text in the first half of `src/locales/pt.json` (top-level sections in file order up to roughly the midpoint by lines) into European Portuguese: "ecrã", "utilizador", "ficheiro", "carregar em", "prémio", "registo", "contacto", "equipa", "a + infinitivo" instead of gerunds ("está a ouvir"), no "você" (use the impersonal/3rd-person or "o seu" register, one register per page). Keep every `{{placeholder}}` and key unchanged. Record the split point in the commit message.
- **Files:** `src/locales/pt.json`.
- **Agent:** general-purpose
- **Model:** sonnet
- **Depends on:** T20
- **Verify:** scratch recipe, `node --test tests/i18n.test.js` passes; `node -e` JSON parse OK.
- **Decisions that apply:** pt-PT always, never Brazilian.

### T22: pt.json to European Portuguese, part 2, and the guard test (F32)
- **What:** Same rewrite for the rest of `pt.json` (from T21's split point). Then add a test (in `tests/i18n.test.js` or `tests/ptPt.test.js`) that fails on Brazilian markers in pt.json values: `você`, `clique`/`clicar`, `prêmio`, `arquivo`, `usuário`, `tela`, `registro`, `contato`, `equipe`, and gerunds after `está/estão/estamos/estou` (word boundaries, case-insensitive; a small allowlist only if a true pt-PT use is caught).
- **Files:** `src/locales/pt.json`, the test file.
- **Agent:** general-purpose
- **Model:** sonnet
- **Depends on:** T21
- **Verify:** scratch recipe, `node --test "tests/**/*.test.js"` passes; reintroducing "você" in one value makes the new test fail (then revert).
- **Decisions that apply:** pt-PT always.

### T23: Delete dead code and leftovers (G34, G35)
- **What:** Delete (with their `require`s, routes, view hooks, commented-out blocks and tests): `src/pollers/{instagramFeed,tiktokFeed,twitterFeed}.js` (and `manager.js` ~10-12), `src/services/{instagram,tiktok,twitter}.js`, any `iracingResults` leftovers, the custom overlays (`src/routes/customOverlays.js`, `public/overlay/{scenes,bar,custom-alerts}.js`, `src/views/custom-overlays.ejs`, the commented-out hooks in `server.js`, `overlay.js`, `twitchChat.js`, `dashboard.ejs`, `overlay-builder.ejs`, `overlay-config.ejs`, `overlay.css`; leave the `custom_overlays` table), `src/views/streamer-landing.ejs` and `login.ejs` if nothing renders them, tracked `bun.lock` and root `helmet-*.png`, `.gitignore` entries for paths that no longer exist (`bridge/…`; leave entries that still hide untracked files on disk such as `relative-*.png`, `smart-window-test.png`), `db.updateStreamerYoutube`, `updateProfilePicture`/`clearProfilePicture`, and the public `/avatars` mount. Remove their lines from `CLAUDE.md` (Project Structure, Custom Overlays bullet, env vars of the disabled integrations, uploads list). **Keep** `routes/payment.js`, `pricing.ejs`, `subscription.ejs`. Never delete untracked files.
- **Files:** as listed, `CLAUDE.md`, `.gitignore`.
- **Agent:** general-purpose
- **Model:** sonnet
- **Depends on:** T22
- **Verify:** `git grep -n -E "instagramFeed|tiktokFeed|twitterFeed|customOverlays|custom-alerts|updateStreamerYoutube|updateProfilePicture|streamer-landing"` empty outside docs history; scratch recipe, full suite passes; one boot with `DISCORD_DISABLED=1` answers `/health` 200.
- **Decisions that apply:** pricing code stays; no untracked file deleted or committed.

### T24: Docs for the cleanup branch
- **What:** `CLAUDE.md` i18n/test lines mention the pt-PT guard test; `docs/features/i18n.md` describes the pt-PT rule and the test; `docs/operations/deploy.md` short release note (no schema change; `/avatars` gone).
- **Files:** `CLAUDE.md`, `docs/features/i18n.md`, `docs/operations/deploy.md`.
- **Agent:** general-purpose
- **Model:** sonnet
- **Depends on:** T23
- **Verify:** the docs name the test file that exists.
- **Decisions that apply:** English main, pt-PT for Portuguese.

### T25: Final QA (all three branches)
- **What:** Full suite and two clean boots on `chore/deep-review-language-cleanup` (which contains all three); then the full suite once more on each of `fix/deep-review-money` and `fix/deep-review-robustness` (each PR must pass CI alone). Browser smoke at 375 and 1280 px in Portuguese (`lang=pt` cookie): dashboard, `/my-bookings`, a coaching page, the Overlay Builder: no Brazilian forms seen, no missing texts, no console errors.
- **Files:** none in the repo
- **Agent:** team-qa
- **Model:** sonnet
- **Depends on:** T1–T24
- **Verify:** `node --test "src/**/*.test.js" "tests/**/*.test.js"` 0 fail on all three branches (scratch copies); boots as T9.
- **Decisions that apply:** report failures with output.
