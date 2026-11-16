# Coaching (booking sessions with a streamer)

A streamer who coaches (andre_vilela_ coaches iRacing drivers one-on-one in his Discord server) sets the hours he
coaches once, repeating every week. Viewers open one link, connect Discord, pick one of the streamer's lengths and ask
for a time. The streamer accepts or declines each request from one schedule, and Atleta tells both sides on Discord.
A paid length is confirmed only by a verified PayPal payment, and each paid session gets a private role and voice room
in the streamer's Discord server, with a chat transcript afterwards. It is for every streamer on the site and is
opt-in: a streamer has no booking page until they save their hours the first time.

Design: `docs/superpowers/specs/2026-10-29-coaching-design.md` (its mockup:
`docs/superpowers/specs/assets/2026-10-29-coaching-mockup.html`); plan: `docs/superpowers/plans/2026-10-29-coaching.md`. Payment, rooms and sign-in first (2026-11-16): brief and plan in
`docs/superpowers/plans/2026-11-16-coaching-payment-rooms.md`. Cancel with a reason, reschedule, refunds and the four
tabs (2026-11-16): spec `docs/superpowers/specs/2026-11-16-coaching-cancel-reschedule-refund-design.md`, plan
`docs/superpowers/plans/2026-11-16-coaching-cancel-reschedule-refund.md`; the coaches' guide is
`docs/guides/coaching-for-coaches.pdf`. The booking page in four steps and the My bookings page (2026-11-16): plan
`docs/superpowers/plans/2026-11-16-coaching-booking-in-steps-and-my-bookings.md`.

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

**Cancelling.**
- **The streamer** can cancel a waiting, awaiting-payment, confirmed (paid or free) or rescheduling session until it
  starts, and **must give a reason** (1 to 500 characters, `bad_reason`; line breaks become spaces). The viewer's
  message carries the reason. A cancelled confirmed session loses its room and role at once, with no transcript
  (`transcript_status = cancelled`; with Discord down the room row stays `closing` and `closeDue` finishes it). A
  cancelled **paid** session becomes **Refund pending** (below).
- **The viewer** can withdraw only before payment (waiting, awaiting payment, or an unpaid confirmed or rescheduling
  session, which also removes its room). **A viewer cannot cancel a paid session**: the route answers `paid` (409).
- No ended session (cancelled, declined, withdrawn, expired, not rescheduled) shows a room link. This fixes a bug seen
  on 2026-11-16: a cancelled free confirmed session still showed "Open the room".
