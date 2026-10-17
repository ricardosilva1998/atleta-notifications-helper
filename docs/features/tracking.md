# Tracking (follower and sub goal bars, and trackers)

Tracking gives a streamer two goal bars and six small "latest" sources for their scenes, all managed from one page,
`/dashboard/tracking`. Every one is an OBS browser source of its own, drawn like the tip goal bar and kept apart from
the alert overlay.

Design: `docs/superpowers/specs/2026-10-16-tracking-design.md` (its last section, "Decisions after the builder check",
settles calendar rollover, rolling goals, sub counting, the trackers' storage, account changes and non-Affiliates);
plan: `docs/superpowers/plans/2026-10-16-tracking.md`.

## The sources

Each source is a page plus a server-sent-events stream of its own, found by the streamer's overlay token (the same
token as `/overlay/<token>`). `?lang=<lang>` picks the language of its texts (the Tracking page adds it to the links it
shows).

| Source | Page | Stream |
|---|---|---|
| Follower goal | `/overlay/goal/followers/<token>` | `/overlay/goal/followers/events/<token>` |
| Sub goal | `/overlay/goal/subs/<token>` | `/overlay/goal/subs/events/<token>` |
| Latest follower, Latest sub, Latest tip, Latest raid, Latest bits, Top tipper | `/overlay/tracker/<tracker>/<token>` | `/overlay/tracker/<tracker>/events/<token>` |

`<tracker>` is `latest_follower`, `latest_sub`, `latest_tip`, `latest_raid`, `latest_bits` or `top_tipper`; any other
name answers 404, as does an unknown or regenerated token. A disabled account's links answer like an unknown token and
its open streams are ended. Each stream sends `config` first, then what the source shows now, then the changes, with a
30-second heartbeat; a tracker source passes only its own tracker's events.

Two token-less previews are driven by `postMessage` from the Tracking page (as `/overlay/goal-demo` is from the
donations page): `/overlay/goal-demo/tracking` and `/overlay/tracker-demo`.

The sources run on their own bus channels, `trackgoal:<streamerId>:<follow|sub>` and `tracker:<streamerId>`, never on
`overlay:<id>` (the alert overlay queues any unknown type there as a card). They do not depend on `overlay_enabled`,
which switches alerts only: a goal or tracker works with the alert overlay off. Browsers allow six HTTP/1.1
connections to a host and each open source holds one, which only matters when many sources are opened as tabs of one
browser (OBS gives each source its own).

`public/overlay/tracking.js` and `tracking.css` draw all eight (the goal bar is `goal.css`'s `.goal-card`, same markup,
`--goal-color`, stripes, `+N` pop, confetti and glow on reaching; a tracker is a compact card: a small title, the
value, the tracker's colour, a slide-in when it changes). Everything the server sends (titles, viewers' names) is set
as text.

## Goals

One active follower goal and one active sub goal per streamer, independently (`tracking_goals`, one row per goal;
starting another ends the previous of its kind). A goal has a title (at most 60 characters), a target (whole number,
1 to 10,000,000), a bar colour (`#rrggbb`), a period and, where it applies, a mode, a time zone and hours. The page
starts, edits (title, target, colour), nudges (+1, -1 or any whole number), ends and tests a goal, and lists the past
ones. `src/services/trackingGoals.js` holds it all; `src/services/goalPeriods.js` is the pure window arithmetic.

### Periods and modes

| Period | What it counts |
|---|---|
| `lifetime` | the channel's total from Twitch |
| `year`, `month`, `week`, `day` | the follows or subs inside the period, in `calendar` or `rolling` mode |
| `hours` | what happens from the moment the goal starts, for that many hours (1 to 720) |

