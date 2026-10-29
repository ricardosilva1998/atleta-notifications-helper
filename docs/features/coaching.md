# Coaching (booking sessions with a streamer)

A streamer who coaches (andre_vilela_ coaches iRacing drivers one-on-one in his Discord server) sets the hours he
coaches once, repeating every week. Viewers open one link, see the times still free, pick 30 minutes or 1 hour and
ask for a time. The streamer accepts or declines each request from one schedule, and Atleta tells both sides on
Discord. It is for every streamer on the site and is opt-in: a streamer has no booking page until they save their
hours the first time.

Design: `docs/superpowers/specs/2026-10-29-coaching-design.md` (its mockup:
`docs/superpowers/specs/assets/2026-10-29-coaching-mockup.html`); plan: `docs/superpowers/plans/2026-10-29-coaching.md`.

## How a booking goes

1. The viewer opens `/coaching/<twitch login>`, signs in with Discord, joins the streamer's coaching server if they
   are not in it, picks a time and presses **Request this time**. The time is **held at once**: nobody else can take
   it.
2. The streamer gets a Discord message about the request (while "Message me about new requests" is on) and sees it on
   the Coaching card and the schedule.
3. The streamer **accepts** it (the viewer gets a Discord message with the time and where the session happens) or
   **declines** it (the viewer is told, with the booking link).
4. Until it starts, the streamer can **cancel** a waiting or confirmed booking (the viewer is told), and the viewer
   can **cancel** their own (it becomes Withdrawn and the streamer is told).

A request nobody answered before its start time shows as **Not answered**. It is still stored as waiting; the state
is worked out when it is read (`coaching.bookingState`). Nobody is messaged about it.

| State | Stored | What it means |
|---|---|---|
| Waiting | `waiting` | asked for, held, not answered yet |
| Confirmed | `confirmed` | the streamer accepted it |
| Declined | `declined` | the streamer declined it |
| Cancelled | `cancelled` | the streamer cancelled it |
| Withdrawn | `withdrawn` | the viewer cancelled it |
| Not answered | never stored | still `waiting` when its start came |

Waiting and confirmed bookings hold their time (`coaching.HOLDING`); the other states free it. A booking that becomes
Withdrawn also frees the viewer's place under the limit.

## The rules

All of them are in `src/services/coaching.js`, which is pure: no database, no network, and the clock and the zone are
passed in.

- **Hours.** One window per weekday (Monday to Sunday), each with a switch and a start and end on the hour or the
  half hour, in the streamer's own IANA time zone.
  - They are stored as minutes of the day plus the zone. So 18:00 stays 18:00 local across a clock change, and the
    UTC instants move.
  - Before the first save the form starts from Monday to Friday, 18:00 to 22:00, in the browser's zone.
  - The zone is stored under `Intl`'s canonical name (`goalPeriods.canonicalTimeZone`, as Tracking does). A name
    `Intl` does not know answers `bad_zone`.
- **Days off.** Whole days in the streamer's zone, at most 60. Dates already past are dropped when the hours are
  saved.
- **Free starts** (`freeStarts`).
  - Starts fall on :00 and :30 inside the day's window.
  - A session must end by the end of its window: with 18:00 to 22:00 the last 1 h start is 21:00 and the last 30 min
    start is 21:30. A 1 h session needs both half hours free.
  - The page offers today and the next 13 days, counted in the streamer's zone.
  - A time can be booked until **1 hour** before it starts.
  - A time that overlaps a waiting or confirmed booking is left out, not shown crossed out.
  - A wall time the zone skips (the spring change) has no start; a time the zone repeats takes the earlier instant.
- **Limit.** At most **2** upcoming bookings (waiting or confirmed, not started) per viewer per streamer
  (`MAX_UPCOMING`).
- **Texts.** The viewer's note is at most **300** characters and "Where the session happens" at most **150**,
  counted in code points. Control characters, line breaks included, are removed and the text is trimmed. A longer text
  is refused (`bad_note`, `bad_where`), never cut.
- **Invite.** A `discord.gg/<code>` or `discord.com/invite/<code>` link, or the bare code (2 to 32 letters, digits or
  dashes; `parseInvite`).
