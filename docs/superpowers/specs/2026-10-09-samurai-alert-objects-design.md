# Samurai Alert Objects — Design

**Status:** look approved, spec pending review
**Date:** 2026-10-09
**Prototype:** https://claude.ai/artifact/Mivb7w5SWitZ2PNy8bGWL4 (Version 10)

## Goal

Replace the five Twitch alert cards with five visually distinct **objects**, each with its own
silhouette, material and motion mechanism, in a samurai-derived motion language adapted from the
Ronin Sim Sport visual identity. Existing streamers must land on the new design **without taking any
action**.

## Scope

**In scope — five event types:**
`follow`, `subscription`, `bits`, `donation`, `raid`

**Explicitly out of scope — these keep the existing card unchanged:**
`yt_superchat`, `yt_member`, `yt_giftmember`, `giveaway_winner`, `timed` (sponsor rotation),
channel-point redemptions, the tip-goal progress bar.

This matters: `buildBannerContent()` (`public/overlay/overlay.js:444`) is a switch over event type.
We replace five of its nine cases. The rest fall through to today's code path untouched.

**Out of scope for this plan (follow-ups):**
- Per-user colour customisation of the new objects (phase 2 — see *Colour*)
- Porting the remaining four event types to objects
- Removing the legacy entrance/car/screen-effect animations (still used by the untouched types)

## The motion doctrine

Western stream alerts spring, overshoot and wobble to rest. These do the opposite, and that
difference is the point of the direction.

| Principle | Rule |
|---|---|
| **Strike** | One decisive stroke. Entrances run 0.20–1.26s, no slow eases. |
| **The cut** | A blade flash at 22°, matching the brand slash, *causes* the object to appear. Used by `follow` and `bits` only — a cut on every object becomes a tic. |
| **Zanshin** | Held stillness after the strike. No settle bounce, no idle drift, no breathing. |
| **Noto** | Exits sheathe back along the entry path rather than fading. |

## The five objects

| Event | Object | Mechanism | Duration |
|---|---|---|---|
| `follow` | Iaido band | Blade crosses at 22°; band revealed along the cut; scar glows then fades | 0.40s |
| `subscription` | Torii gate | Pillars plant, dust puffs, both beams slam on, the **gaku** name plaque drops on its cords, text struck onto it | 1.26s |
| `bits` | Tally board | Blade crosses and flips each lacquer tile face-up as it passes, left to right; board flashes | 0.20s + flips |
| `donation` | Byōbu screen | Six panels unfold left to right from edge-on, both frame rails snap across, amount struck at 50px | 1.12s |
| `raid` | Sashimono rank | Five banners plant outside-in, each with one cloth ripple; the standard lands last carrying the count | 0.94s |

**Deliberate decisions:**
- `follow` uses the loudest object despite being the most frequent event — explicitly requested.
  Trimmed to 0.40s and 408px wide to survive repetition.
- `donation` is the most built-up object and carries the largest figure in the set (50px). It is the
  highest-value event and should read that way.
- The `gaku` plaque exists to solve legibility: the subscription text sits on dark lacquer rather
  than directly on the streamer's gameplay.

## Architecture

### The problem

Today one card structure is rendered independently in three places:

1. `public/overlay/overlay.js` — the real OBS overlay
2. `src/views/overlay-builder.ejs` — the builder's live preview
3. `src/views/overlay-config.ejs` — the config page preview iframe

They have already drifted: `checkerScroll` animates `left` in the builder and `transform` in
`overlay.css`. With one structure that was a maintenance irritation. With five objects it becomes
fifteen places to keep in sync, which is not sustainable.

### The fix — one shared registry

A single browser-side module defines each object's markup, keyframe names and timing. All three
paths consume it.

```
public/overlay/objects/
├── index.js          # registry: { follow, subscription, bits, donation, raid }
├── follow.js         # render(data) -> HTML string, + anim/exit metadata
├── subscription.js
├── bits.js
├── donation.js
├── raid.js
└── objects.css       # all five objects' styles + keyframes
```

Each module exports a uniform shape:

