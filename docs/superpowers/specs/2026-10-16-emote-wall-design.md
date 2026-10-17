# Emote wall — design

Date: 2026-10-16. Status: draft for the owner's approval. One of three designs from the same brainstorm (with `2026-10-16-tracking-design.md` and `2026-10-16-stream-report-design.md`).

## Why

A fun reward for cheering: a viewer who cheers bits with emotes sees those emotes fly across the stream. The owner: "only activated when the user donates bits and emotes, minimum 100 bits".

## Goals

- An OBS browser source of its own (my call: `/overlay/emotes/:token`, over the whole screen), separate from the alert overlay.
- A cheer of at least the streamer's minimum (default **100 bits**) whose message contains Twitch emotes makes those emotes fly across the screen. Bigger cheers make a bigger wall.

## Non-goals

- No emote wall from ordinary chat, subs, raids or channel points (the owner chose cheers only).
- No 7TV, BTTV or FFZ emotes in this release (Twitch emotes only — channel and global).
- No change to the bits alert.

## Anti-goals

- OBS stuttering because of too many emotes.
- An emote that is not in the cheer (or text, a link, a viewer's image) appearing on screen.

## How a cheer becomes a wall

- **Where the emotes come from:** EventSub's `channel.cheer`, which drives the bits alert, carries only the text (`normalizeEvent` keeps `{username, amount, message}`, no emote positions). The chat bot (tmi.js, `services/twitchChat.js`) receives the same cheer with tags carrying `bits` and `emotes` (emote id → character ranges) — but tmi.js emits a cheer only as its own `cheer` event, never as `message`, so `handleMessage` never sees it. The wall adds a `client.on('cheer', (channel, tags, message) => …)` handler (`tags.bits` is a string there) and reads the cheer there. **So the wall works only while the streamer's chatbot is on** (the bot is in the channel only then); the setup says so, and the card shows the wall as needing the chatbot (the way other cards fade while it is off).
- **Which emotes:** the emote ids in the message's `emotes` tag; each id becomes its Twitch CDN image (`https://static-cdn.jtvnw.net/emoticons/v2/<id>/default/dark/3.0`). Cheermotes themselves (the "Cheer100" text) are not emotes and are skipped. A cheer of the minimum or more with no emote: nothing on the wall.
- **Scale (the owner left it to the builder; my call):**

  | Cheer | Emotes on screen | Lasts |
  |---|---|---|
  | minimum–499 bits | 15 | 4 s |
  | 500–999 | 30 | 6 s |
  | 1,000–4,999 | 60 | 8 s |
  | 5,000+ | 100 | 10 s |

  The cheer's emotes repeat to fill the count (three emotes at 500 bits → ten of each). A cheer arriving while the wall runs adds its emotes to it, never more than **100 on screen** at once; the wall's end time moves to the later of the two.
- **Motion:** emotes rise from the bottom with a little drift and spin, as a burst (my call; the look can be tuned while building, in the spirit of the looks' effects).

## Settings (streamer)

On/off (my call: off by default, like the other new on-stream features), the minimum (100–10,000 bits, default 100), the emote size (small/medium/large). A card on the Tracking page (`2026-10-16-tracking-design.md`), since both are OBS sources managed in one place, with a **Test** button that fires a sample wall on the live source.

## Constraints

- `CLAUDE.md` rules (texts in seven locales, CSRF, escaping, deadlines). The source follows the tip goal source's pattern (SSE, heartbeat, `holdStream`, its own bus channel — never `overlay:<id>`).
- Emote ids are validated (digits, or Twitch's `emotesv2_` ids) before building a URL; nothing from the message text reaches the page.
- A disabled account's source answers like an unknown token (as the other sources).

## Left to the builder

The animation, the exact bus payload, where the settings live in the data, the sample emotes for Test.

## Decisions after the builder check

Calls made while writing this (the owner may overrule):
- **No moderation step for cheers:** cheers are not moderated today (tmi.js's `cheer` never reaches the moderation in `handleMessage`), and the wall shows only the emote images, never the message text; the emote-spam filter does not apply to the wall.
- **Settings home:** the build order is Tracking, then the emote wall, then the stream report (`2026-10-16-tracking-design.md`), so the wall's card goes on the Tracking page, which exists by then.
