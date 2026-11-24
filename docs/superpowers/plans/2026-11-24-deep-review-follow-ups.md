# Plan: Deep review follow-ups: pt overlay layout and eight minor notes

Brief: `brief.md`

Every worker runs on `sonnet`. Tasks run one at a time. No task pushes or deploys: the ship session does that after review.

## Shipping
- **Ship:** yes (the brief asks for it; the project deploys on a push to `main`).
- **Where:** branch `fix/deep-review-follow-ups` from `main`, one PR to `main`. Main merges it (`gh pr merge --admin --merge`); the merge auto-deploys to Railway.
- **Checks before push:** none locally (no pre-push hook). CI (`.github/workflows/server-ci.yml`) must be green on the PR.
- **Verify live:** Railway deployment SUCCESS; `https://atletanotifications.com/health` 200; logs show no `[DB migration]` and no `LOGIN REFUSED`; `/coaching/ricardobsilva98` and `/my-bookings` answer 200.

## Rules for every task
- Work on branch `fix/deep-review-follow-ups`. T1 creates it from `main` (`git switch -c fix/deep-review-follow-ups main`) if it does not exist; later tasks just check they are on it. Commit your own task's files at the end (one commit, message `fix: <task>` / `docs: <task>`, with the attribution line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Never push.
- Never commit or touch untracked files whose names end in ` 2.js`, ` 2.sql`, ` 2.md` (iCloud copies), nor `graphify-out/`. Never change `package.json`, `package-lock.json`, `node_modules`, `.env`, production data or Railway settings. No destructive git.
- **Running tests (local Node is 26, the project is 24):** never in the repo. Use a scratch copy in your scratchpad directory:
  `S="<your scratchpad>/suite"; mkdir -p "$S"; rsync -a --delete --exclude node_modules --exclude data --exclude graphify-out --exclude '* 2.*' --exclude .git ./ "$S/"; cd "$S"; [ -d node_modules ] || npm ci --silent; npm rebuild better-sqlite3 >/dev/null; node --test <files>`
- Every new user-facing text goes into all 7 locale files (`src/locales/{en,pt,es,fr,de,zh,ja}.json`) with the same `{{placeholders}}`; Portuguese is European (pt-PT); English is the main language. `tests/i18n.test.js` and `tests/ptPt.test.js` must pass. `node scripts/locale-keys.js` can add keys line by line.
- No schema change unless the task says so.
- Append one entry to the `## Team Activity Log` at the end of `CLAUDE.md` in the documented format (T8 does the CLAUDE.md body changes; other tasks only append their log entry).

## Item 6 (closed, no code)
Raid protection rows from before the `prev_unknown` column could only exist during the 2026-11-18 deploy window (≤ 10 minutes), which is long past. No task. T8 records this in the deploy note.

## Tasks