- **Calendar** is the local period that contains now, in the goal's own IANA time zone: this year from 1 January, this
  month from the 1st, this week from Monday, this day from 00:00. The zone is chosen on the goal (the page offers the
  browser's, `Intl.DateTimeFormat().resolvedOptions().timeZone`) and stored under `Intl`'s canonical name
  (`canonicalTimeZone` in `goalPeriods.js`: `europe/lisbon` is stored as `Europe/Lisbon`, `US/Pacific` as
  `America/Los_Angeles`; its formatters are kept once per canonical zone); a name `Intl` does not know answers
  `bad_zone`. Boundaries are local midnight, DST days included (a day when the clocks go back lasts 25 hours).
- **Rolling** is the last 365, 30, 7 or 1 days up to now (`ROLLING_DAYS`): an event drops out when it gets older than
  the window, so the bar can fall back under the target.
- **Rollover.** A calendar goal is one goal that counts per period. The minute tick (`trackingGoals.startTicks()`,
  started from `src/index.js`) writes a period that has ended into `tracking_goal_periods` (reached or missed, with
  its count and target) and starts the next with the same target; a manual nudge applies to the current period only
  (a rollover resets it). A goal that was stopped for a long time catches up period by period (at most 400 in one
  tick).
- **Hours** goals end by themselves at `started_at + hours` (the tick) and join the past goals, reached or missed.
- **Ending.** A goal that ends (End on the page, the end of its hours, a new goal of its kind replacing it, or another
  Twitch account linked) keeps the count it showed then (`tracking_goals.final_count`; null when it showed no number,
  "Reconnect Twitch" or "not available"). The past goals list it as "count / target".
- **Reached.** The first time the count passes the target the goal is stamped (`completed_at`) and the sources play the
  celebration once. A lifetime or hours goal then stays full until ended (or until an edit changes the target); a
  calendar goal starts over at its rollover; a rolling goal keeps its celebration but follows its live count.

### Where the numbers come from

- **Lifetime.** Twitch's own total: followers (`GET /channels/followers`, `total`) or current subscribers
  (`GET /subscriptions`, `total`, the broadcaster's own sub included, as the milestones read it). The goal shows that
  total, plus what Atleta recorded since that read (follows and new or gifted subs; a resub is already in Twitch's
  total), plus the nudge. The total is read when the goal starts and again at most every 10 minutes while one of the
  goal's sources is open, so ended subs come off and the number does not drift. A read Twitch does not answer keeps the
  last total.
- **Atleta's record** (`tracking_events`, kept 400 days, cleaned every 6 hours by `db.cleanupOldTrackingEvents()`;
  its index `(streamer_id, kind, created_at, twitch_user_id)` covers a follow count, so a count never reads the rows).
  Every follow and sub that EventSub delivers is also written there: the kind, the sub type (`new`, `resub`, `gift`),
  the Twitch user id, the name, a count (a gift of 5 is 5) and the time. `overlay_events` only keeps 30 days, which is
  why the record exists. A follow counts once per account (a re-follow inside the window does not count twice); a sub,
  each gift and a resub the viewer announces in chat count one each (a tier 2 or 3 sub counts as one).
- **Period goals** count the record inside the goal's window, plus the nudge.
- **Follower read-back.** Twitch lists followers with `followed_at`, so a follower goal of a year, month, week or day
  reads back the follows of its window that the record lacks (they are recorded once, so starting a goal again does not
  double them): in the background when the goal starts, again at most every **30 minutes** while one of its sources is
  open, and after each calendar rollover. An answer that comes back after the goal ended, or after the streamer linked
  another Twitch account, is dropped: nothing is written. The read is capped at **5,000 followers (50 pages of 100)**; past that the
  goal counts from what Atleta recorded while its window reaches back before its start, and the follower card says so
  (`capped`).
- **Subs cannot be read back** (Twitch lists current subs, not when they subbed). A period sub goal counts from the
  record only. Resubs and gifts that EventSub delivers count; a **silent renewal** (Twitch sends Atleta no event) is not
  counted, and the sub goal's card says so. Lifetime sub goals use Twitch's real total instead.
- **Unavailable, never 0.** A broadcaster token without `moderator:read:followers` (or `channel:read:subscriptions`),
  or a refresh token Twitch refuses, shows "Reconnect Twitch" on the goal (`needs_reconnect`); a channel without subs
  (Twitch answers 400 or 403 on subscriptions) shows "not available" (`not_affiliate`, the way the rewards and polls
  cards do) on the sub goal and the Latest sub tracker. A goal never draws a number it does not have, and an
  unavailable goal is never drawn full.
- **Twitch reads** (`followerTotal`, `subscriberTotal`, `followersSince` in `src/services/twitch.js`) use the
  streamer's own broadcaster token with the shared refresh (`refreshBroadcasterTokenShared`: a token past its expiry
  is refreshed first, a 401 refreshes once), 10 s per request. They reject with a `code`: `needs_reconnect`,
  `not_affiliate` or `twitch_failed` (no answer in time, no network, 429, 5xx). A lifetime goal cannot start without the
  total: its start is refused with `twitch_failed`, and the page says "Twitch did not answer. Try again in a moment."
  The start's read has **one 15 s deadline** for all of it, a token refresh and the retry included (the totals take a
  `signal`, which ends the requests and the wait for the refresh), so the start always answers before the page gives up
  at 20 s.