- **Bookable** (`bookable`). All of these must hold:
  - the streamer's settings are saved and **Bookings open** is on;
  - the coaching server is still one of the streamer's claimed servers (`db.getGuildsForStreamer`);
  - the invite is set and not known to be dead.

  When one of them fails, the booking page says the streamer is not taking new bookings, and a request answers
  `not_open`.

### Two viewers at once

`db.createCoachingBooking` runs as one immediate transaction:
1. It counts the viewer's upcoming bookings (`limit`).
2. It looks for a waiting or confirmed booking of the streamer that overlaps the requested time (`taken`).
3. Only then does it insert.

Of two viewers asking for overlapping times at the same moment, exactly one gets it.

Before that, the service refuses a time that is not among the free starts it has just worked out (`bad_time`), so
`taken` only comes from a race. The page gives both codes the same text ("That time was just taken").

## The streamer's side

### The coaching page

`/dashboard/coaching` (`src/routes/coachingDashboard.js`, `src/views/coaching-dashboard.ejs`,
`public/js/coaching-dashboard.js`) sits behind the dashboard's login and disabled-account check. It has two cards.

**Schedule.**
- The bookings not over yet, grouped by day in the streamer's zone. Each shows its time, the viewer's Discord name
  and `@username`, its length, its note and its state.
- Actions:
  - a waiting request has ✓ (Accept) and ✕ (Decline, after a confirmation);
  - a confirmed session has Cancel (after a confirmation).
- Markers:
  - a booking that no longer fits the hours (a day off or a shorter window saved after it was made) is marked
    "Outside your hours";
  - a booking whose viewer Atleta could not message reads "Atleta could not message <name>: message them yourself."
- Below, the sessions of the last 30 days, newest first.
- The page reads the bookings when it loads, from 30 days back to 60 days ahead. It does not refresh while open; the
  card is the live surface.

**When I coach.**
- **Bookings open**: its switch sits in the card's head and saves as it moves.
- The seven weekday rows.
- The time zone (with the zone list `Intl` knows) and the days off.
- **Where we meet**:
  - the coaching server, picked from the streamer's claimed servers the bot is in, plus the saved one while the bot
    cannot see it;
  - the invite link;
  - "Where the session happens" (for example "the Coaching Room voice channel");
  - **Message me about new requests** (on by default).
- The booking link with Copy, and Save. The first save reads "Save and open bookings" and opens them.

What a save does:
- It checks everything that needs no Discord first, then asks Discord about the invite: a dead one answers
  `bad_invite`, one to another server `invite_other_server`, and no answer saves it unchecked.
- It never changes a booking, even when the hours change or a day off is added. It answers with the ids of the
  waiting or confirmed bookings that now fall outside the hours, and the page says so. The streamer cancels them
  himself if he wants to.
- It also stores the page's language (`lang`), which is the language of the streamer's own Discord messages.

The page's notes at the top cover three cases:
- no linked Twitch account (there is no booking page yet);
- no claimed server ("Add Atleta to your Discord server first");
- a dead invite ("Your invite no longer works: viewers cannot join", linking to the field).

### The Coaching card

The card sits on the dashboard's Twitch tab, after Giveaways. Its files are `views/cards/coaching.ejs` and
`public/js/dashboard-coaching.js`; its state comes from `coachingCard()` in `services/dashboardCards.js`, fed by
`coachingBookings.cardData()` in `gatherCards()`. It does not depend on the chatbot or on `features.overlays`.

- **Not set up:** one step, in this order:
  1. link Twitch (`/auth/twitch`);
  2. add Atleta to a Discord server (opens the Discord tab);
  3. set the coaching hours (`/dashboard/coaching`).
- **Set up:**
  - The status line, the first that applies:
    1. "Your invite no longer works";
    2. "N waiting for your answer", with an "N waiting" badge;
    3. "Open: viewers can book";
    4. "Paused: no new bookings".
  - Up to five waiting requests (name, length, time and note), each with ✓ and ✕. The badge counts them all; a sixth
    appears after a reload.
  - The next confirmed session, with "Atleta could not message <name>" when that is so.
  - The booking link with Copy and an open button.
  - The **Bookings open** switch (`POST /dashboard/api/coaching/open`; the newest value wins).
  - A tile to the coaching page.
