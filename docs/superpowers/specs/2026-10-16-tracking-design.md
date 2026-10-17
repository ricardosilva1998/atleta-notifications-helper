# Tracking: follower and sub goal bars, and trackers — design

Date: 2026-10-16. Status: draft for the owner's approval. One of three designs from the same brainstorm (with `2026-10-16-emote-wall-design.md` and `2026-10-16-stream-report-design.md`).

## Why

Streamers have a tip goal bar but nothing for follows or subs, and no small "latest follower / latest sub" sources for their scenes. The owner wants both, as on-stream sources managed from one place.

## Goals

- A **follower goal** and a **sub goal**, each its own OBS browser source, working like today's tip goal.
- **Trackers**: small individual OBS sources — Latest follower, Latest sub, Latest tip, Latest raid, Latest bits, Top tipper this stream.
- One **Tracking** page on the dashboard that holds them all.

## Non-goals

- No change to the tip goal, its page, its source or its card.
- No chat or Discord announcements when a goal is reached (the tip goal has none either).
- No new alert types on the alert overlay.

## Anti-goals

- A goal or tracker that shows a wrong number after a restart or an OBS reload.
- Goal bars that look unlike the tip goal bar (the owner: "similar to what we have with the donation goal").

## The goals (the owner's decisions)

- **Same as the tip goal**, for follows and for subs: start (title, target, bar colour), edit, nudge by hand (+/−), end; past goals listed; test buttons that play on the live bar and revert after 10 s; a celebration when reached (confetti and glow, as `goal.js` plays it), after which the bar stays full until ended. One active follower goal and one active sub goal per streamer, independently.
- **Period, chosen when the goal starts:** lifetime, yearly, monthly, weekly, daily, or a number of hours.
  - **Lifetime** — the channel's total from Twitch: followers (`GET /channels/followers` `total`) and current subs (`GET /subscriptions` `total`), moved live by events and re-read from Twitch now and then (my call: at most every 10 minutes while a source is open, and when the goal starts) so it does not drift.
  - **Yearly / monthly / weekly / daily** — only follows or subs in that period. The streamer also chooses **calendar** (this week from Monday, this month from the 1st…, in the goal's time zone, starting over automatically when the period ends, same target) or **rolling** (the last 7 days, last 30 days…: an event drops out when it gets older than the window).
  - **Hours** — counted from the moment the goal starts, for that many hours; then the goal ends by itself and joins past goals.
- **What counts:** a follow counts once per account (a re-follow inside the window does not count twice — my call); a sub, a resub and each gifted sub count one each (my call; tier 2/3 count as one).
- **Time zone:** chosen on the goal (my call), defaulting to the browser's; the app stores no time zone today.

## Where the numbers come from

- **Follows in a period** can be counted back from Twitch (each follower has `followed_at`), so a monthly goal started on the 16th already includes the 1st–15th. Paging is costly for big channels: my call — read back at most 5,000 followers (50 pages); past that the goal starts from what Atleta has recorded and the setup says so.
- **Subs in a period cannot** be read back (Twitch lists current subs, not when they subbed). They count from Atleta's own record. The setup screen says when a sub goal cannot see the whole period.
- **Atleta's own record** (new): every follow and sub event (from the EventSub handler that already logs `overlay_events`) also goes into a new table kept at least **400 days** (rolling yearly goals need a year; `overlay_events` keeps 30 days). It stores the streamer, the kind, the Twitch user id (follows need it for de-duplication; EventSub's follow carries `user_id`, which `normalizeEvent` drops today), the count (a gift of 5 is 5) and the time.
- Lifetime and follower read-backs use the broadcaster token with refresh, the way `getFollowAge` does (`refreshBroadcasterTokenShared`); the existing `getFollowerCount`/`getSubscriberCount` do not refresh. A missing scope (`moderator:read:followers`; `channel:read:subscriptions` is requested but never checked today) shows the "Reconnect Twitch" state on the goal instead of a number.

## The trackers

