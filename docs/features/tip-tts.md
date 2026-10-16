# Tips read aloud (ElevenLabs text-to-speech)

A tip paid through the Atleta tip page (`/tip/:username`, PayPal) can be read aloud in OBS by an ElevenLabs voice, as
part of its donation alert. The streamer switches it on and sets it up in the "Read tips aloud" section of
`/dashboard/donations`; the Donations working card has the same switch. It runs on Atleta's own ElevenLabs account
(`ELEVENLABS_API_KEY`), never on a key of the streamer's, and the key never reaches a browser.

Design: `docs/superpowers/specs/2026-10-16-tip-tts-design.md`; plan: `docs/superpowers/plans/2026-10-16-tip-tts.md`.

## What the streamer sets

- **The switch** (`tts_enabled`, off by default). Offered only while the site has an ElevenLabs key: without one the
  section says the feature is not available, and the card has no switch (`/dashboard/settings` refuses `tts_enabled`
  with `tts_unavailable`).
- **Read tips from** (`tts_min_amount`, default 5) in the tip page's currency, at least the tip page's minimum (and at
  least 0.50), at most 10,000, any amount in cents.
- **Language** (the seven site languages) and **voice** (that language's curated voices, `src/services/ttsVoices.js`),
  each with ▶: a recorded preview, so listening costs nothing.
- **Speed** (0.7–1.2), **expressiveness** (0 Calm … 1 Lively: ElevenLabs stability 0.85 − 0.6 × e and style 0.6 × e,
  `voiceSettings()` in `src/services/elevenLabs.js`) and the voice's **volume** (0–100 %, times the overlay volume).
- **What it says**: a template with `{name}`, `{amount}` and `{message}`, and a second one for a tip without a message
  (each at most 200 characters; empty is the language's default, e.g. "{name} tipped {amount}: {message}" and
  "{name} tipped {amount}!").
- **Test the voice**: reads a sample tip (the locale's sample name and message, the threshold as its amount) built and
  cleaned like a real one, with the settings the form shows (saved or not). It plays in the page and, when an alert
  overlay is open in OBS, there too as a donation alert. It uses real characters: it counts toward the month and has its
  own 10-second cooldown.
- **This month**: characters used of the streamer's limit, and the reset date (the 1st, UTC). The last problem, if any,
  is shown in words under it (never as its stored code).

The save (`POST /dashboard/donations/tts`) is checked and clamped on the server (`src/services/ttsSettings.js`): a
number out of range is brought into range, an unknown voice becomes the language's default, a template is cut to 200
characters, and an unknown language answers `?error=bad_language` with nothing stored.

## When a tip is read: the gates, in order

`announceWithVoice()` (`src/services/tipVoice.js`), called by `announceTip()` in `src/routes/tip.js` only after
`db.logDonation()` recorded a new row (so a replayed capture is never read twice). The first gate that stops it decides
the tip's `donations.tts_status`:

1. TTS is off → no status (NULL); the alert fires as before.
2. The tip's currency is not the tip page's → `other_currency`.
3. The amount is below the threshold → `below_threshold`.
4. The overlay switch (`overlay_enabled`) or the donation alert is off → `blocked_off`.
5. No alert overlay is open in OBS (`overlayPresence.isOpen`) → `overlay_closed`.
6. No API key → `failed` (the last problem: `no_key`).
7. The account's remaining credits are known and under `TTS_CREDIT_FLOOR` → `limit` (the last problem: `credit_floor`).
8. The line would pass the streamer's monthly limit → `limit`.
9. ElevenLabs answers with audio within the deadline → `read`; anything else → `failed`.

Gates 1–5 send nothing to ElevenLabs (`speechDecision()` in `src/services/tipSpeech.js`).

## The line

`prepareSpeech()` in `src/services/tipSpeech.js` fills the template in one pass (a value that holds `{name}` is not
filled again):

- `{name}`: the donor's name, cleaned like the message; empty, or hit by the streamer's banned words, it is read as the
  locale's "Someone".
- `{amount}`: spoken in the chosen language, "25 euros", "12,50 euros" (`spokenAmount()`: at most two decimals, ".00"
  dropped, the language's decimal separator, the currency's spoken name from the locale or else its code).
- `{message}`: the donor's message with line breaks, control and invisible formatting characters removed, runs of one
  character (or emoji) cut to three, every word that is a link dropped (`chatFilters.containsLink`), then cut to 200
  characters. A message hit by the streamer's banned words (`chatModeration.checkBannedWords`, regex words included) is
  not read at all: the no-message template is used, as for an empty message.

Insults are not blocked by Atleta: the streamer's own banned words (the chat bot's list) apply.

## Limits

- **Per streamer:** 15,000 characters a calendar month (UTC) by default (`config.tts.monthlyLimit`); an admin changes
  one streamer's limit in the admin panel's Users tab (`POST /admin/streamers/:id/tts-limit`, 0 to 1,000,000, empty =
  the default; stored in `streamers.tts_monthly_limit`). The whole line counts (template text, name, amount, message),
  reserved in `tts_usage` before the request, so two tips at once cannot both pass the limit; reserved characters stay
  counted when the request then fails or times out. A line that would pass the limit is not read at all, never cut.
- **The site floor:** the account's remaining credits (`GET /v1/user/subscription`, `character_limit −
  character_count`) are read at most every 10 minutes (`remainingCredits()`; a failed read waits the same 10 minutes).
  Below `TTS_CREDIT_FLOOR` (default 20,000) nothing is read until ElevenLabs' monthly reset. The account is shared with
  the look-sounds pipeline (`docs/features/look-sounds.md`).
- **The deadline:** 15 s per tip, from the start of the tip's turn: it covers the credits read, the reservation, the
  request and writing the file.

## Statuses (`donations.tts_status`)

`read`, `below_threshold`, `other_currency`, `blocked_off`, `overlay_closed`, `limit`, `failed`, or NULL while TTS is
off. The donation history shows them in a TTS column (`TTS_STATUS_TEXTS` in `ttsSettings.js`) while the streamer has TTS
on or any listed tip has a status. A failure is stored on the streamer (`tts_last_error`, `tts_last_error_at`: `no_key`,
`credit_floor`, `elevenlabs_<status>`, `elevenlabs_timeout`, `elevenlabs_failed`, `elevenlabs_empty`, else `failed`)
for the settings page, and logged at most once per streamer an hour.

## Files and cleanup

- A tip's audio is `data/tts/<streamerId>/<uuid>.mp3`, written before the alert is emitted. The overlay fetches it from
  `/overlay/tts/:token/:file` (`src/routes/overlay.js`): resolved from the overlay token, only a name tipVoice makes,
  only from that streamer's folder, with `userContentHeaders.js`'s headers; anything else is 404. A test's audio is
  served to the page from `/dashboard/donations/tts/audio/:file` (the logged-in streamer's own folder).
- `cleanupTtsFiles()` runs every hour from `src/index.js` and removes files older than an hour and the folders left
  empty.
- The previews are static files, `public/tts/previews/<voiceId>.<lang>.<first 8 hex of the SHA-256 of the file>.mp3`,
  served with a one-year immutable cache (`HASHED_RECORDINGS` in `src/server.js`, like the look recordings).

## In the overlay

The alert is emitted only once the voice is ready (or has failed), with `tts: { url, volume }` in the donation's data;
tips of one streamer go one at a time in order, so a burst is read in order. The OBS overlay (`public/overlay/overlay.js`,
`loadTipVoice()`) fetches and decodes the voice before the alert shows, waiting at most 3 s; a voice that cannot be
loaded in time leaves the alert as it always was, and at overlay volume 0 nothing is loaded. It plays through the
overlay's AudioContext at the overlay volume × the TTS volume, 1 s after the alert starts (the alert's own sound gets
that second), and the alert stays on screen until 0.3 s after the last word: the streamer's duration or the reading,
whichever is longer, at most 30 s (`public/overlay/tipVoiceTiming.js`, `voiceHoldMs()`).

## Feature flags

Speech plays only through the alert overlay, so with `features.overlays` off the donations page has no read-aloud
section, the Donations card has no TTS switch or line, and the donation history has no TTS column. The stored settings
stay.

## Decisions that change what a streamer sees

The owner's (16 October 2026, the spec):
- ElevenLabs on Atleta's own account (the Creator plan, shared with the look sounds); only tips through the Atleta tip
  page; off until the streamer turns it on; default threshold 5 in the tip page's currency.
- Links and spam are never read; insults are not blocked by Atleta, the streamer's banned words apply.
- The streamer picks the language and voice and sets speed, expressiveness and volume; the line is the streamer's
  template.
- The alert waits for its voice (at most 15 s), then plays with it.

Rulings made while building it:
- Ruling 8: credits not known yet (no good read of the subscription so far) do not stop reading; only a known balance
  under the floor does. The monthly limits still bound the spend.
- Ruling 10: with no API key a tip that would be read is recorded as `failed` (last problem "no key"), and Test the
  voice answers "not available" without taking the cooldown.
- Ruling 11: a tip that is not read but arrives behind one being read waits for it, so alerts never show out of order;
  its alert can lag up to 15 s behind a burst.
- Ruling 13: the section's switch is a plain checkbox: a save with it unticked stores it off and keeps every other
  value the form sent.
- Ruling 15: with `features.overlays` off the section, the card's switch and line, and the history's column are hidden
  (above).

## The voices

`src/services/ttsVoices.js`: 4–6 voices per language, women's and men's; the first is the language's default. English
uses ElevenLabs' premade voices (Jessica, Liam, Sarah, Brian, Laura, Will), which ElevenLabs owns (no library owner
can withdraw them). The other languages use native speakers from ElevenLabs' voice library (pt: two from Portugal,
three from Brazil, the region in their name; es: Spain, Latin America and Mexico), chosen with `rate` 1 (no extra
cost), no live moderation and a notice period of at least 365 days before an owner can withdraw a voice (zh's
Julia: 365; the others: 730). Library voices are used directly by id (ElevenLabs adds one to the account's "My Voices"
on first use; it takes no voice slot) and may be used commercially on a paid plan. A voice that is withdrawn makes
its tips fail (`elevenlabs_<status>`) until it is replaced in the list. All voices use the one model,
`ELEVENLABS_TTS_MODEL` (default `eleven_multilingual_v2`).

### Adding or replacing a voice

1. Pick it: `GET /v1/shared-voices?language=<lang>&sort=usage_character_count_1y` (check `rate`, `notice_period`,
   `live_moderation_enabled`), or a premade one from `GET /v2/voices`.
2. Record its preview with the development `.env`'s key: the language's default template
   (`defaultTemplates(i18n.t, lang)` in `tipSpeech.js`) filled by `buildLine()` with `tts.sample.name`,
   `spokenAmount(25, 'EUR', lang)` and `tts.sample.message`, sent through `elevenLabs.synthesize()` with speed 1 and
   expressiveness 0.5 (about 40–70 characters a preview). The first set was recorded on 16 October 2026 (37 previews,
   1,532 characters) with a helper kept in the gitignored `.superpowers/sdd/2026-10-16-tip-tts/t8-record.js`.
3. Save it as `public/tts/previews/<voiceId>.<lang>.<first 8 hex of its SHA-256>.mp3` and add
   `{ id, name, gender, preview: '/tts/previews/<file>' }` to the language in `ttsVoices.js`; delete the file of a voice
   that leaves.
4. `tests/ttsPreviews.test.js` checks every voice's preview (its name, content hash, MP3, at most 200 kB), 4–6 voices
   per language with both genders, and that no file is left over. A streamer whose stored voice leaves the list is read
   with the language's default (`isVoice`/`defaultVoice`).
