# Vilela's C1 Donation Alert — Design

**Status:** design approved section by section in conversation (2026-10-15); spec awaiting the owner's review
**Date:** 2026-10-15
**Prototype:** https://claude.ai/artifact/KgqM4xpd2zZSnqrABc41fd (version 2; version 1 holds the three concepts)
**Prototype source (committed):** `docs/superpowers/specs/assets/2026-10-15-vilela-c1-donation-prototype.html`
**Branch:** `feat/vilela-c1-donation`, worktree `.worktrees/vilela-c1-donation`

## Goal

A one-of-a-kind donation alert for andre_vilela_ (Vilela): a racing first-generation Citroën C1 tows the
donation onto his stream on a billboard trailer. He asked for it. On his stream it replaces the folding
screen (the "Tribute" object); the folding screen stays in the code and stays every other streamer's
donation alert.

## Scope

**In scope**
- The C1 object (markup, styles, motion) in the shared object registry, `public/overlay/objects/`.
- A per-alert `style` on saved designs (`overlay_designs.style`) that picks which object an alert renders.
- The OBS overlay and the Overlay Builder preview honouring that style.
- Saving and Reset in the builder keeping a stored style.
- Switching it on for Vilela once, at the first boot of this version.

**Out of scope (follow-ups)**
- A picker for an alert's style in the builder. That is the Overlay Builder session's style system, which
  builds on this work (see *Coordination*).
- A sound made for the C1. His own uploaded donation sound plays, or today's synthesized one.
- Colour controls for the C1. It is red and fixed, like the five objects in phase 1.
- Any other alert, and any other streamer.

## What it does

### On Vilela's stream

A donation, from PayPal or StreamElements, plays the C1 billboard trailer, and so does the **Preview Alert**
test button on his overlay settings page. It shows the amount in its currency, the donor's name and their
message (two lines at most). It sits where his donation alert sits, at its saved width; it stays for his
donation duration (12 s unless he changed it); and it plays his own donation sound if he uploaded one,
otherwise today's synthesized engine sound.

| Time | Beat |
|---|---|
| 0.00 s | The C1 tows the board in from the left edge of the OBS source. The wheels spin (a blurred disc while fast) and speed lines trail the trailer. |
| 0.34 s | A backfire from the exhaust as it lifts off. |
| 0.46 s | It brakes: the nose dives, the front brake disc glows, a little tyre smoke; the board leans forward on the trailer. |
| 0.85 s | It parks; the suspension and the board settle. |
| 0.92 – 1.10 s | "Sponsor", the amount, the message and the donor's name are struck onto the board, in that order. |
| 1.3 s on | It idles (a slight engine shake) for the rest of the alert. |
| exit, 0.9 s | It squats, spins its rear wheels in a puff of smoke and tows everything off to the right. |

### Layout

The object is 150 px tall at every width. The car is 39 % of the alert's width, at most 230 px (164 px
at his default 420 px), parked at the right end; the board takes the rest of the width less a 14 px hitch,
126 px tall, on a trailer frame with two small wheels. It works from about 340 px wide up to the
builder's 900 px.

Text on the board, top to bottom:
- "Sponsor": Saira Condensed 600, 10.5 px, letter-spaced, `#FF6B6B`;
- the amount, written by the registry's `money()` ("€25.00", "€1,250.00"): Oxanium 800 at 46 px, set
  smaller when it has more than 7 characters (7 / length, never below 60 %), so that "€10,000.00" still fits
  the board of a 340 px alert;
- the message in quotes: Saira Condensed italic 12 px, at most two lines;
- the donor's name: Saira Condensed 600, 12 px, uppercase, on one line, cut with an ellipsis when it does
  not fit (a 25-character Twitch name fits at 420 px).

The board uses the folding screen's lacquer (the same dark red gradient, hex mesh and scarlet bottom
rail), so it reads with his other four alerts.

### The car

A generic first-generation C1 (2005–2014) three-door, side view, facing right. It is the car people race
in the C1 Racing Club. The owner rejected a drawing made from memory, so the outline is measured from a
real one: the silhouette was read column by column from the Wikimedia Commons drawing
`File:Citroën C1.svg` (by spadassin, **CC0**), and the three-door's windows were checked against the photo
`File:C1coté.jpg` (CC BY-SA 3.0, looked at, not traced). What makes it read as a C1:
- one long slope from the nose up the windscreen, an arched roof and a short, rounded, raked tail;
- the big teardrop headlight swept back along the wing;
- tail lights high on the rear corner, with their two round lamps;
- the three-door's long door, the black B-pillar and the big rounded rear side window.

