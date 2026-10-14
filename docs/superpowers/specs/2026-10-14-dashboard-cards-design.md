# Dashboard Working Cards — Design

**Status:** look approved (mockup v6), spec pending review
**Date:** 2026-10-14
**Mockup (committed):** `docs/superpowers/specs/assets/2026-10-14-dashboard-cards-mockup.html` — a static page with example data and the site's own styles; open it in a browser. Switches, pop-ups and the giveaway run in it, nothing is saved.

## Goal

The streamers who use the Twitch tools get lost on the dashboard: settings are spread over pages, tabs inside
tabs and separate Save buttons; what is switched on cannot be seen without opening each page; setup steps hide
inside pages; and nothing is built for use while live (the main streamer keeps the dashboard on a second
monitor). They get stuck switching things on and off, running things live, setting up, and editing messages
and commands.

Turn the dashboard's Twitch tab into **working cards**: every important tool is used right on its card —
switches save the moment they move, short texts are edited in a pop-up — and the page fills the window.
Nothing a streamer has set up changes or needs redoing.

## Scope

**In scope:**
- The Twitch tab of `/dashboard` (`views/dashboard.ejs`, `GET /dashboard` in `routes/dashboard.js`): ten working cards, the wide page, the packed columns.
- One save route for single settings, and small JSON routes for the texts the cards edit.
- The overlay features come back (`features.overlays = true`); a new `features.vtuber` switch keeps the VTuber tab hidden.
- The overlay switch becomes the real on/off for the alerts; the card shows whether the overlay is open in OBS and whether the bot is a moderator.
- The fixes found while mapping the save paths (*Fixes first*).

**Out of scope:**
- The Discord tab, and the layouts of the full settings pages: they stay as they are, behind each card's links; only the listed fixes touch them.
- YouTube and Kick (stay hidden), the VTuber feature (stays hidden), the homepage (unchanged: it does not follow `features.overlays`, and its tests keep overlay words off it).
- The cost of the Discord tab's per-server numbers on each dashboard load.

## The page

- **Width.** The dashboard uses a wide container, at most 1760 px; every other page keeps today's 920 px. `header.ejs` opens `.container`; the dashboard route passes a `wideLayout` local that adds a class to it.
- **Top.** The Twitch account chip (the linked channel, Enable Sub Sync or Reconnect Twitch, as today), then the "Last 7 days" bar: today's six numbers in one row. The chip sits above the bar at every width.
- **Columns.** `repeat(auto-fill, minmax(min(340px, 100%), 1fr))`: four columns at 1600 px, three at 1280–1440 px, two on a tablet, one on a phone.
- **Packing.** Each card is as tall as its content and the next card fills the shorter column. The CSS alone gives a plain grid. The page script adds a class that switches the grid to 2 px rows and sets each card to span its own height, recomputed by a `ResizeObserver` when a card changes size or the window does; without the script the plain grid stays, and nothing overlaps either way. The order in the HTML is the reading order, and the order on a phone.
- **Order.** Chatbot, Discord notifications, OBS overlay, Commands, Sponsor messages, Donations, Chat protection, Giveaways, Channel point rewards, Spotify. A card whose feature is switched off by a feature flag is left out.

## Card rules

Every card follows them:

1. **Head:** an icon tile, the title, a one-line status (green when it works, grey when off, amber when it needs something) and — only for a tool that has one — its main on/off switch at the right.
2. **Sections:** a small heading, with the section's own button (+ Add, Choose, Edit, History) at the right edge of the heading.
3. **Rows** have one shape: the item's switch at the left (when it has one), its text in the middle, edit and delete at the right.
4. **Foot:** links to the full pages for the rarer settings at the left; "Saved" appears at the right after a change.
5. **At most one purple button** per card.
6. **Switches save the moment they move.** Text is edited in a pop-up (`<dialog>`): Save and Cancel, Esc closes it, focus returns to the button that opened it.
7. A card that **needs the chatbot** fades its body and says "Turn the chatbot on to …" while the chatbot is off.
8. A card that is **not set up** shows its one setup action instead of its body: link Twitch, add the bot to a server, add a PayPal email, connect Spotify.

## The cards

