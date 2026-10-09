# Samurai Alert Objects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five Twitch alert cards (`follow`, `subscription`, `bits`, `donation`, `raid`) with five visually distinct objects driven by a single shared registry, so existing streamers get the new design with no action required.

**Architecture:** One browser-side registry at `public/overlay/objects/` defines each object's markup, keyframe names and timing. Both render paths — the OBS overlay (`overlay.js`) and the builder preview (`overlay-builder.ejs`) — consume it. The registry dual-exports (browser global + CommonJS) so `node:test` can assert its contract without a DOM. A versioned, backed-up DB migration guarantees nobody has to touch the app.

**Tech Stack:** Plain CommonJS, no build step, no bundler. `node:test` + `node:assert/strict` for unit tests. Playwright for E2E. better-sqlite3 for migrations. Google Fonts (Oxanium + Saira Condensed).

**Spec:** `docs/superpowers/specs/2026-10-09-samurai-alert-objects-design.md`
**Approved prototype (committed):** `docs/superpowers/specs/assets/2026-10-09-alert-objects-prototype.html`

## Global Constraints

- **No build step.** Plain CommonJS (`require`/`module.exports`), no ESM, no bundler. Browser files are served as-is by `express.static` (`src/server.js:56`).
- **EJS templates cannot `require()`.** Express runs them in a sandboxed scope; inline `<% require(...) %>` throws in production. Shared code reaches views via `<script src>` only.
- **Phase 1 is fixed scarlet.** The five objects ignore saved `overlay_designs` style columns. Per-user colour is a separate follow-up plan.
- **Typeface: Oxanium (display) + Saira Condensed (labels)**, loaded from Google Fonts. Not The Last Shuriken.
- **Brand tokens, exact values:** `--r-red: #D81E26`, `--r-red-deep: #B50000`, `--r-ink: #070B10`.
- **Class namespacing is mandatory.** Every object-internal class sits under its `.o-*` prefix. A generic `.rail` class in the prototype collided with the builder page's sticky `.rail` control bar and pinned an element to the wrong edge. The builder page is large; generic names will collide.
- **Only five event types change.** `yt_superchat`, `yt_member`, `yt_giftmember`, `giveaway_winner`, `timed`, redemptions and the tip-goal bar keep today's code path untouched.
- **Migrations are additive and idempotent**, wrapped in `try { } catch {}`, following the existing pattern at `src/db.js:2949-2970`.

---

## File Structure

**Create:**
- `public/overlay/objects/index.js` — the registry: five objects, each with `render(data)`, `anim`, `exit`; plus `esc()` and the currency helper. Dual-exported.
- `public/overlay/objects/objects.css` — all five objects' styles, keyframes, and the shared `.alert-pos` / `.o-blade` rules.
- `tests/overlayObjects.test.js` — contract and markup tests for the registry.
- `tests/alertObjects.spec.js` — Playwright smoke test against the real overlay.

**Modify:**
- `public/overlay/overlay.js` — card creation (393-398), `buildBannerContent()` (444), `applyCustomDesign()` (920).
- `src/routes/overlay.js:322-338` — add the stylesheet, font link and `<script src>`.
- `src/db.js` — `design_version` column + `overlay_designs_v0_backup` table.
- `src/views/overlay-builder.ejs` — static preview DOM (1105-1130), `updatePreview()` (1363), phase-1 controls.
- `CLAUDE.md` — replace the Overlay Consistency Rule.

