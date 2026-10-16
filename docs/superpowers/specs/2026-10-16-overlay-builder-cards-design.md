# Overlay Builder: alert cards and an edit window — design

Date: 2026-10-16. Status: draft for the owner's approval.
Prototype the owner approved: a throwaway page built on the real looks, sounds and placement code (kept outside the repository; the decisions below are what it showed).

## Why

Picking a look for each alert is hard in today's builder (`src/views/overlay-builder.ejs`, about 4,100 lines). One narrow left panel holds the alert tabs, the look gallery, the look's settings, a sound picker and the size and position controls, stacked in folding sections; the legacy card sections (Theme, Text, Side icons, Animation) are still there for the alerts that use them. The streamer cannot see at a glance what each alert looks like, and cannot see a look move before picking it.

What the owner wants instead: see every alert at once, each playing what it is set to, then open one alert and pick its animation, its sound and its place on screen in separate tabs, with every option playing so its behaviour is clear.

## Goals

- One page that shows every alert as a card, each looping its current look.
- One edit window per alert, with tabs: **Animation**, **Customize**, **Sound**, **Location**.
- Every option that moves is seen moving: the gallery tiles loop, the sounds play on ▶.
- Only what belongs to the alert being edited: its looks, its sounds.
- Feels like the Atleta site (dark cards, purple accent, Outfit + DM Sans), as the dashboard's working cards do.

## Non-goals

- No change to what is saved (`overlay_designs`, `FIELD_SPECS`, `validateOverlayDesign()`), to the save, family, reset and test routes, or to how OBS draws an alert (`overlay.js`, `objects/`, `kit.js`, `fx.js`, `placement.js`).
- No new looks, sounds or effects. No change to the overlay settings page (`/dashboard/overlay`: durations, volume, custom sound uploads).
- No change to who may use which look (`canUseStyle()`, `PRIVATE_STYLES`, `STANDALONE_STYLES`).

## Anti-goals (a failure even if it works)

- The builder preview and OBS drawing an alert differently (Overlay Consistency Rule in `CLAUDE.md`).
- A generic admin/settings-panel look (the owner rejected those on 2026-10-14).
- A page that stutters because every tile animates at once off screen.
- English typed into the view, or a text missing from any of the seven locales.

## The main page (`/dashboard/overlay-builder`)

- Header: "Overlay Builder", one line saying what it is for, the overlay URL button as today. No Save all or Discard: each alert is saved when its edit window's **Done** is pressed (the owner's choice, below).
- A grid of cards: **two per row**, one per row on a narrow window (the prototype switched at 760 px). Order: Follow, Subscription, Bits, Donation, Raid, Giveaway winner, then **Sponsor images** (the seventh card, below).
- Each card:
  - icon and alert name; under it the look's name, its theme, and "default" when it is the alert's default look
  - a preview on the faux stream background (the stream thumbnail when the route finds one, as today), shape 16:7, at least 210 px tall; the alert loops in it (entrance, hold, exit, pause) at about two thirds of the preview's width (at most 760 px), so it grows with the window
  - chips: the sound's name (or "Your uploaded sound" when the streamer uploaded one for this alert on `/dashboard/overlay`, which OBS plays first); where it sits (a tiny 3×3 dot grid and "Top centre" / "Free position")
  - **▶ Test in OBS** (today's `POST /dashboard/overlay/test/:eventType` with `chat: false`, so the saved alert plays in OBS; the card's preview replays with its sound at the same time) and **Edit alert** (opens the edit window; so does clicking the preview)
