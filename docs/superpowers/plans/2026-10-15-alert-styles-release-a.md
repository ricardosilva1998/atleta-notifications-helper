# Alert styles, release A: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every streamer can pick, per alert, a finished look from a gallery in the Overlay Builder. Release A
ships three things:

- the system behind the gallery;
- the Samurai family: today's five alerts as presets, plus the omikuji for the giveaway;
- the Racing family, rebuilt as night-race graphics, with the giveaway's card improved in place.

Every look takes the streamer's colour. Every alert nobody restyles stays exactly as it is today.

**Architecture:**

- **One registry, used by both pages.** The looks live in `public/overlay/objects/`: a shared kit (`kit.js`) and one file pair per family (`styles/<family>.js` and `.css`). The OBS overlay and the builder preview draw from these same files. The server joins the family files into `/overlay/objects/styles.js` and `/overlay/objects/styles.css`, with no build step, and reads the same registry in Node as its catalogue (`src/services/alertStyles.js`).
- **Where the choice is stored.** `overlay_designs` gets four nullable columns for a look's settings, next to the C1 branch's `style` column.
- **The builder.** Each of the six alert tabs opens with a Style section: the gallery, "Use <family> for all six alerts", and the look's controls. Its rules live in a page-free helper (`public/js/builder-styles-core.js`).

**Tech Stack:** Node.js 24, Express 5, EJS, better-sqlite3, plain browser JavaScript and CSS (OBS's Chromium), Web Audio,
`node --test`.

**Spec:** `docs/superpowers/specs/2026-10-15-alert-styles-design.md`, and the proposal page it references (source in
`docs/superpowers/specs/assets/2026-10-15-alert-styles/`). Read both. This plan argues from the spec.

## Global Constraints

- **Code style.** Plain CommonJS with no build step (the project's CLAUDE.md). The browser files are plain scripts that also export for Node (`module.exports` when `module` exists, a `window.*` global otherwise).
- **OBS's Chromium.** It is older, so the looks use none of `:has()`, `color-mix()`, container queries, `@property` or `backdrop-filter` (spec 9).
- **Overlay Consistency Rule.** One registry in `public/overlay/objects/`. The OBS overlay (`overlay.js`) and the builder preview (`overlay-builder.ejs`) draw every look from the same files, and pick it with the same rule.
- **Inside a family's files.**
  - Every class starts with `.o-<prefix>` and every keyframe with `<prefix>`.
  - Animations run only under `.playing` or `.exiting`, and every animation time is divided by `var(--spd)`.
  - No selector reaches into another part (`.x i`, `.x span`, `.x div`).
  - Families drawn with content-box sizing declare `box-sizing: content-box` on their own root and descendants (spec 4.5).
- **Style ids** are `<alert>-<family>`, and subscriptions use `subscriber` (spec 4.1). The owner's names for today's looks: `follow-samurai`, `subscriber-samurai`, `bits-samurai`, `donation-samurai`, `raid-samurai`, `giveaway-racing`.
- **Colour.** Every look takes the streamer's colour, and the accent colours its main element (spec 2, 4.4). The slot carries `--a --a-rgb --a-on --a-hi --a-lo --a-deep --a-night --a-ink --a-soft --a-tint`.
- **An alert nobody restyles stays as today:** today's object, speed 1, no screen effect (whatever an older builder saved), today's sound. The giveaway is the decided exception: it becomes Racing's Victory lap, and its saved colours, text and effect carry over (spec 4.3, 4.8).
- **Save rules** (spec 4.2):
  - `style_accent` must be `#rrggbb`, or the save answers 400.
  - `style_label` is cut to 40 characters, by characters.
  - An unknown `style_sound` is left out: the look's own sound plays.
  - `style_grows` must be 0 or 1, or the save answers 400.
  - `style` must be a look that draws the alert, or the streamer's own private look, or the save answers 400 naming the field.
- **Translations.** Every text goes through `t()`, with the key in all seven locale files (en, pt, es, fr, de, zh, ja). `tests/i18n.test.js` enforces this.
- **Tests** run with `node --test "src/**/*.test.js" "tests/**/*.test.js"`. They never touch the network, production or `data/`.
- **Git.**
  - Work on `feat/alert-styles` (worktree `.worktrees/alert-styles`).
  - Never push `main`: a push to `main` deploys. Never force-push.
  - Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

These are the five inputs the spec implies that are most likely to hurt a streamer. Each has a test in the task that
owns its code.

1. **An alert nobody has restyled since the release** must look, move and sound exactly as before. That means today's object, speed 1, today's sound, and no screen effect even when an older builder saved one.
   - Task 10: "an alert nobody has restyled is today's object…"
   - Task 11: "…plays no effect, whatever an older builder saved, and today's sound"
   - Tasks 13 and 14: `untouched()`
2. **The joined family file fails to load, or one family throws.** The giveaway then shows today's card, the five alerts their objects, and the other families still register.
   - Task 6: each family runs inside its own `try`.
   - Task 10: "when the joined looks did not load…" and "a look that throws while drawing falls back…".
3. **The C1's owner clicks "Use <family> for all six".** His donation takes the family's look, and the C1 stays first in his donation gallery as "Made for you", so he can go back.
   - Task 9: the family route.
   - Task 14: "the C1's owner finds it first in the donation gallery".
4. **A hostile or long main text** (markup, quotes, emoji, more than 40 characters). It is stored cut at 40 characters by characters, and drawn escaped in every look.
   - Task 8: the cut.
   - Tasks 3 and 4: a hostile label is escaped in every look.
5. **An extreme colour** (white, black, pale yellow). Text drawn on the accent must stay readable: `--a-on` is dark on light colours and white on dark ones.
   - Task 1: `accentVars('#FFFFFF')` gives `--a-on:#0B0B12`, and `#000000` gives white.

## File structure

**New files:**

| File | Responsibility |
|---|---|
| `public/overlay/objects/kit.js` | What every look shares: helpers, colour variables, look data, default look, effect and sound rules, registration, sounds |
| `public/overlay/objects/styles/samurai.js` + `.css` | Today's five as presets (`*-samurai`), and the omikuji (`giveaway-samurai`) |
| `public/overlay/objects/styles/racing.js` + `.css` | Racing's six looks (`*-racing`); `giveaway-racing` is the giveaway's default |
| `public/overlay/fx.js` + `fx.css` | The five new screen effects, drawn the same way by both pages |
| `public/js/builder-styles-core.js` | The Style section's rules that need no page |
| `src/services/alertStyles.js` | The catalogue for the server: private looks, galleries, families, defaults, sounds, fonts |
| `src/services/alertStyleBundle.js` | The family files joined, with a version |
| `tests/objectKit.test.js` | Tests the kit |
| `tests/alertLooks.test.js` | Tests every look and every family stylesheet |
| `tests/alertStyles.test.js` | Tests the catalogue |
| `tests/fx.test.js` | Tests the screen effects |
| `tests/builderStylesCore.test.js` | Tests the builder's Style rules |
| `src/services/alertStyleBundle.test.js` | Tests the joined files |

**Changed files:**

| File | What changes |
|---|---|
| `public/overlay/objects/objects.css` | The shared look styles; today's reds read the colour variables |
| `public/overlay/overlay.js` | Which look, its data, variables, width, timing, fallback, effect, sound and fonts |
| `src/views/overlay-builder.ejs` | The Style section, the look preview, the save, Discard and Reset, the effect lists |
| `src/routes/overlay.js` | Serves the joined files; the overlay page loads the kit, the styles and fx |
| `src/routes/dashboard.js` | The look in the save, the family route, the Style section's data |
| `src/db.js` | The four columns; a look starts fresh; several looks at once; the alert's own colours |
| `src/services/overlayDesign.js` | The four fields and the five effects in `FIELD_SPECS` |
| `src/locales/*.json` | The new texts |
| Tests | `src/db.overlayDesigns.test.js`, `src/routes/dashboard.test.js`, `src/routes/overlay.test.js`, `src/services/overlayDesign.test.js`, `tests/overlayClient.test.js`, `tests/overlayBuilder.test.js`, `tests/overlayObjects.test.js`, `tests/overlayPlacement.test.js`, `tests/streamerViewsI18n.test.js`, `tests/i18n.test.js` |

## How the steps are written

- **This plan was run before it was written.** Every task was built in a scratch copy of the C1 branch at `9255bd3`, with its tests failing first and then passing, and the whole suite passing after each task.
- **Its commands were then run again**, start to finish, on a fresh copy of the C1 branch's head `040b180` (two docs commits later). Each task's new tests failed before its code, the whole suite passed after it, and the end result matched the tested copy file for file.
- **New files** are written with `cat > path <<'ATLETA_FILE'`.
- **Changes to existing files** are applied with `git apply <<'ATLETA_PATCH'`. Each patch shows its context, so if the C1 branch changed after `040b180` and a hunk does not apply, make that change by hand where the context shows.
- **Two mechanical changes are small scripts** rather than patches: the samurai reds in Task 2, and the locale texts in Tasks 9, 11 and 14.
- **Run every command from the root of the worktree.**

### Task 0: Start from the C1 branch

The spec builds on `feat/vilela-c1-donation` (andre_vilela_'s C1 donation alert). That branch adds:

- `overlay_designs.style`, and a save and a Reset that keep it;
- the style map `window.ATLETA_OBJECT_STYLES` with `donation-c1`;
- `objectFor()` in the overlay and `previewObjectFor()` in the builder, and each object's own exit time.

The C1 merges first; this plan extends what it built.

- [ ] **Step 1: Bring the C1 work into this branch with a merge, not a rebase (the branch is already pushed)**

````bash
cd .worktrees/alert-styles
git fetch origin
if git merge-base --is-ancestor origin/feat/vilela-c1-donation origin/main; then
  git merge --no-edit origin/main
else
  git merge --no-edit origin/feat/vilela-c1-donation   # C1 not merged yet: this branch must then merge after it
fi
````

Expected: the merge succeeds without conflicts. This branch only added `docs/superpowers/specs/2026-10-15-alert-styles-design.md` and its assets, so nothing should collide.

- [ ] **Step 2: Check the starting point**

````bash
git log --oneline -1 origin/feat/vilela-c1-donation
node --test "src/**/*.test.js" "tests/**/*.test.js"
grep -n "function setOverlayDesignStyle\|ADD COLUMN style TEXT" src/db.js
grep -n "ATLETA_OBJECT_STYLES" public/overlay/objects/index.js | head -3
````

Expected:

- The suite passes: 2608 tests at `040b180` (its last two commits only changed docs).
- `src/db.js` has `setOverlayDesignStyle` and the `style` column migration.
- `index.js` defines the style map.

If the C1 branch's head is not `040b180`, read what it changed since (`git log 040b180..origin/feat/vilela-c1-donation`) before starting: a patch below may then need its context adjusted.


### Task 1: The alert kit: what every look shares

`public/overlay/objects/kit.js` is the one file every look and both pages use (spec 4.3, 4.4, 4.5, 4.7). It holds:

- the helpers a look's `render(d)` calls: escaping, names that fit, odometer digits, typed text;
- the colour variables a slot carries when the streamer picks a colour. `accentVars` gives the colour, its numbers, the text colour that reads on it, and seven shades;
- what a look is handed from a saved design (`lookData`, `slotVars`, `sizeOf`);
- the default look of an alert with no style (`DEFAULT_LOOKS`; only the giveaway has one);
- which effect and sound a look plays (`effectFor`, `soundFor`);
- the registration of families, looks and sounds, and the looks' synthesized sounds.

It is plain browser JavaScript that also exports for Node, like `objects/index.js`. Two things go into `objects.css`:
the shared styles the helpers produce (`.o-nm`, `.o-odo`, `.o-typed .o-ch`), and the rule that scales a look to its
slot's width (`.alert-pos.look`).

**Files:**
- Create: `public/overlay/objects/kit.js`
- Modify: `public/overlay/objects/objects.css`
- Create: `tests/objectKit.test.js` (test)

**Interfaces:**
- Consumes: `objects/index.js`: `window.ATLETA_OBJECT_STYLES` (the C1 branch's style map; in Node, `require('./index.js').STYLES`).
- Produces: `window.ATLETA_KIT` (Node: `require('public/overlay/objects/kit.js')`):
  - data: `ALERTS` (the six event types), `MIDDLE` `{ bits: 500, raid: 42, months: 4, donation: 25 }`, `styles` (the style map), `families`, `sounds`, `soundFamilies`, `DEFAULT_LOOKS` `{ giveaway_winner: 'giveaway-racing' }`
  - helpers: `esc(s)`, `money(amount, currency)`, `fitStyle(name, holds)`, `nm(cls, name, holds, extra)`, `samName(name, holds)`, `fmt(n)`, `label(d, fallback)`, `odo(text, delay, dur)`, `typed(text, t0, per, max) → { n, style, html }`, `hash(s)`, `rng(seed)`, `code3(name)`, `intOf(v)`, `rgbOf(hex)`, `onColour(hex)`
  - colour and data:
    - `accentVars(hex) → '--a:…;--a-rgb:…;--a-on:…;--a-hi:…;--a-lo:…;--a-deep:…;--a-night:…;--a-ink:…;--a-soft:…;--a-tint:…;'`, or `''` for anything that is not `#rrggbb`
    - `sizeOf(d, kind)`, `lookData(look, data, design)`
    - `slotVars(look, design) → { '--a': …, '--spd': … }`
    - `effectFor(look, design)`, `soundFor(look, design)`
  - registration: `registerFamily({ key, order, fonts, …extra })`, `fontNames(familyKey)`, `register(look)`, `looksOf(eventType)`, `registerSound(key, family, fn)`
  - sound: `setAudio(ctx, volumeFn)`, `playSound(key) → boolean`, `tone(o)`, `noise(o)`, `engine(o)`
  - a look's shape:
    - `key`, `eventType`, `family`, and optionally `preset`
    - `anim: { in, dur, ease }` and `exit: { out, dur, ease }`
    - `len`: the entrance in seconds, or a function of the data
    - `sound`, `fx`, `grows`
    - `controls: { colour: 'accent' | 'racing' | false, label, speed }`
    - `render(d)`

- [ ] **Step 1: Write the failing tests**

Create `tests/objectKit.test.js`:

````bash
mkdir -p tests && cat > tests/objectKit.test.js <<'ATLETA_FILE'
'use strict';

// public/overlay/objects/kit.js: the helpers every look uses, the colour variables, and what a look
// is handed from a saved design (the OBS overlay and the builder preview both call these).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const K = require('../public/overlay/objects/kit.js');

describe('helpers', () => {
  test('esc escapes markup and quotes', () => {
    assert.equal(K.esc('<b a="1">\'&'), '&lt;b a=&quot;1&quot;&gt;&#39;&amp;');
    assert.equal(K.esc(null), '');
  });

  test('a long name is set smaller, never below 0.6, and keeps its ellipsis class', () => {
    assert.equal(K.fitStyle('ABCDE', 5), '');
    assert.equal(K.fitStyle('ABCDEFGHIJ', 5), '--fit:0.60;');
    assert.equal(K.fitStyle('ABCDEFG', 6), '--fit:0.86;');
    assert.equal(K.nm('x', 'A<b>', 10), '<div class="x o-nm" style=""><span class="o-nm-t">A&lt;b&gt;</span></div>');
  });

  test('the odometer spins the units twice and the tens once', () => {
    const html = K.odo('42', 0.5, 0.6);
    assert.match(html, /^<span class="o-odo" style="--odel:0\.5s;--odur:0\.6s">/);
    assert.ok(html.includes('style="--to:14"'), 'the tens (4) after one turn');
    assert.ok(html.includes('style="--to:22"'), 'the units (2) after two turns');
  });

  test('typed text is one span per character, cut with an ellipsis', () => {
    const t = K.typed('a<b', 0.2, 0.05, 10);
    assert.equal(t.n, 3);
    assert.equal(t.html, '<span class="o-ch" style="--ti:0">a</span><span class="o-ch" style="--ti:1">&lt;</span><span class="o-ch" style="--ti:2">b</span>');
    assert.equal(K.typed('abcdef', 0, 0.1, 4).n, 4);
  });

  test('money writes the currency, and keeps what is not a number', () => {
    assert.equal(K.money('25', 'EUR'), '€25.00');
    assert.equal(K.money('abc', 'EUR'), 'EUR abc');
  });

  test('the same name always gives the same randomness', () => {
    const a = K.rng(K.hash('ApexAndre')), b = K.rng(K.hash('ApexAndre'));
    assert.equal(a(), b());
  });
});

describe('the streamer\'s colour', () => {
  test('gives the colour, its numbers, the text colour on it and its shades', () => {
    assert.equal(K.accentVars('#d81e26'),
      '--a:#D81E26;--a-rgb:216,30,38;--a-on:#FFFFFF;--a-hi:#DF474D;--a-lo:#AD181E;--a-deep:#771115;--a-night:#3C080B;--a-ink:#1E0405;--a-soft:#E58286;--a-tint:#E77478;');
  });

  test('dark text on a light colour, white text on a dark one', () => {
    assert.match(K.accentVars('#FFFFFF'), /--a-on:#0B0B12;/);
    assert.match(K.accentVars('#000000'), /--a-on:#FFFFFF;/);
  });

  test('nothing for a value that is not #rrggbb', () => {
    for (const value of [null, undefined, '', 'red', '#FFF', '#GGGGGG', 12]) assert.equal(K.accentVars(value), '', String(value));
  });
});

describe('what a look is handed', () => {
  const accentLook = { controls: { colour: 'accent', label: true, speed: true } };
  const racingLook = { controls: { colour: 'racing', label: true, speed: true } };
  const todayLook = { controls: { colour: 'accent', label: false, speed: false } };

  test('sizeOf: the real number, or the middle picture when "grows with the amount" is off', () => {
    assert.equal(K.sizeOf({ amount: 10000 }, 'bits'), 10000);
    assert.equal(K.sizeOf({ amount: 10000, grows: false }, 'bits'), 500);
    assert.equal(K.sizeOf({ viewers: 850, grows: false }, 'raid'), 42);
    assert.equal(K.sizeOf({ months: 27, grows: false }, 'months'), 4);
    assert.equal(K.sizeOf({ amount: '250.00', grows: false }, 'donation'), 25);
    assert.equal(K.sizeOf({ amount: 'abc' }, 'bits'), 0);
  });

  test('lookData: the main text, grows, and Racing\'s colours from today\'s columns', () => {
    const event = { username: 'A', amount: 5 };
    assert.deepEqual(K.lookData(accentLook, event, { style_label: 'Hi', style_grows: 0 }), { username: 'A', amount: 5, label: 'Hi', grows: false });
    assert.deepEqual(K.lookData(racingLook, event, { event_label: 'Pit', bg_color: '#111111', accent_color: '#222222', text_color: '#333333', username_font_family: 'Bangers' }),
      { username: 'A', amount: 5, label: 'Pit', colours: { bg: '#111111', accent: '#222222', name: '#333333', font: 'Bangers' }, grows: true });
    assert.deepEqual(K.lookData(todayLook, event, { style_label: 'ignored' }), { username: 'A', amount: 5, grows: true });
    assert.equal(event.label, undefined, 'the event itself is not changed');
  });

  test('slotVars: the colour and the speed for a look that takes them, nothing for today\'s five', () => {
    assert.deepEqual(K.slotVars(accentLook, { style_accent: '#29E0FF', animation_speed: 9 })['--spd'], '2');
    assert.equal(K.slotVars(accentLook, { style_accent: '#29E0FF' })['--a-hi'], '#50E6FF');
    assert.deepEqual(K.slotVars(todayLook, { style_accent: null, animation_speed: 1.5 }), {});
    assert.deepEqual(K.slotVars(racingLook, { style_accent: '#29E0FF', animation_speed: 0.2 }), { '--spd': '0.5' });
  });
});

describe('registering', () => {
  test('a look needs a known family, one of the six alerts and a render', () => {
    K.registerFamily({ key: 'kittest', order: 99, fonts: ['Some+Font:wght@700'] });
    assert.throws(() => K.register({ key: 'x', eventType: 'follow', family: 'nope', render() {} }), /family/);
    assert.throws(() => K.register({ key: 'x', eventType: 'yt_member', family: 'kittest', render() {} }), /six alert types/);
    assert.throws(() => K.register({ key: 'x', eventType: 'follow', family: 'kittest' }), /no render/);
    K.register({ key: 'follow-kittest', eventType: 'follow', family: 'kittest', render() { return ''; } });
    assert.equal(K.styles['follow-kittest'].family, 'kittest');
    assert.deepEqual(K.fontNames('kittest'), ['Some Font']);
    assert.ok(K.looksOf('follow').some((l) => l.key === 'follow-kittest'));
    assert.ok(!K.looksOf('donation').some((l) => l.key === 'donation-c1'), 'the C1 has no family and is not listed');
  });
});

describe('the default look, the effect and the sound', () => {
  const look = { key: 'follow-kitfx', family: 'kittest', fx: 'sparks', sound: 'kitBeep' };
  const ownObject = { key: 'follow' };

  test('the giveaway\'s default look is Racing\'s Victory lap; the five have none (today\'s object)', () => {
    assert.deepEqual(K.DEFAULT_LOOKS, { giveaway_winner: 'giveaway-racing' });
  });

  test('effectFor: none for today\'s objects and the C1, the design\'s effect or the look\'s own for a look', () => {
    assert.equal(K.effectFor(ownObject, { screen_effect: 'confetti' }), 'none', 'an untouched alert keeps no effect');
    assert.equal(K.effectFor(null, {}), 'none');
    assert.equal(K.effectFor(look, { screen_effect: 'default' }), 'sparks');
    assert.equal(K.effectFor(look, {}), 'sparks');
    assert.equal(K.effectFor(look, { screen_effect: 'gold' }), 'gold');
    assert.equal(K.effectFor(look, { screen_effect: 'none' }), 'none');
    assert.equal(K.effectFor({ family: 'kittest' }, null), 'none', 'a look without an effect of its own');
  });

  test('soundFor: the design\'s sound when known, else the look\'s own, else today\'s', () => {
    K.registerSound('kitBeep', 'kittest', () => {});
    assert.equal(K.soundFor(look, {}), 'kitBeep');
    assert.equal(K.soundFor(look, { style_sound: 'none' }), 'none');
    assert.equal(K.soundFor(look, { style_sound: 'today' }), 'today');
    assert.equal(K.soundFor(look, { style_sound: 'nope' }), 'kitBeep', 'an unknown sound falls back to the look\'s own');
    assert.equal(K.soundFor(look, { style_sound: '__proto__' }), 'kitBeep');
    assert.equal(K.soundFor(ownObject, {}), 'today');
    assert.equal(K.soundFor(null, null), 'today');
  });

  test('a sound belongs to a registered family', () => {
    assert.throws(() => K.registerSound('kitNope', 'nope', () => {}), /family/);
    K.registerSound('kitChime', 'kittest', () => {});
    assert.equal(K.soundFamilies.kitChime, 'kittest');
  });

  test('playSound plays a registered sound through the AudioContext it was given, and says false otherwise', () => {
    let played = 0;
    K.registerSound('kitCount', 'kittest', () => { played++; });
    K.setAudio(null);
    assert.equal(K.playSound('kitCount'), false, 'no AudioContext yet');
    K.setAudio({}, () => 0.5);
    assert.equal(K.playSound('kitCount'), true);
    assert.equal(K.playSound('nope'), false);
    assert.equal(played, 1);
    K.setAudio(null);
  });
});
ATLETA_FILE
````

- [ ] **Step 2: Run them and see them fail**

````bash
node --test tests/objectKit.test.js
````

Expected: FAIL: the test file cannot load `kit.js` yet (1 failing).

- [ ] **Step 3: Write the code**

Create `public/overlay/objects/kit.js`:

````bash
mkdir -p public/overlay/objects && cat > public/overlay/objects/kit.js <<'ATLETA_FILE'
'use strict';

/**
 * The alert kit: what every look shares (docs/superpowers/specs/2026-10-15-alert-styles-design.md).
 * Loaded after objects/index.js and before the family files (objects/styles/*.js, served joined as
 * /overlay/objects/styles.js) by the OBS overlay and by the Overlay Builder alike:
 *   - the helpers a look's render(d) uses: escaping, names that fit, odometer digits, typed text
 *   - registerFamily() and register(): a look joins the style map index.js starts
 *     (window.ATLETA_OBJECT_STYLES), next to andre_vilela_'s C1
 *   - lookData() and slotVars(): what a look is handed from the alert's saved design, for the
 *     overlay and the builder preview alike (one function, so the two draw the same thing)
 *   - accentVars(): the colour variables a slot carries when the streamer picked a colour
 *   - sizeOf(): the number a picture grows with ("grows with the amount" off: a middle value)
 *   - the looks' synthesized sounds, played through the overlay's AudioContext and volume
 * Dual-exported: a browser global for <script src>, CommonJS for node:test. No build step.
 */
(function (root) {
  var STYLES = (root && root.ATLETA_OBJECT_STYLES)
    || (typeof require === 'function' ? require('./index.js').STYLES : null)
    || {};
  if (root && !root.ATLETA_OBJECT_STYLES) root.ATLETA_OBJECT_STYLES = STYLES;

  // The six alerts a look can draw (the giveaway's event type is giveaway_winner).
  var ALERTS = ['follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner'];

  // ── Helpers for render(d) ─────────────────────────────────────────────
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }

  // A donation amount as its currency writes it ("€25.00"), as index.js's money() does.
  function money(amount, currency) {
    var code = String(currency == null ? '' : currency).trim().toUpperCase();
    var number = Number(amount);
    if (amount == null || String(amount).trim() === '' || !isFinite(number)) {
      return ((code ? code + ' ' : '') + String(amount == null ? '' : amount)).trim();
    }
    if (/^[A-Z]{3}$/.test(code)) {
      try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(number); } catch (e) { /* the plain form below */ }
    }
    return (code ? code + ' ' : '') + number.toFixed(2);
  }

  function isWide(cp) {
    return (cp >= 0x1100 && cp <= 0x11FF) || (cp >= 0x2E80 && cp <= 0xA4CF) || (cp >= 0xAC00 && cp <= 0xD7A3)
      || (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0xFE30 && cp <= 0xFE6F) || (cp >= 0xFF00 && cp <= 0xFF60)
      || (cp >= 0xFFE0 && cp <= 0xFFE6) || cp >= 0x1F000;
  }
  function nameWidth(name) {
    var chars = Array.from(String(name == null ? '' : name)), width = 0;
    for (var i = 0; i < chars.length; i++) width += isWide(chars[i].codePointAt(0)) ? 1.5 : 1;
    return width;
  }
  // --fit scales a long name down (never below 0.6); what still does not fit ends in an ellipsis.
  function fitStyle(name, holds) {
    var width = nameWidth(name);
    var fit = width > holds ? Math.max(0.6, holds / width) : 1;
    return fit < 1 ? '--fit:' + fit.toFixed(2) + ';' : '';
  }
  // A name that fits its place (.o-nm in objects.css); `holds` is how many capitals fit at full size.
  function nm(cls, name, holds, extra) {
    return '<div class="' + cls + ' o-nm" style="' + fitStyle(name, holds) + (extra || '') + '"><span class="o-nm-t">' + esc(name) + '</span></div>';
  }
  // The samurai looks' name plaque (.o-name in objects.css), as index.js draws it.
  function samName(name, holds) {
    var fit = fitStyle(name, holds);
    return '<div class="o-name"' + (fit ? ' style="' + fit + '"' : '') + '><span class="o-name-text">' + esc(name) + '</span></div>';
  }
  function fmt(n) { return Math.max(0, Math.round(Number(n) || 0)).toLocaleString('en-US'); }
  // The look's main text: the streamer's own (d.label), or the look's words.
  function label(d, fallback) { return esc(d && d.label ? d.label : fallback); }

  // An odometer: every digit rolls to its value, the units spin twice, the tens once (.o-odo).
  var STRIP = (function () { var s = ''; for (var i = 0; i < 30; i++) s += '<i>' + (i % 10) + '</i>'; return s; })();
  function odo(text, delay, dur) {
    var chars = Array.from(String(text));
    var digits = chars.filter(function (c) { return c >= '0' && c <= '9'; }).length, seen = 0;
    var out = '<span class="o-odo" style="--odel:' + delay + 's;--odur:' + dur + 's">';
    chars.forEach(function (c) {
      if (c >= '0' && c <= '9') {
        var place = digits - 1 - seen++;
        var spins = place === 0 ? 2 : place === 1 ? 1 : 0;
        out += '<span class="o-odo-d"><span class="o-odo-strip" style="--to:' + (spins * 10 + Number(c)) + '">' + STRIP + '</span></span>';
      } else {
        out += '<span class="o-odo-s">' + esc(c) + '</span>';
      }
    });
    return out + '</span>';
  }
  // Typed text: one span per character, each shown a little after the one before (.o-typed).
  function typed(text, t0, per, max) {
    var chars = Array.from(String(text || ''));
    if (chars.length > max) chars = chars.slice(0, max - 1).concat('…');
    return {
      n: chars.length,
      style: '--t0:' + t0 + 's;--tper:' + per.toFixed(3) + 's;',
      html: chars.map(function (c, i) { return '<span class="o-ch" style="--ti:' + i + '">' + esc(c) + '</span>'; }).join(''),
    };
  }
  // Deterministic randomness for a look's details (never Math.random in render: the overlay and
  // the builder preview must draw the same picture).
  function hash(s) {
    var h = 2166136261 >>> 0, chars = Array.from(String(s));
    for (var i = 0; i < chars.length; i++) { h ^= chars[i].codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function code3(name) {
    var letters = Array.from(String(name || '')).filter(function (c) { return /[\p{L}\p{N}]/u.test(c); });
    return (letters.slice(0, 3).join('') || 'NEW').toUpperCase();
  }
  function intOf(v) { return Math.max(0, parseInt(v, 10) || 0); }

  // ── Colour ────────────────────────────────────────────────────────────
  var HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;
  function rgbOf(hex) { var v = parseInt(hex.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
  // Dark or white text on a colour, whichever reads better.
  function onColour(hex) {
    var c = rgbOf(hex).map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.179 ? '#0B0B12' : '#FFFFFF';
  }
  function mix(rgb, to, t) { return rgb.map(function (c, i) { return Math.round(c + (to[i] - c) * t); }); }
  function toHex(rgb) { return '#' + rgb.map(function (c) { return ('0' + c.toString(16).toUpperCase()).slice(-2); }).join(''); }
  var WHITE = [255, 255, 255], BLACK = [0, 0, 0], MUTED = [242, 230, 230];
  // The variables a slot carries for a streamer's colour: the colour, its numbers, the text colour
  // that reads on it, and shades worked out from it. Today's samurai looks read every shade with
  // today's red as the fallback (objects.css), so a slot without these looks exactly as it did.
  function accentVars(value) {
    if (typeof value !== 'string' || !HEX_COLOUR.test(value)) return '';
    var base = value.toUpperCase(), c = rgbOf(base);
    return '--a:' + base + ';--a-rgb:' + c.join(',') + ';--a-on:' + onColour(base)
      + ';--a-hi:' + toHex(mix(c, WHITE, 0.18)) + ';--a-lo:' + toHex(mix(c, BLACK, 0.2))
      + ';--a-deep:' + toHex(mix(c, BLACK, 0.45)) + ';--a-night:' + toHex(mix(c, BLACK, 0.72))
      + ';--a-ink:' + toHex(mix(c, BLACK, 0.86)) + ';--a-soft:' + toHex(mix(c, MUTED, 0.5))
      + ';--a-tint:' + toHex(mix(c, WHITE, 0.38)) + ';';
  }

  // ── What a look is handed ─────────────────────────────────────────────
  // The middle picture ("grows with the amount" off): what a look draws for these, whatever came.
  var MIDDLE = { bits: 500, raid: 42, months: 4, donation: 25 };
  function sizeOf(d, kind) {
    if (d && d.grows === false && Object.prototype.hasOwnProperty.call(MIDDLE, kind)) return MIDDLE[kind];
    var value = !d ? 0 : kind === 'raid' ? d.viewers : kind === 'months' ? d.months : (d.amount != null ? d.amount : d.bits);
    var n = Number(value);
    return isFinite(n) && n > 0 ? n : 0;
  }
  // What a look is handed besides the event, from the alert's saved design. Racing keeps today's
  // columns (its card, accent and name colours, its font and event_label); the other looks read
  // their own (style_label). style_grows 0 is "grows with the amount" off.
  function lookData(look, data, design) {
    var d = {}, k, src = data || {}, s = design || {}, c = (look && look.controls) || {};
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) d[k] = src[k];
    if (c.colour === 'racing') {
      d.label = s.event_label || '';
      d.colours = { bg: s.bg_color, accent: s.accent_color, name: s.username_color || s.text_color, font: s.username_font_family };
    } else if (c.label) {
      d.label = s.style_label || '';
    }
    d.grows = s.style_grows !== 0;
    return d;
  }
  // The CSS variables a look's slot carries: the streamer's colour (with its shades) for a look that
  // takes one, and the speed for a look that takes it (today's five keep 1, objects.css's default).
  function slotVars(look, design) {
    var c = (look && look.controls) || {}, s = design || {}, out = {};
    if (c.colour === 'accent') {
      accentVars(s.style_accent).split(';').forEach(function (pair) {
        var i = pair.indexOf(':');
        if (i > 0) out[pair.slice(0, i)] = pair.slice(i + 1);
      });
    }
    if (c.speed) {
      var n = Number(s.animation_speed);
      out['--spd'] = String(isFinite(n) && n > 0 ? Math.min(2, Math.max(0.5, n)) : 1);
    }
    return out;
  }

  // ── Families and looks ────────────────────────────────────────────────
  var FAMILIES = {};
  // A family: its key, its place in the gallery and the Google Fonts it needs ("Kanit:wght@900").
  // Anything else given (a family's defaults) is kept as it is.
  function registerFamily(def) {
    if (!def || typeof def.key !== 'string' || typeof def.order !== 'number') throw new Error('registerFamily: a key and an order are required');
    var family = {}, k;
    for (k in def) if (Object.prototype.hasOwnProperty.call(def, k)) family[k] = def[k];
    family.fonts = (def.fonts || []).slice();
    FAMILIES[def.key] = family;
  }
  // The CSS names of a family's fonts ("Barlow+Condensed:wght@700" is "Barlow Condensed").
  function fontNames(familyKey) {
    var family = FAMILIES[familyKey];
    return family ? family.fonts.map(function (spec) { return spec.split(':')[0].replace(/\+/g, ' '); }) : [];
  }
  function register(look) {
    if (!look || typeof look.key !== 'string' || ALERTS.indexOf(look.eventType) < 0) {
      throw new Error('register: a key and one of the six alert types are required (' + (look && look.key) + ')');
    }
    if (!FAMILIES[look.family]) throw new Error('register: the family "' + look.family + '" of ' + look.key + ' is not registered');
    if (typeof look.render !== 'function') throw new Error('register: ' + look.key + ' has no render');
    STYLES[look.key] = look;
  }
  // An alert's looks in the gallery's order (by family). The C1 has no family: it is not listed here.
  function looksOf(eventType) {
    return Object.keys(STYLES).map(function (k) { return STYLES[k]; })
      .filter(function (s) { return s.eventType === eventType && s.family && FAMILIES[s.family]; })
      .sort(function (a, b) { return FAMILIES[a.family].order - FAMILIES[b.family].order; });
  }

  // ── The look an alert draws, its effect and its sound ────────────────
  // While an alert's design names no look (overlay_designs.style NULL) it draws its default look:
  // today's object for the five Twitch alerts (index.js: nothing changes until the streamer picks a
  // look), and Racing's Victory lap for the giveaway, improved in place. objectFor() in overlay.js
  // and previewObjectFor() in the builder read this table.
  var DEFAULT_LOOKS = { giveaway_winner: 'giveaway-racing' };
  var SOUNDS = {};
  var SOUND_FAMILIES = {};

  // The screen effect an alert plays with its look ('none', a name from overlay.js, or one of fx.js).
  // Today's five objects with no style and the C1 have none, as before; a look the streamer picked
  // plays the design's effect, 'default' being the look's own. The giveaway's default look plays its
  // saved effect too: what the streamer saved for the old card carries over.
  function effectFor(look, design) {
    if (!look || !look.family) return 'none';
    var chosen = design && design.screen_effect;
    return chosen && chosen !== 'default' ? chosen : (look.fx || 'none');
  }

  // The sound an alert plays after any sound the streamer uploaded (overlay.js plays that first):
  // the design's style_sound when this page knows it ('none' is silence, 'today' the alert's sound
  // from before the styles), else the look's own; today's five objects and the C1 play today's.
  function soundFor(look, design) {
    var key = design && design.style_sound;
    if (key === 'none' || key === 'today' || (typeof key === 'string' && Object.prototype.hasOwnProperty.call(SOUNDS, key))) return key;
    return (look && look.sound) || 'today';
  }

  // ── Sounds ────────────────────────────────────────────────────────────
  var audio = { ctx: null, volume: function () { return 0.8; }, buffer: null };
  // overlay.js hands its AudioContext and its volume (overlayVolume) once; the builder its own.
  function setAudio(ctx, volume) { audio.ctx = ctx || null; audio.buffer = null; if (typeof volume === 'function') audio.volume = volume; }
  // A look's sound, under its family (the builder lists the sounds by family).
  function registerSound(key, family, fn) {
    if (!FAMILIES[family]) throw new Error('registerSound: the family "' + family + '" of ' + key + ' is not registered');
    SOUNDS[key] = fn;
    SOUND_FAMILIES[key] = family;
  }
  // Plays a look's sound; false when there is no such sound or nothing to play it with.
  function playSound(key) {
    var fn = SOUNDS[key];
    if (!fn || !audio.ctx) return false;
    try { fn(); return true; } catch (e) { return false; }
  }
  function level(v) { return Math.max(0.0001, (v || 0.1) * audio.volume()); }
  function envelope(g, t0, v, a, d) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(level(v), t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d); }
  function tone(o) {
    var c = audio.ctx; if (!c) return;
    var t0 = c.currentTime + (o.t || 0), d = o.d || 0.2, osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(o.f, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t0 + d);
    envelope(g, t0, o.v, o.a || 0.005, d); osc.connect(g); g.connect(c.destination); osc.start(t0); osc.stop(t0 + d + 0.05);
  }
  function noise(o) {
    var c = audio.ctx; if (!c) return;
    if (!audio.buffer) {
      audio.buffer = c.createBuffer(1, Math.floor(c.sampleRate * 1.5), c.sampleRate);
      var ch = audio.buffer.getChannelData(0);
      for (var i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    }
    var t0 = c.currentTime + (o.t || 0), d = o.d || 0.2, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = audio.buffer; f.type = o.ft || 'bandpass'; f.frequency.setValueAtTime(o.f || 1000, t0);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t0 + d);
    f.Q.value = o.q || 1; envelope(g, t0, o.v, o.a || 0.005, d);
    src.connect(f); f.connect(g); g.connect(c.destination); src.start(t0); src.stop(t0 + d + 0.05);
  }
  function engine(o) {
    var c = audio.ctx; if (!c) return;
    var t0 = c.currentTime + (o.t || 0), d = o.d || 0.6, ws = c.createWaveShaper(), curve = new Float32Array(256), g = c.createGain();
    for (var i = 0; i < 256; i++) { var x = i * 2 / 256 - 1; curve[i] = (Math.PI + 3.4) * x / (Math.PI + 3.4 * Math.abs(x)); }
    ws.curve = curve;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(level(o.v), t0 + 0.02);
    g.gain.setValueAtTime(level(o.v), t0 + d * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    [1, 0.5].forEach(function (m) {
      var osc = c.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(o.f * m, t0); osc.frequency.exponentialRampToValueAtTime(o.f2 * m, t0 + d * 0.75);
      osc.connect(ws); osc.start(t0); osc.stop(t0 + d);
    });
    ws.connect(g); g.connect(c.destination);
  }

  var KIT = {
    ALERTS: ALERTS, MIDDLE: MIDDLE, styles: STYLES, families: FAMILIES, sounds: SOUNDS, soundFamilies: SOUND_FAMILIES,
    esc: esc, money: money, fitStyle: fitStyle, nm: nm, samName: samName, fmt: fmt, label: label, odo: odo, typed: typed,
    hash: hash, rng: rng, code3: code3, intOf: intOf, rgbOf: rgbOf, onColour: onColour, accentVars: accentVars,
    sizeOf: sizeOf, lookData: lookData, slotVars: slotVars, DEFAULT_LOOKS: DEFAULT_LOOKS, effectFor: effectFor, soundFor: soundFor,
    registerFamily: registerFamily, fontNames: fontNames, register: register, looksOf: looksOf,
    setAudio: setAudio, registerSound: registerSound, playSound: playSound, tone: tone, noise: noise, engine: engine,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
  if (root) root.ATLETA_KIT = KIT;
})(typeof window !== 'undefined' ? window : null);
ATLETA_FILE
````

Change `public/overlay/objects/objects.css`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/public/overlay/objects/objects.css b/public/overlay/objects/objects.css
index e4dcf8b..dce3cf4 100644
--- a/public/overlay/objects/objects.css
+++ b/public/overlay/objects/objects.css
@@ -334,3 +334,20 @@
 .exiting .o-c1 .o-c1-blur{animation:c1BlurIn calc(.84s / var(--spd)) linear both}
 .exiting .o-c1 .o-c1-exsmoke i{animation:c1Puff calc(.9s / var(--spd)) ease-out calc(var(--pd) / var(--spd)) both}
 .exiting .o-c1 .o-c1-rig{animation:c1Leave calc(.74s / var(--spd)) cubic-bezier(.6,0,.85,.35) calc(.1s / var(--spd)) both}
+
+/* ══ Shared by the looks (objects/kit.js) ════════════════════════════════
+   A long name scales down (--fit) and still ends in an ellipsis, like .o-name above. Numbers roll
+   like an odometer (.o-odo); a message can be typed (.o-typed). */
+.o-nm{display:flow-root}
+.o-nm-t{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:.3em 0;margin:-.3em 0}
+.o-odo{display:inline-flex;align-items:flex-start;line-height:1;font-variant-numeric:tabular-nums;vertical-align:top}
+.o-odo-d{display:inline-block;height:1em;overflow:hidden}
+.o-odo-s{display:inline-block;height:1em;line-height:1}
+.o-odo-strip{display:block;transform:translateY(calc(var(--to) * -1em))}
+.o-odo-strip i{display:block;height:1em;line-height:1;font-style:normal;text-align:center}
+.playing .o-odo-strip{animation:odoRoll calc(var(--odur) / var(--spd)) cubic-bezier(.22,.7,.18,1) calc(var(--odel) / var(--spd)) both}
+@keyframes odoRoll{from{transform:translateY(0)}}
+.playing .o-typed .o-ch{animation:chIn .01s linear calc((var(--t0) + var(--ti) * var(--tper)) / var(--spd)) both}
+@keyframes chIn{from{opacity:0}to{opacity:1}}
+/* A look (not today's five) is drawn for 420px; another width scales it (overlay.js sets --zw). */
+.alert-pos.look > .obj{width:420px;zoom:var(--zw,1)}
ATLETA_PATCH
````

- [ ] **Step 4: Run the task's tests, then the whole suite**

````bash
node --test tests/objectKit.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2626 tests on the C1 branch at 040b180 with Task 1).

- [ ] **Step 5: Commit**

````bash
git add public/overlay/objects/kit.js public/overlay/objects/objects.css tests/objectKit.test.js
git commit -m "feat(overlay): the alert kit, what every look shares" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 2: Today's samurai red follows the streamer's colour

The owner decided that every look takes the streamer's colour, today's five samurai looks included (spec 2, 4.4).

- They are drawn in one red and a dozen fixed shades of it. Each shade now reads the matching variable from Task 1, with today's colour as its fallback (`var(--a-hi,#F0343C)`).
- So an alert nobody has restyled looks exactly as it does today, and a picked colour changes the whole look.
- The C1's paint (andre_vilela_'s real car) keeps its own colours.

The change is mechanical, so a one-off script makes it (not committed), and a test pins the result.

**Files:**
- Modify: `public/overlay/objects/objects.css`
- Modify: `tests/overlayObjects.test.js` (test)

**Interfaces:**
- Consumes: The shade names of Task 1's `accentVars()`: `--a --a-rgb --a-on --a-hi --a-lo --a-deep --a-night --a-ink --a-soft --a-tint`.
- Produces: `objects.css`: `.obj{--r-red:var(--a,#D81E26);--r-red-deep:var(--a-lo,#B50000)}`, and every red of the five objects read through those variables.

- [ ] **Step 1: Write the failing tests**

Change `tests/overlayObjects.test.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/tests/overlayObjects.test.js b/tests/overlayObjects.test.js
index 8c45003..3d07d99 100644
--- a/tests/overlayObjects.test.js
+++ b/tests/overlayObjects.test.js
@@ -611,3 +611,33 @@ describe('objects.css — the C1 (donation-c1)', () => {
     assert.ok(need <= room, `the worst case needs ${need}px between the paddings and the board has ${room}px`);
   });
 });
+
+describe("objects.css — today's samurai red is the streamer's colour (alert styles)", () => {
+  const fs = require('node:fs');
+  const path = require('node:path');
+  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'objects', 'objects.css'), 'utf8');
+  // The five objects come before the C1, whose paint is the real car's and stays as it is.
+  const five = css.slice(0, css.indexOf('.o-c1{'));
+
+  test('every red of the five reads a colour variable, with today\'s red as the fallback', () => {
+    const fixed = five
+      .replace(/var\(--[a-z-]+,\s*(#[0-9A-Fa-f]{6}|\d+,\d+,\d+)\)/g, '')
+      .replace('--r-red:#D81E26;', '').replace('--r-red-deep:#B50000;', '');
+    const reds = [...fixed.matchAll(/#([0-9A-Fa-f]{6})\b/g)].map((m) => m[1]).filter((hex) => {
+      const v = parseInt(hex, 16), r = v >> 16, g = (v >> 8) & 255, b = v & 255;
+      return r > 40 && r > 1.6 * g && r > 1.6 * b;
+    });
+    assert.deepEqual([...new Set(reds)], [], 'a red that does not follow the streamer\'s colour');
+    assert.ok(!/rgba\(\s*(216,30,38|255,66,71)\s*,/.test(fixed), 'an rgba() red that does not follow it');
+  });
+
+  test('the red itself is the streamer\'s accent, Ronin red until one is picked', () => {
+    assert.match(css, /\.obj\{--r-red:var\(--a,#D81E26\);--r-red-deep:var\(--a-lo,#B50000\)\}/);
+  });
+
+  test('without a picked colour nothing changes: each shade falls back to the colour that was there', () => {
+    for (const [shade, hex] of [['--a-hi', '#F0343C'], ['--a-deep', '#8E0A10'], ['--a-soft', '#C9636A'], ['--a-tint', '#FF6B6B'], ['--a-night', '#5E070C'], ['--a-ink', '#3A0407']]) {
+      assert.ok(css.includes(`var(${shade},${hex})`), `${shade} falls back to ${hex}`);
+    }
+  });
+});
ATLETA_PATCH
````

- [ ] **Step 2: Run them and see them fail**

````bash
node --test tests/overlayObjects.test.js
````

Expected: FAIL: 3 failing (the new "today's samurai red" tests); 73 pass.

- [ ] **Step 3: Write the code**

Make every red of the five objects read the colour variables, with today's colour as the fallback. The change is mechanical, so run this one-off script (it is not committed); it prints how many of each it replaced:

````bash
node - public/overlay/objects/objects.css <<'ATLETA_SCRIPT'
'use strict';
const fs = require('fs');
const file = process.argv[2];
let css = fs.readFileSync(file, 'utf8');
const SWAPS = [
  ['#F0343C', 'var(--a-hi,#F0343C)'], ['#D8282F', 'var(--a,#D8282F)'], ['#8E0A10', 'var(--a-deep,#8E0A10)'],
  ['#9A0C13', 'var(--a-deep,#9A0C13)'], ['#A50F16', 'var(--a-lo,#A50F16)'], ['#5E070C', 'var(--a-night,#5E070C)'],
  ['#3A0407', 'var(--a-ink,#3A0407)'], ['#C9636A', 'var(--a-soft,#C9636A)'], ['#FF6B6B', 'var(--a-tint,#FF6B6B)'],
  ['#2A0205', 'var(--a-ink,#2A0205)'], ['#36090F', 'var(--a-night,#36090F)'], ['#1A050A', 'var(--a-ink,#1A050A)'],
  ['#20060A', 'var(--a-ink,#20060A)'], ['#34080F', 'var(--a-night,#34080F)'], ['#140408', 'var(--a-ink,#140408)'],
  ['rgba(216,30,38,', 'rgba(var(--a-rgb,216,30,38),'], ['rgba(255,66,71,', 'rgba(var(--a-rgb,255,66,71),'],
];
const counts = {};
for (const [from, to] of SWAPS) { counts[from] = css.split(from).length - 1; css = css.split(from).join(to); }
const OBJ = '.obj{position:relative;will-change:transform,opacity,clip-path;font-family:var(--o-disp)}';
if (!css.includes(OBJ)) throw new Error('the .obj rule has changed: put the line below after it by hand');
css = css.replace(OBJ, OBJ + '\n/* Today\'s red is the streamer\'s colour once they pick one (kit.accentVars sets --a and its shades on the slot). */\n.obj{--r-red:var(--a,#D81E26);--r-red-deep:var(--a-lo,#B50000)}');
fs.writeFileSync(file, css);
console.log(JSON.stringify(counts));
ATLETA_SCRIPT
````

- [ ] **Step 4: Run the task's tests, then the whole suite**

````bash
node --test tests/overlayObjects.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2629 tests on the C1 branch at 040b180 with Tasks 1–2).

- [ ] **Step 5: Commit**

````bash
git add public/overlay/objects/objects.css tests/overlayObjects.test.js
git commit -m "feat(overlay): today's samurai red follows the streamer's colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 3: The Samurai family: today's five as presets, and the omikuji

The owner named today's looks `follow-samurai` … `raid-samurai` (spec 2). They register as looks of the Samurai
family and point at today's objects in `index.js`, so nothing is copied and nothing about them changes:

- today's sound and no screen effect;
- their own speed (`controls.speed: false`);
- their own width behaviour (`preset: true`);
- their colour is the accent (Task 2).

The family's giveaway is the omikuji (`giveaway-samurai`), moved from the proposal with its reds reading the accent
too. It uses the temple bell, and its styles use content-box sizing (spec 4.5, "Box sizing").

`tests/alertLooks.test.js` is the test every later family is checked by. It carries the checks spec 7 lists under
`tests/overlayObjects.test.js`, in a file of its own so that one stays about the five objects and the C1. It renders
every registered look with small, middle and big data, a long name and hostile text. It also checks each family's
stylesheet:

- every class and keyframe carries the family's prefix;
- animations run only under `.playing` or `.exiting`;
- every time is divided by `--spd`;
- nothing OBS's Chromium lacks is used;
- every keyframe is defined;
- each look's own parts use the accent.

**Files:**
- Create: `public/overlay/objects/styles/samurai.css`
- Create: `public/overlay/objects/styles/samurai.js`
- Create: `tests/alertLooks.test.js` (test)

**Interfaces:**
- Consumes: Task 1 (`register`, `registerFamily`, `registerSound`, `samName`, `label`, `esc`, `tone`, `noise`); `objects/index.js` (`ATLETA_OBJECTS`).
- Produces: - Looks `follow-samurai`, `subscriber-samurai`, `bits-samurai`, `donation-samurai`, `raid-samurai`: `preset: true`, `sound: 'today'`, `fx: 'none'`, `controls: { colour: 'accent', label: false, speed: false }`.
  - Look `giveaway-samurai`: `sound: 'samuraiBell'`, `controls: { colour: 'accent', label: true, speed: true }`.
  - Family `samurai`: order 0, font Noto Serif JP.
  - Sounds `samuraiBlade`, `samuraiTaiko`, `samuraiTaiko3`, `samuraiKoto`, `samuraiBell`.

- [ ] **Step 1: Write the failing tests**

Create `tests/alertLooks.test.js`:

````bash
mkdir -p tests && cat > tests/alertLooks.test.js <<'ATLETA_FILE'
'use strict';

// Every look in public/overlay/objects/styles/ (docs/superpowers/specs/2026-10-15-alert-styles-design.md):
// it renders every sample without throwing and escapes what a viewer or the streamer typed, and its
// family's stylesheet follows the rules the OBS overlay needs. A new family is checked by adding its
// file and its prefixes (PREFIXES below).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OBJECTS_DIR = path.join(__dirname, '..', 'public', 'overlay', 'objects');
const STYLES_DIR = path.join(OBJECTS_DIR, 'styles');
const K = require(path.join(OBJECTS_DIR, 'kit.js'));
const FILES = fs.readdirSync(STYLES_DIR).sort();
FILES.filter((f) => f.endsWith('.js')).forEach((f) => require(path.join(STYLES_DIR, f)));
const OBJECTS_CSS = fs.readFileSync(path.join(OBJECTS_DIR, 'objects.css'), 'utf8');

// Each family's class and keyframe prefixes. Today's five keep their names (objects.css).
const PREFIXES = {
  samurai: { classes: ['o-omi'], keyframes: ['omi', 'exOmi'] },
};
// Classes a look may use from objects.css (shared parts and the samurai name plaque).
const SHARED = new Set(['obj', 'playing', 'exiting', 'alert-pos', 'look', 'o-nm', 'o-nm-t', 'o-odo', 'o-odo-d', 'o-odo-s', 'o-odo-strip',
  'o-typed', 'o-ch', 'o-name', 'o-name-text', 'o-meta', 'o-mesh']);

const LONG = 'TheLateBrakingLegend_2026';
const HOSTILE = '<img src=x onerror=alert(1)>"\'&';
const SAMPLES = {
  follow: [{}, {}, {}],
  subscription: [{ tier: '1', months: 1 }, { tier: '2', months: 4 }, { tier: '3', months: 27 }],
  bits: [{ amount: 50 }, { amount: 500 }, { amount: 10000 }],
  donation: [{ amount: '2.50', currency: 'EUR', message: '' }, { amount: '25.00', currency: 'EUR', message: 'Box box!' },
    { amount: '250.00', currency: 'EUR', message: 'Box box! New tyres for the whole season, and a coffee for the pit wall too. Send it!' }],
  raid: [{ viewers: 6 }, { viewers: 42 }, { viewers: 850 }],
  giveaway_winner: [{ prize: '' }, { prize: 'Season pass' }, { prize: 'A very long prize name that goes on and on' }],
};

const looks = K.ALERTS.flatMap((alert) => K.looksOf(alert));

// Splits CSS text on a separator outside brackets ("a calc(b / c), d" on ',' is two parts).
function splitTop(text, separator) {
  const parts = [];
  let depth = 0, current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === separator && depth === 0) { if (current.trim()) parts.push(current.trim()); current = ''; } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

describe('every look', () => {
  test('is registered for the six alerts, with its timing and its defaults', () => {
    assert.ok(looks.length > 0);
    for (const look of looks) {
      assert.ok(Object.hasOwn(PREFIXES, look.family) || look.preset, `${look.key}: add its family's prefixes to PREFIXES`);
      for (const phase of ['anim', 'exit']) {
        assert.equal(typeof look[phase].dur, 'string', `${look.key}: ${phase}.dur`);
        assert.match(look[phase].dur, /^\d*\.?\d+s$/, `${look.key}: ${phase}.dur like "0.40s"`);
      }
      assert.ok(typeof look.len === 'number' || typeof look.len === 'function', `${look.key}: len`);
      assert.equal(typeof look.sound, 'string', `${look.key}: sound`);
      assert.equal(typeof look.fx, 'string', `${look.key}: fx`);
      assert.ok(look.controls && 'colour' in look.controls, `${look.key}: controls`);
      assert.ok(look.controls.colour, `${look.key}: every look takes the streamer's colour`);
    }
  });

  for (const look of looks) {
    test(`${look.key} renders every sample, and escapes what was typed`, () => {
      for (const sample of SAMPLES[look.eventType]) {
        for (const username of ['ApexAndre', LONG]) {
          for (const grows of [true, false]) {
            const html = look.render(Object.assign({ username, grows }, sample));
            assert.match(html, /^<div class="obj /, `${look.key} starts with its root`);
          }
        }
        const hostile = Object.assign({}, sample, { username: HOSTILE, label: HOSTILE },
          look.eventType === 'donation' ? { message: HOSTILE } : {}, look.eventType === 'giveaway_winner' ? { prize: HOSTILE } : {});
        const html = look.render(hostile);
        assert.ok(!html.includes('<img'), `${look.key}: a name, text, message or prize is escaped`);
      }
    });
  }
});

describe('every family stylesheet', () => {
  for (const file of FILES.filter((f) => f.endsWith('.css'))) {
    const family = file.replace(/\.css$/, '');
    const css = fs.readFileSync(path.join(STYLES_DIR, file), 'utf8');
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

    test(`${file}: its classes and keyframes carry the family's prefixes`, () => {
      const prefixes = PREFIXES[family];
      assert.ok(prefixes, `add ${family} to PREFIXES`);
      const own = (cls) => SHARED.has(cls) || prefixes.classes.some((p) => cls.startsWith(p));
      const selectors = rules.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').match(/[^{}]+(?=\{)/g) || [];
      // Every compound selector (.o-rcb-seg.on) carries one of the family's classes, so a modifier
      // such as .on only ever applies inside the family.
      for (const selector of selectors) {
        for (const compound of selector.split(/[\s>+~,]+/)) {
          const classes = (compound.match(/\.([A-Za-z][\w-]*)/g) || []).map((c) => c.slice(1));
          if (classes.length) assert.ok(classes.some(own), `${file}: ${compound} has no class of its own family`);
        }
      }
      for (const [, name] of rules.matchAll(/@keyframes\s+([\w-]+)/g)) {
        assert.ok(prefixes.keyframes.some((p) => name.startsWith(p)), `${file}: @keyframes ${name}`);
      }
    });

    test(`${file}: animations run under .playing, every time divided by --spd, every keyframe defined`, () => {
      const defined = new Set([...(rules + OBJECTS_CSS).matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
      for (const [, selector, body] of rules.matchAll(/([^{}]+)\{([^{}]*animation:[^{}]*)\}/g)) {
        if (/@keyframes/.test(selector)) continue;
        assert.match(selector.trim(), /^\.(playing|exiting)\b/, `${file}: ${selector.trim()} animates outside .playing/.exiting`);
        const value = body.match(/animation:([^;]+)/)[1];
        for (const part of splitTop(value, ',')) {
          const words = splitTop(part.trim(), ' ');
          assert.ok(defined.has(words[0]), `${file}: @keyframes ${words[0]} is not defined`);
          for (const word of words.slice(1)) {
            if (/^\d*\.?\d+m?s$/.test(word)) assert.fail(`${file}: ${selector.trim()}: ${word} is not divided by var(--spd)`);
            if (word.startsWith('calc(')) assert.ok(word.includes('var(--spd)'), `${file}: ${selector.trim()}: ${word} is not divided by var(--spd)`);
          }
        }
      }
    });

    test(`${file}: nothing OBS's Chromium lacks, and no selector reaching inside a shared part`, () => {
      for (const feature of [':has(', 'color-mix(', '@container', '@property', 'backdrop-filter']) assert.ok(!rules.includes(feature), `${file}: ${feature}`);
      const selectors = rules.match(/[^{}]+(?=\{)/g) || [];
      for (const s of selectors) assert.ok(!/(^|[\s,])\.[\w-]+\s+(i|span|div)\b/.test(s), `${file}: ${s.trim()} reaches inside other parts`);
    });

    test(`${file}: every look takes the streamer's colour on its own parts`, () => {
      // The accent tokens: --a itself and every family token defined from it (--rca:var(--a,…)).
      const tokens = new Set(['a', 'r-red', ...[...rules.matchAll(/--([\w-]+):var\(--a\b/g)].map((m) => m[1])]);
      const usesAccent = (body) => [...body.matchAll(/var\(--([\w-]+)/g)].some((m) => tokens.has(m[1]) || m[1].startsWith('a-'));
      for (const look of looks.filter((l) => l.family === family)) {
        // Today's five are drawn by objects.css; every other look by its family's stylesheet.
        const sheet = look.preset ? OBJECTS_CSS.replace(/\/\*[\s\S]*?\*\//g, '') : rules;
        const html = look.render(Object.assign({ username: 'ApexAndre' }, SAMPLES[look.eventType][1]));
        const own = new Set((html.match(/class="([^"]+)"/g) || []).flatMap((c) => c.slice(7, -1).split(/\s+/)).filter((c) => !SHARED.has(c)));
        const coloured = [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].some(([, selector, body]) => [...own].some((c) => new RegExp('\\.' + c + '(?![\\w-])').test(selector)) && usesAccent(body));
        assert.ok(coloured, `${look.key}: none of its parts use the accent`);
      }
    });
  }
});
ATLETA_FILE
````

- [ ] **Step 2: Run them and see them fail**

````bash
node --test tests/alertLooks.test.js
````

Expected: FAIL: the test file finds no family stylesheet and no look (1 failing).

- [ ] **Step 3: Write the code**

Create `public/overlay/objects/styles/samurai.css`:

````bash
mkdir -p public/overlay/objects/styles && cat > public/overlay/objects/styles/samurai.css <<'ATLETA_FILE'
/* Samurai's looks beyond today's five (their CSS is objects.css): the omikuji, the giveaway.
   Drawn with content-box sizing. Its reds read the streamer's colour, with today's red as the fallback,
   and its paper, wood and gold stay what they are. */
.o-omi,.o-omi *{box-sizing:content-box}
.o-omi{height:144px}
.o-omi-box{position:absolute;left:10px;top:40px;z-index:2;width:66px;height:100px;transform-origin:50% 100%;background:linear-gradient(90deg,var(--a-ink,#120306),var(--a-night,#2A0A10) 30%,var(--a-night,#3A0D14) 50%,var(--a-ink,#1D0509) 80%,var(--a-ink,#0E0204));clip-path:polygon(10px 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%,0 10px);box-shadow:0 12px 26px rgba(0,0,0,.6)}
.o-omi-hole{position:absolute;left:50%;top:3px;width:14px;height:5px;margin-left:-7px;border-radius:3px;background:#000}
.o-omi-band{position:absolute;left:0;right:0;height:9px;background:linear-gradient(var(--a-hi,#F0343C),var(--r-red) 48%,var(--a-deep,#8E0A10))}
.o-omi-band.t{top:12px}
.o-omi-band.b{bottom:10px}
.o-omi-kanji{position:absolute;left:0;right:0;top:24px;bottom:22px;display:flex;align-items:center;justify-content:center;writing-mode:vertical-rl;font-family:"Noto Serif JP",serif;font-weight:700;font-size:14px;letter-spacing:.08em;color:#E9C46A;text-shadow:0 0 8px rgba(233,196,106,.35)}
.o-omi-box .o-mesh{position:absolute;inset:0;background:var(--o-hex);opacity:.35;pointer-events:none}
.o-omi-stick{position:absolute;left:40px;top:14px;z-index:1;width:6px;height:44px;border-radius:2px;transform-origin:50% 100%;transform:rotate(22deg) translateY(-20px);background:linear-gradient(90deg,#C9A66B,#EED9A8 50%,#B88F52)}
.o-omi-stick::before{content:"";position:absolute;left:0;right:0;top:0;height:9px;border-radius:2px 2px 0 0;background:var(--r-red)}
.o-omi-slip{position:absolute;left:92px;right:0;top:34px;height:104px;display:flex;align-items:center;gap:14px;padding:10px 16px 10px 14px;background:linear-gradient(180deg,#FBF4E6,#EFE3CB);box-shadow:0 12px 28px rgba(0,0,0,.6),inset 0 0 0 4px #FBF4E6,inset 0 0 0 5px rgba(var(--a-rgb,216,30,38),.55)}
.o-omi-slip::before{content:"";position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(90deg,rgba(120,90,40,.05) 0 1px,transparent 1px 7px),repeating-linear-gradient(0deg,rgba(120,90,40,.04) 0 1px,transparent 1px 11px)}
.o-omi-stamp{position:relative;flex:none;width:42px;height:72px;display:grid;place-items:center;background:var(--r-red);color:var(--a-on,#FFF6EA);font-family:"Noto Serif JP",serif;font-weight:700;font-size:19px;line-height:1.05;writing-mode:vertical-rl;letter-spacing:.08em;box-shadow:inset 0 0 0 2px rgba(255,255,255,.25);transform:rotate(-3deg)}
.o-omi-txt{position:relative;flex:1;min-width:0}
.o-omi-mark{font-family:var(--o-cond);font-weight:700;font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:var(--a-deep,#D81E26);margin-bottom:6px}
.o-omi .o-name{color:#1A0609;font-size:calc(23px * var(--fit,1))}
.o-omi .o-meta{color:var(--a-deep,#8E0A10);margin-top:7px;letter-spacing:.14em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@keyframes omiDrive{from{transform:translateY(-150%)}to{transform:none}}
@keyframes omiShake{0%{transform:none}22%{transform:rotate(-11deg)}48%{transform:rotate(9deg)}72%{transform:rotate(-4deg)}100%{transform:none}}
@keyframes omiStick{from{transform:rotate(22deg) translateY(14px);opacity:0}to{transform:rotate(22deg) translateY(-20px);opacity:1}}
@keyframes omiUnroll{from{clip-path:inset(-50px 100% -50px 0)}to{clip-path:inset(-50px -50px -50px 0)}}
@keyframes omiStamp{0%{transform:scale(1.9) rotate(-10deg);opacity:0}60%{transform:scale(.94) rotate(-2deg);opacity:1}100%{transform:rotate(-3deg);opacity:1}}
@keyframes exOmi{to{clip-path:inset(-30% 100% -30% -30%)}}
.playing .o-omi-box{animation:omiDrive calc(.22s / var(--spd)) cubic-bezier(.4,0,.2,1) both,omiShake calc(.4s / var(--spd)) cubic-bezier(.3,0,.3,1) calc(.3s / var(--spd))}
.playing .o-omi-stick{animation:omiStick calc(.14s / var(--spd)) cubic-bezier(.2,.9,.2,1) calc(.74s / var(--spd)) both}
.playing .o-omi-slip{animation:omiUnroll calc(.4s / var(--spd)) cubic-bezier(.3,0,.16,1) calc(.86s / var(--spd)) both}
.playing .o-omi-stamp{animation:omiStamp calc(.22s / var(--spd)) cubic-bezier(.3,0,.2,1) calc(1.2s / var(--spd)) both}
.playing .o-omi-mark{animation:struck calc(.24s / var(--spd)) ease-out calc(1.28s / var(--spd)) both}
.playing .o-omi .o-name{animation:struck calc(.24s / var(--spd)) ease-out calc(1.35s / var(--spd)) both}
.playing .o-omi .o-meta{animation:struck calc(.24s / var(--spd)) ease-out calc(1.42s / var(--spd)) both}
ATLETA_FILE
````

Create `public/overlay/objects/styles/samurai.js`:

````bash
mkdir -p public/overlay/objects/styles && cat > public/overlay/objects/styles/samurai.js <<'ATLETA_FILE'
'use strict';

/**
 * Samurai (docs/superpowers/specs/2026-10-15-alert-styles-design.md): today's five looks under the
 * names the owner gave them, and the omikuji, the family's giveaway. The presets point at the
 * objects in index.js (nothing is copied), so the five keep their own code and their own CSS
 * (objects.css), which reads the streamer's colour with today's red as the fallback.
 */
(function (root) {
  var K = (root && root.ATLETA_KIT) || require('../kit.js');
  var OBJECTS = (root && root.ATLETA_OBJECTS) || require('../index.js');

  K.registerFamily({ key: 'samurai', order: 0, fonts: ['Noto+Serif+JP:wght@700'] });

  // [event type, style id, seconds until its entrance has finished]
  [
    ['follow', 'follow-samurai', 0.8], ['subscription', 'subscriber-samurai', 1.35], ['bits', 'bits-samurai', 1.1],
    ['donation', 'donation-samurai', 1.2], ['raid', 'raid-samurai', 1.0],
  ].forEach(function (p) {
    var object = OBJECTS[p[0]];
    K.register({
      key: p[1], eventType: p[0], family: 'samurai', preset: true,
      anim: object.anim, exit: object.exit, len: p[2],
      // Today's sound and no screen effect, as today; the streamer can pick others.
      sound: 'today', fx: 'none', grows: false,
      controls: { colour: 'accent', label: false, speed: false },
      render: object.render,
    });
  });

  K.registerSound('samuraiBlade', 'samurai', function () {
    K.noise({ ft: 'highpass', f: 2400, f2: 9000, d: 0.32, v: 0.16, a: 0.01 });
    K.tone({ f: 2900, f2: 3600, d: 0.7, v: 0.035, t: 0.03 });
    K.tone({ f: 5800, d: 0.55, v: 0.015, t: 0.03 });
  });
  K.registerSound('samuraiTaiko', 'samurai', function () {
    K.tone({ f: 95, f2: 48, d: 0.5, v: 0.55, a: 0.003 });
    K.noise({ ft: 'lowpass', f: 500, d: 0.09, v: 0.25 });
  });
  K.registerSound('samuraiTaiko3', 'samurai', function () {
    [0, 0.2, 0.55].forEach(function (t, i) {
      K.tone({ f: 95 - i * 8, f2: 46, d: 0.45, v: 0.5, a: 0.003, t: t });
      K.noise({ ft: 'lowpass', f: 480, d: 0.08, v: 0.22, t: t });
    });
  });
  K.registerSound('samuraiKoto', 'samurai', function () {
    [392, 523, 587, 784].forEach(function (f, i) { K.tone({ f: f, d: 0.9, v: 0.09, type: 'triangle', a: 0.002, t: 0.55 + i * 0.1 }); });
  });
  K.registerSound('samuraiBell', 'samurai', function () {
    [[220, 0.28, 3.2], [440, 0.14, 2.6], [661, 0.07, 2], [1100, 0.04, 1.4]].forEach(function (p) { K.tone({ f: p[0], v: p[1], d: p[2], a: 0.004, t: 0.8 }); });
  });

  // The omikuji: the fortune box is shaken twice, a stick strikes out and the slip unrolls with
  // the winner, stamped "great blessing".
  K.register({
    key: 'giveaway-samurai', eventType: 'giveaway_winner', family: 'samurai',
    anim: { in: 'hold', dur: '1.5s', ease: 'linear' },
    exit: { out: 'exOmi', dur: '.36s', ease: 'cubic-bezier(.5,0,.9,.4)' }, len: 1.7,
    sound: 'samuraiBell', fx: 'none', grows: false,
    controls: { colour: 'accent', label: true, speed: true },
    render: function (d) {
      return '<div class="obj o-omi"><div class="o-omi-stick"></div>'
        + '<div class="o-omi-box"><i class="o-omi-hole"></i><div class="o-omi-band t"></div><div class="o-omi-kanji">御神籤</div><div class="o-omi-band b"></div><div class="o-mesh"></div></div>'
        + '<div class="o-omi-slip"><div class="o-omi-stamp">大吉</div><div class="o-omi-txt"><div class="o-omi-mark">' + K.label(d, 'Great blessing · giveaway') + '</div>'
        + K.samName(d.username, 15) + (d.prize ? '<div class="o-meta">Won ' + K.esc(d.prize) + '</div>' : '') + '</div></div></div>';
    },
  });
})(typeof window !== 'undefined' ? window : null);
ATLETA_FILE
````

- [ ] **Step 4: Run the task's tests, then the whole suite**

````bash
node --test tests/alertLooks.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2640 tests on the C1 branch at 040b180 with Tasks 1–3).

- [ ] **Step 5: Commit**

````bash
git add public/overlay/objects/styles/samurai.css public/overlay/objects/styles/samurai.js tests/alertLooks.test.js
git commit -m "feat(overlay): the Samurai family, today's five as presets and the omikuji" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 4: The Racing family, rebuilt as night-race graphics

Racing comes back for all six alerts (spec 2). A headlight streak flies past and leaves a carbon panel. Then each
alert adds one thing: a race number, nitro, a sponsor decal, headlights or a victory lap.

It keeps today's card's settings (spec 4.2). These come from the design and reach the look as `d.colours` and
`d.label`, through `kit.lookData()`:

- the card colour (`bg_color`) and the accent (`accent_color`);
- the name's colour (`username_color`, else `text_color`) and font (`username_font_family`);
- the main text (`event_label`).

Without a saved design it uses the builder's defaults, which are the same as `EVENT_DEFAULTS` (a test keeps the two
in step). From Task 10 on, `giveaway-racing` (the Victory lap) is the giveaway's default look. The stylesheet is the
spec's reference file, unchanged.

**Files:**
- Create: `public/overlay/objects/styles/racing.css`
- Create: `public/overlay/objects/styles/racing.js`
- Modify: `tests/alertLooks.test.js` (test)

**Interfaces:**
- Consumes: Task 1 (helpers, `register`, `registerFamily`, `registerSound`, `tone`, `noise`, `engine`, `sizeOf`, `odo`, `nm`, `rgbOf`, `onColour`).
- Produces: - Looks `follow-racing`, `subscriber-racing`, `bits-racing` (grows), `donation-racing`, `raid-racing` (grows; `len` is a function of the viewers) and `giveaway-racing`. All have `controls: { colour: 'racing', label: true, speed: true }`.
  - Family `racing`: order 1, fonts Kanit and Barlow Condensed, and `defaults` (each alert's EVENT_DEFAULTS colours and label).
  - Sounds `rcFlyby`, `rcNumber`, `rcNitro`, `rcSponsor`, `rcConvoy`, `rcVictory`.

- [ ] **Step 1: Write the failing tests**

Change `tests/alertLooks.test.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/tests/alertLooks.test.js b/tests/alertLooks.test.js
index 3199933..9bb435d 100644
--- a/tests/alertLooks.test.js
+++ b/tests/alertLooks.test.js
@@ -20,6 +20,7 @@ const OBJECTS_CSS = fs.readFileSync(path.join(OBJECTS_DIR, 'objects.css'), 'utf8
 // Each family's class and keyframe prefixes. Today's five keep their names (objects.css).
 const PREFIXES = {
   samurai: { classes: ['o-omi'], keyframes: ['omi', 'exOmi'] },
+  racing: { classes: ['o-rc'], keyframes: ['rc'] },
 };
 // Classes a look may use from objects.css (shared parts and the samurai name plaque).
 const SHARED = new Set(['obj', 'playing', 'exiting', 'alert-pos', 'look', 'o-nm', 'o-nm-t', 'o-odo', 'o-odo-d', 'o-odo-s', 'o-odo-strip',
@@ -149,3 +150,33 @@ describe('every family stylesheet', () => {
     });
   }
 });
+
+describe('Racing keeps today\'s defaults', () => {
+  test('each alert\'s colours and text are EVENT_DEFAULTS\'s', () => {
+    const { EVENT_DEFAULTS } = require('../src/services/overlayDesign');
+    const defaults = K.families.racing.defaults;
+    for (const alert of K.ALERTS) {
+      assert.equal(defaults[alert].bg, EVENT_DEFAULTS[alert].bg_color, `${alert} card`);
+      assert.equal(defaults[alert].accent, EVENT_DEFAULTS[alert].accent_color, `${alert} accent`);
+      assert.equal(defaults[alert].label, EVENT_DEFAULTS[alert].event_label, `${alert} text`);
+    }
+  });
+
+  test('a saved design\'s colours and font reach the look; anything else falls back', () => {
+    const look = K.styles['follow-racing'];
+    const html = look.render({ username: 'A', colours: { bg: '#123456', accent: '#ABCDEF', name: '#FEDCBA', font: 'Bangers' } });
+    assert.match(html, /--rc-bg:#123456;/);
+    assert.match(html, /--rc-a:#ABCDEF;/);
+    assert.match(html, /--rc-ink:#FEDCBA;/);
+    assert.match(html, /--rc-font:&quot;Bangers&quot;;/);
+    const odd = look.render({ username: 'A', colours: { bg: 'red', accent: null, font: 'x";}body{' } });
+    assert.match(odd, /--rc-bg:#1a1a3e;--rc-bg2:rgb\(8,8,19\);--rc-a:#8888cc;/);
+    assert.ok(!odd.includes('--rc-font'), 'a font that is not a plain name is left out');
+  });
+
+  test('with "grows with the amount" off, the nitro gauge is the middle one', () => {
+    const lit = (d) => (K.styles['bits-racing'].render(d).match(/o-rcb-seg on/g) || []).length;
+    assert.equal(lit({ username: 'A', amount: 10000, grows: false }), lit({ username: 'A', amount: 500 }));
+    assert.ok(lit({ username: 'A', amount: 10000 }) > lit({ username: 'A', amount: 500 }));
+  });
+});
ATLETA_PATCH
````

- [ ] **Step 2: Run them and see them fail**

````bash
node --test tests/alertLooks.test.js
````

Expected: FAIL: 3 failing (Racing's defaults and its prefixes are not registered yet); 11 pass.

- [ ] **Step 3: Write the code**

Create `public/overlay/objects/styles/racing.css`: it is the spec's reference file, unchanged (the test checks it).

````bash
mkdir -p public/overlay/objects/styles && cp docs/superpowers/specs/assets/2026-10-15-alert-styles/parts/fam/racing.css public/overlay/objects/styles/racing.css
````

Create `public/overlay/objects/styles/racing.js`:

````bash
mkdir -p public/overlay/objects/styles && cat > public/overlay/objects/styles/racing.js <<'ATLETA_FILE'
'use strict';

/**
 * Racing (docs/superpowers/specs/2026-10-15-alert-styles-design.md): today's racing card, rebuilt as
 * night-race motion graphics. A headlight streak flies past and leaves a carbon panel behind it, the
 * text lands with a speed smear, and each alert adds one thing: a race number, nitro, a sponsor
 * decal, headlights, a victory lap. Racing keeps today's settings: the card, accent and name colours,
 * the name's font and the main text come from the alert's saved design (bg_color, accent_color,
 * username_color or else text_color, username_font_family, event_label), which kit.lookData() hands
 * the look as d.colours and d.label. Without a saved design the builder's defaults apply (the
 * family's `defaults`, the same as EVENT_DEFAULTS in src/services/overlayDesign.js: a test keeps the
 * two in step). The giveaway's default look, giveaway-racing, is the Victory lap.
 */
(function (root) {
  var K = (root && root.ATLETA_KIT) || require('../kit.js');

  var DEFAULTS = {
    follow: { bg: '#1a1a3e', accent: '#8888cc', label: 'New Pit Crew Member' },
    subscription: { bg: '#061a10', accent: '#00ff88', label: 'Podium Finish' },
    bits: { bg: '#1c1200', accent: '#f7c948', label: 'Nitro Boost' },
    donation: { bg: '#110022', accent: '#bf00ff', label: 'Sponsor Alert' },
    raid: { bg: '#1c0505', accent: '#ff4444', label: 'Incoming Raid' },
    giveaway_winner: { bg: '#1c1200', accent: '#f59e0b', label: 'Giveaway Winner!' },
  };
  K.registerFamily({
    key: 'racing', order: 1, defaults: DEFAULTS,
    fonts: ['Kanit:ital,wght@0,800;0,900;1,800;1,900', 'Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,700;1,800'],
  });

  var HEX = /^#[0-9a-fA-F]{6}$/;
  function pick(value, fallback) { return typeof value === 'string' && HEX.test(value) ? value : fallback; }
  // The root's colours: the saved design's (d.colours), else the alert's defaults. The font is one of
  // the builder's fonts (letters, digits and spaces only), quoted for CSS.
  function vars(eventType, d) {
    var t = DEFAULTS[eventType], c = (d && d.colours) || {};
    var bg = pick(c.bg, t.bg), accent = pick(c.accent, t.accent), b = K.rgbOf(bg);
    var out = '--rc-bg:' + bg + ';--rc-bg2:rgb(' + b.map(function (x) { return Math.round(x * 0.3); }).join(',') + ');--rc-a:' + accent
      + ';--rc-a-rgb:' + K.rgbOf(accent).join(',') + ';--rc-a-on:' + K.onColour(accent) + ';';
    var ink = pick(c.name, null);
    if (ink) out += '--rc-ink:' + ink + ';';
    if (typeof c.font === 'string' && c.font !== 'System Default' && /^[A-Za-z0-9 ]{1,40}$/.test(c.font)) out += '--rc-font:&quot;' + c.font + '&quot;;';
    return out;
  }
  var LINES = [[18, 90, 0.08], [34, 150, 0.15], [63, 110, 0.11], [81, 170, 0.19]].map(function (l) {
    return '<i style="--y:' + l[0] + '%;--w:' + l[1] + 'px;--ld:' + l[2] + 's"></i>';
  }).join('');
  // What every look shares: the carbon body (and what a look adds inside it), the speed lines,
  // the look's own content, then the streak on top.
  function shell(eventType, cls, d, o) {
    return '<div class="obj o-rc ' + cls + '" style="' + vars(eventType, d) + '"><div class="o-rc-panel"><div class="o-rc-body">'
      + (o.ghost ? '<span class="o-rc-ghost" aria-hidden="true">' + o.ghost + '</span>' : '') + (o.liv === false ? '' : '<i class="o-rc-liv"></i>') + (o.body || '')
      + '<i class="o-rc-sheen"></i></div><div class="o-rc-lines">' + LINES + '</div>' + (o.panel || '') + '</div>'
      + (o.after || '') + '<i class="o-rc-streak"></i></div>';
  }
  function chip(d, eventType) { return '<div class="o-rc-chip">' + K.label(d, DEFAULTS[eventType].label) + '</div>'; }
  var EXIT = { out: 'rcExit', dur: '.36s', ease: 'cubic-bezier(.5,0,.9,.4)' };
  var CONTROLS = { colour: 'racing', label: true, speed: true };
  function hold(dur) { return { in: 'hold', dur: dur, ease: 'linear' }; }

  function whoosh(t, v) {
    var w = v || 0.2;
    K.noise({ ft: 'bandpass', f: 500, f2: 2600, q: 0.8, t: t, d: 0.2, v: w, a: 0.12 });
    K.noise({ ft: 'bandpass', f: 2600, f2: 380, q: 0.8, t: t + 0.2, d: 0.32, v: w * 0.85, a: 0.01 });
  }
  K.registerSound('rcFlyby', 'racing', function () { whoosh(0); K.engine({ f: 110, f2: 300, d: 0.5, v: 0.07 }); });
  K.registerSound('rcNumber', 'racing', function () {
    whoosh(0); K.noise({ ft: 'lowpass', f: 900, t: 0.3, d: 0.08, v: 0.3 });
    K.tone({ f: 1320, d: 0.08, v: 0.05, type: 'square', t: 0.62 }); K.tone({ f: 1760, d: 0.22, v: 0.05, type: 'square', t: 0.7 });
  });
  K.registerSound('rcNitro', 'racing', function () {
    whoosh(0, 0.16);
    for (var i = 0; i < 6; i++) K.tone({ f: 600 + i * 180, d: 0.05, v: 0.04, type: 'square', t: 0.46 + i * 0.08 });
    K.engine({ f: 140, f2: 440, d: 0.6, v: 0.1, t: 0.95 }); K.noise({ ft: 'highpass', f: 1200, f2: 5200, d: 0.5, v: 0.22, t: 0.98, a: 0.02 });
  });
  K.registerSound('rcSponsor', 'racing', function () {
    whoosh(0); K.noise({ ft: 'lowpass', f: 1000, t: 0.32, d: 0.08, v: 0.32 });
    K.tone({ f: 2637, d: 0.3, v: 0.03, t: 0.92 }); K.tone({ f: 3136, d: 0.3, v: 0.025, t: 1.0 });
  });
  K.registerSound('rcConvoy', 'racing', function () {
    [0, 0.12, 0.26, 0.42].forEach(function (t, i) { whoosh(t, 0.16 - i * 0.02); });
    K.engine({ f: 70, f2: 210, d: 0.9, v: 0.08, t: 0.3 });
  });
  K.registerSound('rcVictory', 'racing', function () {
    whoosh(0); K.engine({ f: 90, f2: 360, d: 0.9, v: 0.08, t: 0.45 });
    [784, 988, 1175, 1568].forEach(function (f, i) { K.tone({ f: f, d: i === 3 ? 0.5 : 0.14, v: 0.07, type: 'triangle', t: 1.2 + i * 0.09 }); });
  });

  K.register({
    key: 'follow-racing', eventType: 'follow', family: 'racing', controls: CONTROLS, grows: false,
    sound: 'rcFlyby', fx: 'none', anim: hold('1.1s'), exit: EXIT, len: 1.1,
    render: function (d) {
      var chev = '';
      for (var i = 0; i < 3; i++) chev += '<i style="--ci:' + i + '"></i>';
      return shell('follow', 'o-rcf', d, { ghost: 'FOLLOW', panel: '<div class="o-rc-txt">' + chip(d, 'follow') + K.nm('o-rc-name', d.username, 11) + '</div><div class="o-rcf-chev">' + chev + '</div>' });
    },
  });

  K.register({
    key: 'subscriber-racing', eventType: 'subscription', family: 'racing', controls: CONTROLS, grows: false,
    sound: 'rcNumber', fx: 'checker', anim: hold('1.2s'), exit: EXIT, len: 1.2,
    render: function (d) {
      var months = Math.max(1, K.intOf(d.months)), tier = Math.min(3, Math.max(1, K.intOf(d.tier) || 1));
      return shell('subscription', 'o-rcs', d, {
        panel: '<div class="o-rcs-num"><div class="o-rcs-n">' + K.odo(String(months), 0.34, 0.62) + '</div><div class="o-rcs-cap">' + (months === 1 ? 'month' : 'months') + '</div></div>'
          + '<div class="o-rc-txt">' + chip(d, 'subscription') + K.nm('o-rc-name', d.username, 9) + '<div class="o-rcs-meta">Tier <b>' + tier + '</b> subscriber</div></div>',
      });
    },
  });

  K.register({
    key: 'bits-racing', eventType: 'bits', family: 'racing', controls: CONTROLS, grows: true,
    sound: 'rcNitro', fx: 'speed', anim: hold('1.4s'), exit: EXIT, len: 1.45,
    render: function (d) {
      var amount = K.fmt(K.intOf(d.amount != null ? d.amount : d.bits)), size = K.sizeOf(d, 'bits'), segs = '';
      var lit = Math.max(2, Math.min(10, Math.round(10 * Math.log10(size + 1) / 4)));
      for (var i = 0; i < 10; i++) segs += '<i class="o-rcb-seg' + (i < lit ? ' on" style="--gd:' + (0.46 + i * 0.5 / lit).toFixed(3) + 's' : '') + '"></i>';
      return shell('bits', 'o-rcb', d, {
        panel: '<i class="o-rcb-flame" style="--fl:' + (0.55 + 0.45 * lit / 10).toFixed(2) + '"></i>'
          + '<div class="o-rc-txt">' + chip(d, 'bits') + K.nm('o-rc-name', d.username, 13) + '</div>'
          + '<div class="o-rcb-row"><div class="o-rcb-amt"' + (amount.length > 5 ? ' style="--af:.82"' : '') + '><b class="o-rcb-n">+' + K.odo(amount, 0.42, 0.62) + '</b><span class="o-rcb-u">bits</span></div>'
          + '<div class="o-rcb-gauge">' + segs + '</div></div>',
      });
    },
  });

  K.register({
    key: 'donation-racing', eventType: 'donation', family: 'racing', controls: CONTROLS, grows: false,
    sound: 'rcSponsor', fx: 'confetti', anim: hold('1.2s'), exit: EXIT, len: 1.2,
    render: function (d) {
      return shell('donation', 'o-rcd', d, {
        after: '<div class="o-rcd-in"><div class="o-rcd-row"><div class="o-rcd-decal">' + K.esc(K.money(d.amount, d.currency)) + '</div>' + chip(d, 'donation') + '</div>'
          + K.nm('o-rc-name', d.username, 14) + (d.message ? '<div class="o-rcd-msg">“' + K.esc(d.message) + '”</div>' : '') + '</div>',
      });
    },
  });

  K.register({
    key: 'raid-racing', eventType: 'raid', family: 'racing', controls: CONTROLS, grows: true,
    sound: 'rcConvoy', fx: 'smoke', anim: hold('1.4s'), exit: EXIT,
    len: function (d) { return 0.9 + Math.min(12, K.sizeOf(d, 'raid')) * 0.06; },
    render: function (d) {
      var viewers = K.intOf(d.viewers), n = Math.min(12, K.sizeOf(d, 'raid')), rows = ['', '', ''], order = 0, slots = [], k;
      // The near row fills first; the far rows switch on first, as if the cars were arriving.
      for (k = 0; k < n; k++) slots.push({ r: Math.floor(k / 4), c: k % 4 });
      slots.sort(function (a, b) { return b.r - a.r || a.c - b.c; }).forEach(function (s) {
        rows[s.r] += '<i class="o-rcr-hl" style="left:' + (s.c * 34 + (s.r === 1 ? 17 : 0)) + 'px;--hd:' + (0.5 + order++ * 0.06).toFixed(2) + 's"></i>';
      });
      return shell('raid', 'o-rcr', d, {
        panel: '<div class="o-rc-txt">' + chip(d, 'raid') + K.nm('o-rc-name', d.username, 7)
          + '<div class="o-rcr-count"><b class="o-rcr-n">+' + K.odo(K.fmt(viewers), 0.48, 0.6) + '</b><span class="o-rcr-u">' + (viewers === 1 ? 'driver' : 'drivers') + '</span></div></div>'
          + '<div class="o-rcr-grid"><div class="o-rcr-row" style="top:0;transform:scale(.74);opacity:.8">' + rows[2] + '</div>'
          + '<div class="o-rcr-row" style="top:40px;transform:scale(.87);opacity:.9">' + rows[1] + '</div><div class="o-rcr-row" style="top:82px">' + rows[0] + '</div></div>',
      });
    },
  });

  K.register({
    key: 'giveaway-racing', eventType: 'giveaway_winner', family: 'racing', controls: CONTROLS, grows: false,
    sound: 'rcVictory', fx: 'checker', anim: hold('1.5s'), exit: EXIT, len: 1.5,
    render: function (d) {
      var lap = '<svg class="o-rcg-lap" viewBox="0 0 396 172" preserveAspectRatio="none" aria-hidden="true">'
        + ['o-rcg-trace', 'o-rcg-glow', 'o-rcg-car'].map(function (c) { return '<rect class="' + c + '" x="1.5" y="1.5" width="393" height="169" pathLength="100"/>'; }).join('') + '</svg>';
      return shell('giveaway_winner', 'o-rcg', d, {
        liv: false, body: '<i class="o-rcg-chk"></i><i class="o-rcg-chk b"></i>' + lap,
        panel: '<div class="o-rc-txt">' + chip(d, 'giveaway_winner') + K.nm('o-rc-name', d.username, 11) + (d.prize ? '<div class="o-rcg-prize">Prize · <b>' + K.esc(d.prize) + '</b></div>' : '') + '</div>',
      });
    },
  });
})(typeof window !== 'undefined' ? window : null);
ATLETA_FILE
````

- [ ] **Step 4: Run the task's tests, then the whole suite**

````bash
node --test tests/alertLooks.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2653 tests on the C1 branch at 040b180 with Tasks 1–4).

- [ ] **Step 5: Commit**

````bash
git add public/overlay/objects/styles/racing.css public/overlay/objects/styles/racing.js tests/alertLooks.test.js
git commit -m "feat(overlay): the Racing family, rebuilt as night-race graphics" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 5: The catalogue of looks, for the server

`src/services/alertStyles.js` is what the server knows about the looks (spec 4.1). It reads the registry itself, since
the kit and the family files run in Node. So the list of looks exists once and cannot drift from what the pages
draw, and the spec's "the two lists must match" test becomes a test that the catalogue lists every registered look.

It adds what only the server decides:

- the private looks and their owners (`donation-c1`, for Twitch user 632557806);
- who may save which look;
- each alert's gallery for a streamer;
- a family's six looks, and the default looks;
- the sounds by family, and the families' fonts.

**Files:**
- Create: `src/services/alertStyles.js`
- Create: `tests/alertStyles.test.js` (test)

**Interfaces:**
- Consumes: Task 1 (`ALERTS`, `styles`, `families`, `sounds`, `soundFamilies`, `looksOf`), Tasks 3–4 (the families).
- Produces: `require('src/services/alertStyles')`:
  - `ALERTS`, `PRIVATE_STYLES`
  - `DEFAULT_STYLES`: follow-samurai … raid-samurai, and giveaway-racing
  - `isAlert(type)`, `lookOf(styleId)`
  - `canUseStyle(styleId, eventType, streamer) → boolean` (null is always allowed)
  - `galleryFor(eventType, streamer) → [{ id, family, mine }]`
  - `familyStyles(familyKey) → { eventType: styleId } | null`
  - `familyKeys()`, `lookIds()`
  - `soundKeys()`: `today`, `none` and every registered sound
  - `soundGroups() → [{ family, sounds: [key] }]`
  - `fontsOf(familyKeys) → [Google Fonts spec]`

- [ ] **Step 1: Write the failing tests**

Create `tests/alertStyles.test.js`:

````bash
mkdir -p tests && cat > tests/alertStyles.test.js <<'ATLETA_FILE'
'use strict';

// src/services/alertStyles.js: the looks the server lets a streamer save, read from the registry.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const styles = require('../src/services/alertStyles');
const K = require('../public/overlay/objects/kit.js');

const vilela = { twitch_user_id: '632557806' };
const someone = { twitch_user_id: '123' };

describe('the catalogue', () => {
  test('lists every registered look, once, in family order', () => {
    const ids = styles.lookIds();
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ['follow-samurai', 'giveaway-samurai', 'follow-racing', 'giveaway-racing']) assert.ok(ids.includes(id), id);
    assert.deepEqual(styles.familyKeys().slice(0, 2), ['samurai', 'racing']);
  });

  test('every family draws all six alerts', () => {
    for (const family of styles.familyKeys()) assert.ok(styles.familyStyles(family), family);
  });

  test('the default looks are registered and draw their own alert', () => {
    for (const [alert, id] of Object.entries(styles.DEFAULT_STYLES)) assert.equal(styles.lookOf(id).eventType, alert, id);
  });

  test('every look\'s default sound is one a design may name', () => {
    const sounds = styles.soundKeys();
    for (const id of styles.lookIds()) assert.ok(sounds.includes(styles.lookOf(id).sound), `${id}: ${styles.lookOf(id).sound}`);
  });

  test('every look\'s sound is in a family\'s group, each once', () => {
    const grouped = styles.soundGroups().flatMap((g) => g.sounds);
    assert.equal(new Set(grouped).size, grouped.length);
    assert.deepEqual([...grouped].sort(), styles.soundKeys().filter((k) => k !== 'today' && k !== 'none'));
    assert.deepEqual(styles.soundGroups().map((g) => g.family).slice(0, 2), ['samurai', 'racing']);
    assert.ok(styles.soundGroups()[0].sounds.includes('samuraiBell'));
  });

  test('the fonts of a family, once each', () => {
    assert.deepEqual(styles.fontsOf(['racing', 'racing']), K.families.racing.fonts);
    assert.deepEqual(styles.fontsOf(['nope']), []);
  });
});

describe('who may save which look', () => {
  test('a public look of the alert, or none', () => {
    assert.equal(styles.canUseStyle('follow-racing', 'follow', someone), true);
    assert.equal(styles.canUseStyle(null, 'follow', someone), true);
    assert.equal(styles.canUseStyle(null, 'yt_member', someone), true);
  });

  test('not a look of another alert, an unknown look, or a look for a YouTube alert', () => {
    assert.equal(styles.canUseStyle('bits-racing', 'follow', someone), false);
    assert.equal(styles.canUseStyle('follow-nothing', 'follow', someone), false);
    assert.equal(styles.canUseStyle('follow-racing', 'yt_member', someone), false);
    assert.equal(styles.canUseStyle(42, 'follow', someone), false);
  });

  test('a private look only for its owner, and only for its alert', () => {
    assert.equal(styles.canUseStyle('donation-c1', 'donation', vilela), true);
    assert.equal(styles.canUseStyle('donation-c1', 'donation', someone), false);
    assert.equal(styles.canUseStyle('donation-c1', 'donation', null), false);
    assert.equal(styles.canUseStyle('donation-c1', 'follow', vilela), false);
  });
});

describe('the gallery', () => {
  test('shows the owner\'s private look first, and no one else\'s', () => {
    assert.deepEqual(styles.galleryFor('donation', vilela)[0], { id: 'donation-c1', family: null, mine: true });
    assert.ok(!styles.galleryFor('donation', someone).some((e) => e.id === 'donation-c1'));
    assert.deepEqual(styles.galleryFor('yt_member', someone), []);
  });

  test('a family\'s six looks; nothing for an unknown family', () => {
    assert.deepEqual(styles.familyStyles('racing'), {
      follow: 'follow-racing', subscription: 'subscriber-racing', bits: 'bits-racing',
      donation: 'donation-racing', raid: 'raid-racing', giveaway_winner: 'giveaway-racing',
    });
    assert.equal(styles.familyStyles('nope'), null);
    assert.equal(styles.familyStyles('__proto__'), null);
  });
});
ATLETA_FILE
````

- [ ] **Step 2: Run them and see them fail**

````bash
node --test tests/alertStyles.test.js
````

Expected: FAIL: the test file cannot load the catalogue yet (1 failing).

- [ ] **Step 3: Write the code**

Create `src/services/alertStyles.js`:

````bash
mkdir -p src/services && cat > src/services/alertStyles.js <<'ATLETA_FILE'
'use strict';

// The looks an alert can take, for the server (docs/superpowers/specs/2026-10-15-alert-styles-design.md).
// Read from the registry the OBS overlay and the Overlay Builder draw with (public/overlay/objects/:
// kit.js and the family files, which also run in Node), so the list of looks exists once.

const fs = require('fs');
const path = require('path');

const OBJECTS_DIR = path.join(__dirname, '..', '..', 'public', 'overlay', 'objects');
const KIT = require(path.join(OBJECTS_DIR, 'kit.js'));
fs.readdirSync(path.join(OBJECTS_DIR, 'styles')).filter((f) => f.endsWith('.js')).sort()
  .forEach((f) => require(path.join(OBJECTS_DIR, 'styles', f)));

// Looks made for one streamer, found by their Twitch user id (never a row number). Only they see
// it in the builder, and the save refuses it for anyone else.
const PRIVATE_STYLES = Object.freeze({
  'donation-c1': Object.freeze({ eventType: 'donation', twitchUserId: '632557806' }),
});

// What an alert draws while its design names no look: today's object for the five Twitch alerts,
// Racing's Victory lap for the giveaway (improved in place).
const DEFAULT_STYLES = Object.freeze({
  follow: 'follow-samurai', subscription: 'subscriber-samurai', bits: 'bits-samurai',
  donation: 'donation-samurai', raid: 'raid-samurai', giveaway_winner: 'giveaway-racing',
});

function isAlert(eventType) { return KIT.ALERTS.includes(eventType); }
function lookOf(styleId) { return typeof styleId === 'string' && Object.hasOwn(KIT.styles, styleId) ? KIT.styles[styleId] : null; }

function ownsPrivate(styleId, eventType, streamer) {
  const owner = PRIVATE_STYLES[styleId];
  return !!owner && owner.eventType === eventType && !!streamer && String(streamer.twitch_user_id) === owner.twitchUserId && !!lookOf(styleId);
}

// Whether `styleId` may be saved for `eventType` by `streamer`: null (the default look) always; a
// public look of that alert; or the streamer's own private one.
function canUseStyle(styleId, eventType, streamer) {
  if (styleId === null) return true;
  if (typeof styleId !== 'string' || !isAlert(eventType)) return false;
  if (Object.hasOwn(PRIVATE_STYLES, styleId)) return ownsPrivate(styleId, eventType, streamer);
  return KIT.looksOf(eventType).some((look) => look.key === styleId);
}

// The builder's gallery for one alert: a look made for this streamer first, then every public look
// in family order. Each entry: { id, family, mine }.
function galleryFor(eventType, streamer) {
  if (!isAlert(eventType)) return [];
  const mine = Object.keys(PRIVATE_STYLES).filter((id) => ownsPrivate(id, eventType, streamer)).map((id) => ({ id, family: null, mine: true }));
  return mine.concat(KIT.looksOf(eventType).map((look) => ({ id: look.key, family: look.family, mine: false })));
}

// "Use <family> for all six alerts": the family's look for each alert, or null when the family is
// unknown or does not draw all six.
function familyStyles(familyKey) {
  if (typeof familyKey !== 'string' || !Object.hasOwn(KIT.families, familyKey)) return null;
  const map = {};
  for (const alert of KIT.ALERTS) {
    const look = KIT.looksOf(alert).find((l) => l.family === familyKey);
    if (!look) return null;
    map[alert] = look.key;
  }
  return map;
}

// Families in the gallery's order, every public look id, and the sound keys a design may name
// ('today': the alert's sound before release A; 'none': silent).
function familyKeys() { return Object.keys(KIT.families).sort((a, b) => KIT.families[a].order - KIT.families[b].order); }
function lookIds() { return KIT.ALERTS.flatMap((alert) => KIT.looksOf(alert).map((look) => look.key)); }
function soundKeys() { return ['today', 'none'].concat(Object.keys(KIT.sounds).sort()); }
// The looks' sounds by family, in the gallery's order: [{ family, sounds: [key, …] }].
function soundGroups() {
  return familyKeys().map((family) => ({ family, sounds: Object.keys(KIT.sounds).filter((key) => KIT.soundFamilies[key] === family) }))
    .filter((group) => group.sounds.length);
}
// The Google Fonts specs (for one stylesheet link) of the given families.
function fontsOf(families) {
  return [...new Set(families.flatMap((key) => (KIT.families[key] ? KIT.families[key].fonts : [])))];
}

module.exports = {
  ALERTS: KIT.ALERTS, PRIVATE_STYLES, DEFAULT_STYLES, isAlert, lookOf, canUseStyle, galleryFor, familyStyles, familyKeys, lookIds, soundKeys, soundGroups, fontsOf,
};
ATLETA_FILE
````

- [ ] **Step 4: Run the task's tests, then the whole suite**

````bash
node --test tests/alertStyles.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2664 tests on the C1 branch at 040b180 with Tasks 1–5).

- [ ] **Step 5: Commit**

````bash
git add src/services/alertStyles.js tests/alertStyles.test.js
git commit -m "feat(overlay): the catalogue of looks, read from the registry" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 6: The family files, joined for the OBS overlay and the builder

The server joins the family files into one stylesheet and one script (spec 4.3, "Serving"):
`/overlay/objects/styles.css` and `/overlay/objects/styles.js`.

- They are read once, with a version (a hash of the files).
- The pages ask for that version as `?v=`, so a browser may keep the files for a day and an OBS source never mixes releases.
- Each family's script runs in its own function inside a `try`. A family that throws is left out, and the others still register (spec 6).

The OBS overlay page and the builder load the kit and the joined files in this order: `index.js`, `kit.js`,
`styles.js`, `placement.js`.

**Files:**
- Modify: `src/routes/dashboard.js`
- Modify: `src/routes/overlay.js`
- Create: `src/services/alertStyleBundle.js`
- Modify: `src/views/overlay-builder.ejs`
- Modify: `src/routes/dashboard.test.js` (test)
- Modify: `src/routes/overlay.test.js` (test)
- Create: `src/services/alertStyleBundle.test.js` (test)
- Modify: `tests/overlayPlacement.test.js` (test)
- Modify: `tests/streamerViewsI18n.test.js` (test)

**Interfaces:**
- Consumes: Tasks 1, 3, 4 (the files that are joined).
- Produces: - `require('src/services/alertStyleBundle')`: `bundle() → { css, js, version }`, and `join(cssFiles, jsFiles)` with files given as `[{ name, text }]`.
  - Routes `GET /overlay/objects/styles.css` and `/overlay/objects/styles.js`.
  - The builder's template local `stylesVersion`.

- [ ] **Step 1: Write the failing tests**

Change `src/routes/dashboard.test.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/src/routes/dashboard.test.js b/src/routes/dashboard.test.js
index 7e8bd6c..a960bef 100644
--- a/src/routes/dashboard.test.js
+++ b/src/routes/dashboard.test.js
@@ -2724,6 +2724,18 @@ describe('the overlay builder page and a slow Twitch', () => {
     }
   });
 
+  test('loads the alert looks the OBS overlay loads: the kit and the joined family files, at their version', async () => {
+    const { bundle } = require('../services/alertStyleBundle');
+    const { locals } = (await builder()).json();
+    assert.equal(locals.stylesVersion, bundle().version);
+    const page = (await request('GET', '/dashboard/overlay-builder', { streamer: id })).text;
+    const order = ['/overlay/objects/index.js', '/overlay/objects/kit.js', `/overlay/objects/styles.js?v=${bundle().version}`, '/overlay/placement.js']
+      .map((src) => page.indexOf(`<script src="${src}"></script>`));
+    assert.ok(order.every((i) => i > 0), JSON.stringify(order));
+    assert.deepEqual([...order].sort((a, b) => a - b), order, 'in that order');
+    assert.ok(page.includes(`<link rel="stylesheet" href="/overlay/objects/styles.css?v=${bundle().version}">`));
+  });
+
   test('a "</script>" in nothing the page is given can end its inline script (the default table is escaped like the rest)', async () => {
     const page = await request('GET', '/dashboard/overlay-builder', { streamer: id });
     const defaultsLine = page.text.split('\n').find((line) => line.startsWith('const EVENT_DEFAULTS = '));
ATLETA_PATCH
````

Change `src/routes/overlay.test.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/src/routes/overlay.test.js b/src/routes/overlay.test.js
index ad91c0f..56cef04 100644
--- a/src/routes/overlay.test.js
+++ b/src/routes/overlay.test.js
@@ -35,7 +35,7 @@ function get(urlPath) {
       let text = '';
       res.setEncoding('utf8');
       res.on('data', (chunk) => { text += chunk; });
-      res.on('end', () => resolve({ status: res.statusCode, text }));
+      res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
     }).on('error', reject);
   });
 }
@@ -344,3 +344,30 @@ describe('whether the alert overlay is open in OBS', () => {
     await until(() => !presence.isOpen(id), 'a stream the server ended no longer counts as open');
   });
 });
+
+describe('the alert looks, joined (services/alertStyleBundle.js)', () => {
+  const { bundle } = require('../services/alertStyleBundle');
+
+  test('/overlay/objects/styles.js and styles.css answer the joined family files, kept by the browser for a day', async () => {
+    const js = await get('/overlay/objects/styles.js?v=' + bundle().version);
+    assert.equal(js.status, 200);
+    assert.match(js.headers['content-type'], /^application\/javascript/);
+    assert.equal(js.headers['cache-control'], 'public, max-age=86400');
+    assert.equal(js.text, bundle().js);
+    const css = await get('/overlay/objects/styles.css');
+    assert.equal(css.status, 200);
+    assert.match(css.headers['content-type'], /^text\/css/);
+    assert.equal(css.text, bundle().css);
+  });
+
+  test('the overlay page loads the registry, the kit and the joined looks, in that order, at their version', async () => {
+    const { token } = addStreamer();
+    const { text } = await get(`/overlay/${token}`);
+    const v = bundle().version;
+    const order = ['/overlay/objects/index.js', '/overlay/objects/kit.js', `/overlay/objects/styles.js?v=${v}`, '/overlay/placement.js', '/overlay/overlay.js']
+      .map((src) => text.indexOf(`<script src="${src}"></script>`));
+    assert.ok(order.every((i) => i > 0), JSON.stringify(order));
+    assert.deepEqual([...order].sort((a, b) => a - b), order, 'in that order');
+    assert.ok(text.indexOf(`<link rel="stylesheet" href="/overlay/objects/styles.css?v=${v}">`) > text.indexOf('<link rel="stylesheet" href="/overlay/objects/objects.css">'));
+  });
+});
ATLETA_PATCH
````

Create `src/services/alertStyleBundle.test.js`:

````bash
mkdir -p src/services && cat > src/services/alertStyleBundle.test.js <<'ATLETA_FILE'
'use strict';

// src/services/alertStyleBundle.js: the family files of the alert looks, joined into one script and
// one stylesheet for the OBS overlay and the Overlay Builder.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { bundle, join } = require('./alertStyleBundle');

const OBJECTS_DIR = path.join(__dirname, '..', '..', 'public', 'overlay', 'objects');
const FAMILY_FILES = (extension) => fs.readdirSync(path.join(OBJECTS_DIR, 'styles')).filter((f) => f.endsWith(extension)).sort();

// A page with the registry and the kit, as the overlay and the builder load them before the joined script.
function page() {
  const window = { console: { log() {}, warn() {}, error() {} } };
  window.window = window;
  const context = vm.createContext(window);
  for (const file of ['index.js', 'kit.js']) vm.runInContext(fs.readFileSync(path.join(OBJECTS_DIR, file), 'utf8'), context, { filename: file });
  return context;
}

test('joins every family file in name order, the script and the stylesheet alike', () => {
  const { css, js } = bundle();
  for (const [text, extension] of [[css, '.css'], [js, '.js']]) {
    const names = [...text.matchAll(/── styles\/([\w-]+\.(?:css|js)) ──/g)].map((m) => m[1]);
    assert.deepEqual(names, FAMILY_FILES(extension));
  }
  for (const file of FAMILY_FILES('.css')) assert.ok(css.includes(fs.readFileSync(path.join(OBJECTS_DIR, 'styles', file), 'utf8')), file);
});

test('the joined script registers every look the family files register', () => {
  const context = page();
  vm.runInContext(bundle().js, context, { filename: 'styles.js' });
  const styles = vm.runInContext('Object.keys(window.ATLETA_OBJECT_STYLES)', context);
  for (const id of ['follow-samurai', 'giveaway-samurai', 'follow-racing', 'giveaway-racing', 'donation-c1']) assert.ok(styles.includes(id), id);
});

test('a family that throws while it registers is left out, and the families after it still register', () => {
  const errors = [];
  const context = page();
  context.console = { error: (...args) => errors.push(args.join(' ')) };
  const broken = { name: 'aaa-broken.js', text: "'use strict';\nthrow new Error('boom');" };
  const racing = { name: 'racing.js', text: fs.readFileSync(path.join(OBJECTS_DIR, 'styles', 'racing.js'), 'utf8') };
  vm.runInContext(join([], [broken, racing]).js, context, { filename: 'styles.js' });
  assert.ok(vm.runInContext("'follow-racing' in window.ATLETA_OBJECT_STYLES", context));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /aaa-broken\.js did not load: boom/);
});

test('each family file keeps its own strict mode', () => {
  const sloppy = { name: 'x.js', text: "'use strict';\nwindow.strictHere = (function () { return this === undefined; })();" };
  const context = page();
  vm.runInContext(join([], [sloppy]).js, context);
  assert.equal(vm.runInContext('window.strictHere', context), true);
});

test('the version is twelve hex characters, the same for the same files and different for others', () => {
  const { version } = bundle();
  assert.match(version, /^[0-9a-f]{12}$/);
  assert.equal(bundle().version, version, 'read once and kept');
  const a = join([{ name: 'a.css', text: '.o-a{}' }], []).version;
  assert.notEqual(join([{ name: 'a.css', text: '.o-a{color:red}' }], []).version, a);
  assert.equal(join([{ name: 'a.css', text: '.o-a{}' }], []).version, a);
});
ATLETA_FILE
````

Change `tests/overlayPlacement.test.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/tests/overlayPlacement.test.js b/tests/overlayPlacement.test.js
index 355d611..157c0d8 100644
--- a/tests/overlayPlacement.test.js
+++ b/tests/overlayPlacement.test.js
@@ -130,7 +130,7 @@ describe('the placement module is shared by the overlay and the builder', () =>
 
   test('the OBS overlay page loads it before overlay.js, and the builder page loads it too', () => {
     const route = read('src', 'routes', 'overlay.js');
-    const page = route.match(/<script src="\/overlay\/objects\/index\.js"><\/script>\s*<script src="\/overlay\/placement\.js"><\/script>\s*<script src="\/overlay\/overlay\.js"><\/script>/);
+    const page = route.match(/<script src="\/overlay\/objects\/index\.js"><\/script>[\s\S]*?<script src="\/overlay\/placement\.js"><\/script>\s*<script src="\/overlay\/overlay\.js"><\/script>/);
     assert.ok(page, 'the overlay page loads placement.js between the registry and overlay.js');
     assert.match(read('src', 'views', 'overlay-builder.ejs'), /<script src="\/overlay\/placement\.js"><\/script>/);
   });
ATLETA_PATCH
````

Change `tests/streamerViewsI18n.test.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/tests/streamerViewsI18n.test.js b/tests/streamerViewsI18n.test.js
index 3718e9c..02f98ca 100644
--- a/tests/streamerViewsI18n.test.js
+++ b/tests/streamerViewsI18n.test.js
@@ -188,8 +188,8 @@ const PAGE_LOCALS = {
   ],
   'overlay-builder': [
     { streamer, designs: '[]', sponsors: JSON.stringify([{ id: 1, filename: 'a.png', display_name: 'SponsorName', display_duration: 30, enabled: 1, image_scale: 1 }]),
-      eventDefaults: JSON.stringify(EVENT_DEFAULTS), overlayUrl: 'https://app.test/overlay/tok123', streamThumbnail: 'https://img.test/t.jpg', features: { youtube: true, kick: true } },
-    { streamer, designs: '[]', sponsors: '[]', eventDefaults: JSON.stringify(EVENT_DEFAULTS), overlayUrl: null, streamThumbnail: null, features: { youtube: false } },
+      eventDefaults: JSON.stringify(EVENT_DEFAULTS), stylesVersion: 'abc123def456', overlayUrl: 'https://app.test/overlay/tok123', streamThumbnail: 'https://img.test/t.jpg', features: { youtube: true, kick: true } },
+    { streamer, designs: '[]', sponsors: '[]', eventDefaults: JSON.stringify(EVENT_DEFAULTS), stylesVersion: 'abc123def456', overlayUrl: null, streamThumbnail: null, features: { youtube: false } },
   ],
   'chatbot-config': [
     chatbotPage,
ATLETA_PATCH
````

- [ ] **Step 2: Run them and see them fail**

````bash
node --test src/routes/dashboard.test.js src/routes/overlay.test.js src/services/alertStyleBundle.test.js tests/overlayPlacement.test.js tests/streamerViewsI18n.test.js
````

Expected: FAIL: 2 failing (the bundle test file cannot load the module; the overlay page test finds no kit); 561 pass.

- [ ] **Step 3: Write the code**

Change `src/routes/dashboard.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/src/routes/dashboard.js b/src/routes/dashboard.js
index d9b3913..245e248 100644
--- a/src/routes/dashboard.js
+++ b/src/routes/dashboard.js
@@ -29,6 +29,7 @@ const { sponsorDurationSeconds, sponsorChatIntervalMinutes, sponsorImageScale, m
 const { COMMAND_RESPONSE_MAX, COMMANDS_PER_STREAMER_MAX, COMMAND_ERRORS, parseCommand, singleLine, isUniqueViolation } = require('../services/chatCommands');
 const { testCooldown } = require('../services/testCooldown');
 const { EVENT_DEFAULTS, isBuilderEventType, validateOverlayDesign } = require('../services/overlayDesign');
+const { bundle: alertStyleBundle } = require('../services/alertStyleBundle');
 const { findStreamThumbnail, youtubeLiveStatus } = require('../services/pageLookups');
 const { ANALYSES_PER_DAY, analysisBlockedReason, dailyWindowStart, staleBefore } = require('../services/issueAnalysis');
 const { twitchRowsDue, youtubeRowsDue, backfillInBackground } = require('../services/channelInfoBackfill');
@@ -2680,6 +2681,8 @@ router.get('/overlay-builder', overlayPage, async (req, res) => {
     sponsors: JSON.stringify(sponsors).replace(/</g, '\\u003c'),
     // What each alert starts from (the server's own table, see services/overlayDesign.js)
     eventDefaults: JSON.stringify(EVENT_DEFAULTS).replace(/</g, '\\u003c'),
+    // The joined alert looks' version (services/alertStyleBundle.js), as the OBS overlay asks for them
+    stylesVersion: alertStyleBundle().version,
     overlayUrl,
     streamThumbnail
   });
ATLETA_PATCH
````

Change `src/routes/overlay.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/src/routes/overlay.js b/src/routes/overlay.js
index 68f4609..bc64efb 100644
--- a/src/routes/overlay.js
+++ b/src/routes/overlay.js
@@ -9,6 +9,7 @@ const customSounds = require('../services/customSounds');
 const { buildOverlayConfig } = require('../services/overlayConfig');
 const { accountDisabledChannel } = require('../services/streamerAccess');
 const { setUserContentHeaders } = require('../services/userContentHeaders');
+const { bundle: alertStyles } = require('../services/alertStyleBundle');
 // Event streams are ended when the server shuts down; OBS reconnects to the new one.
 const { holdStream } = require('../httpDrain');
 
@@ -32,6 +33,15 @@ function endStreamWhenAccountDisabled(streamerId, req, res) {
 // while the switch is on).
 const ALERT_TYPES = new Set(['follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner', 'yt_superchat', 'yt_member', 'yt_giftmember']);
 
+// The alert looks' family files, joined (services/alertStyleBundle.js). The pages ask for them at
+// ?v=<version>, which changes when a file does, so a browser may keep them for a day.
+router.get('/objects/styles.css', (req, res) => {
+  res.type('text/css').set('Cache-Control', 'public, max-age=86400').send(alertStyles().css);
+});
+router.get('/objects/styles.js', (req, res) => {
+  res.type('application/javascript').set('Cache-Control', 'public, max-age=86400').send(alertStyles().js);
+});
+
 // SSE endpoint — MUST be before /:token to avoid being caught by the wildcard
 router.get('/events/:token', (req, res) => {
   const streamer = db.getStreamerByOverlayToken(req.params.token);
@@ -313,6 +323,7 @@ router.get('/:token', (req, res) => {
   <link rel="stylesheet" href="/overlay/overlay.css">
   <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oxanium:wght@400;600;700;800&family=Saira+Condensed:wght@400;500;600;700&display=swap">
   <link rel="stylesheet" href="/overlay/objects/objects.css">
+  <link rel="stylesheet" href="/overlay/objects/styles.css?v=${alertStyles().version}">
 </head>
 <body>
   <div id="notification-container"></div>
@@ -322,6 +333,8 @@ router.get('/:token', (req, res) => {
   <audio id="redemption-audio" preload="auto"></audio>
   <script>window.OVERLAY_TOKEN = ${JSON.stringify(streamer.overlay_token)};</script>
   <script src="/overlay/objects/index.js"></script>
+  <script src="/overlay/objects/kit.js"></script>
+  <script src="/overlay/objects/styles.js?v=${alertStyles().version}"></script>
   <script src="/overlay/placement.js"></script>
   <script src="/overlay/overlay.js"></script>
 </body>
ATLETA_PATCH
````

Create `src/services/alertStyleBundle.js`:

````bash
mkdir -p src/services && cat > src/services/alertStyleBundle.js <<'ATLETA_FILE'
'use strict';

// The family files of the alert looks (public/overlay/objects/styles/) joined into one stylesheet and
// one script (docs/superpowers/specs/2026-10-15-alert-styles-design.md, 4.3). routes/overlay.js serves
// them at /overlay/objects/styles.css and /overlay/objects/styles.js, for the OBS overlay and the
// Overlay Builder. The repository keeps one readable file per family and there is no build step: the
// files are read when first asked for and kept for the life of the process. `version` changes when
// any of them does, so the pages ask for ?v=<version> and an open browser source never mixes releases.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STYLES_DIR = path.join(__dirname, '..', '..', 'public', 'overlay', 'objects', 'styles');

function familyFiles(extension) {
  return fs.readdirSync(STYLES_DIR).filter((f) => f.endsWith(extension)).sort()
    .map((name) => ({ name, text: fs.readFileSync(path.join(STYLES_DIR, name), 'utf8') }));
}

// Joins the given files ([{ name, text }]). Each family's script runs in a function of its own, so
// its 'use strict' still applies, inside a try: a family that throws while it registers is left out
// (its looks fall back to the alert's default look) and the families after it still register.
function join(cssFiles, jsFiles) {
  const css = cssFiles.map((f) => `/* ── styles/${f.name} ── */\n${f.text}`).join('\n');
  const js = jsFiles.map((f) => `// ── styles/${f.name} ──\ntry { (function () {\n${f.text}\n})(); } catch (e) { console.error('[Alert styles] ${f.name} did not load: ' + (e && e.message)); }`).join('\n');
  const version = crypto.createHash('sha256').update(css).update('\0').update(js).digest('hex').slice(0, 12);
  return { css, js, version };
}

let joined = null;
// { css, js, version } of the family files, read once.
function bundle() {
  if (!joined) joined = join(familyFiles('.css'), familyFiles('.js'));
  return joined;
}

module.exports = { bundle, join };
ATLETA_FILE
````

Change `src/views/overlay-builder.ejs`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/src/views/overlay-builder.ejs b/src/views/overlay-builder.ejs
index 134bcbe..3e691c3 100644
--- a/src/views/overlay-builder.ejs
+++ b/src/views/overlay-builder.ejs
@@ -14,7 +14,11 @@
   <!-- Alert object registry — shared with the live OBS overlay (public/overlay/overlay.js) -->
   <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oxanium:wght@400;600;700;800&family=Saira+Condensed:wght@400;500;600;700&display=swap">
   <link rel="stylesheet" href="/overlay/objects/objects.css">
+  <link rel="stylesheet" href="/overlay/objects/styles.css?v=<%= stylesVersion %>">
   <script src="/overlay/objects/index.js"></script>
+  <!-- The alert looks: their shared kit and every family, joined (services/alertStyleBundle.js) -->
+  <script src="/overlay/objects/kit.js"></script>
+  <script src="/overlay/objects/styles.js?v=<%= stylesVersion %>"></script>
   <!-- Where an alert sits, read from a saved design: shared with the live OBS overlay -->
   <script src="/overlay/placement.js"></script>
   <style>
ATLETA_PATCH
````

- [ ] **Step 4: Run the task's tests, then the whole suite**

````bash
node --test src/routes/dashboard.test.js src/routes/overlay.test.js src/services/alertStyleBundle.test.js tests/overlayPlacement.test.js tests/streamerViewsI18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2672 tests on the C1 branch at 040b180 with Tasks 1–6).

- [ ] **Step 5: Commit**

````bash
git add src/routes/dashboard.js src/routes/overlay.js src/services/alertStyleBundle.js src/views/overlay-builder.ejs src/routes/dashboard.test.js src/routes/overlay.test.js src/services/alertStyleBundle.test.js tests/overlayPlacement.test.js tests/streamerViewsI18n.test.js
git commit -m "feat(overlay): the family files joined for the OBS overlay and the builder" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 7: A look's settings in the database; another look starts fresh

Four nullable columns hold a look's own settings (spec 4.2): `style_accent`, `style_label`, `style_sound` and
`style_grows`. NULL means the look's own.

- **The migration** sits right after the C1 branch's `style` column, and before its one-time switch-on, which calls `setOverlayDesignStyle()`.
- **A save** writes the four columns, NULL when the save does not carry them.
- **`setOverlayDesignStyle()`** now starts another look from its own settings. The four columns are emptied, the screen effect goes back to `default` (the look's own) and the speed to 1. Where the alert sits, and Racing's colours, stay. Setting the look an alert already has changes nothing.
- **`setOverlayDesignStyles()`** sets several looks at once, all or nothing. It is what "Use <family> for all six alerts" calls.
- **Rows the database writes by itself** now take the alert's own colours from `EVENT_DEFAULTS`, not the follow alert's. These are a Reset that keeps the look, and a family picked for all six. Racing draws with these colours, so a raid would otherwise turn navy and lavender.

One existing test that pinned the old colour fallback is updated.

**Files:**
- Modify: `src/db.js`
- Modify: `src/db.overlayDesigns.test.js` (test)
- Modify: `src/routes/dashboard.test.js` (test)

**Interfaces:**
- Consumes: `EVENT_DEFAULTS` (src/services/overlayDesign.js); the C1 branch's `style` column, `saveOverlayDesign` and `resetOverlayDesign`.
- Produces: `db.setOverlayDesignStyle(streamerId, eventType, style)`, `db.setOverlayDesignStyles(streamerId, { eventType: style })`, and `db.saveOverlayDesign(streamerId, eventType, design)` writing `style_accent`, `style_label`, `style_sound` and `style_grows`.

- [ ] **Step 1: Write the failing tests**

Change `src/db.overlayDesigns.test.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/src/db.overlayDesigns.test.js b/src/db.overlayDesigns.test.js
index c947d20..c6a6a1f 100644
--- a/src/db.overlayDesigns.test.js
+++ b/src/db.overlayDesigns.test.js
@@ -115,7 +115,7 @@ describe('overlay_designs.style', () => {
     const saved = row();
     assert.equal(saved.style, 'donation-c1');
     assert.equal(saved.card_width, 420);
-    assert.equal(saved.bg_color, '#1a1a3e');
+    assert.equal(saved.bg_color, '#110022', 'the donation\'s own card colour');
   });
 
   test('Reset deletes a design without a style, as before, and does nothing when there is none', () => {
@@ -138,6 +138,105 @@ describe('overlay_designs.style', () => {
   });
 });
 
+describe('a look\'s settings: style_accent, style_label, style_sound, style_grows (alert styles)', () => {
+  let db;
+  let sql;
+  let streamer;
+  before(() => {
+    const booted = boot(newFile());
+    db = booted.db;
+    sql = db.db;
+    assert.deepEqual(booted.lines.filter((l) => l.includes('[DB migration]')), [], 'a first boot prints no migration error');
+    streamer = addStreamer(sql);
+  });
+  after(() => sql.close());
+  const row = (eventType = 'follow') => sql.prepare('SELECT * FROM overlay_designs WHERE streamer_id = ? AND event_type = ?').get(streamer, eventType);
+  const forget = () => sql.prepare('DELETE FROM overlay_designs WHERE streamer_id = ?').run(streamer);
+  const LOOK = { style_accent: '#29E0FF', style_label: 'Quest accepted', style_sound: 'rcFlyby', style_grows: 0 };
+  const settings = (r) => Object.fromEntries(Object.keys(LOOK).map((c) => [c, r[c]]));
+  const EMPTY = { style_accent: null, style_label: null, style_sound: null, style_grows: null };
+
+  test('are columns of a fresh database, empty (the look\'s own) on a new row', () => {
+    const cols = sql.pragma('table_info(overlay_designs)').map((c) => c.name);
+    for (const c of Object.keys(LOOK)) assert.ok(cols.includes(c), c);
+    db.saveOverlayDesign(streamer, 'follow', {});
+    assert.deepEqual(settings(row()), EMPTY);
+  });
+
+  test('a second boot on the same file adds nothing and prints no migration error', () => {
+    const file = newFile();
+    boot(file).db.db.close();
+    const again = boot(file);
+    assert.deepEqual(again.lines.filter((l) => /\[DB migration\]|Added style_/.test(l)), []);
+    again.db.db.close();
+  });
+
+  test('a save writes the settings it is given and empties the ones it is not', () => {
+    db.saveOverlayDesign(streamer, 'follow', { ...LOOK, card_width: 500 });
+    assert.deepEqual(settings(row()), LOOK);
+    db.saveOverlayDesign(streamer, 'follow', { card_width: 500 });
+    assert.deepEqual(settings(row()), EMPTY);
+  });
+
+  test('picking another look starts it from its own settings; where the alert sits and its colours stay', () => {
+    db.saveOverlayDesign(streamer, 'follow', { ...LOOK, screen_effect: 'gold', animation_speed: 1.5, card_position: 'bot-left', card_width: 560, bg_color: '#123456' });
+    db.setOverlayDesignStyle(streamer, 'follow', 'follow-racing');
+    const r = row();
+    assert.equal(r.style, 'follow-racing');
+    assert.deepEqual(settings(r), EMPTY);
+    assert.deepEqual([r.screen_effect, r.animation_speed], ['default', 1]);
+    assert.deepEqual([r.card_position, r.card_width, r.bg_color], ['bot-left', 560, '#123456']);
+  });
+
+  test('setting the look the alert already has changes nothing', () => {
+    db.saveOverlayDesign(streamer, 'follow', { ...LOOK, screen_effect: 'gold' });
+    db.setOverlayDesignStyle(streamer, 'follow', 'follow-racing');
+    assert.deepEqual(settings(row()), LOOK);
+    assert.equal(row().screen_effect, 'gold');
+  });
+
+  test('Reset keeps the look and empties its settings', () => {
+    db.saveOverlayDesign(streamer, 'follow', { ...LOOK, screen_effect: 'gold' });
+    db.resetOverlayDesign(streamer, 'follow');
+    assert.equal(row().style, 'follow-racing');
+    assert.deepEqual(settings(row()), EMPTY);
+    assert.equal(row().screen_effect, 'default');
+  });
+
+  test('a row the database writes by itself takes the alert\'s own colours, not the follow alert\'s', () => {
+    forget();
+    db.setOverlayDesignStyle(streamer, 'raid', 'raid-racing');
+    assert.deepEqual([row('raid').bg_color, row('raid').accent_color, row('raid').border_color], ['#1c0505', '#ff4444', '#ff4444']);
+    assert.equal(row('raid').event_label, 'Incoming Raid');
+  });
+
+  test('setOverlayDesignStyles sets every alert it is given, resetting only the rows whose look changed', () => {
+    forget();
+    db.setOverlayDesignStyle(streamer, 'follow', 'follow-racing');
+    db.saveOverlayDesign(streamer, 'follow', { ...LOOK });
+    db.setOverlayDesignStyle(streamer, 'bits', 'bits-samurai');
+    db.saveOverlayDesign(streamer, 'bits', { ...LOOK });
+    db.setOverlayDesignStyles(streamer, { follow: 'follow-racing', bits: 'bits-racing', raid: 'raid-racing' });
+    assert.deepEqual(settings(row('follow')), LOOK, 'follow already had the look: kept');
+    assert.equal(row('bits').style, 'bits-racing');
+    assert.deepEqual(settings(row('bits')), EMPTY, 'bits changed look: started from its own settings');
+    assert.equal(row('raid').style, 'raid-racing', 'a row is made where there was none');
+  });
+
+  test('setOverlayDesignStyles is all or nothing', () => {
+    forget();
+    db.setOverlayDesignStyle(streamer, 'follow', 'follow-samurai');
+    sql.exec("CREATE TEMP TRIGGER no_raid BEFORE UPDATE OF style ON overlay_designs WHEN NEW.event_type = 'raid' BEGIN SELECT RAISE(ABORT, 'boom'); END;");
+    try {
+      assert.throws(() => db.setOverlayDesignStyles(streamer, { follow: 'follow-racing', raid: 'raid-racing' }), /boom/);
+    } finally {
+      sql.exec('DROP TRIGGER no_raid');
+    }
+    assert.equal(row('follow').style, 'follow-samurai');
+    assert.equal(row('raid'), undefined);
+  });
+});
+
 describe('the one-time switch-on of andre_vilela_\'s C1', () => {
   const ANDRE = '632557806';
   const MIGRATION = 'c1_donation_for_andre_vilela';
ATLETA_PATCH
````

Change `src/routes/dashboard.test.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/src/routes/dashboard.test.js b/src/routes/dashboard.test.js
index a960bef..d47623e 100644
--- a/src/routes/dashboard.test.js
+++ b/src/routes/dashboard.test.js
@@ -2370,7 +2370,7 @@ describe('saving an overlay design', () => {
     assert.equal((await save('raid', { bg_color: '#010203' })).status, 200);
     const [row] = stored();
     assert.equal(row.bg_color, '#010203');
-    assert.equal(row.accent_color, '#8888cc');
+    assert.equal(row.accent_color, '#ff4444', 'the raid\'s own accent, not the follow alert\'s');
     assert.equal(row.username_size, 24);
     assert.equal(row.card_position, 'top-center');
   });
ATLETA_PATCH
````

- [ ] **Step 2: Run them and see them fail**

````bash
node --test src/db.overlayDesigns.test.js src/routes/dashboard.test.js
````

Expected: FAIL: 10 failing (the new columns and functions, and the alert's own colours); 367 pass.

- [ ] **Step 3: Write the code**

Change `src/db.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/src/db.js b/src/db.js
index b67a2f4..302ee64 100644
--- a/src/db.js
+++ b/src/db.js
@@ -3239,10 +3239,15 @@ function updateSpotifyTokens(streamerId, accessToken, refreshToken, expiresAt) {
 
 // ─── Overlay Designs ────────────────────────────────────────────
 
-// The label and detail an alert gets when a save does not carry them: the builder's own
-// defaults (services/overlayDesign.js), so there is one copy of them.
-const DEFAULT_OVERLAY_LABELS = Object.fromEntries(Object.entries(EVENT_DEFAULTS)
-  .map(([type, defaults]) => [type, { event_label: defaults.event_label, detail_text: defaults.detail_text }]));
+// The colours, label and detail an alert gets when a save does not carry them: the builder's own
+// defaults (services/overlayDesign.js), so there is one copy of them. A row the database writes by
+// itself (a Reset that keeps the look, one family picked for all six alerts) gets the alert's own
+// colours too, not the follow alert's: Racing draws with them.
+const DEFAULT_OVERLAY_VALUES = Object.fromEntries(Object.entries(EVENT_DEFAULTS)
+  .map(([type, d]) => [type, {
+    event_label: d.event_label, detail_text: d.detail_text,
+    bg_color: d.bg_color, accent_color: d.accent_color, border_color: d.border_color,
+  }]));
 
 // Hot path: called per overlay alert render.
 const _stmtGetOverlayDesign = db.prepare('SELECT * FROM overlay_designs WHERE streamer_id = ? AND event_type = ?');
@@ -3266,11 +3271,11 @@ const OVERLAY_DESIGN_COLUMNS = new Set([
 ]);
 
 function saveOverlayDesign(streamerId, eventType, design) {
-  const defaults = DEFAULT_OVERLAY_LABELS[eventType] || {};
+  const defaults = DEFAULT_OVERLAY_VALUES[eventType] || {};
   const row = {
-    bg_color: design.bg_color || '#1a1a3e',
-    accent_color: design.accent_color || '#8888cc',
-    border_color: design.border_color || '#8888cc',
+    bg_color: design.bg_color || defaults.bg_color || '#1a1a3e',
+    accent_color: design.accent_color || defaults.accent_color || '#8888cc',
+    border_color: design.border_color || defaults.border_color || '#8888cc',
     text_color: design.text_color || '#ffffff',
     font_family: design.font_family || 'System Default',
     username_size: design.username_size != null ? design.username_size : 24,
@@ -3315,6 +3320,12 @@ function saveOverlayDesign(streamerId, eventType, design) {
     shadow_blur: design.shadow_blur != null ? design.shadow_blur : 32,
     shadow_spread: design.shadow_spread != null ? design.shadow_spread : 0,
     shadow_opacity: design.shadow_opacity != null ? design.shadow_opacity : 0.6,
+    // The look's own settings (docs/superpowers/specs/2026-10-15-alert-styles-design.md, 4.2);
+    // NULL is the look's own colour, main text, sound and growing with the amount.
+    style_accent: design.style_accent || null,
+    style_label: design.style_label != null ? design.style_label : null,
+    style_sound: design.style_sound || null,
+    style_grows: design.style_grows != null ? design.style_grows : null,
   };
   // An upsert: on the (streamer_id, event_type) conflict only the columns listed here are
   // written, so the ones the builder does not send (style, design_version) keep their values.
@@ -3342,15 +3353,31 @@ function resetOverlayDesign(streamerId, eventType) {
   else deleteOverlayDesign(streamerId, eventType);
 }
 
-// The style an alert is drawn in (overlay_designs.style; null: its own look). Writes the
-// default design first when the streamer never saved one for this alert, so the row exists.
+// The look an alert is drawn in (overlay_designs.style; null: its default look). Writes the default
+// design first when the streamer never saved one for this alert, so the row exists. Another look
+// starts from its own settings: style_* emptied, the screen effect back to 'default' (the look's
+// own) and the speed to 1. Where the alert sits, and Racing's colours, stay. The look it already
+// has changes nothing.
 function setOverlayDesignStyle(streamerId, eventType, style) {
+  db.transaction(() => changeOverlayDesignStyle(streamerId, eventType, style))();
+}
+
+// Several alerts' looks at once ({ eventType: style }), all or none: "Use <family> for all six
+// alerts" in the builder.
+function setOverlayDesignStyles(streamerId, styles) {
   db.transaction(() => {
-    if (!getOverlayDesign(streamerId, eventType)) saveOverlayDesign(streamerId, eventType, {});
-    db.prepare('UPDATE overlay_designs SET style = ? WHERE streamer_id = ? AND event_type = ?').run(style, streamerId, eventType);
+    for (const [eventType, style] of Object.entries(styles)) changeOverlayDesignStyle(streamerId, eventType, style);
   })();
 }
 
+function changeOverlayDesignStyle(streamerId, eventType, style) {
+  const current = getOverlayDesign(streamerId, eventType);
+  if (!current) saveOverlayDesign(streamerId, eventType, {});
+  else if ((current.style || null) === (style || null)) return;
+  db.prepare(`UPDATE overlay_designs SET style = ?, style_accent = NULL, style_label = NULL, style_sound = NULL, style_grows = NULL,
+    screen_effect = 'default', animation_speed = 1.0 WHERE streamer_id = ? AND event_type = ?`).run(style || null, streamerId, eventType);
+}
+
 function getIracingOverlaySettings(streamerId) {
   return db.prepare('SELECT * FROM iracing_overlay_settings WHERE streamer_id = ?').all(streamerId);
 }
@@ -4005,6 +4032,19 @@ try {
   }
 } catch (e) { _migrationLog('overlay_designs.style', e); }
 
+// Migration: a look's own settings (docs/superpowers/specs/2026-10-15-alert-styles-design.md, 4.2).
+// NULL is the look's own colour, main text, sound and growing with the amount. Before the C1's
+// switch-on below: setOverlayDesignStyle() writes these columns.
+try {
+  const cols = db.pragma('table_info(overlay_designs)').map(c => c.name);
+  for (const [col, type] of [['style_accent', 'TEXT'], ['style_label', 'TEXT'], ['style_sound', 'TEXT'], ['style_grows', 'INTEGER']]) {
+    if (!cols.includes(col)) {
+      db.exec(`ALTER TABLE overlay_designs ADD COLUMN ${col} ${type}`);
+      console.log(`[DB] Added ${col} to overlay_designs`);
+    }
+  }
+} catch (e) { _migrationLog('overlay_designs look settings', e); }
+
 // andre_vilela_ asked for the C1 billboard trailer as his donation alert
 // (docs/superpowers/specs/2026-10-15-vilela-c1-donation-design.md): switched on once. He is
 // found by his Twitch user id, never by a row number; a database without him (CI, a fresh
@@ -5746,6 +5786,7 @@ module.exports = {
   deleteOverlayDesign,
   resetOverlayDesign,
   setOverlayDesignStyle,
+  setOverlayDesignStyles,
   getSponsorImages,
   getEnabledSponsorImages,
   addSponsorImage,
ATLETA_PATCH
````

- [ ] **Step 4: Run the task's tests, then the whole suite**

````bash
node --test src/db.overlayDesigns.test.js src/routes/dashboard.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2681 tests on the C1 branch at 040b180 with Tasks 1–7).

- [ ] **Step 5: Commit**

````bash
git add src/db.js src/db.overlayDesigns.test.js src/routes/dashboard.test.js
git commit -m "feat(db): a look's settings on overlay_designs; another look starts fresh" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 8: What a save may carry: the four look settings

The save's schema (`FIELD_SPECS`, spec 4.2 "Validation") gains the four fields:

- `style_accent` is a `#rrggbb` colour, or a 400 naming the field.
- `style_label` is text cut to 40 characters. It is cut by characters, so an emoji is never split.
- `style_sound` is a sound of the catalogue. One it does not know is left out, so the look's own plays (the owner's ruling when the spec was approved).
- `style_grows` is 0 or 1.

The look itself (`style`) stays out of `FIELD_SPECS`. It travels next to the design, and the route checks it (Task 9).

**Files:**
- Modify: `src/services/overlayDesign.js`
- Modify: `src/services/overlayDesign.test.js` (test)

**Interfaces:**
- Consumes: Task 5 (`soundKeys()`).
- Produces: `FIELD_SPECS.style_accent`, `style_label`, `style_sound` and `style_grows`; a new kind `'sound'` in `normalise()`.

- [ ] **Step 1: Write the failing tests**

Change `src/services/overlayDesign.test.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/src/services/overlayDesign.test.js b/src/services/overlayDesign.test.js
index a9e7260..f84fd21 100644
--- a/src/services/overlayDesign.test.js
+++ b/src/services/overlayDesign.test.js
@@ -570,3 +570,40 @@ describe('a design no builder could have sent is still refused', () => {
     }
   });
 });
+
+describe('a look\'s settings (alert styles)', () => {
+  const LOOK = { style_accent: '#29E0FF', style_label: 'Quest accepted', style_sound: 'rcFlyby', style_grows: 0 };
+  const lookOf = (design) => Object.fromEntries(Object.keys(LOOK).filter((f) => f in design).map((f) => [f, design[f]]));
+
+  test('the colour, the main text, the sound and growing with the amount are kept as sent', () => {
+    assert.deepEqual(lookOf(accepts(LOOK)), LOOK);
+    assert.equal(accepts({ style_grows: 1 }).style_grows, 1);
+  });
+
+  test('missing, null or empty means the look\'s own: left out, so the column stays empty', () => {
+    for (const field of ['style_accent', 'style_sound', 'style_grows']) {
+      for (const value of [undefined, null, '']) assert.equal(field in accepts({ [field]: value }), false, `${field}=${value}`);
+    }
+    assert.equal('style_label' in accepts({ style_label: null }), false);
+    assert.equal(accepts({ style_label: '' }).style_label, '', 'an empty main text is what was typed (the look shows its own words)');
+  });
+
+  test('the main text is cut at 40 characters, by characters', () => {
+    assert.equal(accepts({ style_label: 'x'.repeat(40) }).style_label, 'x'.repeat(40));
+    assert.equal(accepts({ style_label: 'x'.repeat(41) }).style_label, 'x'.repeat(40));
+    assert.equal(accepts({ style_label: '\u{1F3C1}'.repeat(41) }).style_label, '\u{1F3C1}'.repeat(40));
+    rejects({ style_label: 5 }, 'style_label');
+  });
+
+  test('a sound the catalogue does not have is left out, so the look\'s own plays; today\'s and none are sounds', () => {
+    for (const sound of ['today', 'none', 'samuraiBell', 'rcVictory']) assert.equal(accepts({ style_sound: sound }).style_sound, sound, sound);
+    for (const other of ['nope', 'RCFLYBY', '<b>', 'x'.repeat(500)]) assert.equal('style_sound' in accepts({ style_sound: other }), false, other);
+    rejects({ style_sound: 5 }, 'style_sound');
+  });
+
+  test('a colour must be #rrggbb, and growing with the amount 0 or 1', () => {
+    for (const bad of ['red', '#FFF', '#GGGGGG', 12]) rejects({ style_accent: bad }, 'style_accent');
+    for (const bad of ['1', true, [], {}]) rejects({ style_grows: bad }, 'style_grows');
+    assert.equal('style_grows' in accepts({ style_grows: 2 }), false, 'a number that is not a choice is left out');
+  });
+});
ATLETA_PATCH
````

- [ ] **Step 2: Run them and see them fail**

````bash
node --test src/services/overlayDesign.test.js
````

Expected: FAIL: 5 failing (the new fields are dropped); 61 pass.

- [ ] **Step 3: Write the code**

Change `src/services/overlayDesign.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/src/services/overlayDesign.js b/src/services/overlayDesign.js
index c80e11b..dee565b 100644
--- a/src/services/overlayDesign.js
+++ b/src/services/overlayDesign.js
@@ -22,6 +22,9 @@
 // then names the field: not an object, a value of the wrong kind (text where a
 // number goes), or a colour that is not #rrggbb.
 
+// The sounds a look may be given (alert styles): today's, none, and every look's own.
+const { soundKeys } = require('./alertStyles');
+
 const BUILDER_EVENT_TYPES = Object.freeze([
   'follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner',
   'yt_superchat', 'yt_member', 'yt_giftmember', 'timed',
@@ -81,7 +84,7 @@ const font = { kind: 'font' };
 const fontOrNull = { kind: 'font', nullable: true };
 const weight = { kind: 'enum', values: [400, 500, 600, 700, 800] };
 
-// Every field the builder sends. `kind`: hex | font | text | enum | int | number | icon.
+// Every field the builder sends. `kind`: hex | font | text | enum | int | number | icon | sound.
 const FIELD_SPECS = Object.freeze({
   bg_color: hex,
   accent_color: hex,
@@ -129,6 +132,13 @@ const FIELD_SPECS = Object.freeze({
   shadow_opacity: { kind: 'number', min: 0, max: 1 },
   shadow_blur: { kind: 'int', min: 0, max: 80 },
   shadow_spread: { kind: 'int', min: -20, max: 20 },
+  // A look's own settings (docs/superpowers/specs/2026-10-15-alert-styles-design.md, 4.2): left out,
+  // they are the look's own colour, main text, sound and growing with the amount. The look itself
+  // (`style`) is not a field of the design: it travels next to it and the route checks it.
+  style_accent: hexOrNull,
+  style_label: { kind: 'text', max: 40 },
+  style_sound: { kind: 'sound' },
+  style_grows: { kind: 'enum', values: [0, 1] },
 });
 
 const ICON_MAX_CHARACTERS = 8;
@@ -171,6 +181,10 @@ function normalise(spec, value) {
       const inRange = Math.min(spec.max, Math.max(spec.min, wanted));
       return { value: inRange === 0 ? 0 : inRange }; // never -0
     }
+    case 'sound':
+      // A sound this release does not have (one an older or newer page knew) is the look's own.
+      if (typeof value !== 'string') return INVALID;
+      return soundKeys().includes(value) ? { value } : UNSET;
     case 'icon':
       if (typeof value !== 'string') return INVALID;
       return Array.from(value).length <= ICON_MAX_CHARACTERS && !ICON_FORBIDDEN.test(value) ? { value } : UNSET;
ATLETA_PATCH
````

- [ ] **Step 4: Run the task's tests, then the whole suite**

````bash
node --test src/services/overlayDesign.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2686 tests on the C1 branch at 040b180 with Tasks 1–8).

- [ ] **Step 5: Commit**

````bash
git add src/services/overlayDesign.js src/services/overlayDesign.test.js
git commit -m "feat(overlay-builder): a save may carry a look's colour, text, sound and growth" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 9: The save names the look; one family for all six alerts

The builder's save sends the look it shows next to the design (`style`, spec 4.2 "Saving").

- **The route checks it** with `canUseStyle()`. It answers 400 naming `style` for an unknown look, a look of another alert, a look for a YouTube alert, or another streamer's private look.
- **It sets the look first**, so another look starts from its own settings, and then saves the design the builder sent.
- **An empty look** is the alert's default look.
- **A page from before this release** sends no `style` at all, and the stored look stays (the C1 branch's guarantee).

`POST /dashboard/overlay-builder/family` sets a family's look on all six alerts in one transaction, tells the open
overlay once, and answers the six rows. The three routes that push designs to the overlay now share one helper. Two
error texts are added in all seven languages.

**Files:**
- Modify: `src/locales/de.json`
- Modify: `src/locales/en.json`
- Modify: `src/locales/es.json`
- Modify: `src/locales/fr.json`
- Modify: `src/locales/ja.json`
- Modify: `src/locales/pt.json`
- Modify: `src/locales/zh.json`
- Modify: `src/routes/dashboard.js`
- Modify: `src/routes/dashboard.test.js` (test)

**Interfaces:**
- Consumes: Task 5 (`canUseStyle`, `familyStyles`), Task 7 (`setOverlayDesignStyle`, `setOverlayDesignStyles`).
- Produces: - `POST /dashboard/overlay-builder/save`, body `{ eventType, design, style? }`.
  - `POST /dashboard/overlay-builder/family`, body `{ family }`, answering `{ ok: true, designs: { eventType: row } }`.
  - Keys `overlayBuilder.error.style` and `overlayBuilder.error.family`.

- [ ] **Step 1: Write the failing tests**

Change `src/routes/dashboard.test.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/src/routes/dashboard.test.js b/src/routes/dashboard.test.js
index d47623e..3b22bac 100644
--- a/src/routes/dashboard.test.js
+++ b/src/routes/dashboard.test.js
@@ -2671,6 +2671,98 @@ async function until(check, ms = 1500) {
   }
 }
 
+describe('the look an alert is drawn in (alert styles)', () => {
+  const bus = require('../services/overlayBus');
+  let id;
+  beforeEach(() => { id = addStreamer(); });
+  const save = (eventType, style, design = {}, streamer = id) =>
+    request('POST', '/dashboard/overlay-builder/save', { streamer, body: { eventType, design, style } });
+  const family = (name, streamer = id) => request('POST', '/dashboard/overlay-builder/family', { streamer, body: { family: name } });
+  const rowOf = (eventType, streamer = id) => db.getAllOverlayDesigns(streamer).find((d) => d.event_type === eventType);
+  const listen = () => {
+    const pushed = [];
+    const listener = (event) => pushed.push(event);
+    bus.on(`overlay:${id}`, listener);
+    return { pushed, stop: () => bus.off(`overlay:${id}`, listener) };
+  };
+
+  test('a save stores the look it names with the design, and the open overlay is told', async () => {
+    const overlay = listen();
+    try {
+      const res = await save('follow', 'follow-racing', { style_accent: '#29E0FF', card_width: 600 });
+      assert.deepEqual(res.json(), { ok: true });
+    } finally { overlay.stop(); }
+    assert.equal(rowOf('follow').style, 'follow-racing');
+    assert.equal(rowOf('follow').style_accent, '#29E0FF');
+    assert.equal(rowOf('follow').card_width, 600);
+    assert.equal(overlay.pushed.length, 1);
+    assert.equal(overlay.pushed[0].designs.follow.style, 'follow-racing');
+  });
+
+  test('an empty look is the alert\'s default look', async () => {
+    await save('follow', 'follow-racing');
+    assert.equal((await save('follow', '')).status, 200);
+    assert.equal(rowOf('follow').style, null);
+    assert.equal((await save('giveaway_winner', null)).status, 200);
+    assert.equal(rowOf('giveaway_winner').style, null);
+  });
+
+  test('a look the server does not know, one of another alert, or a look for a YouTube alert answers 400 naming it', async () => {
+    for (const [eventType, style] of [['follow', 'follow-nothing'], ['follow', 'bits-racing'], ['yt_member', 'follow-racing'], ['follow', 5], ['follow', '__proto__']]) {
+      const res = await save(eventType, style);
+      assert.equal(res.status, 400, `${eventType} ${style}`);
+      assert.equal(res.json().field, 'style');
+      assert.equal(res.json().error, t('en', 'overlayBuilder.error.style'));
+    }
+    assert.equal(rowOf('follow'), undefined, 'nothing was saved');
+  });
+
+  test('a look made for one streamer is theirs alone', async () => {
+    const vilela = addStreamer({ twitch_user_id: '632557806' });
+    assert.equal((await save('donation', 'donation-c1', {}, vilela)).status, 200);
+    assert.equal(rowOf('donation', vilela).style, 'donation-c1');
+    const res = await save('donation', 'donation-c1');
+    assert.equal(res.status, 400);
+    assert.equal(res.json().field, 'style');
+  });
+
+  test('another look starts from its own settings, then keeps what the builder sent', async () => {
+    await save('follow', 'follow-samurai', { style_accent: '#29E0FF', screen_effect: 'gold', animation_speed: 1.5 });
+    await save('follow', 'follow-racing', { style_label: 'Pit stop', card_width: 520 });
+    const row = rowOf('follow');
+    assert.deepEqual([row.style, row.style_accent, row.style_label, row.screen_effect, row.animation_speed, row.card_width],
+      ['follow-racing', null, 'Pit stop', 'default', 1, 520]);
+  });
+
+  test('"Use a family for all six alerts" sets its look on each, tells the overlay once, and answers the six rows', async () => {
+    await save('follow', 'follow-racing', { style_accent: '#29E0FF' });
+    const overlay = listen();
+    let res;
+    try { res = await family('samurai'); } finally { overlay.stop(); }
+    assert.equal(res.status, 200);
+    const { ok, designs } = res.json();
+    assert.equal(ok, true);
+    assert.deepEqual(Object.keys(designs).sort(), ['bits', 'donation', 'follow', 'giveaway_winner', 'raid', 'subscription']);
+    assert.deepEqual(Object.fromEntries(Object.entries(designs).map(([type, row]) => [type, row.style])), {
+      follow: 'follow-samurai', subscription: 'subscriber-samurai', bits: 'bits-samurai',
+      donation: 'donation-samurai', raid: 'raid-samurai', giveaway_winner: 'giveaway-samurai',
+    });
+    assert.equal(rowOf('follow').style_accent, null, 'the follow changed look: its settings started again');
+    assert.equal(overlay.pushed.length, 1);
+    assert.equal(overlay.pushed[0].designs.raid.style, 'raid-samurai');
+  });
+
+  test('a family the server does not know answers 400 and changes nothing', async () => {
+    for (const name of ['nope', '', undefined, 5, '__proto__']) {
+      const res = await family(name);
+      assert.equal(res.status, 400, String(name));
+      assert.equal(res.json().field, 'family');
+      assert.equal(res.json().error, t('en', 'overlayBuilder.error.family'));
+    }
+    assert.equal(rowOf('follow'), undefined);
+  });
+});
+
 describe('the overlay builder page and a slow Twitch', () => {
   let id;
   beforeEach(() => { id = addStreamer({ twitch_username: 'somestreamer' }); });
ATLETA_PATCH
````

- [ ] **Step 2: Run them and see them fail**

````bash
node --test src/routes/dashboard.test.js
````

Expected: FAIL: 6 failing (no `style` in the save, no family route, no error texts); 357 pass.

- [ ] **Step 3: Write the code**

Change `src/routes/dashboard.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/src/routes/dashboard.js b/src/routes/dashboard.js
index 245e248..f2563a5 100644
--- a/src/routes/dashboard.js
+++ b/src/routes/dashboard.js
@@ -30,6 +30,7 @@ const { COMMAND_RESPONSE_MAX, COMMANDS_PER_STREAMER_MAX, COMMAND_ERRORS, parseCo
 const { testCooldown } = require('../services/testCooldown');
 const { EVENT_DEFAULTS, isBuilderEventType, validateOverlayDesign } = require('../services/overlayDesign');
 const { bundle: alertStyleBundle } = require('../services/alertStyleBundle');
+const { canUseStyle, familyStyles } = require('../services/alertStyles');
 const { findStreamThumbnail, youtubeLiveStatus } = require('../services/pageLookups');
 const { ANALYSES_PER_DAY, analysisBlockedReason, dailyWindowStart, staleBefore } = require('../services/issueAnalysis');
 const { twitchRowsDue, youtubeRowsDue, backfillInBackground } = require('../services/channelInfoBackfill');
@@ -2688,8 +2689,18 @@ router.get('/overlay-builder', overlayPage, async (req, res) => {
   });
 });
 
+// The streamer's designs, sent to their open overlays so a change applies without a reload.
+function pushOverlayDesigns(streamerId) {
+  const designMap = {};
+  db.getAllOverlayDesigns(streamerId).forEach(d => { designMap[d.event_type] = d; });
+  require('../services/overlayBus').emit(`overlay:${streamerId}`, { type: 'config-update', designs: designMap });
+}
+
 // Only what the builder itself can produce is saved (services/overlayDesign.js);
-// anything else is a 400 that names the field.
+// anything else is a 400 that names the field. Next to the design comes the look the builder
+// shows (`style`, alert styles): one that draws this alert, or the streamer's own private one;
+// '' or null is the alert's default look. A page from before the looks sends none, and the
+// stored look stays.
 router.post('/overlay-builder/save', (req, res) => {
   const t = res.locals.t;
   const { eventType, design } = req.body || {};
@@ -2700,33 +2711,41 @@ router.post('/overlay-builder/save', (req, res) => {
   if (!checked.ok) {
     return res.status(400).json({ ok: false, field: checked.field, error: t('overlayBuilder.error.invalidField', { field: checked.field }) });
   }
+  const namesStyle = Object.prototype.hasOwnProperty.call(req.body, 'style');
+  const style = req.body.style === '' ? null : req.body.style;
+  if (namesStyle && !canUseStyle(style, eventType, req.streamer)) {
+    return res.status(400).json({ ok: false, field: 'style', error: t('overlayBuilder.error.style') });
+  }
+  // The look first: another look starts from its own settings, then the design is what the builder sent.
+  if (namesStyle) db.setOverlayDesignStyle(req.streamer.id, eventType, style);
   db.saveOverlayDesign(req.streamer.id, eventType, checked.design);
-
-  // Push updated designs to running overlay so it updates without reconnecting
-  const bus = require('../services/overlayBus');
-  const designs = db.getAllOverlayDesigns(req.streamer.id);
-  const designMap = {};
-  designs.forEach(d => { designMap[d.event_type] = d; });
-  bus.emit(`overlay:${req.streamer.id}`, { type: 'config-update', designs: designMap });
-
+  pushOverlayDesigns(req.streamer.id);
   res.json({ ok: true });
 });
 
+// "Use <family> for all six alerts": the family's look on each of the six alerts, all or none (a
+// row whose look changes starts from the look's own settings), one config-update to the open
+// overlay, and the six rows for the builder.
+router.post('/overlay-builder/family', (req, res) => {
+  const styles = familyStyles(req.body && req.body.family);
+  if (!styles) {
+    return res.status(400).json({ ok: false, field: 'family', error: res.locals.t('overlayBuilder.error.family') });
+  }
+  db.setOverlayDesignStyles(req.streamer.id, styles);
+  pushOverlayDesigns(req.streamer.id);
+  const designs = {};
+  for (const eventType of Object.keys(styles)) designs[eventType] = db.getOverlayDesign(req.streamer.id, eventType);
+  res.json({ ok: true, designs });
+});
+
 router.post('/overlay-builder/reset', (req, res) => {
   const { eventType } = req.body || {};
   if (!isBuilderEventType(eventType)) {
     return res.status(400).json({ ok: false, error: res.locals.t('overlayBuilder.error.eventType') });
   }
-  // Back to the defaults; a style the owner set (andre_vilela_'s C1) is kept
+  // Back to the defaults; the alert's look is kept (its own settings start again)
   db.resetOverlayDesign(req.streamer.id, eventType);
-
-  // Push updated designs to running overlay
-  const bus = require('../services/overlayBus');
-  const designs = db.getAllOverlayDesigns(req.streamer.id);
-  const designMap = {};
-  designs.forEach(d => { designMap[d.event_type] = d; });
-  bus.emit(`overlay:${req.streamer.id}`, { type: 'config-update', designs: designMap });
-
+  pushOverlayDesigns(req.streamer.id);
   res.json({ ok: true });
 });
 
ATLETA_PATCH
````

Add the 2 new texts to all seven locale files, after `overlayBuilder.error.invalidField`:

````bash
node - <<'ATLETA_SCRIPT'
const fs = require('fs');
const add = {
 "en": {
  "overlayBuilder.error.style": "That look cannot be used for this alert.",
  "overlayBuilder.error.family": "That family of looks does not exist."
 },
 "pt": {
  "overlayBuilder.error.style": "Esse estilo não pode ser usado neste alerta.",
  "overlayBuilder.error.family": "Essa família de estilos não existe."
 },
 "es": {
  "overlayBuilder.error.style": "Ese estilo no se puede usar en esta alerta.",
  "overlayBuilder.error.family": "Esa familia de estilos no existe."
 },
 "fr": {
  "overlayBuilder.error.style": "Ce style ne peut pas être utilisé pour cette alerte.",
  "overlayBuilder.error.family": "Cette famille de styles n'existe pas."
 },
 "de": {
  "overlayBuilder.error.style": "Dieser Stil kann für diesen Alert nicht verwendet werden.",
  "overlayBuilder.error.family": "Diese Stil-Familie gibt es nicht."
 },
 "zh": {
  "overlayBuilder.error.style": "此提醒不能使用该样式。",
  "overlayBuilder.error.family": "该样式系列不存在。"
 },
 "ja": {
  "overlayBuilder.error.style": "このアラートにはそのスタイルを使えません。",
  "overlayBuilder.error.family": "そのスタイルのシリーズは存在しません。"
 }
};
const after = "overlayBuilder.error.invalidField";
for (const [lang, texts] of Object.entries(add)) {
  const file = `src/locales/${lang}.json`;
  let lines = fs.readFileSync(file, 'utf8').split('\n');
  const at = lines.findIndex((l) => l.startsWith(`  ${JSON.stringify(after)}: `));
  if (at < 0) throw new Error(`${file}: ${after} not found`);
  lines.splice(at + 1, 0, ...Object.entries(texts).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`));
  fs.writeFileSync(file, lines.join('\n'));
  JSON.parse(fs.readFileSync(file, 'utf8'));   // still valid JSON
}
ATLETA_SCRIPT
````

- [ ] **Step 4: Run the task's tests, then the whole suite**

````bash
node --test src/routes/dashboard.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2693 tests on the C1 branch at 040b180 with Tasks 1–9).

- [ ] **Step 5: Commit**

````bash
git add src/locales/de.json src/locales/en.json src/locales/es.json src/locales/fr.json src/locales/ja.json src/locales/pt.json src/locales/zh.json src/routes/dashboard.js src/routes/dashboard.test.js
git commit -m "feat(overlay-builder): the save names the look; one family for all six alerts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 10: The OBS overlay draws the looks

This task teaches the OBS overlay to draw the looks (spec 4.5).

- **Which look.** `objectFor()` picks the look the design names. If there is none, it picks the alert's default look (the giveaway's Victory lap), and then today's object.
- **The builder picks the same way.** `previewObjectFor()` keeps the same rule. The C1 branch's test runs both, and gains a third registry that includes the kit.
- **What a look receives.** Its data, with its main text and "grows" (`lookData`).
- **What its slot carries.** The streamer's colour with its shades, and the speed (`slotVars`).
- **Width.** A look of the styles is drawn for 420 px and scaled to the saved width (`.alert-pos.look`). Today's objects, the samurai presets among them, and the C1 reflow as before.
- **Timing.** A look stays on screen at least its entrance plus a second, at its speed.
- **Fallback.** A look that throws falls back to the alert's own object, or its legacy card, and the overlay says so once (spec 6).

The legacy card code (`buildBannerContent`) no longer draws objects, and the builder preview gets a giveaway sample.

**Files:**
- Modify: `public/overlay/overlay.js`
- Modify: `src/views/overlay-builder.ejs`
- Modify: `tests/overlayBuilder.test.js` (test)
- Modify: `tests/overlayClient.test.js` (test)

**Interfaces:**
- Consumes: Task 1 (`DEFAULT_LOOKS`, `lookData`, `slotVars`), Tasks 3–4 (the looks), Task 6 (the page loads the kit and styles.js).
- Produces: - In `public/overlay/overlay.js`: `objectFor(type)`, `lookDataFor(look, event)`, `drawAlert(event) → { look, html }`, `applyLookVars(slot, look, design) → speed` and `holdMs(type, look, data, speed)`.
  - In the test harness: `loadOverlay({ objects, styles, kit, designs })` and `overlay.errors`.

- [ ] **Step 1: Write the failing tests**

Change `tests/overlayBuilder.test.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/tests/overlayBuilder.test.js b/tests/overlayBuilder.test.js
index 5b2000e..1555415 100644
--- a/tests/overlayBuilder.test.js
+++ b/tests/overlayBuilder.test.js
@@ -187,9 +187,15 @@ describe("an alert's saved style (andre_vilela_'s C1)", () => {
     const real = { ATLETA_OBJECTS: OBJECTS, ATLETA_OBJECT_STYLES: OBJECTS.STYLES };
     // An alias whose key is not its style id: only the key clause keeps it from drawing the donation.
     const alias = { ATLETA_OBJECTS: OBJECTS, ATLETA_OBJECT_STYLES: { 'donation-alias': { key: 'donation-c1', eventType: 'donation' } } };
+    // The kit and the families, as both pages load them: the giveaway's default look comes from the kit.
+    const KIT = require('../public/overlay/objects/kit.js');
+    require('../public/overlay/objects/styles/samurai.js');
+    require('../public/overlay/objects/styles/racing.js');
+    const looks = { ATLETA_OBJECTS: OBJECTS, ATLETA_OBJECT_STYLES: OBJECTS.STYLES, ATLETA_KIT: KIT };
     const registries = [
       { name: 'real styles', win: real, styleIds: STYLE_IDS },
       { name: 'synthetic styles', win: alias, styleIds: [...STYLE_IDS, 'donation-alias'] },
+      { name: 'the looks with the kit', win: looks, styleIds: [...STYLE_IDS, 'giveaway-racing', 'giveaway-samurai', 'follow-racing', 'bits-racing', 'follow-samurai'] },
     ];
     for (const { name, win, styleIds } of registries) {
       for (const type of TYPES) {
@@ -206,5 +212,9 @@ describe("an alert's saved style (andre_vilela_'s C1)", () => {
     // Not two nulls: both picks give the real C1 for its own style.
     assert.strictEqual(pickPreview(real, 'donation', 'donation-c1'), OBJECTS.STYLES['donation-c1'], 'the preview draws the C1');
     assert.strictEqual(pickOverlay(real, 'donation', 'donation-c1'), OBJECTS.STYLES['donation-c1'], 'the OBS overlay draws the C1');
+    // Not two nulls either: the giveaway with no style is Racing's Victory lap in both.
+    assert.equal(pickPreview(looks, 'giveaway_winner', undefined).key, 'giveaway-racing');
+    assert.equal(pickOverlay(looks, 'giveaway_winner', undefined).key, 'giveaway-racing');
+    assert.equal(pickPreview(looks, 'follow', undefined), OBJECTS.follow, 'the five keep today\'s object');
   });
 });
ATLETA_PATCH
````

Change `tests/overlayClient.test.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/tests/overlayClient.test.js b/tests/overlayClient.test.js
index 1af7376..c0babbc 100644
--- a/tests/overlayClient.test.js
+++ b/tests/overlayClient.test.js
@@ -15,6 +15,9 @@ const vm = require('node:vm');
 const OVERLAY_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'overlay.js'), 'utf8');
 const OBJECTS_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'objects', 'index.js'), 'utf8');
 const PLACEMENT_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'placement.js'), 'utf8');
+const KIT_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'objects', 'kit.js'), 'utf8');
+// The family files joined, as the page loads them from /overlay/objects/styles.js
+const STYLES_JS = require('../src/services/alertStyleBundle').bundle().js;
 
 const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
 
@@ -97,8 +100,10 @@ function makeClock() {
   };
 }
 
-// Loads overlay.js (and, unless told not to, the object registry) into a fresh context.
-function loadOverlay({ objects = true, designs = {} } = {}) {
+// Loads overlay.js (and, unless told not to, the object registry) into a fresh context. `styles` also
+// loads the kit and the joined family files of the alert looks; `kit` the kit alone, as a page whose
+// styles.js did not load.
+function loadOverlay({ objects = true, styles = false, kit = styles, designs = {} } = {}) {
   const clock = makeClock();
   const body = makeElement('body');
   const container = makeElement('div'); container.id = 'notification-container'; body.appendChild(container);
@@ -130,8 +135,9 @@ function loadOverlay({ objects = true, designs = {} } = {}) {
     close() { this.closed = true; }
   }
 
+  const errors = [];
   const sandbox = {
-    console: { log() {}, warn() {}, error() {} },
+    console: { log() {}, warn() {}, error: (...args) => errors.push(args.join(' ')) },
     document: {
       body,
       getElementById: (id) => byId[id] || null,
@@ -152,11 +158,13 @@ function loadOverlay({ objects = true, designs = {} } = {}) {
   sandbox.OVERLAY_TOKEN = 'test-token';
   const context = vm.createContext(sandbox);
   if (objects) vm.runInContext(OBJECTS_JS, context, { filename: 'objects/index.js' });
+  if (kit) vm.runInContext(KIT_JS, context, { filename: 'objects/kit.js' });
+  if (styles) vm.runInContext(STYLES_JS, context, { filename: 'objects/styles.js' });
   vm.runInContext(PLACEMENT_JS, context, { filename: 'placement.js' });
   vm.runInContext(OVERLAY_JS, context, { filename: 'overlay.js' });
 
   const overlay = {
-    clock, container, audio, sandbox, context,
+    clock, container, audio, sandbox, context, errors,
     // Feed the overlay a message as the server's event stream would.
     send(message) { sources[sources.length - 1].onmessage({ data: JSON.stringify(message) }); },
     // Read or call anything the script declared at its top level.
@@ -814,3 +822,133 @@ describe("an alert's saved style picks its object (andre_vilela_'s C1)", () => {
     assert.match(overlay.slots()[0].innerHTML, /class="obj o-don"/);
   });
 });
+
+describe('the look an alert is drawn in (alert styles)', () => {
+  const giveaway = (prize = 'Season pass') => ({ type: 'giveaway_winner', data: { username: 'RacerDan', prize } });
+  const raid = (viewers = 42) => ({ type: 'raid', data: { username: 'GridWalker', viewers } });
+  const bits = (amount) => ({ type: 'bits', data: { username: 'TurboTina', amount } });
+
+  test('an alert nobody has restyled is today\'s object, as before: no speed, no colour, no scaling, whatever an older builder saved', () => {
+    const overlay = loadOverlay({ styles: true, designs: { follow: design({ animation_speed: 1.8, screen_effect: 'confetti', card_width: 630 }) } });
+    overlay.send(follow());
+    const [slot] = overlay.slots();
+    assert.match(slot.innerHTML, /^<div class="obj o-follow/);
+    for (const name of ['--spd', '--a', '--zw']) assert.equal(slot.style.properties[name], undefined, name);
+    assert.ok(!slot.classList.contains('look'));
+    assert.equal(slot.style.width, '630px', 'it reflows to its width, as before');
+  });
+
+  test('the giveaway with no look is Racing\'s Victory lap, in the colours and text saved for the old card', () => {
+    const overlay = loadOverlay({ styles: true, designs: { giveaway_winner: design({ bg_color: '#123456', accent_color: '#abcdef', event_label: 'And the winner is' }) } });
+    overlay.send(giveaway());
+    const [slot] = overlay.slots();
+    assert.match(slot.innerHTML, /^<div class="obj o-rc o-rcg" style="--rc-bg:#123456;/);
+    assert.ok(slot.innerHTML.includes('--rc-a:#abcdef;'));
+    assert.ok(slot.innerHTML.includes('>And the winner is<'));
+    assert.ok(slot.classList.contains('playing'));
+  });
+
+  test('with no saved design at all the giveaway is the Victory lap in its own colours', () => {
+    const overlay = loadOverlay({ styles: true });
+    overlay.send(giveaway());
+    assert.match(overlay.slots()[0].innerHTML, /--rc-bg:#1c1200;[^"]*--rc-a:#f59e0b;/);
+  });
+
+  test('a picked look carries the streamer\'s colour with its shades, and its speed when it takes one', () => {
+    const overlay = loadOverlay({ styles: true, designs: {
+      follow: design({ style: 'follow-samurai', style_accent: '#29E0FF', animation_speed: 1.8 }),
+      giveaway_winner: design({ style: 'giveaway-samurai', style_accent: '#29E0FF', style_label: 'Lucky draw', animation_speed: 1.5 }),
+    } });
+    overlay.send(follow());
+    const [preset] = overlay.slots();
+    assert.equal(preset.style.properties['--a'], '#29E0FF');
+    assert.equal(preset.style.properties['--a-hi'], '#50E6FF');
+    assert.equal(preset.style.properties['--a-on'], '#0B0B12');
+    assert.equal(preset.style.properties['--spd'], undefined, 'today\'s looks keep their pace');
+    overlay.send({ type: 'clear' });
+    overlay.send(giveaway());
+    const [omikuji] = overlay.slots();
+    assert.equal(omikuji.style.properties['--spd'], '1.5');
+    assert.equal(omikuji.style.properties['--a'], '#29E0FF');
+    assert.ok(omikuji.innerHTML.includes('>Lucky draw<'), 'its main text');
+  });
+
+  test('a look of the styles is drawn for 420 px and scaled to the saved width; today\'s looks reflow', () => {
+    const overlay = loadOverlay({ styles: true, designs: {
+      raid: design({ style: 'raid-racing', card_width: 630 }), follow: design({ style: 'follow-samurai', card_width: 630 }),
+    } });
+    overlay.send(raid());
+    const [look] = overlay.slots();
+    assert.ok(look.classList.contains('look'));
+    assert.equal(look.style.properties['--zw'], '1.5');
+    assert.equal(look.style.width, '630px');
+    overlay.send({ type: 'clear' });
+    overlay.send(follow());
+    assert.ok(!overlay.slots()[0].classList.contains('look'), 'the samurai presets are today\'s objects');
+  });
+
+  test('a look is handed the middle picture when "grows with the amount" is off, and the real amount in its words', () => {
+    const lit = (html) => (html.match(/o-rcb-seg on/g) || []).length;
+    const shown = (style_grows, amount) => {
+      const overlay = loadOverlay({ styles: true, designs: { bits: design({ style: 'bits-racing', style_grows }) } });
+      overlay.send(bits(amount));
+      return overlay.slots()[0].innerHTML;
+    };
+    assert.ok(lit(shown(1, 10000)) > lit(shown(1, 500)));
+    assert.equal(lit(shown(0, 10000)), lit(shown(1, 500)));
+    assert.ok(shown(0, 10000).includes('<i>1</i>'), 'the odometer still rolls to the real 10,000');
+  });
+
+  test('a look stays at least its entrance plus a second, at its speed, even when the duration is shorter', () => {
+    const overlay = loadOverlay({ styles: true, designs: { raid: design({ style: 'raid-racing', animation_speed: 2 }) } });
+    overlay.send({ type: 'config-update', config: baseConfig({ raid: { enabled: true, duration: 1 } }) });
+    overlay.send(raid(42));
+    const [slot] = overlay.slots();
+    // raid-racing's entrance: 0.9 s + 0.06 s a car, 12 cars, at speed 2: 0.81 s, plus a second
+    overlay.clock.advance(1800);
+    assert.ok(slot.classList.contains('playing'), 'still on screen');
+    overlay.clock.advance(20);
+    assert.ok(slot.classList.contains('exiting'), 'then it leaves');
+  });
+
+  test('today\'s objects keep the streamer\'s duration as it is', () => {
+    const overlay = loadOverlay({ styles: true });
+    overlay.send({ type: 'config-update', config: baseConfig({ follow: { enabled: true, duration: 1 } }) });
+    overlay.send(follow());
+    overlay.clock.advance(1000);
+    assert.ok(overlay.slots()[0].classList.contains('exiting'));
+  });
+
+  test('a look this page does not know draws the alert\'s default look', () => {
+    const overlay = loadOverlay({ styles: true, designs: { giveaway_winner: design({ style: 'giveaway-nope' }), follow: design({ style: 'follow-nope' }) } });
+    overlay.send(giveaway());
+    assert.match(overlay.slots()[0].innerHTML, /class="obj o-rc o-rcg"/);
+    overlay.send({ type: 'clear' });
+    overlay.send(follow());
+    assert.match(overlay.slots()[0].innerHTML, /^<div class="obj o-follow/);
+  });
+
+  test('when the joined looks did not load, the giveaway is today\'s card and the five are their objects', () => {
+    const overlay = loadOverlay({ kit: true, styles: false, designs: { follow: design({ style: 'follow-racing' }) } });
+    overlay.send(giveaway());
+    assert.ok(overlay.slots()[0].children.some((c) => c.classList.contains('alert-card')), 'the legacy card');
+    overlay.send({ type: 'clear' });
+    overlay.send(follow());
+    assert.match(overlay.slots()[0].innerHTML, /^<div class="obj o-follow/);
+  });
+
+  test('a look that throws while drawing falls back to the alert\'s own object, or its card, and says so once', () => {
+    const overlay = loadOverlay({ styles: true, designs: { follow: design({ style: 'follow-racing' }) } });
+    overlay.run("window.ATLETA_OBJECT_STYLES['follow-racing'].render = () => { throw new Error('boom'); }");
+    overlay.run("window.ATLETA_OBJECT_STYLES['giveaway-racing'].render = () => { throw new Error('boom'); }");
+    overlay.send(follow());
+    assert.match(overlay.slots()[0].innerHTML, /^<div class="obj o-follow/);
+    overlay.send({ type: 'clear' });
+    overlay.send(follow());
+    overlay.send({ type: 'clear' });
+    overlay.send(giveaway());
+    assert.ok(overlay.slots()[0].children.some((c) => c.classList.contains('alert-card')));
+    assert.equal(overlay.errors.filter((e) => e.includes('follow-racing')).length, 1, 'once per look');
+    assert.equal(overlay.errors.filter((e) => e.includes('giveaway-racing')).length, 1);
+  });
+});
ATLETA_PATCH
````

- [ ] **Step 2: Run them and see them fail**

````bash
node --test tests/overlayBuilder.test.js tests/overlayClient.test.js
````

Expected: FAIL: 9 failing (the looks, their variables, timing and fallback; the parity test's new registry); 113 pass.

- [ ] **Step 3: Write the code**

Change `public/overlay/overlay.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/public/overlay/overlay.js b/public/overlay/overlay.js
index 2f772f7..eb8f37d 100644
--- a/public/overlay/overlay.js
+++ b/public/overlay/overlay.js
@@ -35,20 +35,80 @@ function alertSeconds(type) {
   return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : 5;
 }
 
-// The object an alert renders: the style its saved design names (overlay_designs.style), when
+// The look an alert is drawn in: the style its saved design names (overlay_designs.style), when
 // this page knows that style and it draws this alert type (andre_vilela_'s donation is
-// 'donation-c1'); otherwise the alert's own object; null for the alerts that are legacy cards.
+// 'donation-c1'); otherwise the alert's default look (kit.js DEFAULT_LOOKS: the giveaway's is
+// Racing's Victory lap); otherwise the alert's own object; null for the legacy cards.
 // The builder preview picks with the same rule (previewObjectFor in overlay-builder.ejs).
 function objectFor(type) {
   const design = overlayDesigns[type];
-  const styleId = design && design.style;
   const styles = window.ATLETA_OBJECT_STYLES || {};
-  const styled = styleId ? styles[styleId] : null;
-  if (styled && styled.key === styleId && styled.eventType === type) return styled;
+  const kit = window.ATLETA_KIT;
+  const defaultLook = kit && Object.prototype.hasOwnProperty.call(kit.DEFAULT_LOOKS, type) ? kit.DEFAULT_LOOKS[type] : null;
+  for (const styleId of [design && design.style, defaultLook]) {
+    const styled = styleId && Object.prototype.hasOwnProperty.call(styles, styleId) ? styles[styleId] : null;
+    if (styled && styled.key === styleId && styled.eventType === type) return styled;
+  }
   const own = window.ATLETA_OBJECTS && window.ATLETA_OBJECTS[type];
   return own && own.key === type ? own : null;
 }
 
+// What a look is handed: the event's data, and for a look of the alert styles its main text and
+// whether it grows with the amount (kit.js lookData). Today's objects and the C1 get the data as before.
+function lookDataFor(look, event) {
+  const data = event.data || {};
+  const kit = window.ATLETA_KIT;
+  return kit && look.family ? kit.lookData(look, data, overlayDesigns[event.type]) : data;
+}
+
+// The alert's look and its markup. A look that throws while drawing is replaced by the alert's own
+// object, or else by its legacy card ({ look: null }), and the overlay says so once per look.
+const brokenLooks = new Set();
+function drawAlert(event) {
+  const look = objectFor(event.type);
+  if (!look) return { look: null, html: null };
+  try {
+    return { look, html: look.render(lookDataFor(look, event)) };
+  } catch (e) {
+    if (!brokenLooks.has(look.key)) {
+      brokenLooks.add(look.key);
+      console.error(`[Overlay] The look ${look.key} could not be drawn (${e && e.message}); the alert's default is shown instead`);
+    }
+  }
+  const own = window.ATLETA_OBJECTS && window.ATLETA_OBJECTS[event.type];
+  if (own && own.key === event.type && own !== look) {
+    try { return { look: own, html: own.render(event.data || {}) }; } catch (e) { /* the legacy card */ }
+  }
+  return { look: null, html: null };
+}
+
+// The variables a look's slot carries (kit.js slotVars): the streamer's colour with its shades, and
+// the speed, for a look that takes them. A look of the alert styles is drawn for 420 px and scaled to
+// the saved width (.alert-pos.look in objects.css); today's objects, the samurai presets among them,
+// and the C1 reflow to it instead, as before. Returns the look's speed.
+function applyLookVars(slot, look, design) {
+  const kit = window.ATLETA_KIT;
+  if (!kit || !look.family) return 1;
+  const vars = kit.slotVars(look, design);
+  Object.keys(vars).forEach((name) => slot.style.setProperty(name, vars[name]));
+  if (!look.preset) {
+    const placement = window.ATLETA_PLACEMENT;
+    const width = placement ? placement.placementOf(design).width : 420;
+    slot.classList.add('look');
+    slot.style.setProperty('--zw', String(Math.round(width / 420 * 1000) / 1000));
+  }
+  return Number(vars['--spd']) || 1;
+}
+
+// How long an alert stays, in ms: the streamer's duration, but a look of the alert styles at least its
+// entrance (`len`: seconds at speed 1, or worked out from the data) plus a second.
+function holdMs(type, look, data, speed) {
+  const base = alertSeconds(type) * 1000;
+  if (!look || look.len == null) return base;
+  const len = Number(typeof look.len === 'function' ? look.len(data) : look.len);
+  return Number.isFinite(len) ? Math.max(base, Math.round((len / speed + 1) * 1000)) : base;
+}
+
 // How long an object's exit runs ("0.90s" is 900 ms), never less than the 400 ms every alert
 // has always had, so the five objects keep their pace.
 function exitMs(objectDef) {
@@ -427,8 +487,6 @@ function stopCurrentSound() {
 }
 
 function showNotification(event) {
-  const duration = alertSeconds(event.type) * 1000;
-
   // Stop any currently playing sound before starting new one
   stopCurrentSound();
 
@@ -456,7 +514,10 @@ function showNotification(event) {
   // Build the alert. Every alert sits in a slot (.alert-pos) that carries its saved
   // position and width; what is inside animates on its own, so no entrance has to
   // know where it is placed.
-  const objectDef = objectFor(event.type);
+  const drawn = drawAlert(event);
+  const objectDef = drawn.look;
+  const design = overlayDesigns[event.type];
+  let speed = 1;
   const cardClass = getCardClass(event.type);
   const isSubLike = event.type === 'subscription' || event.type === 'yt_member';
   const slot = document.createElement('div');
@@ -465,7 +526,8 @@ function showNotification(event) {
 
   if (objectDef) {
     // Objects animate their own children (.playing / .exiting on the slot drive them).
-    slot.innerHTML = buildBannerContent(event);
+    slot.innerHTML = drawn.html;
+    speed = applyLookVars(slot, objectDef, design);
     slot.style.setProperty('--in', objectDef.anim.in);
     slot.style.setProperty('--dur', objectDef.anim.dur);
     slot.style.setProperty('--ease', objectDef.anim.ease);
@@ -479,7 +541,7 @@ function showNotification(event) {
   container.appendChild(slot);
 
   // Saved position and width, for every alert type
-  applyPlacement(slot, overlayDesigns[event.type]);
+  applyPlacement(slot, design);
 
   // Saved colours and text for the legacy cards (the objects style themselves for now)
   if (!objectDef) applyCustomDesign(card, event.type);
@@ -519,7 +581,7 @@ function showNotification(event) {
       slot.remove();
       alertTimer(playNext, 500);
     }, objectDef ? exitMs(objectDef) : 400);
-  }, duration);
+  }, holdMs(event.type, objectDef, objectDef ? lookDataFor(objectDef, event) : null, speed));
 }
 
 // ─── Build card HTML per event type ───────────────────────────
@@ -544,13 +606,9 @@ function wrapWithSideIcons(icon, bodyHtml) {
   return `<div class="cup-row"><span class="cup">${safeIcon}</span><div class="card-inner">${bodyHtml}</div><span class="cup">${safeIcon}</span></div>`;
 }
 
+// The legacy top-accent + card-body + car-track card: the YouTube alerts and timed messages, and
+// any alert whose look could not be drawn (drawAlert in showNotification draws the looks).
 function buildBannerContent(event) {
-  // The five Twitch events render from the shared object registry, or from the style their
-  // saved design names (objectFor). Everything else keeps the legacy
-  // top-accent + card-body + car-track card.
-  const objectDef = objectFor(event.type);
-  if (objectDef) return objectDef.render(event.data || {});
-
   const icon = getSideIcon(event.type);
 
   switch (event.type) {
ATLETA_PATCH
````

Change `src/views/overlay-builder.ejs`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/src/views/overlay-builder.ejs b/src/views/overlay-builder.ejs
index 3e691c3..6598119 100644
--- a/src/views/overlay-builder.ejs
+++ b/src/views/overlay-builder.ejs
@@ -1434,15 +1434,20 @@ const PREVIEW_DATA = {
   bits:         { username: 'TurboTina', amount: 500 },
   donation:     { username: 'PitBoss92', amount: '25.00', currency: 'EUR' },
   raid:         { username: 'GridWalker', viewers: 42 },
+  giveaway_winner: { username: 'LuckyViewer42', prize: 'Season pass' },
 };
 
-// The object an alert's preview draws: the same rule as objectFor() in public/overlay/overlay.js,
-// reading the stored styles. null for the alerts that are legacy cards.
+// The look an alert's preview draws: the same rule as objectFor() in public/overlay/overlay.js,
+// reading the look the page shows (ALERT_STYLES): that look, else the alert's default look (the
+// giveaway's is Racing's Victory lap), else its own object; null for the legacy cards.
 function previewObjectFor(type) {
-  const styleId = ALERT_STYLES[type];
   const styles = window.ATLETA_OBJECT_STYLES || {};
-  const styled = styleId ? styles[styleId] : null;
-  if (styled && styled.key === styleId && styled.eventType === type) return styled;
+  const kit = window.ATLETA_KIT;
+  const defaultLook = kit && Object.prototype.hasOwnProperty.call(kit.DEFAULT_LOOKS, type) ? kit.DEFAULT_LOOKS[type] : null;
+  for (const styleId of [ALERT_STYLES[type], defaultLook]) {
+    const styled = styleId && Object.prototype.hasOwnProperty.call(styles, styleId) ? styles[styleId] : null;
+    if (styled && styled.key === styleId && styled.eventType === type) return styled;
+  }
   const own = window.ATLETA_OBJECTS && window.ATLETA_OBJECTS[type];
   return own && own.key === type ? own : null;
 }
ATLETA_PATCH
````

- [ ] **Step 4: Run the task's tests, then the whole suite**

````bash
node --test tests/overlayBuilder.test.js tests/overlayClient.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2704 tests on the C1 branch at 040b180 with Tasks 1–10).

- [ ] **Step 5: Commit**

````bash
git add public/overlay/overlay.js src/views/overlay-builder.ejs tests/overlayBuilder.test.js tests/overlayClient.test.js
git commit -m "feat(overlay): the OBS overlay draws the looks with their colour, speed, timing and fallback" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 11: Five new screen effects, and the looks' sounds

**Effects (spec 4.8).** `public/overlay/fx.js` and `fx.css` draw the five effects the looks bring: tyre smoke,
chequered confetti, speed lines, titanium sparks and champagne.

- Each uses at most 60 particles, runs once, and is gone after 5.2 s.
- The OBS overlay (`spawnEffects`) and the builder preview (`renderScreenEffect`) both draw them with `ATLETA_FX.spawn()`, the preview at its own scale (Overlay Consistency Rule).
- A look now plays an effect: the one the design names, else its own (`kit.effectFor`).
- Today's objects with no look picked, and the C1, play none, whatever an older builder saved.

**Sounds (spec 4.7).**

- A sound the streamer uploaded still plays first.
- Otherwise `kit.soundFor()` decides: the design's `style_sound` (where `none` is silence), else the look's own. Today's objects play today's sound.
- The sound plays through the overlay's AudioContext, at its volume.

The five effects also join `FIELD_SPECS`, both of the builder's effect lists, and the seven locales.

**Files:**
- Create: `public/overlay/fx.css`
- Create: `public/overlay/fx.js`
- Modify: `public/overlay/overlay.js`
- Modify: `src/locales/de.json`
- Modify: `src/locales/en.json`
- Modify: `src/locales/es.json`
- Modify: `src/locales/fr.json`
- Modify: `src/locales/ja.json`
- Modify: `src/locales/pt.json`
- Modify: `src/locales/zh.json`
- Modify: `src/routes/overlay.js`
- Modify: `src/services/overlayDesign.js`
- Modify: `src/views/overlay-builder.ejs`
- Modify: `src/services/overlayDesign.test.js` (test)
- Create: `tests/fx.test.js` (test)
- Modify: `tests/overlayClient.test.js` (test)

**Interfaces:**
- Consumes: Task 1 (`effectFor`, `soundFor`, `setAudio`, `playSound`), Task 10 (`drawAlert`).
- Produces: - `window.ATLETA_FX`: `KINDS`, `COLOURS`, `particles(kind, random, scale)` and `spawn(layer, kind, { scale, random })`.
  - `spawnEffects(type, chosen)`.
  - Keys `overlayBuilder.anim.effect.smoke`, `.checker`, `.speed`, `.sparks` and `.champagne`.

- [ ] **Step 1: Write the failing tests**

Change `src/services/overlayDesign.test.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/src/services/overlayDesign.test.js b/src/services/overlayDesign.test.js
index f84fd21..47aad1d 100644
--- a/src/services/overlayDesign.test.js
+++ b/src/services/overlayDesign.test.js
@@ -607,3 +607,19 @@ describe('a look\'s settings (alert styles)', () => {
     assert.equal('style_grows' in accepts({ style_grows: 2 }), false, 'a number that is not a choice is left out');
   });
 });
+
+describe('the five screen effects of the alert looks', () => {
+  test('are choices of the effect, and each is kept as chosen', () => {
+    for (const effect of ['smoke', 'checker', 'speed', 'sparks', 'champagne']) {
+      assert.ok(FIELD_SPECS.screen_effect.values.includes(effect), effect);
+      assert.equal(accepts({ screen_effect: effect }).screen_effect, effect);
+    }
+  });
+
+  test('are the effects public/overlay/fx.js draws, for the OBS overlay and the builder alike', () => {
+    const FX = require('../../public/overlay/fx.js');
+    for (const kind of FX.KINDS) assert.ok(FIELD_SPECS.screen_effect.values.includes(kind), kind);
+    assert.match(overlayJs, /window\.ATLETA_FX\.spawn\(container, effect\)/);
+    assert.match(builder, /window\.ATLETA_FX\.spawn\(/);
+  });
+});
ATLETA_PATCH
````

Create `tests/fx.test.js`:

````bash
mkdir -p tests && cat > tests/fx.test.js <<'ATLETA_FILE'
'use strict';

// public/overlay/fx.js: the five screen effects the OBS overlay and the builder preview share.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FX = require('../public/overlay/fx.js');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'fx.css'), 'utf8');

test('the five effects, each at most 60 particles that run once', () => {
  assert.deepEqual(FX.KINDS, ['smoke', 'checker', 'speed', 'sparks', 'champagne']);
  for (const kind of FX.KINDS) {
    const list = FX.particles(kind, () => 0.5);
    assert.ok(list.length > 0 && list.length <= 60, `${kind}: ${list.length}`);
    for (const p of list) {
      assert.match(p.style, /--du:\d+\.\d\ds;--dd:\d+\.\d\ds/, `${kind}: a duration and a delay`);
      assert.ok(CSS.includes('.' + p.cls + '{') || CSS.includes('.' + p.cls + ','), `${kind}: .${p.cls} is styled in fx.css`);
    }
  }
  assert.deepEqual(FX.particles('none'), []);
});

test('a smaller preview gets smaller particles', () => {
  const full = FX.particles('smoke', () => 0.5, 1)[0].style, small = FX.particles('smoke', () => 0.5, 0.25)[0].style;
  assert.match(full, /width:370px/);
  assert.match(small, /width:93px/);
});

test('fx.css runs no animation forever', () => {
  assert.ok(!/infinite/.test(CSS));
});
ATLETA_FILE
````

Change `tests/overlayClient.test.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/tests/overlayClient.test.js b/tests/overlayClient.test.js
index c0babbc..1ef5514 100644
--- a/tests/overlayClient.test.js
+++ b/tests/overlayClient.test.js
@@ -16,6 +16,7 @@ const OVERLAY_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay
 const OBJECTS_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'objects', 'index.js'), 'utf8');
 const PLACEMENT_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'placement.js'), 'utf8');
 const KIT_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'objects', 'kit.js'), 'utf8');
+const FX_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'fx.js'), 'utf8');
 // The family files joined, as the page loads them from /overlay/objects/styles.js
 const STYLES_JS = require('../src/services/alertStyleBundle').bundle().js;
 
@@ -160,6 +161,7 @@ function loadOverlay({ objects = true, styles = false, kit = styles, designs = {
   if (objects) vm.runInContext(OBJECTS_JS, context, { filename: 'objects/index.js' });
   if (kit) vm.runInContext(KIT_JS, context, { filename: 'objects/kit.js' });
   if (styles) vm.runInContext(STYLES_JS, context, { filename: 'objects/styles.js' });
+  vm.runInContext(FX_JS, context, { filename: 'fx.js' });
   vm.runInContext(PLACEMENT_JS, context, { filename: 'placement.js' });
   vm.runInContext(OVERLAY_JS, context, { filename: 'overlay.js' });
 
@@ -952,3 +954,84 @@ describe('the look an alert is drawn in (alert styles)', () => {
     assert.equal(overlay.errors.filter((e) => e.includes('giveaway-racing')).length, 1);
   });
 });
+
+describe('the screen effect and the sound of a look (alert styles)', () => {
+  const giveaway = () => ({ type: 'giveaway_winner', data: { username: 'RacerDan', prize: 'Season pass' } });
+  const effects = (overlay, cls) => overlay.container.children.filter((c) => c.classList.contains(cls)).length;
+  const all = (overlay) => overlay.container.children.filter((c) => c.classList.contains('screen-effect')).length;
+  // Which sound played: today's synthesized one or a look's, replaced by markers.
+  const listen = (overlay) => {
+    overlay.run("window.played = []; soundEffects.follow = () => window.played.push('today:follow'); soundEffects.giveaway_winner = () => window.played.push('today:giveaway');");
+    for (const [key, family] of [['rcVictory', 'racing'], ['rcFlyby', 'racing'], ['samuraiBell', 'samurai']]) {
+      overlay.run(`window.ATLETA_KIT.registerSound('${key}', '${family}', () => window.played.push('${key}'))`);
+    }
+    return () => JSON.parse(overlay.run('JSON.stringify(window.played)')); // an array of this realm
+  };
+
+  test('an alert nobody has restyled plays no effect, whatever an older builder saved, and today\'s sound', () => {
+    const overlay = loadOverlay({ styles: true, designs: { follow: design({ screen_effect: 'confetti' }) } });
+    const played = listen(overlay);
+    overlay.send(follow());
+    assert.equal(all(overlay), 0);
+    assert.deepEqual(played(), ['today:follow']);
+  });
+
+  test('a picked look plays the effect its design names, or its own, and its own sound', () => {
+    const overlay = loadOverlay({ styles: true, designs: { follow: design({ style: 'follow-racing', screen_effect: 'default' }), raid: design({ style: 'raid-racing', screen_effect: 'sparks' }) } });
+    const played = listen(overlay);
+    overlay.send(follow());
+    assert.equal(all(overlay), 0, 'Fly-by has no effect of its own');
+    assert.deepEqual(played(), ['rcFlyby']);
+    overlay.send({ type: 'clear' });
+    overlay.send({ type: 'raid', data: { username: 'GridWalker', viewers: 42 } });
+    assert.equal(effects(overlay, 'fx-spark'), 56);
+  });
+
+  test('the giveaway\'s Victory lap plays its chequered confetti and its fanfare; a saved effect carries over', () => {
+    const fresh = loadOverlay({ styles: true });
+    const played = listen(fresh);
+    fresh.send(giveaway());
+    assert.equal(effects(fresh, 'fx-check'), 60);
+    assert.deepEqual(played(), ['rcVictory']);
+    const saved = loadOverlay({ styles: true, designs: { giveaway_winner: design({ screen_effect: 'gold' }) } });
+    saved.send(giveaway());
+    assert.ok(effects(saved, 'gold-item') > 0, 'the gold rain the streamer saved for the old card');
+  });
+
+  test('the design\'s sound wins over the look\'s; "none" is silence; an unknown one is the look\'s own', () => {
+    for (const [style_sound, expected] of [['samuraiBell', ['samuraiBell']], ['today', ['today:giveaway']], ['none', []], ['nope', ['rcVictory']]]) {
+      const overlay = loadOverlay({ styles: true, designs: { giveaway_winner: design({ style_sound }) } });
+      const played = listen(overlay);
+      overlay.send(giveaway());
+      assert.deepEqual(played(), expected, style_sound);
+    }
+  });
+
+  test('a sound the streamer uploaded still plays first, even over "none"', () => {
+    const overlay = loadOverlay({ styles: true, designs: { giveaway_winner: design({ style_sound: 'none' }) } });
+    overlay.send({ type: 'config-update', config: baseConfig({ sounds: { giveaway_winner: '/overlay/sounds/test-token/giveaway_winner?v=1' } }) });
+    const played = listen(overlay);
+    overlay.send(giveaway());
+    assert.equal(overlay.audio.instances.length, 1);
+    assert.ok(overlay.audio.instances[0].played);
+    assert.deepEqual(played(), []);
+  });
+
+  test('the looks\' sounds use the overlay\'s AudioContext and volume', () => {
+    const overlay = loadOverlay({ styles: true });
+    const before = overlay.audio.oscillators;
+    overlay.send(giveaway());
+    assert.ok(overlay.audio.oscillators > before, 'Victory lap was played through the page\'s AudioContext');
+    overlay.send({ type: 'config-update', config: baseConfig({ volume: 0 }) });
+    overlay.send({ type: 'clear' });
+    const muted = overlay.audio.oscillators;
+    overlay.send(giveaway());
+    assert.equal(overlay.audio.oscillators, muted, 'volume 0 is silent');
+  });
+
+  test('a legacy card can play one of the new effects too', () => {
+    const overlay = loadOverlay({ styles: true, designs: { yt_member: design({ screen_effect: 'smoke' }) } });
+    overlay.send({ type: 'yt_member', data: { username: 'NewMember42', level: 'Member' } });
+    assert.equal(effects(overlay, 'fx-smoke'), 20);
+  });
+});
ATLETA_PATCH
````

- [ ] **Step 2: Run them and see them fail**

````bash
node --test src/services/overlayDesign.test.js tests/fx.test.js tests/overlayClient.test.js
````

Expected: FAIL: 4 failing (fx.js missing, the effects not in FIELD_SPECS); 66 pass.

- [ ] **Step 3: Write the code**

Create `public/overlay/fx.css`:

````bash
mkdir -p public/overlay && cat > public/overlay/fx.css <<'ATLETA_FILE'
/* The five screen effects of public/overlay/fx.js (the OBS overlay and the builder preview). A particle is
   positioned in its layer by fx.js; nothing here runs forever, and reduced motion hides them. */
.fx{position:absolute;pointer-events:none;will-change:transform,opacity}
.fx-smoke{border-radius:50%;background:radial-gradient(circle,rgba(226,230,236,.6) 0%,rgba(205,210,218,.3) 40%,rgba(200,205,212,0) 70%);filter:blur(5px);animation:fxSmoke var(--du) cubic-bezier(.2,.6,.3,1) var(--dd) both}
@keyframes fxSmoke{0%{transform:translate(-50%,-50%) scale(.3);opacity:0}15%{opacity:.9}100%{transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy))) scale(1.9);opacity:0}}
.fx-check{width:var(--s);height:var(--s);background:var(--fill);box-shadow:0 0 0 1px rgba(0,0,0,.25);animation:fxFall var(--du) linear var(--dd) both}
@keyframes fxFall{0%{transform:translate3d(0,0,0) rotateX(0deg) rotateZ(0deg);opacity:1}100%{transform:translate3d(var(--dx),var(--fall),0) rotateX(var(--rx)) rotateZ(var(--rz));opacity:.9}}
.fx-speed{height:3px;transform-origin:0 50%;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.9));animation:fxSpeed var(--du) cubic-bezier(.3,0,.6,1) var(--dd) both}
@keyframes fxSpeed{0%{transform:rotate(var(--t)) translateX(var(--r0)) scaleX(.1);opacity:0}25%{opacity:.85}100%{transform:rotate(var(--t)) translateX(var(--r1)) scaleX(1);opacity:0}}
.fx-spark{width:4px;height:16px;border-radius:2px;background:linear-gradient(180deg,#FFFFFF,#FFD27A 40%,#FF7A1A);box-shadow:0 0 10px rgba(255,170,60,.95);animation:fxSpark var(--du) cubic-bezier(.2,.7,.4,1) var(--dd) both}
@keyframes fxSpark{0%{transform:translate(0,0) rotate(var(--a0));opacity:0}6%{opacity:1}55%{transform:translate(calc(var(--dx) * .6),var(--dy)) rotate(var(--a1));opacity:1}100%{transform:translate(var(--dx),calc(var(--dy) * .35)) rotate(var(--a2));opacity:0}}
.fx-drop{width:6px;height:10px;border-radius:50%;background:rgba(255,244,201,.95);box-shadow:0 0 8px rgba(255,232,160,.9);animation:fxDrop var(--du) cubic-bezier(.25,.6,.4,1) var(--dd) both}
@keyframes fxDrop{0%{transform:translate(0,0);opacity:0}5%{opacity:1}55%{transform:translate(calc(var(--dx) * .62),var(--dy));opacity:1}100%{transform:translate(var(--dx),calc(var(--dy) * .2 + 120px));opacity:0}}
@media (prefers-reduced-motion:reduce){.fx{display:none}}
ATLETA_FILE
````

Create `public/overlay/fx.js`:

````bash
mkdir -p public/overlay && cat > public/overlay/fx.js <<'ATLETA_FILE'
'use strict';

/**
 * The five screen effects a look can add (docs/superpowers/specs/2026-10-15-alert-styles-design.md):
 * smoke, checker, speed, sparks and champagne. One function draws them for the OBS overlay
 * (spawnEffects in overlay.js) and for the builder preview (renderScreenEffect in
 * overlay-builder.ejs), so the two show the same thing (Overlay Consistency Rule). The styles are
 * fx.css. A layer is the 1920x1080 screen or the builder's preview of it; opts.scale shrinks the
 * particles to the preview's size. At most 60 particles, each runs once, all gone after 5.2 s.
 */
(function (root) {
  var KINDS = ['smoke', 'checker', 'speed', 'sparks', 'champagne'];
  var COLOURS = ['#ff4444', '#00ff88', '#f7c948', '#4285f4', '#ff88cc', '#ffffff', '#bf00ff', '#00ccff'];

  function n(v, d) { return v.toFixed(d == null ? 0 : d); }
  // The particles of one effect: [{ cls, style }], for a layer 1920 px wide (scale 1).
  function particles(kind, random, scale) {
    var r = random || Math.random, k = scale || 1, out = [], i;
    function px(v) { return n(v * k) + 'px'; }
    if (kind === 'smoke') {
      for (i = 0; i < 20; i++) {
        var s = 220 + r() * 300;
        out.push({ cls: 'fx-smoke', style: 'left:' + n(i % 2 ? 4 + r() * 20 : 76 + r() * 20, 1) + '%;top:' + n(98 + r() * 6, 1) + '%;width:' + px(s) + ';height:' + px(s)
          + ';--dx:' + px((i % 2 ? 1 : -1) * (60 + r() * 220)) + ';--dy:' + px(-(220 + r() * 460)) + ';--du:' + n(2 + r() * 1.3, 2) + 's;--dd:' + n(r() * 0.7, 2) + 's' });
      }
    } else if (kind === 'checker') {
      for (i = 0; i < 60; i++) {
        var fill = i % 3 === 0 ? 'repeating-conic-gradient(#111 0 25%,#f4f4f4 0 50%) 0 0/50% 50%' : (i % 2 ? '#f4f4f4' : '#111');
        out.push({ cls: 'fx-check', style: 'left:' + n(r() * 100, 1) + '%;top:' + n(-4 - r() * 8, 1) + '%;--dx:' + px((r() - 0.5) * 260) + ';--fall:' + px(1240)
          + ';--rx:' + n(360 + r() * 720) + 'deg;--rz:' + n(r() * 540) + 'deg;--du:' + n(2.2 + r() * 1.4, 2) + 's;--dd:' + n(r() * 0.9, 2) + 's;--s:' + px(18 + r() * 26) + ';--fill:' + fill });
      }
    } else if (kind === 'speed') {
      for (i = 0; i < 48; i++) {
        out.push({ cls: 'fx-speed', style: 'left:50%;top:44%;width:' + px(160 + r() * 340) + ';--t:' + n(r() * 360) + 'deg;--r0:' + px(90 + r() * 160)
          + ';--r1:' + px(900 + r() * 500) + ';--du:' + n(0.45 + r() * 0.35, 2) + 's;--dd:' + n(r() * 0.4, 2) + 's' });
      }
    } else if (kind === 'sparks') {
      for (i = 0; i < 56; i++) {
        var dir = r() < 0.5 ? -1 : 1;
        out.push({ cls: 'fx-spark', style: 'left:' + n(18 + r() * 64, 1) + '%;top:' + n(97 + r() * 2, 1) + '%;--dx:' + px(dir * (100 + r() * 460)) + ';--dy:' + px(-(200 + r() * 420))
          + ';--a0:' + (dir * 20) + 'deg;--a1:' + (dir * 60) + 'deg;--a2:' + (dir * 130) + 'deg;--du:' + n(0.6 + r() * 0.5, 2) + 's;--dd:' + n(r() * 0.8, 2) + 's' });
      }
    } else if (kind === 'champagne') {
      [-1, 1].forEach(function (side) {
        for (var j = 0; j < 30; j++) {
          out.push({ cls: 'fx-drop', style: 'left:' + (side < 0 ? 6 : 94) + '%;top:97%;--dx:' + px(-side * (220 + r() * 760)) + ';--dy:' + px(-(320 + r() * 560))
            + ';--du:' + n(1.1 + r() * 0.9, 2) + 's;--dd:' + n(r(), 2) + 's' });
        }
      });
    }
    return out;
  }
  // Draws `kind` on `layer`; returns the elements (removed by themselves after 5.2 s).
  function spawn(layer, kind, opts) {
    if (!layer || KINDS.indexOf(kind) < 0) return [];
    var o = opts || {}, doc = layer.ownerDocument || (root && root.document), made = [];
    particles(kind, o.random, o.scale).forEach(function (p) {
      var el = doc.createElement('i');
      el.className = 'fx screen-effect ' + p.cls;
      el.setAttribute('style', p.style);
      layer.appendChild(el);
      made.push(el);
    });
    var later = (root && root.setTimeout) || setTimeout;
    later(function () { made.forEach(function (el) { if (el.remove) el.remove(); }); }, 5200);
    return made;
  }
  var FX = { KINDS: KINDS, COLOURS: COLOURS, particles: particles, spawn: spawn };
  if (typeof module !== 'undefined' && module.exports) module.exports = FX;
  if (root) root.ATLETA_FX = FX;
})(typeof window !== 'undefined' ? window : null);
ATLETA_FILE
````

Change `public/overlay/overlay.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/public/overlay/overlay.js b/public/overlay/overlay.js
index eb8f37d..1973fe8 100644
--- a/public/overlay/overlay.js
+++ b/public/overlay/overlay.js
@@ -155,6 +155,8 @@ function loadDesignFonts(designs) {
 
 // Synthesized notification sounds using Web Audio API
 const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
+// The looks' sounds (objects/kit.js) play through the same AudioContext, at the streamer's volume.
+if (window.ATLETA_KIT) window.ATLETA_KIT.setAudio(audioCtx, overlayVolume);
 
 // Racing-themed sound synthesis
 function createNoise(duration, vol) {
@@ -490,10 +492,19 @@ function showNotification(event) {
   // Stop any currently playing sound before starting new one
   stopCurrentSound();
 
-  // Play notification sound — the streamer's custom sound when they set one,
-  // otherwise (or if it fails to play) the synthesized default
+  const drawn = drawAlert(event);
+  const objectDef = drawn.look;
+  const design = overlayDesigns[event.type];
+
+  // Play notification sound — the streamer's custom sound when they set one, otherwise (or if it
+  // fails to play) the look's sound (kit.js soundFor: the design's, else the look's own; today's
+  // synthesized one for today's objects, the C1 and the cards; 'none' is silence)
   if (audioCtx.state === 'suspended') audioCtx.resume();
+  const kit = window.ATLETA_KIT;
+  const soundKey = kit ? kit.soundFor(objectDef, design) : 'today';
   const playDefaultSound = () => {
+    if (soundKey === 'none') return;
+    if (soundKey !== 'today' && kit.playSound(soundKey)) return;
     const playSound = soundEffects[event.type];
     if (playSound) playSound();
   };
@@ -514,9 +525,6 @@ function showNotification(event) {
   // Build the alert. Every alert sits in a slot (.alert-pos) that carries its saved
   // position and width; what is inside animates on its own, so no entrance has to
   // know where it is placed.
-  const drawn = drawAlert(event);
-  const objectDef = drawn.look;
-  const design = overlayDesigns[event.type];
   let speed = 1;
   const cardClass = getCardClass(event.type);
   const isSubLike = event.type === 'subscription' || event.type === 'yt_member';
@@ -546,8 +554,13 @@ function showNotification(event) {
   // Saved colours and text for the legacy cards (the objects style themselves for now)
   if (!objectDef) applyCustomDesign(card, event.type);
 
-  // Spawn full-screen effects — objects carry their own motion
+  // Full-screen effects: a card plays its design's; a look the one its design names or its own
+  // (kit.js effectFor: none for today's objects with no look picked, and for the C1)
   if (!objectDef) spawnEffects(event.type);
+  else {
+    const effect = kit ? kit.effectFor(objectDef, design) : 'none';
+    if (effect !== 'none') spawnEffects(event.type, effect);
+  }
 
   // Dismiss after duration
   alertTimer(() => {
@@ -743,7 +756,8 @@ function buildBannerContent(event) {
 }
 
 // ─── Full-screen effects ───────────────────────────────────────
-function spawnEffects(type) {
+// `chosen`: the effect a look plays (showNotification); a card plays its design's, or its alert's default.
+function spawnEffects(type, chosen) {
   document.querySelectorAll('.screen-effect').forEach(e => e.remove());
 
   const design = overlayDesigns[type] || {};
@@ -753,7 +767,7 @@ function spawnEffects(type) {
   const dir = design.effect_direction || 'down';
 
   // Use custom screen_effect if set, otherwise default per event type
-  let effect = design.screen_effect || 'default';
+  let effect = chosen || design.screen_effect || 'default';
   if (effect === 'default') {
     const defaults = {
       follow: 'tiremarks', subscription: 'confetti', yt_member: 'confetti',
@@ -766,6 +780,12 @@ function spawnEffects(type) {
   }
   if (effect === 'none') return;
 
+  // The alert looks' five effects (fx.js), drawn the same way in the builder preview
+  if (window.ATLETA_FX && window.ATLETA_FX.KINDS.includes(effect)) {
+    window.ATLETA_FX.spawn(container, effect);
+    return;
+  }
+
   switch (effect) {
     case 'tiremarks':  spawnTireMarks(speed, amount, size, dir);           break;
     case 'confetti':   spawnConfettiAndFlashes(speed, amount, size, dir);  break;
ATLETA_PATCH
````

Change `src/routes/overlay.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/src/routes/overlay.js b/src/routes/overlay.js
index bc64efb..a07e2d0 100644
--- a/src/routes/overlay.js
+++ b/src/routes/overlay.js
@@ -324,6 +324,7 @@ router.get('/:token', (req, res) => {
   <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oxanium:wght@400;600;700;800&family=Saira+Condensed:wght@400;500;600;700&display=swap">
   <link rel="stylesheet" href="/overlay/objects/objects.css">
   <link rel="stylesheet" href="/overlay/objects/styles.css?v=${alertStyles().version}">
+  <link rel="stylesheet" href="/overlay/fx.css">
 </head>
 <body>
   <div id="notification-container"></div>
@@ -335,6 +336,7 @@ router.get('/:token', (req, res) => {
   <script src="/overlay/objects/index.js"></script>
   <script src="/overlay/objects/kit.js"></script>
   <script src="/overlay/objects/styles.js?v=${alertStyles().version}"></script>
+  <script src="/overlay/fx.js"></script>
   <script src="/overlay/placement.js"></script>
   <script src="/overlay/overlay.js"></script>
 </body>
ATLETA_PATCH
````

Change `src/services/overlayDesign.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/src/services/overlayDesign.js b/src/services/overlayDesign.js
index dee565b..67766c2 100644
--- a/src/services/overlayDesign.js
+++ b/src/services/overlayDesign.js
@@ -96,7 +96,8 @@ const FIELD_SPECS = Object.freeze({
   detail_text: { kind: 'text', max: 300 },
   entrance_animation: { kind: 'enum', values: ['slideDown', 'slideUp', 'slideLeft', 'slideRight', 'zoomIn', 'fadeIn'] },
   car_animation: { kind: 'enum', values: ['zoomLR', 'zoomRL', 'checkered', 'flames', 'sparkles', 'lightning', 'neonSweep', 'equalizer', 'pulse', 'none'] },
-  screen_effect: { kind: 'enum', values: ['default', 'none', 'confetti', 'gold', 'money', 'robots', 'tiremarks'] },
+  // 'default' is the alert's own effect (a look's own, for a look); the last five are fx.js's
+  screen_effect: { kind: 'enum', values: ['default', 'none', 'confetti', 'gold', 'money', 'robots', 'tiremarks', 'smoke', 'checker', 'speed', 'sparks', 'champagne'] },
   animation_speed: { kind: 'number', min: 0.5, max: 2 },
   // The width slider runs 280-900; dragging the card's resize handle allows 200-900.
   card_width: { kind: 'int', min: 200, max: 900 },
ATLETA_PATCH
````

Change `src/views/overlay-builder.ejs`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/src/views/overlay-builder.ejs b/src/views/overlay-builder.ejs
index 6598119..709709c 100644
--- a/src/views/overlay-builder.ejs
+++ b/src/views/overlay-builder.ejs
@@ -19,6 +19,9 @@
   <!-- The alert looks: their shared kit and every family, joined (services/alertStyleBundle.js) -->
   <script src="/overlay/objects/kit.js"></script>
   <script src="/overlay/objects/styles.js?v=<%= stylesVersion %>"></script>
+  <!-- The looks' five screen effects, drawn as the OBS overlay draws them -->
+  <link rel="stylesheet" href="/overlay/fx.css">
+  <script src="/overlay/fx.js"></script>
   <!-- Where an alert sits, read from a saved design: shared with the live OBS overlay -->
   <script src="/overlay/placement.js"></script>
   <style>
@@ -1050,7 +1053,7 @@
           <div style="display:none;">
             <select id="ctrl-entrance-animation"><option value="slideDown"><%= t('overlayBuilder.anim.slideDown') %></option><option value="slideUp"><%= t('overlayBuilder.anim.slideUp') %></option><option value="slideLeft"><%= t('overlayBuilder.anim.slideLeft') %></option><option value="slideRight"><%= t('overlayBuilder.anim.slideRight') %></option><option value="zoomIn"><%= t('overlayBuilder.anim.zoomIn') %></option><option value="fadeIn"><%= t('overlayBuilder.anim.fadeIn') %></option></select>
             <select id="ctrl-car-animation"><option value="zoomLR"><%= t('overlayBuilder.anim.car.zoomLR') %></option><option value="zoomRL"><%= t('overlayBuilder.anim.car.zoomRL') %></option><option value="checkered"><%= t('overlayBuilder.anim.car.checkered') %></option><option value="flames"><%= t('overlayBuilder.anim.car.flames') %></option><option value="sparkles"><%= t('overlayBuilder.anim.car.sparkles') %></option><option value="lightning"><%= t('overlayBuilder.anim.car.lightning') %></option><option value="neonSweep"><%= t('overlayBuilder.anim.car.neonSweep') %></option><option value="equalizer"><%= t('overlayBuilder.anim.car.equalizer') %></option><option value="pulse"><%= t('overlayBuilder.anim.car.pulse') %></option><option value="none"><%= t('overlayBuilder.none') %></option></select>
-            <select id="ctrl-screen-effect"><option value="default"><%= t('overlayBuilder.anim.effect.default') %></option><option value="none"><%= t('overlayBuilder.none') %></option><option value="confetti"><%= t('overlayBuilder.anim.effect.confetti') %></option><option value="gold"><%= t('overlayBuilder.anim.effect.gold') %></option><option value="money"><%= t('overlayBuilder.anim.effect.money') %></option><option value="robots"><%= t('overlayBuilder.anim.effect.robots') %></option><option value="tiremarks"><%= t('overlayBuilder.anim.effect.tiremarks') %></option></select>
+            <select id="ctrl-screen-effect"><option value="default"><%= t('overlayBuilder.anim.effect.default') %></option><option value="none"><%= t('overlayBuilder.none') %></option><option value="confetti"><%= t('overlayBuilder.anim.effect.confetti') %></option><option value="gold"><%= t('overlayBuilder.anim.effect.gold') %></option><option value="money"><%= t('overlayBuilder.anim.effect.money') %></option><option value="robots"><%= t('overlayBuilder.anim.effect.robots') %></option><option value="tiremarks"><%= t('overlayBuilder.anim.effect.tiremarks') %></option><option value="smoke"><%= t('overlayBuilder.anim.effect.smoke') %></option><option value="checker"><%= t('overlayBuilder.anim.effect.checker') %></option><option value="speed"><%= t('overlayBuilder.anim.effect.speed') %></option><option value="sparks"><%= t('overlayBuilder.anim.effect.sparks') %></option><option value="champagne"><%= t('overlayBuilder.anim.effect.champagne') %></option></select>
             <input type="range" id="ctrl-animation-speed" min="0.5" max="2.0" step="0.1" value="1.0">
             <input type="range" id="ctrl-effect-amount" min="0.2" max="3.0" step="0.1" value="1.0">
             <input type="range" id="ctrl-effect-size" min="0.5" max="3.0" step="0.1" value="1.0">
@@ -1202,7 +1205,9 @@ const I18N = <%- JSON.stringify({
   effect: {
     default: t('overlayBuilder.anim.summary.effectDefault'), none: t('overlayBuilder.none'), confetti: t('overlayBuilder.anim.effect.confetti'),
     gold: t('overlayBuilder.anim.effect.gold'), money: t('overlayBuilder.anim.effect.money'), robots: t('overlayBuilder.anim.effect.robots'),
-    tiremarks: t('overlayBuilder.anim.effect.tiremarks'),
+    tiremarks: t('overlayBuilder.anim.effect.tiremarks'), smoke: t('overlayBuilder.anim.effect.smoke'),
+    checker: t('overlayBuilder.anim.effect.checker'), speed: t('overlayBuilder.anim.effect.speed'),
+    sparks: t('overlayBuilder.anim.effect.sparks'), champagne: t('overlayBuilder.anim.effect.champagne'),
   },
   direction: {
     down: t('overlayBuilder.anim.summary.down'), up: t('overlayBuilder.anim.summary.up'), left: t('overlayBuilder.anim.summary.left'), right: t('overlayBuilder.anim.summary.right'),
@@ -1495,13 +1500,12 @@ function updatePreview() {
       objHost.classList.add('playing');
       renderedObjectType = currentType;
     }
-    // renderScreenEffect('none') is a clean clear: objects carry their own motion and
-    // the live overlay skips spawnEffects() for them, so a saved screen effect would
-    // misrepresent what the streamer gets. No loadGoogleFont() call: objects use
-    // Oxanium/Saira Condensed from the page's own <link>, not the per-design font path.
+    // The effect the OBS overlay plays with this look (kit.js effectFor): none for today's
+    // objects with no look picked and for the C1, else the one the design names or the look's own.
+    // No loadGoogleFont() call: objects use their own fonts, not the per-design font path.
     positionCard(d.card_position, d.card_width);
     updateOverlayGuide();
-    renderScreenEffect('none');
+    renderScreenEffect(window.ATLETA_KIT ? window.ATLETA_KIT.effectFor(objDef, d) : 'none');
     return;
   }
   renderedObjectType = null;
@@ -1823,6 +1827,16 @@ function renderScreenEffect(effect) {
   }
   if (!effect || effect === 'none') return;
 
+  // The alert looks' five effects (fx.js), as the OBS overlay draws them, at the preview's scale
+  if (window.ATLETA_FX && window.ATLETA_FX.KINDS.includes(effect)) {
+    const layer = document.createElement('div');
+    layer.className = 'preview-fx';
+    layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5;';
+    screen.appendChild(layer);
+    window.ATLETA_FX.spawn(layer, effect, { scale: screen.offsetWidth / 1920 });
+    return;
+  }
+
   const d = workingDesigns[currentType] || {};
   const speed = d.animation_speed || 1.0;
   const amount = d.effect_amount || 1.0;
@@ -2948,6 +2962,11 @@ document.addEventListener('mouseup', e => {
             <option value="money"><%= t('overlayBuilder.anim.effect.money') %></option>
             <option value="robots"><%= t('overlayBuilder.anim.effect.robots') %></option>
             <option value="tiremarks"><%= t('overlayBuilder.anim.effect.tiremarks') %></option>
+            <option value="smoke"><%= t('overlayBuilder.anim.effect.smoke') %></option>
+            <option value="checker"><%= t('overlayBuilder.anim.effect.checker') %></option>
+            <option value="speed"><%= t('overlayBuilder.anim.effect.speed') %></option>
+            <option value="sparks"><%= t('overlayBuilder.anim.effect.sparks') %></option>
+            <option value="champagne"><%= t('overlayBuilder.anim.effect.champagne') %></option>
           </select>
         </div>
         <div>
ATLETA_PATCH
````

Add the 5 new texts to all seven locale files, after `overlayBuilder.anim.effect.tiremarks`:

````bash
node - <<'ATLETA_SCRIPT'
const fs = require('fs');
const add = {
 "en": {
  "overlayBuilder.anim.effect.smoke": "Tyre Smoke",
  "overlayBuilder.anim.effect.checker": "Chequered Confetti",
  "overlayBuilder.anim.effect.speed": "Speed Lines",
  "overlayBuilder.anim.effect.sparks": "Titanium Sparks",
  "overlayBuilder.anim.effect.champagne": "Champagne"
 },
 "pt": {
  "overlayBuilder.anim.effect.smoke": "Fumaça de Pneu",
  "overlayBuilder.anim.effect.checker": "Confete Quadriculado",
  "overlayBuilder.anim.effect.speed": "Linhas de Velocidade",
  "overlayBuilder.anim.effect.sparks": "Faíscas de Titânio",
  "overlayBuilder.anim.effect.champagne": "Champanhe"
 },
 "es": {
  "overlayBuilder.anim.effect.smoke": "Humo de Neumáticos",
  "overlayBuilder.anim.effect.checker": "Confeti a Cuadros",
  "overlayBuilder.anim.effect.speed": "Líneas de Velocidad",
  "overlayBuilder.anim.effect.sparks": "Chispas de Titanio",
  "overlayBuilder.anim.effect.champagne": "Champán"
 },
 "fr": {
  "overlayBuilder.anim.effect.smoke": "Fumée de Pneus",
  "overlayBuilder.anim.effect.checker": "Confettis à Damier",
  "overlayBuilder.anim.effect.speed": "Lignes de Vitesse",
  "overlayBuilder.anim.effect.sparks": "Étincelles de Titane",
  "overlayBuilder.anim.effect.champagne": "Champagne"
 },
 "de": {
  "overlayBuilder.anim.effect.smoke": "Reifenqualm",
  "overlayBuilder.anim.effect.checker": "Zielflaggen-Konfetti",
  "overlayBuilder.anim.effect.speed": "Tempolinien",
  "overlayBuilder.anim.effect.sparks": "Titanfunken",
  "overlayBuilder.anim.effect.champagne": "Champagner"
 },
 "zh": {
  "overlayBuilder.anim.effect.smoke": "轮胎烟雾",
  "overlayBuilder.anim.effect.checker": "方格旗彩纸",
  "overlayBuilder.anim.effect.speed": "速度线",
  "overlayBuilder.anim.effect.sparks": "钛合金火花",
  "overlayBuilder.anim.effect.champagne": "香槟"
 },
 "ja": {
  "overlayBuilder.anim.effect.smoke": "タイヤスモーク",
  "overlayBuilder.anim.effect.checker": "チェッカー紙吹雪",
  "overlayBuilder.anim.effect.speed": "スピードライン",
  "overlayBuilder.anim.effect.sparks": "チタンの火花",
  "overlayBuilder.anim.effect.champagne": "シャンパン"
 }
};
const after = "overlayBuilder.anim.effect.tiremarks";
for (const [lang, texts] of Object.entries(add)) {
  const file = `src/locales/${lang}.json`;
  let lines = fs.readFileSync(file, 'utf8').split('\n');
  const at = lines.findIndex((l) => l.startsWith(`  ${JSON.stringify(after)}: `));
  if (at < 0) throw new Error(`${file}: ${after} not found`);
  lines.splice(at + 1, 0, ...Object.entries(texts).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`));
  fs.writeFileSync(file, lines.join('\n'));
  JSON.parse(fs.readFileSync(file, 'utf8'));   // still valid JSON
}
ATLETA_SCRIPT
````

- [ ] **Step 4: Run the task's tests, then the whole suite**

````bash
node --test src/services/overlayDesign.test.js tests/fx.test.js tests/overlayClient.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2716 tests on the C1 branch at 040b180 with Tasks 1–11).

- [ ] **Step 5: Commit**

````bash
git add public/overlay/fx.css public/overlay/fx.js public/overlay/overlay.js src/locales/de.json src/locales/en.json src/locales/es.json src/locales/fr.json src/locales/ja.json src/locales/pt.json src/locales/zh.json src/routes/overlay.js src/services/overlayDesign.js src/views/overlay-builder.ejs src/services/overlayDesign.test.js tests/fx.test.js tests/overlayClient.test.js
git commit -m "feat(overlay): five new screen effects and the looks' sounds" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 12: A look's first alert waits for its fonts

Each family names its Google Fonts (spec 4.5, "Fonts").

- The overlay asks for a family's fonts once, in one stylesheet. It does so for every look the designs name, and for the giveaway's default look, on connecting and on each `config-update`.
- The first alert in a look waits for its fonts for at most 1.5 s, then plays with the fallback fonts.
- The browser can only wait for a font once the stylesheet has arrived, so the wait covers both.
- A Clear All during the wait cancels the alert.
- Today's objects, the C1 and the cards never wait.

**Files:**
- Modify: `public/overlay/overlay.js`
- Modify: `tests/overlayClient.test.js` (test)

**Interfaces:**
- Consumes: Task 1 (`families`, `fontNames`, `DEFAULT_LOOKS`), Task 10 (`objectFor`).
- Produces: In `overlay.js`: `familyFonts(familyKey) → Promise`, `whenLookReady(look, then)`, and `alertRun` (which counts Clear Alls).

- [ ] **Step 1: Write the failing tests**

Change `tests/overlayClient.test.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/tests/overlayClient.test.js b/tests/overlayClient.test.js
index 1ef5514..1d9c465 100644
--- a/tests/overlayClient.test.js
+++ b/tests/overlayClient.test.js
@@ -1035,3 +1035,66 @@ describe('the screen effect and the sound of a look (alert styles)', () => {
     assert.equal(effects(overlay, 'fx-smoke'), 20);
   });
 });
+
+describe('the fonts of the looks (alert styles)', () => {
+  const giveaway = () => ({ type: 'giveaway_winner', data: { username: 'RacerDan', prize: 'Season pass' } });
+  const fontLinks = (overlay) => overlay.sandbox.document.head.children.filter((c) => /fonts\.googleapis\.com/.test(c.href || ''));
+  // A browser's FontFaceSet: load() resolves when the test says so.
+  const fontSet = () => {
+    const waiting = [];
+    return { waiting, load: () => new Promise((resolve) => waiting.push(resolve)) };
+  };
+  const settle = () => new Promise((resolve) => setImmediate(resolve));
+
+  test('each family a design names, and the giveaway\'s default look, is asked for once, on connecting and on each update', () => {
+    const overlay = loadOverlay({ styles: true, designs: { follow: design({ style: 'follow-racing' }) } });
+    assert.equal(fontLinks(overlay).length, 1, 'Racing once: the follow\'s look and the giveaway\'s default');
+    assert.match(fontLinks(overlay)[0].href, /family=Kanit:ital,wght@0,800;0,900;1,800;1,900&family=Barlow\+Condensed:[^&]+&display=swap$/);
+    overlay.send({ type: 'config-update', designs: { giveaway_winner: design({ style: 'giveaway-samurai' }) } });
+    overlay.send({ type: 'config-update', designs: { giveaway_winner: design({ style: 'giveaway-samurai' }) } });
+    assert.equal(fontLinks(overlay).length, 2);
+    assert.match(fontLinks(overlay)[1].href, /family=Noto\+Serif\+JP:wght@700&display=swap$/);
+  });
+
+  test('the first alert in a look waits for its fonts, at most 1.5 s, then plays with the fallbacks', () => {
+    const overlay = loadOverlay({ styles: true });
+    overlay.sandbox.document.fonts = fontSet();
+    overlay.send(giveaway());
+    assert.equal(overlay.slots().length, 0, 'waiting for Kanit');
+    overlay.clock.advance(1499);
+    assert.equal(overlay.slots().length, 0);
+    overlay.clock.advance(1);
+    assert.equal(overlay.slots().length, 1);
+  });
+
+  test('fonts that arrive in time start it at once, and the next alert in that look does not wait', async () => {
+    const overlay = loadOverlay({ styles: true });
+    const fonts = fontSet();
+    overlay.sandbox.document.fonts = fonts;
+    overlay.send(giveaway());
+    fontLinks(overlay)[0].onload();
+    await settle();
+    fonts.waiting.forEach((resolve) => resolve([]));
+    await settle();
+    assert.equal(overlay.slots().length, 1, 'before the 1.5 s were up');
+    overlay.send({ type: 'clear' });
+    overlay.send(giveaway());
+    assert.equal(overlay.slots().length, 1, 'at once');
+  });
+
+  test('Clear All while a first alert waits for its fonts: it never shows', () => {
+    const overlay = loadOverlay({ styles: true });
+    overlay.sandbox.document.fonts = fontSet();
+    overlay.send(giveaway());
+    overlay.send({ type: 'clear' });
+    overlay.clock.advance(5000);
+    assert.equal(overlay.slots().length, 0);
+  });
+
+  test('today\'s objects and the cards never wait', () => {
+    const overlay = loadOverlay({ styles: true });
+    overlay.sandbox.document.fonts = fontSet();
+    overlay.send(follow());
+    assert.equal(overlay.slots().length, 1);
+  });
+});
ATLETA_PATCH
````

- [ ] **Step 2: Run them and see them fail**

````bash
node --test tests/overlayClient.test.js
````

Expected: FAIL: 3 failing (the font links and the wait); 112 pass.

- [ ] **Step 3: Write the code**

Change `public/overlay/overlay.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/public/overlay/overlay.js b/public/overlay/overlay.js
index 1973fe8..df748a5 100644
--- a/public/overlay/overlay.js
+++ b/public/overlay/overlay.js
@@ -151,6 +151,58 @@ function loadDesignFonts(designs) {
     link.href = `https://fonts.googleapis.com/css2?family=${FONT_MAP[f]}&display=swap`;
     document.head.appendChild(link);
   });
+  // The fonts of the looks the designs name, and of the giveaway's default look
+  const kit = window.ATLETA_KIT;
+  const styles = window.ATLETA_OBJECT_STYLES || {};
+  if (!kit) return;
+  Object.values(designs).map((d) => d && d.style).concat(Object.values(kit.DEFAULT_LOOKS)).forEach((styleId) => {
+    const look = styleId && Object.prototype.hasOwnProperty.call(styles, styleId) ? styles[styleId] : null;
+    if (look && look.family) familyFonts(look.family);
+  });
+}
+
+// A look family's Google Fonts (kit.js: each family file lists its own), in one stylesheet asked for
+// once. Resolves when the stylesheet has arrived or failed: only then can the browser wait for a font.
+const familyFontSheets = {};
+function familyFonts(familyKey) {
+  const kit = window.ATLETA_KIT;
+  const family = kit && kit.families[familyKey];
+  if (!family || !family.fonts.length) return Promise.resolve();
+  if (!familyFontSheets[familyKey]) {
+    familyFontSheets[familyKey] = new Promise((resolve) => {
+      const link = document.createElement('link');
+      link.rel = 'stylesheet';
+      link.href = 'https://fonts.googleapis.com/css2?' + family.fonts.map((spec) => `family=${spec}`).join('&') + '&display=swap';
+      link.onload = resolve;
+      link.onerror = resolve;
+      document.head.appendChild(link);
+    });
+  }
+  return familyFontSheets[familyKey];
+}
+
+// The first alert in a look waits for its family's fonts, at most 1.5 s, then plays with the
+// fallbacks; after that the family is ready and its alerts play at once. Today's objects, the C1
+// and the cards never wait, nor does a page without the FontFaceSet API.
+const readyFamilies = new Set();
+function whenLookReady(look, then) {
+  const kit = window.ATLETA_KIT;
+  const fonts = document.fonts;
+  if (!look || !look.family || readyFamilies.has(look.family) || !kit || !fonts || typeof fonts.load !== 'function') {
+    then();
+    return;
+  }
+  let started = false;
+  const start = () => {
+    if (started) return;
+    started = true;
+    readyFamilies.add(look.family);
+    then();
+  };
+  alertTimer(start, 1500);
+  familyFonts(look.family)
+    .then(() => Promise.all(kit.fontNames(look.family).map((name) => fonts.load(`700 1em "${name}"`))))
+    .then(start, start);
 }
 
 // Synthesized notification sounds using Web Audio API
@@ -434,7 +486,10 @@ function connectSSE() {
 
 connectSSE();
 
+// Counts Clear Alls, so an alert that was waiting for its fonts (whenLookReady) knows it was cleared.
+let alertRun = 0;
 function clearOverlay() {
+  alertRun++;
   queue.length = 0;
   isPlaying = false;
   alertTimers.forEach((id) => clearTimeout(id));
@@ -452,7 +507,8 @@ function playNext() {
   if (event.type === 'redemption') {
     playRedemption(event);
   } else {
-    showNotification(event);
+    const run = alertRun;
+    whenLookReady(objectFor(event.type), () => { if (run === alertRun) showNotification(event); });
   }
 }
 
ATLETA_PATCH
````

- [ ] **Step 4: Run the task's tests, then the whole suite**

````bash
node --test tests/overlayClient.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2721 tests on the C1 branch at 040b180 with Tasks 1–12).

- [ ] **Step 5: Commit**

````bash
git add public/overlay/overlay.js tests/overlayClient.test.js
git commit -m "feat(overlay): a look's first alert waits for its fonts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 13: The builder's Style rules

`public/js/builder-styles-core.js` holds the Style section's rules that need no page (spec 4.6). It is dual-exported
and tested, like `dashboard-cards-core.js`. It decides:

- which alerts have looks;
- what picking another look does to the working design (the same reset the server makes);
- the look the page shows: the picked or saved one, else the default;
- how an alert nobody has restyled is shown: with its look's own settings, not an older builder's effect and speed (the giveaway keeps its saved ones);
- which controls a look shows;
- the gallery's order: "Made for you", then the default look (marked "Today", or "Default" for the giveaway), then the rest;
- the save's body.

**Files:**
- Create: `public/js/builder-styles-core.js`
- Create: `tests/builderStylesCore.test.js` (test)

**Interfaces:**
- Consumes: Task 1 (`ALERTS`); Task 5 (`DEFAULT_STYLES`) in its tests.
- Produces: `window.ATLETA_BUILDER_STYLES`:
  - `STYLED_ALERTS`, `isStyled(type)`
  - `withLook(design, previousStyle, nextStyle)`, `shownStyle(type, alertStyles, defaults)`, `untouched(type, design, storedStyle)`
  - `controlsFor(look) → { accent, racing, label, speed, effect, sound, grows }`
  - `orderGallery(entries, type, defaults) → [{ id, family, badge }]`, `filterGallery(ordered, family)`
  - `savePayload(type, design, style)`

- [ ] **Step 1: Write the failing tests**

Create `tests/builderStylesCore.test.js`:

````bash
mkdir -p tests && cat > tests/builderStylesCore.test.js <<'ATLETA_FILE'
'use strict';

// public/js/builder-styles-core.js: the Overlay Builder's Style section, the parts that need no page.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const core = require('../public/js/builder-styles-core.js');
const K = require('../public/overlay/objects/kit.js');
require('../public/overlay/objects/styles/samurai.js');
require('../public/overlay/objects/styles/racing.js');
const { DEFAULT_STYLES } = require('../src/services/alertStyles');

describe('the six alerts that have looks', () => {
  test('are the Twitch five and the giveaway; YouTube\'s and timed messages keep today\'s card', () => {
    assert.deepEqual(core.STYLED_ALERTS, ['follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner']);
    assert.deepEqual(core.STYLED_ALERTS, K.ALERTS, 'the kit\'s six');
    assert.equal(core.isStyled('yt_member'), false);
  });
});

describe('picking another look', () => {
  const design = { style_accent: '#29E0FF', style_label: 'Hi', style_sound: 'rcFlyby', style_grows: 0, screen_effect: 'gold', animation_speed: 1.5, card_width: 560, card_position: 'bot-left', bg_color: '#123456' };

  test('starts the look from its own settings, as the server does; where it sits and its colours stay', () => {
    assert.deepEqual(core.withLook(design, 'follow-samurai', 'follow-racing'), {
      ...design, style_accent: null, style_label: null, style_sound: null, style_grows: null, screen_effect: 'default', animation_speed: 1,
    });
  });

  test('the same look again changes nothing, and the design given is never changed', () => {
    assert.deepEqual(core.withLook(design, 'follow-racing', 'follow-racing'), design);
    assert.deepEqual(core.withLook(design, null, null), design);
    const copy = { ...design };
    core.withLook(design, 'a', 'b');
    assert.deepEqual(design, copy);
  });
});

describe('the look the page shows', () => {
  test('the one picked or saved, else the alert\'s default look; nothing for the other tabs', () => {
    assert.equal(core.shownStyle('follow', { follow: 'follow-racing' }, DEFAULT_STYLES), 'follow-racing');
    assert.equal(core.shownStyle('follow', {}, DEFAULT_STYLES), 'follow-samurai');
    assert.equal(core.shownStyle('giveaway_winner', {}, DEFAULT_STYLES), 'giveaway-racing');
    assert.equal(core.shownStyle('yt_member', {}, DEFAULT_STYLES), null);
  });

  test('an alert nobody has restyled shows its look\'s own settings, not what an older builder saved for the card', () => {
    const old = { screen_effect: 'confetti', animation_speed: 1.8, card_width: 600 };
    assert.deepEqual(core.untouched('follow', old, null), { ...old, style_accent: null, style_label: null, style_sound: null, style_grows: null, screen_effect: 'default', animation_speed: 1 });
    assert.deepEqual(core.untouched('follow', old, 'follow-samurai'), old, 'a look was picked: what is saved is its settings');
    assert.deepEqual(core.untouched('giveaway_winner', old, null), old, 'the giveaway\'s effect and speed carry over to its Victory lap');
    assert.deepEqual(core.untouched('yt_member', old, null), old);
  });
});

describe('the controls a look shows', () => {
  test('the samurai presets: the colour; the omikuji: the colour, the main text and the speed', () => {
    assert.deepEqual(core.controlsFor(K.styles['follow-samurai']), { accent: true, racing: false, label: false, speed: false, effect: true, sound: true, grows: false });
    assert.deepEqual(core.controlsFor(K.styles['giveaway-samurai']), { accent: true, racing: false, label: true, speed: true, effect: true, sound: true, grows: false });
  });

  test('Racing: its card, accent and name colours and the name\'s font; growing where it has an amount', () => {
    assert.deepEqual(core.controlsFor(K.styles['bits-racing']), { accent: false, racing: true, label: true, speed: true, effect: true, sound: true, grows: true });
    assert.equal(core.controlsFor(K.styles['follow-racing']).grows, false);
  });

  test('today\'s object and the C1: the sound only; a legacy card: nothing', () => {
    const OBJECTS = require('../public/overlay/objects/index.js');
    for (const look of [OBJECTS.follow, OBJECTS.STYLES['donation-c1']]) {
      assert.deepEqual(core.controlsFor(look), { accent: false, racing: false, label: false, speed: false, effect: false, sound: true, grows: false });
    }
    assert.deepEqual(core.controlsFor(null), { accent: false, racing: false, label: false, speed: false, effect: false, sound: false, grows: false });
  });
});

describe('the gallery', () => {
  const entries = [
    { id: 'donation-c1', family: null, mine: true },
    { id: 'donation-samurai', family: 'samurai', mine: false },
    { id: 'donation-racing', family: 'racing', mine: false },
  ];

  test('a look made for the streamer first, then the alert\'s default look, then the rest in family order', () => {
    assert.deepEqual(core.orderGallery(entries, 'donation', DEFAULT_STYLES), [
      { id: 'donation-c1', family: null, badge: 'mine' },
      { id: 'donation-samurai', family: 'samurai', badge: 'today' },
      { id: 'donation-racing', family: 'racing', badge: null },
    ]);
  });

  test('the giveaway\'s default look is marked "default": it is not today\'s card', () => {
    const giveaway = [{ id: 'giveaway-samurai', family: 'samurai', mine: false }, { id: 'giveaway-racing', family: 'racing', mine: false }];
    assert.deepEqual(core.orderGallery(giveaway, 'giveaway_winner', DEFAULT_STYLES).map((e) => [e.id, e.badge]),
      [['giveaway-racing', 'default'], ['giveaway-samurai', null]]);
  });

  test('a family filter keeps that family\'s looks; "all" keeps every look', () => {
    const ordered = core.orderGallery(entries, 'donation', DEFAULT_STYLES);
    assert.deepEqual(core.filterGallery(ordered, 'racing').map((e) => e.id), ['donation-racing']);
    assert.equal(core.filterGallery(ordered, 'all').length, 3);
  });
});

describe('what a save sends', () => {
  test('the alert, its design, and for the six the look the page shows', () => {
    assert.deepEqual(core.savePayload('follow', { card_width: 420 }, 'follow-racing'), { eventType: 'follow', design: { card_width: 420 }, style: 'follow-racing' });
    assert.deepEqual(core.savePayload('follow', {}, undefined), { eventType: 'follow', design: {}, style: null });
  });

  test('YouTube\'s alerts and timed messages send no look: the server keeps theirs as it is', () => {
    assert.deepEqual(core.savePayload('yt_member', {}, 'follow-racing'), { eventType: 'yt_member', design: {} });
  });
});

test('dual export: a browser global with the same functions', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'builder-styles-core.js'), 'utf8'), { window });
  assert.deepEqual(Object.keys(window.ATLETA_BUILDER_STYLES).sort(), Object.keys(core).sort());
});
ATLETA_FILE
````

- [ ] **Step 2: Run them and see them fail**

````bash
node --test tests/builderStylesCore.test.js
````

Expected: FAIL: the test file cannot load the core yet (1 failing).

- [ ] **Step 3: Write the code**

Create `public/js/builder-styles-core.js`:

````bash
mkdir -p public/js && cat > public/js/builder-styles-core.js <<'ATLETA_FILE'
'use strict';

/**
 * The Overlay Builder's Style section (docs/superpowers/specs/2026-10-15-alert-styles-design.md, 4.6),
 * the parts that need no page: which alerts have looks, which controls a look shows, what picking
 * another look does to the working design, the gallery's order and what a save sends. The page code
 * is in src/views/overlay-builder.ejs. Dual-exported: a browser global for <script src>, CommonJS
 * for tests/builderStylesCore.test.js.
 */
(function (root) {
  // The six alerts that have looks; YouTube's alerts and timed messages keep today's card.
  var STYLED_ALERTS = ['follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner'];
  function isStyled(type) { return STYLED_ALERTS.indexOf(type) >= 0; }

  function copy(design) {
    var out = {}, k;
    for (k in design) if (Object.prototype.hasOwnProperty.call(design, k)) out[k] = design[k];
    return out;
  }

  // A look's settings, as another look starts them (the server does the same in
  // db.setOverlayDesignStyle): its colour, main text, sound and growing with the amount empty (the
  // look's own), the screen effect 'default' (the look's own) and the speed 1. Where the alert sits,
  // its width and Racing's colours stay.
  var LOOK_SETTINGS = { style_accent: null, style_label: null, style_sound: null, style_grows: null, screen_effect: 'default', animation_speed: 1 };
  function startLook(design) {
    var out = copy(design), k;
    for (k in LOOK_SETTINGS) out[k] = LOOK_SETTINGS[k];
    return out;
  }
  function withLook(design, previousStyle, nextStyle) {
    return (previousStyle || null) === (nextStyle || null) ? copy(design) : startLook(design);
  }

  // The look the page shows for an alert: the one picked or saved, else the alert's default look
  // (the server's DEFAULT_STYLES, services/alertStyles.js); null for the tabs without looks.
  function shownStyle(type, alertStyles, defaults) {
    if (!isStyled(type)) return null;
    return (alertStyles && alertStyles[type]) || (defaults && defaults[type]) || null;
  }

  // An alert nobody has restyled since the looks came (no stored look) is shown with its default
  // look's own settings: what an older builder saved for today's card (an effect, a speed) is not
  // what the OBS overlay plays, so the builder does not show it either. The giveaway keeps its
  // saved effect and speed: they carry over to its Victory lap.
  function untouched(type, design, storedStyle) {
    if (storedStyle || !isStyled(type) || type === 'giveaway_winner') return design;
    return startLook(design);
  }

  // The controls a look shows (its `controls`, objects/kit.js): its colour (the accent, or Racing's
  // card, accent and name colours and the name's font), its main text and its speed; the screen
  // effect for a look of the styles (today's objects and the C1 never play one); the sound for
  // every look; growing with the amount where the look grows.
  function controlsFor(look) {
    var c = (look && look.controls) || {};
    return {
      accent: c.colour === 'accent', racing: c.colour === 'racing', label: !!c.label, speed: !!c.speed,
      effect: !!(look && look.family), sound: !!look, grows: !!(look && look.grows),
    };
  }

  // One alert's gallery (the server's entries { id, family, mine }, in family order): a look made for
  // this streamer first ('mine', "Made for you"), then the alert's default look ('today', or 'default'
  // for the giveaway, whose default is not today's card), then the others.
  function orderGallery(entries, type, defaults) {
    var def = defaults && defaults[type];
    var mine = [], first = [], rest = [];
    (entries || []).forEach(function (e) {
      if (e.mine) mine.push({ id: e.id, family: e.family, badge: 'mine' });
      else if (e.id === def) first.push({ id: e.id, family: e.family, badge: type === 'giveaway_winner' ? 'default' : 'today' });
      else rest.push({ id: e.id, family: e.family, badge: null });
    });
    return mine.concat(first, rest);
  }
  // The gallery for a family filter: 'all', or one family's looks.
  function filterGallery(ordered, family) {
    return family === 'all' ? ordered.slice() : ordered.filter(function (e) { return e.family === family; });
  }

  // The body of a save: the alert, its design, and for the six alerts the look the page shows.
  function savePayload(type, design, style) {
    var body = { eventType: type, design: design };
    if (isStyled(type)) body.style = style || null;
    return body;
  }

  var CORE = {
    STYLED_ALERTS: STYLED_ALERTS, isStyled: isStyled, withLook: withLook, shownStyle: shownStyle, untouched: untouched,
    controlsFor: controlsFor, orderGallery: orderGallery, filterGallery: filterGallery, savePayload: savePayload,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (root) root.ATLETA_BUILDER_STYLES = CORE;
})(typeof window !== 'undefined' ? window : null);
ATLETA_FILE
````

- [ ] **Step 4: Run the task's tests, then the whole suite**

````bash
node --test tests/builderStylesCore.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2735 tests on the C1 branch at 040b180 with Tasks 1–13).

- [ ] **Step 5: Commit**

````bash
git add public/js/builder-styles-core.js tests/builderStylesCore.test.js
git commit -m "feat(overlay-builder): the Style section's rules" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 14: The builder's Style section

Each of the six alert tabs opens with a Style section (spec 4.6). It holds:

- **family filters**, and a **gallery** of the alert's looks, drawn with the same files as OBS. Each tile shows the look at rest and plays it when hovered or focused, one at a time.
- **"Use <family> for all six alerts"**.
- **the look's controls**:
  - its colour: eight swatches, a colour picker and "the look's own" (for Racing: the card, accent and name colours, and the name's font);
  - its main text and its speed;
  - on top of the look: the screen effect, the sound (grouped by family, with ▶ to listen) and "grows with the amount".
- **Test**, which plays the look in the preview and, through the existing test route, in OBS.

How it behaves:

- The controls write the fields the save sends, and mirror today's hidden controls where `getControlValues()` reads them.
- Save sends the look the page shows; Discard and Reset put back the saved look.
- The preview draws a look with its design as OBS does, and scales a look of the styles to the width.
- The notice that said colours would come back is gone.

The route hands the page each alert's gallery, the default looks, the families, sounds and fonts, all named in the
streamer's language, plus every family's fonts in one stylesheet. That is 33 section texts plus the names of 2
families, 13 looks and 11 sounds, in all seven languages.

A real-browser run of this page caught one thing the unit tests cannot: a row's own `display` rule wins over the
`hidden` attribute, so hidden rows stayed on screen. `#section-style [hidden] { display: none; }` fixes it, and a
test pins it.

**Files:**
- Modify: `src/locales/de.json`
- Modify: `src/locales/en.json`
- Modify: `src/locales/es.json`
- Modify: `src/locales/fr.json`
- Modify: `src/locales/ja.json`
- Modify: `src/locales/pt.json`
- Modify: `src/locales/zh.json`
- Modify: `src/routes/dashboard.js`
- Modify: `src/views/overlay-builder.ejs`
- Modify: `src/routes/dashboard.test.js` (test)
- Modify: `src/services/overlayDesign.test.js` (test)
- Modify: `tests/i18n.test.js` (test)
- Modify: `tests/overlayBuilder.test.js` (test)
- Modify: `tests/streamerViewsI18n.test.js` (test)

**Interfaces:**
- Consumes: Tasks 1, 5, 6, 10, 11 and 13; the C1 branch's `ALERT_STYLES` and `previewObjectFor`.
- Produces: - Template locals `styleData` (JSON) and `styleFontsHref`.
  - In the builder: `shownLook`, `restoreSavedLook`, `lookHtml`, `setLookVars`, `sizeLookHost`, `playLookIn`, `renderStyleSection`, `renderStyleGallery`, `pickLook`, `syncStyleControls`, `setLookSetting`, `initStyleControls`, `listenToLookSound`, `useStyleFamily` and `testLook`.
  - Keys `overlayBuilder.style.*`, `overlayBuilder.families.*`, `overlayBuilder.looks.*` and `overlayBuilder.sounds.*`.

- [ ] **Step 1: Write the failing tests**

Change `src/routes/dashboard.test.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/src/routes/dashboard.test.js b/src/routes/dashboard.test.js
index 3b22bac..5ec6af1 100644
--- a/src/routes/dashboard.test.js
+++ b/src/routes/dashboard.test.js
@@ -324,6 +324,9 @@ function addStreamer(over = {}) {
   return Number(info.lastInsertRowid);
 }
 const discordId = (streamerId) => db.getStreamerById(streamerId).discord_user_id;
+// andre_vilela_, for whom the C1 donation look was made (found by his Twitch user id, which is unique)
+const c1Owner = () => db.db.prepare('SELECT id FROM streamers WHERE twitch_user_id = ?').get('632557806')?.id
+  ?? addStreamer({ twitch_username: 'andre_vilela_', twitch_user_id: '632557806' });
 const count = (table, where = '1', ...params) => db.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params).n;
 const messageOf = (res) => new URL(res.headers.location, 'http://x').searchParams.get('msg');
 
@@ -2718,7 +2721,7 @@ describe('the look an alert is drawn in (alert styles)', () => {
   });
 
   test('a look made for one streamer is theirs alone', async () => {
-    const vilela = addStreamer({ twitch_user_id: '632557806' });
+    const vilela = c1Owner();
     assert.equal((await save('donation', 'donation-c1', {}, vilela)).status, 200);
     assert.equal(rowOf('donation', vilela).style, 'donation-c1');
     const res = await save('donation', 'donation-c1');
@@ -2816,6 +2819,24 @@ describe('the overlay builder page and a slow Twitch', () => {
     }
   });
 
+  test('hands the Style section each alert\'s gallery, the default looks, the families, sounds and fonts, named in the streamer\'s language', async () => {
+    const { locals } = (await builder()).json();
+    const data = JSON.parse(locals.styleData);
+    assert.deepEqual(Object.keys(data.gallery).sort(), ['bits', 'donation', 'follow', 'giveaway_winner', 'raid', 'subscription']);
+    assert.equal(data.defaults.giveaway_winner, 'giveaway-racing');
+    assert.ok(!data.gallery.donation.some((e) => e.id === 'donation-c1'), 'the C1 is not this streamer\'s');
+    assert.equal(data.looks['follow-racing'].title, t('en', 'overlayBuilder.looks.follow-racing.title'));
+    assert.deepEqual(data.families.slice(0, 2).map((f) => [f.key, f.name]), [['samurai', t('en', 'overlayBuilder.families.samurai.name')], ['racing', t('en', 'overlayBuilder.families.racing.name')]]);
+    assert.ok(data.sounds[0].sounds.some((s) => s.key === 'samuraiBell' && s.name === t('en', 'overlayBuilder.sounds.samuraiBell')));
+    assert.equal(data.fonts[0], 'System Default');
+    assert.match(locals.styleFontsHref, /^https:\/\/fonts\.googleapis\.com\/css2\?family=Noto\+Serif\+JP:wght@700&family=Kanit:[^&]+&family=Barlow\+Condensed:[^&]+&display=swap$/);
+  });
+
+  test('the C1\'s owner finds it first in the donation gallery', async () => {
+    const res = await request('GET', '/dashboard/overlay-builder', { streamer: c1Owner(), json: true });
+    assert.deepEqual(JSON.parse(res.json().locals.styleData).gallery.donation[0], { id: 'donation-c1', family: null, mine: true });
+  });
+
   test('loads the alert looks the OBS overlay loads: the kit and the joined family files, at their version', async () => {
     const { bundle } = require('../services/alertStyleBundle');
     const { locals } = (await builder()).json();
ATLETA_PATCH
````

Change `src/services/overlayDesign.test.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/src/services/overlayDesign.test.js b/src/services/overlayDesign.test.js
index 47aad1d..52384e7 100644
--- a/src/services/overlayDesign.test.js
+++ b/src/services/overlayDesign.test.js
@@ -219,7 +219,7 @@ describe('numbers match the builder\'s controls', () => {
     const controls = {
       username_size: ['ctrl-username-size', 'modal-username-size'], card_width: ['ctrl-card-width'], border_radius: ['ctrl-border-radius'],
       label_font_size: ['modal-label-size'], detail_font_size: ['modal-detail-size'],
-      animation_speed: ['ctrl-animation-speed', 'modal-animation-speed'], effect_amount: ['ctrl-effect-amount', 'modal-effect-amount'],
+      animation_speed: ['ctrl-animation-speed', 'modal-animation-speed', 'style-speed'], effect_amount: ['ctrl-effect-amount', 'modal-effect-amount'],
       effect_size: ['ctrl-effect-size', 'modal-effect-size'], bg_opacity: ['modal-bg-opacity'], border_opacity: ['modal-border-opacity'],
       glow_intensity: ['modal-glow-intensity'], shadow_opacity: ['modal-shadow-opacity'], border_thickness: ['modal-border-thickness'],
       shadow_blur: ['modal-shadow-blur'], shadow_spread: ['modal-shadow-spread'],
@@ -280,7 +280,7 @@ describe('drop-down choices', () => {
   test('match the options the builder offers', () => {
     for (const id of ['ctrl-entrance-animation', 'modal-entrance-animation']) same(FIELD_SPECS.entrance_animation.values, optionsOf(id));
     for (const id of ['ctrl-car-animation', 'modal-car-animation']) same(FIELD_SPECS.car_animation.values, optionsOf(id));
-    for (const id of ['ctrl-screen-effect', 'modal-screen-effect']) same(FIELD_SPECS.screen_effect.values, optionsOf(id));
+    for (const id of ['ctrl-screen-effect', 'modal-screen-effect', 'style-effect']) same(FIELD_SPECS.screen_effect.values, optionsOf(id));
     for (const id of ['ctrl-effect-direction', 'modal-effect-direction']) same(FIELD_SPECS.effect_direction.values, optionsOf(id));
     same(FIELD_SPECS.sponsor_animation.values, optionsOf('ctrl-sponsor-animation'));
     same(FIELD_SPECS.gradient_direction.values, optionsOf('modal-gradient-direction'));
@@ -376,6 +376,10 @@ describe('the builder\'s free-text inputs stop where the server cuts', () => {
     for (const id of ['ctrl-detail-text', 'modal-detail-text']) assert.equal(maxlengthOf(id), FIELD_SPECS.detail_text.max, id);
   });
 
+  test('the look\'s main text is held to 40 characters where it is typed', () => {
+    assert.equal(maxlengthOf('style-label'), FIELD_SPECS.style_label.max);
+  });
+
   test('every free-text input of the builder has one, so the server\'s cut is never silent', () => {
     const textInputs = [...builder.matchAll(/<input[^>]*type="text"[^>]*id="((?:ctrl|modal)-(?:event-label|detail-text))"/g)].map((m) => m[1]);
     assert.deepEqual(textInputs.sort(), ['ctrl-detail-text', 'ctrl-event-label', 'modal-detail-text', 'modal-event-label']);
ATLETA_PATCH
````

Change `tests/i18n.test.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/tests/i18n.test.js b/tests/i18n.test.js
index 63572e2..a8c3095 100644
--- a/tests/i18n.test.js
+++ b/tests/i18n.test.js
@@ -15,6 +15,7 @@ const { test, describe } = require('node:test');
 const assert = require('node:assert/strict');
 const fs = require('node:fs');
 const path = require('node:path');
+const alertStyles = require('../src/services/alertStyles');
 const { SUPPORTED_LANGS } = require('../src/i18n');
 
 const ROOT = path.join(__dirname, '..');
@@ -118,6 +119,11 @@ const DYNAMIC_KEY_FAMILIES = {
   'guild.subRoleProblem.': ['missing', 'everyone', 'managed', 'privileged', 'above_bot'],
   // routes/dashboard.js: t(`report.analyze.${blocked}`); the reasons of analysisBlockedReason() in services/issueAnalysis.js
   'report.analyze.': ['done', 'analyzing'],
+  // routes/dashboard.js, the Overlay Builder's Style section: every family's, look's and look sound's name, from the
+  // catalogue (services/alertStyles.js), so a new family's texts are checked as soon as its file is added
+  'overlayBuilder.families.': alertStyles.familyKeys().flatMap((key) => [`${key}.name`, `${key}.desc`]),
+  'overlayBuilder.looks.': alertStyles.lookIds().concat(Object.keys(alertStyles.PRIVATE_STYLES)).flatMap((id) => [`${id}.title`, `${id}.desc`]),
+  'overlayBuilder.sounds.': alertStyles.soundGroups().flatMap((group) => group.sounds),
 };
 
 // What counts as naming a key:
ATLETA_PATCH
````

Change `tests/overlayBuilder.test.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/tests/overlayBuilder.test.js b/tests/overlayBuilder.test.js
index 1555415..9d2ae79 100644
--- a/tests/overlayBuilder.test.js
+++ b/tests/overlayBuilder.test.js
@@ -143,6 +143,7 @@ describe("an alert's saved style (andre_vilela_'s C1)", () => {
 
   test('the stored styles are read once from the server\'s designs, apart from the working copy', () => {
     assert.match(builder, /const ALERT_STYLES = \{\};\s*SERVER_DESIGNS\.forEach\(d => \{ if \(d\.style\) ALERT_STYLES\[d\.event_type\] = d\.style; \}\);/);
+    assert.match(builder, /const SAVED_STYLES = Object\.assign\(\{\}, ALERT_STYLES\);/, 'and kept as saved, apart from the look the page shows');
   });
 
   test('the preview and the controls use that pick, never the alert\'s own object directly', () => {
@@ -151,11 +152,11 @@ describe("an alert's saved style (andre_vilela_'s C1)", () => {
     assert.ok(!/ATLETA_OBJECTS\[currentType\]/.test(builder), 'no lookup skips the style');
   });
 
-  test('Reset and Discard leave the stored style alone (the server keeps it), and no save sends one', () => {
-    for (const name of ['resetCurrentDesign', 'discardChanges', 'saveCurrentDesign']) {
-      assert.ok(!functionSource(name).includes('ALERT_STYLES'), name);
-    }
-    assert.ok(!/\bstyle\s*:/.test(functionSource('getControlValues')), 'the saved payload has no style');
+  test('a save sends the look the page shows next to the design; Discard and Reset put back the saved look', () => {
+    assert.match(functionSource('saveCurrentDesign'), /STYLE_CORE\.savePayload\(currentType, design, style\)/);
+    assert.match(functionSource('saveCurrentDesign'), /SAVED_STYLES\[currentType\] = ALERT_STYLES\[currentType\] = style/);
+    for (const name of ['discardChanges', 'resetCurrentDesign']) assert.match(functionSource(name), /restoreSavedLook\(currentType\)/, name);
+    assert.ok(!/\bstyle\s*:/.test(functionSource('getControlValues')), 'the look travels next to the design, not in it');
   });
 
   test('the car drives in from the edge of the preview screen (the 1920px canvas, scaled)', () => {
@@ -218,3 +219,62 @@ describe("an alert's saved style (andre_vilela_'s C1)", () => {
     assert.equal(pickPreview(looks, 'follow', undefined), OBJECTS.follow, 'the five keep today\'s object');
   });
 });
+
+describe('the Style section (alert styles)', () => {
+  const vm = require('node:vm');
+
+  test('opens the six alerts\' tabs, above the card controls it replaces', () => {
+    const style = builder.indexOf('id="section-style"');
+    assert.ok(style > 0 && style < builder.indexOf('id="section-theme"'));
+    assert.ok(!builder.includes('phase1-notice'), 'the notice saying colours would come back is gone: they are here');
+  });
+
+  test('a control the look does not take is really hidden (its row\'s display rule does not win over [hidden])', () => {
+    assert.match(builder, /#section-style \[hidden\] \{ display: none; \}/);
+  });
+
+  test('the page loads the core and every family\'s fonts in one stylesheet', () => {
+    assert.match(builder, /<script src="\/js\/builder-styles-core\.js"><\/script>/);
+    assert.match(builder, /<link rel="stylesheet" href="<%= styleFontsHref %>">/);
+  });
+
+  test('an alert nobody has restyled is shown with its look\'s own settings', () => {
+    assert.match(builder, /STYLE_CORE\.STYLED_ALERTS\.forEach\(t => \{ workingDesigns\[t\] = STYLE_CORE\.untouched\(t, workingDesigns\[t\], SAVED_STYLES\[t\]\); \}\);/);
+  });
+
+  test('a picked look starts from its own settings and is drawn again', () => {
+    const src = functionSource('pickLook');
+    assert.match(src, /STYLE_CORE\.withLook\(getControlValues\(\), previous, id\)/);
+    assert.match(src, /renderedObjectType = null/);
+  });
+
+  test('the controls write the fields the save sends, and mirror today\'s hidden controls', () => {
+    const src = functionSource('initStyleControls');
+    for (const [id, mirror] of [['style-speed', 'ctrl-animation-speed'], ['style-effect', 'ctrl-screen-effect'], ['style-racing-card', 'ctrl-bg-color'], ['style-racing-accent', 'ctrl-accent-color']]) {
+      assert.ok(src.includes(`'${id}'`) && src.includes(`'${mirror}'`), `${id} -> ${mirror}`);
+    }
+    const values = functionSource('getControlValues');
+    for (const field of ['style_accent', 'style_label', 'style_sound', 'style_grows']) assert.ok(values.includes(`${field}:`), field);
+  });
+
+  test('the preview draws a look with its design, as OBS does, and scales a look of the styles to the width', () => {
+    const K = require('../public/overlay/objects/kit.js');
+    require('../public/overlay/objects/styles/samurai.js');
+    require('../public/overlay/objects/styles/racing.js');
+    const context = vm.createContext({ window: { ATLETA_KIT: K } });
+    vm.runInContext(functionSource('lookHtml') + functionSource('sizeLookHost'), context);
+    const html = vm.runInContext(`lookHtml(window.ATLETA_KIT.styles['follow-racing'], { event_label: 'Pit crew!' }, { username: 'ApexAndre' })`, context);
+    assert.match(html, />Pit crew!</, 'Racing\'s main text is the design\'s event_label');
+    assert.equal(vm.runInContext(`lookHtml({ key: 'x', family: 'samurai', render() { throw new Error('boom'); } }, {}, {})`, context), null, 'a look that throws draws nothing');
+    const host = { classes: new Set(), props: {} };
+    host.classList = { toggle: (c, on) => (on ? host.classes.add(c) : host.classes.delete(c)) };
+    host.style = { setProperty: (n, v) => { host.props[n] = v; }, removeProperty: (n) => { delete host.props[n]; } };
+    context.host = host;
+    vm.runInContext(`sizeLookHost(host, window.ATLETA_KIT.styles['raid-racing'], 630)`, context);
+    assert.ok(host.classes.has('look'));
+    assert.equal(host.props['--zw'], '1.5');
+    vm.runInContext(`sizeLookHost(host, window.ATLETA_KIT.styles['raid-samurai'], 630)`, context);
+    assert.ok(!host.classes.has('look'), 'today\'s looks reflow');
+    assert.match(builder, /#preview-object-host\.look > \.obj \{ width: 420px; zoom: var\(--zw, 1\); \}/);
+  });
+});
ATLETA_PATCH
````

Change `tests/streamerViewsI18n.test.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/tests/streamerViewsI18n.test.js b/tests/streamerViewsI18n.test.js
index 02f98ca..2c1e857 100644
--- a/tests/streamerViewsI18n.test.js
+++ b/tests/streamerViewsI18n.test.js
@@ -155,6 +155,8 @@ const accountPage = {
   notificationsByType: ['twitch_live', 'twitch_clip', 'twitch_recap', 'youtube_video', 'youtube_live', 'weekly_digest', 'twitch_milestone', 'other_type'].map((type, i) => ({ type, count: i + 1 })),
 };
 const statsPage = { total: 20, success_count: 18, fail_count: 2, live_count: 5, clip_count: 4, recap_count: 3, milestone_count: 2, youtube_video_count: 3, youtube_live_count: 1, digest_count: 2 };
+// The builder's Style section data, as routes/dashboard.js hands it (an empty catalogue is enough here).
+const STYLE_DATA = JSON.stringify({ defaults: {}, gallery: {}, looks: {}, families: [], sounds: [], fonts: ['System Default'] });
 const PAGE_LOCALS = {
   account: [accountPage, { ...accountPage, streamer: { ...streamer, created_at: null, profile_picture: null, discord_avatar: null }, notificationsOverTime: [], notificationsByType: [], feedbackMsg: undefined }],
   'report-issue': [{ streamer }],
@@ -188,8 +190,8 @@ const PAGE_LOCALS = {
   ],
   'overlay-builder': [
     { streamer, designs: '[]', sponsors: JSON.stringify([{ id: 1, filename: 'a.png', display_name: 'SponsorName', display_duration: 30, enabled: 1, image_scale: 1 }]),
-      eventDefaults: JSON.stringify(EVENT_DEFAULTS), stylesVersion: 'abc123def456', overlayUrl: 'https://app.test/overlay/tok123', streamThumbnail: 'https://img.test/t.jpg', features: { youtube: true, kick: true } },
-    { streamer, designs: '[]', sponsors: '[]', eventDefaults: JSON.stringify(EVENT_DEFAULTS), stylesVersion: 'abc123def456', overlayUrl: null, streamThumbnail: null, features: { youtube: false } },
+      eventDefaults: JSON.stringify(EVENT_DEFAULTS), stylesVersion: 'abc123def456', styleData: STYLE_DATA, styleFontsHref: 'https://fonts.googleapis.com/css2?family=Kanit&display=swap', overlayUrl: 'https://app.test/overlay/tok123', streamThumbnail: 'https://img.test/t.jpg', features: { youtube: true, kick: true } },
+    { streamer, designs: '[]', sponsors: '[]', eventDefaults: JSON.stringify(EVENT_DEFAULTS), stylesVersion: 'abc123def456', styleData: STYLE_DATA, styleFontsHref: 'https://fonts.googleapis.com/css2?family=Kanit&display=swap', overlayUrl: null, streamThumbnail: null, features: { youtube: false } },
   ],
   'chatbot-config': [
     chatbotPage,
ATLETA_PATCH
````

- [ ] **Step 2: Run them and see them fail**

````bash
node --test src/routes/dashboard.test.js src/services/overlayDesign.test.js tests/i18n.test.js tests/overlayBuilder.test.js tests/streamerViewsI18n.test.js
````

Expected: FAIL: 15 failing (the section, its data, its texts and the parity of its controls); 629 pass.

- [ ] **Step 3: Write the code**

Change `src/routes/dashboard.js`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/src/routes/dashboard.js b/src/routes/dashboard.js
index f2563a5..3bce74a 100644
--- a/src/routes/dashboard.js
+++ b/src/routes/dashboard.js
@@ -28,9 +28,9 @@ const {
 const { sponsorDurationSeconds, sponsorChatIntervalMinutes, sponsorImageScale, moderationNumber, moderationAction, parseSwitch } = require('../services/inputLimits');
 const { COMMAND_RESPONSE_MAX, COMMANDS_PER_STREAMER_MAX, COMMAND_ERRORS, parseCommand, singleLine, isUniqueViolation } = require('../services/chatCommands');
 const { testCooldown } = require('../services/testCooldown');
-const { EVENT_DEFAULTS, isBuilderEventType, validateOverlayDesign } = require('../services/overlayDesign');
+const { EVENT_DEFAULTS, OVERLAY_FONTS, isBuilderEventType, validateOverlayDesign } = require('../services/overlayDesign');
 const { bundle: alertStyleBundle } = require('../services/alertStyleBundle');
-const { canUseStyle, familyStyles } = require('../services/alertStyles');
+const { ALERTS: STYLED_ALERTS, DEFAULT_STYLES, canUseStyle, familyStyles, galleryFor, familyKeys, soundGroups, fontsOf } = require('../services/alertStyles');
 const { findStreamThumbnail, youtubeLiveStatus } = require('../services/pageLookups');
 const { ANALYSES_PER_DAY, analysisBlockedReason, dailyWindowStart, staleBefore } = require('../services/issueAnalysis');
 const { twitchRowsDue, youtubeRowsDue, backfillInBackground } = require('../services/channelInfoBackfill');
@@ -2662,6 +2662,27 @@ router.delete('/giveaways/:id', (req, res) => {
 
 // --- Overlay Builder ---
 
+// What the builder's Style section is handed (alert styles): each alert's gallery (a look made for
+// this streamer first), the default looks, the families and the sounds in the gallery's order, every
+// name in the streamer's language, and the fonts Racing's name can take. The page has every family's
+// code (styles.js), so it draws the looks itself.
+function builderStyleData(streamer, t) {
+  const gallery = {};
+  const looks = {};
+  for (const type of STYLED_ALERTS) {
+    gallery[type] = galleryFor(type, streamer);
+    for (const { id } of gallery[type]) looks[id] = { title: t(`overlayBuilder.looks.${id}.title`), desc: t(`overlayBuilder.looks.${id}.desc`) };
+  }
+  return {
+    defaults: DEFAULT_STYLES,
+    gallery,
+    looks,
+    families: familyKeys().map((key) => ({ key, name: t(`overlayBuilder.families.${key}.name`), desc: t(`overlayBuilder.families.${key}.desc`) })),
+    sounds: soundGroups().map(({ family, sounds }) => ({ family, sounds: sounds.map((key) => ({ key, name: t(`overlayBuilder.sounds.${key}`) })) })),
+    fonts: OVERLAY_FONTS,
+  };
+}
+
 router.get('/overlay-builder', overlayPage, async (req, res) => {
   const designs = db.getAllOverlayDesigns(req.streamer.id);
   const overlayUrl = req.streamer.overlay_token
@@ -2684,6 +2705,9 @@ router.get('/overlay-builder', overlayPage, async (req, res) => {
     eventDefaults: JSON.stringify(EVENT_DEFAULTS).replace(/</g, '\\u003c'),
     // The joined alert looks' version (services/alertStyleBundle.js), as the OBS overlay asks for them
     stylesVersion: alertStyleBundle().version,
+    // The Style section, and every family's fonts in one stylesheet
+    styleData: JSON.stringify(builderStyleData(req.streamer, res.locals.t)).replace(/</g, '\\u003c'),
+    styleFontsHref: 'https://fonts.googleapis.com/css2?' + fontsOf(familyKeys()).map((spec) => `family=${spec}`).join('&') + '&display=swap',
     overlayUrl,
     streamThumbnail
   });
ATLETA_PATCH
````

Change `src/views/overlay-builder.ejs`:

````bash
git apply <<'ATLETA_PATCH'
diff --git a/src/views/overlay-builder.ejs b/src/views/overlay-builder.ejs
index 709709c..6b6457d 100644
--- a/src/views/overlay-builder.ejs
+++ b/src/views/overlay-builder.ejs
@@ -22,6 +22,9 @@
   <!-- The looks' five screen effects, drawn as the OBS overlay draws them -->
   <link rel="stylesheet" href="/overlay/fx.css">
   <script src="/overlay/fx.js"></script>
+  <!-- The Style section: every family's fonts in one stylesheet, and its rules (builder-styles-core.js) -->
+  <link rel="stylesheet" href="<%= styleFontsHref %>">
+  <script src="/js/builder-styles-core.js"></script>
   <!-- Where an alert sits, read from a saved design: shared with the live OBS overlay -->
   <script src="/overlay/placement.js"></script>
   <style>
@@ -192,6 +195,59 @@
     }
     .section.collapsed .section-body { display: none; }
 
+    /* Style section (alert styles): the gallery of looks and the look's controls */
+    /* A control the look does not take is hidden; its own display rule would otherwise keep it on screen */
+    #section-style [hidden] { display: none; }
+    .style-families { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
+    .style-chip {
+      padding: 4px 10px; font-size: 11px; font-weight: 600; font-family: var(--font-display);
+      color: var(--text-secondary); background: var(--bg-elevated); border: 1px solid var(--border);
+      border-radius: 999px; cursor: pointer;
+    }
+    .style-chip[aria-pressed="true"] { color: #fff; background: var(--accent); border-color: var(--accent); }
+    .style-gallery { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
+    .style-tile {
+      display: flex; flex-direction: column; gap: 5px; min-width: 0; padding: 6px; text-align: left;
+      font: inherit; color: var(--text-primary); background: var(--bg-elevated);
+      border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer;
+    }
+    .style-tile:hover, .style-tile:focus-visible { border-color: var(--border-focus); outline: none; }
+    .style-tile[aria-checked="true"] { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
+    .style-stage { position: relative; height: 84px; overflow: hidden; border-radius: 6px; background: #07080d; }
+    .style-stage .alert-pos { top: 50%; left: 50%; width: 420px; transform: translate(-50%, -50%) scale(0.32); }
+    .style-name { overflow: hidden; font-size: 12px; font-weight: 600; font-family: var(--font-display); text-overflow: ellipsis; white-space: nowrap; }
+    .style-meta { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--text-muted); }
+    .style-badge { padding: 1px 6px; border-radius: 999px; font-weight: 700; color: var(--accent-hover); background: var(--accent-glow); }
+    .style-family-btn {
+      width: 100%; margin: 10px 0 4px; padding: 8px 10px; font-size: 12px; font-weight: 600; font-family: var(--font-display);
+      color: var(--text-primary); background: var(--bg-elevated); border: 1px dashed var(--border-focus);
+      border-radius: var(--radius-sm); cursor: pointer;
+    }
+    .style-family-btn:hover { color: var(--accent-hover); border-color: var(--accent); }
+    .style-msg { min-height: 16px; margin-bottom: 8px; font-size: 11px; color: var(--text-secondary); }
+    .style-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
+    .style-row > .ctrl-label { flex: 0 0 100%; }
+    .style-swatches { display: flex; gap: 6px; }
+    .style-swatch { width: 22px; height: 22px; border: 2px solid var(--border); border-radius: 50%; background: var(--c); cursor: pointer; }
+    .style-swatch[aria-pressed="true"] { border-color: #fff; }
+    #style-accent { width: 34px; height: 26px; padding: 0; border: 1px solid var(--border); border-radius: 6px; background: none; cursor: pointer; }
+    .style-link { padding: 0; font-size: 11px; color: var(--accent-hover); background: none; border: 0; text-decoration: underline; cursor: pointer; }
+    .style-pair { display: flex; flex: 1 1 45%; align-items: center; justify-content: space-between; gap: 8px; }
+    .style-pair input[type="color"] { width: 34px; height: 26px; padding: 0; border: 1px solid var(--border); border-radius: 6px; background: none; }
+    #style-label, #style-effect, #style-sound, #style-racing-font {
+      flex: 1; min-width: 0; padding: 7px 9px; font-size: 12px; color: var(--text-primary);
+      background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 6px;
+    }
+    .style-sub { margin: 12px 0 8px; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--text-muted); }
+    .style-sound { display: flex; flex: 1; gap: 6px; }
+    #style-listen { width: 34px; color: var(--text-primary); background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
+    #style-listen:disabled { opacity: 0.4; cursor: default; }
+    .style-check { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 12px; color: var(--text-secondary); cursor: pointer; }
+    .style-test {
+      width: 100%; padding: 9px; font-size: 13px; font-weight: 600; font-family: var(--font-display);
+      color: #fff; background: var(--accent); border: 0; border-radius: var(--radius-sm); cursor: pointer;
+    }
+    .style-desc { max-width: 720px; margin: 10px auto 0; font-size: 12px; line-height: 1.5; text-align: center; color: var(--text-secondary); }
     /* Popup trigger buttons */
     .popup-trigger-btn {
       width: 100%; padding: 10px 14px; font-size: 13px; font-weight: 600;
@@ -496,6 +552,8 @@
       /* How far a car drives in and out (the C1 style): the preview screen is the 1920px canvas, scaled */
       --fw: 1920px;
     }
+    /* A look of the alert styles is drawn for 420 px and scaled to the width, as in OBS (objects.css .alert-pos.look) */
+    #preview-object-host.look > .obj { width: 420px; zoom: var(--zw, 1); }
     .preview-alert-card .top-accent {
       height: 3px; border-radius: 16px 16px 0 0;
     }
@@ -941,10 +999,69 @@
         </div>
       </div>
 
-      <div id="phase1-notice" style="display:none; padding:12px 14px; margin-bottom:12px;
-           border-left:3px solid #D81E26; background:rgba(216,30,38,0.08);
-           font-size:13px; line-height:1.5;">
-        <%= t('overlayBuilder.fixedNotice') %>
+      <!-- Style: the alert's look (alert styles). Shown on the six alerts' tabs; the page script fills it. -->
+      <div class="section" id="section-style" hidden>
+        <div class="section-header" onclick="toggleSection('style')">
+          <span class="section-title">✨ <%= t('overlayBuilder.style.sectionTitle') %></span>
+          <span class="section-chevron">▼</span>
+        </div>
+        <div class="section-body">
+          <div class="style-families" id="style-families" role="group" aria-label="<%= t('overlayBuilder.style.familiesLabel') %>"></div>
+          <div class="style-gallery" id="style-gallery" role="radiogroup" aria-label="<%= t('overlayBuilder.style.galleryLabel') %>"></div>
+          <button type="button" class="style-family-btn" id="style-family-btn" hidden></button>
+          <p class="style-msg" id="style-msg" role="status" aria-live="polite"></p>
+
+          <div class="style-row" id="style-row-accent">
+            <span class="ctrl-label"><%= t('overlayBuilder.style.colour') %></span>
+            <div class="style-swatches" id="style-swatches"></div>
+            <input type="color" id="style-accent" value="#D81E26" aria-label="<%= t('overlayBuilder.style.colourPick') %>">
+            <button type="button" class="style-link" id="style-accent-own"><%= t('overlayBuilder.style.colourOwn') %></button>
+          </div>
+          <div class="style-row" id="style-row-racing">
+            <label class="style-pair"><span class="ctrl-label"><%= t('overlayBuilder.style.card') %></span><input type="color" id="style-racing-card"></label>
+            <label class="style-pair"><span class="ctrl-label"><%= t('overlayBuilder.style.accent') %></span><input type="color" id="style-racing-accent"></label>
+            <label class="style-pair"><span class="ctrl-label"><%= t('overlayBuilder.style.name') %></span><input type="color" id="style-racing-name"></label>
+            <label class="style-pair"><span class="ctrl-label"><%= t('overlayBuilder.style.nameFont') %></span><select id="style-racing-font"></select></label>
+          </div>
+          <div class="style-row" id="style-row-label">
+            <label class="ctrl-label" for="style-label"><%= t('overlayBuilder.style.label') %></label>
+            <input type="text" id="style-label" maxlength="40">
+          </div>
+          <div class="range-row" id="style-row-speed">
+            <div class="range-header">
+              <span class="ctrl-label"><%= t('overlayBuilder.style.speed') %></span>
+              <span class="range-val" id="val-style-speed">1×</span>
+            </div>
+            <input type="range" id="style-speed" min="0.5" max="2" step="0.1" value="1">
+          </div>
+          <div class="style-sub" id="style-on-top"><%= t('overlayBuilder.style.onTop') %></div>
+          <div class="style-row" id="style-row-effect">
+            <label class="ctrl-label" for="style-effect"><%= t('overlayBuilder.style.effect') %></label>
+            <select id="style-effect">
+              <option value="default"><%= t('overlayBuilder.style.effectOwn') %></option>
+              <option value="none"><%= t('overlayBuilder.none') %></option>
+              <option value="confetti"><%= t('overlayBuilder.anim.effect.confetti') %></option>
+              <option value="gold"><%= t('overlayBuilder.anim.effect.gold') %></option>
+              <option value="money"><%= t('overlayBuilder.anim.effect.money') %></option>
+              <option value="robots"><%= t('overlayBuilder.anim.effect.robots') %></option>
+              <option value="tiremarks"><%= t('overlayBuilder.anim.effect.tiremarks') %></option>
+              <option value="smoke"><%= t('overlayBuilder.anim.effect.smoke') %></option>
+              <option value="checker"><%= t('overlayBuilder.anim.effect.checker') %></option>
+              <option value="speed"><%= t('overlayBuilder.anim.effect.speed') %></option>
+              <option value="sparks"><%= t('overlayBuilder.anim.effect.sparks') %></option>
+              <option value="champagne"><%= t('overlayBuilder.anim.effect.champagne') %></option>
+            </select>
+          </div>
+          <div class="style-row" id="style-row-sound">
+            <label class="ctrl-label" for="style-sound"><%= t('overlayBuilder.style.sound') %></label>
+            <div class="style-sound">
+              <select id="style-sound"></select>
+              <button type="button" id="style-listen" aria-label="<%= t('overlayBuilder.style.listen') %>">▶</button>
+            </div>
+          </div>
+          <label class="style-check" id="style-row-grows"><input type="checkbox" id="style-grows"> <span><%= t('overlayBuilder.style.grows') %></span></label>
+          <button type="button" class="style-test" id="style-test"><%= t('overlayBuilder.style.test') %></button>
+        </div>
       </div>
 
       <!-- Theme Section -->
@@ -1170,6 +1287,9 @@
       </div>
     </div>
 
+    <!-- The chosen look's description (Style section) -->
+    <p class="style-desc" id="style-desc" hidden></p>
+
     <!-- Save bar moved to above canvas -->
 
   </div><!-- end right-panel -->
@@ -1193,6 +1313,13 @@ const I18N = <%- JSON.stringify({
   scale: t('overlayBuilder.sponsors.scale'), deleteSponsorConfirm: t('overlayBuilder.sponsors.deleteConfirm'),
   systemDefault: t('overlayBuilder.text.systemDefault'), fontSample: t('overlayBuilder.text.fontSample'),
   defaultSponsorName: t('overlayBuilder.sponsors.defaultName'),
+  style: {
+    all: t('overlayBuilder.style.all'), today: t('overlayBuilder.style.today'), default: t('overlayBuilder.style.default'), mine: t('overlayBuilder.style.mine'),
+    useFamily: t('overlayBuilder.style.useFamily', { family: '{{family}}' }), familyDone: t('overlayBuilder.style.familyDone', { family: '{{family}}' }),
+    failed: t('overlayBuilder.style.failed'), fontOwn: t('overlayBuilder.style.fontOwn'), labelHint: t('overlayBuilder.style.labelHint'),
+    soundOwn: t('overlayBuilder.style.soundOwn'), soundToday: t('overlayBuilder.style.soundToday'), soundNone: t('overlayBuilder.style.soundNone'),
+    listen: t('overlayBuilder.style.listen'), listenToday: t('overlayBuilder.style.listenToday'), testSent: t('overlayBuilder.style.testSent'),
+  },
   entrance: {
     slideDown: t('overlayBuilder.anim.slideDown'), slideUp: t('overlayBuilder.anim.slideUp'), slideLeft: t('overlayBuilder.anim.slideLeft'),
     slideRight: t('overlayBuilder.anim.slideRight'), zoomIn: t('overlayBuilder.anim.zoomIn'), fadeIn: t('overlayBuilder.anim.fadeIn'),
@@ -1226,11 +1353,14 @@ function copyBuilderUrl(id, btn) {
 const SAVED_DESIGNS = {};
 const SERVER_DESIGNS = <%- designs %>;
 SERVER_DESIGNS.forEach(d => { SAVED_DESIGNS[d.event_type] = d; });
-// Each alert's stored style (overlay_designs.style; andre_vilela_'s donation is 'donation-c1').
-// Kept apart from workingDesigns: Reset and Discard rebuild those from the defaults, and the
-// server keeps the style through both, so the preview must too. The builder never sends it.
+// Each alert's look (overlay_designs.style; andre_vilela_'s donation is 'donation-c1'), as the page
+// shows it: the Style section changes it, and a save sends it next to the design. Kept apart from
+// workingDesigns: Reset and Discard rebuild those from the defaults and put back the saved look,
+// which the server keeps through both.
 const ALERT_STYLES = {};
 SERVER_DESIGNS.forEach(d => { if (d.style) ALERT_STYLES[d.event_type] = d.style; });
+// The looks as saved; ALERT_STYLES differs from them until the alert is saved
+const SAVED_STYLES = Object.assign({}, ALERT_STYLES);
 
 // Default side icons per event type (null = no icon)
 const DEFAULT_SIDE_ICONS = {
@@ -1244,6 +1374,11 @@ const DEFAULT_SIDE_ICONS = {
 // the builder and the server's handling of a value it cannot keep use the same defaults.
 const EVENT_DEFAULTS = <%- eventDefaults %>;
 
+// The Style section (alert styles): its page-free rules (public/js/builder-styles-core.js) and what the
+// server hands it: each alert's gallery, the default looks, the families, sounds and fonts, their names.
+const STYLE_CORE = window.ATLETA_BUILDER_STYLES;
+const STYLE_DATA = <%- styleData %>;
+
 const EVENT_NAMES = I18N.eventNames;
 
 const PREVIEW_USERNAMES = {
@@ -1258,6 +1393,8 @@ const workingDesigns = {};
 Object.keys(EVENT_DEFAULTS).forEach(t => {
   workingDesigns[t] = Object.assign({}, EVENT_DEFAULTS[t], SAVED_DESIGNS[t] || {});
 });
+// An alert nobody has restyled is shown with its default look's own settings, as OBS plays it
+STYLE_CORE.STYLED_ALERTS.forEach(t => { workingDesigns[t] = STYLE_CORE.untouched(t, workingDesigns[t], SAVED_STYLES[t]); });
 
 let currentType = 'follow';
 let unsavedChanges = false;
@@ -1338,6 +1475,11 @@ function getControlValues() {
     shadow_opacity: wd.shadow_opacity != null ? wd.shadow_opacity : 0.6,
     shadow_blur: wd.shadow_blur != null ? wd.shadow_blur : 32,
     shadow_spread: wd.shadow_spread != null ? wd.shadow_spread : 0,
+    // The look's own settings (Style section): empty is the look's own colour, text, sound, growing
+    style_accent: wd.style_accent || null,
+    style_label: wd.style_label || null,
+    style_sound: wd.style_sound || null,
+    style_grows: wd.style_grows === 0 || wd.style_grows === 1 ? wd.style_grows : null,
   };
 }
 
@@ -1457,16 +1599,13 @@ function previewObjectFor(type) {
   return own && own.key === type ? own : null;
 }
 
-// The five object event types take only their position and width from a saved
-// design for now (colours and animations are not styled yet), so their colour,
-// text, icon and animation controls are hidden rather than left live and inert.
-// Size & Position stays: the width, the nine-cell grid and dragging the alert
-// in the preview all apply to the real alert. Border radius does not (an object
+// The six alerts are drawn in their looks: the Style section holds a look's colour, text, speed,
+// effect and sound, so today's card controls (colours, text, icon, animations) are hidden for
+// them rather than left live and inert. Size & Position stays: the width, the nine-cell grid and
+// dragging the alert in the preview all apply to the real alert. Border radius does not (a look
 // has its own shape), so that one slider is hidden.
 function syncPhase1Controls() {
   const isObject = !!previewObjectFor(currentType);
-  const notice = document.getElementById('phase1-notice');
-  if (notice) notice.style.display = isObject ? '' : 'none';
   ['section-theme', 'section-text', 'section-sideicon', 'section-animation'].forEach(id => {
     const el = document.getElementById(id);
     if (el) el.style.display = isObject ? 'none' : '';
@@ -1481,24 +1620,27 @@ function updatePreview() {
   const objHost = document.getElementById('preview-object-host');
   const legacyCard = document.getElementById('preview-card');
   if (objDef) {
-    // An object takes its position and width from the saved design (the controls
-    // in Size & Position); its colours and animations are not styled yet.
+    // A look takes its position and width from the design (Size & Position), and its colour,
+    // text, speed, effect and sound from the Style section, as in OBS.
     const d = getControlValues();
     workingDesigns[currentType] = Object.assign({}, workingDesigns[currentType], d);
     legacyCard.style.display = 'none';
     objHost.style.display = '';
-    objHost.style.width = ATLETA_PLACEMENT.placementOf(d).width + 'px';
-    // The object is drawn (and its entrance played) when its tab opens; moving or
-    // resizing it afterwards must not replay the entrance on every slider step.
-    if (renderedObjectType !== currentType) {
-      objHost.innerHTML = objDef.render(PREVIEW_DATA[currentType] || {});
-      objHost.style.setProperty('--in', objDef.anim.in);
-      objHost.style.setProperty('--dur', objDef.anim.dur);
-      objHost.style.setProperty('--ease', objDef.anim.ease);
-      objHost.classList.remove('playing');
-      void objHost.offsetWidth;   // force reflow so the animation restarts
-      objHost.classList.add('playing');
-      renderedObjectType = currentType;
+    const width = ATLETA_PLACEMENT.placementOf(d).width;
+    objHost.style.width = width + 'px';
+    sizeLookHost(objHost, objDef, width);
+    setLookVars(objHost, objDef, d);   // the colour and the speed apply at once
+    // The look is drawn (and its entrance played) when its tab opens or another look is picked;
+    // what it draws from its settings (its text, Racing's colours) is drawn again once the
+    // controls rest. Moving or resizing it never replays the entrance.
+    const drawKey = currentType + '|' + objDef.key;
+    const html = lookHtml(objDef, d, PREVIEW_DATA[currentType] || {});
+    clearTimeout(previewRedraw);
+    if (renderedObjectType !== drawKey) {
+      playLookIn(objHost, objDef, html);
+      renderedObjectType = drawKey;
+    } else if (html !== previewHtml) {
+      previewRedraw = setTimeout(() => playLookIn(objHost, objDef, html), 350);
     }
     // The effect the OBS overlay plays with this look (kit.js effectFor): none for today's
     // objects with no look picked and for the C1, else the one the design names or the look's own.
@@ -2041,6 +2183,7 @@ function switchTab(type) {
   updateSideIconGrid(workingDesigns[type]);
   if (typeof updateAnimSectionPreview === 'function') updateAnimSectionPreview(workingDesigns[type]);
   updatePreview();
+  renderStyleSection();
 
   // Update URL and sounds link to preserve tab context
   const url = new URL(window.location);
@@ -2097,20 +2240,351 @@ document.getElementById('ctrl-border-radius').addEventListener('input', function
   el.addEventListener('change', updatePreview);
 });
 
+// ─── Style: the alert's look (alert styles) ──────────────────────────────────
+// docs/superpowers/specs/2026-10-15-alert-styles-design.md, 4.6. The gallery and the preview draw the looks
+// with the files the OBS overlay uses (objects/kit.js and the joined family files); the page-free rules
+// are STYLE_CORE (public/js/builder-styles-core.js).
+const STYLE_SWATCHES = ['#D81E26', '#FF8000', '#FFC21A', '#17A35A', '#36C6FF', '#3B82F6', '#9146FF', '#FF4FA3'];
+let styleFamily = 'all';
+let playingTile = null;
+let previewRedraw = null;
+let previewHtml = '';
+let styleAudio = null;
+
+// The look the page shows for an alert: the one picked or saved, else the alert's default look.
+function shownLook(type) {
+  return STYLE_CORE.shownStyle(type, ALERT_STYLES, STYLE_DATA.defaults);
+}
+
+// The look as saved: Discard and Reset put it back (the server keeps the alert's look through both).
+function restoreSavedLook(type) {
+  if (SAVED_STYLES[type]) ALERT_STYLES[type] = SAVED_STYLES[type];
+  else delete ALERT_STYLES[type];
+}
+
+// What a look draws with this design: its data with its main text and "grows with the amount" (kit.js
+// lookData), as overlay.js hands it; today's objects and the C1 get the sample as it is. null when the
+// look throws.
+function lookHtml(look, d, sample) {
+  const kit = window.ATLETA_KIT;
+  try {
+    return look.render(kit && look.family ? kit.lookData(look, sample, d) : sample);
+  } catch (e) {
+    return null;
+  }
+}
+
+// The colour and speed variables a look's slot carries (kit.js slotVars), as in OBS.
+const lookVarsOf = new WeakMap();
+function setLookVars(slot, look, d) {
+  const kit = window.ATLETA_KIT;
+  (lookVarsOf.get(slot) || []).forEach(name => slot.style.removeProperty(name));
+  const vars = kit && look.family ? kit.slotVars(look, d) : {};
+  Object.keys(vars).forEach(name => slot.style.setProperty(name, vars[name]));
+  lookVarsOf.set(slot, Object.keys(vars));
+}
+
+// A look of the alert styles is drawn for 420 px and scaled to the width (as .alert-pos.look in OBS);
+// today's objects, the samurai presets among them, and the C1 reflow instead.
+function sizeLookHost(host, look, width) {
+  const scaled = !!(look && look.family && !look.preset);
+  host.classList.toggle('look', scaled);
+  if (scaled) host.style.setProperty('--zw', String(Math.round(width / 420 * 1000) / 1000));
+  else host.style.removeProperty('--zw');
+}
+
+// Draws a look in the preview and plays its entrance. A look that throws leaves the preview empty.
+function playLookIn(host, look, html) {
+  previewHtml = html;
+  host.innerHTML = html || '';
+  host.style.setProperty('--in', look.anim.in);
+  host.style.setProperty('--dur', look.anim.dur);
+  host.style.setProperty('--ease', look.anim.ease);
+  host.classList.remove('playing');
+  void host.offsetWidth;   // force reflow so the animation restarts
+  host.classList.add('playing');
+}
+
+// Shows the Style section on the six alerts' tabs and fills it for the current one.
+function renderStyleSection() {
+  const styled = STYLE_CORE.isStyled(currentType);
+  document.getElementById('section-style').hidden = !styled;
+  document.getElementById('style-desc').hidden = !styled;
+  if (!styled) return;
+  document.getElementById('style-msg').textContent = '';
+  renderStyleFamilies();
+  renderStyleGallery();
+  syncStyleControls();
+}
+
+function renderStyleFamilies() {
+  const box = document.getElementById('style-families');
+  box.innerHTML = '';
+  [{ key: 'all', name: I18N.style.all }].concat(STYLE_DATA.families).forEach(family => {
+    const chip = document.createElement('button');
+    chip.type = 'button';
+    chip.className = 'style-chip';
+    chip.textContent = family.name;
+    chip.setAttribute('aria-pressed', String(styleFamily === family.key));
+    chip.addEventListener('click', () => { styleFamily = family.key; renderStyleSection(); });
+    box.appendChild(chip);
+  });
+}
+
+// The gallery: each look drawn at rest (its finished picture), scaled down, with its name and family.
+// A tile plays when hovered or focused, one at a time.
+function renderStyleGallery() {
+  const box = document.getElementById('style-gallery');
+  const shown = shownLook(currentType);
+  const entries = STYLE_CORE.filterGallery(STYLE_CORE.orderGallery(STYLE_DATA.gallery[currentType], currentType, STYLE_DATA.defaults), styleFamily);
+  box.innerHTML = '';
+  playingTile = null;
+  entries.forEach(entry => {
+    const look = (window.ATLETA_OBJECT_STYLES || {})[entry.id];
+    if (!look) return;   // its family's file did not load
+    const tile = document.createElement('button');
+    tile.type = 'button';
+    tile.className = 'style-tile';
+    tile.setAttribute('role', 'radio');
+    tile.setAttribute('aria-checked', String(entry.id === shown));
+    const stage = document.createElement('div');
+    stage.className = 'style-stage';
+    const slot = document.createElement('div');
+    slot.className = 'alert-pos';
+    // Racing's tiles show the alert's own card colours, which carry over to it; the others their own colour
+    const tileDesign = STYLE_CORE.controlsFor(look).racing ? workingDesigns[currentType] : {};
+    slot.innerHTML = lookHtml(look, tileDesign, PREVIEW_DATA[currentType] || {}) || '';
+    setLookVars(slot, look, tileDesign);
+    slot.style.setProperty('--in', look.anim.in);
+    slot.style.setProperty('--dur', look.anim.dur);
+    slot.style.setProperty('--ease', look.anim.ease);
+    stage.appendChild(slot);
+    const name = document.createElement('span');
+    name.className = 'style-name';
+    name.textContent = (STYLE_DATA.looks[entry.id] || {}).title || entry.id;
+    const meta = document.createElement('span');
+    meta.className = 'style-meta';
+    if (entry.badge) {
+      const badge = document.createElement('span');
+      badge.className = 'style-badge';
+      badge.textContent = I18N.style[entry.badge];
+      meta.appendChild(badge);
+    }
+    const family = STYLE_DATA.families.find(f => f.key === entry.family);
+    if (family) meta.appendChild(document.createTextNode(family.name));
+    tile.append(stage, name, meta);
+    tile.addEventListener('click', () => pickLook(entry.id));
+    tile.addEventListener('mouseenter', () => playTile(slot));
+    tile.addEventListener('focus', () => playTile(slot));
+    tile.addEventListener('mouseleave', () => restTile(slot));
+    tile.addEventListener('blur', () => restTile(slot));
+    box.appendChild(tile);
+  });
+  const look = (window.ATLETA_OBJECT_STYLES || {})[shown];
+  const family = STYLE_DATA.families.find(f => look && f.key === look.family);
+  const button = document.getElementById('style-family-btn');
+  button.hidden = !family;
+  if (family) {
+    button.textContent = fill(I18N.style.useFamily, { family: family.name });
+    button.dataset.family = family.key;
+  }
+  document.getElementById('style-desc').textContent = (STYLE_DATA.looks[shown] || {}).desc || '';
+}
+
+function playTile(slot) {
+  if (playingTile && playingTile !== slot) restTile(playingTile);
+  playingTile = slot;
+  slot.classList.remove('playing');
+  void slot.offsetWidth;
+  slot.classList.add('playing');
+}
+
+function restTile(slot) {
+  slot.classList.remove('playing');
+  if (playingTile === slot) playingTile = null;
+}
+
+// Picks a look for the current alert: its settings start from the look's own (the server does the
+// same when the alert is saved), and the preview draws it and plays its entrance.
+function pickLook(id) {
+  const previous = shownLook(currentType);
+  ALERT_STYLES[currentType] = id;
+  workingDesigns[currentType] = STYLE_CORE.withLook(getControlValues(), previous, id);
+  setControlValues(workingDesigns[currentType]);
+  renderedObjectType = null;
+  renderStyleSection();
+  updatePreview();
+}
+
+// The look's controls, shown as the look takes them (STYLE_CORE.controlsFor) and set from the working
+// design. Racing's colours, font and text are today's design fields; the other looks use their own.
+function syncStyleControls() {
+  const look = previewObjectFor(currentType);
+  const show = STYLE_CORE.controlsFor(look);
+  const d = workingDesigns[currentType] || {};
+  const rows = {
+    'style-row-accent': show.accent, 'style-row-racing': show.racing, 'style-row-label': show.label,
+    'style-row-speed': show.speed, 'style-row-effect': show.effect, 'style-row-sound': show.sound, 'style-row-grows': show.grows,
+  };
+  Object.keys(rows).forEach(id => { document.getElementById(id).hidden = !rows[id]; });
+  document.getElementById('style-on-top').hidden = !(show.effect || show.sound || show.grows);
+  const set = (id, value) => { const el = document.getElementById(id); if (el !== document.activeElement) el.value = value; };
+  set('style-accent', d.style_accent || '#D81E26');
+  document.querySelectorAll('#style-swatches .style-swatch').forEach(s => s.setAttribute('aria-pressed', String(s.dataset.colour === d.style_accent)));
+  set('style-racing-card', d.bg_color || '#1a1a3e');
+  set('style-racing-accent', d.accent_color || '#8888cc');
+  set('style-racing-name', d.username_color || d.text_color || '#ffffff');
+  set('style-racing-font', d.username_font_family || 'System Default');
+  set('style-label', (show.racing ? d.event_label : d.style_label) || '');
+  document.getElementById('style-label').placeholder = I18N.style.labelHint;
+  set('style-speed', d.animation_speed || 1);
+  document.getElementById('val-style-speed').textContent = (d.animation_speed || 1) + '×';
+  set('style-effect', d.screen_effect || 'default');
+  set('style-sound', d.style_sound || '');
+  document.getElementById('style-grows').checked = d.style_grows !== 0;
+  const sound = window.ATLETA_KIT ? window.ATLETA_KIT.soundFor(look, d) : 'today';
+  const listen = document.getElementById('style-listen');
+  listen.disabled = sound === 'today' || sound === 'none';
+  listen.title = sound === 'today' ? I18N.style.listenToday : I18N.style.listen;
+}
+
+// One of the look's settings changed: into the working design, then the controls and the preview.
+function setLookSetting(field, value) {
+  workingDesigns[currentType] = Object.assign({}, workingDesigns[currentType], { [field]: value });
+  syncStyleControls();
+  updatePreview();
+}
+
+// Wires the Style section's controls once; each writes the field the save sends, and mirrors today's
+// hidden controls where getControlValues() reads it (the speed, the effect, Racing's card colours, its text).
+function initStyleControls() {
+  const on = (id, type, fn) => document.getElementById(id).addEventListener(type, fn);
+  const mirror = (id, value) => { document.getElementById(id).value = value; };
+  const swatches = document.getElementById('style-swatches');
+  STYLE_SWATCHES.forEach(hex => {
+    const swatch = document.createElement('button');
+    swatch.type = 'button';
+    swatch.className = 'style-swatch';
+    swatch.dataset.colour = hex;
+    swatch.style.setProperty('--c', hex);
+    swatch.setAttribute('aria-label', hex);
+    swatch.addEventListener('click', () => setLookSetting('style_accent', hex));
+    swatches.appendChild(swatch);
+  });
+  const fonts = document.getElementById('style-racing-font');
+  STYLE_DATA.fonts.forEach(font => fonts.appendChild(new Option(font === 'System Default' ? I18N.style.fontOwn : font, font)));
+  const sounds = document.getElementById('style-sound');
+  sounds.append(new Option(I18N.style.soundOwn, ''), new Option(I18N.style.soundToday, 'today'), new Option(I18N.style.soundNone, 'none'));
+  STYLE_DATA.sounds.forEach(group => {
+    const optgroup = document.createElement('optgroup');
+    optgroup.label = (STYLE_DATA.families.find(f => f.key === group.family) || {}).name || group.family;
+    group.sounds.forEach(s => optgroup.appendChild(new Option(s.name, s.key)));
+    sounds.appendChild(optgroup);
+  });
+  on('style-accent', 'input', e => setLookSetting('style_accent', e.target.value.toUpperCase()));
+  on('style-accent-own', 'click', () => setLookSetting('style_accent', null));
+  on('style-racing-card', 'input', e => { mirror('ctrl-bg-color', e.target.value); setLookSetting('bg_color', e.target.value); });
+  on('style-racing-accent', 'input', e => { mirror('ctrl-accent-color', e.target.value); setLookSetting('accent_color', e.target.value); });
+  on('style-racing-name', 'input', e => setLookSetting('username_color', e.target.value));
+  on('style-racing-font', 'change', e => setLookSetting('username_font_family', e.target.value === 'System Default' ? null : e.target.value));
+  on('style-label', 'input', e => {
+    if (STYLE_CORE.controlsFor(previewObjectFor(currentType)).racing) {
+      mirror('ctrl-event-label', e.target.value);
+      setLookSetting('event_label', e.target.value);
+    } else {
+      setLookSetting('style_label', e.target.value);
+    }
+  });
+  on('style-speed', 'input', e => { mirror('ctrl-animation-speed', e.target.value); setLookSetting('animation_speed', parseFloat(e.target.value)); });
+  on('style-effect', 'change', e => { mirror('ctrl-screen-effect', e.target.value); setLookSetting('screen_effect', e.target.value); });
+  on('style-sound', 'change', e => setLookSetting('style_sound', e.target.value || null));
+  on('style-grows', 'change', e => setLookSetting('style_grows', e.target.checked ? 1 : 0));
+  on('style-listen', 'click', listenToLookSound);
+  on('style-family-btn', 'click', useStyleFamily);
+  on('style-test', 'click', testLook);
+}
+
+// ▶ plays the sound the look plays (the page's own AudioContext, made on the first click). Today's
+// sound lives in the OBS overlay only: Test plays it there.
+function listenToLookSound() {
+  const kit = window.ATLETA_KIT;
+  const key = kit.soundFor(previewObjectFor(currentType), workingDesigns[currentType]);
+  if (key === 'today' || key === 'none') return;
+  if (!styleAudio) {
+    const Context = window.AudioContext || window.webkitAudioContext;
+    if (!Context) return;
+    styleAudio = new Context();
+    kit.setAudio(styleAudio, () => 0.8);
+  }
+  if (styleAudio.state === 'suspended') styleAudio.resume();
+  kit.playSound(key);
+}
+
+// "Use <family> for all six alerts": saved on the server at once (all six in one transaction); its
+// answer is the six rows, which the page takes as saved.
+async function useStyleFamily() {
+  const family = document.getElementById('style-family-btn').dataset.family;
+  const msg = document.getElementById('style-msg');
+  try {
+    const res = await fetch('/dashboard/overlay-builder/family', {
+      method: 'POST',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ family }),
+    });
+    const data = await res.json();
+    if (!res.ok || !data.ok) { msg.textContent = data.error || I18N.style.failed; return; }
+    Object.keys(data.designs).forEach(type => {
+      const row = data.designs[type];
+      SAVED_DESIGNS[type] = row;
+      SAVED_STYLES[type] = ALERT_STYLES[type] = row.style;
+      workingDesigns[type] = Object.assign({}, EVENT_DEFAULTS[type], row);
+    });
+    setControlValues(workingDesigns[currentType]);
+    renderedObjectType = null;
+    renderStyleSection();
+    updatePreview();
+    msg.textContent = fill(I18N.style.familyDone, { family: (STYLE_DATA.families.find(f => f.key === family) || {}).name || family });
+  } catch (e) {
+    msg.textContent = I18N.style.failed;
+  }
+}
+
+// Test: plays the look in the preview, and through the overlay's test route in OBS, which plays what was
+// saved last (the test cooldown is the overlay settings page's).
+async function testLook() {
+  renderedObjectType = null;
+  updatePreview();
+  const msg = document.getElementById('style-msg');
+  try {
+    const res = await fetch('/dashboard/overlay/test/' + encodeURIComponent(currentType), {
+      method: 'POST',
+      headers: { 'Content-Type': 'application/json' },
+      body: '{}',
+    });
+    const data = await res.json().catch(() => ({}));
+    msg.textContent = res.ok ? I18N.style.testSent : (data.error || I18N.style.failed);
+  } catch (e) {
+    msg.textContent = I18N.style.failed;
+  }
+}
+
 // ─── Save ────────────────────────────────────────────────────────────────────
 async function saveCurrentDesign() {
   const design = getControlValues();
   workingDesigns[currentType] = design;
+  const style = shownLook(currentType);
 
   try {
     const resp = await fetch('/dashboard/overlay-builder/save', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
-      body: JSON.stringify({ eventType: currentType, design }),
+      body: JSON.stringify(STYLE_CORE.savePayload(currentType, design, style)),
     });
     const data = await resp.json();
     if (data.ok) {
       SAVED_DESIGNS[currentType] = Object.assign({}, design);
+      // The page shows the default look as its id, and the save stores that id
+      if (STYLE_CORE.isStyled(currentType)) SAVED_STYLES[currentType] = ALERT_STYLES[currentType] = style;
       const status = document.getElementById('save-status');
       status.textContent = I18N.saved;
       status.classList.add('visible');
@@ -2125,10 +2599,13 @@ async function saveCurrentDesign() {
 
 // ─── Discard ──────────────────────────────────────────────────────────────────
 function discardChanges() {
-  const saved = Object.assign({}, EVENT_DEFAULTS[currentType], SAVED_DESIGNS[currentType] || {});
+  restoreSavedLook(currentType);
+  const saved = STYLE_CORE.untouched(currentType, Object.assign({}, EVENT_DEFAULTS[currentType], SAVED_DESIGNS[currentType] || {}), SAVED_STYLES[currentType]);
   workingDesigns[currentType] = saved;
   setControlValues(saved);
+  renderedObjectType = null;
   updatePreview();
+  renderStyleSection();
 }
 
 // ─── Reset to default ─────────────────────────────────────────────────────────
@@ -2143,9 +2620,12 @@ async function resetCurrentDesign() {
   } catch(e) {}
 
   delete SAVED_DESIGNS[currentType];
+  restoreSavedLook(currentType);
   workingDesigns[currentType] = Object.assign({}, EVENT_DEFAULTS[currentType]);
   setControlValues(workingDesigns[currentType]);
+  renderedObjectType = null;
   updatePreview();
+  renderStyleSection();
 
   const status = document.getElementById('save-status');
   status.textContent = I18N.resetDone;
@@ -2463,6 +2943,8 @@ function stopSponsorPreview() {
 setControlValues(workingDesigns['follow']);
 updateSideIconGrid(workingDesigns['follow']);
 updatePreview();
+initStyleControls();
+renderStyleSection();
 renderSponsorList();
 document.getElementById('sp-rotation-toggle').checked = sponsorRotationEnabled;
 
@@ -2533,6 +3015,7 @@ document.addEventListener('mousemove', e => {
     const sponsorWrap = dragTarget.querySelector('.preview-sponsor-wrap');
     card.style.width = newWidth + 'px';
     objHost.style.width = newWidth + 'px';
+    sizeLookHost(objHost, previewObjectFor(currentType), newWidth);
     if (sponsorWrap) sponsorWrap.style.width = newWidth + 'px';
 
     // A card anchored to the right, bottom or centre grows from there, as it does live
ATLETA_PATCH
````

Add the 74 new texts to all seven locale files, after `overlayBuilder.error.family`, and remove `overlayBuilder.fixedNotice`:

````bash
node - <<'ATLETA_SCRIPT'
const fs = require('fs');
const add = {
 "en": {
  "overlayBuilder.style.sectionTitle": "Style",
  "overlayBuilder.style.familiesLabel": "Families of looks",
  "overlayBuilder.style.galleryLabel": "Looks for this alert",
  "overlayBuilder.style.all": "All",
  "overlayBuilder.style.today": "Today",
  "overlayBuilder.style.default": "Default",
  "overlayBuilder.style.mine": "Made for you",
  "overlayBuilder.style.useFamily": "Use {{family}} for all six alerts",
  "overlayBuilder.style.familyDone": "{{family}} is now on all six alerts, and saved.",
  "overlayBuilder.style.failed": "That did not work. Please try again.",
  "overlayBuilder.style.colour": "Colour",
  "overlayBuilder.style.colourPick": "Pick a colour",
  "overlayBuilder.style.colourOwn": "The look's own colour",
  "overlayBuilder.style.card": "Card",
  "overlayBuilder.style.accent": "Accent",
  "overlayBuilder.style.name": "Name",
  "overlayBuilder.style.nameFont": "Name font",
  "overlayBuilder.style.fontOwn": "The look's own font",
  "overlayBuilder.style.label": "Main text",
  "overlayBuilder.style.labelHint": "Empty: the look's own words",
  "overlayBuilder.style.speed": "Speed",
  "overlayBuilder.style.onTop": "On top of the look",
  "overlayBuilder.style.effect": "Screen effect",
  "overlayBuilder.style.effectOwn": "The look's own",
  "overlayBuilder.style.sound": "Sound",
  "overlayBuilder.style.soundOwn": "The look's own sound",
  "overlayBuilder.style.soundToday": "Today's sound",
  "overlayBuilder.style.soundNone": "None",
  "overlayBuilder.style.listen": "Listen",
  "overlayBuilder.style.listenToday": "Today's sound plays in OBS: use Test to hear it.",
  "overlayBuilder.style.grows": "Grows with the amount",
  "overlayBuilder.style.test": "Test",
  "overlayBuilder.style.testSent": "Sent to OBS, which plays what you saved last.",
  "overlayBuilder.families.samurai.name": "Samurai",
  "overlayBuilder.families.samurai.desc": "Today's alerts in Ronin red: a blade cut, a torii gate, a tally board, a folding screen and war banners, with the omikuji for the giveaway.",
  "overlayBuilder.families.racing.name": "Racing",
  "overlayBuilder.families.racing.desc": "Night-race graphics: a headlight streak leaves a carbon panel, then a race number, nitro, a sponsor decal, headlights or a victory lap. Your card, accent and name colours, the name's font and the text stay yours.",
  "overlayBuilder.looks.follow-samurai.title": "Iaido band",
  "overlayBuilder.looks.follow-samurai.desc": "A blade crosses and the band appears along the cut. Short, because follows come often.",
  "overlayBuilder.looks.subscriber-samurai.title": "Torii gate",
  "overlayBuilder.looks.subscriber-samurai.desc": "Pillars plant, both beams drop and the name plaque hangs from its cords.",
  "overlayBuilder.looks.bits-samurai.title": "Tally board",
  "overlayBuilder.looks.bits-samurai.desc": "The blade crosses the board and flips each digit tile as it passes.",
  "overlayBuilder.looks.donation-samurai.title": "Byōbu screen",
  "overlayBuilder.looks.donation-samurai.desc": "Six panels unfold, the rails snap across and the amount is struck.",
  "overlayBuilder.looks.raid-samurai.title": "Banner rank",
  "overlayBuilder.looks.raid-samurai.desc": "Five banners plant outside-in; the standard lands last, carrying the count.",
  "overlayBuilder.looks.giveaway-samurai.title": "Omikuji",
  "overlayBuilder.looks.giveaway-samurai.desc": "The fortune box is shaken twice, a stick strikes out and the slip unrolls with the winner, stamped “great blessing”.",
  "overlayBuilder.looks.follow-racing.title": "Fly-by",
  "overlayBuilder.looks.follow-racing.desc": "A headlight streak flies past and leaves the panel behind it; the name lands with a speed smear and three chevrons light up.",
  "overlayBuilder.looks.subscriber-racing.title": "Race number",
  "overlayBuilder.looks.subscriber-racing.desc": "A race-number roundel slaps onto the panel with the months as the number, then the name and the tier.",
  "overlayBuilder.looks.bits-racing.title": "Nitro",
  "overlayBuilder.looks.bits-racing.desc": "The nitro gauge charges, further for more bits, then the flame fires and the amount rolls up.",
  "overlayBuilder.looks.donation-racing.title": "Sponsor decal",
  "overlayBuilder.looks.donation-racing.desc": "The amount is slapped on like a sponsor's sticker and a gloss runs across it; the donor's name and message sit below.",
  "overlayBuilder.looks.raid-racing.title": "Headlights",
  "overlayBuilder.looks.raid-racing.desc": "A formation of headlights switches on, one pair per raider up to twelve, while the count of drivers rolls up.",
  "overlayBuilder.looks.giveaway-racing.title": "Victory lap",
  "overlayBuilder.looks.giveaway-racing.desc": "A light laps the panel's outline and leaves it lit, then the winner's name glows. The prize sits on a tag.",
  "overlayBuilder.looks.donation-c1.title": "C1 billboard trailer",
  "overlayBuilder.looks.donation-c1.desc": "Your C1 tows a billboard onto the stream with the donation on it. Made for you.",
  "overlayBuilder.sounds.samuraiBlade": "Blade draw",
  "overlayBuilder.sounds.samuraiTaiko": "Taiko drum",
  "overlayBuilder.sounds.samuraiTaiko3": "Three taiko beats",
  "overlayBuilder.sounds.samuraiKoto": "Koto",
  "overlayBuilder.sounds.samuraiBell": "Temple bell",
  "overlayBuilder.sounds.rcFlyby": "Fly-by whoosh",
  "overlayBuilder.sounds.rcNumber": "Number slap and beeps",
  "overlayBuilder.sounds.rcNitro": "Nitro charge",
  "overlayBuilder.sounds.rcSponsor": "Sticker slap",
  "overlayBuilder.sounds.rcConvoy": "Convoy",
  "overlayBuilder.sounds.rcVictory": "Victory fanfare"
 },
 "pt": {
  "overlayBuilder.style.sectionTitle": "Estilo",
  "overlayBuilder.style.familiesLabel": "Famílias de estilos",
  "overlayBuilder.style.galleryLabel": "Estilos para este alerta",
  "overlayBuilder.style.all": "Todos",
  "overlayBuilder.style.today": "Atual",
  "overlayBuilder.style.default": "Padrão",
  "overlayBuilder.style.mine": "Feito para você",
  "overlayBuilder.style.useFamily": "Usar {{family}} nos seis alertas",
  "overlayBuilder.style.familyDone": "{{family}} agora está nos seis alertas, já salvo.",
  "overlayBuilder.style.failed": "Não deu certo. Tente de novo.",
  "overlayBuilder.style.colour": "Cor",
  "overlayBuilder.style.colourPick": "Escolher uma cor",
  "overlayBuilder.style.colourOwn": "A cor do próprio estilo",
  "overlayBuilder.style.card": "Cartão",
  "overlayBuilder.style.accent": "Destaque",
  "overlayBuilder.style.name": "Nome",
  "overlayBuilder.style.nameFont": "Fonte do nome",
  "overlayBuilder.style.fontOwn": "A fonte do próprio estilo",
  "overlayBuilder.style.label": "Texto principal",
  "overlayBuilder.style.labelHint": "Vazio: as palavras do próprio estilo",
  "overlayBuilder.style.speed": "Velocidade",
  "overlayBuilder.style.onTop": "Por cima do estilo",
  "overlayBuilder.style.effect": "Efeito de tela",
  "overlayBuilder.style.effectOwn": "O do próprio estilo",
  "overlayBuilder.style.sound": "Som",
  "overlayBuilder.style.soundOwn": "O som do próprio estilo",
  "overlayBuilder.style.soundToday": "Som atual",
  "overlayBuilder.style.soundNone": "Nenhum",
  "overlayBuilder.style.listen": "Ouvir",
  "overlayBuilder.style.listenToday": "O som atual toca no OBS: use Testar para ouvi-lo.",
  "overlayBuilder.style.grows": "Cresce com o valor",
  "overlayBuilder.style.test": "Testar",
  "overlayBuilder.style.testSent": "Enviado ao OBS, que toca o que você salvou por último.",
  "overlayBuilder.families.samurai.name": "Samurai",
  "overlayBuilder.families.samurai.desc": "Os alertas atuais em vermelho Ronin: um corte de lâmina, um portal torii, um placar, um biombo e estandartes de guerra, com o omikuji para o sorteio.",
  "overlayBuilder.families.racing.name": "Corrida",
  "overlayBuilder.families.racing.desc": "Gráficos de corrida noturna: um rastro de farol deixa um painel de carbono, depois um número de corrida, nitro, um adesivo de patrocinador, faróis ou uma volta da vitória. As cores do cartão, do destaque e do nome, a fonte do nome e o texto continuam sendo seus.",
  "overlayBuilder.looks.follow-samurai.title": "Faixa iaido",
  "overlayBuilder.looks.follow-samurai.desc": "Uma lâmina corta e a faixa surge ao longo do corte. Curto, porque follows chegam com frequência.",
  "overlayBuilder.looks.subscriber-samurai.title": "Portal torii",
  "overlayBuilder.looks.subscriber-samurai.desc": "Os pilares se fincam, as duas vigas caem e a placa com o nome fica pendurada nas cordas.",
  "overlayBuilder.looks.bits-samurai.title": "Placar",
  "overlayBuilder.looks.bits-samurai.desc": "A lâmina atravessa o placar e vira cada peça de dígito ao passar.",
  "overlayBuilder.looks.donation-samurai.title": "Biombo byōbu",
  "overlayBuilder.looks.donation-samurai.desc": "Seis painéis se abrem, as barras se encaixam e o valor é marcado.",
  "overlayBuilder.looks.raid-samurai.title": "Fileira de estandartes",
  "overlayBuilder.looks.raid-samurai.desc": "Cinco estandartes se fincam de fora para dentro; o principal chega por último, com a contagem.",
  "overlayBuilder.looks.giveaway-samurai.title": "Omikuji",
  "overlayBuilder.looks.giveaway-samurai.desc": "A caixa da sorte é sacudida duas vezes, uma vareta salta e o papel se desenrola com o vencedor, carimbado “grande bênção”.",
  "overlayBuilder.looks.follow-racing.title": "Passagem",
  "overlayBuilder.looks.follow-racing.desc": "Um rastro de farol passa e deixa o painel para trás; o nome chega com um borrão de velocidade e três setas acendem.",
  "overlayBuilder.looks.subscriber-racing.title": "Número de corrida",
  "overlayBuilder.looks.subscriber-racing.desc": "Um disco com o número de corrida bate no painel com os meses como número, depois o nome e o nível.",
  "overlayBuilder.looks.bits-racing.title": "Nitro",
  "overlayBuilder.looks.bits-racing.desc": "O medidor de nitro carrega, mais longe para mais bits, então a chama dispara e o valor sobe.",
  "overlayBuilder.looks.donation-racing.title": "Adesivo de patrocinador",
  "overlayBuilder.looks.donation-racing.desc": "O valor é colado como o adesivo de um patrocinador e um brilho passa por ele; o nome de quem doou e a mensagem ficam abaixo.",
  "overlayBuilder.looks.raid-racing.title": "Faróis",
  "overlayBuilder.looks.raid-racing.desc": "Uma formação de faróis acende, um par por raider até doze, enquanto a contagem de pilotos sobe.",
  "overlayBuilder.looks.giveaway-racing.title": "Volta da vitória",
  "overlayBuilder.looks.giveaway-racing.desc": "Uma luz dá a volta no contorno do painel e o deixa aceso, então o nome do vencedor brilha. O prêmio fica numa etiqueta.",
  "overlayBuilder.looks.donation-c1.title": "Reboque com outdoor do C1",
  "overlayBuilder.looks.donation-c1.desc": "Seu C1 reboca um outdoor para a live com a doação nele. Feito para você.",
  "overlayBuilder.sounds.samuraiBlade": "Lâmina sacada",
  "overlayBuilder.sounds.samuraiTaiko": "Tambor taiko",
  "overlayBuilder.sounds.samuraiTaiko3": "Três batidas de taiko",
  "overlayBuilder.sounds.samuraiKoto": "Koto",
  "overlayBuilder.sounds.samuraiBell": "Sino de templo",
  "overlayBuilder.sounds.rcFlyby": "Passagem",
  "overlayBuilder.sounds.rcNumber": "Batida e bipes do número",
  "overlayBuilder.sounds.rcNitro": "Carga de nitro",
  "overlayBuilder.sounds.rcSponsor": "Batida do adesivo",
  "overlayBuilder.sounds.rcConvoy": "Comboio",
  "overlayBuilder.sounds.rcVictory": "Fanfarra da vitória"
 },
 "es": {
  "overlayBuilder.style.sectionTitle": "Estilo",
  "overlayBuilder.style.familiesLabel": "Familias de estilos",
  "overlayBuilder.style.galleryLabel": "Estilos para esta alerta",
  "overlayBuilder.style.all": "Todos",
  "overlayBuilder.style.today": "Actual",
  "overlayBuilder.style.default": "Predeterminado",
  "overlayBuilder.style.mine": "Hecho para ti",
  "overlayBuilder.style.useFamily": "Usar {{family}} en las seis alertas",
  "overlayBuilder.style.familyDone": "{{family}} ya está en las seis alertas y guardado.",
  "overlayBuilder.style.failed": "No funcionó. Inténtalo de nuevo.",
  "overlayBuilder.style.colour": "Color",
  "overlayBuilder.style.colourPick": "Elegir un color",
  "overlayBuilder.style.colourOwn": "El color del propio estilo",
  "overlayBuilder.style.card": "Tarjeta",
  "overlayBuilder.style.accent": "Acento",
  "overlayBuilder.style.name": "Nombre",
  "overlayBuilder.style.nameFont": "Fuente del nombre",
  "overlayBuilder.style.fontOwn": "La fuente del propio estilo",
  "overlayBuilder.style.label": "Texto principal",
  "overlayBuilder.style.labelHint": "Vacío: las palabras del propio estilo",
  "overlayBuilder.style.speed": "Velocidad",
  "overlayBuilder.style.onTop": "Encima del estilo",
  "overlayBuilder.style.effect": "Efecto de pantalla",
  "overlayBuilder.style.effectOwn": "El del propio estilo",
  "overlayBuilder.style.sound": "Sonido",
  "overlayBuilder.style.soundOwn": "El sonido del propio estilo",
  "overlayBuilder.style.soundToday": "Sonido actual",
  "overlayBuilder.style.soundNone": "Ninguno",
  "overlayBuilder.style.listen": "Escuchar",
  "overlayBuilder.style.listenToday": "El sonido actual suena en OBS: usa Probar para oírlo.",
  "overlayBuilder.style.grows": "Crece con la cantidad",
  "overlayBuilder.style.test": "Probar",
  "overlayBuilder.style.testSent": "Enviado a OBS, que reproduce lo último que guardaste.",
  "overlayBuilder.families.samurai.name": "Samurái",
  "overlayBuilder.families.samurai.desc": "Las alertas actuales en rojo Ronin: un corte de espada, un torii, un marcador, un biombo y estandartes de guerra, con el omikuji para el sorteo.",
  "overlayBuilder.families.racing.name": "Carreras",
  "overlayBuilder.families.racing.desc": "Gráficos de carrera nocturna: una estela de faros deja un panel de carbono y luego un número de carrera, nitro, una pegatina de patrocinador, faros o una vuelta de la victoria. Los colores de la tarjeta, del acento y del nombre, la fuente del nombre y el texto siguen siendo tuyos.",
  "overlayBuilder.looks.follow-samurai.title": "Banda iaido",
  "overlayBuilder.looks.follow-samurai.desc": "Una espada cruza y la banda aparece a lo largo del corte. Breve, porque los follows llegan a menudo.",
  "overlayBuilder.looks.subscriber-samurai.title": "Puerta torii",
  "overlayBuilder.looks.subscriber-samurai.desc": "Los pilares se clavan, caen las dos vigas y la placa con el nombre cuelga de sus cuerdas.",
  "overlayBuilder.looks.bits-samurai.title": "Marcador",
  "overlayBuilder.looks.bits-samurai.desc": "La espada cruza el marcador y gira cada ficha de dígito a su paso.",
  "overlayBuilder.looks.donation-samurai.title": "Biombo byōbu",
  "overlayBuilder.looks.donation-samurai.desc": "Seis paneles se despliegan, los rieles encajan y la cantidad queda marcada.",
  "overlayBuilder.looks.raid-samurai.title": "Fila de estandartes",
  "overlayBuilder.looks.raid-samurai.desc": "Cinco estandartes se clavan de fuera hacia dentro; el principal llega el último, con el recuento.",
  "overlayBuilder.looks.giveaway-samurai.title": "Omikuji",
  "overlayBuilder.looks.giveaway-samurai.desc": "La caja de la fortuna se agita dos veces, salta una varilla y el papel se desenrolla con el ganador, sellado con «gran bendición».",
  "overlayBuilder.looks.follow-racing.title": "Pasada",
  "overlayBuilder.looks.follow-racing.desc": "Una estela de faros pasa y deja el panel detrás; el nombre llega con un barrido de velocidad y se encienden tres chevrones.",
  "overlayBuilder.looks.subscriber-racing.title": "Número de carrera",
  "overlayBuilder.looks.subscriber-racing.desc": "Un disco con el número de carrera se pega al panel con los meses como número, luego el nombre y el nivel.",
  "overlayBuilder.looks.bits-racing.title": "Nitro",
  "overlayBuilder.looks.bits-racing.desc": "El indicador de nitro se carga, más lejos con más bits; luego sale la llama y la cantidad sube.",
  "overlayBuilder.looks.donation-racing.title": "Pegatina de patrocinador",
  "overlayBuilder.looks.donation-racing.desc": "La cantidad se pega como la pegatina de un patrocinador y un brillo la recorre; el nombre de quien dona y el mensaje van debajo.",
  "overlayBuilder.looks.raid-racing.title": "Faros",
  "overlayBuilder.looks.raid-racing.desc": "Se encienden faros en formación, un par por raider hasta doce, mientras sube el recuento de pilotos.",
  "overlayBuilder.looks.giveaway-racing.title": "Vuelta de la victoria",
  "overlayBuilder.looks.giveaway-racing.desc": "Una luz recorre el contorno del panel y lo deja encendido; luego brilla el nombre del ganador. El premio va en una etiqueta.",
  "overlayBuilder.looks.donation-c1.title": "Remolque con valla del C1",
  "overlayBuilder.looks.donation-c1.desc": "Tu C1 remolca una valla publicitaria hasta el directo con la donación. Hecho para ti.",
  "overlayBuilder.sounds.samuraiBlade": "Espada desenvainada",
  "overlayBuilder.sounds.samuraiTaiko": "Tambor taiko",
  "overlayBuilder.sounds.samuraiTaiko3": "Tres golpes de taiko",
  "overlayBuilder.sounds.samuraiKoto": "Koto",
  "overlayBuilder.sounds.samuraiBell": "Campana de templo",
  "overlayBuilder.sounds.rcFlyby": "Pasada",
  "overlayBuilder.sounds.rcNumber": "Golpe y pitidos del número",
  "overlayBuilder.sounds.rcNitro": "Carga de nitro",
  "overlayBuilder.sounds.rcSponsor": "Golpe de pegatina",
  "overlayBuilder.sounds.rcConvoy": "Convoy",
  "overlayBuilder.sounds.rcVictory": "Fanfarria de victoria"
 },
 "fr": {
  "overlayBuilder.style.sectionTitle": "Style",
  "overlayBuilder.style.familiesLabel": "Familles de styles",
  "overlayBuilder.style.galleryLabel": "Styles pour cette alerte",
  "overlayBuilder.style.all": "Tous",
  "overlayBuilder.style.today": "Actuel",
  "overlayBuilder.style.default": "Par défaut",
  "overlayBuilder.style.mine": "Fait pour vous",
  "overlayBuilder.style.useFamily": "Utiliser {{family}} pour les six alertes",
  "overlayBuilder.style.familyDone": "{{family}} est maintenant sur les six alertes, et enregistré.",
  "overlayBuilder.style.failed": "Cela n'a pas fonctionné. Veuillez réessayer.",
  "overlayBuilder.style.colour": "Couleur",
  "overlayBuilder.style.colourPick": "Choisir une couleur",
  "overlayBuilder.style.colourOwn": "La couleur du style",
  "overlayBuilder.style.card": "Carte",
  "overlayBuilder.style.accent": "Accent",
  "overlayBuilder.style.name": "Nom",
  "overlayBuilder.style.nameFont": "Police du nom",
  "overlayBuilder.style.fontOwn": "La police du style",
  "overlayBuilder.style.label": "Texte principal",
  "overlayBuilder.style.labelHint": "Vide : les mots du style",
  "overlayBuilder.style.speed": "Vitesse",
  "overlayBuilder.style.onTop": "Par-dessus le style",
  "overlayBuilder.style.effect": "Effet d'écran",
  "overlayBuilder.style.effectOwn": "Celui du style",
  "overlayBuilder.style.sound": "Son",
  "overlayBuilder.style.soundOwn": "Le son du style",
  "overlayBuilder.style.soundToday": "Son actuel",
  "overlayBuilder.style.soundNone": "Aucun",
  "overlayBuilder.style.listen": "Écouter",
  "overlayBuilder.style.listenToday": "Le son actuel est joué dans OBS : utilisez Tester pour l'entendre.",
  "overlayBuilder.style.grows": "Grandit avec le montant",
  "overlayBuilder.style.test": "Tester",
  "overlayBuilder.style.testSent": "Envoyé à OBS, qui joue ce que vous avez enregistré en dernier.",
  "overlayBuilder.families.samurai.name": "Samouraï",
  "overlayBuilder.families.samurai.desc": "Les alertes actuelles en rouge Ronin : une coupe de lame, un torii, un tableau de comptage, un paravent et des bannières de guerre, avec l'omikuji pour le tirage.",
  "overlayBuilder.families.racing.name": "Course",
  "overlayBuilder.families.racing.desc": "Graphismes de course de nuit : une traînée de phares laisse un panneau carbone, puis un numéro de course, du nitro, un sticker de sponsor, des phares ou un tour d'honneur. Les couleurs de la carte, de l'accent et du nom, la police du nom et le texte restent les vôtres.",
  "overlayBuilder.looks.follow-samurai.title": "Bande iaido",
  "overlayBuilder.looks.follow-samurai.desc": "Une lame traverse et la bande apparaît le long de la coupe. Courte, car les follows arrivent souvent.",
  "overlayBuilder.looks.subscriber-samurai.title": "Portail torii",
  "overlayBuilder.looks.subscriber-samurai.desc": "Les piliers se plantent, les deux poutres tombent et la plaque du nom pend à ses cordes.",
  "overlayBuilder.looks.bits-samurai.title": "Tableau de comptage",
  "overlayBuilder.looks.bits-samurai.desc": "La lame traverse le tableau et retourne chaque tuile de chiffre au passage.",
  "overlayBuilder.looks.donation-samurai.title": "Paravent byōbu",
  "overlayBuilder.looks.donation-samurai.desc": "Six panneaux se déplient, les rails claquent et le montant est frappé.",
  "overlayBuilder.looks.raid-samurai.title": "Rang de bannières",
  "overlayBuilder.looks.raid-samurai.desc": "Cinq bannières se plantent de l'extérieur vers l'intérieur ; l'étendard arrive en dernier, avec le total.",
  "overlayBuilder.looks.giveaway-samurai.title": "Omikuji",
  "overlayBuilder.looks.giveaway-samurai.desc": "La boîte à fortune est secouée deux fois, une baguette jaillit et le papier se déroule avec le gagnant, tamponné « grande bénédiction ».",
  "overlayBuilder.looks.follow-racing.title": "Passage",
  "overlayBuilder.looks.follow-racing.desc": "Une traînée de phares passe et laisse le panneau derrière elle ; le nom arrive avec un effet de vitesse et trois chevrons s'allument.",
  "overlayBuilder.looks.subscriber-racing.title": "Numéro de course",
  "overlayBuilder.looks.subscriber-racing.desc": "Une pastille de numéro de course se colle sur le panneau avec les mois comme numéro, puis le nom et le palier.",
  "overlayBuilder.looks.bits-racing.title": "Nitro",
  "overlayBuilder.looks.bits-racing.desc": "La jauge de nitro se charge, plus loin pour plus de bits, puis la flamme part et le montant défile.",
  "overlayBuilder.looks.donation-racing.title": "Sticker de sponsor",
  "overlayBuilder.looks.donation-racing.desc": "Le montant est collé comme le sticker d'un sponsor et un reflet le traverse ; le nom du donateur et le message sont dessous.",
  "overlayBuilder.looks.raid-racing.title": "Phares",
  "overlayBuilder.looks.raid-racing.desc": "Une formation de phares s'allume, une paire par raider jusqu'à douze, pendant que le nombre de pilotes défile.",
  "overlayBuilder.looks.giveaway-racing.title": "Tour d'honneur",
  "overlayBuilder.looks.giveaway-racing.desc": "Une lumière fait le tour du panneau et le laisse allumé, puis le nom du gagnant brille. Le lot est sur une étiquette.",
  "overlayBuilder.looks.donation-c1.title": "Remorque panneau de la C1",
  "overlayBuilder.looks.donation-c1.desc": "Votre C1 tire un panneau publicitaire jusqu'au stream avec le don dessus. Fait pour vous.",
  "overlayBuilder.sounds.samuraiBlade": "Lame dégainée",
  "overlayBuilder.sounds.samuraiTaiko": "Tambour taiko",
  "overlayBuilder.sounds.samuraiTaiko3": "Trois coups de taiko",
  "overlayBuilder.sounds.samuraiKoto": "Koto",
  "overlayBuilder.sounds.samuraiBell": "Cloche de temple",
  "overlayBuilder.sounds.rcFlyby": "Passage",
  "overlayBuilder.sounds.rcNumber": "Claque et bips du numéro",
  "overlayBuilder.sounds.rcNitro": "Charge de nitro",
  "overlayBuilder.sounds.rcSponsor": "Claque du sticker",
  "overlayBuilder.sounds.rcConvoy": "Convoi",
  "overlayBuilder.sounds.rcVictory": "Fanfare de victoire"
 },
 "de": {
  "overlayBuilder.style.sectionTitle": "Stil",
  "overlayBuilder.style.familiesLabel": "Stil-Familien",
  "overlayBuilder.style.galleryLabel": "Stile für diesen Alert",
  "overlayBuilder.style.all": "Alle",
  "overlayBuilder.style.today": "Aktuell",
  "overlayBuilder.style.default": "Standard",
  "overlayBuilder.style.mine": "Für dich gemacht",
  "overlayBuilder.style.useFamily": "{{family}} für alle sechs Alerts verwenden",
  "overlayBuilder.style.familyDone": "{{family}} ist jetzt bei allen sechs Alerts aktiv und gespeichert.",
  "overlayBuilder.style.failed": "Das hat nicht geklappt. Bitte versuche es noch einmal.",
  "overlayBuilder.style.colour": "Farbe",
  "overlayBuilder.style.colourPick": "Farbe wählen",
  "overlayBuilder.style.colourOwn": "Eigene Farbe des Stils",
  "overlayBuilder.style.card": "Karte",
  "overlayBuilder.style.accent": "Akzent",
  "overlayBuilder.style.name": "Name",
  "overlayBuilder.style.nameFont": "Schrift des Namens",
  "overlayBuilder.style.fontOwn": "Eigene Schrift des Stils",
  "overlayBuilder.style.label": "Haupttext",
  "overlayBuilder.style.labelHint": "Leer: die eigenen Worte des Stils",
  "overlayBuilder.style.speed": "Tempo",
  "overlayBuilder.style.onTop": "Zusätzlich zum Stil",
  "overlayBuilder.style.effect": "Bildschirmeffekt",
  "overlayBuilder.style.effectOwn": "Der eigene des Stils",
  "overlayBuilder.style.sound": "Sound",
  "overlayBuilder.style.soundOwn": "Eigener Sound des Stils",
  "overlayBuilder.style.soundToday": "Aktueller Sound",
  "overlayBuilder.style.soundNone": "Keiner",
  "overlayBuilder.style.listen": "Anhören",
  "overlayBuilder.style.listenToday": "Der aktuelle Sound spielt in OBS: Nutze Testen, um ihn zu hören.",
  "overlayBuilder.style.grows": "Wächst mit dem Betrag",
  "overlayBuilder.style.test": "Testen",
  "overlayBuilder.style.testSent": "An OBS gesendet. Dort spielt, was du zuletzt gespeichert hast.",
  "overlayBuilder.families.samurai.name": "Samurai",
  "overlayBuilder.families.samurai.desc": "Die aktuellen Alerts in Ronin-Rot: ein Klingenschnitt, ein Torii, eine Zähltafel, ein Faltschirm und Kriegsbanner, dazu das Omikuji für das Gewinnspiel.",
  "overlayBuilder.families.racing.name": "Racing",
  "overlayBuilder.families.racing.desc": "Nachtrennen-Grafik: Ein Scheinwerferstreifen hinterlässt ein Carbon-Panel, dann folgen Startnummer, Nitro, Sponsor-Aufkleber, Scheinwerfer oder Ehrenrunde. Karten-, Akzent- und Namensfarbe, die Schrift des Namens und der Text bleiben deine.",
  "overlayBuilder.looks.follow-samurai.title": "Iaido-Band",
  "overlayBuilder.looks.follow-samurai.desc": "Eine Klinge schneidet, und das Band erscheint entlang des Schnitts. Kurz, weil Follows oft kommen.",
  "overlayBuilder.looks.subscriber-samurai.title": "Torii-Tor",
  "overlayBuilder.looks.subscriber-samurai.desc": "Die Säulen stehen, beide Balken fallen, und das Namensschild hängt an seinen Schnüren.",
  "overlayBuilder.looks.bits-samurai.title": "Zähltafel",
  "overlayBuilder.looks.bits-samurai.desc": "Die Klinge fährt über die Tafel und dreht dabei jedes Ziffernplättchen um.",
  "overlayBuilder.looks.donation-samurai.title": "Byōbu-Schirm",
  "overlayBuilder.looks.donation-samurai.desc": "Sechs Paneele klappen auf, die Leisten rasten ein, und der Betrag wird eingeschlagen.",
  "overlayBuilder.looks.raid-samurai.title": "Bannerreihe",
  "overlayBuilder.looks.raid-samurai.desc": "Fünf Banner werden von außen nach innen aufgepflanzt; die Standarte kommt zuletzt, mit der Anzahl.",
  "overlayBuilder.looks.giveaway-samurai.title": "Omikuji",
  "overlayBuilder.looks.giveaway-samurai.desc": "Die Glücksbox wird zweimal geschüttelt, ein Stäbchen springt heraus, und das Los entrollt sich mit dem Gewinner, gestempelt mit „großer Segen“.",
  "overlayBuilder.looks.follow-racing.title": "Vorbeiflug",
  "overlayBuilder.looks.follow-racing.desc": "Ein Scheinwerferstreifen fliegt vorbei und hinterlässt das Panel; der Name landet mit Tempo-Wischer, und drei Chevrons leuchten auf.",
  "overlayBuilder.looks.subscriber-racing.title": "Startnummer",
  "overlayBuilder.looks.subscriber-racing.desc": "Eine Startnummer-Plakette klatscht mit den Monaten als Nummer aufs Panel, dann folgen Name und Stufe.",
  "overlayBuilder.looks.bits-racing.title": "Nitro",
  "overlayBuilder.looks.bits-racing.desc": "Die Nitro-Anzeige lädt, bei mehr Bits weiter, dann zündet die Flamme und der Betrag zählt hoch.",
  "overlayBuilder.looks.donation-racing.title": "Sponsor-Aufkleber",
  "overlayBuilder.looks.donation-racing.desc": "Der Betrag wird wie ein Sponsor-Aufkleber aufgeklatscht, ein Glanz läuft darüber; Name und Nachricht stehen darunter.",
  "overlayBuilder.looks.raid-racing.title": "Scheinwerfer",
  "overlayBuilder.looks.raid-racing.desc": "Eine Formation Scheinwerfer geht an, ein Paar pro Raider bis zu zwölf, während die Zahl der Fahrer hochzählt.",
  "overlayBuilder.looks.giveaway-racing.title": "Ehrenrunde",
  "overlayBuilder.looks.giveaway-racing.desc": "Ein Licht umrundet den Rand des Panels und lässt ihn leuchten, dann strahlt der Name des Gewinners. Der Preis steht auf einem Schild.",
  "overlayBuilder.looks.donation-c1.title": "C1 mit Plakatanhänger",
  "overlayBuilder.looks.donation-c1.desc": "Dein C1 zieht ein Werbeplakat mit der Spende in den Stream. Für dich gemacht.",
  "overlayBuilder.sounds.samuraiBlade": "Klinge gezogen",
  "overlayBuilder.sounds.samuraiTaiko": "Taiko-Trommel",
  "overlayBuilder.sounds.samuraiTaiko3": "Drei Taiko-Schläge",
  "overlayBuilder.sounds.samuraiKoto": "Koto",
  "overlayBuilder.sounds.samuraiBell": "Tempelglocke",
  "overlayBuilder.sounds.rcFlyby": "Vorbeiflug",
  "overlayBuilder.sounds.rcNumber": "Klatschen und Pieptöne",
  "overlayBuilder.sounds.rcNitro": "Nitro-Ladung",
  "overlayBuilder.sounds.rcSponsor": "Aufkleber-Klatschen",
  "overlayBuilder.sounds.rcConvoy": "Konvoi",
  "overlayBuilder.sounds.rcVictory": "Siegesfanfare"
 },
 "zh": {
  "overlayBuilder.style.sectionTitle": "样式",
  "overlayBuilder.style.familiesLabel": "样式系列",
  "overlayBuilder.style.galleryLabel": "此提醒的样式",
  "overlayBuilder.style.all": "全部",
  "overlayBuilder.style.today": "当前",
  "overlayBuilder.style.default": "默认",
  "overlayBuilder.style.mine": "为你定制",
  "overlayBuilder.style.useFamily": "六种提醒都使用{{family}}",
  "overlayBuilder.style.familyDone": "{{family}}已用于全部六种提醒，并已保存。",
  "overlayBuilder.style.failed": "没有成功，请再试一次。",
  "overlayBuilder.style.colour": "颜色",
  "overlayBuilder.style.colourPick": "选择颜色",
  "overlayBuilder.style.colourOwn": "样式自带的颜色",
  "overlayBuilder.style.card": "卡片",
  "overlayBuilder.style.accent": "强调色",
  "overlayBuilder.style.name": "名字",
  "overlayBuilder.style.nameFont": "名字字体",
  "overlayBuilder.style.fontOwn": "样式自带的字体",
  "overlayBuilder.style.label": "主文字",
  "overlayBuilder.style.labelHint": "留空：使用样式自带的文字",
  "overlayBuilder.style.speed": "速度",
  "overlayBuilder.style.onTop": "叠加在样式之上",
  "overlayBuilder.style.effect": "屏幕特效",
  "overlayBuilder.style.effectOwn": "样式自带的",
  "overlayBuilder.style.sound": "声音",
  "overlayBuilder.style.soundOwn": "样式自带的声音",
  "overlayBuilder.style.soundToday": "当前声音",
  "overlayBuilder.style.soundNone": "无",
  "overlayBuilder.style.listen": "试听",
  "overlayBuilder.style.listenToday": "当前声音在 OBS 中播放：点击“测试”即可听到。",
  "overlayBuilder.style.grows": "随数量变化",
  "overlayBuilder.style.test": "测试",
  "overlayBuilder.style.testSent": "已发送到 OBS，播放的是你最后保存的内容。",
  "overlayBuilder.families.samurai.name": "武士",
  "overlayBuilder.families.samurai.desc": "当前的提醒，浪人红配色：刀光一斩、鸟居、计数板、屏风和战旗，抽奖则是御神签。",
  "overlayBuilder.families.racing.name": "赛车",
  "overlayBuilder.families.racing.desc": "夜间赛车动效：车灯光迹掠过，留下碳纤维面板，随后是赛车号码、氮气、赞助贴纸、车灯阵列或胜利圈。卡片、强调色和名字的颜色、名字的字体以及文字都由你决定。",
  "overlayBuilder.looks.follow-samurai.title": "居合横幅",
  "overlayBuilder.looks.follow-samurai.desc": "刀光掠过，横幅沿着切口出现。很短，因为关注来得频繁。",
  "overlayBuilder.looks.subscriber-samurai.title": "鸟居",
  "overlayBuilder.looks.subscriber-samurai.desc": "立柱落地，两道横梁落下，名字牌挂在绳上。",
  "overlayBuilder.looks.bits-samurai.title": "计数板",
  "overlayBuilder.looks.bits-samurai.desc": "刀刃划过计数板，经过时翻转每块数字牌。",
  "overlayBuilder.looks.donation-samurai.title": "屏风",
  "overlayBuilder.looks.donation-samurai.desc": "六扇屏风展开，横栏扣上，金额被盖印其上。",
  "overlayBuilder.looks.raid-samurai.title": "战旗阵列",
  "overlayBuilder.looks.raid-samurai.desc": "五面战旗由外向内插下；主旗最后落下，带着人数。",
  "overlayBuilder.looks.giveaway-samurai.title": "御神签",
  "overlayBuilder.looks.giveaway-samurai.desc": "签筒摇两下，一支签弹出，签纸展开写着中奖者，盖上“大吉”印章。",
  "overlayBuilder.looks.follow-racing.title": "掠过",
  "overlayBuilder.looks.follow-racing.desc": "车灯光迹掠过，留下面板；名字带着速度拖影落下，三个箭头依次亮起。",
  "overlayBuilder.looks.subscriber-racing.title": "赛车号码",
  "overlayBuilder.looks.subscriber-racing.desc": "号码圆牌贴上面板，月数就是号码，然后是名字和等级。",
  "overlayBuilder.looks.bits-racing.title": "氮气",
  "overlayBuilder.looks.bits-racing.desc": "氮气表充能，Bits 越多充得越满，随后火焰喷出，金额滚动上升。",
  "overlayBuilder.looks.donation-racing.title": "赞助贴纸",
  "overlayBuilder.looks.donation-racing.desc": "金额像赞助商贴纸一样贴上，一道光泽划过；捐赠者的名字和留言在下方。",
  "overlayBuilder.looks.raid-racing.title": "车灯",
  "overlayBuilder.looks.raid-racing.desc": "车灯阵列依次点亮，每位突袭者一对，最多十二对，车手人数同时滚动上升。",
  "overlayBuilder.looks.giveaway-racing.title": "胜利圈",
  "overlayBuilder.looks.giveaway-racing.desc": "一道光沿面板边缘绕行一圈并保持点亮，随后中奖者的名字发光。奖品显示在标签上。",
  "overlayBuilder.looks.donation-c1.title": "C1 拖车广告牌",
  "overlayBuilder.looks.donation-c1.desc": "你的 C1 拖着写有捐赠的广告牌驶入直播。为你定制。",
  "overlayBuilder.sounds.samuraiBlade": "拔刀",
  "overlayBuilder.sounds.samuraiTaiko": "太鼓",
  "overlayBuilder.sounds.samuraiTaiko3": "三声太鼓",
  "overlayBuilder.sounds.samuraiKoto": "日本筝",
  "overlayBuilder.sounds.samuraiBell": "寺钟",
  "overlayBuilder.sounds.rcFlyby": "呼啸掠过",
  "overlayBuilder.sounds.rcNumber": "号码贴上与提示音",
  "overlayBuilder.sounds.rcNitro": "氮气充能",
  "overlayBuilder.sounds.rcSponsor": "贴纸拍上",
  "overlayBuilder.sounds.rcConvoy": "车队",
  "overlayBuilder.sounds.rcVictory": "胜利号角"
 },
 "ja": {
  "overlayBuilder.style.sectionTitle": "スタイル",
  "overlayBuilder.style.familiesLabel": "スタイルのシリーズ",
  "overlayBuilder.style.galleryLabel": "このアラートのスタイル",
  "overlayBuilder.style.all": "すべて",
  "overlayBuilder.style.today": "現在",
  "overlayBuilder.style.default": "デフォルト",
  "overlayBuilder.style.mine": "あなた専用",
  "overlayBuilder.style.useFamily": "6つのアラートすべてに{{family}}を使う",
  "overlayBuilder.style.familyDone": "{{family}}を6つのアラートすべてに設定し、保存しました。",
  "overlayBuilder.style.failed": "うまくいきませんでした。もう一度お試しください。",
  "overlayBuilder.style.colour": "色",
  "overlayBuilder.style.colourPick": "色を選ぶ",
  "overlayBuilder.style.colourOwn": "スタイル本来の色",
  "overlayBuilder.style.card": "カード",
  "overlayBuilder.style.accent": "アクセント",
  "overlayBuilder.style.name": "名前",
  "overlayBuilder.style.nameFont": "名前のフォント",
  "overlayBuilder.style.fontOwn": "スタイル本来のフォント",
  "overlayBuilder.style.label": "メインテキスト",
  "overlayBuilder.style.labelHint": "空欄：スタイル本来の言葉",
  "overlayBuilder.style.speed": "速度",
  "overlayBuilder.style.onTop": "スタイルに重ねる",
  "overlayBuilder.style.effect": "画面エフェクト",
  "overlayBuilder.style.effectOwn": "スタイル本来のもの",
  "overlayBuilder.style.sound": "サウンド",
  "overlayBuilder.style.soundOwn": "スタイル本来のサウンド",
  "overlayBuilder.style.soundToday": "現在のサウンド",
  "overlayBuilder.style.soundNone": "なし",
  "overlayBuilder.style.listen": "試聴",
  "overlayBuilder.style.listenToday": "現在のサウンドは OBS で鳴ります。「テスト」で確認できます。",
  "overlayBuilder.style.grows": "金額に応じて大きくなる",
  "overlayBuilder.style.test": "テスト",
  "overlayBuilder.style.testSent": "OBS に送信しました。最後に保存した内容が再生されます。",
  "overlayBuilder.families.samurai.name": "侍",
  "overlayBuilder.families.samurai.desc": "現在のアラートを浪人の赤で：刀の一閃、鳥居、集計板、屏風、旗指物、そしてプレゼント企画にはおみくじ。",
  "overlayBuilder.families.racing.name": "レーシング",
  "overlayBuilder.families.racing.desc": "ナイトレースのモーショングラフィックス：ヘッドライトの光跡がカーボンパネルを残し、ゼッケン、ニトロ、スポンサーステッカー、ヘッドライト、ウイニングランへ。カード・アクセント・名前の色、名前のフォント、テキストは自由に設定できます。",
  "overlayBuilder.looks.follow-samurai.title": "居合の帯",
  "overlayBuilder.looks.follow-samurai.desc": "刀が走り、斬り口に沿って帯が現れます。フォローは頻繁に来るので短めです。",
  "overlayBuilder.looks.subscriber-samurai.title": "鳥居",
  "overlayBuilder.looks.subscriber-samurai.desc": "柱が立ち、二本の梁が落ち、名前の額が紐で吊るされます。",
  "overlayBuilder.looks.bits-samurai.title": "集計板",
  "overlayBuilder.looks.bits-samurai.desc": "刀が板を横切り、通るたびに数字の札をめくります。",
  "overlayBuilder.looks.donation-samurai.title": "屏風",
  "overlayBuilder.looks.donation-samurai.desc": "六曲の屏風が開き、桟がはまり、金額が刻まれます。",
  "overlayBuilder.looks.raid-samurai.title": "旗指物の列",
  "overlayBuilder.looks.raid-samurai.desc": "五本の旗が外側から内側へ立ち、最後に人数を掲げた大旗が立ちます。",
  "overlayBuilder.looks.giveaway-samurai.title": "おみくじ",
  "overlayBuilder.looks.giveaway-samurai.desc": "みくじ箱を二度振ると棒が飛び出し、当選者の名前が書かれた紙が開いて「大吉」の印が押されます。",
  "overlayBuilder.looks.follow-racing.title": "フライバイ",
  "overlayBuilder.looks.follow-racing.desc": "ヘッドライトの光跡が走り抜けてパネルを残し、名前がスピード感とともに現れ、三つのシェブロンが灯ります。",
  "overlayBuilder.looks.subscriber-racing.title": "ゼッケン",
  "overlayBuilder.looks.subscriber-racing.desc": "月数を番号にしたゼッケンがパネルに貼られ、続いて名前とティアが表示されます。",
  "overlayBuilder.looks.bits-racing.title": "ニトロ",
  "overlayBuilder.looks.bits-racing.desc": "ニトロゲージがチャージされ（Bits が多いほど満タンに）、炎が噴き出して金額がカウントアップします。",
  "overlayBuilder.looks.donation-racing.title": "スポンサーステッカー",
  "overlayBuilder.looks.donation-racing.desc": "金額がスポンサーステッカーのように貼られ、光沢が走ります。寄付した人の名前とメッセージは下に表示されます。",
  "overlayBuilder.looks.raid-racing.title": "ヘッドライト",
  "overlayBuilder.looks.raid-racing.desc": "ヘッドライトが隊列で点灯し（レイダー1人につき1組、最大12組）、ドライバーの人数がカウントアップします。",
  "overlayBuilder.looks.giveaway-racing.title": "ウイニングラン",
  "overlayBuilder.looks.giveaway-racing.desc": "光がパネルの縁を一周して灯したままにし、当選者の名前が輝きます。賞品はタグに表示されます。",
  "overlayBuilder.looks.donation-c1.title": "C1 ビルボードトレーラー",
  "overlayBuilder.looks.donation-c1.desc": "あなたの C1 が寄付を載せた看板を引いて配信に登場します。あなた専用です。",
  "overlayBuilder.sounds.samuraiBlade": "抜刀",
  "overlayBuilder.sounds.samuraiTaiko": "太鼓",
  "overlayBuilder.sounds.samuraiTaiko3": "太鼓三打",
  "overlayBuilder.sounds.samuraiKoto": "琴",
  "overlayBuilder.sounds.samuraiBell": "寺の鐘",
  "overlayBuilder.sounds.rcFlyby": "フライバイ",
  "overlayBuilder.sounds.rcNumber": "ゼッケンの音とビープ",
  "overlayBuilder.sounds.rcNitro": "ニトロチャージ",
  "overlayBuilder.sounds.rcSponsor": "ステッカーの音",
  "overlayBuilder.sounds.rcConvoy": "コンボイ",
  "overlayBuilder.sounds.rcVictory": "勝利のファンファーレ"
 }
};
const after = "overlayBuilder.error.family";
for (const [lang, texts] of Object.entries(add)) {
  const file = `src/locales/${lang}.json`;
  let lines = fs.readFileSync(file, 'utf8').split('\n');
  lines = lines.filter((l) => !l.startsWith('  "overlayBuilder.fixedNotice": '));   // the text this task removes
  const at = lines.findIndex((l) => l.startsWith(`  ${JSON.stringify(after)}: `));
  if (at < 0) throw new Error(`${file}: ${after} not found`);
  lines.splice(at + 1, 0, ...Object.entries(texts).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`));
  fs.writeFileSync(file, lines.join('\n'));
  JSON.parse(fs.readFileSync(file, 'utf8'));   // still valid JSON
}
ATLETA_SCRIPT
````

- [ ] **Step 4: Run the task's tests, then the whole suite**

````bash
node --test src/routes/dashboard.test.js src/services/overlayDesign.test.js tests/i18n.test.js tests/overlayBuilder.test.js tests/streamerViewsI18n.test.js
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, and the whole suite passes (2745 tests on the C1 branch at 040b180 with Tasks 1–14).

- [ ] **Step 5: Commit**

````bash
git add src/locales/de.json src/locales/en.json src/locales/es.json src/locales/fr.json src/locales/ja.json src/locales/pt.json src/locales/zh.json src/routes/dashboard.js src/views/overlay-builder.ejs src/routes/dashboard.test.js src/services/overlayDesign.test.js tests/i18n.test.js tests/overlayBuilder.test.js tests/streamerViewsI18n.test.js
git commit -m "feat(overlay-builder): the Style section, a gallery of looks and their controls" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

### Task 15: The docs, the boot check and the check in OBS

This task records what release A changed, so the next person (and the next family) knows the rules. It then runs the
checks that unit tests cannot: two boots on a fresh database as CI does, and the looks in a real OBS browser source.

**Files:**
- Modify: `CLAUDE.md` (Project Structure, Key Architecture, Overlay Consistency Rule, Team Activity Log)
- Modify: `docs/operations/deploy.md` (release notes)

- [ ] **Step 1: `CLAUDE.md`, Project Structure**

Under `src/services/`, after the `overlayDesign.js` line, add:

````text
│   ├── alertStyles.js    # The alert looks for the server, read from the registry (public/overlay/objects/kit.js + styles/): private looks (donation-c1), default looks, galleries, families, sounds, fonts
│   ├── alertStyleBundle.js # The family files joined into /overlay/objects/styles.css and styles.js, read once, with a version for ?v=
````

Under `public/`:

- Replace the `objects/` line with the first line below.
- Add the `fx.js, fx.css` line under it.
- Add the third line next to the other `js/` lines.

````text
    ├── objects/          # The alert looks: index.js (today's five objects + the style map) + objects.css, kit.js (what every look shares), styles/<family>.js + .css (one pair per family, joined for the pages); every class namespaced .o-*
    ├── fx.js, fx.css     # The looks' five screen effects (smoke, checker, speed, sparks, champagne), for the OBS overlay and the builder preview
├── js/builder-styles-core.js  # The Overlay Builder's Style section rules (pure, dual-exported, tests/builderStylesCore.test.js)
````

- [ ] **Step 2: `CLAUDE.md`, Key Architecture**

After the **Overlay Builder:** bullet, add this bullet:

````markdown
- **Alert styles** → `docs/superpowers/specs/2026-10-15-alert-styles-design.md`. Each of the six alerts (the five Twitch ones and the giveaway winner) is drawn in a look picked from a gallery in the Overlay Builder's Style section. `overlay_designs.style` names it (`<alert>-<family>`, e.g. `follow-racing`); NULL is the alert's default look: today's object for the five, `giveaway-racing` for the giveaway (`kit.js` `DEFAULT_LOOKS`). Release A has the Samurai family (today's five objects as presets `follow-samurai` … `raid-samurai`, and the omikuji `giveaway-samurai`) and Racing; andre_vilela_'s `donation-c1` is private (`PRIVATE_STYLES` in `alertStyles.js`, found by Twitch user id). A look's settings: `style_accent` (every look takes the streamer's colour: the slot carries `--a` and its shades from `kit.accentVars`, and today's samurai reds read them with today's colours as fallbacks), `style_label` (at most 40 characters), `style_sound` (one this release does not know plays the look's own), `style_grows`, and the reused `screen_effect` (`default` is the look's own) and `animation_speed`; Racing keeps today's columns (card, accent and name colours, name font, `event_label`). Picking another look empties its settings (`db.setOverlayDesignStyle`, the builder's `withLook`); "Use <family> for all six alerts" is `POST /dashboard/overlay-builder/family` (one transaction). An alert nobody has restyled stays as before: no screen effect whatever an older builder saved, speed 1, today's sound (`kit.effectFor`, `kit.soundFor`). A look stays at least its entrance plus a second, is drawn for 420 px and scaled to the saved width (`.alert-pos.look`), and its first alert waits at most 1.5 s for its family's fonts; a look that throws falls back to the alert's own object or card. **Adding a family:** `public/overlay/objects/styles/<family>.js` + `.css` from the proposal (`docs/superpowers/specs/assets/2026-10-15-alert-styles/`, spec section 5): prefix its classes and keyframes, divide every animation time by `--spd`, colour each look's main element with the accent, register its sounds under the family, and add its texts in all seven locales (`overlayBuilder.families.<key>.name/desc`, `overlayBuilder.looks.<id>.title/desc`, `overlayBuilder.sounds.<key>`); `tests/alertLooks.test.js` (add the family's prefixes to `PREFIXES`) and `tests/i18n.test.js` check it.
````

- [ ] **Step 3: `CLAUDE.md`, Overlay Consistency Rule**

After the **Object registry:** bullet, add:

````markdown
- **Looks:** the alert looks (`objects/kit.js`, `objects/styles/`) are drawn by both pages from the same files. The builder's `previewObjectFor` and the overlay's `objectFor` pick with the same rule (`tests/overlayBuilder.test.js` runs both). A look's data comes from `kit.lookData`, its colour and speed from `kit.slotVars`, its effect and sound from `kit.effectFor`/`kit.soundFor`, and its five new screen effects from `fx.js` (`spawnEffects` and `renderScreenEffect` both call `ATLETA_FX.spawn`).
````

- [ ] **Step 4: `docs/operations/deploy.md`, release notes**

Add this section after the last release notes section:

````markdown
## Alert styles (release A)

What changes when it deploys:
- Four columns are added to `overlay_designs` (`style_accent`, `style_label`, `style_sound`, `style_grows`); the boot log shows `[DB] Added style_… to overlay_designs` four times, once. Nothing stored is rewritten.
- The giveaway winner alert becomes Racing's Victory lap for every streamer (decided). Its saved colours, text and screen effect carry over; it plays the look's fanfare unless the streamer uploaded a sound.
- Every other alert stays exactly as it is until its streamer picks a look in the Overlay Builder's Style section.
- The overlay page and the builder load `/overlay/objects/kit.js`, `/overlay/objects/styles.js?v=…` and `.css`, and `/overlay/fx.js`/`fx.css`. An open OBS source reloads itself when the server restarts.

After the deploy (while no streamer is live):
1. `/health` answers 200, and the boot log shows the four `Added style_…` lines.
2. In the Overlay Builder, the Style section opens each of the six alert tabs. Pick Racing's Fly-by for the follow, save, and press Test: OBS plays it.
3. Pick a colour far from the look's own (cyan on a red look) and test again: the change is obvious.
4. andre_vilela_'s donation still shows the C1, first in his gallery as "Made for you".

Rolling back is safe: older code ignores the four columns, and a style id it does not know (`follow-racing`) draws the alert's own object.
````

- [ ] **Step 5: Boot twice on a fresh database, as CI does**

````bash
tmp=$(mktemp -d) && cp -R . "$tmp/app" && cd "$tmp/app" && rm -rf data
for boot in 1 2; do
  DISCORD_DISABLED=1 TWITCH_CLIENT_ID=x TWITCH_CLIENT_SECRET=x PORT=3999 node src/index.js > boot-$boot.log 2>&1 &
  pid=$!; sleep 6
  curl -fsS http://127.0.0.1:3999/health && echo
  curl -fsS -o /dev/null -w "styles.js %{http_code}\n" http://127.0.0.1:3999/overlay/objects/styles.js
  kill -TERM $pid; wait $pid; echo "exit $?"
done
grep -c "\[DB migration\]" boot-1.log boot-2.log
grep "Added style_" boot-1.log boot-2.log
cd - && rm -rf "$tmp"
````

Expected:

- Both boots answer `{"ok":true}` and `styles.js 200`, and exit 0.
- There is no `[DB migration]` line.
- The four `Added style_…` lines appear in `boot-1.log` only.

- [ ] **Step 6: Run the whole suite once more, and update the Team Activity Log**

````bash
node --test "src/**/*.test.js" "tests/**/*.test.js"
````

Expected: PASS, 2745 tests on the C1 branch at `040b180` with Tasks 1–14.

Append an entry to `CLAUDE.md`'s Team Activity Log, in its format:

- **Task:** "Alert styles, release A: the style system, Samurai presets + omikuji, Racing; every look takes the streamer's colour".
- **Files:** the files above.
- **Decisions:** the four columns and the reset on a new look; the giveaway's Victory lap for everyone; untouched alerts unchanged; families as joined files read by the server too.
- **Open:** the check in OBS (Step 7) if it was not done yet; releases B–D (spec 8); a native read-through of the new translations.

- [ ] **Step 7: Check the looks in OBS (spec 7, "In OBS, by hand")**

With the branch running locally (`npm run dev`) and a streamer's overlay URL added to OBS as a browser source (1920×1080):

1. In the Overlay Builder, for each of the six alerts, pick each look (Samurai and Racing), save, and press Test. Watch it at speed 1, then at 1.5 (the speed slider, for the looks that have one).
2. Pick a red (`#E8202A`) and then a cyan (`#29E0FF`) for one look of each family, test both, and check the change is obvious. Do the same for Racing's card and accent colours.
3. Test the giveaway with no look picked: it is the Victory lap, in its saved colours.
4. Watch most closely the omikuji's shake, Racing's Victory lap outline and Nitro flame, and the clip-path reveals.
5. Set the follow's width to 600 and position bottom-right with Racing's Fly-by: the look is larger, not reflowed, and sits there.

Write what was seen into the Team Activity Log entry ("Open: none", or what needs a fix).

- [ ] **Step 8: Commit and push the branch (not `main`)**

````bash
git add CLAUDE.md docs/operations/deploy.md
git commit -m "docs: alert styles release A" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin feat/alert-styles
````

Merging into `main` deploys to production. That is the owner's call, after the C1 branch has merged and while no
streamer is live (`docs/operations/deploy.md`).