### T1: Lapsed coaching payments are kept and read back weekly (item 1)
- **What:** A coaching payment that is still PayPal-PENDING after 30 days becomes `lapsed` as today, but (a) is never deleted by the 90-day cleanup while unsettled, together with its booking, payments and room rows; (b) keeps being read back about once a week until 90 days after it was taken (`pending_since`, else `created_at`); after that it is no longer read but still never deleted. If a read-back of a lapsed payment finds the capture COMPLETED and the checks pass, it is recorded exactly like a late capture of a pending payment (`late_issue`, Refund pending, coach and viewer told through the existing `coachingBookings.afterPayment` path). A read that finds the order voided/declined closes it (`closed`) as today; a read that still says PENDING just schedules the next weekly read. A lapsed payment must NOT hold the booking's time or show "Payment processing": check every place that reads `coaching_payments.status = 'pending'` (grep `'pending'` in `src/db.js`, `src/services/coaching*.js`, `src/routes/coaching*.js`, `src/routes/myBookings.js`) and leave those as they are unless they must also accept `lapsed` (the record transaction's `order.status === 'pending'` check in `_recordCoachingPayment` must treat `lapsed` like `pending`, so a lapsed payment that completes is never `late_confirmed`).
- **Files:** `src/services/coachingPayments.js` (`readPending` ~494-544, `nextPendingRead`, constants ~32-36), `src/db.js` (`cleanupOldCoachingBookings` ~5382, the due-pending query ~5113, `closeCoachingPayment` ~5106, `scheduleCoachingPaymentRead` ~5100, `_recordCoachingPayment` ~5130-5193), tests `src/services/coachingPayments.test.js`, `src/db.coaching.test.js`.
- **How (suggested, smallest change):** the due query reads `status IN ('pending','lapsed')`; when a payment lapses at 30 days, set `next_read_at = now + 7 days` instead of NULL (a new small db function or a parameter); in `readPending`, a lapsed payment still PENDING gets `next_read_at = now + 7 days` while `now - since < 90 days`, else NULL; `closeCoachingPayment` and `scheduleCoachingPaymentRead` accept `lapsed` rows; the cleanup's exclusion becomes `refund_status = 'pending' OR status IN ('pending','lapsed')`. The 30-day log line stays; add one log line when reading stops at 90 days.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** none
- **Verify:** new tests: (1) a lapsed payment is not deleted by `cleanupOldCoachingBookings` and its booking stays; (2) a lapsed payment is due again 7 days later and a COMPLETED read records `late_issue` with Refund pending; (3) past 90 days it is no longer listed as due. Then `node --test src/services/coachingPayments.test.js src/db.coaching.test.js src/services/coachingBookings.test.js src/services/coachingTick.test.js tests/migrations.test.js` on the scratch copy: all pass, 0 fail (skip any file that does not exist).
- **Decisions that apply:** keep lapsed rows (and their booking) out of the 90-day cleanup; read back about weekly until 90 days after it was taken; COMPLETED → recorded like any late capture (`late_issue`, Refund pending, coach told); after that stop reading but never delete while unsettled; no new UI; no schema change.

### T2: The after-start check uses the time the capture returned (item 2)
- **What:** Every decision about whether a capture came before or after the session start (and `captured_at`) uses the time taken right after the PayPal call returned, not the `now` taken when the request or the minute tick began. Apply it in `handleReturn` (after `captureOnce`/`getOrder`), `captureIfApproved` (used by `startPayment`, `expireDue`, `reconcileStale`) and `readPending` (after `getOrder`): compute `const at = Math.max(now, Date.now())` after the await and pass `at` to `record(...)` (and to any `mayCapture`-style check made after the call). `Math.max` keeps tests that inject a fixed future `now` deterministic and is always the real time in production. The pre-call `mayCapture(booking, now)` checks stay as they are (they only decide whether to try).
- **Files:** `src/services/coachingPayments.js` (`mayCapture` ~157, `captureIfApproved` ~177-189, `startPayment` ~247-266, `handleReturn` ~325-366, `expireDue` ~404-422, `reconcileStale` ~450-468, `readPending` ~494-516), `src/services/coachingPayments.test.js`.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T1
- **Verify:** a new test where the PayPal fake's capture resolves after the booking's start (e.g. `starts_at` = now + 50 ms and the fake capture waits 100 ms, or a stubbed `Date.now`) shows the booking is not confirmed and the payment is `late_issue` with Refund pending. Then `node --test src/services/coachingPayments.test.js src/routes/coaching.test.js src/routes/myBookings.test.js` on the scratch copy: all pass.
- **Decisions that apply:** take the time again right after the PayPal capture returns, and compare the session start with that time; the decision must reflect when the money moved.

