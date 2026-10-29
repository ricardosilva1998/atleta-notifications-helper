# Coaching: booking sessions with a streamer — design

Date: 2026-10-29. Mockup: `assets/2026-10-29-coaching-mockup.html` (the owner saw a first version and asked for a tighter UI; the file is the tightened one).

Marked **(my call)** = decided while writing this, not by the owner; the owner can overturn any of them.

## Why

andre_vilela_ coaches iRacing drivers one-on-one in the Coaching Room voice channel of his Discord server (Vilela's Garage). Today `!coaching` in his Twitch chat hands out a Discord invite, and people then message him at random times to agree on a session. He loses track of who asked for what. (The same day, that invite had expired and nobody could get in at all: a dead link in a chat command is the whole booking system today.)

The owner wants coaching to have one place: the streamer says when he is free, people book a time, and he sees every booking in one schedule.

## Goals

- A streamer sets the hours he coaches, once, repeating every week.
- A viewer opens one link, sees only the times still free, picks 30 minutes or 1 hour, and asks for a time.
- The streamer sees every request and every accepted session in one schedule, and accepts, declines or cancels from it.
- Atleta tells the viewer on Discord when the streamer accepts, and when he cancels.
- Atleta tells the streamer on Discord when a request arrives and when a viewer cancels.
- Viewers are in the streamer's Discord server before they book, so they know where the session happens and Atleta can message them.
- It works for every streamer on the site, not only andre_vilela_ (the owner: "do it for everyone").

## Non-goals

- **Payment.** Whatever a streamer charges is arranged outside the app (the owner).
- Reminders before a session, calendar files (.ics), Google Calendar sync.
- Group sessions, several coaches per streamer, different session types or prices.
- Rescheduling as one action: the streamer cancels and the viewer books again.
- Video or voice inside the site: the session happens wherever the streamer coaches (for andre, his Discord's Coaching Room).

## Anti-goals (a failure even if it works)

- Viewers who sign in to book end up with a streamer account, a dashboard, or rows in `streamers`. They are viewers, nothing more.
- Two people get the same time.
- The streamer has to go back to Discord messages to find out who booked what. The schedule must be enough.
- The pages look like a generic admin or calendar product. They must look like the Atleta site: its dark cards, purple accent, Outfit and DM Sans, compact (the owner: "tighten the UI a little bit"; see the dashboard design memory: cards, not admin panels).

## How it works (the owner's decisions)

1. **The streamer's hours.** Set once, repeating every week; andre's are usually 18:00 to 22:00.
2. **Length.** A session is 30 minutes or 1 hour, and the **viewer chooses** when booking.
3. **Sign-in.** The viewer signs in with Discord, and the streamer sees their Discord name on the booking.
4. **Held, then accepted.** A booked time is **held at once** (nobody else can take it), but it counts only once the **streamer accepts** it.
5. **Confirmation.** When the streamer accepts, **Atleta sends the viewer a Discord message** with the time.
6. **Cancel.** The streamer can **cancel at any time**, and Atleta sends the viewer a Discord message saying it was cancelled.
7. **Everyone.** Any streamer can use it.
8. **Join first** (after the builder check). A viewer who is not in the streamer's Discord server is shown the streamer's invite and joins before booking.
9. **The streamer is told** (after the builder check). Atleta messages the streamer on Discord about every new request, with a switch to turn it off.
10. **The viewer can cancel** (after the builder check) their own booking until it starts; the time frees up and the streamer is told.

## The viewer's side

**The booking page**, `/coaching/<twitch login>` (my call: the same address scheme as the tip page `/tip/:username`, found with `db.getStreamerByUsername`; a disabled account, a streamer who never set coaching up, or an unknown name answers like an unknown streamer). It is public and needs no sign-in to look at.

**Open or paused (my calls).** Coaching is opt-in: a streamer has it once they save their hours the first time, and saving them opens bookings. After that there is one switch, **Bookings open**, the same one on the card and in the header of "When I coach". While it is off, the booking page still answers: it says the streamer is not taking new bookings right now, shows no free times, and still shows a signed-in viewer their own bookings (so `!coaching` never leads to a page that looks broken). Accepting, declining and cancelling keep working while paused.

- Header: the streamer's picture and name, "Times in your time zone (<zone>)", and the 30 min / 1 h choice.
- A strip of days, from today to **14 days ahead (my call)**; days with no free time are dimmed.
- The free start times of the chosen day for the chosen length. Taken and past times are left out, not shown crossed out (my call, the tightening).
- "Sign in with Discord to book". Once signed in: "Booking as <Discord name>" with "not you?" (signs out), an optional note "What do you want to work on?" (my call, at most 300 characters), and **Request this time**.
- After a request: the page says the time is held and that Atleta will message them on Discord once the streamer accepts.
- **Your bookings**: the signed-in viewer's own bookings with this streamer and their state (Waiting, Confirmed, Declined, Cancelled, Withdrawn, Not answered). A waiting or confirmed booking has **Cancel** until it starts (the owner); it becomes **Withdrawn** (my call: its own state, so the schedule shows who cancelled), frees the time and the viewer's place under the limit, and the streamer is told (below). The viewer gets no message for their own cancel (my call).

**Join first (the owner).** Once signed in, the page asks the bot whether the viewer is a member of the streamer's coaching server (below). If not, it shows "Join <server name> first", the streamer's invite as a button, and "I've joined" to check again; **Request this time** appears only once they are in. If the bot cannot answer (Discord down or not ready), the page lets them book and says Atleta may not be able to message them (my call: an outage does not stop bookings). A viewer who leaves the server later is covered by the undelivered-message rule below.

**Times.** Shown in the viewer's browser time zone and named on the page (my call). The streamer's hours are kept in the streamer's own time zone (below), so a viewer abroad sees the right local times.

**Slots (my calls).** Start times fall on the hour and the half hour inside the streamer's hours. A session must end by the end of the window: with 18:00–22:00 the last 1 h start is 21:00 and the last 30 min start is 21:30. A 1 h session needs both half hours free. A time can be booked until **1 hour before it starts**.

**Limits (my calls).** A viewer can have at most **2 upcoming bookings** (waiting or confirmed) with one streamer, so one person cannot hold a whole evening. The page says so when they reach it.

**Signing in.** A sign-in of its own, with Discord's `identify` scope, that **never creates a streamer** and never opens the dashboard (today's `/auth/login` creates a `streamers` row for anyone who signs in, so it cannot be reused as is). A streamer already signed in to the site books as their own Discord account without a second sign-in (my call). The viewer's sign-in lasts 7 days like the streamer's (my call).

## The streamer's side

**The Coaching card** on the dashboard's Twitch tab, with the other working cards (my call: placed after Giveaways):

- Not set up: one setup step, "Set your coaching hours", which leads to the coaching page.
- Set up: a **"N waiting"** badge, the requests waiting for him with ✓ (Accept) and ✕ (Decline), the next accepted session, and the booking link with a Copy button. A switch **Bookings open** (pause new requests without losing the hours). A tile to the coaching page.

**The coaching page**, `/dashboard/coaching` (my call), two parts:

- **Schedule**: the next 14 days grouped by day, each booking with its time, the viewer's Discord name and length, its note, and its state. Waiting → Accept or Decline. Confirmed → Cancel. Past sessions of the last 30 days below (my call).
- **When I coach**: one row per weekday with a switch and a from–to time (**one window per day**, my call), the streamer's time zone (defaults to the browser's the first time, stored by its canonical IANA name like the Tracking goals), and **days off** (whole days; my call).
- **Where we meet** (my calls, following the owner's "join first"): the **coaching server**, one of the streamer's claimed Discord servers where the Atleta bot is (picked from a list; the only one is picked for them), and its **invite link**, which must be a Discord invite to that server and is checked with Discord when saved (Discord's `GET /invites/<code>`). A streamer with no claimed server cannot set coaching up: the card's setup step becomes "Add Atleta to your Discord server first". An optional short line, "Where the session happens" (at most 150 characters, e.g. "the Coaching Room voice channel"), goes into the confirmation.
- **Message me about new requests**: a switch, on by default (the owner).

**A dead invite.** Today's coaching link broke because a Discord invite expired. So the coaching page and the card check the saved invite with Discord (at most once an hour, my call) and warn "Your invite no longer works: viewers cannot join" with a link to fix it.

**Changing the hours or adding a day off never touches existing bookings** (my call): the page warns when a waiting or confirmed booking falls outside the new hours, and the streamer cancels it himself if he wants to.

**A request nobody answered** before its start time becomes "Not answered" and frees nothing further; the viewer gets no message (my call).

## The Discord messages

Sent by the Atleta bot as direct messages, through `src/discord.js` (the one place that posts).

To the viewer:

- **Accepted**: "Your coaching with <streamer> is confirmed", the date and time, the length, where it happens (the server's name, the streamer's "Where the session happens" line, and the invite).
- **Cancelled** (a booking cancelled by the streamer): "<streamer> cancelled your coaching", the time, and the booking link.
- **Declined** (my call, the same as a cancel): "<streamer> could not take this time", the time, and the booking link.

To the streamer (while "Message me about new requests" is on; to `streamers.discord_user_id`, who signs in with Discord and has a claimed server, so the bot can reach them):

- **New request**: the viewer's Discord name, the time, the length, the note, and a link to `/dashboard/coaching`. No Accept/Decline buttons in Discord (my call: that needs Discord interactions; the link is enough).
- **Withdrawn**: "<viewer> cancelled their coaching", the time.

Times in the messages are Discord timestamps (`<t:…:F>`), which Discord shows in each reader's own time zone (my call). The viewer's messages are in the language the viewer's page was in when they booked (my call; stored with the booking); the streamer's in the language of their dashboard, the `lang` cookie of their last save of the coaching page (my call; English until then). They mention nobody.

**A message that cannot be delivered** (Discord only lets a bot message someone who shares a server with it, and a person can close their messages) is recorded on the booking, and the schedule shows "Atleta could not message <name>: message them yourself" (my call). Accepting or cancelling still happens. A streamer's message that fails is logged; the card's badge still shows the request.

## andre_vilela_'s release step

After the release, with his OK: point his `!coaching` command (chat_commands id 7) and his "Coaching" sponsor message (sponsor_messages id 8) at his booking page. Today both hold `https://discord.gg/9By7WNXNcJ` (fixed 2026-10-29). There is no new built-in `!coaching` command (my call): each streamer points their own command at the link the card shows.

## Constraints (from the codebase)

- Plain CommonJS, Express 5, EJS (no `require()` in views), all SQL in `src/db.js`, migrations that boot clean twice (CI fails on any `[DB migration]` line).
- Every text through `t()` in all 7 locales (`tests/i18n.test.js`); a page's script gets its texts as one JSON object; error codes travel in URLs, never texts.
- Views that include `header.ejs` end with `footer`; JSON printed into a script is escaped (`tests/scriptEmbeds.test.js`).
- CSRF (`src/csrf.js`): every form and `fetch` on the viewer's page needs the same protection a streamer's forms have, which today depends on the streamer session; the viewer's sign-in must carry an equivalent token.
- Session ids are stored hashed (`db.hashSessionId`); a viewer's sign-in must be stored the same way.
- Two viewers asking for overlapping times at the same moment: exactly one wins (one transaction that checks for an overlapping held or confirmed booking).
- The membership check uses the bot's own view of the server (the `GuildMembers` intent is on; one member lookup by id, with a deadline), never the viewer's Discord token: the sign-in asks only for `identify`.
- The booking page must not include the site header's "Login with Discord" link, which signs a visitor in as a streamer (`/auth/login` creates a `streamers` row).
- Times are stored as UTC instants; weekly hours as local times plus the streamer's IANA zone, so a daylight-saving change keeps 18:00 at 18:00 (`services/goalPeriods.js` has the zone helpers).
- Outbound calls get `AbortSignal.timeout()`; Discord may be down or not ready (`DISCORD_DISABLED=1` in dev/CI): a message that cannot go out is recorded, never fatal.
- Remove (admin) deletes the coaching rows (`STREAMER_OWNED_ROWS`); Disable makes the booking page answer like an unknown streamer.
- Tests never touch the network or production.
- Looks: the site's tokens from `header.ejs`, the working cards' patterns (`dashboardCards.buildCards`, `gatherCards`, `views/cards/_tiles.ejs`), compact as in the mockup.

## Left to the builder

- Table design, route names beyond the two page addresses, how the viewer's sign-in is stored (a table of its own or columns on `sessions`).
- How the card refreshes after Accept or Decline, and where exactly the card sits.
- Retention of old bookings (keep at least the 30 days the page shows).

## Decisions after the builder check

A fresh reviewer read this document as its builder and asked four questions.

1. **Viewers not in the streamer's server** (the owner, option a): they join first; the booking page shows the streamer's invite until they are in. This brought the coaching server, the invite link and its checks, and the "where" line in the confirmation (my calls on the details).
2. **Is the streamer told about new requests** (the owner: yes): a Discord message per request, with a switch, on by default.
3. **Can the viewer cancel** (the owner: yes): until the booking starts; "Withdrawn"; the streamer is told.
4. **The paused page** (my call): one "Bookings open" switch; paused, the page still answers and shows the viewer their bookings; coaching is opt-in, opened by the first save of the hours.