- Atleta never refunds (the money is in the streamer's PayPal): the streamer refunds in PayPal and presses
  **Refunded**.
- Bookings confirmed before PR #14 (no price, nothing paid) keep Cancel and Withdraw and get no room.

**Rescheduling.** Only the streamer starts it, on a **confirmed** session (paid or free) before its start. See
[Reschedule](#reschedule).

A request nobody answered before its start time shows as **Not answered**. It is still stored as waiting; the state
is worked out when it is read (`coaching.bookingState`). Nobody is messaged about it.

| State | Stored | What it means |
|---|---|---|
| Waiting | `waiting` | asked for, held, not answered yet |
| Awaiting payment | `awaiting_payment` | accepted, held, waiting for the viewer's payment (`pay_by`) |
| Confirmed | `confirmed` | paid (`paid_at` set), or a free length the streamer accepted |
| Declined | `declined` | the streamer declined it |
| Cancelled | `cancelled` | the streamer cancelled it (with a reason; a paid one then owes a refund) |
| Withdrawn | `withdrawn` | the viewer cancelled it (before payment) |
| Expired | `expired` | not paid by `pay_by` |
| Rescheduling | `rescheduling` | the streamer started a reschedule; a proposal may be waiting for an answer |
| Not rescheduled | `not_rescheduled` | the reschedule ended without agreement (7 days) |
| Not answered | never stored | still `waiting` when its start came |

Waiting, awaiting-payment, confirmed and rescheduling bookings hold their time (`coaching.HOLDING`); the other states free it.
A rescheduling booking holds its **proposal** (and nothing at all while it has none), not its original time
(`_HELD_AT` in `db.js`, used by every overlap check and free-time list). It counts as one upcoming session of the
viewer (`MAX_UPCOMING`) even after the original start, and its proposals are not new requests (no `too_many`). A
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

## Reschedule

Only the streamer starts it. Code: `coachingBookings.js` (`startReschedule`, `coachPropose`, `coachAccept`,
`viewerPropose`, `viewerAccept`, `coachStarts`, `viewerStarts`, `runDueReschedules`), the rules in `coaching.js`.

- **Start.** On a confirmed session (paid or free) before its start, the coach chooses **Propose a time** (way
  `propose`) or **Ask the viewer to pick** (way `ask`), with an optional note (300 characters). The booking becomes
  `rescheduling`, `reschedule_started_at` is set and `original_starts_at` keeps the old time. The room and role stay,
  and the room's close is paused while the booking is rescheduling.
- **Proposals.** There is one proposal on the booking (`proposal_starts_at`, `proposal_by` `coach` or `viewer`,
  `proposal_at`, `proposal_note`); only the latest counts and a new one replaces it. It is **held** like a booking
  (overlap checks and free-time lists treat it as taken), and the original time is released at once.
  - The viewer picks from the coach's free starts (hours, days off, the one hour of notice, 14 days, other bookings
    held) and **never the original time** (`GET /coaching/:username/bookings/:id/starts`).
  - The coach picks any half-hour start in the next 14 days, at least 1 hour ahead, not held by another booking,
    **even outside the weekly hours or on a day off** (an exception of their own), and may propose the original time,
    which undoes a mistaken reschedule (`GET /dashboard/api/coaching/bookings/:id/proposal-starts`).
  - Two proposals, or a proposal and a request, for overlapping times: exactly one wins (an immediate transaction like
    `createCoachingBooking`; the loser gets `taken`, or `bad_time` for a time no longer on offer).
- **Answers.** The side that did not propose can accept or propose another time, with a note, any number of rounds. A
  side cannot answer its own proposal (`not_yours_to_answer`). A proposal less than 1 hour away cannot be accepted
  (`proposal_too_close`). **Accept** makes the booking `confirmed` at the new time (`starts_at` changes only now), both
  sides are told (with the room link), the role and channel are renamed to the new date
  (`coaching-<discord username>-<YYYY-MM-DD>`, the naming is unchanged; a rename that fails is only logged) and
  `close_at` moves to 30 minutes after the new end. No new payment: the length, price and payment stay.
- **Lapses** (the minute tick, `runDueReschedules`, which survives a restart and never fails on Discord being down):
  - a coach's proposal unanswered for **48 hours**, or whose time comes within 1 hour, is dropped and the viewer is
    asked to pick a time instead (way `ask`, with the `?booking=<id>` link);
  - a viewer's proposal that lapses the same way is dropped and the coach is reminded;
  - **7 days** after the reschedule started with no agreement, the booking ends as `not_rescheduled`: the room and
    role are deleted (no transcript), both are told, and a paid session becomes **Refund pending**.
- **Cancel** still works during a reschedule. The viewer's Withdraw still works on an unpaid one, never on a paid one.
- The coach's messages about a viewer's proposal, an agreement, a lapse and "not rescheduled" **always go out**, like
  the late-payment warning, whatever "Message me about new requests" says.
- A booking's views carry `proposal { startsAt, by, note, at }`, `rescheduleStartedAt`, `rescheduleEndsAt` and
  `originalStartsAt` (no payer data). The 90-day cleanup uses the final `starts_at`.

## Refunds

Atleta **never refunds**: the viewer pays straight into the coach's PayPal, and only that account can refund it.
Atleta records what the coach says they did and does not check PayPal. Refunds are tracked **per payment**
(`coaching_payments`), because a booking can owe more than one (a double payment, then a cancel).

- **Payer details.** When a capture is verified, the order's `payer` is stored on the payment row: `payer_name`,
  `payer_email` (up to 254 characters) and `payer_id`. They are never logged. They go only to the booking's own coach,
  in the `refunds` list of the schedule's booking views, and never in the viewer's views, the dashboard card's views,
  a Discord message or a log. They are deleted with the booking (90 days after its start) and with the account
  (Remove). There is **no backfill**: payments from before this release have no payer details and no refund step; a
  late or double payment from before keeps its current warning.
- **Refund pending** (`refund_status = 'pending'`, with `refund_reason`, `refund_pending_at`) is set only by:
  a coach's cancel of a paid session; a reschedule that closes without agreement; and a late or double capture of a
  payment (the cases that used to only message the coach). **A viewer can never start one.** The booking shows Refund
  pending while any of its payments is pending.
- **Refunded.** The coach refunds in PayPal, then presses **Refunded** on the schedule (after a confirmation):
  `POST /dashboard/api/coaching/payments/:orderId/refunded` sets `refund_status = 'refunded'` and `refunded_at`, and
  the viewer gets a message ("<coach> refunded your coaching session"). Another streamer's payment answers 404, one
  not pending `not_pending` (409).
- Every captured payment is in the coach's `refunds` list (status null when nothing is owed); `cardData.refundsPending`
  counts the pending ones for the Coaching card.

## The streamer's side

### The coaching page

`/dashboard/coaching` (`src/routes/coachingDashboard.js`, `src/views/coaching-dashboard.ejs`,
`public/js/coaching-dashboard.js`) sits behind the dashboard's login and disabled-account check. It has **four tabs** (below) and, in the Bookings tab, the schedule.

**The four tabs.** Bookings (opens first), Schedule, Price and Settings. The last tab opened is remembered in
`localStorage` (`coaching_tab`) and named on `<html data-coaching-tab>` before paint, like the dashboard's tabs; an
unknown value opens Bookings; `?tab=` in the address wins (the card's refunds link uses `?tab=bookings`). On a phone
the tabs are a scrollable row (arrow keys move between them). One form (`#cd-form`) wraps Schedule, Price and
Settings, each with the same Save button and one save route; a refused save opens the tab of the field it names. The
first save ("Save and open bookings") works from any of the three. Bookings is outside the form.

**Bookings** (the schedule).
- The bookings not over yet, grouped by day in the streamer's zone. Each shows its time, the viewer's Discord name
  and `@username`, its length, its note and its state.
- Each booking also shows its price. Awaiting payment shows a pill with "Pay by <time>"; a paid session shows a Paid
  pill with the amount.
- Actions:
  - a waiting request has ✓ (Accept) and ✕ (Decline, after a confirmation). Accept answers `no_paypal` or `too_close`
    in the message line when it cannot;
  - **Cancel** (any waiting, awaiting-payment, confirmed or rescheduling session, paid too) opens a pop-up with a
    required reason (500 characters); an empty reason is refused;
  - **Reschedule** (a confirmed session before its start) opens a pop-up: "Propose a time" (a day and time from
    `GET /dashboard/api/coaching/bookings/:id/proposal-starts`) or "Ask the viewer to pick", plus an optional note
    (300 characters);
  - a rescheduling session shows its state (the proposal, who made it, its note, when it lapses, and the 7-day end).
    A viewer's proposal has **Accept** and "Propose another time" (the same pop-up, propose only).
  The dialogs are native `<dialog>`s: Esc and a click on the backdrop close them.
- A session that owes a refund shows **Refund pending**, then for **each pending payment** its amount, the payer's
  PayPal name and email, the PayPal transaction (capture) id and a **Refunded** button (after a confirmation).
  Payments from before this release have no payer details, so only the transaction id shows. A Refunded session reads
  Refunded.
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

**Schedule** (the second tab, When I coach).
- **Bookings open**: its switch sits in the tab's head and saves as it moves.
- The seven weekday rows.
- The time zone (with the zone list `Intl` knows) and the days off.

**Price** (the third tab, Lengths and prices).
- **Lengths and prices**: six rows, each with a switch and a price in the tip page's currency. They save with the rest
  (`lengths`; `bad_lengths` for a bad price, `no_length` when all are off). The first save sets `prices_saved_at`.
- Two notes: the PayPal email is missing (a link to `/dashboard/donations`), and "Check your prices" for a
  non-EUR currency that has not saved prices.

**Settings** (the fourth tab, Where we meet).
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
  - Notes: the PayPal email missing, check your prices, the number of sessions whose room failed, and **N refunds to
    make** (`refundsPending`) with a link to `/dashboard/coaching?tab=bookings`. The card's views never carry payer
    details.
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

**The four steps.** The page is a wizard with a "Step N of 4" bar, a heading that takes focus on every change, and
**Back** (it keeps the chosen length, time and note). `stepFor(state)` in `public/js/coaching-core.js` picks the
first step: no viewer is 1, a viewer the bot does not see in the server (`member === false`) is 2, otherwise 3
(Discord unable to say, `member` null, counts as 3). `backStep` goes back one.
1. **Connect Discord.** Printed by the server for a visitor: the coach's name and picture, a short "how it works" and
   **Connect Discord**. No times are in the page until a viewer is signed in.
2. **Join the server** (below): the invite and "I've joined".
3. **Length and time.** The streamer's lengths that are on (`state.lengths`, each with its price or "Free", only
   those with a free start), the strip of days with the empty ones dimmed, the free times of the chosen day (in the
   viewer's browser zone, grouped by the viewer's own days: a viewer in Tokyo sees Lisbon's 18:00 to 22:00 as 02:00 to
   06:00 the next day) and, with a time picked, a summary. At the limit of 2 upcoming bookings, or with no length,
   the step shows only the limit text.
4. **Note and request.** "What do you want to work on? (optional)" and **Request this time**. A sent request goes to
   `/my-bookings?booking=<id>&new=1`, where "Request sent, waiting for <coach>" is shown.

The page also has a "booking as <Discord name>" bar ("not you?" signs a viewer out; for a streamer booking as their
own account it leads to the viewer sign-in) and, when the viewer has bookings with this coach, "You have N bookings
with <coach> - My bookings". **The list of bookings, Pay, Withdraw and the reschedule panel are no longer on this
page: they live on My bookings (below).** A page that is not bookable shows "<streamer> is not taking new bookings
right now." instead of the steps.

**Who can see it.**
- The streamer is found by their linked Twitch login, as the tip page does (`db.getStreamerByUsername`).
- An unknown name, a disabled account, or a streamer who never saved coaching hours answers 404 with "Coaching page
  unavailable.", in the same form `/tip/<unknown>` answers.
- The page stands alone like `tip.ejs`, with `csrf.ejs` in its `<head>` and no `header.ejs`. The site header's "Login
  with Discord" would sign a visitor in as a streamer.

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
now." and shows no times. A viewer's bookings stay on My bookings (pay, withdraw), and accept, decline and
cancel keep working for the streamer.

**Refreshing.** The page reads `GET /coaching/<login>/state`:
- once on load, for the membership (and so the first step);
- after every action, and on "I've joined" (with `?recheck=1`);
- when its tab is shown again after a minute away.

Between two reads, the page drops a start that has come inside the hour of notice (`leadMs` in the state,
`bookableStarts` in `public/js/coaching-core.js`), as the server would refuse it.

## My bookings

`/my-bookings` (`src/routes/myBookings.js`, `src/views/my-bookings.ejs`, `public/js/my-bookings.js`) is the viewer's
own page across **every coach**. It stands alone like the booking page (no `header.ejs`, `csrf.ejs` in `<head>`).
- **Signed out:** the title, a short intro and **Connect Discord** (`/auth/coaching-signin`, no coach).
- **Signed in:** "Signed in as <name>" with a sign-out form (a streamer signed in to the site sees their own bookings
  as a viewer, with a "not you?" link instead), then **To come** and **Past** lists (the last 30 days and to come).
  Each row has the coach's picture and name (linking to `/coaching/<login>`), the date in the viewer's zone, the
  length, the price and the state pill, and per state what the booking page used to show: Pay with its deadline,
  Withdraw (unpaid only), the room link or the "where" text, the coach's cancel reason and the Refund pending or
  Refunded line, and the reschedule panel (Accept, Propose another time, Pick a new time; the picker reads the
  coach's free starts). No payer details appear.
- **The actions call the per-booking coach routes** (`/coaching/<coach login>/bookings/<id>/pay`, `/cancel`,
  `/starts`, `/propose`, `/accept-proposal`), so their rules, limiters (`coachingPayLimiter`,
  `coachingRescheduleLimiter`) and CSRF are unchanged. A coach who stopped coaching (disabled, or hours never saved)
  shows `available: false`: the row has its state and a note, and no actions.
- **The query string:** `?booking=<id>` scrolls to and highlights the booking (and opens the picker for a "pick"
  case); `&new=1` shows "Request sent, waiting for <coach>"; `&paid=1` or `&error=<code>` (with `&order=<id>` for
  `pay_unconfirmed`, which offers **Check again**) show the payment's result. Every viewer Discord message links to
  `?booking=<id>`.
- **`GET /my-bookings/state`** answers `{ viewer, bookings }` for the signed-in viewer (401 without one,
  `Cache-Control: private, no-store`). It reads by the session's own Discord id (`db.getViewerBookingsAllCoaches`),
  builds each booking with the viewer view (`forViewer`, never payer details), and carries `coach { login, name,
  avatar, available }` per booking.
- The home page's hero has a "Coaching bookings" button to `/my-bookings`.

## The viewer's sign-in

The viewer signs in with Discord with the `identify` scope only, and the sign-in **never creates a streamer**. The
streamer login, `/auth/login`, creates a `streamers` row for anyone who signs in, so it could not be used as it is.

**Starting the sign-in.** `GET /auth/coaching-signin?for=<login>` (from a booking page) or `GET /auth/coaching-signin`
(without `for`, from My bookings) sends the viewer to Discord with the same
`redirect_uri` as the streamer login, `<APP_URL>/auth/login/callback`.
- Discord only accepts redirects registered on the application, and reusing that one means the Discord application
  needs no change.
- The route sets `oauth_state` and `oauth_purpose = 'coaching:<login>'`, both short-lived cookies (10 minutes).
- Without `for` the purpose is the bare `coaching:`; the callback then lands on `/my-bookings`.
- It answers 404 with the page's own text for a login that has no booking page up (an empty or repeated `for` is 404 too).

**The callback.** `/auth/login/callback` reads and clears `oauth_purpose` only after the state matched, so a stray
callback cannot leave a coaching sign-in without its purpose.
- A purpose that names something other than a Twitch login answers 400 before Discord is asked anything.
- Otherwise it makes Discord's token and `@me` calls (10 s each), stores a viewer session and redirects to the
  coaching page, or to `/my-bookings` when the purpose names no coach.
- It returns before `upsertStreamerDiscord`: no `streamers` row, no dashboard and no streamer session.
- `/auth/login` clears a leftover `oauth_purpose`, so a coaching sign-in abandoned half-way cannot turn the next
  streamer login into a viewer's.

**The viewer session.**
- The cookie is `viewer_session`: a random 64-character hex id that lasts 7 days, httpOnly, SameSite Lax, and secure
  in production.
- The row in `viewer_sessions` holds only the id's hash (`db.hashSessionId`, as the streamers' sessions do), with the
  Discord id, username, display name and avatar.
- `POST /auth/coaching-signout` (the "not you?" form) deletes it, and goes back to the coaching page, or to
  `/my-bookings` when sent without a valid `for`.
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
- **Every message to a viewer ends with "See all your bookings"**, linking to `<APP_URL>/my-bookings?booking=<id>`
  (`myBookingsUrl`, `coaching.message.myBookings`); the pick-another, pay and booking links stay. The streamer's
  messages are unchanged.
- The texts are built in `src/services/coachingMessages.js` from the `coaching.message.*` keys.

| To | When | Says |
|---|---|---|
| Viewer | accepted (a free length) | "<streamer> accepted your coaching session", when, length, the server's name, the room link or "Where the session happens", the invite |
| Viewer | accepted (a paid length) | the price, the pay-by time and the booking link to pay |
| Viewer | confirmed (payment verified) | the paid amount, when, length, the room link (`<#channel>`) or the where text |
| Viewer | expired (not paid in time) | the booking link to pick another time |
| Viewer | declined | "<streamer> declined your coaching request", when, length, the booking link to pick another time |
| Viewer | cancelled by the streamer | "<streamer> cancelled your coaching session", when, length, **the coach's reason**, "your coach will refund you" for a paid one, the booking link |
| Viewer | reschedule started | way `propose`: the proposed time and note; way `ask`: the link to pick a time |
| Viewer | a new proposal from the coach | the time, the note, the booking link |
| Viewer | agreed | the new time and the room link |
| Viewer | a coach proposal lapsed | pick a time instead (the link) |
| Viewer | not rescheduled | the 7 days passed ("your coach will refund you" for a paid one) |
| Viewer | refunded | "<streamer> refunded your coaching session" |
| Streamer | a new request | "<viewer> asked for a coaching session", when, length, the note, a link to `/dashboard/coaching` |
| Streamer | the viewer cancelled | "<viewer> withdrew their coaching request", when, length |
| Streamer | paid | "<viewer> paid for their session", amount, when |
| Streamer | not paid in time | the booking expired and the time is free again |
| Streamer | a payment for an expired booking | refund it in PayPal (always sent, even with notifications off; the payment is also marked Refund pending) |
| Streamer | the viewer proposed a time | the time and note (always sent) |
| Streamer | agreed | the new time (always sent) |
| Streamer | a viewer proposal lapsed | a reminder (always sent) |
| Streamer | not rescheduled | the 7 days passed; Refund pending for a paid one (always sent) |
| Viewer and streamer | the transcript | the room's chat as a `.txt` file, with the shared files (below) |

- **Nothing is sent** to the viewer for their own cancel, or to anyone for a request nobody answered. The cancel
  reason, a proposal's note and the names go through `escapeLinkText()` like the other typed text.
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
   (`recordCoachingPayment`: `recorded`, `duplicate`, `late_confirmed`, `late_issue`, `double`). The payment row also
   stores the payer's PayPal name, email and id (from the verified order; see Refunds). The confirmation messages go
   out and the room is made.
4. **A late capture** (the booking already expired): the payment is recorded; if its time is still free the booking is
   confirmed, otherwise it stays expired with `payment_issue = 'late'`, the payment is **Refund pending** and the
   streamer is told to refund it in PayPal. A second capture on a paid booking (`double`) is marked pending too.
5. **Expiry** (the tick): `expireDue` reads back every open order of an unpaid booking past `pay_by` before expiring
   it (a capture found confirms it instead). If PayPal cannot be asked, it waits up to 30 minutes past the deadline.
   The update skips a paid row, so a payment that lands in between wins.
6. **Stale orders.** `reconcileStale` reads each order still `created` after 24 hours once, then records, refuses or
   drops it (kept up to 72 h when PayPal cannot be reached).

The return **lands on My bookings**: `/my-bookings?booking=<id>&paid=1` or `…&error=<code>` (with `&order=<id>` for
`pay_unconfirmed`); the booking id is added only when the order's booking belongs to this streamer.

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
- **Removal on cancel.** A coach's cancel (or a viewer's withdraw) of a confirmed or rescheduling session, and the
  7-day close of a reschedule, delete the role and channel at once through `coachingRooms.removeFor(bookingId)`, with
  no transcript.
