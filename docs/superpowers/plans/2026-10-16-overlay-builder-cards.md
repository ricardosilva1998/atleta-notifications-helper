# Overlay Builder: alert cards and an edit window — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Overlay Builder's left-panel layout with a grid of alert cards that loop their look, and an edit window per card with tabs (Animation, Customize, Sound, Location for the six alerts; Images, Design, Location for sponsor images; Design, Location for YouTube alerts).

**Architecture:** The page stays one EJS view (`src/views/overlay-builder.ejs`) rendered by the same route. Today's legacy card editor (Theme, Text, Side icons, Animation, the theme pop-up, the sponsor panel) keeps its markup and functions in the view, moved into the edit window's Images and Design panes, so the tests that pin them keep their meaning. The look parts (today's Style section) are removed from the view and rebuilt in a new page script, `public/js/builder-cards.js`, over pure helpers added to `public/js/builder-styles-core.js` (dual-exported, unit-tested). Saving, testing, resetting and "use for all six" call today's routes unchanged.

**Tech Stack:** Node 24, Express 5, EJS, plain browser JS (no build step), `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-16-overlay-builder-cards-design.md`. The approved prototype (a scratch page, not in the repository) is described there; where this plan and the spec disagree, the spec wins.

## Global Constraints

- Plain CommonJS / browser globals, no ESM, no framework, no build step; EJS cannot `require()`.
- Every text the page shows goes through `t()` in all seven locales (`en pt es fr de zh ja`); the page script gets its texts as one JSON object (`window.BUILDER_TEXTS`); add keys with `node scripts/locale-keys.js add <file.json>` then `set <lang> <file.json>` per language (`docs/features/i18n.md`).
- JSON printed into the view ends in `.replace(/</g, '\\u003c')` (`tests/scriptEmbeds.test.js`); `csrf.ejs` stays in `<head>`.
- The builder preview and OBS must pick and draw an alert the same way: the look is chosen with `previewObjectFor()` (same rule as `objectFor()` in `overlay.js`), drawn with `kit.lookData`/`kit.slotVars`, effects via `kit.effectFor` + `ATLETA_FX.spawn`, placement via `ATLETA_PLACEMENT.slotStyle(placementOf(design))` on a 1920×1080 stage (Overlay Consistency Rule, `CLAUDE.md`).
- No change to `overlay_designs`, `FIELD_SPECS`, `validateOverlayDesign()`, or the routes `POST /dashboard/overlay-builder/save|family|reset`, `POST /dashboard/overlay/test/:eventType`, `/dashboard/sponsors/*`.
- Cards: two per row (`repeat(2, minmax(0, 1fr))`), one per row below 760 px; card preview 16:7, min 210 px tall; the alert drawn at `clamp(280, previewWidth × 0.62, 760)` px.
- Loops run only while on screen (IntersectionObserver); card loops stop while the edit window is open; gallery tiles start staggered.
- Design system: the page's existing tokens (`--bg-surface`, `--accent: #9146ff`, Outfit + DM Sans); dark cards; no admin-panel look.
- Unit suite command: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` must pass at the end of every task.

## Review Focus

1. **A saved sound from another alert or `'today'`** (picked before this release): the Sound tab shows it as a "Current" row and a save keeps it — pinned in Task 1 (`thisLookRows`) and Task 6.
2. **Closing the window with edits** (✕, Esc, outside click): asks before dropping them; Done with a refused save keeps the window open with the route's message — pinned in Task 4.
3. **Free position near an edge / a wide alert**: dragging never puts the slot outside the 1920×1080 stage, and the saved `card_custom_x/y` stay within 0–1 — pinned in Task 1 (`clampFree`) and Task 7.
4. **A look that throws while rendering**: the tile/card shows nothing for that loop and the page keeps working (no uncaught error) — pinned in Task 3 (`Looper`).
5. **`?tab=` deep links**: `?tab=timed` opens Sponsor images, `?tab=donation` opens donation, an unknown or hidden (YouTube while off) tab opens nothing — pinned in Task 1 (`cardForTab`) and Task 4.

---

## File Structure

- `public/js/builder-styles-core.js` — modify: new pure helpers (tabs per card, deep link, sounds by alert, "This look" rows, speed and loop timings, place summary, free-drag clamp). Dual-exported.
- `public/js/builder-cards.js` — create: the page script for the cards, the edit window, the Looper, the Animation/Customize/Sound/Location tabs, and the hand-off to the legacy panes. Dual-exported like the core (browser global `window.ATLETA_BUILDER_CARDS`, `module.exports` for tests).
- `src/views/overlay-builder.ejs` — modify: new header, card grid, edit-window shell with tab panes; legacy panels moved into the Images/Design panes; the Style section markup and its functions removed; new CSS.
- `src/routes/dashboard.js` — modify: `GET /overlay-builder` also passes `uploadedSounds` and `builderTexts`.
- `src/locales/*.json` — modify: new `overlayBuilder.cards.*`, `.window.*`, `.tabs.*`, `.sound.*`, `.custom.*`, `.place.*` keys.
- Tests: `tests/builderStylesCore.test.js`, `tests/builderCards.test.js` (create), `tests/overlayBuilder.test.js`, `src/services/overlayDesign.test.js`, `src/routes/dashboard.test.js`.
- Docs: `CLAUDE.md`, `docs/features/look-sounds.md`, `docs/operations/deploy.md`.

---

### Task 1: Pure helpers for the cards and the edit window

**Files:**
- Modify: `public/js/builder-styles-core.js`
- Test: `tests/builderStylesCore.test.js`

**Interfaces:**
- Produces (all on `module.exports` and `window.ATLETA_BUILDER_STYLES`):
  - `CARD_TYPES = ['follow','subscription','bits','donation','raid','giveaway_winner','timed','yt_superchat','yt_member','yt_giftmember']`
  - `tabsFor(type) -> string[]`: styled alerts `['animation','customize','sound','location']`; `'timed'` `['images','design','location']`; `yt_*` `['design','location']`; anything else `[]`.
  - `cardForTab(tab, shownTypes) -> string|null`: `tab` if it is in `shownTypes`, else null.
  - `soundOwners(styles) -> { [soundKey]: { eventType, look } }` for every registry entry with a `family` and a `sound`.
  - `ownerOfSound(key, owners) -> { eventType, look }|null` (`'<key>.2'` resolves to `<key>`'s owner).
  - `soundGroupsFor(type, groups, owners) -> groups` — `groups` is `STYLE_DATA.sounds` (`[{ family, sounds: [{ key, name }] }]`); keeps only sounds whose owner's `eventType === type`, drops empty groups, keeps order.
  - `thisLookRows(look, styleSound, allGroups, alertGroups) -> [{ key, tag }]`, `tag` ∈ `'current'|'own'|'second'|'today'|'none'`.
  - `speedOf(look, design) -> number`: `design.animation_speed` clamped 0.5–2 when `look.controls.speed`, else 1.
  - `loopTimings(look, speed) -> { inMs, exitMs }`.
  - `placeSummary(design) -> { free, position, cell }` (cell 0–8 in reading order, −1 when free; default position `'top-center'`).
  - `clampFree(x, y, w, h) -> { x, y }`: pixel top-left on the 1920×1080 stage → fractions rounded to 3 decimals, keeping the `w×h` slot inside.

- [ ] **Step 1: Write the failing tests** in `tests/builderStylesCore.test.js`. Load the real registry: `require('../public/overlay/objects/kit.js')`, every `public/overlay/objects/styles/*.js`, then `public/overlay/objects/sounds/manifest.js` (so the `.2` keys exist); `K.styles` is the registry. Build `STYLE_DATA_SOUNDS` as `builderStyleData()` does: the keys of `K.soundFamilies` without `.2`, grouped by family in family order, each followed by `<key>.2` when `K.secondVersionOf(key)` (names may be the keys).

```js
describe('the cards', () => {
  test('each card has its tabs', () => {
    assert.deepEqual(CORE.tabsFor('follow'), ['animation', 'customize', 'sound', 'location']);
    assert.deepEqual(CORE.tabsFor('giveaway_winner'), ['animation', 'customize', 'sound', 'location']);
    assert.deepEqual(CORE.tabsFor('timed'), ['images', 'design', 'location']);
    assert.deepEqual(CORE.tabsFor('yt_member'), ['design', 'location']);
    assert.deepEqual(CORE.tabsFor('nope'), []);
  });
  test('?tab= opens a card that is shown, and nothing else', () => {
    const shown = ['follow', 'donation', 'timed'];
    assert.equal(CORE.cardForTab('timed', shown), 'timed');
    assert.equal(CORE.cardForTab('donation', shown), 'donation');
    assert.equal(CORE.cardForTab('yt_member', shown), null);
    assert.equal(CORE.cardForTab('<x>', shown), null);
    assert.equal(CORE.cardForTab(null, shown), null);
  });
});

describe('sounds by alert', () => {
  const owners = CORE.soundOwners(K.styles);
  test('every look sound belongs to one look, and so to one alert', () => {
    assert.equal(Object.keys(owners).length, 156);
    assert.equal(CORE.ownerOfSound('glFollow', owners).eventType, 'follow');
    assert.equal(CORE.ownerOfSound('glFollow.2', owners).look.key, 'follow-glass');
    assert.equal(CORE.ownerOfSound('today', owners), null);
  });
  test('an alert lists only its own looks\' sounds, by theme, each with its version 2', () => {
    const groups = CORE.soundGroupsFor('follow', STYLE_DATA_SOUNDS, owners);
    assert.equal(groups.length, 26);
    for (const g of groups) for (const s of g.sounds) assert.equal(CORE.ownerOfSound(s.key, owners).eventType, 'follow', s.key);
    assert.deepEqual(groups.find((g) => g.family === 'glass').sounds.map((s) => s.key), ['glFollow', 'glFollow.2']);
  });
});

describe('"This look" rows', () => {
  const look = K.styles['bits-glass'];
  const alertGroups = () => CORE.soundGroupsFor('bits', STYLE_DATA_SOUNDS, CORE.soundOwners(K.styles));
  test('its own sound, its version 2, the classic engine sound, no sound', () => {
    assert.deepEqual(CORE.thisLookRows(look, null, STYLE_DATA_SOUNDS, alertGroups()),
      [{ key: 'glBits', tag: 'own' }, { key: 'glBits.2', tag: 'second' }, { key: 'today', tag: 'today' }, { key: 'none', tag: 'none' }]);
  });
  test('a saved sound of another alert comes first as "current", and is kept', () => {
    assert.deepEqual(CORE.thisLookRows(look, 'glFollow', STYLE_DATA_SOUNDS, alertGroups())[0], { key: 'glFollow', tag: 'current' });
  });
  test('a saved sound the alert lists anyway is not repeated', () => {
    for (const saved of ['glBits.2', 'today', 'none', 'rcNitro']) {
      assert.ok(!CORE.thisLookRows(look, saved, STYLE_DATA_SOUNDS, alertGroups()).some((r) => r.tag === 'current'), saved);
    }
  });
});

describe('loops and places', () => {
  test('speed is the design\'s, clamped, only for looks that take one', () => {
    assert.equal(CORE.speedOf({ controls: { speed: true } }, { animation_speed: 3 }), 2);
    assert.equal(CORE.speedOf({ controls: { speed: true } }, { animation_speed: 0.1 }), 0.5);
    assert.equal(CORE.speedOf({ controls: {} }, { animation_speed: 2 }), 1);
  });
  test('entrance and exit times at the speed; an exit takes at least 400 ms', () => {
    assert.deepEqual(CORE.loopTimings({ anim: { dur: '0.9s' }, exit: { dur: '0.36s' } }, 1), { inMs: 900, exitMs: 400 });
    assert.deepEqual(CORE.loopTimings({ anim: { dur: '1.2s' }, exit: { dur: '0.84s' } }, 0.5), { inMs: 2400, exitMs: 1680 });
    assert.deepEqual(CORE.loopTimings({ anim: { dur: '1s' } }, 1), { inMs: 1000, exitMs: 400 });
  });
  test('where an alert sits', () => {
    assert.deepEqual(CORE.placeSummary({}), { free: false, position: 'top-center', cell: 1 });
    assert.deepEqual(CORE.placeSummary({ card_position: 'bot-right' }), { free: false, position: 'bot-right', cell: 8 });
    assert.deepEqual(CORE.placeSummary({ card_position: 'mid-left', card_custom_x: 0.2, card_custom_y: 0.4 }), { free: true, position: 'mid-left', cell: -1 });
  });
  test('a dragged alert stays on the screen', () => {
    assert.deepEqual(CORE.clampFree(-50, -10, 420, 120), { x: 0, y: 0 });
    assert.deepEqual(CORE.clampFree(1900, 1070, 420, 120), { x: Math.round(1500 / 1920 * 1000) / 1000, y: Math.round(960 / 1080 * 1000) / 1000 });
    assert.deepEqual(CORE.clampFree(960, 540, 420, 120), { x: 0.5, y: 0.5 });
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/builderStylesCore.test.js`
Expected: FAIL — `CORE.tabsFor is not a function` (and the others).

- [ ] **Step 3: Implement the helpers** in `public/js/builder-styles-core.js` with the signatures above. `thisLookRows`: own = `look.sound`; second = `own + '.2'` when any group in `allGroups` lists it; then `today`, `none`; a non-empty `styleSound` that is none of those keys and not in `alertGroups` is prepended with tag `'current'`. `loopTimings`: `inMs = parseFloat(anim.dur) * 1000 / speed`, `exitMs = Math.max(400, parseFloat(exit.dur) * 1000 / speed)` (400 without an exit). `placeSummary`: free when `card_custom_x` and `card_custom_y` are both finite numbers (the rule of `placement.js`). Export the new names next to the old ones.

- [ ] **Step 4: Run the tests and see them pass**

Run: `node --test tests/builderStylesCore.test.js`
Expected: PASS (old and new).

- [ ] **Step 5: Commit**

```bash
git add public/js/builder-styles-core.js tests/builderStylesCore.test.js
git commit -m "feat(builder): pure helpers for the alert cards and the edit window"
```

---

### Task 2: The route's new data and the new texts

**Files:**
- Modify: `src/routes/dashboard.js` (`GET /overlay-builder`, ~line 2728; new `builderTexts(t)` beside `builderStyleData()`)
- Modify: `src/locales/{en,pt,es,fr,de,zh,ja}.json` (via `scripts/locale-keys.js`)
- Test: `src/routes/dashboard.test.js` (describe "the overlay builder page and a slow Twitch")

**Interfaces:**
- Produces template locals:
  - `uploadedSounds`: JSON text of `customSounds.soundStatus(req.streamer).custom` (keys: `customSounds.SOUND_TYPES`), escaped.
  - `builderTexts`: JSON text of `{ '<suffix after overlayBuilder.>': t(key) }` for every key below, escaped (placeholders left for the page to fill).
- New locale keys (English text, exactly):
  - `overlayBuilder.cards.subtitle` "How each alert looks, sounds and where it appears on your stream"; `.edit` "Edit alert"; `.editSponsors` "Edit sponsor images"; `.test` "Test in OBS"; `.default` "default"; `.uploaded` "Your uploaded sound"; `.free` "Free position"; `.sponsors` "Sponsor images"; `.rotationOn` "Rotation on"; `.rotationOff` "Rotation off"; `.images` "{{count}} images"; `.twitch` "Twitch alerts"; `.youtube` "YouTube alerts"; `.other` "On screen between alerts"
  - `overlayBuilder.window.title` "Edit the {{alert}} alert"; `.close` "Close"; `.cancel` "Cancel"; `.done` "Done"; `.saving` "Saving…"; `.leave` "Close without saving your changes?"; `.replay` "Replay with sound"; `.soundLoop` "Sound on every loop"; `.loopHint` "The preview loops so you can watch the whole animation."
  - `overlayBuilder.tabs.animation` "Animation"; `.customize` "Customize"; `.sound` "Sound"; `.location` "Location"; `.images` "Images"; `.design` "Design"
  - `overlayBuilder.sound.thisLook` "This look"; `.own` "Own sound"; `.second` "Version 2"; `.today` "Classic engine sound"; `.none` "No sound"; `.silent` "Silent"; `.current` "Current"; `.search` "Search sounds…"; `.both` "both recordings"; `.uploaded` "You uploaded a sound for this alert, so OBS plays it instead of the look's sound."; `.uploadedLink` "Overlay settings"; `.listen` "Listen"
  - `overlayBuilder.custom.nothing` "This look has no settings of its own: pick its sound in the Sound tab."; `.ownColour` "Use the look's own"; `.ownColours` "The look's own colours"; `.allSix` "Use {{family}} for all six alerts"; `.allSixConfirm` "Use {{family}} for all six alerts? Each alert starts this theme's look with its own settings."
  - `overlayBuilder.place.fixed` "Fixed spot"; `.fixedHint` "Pick one of nine places"; `.free` "Free position"; `.freeHint` "Drag it on the preview"; `.fixedNote` "The alert sits 16 px from the edges of your stream at the spot you pick."; `.freeNote` "Drag the alert on the preview. It stays at that spot on your stream."; `.size` "Size"; `.width` "{{px}} px wide"; `.top` "Top"; `.mid` "Middle"; `.bot` "Bottom"; `.left` "left"; `.center` "centre"; `.right` "right"
  - Reused, not duplicated: `overlayBuilder.style.all`, `.colour`, `.label`, `.speed`, `.effect`, `.effectOwn`, `.grows`, `.default`, `.mine`; `overlayBuilder.reset*`; `overlayBuilder.event.*`, `overlayBuilder.tab.*`; look, family and sound names.

- [ ] **Step 1: Write the failing test**

```js
test('hands the page which alerts have an uploaded sound, and the cards\' texts in the streamer\'s language', async () => {
  const { locals } = (await builder()).json();
  const uploaded = JSON.parse(locals.uploadedSounds);
  assert.deepEqual(Object.keys(uploaded).sort(), ['bits', 'donation', 'follow', 'giveaway_winner', 'raid', 'subscription', 'yt_giftmember', 'yt_member', 'yt_superchat']);
  assert.ok(Object.values(uploaded).every((v) => v === false));
  const texts = JSON.parse(locals.builderTexts);
  assert.equal(texts['tabs.customize'], 'Customize');
  assert.equal(texts['sound.today'], 'Classic engine sound');
  assert.equal(texts['window.title'], 'Edit the {{alert}} alert');
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test --test-name-pattern "uploaded sound" src/routes/dashboard.test.js`
Expected: FAIL (`locals.uploadedSounds` undefined).

- [ ] **Step 3: Add the keys** — the English map in a temp file, `node scripts/locale-keys.js add <file>`, then one `set <lang> <file>` per language with the translations (translated like the existing `overlayBuilder.*` texts; `{{placeholders}}` kept).

- [ ] **Step 4: Pass the locals** from the route as described in Interfaces.

- [ ] **Step 5: Run the route and i18n tests**

Run: `node --test src/routes/dashboard.test.js tests/i18n.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/dashboard.js src/routes/dashboard.test.js src/locales/*.json
git commit -m "feat(builder): the cards' texts and uploaded-sound flags for the page"
```

---

### Task 3: The loop engine and the card grid

**Files:**
- Create: `public/js/builder-cards.js`
- Modify: `src/views/overlay-builder.ejs` (header, `#cards` grid, script tags, `window.BUILDER` / `window.BUILDER_TEXTS`, card CSS)
- Create: `tests/builderCards.test.js`
- Modify: `src/services/overlayDesign.test.js` ("are the builder's tabs")

**Interfaces:**
- Consumes: Task 1 helpers (`window.ATLETA_BUILDER_STYLES`, aliased `STYLE_CORE` in the view), Task 2 locals; the view's inline globals that stay: `previewObjectFor(type)`, `ALERT_STYLES`, `SAVED_STYLES`, `SERVER_DESIGNS`, `STYLE_DATA`, `EVENT_DEFAULTS`, `PREVIEW_DATA`, `sponsorImages` (the sponsor list the view embeds from its `sponsors` local).
- Produces (`window.ATLETA_BUILDER_CARDS` and `module.exports`):
  - `Looper(slot, get, opts)` with `start()`, `stop()`, `restart()`; `get()` → `{ look, design, sample }`; `opts`: `{ hold = 2000, gap = 700, offset = 0, onPlay(look, design) }`. A `render` that throws leaves the slot empty for that loop and keeps looping; nothing escapes.
  - `fitAlert(slot, look, width)`: a look of the styles (`look.family && !look.preset`) gets class `look`, `width` px and `--zw = width / 420`; other looks are drawn 420 px wide with `zoom = width / 420`.
  - `designOf(type)`: the alert's working design (stored row → `STYLE_CORE.untouched(type, row, ALERT_STYLES[type])`, defaults from `EVENT_DEFAULTS`).
  - `renderCards()`: the cards in `CARD_TYPES` order; YouTube cards only while `window.BUILDER.features.youtube`.
- The view sets, before the new script: `window.BUILDER = { features: { youtube, kick }, uploadedSounds: <%- uploadedSounds %>, overlayUrl, streamThumbnail }` and `window.BUILDER_TEXTS = <%- builderTexts %>`; `<script src="/js/builder-cards.js"></script>` comes after the inline script.

- [ ] **Step 1: Write the failing tests** in `tests/builderCards.test.js` (load the file under `node:vm` with a minimal fake element — `classList`, `style.setProperty/removeProperty`, `innerHTML`, `offsetWidth` — and `mock.timers`):
  - `a loop plays the entrance, holds, plays the exit at the speed, pauses, and plays again`: look `{ anim: { in: 'x', dur: '1s', ease: 'linear' }, exit: { out: 'y', dur: '0.5s', ease: 'linear' }, controls: { speed: true }, family: 'glass', render: () => '<div class="obj"></div>' }`, design `{ animation_speed: 2 }`, opts `{ hold: 2000, gap: 700 }` → `playing` at 0; `exiting` at 500 + 2000 = 2500; slot empty at 2500 + 400 + 50; `playing` again 700 ms later.
  - `a look that throws while drawing leaves the slot empty and the loop goes on`: `render` throws → no exception; slot `innerHTML === ''`; the next cycle is scheduled.
  - `stop() clears the slot and no timer fires afterwards`.
  - `an offset delays only the first play`: `offset: 900` → nothing at 0, `playing` at 900, the second play at its normal interval.
  - `a look of the styles is scaled with --zw; a Samurai preset is zoomed at 420 px`: `fitAlert(slot, { family: 'glass' }, 210)` → class `look`, width `'210px'`, `--zw` `'0.5'`; `fitAlert(slot, { family: 'samurai', preset: true }, 210)` → no `look`, width `'420px'`, zoom `'0.5'`.

- [ ] **Step 2: Run and see them fail**

Run: `node --test tests/builderCards.test.js`
Expected: FAIL — cannot find `public/js/builder-cards.js`.

- [ ] **Step 3: Implement `Looper` and `fitAlert`**: timings from `STYLE_CORE.loopTimings(look, STYLE_CORE.speedOf(look, design))`; before each play clear the slot's previous `kit.slotVars` names, set the new ones, `--in/--dur/--ease`, then add `.playing`; at exit `--out/--outdur/--outease` and `.exiting`.

- [ ] **Step 4: Build the page frame in the view**: header (title, `cards.subtitle`, today's overlay URL button), section label `cards.twitch` + `<div class="cards" id="cards">`, `cards.youtube` + `#cards-youtube` (only while `features.youtube`), `cards.other` + `#cards-other` (the sponsor card). Remove `.builder-layout`, `.event-tabs` and `.save-bar` (their contents move in Tasks 4 and 8). Card CSS per Global Constraints.

- [ ] **Step 5: Implement `renderCards()`**: per card, icon (today's event-tab emoji), name (`overlayBuilder.event.*` / `tab.*` texts already in `I18N` or added to `BUILDER_TEXTS`), "<look title> · <family> · `cards.default`", the preview (`.stream-bg`, `streamThumbnail` as its background when set) with a looping `.mini-slot`, chips (sound name from `STYLE_DATA.sounds` / `sound.today` / `sound.none`, or `cards.uploaded` when `uploadedSounds[type]`; place via `placeSummary` with a 3×3 dot grid, `cards.free` when free), **Test in OBS** (`POST /dashboard/overlay/test/:type` with `{ chat: false }` as the builder's Test sends today, and the card's loop restarts with its sound), **Edit alert** (and the preview) → `openEditor(type)` (Task 4; until then a no-op). Card loops attach to one IntersectionObserver (rootMargin 80px); the alert width follows the preview through a ResizeObserver. The sponsor card's preview shows the first enabled sponsor image; chips `cards.rotationOn/Off` and `cards.images`.

- [ ] **Step 6: Keep "are the builder's tabs" meaningful** in `src/services/overlayDesign.test.js`: assert `STYLE_CORE.CARD_TYPES` (required from `public/js/builder-styles-core.js`) equals `BUILDER_EVENT_TYPES` as sets — every type the server saves has a card.

- [ ] **Step 7: Run the suite**

Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add public/js/builder-cards.js src/views/overlay-builder.ejs tests/builderCards.test.js src/services/overlayDesign.test.js
git commit -m "feat(builder): alert cards that loop their look"
```

---

### Task 4: The edit window — shell, tabs, Done saves, Cancel, Reset, deep links

**Files:**
- Modify: `src/views/overlay-builder.ejs` (window markup + CSS; remove `saveCurrentDesign`, `discardChanges`, `resetCurrentDesign`, `switchTab`, the `urlTab` block), `public/js/builder-cards.js`
- Test: `tests/builderCards.test.js`, `tests/overlayBuilder.test.js`

**Interfaces:**
- Consumes: `tabsFor`, `cardForTab`, `savePayload`; Task 3 `renderCards`, `designOf`.
- Produces: `openEditor(type)`, `closeEditor({ force } = {})`, `setTab(name)`, `draft` (the window's working design), `draftStyle` (the look the window shows, null for legacy cards), `saveDraft() -> Promise<{ ok, error? }>`, `isDirty() -> boolean`; panes `#pane-animation`, `#pane-customize`, `#pane-sound`, `#pane-location`, `#pane-images`, `#pane-design`; the stage `#stage` > `#stage-inner` (1920×1080) > `#fx-layer`, `#stage-slot` (used by Tasks 7 and 8).

- [ ] **Step 1: Write the failing tests** (stubbed `fetch` and `confirm`):
  - `Done sends one save with the look the window shows, and closes on success`: `openEditor('follow')`, `draftStyle = 'follow-racing'`, `await saveDraft()` → `fetch` called once with `POST /dashboard/overlay-builder/save` and body `STYLE_CORE.savePayload('follow', draft, 'follow-racing')`; on `{ ok: true }`: `SAVED_STYLES.follow === 'follow-racing'`, `ALERT_STYLES.follow === 'follow-racing'`, the window closed, `renderCards` called.
  - `a refused save keeps the window open with the route's message`: `fetch` → 400 `{ ok: false, error: 'Invalid field: card_width' }` → window open, that text shown, `SAVED_STYLES.follow` unchanged.
  - `closing with edits asks first; without edits it just closes`: `confirm` returns false → still open; true → closed; no edits → `confirm` not called.
  - `?tab=timed opens the sponsor images window; ?tab=yt_member does not while YouTube is off`.
  - Moved from `tests/overlayBuilder.test.js` ("a save sends the look the page shows next to the design; Discard and Reset put back the saved look"), same meaning: the save body comes from `STYLE_CORE.savePayload`; a saved look is remembered in `SAVED_STYLES`; Cancel and Reset put back the saved look.

- [ ] **Step 2: Run and see them fail**

Run: `node --test tests/builderCards.test.js`
Expected: FAIL (`openEditor` undefined).

- [ ] **Step 3: Window markup**: backdrop + dialog (`role="dialog"`, `aria-modal="true"`, labelled by its title): header (icon, `window.title` with the alert's name, ✕ `window.close`), a tab bar built from `tabsFor(type)` (each tab shows its current value: look title / sound name / place), the panes, the stage (shown only on `location` and `design`), footer (**Reset** with today's reset confirmation text, **Cancel**, **Done**). Full screen below 900 px.

- [ ] **Step 4: Implement** `openEditor` (copy the working design and look into `draft`/`draftStyle`, stop the card loops, open on the first of `tabsFor(type)`), `closeEditor` (edits and not `force` → `confirm(BUILDER_TEXTS['window.leave'])`), Esc / ✕ / backdrop → `closeEditor()`, Done → `saveDraft()` (button shows `window.saving`; on `ok` update `SAVED_STYLES`/`ALERT_STYLES` and the stored row, `closeEditor({ force: true })`, `renderCards()`), Reset → `POST /dashboard/overlay-builder/reset` then `draft` from the reset row (look kept). At load: `cardForTab(new URLSearchParams(location.search).get('tab'), shownCards)` → `openEditor`.

- [ ] **Step 5: Run the suite**

Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/views/overlay-builder.ejs public/js/builder-cards.js tests/builderCards.test.js tests/overlayBuilder.test.js
git commit -m "feat(builder): the edit window; Done saves the alert"
```

---

### Task 5: Animation and Customize tabs

**Files:**
- Modify: `public/js/builder-cards.js`, `src/views/overlay-builder.ejs` (remove `#section-style` and `renderStyleSection`, `renderStyleFamilies`, `renderStyleGallery`, `syncStyleControls`, `fillSoundList`, `familyName` and their CSS)
- Test: `tests/builderCards.test.js`, `tests/overlayBuilder.test.js`, `src/services/overlayDesign.test.js`

**Interfaces:**
- Consumes: `STYLE_CORE.orderGallery`, `filterGallery`, `withLook`, `controlsFor`, `lookApplied`; `STYLE_DATA.gallery[type]`, `.looks`, `.families`, `.fonts`, `.defaults`; `Looper`, `fitAlert`; `POST /dashboard/overlay-builder/family`.
- Produces: `renderAnimation()`, `renderCustomize()`, `pickLook(id)`.

- [ ] **Step 1: Write the failing tests**:
  - `the gallery lists this alert's looks only, made-for-you first, then the default, the C1 with your name, then the families`: donation for a streamer whose gallery has `donation-c1` with `mine: true` → ids[0] `'donation-c1'`, ids[1] `'donation-glass'`, `'donation-c1-channel'` listed before every family look other than Glass's; follow → no id outside `STYLE_DATA.gallery.follow`.
  - `picking a look starts its settings afresh and keeps where it sits`: draft `{ style_accent: '#FF0000', animation_speed: 1.5, card_position: 'bot-left' }`, `pickLook('follow-racing')` → `style_accent` null, `animation_speed` 1, `card_position` `'bot-left'`, `draftStyle === 'follow-racing'`.
  - `Customize shows only what the picked look takes`: `follow-glass` → colour, main text, speed, effect, no grows; `bits-glass` → also grows; `donation-c1-channel` → only the `custom.nothing` note.
  - `"Use <theme> for all six" asks, posts the family, and every card takes the stored rows`: `confirm` true → `POST /dashboard/overlay-builder/family` `{ family: 'racing' }`; each returned row goes through `lookApplied`; `SAVED_STYLES` holds the six racing looks; `draft` is the returned row for the open alert.

- [ ] **Step 2: Run and see them fail**

Run: `node --test tests/builderCards.test.js`
Expected: FAIL.

- [ ] **Step 3: Animation tab**: theme chips (`style.all` + each family present in this alert's gallery, in `STYLE_DATA.families` order); a full-width grid (`minmax(220px, 1fr)`) of tiles — preview 150 px with a looping `.mini-slot` (`fitAlert(slot, look, 210)`; the picked tile plays `draft`, others `{ style_accent: draft.style_accent, animation_speed: 1 }`; `offset: (index % 6) * 450`; observed), title (`STYLE_DATA.looks[id].title`), family name, the alert badge, "Default" / "Made for you" from `orderGallery`'s `badge`. Click → `pickLook(id)` (`draft = STYLE_CORE.withLook(draft, draftStyle, id)`, `draftStyle = id`, then `kit.playSound(kit.soundFor(look, draft))`). No stage.

- [ ] **Step 4: Customize tab**: the picked look looping large (no stream) beside the controls from `controlsFor(look)` — accent colour (+ `custom.ownColour`), Racing's controls (today's `style-racing-card/accent/name/font`, same ids), main text (`#style-label`, `maxlength="40"`), speed (`#style-speed`, 0.5–2, step 0.05), screen effect (today's `<select id="style-effect">` options as they are), grows (`#style-grows`); a change updates `draft` and restarts the preview (colour applies at once through `slotVars`). `donation-c1*`: the `custom.nothing` note. `custom.allSix` button with `confirm(custom.allSixConfirm)` → the family route as tested.

- [ ] **Step 5: Retire the Style section** from the view. In `tests/overlayBuilder.test.js` drop "the Sound row, by theme" (replaced in Task 6) and keep "an alert's saved style (andre_vilela_'s C1)" on `previewObjectFor` (still in the view). In `src/services/overlayDesign.test.js` point the 40-character `style-label` check at wherever the input now lives (view or `public/js/builder-cards.js`), same assertion.

- [ ] **Step 6: Run the suite**

Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add public/js/builder-cards.js src/views/overlay-builder.ejs tests/builderCards.test.js tests/overlayBuilder.test.js src/services/overlayDesign.test.js
git commit -m "feat(builder): Animation and Customize tabs"
```

---

### Task 6: Sound tab

**Files:**
- Modify: `public/js/builder-cards.js`, `docs/features/look-sounds.md`
- Test: `tests/builderCards.test.js`

**Interfaces:**
- Consumes: `soundOwners`, `soundGroupsFor`, `thisLookRows`, `ownerOfSound`; `STYLE_DATA.sounds`; `window.BUILDER.uploadedSounds`; `kit.playSound`.
- Produces: `renderSound()`.

- [ ] **Step 1: Write the failing tests**:
  - `the Sound tab lists "This look" then only this alert's sounds, by theme, each labelled with the alert and its look`: follow → 4 + 52 rows; every row outside "This look" has a follow owner; the `glFollow` row's tag text contains the follow badge and `Pill`.
  - `picking a row stores its key, and the look's own sound stores null`.
  - `a saved sound from another alert shows as "Current" and a save sends it unchanged`.
  - `an uploaded sound for the alert shows the notice with a link to /dashboard/overlay`.

- [ ] **Step 2: Run and see them fail**

Run: `node --test tests/builderCards.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**: search box (`sound.search`) filtering rows by name; theme chips; "This look" (`sound.thisLook`) from `thisLookRows` with tags `sound.own`, `sound.second`, `sound.today`, `sound.none` / `sound.silent`, `sound.current`; then `soundGroupsFor(type, STYLE_DATA.sounds, owners)`, each headed by the family name and `sound.both`. Row: ▶ (`aria-label` `sound.listen`, plays without picking), the name on one line, a tag line (alert badge + `<look title> · <tag>`) on one line (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`, full text in `title`); click picks (`draft.style_sound = key === look.sound ? null : key`) and plays. Notice `sound.uploaded` + link `sound.uploadedLink` → `/dashboard/overlay` when `uploadedSounds[type]`. No stage.

- [ ] **Step 4: Run the suite**

Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"`
Expected: PASS.

- [ ] **Step 5: Update `docs/features/look-sounds.md`**: the builder's Sound tab (only the alert's sounds, labelled; "This look" with the classic engine sound; "Current" for a saved sound from another alert) replaces the Theme dropdown description.

- [ ] **Step 6: Commit**

```bash
git add public/js/builder-cards.js tests/builderCards.test.js docs/features/look-sounds.md
git commit -m "feat(builder): Sound tab with only the alert's sounds"
```

---

### Task 7: Location tab

**Files:**
- Modify: `public/js/builder-cards.js`, `src/views/overlay-builder.ejs` (stage CSS)
- Test: `tests/builderCards.test.js`, `src/services/overlayDesign.test.js`

**Interfaces:**
- Consumes: `placeSummary`, `clampFree`, `ATLETA_PLACEMENT` (`placementOf`, `slotStyle`, `MIN_WIDTH`, `MAX_WIDTH`), `kit.effectFor`, `ATLETA_FX.spawn`, the view's `renderScreenEffect` path for the older effects, `Looper`.
- Produces: `renderLocation()`, `placeStage()` (applies `slotStyle(placementOf(draft))` to `#stage-slot` with `--zw` and `--fw: 1920px`).

- [ ] **Step 1: Write the failing tests**:
  - `a fixed spot clears the free position`: draft `{ card_custom_x: 0.2, card_custom_y: 0.3 }` → pick `bot-right` → `card_position 'bot-right'`, custom x/y null.
  - `switching to free position starts where the alert sits now` (from the slot's stage offset, through `clampFree`).
  - `dragging keeps the alert on the screen and stores fractions`: drag to (−100, 2000) with a 420×120 slot → `card_custom_x 0`, `card_custom_y` `Math.round(960 / 1080 * 1000) / 1000`.
  - `the size slider spans the placement bounds`: `#loc-width` `min` 200, `max` 900, step 10.

- [ ] **Step 2: Run and see them fail**

Run: `node --test tests/builderCards.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**: mode buttons (`place.fixed`/`fixedHint`, `place.free`/`freeHint`), a 3×3 grid of buttons `data-pos` with the nine `card_position` values (labels `place.top/mid/bot` + `left/center/right`), the note (`place.fixedNote` / `freeNote`), `#loc-width` (label `place.width`). The stage is shown wide here (controls in a 300–340 px column), its 1920×1080 inner scaled by a ResizeObserver; the alert loops with its effect; "↻ `window.replay`" and `window.soundLoop`. In free mode the slot takes pointer events and drags with pointer capture through `clampFree`.

- [ ] **Step 4: Keep the range test meaningful**: in `src/services/overlayDesign.test.js` "every slider and drag range in the builder fits inside the server range", include `#loc-width` (read from where it is built) and leave the old resize-handle assertion until Task 8 removes that handle.

- [ ] **Step 5: Run the suite**

Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/js/builder-cards.js src/views/overlay-builder.ejs tests/builderCards.test.js src/services/overlayDesign.test.js
git commit -m "feat(builder): Location tab with fixed spots and free drag"
```

---

### Task 8: Sponsor images and YouTube cards (the legacy panes)

**Files:**
- Modify: `src/views/overlay-builder.ejs`, `public/js/builder-cards.js`
- Test: `tests/builderCards.test.js`, `tests/overlayBuilder.test.js`, `src/services/overlayDesign.test.js`

**Interfaces:**
- Consumes the view's legacy functions that stay: `getControlValues()`, `setControlValues(d)`, `updatePreview()` (legacy branch), `updateSponsorPreview()`, `stopSponsorPreview()`, `buildFontGallery()`, the theme pop-up, `uploadSponsor()`, `previewSponsorScale()`, `saveSponsorScale()`, `toggleSponsorRotation()`, and `currentType` (set by `openEditor` for these cards).
- Produces: `#pane-images` holds today's sponsor section body; `#pane-design` holds today's `#section-theme`, `#section-text`, `#section-sideicon`, `#section-animation` and the border-radius row; their legacy preview (`#preview-card`) renders in `#stage-slot`.

- [ ] **Step 1: Write the failing tests**:
  - `the sponsor images window has Images, Design and Location, and Images holds today's sponsor controls`: the view's `#pane-images` contains `id="sp-rotation-toggle"`, `id="ctrl-sponsor-animation"`, `id="sp-upload-zone"`.
  - `YouTube cards are drawn only while YouTube is on, with Design and Location`.
  - `Done on a legacy card saves getControlValues() for that type with no style`: body equals `STYLE_CORE.savePayload('timed', getControlValues())` and has no `style` key.

- [ ] **Step 2: Run and see them fail**

Run: `node --test tests/builderCards.test.js tests/overlayBuilder.test.js`
Expected: FAIL.

- [ ] **Step 3: Move the markup** into the panes unchanged (same ids, classes, `data-pos`, `data-align`, `data-icon`, option lists, `maxlength`s, slider ranges), so `overlayDesign.test.js`'s control checks and `overlayBuilder.test.js`'s sponsor-scale, solid-gradient, card-width and font-picker tests still find them in the view.

- [ ] **Step 4: Wire them**: `openEditor('timed' | 'yt_*')` sets `currentType`, calls `setControlValues(designOf(type))` and the legacy `updatePreview()` into the stage; Images actions keep calling their routes at once; Done saves `getControlValues()` through `saveDraft()`; Location reuses Task 7 with the legacy card as the slot. Then delete what nothing uses any more (the old `#preview-screen` frame and its resize handle/drag code) and switch the width assertion in `overlayDesign.test.js` (`Math.max(200, Math.min(900, newWidth))`) to `#loc-width`'s `min`/`max`.

- [ ] **Step 5: Run the suite**

Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/views/overlay-builder.ejs public/js/builder-cards.js tests/builderCards.test.js tests/overlayBuilder.test.js src/services/overlayDesign.test.js
git commit -m "feat(builder): sponsor images and YouTube cards with today's card editor"
```

---

### Task 9: Run it, check it in the browser, document it

**Files:**
- Modify: `CLAUDE.md` (Key Architecture "Overlay Builder" bullet; "Look sounds" bullet's Sound row sentence; Overlay Consistency Rule's mentions of `updatePreview()` and the Style section; Project Structure: `public/js/builder-cards.js`; a Team Activity Log entry), `docs/operations/deploy.md` (release note: what streamers see; nothing to migrate)

- [ ] **Step 1: Full suite and boot check**

Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` → PASS.
Run: `DISCORD_DISABLED=1 TWITCH_CLIENT_ID=x TWITCH_CLIENT_SECRET=x node src/index.js` → `GET /health` 200.

- [ ] **Step 2: Browser check** (a local streamer, `/dashboard/overlay-builder`) at 1600 px and 375 px:
  - two cards per row at 1600, one at 375; every card loops; no console errors
  - Edit follow → Animation (only follow looks, tiles loop, a pick plays the sound) → Customize (colour changes the preview at once) → Sound (only follow sounds, one-line tags) → Location (fixed spot, free drag to every edge, size) → Done → the card shows the new look; reload: saved; an open `/overlay/<token>` updates
  - `?tab=timed` opens Sponsor images; upload, toggle and reorder still work; Design changes the banner
  - Esc with edits asks; Cancel drops them; Reset puts the defaults back with the look kept

- [ ] **Step 3: Update the docs** listed above (the Overlay Builder bullet describes the cards, the edit window's tabs per card, Done saves, the Sound tab's filtering; the log entry in the Team Activity Log format).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/operations/deploy.md
git commit -m "docs: the Overlay Builder's cards and edit window"
```