```js
{
  key: 'subscription',
  render(data) { return '<div class="obj o-sub">…</div>'; },
  anim: { in: 'hold',        dur: '1.26s', ease: 'linear' },
  exit: { out: 'exGateFall', dur: '0.4s',  ease: 'cubic-bezier(.5,0,.9,.4)' },
}
```

All three consumers then call the same thing:

```js
OBJECTS[eventType].render(data)
```

### Why a browser-side module, not a Node module

`CLAUDE.md` records that **EJS templates do not have access to `require()`** — Express runs them in
a sandboxed scope, and an inline `<% require(...) %>` throws in production. So the registry cannot be
a CommonJS module the views import.

It does not need to be. All three consumers are pages rendered in a browser:

- `express.static(public)` is mounted at `src/server.js:56`, so `public/overlay/objects/index.js` is
  served at `/overlay/objects/index.js`.
- The overlay page already loads `/overlay/overlay.js` via a `<script src>` tag built in
  `src/routes/overlay.js:336`.
- `overlay-builder.ejs` and `overlay-config.ejs` currently have **no** external script tags — all
  their JS is inline — but nothing prevents adding one.

So each page gains `<script src="/overlay/objects/index.js"></script>` before its own script, and the
registry becomes a browser global. No build step, consistent with the project's no-bundler convention.

### Integration points

| File | Change |
|---|---|
| `public/overlay/overlay.js` | `buildBannerContent()` — for the five keys, delegate to `OBJECTS[type].render()`. Other four cases unchanged. |
| `public/overlay/overlay.js` | `applyCustomDesign()` — skip entirely for the five object types in phase 1 (see *Colour*). |
| `src/views/overlay-builder.ejs` | Preview calls the registry instead of its own card builder. Remove its duplicated `@keyframes`. |
| `src/views/overlay-config.ejs` | Same. |
| `src/routes/overlay.js` | Add the `<script src>` and `objects.css` link to the overlay page HTML. |

### Positioning fix

Every current entrance keyframe bakes `translateX(-50%)` into itself, so centering and motion fight
over the same `transform` property. That is why `applyCustomDesign()` strips the entrance animation
when custom positioning is used (`overlay.js:961`).

The objects move centering onto a `.alert-pos` wrapper and animate only the object's own transform.
This removes the workaround and makes overshoot available to every animation.

### Naming discipline

Object class names are prefixed (`.o-sub`, `.o-raid`) and internal parts namespaced under them.
During prototyping a generic `.rail` class on the byōbu frame collided with the host page's sticky
`.rail` control bar, whose `top: 0` pinned the bottom rail to the wrong edge. The overlay page is
small today, but the builder page is not — every object-internal class must sit under its `.o-*`
prefix.

## Migration — nobody has to do anything

### How it works today

`applyCustomDesign()` returns early at `overlay.js:922` (`if (!design) return`) when the streamer has
no row in `overlay_designs`.

- **No saved row** → renders from built-in CSS/JS. Shipping new built-ins updates them automatically,
  with no reload needed (the overlay receives config over SSE).
- **Saved row** → that row overrides colours, fonts, animations and sizes, and they would otherwise
  keep the old look.

### Measured against production (2026-10-09)

Queried read-only over `railway ssh` against `/app/data/bot.db` on the production volume
(project `atleta-notification-helper`, service `Atleta Notifications PROD`):

| Metric | Count |
|---|---|
| Streamers total | 7 |
| With Twitch linked | 2 |
| With overlay enabled | 2 |
| `overlay_designs` rows (all types) | 14 |
| Rows for the five Twitch types | 8 |
| Streamers with any saved design | 2 |

Classifying those 8 rows against the built-in `EVENT_DEFAULTS`:

| Classification | Rows |
|---|---|
| Default-valued (opened the builder, saved without changing anything) | **7** |
| Genuinely customised | **1** |

The single customised row is streamer 3's `follow` alert — `#0c7ded` / `#00b4d8` with the
`equalizer` car animation. That streamer has **no `twitch_username` linked**, so no Twitch events
currently reach their overlay. Streamer 13 (`andre_vilela_`) has five saved designs, all untouched
defaults.

