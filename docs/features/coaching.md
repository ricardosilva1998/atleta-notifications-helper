# Coaching (booking sessions with a streamer)

A streamer who coaches (andre_vilela_ coaches iRacing drivers one-on-one in his Discord server) sets the hours he
coaches once, repeating every week. Viewers open one link, connect Discord, pick one of the streamer's lengths and ask
for a time. The streamer accepts or declines each request from one schedule, and Atleta tells both sides on Discord.
A paid length is confirmed only by a verified PayPal payment, and each paid session gets a private role and voice room
in the streamer's Discord server, with a chat transcript afterwards. It is for every streamer on the site and is
opt-in: a streamer has no booking page until they save their hours the first time.

Design: `docs/superpowers/specs/2026-10-29-coaching-design.md` (its mockup:
`docs/superpowers/specs/assets/2026-10-29-coaching-mockup.html`); plan: `docs/superpowers/plans/2026-10-29-coaching.md`. Payment, rooms and sign-in first (2026-11-16): brief and plan in
`docs/superpowers/plans/2026-11-16-coaching-payment-rooms.md`.

## How a booking goes

1. The viewer opens `/coaching/<twitch login>` and **connects Discord first**, joins the streamer's coaching server if
   they are not in it, picks a length, a day and a time, and presses **Request this time**. The time is **held at
   once**: nobody else can take it.
2. The streamer gets a Discord message about the request (while "Message me about new requests" is on) and sees it on
   the Coaching card and the schedule.
3. The streamer **accepts** or **declines** it.
   - Declined: the viewer is told, with the booking link.
   - Accepted, a **paid** length: the booking becomes **Awaiting payment**, the time stays held, and the viewer gets a
     Discord message with the price, the deadline and the booking link.
   - Accepted, a **free** length (price 0): it is confirmed at once, and the room is made (below).
4. The viewer presses **Pay** on the booking page and pays with PayPal, like a tip: the money goes straight to the
   streamer's PayPal. When the server has verified the capture, the booking is **Confirmed**, the viewer gets the
   confirmation message with the room link, and the room is made.
5. Unpaid by the deadline, the booking **expires**: the time frees up and both sides are told.
6. About 30 minutes after the session ends, the bot sends the room's chat to the viewer and the coach as a text file
   and deletes the room and its role.

