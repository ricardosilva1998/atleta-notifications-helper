# Plan: Coaching booking in steps and My bookings

Brief: `brief.md`

Choosing agents: use the team agent whose lane fits (`frontend-dev`, `backend-dev`, `team-security`, `team-qa`, `team-ux`), if the project has them. Use `general-purpose` for work outside every lane, such as docs or scripts, or where no team agents are installed.

Every worker runs on `sonnet`. Tasks run one at a time. No task pushes or deploys: the ship session does that after review.

## Shipping
- **Ship:** yes (the brief: branch + PR, CI must pass, the owner merges).
- **Where:** branch `feat/coaching-wizard-my-bookings` (T1 creates it from `main`; every task commits on it, none pushes). Ship pushes it and opens the PR; the owner runs `! gh pr merge <n> --admin --merge` in the main pane; the merge to `main` deploys to Railway.
- **Checks before push:** the unit suite `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` (on a scratch copy with `npm rebuild better-sqlite3`; never change package files) and two boots on a fresh DB with `DISCORD_DISABLED=1` (`/health` 200, no `[DB migration]`, exit 0 on SIGTERM), as CI does.
- **Verify live:** `/health` 200; deploy logs show no `[DB migration]` and no `LOGIN REFUSED`; `https://atletanotifications.com/coaching/ricardobsilva98` opens on its first step; `https://atletanotifications.com/my-bookings` answers 200 (signed out: Connect Discord).