Race kit: lowered 2 units on 15-inch five-spoke wheels, roll cage, a driver in a helmet, a white number 1
roundel on the door, VILELA on the rear side window, red tow straps, a splitter, two white stripes from the
headlight to the tail light. Red paint, matching his alerts. No Citroën badges.

The drawing is the `car()` function of the prototype (version 2): an inline SVG, `viewBox="0 0 320 140"`,
rear axle at x 57, front axle at x 249, ground at y 132, with the paint, stripe, rim and caliper colours
read from CSS custom properties. It moves into the registry as it is, with its classes renamed under
`o-c1-` (see *The registry*).

### Switching it on, and off

It is switched on once, automatically, the first time this version boots: a one-time data change sets the
style of Vilela's saved donation design to `donation-c1`. It finds him by his Twitch user id (andre_vilela_,
`632557806`), never by a row number. To switch back to the folding screen, his donation design's style is
set back to empty: a single database change, on request, until the style picker exists.

### In his Overlay Builder

The donation tab previews the C1. He can still move it and change its width like his other alerts. Saving,
moving and **Reset** all keep the C1.

### For everyone else

Nothing changes: every other alert, and every other streamer's donation alert, renders as today. Nobody can
choose the C1 from the dashboard.

## Architecture

### Data: `overlay_designs.style`

**Column.** `style TEXT`, added by an idempotent migration next to the `design_version` one in `src/db.js`.
`NULL` (empty) means the alert's own look.

**Saving keeps it.** Today `saveOverlayDesign()` writes with `INSERT OR REPLACE`. On the
`UNIQUE(streamer_id, event_type)` conflict SQLite deletes the old row and inserts a new one, so every column
missing from the statement's list returns to its default: a `style` column would reset to `NULL` the next
time anyone saved the alert, even only to move it. (`design_version` is reset to 0 by every save today for
the same reason.) The statement becomes an upsert,

```sql
INSERT INTO overlay_designs (streamer_id, event_type, <the same columns as today>)
VALUES (...)
ON CONFLICT(streamer_id, event_type) DO UPDATE SET <each of those columns> = excluded.<column>
```

so the columns it does not list (`style`, `design_version`, `id`, `created_at`) keep their stored values.
The values written, and their defaults, are exactly today's.

**Reset keeps it.** A new `resetOverlayDesign(streamerId, eventType)` replaces the reset route's
`deleteOverlayDesign()`: when the row carries a style it is upserted back to the defaults
(`saveOverlayDesign(streamerId, eventType, {})`, which keeps `style`); when it carries none it is deleted, as
today. `deleteOverlayDesign()` stays exported but has no caller left.

**Setting it.** `setOverlayDesignStyle(streamerId, eventType, style)` writes the default row when there is
none, then `UPDATE ... SET style = ?`. The one-time switch-on uses it; so would switching it off (`null`).

**The builder cannot set it.** `validateOverlayDesign()` keeps only the fields in `FIELD_SPECS`, and `style`
is deliberately not one of them, so a `style` in a save's payload is dropped and the stored one is kept.
`FIELD_SPECS` gains `style` only with the style picker, together with the server-side rule that an id must
belong to the alert's event type and that `donation-c1` is offered to Vilela alone.

**The one-time switch-on.**

```js
_runOnce('c1_donation_for_andre_vilela', () => {
  const vilela = db.prepare('SELECT id FROM streamers WHERE twitch_user_id = ?').get('632557806');
  if (!vilela) return;
  setOverlayDesignStyle(vilela.id, 'donation', 'donation-c1');
  console.log('[DB] The C1 donation alert is on for andre_vilela_');
});
```

It runs after the `style` column exists. On a database without him (CI, a fresh development copy) it does
nothing and is recorded as done. The id is confirmed against production, read only, before the release
(see *Rollout*).

### The registry: a style map next to the five objects

`public/overlay/objects/index.js` keeps `OBJECTS` (the five Twitch event types) exactly as it is and adds
`STYLES`, objects keyed by style id, in the same shape plus the event type they draw:

```js
var STYLES = {
  'donation-c1': {
    key: 'donation-c1',
    eventType: 'donation',
    anim: { in: 'hold', dur: '1.25s', ease: 'linear' },
    exit: { out: 'hold', dur: '0.90s', ease: 'linear' },
    render: function (d) { /* the rig, the trailer, the board, the car */ },
  },
};
```

- `render(d)` takes the donation's data (`username`, `amount`, `currency`, `message`) like the folding
  screen. It escapes the name and the message with `esc()`, writes the amount with `money()`, and gives
  every SVG id a per-render suffix, so two alerts on one page cannot share a gradient or a clip path.
- Exports: the browser gets `window.ATLETA_OBJECT_STYLES = STYLES` next to `window.ATLETA_OBJECTS`;
  CommonJS gets `STYLES` as a **non-enumerable** property of the exported `OBJECTS`, so
  `Object.keys(OBJECTS)` is still the five event types and every existing consumer and test is untouched.