**Cancelling.** Before payment (waiting or awaiting payment) the streamer can decline or cancel and the viewer can
withdraw, as before. **Once paid, nobody can cancel in the app**: the routes answer `paid` (409) and the two sort it
out on Discord. Atleta cannot refund (the money is in the streamer's PayPal). Bookings confirmed before this release
(no price, nothing paid) keep Cancel and Withdraw and get no room.

A request nobody answered before its start time shows as **Not answered**. It is still stored as waiting; the state
is worked out when it is read (`coaching.bookingState`). Nobody is messaged about it.

| State | Stored | What it means |
|---|---|---|
| Waiting | `waiting` | asked for, held, not answered yet |
| Awaiting payment | `awaiting_payment` | accepted, held, waiting for the viewer's payment (`pay_by`) |
| Confirmed | `confirmed` | paid (`paid_at` set), or a free length the streamer accepted |
| Declined | `declined` | the streamer declined it |
| Cancelled | `cancelled` | the streamer cancelled it (before payment) |
| Withdrawn | `withdrawn` | the viewer cancelled it (before payment) |
| Expired | `expired` | not paid by `pay_by` |
| Not answered | never stored | still `waiting` when its start came |

Waiting, awaiting-payment and confirmed bookings hold their time (`coaching.HOLDING`); the other states free it. A
booking that becomes Withdrawn also frees the viewer's place under the limit. A booking is **paid** when it has a
recorded capture (`paid_at` not null).

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
  - A time that overlaps a waiting, awaiting-payment or confirmed booking is left out, not shown crossed out.
  - A wall time the zone skips (the spring change) has no start; a time the zone repeats takes the earlier instant.
- **Lengths and prices.** `coaching.LENGTHS` is 30 min, 1 h, 2 h, 3 h, 4 h and 5 h.
  - Each streamer switches each length on or off and sets its price, on `/dashboard/coaching`. The price is in whole
    cents, 0 to 1000.00, in the tip page's currency (`streamers.donation_currency`, EUR when unset). At least one
    length must stay on. Stored as JSON on `coaching_settings.lengths`.
  - **Defaults, for every streamer and every existing settings row** (a NULL `lengths` reads as these; no data step):
    30 min off, 1 h 25, 2 h 45, 3 h 60, 4 h 70, 5 h 80, all in the streamer's currency.
  - A streamer whose currency is not EUR sees "Check your prices: they are in <currency>" on the page and the card
    until they save prices once (`prices_saved_at`).
  - **Free lengths are allowed** (price 0): no payment, confirmed on accept, room made.
  - Each booking stores its own `price_cents` and `currency` when requested, so a later change never touches it.
  - A paid length needs the streamer's PayPal email (the tip page setting). Without it the booking page offers only
    free lengths, accepting a paid request is refused (`no_paypal`), and the page and card say so.
  - A length is listed on the booking page only when it has at least one free start in the next 14 days. A 5 h
    session needs a window of at least 5 h; `freeStarts` already requires the session to end inside the window.
- **Payment deadline.** `pay_by = min(accepted_at + 2 h, starts_at - 15 min)`. Accepting a paid request is refused
  (`too_close`) when `pay_by` would be under 10 minutes away (the start is under 25 minutes away); declining still
  works. A free length can be accepted until its start.
- **Limit.** At most **2** upcoming bookings (waiting, awaiting payment or confirmed, not started) per viewer per streamer
  (`MAX_UPCOMING`).
- **Requests a day.** At most **6** requests per viewer per streamer in any 24 hours, whatever became of them
  (`MAX_REQUESTS_PER_DAY`, counted by `created_at` over every status), refused with `too_many`. Each request and each
  withdrawal messages the streamer, so booking and withdrawing again and again ends at 12 messages a day.
- **Texts.** The viewer's note is at most **300** characters and "Where the session happens" at most **150**,
  counted in code points. Each line break becomes one space, the other control characters are removed and the text is
  trimmed. A longer text is refused (`bad_note`, `bad_where`), never cut.
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
1. It counts the viewer's requests of the last 24 hours (`too_many`).
2. It counts the viewer's upcoming bookings (`limit`).
3. It looks for a holding booking (waiting, awaiting payment or confirmed) of the streamer that overlaps the requested time (`taken`).
4. Only then does it insert.

Of two viewers asking for overlapping times at the same moment, exactly one gets it.

Before that, the service refuses a time that is not among the free starts it has just worked out (`bad_time`), so
`taken` only comes from a race. The page gives both codes the same text ("That time was just taken"). Only then does
it ask whether the viewer is in the coaching server (`join_first`), so Discord is never asked about a time that could
not be booked.

## The streamer's side

### The coaching page

`/dashboard/coaching` (`src/routes/coachingDashboard.js`, `src/views/coaching-dashboard.ejs`,
`public/js/coaching-dashboard.js`) sits behind the dashboard's login and disabled-account check. It has two cards.

**Schedule.**
- The bookings not over yet, grouped by day in the streamer's zone. Each shows its time, the viewer's Discord name
  and `@username`, its length, its note and its state.
- Each booking also shows its price. Awaiting payment shows a pill with "Pay by <time>"; a paid session shows a Paid
  pill with the amount.
- Actions:
  - a waiting request has ✓ (Accept) and ✕ (Decline, after a confirmation). Accept answers `no_paypal` or `too_close`
    in the message line when it cannot;
  - an awaiting-payment booking and a confirmed session that was never paid (from before this release) have Cancel
    (after a confirmation);
  - a **paid** session has no Cancel.
- A paid session shows the room link, or the room's error with **Retry room** (below), then the transcript status once
  the session is over.
- A payment that arrived for a booking already expired (and whose time is gone) shows a warning to refund it in
  PayPal (`payment_issue = 'late'`).
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
- **Lengths and prices**: six rows, each with a switch and a price in the tip page's currency. They save with the rest
  (`lengths`; `bad_lengths` for a bad price, `no_length` when all are off). The first save sets `prices_saved_at`.
- Two notes: the PayPal email is missing (a link to `/dashboard/donations`), and "Check your prices" for a
  non-EUR currency that has not saved prices.
- The time zone (with the zone list `Intl` knows) and the days off.
- **Where we meet**:
  - the coaching server, picked from the streamer's claimed servers the bot is in, plus the saved one while the bot
    cannot see it;
  - the invite link;
  - the **Coaching category**: picked from the coaching server's categories (a list the route gives; empty while
    Discord cannot be reached, then the saved one is kept). It is optional: with none, no rooms are made. Changing the
    server disables the picker until the save, and a save that changes the server clears the category;
  - "Fallback: where the session happens" (for example "the Coaching Room voice channel"), shown to the viewer when a
    confirmed session has no open room;
  - **Message me about new requests** (on by default).
