# Vilela's C1 Donation Alert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** andre_vilela_'s donation alert becomes a racing Citroën C1 that tows the donation in on a billboard trailer, through a per-alert `style` on saved designs, while every other alert and streamer stays as today.

**Architecture:** `overlay_designs` gains a `style` column that the builder's save and Reset keep and only the owner sets (a one-time switch-on finds him by Twitch user id). The object registry gains a style-keyed map next to the five objects, holding `donation-c1`; the OBS overlay and the builder preview pick an alert's object with the same rule (its saved style, when known and drawn for that alert type) and remove an object only after its own exit has run.

**Tech Stack:** Node.js 24, Express 5, EJS, better-sqlite3, vanilla browser JS (no build step), `node:test`, Playwright (local checks only).

**Spec:** `docs/superpowers/specs/2026-10-15-vilela-c1-donation-design.md`. Read it first. The prototype the look comes from is `docs/superpowers/specs/assets/2026-10-15-vilela-c1-donation-prototype.html` (published as https://claude.ai/artifact/KgqM4xpd2zZSnqrABc41fd, version 2).

**Where to work:** only in the worktree `.worktrees/vilela-c1-donation` (branch `feat/vilela-c1-donation`). Never edit, stash or commit in the main checkout: other sessions use it. Every command below runs from the worktree's root.

## Global Constraints

- The style id is `donation-c1`, its `eventType` is `donation`, `anim` is `{ in: 'hold', dur: '1.25s', ease: 'linear' }` and `exit` is `{ out: 'hold', dur: '0.90s', ease: 'linear' }`.
- andre_vilela_ is found by Twitch user id `632557806` (constant `ANDRE_VILELA_TWITCH_USER_ID` in `src/db.js`), never by a row number. The one-time migration is named `c1_donation_for_andre_vilela` and prints `[DB] The C1 donation alert is on for andre_vilela_`.
- `FIELD_SPECS` (`src/services/overlayDesign.js`) must NOT gain `style`: the builder cannot choose a style in this release.
- The car is the prototype's traced drawing. Copy its path data exactly as given here; never redraw or "tidy" it (the owner rejected a car drawn from memory).
- Every class the C1 uses is under the `o-c1` prefix (besides the shared `obj` and `o-mesh`); every keyframe it adds starts with `c1`. The registry file `public/overlay/objects/index.js` stays ES5 style (`var`, `function`, string concatenation), served as is, dual-exported.
- `STYLES` is a non-enumerable property of the CommonJS export, so `Object.keys(OBJECTS)` stays the five event types (agreed with the Overlay Builder session).
- Tests never touch the network, production or `data/` of the main checkout (in-memory SQLite, temp files, vm harnesses).
- Unit suite command: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"`.
- Commits: conventional prefix, and every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- A push to `main` deploys to production. Only Task 8 pushes to `main`, and only with the owner's go-ahead while Vilela is not live.

## Review Focus

1. **Clear All while the C1 drives off** — expected: it disappears at once and nothing it scheduled (removal, next alert) fires later. Test in Task 5.
2. **His style switched off while a C1 is on screen** — expected: that alert still finishes its 0.9 s exit, and the next donation is the folding screen. Test in Task 5.
3. **A builder tab opened before the deploy saves after it** (its page knows no style, its payload has none) — expected: the stored style is kept. Test in Task 1.
4. **An amount in a long currency format** (`CA$1,250.00`) — expected: set smaller like a long euro amount, never spilling off the board. Test in Task 3.
5. **An OBS source that is not 1920 px wide** — expected: the car still starts and ends off screen (`--fw: 100vw`). Test in Task 4.

---

### Task 1: Storage — `overlay_designs.style`, a save and a Reset that keep it

**Files:**
- Modify: `src/db.js` (the Overlay Designs block: `saveOverlayDesign` ≈ lines 3268–3350 and `deleteOverlayDesign` ≈ 3352; the migrations after the `design_version` blocks ≈ line 3999; the exports ≈ line 5726)
- Modify: `src/routes/dashboard.js` (the `POST /overlay-builder/reset` route ≈ lines 2712–2727)
- Create: `src/db.overlayDesigns.test.js`
- Modify: `src/routes/dashboard.test.js` (the Overlay Builder describe that defines `const save = (eventType, body, streamer = id) => request('POST', '/dashboard/overlay-builder/save', …)` ≈ line 2273; append after its reset test ≈ line 2441)
- Modify: `src/services/overlayDesign.test.js` (the `describe('a design the builder sends', …)` block)

**Interfaces:**
- Consumes: nothing new.
- Produces (exported from `src/db.js`):
  - `saveOverlayDesign(streamerId: number, eventType: string, design: object): void`: same values and defaults as today, now an upsert that leaves `style`, `design_version`, `id` and `created_at` alone on an existing row.
  - `resetOverlayDesign(streamerId: number, eventType: string): void`: a styled row goes back to the defaults and keeps its style; a row without one is deleted; no row, nothing happens.
  - `setOverlayDesignStyle(streamerId: number, eventType: string, style: string|null): void`: writes the default design first when there is no row, then sets `style`.
  - The column `overlay_designs.style TEXT` (NULL = the alert's own look), present in every row `getOverlayDesign` / `getAllOverlayDesigns` return.

- [ ] **Step 1: Write the failing database tests**

Create `src/db.overlayDesigns.test.js`:

```js
'use strict';

// overlay_designs.style: the style an alert is drawn in (andre_vilela_'s donation alert is
// 'donation-c1'), and the save, Reset and one-time switch-on that must keep it. The real
// src/db.js runs on a database file in a temporary folder (never data/bot.db), so a test
// can boot it again on the same file, the way a deploy does.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const Module = require('module');

const DB_FILE = path.join(__dirname, 'db.js');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

// Loads src/db.js on `file`; returns the module and every line it printed.
function boot(file) {
  const origLoad = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === DB_FILE) {
      if (request === 'better-sqlite3') return function FileDatabase(_file, opts) { return new RealDatabase(file, opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
      // src/config.js exits when the real env vars are missing; db.js only reads the admin ids.
      if (request === './config') return { adminDiscordIds: [] };
    }
    return origLoad(request, parent, isMain);
  };
  const lines = [];
  const { log, error } = console;
  console.log = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  try {
    delete require.cache[DB_FILE];
    return { db: require(DB_FILE), lines };
  } finally {
    console.log = log;
    console.error = error;
    Module._load = origLoad;
  }
}

let dir;
let counter = 0;
before(() => { dir = realFs.mkdtempSync(path.join(os.tmpdir(), 'atleta-designs-')); });
after(() => { realFs.rmSync(dir, { recursive: true, force: true }); });
const newFile = () => path.join(dir, `bot-${++counter}.db`);

function addStreamer(sql, over = {}) {
  const n = ++counter;
  return Number(sql.prepare('INSERT INTO streamers (discord_user_id, discord_username, twitch_user_id, twitch_username) VALUES (?, ?, ?, ?)')
    .run(`2000000000000${String(n).padStart(5, '0')}`, `user${n}`, over.twitch_user_id || `9${String(n).padStart(8, '0')}`, over.twitch_username || `user${n}`)
    .lastInsertRowid);
}

describe('overlay_designs.style', () => {
  let db;
  let sql;
  let streamer;
  before(() => {
    const booted = boot(newFile());
    db = booted.db;
    sql = db.db;
    assert.deepEqual(booted.lines.filter((l) => l.includes('[DB migration]')), [], 'a first boot prints no migration error');
    streamer = addStreamer(sql);
  });
  after(() => sql.close());
  const row = (eventType = 'donation') => sql.prepare('SELECT * FROM overlay_designs WHERE streamer_id = ? AND event_type = ?').get(streamer, eventType);

  test('is a column of a fresh database, empty (the alert\'s own look) on a new row', () => {
    assert.ok(sql.pragma('table_info(overlay_designs)').map((c) => c.name).includes('style'));
    db.saveOverlayDesign(streamer, 'follow', {});
    assert.equal(row('follow').style, null);
  });

  test('setOverlayDesignStyle writes the default design when there is none, then the style', () => {
    sql.prepare('DELETE FROM overlay_designs WHERE streamer_id = ?').run(streamer);
    db.setOverlayDesignStyle(streamer, 'donation', 'donation-c1');
    const saved = row();
    assert.equal(saved.style, 'donation-c1');
    assert.equal(saved.card_width, 420);
    assert.equal(saved.card_position, 'top-center');
    assert.equal(saved.event_label, 'Sponsor Alert', 'the donation\'s own default label');
  });

  test('a save keeps the stored style, and writes everything it is given', () => {
    db.setOverlayDesignStyle(streamer, 'donation', 'donation-c1');
    db.saveOverlayDesign(streamer, 'donation', { card_width: 560, card_position: 'bot-left', card_custom_x: 0.25, card_custom_y: 0.5 });
    const saved = row();
    assert.equal(saved.style, 'donation-c1', 'moving the alert keeps the C1');
    assert.deepEqual([saved.card_width, saved.card_position, saved.card_custom_x, saved.card_custom_y], [560, 'bot-left', 0.25, 0.5]);
    db.saveOverlayDesign(streamer, 'donation', {});
    assert.equal(row().style, 'donation-c1');
    assert.deepEqual([row().card_width, row().card_position, row().card_custom_x], [420, 'top-center', null], 'a value the save leaves out goes back to its default, as before');
  });

  test('a save keeps design_version too (INSERT OR REPLACE used to reset it to 0)', () => {
    sql.prepare('UPDATE overlay_designs SET design_version = 1 WHERE streamer_id = ? AND event_type = ?').run(streamer, 'donation');
    db.saveOverlayDesign(streamer, 'donation', { card_width: 500 });
    assert.equal(row().design_version, 1);
  });

  test('one row per streamer and alert, updated in place', () => {
    const id = row().id;
    db.saveOverlayDesign(streamer, 'donation', { card_width: 480 });
    assert.equal(row().id, id, 'the row is updated, not deleted and inserted again');
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM overlay_designs WHERE streamer_id = ? AND event_type = ?').get(streamer, 'donation').n, 1);
  });

  test('Reset puts a styled design back to the defaults and keeps its style', () => {
    db.setOverlayDesignStyle(streamer, 'donation', 'donation-c1');
    db.saveOverlayDesign(streamer, 'donation', { card_width: 600, bg_color: '#112233' });
    db.resetOverlayDesign(streamer, 'donation');
    const saved = row();
    assert.equal(saved.style, 'donation-c1');
    assert.equal(saved.card_width, 420);
    assert.equal(saved.bg_color, '#1a1a3e');
  });

  test('Reset deletes a design without a style, as before, and does nothing when there is none', () => {
    db.saveOverlayDesign(streamer, 'raid', { card_width: 600 });
    db.resetOverlayDesign(streamer, 'raid');
    assert.equal(row('raid'), undefined);
    db.resetOverlayDesign(streamer, 'bits');
    assert.equal(row('bits'), undefined);
  });

  test('setOverlayDesignStyle(…, null) switches an alert back to its own look', () => {
    db.setOverlayDesignStyle(streamer, 'donation', 'donation-c1');
    db.setOverlayDesignStyle(streamer, 'donation', null);
    assert.equal(row().style, null);
  });

  test('getAllOverlayDesigns hands the style to the overlay with the rest of the row', () => {
    db.setOverlayDesignStyle(streamer, 'donation', 'donation-c1');
    assert.equal(db.getAllOverlayDesigns(streamer).find((d) => d.event_type === 'donation').style, 'donation-c1');
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --test src/db.overlayDesigns.test.js`
Expected: FAIL. The first test fails on the missing `style` column; the others with `db.setOverlayDesignStyle is not a function` / `db.resetOverlayDesign is not a function`.

- [ ] **Step 3: Add the column, the upsert save, Reset and setOverlayDesignStyle**

In `src/db.js`, in `saveOverlayDesign`, keep the whole `const row = { … }` object exactly as it is and replace the statement that follows it (from `db.prepare(\`` + `INSERT OR REPLACE INTO overlay_designs` to the closing `);` of `.run(…)`) with:

```js
  // An upsert: on the (streamer_id, event_type) conflict only the columns listed here are
  // written, so the ones the builder does not send (style, design_version) keep their values.
  // INSERT OR REPLACE used to delete the row and insert a new one, resetting those to their
  // defaults: a save that only moved andre_vilela_'s C1 would have turned it back into the
  // folding screen.
  const columns = Object.keys(row);
  db.prepare(`
    INSERT INTO overlay_designs (streamer_id, event_type, ${columns.join(', ')})
    VALUES (?, ?, ${columns.map(() => '?').join(', ')})
    ON CONFLICT(streamer_id, event_type) DO UPDATE SET ${columns.map((c) => `${c} = excluded.${c}`).join(', ')}
  `).run(streamerId, eventType, ...columns.map((c) => row[c]));
```

(The keys of `row` are exactly the 46 columns the old statement listed, in the same order; the statement stays prepared inside the function because some of those columns are added by migrations further down the file.)

Directly after `function deleteOverlayDesign(…) { … }`, add:

```js
// Reset in the builder: the alert's design back to the defaults. A row that carries a style
// keeps it (andre_vilela_'s C1 survives a Reset); a row without one is deleted, as before.
function resetOverlayDesign(streamerId, eventType) {
  const row = db.prepare('SELECT style FROM overlay_designs WHERE streamer_id = ? AND event_type = ?').get(streamerId, eventType);
  if (row && row.style) saveOverlayDesign(streamerId, eventType, {});
  else deleteOverlayDesign(streamerId, eventType);
}

// The style an alert is drawn in (overlay_designs.style; null: its own look). Writes the
// default design first when the streamer never saved one for this alert, so the row exists.
function setOverlayDesignStyle(streamerId, eventType, style) {
  db.transaction(() => {
    if (!getOverlayDesign(streamerId, eventType)) saveOverlayDesign(streamerId, eventType, {});
    db.prepare('UPDATE overlay_designs SET style = ? WHERE streamer_id = ? AND event_type = ?').run(style, streamerId, eventType);
  })();
}
```

After the last `design_version` block (the `try { … UPDATE overlay_designs SET design_version = 1 … } catch (e) { _migrationLog('design_version backfill', e); }`), add:

```js
// Migration: the style an alert is drawn in (overlay_designs.style). NULL is the alert's own
// look; 'donation-c1' is andre_vilela_'s C1 (switched on below). A save and Reset keep it.
try {
  const cols = db.pragma('table_info(overlay_designs)').map(c => c.name);
  if (!cols.includes('style')) {
    db.exec('ALTER TABLE overlay_designs ADD COLUMN style TEXT');
    console.log('[DB] Added style to overlay_designs');
  }
} catch (e) { _migrationLog('overlay_designs.style', e); }
```

In the `module.exports` object, after `deleteOverlayDesign,` add:

```js
  resetOverlayDesign,
  setOverlayDesignStyle,
```

- [ ] **Step 4: Run the database tests**

Run: `node --test src/db.overlayDesigns.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Write the failing route and save-check tests**

In `src/routes/dashboard.test.js`, inside the Overlay Builder describe (the one with `const save = …` and `const stored = …`), after the test `'reset needs one of the builder\'s alert types, and removes only that design'`, add:

```js
  test('a save keeps the alert\'s style, from a page that knows none and from one that posts one', async () => {
    db.setOverlayDesignStyle(id, 'donation', 'donation-c1');
    // A builder tab opened before the switch-on posts no style at all.
    assert.equal((await save('donation', design({ card_width: 560 }))).status, 200);
    const donation = stored().find((d) => d.event_type === 'donation');
    assert.equal(donation.style, 'donation-c1', 'moving the C1 keeps it');
    assert.equal(donation.card_width, 560);
    assert.equal((await save('follow', design({ style: 'donation-c1' }))).status, 200);
    assert.equal(stored().find((d) => d.event_type === 'follow').style, null, 'the builder cannot choose a style');
  });

  test('Reset keeps the alert\'s style, and the open overlay is told', async () => {
    db.setOverlayDesignStyle(id, 'donation', 'donation-c1');
    await save('donation', design({ card_width: 600 }));
    const pushed = [];
    const listener = (event) => pushed.push(event);
    bus.on(`overlay:${id}`, listener);
    try {
      const res = await request('POST', '/dashboard/overlay-builder/reset', { streamer: id, body: { eventType: 'donation' } });
      assert.deepEqual(res.json(), { ok: true });
    } finally {
      bus.off(`overlay:${id}`, listener);
    }
    const donation = stored().find((d) => d.event_type === 'donation');
    assert.equal(donation.style, 'donation-c1');
    assert.equal(donation.card_width, 420);
    assert.equal(pushed.at(-1).designs.donation.style, 'donation-c1');
  });
```

In `src/services/overlayDesign.test.js`, inside `describe('a design the builder sends', …)`, add:

```js
  test('a style in it is dropped: the builder cannot choose the look an alert is drawn in', () => {
    assert.ok(!Object.prototype.hasOwnProperty.call(FIELD_SPECS, 'style'), 'a style is set by the owner, never by a save');
    const result = validateOverlayDesign(builderPayload({ style: 'donation-c1' }), 'donation');
    assert.equal(result.ok, true);
    assert.ok(!('style' in result.design));
  });
```

- [ ] **Step 6: Run them to make sure the Reset test fails and the others pass**

Run: `node --test src/routes/dashboard.test.js src/services/overlayDesign.test.js`
Expected: the Reset test FAILS (`style` is `undefined`: the route still deletes the row); the save tests PASS (the upsert from Step 3 and `validateOverlayDesign` already do the right thing).

- [ ] **Step 7: Make the Reset route keep the style**

In `src/routes/dashboard.js`, in `router.post('/overlay-builder/reset', …)`, replace

```js
  db.deleteOverlayDesign(req.streamer.id, eventType);
```

with

```js
  // Back to the defaults; a style the owner set (andre_vilela_'s C1) is kept
  db.resetOverlayDesign(req.streamer.id, eventType);
```

- [ ] **Step 8: Run the three suites**

Run: `node --test src/db.overlayDesigns.test.js src/routes/dashboard.test.js src/services/overlayDesign.test.js`
Expected: PASS.

- [ ] **Step 9: Run the whole unit suite**

Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"`
Expected: PASS, 0 failures.

- [ ] **Step 10: Commit**

```bash
git add src/db.js src/routes/dashboard.js src/db.overlayDesigns.test.js src/routes/dashboard.test.js src/services/overlayDesign.test.js
git commit -m "feat(overlay): an alert can carry a style, and a builder save or Reset keeps it

overlay_designs.style (NULL = the alert's own look). The save is now an
upsert, so the columns it does not write (style, design_version) keep
their values; Reset puts a styled design back to the defaults and keeps
its style. setOverlayDesignStyle() writes the default row when needed.
The builder cannot send a style: FIELD_SPECS has none.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The one-time switch-on of andre_vilela_'s C1

**Files:**
- Modify: `src/db.js` (directly after the `overlay_designs.style` migration added in Task 1)
- Test: `src/db.overlayDesigns.test.js` (append a describe)

**Interfaces:**
- Consumes: `setOverlayDesignStyle(streamerId, eventType, style)` and the `style` column (Task 1); `_runOnce(name, fn)` (existing in `src/db.js`).
- Produces: on the first boot of this version, `overlay_designs.style = 'donation-c1'` on the donation design of the streamer whose `twitch_user_id` is `'632557806'`; the `data_migrations` row `c1_donation_for_andre_vilela`; the boot line `[DB] The C1 donation alert is on for andre_vilela_`.

- [ ] **Step 1: Write the failing tests**

Append to `src/db.overlayDesigns.test.js`:

```js
describe('the one-time switch-on of andre_vilela_\'s C1', () => {
  const ANDRE = '632557806';
  const MIGRATION = 'c1_donation_for_andre_vilela';

  test('a database without him records it as done and changes nothing', () => {
    const booted = boot(newFile());
    const sql = booted.db.db;
    assert.ok(sql.prepare('SELECT 1 FROM data_migrations WHERE name = ?').get(MIGRATION));
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM overlay_designs').get().n, 0);
    assert.ok(!booted.lines.some((l) => l.includes('C1 donation alert')));
    sql.close();
  });

  test('his donation alert becomes the C1 at the next boot, once, and nobody else\'s does', () => {
    const file = newFile();
    // A database from before this release: him, another streamer, and the switch-on not run yet.
    let booted = boot(file);
    let sql = booted.db.db;
    const vilela = addStreamer(sql, { twitch_user_id: ANDRE, twitch_username: 'andre_vilela_' });
    const other = addStreamer(sql);
    booted.db.saveOverlayDesign(other, 'donation', {});
    sql.prepare('DELETE FROM data_migrations WHERE name = ?').run(MIGRATION);
    sql.close();

    booted = boot(file);
    sql = booted.db.db;
    const style = (streamerId) => (sql.prepare('SELECT style FROM overlay_designs WHERE streamer_id = ? AND event_type = ?').get(streamerId, 'donation') || {}).style;
    assert.equal(style(vilela), 'donation-c1', 'his donation design was written, with the C1');
    assert.equal(style(other), null);
    assert.equal(booted.lines.filter((l) => l.includes('[DB] The C1 donation alert is on for andre_vilela_')).length, 1);
    assert.deepEqual(booted.lines.filter((l) => l.includes('[DB migration]')), []);

    // Switched off by hand afterwards: a later boot does not switch it on again.
    booted.db.setOverlayDesignStyle(vilela, 'donation', null);
    sql.close();
    booted = boot(file);
    sql = booted.db.db;
    assert.equal(style(vilela), null);
    sql.close();
  });

  test('a donation design he saved before keeps its position and width', () => {
    const file = newFile();
    let booted = boot(file);
    let sql = booted.db.db;
    const vilela = addStreamer(sql, { twitch_user_id: ANDRE });
    booted.db.saveOverlayDesign(vilela, 'donation', { card_width: 520, card_position: 'bot-right' });
    sql.prepare('DELETE FROM data_migrations WHERE name = ?').run(MIGRATION);
    sql.close();
    booted = boot(file);
    sql = booted.db.db;
    const saved = sql.prepare('SELECT * FROM overlay_designs WHERE streamer_id = ? AND event_type = ?').get(vilela, 'donation');
    assert.deepEqual([saved.style, saved.card_width, saved.card_position], ['donation-c1', 520, 'bot-right']);
    sql.close();
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --test src/db.overlayDesigns.test.js`
Expected: the three new tests FAIL (no `data_migrations` row named `c1_donation_for_andre_vilela`; his style stays `undefined`/`null`).

- [ ] **Step 3: Add the switch-on**

In `src/db.js`, directly after the `overlay_designs.style` migration from Task 1, add:

```js
// andre_vilela_ asked for the C1 billboard trailer as his donation alert
// (docs/superpowers/specs/2026-10-15-vilela-c1-donation-design.md): switched on once. He is
// found by his Twitch user id, never by a row number; a database without him (CI, a fresh
// development copy) records it as done and changes nothing.
// To switch it off: setOverlayDesignStyle(<his streamer id>, 'donation', null).
const ANDRE_VILELA_TWITCH_USER_ID = '632557806';
_runOnce('c1_donation_for_andre_vilela', () => {
  const vilela = db.prepare('SELECT id FROM streamers WHERE twitch_user_id = ?').get(ANDRE_VILELA_TWITCH_USER_ID);
  if (!vilela) return;
  setOverlayDesignStyle(vilela.id, 'donation', 'donation-c1');
  console.log('[DB] The C1 donation alert is on for andre_vilela_');
});
```

- [ ] **Step 4: Run the database tests**

Run: `node --test src/db.overlayDesigns.test.js src/db.test.js`
Expected: PASS (`src/db.test.js` still sees no migration error on a fresh database).

- [ ] **Step 5: Commit**

```bash
git add src/db.js src/db.overlayDesigns.test.js
git commit -m "feat(overlay): andre_vilela_'s donation alert is the C1, switched on once at boot

A one-time migration finds him by Twitch user id 632557806 and sets his
donation design's style to donation-c1, writing the default design first
when he never saved one. A database without him records it and changes
nothing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The C1 in the object registry (markup and exports)

**Files:**
- Modify: `public/overlay/objects/index.js` (add the C1 block after the closing `};` of `var OBJECTS = { … };`, and replace the two export lines at the end)
- Test: `tests/overlayObjects.test.js` (append a describe)

**Interfaces:**
- Consumes: the file's own `esc(s)` and `money(amount, currency)`.
- Produces:
  - `STYLES['donation-c1']` = `{ key: 'donation-c1', eventType: 'donation', anim: { in: 'hold', dur: '1.25s', ease: 'linear' }, exit: { out: 'hold', dur: '0.90s', ease: 'linear' }, render(d) }`, where `d` is `{ username, amount, currency, message }` and `render` returns the markup string, root `<div class="obj o-c1">`.
  - Browser: `window.ATLETA_OBJECT_STYLES = STYLES` (next to `window.ATLETA_OBJECTS`).
  - CommonJS: `require('…/objects/index.js').STYLES` (non-enumerable).
  - The class names Task 4 styles: `o-c1`, `o-c1-rig`, `o-c1-streaks`, `o-c1-trailer`, `o-c1-board`, `o-c1-head`, `o-c1-amt`, `o-c1-msg`, `o-c1-from`, `o-c1-tframe`, `o-c1-tw`, `o-c1-hitch`, `o-c1-car`, `o-c1-svg`, `o-c1-pitch`, `o-c1-shake`, `o-c1-wheel`, `o-c1-rear`, `o-c1-front`, `o-c1-glow`, `o-c1-spin`, `o-c1-blur`, `o-c1-num`, `o-c1-decal`, `o-c1-flame`, `o-c1-bsmoke`, `o-c1-exsmoke`; the custom properties `--o-c1-hi`, `--o-c1-mid`, `--o-c1-lo`, `--o-c1-stripe`, `--o-c1-rim`, `--o-c1-caliper`, `--o-c1-ring`, `--afit`, and on the smoke puffs `--pd`, `--dx`, `--dy`, `--ps`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/overlayObjects.test.js`:

```js
// ── Styles: an alert drawn in another look (andre_vilela_'s C1) ─────────

describe("styles — andre_vilela_'s C1 donation alert (donation-c1)", () => {
  const STYLES = OBJECTS.STYLES;
  const C1 = STYLES && STYLES['donation-c1'];
  const tip = (over = {}) => C1.render({ username: 'PitBoss92', amount: '25.00', currency: 'EUR', message: 'Força Vilela!', ...over });
  const hasClass = (html, name) => new RegExp(`class="(?:[^"]* )?${name}(?: [^"]*)?"`).test(html);
  const ids = (html) => [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);

  test('rides along with the registry without changing the five', () => {
    assert.deepEqual(Object.keys(OBJECTS).sort(), [...KEYS].sort(), 'Object.keys still lists only the five');
    assert.ok(STYLES, 'STYLES is on the export');
    assert.deepEqual(Object.keys(STYLES), ['donation-c1']);
  });

  test('has the registry shape, the id it is filed under and the alert it draws', () => {
    assert.equal(C1.key, 'donation-c1');
    assert.equal(C1.eventType, 'donation');
    assert.equal(typeof C1.render, 'function');
    assert.deepEqual(C1.anim, { in: 'hold', dur: '1.25s', ease: 'linear' });
    assert.deepEqual(C1.exit, { out: 'hold', dur: '0.90s', ease: 'linear' });
  });

  test('is one object: the rig (trailer, board, car) and the smoke it leaves behind', () => {
    const html = tip();
    assert.match(html, /^<div class="obj o-c1">/);
    for (const part of ['o-c1-rig', 'o-c1-streaks', 'o-c1-trailer', 'o-c1-board', 'o-c1-tframe', 'o-c1-hitch', 'o-c1-car', 'o-c1-flame', 'o-c1-bsmoke', 'o-c1-exsmoke']) {
      assert.ok(hasClass(html, part), part);
    }
    assert.equal((html.match(/class="o-c1-tw"/g) || []).length, 2, 'two trailer wheels');
  });

  test('the car is the traced C1: its outline, both wheels, the name and the number', () => {
    const html = tip();
    assert.match(html, /<svg class="o-c1-svg" viewBox="0 0 320 140"/);
    assert.ok(html.includes('M30,108L27,108C24.5,107.5 23.4,104 23.2,98'), 'the body outline measured from the reference');
    assert.match(html, /class="o-c1-wheel o-c1-rear" transform="translate\(57 108\.5\)"/);
    assert.match(html, /class="o-c1-wheel o-c1-front" transform="translate\(249 108\.5\)"/);
    assert.match(html, /class="o-c1-decal"[^>]*>VILELA</);
    assert.match(html, /class="o-c1-num"[^>]*>1</);
  });

  test('prints the board: Sponsor, the amount, the message in quotes and the name', () => {
    const html = tip();
    assert.ok(html.includes('<div class="o-c1-head">Sponsor</div>'));
    assert.ok(html.includes('<div class="o-c1-amt">€25.00</div>'));
    assert.ok(html.includes('<div class="o-c1-msg">&quot;Força Vilela!&quot;</div>'));
    assert.ok(html.includes('<div class="o-c1-from">PitBoss92</div>'));
  });

  test('escapes the name and the message', () => {
    const html = tip({ username: '<img src=x>Ap&x', message: '<b>hi</b>' });
    assert.ok(html.includes('&lt;img src=x&gt;Ap&amp;x'));
    assert.ok(html.includes('&lt;b&gt;hi&lt;/b&gt;'));
    assert.ok(!html.includes('<img src=x>') && !html.includes('<b>hi</b>'));
  });

  test('no message, no message line', () => {
    assert.ok(!tip({ message: '' }).includes('o-c1-msg'));
    assert.ok(!tip({ message: undefined }).includes('o-c1-msg'));
  });

  test('a long amount is set smaller so it stays on the board, never below 60 %', () => {
    assert.ok(tip().includes('<div class="o-c1-amt">€25.00</div>'), '€25.00 is at full size');
    assert.ok(tip({ amount: '1250' }).includes('<div class="o-c1-amt" style="--afit:0.78">€1,250.00</div>'));
    assert.ok(tip({ amount: '10000' }).includes('style="--afit:0.70">€10,000.00<'));
    assert.ok(tip({ amount: '1000000000' }).includes('style="--afit:0.60">'));
  });

  test('an amount in a long currency format is set smaller too (CA$1,250.00)', () => {
    assert.ok(tip({ amount: '1250', currency: 'CAD' }).includes('<div class="o-c1-amt" style="--afit:0.64">CA$1,250.00</div>'));
  });

  test('renders the dashboard test donation (src/routes/dashboard.js) in its currency', () => {
    assert.ok(C1.render({ username: 'BigSponsor', amount: 25, message: 'Keep racing!', currency: 'USD' }).includes('$25.00'));
  });

  test('every SVG id is its own: two alerts on one page never share a gradient or a clip path', () => {
    const a = tip();
    const b = tip();
    assert.ok(ids(a).length >= 6);
    assert.equal(new Set(ids(a)).size, ids(a).length, 'unique within one alert');
    assert.ok(ids(a).every((id) => !ids(b).includes(id)), 'unique between alerts');
    const own = new Set(ids(a));
    for (const [, ref] of a.matchAll(/url\(#([^)]+)\)/g)) assert.ok(own.has(ref), `url(#${ref}) points into the same alert`);
  });

  test('every class it uses is under the o-c1 prefix (besides the shared obj and o-mesh)', () => {
    const classes = [...tip().matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
    for (const name of classes) assert.ok(name === 'obj' || name === 'o-mesh' || name.startsWith('o-c1'), name);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --test tests/overlayObjects.test.js`
Expected: the new tests FAIL (`STYLES is on the export`; `Cannot read properties of undefined (reading 'render')`). The existing tests still pass.

- [ ] **Step 3: Add the C1 to the registry**

In `public/overlay/objects/index.js`, after the closing `};` of `var OBJECTS = { … };` and before the export lines, add:

```js
// ── Styles: an alert drawn in another look than its own object ──────────────
// STYLES holds objects filed under a style id, each naming the alert it draws
// (eventType). An alert whose saved design names a style (overlay_designs.style)
// renders that style's object instead of its own: objectFor() in overlay.js and
// previewObjectFor() in the builder pick with the same rule. Today there is one:
// andre_vilela_'s C1.

// The C1: a racing first-generation Citroën C1 tows the donation in on a billboard
// trailer (docs/superpowers/specs/2026-10-15-vilela-c1-donation-design.md). The car
// is an inline SVG, viewBox 0 0 320 140: rear axle x 57, front axle x 249, ground
// y 132. Its outline was measured from the CC0 Wikimedia Commons drawing
// "File:Citroën C1.svg"; never redraw it from memory.
var C1_BODY = 'M30,108L27,108C24.5,107.5 23.4,104 23.2,98L23.1,86C23.5,82 24.6,79.5 26,77.5C28.5,74.5 30.5,71.5 31.5,68.5L33.6,61.5C37,50 43,37 49.5,29C50.6,27.6 51.2,24 51.6,20.3C52.5,19 54,18.6 56,18.4C88,11.2 128,9.6 160,14.2C163.5,14.6 166.5,15.6 169,17.2C190,25 215,37.4 236,49.8C240,51.1 246,51.8 252,52.2C262,53 272,57 279,63C283,66.6 285.5,70 287,72.5C292,74.5 297,79 299,86C300.6,91 300.6,99 299.4,104C298.4,108.5 295.8,111.6 291.5,113C287,114.2 281,114.4 275.3,114A27,27 0 1 0 223.4,116.7L82.6,116.7A27,27 0 1 0 30,108Z';
var C1_DOOR_GLASS = 'M116,20.2L150,20.6C165,21.4 178,24.6 188,30.8C196,36 201.6,42 203.8,52L204.2,56.4C204.3,57.6 203.4,58.2 202.2,58.1L119.6,50C118.4,49.9 117.6,49.2 117.5,48.2Z';
var C1_QUARTER_GLASS = 'M108.6,19.9L110.4,50.6L80,47.6C73.5,46.9 68.2,43.6 66,38.4C64.4,34.4 64.4,28.6 66,24.8C67.4,21.8 70.4,20.6 74,20.3Z';
var C1_WELLS = 'M275.3,114A27,27 0 1 0 223.4,116.7Z M82.6,116.7A27,27 0 1 0 30,108Z';
// A long amount is set smaller: 7 characters fit the board of a 340px alert at 46px.
var C1_AMOUNT_HOLDS = 7;
var C1_AMOUNT_FLOOR = 0.6;
// Each alert gets its own SVG ids, so two alerts on one page never share a gradient or a clip path.
var c1Count = 0;

function c1AmountFit(text) {
  var length = Array.from(text).length;
  if (length <= C1_AMOUNT_HOLDS) return '';
  return ' style="--afit:' + Math.max(C1_AMOUNT_FLOOR, C1_AMOUNT_HOLDS / length).toFixed(2) + '"';
}

// Smoke puffs: [delay s, drift x px, drift y px, final scale]
function c1Puffs(list) {
  var html = '';
  for (var i = 0; i < list.length; i++) {
    html += '<i style="--pd:' + list[i][0] + 's;--dx:' + list[i][1] + 'px;--dy:' + list[i][2] + 'px;--ps:' + list[i][3] + '"></i>';
  }
  return html;
}

function c1Wheel(u, cx, side) {
  var spokes = '';
  for (var a = 0; a < 360; a += 72) {
    spokes += '<path d="M-1.8,-3.6L-2.7,-14.2L2.7,-14.2L1.8,-3.6Z" style="fill:var(--o-c1-rim)" transform="rotate(' + a + ')"/>';
  }
  return '<g class="o-c1-wheel ' + side + '" transform="translate(' + cx + ' 108.5)">'
    + '<circle r="23.5" fill="#0E1013"/>'
    + '<circle r="21.9" fill="none" stroke="#262A30" stroke-width="1.3"/>'
    + '<circle r="15.6" fill="#23272C"/>'
    + '<circle r="12" fill="#555C64"/>'
    + '<circle class="o-c1-glow" r="12.4" fill="url(#' + u + 'h)"/>'
    + '<path d="M3.2,-11.4A11.8,11.8 0 0 1 11.2,-3.6L8.1,-2.6A8.5,8.5 0 0 0 2.3,-8.2Z" style="fill:var(--o-c1-caliper)"/>'
    + '<g class="o-c1-spin">'
    +   '<circle r="15.2" fill="none" style="stroke:var(--o-c1-rim)" stroke-width="2.6"/>' + spokes
    +   '<circle r="4" style="fill:var(--o-c1-rim)"/><circle r="1.5" fill="#0E1013"/>'
    + '</g>'
    + '<circle class="o-c1-blur" r="15.6" fill="url(#' + u + 'd)"/>'
    + '</g>';
}

function c1Car(u) {
  return '<svg class="o-c1-svg" viewBox="0 0 320 140" aria-hidden="true" focusable="false">'
    + '<defs>'
    +   '<linearGradient id="' + u + 'p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--o-c1-hi)"/><stop offset=".45" style="stop-color:var(--o-c1-mid)"/><stop offset="1" style="stop-color:var(--o-c1-lo)"/></linearGradient>'
    +   '<linearGradient id="' + u + 'g" x1="0" y1="0" x2=".5" y2="1"><stop offset="0" stop-color="#3A4D60"/><stop offset=".5" stop-color="#152029"/><stop offset="1" stop-color="#090D12"/></linearGradient>'
    +   '<radialGradient id="' + u + 'd"><stop offset="0" stop-color="#AAB2BB"/><stop offset=".6" stop-color="#7A828B"/><stop offset=".86" stop-color="#4A5057"/><stop offset="1" stop-color="#2A2F35"/></radialGradient>'
    +   '<radialGradient id="' + u + 'h"><stop offset="0" stop-color="#FFD27A"/><stop offset=".45" stop-color="#FF7A1A" stop-opacity=".95"/><stop offset="1" stop-color="#FF3D00" stop-opacity="0"/></radialGradient>'
    +   '<radialGradient id="' + u + 's"><stop offset="0" stop-color="#000" stop-opacity=".6"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>'
    +   '<clipPath id="' + u + 'w"><path d="' + C1_DOOR_GLASS + '"/><path d="' + C1_QUARTER_GLASS + '"/></clipPath>'
    + '</defs>'
    // shadow, wheel wells (they pitch with the body), wheels
    + '<ellipse cx="162" cy="131.5" rx="150" ry="6" fill="url(#' + u + 's)"/>'
    + '<g class="o-c1-pitch"><g transform="translate(0 2)"><path d="' + C1_WELLS + '" fill="#06070A"/></g></g>'
    + c1Wheel(u, 57, 'o-c1-rear') + c1Wheel(u, 249, 'o-c1-front')
    + '<g class="o-c1-pitch"><g class="o-c1-shake"><g transform="translate(0 2)">'
    +   '<path d="' + C1_BODY + '" fill="url(#' + u + 'p)"/>'
    // the windscreen seen edge-on along the A-pillar
    +   '<path d="M166.6,16.4C188,24.4 213,36.6 235.4,50L233.6,52.2C211.4,39.6 186.6,27.6 165.6,19.4Z" fill="url(#' + u + 'g)"/>'
    // the rear haunch over the back wheel and the front arch flare
    +   '<path d="M26.5,78.5C36,72 48,67.6 60,67.4C74,67.2 84,74 88.5,90C89.6,94.5 89.4,99 88.6,103.8" stroke="rgba(0,0,0,.3)" stroke-width="1.1" fill="none"/>'
    +   '<path d="M27.5,77C37,70.6 48.5,66.4 60,66.2C73,66 82,71.6 86.6,84" stroke="rgba(255,255,255,.2)" stroke-width="1" fill="none"/>'
    +   '<path d="M211.5,109C215,88 230,75.5 249,74.6C266,74 279,84 281.5,102" stroke="rgba(0,0,0,.3)" stroke-width="1.1" fill="none"/>'
    // black side skirt, front intake and fog-lamp housing, splitter
    +   '<path d="M82.6,108.4L223.7,108.4L223.4,116.7L82.6,116.7Z" fill="#0B0D10"/>'
    +   '<path d="M283,103.2L298.6,103.2C297.8,107.4 295.4,110.6 291.4,112C288.6,112.9 285.6,113.3 282.6,113.4Z" fill="#0B0D10"/>'
    +   '<path d="M289.6,85.6C293.6,85 297.4,85 299.6,85.8C300.4,89.6 300.4,94.8 299.8,98.6C296.6,98.8 293,98.7 290,98.2C289,94.4 288.9,89.4 289.6,85.6Z" fill="#0B0D10"/>'
    +   '<circle cx="295" cy="92.1" r="2.4" fill="#D9DDE2"/>'
    +   '<path d="M276,113.6L304,112.8L304,115L277.5,116.2Z" fill="#0B0D10"/>'
    // livery: two stripes from the headlight to the tail light
    +   '<path d="M246,62C190,60.6 120,59.8 56.5,60.6" style="stroke:var(--o-c1-stripe)" stroke-width="3.2" fill="none"/>'
    +   '<path d="M246,66.4C190,65 120,64.2 57,65" style="stroke:var(--o-c1-stripe)" stroke-width="1.2" fill="none" opacity=".9"/>'
    +   '<path d="M60,56.5C120,53.5 190,55.5 240,58.6" stroke="rgba(255,255,255,.2)" stroke-width="1.1" fill="none"/>'
    // door: shut lines, bottom edge, handle; indicator on the front wing
    +   '<path d="M217.5,59C219.2,72 219.6,86 218,98C217.4,101.6 216.8,103 216.6,104" stroke="rgba(0,0,0,.4)" stroke-width="1" fill="none"/>'
    +   '<path d="M110.8,51.2C111.4,70 112,88 112.8,104" stroke="rgba(0,0,0,.4)" stroke-width="1" fill="none"/>'
    +   '<path d="M112.8,104L216.6,104" stroke="rgba(0,0,0,.28)" stroke-width="1" fill="none"/>'
    +   '<rect x="121" y="54.4" width="11" height="3" rx="1.5" fill="rgba(0,0,0,.5)"/>'
    +   '<ellipse cx="226" cy="67.8" rx="2.6" ry="1.4" fill="#FFB347" stroke="rgba(0,0,0,.35)" stroke-width=".6"/>'
    // race number
    +   '<circle cx="166" cy="80.5" r="13.5" fill="#FFFFFF" style="stroke:var(--o-c1-ring)" stroke-width="1.6"/>'
    +   '<text class="o-c1-num" x="166" y="87.6" text-anchor="middle">1</text>'
    // glass, roll cage, the driver in a helmet, the name on the rear side window
    +   '<path d="' + C1_DOOR_GLASS + '" fill="url(#' + u + 'g)" stroke="#0B0D10" stroke-width=".8"/>'
    +   '<path d="' + C1_QUARTER_GLASS + '" fill="url(#' + u + 'g)" stroke="#0B0D10" stroke-width=".8"/>'
    +   '<g clip-path="url(#' + u + 'w)">'
    +     '<path d="M158,22.4C172,24.4 186,31 196,42.6" stroke="#7A8592" stroke-width="2.4" fill="none" stroke-linecap="round"/>'
    +     '<path d="M104.5,20.6L105.6,50" stroke="#7A8592" stroke-width="2.4" stroke-linecap="round"/>'
    +     '<path d="M104,22L74,46.5" stroke="#7A8592" stroke-width="2.4" stroke-linecap="round"/>'
    +     '<path d="M139.6,52C140.8,45.6 145.6,42.8 152,42.8C158.4,42.8 163.2,45.6 164.4,52Z" fill="#1F2A36"/>'
    +     '<path d="M141,35.6C140.6,27.8 145.8,22.6 152.4,22.6C158.8,22.6 162.6,27 162.8,32.6L162.8,37.4C162.8,39.4 161.6,40.6 159.8,40.6L146,40.6C143.2,40.6 141.2,38.6 141,35.6Z" fill="#BFC6CE" opacity=".85"/>'
    +     '<path d="M154.8,28.2L162.7,28.2L162.8,33.8L154.8,33.8C153.4,33.8 152.8,32.8 152.8,31C152.8,29.2 153.4,28.2 154.8,28.2Z" fill="#141D27"/>'
    +     '<path d="M144.2,27C147.4,24.4 151.6,23.4 156,23.8" stroke="#D81E26" stroke-width="1.8" fill="none"/>'
    +     '<path d="M168,18L182,18L146,58L132,58Z" fill="rgba(255,255,255,.07)"/>'
    +     '<text class="o-c1-decal" x="88" y="38" text-anchor="middle">VILELA</text>'
    +   '</g>'
    +   '<path d="M108.6,19.6L116.4,19.6L118.4,50.8L110.4,51.2Z" fill="#0B0D10"/>'
    // tail light high on the rear corner, with its two round lamps
    +   '<path d="M34.2,58.7C37.3,48.6 43,37 49.5,29C51,27.3 52.6,26.2 54.4,26L55.2,58.7Z" fill="#3A0B10" stroke="rgba(0,0,0,.5)" stroke-width=".7"/>'
    +   '<circle cx="48.4" cy="36.2" r="3.7" fill="#D0141C"/>'
    +   '<circle cx="44.2" cy="50" r="4.4" fill="#E9E3E3" opacity=".9"/>'
    +   '<circle cx="44.2" cy="50" r="2.2" fill="#F4A3A6" opacity=".7"/>'
    // headlight, swept back along the wing
    +   '<path d="M249,56.2C256,57.2 265,58.6 271.2,60.4C276.5,61.9 281.5,65.4 284,71.5C284.8,73.5 283.8,75.2 282,75C278,74.6 272,71.8 267.8,69.8C262,67 254.5,61.6 249,56.2Z" fill="#E3E8EE" stroke="rgba(0,0,0,.4)" stroke-width=".8"/>'
    +   '<circle cx="277.6" cy="68.6" r="3.2" fill="#FFF6D2"/>'
    // mirror, its black sail, exhaust, tow straps
    +   '<path d="M215,46.6L228.6,60.2L215.8,60.2Z" fill="#0B0D10"/>'
    +   '<path d="M203,54.4L215,53.6C217.2,53.6 217.6,55.6 216.2,56.8L213.6,58.4L205,58.6C203.2,58.6 202.4,56.4 203,54.4Z" fill="#0B0D10"/>'
    +   '<path d="M197.6,50C197.6,44.6 203,42.4 208.6,43C213.6,43.6 216.4,47 215.6,50.4C214.8,53.8 210.2,55.2 205.2,54.8C200.8,54.4 197.6,53 197.6,50Z" fill="url(#' + u + 'p)" stroke="#0B0D10" stroke-width=".8"/>'
    +   '<rect x="19" y="106.2" width="12" height="4.2" rx="2.1" fill="#3B4148"/>'
    +   '<ellipse cx="20.2" cy="108.3" rx="1.1" ry="1.5" fill="#0B0D10"/>'
    +   '<path d="M299.6,100.4h6a3,3 0 0 1 0,6h-6" stroke="#FF2A2A" stroke-width="1.9" fill="none"/>'
    +   '<path d="M23.4,92h-6a3,3 0 0 0 0,6h6" stroke="#FF2A2A" stroke-width="1.9" fill="none"/>'
    + '</g></g></g>'
    + '</svg>';
}

function c1TrailerWheel(u, left) {
  var spokes = '';
  for (var a = 0; a < 360; a += 120) spokes += '<rect x="-1" y="-6.4" width="2" height="5" fill="#9AA3AD" transform="rotate(' + a + ')"/>';
  return '<svg class="o-c1-tw" style="left:' + left + '" viewBox="-12 -12 24 24" aria-hidden="true" focusable="false">'
    + '<circle r="11.5" fill="#0E1013"/>'
    + '<g class="o-c1-spin"><circle r="6.6" fill="none" stroke="#9AA3AD" stroke-width="1.6"/>' + spokes + '<circle r="2" fill="#9AA3AD"/></g>'
    + '<circle class="o-c1-blur" r="7" fill="url(#' + u + 'd)"/>'
    + '</svg>';
}

var STYLES = {
  'donation-c1': {
    key: 'donation-c1',
    eventType: 'donation',
    anim: { in: 'hold', dur: '1.25s', ease: 'linear' },
    exit: { out: 'hold', dur: '0.90s', ease: 'linear' },
    render: function (d) {
      var u = 'oc1u' + (++c1Count);
      var amount = money(d.amount, d.currency);
      return '<div class="obj o-c1"><div class="o-c1-rig">'
        + '<div class="o-c1-streaks"><i></i><i></i><i></i><i></i></div>'
        + '<div class="o-c1-trailer">'
        +   '<div class="o-c1-board"><div class="o-mesh"></div>'
        +     '<div class="o-c1-head">Sponsor</div>'
        +     '<div class="o-c1-amt"' + c1AmountFit(amount) + '>' + esc(amount) + '</div>'
        +     (d.message ? '<div class="o-c1-msg">&quot;' + esc(d.message) + '&quot;</div>' : '')
        +     '<div class="o-c1-from">' + esc(d.username) + '</div>'
        +   '</div>'
        +   '<div class="o-c1-tframe"></div>'
        +   c1TrailerWheel(u, '14%') + c1TrailerWheel(u, '66%')
        +   '<div class="o-c1-hitch"></div>'
        + '</div>'
        + '<div class="o-c1-car">' + c1Car(u)
        +   '<div class="o-c1-flame"></div>'
        +   '<div class="o-c1-bsmoke">' + c1Puffs([[0.46, 16, -7, 2.1], [0.52, 26, -12, 2.6], [0.58, 10, -4, 1.8]]) + '</div>'
        + '</div>'
        + '</div>'
        + '<div class="o-c1-exsmoke">' + c1Puffs([[0, -26, -8, 2.4], [0.06, -46, -14, 3], [0.12, -30, -4, 2.6], [0.2, -58, -18, 3.2]]) + '</div>'
        + '</div>';
    },
  },
};
```

Replace the two export lines at the end of the file:

```js
if (typeof module !== 'undefined' && module.exports) module.exports = OBJECTS;
if (typeof window !== 'undefined') window.ATLETA_OBJECTS = OBJECTS;
```

with:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OBJECTS;
  // Not enumerable: Object.keys(OBJECTS) stays the five Twitch event types.
  Object.defineProperty(module.exports, 'STYLES', { value: STYLES });
}
if (typeof window !== 'undefined') {
  window.ATLETA_OBJECTS = OBJECTS;
  window.ATLETA_OBJECT_STYLES = STYLES;
}
```

- [ ] **Step 4: Run the registry tests**

Run: `node --test tests/overlayObjects.test.js tests/overlayClient.test.js`
Expected: PASS (the overlay harness loads the changed file too and must stay green).

- [ ] **Step 5: Commit**

```bash
git add public/overlay/objects/index.js tests/overlayObjects.test.js
git commit -m "feat(overlay): the C1 billboard trailer joins the object registry as style donation-c1

A style-keyed map next to the five objects: donation-c1 draws the
donation as a racing first-generation C1 towing a billboard trailer (the
car traced from the CC0 Commons drawing). window.ATLETA_OBJECT_STYLES in
the browser; a non-enumerable STYLES on the CommonJS export, so
Object.keys(OBJECTS) is still the five.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The C1's styles and motion (`objects.css`)

**Files:**
- Modify: `public/overlay/objects/objects.css` (append a section at the end of the file)
- Test: `tests/overlayObjects.test.js` (append a describe)

**Interfaces:**
- Consumes: the class names and custom properties listed under Task 3's *Produces*; the shared `struck` and `hold` keyframes, `--o-disp`, `--o-cond`, `--o-hex`, `--r-red`, `--spd`, and the shared `.playing .obj` / `.exiting .obj` / `.exiting .obj *` rules (all already in `objects.css`).
- Produces: keyframes `c1Arrive`, `c1Leave`, `c1SpinIn`, `c1SpinInSmall`, `c1SpinOut`, `c1SpinOutSmall`, `c1BlurOut`, `c1BlurIn`, `c1Streaks`, `c1Pop`, `c1Glow`, `c1Puff`, `c1Idle`, `c1Squat`, `c1Pitch`, `c1Sway`; `.o-c1` defines `--fw: 100vw` (overridable: the builder sets `--fw: 1920px` in Task 6) and `--o-c1-cw: min(39%, 230px)`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/overlayObjects.test.js`:

```js
describe('objects.css — the C1 (donation-c1)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'objects', 'objects.css'), 'utf8');
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const defined = new Set([...css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]));
  const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(m, `rule ${selector} exists`);
    return m[1];
  };

  test('every keyframe the C1 names or plays is defined', () => {
    const c1 = OBJECTS.STYLES['donation-c1'];
    for (const name of [c1.anim.in, c1.exit.out]) assert.ok(defined.has(name), name);
    const played = new Set([...bare.matchAll(/\bc1[A-Z][A-Za-z]*\b/g)].map((m) => m[0]));
    assert.ok(played.size >= 16, 'the C1 has its own keyframes');
    for (const name of played) assert.ok(defined.has(name), `${name} is played but not defined`);
  });

  test('every C1 selector is under .o-c1, so none of its classes can collide with the builder page', () => {
    const selectors = [...bare.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((m) => m[2].trim()).filter((s) => /o-c1/.test(s));
    assert.ok(selectors.length > 20);
    for (const selector of selectors) {
      for (const part of selector.split(',')) assert.match(part.trim(), /^(\.(playing|exiting) )?\.o-c1\b/, part.trim());
    }
  });

  test('the car drives in and out across the whole OBS source, whatever its size', () => {
    assert.match(rule('.o-c1'), /--fw:\s*100vw/);
    assert.ok(css.includes('@keyframes c1Arrive{from{transform:translateX(calc(-1 * var(--fw)))}to{transform:translateX(0)}}'));
    assert.ok(css.includes('@keyframes c1Leave{from{transform:translateX(0)}to{transform:translateX(var(--fw))}}'));
  });

  test('its exit outranks the shared .exiting .obj * that stops every other animation', () => {
    assert.match(css, /\n\.exiting \.o-c1 \.o-c1-rig\{animation:c1Leave /);
    assert.match(css, /\n\.exiting \.o-c1 \.o-c1-spin\{animation:c1SpinOut /);
  });

  test('the name stays on one line, cut with an ellipsis; the message has two lines at most', () => {
    const from = rule('.o-c1 .o-c1-from');
    assert.match(from, /white-space:\s*nowrap/);
    assert.match(from, /overflow:\s*hidden/);
    assert.match(from, /text-overflow:\s*ellipsis/);
    assert.match(rule('.o-c1 .o-c1-msg'), /-webkit-line-clamp:\s*2/);
    assert.match(rule('.o-c1 .o-c1-amt'), /white-space:\s*nowrap/);
  });

  test('the car takes 39 % of the alert, at most 230px, and the board the rest less the hitch', () => {
    assert.match(rule('.o-c1'), /--o-c1-cw:\s*min\(39%,\s*230px\)/);
    assert.match(rule('.o-c1 .o-c1-car'), /width:\s*var\(--o-c1-cw\)/);
    assert.match(rule('.o-c1 .o-c1-trailer'), /width:\s*calc\(100% - var\(--o-c1-cw\) - 14px\)/);
    assert.match(rule('.o-c1 .o-c1-board'), /box-sizing:\s*border-box/);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --test tests/overlayObjects.test.js`
Expected: the new tests FAIL (`rule .o-c1 exists`; no `c1*` keyframes).

- [ ] **Step 3: Append the C1 section to `objects.css`**

Append at the very end of `public/overlay/objects/objects.css`:

```css

/* ══ 06 styles — andre_vilela_'s C1 (donation-c1) ═══════════
   A racing Citroën C1 tows the donation in on a billboard trailer
   (docs/superpowers/specs/2026-10-15-vilela-c1-donation-design.md),
   drawn instead of the folding screen for a donation whose saved design
   has style 'donation-c1'. Every class is under .o-c1 and every keyframe
   starts with c1. --fw is how far the car drives in and out: the width of
   the OBS source (the builder sets the preview canvas's). */
.o-c1{height:150px;--fw:100vw;--o-c1-cw:min(39%,230px);--o-c1-hi:#F2454C;--o-c1-mid:#D81E26;--o-c1-lo:#7E0910;--o-c1-stripe:#FFFFFF;--o-c1-rim:#E7EAEE;--o-c1-caliper:#FFC21A;--o-c1-ring:rgba(0,0,0,.25)}
.o-c1 .o-c1-rig{position:absolute;inset:0}
.o-c1 .o-c1-trailer{position:absolute;left:0;top:0;bottom:0;width:calc(100% - var(--o-c1-cw) - 14px)}
.o-c1 .o-c1-board{position:absolute;left:0;right:0;top:0;height:126px;box-sizing:border-box;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:12px 12px 14px;text-align:center;overflow:hidden;transform-origin:50% 100%;background:linear-gradient(166deg,#1C0609,#2E080E 42%,#120407);box-shadow:0 14px 30px rgba(0,0,0,.6),inset 0 0 0 1px rgba(216,30,38,.35)}
.o-c1 .o-c1-board::after{content:"";position:absolute;left:0;right:0;bottom:0;height:4px;background:linear-gradient(#F0343C,var(--r-red) 48%,#8E0A10)}
.o-c1 .o-c1-board .o-mesh{position:absolute;inset:0;background:var(--o-hex);opacity:.5;pointer-events:none}
.o-c1 .o-c1-head{position:relative;font-family:var(--o-cond);font-weight:600;font-size:10.5px;line-height:1;letter-spacing:.34em;text-transform:uppercase;color:#FF6B6B}
.o-c1 .o-c1-amt{position:relative;font-weight:800;font-size:calc(46px * var(--afit,1));line-height:1;letter-spacing:-.035em;font-variant-numeric:tabular-nums;white-space:nowrap;color:#FFFDF9;text-shadow:0 0 30px rgba(216,30,38,.8),0 3px 10px rgba(0,0,0,.6);margin-top:2px}
.o-c1 .o-c1-msg{position:relative;max-width:90%;font-family:var(--o-cond);font-style:italic;font-weight:500;font-size:12px;line-height:1.3;color:#C9636A;opacity:.92;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.o-c1 .o-c1-from{position:relative;max-width:100%;font-family:var(--o-cond);font-weight:600;font-size:12px;line-height:1.2;letter-spacing:.2em;text-transform:uppercase;color:#C9636A;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.o-c1 .o-c1-tframe{position:absolute;left:3%;right:-2px;top:126px;height:7px;background:linear-gradient(#3A4048,#15191E);box-shadow:0 2px 0 rgba(0,0,0,.4)}
.o-c1 .o-c1-hitch{position:absolute;right:-19px;top:131px;width:23px;height:4px;background:linear-gradient(#4A5058,#1A1E23)}
.o-c1 .o-c1-tw{position:absolute;top:129px;width:21px;height:21px;overflow:visible}
.o-c1 .o-c1-car{position:absolute;right:0;bottom:0;width:var(--o-c1-cw);aspect-ratio:320/140;transform:translateY(5.714%);z-index:4}
.o-c1 .o-c1-svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.o-c1 .o-c1-pitch{transform-box:view-box;transform-origin:153px 106px}
.o-c1 .o-c1-spin{transform-box:fill-box;transform-origin:50% 50%}
.o-c1 .o-c1-blur,.o-c1 .o-c1-glow{opacity:0}
.o-c1 .o-c1-num{font-family:var(--o-disp);font-weight:800;font-size:20px;fill:#0B0D10}
.o-c1 .o-c1-decal{font-family:var(--o-cond);font-weight:700;font-size:7.5px;letter-spacing:.9px;fill:rgba(255,255,255,.9)}
.o-c1 .o-c1-streaks{position:absolute;right:100%;top:10%;width:80%;height:75%;opacity:0;transform-origin:100% 50%;pointer-events:none}
.o-c1 .o-c1-streaks i{position:absolute;right:0;height:2px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.6))}
.o-c1 .o-c1-streaks i:nth-child(1){top:6%;width:72%}
.o-c1 .o-c1-streaks i:nth-child(2){top:34%;width:100%}
.o-c1 .o-c1-streaks i:nth-child(3){top:62%;width:84%}
.o-c1 .o-c1-streaks i:nth-child(4){top:92%;width:58%}
.o-c1 .o-c1-flame{position:absolute;right:94.1%;top:74.6%;width:13%;height:8.5%;opacity:0;transform-origin:100% 50%;pointer-events:none;background:radial-gradient(ellipse 100% 50% at 100% 50%,#FFF7CF 0 16%,#FFC53A 32%,#FF6A1F 56%,rgba(255,40,0,0) 74%)}
.o-c1 .o-c1-bsmoke{position:absolute;left:68.8%;top:76%;width:18%;aspect-ratio:1;pointer-events:none}
.o-c1 .o-c1-exsmoke{position:absolute;left:calc(100% - var(--o-c1-cw) + var(--o-c1-cw) * .178 - 28px);top:110px;width:56px;height:56px;pointer-events:none;z-index:5}
.o-c1 .o-c1-bsmoke i,.o-c1 .o-c1-exsmoke i{position:absolute;inset:0;border-radius:50%;opacity:0;filter:blur(3.5px);background:radial-gradient(circle,rgba(226,229,233,.6) 0,rgba(226,229,233,.3) 42%,rgba(226,229,233,0) 70%)}
@keyframes c1Arrive{from{transform:translateX(calc(-1 * var(--fw)))}to{transform:translateX(0)}}
@keyframes c1Leave{from{transform:translateX(0)}to{transform:translateX(var(--fw))}}
@keyframes c1SpinIn{from{transform:rotate(-2160deg)}to{transform:rotate(0deg)}}
@keyframes c1SpinInSmall{from{transform:rotate(-4680deg)}to{transform:rotate(0deg)}}
@keyframes c1SpinOut{from{transform:rotate(0deg)}to{transform:rotate(2160deg)}}
@keyframes c1SpinOutSmall{from{transform:rotate(0deg)}to{transform:rotate(4680deg)}}
@keyframes c1BlurOut{0%,52%{opacity:.95}82%,100%{opacity:0}}
@keyframes c1BlurIn{0%,22%{opacity:0}58%,100%{opacity:.95}}
@keyframes c1Streaks{0%{opacity:.9;transform:scaleX(1)}100%{opacity:0;transform:scaleX(.2)}}
@keyframes c1Pop{0%{opacity:0;transform:scale(.2,.6)}15%{opacity:1;transform:scale(1,1)}38%{opacity:0;transform:scale(.6,.8)}56%{opacity:0;transform:scale(.2,.6)}70%{opacity:1;transform:scale(.85,.9)}100%{opacity:0;transform:scale(.4,.7)}}
@keyframes c1Glow{0%{opacity:0}35%{opacity:.95}100%{opacity:0}}
@keyframes c1Puff{0%{opacity:0;transform:translate(0,0) scale(.3)}22%{opacity:.85}100%{opacity:0;transform:translate(var(--dx,0px),var(--dy,0px)) scale(var(--ps,2.4))}}
@keyframes c1Idle{0%,100%{transform:translateY(0)}50%{transform:translateY(1.1px)}}
@keyframes c1Squat{to{transform:rotate(-2.6deg)}}
@keyframes c1Pitch{0%,50%{transform:rotate(0)}71%{transform:rotate(2.6deg)}82%{transform:rotate(-1deg)}92%{transform:rotate(.3deg)}100%{transform:rotate(0)}}
@keyframes c1Sway{0%,52%{transform:rotate(0)}70%{transform:rotate(1.8deg)}82%{transform:rotate(-.8deg)}92%{transform:rotate(.25deg)}100%{transform:rotate(0)}}
/* Entrance: tows the board in, backfires, brakes (the nose dives, the disc glows,
   the board leans forward and settles), then the text is struck and it idles */
.playing .o-c1 .o-c1-rig{animation:c1Arrive calc(.85s / var(--spd)) cubic-bezier(.18,.68,.2,1) both}
.playing .o-c1 .o-c1-spin{animation:c1SpinIn calc(.85s / var(--spd)) cubic-bezier(.18,.68,.2,1) both}
.playing .o-c1 .o-c1-tw .o-c1-spin{animation:c1SpinInSmall calc(.85s / var(--spd)) cubic-bezier(.18,.68,.2,1) both}
.playing .o-c1 .o-c1-blur{animation:c1BlurOut calc(.85s / var(--spd)) linear both}
.playing .o-c1 .o-c1-streaks{animation:c1Streaks calc(.62s / var(--spd)) ease-out both}
.playing .o-c1 .o-c1-flame{animation:c1Pop calc(.26s / var(--spd)) linear calc(.34s / var(--spd)) both}
.playing .o-c1 .o-c1-pitch{animation:c1Pitch calc(1.2s / var(--spd)) linear both}
.playing .o-c1 .o-c1-front .o-c1-glow{animation:c1Glow calc(1.4s / var(--spd)) ease-out calc(.46s / var(--spd)) both}
.playing .o-c1 .o-c1-bsmoke i{animation:c1Puff calc(.85s / var(--spd)) ease-out calc((var(--pd) + .2s) / var(--spd)) both}
.playing .o-c1 .o-c1-board{animation:c1Sway calc(1.25s / var(--spd)) linear both}
.playing .o-c1 .o-c1-shake{animation:c1Idle calc(.11s / var(--spd)) linear calc(1.3s / var(--spd)) infinite}
.playing .o-c1 .o-c1-head{animation:struck calc(.24s / var(--spd)) ease-out calc(.92s / var(--spd)) both}
.playing .o-c1 .o-c1-amt{animation:struck calc(.28s / var(--spd)) ease-out calc(.98s / var(--spd)) both}
.playing .o-c1 .o-c1-msg{animation:struck calc(.24s / var(--spd)) ease-out calc(1.04s / var(--spd)) both}
.playing .o-c1 .o-c1-from{animation:struck calc(.24s / var(--spd)) ease-out calc(1.1s / var(--spd)) both}
/* Exit: it squats, spins its rear wheels in a puff of smoke and tows everything off
   to the right. These outrank .exiting .obj *, which stops every other animation. */
.exiting .o-c1 .o-c1-pitch{animation:c1Squat calc(.16s / var(--spd)) ease-out both}
.exiting .o-c1 .o-c1-spin{animation:c1SpinOut calc(.84s / var(--spd)) cubic-bezier(.45,0,.85,.4) both}
.exiting .o-c1 .o-c1-tw .o-c1-spin{animation:c1SpinOutSmall calc(.84s / var(--spd)) cubic-bezier(.45,0,.85,.4) both}
.exiting .o-c1 .o-c1-blur{animation:c1BlurIn calc(.84s / var(--spd)) linear both}
.exiting .o-c1 .o-c1-exsmoke i{animation:c1Puff calc(.9s / var(--spd)) ease-out calc(var(--pd) / var(--spd)) both}
.exiting .o-c1 .o-c1-rig{animation:c1Leave calc(.74s / var(--spd)) cubic-bezier(.6,0,.85,.35) calc(.1s / var(--spd)) both}
```

- [ ] **Step 4: Run the registry tests**

Run: `node --test tests/overlayObjects.test.js`
Expected: PASS.

- [ ] **Step 5: Look at it rendered (one look, by eye)**

Write a throwaway check outside the repository and run it with the repo's Playwright:

```bash
CHECK=$(mktemp -d)
cat > "$CHECK/look.js" <<'EOF'
// Renders the registry's C1 in a real Chromium at 1920x400 and freezes it at four moments.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const root = process.argv[2];
const out = process.argv[3];
const { chromium } = require(path.join(root, 'node_modules', 'playwright'));
const page = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oxanium:wght@400;600;700;800&family=Saira+Condensed:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="${pathToFileURL(path.join(root, 'public/overlay/objects/objects.css'))}">
<style>body{margin:0;width:1920px;height:400px;position:relative;overflow:hidden;background:#070B10}</style></head>
<body><div class="alert-pos" id="slot"></div>
<script src="${pathToFileURL(path.join(root, 'public/overlay/objects/index.js'))}"></script>
<script>
const slot = document.getElementById('slot');
const c1 = window.ATLETA_OBJECT_STYLES['donation-c1'];
slot.innerHTML = c1.render({ username: 'PitBoss92', amount: '1250', currency: 'EUR', message: 'Força Vilela, acelera esse C1! Bring it home in one piece this time.' });
for (const k of ['in', 'dur', 'ease']) slot.style.setProperty('--' + k, c1.anim[k]);
</script></body></html>`;
fs.writeFileSync(path.join(out, 'look.html'), page);
(async () => {
  const browser = await chromium.launch();
  const tab = await browser.newPage({ viewport: { width: 1920, height: 400 } });
  const errors = [];
  tab.on('pageerror', (e) => errors.push(String(e)));
  await tab.goto(pathToFileURL(path.join(out, 'look.html')).href);
  await tab.waitForTimeout(1500);
  for (const at of [300, 600, 1000, 2000]) {
    await tab.evaluate((t) => {
      const slot = document.getElementById('slot');
      slot.classList.remove('playing'); void slot.offsetWidth; slot.classList.add('playing');
      slot.getAnimations({ subtree: true }).forEach((a) => { a.pause(); a.currentTime = t; });
    }, at);
    await tab.screenshot({ path: path.join(out, `c1-${at}ms.png`), clip: { x: 650, y: 0, width: 620, height: 200 } });
  }
  console.log('errors:', JSON.stringify(errors));
  await browser.close();
})();
EOF
node "$CHECK/look.js" "$PWD" "$CHECK" && ls "$CHECK"
```

Expected: `errors: []` and four PNGs. Open them (an image viewer, or the Read tool). At 300 ms the rig is driving in from the left; at 600 ms the car is braking with its nose down; at 1000 ms the board is up and the text is being struck; at 2000 ms the car sits at the right end of a 420 px alert with "SPONSOR", "€1,250.00" (smaller), a two-line message and "PITBOSS92" on the board. Compare with the prototype (`docs/superpowers/specs/assets/2026-10-15-vilela-c1-donation-prototype.html`, version 2). If something is visibly wrong (overlap, text spilling, the car floating above the line), fix the CSS, rerun the step once, and keep the tests green.

- [ ] **Step 6: Commit**

```bash
git add public/overlay/objects/objects.css tests/overlayObjects.test.js
git commit -m "feat(overlay): the C1's styles and motion

The trailer, board and car laid out at 150px tall (the car 39% of the
alert, at most 230px), and the prototype's motion: it tows the board in
from the edge of the OBS source (--fw: 100vw), backfires, brakes with the
board leaning forward, strikes the text, idles, and tows everything off
to the right on exit. Classes under .o-c1, keyframes c1*.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The OBS overlay picks the object from the style and waits for its exit

**Files:**
- Modify: `public/overlay/overlay.js` (helpers after `alertSeconds()` ≈ line 36; `showNotification()` ≈ lines 435–500; `buildBannerContent()` ≈ lines 525–531)
- Test: `tests/overlayClient.test.js` (append a describe at the end of the file)

**Interfaces:**
- Consumes: `window.ATLETA_OBJECTS`, `window.ATLETA_OBJECT_STYLES` (Task 3); `overlayDesigns[type].style` (the rows the server sends, Task 1).
- Produces: `objectFor(type: string) → object|null` and `exitMs(objectDef) → number` at the top level of `overlay.js`. Task 6 mirrors `objectFor`'s rule exactly.

- [ ] **Step 1: Write the failing tests**

Append to the end of `tests/overlayClient.test.js`:

```js
// ── Styles: andre_vilela_'s C1 donation alert ───────────────────────────

describe("an alert's saved style picks its object (andre_vilela_'s C1)", () => {
  const tip = { type: 'donation', data: { username: 'PitBoss92', amount: 25, currency: 'EUR', message: 'Keep racing!' } };

  test('a donation whose design names donation-c1 is the C1, played like every object', () => {
    const overlay = loadOverlay({ designs: { donation: design({ style: 'donation-c1' }) } });
    overlay.send(tip);
    const [slot] = overlay.slots();
    assert.match(slot.innerHTML, /^<div class="obj o-c1">/);
    assert.ok(slot.classList.contains('playing'));
    assert.equal(slot.style.properties['--in'], 'hold');
    assert.equal(slot.style.properties['--dur'], '1.25s');
  });

  test('without a style the donation is the folding screen, as for everyone else', () => {
    const overlay = loadOverlay({ designs: { donation: design() } });
    overlay.send(tip);
    assert.match(overlay.slots()[0].innerHTML, /class="obj o-don"/);
  });

  test('a style the page does not know, or one that draws another alert, leaves the alert its own object', () => {
    const cases = [
      ['donation', tip.data, 'o-don', ['donation-gp', '__proto__', 'constructor', 'toString']],
      ['follow', { username: 'RacerDan' }, 'o-follow', ['donation-c1', '__proto__']],
    ];
    for (const [type, data, own, styles] of cases) {
      for (const style of styles) {
        const overlay = loadOverlay({ designs: { [type]: design({ style }) } });
        overlay.send({ type, data });
        assert.match(overlay.slots()[0].innerHTML, new RegExp(`class="obj ${own}"`), `${type} with style ${style}`);
      }
    }
  });

  test('the C1 sits where his donation alert is saved, at its width', () => {
    const overlay = loadOverlay({ designs: { donation: design({ style: 'donation-c1', card_position: 'bot-right', card_width: 520 }) } });
    overlay.send(tip);
    const [slot] = overlay.slots();
    assert.deepEqual(placed(slot), POSITION_STYLES['bot-right']);
    assert.equal(slot.style.width, '520px');
  });

  test('a style pushed while the overlay is open applies to the next donation, with no reload', () => {
    const overlay = loadOverlay();
    overlay.send({ type: 'config-update', designs: { donation: design({ style: 'donation-c1' }) } });
    overlay.send(tip);
    assert.match(overlay.slots()[0].innerHTML, /class="obj o-c1"/);
    assert.equal(overlay.sandbox.reloaded, false);
  });

  test('the C1 stays on screen for its whole 0.9 s exit, and the next alert waits for it', () => {
    const overlay = loadOverlay({ designs: { donation: design({ style: 'donation-c1' }) } });
    overlay.send(tip);
    overlay.send(follow('Next'));
    overlay.clock.advance(6000); // the donation's 6 s in baseConfig
    const [slot] = overlay.slots();
    assert.ok(slot.classList.contains('exiting'));
    assert.equal(slot.style.properties['--out'], 'hold');
    assert.equal(slot.style.properties['--outdur'], '0.90s');
    overlay.clock.advance(899);
    assert.equal(overlay.slots().length, 1, 'still driving off');
    overlay.clock.advance(1);
    assert.equal(overlay.slots().length, 0);
    overlay.clock.advance(499);
    assert.equal(overlay.slots().length, 0, 'then the half-second gap');
    overlay.clock.advance(1);
    assert.match(overlay.slots()[0].innerHTML, /class="obj o-follow"/);
  });

  test('the folding screen still leaves after 400 ms', () => {
    const overlay = loadOverlay({ designs: { donation: design() } });
    overlay.send(tip);
    overlay.clock.advance(6000 + 399);
    assert.equal(overlay.slots().length, 1);
    overlay.clock.advance(1);
    assert.equal(overlay.slots().length, 0);
  });

  test('Clear All while the C1 drives off removes it at once, and nothing it scheduled comes back', () => {
    const overlay = loadOverlay({ designs: { donation: design({ style: 'donation-c1' }) } });
    overlay.send(tip);
    overlay.send(follow('Queued'));
    overlay.clock.advance(6000 + 300); // 0.3 s into its exit
    overlay.send({ type: 'clear' });
    assert.equal(overlay.slots().length, 0);
    overlay.clock.advance(5000);
    assert.equal(overlay.slots().length, 0, 'its removal and next-alert timers went with it');
  });

  test('a style switched off while a C1 is on screen: that one still drives off in 0.9 s, the next donation is the folding screen', () => {
    const overlay = loadOverlay({ designs: { donation: design({ style: 'donation-c1' }) } });
    overlay.send(tip);
    overlay.send(tip);
    overlay.send({ type: 'config-update', designs: { donation: design() } });
    overlay.clock.advance(6000 + 899);
    assert.match(overlay.slots()[0].innerHTML, /class="obj o-c1"/, 'the alert on screen keeps the exit it started with');
    overlay.clock.advance(1 + 500);
    assert.match(overlay.slots()[0].innerHTML, /class="obj o-don"/);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --test tests/overlayClient.test.js`
Expected: the C1 tests FAIL (the donation renders `o-don` whatever its style, and the slot is gone 400 ms into the exit). The "does not know" and "folding screen" tests may already pass.

- [ ] **Step 3: Add `objectFor` and `exitMs`**

In `public/overlay/overlay.js`, directly after the `alertSeconds(type)` function, add:

```js
// The object an alert renders: the style its saved design names (overlay_designs.style), when
// this page knows that style and it draws this alert type (andre_vilela_'s donation is
// 'donation-c1'); otherwise the alert's own object; null for the alerts that are legacy cards.
// The builder preview picks with the same rule (previewObjectFor in overlay-builder.ejs).
function objectFor(type) {
  const design = overlayDesigns[type];
  const styleId = design && design.style;
  const styles = window.ATLETA_OBJECT_STYLES || {};
  const styled = styleId ? styles[styleId] : null;
  if (styled && styled.key === styleId && styled.eventType === type) return styled;
  const own = window.ATLETA_OBJECTS && window.ATLETA_OBJECTS[type];
  return own && own.key === type ? own : null;
}

// How long an object's exit runs ("0.90s" is 900 ms), never less than the 400 ms every alert
// has always had, so the five objects keep their pace.
function exitMs(objectDef) {
  const seconds = parseFloat(objectDef && objectDef.exit && objectDef.exit.dur);
  return Number.isFinite(seconds) ? Math.max(400, Math.round(seconds * 1000)) : 400;
}
```

- [ ] **Step 4: Use them in `showNotification` and `buildBannerContent`**

In `showNotification(event)`, replace

```js
  const objectDef = window.ATLETA_OBJECTS && window.ATLETA_OBJECTS[event.type];
```

with

```js
  const objectDef = objectFor(event.type);
```

and, at the end of the dismiss timer, replace

```js
    alertTimer(() => {
      slot.remove();
      alertTimer(playNext, 500);
    }, 400);
```

with

```js
    // An object leaves once its own exit has run (the C1 drives off for 0.9 s); a card fades in 0.3 s
    alertTimer(() => {
      slot.remove();
      alertTimer(playNext, 500);
    }, objectDef ? exitMs(objectDef) : 400);
```

In `buildBannerContent(event)`, replace

```js
  // The five Twitch events render from the shared object registry.
  // Everything else keeps the legacy top-accent + card-body + car-track card.
  const objects = window.ATLETA_OBJECTS;
  if (objects && objects[event.type]) {
    return objects[event.type].render(event.data || {});
  }
```

with

```js
  // The five Twitch events render from the shared object registry, or from the style their
  // saved design names (objectFor). Everything else keeps the legacy
  // top-accent + card-body + car-track card.
  const objectDef = objectFor(event.type);
  if (objectDef) return objectDef.render(event.data || {});
```

- [ ] **Step 5: Run the overlay tests**

Run: `node --test tests/overlayClient.test.js tests/overlayObjects.test.js`
Expected: PASS, the existing pace test (`5000 + 400 + 500`) included.

- [ ] **Step 6: Commit**

```bash
git add public/overlay/overlay.js tests/overlayClient.test.js
git commit -m "feat(overlay): an alert renders the object its saved style names, and leaves after its own exit

objectFor() picks the style's object when the page knows it and it draws
that alert type, else the alert's own object. A slot is removed after
the object's exit (at least 400 ms): 0.9 s for the C1, unchanged for the
five objects and the legacy cards.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The builder previews the alert's style

**Files:**
- Modify: `src/views/overlay-builder.ejs` (the `#preview-object-host` CSS rule ≈ line 484; after `SERVER_DESIGNS.forEach(d => { SAVED_DESIGNS[d.event_type] = d; });` ≈ line 1217; before the comment `// The five object event types take only their position and width…` ≈ line 1428; `syncPhase1Controls()` ≈ line 1434; `updatePreview()` ≈ line 1446)
- Test: `tests/overlayBuilder.test.js` (append a describe)

**Interfaces:**
- Consumes: `window.ATLETA_OBJECTS`, `window.ATLETA_OBJECT_STYLES` (Task 3); the server's designs `SERVER_DESIGNS` with `style` (Task 1); `objectFor`'s rule (Task 5), mirrored.
- Produces: `ALERT_STYLES` (map: alert type → stored style id) and `previewObjectFor(type) → object|null` in the builder page's script.

- [ ] **Step 1: Write the failing tests**

Append to `tests/overlayBuilder.test.js`:

```js
describe("an alert's saved style (andre_vilela_'s C1)", () => {
  const vm = require('node:vm');
  const OBJECTS = require('../public/overlay/objects/index.js');

  // previewObjectFor on its own, in a page that has the registry and the given stored styles.
  function pick(type, alertStyles) {
    const context = vm.createContext({ window: { ATLETA_OBJECTS: OBJECTS, ATLETA_OBJECT_STYLES: OBJECTS.STYLES }, ALERT_STYLES: alertStyles });
    vm.runInContext(functionSource('previewObjectFor'), context);
    return vm.runInContext(`previewObjectFor(${JSON.stringify(type)})`, context);
  }

  test('the preview draws the object the overlay would: the C1 for a donation styled donation-c1', () => {
    assert.equal(pick('donation', { donation: 'donation-c1' }).key, 'donation-c1');
    assert.equal(pick('donation', {}).key, 'donation');
    assert.equal(pick('follow', { follow: 'donation-c1' }).key, 'follow', 'a style for another alert is ignored');
    assert.equal(pick('donation', { donation: 'donation-gp' }).key, 'donation', 'so is an unknown one');
    assert.equal(pick('donation', { donation: '__proto__' }).key, 'donation');
    assert.equal(pick('giveaway_winner', {}), null, 'a legacy card has no object');
  });

  test('the stored styles are read once from the server\'s designs, apart from the working copy', () => {
    assert.match(builder, /const ALERT_STYLES = \{\};\s*SERVER_DESIGNS\.forEach\(d => \{ if \(d\.style\) ALERT_STYLES\[d\.event_type\] = d\.style; \}\);/);
  });

  test('the preview and the controls use that pick, never the alert\'s own object directly', () => {
    assert.match(functionSource('updatePreview'), /const objDef = previewObjectFor\(currentType\);/);
    assert.match(functionSource('syncPhase1Controls'), /previewObjectFor\(currentType\)/);
    assert.ok(!/ATLETA_OBJECTS\[currentType\]/.test(builder), 'no lookup skips the style');
  });

  test('Reset and Discard leave the stored style alone (the server keeps it), and no save sends one', () => {
    for (const name of ['resetCurrentDesign', 'discardChanges', 'saveCurrentDesign']) {
      assert.ok(!functionSource(name).includes('ALERT_STYLES'), name);
    }
    assert.ok(!/\bstyle\s*:/.test(functionSource('getControlValues')), 'the saved payload has no style');
  });

  test('the car drives in from the edge of the preview screen (the 1920px canvas, scaled)', () => {
    assert.match(builder, /#preview-object-host \{[^}]*--fw: 1920px;/);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --test tests/overlayBuilder.test.js`
Expected: the new tests FAIL (`previewObjectFor exists`; no `ALERT_STYLES`). The "Reset and Discard" test may pass already.

- [ ] **Step 3: Read the stored styles and add the pick**

In `src/views/overlay-builder.ejs`, directly after

```js
SERVER_DESIGNS.forEach(d => { SAVED_DESIGNS[d.event_type] = d; });
```

add

```js
// Each alert's stored style (overlay_designs.style; andre_vilela_'s donation is 'donation-c1').
// Kept apart from workingDesigns: Reset and Discard rebuild those from the defaults, and the
// server keeps the style through both, so the preview must too. The builder never sends it.
const ALERT_STYLES = {};
SERVER_DESIGNS.forEach(d => { if (d.style) ALERT_STYLES[d.event_type] = d.style; });
```

Directly before the comment line `// The five object event types take only their position and width from a saved`, add:

```js
// The object an alert's preview draws: the same rule as objectFor() in public/overlay/overlay.js,
// reading the stored styles. null for the alerts that are legacy cards.
function previewObjectFor(type) {
  const styleId = ALERT_STYLES[type];
  const styles = window.ATLETA_OBJECT_STYLES || {};
  const styled = styleId ? styles[styleId] : null;
  if (styled && styled.key === styleId && styled.eventType === type) return styled;
  const own = window.ATLETA_OBJECTS && window.ATLETA_OBJECTS[type];
  return own && own.key === type ? own : null;
}

```

In `syncPhase1Controls()`, replace

```js
  const isObject = !!(window.ATLETA_OBJECTS && window.ATLETA_OBJECTS[currentType]);
```

with

```js
  const isObject = !!previewObjectFor(currentType);
```

In `updatePreview()`, replace

```js
  const objDef = window.ATLETA_OBJECTS && window.ATLETA_OBJECTS[currentType];
```

with

```js
  const objDef = previewObjectFor(currentType);
```

In the page's `<style>`, replace

```css
    #preview-object-host {
      position: relative;
      width: 420px;
    }
```

with

```css
    #preview-object-host {
      position: relative;
      width: 420px;
      /* How far a car drives in and out (the C1 style): the preview screen is the 1920px canvas, scaled */
      --fw: 1920px;
    }
```

- [ ] **Step 4: Run the builder and page tests**

Run: `node --test tests/overlayBuilder.test.js src/services/overlayDesign.test.js tests/scriptEmbeds.test.js src/csrf.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/overlay-builder.ejs tests/overlayBuilder.test.js
git commit -m "feat(overlay-builder): the preview draws the alert's stored style

ALERT_STYLES is read once from the server's designs, apart from the
working copy, so Reset and Discard keep it; previewObjectFor() picks
with the overlay's rule. The preview host sets --fw to the 1920px
canvas, so the C1 drives in from the preview screen's edge.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs, the whole suite and the check by eye

**Files:**
- Modify: `CLAUDE.md` (Project Structure `objects/` line; the OBS Overlay and Overlay Builder bullets; the Overlay Consistency Rule; a Team Activity Log entry)
- Modify: `docs/operations/deploy.md` (a new section at the end)

**Interfaces:**
- Consumes: everything above.
- Produces: the documentation, and screenshots of the C1 in a locally run site.

- [ ] **Step 1: Update `CLAUDE.md`**

Replace the Project Structure line

```
    ├── objects/          # The five alert objects (follow, subscription, bits, donation, raid): index.js + objects.css, every class namespaced .o-*
```

with

```
    ├── objects/          # The five alert objects (follow, subscription, bits, donation, raid) and the styles an alert can be drawn in instead (STYLES: donation-c1, andre_vilela_'s C1): index.js + objects.css, every class namespaced .o-*
```

In the **OBS Overlay** bullet, after the sentence ``The five Twitch event types (`follow`, `subscription`, `bits`, `donation`, `raid`) render from the shared object registry in `public/overlay/objects/` (see Overlay Consistency Rule below).``, add:

```
An alert whose saved design carries a `style` (`overlay_designs.style`) renders that style's object instead (`objectFor()` in `overlay.js`): today only andre_vilela_'s donation, `donation-c1`, a racing Citroën C1 that tows the donation in on a billboard trailer (`docs/superpowers/specs/2026-10-15-vilela-c1-donation-design.md`), switched on once at boot by his Twitch user id (`_runOnce('c1_donation_for_andre_vilela')` in `db.js`; switch it off with `db.setOverlayDesignStyle(<his streamer id>, 'donation', null)`). An object's slot is removed once its own exit has run (`exit.dur`, at least 400 ms).
```

In the **Overlay Builder** bullet, after the sentence ``overlayDesign.test.js` fails when the builder's controls and `FIELD_SPECS` drift apart.``, add:

```
A save is an upsert that leaves `style` (and `design_version`) alone, and Reset (`db.resetOverlayDesign`) keeps a styled row's style; the builder never sends a style and `FIELD_SPECS` has none, so only the owner sets one. The preview picks its object with the overlay's rule (`previewObjectFor()`, reading `ALERT_STYLES`).
```

In the **Overlay Consistency Rule**, after the sentence ``Any change to an object's markup, keyframes or timing is made there and nowhere else — both render paths (the OBS overlay `overlay.js` and the builder preview `overlay-builder.ejs`) consume the same module.``, add:

```
Styles (`STYLES` in `objects/index.js`, `window.ATLETA_OBJECT_STYLES` in the browser) are objects filed under a style id with the `eventType` they draw; both render paths pick an alert's object with the same rule (`objectFor()` in `overlay.js`, `previewObjectFor()` in the builder). `STYLES` is a non-enumerable property of the CommonJS export, so `Object.keys(OBJECTS)` is still the five.
```

At the end of the Team Activity Log, add (use the current time):

```
### 2026-10-15 HH:MM — claude (direct session)
**Task:** andre_vilela_'s donation alert as a racing Citroën C1 towing a billboard trailer (`docs/superpowers/specs/2026-10-15-vilela-c1-donation-design.md`)
**Files:** `src/db.js`, `src/routes/dashboard.js`, `public/overlay/objects/index.js`, `public/overlay/objects/objects.css`, `public/overlay/overlay.js`, `src/views/overlay-builder.ejs`, tests, `CLAUDE.md`, `docs/operations/deploy.md`
**Decisions:**
- `overlay_designs.style` picks the object an alert renders; only the owner sets it (the builder cannot); a save (now an upsert) and Reset keep it.
- The C1 is `STYLES['donation-c1']` next to the five objects; `objectFor()` / `previewObjectFor()` share one rule; an object leaves after its own exit.
- Switched on once for Twitch user id 632557806 (`c1_donation_for_andre_vilela`). Agreed with the Overlay Builder session, whose style system builds on this.
**Open:** a sound made for the C1; the builder's style picker (that session's work).
```

- [ ] **Step 2: Add the release note to `docs/operations/deploy.md`**

Append:

```markdown

## Vilela's C1 donation alert

Before:

1. Vilela (andre_vilela_) is not live.
2. Read only, in production: his `twitch_user_id` is `632557806` (the switch-on finds him by it).

After the deploy:

- The boot log shows `[DB] Added style to overlay_designs` and, once,
  `[DB] The C1 donation alert is on for andre_vilela_`. Neither appears again on later boots.
- Read only: his donation design has `style = 'donation-c1'`.
- Vilela (not the owner: the test acts only on the signed-in streamer's overlays), signed in as himself and off stream, presses **Preview Alert** on the Donation card of the overlay settings page; the test also posts his donation thank-you in his Twitch chat.

Switching it off (the folding screen again): `db.setOverlayDesignStyle(<his streamer id>, 'donation', null)`,
or the same `UPDATE overlay_designs SET style = NULL …`; an overlay that is already open picks it up after a
builder save or a reconnect.

Going back to an earlier release is a plain revert (older code never reads `style`), but older code's save
writes the whole row again and would drop the style; after coming back, set it again with
`setOverlayDesignStyle(<his streamer id>, 'donation', 'donation-c1')`.
```

- [ ] **Step 3: Run the whole suite and the syntax checks**

Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js" && find src -name '*.js' -print0 | xargs -0 -n1 node --check && node --check public/overlay/overlay.js && node --check public/overlay/objects/index.js`
Expected: every test passes, no syntax error.

- [ ] **Step 4: Boot twice on a fresh database, as CI does**

```bash
test ! -e data/bot.db && echo "fresh: the worktree has no database yet"
for run in 1 2; do
  DISCORD_DISABLED=1 TWITCH_CLIENT_ID=ci-dummy TWITCH_CLIENT_SECRET=ci-dummy PORT=3000 node src/index.js > "/tmp/c1-boot-$run.log" 2>&1 &
  pid=$!
  for attempt in $(seq 1 60); do curl -fsS --max-time 2 http://127.0.0.1:3000/health | grep -q '"ok":true' && break; sleep 1; done
  kill -TERM "$pid"; wait "$pid"; echo "boot $run exit: $?"
  grep -F '[DB migration]' "/tmp/c1-boot-$run.log" && echo "MIGRATION ERROR on boot $run"
done
```

Expected: `boot 1 exit: 0`, `boot 2 exit: 0`, no `MIGRATION ERROR`. `data/bot.db` now exists in the worktree only (it is git-ignored). If port 3000 is busy (another session's local site), use another `PORT` here and in Steps 6–7.

- [ ] **Step 5: Seed andre_vilela_ and a web session into the worktree's database**

```bash
CHECK=$(mktemp -d)
cat > "$CHECK/seed.js" <<'EOF'
// Seeds the WORKTREE's data/bot.db (never production, never the main checkout's) with
// andre_vilela_'s account, an overlay token and a web session, and un-records the switch-on
// so the next boot runs it. The ids are synthetic except his Twitch user id.
const path = require('path');
const root = process.argv[2];
const db = require(path.join(root, 'src', 'db.js'));
const id = Number(db.db.prepare(`INSERT INTO streamers (discord_user_id, discord_username, twitch_user_id, twitch_username, overlay_token, overlay_enabled)
  VALUES ('100000000000000777', 'vilela-local', '632557806', 'andre_vilela_', 'local-c1-check', 1)`).run().lastInsertRowid);
db.db.prepare("DELETE FROM data_migrations WHERE name = 'c1_donation_for_andre_vilela'").run();
db.createSession('local-c1-session', id, Date.now() + 24 * 3600 * 1000);
db.db.close();
console.log('seeded streamer', id);
EOF
DISCORD_DISABLED=1 TWITCH_CLIENT_ID=x TWITCH_CLIENT_SECRET=x node "$CHECK/seed.js" "$PWD"
echo "$CHECK"
```

Expected: `seeded streamer 1`. Keep the printed `$CHECK` folder for the next steps.

- [ ] **Step 6: Start the site and watch the switch-on happen**

```bash
DISCORD_DISABLED=1 TWITCH_CLIENT_ID=x TWITCH_CLIENT_SECRET=x PORT=3000 node src/index.js > "$CHECK/site.log" 2>&1 &
echo $! > "$CHECK/site.pid"
for attempt in $(seq 1 60); do curl -fsS --max-time 2 http://127.0.0.1:3000/health | grep -q '"ok":true' && break; sleep 1; done
grep -F 'C1 donation alert' "$CHECK/site.log"
```

Expected: `[DB] The C1 donation alert is on for andre_vilela_`.

- [ ] **Step 7: Look at it in his overlay and his builder**

```bash
cat > "$CHECK/eye.js" <<'EOF'
// The real overlay page and the real builder for the seeded account, at 1920x1080.
const path = require('path');
const root = process.argv[2];
const out = process.argv[3];
const { chromium } = require(path.join(root, 'node_modules', 'playwright'));
const base = 'http://127.0.0.1:3000';
const shot = (page, name) => page.screenshot({ path: path.join(out, name + '.png') });
const tips = [
  { username: 'PitBoss92', amount: '25', currency: 'EUR', message: 'Força Vilela, acelera esse C1!' },
  { username: 'TurboTina_PT', amount: '1250', currency: 'EUR', message: 'For the engine rebuild. Bring it home in one piece this time, and stay off the sausage kerb in turn 5 please!' },
  { username: 'Anonymous', amount: '2', currency: 'EUR', message: '' },
  { username: 'AVeryLongTwitchNameIs25ch', amount: '10000', currency: 'CAD', message: 'Big one' },
];
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addCookies([{ name: 'session', value: 'local-c1-session', url: base }]);
  const errors = [];

  // 1. A real test donation through the server, as the Preview Alert button sends it.
  const overlay = await context.newPage();
  overlay.on('pageerror', (e) => errors.push('overlay: ' + e));
  await overlay.goto(base + '/overlay/local-c1-check');
  await overlay.waitForTimeout(2000);
  const dash = await context.newPage();
  await dash.goto(base + '/dashboard/overlay');
  console.log('test donation:', await dash.evaluate(async () => (await fetch('/dashboard/overlay/test/donation', { method: 'POST' })).status));
  await overlay.waitForTimeout(400); await shot(overlay, 'server-0.4s');
  await overlay.waitForTimeout(400); await shot(overlay, 'server-0.8s');
  await overlay.waitForTimeout(1000); await shot(overlay, 'server-1.8s');

  // 2. The samples, fed straight into the page's event stream (clear between them).
  for (const [i, data] of tips.entries()) {
    await overlay.evaluate((d) => {
      evtSource.onmessage({ data: JSON.stringify({ type: 'clear' }) });
      evtSource.onmessage({ data: JSON.stringify({ type: 'donation', data: d }) });
    }, data);
    await overlay.waitForTimeout(1800);
    await shot(overlay, `sample-${i + 1}`);
  }
  // 3. The exit: the last sample's 12 s, then 0.4 s into its drive-off.
  await overlay.waitForTimeout(12000 - 1800 + 400);
  await shot(overlay, 'exit-0.4s');

  // 4. His builder: the donation tab, moved and saved, reloaded, reset, reloaded.
  const builder = await context.newPage();
  builder.on('pageerror', (e) => errors.push('builder: ' + e));
  builder.on('dialog', (d) => d.accept());
  const donationTab = async () => { await builder.click('.event-tab[data-type="donation"]'); await builder.waitForTimeout(1800); };
  await builder.goto(base + '/dashboard/overlay-builder');
  await donationTab(); await shot(builder, 'builder-1-donation');
  await builder.click('.pos-cell[data-pos="bot-right"]');
  await builder.click('button[onclick="saveCurrentDesign()"]');
  await builder.waitForTimeout(800);
  await builder.reload(); await donationTab(); await shot(builder, 'builder-2-after-save');
  await builder.click('button[onclick="resetCurrentDesign()"]');
  await builder.waitForTimeout(800); await shot(builder, 'builder-3-after-reset');
  await builder.reload(); await donationTab(); await shot(builder, 'builder-4-reset-reloaded');

  console.log('errors:', JSON.stringify(errors));
  await browser.close();
})();
EOF
node "$CHECK/eye.js" "$PWD" "$CHECK"
node -e "const D=require('./node_modules/better-sqlite3'); const d=new D('data/bot.db',{readonly:true}); console.log(d.prepare(\"SELECT style, card_position, card_width FROM overlay_designs WHERE event_type='donation'\").all())"
```

Expected:
- `test donation: 200`, `errors: []`.
- The screenshots show the C1 at top centre: arriving (`server-0.4s`), braking (`server-0.8s`), parked with the board (`server-1.8s`); the four samples fit their board (the big and CAD amounts smaller, the 25-character name cut with "…", no empty message line for the €2 one); `exit-0.4s` shows it towing off to the right.
- `builder-1-donation` previews the C1; `builder-2-after-save` shows it bottom right, still the C1; `builder-3-after-reset` and `builder-4-reset-reloaded` show the C1 back at top centre.
- The last command prints one row: `{ style: 'donation-c1', card_position: 'top-center', card_width: 420 }`.

If anything is off, fix it in the task that owns it (with its test), rerun this step once, and note what changed.

- [ ] **Step 8: Stop the site and send the owner the look**

```bash
kill -TERM "$(cat "$CHECK/site.pid")"
ls "$CHECK"/*.png
```

Show the owner the screenshots (or a short recording). The local `data/bot.db` stays in the worktree only; it is git-ignored and never pushed.

- [ ] **Step 9: Commit the docs and push the branch**

```bash
git add CLAUDE.md docs/operations/deploy.md
git commit -m "docs: Vilela's C1 donation alert in CLAUDE.md and the deploy runbook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 8: Release (only with the owner's go-ahead, while Vilela is not live)

**Files:** none changed, unless Step 2 finds a different Twitch user id.

**Interfaces:**
- Consumes: the green branch from Task 7; Railway access (project `4e52137b-f75a-4c71-8fbe-48c6e1ca445f`, environment `bcaedd71-e63a-4192-b8ab-777f17ffa26f`, service `dae3e50b-5b14-4581-bf1f-bd22c645a7be`; the repo is not `railway link`ed).
- Produces: the release on `main`, deployed; messages to the other sessions; the project memory updated.

- [ ] **Step 1: Ask the owner to go ahead**

Ask: is Vilela offline now, and may this ship? Stop here until the owner says yes.

- [ ] **Step 2: Read only: confirm his Twitch user id and note his donation design**

```bash
PAYLOAD=$(printf '%s' "const D=require('/app/node_modules/better-sqlite3');const d=new D('/app/data/bot.db',{readonly:true});const s=d.prepare(\"SELECT id, twitch_username, twitch_user_id, overlay_enabled FROM streamers WHERE twitch_username = 'andre_vilela_'\").get();console.log(JSON.stringify(s));if(s)console.log(JSON.stringify(d.prepare(\"SELECT card_width, card_position, card_custom_x, card_custom_y FROM overlay_designs WHERE streamer_id = ? AND event_type = 'donation'\").get(s.id)||null));" | base64 | tr -d '\n')
bash -c "railway ssh --project 4e52137b-f75a-4c71-8fbe-48c6e1ca445f --environment bcaedd71-e63a-4192-b8ab-777f17ffa26f --service dae3e50b-5b14-4581-bf1f-bd22c645a7be \"cd /app && node -e 'eval(Buffer.from(\\\"$PAYLOAD\\\",\\\"base64\\\").toString(\\\"utf8\\\"))'\""
```

Expected: `"twitch_user_id":"632557806"`, and his donation design (or `null` if he never saved one). If the id differs: stop, change `ANDRE_VILELA_TWITCH_USER_ID` and the two tests that use `632557806` (Task 2) to the real id, rerun the suite, commit, then continue. If his saved width is below 340, tell the owner before shipping.

- [ ] **Step 3: Bring the branch up to date with `main`**

```bash
git fetch origin
git rebase origin/main
node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"
```

Expected: a clean rebase (if `src/db.js` conflicts with another session's migrations, keep both blocks), and every test passing.

- [ ] **Step 4: Ship it: fast-forward `main` from the branch**

```bash
git push origin HEAD:main
git push --force-with-lease origin HEAD:feat/vilela-c1-donation
```

(`git push origin HEAD:main` refuses anything but a fast-forward, and it never touches the main checkout's files. The second push only updates the feature branch after the rebase.)

- [ ] **Step 5: Watch the deploy**

```bash
SHA=$(git rev-parse HEAD)
railway deployment list --project 4e52137b-f75a-4c71-8fbe-48c6e1ca445f --environment bcaedd71-e63a-4192-b8ab-777f17ffa26f --service dae3e50b-5b14-4581-bf1f-bd22c645a7be --json | jq -r --arg s "$SHA" '.[] | select((.meta.commitHash // "-") == $s) | "\(.id) \(.status)"'
```

Repeat until the status is `SUCCESS` (about 2 minutes), then, with that deployment id:

```bash
railway logs <deployment-id> --project 4e52137b-f75a-4c71-8fbe-48c6e1ca445f --environment bcaedd71-e63a-4192-b8ab-777f17ffa26f --service dae3e50b-5b14-4581-bf1f-bd22c645a7be --lines 300 | grep -E "C1 donation|style to overlay_designs|DB migration"
```

Expected: `[DB] Added style to overlay_designs` and `[DB] The C1 donation alert is on for andre_vilela_`, and no `[DB migration]` line.

- [ ] **Step 6: Read only: his donation design carries the C1**

```bash
PAYLOAD=$(printf '%s' "const D=require('/app/node_modules/better-sqlite3');const d=new D('/app/data/bot.db',{readonly:true});console.log(JSON.stringify(d.prepare(\"SELECT o.style, o.card_width, o.card_position FROM overlay_designs o JOIN streamers s ON s.id = o.streamer_id WHERE s.twitch_user_id = '632557806' AND o.event_type = 'donation'\").get()));" | base64 | tr -d '\n')
bash -c "railway ssh --project 4e52137b-f75a-4c71-8fbe-48c6e1ca445f --environment bcaedd71-e63a-4192-b8ab-777f17ffa26f --service dae3e50b-5b14-4581-bf1f-bd22c645a7be \"cd /app && node -e 'eval(Buffer.from(\\\"$PAYLOAD\\\",\\\"base64\\\").toString(\\\"utf8\\\"))'\""
```

Expected: `{"style":"donation-c1", …}` with the width and position noted in Step 2.

- [ ] **Step 7: Ask Vilela to see it**

Only Vilela can: the test acts on the signed-in streamer's overlays, and the admin panel has no overlay test. Signed in as himself and off stream, he presses **Preview Alert** on the Donation card of the overlay settings page on `atletanotifications.com`. The C1 should play in the preview and in his OBS browser source, and, while his chatbot is on, his donation thank-you with the test values is posted in his Twitch chat.

- [ ] **Step 8: Tell the other sessions and update the memory**

Send to `vilela-notifications-59` (Overlay Builder): "The C1 branch is merged to main as <SHA>: overlay_designs.style, STYLES['donation-c1'] (non-enumerable STYLES on the export, window.ATLETA_OBJECT_STYLES), objectFor()/exitMs() in overlay.js, previewObjectFor()/ALERT_STYLES in the builder, saveOverlayDesign as an upsert, resetOverlayDesign/setOverlayDesignStyle in db.js. Rebase onto main when you start." Send to `vilela-notifications-81` (polls): "The C1 branch is merged to main as <SHA>; it adds two migration blocks after the design_version ones in src/db.js and two exports after deleteOverlayDesign."

Update `~/.claude/projects/-Users-ricardosilva-Library-Mobile-Documents-com-apple-CloudDocs-Projects-vilela-notifications/memory/vilela-c1-donation.md`: shipped on 2026-10-15 as <SHA> (Railway deployment <id>), the switch-on ran, and how to switch it off.
