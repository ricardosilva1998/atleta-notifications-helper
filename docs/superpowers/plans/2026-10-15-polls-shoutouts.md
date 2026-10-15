# Polls, Predictions and Shoutouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two new working cards on the dashboard's Twitch tab — Polls & predictions (Twitch's own, driven from Atleta with templates, chat announcements, live results and an on-stream bar) and Shoutouts (`!so @name` and an automatic shoutout after a raid).

**Architecture:** Pure rules (`services/pollRules.js`) decide limits, the live view of a Twitch poll or prediction, the bar's choice and the bot's lines; `services/twitchPolls.js` talks to Helix with the streamer's broadcaster token; `services/livePolls.js` keeps each streamer's running poll and prediction from EventSub events (or one Twitch read while no event arrived) and publishes them on the bus channel `poll:<streamerId>`; `services/shoutouts.js` looks channels up and posts through the chat dispatcher. The cards follow the working-cards pattern (`dashboardCards.js` → `views/cards/*.ejs` → page scripts), with a new router `routes/polls.js` mounted inside the dashboard router and a new OBS source `/overlay/poll/<token>`.

**Tech Stack:** Node 24 (CommonJS, no build step), Express 5, EJS, better-sqlite3, tmi.js, Twitch Helix + EventSub (WebSocket), `node --test`, Playwright (browser check only).

**Spec:** `docs/superpowers/specs/2026-10-15-polls-shoutouts-design.md` (mockup: `docs/superpowers/specs/assets/2026-10-15-polls-shoutouts-mockup.html`)

## Global Constraints

- Plain CommonJS; every SQL statement lives in `src/db.js`; no ORM; config via `require('./config')`.
- Every user-facing text goes through `t()` and exists in all seven locale files (`en, pt, es, fr, de, zh, ja`) with the same `{{placeholders}}` and no empty value. A task that names a new key adds it to all seven files (the English text in the six others until Task 12 translates them), with `scripts/locale-keys.js` (Task 1).
- Twitch's limits — poll: title ≤ 60 characters, 2–5 choices ≤ 25 characters, 15–1800 s, channel-points voting 1–1,000,000 points per extra vote; prediction: title ≤ 45 characters, 2–10 outcomes ≤ 25 characters, 30–1800 s. One poll and one prediction at a time. Affiliates and Partners only.
- Permissions `channel:manage:polls` and `channel:manage:predictions`, asked by `/auth/broadcaster`, never added to `REQUIRED_BROADCASTER_SCOPES` (only the polls card asks for the reconnect).
- EventSub types (version 1): `channel.poll.begin`, `channel.poll.progress`, `channel.poll.end`, `channel.prediction.begin`, `channel.prediction.progress`, `channel.prediction.lock`, `channel.prediction.end` — subscribed only when the stored scopes include both permissions.
- Every bot line goes through `chatManager.sendMessage(streamerId, text, { priority })` (the chat dispatcher); nothing posts while the chatbot is off; lines are filled by `fillChatTemplate()` (one pass; a value never starts a command).
- Every outbound `fetch` has `AbortSignal.timeout()` (10 s for Helix).
- The bar's events go on the bus channel `poll:<streamerId>` — never `overlay:<id>`.
- Defaults: `polls_chat_enabled` 1; `shoutout_command_enabled` 0; `shoutout_raid_enabled` 0; `shoutout_raid_min_viewers` 1; the texts' defaults exactly as in Task 2.
- Card order: `chatbot, discord, overlay, commands, shoutouts, sponsors, donations, protection, giveaways, polls, rewards, spotify` (overlay and rewards only with `features.overlays`; multistream last while the relay is set up).
- Escape user content: EJS `<%= %>`, `textContent` in scripts; JSON printed into a script ends in `.replace(/</g, '\\u003c')`.
- Tests never reach the network, production or `data/` (stubs, in-memory SQLite). The repository is public: commit messages describe behaviour, never vulnerabilities; Conventional Commits with explicit paths, each message ending with the `Co-Authored-By:` line of the executor's own attribution instructions.
- The full suite stays green after every task: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"`.

## Review Focus

1. **A poll or prediction started on Twitch's own dashboard** (or by a moderator) while the Atleta dashboard is open: the card shows it within 10 seconds, the bar shows it and the bot announces it — pinned in Task 4 (`livePolls.onEvent` with nothing set before) and Task 8 (`GET /dashboard/api/polls/live` answers it).
2. **Twitch answers slowly or not at all on Start**: the card says Twitch did not answer and the ▶ works again; a double click starts one poll — pinned in Task 3 (a request that never answers ends as `twitch_failed`), Task 8 (502 with the text; two clicks at once reach Twitch once), Task 11 (the ▶ and the panel's buttons wait for their answer) and Task 14's browser check.
3. **A streamer whose Twitch connection predates the new permissions**: every polls route answers `needs_reconnect` without calling Twitch, the card shows Reconnect, EventSub skips the seven types — pinned in Tasks 3, 5, 8 and 10.
4. **The same person shouted out twice in a minute** (a raid, then a moderator's `!so` for the raider): one line — pinned in Task 6.
5. **A title or choice with HTML, a leading `!` or an emoji**: escaped on the card and the bar, never a command in chat, an emoji counts as one character — pinned in Tasks 1, 4, 6, 9 and 10.

**Ruling recorded in Task 8:** the spec's "not an Affiliate or Partner: no actions" state gets one action, Check again, so a channel that becomes an Affiliate later is not locked out.

## Files

| File | Task | Responsibility |
|---|---|---|
| `scripts/locale-keys.js` (new) | 1 | Adds keys to the seven locale files after the `cards.*` block / sets one language's values, line by line |
| `src/services/pollRules.js` (new) | 1 | Limits, checks, the live view of a Twitch poll/prediction, the bar's choice, the bot's lines |
| `src/services/chatTemplate.js` | 1 | `{title}` may be 140 characters |
| `src/db.js` | 2 | Columns, `poll_templates`, template and settings writers |
| `src/services/twitch.js`, `src/routes/auth.js` | 3 | `hasPollsScope()`, `getChannelInfo()`; the two permissions |
| `src/services/twitchPolls.js` (new) | 3 | Helix polls/predictions with the broadcaster token; refusal codes |
| `src/services/livePolls.js` (new) | 4 | Running poll/prediction per streamer; bus; announcements |
| `src/services/eventsub.js` | 5, 6 | Seven event types → `livePolls`; the raider's login; the raid shoutout |
| `src/services/shoutouts.js` (new), `src/services/twitchChat.js` | 6 | Lookups, cooldown, `!so`, raid shoutout |
| `src/routes/dashboard.js` | 6, 8, 10 | Shoutout test route; mounting `routes/polls.js`; `gatherCards()` |
| `src/services/dashboardSettings.js` | 7 | The eleven new setting keys |
| `src/routes/polls.js` (new) | 8, 10 | Templates and Twitch actions (JSON); the status line in its answers |
| `src/routes/overlay.js`, `public/overlay/pollModel.js`, `poll.js`, `poll.css` (new) | 9 | The on-stream bar |
| `src/services/dashboardCards.js` | 10 | The two cards' states; the OBS card's bar link |
| `src/views/cards/polls.ejs`, `shoutouts.ejs` (new), `_icons.ejs`, `_style.ejs`, `overlay.ejs` | 10 | The cards' markup |
| `public/js/dashboard-cards.js`, `dashboard-cards-core.js`, `dashboard-polls.js` (new), `src/views/dashboard.ejs` | 11 | The page scripts and their texts |
| `src/locales/*.json` | 1, 6, 9–12 | Texts |
| `CLAUDE.md`, `docs/operations/deploy.md` | 13, 14 | Docs; the Team Activity Log entry at release |
| (outside the repository) | 14 | The browser check and the release, by the controller |

---

### Task 1: The rules of polls and predictions (`pollRules.js`) and the locale helper

**Files:**
- Create: `scripts/locale-keys.js`, `tests/localeKeys.test.js`
- Create: `src/services/pollRules.js`, `src/services/pollRules.test.js`
- Modify: `src/services/chatTemplate.js` (the `title` value), `src/services/chatTemplate.test.js`
- Modify: `src/locales/*.json` (the keys below)

**Interfaces:**
- Produces (`scripts/locale-keys.js`): `node scripts/locale-keys.js add <file.json>` (a JSON object `{ key: englishText }`: each key not yet present is added to all seven files, right after the last `"cards.` line), `node scripts/locale-keys.js set <lang> <file.json>` (replaces the values of existing keys in `src/locales/<lang>.json`). Both keep every other line as it is and fail when a file would stop being JSON. `LOCALES_DIR` env overrides the folder (tests).
- Produces (`pollRules.js`): `LIMITS`, `POINTS_PER_VOTE`, `TEMPLATES_MAX` (20), `DURATION_CHOICES`, `CARD_RESULT_MS` (30000), `BAR_RESULT_MS` (10000), `CHAT_TEXTS` (`[{ key, label, vars }]`, the six text columns), `ERRORS` (`code → { status, text }`), `errorParams(code, kind)`, `checkPollInput(input) → { ok: true, value: { kind, title, choices, durationSeconds, pointsPerVote } } | { ok: false, code }`, `normalizePoll(src, now)`, `normalizePrediction(src, now)` (→ a **view** or `null`), `formatClock(ms) → 'm:ss'`, `announcement(view, phase, now) → { textKey, values } | null`, `onCard(view, now) → boolean`, `pickBarView({ poll, prediction }, now) → view | null`.
- A **view**: `{ kind: 'poll'|'prediction', id, title, state: 'running'|'locked'|'ended', startedAt, endsAt, endedAt, result: 'won'|'tie'|'none'|'canceled'|null, options: [{ id, title, votes, users, points, percent, color, won }], total, users }` (times in ms since the epoch or `null`; `total` is votes for a poll, points for a prediction; `users` the predictors).

- [ ] **Step 1: The locale helper, test first**

Create `tests/localeKeys.test.js`:

```js
'use strict';

// scripts/locale-keys.js on a copy of locale files in a temp folder: adding a key puts it after the last
// "cards." line of every file and leaves every other line as it was; setting a language's values changes only those
// lines; a change that would break a file's JSON is refused. Nothing touches src/locales.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'locale-keys.js');
const LANGS = ['en', 'pt', 'es', 'fr', 'de', 'zh', 'ja'];
let dir;

const sample = (lang) => `{
  "nav.home": "Home ${lang}",

  "cards.common.add": "Add ${lang}",
  "cards.common.edit": "Edit \\u00b7 ${lang}",
  "lang.en": "English"
}
`;
const run = (...args) => execFileSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, LOCALES_DIR: dir }, encoding: 'utf8', stdio: 'pipe' });
const read = (lang) => fs.readFileSync(path.join(dir, `${lang}.json`), 'utf8');
const json = (name, value) => { const file = path.join(dir, name); fs.writeFileSync(file, JSON.stringify(value)); return file; };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-keys-'));
  for (const lang of LANGS) fs.writeFileSync(path.join(dir, `${lang}.json`), sample(lang));
});

describe('add', () => {
  test('puts each new key after the last cards. line of every file, keeps the rest byte for byte', () => {
    run('add', json('new.json', { 'cards.polls.title': 'Polls & predictions', 'cards.common.add': 'ignored: already there' }));
    for (const lang of LANGS) {
      const lines = read(lang).split('\n');
      assert.equal(lines[4], '  "cards.common.edit": "Edit \\u00b7 ' + lang + '",', 'the escape and the line before stay as they were');
      assert.equal(lines[5], '  "cards.polls.title": "Polls & predictions",');
      assert.equal(lines[6], '  "lang.en": "English"');
      assert.equal(lines[2], '', 'the blank line stays');
      assert.equal(JSON.parse(read(lang))['cards.common.add'], `Add ${lang}`, 'an existing key keeps its text');
    }
  });

  test('refuses a file without a cards. line, and leaves every file untouched', () => {
    fs.writeFileSync(path.join(dir, 'de.json'), '{\n  "nav.home": "Start"\n}\n');
    assert.throws(() => run('add', json('new.json', { 'cards.polls.title': 'x' })));
    assert.equal(read('de'), '{\n  "nav.home": "Start"\n}\n');
    assert.equal(read('en'), sample('en'), 'nothing is written when one file cannot take the keys');
  });
});

describe('set', () => {
  test('replaces the values of existing keys in one language only', () => {
    run('set', 'pt', json('pt-new.json', { 'cards.common.add': 'Adicionar "já"' }));
    assert.equal(JSON.parse(read('pt'))['cards.common.add'], 'Adicionar "já"');
    assert.equal(JSON.parse(read('es'))['cards.common.add'], 'Add es');
    assert.equal(read('pt').split('\n')[4], '  "cards.common.edit": "Edit \\u00b7 pt",');
  });

  test('refuses a key the language does not have', () => {
    assert.throws(() => run('set', 'pt', json('pt-bad.json', { 'cards.nope': 'x' })));
  });
});
```

Run: `node --test tests/localeKeys.test.js` — Expected: FAIL (the script does not exist).

- [ ] **Step 2: Write `scripts/locale-keys.js`**

```js
'use strict';

// Adds texts to the seven locale files, or sets one language's texts, line by line: the files keep their blank lines,
// their escapes and their order, so a change shows in a review as the lines it adds or changes.
//   node scripts/locale-keys.js add <file.json>         { key: englishText }: each key a file does not have yet goes
//                                                        right after its last "cards." line (all seven files)
//   node scripts/locale-keys.js set <lang> <file.json>  { key: text }: replaces those keys' texts in that language
// LOCALES_DIR overrides src/locales (the tests use a copy).

const fs = require('fs');
const path = require('path');

const DIR = process.env.LOCALES_DIR || path.join(__dirname, '..', 'src', 'locales');
const LANGS = ['en', 'pt', 'es', 'fr', 'de', 'zh', 'ja'];
const lineOf = (key, value) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`;

function readJsonArg(file) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${file}: expected { "key": "text" }`);
  for (const [key, text] of Object.entries(value)) {
    if (typeof text !== 'string' || !text.trim()) throw new Error(`${key}: the text is empty`);
  }
  return value;
}

function add(texts) {
  // Every file is changed in memory and checked first; only then are they written, so a refusal leaves all seven as
  // they were.
  const planned = LANGS.map((lang) => {
    const file = path.join(DIR, `${lang}.json`);
    const original = fs.readFileSync(file, 'utf8');
    const present = JSON.parse(original);
    const lines = original.split('\n');
    let at = -1;
    lines.forEach((line, i) => { if (line.startsWith('  "cards.')) at = i; });
    if (at < 0) throw new Error(`${lang}.json has no "cards." line to add after`);
    if (!lines[at].endsWith(',')) throw new Error(`${lang}.json: the last "cards." line must be followed by more keys`);
    const fresh = Object.entries(texts).filter(([key]) => !Object.hasOwn(present, key)).map(([key, text]) => `${lineOf(key, text)},`);
    lines.splice(at + 1, 0, ...fresh);
    const text = lines.join('\n');
    JSON.parse(text);
    return { file, text };
  });
  for (const { file, text } of planned) fs.writeFileSync(file, text);
}

function set(lang, texts) {
  if (!LANGS.includes(lang)) throw new Error(`unknown language ${lang}`);
  const file = path.join(DIR, `${lang}.json`);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (const [key, text] of Object.entries(texts)) {
    const prefix = `  ${JSON.stringify(key)}: `;
    const i = lines.findIndex((line) => line.startsWith(prefix));
    if (i < 0) throw new Error(`${lang}.json has no ${key}`);
    lines[i] = lineOf(key, text) + (lines[i].trimEnd().endsWith(',') ? ',' : '');
  }
  const out = lines.join('\n');
  JSON.parse(out);
  fs.writeFileSync(file, out);
}

const [command, a, b] = process.argv.slice(2);
if (command === 'add' && a) add(readJsonArg(a));
else if (command === 'set' && a && b) set(a, readJsonArg(b));
else {
  console.error('usage: node scripts/locale-keys.js add <file.json> | set <lang> <file.json>');
  process.exit(2);
}
```

Run: `node --test tests/localeKeys.test.js` — Expected: PASS.

- [ ] **Step 3: The texts this task names**

Write `/tmp/polls-task1-keys.json` (outside the repository) with:

```json
{
  "cards.polls.error.kind": "Choose a poll or a prediction.",
  "cards.polls.error.titleRequired": "Give it a title.",
  "cards.polls.error.titleLong": "The title can be at most {{max}} characters.",
  "cards.polls.error.choicesCount": "Give it {{min}} to {{max}} choices.",
  "cards.polls.error.choiceRequired": "Every choice needs a text.",
  "cards.polls.error.choiceLong": "A choice can be at most {{max}} characters.",
  "cards.polls.error.duration": "Pick a time from {{min}} to {{max}} seconds.",
  "cards.polls.error.points": "Extra votes cost {{min}} to {{max}} channel points.",
  "cards.polls.error.tooMany": "You have {{max}} templates. Delete one first.",
  "cards.polls.error.running": "One is already running on Twitch. End it first.",
  "cards.polls.error.notAffiliate": "Twitch allows polls and predictions for Affiliates and Partners only.",
  "cards.polls.error.reconnect": "Reconnect Twitch to use polls and predictions.",
  "cards.polls.error.twitchFailed": "Twitch did not answer. Try again in a moment.",
  "cards.polls.error.automod": "Twitch's AutoMod refused the title or a choice. Change the text and try again.",
  "cards.polls.error.changed": "That already changed on Twitch. The card now shows where it stands.",
  "cards.polls.texts.pollStart": "Poll started",
  "cards.polls.texts.pollEnd": "Poll result",
  "cards.polls.texts.predictionStart": "Prediction started",
  "cards.polls.texts.predictionLock": "Prediction locked",
  "cards.polls.texts.predictionEnd": "Prediction result",
  "cards.polls.texts.predictionCancel": "Prediction cancelled"
}
```

Run: `node scripts/locale-keys.js add /tmp/polls-task1-keys.json && git diff --stat src/locales && node --test tests/i18n.test.js` — Expected: 21 lines added per file, nothing else changed; PASS.

- [ ] **Step 4: Write the failing tests of the rules**

Create `src/services/pollRules.test.js`:

```js
'use strict';

// The Polls & predictions rules (services/pollRules.js) from synthetic Twitch answers: Helix's shapes (GET/POST/PATCH
// /polls, /predictions) and EventSub's (channel.poll.*, channel.prediction.*). No database, no Twitch.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const rules = require('./pollRules');
const en = require('../locales/en.json');

const NOW = Date.parse('2026-10-15T20:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

describe('checkPollInput', () => {
  const poll = (over = {}) => ({ kind: 'poll', title: 'Top 5 finish?', choices: ['Yes', 'No'], durationSeconds: 120, pointsPerVote: null, ...over });
  const code = (input) => rules.checkPollInput(input).code;

  test('a poll and a prediction within the limits pass, cleaned', () => {
    assert.deepEqual(rules.checkPollInput(poll({ title: '  Top 5\nfinish?  ', choices: [' Yes ', 'No'] })),
      { ok: true, value: { kind: 'poll', title: 'Top 5 finish?', choices: ['Yes', 'No'], durationSeconds: 120, pointsPerVote: null } });
    assert.deepEqual(rules.checkPollInput({ kind: 'prediction', title: 'Clean first lap?', choices: ['Clean', 'Chaos'], durationSeconds: '60', pointsPerVote: 5 }),
      { ok: true, value: { kind: 'prediction', title: 'Clean first lap?', choices: ['Clean', 'Chaos'], durationSeconds: 60, pointsPerVote: null } }, 'a prediction has no points per vote');
    assert.equal(rules.checkPollInput(poll({ pointsPerVote: 250 })).value.pointsPerVote, 250);
  });

  test('every limit has its own code', () => {
    assert.equal(code(null), 'kind');
    assert.equal(code(poll({ kind: 'quiz' })), 'kind');
    assert.equal(code(poll({ title: '   ' })), 'title_required');
    assert.equal(code(poll({ title: 42 })), 'title_required');
    assert.equal(code(poll({ title: 'x'.repeat(61) })), 'title_long');
    assert.equal(rules.checkPollInput(poll({ title: 'x'.repeat(60) })).ok, true);
    assert.equal(code({ kind: 'prediction', title: 'x'.repeat(46), choices: ['a', 'b'], durationSeconds: 60 }), 'title_long');
    assert.equal(code(poll({ choices: ['only'] })), 'choices_count');
    assert.equal(code(poll({ choices: 'Yes,No' })), 'choices_count');
    assert.equal(code(poll({ choices: ['a', 'b', 'c', 'd', 'e', 'f'] })), 'choices_count');
    assert.equal(rules.checkPollInput({ kind: 'prediction', title: 'p', choices: Array.from({ length: 10 }, (_, i) => `o${i}`), durationSeconds: 60 }).ok, true);
    assert.equal(code({ kind: 'prediction', title: 'p', choices: Array.from({ length: 11 }, (_, i) => `o${i}`), durationSeconds: 60 }), 'choices_count');
    assert.equal(code(poll({ choices: ['Yes', ' '] })), 'choice_required');
    assert.equal(code(poll({ choices: ['Yes', 7] })), 'choice_required');
    assert.equal(code(poll({ choices: ['Yes', 'n'.repeat(26)] })), 'choice_long');
    assert.equal(code(poll({ durationSeconds: 14 })), 'duration');
    assert.equal(code(poll({ durationSeconds: 1801 })), 'duration');
    assert.equal(code(poll({ durationSeconds: 90.5 })), 'duration');
    assert.equal(code(poll({ durationSeconds: [120] })), 'duration');
    assert.equal(code({ kind: 'prediction', title: 'p', choices: ['a', 'b'], durationSeconds: 29 }), 'duration');
    assert.equal(code(poll({ pointsPerVote: 0 })), 'points');
    assert.equal(code(poll({ pointsPerVote: 1000001 })), 'points');
    assert.equal(code(poll({ pointsPerVote: 'many' })), 'points');
  });

  test('an emoji counts as one character, as Twitch counts it', () => {
    assert.equal(rules.checkPollInput(poll({ choices: ['🏁'.repeat(25), 'No'] })).ok, true);
    assert.equal(code(poll({ choices: ['🏁'.repeat(26), 'No'] })), 'choice_long');
    assert.equal(rules.checkPollInput(poll({ title: '🏁'.repeat(60) })).ok, true);
    assert.equal(code(poll({ title: '🏁'.repeat(61) })), 'title_long');
  });

  test('every code has a status and a text en.json has; the params name the limits', () => {
    for (const [code, error] of Object.entries(rules.ERRORS)) {
      assert.ok(Number.isInteger(error.status), code);
      assert.ok(Object.hasOwn(en, error.text), `${code}: ${error.text}`);
    }
    assert.deepEqual(rules.errorParams('title_long', 'prediction'), { max: 45 });
    assert.deepEqual(rules.errorParams('choices_count', 'poll'), { min: 2, max: 5 });
    assert.deepEqual(rules.errorParams('duration', 'prediction'), { min: 30, max: 1800 });
    assert.deepEqual(rules.errorParams('too_many'), { max: 20 });
    assert.deepEqual(rules.errorParams('running'), {});
  });
});

describe('normalizePoll', () => {
  test('a running Helix poll: the time it ends, votes and percentages', () => {
    const view = rules.normalizePoll({
      id: 'p1', title: 'Top 5?', status: 'ACTIVE', duration: 120, started_at: iso(NOW - 30000),
      choices: [{ id: 'c1', title: 'Yes', votes: 48 }, { id: 'c2', title: 'No', votes: 27 }],
    }, NOW);
    assert.equal(view.kind, 'poll');
    assert.equal(view.state, 'running');
    assert.equal(view.startedAt, NOW - 30000);
    assert.equal(view.endsAt, NOW + 90000);
    assert.equal(view.endedAt, null);
    assert.equal(view.result, null);
    assert.equal(view.total, 75);
    assert.deepEqual(view.options.map((o) => [o.title, o.votes, o.percent, o.won]), [['Yes', 48, 64, false], ['No', 27, 36, false]]);
  });

  test('EventSub begin (no votes yet, ends_at) and end (terminated, a tie)', () => {
    const begin = rules.normalizePoll({ id: 'p2', title: 'Car?', started_at: iso(NOW), ends_at: iso(NOW + 60000), choices: [{ id: 'a', title: 'GT3' }, { id: 'b', title: 'LMP2' }] }, NOW);
    assert.equal(begin.state, 'running');
    assert.equal(begin.endsAt, NOW + 60000);
    assert.deepEqual(begin.options.map((o) => o.votes), [0, 0]);
    const end = rules.normalizePoll({ id: 'p2', title: 'Car?', status: 'terminated', ended_at: iso(NOW + 5000), choices: [{ id: 'a', title: 'GT3', votes: 3 }, { id: 'b', title: 'LMP2', votes: 3 }] }, NOW);
    assert.equal(end.state, 'ended');
    assert.equal(end.endedAt, NOW + 5000);
    assert.equal(end.result, 'tie');
    assert.deepEqual(end.options.map((o) => o.won), [true, true]);
  });

  test('a poll nobody voted in, or one Twitch moderated, has no winner', () => {
    const none = rules.normalizePoll({ id: 'p3', title: 't', status: 'COMPLETED', ended_at: iso(NOW), choices: [{ id: 'a', title: 'A', votes: 0 }, { id: 'b', title: 'B', votes: 0 }] }, NOW);
    assert.equal(none.result, 'none');
    assert.deepEqual(none.options.map((o) => o.percent), [0, 0]);
    const moderated = rules.normalizePoll({ id: 'p4', title: 't', status: 'MODERATED', ended_at: iso(NOW), choices: [{ id: 'a', title: 'A', votes: 5 }, { id: 'b', title: 'B', votes: 1 }] }, NOW);
    assert.equal(moderated.result, 'none');
  });

  test('not a poll: null', () => {
    assert.equal(rules.normalizePoll(null, NOW), null);
    assert.equal(rules.normalizePoll({ id: 'x' }, NOW), null);
    assert.equal(rules.normalizePoll({ choices: [] }, NOW), null);
  });
});

describe('normalizePrediction', () => {
  const outcomes = [{ id: 'o1', title: 'Clean', color: 'BLUE', users: 18, channel_points: 12400 }, { id: 'o2', title: 'Chaos', color: 'PINK', users: 9, channel_points: 5100 }];

  test('EventSub begin, progress, lock and end (resolved and cancelled)', () => {
    const begin = rules.normalizePrediction({ id: 'r1', title: 'Clean first lap?', started_at: iso(NOW), locks_at: iso(NOW + 60000), outcomes: [{ id: 'o1', title: 'Clean', color: 'blue' }, { id: 'o2', title: 'Chaos', color: 'pink' }] }, NOW);
    assert.equal(begin.state, 'running');
    assert.equal(begin.endsAt, NOW + 60000);
    assert.deepEqual(begin.options.map((o) => [o.color, o.points, o.users]), [['blue', 0, 0], ['pink', 0, 0]]);
    const progress = rules.normalizePrediction({ id: 'r1', title: 'Clean first lap?', locks_at: iso(NOW + 60000), outcomes }, NOW);
    assert.equal(progress.total, 17500);
    assert.equal(progress.users, 27);
    assert.deepEqual(progress.options.map((o) => o.percent), [71, 29]);
    const locked = rules.normalizePrediction({ id: 'r1', title: 'Clean first lap?', locked_at: iso(NOW + 60000), outcomes }, NOW);
    assert.equal(locked.state, 'locked');
    const won = rules.normalizePrediction({ id: 'r1', title: 'Clean first lap?', status: 'resolved', winning_outcome_id: 'o1', ended_at: iso(NOW + 90000), outcomes }, NOW);
    assert.equal(won.state, 'ended');
    assert.equal(won.result, 'won');
    assert.deepEqual(won.options.map((o) => o.won), [true, false]);
    const canceled = rules.normalizePrediction({ id: 'r1', title: 'Clean first lap?', status: 'canceled', ended_at: iso(NOW + 90000), outcomes }, NOW);
    assert.equal(canceled.result, 'canceled');
  });

  test('a Helix prediction: the window from its creation; LOCKED is locked; an unknown status is not one', () => {
    const active = rules.normalizePrediction({ id: 'r2', title: 't', status: 'ACTIVE', created_at: iso(NOW - 10000), prediction_window: 60, outcomes }, NOW);
    assert.equal(active.state, 'running');
    assert.equal(active.startedAt, NOW - 10000);
    assert.equal(active.endsAt, NOW + 50000);
    assert.equal(rules.normalizePrediction({ id: 'r2', title: 't', status: 'LOCKED', outcomes }, NOW).state, 'locked');
    assert.equal(rules.normalizePrediction({ id: 'r2', title: 't', status: 'WEIRD', outcomes }, NOW), null);
  });
});

describe('formatClock', () => {
  test('m:ss, rounded up, never below zero', () => {
    assert.equal(rules.formatClock(90000), '1:30');
    assert.equal(rules.formatClock(59001), '1:00');
    assert.equal(rules.formatClock(1), '0:01');
    assert.equal(rules.formatClock(-5000), '0:00');
    assert.equal(rules.formatClock(1800000), '30:00');
  });
});

describe('announcement', () => {
  const poll = (over) => rules.normalizePoll({ id: 'p', title: 'Top 5?', started_at: iso(NOW), ends_at: iso(NOW + 120000), choices: [{ id: 'a', title: 'Yes', votes: 48 }, { id: 'b', title: 'No', votes: 27 }], ...over }, NOW);
  const prediction = (over) => rules.normalizePrediction({ id: 'r', title: 'Clean lap?', locks_at: iso(NOW + 60000), outcomes: [{ id: 'o1', title: 'Clean', users: 18, channel_points: 12400 }, { id: 'o2', title: 'Chaos', users: 9, channel_points: 5100 }], ...over }, NOW);

  test('a poll: the start with its time, the result with the winner', () => {
    assert.deepEqual(rules.announcement(poll(), 'start', NOW), { textKey: 'poll_start_template', values: { title: 'Top 5?', time: '2:00' } });
    assert.deepEqual(rules.announcement(poll({ status: 'completed', ended_at: iso(NOW) }), 'end', NOW),
      { textKey: 'poll_end_template', values: { title: 'Top 5?', winner: 'Yes', percent: 64, votes: 48 } });
    assert.equal(rules.announcement(poll(), 'lock', NOW), null, 'a poll has no lock');
  });

  test('a tie names every tied choice; no votes, no result line', () => {
    const tie = poll({ status: 'completed', ended_at: iso(NOW), choices: [{ id: 'a', title: 'A', votes: 2 }, { id: 'b', title: 'B', votes: 2 }] });
    assert.equal(rules.announcement(tie, 'end', NOW).values.winner, 'A / B');
    const none = poll({ status: 'completed', ended_at: iso(NOW), choices: [{ id: 'a', title: 'A', votes: 0 }, { id: 'b', title: 'B', votes: 0 }] });
    assert.equal(rules.announcement(none, 'end', NOW), null);
  });

  test('a prediction: start, lock, result and cancel', () => {
    assert.deepEqual(rules.announcement(prediction(), 'start', NOW), { textKey: 'prediction_start_template', values: { title: 'Clean lap?', time: '1:00' } });
    assert.deepEqual(rules.announcement(prediction({ locked_at: iso(NOW) }), 'lock', NOW), { textKey: 'prediction_lock_template', values: { title: 'Clean lap?' } });
    assert.deepEqual(rules.announcement(prediction({ status: 'resolved', winning_outcome_id: 'o1', ended_at: iso(NOW) }), 'end', NOW),
      { textKey: 'prediction_end_template', values: { title: 'Clean lap?', outcome: 'Clean', winners: 18, points: 17500 } });
    assert.deepEqual(rules.announcement(prediction({ status: 'canceled', ended_at: iso(NOW) }), 'end', NOW),
      { textKey: 'prediction_cancel_template', values: { title: 'Clean lap?' } });
  });

  test('the six texts are the six columns, each with its label and variables', () => {
    assert.deepEqual(rules.CHAT_TEXTS.map((c) => c.key), ['poll_start_template', 'poll_end_template', 'prediction_start_template', 'prediction_lock_template', 'prediction_end_template', 'prediction_cancel_template']);
    for (const c of rules.CHAT_TEXTS) assert.ok(Object.hasOwn(en, c.label), c.label);
  });
});

describe('what the card and the bar show', () => {
  const ended = (kind, at) => ({ kind, id: kind, title: kind, state: 'ended', startedAt: null, endsAt: null, endedAt: at, result: 'won', options: [], total: 0, users: 0 });
  const running = (kind) => ({ ...ended(kind, null), state: 'running', endedAt: null, result: null });

  test('the card shows a result for 30 seconds, the bar for 10', () => {
    assert.equal(rules.onCard(ended('poll', NOW - 29000), NOW), true);
    assert.equal(rules.onCard(ended('poll', NOW - 30000), NOW), false);
    assert.equal(rules.onCard(running('poll'), NOW), true);
    assert.equal(rules.onCard(null, NOW), false);
    assert.equal(rules.pickBarView({ poll: ended('poll', NOW - 9000), prediction: null }, NOW).kind, 'poll');
    assert.equal(rules.pickBarView({ poll: ended('poll', NOW - 10000), prediction: null }, NOW), null);
  });

  test('with both on the bar, the prediction is shown', () => {
    assert.equal(rules.pickBarView({ poll: running('poll'), prediction: running('prediction') }, NOW).kind, 'prediction');
    assert.equal(rules.pickBarView({ poll: running('poll'), prediction: ended('prediction', NOW - 20000) }, NOW).kind, 'poll');
    assert.equal(rules.pickBarView({ poll: null, prediction: null }, NOW), null);
  });
});
```

Add to `src/services/chatTemplate.test.js`, as a new block at the end of the file:

```js
describe('fillChatTemplate: a title', () => {
  test('{title} keeps up to 140 characters (a poll or stream title); other values 50', () => {
    const { fillChatTemplate } = require('./chatTemplate');
    assert.equal(fillChatTemplate('{title}', { title: 't'.repeat(200) }), 't'.repeat(140));
    assert.equal(fillChatTemplate('{game}', { game: 'g'.repeat(200) }), 'g'.repeat(50));
  });
});
```

(If `chatTemplate.test.js` does not already import `describe`, `test` and `assert` at its top, add them to its existing `require('node:test')` / `require('node:assert/strict')` lines.)

Run: `node --test src/services/pollRules.test.js src/services/chatTemplate.test.js` — Expected: FAIL (`Cannot find module './pollRules'`; the title is cut at 50).

- [ ] **Step 5: Write `src/services/pollRules.js` and let `{title}` be 140 characters**

```js
'use strict';

// The rules of the Polls & predictions card: Twitch's limits, the check of a template or a one-off, what a Twitch poll
// or prediction looks like on the card, on the on-stream bar and in the bot's lines. Pure: nothing here reads the
// database or asks Twitch (pollRules.test.js tests every rule on its own). A **view** is one poll or prediction as the
// card, the bar and the bot read it:
//   { kind: 'poll'|'prediction', id, title, state: 'running'|'locked'|'ended', startedAt, endsAt, endedAt (ms or null),
//     result: 'won'|'tie'|'none'|'canceled'|null, options: [{ id, title, votes, users, points, percent, color, won }],
//     total (votes, or points for a prediction), users (a prediction's predictors) }

const { singleLine } = require('./chatCommands');

// Twitch's limits (Helix Create Poll and Create Prediction).
const LIMITS = Object.freeze({
  poll: Object.freeze({ titleMax: 60, choiceMax: 25, minChoices: 2, maxChoices: 5, minSeconds: 15, maxSeconds: 1800 }),
  prediction: Object.freeze({ titleMax: 45, choiceMax: 25, minChoices: 2, maxChoices: 10, minSeconds: 30, maxSeconds: 1800 }),
});
const POINTS_PER_VOTE = Object.freeze({ min: 1, max: 1000000 });
const TEMPLATES_MAX = 20;
// The times the template pop-up offers (a value saved earlier outside the list stays selectable).
const DURATION_CHOICES = Object.freeze({
  poll: Object.freeze([30, 60, 120, 180, 300, 600]),
  prediction: Object.freeze([60, 120, 300, 600, 1800]),
});
const CARD_RESULT_MS = 30000; // the card shows a result this long
const BAR_RESULT_MS = 10000; // the on-stream bar shows a result this long

// The bot's six lines: their streamers column, their label in the chat messages pop-up and their variables.
const CHAT_TEXTS = Object.freeze([
  Object.freeze({ key: 'poll_start_template', label: 'cards.polls.texts.pollStart', vars: Object.freeze(['{title}', '{time}']) }),
  Object.freeze({ key: 'poll_end_template', label: 'cards.polls.texts.pollEnd', vars: Object.freeze(['{title}', '{winner}', '{percent}', '{votes}']) }),
  Object.freeze({ key: 'prediction_start_template', label: 'cards.polls.texts.predictionStart', vars: Object.freeze(['{title}', '{time}']) }),
  Object.freeze({ key: 'prediction_lock_template', label: 'cards.polls.texts.predictionLock', vars: Object.freeze(['{title}']) }),
  Object.freeze({ key: 'prediction_end_template', label: 'cards.polls.texts.predictionEnd', vars: Object.freeze(['{title}', '{outcome}', '{winners}', '{points}']) }),
  Object.freeze({ key: 'prediction_cancel_template', label: 'cards.polls.texts.predictionCancel', vars: Object.freeze(['{title}']) }),
]);

// A refusal's HTTP status and text (routes/polls.js answers it translated, with errorParams()).
const ERRORS = Object.freeze({
  kind: Object.freeze({ status: 400, text: 'cards.polls.error.kind' }),
  title_required: Object.freeze({ status: 400, text: 'cards.polls.error.titleRequired' }),
  title_long: Object.freeze({ status: 400, text: 'cards.polls.error.titleLong' }),
  choices_count: Object.freeze({ status: 400, text: 'cards.polls.error.choicesCount' }),
  choice_required: Object.freeze({ status: 400, text: 'cards.polls.error.choiceRequired' }),
  choice_long: Object.freeze({ status: 400, text: 'cards.polls.error.choiceLong' }),
  duration: Object.freeze({ status: 400, text: 'cards.polls.error.duration' }),
  points: Object.freeze({ status: 400, text: 'cards.polls.error.points' }),
  invalid: Object.freeze({ status: 400, text: 'dashboard.settings.error.invalid' }),
  not_found: Object.freeze({ status: 404, text: 'dashboard.settings.error.notFound' }),
  too_many: Object.freeze({ status: 409, text: 'cards.polls.error.tooMany' }),
  running: Object.freeze({ status: 409, text: 'cards.polls.error.running' }),
  changed: Object.freeze({ status: 409, text: 'cards.polls.error.changed' }),
  automod: Object.freeze({ status: 400, text: 'cards.polls.error.automod' }),
  not_affiliate: Object.freeze({ status: 409, text: 'cards.polls.error.notAffiliate' }),
  needs_reconnect: Object.freeze({ status: 409, text: 'cards.polls.error.reconnect' }),
  twitch_failed: Object.freeze({ status: 502, text: 'cards.polls.error.twitchFailed' }),
});

// The numbers a refusal's text names.
function errorParams(code, kind) {
  const limits = LIMITS[kind] || LIMITS.poll;
  switch (code) {
    case 'title_long': return { max: limits.titleMax };
    case 'choices_count': return { min: limits.minChoices, max: limits.maxChoices };
    case 'choice_long': return { max: limits.choiceMax };
    case 'duration': return { min: limits.minSeconds, max: limits.maxSeconds };
    case 'points': return { min: POINTS_PER_VOTE.min, max: POINTS_PER_VOTE.max };
    case 'too_many': return { max: TEMPLATES_MAX };
    default: return {};
  }
}

const characters = (text) => Array.from(text).length; // an emoji counts once, as Twitch counts it
const cleanText = (value) => (typeof value === 'string' ? singleLine(value).trim() : null);
const isNumberLike = (value) => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');

// A template or a one-off from a request body ({ kind, title, choices, durationSeconds, pointsPerVote }), checked
// against Twitch's limits: { ok: true, value } with the texts cleaned, or { ok: false, code }.
function checkPollInput(input) {
  const body = input && typeof input === 'object' ? input : {};
  const kind = body.kind;
  if (kind !== 'poll' && kind !== 'prediction') return { ok: false, code: 'kind' };
  const limits = LIMITS[kind];
  const title = cleanText(body.title);
  if (!title) return { ok: false, code: 'title_required' };
  if (characters(title) > limits.titleMax) return { ok: false, code: 'title_long' };
  if (!Array.isArray(body.choices) || body.choices.length < limits.minChoices || body.choices.length > limits.maxChoices) {
    return { ok: false, code: 'choices_count' };
  }
  const choices = body.choices.map(cleanText);
  if (choices.some((choice) => !choice)) return { ok: false, code: 'choice_required' };
  if (choices.some((choice) => characters(choice) > limits.choiceMax)) return { ok: false, code: 'choice_long' };
  const seconds = isNumberLike(body.durationSeconds) ? Number(body.durationSeconds) : NaN;
  if (!Number.isInteger(seconds) || seconds < limits.minSeconds || seconds > limits.maxSeconds) return { ok: false, code: 'duration' };
  let pointsPerVote = null;
  if (kind === 'poll' && body.pointsPerVote !== null && body.pointsPerVote !== undefined && body.pointsPerVote !== '') {
    const points = isNumberLike(body.pointsPerVote) ? Number(body.pointsPerVote) : NaN;
    if (!Number.isInteger(points) || points < POINTS_PER_VOTE.min || points > POINTS_PER_VOTE.max) return { ok: false, code: 'points' };
    pointsPerVote = points;
  }
  return { ok: true, value: { kind, title, choices, durationSeconds: seconds, pointsPerVote } };
}

const toMs = (value) => {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : null;
};
const amount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const percentages = (amounts) => {
  const total = amounts.reduce((sum, n) => sum + n, 0);
  return amounts.map((n) => (total > 0 ? Math.round((n / total) * 100) : 0));
};

// A Twitch poll — Helix's (status ACTIVE, COMPLETED, TERMINATED, ARCHIVED, MODERATED, INVALID; started_at and duration)
// or an EventSub event's (begin and progress: ends_at, no status; end: status completed, terminated or archived) — as
// a view; null when it is not one.
function normalizePoll(src, now) {
  if (!src || typeof src !== 'object' || !src.id || !Array.isArray(src.choices)) return null;
  const status = String(src.status || '').toLowerCase();
  const running = status ? status === 'active' : !src.ended_at;
  const options = src.choices.map((c) => ({ id: String((c && c.id) || ''), title: String((c && c.title) || ''), votes: amount(c && c.votes), users: 0, points: 0, color: null, percent: 0, won: false }));
  percentages(options.map((o) => o.votes)).forEach((p, i) => { options[i].percent = p; });
  const total = options.reduce((sum, o) => sum + o.votes, 0);
  let endsAt = toMs(src.ends_at);
  const startedAt = toMs(src.started_at);
  if (endsAt === null && startedAt !== null && Number.isFinite(Number(src.duration))) endsAt = startedAt + Number(src.duration) * 1000;
  let result = null;
  if (!running) {
    const most = Math.max(0, ...options.map((o) => o.votes));
    const winners = total > 0 && !['moderated', 'invalid'].includes(status) ? options.filter((o) => o.votes === most) : [];
    for (const o of winners) o.won = true;
    result = winners.length === 0 ? 'none' : winners.length > 1 ? 'tie' : 'won';
  }
  return {
    kind: 'poll', id: String(src.id), title: String(src.title || ''), state: running ? 'running' : 'ended', startedAt,
    endsAt: running ? endsAt : null, endedAt: running ? null : (toMs(src.ended_at) ?? now), result, options, total, users: 0,
  };
}

// A Twitch prediction — Helix's (status ACTIVE, LOCKED, RESOLVED, CANCELED; created_at and prediction_window) or an
// EventSub event's (begin and progress: locks_at; lock: locked_at; end: status resolved or canceled) — as a view; null
// when it is not one.
function normalizePrediction(src, now) {
  if (!src || typeof src !== 'object' || !src.id || !Array.isArray(src.outcomes)) return null;
  const status = String(src.status || '').toLowerCase();
  let state;
  if (status === 'active') state = 'running';
  else if (status === 'locked') state = 'locked';
  else if (status === 'resolved' || status === 'canceled') state = 'ended';
  else if (!status) state = src.locked_at ? 'locked' : 'running';
  else return null;
  const winningId = src.winning_outcome_id ? String(src.winning_outcome_id) : null;
  const options = src.outcomes.map((o) => ({
    id: String((o && o.id) || ''), title: String((o && o.title) || ''), votes: 0,
    users: amount(o && o.users), points: amount(o && o.channel_points),
    color: String((o && o.color) || '').toLowerCase() === 'pink' ? 'pink' : 'blue', percent: 0,
    won: state === 'ended' && status === 'resolved' && !!winningId && String((o && o.id) || '') === winningId,
  }));
  percentages(options.map((o) => o.points)).forEach((p, i) => { options[i].percent = p; });
  let endsAt = toMs(src.locks_at);
  const createdAt = toMs(src.created_at) ?? toMs(src.started_at);
  if (endsAt === null && createdAt !== null && Number.isFinite(Number(src.prediction_window))) endsAt = createdAt + Number(src.prediction_window) * 1000;
  let result = null;
  if (state === 'ended') result = status === 'canceled' ? 'canceled' : options.some((o) => o.won) ? 'won' : 'none';
  return {
    kind: 'prediction', id: String(src.id), title: String(src.title || ''), state, startedAt: createdAt,
    endsAt: state === 'running' ? endsAt : null, endedAt: state === 'ended' ? (toMs(src.ended_at) ?? now) : null,
    result, options, total: options.reduce((sum, o) => sum + o.points, 0), users: options.reduce((sum, o) => sum + o.users, 0),
  };
}

// 90000 → '1:30': whole seconds rounded up, never below zero.
function formatClock(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// The bot's line for a moment of a poll or prediction ('start', 'lock', 'end'): the column of the streamer's text and
// the values it is filled with, or null when nothing is said (a poll's lock; a result without votes or winner).
function announcement(view, phase, now) {
  if (!view) return null;
  const time = view.endsAt === null ? '' : formatClock(view.endsAt - now);
  if (view.kind === 'poll') {
    if (phase === 'start') return { textKey: 'poll_start_template', values: { title: view.title, time } };
    if (phase !== 'end' || (view.result !== 'won' && view.result !== 'tie')) return null;
    const winners = view.options.filter((o) => o.won);
    return { textKey: 'poll_end_template', values: { title: view.title, winner: winners.map((o) => o.title).join(' / '), percent: winners[0].percent, votes: winners[0].votes } };
  }
  if (phase === 'start') return { textKey: 'prediction_start_template', values: { title: view.title, time } };
  if (phase === 'lock') return { textKey: 'prediction_lock_template', values: { title: view.title } };
  if (phase !== 'end') return null;
  if (view.result === 'canceled') return { textKey: 'prediction_cancel_template', values: { title: view.title } };
  const winner = view.options.find((o) => o.won);
  if (!winner) return null;
  return { textKey: 'prediction_end_template', values: { title: view.title, outcome: winner.title, winners: winner.users, points: view.total } };
}

const recent = (view, now, ms) => !!view && (view.state !== 'ended' || (view.endedAt !== null && now - view.endedAt < ms));

// Whether the card still shows a view: running, locked, or ended less than 30 seconds ago.
const onCard = (view, now) => recent(view, now, CARD_RESULT_MS);

// What the on-stream bar shows: the prediction (points at stake), else the poll; a result for 10 seconds; or nothing.
function pickBarView({ poll, prediction } = {}, now) {
  if (recent(prediction, now, BAR_RESULT_MS)) return prediction;
  if (recent(poll, now, BAR_RESULT_MS)) return poll;
  return null;
}

module.exports = {
  LIMITS, POINTS_PER_VOTE, TEMPLATES_MAX, DURATION_CHOICES, CARD_RESULT_MS, BAR_RESULT_MS, CHAT_TEXTS, ERRORS,
  errorParams, checkPollInput, normalizePoll, normalizePrediction, formatClock, announcement, onCard, pickBarView,
};
```

In `src/services/chatTemplate.js`:
- in the header comment, `//  - names are cut to 50 characters, messages to 300, any other value to 50,` becomes `//  - names are cut to 50 characters, messages to 300, titles to 140, any other value to 50,`;
- after `const MESSAGE_MAX = 300;` add `const TITLE_MAX = 140; // a poll's title (60 at most) or a stream's (140)`;
- `const VALUE_MAX = Object.freeze({ username: NAME_MAX, message: MESSAGE_MAX });` becomes `const VALUE_MAX = Object.freeze({ username: NAME_MAX, message: MESSAGE_MAX, title: TITLE_MAX });`.

Run: `node --test src/services/pollRules.test.js src/services/chatTemplate.test.js tests/localeKeys.test.js tests/i18n.test.js` — Expected: PASS.

- [ ] **Step 6: The full suite, then commit**

Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` — Expected: PASS.

```bash
git add scripts/locale-keys.js tests/localeKeys.test.js src/services/pollRules.js src/services/pollRules.test.js src/services/chatTemplate.js src/services/chatTemplate.test.js src/locales/en.json src/locales/pt.json src/locales/es.json src/locales/fr.json src/locales/de.json src/locales/zh.json src/locales/ja.json
git commit -m "feat(polls): the rules of polls and predictions, and a line-by-line locale helper"
```

---

### Task 2: The data — the streamers columns, the poll templates and their writers

**Files:**
- Modify: `src/db.js` (a migration block, the `poll_templates` table, the template functions, two settings writers, `STREAMER_OWNED_ROWS`, `module.exports`)
- Create: `src/db.polls.test.js`

**Interfaces:**
- Produces (columns on `streamers`): `polls_chat_enabled`, `poll_start_template`, `poll_end_template`, `prediction_start_template`, `prediction_lock_template`, `prediction_end_template`, `prediction_cancel_template`, `shoutout_command_enabled`, `shoutout_raid_enabled`, `shoutout_raid_min_viewers`, `shoutout_template` (the defaults in Step 2).
- Produces (functions): `getPollTemplates(streamerId) → [template]` (by `sort_order`, then id), `getPollTemplate(id, streamerId) → template | null`, `countPollTemplates(streamerId) → number`, `addPollTemplate(streamerId, value) → template` (`value` is `pollRules.checkPollInput()`'s), `updatePollTemplate(id, streamerId, value) → boolean`, `deletePollTemplate(id, streamerId) → boolean`, `updatePollSettings(streamerId, fields)`, `updateShoutoutSettings(streamerId, fields)` (each writes only its own columns, see Step 3).
- A **template**: `{ id, kind, title, choices: [text], durationSeconds, pointsPerVote (null when off), sortOrder }`.

- [ ] **Step 1: Write the failing test**

Create `src/db.polls.test.js`:

```js
'use strict';

// The Polls & predictions and Shoutouts data in src/db.js, against the real file on an in-memory SQLite database
// (nothing touches data/bot.db): the new streamers columns and their defaults, the poll templates (a streamer's own
// only), and the two settings writers. All ids are synthetic.

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
  return Number(db.db.prepare('INSERT INTO streamers (discord_user_id, discord_username) VALUES (?, ?)')
    .run(`71000000000000${String(n).padStart(4, '0')}`, `polls${n}`).lastInsertRowid);
}
const value = (over = {}) => ({ kind: 'poll', title: 'Top 5?', choices: ['Yes', 'No'], durationSeconds: 120, pointsPerVote: null, ...over });

describe('the new streamers columns', () => {
  test('a new streamer starts with the announcements on, the shoutouts off and the default texts', () => {
    const s = db.getStreamerById(addStreamer());
    assert.equal(s.polls_chat_enabled, 1);
    assert.equal(s.shoutout_command_enabled, 0);
    assert.equal(s.shoutout_raid_enabled, 0);
    assert.equal(s.shoutout_raid_min_viewers, 1);
    assert.equal(s.poll_start_template, 'Poll: {title} — vote now! ({time} to vote)');
    assert.equal(s.poll_end_template, 'Poll closed: {winner} won with {percent}% of the votes.');
    assert.equal(s.prediction_start_template, 'Prediction: {title} — place your channel points! ({time} to predict)');
    assert.equal(s.prediction_lock_template, 'Predictions are locked for "{title}". Good luck!');
    assert.equal(s.prediction_end_template, '{outcome} wins! {winners} viewers share {points} channel points.');
    assert.equal(s.prediction_cancel_template, 'Prediction cancelled: "{title}". Everyone gets their channel points back.');
    assert.equal(s.shoutout_template, 'Go check out {name}! They were last streaming {game}: {link}');
  });
});

describe('poll templates', () => {
  test('added, read back in order, changed and deleted — a streamer\'s own only', () => {
    const a = addStreamer();
    const b = addStreamer();
    const first = db.addPollTemplate(a, value());
    const second = db.addPollTemplate(a, value({ kind: 'prediction', title: 'Clean lap?', choices: ['Clean', 'Chaos'], durationSeconds: 60 }));
    assert.deepEqual(first, { id: first.id, kind: 'poll', title: 'Top 5?', choices: ['Yes', 'No'], durationSeconds: 120, pointsPerVote: null, sortOrder: 1 });
    assert.equal(second.sortOrder, 2);
    assert.deepEqual(db.getPollTemplates(a).map((t) => t.title), ['Top 5?', 'Clean lap?']);
    assert.equal(db.countPollTemplates(a), 2);
    assert.deepEqual(db.getPollTemplates(b), []);
    assert.equal(db.getPollTemplate(first.id, b), null, 'another streamer\'s template is not found');
    assert.equal(db.getPollTemplate(null, a), null);

    assert.equal(db.updatePollTemplate(first.id, b, value({ title: 'Hijack' })), false);
    assert.equal(db.getPollTemplate(first.id, a).title, 'Top 5?');
    assert.equal(db.updatePollTemplate(first.id, a, value({ title: 'Podium?', pointsPerVote: 50 })), true);
    assert.deepEqual(db.getPollTemplate(first.id, a), { ...first, title: 'Podium?', pointsPerVote: 50 });

    assert.equal(db.deletePollTemplate(first.id, b), false);
    assert.equal(db.deletePollTemplate(first.id, a), true);
    assert.equal(db.deletePollTemplate(first.id, a), false, 'already gone');
    assert.equal(db.countPollTemplates(a), 1);
  });

  test('choices keep their order and characters; a row whose choices cannot be read has none', () => {
    const a = addStreamer();
    const t = db.addPollTemplate(a, value({ choices: ['🏁 Yes "really"', 'No, <b>never</b>', 'Maybe'] }));
    assert.deepEqual(db.getPollTemplate(t.id, a).choices, ['🏁 Yes "really"', 'No, <b>never</b>', 'Maybe']);
    db.db.prepare('UPDATE poll_templates SET choices = ? WHERE id = ?').run('not json', t.id);
    assert.deepEqual(db.getPollTemplate(t.id, a).choices, []);
  });

  test('removing an account removes its templates', () => {
    const a = addStreamer();
    db.addPollTemplate(a, value());
    db.deleteStreamer(a);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM poll_templates WHERE streamer_id = ?').get(a).n, 0);
  });
});

describe('the settings writers', () => {
  test('each writes only its own columns', () => {
    const a = addStreamer();
    const before = db.getStreamerById(a);
    db.updatePollSettings(a, { polls_chat_enabled: 0, poll_start_template: 'Vote: {title}', chatbot_enabled: 1, shoutout_raid_enabled: 1 });
    db.updateShoutoutSettings(a, { shoutout_raid_enabled: 1, shoutout_raid_min_viewers: 5, shoutout_template: 'SO {name}', overlay_enabled: 1, polls_chat_enabled: 1 });
    const s = db.getStreamerById(a);
    assert.equal(s.polls_chat_enabled, 0, 'the shoutouts writer does not write the polls switch');
    assert.equal(s.poll_start_template, 'Vote: {title}');
    assert.equal(s.shoutout_raid_enabled, 1);
    assert.equal(s.shoutout_raid_min_viewers, 5);
    assert.equal(s.shoutout_template, 'SO {name}');
    assert.equal(s.chatbot_enabled, before.chatbot_enabled, 'a column of another card is left alone');
    assert.equal(s.overlay_enabled, before.overlay_enabled);
  });
});
```

Run: `node --test src/db.polls.test.js` — Expected: FAIL (the columns and functions do not exist).

- [ ] **Step 2: The migration and the table**

In `src/db.js`, right after the line `} catch (e) { _migrationLog('cp_last_sync_at', e); }`, add:

```js
// The Polls & predictions and Shoutouts cards (2026-10-15): the bot's lines about polls and predictions (each may be
// emptied: an empty text posts nothing), and the shoutouts' switches, raid minimum and text. Existing rows get the
// defaults (SQLite fills an added column's DEFAULT in).
{
  const POLL_AND_SHOUTOUT_COLUMNS = [
    ['polls_chat_enabled', 'INTEGER DEFAULT 1'],
    ['poll_start_template', "TEXT DEFAULT 'Poll: {title} — vote now! ({time} to vote)'"],
    ['poll_end_template', "TEXT DEFAULT 'Poll closed: {winner} won with {percent}% of the votes.'"],
    ['prediction_start_template', "TEXT DEFAULT 'Prediction: {title} — place your channel points! ({time} to predict)'"],
    ['prediction_lock_template', "TEXT DEFAULT 'Predictions are locked for \"{title}\". Good luck!'"],
    ['prediction_end_template', "TEXT DEFAULT '{outcome} wins! {winners} viewers share {points} channel points.'"],
    ['prediction_cancel_template', "TEXT DEFAULT 'Prediction cancelled: \"{title}\". Everyone gets their channel points back.'"],
    ['shoutout_command_enabled', 'INTEGER DEFAULT 0'],
    ['shoutout_raid_enabled', 'INTEGER DEFAULT 0'],
    ['shoutout_raid_min_viewers', 'INTEGER DEFAULT 1'],
    ['shoutout_template', "TEXT DEFAULT 'Go check out {name}! They were last streaming {game}: {link}'"],
  ];
  let cols = [];
  try {
    cols = db.pragma('table_info(streamers)').map((c) => c.name);
  } catch (e) { _migrationLog('poll_and_shoutout_columns', e); }
  for (const [name, definition] of POLL_AND_SHOUTOUT_COLUMNS) {
    if (cols.includes(name)) continue;
    try {
      db.exec(`ALTER TABLE streamers ADD COLUMN ${name} ${definition}`);
      console.log(`[DB] Added ${name} column to streamers`);
    } catch (e) { _migrationLog(name, e); }
  }
}

// The Polls & predictions card's saved templates (at most 20 per streamer, routes/polls.js). `choices` is a JSON array
// of texts; `points_per_vote` is empty when a poll has no channel-points voting.
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS poll_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      streamer_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      choices TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL,
      points_per_vote INTEGER,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (streamer_id) REFERENCES streamers(id)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_poll_templates_streamer ON poll_templates(streamer_id)');
} catch (e) { _migrationLog('poll_templates', e); }
```

In `STREAMER_OWNED_ROWS`, after the line `['chat_commands', 'streamer_id = ?'],` add `['poll_templates', 'streamer_id = ?'],` (`src/db.accounts.test.js` fails while a table that points at an account is missing from that list).

- [ ] **Step 3: The functions**

In `src/db.js`, right after the function `deleteChatCommand` (its body is `return db.prepare('DELETE FROM chat_commands WHERE id = ? AND streamer_id = ?').run(id, streamerId).changes > 0;`), add:

```js
// ── The Polls & predictions card's templates ──

// A poll_templates row as the card and the routes read it; a row whose choices cannot be read has none.
function pollTemplateOf(row) {
  if (!row) return null;
  let choices = [];
  try {
    const parsed = JSON.parse(row.choices);
    if (Array.isArray(parsed)) choices = parsed.map(String);
  } catch (e) { /* written by hand: no choices */ }
  return {
    id: row.id, kind: row.kind, title: row.title, choices, durationSeconds: row.duration_seconds,
    pointsPerVote: row.points_per_vote ?? null, sortOrder: row.sort_order,
  };
}

function getPollTemplates(streamerId) {
  return db.prepare('SELECT * FROM poll_templates WHERE streamer_id = ? ORDER BY sort_order, id').all(streamerId).map(pollTemplateOf);
}

function getPollTemplate(id, streamerId) {
  return pollTemplateOf(db.prepare('SELECT * FROM poll_templates WHERE id = ? AND streamer_id = ?').get(id, streamerId));
}

function countPollTemplates(streamerId) {
  return db.prepare('SELECT COUNT(*) AS n FROM poll_templates WHERE streamer_id = ?').get(streamerId).n;
}

// `value` is pollRules.checkPollInput()'s: { kind, title, choices, durationSeconds, pointsPerVote }. A new template goes
// last.
function addPollTemplate(streamerId, value) {
  const info = db.prepare(`
    INSERT INTO poll_templates (streamer_id, kind, title, choices, duration_seconds, points_per_vote, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM poll_templates WHERE streamer_id = ?))
  `).run(streamerId, value.kind, value.title, JSON.stringify(value.choices), value.durationSeconds, value.pointsPerVote, streamerId);
  return getPollTemplate(Number(info.lastInsertRowid), streamerId);
}

// False when the template is not the streamer's (or is gone).
function updatePollTemplate(id, streamerId, value) {
  return db.prepare('UPDATE poll_templates SET kind = ?, title = ?, choices = ?, duration_seconds = ?, points_per_vote = ? WHERE id = ? AND streamer_id = ?')
    .run(value.kind, value.title, JSON.stringify(value.choices), value.durationSeconds, value.pointsPerVote, id, streamerId).changes > 0;
}

function deletePollTemplate(id, streamerId) {
  return db.prepare('DELETE FROM poll_templates WHERE id = ? AND streamer_id = ?').run(id, streamerId).changes > 0;
}

// The two cards' settings (POST /dashboard/settings): each writer writes only its own columns.
const POLLS_COLUMNS = new Set([
  'polls_chat_enabled', 'poll_start_template', 'poll_end_template', 'prediction_start_template',
  'prediction_lock_template', 'prediction_end_template', 'prediction_cancel_template',
]);
const SHOUTOUT_COLUMNS = new Set(['shoutout_command_enabled', 'shoutout_raid_enabled', 'shoutout_raid_min_viewers', 'shoutout_template']);

function updateStreamerColumns(allowed, streamerId, fields) {
  const names = Object.keys(fields).filter((name) => allowed.has(name));
  if (names.length === 0) return;
  db.prepare(`UPDATE streamers SET ${names.map((name) => `${name} = ?`).join(', ')} WHERE id = ?`).run(...names.map((name) => fields[name]), streamerId);
}

function updatePollSettings(streamerId, fields) {
  updateStreamerColumns(POLLS_COLUMNS, streamerId, fields);
}

function updateShoutoutSettings(streamerId, fields) {
  updateStreamerColumns(SHOUTOUT_COLUMNS, streamerId, fields);
}
```

In `module.exports`, right after `deleteChatCommand,`, add:

```js
  getPollTemplates,
  getPollTemplate,
  countPollTemplates,
  addPollTemplate,
  updatePollTemplate,
  deletePollTemplate,
  updatePollSettings,
  updateShoutoutSettings,
```

Run: `node --test src/db.polls.test.js src/db.test.js src/db.accounts.test.js src/db.secrets.test.js` — Expected: PASS.

- [ ] **Step 4: Two boots on one fresh database, as CI does**

`DB_PATH` is `data/bot.db` next to `src/`, so the boots run in a temporary copy of the working tree (the worktree never gets a `data/bot.db`). Nothing here leaves the machine: Discord is off, the database has no streamer to connect, and the chat bot has no credentials.

```bash
BOOT=$(mktemp -d)
rsync -a --exclude .git --exclude node_modules --exclude data ./ "$BOOT/"
# A worktree has no node_modules of its own: Node finds the main checkout's, which is what the copy links to.
ln -s "$(cd "$(git rev-parse --git-common-dir)/.." && pwd)/node_modules" "$BOOT/node_modules"
(
  cd "$BOOT" || exit 1
  for run in 1 2; do
    DISCORD_DISABLED=1 TWITCH_CLIENT_ID=x TWITCH_CLIENT_SECRET=x PORT=3971 node src/index.js > "boot-$run.log" 2>&1 &
    pid=$!
    healthy=no
    for attempt in $(seq 1 60); do
      if curl -fsS --max-time 2 http://127.0.0.1:3971/health | grep -q '"ok":true'; then healthy=yes; break; fi
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    kill -TERM "$pid" 2>/dev/null; status=0; wait "$pid" || status=$?
    echo "boot $run: healthy=$healthy exit=$status failed-migrations=$(grep -cF '[DB migration]' "boot-$run.log") new-columns=$(grep -cE 'Added (polls_chat_enabled|poll_(start|end)_template|prediction_(start|lock|end|cancel)_template|shoutout_(command_enabled|raid_enabled|raid_min_viewers|template)) column to streamers' "boot-$run.log")"
  done
)
rm -rf "$BOOT"
```

Expected: `boot 1: healthy=yes exit=0 failed-migrations=0 new-columns=11` and `boot 2: healthy=yes exit=0 failed-migrations=0 new-columns=0`.

- [ ] **Step 5: The full suite, then commit**

Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` — Expected: PASS.

```bash
git add src/db.js src/db.polls.test.js
git commit -m "feat(polls): the streamers columns and the poll templates for polls, predictions and shoutouts"
```

---

### Task 3: Twitch — the two permissions, a channel's game and title, and the polls client

**Files:**
- Modify: `src/services/twitch.js` (`hasPollsScope`, `getChannelInfo`), `src/services/twitch.test.js`
- Modify: `src/routes/auth.js` (the broadcaster authorization's scopes), `src/routes/auth.test.js`
- Create: `src/services/twitchPolls.js`, `src/services/twitchPolls.test.js`

**Interfaces:**
- Consumes: `pollRules.checkPollInput()`'s value (Task 1); `db.updateStreamerCpSync(streamerId, { affiliate_status })` (exists; the rewards card reads `cp_affiliate_status === 'not_affiliate'`).
- Produces (`twitch.js`): `hasPollsScope(streamer) → boolean` (both permissions stored), `getChannelInfo(broadcasterId, options) → { gameName, title } | null` (app token; `options.signal`).
- Produces (`twitchPolls.js`): `PollsError` (`err.code` is one of `needs_reconnect`, `not_affiliate`, `running`, `changed`, `automod`, `not_found`, `twitch_failed` — each a key of `pollRules.ERRORS`); `createPoll(streamer, value)`, `endPoll(streamer, pollId)`, `latestPoll(streamer)`, `createPrediction(streamer, value)`, `lockPrediction(streamer, id)`, `resolvePrediction(streamer, id, outcomeId)`, `cancelPrediction(streamer, id)`, `latestPrediction(streamer)` — each resolves to Helix's poll or prediction object (`latest*` to the newest one or `null`; Twitch lists both newest first).

What Twitch's reference documents for these calls (Helix Create/End Poll, Create/End Prediction): a missing permission or a bad token is a **401**; a poll or prediction already running is a **400** ("The broadcaster already has a poll that's running…"); a title or choice AutoMod refuses is a **400** ("…failed AutoMod checks."); acting on one whose status changed is a **400** ("The poll must be active to terminate or archive it.", "…its current status must be ACTIVE"); an unknown prediction or outcome is a **404**. Nothing is documented for a channel that is not an Affiliate or Partner, so that refusal is recognised by its message (it names an affiliate or partner), whatever its status.

- [ ] **Step 1: Failing tests for `twitch.js` and the scopes**

In `src/services/twitch.test.js`, inside `describe('what multistream asks Twitch', …)` (it has the `freshTwitch()` and `stub(body)` helpers, `seen` and `TOKEN_URL`), add after the two `getChannelTitle` tests:

```js
  test('getChannelInfo reads the channel\'s game and title from /channels; no channel is null', async () => {
    const tw = freshTwitch();
    stub({ data: [{ broadcaster_id: '42', title: 'Endurance night', game_name: 'iRacing' }] });
    assert.deepEqual(await tw.getChannelInfo('42'), { gameName: 'iRacing', title: 'Endurance night' });
    const helix = seen.filter((call) => call.url !== TOKEN_URL);
    assert.equal(helix[0].url, 'https://api.twitch.tv/helix/channels?broadcaster_id=42');
    assert.ok(helix[0].opts.signal instanceof AbortSignal);
    stub({ data: [{ broadcaster_id: '42', title: '', game_name: '' }] });
    assert.deepEqual(await tw.getChannelInfo('42'), { gameName: '', title: '' });
    stub({ data: [] });
    assert.equal(await tw.getChannelInfo('42'), null);
  });

  test('hasPollsScope: both permissions, as Twitch stored them', () => {
    const tw = freshTwitch();
    assert.equal(tw.hasPollsScope({ broadcaster_scopes: 'bits:read channel:manage:polls channel:manage:predictions' }), true);
    assert.equal(tw.hasPollsScope({ broadcaster_scopes: 'channel:manage:polls' }), false);
    assert.equal(tw.hasPollsScope({ broadcaster_scopes: null }), false);
    assert.equal(tw.hasPollsScope(null), false);
  });
```

In `src/routes/auth.test.js`, in the test `'asks for the stream key (channel:read:stream_key) only while multistream is configured'`, the expected list becomes:

```js
      assert.deepEqual(off, ['channel:read:subscriptions', 'moderator:read:followers', 'bits:read', 'channel:manage:redemptions', 'channel:manage:polls', 'channel:manage:predictions']);
```

Run: `node --test src/services/twitch.test.js src/routes/auth.test.js` — Expected: FAIL (`tw.getChannelInfo is not a function`; the scope list).

- [ ] **Step 2: `twitch.js` and `auth.js`**

In `src/services/twitch.js`, after the function `getChannelTitle`, add:

```js
// A channel's category (its last game) and title (Helix GET /channels, app token), whether or not it is live; null
// when Twitch has no such channel. The shoutouts fill {game} and {title} with them.
async function getChannelInfo(broadcasterId, options) {
  const data = await apiCall(`/channels?broadcaster_id=${encodeURIComponent(broadcasterId)}`, options);
  const channel = data.data?.[0];
  if (!channel) return null;
  return {
    gameName: typeof channel.game_name === 'string' ? channel.game_name : '',
    title: typeof channel.title === 'string' ? channel.title : '',
  };
}
```

After the function `hasStreamKeyScope`, add:

```js
// The Polls & predictions card needs both permissions; a connection made before they were asked for has neither (the
// card then asks for one reconnect, and EventSub skips the poll and prediction events).
function hasPollsScope(streamer) {
  const scopes = ((streamer && streamer.broadcaster_scopes) || '').split(' ');
  return scopes.includes('channel:manage:polls') && scopes.includes('channel:manage:predictions');
}
```

In the `module.exports = { … }` line, add `getChannelInfo` after `getChannelTitle` and `hasPollsScope` after `hasStreamKeyScope`.

In `src/routes/auth.js` (`router.get('/broadcaster', …)`), the scopes line becomes:

```js
  // channel:manage:polls and channel:manage:predictions: the Polls & predictions card (they also cover their events).
  const scopes = ['channel:read:subscriptions', 'moderator:read:followers', 'bits:read', 'channel:manage:redemptions', 'channel:manage:polls', 'channel:manage:predictions'];
```

Run: `node --test src/services/twitch.test.js src/routes/auth.test.js` — Expected: PASS.

- [ ] **Step 3: Failing tests for the polls client**

Create `src/services/twitchPolls.test.js`:

```js
'use strict';

// The polls and predictions Helix client (services/twitchPolls.js) with a fake Helix in place of fetch: the bodies it
// sends, one token refresh on a 401, and Twitch's refusals (as its API reference words them) as the card's codes. Its
// config, database and token refresh are stubs: nothing leaves the machine. All ids and tokens are synthetic.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const FILE = path.join(__dirname, 'twitchPolls.js');
const affiliateFlags = [];
const refreshes = [];
let refreshFails = false;
const stubs = {
  '../config': { twitch: { clientId: 'synthetic-client-id' } },
  '../db': { updateStreamerCpSync: (id, fields) => affiliateFlags.push([id, fields]) },
  './twitch': {
    refreshBroadcasterToken: async (streamer) => {
      refreshes.push(streamer.id);
      if (refreshFails) throw Object.assign(new Error('refresh refused'), { code: 'INVALID_REFRESH_TOKEN' });
      return 'fresh-token';
    },
    hasPollsScope: (s) => /channel:manage:polls/.test(s.broadcaster_scopes || '') && /channel:manage:predictions/.test(s.broadcaster_scopes || ''),
  },
};

let polls;
let calls;
let answers; // what the fake Helix answers, in order: { status, body }, 'hang' or 'network'
const saved = {};

before(() => {
  saved.load = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === FILE && Object.hasOwn(stubs, request)) return stubs[request];
    return saved.load.call(this, request, parent, isMain);
  };
  delete require.cache[FILE];
  polls = require('./twitchPolls');
  Module._load = saved.load;
  saved.fetch = global.fetch;
});

after(() => { global.fetch = saved.fetch; });

beforeEach(() => {
  calls = [];
  answers = [];
  affiliateFlags.length = 0;
  refreshes.length = 0;
  refreshFails = false;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), method: opts.method, body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers.Authorization, signal: opts.signal });
    const next = answers.shift() || { status: 200, body: { data: [] } };
    if (next === 'network') throw new TypeError('fetch failed');
    if (next === 'hang') {
      return new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(opts.signal.reason), { once: true }));
    }
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
  };
});

const streamer = (over = {}) => ({ id: 7, twitch_user_id: '9001', broadcaster_access_token: 'old-token', broadcaster_scopes: 'channel:manage:polls channel:manage:predictions', cp_affiliate_status: null, ...over });
const poll = { id: 'poll-1', title: 'Top 5?', status: 'ACTIVE', choices: [{ id: 'c1', title: 'Yes', votes: 0 }, { id: 'c2', title: 'No', votes: 0 }] };
const value = { kind: 'poll', title: 'Top 5?', choices: ['Yes', 'No'], durationSeconds: 60, pointsPerVote: null };
const refused = (status, message) => ({ status, body: { error: 'Bad Request', status, message } });
const code = async (promise) => { try { await promise; } catch (err) { return err.code; } return 'resolved'; };

describe('what is sent to Twitch', () => {
  test('a poll: its choices, its time and its channel-points voting; the answer is Twitch\'s poll', async () => {
    answers.push({ status: 200, body: { data: [poll] } });
    const created = await polls.createPoll(streamer(), { ...value, durationSeconds: 120, pointsPerVote: 250 });
    assert.deepEqual(created, poll);
    assert.equal(calls[0].url, 'https://api.twitch.tv/helix/polls');
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(calls[0].body, { broadcaster_id: '9001', title: 'Top 5?', choices: [{ title: 'Yes' }, { title: 'No' }], duration: 120, channel_points_voting_enabled: true, channel_points_per_vote: 250 });
    assert.equal(calls[0].auth, 'Bearer old-token');
    assert.ok(calls[0].signal instanceof AbortSignal, 'every request has a deadline');
  });

  test('a poll without channel points sends no voting fields', async () => {
    answers.push({ status: 200, body: { data: [poll] } });
    await polls.createPoll(streamer(), value);
    assert.equal('channel_points_voting_enabled' in calls[0].body, false);
  });

  test('a prediction, its lock, its winner and its cancel; ending a poll; the newest of each', async () => {
    answers.push({ status: 200, body: { data: [{ id: 'pred-1' }] } }, { status: 200, body: { data: [{ id: 'pred-1' }] } },
      { status: 200, body: { data: [{ id: 'pred-1' }] } }, { status: 200, body: { data: [{ id: 'pred-1' }] } },
      { status: 200, body: { data: [poll] } }, { status: 200, body: { data: [] } }, { status: 200, body: { data: [{ id: 'pred-1' }] } });
    await polls.createPrediction(streamer(), { kind: 'prediction', title: 'Clean lap?', choices: ['Clean', 'Chaos'], durationSeconds: 60, pointsPerVote: null });
    await polls.lockPrediction(streamer(), 'pred-1');
    await polls.resolvePrediction(streamer(), 'pred-1', 'out-1');
    await polls.cancelPrediction(streamer(), 'pred-1');
    await polls.endPoll(streamer(), 'poll-1');
    assert.equal(await polls.latestPoll(streamer()), null);
    assert.deepEqual(await polls.latestPrediction(streamer()), { id: 'pred-1' });
    assert.deepEqual(calls.map((c) => [c.method, c.url.replace('https://api.twitch.tv/helix', ''), c.body]), [
      ['POST', '/predictions', { broadcaster_id: '9001', title: 'Clean lap?', outcomes: [{ title: 'Clean' }, { title: 'Chaos' }], prediction_window: 60 }],
      ['PATCH', '/predictions', { broadcaster_id: '9001', id: 'pred-1', status: 'LOCKED' }],
      ['PATCH', '/predictions', { broadcaster_id: '9001', id: 'pred-1', status: 'RESOLVED', winning_outcome_id: 'out-1' }],
      ['PATCH', '/predictions', { broadcaster_id: '9001', id: 'pred-1', status: 'CANCELED' }],
      ['PATCH', '/polls', { broadcaster_id: '9001', id: 'poll-1', status: 'TERMINATED' }],
      ['GET', '/polls?broadcaster_id=9001&first=1', null],
      ['GET', '/predictions?broadcaster_id=9001&first=1', null],
    ]);
  });
});

describe('the broadcaster token', () => {
  test('a 401 refreshes the token once and tries again', async () => {
    answers.push({ status: 401, body: { message: 'Invalid OAuth token' } }, { status: 200, body: { data: [poll] } });
    assert.deepEqual(await polls.latestPoll(streamer()), poll);
    assert.deepEqual(refreshes, [7]);
    assert.deepEqual(calls.map((c) => c.auth), ['Bearer old-token', 'Bearer fresh-token']);
  });

  test('a second 401 (a missing permission), or a refresh Twitch refuses, asks for a reconnect', async () => {
    answers.push(refused(401, 'The user access token is missing the channel:manage:polls scope.'), refused(401, 'The user access token is missing the channel:manage:polls scope.'));
    assert.equal(await code(polls.createPoll(streamer(), value)), 'needs_reconnect');
    refreshFails = true;
    answers.push({ status: 401, body: {} });
    assert.equal(await code(polls.latestPoll(streamer())), 'needs_reconnect');
  });

  test('without both permissions (or a linked channel, or a token) nothing is sent', async () => {
    assert.equal(await code(polls.createPoll(streamer({ broadcaster_scopes: 'channel:manage:polls' }), value)), 'needs_reconnect');
    assert.equal(await code(polls.latestPoll(streamer({ twitch_user_id: null }))), 'needs_reconnect');
    assert.equal(await code(polls.latestPoll(streamer({ broadcaster_access_token: null }))), 'needs_reconnect');
    assert.equal(calls.length, 0);
  });
});

describe('Twitch\'s refusals', () => {
  test('not an Affiliate or Partner (whatever the status): not_affiliate, and the flag is stored', async () => {
    answers.push(refused(403, 'The broadcaster must be a partner or affiliate'), refused(400, 'channel is not a partner or affiliate'));
    assert.equal(await code(polls.createPoll(streamer(), value)), 'not_affiliate');
    assert.equal(await code(polls.createPrediction(streamer(), { ...value, kind: 'prediction' })), 'not_affiliate');
    assert.deepEqual(affiliateFlags, [[7, { affiliate_status: 'not_affiliate' }], [7, { affiliate_status: 'not_affiliate' }]]);
  });

  test('a start that works clears a stored not-affiliate flag (the channel became one); otherwise nothing is stored', async () => {
    answers.push({ status: 200, body: { data: [poll] } }, { status: 200, body: { data: [poll] } });
    await polls.createPoll(streamer(), value);
    assert.deepEqual(affiliateFlags, []);
    await polls.createPoll(streamer({ cp_affiliate_status: 'not_affiliate' }), value);
    assert.deepEqual(affiliateFlags, [[7, { affiliate_status: 'affiliate' }]]);
  });

  test('one already running when starting: running; a text AutoMod refuses: automod', async () => {
    answers.push(refused(400, 'The broadcaster already has a poll that\'s running; you may not create another poll until the current poll completes.'));
    assert.equal(await code(polls.createPoll(streamer(), value)), 'running');
    answers.push(refused(400, 'The broadcaster already has a prediction that\'s running; you may not create another prediction until the current prediction is resolved or canceled.'));
    assert.equal(await code(polls.createPrediction(streamer(), { ...value, kind: 'prediction' })), 'running');
    answers.push(refused(400, 'The choice\'s title failed AutoMod checks.'));
    assert.equal(await code(polls.createPoll(streamer(), value)), 'automod');
  });

  test('acting on one whose status changed meanwhile: changed', async () => {
    answers.push(refused(400, 'The poll must be active to terminate or archive it.'));
    assert.equal(await code(polls.endPoll(streamer(), 'poll-1')), 'changed');
    answers.push(refused(400, 'To update the prediction\'s status to LOCKED, its current status must be ACTIVE.'));
    assert.equal(await code(polls.lockPrediction(streamer(), 'pred-1')), 'changed');
  });

  test('an unknown prediction or outcome: not_found; any other refusal or a server error: twitch_failed', async () => {
    answers.push(refused(404, 'The prediction in the id field was not found.'), refused(400, 'Bad Request'), refused(403, 'Forbidden'), { status: 503, body: {} });
    assert.equal(await code(polls.resolvePrediction(streamer(), 'gone', 'out-1')), 'not_found');
    assert.equal(await code(polls.createPoll(streamer(), value)), 'twitch_failed');
    assert.equal(await code(polls.createPoll(streamer(), value)), 'twitch_failed');
    assert.equal(await code(polls.lockPrediction(streamer(), 'pred-1')), 'twitch_failed');
    assert.deepEqual(affiliateFlags, []);
  });

  test('no network, or no answer within the deadline: twitch_failed', async () => {
    answers.push('network');
    assert.equal(await code(polls.latestPoll(streamer())), 'twitch_failed');
    const realTimeout = AbortSignal.timeout;
    AbortSignal.timeout = () => realTimeout.call(AbortSignal, 20);
    try {
      answers.push('hang');
      assert.equal(await code(polls.latestPoll(streamer())), 'twitch_failed');
    } finally {
      AbortSignal.timeout = realTimeout;
    }
  });
});
```

Run: `node --test src/services/twitchPolls.test.js` — Expected: FAIL (`Cannot find module './twitchPolls'`).

- [ ] **Step 4: Write `src/services/twitchPolls.js`**

```js
'use strict';

// Twitch's polls and predictions for a streamer (Helix, with the streamer's broadcaster token): start, end, lock,
// resolve, cancel, and the newest of each. A token Twitch refuses is refreshed once. Twitch's refusals become the codes
// the Polls & predictions card shows (PollsError.code; their texts are pollRules.ERRORS):
//   needs_reconnect  no linked channel or token, the two permissions missing, or a token Twitch refuses twice
//   not_affiliate    Twitch allows polls and predictions to Affiliates and Partners only: recognised by the message,
//                    since Twitch documents no status for it; the flag the rewards card reads is stored, and a start
//                    that works clears it again
//   running          a start while one of the same kind runs
//   automod          a title or choice Twitch's AutoMod refused
//   changed          an end, lock, result or cancel of one whose status changed meanwhile
//   not_found        a prediction or outcome Twitch does not know
//   twitch_failed    no answer within 10 seconds, no network, or anything else Twitch refuses (the route logs it)

const config = require('../config');
const db = require('../db');
const { refreshBroadcasterToken, hasPollsScope } = require('./twitch');

const HELIX_BASE = 'https://api.twitch.tv/helix';
const HELIX_TIMEOUT_MS = 10_000;

class PollsError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

function codeFor(status, message, creating) {
  const text = String(message || '').toLowerCase();
  if (/affiliate|partner/.test(text)) return 'not_affiliate';
  if (status === 401) return 'needs_reconnect';
  if (status === 404) return 'not_found';
  if (status === 400 && /automod/.test(text)) return 'automod';
  if (status === 400 && creating && /already/.test(text)) return 'running';
  if (status === 400 && !creating && /must be active|current status/.test(text)) return 'changed';
  return 'twitch_failed';
}

async function helix(streamer, method, urlPath, body, { creating = false } = {}) {
  if (!streamer || !streamer.twitch_user_id || !streamer.broadcaster_access_token || !hasPollsScope(streamer)) {
    throw new PollsError('needs_reconnect');
  }
  const send = (token) => fetch(`${HELIX_BASE}${urlPath}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Client-Id': config.twitch.clientId, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(HELIX_TIMEOUT_MS),
  });
  let res;
  try {
    res = await send(streamer.broadcaster_access_token);
    if (res.status === 401) {
      let fresh;
      try {
        fresh = await refreshBroadcasterToken(streamer);
      } catch (err) {
        throw new PollsError('needs_reconnect', err.message);
      }
      res = await send(fresh);
    }
  } catch (err) {
    if (err instanceof PollsError) throw err;
    throw new PollsError('twitch_failed', err && err.message);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = codeFor(res.status, data && data.message, creating);
    if (code === 'not_affiliate') db.updateStreamerCpSync(streamer.id, { affiliate_status: 'not_affiliate' });
    throw new PollsError(code, `${res.status} ${(data && data.message) || ''}`.trim());
  }
  if (creating && streamer.cp_affiliate_status === 'not_affiliate') db.updateStreamerCpSync(streamer.id, { affiliate_status: 'affiliate' });
  return data;
}

const first = (data) => (data && Array.isArray(data.data) && data.data[0]) || null;
const own = (streamer) => encodeURIComponent(streamer && streamer.twitch_user_id);

// `value` is pollRules.checkPollInput()'s.
async function createPoll(streamer, value) {
  const body = { broadcaster_id: streamer.twitch_user_id, title: value.title, choices: value.choices.map((title) => ({ title })), duration: value.durationSeconds };
  if (value.pointsPerVote) {
    body.channel_points_voting_enabled = true;
    body.channel_points_per_vote = value.pointsPerVote;
  }
  return first(await helix(streamer, 'POST', '/polls', body, { creating: true }));
}

// Ends a poll now; it stays visible in the channel with its result (TERMINATED, not ARCHIVED).
async function endPoll(streamer, pollId) {
  return first(await helix(streamer, 'PATCH', '/polls', { broadcaster_id: streamer.twitch_user_id, id: pollId, status: 'TERMINATED' }));
}

async function latestPoll(streamer) {
  return first(await helix(streamer, 'GET', `/polls?broadcaster_id=${own(streamer)}&first=1`));
}

async function createPrediction(streamer, value) {
  return first(await helix(streamer, 'POST', '/predictions', {
    broadcaster_id: streamer.twitch_user_id, title: value.title, outcomes: value.choices.map((title) => ({ title })), prediction_window: value.durationSeconds,
  }, { creating: true }));
}

async function lockPrediction(streamer, predictionId) {
  return first(await helix(streamer, 'PATCH', '/predictions', { broadcaster_id: streamer.twitch_user_id, id: predictionId, status: 'LOCKED' }));
}

async function resolvePrediction(streamer, predictionId, outcomeId) {
  return first(await helix(streamer, 'PATCH', '/predictions', { broadcaster_id: streamer.twitch_user_id, id: predictionId, status: 'RESOLVED', winning_outcome_id: outcomeId }));
}

// Cancels a prediction: Twitch gives every viewer their points back.
async function cancelPrediction(streamer, predictionId) {
  return first(await helix(streamer, 'PATCH', '/predictions', { broadcaster_id: streamer.twitch_user_id, id: predictionId, status: 'CANCELED' }));
}

async function latestPrediction(streamer) {
  return first(await helix(streamer, 'GET', `/predictions?broadcaster_id=${own(streamer)}&first=1`));
}

module.exports = {
  PollsError, createPoll, endPoll, latestPoll, createPrediction, lockPrediction, resolvePrediction, cancelPrediction, latestPrediction,
};
```

Run: `node --test src/services/twitchPolls.test.js` — Expected: PASS.

- [ ] **Step 5: The full suite, then commit**

Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` — Expected: PASS.

```bash
git add src/services/twitch.js src/services/twitch.test.js src/routes/auth.js src/routes/auth.test.js src/services/twitchPolls.js src/services/twitchPolls.test.js
git commit -m "feat(polls): the polls and predictions permissions, a channel's game and title, and the Helix client"
```

---

### Task 4: The live poll and prediction (`livePolls.js`)

**Files:**
- Create: `src/services/livePolls.js`, `src/services/livePolls.test.js`

**Interfaces:**
- Consumes: `pollRules.normalizePoll/normalizePrediction/announcement/onCard` (Task 1); `fillChatTemplate(template, values)` (`chatTemplate.js`); `twitchPolls.latestPoll/latestPrediction` and the `needs_reconnect` code (Task 3); the streamers columns `polls_chat_enabled` and the six `*_template` texts (Task 2); `chatManager.sendMessage(streamerId, text, { priority })` (`twitchChat.js`: posts nothing while the chatbot is off or the account disabled).
- Produces: `createLivePolls({ emit, send, getStreamer, fetchLatest, now })` → `{ onEvent(streamerId, subscriptionType, event), setFromTwitch(streamerId, kind, twitchObject, phase) → view | null, snapshot(streamerId) → { poll, prediction, serverNow }, barState(streamerId) → { poll, prediction, serverNow }, live(streamerId) → Promise<snapshot>, sweep() }`, and `livePolls`: that factory wired to the bus, the chat bot, the database and `twitchPolls`. `phase` is `'start'`, `'lock'`, `'end'` or `null`.
- `snapshot()` is what the card shows (a result for 30 seconds); `barState()` is what the bar is given (both as stored: the bar times its 10 seconds itself).
- The bus: channel `poll:<streamerId>`, payload `{ type: 'poll-state', poll: view | null, prediction: view | null, serverNow }`.

- [ ] **Step 1: Write the failing test**

Create `src/services/livePolls.test.js`:

```js
'use strict';

// The live poll and prediction per streamer (services/livePolls.js) with fakes for the bus, the chat bot, the
// database and Twitch, and a clock the tests move: what the card, the bar and the bot get from EventSub's events, from
// the card's own buttons and from reads of Twitch. All ids, names and texts are synthetic.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createLivePolls } = require('./livePolls');

const NOW = Date.parse('2026-10-15T20:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

const TEXTS = {
  polls_chat_enabled: 1,
  poll_start_template: 'Poll: {title} — vote now! ({time} to vote)',
  poll_end_template: 'Poll closed: {winner} won with {percent}% of the votes.',
  prediction_start_template: 'Prediction: {title} — place your channel points! ({time} to predict)',
  prediction_lock_template: 'Predictions are locked for "{title}". Good luck!',
  prediction_end_template: '{outcome} wins! {winners} viewers share {points} channel points.',
  prediction_cancel_template: 'Prediction cancelled: "{title}". Everyone gets their channel points back.',
};

function setup({ streamer = { id: 7, ...TEXTS }, latest = { poll: null, prediction: null } } = {}) {
  const world = { t: NOW, emitted: [], said: [], reads: 0, latest, streamer };
  world.lp = createLivePolls({
    emit: (channel, payload) => world.emitted.push({ channel, payload }),
    send: (_streamerId, text) => world.said.push(text),
    getStreamer: () => world.streamer,
    fetchLatest: async () => {
      world.reads += 1;
      if (world.latest instanceof Error) throw world.latest;
      return world.latest;
    },
    now: () => world.t,
  });
  return world;
}

// EventSub's events (version 1), synthetic.
const choices = (yes, no) => [{ id: 'c1', title: 'Yes', votes: yes }, { id: 'c2', title: 'No', votes: no }];
const pollBegin = { id: 'poll-1', title: 'Top 5?', choices: [{ id: 'c1', title: 'Yes' }, { id: 'c2', title: 'No' }], started_at: iso(NOW), ends_at: iso(NOW + 120000) };
const pollProgress = { ...pollBegin, choices: choices(48, 27) };
const pollEnd = { id: 'poll-1', title: 'Top 5?', choices: choices(48, 27), status: 'completed', started_at: iso(NOW), ended_at: iso(NOW + 120000) };
const outcomes = [{ id: 'o1', title: 'Clean', color: 'blue', users: 18, channel_points: 12400 }, { id: 'o2', title: 'Chaos', color: 'pink', users: 9, channel_points: 5100 }];
const predictionBegin = { id: 'pred-1', title: 'Clean first lap?', outcomes: outcomes.map(({ id, title, color }) => ({ id, title, color })), started_at: iso(NOW), locks_at: iso(NOW + 60000) };
const predictionLock = { id: 'pred-1', title: 'Clean first lap?', outcomes, started_at: iso(NOW), locked_at: iso(NOW + 60000) };
const predictionEnd = (status) => ({ id: 'pred-1', title: 'Clean first lap?', outcomes, status, winning_outcome_id: status === 'resolved' ? 'o1' : null, started_at: iso(NOW), ended_at: iso(NOW + 90000) });

describe('EventSub\'s events', () => {
  test('a poll started on Twitch: the card and the bar get it at once; the bot announces its start and its result, nothing in between', () => {
    const w = setup();
    w.lp.onEvent(7, 'channel.poll.begin', pollBegin);
    assert.equal(w.lp.snapshot(7).poll.state, 'running');
    assert.deepEqual(w.emitted.map((e) => [e.channel, e.payload.type, e.payload.poll.id]), [['poll:7', 'poll-state', 'poll-1']]);
    assert.deepEqual(w.said, ['Poll: Top 5? — vote now! (2:00 to vote)']);
    w.t += 30000;
    w.lp.onEvent(7, 'channel.poll.progress', pollProgress);
    assert.deepEqual(w.lp.snapshot(7).poll.options.map((o) => o.votes), [48, 27]);
    assert.equal(w.emitted.length, 2);
    assert.equal(w.said.length, 1);
    w.lp.onEvent(7, 'channel.poll.end', pollEnd);
    assert.equal(w.lp.snapshot(7).poll.result, 'won');
    assert.deepEqual(w.said.slice(1), ['Poll closed: Yes won with 64% of the votes.']);
  });

  test('a prediction: its start, its lock and its result; a cancel says the points go back', () => {
    const w = setup();
    w.lp.onEvent(7, 'channel.prediction.begin', predictionBegin);
    w.t += 60000;
    w.lp.onEvent(7, 'channel.prediction.lock', predictionLock);
    assert.equal(w.lp.snapshot(7).prediction.state, 'locked');
    w.lp.onEvent(7, 'channel.prediction.end', predictionEnd('resolved'));
    assert.deepEqual(w.said, [
      'Prediction: Clean first lap? — place your channel points! (1:00 to predict)',
      'Predictions are locked for "Clean first lap?". Good luck!',
      'Clean wins! 18 viewers share 17500 channel points.',
    ]);
    const c = setup();
    c.lp.onEvent(7, 'channel.prediction.end', predictionEnd('canceled'));
    assert.deepEqual(c.said, ['Prediction cancelled: "Clean first lap?". Everyone gets their channel points back.']);
  });

  test('the card\'s own button and EventSub report the same moment: one line each', () => {
    const w = setup();
    w.lp.setFromTwitch(7, 'poll', { ...pollBegin, status: 'ACTIVE', duration: 120 }, 'start');
    w.lp.onEvent(7, 'channel.poll.begin', pollBegin);
    w.lp.setFromTwitch(7, 'poll', { ...pollEnd, status: 'TERMINATED' }, 'end');
    w.lp.onEvent(7, 'channel.poll.end', { ...pollEnd, status: 'terminated' });
    assert.equal(w.said.length, 2);
  });

  test('a late or repeated event never takes a poll back, and an earlier poll never replaces a later one', () => {
    const w = setup();
    w.lp.onEvent(7, 'channel.poll.begin', pollBegin);
    w.lp.onEvent(7, 'channel.poll.end', pollEnd);
    w.lp.onEvent(7, 'channel.poll.progress', pollProgress);
    w.lp.onEvent(7, 'channel.poll.begin', pollBegin);
    assert.equal(w.lp.snapshot(7).poll.state, 'ended');
    assert.equal(w.said.length, 2, 'the repeated begin is not announced again');
    w.t = NOW + 300000;
    w.lp.onEvent(7, 'channel.poll.begin', { ...pollBegin, id: 'poll-2', started_at: iso(NOW + 300000), ends_at: iso(NOW + 360000) });
    w.lp.onEvent(7, 'channel.poll.progress', pollProgress);
    assert.equal(w.lp.snapshot(7).poll.id, 'poll-2');
  });

  test('an event of another type is ignored', () => {
    const w = setup();
    w.lp.onEvent(7, 'channel.follow', { user_name: 'Viewer' });
    assert.deepEqual(w.emitted, []);
  });
});

describe('what the bot says', () => {
  test('nothing with the announcements off or a text emptied; a title never starts a command', () => {
    const off = setup({ streamer: { id: 7, ...TEXTS, polls_chat_enabled: 0 } });
    off.lp.onEvent(7, 'channel.poll.begin', pollBegin);
    assert.deepEqual(off.said, []);
    assert.equal(off.emitted.length, 1, 'the bar still gets it');
    const emptied = setup({ streamer: { id: 7, ...TEXTS, poll_start_template: '' } });
    emptied.lp.onEvent(7, 'channel.poll.begin', pollBegin);
    assert.deepEqual(emptied.said, []);
    const bare = setup({ streamer: { id: 7, ...TEXTS, poll_start_template: '{title}' } });
    bare.lp.onEvent(7, 'channel.poll.begin', { ...pollBegin, title: '!ban everyone' });
    assert.deepEqual(bare.said, ['ban everyone']);
  });

  test('a tie names every tied choice; a poll nobody voted in has no result line', () => {
    const tie = setup();
    tie.lp.onEvent(7, 'channel.poll.end', { ...pollEnd, choices: choices(5, 5) });
    assert.deepEqual(tie.said, ['Poll closed: Yes / No won with 50% of the votes.']);
    const none = setup();
    none.lp.onEvent(7, 'channel.poll.end', { ...pollEnd, choices: choices(0, 0) });
    assert.deepEqual(none.said, []);
  });
});

describe('what the card and the bar are given', () => {
  test('the card keeps a result 30 seconds; the bar is given it as stored, with the server\'s clock', () => {
    const w = setup();
    w.lp.onEvent(7, 'channel.poll.end', pollEnd);
    w.t = NOW + 120000 + 29000;
    assert.equal(w.lp.snapshot(7).poll.id, 'poll-1');
    w.t = NOW + 120000 + 30000;
    assert.equal(w.lp.snapshot(7).poll, null);
    assert.equal(w.lp.barState(7).poll.id, 'poll-1');
    assert.equal(w.lp.barState(7).serverNow, w.t);
    assert.deepEqual(w.lp.snapshot(8), { poll: null, prediction: null, serverNow: w.t });
  });
});

describe('reading Twitch (live)', () => {
  const helixPoll = { id: 'poll-9', title: 'Started on Twitch', status: 'ACTIVE', duration: 120, started_at: iso(NOW - 10000), choices: choices(3, 1) };

  test('with no event, a read finds a poll started on Twitch: shown and given to the bar, never announced', async () => {
    const w = setup({ latest: { poll: helixPoll, prediction: null } });
    const seen = await w.lp.live(7);
    assert.equal(seen.poll.id, 'poll-9');
    assert.equal(w.reads, 1);
    assert.equal(w.emitted.length, 1);
    assert.deepEqual(w.said, [], 'a read after a restart must not announce a poll that is already running');
  });

  test('at most one read every 5 seconds, shared by callers at the same time; none while EventSub spoke in the last 30 seconds', async () => {
    const w = setup({ latest: { poll: helixPoll, prediction: null } });
    await Promise.all([w.lp.live(7), w.lp.live(7)]);
    assert.equal(w.reads, 1);
    w.t += 4999;
    await w.lp.live(7);
    assert.equal(w.reads, 1);
    w.t += 1;
    await w.lp.live(7);
    assert.equal(w.reads, 2);
    w.lp.onEvent(7, 'channel.poll.progress', { ...pollProgress, id: 'poll-9', started_at: helixPoll.started_at });
    w.t += 29999;
    await w.lp.live(7);
    assert.equal(w.reads, 2);
    w.t += 1;
    await w.lp.live(7);
    assert.equal(w.reads, 3);
  });

  test('a failed read keeps what is known; a missing permission is passed on', async () => {
    const w = setup({ latest: { poll: helixPoll, prediction: null } });
    await w.lp.live(7);
    w.latest = Object.assign(new Error('twitch_failed'), { code: 'twitch_failed' });
    w.t += 5000;
    assert.equal((await w.lp.live(7)).poll.id, 'poll-9');
    w.latest = Object.assign(new Error('needs_reconnect'), { code: 'needs_reconnect' });
    w.t += 5000;
    await assert.rejects(w.lp.live(7), (err) => err.code === 'needs_reconnect');
  });
});

describe('memory', () => {
  test('a streamer with nothing running is forgotten an hour after the last change; one with a poll running is kept', () => {
    const w = setup();
    w.lp.onEvent(7, 'channel.poll.end', pollEnd);
    w.lp.onEvent(8, 'channel.poll.begin', pollBegin);
    w.t += 60 * 60 * 1000 + 1;
    w.lp.sweep();
    assert.equal(w.lp.barState(7).poll, null);
    assert.equal(w.lp.barState(8).poll.id, 'poll-1');
  });
});
```

Run: `node --test src/services/livePolls.test.js` — Expected: FAIL (`Cannot find module './livePolls'`).

- [ ] **Step 2: Write `src/services/livePolls.js`**

```js
'use strict';

// The poll and the prediction running on each streamer's channel, as the Polls & predictions card, the on-stream bar
// and the bot see them. Twitch tells this module about them three ways: EventSub's seven poll and prediction events
// (onEvent), Twitch's answer to the card's own buttons (setFromTwitch), and — while EventSub said nothing in the last
// 30 seconds — a read of Twitch when the card or the bar asks, at most one every 5 seconds per streamer (live). A late
// or repeated message never takes a poll back: an ended poll stays ended, and an earlier poll never replaces a later
// one. Every change goes on the bus channel `poll:<streamerId>` for the bar (never `overlay:<id>`: the alert overlay
// would queue it as a card). The bot announces a start, a lock and an end once per poll or prediction — never what a
// read finds already running — with the streamer's texts while their announcements are on (chatManager.sendMessage
// checks the chatbot switch).

const rules = require('./pollRules');
const { fillChatTemplate } = require('./chatTemplate');
const bus = require('./overlayBus');

const READ_EVERY_MS = 5000;
const EVENT_FRESH_MS = 30000;
const FORGET_AFTER_MS = 60 * 60 * 1000;
const SWEEP_EVERY_MS = 10 * 60 * 1000;
const ANNOUNCED_KEPT = 50; // the moments remembered per streamer, so a repeat is not announced twice
const RANK = Object.freeze({ running: 0, locked: 1, ended: 2 });

// What each EventSub type is about, and the moment the bot announces (null: none).
const EVENTS = Object.freeze({
  'channel.poll.begin': ['poll', 'start'],
  'channel.poll.progress': ['poll', null],
  'channel.poll.end': ['poll', 'end'],
  'channel.prediction.begin': ['prediction', 'start'],
  'channel.prediction.progress': ['prediction', null],
  'channel.prediction.lock': ['prediction', 'lock'],
  'channel.prediction.end': ['prediction', 'end'],
});

const normalize = (kind, src, now) => (kind === 'poll' ? rules.normalizePoll(src, now) : rules.normalizePrediction(src, now));

function createLivePolls({ emit, send, getStreamer, fetchLatest, now = Date.now }) {
  const streamers = new Map(); // streamerId → { poll, prediction, eventAt, readAt, reading, announced, touchedAt }

  function entry(streamerId) {
    let e = streamers.get(streamerId);
    if (!e) {
      e = { poll: null, prediction: null, eventAt: 0, readAt: 0, reading: null, announced: new Set(), touchedAt: now() };
      streamers.set(streamerId, e);
    }
    return e;
  }

  // 'stale' when `view` is older news than what is stored for its kind; 'same' when it changes nothing; else
  // 'changed', and it is stored.
  function store(e, view) {
    const old = e[view.kind];
    if (old && old.id === view.id && RANK[view.state] < RANK[old.state]) return 'stale';
    if (old && old.id !== view.id && old.startedAt !== null && view.startedAt !== null && view.startedAt < old.startedAt) return 'stale';
    e.touchedAt = now();
    if (old && JSON.stringify(old) === JSON.stringify(view)) return 'same';
    e[view.kind] = view;
    return 'changed';
  }

  function barState(streamerId) {
    const e = streamers.get(streamerId);
    return { poll: e ? e.poll : null, prediction: e ? e.prediction : null, serverNow: now() };
  }

  function announce(streamerId, e, view, phase) {
    const key = `${view.kind}:${view.id}:${phase}`;
    if (e.announced.has(key)) return;
    e.announced.add(key);
    if (e.announced.size > ANNOUNCED_KEPT) e.announced.delete(e.announced.values().next().value);
    const streamer = getStreamer(streamerId);
    if (!streamer || !streamer.polls_chat_enabled) return;
    const line = rules.announcement(view, phase, now());
    if (!line) return;
    const text = fillChatTemplate(streamer[line.textKey], line.values);
    if (text) send(streamerId, text);
  }

  // One poll or prediction as Twitch described it; `phase` is the moment to announce, or null.
  function take(streamerId, kind, src, phase) {
    const view = normalize(kind, src, now());
    if (!view) return null;
    const e = entry(streamerId);
    const result = store(e, view);
    if (result === 'stale') return e[kind];
    if (result === 'changed') emit(`poll:${streamerId}`, { type: 'poll-state', ...barState(streamerId) });
    if (phase) announce(streamerId, e, view, phase);
    return view;
  }

  // An EventSub notification of one of the seven poll and prediction types.
  function onEvent(streamerId, subscriptionType, event) {
    const what = EVENTS[subscriptionType];
    if (!what) return;
    entry(streamerId).eventAt = now();
    take(streamerId, what[0], event, what[1]);
  }

  // Twitch's answer to one of the card's buttons: shown at once, and announced once even when EventSub reports the
  // same moment a little later.
  function setFromTwitch(streamerId, kind, twitchObject, phase) {
    return take(streamerId, kind, twitchObject, phase || null);
  }

  // What the card shows: running, locked, or a result for 30 seconds.
  function snapshot(streamerId) {
    const e = streamers.get(streamerId);
    const t = now();
    return {
      poll: e && rules.onCard(e.poll, t) ? e.poll : null,
      prediction: e && rules.onCard(e.prediction, t) ? e.prediction : null,
      serverNow: t,
    };
  }

  // The card's view after reading Twitch when EventSub said nothing in the last 30 seconds and the last read is at
  // least 5 seconds old, so a poll started on Twitch's own dashboard (or by a moderator) shows without EventSub. What
  // a read finds is never announced. A read that fails keeps what is known; a missing permission is passed on.
  async function live(streamerId) {
    const e = entry(streamerId);
    const t = now();
    if (t - e.eventAt < EVENT_FRESH_MS || t - e.readAt < READ_EVERY_MS) return snapshot(streamerId);
    if (!e.reading) {
      e.reading = (async () => {
        try {
          const latest = await fetchLatest(getStreamer(streamerId));
          take(streamerId, 'poll', latest && latest.poll, null);
          take(streamerId, 'prediction', latest && latest.prediction, null);
        } catch (err) {
          if (err && err.code === 'needs_reconnect') throw err;
        } finally {
          e.readAt = now();
          e.reading = null;
        }
      })();
    }
    await e.reading;
    return snapshot(streamerId);
  }

  // Forgets a streamer with nothing running and no change in the last hour.
  function sweep() {
    const t = now();
    for (const [streamerId, e] of streamers) {
      const busy = [e.poll, e.prediction].some((view) => view && view.state !== 'ended');
      if (!busy && !e.reading && t - e.touchedAt > FORGET_AFTER_MS) streamers.delete(streamerId);
    }
  }

  return { onEvent, setFromTwitch, snapshot, barState, live, sweep };
}

// The app's instance. The chat bot, the database and twitchPolls are required when first used: they load the app's
// config, which this file's unit tests do without.
const livePolls = createLivePolls({
  emit: (channel, payload) => bus.emit(channel, payload),
  send: (streamerId, text) => require('./twitchChat').chatManager.sendMessage(streamerId, text, { priority: 'normal' }),
  getStreamer: (streamerId) => require('../db').getStreamerById(streamerId),
  fetchLatest: async (streamer) => {
    const twitchPolls = require('./twitchPolls');
    const [poll, prediction] = await Promise.all([twitchPolls.latestPoll(streamer), twitchPolls.latestPrediction(streamer)]);
    return { poll, prediction };
  },
});
setInterval(() => livePolls.sweep(), SWEEP_EVERY_MS).unref();

module.exports = { createLivePolls, livePolls, READ_EVERY_MS, EVENT_FRESH_MS };
```

Run: `node --test src/services/livePolls.test.js` — Expected: PASS.

- [ ] **Step 3: The full suite, then commit**

Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` — Expected: PASS.

```bash
git add src/services/livePolls.js src/services/livePolls.test.js
git commit -m "feat(polls): the live poll and prediction per streamer, for the card, the bar and the bot"
```

---

### Task 5: EventSub — the seven poll and prediction events

**Files:**
- Modify: `src/services/eventsub.js`, `src/services/eventsub.test.js`, `src/services/managersDisabled.test.js`

**Interfaces:**
- Consumes: `hasPollsScope(streamer)` (Task 3); `livePolls.onEvent(streamerId, subscriptionType, event)` (Task 4).
- Produces: the seven types subscribed (version 1, condition `broadcaster_user_id`) for a streamer whose stored scopes hold both permissions, after the seven existing ones; their notifications go to `livePolls.onEvent` only (no alert, no stats row, no thank-you).

- [ ] **Step 1: Write the failing tests**

In `src/services/eventsub.test.js`:
- the line `const effects = { overlay: [], overlayLog: [], chat: [], raidProtection: [], redemptions: [] };` becomes `const effects = { overlay: [], overlayLog: [], chat: [], raidProtection: [], redemptions: [], polls: [] };`;
- right after it, add `let pollsScope = false; // what the stubbed hasPollsScope answers`;
- in `stubs`, the `'./twitch'` entry becomes `'./twitch': { refreshBroadcasterToken: async () => 'synthetic-fresh-token', hasRedemptionScope: () => true, hasPollsScope: () => pollsScope },`, and add the entry `'./livePolls': { livePolls: { onEvent: (streamerId, type, event) => effects.polls.push({ streamerId, type, event }) } },`;
- in `beforeEach`, right after `subscribeCalls = [];`, add `pollsScope = false;` (so every existing "7 subscriptions" assertion stays as it is);
- at the end of the file, add:

```js
describe('polls and predictions', () => {
  const POLL_TYPES = [
    'channel.poll.begin', 'channel.poll.progress', 'channel.poll.end',
    'channel.prediction.begin', 'channel.prediction.progress', 'channel.prediction.lock', 'channel.prediction.end',
  ];

  test('a connection made before the two permissions were asked for skips their seven events', async () => {
    await connected();
    assert.deepEqual(subscribeCalls.map((c) => c.body.type), SUBSCRIPTION_TYPES);
  });

  test('with them, each of the seven is subscribed once (version 1, the broadcaster\'s channel), after the others', async () => {
    pollsScope = true;
    await connected();
    assert.deepEqual(subscribeCalls.map((c) => c.body.type), [...SUBSCRIPTION_TYPES, ...POLL_TYPES]);
    for (const call of subscribeCalls.slice(SUBSCRIPTION_TYPES.length)) {
      assert.equal(call.body.version, '1');
      assert.deepEqual(call.body.condition, { broadcaster_user_id: '9001' });
    }
  });

  test('their events go to the live polls only — no alert, no stats row, no thank-you — and a repeat once', async () => {
    pollsScope = true;
    const socket = await connected();
    const begin = notification('channel.poll.begin', { id: 'poll-1', title: 'Top 5?', choices: [] }, 'synthetic-poll-message');
    socket.receive(begin);
    socket.receive(begin);
    socket.receive(notification('channel.prediction.lock', { id: 'pred-1', title: 'Clean lap?', outcomes: [] }));
    assert.deepEqual(effects.polls.map((p) => [p.streamerId, p.type, p.event.id]), [[1, 'channel.poll.begin', 'poll-1'], [1, 'channel.prediction.lock', 'pred-1']]);
    assert.deepEqual(effects.overlay, []);
    assert.deepEqual(effects.overlayLog, []);
    assert.deepEqual(effects.chat, []);
  });
});
```

In `src/services/managersDisabled.test.js`, the `'./twitch'` stub of `eventsub.js` becomes `'./twitch': { refreshBroadcasterToken: async () => 'token', hasRedemptionScope: () => false, hasPollsScope: () => false },` (eventsub.js reads it from now on).

Run: `node --test src/services/eventsub.test.js` — Expected: the two new tests that turn `pollsScope` on FAIL (only seven subscriptions; nothing reaches `effects.polls`); every other test passes.

- [ ] **Step 2: Subscribe and route the seven types**

In `src/services/eventsub.js`:
- the line `const { refreshBroadcasterToken, hasRedemptionScope } = require('./twitch');` becomes `const { refreshBroadcasterToken, hasRedemptionScope, hasPollsScope } = require('./twitch');`, and after `const { createMessageDedupe } = require('./messageDedupe');` add `const { livePolls } = require('./livePolls');`;
- in `SUBSCRIPTION_TYPES`, after the `channel.channel_points_custom_reward_redemption.add` entry, add:

```js
  // The Polls & predictions card, the bar and the bot's lines (livePolls); only with both permissions (needsPolls).
  { type: 'channel.poll.begin', version: '1', needsPolls: true },
  { type: 'channel.poll.progress', version: '1', needsPolls: true },
  { type: 'channel.poll.end', version: '1', needsPolls: true },
  { type: 'channel.prediction.begin', version: '1', needsPolls: true },
  { type: 'channel.prediction.progress', version: '1', needsPolls: true },
  { type: 'channel.prediction.lock', version: '1', needsPolls: true },
  { type: 'channel.prediction.end', version: '1', needsPolls: true },
```

- in `createSubscription`, right after the block that returns `false` for the redemption type without `hasRedemptionScope(streamer)`, add:

```js
    // A connection made before the polls permissions were asked for skips their events (its card asks for a
    // reconnect).
    if (subType.needsPolls && !hasPollsScope(streamer)) return false;
```

- in `normalizeEvent`, right before `default:`, add:

```js
      case 'channel.poll.begin':
      case 'channel.poll.progress':
      case 'channel.poll.end':
      case 'channel.prediction.begin':
      case 'channel.prediction.progress':
      case 'channel.prediction.lock':
      case 'channel.prediction.end':
        return { type: 'poll', subscriptionType: subType, event };
```

- in `handleNotification`, right after the redemption block (the one that ends with `return;` after `handleRedemption(...)`), add:

```js
    // Polls and predictions feed the Polls & predictions card, the bar and the bot's lines: no alert, no stats row,
    // no thank-you.
    if (normalized.type === 'poll') {
      livePolls.onEvent(this.streamerId, normalized.subscriptionType, normalized.event);
      return;
    }
```

Run: `node --test src/services/eventsub.test.js` — Expected: PASS.

- [ ] **Step 3: The full suite, then commit**

Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` — Expected: PASS.

```bash
git add src/services/eventsub.js src/services/eventsub.test.js src/services/managersDisabled.test.js
git commit -m "feat(polls): EventSub's poll and prediction events feed the live polls"
```

---

### Task 6: Shoutouts — `!so`, the raid shoutout and the card's test line

**Files:**
- Create: `src/services/shoutouts.js`, `src/services/shoutouts.test.js`
- Modify: `src/services/twitchChat.js` (the `!so` hook), `src/services/twitchChat.test.js`
- Modify: `src/services/eventsub.js` (the raider's login and id; the raid shoutout), `src/services/eventsub.test.js`
- Modify: `src/routes/dashboard.js` (`POST /dashboard/shoutouts/test`), `src/routes/dashboard.test.js`
- Modify: `src/locales/*.json` (one key)

**Interfaces:**
- Consumes: `normalizeTwitchLogin(input)` (`twitchLogin.js`: a name, `@name` or a pasted channel link → login or null); `fillChatTemplate`; `twitch.getUserProfile(login)` → `{ id, login, display_name, … } | null` and `twitch.getChannelInfo(id)` (Task 3); `chatManager.sendMessage(streamerId, text, { priority })`; the streamers columns `shoutout_command_enabled`, `shoutout_raid_enabled`, `shoutout_raid_min_viewers`, `shoutout_template` (Task 2); `chatbotOnForTest` and `limitTests` (`routes/dashboard.js`).
- Produces: `isShoutoutCommand(streamer, tags, message) → boolean`; `shoutoutLine(template, { login, name, game, title }) → string`; `RAID_MIN_VIEWERS` (`[1, 2, 5, 10, 25, 50, 100]`, Task 7 accepts only these); `createShoutouts({ lookup, send, getStreamer, log, now })` → `{ fromCommand(streamer, message), afterRaid(streamerId, raid), testInChat(streamer), sweep(), size }` (each of the first three resolves to `'sent'`, `'cooldown'`, `'unknown'`, `'empty'`, `'failed'`, `'off'`, `'small'` or `'no_name'`); `shoutouts`, that factory wired to Twitch, the chat bot and the database. The raid event's data gains `login` and `userId`.

- [ ] **Step 1: The service, test first**

Create `src/services/shoutouts.test.js`:

```js
'use strict';

// The Shoutouts card's behaviour (services/shoutouts.js) with fakes for Twitch's lookups, the chat bot and the
// database, and a clock the tests move: who may use !so, the line, the raid minimum, the one-a-minute rule and the
// 10-minute memory of each name. All names and ids are synthetic.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createShoutouts, isShoutoutCommand, shoutoutLine, RAID_MIN_VIEWERS } = require('./shoutouts');

const NOW = Date.parse('2026-10-15T20:00:00Z');
const TEMPLATE = 'Go check out {name}! They were last streaming {game}: {link}';
const OTHER_LINE = 'Go check out OtherStreamer! They were last streaming iRacing: https://twitch.tv/otherstreamer';

function setup({ streamer = {} } = {}) {
  const world = {
    t: NOW, said: [], lookups: [], logged: [], failing: false,
    streamer: { id: 7, twitch_username: 'mychannel', shoutout_command_enabled: 1, shoutout_raid_enabled: 1, shoutout_raid_min_viewers: 5, shoutout_template: TEMPLATE, ...streamer },
    channels: {
      otherstreamer: { login: 'otherstreamer', name: 'OtherStreamer', game: 'iRacing', title: 'Endurance night' },
      mychannel: { login: 'mychannel', name: 'MyChannel', game: 'Assetto Corsa', title: 'Hotlaps' },
    },
  };
  world.so = createShoutouts({
    lookup: async (login) => {
      world.lookups.push(login);
      if (world.failing) throw new Error('Twitch API error: 503');
      return world.channels[login] || null;
    },
    send: (streamerId, text, priority) => world.said.push({ streamerId, text, priority }),
    getStreamer: () => world.streamer,
    log: (line) => world.logged.push(line),
    now: () => world.t,
  });
  return world;
}
const mod = { username: 'somemod', mod: true, badges: { moderator: '1' } };
const broadcaster = { username: 'mychannel', mod: false, badges: { broadcaster: '1' } };
const viewer = { username: 'viewer', mod: false, badges: { subscriber: '1' } };

describe('who may use !so', () => {
  test('the broadcaster and moderators, while the switch is on; anything else is not a shoutout', () => {
    const on = { shoutout_command_enabled: 1 };
    assert.equal(isShoutoutCommand(on, mod, '!so @OtherStreamer'), true);
    assert.equal(isShoutoutCommand(on, broadcaster, '!SO otherstreamer'), true);
    assert.equal(isShoutoutCommand(on, { username: 'm', badges: { moderator: '1' } }, '!so x'), true);
    assert.equal(isShoutoutCommand(on, viewer, '!so @OtherStreamer'), false);
    assert.equal(isShoutoutCommand({ shoutout_command_enabled: 0 }, mod, '!so @OtherStreamer'), false);
    assert.equal(isShoutoutCommand(on, mod, '!socials'), false);
    assert.equal(isShoutoutCommand(on, mod, 'hello !so x'), false);
    assert.equal(isShoutoutCommand(null, mod, '!so x'), false);
  });
});

describe('the line', () => {
  test('the name, the game, the title and the link; a channel that never streamed has an empty game', () => {
    assert.equal(shoutoutLine(TEMPLATE, { login: 'otherstreamer', name: 'OtherStreamer', game: 'iRacing', title: 'x' }), OTHER_LINE);
    assert.equal(shoutoutLine('{name} plays {game}', { login: 'newcomer', name: 'Newcomer', game: '', title: '' }), 'Newcomer plays');
    assert.equal(shoutoutLine('', { login: 'a', name: 'A', game: '', title: '' }), '');
  });

  test('a title or game from Twitch never starts a command', () => {
    assert.equal(shoutoutLine('{title}', { login: 'a', name: 'A', game: '', title: '/ban everyone' }), 'ban everyone');
  });

  test('the raid minimum offers the card\'s choices', () => {
    assert.deepEqual(RAID_MIN_VIEWERS, [1, 2, 5, 10, 25, 50, 100]);
  });
});

describe('!so', () => {
  test('posts the line for the named channel at command priority; @, capitals and a pasted link name the same channel', async () => {
    const w = setup();
    await w.so.fromCommand(w.streamer, '!so @OtherStreamer');
    assert.deepEqual(w.said, [{ streamerId: 7, text: OTHER_LINE, priority: 'high' }]);
    w.t += 60000;
    await w.so.fromCommand(w.streamer, '!so https://www.twitch.tv/otherstreamer');
    assert.equal(w.said.length, 2);
  });

  test('an unknown name, or no name, posts nothing; the unknown one is logged', async () => {
    const w = setup();
    await w.so.fromCommand(w.streamer, '!so @nobody_here');
    await w.so.fromCommand(w.streamer, '!so');
    await w.so.fromCommand(w.streamer, '!so ###');
    assert.deepEqual(w.said, []);
    assert.equal(w.logged.length, 1);
    assert.match(w.logged[0], /nobody_here/);
  });

  test('the same person at most once a minute per channel: a raid shoutout and a moderator\'s !so for the raider are one line', async () => {
    const w = setup();
    await w.so.afterRaid(7, { login: 'otherstreamer', viewers: 12 });
    await w.so.fromCommand(w.streamer, '!so @otherstreamer');
    assert.equal(w.said.length, 1);
    w.t += 59999;
    await w.so.fromCommand(w.streamer, '!so @otherstreamer');
    assert.equal(w.said.length, 1);
    w.t += 1;
    await w.so.fromCommand(w.streamer, '!so @otherstreamer');
    assert.equal(w.said.length, 2);
    await w.so.fromCommand({ ...w.streamer, id: 8 }, '!so @otherstreamer');
    assert.equal(w.said.length, 3, 'another channel has its own minute');
  });

  test('two !so for the same person at once post one line; a lookup that fails posts nothing and frees the minute', async () => {
    const w = setup();
    await Promise.all([w.so.fromCommand(w.streamer, '!so otherstreamer'), w.so.fromCommand(w.streamer, '!so otherstreamer')]);
    assert.equal(w.said.length, 1);
    const f = setup();
    f.failing = true;
    assert.equal(await f.so.fromCommand(f.streamer, '!so otherstreamer'), 'failed');
    assert.deepEqual(f.said, []);
    f.failing = false;
    await f.so.fromCommand(f.streamer, '!so otherstreamer');
    assert.equal(f.said.length, 1);
  });

  test('each name\'s answer from Twitch is kept 10 minutes', async () => {
    const w = setup();
    await w.so.fromCommand(w.streamer, '!so otherstreamer');
    w.t += 60000;
    await w.so.fromCommand(w.streamer, '!so otherstreamer');
    assert.deepEqual(w.lookups, ['otherstreamer']);
    w.t += 9 * 60000;
    await w.so.fromCommand(w.streamer, '!so otherstreamer');
    assert.deepEqual(w.lookups, ['otherstreamer', 'otherstreamer']);
  });
});

describe('after a raid', () => {
  test('a raid of at least the minimum gets a shoutout for the raider at normal priority', async () => {
    const w = setup();
    assert.equal(await w.so.afterRaid(7, { login: 'otherstreamer', username: 'OtherStreamer', viewers: 5 }), 'sent');
    assert.deepEqual(w.said, [{ streamerId: 7, text: OTHER_LINE, priority: 'normal' }]);
  });

  test('a smaller raid, the switch off, or a raid without the raider\'s login posts nothing and asks Twitch nothing', async () => {
    const small = setup();
    await small.so.afterRaid(7, { login: 'otherstreamer', viewers: 4 });
    const off = setup({ streamer: { shoutout_raid_enabled: 0 } });
    await off.so.afterRaid(7, { login: 'otherstreamer', viewers: 50 });
    const nameless = setup();
    await nameless.so.afterRaid(7, { viewers: 50 });
    assert.deepEqual([...small.said, ...off.said, ...nameless.said], []);
    assert.deepEqual([...small.lookups, ...off.lookups, ...nameless.lookups], []);
  });

  test('the !so switch does not matter for raids', async () => {
    const w = setup({ streamer: { shoutout_command_enabled: 0 } });
    await w.so.afterRaid(7, { login: 'otherstreamer', viewers: 5 });
    assert.equal(w.said.length, 1);
  });
});

describe('Test in chat', () => {
  test('a shoutout for the streamer\'s own channel with the saved text, twice in a row', async () => {
    const w = setup();
    assert.equal(await w.so.testInChat(w.streamer), 'sent');
    assert.equal(await w.so.testInChat(w.streamer), 'sent');
    const line = 'Go check out MyChannel! They were last streaming Assetto Corsa: https://twitch.tv/mychannel';
    assert.deepEqual(w.said.map((s) => [s.text, s.priority]), [[line, 'high'], [line, 'high']]);
  });

  test('an own channel Twitch does not know, or a lookup that fails, says so', async () => {
    const w = setup({ streamer: { twitch_username: 'renamed_away' } });
    assert.equal(await w.so.testInChat(w.streamer), 'unknown');
    const f = setup();
    f.failing = true;
    assert.equal(await f.so.testInChat(f.streamer), 'failed');
    assert.deepEqual([...w.said, ...f.said], []);
  });
});

describe('memory', () => {
  test('a shoutout is forgotten after its minute and a name after 10 minutes', async () => {
    const w = setup();
    await w.so.fromCommand(w.streamer, '!so otherstreamer');
    assert.deepEqual(w.so.size, { names: 1, shoutouts: 1 });
    w.t += 60000;
    w.so.sweep();
    assert.deepEqual(w.so.size, { names: 1, shoutouts: 0 });
    w.t += 9 * 60000;
    w.so.sweep();
    assert.deepEqual(w.so.size, { names: 0, shoutouts: 0 });
  });
});
```

Run: `node --test src/services/shoutouts.test.js` — Expected: FAIL (`Cannot find module './shoutouts'`).

Create `src/services/shoutouts.js`:

```js
'use strict';

// The Shoutouts card: `!so @name` typed by the broadcaster or a moderator, and a shoutout for the raider after a raid
// of at least the streamer's minimum. The bot posts the streamer's text with the person's display name, last game,
// title and link (Twitch's Get Users and Get Channel Information with the app token; each name's answer is kept 10
// minutes). The same person gets at most one shoutout a minute per channel; an unknown name posts nothing (logged).
// `!so` posts at command priority and the raid shoutout at normal priority, through the chat dispatcher, which posts
// nothing while the streamer's chatbot is off.

const { normalizeTwitchLogin } = require('./twitchLogin');
const { fillChatTemplate } = require('./chatTemplate');

const COOLDOWN_MS = 60 * 1000;
const NAME_KEPT_MS = 10 * 60 * 1000;
const SWEEP_EVERY_MS = 10 * 60 * 1000;
// The card's "from N viewers" choices (dashboardSettings.js accepts only these).
const RAID_MIN_VIEWERS = Object.freeze([1, 2, 5, 10, 25, 50, 100]);

// Whether a chat message is a `!so` this streamer's bot acts on: the switch on, from the broadcaster or a moderator
// (by their badges). Anything else goes on to the other commands, so a custom !so keeps answering everyone else.
function isShoutoutCommand(streamer, tags, message) {
  if (!streamer || !streamer.shoutout_command_enabled || !tags) return false;
  const badges = tags.badges || {};
  if (!(tags.mod || badges.broadcaster || badges.moderator)) return false;
  return /^!so(\s|$)/i.test(String(message || '').trim());
}

// The streamer's text for one channel ({ login, name, game, title }); '' when it posts nothing.
function shoutoutLine(template, channel) {
  return fillChatTemplate(template, {
    name: channel.name, game: channel.game, title: channel.title, link: `https://twitch.tv/${channel.login}`,
  });
}

function createShoutouts({ lookup, send, getStreamer, log = console.warn, now = Date.now }) {
  const names = new Map(); // login → { at, channel } (channel null: Twitch has no such channel)
  const shoutedAt = new Map(); // `${streamerId}:${login}` → when its shoutout was posted (or started)

  async function channelFor(login) {
    const kept = names.get(login);
    if (kept && now() - kept.at < NAME_KEPT_MS) return kept.channel;
    const channel = (await lookup(login)) || null;
    names.set(login, { at: now(), channel });
    return channel;
  }

  // A test skips the one-a-minute rule and does not count toward it.
  async function shout(streamer, login, priority, { isTest = false } = {}) {
    const key = `${streamer.id}:${login}`;
    if (!isTest) {
      const last = shoutedAt.get(key);
      if (last !== undefined && now() - last < COOLDOWN_MS) return 'cooldown';
      shoutedAt.set(key, now()); // taken before the lookup, so a second !so meanwhile is refused too
    }
    let channel;
    try {
      channel = await channelFor(login);
    } catch (err) {
      if (!isTest) shoutedAt.delete(key);
      log(`[Shoutout] Twitch did not answer for "${login}" (streamer ${streamer.id}): ${err.message}`);
      return 'failed';
    }
    if (!channel) {
      if (!isTest) shoutedAt.delete(key);
      log(`[Shoutout] Twitch has no channel "${login}" (streamer ${streamer.id})`);
      return 'unknown';
    }
    const text = shoutoutLine(streamer.shoutout_template, channel);
    if (!text) return 'empty';
    send(streamer.id, text, priority);
    return 'sent';
  }

  // A `!so` that isShoutoutCommand let through: the first word after it names the channel.
  async function fromCommand(streamer, message) {
    const login = normalizeTwitchLogin(String(message || '').trim().split(/\s+/)[1] || '');
    if (!login) return 'no_name';
    return shout(streamer, login, 'high');
  }

  // EventSub's raid ({ login, viewers, … }): a shoutout for the raider when the streamer has it on and the raid
  // brought at least their minimum of viewers.
  async function afterRaid(streamerId, raid) {
    const streamer = getStreamer(streamerId);
    if (!streamer || !streamer.shoutout_raid_enabled) return 'off';
    const minimum = Number(streamer.shoutout_raid_min_viewers) || 1;
    if (!(Number(raid && raid.viewers) >= minimum)) return 'small';
    const login = normalizeTwitchLogin((raid && raid.login) || '');
    if (!login) return 'no_name';
    return shout(streamer, login, 'normal');
  }

  // The card's Test in chat: a shoutout for the streamer's own channel.
  async function testInChat(streamer) {
    const login = normalizeTwitchLogin(streamer.twitch_username || '');
    if (!login) return 'unknown';
    return shout(streamer, login, 'high', { isTest: true });
  }

  function sweep() {
    const t = now();
    for (const [login, kept] of names) if (t - kept.at >= NAME_KEPT_MS) names.delete(login);
    for (const [key, at] of shoutedAt) if (t - at >= COOLDOWN_MS) shoutedAt.delete(key);
  }

  return {
    fromCommand, afterRaid, testInChat, sweep,
    get size() { return { names: names.size, shoutouts: shoutedAt.size }; },
  };
}

// The app's instance. Twitch, the chat bot and the database are required when first used: they load the app's
// config, which this file's unit tests do without.
const shoutouts = createShoutouts({
  lookup: async (login) => {
    const twitch = require('./twitch');
    const user = await twitch.getUserProfile(login);
    if (!user) return null;
    const info = await twitch.getChannelInfo(user.id);
    return { login: user.login, name: user.display_name || user.login, game: (info && info.gameName) || '', title: (info && info.title) || '' };
  },
  send: (streamerId, text, priority) => require('./twitchChat').chatManager.sendMessage(streamerId, text, { priority }),
  getStreamer: (streamerId) => require('../db').getStreamerById(streamerId),
});
setInterval(() => shoutouts.sweep(), SWEEP_EVERY_MS).unref();

module.exports = { createShoutouts, shoutouts, isShoutoutCommand, shoutoutLine, RAID_MIN_VIEWERS, COOLDOWN_MS };
```

Run: `node --test src/services/shoutouts.test.js` — Expected: PASS.

- [ ] **Step 2: `!so` in chat, test first**

In `src/services/twitchChat.test.js`, right after the line `stubModule('./giveawayManager', { tryAddEntry: () => false });`, add:

```js
// !so goes to the shoutouts, whose lookups would reach Twitch: the real check of who may use it, a recording fromCommand.
const { isShoutoutCommand } = require('./shoutouts');
const shoutoutCalls = [];
stubModule('./shoutouts', { isShoutoutCommand, shoutouts: { fromCommand: async (s, message) => { shoutoutCalls.push([s.id, message]); return 'sent'; } } });
```

In its `beforeEach`, after `chatCommands = {};`, add `shoutoutCalls.length = 0;`. At the end of the file, add:

```js
// ── !so (the Shoutouts card) ─────────────────────────────────────────

describe('!so in chat', () => {
  const command = (name, response) => ({ id: 1, command: name, response, cooldown: 5, enabled: 1 });

  test('a moderator\'s or the broadcaster\'s !so goes to the shoutouts while the switch is on, and nothing else answers it', async () => {
    streamer = streamerRow({ shoutout_command_enabled: 1 });
    chatCommands = { so: command('so', 'A custom so') };
    await chat('!so @OtherStreamer', tags({ username: 'somemod', mod: true }));
    await chat('!so otherstreamer', tags({ username: 'somestreamer', badges: { broadcaster: '1' }, id: 'msg-2' }));
    assert.deepEqual(shoutoutCalls, [[1, '!so @OtherStreamer'], [1, '!so otherstreamer']]);
    assert.deepEqual(tmiClient.said, []);
  });

  test('a viewer\'s !so is an ordinary command', async () => {
    chatClock.advance(1_500); // the bot's own gap between two lines in one chat
    streamer = streamerRow({ shoutout_command_enabled: 1 });
    chatCommands = { so: command('so', 'A custom so') };
    await chat('!so @OtherStreamer', tags());
    assert.deepEqual(shoutoutCalls, []);
    assert.deepEqual(tmiClient.said.map((m) => m.text), ['A custom so']);
  });

  test('with the switch off, a moderator\'s !so is not a shoutout', async () => {
    streamer = streamerRow({ shoutout_command_enabled: 0 });
    await chat('!so @OtherStreamer', tags({ username: 'somemod', mod: true }));
    assert.deepEqual(shoutoutCalls, []);
  });
});
```

Run: `node --test src/services/twitchChat.test.js` — Expected: the first new test FAILS (nothing reaches the shoutouts, and the custom `!so` answers).

In `src/services/twitchChat.js`, after `const { createChatDispatcher } = require('./chatDispatcher');` add `const { shoutouts, isShoutoutCommand } = require('./shoutouts');`, and right after the line `if (await handleModCommand(replies, channel, tags, message, streamer)) return;` add:

```js
  // !so @name from the broadcaster or a moderator while the Shoutouts card's switch is on (services/shoutouts.js).
  // Twitch's lookup is not waited for here; a viewer's !so goes on to the other commands.
  if (isShoutoutCommand(streamer, tags, message)) {
    shoutouts.fromCommand(streamer, message)
      .catch((err) => console.error(`[Shoutout] !so failed for streamer ${streamer.id}:`, err.message));
    return;
  }
```

Run: `node --test src/services/twitchChat.test.js` — Expected: PASS.

- [ ] **Step 3: The raid shoutout, test first**

In `src/services/eventsub.test.js` (as Task 5 left it):
- the `effects` line becomes `const effects = { overlay: [], overlayLog: [], chat: [], raidProtection: [], redemptions: [], polls: [], shoutouts: [] };`;
- in `stubs`, add `'./shoutouts': { shoutouts: { afterRaid: async (streamerId, raid) => { effects.shoutouts.push([streamerId, raid]); return 'sent'; } } },`;
- inside `describe('a raid', …)`, add:

```js
  test('the raider goes to the shoutouts, with their login and id, once', async () => {
    const socket = await connected();
    const raid = notification('channel.raid', {
      from_broadcaster_user_id: '9002', from_broadcaster_user_login: 'raider', from_broadcaster_user_name: 'Raider', viewers: 42,
    }, 'synthetic-message-10');
    socket.receive(raid);
    socket.receive(raid);
    assert.deepEqual(effects.shoutouts, [[1, { username: 'Raider', viewers: 42, login: 'raider', userId: '9002' }]]);
  });
```

Run: `node --test src/services/eventsub.test.js` — Expected: the new test FAILS.

In `src/services/eventsub.js`:
- after `const { livePolls } = require('./livePolls');` add `const { shoutouts } = require('./shoutouts');`;
- in `normalizeEvent`, the `channel.raid` case's data becomes `{ username: event.from_broadcaster_user_name, viewers: event.viewers, login: event.from_broadcaster_user_login, userId: event.from_broadcaster_user_id }`;
- in `handleNotification`, the line `if (normalized.type === 'raid') chatManager.startRaidProtection(this.streamerId);` becomes:

```js
    if (normalized.type === 'raid') {
      chatManager.startRaidProtection(this.streamerId);
      // The Shoutouts card's raid shoutout: after the thank-you above (it waits for Twitch's lookup of the raider).
      shoutouts.afterRaid(this.streamerId, normalized.data)
        .catch((err) => console.error(`[Shoutout] Raid shoutout failed for streamer ${this.streamerId}:`, err.message));
    }
```

Run: `node --test src/services/eventsub.test.js` — Expected: PASS.

- [ ] **Step 4: The card's Test in chat, test first**

Write `/tmp/shoutouts-task6-keys.json` (outside the repository):

```json
{
  "cards.shoutouts.error.unknown": "Twitch has no channel with the name linked to your account."
}
```

Run: `node scripts/locale-keys.js add /tmp/shoutouts-task6-keys.json`.

In `src/routes/dashboard.test.js`:
- after the `chatStub` declaration add:

```js
// The Shoutouts card's test line (its lookups would reach Twitch); `answer` is what testInChat resolves to.
const shoutoutTests = [];
const shoutoutsStub = { answer: 'sent', shoutouts: { testInChat: async (s) => { shoutoutTests.push(s.id); return shoutoutsStub.answer; } } };
```

- in the `Module._load` block `if (from === DASHBOARD_FILE) { … }`, add `if (request === '../services/shoutouts') return shoutoutsStub;`;
- in the file's `beforeEach`, add `shoutoutTests.length = 0;` and `shoutoutsStub.answer = 'sent';`;
- at the end of the file, add:

```js
describe('the Shoutouts card\'s Test in chat', () => {
  const testShout = (id) => request('POST', '/dashboard/shoutouts/test', { streamer: id });

  test('shouts out the streamer\'s own channel with the saved text', async () => {
    const id = addStreamer({ chatbot_enabled: 1, twitch_username: 'mychannel' });
    const res = await testShout(id);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { ok: true });
    assert.deepEqual(shoutoutTests, [id]);
  });

  test('refused with the reason before the shared cooldown: the chatbot off, or no text', async () => {
    const off = await testShout(addStreamer({ chatbot_enabled: 0 }));
    assert.equal(off.status, 409);
    assert.deepEqual(off.json(), { ok: false, code: 'chatbot_off', error: t('en', 'chatbot.test.chatbotOff') });
    const id = addStreamer({ chatbot_enabled: 1, shoutout_template: '   ' });
    const empty = await testShout(id);
    assert.equal(empty.status, 409);
    assert.deepEqual(empty.json(), { ok: false, code: 'no_message', error: t('en', 'chatbot.test.noMessage') });
    assert.deepEqual(shoutoutTests, []);
    db.updateShoutoutSettings(id, { shoutout_template: 'Check out {name}' });
    assert.equal((await testShout(id)).status, 200, 'the refusals did not start the cooldown');
  });

  test('a channel Twitch does not know, or no answer from Twitch, is said', async () => {
    shoutoutsStub.answer = 'unknown';
    const unknown = await testShout(addStreamer({ chatbot_enabled: 1 }));
    assert.equal(unknown.status, 404);
    assert.deepEqual(unknown.json(), { ok: false, code: 'not_found', error: t('en', 'cards.shoutouts.error.unknown') });
    shoutoutsStub.answer = 'failed';
    const failed = await testShout(addStreamer({ chatbot_enabled: 1 }));
    assert.equal(failed.status, 502);
    assert.deepEqual(failed.json(), { ok: false, code: 'twitch_failed', error: t('en', 'cards.polls.error.twitchFailed') });
  });
});
```

Run: `node --test src/routes/dashboard.test.js` — Expected: the three new tests FAIL (404 from the router).

In `src/routes/dashboard.js`, right after the route `router.post('/chatbot/check-moderator', …)`, add:

```js
// The Shoutouts card's Test in chat: a shoutout for the streamer's own channel with the saved text (it skips the
// one-a-minute rule, so a second test works). A test that would post nothing is refused with the reason before the
// shared cooldown starts, like the thank-you tests.
function shoutoutTestReady(req, res, next) {
  if (String(req.streamer.shoutout_template || '').trim()) return next();
  res.status(409).json({ ok: false, code: 'no_message', error: res.locals.t('chatbot.test.noMessage') });
}

const SHOUTOUT_TEST_REFUSALS = Object.freeze({
  unknown: { status: 404, code: 'not_found', text: 'cards.shoutouts.error.unknown' },
  empty: { status: 409, code: 'no_message', text: 'chatbot.test.noMessage' },
  failed: { status: 502, code: 'twitch_failed', text: 'cards.polls.error.twitchFailed' },
});

router.post('/shoutouts/test', chatbotOnForTest, shoutoutTestReady, limitTests, async (req, res) => {
  const { shoutouts } = require('../services/shoutouts');
  const outcome = await shoutouts.testInChat(req.streamer);
  if (outcome === 'sent') return res.json({ ok: true });
  const refusal = SHOUTOUT_TEST_REFUSALS[outcome] || SHOUTOUT_TEST_REFUSALS.failed;
  res.status(refusal.status).json({ ok: false, code: refusal.code, error: res.locals.t(refusal.text) });
});
```

Run: `node --test src/routes/dashboard.test.js tests/i18n.test.js` — Expected: PASS.

- [ ] **Step 5: The full suite, then commit**

Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` — Expected: PASS.

```bash
git add src/services/shoutouts.js src/services/shoutouts.test.js src/services/twitchChat.js src/services/twitchChat.test.js src/services/eventsub.js src/services/eventsub.test.js src/routes/dashboard.js src/routes/dashboard.test.js src/locales/en.json src/locales/pt.json src/locales/es.json src/locales/fr.json src/locales/de.json src/locales/zh.json src/locales/ja.json
git commit -m "feat(shoutouts): !so for moderators, a shoutout after a raid, and the card's test line"
```

---

### Task 7: The cards' settings through `POST /dashboard/settings`

**Files:**
- Modify: `src/services/dashboardSettings.js`, `src/services/dashboardSettings.test.js`
- Modify: `src/routes/dashboard.test.js`

**Interfaces:**
- Consumes: `pollRules.CHAT_TEXTS` (Task 1: the six text columns); `RAID_MIN_VIEWERS` (Task 6); `db.updatePollSettings` and `db.updateShoutoutSettings` (Task 2).
- Produces: eleven keys accepted by `POST /dashboard/settings` (68 in all): `polls_chat_enabled` (switch) and the six poll and prediction texts (up to 500 characters; an empty text is stored as `''` and posts nothing), written by the writer `polls`; `shoutout_command_enabled`, `shoutout_raid_enabled` (switches), `shoutout_raid_min_viewers` (one of `RAID_MIN_VIEWERS`, the new kind `choice`) and `shoutout_template` (required, up to 500), written by the writer `shoutouts`. None needs anything first or starts a follow-up.

- [ ] **Step 1: Write the failing tests**

In `src/services/dashboardSettings.test.js`:
- in `fakeDb`, after `updateDonationSettings: recordInto('updateDonationSettings'),` add `updatePollSettings: recordInto('updatePollSettings'),` and `updateShoutoutSettings: recordInto('updateShoutoutSettings'),`;
- the test name `'are exactly these 57 keys'` becomes `'are exactly these 68 keys'`, and in its list the line `'overlay_sub_duration', 'overlay_sub_enabled', 'overlay_volume', 'recap_enabled',` becomes:

```js
      'overlay_sub_duration', 'overlay_sub_enabled', 'overlay_volume', 'poll_end_template', 'poll_start_template',
      'polls_chat_enabled', 'prediction_cancel_template', 'prediction_end_template', 'prediction_lock_template',
      'prediction_start_template', 'recap_enabled', 'shoutout_command_enabled', 'shoutout_raid_enabled',
      'shoutout_raid_min_viewers', 'shoutout_template',
```

- at the end of the file, add:

```js
describe('the Polls & predictions and Shoutouts cards', () => {
  test('the announcements switch and the six texts go to the polls writer; a text may be emptied (that moment posts nothing)', () => {
    const { result, writes } = run({ changes: [
      { key: 'polls_chat_enabled', value: false },
      { key: 'poll_start_template', value: '  Vote: {title}  ' },
      { key: 'prediction_cancel_template', value: '' },
    ] });
    assert.deepEqual(result, { ok: true, values: { polls_chat_enabled: 0, poll_start_template: 'Vote: {title}', prediction_cancel_template: '' } });
    assert.deepEqual(writes, [
      ['updatePollSettings', 1, { polls_chat_enabled: 0 }],
      ['updatePollSettings', 1, { poll_start_template: 'Vote: {title}' }],
      ['updatePollSettings', 1, { prediction_cancel_template: '' }],
    ]);
    assert.equal(run({ key: 'poll_end_template', value: 'x'.repeat(501) }).result.code, 'too_long');
    assert.equal(run({ key: 'poll_end_template', value: 42 }).result.code, 'invalid');
  });

  test('the shoutout switches, the raid minimum (one of the card\'s choices) and the text go to the shoutouts writer', () => {
    const { result, writes } = run({ changes: [
      { key: 'shoutout_command_enabled', value: true },
      { key: 'shoutout_raid_enabled', value: '1' },
      { key: 'shoutout_raid_min_viewers', value: '25' },
      { key: 'shoutout_template', value: 'Check out {name}: {link}' },
    ] });
    assert.deepEqual(result.values, { shoutout_command_enabled: 1, shoutout_raid_enabled: 1, shoutout_raid_min_viewers: 25, shoutout_template: 'Check out {name}: {link}' });
    assert.deepEqual(writes.map(([name]) => name), ['updateShoutoutSettings', 'updateShoutoutSettings', 'updateShoutoutSettings', 'updateShoutoutSettings']);
    for (const value of [3, 0, -1, 1000, '5.5', 'many', '', null]) {
      assert.equal(run({ key: 'shoutout_raid_min_viewers', value }).result.code, 'invalid', JSON.stringify(value));
    }
    assert.equal(run({ key: 'shoutout_template', value: '   ' }).result.code, 'required', 'the shoutout always has a text');
  });

  test('none of them needs anything first or starts a follow-up', () => {
    const { followUps } = run({ changes: [{ key: 'polls_chat_enabled', value: true }, { key: 'shoutout_raid_enabled', value: true }] });
    assert.deepEqual([...followUps[0].steps], []);
  });
});
```

In `src/routes/dashboard.test.js`, inside `describe('a working card\'s switch (POST /dashboard/settings)', …)` (it has the `save(id, body)` helper), add:

```js
  test('the Polls & predictions and Shoutouts settings reach their columns', async () => {
    const id = addStreamer();
    const res = await save(id, { changes: [
      { key: 'polls_chat_enabled', value: 0 },
      { key: 'poll_end_template', value: '' },
      { key: 'shoutout_raid_min_viewers', value: 10 },
      { key: 'shoutout_template', value: 'Follow {name}' },
    ] });
    assert.equal(res.status, 200);
    const row = db.getStreamerById(id);
    assert.deepEqual([row.polls_chat_enabled, row.poll_end_template, row.shoutout_raid_min_viewers, row.shoutout_template], [0, '', 10, 'Follow {name}']);
  });
```

Run: `node --test src/services/dashboardSettings.test.js src/routes/dashboard.test.js` — Expected: FAIL (the keys are refused as `invalid`).

- [ ] **Step 2: The eleven keys**

In `src/services/dashboardSettings.js`:
- at the end of the header comment, add the line `// Kinds: 'switch', 'int' and 'number' (min to max), 'choice' (one of its choices), 'text' (trimmed, up to max; empty only with allowEmpty).`;
- after `const { DURATIONS } = require('./overlaySettings');` add:

```js
const { CHAT_TEXTS: POLL_TEXTS } = require('./pollRules');
const { RAID_MIN_VIEWERS } = require('./shoutouts');
```

- in `SETTINGS`, after the `sponsor_message_enabled` entry, add:

```js
  // The Polls & predictions card: a poll or prediction text left empty posts nothing for that moment.
  polls_chat_enabled: Object.freeze({ kind: 'switch', writer: 'polls' }),
  ...entries(POLL_TEXTS.map((text) => text.key), { kind: 'text', max: TEMPLATE_MAX, allowEmpty: true, writer: 'polls' }),
  // The Shoutouts card.
  shoutout_command_enabled: Object.freeze({ kind: 'switch', writer: 'shoutouts' }),
  shoutout_raid_enabled: Object.freeze({ kind: 'switch', writer: 'shoutouts' }),
  shoutout_raid_min_viewers: Object.freeze({ kind: 'choice', choices: RAID_MIN_VIEWERS, writer: 'shoutouts' }),
  shoutout_template: Object.freeze({ kind: 'text', max: TEMPLATE_MAX, writer: 'shoutouts' }),
```

- in `readValue`, right before the line `if (typeof raw !== 'string') return { error: 'invalid' };`, add:

```js
  if (setting.kind === 'choice') {
    const n = isNumberLike(raw) ? Number(raw) : NaN;
    return setting.choices.includes(n) ? { value: n } : { error: 'invalid' };
  }
```

  and the line `if (!text) return { error: 'required' };` becomes `if (!text) return setting.allowEmpty ? { value: '' } : { error: 'required' };`;
- in `write`, before `default:`, add:

```js
    case 'polls': return db.updatePollSettings(streamerId, { [key]: value });
    case 'shoutouts': return db.updateShoutoutSettings(streamerId, { [key]: value });
```

Run: `node --test src/services/dashboardSettings.test.js src/routes/dashboard.test.js` — Expected: PASS.

- [ ] **Step 3: The full suite, then commit**

Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` — Expected: PASS.

```bash
git add src/services/dashboardSettings.js src/services/dashboardSettings.test.js src/routes/dashboard.test.js
git commit -m "feat(polls): the polls and shoutouts settings save through the working cards' settings route"
```

---

### Task 8: The card's JSON routes (`routes/polls.js`)

**Files:**
- Create: `src/routes/polls.js`, `src/routes/polls.test.js`
- Modify: `src/routes/dashboard.js` (mount it), `src/routes/dashboard.test.js`

**Interfaces:**
- Consumes: `pollRules.checkPollInput/ERRORS/errorParams/TEMPLATES_MAX` (Task 1); the template functions and `db.updateStreamerCpSync` (Task 2); `twitchPolls.*` and `PollsError` (Task 3); `livePolls.setFromTwitch/snapshot/live` (Task 4); `hasPollsScope` (Task 3).
- Produces (all under `/dashboard`, JSON, `{ ok: true, … }` or `{ ok: false, code, error }`):
  - `POST /api/poll-templates` (201 `{ template }`), `PATCH /api/poll-templates/:id` (only the fields given change; `{ template }`), `DELETE /api/poll-templates/:id`;
  - `POST /api/polls/start` with `{ templateId }` or a one-off's fields; `POST /api/polls/end` `{ id }`; `POST /api/predictions/lock` `{ id }`; `POST /api/predictions/resolve` `{ id, outcomeId }`; `POST /api/predictions/cancel` `{ id }` — each answers `{ ok: true, live: { poll, prediction, serverNow } }`;
  - `GET /api/polls/live` → `{ ok: true, poll, prediction, serverNow }`;
  - `POST /api/polls/affiliate-check` → `{ ok: true }` (clears the stored not-affiliate flag).
- The Twitch buttons and the live view answer `needs_reconnect` (409) without asking Twitch while the stored scopes lack the two permissions; a start of a kind already running (or already being started) answers `running` (409) without asking Twitch.

**Ruling recorded here:** the spec's "not an Affiliate or Partner: no actions" state gets one action, **Check again** (`affiliate-check`): the flag is only ever set by Twitch's refusal and nothing else clears it, so a channel that becomes an Affiliate later would otherwise never see the card again. It asks Twitch nothing; the next start finds out.

- [ ] **Step 1: Write the failing tests**

Create `src/routes/polls.test.js`:

```js
'use strict';

// The Polls & predictions card's JSON routes (routes/polls.js) on an in-memory database, with a fake Twitch in place
// of twitchPolls and a real livePolls around fakes: the templates (a streamer's own only, Twitch's limits, at most 20),
// the buttons that start, end, lock, resolve and cancel, what the card gets back, and the refusals with their texts.
// Nothing reaches Twitch. All ids, names and tokens are synthetic.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const Module = require('module');
const express = require('express');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) {
  process.env[key] = process.env[key] || 'test';
}

const SRC = path.join(__dirname, '..');
const DB_FILE = path.join(SRC, 'db.js');
const POLLS_FILE = path.join(__dirname, 'polls.js');
const iso = (ms) => new Date(ms).toISOString();

// ── A fake Twitch in place of services/twitchPolls.js ────────────────────

class PollsError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const helix = { calls: [], refuse: null, hold: null };
async function answer(name, args, result) {
  helix.calls.push([name, ...args]);
  if (helix.hold) await helix.hold;
  if (helix.refuse) throw new PollsError(helix.refuse);
  return result;
}
const pollOf = (value, over = {}) => ({
  id: 'poll-1', title: value.title, status: 'ACTIVE', duration: value.durationSeconds, started_at: iso(Date.now()),
  choices: value.choices.map((title, i) => ({ id: `c${i + 1}`, title, votes: 0 })), ...over,
});
const predictionOf = (value, over = {}) => ({
  id: 'pred-1', title: value.title, status: 'ACTIVE', prediction_window: value.durationSeconds, created_at: iso(Date.now()),
  outcomes: value.choices.map((title, i) => ({ id: `o${i + 1}`, title, users: 0, channel_points: 0, color: i ? 'PINK' : 'BLUE' })), ...over,
});
const LAP = { title: 'Clean lap?', durationSeconds: 60, choices: ['Clean', 'Chaos'] };
const twitchPollsStub = {
  PollsError,
  createPoll: (s, value) => answer('createPoll', [s.id, value], pollOf(value)),
  createPrediction: (s, value) => answer('createPrediction', [s.id, value], predictionOf(value)),
  endPoll: (s, id) => answer('endPoll', [s.id, id], pollOf({ title: 'Top 5?', durationSeconds: 60, choices: ['Yes', 'No'] }, { id, status: 'TERMINATED', ended_at: iso(Date.now()) })),
  lockPrediction: (s, id) => answer('lockPrediction', [s.id, id], predictionOf(LAP, { id, status: 'LOCKED', locked_at: iso(Date.now()) })),
  resolvePrediction: (s, id, outcomeId) => answer('resolvePrediction', [s.id, id, outcomeId], predictionOf(LAP, { id, status: 'RESOLVED', winning_outcome_id: outcomeId, ended_at: iso(Date.now()) })),
  cancelPrediction: (s, id) => answer('cancelPrediction', [s.id, id], predictionOf(LAP, { id, status: 'CANCELED', ended_at: iso(Date.now()) })),
};
const twitchStub = {
  hasPollsScope: (s) => /channel:manage:polls/.test(s.broadcaster_scopes || '') && /channel:manage:predictions/.test(s.broadcaster_scopes || ''),
};
const said = []; // the bot's announcements: [streamerId, text]
const latest = { poll: null, prediction: null }; // what a read of Twitch finds
const livePollsStub = { livePolls: null }; // a real livePolls around fakes, made in before()

// ── App ──────────────────────────────────────────────────────────────────

let db;
let t;
let server;
let port;
const logs = [];
const saved = {};

function request(method, urlPath, { streamer, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {};
    if (streamer) headers['x-test-streamer'] = String(streamer);
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, agent: false, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

before(async () => {
  saved.load = Module._load;
  Module._load = function (request, parent, isMain) {
    const from = parent && parent.filename;
    if (from === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
    }
    if (from === POLLS_FILE) {
      if (request === '../services/twitchPolls') return twitchPollsStub;
      if (request === '../services/livePolls') return livePollsStub;
      if (request === '../services/twitch') return twitchStub;
    }
    return saved.load.call(this, request, parent, isMain);
  };
  for (const level of ['log', 'warn', 'error']) {
    saved[level] = console[level];
    console[level] = (...args) => logs.push(args.join(' '));
  }
  delete require.cache[DB_FILE];
  db = require(DB_FILE);
  ({ t } = require('../i18n'));
  const { createLivePolls } = require('../services/livePolls');
  livePollsStub.livePolls = createLivePolls({
    emit: () => {},
    send: (streamerId, text) => said.push([streamerId, text]),
    getStreamer: (id) => db.getStreamerById(id),
    fetchLatest: async () => latest,
  });
  const { requireActiveStreamer, applyAccountStatus } = require('../services/streamerAccess');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const id = Number(req.get('x-test-streamer'));
    req.streamer = id ? db.getStreamerById(id) : undefined;
    applyAccountStatus(req);
    res.locals.t = (key, params) => t('en', key, params);
    next();
  });
  app.use('/dashboard', requireActiveStreamer, require('./polls'));
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = server.address().port;
});

after(async () => {
  for (const level of ['log', 'warn', 'error']) console[level] = saved[level];
  Module._load = saved.load;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  helix.calls = [];
  helix.refuse = null;
  helix.hold = null;
  said.length = 0;
  logs.length = 0;
  latest.poll = null;
  latest.prediction = null;
});

const SCOPES = 'channel:read:subscriptions channel:manage:polls channel:manage:predictions';
let counter = 0;
function addStreamer(over = {}) {
  const n = ++counter;
  const cols = { discord_user_id: `73000000000000${String(n).padStart(4, '0')}`, discord_username: `polls${n}`, twitch_user_id: `90${n}`, broadcaster_scopes: SCOPES, ...over };
  const names = Object.keys(cols);
  return Number(db.db.prepare(`INSERT INTO streamers (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((k) => cols[k])).lastInsertRowid);
}

const poll = { kind: 'poll', title: 'Top 5 finish?', choices: ['Yes', 'No'], durationSeconds: 120, pointsPerVote: null };
const prediction = { kind: 'prediction', title: 'Clean first lap?', choices: ['Clean', 'Chaos'], durationSeconds: 60 };
const start = (id, body) => request('POST', '/dashboard/api/polls/start', { streamer: id, body });

describe('templates', () => {
  test('added, changed and deleted — a streamer\'s own only', async () => {
    const id = addStreamer();
    const added = await request('POST', '/dashboard/api/poll-templates', { streamer: id, body: poll });
    assert.equal(added.status, 201);
    const template = added.json().template;
    assert.deepEqual({ ...template, id: 0 }, { id: 0, kind: 'poll', title: 'Top 5 finish?', choices: ['Yes', 'No'], durationSeconds: 120, pointsPerVote: null, sortOrder: 1 });
    const edited = await request('PATCH', `/dashboard/api/poll-templates/${template.id}`, { streamer: id, body: { title: 'Podium?' } });
    assert.equal(edited.status, 200);
    assert.equal(edited.json().template.title, 'Podium?');
    assert.deepEqual(edited.json().template.choices, ['Yes', 'No'], 'what the edit leaves out stays');
    const other = addStreamer();
    assert.equal((await request('PATCH', `/dashboard/api/poll-templates/${template.id}`, { streamer: other, body: { title: 'x' } })).status, 404);
    assert.equal((await request('DELETE', `/dashboard/api/poll-templates/${template.id}`, { streamer: other })).status, 404);
    assert.equal((await request('DELETE', `/dashboard/api/poll-templates/${template.id}`, { streamer: id })).status, 200);
    assert.deepEqual((await request('DELETE', `/dashboard/api/poll-templates/${template.id}`, { streamer: id })).json(),
      { ok: false, code: 'not_found', error: t('en', 'dashboard.settings.error.notFound') });
  });

  test('Twitch\'s limits are checked, each with its own text; the 21st template is refused', async () => {
    const id = addStreamer();
    const add = (body) => request('POST', '/dashboard/api/poll-templates', { streamer: id, body });
    const long = await add({ ...poll, title: 'x'.repeat(61) });
    assert.equal(long.status, 400);
    assert.deepEqual(long.json(), { ok: false, code: 'title_long', error: t('en', 'cards.polls.error.titleLong', { max: 60 }) });
    assert.equal((await add({ ...prediction, title: 'x'.repeat(46) })).json().error, t('en', 'cards.polls.error.titleLong', { max: 45 }));
    assert.equal((await add({ ...poll, choices: ['a', 'b', 'c', 'd', 'e', 'f'] })).json().error, t('en', 'cards.polls.error.choicesCount', { min: 2, max: 5 }));
    assert.equal((await add({ ...prediction, durationSeconds: 20 })).json().error, t('en', 'cards.polls.error.duration', { min: 30, max: 1800 }));
    for (let i = 0; i < 20; i++) db.addPollTemplate(id, { ...poll, title: `Poll ${i}` });
    const tooMany = await add(poll);
    assert.equal(tooMany.status, 409);
    assert.deepEqual(tooMany.json(), { ok: false, code: 'too_many', error: t('en', 'cards.polls.error.tooMany', { max: 20 }) });
  });
});

describe('starting', () => {
  test('a template starts on Twitch; the card gets it back running and the bot announces it', async () => {
    const id = addStreamer();
    const template = db.addPollTemplate(id, poll);
    const res = await start(id, { templateId: template.id });
    assert.equal(res.status, 200);
    assert.deepEqual(helix.calls, [['createPoll', id, poll]]);
    assert.equal(res.json().live.poll.title, 'Top 5 finish?');
    assert.equal(res.json().live.poll.state, 'running');
    assert.deepEqual(said, [[id, 'Poll: Top 5 finish? — vote now! (2:00 to vote)']]);
  });

  test('a one-off prediction starts without being saved', async () => {
    const id = addStreamer();
    const res = await start(id, prediction);
    assert.equal(res.status, 200);
    assert.deepEqual(helix.calls, [['createPrediction', id, { ...prediction, pointsPerVote: null }]]);
    assert.equal(db.countPollTemplates(id), 0);
    assert.equal(res.json().live.prediction.state, 'running');
  });

  test('one of the same kind running is refused without asking Twitch; a prediction may start beside a poll', async () => {
    const id = addStreamer();
    await start(id, poll);
    const again = await start(id, poll);
    assert.equal(again.status, 409);
    assert.deepEqual(again.json(), { ok: false, code: 'running', error: t('en', 'cards.polls.error.running') });
    assert.equal((await start(id, prediction)).status, 200);
    assert.deepEqual(helix.calls.map(([name]) => name), ['createPoll', 'createPrediction']);
  });

  test('two clicks at once start one poll', async () => {
    const id = addStreamer();
    let release;
    helix.hold = new Promise((resolve) => { release = resolve; });
    const first = start(id, poll);
    for (let i = 0; i < 200 && helix.calls.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await start(id, poll);
    release();
    assert.equal((await first).status, 200);
    assert.equal(second.status, 409);
    assert.equal(second.json().code, 'running');
    assert.equal(helix.calls.length, 1);
  });

  test('Twitch\'s refusals come back with their texts, and are logged', async () => {
    const id = addStreamer();
    helix.refuse = 'not_affiliate';
    const notAffiliate = await start(id, poll);
    assert.equal(notAffiliate.status, 409);
    assert.deepEqual(notAffiliate.json(), { ok: false, code: 'not_affiliate', error: t('en', 'cards.polls.error.notAffiliate') });
    helix.refuse = 'twitch_failed';
    const failed = await start(id, poll);
    assert.equal(failed.status, 502);
    assert.deepEqual(failed.json(), { ok: false, code: 'twitch_failed', error: t('en', 'cards.polls.error.twitchFailed') });
    helix.refuse = 'automod';
    assert.equal((await start(id, poll)).json().error, t('en', 'cards.polls.error.automod'));
    assert.ok(logs.some((line) => line.includes('twitch_failed')));
  });

  test('another streamer\'s template, or a one-off past a limit, is refused before Twitch', async () => {
    const id = addStreamer();
    const theirs = db.addPollTemplate(addStreamer(), poll);
    assert.equal((await start(id, { templateId: theirs.id })).status, 404);
    assert.equal((await start(id, { ...poll, choices: ['only'] })).json().code, 'choices_count');
    assert.deepEqual(helix.calls, []);
  });
});

describe('the running poll and prediction', () => {
  test('End now, Lock now, a winner and Cancel go to Twitch with the ids the card sends; the card gets the new state', async () => {
    const id = addStreamer();
    const ended = await request('POST', '/dashboard/api/polls/end', { streamer: id, body: { id: 'poll-1' } });
    assert.equal(ended.json().live.poll.state, 'ended');
    const locked = await request('POST', '/dashboard/api/predictions/lock', { streamer: id, body: { id: 'pred-1' } });
    assert.equal(locked.json().live.prediction.state, 'locked');
    const resolved = await request('POST', '/dashboard/api/predictions/resolve', { streamer: id, body: { id: 'pred-1', outcomeId: 'o1' } });
    assert.equal(resolved.json().live.prediction.result, 'won');
    await request('POST', '/dashboard/api/predictions/cancel', { streamer: id, body: { id: 'pred-2' } });
    assert.deepEqual(helix.calls, [['endPoll', id, 'poll-1'], ['lockPrediction', id, 'pred-1'], ['resolvePrediction', id, 'pred-1', 'o1'], ['cancelPrediction', id, 'pred-2']]);
  });

  test('an id that is not one, or a winner without its outcome, is refused before Twitch', async () => {
    const id = addStreamer();
    for (const [urlPath, body] of [
      ['/dashboard/api/polls/end', {}],
      ['/dashboard/api/polls/end', { id: 'x'.repeat(65) }],
      ['/dashboard/api/predictions/lock', { id: '../etc' }],
      ['/dashboard/api/predictions/resolve', { id: 'pred-1' }],
      ['/dashboard/api/predictions/cancel', { id: 42 }],
    ]) {
      const res = await request('POST', urlPath, { streamer: id, body });
      assert.equal(res.status, 400, `${urlPath} ${JSON.stringify(body)}`);
      assert.equal(res.json().code, 'invalid');
    }
    assert.deepEqual(helix.calls, []);
  });

  test('without the two permissions every Twitch button and the live view ask for a reconnect, and Twitch is not asked', async () => {
    const id = addStreamer({ broadcaster_scopes: 'channel:read:subscriptions' });
    for (const [method, urlPath, body] of [
      ['POST', '/dashboard/api/polls/start', poll], ['POST', '/dashboard/api/polls/end', { id: 'poll-1' }],
      ['POST', '/dashboard/api/predictions/lock', { id: 'pred-1' }], ['POST', '/dashboard/api/predictions/resolve', { id: 'pred-1', outcomeId: 'o1' }],
      ['POST', '/dashboard/api/predictions/cancel', { id: 'pred-1' }], ['GET', '/dashboard/api/polls/live', undefined],
    ]) {
      const res = await request(method, urlPath, { streamer: id, body });
      assert.equal(res.status, 409, urlPath);
      assert.deepEqual(res.json(), { ok: false, code: 'needs_reconnect', error: t('en', 'cards.polls.error.reconnect') }, urlPath);
    }
    assert.deepEqual(helix.calls, []);
  });
});

describe('the live view', () => {
  test('a poll started on Twitch\'s own dashboard shows, read from Twitch when no event came', async () => {
    const id = addStreamer();
    latest.poll = { id: 'poll-9', title: 'Started on Twitch', status: 'ACTIVE', duration: 120, started_at: iso(Date.now()), choices: [{ id: 'a', title: 'Yes', votes: 3 }, { id: 'b', title: 'No', votes: 1 }] };
    const res = await request('GET', '/dashboard/api/polls/live', { streamer: id });
    assert.equal(res.status, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.poll.id, 'poll-9');
    assert.deepEqual(body.poll.options.map((o) => o.percent), [75, 25]);
    assert.equal(body.prediction, null);
    assert.equal(typeof body.serverNow, 'number');
  });

  test('a logged-out request is sent to the login page', async () => {
    const res = await request('GET', '/dashboard/api/polls/live');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/auth/login');
  });
});

describe('Check again (not an Affiliate)', () => {
  test('forgets Twitch\'s earlier refusal, so the card offers its buttons again', async () => {
    const id = addStreamer({ cp_affiliate_status: 'not_affiliate' });
    const res = await request('POST', '/dashboard/api/polls/affiliate-check', { streamer: id });
    assert.equal(res.status, 200);
    assert.equal(db.getStreamerById(id).cp_affiliate_status, null);
  });
});
```

In `src/routes/dashboard.test.js`, at the end of the file, add:

```js
describe('the Polls & predictions routes in the dashboard', () => {
  test('are behind the login and the CSRF check, like every card route', async () => {
    const id = addStreamer();
    const body = { kind: 'poll', title: 'Top 5?', choices: ['Yes', 'No'], durationSeconds: 60 };
    const loggedOut = await request('POST', '/dashboard/api/poll-templates', { body });
    assert.equal(loggedOut.status, 302);
    const sid = `synthetic-session-polls-${id}`;
    db.createSession(sid, id, Date.now() + 60_000);
    const cookie = `session=${sid}`;
    const page = await request('GET', '/dashboard/chatbot', { cookie });
    const token = page.text.match(/<script src="\/js\/csrf\.js" data-csrf-token="([A-Za-z0-9_-]+)"><\/script>/)[1];
    assert.equal((await request('POST', '/dashboard/api/poll-templates', { cookie, fetchMode: 'cors', body })).status, 403);
    assert.equal(db.countPollTemplates(id), 0);
    assert.equal((await request('POST', '/dashboard/api/poll-templates', { cookie, csrf: token, body })).status, 201);
  });
});
```

Run: `node --test src/routes/polls.test.js src/routes/dashboard.test.js` — Expected: FAIL (`Cannot find module './polls'`; the dashboard answers 404).

- [ ] **Step 2: Write `src/routes/polls.js` and mount it**

```js
'use strict';

// The Polls & predictions card's JSON routes, mounted inside the dashboard router (behind its login, the
// disabled-account check and CSRF): the saved templates; the buttons that start, end, lock, resolve or cancel Twitch's
// poll or prediction; the live view the card polls; and "Check again" after Twitch refused for not being an
// Affiliate. Each answers { ok: true, … } or { ok: false, code, error } with the text of pollRules.ERRORS. A button's
// answer carries what Twitch did at once (livePolls.setFromTwitch); Twitch's events follow a moment later.

const express = require('express');
const db = require('../db');
const rules = require('../services/pollRules');
const twitchPolls = require('../services/twitchPolls');
const { livePolls } = require('../services/livePolls');
const { hasPollsScope } = require('../services/twitch');

const router = express.Router();

// A Twitch poll, prediction or outcome id, as the card sends it back.
const TWITCH_ID = /^[A-Za-z0-9-]{1,64}$/;
const twitchId = (value) => (typeof value === 'string' && TWITCH_ID.test(value) ? value : null);

function refuse(res, code, kind) {
  const error = rules.ERRORS[code] || rules.ERRORS.twitch_failed;
  res.status(error.status).json({ ok: false, code, error: res.locals.t(error.text, rules.errorParams(code, kind)) });
}

// The Twitch buttons and the live view: without the two permissions they ask for a reconnect, and Twitch is not asked.
function needsPermissions(req, res, next) {
  if (hasPollsScope(req.streamer)) return next();
  refuse(res, 'needs_reconnect');
}

// One of the card's Twitch buttons: Twitch's answer is shown at once and announced once (`phase`), and the card gets
// the live state back. A refusal answers its code; Twitch's message is logged, never shown.
async function act(req, res, kind, phase, call) {
  try {
    livePolls.setFromTwitch(req.streamer.id, kind, await call(), phase);
  } catch (err) {
    if (!(err instanceof twitchPolls.PollsError)) throw err;
    console.warn(`[Polls] Twitch refused a ${kind} ${phase} for streamer ${req.streamer.id}: ${err.message}`);
    return refuse(res, err.code, kind);
  }
  res.json({ ok: true, live: livePolls.snapshot(req.streamer.id) });
}

// ── Templates ──

router.post('/api/poll-templates', (req, res) => {
  const checked = rules.checkPollInput(req.body);
  if (!checked.ok) return refuse(res, checked.code, req.body && req.body.kind);
  if (db.countPollTemplates(req.streamer.id) >= rules.TEMPLATES_MAX) return refuse(res, 'too_many');
  res.status(201).json({ ok: true, template: db.addPollTemplate(req.streamer.id, checked.value) });
});

// An edit names only what changes; the rest stays as saved.
router.patch('/api/poll-templates/:id', (req, res) => {
  const template = db.getPollTemplate(Number(req.params.id), req.streamer.id);
  if (!template) return refuse(res, 'not_found');
  const merged = { ...template, ...(req.body && typeof req.body === 'object' ? req.body : {}) };
  const checked = rules.checkPollInput(merged);
  if (!checked.ok) return refuse(res, checked.code, merged.kind);
  db.updatePollTemplate(template.id, req.streamer.id, checked.value);
  res.json({ ok: true, template: db.getPollTemplate(template.id, req.streamer.id) });
});

router.delete('/api/poll-templates/:id', (req, res) => {
  if (!db.deletePollTemplate(Number(req.params.id), req.streamer.id)) return refuse(res, 'not_found');
  res.json({ ok: true });
});

// ── Twitch ──

const starting = new Set(); // `${streamerId}:${kind}` while a start waits for Twitch: a second click is refused

// { templateId } starts a saved template; a one-off's fields ({ kind, title, choices, … }) start it unsaved.
router.post('/api/polls/start', needsPermissions, async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  let input = body;
  if (body.templateId !== undefined) {
    input = db.getPollTemplate(Number(body.templateId), req.streamer.id);
    if (!input) return refuse(res, 'not_found');
  }
  const checked = rules.checkPollInput(input);
  if (!checked.ok) return refuse(res, checked.code, input.kind);
  const { value } = checked;
  const shown = livePolls.snapshot(req.streamer.id)[value.kind];
  const key = `${req.streamer.id}:${value.kind}`;
  if ((shown && shown.state !== 'ended') || starting.has(key)) return refuse(res, 'running');
  starting.add(key);
  try {
    await act(req, res, value.kind, 'start', () => (value.kind === 'poll'
      ? twitchPolls.createPoll(req.streamer, value)
      : twitchPolls.createPrediction(req.streamer, value)));
  } finally {
    starting.delete(key);
  }
});

router.post('/api/polls/end', needsPermissions, async (req, res) => {
  const id = twitchId((req.body || {}).id);
  if (!id) return refuse(res, 'invalid');
  await act(req, res, 'poll', 'end', () => twitchPolls.endPoll(req.streamer, id));
});

router.post('/api/predictions/lock', needsPermissions, async (req, res) => {
  const id = twitchId((req.body || {}).id);
  if (!id) return refuse(res, 'invalid');
  await act(req, res, 'prediction', 'lock', () => twitchPolls.lockPrediction(req.streamer, id));
});

router.post('/api/predictions/resolve', needsPermissions, async (req, res) => {
  const id = twitchId((req.body || {}).id);
  const outcomeId = twitchId((req.body || {}).outcomeId);
  if (!id || !outcomeId) return refuse(res, 'invalid');
  await act(req, res, 'prediction', 'end', () => twitchPolls.resolvePrediction(req.streamer, id, outcomeId));
});

// Cancel and refund: Twitch gives every viewer their points back.
router.post('/api/predictions/cancel', needsPermissions, async (req, res) => {
  const id = twitchId((req.body || {}).id);
  if (!id) return refuse(res, 'invalid');
  await act(req, res, 'prediction', 'end', () => twitchPolls.cancelPrediction(req.streamer, id));
});

// What the card shows: the running and just-ended poll and prediction (titles, choices, votes, points, times).
router.get('/api/polls/live', needsPermissions, async (req, res) => {
  try {
    res.json({ ok: true, ...(await livePolls.live(req.streamer.id)) });
  } catch (err) {
    if (err && err.code === 'needs_reconnect') return refuse(res, 'needs_reconnect');
    throw err;
  }
});

// "Check again" on the card that says Twitch refused for not being an Affiliate or Partner: that answer (the flag the
// rewards card reads too) is forgotten, so the card offers its buttons again; Twitch refuses the next start if nothing
// changed.
router.post('/api/polls/affiliate-check', (req, res) => {
  db.updateStreamerCpSync(req.streamer.id, { affiliate_status: null });
  res.json({ ok: true });
});

module.exports = router;
```

In `src/routes/dashboard.js`, right after the route `router.delete('/api/commands/:id', …)`, add:

```js
// The Polls & predictions card's JSON routes (routes/polls.js), behind this router's login.
router.use(require('./polls'));
```

Run: `node --test src/routes/polls.test.js src/routes/dashboard.test.js` — Expected: PASS.

- [ ] **Step 3: The full suite, then commit**

Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` — Expected: PASS.

```bash
git add src/routes/polls.js src/routes/polls.test.js src/routes/dashboard.js src/routes/dashboard.test.js
git commit -m "feat(polls): the card's routes for templates, Twitch's buttons and the live view"
```

---

### Task 9: The on-stream bar (OBS)

**Files:**
- Create: `public/overlay/pollModel.js`, `public/overlay/poll.js`, `public/overlay/poll.css`, `tests/pollBar.test.js`
- Modify: `src/routes/overlay.js` (the page and its stream), `src/routes/overlay.test.js`
- Modify: `src/locales/*.json` (the `pollbar.*` keys)

**Interfaces:**
- Consumes: `livePolls.live(streamerId)` and `livePolls.barState(streamerId)`, the bus channel `poll:<streamerId>` (Task 4); `pollRules.pickBarView/formatClock` (Task 1, for the agreement test); `t(lang, key, params)` and `SUPPORTED_LANGS` (`src/i18n.js`).
- Produces: `GET /overlay/poll/:token?lang=<lang>` (the OBS page; texts in that language, else English); `GET /overlay/poll/events/:token` (SSE: `{ type: 'config', serverVersion }`, then `{ type: 'poll-state', poll, prediction, serverNow }` on connect and on every change); `public/overlay/pollModel.js` (dual-exported, `window.PollBarModel`): `pick(state, now) → view | null`, `render(view, now, texts, locale) → { kind, label, title, corner: { type: 'time'|'locked'|'result', text }, rows: [{ title, percent, color, extra, lead, won, lost }], footer } | null`, `clock(ms)`, `RESULT_MS`. The OBS link the cards show (Tasks 10–11) is `/overlay/poll/<token>?lang=<the dashboard's language>`.

- [ ] **Step 1: The bar's texts**

Write `/tmp/polls-task9-keys.json` (outside the repository):

```json
{
  "pollbar.poll": "Poll",
  "pollbar.prediction": "Prediction",
  "pollbar.locked": "Locked",
  "pollbar.result": "Result",
  "pollbar.votes": "{{count}} votes",
  "pollbar.pointsViewers": "{{points}} points · {{viewers}} viewers",
  "pollbar.pollFoot": "{{count}} votes · vote in the chat's poll box",
  "pollbar.predictionFoot": "{{count}} points at stake",
  "pollbar.winners": "{{viewers}} viewers share {{points}} points",
  "pollbar.tie": "Tie",
  "pollbar.noVotes": "No votes",
  "pollbar.cancelled": "Cancelled — points refunded"
}
```

Run: `node scripts/locale-keys.js add /tmp/polls-task9-keys.json && node --test tests/i18n.test.js` — Expected: PASS.

- [ ] **Step 2: The model, test first**

Create `tests/pollBar.test.js`:

```js
'use strict';

// The Polls & predictions bar's model (public/overlay/pollModel.js), which the OBS page runs: what it shows and when,
// that it picks as the server's own rule does (services/pollRules.js), and that the page script puts Twitch's texts
// on the page only as text. Synthetic views only.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const model = require('../public/overlay/pollModel');
const rules = require('../src/services/pollRules');

const NOW = Date.parse('2026-10-15T20:00:00Z');
const TEXTS = {
  poll: 'Poll', prediction: 'Prediction', locked: 'Locked', result: 'Result', votes: '{{count}} votes',
  pointsViewers: '{{points}} points · {{viewers}} viewers', pollFoot: '{{count}} votes · vote in the chat\'s poll box',
  predictionFoot: '{{count}} points at stake', winners: '{{viewers}} viewers share {{points}} points', tie: 'Tie',
  noVotes: 'No votes', cancelled: 'Cancelled — points refunded',
};
const OPTIONS = {
  poll: [
    { id: 'a', title: 'Yes', votes: 48, users: 0, points: 0, percent: 64, color: null, won: false },
    { id: 'b', title: 'No', votes: 27, users: 0, points: 0, percent: 36, color: null, won: false },
  ],
  prediction: [
    { id: 'a', title: 'Clean', votes: 0, users: 18, points: 12400, percent: 71, color: 'blue', won: false },
    { id: 'b', title: 'Chaos', votes: 0, users: 9, points: 5100, percent: 29, color: 'pink', won: false },
  ],
};
const view = (kind, over = {}) => ({
  kind, id: `${kind}-1`, title: `A ${kind}`, state: 'running', startedAt: NOW - 30000, endsAt: NOW + 90000, endedAt: null,
  result: null, options: OPTIONS[kind], total: kind === 'poll' ? 75 : 17500, users: kind === 'poll' ? 0 : 27, ...over,
});
const ended = (kind, at, result = 'won') => view(kind, {
  state: 'ended', endsAt: null, endedAt: at, result,
  options: OPTIONS[kind].map((o, i) => ({ ...o, won: result === 'won' ? i === 0 : result === 'tie' })),
});

describe('what the bar shows', () => {
  test('a running poll: its title, the time left, each choice with its percent and votes (the leader marked), the votes in all', () => {
    assert.deepEqual(model.render(view('poll'), NOW, TEXTS, 'en'), {
      kind: 'poll', label: 'Poll', title: 'A poll', corner: { type: 'time', text: '1:30' },
      rows: [
        { title: 'Yes', percent: 64, color: null, extra: '48 votes', lead: true, won: false, lost: false },
        { title: 'No', percent: 36, color: null, extra: '27 votes', lead: false, won: false, lost: false },
      ],
      footer: '75 votes · vote in the chat\'s poll box',
    });
  });

  test('a locked prediction: Locked in the corner, each outcome with its points and predictors, the points at stake', () => {
    const drawn = model.render(view('prediction', { state: 'locked', endsAt: null }), NOW, TEXTS, 'en');
    assert.deepEqual(drawn.corner, { type: 'locked', text: 'Locked' });
    assert.deepEqual(drawn.rows.map((r) => [r.title, r.extra, r.percent, r.color, r.lead]), [
      ['Clean', '12,400 points · 18 viewers', 71, 'blue', false],
      ['Chaos', '5,100 points · 9 viewers', 29, 'pink', false],
    ]);
    assert.equal(drawn.footer, '17,500 points at stake');
  });

  test('a result: the winner marked and the others faded; how many share the points; a tie, no votes, or cancelled said below', () => {
    const won = model.render(ended('prediction', NOW), NOW, TEXTS, 'en');
    assert.deepEqual(won.corner, { type: 'result', text: 'Result' });
    assert.deepEqual(won.rows.map((r) => [r.won, r.lost, r.extra]), [[true, false, '18 viewers share 17,500 points'], [false, true, '']]);
    assert.equal(won.footer, '');
    assert.equal(model.render(ended('poll', NOW), NOW, TEXTS, 'en').footer, '75 votes');
    const tie = model.render(ended('poll', NOW, 'tie'), NOW, TEXTS, 'en');
    assert.deepEqual(tie.rows.map((r) => [r.won, r.lost]), [[true, false], [true, false]]);
    assert.equal(tie.footer, 'Tie');
    assert.equal(model.render(ended('poll', NOW, 'none'), NOW, TEXTS, 'en').footer, 'No votes');
    assert.equal(model.render(ended('prediction', NOW, 'canceled'), NOW, TEXTS, 'en').footer, 'Cancelled — points refunded');
    assert.equal(model.render(null, NOW, TEXTS, 'en'), null);
  });

  test('a result shows for 10 seconds; with both on, the prediction; nothing otherwise', () => {
    assert.equal(model.pick({ poll: ended('poll', NOW - 9999), prediction: null }, NOW).kind, 'poll');
    assert.equal(model.pick({ poll: ended('poll', NOW - 10000), prediction: null }, NOW), null);
    assert.equal(model.pick({ poll: view('poll'), prediction: view('prediction') }, NOW).kind, 'prediction');
    assert.equal(model.pick({ poll: view('poll'), prediction: ended('prediction', NOW - 20000) }, NOW).kind, 'poll');
    assert.equal(model.pick(null, NOW), null);
  });

  test('the bar picks as the server does', () => {
    const cases = [
      { poll: null, prediction: null },
      { poll: view('poll'), prediction: null },
      { poll: null, prediction: view('prediction', { state: 'locked' }) },
      { poll: view('poll'), prediction: view('prediction') },
      { poll: ended('poll', NOW - 5000), prediction: ended('prediction', NOW - 12000) },
      { poll: ended('poll', NOW - 12000), prediction: null },
    ];
    for (const state of cases) assert.equal(model.pick(state, NOW), rules.pickBarView(state, NOW), JSON.stringify(state));
  });

  test('the time left counts down in m:ss, as the server writes it, and stops at 0:00', () => {
    assert.equal(model.clock(-1), '0:00');
    for (const ms of [1, 999, 59001, 90000, 600000, 1800000]) assert.equal(model.clock(ms), rules.formatClock(ms), String(ms));
  });
});

describe('the page script', () => {
  test('compiles, reads its own stream, and puts what Twitch sent on the page only as text', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'overlay', 'poll.js'), 'utf8');
    new vm.Script(source, { filename: 'poll.js' });
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    assert.match(source, /\/overlay\/poll\/events\//);
  });
});
```

Run: `node --test tests/pollBar.test.js` — Expected: FAIL (`Cannot find module '../public/overlay/pollModel'`).

Create `public/overlay/pollModel.js`:

```js
// The Polls & predictions bar's model (public/overlay/poll.js): from what the server sent ({ poll, prediction }, views
// as services/pollRules.js makes them) and the server's clock, what the bar shows — the prediction when both run (its
// points are at stake), else the poll; a result for 10 seconds; nothing otherwise (the same rule as pollRules'
// pickBarView, which tests/pollBar.test.js compares). Dual-exported: the page reads window.PollBarModel, the tests
// require it.
(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.PollBarModel = model;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RESULT_MS = 10000;

  const recent = (view, now) => !!view && (view.state !== 'ended' || (view.endedAt !== null && now - view.endedAt < RESULT_MS));

  // The view the bar shows at `now` (the server's clock), or null.
  function pick(state, now) {
    if (!state) return null;
    if (recent(state.prediction, now)) return state.prediction;
    if (recent(state.poll, now)) return state.poll;
    return null;
  }

  // 90000 → '1:30': whole seconds rounded up, never below zero.
  function clock(ms) {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  // What to draw for a view: the label, the title, the corner (the time left, Locked, or Result), each row (its title,
  // percent, the line under its bar, its colour, and whether it leads, won or lost) and the footer, with the bar's
  // texts ({{count}}, {{points}} and {{viewers}} filled in) and the numbers written for `locale`.
  function render(view, now, texts, locale) {
    if (!view) return null;
    const isPoll = view.kind === 'poll';
    const ended = view.state === 'ended';
    const number = (n) => Number(n || 0).toLocaleString(locale || 'en');
    const fill = (text, values) => String(text || '').replace(/\{\{(\w+)\}\}/g, (all, key) => (key in values ? number(values[key]) : all));
    let corner = { type: 'time', text: view.endsAt !== null ? clock(view.endsAt - now) : '' };
    if (view.state === 'locked') corner = { type: 'locked', text: texts.locked || '' };
    else if (ended) corner = { type: 'result', text: texts.result || '' };
    const most = Math.max(0, ...view.options.map((o) => o.votes));
    const someWon = view.options.some((o) => o.won);
    const rows = view.options.map((o) => {
      let extra = '';
      if (isPoll) extra = fill(texts.votes, { count: o.votes });
      else if (ended && o.won) extra = fill(texts.winners, { viewers: o.users, points: view.total });
      else if (!ended) extra = fill(texts.pointsViewers, { points: o.points, viewers: o.users });
      return {
        title: o.title, percent: o.percent, color: o.color || null, extra,
        lead: isPoll && !ended && most > 0 && o.votes === most,
        won: ended && !!o.won,
        lost: ended && someWon && !o.won,
      };
    });
    let footer;
    if (!ended) footer = fill(isPoll ? texts.pollFoot : texts.predictionFoot, { count: view.total });
    else if (view.result === 'canceled') footer = texts.cancelled || '';
    else if (view.result === 'none') footer = texts.noVotes || '';
    else if (view.result === 'tie') footer = texts.tie || '';
    else footer = isPoll ? fill(texts.votes, { count: view.total }) : '';
    return { kind: view.kind, label: isPoll ? texts.poll : texts.prediction, title: view.title, corner, rows, footer };
  }

  return { RESULT_MS, pick, render, clock };
}));
```

Run: `node --test tests/pollBar.test.js` — Expected: the model tests PASS; the page script test FAILS (no `poll.js` yet).

- [ ] **Step 3: The page script and its styles**

Create `public/overlay/poll.js`:

```js
// The Polls & predictions bar: an OBS browser source (/overlay/poll/<token>). It shows the running poll or prediction
// the server sends on the bar's own stream, counts the time down, and shows a result for 10 seconds (pollModel.js
// decides what). Its texts come from the page (window.POLL_BAR_TEXTS, in the language its link names); everything
// Twitch sent is set as text, never as HTML.
(function () {
  'use strict';

  const model = window.PollBarModel;
  const texts = window.POLL_BAR_TEXTS || {};
  const locale = document.documentElement.lang || 'en';
  const root = document.getElementById('poll-root');
  let state = null;
  let offset = 0; // the server's clock minus this machine's
  let serverVersion = null;
  let source = null;
  let retryTimer = null;
  let shown = null; // { key, corner, rows: [{ row, fill, percent, extra }], footer }

  const now = () => Date.now() + offset;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  // The panel of one poll or prediction: the chequered strip, the head (label, title, corner), a row per choice (its
  // name and percent, its bar, the line under it) and the footer.
  function build(drawn, key) {
    const panel = node('div', drawn.kind === 'prediction' ? 'pb pred' : 'pb');
    const head = node('div', 'pb-head');
    const corner = node('span', 'pb-corner');
    head.append(node('span', 'pb-kind', drawn.label), node('span', 'pb-title', drawn.title), corner);
    panel.append(node('div', 'pb-flag'), head);
    const rows = drawn.rows.map((r) => {
      const row = node('div', r.color ? `pb-opt ${r.color}` : 'pb-opt');
      const line = node('div', 'pb-line');
      const percent = node('span', 'pb-pc');
      line.append(node('span', 'pb-nm', r.title), percent);
      const bar = node('div', 'pb-bar');
      const fill = node('i');
      bar.append(fill);
      const extra = node('div', 'pb-extra');
      row.append(line, bar, extra);
      panel.append(row);
      return { row, fill, percent, extra };
    });
    const footer = node('div', 'pb-foot');
    panel.append(footer);
    root.textContent = '';
    root.append(panel);
    return { key, corner, rows, footer };
  }

  // Draws what pollModel picks; a new poll or prediction is built (and enters), the same one is updated in place, so
  // its bars glide to their new width.
  function draw() {
    const t = now();
    const view = model.pick(state, t);
    const drawn = model.render(view, t, texts, locale);
    if (!drawn) {
      if (shown) { root.textContent = ''; shown = null; }
      return;
    }
    const key = `${view.kind}:${view.id}:${drawn.rows.length}`;
    if (!shown || shown.key !== key) shown = build(drawn, key);
    shown.corner.textContent = drawn.corner.text;
    shown.corner.className = `pb-corner is-${drawn.corner.type}`;
    drawn.rows.forEach((r, i) => {
      const row = shown.rows[i];
      row.fill.style.width = `${r.percent}%`;
      row.percent.textContent = `${r.percent}%`;
      row.extra.textContent = r.extra;
      row.row.classList.toggle('lead', r.lead);
      row.row.classList.toggle('won', r.won);
      row.row.classList.toggle('lost', r.lost);
    });
    shown.footer.textContent = drawn.footer;
  }

  function connect() {
    if (source) source.close();
    source = new EventSource(`/overlay/poll/events/${window.OVERLAY_TOKEN}`);
    source.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch (err) { return; }
      if (data.type === 'config') {
        // A new server version (a deploy): load the page again, for its new script.
        if (serverVersion && data.serverVersion && data.serverVersion !== serverVersion) { location.reload(); return; }
        serverVersion = data.serverVersion;
        return;
      }
      if (data.type === 'poll-state') {
        if (typeof data.serverNow === 'number') offset = data.serverNow - Date.now();
        state = { poll: data.poll || null, prediction: data.prediction || null };
        draw();
      }
    };
    source.onerror = () => {
      source.close();
      source = null;
      if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; connect(); }, 5000);
    };
  }

  setInterval(draw, 250);
  connect();
}());
```

Create `public/overlay/poll.css`:

```css
/* The Polls & predictions bar: an OBS browser source (/overlay/poll/<token>), with the look of the approved mockup
   (docs/superpowers/specs/assets/2026-10-15-polls-shoutouts-mockup.html). It fills the source's width, and is empty
   (transparent) while nothing runs. Recommended source size: 600 x 700 (a prediction with ten outcomes needs it all; a
   poll of two to five choices uses 250 to 450 px). */
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --font-display: 'Outfit', 'Segoe UI', sans-serif;
  --font-body: 'DM Sans', 'Segoe UI', sans-serif;
}

html, body { background: transparent; overflow: hidden; }

#poll-root { padding: 12px; }

.pb {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 16px 12px;
  background: rgba(12, 13, 20, 0.9);
  border: 1px solid rgba(56, 189, 248, 0.35);
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  font-family: var(--font-display);
  animation: pb-enter 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.2);
}
.pb.pred { border-color: rgba(192, 132, 252, 0.4); }
.pb-flag { position: absolute; inset: 0 0 auto 0; height: 5px; background: repeating-linear-gradient(90deg, #fff 0 8px, #111 8px 16px); opacity: 0.85; }

.pb-head { display: flex; align-items: center; gap: 10px; }
.pb-kind { flex: none; padding: 3px 8px; border-radius: 6px; background: #38bdf8; color: #0c0d14; font: 800 11px var(--font-display); letter-spacing: 1px; text-transform: uppercase; }
.pb.pred .pb-kind { background: #c084fc; }
.pb-title { flex: 1; min-width: 0; font: 800 18px var(--font-display); color: #fff; overflow-wrap: anywhere; }
.pb-corner { flex: none; padding: 2px 8px; border-radius: 6px; font: 800 12px var(--font-display); }
.pb-corner:empty { display: none; }
.pb-corner.is-time { padding: 0; font-size: 16px; color: #3ecf8e; font-variant-numeric: tabular-nums; }
.pb-corner.is-locked { color: #f79009; border: 1px solid rgba(247, 144, 9, 0.5); }
.pb-corner.is-result { color: #3ecf8e; border: 1px solid rgba(62, 207, 142, 0.5); }

.pb-opt { display: flex; flex-direction: column; gap: 4px; transition: opacity 0.3s; }
.pb-line { display: flex; justify-content: space-between; gap: 10px; font: 700 14px var(--font-display); color: #e8e6f0; }
.pb-nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pb-pc { flex: none; font-variant-numeric: tabular-nums; }
.pb-bar { height: 12px; background: rgba(255, 255, 255, 0.08); border-radius: 99px; overflow: hidden; }
.pb-bar i { display: block; width: 0; height: 100%; border-radius: 99px; background: linear-gradient(90deg, #38bdf8, #9146ff); transition: width 0.6s ease; }
.pb-opt.lead .pb-bar i { background: linear-gradient(90deg, #3ecf8e, #38bdf8); }
.pb-opt.blue .pb-bar i { background: linear-gradient(90deg, #387aff, #38bdf8); }
.pb-opt.pink .pb-bar i { background: linear-gradient(90deg, #f5009b, #f472b6); }
.pb-opt.won .pb-line { color: #3ecf8e; }
.pb-opt.won .pb-nm::after { content: ' ✓'; }
.pb-opt.lost { opacity: 0.45; }
.pb-extra { font: 500 12px var(--font-body); color: #8b8a9e; }
.pb-foot { font: 600 12px var(--font-body); color: #8b8a9e; }
.pb-extra:empty, .pb-foot:empty { display: none; }

@keyframes pb-enter {
  from { opacity: 0; transform: translateY(-12px) scale(0.98); }
  to { opacity: 1; transform: none; }
}
```

Run: `node --test tests/pollBar.test.js` — Expected: PASS.

- [ ] **Step 4: The page and its stream, test first**

In `src/routes/overlay.test.js`:
- in `PAGES`, after `(t) => \`/overlay/goal/events/${t}\`,` add `(t) => \`/overlay/poll/${t}\`,` and `(t) => \`/overlay/poll/events/${t}\`,`;
- in `STREAMS`, after the tip goal entry add `['poll bar', (t) => \`/overlay/poll/events/${t}\`, (id) => \`poll:${id}\`],`;
- at the end of the file, add:

```js
describe('the Polls & predictions bar', () => {
  const { t } = require('../i18n');

  test('its page has its texts in the language its link names, English otherwise', async () => {
    const { token } = addStreamer();
    const pt = await get(`/overlay/poll/${token}?lang=pt`);
    assert.equal(pt.status, 200);
    assert.match(pt.text, /<html lang="pt">/);
    assert.ok(pt.text.includes(`"locked":${JSON.stringify(t('pt', 'pollbar.locked'))}`));
    const fields = { count: '{{count}}', points: '{{points}}', viewers: '{{viewers}}' };
    assert.ok(pt.text.includes(`"winners":${JSON.stringify(t('pt', 'pollbar.winners', fields))}`), 'the numbers are filled in by the bar');
    assert.ok(t('pt', 'pollbar.winners', fields).includes('{{viewers}}'));
    assert.match(pt.text, /\/overlay\/pollModel\.js/);
    for (const lang of ['xx', '']) assert.match((await get(`/overlay/poll/${token}?lang=${lang}`)).text, /<html lang="en">/);
  });

  test('its stream sends what runs when it opens, then every change on its own channel, and nothing of the alerts', async () => {
    const { id, token } = addStreamer();
    const stream = await openStream(`/overlay/poll/events/${token}`);
    assert.match(stream.chunks[0], /"type":"config"/);
    await until(() => stream.chunks.join('').includes('"type":"poll-state"'), 'the bar is told what runs when it opens');
    bus.emit(`overlay:${id}`, { type: 'follow', data: { username: 'Viewer' } });
    bus.emit(`poll:${id}`, { type: 'poll-state', poll: { id: 'poll-1' }, prediction: null, serverNow: 1 });
    await until(() => stream.chunks.join('').includes('"poll-1"'), 'a change on poll:<id> reaches the bar');
    assert.ok(!stream.chunks.join('').includes('"follow"'), 'an alert is not the bar\'s');
  });
});
```

Run: `node --test src/routes/overlay.test.js` — Expected: FAIL (404 on the new links).

In `src/routes/overlay.js`:
- after `const { holdStream } = require('../httpDrain');` add `const { t, SUPPORTED_LANGS } = require('../i18n');`;
- right before the comment `// Custom overlay routes — DISABLED for now`, add:

```js
// The Polls & predictions bar (an OBS browser source of its own). Its stream says what runs when it opens — read from
// Twitch when EventSub said nothing lately (after a restart OBS reconnects here) — then every change on the bus
// channel poll:<streamerId>; it does not follow the alerts' switch.
router.get('/poll/events/:token', (req, res) => {
  const streamer = db.getStreamerByOverlayToken(req.params.token);
  if (!streamer) return res.status(404).send('Invalid overlay token');
  const { livePolls } = require('../services/livePolls');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event) => {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch (e) {}
  };
  send({ type: 'config', serverVersion: SERVER_INSTANCE_ID });

  const heartbeat = setInterval(() => {
    try { res.write(`:heartbeat\n\n`); } catch (e) { clearInterval(heartbeat); }
  }, 30000);
  const channel = `poll:${streamer.id}`;
  bus.on(channel, send);
  endStreamWhenAccountDisabled(streamer.id, req, res);
  holdStream(res);
  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off(channel, send);
  });

  livePolls.live(streamer.id).catch(() => null).then(() => send({ type: 'poll-state', ...livePolls.barState(streamer.id) }));
});

// The bar's texts: pollbar.* in the language the link names. {{count}}, {{points}} and {{viewers}} stay for the bar to
// fill in (POLL_BAR_FIELDS).
const POLL_BAR_TEXTS = Object.freeze({
  poll: 'pollbar.poll', prediction: 'pollbar.prediction', locked: 'pollbar.locked', result: 'pollbar.result',
  votes: 'pollbar.votes', pointsViewers: 'pollbar.pointsViewers', pollFoot: 'pollbar.pollFoot',
  predictionFoot: 'pollbar.predictionFoot', winners: 'pollbar.winners', tie: 'pollbar.tie', noVotes: 'pollbar.noVotes',
  cancelled: 'pollbar.cancelled',
});
const POLL_BAR_FIELDS = Object.freeze({ count: '{{count}}', points: '{{points}}', viewers: '{{viewers}}' });

router.get('/poll/:token', (req, res) => {
  const streamer = db.getStreamerByOverlayToken(req.params.token);
  if (!streamer) return res.status(404).send('Invalid overlay token');

  const lang = SUPPORTED_LANGS.includes(req.query.lang) ? req.query.lang : 'en';
  const texts = Object.fromEntries(Object.entries(POLL_BAR_TEXTS).map(([name, key]) => [name, t(lang, key, POLL_BAR_FIELDS)]));
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(`<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <title>Poll Bar</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;700;800&family=DM+Sans:wght@500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/overlay/poll.css">
</head>
<body>
  <div id="poll-root"></div>
  <script>window.OVERLAY_TOKEN = ${JSON.stringify(streamer.overlay_token)}; window.POLL_BAR_TEXTS = ${JSON.stringify(texts).replace(/</g, '\\u003c')};</script>
  <script src="/overlay/pollModel.js"></script>
  <script src="/overlay/poll.js"></script>
</body>
</html>`);
});
```

Run: `node --test src/routes/overlay.test.js tests/pollBar.test.js tests/i18n.test.js` — Expected: PASS.

- [ ] **Step 5: The full suite, then commit**

Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` — Expected: PASS.

```bash
git add public/overlay/pollModel.js public/overlay/poll.js public/overlay/poll.css tests/pollBar.test.js src/routes/overlay.js src/routes/overlay.test.js src/locales/en.json src/locales/pt.json src/locales/es.json src/locales/fr.json src/locales/de.json src/locales/zh.json src/locales/ja.json
git commit -m "feat(polls): the on-stream bar for polls and predictions, an OBS source of its own"
```

---

### Task 10: The two cards on the Twitch tab — their states, their data and their markup

The card states, the data `GET /dashboard` gathers and the partials land together: `dashboard.ejs` includes a partial for every name in `cards.order`, so a card in the order without its partial would break the page. Until Task 11 the switches and the raid minimum already save (the page script handles every `data-setting`), and the rest of the polls card is drawn but not yet wired.

**Files:**
- Modify: `src/services/dashboardCards.js`, `src/services/dashboardCards.test.js`
- Modify: `src/routes/dashboard.js` (`gatherCards`), `src/routes/polls.js` (the status line in its answers), `src/routes/polls.test.js`
- Create: `src/views/cards/polls.ejs`, `src/views/cards/shoutouts.ejs`
- Modify: `src/views/cards/_icons.ejs`, `src/views/cards/_style.ejs`, `src/views/cards/overlay.ejs`
- Modify: `src/routes/dashboard.test.js`, `tests/i18nViewsPart1.test.js`
- Modify: `src/locales/*.json`

**Interfaces:**
- Consumes: `pollRules.CHAT_TEXTS/LIMITS/POINTS_PER_VOTE/DURATION_CHOICES/TEMPLATES_MAX` (Task 1); `db.getPollTemplates` (Task 2); `hasPollsScope` (Task 3); `livePolls.snapshot` (Task 4); `RAID_MIN_VIEWERS`, `shoutoutLine` (Task 6).
- Produces: `ORDER` = `chatbot, discord, overlay, commands, shoutouts, sponsors, donations, protection, giveaways, polls, rewards, spotify`; `buildCards` input gains `pollTemplates` and `polls: { hasScope, live, barUrl }`; `cards.polls` = `{ setup: null|'linkTwitch'|'reconnect'|'notAffiliate', status, templates: [{ id, kind, title, choices, durationSeconds, pointsPerVote, time }], blocked: { poll, prediction }, live, announce, chatNote, texts: [{ key, label, vars, text }], limits, bar: { url, shown, masked } | null, counts: { templates } }`; `cards.shoutouts` = `{ needsChatbot, status, command, raid, viewers, viewerChoices, text, vars, sample, example, counts }`; `cards.overlay.pollBar`; `pollsStatus(live, templateCount) → status` (exported: the live route answers it too).
- The markup hooks Task 11's scripts use: on `#card-polls`, `data-live` and `data-limits` (JSON), `[data-polls-live]` (the live panel's place), `[data-list="templates"]` rows with `data-id` and `data-template` (JSON), `[data-start]` (▶, its kind), `[data-edit="poll-template"]`, `[data-delete="poll-template"]`, `[data-add="poll-template"]`, `[data-edit="poll-texts"]`, `[data-polls-recheck]`, `[data-polls-chat-note]`, and the templates `tpl-poll-template`, `tpl-poll-template-row`, `tpl-poll-choice`, `tpl-poll-texts`; on `#card-shoutouts`, `[data-test-line]`, the message's `[data-edit="thankyou"]` with `data-test-url`, and `[data-example]` with `data-sample` (JSON).
- `GET /dashboard/api/polls/live` and the Twitch buttons' `live` gain `status: { text, tone }`.

- [ ] **Step 1: The cards' texts**

Write `/tmp/polls-task10-keys.json` (outside the repository):

```json
{
  "cards.polls.title": "Polls & predictions",
  "cards.polls.status.noTwitch": "Link your Twitch account first",
  "cards.polls.status.reconnect": "Reconnect Twitch to use polls & predictions",
  "cards.polls.status.notAffiliate": "Needs Twitch Affiliate or Partner",
  "cards.polls.status.ready": "Ready · {{count}} templates",
  "cards.polls.status.pollRunning": "Poll running",
  "cards.polls.status.predictionRunning": "Prediction running",
  "cards.polls.status.bothRunning": "Poll and prediction running",
  "cards.polls.status.locked": "Locked — pick the winner",
  "cards.polls.status.pollEnded": "Poll ended",
  "cards.polls.status.predictionEnded": "Prediction ended",
  "cards.polls.setupLink": "Link your Twitch account to start polls and predictions from here.",
  "cards.polls.setupReconnect": "Twitch needs your OK once before Atleta can start polls and predictions for you.",
  "cards.polls.setupAffiliate": "Twitch allows polls and predictions for Affiliates and Partners only. When your channel becomes one, check again.",
  "cards.polls.templates": "Templates",
  "cards.polls.new": "New",
  "cards.polls.newTitle": "New template",
  "cards.polls.editTitle": "Edit template",
  "cards.polls.none": "No templates yet. Save the polls and predictions you run often, then start them with one click.",
  "cards.polls.kindPoll": "Poll",
  "cards.polls.kindPrediction": "Prediction",
  "cards.polls.kindPredictionShort": "Pred.",
  "cards.polls.start": "Start on Twitch",
  "cards.polls.pollRunningHint": "A poll is already running",
  "cards.polls.predictionRunningHint": "A prediction is already running",
  "cards.polls.edit": "Edit template",
  "cards.polls.delete": "Delete template",
  "cards.polls.announce": "Announce in chat",
  "cards.polls.chatMessages": "Chat messages",
  "cards.polls.needsChatbot": "Announcements need the chatbot: switch it on in the Chatbot card.",
  "cards.polls.bar": "On-stream bar (OBS)",
  "cards.polls.type": "Type",
  "cards.polls.question": "Question",
  "cards.polls.choices": "Choices",
  "cards.polls.outcomes": "Outcomes",
  "cards.polls.addChoice": "Add a choice",
  "cards.polls.removeChoice": "Remove this choice",
  "cards.polls.time": "Time",
  "cards.polls.extraVotes": "Extra votes with channel points",
  "cards.polls.pointsPerVote": "Points per extra vote",
  "cards.polls.startOnce": "Start without saving",
  "cards.polls.textsHint": "The bot posts these when a poll or prediction starts, locks and ends. Leave one empty to post nothing then.",
  "cards.shoutouts.title": "Shoutouts",
  "cards.shoutouts.status.both": "On: !so for mods · after raids ({{viewers}}+ viewers)",
  "cards.shoutouts.status.command": "On: !so for mods",
  "cards.shoutouts.status.raid": "On: after raids ({{viewers}}+ viewers)",
  "cards.shoutouts.status.off": "Off",
  "cards.shoutouts.needsChatbot": "Turn the chatbot on to post shoutouts.",
  "cards.shoutouts.command": "!so for moderators",
  "cards.shoutouts.commandHint": "broadcaster and moderators",
  "cards.shoutouts.raid": "After a raid",
  "cards.shoutouts.raidHint": "after the raid thank-you",
  "cards.shoutouts.raidFrom": "Raid shoutout from",
  "cards.shoutouts.oneViewer": "1 viewer",
  "cards.shoutouts.viewers": "{{count}} viewers",
  "cards.shoutouts.message": "Message",
  "cards.shoutouts.edit": "Edit the message",
  "cards.shoutouts.editTitle": "Shoutout message",
  "cards.shoutouts.example": "In chat: “{{line}}”"
}
```

Run: `node scripts/locale-keys.js add /tmp/polls-task10-keys.json && node --test tests/i18n.test.js` — Expected: PASS.

- [ ] **Step 2: Write the failing tests of the card states**

In `src/services/dashboardCards.test.js`:
- in `input()`, the `streamer` object gains (before `...(over.streamer || {})`):

```js
    polls_chat_enabled: 1, poll_start_template: 'Poll: {title}', poll_end_template: 'Closed: {winner}',
    prediction_start_template: 'Prediction: {title}', prediction_lock_template: 'Locked: {title}', prediction_end_template: '{outcome} wins',
    prediction_cancel_template: '', shoutout_command_enabled: 1, shoutout_raid_enabled: 1, shoutout_raid_min_viewers: 5,
    shoutout_template: 'Go check out {name}! They were last streaming {game}: {link}',
```

  and the returned object gains (before `...over,`):

```js
    pollTemplates: [],
    polls: { hasScope: true, live: { poll: null, prediction: null, serverNow: Date.parse('2026-10-14T12:00:00Z') }, barUrl: 'https://atleta.example/overlay/poll/synthetic-token?lang=en' },
```

- the test `'ten cards in reading order while the overlay features are on'` becomes `'twelve cards in reading order while the overlay features are on'`, its first assertion `assert.deepEqual(ORDER, ['chatbot', 'discord', 'overlay', 'commands', 'shoutouts', 'sponsors', 'donations', 'protection', 'giveaways', 'polls', 'rewards', 'spotify']);`, and in the next test the expected order without the overlay features becomes `['chatbot', 'discord', 'commands', 'shoutouts', 'sponsors', 'donations', 'protection', 'giveaways', 'polls', 'spotify']`;
- in `describe('cardTexts', …)` the expected keys become `['chatbot', 'discord', 'overlay', 'commands', 'shoutouts', 'sponsors', 'donations', 'protection', 'polls', 'rewards', 'spotify']`;
- inside `describe('OBS overlay', …)` add:

```js
  test('the poll bar\'s OBS link is there too, masked', () => {
    assert.deepEqual(build().overlay.pollBar, {
      url: 'https://atleta.example/overlay/poll/synthetic-token?lang=en',
      shown: 'atleta.example/overlay/poll/synthetic-token?lang=en',
      masked: `atleta.example/overlay/poll/${'•'.repeat(12)}`,
    });
  });
```

- before `describe('cardTexts', …)` add:

```js
describe('Polls & predictions', () => {
  const NOW = Date.parse('2026-10-14T12:00:00Z');
  const tpl = (over = {}) => ({ id: 1, kind: 'poll', title: 'Top 5?', choices: ['Yes', 'No'], durationSeconds: 120, pointsPerVote: null, sortOrder: 1, ...over });
  const view = (kind, over = {}) => ({ kind, id: `${kind}-1`, title: 'x', state: 'running', startedAt: NOW, endsAt: NOW + 60000, endedAt: null, result: null, options: [], total: 0, users: 0, ...over });
  const polls = (live, over = {}) => ({ polls: { hasScope: true, live: { poll: null, prediction: null, serverNow: NOW, ...live }, barUrl: 'https://atleta.example/overlay/poll/synthetic-token?lang=en', ...over } });

  test('its one setup step: link Twitch, reconnect for the two permissions, or Check again after Twitch said not an Affiliate', () => {
    const noTwitch = build({ streamer: { twitch_user_id: null } }).polls;
    assert.equal(noTwitch.setup, 'linkTwitch');
    assert.deepEqual(noTwitch.status, { key: 'cards.polls.status.noTwitch', params: {}, tone: 'warn' });
    const reconnect = build(polls({}, { hasScope: false })).polls;
    assert.equal(reconnect.setup, 'reconnect');
    assert.deepEqual(reconnect.status, { key: 'cards.polls.status.reconnect', params: {}, tone: 'warn' });
    const notAffiliate = build({ streamer: { cp_affiliate_status: 'not_affiliate' } }).polls;
    assert.equal(notAffiliate.setup, 'notAffiliate');
    assert.deepEqual(notAffiliate.status, { key: 'cards.polls.status.notAffiliate', params: {}, tone: 'warn' });
  });

  test('ready: the templates with their choices and time; the status counts them', () => {
    const card = build({ pollTemplates: [tpl(), tpl({ id: 2, kind: 'prediction', title: 'Clean lap?', choices: ['Clean', 'Chaos'], durationSeconds: 30 })] }).polls;
    assert.equal(card.setup, null);
    assert.deepEqual(card.status, { key: 'cards.polls.status.ready', params: { count: 2 }, tone: 'ok' });
    assert.deepEqual(card.templates.map((x) => [x.id, x.kind, x.title, x.choices, x.time]), [
      [1, 'poll', 'Top 5?', ['Yes', 'No'], { key: 'cards.common.minutes', params: { minutes: 2 } }],
      [2, 'prediction', 'Clean lap?', ['Clean', 'Chaos'], { key: 'cards.common.seconds', params: { seconds: 30 } }],
    ]);
    assert.deepEqual(card.blocked, { poll: false, prediction: false });
    assert.deepEqual(card.counts.templates, { text: '2' });
  });

  test('what runs on Twitch: the status, and the ▶ of a kind that runs (or waits for its winner) is off', () => {
    const status = (live) => build(polls(live)).polls.status.key;
    assert.equal(status({ poll: view('poll') }), 'cards.polls.status.pollRunning');
    assert.equal(status({ prediction: view('prediction') }), 'cards.polls.status.predictionRunning');
    assert.equal(status({ poll: view('poll'), prediction: view('prediction') }), 'cards.polls.status.bothRunning');
    assert.equal(status({ prediction: view('prediction', { state: 'locked' }) }), 'cards.polls.status.locked');
    assert.equal(status({ prediction: view('prediction', { state: 'ended', endedAt: NOW }) }), 'cards.polls.status.predictionEnded');
    assert.equal(status({ poll: view('poll', { state: 'ended', endedAt: NOW }) }), 'cards.polls.status.pollEnded');
    const card = build(polls({ prediction: view('prediction', { state: 'locked' }) })).polls;
    assert.deepEqual(card.blocked, { poll: false, prediction: true });
    assert.equal(card.status.tone, 'warn');
    assert.equal(card.live.prediction.state, 'locked', 'the live panel starts from it');
  });

  test('the announcements: the switch, the six texts with their variables, and a note while the chatbot is off', () => {
    const card = build().polls;
    assert.equal(card.announce, true);
    assert.equal(card.chatNote, false);
    assert.deepEqual(card.texts.map((x) => [x.key, x.text]), [
      ['poll_start_template', 'Poll: {title}'], ['poll_end_template', 'Closed: {winner}'], ['prediction_start_template', 'Prediction: {title}'],
      ['prediction_lock_template', 'Locked: {title}'], ['prediction_end_template', '{outcome} wins'], ['prediction_cancel_template', ''],
    ]);
    assert.deepEqual(card.texts[1].vars, ['{title}', '{winner}', '{percent}', '{votes}']);
    assert.equal(build({ streamer: { chatbot_enabled: 0 } }).polls.chatNote, true);
    assert.equal(build({ streamer: { chatbot_enabled: 0, polls_chat_enabled: 0 } }).polls.chatNote, false);
  });

  test('the pop-up gets Twitch\'s limits; the bar\'s OBS link is masked, and only there with the overlay features', () => {
    const card = build().polls;
    assert.deepEqual(card.limits.poll, { titleMax: 60, choiceMax: 25, minChoices: 2, maxChoices: 5, minSeconds: 15, maxSeconds: 1800 });
    assert.deepEqual(card.limits.durations.prediction, [60, 120, 300, 600, 1800]);
    assert.equal(card.limits.templatesMax, 20);
    assert.deepEqual(card.bar, {
      url: 'https://atleta.example/overlay/poll/synthetic-token?lang=en',
      shown: 'atleta.example/overlay/poll/synthetic-token?lang=en',
      masked: `atleta.example/overlay/poll/${'•'.repeat(12)}`,
    });
    assert.equal(build({ features: { overlays: false } }).polls.bar, null);
    assert.equal(build(polls({}, { barUrl: null })).polls.bar, null);
  });
});

describe('Shoutouts', () => {
  test('the status names what is on; the card needs the chatbot', () => {
    const status = (over) => build({ streamer: over }).shoutouts.status;
    assert.deepEqual(status({}), { key: 'cards.shoutouts.status.both', params: { viewers: 5 }, tone: 'ok' });
    assert.deepEqual(status({ shoutout_raid_enabled: 0 }), { key: 'cards.shoutouts.status.command', params: {}, tone: 'ok' });
    assert.deepEqual(status({ shoutout_command_enabled: 0 }), { key: 'cards.shoutouts.status.raid', params: { viewers: 5 }, tone: 'ok' });
    assert.deepEqual(status({ shoutout_command_enabled: 0, shoutout_raid_enabled: 0 }), { key: 'cards.shoutouts.status.off', params: {}, tone: 'off' });
    assert.equal(build().shoutouts.needsChatbot, true);
  });

  test('the raid minimum offers the card\'s choices (a value saved elsewhere among them); the message, its variables and an example', () => {
    const card = build().shoutouts;
    assert.deepEqual(card.viewerChoices, [1, 2, 5, 10, 25, 50, 100]);
    assert.deepEqual(build({ streamer: { shoutout_raid_min_viewers: 3 } }).shoutouts.viewerChoices, [1, 2, 3, 5, 10, 25, 50, 100]);
    assert.deepEqual(card.vars, ['{name}', '{game}', '{title}', '{link}']);
    assert.equal(card.text, 'Go check out {name}! They were last streaming {game}: {link}');
    assert.equal(card.example, 'Go check out RivalRacer! They were last streaming iRacing: https://twitch.tv/rivalracer');
  });
});
```

Run: `node --test src/services/dashboardCards.test.js` — Expected: FAIL (the order; `build().polls` is undefined).

- [ ] **Step 3: The card states**

In `src/services/dashboardCards.js`:
- after `const { sponsorChatIntervalMinutes } = require('./inputLimits');` add:

```js
const { CHAT_TEXTS: POLL_TEXTS, LIMITS: POLL_LIMITS, POINTS_PER_VOTE, DURATION_CHOICES, TEMPLATES_MAX } = require('./pollRules');
const { RAID_MIN_VIEWERS, shoutoutLine } = require('./shoutouts');
```

- `ORDER` becomes `const ORDER = ['chatbot', 'discord', 'overlay', 'commands', 'shoutouts', 'sponsors', 'donations', 'protection', 'giveaways', 'polls', 'rewards', 'spotify'];`;
- after the function `ago`, add:

```js
// The poll bar's OBS link as the cards show it: without its scheme, and masked until Show (its token is a secret).
function pollBarLink(url) {
  if (!url) return null;
  const shown = url.replace(/^https?:\/\//, '');
  return { url, shown, masked: shown.replace(/\/overlay\/poll\/.*$/, `/overlay/poll/${'•'.repeat(12)}`) };
}

// A template's time as the card writes it: whole minutes, else seconds.
const timeLabel = (seconds) => (seconds >= 60 && seconds % 60 === 0
  ? label('cards.common.minutes', { minutes: seconds / 60 })
  : label('cards.common.seconds', { seconds }));
```

- `function overlayCard({ streamer, overlay })` becomes `function overlayCard({ streamer, overlay, polls })`, and its returned object gains `pollBar: pollBarLink(polls && polls.barUrl),` (after `masked: …,`);
- after the function `giveawaysCard`, add:

```js
// The Polls & predictions card's status line from what runs (livePolls.snapshot()). GET /dashboard/api/polls/live
// answers it too, so the line follows the live panel.
function pollsStatus(live, templateCount) {
  const busy = (view) => !!view && view.state !== 'ended';
  const poll = live && live.poll;
  const prediction = live && live.prediction;
  if (prediction && prediction.state === 'locked') return status('cards.polls.status.locked', 'warn');
  if (busy(poll) && busy(prediction)) return status('cards.polls.status.bothRunning');
  if (busy(poll)) return status('cards.polls.status.pollRunning');
  if (busy(prediction)) return status('cards.polls.status.predictionRunning');
  if (prediction) return status('cards.polls.status.predictionEnded');
  if (poll) return status('cards.polls.status.pollEnded');
  return status('cards.polls.status.ready', 'ok', { count: templateCount });
}

// The Polls & predictions card: its one setup step (link Twitch; reconnect for the two permissions; Check again after
// Twitch said the channel is not an Affiliate or Partner), else the templates (▶ off for a kind that runs), what runs on
// Twitch now (the page script keeps the live panel up to date), the announcements and their six texts, Twitch's limits
// for the pop-up, and the bar's OBS link with the overlay features.
function pollsCard({ streamer, polls, pollTemplates, features }) {
  let setup = null;
  if (!twitchLinked(streamer)) setup = 'linkTwitch';
  else if (!polls.hasScope) setup = 'reconnect';
  else if (streamer.cp_affiliate_status === 'not_affiliate') setup = 'notAffiliate';
  const live = polls.live || { poll: null, prediction: null, serverNow: null };
  const busy = (view) => !!view && view.state !== 'ended';
  let st = pollsStatus(live, pollTemplates.length);
  if (setup === 'linkTwitch') st = status('cards.polls.status.noTwitch', 'warn');
  else if (setup === 'reconnect') st = status('cards.polls.status.reconnect', 'warn');
  else if (setup === 'notAffiliate') st = status('cards.polls.status.notAffiliate', 'warn');
  const announce = !!streamer.polls_chat_enabled;
  return {
    setup,
    status: st,
    templates: pollTemplates.map((tpl) => ({
      id: tpl.id, kind: tpl.kind, title: tpl.title, choices: tpl.choices, durationSeconds: tpl.durationSeconds,
      pointsPerVote: tpl.pointsPerVote, time: timeLabel(tpl.durationSeconds),
    })),
    blocked: { poll: busy(live.poll), prediction: busy(live.prediction) },
    live,
    announce,
    chatNote: announce && !streamer.chatbot_enabled,
    texts: POLL_TEXTS.map((text) => ({ key: text.key, label: text.label, vars: text.vars, text: streamer[text.key] || '' })),
    limits: {
      poll: POLL_LIMITS.poll, prediction: POLL_LIMITS.prediction, pointsPerVote: POINTS_PER_VOTE,
      durations: DURATION_CHOICES, templatesMax: TEMPLATES_MAX,
    },
    bar: features.overlays ? pollBarLink(polls.barUrl) : null,
    counts: { templates: plain(pollTemplates.length) },
  };
}

// The Shoutouts card's example line, filled for a made-up channel.
const SHOUTOUT_SAMPLE = Object.freeze({ login: 'rivalracer', name: 'RivalRacer', game: 'iRacing', title: 'Night race at Spa' });

// The Shoutouts card: `!so @name` for moderators, the shoutout after a raid and its minimum, and the message (with
// Test in chat and an example line). Faded while the chatbot is off: the shoutouts are its lines.
function shoutoutsCard({ streamer }) {
  const command = !!streamer.shoutout_command_enabled;
  const raid = !!streamer.shoutout_raid_enabled;
  const viewers = Number(streamer.shoutout_raid_min_viewers) || 1;
  let st;
  if (command && raid) st = status('cards.shoutouts.status.both', 'ok', { viewers });
  else if (command) st = status('cards.shoutouts.status.command');
  else if (raid) st = status('cards.shoutouts.status.raid', 'ok', { viewers });
  else st = status('cards.shoutouts.status.off', 'off');
  const text = streamer.shoutout_template || '';
  return {
    needsChatbot: true,
    status: st,
    command,
    raid,
    viewers,
    viewerChoices: choices(RAID_MIN_VIEWERS, viewers),
    text,
    vars: ['{name}', '{game}', '{title}', '{link}'],
    sample: SHOUTOUT_SAMPLE,
    example: shoutoutLine(text, SHOUTOUT_SAMPLE),
    counts: {},
  };
}
```

- in `BUILDERS`, add `shoutouts: shoutoutsCard, polls: pollsCard,`;
- `module.exports` becomes `module.exports = { buildCards, cardTexts, pollsStatus, ORDER };`.

Run: `node --test src/services/dashboardCards.test.js` — Expected: PASS.

- [ ] **Step 4: The data, and the status line in the live answers, test first**

In `src/routes/polls.test.js`:
- in the test `'a template starts on Twitch; the card gets it back running and the bot announces it'`, add `assert.deepEqual(res.json().live.status, { text: t('en', 'cards.polls.status.pollRunning'), tone: 'ok' });`;
- in the test `'a poll started on Twitch\'s own dashboard shows, read from Twitch when no event came'`, add `assert.deepEqual(body.status, { text: t('en', 'cards.polls.status.pollRunning'), tone: 'ok' });`.

In `src/routes/dashboard.test.js`:
- in `twitchStub`, after `hasRedemptionScope: () => true,` add `hasPollsScope: () => false,`;
- in `describe('the data of the working cards', …)`, the order assertion becomes `assert.deepEqual(l.cards.order, ['chatbot', 'discord', 'overlay', 'commands', 'shoutouts', 'sponsors', 'donations', 'protection', 'giveaways', 'polls', 'rewards', 'spotify']);`, followed by `assert.equal(l.cards.polls.setup, 'reconnect', 'Twitch has not given the two permissions yet');` and `assert.equal(l.cards.shoutouts.status.key, 'cards.shoutouts.status.off');`;
- in the test `'GET /dashboard/api/cards answers each card\'s status and counts, translated, without the giveaway card'`, add `assert.deepEqual(body.cards.polls.status, { text: t('en', 'cards.polls.status.reconnect'), tone: 'warn' });` and `assert.deepEqual(body.cards.shoutouts.status, { text: t('en', 'cards.shoutouts.status.off'), tone: 'off' });`;
- in the test `'the Twitch tab: the account row, the last 7 days, then the cards in reading order'`, the expected titles become `[t('en', 'dashboard.cards.chatbot.title'), t('en', 'dashboard.cards.discord.title'), t('en', 'cards.commands.title'), t('en', 'cards.shoutouts.title'), t('en', 'sponsors.title'), t('en', 'dashboard.cards.donations.title'), t('en', 'cards.protection.title'), t('en', 'dashboard.cards.giveaways'), t('en', 'cards.polls.title'), 'Spotify']`;
- in the test `'switched on, the OBS overlay and rewards cards are in their places, …'`, they become `[t('en', 'dashboard.cards.chatbot.title'), t('en', 'dashboard.cards.discord.title'), t('en', 'dashboard.cards.overlay.title'), t('en', 'cards.commands.title'), t('en', 'cards.shoutouts.title'), t('en', 'sponsors.title'), t('en', 'dashboard.cards.donations.title'), t('en', 'cards.protection.title'), t('en', 'dashboard.cards.giveaways'), t('en', 'cards.polls.title'), t('en', 'dashboard.cards.cpRewards'), 'Spotify', t('en', 'dashboard.cards.multistream.title')]`;
- in the test `'every card says what state it is in, has at most one purple button, and every switch is labelled'`, `assert.equal(cards.length, 10);` becomes `assert.equal(cards.length, 12);`;
- in the test `'the cards that need the chatbot fade while it is off and say why'`, the list becomes `['commands', 'shoutouts', 'sponsors', 'protection', 'giveaways']`;
- in the test `'the OBS link is masked; the whole link is only in the copy button'`, the comment and count become:

```js
    // The token is on the tab exactly four times (data-shown and data-copy of the alerts' link and of the poll bar's,
    // both in the OBS overlay card; the Polls & predictions card shows the bar's link only once it can start polls).
    assert.equal(html.split('synthetic-token-wcp-mask').length - 1, 4);
```

- inside `describe('the working cards on the page', …)` (it has `pane`, `cardOf` and `linkedStreamer`), add:

```js
  test('the Shoutouts card: its switches and the raid minimum save as settings; the message as typed, with its example and test', async () => {
    const id = linkedStreamer({ chatbot_enabled: 1, shoutout_command_enabled: 1, shoutout_raid_min_viewers: 10, shoutout_template: '<b>Go</b> {name}' });
    const card = cardOf(await pane(id), 'shoutouts');
    assert.match(card, /data-setting="shoutout_command_enabled" checked>/);
    assert.match(card, /data-setting="shoutout_raid_enabled" >/);
    assert.match(card, /<select class="wc-select" data-setting="shoutout_raid_min_viewers"[^>]*>[\s\S]*?<option value="10" selected>/);
    assert.ok(card.includes('&lt;b&gt;Go&lt;/b&gt; {name}') && !card.includes('<b>Go</b>'));
    assert.ok(card.includes('&lt;b&gt;Go&lt;/b&gt; RivalRacer'), 'the example, as text');
    assert.ok(card.includes('data-key="shoutout_template"') && card.includes('data-test-line="/dashboard/shoutouts/test"'));
  });

  test('the Polls & predictions card: Reconnect without the two permissions; once it can, the templates as typed, the switch and the bar\'s link', async () => {
    const id = linkedStreamer({ overlay_token: 'synthetic-token-wcp-polls', polls_chat_enabled: 0 });
    db.addPollTemplate(id, { kind: 'poll', title: '<i>Top</i> 5?', choices: ['<b>Yes</b>', 'No 🏁'], durationSeconds: 120, pointsPerVote: null });
    const before = cardOf(await pane(id), 'polls');
    assert.ok(before.includes('href="/auth/broadcaster"') && before.includes(esc(t('en', 'cards.polls.setupReconnect'))));
    assert.ok(!before.includes('Top'), 'no templates before it can start them');
    const scope = twitchStub.hasPollsScope;
    twitchStub.hasPollsScope = () => true;
    try {
      const card = cardOf(await pane(id), 'polls');
      assert.ok(card.includes('&lt;i&gt;Top&lt;/i&gt; 5?') && !card.includes('<i>Top</i>'));
      assert.ok(card.includes('&lt;b&gt;Yes&lt;/b&gt; / No 🏁'));
      assert.match(card, /data-setting="polls_chat_enabled" >/);
      assert.match(card, /<code class="wc-link" data-masked="[^"]*\/overlay\/poll\/•{12}" data-shown="[^"]*\/overlay\/poll\/synthetic-token-wcp-polls\?lang=en">/);
      assert.ok(card.includes('/overlay/poll/synthetic-token-wcp-polls?lang=en"'));
    } finally {
      twitchStub.hasPollsScope = scope;
    }
  });

  test('the OBS overlay card shows the poll bar\'s link too, masked', async () => {
    const card = cardOf(await pane(linkedStreamer({ overlay_token: 'synthetic-token-wcp-bar' })), 'overlay');
    assert.match(card, /data-masked="[^"]*\/overlay\/poll\/•{12}" data-shown="[^"]*\/overlay\/poll\/synthetic-token-wcp-bar\?lang=en"/);
  });
```

In `tests/i18nViewsPart1.test.js`, in `sampleCards`, after `rewardsAccess: { hasScope: data.hasScope },` add:

```js
    pollTemplates: full ? [
      { id: 1, kind: 'poll', title: 'zzpoll', choices: ['zzyes', 'zzno'], durationSeconds: 120, pointsPerVote: null, sortOrder: 1 },
      { id: 2, kind: 'prediction', title: 'zzpred', choices: ['zzwin', 'zzlose'], durationSeconds: 90, pointsPerVote: null, sortOrder: 2 },
    ] : [],
    polls: { hasScope: full, live: { poll: null, prediction: null, serverNow: 0 }, barUrl: data.overlayUrl ? 'https://example.test/overlay/poll/zztoken?lang=en' : null },
```

In the same file, in `describe('while the overlay features are off, the pages say nothing about the overlays', …)`, the comment above `ABOUT_OVERLAYS` and the line `NOT_ABOUT_OVERLAYS` become (the template pop-up's "Extra votes with channel points" is about Twitch's poll box, not the overlay; every other new text avoids the words, and the bar's link stays covered):

```js
  // The wording that says a text is about the overlays. Left out: the multistream card, which names OBS because the
  // relay is fed from it, the layout's own site description (common.siteDescription, the link preview in
  // header.ejs), which is not a text of these pages, and the polls card's extra votes, which spend Twitch's channel
  // points in Twitch's own poll box (cards.polls.extraVotes).
  const ABOUT_OVERLAYS = /overlay|\bOBS\b|browser source|vtuber|channel point|tip goal|goal bar|progress bar/i;
  const NOT_ABOUT_OVERLAYS = /^(?:dashboard\.cards\.multistream\.|common\.siteDescription$|cards\.polls\.extraVotes$)/;
```

Run: `node --test src/routes/polls.test.js src/routes/dashboard.test.js tests/i18nViewsPart1.test.js` — Expected: FAIL (no status in the live answers; the dashboard cannot include `cards/shoutouts`).

- [ ] **Step 5: The data and the status line**

In `src/routes/dashboard.js`:
- `function gatherCards(req, discord) {` becomes `function gatherCards(req, discord, lang) {`; in it, `const { hasRedemptionScope } = require('../services/twitch');` becomes `const { hasRedemptionScope, hasPollsScope } = require('../services/twitch');`, add `const { livePolls } = require('../services/livePolls');` after it, and in the object passed to `buildCards`, after `rewardsAccess: { hasScope: hasRedemptionScope(s) },` add:

```js
    pollTemplates: db.getPollTemplates(s.id),
    polls: {
      hasScope: hasPollsScope(s),
      live: livePolls.snapshot(s.id),
      // The bar's texts follow the dashboard's language when the link is copied.
      barUrl: s.overlay_token ? `${config.app.url}/overlay/poll/${s.overlay_token}?lang=${encodeURIComponent(lang || 'en')}` : null,
    },
```

- `const cards = gatherCards(req, discordNotifications);` becomes `const cards = gatherCards(req, discordNotifications, res.locals.lang);`, and `cardTexts(gatherCards(req, discord), res.locals.t)` becomes `cardTexts(gatherCards(req, discord, res.locals.lang), res.locals.t)`.

In `src/routes/polls.js`:
- after `const { hasPollsScope } = require('../services/twitch');` add `const { pollsStatus } = require('../services/dashboardCards');`;
- after the function `needsPermissions`, add:

```js
// What runs, as the card shows it: the views and the card's status line.
function liveAnswer(req, res, live) {
  const st = pollsStatus(live, db.countPollTemplates(req.streamer.id));
  return { ...live, status: { text: res.locals.t(st.key, st.params), tone: st.tone } };
}
```

- in `act`, `res.json({ ok: true, live: livePolls.snapshot(req.streamer.id) });` becomes `res.json({ ok: true, live: liveAnswer(req, res, livePolls.snapshot(req.streamer.id)) });`;
- the live route becomes:

```js
router.get('/api/polls/live', needsPermissions, async (req, res) => {
  let live;
  try {
    live = await livePolls.live(req.streamer.id);
  } catch (err) {
    if (err && err.code === 'needs_reconnect') return refuse(res, 'needs_reconnect');
    throw err;
  }
  res.json({ ok: true, ...liveAnswer(req, res, live) });
});
```

- [ ] **Step 6: The markup**

In `src/views/cards/_icons.ejs`, before `</svg>`, add:

```html
  <symbol id="i-poll" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></symbol>
  <symbol id="i-at" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></symbol>
```

In `src/views/cards/_style.ejs`, right before the line `  /* The pop-up editor */`, add:

```css
  /* Polls & predictions (the approved mockup docs/superpowers/specs/assets/2026-10-15-polls-shoutouts-mockup.html):
     the kind tags, ▶, the live panel (drawn by public/js/dashboard-polls.js), the template pop-up's type and choices */
  .lp-kind { font: 700 10px var(--font-display); letter-spacing: .6px; text-transform: uppercase; color: #38bdf8; background: rgba(56,189,248,0.12); border: 1px solid rgba(56,189,248,0.3); padding: 2px 7px; border-radius: 999px; flex: none; }
  .lp-kind.pred { color: #c084fc; background: rgba(192,132,252,0.12); border-color: rgba(192,132,252,0.32); }
  .wc-row .lp-kind { margin-right: 2px; }
  .wc-ib.play { color: var(--success); }
  .wc-ib[disabled] { opacity: .35; cursor: not-allowed; }
  .wc-live-polls { display: flex; flex-direction: column; gap: 10px; }
  .wc-live-polls:empty { display: none; }
  .wc-live-poll { background: var(--bg-elevated); border: 1px solid rgba(56,189,248,0.25); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .wc-live-poll.pred { border-color: rgba(192,132,252,0.3); }
  .lp-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .lp-top b { font: 700 14px var(--font-display); color: var(--text-primary); overflow-wrap: anywhere; flex: 1; min-width: 0; }
  .lp-left { font: 700 13px var(--font-display); color: var(--success); background: rgba(62,207,142,0.1); padding: 2px 8px; border-radius: 999px; flex: none; }
  .lp-lock { font: 700 12px var(--font-display); color: var(--warning); background: var(--warning-bg); padding: 2px 8px; border-radius: 999px; flex: none; }
  .lp-opt { display: grid; grid-template-columns: minmax(56px, 30%) 1fr 40px; grid-template-areas: 'nm bar pc' 'nm ct ct'; align-items: center; column-gap: 8px; font-size: 13px; }
  .lp-opt .nm { grid-area: nm; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lp-opt .bar { grid-area: bar; height: 10px; background: var(--bg-base); border-radius: 99px; overflow: hidden; }
  .lp-opt .bar i { display: block; height: 100%; background: linear-gradient(90deg, #38bdf8, #9146ff); border-radius: 99px; transition: width .6s ease; }
  .lp-opt.lead .bar i { background: linear-gradient(90deg, #3ecf8e, #38bdf8); }
  .lp-opt.blue .bar i { background: linear-gradient(90deg, #387aff, #38bdf8); }
  .lp-opt.pink .bar i { background: linear-gradient(90deg, #f5009b, #f472b6); }
  .lp-opt .pc { grid-area: pc; font: 700 13px var(--font-display); color: var(--text-primary); text-align: right; }
  .lp-opt .ct { grid-area: ct; font-size: 11.5px; color: var(--text-muted); }
  .lp-foot, .lp-pick { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 12px; color: var(--text-muted); }
  .lp-foot > span:first-child, .lp-pick > span:first-child { margin-right: auto; }
  .lp-pick > span:first-child { color: var(--warning); font-weight: 700; }
  .wc-btn.wc-danger { color: var(--danger); }
  .wc-seg { display: inline-flex; align-self: flex-start; gap: 3px; padding: 3px; background: var(--bg-base); border: 1px solid var(--border); border-radius: 10px; }
  .wc-seg button { background: none; border: none; color: var(--text-secondary); font: 600 12px var(--font-display); padding: 6px 12px; border-radius: 7px; cursor: pointer; }
  .wc-seg button[aria-checked="true"] { background: var(--accent); color: #fff; }
  .wc-choices { display: flex; flex-direction: column; gap: 6px; }
  .wc-choice { display: flex; align-items: center; gap: 6px; }
  .wc-choice .wc-input { flex: 1; }
  .wc-left-count { font-style: normal; font-size: 11px; color: var(--text-muted); min-width: 24px; text-align: right; }
```

In `src/views/cards/overlay.ejs`, right before the line that starts `    <div class="wc-sec"><span class="wc-label"><%= t('cards.overlay.alerts') %></span>`, add:

```ejs
    <% if (card.pollBar) { %>
    <div class="wc-sec"><span class="wc-label"><%= t('cards.polls.bar') %></span></div>
    <div class="wc-linkbox">
      <code class="wc-link" data-masked="<%= card.pollBar.masked %>" data-shown="<%= card.pollBar.shown %>"><%= card.pollBar.masked %></code>
      <button type="button" class="btn btn-secondary wc-btn" data-reveal aria-pressed="false" title="<%= t('cards.overlay.reveal') %>" aria-label="<%= t('cards.overlay.reveal') %>"><svg class="i sm" aria-hidden="true"><use href="#i-eye"/></svg></button>
      <button type="button" class="btn btn-secondary wc-btn" data-copy="<%= card.pollBar.url %>"><svg class="i sm" aria-hidden="true"><use href="#i-copy"/></svg><span data-copy-label><%= t('dashboard.copy') %></span></button>
    </div>
    <% } %>
```

Create `src/views/cards/shoutouts.ejs`:

```ejs
<%# The Shoutouts card (dashboardCards.js shoutoutsCard()): `!so @name` for the broadcaster and moderators, the shoutout
    after a raid of at least N viewers, and the message: edited in the thank-you messages' pop-up, tried with Test in chat
    (a shoutout for the streamer's own channel, POST /dashboard/shoutouts/test), shown with an example line. Faded while
    the chatbot is off: the shoutouts are its lines. %>
<section class="card wc-card<%= cards.chatbotOn ? '' : ' needs-bot' %>" id="card-shoutouts" data-card="shoutouts" data-needs-chatbot aria-labelledby="card-shoutouts-title">
  <div class="wc-head">
    <div class="wc-icon" style="background: rgba(244,114,182,0.14); color: #f472b6"><svg class="i" aria-hidden="true"><use href="#i-at"/></svg></div>
    <div><h3 class="wc-title" id="card-shoutouts-title"><%= t('cards.shoutouts.title') %></h3><span class="wc-status<%= card.status.tone === 'ok' ? '' : ' ' + card.status.tone %>" data-status><%= t(card.status.key, card.status.params) %></span></div>
  </div>
  <div class="wc-needs"><svg class="i sm" aria-hidden="true"><use href="#i-chat"/></svg><%= t('cards.shoutouts.needsChatbot') %></div>
  <div class="wc-body">
    <div class="wc-switches">
      <div class="wc-sw<%= card.command ? ' is-on' : '' %>"><span><code>!so @name</code><small><%= t('cards.shoutouts.commandHint') %></small></span><label class="pill-toggle mini"><input type="checkbox" role="switch" aria-label="<%= t('cards.shoutouts.command') %>" data-setting="shoutout_command_enabled" <%= card.command ? 'checked' : '' %>><span class="slider"></span></label></div>
      <div class="wc-sw<%= card.raid ? ' is-on' : '' %>"><span><%= t('cards.shoutouts.raid') %><small><%= t('cards.shoutouts.raidHint') %></small></span><label class="pill-toggle mini"><input type="checkbox" role="switch" aria-label="<%= t('cards.shoutouts.raid') %>" data-setting="shoutout_raid_enabled" <%= card.raid ? 'checked' : '' %>><span class="slider"></span></label></div>
    </div>
    <div class="wc-setrow"><span><%= t('cards.shoutouts.raidFrom') %></span><select class="wc-select" data-setting="shoutout_raid_min_viewers" aria-label="<%= t('cards.shoutouts.raidFrom') %>"><% for (const v of card.viewerChoices) { %><option value="<%= v %>"<%= v === card.viewers ? ' selected' : '' %>><%= v === 1 ? t('cards.shoutouts.oneViewer') : t('cards.shoutouts.viewers', { count: v }) %></option><% } %></select></div>
    <div class="wc-sec"><span class="wc-label"><%= t('cards.shoutouts.message') %></span><button type="button" class="btn btn-secondary wc-btn xs" data-test-line="/dashboard/shoutouts/test"><%= t('chatbot.events.testInChat') %></button></div>
    <div class="wc-row">
      <span class="txt" data-text><%= card.text %></span>
      <button type="button" class="wc-ib" data-edit="thankyou" data-key="shoutout_template" data-test-url="/dashboard/shoutouts/test" data-vars="<%= card.vars.join(' ') %>" data-value="<%= card.text %>" data-title="<%= t('cards.shoutouts.editTitle') %>" title="<%= t('cards.shoutouts.edit') %>" aria-label="<%= t('cards.shoutouts.edit') %>"><svg class="i sm" aria-hidden="true"><use href="#i-pen"/></svg></button>
    </div>
    <p class="wc-hint" data-example data-sample="<%= JSON.stringify(card.sample) %>"><%= t('cards.shoutouts.example', { line: card.example }) %></p>
  </div>
  <div class="wc-msg" data-msg hidden></div>
  <div class="wc-foot"><span class="wc-saved" data-saved aria-hidden="true"><svg class="i sm" aria-hidden="true"><use href="#i-check"/></svg><%= t('cards.common.saved') %></span></div>
</section>
```

Create `src/views/cards/polls.ejs`:

```ejs
<%# The Polls & predictions card (dashboardCards.js pollsCard()): Twitch's own polls and predictions, started from saved
    templates (or once, unsaved, from the pop-up) and followed live: public/js/dashboard-polls.js draws the live panel
    from data-live and keeps it and the status line up to date (GET /dashboard/api/polls/live). The chat announcements
    and their six texts, and the bar's OBS link with the overlay features. Before it works, its one setup step: link
    Twitch, reconnect for the two permissions, or Check again after Twitch said the channel is not an Affiliate. What
    streamers typed and what Twitch sent is printed as text. %>
<section class="card wc-card" id="card-polls" data-card="polls" aria-labelledby="card-polls-title" data-live="<%= JSON.stringify(card.live) %>" data-limits="<%= JSON.stringify(card.limits) %>">
  <div class="wc-head">
    <div class="wc-icon" style="background: rgba(56,189,248,0.14); color: #38bdf8"><svg class="i" aria-hidden="true"><use href="#i-poll"/></svg></div>
    <div><h3 class="wc-title" id="card-polls-title"><%= t('cards.polls.title') %></h3><span class="wc-status<%= card.status.tone === 'ok' ? '' : ' ' + card.status.tone %>" data-status><%= t(card.status.key, card.status.params) %></span></div>
  </div>
  <div class="wc-body">
  <% if (card.setup === 'linkTwitch') { %>
    <div class="wc-empty"><span class="big"><svg class="i" aria-hidden="true"><use href="#i-twitch"/></svg></span><div><%= t('cards.polls.setupLink') %></div></div>
    <a href="/auth/twitch" class="btn btn-primary wc-btn block"><%= t('dashboard.linkTwitch') %></a>
  <% } else if (card.setup === 'reconnect') { %>
    <p class="wc-hint"><%= t('cards.polls.setupReconnect') %></p>
    <a href="/auth/broadcaster" class="btn btn-primary wc-btn block"><svg class="i sm" aria-hidden="true"><use href="#i-twitch"/></svg><%= t('dashboard.reconnectTwitch') %></a>
  <% } else if (card.setup === 'notAffiliate') { %>
    <p class="wc-hint"><%= t('cards.polls.setupAffiliate') %></p>
    <button type="button" class="btn btn-secondary wc-btn block" data-polls-recheck><%= t('cards.protection.checkAgain') %></button>
  <% } else { %>
    <div class="wc-live-polls" data-polls-live></div>
    <div class="wc-sec"><span class="wc-label"><%= t('cards.polls.templates') %></span><span class="wc-count" data-count="templates"><%= card.counts.templates.text %></span><button type="button" class="btn btn-primary wc-btn xs" data-add="poll-template" data-title="<%= t('cards.polls.newTitle') %>"><svg class="i sm" aria-hidden="true"><use href="#i-plus"/></svg><%= t('cards.polls.new') %></button></div>
    <div class="wc-list" id="wc-poll-templates" data-list="templates">
      <% for (const tpl of card.templates) { const blocked = card.blocked[tpl.kind]; %>
      <div class="wc-row" data-row data-id="<%= tpl.id %>" data-template="<%= JSON.stringify({ kind: tpl.kind, title: tpl.title, choices: tpl.choices, durationSeconds: tpl.durationSeconds, pointsPerVote: tpl.pointsPerVote }) %>">
        <span class="lp-kind<%= tpl.kind === 'prediction' ? ' pred' : '' %>" data-field="kind"><%= t(tpl.kind === 'prediction' ? 'cards.polls.kindPredictionShort' : 'cards.polls.kindPoll') %></span>
        <span class="nm" data-field="title"><%= tpl.title %></span>
        <span class="txt" data-field="summary"><%= tpl.choices.join(' / ') %> · <%= t(tpl.time.key, tpl.time.params) %></span>
        <button type="button" class="wc-ib play" data-start="<%= tpl.kind %>"<%= blocked ? ' disabled' : '' %> title="<%= t(blocked ? (tpl.kind === 'prediction' ? 'cards.polls.predictionRunningHint' : 'cards.polls.pollRunningHint') : 'cards.polls.start') %>" aria-label="<%= t('cards.polls.start') %>: <%= tpl.title %>"><svg class="i sm" aria-hidden="true"><use href="#i-play"/></svg></button>
        <button type="button" class="wc-ib" data-edit="poll-template" data-title="<%= t('cards.polls.editTitle') %>" title="<%= t('cards.polls.edit') %>" aria-label="<%= t('cards.polls.edit') %>: <%= tpl.title %>"><svg class="i sm" aria-hidden="true"><use href="#i-pen"/></svg></button>
        <button type="button" class="wc-ib" data-delete="poll-template" title="<%= t('cards.polls.delete') %>" aria-label="<%= t('cards.polls.delete') %>: <%= tpl.title %>"><svg class="i sm" aria-hidden="true"><use href="#i-trash"/></svg></button>
      </div>
      <% } %>
    </div>
    <p class="wc-hint" data-empty="templates"<%= card.templates.length ? ' hidden' : '' %>><%= t('cards.polls.none') %></p>
    <div class="wc-setrow">
      <label class="pill-toggle mini"><input type="checkbox" role="switch" aria-label="<%= t('cards.polls.announce') %>" data-setting="polls_chat_enabled" <%= card.announce ? 'checked' : '' %>><span class="slider"></span></label>
      <span><%= t('cards.polls.announce') %></span>
      <button type="button" class="wc-linkbtn" data-edit="poll-texts" data-title="<%= t('cards.polls.chatMessages') %>"><%= t('cards.polls.chatMessages') %> <svg class="i sm" aria-hidden="true"><use href="#i-right"/></svg></button>
    </div>
    <p class="wc-hint" data-polls-chat-note<%= card.chatNote ? '' : ' hidden' %>><%= t('cards.polls.needsChatbot') %></p>
    <% if (card.bar) { %>
    <div class="wc-sec"><span class="wc-label"><%= t('cards.polls.bar') %></span></div>
    <div class="wc-linkbox">
      <code class="wc-link" data-masked="<%= card.bar.masked %>" data-shown="<%= card.bar.shown %>"><%= card.bar.masked %></code>
      <button type="button" class="btn btn-secondary wc-btn" data-reveal aria-pressed="false" title="<%= t('cards.overlay.reveal') %>" aria-label="<%= t('cards.overlay.reveal') %>"><svg class="i sm" aria-hidden="true"><use href="#i-eye"/></svg></button>
      <button type="button" class="btn btn-secondary wc-btn" data-copy="<%= card.bar.url %>"><svg class="i sm" aria-hidden="true"><use href="#i-copy"/></svg><span data-copy-label><%= t('dashboard.copy') %></span></button>
    </div>
    <% } %>
  <% } %>
  </div>
  <div class="wc-msg" data-msg hidden></div>
  <div class="wc-foot"><span class="wc-saved" data-saved aria-hidden="true"><svg class="i sm" aria-hidden="true"><use href="#i-check"/></svg><%= t('cards.common.saved') %></span></div>
  <% if (!card.setup) { %>
  <template id="tpl-poll-template">
    <div class="wc-editor">
      <h4 id="wc-dialog-title" data-title></h4>
      <div class="wc-seg" role="radiogroup" aria-label="<%= t('cards.polls.type') %>">
        <button type="button" role="radio" aria-checked="true" data-kind="poll"><%= t('cards.polls.kindPoll') %></button>
        <button type="button" role="radio" aria-checked="false" data-kind="prediction"><%= t('cards.polls.kindPrediction') %></button>
      </div>
      <label class="wc-field"><span><%= t('cards.polls.question') %> <em data-left-for="title"></em></span><input class="wc-input" data-field="title" autocomplete="off"></label>
      <div class="wc-field"><span><span data-label-for="poll"><%= t('cards.polls.choices') %></span><span data-label-for="prediction" hidden><%= t('cards.polls.outcomes') %></span></span>
        <div class="wc-choices" data-choices></div>
        <button type="button" class="wc-more" data-add-choice><%= t('cards.polls.addChoice') %></button>
      </div>
      <div class="wc-fields">
        <label class="wc-field"><span><%= t('cards.polls.time') %></span><select class="wc-select" data-field="durationSeconds"></select></label>
        <div class="wc-field" data-poll-only><span><%= t('cards.polls.extraVotes') %></span><label class="pill-toggle mini"><input type="checkbox" role="switch" data-field="pointsOn" aria-label="<%= t('cards.polls.extraVotes') %>"><span class="slider"></span></label></div>
        <label class="wc-field" data-poll-only data-points-field hidden><span><%= t('cards.polls.pointsPerVote') %></span><input class="wc-input" type="number" min="1" max="1000000" step="1" data-field="pointsPerVote"></label>
      </div>
      <div class="wc-actions"><button type="button" class="btn btn-secondary wc-btn wc-left" data-start-once><%= t('cards.polls.startOnce') %></button><button type="button" class="btn btn-secondary wc-btn" data-cancel><%= t('cards.common.cancel') %></button><button type="button" class="btn btn-primary wc-btn" data-save><%= t('cards.common.save') %></button></div>
      <div class="wc-msg" data-dialog-msg role="alert" hidden></div>
    </div>
  </template>
  <template id="tpl-poll-choice">
    <div class="wc-choice"><input class="wc-input" data-choice autocomplete="off" aria-label="<%= t('cards.polls.choices') %>"><em class="wc-left-count" data-left></em><button type="button" class="wc-ib" data-remove-choice title="<%= t('cards.polls.removeChoice') %>" aria-label="<%= t('cards.polls.removeChoice') %>"><svg class="i sm" aria-hidden="true"><use href="#i-trash"/></svg></button></div>
  </template>
  <template id="tpl-poll-template-row">
    <div class="wc-row" data-row>
      <span class="lp-kind" data-field="kind"></span><span class="nm" data-field="title"></span><span class="txt" data-field="summary"></span>
      <button type="button" class="wc-ib play" data-start title="<%= t('cards.polls.start') %>" aria-label="<%= t('cards.polls.start') %>"><svg class="i sm" aria-hidden="true"><use href="#i-play"/></svg></button>
      <button type="button" class="wc-ib" data-edit="poll-template" data-title="<%= t('cards.polls.editTitle') %>" title="<%= t('cards.polls.edit') %>" aria-label="<%= t('cards.polls.edit') %>"><svg class="i sm" aria-hidden="true"><use href="#i-pen"/></svg></button>
      <button type="button" class="wc-ib" data-delete="poll-template" title="<%= t('cards.polls.delete') %>" aria-label="<%= t('cards.polls.delete') %>"><svg class="i sm" aria-hidden="true"><use href="#i-trash"/></svg></button>
    </div>
  </template>
  <template id="tpl-poll-texts">
    <div class="wc-editor">
      <h4 id="wc-dialog-title" data-title></h4>
      <p class="wc-hint"><%= t('cards.polls.textsHint') %></p>
      <% for (const text of card.texts) { %>
      <label class="wc-field"><span><%= t(text.label) %></span><textarea data-text-key="<%= text.key %>" data-vars="<%= text.vars.join(' ') %>" maxlength="500" rows="2"><%= text.text %></textarea></label>
      <% } %>
      <div class="wc-vars"><span><%= t('cards.chatbot.insert') %></span><span data-vars></span></div>
      <div class="wc-actions"><button type="button" class="btn btn-secondary wc-btn" data-cancel><%= t('cards.common.cancel') %></button><button type="button" class="btn btn-primary wc-btn" data-save><%= t('cards.common.save') %></button></div>
      <div class="wc-msg" data-dialog-msg role="alert" hidden></div>
    </div>
  </template>
  <% } %>
</section>
```

Run: `node --test src/services/dashboardCards.test.js src/routes/polls.test.js src/routes/dashboard.test.js tests/i18nViewsPart1.test.js tests/i18n.test.js src/csrf.test.js tests/headerView.test.js tests/scriptEmbeds.test.js` — Expected: PASS.

- [ ] **Step 7: The full suite, then commit**

Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` — Expected: PASS.

```bash
git add src/services/dashboardCards.js src/services/dashboardCards.test.js src/routes/dashboard.js src/routes/polls.js src/routes/polls.test.js src/views/cards/polls.ejs src/views/cards/shoutouts.ejs src/views/cards/_icons.ejs src/views/cards/_style.ejs src/views/cards/overlay.ejs src/routes/dashboard.test.js tests/i18nViewsPart1.test.js src/locales/en.json src/locales/pt.json src/locales/es.json src/locales/fr.json src/locales/de.json src/locales/zh.json src/locales/ja.json
git commit -m "feat(polls): the Polls & predictions and Shoutouts cards on the Twitch tab"
```

---

### Task 11: The page scripts — the live panel, the templates, the chat texts and the shoutout's test

**Files:**
- Create: `public/js/dashboard-polls.js`
- Modify: `public/js/dashboard-cards.js` (a message's own test route, the example line, Test in chat buttons of their own, the helpers it shares), `public/js/dashboard-cards-core.js` (four pure helpers), `tests/dashboardCardsCore.test.js`
- Modify: `src/views/dashboard.ejs` (the texts table, the two scripts), `src/routes/dashboard.test.js`
- Modify: `src/locales/*.json`

**Interfaces:**
- Consumes: the markup hooks of Task 10; the routes of Tasks 6 and 8 (with Task 10's `status`); `window.PollBarModel.render/clock` (Task 9, `public/overlay/pollModel.js`).
- Produces: `window.ATLETA_CARD_UI` (frozen: `T, core, $, $$, call, onClick, announce, showMessage, clearMessage, showSaved, refreshSoon, repack, openEditor, closeEditor, dialogMessage, insertAtCursor, nextVisibleRow, focusAfterDelete` — the working cards' own helpers, unchanged); `core.pollTime(seconds, P)`, `core.templateSummary(template, P)`, `core.pollResultLine(view, P, locale)`, `core.pollsRefreshMs(live)`; the texts `ATLETA_CARD_TEXTS.polls.*` and `ATLETA_CARD_TEXTS.shoutoutExample`.
- In the thank-you pop-up, a button's `data-test-url` names its test route (else the thank-you test of its `data-event`; with neither, no test button). A button with `data-test-line` posts to that route and says "Sent to your chat".

- [ ] **Step 1: The script's texts**

Write `/tmp/polls-task11-keys.json` (outside the repository):

```json
{
  "cards.polls.started": "Started on Twitch",
  "cards.polls.endNow": "End now",
  "cards.polls.lockNow": "Lock now",
  "cards.polls.cancelRefund": "Cancel and refund",
  "cards.polls.confirmCancel": "Cancel this prediction? Everyone gets their points back.",
  "cards.polls.whoWon": "Who won?",
  "cards.polls.outcomeWon": "{{outcome}} won",
  "cards.polls.locked": "Locked",
  "cards.polls.votes": "{{count}} votes",
  "cards.polls.pointsShort": "{{points}} pts · {{viewers}}",
  "cards.polls.totalPoints": "{{count}} points",
  "cards.polls.confirmDelete": "Delete the template “{{title}}”?",
  "cards.polls.left": "{{count}} left",
  "cards.polls.result.pollWon": "{{winner}} won with {{percent}}% of the votes ({{votes}})",
  "cards.polls.result.tie": "Tie: {{winner}}",
  "cards.polls.result.none": "Nobody voted",
  "cards.polls.result.predictionWon": "{{outcome}} wins — {{winners}} viewers share {{points}} points",
  "cards.polls.result.cancelled": "Cancelled — everyone got their points back"
}
```

Run: `node scripts/locale-keys.js add /tmp/polls-task11-keys.json`.

- [ ] **Step 2: The pure helpers, test first**

In `tests/dashboardCardsCore.test.js`, in `describe('the browser files', …)`, the list becomes `['dashboard-cards-core.js', 'dashboard-cards.js', 'dashboard-polls.js']`, and before that `describe` add:

```js
describe('the Polls & predictions card', () => {
  const P = {
    minutes: '{{minutes}} min', seconds: '{{seconds}} s',
    resultPollWon: '{{winner}} won with {{percent}}% of the votes ({{votes}})', resultTie: 'Tie: {{winner}}', resultNone: 'Nobody voted',
    resultPredictionWon: '{{outcome}} wins — {{winners}} viewers share {{points}} points',
    resultCancelled: 'Cancelled — everyone got their points back',
  };
  const ended = (kind, result, options, total = 0) => ({ kind, state: 'ended', result, options, total });

  test('a template\'s time and its row', () => {
    assert.equal(core.pollTime(120, P), '2 min');
    assert.equal(core.pollTime(30, P), '30 s');
    assert.equal(core.pollTime(90, P), '90 s');
    assert.equal(core.templateSummary({ choices: ['Yes', 'No'], durationSeconds: 300 }, P), 'Yes / No · 5 min');
  });

  test('the line of what ended: the winner, a tie, nobody, the prediction\'s winners, a cancel; nothing while it runs', () => {
    assert.equal(core.pollResultLine(ended('poll', 'won', [{ title: 'Yes', percent: 64, votes: 1048, won: true }, { title: 'No', percent: 36, votes: 27 }]), P, 'en'), 'Yes won with 64% of the votes (1,048)');
    assert.equal(core.pollResultLine(ended('poll', 'tie', [{ title: 'A', won: true }, { title: 'B', won: true }]), P, 'en'), 'Tie: A / B');
    assert.equal(core.pollResultLine(ended('poll', 'none', [{ title: 'A' }, { title: 'B' }]), P, 'en'), 'Nobody voted');
    assert.equal(core.pollResultLine(ended('prediction', 'won', [{ title: 'Clean', users: 18, won: true }, { title: 'Chaos', users: 9 }], 17500), P, 'en'), 'Clean wins — 18 viewers share 17,500 points');
    assert.equal(core.pollResultLine(ended('prediction', 'canceled', [{ title: 'Clean' }]), P, 'en'), 'Cancelled — everyone got their points back');
    assert.equal(core.pollResultLine({ kind: 'poll', state: 'running', options: [] }, P, 'en'), '');
    assert.equal(core.pollResultLine(null, P, 'en'), '');
  });

  test('it asks again every 2 seconds while something runs or just ended, else every 10', () => {
    assert.equal(core.pollsRefreshMs({ poll: { state: 'running' }, prediction: null }), 2000);
    assert.equal(core.pollsRefreshMs({ poll: null, prediction: { state: 'ended' } }), 2000);
    assert.equal(core.pollsRefreshMs({ poll: null, prediction: null }), 10000);
    assert.equal(core.pollsRefreshMs(null), 10000);
  });
});
```

Run: `node --test tests/dashboardCardsCore.test.js` — Expected: FAIL (`core.pollTime is not a function`; `dashboard-polls.js` does not exist).

In `public/js/dashboard-cards-core.js`, right before `const CARDS = {`, add:

```js
  // ── The Polls & predictions card (public/js/dashboard-polls.js); P is its texts table ──

  // A template's or a time choice's time: whole minutes, else seconds.
  function pollTime(seconds, P) {
    return seconds >= 60 && seconds % 60 === 0 ? fill(P.minutes, { minutes: seconds / 60 }) : fill(P.seconds, { seconds });
  }

  // A template's row: its choices, then its time ("Yes / No · 2 min").
  function templateSummary(template, P) {
    return `${(template.choices || []).join(' / ')} · ${pollTime(Number(template.durationSeconds) || 0, P)}`;
  }

  // The card's line for a poll or prediction that ended (shown 30 seconds), or ''.
  function pollResultLine(view, P, locale) {
    if (!view || view.state !== 'ended') return '';
    const number = (n) => Number(n || 0).toLocaleString(locale || 'en');
    const won = (view.options || []).filter((option) => option.won);
    if (view.result === 'canceled') return fill(P.resultCancelled, {});
    if (won.length === 0) return fill(P.resultNone, {});
    if (view.kind === 'prediction') return fill(P.resultPredictionWon, { outcome: won[0].title, winners: number(won[0].users), points: number(view.total) });
    if (view.result === 'tie') return fill(P.resultTie, { winner: won.map((option) => option.title).join(' / ') });
    return fill(P.resultPollWon, { winner: won[0].title, percent: won[0].percent, votes: number(won[0].votes) });
  }

  // How long the card waits before it asks what runs again: 2 s while something runs or just ended, else 10 s.
  function pollsRefreshMs(live) {
    return live && (live.poll || live.prediction) ? 2000 : 10000;
  }
```

and `const CARDS = { rowSpan, fill, readAnswer, createLatestQueue, formatLeft, parseUtc };` becomes `const CARDS = { rowSpan, fill, readAnswer, createLatestQueue, formatLeft, parseUtc, pollTime, templateSummary, pollResultLine, pollsRefreshMs };`.

- [ ] **Step 3: The shared page script**

In `public/js/dashboard-cards.js`:

(a) In the thank-you pop-up (`onClick('[data-edit="thankyou"]', …)`), the block from the comment `// Posts the saved message in the streamer's chat with example values (the chatbot page's test). The route posts` down to `const answer = await call('POST', '/dashboard/chatbot/test/' + encodeURIComponent(button.dataset.event));` becomes:

```js
      // Posts the saved message in the streamer's chat: with example values for a thank-you (the chatbot page's test),
      // or through the route the button names (data-test-url: the shoutout's). The route posts the saved text, so while
      // the box holds another one (spaces around it aside: a save trims them) the pop-up asks to save first instead. A
      // message without a test has no button.
      const test = $('[data-chat-test]', editor);
      const testUrl = button.dataset.testUrl || (button.dataset.event ? '/dashboard/chatbot/test/' + encodeURIComponent(button.dataset.event) : '');
      test.hidden = !testUrl;
      test.addEventListener('click', async () => {
        if (area.value.trim() !== (button.dataset.value || '').trim()) {
          dialogMessage(editor, T.saveFirst);
          return;
        }
        const answer = await call('POST', testUrl);
```

(b) In the same pop-up's save, after `$('[data-text]', row).textContent = answer.data.value;` add `showExample(card, answer.data.value);`, and right after the end of the whole `onClick('[data-edit="thankyou"]', …);` statement (before `// ── Commands ──`) add:

```js
  // A card's example line (data-example, the Shoutouts card): the saved text filled in for its made-up channel
  // (data-sample), as the bot fills a shoutout.
  function showExample(card, text) {
    const box = card && $('[data-example]', card);
    if (!box) return;
    let sample = {};
    try { sample = JSON.parse(box.dataset.sample || '{}'); } catch (e) { sample = {}; }
    const values = { name: sample.name, game: sample.game, title: sample.title, link: 'https://twitch.tv/' + (sample.login || '') };
    const line = String(text || '').replace(/\{(\w+)\}/g, (all, key) => (values[key] !== undefined ? values[key] : all));
    box.textContent = core.fill(T.shoutoutExample, { line });
  }

  // A Test in chat button of its own (data-test-line names the route: the Shoutouts card's).
  onClick('[data-test-line]', async (button) => {
    const card = button.closest('.wc-card');
    const answer = await call('POST', button.dataset.testLine, {});
    if (!answer.ok) {
      showMessage(card, answer);
      return;
    }
    clearMessage(card);
    flash(button, T.sentToChat);
  });
```

(c) Right before `// ── Start ──`, add:

```js
  // The helpers the Polls & predictions card's script (public/js/dashboard-polls.js) builds on.
  window.ATLETA_CARD_UI = Object.freeze({
    T, core, $, $$, call, onClick, announce, showMessage, clearMessage, showSaved, refreshSoon, repack,
    openEditor, closeEditor, dialogMessage, insertAtCursor, nextVisibleRow, focusAfterDelete,
  });
```

- [ ] **Step 4: The polls card's script**

Create `public/js/dashboard-polls.js`:

```js
'use strict';

// The Polls & predictions card (views/cards/polls.ejs). The live panel of what runs on Twitch, drawn with the bar's own
// model (public/overlay/pollModel.js) from the card's data-live, then from GET /dashboard/api/polls/live: every 2 s while
// something runs or just ended, every 10 s otherwise, never while the tab is hidden. Its buttons (End now, Lock now,
// the winner, Cancel and refund) and the templates' ▶ send one request at a time. The template pop-up adds or changes a
// template or starts one once; the chat messages pop-up saves the six texts together; Check again follows Twitch's
// "not an Affiliate". Built on the working cards' page script (window.ATLETA_CARD_UI, dashboard-cards.js): its
// requests, pop-up and messages. Texts: window.ATLETA_CARD_TEXTS.polls. What Twitch sent or the streamer typed is set
// as text. Served as it is (no build step).
(function () {
  const ui = window.ATLETA_CARD_UI;
  const model = window.PollBarModel;
  const card = document.getElementById('card-polls');
  if (!ui || !model || !card) return;
  const T = ui.T || {};
  const P = T.polls || {};
  const { $, $$, core, call } = ui;
  const locale = document.documentElement.lang || 'en';

  // ── Check again (Twitch said the channel is not an Affiliate or Partner) ──

  ui.onClick('[data-polls-recheck]', async (button) => {
    button.disabled = true;
    const answer = await call('POST', '/dashboard/api/polls/affiliate-check', {});
    if (answer.ok) {
      window.location.reload();
      return;
    }
    button.disabled = false;
    ui.showMessage(card, answer);
  });

  const panelBox = $('[data-polls-live]', card);
  const list = $('[data-list="templates"]', card);
  if (!panelBox || !list) return; // a setup step: nothing else on the card
  const limits = JSON.parse(card.dataset.limits || '{}');

  // ── What runs ──

  let live = JSON.parse(card.dataset.live || '{}');
  let offset = typeof live.serverNow === 'number' ? live.serverNow - Date.now() : 0; // the server's clock minus this one
  const now = () => Date.now() + offset;
  const running = (view) => !!view && view.state !== 'ended';
  let busy = false; // a panel button's request is on its way
  let starting = false; // a start is on its way
  let timer = null;

  // The texts pollModel.render() fills for the card (the bar has its own).
  const panelTexts = {
    poll: P.kindPoll, prediction: P.kindPrediction, locked: P.locked, result: '', votes: P.votes, pointsViewers: P.pointsShort,
    pollFoot: P.votes, predictionFoot: P.totalPoints, winners: P.pointsShort, tie: '', noVotes: '', cancelled: '',
  };
  const panels = { poll: null, prediction: null }; // drawn: { key, root, corner, rows: [{ row, fill, pc, ct }], total }
  const resultLine = document.createElement('div');
  resultLine.className = 'wc-winner';
  resultLine.setAttribute('role', 'status');
  panelBox.append(resultLine);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function action(className, text, data) {
    const button = el('button', `btn ${className} wc-btn xs`, text);
    button.type = 'button';
    Object.assign(button.dataset, data);
    return button;
  }

  // A running or locked poll or prediction: its kind, title and time left (or Locked), each choice with its bar, and
  // its buttons.
  function buildPanel(view) {
    const isPoll = view.kind === 'poll';
    const root = el('div', isPoll ? 'wc-live-poll' : 'wc-live-poll pred');
    const top = el('div', 'lp-top');
    const corner = el('span', view.state === 'locked' ? 'lp-lock' : 'lp-left');
    top.append(el('span', isPoll ? 'lp-kind' : 'lp-kind pred', isPoll ? P.kindPoll : P.kindPrediction), el('b', '', view.title), corner);
    root.append(top);
    const rows = view.options.map((option) => {
      const row = el('div', 'lp-opt');
      const bar = el('span', 'bar');
      const fill = el('i');
      bar.append(fill);
      const pc = el('span', 'pc');
      const ct = el('span', 'ct');
      row.append(el('span', 'nm', option.title), bar, pc, ct);
      root.append(row);
      return { row, fill, pc, ct };
    });
    if (view.state === 'locked') {
      const pick = el('div', 'lp-pick');
      pick.append(el('span', '', P.whoWon));
      for (const option of view.options) {
        pick.append(action('btn-primary', core.fill(P.outcomeWon, { outcome: option.title }), { predictionWinner: option.id, predictionId: view.id }));
      }
      root.append(pick);
    }
    const foot = el('div', 'lp-foot');
    const total = el('span');
    foot.append(total);
    if (isPoll) {
      foot.append(action('btn-secondary', P.endNow, { pollEnd: view.id }));
    } else {
      if (view.state === 'running') foot.append(action('btn-secondary', P.lockNow, { predictionLock: view.id }));
      foot.append(action('btn-secondary wc-danger', P.cancelRefund, { predictionCancel: view.id }));
    }
    root.append(foot);
    return { root, corner, rows, total };
  }

  // Draws what runs: a panel per running or locked poll and prediction (built anew only when it changes, so its bars
  // glide and a focused button stays), and the line of what ended in the last 30 seconds.
  function draw() {
    const t = now();
    let moved = false;
    for (const kind of ['poll', 'prediction']) {
      const view = running(live[kind]) ? live[kind] : null;
      let panel = panels[kind];
      if (!view) {
        if (panel) {
          panel.root.remove();
          panels[kind] = null;
          moved = true;
        }
        continue;
      }
      const key = `${view.id}:${view.state}:${view.options.length}`;
      if (!panel || panel.key !== key) {
        if (panel) panel.root.remove();
        panel = { key, ...buildPanel(view) };
        panels[kind] = panel;
        panelBox.insertBefore(panel.root, kind === 'poll' ? panelBox.firstChild : resultLine);
        moved = true;
      }
      const drawn = model.render(view, t, panelTexts, locale);
      panel.corner.textContent = drawn.corner.text;
      drawn.rows.forEach((r, i) => {
        const row = panel.rows[i];
        row.row.className = 'lp-opt' + (r.color ? ' ' + r.color : '') + (r.lead ? ' lead' : '');
        row.fill.style.width = r.percent + '%';
        row.pc.textContent = r.percent + '%';
        row.ct.textContent = r.extra;
      });
      panel.total.textContent = drawn.footer;
      if (busy) $$('button', panel.root).forEach((button) => { button.disabled = true; });
    }
    const ended = [live.prediction, live.poll].find((view) => view && view.state === 'ended');
    const line = ended ? core.pollResultLine(ended, P, locale) : '';
    if (resultLine.textContent !== line) {
      resultLine.textContent = line;
      moved = true;
    }
    resultLine.classList.toggle('show', !!line);
    if (moved) ui.repack();
  }

  // The ▶ of a kind that runs (or waits for its winner) is off, saying why; every ▶ is off while a start is on its way.
  function syncStarts() {
    const blocked = { poll: running(live.poll), prediction: running(live.prediction) };
    for (const start of $$('[data-start]', list)) {
      const kind = start.dataset.start;
      start.disabled = starting || !!blocked[kind];
      start.title = blocked[kind] ? (kind === 'prediction' ? P.predictionRunningHint : P.pollRunningHint) : P.start;
    }
  }

  function showStatus(status) {
    const line = $('[data-status]', card);
    if (!line || !status) return;
    line.textContent = status.text;
    line.className = 'wc-status' + (status.tone === 'ok' ? '' : ' ' + status.tone);
  }

  // What the server answered about what runs: { poll, prediction, serverNow, status }.
  function take(data) {
    live = { poll: data.poll || null, prediction: data.prediction || null, serverNow: data.serverNow };
    if (typeof data.serverNow === 'number') offset = data.serverNow - Date.now();
    showStatus(data.status);
    syncStarts();
    draw();
  }

  function schedule() {
    clearTimeout(timer);
    if (!document.hidden) timer = setTimeout(refresh, core.pollsRefreshMs(live));
  }
  async function refresh() {
    clearTimeout(timer);
    const answer = await call('GET', '/dashboard/api/polls/live');
    if (answer.ok) {
      take(answer.data);
    } else if (answer.kind === 'session' || answer.code === 'needs_reconnect') {
      ui.showMessage(card, answer); // the page has to be loaded again: stop asking
      return;
    }
    schedule();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(timer);
    else refresh();
  });
  setInterval(() => {
    if (running(live.poll) || running(live.prediction)) draw(); // the time left
  }, 1000);

  // ── The live panel's buttons: one request at a time ──

  async function act(url, body) {
    if (busy) return;
    busy = true;
    $$('button', panelBox).forEach((button) => { button.disabled = true; });
    let answer;
    try {
      answer = await call('POST', url, body);
    } finally {
      busy = false;
      $$('button', panelBox).forEach((button) => { button.disabled = false; });
    }
    if (!answer.ok) {
      ui.showMessage(card, answer);
      refresh(); // Twitch may have moved on meanwhile: show where it stands
      return;
    }
    ui.clearMessage(card);
    take(answer.data.live);
    schedule();
  }
  ui.onClick('[data-poll-end]', (button) => act('/dashboard/api/polls/end', { id: button.dataset.pollEnd }));
  ui.onClick('[data-prediction-lock]', (button) => act('/dashboard/api/predictions/lock', { id: button.dataset.predictionLock }));
  ui.onClick('[data-prediction-winner]', (button) => act('/dashboard/api/predictions/resolve', { id: button.dataset.predictionId, outcomeId: button.dataset.predictionWinner }));
  ui.onClick('[data-prediction-cancel]', (button) => {
    if (window.confirm(P.confirmCancel)) act('/dashboard/api/predictions/cancel', { id: button.dataset.predictionCancel });
  });

  // ── Starting: a template's ▶, or the pop-up's Start without saving ──

  // Resolves to the answer, or null while another start is on its way.
  async function start(body) {
    if (starting) return null;
    starting = true;
    syncStarts();
    let answer;
    try {
      answer = await call('POST', '/dashboard/api/polls/start', body);
    } finally {
      starting = false;
    }
    if (answer.ok) {
      ui.clearMessage(card);
      take(answer.data.live);
      ui.announce(P.started);
      schedule();
    } else {
      syncStarts();
    }
    return answer;
  }
  ui.onClick('[data-start]', async (button) => {
    const answer = await start({ templateId: Number(button.closest('[data-row]').dataset.id) });
    if (answer && !answer.ok) ui.showMessage(card, answer);
  });

  // ── Templates ──

  function fillTemplateRow(row, template) {
    row.dataset.id = template.id;
    row.dataset.template = JSON.stringify({
      kind: template.kind, title: template.title, choices: template.choices, durationSeconds: template.durationSeconds, pointsPerVote: template.pointsPerVote,
    });
    const tag = $('[data-field="kind"]', row);
    tag.className = template.kind === 'prediction' ? 'lp-kind pred' : 'lp-kind';
    tag.textContent = template.kind === 'prediction' ? P.kindPredictionShort : P.kindPoll;
    $('[data-field="title"]', row).textContent = template.title;
    $('[data-field="summary"]', row).textContent = core.templateSummary(template, P);
    const startButton = $('[data-start]', row);
    startButton.dataset.start = template.kind;
    startButton.setAttribute('aria-label', P.start + ': ' + template.title);
    $('[data-edit="poll-template"]', row).setAttribute('aria-label', P.edit + ': ' + template.title);
    $('[data-delete="poll-template"]', row).setAttribute('aria-label', P.delete + ': ' + template.title);
  }

  // After a template is added, changed or deleted: the count, the empty hint and the ▶ states; the status line counts
  // the templates too.
  function afterTemplatesChange() {
    const rows = $$('[data-row]', list);
    const count = $('[data-count="templates"]', card);
    if (count) count.textContent = String(rows.length);
    const empty = $('[data-empty="templates"]', card);
    if (empty) empty.hidden = rows.length > 0;
    syncStarts();
    ui.clearMessage(card);
    ui.showSaved(card);
    ui.refreshSoon();
    ui.repack();
  }

  // The template pop-up's fields, within the kind's limits: the question with the characters left, the choices (Add a
  // choice and the remove buttons follow Twitch's counts), the time (the kind's choices; a saved one outside them stays
  // one) and, for a poll, the channel-points votes. Start without saving runs it once. Returns what the fields say.
  function setupTemplateForm(editor, saved) {
    let kind = saved ? saved.kind : 'poll';
    const title = $('[data-field="title"]', editor);
    const titleLeft = $('[data-left-for="title"]', editor);
    const choices = $('[data-choices]', editor);
    const addChoice = $('[data-add-choice]', editor);
    const duration = $('[data-field="durationSeconds"]', editor);
    const pointsOn = $('[data-field="pointsOn"]', editor);
    const points = $('[data-field="pointsPerVote"]', editor);
    const limit = () => limits[kind] || {};
    const left = (input, counter, max) => {
      counter.textContent = core.fill(P.left, { count: max - Array.from(input.value).length });
    };
    const choiceInputs = () => $$('[data-choice]', choices);

    function syncChoices() {
      const inputs = choiceInputs();
      addChoice.hidden = inputs.length >= limit().maxChoices;
      $$('[data-remove-choice]', choices).forEach((button) => { button.hidden = inputs.length <= limit().minChoices; });
      inputs.forEach((input) => left(input, $('[data-left]', input.parentNode), limit().choiceMax));
    }
    function addChoiceRow(text) {
      const row = document.getElementById('tpl-poll-choice').content.firstElementChild.cloneNode(true);
      const input = $('[data-choice]', row);
      input.value = text || '';
      input.addEventListener('input', () => left(input, $('[data-left]', row), limit().choiceMax));
      $('[data-remove-choice]', row).addEventListener('click', () => {
        row.remove();
        syncChoices();
      });
      choices.append(row);
      return input;
    }
    function fillDurations(value) {
      const range = limit();
      const options = [...new Set([...((limits.durations || {})[kind] || []), value])]
        .filter((s) => Number.isInteger(s) && s >= range.minSeconds && s <= range.maxSeconds)
        .sort((a, b) => a - b);
      duration.replaceChildren(...options.map((s) => {
        const option = document.createElement('option');
        option.value = String(s);
        option.textContent = core.pollTime(s, P);
        return option;
      }));
      duration.value = String(options.includes(value) ? value : options[0]);
    }
    function setKind(next) {
      const keep = Number(duration.value) || (saved ? saved.durationSeconds : 120);
      kind = next;
      $$('[data-kind]', editor).forEach((button) => button.setAttribute('aria-checked', String(button.dataset.kind === kind)));
      $$('[data-label-for]', editor).forEach((label) => { label.hidden = label.dataset.labelFor !== kind; });
      $$('[data-poll-only]', editor).forEach((field) => {
        field.hidden = kind !== 'poll' || (field.hasAttribute('data-points-field') && !pointsOn.checked);
      });
      fillDurations(keep);
      left(title, titleLeft, limit().titleMax);
      syncChoices();
    }
    function value() {
      return {
        kind,
        title: title.value,
        choices: choiceInputs().map((input) => input.value),
        durationSeconds: Number(duration.value),
        pointsPerVote: kind === 'poll' && pointsOn.checked ? Number(points.value) : null,
      };
    }

    title.value = saved ? saved.title : '';
    title.addEventListener('input', () => left(title, titleLeft, limit().titleMax));
    for (const text of saved ? saved.choices : ['', '']) addChoiceRow(text);
    addChoice.addEventListener('click', () => {
      addChoiceRow('').focus();
      syncChoices();
    });
    pointsOn.checked = !!(saved && saved.pointsPerVote);
    points.value = saved && saved.pointsPerVote ? String(saved.pointsPerVote) : '100';
    pointsOn.addEventListener('change', () => setKind(kind));
    $$('[data-kind]', editor).forEach((button) => button.addEventListener('click', () => setKind(button.dataset.kind)));
    setKind(kind);

    const once = $('[data-start-once]', editor);
    once.addEventListener('click', async () => {
      once.disabled = true;
      const answer = await start(value());
      once.disabled = false;
      if (!answer) return;
      if (answer.ok) ui.closeEditor(editor);
      else ui.dialogMessage(editor, answer);
    });
    return { value };
  }

  function templateEditor(from, row) {
    const saved = row ? JSON.parse(row.dataset.template) : null;
    let form = null;
    ui.openEditor('tpl-poll-template', from.dataset.title, from, (editor) => {
      form = setupTemplateForm(editor, saved);
    }, async (editor) => {
      const body = form.value();
      const answer = row
        ? await call('PATCH', '/dashboard/api/poll-templates/' + row.dataset.id, body)
        : await call('POST', '/dashboard/api/poll-templates', body);
      if (!answer.ok) {
        ui.dialogMessage(editor, answer);
        return false;
      }
      let target = row;
      if (!target) {
        target = document.getElementById('tpl-poll-template-row').content.firstElementChild.cloneNode(true);
        list.append(target);
      }
      fillTemplateRow(target, answer.data.template);
      afterTemplatesChange();
      return true;
    });
  }
  ui.onClick('[data-add="poll-template"]', (button) => templateEditor(button, null));
  ui.onClick('[data-edit="poll-template"]', (button) => templateEditor(button, button.closest('[data-row]')));
  ui.onClick('[data-delete="poll-template"]', async (button) => {
    const row = button.closest('[data-row]');
    const saved = JSON.parse(row.dataset.template);
    if (!window.confirm(core.fill(P.confirmDelete, { title: saved.title }))) return;
    const answer = await call('DELETE', '/dashboard/api/poll-templates/' + row.dataset.id);
    if (!answer.ok) {
      ui.showMessage(card, answer);
      return;
    }
    const next = ui.nextVisibleRow(row);
    row.remove();
    afterTemplatesChange();
    ui.focusAfterDelete(card, 'poll-template', next);
  });

  // ── The chat messages: the six texts, saved together ──

  const texts = {}; // the texts as saved, by column
  const textsTemplate = document.getElementById('tpl-poll-texts');
  if (textsTemplate) for (const area of textsTemplate.content.querySelectorAll('[data-text-key]')) texts[area.dataset.textKey] = area.value;
  ui.onClick('[data-edit="poll-texts"]', (button) => {
    ui.openEditor('tpl-poll-texts', button.dataset.title, button, (editor) => {
      const chips = $('[data-vars]', editor);
      const showVars = (area) => {
        chips.replaceChildren(...area.dataset.vars.split(' ').filter(Boolean).map((name) => {
          const chip = el('button', 'wc-var', name);
          chip.type = 'button';
          chip.addEventListener('click', () => ui.insertAtCursor(area, name));
          return chip;
        }));
      };
      const areas = $$('[data-text-key]', editor);
      for (const area of areas) {
        area.value = texts[area.dataset.textKey] || '';
        area.addEventListener('focus', () => showVars(area));
      }
      if (areas[0]) showVars(areas[0]);
    }, async (editor) => {
      const changes = $$('[data-text-key]', editor).map((area) => ({ key: area.dataset.textKey, value: area.value }));
      const answer = await call('POST', '/dashboard/settings', { changes });
      if (!answer.ok) {
        ui.dialogMessage(editor, answer);
        return false;
      }
      Object.assign(texts, answer.data.values);
      ui.clearMessage(card);
      ui.showSaved(card);
      return true;
    });
  });

  // "Announcements need the chatbot" while the announcements are on and the chatbot is off.
  function syncChatNote() {
    const note = $('[data-polls-chat-note]', card);
    const announce = $('[data-setting="polls_chat_enabled"]', card);
    const chatbot = document.querySelector('[data-setting="chatbot_enabled"]');
    if (!note || !announce) return;
    note.hidden = !(announce.checked && chatbot && !chatbot.checked);
    ui.repack();
  }
  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-setting="polls_chat_enabled"], [data-setting="chatbot_enabled"]')) syncChatNote();
  });

  // ── Start ──
  syncStarts();
  draw();
  refresh();
})();
```

- [ ] **Step 5: The page gives the scripts their texts, test first**

In `src/routes/dashboard.test.js`, in `describe('the working cards\' script', …)`:
- in the test `'the page loads its texts, then the helpers, then the script'`, add:

```js
    const modelTag = html.indexOf('<script src="/overlay/pollModel.js"></script>');
    const pollsTag = html.indexOf('<script src="/js/dashboard-polls.js"></script>');
    assert.ok(scriptTag < modelTag && modelTag < pollsTag, 'the polls card\'s script comes after the cards\' script and the bar\'s model');
    assert.equal(T.polls.endNow, t('en', 'cards.polls.endNow'));
    assert.equal(T.polls.outcomeWon, t('en', 'cards.polls.outcomeWon', { outcome: '{{outcome}}' }), 'a text with a field the script fills');
    assert.equal(T.shoutoutExample, t('en', 'cards.shoutouts.example', { line: '{{line}}' }));
```

- in the test `'every text the page script reads is in the table the page gives it'`, the line `const source = realFs.readFileSync(path.join(SRC, '..', 'public', 'js', 'dashboard-cards.js'), 'utf8');` becomes:

```js
      const source = ['dashboard-cards.js', 'dashboard-polls.js']
        .map((name) => realFs.readFileSync(path.join(SRC, '..', 'public', 'js', name), 'utf8')).join('\n');
```

Run: `node --test src/routes/dashboard.test.js tests/dashboardCardsCore.test.js` — Expected: FAIL (the page has neither script tag nor `T.polls`).

In `src/views/dashboard.ejs`:
- in `_cardTexts`, after `moderatorUnknown: t('cards.protection.moderatorUnknown'),` add:

```js
    shoutoutExample: t('cards.shoutouts.example', { line: '{{line}}' }),
    polls: {
      kindPoll: t('cards.polls.kindPoll'),
      kindPrediction: t('cards.polls.kindPrediction'),
      kindPredictionShort: t('cards.polls.kindPredictionShort'),
      start: t('cards.polls.start'),
      started: t('cards.polls.started'),
      pollRunningHint: t('cards.polls.pollRunningHint'),
      predictionRunningHint: t('cards.polls.predictionRunningHint'),
      edit: t('cards.polls.edit'),
      delete: t('cards.polls.delete'),
      confirmDelete: t('cards.polls.confirmDelete', { title: '{{title}}' }),
      left: t('cards.polls.left', { count: '{{count}}' }),
      minutes: t('cards.common.minutes', { minutes: '{{minutes}}' }),
      seconds: t('cards.common.seconds', { seconds: '{{seconds}}' }),
      locked: t('cards.polls.locked'),
      votes: t('cards.polls.votes', { count: '{{count}}' }),
      pointsShort: t('cards.polls.pointsShort', { points: '{{points}}', viewers: '{{viewers}}' }),
      totalPoints: t('cards.polls.totalPoints', { count: '{{count}}' }),
      endNow: t('cards.polls.endNow'),
      lockNow: t('cards.polls.lockNow'),
      cancelRefund: t('cards.polls.cancelRefund'),
      confirmCancel: t('cards.polls.confirmCancel'),
      whoWon: t('cards.polls.whoWon'),
      outcomeWon: t('cards.polls.outcomeWon', { outcome: '{{outcome}}' }),
      resultPollWon: t('cards.polls.result.pollWon', { winner: '{{winner}}', percent: '{{percent}}', votes: '{{votes}}' }),
      resultTie: t('cards.polls.result.tie', { winner: '{{winner}}' }),
      resultNone: t('cards.polls.result.none'),
      resultPredictionWon: t('cards.polls.result.predictionWon', { outcome: '{{outcome}}', winners: '{{winners}}', points: '{{points}}' }),
      resultCancelled: t('cards.polls.result.cancelled'),
    },
```

- after `<script src="/js/dashboard-cards.js"></script>` add:

```html
<script src="/overlay/pollModel.js"></script>
<script src="/js/dashboard-polls.js"></script>
```

Run: `node --test src/routes/dashboard.test.js tests/dashboardCardsCore.test.js tests/i18n.test.js tests/i18nViewsPart1.test.js tests/scriptEmbeds.test.js` — Expected: PASS.

- [ ] **Step 6: The full suite, then commit**

Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` — Expected: PASS.

```bash
git add public/js/dashboard-polls.js public/js/dashboard-cards.js public/js/dashboard-cards-core.js tests/dashboardCardsCore.test.js src/views/dashboard.ejs src/routes/dashboard.test.js src/locales/en.json src/locales/pt.json src/locales/es.json src/locales/fr.json src/locales/de.json src/locales/zh.json src/locales/ja.json
git commit -m "feat(polls): the cards' scripts: the live panel, the templates, the chat texts and the shoutout test"
```

---

### Task 12: The new texts in the six other languages

**Files:**
- Modify: `src/locales/pt.json`, `src/locales/es.json`, `src/locales/fr.json`, `src/locales/de.json`, `src/locales/zh.json`, `src/locales/ja.json`

**Interfaces:**
- Consumes: the English texts Tasks 1, 6, 9, 10 and 11 added (111 keys, copied into the six files in English until now).
- Produces: each of the 111 texts translated in each of the six languages, with the `{{placeholders}}` of the English text; nothing else in the files changes.

The glossary the earlier translations followed lives in the main checkout and is not in git: `.superpowers/i18n-glossary.md` (from this worktree: `../../.superpowers/i18n-glossary.md`). Read it first. Keep as they are: `Twitch`, `OBS`, `Atleta`, the chat command `!so` (and `!so @name`), Affiliate and Partner as Twitch names its programs in that language, and every `{{placeholder}}`. The `pollbar.*` texts show on stream in a narrow panel: keep them as short as the English. Before writing a language, read some of its existing `cards.*` texts, and use the same words for the same things (template, chatbot, switch on, channel points, reconnect).

- [ ] **Step 1: List the new keys**

Run: `git diff main -- src/locales/en.json | grep -E '^\+  "' | sed -E 's/^\+  //' > /tmp/polls-new-keys.txt && wc -l < /tmp/polls-new-keys.txt` — Expected: `111`.

- [ ] **Step 2: Translate, one language at a time**

For each of `pt`, `es`, `fr`, `de`, `zh` and `ja`: write `/tmp/polls-<lang>.json` (outside the repository) with every key of `/tmp/polls-new-keys.txt` and its translation, then run `node scripts/locale-keys.js set <lang> /tmp/polls-<lang>.json`.

- [ ] **Step 3: Check them**

Run: `node --test tests/i18n.test.js tests/i18nViewsPart1.test.js` — Expected: PASS.

Run: `git diff main --numstat -- src/locales` — Expected: `111	0` for each of the seven files (only the new lines, now translated).

Run (it lists, per language, the new keys whose text is still the English one):

```bash
node -e '
const fs = require("fs");
const keys = fs.readFileSync("/tmp/polls-new-keys.txt", "utf8").split("\n").filter(Boolean).map((line) => Object.keys(JSON.parse(`{${line.replace(/,$/, "")}}`))[0]);
const en = require("./src/locales/en.json");
for (const lang of ["pt", "es", "fr", "de", "zh", "ja"]) {
  const texts = require(`./src/locales/${lang}.json`);
  const same = keys.filter((key) => texts[key] === en[key]);
  console.log(lang, same.length ? same.join(", ") : "all translated");
}'
```

Expected: `all translated` for each language, or only texts that really are the same in that language; look at every key it lists.

- [ ] **Step 4: The full suite, then commit**

Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` — Expected: PASS.

```bash
git add src/locales/pt.json src/locales/es.json src/locales/fr.json src/locales/de.json src/locales/zh.json src/locales/ja.json
git commit -m "feat(i18n): the polls, predictions and shoutouts texts in the six other languages"
```

---

### Task 13: The docs — CLAUDE.md and the release notes

**Files:**
- Modify: `CLAUDE.md`, `docs/operations/deploy.md`

**Interfaces:**
- Consumes: what Tasks 1–12 built.
- Produces: `CLAUDE.md` describing the final state (the project structure, the dashboard's cards and settings count, two Key Architecture bullets, the EventSub note); the release's notes in `docs/operations/deploy.md`.

- [ ] **Step 1: CLAUDE.md**

In `CLAUDE.md`:
- in Project Structure, after the `dashboardSettings.js` line of `services/`, add:

```
│   ├── pollRules.js      # Polls & predictions: Twitch's limits, the check of a template, a poll or prediction as the card, the bar and the bot see it (pure)
│   ├── twitchPolls.js    # Helix polls and predictions with the broadcaster token; Twitch's refusals as the card's codes
│   ├── livePolls.js      # The running poll and prediction per streamer (EventSub, the card's buttons, a Twitch read), the bar's bus channel poll:<id>, the bot's announcements
│   ├── shoutouts.js      # !so for moderators and the raid shoutout: Twitch lookups kept 10 minutes, one shoutout a minute per person
```

- after the `dashboard.js` line of `routes/`, add `│   ├── polls.js          # The Polls & predictions card's JSON routes (templates, Twitch's buttons, the live view), mounted inside the dashboard router`;
- after the `js/dashboard-cards.js, dashboard-cards-core.js` line of `public/`, add `├── js/dashboard-polls.js # The Polls & predictions card: the live panel (with the bar's model), the template pop-up, the chat texts; built on window.ATLETA_CARD_UI (dashboard-cards.js)`;
- after the `goal.js, goal.css` line of `public/overlay/`, add `    ├── poll.js, poll.css, pollModel.js # Poll and prediction bar — independent OBS browser source at /overlay/poll/TOKEN; pollModel.js (what it shows) is shared with the card`;
- in the `scripts/` line, after `test-recap.js: forces a stream recap for one streamer (manual test)`, add `. locale-keys.js: adds texts to the seven locale files, or sets one language's texts, line by line (the files keep their layout)`;
- in the **Dashboard** bullet, `Chatbot, Discord notifications, OBS overlay, Commands, Sponsor messages, Donations, Chat protection, Giveaways, Channel point rewards, Spotify` becomes `Chatbot, Discord notifications, OBS overlay, Commands, Shoutouts, Sponsor messages, Donations, Chat protection, Giveaways, Polls & predictions, Channel point rewards, Spotify`, and `lists the 57 keys it accepts` becomes `lists the 68 keys it accepts`;
- at the end of the **EventSub** bullet (after `…the per-recipient \`channel.subscribe\` events with \`is_gift\` are ignored.`), add: `The seven poll and prediction types (version 1) are subscribed only when the stored scopes hold both polls permissions (\`hasPollsScope\`); their events go to \`livePolls\`, never to the alert overlay. The raid event carries the raider's login and id for the shoutout.`;
- right after the **Giveaways** bullet (before **Errors and deadlines:**), add:

```markdown
- **Polls & predictions** (`services/pollRules.js`, `twitchPolls.js`, `livePolls.js`, `routes/polls.js`, `views/cards/polls.ejs`, `public/js/dashboard-polls.js`): Twitch's own polls and predictions, started from the card — from saved templates (`poll_templates`, at most 20 per streamer) or once, unsaved — for Affiliates and Partners, with the broadcaster permissions `channel:manage:polls` and `channel:manage:predictions` (asked by `/auth/broadcaster`; a connection made before them gets "Reconnect Twitch" on this card only, and every polls route answers `needs_reconnect` without asking Twitch). The limits are Twitch's (`pollRules.LIMITS`, checked again on the server; an emoji counts once). What runs is kept in memory per streamer (`livePolls.js`): from EventSub's seven poll and prediction events, from Twitch's answer to the card's buttons, and — when EventSub said nothing for 30 s — from a read of Twitch at most every 5 s when the card or the bar asks; a late message never takes a poll back. The card asks `GET /dashboard/api/polls/live` every 2 s while something runs or just ended, else every 10 s, never while the tab is hidden. The bot announces a start, a lock and the result once each, with six texts the streamer edits (`polls_chat_enabled`, on by default; an empty text posts nothing; never what a read finds already running). Twitch's refusals become codes with texts (`pollRules.ERRORS`): `not_affiliate` also stores the flag the rewards card reads (Check again forgets it; a start that works clears it). The on-stream bar is an OBS source of its own, `/overlay/poll/<token>?lang=<lang>` (`public/overlay/poll.js`; `pollModel.js` is shared with the card), fed on the bus channel `poll:<streamerId>` (never `overlay:<id>`): the prediction when both run, a result for 10 s, nothing otherwise; its link is on this card and the OBS overlay card while `features.overlays` is on.
- **Shoutouts** (`services/shoutouts.js`, `views/cards/shoutouts.ejs`): `!so @name` from the broadcaster or a moderator (by their badges; `shoutout_command_enabled`, off by default; a viewer's `!so` goes on to the other commands) and a shoutout for the raider after a raid of at least `shoutout_raid_min_viewers` (1, 2, 5, 10, 25, 50 or 100; `shoutout_raid_enabled`, off by default). The line is the streamer's `shoutout_template` with `{name}`, `{game}`, `{title}` and `{link}` from Twitch (Get Users, Get Channel Information; each name's answer kept 10 minutes); the same person at most once a minute per channel; an unknown name posts nothing (logged). `!so` posts at command priority, the raid shoutout at normal priority after the raid thank-you; Test in chat (`POST /dashboard/shoutouts/test`) shouts out the streamer's own channel.
```

- in **Operations**, `and the notes for Release B, the dashboard working cards)` becomes `the notes for Release B, the dashboard working cards, and those for the polls, predictions and shoutouts release)`.

- [ ] **Step 2: The release notes**

At the end of `docs/operations/deploy.md`, add:

```markdown
## Polls, predictions and shoutouts

Before:

1. No streamer is live and no giveaway is open.
2. The release adds eleven `streamers` columns and the `poll_templates` table at boot: the log shows eleven
   `[DB] Added … column to streamers` lines once, and no `[DB migration]` line. Going back to the previous
   release is a plain revert (the new columns and table stay, unused).
3. No new variable.

After: `/health` answers 200; `/overlay/poll.css`, `/overlay/pollModel.js` and `/js/dashboard-polls.js` answer
200. A streamer is subscribed to the seven poll and prediction events only once their Twitch connection has
the two new permissions, so the boot log has no failed subscription for them.

### What streamers see

- **Everyone:** a dashboard tab that was open across the deploy needs one reload.
- **Shoutouts** card (after Commands): `!so @name` for moderators and a shoutout after a raid, both off until
  switched on; the message is editable, and Test in chat shouts out the streamer's own channel.
- **Polls & predictions** card (after Giveaways), for Twitch Affiliates and Partners: it asks for one
  "Reconnect Twitch" (two new permissions) before it can start anything; then templates, live results, the
  chat announcements (on by default) and their texts.
- **The on-stream bar** is a new OBS browser source (its link is on the Polls & predictions card and on the
  OBS overlay card; recommended size 600 x 700). It is empty while nothing runs.
```

- [ ] **Step 3: Check, then commit**

Run: `grep -n "57 keys\|ten working cards" CLAUDE.md` — Expected: nothing. Run: `node --test "src/**/*.test.js" "tests/**/*.test.js" "bridge/test-*.js"` — Expected: PASS.

```bash
git add CLAUDE.md docs/operations/deploy.md
git commit -m "docs: polls, predictions and shoutouts in CLAUDE.md and the release notes"
```

---

### Task 14: The browser check, then the release (controller only)

Not for a subagent: the check runs the site on this machine, and the release changes production. The release needs the owner's go-ahead. `SP` is the session's scratchpad (`/private/tmp/claude-501/-Users-ricardosilva-Library-Mobile-Documents-com-apple-CloudDocs-Projects-vilela-notifications/96b50c33-9f52-4e53-bc8c-ba61cc3249e5/scratchpad`); the Release B harness is in `$SP/cards-check/` (`run-check.sh` boots a copy of the site on a fresh synthetic database behind `$SP/review-tf/tools/preload.js`, which blocks the network; `cards-check.js` drives it with Playwright).

**Files:**
- Create (outside the repository): `$SP/polls-check/preload.js`, `$SP/polls-check/seed.js`, `$SP/polls-check/check.js`, `$SP/polls-check/run-check.sh`
- Modify: `CLAUDE.md` (the Team Activity Log entry, at release)

- [ ] **Step 1: The harness**

Copy `$SP/cards-check/run-check.sh` to `$SP/polls-check/run-check.sh`; in the copy, the seed becomes `$SP/polls-check/seed.js`, the preload `$SP/polls-check/preload.js` and the check `$SP/polls-check/check.js`.

Copy `$SP/cards-check/cards-seed.js` to `$SP/polls-check/seed.js`; in the copy, the streamer's `broadcaster_scopes` becomes `'channel:manage:redemptions channel:manage:polls channel:manage:predictions'`, and before `console.log('seeded streamer', S);` add:

```js
db.addPollTemplate(S, { kind: 'poll', title: 'Which car next?', choices: ['GT3', 'LMP2', 'F4'], durationSeconds: 180, pointsPerVote: null });
db.addPollTemplate(S, { kind: 'prediction', title: 'Podium tonight?', choices: ['Yes', 'No'], durationSeconds: 300, pointsPerVote: null });
```

Create `$SP/polls-check/preload.js`:

```js
// The polls browser check's preload: the Release B review preload (no network; fake servers), plus a fake Twitch for
// polls and predictions (in memory; votes and points grow every 2 s while one runs) and for the shoutout lookups.
const path = require('path');
const ROOT = process.cwd();
const SP = '/private/tmp/claude-501/-Users-ricardosilva-Library-Mobile-Documents-com-apple-CloudDocs-Projects-vilela-notifications/96b50c33-9f52-4e53-bc8c-ba61cc3249e5/scratchpad';
require(path.join(SP, 'review-tf', 'tools', 'preload.js'));

const FILE = path.join(ROOT, 'src', 'services', 'twitchPolls.js');
class PollsError extends Error { constructor(code) { super(code); this.code = code; } }
const state = { poll: null, prediction: null, n: 0 };
const iso = (ms) => new Date(ms).toISOString();
const open = (p) => p && ['ACTIVE', 'LOCKED'].includes(p.status);
const fake = {
  PollsError,
  async createPoll(s, v) {
    if (open(state.poll)) throw new PollsError('running');
    state.poll = { id: `poll-${++state.n}`, title: v.title, status: 'ACTIVE', duration: v.durationSeconds, started_at: iso(Date.now()), choices: v.choices.map((title, i) => ({ id: `c${i}`, title, votes: 0 })) };
    return state.poll;
  },
  async endPoll(s, id) {
    if (!state.poll || state.poll.id !== id || state.poll.status !== 'ACTIVE') throw new PollsError('changed');
    Object.assign(state.poll, { status: 'TERMINATED', ended_at: iso(Date.now()) });
    return state.poll;
  },
  async latestPoll() { return state.poll; },
  async createPrediction(s, v) {
    if (open(state.prediction)) throw new PollsError('running');
    state.prediction = { id: `pred-${++state.n}`, title: v.title, status: 'ACTIVE', prediction_window: v.durationSeconds, created_at: iso(Date.now()), outcomes: v.choices.map((title, i) => ({ id: `o${i}`, title, users: 0, channel_points: 0, color: i ? 'PINK' : 'BLUE' })) };
    return state.prediction;
  },
  async lockPrediction(s, id) {
    if (!state.prediction || state.prediction.id !== id || state.prediction.status !== 'ACTIVE') throw new PollsError('changed');
    Object.assign(state.prediction, { status: 'LOCKED', locked_at: iso(Date.now()) });
    return state.prediction;
  },
  async resolvePrediction(s, id, outcomeId) {
    if (!open(state.prediction) || state.prediction.id !== id) throw new PollsError('changed');
    Object.assign(state.prediction, { status: 'RESOLVED', winning_outcome_id: outcomeId, ended_at: iso(Date.now()) });
    return state.prediction;
  },
  async cancelPrediction(s, id) {
    if (!open(state.prediction) || state.prediction.id !== id) throw new PollsError('changed');
    Object.assign(state.prediction, { status: 'CANCELED', ended_at: iso(Date.now()) });
    return state.prediction;
  },
  async latestPrediction() { return state.prediction; },
};
require.cache[FILE] = { id: FILE, filename: FILE, loaded: true, exports: fake };

setTimeout(() => {
  const twitch = require(path.join(ROOT, 'src', 'services', 'twitch.js'));
  twitch.getUserProfile = async (login) => ({ id: '4242', login, display_name: 'RivalRacer' });
  twitch.getChannelInfo = async () => ({ gameName: 'iRacing', title: 'Night race at Spa' });
  const { livePolls } = require(path.join(ROOT, 'src', 'services', 'livePolls.js'));
  setInterval(() => {
    const S = 1; // the seeded streamer
    if (state.poll && state.poll.status === 'ACTIVE') {
      state.poll.choices.forEach((c, i) => { c.votes += i + 1; });
      livePolls.onEvent(S, 'channel.poll.progress', { ...state.poll, status: undefined, ends_at: iso(Date.parse(state.poll.started_at) + state.poll.duration * 1000) });
    }
    if (state.prediction && state.prediction.status === 'ACTIVE') {
      state.prediction.outcomes.forEach((o, i) => { o.users += 1; o.channel_points += 500 * (i + 1); });
      livePolls.onEvent(S, 'channel.prediction.progress', { ...state.prediction, status: undefined, locks_at: iso(Date.parse(state.prediction.created_at) + state.prediction.prediction_window * 1000) });
    }
  }, 2000).unref();
  console.log('[polls-check] fake Twitch for polls, predictions and shoutouts');
}, 0);
```

Create `$SP/polls-check/check.js`: start from a copy of `$SP/cards-check/cards-check.js` (keep its header, `open()`, `reopen()`, `switchOf()`, the results list, and the ending that prints the results and exits 1 on a FAIL), and replace its checks with:

```js
  const { page } = await open(1280);
  const polls = page.locator('#card-polls');
  const shout = page.locator('#card-shoutouts');
  const dialog = page.locator('#wc-dialog');
  const dialogClosed = () => page.waitForFunction(() => !document.getElementById('wc-dialog').open);
  await page.screenshot({ path: path.join(OUT, 'twitch-1280.png'), fullPage: true });

  // Shoutouts: the switches and the raid minimum save; Test in chat answers.
  await switchOf(page, 'shoutout_command_enabled').click();
  await shout.locator('[data-setting="shoutout_raid_min_viewers"]').selectOption('10');
  await page.waitForTimeout(800);
  await reopen(page);
  ok(await page.locator('[data-setting="shoutout_command_enabled"]').isChecked(), 'shoutouts: the !so switch is saved');
  ok((await shout.locator('[data-setting="shoutout_raid_min_viewers"]').inputValue()) === '10', 'shoutouts: the raid minimum is saved');
  await shout.locator('[data-test-line]').click();
  await page.waitForTimeout(700);
  ok(/Sent/.test(await shout.locator('[data-test-line]').textContent()), 'shoutouts: Test in chat says it was sent');

  // A new poll template, started from its ▶: the live panel, the votes moving, End now, the result line.
  await polls.locator('[data-add="poll-template"]').click();
  await dialog.locator('[data-field="title"]').fill('Top 5 finish? 🏁');
  await dialog.locator('[data-choice]').nth(0).fill('Yes');
  await dialog.locator('[data-choice]').nth(1).fill('<b>No</b>');
  await dialog.locator('[data-save]').click();
  await dialogClosed();
  const row = polls.locator('[data-row]', { hasText: 'Top 5 finish?' });
  ok(await row.count() === 1, 'polls: the new template is listed');
  ok((await row.locator('[data-field="summary"]').textContent()).includes('<b>No</b>'), 'polls: a choice with HTML shows as text');
  await row.locator('[data-start]').click();
  await polls.locator('.wc-live-poll').first().waitFor();
  ok(await row.locator('[data-start]').isDisabled(), 'polls: a running kind\'s ▶ is off');
  const before = await polls.locator('.lp-opt .ct').first().textContent();
  await page.waitForTimeout(4500);
  const after = await polls.locator('.lp-opt .ct').first().textContent();
  ok(before !== after, `polls: the votes move (${before} → ${after})`);
  await page.screenshot({ path: path.join(OUT, 'poll-running.png'), fullPage: true });
  await polls.locator('[data-poll-end]').click();
  await polls.locator('.wc-winner.show').waitFor();
  ok(true, `polls: the result line after End now: ${await polls.locator('.wc-winner').textContent()}`);

  // A prediction started once from the pop-up: Lock now, then the winner.
  await polls.locator('[data-add="poll-template"]').click();
  await dialog.locator('[data-kind="prediction"]').click();
  await dialog.locator('[data-field="title"]').fill('Clean first lap?');
  await dialog.locator('[data-choice]').nth(0).fill('Clean');
  await dialog.locator('[data-choice]').nth(1).fill('Chaos');
  await dialog.locator('[data-start-once]').click();
  await dialogClosed();
  await polls.locator('.wc-live-poll.pred').waitFor();
  await page.waitForTimeout(2500);
  await polls.locator('[data-prediction-lock]').click();
  await polls.locator('[data-prediction-winner]').first().waitFor();
  await page.screenshot({ path: path.join(OUT, 'prediction-locked.png'), fullPage: true });
  await polls.locator('[data-prediction-winner]').first().click();
  await polls.locator('.wc-winner.show').waitFor();
  ok(true, `polls: the prediction's result line: ${await polls.locator('.wc-winner').textContent()}`);

  // The six chat texts: saved together; an emptied one stays empty.
  await polls.locator('[data-edit="poll-texts"]').click();
  await dialog.locator('[data-text-key="poll_start_template"]').fill('Vote now: {title}');
  await dialog.locator('[data-text-key="prediction_cancel_template"]').fill('');
  await dialog.locator('[data-save]').click();
  await dialogClosed();
  const db = new Database(path.join(APP, 'data', 'bot.db'), { readonly: true });
  const saved = db.prepare('SELECT poll_start_template AS start, prediction_cancel_template AS cancel, overlay_token AS token FROM streamers WHERE id = 1').get();
  db.close();
  ok(saved.start === 'Vote now: {title}' && saved.cancel === '', 'polls: the chat texts are saved');

  // The bar, in Portuguese: a running poll, its result, then empty.
  const barContext = await browser.newContext({ viewport: { width: 600, height: 700 } });
  await barContext.route('**/*', (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const bar = await barContext.newPage();
  await bar.goto(`${BASE}/overlay/poll/${saved.token}?lang=pt`);
  await row.locator('[data-start]').click();
  await bar.locator('.pb').waitFor({ timeout: 8000 });
  await bar.waitForTimeout(2500);
  await bar.screenshot({ path: path.join(OUT, 'bar-poll.png') });
  await polls.locator('[data-poll-end]').click();
  await bar.locator('.pb-corner.is-result').waitFor({ timeout: 5000 });
  await bar.screenshot({ path: path.join(OUT, 'bar-result.png') });
  await bar.waitForTimeout(11000);
  ok(await bar.locator('.pb').count() === 0, 'bar: empty 10 seconds after the result');

  // A phone: no sideways scroll.
  const phone = await open(360);
  await phone.page.screenshot({ path: path.join(OUT, 'twitch-360.png'), fullPage: true });
  ok(!(await phone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'phone: no sideways scroll');
```

- [ ] **Step 2: Run it, and look at the screenshots**

From the worktree, with every task committed: `APP=$(mktemp -d) && rsync -a --exclude .git --exclude data --exclude node_modules ./ "$APP/" && ln -s "$(cd "$(git rev-parse --git-common-dir)/.." && pwd)/node_modules" "$APP/node_modules" && bash "$SP/polls-check/run-check.sh" "$APP" "$SP/polls-check/shots"` (the worktree has no `node_modules` of its own; the main checkout's is linked) — Expected: every line PASS, `check exit 0`, no `TypeError`/`ReferenceError` in the app log. Look at each screenshot (the cards at 1280 and 360 px, the running poll, the locked prediction with its winner buttons, the bar's running poll and result): they match the mockup (`docs/superpowers/specs/assets/2026-10-15-polls-shoutouts-mockup.html`). A FAIL or a drawing that does not match is fixed on the branch (with its test), and the check runs again.

- [ ] **Step 3: Release, with the owner's go-ahead**

1. `bash "$SP/prodcheck/prodexec.sh" "$SP/prodcheck/livecheck.js"` — no registered streamer live and no open giveaway; otherwise wait and ask again later.
2. Add the Team Activity Log entry at the end of `CLAUDE.md` (the format in the global instructions: Task, Files, Decisions, Open) and commit it: `git add CLAUDE.md && git commit -m "docs(claude): team activity log entry for polls, predictions and shoutouts"`.
3. In the main checkout: `git merge --ff-only feat/polls-shoutouts && git push origin main` (a push to `main` deploys).
4. `bash "$SP/prodcheck/watch-deploy.sh" "$(git rev-parse --short HEAD)"` until it prints SUCCESS. Then read the boot log (`railway logs` for the deployment): the eleven `[DB] Added … column to streamers` lines, no `[DB migration]` line, EventSub and the chat bot started. Check that `https://atletanotifications.com/health` answers 200, `/overlay/poll.css`, `/overlay/pollModel.js` and `/js/dashboard-polls.js` answer 200, and `/dashboard` answers 302.
5. Tell the owner what streamers do (the new section of `docs/operations/deploy.md`), and record the release in the memory file `stream-release-2026-10.md`.

---