- Times show in the browser's zone. After an answer, the status line and the badge follow from
  `GET /dashboard/api/cards`.

## The viewer's side

The booking page is `/coaching/<twitch login>` (`src/routes/coaching.js`, `src/views/coaching.ejs`,
`public/js/coaching-page.js`, with the pure helpers in `public/js/coaching-core.js`).

**Who can see it.**
- The streamer is found by their linked Twitch login, as the tip page does (`db.getStreamerByUsername`).
- An unknown name, a disabled account, or a streamer who never saved coaching hours answers 404 with "Coaching page
  unavailable.", in the same form `/tip/<unknown>` answers.
- The page stands alone like `tip.ejs`, with `csrf.ejs` in its `<head>` and no `header.ejs`. The site header's "Login
  with Discord" would sign a visitor in as a streamer.

**Signed out.** Anyone can look at the page. It shows:
- the streamer's picture and name, "Times in your time zone (<zone>)", and the 30 min / 1 h choice (1 h first, 30 min
  when only half hours are free);
- a strip of days with the empty ones dimmed, and the free times of the chosen day;
- **Sign in with Discord to book**.

**Times.** They are shown in the viewer's browser zone and grouped by the viewer's own days. A viewer far east of the
streamer can see a 15th day: Lisbon's 18:00 to 22:00 falls between 02:00 and 06:00 the next day in Tokyo.

**Signed in.**
- "Booking as <Discord name>" with "not you?". For a viewer it signs them out. For a streamer booking as their own
  account, it leads to the viewer sign-in instead.
- The note "What do you want to work on? (optional)" and **Request this time**.
- After a request: "Your time is held. Atleta will message you on Discord once <streamer> accepts it."
- At the limit, the request box gives way to "You have 2 upcoming bookings with <streamer>…".
- **Your bookings**: the viewer's own bookings with this streamer, from the last 30 days and to come, with their
  states. A waiting or confirmed one has Cancel until it starts.

**Join first.** Once a viewer is signed in, the page asks the bot whether they are a member of the coaching server.
- If not, it shows "Join <server> first", the streamer's invite as a button, and "I've joined" to ask again. **Request
  this time** appears only once they are in.
- If Discord cannot say (it is down or not ready), they can book, and the page says Atleta may not be able to message
  them.
- The check uses the bot's own view of the server, never the viewer's token (`isGuildMember`: the member cache, then
  one member lookup by id, 5 s at most).

**Paused.** When the page is not bookable (see Bookable above), it says "<streamer> is not taking new bookings right
now." and shows no times. A signed-in viewer still sees their bookings and can cancel them, and accept, decline and
cancel keep working for the streamer.

**Refreshing.** The page reads `GET /coaching/<login>/state`:
- once on load, for the membership;
- after every action and on "I've joined";
- when its tab is shown again after a minute away.

## The viewer's sign-in

The viewer signs in with Discord with the `identify` scope only, and the sign-in **never creates a streamer**. The
streamer login, `/auth/login`, creates a `streamers` row for anyone who signs in, so it could not be used as it is.

**Starting the sign-in.** `GET /auth/coaching-signin?for=<login>` sends the viewer to Discord with the same
`redirect_uri` as the streamer login, `<APP_URL>/auth/login/callback`.
- Discord only accepts redirects registered on the application, and reusing that one means the Discord application
  needs no change.
- The route sets `oauth_state` and `oauth_purpose = 'coaching:<login>'`, both short-lived cookies (10 minutes).
- It answers 404 with the page's own text for a login that has no booking page up.

**The callback.** `/auth/login/callback` reads and clears `oauth_purpose` only after the state matched, so a stray
callback cannot leave a coaching sign-in without its purpose.
- A purpose that names something other than a Twitch login answers 400 before Discord is asked anything.
- Otherwise it makes Discord's token and `@me` calls (10 s each), stores a viewer session and redirects to the
  coaching page.
- It returns before `upsertStreamerDiscord`: no `streamers` row, no dashboard and no streamer session.
- `/auth/login` clears a leftover `oauth_purpose`, so a coaching sign-in abandoned half-way cannot turn the next
  streamer login into a viewer's.

