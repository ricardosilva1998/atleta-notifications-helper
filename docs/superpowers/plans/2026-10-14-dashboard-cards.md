# Dashboard Working Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the dashboard's Twitch tab into ten working cards whose switches save as they move and whose short texts are edited in a pop-up, on a page that fills the window — after first shipping five fixes found while mapping the save paths.

**Architecture:** One JSON route (`POST /dashboard/settings`) saves single settings through a whitelist table (`src/services/dashboardSettings.js`) that knows where each value lives, how to check it and what must follow the write. A pure module (`src/services/dashboardCards.js`) turns the data `GET /dashboard` gathers into each card's state; ten EJS partials (`src/views/cards/*.ejs`) draw the cards; a dual-exported core (`public/js/dashboard-cards-core.js`) and a page script (`public/js/dashboard-cards.js`) run the switches, pop-ups, packing and giveaway panel.

**Tech Stack:** Node.js 24, Express 5, EJS, better-sqlite3, tmi.js, plain browser JavaScript (no build step), `node:test`, Playwright (browser checks only).

**Spec:** `docs/superpowers/specs/2026-10-14-dashboard-cards-design.md` (approved). Mockup: `docs/superpowers/specs/assets/2026-10-14-dashboard-cards-mockup.html` (open it in a browser; the CSS, the icon sprite and the card markup in this plan come from it).

## Global Constraints

- Plain CommonJS, no build step, **no new npm dependencies**. Browser files are served as they are from `public/`.
- Every database access goes through `src/db.js` (raw SQL there). **No schema change** (no new table or column).
- Every user-facing text goes through `t()` with its key in **all 7 locale files** (`src/locales/{en,pt,es,fr,de,zh,ja}.json`, flat `"a.b.c": "text"` maps). English first; the other six translated in each file's own style, following `.superpowers/sdd/stream-fixes/i18n-glossary.md` (in the `.worktrees/stream-fixes` worktree). Placeholders are `{{name}}` and must be identical in every language. `tests/i18n.test.js` enforces all of this. No English typed into a view.
- A sentence with markup (code, bold, a link) is printed through the escaping `rich()` or split with the views' `_around()` helper; plain values with `<%= %>`; never `<%- t() %>`.
- A value a view prints into its own `<script>` as JSON ends in `.replace(/</g, '\\u003c')` (`tests/scriptEmbeds.test.js`). Keep JSON embeds in top-level views (`src/views/*.ejs`), not in partials.
- Forms and `fetch` calls need nothing extra for CSRF (`header.ejs` loads `public/js/csrf.js`). Routes called with JSON answer `{ ok: true, ... }` or `{ ok: false, code, error }` with `error` translated.
- Validate and clamp on the server; HTML `min`/`max` are a convenience.
- Tests never reach the network, production or `data/` (stubs, in-memory SQLite).
- The repository is **public**: comments, docs and commit messages describe behaviour only.
- Do not change how the OBS overlay draws anything (CLAUDE.md "Overlay Consistency Rule"); Task 7 changes only the address the overlay's stream is opened with.
- Commits: Conventional Commit messages, explicit paths in `git add`, each message ending with the `Co-Authored-By:` line from your own attribution instructions (and nothing after it).
- The full suite stays green after every task: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` (2479 tests before Task 1).
- Work in the worktree `/Users/ricardosilva/Library/Mobile Documents/com~apple~CloudDocs/Projects/vilela-notifications/.worktrees/stream-fixes` (branch `fix/stream-review-2026-10-13`). Never push; releases are done by the controller (see *Release A* and *Release B*).

## Review Focus

1. **Quick repeated clicks on one switch** — the stored value ends as the last click, and the card never keeps showing a value the server refused. Pinned in Task 16 (`createLatestQueue`).
2. **A channel watched in two of the streamer's servers** — a go-live or clips switch changes only the server it was flipped in. Pinned in Task 10.
3. **A session that ended while the page was open** — the save answers with the login page (HTML), the switch flips back and the card says to reload; nothing crashes on parsing. Pinned in Task 16 (`readAnswer`).
4. **Switch values of the wrong kind** — `"0"`, `"false"`, `0`, `false`, `""`, `"off"` are off; `"1"`, `"true"`, `1`, `true`, `"on"` are on; `"yes"`, `2`, `[]`, `null`, `{}` are refused (400), never read as "a truthy string means on". Pinned in Task 5 (`parseSwitch`) and Task 9.
5. **The overlay switched off while OBS is open** — no alert reaches the stream at once, while sponsor images, redemption clips, config updates and clears still do. Pinned in Task 7.

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `src/services/twitchChat.js` | nothing posts while the chatbot is off; the bot's moderator status | 1, 8 |
| `src/services/inputLimits.js` | moderation ranges, actions, `parseSwitch` | 4, 5 |
| `src/routes/dashboard.js` | the fixes; the settings, command, tip-goal, moderator routes; card data | 1–5, 6–13 |
| `src/views/giveaways-config.ejs` | the countdown reads times right | 3 |
| `src/views/dashboard.ejs` | Spotify disconnect (A); the VTuber gate, the new Twitch tab, the texts table (B) | 5, 6, 14, 16 |
| `src/config.js` | `features.overlays = true`, new `features.vtuber` | 6 |
| `src/services/overlayPresence.js` (new) | how many alert overlays are open per streamer | 7 |
| `src/routes/overlay.js`, `public/overlay/overlay.js` | the overlay switch stops alerts; the alert overlay names itself | 7 |
| `src/db.js` | `isOverlayEnabled`, single-column writers, small readers, `runInTransaction`, `countModLog` | 7, 9, 11, 13 |
| `src/services/dashboardSettings.js` (new) | the settings table: read, check, write, follow-ups | 9, 10 |
| `src/services/chatCommands.js` | the 100-command limit | 11 |
| `src/services/dashboardCards.js` (new) | each card's state, from the data the route gathers | 12 |
| `src/views/header.ejs` | the wide container | 13 |
| `src/views/cards/*.ejs` (new) | the CSS, the icon sprite and the cards | 14 |
| `src/locales/*.json` | every new text; the old cards' texts removed | 1, 5, 7, 10, 11, 14, 15, 16 |
| `tests/i18nViewsPart1.test.js` | the dashboard samples, the card partials checked for English | 6, 14, 15 |
| `public/js/dashboard-cards-core.js` (new) | pure helpers for the page script (tested) | 16 |
| `public/js/dashboard-cards.js` (new) | the page script: saving, statuses, packing (16); pop-ups, tests, rewards, giveaways (17) | 16, 17 |
| `CLAUDE.md` | each task's behaviour, in the bullet it belongs to | every task |

---

# Phase A — fixes (Release A)

### Task 1: Nothing posts while the chatbot is off; a giveaway cannot start while it is off

Today `chatManager.sendMessage` (sponsor, giveaway and reward lines) posts even when the streamer switched the chatbot off; only the thank-yous check the switch. And a giveaway can start with the chatbot off, so nobody can enter.

**Files:**
- Modify: `src/services/twitchChat.js` (`sendMessage`)
- Modify: `src/services/twitchChat.test.js` (describe `the bot's chat output`)
- Modify: `src/routes/dashboard.js` (`router.post('/giveaways/start', …)`)
- Modify: `src/routes/dashboard.test.js` (describe `the messages and names those routes show`)
- Modify: `src/locales/{en,pt,es,fr,de,zh,ja}.json` (key `giveaways.error.chatbotOff`)
- Modify: `CLAUDE.md` (Twitch Chatbot bullet, Giveaways bullet)

**Interfaces:**
- Consumes: nothing new.
- Produces: `sendMessage(streamerId, text, { priority })` drops the line when `streamer.chatbot_enabled` is falsy. `POST /dashboard/giveaways/start` answers `409 { ok: false, code: 'chatbot_off', error }` while the chatbot is off.

- [ ] **Step 1: Write the failing chat test**

In `src/services/twitchChat.test.js`, inside `describe('the bot\'s chat output', …)` (it defines `texts`), add:

```js
  test('nothing is posted for a streamer whose chatbot is off: sponsor, giveaway and reward lines alike', () => {
    streamer = streamerRow({ chatbot_enabled: 0 });
    chatManager.sendMessage(1, 'sponsor line', { priority: 'low' });
    chatManager.sendMessage(1, 'giveaway line');
    chatClock.advance(5_000);
    assert.deepEqual(texts(), []);

    streamer = streamerRow({ chatbot_enabled: 1 });
    chatManager.sendMessage(1, 'sponsor line', { priority: 'low' });
    chatClock.advance(5_000);
    assert.deepEqual(texts(), ['sponsor line']);
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern="nothing is posted for a streamer whose chatbot is off" src/services/twitchChat.test.js`
Expected: FAIL — `texts()` is `['sponsor line', 'giveaway line']`, not `[]`.

- [ ] **Step 3: Gate `sendMessage` on the switch**

In `src/services/twitchChat.js` replace `sendMessage` and its comment with:

```js
  // Any other line for a streamer's chat: giveaway and redemption messages
  // ('normal', the default), sponsor and timed messages ('low'), the dashboard's
  // custom-command test ('high'). Nothing is posted for a streamer whose chatbot
  // is switched off, or whose account is disabled.
  sendMessage(streamerId, text, { priority = 'normal' } = {}) {
    if (!client) return;
    const streamer = db.getStreamerById(streamerId);
    if (!streamer || isStreamerDisabled(streamer) || !streamer.chatbot_enabled || !streamer.twitch_username) return;
    post(streamer.twitch_username, text, priority);
  },
```

- [ ] **Step 4: Run the chat tests**

Run: `node --test src/services/twitchChat.test.js`
Expected: PASS (all tests; the default `streamerRow()` has `chatbot_enabled: 1`).

- [ ] **Step 5: Write the failing giveaway route test**

In `src/routes/dashboard.test.js`, in `describe('the messages and names those routes show', …)`, change its `beforeEach` so its streamer has the chatbot on (its giveaway tests need it now):

```js
  beforeEach(() => { id = addStreamer({ chatbot_enabled: 1 }); });
```

and add to the same describe:

```js
  test('a giveaway cannot start while the chatbot is off: it says so and starts nothing', async () => {
    const off = addStreamer({ chatbot_enabled: 0 });
    const res = await request('POST', '/dashboard/giveaways/start', { streamer: off, body: { keyword: 'gw' } });
    assert.equal(res.status, 409);
    assert.deepEqual(res.json(), { ok: false, code: 'chatbot_off', error: t('en', 'giveaways.error.chatbotOff') });
    assert.equal(count('giveaways', 'streamer_id = ?', off), 0);
  });
```

- [ ] **Step 6: Run it to see it fail**

Run: `node --test --test-name-pattern="a giveaway cannot start while the chatbot is off" src/routes/dashboard.test.js`
Expected: FAIL (status 201, or 500 because the text key is missing).

- [ ] **Step 7: Refuse the start, and add the text**

In `src/routes/dashboard.js`, at the top of `router.post('/giveaways/start', (req, res) => {`, right after `const streamerId = req.streamer.id;`:

```js
  // The chatbot collects the entries in chat: without it nobody could enter.
  if (!req.streamer.chatbot_enabled) {
    return res.status(409).json({ ok: false, code: 'chatbot_off', error: res.locals.t('giveaways.error.chatbotOff') });
  }
```

In `src/locales/en.json` add `"giveaways.error.chatbotOff": "Turn the chatbot on first: it collects the entries in chat."`, and the same key, translated, to the six other locale files.

- [ ] **Step 8: Run the route tests and the whole suite**

Run: `node --test src/routes/dashboard.test.js` then `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"`
Expected: PASS. If another test starts a giveaway through the route with a streamer whose chatbot is off, give that streamer `chatbot_enabled: 1` (the behaviour change is intended).

- [ ] **Step 9: Document it**

In `CLAUDE.md`, Twitch Chatbot bullet, after "Every line the bot posts goes through `chatDispatcher.js`": add the sentence "Nothing is posted for a streamer whose chatbot is switched off (thank-yous, sponsor, giveaway and reward lines alike)." In the Giveaways bullet add "A giveaway cannot start while the streamer's chatbot is off (`chatbot_off`): the chatbot collects the entries."

- [ ] **Step 10: Commit**

```bash
git add src/services/twitchChat.js src/services/twitchChat.test.js src/routes/dashboard.js src/routes/dashboard.test.js src/locales/en.json src/locales/pt.json src/locales/es.json src/locales/fr.json src/locales/de.json src/locales/zh.json src/locales/ja.json CLAUDE.md
git commit -m "fix(chat): nothing posts while the chatbot is off; a giveaway needs it on"
```

### Task 2: Adding a sponsor message starts the rotation

`POST /dashboard/sponsor-messages/add` stores the message but never restarts the chat rotation, so with sponsor messages switched on and no message yet, the first one added posts nothing until another change.

**Files:**
- Modify: `src/routes/dashboard.js` (`router.post('/sponsor-messages/add', …)`)
- Modify: `src/routes/dashboard.test.js` (describe `the messages and names those routes show`)
- Modify: `CLAUDE.md` (Sponsor Rotation bullet)

**Interfaces:** Produces: the add route calls `timedNotificationManager.restartChatForStreamer(streamerId)` after a successful add.

- [ ] **Step 1: Write the failing test**

In `describe('the messages and names those routes show', …)` (it has `id` and the global `sponsorCalls` recorder):

```js
  test('adding a sponsor message restarts the chat rotation, so the first one starts it', async () => {
    const res = await request('POST', '/dashboard/sponsor-messages/add', { streamer: id, body: { message_text: 'Thanks to our partner!' } });
    assert.equal(res.status, 200);
    assert.deepEqual(sponsorCalls, [['sponsors.restartChat', id]]);
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern="adding a sponsor message restarts" src/routes/dashboard.test.js`
Expected: FAIL — `sponsorCalls` is `[]`.

- [ ] **Step 3: Restart after the add**

Replace the add route with:

```js
router.post('/sponsor-messages/add', (req, res) => {
  const { message_text, url } = req.body;
  if (!message_text) return res.status(400).json({ error: res.locals.t('sponsors.error.textRequired') });
  db.addSponsorMessage(req.streamer.id, message_text, url);
  // The rotation reads the enabled messages when it starts: with none before this one it was not running.
  try {
    const { timedNotificationManager } = require('../services/timedNotifications');
    timedNotificationManager.restartChatForStreamer(req.streamer.id);
  } catch (e) {
    console.error('[Dashboard] Sponsor chat restart failed:', e.message);
  }
  res.json({ ok: true });
});
```

- [ ] **Step 4: Run the tests**

Run: `node --test src/routes/dashboard.test.js`
Expected: PASS.

- [ ] **Step 5: Document and commit**

In `CLAUDE.md`, Sponsor Rotation bullet, add: "Adding, editing, switching or deleting a sponsor chat message restarts the chat rotation, so the first message added starts it."

```bash
git add src/routes/dashboard.js src/routes/dashboard.test.js CLAUDE.md
git commit -m "fix(sponsors): adding the first sponsor message starts the rotation"
```

### Task 3: The giveaways page counts down

`src/views/giveaways-config.ejs` reads the end time with `new Date(ACTIVE_ENDS_AT + 'Z')`, but `ends_at` is already an ISO time ending in `Z` (written by `giveawayManager.startGiveaway` with `toISOString()`), so the countdown shows `NaN:NaN`. The "x ago" times read the database's own `YYYY-MM-DD HH:MM:SS` (UTC without a zone) and must keep working.

**Files:**
- Modify: `src/views/giveaways-config.ejs` (`updateCountdown`, `relTime`)
- Modify: `src/routes/dashboard.test.js` (new describe)

**Interfaces:** Produces: a page function `utcMs(value)` in the giveaways page script.

- [ ] **Step 1: Write the failing test**

Append to `src/routes/dashboard.test.js`:

```js
// ── The giveaways page's times ───────────────────────────────────────────

describe('the giveaways page countdown', () => {
  test('reads the end time the giveaway stores (an ISO time) and the database\'s own times', async () => {
    const id = addStreamer({ chatbot_enabled: 1 });
    db.insertGiveaway({ streamer_id: id, keyword: 'gw', status: 'open', ends_at: '2026-10-14T18:05:00.000Z' });
    const page = await request('GET', '/dashboard/giveaways', { streamer: id });
    assert.equal(page.status, 200);
    const source = page.text.match(/function utcMs\(value\) \{[\s\S]*?\n\}/);
    assert.ok(source, 'the page has its time reader');
    const utcMs = new Function(`${source[0]}; return utcMs;`)();
    assert.equal(utcMs('2026-10-14T18:05:00.000Z'), Date.UTC(2026, 9, 14, 18, 5));
    assert.equal(utcMs('2026-10-14 18:05:00'), Date.UTC(2026, 9, 14, 18, 5));
    assert.ok(Number.isNaN(utcMs('not a time')));
    assert.doesNotMatch(page.text, /\+ 'Z'\)/, 'no time is read by adding a Z to it');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern="the giveaways page countdown" src/routes/dashboard.test.js`
Expected: FAIL — "the page has its time reader".

- [ ] **Step 3: Add `utcMs` and use it**

In `src/views/giveaways-config.ejs`, in the page script, just above `// ── Countdown ─────`, add (keep the closing brace at the start of its line — the test reads the function by it):

```js
// A time from the server in milliseconds: an ISO time (a giveaway's end, written with its zone) as it is,
// and the database's own "YYYY-MM-DD HH:MM:SS" (UTC, written without a zone) as UTC.
function utcMs(value) {
  var s = String(value);
  if (/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(s)) return Date.parse(s);
  return Date.parse(s.replace(' ', 'T') + 'Z');
}
```

In `updateCountdown` replace `var endsMs = new Date(ACTIVE_ENDS_AT + 'Z').getTime();` with `var endsMs = utcMs(ACTIVE_ENDS_AT);`. In `relTime` replace `new Date(dateStr + 'Z').getTime()` with `utcMs(dateStr)`.

- [ ] **Step 4: Run the tests**

Run: `node --test src/routes/dashboard.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/giveaways-config.ejs src/routes/dashboard.test.js
git commit -m "fix(giveaways): the countdown reads the end time right"
```

### Task 4: The moderation settings stay in their ranges on the server

`POST /dashboard/chatbot/moderation` stores numbers as `parseInt(x) || default` (negatives and huge values are stored) and any text as the action. Keep them in the page's ranges.

**Files:**
- Modify: `src/services/inputLimits.js`
- Modify: `src/services/inputLimits.test.js`
- Modify: `src/routes/dashboard.js` (`router.post('/chatbot/moderation', …)`)
- Modify: `src/routes/dashboard.test.js` (new describe)
- Modify: `CLAUDE.md` (Chat Moderation bullet)

**Interfaces:**
- Produces (from `inputLimits.js`): `MODERATION_LIMITS` (frozen `{ column: { min, max, fallback } }`), `moderationNumber(column, value) -> integer`, `MODERATION_ACTIONS` (frozen array), `moderationAction(value) -> string`.

- [ ] **Step 1: Write the failing unit tests**

Append to `src/services/inputLimits.test.js` (use the file's existing `describe`/`test`/`assert` imports):

```js
describe('moderation numbers and actions', () => {
  const { MODERATION_LIMITS, moderationNumber, MODERATION_ACTIONS, moderationAction } = require('./inputLimits');

  test('every number has the chatbot page\'s range and today\'s default', () => {
    assert.deepEqual(MODERATION_LIMITS, {
      mod_link_permit_seconds: { min: 10, max: 600, fallback: 60 },
      mod_caps_min_length: { min: 3, max: 100, fallback: 10 },
      mod_caps_max_percent: { min: 30, max: 100, fallback: 70 },
      mod_emote_max_count: { min: 1, max: 100, fallback: 15 },
      mod_repetition_window: { min: 5, max: 300, fallback: 30 },
      mod_symbol_max_percent: { min: 10, max: 100, fallback: 50 },
      mod_follow_age_minutes: { min: 1, max: 1440, fallback: 10 },
      mod_raid_protection_duration: { min: 30, max: 600, fallback: 120 },
    });
  });

  test('a number past its range is brought into it, one that is not a number gets the default', () => {
    assert.equal(moderationNumber('mod_link_permit_seconds', '99999'), 600);
    assert.equal(moderationNumber('mod_link_permit_seconds', '-5'), 10);
    assert.equal(moderationNumber('mod_link_permit_seconds', '0'), 10);
    assert.equal(moderationNumber('mod_link_permit_seconds', 'abc'), 60);
    assert.equal(moderationNumber('mod_link_permit_seconds', undefined), 60);
    assert.equal(moderationNumber('mod_caps_max_percent', '55.6'), 56);
  });

  test('the action is one the bot knows, else delete', () => {
    assert.deepEqual(MODERATION_ACTIONS, ['delete', 'warn', 'timeout_10', 'timeout_60', 'timeout_600', 'timeout_1800']);
    assert.equal(moderationAction('timeout_60'), 'timeout_60');
    assert.equal(moderationAction('ban_forever'), 'delete');
    assert.equal(moderationAction(undefined), 'delete');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test src/services/inputLimits.test.js`
Expected: FAIL — `moderationNumber is not a function`.

- [ ] **Step 3: Add the ranges and actions to `inputLimits.js`**

Above `module.exports` in `src/services/inputLimits.js`:

```js
// The moderation numbers (the chatbot page's Moderation fields): the page's range, and the default a value
// that is not a number gets.
const MODERATION_LIMITS = Object.freeze({
  mod_link_permit_seconds: Object.freeze({ min: 10, max: 600, fallback: 60 }),
  mod_caps_min_length: Object.freeze({ min: 3, max: 100, fallback: 10 }),
  mod_caps_max_percent: Object.freeze({ min: 30, max: 100, fallback: 70 }),
  mod_emote_max_count: Object.freeze({ min: 1, max: 100, fallback: 15 }),
  mod_repetition_window: Object.freeze({ min: 5, max: 300, fallback: 30 }),
  mod_symbol_max_percent: Object.freeze({ min: 10, max: 100, fallback: 50 }),
  mod_follow_age_minutes: Object.freeze({ min: 1, max: 1440, fallback: 10 }),
  mod_raid_protection_duration: Object.freeze({ min: 30, max: 600, fallback: 120 }),
});

function moderationNumber(column, value) {
  const { min, max, fallback } = MODERATION_LIMITS[column];
  return clampInt(value, min, max, fallback);
}

// What the bot does with a message a filter catches: the page's choices and the escalation ladder's steps.
const MODERATION_ACTIONS = Object.freeze(['delete', 'warn', 'timeout_10', 'timeout_60', 'timeout_600', 'timeout_1800']);

function moderationAction(value) {
  return MODERATION_ACTIONS.includes(value) ? value : 'delete';
}
```

and add `MODERATION_LIMITS, moderationNumber, MODERATION_ACTIONS, moderationAction,` to `module.exports`.

- [ ] **Step 4: Run the unit tests**

Run: `node --test src/services/inputLimits.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing route test**

Append to `src/routes/dashboard.test.js`:

```js
// ── The moderation save keeps its numbers in range ───────────────────────

describe('the moderation save keeps its settings in the page\'s ranges', () => {
  test('numbers past a range are brought into it, numbers that are not numbers get the default, an unknown action is delete', async () => {
    const id = addStreamer();
    const res = await request('POST', '/dashboard/chatbot/moderation', { streamer: id, form: {
      mod_link_permit_seconds: '99999', mod_caps_min_length: '-5', mod_caps_max_percent: 'abc',
      mod_emote_max_count: '0', mod_repetition_window: '1000', mod_symbol_max_percent: '5',
      mod_follow_age_minutes: '100000', mod_raid_protection_duration: '1', mod_action_response: 'ban_forever',
    } });
    assert.equal(res.status, 302);
    const row = db.getStreamerById(id);
    assert.deepEqual(
      [row.mod_link_permit_seconds, row.mod_caps_min_length, row.mod_caps_max_percent, row.mod_emote_max_count,
        row.mod_repetition_window, row.mod_symbol_max_percent, row.mod_follow_age_minutes, row.mod_raid_protection_duration],
      [600, 3, 70, 1, 300, 10, 1440, 30],
    );
    assert.equal(row.mod_action_response, 'delete');
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `node --test --test-name-pattern="the moderation save keeps its settings" src/routes/dashboard.test.js`
Expected: FAIL (`99999` stored as is).

- [ ] **Step 7: Use the ranges in the route**

In `src/routes/dashboard.js` add `moderationNumber, moderationAction` to the existing `require('../services/inputLimits')` destructuring (the file already imports `sponsorChatIntervalMinutes` from it), and in `router.post('/chatbot/moderation', …)` replace the eight number lines and the action line with:

```js
    mod_link_permit_seconds: moderationNumber('mod_link_permit_seconds', b.mod_link_permit_seconds),
    mod_caps_min_length: moderationNumber('mod_caps_min_length', b.mod_caps_min_length),
    mod_caps_max_percent: moderationNumber('mod_caps_max_percent', b.mod_caps_max_percent),
    mod_emote_max_count: moderationNumber('mod_emote_max_count', b.mod_emote_max_count),
    mod_repetition_window: moderationNumber('mod_repetition_window', b.mod_repetition_window),
    mod_symbol_max_percent: moderationNumber('mod_symbol_max_percent', b.mod_symbol_max_percent),
    mod_raid_protection_duration: moderationNumber('mod_raid_protection_duration', b.mod_raid_protection_duration),
    mod_follow_age_minutes: moderationNumber('mod_follow_age_minutes', b.mod_follow_age_minutes),
    mod_action_response: moderationAction(b.mod_action_response),
```

(keep every other line of the object, in the same order as today).

- [ ] **Step 8: Run the tests and the suite**

Run: `node --test src/routes/dashboard.test.js` then the full suite.
Expected: PASS.

- [ ] **Step 9: Document and commit**

In `CLAUDE.md`, Chat Moderation bullet, add: "A save keeps the moderation numbers in the page's ranges and the action to one the bot knows (`MODERATION_LIMITS`, `MODERATION_ACTIONS` in `inputLimits.js`)."

```bash
git add src/services/inputLimits.js src/services/inputLimits.test.js src/routes/dashboard.js src/routes/dashboard.test.js CLAUDE.md
git commit -m "fix(moderation): the saved numbers and action stay in their ranges"
```

### Task 5: Spotify can be disconnected; switches read their value strictly

There is no way to disconnect Spotify. And `POST /dashboard/redemptions/settings` reads `cp_rewards_enabled` by truthiness (the string `"0"` turns rewards on) and answers an untranslated error. Add one strict switch reader for this route and the settings route of Task 9.

**Files:**
- Modify: `src/services/inputLimits.js`, `src/services/inputLimits.test.js` (`parseSwitch`)
- Modify: `src/routes/dashboard.js` (new `POST /spotify/disconnect`; `POST /redemptions/settings`)
- Modify: `src/views/dashboard.ejs` (the message banner; the Spotify card's Disconnect button)
- Modify: `src/routes/dashboard.test.js` (new describes)
- Modify: `src/locales/*.json` (keys below)
- Modify: `CLAUDE.md` (Spotify Integration bullet; Channel Point Rewards bullet)

**Interfaces:**
- Produces: `parseSwitch(value) -> 1 | 0 | null` from `inputLimits.js`; `POST /dashboard/spotify/disconnect` (form post → `302 /dashboard?msg=spotify_disconnected`); locale key `dashboard.settings.error.invalid` (reused by Tasks 9–11).

- [ ] **Step 1: Write the failing unit test**

Append to `src/services/inputLimits.test.js`:

```js
describe('parseSwitch', () => {
  const { parseSwitch } = require('./inputLimits');
  test('on and off as forms and JSON send them; anything else is not a switch', () => {
    for (const on of [true, 1, '1', 'true', 'on']) assert.equal(parseSwitch(on), 1, JSON.stringify(on));
    for (const off of [false, 0, '0', 'false', 'off', '']) assert.equal(parseSwitch(off), 0, JSON.stringify(off));
    for (const bad of ['yes', 2, -1, [], {}, null, undefined, 'ON ', '01']) assert.equal(parseSwitch(bad), null, JSON.stringify(bad));
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test src/services/inputLimits.test.js` — Expected: FAIL (`parseSwitch is not a function`).

- [ ] **Step 3: Add `parseSwitch`**

In `src/services/inputLimits.js` above `module.exports`, and export it:

```js
// A switch's value as a form or a JSON body sends it: 1 (true, 1, "1", "true", "on"), 0 (false, 0, "0",
// "false", "off", "") or null for anything else, which is not a switch value.
function parseSwitch(value) {
  if (value === true || value === 1 || value === '1' || value === 'true' || value === 'on') return 1;
  if (value === false || value === 0 || value === '0' || value === 'false' || value === 'off' || value === '') return 0;
  return null;
}
```

- [ ] **Step 4: Write the failing route tests**

Append to `src/routes/dashboard.test.js`:

```js
// ── Spotify disconnect, and the rewards switch ───────────────────────────

describe('disconnecting Spotify', () => {
  test('clears the stored Spotify tokens and says so on the dashboard', async () => {
    const id = addStreamer();
    db.updateSpotifyTokens(id, 'synthetic-access', 'synthetic-refresh', Date.now() + 3600e3);
    const res = await request('POST', '/dashboard/spotify/disconnect', { streamer: id, form: { go: '1' } });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/dashboard?msg=spotify_disconnected');
    const row = db.getStreamerById(id);
    assert.equal(row.spotify_access_token, null);
    assert.equal(row.spotify_refresh_token, null);
    const page = (await request('GET', '/dashboard?msg=spotify_disconnected', { streamer: id })).text;
    assert.ok(page.includes(t('en', 'dashboard.spotifyDisconnected')));
  });

  test('a connected Spotify card has a Disconnect button posting to that route', async () => {
    const id = addStreamer();
    db.updateSpotifyTokens(id, 'synthetic-access', 'synthetic-refresh', Date.now() + 3600e3);
    const page = (await request('GET', '/dashboard', { streamer: id })).text;
    assert.match(page, /<form method="POST" action="\/dashboard\/spotify\/disconnect"/);
  });
});

describe('the channel point rewards switch reads its value strictly', () => {
  test('"0" is off, 1 is on, anything else is refused and changes nothing', async () => {
    const id = addStreamer({ cp_rewards_enabled: 1 });
    const set = (value) => request('POST', '/dashboard/redemptions/settings', { streamer: id, body: { cp_rewards_enabled: value } });
    assert.equal((await set('0')).status, 200);
    assert.equal(db.getStreamerById(id).cp_rewards_enabled, 0);
    assert.equal((await set(1)).status, 200);
    assert.equal(db.getStreamerById(id).cp_rewards_enabled, 1);
    const bad = await set('yes');
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.json(), { ok: false, code: 'invalid', error: t('en', 'dashboard.settings.error.invalid') });
    assert.equal(db.getStreamerById(id).cp_rewards_enabled, 1);
  });
});
```

- [ ] **Step 5: Run them to see them fail**

Run: `node --test --test-name-pattern="disconnecting Spotify|rewards switch reads its value strictly" src/routes/dashboard.test.js`
Expected: FAIL (404 for the disconnect route; `"0"` stored as 1).

- [ ] **Step 6: Add the route, make the rewards switch strict**

In `src/routes/dashboard.js` add `parseSwitch` to the `inputLimits` import. Right after the `router.get('/', …)` dashboard route add:

```js
// Disconnect Spotify (the Spotify card): the stored tokens are cleared, so !song gets no answer until the
// streamer connects again.
router.post('/spotify/disconnect', (req, res) => {
  db.updateSpotifyTokens(req.streamer.id, null, null, null);
  res.redirect('/dashboard?msg=spotify_disconnected');
});
```

and replace `router.post('/redemptions/settings', …)` with:

```js
router.post('/redemptions/settings', (req, res) => {
  const enabled = parseSwitch((req.body || {}).cp_rewards_enabled);
  if (enabled === null) {
    return res.status(400).json({ ok: false, code: 'invalid', error: res.locals.t('dashboard.settings.error.invalid') });
  }
  db.updateOverlayConfig(req.streamer.id, { cp_rewards_enabled: enabled });
  res.json({ ok: true });
});
```

- [ ] **Step 7: The banner and the button**

In `src/views/dashboard.ejs`, below the line `<% if (msg === 'spotify_error') { %>…<% } %>` add:

```ejs
<% if (msg === 'spotify_disconnected') { %><div class="alert alert-success"><%= t('dashboard.spotifyDisconnected') %></div><% } %>
```

In the Spotify card's connected branch, right after the `<a href="/auth/spotify" class="btn btn-secondary" …><%= t('dashboard.cards.spotify.reconnect') %></a>` line, add:

```ejs
        <form method="POST" action="/dashboard/spotify/disconnect" style="margin-top: 8px;">
          <button type="submit" class="btn btn-secondary" style="font-size: 13px; padding: 8px 16px; width: 100%;"><%= t('dashboard.cards.spotify.disconnect') %></button>
        </form>
```

Add to `en.json` (and translated to the six others):

```json
"dashboard.settings.error.invalid": "That can't be saved. Reload the page and try again.",
"dashboard.spotifyDisconnected": "Spotify is disconnected. !song gets no answer until you connect it again.",
"dashboard.cards.spotify.disconnect": "Disconnect"
```

- [ ] **Step 8: Run the tests and the suite**

Run: `node --test src/services/inputLimits.test.js src/routes/dashboard.test.js` then the full suite.
Expected: PASS.

- [ ] **Step 9: Document and commit**

In `CLAUDE.md`: Spotify Integration bullet — "Disconnect Spotify (`POST /dashboard/spotify/disconnect`) clears the stored tokens." Channel Point Rewards bullet — "The switch's route reads its value strictly (`parseSwitch` in `inputLimits.js`: `"0"` is off; anything that is not a switch value answers 400)."

```bash
git add src/services/inputLimits.js src/services/inputLimits.test.js src/routes/dashboard.js src/routes/dashboard.test.js src/views/dashboard.ejs src/locales/en.json src/locales/pt.json src/locales/es.json src/locales/fr.json src/locales/de.json src/locales/zh.json src/locales/ja.json CLAUDE.md
git commit -m "fix(dashboard): Spotify can be disconnected; the rewards switch reads its value strictly"
```

### Release A (controller only — not a subagent task)

- [ ] Full suite green; `git status` clean.
- [ ] `scratchpad/prodcheck/prodexec.sh livecheck.js`: `registeredLive` empty and `openGiveaways` 0, else wait.
- [ ] `git push origin fix/stream-review-2026-10-13:main`; watch `railway deployment list` until the commit is `SUCCESS`; read the boot log (no `[DB migration]`, `Startup error`, `TypeError`); `GET /health` 200; fast-forward the main checkout's `main`.
- [ ] Note the deployment (commit, Railway deployment id) in this plan's SDD ledger.

---

# Phase B — the working cards (Release B)

### Task 6: The overlays come back; the VTuber tab stays hidden

**Files:**
- Modify: `src/config.js` (`features`)
- Modify: `src/config.test.js` (the overlay flag test)
- Modify: `src/routes/dashboard.js` (new `vtuberPage` guard on `GET /vtuber-preview`)
- Modify: `src/views/dashboard.ejs` (the three places that show the Experimental tab)
- Modify: `src/routes/dashboard.test.js` (file header; new describe)
- Modify: `tests/i18nViewsPart1.test.js` (the samples get the VTuber switch with the overlays)
- Modify: `CLAUDE.md` (Feature Flags bullet)

**Interfaces:** Produces: `config.features.overlays === true`, `config.features.vtuber === false` (views see `features.vtuber`).

- [ ] **Step 1: Write the failing tests**

In `src/config.test.js` replace the test `'the OBS overlay features are switched off until features.overlays is set to true in config.js'` with:

```js
test('the OBS overlay features are on; the VTuber tab stays hidden until features.vtuber is set to true in config.js', () => {
  const { features } = loadWith({}).config;
  assert.equal(features.overlays, true);
  assert.equal(features.vtuber, false);
});
```

In `src/routes/dashboard.test.js`, below `require('../config').features.kick = true;` at the top, add:

```js
// The VTuber tab (config.features.vtuber, off by default) is on for the file too; its section turns it off.
require('../config').features.vtuber = true;
```

and append:

```js
// ── The VTuber tab has its own switch (config.features.vtuber) ───────────

describe('with the VTuber tab switched off', () => {
  const { features } = require('../config');
  beforeEach(() => { features.vtuber = false; });
  afterEach(() => { features.vtuber = true; });

  test('the dashboard has no Experimental tab and the preview page sends the streamer back', async () => {
    const id = addStreamer({ overlay_token: 'synthetic-vtuber-token' });
    const page = (await request('GET', '/dashboard', { streamer: id })).text;
    assert.ok(!page.includes('data-tab="experimental"') && !page.includes('id="tab-experimental"'));
    const preview = await request('GET', '/dashboard/vtuber-preview', { streamer: id });
    assert.equal(preview.status, 302);
    assert.equal(preview.headers.location, '/dashboard');
  });

  test('switched on (with the overlays), the tab is back', async () => {
    features.vtuber = true;
    const page = (await request('GET', '/dashboard', { streamer: addStreamer() })).text;
    assert.ok(page.includes('data-tab="experimental"') && page.includes('id="tab-experimental"'));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test src/config.test.js` and `node --test --test-name-pattern="with the VTuber tab switched off" src/routes/dashboard.test.js`
Expected: FAIL (`features.overlays` is false; the Experimental tab shows with `vtuber` off).

- [ ] **Step 3: Flip the flags**

In `src/config.js` replace the `overlays` entry and its comment with:

```js
    // The OBS overlay features: the alert overlay and its settings page, the Overlay Builder,
    // sponsor images and the tip-goal bar on stream, Channel Point Rewards and the giveaway
    // winner card. Off hides every page, card and link that leads to them (routes/dashboard.js
    // and the views); the OBS links themselves keep working.
    overlays: true,
    // The VTuber face tracker: the dashboard's Experimental tab and its preview page, shown only
    // while the overlays are too. Off until its bundled models are back.
    vtuber: false,
```

- [ ] **Step 4: Gate the tab and its preview page on both switches**

In `src/views/dashboard.ejs`:
- `if (features.overlays) _tabs.push('experimental');` → `if (features.overlays && features.vtuber) _tabs.push('experimental');`
- the `<% if (features.overlays) { %>` right above `<button class="tab-btn tab-experimental" data-tab="experimental">` (and its comment line above it) → `<%# The Experimental tab holds only the VTuber face tracker: it has its own switch (features.vtuber). %>` and `<% if (features.overlays && features.vtuber) { %>`
- the `<% if (features.overlays) { %>` right above `<div class="tab-content" id="tab-experimental">` → `<% if (features.overlays && features.vtuber) { %>`

In `src/routes/dashboard.js`, below `function overlayPage(…) {…}`, add:

```js
// The VTuber preview page: only while the VTuber tab is shown (config.features.vtuber, with the overlays).
function vtuberPage(req, res, next) {
  if (config.features.overlays && config.features.vtuber) return next();
  res.redirect('/dashboard');
}
```

and change `router.get('/vtuber-preview', overlayPage, …` to `router.get('/vtuber-preview', vtuberPage, …`.

- [ ] **Step 5: Run the tests and the suite**

`tests/i18nViewsPart1.test.js` renders the dashboard samples with the overlays on and off, and its test "switched on, they ask for the texts about them again" expects the VTuber tab's texts (`dashboard.vtuber.title`, `dashboard.tab.experimental`), which now also need `features.vtuber`. In its `OVERLAY_SWITCH_PAGES` loop give the samples the VTuber switch together with the overlays:

```js
    `${name}, overlay features ${overlays ? 'on' : 'off'}`, { ...data, features: { ...(data.features || { youtube: true }), overlays, vtuber: overlays } },
```

Run: `node --test src/config.test.js src/routes/dashboard.test.js tests/i18nViewsPart1.test.js` then the full suite.
Expected: PASS. (Only `src/config.test.js` relied on the old default of `features.overlays`.)

- [ ] **Step 6: Document and commit**

In `CLAUDE.md`, Feature Flags bullet: `overlays` "(currently `false`)" → "(currently `true`)", and add after the overlays sentence: "`vtuber` (currently `false`) hides the dashboard's Experimental (VTuber) tab and `/dashboard/vtuber-preview` (it redirects), even with the overlays on; its bundled models are missing."

```bash
git add src/config.js src/config.test.js src/routes/dashboard.js src/views/dashboard.ejs src/routes/dashboard.test.js tests/i18nViewsPart1.test.js CLAUDE.md
git commit -m "feat(flags): the overlay features come back; the VTuber tab has its own switch"
```

### Task 7: The overlay switch stops the alerts; the dashboard knows whether the overlay is open in OBS

Today `overlay_enabled` only decides whether the Twitch event connections run; alerts reach an open OBS source either way. With it off, the alert overlay's stream must pass no alert. And the dashboard must be able to say whether the alert overlay is open in OBS right now.

**Files:**
- Create: `src/services/overlayPresence.js`, `src/services/overlayPresence.test.js`
- Modify: `src/db.js` (`isOverlayEnabled`)
- Modify: `src/routes/overlay.js` (`GET /events/:token`)
- Modify: `src/routes/overlay.test.js`
- Modify: `public/overlay/overlay.js` (the stream address only)
- Modify: `src/routes/dashboard.js` (`POST /overlay/test/:eventType`)
- Modify: `src/routes/dashboard.test.js`
- Modify: `src/locales/*.json` (`dashboard.settings.error.overlayOff`)
- Modify: `CLAUDE.md` (OBS Overlay bullet)

**Interfaces:**
- Produces: `overlayPresence.opened(id)`, `.closed(id)`, `.isOpen(id) -> boolean`; `db.isOverlayEnabled(id) -> boolean`; the alert overlay opens `/overlay/events/<token>?source=alerts`; `POST /dashboard/overlay/test/:type` answers `409 { ok: false, code: 'overlay_off', error }` while the overlay is off.

- [ ] **Step 1: Write the failing presence test**

Create `src/services/overlayPresence.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const presence = require('./overlayPresence');

test('a streamer\'s alert overlay is open while at least one of its streams is, never below none', () => {
  assert.equal(presence.isOpen(91), false);
  presence.opened(91);
  presence.opened(91);
  presence.closed(91);
  assert.equal(presence.isOpen(91), true, 'one of two is still open');
  presence.closed(91);
  assert.equal(presence.isOpen(91), false);
  presence.closed(91);
  presence.opened(91);
  assert.equal(presence.isOpen(91), true, 'an extra close does not hide the next open');
  presence.closed(91);
  assert.equal(presence.isOpen(92), false, 'per streamer');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test src/services/overlayPresence.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Write `overlayPresence.js`**

```js
'use strict';

// How many alert overlays (the OBS browser source at /overlay/:token) are open per streamer right now, so
// the dashboard can say whether the overlay is open in OBS. routes/overlay.js counts only the streams that
// say they are the alert overlay (?source=alerts): the iRacing chat overlay reads the same stream.
const open = new Map(); // streamer id -> open streams

function opened(streamerId) {
  open.set(streamerId, (open.get(streamerId) || 0) + 1);
}

function closed(streamerId) {
  const left = (open.get(streamerId) || 0) - 1;
  if (left > 0) open.set(streamerId, left);
  else open.delete(streamerId);
}

function isOpen(streamerId) {
  return (open.get(streamerId) || 0) > 0;
}

module.exports = { opened, closed, isOpen };
```

Run: `node --test src/services/overlayPresence.test.js` — Expected: PASS.

- [ ] **Step 4: Write the failing overlay route tests**

Append to `src/routes/overlay.test.js` (it has `addStreamer`, `openStream`, `until`, `bus`, `db`):

```js
// ── The overlay switch, and whether the overlay is open in OBS ───────────

describe('the overlay switch (overlay_enabled) decides whether alerts reach the alert overlay', () => {
  const ALERTS = ['follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner', 'yt_superchat', 'yt_member', 'yt_giftmember'];
  const OTHERS = ['sponsor', 'redemption', 'config-update', 'clear'];
  const setOverlay = (id, on) => db.db.prepare('UPDATE streamers SET overlay_enabled = ? WHERE id = ?').run(on ? 1 : 0, id);

  test('off: no alert reaches the stream; sponsor images, redemption clips, config updates and clears still do', async () => {
    const { id, token } = addStreamer();
    setOverlay(id, 0);
    const stream = await openStream(`/overlay/events/${token}?source=alerts`);
    for (const type of ALERTS) bus.emit(`overlay:${id}`, { type, data: { username: 'synthetic' } });
    for (const type of OTHERS) bus.emit(`overlay:${id}`, { type });
    await until(() => stream.chunks.join('').includes('"type":"clear"'), 'the clear arrived');
    const text = stream.chunks.join('');
    for (const type of OTHERS) assert.ok(text.includes(`"type":"${type}"`), type);
    for (const type of ALERTS) assert.ok(!text.includes(`"type":"${type}"`), type);
  });

  test('switched on, the next alert gets through at once, with no reconnect', async () => {
    const { id, token } = addStreamer();
    setOverlay(id, 0);
    const stream = await openStream(`/overlay/events/${token}?source=alerts`);
    bus.emit(`overlay:${id}`, { type: 'follow', data: { username: 'beforeSwitch' } });
    setOverlay(id, 1);
    bus.emit(`overlay:${id}`, { type: 'follow', data: { username: 'afterSwitch' } });
    await until(() => stream.chunks.join('').includes('afterSwitch'), 'the alert after the switch arrived');
    assert.ok(!stream.chunks.join('').includes('beforeSwitch'));
  });
});

describe('whether the alert overlay is open in OBS', () => {
  const presence = require('../services/overlayPresence');

  test('counts the streams the alert overlay opens (?source=alerts), not the chat overlay\'s', async () => {
    const { id, token } = addStreamer();
    assert.equal(presence.isOpen(id), false);
    const chat = await openStream(`/overlay/events/${token}`);
    assert.equal(presence.isOpen(id), false, 'the iRacing chat overlay reads the same stream without the marker');
    const alerts = await openStream(`/overlay/events/${token}?source=alerts`);
    assert.equal(presence.isOpen(id), true);
    alerts.request.destroy();
    await until(() => !presence.isOpen(id), 'closing the alert overlay counts it out');
    chat.request.destroy();
  });
});
```

- [ ] **Step 5: Run them to see them fail**

Run: `node --test src/routes/overlay.test.js` — Expected: FAIL (alerts arrive while off; the overlay is never counted open).

- [ ] **Step 6: `db.isOverlayEnabled`**

In `src/db.js`, next to `updateOverlayConfig`, add and export:

```js
// Whether the streamer's alert overlay switch is on. Read for each alert the overlay stream passes, so a
// switch takes effect at once on an open OBS source.
function isOverlayEnabled(streamerId) {
  const row = db.prepare('SELECT overlay_enabled FROM streamers WHERE id = ?').get(streamerId);
  return !!(row && row.overlay_enabled);
}
```

- [ ] **Step 7: Gate the alerts and count the alert overlay in `routes/overlay.js`**

At the top of `src/routes/overlay.js` add `const overlayPresence = require('../services/overlayPresence');` and, above `router.get('/events/:token', …)`:

```js
// The event types the alert overlay draws as an alert. While the streamer's overlay switch is off none of
// them reaches the stream; everything else on it still does (config updates, clears, sponsor images,
// redemption clips, and the chat lines the iRacing chat overlay reads, which twitchChat.js already sends only
// while the switch is on).
const ALERT_TYPES = new Set(['follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner', 'yt_superchat', 'yt_member', 'yt_giftmember']);
```

In the `/events/:token` handler replace the listener and the `req.on('close', …)` block with:

```js
  // Listen for events on the bus
  const listener = (event) => {
    if (event && ALERT_TYPES.has(event.type) && !db.isOverlayEnabled(streamer.id)) return;
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch (e) { /* connection closed */ }
  };

  bus.on(`overlay:${streamer.id}`, listener);
  endStreamWhenAccountDisabled(streamer.id, req, res);
  holdStream(res);

  // The alert overlay names itself (?source=alerts): the dashboard says whether it is open in OBS.
  const isAlertOverlay = req.query.source === 'alerts';
  if (isAlertOverlay) overlayPresence.opened(streamer.id);

  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off(`overlay:${streamer.id}`, listener);
    if (isAlertOverlay) overlayPresence.closed(streamer.id);
  });
```

In `public/overlay/overlay.js` (inside `connectSSE`) change the address only:

```js
  const sseUrl = `/overlay/events/${window.OVERLAY_TOKEN}?source=alerts`;
```

Run: `node --test src/routes/overlay.test.js` — Expected: PASS.

- [ ] **Step 8: Write the failing test-alert test**

Append to `src/routes/dashboard.test.js`:

```js
// ── A test alert while the overlay switch is off ─────────────────────────

describe('a test alert while the overlay switch is off', () => {
  test('says the overlay is off and sends nothing; switched on, the alert goes out', async () => {
    const bus = require('../services/overlayBus');
    const id = addStreamer({ overlay_enabled: 0 });
    const seen = [];
    const listener = (event) => seen.push(event.type);
    bus.on(`overlay:${id}`, listener);
    try {
      const off = await request('POST', '/dashboard/overlay/test/follow', { streamer: id });
      assert.equal(off.status, 409);
      assert.deepEqual(off.json(), { ok: false, code: 'overlay_off', error: t('en', 'dashboard.settings.error.overlayOff') });
      assert.deepEqual(seen, []);
      db.updateOverlayConfig(id, { overlay_enabled: 1 });
      const on = await request('POST', '/dashboard/overlay/test/follow', { streamer: id });
      assert.equal(on.status, 200);
      assert.deepEqual(seen, ['follow']);
    } finally {
      bus.off(`overlay:${id}`, listener);
    }
  });
});
```

Run: `node --test --test-name-pattern="a test alert while the overlay switch is off" src/routes/dashboard.test.js` — Expected: FAIL (200 while off).

- [ ] **Step 9: Refuse a test alert while the overlay is off**

In `src/routes/dashboard.js`, above `router.post('/overlay/test/:eventType', …)`:

```js
// A test alert while the overlay switch is off would not reach the stream (routes/overlay.js): say so instead.
function overlayOn(req, res, next) {
  if (req.streamer.overlay_enabled) return next();
  res.status(409).json({ ok: false, code: 'overlay_off', error: res.locals.t('dashboard.settings.error.overlayOff') });
}
```

and change the route's middleware list to `knownOverlayTestType, overlayOn, limitTests`. Add to `en.json` (and translated to the six others): `"dashboard.settings.error.overlayOff": "The OBS overlay is off. Switch it on to show a test alert."`

- [ ] **Step 10: Run the tests and the suite**

Run: `node --test src/routes/dashboard.test.js src/routes/overlay.test.js` then the full suite.
Expected: PASS. Earlier tests that send overlay test alerts for a streamer whose `overlay_enabled` is 0 now get 409: give those streamers `overlay_enabled: 1` (intended).

- [ ] **Step 11: Document and commit**

In `CLAUDE.md`, OBS Overlay bullet, add: "The overlay switch (`overlay_enabled`) is the alerts' on/off: while it is off the alert overlay's stream passes no alert (`ALERT_TYPES` in `routes/overlay.js`, read per alert with `db.isOverlayEnabled`), so an open OBS source stops at once; config updates, clears, sponsor images, redemption clips and chat lines still pass, and a test alert answers `overlay_off`. The alert overlay opens its stream with `?source=alerts`, and `services/overlayPresence.js` counts those streams, so the dashboard can say whether the overlay is open in OBS."

```bash
git add src/services/overlayPresence.js src/services/overlayPresence.test.js src/db.js src/routes/overlay.js src/routes/overlay.test.js public/overlay/overlay.js src/routes/dashboard.js src/routes/dashboard.test.js src/locales/en.json src/locales/pt.json src/locales/es.json src/locales/fr.json src/locales/de.json src/locales/zh.json src/locales/ja.json CLAUDE.md
git commit -m "feat(overlay): the overlay switch stops the alerts; the dashboard knows when OBS has it open"
```

### Task 8: The dashboard knows whether the bot is a moderator

Twitch tells the bot, when it joins a channel (and when it speaks there), whether it is a moderator there; tmi.js keeps that per channel in `client.userstate['#login']` (cleared when the bot leaves). Read it, and let the dashboard ask again: leaving and joining the channel makes Twitch tell the bot again (tmi.js resolves `join()` after that state has arrived).

**Files:**
- Modify: `src/services/twitchChat.js` (`moderatorStatus`, `recheckModerator`; `isConnected` stops logging)
- Modify: `src/services/twitchChat.test.js` (`FakeTmiClient`, new describe)
- Modify: `src/routes/dashboard.js` (`POST /chatbot/check-moderator`)
- Modify: `src/routes/dashboard.test.js` (`chatStub`, new describe)
- Modify: `CLAUDE.md` (Twitch Chatbot bullet)

**Interfaces:**
- Produces: `chatManager.moderatorStatus(streamerId) -> true | false | null` (null: the bot is not in that channel); `chatManager.recheckModerator(streamerId, { timeoutMs = 5000 }) -> Promise<true | false | null>`; `POST /dashboard/chatbot/check-moderator` → `{ ok: true, moderator }` (behind the shared 5 s test cooldown).

- [ ] **Step 1: Teach the fake client the bot's channel state**

In `src/services/twitchChat.test.js` replace `class FakeTmiClient { … }` with:

```js
let tmiClient = null;
class FakeTmiClient {
  constructor() {
    this.handlers = {};
    this.said = [];
    this.state = 'OPEN'; // what tmi.js reports; a test sets another while the bot is (re)connecting
    // What Twitch tells the bot about itself in each channel it joins (tmi.js keeps it per '#channel').
    this.userstate = {};
    this.modIn = new Set(); // channels where the bot is a moderator
    this.joins = [];
    this.parts = [];
    tmiClient = this;
  }
  on(event, handler) { this.handlers[event] = handler; }
  connect() { return Promise.resolve(); }
  join(channel) {
    this.joins.push(channel);
    this.userstate[`#${channel}`] = { mod: this.modIn.has(channel), 'user-type': this.modIn.has(channel) ? 'mod' : '' };
    return Promise.resolve([`#${channel}`]);
  }
  part(channel) {
    this.parts.push(channel);
    delete this.userstate[`#${channel}`];
    return Promise.resolve([`#${channel}`]);
  }
  say(channel, text) { this.said.push({ channel, text }); return Promise.resolve(); }
  readyState() { return this.state; }
  disconnect() { return Promise.resolve(); }
}
```

- [ ] **Step 2: Write the failing tests**

Append to `src/services/twitchChat.test.js`:

```js
// ── Whether the bot is a moderator (the Chat protection card) ────────────

describe('whether the bot is a moderator in a streamer\'s channel', () => {
  test('is what Twitch said when the bot joined; checking again makes the bot leave and rejoin and reads it fresh', async () => {
    assert.equal(chatManager.moderatorStatus(1), false);
    tmiClient.modIn.add('somestreamer');
    assert.equal(chatManager.moderatorStatus(1), false, 'Twitch tells the bot again only when it joins or speaks');
    assert.equal(await chatManager.recheckModerator(1), true);
    assert.deepEqual(tmiClient.parts, ['somestreamer']);
    assert.equal(chatManager.moderatorStatus(1), true);
    assert.deepEqual(chatManager.getJoinedChannels(), ['somestreamer'], 'the bot is back in the channel');
  });

  test('the streamer\'s own channel badge counts', () => {
    tmiClient.userstate['#somestreamer'] = { mod: false, badges: { broadcaster: '1' } };
    assert.equal(chatManager.moderatorStatus(1), true);
  });

  test('is unknown while the bot is not in the channel; checking again does nothing while the chatbot is off', async () => {
    chatManager.stopForStreamer(1);
    assert.equal(chatManager.moderatorStatus(1), null);
    streamer = streamerRow({ chatbot_enabled: 0 });
    const joins = tmiClient.joins.length;
    assert.equal(await chatManager.recheckModerator(1), null);
    assert.equal(tmiClient.joins.length, joins, 'the bot does not join a chat whose chatbot is off');
  });
});
```

Run: `node --test src/services/twitchChat.test.js` — Expected: FAIL (`chatManager.moderatorStatus is not a function`).

- [ ] **Step 3: Implement**

In `src/services/twitchChat.js`, above `const chatManager = {`, add:

```js
// `promise`, or a rejection after `ms` (the timer is cleared either way).
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
```

Replace `isConnected()` with (no log line on every dashboard load):

```js
  isConnected() {
    return Boolean(client) && client.readyState() === 'OPEN';
  },
```

and add to `chatManager`, after `getJoinedChannels()`:

```js
  // Whether the bot is a moderator in the streamer's channel, as Twitch last told it (when the bot joined the
  // channel or spoke there): true, false, or null while the bot is not in that channel.
  moderatorStatus(streamerId) {
    if (!client) return null;
    const streamer = db.getStreamerById(streamerId);
    const login = streamer && streamer.twitch_username ? streamer.twitch_username.toLowerCase() : null;
    if (!login || channelMap.get(login) !== streamerId) return null;
    const state = client.userstate && client.userstate[`#${login}`];
    if (!state) return null;
    const badges = state.badges || {};
    return state.mod === true || state.mod === '1' || state['user-type'] === 'mod'
      || Object.prototype.hasOwnProperty.call(badges, 'moderator')
      || Object.prototype.hasOwnProperty.call(badges, 'broadcaster');
  },

  // Asks Twitch again (the Chat protection card's Check again): the bot leaves the streamer's channel and
  // joins it again, which makes Twitch tell it its state there. Nothing is posted in chat. Resolves with
  // moderatorStatus(), or null when the chatbot is off or the join does not complete in time.
  async recheckModerator(streamerId, { timeoutMs = 5000 } = {}) {
    if (!client) return null;
    const streamer = db.getStreamerById(streamerId);
    if (!streamer || isStreamerDisabled(streamer) || !streamer.chatbot_enabled || !streamer.twitch_username) return null;
    const login = streamer.twitch_username.toLowerCase();
    try { await client.part(login); } catch (e) { /* the bot was not in it: it joins below */ }
    channelMap.set(login, streamerId);
    try {
      await withTimeout(client.join(login), timeoutMs);
    } catch (e) {
      console.error(`[Chat] Rejoining #${login} failed:`, e.message);
      return null;
    }
    return this.moderatorStatus(streamerId);
  },
```

Run: `node --test src/services/twitchChat.test.js` — Expected: PASS.

- [ ] **Step 4: The route — failing test first**

In `src/routes/dashboard.test.js` add to `chatStub.chatManager`:

```js
    moderatorStatus: () => null,
    recheckModerator: async (id) => { chatCalls.push(['recheck', id]); return true; },
```

and append:

```js
// ── Checking again whether the bot is a moderator ────────────────────────

describe('checking again whether the bot is a moderator', () => {
  test('asks the chat manager and answers what it found', async () => {
    const id = addStreamer({ chatbot_enabled: 1 });
    chatCalls.length = 0;
    const res = await request('POST', '/dashboard/chatbot/check-moderator', { streamer: id, body: {} });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { ok: true, moderator: true });
    assert.deepEqual(chatCalls, [['recheck', id]]);
  });
});
```

Run it — Expected: FAIL (404).

- [ ] **Step 5: Add the route**

In `src/routes/dashboard.js`, next to the other chatbot routes:

```js
// The Chat protection card's Check again: the bot asks Twitch again whether it is a moderator in the
// streamer's channel (it leaves and rejoins it). Shares the test buttons' cooldown: it makes the bot act.
router.post('/chatbot/check-moderator', limitTests, async (req, res) => {
  const { chatManager } = require('../services/twitchChat');
  const moderator = await chatManager.recheckModerator(req.streamer.id);
  res.json({ ok: true, moderator });
});
```

Run: `node --test src/routes/dashboard.test.js` then the full suite — Expected: PASS.

- [ ] **Step 6: Document and commit**

In `CLAUDE.md`, Twitch Chatbot bullet, add: "`chatManager.moderatorStatus(streamerId)` says whether the bot is a moderator in the streamer's channel (what Twitch told it on joining or speaking: true, false, or null while it is not there); `recheckModerator()` (`POST /dashboard/chatbot/check-moderator`) makes it leave and rejoin the channel to ask again, posting nothing."

```bash
git add src/services/twitchChat.js src/services/twitchChat.test.js src/routes/dashboard.js src/routes/dashboard.test.js CLAUDE.md
git commit -m "feat(chat): the dashboard can tell whether the bot is a moderator"
```

### Task 9: The settings table and its single-column writers

**Files:**
- Modify: `src/db.js` (new functions below, exported)
- Create: `src/db.cards.test.js`
- Create: `src/services/dashboardSettings.js`, `src/services/dashboardSettings.test.js`

**Interfaces:**
- Produces (db): `runInTransaction(fn)`; `setGuildSwitch(guildId, streamerId, column, value) -> boolean`; `getOwnWatcher(guildId, streamerId, twitchLogin) -> row | null`; `setWatcherNotify(watcherId, streamerId, column, value) -> boolean`; `setSponsorMessageEnabled(id, streamerId, value) -> boolean`; `setSponsorChatSetting(streamerId, column, value)`.
- Produces (dashboardSettings): `SETTINGS` (frozen table, 57 keys), `ERRORS` (`{ code: { status, text } }`), `BATCH_MAX = 20`, `TEMPLATE_MAX = 500`, `save(streamer, body, { db, followUps }) -> { ok: true, values } | { ok: false, code, status }`. `followUps.run({ before, after, steps })` is called once after a successful write; `steps` is a `Set` of `'connections' | 'overlay' | 'sponsorChat'`.

- [ ] **Step 1: Write the failing db tests**

Create `src/db.cards.test.js`:

```js
'use strict';

// The single-column writers behind the dashboard's working cards, against the real src/db.js on an
// in-memory SQLite database (nothing touches data/bot.db). All ids are synthetic.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const DB_FILE = path.join(__dirname, 'db.js');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

let db;
let counter = 0;

before(() => {
  const origLoad = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
      if (request === './config') return { adminDiscordIds: [] };
    }
    return origLoad(request, parent, isMain);
  };
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try {
    delete require.cache[DB_FILE];
    db = require(DB_FILE);
  } finally {
    console.log = log;
    console.error = error;
    Module._load = origLoad;
  }
});

function addStreamer() {
  const n = ++counter;
  return Number(db.db.prepare('INSERT INTO streamers (discord_user_id, discord_username, twitch_username) VALUES (?, ?, ?)')
    .run(`70000000000000${String(n).padStart(4, '0')}`, `cards${n}`, `cards_streamer_${n}`).lastInsertRowid);
}

describe('a claimed server\'s switches', () => {
  test('change one column of the streamer\'s own server only', () => {
    const a = addStreamer();
    const b = addStreamer();
    db.upsertGuild('600000000000000101', a, 'A');
    db.upsertGuild('600000000000000102', b, 'B');
    assert.equal(db.setGuildSwitch('600000000000000101', a, 'recap_enabled', 1), true);
    assert.equal(db.getGuildConfig('600000000000000101', a).recap_enabled, 1);
    assert.equal(db.setGuildSwitch('600000000000000102', a, 'recap_enabled', 1), false, 'not this streamer\'s server');
    assert.equal(db.getGuildConfig('600000000000000102', b).recap_enabled, 0);
    assert.throws(() => db.setGuildSwitch('600000000000000101', a, 'sub_role_id', 1), /not a server switch/);
  });
});

describe('the watcher row of the streamer\'s own channel', () => {
  test('is found per server, and its go-live and clips switches change without its channels', () => {
    const a = addStreamer();
    const login = db.getStreamerById(a).twitch_username;
    db.upsertGuild('600000000000000201', a, 'One');
    db.upsertGuild('600000000000000202', a, 'Two');
    db.addWatchedChannel('600000000000000201', a, login, '700000000000000001', '700000000000000002', 1, 1);
    db.addWatchedChannel('600000000000000202', a, login, '700000000000000003', null, 1, 0);
    const one = db.getOwnWatcher('600000000000000201', a, login.toUpperCase());
    assert.equal(one.live_channel_id, '700000000000000001');
    assert.equal(db.setWatcherNotify(one.id, a, 'notify_live', 0), true);
    assert.equal(db.getOwnWatcher('600000000000000201', a, login).notify_live, 0);
    assert.equal(db.getOwnWatcher('600000000000000201', a, login).live_channel_id, '700000000000000001', 'the channel stays');
    assert.equal(db.getOwnWatcher('600000000000000202', a, login).notify_live, 1, 'the other server is untouched');
    assert.equal(db.getOwnWatcher('600000000000000299', a, login), null);
    assert.throws(() => db.setWatcherNotify(one.id, a, 'live_channel_id', 1), /not a watcher switch/);
  });
});

describe('sponsor messages and the sponsor chat settings', () => {
  test('a message\'s switch changes only the streamer\'s own message', () => {
    const a = addStreamer();
    const b = addStreamer();
    const id = Number(db.addSponsorMessage(a, 'Partner line', 'https://example.test').lastInsertRowid);
    assert.equal(db.setSponsorMessageEnabled(id, b, 0), false);
    assert.equal(db.setSponsorMessageEnabled(id, a, 0), true);
    const row = db.getSponsorMessages(a).find((m) => m.id === id);
    assert.equal(row.enabled, 0);
    assert.equal(row.url, 'https://example.test', 'the link stays');
  });

  test('the switch and the interval are written one at a time', () => {
    const a = addStreamer();
    db.setSponsorChatSetting(a, 'sponsor_chat_interval_minutes', 15);
    db.setSponsorChatSetting(a, 'sponsor_send_chat', 1);
    db.setSponsorChatSetting(a, 'sponsor_send_chat', 0);
    const row = db.getStreamerById(a);
    assert.equal(row.sponsor_chat_interval_minutes, 15);
    assert.equal(row.sponsor_send_chat, 0);
    assert.throws(() => db.setSponsorChatSetting(a, 'paypal_email', 'x'), /not a sponsor chat setting/);
  });
});

describe('runInTransaction', () => {
  test('writes everything or nothing', () => {
    const a = addStreamer();
    assert.throws(() => db.runInTransaction(() => {
      db.setSponsorChatSetting(a, 'sponsor_chat_interval_minutes', 30);
      throw new Error('stop');
    }), /stop/);
    assert.notEqual(db.getStreamerById(a).sponsor_chat_interval_minutes, 30);
  });
});
```

Run: `node --test src/db.cards.test.js` — Expected: FAIL (`db.setGuildSwitch is not a function`).

- [ ] **Step 2: Add the writers to `src/db.js`**

Add, near the guild and sponsor functions, and export each by name in `module.exports`:

```js
// ─── The dashboard's working cards: one setting at a time ───────────────
// Each writes one column, so a switch on a card never changes another setting.

// Runs fn inside one transaction: all of its writes, or none.
function runInTransaction(fn) {
  return db.transaction(fn)();
}

const GUILD_SWITCH_COLUMNS = new Set(['recap_enabled', 'milestones_enabled', 'weekly_highlights_enabled', 'sub_sync_enabled']);

// One of a claimed server's switches. False when the streamer has no such server.
function setGuildSwitch(guildId, streamerId, column, value) {
  if (!GUILD_SWITCH_COLUMNS.has(column)) throw new Error(`not a server switch: ${column}`);
  return db.prepare(`UPDATE guilds SET ${column} = ? WHERE guild_id = ? AND streamer_id = ?`)
    .run(value ? 1 : 0, guildId, streamerId).changes > 0;
}

// The watcher row of the streamer's own Twitch channel in one of their servers, or null.
function getOwnWatcher(guildId, streamerId, twitchLogin) {
  if (!twitchLogin) return null;
  return db.prepare('SELECT * FROM watched_channels WHERE guild_id = ? AND streamer_id = ? AND twitch_username = ? AND enabled = 1')
    .get(guildId, streamerId, String(twitchLogin).toLowerCase()) || null;
}

const WATCHER_NOTIFY_COLUMNS = new Set(['notify_live', 'notify_clips']);

// A watcher row's go-live or clips switch; its channels stay as they are. False when the row is not theirs.
function setWatcherNotify(watcherId, streamerId, column, value) {
  if (!WATCHER_NOTIFY_COLUMNS.has(column)) throw new Error(`not a watcher switch: ${column}`);
  return db.prepare(`UPDATE watched_channels SET ${column} = ? WHERE id = ? AND streamer_id = ?`)
    .run(value ? 1 : 0, watcherId, streamerId).changes > 0;
}

// A sponsor chat message's switch. False when the message is not theirs.
function setSponsorMessageEnabled(id, streamerId, value) {
  return db.prepare('UPDATE sponsor_messages SET enabled = ? WHERE id = ? AND streamer_id = ?')
    .run(value ? 1 : 0, id, streamerId).changes > 0;
}

const SPONSOR_CHAT_COLUMNS = new Set(['sponsor_send_chat', 'sponsor_chat_interval_minutes']);

// The sponsor chat switch or interval, one at a time (updateSponsorChatSettings writes both).
function setSponsorChatSetting(streamerId, column, value) {
  if (!SPONSOR_CHAT_COLUMNS.has(column)) throw new Error(`not a sponsor chat setting: ${column}`);
  db.prepare(`UPDATE streamers SET ${column} = ? WHERE id = ?`).run(value, streamerId);
}
```

Run: `node --test src/db.cards.test.js src/db.secrets.test.js` — Expected: PASS (the secrets test checks that no new query touches a token column).

- [ ] **Step 3: Write the failing settings tests**

Create `src/services/dashboardSettings.test.js`:

```js
'use strict';

// The settings table behind POST /dashboard/settings, with a fake database: what each key accepts, where it
// is written, what it needs first, and which follow-ups run. All ids are synthetic.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { SETTINGS, ERRORS, BATCH_MAX, save } = require('./dashboardSettings');

const GUILD = '600000000000000001';
const OTHER_GUILD = '600000000000000002';

function fakeDb({ streamer = {}, guilds = {}, watchers = [], sponsorMessages = [] } = {}) {
  const row = { id: 1, chatbot_enabled: 1, overlay_enabled: 0, twitch_username: 'synthetic_streamer', paypal_email: null, ...streamer };
  const writes = [];
  const recordInto = (name) => (id, config) => { writes.push([name, id, config]); Object.assign(row, config); };
  return {
    writes,
    getStreamerById: (id) => (id === row.id ? { ...row } : null),
    getGuildConfig: (guildId, streamerId) => (streamerId === row.id && guilds[guildId] ? { guild_id: guildId, streamer_id: streamerId, ...guilds[guildId] } : null),
    getOwnWatcher: (guildId, streamerId, login) => watchers.find((w) => w.guild_id === guildId && streamerId === row.id && w.twitch_username === String(login).toLowerCase()) || null,
    getSponsorMessages: (streamerId) => (streamerId === row.id ? sponsorMessages : []),
    runInTransaction: (fn) => { writes.push(['transaction']); return fn(); },
    updateChatbotConfig: recordInto('updateChatbotConfig'),
    updateBuiltinCommands: recordInto('updateBuiltinCommands'),
    updateModerationConfig: recordInto('updateModerationConfig'),
    updateOverlayConfig: recordInto('updateOverlayConfig'),
    updateDonationSettings: recordInto('updateDonationSettings'),
    setSponsorChatSetting: (id, column, value) => { writes.push(['setSponsorChatSetting', id, column, value]); row[column] = value; },
    setGuildSwitch: (guildId, id, column, value) => { writes.push(['setGuildSwitch', guildId, id, column, value]); return true; },
    setWatcherNotify: (watcherId, id, column, value) => { writes.push(['setWatcherNotify', watcherId, id, column, value]); return true; },
    setSponsorMessageEnabled: (messageId, id, value) => { writes.push(['setSponsorMessageEnabled', messageId, id, value]); return true; },
  };
}

function run(body, setup = {}) {
  const db = fakeDb(setup);
  const followUps = [];
  const result = save(db.getStreamerById(1), body, { db, followUps: { run: (info) => followUps.push(info) } });
  return { result, writes: db.writes.filter(([name]) => name !== 'transaction'), followUps };
}

describe('the settings a card may save', () => {
  test('are exactly these 57 keys', () => {
    assert.deepEqual(Object.keys(SETTINGS).sort(), [
      'chat_bits_enabled', 'chat_bits_template', 'chat_donation_enabled', 'chat_donation_template',
      'chat_follow_enabled', 'chat_follow_template', 'chat_giftsub_enabled', 'chat_giftsub_template',
      'chat_raid_enabled', 'chat_raid_template', 'chat_sub_enabled', 'chat_sub_template', 'chatbot_enabled',
      'cmd_8ball_enabled', 'cmd_accountage_enabled', 'cmd_coinflip_enabled', 'cmd_followage_enabled',
      'cmd_hug_enabled', 'cmd_love_enabled', 'cmd_quote_enabled', 'cmd_roast_enabled', 'cmd_roll_enabled',
      'cmd_rps_enabled', 'cmd_slap_enabled', 'cmd_subage_enabled', 'cmd_uptime_enabled', 'cp_rewards_enabled',
      'donation_page_enabled', 'milestones_enabled', 'mod_banned_words_enabled', 'mod_caps_enabled',
      'mod_emote_spam_enabled', 'mod_link_protection_enabled', 'mod_repetition_enabled', 'mod_symbol_spam_enabled',
      'notify_clips', 'notify_live', 'overlay_bits_duration', 'overlay_bits_enabled', 'overlay_donation_duration',
      'overlay_donation_enabled', 'overlay_enabled', 'overlay_follow_duration', 'overlay_follow_enabled',
      'overlay_giveaway_duration', 'overlay_giveaway_enabled', 'overlay_raid_duration', 'overlay_raid_enabled',
      'overlay_sub_duration', 'overlay_sub_enabled', 'overlay_volume', 'recap_enabled',
      'sponsor_chat_interval_minutes', 'sponsor_message_enabled', 'sponsor_send_chat', 'sub_sync_enabled',
      'weekly_highlights_enabled',
    ]);
    assert.equal(BATCH_MAX, 20);
    for (const { status, text } of Object.values(ERRORS)) {
      assert.ok([400, 404, 409].includes(status));
      assert.match(text, /^dashboard\.settings\.error\./);
    }
  });
});

describe('a single switch', () => {
  test('is written to its one column and answered as 1 or 0', () => {
    const { result, writes, followUps } = run({ key: 'chat_follow_enabled', value: false });
    assert.deepEqual(result, { ok: true, values: { chat_follow_enabled: 0 } });
    assert.deepEqual(writes, [['updateChatbotConfig', 1, { chat_follow_enabled: 0 }]]);
    assert.equal(followUps.length, 1);
    assert.deepEqual([...followUps[0].steps], []);
  });

  test('accepts the values a switch can have, and refuses every other value with nothing written', () => {
    for (const [value, stored] of [[true, 1], ['1', 1], ['on', 1], [0, 0], ['false', 0], ['', 0]]) {
      assert.deepEqual(run({ key: 'mod_caps_enabled', value }).result.values, { mod_caps_enabled: stored }, JSON.stringify(value));
    }
    for (const value of ['yes', 2, [], {}, null, undefined]) {
      const { result, writes } = run({ key: 'mod_caps_enabled', value });
      assert.deepEqual(result, { ok: false, code: 'invalid', status: 400 }, JSON.stringify(value));
      assert.deepEqual(writes, []);
    }
  });

  test('a key that is not on the list, or no key, is refused', () => {
    for (const body of [{ key: 'paypal_email', value: 'x@example.test' }, { key: '__proto__', value: 1 }, { value: 1 }, null, 'text', { changes: [] }]) {
      assert.deepEqual(run(body).result, { ok: false, code: 'invalid', status: 400 }, JSON.stringify(body));
    }
  });
});

describe('numbers and texts', () => {
  test('an alert\'s seconds are whole seconds in its range (the giveaway winner up to 60)', () => {
    assert.deepEqual(run({ key: 'overlay_follow_duration', value: '12' }).result.values, { overlay_follow_duration: 12 });
    assert.deepEqual(run({ key: 'overlay_giveaway_duration', value: 60 }).result.values, { overlay_giveaway_duration: 60 });
    for (const value of [0, 31, 8.5, '', 'abc']) {
      assert.equal(run({ key: 'overlay_follow_duration', value }).result.code, 'invalid', JSON.stringify(value));
    }
  });

  test('the volume is 0 to 1, the sponsor interval 1 to 1440 minutes', () => {
    assert.deepEqual(run({ key: 'overlay_volume', value: 0.24 }).result.values, { overlay_volume: 0.24 });
    assert.equal(run({ key: 'overlay_volume', value: 1.5 }).result.code, 'invalid');
    assert.deepEqual(run({ key: 'sponsor_chat_interval_minutes', value: 60 }).result.values, { sponsor_chat_interval_minutes: 60 });
    assert.equal(run({ key: 'sponsor_chat_interval_minutes', value: 0 }).result.code, 'invalid');
  });

  test('a thank-you text is trimmed, required and at most 500 characters', () => {
    const { result, writes } = run({ key: 'chat_follow_template', value: '  Thanks {username}!  ' });
    assert.deepEqual(result.values, { chat_follow_template: 'Thanks {username}!' });
    assert.deepEqual(writes, [['updateChatbotConfig', 1, { chat_follow_template: 'Thanks {username}!' }]]);
    assert.deepEqual(run({ key: 'chat_follow_template', value: '   ' }).result, { ok: false, code: 'required', status: 400 });
    assert.deepEqual(run({ key: 'chat_follow_template', value: 'x'.repeat(501) }).result, { ok: false, code: 'too_long', status: 400 });
    assert.equal(run({ key: 'chat_follow_template', value: 7 }).result.code, 'invalid');
  });
});

describe('settings that need something first', () => {
  test('the tip page switches on only with a PayPal email; off always', () => {
    assert.deepEqual(run({ key: 'donation_page_enabled', value: 1 }).result, { ok: false, code: 'no_email', status: 409 });
    assert.deepEqual(run({ key: 'donation_page_enabled', value: 1 }, { streamer: { paypal_email: 'tips@example.test' } }).result.values, { donation_page_enabled: 1 });
    assert.deepEqual(run({ key: 'donation_page_enabled', value: 0 }).result.values, { donation_page_enabled: 0 });
  });

  test('a server switch needs the streamer\'s own server; sub roles also need a role', () => {
    const guilds = { [GUILD]: { sub_role_id: null } };
    assert.deepEqual(run({ key: 'recap_enabled', guildId: OTHER_GUILD, value: 1 }, { guilds }).result, { ok: false, code: 'not_found', status: 404 });
    assert.deepEqual(run({ key: 'recap_enabled', guildId: 'not-an-id', value: 1 }, { guilds }).result.code, 'not_found');
    const ok = run({ key: 'recap_enabled', guildId: GUILD, value: 1 }, { guilds });
    assert.deepEqual(ok.writes, [['setGuildSwitch', GUILD, 1, 'recap_enabled', 1]]);
    assert.deepEqual(run({ key: 'sub_sync_enabled', guildId: GUILD, value: 1 }, { guilds }).result, { ok: false, code: 'no_role', status: 409 });
    const withRole = { [GUILD]: { sub_role_id: '800000000000000001' } };
    assert.deepEqual(run({ key: 'sub_sync_enabled', guildId: GUILD, value: 1 }, { guilds: withRole }).result.values, { sub_sync_enabled: 1 });
  });

  test('go-live and clips change the watcher row of the streamer\'s own channel in that server, and need its channel to switch on', () => {
    const guilds = { [GUILD]: {}, [OTHER_GUILD]: {} };
    const watchers = [
      { id: 31, guild_id: GUILD, twitch_username: 'synthetic_streamer', live_channel_id: '700000000000000001', clips_channel_id: null },
      { id: 32, guild_id: OTHER_GUILD, twitch_username: 'synthetic_streamer', live_channel_id: '700000000000000002', clips_channel_id: null },
    ];
    const live = run({ key: 'notify_live', guildId: GUILD, value: 0 }, { guilds, watchers });
    assert.deepEqual(live.writes, [['setWatcherNotify', 31, 1, 'notify_live', 0]], 'only this server\'s row');
    assert.deepEqual(run({ key: 'notify_clips', guildId: GUILD, value: 1 }, { guilds, watchers }).result, { ok: false, code: 'no_channel', status: 409 });
    const noWatcher = { guilds: { [GUILD]: {} }, watchers: [] };
    assert.deepEqual(run({ key: 'notify_live', guildId: GUILD, value: 1 }, noWatcher).result.code, 'no_channel');
    const offWithout = run({ key: 'notify_live', guildId: GUILD, value: 0 }, noWatcher);
    assert.deepEqual(offWithout.result.values, { notify_live: 0 });
    assert.deepEqual(offWithout.writes, [], 'nothing to switch off');
  });

  test('a sponsor message switch needs the streamer\'s own message', () => {
    const sponsorMessages = [{ id: 5, message_text: 'Partner', enabled: 1 }];
    assert.deepEqual(run({ key: 'sponsor_message_enabled', id: 6, value: 0 }, { sponsorMessages }).result.code, 'not_found');
    const ok = run({ key: 'sponsor_message_enabled', id: 5, value: 0 }, { sponsorMessages });
    assert.deepEqual(ok.writes, [['setSponsorMessageEnabled', 5, 1, 0]]);
    assert.deepEqual([...ok.followUps[0].steps], ['sponsorChat']);
  });
});

describe('batches and follow-ups', () => {
  test('a batch is checked whole before anything is written: one bad change writes nothing', () => {
    const bad = run({ changes: [{ key: 'cmd_uptime_enabled', value: 1 }, { key: 'cmd_roll_enabled', value: 'maybe' }] });
    assert.deepEqual(bad.result, { ok: false, code: 'invalid', status: 400 });
    assert.deepEqual(bad.writes, []);
    const good = run({ changes: [{ key: 'cmd_uptime_enabled', value: 1 }, { key: 'cmd_roll_enabled', value: 0 }] });
    assert.deepEqual(good.result.values, { cmd_uptime_enabled: 1, cmd_roll_enabled: 0 });
    assert.equal(good.followUps.length, 1, 'the follow-ups run once');
    const tooMany = run({ changes: Array.from({ length: BATCH_MAX + 1 }, () => ({ key: 'cmd_uptime_enabled', value: 1 })) });
    assert.equal(tooMany.result.code, 'invalid');
  });

  test('the follow-ups get the row before and after and the steps the keys name', () => {
    const chatbot = run({ key: 'chatbot_enabled', value: 0 });
    assert.equal(chatbot.followUps[0].before.chatbot_enabled, 1);
    assert.equal(chatbot.followUps[0].after.chatbot_enabled, 0);
    assert.deepEqual([...chatbot.followUps[0].steps], ['connections']);
    assert.deepEqual([...run({ key: 'overlay_enabled', value: 1 }).followUps[0].steps].sort(), ['connections', 'overlay']);
    assert.deepEqual([...run({ key: 'overlay_raid_duration', value: 10 }).followUps[0].steps], ['overlay']);
    assert.deepEqual([...run({ key: 'sponsor_chat_interval_minutes', value: 30 }).followUps[0].steps], ['sponsorChat']);
  });
});
```

Run: `node --test src/services/dashboardSettings.test.js` — Expected: FAIL (module not found).

- [ ] **Step 4: Write `src/services/dashboardSettings.js`**

```js
'use strict';

// The settings a dashboard card saves one at a time (POST /dashboard/settings). Only the keys in SETTINGS are
// accepted. Each entry says how its value is read (kind), which database function writes it (writer), what
// `guildId` or `id` names (target), what must be in place to switch it on (needs) and what must follow the
// write (after). The route passes in the database and the follow-ups, so this module is tested without them.

const { parseSwitch, SPONSOR_CHAT_INTERVAL_MINUTES } = require('./inputLimits');
const { DURATIONS } = require('./overlaySettings');

const TEMPLATE_MAX = 500;
const BATCH_MAX = 20;

const THANK_YOUS = ['follow', 'sub', 'giftsub', 'bits', 'donation', 'raid'];
const BUILTINS = ['followage', 'subage', 'uptime', 'accountage', '8ball', 'roll', 'hug', 'slap', 'love', 'rps', 'coinflip', 'quote', 'roast'];
const FILTERS = ['link_protection', 'banned_words', 'caps', 'emote_spam', 'repetition', 'symbol_spam'];
const ALERTS = ['follow', 'sub', 'bits', 'donation', 'raid', 'giveaway'];

const entries = (names, entry) => Object.fromEntries(names.map((name) => [name, Object.freeze({ ...entry })]));

const SETTINGS = Object.freeze({
  chatbot_enabled: Object.freeze({ kind: 'switch', writer: 'chatbot', after: ['connections'] }),
  ...entries(THANK_YOUS.map((e) => `chat_${e}_enabled`), { kind: 'switch', writer: 'chatbot' }),
  ...entries(THANK_YOUS.map((e) => `chat_${e}_template`), { kind: 'text', max: TEMPLATE_MAX, writer: 'chatbot' }),
  ...entries(BUILTINS.map((c) => `cmd_${c}_enabled`), { kind: 'switch', writer: 'builtins' }),
  ...entries(FILTERS.map((f) => `mod_${f}_enabled`), { kind: 'switch', writer: 'moderation' }),
  overlay_enabled: Object.freeze({ kind: 'switch', writer: 'overlay', after: ['connections', 'overlay'] }),
  ...entries(ALERTS.map((a) => `overlay_${a}_enabled`), { kind: 'switch', writer: 'overlay', after: ['overlay'] }),
  ...Object.fromEntries(DURATIONS.map(([column, , longest]) => [column, Object.freeze({ kind: 'int', min: 1, max: longest, writer: 'overlay', after: ['overlay'] })])),
  overlay_volume: Object.freeze({ kind: 'number', min: 0, max: 1, writer: 'overlay', after: ['overlay'] }),
  sponsor_send_chat: Object.freeze({ kind: 'switch', writer: 'sponsorChat', after: ['sponsorChat'] }),
  sponsor_chat_interval_minutes: Object.freeze({ kind: 'int', min: SPONSOR_CHAT_INTERVAL_MINUTES.min, max: SPONSOR_CHAT_INTERVAL_MINUTES.max, writer: 'sponsorChat', after: ['sponsorChat'] }),
  donation_page_enabled: Object.freeze({ kind: 'switch', writer: 'donations', needs: 'paypalEmail' }),
  cp_rewards_enabled: Object.freeze({ kind: 'switch', writer: 'overlay' }),
  recap_enabled: Object.freeze({ kind: 'switch', target: 'guild', writer: 'guild' }),
  milestones_enabled: Object.freeze({ kind: 'switch', target: 'guild', writer: 'guild' }),
  weekly_highlights_enabled: Object.freeze({ kind: 'switch', target: 'guild', writer: 'guild' }),
  sub_sync_enabled: Object.freeze({ kind: 'switch', target: 'guild', writer: 'guild', needs: 'subRole' }),
  notify_live: Object.freeze({ kind: 'switch', target: 'watcher', writer: 'watcher', needs: 'liveChannel' }),
  notify_clips: Object.freeze({ kind: 'switch', target: 'watcher', writer: 'watcher', needs: 'clipsChannel' }),
  sponsor_message_enabled: Object.freeze({ kind: 'switch', target: 'sponsorMessage', writer: 'sponsorMessage', after: ['sponsorChat'] }),
});

// A refusal: its HTTP status and the text the card shows.
const ERRORS = Object.freeze({
  invalid: Object.freeze({ status: 400, text: 'dashboard.settings.error.invalid' }),
  required: Object.freeze({ status: 400, text: 'dashboard.settings.error.required' }),
  too_long: Object.freeze({ status: 400, text: 'dashboard.settings.error.tooLong' }),
  not_found: Object.freeze({ status: 404, text: 'dashboard.settings.error.notFound' }),
  no_email: Object.freeze({ status: 409, text: 'dashboard.settings.error.noEmail' }),
  no_role: Object.freeze({ status: 409, text: 'dashboard.settings.error.noRole' }),
  no_channel: Object.freeze({ status: 409, text: 'dashboard.settings.error.noChannel' }),
});

const fail = (code) => ({ ok: false, code, status: ERRORS[code].status });
const isSnowflake = (value) => typeof value === 'string' && /^\d{17,20}$/.test(value);
const isNumberLike = (raw) => (typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== ''));

// The value a change carries, read as its setting's kind: { value } or { error }.
function readValue(setting, raw) {
  if (setting.kind === 'switch') {
    const value = parseSwitch(raw);
    return value === null ? { error: 'invalid' } : { value };
  }
  if (setting.kind === 'int' || setting.kind === 'number') {
    if (!isNumberLike(raw)) return { error: 'invalid' };
    const n = Number(raw);
    if (!Number.isFinite(n) || n < setting.min || n > setting.max) return { error: 'invalid' };
    if (setting.kind === 'int' && !Number.isInteger(n)) return { error: 'invalid' };
    return { value: n };
  }
  if (typeof raw !== 'string') return { error: 'invalid' };
  const text = raw.trim();
  if (!text) return { error: 'required' };
  if (text.length > setting.max) return { error: 'too_long' };
  return { value: text };
}

// What `guildId` or `id` names, looked up with the streamer's id: { target } or { error }.
function findTarget(setting, change, streamer, db) {
  if (!setting.target) return { target: null };
  if (setting.target === 'sponsorMessage') {
    const id = Number(change.id);
    const message = Number.isInteger(id) && id > 0 ? db.getSponsorMessages(streamer.id).find((m) => m.id === id) : null;
    return message ? { target: message } : { error: 'not_found' };
  }
  const guild = isSnowflake(change.guildId) ? db.getGuildConfig(change.guildId, streamer.id) : null;
  if (!guild) return { error: 'not_found' };
  if (setting.target === 'guild') return { target: guild };
  return { target: { guild, watcher: db.getOwnWatcher(change.guildId, streamer.id, streamer.twitch_username) } };
}

// What is missing to switch a setting on (switching off never needs anything): an error code, or null.
function missingFirst(setting, value, streamer, target) {
  if (!value || !setting.needs) return null;
  if (setting.needs === 'paypalEmail') return streamer.paypal_email ? null : 'no_email';
  if (setting.needs === 'subRole') return target.sub_role_id ? null : 'no_role';
  const watcher = target.watcher;
  if (setting.needs === 'liveChannel') return watcher && watcher.live_channel_id ? null : 'no_channel';
  return watcher && watcher.clips_channel_id ? null : 'no_channel';
}

function write(db, streamerId, key, setting, value, target) {
  switch (setting.writer) {
    case 'chatbot': return db.updateChatbotConfig(streamerId, { [key]: value });
    case 'builtins': return db.updateBuiltinCommands(streamerId, { [key]: value });
    case 'moderation': return db.updateModerationConfig(streamerId, { [key]: value });
    case 'overlay': return db.updateOverlayConfig(streamerId, { [key]: value });
    case 'donations': return db.updateDonationSettings(streamerId, { [key]: value });
    case 'sponsorChat': return db.setSponsorChatSetting(streamerId, key, value);
    case 'guild': return db.setGuildSwitch(target.guild_id, streamerId, key, value);
    case 'watcher': return target.watcher ? db.setWatcherNotify(target.watcher.id, streamerId, key, value) : null;
    case 'sponsorMessage': return db.setSponsorMessageEnabled(target.id, streamerId, value);
    default: throw new Error(`no writer for ${key}`);
  }
}

// `body` is one change ({ key, value, guildId?, id? }) or { changes: [...] } (at most BATCH_MAX). Every
// change is read and checked before any is written; then all are written in one transaction, and the
// follow-ups run once with the streamer's row before and after and the steps the keys name.
function save(streamer, body, { db, followUps }) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  const list = input && Array.isArray(input.changes) ? input.changes : (input && 'key' in input ? [input] : null);
  if (!list || list.length === 0 || list.length > BATCH_MAX) return fail('invalid');

  const plan = [];
  for (const change of list) {
    if (!change || typeof change !== 'object' || typeof change.key !== 'string'
      || !Object.prototype.hasOwnProperty.call(SETTINGS, change.key)) return fail('invalid');
    const setting = SETTINGS[change.key];
    const read = readValue(setting, change.value);
    if (read.error) return fail(read.error);
    const found = findTarget(setting, change, streamer, db);
    if (found.error) return fail(found.error);
    const missing = missingFirst(setting, read.value, streamer, found.target);
    if (missing) return fail(missing);
    plan.push({ key: change.key, setting, value: read.value, target: found.target });
  }

  db.runInTransaction(() => {
    for (const p of plan) write(db, streamer.id, p.key, p.setting, p.value, p.target);
  });
  const steps = new Set(plan.flatMap((p) => p.setting.after || []));
  followUps.run({ before: streamer, after: db.getStreamerById(streamer.id), steps });
  return { ok: true, values: Object.fromEntries(plan.map((p) => [p.key, p.value])) };
}

module.exports = { SETTINGS, ERRORS, BATCH_MAX, TEMPLATE_MAX, save };
```

- [ ] **Step 5: Run the tests**

Run: `node --test src/services/dashboardSettings.test.js src/db.cards.test.js` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db.js src/db.cards.test.js src/services/dashboardSettings.js src/services/dashboardSettings.test.js
git commit -m "feat(dashboard): the settings table and single-column writers for the working cards"
```

### Task 10: `POST /dashboard/settings`

**Files:**
- Modify: `src/routes/dashboard.js` (the route and `runSettingFollowUps`)
- Modify: `src/routes/dashboard.test.js` (new describe)
- Modify: `src/locales/*.json` (the error texts below)
- Modify: `CLAUDE.md` (Dashboard bullet)

**Interfaces:**
- Consumes: `dashboardSettings.save`, `ERRORS` (Task 9); `syncLiveConnections`, `pushOverlayConfig` (in `dashboard.js`).
- Produces: `POST /dashboard/settings` — JSON in, `{ ok: true, value }` for one change, `{ ok: true, values }` for `{ changes }`, `{ ok: false, code, error }` with the status from `ERRORS`.

- [ ] **Step 1: Add the texts**

Add to `en.json` (and translated to the six others):

```json
"dashboard.settings.error.required": "Type something first.",
"dashboard.settings.error.tooLong": "That's too long: at most 500 characters.",
"dashboard.settings.error.notFound": "That isn't there any more. Reload the page.",
"dashboard.settings.error.noEmail": "Add your PayPal email first: tips go straight to it.",
"dashboard.settings.error.noRole": "Pick the role for your subs first, on the server page.",
"dashboard.settings.error.noChannel": "Pick a Discord channel for it first, on the server page."
```

- [ ] **Step 2: Write the failing route tests**

Append to `src/routes/dashboard.test.js`:

```js
// ── POST /dashboard/settings (the working cards' switches) ───────────────

describe('a working card\'s switch (POST /dashboard/settings)', () => {
  const save = (id, body) => request('POST', '/dashboard/settings', { streamer: id, body });

  test('saves one column at once and answers what it saved; the other settings stay', async () => {
    const id = addStreamer({ chat_follow_enabled: 1, chat_follow_template: 'Keep me, {username}' });
    const res = await save(id, { key: 'chat_follow_enabled', value: false });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { ok: true, value: 0 });
    const row = db.getStreamerById(id);
    assert.equal(row.chat_follow_enabled, 0);
    assert.equal(row.chat_follow_template, 'Keep me, {username}');
  });

  test('switching the chatbot off and on leaves and joins chat and stops and starts the connections', async () => {
    const id = addStreamer({ chatbot_enabled: 1, overlay_enabled: 0, twitch_username: 'synthetic_card_bot', broadcaster_access_token: 'tok' });
    await save(id, { key: 'chatbot_enabled', value: 0 });
    assert.deepEqual(managerCalls, [['chat.stop', id], ['eventsub.stop', id], ['se.stop', id]]);
    assert.deepEqual(sponsorCalls, [['sponsors.stop', id]]);
    managerCalls.length = 0;
    sponsorCalls.length = 0;
    await save(id, { key: 'chatbot_enabled', value: 1 });
    assert.deepEqual(managerCalls, [['chat.start', id], ['eventsub.start', id]]);
    assert.deepEqual(sponsorCalls, [['sponsors.restart', id], ['sponsors.restartChat', id]]);
  });

  test('an overlay setting reaches an open overlay at once', async () => {
    const bus = require('../services/overlayBus');
    const id = addStreamer({ overlay_enabled: 1 });
    const seen = [];
    const listener = (event) => seen.push(event);
    bus.on(`overlay:${id}`, listener);
    try {
      await save(id, { key: 'overlay_follow_duration', value: 15 });
    } finally {
      bus.off(`overlay:${id}`, listener);
    }
    assert.equal(seen.length, 1);
    assert.equal(seen[0].type, 'config-update');
    assert.equal(db.getStreamerById(id).overlay_follow_duration, 15);
  });

  test('a key that is not on the list, or a value it cannot have, is refused with the reason and nothing changes', async () => {
    const id = addStreamer({ paypal_email: 'kept@example.test' });
    for (const body of [{ key: 'paypal_email', value: 'x@example.test' }, { key: 'overlay_follow_duration', value: 99 }, { key: 'mod_caps_enabled', value: 'maybe' }]) {
      const res = await save(id, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(res.json(), { ok: false, code: 'invalid', error: t('en', 'dashboard.settings.error.invalid') });
    }
    assert.equal(db.getStreamerById(id).paypal_email, 'kept@example.test');
  });

  test('the tip page needs a PayPal email to switch on', async () => {
    const id = addStreamer({ paypal_email: null, donation_page_enabled: 0 });
    const res = await save(id, { key: 'donation_page_enabled', value: 1 });
    assert.equal(res.status, 409);
    assert.deepEqual(res.json(), { ok: false, code: 'no_email', error: t('en', 'dashboard.settings.error.noEmail') });
    assert.equal(db.getStreamerById(id).donation_page_enabled, 0);
  });

  test('a server switch changes the streamer\'s own server; another streamer\'s answers 404', async () => {
    const id = addStreamer();
    const other = addStreamer();
    db.upsertGuild('600000000000000401', id, 'Mine');
    db.upsertGuild('600000000000000402', other, 'Theirs');
    assert.equal((await save(id, { key: 'recap_enabled', guildId: '600000000000000401', value: 1 })).status, 200);
    assert.equal(db.getGuildConfig('600000000000000401', id).recap_enabled, 1);
    const theirs = await save(id, { key: 'recap_enabled', guildId: '600000000000000402', value: 1 });
    assert.equal(theirs.status, 404);
    assert.equal(db.getGuildConfig('600000000000000402', other).recap_enabled, 0);
  });

  test('go-live in one server leaves the same channel\'s row in the streamer\'s other server alone', async () => {
    const id = addStreamer({ twitch_username: 'synthetic_two_servers' });
    for (const [guildId, channelId] of [['600000000000000501', '700000000000000501'], ['600000000000000502', '700000000000000502']]) {
      db.upsertGuild(guildId, id, 'Server');
      db.addWatchedChannel(guildId, id, 'synthetic_two_servers', channelId, null, 1, 0);
    }
    assert.equal((await save(id, { key: 'notify_live', guildId: '600000000000000501', value: 0 })).status, 200);
    assert.equal(db.getOwnWatcher('600000000000000501', id, 'synthetic_two_servers').notify_live, 0);
    assert.equal(db.getOwnWatcher('600000000000000502', id, 'synthetic_two_servers').notify_live, 1);
    const clips = await save(id, { key: 'notify_clips', guildId: '600000000000000501', value: 1 });
    assert.equal(clips.status, 409);
    assert.equal(clips.json().code, 'no_channel');
  });

  test('a batch is all or nothing and answers every value', async () => {
    const id = addStreamer({ cmd_uptime_enabled: 0, cmd_roll_enabled: 1 });
    const bad = await save(id, { changes: [{ key: 'cmd_uptime_enabled', value: 1 }, { key: 'cmd_roll_enabled', value: 'nope' }] });
    assert.equal(bad.status, 400);
    assert.equal(db.getStreamerById(id).cmd_uptime_enabled, 0, 'nothing was written');
    const good = await save(id, { changes: [{ key: 'cmd_uptime_enabled', value: 1 }, { key: 'cmd_roll_enabled', value: 0 }] });
    assert.deepEqual(good.json(), { ok: true, values: { cmd_uptime_enabled: 1, cmd_roll_enabled: 0 } });
  });

  test('a sponsor message switch changes the streamer\'s own message and restarts the rotation', async () => {
    const id = addStreamer();
    const other = addStreamer();
    const mine = Number(db.addSponsorMessage(id, 'Mine', null).lastInsertRowid);
    const theirs = Number(db.addSponsorMessage(other, 'Theirs', null).lastInsertRowid);
    assert.equal((await save(id, { key: 'sponsor_message_enabled', id: theirs, value: 0 })).status, 404);
    assert.equal((await save(id, { key: 'sponsor_message_enabled', id: mine, value: 0 })).status, 200);
    assert.equal(db.getSponsorMessages(id)[0].enabled, 0);
    assert.deepEqual(sponsorCalls, [['sponsors.restartChat', id]]);
  });

  test('a logged-out request changes nothing', async () => {
    const id = addStreamer({ chat_follow_enabled: 1 });
    const res = await request('POST', '/dashboard/settings', { body: { key: 'chat_follow_enabled', value: 0 } });
    assert.notEqual(res.status, 200);
    assert.equal(db.getStreamerById(id).chat_follow_enabled, 1);
  });

  test('a disabled account changes nothing', async () => {
    const id = addStreamer({ enabled: 0, chat_follow_enabled: 1 });
    const res = await save(id, { key: 'chat_follow_enabled', value: 0 });
    assert.equal(res.status, 403);
    assert.equal(db.getStreamerById(id).chat_follow_enabled, 1);
  });

  test('with a real session, a save without the page\'s CSRF token is refused; with it, it saves', async () => {
    const id = addStreamer({ chat_follow_enabled: 1 });
    const sid = `synthetic-session-settings-${id}`;
    db.createSession(sid, id, Date.now() + 60_000);
    const cookie = `session=${sid}`;
    const page = await request('GET', '/dashboard/chatbot', { cookie });
    const token = page.text.match(/<script src="\/js\/csrf\.js" data-csrf-token="([A-Za-z0-9_-]+)"><\/script>/)[1];
    const refused = await request('POST', '/dashboard/settings', { cookie, fetchMode: 'cors', body: { key: 'chat_follow_enabled', value: 0 } });
    assert.equal(refused.status, 403);
    assert.equal(db.getStreamerById(id).chat_follow_enabled, 1);
    const saved = await request('POST', '/dashboard/settings', { cookie, csrf: token, body: { key: 'chat_follow_enabled', value: 0 } });
    assert.equal(saved.status, 200);
    assert.equal(db.getStreamerById(id).chat_follow_enabled, 0);
  });
});
```

Run: `node --test --test-name-pattern="a working card's switch" src/routes/dashboard.test.js` — Expected: FAIL (404).

- [ ] **Step 3: Add the route**

In `src/routes/dashboard.js` add `const dashboardSettings = require('../services/dashboardSettings');` with the other requires, and after `pushOverlayConfig`:

```js
// What follows a working card's save (POST /dashboard/settings), once per save: the chat bot joins or leaves
// the channel, the Twitch event connections start or stop (needed while the overlay or the chatbot is on),
// an open OBS overlay gets the new settings, the sponsor chat rotation restarts.
function runSettingFollowUps({ before, after, steps }) {
  const id = after.id;
  if (steps.has('connections')) {
    if (!!before.chatbot_enabled !== !!after.chatbot_enabled) {
      try {
        const { chatManager } = require('../services/twitchChat');
        if (after.chatbot_enabled) chatManager.startForStreamer(id);
        else chatManager.stopForStreamer(id);
      } catch (e) {
        console.error('[Dashboard] Chatbot start/stop error:', e.message);
      }
    }
    const wasNeeded = !!(before.overlay_enabled || before.chatbot_enabled);
    const needed = !!(after.overlay_enabled || after.chatbot_enabled);
    if (wasNeeded !== needed) syncLiveConnections(id, { wasNeeded, needed, streamElementsJwt: after.streamelements_jwt });
  }
  if (steps.has('overlay')) pushOverlayConfig(id);
  if (steps.has('sponsorChat')) {
    try {
      const { timedNotificationManager } = require('../services/timedNotifications');
      timedNotificationManager.restartChatForStreamer(id);
    } catch (e) {
      console.error('[Dashboard] Sponsor chat restart failed:', e.message);
    }
  }
}

// A working card's switch, number or short text, saved as it changes: one setting, or a few at once
// ({ changes }). services/dashboardSettings.js lists what may be saved and checks it.
router.post('/settings', (req, res) => {
  const result = dashboardSettings.save(req.streamer, req.body, { db, followUps: { run: runSettingFollowUps } });
  if (!result.ok) {
    return res.status(result.status).json({ ok: false, code: result.code, error: res.locals.t(dashboardSettings.ERRORS[result.code].text) });
  }
  if (Array.isArray((req.body || {}).changes)) return res.json({ ok: true, values: result.values });
  const [value] = Object.values(result.values);
  res.json({ ok: true, value });
});
```

- [ ] **Step 4: Run the tests and the suite**

Run: `node --test src/routes/dashboard.test.js` then the full suite — Expected: PASS.

- [ ] **Step 5: Document and commit**

In `CLAUDE.md`, Dashboard bullet, add: "The working cards save single settings with `POST /dashboard/settings` (JSON `{ key, value, guildId?, id? }` or `{ changes: [...] }`, at most 20, all or nothing): `services/dashboardSettings.js` lists the 57 keys it accepts, how each is read, the single-column writer, what it needs first (`no_email`, `no_role`, `no_channel`) and what follows (`runSettingFollowUps` in `routes/dashboard.js`)."

```bash
git add src/routes/dashboard.js src/routes/dashboard.test.js src/locales/en.json src/locales/pt.json src/locales/es.json src/locales/fr.json src/locales/de.json src/locales/zh.json src/locales/ja.json CLAUDE.md
git commit -m "feat(dashboard): POST /dashboard/settings saves a card's switch as it changes"
```

### Task 11: The text routes: commands, sponsor messages, tip goal

**Files:**
- Modify: `src/services/chatCommands.js` (`COMMANDS_PER_STREAMER_MAX = 100`)
- Modify: `src/db.js` (`getChatCommandById`, `countChatCommands`, `deleteChatCommand` returns a boolean, `updateSponsorMessageFields`)
- Modify: `src/routes/dashboard.js` (`/api/commands`, `/sponsor-messages/:id/update`, `/sponsor-messages/add`, `/api/tip-goal`)
- Modify: `src/routes/dashboard.test.js`
- Modify: `src/locales/*.json` (`chatbot.commands.error.tooMany`)
- Modify: `CLAUDE.md` (Twitch Chatbot, Sponsor Rotation, Tip Goals bullets)

**Interfaces:**
- Produces: `POST /dashboard/api/commands` (`{ command, response, cooldown }` → `201 { ok, command }`), `PATCH /dashboard/api/commands/:id` (any of the three → `{ ok, command }`), `DELETE /dashboard/api/commands/:id` (`{ ok }`); refusals `{ ok: false, code, error }` with `name_invalid`/`response_required`/`response_too_long` (400), `duplicate`/`too_many` (409), `not_found` (404). `POST /dashboard/sponsor-messages/:id/update` changes only the fields it is given. `POST /dashboard/api/tip-goal` (`{ title, target_amount }` → `201 { ok, goal }`), `PATCH /dashboard/api/tip-goal` (→ `{ ok, goal }`), `POST /dashboard/api/tip-goal/end` (→ `{ ok }`); refusals `title_required`/`target_invalid` (400), `not_found` (404).

- [ ] **Step 1: Write the failing tests**

Append to `src/routes/dashboard.test.js`:

```js
// ── The working cards' text routes ───────────────────────────────────────

describe('the Commands card (JSON)', () => {
  const add = (id, body) => request('POST', '/dashboard/api/commands', { streamer: id, body });

  test('adds, edits and deletes the streamer\'s own commands with the chatbot page\'s rules', async () => {
    const id = addStreamer();
    const added = await add(id, { command: '!Discord', response: 'Join us', cooldown: 10 });
    assert.equal(added.status, 201);
    const command = added.json().command;
    assert.equal(command.command, 'discord');
    assert.equal(command.cooldown, 10);

    const edited = await request('PATCH', `/dashboard/api/commands/${command.id}`, { streamer: id, body: { response: 'Join our Discord' } });
    assert.equal(edited.status, 200);
    assert.equal(edited.json().command.command, 'discord', 'the name stays');
    assert.equal(edited.json().command.response, 'Join our Discord');

    const other = addStreamer();
    assert.equal((await request('PATCH', `/dashboard/api/commands/${command.id}`, { streamer: other, body: { response: 'x' } })).status, 404);
    assert.equal((await request('DELETE', `/dashboard/api/commands/${command.id}`, { streamer: other })).status, 404);
    assert.equal((await request('DELETE', `/dashboard/api/commands/${command.id}`, { streamer: id })).status, 200);
    assert.equal((await request('DELETE', `/dashboard/api/commands/${command.id}`, { streamer: id })).status, 404);
  });

  test('a bad name, a name in use and the 101st command are refused with their reason', async () => {
    const id = addStreamer();
    const bad = await add(id, { command: 'two words', response: 'x' });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.json(), { ok: false, code: 'name_invalid', error: t('en', 'chatbot.commands.error.nameInvalid') });
    assert.equal((await add(id, { command: 'socials', response: 'x' })).status, 201);
    const dup = await add(id, { command: 'socials', response: 'y' });
    assert.equal(dup.status, 409);
    assert.equal(dup.json().code, 'duplicate');
    for (let i = db.countChatCommands(id); i < 100; i++) db.addChatCommand(id, `cmd${i}`, 'x', 5);
    const tooMany = await add(id, { command: 'onemore', response: 'x' });
    assert.equal(tooMany.status, 409);
    assert.deepEqual(tooMany.json(), { ok: false, code: 'too_many', error: t('en', 'chatbot.commands.error.tooMany', { max: 100 }) });
  });
});

describe('a sponsor message edit changes only what it is given', () => {
  test('switching a message off keeps its text and link; an empty text is refused; another streamer\'s answers 404', async () => {
    const id = addStreamer();
    const msg = Number(db.addSponsorMessage(id, 'Partner line', 'https://example.test').lastInsertRowid);
    const update = (streamerId, body) => request('POST', `/dashboard/sponsor-messages/${msg}/update`, { streamer: streamerId, body });
    assert.equal((await update(id, { enabled: 0 })).status, 200);
    let row = db.getSponsorMessages(id)[0];
    assert.deepEqual([row.message_text, row.url, row.enabled], ['Partner line', 'https://example.test', 0]);
    assert.equal((await update(id, { message_text: 'New line' })).status, 200);
    row = db.getSponsorMessages(id)[0];
    assert.deepEqual([row.message_text, row.url, row.enabled], ['New line', 'https://example.test', 0]);
    const empty = await update(id, { message_text: '   ' });
    assert.equal(empty.status, 400);
    assert.equal(empty.json().code, 'required');
    assert.equal((await update(addStreamer(), { enabled: 1 })).status, 404);
  });
});

describe('the Donations card\'s tip goal (JSON)', () => {
  test('starts a goal in the tip page\'s currency, edits it keeping its bar colour, and ends it', async () => {
    const bus = require('../services/overlayBus');
    const id = addStreamer({ donation_currency: 'USD' });
    const told = [];
    const listener = () => told.push('goal');
    bus.on(`tipgoal:${id}`, listener);
    try {
      const started = await request('POST', '/dashboard/api/tip-goal', { streamer: id, body: { title: 'New wheel', target_amount: 500 } });
      assert.equal(started.status, 201);
      assert.equal(started.json().goal.currency, 'USD');
      db.db.prepare('UPDATE tip_goals SET bar_color = ? WHERE streamer_id = ?').run('#ff0000', id);
      const edited = await request('PATCH', '/dashboard/api/tip-goal', { streamer: id, body: { target_amount: 750 } });
      assert.equal(edited.status, 200);
      assert.equal(edited.json().goal.target_amount, 750);
      assert.equal(edited.json().goal.title, 'New wheel');
      assert.equal(edited.json().goal.bar_color, '#ff0000');
      const bad = await request('PATCH', '/dashboard/api/tip-goal', { streamer: id, body: { title: '' } });
      assert.equal(bad.status, 400);
      assert.equal(bad.json().code, 'title_required');
      assert.equal((await request('POST', '/dashboard/api/tip-goal/end', { streamer: id, body: {} })).status, 200);
      assert.equal(db.getActiveTipGoal(id), null);
      assert.equal((await request('POST', '/dashboard/api/tip-goal/end', { streamer: id, body: {} })).status, 404);
    } finally {
      bus.off(`tipgoal:${id}`, listener);
    }
    assert.equal(told.length, 3, 'the goal bar is told after the start, the edit and the end');
  });
});
```

Run: `node --test --test-name-pattern="Commands card|sponsor message edit|tip goal \\(JSON\\)" src/routes/dashboard.test.js` — Expected: FAIL (404s; the URL is cleared).

- [ ] **Step 2: The limit and the db helpers**

In `src/services/chatCommands.js` add and export `const COMMANDS_PER_STREAMER_MAX = 100; // custom commands one streamer may have`.

In `src/db.js` (export each):

```js
function getChatCommandById(id, streamerId) {
  return db.prepare('SELECT * FROM chat_commands WHERE id = ? AND streamer_id = ?').get(id, streamerId) || null;
}

function countChatCommands(streamerId) {
  return db.prepare('SELECT COUNT(*) AS n FROM chat_commands WHERE streamer_id = ?').get(streamerId).n;
}

// A sponsor message's text and link: only the ones given (undefined leaves one as it is). False when the
// message is not the streamer's.
function updateSponsorMessageFields(id, streamerId, { message_text, url } = {}) {
  const fields = [];
  const values = [];
  if (message_text !== undefined) { fields.push('message_text = ?'); values.push(message_text); }
  if (url !== undefined) { fields.push('url = ?'); values.push(url || null); }
  if (fields.length === 0) return !!db.prepare('SELECT 1 FROM sponsor_messages WHERE id = ? AND streamer_id = ?').get(id, streamerId);
  return db.prepare(`UPDATE sponsor_messages SET ${fields.join(', ')} WHERE id = ? AND streamer_id = ?`).run(...values, id, streamerId).changes > 0;
}
```

and change `deleteChatCommand` to `return db.prepare('DELETE FROM chat_commands WHERE id = ? AND streamer_id = ?').run(id, streamerId).changes > 0;` (its form route ignores the result).

- [ ] **Step 3: The routes**

In `src/routes/dashboard.js` (import `COMMAND_ERRORS`, `COMMAND_RESPONSE_MAX`, `COMMANDS_PER_STREAMER_MAX`, `parseCommand`, `isUniqueViolation` from `../services/chatCommands` if not imported yet; `parseTipGoalFields`, `GOAL_ERRORS`, `errorMessage`, `TIP_GOAL_CURRENCIES` are already imported for the donations page — reuse them):

```js
// ── The working cards' text routes (JSON) ──

// A Commands card refusal: the chatbot page's texts, plus the limit and a command that is not there.
function commandJsonError(res, status, code) {
  const key = code === 'not_found' ? 'dashboard.settings.error.notFound'
    : code === 'too_many' ? 'chatbot.commands.error.tooMany'
      : COMMAND_ERRORS[code];
  const max = code === 'too_many' ? COMMANDS_PER_STREAMER_MAX : COMMAND_RESPONSE_MAX;
  res.status(status).json({ ok: false, code, error: res.locals.t(key, { max }) });
}

router.post('/api/commands', (req, res) => {
  const parsed = parseCommand(req.body);
  if (parsed.error) return commandJsonError(res, 400, parsed.error);
  if (db.countChatCommands(req.streamer.id) >= COMMANDS_PER_STREAMER_MAX) return commandJsonError(res, 409, 'too_many');
  try {
    const info = db.addChatCommand(req.streamer.id, parsed.command, parsed.response, parsed.cooldown);
    res.status(201).json({ ok: true, command: db.getChatCommandById(Number(info.lastInsertRowid), req.streamer.id) });
  } catch (e) {
    if (isUniqueViolation(e)) return commandJsonError(res, 409, 'duplicate');
    throw e;
  }
});

router.patch('/api/commands/:id', (req, res) => {
  const row = db.getChatCommandById(Number(req.params.id), req.streamer.id);
  if (!row) return commandJsonError(res, 404, 'not_found');
  const b = req.body || {};
  const parsed = parseCommand({
    command: b.command !== undefined ? b.command : row.command,
    response: b.response !== undefined ? b.response : row.response,
    cooldown: b.cooldown !== undefined ? b.cooldown : row.cooldown,
  });
  if (parsed.error) return commandJsonError(res, 400, parsed.error);
  try {
    db.updateChatCommand(row.id, req.streamer.id, parsed.command, parsed.response, row.enabled, parsed.cooldown);
  } catch (e) {
    if (isUniqueViolation(e)) return commandJsonError(res, 409, 'duplicate');
    throw e;
  }
  res.json({ ok: true, command: db.getChatCommandById(row.id, req.streamer.id) });
});

router.delete('/api/commands/:id', (req, res) => {
  if (!db.deleteChatCommand(Number(req.params.id), req.streamer.id)) return commandJsonError(res, 404, 'not_found');
  res.json({ ok: true });
});

// The Donations card's tip goal: start, edit (title and target; the bar keeps its colour) and end.
function goalJsonError(res, status, code) {
  res.status(status).json({ ok: false, code, error: errorMessage(GOAL_ERRORS, code, res.locals.t) });
}

router.post('/api/tip-goal', (req, res) => {
  const b = req.body || {};
  const fields = parseTipGoalFields({ title: b.title, target_amount: b.target_amount });
  if (fields.error) return goalJsonError(res, 400, fields.error);
  const currency = TIP_GOAL_CURRENCIES.includes(req.streamer.donation_currency) ? req.streamer.donation_currency : 'EUR';
  const goal = db.createTipGoal(req.streamer.id, { ...fields, currency, current_amount: 0 });
  require('../services/tipGoals').broadcast(req.streamer.id);
  res.status(201).json({ ok: true, goal });
});

router.patch('/api/tip-goal', (req, res) => {
  const goal = db.getActiveTipGoal(req.streamer.id);
  if (!goal) return goalJsonError(res, 404, 'not_found');
  const b = req.body || {};
  const fields = parseTipGoalFields({
    title: b.title !== undefined ? b.title : goal.title,
    target_amount: b.target_amount !== undefined ? b.target_amount : goal.target_amount,
    bar_color: goal.bar_color,
  });
  if (fields.error) return goalJsonError(res, 400, fields.error);
  const updated = db.updateTipGoal(goal.id, req.streamer.id, fields);
  require('../services/tipGoals').broadcast(req.streamer.id);
  res.json({ ok: true, goal: updated });
});

router.post('/api/tip-goal/end', (req, res) => {
  const goal = db.getActiveTipGoal(req.streamer.id);
  if (!goal) return goalJsonError(res, 404, 'not_found');
  db.endTipGoal(goal.id, req.streamer.id);
  require('../services/tipGoals').broadcast(req.streamer.id);
  res.json({ ok: true });
});
```

Replace `router.post('/sponsor-messages/:id/update', …)` with:

```js
// A sponsor message's text, link or switch: only the fields given change (the page's switch and the
// Sponsor messages card send one at a time).
router.post('/sponsor-messages/:id/update', (req, res) => {
  const b = req.body || {};
  const id = parseInt(req.params.id, 10);
  const t = res.locals.t;
  const fields = {};
  if (b.message_text !== undefined) {
    const text = typeof b.message_text === 'string' ? b.message_text.trim() : '';
    if (!text) return res.status(400).json({ ok: false, code: 'required', error: t('sponsors.error.textRequired') });
    if (text.length > dashboardSettings.TEMPLATE_MAX) return res.status(400).json({ ok: false, code: 'too_long', error: t('dashboard.settings.error.tooLong') });
    fields.message_text = text;
  }
  if (b.url !== undefined) fields.url = typeof b.url === 'string' ? b.url.trim() : '';
  let enabled = null;
  if (b.enabled !== undefined) {
    enabled = parseSwitch(b.enabled);
    if (enabled === null) return res.status(400).json({ ok: false, code: 'invalid', error: t('dashboard.settings.error.invalid') });
  }
  if (!db.updateSponsorMessageFields(id, req.streamer.id, fields)) {
    return res.status(404).json({ ok: false, code: 'not_found', error: t('sponsors.error.notFound') });
  }
  if (enabled !== null) db.setSponsorMessageEnabled(id, req.streamer.id, enabled);
  try {
    const { timedNotificationManager } = require('../services/timedNotifications');
    timedNotificationManager.restartChatForStreamer(req.streamer.id);
  } catch (e) {
    console.error('[Dashboard] Sponsor chat restart failed:', e.message);
  }
  res.json({ ok: true });
});
```

and replace `router.post('/sponsor-messages/add', …)` (Task 2's version) with one that trims and caps the text the same way and answers with the new message, so the card can draw its row (switch, edit, delete need the id):

```js
router.post('/sponsor-messages/add', (req, res) => {
  const t = res.locals.t;
  const b = req.body || {};
  const text = typeof b.message_text === 'string' ? b.message_text.trim() : '';
  if (!text) return res.status(400).json({ ok: false, code: 'required', error: t('sponsors.error.textRequired') });
  if (text.length > dashboardSettings.TEMPLATE_MAX) return res.status(400).json({ ok: false, code: 'too_long', error: t('dashboard.settings.error.tooLong') });
  const url = typeof b.url === 'string' ? b.url.trim() : '';
  const id = Number(db.addSponsorMessage(req.streamer.id, text, url).lastInsertRowid);
  // The rotation reads the enabled messages when it starts: with none before this one it was not running.
  try {
    const { timedNotificationManager } = require('../services/timedNotifications');
    timedNotificationManager.restartChatForStreamer(req.streamer.id);
  } catch (e) {
    console.error('[Dashboard] Sponsor chat restart failed:', e.message);
  }
  res.json({ ok: true, message: db.getSponsorMessages(req.streamer.id).find((m) => m.id === id) });
});
```

Add this test to the describe `'a sponsor message edit changes only what it is given'`:

```js
  test('adding answers with the new message, its text trimmed; an empty or too long text is refused', async () => {
    const id = addStreamer();
    const added = await request('POST', '/dashboard/sponsor-messages/add', { streamer: id, body: { message_text: '  Partner line  ', url: 'https://example.test' } });
    assert.equal(added.status, 200);
    const message = added.json().message;
    assert.deepEqual([message.message_text, message.url, message.enabled], ['Partner line', 'https://example.test', 1]);
    assert.equal(db.getSponsorMessages(id)[0].id, message.id);
    assert.equal((await request('POST', '/dashboard/sponsor-messages/add', { streamer: id, body: { message_text: '   ' } })).json().code, 'required');
    assert.equal((await request('POST', '/dashboard/sponsor-messages/add', { streamer: id, body: { message_text: 'x'.repeat(501) } })).json().code, 'too_long');
  });
```

Add to `en.json` (and translated): `"chatbot.commands.error.tooMany": "You have the most commands there can be ({{max}}). Delete one first."`

- [ ] **Step 4: Run the tests and the suite**

Run: `node --test src/routes/dashboard.test.js` then the full suite — Expected: PASS. The timed-notifications page still sends text, link and switch together; it keeps working.

- [ ] **Step 5: Document and commit**

`CLAUDE.md`: Twitch Chatbot — "The Commands card uses `POST/PATCH/DELETE /dashboard/api/commands` (JSON, the same rules; at most 100 commands, `COMMANDS_PER_STREAMER_MAX`)." Sponsor Rotation — "A message update changes only the fields it is given." Tip Goals — "The Donations card starts, edits (title and target; the bar keeps its colour) and ends the goal with `/dashboard/api/tip-goal` (JSON)."

```bash
git add src/services/chatCommands.js src/db.js src/routes/dashboard.js src/routes/dashboard.test.js src/locales/en.json src/locales/pt.json src/locales/es.json src/locales/fr.json src/locales/de.json src/locales/zh.json src/locales/ja.json CLAUDE.md
git commit -m "feat(dashboard): JSON routes for the cards' commands, sponsor messages and tip goal"
```

---

### Task 12: Each card's state (`src/services/dashboardCards.js`)

A pure module: from the data `GET /dashboard` gathers (Task 13) it decides what every card shows. No database, Discord or Twitch inside, so each state is tested here. The text keys it names (`cards.*`) are added to the locale files in Task 14; until then nothing names that namespace in a locale file, so `tests/i18n.test.js` does not look for them yet.

**Files:**
- Create: `src/services/dashboardCards.js`, `src/services/dashboardCards.test.js`

**Interfaces:**
- Consumes: `DURATIONS` (`overlaySettings.js`: `[column, fallback, longest]`), `sponsorChatIntervalMinutes` (`inputLimits.js`).
- Produces: `buildCards(input) -> cards` and `cardTexts(cards, t) -> { [name]: { status: { text, tone }, counts: { [count]: text } } }`, `ORDER`.
  - `input`: `{ streamer, features, now, appUrl, bot: { connected, moderator, username }, overlay: { url, open }, discord, commands, bannedWords: { total, regex }, modActionsThisWeek, sponsorMessages, tips: { recent, count90d }, tipGoal, rewards, rewardsAccess: { hasScope }, giveaway (with entryCount) | null, spotifyConnected, multistreamAvailable }`. `discord` is `discordNotificationsCard()`'s result with the per-server fields Task 13 adds: `switches: { goLive, clips, recaps, milestones, highlights, subRoles }`, `liveWhere`, `clipsWhere`, `hasLiveChannel`, `hasClipsChannel`, `hasSubRole`.
  - `cards`: `{ order: [names], chatbotOn, <name>: card }`. Every card has `status: { key, params, tone }` (`tone`: `'ok' | 'off' | 'warn'`); the other fields are listed in the code below and are what the partials of Task 14 read. A count is `{ key, params }` or `{ text }`.

- [ ] **Step 1: Write the failing tests**

Create `src/services/dashboardCards.test.js`:

```js
'use strict';

// The working cards' states (services/dashboardCards.js) from synthetic data: every card in the states the
// dashboard meets. No database, Discord or Twitch: the input is what GET /dashboard gathers.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildCards, cardTexts, ORDER } = require('./dashboardCards');

const G1 = '600000000000000001';
const G2 = '600000000000000002';

// One claimed server as discordNotificationsCard() gives it (with Task 13's fields).
const server = (over = {}) => ({
  guildId: G1, name: 'Synthetic Server', icon: null, botPresent: true, url: `/dashboard/guild/${G1}`,
  goLive: { state: 'on', where: '#live' }, clips: { state: 'off', where: null }, recaps: 'off', milestones: 'off', highlights: 'off', subRoles: 'on',
  switches: { goLive: true, clips: false, recaps: false, milestones: false, highlights: false, subRoles: true },
  liveWhere: '#live', clipsWhere: null, hasLiveChannel: true, hasClipsChannel: false, hasSubRole: true,
  ...over,
});

function input(over = {}) {
  const streamer = {
    id: 1, twitch_user_id: '1001', twitch_username: 'synthetic_channel', chatbot_enabled: 1,
    chat_follow_enabled: 1, chat_follow_template: 'Welcome, {username}!', chat_sub_enabled: 1, chat_sub_template: 'Thanks {username}',
    chat_giftsub_enabled: 0, chat_giftsub_template: null, chat_bits_enabled: 1, chat_bits_template: 'Bits from {username}',
    chat_donation_enabled: 1, chat_donation_template: 'Tip of {amount}', chat_raid_enabled: 1, chat_raid_template: 'Raid of {viewers}',
    overlay_enabled: 1, overlay_follow_enabled: 1, overlay_sub_enabled: 1, overlay_bits_enabled: 0, overlay_donation_enabled: 1,
    overlay_raid_enabled: 1, overlay_giveaway_enabled: 1, overlay_follow_duration: 8, overlay_sub_duration: 10, overlay_bits_duration: 10,
    overlay_donation_duration: 12, overlay_raid_duration: 7, overlay_giveaway_duration: 60, overlay_volume: 0.24,
    cmd_followage_enabled: 1, mod_link_protection_enabled: 1, sponsor_send_chat: 1, sponsor_chat_interval_minutes: 15,
    paypal_email: 'tips@example.test', donation_page_enabled: 1, donation_currency: 'EUR',
    cp_rewards_enabled: 1, cp_affiliate_status: 'ok', multistream_enabled: 0,
    ...(over.streamer || {}),
  };
  return {
    features: { overlays: true },
    now: Date.parse('2026-10-14T12:00:00Z'),
    appUrl: 'https://atleta.example',
    bot: { connected: true, moderator: true, username: 'atleta_bot' },
    overlay: { url: 'https://atleta.example/overlay/synthetic-token', open: true },
    discord: { twitchLinked: true, announcing: 1, needsAuth: false, authAction: 'enable', servers: [server()] },
    commands: [],
    bannedWords: { total: 0, regex: 0 },
    modActionsThisWeek: 0,
    sponsorMessages: [],
    tips: { recent: [], count90d: 0 },
    tipGoal: null,
    rewards: [],
    rewardsAccess: { hasScope: true },
    giveaway: null,
    spotifyConnected: true,
    multistreamAvailable: false,
    ...over,
    streamer,
  };
}
const build = (over) => buildCards(input(over));
const keyOf = (status) => status && status.key;

describe('the cards and their order', () => {
  test('ten cards in reading order while the overlay features are on', () => {
    assert.deepEqual(ORDER, ['chatbot', 'discord', 'overlay', 'commands', 'sponsors', 'donations', 'protection', 'giveaways', 'rewards', 'spotify']);
    assert.deepEqual(build().order, ORDER);
    assert.equal(build().chatbotOn, true);
  });

  test('without the overlay features the OBS overlay and rewards cards are left out; Multistream comes last while the relay is set up', () => {
    const off = build({ features: { overlays: false } });
    assert.deepEqual(off.order, ['chatbot', 'discord', 'commands', 'sponsors', 'donations', 'protection', 'giveaways', 'spotify']);
    assert.equal(off.overlay, undefined);
    assert.equal(off.rewards, undefined);
    const relay = build({ multistreamAvailable: true, streamer: { multistream_enabled: 1 } });
    assert.equal(relay.order.at(-1), 'multistream');
    assert.equal(keyOf(relay.multistream.status), 'dashboard.cards.multistream.active');
  });
});

describe('Chatbot', () => {
  test('online in the channel, with the six thank-you messages and how many are on', () => {
    const card = build().chatbot;
    assert.equal(card.setup, null);
    assert.deepEqual(card.status, { key: 'cards.chatbot.status.online', params: { channel: 'synthetic_channel' }, tone: 'ok' });
    assert.deepEqual(card.thankYous.map((ty) => [ty.event, ty.label, ty.switchKey, ty.textKey, ty.on]), [
      ['follow', 'cards.events.follow', 'chat_follow_enabled', 'chat_follow_template', true],
      ['sub', 'cards.events.sub', 'chat_sub_enabled', 'chat_sub_template', true],
      ['giftsub', 'cards.events.giftsub', 'chat_giftsub_enabled', 'chat_giftsub_template', false],
      ['bits', 'cards.events.bits', 'chat_bits_enabled', 'chat_bits_template', true],
      ['donation', 'cards.events.donation', 'chat_donation_enabled', 'chat_donation_template', true],
      ['raid', 'cards.events.raid', 'chat_raid_enabled', 'chat_raid_template', true],
    ]);
    assert.equal(card.thankYous[0].text, 'Welcome, {username}!');
    assert.equal(card.thankYous[2].text, '', 'no message saved');
    assert.deepEqual(card.thankYous[4].vars, ['{username}', '{amount}', '{currency}', '{message}']);
    assert.deepEqual(card.counts.thankYous, { key: 'cards.common.nOfM', params: { on: 5, total: 6 } });
  });

  test('off; connecting while the bot\'s chat connection is down; Twitch to link first', () => {
    const off = build({ streamer: { chatbot_enabled: 0 } });
    assert.deepEqual(off.chatbot.status, { key: 'cards.chatbot.status.off', params: {}, tone: 'off' });
    assert.equal(off.chatbotOn, false);
    assert.deepEqual(build({ bot: { connected: false, moderator: null, username: 'atleta_bot' } }).chatbot.status, { key: 'cards.chatbot.status.connecting', params: {}, tone: 'warn' });
    const unlinked = build({ streamer: { twitch_user_id: null } }).chatbot;
    assert.equal(unlinked.setup, 'linkTwitch');
    assert.deepEqual(unlinked.status, { key: 'cards.chatbot.status.noTwitch', params: {}, tone: 'warn' });
  });
});

describe('Discord notifications', () => {
  const discord = (over) => ({ twitchLinked: true, announcing: 0, needsAuth: false, authAction: 'enable', servers: [], ...over });

  test('Twitch to link first; with no server, a server to add', () => {
    const unlinked = build({ discord: discord({ twitchLinked: false }) }).discord;
    assert.deepEqual([unlinked.setup, unlinked.status], ['linkTwitch', { key: 'dashboard.cards.discord.statusNoTwitch', params: {}, tone: 'warn' }]);
    const none = build({ discord: discord() }).discord;
    assert.deepEqual([none.setup, keyOf(none.status), none.servers], ['addServer', 'dashboard.cards.discord.statusNoServer', []]);
  });

  test('a server: six switches, what each stores, where the posts go and the server page tab that fixes what is missing', () => {
    const card = build().discord;
    assert.equal(card.setup, null);
    assert.deepEqual(card.status, { key: 'dashboard.cards.discord.statusAll', params: {}, tone: 'ok' });
    const [s] = card.servers;
    assert.deepEqual([s.guildId, s.name, s.botPresent, s.url], [G1, 'Synthetic Server', true, `/dashboard/guild/${G1}`]);
    assert.deepEqual(s.switches.map((sw) => [sw.key, sw.label, sw.on, sw.fix]), [
      ['notify_live', 'dashboard.cards.discord.goLive', true, 'twitch'],
      ['notify_clips', 'dashboard.cards.discord.clips', false, 'twitch'],
      ['recap_enabled', 'dashboard.cards.discord.recaps', false, 'twitch'],
      ['milestones_enabled', 'dashboard.cards.discord.milestones', false, 'twitch'],
      ['weekly_highlights_enabled', 'dashboard.cards.discord.highlights', false, 'twitch'],
      ['sub_sync_enabled', 'dashboard.cards.discord.subRoles', true, 'discord'],
    ]);
    assert.deepEqual(s.switches[0].hint, { key: 'cards.discord.inChannel', params: { channel: '#live' } });
    assert.deepEqual(s.switches[1].hint, { key: 'cards.discord.pickChannel', params: {}, warn: true }, 'no clips channel yet');
    assert.deepEqual(s.switches[2].hint, { key: 'cards.discord.recapsHint', params: {} });
  });

  test('what is missing is said under its switch: a go-live channel, the Twitch authorization, a role, a digest that is not this streamer\'s', () => {
    const missing = server({
      switches: { goLive: false, clips: false, recaps: true, milestones: true, highlights: true, subRoles: true },
      liveWhere: null, hasLiveChannel: false, highlights: 'off', subRoles: 'wait',
    });
    const [s] = build({ discord: discord({ needsAuth: true, authAction: 'reconnect', servers: [missing] }) }).discord.servers;
    const hint = (key) => s.switches.find((sw) => sw.key === key).hint;
    assert.deepEqual(hint('notify_live'), { key: 'cards.discord.pickChannel', params: {}, warn: true });
    assert.deepEqual(hint('recap_enabled'), { key: 'cards.discord.needsLiveChannel', params: {}, warn: true });
    assert.deepEqual(hint('milestones_enabled'), { key: 'cards.discord.needsLiveChannel', params: {}, warn: true });
    assert.deepEqual(hint('weekly_highlights_enabled'), { key: 'cards.discord.notPosted', params: {}, warn: true });
    assert.deepEqual(hint('sub_sync_enabled'), { key: 'dashboard.cards.discord.wait', params: {}, warn: true });

    const waiting = server({ switches: { ...server().switches, milestones: true }, milestones: 'wait' });
    const [w] = build({ discord: discord({ servers: [waiting] }) }).discord.servers;
    assert.deepEqual(w.switches[3].hint, { key: 'dashboard.cards.discord.wait', params: {}, warn: true });

    const noRole = server({ hasSubRole: false, subRoles: 'off' });
    const [r] = build({ discord: discord({ servers: [noRole] }) }).discord.servers;
    assert.deepEqual(r.switches[5].hint, { key: 'cards.discord.pickRole', params: {}, warn: true });

    const hidden = server({ liveWhere: null });
    const [h] = build({ discord: discord({ servers: [hidden] }) }).discord.servers;
    assert.deepEqual(h.switches[0].hint, { key: 'cards.discord.channelUnknown', params: {} }, 'a channel the bot cannot see is not named');
  });

  test('several servers: how many announce; none announcing is amber', () => {
    const two = build({ discord: discord({ announcing: 1, servers: [server(), server({ guildId: G2, botPresent: false })] }) }).discord;
    assert.deepEqual(two.status, { key: 'dashboard.cards.discord.statusSome', params: { count: 1, total: 2 }, tone: 'ok' });
    assert.deepEqual(two.servers.map((s) => [s.guildId, s.botPresent]), [[G1, true], [G2, false]]);
    assert.deepEqual(build({ discord: discord({ announcing: 0, servers: [server()] }) }).discord.status, { key: 'dashboard.cards.discord.statusNone', params: {}, tone: 'warn' });
  });
});

describe('OBS overlay', () => {
  test('on and open in OBS: the link masked, the alerts with their seconds and test types, the volume in percent', () => {
    const card = build().overlay;
    assert.deepEqual(card.status, { key: 'cards.overlay.status.open', params: {}, tone: 'ok' });
    assert.equal(card.on, true);
    assert.equal(card.url, 'https://atleta.example/overlay/synthetic-token');
    assert.equal(card.shown, 'atleta.example/overlay/synthetic-token');
    assert.equal(card.masked, `atleta.example/overlay/${'•'.repeat(12)}`);
    assert.deepEqual(card.alerts.map((a) => [a.label, a.switchKey, a.durationKey, a.on, a.seconds, a.test]), [
      ['cards.events.follow', 'overlay_follow_enabled', 'overlay_follow_duration', true, 8, 'follow'],
      ['cards.events.sub', 'overlay_sub_enabled', 'overlay_sub_duration', true, 10, 'subscription'],
      ['cards.events.bits', 'overlay_bits_enabled', 'overlay_bits_duration', false, 10, 'bits'],
      ['cards.events.donation', 'overlay_donation_enabled', 'overlay_donation_duration', true, 12, 'donation'],
      ['cards.events.raid', 'overlay_raid_enabled', 'overlay_raid_duration', true, 7, 'raid'],
      ['cards.events.giveaway', 'overlay_giveaway_enabled', 'overlay_giveaway_duration', true, 60, 'giveaway_winner'],
    ]);
    assert.deepEqual(card.alerts[0].choices, [5, 8, 10, 12, 15, 20, 30]);
    assert.deepEqual(card.alerts[4].choices, [5, 7, 8, 10, 12, 15, 20, 30], 'a saved 7 stays a choice');
    assert.deepEqual(card.alerts[5].choices, [5, 8, 10, 12, 15, 20, 30, 45, 60], 'the giveaway winner may stay up to 60 s');
    assert.equal(card.volume, 24);
    assert.deepEqual(card.counts.alerts, { key: 'cards.common.nOfM', params: { on: 5, total: 6 } });
  });

  test('not open in OBS, off, no link yet; a stored value out of range shows the default', () => {
    assert.deepEqual(build({ overlay: { url: 'https://atleta.example/overlay/x', open: false } }).overlay.status, { key: 'cards.overlay.status.notOpen', params: {}, tone: 'warn' });
    assert.deepEqual(build({ streamer: { overlay_enabled: 0 } }).overlay.status, { key: 'cards.overlay.status.off', params: {}, tone: 'off' });
    const noLink = build({ overlay: { url: null, open: false } }).overlay;
    assert.deepEqual([noLink.url, noLink.shown, noLink.masked], [null, null, null]);
    assert.equal(build({ streamer: { overlay_follow_duration: 99 } }).overlay.alerts[0].seconds, 8);
    assert.equal(build({ streamer: { overlay_volume: null } }).overlay.volume, 80);
  });
});

describe('Commands', () => {
  const commands = ['discord', 'socials', 'setup', 'schedule', 'sim'].map((name, i) => ({ id: i + 1, command: name, response: `About ${name}`, cooldown: 10 }));

  test('the commands and the built-ins that are on; four shown, the rest behind Show all', () => {
    const card = build({ commands }).commands;
    assert.equal(card.needsChatbot, true);
    assert.deepEqual(card.status, { key: 'cards.commands.status', params: { commands: 5, builtins: 1 }, tone: 'ok' });
    assert.deepEqual(card.commands.map((c) => [c.id, c.name, c.response, c.cooldown, c.extra]), [
      [1, 'discord', 'About discord', 10, false], [2, 'socials', 'About socials', 10, false], [3, 'setup', 'About setup', 10, false],
      [4, 'schedule', 'About schedule', 10, false], [5, 'sim', 'About sim', 10, true],
    ]);
    assert.equal(card.builtins.length, 13);
    assert.deepEqual(card.builtins.slice(0, 4).map((b) => [b.key, b.name, b.on]), [
      ['cmd_followage_enabled', '!followage', true], ['cmd_subage_enabled', '!subage', false], ['cmd_uptime_enabled', '!uptime', false], ['cmd_accountage_enabled', '!accountage', false],
    ]);
    assert.deepEqual(card.counts, { commands: { text: '5' }, builtins: { key: 'cards.common.nOfM', params: { on: 1, total: 13 } } });
  });

  test('no command and no built-in is grey', () => {
    assert.deepEqual(build({ streamer: { cmd_followage_enabled: 0 } }).commands.status, { key: 'cards.commands.status', params: { commands: 0, builtins: 0 }, tone: 'off' });
  });
});

describe('Sponsor messages', () => {
  const messages = (n, enabled = 1) => Array.from({ length: n }, (_, i) => ({ id: i + 1, message_text: `Partner ${i + 1}`, url: i ? null : 'https://example.test', enabled }));

  test('posting one every N minutes; three shown; the sponsor images link only with the overlay features', () => {
    const card = build({ sponsorMessages: messages(4) }).sponsors;
    assert.equal(card.needsChatbot, true);
    assert.deepEqual(card.status, { key: 'cards.sponsors.status.on', params: { minutes: 15, count: 4 }, tone: 'ok' });
    assert.deepEqual(card.messages.map((m) => [m.id, m.text, m.url, m.on, m.extra]), [
      [1, 'Partner 1', 'https://example.test', true, false], [2, 'Partner 2', '', true, false], [3, 'Partner 3', '', true, false], [4, 'Partner 4', '', true, true],
    ]);
    assert.deepEqual([card.on, card.minutes, card.intervals], [true, 15, [5, 10, 15, 20, 30, 60]]);
    assert.deepEqual(card.counts, { messages: { text: '4' } });
    assert.equal(card.imagesLink, true);
    assert.equal(build({ features: { overlays: false } }).sponsors.imagesLink, false);
  });

  test('off keeps the messages; on with none switched on is amber; an odd saved interval stays a choice', () => {
    assert.deepEqual(build({ streamer: { sponsor_send_chat: 0 }, sponsorMessages: messages(2) }).sponsors.status, { key: 'cards.sponsors.status.off', params: { count: 2 }, tone: 'off' });
    assert.equal(build({ sponsorMessages: messages(2, 0) }).sponsors.status.tone, 'warn');
    assert.deepEqual(build({ streamer: { sponsor_chat_interval_minutes: 7 } }).sponsors.intervals, [5, 7, 10, 15, 20, 30, 60]);
  });
});

describe('Donations', () => {
  test('a PayPal email first', () => {
    const card = build({ streamer: { paypal_email: null } }).donations;
    assert.deepEqual([card.setup, card.status], ['paypal', { key: 'cards.donations.status.setup', params: {}, tone: 'warn' }]);
  });

  test('the tip page on: its link, the goal and the latest tips, each with how long ago', () => {
    const card = build({
      tips: {
        count90d: 7,
        recent: [
          { id: 3, amount: 5, currency: 'EUR', donor_name: 'RacerFan', message: 'Great race', created_at: '2026-10-12 11:30:00' },
          { id: 2, amount: 10, currency: null, donor_name: null, message: null, created_at: '2026-10-14T11:58:00.000Z' },
        ],
      },
      tipGoal: { title: 'New wheel', current_amount: 101, target_amount: 1000, currency: 'EUR' },
    }).donations;
    assert.deepEqual(card.status, { key: 'cards.donations.status.on', params: { count: 7 }, tone: 'ok' });
    assert.deepEqual([card.setup, card.on, card.tipUrl, card.tipShown], [null, true, 'https://atleta.example/tip/synthetic_channel', 'atleta.example/tip/synthetic_channel']);
    assert.equal(card.showGoal, true);
    assert.deepEqual(card.goal, { title: 'New wheel', current: 101, target: 1000, currency: 'EUR', percent: 10 });
    assert.deepEqual(card.recent.map((d) => [d.id, d.amount, d.currency, d.name, d.message, d.ago]), [
      [3, 5, 'EUR', 'RacerFan', 'Great race', { key: 'nav.timeDays', params: { n: 2 } }],
      [2, 10, 'EUR', '', '', { key: 'nav.timeMinutes', params: { n: 2 } }],
    ]);
  });

  test('off; no goal; the goal section only with the overlay features; no tip link without Twitch', () => {
    assert.deepEqual(build({ streamer: { donation_page_enabled: 0 } }).donations.status, { key: 'cards.donations.status.off', params: {}, tone: 'off' });
    assert.deepEqual([build().donations.showGoal, build().donations.goal], [true, null]);
    assert.equal(build({ features: { overlays: false } }).donations.showGoal, false);
    const noTwitch = build({ streamer: { twitch_username: null } }).donations;
    assert.deepEqual([noTwitch.tipUrl, keyOf(noTwitch.status)], [null, 'cards.donations.status.noTwitch']);
  });
});

describe('Chat protection', () => {
  test('the filters that are on, the banned words counted, this week\'s moderation log', () => {
    const card = build({ bannedWords: { total: 3, regex: 1 }, modActionsThisWeek: 4 }).protection;
    assert.equal(card.needsChatbot, true);
    assert.deepEqual(card.status, { key: 'cards.protection.status.on', params: { on: 1, total: 6 }, tone: 'ok' });
    assert.deepEqual(card.filters.map((f) => [f.key, f.label, f.on]), [
      ['mod_link_protection_enabled', 'cards.protection.link', true],
      ['mod_banned_words_enabled', 'cards.protection.banned', false],
      ['mod_caps_enabled', 'cards.protection.caps', false],
      ['mod_emote_spam_enabled', 'cards.protection.emotes', false],
      ['mod_repetition_enabled', 'cards.protection.repetition', false],
      ['mod_symbol_spam_enabled', 'cards.protection.symbols', false],
    ]);
    assert.deepEqual([card.filters[1].hint, card.filters[1].hintParams], ['cards.protection.bannedHint', { count: 3 }]);
    assert.deepEqual(card.modLog, { key: 'cards.protection.modLog', params: { count: 4 } });
    assert.deepEqual(build({ streamer: { mod_link_protection_enabled: 0 } }).protection.status, { key: 'cards.protection.status.off', params: {}, tone: 'off' });
  });

  test('the moderator note only while Twitch says the bot is not a moderator there and the chatbot is on', () => {
    const note = (bot, streamer) => build({ bot: { connected: true, username: 'atleta_bot', ...bot }, streamer }).protection.moderatorNote;
    assert.equal(note({ moderator: false }), true);
    assert.equal(note({ moderator: true }), false);
    assert.equal(note({ moderator: null }), false, 'unknown: the bot is not in the channel');
    assert.equal(note({ moderator: false }, { chatbot_enabled: 0 }), false);
    assert.equal(note({ moderator: false, username: '' }), false, 'no bot name to give');
    assert.equal(build().protection.botName, 'atleta_bot');
  });
});

describe('Giveaways', () => {
  test('none running, or the running one with what its panel needs', () => {
    assert.deepEqual(build().giveaways, { needsChatbot: true, running: null, status: { key: 'cards.giveaways.status.none', params: {}, tone: 'off' } });
    const card = build({ giveaway: { id: 9, keyword: 'gw', prize: null, ends_at: '2026-10-14T12:05:00.000Z', winners_count: 2, subs_only: 1, entryCount: 4 } }).giveaways;
    assert.deepEqual(card.status, { key: 'cards.giveaways.status.running', params: {}, tone: 'warn' });
    assert.deepEqual(card.running, { id: 9, keyword: 'gw', prize: '', endsAt: '2026-10-14T12:05:00.000Z', winners: 2, subsOnly: true, entries: 4 });
  });
});

describe('Channel point rewards', () => {
  const rewards = [{ id: 1, title: 'Hydrate', cost: 500, enabled: 1 }, { id: 2, title: 'Horn', cost: 100, enabled: 0 }];

  test('the Twitch permission first, then Affiliate, then the switch and the rewards', () => {
    const states = [
      [{ rewardsAccess: { hasScope: false } }, 'permission', 'cards.rewards.status.permission', 'warn'],
      [{ streamer: { cp_affiliate_status: 'not_affiliate' } }, 'notAffiliate', 'cards.rewards.status.notAffiliate', 'warn'],
      [{ streamer: { cp_rewards_enabled: 0 }, rewards }, 'ok', 'cards.rewards.status.off', 'off'],
      [{}, 'ok', 'cards.rewards.status.empty', 'off'],
      [{ rewards }, 'ok', 'cards.rewards.status.on', 'ok'],
    ];
    for (const [over, access, key, tone] of states) {
      const card = build(over).rewards;
      assert.deepEqual([card.access, card.status.key, card.status.tone], [access, key, tone], JSON.stringify(over));
    }
    const card = build({ rewards }).rewards;
    assert.deepEqual(card.rewards, [{ id: 1, title: 'Hydrate', cost: 500, on: true }, { id: 2, title: 'Horn', cost: 100, on: false }]);
    assert.deepEqual(card.status.params, { count: 2 });
  });
});

describe('Spotify', () => {
  test('connected or not', () => {
    assert.deepEqual(build().spotify, { connected: true, status: { key: 'dashboard.status.connected', params: {}, tone: 'ok' } });
    assert.deepEqual(build({ spotifyConnected: false }).spotify, { connected: false, status: { key: 'dashboard.status.notConnected', params: {}, tone: 'off' } });
  });
});

describe('cardTexts', () => {
  test('translates each status and count, gives plain counts as they are, and leaves the giveaway card to the page', () => {
    const t = (key, params) => `${key}${params && Object.keys(params).length ? JSON.stringify(params) : ''}`;
    const texts = cardTexts(build({ commands: [{ id: 1, command: 'discord', response: 'x', cooldown: 5 }] }), t);
    assert.deepEqual(Object.keys(texts), ['chatbot', 'discord', 'overlay', 'commands', 'sponsors', 'donations', 'protection', 'rewards', 'spotify']);
    assert.deepEqual(texts.chatbot, { status: { text: 'cards.chatbot.status.online{"channel":"synthetic_channel"}', tone: 'ok' }, counts: { thankYous: 'cards.common.nOfM{"on":5,"total":6}' } });
    assert.deepEqual(texts.commands.counts, { commands: '1', builtins: 'cards.common.nOfM{"on":1,"total":13}' });
    assert.deepEqual(texts.spotify, { status: { text: 'dashboard.status.connected', tone: 'ok' }, counts: {} });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test src/services/dashboardCards.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/services/dashboardCards.js`**

```js
'use strict';

// What each of the dashboard's working cards shows (views/cards/*.ejs), decided from the data GET /dashboard
// gathers (gatherCards() in routes/dashboard.js). Pure: nothing here reads the database or asks Discord or
// Twitch, so every state is tested on its own (dashboardCards.test.js). A status is a text key with its params and
// a tone ('ok' green, 'off' grey, 'warn' amber: something is missing); a count is a text key with its params, or a
// plain { text }. The view translates them, and so does GET /dashboard/api/cards after a change (cardTexts()).

const { DURATIONS } = require('./overlaySettings');
const { sponsorChatIntervalMinutes } = require('./inputLimits');

// The cards in reading order, which is also their order on a phone. The OBS overlay and rewards cards are left out
// while the overlay features are off; the Multistream card comes last while the relay is set up.
const ORDER = ['chatbot', 'discord', 'overlay', 'commands', 'sponsors', 'donations', 'protection', 'giveaways', 'rewards', 'spotify'];
const OVERLAY_CARDS = new Set(['overlay', 'rewards']);

const label = (key, params = {}) => ({ key, params });
const missing = (key, params = {}) => ({ key, params, warn: true });
const status = (key, tone = 'ok', params = {}) => ({ key, params, tone });
const nOfM = (on, total) => label('cards.common.nOfM', { on, total });
const plain = (n) => ({ text: String(n) });
const twitchLinked = (streamer) => !!(streamer.twitch_user_id && streamer.twitch_username);

// The thank-you messages: their row label and the variables each message may use (the chatbot page's list).
const THANK_YOUS = [
  { event: 'follow', label: 'cards.events.follow', vars: ['{username}'] },
  { event: 'sub', label: 'cards.events.sub', vars: ['{username}', '{tier}', '{months}', '{message}'] },
  { event: 'giftsub', label: 'cards.events.giftsub', vars: ['{username}', '{amount}', '{tier}'] },
  { event: 'bits', label: 'cards.events.bits', vars: ['{username}', '{amount}', '{message}'] },
  { event: 'donation', label: 'cards.events.donation', vars: ['{username}', '{amount}', '{currency}', '{message}'] },
  { event: 'raid', label: 'cards.events.raid', vars: ['{username}', '{viewers}'] },
];

// The OBS overlay's alerts: their streamers columns (overlay_<column>_enabled, overlay_<column>_duration) and
// the type their test button sends (OVERLAY_TEST_EVENTS in routes/dashboard.js).
const ALERTS = [
  { column: 'follow', label: 'cards.events.follow', test: 'follow' },
  { column: 'sub', label: 'cards.events.sub', test: 'subscription' },
  { column: 'bits', label: 'cards.events.bits', test: 'bits' },
  { column: 'donation', label: 'cards.events.donation', test: 'donation' },
  { column: 'raid', label: 'cards.events.raid', test: 'raid' },
  { column: 'giveaway', label: 'cards.events.giveaway', test: 'giveaway_winner' },
];
const SECONDS = [5, 8, 10, 12, 15, 20, 30];
const LONG_SECONDS = [...SECONDS, 45, 60]; // the giveaway winner may stay up to 60 s
const DURATION = Object.fromEntries(DURATIONS.map(([column, fallback, longest]) => [column, { fallback, longest }]));

const BUILTINS = ['followage', 'subage', 'uptime', 'accountage', '8ball', 'roll', 'hug', 'slap', 'love', 'rps', 'coinflip', 'quote', 'roast'];

const FILTERS = [
  { column: 'mod_link_protection_enabled', label: 'cards.protection.link', hint: 'cards.protection.linkHint' },
  { column: 'mod_banned_words_enabled', label: 'cards.protection.banned', hint: 'cards.protection.bannedHint' },
  { column: 'mod_caps_enabled', label: 'cards.protection.caps', hint: 'cards.protection.capsHint' },
  { column: 'mod_emote_spam_enabled', label: 'cards.protection.emotes', hint: 'cards.protection.emotesHint' },
  { column: 'mod_repetition_enabled', label: 'cards.protection.repetition', hint: 'cards.protection.repetitionHint' },
  { column: 'mod_symbol_spam_enabled', label: 'cards.protection.symbols', hint: 'cards.protection.symbolsHint' },
];

const SPONSOR_INTERVALS = [5, 10, 15, 20, 30, 60];
const COMMANDS_SHOWN = 4; // the rest are behind "Show all"
const SPONSORS_SHOWN = 3;

// The usual choices of a select, with the value saved now among them (an older page may have saved another).
function choices(usual, current) {
  return [...new Set([...usual, current])].filter(Number.isFinite).sort((a, b) => a - b);
}

// "x ago" for a time the database stored in UTC ('YYYY-MM-DD HH:MM:SS', or ISO with its zone).
function ago(stored, now) {
  const value = String(stored || '');
  const ms = Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
  if (!Number.isFinite(ms)) return null;
  const minutes = Math.max(0, Math.floor((now - ms) / 60000));
  if (minutes < 1) return label('nav.timeNow');
  if (minutes < 60) return label('nav.timeMinutes', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return label('nav.timeHours', { n: hours });
  return label('nav.timeDays', { n: Math.floor(hours / 24) });
}

function chatbotCard({ streamer, bot }) {
  const on = !!streamer.chatbot_enabled;
  const thankYous = THANK_YOUS.map((ty) => ({
    event: ty.event,
    label: ty.label,
    vars: ty.vars,
    switchKey: `chat_${ty.event}_enabled`,
    textKey: `chat_${ty.event}_template`,
    on: !!streamer[`chat_${ty.event}_enabled`],
    text: streamer[`chat_${ty.event}_template`] || '',
  }));
  let st;
  if (!twitchLinked(streamer)) st = status('cards.chatbot.status.noTwitch', 'warn');
  else if (!on) st = status('cards.chatbot.status.off', 'off');
  else if (!bot.connected) st = status('cards.chatbot.status.connecting', 'warn');
  else st = status('cards.chatbot.status.online', 'ok', { channel: streamer.twitch_username });
  return {
    setup: twitchLinked(streamer) ? null : 'linkTwitch',
    on,
    status: st,
    thankYous,
    counts: { thankYous: nOfM(thankYous.filter((ty) => ty.on).length, thankYous.length) },
  };
}

// One server's six switches: what each stores (the watcher row of the streamer's own channel for go-live and
// clips, the server's row for the rest), the line under it (where the posts go, or what is missing, marked warn)
// and the tab of the server page that sets what is missing.
function serverSwitches(s) {
  const where = (name, set) => (name ? label('cards.discord.inChannel', { channel: name })
    : set ? label('cards.discord.channelUnknown') : missing('cards.discord.pickChannel'));
  const intoLiveChannel = (on, hint) => (on && !s.hasLiveChannel ? missing('cards.discord.needsLiveChannel') : label(hint));
  return [
    { key: 'notify_live', label: 'dashboard.cards.discord.goLive', on: s.switches.goLive, fix: 'twitch', hint: where(s.liveWhere, s.hasLiveChannel) },
    { key: 'notify_clips', label: 'dashboard.cards.discord.clips', on: s.switches.clips, fix: 'twitch', hint: where(s.clipsWhere, s.hasClipsChannel) },
    { key: 'recap_enabled', label: 'dashboard.cards.discord.recaps', on: s.switches.recaps, fix: 'twitch', hint: intoLiveChannel(s.switches.recaps, 'cards.discord.recapsHint') },
    {
      key: 'milestones_enabled', label: 'dashboard.cards.discord.milestones', on: s.switches.milestones, fix: 'twitch',
      hint: s.milestones === 'wait' ? missing('dashboard.cards.discord.wait') : intoLiveChannel(s.switches.milestones, 'cards.discord.milestonesHint'),
    },
    {
      key: 'weekly_highlights_enabled', label: 'dashboard.cards.discord.highlights', on: s.switches.highlights, fix: 'twitch',
      hint: s.switches.highlights && s.highlights !== 'on' ? missing('cards.discord.notPosted') : label('cards.discord.highlightsHint'),
    },
    {
      key: 'sub_sync_enabled', label: 'dashboard.cards.discord.subRoles', on: s.switches.subRoles, fix: 'discord',
      hint: s.subRoles === 'wait' ? missing('dashboard.cards.discord.wait')
        : !s.hasSubRole ? missing('cards.discord.pickRole') : label('cards.discord.subRolesHint'),
    },
  ];
}

function discordCard({ discord: d }) {
  if (!d.twitchLinked) return { setup: 'linkTwitch', status: status('dashboard.cards.discord.statusNoTwitch', 'warn'), servers: [] };
  if (d.servers.length === 0) return { setup: 'addServer', status: status('dashboard.cards.discord.statusNoServer', 'warn'), servers: [] };
  const total = d.servers.length;
  let st;
  if (d.announcing === total) st = status('dashboard.cards.discord.statusAll');
  else if (d.announcing > 0) st = status('dashboard.cards.discord.statusSome', 'ok', { count: d.announcing, total });
  else st = status('dashboard.cards.discord.statusNone', 'warn');
  return {
    setup: null,
    status: st,
    needsAuth: !!d.needsAuth,
    authAction: d.authAction,
    servers: d.servers.map((s) => ({ guildId: s.guildId, name: s.name, botPresent: s.botPresent, url: s.url, switches: serverSwitches(s) })),
  };
}

function overlayCard({ streamer, overlay }) {
  const on = !!streamer.overlay_enabled;
  const alerts = ALERTS.map((a) => {
    const durationKey = `overlay_${a.column}_duration`;
    const { fallback, longest } = DURATION[durationKey];
    const stored = Number(streamer[durationKey]);
    const seconds = Number.isInteger(stored) && stored >= 1 && stored <= longest ? stored : fallback;
    return {
      label: a.label,
      test: a.test,
      switchKey: `overlay_${a.column}_enabled`,
      durationKey,
      on: !!streamer[`overlay_${a.column}_enabled`],
      seconds,
      choices: choices(longest > 30 ? LONG_SECONDS : SECONDS, seconds),
    };
  });
  const rawVolume = streamer.overlay_volume;
  const volume = rawVolume === null || rawVolume === undefined || rawVolume === '' ? 0.8 : Number(rawVolume);
  let st;
  if (!on) st = status('cards.overlay.status.off', 'off');
  else if (overlay.open) st = status('cards.overlay.status.open');
  else st = status('cards.overlay.status.notOpen', 'warn');
  const shown = overlay.url ? overlay.url.replace(/^https?:\/\//, '') : null;
  return {
    on,
    status: st,
    open: !!overlay.open,
    url: overlay.url || null,
    shown,
    masked: shown ? shown.replace(/\/overlay\/.*$/, `/overlay/${'•'.repeat(12)}`) : null,
    alerts,
    volume: Math.round((Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.8) * 100),
    counts: { alerts: nOfM(alerts.filter((a) => a.on).length, alerts.length) },
  };
}

function commandsCard({ streamer, commands }) {
  const builtins = BUILTINS.map((name) => ({ key: `cmd_${name}_enabled`, name: `!${name}`, on: !!streamer[`cmd_${name}_enabled`] }));
  const builtinsOn = builtins.filter((b) => b.on).length;
  const rows = commands.map((c, i) => ({ id: c.id, name: c.command, response: c.response, cooldown: c.cooldown, extra: i >= COMMANDS_SHOWN }));
  return {
    needsChatbot: true,
    status: status('cards.commands.status', rows.length + builtinsOn > 0 ? 'ok' : 'off', { commands: rows.length, builtins: builtinsOn }),
    commands: rows,
    builtins,
    counts: { commands: plain(rows.length), builtins: nOfM(builtinsOn, builtins.length) },
  };
}

function sponsorsCard({ streamer, sponsorMessages, features }) {
  const on = !!streamer.sponsor_send_chat;
  const minutes = sponsorChatIntervalMinutes(streamer.sponsor_chat_interval_minutes);
  const messages = sponsorMessages.map((m, i) => ({ id: m.id, text: m.message_text, url: m.url || '', on: !!m.enabled, extra: i >= SPONSORS_SHOWN }));
  const count = messages.length;
  return {
    needsChatbot: true,
    on,
    minutes,
    intervals: choices(SPONSOR_INTERVALS, minutes),
    messages,
    imagesLink: !!features.overlays,
    status: on ? status('cards.sponsors.status.on', messages.some((m) => m.on) ? 'ok' : 'warn', { minutes, count })
      : status('cards.sponsors.status.off', 'off', { count }),
    counts: { messages: plain(count) },
  };
}

function donationsCard({ streamer, tips, tipGoal, features, appUrl, now }) {
  const hasEmail = !!streamer.paypal_email;
  const on = !!streamer.donation_page_enabled;
  const tipUrl = streamer.twitch_username ? `${appUrl}/tip/${encodeURIComponent(streamer.twitch_username)}` : null;
  let st;
  if (!hasEmail) st = status('cards.donations.status.setup', 'warn');
  else if (!on) st = status('cards.donations.status.off', 'off');
  else if (!tipUrl) st = status('cards.donations.status.noTwitch', 'warn');
  else st = status('cards.donations.status.on', 'ok', { count: tips.count90d });
  const currency = streamer.donation_currency || 'EUR';
  let goal = null;
  if (tipGoal) {
    const current = Number(tipGoal.current_amount) || 0;
    const target = Number(tipGoal.target_amount) || 0;
    goal = { title: tipGoal.title, current, target, currency: tipGoal.currency || 'EUR', percent: target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0 };
  }
  return {
    setup: hasEmail ? null : 'paypal',
    on,
    status: st,
    tipUrl,
    tipShown: tipUrl ? tipUrl.replace(/^https?:\/\//, '') : null,
    currency,
    showGoal: !!features.overlays,
    goal,
    recent: tips.recent.map((d) => ({
      id: d.id, amount: Number(d.amount) || 0, currency: d.currency || currency, name: d.donor_name || '', message: d.message || '', ago: ago(d.created_at, now),
    })),
    counts: {},
  };
}

function protectionCard({ streamer, bot, bannedWords, modActionsThisWeek }) {
  const filters = FILTERS.map((f) => ({
    key: f.column,
    label: f.label,
    hint: f.hint,
    hintParams: f.column === 'mod_banned_words_enabled' ? { count: bannedWords.total } : {},
    on: !!streamer[f.column],
  }));
  const on = filters.filter((f) => f.on).length;
  return {
    needsChatbot: true,
    status: on ? status('cards.protection.status.on', 'ok', { on, total: filters.length }) : status('cards.protection.status.off', 'off'),
    filters,
    // Twitch told the bot, in the streamer's channel, that it is not a moderator there (moderatorStatus()).
    moderatorNote: !!streamer.chatbot_enabled && bot.moderator === false && !!bot.username,
    botName: bot.username || '',
    modLog: label('cards.protection.modLog', { count: modActionsThisWeek }),
    counts: {},
  };
}

function giveawaysCard({ giveaway }) {
  if (!giveaway) return { needsChatbot: true, running: null, status: status('cards.giveaways.status.none', 'off') };
  return {
    needsChatbot: true,
    status: status('cards.giveaways.status.running', 'warn'),
    running: {
      id: giveaway.id,
      keyword: giveaway.keyword,
      prize: giveaway.prize || '',
      endsAt: giveaway.ends_at || '',
      winners: giveaway.winners_count || 1,
      subsOnly: !!giveaway.subs_only,
      entries: giveaway.entryCount || 0,
    },
  };
}

function rewardsCard({ streamer, rewards, rewardsAccess }) {
  const on = !!streamer.cp_rewards_enabled;
  let access = 'ok';
  if (!rewardsAccess.hasScope) access = 'permission';
  else if (streamer.cp_affiliate_status === 'not_affiliate') access = 'notAffiliate';
  const rows = rewards.map((r) => ({ id: r.id, title: r.title, cost: r.cost, on: !!r.enabled }));
  let st;
  if (access === 'permission') st = status('cards.rewards.status.permission', 'warn');
  else if (access === 'notAffiliate') st = status('cards.rewards.status.notAffiliate', 'warn');
  else if (!on) st = status('cards.rewards.status.off', 'off');
  else if (rows.length === 0) st = status('cards.rewards.status.empty', 'off');
  else st = status('cards.rewards.status.on', 'ok', { count: rows.length });
  return { on, access, rewards: rows, status: st, counts: {} };
}

function spotifyCard({ spotifyConnected }) {
  return {
    connected: !!spotifyConnected,
    status: spotifyConnected ? status('dashboard.status.connected') : status('dashboard.status.notConnected', 'off'),
  };
}

function multistreamCard({ streamer }) {
  const on = !!streamer.multistream_enabled;
  return { on, status: on ? status('dashboard.cards.multistream.active') : status('dashboard.cards.multistream.sub', 'off') };
}

const BUILDERS = {
  chatbot: chatbotCard, discord: discordCard, overlay: overlayCard, commands: commandsCard, sponsors: sponsorsCard,
  donations: donationsCard, protection: protectionCard, giveaways: giveawaysCard, rewards: rewardsCard, spotify: spotifyCard,
  multistream: multistreamCard,
};

function buildCards(input) {
  const features = input.features || {};
  const order = ORDER.filter((name) => features.overlays || !OVERLAY_CARDS.has(name));
  if (input.multistreamAvailable) order.push('multistream');
  const cards = { order, chatbotOn: !!input.streamer.chatbot_enabled };
  for (const name of order) cards[name] = BUILDERS[name]({ ...input, features });
  return cards;
}

// Each card's status line and counts, translated with t(key, params): what GET /dashboard/api/cards answers after
// a change. The giveaway card is left out: the page keeps its panel's own state (a winner just picked) until the
// streamer closes it.
function cardTexts(cards, t) {
  const out = {};
  for (const name of cards.order) {
    if (name === 'giveaways') continue;
    const card = cards[name];
    out[name] = {
      status: { text: t(card.status.key, card.status.params), tone: card.status.tone },
      counts: Object.fromEntries(Object.entries(card.counts || {}).map(([key, c]) => [key, c.text !== undefined ? c.text : t(c.key, c.params)])),
    };
  }
  return out;
}

module.exports = { buildCards, cardTexts, ORDER };
```

- [ ] **Step 4: Run the tests**

Run: `node --test src/services/dashboardCards.test.js` — Expected: PASS. Then the full suite.

- [ ] **Step 5: Commit**

```bash
git add src/services/dashboardCards.js src/services/dashboardCards.test.js
git commit -m "feat(dashboard): each working card's state, decided in one tested module"
```

### Task 13: The dashboard gathers the cards' data; the page gets wide

**Files:**
- Modify: `src/db.js` (`countModLog`), `src/db.cards.test.js`
- Modify: `src/routes/dashboard.js` (`discordNotificationsCard` rows; `gatherCards`; `GET /`; new `GET /api/cards`)
- Modify: `src/views/header.ejs` (the container)
- Modify: `src/routes/dashboard.test.js`
- Modify: `CLAUDE.md` (Dashboard bullet)

**Interfaces:**
- Consumes: `buildCards`, `cardTexts` (Task 12); `overlayPresence.isOpen` (Task 7); `chatManager.moderatorStatus` (Task 8).
- Produces: the dashboard view gets the locals `cards` (`buildCards()`'s result) and `wideLayout: true`; `discordNotificationsCard()` rows gain `switches`, `liveWhere`, `clipsWhere`, `hasLiveChannel`, `hasClipsChannel`, `hasSubRole`; `GET /dashboard/api/cards` → `{ ok: true, cards: cardTexts(...) }`; `db.countModLog(streamerId) -> number`; `header.ejs` prints `<div class="container container-wide">` when the page passes `wideLayout`.

- [ ] **Step 1: The week's moderation log — failing test**

Append to `src/db.cards.test.js`:

```js
describe('the moderation log of the week', () => {
  test('counts the streamer\'s own actions of the last 7 days', () => {
    const a = addStreamer();
    const b = addStreamer();
    db.addModLogEntry(a, 'viewer1', '1', 'delete', 'link', 'x', 'twitch');
    db.addModLogEntry(a, 'viewer2', '2', 'timeout_60', 'caps', 'y', 'twitch');
    db.addModLogEntry(b, 'viewer3', '3', 'delete', 'link', 'z', 'twitch');
    db.db.prepare("INSERT INTO moderation_log (streamer_id, username, action, created_at) VALUES (?, 'old', 'delete', datetime('now', '-8 days'))").run(a);
    assert.equal(db.countModLog(a), 2);
    assert.equal(db.countModLog(b), 1);
  });
});
```

Run: `node --test src/db.cards.test.js` — Expected: FAIL (`db.countModLog is not a function`).

- [ ] **Step 2: Add `countModLog`**

In `src/db.js` next to `getModLog`, and export it:

```js
// How many moderation actions the bot took in the streamer's chat in the last 7 days (all the log keeps).
function countModLog(streamerId) {
  return db.prepare("SELECT COUNT(*) AS n FROM moderation_log WHERE streamer_id = ? AND created_at >= datetime('now', '-7 days')").get(streamerId).n;
}
```

Run: `node --test src/db.cards.test.js` — Expected: PASS.

- [ ] **Step 3: Write the failing route tests**

Append to `src/routes/dashboard.test.js`:

```js
// ── The working cards' data (GET /dashboard, GET /dashboard/api/cards) ───

describe('the data of the working cards', () => {
  const locals = async (id) => (await request('GET', '/dashboard', { streamer: id, json: true })).json().locals;

  test('the page gets each card\'s state and the wide layout; the unused tier, limits and iRacing reads are gone', async () => {
    const id = addStreamer({ twitch_user_id: 'tw-wc-1', twitch_username: 'synthetic_wc_1', chatbot_enabled: 1, paypal_email: 'tips@example.test', donation_page_enabled: 1 });
    db.addChatCommand(id, 'discord', 'Join us', 10);
    db.addSponsorMessage(id, 'Partner line', null);
    const l = await locals(id);
    assert.equal(l.wideLayout, true);
    assert.deepEqual(l.cards.order, ['chatbot', 'discord', 'overlay', 'commands', 'sponsors', 'donations', 'protection', 'giveaways', 'rewards', 'spotify']);
    assert.deepEqual(l.cards.commands.commands.map((c) => c.name), ['discord']);
    assert.deepEqual(l.cards.sponsors.messages.map((m) => m.text), ['Partner line']);
    assert.ok(l.cards.donations.tipUrl.endsWith('/tip/synthetic_wc_1'));
    for (const gone of ['tier', 'limits', 'iracingSettings']) assert.ok(!(gone in l), gone);
  });

  test('a server\'s switches as stored, and where its posts go', async () => {
    const id = addStreamer({ twitch_user_id: 'tw-wc-2', twitch_username: 'synthetic_wc_2' });
    const g = '600000000000000901';
    db.upsertGuild(g, id, 'Server');
    db.updateGuildConfig(g, id, { recap_enabled: true, sub_sync_enabled: true });
    guilds.set(g, fakeGuild(g));
    db.addWatchedChannel(g, id, 'synthetic_wc_2', CH_LIVE, null, true, false, null);
    const [s] = (await locals(id)).discordNotifications.servers;
    assert.deepEqual(s.switches, { goLive: true, clips: false, recaps: true, milestones: false, highlights: false, subRoles: true });
    assert.deepEqual([s.liveWhere, s.clipsWhere, s.hasLiveChannel, s.hasClipsChannel, s.hasSubRole], ['#live', null, true, false, false]);
  });

  test('the overlay card knows whether the overlay is open in OBS; the protection card whether the bot is a moderator', async () => {
    const presence = require('../services/overlayPresence');
    const bot = require('../config').bot;
    const id = addStreamer({ overlay_enabled: 1, overlay_token: 'synthetic-token-wc-3', chatbot_enabled: 1 });
    assert.equal((await locals(id)).cards.overlay.open, false);
    presence.opened(id);
    try { assert.equal((await locals(id)).cards.overlay.open, true); } finally { presence.closed(id); }
    const { moderatorStatus } = chatStub.chatManager;
    const name = bot.twitchUsername;
    chatStub.chatManager.moderatorStatus = () => false;
    bot.twitchUsername = 'synthetic_bot';
    try {
      const card = (await locals(id)).cards.protection;
      assert.deepEqual([card.moderatorNote, card.botName], [true, 'synthetic_bot']);
    } finally {
      chatStub.chatManager.moderatorStatus = moderatorStatus;
      bot.twitchUsername = name;
    }
  });

  test('GET /dashboard/api/cards answers each card\'s status and counts, translated, without the giveaway card', async () => {
    const id = addStreamer({ twitch_user_id: 'tw-wc-4', twitch_username: 'synthetic_wc_4', chatbot_enabled: 0 });
    const res = await request('GET', '/dashboard/api/cards', { streamer: id });
    assert.equal(res.status, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.cards.chatbot.status, { text: t('en', 'cards.chatbot.status.off'), tone: 'off' });
    assert.equal(body.cards.chatbot.counts.thankYous, t('en', 'cards.common.nOfM', { on: 6, total: 6 }), 'a new streamer\'s thank-yous are all on');
    assert.ok(!('giveaways' in body.cards));
  });

  test('only the dashboard gets the wide page', async () => {
    const id = addStreamer();
    assert.match((await request('GET', '/dashboard', { streamer: id })).text, /<div class="container container-wide">/);
    assert.match((await request('GET', '/dashboard/chatbot', { streamer: id })).text, /<div class="container">/);
  });
});
```

Run: `node --test --test-name-pattern="the data of the working cards" src/routes/dashboard.test.js` — Expected: FAIL (`cards` is undefined; 404 for `/api/cards`).

- [ ] **Step 4: The Discord card rows say what each switch stores**

In `discordNotificationsCard()` (`src/routes/dashboard.js`), add to the `row` object, after `subRoles: …`:

```js
      // The working card's switches (services/dashboardCards.js): what each one stores, where the posts go (the
      // channel names, when the bot sees them) and what is set.
      switches: {
        goLive,
        clips,
        recaps: !!server.recap_enabled,
        milestones: !!server.milestones_enabled,
        highlights: !!server.weekly_highlights_enabled,
        subRoles: !!server.sub_sync_enabled,
      },
      liveWhere: liveChannel ? channelName(own.live_channel_id) : null,
      clipsWhere: own && own.clips_channel_id ? channelName(own.clips_channel_id) : null,
      hasLiveChannel: liveChannel,
      hasClipsChannel: !!(own && own.clips_channel_id),
      hasSubRole: !!server.sub_role_id,
```

- [ ] **Step 5: Gather the cards' data**

At the top of `src/routes/dashboard.js` add:

```js
const overlayPresence = require('../services/overlayPresence');
const { buildCards, cardTexts } = require('../services/dashboardCards');
```

Above `router.get('/', …)` add:

```js
// Everything the Twitch tab's working cards show; services/dashboardCards.js decides each card's state from it.
// `discord` is discordNotificationsCard()'s result. Only our own tables and the bot's caches are read.
function gatherCards(req, discord) {
  const s = req.streamer;
  const { chatManager } = require('../services/twitchChat');
  const { hasRedemptionScope } = require('../services/twitch');
  const giveaway = db.getActiveGiveaway(s.id);
  return buildCards({
    streamer: s,
    features: config.features,
    now: Date.now(),
    appUrl: config.app.url,
    bot: { connected: chatManager.isConnected(), moderator: chatManager.moderatorStatus(s.id), username: config.bot.twitchUsername },
    overlay: { url: s.overlay_token ? `${config.app.url}/overlay/${s.overlay_token}` : null, open: overlayPresence.isOpen(s.id) },
    discord,
    commands: db.getChatCommands(s.id),
    bannedWords: db.countBannedWords(s.id),
    modActionsThisWeek: db.countModLog(s.id),
    sponsorMessages: db.getSponsorMessages(s.id),
    tips: { recent: db.getDonations(s.id, { sinceDays: 90, limit: 3 }), count90d: db.countDonations(s.id, { sinceDays: 90 }) },
    tipGoal: db.getActiveTipGoal(s.id),
    rewards: db.getRewards(s.id).filter((r) => !isPendingDelete(r)),
    rewardsAccess: { hasScope: hasRedemptionScope(s) },
    giveaway: giveaway ? { ...giveaway, entryCount: db.getEntryCount(giveaway.id) } : null,
    spotifyConnected: !!s.spotify_access_token,
    multistreamAvailable: !!config.multistream.enabled && !!config.features.youtube,
  });
}
```

In `router.get('/', …)`:
- delete `const { tier, limits } = getTierLimits(req.streamer.id);` (the function stays: other routes use it) and the `iracingSettings` lines;
- after `const discordNotifications = discordNotificationsCard(…);` add `const cards = gatherCards(req, discordNotifications);`;
- in `res.render('dashboard', { … })` remove `tier,`, `limits,`, `iracingSettings,` and add `cards,` and `wideLayout: true, // header.ejs: the dashboard uses the wide container`.

Below the route add:

```js
// The working cards' status lines and counts after a change (public/js/dashboard-cards.js asks after each save).
router.get('/api/cards', (req, res) => {
  const { needsBroadcasterReauth } = require('../services/twitch');
  const servers = db.getGuildsForStreamer(req.streamer.id).map((g) => {
    const discordGuild = client.guilds.cache.get(g.guild_id);
    return {
      ...g,
      name: discordGuild?.name || g.guild_name || res.locals.t('dashboard.unknownServer'),
      icon: null,
      botPresent: !!discordGuild,
      discordGuild,
      watchers: db.getWatchedChannelsForGuild(g.guild_id, req.streamer.id),
    };
  });
  const discord = discordNotificationsCard(req.streamer, servers, { needsReauth: needsBroadcasterReauth(req.streamer) });
  res.json({ ok: true, cards: cardTexts(gatherCards(req, discord), res.locals.t) });
});
```

- [ ] **Step 6: The wide container**

In `src/views/header.ejs` change `  <div class="container">` (the one right after `</nav>`) to:

```ejs
  <div class="container<%= typeof wideLayout !== 'undefined' && wideLayout ? ' container-wide' : '' %>">
```

and below the `.container { … }` rule add:

```css
    /* The dashboard's working cards fill a wide window (routes/dashboard.js passes wideLayout). */
    .container.container-wide { max-width: 1760px; }
```

- [ ] **Step 7: Run the tests and the suite**

Run: `node --test src/routes/dashboard.test.js src/db.cards.test.js` then the full suite — Expected: PASS. The old Twitch tab still renders (its locals are unchanged until Task 14).

- [ ] **Step 8: Document and commit**

`CLAUDE.md`, Dashboard bullet, add: "The Twitch tab's working cards get their state from `services/dashboardCards.js` (`buildCards()`, pure and tested), fed by `gatherCards()` in `routes/dashboard.js`; `GET /dashboard/api/cards` answers their status lines and counts after a change. The dashboard uses a wide container (`wideLayout`, at most 1760 px); every other page keeps 920 px."

```bash
git add src/db.js src/db.cards.test.js src/routes/dashboard.js src/routes/dashboard.test.js src/views/header.ejs CLAUDE.md
git commit -m "feat(dashboard): gather the working cards' data; the dashboard gets a wide page"
```

---

### Task 14: The Twitch tab becomes the working cards

The tab is redrawn from `cards` (Task 13). The texts are added in English to all seven locale files here so the suite passes; Task 15 translates them. Nothing is interactive yet without the script of Tasks 16–17 (switches move but do not save; that is expected until then).

**The markup contract.** This task draws the cards; Tasks 16–17 make them work, relying on exactly this markup:

- The Twitch tab holds, in order: `<div class="dash-top">` (the account row `.dash-acct-row`, then `<div class="card stats-strip">`), `<div class="wc-grid" id="wc-grid">` with the cards, `<div class="wc-live" id="wc-live" aria-live="polite"></div>` and `<dialog class="wc-dialog" id="wc-dialog" aria-labelledby="wc-dialog-title"></dialog>`.
- A card: `<section class="card wc-card[ needs-bot][ gw-running]" id="card-<name>" data-card="<name>" [data-needs-chatbot] aria-labelledby="card-<name>-title">` with `.wc-head` (icon, `<h3 class="wc-title" id="card-<name>-title">`, `<span class="wc-status[ off| warn]" data-status>`, optional head switch), optional `.wc-needs`, `.wc-body`, `<div class="wc-msg" data-msg hidden></div>`, optional `.wc-foot` ending in `<span class="wc-saved" data-saved aria-hidden="true">`, and its `<template>`s.
- A setting control: `<input type="checkbox" role="switch" data-setting="<key>" aria-label="…">` (inside `label.pill-toggle`), `<select data-setting="<key>">` with number values, or the volume `<input type="range" data-setting="overlay_volume" data-scale="100">` with `[data-volume-label]` next to it. Optional `data-guild-id`, `data-id`, `data-fix-href` (the page that sets what a `no_channel`/`no_role`/`no_email` refusal asks for).
- A row: `.wc-row` (`is-off` while its switch is off; `hidden` past the first rows, shown while its list has `show-all`); list rows that can be edited carry `data-row` and their values in `data-*`. A tile: `.wc-sw` (`is-on` while on). A count: `[data-count="<name>"]`. An element that fades while a card's main switch is off: `[data-dim-with="<key>"]` (class `wc-dim`).
- Buttons: `[data-copy="<text>"]` (label in `[data-copy-label]`), `[data-reveal]` next to `code.wc-link[data-masked][data-shown]`, `[data-show-all="<list id>"]`, `[data-open-tab="discord"]`, `[data-edit="thankyou|command|builtins|sponsor|goal"]`, `[data-add="command|sponsor"]`, `[data-delete="command|sponsor"]`, `[data-alert-test="<type>"]`, `[data-reward-test="<id>"]`, `[data-check-moderator]`; the rewards' switches `[data-reward-id]`; the giveaway's `form[data-giveaway-form]` and `[data-giveaway-live]` with `[data-gw-keyword]`, `[data-gw-entries]`, `[data-gw-left]`, `[data-gw-winners]`, `[data-gw-winner]`, `[data-gw-pick]`, `[data-gw-end]`.
- Templates (inside their card): `tpl-thankyou`, `tpl-command`, `tpl-command-row`, `tpl-builtins`, `tpl-sponsor`, `tpl-sponsor-row`, `tpl-goal`. Each editor template is one `.wc-editor` with `<h4 id="wc-dialog-title" data-title>`, its `[data-field]` inputs, `.wc-actions` with `[data-cancel]` and `[data-save]`, and `<div class="wc-msg" data-dialog-msg hidden></div>`.

**Files:**
- Create: `src/views/cards/_style.ejs`, `_icons.ejs`, `chatbot.ejs`, `discord.ejs`, `overlay.ejs`, `commands.ejs`, `sponsors.ejs`, `donations.ejs`, `protection.ejs`, `giveaways.ejs`, `rewards.ejs`, `spotify.ejs`, `multistream.ejs`
- Modify: `src/views/dashboard.ejs` (the Twitch tab; the styles and the copy script of the old cards)
- Modify: `src/routes/dashboard.js` (`GET /` drops the locals only the old cards read)
- Modify: `src/locales/*.json` (the `cards.*` keys below, English in every file for now)
- Modify: `src/routes/dashboard.test.js`, `tests/i18nViewsPart1.test.js`

**Interfaces:**
- Consumes: `cards` and `wideLayout` (Task 13); the card fields of Task 12.
- Produces: the markup contract above.

- [ ] **Step 1: The texts**

Add these keys to `src/locales/en.json`, and the same keys with the same English text to `pt.json`, `es.json`, `fr.json`, `de.json`, `zh.json` and `ja.json` (Task 15 translates them):

```json
"cards.common.nOfM": "{{on}} of {{total}} on",
"cards.common.saved": "Saved",
"cards.common.add": "Add",
"cards.common.edit": "Edit",
"cards.common.delete": "Delete",
"cards.common.cancel": "Cancel",
"cards.common.save": "Save",
"cards.common.showAll": "Show all ({{count}})",
"cards.common.seconds": "{{seconds}} s",
"cards.common.minutes": "{{minutes}} min",
"cards.events.follow": "Follows",
"cards.events.sub": "Subs",
"cards.events.giftsub": "Gift subs",
"cards.events.bits": "Bits",
"cards.events.donation": "Donations",
"cards.events.raid": "Raids",
"cards.events.giveaway": "Giveaway winner",
"cards.chatbot.switch": "Chatbot on or off",
"cards.chatbot.status.online": "Online in #{{channel}}",
"cards.chatbot.status.off": "Off · the bot is not in your chat",
"cards.chatbot.status.connecting": "Connecting to Twitch chat…",
"cards.chatbot.status.noTwitch": "Link your Twitch account first",
"cards.chatbot.setup": "Link your Twitch account so the bot can join your chat, thank your viewers and answer commands.",
"cards.chatbot.thankYous": "Thank-you messages",
"cards.chatbot.noMessage": "No message: nothing is posted",
"cards.chatbot.editMessage": "Change the message",
"cards.chatbot.editTitle": "Thank-you message: {{event}}",
"cards.chatbot.insert": "Insert:",
"cards.chatbot.allSettings": "All chatbot settings",
"cards.discord.channels": "Channels",
"cards.discord.inChannel": "in {{channel}}",
"cards.discord.channelUnknown": "in a channel the bot can't see",
"cards.discord.pickChannel": "pick a channel first",
"cards.discord.recapsHint": "after each stream",
"cards.discord.milestonesHint": "follower and sub goals",
"cards.discord.highlightsHint": "every Monday",
"cards.discord.subRolesHint": "a role for your subs",
"cards.discord.needsLiveChannel": "needs a go-live channel",
"cards.discord.pickRole": "pick a role first",
"cards.discord.notPosted": "not posted in this server yet",
"cards.discord.welcome": "Welcome message",
"cards.discord.addServer": "Add a server",
"cards.overlay.switch": "Alerts on or off",
"cards.overlay.status.open": "Alerts show on stream · open in OBS",
"cards.overlay.status.notOpen": "Alerts on · not open in OBS right now",
"cards.overlay.status.off": "Off · no alerts on stream",
"cards.overlay.source": "Browser source for OBS",
"cards.overlay.reveal": "Show the link (keep it off stream)",
"cards.overlay.createLinkHint": "Get your link, add it to OBS as a browser source, and your alerts show on stream.",
"cards.overlay.createLink": "Create your OBS link",
"cards.overlay.alerts": "Alerts",
"cards.overlay.secondsLabel": "Seconds on screen",
"cards.overlay.testAlert": "Show a test alert in OBS",
"cards.overlay.volume": "Volume",
"cards.overlay.look": "Look and position",
"cards.overlay.sounds": "Sounds",
"cards.commands.title": "Commands",
"cards.commands.status": "Commands: {{commands}} · built-ins on: {{builtins}}",
"cards.commands.needsChatbot": "Turn the chatbot on to use commands.",
"cards.commands.yours": "Your commands",
"cards.commands.none": "No commands yet. Add one, like !discord or !socials.",
"cards.commands.builtins": "Built-in commands",
"cards.commands.choose": "Choose",
"cards.commands.noneOn": "none on",
"cards.commands.newTitle": "New command",
"cards.commands.editTitle": "Edit !{{name}}",
"cards.commands.name": "Command",
"cards.commands.cooldown": "Cooldown",
"cards.commands.answer": "The bot answers",
"cards.commands.answerPlaceholder": "What the bot says in chat",
"cards.commands.builtinsHint": "Pick the ones your chat can use.",
"cards.sponsors.switch": "Sponsor messages on or off",
"cards.sponsors.status.on": "Posting one every {{minutes}} min · messages: {{count}}",
"cards.sponsors.status.off": "Off · messages kept: {{count}}",
"cards.sponsors.needsChatbot": "Turn the chatbot on to post sponsor messages.",
"cards.sponsors.every": "Post one in chat every",
"cards.sponsors.messages": "Messages",
"cards.sponsors.none": "No messages yet. Add one to thank a partner in chat.",
"cards.sponsors.newTitle": "New sponsor message",
"cards.sponsors.editTitle": "Edit sponsor message",
"cards.sponsors.text": "Message",
"cards.sponsors.link": "Link (optional)",
"cards.sponsors.images": "Sponsor images on stream",
"cards.donations.switch": "Tip page on or off",
"cards.donations.status.on": "Tip page on · tips in 90 days: {{count}}",
"cards.donations.status.off": "Tip page off",
"cards.donations.status.setup": "Add your PayPal email to get tips",
"cards.donations.status.noTwitch": "Link Twitch to get your tip page",
"cards.donations.setup": "Add your PayPal email and viewers can tip you on your own tip page. The money goes straight to you.",
"cards.donations.addEmail": "Add PayPal email",
"cards.donations.openPage": "Open the tip page",
"cards.donations.goal": "Tip goal",
"cards.donations.goalOnStream": "on stream as a bar",
"cards.donations.goalAmount": "{{raised}} of {{target}}",
"cards.donations.noGoal": "No goal running.",
"cards.donations.startGoal": "Start a tip goal",
"cards.donations.goalTitle": "Goal",
"cards.donations.goalTarget": "Target",
"cards.donations.endGoal": "End the goal",
"cards.donations.latest": "Latest tips",
"cards.donations.noTips": "No tips in the last 90 days.",
"cards.donations.paypal": "PayPal and currency",
"cards.protection.title": "Chat protection",
"cards.protection.status.on": "Filters on: {{on}} of {{total}}",
"cards.protection.status.off": "All filters off",
"cards.protection.needsChatbot": "Turn the chatbot on to protect your chat.",
"cards.protection.modNote": "Make {{bot}} a moderator: type {{command}} in your chat.",
"cards.protection.checkAgain": "Check again",
"cards.protection.link": "Link protection",
"cards.protection.linkHint": "no links without !permit",
"cards.protection.banned": "Banned words",
"cards.protection.bannedHint": "words: {{count}}",
"cards.protection.caps": "Caps",
"cards.protection.capsHint": "shouting in capitals",
"cards.protection.emotes": "Emote spam",
"cards.protection.emotesHint": "too many emotes",
"cards.protection.repetition": "Repetition",
"cards.protection.repetitionHint": "the same message again",
"cards.protection.symbols": "Symbol spam",
"cards.protection.symbolsHint": "rows of symbols",
"cards.protection.modLog": "Moderation log · this week: {{count}}",
"cards.protection.fineTune": "Fine-tune",
"cards.giveaways.status.none": "No giveaway running",
"cards.giveaways.status.running": "Giveaway running",
"cards.giveaways.needsChatbot": "Turn the chatbot on to run giveaways.",
"cards.giveaways.keyword": "Keyword",
"cards.giveaways.prize": "Prize",
"cards.giveaways.optional": "(optional)",
"cards.giveaways.prizePlaceholder": "e.g. a Steam key",
"cards.giveaways.ends": "Ends",
"cards.giveaways.endsManual": "when I pick",
"cards.giveaways.endsAfter": "after {{minutes}} min",
"cards.giveaways.winners": "Winners",
"cards.giveaways.subsOnly": "Subs only",
"cards.giveaways.start": "Start giveaway",
"cards.giveaways.howToEnter": "Viewers type {{keyword}} in chat to enter",
"cards.giveaways.entries": "Entries",
"cards.giveaways.left": "Left",
"cards.giveaways.pick": "Pick a winner",
"cards.giveaways.end": "End without a winner",
"cards.giveaways.past": "Past giveaways",
"cards.rewards.switch": "Rewards on or off",
"cards.rewards.status.on": "On · rewards: {{count}}",
"cards.rewards.status.empty": "On · no rewards yet",
"cards.rewards.status.off": "Off · redemptions are refunded",
"cards.rewards.status.permission": "Reconnect Twitch to use rewards",
"cards.rewards.status.notAffiliate": "Needs Twitch Affiliate or Partner",
"cards.rewards.permissionText": "Atleta needs your permission on Twitch to manage your channel point rewards.",
"cards.rewards.notAffiliateText": "Channel points come with Twitch Affiliate or Partner. Once you have it, your rewards show up here.",
"cards.rewards.emptyText": "Play a sound or a clip on stream when a viewer spends channel points on one of your rewards.",
"cards.rewards.create": "Create a reward",
"cards.rewards.cost": "{{cost}} points",
"cards.rewards.test": "Play it on stream",
"cards.rewards.history": "Rewards and redemption history"
```

A script that adds them (the same text in every file, each file's keys kept in its order) may be used; run `node --test tests/i18n.test.js` after: it must pass (every key the source names, `cards.*` included, now exists).

- [ ] **Step 2: Styles and icons**

Create `src/views/cards/_style.ejs` — the mockup's card CSS, with the packing behind `.packed` and a `<dialog>` instead of the mockup's overlay:

```ejs
<%# The working cards' styles (views/cards/*.ejs, the Twitch tab of dashboard.ejs), from the approved mockup
    docs/superpowers/specs/assets/2026-10-14-dashboard-cards-mockup.html. %>
<style>
  svg.i { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
  svg.i.sm { width: 14px; height: 14px; }

  /* The switch, as on the chatbot settings page */
  .pill-toggle { position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; }
  .pill-toggle input { opacity: 0; width: 0; height: 0; }
  .pill-toggle .slider { position: absolute; cursor: pointer; inset: 0; background: var(--bg-elevated); border-radius: 24px; border: 1px solid var(--border); transition: 0.3s; }
  .pill-toggle .slider:before { content: ''; position: absolute; height: 18px; width: 18px; left: 2px; bottom: 2px; background: #fff; border-radius: 50%; transition: 0.3s; }
  .pill-toggle input:checked + .slider { background: var(--accent); border-color: var(--accent); }
  .pill-toggle input:checked + .slider:before { transform: translateX(20px); }
  .pill-toggle input:focus-visible + .slider { box-shadow: 0 0 0 3px rgba(145,70,255,.35); }
  .pill-toggle.mini { width: 34px; height: 19px; }
  .pill-toggle.mini .slider:before { height: 13px; width: 13px; }
  .pill-toggle.mini input:checked + .slider:before { transform: translateX(15px); }

  /* The top: the Twitch account, then the last 7 days */
  .dash-top { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
  .dash-top .stats-strip { align-self: stretch; }
  .dash-acct-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .dash-acct { padding: 8px 16px; font-size: 13px; flex: none; }
  span.dash-acct { cursor: default; }
  .stats-strip { display: grid; grid-template-columns: auto repeat(6, 1fr); align-items: center; gap: 8px; padding: 12px 16px; margin: 0; }
  .stats-strip .cap { font: 600 11px var(--font-display); letter-spacing: .5px; text-transform: uppercase; color: var(--text-muted); padding-right: 8px; border-right: 1px solid var(--border); }
  .stats-strip .s { text-align: center; }
  .stats-strip .n { font: 800 18px var(--font-display); }
  .stats-strip .l { font-size: 10px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: .5px; }

  /* The cards: as many columns as the window holds. The page script packs them (.packed: 2 px rows, each card
     spanning its own height, public/js/dashboard-cards.js); without it they stay a plain grid. */
  .wc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr)); gap: 12px; align-items: start; }
  .wc-grid.packed { grid-auto-rows: 2px; row-gap: 0; grid-auto-flow: row dense; }
  .wc-grid.packed > .wc-card { margin-bottom: 12px; }
  .wc-card [hidden], dialog.wc-dialog [hidden] { display: none !important; }

  /* A card: head (icon, title, status, main switch), body (sections), message, foot (links left, Saved right) */
  .wc-card { padding: 20px 22px; margin: 0; display: flex; flex-direction: column; gap: 16px; position: relative; min-width: 0; }
  .wc-head { display: flex; align-items: center; gap: 12px; }
  .wc-icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex: none; }
  .wc-title { font: 700 16px var(--font-display); margin: 0; line-height: 1.2; }
  .wc-status { font-size: 12px; font-weight: 600; color: var(--success); }
  .wc-status.off { color: var(--text-muted); }
  .wc-status.warn { color: var(--warning); }
  .wc-head .pill-toggle { margin-left: auto; }
  .wc-body { display: flex; flex-direction: column; gap: 10px; transition: opacity .2s; }
  .wc-sec { display: flex; align-items: center; gap: 8px; min-height: 28px; margin-top: 2px; }
  .wc-sec:first-child { margin-top: 0; }
  .wc-label { font: 600 11px var(--font-display); letter-spacing: .5px; text-transform: uppercase; color: var(--text-muted); }
  .wc-count { font-size: 12px; color: var(--text-muted); }
  .wc-sec > .btn, .wc-sec > .wc-link-sm, .wc-sec > .wc-count:last-child { margin-left: auto; }
  .wc-list { display: flex; flex-direction: column; gap: 6px; transition: opacity .2s; }
  .wc-row { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 0 6px 0 10px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 10px; font-size: 13px; min-width: 0; transition: opacity .2s; }
  .wc-row.is-off .nm, .wc-row.is-off .txt { opacity: .45; }
  .wc-row .nm { font-weight: 600; color: var(--text-primary); flex: 0 0 auto; min-width: 76px; }
  .wc-row code.nm { font: 600 12.5px ui-monospace, Menlo, monospace; color: var(--accent-hover); min-width: 0; }
  .wc-row .txt { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
  .wc-row .when { color: var(--text-muted); font-size: 12px; flex: none; padding-right: 6px; }
  .wc-row .amt { font: 700 13px var(--font-display); color: var(--success); flex: none; }
  .wc-row.hidden { display: none; }
  .wc-list.show-all > .wc-row.hidden { display: flex; }
  .wc-ib { width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: var(--text-muted); cursor: pointer; flex: none; background: none; border: none; }
  .wc-ib:hover { background: var(--bg-hover); color: var(--text-primary); }
  .wc-ib.done { color: var(--success); }
  .wc-more { background: none; border: none; color: var(--text-secondary); font: 600 12px var(--font-body); cursor: pointer; padding: 0; text-align: left; align-self: flex-start; }
  .wc-more:hover { color: var(--text-primary); }
  .wc-input, .wc-select { padding: 8px 10px; background: var(--bg-base); border: 1px solid var(--border); border-radius: 8px; color: var(--text-primary); font: 500 13px var(--font-body); min-width: 0; }
  .wc-select { font: 600 13px var(--font-display); cursor: pointer; }
  .wc-select.sm { padding: 5px 8px; font-size: 12px; }
  .wc-input:focus, .wc-select:focus, .wc-editor textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(145,70,255,.12); }
  .wc-btn { padding: 8px 14px; font-size: 12px; }
  .wc-btn.xs { padding: 5px 11px; font-size: 12px; gap: 5px; }
  .wc-btn.block { width: 100%; padding: 10px 14px; }
  .wc-setrow { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 13px; color: var(--text-secondary); }
  .wc-foot { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 16px; font-size: 12px; padding-top: 12px; border-top: 1px solid var(--border); margin-top: auto; }
  .wc-foot a, .wc-link-sm, .wc-linkbtn { color: var(--text-secondary); text-decoration: none; font-weight: 600; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
  .wc-foot a:hover, .wc-link-sm:hover, .wc-linkbtn:hover { color: var(--text-primary); }
  .wc-linkbtn { background: none; border: none; padding: 0; font-family: var(--font-body); }
  .wc-inline-form { margin: 0; }
  .wc-saved { margin-left: auto; color: var(--success); font-weight: 600; display: inline-flex; align-items: center; gap: 4px; opacity: 0; transition: opacity .25s; }
  .wc-saved.show { opacity: 1; }
  .wc-msg { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; font-size: 12.5px; line-height: 1.45; color: var(--danger); background: var(--danger-bg); border-radius: 10px; padding: 8px 12px; }
  .wc-msg.info { color: var(--text-secondary); background: var(--bg-elevated); }
  .wc-msg a { color: inherit; font-weight: 600; text-decoration: underline; }
  .wc-live { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

  /* Building blocks */
  .wc-linkbox { display: flex; gap: 8px; align-items: center; transition: opacity .2s; }
  .wc-link { flex: 1; min-width: 0; padding: 9px 12px; background: var(--bg-base); border: 1px solid var(--border); border-radius: 8px; font: 500 12px ui-monospace, Menlo, monospace; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wc-switches { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .wc-sw { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 10px; font-size: 13px; font-weight: 600; color: var(--text-secondary); min-width: 0; }
  .wc-sw.is-on { color: var(--text-primary); }
  .wc-sw > span { display: flex; flex-direction: column; min-width: 0; }
  .wc-sw small { font-size: 11px; font-weight: 500; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wc-sw small.warn { color: var(--warning); }
  .wc-server { display: flex; flex-direction: column; gap: 10px; }
  .wc-server-name { display: flex; align-items: center; gap: 8px; font: 700 13px var(--font-display); min-width: 0; }
  .wc-server-name .av { width: 22px; height: 22px; border-radius: 6px; background: #5865F2; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 11px; flex: none; }
  .wc-server-name .sn { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wc-server-name .wc-off-tag { font-size: 11px; color: var(--text-muted); font-weight: 600; flex: none; }
  .wc-server-name .wc-link-sm { margin-left: auto; flex: none; }
  .wc-pills { display: flex; flex-wrap: wrap; gap: 6px; }
  .wc-pill { font: 600 12px ui-monospace, Menlo, monospace; color: var(--accent-hover); background: rgba(145,70,255,0.12); border: 1px solid rgba(145,70,255,0.3); padding: 3px 9px; border-radius: 999px; }
  .wc-pill.none { font-family: var(--font-body); color: var(--text-muted); background: none; border-style: dashed; }
  .wc-chips { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .wc-chip { display: flex; align-items: center; gap: 7px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-secondary); font: 600 12.5px ui-monospace, Menlo, monospace; cursor: pointer; user-select: none; min-width: 0; text-align: left; }
  .wc-chip.on { background: rgba(145,70,255,0.14); border-color: rgba(145,70,255,0.45); color: var(--text-primary); }
  .wc-chip .tick { width: 16px; height: 16px; border-radius: 5px; border: 1.5px solid var(--text-muted); display: flex; align-items: center; justify-content: center; flex: none; color: transparent; font-size: 11px; line-height: 1; }
  .wc-chip.on .tick { background: var(--accent); border-color: var(--accent); color: #fff; }
  .wc-note { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; background: var(--warning-bg); border: 1px solid rgba(247,144,9,0.25); color: var(--text-secondary); border-radius: 10px; padding: 9px 10px 9px 12px; font-size: 12.5px; }
  .wc-note > span { flex: 1 1 180px; min-width: 0; }
  .wc-note code { color: var(--text-primary); background: rgba(255,255,255,.06); padding: 1px 6px; border-radius: 5px; white-space: nowrap; }
  .wc-note a { color: var(--warning); text-decoration: underline; }
  .wc-hint { font-size: 12px; color: var(--text-muted); margin: 0; }
  .wc-hint code, .wc-text code { color: var(--text-primary); }
  .wc-text { font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin: 0; }
  .wc-alert select { margin-left: auto; }
  .wc-volume { display: flex; align-items: center; gap: 10px; color: var(--text-secondary); font-size: 13px; padding: 2px 2px 0; }
  .wc-volume input[type=range] { flex: 1; accent-color: var(--accent); }
  .wc-volume .v { width: 38px; text-align: right; font: 600 12px var(--font-display); color: var(--text-primary); }
  .wc-goal { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  .wc-goal .top { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; font-size: 13px; }
  .wc-goal .top b { color: var(--text-primary); }
  .wc-goal .top span { margin-left: auto; font: 700 13px var(--font-display); color: var(--text-primary); }
  .wc-goal .top em { font-style: normal; color: var(--text-muted); font-weight: 500; }
  .wc-progress { height: 8px; background: var(--bg-base); border-radius: 99px; overflow: hidden; }
  .wc-progress > span { display: block; height: 100%; background: linear-gradient(90deg, #9146ff, #3ecf8e); border-radius: 99px; }
  .wc-fields { display: flex; gap: 10px; align-items: flex-end; }
  .wc-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .wc-field > span:first-child { font: 600 11px var(--font-display); letter-spacing: .5px; text-transform: uppercase; color: var(--text-muted); }
  .wc-field > span:first-child em { text-transform: none; font-style: normal; font-weight: 500; }
  .wc-field.grow { flex: 1; }
  .wc-field .pill-toggle { margin: 7px 0; }
  .wc-prefixed { display: flex; align-items: center; background: var(--bg-base); border: 1px solid var(--border); border-radius: 8px; padding-left: 10px; }
  .wc-prefixed b { color: var(--text-muted); font-weight: 600; }
  .wc-prefixed .wc-input { border: none; background: none; padding-left: 2px; width: 100%; }
  .wc-empty { display: flex; gap: 12px; align-items: center; padding: 12px; border: 1px dashed var(--border); border-radius: 10px; color: var(--text-secondary); font-size: 13px; line-height: 1.45; }
  .wc-empty .big { width: 36px; height: 36px; border-radius: 10px; background: rgba(145,70,255,0.12); color: var(--accent-hover); display: flex; align-items: center; justify-content: center; flex: none; }
  .wc-needs { display: none; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-secondary); background: var(--bg-elevated); border: 1px dashed rgba(145,70,255,0.4); border-radius: 10px; padding: 8px 12px; }
  .wc-card.needs-bot .wc-needs { display: flex; }
  .wc-card.needs-bot .wc-body { opacity: .35; pointer-events: none; }
  .wc-dim { opacity: .45; }
  .wc-gw-form { display: flex; flex-direction: column; gap: 12px; }
  .wc-gw-live { display: none; flex-direction: column; gap: 10px; }
  .wc-card.gw-running .wc-gw-live { display: flex; }
  .wc-card.gw-running .wc-gw-form { display: none; }
  .wc-gw-how { color: var(--text-primary); font-weight: 600; }
  .wc-gw-how code { color: var(--accent-hover); }
  .wc-gw-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .wc-gw-stats div { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 10px; padding: 8px; text-align: center; }
  .wc-gw-stats b { display: block; font: 800 18px var(--font-display); }
  .wc-gw-stats span { font-size: 10px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: .5px; }
  .wc-winner { display: none; align-items: center; gap: 8px; background: rgba(245,158,11,0.12); border: 1px solid rgba(245,158,11,0.35); border-radius: 10px; padding: 9px 12px; font-weight: 700; font-size: 13px; }
  .wc-winner.show { display: flex; }
  .pulse-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); flex: none; animation: pulse-red 1.4s infinite; }
  @keyframes pulse-red { 0% { box-shadow: 0 0 0 0 rgba(240,68,56,.6); } 70% { box-shadow: 0 0 0 8px rgba(240,68,56,0); } 100% { box-shadow: 0 0 0 0 rgba(240,68,56,0); } }
  .wc-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
  .wc-left { margin-right: auto; }
  .wc-danger { color: var(--danger); }

  /* The pop-up editor */
  dialog.wc-dialog { width: min(540px, calc(100vw - 32px)); max-height: calc(100vh - 32px); padding: 18px; margin: auto; border: 1px solid rgba(145,70,255,0.4); border-radius: 14px; background: var(--bg-surface); color: var(--text-primary); }
  dialog.wc-dialog::backdrop { background: rgba(5,5,10,.65); }
  .wc-editor { display: flex; flex-direction: column; gap: 10px; }
  .wc-editor h4 { margin: 0; font: 700 15px var(--font-display); }
  .wc-editor textarea { width: 100%; min-height: 76px; resize: vertical; padding: 10px 12px; background: var(--bg-base); border: 1px solid var(--border); border-radius: 8px; color: var(--text-primary); font: 500 13px/1.5 var(--font-body); box-sizing: border-box; }
  .wc-vars { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 11px; color: var(--text-muted); }
  .wc-vars .wc-var { background: var(--bg-elevated); padding: 2px 7px; border-radius: 6px; cursor: pointer; color: var(--text-secondary); border: none; font: 500 11px ui-monospace, Menlo, monospace; }
  .wc-vars .wc-var:hover { color: var(--text-primary); }

  @media (max-width: 760px) {
    .stats-strip { grid-template-columns: repeat(3, 1fr); row-gap: 10px; }
    .stats-strip .cap { grid-column: 1 / -1; border-right: none; padding: 0; }
  }
  @media (max-width: 420px) {
    .wc-switches { grid-template-columns: minmax(0, 1fr); }
    .wc-chips { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .wc-row .nm { min-width: 0; }
    .wc-fields { flex-wrap: wrap; }
  }
</style>
```

Create `src/views/cards/_icons.ejs` — the mockup's sprite (lines 838–862) without the Discord symbol, plus a video symbol for Multistream:

```ejs
<%# The icons the working cards use (<svg class="i"><use href="#i-…"/></svg>). %>
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <symbol id="i-chat" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></symbol>
  <symbol id="i-term" viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></symbol>
  <symbol id="i-mega" viewBox="0 0 24 24"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></symbol>
  <symbol id="i-dollar" viewBox="0 0 24 24"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></symbol>
  <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></symbol>
  <symbol id="i-bell" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></symbol>
  <symbol id="i-music" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></symbol>
  <symbol id="i-gift" viewBox="0 0 24 24"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></symbol>
  <symbol id="i-monitor" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></symbol>
  <symbol id="i-spark" viewBox="0 0 24 24"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></symbol>
  <symbol id="i-pen" viewBox="0 0 24 24"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></symbol>
  <symbol id="i-trash" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></symbol>
  <symbol id="i-copy" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></symbol>
  <symbol id="i-ext" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></symbol>
  <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></symbol>
  <symbol id="i-check" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></symbol>
  <symbol id="i-plus" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></symbol>
  <symbol id="i-warn" viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></symbol>
  <symbol id="i-right" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></symbol>
  <symbol id="i-play" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></symbol>
  <symbol id="i-vol" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></symbol>
  <symbol id="i-twitch" viewBox="0 0 24 24"><path d="M21 2H3v16h5v4l4-4h5l4-4V2zM11 11V7M16 11V7"/></symbol>
  <symbol id="i-video" viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></symbol>
</svg>
```

- [ ] **Step 3: The card partials**

Every partial gets, besides the page's own locals (`t`, `lang`, `streamer`, `features`, `botInviteUrl`, `unclaimedGuilds`, …), `card` (its entry of `cards`), `cards` and `around` (dashboard.ejs's `_around`). Create them exactly as below.

`src/views/cards/chatbot.ejs`:

```ejs
<%# The Chatbot card (services/dashboardCards.js chatbotCard()): the chatbot's switch and the six thank-you messages,
    each with its switch and the pop-up that changes its words (public/js/dashboard-cards.js). %>
<section class="card wc-card" id="card-chatbot" data-card="chatbot" aria-labelledby="card-chatbot-title">
  <div class="wc-head">
    <div class="wc-icon" style="background: rgba(145,71,255,0.15); color: #9146ff"><svg class="i" aria-hidden="true"><use href="#i-chat"/></svg></div>
    <div><h3 class="wc-title" id="card-chatbot-title"><%= t('dashboard.cards.chatbot.title') %></h3><span class="wc-status<%= card.status.tone === 'ok' ? '' : ' ' + card.status.tone %>" data-status><%= t(card.status.key, card.status.params) %></span></div>
    <% if (!card.setup) { %><label class="pill-toggle" title="<%= t('cards.chatbot.switch') %>"><input type="checkbox" role="switch" aria-label="<%= t('cards.chatbot.switch') %>" data-setting="chatbot_enabled" <%= card.on ? 'checked' : '' %>><span class="slider"></span></label><% } %>
  </div>
  <div class="wc-body">
  <% if (card.setup === 'linkTwitch') { %>
    <div class="wc-empty"><span class="big"><svg class="i" aria-hidden="true"><use href="#i-twitch"/></svg></span><div><%= t('cards.chatbot.setup') %></div></div>
    <a href="/auth/twitch" class="btn btn-primary wc-btn block"><%= t('dashboard.linkTwitch') %></a>
  <% } else { %>
    <div class="wc-sec"><span class="wc-label"><%= t('cards.chatbot.thankYous') %></span><span class="wc-count" data-count="thankYous"><%= t(card.counts.thankYous.key, card.counts.thankYous.params) %></span></div>
    <div class="wc-list<%= card.on ? '' : ' wc-dim' %>" data-dim-with="chatbot_enabled">
      <% for (const ty of card.thankYous) { %>
      <div class="wc-row<%= ty.on ? '' : ' is-off' %>">
        <label class="pill-toggle mini"><input type="checkbox" role="switch" aria-label="<%= t(ty.label) %>" data-setting="<%= ty.switchKey %>" <%= ty.on ? 'checked' : '' %>><span class="slider"></span></label>
        <span class="nm"><%= t(ty.label) %></span>
        <span class="txt" data-text><%= ty.text || t('cards.chatbot.noMessage') %></span>
        <button type="button" class="wc-ib" data-edit="thankyou" data-key="<%= ty.textKey %>" data-event="<%= ty.event %>" data-vars="<%= ty.vars.join(' ') %>" data-value="<%= ty.text %>" data-title="<%= t('cards.chatbot.editTitle', { event: t(ty.label) }) %>" title="<%= t('cards.chatbot.editMessage') %>" aria-label="<%= t('cards.chatbot.editMessage') %>: <%= t(ty.label) %>"><svg class="i sm" aria-hidden="true"><use href="#i-pen"/></svg></button>
      </div>
      <% } %>
    </div>
  <% } %>
  </div>
  <div class="wc-msg" data-msg hidden></div>
  <div class="wc-foot"><a href="/dashboard/chatbot"><%= t('cards.chatbot.allSettings') %> <svg class="i sm" aria-hidden="true"><use href="#i-right"/></svg></a><span class="wc-saved" data-saved aria-hidden="true"><svg class="i sm" aria-hidden="true"><use href="#i-check"/></svg><%= t('cards.common.saved') %></span></div>
  <template id="tpl-thankyou">
    <div class="wc-editor">
      <h4 id="wc-dialog-title" data-title></h4>
      <textarea data-field="text" maxlength="500" rows="3"></textarea>
      <div class="wc-vars"><span><%= t('cards.chatbot.insert') %></span><span data-vars></span></div>
      <div class="wc-actions"><button type="button" class="btn btn-secondary wc-btn wc-left" data-chat-test><%= t('chatbot.events.testInChat') %></button><button type="button" class="btn btn-secondary wc-btn" data-cancel><%= t('cards.common.cancel') %></button><button type="button" class="btn btn-primary wc-btn" data-save><%= t('cards.common.save') %></button></div>
      <div class="wc-msg" data-dialog-msg hidden></div>
    </div>
  </template>
</section>
```

`src/views/cards/discord.ejs`:

```ejs
<%# The Discord notifications card (dashboardCards.js discordCard(), from discordNotificationsCard() in
    routes/dashboard.js): per claimed server, six switches that save at once, each with where its posts go or what is
    missing. Without a linked Twitch account or a server it shows the one step to take. %>
<section class="card wc-card" id="card-discord" data-card="discord" aria-labelledby="card-discord-title">
  <div class="wc-head">
    <div class="wc-icon" style="background: rgba(88,101,242,0.15); color: #5865F2"><svg class="i" aria-hidden="true"><use href="#i-bell"/></svg></div>
    <div><h3 class="wc-title" id="card-discord-title"><%= t('dashboard.cards.discord.title') %></h3><span class="wc-status<%= card.status.tone === 'ok' ? '' : ' ' + card.status.tone %>" data-status><%= t(card.status.key, card.status.params) %></span></div>
  </div>
  <div class="wc-body">
  <% if (card.setup === 'linkTwitch') { %>
    <div class="wc-empty"><span class="big"><svg class="i" aria-hidden="true"><use href="#i-twitch"/></svg></span><div><%= t('dashboard.cards.discord.noTwitch') %></div></div>
    <a href="/auth/twitch" class="btn btn-primary wc-btn block"><%= t('dashboard.linkTwitch') %></a>
  <% } else if (card.setup === 'addServer') { %>
    <div class="wc-empty"><span class="big"><svg class="i" aria-hidden="true"><use href="#i-bell"/></svg></span><div><%= t('dashboard.cards.discord.noServer') %></div></div>
    <a href="<%= botInviteUrl %>" target="_blank" rel="noopener" class="btn btn-primary wc-btn block"><%= t('dashboard.addBot') %></a>
    <% for (const g of unclaimedGuilds) { %>
    <form method="POST" action="/dashboard/claim/<%= g.id %>" class="wc-row wc-inline-form"><span class="nm"><%= g.name %></span><span class="txt"></span><button type="submit" class="btn btn-secondary wc-btn xs"><%= t('dashboard.claim') %></button></form>
    <% } %>
  <% } else { %>
    <% for (const s of card.servers) { %>
    <div class="wc-server" data-guild="<%= s.guildId %>">
      <div class="wc-server-name"><span class="av" aria-hidden="true"><%= String(s.name || '?').charAt(0).toUpperCase() %></span><span class="sn"><%= s.name %></span><% if (!s.botPresent) { %><span class="wc-off-tag"><%= t('dashboard.offline') %></span><% } %><a class="wc-link-sm" href="<%= s.url %>"><%= t('cards.discord.channels') %> <svg class="i sm" aria-hidden="true"><use href="#i-right"/></svg></a></div>
      <div class="wc-switches">
        <% for (const sw of s.switches) { %>
        <div class="wc-sw<%= sw.on ? ' is-on' : '' %>"><span><%= t(sw.label) %><small class="<%= sw.hint.warn ? 'warn' : '' %>"><%= t(sw.hint.key, sw.hint.params) %></small></span><label class="pill-toggle mini"><input type="checkbox" role="switch" aria-label="<%= t(sw.label) %> · <%= s.name %>" data-setting="<%= sw.key %>" data-guild-id="<%= s.guildId %>" data-fix-href="/dashboard/guild/<%= s.guildId %>?tab=<%= sw.fix %>" <%= sw.on ? 'checked' : '' %>><span class="slider"></span></label></div>
        <% } %>
      </div>
    </div>
    <% } %>
    <% if (card.needsAuth) { const _auth = around('dashboard.cards.discord.authNote', 'link'); %>
    <div class="wc-note"><svg class="i sm" aria-hidden="true" style="color: var(--warning)"><use href="#i-warn"/></svg><span><%= _auth[0] %><a href="/auth/broadcaster"><%= card.authAction === 'reconnect' ? t('dashboard.reconnect.cta') : t('dashboard.enableSubSync') %></a><%= _auth[1] %></span></div>
    <% } %>
  <% } %>
  </div>
  <div class="wc-msg" data-msg hidden></div>
  <% if (!card.setup) { %>
  <div class="wc-foot">
    <% if (card.servers.length === 1) { %><a href="/dashboard/guild/<%= card.servers[0].guildId %>?tab=discord"><%= t('cards.discord.welcome') %> <svg class="i sm" aria-hidden="true"><use href="#i-right"/></svg></a><% } %>
    <a href="#tab-discord" data-open-tab="discord"><%= t('cards.discord.addServer') %> <svg class="i sm" aria-hidden="true"><use href="#i-right"/></svg></a>
    <span class="wc-saved" data-saved aria-hidden="true"><svg class="i sm" aria-hidden="true"><use href="#i-check"/></svg><%= t('cards.common.saved') %></span>
  </div>
  <% } %>
</section>
```

`src/views/cards/overlay.ejs`:

```ejs
<%# The OBS overlay card (with features.overlays; dashboardCards.js overlayCard()): the alerts' on/off switch, the
    browser source link (masked until the eye is clicked), each alert's switch, seconds on screen and test, and the
    volume. %>
<section class="card wc-card" id="card-overlay" data-card="overlay" aria-labelledby="card-overlay-title">
  <div class="wc-head">
    <div class="wc-icon" style="background: rgba(224,64,251,0.13); color: #e040fb"><svg class="i" aria-hidden="true"><use href="#i-monitor"/></svg></div>
    <div><h3 class="wc-title" id="card-overlay-title"><%= t('dashboard.cards.overlay.title') %></h3><span class="wc-status<%= card.status.tone === 'ok' ? '' : ' ' + card.status.tone %>" data-status><%= t(card.status.key, card.status.params) %></span></div>
    <label class="pill-toggle" title="<%= t('cards.overlay.switch') %>"><input type="checkbox" role="switch" aria-label="<%= t('cards.overlay.switch') %>" data-setting="overlay_enabled" <%= card.on ? 'checked' : '' %>><span class="slider"></span></label>
  </div>
  <div class="wc-body">
    <div class="wc-sec"><span class="wc-label"><%= t('cards.overlay.source') %></span></div>
    <% if (card.url) { %>
    <div class="wc-linkbox">
      <code class="wc-link" data-masked="<%= card.masked %>" data-shown="<%= card.shown %>"><%= card.masked %></code>
      <button type="button" class="btn btn-secondary wc-btn" data-reveal aria-pressed="false" title="<%= t('cards.overlay.reveal') %>" aria-label="<%= t('cards.overlay.reveal') %>"><svg class="i sm" aria-hidden="true"><use href="#i-eye"/></svg></button>
      <button type="button" class="btn btn-secondary wc-btn" data-copy="<%= card.url %>"><svg class="i sm" aria-hidden="true"><use href="#i-copy"/></svg><span data-copy-label><%= t('dashboard.copy') %></span></button>
    </div>
    <% } else { %>
    <div class="wc-empty"><span class="big"><svg class="i" aria-hidden="true"><use href="#i-monitor"/></svg></span><div><%= t('cards.overlay.createLinkHint') %></div></div>
    <form method="POST" action="/dashboard/overlay/generate-token" class="wc-inline-form"><button type="submit" class="btn btn-primary wc-btn block"><%= t('cards.overlay.createLink') %></button></form>
    <% } %>
    <div class="wc-sec"><span class="wc-label"><%= t('cards.overlay.alerts') %></span><span class="wc-count" data-count="alerts"><%= t(card.counts.alerts.key, card.counts.alerts.params) %></span></div>
    <div class="wc-list<%= card.on ? '' : ' wc-dim' %>" data-dim-with="overlay_enabled">
      <% for (const a of card.alerts) { %>
      <div class="wc-row wc-alert<%= a.on ? '' : ' is-off' %>">
        <label class="pill-toggle mini"><input type="checkbox" role="switch" aria-label="<%= t(a.label) %>" data-setting="<%= a.switchKey %>" <%= a.on ? 'checked' : '' %>><span class="slider"></span></label>
        <span class="nm"><%= t(a.label) %></span>
        <select class="wc-select sm" data-setting="<%= a.durationKey %>" aria-label="<%= t('cards.overlay.secondsLabel') %>: <%= t(a.label) %>"><% for (const s of a.choices) { %><option value="<%= s %>"<%= s === a.seconds ? ' selected' : '' %>><%= t('cards.common.seconds', { seconds: s }) %></option><% } %></select>
        <button type="button" class="wc-ib" data-alert-test="<%= a.test %>" title="<%= t('cards.overlay.testAlert') %>" aria-label="<%= t('cards.overlay.testAlert') %>: <%= t(a.label) %>"><svg class="i sm" aria-hidden="true"><use href="#i-play"/></svg></button>
      </div>
      <% } %>
    </div>
    <div class="wc-volume"><svg class="i sm" aria-hidden="true"><use href="#i-vol"/></svg><%= t('cards.overlay.volume') %><input type="range" min="0" max="100" step="1" value="<%= card.volume %>" data-setting="overlay_volume" data-scale="100" aria-label="<%= t('cards.overlay.volume') %>"><span class="v" data-volume-label><%= card.volume %>%</span></div>
  </div>
  <div class="wc-msg" data-msg hidden></div>
  <div class="wc-foot"><a href="/dashboard/overlay-builder"><%= t('cards.overlay.look') %> <svg class="i sm" aria-hidden="true"><use href="#i-right"/></svg></a><a href="/dashboard/overlay"><%= t('cards.overlay.sounds') %> <svg class="i sm" aria-hidden="true"><use href="#i-right"/></svg></a><span class="wc-saved" data-saved aria-hidden="true"><svg class="i sm" aria-hidden="true"><use href="#i-check"/></svg><%= t('cards.common.saved') %></span></div>
</section>
```

`src/views/cards/commands.ejs`:

```ejs
<%# The Commands card (dashboardCards.js commandsCard()): the streamer's !commands, added, changed and deleted in a
    pop-up (/dashboard/api/commands), and the built-in commands that are on, chosen in a pop-up and saved together.
    Faded while the chatbot is off. %>
<section class="card wc-card<%= cards.chatbotOn ? '' : ' needs-bot' %>" id="card-commands" data-card="commands" data-needs-chatbot aria-labelledby="card-commands-title">
  <div class="wc-head">
    <div class="wc-icon" style="background: rgba(0,200,180,0.13); color: #2dd4bf"><svg class="i" aria-hidden="true"><use href="#i-term"/></svg></div>
    <div><h3 class="wc-title" id="card-commands-title"><%= t('cards.commands.title') %></h3><span class="wc-status<%= card.status.tone === 'ok' ? '' : ' ' + card.status.tone %>" data-status><%= t(card.status.key, card.status.params) %></span></div>
  </div>
  <div class="wc-needs"><svg class="i sm" aria-hidden="true"><use href="#i-chat"/></svg><%= t('cards.commands.needsChatbot') %></div>
  <div class="wc-body">
    <div class="wc-sec"><span class="wc-label"><%= t('cards.commands.yours') %></span><span class="wc-count" data-count="commands"><%= card.counts.commands.text %></span><button type="button" class="btn btn-primary wc-btn xs" data-add="command" data-title="<%= t('cards.commands.newTitle') %>"><svg class="i sm" aria-hidden="true"><use href="#i-plus"/></svg><%= t('cards.common.add') %></button></div>
    <div class="wc-list" id="wc-commands" data-list="commands">
      <% for (const c of card.commands) { %>
      <div class="wc-row<%= c.extra ? ' hidden' : '' %>" data-row data-id="<%= c.id %>" data-name="<%= c.name %>" data-response="<%= c.response %>" data-cooldown="<%= c.cooldown %>">
        <code class="nm">!<span data-field="name"><%= c.name %></span></code><span class="txt" data-field="response"><%= c.response %></span>
        <button type="button" class="wc-ib" data-edit="command" data-title="<%= t('cards.commands.editTitle', { name: c.name }) %>" title="<%= t('cards.common.edit') %>" aria-label="<%= t('cards.common.edit') %>"><svg class="i sm" aria-hidden="true"><use href="#i-pen"/></svg></button>
        <button type="button" class="wc-ib" data-delete="command" title="<%= t('cards.common.delete') %>" aria-label="<%= t('cards.common.delete') %>"><svg class="i sm" aria-hidden="true"><use href="#i-trash"/></svg></button>
      </div>
      <% } %>
    </div>
    <p class="wc-hint" data-empty="commands"<%= card.commands.length ? ' hidden' : '' %>><%= t('cards.commands.none') %></p>
    <% if (card.commands.some((c) => c.extra)) { %><button type="button" class="wc-more" data-show-all="wc-commands"><%= t('cards.common.showAll', { count: card.commands.length }) %></button><% } %>
    <div class="wc-sec"><span class="wc-label"><%= t('cards.commands.builtins') %></span><span class="wc-count" data-count="builtins"><%= t(card.counts.builtins.key, card.counts.builtins.params) %></span><button type="button" class="btn btn-secondary wc-btn xs" data-edit="builtins" data-title="<%= t('cards.commands.builtins') %>"><%= t('cards.commands.choose') %></button></div>
    <div class="wc-pills">
      <% for (const b of card.builtins) { %><code class="wc-pill" data-builtin="<%= b.key %>" data-name="<%= b.name %>"<%= b.on ? '' : ' hidden' %>><%= b.name %></code><% } %>
      <span class="wc-pill none" data-builtins-none<%= card.builtins.some((b) => b.on) ? ' hidden' : '' %>><%= t('cards.commands.noneOn') %></span>
    </div>
  </div>
  <div class="wc-msg" data-msg hidden></div>
  <div class="wc-foot"><span class="wc-saved" data-saved aria-hidden="true"><svg class="i sm" aria-hidden="true"><use href="#i-check"/></svg><%= t('cards.common.saved') %></span></div>
  <template id="tpl-command">
    <div class="wc-editor">
      <h4 id="wc-dialog-title" data-title></h4>
      <div class="wc-fields">
        <label class="wc-field grow"><span><%= t('cards.commands.name') %></span><span class="wc-prefixed"><b aria-hidden="true">!</b><input class="wc-input" data-field="command" maxlength="50" autocomplete="off" spellcheck="false"></span></label>
        <label class="wc-field"><span><%= t('cards.commands.cooldown') %></span><select class="wc-select" data-field="cooldown"><% for (const s of [5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]) { %><option value="<%= s %>"><%= t('cards.common.seconds', { seconds: s }) %></option><% } %></select></label>
      </div>
      <label class="wc-field"><span><%= t('cards.commands.answer') %></span><textarea data-field="response" maxlength="500" rows="3" placeholder="<%= t('cards.commands.answerPlaceholder') %>"></textarea></label>
      <div class="wc-actions"><button type="button" class="btn btn-secondary wc-btn" data-cancel><%= t('cards.common.cancel') %></button><button type="button" class="btn btn-primary wc-btn" data-save><%= t('cards.common.save') %></button></div>
      <div class="wc-msg" data-dialog-msg hidden></div>
    </div>
  </template>
  <template id="tpl-command-row">
    <div class="wc-row" data-row>
      <code class="nm">!<span data-field="name"></span></code><span class="txt" data-field="response"></span>
      <button type="button" class="wc-ib" data-edit="command" title="<%= t('cards.common.edit') %>" aria-label="<%= t('cards.common.edit') %>"><svg class="i sm" aria-hidden="true"><use href="#i-pen"/></svg></button>
      <button type="button" class="wc-ib" data-delete="command" title="<%= t('cards.common.delete') %>" aria-label="<%= t('cards.common.delete') %>"><svg class="i sm" aria-hidden="true"><use href="#i-trash"/></svg></button>
    </div>
  </template>
  <template id="tpl-builtins">
    <div class="wc-editor">
      <h4 id="wc-dialog-title" data-title></h4>
      <p class="wc-hint"><%= t('cards.commands.builtinsHint') %></p>
      <div class="wc-chips" data-chips></div>
      <div class="wc-actions"><button type="button" class="btn btn-secondary wc-btn" data-cancel><%= t('cards.common.cancel') %></button><button type="button" class="btn btn-primary wc-btn" data-save><%= t('cards.common.save') %></button></div>
      <div class="wc-msg" data-dialog-msg hidden></div>
    </div>
  </template>
</section>
```

`src/views/cards/sponsors.ejs`:

```ejs
<%# The Sponsor messages card (dashboardCards.js sponsorsCard()): the switch and the interval of the chat rotation, and
    the messages, each with its switch, edited in a pop-up. Faded while the chatbot is off. %>
<section class="card wc-card<%= cards.chatbotOn ? '' : ' needs-bot' %>" id="card-sponsors" data-card="sponsors" data-needs-chatbot aria-labelledby="card-sponsors-title">
  <div class="wc-head">
    <div class="wc-icon" style="background: rgba(255,152,0,0.13); color: #ff9800"><svg class="i" aria-hidden="true"><use href="#i-mega"/></svg></div>
    <div><h3 class="wc-title" id="card-sponsors-title"><%= t('sponsors.title') %></h3><span class="wc-status<%= card.status.tone === 'ok' ? '' : ' ' + card.status.tone %>" data-status><%= t(card.status.key, card.status.params) %></span></div>
    <label class="pill-toggle" title="<%= t('cards.sponsors.switch') %>"><input type="checkbox" role="switch" aria-label="<%= t('cards.sponsors.switch') %>" data-setting="sponsor_send_chat" <%= card.on ? 'checked' : '' %>><span class="slider"></span></label>
  </div>
  <div class="wc-needs"><svg class="i sm" aria-hidden="true"><use href="#i-chat"/></svg><%= t('cards.sponsors.needsChatbot') %></div>
  <div class="wc-body">
    <div class="wc-setrow"><span><%= t('cards.sponsors.every') %></span><select class="wc-select" data-setting="sponsor_chat_interval_minutes" aria-label="<%= t('cards.sponsors.every') %>"><% for (const m of card.intervals) { %><option value="<%= m %>"<%= m === card.minutes ? ' selected' : '' %>><%= t('cards.common.minutes', { minutes: m }) %></option><% } %></select></div>
    <div class="wc-sec"><span class="wc-label"><%= t('cards.sponsors.messages') %></span><span class="wc-count" data-count="messages"><%= card.counts.messages.text %></span><button type="button" class="btn btn-primary wc-btn xs" data-add="sponsor" data-title="<%= t('cards.sponsors.newTitle') %>"><svg class="i sm" aria-hidden="true"><use href="#i-plus"/></svg><%= t('cards.common.add') %></button></div>
    <div class="wc-list<%= card.on ? '' : ' wc-dim' %>" id="wc-sponsors" data-list="sponsors" data-dim-with="sponsor_send_chat">
      <% for (const m of card.messages) { %>
      <div class="wc-row<%= m.on ? '' : ' is-off' %><%= m.extra ? ' hidden' : '' %>" data-row data-id="<%= m.id %>" data-text="<%= m.text %>" data-url="<%= m.url %>">
        <label class="pill-toggle mini"><input type="checkbox" role="switch" aria-label="<%= m.text %>" data-setting="sponsor_message_enabled" data-id="<%= m.id %>" <%= m.on ? 'checked' : '' %>><span class="slider"></span></label>
        <span class="txt" data-field="text"><%= m.text %></span>
        <button type="button" class="wc-ib" data-edit="sponsor" data-title="<%= t('cards.sponsors.editTitle') %>" title="<%= t('cards.common.edit') %>" aria-label="<%= t('cards.common.edit') %>"><svg class="i sm" aria-hidden="true"><use href="#i-pen"/></svg></button>
        <button type="button" class="wc-ib" data-delete="sponsor" title="<%= t('cards.common.delete') %>" aria-label="<%= t('cards.common.delete') %>"><svg class="i sm" aria-hidden="true"><use href="#i-trash"/></svg></button>
      </div>
      <% } %>
    </div>
    <p class="wc-hint" data-empty="sponsors"<%= card.messages.length ? ' hidden' : '' %>><%= t('cards.sponsors.none') %></p>
    <% if (card.messages.some((m) => m.extra)) { %><button type="button" class="wc-more" data-show-all="wc-sponsors"><%= t('cards.common.showAll', { count: card.messages.length }) %></button><% } %>
  </div>
  <div class="wc-msg" data-msg hidden></div>
  <div class="wc-foot"><% if (card.imagesLink) { %><a href="/dashboard/overlay-builder?tab=timed"><%= t('cards.sponsors.images') %> <svg class="i sm" aria-hidden="true"><use href="#i-right"/></svg></a><% } %><span class="wc-saved" data-saved aria-hidden="true"><svg class="i sm" aria-hidden="true"><use href="#i-check"/></svg><%= t('cards.common.saved') %></span></div>
  <template id="tpl-sponsor">
    <div class="wc-editor">
      <h4 id="wc-dialog-title" data-title></h4>
      <label class="wc-field"><span><%= t('cards.sponsors.text') %></span><textarea data-field="message_text" maxlength="500" rows="3"></textarea></label>
      <label class="wc-field"><span><%= t('cards.sponsors.link') %></span><input class="wc-input" data-field="url" type="url" maxlength="500" placeholder="https://..."></label>
      <div class="wc-actions"><button type="button" class="btn btn-secondary wc-btn" data-cancel><%= t('cards.common.cancel') %></button><button type="button" class="btn btn-primary wc-btn" data-save><%= t('cards.common.save') %></button></div>
      <div class="wc-msg" data-dialog-msg hidden></div>
    </div>
  </template>
  <template id="tpl-sponsor-row">
    <div class="wc-row" data-row>
      <label class="pill-toggle mini"><input type="checkbox" role="switch" data-setting="sponsor_message_enabled" checked><span class="slider"></span></label>
      <span class="txt" data-field="text"></span>
      <button type="button" class="wc-ib" data-edit="sponsor" data-title="<%= t('cards.sponsors.editTitle') %>" title="<%= t('cards.common.edit') %>" aria-label="<%= t('cards.common.edit') %>"><svg class="i sm" aria-hidden="true"><use href="#i-pen"/></svg></button>
      <button type="button" class="wc-ib" data-delete="sponsor" title="<%= t('cards.common.delete') %>" aria-label="<%= t('cards.common.delete') %>"><svg class="i sm" aria-hidden="true"><use href="#i-trash"/></svg></button>
    </div>
  </template>
</section>
```

`src/views/cards/donations.ejs`:

```ejs
<%# The Donations card (dashboardCards.js donationsCard()): the tip page's switch and link, the tip goal (with the
    overlay features; edited in a pop-up through /dashboard/api/tip-goal) and the latest tips. Without a PayPal email
    it shows the step to add one. %>
<% const _money = (amount, currency) => { try { return new Intl.NumberFormat(lang, { style: 'currency', currency: currency || 'EUR' }).format(Number(amount) || 0); } catch (e) { return `${(Number(amount) || 0).toFixed(2)} ${currency || ''}`.trim(); } }; %>
<section class="card wc-card" id="card-donations" data-card="donations" aria-labelledby="card-donations-title">
  <div class="wc-head">
    <div class="wc-icon" style="background: rgba(0,112,186,0.15); color: #3b9eff"><svg class="i" aria-hidden="true"><use href="#i-dollar"/></svg></div>
    <div><h3 class="wc-title" id="card-donations-title"><%= t('dashboard.cards.donations.title') %></h3><span class="wc-status<%= card.status.tone === 'ok' ? '' : ' ' + card.status.tone %>" data-status><%= t(card.status.key, card.status.params) %></span></div>
    <% if (!card.setup) { %><label class="pill-toggle" title="<%= t('cards.donations.switch') %>"><input type="checkbox" role="switch" aria-label="<%= t('cards.donations.switch') %>" data-setting="donation_page_enabled" data-fix-href="/dashboard/donations" <%= card.on ? 'checked' : '' %>><span class="slider"></span></label><% } %>
  </div>
  <div class="wc-body">
  <% if (card.setup === 'paypal') { %>
    <div class="wc-empty"><span class="big"><svg class="i" aria-hidden="true"><use href="#i-dollar"/></svg></span><div><%= t('cards.donations.setup') %></div></div>
    <a href="/dashboard/donations" class="btn btn-primary wc-btn block"><%= t('cards.donations.addEmail') %></a>
  <% } else { %>
    <% if (card.tipUrl) { %>
    <div class="wc-linkbox<%= card.on ? '' : ' wc-dim' %>" data-dim-with="donation_page_enabled">
      <code class="wc-link"><%= card.tipShown %></code>
      <button type="button" class="btn btn-secondary wc-btn" data-copy="<%= card.tipUrl %>"><svg class="i sm" aria-hidden="true"><use href="#i-copy"/></svg><span data-copy-label><%= t('dashboard.copy') %></span></button>
      <a class="btn btn-secondary wc-btn" href="<%= card.tipUrl %>" target="_blank" rel="noopener" title="<%= t('cards.donations.openPage') %>" aria-label="<%= t('cards.donations.openPage') %>"><svg class="i sm" aria-hidden="true"><use href="#i-ext"/></svg></a>
    </div>
    <% } %>
    <% if (card.showGoal) { const _goal = card.goal; %>
    <div class="wc-sec"><span class="wc-label"><%= t('cards.donations.goal') %></span><button type="button" class="btn btn-secondary wc-btn xs" data-edit="goal" data-title="<%= t('cards.donations.goal') %>"><svg class="i sm" aria-hidden="true"><use href="#i-pen"/></svg><span data-goal-button><%= _goal ? t('cards.common.edit') : t('cards.donations.startGoal') %></span></button></div>
    <div class="wc-goal" data-goal data-title="<%= _goal ? _goal.title : '' %>" data-current="<%= _goal ? _goal.current : 0 %>" data-target="<%= _goal ? _goal.target : '' %>" data-currency="<%= _goal ? _goal.currency : card.currency %>"<%= _goal ? '' : ' hidden' %>>
      <div class="top"><b data-goal-title><%= _goal ? _goal.title : '' %></b><em><%= t('cards.donations.goalOnStream') %></em><span data-goal-amount><%= _goal ? t('cards.donations.goalAmount', { raised: _money(_goal.current, _goal.currency), target: _money(_goal.target, _goal.currency) }) : '' %></span></div>
      <div class="wc-progress"><span data-goal-bar style="width: <%= _goal ? _goal.percent : 0 %>%"></span></div>
    </div>
    <p class="wc-hint" data-goal-none<%= _goal ? ' hidden' : '' %>><%= t('cards.donations.noGoal') %></p>
    <% } %>
    <div class="wc-sec"><span class="wc-label"><%= t('cards.donations.latest') %></span><a class="wc-link-sm" href="/dashboard/donations/history"><%= t('dashboard.cards.donations.history') %> <svg class="i sm" aria-hidden="true"><use href="#i-right"/></svg></a></div>
    <% if (card.recent.length) { %>
    <div class="wc-list">
      <% for (const d of card.recent) { %>
      <div class="wc-row"><span class="amt"><%= _money(d.amount, d.currency) %></span><span class="txt"><%= d.name || t('donations.history.anonymous') %><% if (d.message) { %>: “<%= d.message %>”<% } %></span><% if (d.ago) { %><span class="when"><%= t(d.ago.key, d.ago.params) %></span><% } %></div>
      <% } %>
    </div>
    <% } else { %>
    <p class="wc-hint"><%= t('cards.donations.noTips') %></p>
    <% } %>
  <% } %>
  </div>
  <div class="wc-msg" data-msg hidden></div>
  <div class="wc-foot"><a href="/dashboard/donations"><%= t('cards.donations.paypal') %> <svg class="i sm" aria-hidden="true"><use href="#i-right"/></svg></a><span class="wc-saved" data-saved aria-hidden="true"><svg class="i sm" aria-hidden="true"><use href="#i-check"/></svg><%= t('cards.common.saved') %></span></div>
  <% if (card.showGoal && !card.setup) { %>
  <template id="tpl-goal">
    <div class="wc-editor">
      <h4 id="wc-dialog-title" data-title></h4>
      <div class="wc-fields">
        <label class="wc-field grow"><span><%= t('cards.donations.goalTitle') %></span><input class="wc-input" data-field="title" maxlength="60"></label>
        <label class="wc-field"><span><%= t('cards.donations.goalTarget') %></span><input class="wc-input" data-field="target_amount" type="number" min="1" step="0.01" inputmode="decimal"></label>
      </div>
      <p class="wc-hint" data-goal-hint></p>
      <div class="wc-actions"><button type="button" class="btn btn-secondary wc-btn wc-left wc-danger" data-goal-end><%= t('cards.donations.endGoal') %></button><button type="button" class="btn btn-secondary wc-btn" data-cancel><%= t('cards.common.cancel') %></button><button type="button" class="btn btn-primary wc-btn" data-save><%= t('cards.common.save') %></button></div>
      <div class="wc-msg" data-dialog-msg hidden></div>
    </div>
  </template>
  <% } %>
</section>
```

`src/views/cards/protection.ejs`:

```ejs
<%# The Chat protection card (dashboardCards.js protectionCard()): the six filters, the note that asks to make the
    bot a moderator (shown while Twitch says it is not one; Check again asks Twitch again) and the moderation log.
    Faded while the chatbot is off. %>
<section class="card wc-card<%= cards.chatbotOn ? '' : ' needs-bot' %>" id="card-protection" data-card="protection" data-needs-chatbot aria-labelledby="card-protection-title">
  <div class="wc-head">
    <div class="wc-icon" style="background: rgba(240,68,56,0.13); color: #f04438"><svg class="i" aria-hidden="true"><use href="#i-shield"/></svg></div>
    <div><h3 class="wc-title" id="card-protection-title"><%= t('cards.protection.title') %></h3><span class="wc-status<%= card.status.tone === 'ok' ? '' : ' ' + card.status.tone %>" data-status><%= t(card.status.key, card.status.params) %></span></div>
  </div>
  <div class="wc-needs"><svg class="i sm" aria-hidden="true"><use href="#i-chat"/></svg><%= t('cards.protection.needsChatbot') %></div>
  <div class="wc-body">
    <% if (card.botName) { const _mod = around('cards.protection.modNote', 'command', { bot: card.botName }); %>
    <div class="wc-note" data-mod-note<%= card.moderatorNote ? '' : ' hidden' %>>
      <svg class="i sm" aria-hidden="true" style="color: var(--warning)"><use href="#i-warn"/></svg>
      <span><%= _mod[0] %><code>/mod <%= card.botName %></code><%= _mod[1] %></span>
      <button type="button" class="btn btn-secondary wc-btn xs" data-copy="/mod <%= card.botName %>"><svg class="i sm" aria-hidden="true"><use href="#i-copy"/></svg><span data-copy-label><%= t('dashboard.copy') %></span></button>
      <button type="button" class="btn btn-secondary wc-btn xs" data-check-moderator><%= t('cards.protection.checkAgain') %></button>
    </div>
    <% } %>
    <div class="wc-switches">
      <% for (const f of card.filters) { %>
      <div class="wc-sw<%= f.on ? ' is-on' : '' %>"><span><%= t(f.label) %><small><%= t(f.hint, f.hintParams) %></small></span><label class="pill-toggle mini"><input type="checkbox" role="switch" aria-label="<%= t(f.label) %>" data-setting="<%= f.key %>" <%= f.on ? 'checked' : '' %>><span class="slider"></span></label></div>
      <% } %>
    </div>
  </div>
  <div class="wc-msg" data-msg hidden></div>
  <div class="wc-foot"><a href="/dashboard/chatbot/mod-log"><%= t(card.modLog.key, card.modLog.params) %> <svg class="i sm" aria-hidden="true"><use href="#i-right"/></svg></a><a href="/dashboard/chatbot?tab=moderation"><%= t('cards.protection.fineTune') %> <svg class="i sm" aria-hidden="true"><use href="#i-right"/></svg></a><span class="wc-saved" data-saved aria-hidden="true"><svg class="i sm" aria-hidden="true"><use href="#i-check"/></svg><%= t('cards.common.saved') %></span></div>
</section>
```

`src/views/cards/giveaways.ejs`:

```ejs
<%# The Giveaways card (dashboardCards.js giveawaysCard()): the form that starts one (the giveaways page's JSON
    routes) and, while one runs, how to enter, the entries, the time left and Pick a winner. Faded while the chatbot is
    off: the chatbot collects the entries. %>
<% const _gw = card.running || {}; const _enter = around('cards.giveaways.howToEnter', 'keyword'); %>
<section class="card wc-card<%= cards.chatbotOn ? '' : ' needs-bot' %><%= card.running ? ' gw-running' : '' %>" id="card-giveaways" data-card="giveaways" data-needs-chatbot aria-labelledby="card-giveaways-title">
  <div class="wc-head">
    <div class="wc-icon" style="background: rgba(245,158,11,0.15); color: #f59e0b"><svg class="i" aria-hidden="true"><use href="#i-gift"/></svg></div>
    <div><h3 class="wc-title" id="card-giveaways-title"><%= t('dashboard.cards.giveaways') %></h3><span class="wc-status<%= card.status.tone === 'ok' ? '' : ' ' + card.status.tone %>" data-status><%= t(card.status.key, card.status.params) %></span></div>
  </div>
  <div class="wc-needs"><svg class="i sm" aria-hidden="true"><use href="#i-chat"/></svg><%= t('cards.giveaways.needsChatbot') %></div>
  <div class="wc-body">
    <form class="wc-gw-form" data-giveaway-form>
      <div class="wc-fields">
        <label class="wc-field"><span><%= t('cards.giveaways.keyword') %></span><span class="wc-prefixed"><b aria-hidden="true">!</b><input class="wc-input" name="keyword" value="gw" maxlength="25" autocomplete="off" spellcheck="false" required></span></label>
        <label class="wc-field grow"><span><%= t('cards.giveaways.prize') %> <em><%= t('cards.giveaways.optional') %></em></span><input class="wc-input" name="prize" maxlength="100" placeholder="<%= t('cards.giveaways.prizePlaceholder') %>"></label>
      </div>
      <div class="wc-fields">
        <label class="wc-field grow"><span><%= t('cards.giveaways.ends') %></span><select class="wc-select" name="duration_seconds"><option value=""><%= t('cards.giveaways.endsManual') %></option><% for (const m of [1, 5, 10, 30]) { %><option value="<%= m * 60 %>"<%= m === 5 ? ' selected' : '' %>><%= t('cards.giveaways.endsAfter', { minutes: m }) %></option><% } %></select></label>
        <label class="wc-field"><span><%= t('cards.giveaways.winners') %></span><select class="wc-select" name="winners_count"><% for (const n of [1, 2, 3, 5]) { %><option value="<%= n %>"><%= n %></option><% } %></select></label>
        <label class="wc-field"><span><%= t('cards.giveaways.subsOnly') %></span><span class="pill-toggle mini"><input type="checkbox" role="switch" name="subs_only" aria-label="<%= t('cards.giveaways.subsOnly') %>"><span class="slider"></span></span></label>
      </div>
      <button type="submit" class="btn btn-primary wc-btn block"><svg class="i sm" aria-hidden="true"><use href="#i-play"/></svg><%= t('cards.giveaways.start') %></button>
    </form>
    <div class="wc-gw-live" data-giveaway-live data-giveaway-id="<%= _gw.id || '' %>" data-keyword="<%= _gw.keyword || '' %>" data-ends-at="<%= _gw.endsAt || '' %>" data-winners="<%= _gw.winners || 1 %>" data-entries="<%= _gw.entries || 0 %>">
      <div class="wc-setrow wc-gw-how"><span class="pulse-dot" aria-hidden="true"></span><span><%= _enter[0] %><code data-gw-keyword>!<%= _gw.keyword || '' %></code><%= _enter[1] %></span></div>
      <div class="wc-gw-stats"><div><b data-gw-entries><%= _gw.entries || 0 %></b><span><%= t('cards.giveaways.entries') %></span></div><div><b data-gw-left>–</b><span><%= t('cards.giveaways.left') %></span></div><div><b data-gw-winners><%= _gw.winners || 1 %></b><span><%= t('cards.giveaways.winners') %></span></div></div>
      <div class="wc-winner" data-gw-winner role="status"></div>
      <button type="button" class="btn btn-primary wc-btn block" data-gw-pick><%= t('cards.giveaways.pick') %></button>
      <button type="button" class="btn btn-secondary wc-btn block" data-gw-end><%= t('cards.giveaways.end') %></button>
    </div>
  </div>
  <div class="wc-msg" data-msg hidden></div>
  <div class="wc-foot"><a href="/dashboard/giveaways"><%= t('cards.giveaways.past') %> <svg class="i sm" aria-hidden="true"><use href="#i-right"/></svg></a></div>
</section>
```

`src/views/cards/rewards.ejs`:

```ejs
<%# The Channel point rewards card (with features.overlays; dashboardCards.js rewardsCard()): the switch (while it is
    off every redemption is refunded), each reward's switch and test, or what is missing: the Twitch permission, or
    Affiliate. %>
<section class="card wc-card" id="card-rewards" data-card="rewards" aria-labelledby="card-rewards-title">
  <div class="wc-head">
    <div class="wc-icon" style="background: rgba(145,70,255,0.15); color: #b18cff"><svg class="i" aria-hidden="true"><use href="#i-spark"/></svg></div>
    <div><h3 class="wc-title" id="card-rewards-title"><%= t('dashboard.cards.cpRewards') %></h3><span class="wc-status<%= card.status.tone === 'ok' ? '' : ' ' + card.status.tone %>" data-status><%= t(card.status.key, card.status.params) %></span></div>
    <% if (card.access === 'ok') { %><label class="pill-toggle" title="<%= t('cards.rewards.switch') %>"><input type="checkbox" role="switch" aria-label="<%= t('cards.rewards.switch') %>" data-setting="cp_rewards_enabled" <%= card.on ? 'checked' : '' %>><span class="slider"></span></label><% } %>
  </div>
  <div class="wc-body">
  <% if (card.access === 'permission') { %>
    <div class="wc-empty"><span class="big"><svg class="i" aria-hidden="true"><use href="#i-spark"/></svg></span><div><%= t('cards.rewards.permissionText') %></div></div>
    <a href="/auth/broadcaster" class="btn btn-primary wc-btn block"><%= t('dashboard.reconnectTwitch') %></a>
  <% } else if (card.access === 'notAffiliate') { %>
    <div class="wc-empty"><span class="big"><svg class="i" aria-hidden="true"><use href="#i-spark"/></svg></span><div><%= t('cards.rewards.notAffiliateText') %></div></div>
  <% } else if (!card.rewards.length) { %>
    <div class="wc-empty"><span class="big"><svg class="i" aria-hidden="true"><use href="#i-spark"/></svg></span><div><%= t('cards.rewards.emptyText') %></div></div>
    <a href="/dashboard/redemptions" class="btn btn-primary wc-btn block"><svg class="i sm" aria-hidden="true"><use href="#i-plus"/></svg><%= t('cards.rewards.create') %></a>
  <% } else { %>
    <div class="wc-list<%= card.on ? '' : ' wc-dim' %>" data-dim-with="cp_rewards_enabled">
      <% for (const r of card.rewards) { %>
      <div class="wc-row<%= r.on ? '' : ' is-off' %>">
        <label class="pill-toggle mini"><input type="checkbox" role="switch" aria-label="<%= r.title %>" data-reward-id="<%= r.id %>" <%= r.on ? 'checked' : '' %>><span class="slider"></span></label>
        <span class="nm"><%= r.title %></span><span class="txt"><%= t('cards.rewards.cost', { cost: r.cost }) %></span>
        <button type="button" class="wc-ib" data-reward-test="<%= r.id %>" title="<%= t('cards.rewards.test') %>" aria-label="<%= t('cards.rewards.test') %>: <%= r.title %>"><svg class="i sm" aria-hidden="true"><use href="#i-play"/></svg></button>
      </div>
      <% } %>
    </div>
  <% } %>
  </div>
  <div class="wc-msg" data-msg hidden></div>
  <div class="wc-foot"><a href="/dashboard/redemptions"><%= t('cards.rewards.history') %> <svg class="i sm" aria-hidden="true"><use href="#i-right"/></svg></a><span class="wc-saved" data-saved aria-hidden="true"><svg class="i sm" aria-hidden="true"><use href="#i-check"/></svg><%= t('cards.common.saved') %></span></div>
</section>
```

`src/views/cards/spotify.ejs`:

```ejs
<%# The Spotify card: connect it, or (connected) what !song does and the way to disconnect it. %>
<section class="card wc-card" id="card-spotify" data-card="spotify" aria-labelledby="card-spotify-title">
  <div class="wc-head">
    <div class="wc-icon" style="background: rgba(29,185,84,0.13); color: #1db954"><svg class="i" aria-hidden="true"><use href="#i-music"/></svg></div>
    <div><h3 class="wc-title" id="card-spotify-title">Spotify</h3><span class="wc-status<%= card.status.tone === 'ok' ? '' : ' ' + card.status.tone %>" data-status><%= t(card.status.key, card.status.params) %></span></div>
  </div>
  <div class="wc-body">
    <% const _song = around(card.connected ? 'dashboard.cards.spotify.connectedDesc' : 'dashboard.cards.spotify.connectDesc', 'command'); %>
    <p class="wc-text"><%= _song[0] %><code>!song</code><%= _song[1] %></p>
    <% if (!card.connected) { %><a href="/auth/spotify" class="btn btn-primary wc-btn block"><%= t('dashboard.cards.spotify.connect') %></a><% } %>
  </div>
  <% if (card.connected) { %>
  <div class="wc-foot"><form method="POST" action="/dashboard/spotify/disconnect" class="wc-inline-form"><button type="submit" class="wc-linkbtn"><%= t('dashboard.cards.spotify.disconnect') %></button></form></div>
  <% } %>
</section>
```

`src/views/cards/multistream.ejs`:

```ejs
<%# The Multistream card, only while the relay is set up (config.multistream.enabled) and YouTube is shown. %>
<section class="card wc-card" id="card-multistream" data-card="multistream" aria-labelledby="card-multistream-title">
  <div class="wc-head">
    <div class="wc-icon" style="background: linear-gradient(135deg, #9146ff, #ff0000); color: #fff"><svg class="i" aria-hidden="true"><use href="#i-video"/></svg></div>
    <div><h3 class="wc-title" id="card-multistream-title"><%= t('dashboard.cards.multistream.title') %></h3><span class="wc-status<%= card.status.tone === 'ok' ? '' : ' ' + card.status.tone %>" data-status><%= t(card.status.key, card.status.params) %></span></div>
  </div>
  <div class="wc-body">
    <p class="wc-text"><%= t('dashboard.cards.multistream.desc') %></p>
    <a href="/dashboard/multistream" class="btn btn-primary wc-btn block"><%= t('dashboard.cards.multistream.cta') %></a>
  </div>
</section>
```

- [ ] **Step 4: The Twitch tab**

In `src/views/dashboard.ejs` replace everything from `<div class="tab-content" id="tab-twitch">` up to (not including) the comment `<%# The YouTube tab (features.youtube). %>` — the account row, the 7-day card, the old grid and its cards (Chatbot, Discord notifications, Giveaways, Donations, Sponsor Messages, Spotify, OBS Overlay, Channel Point Rewards, Multistream, the disabled Custom Overlays comment) — with:

```ejs
<div class="tab-content" id="tab-twitch">
  <%- include('cards/_style') %>
  <%- include('cards/_icons') %>

  <%# The top: the Twitch account (link it, give the broadcaster authorization, or reconnect it), then the last 7 days. %>
  <div class="dash-top">
    <div class="dash-acct-row">
      <% if (!streamer.twitch_user_id) { %>
        <a href="/auth/twitch" class="btn btn-primary dash-acct"><svg class="i sm" aria-hidden="true"><use href="#i-twitch"/></svg><%= t('dashboard.linkTwitch') %></a>
      <% } else { %>
        <span class="btn btn-secondary dash-acct"><svg class="i sm" aria-hidden="true" style="color: var(--success)"><use href="#i-check"/></svg>Twitch: <%= streamer.twitch_username %></span>
      <% } %>
      <% if (streamer.twitch_user_id && !streamer.broadcaster_access_token) { %>
        <a href="/auth/broadcaster" class="btn btn-secondary dash-acct"><%= t('dashboard.enableSubSync') %></a>
      <% } %>
      <%# The authorization stopped working (the banner above says what is paused). %>
      <% if (streamer.broadcaster_access_token && needsReauth) { %>
        <a href="/auth/broadcaster" class="btn btn-secondary dash-acct" style="color: var(--warning);"><%= t('dashboard.reconnectTwitch') %></a>
      <% } %>
    </div>
    <% if (typeof overlayStats !== 'undefined' && overlayStats) { %>
    <div class="card stats-strip">
      <div class="cap"><%= t('dashboard.week.title') %></div>
      <div class="s"><div class="n" style="color:#9146ff"><%= overlayStats.follows %></div><div class="l"><%= t('dashboard.week.follows') %></div></div>
      <div class="s"><div class="n" style="color:#00ff88"><%= overlayStats.subs %></div><div class="l"><%= t('dashboard.week.subs') %></div></div>
      <div class="s"><div class="n" style="color:#ffd60a"><%= overlayStats.bits_events %></div><div class="l"><%= t('dashboard.week.bits') %></div></div>
      <div class="s"><div class="n" style="color:#e040fb"><%= overlayStats.donations %></div><div class="l"><%= t('dashboard.week.donations') %></div></div>
      <div class="s"><div class="n" style="color:#ff5c5c"><%= overlayStats.raids %></div><div class="l"><%= t('dashboard.week.raids') %></div></div>
      <div class="s"><div class="n" style="color:#00ff88"><%= overlayStats.giftsubs %></div><div class="l"><%= t('dashboard.week.giftSubs') %></div></div>
    </div>
    <% } %>
  </div>

  <%# The working cards (views/cards/), in cards.order (services/dashboardCards.js). %>
  <div class="wc-grid" id="wc-grid">
    <% for (const name of cards.order) { %><%- include('cards/' + name, { card: cards[name], cards, around: _around }) %><% } %>
  </div>
  <div class="wc-live" id="wc-live" aria-live="polite"></div>
  <dialog class="wc-dialog" id="wc-dialog" aria-labelledby="wc-dialog-title"></dialog>
</div>

```

In the same file:
- in the closing `<script>` (the one with `toggleStats`), delete the `<% if (features.overlays) { %> … copyField … <% } %>` block (only the old overlay card used it);
- in the closing `<style>`, delete `.twitch-cards-grid .card { margin-bottom: 0; }`, the whole "Discord notifications card" block (`.dn-lead` … `.dn-note a`) and, in `@media (max-width: 520px)`, the `.dash-week-grid` rule.

In `src/routes/dashboard.js` `GET /`: delete the locals only the old cards read and what computes them — `botConnected`, `botUsername` (the `try { … chatManager.isConnected() … }` block), `overlayUrl`, `hasScope` (keep `needsReauth`; take `hasRedemptionScope` out of that destructuring) and `activeGiveaway` — and remove them from `res.render`. Keep `vtuberUrl`, `overlayStats`, `needsReauth`, `discordNotifications`, `multistreamAvailable`, `guilds`, `unclaimedGuilds`, `botInviteUrl`, `cards`, `wideLayout`.

- [ ] **Step 5: The tests of the page**

In `src/routes/dashboard.test.js`, inside `describe('the dashboard puts Twitch first', …)` replace the three tests `'the Twitch tab: the account row, then Chatbot, …'`, `'switched on, the overlay cards come after those, …'` and `'every card has one main button, and says what state it is in'` with:

```js
  test('the Twitch tab: the account row, the last 7 days, then the cards in reading order', async () => {
    features.overlays = false;
    const html = (await request('GET', '/dashboard', { streamer: linked() })).text;
    const pane = dashboardPane(html, 'twitch');
    assert.deepEqual(twitchCardTitles(html), [t('en', 'dashboard.cards.chatbot.title'), t('en', 'dashboard.cards.discord.title'), t('en', 'cards.commands.title'),
      t('en', 'sponsors.title'), t('en', 'dashboard.cards.donations.title'), t('en', 'cards.protection.title'), t('en', 'dashboard.cards.giveaways'), 'Spotify']);
    assert.ok(pane.indexOf(`Twitch: synthetic_first_${made}`) < pane.indexOf('class="card'), 'the linked channel is above the cards');
  });

  test('switched on, the OBS overlay and rewards cards are in their places, and the Multistream card (relay configured) last', async () => {
    const multistream = require('../config').multistream;
    const relay = multistream.enabled;
    multistream.enabled = true;
    try {
      const html = (await request('GET', '/dashboard', { streamer: linked({ overlay_token: 'synthetic-token-first-1' }) })).text;
      assert.deepEqual(twitchCardTitles(html), [t('en', 'dashboard.cards.chatbot.title'), t('en', 'dashboard.cards.discord.title'), t('en', 'dashboard.cards.overlay.title'),
        t('en', 'cards.commands.title'), t('en', 'sponsors.title'), t('en', 'dashboard.cards.donations.title'), t('en', 'cards.protection.title'),
        t('en', 'dashboard.cards.giveaways'), t('en', 'dashboard.cards.cpRewards'), 'Spotify', t('en', 'dashboard.cards.multistream.title')]);
    } finally {
      multistream.enabled = relay;
    }
  });

  test('every card says what state it is in, has at most one purple button, and every switch is labelled', async () => {
    const pane = dashboardPane((await request('GET', '/dashboard', { streamer: linked({ chatbot_enabled: 1 }) })).text, 'twitch')
      .replace(/<template\b[\s\S]*?<\/template>/g, ' '); // the pop-ups' own buttons
    const cards = pane.split('<section class="card wc-card').slice(1);
    assert.equal(cards.length, 10);
    for (const card of cards) {
      const title = (card.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/) || [])[1];
      assert.match(card, /<\/h3><span class="wc-status[^"]*" data-status>[^<]+<\/span>/, `${title}: a status line under its title`);
      // The giveaway card shows its form or, while one runs, its panel: count the buttons of the half that shows.
      const shown = card.includes('gw-running') ? card.replace(/<form class="wc-gw-form"[\s\S]*?<\/form>/, ' ') : card.replace(/<div class="wc-gw-live"[\s\S]*$/, ' ');
      assert.ok((shown.match(/class="btn btn-primary\b/g) || []).length <= 1, `${title}: at most one purple button`);
      for (const input of card.match(/<input type="checkbox" role="switch"[^>]*>/g) || []) assert.match(input, /aria-label="[^"]+"/, `${title}: ${input}`);
    }
  });
```

Replace the whole `describe('the Discord notifications card on the Twitch tab', …)` with:

```js
describe('the Discord notifications card on the Twitch tab', () => {
  let made = 0;
  let guildCount = 0;
  const nextGuild = () => `60000000000000${String(500 + ++guildCount).padStart(4, '0')}`;
  const linked = (over = {}) => { made++; return addStreamer({ twitch_user_id: `tw-dn-${made}`, twitch_username: `synthetic_dn_${made}`, ...over }); };
  const loginOf = (id) => db.getStreamerById(id).twitch_username;
  // A server the streamer has claimed, that the bot can see (unless seen: false).
  const claimed = (id, settings = {}, { seen = true, name = 'Synthetic Server' } = {}) => {
    const g = nextGuild();
    db.upsertGuild(g, id, name);
    db.updateGuildConfig(g, id, settings);
    if (seen) guilds.set(g, fakeGuild(g));
    return g;
  };
  const cardOf = async (id) => {
    const res = await request('GET', '/dashboard', { streamer: id });
    assert.equal(res.status, 200);
    const start = res.text.indexOf('id="card-discord"');
    assert.ok(start > 0, 'the card is on the page');
    return res.text.slice(start, res.text.indexOf('</section>', start));
  };
  const dataOf = async (id) => (await request('GET', '/dashboard', { streamer: id, json: true })).json().locals.discordNotifications;
  // One switch of a server's block: its label, whether it is on, the line under it (and whether it warns) and the
  // server page tab that sets what it is missing.
  const switchOf = (card, guildId, key) => {
    const block = card.slice(card.indexOf(`data-guild="${guildId}"`));
    const m = block.match(new RegExp(`<span>([^<]*)<small class="(warn)?">([^<]*)</small></span><label class="pill-toggle mini"><input type="checkbox" role="switch" aria-label="[^"]*" data-setting="${key}" data-guild-id="${guildId}" data-fix-href="([^"]*)" (checked)?`));
    assert.ok(m, `${key} is shown for ${guildId}`);
    return { label: m[1], warn: !!m[2], hint: m[3], fix: m[4], on: !!m[5] };
  };
  const KEYS = { goLive: 'notify_live', clips: 'notify_clips', recaps: 'recap_enabled', milestones: 'milestones_enabled', highlights: 'weekly_highlights_enabled', subRoles: 'sub_sync_enabled' };
  const switches = (card, guildId) => Object.fromEntries(Object.entries(KEYS).map(([name, key]) => [name, switchOf(card, guildId, key).on]));
  // Links to a server page (not the switches' data-fix-href).
  const serverLinks = (card) => [...card.matchAll(/(?<![-\w])href="(\/dashboard\/guild\/[^"]*)"/g)].map((m) => m[1]);
  const ALL_ON = { recap_enabled: true, milestones_enabled: true, weekly_highlights_enabled: true, sub_sync_enabled: true, sub_role_id: '700000000000000005' };

  test('without a linked Twitch account it says so, and offers to link it', async () => {
    const id = addStreamer();
    claimed(id, ALL_ON);
    const card = await cardOf(id);
    assert.ok(card.includes(esc(t('en', 'dashboard.cards.discord.statusNoTwitch'))));
    assert.ok(card.includes(esc(t('en', 'dashboard.cards.discord.noTwitch'))));
    assert.ok(card.includes('href="/auth/twitch"') && card.includes(esc(t('en', 'dashboard.linkTwitch'))));
    assert.ok(!card.includes('data-guild='), 'no server is listed: nothing can be said about a channel that is not linked');
    assert.equal((await dataOf(id)).twitchLinked, false);
  });

  test('with no server: what the bot would post, the bot invite, and a server the bot is already in to claim', async () => {
    const id = linked();
    let card = await cardOf(id);
    assert.ok(card.includes(esc(t('en', 'dashboard.cards.discord.statusNoServer'))));
    assert.ok(card.includes(esc(t('en', 'dashboard.cards.discord.noServer'))));
    assert.ok(card.includes('href="https://discord.com/oauth2/authorize?client_id=') && card.includes(esc(t('en', 'dashboard.addBot'))));
    assert.ok(!card.includes('/dashboard/claim/'));
    const g = nextGuild();
    guilds.set(g, fakeGuild(g, { manage: [discordId(id)] }));
    card = await cardOf(id);
    assert.ok(card.includes(`action="/dashboard/claim/${g}"`), 'the server the streamer manages can be claimed from the card');
    assert.ok(card.includes(esc(t('en', 'dashboard.claim'))));
  });

  test('a server that announces the streamer\'s channel: six switches on, where the posts go, its page and its welcome message', async () => {
    const id = linked({ broadcaster_access_token: 'synthetic-broadcaster' });
    const g = claimed(id, ALL_ON);
    db.addWatchedChannel(g, id, loginOf(id), CH_LIVE, CH_CLIPS, true, true, null);
    const card = await cardOf(id);
    assert.deepEqual(switches(card, g), { goLive: true, clips: true, recaps: true, milestones: true, highlights: true, subRoles: true });
    assert.deepEqual(switchOf(card, g, 'notify_live'), { label: t('en', 'dashboard.cards.discord.goLive'), warn: false, hint: esc(t('en', 'cards.discord.inChannel', { channel: '#live' })), fix: `/dashboard/guild/${g}?tab=twitch`, on: true });
    assert.equal(switchOf(card, g, 'notify_clips').hint, esc(t('en', 'cards.discord.inChannel', { channel: '#clips' })));
    assert.equal(switchOf(card, g, 'sub_sync_enabled').fix, `/dashboard/guild/${g}?tab=discord`, 'the sub role is set on the server page\'s Discord tab');
    assert.ok(card.includes(`Server ${g}`), 'the server\'s name as Discord has it');
    assert.ok(card.includes(esc(t('en', 'dashboard.cards.discord.statusAll'))));
    assert.deepEqual(serverLinks(card), [`/dashboard/guild/${g}`, `/dashboard/guild/${g}?tab=discord`], 'its channels and its welcome message');
    assert.ok(card.includes('data-open-tab="discord"') && card.includes(esc(t('en', 'cards.discord.addServer'))));
    const [before] = t('en', 'dashboard.cards.discord.authNote', { link: '\u0001' }).split('\u0001');
    assert.ok(!card.includes(esc(before)), 'nothing waits for an authorization');
  });

  test('a server that does not watch the streamer\'s channel: its switches as stored, each saying what it is missing', async () => {
    const id = linked({ broadcaster_access_token: 'synthetic-broadcaster' });
    const g = claimed(id, ALL_ON);
    db.addWatchedChannel(g, id, 'someone_else', CH_LIVE, CH_CLIPS, true, true, null);
    const card = await cardOf(id);
    assert.deepEqual(switches(card, g), { goLive: false, clips: false, recaps: true, milestones: true, highlights: true, subRoles: true });
    assert.deepEqual([switchOf(card, g, 'notify_live').warn, switchOf(card, g, 'notify_live').hint], [true, esc(t('en', 'cards.discord.pickChannel'))]);
    assert.equal(switchOf(card, g, 'recap_enabled').hint, esc(t('en', 'cards.discord.needsLiveChannel')));
    assert.equal(switchOf(card, g, 'weekly_highlights_enabled').hint, esc(t('en', 'cards.discord.notPosted')));
    assert.ok(card.includes(esc(t('en', 'dashboard.cards.discord.statusNone'))));
    assert.ok(card.includes(`href="/dashboard/guild/${g}?tab=twitch"`), 'its Channels link opens the tab where the channel is added');
  });

  test('go-live without clips; a channel the bot cannot see is not named; a watcher row that is off counts as off', async () => {
    const id = linked();
    const g = claimed(id);
    db.addWatchedChannel(g, id, loginOf(id), '599999999999999999', null, true, false, null);
    let card = await cardOf(id);
    assert.deepEqual([switchOf(card, g, 'notify_live').on, switchOf(card, g, 'notify_live').hint], [true, esc(t('en', 'cards.discord.channelUnknown'))]);
    assert.equal(switchOf(card, g, 'notify_clips').on, false);
    db.db.prepare('UPDATE watched_channels SET enabled = 0 WHERE guild_id = ?').run(g);
    card = await cardOf(id);
    assert.equal(switchOf(card, g, 'notify_live').on, false, 'the pollers skip a row that is off');
  });

  test('sub roles: a role to pick, waiting without the broadcaster authorization, with the way to give it', async () => {
    const owner = linked({ broadcaster_access_token: 'synthetic-broadcaster' });
    const noSwitch = claimed(owner, { sub_role_id: '700000000000000005' });
    const noRole = claimed(owner, { sub_sync_enabled: true });
    let card = await cardOf(owner);
    assert.deepEqual([switchOf(card, noSwitch, 'sub_sync_enabled').on, switchOf(card, noSwitch, 'sub_sync_enabled').warn], [false, false]);
    assert.deepEqual([switchOf(card, noRole, 'sub_sync_enabled').on, switchOf(card, noRole, 'sub_sync_enabled').hint], [true, esc(t('en', 'cards.discord.pickRole'))]);

    const waiting = linked();
    const g = claimed(waiting, { sub_sync_enabled: true, sub_role_id: '700000000000000005' });
    card = await cardOf(waiting);
    assert.deepEqual([switchOf(card, g, 'sub_sync_enabled').warn, switchOf(card, g, 'sub_sync_enabled').hint], [true, esc(t('en', 'dashboard.cards.discord.wait'))]);
    const [before] = t('en', 'dashboard.cards.discord.authNote', { link: '\u0001' }).split('\u0001');
    assert.ok(card.includes(esc(before)), 'it says what is waiting');
    assert.ok(card.includes('href="/auth/broadcaster"') && card.includes(esc(t('en', 'dashboard.enableSubSync'))));
    assert.deepEqual(await dataOf(waiting).then((d) => [d.needsAuth, d.authAction]), [true, 'enable']);

    const reauth = twitchStub.needsBroadcasterReauth;
    twitchStub.needsBroadcasterReauth = () => true;
    try {
      const stale = linked({ broadcaster_access_token: 'synthetic-broadcaster' });
      const s = claimed(stale, { sub_sync_enabled: true, sub_role_id: '700000000000000005' });
      card = await cardOf(stale);
      assert.equal(switchOf(card, s, 'sub_sync_enabled').hint, esc(t('en', 'dashboard.cards.discord.wait')), 'an authorization that stopped working counts as none');
      assert.ok(card.includes(esc(t('en', 'dashboard.reconnect.cta'))));
    } finally {
      twitchStub.needsBroadcasterReauth = reauth;
    }
  });

  test('milestones wait for the broadcaster authorization too; recaps do not need it', async () => {
    const id = linked();
    const g = claimed(id, { recap_enabled: true, milestones_enabled: true });
    db.addWatchedChannel(g, id, loginOf(id), CH_LIVE, null, true, false, null);
    const card = await cardOf(id);
    assert.deepEqual([switchOf(card, g, 'recap_enabled').on, switchOf(card, g, 'recap_enabled').warn], [true, false]);
    assert.equal(switchOf(card, g, 'milestones_enabled').hint, esc(t('en', 'dashboard.cards.discord.wait')));
  });

  test('weekly highlights: posted for the streamer the digest is made for (the first to switch it on in a shared server)', async () => {
    const first = linked();
    const second = linked();
    const g = nextGuild();
    guilds.set(g, fakeGuild(g));
    for (const id of [first, second]) {
      db.upsertGuild(g, id, 'Shared Server');
      db.updateGuildConfig(g, id, { weekly_highlights_enabled: true });
      db.addWatchedChannel(g, id, loginOf(id), CH_LIVE, null, true, false, null);
    }
    assert.deepEqual([switchOf(await cardOf(first), g, 'weekly_highlights_enabled').warn], [false]);
    assert.equal(switchOf(await cardOf(second), g, 'weekly_highlights_enabled').hint, esc(t('en', 'cards.discord.notPosted')), 'the digest of this server is made of the first streamer\'s channels');
  });

  test('several servers: how many announce the streamer\'s channel, a Channels link on each, an offline one named as stored', async () => {
    const id = linked();
    const announcing = claimed(id);
    db.addWatchedChannel(announcing, id, loginOf(id), CH_LIVE, CH_CLIPS, true, true, null);
    const quiet = claimed(id, {}, { seen: false, name: 'Stored Name' });
    const card = await cardOf(id);
    assert.ok(card.includes(esc(t('en', 'dashboard.cards.discord.statusSome', { count: 1, total: 2 }))));
    assert.deepEqual(serverLinks(card), [`/dashboard/guild/${announcing}`, `/dashboard/guild/${quiet}?tab=twitch`], 'no welcome link: there is more than one server');
    const row = card.slice(card.indexOf(`data-guild="${quiet}"`));
    assert.ok(row.includes('Stored Name') && row.includes(esc(t('en', 'dashboard.offline'))));
    const data = await dataOf(id);
    assert.equal(data.announcing, 1);
    assert.deepEqual(data.servers.map((s) => [s.guildId, s.botPresent]), [[announcing, true], [quiet, false]]);
  });

  test('a name made of markup is printed as text', async () => {
    const id = linked();
    claimed(id, {}, { seen: false, name: '<img src=x onerror=alert(1)>' });
    const card = await cardOf(id);
    assert.ok(!card.includes('<img src=x'));
    assert.ok(card.includes(esc('<img src=x onerror=alert(1)>')));
  });
});
```

In `describe('with the OBS overlay features switched off, the pages show nothing of them', …)` → `describe('the dashboard', …)`:
- in `'keeps the tabs and the cards that are not about the overlays, …'`: the hrefs are `['/dashboard/chatbot', '/dashboard/donations', '/dashboard/donations/history', '/dashboard/giveaways', '/dashboard/youtube-chatbot', '/auth/spotify']` (the cards no longer link the sponsor messages page: the card does what it did); the key checks become `assert.ok(page.includes(esc(t('en', 'dashboard.kick.comingSoonChat'))))` and `assert.ok(!page.includes(esc(t('en', 'dashboard.kick.comingSoon'))))` (the old giveaway and sponsor descriptions are gone with the old cards); rename the test `'keeps the tabs and the cards that are not about the overlays, and words the Kick tab without them'`;
- `'the donations card does not promise overlay alerts'` asserts `body(res.text).includes(esc(t('en', 'cards.donations.setup')))`;
- in `'switched on, it is the dashboard it was: …'` the key list becomes `['dashboard.cards.overlay.title', 'dashboard.cards.cpRewards', 'dashboard.vtuber.title', 'dashboard.tab.experimental', 'dashboard.youtube.overlayDesc', 'cards.overlay.source', 'cards.donations.goal', 'cards.sponsors.images', 'dashboard.kick.comingSoon']` (give the streamer `paypal_email: 'tips@example.test'` so the donations card shows the goal section).

Append a describe for the cards' own markup:

```js
// ── The working cards' markup (views/cards/) ─────────────────────────────

describe('the working cards on the page', () => {
  const pane = async (id) => dashboardPane((await request('GET', '/dashboard', { streamer: id })).text, 'twitch');
  const cardOf = (html, name) => {
    const start = html.indexOf(`id="card-${name}"`);
    assert.ok(start > 0, `${name} is on the page`);
    return html.slice(start, html.indexOf('</section>', start));
  };
  const linkedStreamer = (over = {}) => addStreamer({ twitch_user_id: `tw-wcp-${counter + 1}`, twitch_username: `synthetic_wcp_${counter + 1}`, ...over });

  test('switches show what is stored and name the setting they save', async () => {
    const id = linkedStreamer({ chatbot_enabled: 1, chat_follow_enabled: 0, overlay_enabled: 1, overlay_bits_enabled: 0, overlay_raid_duration: 7, overlay_volume: 0.24, mod_caps_enabled: 1 });
    const html = await pane(id);
    assert.match(cardOf(html, 'chatbot'), /data-setting="chatbot_enabled" checked>/);
    assert.match(cardOf(html, 'chatbot'), /data-setting="chat_follow_enabled" >/);
    const overlay = cardOf(html, 'overlay');
    assert.match(overlay, /data-setting="overlay_bits_enabled" >/);
    assert.match(overlay, /<select class="wc-select sm" data-setting="overlay_raid_duration"[^>]*>[\s\S]*?<option value="7" selected>/);
    assert.match(overlay, /value="24" data-setting="overlay_volume" data-scale="100"/);
    assert.match(cardOf(html, 'protection'), /data-setting="mod_caps_enabled" checked>/);
  });

  test('the cards that need the chatbot fade while it is off and say why', async () => {
    const html = await pane(linkedStreamer({ chatbot_enabled: 0 }));
    for (const name of ['commands', 'sponsors', 'protection', 'giveaways']) {
      assert.match(html, new RegExp(`class="card wc-card needs-bot[^"]*" id="card-${name}" data-card="${name}" data-needs-chatbot`), name);
    }
    assert.ok(cardOf(html, 'commands').includes(esc(t('en', 'cards.commands.needsChatbot'))));
    assert.match(html, /class="card wc-card" id="card-chatbot"/, 'the Chatbot card itself does not fade');
  });

  test('the OBS link is masked; the whole link is only in the copy button', async () => {
    const id = linkedStreamer({ overlay_token: 'synthetic-token-wcp-mask' });
    const overlay = cardOf(await pane(id), 'overlay');
    assert.match(overlay, /<code class="wc-link" data-masked="[^"]*\/overlay\/•{12}" data-shown="[^"]*\/overlay\/synthetic-token-wcp-mask">[^<]*\/overlay\/•{12}<\/code>/);
    assert.match(overlay, /data-copy="[^"]*\/overlay\/synthetic-token-wcp-mask"/);
    const noLink = cardOf(await pane(linkedStreamer()), 'overlay');
    assert.ok(noLink.includes('action="/dashboard/overlay/generate-token"') && noLink.includes(esc(t('en', 'cards.overlay.createLink'))));
  });

  test('commands, sponsor messages and thank-yous print what streamers typed as text; the rest of a long list waits behind Show all', async () => {
    const id = linkedStreamer({ chatbot_enabled: 1, chat_raid_template: '<b>raid</b> {viewers}' });
    for (let i = 0; i < 5; i++) db.addChatCommand(id, `cmd${i}`, i ? `About ${i}` : '<script>alert(1)</script>', 10);
    db.addSponsorMessage(id, '<i>Partner</i>', 'https://example.test/"x');
    const html = await pane(id);
    const commands = cardOf(html, 'commands');
    assert.ok(!commands.includes('<script>alert(1)</script>') && commands.includes(esc('<script>alert(1)</script>')));
    assert.equal((commands.match(/class="wc-row hidden" data-row/g) || []).length, 1, 'the fifth command waits behind Show all');
    assert.ok(commands.includes(esc(t('en', 'cards.common.showAll', { count: 5 }))));
    const sponsors = cardOf(html, 'sponsors');
    assert.ok(!sponsors.includes('<i>Partner</i>') && sponsors.includes(esc('<i>Partner</i>')));
    assert.ok(sponsors.includes('data-url="https://example.test/&#34;x"'));
    assert.ok(!cardOf(html, 'chatbot').includes('<b>raid</b>'));
    for (const id of ['tpl-thankyou', 'tpl-command', 'tpl-command-row', 'tpl-builtins', 'tpl-sponsor', 'tpl-sponsor-row']) assert.ok(html.includes(`<template id="${id}">`), id);
  });

  test('cards that are not set up show their one step: link Twitch, add a PayPal email, connect Spotify', async () => {
    const html = await pane(addStreamer({ paypal_email: null }));
    assert.ok(cardOf(html, 'chatbot').includes('href="/auth/twitch"'));
    assert.ok(cardOf(html, 'donations').includes(esc(t('en', 'cards.donations.addEmail'))));
    assert.ok(!cardOf(html, 'donations').includes('data-setting="donation_page_enabled"'), 'no switch until there is an email');
    assert.ok(cardOf(html, 'spotify').includes('href="/auth/spotify"'));
  });

  test('a running giveaway shows its panel; the tip goal and the latest tips are on the donations card', async () => {
    const id = linkedStreamer({ chatbot_enabled: 1, paypal_email: 'tips@example.test', donation_page_enabled: 1, donation_currency: 'EUR' });
    const row = db.insertGiveaway({ streamer_id: id, keyword: 'synthetic', status: 'open', duration_seconds: 300, winners_count: 2, ends_at: new Date(Date.now() + 300e3).toISOString() });
    db.createTipGoal(id, { title: 'New wheel', target_amount: 1000, currency: 'EUR', bar_color: '#22c55e', current_amount: 101 });
    db.logDonation(id, { source: 'paypal', donor_name: 'Synthetic Donor', amount: 5, currency: 'EUR', message: 'Great race', external_id: 'synthetic-order-wcp' });
    const html = await pane(id);
    const gw = cardOf(html, 'giveaways');
    assert.match(gw, /class="card wc-card gw-running"/);
    assert.ok(gw.includes(`data-giveaway-id="${row.id}"`) && gw.includes('<code data-gw-keyword>!synthetic</code>'));
    const donations = cardOf(html, 'donations');
    assert.ok(donations.includes('data-title="New wheel"') && donations.includes('style="width: 10%"'));
    assert.ok(donations.includes('Synthetic Donor') && donations.includes('Great race'));
  });

  test('rewards: the Twitch permission first, then Affiliate, then the rewards with their switches and tests', async () => {
    const hasScope = twitchStub.hasRedemptionScope;
    twitchStub.hasRedemptionScope = () => false;
    try {
      assert.ok(cardOf(await pane(linkedStreamer()), 'rewards').includes('href="/auth/broadcaster"'));
    } finally {
      twitchStub.hasRedemptionScope = hasScope;
    }
    assert.ok(cardOf(await pane(linkedStreamer({ cp_affiliate_status: 'not_affiliate' })), 'rewards').includes(esc(t('en', 'cards.rewards.notAffiliateText'))));
    const id = linkedStreamer({ cp_rewards_enabled: 1, cp_affiliate_status: 'ok' });
    const reward = Number(db.insertReward({
      streamer_id: id, title: 'Hydrate', cost: 500, prompt: null, cooldown_seconds: 0, enabled: 1,
      media_type: 'audio', media_filename: 'zz-cards-test.mp3', media_mime: 'audio/mpeg', media_size_bytes: 10,
      position_preset: 'center-large', custom_x: null, custom_y: null, custom_w: null, custom_h: null,
      volume: 1, max_play_seconds: 15, chat_message_template: null, auto_fulfill: 1, sort_order: 1, twitch_sync_status: 'ok',
    }).id);
    const rewards = cardOf(await pane(id), 'rewards');
    assert.ok(rewards.includes(`data-reward-id="${reward}" checked`) && rewards.includes(`data-reward-test="${reward}"`));
  });
});
```

- [ ] **Step 6: The view tests in `tests/i18nViewsPart1.test.js`**

1. In `describe('the views have no English typed into them', …)` add:

```js
  test('the dashboard\'s card partials (views/cards/)', () => {
    for (const file of fs.readdirSync(path.join(VIEWS, 'cards')).filter((name) => name.endsWith('.ejs'))) {
      const found = hardCodedText(fs.readFileSync(path.join(VIEWS, 'cards', file), 'utf8'));
      assert.deepEqual(found, [], `typed into cards/${file} instead of a t('key'):\n  ${found.map(([where, text]) => `${where}: ${text}`).join('\n  ')}`);
    }
  });
```

2. The Discord samples get the fields of Task 13. Replace `notifyServer` and give each server sample its switches:

```js
const notifyServer = (over = {}) => ({
  guildId: '1', name: 'zzserver', icon: null, botPresent: true, url: '/dashboard/guild/1',
  goLive: { state: 'on', where: '#zzlive' }, clips: { state: 'off', where: null }, recaps: 'on', milestones: 'wait', highlights: 'off', subRoles: 'wait',
  switches: { goLive: true, clips: false, recaps: true, milestones: true, highlights: false, subRoles: true },
  liveWhere: '#zzlive', clipsWhere: null, hasLiveChannel: true, hasClipsChannel: false, hasSubRole: true, ...over,
});
```

and in `discordNotifications` the second server becomes `notifyServer({ guildId: '2', name: 'zzquiet', botPresent: false, url: '/dashboard/guild/2?tab=twitch', goLive: { state: 'off', where: null }, milestones: 'off', subRoles: 'on', recaps: 'off', switches: { goLive: false, clips: false, recaps: true, milestones: false, highlights: true, subRoles: true }, liveWhere: null, hasLiveChannel: false, hasSubRole: false })`; in the sample `'Twitch linked, one server announcing, …'` the server becomes `notifyServer({ clips: { state: 'on', where: '#zzclips' }, milestones: 'on', subRoles: 'off', switches: { goLive: true, clips: true, recaps: true, milestones: true, highlights: false, subRoles: false }, clipsWhere: '#zzclips', hasClipsChannel: true })`.

3. Every dashboard sample gets `cards`, built the way `gatherCards()` builds them, for the features it is rendered with. Add after `const SAMPLES = {…};`:

```js
const { buildCards } = require('../src/services/dashboardCards');
// What GET /dashboard gathers for the working cards (gatherCards() in routes/dashboard.js), from a sample's locals:
// a sample with the bot connected also has commands, sponsor messages, tips, a goal, a reward and a giveaway.
function sampleCards(data, features) {
  const full = !!data.botConnected;
  return buildCards({
    streamer: data.streamer,
    features,
    now: Date.parse('2026-10-14T12:00:00Z'),
    appUrl: 'https://example.test',
    bot: { connected: full, moderator: full ? false : null, username: data.botUsername || '' },
    overlay: { url: data.overlayUrl, open: !!data.overlayUrl },
    discord: data.discordNotifications,
    commands: full ? [1, 2, 3, 4, 5].map((n) => ({ id: n, command: `zzcmd${n}`, response: `zzresponse${n}`, cooldown: 7 })) : [],
    bannedWords: { total: 2, regex: 0 },
    modActionsThisWeek: 3,
    sponsorMessages: full ? [1, 2, 3, 4].map((n) => ({ id: n, message_text: `zzsponsor${n}`, url: n === 1 ? 'https://example.test/zz' : null, enabled: n % 2 })) : [],
    tips: {
      count90d: full ? 2 : 0,
      recent: full ? [{ id: 1, amount: 5, currency: 'EUR', donor_name: 'zzdonor', message: 'zzmessage', created_at: '2026-10-12 10:00:00' }, { id: 2, amount: 2.5, currency: 'USD', donor_name: null, message: '', created_at: '2026-10-14 11:59:30' }] : [],
    },
    tipGoal: full ? { title: 'zzgoal', current_amount: 101, target_amount: 1000, currency: 'EUR' } : null,
    rewards: full ? [{ id: 1, title: 'zzreward', cost: 500, enabled: 1 }, { id: 2, title: 'zzpaused', cost: 50, enabled: 0 }] : [],
    rewardsAccess: { hasScope: data.hasScope },
    giveaway: data.activeGiveaway ? { id: 3, keyword: 'zzword', prize: 'zzprize', ends_at: '2026-10-14T12:05:00.000Z', winners_count: 2, subs_only: 1, entryCount: 4 } : null,
    spotifyConnected: !!data.streamer.spotify_access_token,
    multistreamAvailable: !!data.multistreamAvailable && !!features.youtube,
  });
}
```

and in the `OVERLAY_SWITCH_PAGES` loop build the dashboard's `cards` with each sample's features:

```js
for (const page of OVERLAY_SWITCH_PAGES) {
  SAMPLES[page] = SAMPLES[page].flatMap(([name, data]) => [true, false].map((overlays) => {
    const features = { ...(data.features || { youtube: true }), overlays, vtuber: overlays };
    const locals = { ...data, features };
    if (page === 'dashboard') locals.cards = sampleCards(data, features);
    return [`${name}, overlay features ${overlays ? 'on' : 'off'}`, locals];
  }));
}
```

4. In `describe('rendered with each message as its key, …')` → `before`, copy the partials with the pages: `fs.cpSync(path.join(VIEWS, 'cards'), path.join(dir, 'cards'), { recursive: true });`.

5. In `'switched on, they ask for the texts about them again'`, `wanted.dashboard` becomes `['dashboard.cards.overlay.title', 'dashboard.cards.cpRewards', 'dashboard.vtuber.title', 'dashboard.tab.experimental', 'dashboard.youtube.overlayDesc', 'cards.overlay.source', 'cards.donations.goal', 'cards.sponsors.images']`.

- [ ] **Step 7: Run the tests and the suite**

Run: `node --test src/routes/dashboard.test.js tests/i18nViewsPart1.test.js tests/i18n.test.js tests/scriptEmbeds.test.js tests/headerView.test.js src/csrf.test.js` then the full suite.
Expected: PASS. If a word of English is reported in a card partial, it was typed instead of a `t()` call: move it to a key. If `\bundefined\b` is reported, a sample lacks a field a card reads: give it in `sampleCards()`, never in the partial with a fallback that hides a missing value.

- [ ] **Step 8: Document and commit**

`CLAUDE.md`, Dashboard bullet: replace the sentence about the Twitch tab's cards ("Twitch tab: the account row …, each with a status line and one main button.") with: "Twitch tab: the account row (linked channel, Enable Sub Sync, or Reconnect Twitch), the last 7 days in one strip, then the **working cards** (`views/cards/*.ejs`, in `cards.order`): Chatbot, Discord notifications, OBS overlay, Commands, Sponsor messages, Donations, Chat protection, Giveaways, Channel point rewards, Spotify (the overlay and rewards cards only with `features.overlays`; Multistream last while the relay is configured). A card's switches save as they move and its short texts are edited in a pop-up (`public/js/dashboard-cards.js`); a card that needs the chatbot fades while it is off; a card that is not set up shows its one setup step. The columns fill the window (`repeat(auto-fill, minmax(340px, 1fr))`, packed by the page script)." Keep the rest of the bullet (the Discord notifications card's logic in `discordNotificationsCard()`).

```bash
git add src/views/cards src/views/dashboard.ejs src/routes/dashboard.js src/locales/en.json src/locales/pt.json src/locales/es.json src/locales/fr.json src/locales/de.json src/locales/zh.json src/locales/ja.json src/routes/dashboard.test.js tests/i18nViewsPart1.test.js CLAUDE.md
git commit -m "feat(dashboard): the Twitch tab becomes ten working cards"
```

---

### Task 15: The cards' texts in six languages; the old cards' texts go

**Files:**
- Modify: `src/locales/{pt,es,fr,de,zh,ja}.json` (the `cards.*` keys translated), all seven files (the old cards' keys removed)
- Modify: `tests/i18nViewsPart1.test.js` (`REPLACEMENTS`)
- Modify: `CLAUDE.md` (Feature Flags bullet)

**Interfaces:** none (texts only).

- [ ] **Step 1: Translate the `cards.*` keys**

Task 14 put the English text of every `cards.*` key into the six other files. Translate each one there, following `.superpowers/sdd/stream-fixes/i18n-glossary.md` in this worktree (tone per language: pt = Brazilian Portuguese with "você", es "tú", fr "vous", de "du", zh Simplified Chinese, ja polite です/ます; the same word for a thing the file already translates — chatbot, server, channel, role, settings; never translate Atleta, Twitch, OBS, PayPal, Spotify, Discord, Bits, Tier). Copy every `{{placeholder}}` exactly. Keep verbatim: `!discord`, `!socials`, `!permit`, `!song`, the `#` before `{{channel}}`, and the separator `·`. Button and label texts stay about as short as the English. `cards.events.*` are the same words the file already uses for follows, subs, gift subs, bits, donations and raids (look up `dashboard.week.*` in that file).

Then list the values still equal to the English:

```bash
node -e '
const en = require("./src/locales/en.json");
for (const lang of ["pt", "es", "fr", "de", "zh", "ja"]) {
  const file = require("./src/locales/" + lang + ".json");
  const same = Object.keys(en).filter((k) => k.startsWith("cards.") && file[k] === en[k]);
  console.log(lang, same.join(", ") || "-");
}'
```

Expected: only values that are the same in that language (for example `cards.events.bits` "Bits", `cards.common.minutes` "{{minutes}} min"); translate any other.

- [ ] **Step 2: Remove the old cards' keys**

Nothing names these 36 keys since Task 14 (the old Twitch tab used them). Delete them from all seven locale files:

```text
dashboard.cards.cpRewards.desc, dashboard.cards.cpRewards.cta, dashboard.cards.cpRewards.reconnect, dashboard.cards.cpRewards.affiliate,
dashboard.cards.cpRewards.reconnectHint, dashboard.cards.giveaways.desc, dashboard.cards.giveaways.descChat, dashboard.cards.giveaways.cta,
dashboard.cards.giveaways.live, dashboard.week.subtitle, dashboard.week.total, dashboard.cards.overlay.alertsLabel,
dashboard.cards.overlay.sponsorsLabel, dashboard.cards.overlay.desc, dashboard.cards.overlay.customize, dashboard.cards.chatbot.online,
dashboard.cards.chatbot.onlineAs, dashboard.cards.chatbot.availableNotEnabled, dashboard.cards.chatbot.activeOn, dashboard.cards.chatbot.setup,
dashboard.cards.discord.desc, dashboard.cards.discord.on, dashboard.cards.discord.off, dashboard.cards.discord.serverSettings,
dashboard.cards.discord.setUpPosts, dashboard.cards.discord.setUp, dashboard.cards.spotify.reconnect, dashboard.cards.sponsors.sub,
dashboard.cards.sponsors.desc, dashboard.cards.sponsors.descChat, dashboard.cards.sponsors.cta, dashboard.cards.donations.sub,
dashboard.cards.donations.active, dashboard.cards.donations.setup, dashboard.cards.donations.setupChat, dashboard.cards.donations.cta
```

Before deleting, confirm each is unused — this prints nothing when all 36 are:

```bash
for k in $(printf '%s\n' dashboard.cards.cpRewards.desc dashboard.cards.cpRewards.cta dashboard.cards.cpRewards.reconnect dashboard.cards.cpRewards.affiliate dashboard.cards.cpRewards.reconnectHint dashboard.cards.giveaways.desc dashboard.cards.giveaways.descChat dashboard.cards.giveaways.cta dashboard.cards.giveaways.live dashboard.week.subtitle dashboard.week.total dashboard.cards.overlay.alertsLabel dashboard.cards.overlay.sponsorsLabel dashboard.cards.overlay.desc dashboard.cards.overlay.customize dashboard.cards.chatbot.online dashboard.cards.chatbot.onlineAs dashboard.cards.chatbot.availableNotEnabled dashboard.cards.chatbot.activeOn dashboard.cards.chatbot.setup dashboard.cards.discord.desc dashboard.cards.discord.on dashboard.cards.discord.off dashboard.cards.discord.serverSettings dashboard.cards.discord.setUpPosts dashboard.cards.discord.setUp dashboard.cards.spotify.reconnect dashboard.cards.sponsors.sub dashboard.cards.sponsors.desc dashboard.cards.sponsors.descChat dashboard.cards.sponsors.cta dashboard.cards.donations.sub dashboard.cards.donations.active dashboard.cards.donations.setup dashboard.cards.donations.setupChat dashboard.cards.donations.cta); do
  grep -rlF "'$k'" src --include='*.js' --include='*.ejs' | grep -v '/locales/' | sed "s|^|$k used in |"
done
```

(The `src/**/*.test.js` files may still name a few of them; the next bullet handles the one that does.) In `tests/i18nViewsPart1.test.js`, take `'dashboard.cards.giveaways.descChat'`, `'dashboard.cards.sponsors.descChat'` and `'dashboard.cards.donations.setupChat'` out of `REPLACEMENTS` (the cards that used them are gone); then `grep -rn "dashboard\.cards\.\(giveaways\.desc\|sponsors\.desc\|donations\.setup\|discord\.\(on\|off\|serverSettings\|setUpPosts\)\)" src tests` must find nothing.

- [ ] **Step 3: Run the tests**

Run: `node --test tests/i18n.test.js tests/i18nViewsPart1.test.js tests/streamerViewsI18n.test.js` then the full suite — Expected: PASS.

- [ ] **Step 4: Document and commit**

`CLAUDE.md`, Feature Flags bullet: replace "the giveaways, sponsors and donations cards, the Kick tab, the donations page intro, the YouTube chatbot headings and the account-disabled page use their `…Chat` texts (for example `dashboard.cards.giveaways.descChat`), which name no overlay" with "the Kick tab, the donations page intro, the YouTube chatbot headings and the account-disabled page use their `…Chat` texts (for example `dashboard.kick.comingSoonChat`), which name no overlay; the working cards' texts never name the overlays outside the OBS overlay and rewards cards, the tip goal and the sponsor-images link, which are left out".

```bash
git add src/locales/en.json src/locales/pt.json src/locales/es.json src/locales/fr.json src/locales/de.json src/locales/zh.json src/locales/ja.json tests/i18nViewsPart1.test.js CLAUDE.md
git commit -m "i18n(dashboard): the working cards in seven languages; the old cards' texts removed"
```

---

### Task 16: The cards save as they change (the page script, first half)

**Files:**
- Create: `public/js/dashboard-cards-core.js`, `tests/dashboardCardsCore.test.js`
- Create: `public/js/dashboard-cards.js`
- Modify: `src/views/dashboard.ejs` (the texts table and the two script tags)
- Modify: `src/locales/*.json` (the keys below, translated)
- Modify: `src/routes/dashboard.test.js`
- Modify: `CLAUDE.md` (Dashboard bullet)

**Interfaces:**
- Consumes: the markup contract (Task 14); `POST /dashboard/settings` (Task 10); `GET /dashboard/api/cards` (Task 13).
- Produces: `window.ATLETA_CARDS = { rowSpan, fill, readAnswer, createLatestQueue, formatLeft, parseUtc }` (also `module.exports`); `window.ATLETA_CARD_TEXTS` (the texts table); in `dashboard-cards.js`, the helpers Task 17 uses inside the same file: `$`, `$$`, `call(method, url, body)`, `announce(text)`, `showSaved(card)`, `messageFor(answer)`, `showMessage(card, answer, { fixHref, box, info })`, `clearMessage(card)`, `refreshSoon()`, `reflect(control)`, `queueFor(control)`, `onClick(selector, handle)`, `repack()`, and the line `  // ── Start ──` above which Task 17 adds its code.

- [ ] **Step 1: Write the failing tests of the helpers**

Create `tests/dashboardCardsCore.test.js`:

```js
'use strict';

// The working cards' pure helpers (public/js/dashboard-cards-core.js), loaded as Node loads them: packing, filling
// a text, reading an answer, saving the newest value of a control, the giveaway clock.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../public/js/dashboard-cards-core.js');

// A fetch() Response as readAnswer() reads it.
const response = (status, body, type = 'application/json; charset=utf-8') => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (name) => (name.toLowerCase() === 'content-type' ? type : null) },
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
});

// A send() whose answers the test gives, one at a time.
function deferredSend() {
  const sent = [];
  const waiting = [];
  const send = (value) => new Promise((resolve) => { sent.push(value); waiting.push(resolve); });
  return { send, sent, answer: (result) => waiting.shift()(result) };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('rowSpan', () => {
  test('a card spans its height plus the 12 px gap, in 2 px rows', () => {
    assert.equal(core.rowSpan(100), 56);
    assert.equal(core.rowSpan(101), 57);
    assert.equal(core.rowSpan(0), 6);
  });
});

describe('fill', () => {
  test('fills each {{field}} once; a missing one is empty', () => {
    assert.equal(core.fill('{{on}} of {{total}} on', { on: 1, total: 6 }), '1 of 6 on');
    assert.equal(core.fill('Show all ({{count}})', {}), 'Show all ()');
    assert.equal(core.fill('{{a}}', { a: '{{b}}', b: 'x' }), '{{b}}', 'a value is not filled again');
  });
});

describe('readAnswer', () => {
  test('a route that did it', async () => {
    assert.deepEqual(await core.readAnswer(response(200, { ok: true, value: 1 })), { ok: true, status: 200, data: { ok: true, value: 1 } });
    assert.equal((await core.readAnswer(response(201, { id: 3, keyword: 'gw' }))).ok, true, 'an answer without ok counts as done');
  });

  test('a refusal keeps its code and its words', async () => {
    const answer = await core.readAnswer(response(409, { ok: false, code: 'no_email', error: 'Add your PayPal email first' }));
    assert.deepEqual([answer.ok, answer.kind, answer.code, answer.error, answer.status], [false, 'refused', 'no_email', 'Add your PayPal email first', 409]);
    assert.equal((await core.readAnswer(response(403, { ok: false, error: 'Reload the page' }))).kind, 'refused', 'the CSRF check');
    assert.equal((await core.readAnswer(response(429, { ok: false, error: 'Please wait' }))).error, 'Please wait');
  });

  test('a page instead of JSON is a session that ended; a server error is a failure', async () => {
    assert.deepEqual(await core.readAnswer(response(200, '<html>login</html>', 'text/html')), { ok: false, kind: 'session', status: 200 });
    assert.equal((await core.readAnswer(response(403, '<html>disabled</html>', 'text/html'))).kind, 'session');
    assert.equal((await core.readAnswer(response(502, '<html>bad gateway</html>', 'text/html'))).kind, 'failed');
    const failed = await core.readAnswer(response(502, { ok: false, error: 'Twitch did not take it', reward: { enabled: 1 } }));
    assert.deepEqual([failed.kind, failed.error, failed.data.reward.enabled], ['failed', 'Twitch did not take it', 1]);
    assert.equal((await core.readAnswer(response(200, 'not json'))).kind, 'failed', 'JSON that does not parse');
  });
});

describe('createLatestQueue', () => {
  test('quick changes: one request at a time, only the newest waiting value is sent next, the server ends with the last click', async () => {
    const { send, sent, answer } = deferredSend();
    const done = [];
    const queue = core.createLatestQueue(send, { confirmed: false, onDone: (result, held) => done.push([result.ok, held]) });
    queue.push(true);
    queue.push(false);
    queue.push(true);
    assert.deepEqual(sent, [true], 'one request at a time');
    answer({ ok: true });
    await tick();
    assert.deepEqual(sent, [true, true], 'the middle click is never sent');
    answer({ ok: true });
    await tick();
    assert.deepEqual(done, [[true, true]], 'one answer for the whole burst');
    assert.equal(queue.confirmed, true);
  });

  test('a refused last value gives back what the server holds; a send that throws counts as no network', async () => {
    const { send, answer } = deferredSend();
    const done = [];
    const queue = core.createLatestQueue(send, { confirmed: 0, onDone: (result, held) => done.push([result.ok, result.kind, held]) });
    queue.push(1);
    answer({ ok: true });
    await tick();
    queue.push(2);
    answer({ ok: false, kind: 'refused' });
    await tick();
    assert.deepEqual(done, [[true, undefined, 1], [false, 'refused', 1]]);
    const failing = core.createLatestQueue(() => { throw new Error('offline'); }, { confirmed: 5, onDone: (result, held) => done.push([result.ok, result.kind, held]) });
    failing.push(6);
    await tick();
    assert.deepEqual(done.at(-1), [false, 'network', 5]);
  });
});

describe('the giveaway clock', () => {
  test('formatLeft: m:ss, h:mm:ss from an hour on, 0:00 once over', () => {
    assert.equal(core.formatLeft(0), '0:00');
    assert.equal(core.formatLeft(-5000), '0:00');
    assert.equal(core.formatLeft(1), '0:01');
    assert.equal(core.formatLeft(61000), '1:01');
    assert.equal(core.formatLeft(3600000), '1:00:00');
  });

  test('parseUtc reads the database\'s UTC times, with or without their zone', () => {
    const want = Date.UTC(2026, 9, 14, 10, 0, 0);
    assert.equal(core.parseUtc('2026-10-14 10:00:00'), want);
    assert.equal(core.parseUtc('2026-10-14T10:00:00.000Z'), want);
    assert.equal(core.parseUtc('2026-10-14T12:00:00+02:00'), want);
    assert.ok(Number.isNaN(core.parseUtc('')));
    assert.ok(Number.isNaN(core.parseUtc('soon')));
  });
});
```

Run: `node --test tests/dashboardCardsCore.test.js` — Expected: FAIL (module not found).

- [ ] **Step 2: Write `public/js/dashboard-cards-core.js`**

```js
'use strict';

// The working cards' pure helpers, apart from the page script (public/js/dashboard-cards.js) so node:test loads them
// (tests/dashboardCardsCore.test.js). Dual-exported: window.ATLETA_CARDS for the page, module.exports for Node.
// Served as it is (no build step).
(function () {
  // How many 2 px grid rows a card of this height spans in the packed grid, its 12 px gap below included.
  function rowSpan(height, row = 2, gap = 12) {
    return Math.max(1, Math.ceil((height + gap) / row));
  }

  // A text of the page's table with its {{fields}} filled in, once (as t() does on the server).
  function fill(template, params) {
    return String(template).replace(/\{\{(\w+)\}\}/g, (match, name) => {
      const value = params ? params[name] : undefined;
      return value === undefined || value === null ? '' : String(value);
    });
  }

  // What a fetch() answer means for a card:
  //   { ok: true, status, data }                          the route did it (an answer without `ok` counts);
  //   { ok: false, kind: 'refused', status, code, error, data }   the route said no; `error` is translated;
  //   { ok: false, kind: 'failed', status, … }            the server failed (5xx, or JSON that does not parse);
  //   { ok: false, kind: 'session', status }              a page came back instead of JSON: the login page after the
  //                                                       session ended (fetch followed the redirect), or the
  //                                                       account-disabled page.
  // A fetch that throws (no network) is the caller's { ok: false, kind: 'network' }.
  async function readAnswer(response) {
    const type = (response.headers && typeof response.headers.get === 'function' && response.headers.get('content-type')) || '';
    if (!/application\/json/i.test(type)) {
      return response.status >= 500 ? { ok: false, kind: 'failed', status: response.status } : { ok: false, kind: 'session', status: response.status };
    }
    let data;
    try {
      data = await response.json();
    } catch (e) {
      return { ok: false, kind: 'failed', status: response.status };
    }
    if (response.ok && !(data && data.ok === false)) return { ok: true, status: response.status, data };
    const refusal = { status: response.status, code: (data && data.code) || null, error: (data && data.error) || null, data };
    return { ok: false, kind: response.status >= 500 ? 'failed' : 'refused', ...refusal };
  }

  // Saves a control's value, newest first: one request at a time; while one is on its way, only the latest change
  // waits (the ones in between are never sent). When nothing is left to send, onDone(lastAnswer, held) runs once,
  // `held` being the last value the server took (the control shows it again when the last answer was a refusal).
  function createLatestQueue(send, { confirmed, onDone }) {
    let busy = false;
    let waiting = false;
    let next;
    let held = confirmed;
    async function run() {
      busy = true;
      let answer;
      while (waiting) {
        const value = next;
        waiting = false;
        try {
          answer = await send(value);
        } catch (e) {
          answer = { ok: false, kind: 'network' };
        }
        if (answer && answer.ok) held = value;
      }
      busy = false;
      onDone(answer, held);
    }
    return {
      push(value) {
        next = value;
        waiting = true;
        if (!busy) run();
      },
      get confirmed() {
        return held;
      },
    };
  }

  // A countdown: m:ss, or h:mm:ss from an hour on; 0:00 once it is over.
  function formatLeft(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const pad = (n) => String(n).padStart(2, '0');
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
  }

  // A time the server stored in UTC: 'YYYY-MM-DD HH:MM:SS' (SQLite) or ISO with its zone. NaN when it is none.
  function parseUtc(value) {
    const text = String(value || '').trim();
    if (!text) return NaN;
    return Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
  }

  const CARDS = { rowSpan, fill, readAnswer, createLatestQueue, formatLeft, parseUtc };
  if (typeof module !== 'undefined' && module.exports) module.exports = CARDS;
  if (typeof window !== 'undefined') window.ATLETA_CARDS = CARDS;
})();
```

Run: `node --test tests/dashboardCardsCore.test.js` — Expected: PASS.

- [ ] **Step 3: The texts the script needs**

Add to `en.json` (and translated, as in Task 15, to the six others):

```json
"cards.common.showFewer": "Show fewer",
"cards.common.copyFailed": "Copy it by hand",
"cards.common.sessionEnded": "Your session ended. Reload the page to go on.",
"cards.common.network": "Can't reach the server. Check your connection and try again.",
"cards.common.failed": "That didn't work. Try again in a moment.",
"cards.common.fixIt": "Set it up",
"cards.chatbot.sentToChat": "Sent to your chat",
"cards.commands.confirmDelete": "Delete !{{name}}?",
"cards.sponsors.confirmDelete": "Delete this sponsor message?",
"cards.protection.moderatorYes": "{{bot}} is a moderator in your chat.",
"cards.protection.moderatorNo": "Twitch still says {{bot}} is not a moderator. Type the command in your chat, then check again.",
"cards.protection.moderatorUnknown": "The bot is not in your chat right now. Switch the chatbot on, then check again.",
"cards.giveaways.status.picked": "Winner picked",
"cards.giveaways.winner": "Winner: {{names}}",
"cards.giveaways.nobody": "Nobody entered",
"cards.giveaways.pickAgain": "Pick again",
"cards.giveaways.done": "Done",
"cards.overlay.alertSent": "Test alert sent to your OBS overlay",
"cards.rewards.played": "Playing it on your overlay",
"cards.donations.goalHint": "Raised so far: {{raised}}. Only tips in {{currency}} count."
```

In `src/views/dashboard.ejs`, right above the last `<script>` (the one with `switchTab`), add:

```ejs
<%# The working cards' script (public/js/dashboard-cards.js) takes its texts from this table; a text with {{fields}}
    is filled in by the script. The overlay texts are left out while the overlay features are off. %>
<%
  const _cardTexts = {
    saved: t('cards.common.saved'),
    copy: t('dashboard.copy'),
    copied: t('dashboard.copied'),
    copyFailed: t('cards.common.copyFailed'),
    showAll: t('cards.common.showAll', { count: '{{count}}' }),
    showFewer: t('cards.common.showFewer'),
    seconds: t('cards.common.seconds', { seconds: '{{seconds}}' }),
    edit: t('cards.common.edit'),
    sessionEnded: t('cards.common.sessionEnded'),
    network: t('cards.common.network'),
    failed: t('cards.common.failed'),
    fixIt: t('cards.common.fixIt'),
    sentToChat: t('cards.chatbot.sentToChat'),
    commandEditTitle: t('cards.commands.editTitle', { name: '{{name}}' }),
    confirmDeleteCommand: t('cards.commands.confirmDelete', { name: '{{name}}' }),
    confirmDeleteSponsor: t('cards.sponsors.confirmDelete'),
    moderatorYes: t('cards.protection.moderatorYes', { bot: cards.protection.botName }),
    moderatorNo: t('cards.protection.moderatorNo', { bot: cards.protection.botName }),
    moderatorUnknown: t('cards.protection.moderatorUnknown'),
    giveaway: {
      running: t('cards.giveaways.status.running'),
      picked: t('cards.giveaways.status.picked'),
      none: t('cards.giveaways.status.none'),
      winner: t('cards.giveaways.winner', { names: '{{names}}' }),
      nobody: t('cards.giveaways.nobody'),
      pick: t('cards.giveaways.pick'),
      pickAgain: t('cards.giveaways.pickAgain'),
      end: t('cards.giveaways.end'),
      done: t('cards.giveaways.done'),
    },
  };
  if (features.overlays) {
    Object.assign(_cardTexts, {
      alertSent: t('cards.overlay.alertSent'),
      rewardPlayed: t('cards.rewards.played'),
      startGoal: t('cards.donations.startGoal'),
      goalAmount: t('cards.donations.goalAmount', { raised: '{{raised}}', target: '{{target}}' }),
      goalHint: t('cards.donations.goalHint', { raised: '{{raised}}', currency: '{{currency}}' }),
    });
  }
%>
<script>window.ATLETA_CARD_TEXTS = <%- JSON.stringify(_cardTexts).replace(/</g, '\\u003c') %>;</script>
<script src="/js/dashboard-cards-core.js"></script>
<script src="/js/dashboard-cards.js"></script>
```

- [ ] **Step 4: Write `public/js/dashboard-cards.js`**

```js
'use strict';

// The dashboard's working cards (views/cards/*.ejs). Every switch and select saves the moment it changes
// (POST /dashboard/settings) and the cards' status lines follow (GET /dashboard/api/cards); the copy, show-link,
// show-all and packing work here too, and the pop-up editors, the test buttons, the rewards, the moderator check and
// the giveaway panel below them. Texts: window.ATLETA_CARD_TEXTS (dashboard.ejs). Helpers: window.ATLETA_CARDS
// (dashboard-cards-core.js). Served as it is (no build step).
(function () {
  const core = window.ATLETA_CARDS;
  const T = window.ATLETA_CARD_TEXTS || {};
  const grid = document.getElementById('wc-grid');
  if (!core || !grid) return;
  const live = document.getElementById('wc-live');
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.prototype.slice.call((root || document).querySelectorAll(selector));

  // ── The server ──

  // A JSON request (public/js/csrf.js adds the CSRF header); its answer as readAnswer() reads it.
  async function call(method, url, body) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
      return await core.readAnswer(response);
    } catch (e) {
      return { ok: false, kind: 'network' };
    }
  }

  // ── What a card says back ──

  function announce(text) {
    if (!live || !text) return;
    live.textContent = '';
    setTimeout(() => { live.textContent = text; }, 50);
  }
  function showSaved(card) {
    const saved = card && $('[data-saved]', card);
    if (saved) {
      saved.classList.add('show');
      clearTimeout(saved.hideTimer);
      saved.hideTimer = setTimeout(() => saved.classList.remove('show'), 1600);
    }
    announce(T.saved);
  }
  // The words for an answer that did not go through (a server error's own text is English: not shown).
  function messageFor(answer) {
    if (answer.kind === 'session') return T.sessionEnded;
    if (answer.kind === 'network') return T.network;
    if (answer.kind === 'refused') return answer.error || T.failed;
    return (answer.status !== 500 && answer.error) || T.failed;
  }
  // A card's message line, or a pop-up's (box): an answer's words, or a text; for a refusal that asks for a step
  // (no_channel, no_role, no_email), the link to the page that sets it.
  function showMessage(card, answer, { fixHref, box, info } = {}) {
    const target = box || (card && $('[data-msg]', card));
    if (!target) return;
    target.textContent = typeof answer === 'string' ? answer : messageFor(answer);
    target.classList.toggle('info', !!info);
    if (fixHref && answer && typeof answer === 'object' && /^no_(channel|role|email)$/.test(answer.code || '')) {
      const link = document.createElement('a');
      link.href = fixHref;
      link.textContent = T.fixIt;
      target.append(' ', link);
    }
    target.hidden = false;
    announce(target.textContent);
    repack();
  }
  function clearMessage(card) {
    const box = card && $('[data-msg]', card);
    if (box && !box.hidden) {
      box.hidden = true;
      box.textContent = '';
      repack();
    }
  }

  // ── The status lines ──

  // After a change, the cards' status lines and counts as the server sees them now: one request for a burst.
  let refreshTimer = null;
  function refreshSoon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 400);
  }
  async function refresh() {
    const answer = await call('GET', '/dashboard/api/cards');
    if (!answer.ok || !answer.data || !answer.data.cards) return;
    for (const [name, texts] of Object.entries(answer.data.cards)) {
      const card = document.getElementById('card-' + name);
      if (!card) continue;
      const status = $('[data-status]', card);
      if (status && texts.status) {
        status.textContent = texts.status.text;
        status.className = 'wc-status' + (texts.status.tone === 'ok' ? '' : ' ' + texts.status.tone);
      }
      for (const [count, text] of Object.entries(texts.counts || {})) {
        const el = $('[data-count="' + count + '"]', card);
        if (el) el.textContent = text;
      }
    }
  }

  // ── Switches, selects and the volume ──

  function valueOf(control) {
    if (control.type === 'checkbox') return control.checked;
    const n = Number(control.value);
    return control.dataset.scale ? n / Number(control.dataset.scale) : n;
  }
  function setValue(control, value) {
    if (control.type === 'checkbox') control.checked = !!value;
    else control.value = String(control.dataset.scale ? Math.round(value * Number(control.dataset.scale)) : value);
    reflect(control);
  }
  // What a control's state changes around it: its row or tile, what fades with a card's main switch, the cards that
  // need the chatbot, the volume's percent.
  function reflect(control) {
    if (control.type === 'checkbox') {
      const on = control.checked;
      const row = control.closest('.wc-row');
      if (row) row.classList.toggle('is-off', !on);
      const tile = control.closest('.wc-sw');
      if (tile) tile.classList.toggle('is-on', on);
      const key = control.dataset.setting;
      if (key && !control.dataset.guildId && !control.dataset.id) {
        $$('[data-dim-with="' + key + '"]').forEach((el) => el.classList.toggle('wc-dim', !on));
        if (key === 'chatbot_enabled') $$('[data-needs-chatbot]').forEach((card) => card.classList.toggle('needs-bot', !on));
      }
    } else if (control.type === 'range') {
      const label = $('[data-volume-label]', control.parentNode);
      if (label) label.textContent = control.value + '%';
    }
  }
  function settingBody(control, value) {
    const body = { key: control.dataset.setting, value };
    if (control.dataset.guildId) body.guildId = control.dataset.guildId;
    if (control.dataset.id) body.id = Number(control.dataset.id);
    return body;
  }
  // Each control saves through its own queue: the newest value wins; a refused one goes back to what the server
  // holds, with the reason (and the page that fixes it) on the card.
  const queues = new WeakMap();
  function queueFor(control) {
    if (!queues.has(control)) {
      queues.set(control, core.createLatestQueue((value) => call('POST', '/dashboard/settings', settingBody(control, value)), {
        confirmed: valueOf(control),
        onDone(answer, held) {
          const card = control.closest('.wc-card');
          if (answer && answer.ok) {
            clearMessage(card);
            showSaved(card);
            refreshSoon();
            return;
          }
          setValue(control, held);
          showMessage(card, answer || { ok: false, kind: 'failed' }, { fixHref: control.dataset.fixHref });
        },
      }));
    }
    return queues.get(control);
  }
  grid.addEventListener('change', (event) => {
    const control = event.target.closest('[data-setting]');
    if (!control || !grid.contains(control)) return;
    reflect(control);
    queueFor(control).push(valueOf(control));
  });
  grid.addEventListener('input', (event) => {
    if (event.target.type === 'range' && event.target.dataset.setting) reflect(event.target);
  });

  // ── Clicks: the first handler that knows the element takes it ──

  const clickHandlers = [];
  function onClick(selector, handle) {
    clickHandlers.push((event) => {
      const el = event.target.closest(selector);
      if (!el || !grid.contains(el)) return false;
      handle(el, event);
      return true;
    });
  }
  grid.addEventListener('click', (event) => {
    for (const handle of clickHandlers) if (handle(event)) return;
  });

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      let done = false;
      try { done = document.execCommand('copy'); } catch (e2) { done = false; }
      area.remove();
      return done;
    }
  }
  onClick('[data-copy]', async (button) => {
    const done = await copyText(button.dataset.copy);
    const label = $('[data-copy-label]', button);
    if (!label) return;
    label.textContent = done ? T.copied : T.copyFailed;
    announce(label.textContent);
    setTimeout(() => { label.textContent = T.copy; }, 1500);
  });
  // The OBS link stays masked until the eye is clicked: anyone with it can show alerts.
  onClick('[data-reveal]', (button) => {
    const link = $('.wc-link', button.parentNode);
    if (!link) return;
    const shown = button.getAttribute('aria-pressed') === 'true';
    link.textContent = shown ? link.dataset.masked : link.dataset.shown;
    button.setAttribute('aria-pressed', String(!shown));
  });
  onClick('[data-show-all]', (button) => {
    const list = document.getElementById(button.dataset.showAll);
    if (!list) return;
    const open = !list.classList.contains('show-all');
    list.classList.toggle('show-all', open);
    button.textContent = open ? T.showFewer : core.fill(T.showAll, { count: $$('[data-row]', list).length });
    repack();
  });
  onClick('[data-open-tab]', (link, event) => {
    const tab = document.querySelector('.tab-btn[data-tab="' + link.dataset.openTab + '"]');
    if (!tab) return;
    event.preventDefault();
    tab.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ── Packing: each card spans its own height, so the next card fills the shorter column ──

  let observer = null;
  function repack() {
    if (!grid.classList.contains('packed')) return;
    for (const card of $$('.wc-card', grid)) card.style.gridRowEnd = 'span ' + core.rowSpan(card.getBoundingClientRect().height);
  }

  // ── Start ──
  $$('[data-setting]', grid).forEach(queueFor);
  if ('ResizeObserver' in window) {
    grid.classList.add('packed');
    observer = new ResizeObserver(() => repack());
    $$('.wc-card', grid).forEach((card) => observer.observe(card));
    window.addEventListener('load', repack);
    repack();
  }
})();
```

Run: `node --check public/js/dashboard-cards.js public/js/dashboard-cards-core.js` — Expected: no output.

- [ ] **Step 5: The page loads them — failing test first, then run**

Append to `src/routes/dashboard.test.js`:

```js
// ── The working cards' script ────────────────────────────────────────────

describe('the working cards\' script', () => {
  const table = (page) => JSON.parse(page.match(/window\.ATLETA_CARD_TEXTS = (.*);<\/script>/)[1]);

  test('the page loads its texts, then the helpers, then the script', async () => {
    const html = (await request('GET', '/dashboard', { streamer: addStreamer() })).text;
    const texts = html.indexOf('window.ATLETA_CARD_TEXTS = ');
    const coreTag = html.indexOf('<script src="/js/dashboard-cards-core.js"></script>');
    const scriptTag = html.indexOf('<script src="/js/dashboard-cards.js"></script>');
    assert.ok(texts > 0 && texts < coreTag && coreTag < scriptTag);
    const T = table(html);
    assert.equal(T.showAll, t('en', 'cards.common.showAll', { count: '{{count}}' }), 'a text with a field the script fills');
    assert.equal(T.giveaway.pickAgain, t('en', 'cards.giveaways.pickAgain'));
  });

  test('the overlay texts only while the overlay features are on', async () => {
    const { features } = require('../config');
    assert.ok('alertSent' in table((await request('GET', '/dashboard', { streamer: addStreamer() })).text));
    features.overlays = false;
    try {
      const T = table((await request('GET', '/dashboard', { streamer: addStreamer() })).text);
      for (const key of ['alertSent', 'rewardPlayed', 'startGoal', 'goalAmount', 'goalHint']) assert.ok(!(key in T), key);
    } finally {
      features.overlays = true;
    }
  });
});
```

Run (before Step 3's view change this fails; after it): `node --test src/routes/dashboard.test.js tests/dashboardCardsCore.test.js tests/i18n.test.js tests/i18nViewsPart1.test.js tests/scriptEmbeds.test.js` then the full suite — Expected: PASS.

- [ ] **Step 6: Document and commit**

`CLAUDE.md`, Dashboard bullet, add: "The page script `public/js/dashboard-cards.js` (helpers in `dashboard-cards-core.js`, dual-exported and tested in `tests/dashboardCardsCore.test.js`) saves each switch through its own queue (the newest value wins; a refused one flips back with the reason and, for `no_channel`/`no_role`/`no_email`, a link to the page that sets it), refreshes the status lines from `GET /dashboard/api/cards`, packs the columns, and says \"Your session ended\" when a page comes back instead of JSON. Its texts come from `window.ATLETA_CARD_TEXTS` in `dashboard.ejs`."

```bash
git add public/js/dashboard-cards-core.js public/js/dashboard-cards.js tests/dashboardCardsCore.test.js src/views/dashboard.ejs src/locales/en.json src/locales/pt.json src/locales/es.json src/locales/fr.json src/locales/de.json src/locales/zh.json src/locales/ja.json src/routes/dashboard.test.js CLAUDE.md
git commit -m "feat(dashboard): the working cards save as they change"
```

### Task 17: Pop-ups, tests, rewards, the moderator check and the giveaway panel (the page script, second half)

**Files:**
- Modify: `public/js/dashboard-cards.js` (insert above `  // ── Start ──`)

**Interfaces:**
- Consumes: the helpers of Task 16 inside the same file; the templates and data attributes of the markup contract; the routes `POST /dashboard/settings`, `/dashboard/api/commands`, `/dashboard/sponsor-messages/add`, `/dashboard/sponsor-messages/:id/update|delete`, `/dashboard/api/tip-goal`, `/dashboard/api/tip-goal/end`, `/dashboard/chatbot/test/:event`, `/dashboard/overlay/test/:type`, `PATCH /dashboard/redemptions/:id`, `POST /dashboard/redemptions/:id/test`, `/dashboard/chatbot/check-moderator`, `/dashboard/giveaways/start`, `GET /dashboard/giveaways/:id/entries`, `/dashboard/giveaways/:id/pick`, `/dashboard/giveaways/:id/close`.

- [ ] **Step 1: Insert the second half**

In `public/js/dashboard-cards.js`, insert above the line `  // ── Start ──`:

```js
  // ── The pop-up editor ──

  const dialog = document.getElementById('wc-dialog');
  let opener = null;
  // Opens the pop-up with one of the page's <template>s: `setup(editor)` fills it; Save runs `save(editor)` and closes
  // the pop-up when that resolves true. Esc and Cancel close it; the focus goes back to the button that opened it.
  function openEditor(templateId, title, from, setup, save) {
    const template = document.getElementById(templateId);
    if (!dialog || !template) return null;
    opener = from;
    dialog.replaceChildren(template.content.cloneNode(true));
    const editor = dialog.firstElementChild;
    const heading = $('[data-title]', editor);
    if (heading) heading.textContent = title || '';
    if (setup) setup(editor);
    $$('[data-cancel]', editor).forEach((button) => button.addEventListener('click', closeEditor));
    const saveButton = $('[data-save]', editor);
    if (saveButton) {
      saveButton.addEventListener('click', async () => {
        saveButton.disabled = true;
        try {
          if (await save(editor)) closeEditor();
        } finally {
          saveButton.disabled = false;
        }
      });
    }
    dialog.showModal();
    const first = $('textarea, input, select', editor);
    if (first) {
      first.focus();
      if (first.tagName === 'TEXTAREA' || first.type === 'text') first.setSelectionRange(first.value.length, first.value.length);
    }
    return editor;
  }
  function closeEditor() {
    if (dialog && dialog.open) dialog.close();
  }
  if (dialog) {
    dialog.addEventListener('close', () => {
      dialog.replaceChildren();
      if (opener && opener.isConnected) opener.focus();
      opener = null;
    });
    // A click on the dimmed page around the pop-up closes it, as Esc does.
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeEditor();
    });
  }
  const dialogMessage = (editor, answer) => showMessage(null, answer, { box: $('[data-dialog-msg]', editor) });
  function insertAtCursor(area, text) {
    const start = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? area.value.length;
    area.value = area.value.slice(0, start) + text + area.value.slice(end);
    area.focus();
    area.selectionStart = area.selectionEnd = start + text.length;
  }
  // A button that says what happened for a moment, then its own words again.
  function flash(button, text) {
    const before = button.textContent;
    button.textContent = text;
    button.disabled = true;
    setTimeout(() => {
      button.textContent = before;
      button.disabled = false;
    }, 1800);
  }
  // A ▶ button that worked turns green for a moment.
  function tick(button) {
    button.classList.add('done');
    setTimeout(() => button.classList.remove('done'), 1500);
  }
  // A new row made from a row <template>, first in its list.
  function addRow(templateId, list) {
    const row = document.getElementById(templateId).content.firstElementChild.cloneNode(true);
    list.insertBefore(row, list.firstChild);
    return row;
  }
  // After a row is added or deleted: the count, the empty hint and Show all.
  function afterListChange(card, name) {
    const list = $('[data-list="' + name + '"]', card);
    const rows = $$('[data-row]', list);
    const empty = $('[data-empty="' + name + '"]', card);
    if (empty) empty.hidden = rows.length > 0;
    const more = $('[data-show-all="' + list.id + '"]', card);
    if (more && !list.classList.contains('show-all')) more.textContent = core.fill(T.showAll, { count: rows.length });
    const count = $('[data-count="' + name + '"]', card);
    if (count) count.textContent = String(rows.length);
    repack();
  }

  // ── Thank-you messages ──

  onClick('[data-edit="thankyou"]', (button) => {
    const card = button.closest('.wc-card');
    const row = button.closest('.wc-row');
    openEditor('tpl-thankyou', button.dataset.title, button, (editor) => {
      const area = $('[data-field="text"]', editor);
      area.value = button.dataset.value || '';
      const vars = $('[data-vars]', editor);
      for (const name of (button.dataset.vars || '').split(' ').filter(Boolean)) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'wc-var';
        chip.textContent = name;
        chip.addEventListener('click', () => insertAtCursor(area, name));
        vars.appendChild(chip);
      }
      // Posts the saved message in the streamer's chat with example values (the chatbot page's test).
      const test = $('[data-chat-test]', editor);
      test.addEventListener('click', async () => {
        const answer = await call('POST', '/dashboard/chatbot/test/' + encodeURIComponent(button.dataset.event));
        if (answer.ok) flash(test, T.sentToChat);
        else dialogMessage(editor, answer);
      });
    }, async (editor) => {
      const answer = await call('POST', '/dashboard/settings', { key: button.dataset.key, value: $('[data-field="text"]', editor).value });
      if (!answer.ok) {
        dialogMessage(editor, answer);
        return false;
      }
      button.dataset.value = answer.data.value;
      $('[data-text]', row).textContent = answer.data.value;
      showSaved(card);
      return true;
    });
  });

  // ── Commands ──

  // A select set to a value, which becomes a choice when it is not one yet (a cooldown saved on the chatbot page).
  function selectValue(select, value) {
    const text = String(value);
    if (!$$('option', select).some((option) => option.value === text)) {
      const option = document.createElement('option');
      option.value = text;
      option.textContent = core.fill(T.seconds, { seconds: text });
      select.appendChild(option);
    }
    select.value = text;
  }
  function fillCommandRow(row, command) {
    row.dataset.id = command.id;
    row.dataset.name = command.command;
    row.dataset.response = command.response;
    row.dataset.cooldown = command.cooldown;
    $('[data-field="name"]', row).textContent = command.command;
    $('[data-field="response"]', row).textContent = command.response;
    $('[data-edit="command"]', row).dataset.title = core.fill(T.commandEditTitle, { name: command.command });
  }
  function commandEditor(from, row) {
    const card = from.closest('.wc-card');
    openEditor('tpl-command', from.dataset.title, from, (editor) => {
      $('[data-field="command"]', editor).value = row ? row.dataset.name : '';
      $('[data-field="response"]', editor).value = row ? row.dataset.response : '';
      selectValue($('[data-field="cooldown"]', editor), row ? row.dataset.cooldown : 10);
    }, async (editor) => {
      const body = {
        command: $('[data-field="command"]', editor).value.trim().replace(/^!+/, ''),
        response: $('[data-field="response"]', editor).value,
        cooldown: Number($('[data-field="cooldown"]', editor).value),
      };
      const answer = row ? await call('PATCH', '/dashboard/api/commands/' + row.dataset.id, body) : await call('POST', '/dashboard/api/commands', body);
      if (!answer.ok) {
        dialogMessage(editor, answer);
        return false;
      }
      fillCommandRow(row || addRow('tpl-command-row', $('[data-list="commands"]', card)), answer.data.command);
      afterListChange(card, 'commands');
      showSaved(card);
      refreshSoon();
      return true;
    });
  }
  onClick('[data-add="command"]', (button) => commandEditor(button, null));
  onClick('[data-edit="command"]', (button) => commandEditor(button, button.closest('[data-row]')));
  onClick('[data-delete="command"]', async (button) => {
    const row = button.closest('[data-row]');
    const card = button.closest('.wc-card');
    if (!window.confirm(core.fill(T.confirmDeleteCommand, { name: row.dataset.name }))) return;
    const answer = await call('DELETE', '/dashboard/api/commands/' + row.dataset.id);
    if (!answer.ok) {
      showMessage(card, answer);
      return;
    }
    row.remove();
    afterListChange(card, 'commands');
    showSaved(card);
    refreshSoon();
  });
  // The built-in commands: the thirteen as toggles in the pop-up, saved together (one batch, all or nothing).
  onClick('[data-edit="builtins"]', (button) => {
    const card = button.closest('.wc-card');
    const pills = $$('[data-builtin]', card);
    openEditor('tpl-builtins', button.dataset.title, button, (editor) => {
      const chips = $('[data-chips]', editor);
      for (const pill of pills) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'wc-chip' + (pill.hidden ? '' : ' on');
        chip.dataset.key = pill.dataset.builtin;
        chip.setAttribute('aria-pressed', String(!pill.hidden));
        const mark = document.createElement('span');
        mark.className = 'tick';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = '✓';
        chip.append(mark, document.createTextNode(pill.dataset.name));
        chip.addEventListener('click', () => {
          const on = chip.getAttribute('aria-pressed') !== 'true';
          chip.setAttribute('aria-pressed', String(on));
          chip.classList.toggle('on', on);
        });
        chips.appendChild(chip);
      }
    }, async (editor) => {
      const changes = $$('[data-key]', editor).map((chip) => ({ key: chip.dataset.key, value: chip.getAttribute('aria-pressed') === 'true' }));
      const answer = await call('POST', '/dashboard/settings', { changes });
      if (!answer.ok) {
        dialogMessage(editor, answer);
        return false;
      }
      for (const pill of pills) pill.hidden = !answer.data.values[pill.dataset.builtin];
      $('[data-builtins-none]', card).hidden = pills.some((pill) => !pill.hidden);
      showSaved(card);
      refreshSoon();
      repack();
      return true;
    });
  });

  // ── Sponsor messages ──

  function fillSponsorRow(row, message) {
    row.dataset.id = message.id;
    row.dataset.text = message.message_text;
    row.dataset.url = message.url || '';
    $('[data-field="text"]', row).textContent = message.message_text;
    const toggle = $('[data-setting="sponsor_message_enabled"]', row);
    toggle.dataset.id = message.id;
    toggle.setAttribute('aria-label', message.message_text);
  }
  function sponsorEditor(from, row) {
    const card = from.closest('.wc-card');
    openEditor('tpl-sponsor', from.dataset.title, from, (editor) => {
      $('[data-field="message_text"]', editor).value = row ? row.dataset.text : '';
      $('[data-field="url"]', editor).value = row ? row.dataset.url : '';
    }, async (editor) => {
      const body = { message_text: $('[data-field="message_text"]', editor).value, url: $('[data-field="url"]', editor).value };
      const answer = row
        ? await call('POST', '/dashboard/sponsor-messages/' + row.dataset.id + '/update', body)
        : await call('POST', '/dashboard/sponsor-messages/add', body);
      if (!answer.ok) {
        dialogMessage(editor, answer);
        return false;
      }
      if (row) {
        fillSponsorRow(row, { id: row.dataset.id, message_text: body.message_text.trim(), url: body.url.trim() });
      } else {
        const added = addRow('tpl-sponsor-row', $('[data-list="sponsors"]', card));
        fillSponsorRow(added, answer.data.message);
        const toggle = $('[data-setting="sponsor_message_enabled"]', added);
        toggle.checked = !!answer.data.message.enabled;
        queueFor(toggle);
      }
      afterListChange(card, 'sponsors');
      showSaved(card);
      refreshSoon();
      return true;
    });
  }
  onClick('[data-add="sponsor"]', (button) => sponsorEditor(button, null));
  onClick('[data-edit="sponsor"]', (button) => sponsorEditor(button, button.closest('[data-row]')));
  onClick('[data-delete="sponsor"]', async (button) => {
    const row = button.closest('[data-row]');
    const card = button.closest('.wc-card');
    if (!window.confirm(T.confirmDeleteSponsor)) return;
    const answer = await call('POST', '/dashboard/sponsor-messages/' + row.dataset.id + '/delete', {});
    if (!answer.ok) {
      showMessage(card, answer);
      return;
    }
    row.remove();
    afterListChange(card, 'sponsors');
    showSaved(card);
    refreshSoon();
  });

  // ── The tip goal ──

  function money(amount, currency) {
    try {
      return new Intl.NumberFormat(document.documentElement.lang || 'en', { style: 'currency', currency: currency || 'EUR' }).format(Number(amount) || 0);
    } catch (e) {
      return (Number(amount) || 0).toFixed(2) + ' ' + (currency || '');
    }
  }
  function showGoal(card, goal) {
    const box = $('[data-goal]', card);
    box.hidden = !goal;
    $('[data-goal-none]', card).hidden = !!goal;
    $('[data-goal-button]', card).textContent = goal ? T.edit : T.startGoal;
    if (goal) {
      const current = Number(goal.current_amount) || 0;
      const target = Number(goal.target_amount) || 0;
      Object.assign(box.dataset, { title: goal.title, current: String(current), target: String(target), currency: goal.currency });
      $('[data-goal-title]', box).textContent = goal.title;
      $('[data-goal-amount]', box).textContent = core.fill(T.goalAmount, { raised: money(current, goal.currency), target: money(target, goal.currency) });
      $('[data-goal-bar]', box).style.width = (target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0) + '%';
    }
    repack();
  }
  onClick('[data-edit="goal"]', (button) => {
    const card = button.closest('.wc-card');
    const box = $('[data-goal]', card);
    const running = !box.hidden;
    openEditor('tpl-goal', button.dataset.title, button, (editor) => {
      $('[data-field="title"]', editor).value = running ? box.dataset.title : '';
      $('[data-field="target_amount"]', editor).value = running ? box.dataset.target : '';
      $('[data-goal-hint]', editor).textContent = core.fill(T.goalHint, { raised: money(running ? box.dataset.current : 0, box.dataset.currency), currency: box.dataset.currency });
      const end = $('[data-goal-end]', editor);
      if (!running) {
        end.hidden = true;
        return;
      }
      end.addEventListener('click', async () => {
        const answer = await call('POST', '/dashboard/api/tip-goal/end', {});
        if (!answer.ok) {
          dialogMessage(editor, answer);
          return;
        }
        showGoal(card, null);
        closeEditor();
        showSaved(card);
      });
    }, async (editor) => {
      const body = { title: $('[data-field="title"]', editor).value, target_amount: $('[data-field="target_amount"]', editor).value };
      const answer = running ? await call('PATCH', '/dashboard/api/tip-goal', body) : await call('POST', '/dashboard/api/tip-goal', body);
      if (!answer.ok) {
        dialogMessage(editor, answer);
        return false;
      }
      showGoal(card, answer.data.goal);
      showSaved(card);
      return true;
    });
  });

  // ── Test buttons ──

  onClick('[data-alert-test]', async (button) => {
    const card = button.closest('.wc-card');
    const answer = await call('POST', '/dashboard/overlay/test/' + encodeURIComponent(button.dataset.alertTest));
    if (!answer.ok) {
      showMessage(card, answer);
      return;
    }
    clearMessage(card);
    tick(button);
    announce(T.alertSent);
  });
  onClick('[data-reward-test]', async (button) => {
    const card = button.closest('.wc-card');
    const answer = await call('POST', '/dashboard/redemptions/' + encodeURIComponent(button.dataset.rewardTest) + '/test');
    if (!answer.ok) {
      showMessage(card, answer);
      return;
    }
    clearMessage(card);
    tick(button);
    announce(T.rewardPlayed);
  });

  // ── Channel point rewards: each reward's switch (the rewards page's own route) ──

  const rewardQueues = new WeakMap();
  function rewardQueue(toggle) {
    if (!rewardQueues.has(toggle)) {
      rewardQueues.set(toggle, core.createLatestQueue((on) => call('PATCH', '/dashboard/redemptions/' + toggle.dataset.rewardId, { enabled: on }), {
        confirmed: toggle.checked,
        onDone(answer, held) {
          const card = toggle.closest('.wc-card');
          if (answer && answer.ok) {
            clearMessage(card);
            showSaved(card);
            refreshSoon();
            return;
          }
          // Twitch may refuse an edit the site has saved: the answer then carries the reward as it is stored.
          const stored = answer && answer.data && answer.data.reward;
          toggle.checked = stored ? !!stored.enabled : !!held;
          reflect(toggle);
          showMessage(card, answer || { ok: false, kind: 'failed' });
        },
      }));
    }
    return rewardQueues.get(toggle);
  }
  grid.addEventListener('change', (event) => {
    const toggle = event.target.closest('[data-reward-id]');
    if (!toggle || !grid.contains(toggle)) return;
    reflect(toggle);
    rewardQueue(toggle).push(toggle.checked);
  });
  $$('[data-reward-id]', grid).forEach(rewardQueue);

  // ── Whether the bot is a moderator: Check again ──

  onClick('[data-check-moderator]', async (button) => {
    const card = button.closest('.wc-card');
    button.disabled = true;
    const answer = await call('POST', '/dashboard/chatbot/check-moderator', {});
    button.disabled = false;
    if (!answer.ok) {
      showMessage(card, answer);
      return;
    }
    if (answer.data.moderator === true) {
      $('[data-mod-note]', card).hidden = true;
      clearMessage(card);
      announce(T.moderatorYes);
      repack();
    } else if (answer.data.moderator === null) {
      showMessage(card, T.moderatorUnknown, { info: true });
    } else {
      showMessage(card, T.moderatorNo, { info: true });
    }
  });

  // ── Giveaways ──

  function setupGiveaway(card) {
    const form = $('[data-giveaway-form]', card);
    const panel = $('[data-giveaway-live]', card);
    if (!form || !panel) return;
    const status = $('[data-status]', card);
    const winnerBox = $('[data-gw-winner]', panel);
    const pick = $('[data-gw-pick]', panel);
    const end = $('[data-gw-end]', panel);
    const G = T.giveaway || {};
    let id = panel.dataset.giveawayId || null;
    let endsAt = NaN;
    let timer = null;
    let picked = false;

    function setStatus(text, tone) {
      status.textContent = text;
      status.className = 'wc-status' + (tone === 'ok' ? '' : ' ' + tone);
    }
    function showClock() {
      $('[data-gw-left]', panel).textContent = Number.isFinite(endsAt) ? core.formatLeft(endsAt - Date.now()) : '–';
    }
    function stop() {
      clearInterval(timer);
      timer = null;
    }
    // The panel of a giveaway that runs: how to enter, the entries (asked every 2 s), the time left.
    function running(giveaway) {
      id = String(giveaway.id);
      picked = false;
      endsAt = core.parseUtc(giveaway.ends_at);
      $('[data-gw-keyword]', panel).textContent = '!' + giveaway.keyword;
      $('[data-gw-winners]', panel).textContent = String(giveaway.winners_count || 1);
      $('[data-gw-entries]', panel).textContent = String(giveaway.entries || 0);
      winnerBox.classList.remove('show');
      winnerBox.textContent = '';
      pick.textContent = G.pick;
      end.textContent = G.end;
      card.classList.add('gw-running');
      setStatus(G.running, 'warn');
      showClock();
      stop();
      timer = setInterval(poll, 2000);
      repack();
    }
    async function poll() {
      showClock();
      const answer = await call('GET', '/dashboard/giveaways/' + id + '/entries');
      if (!answer.ok) return;
      $('[data-gw-entries]', panel).textContent = String(answer.data.count);
      // A timed giveaway draws its winners itself when it ends: show them.
      if (answer.data.status !== 'open' && !picked) {
        stop();
        await draw(false);
      }
    }
    async function draw(again) {
      const answer = await call('POST', '/dashboard/giveaways/' + id + '/pick', again ? { redraw: true } : {});
      if (!answer.ok) {
        showMessage(card, answer);
        return;
      }
      stop();
      picked = true;
      const names = (answer.data.winners || []).map((w) => '@' + w.username).join(', ');
      winnerBox.textContent = names ? core.fill(G.winner, { names }) : (answer.data.message || G.nobody);
      winnerBox.classList.add('show');
      pick.textContent = G.pickAgain;
      end.textContent = G.done;
      setStatus(names ? G.picked : G.none, names ? 'ok' : 'off');
      repack();
    }
    function idle() {
      stop();
      id = null;
      picked = false;
      card.classList.remove('gw-running');
      setStatus(G.none, 'off');
      repack();
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const answer = await call('POST', '/dashboard/giveaways/start', {
        keyword: String(data.get('keyword') || '').trim().replace(/^!+/, ''),
        prize: String(data.get('prize') || '').trim(),
        duration_seconds: data.get('duration_seconds') ? Number(data.get('duration_seconds')) : null,
        winners_count: Number(data.get('winners_count')) || 1,
        subs_only: data.get('subs_only') === 'on',
      });
      if (!answer.ok) {
        showMessage(card, answer);
        return;
      }
      clearMessage(card);
      running({ ...answer.data, entries: 0 });
    });
    pick.addEventListener('click', () => draw(picked));
    end.addEventListener('click', async () => {
      if (picked) {
        idle();
        return;
      }
      const answer = await call('POST', '/dashboard/giveaways/' + id + '/close', {});
      if (!answer.ok) {
        showMessage(card, answer);
        return;
      }
      idle();
    });
    if (id) {
      running({ id, keyword: panel.dataset.keyword, ends_at: panel.dataset.endsAt, winners_count: Number(panel.dataset.winners), entries: Number(panel.dataset.entries) });
    }
  }
  const giveawayCard = document.getElementById('card-giveaways');
  if (giveawayCard) setupGiveaway(giveawayCard);

```

- [ ] **Step 2: Check it parses and the suite**

Run: `node --check public/js/dashboard-cards.js` — Expected: no output. Then the full suite — Expected: PASS (nothing on the server changed).

- [ ] **Step 3: Commit**

```bash
git add public/js/dashboard-cards.js
git commit -m "feat(dashboard): pop-up editors, test buttons, rewards, moderator check and giveaway panel on the cards"
```

---

### Task 18: The browser check and Release B (controller only — not a subagent task)

Run after the final whole-branch review is clean. Everything here runs on a scratch copy with synthetic data; nothing touches production until the release step.

- [ ] **Step 1: A scratch copy with synthetic data**

```bash
SP=<the session's scratchpad directory>   # holds review-tf/tools/ from the earlier reviews
SCRATCH="$SP/cards-check/app" && mkdir -p "$SCRATCH" "$SP/cards-check/shots"
git archive HEAD | tar -x -C "$SCRATCH" && ln -s "$PWD/node_modules" "$SCRATCH/node_modules" && mkdir -p "$SCRATCH/data"
```

Write `$SP/cards-check/cards-seed.js` (synthetic data only; it uses the copy's own `src/db.js`):

```js
// Synthetic data for the working-cards browser check: node cards-seed.js <scratch root>
process.env.DISCORD_DISABLED = '1';
process.env.TWITCH_CLIENT_ID = 'x';
process.env.TWITCH_CLIENT_SECRET = 'x';
const path = require('path');
const db = require(path.join(process.argv[2], 'src', 'db.js'));
const insert = (cols) => { const k = Object.keys(cols); return Number(db.db.prepare(`INSERT INTO streamers (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...k.map((x) => cols[x])).lastInsertRowid); };
const S = insert({
  discord_user_id: '910000000000000201', discord_username: 'syn_cards', twitch_user_id: 'tw-cards', twitch_username: 'synthetic_cards',
  chatbot_enabled: 1, overlay_enabled: 1, paypal_email: 'tips@example.test', donation_page_enabled: 1, donation_currency: 'EUR',
  sponsor_send_chat: 1, sponsor_chat_interval_minutes: 15, cmd_followage_enabled: 1, mod_link_protection_enabled: 1, cp_rewards_enabled: 1, cp_affiliate_status: 'ok',
});
db.generateOverlayToken(S);
db.createSession('cards-check', S, Date.now() + 6 * 3600e3);
// The server the preload puts in the bot's cache; a go-live channel and no clips channel (so Clips is refused).
db.upsertGuild('910000000000000001', S, 'Stored name');
db.updateGuildConfig('910000000000000001', S, { recap_enabled: true, sub_role_id: '910000000000000901', sub_sync_enabled: true });
db.addWatchedChannel('910000000000000001', S, 'synthetic_cards', '910000000000000801', null, true, false, null);
for (const [name, text] of [['discord', 'Join us'], ['socials', '@synthetic'], ['setup', 'Wheel and pedals'], ['schedule', 'Mon, Wed, Fri at 21:00'], ['sim', 'iRacing today']]) db.addChatCommand(S, name, text, 10);
for (const text of ['Partner one', 'Partner two', 'Partner three', 'Partner four']) db.addSponsorMessage(S, text, null);
db.createTipGoal(S, { title: 'New wheel', target_amount: 500, currency: 'EUR', bar_color: '#22c55e', current_amount: 180 });
db.logDonation(S, { source: 'paypal', donor_name: 'RacerFan', amount: 5, currency: 'EUR', message: 'Great race', external_id: 'syn-cards-1' });
db.logDonation(S, { source: 'paypal', donor_name: '', amount: 10, currency: 'EUR', external_id: 'syn-cards-2' });
console.log('seeded streamer', S);
db.db.close();
```

Run `node "$SP/cards-check/cards-seed.js" "$SCRATCH"`, then boot the copy with the no-network preload the earlier reviews used (it blocks every outbound request, puts a synthetic server `910000000000000001` with channels `go-live`, `clips` and `welcome` in the bot's cache, and reports the chat bot as connected):

```bash
cd "$SCRATCH" && DISCORD_TOKEN=x DISCORD_CLIENT_ID=111111111111111111 DISCORD_CLIENT_SECRET=x TWITCH_CLIENT_ID=x TWITCH_CLIENT_SECRET=x DISCORD_DISABLED=1 APP_URL=http://127.0.0.1:3998 PORT=3998 node -r "$SP/review-tf/tools/preload.js" src/index.js
```

(run in the background; `curl -s http://127.0.0.1:3998/health` answers `{"ok":true}` once it is up).

- [ ] **Step 2: The checks (Playwright, headless Chromium)**

Write `$SP/cards-check/cards-check.js` and run `node "$SP/cards-check/cards-check.js" "$SCRATCH" 3998 "$SP/cards-check/shots"`:

```js
// The working cards in a browser (synthetic data, local only; every other request is aborted).
const path = require('path');
const [APP, PORT, OUT] = [process.argv[2], Number(process.argv[3]), process.argv[4]];
const { chromium } = require(path.join(APP, 'node_modules', 'playwright'));
const BASE = `http://127.0.0.1:${PORT}`;

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const ok = (cond, label) => results.push(`${cond ? 'PASS' : 'FAIL'} ${label}`);
  async function open(width) {
    const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    await ctx.addCookies([{ name: 'session', value: 'cards-check', domain: '127.0.0.1', path: '/' }]);
    await ctx.route('**/*', (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
    const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem('dashboard_tab', 'twitch'); } catch (e) { /* none */ } });
    await page.goto(`${BASE}/dashboard`);
    await page.waitForSelector('#wc-grid.packed');
    await page.waitForTimeout(400);
    return { ctx, page };
  }
  const reopen = async (page) => { await page.reload(); await page.waitForSelector('#wc-grid.packed'); await page.waitForTimeout(300); };
  const switchOf = (page, key) => page.locator(`label.pill-toggle:has([data-setting="${key}"])`).first();
  const isOn = (page, key) => page.locator(`[data-setting="${key}"]`).first().isChecked();
  const closed = (page) => page.waitForFunction(() => !document.getElementById('wc-dialog').open);

  // The layout at five widths: no sideways scroll, no overlap, nothing cut off, the columns the spec names.
  for (const [width, columns] of [[360, 1], [768, 2], [1280, 3], [1600, 4], [1920, 4]]) {
    const { ctx, page } = await open(width);
    const m = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#wc-grid > .wc-card')];
      const boxes = cards.map((c) => c.getBoundingClientRect());
      const overlaps = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]; const b = boxes[j];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps.push(`${cards[i].id}/${cards[j].id}`);
      }
      return {
        sideways: document.documentElement.scrollWidth > window.innerWidth,
        overlaps,
        columns: new Set(boxes.map((r) => Math.round(r.left))).size,
        cut: cards.filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.id),
      };
    });
    ok(!m.sideways, `${width}px: no sideways scroll`);
    ok(m.overlaps.length === 0, `${width}px: no overlapping cards ${m.overlaps.join(' ')}`);
    ok(m.columns === columns, `${width}px: ${m.columns} columns (the spec says ${columns})`);
    ok(m.cut.length === 0, `${width}px: nothing cut off ${m.cut.join(' ')}`);
    await page.screenshot({ path: path.join(OUT, `cards-${width}.png`), fullPage: true });
    await ctx.close();
  }

  const { ctx, page } = await open(1600);
  // A switch saves and keeps its position after a reload.
  await switchOf(page, 'chat_follow_enabled').click();
  await page.waitForSelector('#card-chatbot [data-saved].show');
  await reopen(page);
  ok(!(await isOn(page, 'chat_follow_enabled')), 'a switch keeps its position after a reload');
  await switchOf(page, 'chat_follow_enabled').click();
  await page.waitForSelector('#card-chatbot [data-saved].show');
  // Quick clicks: what is saved is the last one.
  const before = await isOn(page, 'mod_caps_enabled');
  for (let i = 0; i < 3; i++) await switchOf(page, 'mod_caps_enabled').click();
  await page.waitForTimeout(1500);
  const shown = await isOn(page, 'mod_caps_enabled');
  await reopen(page);
  ok(shown === !before && (await isOn(page, 'mod_caps_enabled')) === shown, 'three quick clicks: the page and the database end on the last one');
  // A refused switch flips back, with the reason and the page that sets what is missing.
  await switchOf(page, 'notify_clips').click();
  await page.waitForSelector('#card-discord [data-msg]:not([hidden])');
  ok(!(await isOn(page, 'notify_clips')), 'a refused switch flips back');
  ok((await page.locator('#card-discord [data-msg] a[href$="?tab=twitch"]').count()) === 1, 'the refusal links the server page');
  // The pop-up with the keyboard: Enter opens it with the focus in its text, Esc closes it and gives the focus back.
  const pen = page.locator('#card-chatbot [data-edit="thankyou"]').first();
  await pen.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('#wc-dialog[open] textarea');
  ok(await page.evaluate(() => document.activeElement.tagName === 'TEXTAREA'), 'the pop-up opens with the focus in its text');
  await page.keyboard.press('Escape');
  await closed(page);
  ok(await page.evaluate(() => !!document.activeElement && document.activeElement.matches('[data-edit="thankyou"]')), 'Esc closes it and the focus goes back');
  // A thank-you text and a new command, saved from their pop-ups.
  await pen.click();
  await page.fill('#wc-dialog textarea', 'Thanks {username}, welcome!');
  await page.click('#wc-dialog [data-save]');
  await closed(page);
  ok((await page.locator('#card-chatbot [data-text]').first().textContent()) === 'Thanks {username}, welcome!', 'a thank-you text saved from its pop-up');
  await page.click('#card-commands [data-add="command"]');
  await page.fill('#wc-dialog [data-field="command"]', '!newone');
  await page.fill('#wc-dialog [data-field="response"]', 'Hello there');
  await page.click('#wc-dialog [data-save]');
  await closed(page);
  ok((await page.locator('#card-commands [data-row][data-name="newone"]').count()) === 1, 'a command added from its pop-up');
  // The OBS link is masked and copies whole.
  ok((await page.locator('#card-overlay .wc-link').textContent()).includes('••••'), 'the OBS link is masked');
  await page.click('#card-overlay [data-copy]');
  ok(/\/overlay\/[\w-]{8,}$/.test(await page.evaluate(() => navigator.clipboard.readText())), 'Copy puts the whole OBS link on the clipboard');
  // A giveaway runs: started, drawn, closed.
  await page.selectOption('#card-giveaways select[name="duration_seconds"]', '');
  await page.click('#card-giveaways [data-giveaway-form] button[type="submit"]');
  await page.waitForSelector('#card-giveaways.gw-running');
  ok((await page.locator('#card-giveaways [data-gw-keyword]').textContent()) === '!gw', 'the running giveaway says how to enter');
  await page.click('#card-giveaways [data-gw-pick]');
  await page.waitForSelector('#card-giveaways [data-gw-winner].show');
  await page.click('#card-giveaways [data-gw-end]');
  await page.waitForFunction(() => !document.getElementById('card-giveaways').classList.contains('gw-running'));
  ok(true, 'a giveaway starts, is drawn and closes');
  // A session that ended while the page was open.
  await ctx.clearCookies();
  await switchOf(page, 'mod_emote_spam_enabled').click();
  await page.waitForSelector('#card-protection [data-msg]:not([hidden])');
  ok(/session/i.test(await page.locator('#card-protection [data-msg]').textContent()), 'a session that ended is said on the card');
  ok(!(await isOn(page, 'mod_emote_spam_enabled')), 'and the switch flips back');
  await ctx.close();
  await browser.close();
  console.log(results.join('\n'));
  process.exitCode = results.some((r) => r.startsWith('FAIL')) ? 1 : 0;
})();
```

Expected: every line PASS. Look at the five screenshots (Read them) against the approved mockup: the account chip above the strip, the cards in order, nothing clipped. A column count that differs from the spec is reported to the owner with the screenshots, not changed blindly. Fix anything else that fails (with a test where it can have one), commit, and run the check again. Stop the scratch app afterwards.

- [ ] **Step 3: Release B**

- Full suite green; `git status` clean.
- `scratchpad/prodcheck/prodexec.sh livecheck.js`: `registeredLive` empty and `openGiveaways` 0, else wait.
- `git push origin fix/stream-review-2026-10-13:main`; watch `railway deployment list` until the commit is `SUCCESS`; read the boot log (no `[DB migration]`, `Startup error`, `TypeError`); `GET /health` is 200, `GET /js/dashboard-cards.js` and `/js/dashboard-cards-core.js` are 200, `GET /dashboard` without a session answers 302; fast-forward the main checkout's `main`.
- Append a Team Activity Log entry to `CLAUDE.md` (role "claude (direct session)": the working cards, the settings route, the overlay switch, the release), commit and push it.
- Note the deployment in this plan's SDD ledger and update the project memory (`stream-release-2026-10.md`): the redesign is live; the six machine translations want a native read-through.
- Tell the owner what to try first: the chatbot and overlay switches, a thank-you text in its pop-up, a command, the tip goal, a giveaway.