- Loops run only while the card is on screen (IntersectionObserver), and the cards stop while the edit window is open.
- `?tab=<type>` (links from the overlay settings page and the dashboard's Sponsors card, `?tab=timed`) opens that card's edit window.

## The edit window

A large pop-up over the page (full screen on a phone). Header: alert icon, "Edit the follow alert", close ✕ (Esc and a click outside also close it, as Cancel; with edits, it asks first). Tabs, each showing what is chosen next to its name ("Animation · Pill", "Sound · Soft chime", "Location · Top centre"):

### 1. Animation
- Theme chips: "All themes" and each family that has a look for this alert.
- A full-width gallery of this alert's looks only, each tile looping its look (sample data, the streamer's colour, normal speed), with its name, its theme and the alert's badge ("🏁 Follow"); the alert's default look is badged "Default".
- Order as `builderStyleData()` gives today: a look made for the streamer ("Made for you", andre_vilela_'s private VILELA C1), the alert's default look, the standalone looks (**"C1 with your name"**, `donation-c1-channel`, in every streamer's donation gallery), then the families in order. The owner confirmed: the VILELA C1 stays private to andre_vilela_, and the C1 with the streamer's own name is offered to everyone.
- Clicking a tile picks it (its settings start afresh, as `withLook` does) and plays its sound once. The picked tile loops with this alert's own settings.
- No stream preview on this tab. Tiles start their loops a little apart so the gallery never goes blank all at once; tiles off screen do not animate.

### 2. Customize
- What the picked look takes, and only that (`STYLE_CORE.controlsFor()`): colour (with "Use the look's own"), main text (40 characters), speed (0.5–2×), screen effect ("The look's own (…)", none, the effects the builder offers today), "Grows with the amount"; Racing's card, accent and name colours and name font; the C1: nothing but the sound (the tab says so).
- The picked look loops large beside the controls (no stream, so the change is easy to see), replaying when a setting changes.
- "Use <theme> for all six alerts" lives here (today's `POST /dashboard/overlay-builder/family`). It acts at once, after a confirmation naming the theme: the six alerts are saved in that look, the six cards update, and the window stays open on the new look.

### 3. Sound
- Only this alert's sounds: "This look" first (its own recording, its version 2, No sound), then each theme's two recordings for this alert, grouped by theme, with search and theme chips. Every row: ▶ to listen, the name on one line, and on one line under it the alert badge and the look it was made for ("⛽ Bits · Counter · Own sound"); text that does not fit ends in "…" with the full text on hover.
- Clicking a row picks the sound and plays it. No stream preview on this tab.
- Every look sound belongs to exactly one look (checked: 156 sounds, 156 looks, none shared), so the alert filter is exact.
- "This look" also offers **Classic engine sound** (today's synthesized alert sound, `style_sound = 'today'`), as today's list does.
- A saved sound this list does not hold (one picked from another alert's looks before this release) is shown as an extra "Current" row in "This look" and kept until the streamer picks another; nothing is reset silently.
- When the streamer uploaded a sound for this alert (`customSounds`), a notice at the top says it plays in OBS instead of the look's sound, with a link to the overlay settings page; the route passes which alerts have one.

### 4. Location
- **Fixed spot** (the nine places, as a 3×3 grid) or **Free position** (drag the alert on the preview; switching starts from where it sits now).
- Size slider (200–900 px, `ATLETA_PLACEMENT` bounds).
- The stream preview is shown here, wide (the controls take a narrow column), at the real 1920×1080 scale through `placement.js`'s `slotStyle()`, looping the alert with its effect; "↻ Replay with sound" and "Sound on every loop".

### Footer
- **Reset**, **Cancel**, **Done**.
- **Done saves** (the owner's choice): one `POST /dashboard/overlay-builder/save` for this alert, with its look, as today, so an open OBS source updates at once; the window closes on success, and on a refusal stays open with the message (the route names the field). Cancel drops the window's edits.
- **Reset** is today's reset route, after its confirmation; it acts at once and the window shows the reset design.
- Testing in OBS is on the card (it plays the saved alert); the window's own previews play the edits.

## The Sponsor images card (today's Timed tab)

- The seventh card (the owner's choice). Its preview shows the sponsor image that rotates first, in the banner, looping; chips: rotation on/off and how many images.
- Its edit window has three tabs:
  1. **Images**: today's controls moved as they are: the rotation switch, the image animation (`sponsor_animation`), the list (order, duration, enable, delete), the upload (the same `/dashboard/sponsors/*` routes and their query parameters).
  2. **Design**: the timed banner's card design, with today's legacy card controls (Theme with its advanced pop-up, Text, Side icons, Animation, Border radius) moved as they are, so `src/services/overlayDesign.test.js` keeps checking them against `FIELD_SPECS`.
  3. **Location**: as for the alerts.
- The images save as today (each action calls its route); the Design and Location tabs save on Done like an alert.

## YouTube and Kick alerts

- Hidden while their flags are off (as today, both off). The owner decides later what they become.
- So that nothing is lost, the legacy card editor stays in the page as the Sponsor images card's Design tab. While `features.youtube` is on, the three YouTube alerts get cards whose edit window has the same Design and Location tabs (no looks, no Sound tab; their sounds stay on the overlay settings page). This path is kept working by the existing tests, not polished.

## What stays as it is

- The data: `overlay_designs` rows, `style` and the look settings, the position and width fields; `EVENT_DEFAULTS`, `FIELD_SPECS`.
- The rendering helpers both pages share (`kit.lookData`, `kit.slotVars`, `kit.effectFor`, `kit.soundFor`, `ATLETA_FX.spawn`, `ATLETA_PLACEMENT`); the builder's preview pick stays `previewObjectFor()`, the same rule as `objectFor()` (`tests/overlayBuilder.test.js`).
- `public/js/builder-styles-core.js` keeps the pure rules (looks shown, what a pick resets, the sound lists); new pure helpers (the alert of a sound, the gallery order, the card's summary) go there too, dual-exported and tested.
- `features.overlays` off still redirects the page; YouTube and Kick alerts follow their flags (both off today).

## Constraints

- Plain CommonJS and EJS, no build step, no framework (`CLAUDE.md` Conventions). EJS cannot `require()`.
- Every text through `t()` in all seven locales (`tests/i18n.test.js`); the page's script gets its texts as one JSON object; JSON embedded in the view ends in `.replace(/</g, '\\u003c')` (`tests/scriptEmbeds.test.js`); `csrf.ejs` in `<head>` (the page does not include the header).
- The tests that pin today's builder must keep passing or be updated with the same meaning: `src/services/overlayDesign.test.js` (the builder's controls against `FIELD_SPECS`, slider ranges, font list, position grid, text limits), `tests/overlayBuilder.test.js`, `tests/builderStylesCore.test.js`, `src/routes/dashboard.test.js`.

## Left to the builder

- Splitting the view (partials for the cards, the window and each tab; the page script into `public/js/`), the exact loop timings (the prototype: hold 2–2.4 s after the entrance, 0.6–0.9 s pause), the preview sizes within the shapes above.

## Decisions

The owner's (2026-10-16): the card grid, two per row; the edit window with Animation, Customize, Sound, Location; no stream preview on Animation and Sound; only the edited alert's looks and sounds, each labelled with its alert; the VILELA C1 stays private and "C1 with your name" is for everyone; **Done saves the alert**; sponsor images are a **seventh card**; YouTube alerts are **decided later**.

Calls made while writing this (the owner may overrule): Test in OBS lives on the card and plays the saved alert; Reset and "Use <theme> for all six" act at once after a confirmation; an uploaded custom sound is shown on the card and in the Sound tab; "Classic engine sound" stays in the list; a saved sound from another alert is kept and shown as "Current"; `?tab=<type>` opens that card's window; YouTube alerts, while their flag is on, reuse the Sponsor images card's Design and Location tabs.
