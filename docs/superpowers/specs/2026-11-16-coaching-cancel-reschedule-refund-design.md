# Coaching: cancel with a reason, reschedule, refunds — design

Date: 2026-11-16. Builds on Coaching (PR #12) and Coaching payment, rooms and sign-in first (PR #14, merge 25132a1; `docs/features/coaching.md`).

Marked **(my call)** = decided while writing this, not by the owner; the owner can overturn any of them.

## Why

Since PR #14 a viewer pays for a session up front, and once paid nobody can cancel it in the app. Coaches still need to call off or move sessions (illness, a clash), and today they have no way to do it, no way to tell the viewer why, and no record of who paid them, which they need to refund in PayPal. The owner wants:

- the coach to be able to cancel, always saying why and how the refund or a new time will happen;
- a Reschedule option where the coach either proposes a new time or asks the viewer to pick one, with a back-and-forth until they agree;
- the payer's PayPal name and email kept, so the coach can refund;
- a clear "refund pending → refunded" step, done by the coach.

## Goals

- **Cancel with a reason.** The coach's Cancel asks for a text: why, and how the refund or rescheduling will go. The viewer's cancellation message carries that text. The coach can now cancel a **paid** session (until it starts); this reverses PR #14's "no cancel after payment" for the coach only.
- **Reschedule**, on a confirmed session (paid or free), until it starts. The coach chooses one of two ways:
  1. **Propose a time**: the coach picks a time; the viewer accepts it or proposes another.
  2. **Ask the viewer**: the viewer gets a Discord message with a link and picks a new time; the coach accepts it or proposes another.
  Either way it becomes a **back-and-forth**: each side can answer the other's proposal by accepting it or proposing a different time, with an optional short note, any number of rounds.
  - The viewer's picker never offers the session's original time, nor any time already held by another booking.
  - No new payment: the session keeps its length, price and payment.
- **Time limits** (the owner):
  - a time the coach proposed that the viewer does not answer within **48 hours** lapses, and the viewer is asked to pick a time instead (way 2);
  - with no agreement within **7 days** of the reschedule starting, the reschedule closes as **not rescheduled** and, for a paid session, the refund step starts.
- **Refund step (manual).** A paid session that is cancelled by the coach, or closes without a new time, shows **Refund pending** on the coach's schedule (and a count on the Coaching card), with the payer's PayPal name and email and the PayPal transaction id. The coach refunds in PayPal, then presses **Refunded**; the viewer gets a message and the session reads Refunded.
- **The payer's PayPal details are saved**: name, email (and PayPal's payer id) from the verified order, shown only to that coach, on paid sessions. The Pay step tells the viewer the coach will see their PayPal name and email.
- **Text fix:** `coaching.error.bad_length` still says "Pick 30 minutes or 1 hour."; it must fit six lengths ("Pick one of the lengths on offer." or similar), in all 7 locales.

## Non-goals

- **Automatic refunds.** The viewer pays straight into the coach's PayPal, and PayPal lets only the receiving account (or a partner the coach granted refund permission through PayPal's partner programme, which PayPal must approve) refund it. Atleta never holds the money. A later project could add it; not this one.
- The viewer cancelling a paid session (still not allowed), or starting a reschedule.
- Changing a session's length or price while rescheduling.
- Rescheduling a request that is still waiting or awaiting payment (the coach declines or cancels those as today) **(my call)**.

## Anti-goals (a failure even if it works)

- **A viewer can make money move, or force a refund, by anything they do on the site.** Only the coach starts the paths that end in Refund pending (cancelling, or starting a reschedule that ends without agreement). Disputes a viewer opens inside PayPal are outside Atleta.
- Two bookings hold the same time (a proposed time must be held exactly like a booked one).
- The payer's email shown to anyone but that booking's coach, or kept after the booking is deleted.
- The coach has to go back to Discord DMs to know where a reschedule stands: the schedule shows it.

## How it works

