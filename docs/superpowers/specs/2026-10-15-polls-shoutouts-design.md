# Polls, Predictions and Shoutouts — Design

**Status:** design approved in conversation (2026-10-15), spec pending review
**Date:** 2026-10-15
**Mockup (committed):** `docs/superpowers/specs/assets/2026-10-15-polls-shoutouts-mockup.html` — a static page with example data and the site's own card styles: the two new cards in their states and the on-stream bar. Nothing in it is saved.

## Goal

More fun in chat: viewers take part while the stream is live. The first two tools:

1. **Polls and predictions** — Twitch's own (viewers vote in Twitch's box; predictions use channel points), started and followed from Atleta: saved one-click templates, the bot announcing the start and the result in chat, live results on a dashboard card, and an on-stream bar in OBS.
2. **Shoutouts** — `!so @name` typed by the broadcaster or a moderator, and an automatic shoutout after a raid: the bot posts the streamer's own text with the person's name, last game, title and link.

## Scope

**In scope:**
- Two new working cards on the dashboard's Twitch tab: **Polls & predictions** (after Giveaways) and **Shoutouts** (after Commands), built like the other working cards (`views/cards/*.ejs`, `services/dashboardCards.js`, switches saving through `POST /dashboard/settings`, texts in pop-ups).
- Two new Twitch permissions asked when the streamer authorizes the broadcaster connection (`channel:manage:polls`, `channel:manage:predictions`), and the poll and prediction EventSub events.
- One new OBS browser source: the poll/prediction bar (`/overlay/poll/<overlay token>`).
- New bot lines (all editable texts) and the `!so` command.

**Out of scope (not chosen):** Twitch's native shoutout (the follow card), automatic shoutouts for a friends list, polls for streamers without Affiliate or Partner (chat-vote polls), chat commands that start polls, a points or leaderboard system, posting results to Discord, YouTube.

## What Twitch allows

From Twitch's guides (Polls, Predictions, EventSub subscription types); the character and time limits come from the Helix reference and are checked again in the plan's first task:

- **Poll:** title up to 60 characters; 2 to 5 choices of up to 25 characters; 15 to 1800 seconds; optional channel-points voting (extra votes cost 1 to 1,000,000 points each); one poll at a time; ended early as `TERMINATED` (results stay in chat for a while) or `ARCHIVED` (removed).
- **Prediction:** title up to 45 characters; 2 to 10 outcomes of up to 25 characters; 30 to 1800 seconds to predict; one prediction at a time; can be locked early (`LOCKED`), resolved with a winning outcome (`RESOLVED`) or cancelled (`CANCELED`, every point is returned); a prediction nobody resolves within 24 hours is refunded by Twitch.
- A poll and a prediction may run at the same time.
- **Affiliates and Partners only.** Permissions: `channel:manage:polls`, `channel:manage:predictions` (they also cover reading and the events).
- **Events (version 1):** `channel.poll.begin`, `channel.poll.progress`, `channel.poll.end`, `channel.prediction.begin`, `channel.prediction.progress`, `channel.prediction.lock`, `channel.prediction.end`.

## The Polls & predictions card

### States

1. **Not set up.** No linked Twitch account: the usual "Link Twitch" step. Permissions missing: "Reconnect Twitch to use polls & predictions" with a button to `/auth/broadcaster` — only this card asks; the global "Reconnect Twitch" banner does not change. Not an Affiliate or Partner (known from an earlier refusal, the same flag the rewards card uses): "Needs Twitch Affiliate or Partner", no actions.
2. **Ready.** Status "Ready · 4 templates". The template list: one row each with a poll or prediction icon, the title, the choices ("Yes / No"), the time and a ▶ Start button, edit and delete (delete asks first). "+ New" opens the pop-up. A switch "Announce in chat" and a "Chat messages" pop-up for the six texts (below). With `features.overlays`, the card ends with the bar's OBS link (masked, Show, Copy, like the OBS overlay card).
3. **Running.** Above the templates, a live panel per running poll and/or prediction:
   - poll: the title, each choice with its bar, votes and percent, the total, the time left; **End now** (ends it as `TERMINATED`, results stay visible in Twitch chat);
   - prediction (open): each outcome with its bar, points, percent of points and number of predictors, the time left; **Lock now** and **Cancel and refund** (asks first);
   - prediction (locked): status "Locked — pick the winner", one button per outcome ("Yes won"), and **Cancel and refund**.
   - A template of a kind that is already running cannot start (its ▶ is disabled with a hint).