**Deliberate deviation from the spec:** the spec sketched six separate JS files (`follow.js`, `bits.js`, …). With no bundler that means six ordered `<script src>` tags and six requests. One `index.js` (~320 lines, comparable to this repo's other files) is simpler and less fragile. The CSS stays one file for the same reason.

**No change:** `src/views/overlay-config.ejs` — it previews by loading the real overlay in an iframe (`iframe.src = overlayUrlBase`, line 842), so it inherits the new objects automatically.

---

### Task 1: Registry skeleton with dual export

**Files:**
- Create: `public/overlay/objects/index.js`
- Test: `tests/overlayObjects.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: global `ATLETA_OBJECTS` in a browser; `module.exports` in Node. Shape per key:
  `{ key: string, render(data) -> string, anim: {in, dur, ease}, exit: {out, dur, ease} }`.
  `data` is the overlay event's `event.data` object (`{ username, amount, currency, bits, viewers, months, tier, message }`).

- [ ] **Step 1: Write the failing test**

```js
// tests/overlayObjects.test.js
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const OBJECTS = require('../public/overlay/objects/index.js');

const KEYS = ['follow', 'subscription', 'bits', 'donation', 'raid'];

describe('object registry contract', () => {
  test('exports exactly the five Twitch event types', () => {
    assert.deepEqual(Object.keys(OBJECTS).sort(), [...KEYS].sort());
  });

  test('every object has a render function and timing metadata', () => {
    for (const k of KEYS) {
      const o = OBJECTS[k];
      assert.equal(o.key, k, `${k}: key must match its registry slot`);
      assert.equal(typeof o.render, 'function', `${k}: render must be a function`);
      for (const phase of ['anim', 'exit']) {
        assert.ok(o[phase], `${k}: missing ${phase}`);
        assert.match(o[phase].dur, /^\d+(\.\d+)?s$/, `${k}: ${phase}.dur must be like "0.40s"`);
        assert.equal(typeof o[phase].ease, 'string', `${k}: ${phase}.ease must be a string`);
      }
      assert.equal(typeof o.anim.in, 'string', `${k}: anim.in must name a keyframe`);
      assert.equal(typeof o.exit.out, 'string', `${k}: exit.out must name a keyframe`);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/overlayObjects.test.js`
Expected: FAIL — `Cannot find module '../public/overlay/objects/index.js'`

- [ ] **Step 3: Create the registry with the dual export**

```js
// public/overlay/objects/index.js
'use strict';

/**
 * Alert object registry — the single source of truth for the five Twitch
 * alert objects. Consumed by BOTH render paths:
 *   1. public/overlay/overlay.js        (the real OBS overlay)
 *   2. src/views/overlay-builder.ejs    (the builder's live preview)
 *
 * Dual-exported: a browser global for <script src>, CommonJS for node:test.
 * Do not add a build step; this file is served verbatim by express.static.
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

var OBJECTS = {
  follow: {
    key: 'follow',
    anim: { in: 'cutWipe', dur: '0.40s', ease: 'cubic-bezier(.25,0,.15,1)' },
    exit: { out: 'exSheathe', dur: '0.34s', ease: 'cubic-bezier(.5,0,.9,.3)' },
    render: function (d) { return ''; },
  },
  subscription: {
    key: 'subscription',
    anim: { in: 'hold', dur: '1.26s', ease: 'linear' },
    exit: { out: 'exGateFall', dur: '0.40s', ease: 'cubic-bezier(.5,0,.9,.4)' },
    render: function (d) { return ''; },
  },
  bits: {
    key: 'bits',
    anim: { in: 'oBitsIn', dur: '0.20s', ease: 'cubic-bezier(.2,1,.2,1)' },
    exit: { out: 'exBoardTip', dur: '0.34s', ease: 'ease-in' },
    render: function (d) { return ''; },
  },
  donation: {
    key: 'donation',
    anim: { in: 'hold', dur: '1.12s', ease: 'linear' },
    exit: { out: 'exScreenFold', dur: '0.36s', ease: 'cubic-bezier(.5,0,.9,.4)' },
    render: function (d) { return ''; },
  },
  raid: {
    key: 'raid',
    anim: { in: 'hold', dur: '0.94s', ease: 'linear' },
    exit: { out: 'exStrike', dur: '0.36s', ease: 'cubic-bezier(.5,0,.9,.4)' },
    render: function (d) { return ''; },
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = OBJECTS;
if (typeof window !== 'undefined') window.ATLETA_OBJECTS = OBJECTS;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/overlayObjects.test.js`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add public/overlay/objects/index.js tests/overlayObjects.test.js
git commit -m "feat(overlay): alert object registry skeleton with dual export"
```

---

### Task 2: objects.css and the keyframe integrity test

This is the test that catches the bug class hit twice while prototyping: playback rules referencing keyframes that a rewrite deleted, and a generic class colliding with the host page.

**Files:**
- Create: `public/overlay/objects/objects.css`
- Modify: `tests/overlayObjects.test.js`

**Interfaces:**
- Consumes: `anim.in` / `exit.out` names from Task 1.
- Produces: `.alert-pos` (positioning wrapper), `.o-blade` (shared cut flash), and every `@keyframes` the registry names.

- [ ] **Step 1: Write the failing test**

Append to `tests/overlayObjects.test.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

describe('objects.css integrity', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'overlay', 'objects', 'objects.css'), 'utf8');
  const defined = new Set([...css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map(m => m[1]));

  test('every keyframe named by the registry exists in objects.css', () => {
    const missing = [];
    for (const k of KEYS) {
      if (!defined.has(OBJECTS[k].anim.in)) missing.push(`${k}.anim.in=${OBJECTS[k].anim.in}`);
      if (!defined.has(OBJECTS[k].exit.out)) missing.push(`${k}.exit.out=${OBJECTS[k].exit.out}`);
    }
    assert.deepEqual(missing, [], 'keyframes referenced but not defined');
  });

  test('defines the shared positioning wrapper and blade', () => {
    assert.match(css, /\.alert-pos\s*\{/, '.alert-pos must exist — centering lives here, not in keyframes');
    assert.match(css, /\.o-blade\s*\{/, '.o-blade must exist — shared cut flash');
  });

  test('no object-internal class escapes its .o- prefix', () => {
    // Guards the collision that pinned the byobu frame rail to the wrong edge.
    const generic = ['.rail{', '.rail {', '.panel{', '.panel {', '.seal{', '.seal {'];
    for (const g of generic) {
      assert.ok(!css.includes(g), `bare generic selector "${g.trim()}" will collide on the builder page`);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/overlayObjects.test.js`
Expected: FAIL — `ENOENT ... objects.css`

- [ ] **Step 3: Create objects.css**

Port the styles from the approved prototype. Source blocks, all in
`docs/superpowers/specs/assets/2026-10-09-alert-objects-prototype.html`:

| Block | Prototype lines |
|---|---|
| Shared discipline (`.pos`, `.obj`, `.o-name`, `.o-meta`) | 103–107 |
| The cut (`.blade`, `bladeRun`, `cutWipe`, `hardIn`, `struck`, `hold`) | 109–122 |
| 01 follow | 124–140 |
| 02 subscription | 141–186 |
| 03 bits | 187–213 |
| 04 donation | 214–232 |
| 05 raid | 233–270 |
| Playback rules | 271–316 |
| Exits | 317–325 |

Apply these **three mandatory transformations** while porting:

1. `.pos` becomes `.alert-pos` and drops `position:absolute; left:50%; top:30px` — in the real
   overlay the existing `#notification-container` positions it. Keep only
   `transform: translateX(-50%)` plus `width: min(420px, 88%)`.
2. Rename every generic class to its object prefix:
   `.blade` → `.o-blade`, `.panel` → `.o-don-panel`, `.brail` → `.o-don-rail`,
   `.mesh` → `.o-mesh`, `.ban` → `.o-raid-ban`, `.tile` → `.o-bits-tile`,
   `.cells` → `.o-bits-cells`, `.gaku` → `.o-sub-gaku`, `.pillar` → `.o-sub-pillar`,
   `.kasagi` → `.o-sub-kasagi`, `.nuki` → `.o-sub-nuki`, `.cords` → `.o-sub-cords`,
   `.base` → `.o-sub-base`, `.dust` → `.o-sub-dust`, `.mark` → `.o-sub-mark`,
   `.hatch` → `.o-follow-hatch`, `.scar` → `.o-follow-scar`, `.glyph` → `.o-follow-glyph`,
   `.txt` → `.o-follow-txt`, `.rank` → `.o-raid-rank`, `.cnt` → `.o-raid-cnt`,
   `.clbl` → `.o-raid-clbl`, `.plaque` → `.o-raid-plaque`, `.screen` → `.o-don-screen`,
   `.face` → `.o-don-face`, `.r-head` → `.o-don-head`, `.r-amt` → `.o-don-amt`,
   `.r-from` → `.o-don-from`, `.who` → `.o-bits-who`, `.unit` → `.o-bits-unit`,
   `.br` → `.o-bits-br`.
3. Keep every `@keyframes` name the registry uses verbatim: `cutWipe`, `hold`, `oBitsIn`,
   `exSheathe`, `exGateFall`, `exBoardTip`, `exScreenFold`, `exStrike`.

Add at the top of the file:

```css
/* Alert objects — the five Twitch events. Source of truth for their styles.
   Consumed by public/overlay/overlay.js AND src/views/overlay-builder.ejs.
   Every object-internal class MUST be namespaced under its .o-* prefix: a bare
   .rail here collided with the builder page's sticky control bar. */
:root{
  --r-red:#D81E26;
  --r-red-deep:#B50000;
  --r-ink:#070B10;
  --o-disp:"Oxanium",system-ui,-apple-system,sans-serif;
  --o-cond:"Saira Condensed","Arial Narrow",sans-serif;
  --o-hex:url("data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='48' viewBox='0 0 28 48'%3E%3Cpath d='M14 0l14 8v16l-14 8L0 24V8z' fill='none' stroke='%23ffffff' stroke-opacity='.07'/%3E%3C/svg%3E");
  --spd:1;
}
.alert-pos{transform:translateX(-50%);width:min(420px,88%)}
.obj{position:relative;will-change:transform,opacity,clip-path}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/overlayObjects.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add public/overlay/objects/objects.css tests/overlayObjects.test.js
git commit -m "feat(overlay): objects.css with keyframe integrity and namespacing tests"
```

---

### Task 3: follow — iaido band

**Files:**
- Modify: `public/overlay/objects/index.js`
- Modify: `tests/overlayObjects.test.js`

**Interfaces:**
- Consumes: `esc()` from Task 1; `.o-follow` + `cutWipe` from Task 2.
- Produces: `OBJECTS.follow.render({ username })` → HTML string.

- [ ] **Step 1: Write the failing test**

```js
describe('follow — iaido band', () => {
  test('renders the username and escapes HTML', () => {
    const html = OBJECTS.follow.render({ username: '<img src=x>Ap&x' });
    assert.ok(html.includes('&lt;img src=x&gt;Ap&amp;x'), 'must escape user input');
    assert.ok(!html.includes('<img src=x>'), 'must not emit raw user HTML');
  });

  test('includes the blade and scar elements the animation drives', () => {
    const html = OBJECTS.follow.render({ username: 'ApexAndre' });
    assert.match(html, /class="o-blade"/);
    assert.match(html, /class="o-follow-scar"/);
    assert.match(html, /class="obj o-follow"/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/overlayObjects.test.js`
Expected: FAIL — render returns `''`, so the `includes` assertion fails.

- [ ] **Step 3: Implement render**

Replace `follow.render` in `public/overlay/objects/index.js`:

```js
    render: function (d) {
      return '<div class="obj o-follow">'
        + '<div class="o-follow-hatch"></div><div class="o-mesh"></div>'
        + '<div class="o-follow-glyph">✦</div>'
        + '<div class="o-follow-txt">'
        +   '<div class="o-name">' + esc(d.username) + '</div>'
        +   '<div class="o-meta">started following</div>'
        + '</div>'
        + '<div class="o-follow-scar"></div><div class="o-blade"></div>'
        + '</div>';
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/overlayObjects.test.js`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add public/overlay/objects/index.js tests/overlayObjects.test.js
git commit -m "feat(overlay): follow renders as the iaido band"
```

---

### Task 4: subscription — torii gate

**Files:**
- Modify: `public/overlay/objects/index.js`
- Modify: `tests/overlayObjects.test.js`

**Interfaces:**
- Consumes: `esc()`; `.o-sub` + `hold` + `exGateFall` from Task 2.
- Produces: `OBJECTS.subscription.render({ username, tier, months })`.

- [ ] **Step 1: Write the failing test**

```js
describe('subscription — torii gate', () => {
  test('puts the text inside the gaku plaque, not loose on the gate', () => {
    const html = OBJECTS.subscription.render({ username: 'RacerDan', tier: '1', months: 4 });
    const gakuAt = html.indexOf('o-sub-gaku');
    const nameAt = html.indexOf('RacerDan');
    assert.ok(gakuAt > -1, 'gaku plaque must exist — it is the legibility fix');
    assert.ok(nameAt > gakuAt, 'username must render inside the gaku');
  });

  test('renders tier and months when supplied', () => {
    const html = OBJECTS.subscription.render({ username: 'RacerDan', tier: '1', months: 4 });
    assert.match(html, /Tier 1/);
    assert.match(html, /4 months/);
  });

  test('omits the months clause when months is absent', () => {
    const html = OBJECTS.subscription.render({ username: 'RacerDan', tier: '1' });
    assert.ok(!html.includes('months'), 'no months data means no months text');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/overlayObjects.test.js`
Expected: FAIL — `gaku plaque must exist — it is the legibility fix`

- [ ] **Step 3: Implement render**

```js
    render: function (d) {
      var meta = 'Tier ' + esc(d.tier || '1');
      if (d.months) meta += ' · ' + esc(d.months) + ' months';
      return '<div class="obj o-sub">'
        + '<div class="o-sub-pillar l"></div><div class="o-sub-pillar r"></div>'
        + '<div class="o-sub-base l"></div><div class="o-sub-base r"></div>'
        + '<div class="o-sub-dust"></div>'
        + '<div class="o-sub-kasagi"></div><div class="o-sub-nuki"></div>'
        + '<div class="o-sub-cords"></div>'
        + '<div class="o-sub-gaku"><div class="o-mesh"></div>'
        +   '<div class="o-sub-mark">Subscriber</div>'
        +   '<div class="o-name">' + esc(d.username) + '</div>'
        +   '<div class="o-meta">' + meta + '</div>'
        + '</div></div>';
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/overlayObjects.test.js`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add public/overlay/objects/index.js tests/overlayObjects.test.js
git commit -m "feat(overlay): subscription renders as the torii gate with gaku plaque"
```

---

### Task 5: bits — tally board

**Files:**
- Modify: `public/overlay/objects/index.js`
- Modify: `tests/overlayObjects.test.js`

**Interfaces:**
- Consumes: `esc()`; `.o-bits` + `oBitsIn` + `tileFlip` from Task 2.
- Produces: `OBJECTS.bits.render({ username, bits })`; one `.o-bits-tile` per digit, each carrying a `--rdelay` staggered 0.12s apart so tiles flip as the blade passes.

- [ ] **Step 1: Write the failing test**

```js
describe('bits — tally board', () => {
  test('emits one tile per digit, in order', () => {
    const html = OBJECTS.bits.render({ username: 'TurboTina', bits: 500 });
    const tiles = [...html.matchAll(/class="o-bits-tile"[^>]*>(\d)</g)].map(m => m[1]);
    assert.deepEqual(tiles, ['5', '0', '0']);
  });

  test('staggers each tile so they flip left to right', () => {
    const html = OBJECTS.bits.render({ username: 'TurboTina', bits: 500 });
    const delays = [...html.matchAll(/--rdelay:calc\(([\d.]+)s/g)].map(m => parseFloat(m[1]));
    assert.equal(delays.length, 3);
    assert.ok(delays[1] > delays[0] && delays[2] > delays[1], 'delays must increase left to right');
  });

  test('handles a single-digit amount', () => {
    const html = OBJECTS.bits.render({ username: 'T', bits: 1 });
    const tiles = [...html.matchAll(/class="o-bits-tile"[^>]*>(\d)</g)].map(m => m[1]);
    assert.deepEqual(tiles, ['1']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/overlayObjects.test.js`
Expected: FAIL — `AssertionError: [] deepEqual [ '5', '0', '0' ]`

- [ ] **Step 3: Implement render**

```js
    render: function (d) {
      var digits = String(Math.max(0, parseInt(d.bits, 10) || 0));
      var tiles = '';
      for (var i = 0; i < digits.length; i++) {
        tiles += '<span class="o-bits-tile" style="--rdelay:calc('
              + (0.20 + i * 0.12).toFixed(2) + 's / var(--spd))">' + digits.charAt(i) + '</span>';
      }
      return '<div class="obj o-bits">'
        + '<div class="o-bits-br tl"></div><div class="o-bits-br tr"></div>'
        + '<div class="o-bits-br bl"></div><div class="o-bits-br rb"></div>'
        + '<div class="o-bits-cells">' + tiles + '</div>'
        + '<div class="o-bits-who o-name">' + esc(d.username) + '</div>'
        + '<div class="o-bits-unit o-meta">bits</div>'
        + '<div class="o-blade"></div>'
        + '</div>';
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/overlayObjects.test.js`
Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

```bash
git add public/overlay/objects/index.js tests/overlayObjects.test.js
git commit -m "feat(overlay): bits renders as the tally board with per-digit tile flip"
```

---

### Task 6: donation — byōbu screen

**Files:**
- Modify: `public/overlay/objects/index.js`
- Modify: `tests/overlayObjects.test.js`

**Interfaces:**
- Consumes: `esc()`; `.o-don` + `hold` + `panelUnfold` + `exScreenFold` from Task 2.
- Produces: `OBJECTS.donation.render({ username, amount, currency })`; exactly 6 `.o-don-panel` elements, each with an increasing `--rdelay`. Adds module-level `money(amount, currency)`.

- [ ] **Step 1: Write the failing test**

```js
describe('donation — byobu screen', () => {
  test('unfolds exactly six panels with increasing delay', () => {
    const html = OBJECTS.donation.render({ username: 'PitBoss92', amount: '25.00', currency: 'EUR' });
    const panels = [...html.matchAll(/class="o-don-panel"/g)];
    assert.equal(panels.length, 6, 'six panels — the most built-up object in the set');
    const delays = [...html.matchAll(/--rdelay:calc\(([\d.]+)s/g)].map(m => parseFloat(m[1]));
    assert.equal(delays.length, 6);
    for (let i = 1; i < delays.length; i++) {
      assert.ok(delays[i] > delays[i - 1], `panel ${i} must unfold after panel ${i - 1}`);
    }
  });

  test('formats the amount with its currency symbol', () => {
    const eur = OBJECTS.donation.render({ username: 'A', amount: '25.00', currency: 'EUR' });
    assert.ok(eur.includes('€25.00'), 'EUR renders as the euro sign');
    const usd = OBJECTS.donation.render({ username: 'A', amount: '10.00', currency: 'USD' });
    assert.ok(usd.includes('$10.00'), 'USD renders as a dollar sign');
  });

  test('falls back to the raw currency code when unknown', () => {
    const html = OBJECTS.donation.render({ username: 'A', amount: '5.00', currency: 'SEK' });
    assert.ok(html.includes('SEK5.00'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/overlayObjects.test.js`
Expected: FAIL — `six panels — the most built-up object in the set`

- [ ] **Step 3: Implement render**

Add this helper above `var OBJECTS`:

```js
var CURRENCY = { EUR: '€', USD: '$', GBP: '£', BRL: 'R$', JPY: '¥' };
function money(amount, currency) {
  var sym = CURRENCY[String(currency || '').toUpperCase()] || String(currency || '');
  return sym + String(amount == null ? '' : amount);
}
```

Then replace `donation.render`:

```js
    render: function (d) {
      var panels = '';
      for (var i = 0; i < 6; i++) {
        panels += '<div class="o-don-panel" style="--rdelay:calc('
               + (0.06 * (i + 1)).toFixed(2) + 's / var(--spd))"><div class="o-mesh"></div></div>';
      }
      return '<div class="obj o-don">'
        + '<div class="o-don-screen">' + panels + '</div>'
        + '<div class="o-don-rail t"></div><div class="o-don-rail b"></div>'
        + '<div class="o-don-face">'
        +   '<div class="o-don-head">Tribute</div>'
        +   '<div class="o-don-amt">' + esc(money(d.amount, d.currency)) + '</div>'
        +   '<div class="o-don-from">' + esc(d.username) + '</div>'
        + '</div></div>';
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/overlayObjects.test.js`
Expected: PASS — 16 tests.

- [ ] **Step 5: Commit**

```bash
git add public/overlay/objects/index.js tests/overlayObjects.test.js
git commit -m "feat(overlay): donation renders as the byobu folding screen"
```

---

### Task 7: raid — sashimono rank

**Files:**
- Modify: `public/overlay/objects/index.js`
- Modify: `tests/overlayObjects.test.js`

**Interfaces:**
- Consumes: `esc()`; `.o-raid` + `hold` + `banPlant` + `exStrike` from Task 2.
- Produces: `OBJECTS.raid.render({ username, viewers })`; five banners, the centre one (`.o-raid-ban main`) carrying the count and landing last.

- [ ] **Step 1: Write the failing test**

```js
describe('raid — sashimono rank', () => {
  test('plants five banners with the standard landing last', () => {
    const html = OBJECTS.raid.render({ username: 'GridWalker', viewers: 42 });
    const bans = [...html.matchAll(/class="o-raid-ban[^"]*"[^>]*--rdelay:calc\(([\d.]+)s/g)]
      .map(m => parseFloat(m[1]));
    assert.equal(bans.length, 5, 'five banners — a unit arriving');
    const mainDelay = parseFloat(
      html.match(/class="o-raid-ban main"[^>]*--rdelay:calc\(([\d.]+)s/)[1]);
    assert.equal(mainDelay, Math.max(...bans), 'the standard must land last');
  });

  test('shows the raider count and name', () => {
    const html = OBJECTS.raid.render({ username: 'GridWalker', viewers: 42 });
    assert.match(html, />42</);
    assert.ok(html.includes('GridWalker'));
  });

  test('defaults the count to 0 when viewers is missing', () => {
    const html = OBJECTS.raid.render({ username: 'GridWalker' });
    assert.match(html, />0</);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/overlayObjects.test.js`
Expected: FAIL — `five banners — a unit arriving`

- [ ] **Step 3: Implement render**

```js
    render: function (d) {
      var count = Math.max(0, parseInt(d.viewers, 10) || 0);
      // Delays plant the rank outside-in; the standard (main) lands last.
      var rankDef = [
        { cls: 'o-raid-ban s',    delay: 0.00 },
        { cls: 'o-raid-ban m',    delay: 0.10 },
        { cls: 'o-raid-ban main', delay: 0.26 },
        { cls: 'o-raid-ban m',    delay: 0.16 },
        { cls: 'o-raid-ban s',    delay: 0.05 },
      ];
      var rank = '';
      for (var i = 0; i < rankDef.length; i++) {
        var b = rankDef[i];
        var inner = b.cls.indexOf('main') > -1
          ? '<div class="o-mesh"></div><div class="o-raid-cnt">' + count + '</div>'
            + '<div class="o-raid-clbl">raiders</div>'
          : '';
        rank += '<div class="' + b.cls + '" style="--rdelay:calc('
             + b.delay.toFixed(2) + 's / var(--spd))">' + inner + '</div>';
      }
      return '<div class="obj o-raid">'
        + '<div class="o-raid-rank">' + rank + '</div>'
        + '<div class="o-raid-plaque">'
        +   '<div class="o-name">' + esc(d.username) + '</div>'
        +   '<div class="o-meta">brought the grid</div>'
        + '</div></div>';
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/overlayObjects.test.js`
Expected: PASS — 19 tests.

- [ ] **Step 5: Commit**

```bash
git add public/overlay/objects/index.js tests/overlayObjects.test.js
git commit -m "feat(overlay): raid renders as the sashimono banner rank"
```

---

### Task 8: Wire the OBS overlay

**Files:**
- Modify: `public/overlay/overlay.js:393-398`, `:444`, `:920-922`
- Modify: `src/routes/overlay.js:322-338`

**Interfaces:**
- Consumes: `window.ATLETA_OBJECTS` from Tasks 1–7.
- Produces: the live overlay rendering objects for the five keys; legacy cards untouched for the rest.

- [ ] **Step 1: Add the registry and fonts to the overlay page**

In `src/routes/overlay.js`, inside the `<head>` of the template at line 322, after the existing
`overlay.css` link:

```html
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oxanium:wght@400;600;700;800&family=Saira+Condensed:wght@400;500;600;700&display=swap">
  <link rel="stylesheet" href="/overlay/objects/objects.css">
```

And immediately **before** the existing `<script src="/overlay/overlay.js"></script>`:

```html
  <script src="/overlay/objects/index.js"></script>
```

Order matters — `overlay.js` reads `window.ATLETA_OBJECTS` at render time.

- [ ] **Step 2: Delegate in buildBannerContent**

In `public/overlay/overlay.js`, insert at the very top of `buildBannerContent(event)` (line 444),
before `const icon = getSideIcon(event.type);`:

```js
  // The five Twitch events render from the shared object registry.
  // Everything else keeps the legacy top-accent + card-body + car-track card.
  const objects = window.ATLETA_OBJECTS;
  if (objects && objects[event.type]) {
    return objects[event.type].render(event.data || {});
  }
```

- [ ] **Step 3: Drive the animation from the registry and skip custom design**

Replace `public/overlay/overlay.js:393-398` (the "Build card" block through
`spawnEffects(event.type);`) with:

```js
  // Build card
  const objectDef = window.ATLETA_OBJECTS && window.ATLETA_OBJECTS[event.type];
  const cardClass = getCardClass(event.type);
  const isSubLike = event.type === 'subscription' || event.type === 'yt_member';
  const card = document.createElement('div');

  if (objectDef) {
    // Objects position via .alert-pos and animate their own transform, so the
    // legacy .alert-card/.entering classes (whose keyframes bake in
    // translateX(-50%)) must not apply.
    card.className = 'alert-pos';
    card.innerHTML = buildBannerContent(event);
    card.style.setProperty('--in', objectDef.anim.in);
    card.style.setProperty('--dur', objectDef.anim.dur);
    card.style.setProperty('--ease', objectDef.anim.ease);
    card.classList.add('playing');
  } else {
    card.className = `alert-card ${cardClass}${isSubLike ? ' sub-shake' : ''} entering`;
    card.innerHTML = buildBannerContent(event);
  }
  container.appendChild(card);

  // Apply custom overlay design — phase 1 skips the object types entirely
  if (!objectDef) applyCustomDesign(card, event.type);

  // Spawn full-screen effects — objects carry their own motion
  if (!objectDef) spawnEffects(event.type);
```

- [ ] **Step 4: Guard applyCustomDesign at its own entry point**

Belt-and-braces, in case another caller appears. Replace `public/overlay/overlay.js:921-922`:

```js
  const design = overlayDesigns[eventType];
  if (!design) return;
  // Phase 1: the five object event types ignore saved styles entirely.
  if (window.ATLETA_OBJECTS && window.ATLETA_OBJECTS[eventType]) return;
```

- [ ] **Step 5: Verify syntax and run the unit suite**

```bash
node --check public/overlay/overlay.js
node --check public/overlay/objects/index.js
node --test tests/overlayObjects.test.js
```

Expected: no syntax errors; 19 tests pass.

- [ ] **Step 6: Commit**

```bash
git add public/overlay/overlay.js src/routes/overlay.js
git commit -m "feat(overlay): render the five Twitch events from the object registry"
```

---

### Task 9: Migration — design_version and the backup table

Production holds 8 rows across the five types, exactly one genuinely customised. The backup costs 14 rows and removes the only irreversible risk.

**Files:**
- Modify: `src/db.js` (append after the migration block ending at line 2970)

**Interfaces:**
- Consumes: the existing `overlay_designs` table.
- Produces: `overlay_designs.design_version` (INTEGER, default 0) and table `overlay_designs_v0_backup`.

- [ ] **Step 1: Write the migration**

Append after the `effect_direction` migration in `src/db.js`:

```js
// Migration: version overlay designs and snapshot v0 before the object rollout.
// Phase 1 objects ignore saved style columns, so nothing is overwritten here —
// the backup exists so a streamer's pre-object design can be restored on request.
try {
  const cols = db.pragma('table_info(overlay_designs)').map(c => c.name);
  if (!cols.includes('design_version')) {
    db.exec(`ALTER TABLE overlay_designs ADD COLUMN design_version INTEGER DEFAULT 0`);
    console.log('[DB] Added design_version to overlay_designs');
  }
} catch {}

try {
  const existing = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='overlay_designs_v0_backup'"
  ).get();
  if (!existing) {
    db.exec(`CREATE TABLE overlay_designs_v0_backup AS SELECT * FROM overlay_designs`);
    const n = db.prepare('SELECT COUNT(*) c FROM overlay_designs_v0_backup').get().c;
    console.log(`[DB] Snapshotted ${n} overlay_designs rows to overlay_designs_v0_backup`);
  }
} catch {}

try {
  const info = db.prepare(`
    UPDATE overlay_designs SET design_version = 1
    WHERE design_version = 0
      AND event_type IN ('follow','subscription','bits','donation','raid')`).run();
  if (info.changes > 0) console.log(`[DB] Marked ${info.changes} overlay_designs rows as design_version=1`);
} catch {}
```

- [ ] **Step 2: Verify it runs and is idempotent**

First read how `src/db.js` resolves its database path (grep for `new Database(`), then point a
throwaway database at it using whichever env var it honours. Do **not** run this against
`data/bot.db`. With `DATABASE_PATH` as the example:

```bash
node --check src/db.js
rm -f /tmp/mig-test.db
DATABASE_PATH=/tmp/mig-test.db node -e "require('./src/db.js'); console.log('--- first boot ok ---')"
DATABASE_PATH=/tmp/mig-test.db node -e "require('./src/db.js'); console.log('--- second boot ok (idempotent) ---')"
```

Expected: both boots exit 0. The column and snapshot log lines appear on the first boot only.

- [ ] **Step 3: Assert the schema landed**

```bash
node -e "
const db=require('better-sqlite3')('/tmp/mig-test.db',{readonly:true});
const cols=db.pragma('table_info(overlay_designs)').map(c=>c.name);
if(!cols.includes('design_version')) throw new Error('design_version missing');
const t=db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='overlay_designs_v0_backup'\").get();
if(!t) throw new Error('backup table missing');
console.log('schema OK: design_version present, backup table present');
"
```

Expected: `schema OK: design_version present, backup table present`

- [ ] **Step 4: Commit**

```bash
git add src/db.js
git commit -m "feat(db): version overlay designs and snapshot v0 before object rollout"
```

---

### Task 10: Builder preview renders from the registry

The builder's preview is static DOM mutated by `updatePreview()`. For the five object types that DOM is bypassed and the registry's output used instead.

**Files:**
- Modify: `src/views/overlay-builder.ejs` — head, preview DOM (after 1109), `updatePreview()` (1363)

**Interfaces:**
- Consumes: `window.ATLETA_OBJECTS`.
- Produces: `PREVIEW_DATA` map; a preview visually identical to the OBS overlay for the five types.

- [ ] **Step 1: Load the registry and its CSS in the builder**

In the `<head>` of `src/views/overlay-builder.ejs`, alongside the existing stylesheet links:

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oxanium:wght@400;600;700;800&family=Saira+Condensed:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/overlay/objects/objects.css">
<script src="/overlay/objects/index.js"></script>
```

- [ ] **Step 2: Add an object preview host beside the legacy card**

Immediately after the closing `</div>` of `#preview-card` (the block opening at line 1109), add a
sibling inside `#preview-card-container`:

```html
          <div class="alert-pos" id="preview-object-host" style="display:none;"></div>
```

- [ ] **Step 3: Add the preview sample data**

Immediately above `function updatePreview()` (line 1363):

```js
// Sample payloads for the object preview — shapes match the real event.data
const PREVIEW_DATA = {
  follow:       { username: 'ApexAndre' },
  subscription: { username: 'RacerDan', tier: '1', months: 4 },
  bits:         { username: 'TurboTina', bits: 500 },
  donation:     { username: 'PitBoss92', amount: '25.00', currency: 'EUR' },
  raid:         { username: 'GridWalker', viewers: 42 },
};
```

- [ ] **Step 4: Branch updatePreview for the object types**

Insert at the top of `function updatePreview()`, before
`const card = document.getElementById('preview-card');`:

```js
  const objDef = window.ATLETA_OBJECTS && window.ATLETA_OBJECTS[currentType];
  const objHost = document.getElementById('preview-object-host');
  const legacyCard = document.getElementById('preview-card');
  if (objDef) {
    legacyCard.style.display = 'none';
    objHost.style.display = '';
    objHost.innerHTML = objDef.render(PREVIEW_DATA[currentType] || {});
    objHost.style.setProperty('--in', objDef.anim.in);
    objHost.style.setProperty('--dur', objDef.anim.dur);
    objHost.style.setProperty('--ease', objDef.anim.ease);
    objHost.classList.remove('playing');
    void objHost.offsetWidth;   // force reflow so the animation restarts
    objHost.classList.add('playing');
    return;
  }
  legacyCard.style.display = '';
  objHost.style.display = 'none';
```

`currentType` is the builder's selected-event variable, declared at `overlay-builder.ejs:1194`.

- [ ] **Step 5: Verify the template still compiles**

```bash
node -e "
const ejs=require('ejs'),fs=require('fs');
const f='src/views/overlay-builder.ejs';
ejs.compile(fs.readFileSync(f,'utf8'),{filename:f});
console.log('EJS compiles OK');
"
```

Expected: `EJS compiles OK`

- [ ] **Step 6: Leave the builder's legacy keyframes alone**

The spec's architecture section says to remove the builder's duplicated `@keyframes`. Do **not** do
that in this plan. `yt_superchat`, `yt_member`, `yt_giftmember` and `giveaway_winner` still render
through the legacy card in the builder preview, and those keyframes (`anim-slideDown`,
`previewCarZoom`, `checkerScroll`, …) are what animate them. They can only be removed once those
four event types are ported, which is a follow-up plan.

- [ ] **Step 7: Commit**

```bash
git add src/views/overlay-builder.ejs
git commit -m "feat(builder): preview the five Twitch events from the object registry"
```

---

### Task 11: Hide phase-1 controls in the builder

Phase 1 objects ignore saved styles, so leaving the colour and animation pickers live would let a streamer change settings that do nothing.

**Files:**
- Modify: `src/views/overlay-builder.ejs` (section wrappers around the controls at 1020-1026)

**Interfaces:**
- Consumes: `window.ATLETA_OBJECTS`, `currentType` (`overlay-builder.ejs:1194`).
- Produces: `syncPhase1Controls()`, called as the first statement of `updatePreview()`.

- [ ] **Step 1: Add the notice element**

Immediately before the `<select id="ctrl-entrance-animation">` block (line 1020), insert:

```html
<div id="phase1-notice" style="display:none; padding:12px 14px; margin-bottom:12px;
     border-left:3px solid #D81E26; background:rgba(216,30,38,0.08);
     font-size:13px; line-height:1.5;">
  This alert now uses a fixed design with its own built-in animation.
  Colour and animation controls will return in a future update.
</div>
```

- [ ] **Step 2: Add the sync function**

Immediately above `function updatePreview()`:

```js
// Phase 1: the five object event types ignore saved styles, so their controls
// are hidden rather than left live and inert.
function syncPhase1Controls() {
  const isObject = !!(window.ATLETA_OBJECTS && window.ATLETA_OBJECTS[currentType]);
  const notice = document.getElementById('phase1-notice');
  if (notice) notice.style.display = isObject ? '' : 'none';
  ['section-theme', 'section-text', 'section-sideicon',
   'section-animation', 'section-size'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isObject ? 'none' : '';
  });
}
```

These five ids are verified `<div class="section" id="...">` wrappers in `overlay-builder.ejs`:
`section-theme` (917), `section-text` (941), `section-sideicon` (973), `section-animation` (999),
`section-size` (1032). There is no `section-colors` — colour lives in `section-theme`. All five
are hidden because phase 1 skips `applyCustomDesign()` entirely, so every control in them is inert
for these event types, position and size included.

- [ ] **Step 3: Call it from updatePreview**

Add `syncPhase1Controls();` as the first statement of `updatePreview()`, before the `objDef` branch
added in Task 10.

- [ ] **Step 4: Verify the template compiles**

```bash
node -e "
const ejs=require('ejs'),fs=require('fs');
const f='src/views/overlay-builder.ejs';
ejs.compile(fs.readFileSync(f,'utf8'),{filename:f});
console.log('EJS compiles OK');
"
```

Expected: `EJS compiles OK`

- [ ] **Step 5: Commit**

```bash
git add src/views/overlay-builder.ejs
git commit -m "feat(builder): hide colour and animation controls for phase-1 object alerts"
```

---

### Task 12: Update CLAUDE.md and add the E2E smoke test

**Files:**
- Modify: `CLAUDE.md` (Overlay Consistency Rule)
- Create: `tests/alertObjects.spec.js`

- [ ] **Step 1: Replace the Overlay Consistency Rule**

In `CLAUDE.md`, replace the bullet beginning
`- **Card structure:** All event types must use the same HTML structure` with:

```markdown
- **Object registry:** The five Twitch event types (`follow`, `subscription`, `bits`, `donation`,
  `raid`) render from `public/overlay/objects/`. Any change to an object's markup, keyframes or
  timing is made there and nowhere else — both render paths (the OBS overlay `overlay.js` and the
  builder preview `overlay-builder.ejs`) consume the same module. `overlay-config.ejs` previews via
  an iframe of the real overlay and needs no parallel change. Every object-internal CSS class MUST
  be namespaced under its `.o-*` prefix; a bare `.rail` once collided with the builder page's sticky
  control bar. Remaining event types still share the legacy `top-accent` + `card-body` + `car-track`
  structure.
```

- [ ] **Step 2: Write the E2E smoke test**

```js
// tests/alertObjects.spec.js
const { test, expect } = require('@playwright/test');

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const TOKEN = process.env.E2E_OVERLAY_TOKEN;

test.describe('alert objects on the real overlay', () => {
  test.skip(!TOKEN, 'set E2E_OVERLAY_TOKEN to run');

  test('registry loads and exposes the five objects', async ({ page }) => {
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${BASE}/overlay/${TOKEN}`);
    const keys = await page.evaluate(() => Object.keys(window.ATLETA_OBJECTS || {}));
    expect(keys.sort()).toEqual(['bits', 'donation', 'follow', 'raid', 'subscription']);
    expect(errors).toEqual([]);
  });

  test('every object renders without throwing', async ({ page }) => {
    await page.goto(`${BASE}/overlay/${TOKEN}`);
    const result = await page.evaluate(() => {
      const data = {
        follow: { username: 'ApexAndre' },
        subscription: { username: 'RacerDan', tier: '1', months: 4 },
        bits: { username: 'TurboTina', bits: 500 },
        donation: { username: 'PitBoss92', amount: '25.00', currency: 'EUR' },
        raid: { username: 'GridWalker', viewers: 42 },
      };
      const out = {};
      for (const k of Object.keys(window.ATLETA_OBJECTS)) {
        try { out[k] = window.ATLETA_OBJECTS[k].render(data[k]).length; }
        catch (e) { out[k] = 'THREW: ' + e.message; }
      }
      return out;
    });
    for (const [k, v] of Object.entries(result)) {
      expect(typeof v, `${k} must render to a string`).toBe('number');
      expect(v, `${k} must produce markup`).toBeGreaterThan(50);
    }
  });
});
```

- [ ] **Step 3: Run the full suite**

```bash
node --test tests/overlayObjects.test.js
node --check public/overlay/overlay.js
node --check public/overlay/objects/index.js
node --check src/db.js
```

Expected: 19 unit tests pass, no syntax errors.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md tests/alertObjects.spec.js
git commit -m "docs(claude.md): replace card-structure rule with the object registry rule"
```

---

## Deployment checklist

After all tasks pass, before `railway up`:

1. Confirm the five objects render on a real OBS browser source at 1920×1080.
2. Watch the deploy log for all three migration lines:
   - `[DB] Added design_version to overlay_designs`
   - `[DB] Snapshotted 14 overlay_designs rows to overlay_designs_v0_backup`
   - `[DB] Marked 8 overlay_designs rows as design_version=1`
3. Verify the backup table landed in production:

```bash
railway ssh \
  --project 4e52137b-f75a-4c71-8fbe-48c6e1ca445f \
  --environment bcaedd71-e63a-4192-b8ab-777f17ffa26f \
  --service dae3e50b-5b14-4581-bf1f-bd22c645a7be \
  -- node -e "const d=require('/app/node_modules/better-sqlite3')('/app/data/bot.db',{readonly:true});console.log(d.prepare('SELECT COUNT(*) c FROM overlay_designs_v0_backup').get())"
```

4. No user announcement is needed — production holds exactly one genuinely customised design, on an
   account with no Twitch username linked.

## Follow-up plans (not this one)

- **Phase 2 — per-user colour.** Wire each object's palette to CSS custom properties driven by the
  saved `accent_color`, and restore the builder controls hidden in Task 11.
- **Port the remaining event types.** `yt_superchat`, `yt_member`, `yt_giftmember` and
  `giveaway_winner` still use the legacy card.
