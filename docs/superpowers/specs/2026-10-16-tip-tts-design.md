# Tips read aloud (text-to-speech) — design

Date: 2026-10-16. Status: draft for the owner's approval.

## Why

Streamers want a viewer's tip message spoken on stream, the way StreamElements and Streamlabs do, but with a good voice and in the streamer's own words. The owner wants it on the Atleta tip page, voiced by ElevenLabs on Atleta's own account, for every streamer who switches it on.

## Goals

- A tip paid through the Atleta tip page (`/tip/:username`, PayPal) at or above the streamer's threshold is read aloud in OBS by an ElevenLabs voice, right after its alert.
- The streamer decides how it sounds and what is said: the language, the voice, the speed, the expressiveness, the voice's volume, and the line itself (a template with `{name}`, `{amount}`, `{message}`).
- It costs Atleta a bounded amount: a monthly limit per streamer and a site-wide stop that protects the account's credits.

## Non-goals

- No reading of StreamElements tips, Bits, subscription or resub messages, YouTube Super Chats, or chat messages.
- No streamer-supplied ElevenLabs key, no voice cloning, no voices outside the curated list.
- No change to how the tip is captured or recorded (`tipCapture.js`, `logDonation`), or to the alert's look and sound.

## Anti-goals

- The ElevenLabs key reaching a browser, or a donor's text reaching ElevenLabs before the tip is a real, recorded capture (`logDonation()` returned a new row).
- A link, or a wall of repeated characters, read out on stream.
- One busy channel using up the credits the look-sounds pipeline and the other streamers need.
- A replayed or repeated capture read twice (the alert already fires only for a new row).
- English typed into the views, or a text missing from any of the seven locales.

## Owner's decisions (2026-10-16)

- ElevenLabs, on Atleta's own account (the owner's Creator plan, 131,000 credits a month, shared with the look-sounds pipeline).
- Only tips through the Atleta tip page. Off until the streamer turns it on.
- Default threshold: 5, in the tip page's currency; the streamer changes it.
- Links and spam are never read. Insults and slurs are not blocked by Atleta; the streamer's own banned words (the chat bot's list) apply, so a streamer who wants them blocked adds them there. Twitch holds the streamer responsible for what their TTS says (told to the owner).
- Each streamer picks the language and the voice from menus on the dashboard, and sets speed, expressiveness and volume.
- The line is the streamer's template; default "{name} tipped {amount}: {message}" in the chosen language (e.g. "PitBoss92 tipped 25 euros: Great race today!"); a streamer may write anything around the placeholders ("{name} got scammed out of {amount}: {message}").

## What the streamer sees (donations settings page, `/dashboard/donations`)

A "Read tips aloud" section next to the tip page settings:

- **Switch** (off by default).
- **Read tips from**: an amount in the tip page's currency (default 5; at least the tip page's minimum).
- **Language**: the seven site languages.
- **Voice**: the voices curated for that language (about 4–6 each, male and female), each with ▶ — a recorded sample, so listening costs nothing.
- **Speed** (0.7–1.2), **Expressiveness** (Calm … Lively: ElevenLabs stability and style), **Volume** (0–100 %, relative to the overlay volume).
- **What it says**: the template, with the placeholders listed and an empty-message variant (see below); at most 200 characters.
- **Test the voice**: reads a sample tip (a locale sample name and message, the threshold as its amount) built and cleaned exactly like a real one, with the current settings. It plays in the page (the page fetches the file through an authenticated dashboard route) and, when the overlay is open, in OBS too. It uses real credits: it counts toward the monthly limit and has a 10-second cooldown.
- **This month**: characters used of the limit, and the reset date.

The Donations working card gets the same switch (a `dashboardSettings.js` key) and a status line ("Reading tips from €5 · 2,340 of 15,000 characters this month").

## What happens when a tip comes

1. `tipCapture` records a new donation; `announceTip()` (`routes/tip.js`) is where the alert is fired.
2. The tip is read only when all of these hold: the streamer's TTS is on; the amount is at or above the threshold, in the tip page's currency (a tip in another currency is not read); the overlay switch (`overlay_enabled`) and the donation alert are on; an alert overlay is open in OBS (`overlayPresence`); neither limit would be passed by this line (below). Otherwise the alert fires at once, exactly as today, and nothing is sent to ElevenLabs.
3. When it is read, the server builds the line:
   - `{name}`: the donor's name, cleaned like the message (links removed, repeated runs cut to 3). A name that hits the streamer's banned words is spoken as a locale text ("Someone"), as is an empty name.
   - `{amount}`: spoken form in the chosen language ("25 euros"), at most two decimals, ".00" dropped.
   - `{message}`: the donor's message, cleaned: links removed (`chatFilters.containsLink`'s rule), runs of the same character or emoji cut to 3, the result cut to 200 characters. A message that hits the streamer's banned words (`chatModeration.checkBannedWords`, regex words included, at the same bounded cost) is **not read at all**: the line uses the template's no-message variant. An empty message uses that variant too ("{name} tipped {amount}!").