- This is the shape agreed with the Overlay Builder session: its style system turns the five objects into
  style-keyed presets later and absorbs this map.

`public/overlay/objects/objects.css` gets the C1's styles and keyframes from the prototype:
- every class is under the `o-c1` prefix: the rig, trailer, board, car and smoke, and the SVG's own parts
  (`o-c1-pitch`, `o-c1-spin`, `o-c1-blur`, `o-c1-glow`, `o-c1-shake`, ...), per the namespacing rule;
- every keyframe name starts with `c1`;
- the drive-in and drive-out distance is `--fw`, which defaults to `100vw` on `.o-c1`: the width of the OBS
  source, whatever its size, so the car always starts and ends off screen;
- the exit animations are written as `.exiting .o-c1 ...`, which outranks the shared `.exiting .obj *`;
- the car's width is `min(39%, 230px)` of the alert, its height comes from `aspect-ratio: 320 / 140`, and
  it is anchored to the bottom right with `translateY(5.714%)`, so its tyres touch the bottom of the alert.

### The OBS overlay (`public/overlay/overlay.js`)

- **Which object.** One function picks it, used by `showNotification()` and `buildBannerContent()`:

  ```js
  function objectFor(type) {
    const design = overlayDesigns[type];
    const styles = window.ATLETA_OBJECT_STYLES || {};
    const id = design && design.style;
    if (id && Object.prototype.hasOwnProperty.call(styles, id) && styles[id].eventType === type) return styles[id];
    return (window.ATLETA_OBJECTS && window.ATLETA_OBJECTS[type]) || null;
  }
  ```

  A style the page does not know, or one meant for another event type, falls back to the alert's own object.
- **When it is removed.** After `.exiting` is set, the slot is removed once the object's own exit has run,
  `max(400 ms, exit.dur)`, instead of a fixed 400 ms: 900 ms for the C1, unchanged (400 ms) for the five
  objects and for the legacy cards. The next alert still follows 500 ms after the removal.
- The designs, `style` included, already reach the overlay in the SSE `config` and in the `config-update`
  pushed after a builder save or reset, since both send whole `overlay_designs` rows; nothing changes there.

### The Overlay Builder (`src/views/overlay-builder.ejs`)

- At load the page reads each alert's stored style from the server's designs into its own `ALERT_STYLES`
  map, apart from `workingDesigns`, so Reset and Discard (which rebuild the working copy from the defaults)
  cannot drop it.
- The preview picks its object with the same rule as the overlay, reading `ALERT_STYLES`; `updatePreview()`
  and `syncPhase1Controls()` use that pick instead of `ATLETA_OBJECTS[currentType]`. The C1 is an object, so
  it gets the same controls as the others (Size & Position only).
- `#preview-object-host` sets `--fw: 1920px`: the preview is the 1920 px canvas scaled down, so the car
  drives in from the preview screen's edge.
- The page sends no `style` in its saves.

### Coordination with the Overlay Builder session