### T3: A room delete Discord refuses is given up after 24 hours and the coach is told (item 3)
- **What:** In `closeDue`, when cleaning a room fails with a permissions refusal (Discord code 50013 or 50001) and the room has been due to close for 24 hours or more (`now - room.close_at >= 24 h`; `close_at` is when the first close attempt was due, so no new column is needed), stop retrying: set the room `state: 'closed'` with `error: 'missing_permissions'` (so `listDueCoachingRooms` no longer picks it), log one clear line (`[Coaching] Room <booking id>: Discord refused to delete the room/role (missing permissions) for 24 h; gave up, coach told`), and DM the coach once to delete the room and role themselves. Any other error keeps today's every-minute retry; a guild-gone answer keeps today's orphaned handling. `clean()` must report why it failed (e.g. return the Discord code / `errorCode(e)` instead of bare `false`); keep its existing behaviour for every caller (grep its callers).
- **DM:** a new streamer message kind `roomDeleteRefused` in `src/services/coachingMessages.js` `streamerMessage` (title `coaching.message.roomDeleteRefused.title` with `{{viewer}}`, body `coaching.message.roomDeleteRefusedBody`: "Atleta could not delete the voice room and role of your session with {{viewer}} on {{when}}: the bot lacks permission. Please delete them yourself in your Coaching category." — reuse the existing `when` formatting; typed text through `escapeLinkText` as the other kinds do), in all 7 locales (pt-PT). Send it with `discord.sendDirectMessage(streamer.discord_user_id, payload)` in the streamer's language, picked the way `coachingBookings.messageStreamer` picks it; always sent (not gated by "Message me about new requests"). Avoid a require cycle between `coachingRooms.js` and `coachingBookings.js` (check which requires which; call the message builder and `discord` directly if needed). A failed DM is logged, never thrown.
- **Files:** `src/services/coachingRooms.js` (`clean` ~144-157, `errorCode` ~57-64, `closeDue` ~359-393), `src/services/coachingMessages.js` (~130-170), `src/services/coachingBookings.js` (read only: `messageStreamer` ~196-215 for the language rule), `src/locales/*.json`, tests `src/services/coachingRooms.test.js`, `src/services/coachingMessages.test.js`.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T2
- **Verify:** new tests: a 50013 refusal before 24 h keeps the room `closing` and sends no DM; at ≥ 24 h the room becomes `closed` with `error = 'missing_permissions'`, is no longer due, and exactly one coach DM is sent; a non-permission error at ≥ 24 h keeps retrying; the message builder's output has no raw `coaching.message.` key. Then `node --test src/services/coachingRooms.test.js src/services/coachingMessages.test.js src/services/coachingTick.test.js tests/i18n.test.js tests/ptPt.test.js` on the scratch copy: all pass.
- **Decisions that apply:** give up after about 24 hours of retries from the first refusal: stop retrying, mark the room so the tick leaves it, log a clear line, tell the coach by Discord DM (existing coach-message path, all 7 locales) to delete the room and role themselves; other errors keep today's retry.

### T4: A channel added to a watch list again starts with a fresh clip baseline (item 4)
- **What:** When `db.addWatchedChannel` actually inserts a watcher row and no other `watched_channels` row exists for that `twitch_username` (any server), reset `channel_state.last_clip_created_at` to NULL in the same transaction, so the clips poller's first-look rule stores a baseline and posts nothing old. When another watcher already watches it, leave the state alone (it is current, and resetting would make that watcher miss clips). A never-watched channel behaves as today.
- **Files:** `src/db.js` (`addWatchedChannel` ~1691-1696, `_upsertChannelState` ~1667-1670, the watched_channels insert ~1641), `src/pollers/twitchClips.js` (read only, first look ~49-56), tests `src/db.test.js` (or the db test that covers watched channels) and `tests/twitchClips.test.js`.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T3
- **Verify:** new test: a channel with a stored `last_clip_created_at`, removed and added again (no other watcher), has `last_clip_created_at` NULL after the add; with a second watcher still present it keeps its value. Then `node --test src/db.test.js tests/twitchClips.test.js src/routes/dashboard.test.js` on the scratch copy: all pass.
- **Decisions that apply:** when a channel is added to a server's watch list, treat it as a first look (fresh baseline, post nothing old), whether or not it was watched before.