4. **Just ended.** The panel shows the result for 30 seconds (the winning choice, or the winning outcome and how many viewers won, or "Cancelled — points refunded"), then the card is back to Ready.

A poll or prediction started anywhere else (Twitch's own dashboard, a moderator) shows on the card the same way.

### The template pop-up

Type (Poll | Prediction), title, choices (two to start; "+ choice" up to 5 or 10; remove), time (poll: 30 s, 1, 2, 3, 5, 10 minutes; prediction: 1, 2, 5, 10, 30 minutes; an earlier saved value outside the list stays selectable), and for a poll the switch "Extra votes with channel points" with the points per vote. Buttons: **Save**, and **Start without saving** (runs it once). Counters show the characters left; the server checks every limit again.

### Live results

- The server keeps, per streamer, the running poll and prediction and the one that just ended (for 30 seconds), filled from the EventSub events. When it has nothing (after a restart, or when no event has arrived), it asks Twitch once (Get Polls / Get Predictions, the newest one) and keeps that answer for 5 seconds.
- The card asks `GET /dashboard/api/polls/live` every 2 seconds while something runs or just ended and every 10 seconds otherwise, and not while the browser tab is hidden.
- EventSub runs for a streamer whose overlay or chatbot is on, as today; with both off, the card still works through the Twitch read.

### Chat announcements

- The switch `polls_chat_enabled` (on by default). The bot posts when a poll or prediction starts, when a prediction is locked, and the result; at normal priority through `chatDispatcher.js`, and like every line only while the chatbot is on (the card says "Announcements need the chatbot" while it is off).
- Six texts, edited in one pop-up (each up to 500 characters, filled by `chatTemplate.js` in one pass), English defaults:
  - poll started — `Poll: {title} — vote now! ({time} to vote)`
  - poll result — `Poll closed: {winner} won with {percent}% of the votes.` (a tie names every tied choice; a poll with no votes posts nothing)
  - prediction started — `Prediction: {title} — place your channel points! ({time} to predict)`
  - prediction locked — `Predictions are locked for "{title}". Good luck!`
  - prediction result — `{outcome} wins! {winners} viewers share {points} channel points.`
  - prediction cancelled — `Prediction cancelled: "{title}". Everyone gets their channel points back.`
- Placeholders: `{title}`, `{time}` (m:ss), `{winner}`, `{percent}`, `{votes}`, `{outcome}`, `{winners}`, `{points}`. A text left empty posts nothing for that moment.
- Polls and predictions started outside Atleta are announced too.

## The on-stream bar (OBS)

- A new OBS browser source, `/overlay/poll/<overlay token>` (the same token as the alerts; "Regenerate overlay URL" ends it too; a disabled account's link answers like an unknown token).
- It shows the running poll (title, choices with bars and percent, time left) or prediction (title, outcomes with their share of points, total points, a "Locked" badge, then the winner), and the result for 10 seconds after the end; it is empty otherwise. With both running it shows the prediction (the one with points at stake) — the poll is on the card and in Twitch's own box.
- The look follows the site's racing style (dark panel, accent bars, Outfit), sized to the source's width.
- Updates by SSE (`/overlay/poll/events/<token>`, registered with `httpDrain.holdStream`) on its own bus channel `poll:<streamerId>` — not `overlay:<id>`, where the alert overlay would queue an unknown type as a card (the tip goal does the same).
- Its link is shown on the Polls & predictions card and in the OBS overlay card, both only with `features.overlays`. It does not follow the alerts' on/off switch: it is its own source.

## The Shoutouts card

- Status: "On: !so for mods · after raids from 5 viewers", or "Off". The card needs the chatbot (it fades while the chatbot is off, like Commands).
- A switch "`!so @name` for moderators" (`shoutout_command_enabled`, off by default), a switch "After a raid" (`shoutout_raid_enabled`, off by default) with "from N viewers" (`shoutout_raid_min_viewers`: 1, 2, 5, 10, 25, 50, 100; default 1).
- The message row: the text, edited in a pop-up with the placeholders `{name}`, `{game}`, `{title}`, `{link}`; **Test in chat** posts a shoutout for the streamer's own channel (the saved text; "save first" with an unsaved edit, like the thank-you pop-up). Default: `Go check out {name}! They were last streaming {game}: {link}`.

### Behaviour

- `!so @name` or `!so name`: the broadcaster and moderators only (by their badges); anyone else is ignored. The name is normalised like every Twitch name (`twitchLogin.js`). An unknown name posts nothing (logged).
- After a raid with at least the minimum viewers, the bot posts the shoutout for the raider, after the raid thank-you.
- The person's display name, last game and title come from Twitch (Get Users, Get Channel Information, with the app token, 10-second deadline), kept 10 minutes per name. `{link}` is `https://twitch.tv/<login>`. A channel that never streamed has an empty game and title.
- The same person is shouted out at most once a minute per channel. `!so` answers at command priority, the raid shoutout at normal priority, through `chatDispatcher.js`; nothing posts while the chatbot is off.

## Saving and routes

- Settings through `POST /dashboard/settings` (new keys in `dashboardSettings.js`): `polls_chat_enabled`; the six texts (`poll_start_template`, `poll_end_template`, `prediction_start_template`, `prediction_lock_template`, `prediction_end_template`, `prediction_cancel_template`); `shoutout_command_enabled`, `shoutout_raid_enabled`, `shoutout_raid_min_viewers`, `shoutout_template`.
- JSON routes (behind the dashboard login, the disabled-account check and CSRF; answers `{ ok: true, … }` or `{ ok: false, code, error }`):
  - `POST /dashboard/api/poll-templates`, `PATCH /dashboard/api/poll-templates/:id`, `DELETE /dashboard/api/poll-templates/:id` — another streamer's id answers 404; at most 20 templates (`too_many`); limits answer 400 with a code per limit.
  - `POST /dashboard/api/polls/start` with `{ templateId }` or the fields of a one-off; `POST /dashboard/api/polls/end`.
  - `POST /dashboard/api/predictions/lock`, `POST /dashboard/api/predictions/resolve` with `{ outcomeId }`, `POST /dashboard/api/predictions/cancel`.
  - `GET /dashboard/api/polls/live` — the running and just-ended poll and prediction as the card shows them (titles, choices, votes, points, times; no tokens).
  - `POST /dashboard/shoutouts/test` — the test line (409 `chatbot_off` before the shared test cooldown, like the other test buttons).
- Twitch's answers become codes with translated texts: not an Affiliate or Partner → `not_affiliate` (and the stored flag the rewards card reads); one already running → `running`; permissions missing or refused after one token refresh → `needs_reconnect`; no answer or a server error → `twitch_failed` (Twitch's message is logged, not shown).

## Server pieces

- `services/twitchPolls.js` — Helix calls for polls and predictions with the broadcaster's token (refreshed once on a 401, 10-second deadlines), and the mapping of Twitch's refusals to codes.
- `services/pollRules.js` (pure) — the limits, the checks of a template or one-off, and the conversion of a Twitch poll or prediction into what the card and the bar show (percentages, winners, ties, time left).
- `services/livePolls.js` — per streamer: the running and just-ended poll and prediction, updated from the events; emits on `poll:<streamerId>`; posts the chat announcements.
- `services/shoutouts.js` — the Twitch lookups and their cache, the per-person cooldown, `!so` and the raid shoutout.
- `services/eventsub.js` — the seven event types, subscribed only when the stored permissions include them (like the reward redemptions today); the raid event keeps the raider's id and login for the shoutout.
- `services/twitchChat.js` — `!so` among the moderator commands.
- `routes/auth.js` — the two permissions added to the broadcaster authorization; `services/twitch.js` — `hasPollsScope()`.
- `routes/overlay.js` + `public/overlay/poll.js`, `poll.css` — the bar.
- `routes/dashboard.js`, `services/dashboardCards.js`, `views/cards/polls.ejs`, `views/cards/shoutouts.ejs`, the page script (its own file for the polls card's live panel, next to `dashboard-cards.js`) and the texts in all seven languages.

## Data

- `streamers` columns (added after its `CREATE TABLE`): `polls_chat_enabled INTEGER DEFAULT 1`, the six poll and prediction texts (`TEXT` with the English defaults above), `shoutout_command_enabled INTEGER DEFAULT 0`, `shoutout_raid_enabled INTEGER DEFAULT 0`, `shoutout_raid_min_viewers INTEGER DEFAULT 1`, `shoutout_template TEXT` with its default.
- `poll_templates`: `id`, `streamer_id`, `kind` (`poll` | `prediction`), `title`, `choices` (a JSON array of texts), `duration_seconds`, `points_per_vote` (empty when channel-points voting is off), `sort_order`, `created_at`; indexed on `streamer_id`; listed in `STREAMER_OWNED_ROWS` (Remove deletes them).
- Nothing secret is stored; running polls and predictions are not stored (Twitch keeps them 90 days).

## Errors and limits

- Every limit is checked on the server; the pop-up's counters and `maxlength` only help.
- A start, end, lock, resolve or cancel answers with what Twitch did; the card then shows the live state from `GET /dashboard/api/polls/live` (Twitch's events can arrive a moment later).
- A poll or prediction whose events never arrive (EventSub down) still shows on the card through the Twitch read; the bar and the chat lines miss it (logged).
- Every text the dashboard shows is translated into the seven languages; the chat lines are the streamer's texts.

## Testing

- Unit: `pollRules.js` (limits, payloads, ties, no votes, cancelled, time left), `shoutouts.js` (line filling, empty game, cooldown, cache), `livePolls.js` (event order, just-ended window, announcements on/off, chatbot off).
- `twitchPolls.js` with `fetch` stubs (refresh on 401, refusal codes, deadlines); EventSub event fixtures for the seven types and the scope-gated subscription list.
- Routes: ownership, limits, CSRF, refusals, the settings keys; the overlay SSE route (token, disabled account, bus channel).
- Cards: states in `dashboardCards.test.js`; the partials rendered in every language (no English typed in, escaping, the OBS link only with `features.overlays`).
- The browser harness extended: start from a template, live bars from stubbed answers, lock and resolve, end; the shoutout switches and test.
- No test reaches Twitch, the network, production or `data/`.

## Release

- One release, when no streamer is live. Shoutouts work at once (switched on from the card). Polls and predictions need one "Reconnect Twitch" from their card; the bar needs adding to OBS once.
- `docs/operations/deploy.md` gets the release's notes; `CLAUDE.md` gets the two features under Key Architecture, the new services and views in Project Structure, and the dashboard's card list.

## Risks

- Twitch's limits differ from the ones above → the plan's first task checks them against the Helix reference; the server sends only what Twitch allows and logs Twitch's refusals.
- Chat floods → every line goes through `chatDispatcher.js` (its rate limits and priorities); shoutouts have a per-person cooldown.
- The reconnect is friction → only the polls card asks for it, and only from streamers who use it.

## Decisions

- Announcements on by default (the streamer started the poll and expects the bot to say so); both shoutout switches off by default (a new line in chat only when the streamer wants it).
- No full settings page for either feature: everything is on the cards.