**The viewer session.**
- The cookie is `viewer_session`: a random 64-character hex id that lasts 7 days, httpOnly, SameSite Lax, and secure
  in production.
- The row in `viewer_sessions` holds only the id's hash (`db.hashSessionId`, as the streamers' sessions do), with the
  Discord id, username, display name and avatar.
- `POST /auth/coaching-signout` (the "not you?" form) deletes it.
- Expired rows are swept every hour (`cleanExpiredViewerSessions`, next to `cleanExpiredSessions` in `server.js`).

**Who books.** `server.js`'s session step sets `req.viewer`:
- from the viewer session;
- otherwise from a streamer signed in to the site, who then books as their own Discord account without a second
  sign-in.

The viewer session wins when a browser has both.

**CSRF.** Every POST on the page needs the same CSRF check as a streamer's forms. With no web session, the viewer
session's stored hash gives the token (`req.sessionHash`). Every unsafe request from that browser, on any route, then
carries that token (`public/js/csrf.js` adds it).

## The Discord messages

The Atleta bot sends them as direct messages through `src/discord.js`, the one place that sends
(`sendDirectMessage`).
- Each is one embed, sent with `allowedMentions: { parse: [] }`, so it mentions nobody.
- Times are Discord timestamps (`<t:…:F>`), which Discord shows in each reader's own zone.
- The texts are built in `src/services/coachingMessages.js` from the `coaching.message.*` keys.

| To | When | Says |
|---|---|---|
| Viewer | accepted | "<streamer> accepted your coaching session", when, length, the server's name, "Where the session happens", the invite |
| Viewer | declined | "<streamer> declined your coaching request", when, length, the booking link to pick another time |
| Viewer | cancelled by the streamer | "<streamer> cancelled your coaching session", when, length, the booking link |
| Streamer | a new request | "<viewer> asked for a coaching session", when, length, the note, a link to `/dashboard/coaching` |
| Streamer | the viewer cancelled | "<viewer> withdrew their coaching request", when, length |

- **Nothing is sent** to the viewer for their own cancel, or to anyone for a request nobody answered.
- **Languages.** The viewer's messages are in the language the booking page was in when they booked
  (`coaching_bookings.lang`). The streamer's are in the language of their last save of the coaching page
  (`coaching_settings.lang`; English until then).
- **The streamer's switch.** Both of the streamer's messages go out only while "Message me about new requests" is on
  (`notify_requests`). They go to `streamers.discord_user_id`.
- **Viewer-typed text.** The viewer's name and note go through `escapeLinkText()`, so brackets cannot become a link.
  With no mentions allowed, `@everyone` in a note pings nobody.

### When a message cannot be delivered

Discord only lets a bot message someone who shares a server with it, and a person can close their messages.
`sendDirectMessage` never throws. It answers:
- `unreachable`: the user's messages are closed (50007), the user is unknown (10013), or the id is not a Discord id;
- `not_ready`: the bot is not connected;
- `failed`: anything else, including no answer within 10 s.

What happens next depends on who it was for:
- **A viewer's message** is awaited. Its failure reason is stored on the booking (`message_error`) and returned in
  the action's answer. The schedule and the card then say "Atleta could not message <name>: message them yourself."
  The accept, decline or cancel still happens.