4. **The alert waits for its voice** (the owner's choice): the server asks ElevenLabs for the audio (the streamer's voice id and settings) with one 15-second deadline, stores the MP3 at `data/tts/<streamerId>/<uuid>.mp3`, and only then emits the donation alert, with `tts: { url }` in its data. If the audio fails or the deadline passes, the alert is emitted without it, as today. Tips are handled one at a time per streamer, so a burst of tips is read in order.
5. The URL is served by an overlay-token route (`/overlay/tts/:token/:file`, with `userContentHeaders.js`'s headers), so a token reaches only its own streamer's files.
6. The OBS overlay plays the voice as part of that alert: through its AudioContext at the overlay volume × the TTS volume, starting when the alert's own sound has played (about 1 s in). The alert stays on screen until the reading ends (its duration or the reading, whichever is longer, at most 30 s), and the next alert in the queue waits as it does today.
7. Files are removed after one hour by the daily cleanup in `index.js`.

The donation's row records what happened (`donations.tts_status`: `read`, `below_threshold`, `other_currency`, `overlay_closed`, `limit`, `failed`, or NULL when TTS is off), shown in the donation history so the streamer can see why a tip was not read. Failures are also logged at most once per streamer per hour, and the settings page shows the last error.

## Cost limits

- **Per streamer**: 15,000 characters a calendar month (UTC) by default, counted as the full line sent to ElevenLabs (template text, name, amount and message); an admin can change one streamer's limit in the admin panel.
- The line's characters are **reserved before** the request (so two tips at once cannot both pass the limit) and stay counted even when the request times out; a line that would pass the limit is not read at all (never cut short to fit).
- **Site-wide stop**: the server reads the account's remaining credits (`GET /v1/user/subscription`, `character_limit − character_count`) at most every 10 minutes; below `TTS_CREDIT_FLOOR` credits (default 20,000) nothing is read until the next reset. The streamer's limit is in characters; the floor is in ElevenLabs credits (equal on the multilingual model, half on Flash).
- The test button counts toward the streamer's limit.

## Data

- `streamers` columns: `tts_enabled` (0/1, default 0), `tts_min_amount` (REAL, default 5), `tts_language` (TEXT), `tts_voice` (TEXT, a curated id), `tts_speed` (REAL, 1.0), `tts_expressiveness` (REAL 0–1, 0.5), `tts_volume` (REAL 0–1, 0.8), `tts_template` (TEXT, NULL = the language's default), `tts_template_empty` (TEXT, NULL = default), `tts_monthly_limit` (INTEGER, NULL = 15,000).
- `donations.tts_status` (TEXT, NULL) — what happened to the tip's voice (above).
- `tts_usage` table: `(streamer_id, month 'YYYY-MM', characters)`, primary key `(streamer_id, month)`, owned by the streamer (`STREAMER_OWNED_ROWS`).
- Curated voices: `src/services/ttsVoices.js` (language → `[{ id, name, gender }]`); previews as static files `public/tts/previews/<voice>.<lang>.<hash>.mp3`, made once with the existing `.superpowers/sounds/` pipeline.

## Configuration

- `ELEVENLABS_API_KEY` becomes a production secret on the Railway service (today it is "development only": `CLAUDE.md`, `.env.example`, `docs/operations/deploy.md` change). Unset: the section says the feature is not available; nothing else changes.
- `TTS_CREDIT_FLOOR` (default 20000).

## Constraints

- Every outbound call has a deadline (`AbortSignal.timeout()`); the key is only ever read on the server.
- All database access through `src/db.js`; new columns via the startup migrations; the settings save checked and clamped on the server (the `donationSettings.js` pattern); a `/dashboard/settings` key for the card's switch.
- Every text in all seven locales (`tests/i18n.test.js`); the default templates per language are locale texts.
- Tests never touch the network: ElevenLabs is stubbed.

## Left to the builder

- The exact voices per language (from ElevenLabs' library, licensed for commercial use), the sample sentence, the spoken-amount rules per language, the model (multilingual v2 or Flash, measured for quality and cost), and where in `overlay.js` the playback hooks in.

## Decisions after the builder check

The owner's: the alert waits for its voice (up to 15 s), then plays with it.

Calls made while writing this (the owner may overrule): the donor's name is cleaned and banned-word-checked like the message ("Someone" when it hits or is empty); nothing is generated while the overlay or the donation alert is off or no alert overlay is open in OBS; the limit counts the full line, is reserved before the request, and a line that would pass it is skipped, not cut; each donation records its TTS status, shown in the donation history; the test reads a cleaned sample at the threshold amount, in the page and in OBS.
