# Alert styles, release B: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Overlay Builder's gallery gets every remaining family of the alert styles at once: 24 families, 144
looks, each in the streamer's colour, each with its sounds, its screen effect and its texts in seven languages. The
gallery then has the 26 families of Appendix A.

**Architecture:**

- **Release A built the system;** release B only adds families. Each family is the pair
  `public/overlay/objects/styles/<key>.js` + `.css`, registered with the kit (`K.registerFamily`, `K.register`,
  `K.registerSound`) exactly as Samurai and Racing are. The server joins every file of that folder for the pages
  (`alertStyleBundle.js`) and reads the same registry as its catalogue (`alertStyles.js`), so nothing else changes:
  no column, no route, no view.
- **A converter does the mechanical part.** The proposal's code for a family (the spec's reference assets) becomes
  the family's files: the kit's wrapper, the registry's look headers instead of the proposal's, durations written
  `0.36s`, and the names and descriptions moved to the locale files. The look code itself is the proposal's,
  unchanged.
- **A patch per family does the rest,** worked out and checked by hand in the rehearsal: the overlay's stylesheet
  rules (no selector reaching into bare elements, a family class in every compound, every time divided by `--spd`,
  a rolling number's glow as a drop-shadow), and "grows with the amount": a picture that grows with the number is
  sized through `K.sizeOf()`, so the builder's switch gives the middle picture while the text keeps the real number.

**Tech Stack:** Node.js 24, Express 5, plain browser JavaScript and CSS (OBS's Chromium), Web Audio, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-15-alert-styles-design.md` (section 8: release B ships every remaining
family at once; Appendix A: the 156 looks), and its reference assets
`docs/superpowers/specs/assets/2026-10-15-alert-styles/` (proposal 7). Release A's plan,
`docs/superpowers/plans/2026-10-15-alert-styles-release-a.md`, built what this plan uses.

## Global Constraints

- **Code style.** Plain CommonJS with no build step (the project's CLAUDE.md). A family file is a plain script that
  also runs in Node (`require('../kit.js')` when there is no `window.ATLETA_KIT`).
- **OBS's Chromium.** No `:has()`, `color-mix()`, container queries, `@property` or `backdrop-filter` (spec 9).
- **Overlay Consistency Rule.** The OBS overlay and the builder draw every look from the same family files (they are
  in the joined `styles.js`/`styles.css` both pages load). Nothing in this release draws a look any other way.
- **Inside a family's files** (`tests/alertLooks.test.js`):
  - every class starts with `.o-<prefix>` and every keyframe with `<prefix>`, and every compound selector carries a
    class of the family;
  - animations run only under `.playing` or `.exiting`, and every animation time is divided by `var(--spd)`;
  - no selector reaches into another part (`.x i`, `.x span`, `.x div`);
  - a rolling number's glow is a `filter: drop-shadow` on its `.o-odo`, never a text-shadow its clipped digits inherit;
  - every look takes the streamer's colour on its own parts.
- **Every look:** six per family, one for each alert; a screen effect the overlay plays (`FIELD_SPECS.screen_effect`);
  `grows: true` exactly when its picture is sized through `K.sizeOf()`; durations written like `0.36s`.
- **An alert nobody restyled stays exactly as it is.** This release adds looks to pick; it changes no stored look,
  no default look and no look of Samurai or Racing.
- **Translations.** Every new text goes through the locale files in all seven languages (`tests/i18n.test.js`). The
  words a look draws on screen (CHECKPOINT!, "boo!") are part of its picture and stay as the proposal draws them.
- **Tests** run with `node --test "src/**/*.test.js" "tests/**/*.test.js"`. They never touch the network, production
  or `data/`.
- **Git.** Work on `feat/alert-styles-b` (worktree `.worktrees/alert-styles`). Never push `main`: a push to `main`
  deploys. Never force-push. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

The five inputs most likely to hurt a streamer that the tests do not pin directly:

1. **A family file that throws while it loads** (a typo, a helper the kit does not share). The joined file runs each
   family in its own `try`, so the other families still register; in Node the catalogue would not load. Task 1's
   `isWide` export is the one helper a family needed that the kit kept private.
2. **"Grows with the amount" switched off on a growing look.** The picture is the middle one for any number, and
   the text still shows the real number (a 10,000-bit cheer still says 10,000). The rehearsal checked every growing
   look at 50 and 10,000 with the switch off; the tests check that the switch is offered exactly where `sizeOf()`
   sizes the picture.
3. **A long or hostile name or message** in every new look: escaped and fitted, as release A's looks
   (`tests/alertLooks.test.js` renders each look with a 25-character name and with markup).
4. **Picking a new look's colour** far from its own (white, black, pale yellow): the family's main parts follow it, and
   text drawn on it uses `--a-on`.
5. **The builder's first load** with 26 families: one Google Fonts request with every family's fonts (44 fonts,
   accepted by Google), and every family's tiles in the gallery.

## File structure

**New files:**

| File | Responsibility |
|---|---|
| `public/overlay/objects/styles/<key>.js` + `.css`, for the 24 keys below | One family: its six looks, its sounds, its stylesheet |
| `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools/` | The converter (`port-family.js`, `load-proposal.js`), the texts and tests helpers (`family-texts.js`, `family-tests.js`), and the headless check (`obs-like-check.js`) |
| `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/<key>.patch` | Each family's hand work after the converter (stylesheet rules, growing pictures) |
| `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/<lang>.json` | The 480 new texts in pt, es, fr, de, zh and ja (English comes from the converter) |

**Changed files:**

| File | What changes |
|---|---|
| `public/overlay/objects/kit.js` | Shares `isWide` (Cyber and UFO fit names by width) |
| `src/locales/*.json` | Each family's name, looks and sounds, after Racing's, in gallery order |
| `tests/alertStyles.test.js` | The gallery's families, in order (one more per task) |
| `tests/alertLooks.test.js` | Three checks every family must pass; each family's prefixes |
| `tests/objectKit.test.js` | `isWide` is shared |
| `src/routes/dashboard.test.js` | The builder's one font stylesheet holds every family's fonts |
| `CLAUDE.md`, `docs/operations/deploy.md` | The 26 families; the release notes |

The 24 families, in gallery order (the spec's Appendix A gives every look):

| Task | Key | Prefix | Family |
|---|---|---|---|
| 2 | `grandprix` | `o-gp` | Grand Prix |
| 3 | `cockpit` | `o-ck` | Cockpit |
| 4 | `arcade` | `o-ar` | Arcade |
| 5 | `quest` | `o-qs` | Quest |
| 6 | `comic` | `o-cm` | Comic |
| 7 | `cozy` | `o-cz` | Cozy |
| 8 | `cosmos` | `o-cs` | Cosmos |
| 9 | `glass` | `o-gl` | Glass |
| 10 | `spooky` | `o-spk` | Spooky |
| 11 | `cyber` | `o-cyb` | Cyber |
| 12 | `western` | `o-wst` | Western |
| 13 | `retro` | `o-ros` | Retro OS |
| 14 | `graffiti` | `o-gfi` | Graffiti |
| 15 | `kawaii` | `o-kwi` | Kawaii |
| 16 | `steampunk` | `o-stm` | Steampunk |
| 17 | `frost` | `o-fro` | Frost |
| 18 | `neon` | `o-neo` | Neon Sign |
| 19 | `deepsea` | `o-sea` | Deep Sea |
| 20 | `music` | `o-mus` | Music |
| 21 | `stadium` | `o-std` | Stadium |
| 22 | `fireworks` | `o-fwk` | Fireworks |
| 23 | `dino` | `o-dno` | Dino |
| 24 | `ufo` | `o-ufo` | UFO |
| 25 | `news` | `o-nws` | Breaking News |

## How the steps are written

- **This plan was run before it was written.** The 24 families were ported in a scratch copy of `main` (`4c2bcb1`):
  the converter's output was committed as a baseline, then each family's stylesheet rules and growing pictures were
  fixed by hand and checked with byte-identical screenshots (nothing visible changed with "grows with the amount"
  on), and the texts were translated.
- **Its commands were then run again,** start to finish, on a fresh copy of this branch: each task's new test failed
  before its family and passed after, the whole suite passed after every task, and the result matched the scratch
  copy file for file.
- **The converter is deterministic:** run on the spec's reference assets it gives the baseline byte for byte. Each
  family's hand work is a patch in `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/`; the translations are in `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- **Run every command from the root of the worktree.** `T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools` is used below.

### Task 0: Start from the release B branch

- [ ] **Step 1: Check the starting point**

````bash
git log --oneline -1
node --test "src/**/*.test.js" "tests/**/*.test.js"
ls docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches | head -40
````

Expected:

- The branch is `feat/alert-styles-b`, at the commit that adds this plan (after `d5ed488`, the spec's release B).
- The suite passes: 2780 tests.
- The tools and the 24 patches are there.

### Task 1: The checks every family must pass, and the one helper the kit kept to itself

Before any family comes in, the tests say what a family must be: one look for each of the six alerts, a screen effect
the overlay plays, and the "grows with the amount" switch exactly where the picture is sized through `K.sizeOf()`.
They pass for Samurai and Racing, and will check each family that follows. A new test lists the gallery's families
in order, so each family task starts by naming its family there (and failing). The builder's font test stops pinning
the two families' fonts and checks that every family's fonts are in the one stylesheet. Cyber and UFO fit names
with the kit's `isWide()`, which the kit now shares.

**Files:**
- Modify: `public/overlay/objects/kit.js`
- Modify: `tests/objectKit.test.js`, `tests/alertStyles.test.js`, `tests/alertLooks.test.js`, `src/routes/dashboard.test.js` (tests)

**Interfaces:**
- Consumes: release A's kit and catalogue.
- Produces: `K.isWide(codePoint)`; `FAMILIES` in `tests/alertStyles.test.js` (the gallery's families, in order); the three family checks.

- [ ] **Step 1: Write the tests**

````bash
git apply <<'ATLETA_PATCH'
diff --git a/tests/objectKit.test.js b/tests/objectKit.test.js
index 5ceaac8..1bdac68 100644
--- a/tests/objectKit.test.js
+++ b/tests/objectKit.test.js
@@ -46,6 +46,14 @@ describe('helpers', () => {
   });
 });
 
+describe('wide characters', () => {
+  test('isWide() is shared: the families that fit names by width (Cyber, UFO) measure with it', () => {
+    assert.equal(K.isWide('中'.codePointAt(0)), true);
+    assert.equal(K.isWide('😀'.codePointAt(0)), true);
+    assert.equal(K.isWide('A'.codePointAt(0)), false);
+  });
+});
+
 describe('the streamer\'s colour', () => {
   test('gives the colour, its numbers, the text colour on it and its shades', () => {
     assert.equal(K.accentVars('#d81e26'),
diff --git a/tests/alertStyles.test.js b/tests/alertStyles.test.js
index f44c1c6..31c4dfc 100644
--- a/tests/alertStyles.test.js
+++ b/tests/alertStyles.test.js
@@ -101,3 +101,13 @@ describe('the gallery', () => {
     assert.equal(styles.familyStyles('__proto__'), null);
   });
 });
+
+describe('the families of Appendix A', () => {
+  // In the gallery's order. Release B adds them one task at a time
+  // (docs/superpowers/plans/2026-10-15-alert-styles-release-b.md).
+  const FAMILIES = ['samurai', 'racing'];
+  test('are the gallery\'s families, in its order, each drawing all six alerts', () => {
+    assert.deepEqual(styles.familyKeys(), FAMILIES);
+    for (const family of FAMILIES) assert.ok(styles.familyStyles(family), `${family} draws all six alerts`);
+  });
+});
diff --git a/tests/alertLooks.test.js b/tests/alertLooks.test.js
index 57f77c4..5940dc0 100644
--- a/tests/alertLooks.test.js
+++ b/tests/alertLooks.test.js
@@ -89,6 +89,26 @@ describe('every look', () => {
     }
   });
 
+  test('every family has six looks, one for each alert', () => {
+    for (const family of [...new Set(looks.map((look) => look.family))]) {
+      assert.deepEqual(looks.filter((look) => look.family === family).map((look) => look.eventType).sort(), [...K.ALERTS].sort(), family);
+    }
+  });
+
+  test('a look\'s own screen effect is one the overlay plays', () => {
+    const { FIELD_SPECS } = require('../src/services/overlayDesign.js');
+    const playable = FIELD_SPECS.screen_effect.values.filter((value) => value !== 'default');
+    for (const look of looks) assert.ok(playable.includes(look.fx), `${look.key}: ${look.fx}`);
+  });
+
+  test('a look offers "grows with the amount" exactly when its picture is sized through K.sizeOf()', () => {
+    // sizeOf() gives the middle picture while the switch is off; the text keeps the real number.
+    for (const look of looks.filter((l) => !l.preset)) {
+      const sized = /\bsizeOf\(/.test(String(look.render) + String(look.len));
+      assert.equal(!!look.grows, sized, `${look.key}: grows is ${!!look.grows} but its picture ${sized ? 'is' : 'is not'} sized through sizeOf()`);
+    }
+  });
+
   for (const look of looks) {
     test(`${look.key} renders every sample, and escapes what was typed`, () => {
       for (const sample of SAMPLES[look.eventType]) {
diff --git a/src/routes/dashboard.test.js b/src/routes/dashboard.test.js
index 35cbd66..d5e13f4 100644
--- a/src/routes/dashboard.test.js
+++ b/src/routes/dashboard.test.js
@@ -2867,7 +2867,13 @@ describe('the overlay builder page and a slow Twitch', () => {
     assert.deepEqual(data.families.slice(0, 2).map((f) => [f.key, f.name]), [['samurai', t('en', 'overlayBuilder.families.samurai.name')], ['racing', t('en', 'overlayBuilder.families.racing.name')]]);
     assert.ok(data.sounds[0].sounds.some((s) => s.key === 'samuraiBell' && s.name === t('en', 'overlayBuilder.sounds.samuraiBell')));
     assert.equal(data.fonts[0], 'System Default');
-    assert.match(locals.styleFontsHref, /^https:\/\/fonts\.googleapis\.com\/css2\?family=Noto\+Serif\+JP:wght@700&family=Kanit:[^&]+&family=Barlow\+Condensed:[^&]+&display=swap$/);
+    // One stylesheet with every family's fonts, each font once, today's first: the gallery draws every family.
+    const { familyKeys, fontsOf } = require('../services/alertStyles');
+    assert.match(locals.styleFontsHref, /^https:\/\/fonts\.googleapis\.com\/css2\?family=.+&display=swap$/);
+    const specs = locals.styleFontsHref.replace(/^[^?]+\?/, '').replace(/&display=swap$/, '').split('&').map((part) => part.replace(/^family=/, ''));
+    assert.deepEqual(specs.slice(0, 3).map((spec) => spec.split(':')[0]), ['Noto+Serif+JP', 'Kanit', 'Barlow+Condensed']);
+    assert.equal(new Set(specs.map((spec) => spec.split(':')[0])).size, specs.length, 'each font once');
+    for (const key of familyKeys()) for (const font of fontsOf([key])) assert.ok(specs.includes(font), `${key}: ${font}`);
   });
 
   test('the C1\'s owner finds it first in the donation gallery', async () => {
ATLETA_PATCH
````

- [ ] **Step 2: Run them and see the new kit test fail**

````bash
node --test tests/objectKit.test.js tests/alertStyles.test.js tests/alertLooks.test.js src/routes/dashboard.test.js
````

Expected: FAIL only in "isWide() is shared" (`K.isWide is not a function`). The family checks, the families test and
the font test pass: Samurai and Racing already meet them.

- [ ] **Step 3: Share isWide**

````bash
git apply <<'ATLETA_PATCH'
diff --git a/public/overlay/objects/kit.js b/public/overlay/objects/kit.js
index aa568f5..6b56f29 100644
--- a/public/overlay/objects/kit.js
+++ b/public/overlay/objects/kit.js
@@ -300,7 +300,7 @@
   var KIT = {
     ALERTS: ALERTS, MIDDLE: MIDDLE, styles: STYLES, families: FAMILIES, sounds: SOUNDS, soundFamilies: SOUND_FAMILIES,
     esc: esc, money: money, fitStyle: fitStyle, nm: nm, samName: samName, fmt: fmt, label: label, odo: odo, typed: typed,
-    hash: hash, rng: rng, code3: code3, intOf: intOf, rgbOf: rgbOf, onColour: onColour, accentVars: accentVars,
+    hash: hash, rng: rng, code3: code3, intOf: intOf, isWide: isWide, rgbOf: rgbOf, onColour: onColour, accentVars: accentVars,
     sizeOf: sizeOf, lookData: lookData, slotVars: slotVars, DEFAULT_LOOKS: DEFAULT_LOOKS, effectFor: effectFor, soundFor: soundFor,
     registerFamily: registerFamily, fontNames: fontNames, register: register, looksOf: looksOf,
     setAudio: setAudio, registerSound: registerSound, playSound: playSound, tone: tone, noise: noise, engine: engine,
ATLETA_PATCH
````

- [ ] **Step 4: Run the tests, then the whole suite**

````bash
node --test tests/objectKit.test.js tests/alertStyles.test.js tests/alertLooks.test.js src/routes/dashboard.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2785 tests).

- [ ] **Step 5: Commit**

````bash
git add public/overlay/objects/kit.js tests/objectKit.test.js tests/alertStyles.test.js tests/alertLooks.test.js src/routes/dashboard.test.js
git commit -m "test(alert-styles): what every family must be; the kit shares isWide" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 2: Grand Prix

TV broadcast graphics: start lights, the timing tower, sector colours, team radio, race control and the podium.

Its six looks: Lights out, Timing tower, Purple sector, Team radio, Red flag, Podium. **Its patch:** Classes for the parts its rules reached as bare `<i>` (`o-gpf-lamp`, `o-gpf-streak`, `o-gpb-bar`, `o-gpd-bar`, `o-gpr-strip`). Grows: bits (the sector level), raid (the cars and `len`).

**Files:**
- Create: `public/overlay/objects/styles/grandprix.js`, `public/overlay/objects/styles/grandprix.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/grandprix.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `grandprix` (prefix `o-gp`): looks `follow-grandprix`, `subscriber-grandprix`, `bits-grandprix`, `donation-grandprix`, `raid-grandprix`, `giveaway-grandprix`; sounds `lights`, `overtake`, `sectors`, `radio`, `raceControl`, `podium`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . grandprix gp
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `grandprix`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts gp grandprix . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/grandprix.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . grandprix .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2796 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/grandprix.js public/overlay/objects/styles/grandprix.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Grand Prix, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 3: Cockpit

The display on your wheel: shift lights, gear, delta, the rev counter, the pit stop and the spotter.

Its six looks: Shift up, Personal best, Redline, Pit stop, Spotter, Chequered flag. **Its patch:** Classes for the parts reached as bare elements (`o-ckf-gv`, `o-cks-tv`, `o-ckd-cell`, `o-ckg-ft`); `n`, `g`, `pos`, `neg`, `mj`, `mn`, the fuel cells' `lit`, `last` and `fin` renamed with the family's prefix; three `.01s` times divided by `--spd`. Grows: bits (needle, arc, limiter, rpm reading), donation (fuel cells, stop time), raid (blips).

**Files:**
- Create: `public/overlay/objects/styles/cockpit.js`, `public/overlay/objects/styles/cockpit.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/cockpit.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `cockpit` (prefix `o-ck`): looks `follow-cockpit`, `subscriber-cockpit`, `bits-cockpit`, `donation-cockpit`, `raid-cockpit`, `giveaway-cockpit`; sounds `upshift`, `pb`, `limiter`, `wheelgun`, `spotter`, `finish`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . cockpit ck
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `cockpit`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts ck cockpit . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/cockpit.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . cockpit .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2807 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/cockpit.js public/overlay/objects/styles/cockpit.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Cockpit, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 4: Arcade

A 90s arcade racer: chrome letters, CHECKPOINT!, NEW RECORD!, coins and a sunset road.

Its six looks: Checkpoint!, Stage clear, Bonus!, New record!, Warning!, Winner!. **Its patch:** Classes for the parts reached as bare elements (`o-arf-line`, `o-ard-col`, `o-arg-piece`); eleven `.01s` times divided by `--spd`. Grows: bits (coins, level), raid (cars, `len`).

**Files:**
- Create: `public/overlay/objects/styles/arcade.js`, `public/overlay/objects/styles/arcade.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/arcade.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `arcade` (prefix `o-ar`): looks `follow-arcade`, `subscriber-arcade`, `bits-arcade`, `donation-arcade`, `raid-arcade`, `giveaway-arcade`; sounds `checkpoint`, `oneup`, `coins`, `record`, `siren`, `winner`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . arcade ar
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `arcade`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts ar arcade . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/arcade.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . arcade .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2818 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/arcade.js public/overlay/objects/styles/arcade.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Arcade, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 5: Quest

Fantasy RPG: a scroll for follows, LEVEL UP! for subs, a treasure chest for bits, a royal decree for donations, a shield wall for raids and legendary loot for giveaways.

Its six looks: Quest accepted, Level up, Treasure chest, Royal decree, The horde approaches, Legendary loot. **Its patch:** Classes for the parts reached as bare elements (`o-qss-fill`, `o-qsd-emblem`, `o-qsr-field`, `o-qsr-arms`, `o-qsg-emblem`). Grows: bits (coins), raid (shields, `len`).

**Files:**
- Create: `public/overlay/objects/styles/quest.js`, `public/overlay/objects/styles/quest.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/quest.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `quest` (prefix `o-qs`): looks `follow-quest`, `subscriber-quest`, `bits-quest`, `donation-quest`, `raid-quest`, `giveaway-quest`; sounds `qsFollow`, `qsSub`, `qsBits`, `qsDonation`, `qsRaid`, `qsGiveaway`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . quest qs
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `quest`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts qs quest . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/quest.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . quest .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2829 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/quest.js public/overlay/objects/styles/quest.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Quest, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 6: Comic

A pop-art comic book: panels that slam in, KAPOW! starbursts, speech bubbles, halftone dots and thick black ink.

Its six looks: New hero, KAPOW!, BAM!, CHA-CHING!, Incoming!, WINNER!. **Its patch:** Classes for the parts reached as bare elements (`o-cmr-hero`, `o-cmg-star`); `k` and `f` renamed `o-cm-k`, `o-cm-f`. Grows: bits (level, coins), raid (heroes, `len`).

**Files:**
- Create: `public/overlay/objects/styles/comic.js`, `public/overlay/objects/styles/comic.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/comic.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `comic` (prefix `o-cm`): looks `follow-comic`, `subscriber-comic`, `bits-comic`, `donation-comic`, `raid-comic`, `giveaway-comic`; sounds `cmFollow`, `cmSub`, `cmBits`, `cmDonation`, `cmRaid`, `cmGiveaway`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . comic cm
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `comic`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts cm comic . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/comic.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . comic .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2840 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/comic.js public/overlay/objects/styles/comic.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Comic, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 7: Cozy

Paper and stickers: a sticky note, a polaroid, a jar of stars, a love letter, paper boats and a gift box, all written by hand.

Its six looks: Sticky note, Polaroid, Jar of stars, Love letter, Paper boats, Gift box. **Its patch:** Classes for the parts reached as bare elements (`o-czd-tip`, `o-czg-loop`, `o-czg-piece`). Grows: subscriber (leaves, stem, the flower at 12 months), bits (stars), raid (boats).

**Files:**
- Create: `public/overlay/objects/styles/cozy.js`, `public/overlay/objects/styles/cozy.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/cozy.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `cozy` (prefix `o-cz`): looks `follow-cozy`, `subscriber-cozy`, `bits-cozy`, `donation-cozy`, `raid-cozy`, `giveaway-cozy`; sounds `czFollow`, `czSub`, `czBits`, `czDonation`, `czRaid`, `czGiveaway`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . cozy cz
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `cozy`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts cz cozy . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/cozy.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . cozy .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2851 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/cozy.js public/overlay/objects/styles/cozy.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Cozy, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 8: Cosmos

Space: a countdown and liftoff, moons in orbit, a meteor shower, an incoming transmission, a fleet warping in and a supernova.

Its six looks: Liftoff, New orbit, Meteor shower, Transmission, Fleet arrival, Supernova. **Its patch:** Classes for the parts reached as bare elements (`o-csf-n`, `o-csu-tier`); the SVG parts `body`, `nose`, `fin`, `bowl`, `feed`, `hull`, `wing`, `glow` renamed with the family's prefixes; the months' digits, which never glowed, say so on their `.o-odo`. Grows: bits (meteors), raid (ships).

**Files:**
- Create: `public/overlay/objects/styles/cosmos.js`, `public/overlay/objects/styles/cosmos.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/cosmos.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `cosmos` (prefix `o-cs`): looks `follow-cosmos`, `subscriber-cosmos`, `bits-cosmos`, `donation-cosmos`, `raid-cosmos`, `giveaway-cosmos`; sounds `csFollow`, `csSub`, `csBits`, `csDon`, `csRaid`, `csGive`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . cosmos cs
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `cosmos`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts cs cosmos . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/cosmos.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . cosmos .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2862 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/cosmos.js public/overlay/objects/styles/cosmos.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Cosmos, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 9: Glass

Clean and quiet: frosted panels, one soft sheen and numbers that count up. For streamers who want alerts that stay out of the way.

Its six looks: Pill, Ring, Counter, Receipt, Wave, Spotlight. **Its patch:** Classes for the parts reached as bare elements (`o-glb-fill`, `o-gld-line`). Grows: subscriber (the ring), bits (the bar), raid (avatars).

**Files:**
- Create: `public/overlay/objects/styles/glass.js`, `public/overlay/objects/styles/glass.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/glass.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `glass` (prefix `o-gl`): looks `follow-glass`, `subscriber-glass`, `bits-glass`, `donation-glass`, `raid-glass`, `giveaway-glass`; sounds `glFollow`, `glSub`, `glBits`, `glDonation`, `glRaid`, `glGiveaway`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . glass gl
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `glass`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts gl glass . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/glass.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . glass .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2873 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/glass.js public/overlay/objects/styles/glass.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Glass, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 10: Spooky

Playful Halloween: a ghost pops up to say boo, a cauldron brews the months, a treat bucket fills with candy, a tombstone rises with the tip, bats swarm across the moon and a jack-o’-lantern pops its top for the winner.

Its six looks: Ghost hello, Cauldron, Treat bucket, Haunted tombstone, Bat swarm, Pumpkin reveal. **Its patch:** Grows: bits (candies), raid (bats).

**Files:**
- Create: `public/overlay/objects/styles/spooky.js`, `public/overlay/objects/styles/spooky.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/spooky.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `spooky` (prefix `o-spk`): looks `follow-spooky`, `subscriber-spooky`, `bits-spooky`, `donation-spooky`, `raid-spooky`, `giveaway-spooky`; sounds `spkFollow`, `spkSub`, `spkBits`, `spkDonation`, `spkRaid`, `spkGiveaway`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . spooky spk
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `spooky`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts spk spooky . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/spooky.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . spooky .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2884 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/spooky.js public/overlay/objects/styles/spooky.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Spooky, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 11: Cyber

Neon cyberpunk: access granted for a follow, a system upgrade for a sub, a data stream of credits for bits, a decrypted message for a donation, a system breach for a raid and a hologram for the giveaway winner.

Its six looks: Access granted, Upgrade, Data stream, Decrypt, Breach, Hologram. **Its patch:** Two `.01s` typing times divided by `--spd`. Grows: bits (the rain), raid (lit nodes).

**Files:**
- Create: `public/overlay/objects/styles/cyber.js`, `public/overlay/objects/styles/cyber.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/cyber.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `cyber` (prefix `o-cyb`): looks `follow-cyber`, `subscriber-cyber`, `bits-cyber`, `donation-cyber`, `raid-cyber`, `giveaway-cyber`; sounds `cybFollow`, `cybSub`, `cybBits`, `cybDonation`, `cybRaid`, `cybGiveaway`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . cyber cyb
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `cyber`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts cyb cyber . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/cyber.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . cyber .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2895 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/cyber.js public/overlay/objects/styles/cyber.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Cyber, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 12: Western

The wild west: a wanted poster for follows, a sheriff’s badge for subs, a gold pan for bits, a telegram for donations, a posse riding in for raids and saloon doors bursting open for giveaways.

Its six looks: Wanted, Sheriff badge, Gold pan, Telegram, Posse, Saloon doors. **Its patch:** Grows: bits (nuggets), raid (riders).

**Files:**
- Create: `public/overlay/objects/styles/western.js`, `public/overlay/objects/styles/western.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/western.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `western` (prefix `o-wst`): looks `follow-western`, `subscriber-western`, `bits-western`, `donation-western`, `raid-western`, `giveaway-western`; sounds `wstFollow`, `wstSub`, `wstBits`, `wstDonation`, `wstRaid`, `wstGiveaway`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . western wst
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `western`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts wst western . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/western.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . western .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2906 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/western.js public/overlay/objects/styles/western.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Western, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 13: Retro OS

A 90s desktop: a dialog that zooms open, an install wizard, a file copy, new mail, a cascade of error boxes and the card-game win screen.

Its six looks: New window, Installer, File copy, New mail, Error cascade, Card cascade. **Its patch:** Grows: bits (pages copied), raid (error windows).

**Files:**
- Create: `public/overlay/objects/styles/retro.js`, `public/overlay/objects/styles/retro.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/retro.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `retro` (prefix `o-ros`): looks `follow-retro`, `subscriber-retro`, `bits-retro`, `donation-retro`, `raid-retro`, `giveaway-retro`; sounds `rosFollow`, `rosSub`, `rosBits`, `rosDonation`, `rosRaid`, `rosGiveaway`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . retro ros
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `retro`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts ros retro . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/retro.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . retro .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2917 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/retro.js public/overlay/objects/styles/retro.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Retro OS, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 14: Graffiti

Street art on brick and concrete: a spray-can tag, a bubble-letter piece, paint splats under a sticker, a pasted-up poster, a crew of tags and a sprayed crown.

Its six looks: Tag, Piece, Paint splat, Paste-up, Crew, Crown. **Its patch:** Grows: bits (splats), raid (crew tags).

**Files:**
- Create: `public/overlay/objects/styles/graffiti.js`, `public/overlay/objects/styles/graffiti.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/graffiti.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `graffiti` (prefix `o-gfi`): looks `follow-graffiti`, `subscriber-graffiti`, `bits-graffiti`, `donation-graffiti`, `raid-graffiti`, `giveaway-graffiti`; sounds `gfiFollow`, `gfiSub`, `gfiBits`, `gfiDonation`, `gfiRaid`, `gfiGiveaway`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . graffiti gfi
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `graffiti`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts gfi graffiti . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/graffiti.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . graffiti .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2928 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/graffiti.js public/overlay/objects/styles/graffiti.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Graffiti, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 15: Kawaii

Cute and pastel: a cat peeks up and waves, a bubble tea fills with pearls, mochi bounce, a bunny holds up a card, a parade of friends hops in and a gacha machine pops out the winner.

Its six looks: Paw wave, Boba, Mochi, Bunny card, Friend parade, Gacha. **Its patch:** Grows: subscriber (pearls), bits (mochi), raid (the parade).

**Files:**
- Create: `public/overlay/objects/styles/kawaii.js`, `public/overlay/objects/styles/kawaii.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/kawaii.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `kawaii` (prefix `o-kwi`): looks `follow-kawaii`, `subscriber-kawaii`, `bits-kawaii`, `donation-kawaii`, `raid-kawaii`, `giveaway-kawaii`; sounds `kwiFollow`, `kwiSub`, `kwiBits`, `kwiDonation`, `kwiRaid`, `kwiGiveaway`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . kawaii kwi
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `kawaii`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts kwi kawaii . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/kawaii.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . kawaii .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2939 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/kawaii.js public/overlay/objects/styles/kawaii.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Kawaii, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 16: Steampunk

Brass and gears: turning gears drive out a nameplate, a pressure gauge rises to the months, a coin press mints the bits, a pneumatic tube delivers the message, an airship fleet brings the raid and a clockwork box raises the winner’s name.

Its six looks: Gear engage, Pressure gauge, Coin press, Pneumatic tube, Airship fleet, Clockwork box. **Its patch:** Grows: subscriber (the gauge's needle), bits (coins), raid (ships).

**Files:**
- Create: `public/overlay/objects/styles/steampunk.js`, `public/overlay/objects/styles/steampunk.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/steampunk.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `steampunk` (prefix `o-stm`): looks `follow-steampunk`, `subscriber-steampunk`, `bits-steampunk`, `donation-steampunk`, `raid-steampunk`, `giveaway-steampunk`; sounds `stmFollow`, `stmSub`, `stmBits`, `stmDonation`, `stmRaid`, `stmGiveaway`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . steampunk stm
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `steampunk`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts stm steampunk . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/steampunk.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . steampunk .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2950 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/steampunk.js public/overlay/objects/styles/steampunk.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Steampunk, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 17: Frost

Winter and festive: a snow globe shakes for follows, an ornament spins onto a pine branch for subs, presents stack up for bits, a mug of hot cocoa steams for donations, a reindeer sleigh crosses the moon for raids and the northern lights light up the giveaway winner.

Its six looks: Snow globe, Ornament, Gift stack, Hot cocoa, Sleigh parade, Northern lights. **Its patch:** Grows: bits (presents), donation (marshmallows), raid (reindeer).

**Files:**
- Create: `public/overlay/objects/styles/frost.js`, `public/overlay/objects/styles/frost.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/frost.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `frost` (prefix `o-fro`): looks `follow-frost`, `subscriber-frost`, `bits-frost`, `donation-frost`, `raid-frost`, `giveaway-frost`; sounds `froFollow`, `froSub`, `froBits`, `froDonation`, `froRaid`, `froGiveaway`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . frost fro
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `frost`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts fro frost . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/frost.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . frost .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2961 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/frost.js public/overlay/objects/styles/frost.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Frost, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 18: Neon Sign

Neon signs on a brick wall at night: an open sign flickers on for follows, a motel sign for subs, a diner counter for bits, a billboard for donations, a street of little signs for raids and a theatre marquee for the giveaway winner.

Its six looks: Open sign, Motel sign, Diner counter, Billboard, Street of signs, Marquee. **Its patch:** The numbers' glow as a drop-shadow on their `.o-odo`. Grows: bits (bulbs), raid (signs).

**Files:**
- Create: `public/overlay/objects/styles/neon.js`, `public/overlay/objects/styles/neon.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/neon.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `neon` (prefix `o-neo`): looks `follow-neon`, `subscriber-neon`, `bits-neon`, `donation-neon`, `raid-neon`, `giveaway-neon`; sounds `neoFollow`, `neoSub`, `neoBits`, `neoDonation`, `neoRaid`, `neoGiveaway`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . neon neo
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `neon`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts neo neon . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/neon.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . neon .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2972 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/neon.js public/overlay/objects/styles/neon.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Neon Sign, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 19: Deep Sea

Under the sea: a bubble pops into the follower’s name, a clam opens on a glowing pearl, a school of fish swirls round the bits, a message in a bottle brings the donation, a pod of dolphins leaps in for raids and jellyfish light up the giveaway winner.

Its six looks: Bubble up, Pearl, School of fish, Message in a bottle, Pod, Jellyfish glow. **Its patch:** Grows: bits (fish), raid (dolphins).

**Files:**
- Create: `public/overlay/objects/styles/deepsea.js`, `public/overlay/objects/styles/deepsea.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/deepsea.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `deepsea` (prefix `o-sea`): looks `follow-deepsea`, `subscriber-deepsea`, `bits-deepsea`, `donation-deepsea`, `raid-deepsea`, `giveaway-deepsea`; sounds `seaFollow`, `seaSub`, `seaBits`, `seaDonation`, `seaRaid`, `seaGiveaway`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . deepsea sea
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `deepsea`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts sea deepsea . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/deepsea.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . deepsea .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2983 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/deepsea.js public/overlay/objects/styles/deepsea.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Deep Sea, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 20: Music

Stage and DJ booth: the needle drops on a spinning record for follows, an equalizer settles at the months for subs, speakers pump out a bass drop for bits, a cassette plays the request for donations, a crowd raises its hands for raids and a framed record is engraved with the winner.

Its six looks: Needle drop, Equalizer, Bass drop, Request line, Crowd, Gold record. **Its patch:** Grows: subscriber (the equalizer), bits (rings), raid (the crowd).

**Files:**
- Create: `public/overlay/objects/styles/music.js`, `public/overlay/objects/styles/music.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/music.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `music` (prefix `o-mus`): looks `follow-music`, `subscriber-music`, `bits-music`, `donation-music`, `raid-music`, `giveaway-music`; sounds `musFollow`, `musSub`, `musBits`, `musDonation`, `musRaid`, `musGiveaway`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . music mus
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `music`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts mus music . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/music.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . music .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2994 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/music.js public/overlay/objects/styles/music.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Music, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 21: Stadium

Match night at the arena: the jumbotron welcomes a follower, a season ticket slides out of a turnstile for a sub, a ball flies into the net for bits, the LED sponsor board thanks a donor, the stands do a wave for a raid and a trophy rises under the floodlights for a giveaway.

Its six looks: Jumbotron, Season ticket, Goal!, Sponsor board, Crowd wave, Trophy lift. **Its patch:** Grows: bits (the burst), raid (card sections).

**Files:**
- Create: `public/overlay/objects/styles/stadium.js`, `public/overlay/objects/styles/stadium.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/stadium.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `stadium` (prefix `o-std`): looks `follow-stadium`, `subscriber-stadium`, `bits-stadium`, `donation-stadium`, `raid-stadium`, `giveaway-stadium`; sounds `stdFollow`, `stdSub`, `stdBits`, `stdDonation`, `stdRaid`, `stdGiveaway`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . stadium std
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `stadium`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts std stadium . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/stadium.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . stadium .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (3005 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/stadium.js public/overlay/objects/styles/stadium.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Stadium, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 22: Fireworks

A night sky celebration: a sparkler writes the follower’s name in light, a countdown bursts into the months, a volley of rockets for bits, one big shell for a donation, a barrage of shells for a raid and a willow finale around the giveaway winner.

Its six looks: Sparkler, Countdown, Volley, Big shell, Barrage, Grand finale. **Its patch:** Grows: bits (rockets), donation (the shell), raid (shells).

**Files:**
- Create: `public/overlay/objects/styles/fireworks.js`, `public/overlay/objects/styles/fireworks.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/fireworks.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `fireworks` (prefix `o-fwk`): looks `follow-fireworks`, `subscriber-fireworks`, `bits-fireworks`, `donation-fireworks`, `raid-fireworks`, `giveaway-fireworks`; sounds `fwkFollow`, `fwkSub`, `fwkBits`, `fwkDonation`, `fwkRaid`, `fwkGiveaway`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . fireworks fwk
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `fireworks`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts fwk fireworks . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/fireworks.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . fireworks .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (3016 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/fireworks.js public/overlay/objects/styles/fireworks.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Fireworks, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 23: Dino

A friendly prehistoric adventure: footprints stomp in and a dino holds up a sign for follows, an egg hatches for subs, a volcano erupts gems for bits, a brush uncovers a fossil for donations, a herd stampedes in for raids and a drop of amber sets around the giveaway winner.

Its six looks: Footprints, Egg hatch, Volcano, Fossil dig, Stampede, Amber. **Its patch:** Grows: bits (gems), raid (the herd).

**Files:**
- Create: `public/overlay/objects/styles/dino.js`, `public/overlay/objects/styles/dino.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/dino.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `dino` (prefix `o-dno`): looks `follow-dino`, `subscriber-dino`, `bits-dino`, `donation-dino`, `raid-dino`, `giveaway-dino`; sounds `dnoFollow`, `dnoSub`, `dnoBits`, `dnoDonation`, `dnoRaid`, `dnoGiveaway`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . dino dno
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `dino`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts dno dino . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/dino.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . dino .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (3027 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/dino.js public/overlay/objects/styles/dino.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Dino, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 24: UFO

Playful aliens: a saucer beams down the follower’s name, a crop circle counts the months, cows float up into the beam for bits, the saucer’s screen decodes donations, a fleet lands for raids and the mothership spotlights the winner.

Its six looks: Beam up, Crop circle, Cow lift, Transmission, Invasion, Mothership. **Its patch:** Grows: bits (cows), raid (saucers).

**Files:**
- Create: `public/overlay/objects/styles/ufo.js`, `public/overlay/objects/styles/ufo.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/ufo.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `ufo` (prefix `o-ufo`): looks `follow-ufo`, `subscriber-ufo`, `bits-ufo`, `donation-ufo`, `raid-ufo`, `giveaway-ufo`; sounds `ufoFollow`, `ufoSub`, `ufoBits`, `ufoDonation`, `ufoRaid`, `ufoGiveaway`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . ufo ufo
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `ufo`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts ufo ufo . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/ufo.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . ufo .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (3038 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/ufo.js public/overlay/objects/styles/ufo.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): UFO, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 25: Breaking News

TV news and the newspaper: a BREAKING NEWS bar for follows, an EXTRA! front page spinning in for subs, a market chart for bits, a live report for donations, a weather map for raids and the press printing the winner on the front page.

Its six looks: Breaking, Extra! Extra!, Market ticker, Live report, Weather map, Front page. **Its patch:** Grows: bits (the chart), raid (clouds).

**Files:**
- Create: `public/overlay/objects/styles/news.js`, `public/overlay/objects/styles/news.css`
- Modify: `src/locales/*.json` (all seven)
- Modify: `tests/alertStyles.test.js`, `tests/alertLooks.test.js` (tests)

**Interfaces:**
- Consumes: the kit (Task 1), the converter and helpers in `$T`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/news.patch`, `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n/`.
- Produces: the family `news` (prefix `o-nws`): looks `follow-news`, `subscriber-news`, `bits-news`, `donation-news`, `raid-news`, `giveaway-news`; sounds `nwsFollow`, `nwsSub`, `nwsBits`, `nwsDonation`, `nwsRaid`, `nwsGiveaway`.

- [ ] **Step 1: Name the family in the tests**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-tests.js . news nws
````

- [ ] **Step 2: Run the families test and see it fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL in "are the gallery's families, in its order, each drawing all six alerts": the gallery has no `news`.

- [ ] **Step 3: Port the family: the converter, then its patch**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/port-family.js docs/superpowers/specs/assets/2026-10-15-alert-styles/parts nws news . .superpowers/port-b
git apply docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/patches/news.patch
````

- [ ] **Step 4: Its texts in the seven languages**

````bash
T=docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools
node $T/family-texts.js . news .superpowers/port-b docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/i18n
````

- [ ] **Step 5: Run the family's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js tests/alertLooks.test.js tests/i18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (3049 tests).

- [ ] **Step 6: Commit**

````bash
git add public/overlay/objects/styles/news.js public/overlay/objects/styles/news.css src/locales tests/alertStyles.test.js tests/alertLooks.test.js
git commit -m "feat(alert-styles): Breaking News, six looks in the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 26: The docs, the boot check and the check in a browser

This task records what release B changed and runs the checks unit tests cannot: two boots on a fresh database as CI
does, and every new look played through the real overlay page.

**Files:**
- Modify: `CLAUDE.md` (the Alert styles bullet, Project Structure, the Team Activity Log)
- Modify: `docs/operations/deploy.md` (release notes)

- [ ] **Step 1: CLAUDE.md and the runbook**

````bash
python3 - <<'ATLETA_SCRIPT'
import pathlib
def swap(path, old, new):
    p = pathlib.Path(path); s = p.read_text()
    assert s.count(old) == 1, (path, old[:60]); p.write_text(s.replace(old, new))
swap('CLAUDE.md', "Release A has the Samurai family (today's five objects as presets `follow-samurai` … `raid-samurai`, and the omikuji `giveaway-samurai`) and Racing;",
     "Release A brought the Samurai family (today's five objects as presets `follow-samurai` … `raid-samurai`, and the omikuji `giveaway-samurai`) and Racing; release B the other 24 families of Appendix A (Grand Prix, Cockpit, Arcade, Quest, Comic, Cozy, Cosmos, Glass, Spooky, Cyber, Western, Retro OS, Graffiti, Kawaii, Steampunk, Frost, Neon Sign, Deep Sea, Music, Stadium, Fireworks, Dino, UFO, Breaking News): 26 families, 156 looks;")
swap('CLAUDE.md', "styles/<family>.js + .css (one pair per family, joined for the pages)",
     "styles/<family>.js + .css (one pair per family, 26 families, joined for the pages)")
swap('CLAUDE.md', "**Adding a family:** `public/overlay/objects/styles/<family>.js` + `.css` from the proposal (`docs/superpowers/specs/assets/2026-10-15-alert-styles/`, spec section 5)",
     "**Adding a family:** `public/overlay/objects/styles/<family>.js` + `.css` from the proposal (`docs/superpowers/specs/assets/2026-10-15-alert-styles/`, spec section 5; release B ported its 24 with the converter `docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools/port-family.js` and a patch each)")
p = pathlib.Path('docs/operations/deploy.md'); s = p.read_text().rstrip('\n')
s += """

## Alert styles (release B)

What changes when it deploys:
- The Overlay Builder's gallery gets the other 24 families (144 looks): Grand Prix, Cockpit, Arcade, Quest, Comic,
  Cozy, Cosmos, Glass, Spooky, Cyber, Western, Retro OS, Graffiti, Kawaii, Steampunk, Frost, Neon Sign, Deep Sea,
  Music, Stadium, Fireworks, Dino, UFO and Breaking News. "Use <family> for all six" offers each of them.
- Nothing stored changes: no column, no migration, no look anyone picked. Every alert stays as it is until its
  streamer picks one of the new looks.
- The joined family files grow to about 1.1 MB (about 240 KB as Cloudflare compresses them); an open OBS source
  fetches them again once, after the server restarts. The builder loads every family's fonts in one stylesheet
  (44 fonts).

After the deploy (while no streamer is live):
1. `/health` answers 200, and `/overlay/objects/styles.js` registers 26 families.
2. In the Overlay Builder, the gallery of each alert shows the 26 families. Pick Spooky's Treat bucket for the bits,
   save, and press Test: OBS plays it.
3. Pick a cyan colour on a new look and test again: its main parts follow the colour.
4. Turn "Grows with the amount" off on that look and test a big cheer: the middle picture, the real number.

Rolling back is safe: older code does not know the new looks and draws the alert's own object (release A's rule).
Until a streamer who picked one picks a look the older code knows, the builder refuses to save that alert.
"""
p.write_text(s + '\n')
print('docs updated')
ATLETA_SCRIPT
````

- [ ] **Step 2: Boot twice on a fresh database, as CI does**

````bash
tmp=$(mktemp -d) && cp -R . "$tmp/app" && cd "$tmp/app" && rm -rf data
for boot in 1 2; do
  DISCORD_DISABLED=1 TWITCH_CLIENT_ID=x TWITCH_CLIENT_SECRET=x PORT=3999 node src/index.js > boot-$boot.log 2>&1 &
  pid=$!; sleep 6
  curl -fsS http://127.0.0.1:3999/health && echo
  curl -fsS http://127.0.0.1:3999/overlay/objects/styles.js | grep -c "registerFamily({"
  kill -TERM $pid; wait $pid; echo "exit $?"
done
grep -c "\[DB migration\]" boot-1.log boot-2.log || true
cd - && rm -rf "$tmp"
````

Expected: both boots answer `{"ok":true}`, `styles.js` registers 26 families, both exit 0, and there is no
`[DB migration]` line (`grep -c` prints 0 for each log and exits 1, hence the `|| true`).

- [ ] **Step 3: Every new look through the real overlay page**

````bash
tmp=$(mktemp -d) && cp -R . "$tmp/app" && cd "$tmp/app" && rm -rf data && mkdir data
node docs/superpowers/plans/assets/2026-10-15-alert-styles-release-b/tools/obs-like-check.js "$tmp/shots"
python3 - "$tmp/shots" <<'ATLETA_SCRIPT'
import sys, pathlib
from PIL import Image
d = pathlib.Path(sys.argv[1]); shots = sorted(d.glob('*.png'))
for i in range(0, len(shots), 24):
    sheet = Image.new('RGB', (6 * 480, 4 * 300), (27, 29, 36))
    for j, f in enumerate(shots[i:i + 24]):
        im = Image.open(f); im.thumbnail((470, 290)); sheet.paste(im, ((j % 6) * 480, (j // 6) * 300))
    sheet.save(d / f'sheet-{i // 24 + 1}.png')
print(len(shots), 'shots')
ATLETA_SCRIPT
echo "$tmp/shots"
````

Expected: `{"shots":174,"missing":[],"errors":[]}`: the six alerts untouched, the 144 new looks in cyan and every
family's bits look in red. Look at every `sheet-*.png`: each look drawn whole, in its colour, nothing cut off.
Then remove the copy (`cd - && rm -rf "$tmp"`).

- [ ] **Step 4: Run the whole suite once more, and write the Team Activity Log entry**

````bash
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, 3049 tests.

Append an entry to `CLAUDE.md`'s Team Activity Log, in its format:

- **Task:** "Alert styles, release B: the other 24 families (144 looks), each in the streamer's colour".
- **Files:** the 48 family files, the locale files, the kit (`isWide`), the tests, `CLAUDE.md`, `docs/operations/deploy.md`, the plan and its assets.
- **Decisions:** families ported by the converter plus a patch each; "grows with the amount" sizes pictures through `K.sizeOf()` (the text keeps the real number); the on-screen words of a look stay as the proposal draws them; the builder loads every family's fonts in one stylesheet.
- **Open:** the check in a real OBS browser source; a native read-through of the new translations.

- [ ] **Step 5: Commit and push the branch (not `main`)**

````bash
git add CLAUDE.md docs/operations/deploy.md
git commit -m "docs: alert styles release B" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin feat/alert-styles-b
````

Merging into `main` deploys to production. That is the owner's call, while no streamer is live
(`docs/operations/deploy.md`).