### T5: Milestones and recaps never use another streamer's broadcaster token (item 5)
- **What:** `findBroadcasterStreamer` in `src/pollers/manager.js` returns only the streamer whose `twitch_user_id` is the broadcaster (and who has a broadcaster token); drop the loop over other watchers. Without the owner's token: milestones are skipped (Twitch's `GET /channels/followers` needs a user token; no app-token fallback). Log it once per channel as today (no new log spam). The recap (`findBroadcasterToken`) follows the same rule: no owner token → no follower count. Grep every caller of `findBroadcasterStreamer` / `findBroadcasterToken` / `broadcasterTokenOf`.
- **Files:** `src/pollers/manager.js` (~58-88, `checkMilestones` ~175-230), `src/pollers/twitchLive.js` (~128-133, read; change only if needed), `src/services/twitch.js` (`getFollowerCount`, `getSubscriberCount`), tests `src/pollers/manager.test.js`.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T4
- **Verify:** new test: a channel whose owner has no broadcaster token but another watcher has one never passes the other watcher's token to Twitch (neither count requested). Existing owner-token tests still pass. Then `node --test src/pollers/manager.test.js src/pollers/*.test.js tests/twitchClips.test.js` on the scratch copy: all pass.
- **Decisions that apply:** never use another streamer's broadcaster token; without the owner's token skip what needs it (both counts); log it once, as today.

### T6: OBS stream probe deadline and the overlay settings button row on phones (items 8, 9)
- **What:**
  1. `public/overlay/sse.js` `retryDelay`: give the probe `fetch` a 10 s deadline (`AbortSignal.timeout(10000)` where available, else the existing `AbortController` with a `setTimeout` abort); a timeout counts like any non-404 failure (retry in 5 s, `RETRY_MS`). Keep the file dual-exported (`{ connect, retryDelay }`) and the early abort after the status is read. Add a test in `tests/sseClient.test.js` (the file runs `sse.js` in a `vm` context with a fetch stub): a probe that never resolves gives a 5 s retry once the deadline passes (provide `AbortSignal`/`AbortController` or a fake timeout in the context as needed).
  2. `src/views/overlay-config.ejs` ~172-186, the Alerts header row (title + "Clear All Alerts" + "Save Settings"): let it wrap at narrow widths so nothing scrolls sideways at 360-375 px in any of the 7 languages (e.g. `flex-wrap: wrap; gap: 10px 12px` on the row and `flex-wrap: wrap` on the button group); the desktop layout in English stays as it is today.