### Tests on the live bar

The Test buttons (a few more, reach the goal, reset) play on the page's preview and on the live OBS bar without saving
or counting anything, and revert by themselves after 10 seconds (`sendTest`/`endTest`, as the tip goal does). They
share the dashboard's per-streamer test cooldown of 5 seconds (`too_fast` answers how long to wait).

## Trackers

Six trackers, each with an on/off switch and an optional colour (`tracker_settings`; no colour of its own is the Atleta
purple). A tracker keeps its last value (`tracker_values`, one row per streamer and tracker), so a restart or an OBS
reload shows the same thing; its source hides itself while it is switched off or has nothing yet (the page's preview
shows a sample until the first value comes).

| Tracker | Shows | Fed by |
|---|---|---|
| Latest follower | name | `channel.follow` |
| Latest sub | name, with "x months" or "gifted" | subscribe, resub message and gift events |
| Latest tip | name and amount, any currency | PayPal and StreamElements tips, once `db.logDonation()` wrote a new row (a replayed tip never reaches it) |
| Latest raid | name and viewers | `channel.raid` |
| Latest bits | name and amount | `channel.cheer` |
| Top tipper | name and total this stream | worked out from the donation history, never stored |

**Top tipper** counts tips in the tip page's currency (`donation_currency`) only, never adding currencies together,
groups donor names case-insensitively ("Bob" and "bob" are one donor), and leaves "Anonymous" out. "This stream" starts
when the streamer's own channel went live (`channel_state.stream_started_at`); once the stream is over it keeps showing
that stream (`last_stream_started_at`, kept until the next stream starts), so a new stream resets it; with no stream
ever seen it uses the last 12 hours. When the live poller sees a stream start (a new broadcast, or another replacing
it), every enabled streamer linked to that login gets the new stream's top tipper at once (`trackers.streamStarted()`,
from `src/pollers/manager.js`), so a source opened before going live does not keep the last stream's donor until the
first tip. The stream start comes from the live poller, which since this release also checks
every enabled streamer's own channel (below).

`src/services/trackers.js` holds the trackers (`onEvent` for the Twitch events as `eventsub.js` normalizes them,
`onTip` for tips); `clear()` empties a streamer's values.

## What feeds them: EventSub kept running

Follows, subs, bits and raids reach Atleta through the streamer's EventSub connection. That connection already runs for
a streamer whose alert overlay or chatbot is on; an **active goal or a switched-on tracker is a reason to keep it
running too** (`trackingInUse()` in `src/routes/dashboard.js`, read by `syncLiveConnections` and by
`db.getOverlayOrChatbotStreamers()`, which the managers read at boot). The Tracking routes start and stop it when the
first goal or tracker comes on and the last goes off. Gaps (the socket down, scopes cleared) are accepted: follower
goals heal on their next Twitch read-back, sub goals do not.

`eventsub.js` keeps the follower's `user_id` (de-duplication), marks the sub type, and after logging the event calls
`trackingGoals.recordEvent()` and `trackers.onEvent()`, each in its own `try`, so the chat thank-you after them goes
out whatever they do; tips call `trackers.onTip()` from `src/routes/tip.js` and `src/services/streamelements.js`.
Enabling a disabled account starts the connection again for Tracking too (`accountLifecycle.enableAccount` reads
`db.usesTracking`), as the boot and the dashboard do.

