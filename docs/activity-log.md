# Team Activity Log archive

Older entries moved out of CLAUDE.md (newest stay there). Oldest first.

### 2026-11-16 15:00 — team-qa
**Task:** T9, QA of Coaching cancel, reschedule, refund and tabs: full suite, two clean boots, end-to-end walk in headless Chromium at 1600 and 375 px
**Tests added/changed:** none in the repo (throwaway harness and screenshots in the gitignored `.superpowers/sdd/2026-11-16-coaching-cancel-reschedule-refund/`)
**Suite result:** `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` on a scratch copy (Node 26, better-sqlite3 rebuilt there): 4092 tests, 4091 pass, 0 fail, 1 pre-existing skip. Two boots on empty data/: `/health` 200, 0 `[DB migration]` lines, exit 0 on SIGTERM.
**Manual checks:** 80 checks, 0 failed, 80 screenshots, no horizontal scroll, no console errors (Discord, PayPal and Discord OAuth stubbed).
- Coach cancels a free confirmed session: reason required, room role and channel deleted, viewer DM has the reason, no "Open the room", no refund line. Paid session: cancel allowed, Refund pending with payer name, email and capture id (coach page only), Refunded after a confirm sends the viewer DM; viewer page shows only "Your coach will refund you." then Refunded; a second press answers 409.
- Reschedule way 1 accepted by the viewer: room renamed, close moved to new end + 30 min. Way 2 with three rounds, coach accepts the viewer's last time. A coach proposal older than 48 h lapses on the tick and the viewer is asked to pick (link `?booking=`). A paid reschedule open 8 days closes as Not rescheduled with Refund pending and the room removed. A late payment (booking expired, time past) is kept and marked Refund pending.
- Four tabs remembered across reloads; a bad price opens Price, a category refusal opens Settings; the Pay note and the `bad_length` text show.
**Bugs found:** none. QA: pass.
**Open:** walk harness note: all traffic comes from localhost, so it spreads requests over fake X-Forwarded-For addresses to stay under the 200/min general limiter (not a site bug).

### 2026-11-16 — team-qa
**Task:** F1.4, check of fix round 1 (F1.1 017bcb1, F1.2 a44143d, F1.3 df34d53): full suite, two clean boots, F1.1 reproduction
**Tests added/changed:** none (throwaway repro on a scratch copy)
**Suite result:** `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` on a scratch copy (Node 26, better-sqlite3 rebuilt there): 4095 tests, 4094 pass, 0 fail, 1 pre-existing skip. Two boots on empty data/: `/health` 200, 0 `[DB migration]` lines, exit 0 on SIGTERM.
**Manual checks:** F1.1 reproduction (status `rescheduling`, paid_at NULL, starts_at = original_starts_at = now - 1 h, reschedule_started_at = now - 2 h, way `ask`) through `coachingBookings.withdraw` answers `{ ok: true }`, booking `withdrawn`.
**Bugs found:** none. QA: pass.
**Open:** none

### 2026-11-16 — team-security (T5, coaching booking in steps and My bookings)
**Task:** Security pass over `git diff main...HEAD`: coach-less sign-in, `/my-bookings/state`, CSRF, the `/paid` redirect, DM links, script rendering, the home link
**Findings:**
- OK: the sign-in redirect is a fixed `/my-bookings` or `/coaching/<encoded login>` (login pattern-checked); the empty-login purpose is read only after the state matched, any other non-matching purpose is 400; a repeated `for` is refused.
- OK: `/my-bookings/state` reads by the session's own Discord id, uses `forViewer` views (no payer details), marks a disabled or never-set-up coach unavailable, answers 401 without a viewer, `Cache-Control: private, no-store`.
- OK: the new page's POSTs go to the existing `/coaching/<login>/...` routes behind the global CSRF; the page includes `csrf.ejs`.
- OK: `/paid` adds `booking=<numeric id>` only for a booking of that streamer, errors are fixed codes, the order is pattern-checked and URL-encoded.
- OK: the DM link carries only the booking id; scripts build the DOM with `textContent`, no `innerHTML`; JSON embeds escape `<`; avatar `src` needs https, PayPal redirect is checked with `isPayPalUrl`.
**Files:** src/routes/auth.test.js, CLAUDE.md
**Fixes applied:** none needed; one regression test added (repeated `for` is 404 with no cookie). Scratch suite: 4125 tests, 4124 pass, 0 fail, 1 pre-existing skip.
**Open:** none

### 2026-11-16 — team-ux (T6, coaching booking in steps and My bookings)
**Mode:** audit
**Task:** UX check of the four-step booking page, My bookings and the home entry at 360, 768 and 1280 px (scratch copy, Discord and PayPal stubbed, a viewer seeded with 10 bookings across two coaches)
**Files:** src/views/coaching.ejs, src/views/my-bookings.ejs, public/js/coaching-page.js, public/js/my-bookings.js
**Decisions:**
- No horizontal scroll on any step or My bookings state at the three widths; text areas are 16 px at 360; focus moves to the step heading on a step change; Back keeps the chosen length.
- Fixed: at the booking limit step 3 said "No free times" next to the limit text (now only the limit text); touch targets under 44 px at 360 (Back, Connect Discord on My bookings, coach links, My bookings link, footer link); a booking row's date, length and price no longer wrap mid-line (date on its own line, "length · price" below).
- Left alone: the home page's new Coaching bookings button is 43 px high like its sibling buttons (home layout is not in this task).
**Open:** none. Screenshots (scratch): /private/tmp/claude-501/-Users-ricardsilva-Library-Mobile-Documents-com-apple-CloudDocs-Projects-vilela-notifications/3cd9b144-ad1b-4e74-8f69-978c52aab7ed/scratchpad/shots/

