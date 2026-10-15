# Alert styles: a gallery of finished looks for every alert — design

**Date:** 2026-10-15
**Status:** written for the owner's review
**Extends:** `2026-10-09-samurai-alert-objects-design.md` (the five alert objects and their registry in
`public/overlay/objects/`).
**Builds on:** `feat/vilela-c1-donation` (Vilela's C1 donation alert). That branch adds the `overlay_designs.style`
column, a builder save and a Reset that keep it, the style map next to the five objects
(`window.ATLETA_OBJECT_STYLES`), `objectFor()` in the overlay and each object's own exit time. It merges first;
everything here extends what it built.
**Visual reference:** the proposal page, https://claude.ai/artifact/HbyZwPiMjL3gKzBuc8Emi5 (version 4). Its
source is in `docs/superpowers/specs/assets/2026-10-15-alert-styles/` (see its `README.md`). Every look there
is the reference for the code: markup, CSS and timing move over unchanged.

## 1. What this is

A streamer picks how each alert looks from a gallery of finished, hand-timed looks. A look belongs to a
**family**, and a family gives all six alerts one look: Samurai, Racing, Grand Prix, and 15 more. On top of any
look the streamer can change its colour, its main text and its speed, pick a screen effect and a sound, and
turn off "grows with the amount". Today's looks become presets, so nobody's overlay changes until the
streamer picks something new. The giveaway is the one exception: its card is improved in place (4.3).

The six alerts are follow, subscription, bits, donation, raid and giveaway winner. YouTube's three alerts,
timed messages and the separate OBS sources (sponsors, tip goal, VTuber, iRacing) are not part of this.

## 2. What the owner decided (15 October 2026)

- Today's looks are kept as presets named `follow-samurai`, `subscriber-samurai`, `bits-samurai`,
  `donation-samurai`, `raid-samurai` and `giveaway-racing`.
- A gallery of finished looks, with layers on top (screen effect, sound, grows with the amount), rather than
  a generator that builds looks from parts.
- The racing cards come back for all six alerts, improved, with every colour, font and text still editable,
  and the giveaway's card is improved in place. The first rebuild was "boring"; the night-race version in
  proposal 4 replaces it.
- Grand Prix, Cockpit and Arcade are built; Quest's animations are tidied (proposal 4).
- All 18 families are kept: Samurai, Racing, Grand Prix, Cockpit, Arcade, Quest, Comic, Cozy, Cosmos, Glass,
  Spooky, Cyber, Western, Retro OS, Graffiti, Kawaii, Steampunk and Frost. That is 108 looks (Appendix A).
- Every look's colour is customizable by the streamer, today's samurai looks and the omikuji included (given with
  the spec's approval).

## 3. Goals and non-goals

Goals:

- Every look plays in OBS exactly as it plays on the proposal page.
- In the Overlay Builder a streamer picks a look per alert, or a whole family in one click, sees it in the
  builder's preview, and an open OBS source switches without being reloaded.
- No overlay changes on release unless its streamer picks a new look (the giveaway apart, as decided).
- After the first release, each family ships on its own.

Non-goals:

- Translating the words inside the looks on stream ("joined the party", "ACCESS GRANTED"). The overlay is in
  English today, and a look's main text is the streamer's own (4.4). That can follow later.
- YouTube's alerts, timed messages, sponsors, the tip goal, VTuber and iRacing sources: unchanged.
- Building looks from parts, and showing the chosen styles on the dashboard's working cards.

## 4. How it works

### 4.1 Style ids and the catalogue

- A **style id** names one look: `<alert>-<family>`, for example `follow-quest` or `subscriber-frost`.
  Subscriptions use `subscriber`, as the owner named them. Appendix A lists all 108.
- `src/services/alertStyles.js` (new) is the server's catalogue, plain data that nothing else duplicates. For
  each style id it records:
  - the alert type it draws: `follow`, `subscription`, `bits`, `donation`, `raid` or `giveaway_winner`;
  - its family, and what the streamer may change (4.4);
  - its default sound and screen effect, and whether it grows with an amount.

  It also lists the families (in the gallery's order) and every sound.
- **Private styles** stay as the C1 branch made them. `donation-c1` is in the catalogue with its owner's
  Twitch user id. Only that streamer sees it in the builder (4.6), and the save refuses it for anyone else.
- The client registry (4.3) holds the same ids; a test fails when the two lists differ.

### 4.2 What is stored

`overlay_designs` has one row per streamer and alert. The C1 branch adds `style` (NULL: the alert's default
look), and its save writes only the columns it lists, so it never clears one it does not. This design adds four
nullable columns. In each, NULL means "the look's own":

| Column | Holds | Used for |
|---|---|---|
| `style_accent` | a `#rrggbb` colour | the accent colour of a look that takes one (4.4), except Racing's |
| `style_label` | text, at most 40 characters | the main text of a look that takes one (4.4), except Racing's |
| `style_sound` | a sound key from the catalogue, or `none` | the sound layer (4.7) |
| `style_grows` | 0 or 1 | grows with the amount (4.5) |

These existing columns are reused:

- `animation_speed` (0.5–2) becomes the look's speed (`--spd`).
- `screen_effect`: its value `default` now means the look's own effect, and five effects are added (4.8).
- The placement columns (`card_position`, `card_custom_x/y`, `card_width`) work as today.

Racing is today's card, so it keeps today's columns:

- `bg_color` (card), `accent_color` (accent), and `username_color` or else `text_color` (the name).
- `username_font_family` (the name's font; Kanit when the streamer never chose one) and `event_label` (its text).

A streamer's saved giveaway colours and text therefore carry over to the improved `giveaway-racing`.

Other families get new columns because `accent_color` and `event_label` already hold today's defaults in every
saved row. A Quest look reading them would come out lavender, saying "New Pit Crew Member".

**Validation.** The fields go through `FIELD_SPECS` in `src/services/overlayDesign.js`:

| Field | Accepted | Otherwise |
|---|---|---|
| `style` | a public style id that draws this alert, or the streamer's own private one | 400 |
| `style_accent` | a hex colour | 400 |
| `style_label` | text | cut to 40 characters |
| `style_sound` | a catalogue sound or `none` | left out: the look's own sound |
| `style_grows` | a switch value | 400 |

An empty `style` means the alert's default look. A 400 names the field, as for any other value no builder
could have sent.

**Saving.**
- The builder's save writes the design as today, now including the look and its four `style_*` fields. When the
  request names a style, the save sets it with the C1 branch's `setOverlayDesignStyle()`.
- A look's settings are the four `style_*` values, the screen effect and the speed; only the placement belongs
  to the alert. So picking another look in the builder first puts those controls back to the new look's
  defaults (`style_*` empty, `screen_effect` back to `default`, `animation_speed` back to 1), and the save stores
  what the builder sends. Values an older builder saved for the legacy cards never leak into a new look.
- The builder always stores the id it shows; NULL remains only in rows nobody has touched since the release.
  The default id and NULL draw the same look.

**Use one family for all six alerts.** `POST /dashboard/overlay-builder/family` with `{ family }` sets the
family's look on the six rows in one transaction and puts the look's settings back to their defaults in each row
whose look changed (as the builder does when a look is picked). It creates the default row where none exists,
as `setOverlayDesignStyle()` does, and sends one `config-update` to the overlay.

**Reset** (the C1 branch's `resetOverlayDesign()`) keeps the chosen look and puts everything else back to its
defaults, the `style_*` columns included: "reset this look". A streamer goes back to today's look by picking it
in the gallery.

### 4.3 The registry: one set of files draws every look

The Overlay Consistency Rule stands: the OBS overlay and the builder preview draw from the same files in
`public/overlay/objects/`.

**Files.**
- `objects/index.js` keeps the five objects (today's samurai looks) and the C1 branch's style map.
- `objects/kit.js` (new) holds what every look shares, moved from the proposal's `90-core.js`:
  - the helpers `esc`, `money`, `nm`, `fitStyle`, `label`, `fmt`, `odo`, `typed`, `hash`, `rng`, `code3`, `intOf` and `onColour`, plus `sizeOf` (4.5);
  - `register(style)`, which adds a look to the style map;
  - the sound helpers (4.7).
- The kit's shared styles (`.o-nm`, `.o-odo`, `.o-typed`, `.o-ch`) move into `objects.css`.
- `objects/styles/<family>.js` and `<family>.css` (new) are one pair per family:
  - most come from the proposal's `parts/fam/<key>.*`;
  - Grand Prix, Cockpit, Arcade and the omikuji come out of its `40-styles.css` and `90-core.js`.

  Each look registers `{ key, eventType, family, anim, exit, len, render(d) }`, the shape of the C1 style.
- **Serving.** The server joins the family files into one stylesheet and one script when it starts:
  `GET /overlay/objects/styles.css` and `/overlay/objects/styles.js`, cached and marked with the server
  instance id. Pages make two requests, the repository keeps one readable file per family, and there is still
  no build step.
- Every file stays plain browser JavaScript and also exports for Node, so the unit tests render every look.

**Presets and defaults.**
- `follow-samurai` … `raid-samurai` register today's five objects under those ids. They point at
  `ATLETA_OBJECTS[type]`; nothing is copied.
- `giveaway-samurai` is the omikuji, and `giveaway-racing` is Racing's Victory lap.
- An alert with no style (NULL) draws its **default look**:
  - the five alerts draw today's object, as now;
  - the giveaway draws `giveaway-racing` instead of today's legacy card. This is the decided improvement in
    place: today's card takes its colours only from a saved design, so without one it is see-through.

### 4.4 What a streamer can change, per look

| Look | Colour | Main text | Speed | Effect | Sound | Grows | Position and width |
|---|---|---|---|---|---|---|---|
| Today's five (samurai presets) | accent (Ronin red by default) | – | – | yes (none by default, as today) | yes | – | yes |
| Omikuji | accent | yes | yes | yes | yes | – | yes |
| Racing | card, accent, name colour, name font | yes | yes | yes | yes | where it has an amount | yes |
| Every other family | accent | yes | yes | yes | yes | where it has an amount | yes |

**Colour.** Every look takes the streamer's colour, and a change of colour must be obvious at a glance in the
finished look: the accent colours its main element (its plate, frame, hero object or headline). On the proposal
page the colour swatches set three CSS variables: `--a` (the accent), `--a-rgb` (the same colour as numbers) and
`--a-on` (black or white, whichever reads better on it, as `onColour()` decides). In OBS the overlay sets the same
three on the alert's slot from `style_accent`, plus four shades worked out from it: `--a-hi` (lighter), `--a-lo`
(darker), `--a-deep` (much darker) and `--a-soft` (a muted tone for small text).

Today's samurai looks are drawn in one red and a dozen fixed shades of it. Each shade reads the matching variable
with today's colour as its fallback (`var(--a-hi, #F0343C)`), so the look follows the accent once one is chosen,
and an alert nobody has restyled stays exactly as it is. The omikuji does the same.

**Main text.** The main text is the look's main line ("Quest accepted", "WANTED"); a look shows its own words
while it is empty. The other words inside a look stay English, as the overlay is today.

### 4.5 The OBS overlay (`public/overlay/overlay.js`)

- **Which look.** The C1 branch's `objectFor(type)` returns the style the design names, when the page knows
  it and it draws this alert. Otherwise it returns the default look: today's object for the five alerts,
  `giveaway-racing` for the giveaway (new). Anything else gets the legacy card. YouTube's alerts are unchanged.
- **What the slot carries.** Before an alert renders, its slot gets:
  - `--spd` from `animation_speed` (today it is fixed at 1). Today's five samurai looks keep 1: older builders
    saved a speed for the legacy cards, and it must not start changing them;
  - the three colour variables from `style_accent`;
  - Racing's colours and font from its columns.
- **What a look receives.** Today's event data, plus `label` (`style_label`, or `event_label` for Racing) and
  `size`.
- **Grows with the amount.** A look that grows reads the size of its picture from `sizeOf(d)`. That is the real
  amount, unless `style_grows` is 0: then it is a fixed middle value (500 bits, 42 viewers, 4 months, €25). The
  words always show the real amount.
- **Timing.**
  - A look brings its own entrance and exit (`anim`, `exit`), as the objects do today.
  - It stays on screen for the streamer's duration, but never less than its entrance (`len`) plus one second.
  - It leaves after its own exit has run (the C1 branch's `exitMs()`).
- **Fonts.** Each family file names its Google Fonts. `loadDesignFonts()`, which today loads the fonts chosen in
  the builder, also loads the fonts of every style the designs name, on connecting and on each
  `config-update`. The first alert in a style waits at most 1.5 s for its fonts, then plays with the fallbacks.
- **A new look while OBS is open.** Every family's code is on the page, so a builder save reaches an open
  overlay with `config-update`, as today, and nothing reloads.
- **Box sizing.** The overlay page sets `box-sizing: border-box` on every element (`overlay.css`). Seven
  families were drawn with content-box: Grand Prix, the omikuji, Quest, Comic, Cozy, Cosmos and Cyber. Each
  declares that on its own root and descendants, as the proposal already does.
- **Width.** Looks are drawn for the default width, 420 px. Any other width scales the look (`zoom` on its
  wrapper) instead of reflowing it, so a 600 px slot shows the same look, larger. Today's five objects keep
  reflowing as they do now.

### 4.6 The Overlay Builder (`src/views/overlay-builder.ejs`)

- **The gallery.** Each of the six alert tabs opens with a **Style** section: the gallery of that alert's looks.
  - The alert's default look comes first, marked "Today" (for the giveaway, "Default").
  - The other looks follow in family order, filtered by family, with the chosen one marked.
  - A private look the streamer owns (andre_vilela_'s C1) comes first of all, as "Made for you".
- **A gallery tile** shows the look itself (the registry, at rest, scaled down), its name and its family. It plays
  when hovered or focused, one at a time, as the proposal's tiles do.
- **Use \<family\> for all six alerts** is one button under the gallery (4.2).
- **The look's controls** follow the gallery (4.4):
  - colour (the accent swatches and a colour picker), main text and speed;
  - under "On top of the look": the screen effect, the sound (grouped by family, with ▶ to listen) and grows
    with the amount;
  - Racing also shows its colour and font controls.

  Today's card controls (gradients, borders, glow, shadows, side icons, entrance and card animations) stay for
  YouTube's alerts and are hidden for the six. `syncPhase1Controls` already hides them for the objects today.
- **Preview.** The preview plays the chosen look with the same files and the same rule as OBS (the C1 branch's
  `previewObjectFor`). Position and width work as today, and the chosen look's description shows under the
  preview.
- **Test** plays the look in the preview and, through the existing test route, in OBS (the shared test cooldown
  applies).
- **Translation.** All builder text goes through `t()` in the seven languages: section and button texts, the 18
  family names and descriptions, the 108 look names and descriptions, the sound names and the five new effect
  names. `tests/i18n.test.js` already checks them.
- **Fonts.** The builder loads every family's fonts in one stylesheet with `display=swap`.

### 4.7 Sounds

- Each look has its own sound, made in the browser like today's sounds. The proposal's `tone`, `noise` and
  `engine` helpers move into the kit and use the overlay's AudioContext and volume.
- **Which sound plays:**
  1. a sound the streamer uploaded for this alert, as today;
  2. else `style_sound` (`none` is silence);
  3. else the look's own sound.

  Today's five samurai looks play today's sounds ("Today's sound"), whether no style is set or their preset id
  is. Every other look plays its own, the giveaway's new default included (`giveaway-racing`: Victory lap). The
  proposal's samurai sounds (blade draw, taiko, koto, temple bell) join the list, and the omikuji uses the
  temple bell.
- The builder's sound list holds every sound, grouped by family, with "Today's sound" and "None".

### 4.8 Screen effects

- Five effects join `screen_effect`: `smoke` (tyre smoke), `checker` (chequered confetti), `speed` (speed
  lines), `sparks` (titanium sparks) and `champagne`. They go into `FIELD_SPECS`, the overlay's `spawnEffects()`
  and the builder's `renderScreenEffect()`, which must match (Overlay Consistency Rule). The proposal's `fx()`
  is their reference.
- `default` means the look's own effect.
- Today the overlay runs an effect only for the legacy cards (`if (!objectDef)` in `showNotification()`), so the
  five samurai looks have none. With this change it runs one for every look: the effect the design names, or
  the look's own. Today's five have no effect of their own. An alert nobody has restyled since the release
  keeps no effect, whatever an older builder saved in `screen_effect`; the setting applies once the streamer
  picks a look in the gallery.
- The giveaway's saved effect carries over to `giveaway-racing` like its colours; its `default` becomes the new
  look's own (chequered confetti).
- An effect covers the whole 1920×1080 screen, uses at most 60 particles, runs once and is gone after 5 s.

## 5. Moving a family from the proposal

A family moves as a unit, and nothing about how it looks changes.

1. **Files.** Copy `parts/fam/<key>.css` to `objects/styles/<family>.css`, and the looks in
   `parts/fam/<key>.js` to `objects/styles/<family>.js`.
2. **Registration.** Each `add({...})` becomes `register({...})` with its `eventType` (`giveaway` →
   `giveaway_winner`). Shared helpers come from the kit; a family's own helpers stay inside its function.
3. **Amounts.** Picture sizes read `sizeOf(d)`; words read the real amount.
4. **Sounds.** `SOUNDS.x = …` becomes `registerSound('x', fn)`, and the name becomes a translation key.
5. **Names and sizing.** Keep the prefixes (classes `.o-<key>…`, keyframes `<key>…`), and the
   `box-sizing: content-box` line in the families that have it.
6. **Catalogue and translation.** Add the family to `alertStyles.js`, with keys for its name, its six looks and
   its sounds in all seven languages.
7. **Check** with the proposal's tools, side by side with the proposal page (`tools/film.js`: filmstrips, the
   gallery, `audit()`; `tools/compare.js`).

## 6. When something is missing or fails

- **A style id the page doesn't know** (an OBS page from before a release, or a family file that didn't load):
  the alert draws its default look. A slot is never left empty.
- **A look that throws while rendering:** the alert falls back the same way, and the overlay logs it once.
- **Fonts that haven't loaded after 1.5 s:** the look plays with the fallback fonts.
- **A `style_sound` the page doesn't know:** the look's own sound plays.
- **The C1 branch's guarantees hold:** a save never drops `style`, and Reset keeps it.

## 7. Testing

**Unit tests:**

- **`tests/overlayObjects.test.js`** (extends the C1 branch's):
  - every catalogue style is registered and draws its alert;
  - every look renders at Small, Medium and Big, with a 25-character name and with hostile text (all of it escaped), and nothing throws;
  - grows off gives the middle picture;
  - every animation time in a family's CSS is divided by `--spd`;
  - every class and keyframe carries the family's prefix, and no selector reaches inside another part (`.x i`, `.x span`, `.x div`);
  - nothing uses `:has()`, `color-mix()`, container queries, `@property` or `backdrop-filter`;
  - every keyframe a look uses is defined;
  - every look's own CSS colours something with the accent, and every shade of today's samurai red reads its
    variable with today's colour as the fallback.
- **`tests/alertStyles.test.js`** (new): the catalogue and the registry list the same ids, every family has all six alerts, and every default sound and effect exists.
- **`src/db.overlayDesigns.test.js`** (the C1 branch's): the `style_*` columns survive a save, Reset clears them and keeps the look, and the family route sets six rows in one transaction and resets the look's settings in the rows whose look changed.
- **`src/routes/dashboard.test.js`:** the save answers 400 for an unknown style, a style of another alert, or another streamer's private style; the family route works.
- **`src/services/overlayDesign.test.js`** (existing): the builder's controls and `FIELD_SPECS` stay in step.
- **`tests/overlayClient.test.js`:** `objectFor()` with styles, the giveaway's new default look, the slot's variables, the exit and the minimum time on screen, the fallback for an unknown style, and an alert with no style staying exactly as today (today's object, speed 1, no effect, today's sound).
- **`tests/i18n.test.js`** (existing): the new keys exist in all seven languages.

**In OBS, by hand, at each release:**
- Play every new look once, at 1× and 1.5×, in a real browser source, and once more with a second colour far from
  the first (a red and a cyan): the change must be obvious.
- Watch the 3D looks (Quest's, Cyber's and Western's giveaways) and the clip-path reveals most closely.

## 8. Releases

Each release gets its own plan, and the first plan covers release A. After A, the families don't depend on each
other.

- **A — the style system,** after the C1 branch merges. It brings:
  - the columns, the catalogue, the kit and the joined files;
  - the overlay and builder changes, the sound and effect layers, and the translations;
  - the Samurai presets with the omikuji, and Racing with the giveaway improved in place.
- **B — before Halloween (31 October):** Spooky, Grand Prix, Cockpit and Arcade.
- **C:** Quest, Comic, Cozy, Cosmos and Glass.
- **D — before December:** Cyber, Western, Retro OS, Graffiti, Kawaii, Steampunk and Frost.

Each release follows `docs/operations/deploy.md`: deploy while no streamer is live. An open OBS source reloads by
itself when the server's version changes.

## 9. Risks

- **OBS's browser** is an older Chromium. The looks avoid what it lacks, but 3D (`preserve-3d`), animated
  `clip-path`, `-webkit-text-stroke`, masks and conic gradients need the check in OBS (7).
- **Size:** about 650 KB of family code (around 110 KB compressed), loaded once per browser source and then
  cached.
- **Translation:** about 400 new texts in six languages, machine-translated like the rest, wanting a native
  read-through.
- **Seasonal families:** Spooky and Frost are worth shipping in season (8).
- **Long messages:** some donation looks type the message one character at a time, about 110 elements at most.
  Cozy and Grand Prix already do this.
- **The giveaway changes for everyone on release A** (decided). Its saved colours and text carry over.

## Appendix A — the 108 looks

"Grows with" names the number the picture shows. Sounds and effects are each look's defaults. Today's five keep
today's sound and, as today, no screen effect.

| Family | Key | Alert | Style id | Look | Grows with | Sound | Effect |
|---|---|---|---|---|---|---|---|
| Samurai | `samurai` | Follow | `follow-samurai` | Iaido band (today) | – | Today's sound | None, as today |
| Samurai | `samurai` | Subscriber | `subscriber-samurai` | Torii gate (today) | – | Today's sound | None, as today |
| Samurai | `samurai` | Bits | `bits-samurai` | Tally board (today) | – | Today's sound | None, as today |
| Samurai | `samurai` | Donation | `donation-samurai` | Byōbu screen (today) | – | Today's sound | None, as today |
| Samurai | `samurai` | Raid | `raid-samurai` | Banner rank (today) | – | Today's sound | None, as today |
| Samurai | `samurai` | Giveaway | `giveaway-samurai` | Omikuji | – | Temple bell | None |
| Racing | `racing` | Follow | `follow-racing` | Fly-by | – | Fly-by | None |
| Racing | `racing` | Subscriber | `subscriber-racing` | Race number | Months as the race number | Fly-by and decal slap | Chequered confetti |
| Racing | `racing` | Bits | `bits-racing` | Nitro | Grows with the amount | Nitro boost | Speed lines |
| Racing | `racing` | Donation | `donation-racing` | Sponsor decal | – | Decal slap | Confetti |
| Racing | `racing` | Raid | `raid-racing` | Headlights | Grows with the viewers | Convoy fly-by | Tyre smoke |
| Racing | `racing` | Giveaway | `giveaway-racing` | Victory lap | – | Victory lap | Chequered confetti |
| Grand Prix | `gp` | Follow | `follow-grandprix` | Lights out | – | Start lights | Speed lines |
| Grand Prix | `gp` | Subscriber | `subscriber-grandprix` | Timing tower | Months as laps | Overtake | Chequered confetti |
| Grand Prix | `gp` | Bits | `bits-grandprix` | Purple sector | Grows with the amount | Sector beeps | Titanium sparks |
| Grand Prix | `gp` | Donation | `donation-grandprix` | Team radio | – | Radio click | None |
| Grand Prix | `gp` | Raid | `raid-grandprix` | Red flag | Grows with the viewers | Race control alarm | Tyre smoke |
| Grand Prix | `gp` | Giveaway | `giveaway-grandprix` | Podium | – | Podium fanfare | Champagne |
| Cockpit | `ck` | Follow | `follow-cockpit` | Shift up | – | Upshift | Speed lines |
| Cockpit | `ck` | Subscriber | `subscriber-cockpit` | Personal best | Months as laps | Personal best chime | None |
| Cockpit | `ck` | Bits | `bits-cockpit` | Redline | Grows with the amount | Rev limiter | Titanium sparks |
| Cockpit | `ck` | Donation | `donation-cockpit` | Pit stop | Grows with the amount | Wheel guns | Tyre smoke |
| Cockpit | `ck` | Raid | `raid-cockpit` | Spotter | Grows with the viewers | Spotter beeps | None |
| Cockpit | `ck` | Giveaway | `giveaway-cockpit` | Chequered flag | – | Finish line | Chequered confetti |
| Arcade | `ar` | Follow | `follow-arcade` | Checkpoint! | – | Checkpoint jingle | Speed lines |
| Arcade | `ar` | Subscriber | `subscriber-arcade` | Stage clear | Months as stages | 1UP | None |
| Arcade | `ar` | Bits | `bits-arcade` | Bonus! | Grows with the amount | Coins | Confetti |
| Arcade | `ar` | Donation | `donation-arcade` | New record! | – | High score | Confetti |
| Arcade | `ar` | Raid | `raid-arcade` | Warning! | Grows with the viewers | Warning siren | None |
| Arcade | `ar` | Giveaway | `giveaway-arcade` | Winner! | – | Winner fanfare | Confetti |
| Quest | `qs` | Follow | `follow-quest` | Quest accepted | – | Scroll unfurl | None |
| Quest | `qs` | Subscriber | `subscriber-quest` | Level up | Months as levels | Level-up fanfare | Titanium sparks |
| Quest | `qs` | Bits | `bits-quest` | Treasure chest | Grows with the amount | Chest of gold | None |
| Quest | `qs` | Donation | `donation-quest` | Royal decree | – | Wax seal | None |
| Quest | `qs` | Raid | `raid-quest` | The horde approaches | Grows with the viewers | War drums | Tyre smoke |
| Quest | `qs` | Giveaway | `giveaway-quest` | Legendary loot | – | Legendary chime | Titanium sparks |
| Comic | `cm` | Follow | `follow-comic` | New hero | – | Pop and boing | None |
| Comic | `cm` | Subscriber | `subscriber-comic` | KAPOW! | – | Punch | Confetti |
| Comic | `cm` | Bits | `bits-comic` | BAM! | Grows with the amount | Bam and coins | None |
| Comic | `cm` | Donation | `donation-comic` | CHA-CHING! | – | Cash register | Confetti |
| Comic | `cm` | Raid | `raid-comic` | Incoming! | Grows with the viewers | Alarm and slams | None |
| Comic | `cm` | Giveaway | `giveaway-comic` | WINNER! | – | Comic fanfare | Confetti |
| Cozy | `cz` | Follow | `follow-cozy` | Sticky note | – | Paper and chime | None |
| Cozy | `cz` | Subscriber | `subscriber-cozy` | Polaroid | Months as leaves | Camera click and leaves | None |
| Cozy | `cz` | Bits | `bits-cozy` | Jar of stars | Grows with the amount | Twinkling stars | None |
| Cozy | `cz` | Donation | `donation-cozy` | Love letter | – | Envelope and bell | None |
| Cozy | `cz` | Raid | `raid-cozy` | Paper boats | Grows with the viewers | Splash and toot | None |
| Cozy | `cz` | Giveaway | `giveaway-cozy` | Gift box | – | Rustle, pop and sparkle | Confetti |
| Cosmos | `cs` | Follow | `follow-cosmos` | Liftoff | – | Countdown and liftoff | Tyre smoke |
| Cosmos | `cs` | Subscriber | `subscriber-cosmos` | New orbit | Months as orbits | Orbit chime | None |
| Cosmos | `cs` | Bits | `bits-cosmos` | Meteor shower | Grows with the amount | Meteor impacts | Titanium sparks |
| Cosmos | `cs` | Donation | `donation-cosmos` | Transmission | – | Radar pings | None |
| Cosmos | `cs` | Raid | `raid-cosmos` | Fleet arrival | Grows with the viewers | Warp jumps | Speed lines |
| Cosmos | `cs` | Giveaway | `giveaway-cosmos` | Supernova | – | Supernova | Confetti |
| Glass | `gl` | Follow | `follow-glass` | Pill | – | Soft chime | None |
| Glass | `gl` | Subscriber | `subscriber-glass` | Ring | Months as a ring | Rising chime | None |
| Glass | `gl` | Bits | `bits-glass` | Counter | Grows with the amount | Glass ticks | None |
| Glass | `gl` | Donation | `donation-glass` | Receipt | – | Bell | None |
| Glass | `gl` | Raid | `raid-glass` | Wave | Grows with the viewers | Swell | None |
| Glass | `gl` | Giveaway | `giveaway-glass` | Spotlight | – | Sparkle | Confetti |
| Spooky | `spk` | Follow | `follow-spooky` | Ghost hello | – | Ghostly whoo | None |
| Spooky | `spk` | Subscriber | `subscriber-spooky` | Cauldron | Months as the brew | Bubbling brew | None |
| Spooky | `spk` | Bits | `bits-spooky` | Treat bucket | Grows with the amount | Candy rattle | None |
| Spooky | `spk` | Donation | `donation-spooky` | Haunted tombstone | – | Stone and chisel | None |
| Spooky | `spk` | Raid | `raid-spooky` | Bat swarm | Grows with the viewers | Bat wings | None |
| Spooky | `spk` | Giveaway | `giveaway-spooky` | Pumpkin reveal | – | Pop and sparkle | Confetti |
| Cyber | `cyb` | Follow | `follow-cyber` | Access granted | – | Glitch and access chime | None |
| Cyber | `cyb` | Subscriber | `subscriber-cyber` | Upgrade | Months as the version | Install and power-up | None |
| Cyber | `cyb` | Bits | `bits-cyber` | Data stream | Grows with the amount | Data rain and locks | Titanium sparks |
| Cyber | `cyb` | Donation | `donation-cyber` | Decrypt | – | Decrypt chatter | None |
| Cyber | `cyb` | Raid | `raid-cyber` | Breach | Grows with the viewers | Breach alarm | Speed lines |
| Cyber | `cyb` | Giveaway | `giveaway-cyber` | Hologram | – | Hologram power-up | Confetti |
| Western | `wst` | Follow | `follow-western` | Wanted | – | Hammer and nails | None |
| Western | `wst` | Subscriber | `subscriber-western` | Sheriff badge | Months on the badge | Spin and clink | None |
| Western | `wst` | Bits | `bits-western` | Gold pan | Grows with the amount | Gold rattle | Titanium sparks |
| Western | `wst` | Donation | `donation-western` | Telegram | – | Telegraph and stamp | None |
| Western | `wst` | Raid | `raid-western` | Posse | Grows with the viewers | Hoofbeats | Tyre smoke |
| Western | `wst` | Giveaway | `giveaway-western` | Saloon doors | – | Saloon doors and piano | Confetti |
| Retro OS | `ros` | Follow | `follow-retro` | New window | – | Ding and click | None |
| Retro OS | `ros` | Subscriber | `subscriber-retro` | Installer | Months as the install | Disk drive and chime | None |
| Retro OS | `ros` | Bits | `bits-retro` | File copy | Grows with the amount | Disk clicks and ding | None |
| Retro OS | `ros` | Donation | `donation-retro` | New mail | – | Mail chime | None |
| Retro OS | `ros` | Raid | `raid-retro` | Error cascade | Grows with the viewers | Error beeps | None |
| Retro OS | `ros` | Giveaway | `giveaway-retro` | Card cascade | – | Card bounces and jingle | Confetti |
| Graffiti | `gfi` | Follow | `follow-graffiti` | Tag | – | Can rattle and hiss | None |
| Graffiti | `gfi` | Subscriber | `subscriber-graffiti` | Piece | Months in stencil | Spray in layers | None |
| Graffiti | `gfi` | Bits | `bits-graffiti` | Paint splat | Grows with the amount | Paint splats | None |
| Graffiti | `gfi` | Donation | `donation-graffiti` | Paste-up | – | Paste brush and marker | None |
| Graffiti | `gfi` | Raid | `raid-graffiti` | Crew | Grows with the viewers | Crew spray | None |
| Graffiti | `gfi` | Giveaway | `giveaway-graffiti` | Crown | – | Spray and sparkle | Confetti |
| Kawaii | `kwi` | Follow | `follow-kawaii` | Paw wave | – | Pop, mew and chimes | None |
| Kawaii | `kwi` | Subscriber | `subscriber-kawaii` | Boba | Months as pearls | Bubble tea pour and plops | None |
| Kawaii | `kwi` | Bits | `bits-kawaii` | Mochi | Grows with the amount | Mochi boings | None |
| Kawaii | `kwi` | Donation | `donation-kawaii` | Bunny card | – | Bunny hops and a chime | None |
| Kawaii | `kwi` | Raid | `raid-kawaii` | Friend parade | Grows with the viewers | Parade squeaks and toot | None |
| Kawaii | `kwi` | Giveaway | `giveaway-kawaii` | Gacha | – | Gacha crank and pop | Confetti |
| Steampunk | `stm` | Follow | `follow-steampunk` | Gear engage | – | Ratchet and steam | None |
| Steampunk | `stm` | Subscriber | `subscriber-steampunk` | Pressure gauge | Months on the gauge | Steam whistle | Tyre smoke |
| Steampunk | `stm` | Bits | `bits-steampunk` | Coin press | Grows with the amount | Coin press | Titanium sparks |
| Steampunk | `stm` | Donation | `donation-steampunk` | Pneumatic tube | – | Pneumatic whoosh | None |
| Steampunk | `stm` | Raid | `raid-steampunk` | Airship fleet | Grows with the viewers | Airship horns | None |
| Steampunk | `stm` | Giveaway | `giveaway-steampunk` | Clockwork box | – | Clockwork and music box | Champagne |
| Frost | `fro` | Follow | `follow-frost` | Snow globe | – | Snow globe music box | None |
| Frost | `fro` | Subscriber | `subscriber-frost` | Ornament | Months on the ornament | Glass bauble chime | None |
| Frost | `fro` | Bits | `bits-frost` | Gift stack | Grows with the amount | Gift thumps and jingle | None |
| Frost | `fro` | Donation | `donation-frost` | Hot cocoa | Grows with the amount | Cocoa pour and chime | None |
| Frost | `fro` | Raid | `raid-frost` | Sleigh parade | Grows with the viewers | Sleigh bells | None |
| Frost | `fro` | Giveaway | `giveaway-frost` | Northern lights | – | Aurora shimmer | Confetti |