## Decisions taken in planning (from the brief's open questions; main approves them with the plan)
- URL is **`/my-bookings`**. A streamer signed in to the site sees their own bookings as a viewer there (today's `req.viewer` rule: a viewer session wins, else the streamer's Discord account).
- The coach's page loses its "Your bookings" list: in its place a short line "You have N bookings with <coach> — My bookings" linking to `/my-bookings`. The booking actions (pay, withdraw, reschedule) live only on My bookings.
- My bookings calls the existing per-booking routes `/coaching/<coachLogin>/bookings/:id/...` (no new action routes); it gets each booking's coach login from a new read route.
- The PayPal return (`/coaching/:username/paid`) keeps its route and checks; only its redirect moves to `/my-bookings?booking=<id>&paid=1` (or `&error=<code>`).
- My bookings is a standalone page like `coaching.ejs` (no `header.ejs`, whose login would make a streamer).
- Do not touch `.cd-tabs`/`.cd-tab` or anything in `coaching-dashboard.ejs` (PR #16).

## Tasks

### T1: Viewer sign-in without a coach, and the My bookings read routes
- **What:** On a new branch `feat/coaching-wizard-my-bookings` from `main`:
  1. `GET /auth/coaching-signin` works without `?for=`: then `oauth_purpose` is `coaching:` (empty login) and the callback's coaching branch creates the viewer session as today and redirects to `/my-bookings` (with `for` it still redirects to `/coaching/<login>`). An invalid `for` still answers as today. `POST /auth/coaching-signout` without `for` redirects to `/my-bookings`.
  2. New `db.getViewerBookingsAllCoaches(discordUserId, sinceMs)`: every booking of that viewer with every streamer, `starts_at >= sinceMs` (use since = now − 90 days, the retention), joined to `streamers` for the coach's `twitch_username`, display name and avatar, and whether the coach can be booked now (not disabled, coaching settings present). Uses the existing `idx_coaching_bookings_viewer` index. All SQL in `db.js`.
  3. New router `src/routes/myBookings.js` mounted at `/my-bookings` in `server.js`: `GET /my-bookings` renders view `my-bookings` (the view itself is T3; render it with `{ viewer, lang, data }` and add a minimal placeholder `src/views/my-bookings.ejs` that T3 replaces, satisfying the csrf/scriptEmbeds tests) and `GET /my-bookings/state` (JSON: `{ viewer, bookings: [...] }`, each booking = `coachingBookings.bookingViews(..., { forViewer: true })` plus `coach: { login, name, avatar, available }`; no payer details; 401 `{ ok:false, error }` without a viewer). Signed out the page renders its Connect Discord state (link `/auth/coaching-signin`).
  4. `GET /coaching/:username/paid`: after `coachingPayments.handleReturn` redirect to `/my-bookings?booking=<id>&paid=1`, or `?booking=<id>&error=<code>` (keep `&order=<id>` for `pay_unconfirmed`, `error=late` as today). Payment verification untouched.
  5. Tests: extend `src/routes/auth.test.js` (sign-in without `for` → `/my-bookings`; signout without `for`), a db test for the new query (pattern `src/db.coaching.test.js`), `src/routes/myBookings.test.js` (own bookings only across two coaches, other viewers' never shown, no payer fields, 401 signed out, streamer-as-viewer), update `src/routes/coaching.test.js` `/paid` redirect assertions.
  6. Any new user-facing text goes into all 7 locales (pt is pt-PT) via `node scripts/locale-keys.js`.
- **Files:** `src/routes/auth.js`, `src/db.js`, `src/server.js`, new `src/routes/myBookings.js`, new `src/views/my-bookings.ejs` (placeholder), `src/routes/coaching.js` (`/paid` only), `src/services/coachingBookings.js` (read only, reuse `bookingViews`), tests named above, `src/locales/*.json`.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** none
- **Verify:** on a scratch copy (`npm rebuild better-sqlite3` there): `node --test src/routes/auth.test.js src/routes/myBookings.test.js src/routes/coaching.test.js src/db.coaching.test.js tests/i18n.test.js src/csrf.test.js tests/scriptEmbeds.test.js` all pass. Commit on the branch.
- **Decisions that apply:** accounts are Discord login only, no passwords; sign-in must work without a coach login in the URL; payments verification, rooms and reschedule/refund rules unchanged; Racing code untouched; payer details never reach a viewer.

### T2: Every Discord message to a viewer links to My bookings
- **What:** In `src/services/coachingBookings.js` / `coachingMessages.js`, every DM to a viewer carries a link to `${APP_URL}/my-bookings?booking=<id>` (accepted, confirmed, acceptedPay "pay here", declined, cancelled, expired, refunded, reschedule proposed/ask/proposal/lapsed/agreed, notRescheduled). Where a message today links to the coach's page to book again (`pickAnother`), keep that link and add the My bookings one. Link texts through the existing message helpers; no mentions; new texts in all 7 locales (pt-PT). Coach DMs unchanged.
- **Files:** `src/services/coachingBookings.js` (`bookingUrl`, `bookingLinkOf`), `src/services/coachingMessages.js` (`viewerMessage`, `rescheduleLines`), their tests (`src/services/coachingBookings.test.js`, `coachingMessages` tests if present), `src/locales/*.json`.
- **Agent:** backend-dev
- **Model:** sonnet
- **Depends on:** T1
- **Verify:** scratch copy: `node --test "src/services/coaching*.test.js" tests/i18n.test.js` pass, with a test asserting each viewer message kind contains `/my-bookings?booking=<id>`. Commit.
- **Decisions that apply:** My bookings reachable from every Discord message Atleta sends a viewer; no change to the coach's side beyond these links.

### T3: The My bookings page and the home page entry
- **What:**
  1. `src/views/my-bookings.ejs` (standalone like `coaching.ejs`: its own `<head>` with `<%- include('csrf') %>` before the first script, JSON embeds ending `.replace(/</g, '\\u003c')`, same look/CSS tokens as `coaching.ejs`) and `public/js/my-bookings.js`, reusing `public/js/coaching-core.js` as is. Signed out: a short intro and Connect Discord (`/auth/coaching-signin`). Signed in: "Signed in as <name>" + sign out (POST `/auth/coaching-signout`), then **To come** and **Past** lists of every booking across coaches, each row with the coach's avatar and name (linking to `/coaching/<login>`), date/time in the viewer's zone, length, price, state, and the same actions the coach page gives today: Pay, Withdraw, reschedule panel (accept proposal, propose another, pick), room link, cancel reason, refund line. Move this code out of `public/js/coaching-page.js` (`drawBookings`, `drawRescheduleInfo`, `drawPanelFor`, `togglePanel`, `acceptProposal`, `sendProposal`, `withdraw`, `startPayment`, `showReturn`, `openLinked`), calling `/coaching/<booking.coach.login>/bookings/:id/...`; T4 removes the list from the coach page. `?booking=<id>` scrolls to that row (and opens the pick panel as today); `?paid=1` / `?error=` show the PayPal notice; `&new=1` highlights a just-sent request at the top ("Request sent, waiting for <coach>"). A row whose coach is no longer available shows its state but no actions. Data from `GET /my-bookings/state`; texts as one JSON object (a `PAGE_TEXT_KEYS`-style table in `src/routes/myBookings.js`) with a test that the script reads only texts it is handed and every handed text is read (pattern `src/routes/coaching.test.js` "the page script reads only texts the page hands it"). No innerHTML with user data.
  2. `src/views/home.ejs`: a viewer entry "Coaching bookings" → `/my-bookings` (e.g. a secondary button in the hero `.home-actions` or a short line before the language form), translated, with an icon and link text; must keep `src/server.home.test.js` green (no Racing, no OBS-overlay features, one h1, every link has text).
  3. New texts in all 7 locales (pt-PT) via `node scripts/locale-keys.js`.
- **Files:** `src/views/my-bookings.ejs`, new `public/js/my-bookings.js`, `public/js/coaching-page.js` (move code out), `public/js/coaching-core.js` (add pure helpers only if needed, with tests in `tests/coachingCore.test.js`), `src/routes/myBookings.js` (page texts), `src/routes/myBookings.test.js`, `src/views/home.ejs`, `src/server.home.test.js`, `src/locales/*.json`.
- **Agent:** frontend-dev
- **Model:** sonnet
- **Depends on:** T1, T2
- **Verify:** scratch copy: `node --test src/routes/myBookings.test.js src/routes/coaching.test.js tests/coachingCore.test.js src/server.home.test.js tests/i18n.test.js src/csrf.test.js tests/scriptEmbeds.test.js tests/headerView.test.js` pass; run the site with `DISCORD_DISABLED=1 TWITCH_CLIENT_ID=x TWITCH_CLIENT_SECRET=x node src/index.js` on a scratch data dir and load `/my-bookings` signed out (200, Connect Discord, no console errors). Commit.
- **Decisions that apply:** My bookings shows every booking of the viewer with every coach (to come and past) with Pay, Withdraw/Cancel, reschedule answers, room link, refund state; reachable from the home page; home names no Racing and no OBS-overlay feature; no password accounts.

### T4: The booking page as a four-step wizard
- **What:** Rework `src/views/coaching.ejs` + `public/js/coaching-page.js` into steps, each filling the page with a "Step N of 4" bar and Back; the next step appears only when the current one is done:
  1. **Connect Discord** (signed out; today's intro + Connect Discord).
  2. **Join the server**: invite + "I've joined / Check again" (`/state?recheck=1`); Next only when `member === true`. When membership is unknown (`member === null`) keep today's rule: the viewer may go on with today's warning (`#cz-unverified`).
  3. **Length**: the lengths with prices; a viewer at the upcoming/24 h limit sees today's limit message here.
  4. **Date, time and message**: days, free times in the viewer's zone, the optional note (300 characters, today's prompt "What do you want to work on?"), **Send request**. On success go to `/my-bookings?booking=<id>&new=1`.
  A viewer signed in and a member starts at step 3. Paused/not bookable pages show today's paused text instead of the steps. Back never loses the chosen length/time. The "Your bookings" list is replaced by one line "You have N bookings with <coach> — My bookings" (link `/my-bookings`) when N > 0 (N from `/state`'s `bookings`, kept on the route). Keep the "booking as … / not you?" bar. Update `PAGE_TEXT_KEYS` in `src/routes/coaching.js` to exactly the texts the script reads (the test "the page script reads only texts the page hands it" must pass); drop texts no longer used from the table (leave locale keys only if still read somewhere; remove unused ones from all 7 locales). Steps are keyboard reachable, focus moves to the step heading on change, works at 360 px.
- **Files:** `src/views/coaching.ejs`, `public/js/coaching-page.js`, `public/js/coaching-core.js` (pure step logic, e.g. `stepFor(state)`, with tests in `tests/coachingCore.test.js`), `src/routes/coaching.js` (texts only), `src/routes/coaching.test.js`, `src/locales/*.json`.
- **Agent:** frontend-dev
- **Model:** sonnet
- **Depends on:** T3
- **Verify:** scratch copy: `node --test src/routes/coaching.test.js tests/coachingCore.test.js tests/i18n.test.js src/csrf.test.js tests/scriptEmbeds.test.js` pass, including new `stepFor` tests (signed out → 1; member false → 2; member true or null → 3). Commit.
- **Decisions that apply:** one step at a time, 1 Connect, 2 Join (validated), 3 Length, 4 Date/time/message then send; message stays optional with the same prompt; after sending the viewer lands on My bookings with the request on top as waiting; membership unknown keeps today's rule.

### T5: Security pass
- **What:** Review `git diff main...HEAD`: the coach-less sign-in (open redirect, purpose cookie parsing), `/my-bookings/state` (only the signed-in viewer's bookings, no payer details, no other viewer's data, disabled coaches), CSRF on the new page's posts, the `/paid` redirect (only whitelisted codes and numeric ids in the URL), DM links (no user text in URLs), script rendering (no innerHTML of user data). Fix what is found, with tests. Append to the Team Activity Log in `CLAUDE.md`.
- **Files:** the diff; fixes in the files it names.
- **Agent:** team-security
- **Model:** sonnet
- **Depends on:** T4
- **Verify:** scratch copy: full unit suite `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` 0 failures. Commit.
- **Decisions that apply:** payer details only to the booking's coach; no change to payment verification.

### T6: UX check at 360, 768 and 1280 px
- **What:** Run the site on a scratch copy (Discord, PayPal stubbed as in earlier QA harnesses in the gitignored `.superpowers/sdd/`), seed a viewer with bookings across two coaches in several states, and check the wizard (each step, Back, step bar, focus, touch targets ≥ 44 px, text areas 16 px) and My bookings (lists, actions, reschedule panel, notices) at 360/768/1280: no horizontal scroll, readable, consistent with `coaching.ejs` tokens. Fix layout/CSS in `coaching.ejs`, `my-bookings.ejs` and their scripts only. Screenshots to the scratchpad. Append to the Team Activity Log.
- **Files:** `src/views/coaching.ejs`, `src/views/my-bookings.ejs`, `public/js/coaching-page.js`, `public/js/my-bookings.js`, `src/views/home.ejs` (the new entry only).
- **Agent:** team-ux
- **Model:** sonnet
- **Depends on:** T5
- **Verify:** screenshots at three widths for each wizard step and My bookings with no horizontal scroll; targeted tests still pass (`node --test src/routes/coaching.test.js src/routes/myBookings.test.js src/server.home.test.js`). Commit.
- **Decisions that apply:** clearer, especially on a phone; don't touch `.cd-tabs`/`.cd-tab`.

### T7: Docs and plan copy
- **What:** Update `docs/features/coaching.md` ("The viewer's side": the four steps; "The viewer's sign-in": coach-less sign-in; a new "My bookings" section; "The Discord messages": links; "Payment": the return lands on My bookings; "Routes"; "Tests"), `CLAUDE.md` (Coaching bullet, Project Structure: `routes/myBookings.js`, `views/my-bookings.ejs`, `public/js/my-bookings.js`; Homepage bullet mentions the coaching bookings entry), `docs/operations/deploy.md` (a short release note: no schema change, what to check live). Copy `plan.md` to `docs/superpowers/plans/2026-11-16-coaching-booking-in-steps-and-my-bookings.md`. Append to the Team Activity Log.
- **Files:** those named.
- **Agent:** general-purpose
- **Model:** sonnet
- **Depends on:** T6
- **Verify:** `git diff --stat` shows the docs; `grep -n "my-bookings" CLAUDE.md docs/features/coaching.md` finds the new parts. Commit.
- **Decisions that apply:** docs follow the code as built.

### T8: QA
- **What:** On a scratch copy (Node 26, `npm rebuild better-sqlite3` there; never change package files): the full unit suite, two boots on an empty `data/` with `DISCORD_DISABLED=1` (`/health` 200, no `[DB migration]`, exit 0 on SIGTERM), and a headless walk at 1600 and 375 px with Discord/PayPal stubbed: signed-out booking page → step 1; viewer not a member → step 2, Next disabled until Check again sees membership; unknown membership → warning, may go on; step 3 → 4 → Send lands on `/my-bookings?booking=<id>&new=1` with the request on top as waiting; My bookings across two coaches: Pay (return lands on My bookings with the notice), Withdraw, reschedule pick/accept, cancelled reason, refund line; home page entry → `/my-bookings` → Connect Discord → (stubbed) sign-in → My bookings; DM texts link `/my-bookings?booking=`. Append to the Team Activity Log.
- **Files:** none in the repo beyond the log (harness in gitignored `.superpowers/sdd/2026-11-16-coaching-booking-in-steps/`).
- **Agent:** team-qa
- **Model:** sonnet
- **Depends on:** T1, T2, T3, T4, T5, T6, T7
- **Verify:** `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` 0 failures; both boots pass; walk checks all pass. Commit the log entry.
- **Decisions that apply:** all of the brief's decisions.

## Added by main at approval
- No test may depend on the time of day: CI runs at any hour, and the previous coaching run's CI failed once at 16:40 UTC on a test that booked `Date.now() + 24 min` and collided with a free time. Use fixed or injected clocks (or a second streamer) for anything about free times, holds or deadlines; T8 runs the new coaching tests at several faked clock times across a day.