### 2026-11-16 — claude (general-purpose, T7 of coaching booking in steps and My bookings)
**Task:** Docs and the plan copy
**Files:** `docs/features/coaching.md`, `docs/operations/deploy.md`, `CLAUDE.md` (Coaching and Homepage bullets, Project Structure entries; the cancel/reschedule run's entries archived), `docs/team-log-archive/2026-11.md`, `docs/superpowers/plans/2026-11-16-coaching-booking-in-steps-and-my-bookings.md`
**Decisions:**
- The feature doc now describes the four steps, a new "My bookings" section, the coach-less sign-in and sign-out, the DM link to `/my-bookings?booking=<id>`, the PayPal return landing on My bookings, the routes and the tests.
- The deploy note says no schema change and lists the three live checks; payer details still go only to the booking's coach.
**Open:** none

### 2026-11-16 19:00 — team-qa
**Task:** T8, QA of the booking steps and My bookings: full suite, time-of-day runs, two clean boots, browser walk at 1600 and 375 px
**Tests added/changed:** none in the repo (harness and screenshots in the gitignored `.superpowers/sdd/2026-11-16-coaching-booking-in-steps/`)
**Suite result:** `node --test "src/**/*.test.js" "tests/**/*.test.js"` on a scratch copy (Node 26, better-sqlite3 rebuilt there; bridge tests not copied): 4055 tests, 4054 pass, 0 fail, 1 pre-existing skip. The 12 coaching, My bookings, auth and home test files (350 tests) run with Date shifted to 00:10, 00:00, 03:29, 06:30, 12:00, 16:40, 23:50 and 23:59 UTC: 350 pass each time. Two boots on empty data/: `/health` 200, 0 `[DB migration]` lines, exit 0 on SIGTERM.
**Manual checks:** 39 walk checks (Discord and PayPal stubbed, membership steered per viewer), 0 failed, no horizontal scroll, no console errors: signed out shows step 1 only; a non-member sees step 2 with Next disabled, Check again while still outside keeps it disabled, after joining Next enables and step 3 follows; unknown membership may go on; member starts at step 3, Back keeps the length, Send lands on `/my-bookings?booking=<id>&new=1` with the request on top as waiting; the coach's accept DM links `/my-bookings?booking=<id>`; My bookings across two coaches: Pay (PayPal return lands on My bookings with the paid notice, booking confirmed), Withdraw, accept a proposal, pick a new time, cancelled reason, refund line; home entry, Connect Discord with no coach, back on My bookings with the list.
**Bugs found:** [P3, fixed] A viewer whose membership is unknown starts at step 3 and never saw the "could not check" warning (it sat only in step 2, reachable by Back). Added the same line to step 3 (`src/views/coaching.ejs` `#cz-unverified-3`, `public/js/coaching-page.js`); walk and 156 related tests pass.
**Open:** none

### 2026-11-16 20:00 — team-qa
**Task:** F1.2, check of fix round 1 (F1.1, e8e534c: viewer DM action lines point to My bookings; transcript DM links it)
**Tests added/changed:** none
**Suite result:** `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` on a scratch copy (Node 26, better-sqlite3 rebuilt there): 4131 tests, 4130 pass, 0 fail, 1 pre-existing skip. Two boots on empty data/: `/health` 200, 0 `[DB migration]` lines, exit 0 on SIGTERM.
**Manual checks:** `viewerMessage` (booking 42, English) action lines: acceptedPay, rescheduleAsk, proposal, rescheduleProposed and proposalLapsed all end in `https://x/my-bookings?booking=42`; declined keeps `Pick another time` on the coach page plus the My bookings line.
**Bugs found:** none. QA: pass.
**Open:** none

### 2026-11-16 21:00 — claude (general-purpose, T5 of remove Racing)
**Task:** Part 1 docs: CLAUDE.md, deploy and backup notes, i18n doc
**Files:** CLAUDE.md, docs/operations/deploy.md, docs/operations/backup-restore.md, docs/features/i18n.md; deleted docs/features/session-capture.md, team-pitwall.md, voice-chat.md (bridge/CLAUDE.md was already gone)
**Decisions:**
- CLAUDE.md now describes a Streamer-only project with one "Racing removed" bullet: the 410 rule, the `/racing*` and `/tracks*` redirect, `/pitwall/overlays` 404, the chat overlay kept at `/overlay/iracing/chat/<token>`, the `drop_racing_tables` migration. Racing env vars and Racing sections are gone; the Racing alert-look family stays.
- deploy.md has a "Racing removed (2026-11-16)" release note: manual backup before merging, what the migration drops, how to check the tables, rollback needs the pre-release copy.
**Open:** none

### 2026-11-16 22:00 — team-qa
**Task:** T6, QA checkpoint for Part 1 (remove Racing)
**Tests added/changed:** none
**Suite result:** scratch copy (Node 26, better-sqlite3 rebuilt): 3958 tests, 3958 pass, 0 fail. Two boots on empty data/: `/health` 200, 0 `[DB migration]` lines.
**Manual checks:** `/racing*` and `/tracks` redirect to `/`; retired `/api` paths 410; `/pitwall/overlays/x` 404; chat overlay 200 with no WebSocket code, standings 404; `/auth/coaching-signin` redirects to Discord; `/my-bookings` loads.
**Bugs found:** none. Trivial fix: removed OpenAI Whisper from the External APIs line.
**Open:** none

### 2026-11-16 21:00 — claude (general-purpose, T18)
**Task:** Docs, CLAUDE.md and the plan copy for the review-fixes run (PR B)
**Files:** CLAUDE.md, docs/operations/deploy.md, docs/features/tracking.md, docs/features/tip-tts.md, docs/features/channel-point-rewards.md, docs/features/i18n.md, docs/security-todo.md, .env.example, docs/superpowers/plans/2026-11-16-remove-racing-and-review-fixes.md
**Decisions:**
- StreamElements is gone from CLAUDE.md except the note that old donation rows stay in history; `features.pricing` (false) is in the Feature Flags bullet.
- The overlay settings Preview Alert buttons keep their chat line; the working cards' Test buttons send `chat: false`; the preview iframe (`?preview=1`) is not counted as an open OBS source.
- deploy.md has a PR B release note (migrations, checks, rollback); the socket.io-client item in security-todo is closed.
**Open:** none

### 2026-11-16 21:00 — team-qa
**Task:** T19, final QA of the remove-Racing and review-fixes branch
**Tests added/changed:** none
**Suite result:** scratch copy (Node 26): 3970 tests, 3970 pass, 0 fail. Two boots on empty then reused data/: `/health` 200, 0 `[DB migration]` lines, exit 0 on SIGTERM both times.
**Manual checks:** 13 smoke checks pass (headless Chromium, seeded streamer): dashboard, card Test sends `chat:false`, overlay settings has no StreamElements and its preview iframe has `preview=1`, opening /dashboard/tracking leaves the six trackers off, /pricing and /payment redirect, /racing goes to `/`, /api/session 410, donation history shows a streamelements row, /my-bookings loads. Coaching tab flash checked for real with scripts delayed 1.5 s at 1280 and 375 px, five remembered-tab states each: only the remembered panel ever shown.
**Bugs found:** none. QA: pass.
**Open:** none

### 2026-11-16 23:00 — team-qa
**Task:** C1.1.8, full suite after the code review fixes, on both branches
**Tests added/changed:** none
**Suite result:** scratch exports (Node 26, better-sqlite3 rebuilt): `fix/review-findings` 3979 tests, 3979 pass, 0 fail; `chore/remove-racing` 3958 tests, 3958 pass, 0 fail. Two boots per branch on empty data/: `/health` 200, 0 `[DB migration]` lines, exit 0 on SIGTERM.
**Manual checks:** none
**Bugs found:** none. QA: pass.
**Open:** none

### 2026-11-16 23:30 — team-qa
**Task:** F1.3, check of fix round 1 (F1.1 01a3768 redemption clip ends once, F1.2 4c5e1ce docs): suite and boots on both branches, F1.1 in a browser
**Tests added/changed:** none
**Suite result:** scratch copies (Node 26, better-sqlite3 rebuilt): `fix/review-findings` 3981 tests, 3981 pass, 0 fail; `chore/remove-racing` 3958 tests, 3958 pass, 0 fail. Two boots per branch (empty data/, then reused): `/health` 200, 0 `[DB migration]` lines, exit 0 on SIGTERM.
**Manual checks:** F1.1 in headless Chromium on `/overlay/<token>`: a redemption with a missing audio file then three follows shows A, then B, then C, one at a time (2193, 2595, 2997 ms); the pre-fix overlay.js shows A and B at the same instant (2209, 2209). F1.2 `git grep` over docs: only legitimate mentions (release notes, 410/redirect notes, donation-history StreamElements rows, coaching.md:3, the obsolete idea doc, the Racing alert-look family).
**Bugs found:** none. QA: pass.
**Open:** none

### 2026-11-16 23:59 — team-qa
**Task:** C2.1.2, full suite after the code review fixes (branch `fix/review-findings`)
**Tests added/changed:** none
**Suite result:** scratch copy (Node 26, better-sqlite3 rebuilt): 3981 tests, 3981 pass, 0 fail, 0 skipped. Two boots on empty then reused data/: `/health` 200, 0 `[DB migration]` lines, exit 0 on SIGTERM.
**Manual checks:** none
**Bugs found:** none. QA: pass.
**Open:** none

### 2026-11-16 — team-qa
**Task:** F2.5, check of fix round 2 (F2.1 70af68a, F2.2 fe50f65, F2.3 a9e98af, F2.4 b45b895 + 2013bbf)
**Tests added/changed:** none
**Suite result:** scratch copies (Node 26, npm ci): `fix/review-findings` 3984 tests, 3984 pass, 0 fail; `chore/remove-racing` 3958 tests, 3958 pass, 0 fail. Two boots per branch on empty data/: `/health` 200, 0 `[DB migration]` lines, exit 0 on SIGTERM.
**Manual checks:** README lines 3 and 79 on both branches are the new text and the `node --test` command; F2.1 to F2.3 behaviours covered by their passing tests (trackers with no rows all off, sponsor name cut at 500, reward template over 500 refused, missing watcher `not_found`).
**Bugs found:** none. QA: pass.
**Open:** none

### 2026-11-18 — backend-dev (T1 of deep review fixes)
**Task:** Coaching: a PENDING PayPal capture is kept, never lost (A1)
**Files:** src/db.js, src/services/coachingPayments.js, coachingTick.js, coachingBookings.js, coaching.js, src/routes/coaching.js, coachingDashboard.js, myBookings.js, public/js/coaching-core.js, coaching-dashboard.js, two views (pill colours), locales (2 keys x 7), tests
**Decisions:**
- `coaching_payments.status` gains `pending` (columns `pending_since`, `next_read_at`), plus `closed` and `lapsed`; `deleteOpenCoachingPayment` only deletes `created`, so a pending row is never deleted. New tick step `readPending` (hourly the first day, then daily, lapsed after 30 days with a log line; voided/declined closed with a log line).
- A booking with a pending payment keeps its time until start - 15 min; its view state is `payment_processing` (view only, never stored); Pay and viewer withdraw answer `payment_processing`. A pending payment that completes after the booking ended is always `late_issue` (Refund pending, coach DMed; the viewer gets no new DM).
**Open:** none

### 2026-11-18 — backend-dev (T2 of deep-review fixes)
**Task:** Coaching: an order PayPal reports APPROVED is captured on read-back (A2)
**Files:** src/services/coachingPayments.js, src/services/coachingPayments.test.js, CLAUDE.md
**Decisions:**
- `startPayment`'s open-order read and `reconcileStale` capture an APPROVED order through `captureIfApproved`, only while `mayCapture` and the payment is not already pending; verification is the same `decideCoachingCapture`. A PENDING capture follows T1 (`keepPending`). `expireDue` is unchanged.
- `captureOnce(orderId)` shares one PayPal capture call per order between the return, Pay and the tick.
- Test fake: an uncaptured order now reads CREATED unless `order.approved` is set.
**Open:** none

### 2026-11-18 — backend-dev
**Task:** T3, coaching duplicate payment and a capture after the start (A3, A4)
**Files:** src/db.js, src/services/coachingBookings.js, src/services/coachingMessages.js, public/js/coaching-core.js, public/js/my-bookings.js, src/routes/myBookings.js, src/locales/*.json, their tests
**Decisions:**
- `double` lives on the payment row only; the booking stays confirmed with no `payment_issue`. A refunded duplicate DMs the viewer `duplicateRefunded` (the session stands); views carry `refundDuplicate` and My bookings shows its own refund lines.
- A capture for an `awaiting_payment` booking whose start has passed is recorded `late_issue` (status `expired`, Refund pending), never confirmed.
- A `late_issue` payment now DMs the viewer too (`paymentLateViewer`) as well as the coach.
**Open:** none

### 2026-11-18 — backend-dev (T4, tips: limiter, full reconcile, recovered time, refund on trackers)
**Task:** A5, A6, A7 of the deep-review money fixes
**Files:** src/server.js, src/db.js, src/index.js (unchanged), src/routes/tip.js, src/routes/dashboard.js, src/services/tipCapture.js, tipGoals.js, trackers.js, tests
**Decisions:**
- `POST /tip/:username/create` has `tipCreateLimiter` (15 per 10 min per visitor, `byVisitor`); the daily reconcile reads every unfinished row in pages of 500 (`getUnfinishedPendingTips(limit, offset)`) before any is settled, and index.js already runs it before the 24 h cleanup; a COMPLETED order the checks refuse logs `[Tip] Reconcile: order <id> is captured but was refused (<reason>)`.
- A reconciled tip is stored with the pending row's `created_at` (`logDonation` takes `created_at`), and `recordDonation(..., { at })` skips a goal created after it.
- A refund delete calls `trackers.onTipRemoved`: Top tipper re-broadcast; Latest tip recomputed from the newest remaining donation, or emptied, when it showed the deleted tip.
**Open:** none

### 2026-11-18 — backend-dev (T5, coaching rooms)
**Task:** Failed, orphaned and racing coaching rooms (C11, C12, C13)
**Files:** src/services/coachingRooms.js, src/services/coachingRooms.test.js, src/discord.js, src/db.js, src/routes/coachingDashboard.js, src/locales/*.json
**Decisions:**
- `listDueCoachingRooms` also returns `failed` rows holding a role or channel id; `closeDue` cleans them with no transcript (`transcript_status` cancelled).
- `readyGuild` throws `guild_gone` when the bot is logged in but the server is not among its servers; `clean()` treats that (or code 10004) as nothing left and closes the room as orphaned with a log line; Retry room answers `server_gone` (409) and closes the row. Discord down keeps today's retry.
- `build` re-reads the booking before opening the room and deletes what it made if the booking ended; `finishOrCleanMaking` treats `rescheduling` like `confirmed`.
**Open:** none

### 2026-11-18 — backend-dev (T6, deep-review fixes)
**Task:** Coaching bookings follow their coach (C14); separate lapse texts (C15)
**Files:** src/routes/coaching.js, src/services/coachingBookings.js, src/services/coachingMessages.js, src/locales/*.json, src/routes/coaching.test.js, src/routes/myBookings.test.js, src/services/coachingMessages.test.js
**Decisions:**
- The per-booking viewer routes (cancel, starts, propose, accept-proposal, pay) find the coach by the booking's `streamer_id`; the login in the URL is ignored there. Access is still the viewer's Discord id (another's booking: 404). `/paid` finds the coach from the order's booking, falling back to the login for an order not on record (so an order opened under another login now counts for its own coach).
- `proposalLapsedBody`/`viewerLapsedBody` say "48 hours"; new `proposalTooCloseBody`/`viewerTooCloseBody` are used when the tick dropped the proposal as too close (`tooClose` option).
**Open:** none

### 2026-11-18 — frontend-dev (T7, deep-review fixes)
**Task:** Coaching pages show the new states (payment processing, duplicate refund, server_gone)
**Files:** public/js/coaching-dashboard.js, public/js/dashboard-coaching.js, src/views/dashboard.ejs, src/routes/coachingDashboard.js, src/locales/*.json
**Decisions:**
- T1/T3/T5 had already wired My bookings, coaching-core, the state pills and the `server_gone` room error; T7 added only the gaps: the Coaching card's "Payment processing" line, and the coach's refund box title for a duplicate payment (new key `coaching.dashboard.refundTitleDuplicate`, 7 locales).
**Open:** 360/1280 px not browser-checked (text-only changes).

### 2026-11-18 — claude (general-purpose, T8 of deep-review fixes, money branch)
**Task:** Docs for the money branch and the plan copy
**Files:** docs/features/coaching.md, CLAUDE.md, docs/operations/deploy.md, docs/superpowers/plans/2026-11-18-deep-review-fixes.md
**Decisions:**
- coaching.md has a "Pending payments" section, the approved-order capture, the duplicate and late-after-start rules, the failed/orphaned/racing room rules, `server_gone`, and the coach-by-`streamer_id` routes; CLAUDE.md's Coaching, Donations, Donation History and Tip Goals bullets carry the same.
- deploy.md has a release note (two `coaching_payments` columns, new statuses, new limiter, log lines, live checks, rollback).
**Open:** none

### 2026-11-18 — team-qa
**Task:** T9, QA of the money branch (`fix/deep-review-money`, T1-T8)
**Tests added/changed:** none
**Suite result:** scratch copy (Node 26, better-sqlite3 rebuilt): 4025 tests, 4025 pass, 0 fail. Two boots on empty then reused data/: `/health` 200, 0 `[DB migration]` lines, exit 0 on SIGTERM.
**Manual checks:** reviewed the diff's tests against brief items A1-A7 and C11-C15: every item has a test; none missing.
**Bugs found:** none. QA: pass.
**Open:** none

### 2026-11-18 — backend-dev (T10, pollers: digest, milestones, clips)
**Task:** B8 digest channel per streamer, B9 broadcaster's own token for milestones and recap counts, B10 clips baseline
**Files:** src/db.js, src/pollers/weeklyDigest.js, src/pollers/manager.js, src/pollers/twitchClips.js, src/routes/dashboard.js, src/db.test.js, src/pollers/weeklyDigest.test.js, src/pollers/manager.test.js, tests/twitchClips.test.js
**Decisions:**
- `getDigestChannelForGuild(guildId, streamerId)` reads that streamer's enabled watcher row only.
- Milestones and the recap's follower count use the streamer whose `twitch_user_id` is the broadcaster, else a watcher with a token; a token past its expiry goes through `refreshBroadcasterTokenShared`.
- First clip look (no `last_clip_created_at`) stores the newest clip's time (or now when none) and posts nothing.
**Open:** none

### 2026-11-18 — frontend-dev (T11, one shared SSE client for the OBS sources)
**Task:** D17: `public/overlay/sse.js` replaces the six copies of the stream code
**Files:** public/overlay/sse.js (new), overlay.js, goal.js, poll.js, sponsors.js, tracking.js, iracing/chat.js, src/routes/overlay.js (each page loads sse.js first), tests/sseClient.test.js, tests/overlayClient.test.js, tests/trackingClient.test.js
**Decisions:**
- `AtletaSSE.connect({ url, onMessage, onOpen })` reopens the EventSource itself after every error (check the URL once: 404 waits 5 min, else 5 s) and reloads on a changed `serverVersion`; the chat overlay now reconnects too and validates the user colour as `#rrggbb`.
- A new OBS source page must load `/overlay/sse.js` before its script.
**Open:** none

### 2026-11-18 — frontend-dev (T12, deep-review fixes D18, D19)
**Task:** An alert that throws never stalls the OBS queue; the builder preview and the overlay share one guarded draw
**Files:** public/overlay/objects/kit.js, public/overlay/overlay.js, public/js/builder-cards.js, tests/overlayClient.test.js, tests/builderCards.test.js
**Decisions:**
- `kit.drawGuarded(look, own, dataFor, onBroken)` is the one draw: a throwing look is replaced by the alert's own object, else `{ look: null }` (overlay: legacy card; builder: empty slot). `drawAlert` and `Looper.play` both use it.
- `playNext` and the dismiss callback catch any throw, remove the slot and effects, and go on with `alertTimer(playNext, 500)`.
**Open:** none

### 2026-11-18 — backend-dev
**Task:** T13, raid protection and redemptions (D20, D21)
**Files:** src/services/chatModeration.js, src/services/redemptionDispatcher.js, src/db.js, src/views/redemptions-config.ejs, src/locales/*.json, tests next to them
**Decisions:**
- `raid_protection.prev_unknown` (new column): when Twitch did not report the previous followers-only setting, the end of the protection leaves the chat settings alone. The restore uses the stored `channel_login` even with the Twitch link removed; a new raid waits for a running restore.
- Redemptions left `pending` for over 10 minutes are settled by `settleStalePending` (boot and minute tick): unfulfilled ones are refunded, outcome `refunded_interrupted` (new text, 7 locales); others marked `disabled`. The missing-media path uses `refundRedemption()`, so an affiliate-gated answer is recorded `error`.
**Open:** none

### 2026-11-18 — backend-dev (T14, chat bots)
**Task:** D22-D25: YouTube chat re-check, bot token refused, flag batching, async catches
**Files:** src/services/youtubeLiveChat.js, twitchChat.js, chatModeration.js, dashboardCards.js, src/routes/dashboard.js, src/commands.js, src/locales/*.json, tests
**Decisions:**
- YouTube poller re-reads `yt_chatbot_enabled` and the account status every poll; the YouTube chatbot save stops it when switched off.
- `chatManager.authRefused()` is set when Twitch refuses `BOT_TWITCH_TOKEN` (logged once, cleared on connect); the chatbot card shows `cards.chatbot.status.tokenRefused`.
- First-time-chatter Discord mod-log embeds: first at once, the rest of the minute as one embed (25 names + "and N more"); the mod log table still gets every row; nothing is said in chat.
**Open:** none

### 2026-11-18 — backend-dev (T15, dashboard and server input rules)
**Task:** E26-E29: legacy forms reuse the card rules, flag gate for JSON routes, caps and reorder checks, body-less POSTs
**Files:** src/routes/dashboard.js, src/services/dashboardSettings.js, src/routes/admin.js, src/server.js, src/index.js, src/locales/*.json, src/routes/dashboard.test.js, src/server.app.test.js
**Decisions:**
- `dashboardSettings.readSetting(key, raw)` is the one reader of text settings; `POST /dashboard/chatbot` uses it (400 text, nothing saved, on a bad template; empty still allowed).
- `flagGate` in routes/dashboard.js answers 404 JSON: `/api/vtuber/*` (vtuber+overlays), `/api/tracking/*` and `/donations/tts/test` (overlays). Caps: 50 sponsor messages, 50 rewards, 100 commands on the old form; sponsor url http(s) <= 200; reorder ids validated.
**Open:** none

### 2026-11-18 — backend-dev
**Task:** T16, migrations hardening and the migration test (E30, CI part of G36)
**Files:** src/db.js, src/db.dataMigrations.test.js, tests/migrations.test.js, tests/fixtures/schema-oldest.sql, .github/workflows/server-ci.yml, docs/operations/deploy.md, CLAUDE.md
**Decisions:**
- `_addColumn(table, name, def)` in `db.js` checks `table_info` per column; the PR #21 hotfix uses it. Every silent `catch {}` in db.js now goes to `_migrationLog`. The `design_version` backfill is `_runOnce('design_version_backfill')`; the forced `sponsor_interval_seconds` ALTER is a per-column check (silent on a fresh DB).
- The fixture is the 5a9ac56 schema (the first one migrated in place; a4f8167 is dropped whole). `sessions` is not rebuilt, documented in deploy.md. CI also runs `node --check` over `public/`.
**Open:** multi-column ALTER blocks gated on one column still exist; the new test shows none is missing today.

### 2026-11-18 — backend-dev (T17, dev sync hardening)
**Task:** E31: the production sync snapshot is scrubbed on the copy; the dev side is guarded
**Files:** src/db.js (`scrubSnapshot`), src/routes/sync.js, src/services/sync.js, src/db.sync.test.js
**Decisions:**
- `GET /sync/backup` runs `db.scrubSnapshot()` on the snapshot file only: PayPal and payer emails/names/ids, pending tip donor data, coaching viewer ids/names/notes and viewer sessions removed; overlay and multistream tokens replaced by fresh random values; sealed OAuth tokens left sealed.
- `services/sync.js`: in-flight guard, 10 min fetch timeout, exits 1 after a restore (and in the catch once the DB is closed) so ON_FAILURE restarts dev; `/sync/status` reads `getLastSync()`.
**Open:** none

### 2026-11-18 — claude (general-purpose, T18 of deep-review fixes, robustness branch)
**Task:** G36 docs: CLAUDE.md bullets and the deploy release note for T10-T17
**Files:** CLAUDE.md, docs/operations/deploy.md
**Decisions:**
- StreamElements text was already gone from the main bullets; only the donation notes and past log entries mention it. MessageContent was already in the intents line.
- Boot and shutdown lists the three ticks that exist (`trackingGoals`, `redemptionDispatcher`, `coachingTick`); `trackers.js` has no tick, only a 10 s test-revert timer, so none is claimed for it.
- New bullets: shared SSE client and `drawGuarded`, migrations and their test (`sessions` not rebuilt, by decision), the robustness rules, the scrubbed dev sync. deploy.md has a PR 2 release note next to T16's migration-test section.
**Open:** none

### 2026-11-18 — team-qa
**Task:** T19, QA of the robustness branch (T10-T18)
**Tests added/changed:** none
**Suite result:** scratch copy (Node 26): 4065 tests, 4065 pass, 0 fail. `node --check` on public/**/*.js ok. Two boots on empty then reused data/: `/health` 200, 0 `[DB migration]` lines, exit 0 on SIGTERM.
**Manual checks:** headless Chromium, seeded streamer: the alert overlay and the chat overlay both reconnect (and reload on the new serverVersion) after the server is stopped and started on the same data dir and token; no page errors.
**Bugs found:** none. Brief items B, D, E have tests (no gaps). QA: pass.

### 2026-11-18 — backend-dev (C3.1.1)
**Task:** A replayed return of a duplicate order says `duplicate`, not `late`
**Files:** src/services/coachingPayments.js, src/services/coachingPayments.test.js
**Decisions:**
- `outcomeOf` checks the booking's own order (`paid`), then the payment row's `refund_reason === 'double'` (`duplicate`), else `late`; no route change.
**Open:** none

### 2026-11-18 — claude (general-purpose, T20)
**Task:** English pass and unused locale keys (F33)
**Files:** src/locales/*.json, src/i18n.test.js
**Decisions:**
- Removed 33 keys no source names (`landing.*`, `subscription.notificationDelay`, unused `overlayBuilder.*` and two `coaching.*`) from all seven locales; the t() placeholder test uses `nav.timeMinutes`.
- Keys built from template-string prefixes (families, looks, sounds, coaching.message, report.analyze, tts.currency, lang) were kept.
**Open:** none

### 2026-11-18 — claude (general-purpose, T21 of deep-review-fixes)
**Task:** pt.json to European Portuguese, part 1 (lines 2-1503)
**Files:** src/locales/pt.json
**Decisions:**
- Split point: lines 2-1503 done, last key `chatbot.cmd.deleteConfirm`; T22 starts at line 1504 (`chatbot.mod.note`). Keys are flat and interleaved, so go by line number.
- 590 values changed; keys, order, `{{placeholders}}` and HTML unchanged. Gerunds became "a + infinitivo", "você" dropped, "ligar" used for connect, "subscritor"/"em direto"/"espetador" for sub/live/viewer.
**Open:** none

### 2026-11-18 — claude (general-purpose, T22)
**Task:** pt.json lines 1504-3006 to European Portuguese (part 2) and the guard test (F32)
**Files:** src/locales/pt.json, tests/ptPt.test.js, CLAUDE.md
**Decisions:**
- Poll = "sondagem", prediction = "previsão", live = "direto", default = "predefinição"; "você" removed (impersonal or "o seu"); gerunds became "a + infinitivo".
- `tests/ptPt.test.js` fails on Brazilian markers in pt.json values (você, clicar, "clique em/para...", prêmio, arquivo, usuário, tela, registro, contato, equipe, gerund after está/estão/estamos/estou); the noun "clique" is allowed.
**Open:** none

### 2026-11-18 — claude (general-purpose, T23 of deep-review fixes)
**Task:** Delete dead code and leftovers (G34, G35)
**Files:** deleted the Instagram/TikTok/Twitter pollers and services, the custom-overlays route, the three custom-overlay scripts in `public/overlay/`, `views/custom-overlays.ejs`, `views/streamer-landing.ejs`, `bun.lock`, root `helmet-*.png`; edited `pollers/manager.js` (+test), `discord.js` (three embed builders), `config.js`, `db.js` (`updateStreamerYoutube`), `server.js`, `routes/overlay.js`, `services/twitchChat.js`, views and `overlay.css` (commented-out hooks), `.gitignore`, `CLAUDE.md`
**Decisions:**
- KEPT `updateProfilePicture`/`clearProfilePicture` and the `/avatars` mount: the account page still uploads and removes a profile picture (`POST/DELETE /dashboard/account/avatar`), and header/account read it; the brief's "nothing writes there" is wrong.
- Left the unused watched_instagram/tiktok/twitter tables and their `db.js` helpers, the `custom_overlays` table and the tier-table instagram/tiktok/twitter flags in place (schema, not code).
**Open:** none

### 2026-11-18 — claude (general-purpose, T24)
**Task:** Docs for the cleanup branch (pt-PT guard test, removed locale keys, deleted dead code)
**Files:** CLAUDE.md, docs/features/i18n.md, docs/operations/deploy.md
**Decisions:**
- i18n line and `docs/features/i18n.md` name `tests/ptPt.test.js` and its guarded markers; deploy.md has a short release note (no schema change).
- `/avatars` and the profile-picture functions were kept (the account page still uploads avatars); the dead tables stay.
**Open:** none

### 2026-11-18 — team-qa
**Task:** T25, final QA of the three deep-review branches
**Tests added/changed:** none
**Suite result:** scratch exports (Node 26): money 4025/4025, robustness 4065/4065, chore 4055/4055 pass, 0 fail. Two boots on chore (empty then reused data/): `/health` 200, 0 `[DB migration]` lines, exit 0 on SIGTERM. `node --check` on all public and src files ok.
**Manual checks:** headless Chromium, lang=pt, 375 and 1280 px, 10 pages (dashboard, my-bookings, coaching page, Overlay Builder, coaching dashboard, overlay settings, tracking, donations, tutorial, home): no console errors, no raw keys, no Brazilian wording.
**Bugs found:** [P3] `/dashboard/overlay` at 375 px in pt scrolls horizontally (442 px): the "Limpar Todos os Alertas" + "Guardar Definições" row; English fits. Older layout, not from this run.
**Open:** the P3 above for team-ux.

### 2026-11-18 — team-qa
**Task:** C3.1.2, full suite after code review fixes 3.1, on all three branches
**Tests added/changed:** none
**Suite result:** scratch exports (Node 26, better-sqlite3 rebuilt): money 4030/4030, robustness 4070/4070, chore 4060/4060 pass, 0 fail. Two boots on chore (empty data/): `/health` 200, 0 `[DB migration]` lines, exit 0 on SIGTERM both times.
**Manual checks:** none
**Bugs found:** none. QA: pass.

### 2026-11-18 — backend-dev (F3.1)
**Task:** The coach's cancel is refused while a payment on the booking is pending
**Files:** src/services/coachingBookings.js, src/routes/coachingDashboard.js, src/views/dashboard.ejs, public/js/coaching-dashboard.js, public/js/dashboard-coaching.js, src/locales/*.json, src/services/coachingPayments.test.js
**Decisions:**
- `cancel` answers `payment_processing` (409) when a `coaching_payments` row of the booking is `pending`, before any change or DM; the schedule hides Cancel for that state and shows the reason, the Coaching card's payment line appends it. The start - 15 min release still applies.
- New key `coaching.dashboard.error.payment_processing` in all seven locales (pt-PT).
**Open:** none

### 2026-11-18 — backend-dev (F3.2)
**Task:** "Your session stands" only for a duplicate on a session that stands
**Files:** src/db.js, src/services/coachingPayments.test.js
**Decisions:**
- `recordCoachingPayment` answers `double` only while the paid booking is `confirmed` or `rescheduling`; any other status (cancelled, expired, not_rescheduled...) records the extra payment as `late_issue` (Refund pending, reason `late`, both sides told, booking untouched); a replayed return follows the stored refund reason.
**Open:** none

### 2026-11-18 — backend-dev (F3.3)
**Task:** My bookings keeps its actions when the coach's Twitch login is gone
**Files:** src/db.js, src/routes/myBookings.js, src/services/coachingPayments.js, public/js/my-bookings.js, tests
**Decisions:**
- `coach_available` no longer needs a Twitch login (enabled account + coaching settings); the coach's name falls back to their Discord name; the coach link is drawn only with a login.
- Per-booking action URLs use `/coaching/-/...` and Pay's return URL is `/coaching/-/paid` (cancel URL `/my-bookings`); the routes already find the coach by the booking/order, and old login URLs still work.
**Open:** none

### 2026-11-18 — backend-dev (F3.4)
**Task:** The 90-day coaching cleanup keeps payments whose refund is still owed
**Files:** src/db.js, src/db.coaching.test.js
**Decisions:**
- `cleanupOldCoachingBookings` skips bookings with a payment `refund_status = 'pending'` or `status = 'pending'` (and keeps their payments and rooms rows); a later run deletes them once refunded, settled or lapsed.
**Open:** none

### 2026-11-18 — team-qa
**Task:** F3.5, docs and full suite after fix round 3 (F3.1-F3.4)
**Tests added/changed:** none
**Suite result:** scratch copies (Node 26, npm ci, better-sqlite3 rebuilt): money 4036/4036, robustness 4076/4076, chore 4066/4066 pass, 0 fail. Two boots on chore: `/health` 200, 0 `[DB migration]` lines, exit 0 on SIGTERM.
**Manual checks:** docs/features/coaching.md and the CLAUDE.md Coaching bullet updated for F3.1-F3.4; committed on money, merged forward to robustness and chore.
**Bugs found:** none. QA: pass.
**Open:** none

### 2026-11-24 — backend-dev (T1, deep-review follow-ups)
**Task:** Lapsed coaching payments are kept and read back weekly
**Files:** src/db.js, src/services/coachingPayments.js, src/services/coachingPayments.test.js, src/db.coaching.test.js
**Decisions:**
- A `lapsed` payment (30 days) is read weekly until 90 days after `pending_since`/`created_at`, then `next_read_at` is NULL (one log line) and it is no longer due; a COMPLETED read records it as `late_issue` + Refund pending; voided/declined closes it.
- The 90-day cleanup keeps bookings, payments and rooms while a payment is `pending` or `lapsed`; a lapsed payment never holds the booking's time.
**Open:** none