- **Reschedule.** `coachingRooms.reschedule(bookingId)` renames the role and channel to the new date, moves
  `close_at`, and makes a room if a confirmed session has none. A rename that fails is only logged.
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
3. `reschedules` (`runDueReschedules`): proposals past 48 hours or inside the last hour are dropped, and reschedules
   7 days old are closed (room removed, refund pending for a paid one, both told);
4. `finishOrCleanMaking`: half-made rooms from a run that is gone;
5. `closeDue`: rooms past `close_at` get their transcripts and are deleted (a rescheduling session's room is skipped).

None of it needs Discord to be up: the room steps wait for it.

## Routes

The public routes are in `src/routes/coaching.js`, mounted at `/coaching`. They are not under `/api`, so only the
general limit applies, except pay and return (`coachingPayLimiter`, 15 per 10 minutes) and the three reschedule routes
(`coachingRescheduleLimiter`, 30 per 10 minutes per visitor).

| Route | Does |
|---|---|
| `GET /coaching/:username` | the page (sent without asking Discord) |
| `GET /coaching/:username/state` | the page's state as JSON (below) |
| `POST /coaching/:username/book` | JSON `{ startsAt, minutes, note }` → `{ ok: true, booking, unverified }` |
| `POST /coaching/:username/bookings/:id/cancel` | the viewer's own booking, before payment and until it starts → `{ ok: true, booking }` (Withdrawn); a paid one answers `paid` |
| `GET /coaching/:username/bookings/:id/starts` | the free starts for a reschedule of the viewer's own rescheduling booking (never the original time) → `{ ok: true, minutes, starts }` |
| `POST /coaching/:username/bookings/:id/propose` | JSON `{ startsAt, note }` → `{ ok: true, booking }` |
| `POST /coaching/:username/bookings/:id/accept-proposal` | accepts the coach's proposal → `{ ok: true, booking }` |
| `POST /coaching/:username/bookings/:id/pay` | the viewer's own awaiting-payment booking → `{ ok: true, approveUrl }` (the PayPal page) |
| `GET /coaching/:username/paid?token=<order>` | PayPal's return: captures and verifies, redirects to `/my-bookings?booking=<id>&paid=1` or `&error=` (`late`, `pay_invalid`, `pay_unconfirmed` (with `&order=`), `not_paid`, `paid`, `pay_closed`) |

`GET /coaching/:username/state` answers
`{ open, bookable, lengths: [{ minutes, priceCents }], currency, slots: { <minutes>: [...] }, viewer, member, inviteUrl, guildName, bookings, maxUpcoming, horizonDays, leadMs }`:
- `slots` holds the free starts as UTC milliseconds for each offered length, and none while the page is not bookable;
- `lengths` are the offered lengths only (on, and payable: a paid one needs the PayPal email);
- a viewer's bookings (the booking page reads only the count, for its "My bookings" line) carry `priceCents`, `payBy`, `paid`, `roomUrl` (only for confirmed or rescheduling ones), `whereText` for confirmed ones, `cancelReason`, `refundState` and `refundPending` (never payer details), and for rescheduling ones `proposal`, `rescheduleStartedAt`, `rescheduleEndsAt` and `originalStartsAt`;
- `member` comes only with a viewer, and Discord is asked only while the page is bookable (its answer kept 30 s;
  `?recheck=1` asks again, see Join first);
- `leadMs` is the hour of notice (`LEAD_MS`), for the page to drop starts that come inside it while it stays open;
- `guildName` is the bot's name for the server, else the one stored with the claim.

The sign-in routes are in `src/routes/auth.js`: `GET /auth/coaching-signin[?for=<login>]`, the coaching branch of
`GET /auth/login/callback`, and `POST /auth/coaching-signout[?for=<login>]`.

The viewer's own page, in `src/routes/myBookings.js`, is not under `/api` (only the general limit applies): `GET
/my-bookings` (the page, 200 signed out) and `GET /my-bookings/state` (JSON, see My bookings).

A refusal is `{ ok: false, code, error }`, the error being the code's text in the page's language:

| Code | Status |
|---|---|
| `bad_length`, `bad_note`, `bad_time` (a time not on offer) | 400 |
| `signin` | 401 |
| `unavailable` (the page is not up), `not_found` (another viewer's booking, or another streamer's) | 404 |
| `not_open`, `join_first`, `bad_time`, `taken`, `limit`, `too_late` (the session has started), `not_active` (already answered or withdrawn), `no_paypal`, `paid` (no cancel after payment), `not_awaiting`, `pay_closed`, `not_rescheduling`, `no_proposal`, `not_yours_to_answer`, `proposal_too_close` | 409 |
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
| `POST /dashboard/api/coaching/bookings/:id/cancel` | JSON `{ reason }` (required, 1 to 500) |
| `POST /dashboard/api/coaching/bookings/:id/reschedule` | JSON `{ way: 'propose' \| 'ask', startsAt?, note? }` → `{ ok: true, booking }` |
| `POST /dashboard/api/coaching/bookings/:id/propose` | JSON `{ startsAt, note? }`: the coach's next proposal |
| `POST /dashboard/api/coaching/bookings/:id/accept-proposal` | accepts the viewer's proposal |
| `GET /dashboard/api/coaching/bookings/:id/proposal-starts` | `{ ok, minutes, starts }`: the half-hour starts the coach may propose (about 670) |
| `POST /dashboard/api/coaching/payments/:orderId/refunded` | the coach's word that the refund was made → `{ ok, orderId, booking }` |
| `POST /dashboard/api/coaching/bookings/:id/room` | Retry room → `{ ok: true, booking }` |

Their refusal codes:

| Code | Status |
|---|---|
| `bad_reason`, `bad_way`, `bad_note`, `bad_time`, `bad_zone`, `bad_hours`, `bad_days_off`, `bad_server`, `bad_invite`, `invite_other_server`, `bad_where`, `bad_lengths`, `no_length`, `bad_category`, `category_not_found`, `category_permissions` (with `missing`), `bad_switch` | 400 |
| `not_found` | 404 |
| `not_set_up`, `too_late` (the session has started), `not_waiting`, `not_active`, `no_paypal`, `too_close`, `paid`, `no_category`, `room_not_failed`, `room_busy`, `not_confirmed`, `taken`, `not_rescheduling`, `no_proposal`, `not_yours_to_answer`, `proposal_too_close`, `not_pending` | 409 |
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
  `paypal_order_id`, `paypal_capture_id`, `payment_issue` (`late`);
- the reschedule and the cancel: `reschedule_started_at`, `reschedule_way` (`propose` or `ask`), `proposal_starts_at`,
  `proposal_by` (`coach` or `viewer`), `proposal_at`, `proposal_note`, `original_starts_at`, `cancel_reason`. They are
  added only when missing, with no log line.

A status changes only from the states the action allows (`setCoachingBookingStatus` checks them in SQL), so two
answers to one request cannot both win. Bookings are deleted 90 days after their start (`cleanupOldCoachingBookings`,
in the daily housekeeping of `src/index.js`).

**`coaching_payments`**: one row per PayPal order, `order_id` (primary key), `booking_id`, `streamer_id`,
`amount_cents`, `currency`, `payee_email`, `payee_merchant_id`, `status` (`created`, `captured`, `refused`),
`capture_id` (unique when set), `created_at`, `captured_at`, and since the cancel, reschedule and refund release
`payer_name`, `payer_email`, `payer_id`, `refund_status` (NULL, `pending` or `refunded`), `refund_reason`,
`refund_pending_at`, `refunded_at` (index `idx_coaching_payments_refund` on `(streamer_id, refund_status)`). Not part of `donations`. Rows still `created` after 24 hours
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

- **Automatic refunds.** Atleta cannot refund: the money is in the streamer's PayPal, and only that account (or a
  partner PayPal has approved) can refund it. Atleta tracks Refund pending and Refunded by the coach's word and never
  checks PayPal.
- **The viewer cancelling a paid session** (still `paid`, 409), or starting a reschedule.
- **Changing a session's length or price** while rescheduling, or rescheduling a request that is still waiting or
  awaiting payment (the coach declines or cancels those).
- **Voice recording or transcription.** Transcripts are text chat only.
- **A staff or moderator role** for the rooms (owner and Administrators see them by Discord's rule), a payments
  history or CSV, and rooms for bookings made before this release.
- **Reminders and calendars.** There are no reminders before a session, no calendar files (.ics) and no calendar
  sync.
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
| `src/routes/auth.test.js` | the coaching sign-in creates a viewer session and no `streamers` row; a sign-in without the purpose still creates a streamer; a bad purpose is refused before Discord is asked; the coach-less sign-in lands on `/my-bookings`, a repeated or empty `for` is 404 |
| `src/routes/myBookings.test.js` | the page signed out and in, `/my-bookings/state` (401, own bookings only, no payer details, unavailable coach), the script reads only the texts it is handed, the sign-out form, `<` escaped |
| `src/routes/coaching.test.js` | the page, `state` (with `?recheck=1`), booking and cancelling (`not_active`, `too_many`); names and notes holding `<script>` print as text |
| `src/server.app.test.js`, `src/server.wiring.test.js` | a booking and a pay need the viewer session's CSRF token, on the real `server.js`; the pay limiter is wired; a disabled streamer's web session gives no viewer |
| `src/routes/coachingDashboard.test.js` | the settings save, open, accept, decline and cancel (with its reason), reschedule, proposal and refund routes, another streamer's booking, the four tabs, the schedule, the invite check after the page |
| `src/services/coachingTick.test.js` | the minute tick's steps, one failing step not stopping the others, the reschedule step |
| `src/services/dashboardCards.test.js`, `src/routes/dashboard.test.js`, `tests/dashboardCardsCore.test.js` | the card, and the invite check after `/dashboard` is sent (never on the cards' refresh) |
| `tests/coachingCore.test.js` | the page's day grouping across zones; the starts a page left open still offers; `stepFor` and `backStep` |
| `src/services/coachingPayments.test.js` | wrong payee, amount, currency, booking or streamer refused; a replay and two concurrent returns record once; a lost capture read back; expiry reads back first; a late capture; no `donations`, overlay or tip module touched |
| `src/services/coachingRooms.test.js` (the tick included) | the overwrites, nothing outside the category, a failed step and Retry, a restart finishing or cleaning a `making` row, one transcript to each side then delete, `no_intent`, big files named, Discord down, `removeAllFor`, the tick |
| `src/discord.coaching.test.js`, `src/services/discordLogin.test.js` | the category permission check, the attachment hosts and size cap, the Message Content fallback |
| `tests/streamerViewsI18n.test.js`, `tests/i18nViewsPart1.test.js`, `tests/i18n.test.js` | both pages and the card in all seven languages |

Run the unit suite as usual: `node --test "src/**/*.test.js" "tests/**/*.test.js"`.

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