- **A streamer's message** is not awaited. A failure is logged (`[Coaching] could not message streamer <id>
  (<kind>): <reason>`), and the card's badge still shows the request.
- **A send that ran out of time** may still have been delivered, so it is never retried.

## The invite and its check

Today's `!coaching` broke because a Discord invite expired, so the invite is checked. The check uses Discord's
public `GET /api/v10/invites/<code>`, which needs no bot (`fetchInvite`, 10 s).

**When the hours are saved:**
- an unknown invite is refused (`bad_invite`), and so is one to another server (`invite_other_server`);
- a good one is recorded as checked;
- with no answer from Discord, the save goes through unchecked ("Saved. Discord could not check the invite right now;
  Atleta checks it again within the hour.").

**When the streamer opens the coaching page:** after `/dashboard/coaching` is sent, `checkInvite` asks Discord again
if the last check is more than an hour old (`INVITE_CHECK_MS`).
- An unknown invite, or one that now leads to another server, is recorded as dead (`invite_ok = 0`).
- No answer records nothing.
- The card shows what the last check found; it does not start a check itself.

**A dead invite.** The page and the card warn "Your invite no longer works". The booking page stops offering times
until a new invite is saved, because the page is not bookable. Saving a different invite forgets the previous check.

## Routes

The public routes are in `src/routes/coaching.js`, mounted at `/coaching`. They are not under `/api`, so only the
general limit applies.

| Route | Does |
|---|---|
| `GET /coaching/:username` | the page (sent without asking Discord) |
| `GET /coaching/:username/state` | the page's state as JSON (below) |
| `POST /coaching/:username/book` | JSON `{ startsAt, minutes, note }` → `{ ok: true, booking, unverified }` |
| `POST /coaching/:username/bookings/:id/cancel` | the viewer's own booking, until it starts → `{ ok: true, booking }` (Withdrawn) |

`GET /coaching/:username/state` answers
`{ open, bookable, slots: { 30: [...], 60: [...] }, viewer, member, inviteUrl, guildName, bookings, maxUpcoming, horizonDays }`:
- `slots` holds the free starts as UTC milliseconds, and none while the page is not bookable;
- `member` comes only with a viewer, and Discord is asked only while the page is bookable;
- `guildName` is the bot's name for the server, else the one stored with the claim.

The sign-in routes are in `src/routes/auth.js`: `GET /auth/coaching-signin?for=<login>`, the coaching branch of
`GET /auth/login/callback`, and `POST /auth/coaching-signout`.

A refusal is `{ ok: false, code, error }`, the error being the code's text in the page's language:

| Code | Status |
|---|---|
| `bad_length`, `bad_note` | 400 |
| `signin` | 401 |
| `unavailable` (the page is not up), `not_found` (another viewer's booking, or another streamer's) | 404 |
| `not_open`, `join_first`, `bad_time`, `taken`, `limit`, `too_late` | 409 |

403 is left to the CSRF check.

The streamer's routes are in `src/routes/coachingDashboard.js`, mounted inside the dashboard router:

| Route | Does |
|---|---|
| `GET /dashboard/coaching` | the page |
| `POST /dashboard/api/coaching/settings` | JSON `{ timeZone, hours, daysOff, guildId, invite, where, notifyRequests }` → `{ ok: true, settings, outsideHours }` |
| `POST /dashboard/api/coaching/open` | JSON `{ open }` (a strict switch value, `parseSwitch`) → `{ ok: true, open }` |
| `POST /dashboard/api/coaching/bookings/:id/accept`, `…/decline`, `…/cancel` | → `{ ok: true, booking }`, with `messageError` when the viewer could not be messaged |

Their refusal codes:

| Code | Status |
|---|---|
| `bad_zone`, `bad_hours`, `bad_days_off`, `bad_server`, `bad_invite`, `invite_other_server`, `bad_where`, `bad_switch` | 400 |
| `not_found` | 404 |
| `not_set_up`, `too_late` (the session has started), `not_waiting`, `not_active` | 409 |

## Tables

All three are created at boot in one guarded block of `src/db.js`, with no log line. All their queries are in
`db.js`.

**`coaching_settings`**: one row per streamer, keyed by `streamer_id`, which points at `streamers`.
- `open`, `time_zone`, `hours` (JSON: seven `{ on, start, end }`), `days_off` (JSON dates);
- `guild_id`, `invite_code`, `invite_ok` (1, 0, or NULL while unchecked), `invite_checked_at`;
- `where_text`, `notify_requests`, `lang`, `updated_at`.

The first save opens bookings; later saves keep `open` as it is.

**`coaching_bookings`**: points at `streamers`, indexed on `(streamer_id, starts_at)` and
`(viewer_discord_id, streamer_id, starts_at)`.
- `streamer_id`;
- the viewer as Discord gave them at sign-in: `viewer_discord_id`, `viewer_username`, `viewer_display_name`,
  `viewer_avatar`;
- `starts_at` (UTC ms), `minutes`, `note`, `lang`, `status`, `message_error`, `decided_at`, `created_at`.

A status changes only from the states the action allows (`setCoachingBookingStatus` checks them in SQL), so two
answers to one request cannot both win. Bookings are deleted 90 days after their start (`cleanupOldCoachingBookings`,
in the daily housekeeping of `src/index.js`).

**`viewer_sessions`**: `sid` (the hash), `discord_user_id`, `discord_username`, `discord_display_name`,
`discord_avatar`, `expires_at`. It is not tied to a streamer.

**Account changes.**
- Removing an account (Admin → Users → Remove) deletes its `coaching_bookings` and `coaching_settings` rows
  (`STREAMER_OWNED_ROWS`).
- Disabling one makes its booking page and its sign-in answer like an unknown streamer.
- The page's address is the linked Twitch login, so linking another Twitch account moves it, and the old link
  answers 404.

## Discord being down

`DISCORD_DISABLED=1`, a bot that is not ready, or a Discord outage never makes a route fail:
- the server's name falls back to the one stored with the claim;
- the membership check answers "cannot say", and viewers can book with the warning;
- a viewer's message is recorded as `not_ready` or `failed`, and a streamer's is logged;
- the server picker keeps the saved server;
- an invite that cannot be checked is saved unchecked.

## Left out on purpose

- **Payment.** What a streamer charges is arranged outside the app.
- **Reminders and calendars.** There are no reminders before a session, no calendar files (.ics) and no calendar
  sync.
- **Rescheduling.** It is not one action: the streamer cancels and the viewer books again.
- **Buttons in Discord.** Accept and Decline inside Discord would need Discord interactions; the message links to the
  schedule instead.
- **Sessions of other kinds.** No group sessions, several coaches, session types or prices.
- **Video or voice on the site.** The session happens wherever the streamer coaches.
- **A built-in `!coaching` command.** Each streamer points their own command (and sponsor message) at the link the
  card shows.

## Tests

| File | What it covers |
|---|---|
| `src/services/coaching.test.js` | hours, free starts, daylight saving (18:00 stays 18:00 local across Lisbon's 25 October change), states, inputs, bookable |
| `src/db.coaching.test.js` | the tables, the overlap and limit transaction, the guarded status change, the 90-day cleanup, viewer sessions stored hashed |
| `src/db.accounts.test.js` | account removal, for every table with a `streamer_id` |
| `src/discord.coaching.test.js` | direct messages and their failure reasons, the deadlines, the member and invite checks |
| `src/services/coachingMessages.test.js`, `src/services/coachingBookings.test.js` | the messages (viewer text escaped with the real `escapeLinkText`); request, accept, decline, cancel and withdraw with their refusals; the hourly invite check; the card's data |
| `src/routes/auth.test.js` | the coaching sign-in creates a viewer session and no `streamers` row; a sign-in without the purpose still creates a streamer; a bad purpose is refused before Discord is asked |
| `src/routes/coaching.test.js` | the page, `state`, booking and cancelling; names and notes holding `<script>` print as text |
| `src/server.app.test.js` | a booking needs the viewer session's CSRF token, on the real `server.js` |
| `src/routes/coachingDashboard.test.js` | the settings save, open, accept, decline and cancel, another streamer's booking, the schedule, the invite check after the page |
| `src/services/dashboardCards.test.js`, `src/routes/dashboard.test.js`, `tests/dashboardCardsCore.test.js` | the card |
| `tests/coachingCore.test.js` | the page's day grouping across zones |
| `tests/streamerViewsI18n.test.js`, `tests/i18nViewsPart1.test.js`, `tests/i18n.test.js` | both pages and the card in all seven languages |

Run the unit suite as usual: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"`.

**The browser check.** Headless Chromium ran on a throwaway copy of the site with its own empty `data/` and
`DISCORD_DISABLED=1`. A preload stubbed Discord's OAuth, the invite lookup, the membership check and the direct
messages. These steps were covered at 1600 and 375 px:
1. set the hours (a dead invite refused, then a live one);
2. the booking page signed out;
3. a viewer's sign-in and the join-first panel;
4. two requests, then the limit;
5. a viewer in Asia/Tokyo booking Lisbon's 19:00 as 04:00 the next day;
6. the card and the schedule;
7. accept on the card;
8. decline on the schedule, with the viewer's messages closed;
9. the viewer withdrawing one;
10. pausing on the card and reopening on the page;
11. "not you?".
