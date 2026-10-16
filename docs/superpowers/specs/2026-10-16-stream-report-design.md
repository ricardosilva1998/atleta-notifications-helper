# Stream report — design

Date: 2026-10-16. Status: draft for the owner's approval. One of three designs from the same brainstorm (with `2026-10-16-tracking-design.md` and `2026-10-16-emote-wall-design.md`).

## Why

After a stream the streamer wants to know how it went. The owner: a report page with the usual metrics, sent to the Discord user who owns the account "via a screenshot with a url to the page where the stats are". On by default; the streamer can switch it off.

## Goals

- A **report page** per stream on the dashboard.
- A **Discord DM** to the account owner after each stream: an image of the report's top and its chart, and the link to the page.
- On for every streamer by default; a switch turns the DM off.

## Non-goals

- No report for streams before this release (the data is not stored today).
- No change to the recap posted in servers.
- No public report page (only the logged-in streamer sees it).

## Anti-goals

- A DM with wrong numbers, or a DM to anyone but the account owner.
- A heavy headless browser in the production image.

## What the report shows (the owner left the choice; these are mine)

- **Top:** stream length, title, game; **average viewers**, **peak viewers**; **new followers**, **new subs** (new, resubs, gifted — split), **bits**, **tips** (per currency, never added across currencies). Each with an arrow against the streamer's previous stream (↑ 12%).
- **Middle:** **viewers over time** — a chart of the minute-by-minute viewer counts, with markers for follows, subs, raids and tips.
- **Bottom:** **top supporters** (tips, bits, gifted subs), **raids received** (who, how many viewers), **chat** (messages and distinct chatters — only while the chatbot is in the channel; otherwise left out), **clips made** during the stream (links).

## Where the numbers come from

- **Viewers:** `pollers/twitchLive.js` already reads `viewer_count` every minute but keeps only `peak_viewers` (in `channel_state`, keyed by Twitch login). New: store each poll's count per stream (stream id, time, viewers). Average = mean of the samples.
- **Follows, subs, bits, tips, raids:** `overlay_events` (kept 30 days) and `donations` for the stream's time span; the report is built when the stream ends, so 30 days is enough. Tips per currency from `donations`.
- **Chat:** new counters in `handleMessage` (`services/twitchChat.js`) per streamer while live: messages and distinct chatters (a set of user ids for the stream, dropped when the report is built).
- **Clips:** `pollers/twitchClips.js` posts clips and stores only the last time; the report reads the stream's clips from Twitch (`getClips` for its time span, as `buildRecap` already does) when it is built.
- **When:** the stream is over on the second empty poll (as for the recap); the report is built then, stored (its numbers frozen as they were — my call), and the DM is sent. A stream shorter than 5 minutes gets no report (as the recap: `MIN_RECAP_SECONDS`).

## The page

- `/dashboard/reports` (my call): the streamer's past reports, newest first; `/dashboard/reports/:id`: one report, in the Atleta card style, with the chart. Only the owning streamer can open it (others get 404).
- Kept for 365 days (my call, as donations).

## The Discord DM

- **New capability:** the bot has never sent a DM (`discord.js` has no `createDM`/`user.send`). It fetches the account owner by `streamers.discord_user_id` and sends the image and the link. Discord delivers a bot's DM only when the person shares a server with the bot (every streamer who claimed a server does) and allows DMs from server members; otherwise it fails — the report stays on the dashboard, the failure is logged once, and the report page shows "Couldn't send it to your Discord DMs" with why (my call).
- **The image:** the server draws it — an SVG of the report's top and chart, turned into a PNG with **`@resvg/resvg-js`** (my call: prebuilt binaries, no headless browser; the production image has no Playwright and `npm ci --omit=dev`). The fonts the page uses (Outfit, DM Sans) are bundled for it. About 1200×675 px.
- **The switch:** a per-streamer setting, **on by default** (the owner's call), on the report page and as a `dashboardSettings` switch; off: the report is still built, no DM.
- **Text:** the DM's line and the image's labels in the streamer's language (the language is the dashboard's `lang` cookie today, not stored per streamer: my call — store the language the streamer last used on the dashboard, defaulting to English).

## Constraints

- `CLAUDE.md` rules (texts in seven locales, escaping, deadlines on every outbound call, `STREAMER_OWNED_ROWS` for the new rows, migrations through `db.js`; a disabled account gets no report or DM).
- The DM never mentions or pings anyone else; the link is to `APP_URL`.
- Discord's attachment and rate limits respected (one DM per stream).

## Left to the builder

The new tables' shape, the chart drawing, the image's layout within "the top and the chart", where the language is stored.

## Decisions after the builder check

Calls made while writing this (the owner may overrule):
- **Whose report:** a report belongs only to the streamer whose linked Twitch account is the channel; a server that merely watches a channel never causes a report or a DM. Every enabled streamer's own linked channel is polled by the live poller even when no server watches it (batched by 100 like the rest), so "on by default" reaches everyone; the stream start and end come from there (shared with the Tracking design).
- **Incomplete data:** a metric Atleta could not measure for the whole stream (no EventSub connection, missing follower scope, chatbot not in the channel) shows "not tracked", never 0; a report with a gap (a restart mid-stream: viewer samples missing, in-memory chat counters reset, an EventSub reconnect) is marked partial on the page and in the image.
- **Non-Latin text in the image:** a CJK-capable font (Noto Sans CJK) is installed in the production image next to Outfit and DM Sans, so titles and game names in Chinese, Japanese or Korean draw correctly; emoji fall back to a symbol font or are left out.
- **DMs that cannot be delivered:** a failure is stored on the streamer (when and why); after 3 failures in a row the bot stops trying until the streamer turns the DM switch off and on (or a DM succeeds after a change); the report page and the switch show the reason. A streamer who shares no server with the bot gets no DM, and the page says why.
- **Sub split:** the sub type (new, resub, gift) is stored explicitly from now on (the same record as the Tracking design), not derived from `months`.
- **Previous stream:** the arrows compare with the streamer's previous stored report; the first report has none; linking another Twitch account starts the comparison over.
- The first DM after the release goes to every streamer after their next stream (on by default, the owner's call); its text says what it is and how to switch it off.