- The booking link with Copy, and Save. The first save reads "Save and open bookings" and opens them.

What a save does:
- It checks everything that needs no Discord first, then asks Discord about the invite: a dead one answers
  `bad_invite`, one to another server `invite_other_server`, and no answer saves it unchecked.
- A category is checked too: it must belong to the claimed server (`category_not_found`) and the bot must hold on it
  Manage Channels, Manage Permissions, View Channel, Connect, Speak, Send Messages, Attach Files and Read Message
  History, plus Manage Roles at server level. A refusal is `category_permissions`, naming the missing ones in the
  page's language. With no answer from Discord the category is saved unchecked, and a room then fails visibly.
- It never changes a booking, even when the hours change or a day off is added. It answers with the ids of the
  waiting, awaiting-payment or confirmed bookings that now fall outside the hours, and the page says so. The streamer cancels them
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
  - Up to five waiting requests (name, length, price, time and note), each with ✓ and ✕. The badge counts them all; a sixth
    appears after a reload.
  - The next session (the earliest confirmed or awaiting-payment one), with "Paid <amount>" or "Awaiting payment, pay
    by <time>", and "Atleta could not message <name>" when that is so.
  - Notes: the PayPal email missing, check your prices, and the number of sessions whose room failed.
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

**The order of the page.** Connect Discord, then join the server, then choose, then (after the streamer accepts) pay.

**Signed out.** The page shows only the coach's name and picture, a short "how it works" and **Connect Discord**. It
shows no times: the picker is not in the page until a viewer is signed in.

**Times.** They are shown in the viewer's browser zone and grouped by the viewer's own days. A viewer far east of the
streamer can see a 15th day: Lisbon's 18:00 to 22:00 falls between 02:00 and 06:00 the next day in Tokyo.

**Signed in.**
- "Booking as <Discord name>" with "not you?". For a viewer it signs them out. For a streamer booking as their own
  account, it leads to the viewer sign-in instead.
- The picker comes only after `/state` answered and the viewer is a member (or Discord could not say): the streamer's
  lengths that are on (`state.lengths`, each with its price or "Free", only those with a free start), the strip of
  days with the empty ones dimmed, the free times of the chosen day, the note "What do you want to work on?
  (optional)" and **Request this time**.