- **Which:** Latest follower; Latest sub (with "x months" or "gifted by X"); Latest tip (name and amount, from PayPal and StreamElements as the tip goal counts them); Latest raid (name and viewers); Latest bits (name and amount); Top tipper this stream (resets when a new stream starts; tips in different currencies are not added together — the top is per the streamer's donation currency, my call).
- **Each one:** its own OBS source; it updates the moment the event happens with a short slide-in; it keeps showing the last value after a restart or reload (stored, not waiting for the next event). The look is a compact version of the goal card (small title above, value below, the streamer's colour), so trackers and goal bars match.

## The Tracking page

- A dashboard page (my call: `/dashboard/tracking`, linked from the OBS overlay working card next to the Overlay Builder), cards in the Atleta style: the follower goal, the sub goal, then one card per tracker. Each card: a live preview (a token-less demo like `/overlay/goal-demo`), its OBS link with Copy, on/off, its look settings (colour), and for goals the goal controls above.
- Hidden, with its routes redirecting, while `features.overlays` is off (as the other overlay pages).

## Constraints

- The project's rules in `CLAUDE.md`: texts through `t()` in all seven locales, JSON embeds escaped, CSRF on every POST, every outbound call with a deadline, in-memory caches swept, new streamer columns through the migration loop, no `require()` in EJS.
- The new sources follow the tip goal's pattern: SSE at `/overlay/<kind>/events/:token` with a heartbeat, `holdStream`, `endStreamWhenAccountDisabled`, their own bus channels (never `overlay:<id>`, which queues unknown types as alerts).
- Account removal deletes the new rows (`STREAMER_OWNED_ROWS`).

## Left to the builder

The new tables' exact shape, the route names besides the page, how the goal page's controls are split between the page and an optional working card, the slide-in animation, the re-read schedule within "at most every 10 minutes".

## Decisions after the builder check

The owner (2026-10-16): **period sub goals** (yearly, monthly, weekly, daily, hours) count new subs, gifted subs and resubs the viewer announces in chat; a silent renewal sends Atleta no event and is not counted, and the setup screen says so. Lifetime sub goals use Twitch's real total (re-read, so ended subs come off too).

Calls made while writing this (the owner may overrule):
- **When a stream starts and ends:** every enabled streamer's own linked channel is checked by the live poller every minute, watched by a server or not (shared with `2026-10-16-stream-report-design.md`); a stream ends on the second empty check, so a short drop does not start a new one. "Top tipper this stream" resets at a new stream.
- **Calendar goals:** one goal whose count runs per period; at the period's end that period is written to past goals marked reached or missed, and the bar starts over for the next period with the same target. A manual nudge applies to the current period only. "Stays full until ended" applies to lifetime and hours goals, not across a calendar rollover.
- **Rolling goals:** the bar shows the live count of the window, which can fall back under the target; the celebration plays once, on the first crossing, until the goal is ended or edited.
- **Hours goals:** end by themselves at their end time and join past goals (reached or missed).
- **Event connection:** an active goal or tracker is a reason to keep the streamer's EventSub connection running (alongside the overlay and the chatbot); the Tracking sources do not depend on `overlay_enabled`, which switches alerts only. Gaps (socket down, scopes cleared) are accepted; follower goals heal on their next Twitch read-back, sub goals do not.
- **Sub type** (new, resub, gift) is stored explicitly in the new record from now on (the stream report reads it too).
- **Trackers' last values** live in their own store (one row per streamer and tracker); at release they are filled from what Atleta already has (`overlay_events`' last 30 days and `donations`), else empty until the next event.
- **Latest tip** shows a tip in any currency. **Top tipper** groups donor names case-insensitively, leaves "Anonymous" out, and ranks only tips in the tip page's currency (never adding currencies).
- **Linking another Twitch account** (`accountLifecycle.twitchAccountChanged`) ends that streamer's active goals and clears the trackers, so nothing shows another channel's numbers.
- **Channels that are not Affiliate or Partner:** the sub goal and the Latest sub tracker show "not available" (the `cp_affiliate_status` way the rewards and polls cards use).
- Follower read-back capped at 5,000; time zones checked against the IANA names; one SSE endpoint per source.