## Own-channel polling

`pollAllTwitchLive` (`src/pollers/manager.js`) now also asks about every enabled streamer's own linked channel, watched
by a server or not (`db.getEnabledStreamerTwitchLogins()`), so the stream's start is known for "Top tipper this stream".
A stream ends on the second empty check, so a short drop does not start a new one. What is posted (go-live, recap,
milestones) still goes only to a channel's watchers: an unwatched own channel only gets its `channel_state`.

## Account changes

`accountLifecycle.twitchAccountChanged()` (linking a different Twitch account, or having yours taken) ends the
streamer's active goals (each keeping the count it showed), then removes the streamer's whole record of follows and subs
(`db.deleteTrackingEvents`: a goal started later must not count the previous channel's), and clears the trackers, so
nothing shows another channel's numbers; an open source empties. A follower read-back still under way for the old
channel writes nothing when it answers.
Removing an account deletes the five Tracking tables' rows (`STREAMER_OWNED_ROWS`; `tracking_goal_periods` before
`tracking_goals`). Disabling one makes the sources answer like an unknown token.

## The Tracking card

The dashboard's Twitch tab has a **Tracking** working card of its own, after the OBS Overlay card (`views/cards/tracking.ejs`,
`public/js/dashboard-tracking.js`, its data from `trackingCard()` in `services/dashboardCards.js`, fed by `gatherCards()`
with the Tracking state and links; only while `features.overlays` is on):

- **Goal bars:** for the follower goal, the sub goal and the tip goal (moved here from the Donations card and page on
  2026-10-17; `services/tipGoals.js`, its OBS source `/overlay/goal/<token>`, its routes `/dashboard/api/tip-goal`), the running goal's bar (its colour, title, period, "count / target"
  or Reconnect / Not available), **Test** (the goal reached on the OBS bar for 10 s, `test: 'reach'`), copy the OBS link,
  **Edit** and **End goal**; with no goal running, copy the link and **Start a goal**. The bars are drawn by the script from
  the card's `data-goals` and again from each route's answer.