**Conclusion:** migration is effectively a non-event. Nobody loses a design they deliberately made,
except one blue `follow` belonging to an account that is not receiving Twitch events. No user
announcement is warranted. The backup table stays in the plan anyway — it costs 14 rows and removes
the only irreversible risk.

### Plan

1. Add `design_version INTEGER DEFAULT 0` to `overlay_designs` (additive migration, `src/db.js`).
2. Create `overlay_designs_v0_backup` and copy every existing row into it, once.
3. For rows with `design_version = 0` and `event_type` in the five: set `design_version = 1`.
4. In phase 1 the object render ignores saved style columns entirely, so no row data is destroyed —
   the backup is belt-and-braces for phase 2 and for restoring anyone who asks.

This is additive and reversible. No existing row is deleted or overwritten.

## Colour — phase 1 fixed, phase 2 editable

**Decision: ship hardcoded scarlet now, per-user colour as a follow-up.**

Phase 1: the five objects always render in the Ronin palette. `applyCustomDesign()` is skipped for
these event types, and the builder hides colour/animation controls for them, replaced by a short note
explaining the objects are fixed for now.

Phase 2 (separate plan): wire each object's palette to CSS custom properties driven by the saved
`accent_color`, and restore the controls.

Values, sampled from `roninsportswear.com` computed styles rather than eyedropped:

| Token | Value | Source |
|---|---|---|
| `--r-red` | `#D81E26` | Instagram post graphics |
| `--r-red-deep` | `#B50000` | site `rgb(181,0,0)` |
| `--r-ink` | `#070B10` | site `rgb(7,11,16)` |

Typeface: the brand face is **The Last Shuriken**, which is not on Google Fonts. The prototype
substitutes **Oxanium** (same chamfered construction) with **Saira Condensed** for label rows. Unlike
the prototype, the real overlay serves its own assets from `public/overlay/`, so the genuine face can
be self-hosted if licensing permits — worth checking before settling on Oxanium.

**Not borrowed:** Ronin's kabuto emblem. Adapting a visual language is ordinary practice; shipping
another organisation's trademark inside Atleta is not.

## CLAUDE.md change required

The Overlay Consistency Rule currently states:

> **Card structure:** All event types must use the same HTML structure: `top-accent` + `card-body`
> (with `wrapWithSideIcons`) + `car-track`. No event-specific custom sections.

This must be rewritten. The rule existed to stop the three render paths drifting; the registry
enforces that better than a convention did. Proposed replacement:

> **Object registry:** The five Twitch event types render from `public/overlay/objects/`. Any change
> to an object's markup, keyframes or timing is made there and nowhere else — all three render paths
> consume the same module. Remaining event types still share the legacy `top-accent` + `card-body` +
> `car-track` structure.

## Testing

- **Unit (`node:test`):** registry shape — every object exports `render`, `anim`, `exit`; every
  keyframe name referenced by an object exists in `objects.css`. This catches the exact class of bug
  hit twice while prototyping: playback rules referencing keyframes deleted in a rewrite, and a class
  name colliding with the host page.
- **Migration:** `design_version` added idempotently; backup table populated; re-running startup does
  not duplicate rows.
- **E2E (Playwright):** overlay page renders each of the five without console errors; builder preview
  and overlay produce identical markup for the same event payload.
- **Manual:** OBS browser source at 1920×1080 over real gameplay.

## Risks

| Risk | Mitigation |
|---|---|
| `follow` is loud and frequent | Trimmed to 0.40s/408px. If it grates in production, a quieter variant is a CSS-only change. |
| ~~Production design-row count unknown~~ | **Resolved** — 1 genuine customisation in production. No announcement needed. |
| Builder loses controls in phase 1 | Explanatory note in the UI; phase 2 restores them. |
| Oxanium is a substitute, not the brand face | Check licensing for self-hosting the real face before committing. |

## Open questions

1. ~~Confirm the production count of `overlay_designs` rows.~~ **Answered 2026-10-09** — see
   *Measured against production*. 7 streamers, 8 relevant rows, 1 genuine customisation.
2. Self-host The Last Shuriken, or stay on Oxanium?
3. Should phase 1 keep a per-streamer "use legacy card" escape hatch? Given only one customised row
   exists, the backup table alone now looks sufficient — recommend dropping the escape hatch.