Session `vilela-notifications-59` is designing a style system for the builder: presets keyed by style id
(today's five objects become `*-samurai` presets), a `style` per alert on `overlay_designs`, each object's
own exit time, and a Style section in the builder. Agreed on 2026-10-15:
- this branch goes first; that session starts from `main` after this merges and rebases onto it;
- this branch adds the `style` column, the `STYLES` map (`donation-c1`), the selection rule and the exit
  timing, in the shapes above; that session grows them into its system and adds `style` to `FIELD_SPECS`
  with the per-streamer rule;
- this branch messages that session when it merges, and before any change to the registry's shape.

Session `vilela-notifications-81` (polls and shoutouts, `.worktrees/polls-shoutouts`) overlaps only in
`src/db.js` (the migration list and the exports); whoever merges second rebases.

## Files

| File | Change |
|---|---|
| `public/overlay/objects/index.js` | `STYLES` with `donation-c1`; the browser and CommonJS exports |
| `public/overlay/objects/objects.css` | the C1's styles and keyframes, under `.o-c1` |
| `public/overlay/overlay.js` | `objectFor()`; removal after the object's own exit |
| `src/views/overlay-builder.ejs` | `ALERT_STYLES`, the style-aware preview pick, `--fw` on the preview host |
| `src/db.js` | the `style` column, the upsert save, `resetOverlayDesign()`, `setOverlayDesignStyle()`, the one-time switch-on, the exports |
| `src/routes/dashboard.js` | the reset route calls `resetOverlayDesign()` |
| tests (below) | new and extended suites |
| `CLAUDE.md` | the objects line in Project Structure, the OBS Overlay and Overlay Builder bullets, the Overlay Consistency Rule, a Team Activity Log entry |
| `docs/operations/deploy.md` | a short release note: the boot line, the check, how to switch it off |

## Testing

Unit suites (`node --test`): no network, no production data, in-memory SQLite.

- **Registry** (`tests/overlayObjects.test.js`): `STYLES['donation-c1']` has `key`, `eventType: 'donation'`,
  `render`, `anim` and `exit` in the registry's shape; every keyframe it names, and every `c1*` keyframe the
  C1's rules use, exists in `objects.css`; no class of the C1 escapes the `o-c1` prefix; the name and the
  message are escaped; the amount is "€25.00" at full size, and "€1,250.00" is set smaller; no message, no
  message line;
  `Object.keys(OBJECTS)` is still the five, and the five are unchanged.
- **The overlay** (`tests/overlayClient.test.js`, the existing vm harness): a donation whose design carries
  `style: 'donation-c1'` renders the C1; without a style, the folding screen; a style for another event type,
  or an unknown style, falls back; the C1's slot stays until its 0.9 s exit has run, and the next alert waits
  for it; the five objects and the legacy cards keep their pace.
- **The database** (a new `src/db.overlayDesigns.test.js`, with the `Module._load` stubs of
  `src/db.accounts.test.js`): a fresh database has the
  `style` column; `saveOverlayDesign()` keeps a stored style and `design_version`; `resetOverlayDesign()` keeps
  a style (defaults otherwise) and deletes a row without one; the one-time switch-on sets the donation style
  for Twitch user id `632557806` only, writes the row when he has none, does nothing without him, and runs once.
- **Save checks** (`src/services/overlayDesign.test.js`): a `style` in a payload is not in the checked design.
- **The builder** (`tests/overlayBuilder.test.js`): the preview reads `ALERT_STYLES` with the overlay's rule;
  Reset and Discard leave `ALERT_STYLES` alone; no save sends a `style`.
- The full suite, and CI's two boots on a fresh database with no `[DB migration]` line.

Checked by eye before release: the site run locally (`DISCORD_DISABLED=1`) on a test database seeded with a
streamer carrying his Twitch user id; his overlay opened at 1920×1080 in a browser; test donations (short,
long, a big amount, no message) over dark and light backgrounds; his builder's donation tab (preview, move,
save, reset). Screenshots or a short recording go to the owner.

## Rollout

1. Before the merge, read only: confirm in production that andre_vilela_'s `twitch_user_id` is `632557806`,
   and note his donation design's width and position.
2. Merge `feat/vilela-c1-donation` into `main` when the suite and CI are green. A push to `main` deploys, so
   it ships when Vilela is not live (the rule in `docs/operations/deploy.md`).
3. After the deploy: the boot log shows `[DB] The C1 donation alert is on for andre_vilela_` once; a read-only
   check shows his donation design with `style = 'donation-c1'`; the owner, or Vilela, presses
   **Preview Alert → Donation** to see it in OBS.
4. Message the Overlay Builder session and the polls session that it has merged.

**Rolling back.** A plain revert is safe: older code never reads `style`. But older code's save would wipe
the style again, and the one-time switch-on has already been recorded, so coming back after a revert
means setting his style again (`setOverlayDesignStyle`, or the same `UPDATE`) in the same step.

## Risks

| Risk | Mitigation |
|---|---|
| A builder save or Reset silently turns the C1 back into the folding screen | The upsert save and `resetOverlayDesign()`, both pinned by tests |
| The switch-on lands on the wrong streamer, or never runs | It looks him up by Twitch user id, confirmed in production before the merge; the boot line and the read-only check after the deploy |
| A very narrow alert (below ~340 px) squeezes the board | His default is 420 px; the car is capped at 39 % and the amount is set smaller; his saved width is checked before the release |
| An old OBS browser source lacks a CSS feature the C1 uses (`aspect-ratio`, `min()`, CSS transforms on SVG parts) | All are supported by OBS 27.2 and later (Chromium 95 and up); checked in the local run |
| The Overlay Builder session's style system diverges from this shape | The shape is agreed in writing (*Coordination*); that session rebases onto this merge |

## Decisions (2026-10-15)

- Concept: B, the billboard trailer, over A (pit stop) and C (lights out).
- The car: a generic first-generation C1, not his real car's livery; traced from a real C1 after the drawing
  made from memory was rejected.
- Storage: a per-alert `style` on `overlay_designs` (option A), over a one-off column on `streamers` with an
  admin switch (B) and hard-coding his account (C), so there is one way of choosing an alert's look.
- Reset keeps the C1.
- Defaults confirmed with the design: the word "Sponsor" on the board, red paint, VILELA on the rear window,
  the number 1, the idle while it holds, and his current donation sound.