### Cancel (coach)
- Cancel opens a pop-up with a required text, at most 500 characters **(my call; required for every cancel, paid or not, since the viewer always deserves a reason)**, then confirms.
- Allowed for waiting, awaiting payment, confirmed (paid or not) and rescheduling sessions, until the start.
- A cancelled paid session: its room and role are deleted at once (no transcript), the viewer's message carries the coach's text, and the booking gets **Refund pending**.
- The viewer's Withdraw stays as today: only before payment.

### Reschedule
- On a confirmed session before its start, **Reschedule** opens a pop-up: "Propose a time" (pick from the coach's calendar) or "Ask the viewer to pick", plus an optional note (at most 300 characters, like a booking note).
- The session becomes **Rescheduling**. Its **original time is released** at once (the viewer's picker leaves it out anyway) **(my call)**. The session's room and role stay.
- **A proposal** = one start time, who proposed it, when, an optional note. Only the latest proposal counts; it is **held** like a booking (the overlap check and the free-time lists treat it as taken), and a new proposal replaces it.
- **Who can propose what:**
  - the viewer picks from the coach's free starts (hours, days off, lead time, 14-day horizon, other bookings held), never the original time;
  - the coach picks any half-hour start in the next 14 days that is not held by another booking, even outside their weekly hours **(my call: the coach may offer an exception)**, at least 1 hour ahead.
- **Answers:** the side that did not propose sees Accept and "Propose another time". Accept → the session is **confirmed** at the new time, both are told, the room is kept and renamed to the new date (`coaching-<discord username>-<YYYY-MM-DD>`), and it closes 30 minutes after the new end.
- **Lapses:**
  - a coach's proposal unanswered for 48 h is dropped (its time freed) and the viewer is asked to pick (way 2);
  - a viewer's proposal unanswered for 48 h is dropped too and the coach is reminded **(my call: same rule both ways)**;
  - a proposal whose time comes within 1 hour is dropped;
  - 7 days after the reschedule started with no agreement: **not rescheduled**. Room and role deleted; a paid session → Refund pending; both told.
- The coach can still Cancel (with a reason) during a reschedule.
- The viewer's limits: a rescheduling session counts as one upcoming session (MAX_UPCOMING) and its proposals are not new requests (no `too_many`).

### Refund step
- Refund pending is set by: a coach cancel of a paid session; a reschedule that closes without agreement; and the existing late or double payments (`payment_issue` `late`/`double`), which today only message the coach **(my call: one place for every refund the coach owes)**.
- The schedule shows, on such a session: Refund pending, the amount, the payer's PayPal name and email, the PayPal transaction (capture) id, and a **Refunded** button (with a confirmation). The card shows a count of pending refunds with a link.
- Refunded → the session reads Refunded, the viewer gets a message ("<coach> refunded your coaching session"), nothing else changes. Atleta does not check PayPal: the button records what the coach says they did.

### Payer details
- Saved when a capture is verified, from the order's `payer` (`name`, `email_address`, `payer_id`), on the booking/payment row. Old paid bookings have none (the schedule then shows the transaction id only).
- Shown only to the booking's coach on the schedule. Deleted with the booking (90 days after its start) and with the account (Remove).
- The Pay step on the booking page says: "<coach> will see your PayPal name and email, in case they need to refund you."

### Messages (all through the existing coaching DMs; texts in 7 locales, pt in pt-PT)
To the viewer: cancelled (with the coach's reason); reschedule started (way 1 with the proposed time, way 2 with the link); a new coach proposal; agreed (new time and the room link); a coach proposal lapsed (pick a time, link); not rescheduled (with "your coach will refund you" for paid ones); refunded.
To the coach: the viewer proposed a time; agreed; a viewer proposal lapsed; not rescheduled (refund pending, for paid ones).

### States
New: `rescheduling` (holding: the session's proposal is held, the original time is not), `not_rescheduled` (end). Refund is a separate field on the booking (`refund_status`: none, `pending`, `refunded`, with `refunded_at`), since it can follow `cancelled`, `not_rescheduled` or a late/double payment.

## The coaching page in four tabs (the owner)

`/dashboard/coaching` is split into four tabs (the owner: "put the when i coach into a schedule tab, price on a price tab, discord and urls on a settings tab, the left side on a bookings tab"):

- **Bookings**: today's left card (titled "Schedule" today, renamed "Bookings"): the bookings by day, the last 30 days, and everything this design adds there (Cancel with a reason, Reschedule, proposals, Refund pending with the payer's details and Refunded).
- **Schedule**: "When I coach": the Bookings open switch, the seven days and their hours, time zone, days off.
- **Price**: "Lengths and prices": the six lengths, switches, prices, the currency note.
- **Settings**: "Where we meet": coaching server, coaching category, invite link, the fallback text, "Message me about new requests", and the booking link with Copy.

Bookings opens first; the last tab opened is remembered (localStorage `coaching_tab`, the project's tab convention, set on `<html>` before paint like the dashboard's tabs; an unknown value opens Bookings). One Save covers Schedule, Price and Settings as today **(my call: the save route stays one call; each of the three tabs shows the same Save button, and a refusal opens the tab of the field it names)**. The first save ("Save and open bookings") works from whichever tab it is pressed on. On a phone the tabs are a scrollable row.

## A bug to fix in the same pass

A **cancelled** confirmed free session still shows "Open the room" on the schedule (seen in production, 2026-11-16: a cancelled 30-min free booking). Cancelling a confirmed session, free or paid, must delete its room and role at once (no transcript), and no ended session (cancelled, declined, withdrawn, expired, not rescheduled) shows a room link.

## Settled after the builder check (all my calls)

1. **Refunds are tracked per payment, not per booking.** The refund status, payer name, email and payer id live on the `coaching_payments` row (one per capture). A booking can owe more than one refund (a double payment, then a cancel); the schedule lists each pending refund with its own payer and transaction id, and each has its own Refunded button. The booking itself shows "Refund pending" while any of its payments is pending.
2. **No backfill.** Only payments captured from this release on get payer details and the refund step. Today's `late`/`double` bookings keep their current warning; nothing old is marked pending (some may already be refunded).
3. **Time during a reschedule.** `starts_at` keeps the original time until a new time is agreed, then becomes the new time. Reschedule can be started only before the original start; once Rescheduling, the original start no longer limits anything: the coach can Cancel until the reschedule ends, and the room's close (and transcript) is paused while Rescheduling (the close is keyed on a confirmed session's end). The 90-day deletion uses the final `starts_at`.
4. **Back to the original time.** The coach may propose the original time (only the viewer's picker leaves it out), so a mistaken Reschedule can be undone by proposing the old time and the viewer accepting.
5. **The coach's new messages** about a viewer's proposal, an agreement, a lapse and "not rescheduled / refund pending" always go out, like today's late-payment warning, whatever the "Message me about new requests" switch says.
6. **An unpaid confirmed session being rescheduled** (a free length, or one confirmed before PR #14): the viewer can still Withdraw it, as today; a paid one, never.
7. **The coach's proposal may fall on a day off** as well as outside the weekly hours: it is the coach's own exception.

## Constraints (from the codebase)
- The rules stay pure in `services/coaching.js`; bookings in `services/coachingBookings.js`; rooms in `services/coachingRooms.js`; payments in `services/coachingPayments.js`; SQL only in `db.js`; migrations boot clean twice.
- Two proposals or a proposal and a request for overlapping times: exactly one wins (the same immediate transaction as `createCoachingBooking`).
- Lapses and the 7-day close run on the existing minute tick, survive a restart, and never fail on Discord being down.
- Every text through `t()` in 7 locales (pt-PT), CSRF on the new routes, rate limits like today's booking routes, tests never touch the network.

## Left to the builder
- Table and column names, route names, how the pop-ups look (in the existing schedule, card and booking-page patterns).
- Whether proposals live in their own table or on the booking.
- Exact texts (pt in pt-PT), and the reminder wording.