- **Files:** `public/overlay/sse.js`, `tests/sseClient.test.js`, `src/views/overlay-config.ejs`.
- **Agent:** frontend-dev
- **Model:** sonnet
- **Depends on:** T5
- **Verify:** `node --check public/overlay/sse.js`; `node --test tests/sseClient.test.js tests/overlayClient.test.js tests/headerView.test.js` on the scratch copy: all pass. Layout: start the site from the scratch copy (`DISCORD_DISABLED=1 TWITCH_CLIENT_ID=x TWITCH_CLIENT_SECRET=x PORT=3123 node src/index.js` with a seeded streamer session, or render the view through the app's test harness as `src/routes/dashboard.test.js` does) and check in headless Chromium (Playwright, already installed) that `/dashboard/overlay` has `document.documentElement.scrollWidth <= innerWidth` at 360 and 375 px for all 7 `lang` cookies, and at 1280 px in English the two buttons sit on the title's row as before. Screenshots go to your scratchpad, not the repo.
- **Decisions that apply:** probe deadline about 10 s, a timeout counts like any non-404 failure (retry in 5 s), `sse.js` stays dual-exported and tested in `tests/sseClient.test.js`; the button row wraps or stacks at narrow widths so nothing scrolls sideways at 360-375 px in any of the 7 languages; English desktop layout unchanged.

### T7: "catorze" in pt.json and the pt-PT guard (item 7)
- **What:** In `src/locales/pt.json`, `overlayBuilder.looks.raid-music.desc` says "quatorze": change it to "catorze" (only that word; nothing else in the line). Add `['quatorze', word('quatorze')]` to `MARKERS` in `tests/ptPt.test.js` (same style as the others, ~lines 12-27). Leave `fr.json` (French "quatorze" is correct) and the plan assets under `docs/` alone.
- **Files:** `src/locales/pt.json` (~859), `tests/ptPt.test.js`.
- **Agent:** general-purpose
- **Model:** sonnet
- **Depends on:** T6
- **Verify:** `grep -c quatorze src/locales/pt.json` prints 0; `node --test tests/ptPt.test.js tests/i18n.test.js` on the scratch copy: all pass.
- **Decisions that apply:** change it to "catorze" and add "quatorze" to the Brazilian markers `tests/ptPt.test.js` rejects.

### T8: Docs, deploy note and the plan copy
- **What:** Update the docs for what changed, briefly, in the project's style:
  - `CLAUDE.md`: Coaching bullet (lapsed payments kept and read weekly until 90 days, never deleted while unsettled; the after-start check uses the time the capture returned; a room delete refused for permissions is given up after 24 h and the coach is DMed), the Pollers bullet / Robustness rules (a re-added channel gets a fresh clip baseline; milestones and recaps use only the owner's broadcaster token), the Shared OBS stream client bullet (the probe has a 10 s deadline); the Team Activity Log entry for this task. Keep edits to the sentences that change.
  - `docs/features/coaching.md`: the pending/lapsed payments section, the rooms clean-up section, the DM table (the new `roomDeleteRefused` coach message).
  - `docs/operations/deploy.md`: a short section `## Deep-review follow-ups (2026-11-24)` after the last release note: what changed, no schema change (unless a task added one), item 6 closed with no code (it only affected the 2026-11-18 deploy window), the live checks (`/health`, no `[DB migration]`/`LOGIN REFUSED`, `/coaching/ricardobsilva98`, `/my-bookings`), rollback (plain revert, nothing to undo in data).
  - Copy this plan to `docs/superpowers/plans/2026-11-24-deep-review-follow-ups.md`.
  - The one-line `.gitignore` change adding `graphify-out/` (already in the working tree) may be committed with this task; check `git diff .gitignore` shows only that line first.
- **Files:** `CLAUDE.md`, `docs/features/coaching.md`, `docs/operations/deploy.md`, `docs/superpowers/plans/2026-11-24-deep-review-follow-ups.md`, `.gitignore`. Read the commits of T1-T7 (`git log main..HEAD`, `git diff main...HEAD`) for what actually changed.
- **Agent:** general-purpose
- **Model:** sonnet
- **Depends on:** T7
- **Verify:** `git diff main...HEAD --stat` lists the docs; `git status --porcelain` shows no tracked file left uncommitted and none of the ` 2.*` files or `graphify-out/` staged.
- **Decisions that apply:** item 6 recorded as closed with no code; update `CLAUDE.md`/docs where behaviour changed and add a short deploy note.

### T9: Full QA
- **What:** Run the whole suite and two boots on a scratch copy of the branch, and check the items end to end where tests cannot.
- **Files:** none to change (unless a bug is found: report it, fix only if trivial and in no other lane).
- **Agent:** team-qa
- **Model:** sonnet
- **Depends on:** T1, T2, T3, T4, T5, T6, T7, T8
- **Verify:**
  1. Scratch copy (see Rules): `node --test "src/**/*.test.js" "tests/**/*.test.js"`: 0 fail. `for f in $(git ls-files 'src/*.js' 'public/*.js'); do node --check "$f" || echo FAIL $f; done` prints no FAIL.
  2. Two boots in a row on a fresh empty `data/` in the scratch copy (`DISCORD_DISABLED=1 TWITCH_CLIENT_ID=x TWITCH_CLIENT_SECRET=x PORT=3124 node src/index.js`): `/health` 200, no `[DB migration]` line, exit 0 on SIGTERM, both times.
  3. Headless Chromium: `/dashboard/overlay` at 360 and 375 px in all 7 languages has no horizontal scroll; at 1280 px in English the layout matches `main`.
  4. Review the branch's tests against items 1-5, 7-9 of the brief: each item has a test (9 is the browser check). Append the Team Activity Log entry to `CLAUDE.md` and commit it.
- **Decisions that apply:** never change `package.json`, `package-lock.json` or `node_modules` in the repo; run the suite on a scratch copy with `npm rebuild better-sqlite3`.