- After a request: "Your time is held. Atleta will message you on Discord once <streamer> accepts it."
- At the limit, the request box gives way to "You have 2 upcoming bookings with <streamer>…".
- **Your bookings**: the viewer's own bookings with this streamer, from the last 30 days and to come, with state
  pills (including Awaiting payment and Expired), length, price and time. Per state:
  - awaiting payment: **Pay <price>** and "Pay by <time>" (in the viewer's zone), shown only before the deadline;
  - confirmed: the room link (`https://discord.com/channels/<guild>/<channel>`, drawn only when it has that shape),
    or the streamer's "where" text when there is no open room;
  - waiting and unpaid confirmed ones have Cancel until they start; a paid one has none.
- **Pay** (`POST /coaching/<login>/bookings/<id>/pay`) answers the PayPal approve address; the page goes there only if
  it is on paypal.com (the server checks too). PayPal returns to `/coaching/<login>/paid`, which captures, and the
  page opens with `?paid=1` or `?error=<code>`. `pay_unconfirmed` also carries `&order=<id>` and the page offers
  **Check again** (the same return route).

**Join first.** Once a viewer is signed in, the page asks the bot whether they are a member of the coaching server.
- If not, it shows "Join <server> first", the streamer's invite as a button, and "I've joined" to ask again. **Request
  this time** appears only once they are in.
- If Discord cannot say (it is down or not ready), they can book, and the page says Atleta may not be able to message
  them.
- The check uses the bot's own view of the server, never the viewer's token (`isGuildMember`: the member cache, then
  one member lookup by id, 5 s at most).
- The answer is kept 30 s per server and viewer (`coachingBookings.isMember`), for the page's reads and the request
  alike, and a lookup in progress is shared. "I've joined" (`GET /state?recheck=1`) asks Discord again at once, at
  most once every 10 s per viewer; within those 10 s it reads the kept answer.

**Paused.** When the page is not bookable (see Bookable above), it says "<streamer> is not taking new bookings right
now." and shows no times. A signed-in viewer still sees their bookings and can pay or cancel (before payment), and
accept, decline and cancel keep working for the streamer.

**Refreshing.** The page reads `GET /coaching/<login>/state`:
- once on load, for the membership;
- after every action, and on "I've joined" (with `?recheck=1`);
- when its tab is shown again after a minute away.

Between two reads, the page drops a start that has come inside the hour of notice (`leadMs` in the state,
`bookableStarts` in `public/js/coaching-core.js`), as the server would refuse it.

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
| Viewer | accepted (a free length) | "<streamer> accepted your coaching session", when, length, the server's name, the room link or "Where the session happens", the invite |
| Viewer | accepted (a paid length) | the price, the pay-by time and the booking link to pay |
| Viewer | confirmed (payment verified) | the paid amount, when, length, the room link (`<#channel>`) or the where text |
| Viewer | expired (not paid in time) | the booking link to pick another time |
| Viewer | declined | "<streamer> declined your coaching request", when, length, the booking link to pick another time |
| Viewer | cancelled by the streamer | "<streamer> cancelled your coaching session", when, length, the booking link |
| Streamer | a new request | "<viewer> asked for a coaching session", when, length, the note, a link to `/dashboard/coaching` |
| Streamer | the viewer cancelled | "<viewer> withdrew their coaching request", when, length |
| Streamer | paid | "<viewer> paid for their session", amount, when |
| Streamer | not paid in time | the booking expired and the time is free again |
| Streamer | a payment for an expired booking | refund it in PayPal (always sent, even with notifications off) |
| Viewer and streamer | the transcript | the room's chat as a `.txt` file, with the shared files (below) |

- **Nothing is sent** to the viewer for their own cancel, or to anyone for a request nobody answered.
- **Languages.** The viewer's messages are in the language the booking page was in when they booked
  (`coaching_bookings.lang`). The streamer's are in the language of their last save of the coaching page
  (`coaching_settings.lang`; English until then).
- **The streamer's switch.** The streamer's messages go out only while "Message me about new requests" is on
  (`notify_requests`), except the late-payment warning, which always goes out. They go to `streamers.discord_user_id`.
- **Typed text.** The viewer's name and note, the streamer's "Where the session happens" and the server's name go
  through `escapeLinkText()`, so brackets cannot become a link. With no mentions allowed, `@everyone` in a note pings
  nobody.

### When a message cannot be delivered

Discord only lets a bot message someone who shares a server with it, and a person can close their messages.
`sendDirectMessage` never throws. It answers:
- `unreachable`: the user's messages are closed (50007), the user is unknown (10013), or the id is not a Discord id;
- `not_ready`: the bot is not connected;
- `failed`: anything else, including no answer within 10 s.

What happens next depends on who it was for:
- **A viewer's message** is awaited. Its failure reason is stored on the booking (`message_error`) and returned in
  the action's answer. The schedule and the card then say "Atleta could not message <name>: message them yourself."
  The accept, decline or cancel still happens. A later message to that viewer that goes out (a cancel after a failed
  accept) clears the warning.
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

**When the streamer opens the dashboard or the coaching page:** after `/dashboard` (the Coaching card) or
`/dashboard/coaching` is sent, `checkInvite` asks Discord again if the last check is more than an hour old
(`INVITE_CHECK_MS`; `checkInviteLater`, started on the response's `finish`).
- An unknown invite, or one that now leads to another server, is recorded as dead (`invite_ok = 0`).
- No answer records when it asked and keeps the last result (`recordInviteCheck` with `ok = null`), so a Discord that
  is down is asked again an hour later, not on every visit.
- One check runs at a time per streamer; a call while one is in progress gets its answer.
- `GET /dashboard/api/cards` (the cards' refresh after a save) never checks: `gatherCards` only reads the last result.

**A dead invite.** The page and the card warn "Your invite no longer works". The booking page stops offering times
until a new invite is saved, because the page is not bookable. Saving a different invite forgets the previous check.

## Payment

PayPal Checkout, like a tip (`src/services/coachingPayments.js`, the PayPal calls in `src/services/paypal.js`, which
`routes/tip.js` also uses, with the same behaviour). Coaching payments **never touch tips**: no `donations` row, no
alert, tip goal, tracker, voice or chat thank-you (tested).

1. **Pay** (`POST /coaching/:username/bookings/:id/pay`): the signed-in viewer who owns the booking, state
   `awaiting_payment`, before `pay_by`. It first reads back the booking's open orders (a capture whose answer was lost
   confirms the booking instead of starting a second order; at most 5 open orders per booking), then creates a PayPal
   order with `payee: { email_address }` set to the streamer's PayPal email, the booking's price and currency and
   `custom_id` = the booking id, and stores a `coaching_payments` row (status `created`).
2. **Return** (`GET /coaching/:username/paid?token=<order id>`): captures (`Prefer: return=representation`) and reads
   the order back when the answer is lost or slow. A capture counts only when **all** of these hold:
   - the `coaching_payments` row exists for this streamer and this booking, and the order id matches;
   - the order and its capture are COMPLETED (PENDING waits and shows `pay_unconfirmed`);
   - `custom_id` is the booking id;
   - the payee is the account named at creation (the PayPal merchant id when PayPal gave one, else the email);
   - the amount in cents (read strictly) and the currency equal both the order row and the booking's price.
   A COMPLETED order that fails a check is marked `refused` and logged; nothing else is recorded.
3. **Recorded once.** The capture id is unique, so a replay or two returns at once change nothing. The booking gets
   `paid_at`, `paid_amount_cents`, `paid_currency`, `paypal_order_id`, `paypal_capture_id`, and becomes `confirmed`
   (`recordCoachingPayment`: `recorded`, `duplicate`, `late_confirmed`, `late_issue`, `double`). The confirmation
   messages go out and the room is made.
4. **A late capture** (the booking already expired): the payment is recorded; if its time is still free the booking is
   confirmed, otherwise it stays expired with `payment_issue = 'late'` and the streamer is told to refund it in PayPal.
5. **Expiry** (the tick): `expireDue` reads back every open order of an unpaid booking past `pay_by` before expiring
   it (a capture found confirms it instead). If PayPal cannot be asked, it waits up to 30 minutes past the deadline.
   The update skips a paid row, so a payment that lands in between wins.
6. **Stale orders.** `reconcileStale` reads each order still `created` after 24 hours once, then records, refuses or
   drops it (kept up to 72 h when PayPal cannot be reached).

`/paid` needs no viewer sign-in: the order id cannot be guessed and only a verified order confirms a booking. The pay
route needs the viewer session and its CSRF token. Both routes have their own limiter (15 per 10 minutes per visitor,
`coachingPayLimiter` in `server.js`), because each talks to PayPal. The live site needs `PAYPAL_MODE=live`.

## Rooms

`src/services/coachingRooms.js`. A booking that becomes confirmed by payment, or by accept of a free length, gets a
private room, **only if the streamer set a Coaching category** (otherwise the "where" text is used).

- **Steps.** A role `coaching-<viewer username>-<YYYY-MM-DD>` (the Discord username lowercased, `[a-z0-9_.-]` only, the
  date in the streamer's zone, at most 100 characters) with no permissions, given to the viewer; then a voice channel
  of the same name in the category. Files and messages go in the voice channel's own text chat.
- **Overwrites on the channel.** `@everyone` is denied View Channel and Connect. The session role, the coach (the
  streamer's Discord id) and the bot are allowed View Channel, Connect, Speak, Send Messages, Attach Files and Read
  Message History (the bot also Manage Channels). The server owner and Administrators see every room by Discord's own
  rule. Nothing outside the category is touched, and no new bot invite is needed.
- **Restart-safe.** The row in `coaching_rooms` (state `making`, `open`, `closing`, `closed` or `failed`) stores each
  id as it is made. The tick finishes or cleans a `making` row older than 2 minutes.
- **Failure never undoes the booking.** The room's `state = 'failed'` and its `error` (`missing_permissions`,
  `viewer_not_member`, `discord_down`, `failed`, or `no_category` on Retry) show on the schedule and the card. The
  streamer's **Retry room** (`POST /dashboard/api/coaching/bookings/:id/room`) deletes any half-made pair and tries
  again. Accept of a free length waits at most 8 seconds for the room link.
- **Close.** `close_at` is the session's end plus 30 minutes. At that time the transcript is sent, then the channel and
  the role are deleted and the row is `closed`. A delete that fails stays `closing` and is retried without resending.
- **Other removals.** Admin Remove of an account calls `coachingRooms.removeAllFor` before the rows go (best effort,
  never throws). Changing the coaching server or category leaves existing rooms until they close.

### Transcripts and the Message Content intent

- The bot reads the voice channel's text chat (REST, all pages) and builds a `.txt`: a header (streamer, viewer, session
  time, the streamer's zone named), then lines `YYYY-MM-DD HH:MM <display name>: <text>` in that zone, with attachments
  listed by file name and "(attached)" or "(too big to send)". An empty chat sends "No messages were written". Text
  chat only: voice is never recorded.
- It is DMed to the viewer and the coach, once each. Shared files are downloaded (only from `cdn.discordapp.com` and
  `media.discordapp.net`, https, no redirects, size-capped while streaming) and re-uploaded, because Discord's links
  expire: each file at most 10 MB, at most 10 files and 10 MB per message (more messages as needed), at most 30 files
  in all; the rest are named as too big. File names are cut to plain characters, 100 long.
- `transcript_status` records the outcome: `sent`, `partial`, `failed`, `no_intent`, `no_channel`. A failed DM is not
  retried endlessly.
- **Message Content.** The client asks for the privileged Message Content intent (`src/discord.js`; reads are by REST,
  so no GuildMessages). If the owner has not switched it on in the Discord Developer Portal, Discord refuses the login
  with "disallowed intents"; `discordLogin.js` logs that loudly once and logs in again without it
  (`discord.hasMessageContent()` then answers false). Rooms still work, but **no transcript is sent** (an empty one is
  never sent) and the schedule says `no_intent`: "Switch on Message Content in the Discord Developer Portal".

## The minute tick

`src/services/coachingTick.js`, started in `src/index.js` at boot (the first run 20 seconds after it) and stopped on
shutdown, `.unref()`'d, one run at a time. Each step runs on its own, so one that throws never stops the others:
1. `expireDue`: unpaid bookings past `pay_by` expire (an open PayPal order is read back first), both sides are told;
2. `reconcileStale`: old PayPal orders are read back;
3. `finishOrCleanMaking`: half-made rooms from a run that is gone;
4. `closeDue`: rooms past `close_at` get their transcripts and are deleted.

None of it needs Discord to be up: the room steps wait for it.

## Routes

The public routes are in `src/routes/coaching.js`, mounted at `/coaching`. They are not under `/api`, so only the
general limit applies.

| Route | Does |
|---|---|
| `GET /coaching/:username` | the page (sent without asking Discord) |
| `GET /coaching/:username/state` | the page's state as JSON (below) |
| `POST /coaching/:username/book` | JSON `{ startsAt, minutes, note }` → `{ ok: true, booking, unverified }` |
| `POST /coaching/:username/bookings/:id/cancel` | the viewer's own booking, before payment and until it starts → `{ ok: true, booking }` (Withdrawn); a paid one answers `paid` |
| `POST /coaching/:username/bookings/:id/pay` | the viewer's own awaiting-payment booking → `{ ok: true, approveUrl }` (the PayPal page) |
| `GET /coaching/:username/paid?token=<order>` | PayPal's return: captures and verifies, redirects to the page with `?paid=1` or `?error=` (`late`, `pay_invalid`, `pay_unconfirmed` (with `&order=`), `not_paid`, `paid`, `pay_closed`) |

`GET /coaching/:username/state` answers
`{ open, bookable, lengths: [{ minutes, priceCents }], currency, slots: { <minutes>: [...] }, viewer, member, inviteUrl, guildName, bookings, maxUpcoming, horizonDays, leadMs }`:
- `slots` holds the free starts as UTC milliseconds for each offered length, and none while the page is not bookable;
- `lengths` are the offered lengths only (on, and payable: a paid one needs the PayPal email);
- a viewer's bookings carry `priceCents`, `payBy`, `paid`, `roomUrl` and, for confirmed ones, `whereText`;
- `member` comes only with a viewer, and Discord is asked only while the page is bookable (its answer kept 30 s;
  `?recheck=1` asks again, see Join first);
- `leadMs` is the hour of notice (`LEAD_MS`), for the page to drop starts that come inside it while it stays open;
- `guildName` is the bot's name for the server, else the one stored with the claim.

The sign-in routes are in `src/routes/auth.js`: `GET /auth/coaching-signin?for=<login>`, the coaching branch of
`GET /auth/login/callback`, and `POST /auth/coaching-signout`.

A refusal is `{ ok: false, code, error }`, the error being the code's text in the page's language:

| Code | Status |
|---|---|
| `bad_length`, `bad_note` | 400 |
| `signin` | 401 |
| `unavailable` (the page is not up), `not_found` (another viewer's booking, or another streamer's) | 404 |
| `not_open`, `join_first`, `bad_time`, `taken`, `limit`, `too_late` (the session has started), `not_active` (already answered or withdrawn), `no_paypal`, `paid` (no cancel after payment), `not_awaiting`, `pay_closed` | 409 |
| `too_many` (six requests in the last 24 hours), `too_many_payments` | 429 |
| `payment_failed` (PayPal could not make the order) | 502 |

403 is left to the CSRF check.

The streamer's routes are in `src/routes/coachingDashboard.js`, mounted inside the dashboard router:

| Route | Does |
|---|---|
| `GET /dashboard/coaching` | the page |
| `POST /dashboard/api/coaching/settings` | JSON `{ timeZone, hours, daysOff, guildId, invite, where, notifyRequests, lengths, categoryId }` → `{ ok: true, settings, outsideHours, money }` (`lengths` and `categoryId` absent keep the saved ones; `categoryId: ''` clears) |
| `POST /dashboard/api/coaching/open` | JSON `{ open }` (a strict switch value, `parseSwitch`) → `{ ok: true, open }` |
| `POST /dashboard/api/coaching/bookings/:id/accept`, `…/decline`, `…/cancel` | → `{ ok: true, booking }`, with `messageError` when the viewer could not be messaged |
| `POST /dashboard/api/coaching/bookings/:id/room` | Retry room → `{ ok: true, booking }` |

Their refusal codes:

| Code | Status |
|---|---|
| `bad_zone`, `bad_hours`, `bad_days_off`, `bad_server`, `bad_invite`, `invite_other_server`, `bad_where`, `bad_lengths`, `no_length`, `bad_category`, `category_not_found`, `category_permissions` (with `missing`), `bad_switch` | 400 |
| `not_found` | 404 |
| `not_set_up`, `too_late` (the session has started), `not_waiting`, `not_active`, `no_paypal`, `too_close`, `paid`, `no_category`, `room_not_failed`, `room_busy` | 409 |
| `discord_down` | 503 |

## Tables

The first three are created at boot in one guarded block of `src/db.js`, the payment and rooms additions in a second
one (columns added only when missing, no log line, and a second boot changes nothing). All their queries are in
`db.js`.

**`coaching_settings`**: one row per streamer, keyed by `streamer_id`, which points at `streamers`.
- `open`, `time_zone`, `hours` (JSON: seven `{ on, start, end }`), `days_off` (JSON dates);
- `guild_id`, `invite_code`, `invite_ok` (1, 0, or NULL while unchecked), `invite_checked_at`;
- `where_text`, `notify_requests`, `lang`, `updated_at`;
- `lengths` (JSON `{"60": { on, price }, ...}`; NULL reads as the defaults), `prices_saved_at`, `category_id`.

The first save opens bookings; later saves keep `open` as it is.

**`coaching_bookings`**: points at `streamers`, indexed on `(streamer_id, starts_at)` and
`(viewer_discord_id, streamer_id, starts_at)`.
- `streamer_id`;
- the viewer as Discord gave them at sign-in: `viewer_discord_id`, `viewer_username`, `viewer_display_name`,
  `viewer_avatar`;
- `starts_at` (UTC ms), `minutes`, `note`, `lang`, `status`, `message_error`, `decided_at`, `created_at`;
- the price taken at request time: `price_cents`, `currency`;
- the accept and payment: `accepted_at`, `pay_by`, `paid_at`, `paid_amount_cents`, `paid_currency`,
  `paypal_order_id`, `paypal_capture_id`, `payment_issue` (`late`).

A status changes only from the states the action allows (`setCoachingBookingStatus` checks them in SQL), so two
answers to one request cannot both win. Bookings are deleted 90 days after their start (`cleanupOldCoachingBookings`,
in the daily housekeeping of `src/index.js`).

**`coaching_payments`**: one row per PayPal order, `order_id` (primary key), `booking_id`, `streamer_id`,
`amount_cents`, `currency`, `payee_email`, `payee_merchant_id`, `status` (`created`, `captured`, `refused`),
`capture_id` (unique when set), `created_at`, `captured_at`. Not part of `donations`. Rows still `created` after 24 hours
are read back once and dropped by the tick.

**`coaching_rooms`**: one row per room, `booking_id` (primary key), `streamer_id`, `guild_id`, `category_id`, `role_id`,
`channel_id`, `state` (`making`, `open`, `closing`, `closed`, `failed`), `error`, `close_at`, `transcript_status`,
`created_at`, `updated_at`.

**`viewer_sessions`**: `sid` (the hash), `discord_user_id`, `discord_username`, `discord_display_name`,
`discord_avatar`, `expires_at`. It is not tied to a streamer.

**Account changes.**
- Removing an account (Admin → Users → Remove) first deletes its rooms and roles on Discord (best effort), then its
  `coaching_rooms`, `coaching_payments`, `coaching_bookings` and `coaching_settings` rows (`STREAMER_OWNED_ROWS`). The
  90-day booking cleanup removes the payment and room rows of the bookings it deletes.
- Disabling one makes its booking page and its sign-in answer like an unknown streamer.
- The page's address is the linked Twitch login, so linking another Twitch account moves it, and the old link
  answers 404.

## Discord being down

`DISCORD_DISABLED=1`, a bot that is not ready, or a Discord outage never makes a route fail:
- the server's name falls back to the one stored with the claim;
- the membership check answers "cannot say" (kept 30 s like any answer), and viewers can book with the warning;
- a viewer's message is recorded as `not_ready` or `failed`, and a streamer's is logged;
- a room that cannot be made is `failed` with `discord_down` (Retry later), and a close that cannot read the chat waits
  for the next pass (given up 6 hours after `close_at`);
- PayPal being down never fails a route or undoes a booking: pay answers `payment_failed`, and the tick reads orders
  back later;
- the server picker keeps the saved server;
- an invite that cannot be checked is saved unchecked, and the hourly check that gets no answer keeps the last result
  and waits the hour.

## Left out on purpose

- **Refunds.** Atleta cannot refund: the money is in the streamer's PayPal. A late payment for an expired booking is
  flagged for the streamer to refund there.
- **Cancel after payment.** A paid session cannot be cancelled or withdrawn in the app; the two sort it out on
  Discord.
- **Voice recording or transcription.** Transcripts are text chat only.
- **A staff or moderator role** for the rooms (owner and Administrators see them by Discord's rule), a payments
  history or CSV, and rooms for bookings made before this release.
- **Reminders and calendars.** There are no reminders before a session, no calendar files (.ics) and no calendar
  sync.
- **Rescheduling.** It is not one action: the streamer cancels and the viewer books again.
- **Buttons in Discord.** Accept and Decline inside Discord would need Discord interactions; the message links to the
  schedule instead.
- **Sessions of other kinds.** No group sessions, several coaches or session types.
- **Video or voice on the site.** The session happens in the Discord room (or wherever the streamer coaches).
- **A built-in `!coaching` command.** Each streamer points their own command (and sponsor message) at the link the
  card shows.

## Tests

| File | What it covers |
|---|---|
| `src/services/coaching.test.js` | hours, free starts, lengths up to 5 h, daylight saving (18:00 stays 18:00 local across Lisbon's 25 October change), states, the default lengths and prices, the payment deadline, inputs (line breaks become spaces), bookable |
| `src/db.coaching.test.js` | the tables, the requests-a-day, limit and overlap transaction, an invite check with no answer, the guarded status change, the 90-day cleanup, viewer sessions stored hashed |
| `src/db.accounts.test.js` | account removal, for every table with a `streamer_id` |
| `src/discord.coaching.test.js` | direct messages and their failure reasons, the deadlines, the member and invite checks |
| `src/services/coachingMessages.test.js`, `src/services/coachingBookings.test.js` | the messages (typed text escaped with the real `escapeLinkText`); request, accept, decline, cancel and withdraw with their refusals (book and withdraw again and again ends at `too_many`); a later message clearing the warning; the membership memo and its recheck; the hourly invite check, one at a time; the card's data |
| `src/routes/auth.test.js` | the coaching sign-in creates a viewer session and no `streamers` row; a sign-in without the purpose still creates a streamer; a bad purpose is refused before Discord is asked |
| `src/routes/coaching.test.js` | the page, `state` (with `?recheck=1`), booking and cancelling (`not_active`, `too_many`); names and notes holding `<script>` print as text |
| `src/server.app.test.js`, `src/server.wiring.test.js` | a booking and a pay need the viewer session's CSRF token, on the real `server.js`; the pay limiter is wired; a disabled streamer's web session gives no viewer |
| `src/routes/coachingDashboard.test.js` | the settings save, open, accept, decline and cancel, another streamer's booking, the schedule, the invite check after the page |
| `src/services/dashboardCards.test.js`, `src/routes/dashboard.test.js`, `tests/dashboardCardsCore.test.js` | the card, and the invite check after `/dashboard` is sent (never on the cards' refresh) |
| `tests/coachingCore.test.js` | the page's day grouping across zones; the starts a page left open still offers |
| `src/services/coachingPayments.test.js` | wrong payee, amount, currency, booking or streamer refused; a replay and two concurrent returns record once; a lost capture read back; expiry reads back first; a late capture; no `donations`, overlay or tip module touched |
| `src/services/coachingRooms.test.js` (the tick included) | the overwrites, nothing outside the category, a failed step and Retry, a restart finishing or cleaning a `making` row, one transcript to each side then delete, `no_intent`, big files named, Discord down, `removeAllFor`, the tick |
| `src/discord.coaching.test.js`, `src/services/discordLogin.test.js` | the category permission check, the attachment hosts and size cap, the Message Content fallback |
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