### Chatbot
- Head switch `chatbot_enabled`. Status: "Online in #channel", "Off", or "Connecting…" while the bot's chat connection is down.
- **Thank-you messages** ("N of 6 on"): Follows, Subs, Gift subs, Bits, Donations, Raids. Each row: switch `chat_*_enabled`, the message (cut to one line), pencil → pop-up with the text, the placeholders it can insert, **Test in chat** (today's test route) and Save.
- Foot: All chatbot settings (`/dashboard/chatbot`).

### Discord notifications
Built on `discordNotificationsCard()` (today's card data). One block per claimed server: the server's name and a **Channels** link to its server page, then six switches:
- **Go-live posts** (in #channel) → the watcher row of the streamer's own channel in that server, `notify_live`. Switching it on needs a live channel (`no_channel`, with the Channels link).
- **Clips** (in #channel) → that row's `notify_clips`, same rule.
- A server that does not watch the streamer's own channel has no such row: both switches show off, and switching one on answers `no_channel` (the channel is added on the server page).
- **Stream recaps, Milestones, Weekly highlights** → the server's `recap_enabled`, `milestones_enabled`, `weekly_highlights_enabled`.
- **Sub roles** → `sub_sync_enabled`. Switching it on needs a sub role (`no_role`, with the Channels link).

The rows keep today's "waiting" state (milestones and sub roles need the broadcaster authorization: Reconnect Twitch). The server columns `twitch_live_enabled` and `twitch_clips_enabled` are not used: no poller reads them.
Foot: Welcome message (server page), Add a server (Discord tab). No server: the bot invite and the servers to claim. No linked Twitch account: Link Twitch.

### OBS overlay (with `features.overlays`)
- Head switch `overlay_enabled`, now the real on/off for the alerts (*Overlay switch*). Status: "Alerts show on stream · open in OBS", "… · not open in OBS right now", or "Off".
- **Browser source for OBS:** the overlay link, masked until the eye is clicked; Copy. No link yet: "Create your OBS link" (today's route).
- **Alerts** ("N of 6 on"): Follows, Subs, Bits, Donations, Raids, Giveaway winner. Each row: switch `overlay_*_enabled`, seconds on screen `overlay_*_duration` (5, 8, 10, 12, 15, 20 or 30; the giveaway winner up to 60), and ▶ test (today's test route and its shared 5 s cooldown).
- **Volume** slider `overlay_volume` (0–100 % on screen, 0–1 stored).
- Foot: Look and position (Overlay Builder), Sounds (overlay settings page).

### Commands
- Status: "N commands · M built-ins on".
- **Your commands (N)** + Add. Rows: `!name`, the response, edit, delete; four shown, then "Show all N". Pop-up: name, cooldown, response. Today's rules apply (`chatCommands.js`: name `[a-z0-9_]`, at most 50 characters; response at most 500; cooldown 5–3600 s), plus a limit of 100 commands.
- **Built-in commands** ("M of 13 on") + Choose: the ones that are on, as pills. Choose → pop-up with the 13 as toggles, saved together.

### Sponsor messages
- Head switch `sponsor_send_chat`. Status: "Posting one every N min · K messages" or "Off · K messages kept".
- "Post one in chat every [5, 10, 15, 20, 30 or 60 min]" → `sponsor_chat_interval_minutes`.
- **Messages (K)** + Add. Rows: switch (the message's `enabled`), the text, edit, delete; three shown, then "Show all K". Pop-up: the text and an optional link.
- Foot: Sponsor images on stream (Overlay Builder; with `features.overlays`).

### Donations
- Head switch `donation_page_enabled`. Switching it on needs a PayPal email (`no_email`, with the PayPal link). Status: "Tip page on · N tips in 90 days".
- The tip page link; Copy and Open.
- **Tip goal** + Edit (with `features.overlays`): its title, a progress bar, "raised of target". Pop-up: title, target, End the goal. No goal: "Start a tip goal".
- **Latest tips** + History: the last three (amount in its own currency, name, message, when).
- Foot: PayPal and currency (donations page).

### Chat protection
- Status: the filters that are on, or "All filters off".
- The note "Make Atleta a moderator: type /mod Atleta in your chat" with Copy, shown only while the bot is in the channel and Twitch says it is not a moderator there. **Check again** refreshes it (*Bot moderator*).
- Six switches in two columns → `mod_*_enabled`: Link protection, Banned words (with the number of words), Caps, Emote spam, Repetition, Symbol spam.
- Foot: Moderation log · N this week; Fine-tune (the chatbot page's Moderation tab).

### Giveaways
- Status: "No giveaway running", "Giveaway running" or "Winner picked".
- Form: Keyword, Prize (optional), Ends (when I pick, after 1, 5, 10 or 30 min), Winners, Subs only; **Start giveaway** (today's JSON routes).
- Running: "Viewers type !keyword in chat to enter", entries, time left, winners; **Pick a winner**; End.
- Foot: Past giveaways (giveaways page).

### Channel point rewards (with `features.overlays`)
- Head switch `cp_rewards_enabled` (the settings route; the rewards page keeps its own).
- Rows: each reward with its switch (`PATCH /dashboard/redemptions/:id`), title, cost and ▶ test. None yet: what rewards do, and **Create a reward** (rewards page).
- Not available: "Needs Twitch Affiliate or Partner", or "Reconnect Twitch to use rewards" when the broadcaster permission is missing (today the card only says it is not configured).
- Foot: Redemption history (rewards page).

### Spotify
- Not connected: **Connect Spotify**. Connected: "Viewers type !song and the bot answers with the song you're playing"; foot: Disconnect Spotify.

## Saving

### One route for single settings

`POST /dashboard/settings`, JSON:

```
{ "key": "chat_follow_enabled", "value": true }
{ "key": "recap_enabled", "guildId": "…", "value": true }
{ "key": "sponsor_message_enabled", "id": 12, "value": false }
{ "changes": [ { "key": "cmd_uptime_enabled", "value": true }, … ] }
```

A batch holds at most 20 changes: all are checked before any is written, they are written in one
transaction, and each follow-up runs once. A table in `src/services/dashboardSettings.js` lists every key the
route accepts; anything else is refused. Each entry says where the value lives, how it is checked and what
follows the write:

| Keys | Lives in | Check | After the write |
|---|---|---|---|
| `chatbot_enabled` | streamer | on/off | the bot joins or leaves the channel; the event connections start or stop (`syncLiveConnections`) |
| `chat_{follow,sub,giftsub,bits,donation,raid}_enabled` | streamer | on/off | — |
| `chat_{follow,sub,giftsub,bits,donation,raid}_template` | streamer | text, trimmed, at most 500 characters | — |
| `cmd_{followage,subage,uptime,accountage,8ball,roll,hug,slap,love,rps,coinflip,quote,roast}_enabled` | streamer | on/off | — |
| `mod_{link_protection,banned_words,caps,emote_spam,repetition,symbol_spam}_enabled` | streamer | on/off | — |
| `overlay_enabled` | streamer | on/off | the event connections (`syncLiveConnections`); the overlay is told (`config-update`) |
| `overlay_{follow,sub,bits,donation,raid,giveaway}_enabled` | streamer | on/off | the overlay is told |
| `overlay_{follow,sub,bits,donation,raid,giveaway}_duration` | streamer | whole seconds 1–30 (giveaway 1–60) | the overlay is told |
| `overlay_volume` | streamer | 0–1 | the overlay is told |
| `sponsor_send_chat`, `sponsor_chat_interval_minutes` | streamer | on/off; 1–1440 | the sponsor chat rotation restarts |
| `donation_page_enabled` | streamer | on/off; on needs a PayPal email | — |
| `cp_rewards_enabled` | streamer | on/off | — |
| `recap_enabled`, `milestones_enabled`, `weekly_highlights_enabled`, `sub_sync_enabled` | the streamer's server (`guildId`) | on/off; sub roles on needs a role | — |
| `notify_live`, `notify_clips` | the watcher row of the streamer's own channel in that server (`guildId`) | on/off; on needs its channel | — |
| `sponsor_message_enabled` | the streamer's sponsor message (`id`) | on/off | the rotation restarts |

- **Writers.** The existing writers that set only the columns they are given (`updateChatbotConfig`, `updateBuiltinCommands`, `updateModerationConfig`, `updateOverlayConfig`, `updateDonationSettings`) take the one column. New single-column writers: a server switch, a watcher's notify flag, a sponsor message's switch, a sponsor message's text and link, and the two sponsor chat settings separately (today each of these writes the whole row, so a single field would clear the others).
- **Whitelist.** The column comes from the table, never from the request. Every target (server, watcher row, sponsor message) is looked up with the streamer's id; one that is not theirs answers 404.
- **Answers.** `{ ok: true, value }`. Refusals: `{ ok: false, code, error }`, with 400 (`invalid`), 404 (`not_found`) or 409 (`no_email`, `no_role`, `no_channel`, `chatbot_off`). `error` is the translated text; `code` lets the card react (for example, add the missing step's link).
- Behind the dashboard's login, the disabled-account check and CSRF, like every other dashboard route.

### Text routes
- **Commands:** `POST /dashboard/api/commands`, `PATCH /dashboard/api/commands/:id`, `DELETE /dashboard/api/commands/:id`, with `parseCommand`'s rules; a name in use answers `duplicate`, the 101st command `too_many`, an id that is not the streamer's 404. The chatbot page's form routes stay.
- **Sponsor messages:** today's JSON routes, made field-safe — an update changes only the fields it is given (today a missing field clears the link or the switch, or fails) — and adding a message restarts the rotation.
- **Tip goal:** `POST /dashboard/api/tip-goal` (start: title, target; the currency is the tip page's), `PATCH /dashboard/api/tip-goal` (title, target), `POST /dashboard/api/tip-goal/end`, each telling the goal bar as today's forms do (`tipGoals.broadcast`). The donations page keeps its forms.
- **Thank-you texts** go through the settings route.
- **Spotify:** `POST /dashboard/spotify/disconnect` clears the stored Spotify tokens.

### In the page
- One script, `public/js/dashboard-cards.js` (plain JavaScript, no build step): the switches (move at once, POST; on a refusal flip back and show the card's message; on success "Saved"), the pop-up editor, the packing, the giveaway poll (every 2 s while one runs), the copy buttons. Its texts come from one JSON object the view embeds (`t()` keys, `.replace(/</g, '\\u003c')`).
- A session that has ended answers with the login page instead of JSON: the card says "Your session ended — reload the page".
- `public/js/csrf.js` already adds the CSRF header to these requests.
- The switches are real checkboxes (`role="switch"`, each with a label); changes of status are announced through an `aria-live` region.

### On the server
- `GET /dashboard` gathers the data; `src/services/dashboardCards.js` (pure, tested on its own) turns it into each card's state: the status line, the counts, the rows, which setup action shows. New reads: the custom commands; the sponsor messages and their settings; the last three tips and the 90-day count (`getDonations`, `countDonations`); the active tip goal; the rewards; the active giveaway; the overlay settings and link; whether the overlay is open in OBS; whether the bot is a moderator; the number of banned words; the moderation actions this week.
- Dropped from the route: the unused `iracingSettings` query, and the log line `chatManager.isConnected()` writes on every load.

## Overlay switch, OBS status, bot moderator

- **Overlay switch.** Today `overlay_enabled` only decides whether the Twitch event connections run; alerts reach an open OBS source either way. From now on, with it off, the alert overlay's stream (`/overlay/:token`) passes no alert events (the chat lines for the iRacing chat overlay already follow it), and the test buttons answer `overlay_off`. The sponsor overlay and the tip-goal bar are separate sources and do not change.
- **Open in OBS.** The alert overlay route counts its live streams per streamer; "open in OBS" means at least one.
- **Bot moderator.** The bot's chat connection learns from Twitch whether it is a moderator in each channel (tmi.js keeps it per channel, refreshed when the bot joins or speaks). `chatManager` exposes it as on, off or unknown; the card shows its note only for off. **Check again** (`POST /dashboard/chatbot/check-moderator`) makes the bot leave and rejoin that channel — nothing is posted in chat — and answers the fresh state.

## Overlays back on

- `features.overlays = true`: the overlay settings page, the Overlay Builder, the channel point rewards page, the tip goals on the donations page and the sponsor-images link come back, with the settings saved today.
- `features.vtuber = false` (new): keeps the Experimental (VTuber) tab and `/dashboard/vtuber-preview` hidden; its bundled models are missing.
- The homepage does not change.
- With `features.overlays = false`, the OBS overlay and Channel point rewards cards and the tip goal section are left out, as today.

## Fixes first

Found while mapping the save paths. Each gets a test that fails before it. Fix 1 is live; 2–6 ship together in one small release before the redesign.

1. ~~Saving the chatbot's thank-you messages switched the chatbot off~~ — fixed (`f247744`): the two forms name their part and change only their own fields.
2. **Nothing posts while the chatbot is off.** Sponsor messages, and the chat lines of rewards and giveaways, were posted with the chatbot off; only the thank-yous checked it. `chatManager.sendMessage` drops lines for a streamer whose chatbot is off, and a giveaway cannot start while it is off (`chatbot_off`).
3. **Adding the first sponsor message starts the rotation.** Today nothing starts until another change.
4. **The giveaways page countdown** shows an invalid time (it reads the end time wrongly); it counts down.
5. **The moderation numbers are kept in their ranges on the server**, as the page's fields already say: link permit 10–600 s, caps 3–100 characters and 30–100 %, emotes 1–100, repetition 5–300 s, symbols 10–100 %, follow age 1–1440 min, raid protection 30–600 s.
6. **Spotify can be disconnected** (the route above).

Also: the rewards switch route reads its value strictly (`"0"` is off).

## CLAUDE.md change required

- **Dashboard** bullet: the working cards, the wide container and the packing, the settings route with `dashboardSettings.js` and `dashboardCards.js`, the pop-up rule.
- **Feature Flags:** `overlays` is `true`; the new `vtuber` (`false`); the overlay switch is the alerts' on/off.
- **Twitch Chatbot:** nothing posts while the chatbot is off; the moderator status.

## Testing

- `dashboardSettings`: every key's check, range and refusal codes, the writer it uses, its follow-ups (stubs record the calls).
- The settings route: an unlisted key; a value of the wrong kind; another streamer's server, watcher row or message (404); a batch (all or nothing); logged-out and disabled accounts; CSRF.
- The text routes: commands (the rules, a name in use, the limit, an unknown id), sponsor messages (field-safe update; adding restarts the rotation), the tip goal.
- `dashboardCards`: each card in each state — no Twitch linked, chatbot off, no server, several servers, no commands, no sponsor messages, no PayPal email, no goal, not an Affiliate, the rewards permission missing, Spotify not connected, overlays switched off, the bot not a moderator or unknown, the overlay open in OBS or not.
- The view renders every state; the texts exist in all 7 locales (`tests/i18n.test.js`); the script's JSON embed is safe (`tests/scriptEmbeds.test.js`); only the dashboard gets the wide container.
- Fixes 2–6 and the overlay switch, each with a test that fails before it.
- In a browser (a scratch copy, Playwright) at 360, 768, 1280, 1600 and 1920 px: no sideways scroll, no overlapping cards, nothing cut off; a switch keeps its position after a reload; a refused switch flips back with its message; the pop-up works with the keyboard; a giveaway runs; the masked link copies.
- The full suite stays green (2479 tests today).

## Release

One implementation plan in two phases: **A** — fixes 2–6; **B** — the redesign (feature flags, the settings and text routes, the overlay switch and statuses, the cards, the page script, docs).

- Fixes 2–6: one small release. The redesign: one release. Each is deployed when no registered streamer is live.
- No database schema change: going back is a revert, and the full pages are untouched.
- The new texts in the six other languages are machine-made; a native read-through later.

## Risks

- **A follow-up that fails after a save** (for example, the bot cannot join the channel): the value stays saved and the failure is logged, as the full pages do today; the card's status line shows the real state on the next load.
- **The packing script fails:** the grid stays plain; nothing overlaps.
- **The moderator status can lag** until the bot rejoins or speaks; Check again covers it.
- **The overlay switch now does what it says:** a streamer who switched it off but kept the OBS source open stops getting alerts.

## Open questions

None blocking.