- **The goal pop-up** (`tpl-track-goal`): a live preview of the bar on a stream-like background, the title (with the
  kind's placeholder), the target with − / + and quick picks (followers 50, 100, 500, 1,000; subs 10, 25, 50, 100), five
  colour swatches and any colour; for a new goal also the period as chips (All time, Yearly, Monthly, Weekly, Daily,
  Hours), Calendar or Rolling with the time zone (the browser's by default) or the hours, and for a sub goal over a period
  the silent-renewals note. Edit changes only the title, target and colour. It calls the same routes as the page.
- **Trackers:** the six, each with its switch (`POST tracker/:tracker`), its last value (the name and its detail, an
  amount in its currency; "Not available" for Latest sub on a channel that is not an Affiliate), **▶** (a sample on its
  source for 10 s, `POST tracker/:tracker/test`) and copy the OBS link.
- The tip goal uses the same pop-up without the period: title, target (money, quick picks 50/100/250/500), colour, and
  for a new goal its currency (the six `TIP_GOAL_CURRENCIES`, the tip page's first) and what was already raised. Its Test
  is `POST /dashboard/api/tip-goal/test`; End is `POST /dashboard/api/tip-goal/end`.
- The foot links the Tracking page for the trackers' colours and the past goals. The Tracking page also holds the tip
  goal's full section (`views/sections/tip-goal.ejs`: preview and tests, edit with colour, the +/− correction, End, start
  with currency and starting amount, OBS link, currency warning, past goals); its forms post to
  `/dashboard/donations/goal*` and come back to `/dashboard/tracking#tip-goal`. The OBS links' token is only in the
  copy buttons and the card's data, never printed as text.

## The page

`/dashboard/tracking` (`views/tracking.ejs`, `public/js/tracking-page.js`; linked from the Tracking card's foot): a card for the follower goal, one for the sub goal, then one per tracker.
A goal card has a live preview, Test buttons, the start form (title, target, colour, period, mode, hours, time zone)
or the running goal's edit form, nudge and End, the OBS link with Copy, and the past goals (the last ten, each with
"count / target" (only the target for a goal that showed no number), its days and Reached, Missed or Ended: a
calendar goal ended in the middle of its period is Ended, not Missed, while each period it finished stays Reached or
Missed). A finished period's days are shown in the goal's time zone, its last day included (the route sends its end
as the last moment, 1 ms before the next period starts: September in Lisbon reads, in English, "Sep 1, 2026 – Sep 30, 2026"). A tracker card has its preview, switch, colour (with "default colour") and OBS link. With no linked Twitch
account the OBS links are replaced by a note and a link to set it up.

JSON routes under `/dashboard/api/tracking/` (all answer `{ ok: true, state }` or `{ ok: false, error }`, except the
test route: `{ ok: true, revertMs, message }` for a test, the message the live bar got, which the page draws in its
preview, and `{ ok: true }` for `reset`; the page refreshes from `GET state` every 30 s while its tab is shown): `POST goal/:kind` (start), `PATCH goal/:kind` (edit),
`POST goal/:kind/nudge`, `POST goal/:kind/end`, `POST goal/:kind/test`, `POST tracker/:tracker` (`{ enabled, color }`),
`POST tracker/:tracker/test` (the card's ▶: `trackers.sendTest()` shows `trackers.sampleValue()` named "Viewer" in the
page's language, amounts in the tip page's currency, on the source for 10 s and stores nothing; `{ ok: true, revertMs }`;
it shares the test buttons' cooldown) and `GET state`. Refusal codes: `bad_title`, `bad_target`, `bad_color`, `bad_period`, `bad_mode`, `bad_hours`,
`bad_zone`, `bad_delta`, `bad_switch`, `bad_test`, `not_found`, `too_fast`, `twitch_failed`. The page's texts come from
`window.TRACKING_TEXTS` (the `tracking.*` namespace in all seven locales), the sources' from `tracking.source.*`.

With `features.overlays` off the page redirects to `/dashboard` (`overlayPage`) and the card's link is hidden; the
sources keep serving a streamer who already has them, like every other `/overlay/*` source.

## Limits

- Title 60 characters; target 1 to 10,000,000 (whole numbers); colour `#rrggbb`; hours 1 to 720.
- Follower read-back at most 5,000 followers (50 pages), every 30 minutes while a source is open; lifetime total every
  10 minutes while a source is open, and at start.
- The record is kept 400 days (rolling yearly goals need a year).
- One active follower goal and one active sub goal per streamer; the page lists the last 10 past goals.
- Test: 5 s cooldown, reverts after 10 s.

## Release seeding

At the first boot of the release `_runOnce('tracking_seed_trackers')` fills `tracker_values` from what Atleta already
has: the newest `overlay_events` row of each kind (the last 30 days) and the newest `donations` row; it creates no goal.
Anything older stays empty until the next event.

## Tests

`src/services/goalPeriods.test.js` (windows at time-zone and DST boundaries), `src/db.tracking.test.js` (the record,
goals, periods, trackers, cleanup, seeding, account removal), `src/services/twitch.tracking.test.js` (reads, refresh,
refusal codes), `src/services/trackingGoals.test.js`, `src/services/trackers.test.js`, the EventSub, tip and
StreamElements tests (the feeds), `src/routes/overlay.tracking.test.js` (the sources), `tests/trackingClient.test.js`
(the source's script in a `vm`), `src/routes/dashboard.tracking.test.js` (the page and its routes),
`src/pollers/manager.test.js` and `src/services/accountLifecycle.test.js`. Run the unit suite as usual
(`node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"`).

The browser check (headless Chromium on a throwaway copy of the site and its database; Twitch stubbed, events fired
through the same service calls EventSub and the tip routes make): `/dashboard/tracking` at 1600 and 375 px, a monthly
calendar follower goal (Europe/Lisbon) and a lifetime sub goal, the Test buttons, every source opened in its own
browser and reloaded to the same values, a tracker recoloured and switched off and on.
