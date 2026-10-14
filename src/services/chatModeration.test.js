'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// ── Stubs: db, config, fetch, console ────────────────────────────────

const state = { bannedWords: [], modLog: [] };

const dbStub = {
  getBannedWords: () => state.bannedWords,
  addModLogEntry: (...args) => state.modLog.push(args),
};

// src/config.js exits the process without real env vars, so it is stubbed.
// The token is synthetic.
const configStub = {
  bot: { twitchToken: 'oauth:synthetic-bot-token' },
  twitch: { clientId: 'synthetic-app-client-id' },
};

// The regex time budget runs on a fake clock that only the tests move, so real
// regex timing never trips it by accident.
const budgetClock = { t: 0 };
const budgetLogs = [];
const { createRegexBudget } = require('./regexBudget');
const budgetStub = {
  createRegexBudget: (options) => createRegexBudget({
    ...options,
    now: () => budgetClock.t,
    log: { log: (line) => budgetLogs.push(['log', line]), warn: (line) => budgetLogs.push(['warn', line]) },
  }),
};

// The follow check (twitch.getFollowAge) answers what a test sets. It is placed
// in the module cache because chatModeration.js loads ./twitch only when a
// check runs, and the real module would load the real config.
const followStub = {
  calls: [],
  answer: null,
  fail: null,
  async getFollowAge(streamer, userId) {
    followStub.calls.push({ streamerId: streamer.id, userId });
    if (followStub.fail) throw followStub.fail;
    return followStub.answer;
  },
  async getUserId() { return null; },
};
const twitchPath = require.resolve('./twitch');
require.cache[twitchPath] = { id: twitchPath, filename: twitchPath, loaded: true, exports: followStub };

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent && parent.filename.endsWith(`${path.sep}chatModeration.js`)) {
    if (request === '../db') return dbStub;
    if (request === '../config') return configStub;
    if (request === './regexBudget') return budgetStub;
  }
  return origLoad.call(this, request, parent, isMain);
};
const mod = require('./chatModeration');
Module._load = origLoad;

const realFetch = global.fetch;
const realConsole = { log: console.log, warn: console.warn, error: console.error };
let logs;

beforeEach(() => {
  state.bannedWords = [];
  state.modLog = [];
  logs = [];
  for (const level of ['log', 'warn', 'error']) {
    console[level] = (...args) => logs.push({ level, text: args.join(' ') });
  }
  global.fetch = async () => { throw new Error('unexpected network call'); };
});

afterEach(() => {
  Object.assign(console, realConsole);
  global.fetch = realFetch;
});

let nextWordId = 1;
function bannedWord(word, isRegex = false) {
  return { id: nextWordId++, streamer_id: 1, word, is_regex: isRegex ? 1 : 0, created_at: '2026-01-01 12:00:00' };
}

// ── C5: banned words ─────────────────────────────────────────────────

describe('checkBannedWords', () => {
  test('regex and plain words match case-insensitively', () => {
    state.bannedWords = [bannedWord('sp[a@4]m+'), bannedWord('sp[a@4]m+', true), bannedWord('Scam')];
    assert.ok(mod.checkBannedWords('total SP@MMM here', 1));
    assert.ok(mod.checkBannedWords('this is a sCaM', 1));
    assert.equal(mod.checkBannedWords('perfectly fine', 1), null);
  });

  test('a stored regex that fails validation is matched as literal text', () => {
    state.bannedWords = [bannedWord('(a+)+$', true)];
    assert.equal(mod.checkBannedWords('a'.repeat(40), 1), null);
    assert.ok(mod.checkBannedWords('someone typed (A+)+$ here', 1));
  });

  test('only the first 500 characters of a message are tested', () => {
    state.bannedWords = [bannedWord('scam'), bannedWord('fr[e3]{2}', true)];
    assert.equal(mod.checkBannedWords('x'.repeat(500) + ' scam fr33', 1), null);
    assert.ok(mod.checkBannedWords('x'.repeat(490) + ' scam', 1));
    assert.ok(mod.checkBannedWords('x'.repeat(490) + ' fr33', 1));
  });

  test('a change to the word list applies to the next message', () => {
    state.bannedWords = [bannedWord('alpha')];
    assert.ok(mod.checkBannedWords('alpha', 1));
    state.bannedWords = [bannedWord('beta', true)];
    assert.equal(mod.checkBannedWords('alpha', 1), null);
    assert.ok(mod.checkBannedWords('BETA', 1));
  });
});

// ── Shared fixtures ──────────────────────────────────────────────────

// A streamer row with the dashboard defaults (src/db.js), all synthetic.
function streamerRow(overrides = {}) {
  return {
    id: 1, twitch_user_id: '111', twitch_username: 'somestreamer',
    overlay_enabled: 1, chatbot_enabled: 1,
    mod_banned_words_enabled: 0, mod_link_protection_enabled: 1, mod_link_permit_seconds: 60,
    mod_caps_enabled: 1, mod_caps_min_length: 10, mod_caps_max_percent: 70,
    mod_emote_spam_enabled: 0, mod_emote_max_count: 15,
    mod_repetition_enabled: 0, mod_repetition_window: 30,
    mod_symbol_spam_enabled: 1, mod_symbol_max_percent: 50,
    mod_slow_mode_cmd_enabled: 0, mod_raid_protection_enabled: 0, mod_raid_protection_duration: 120,
    mod_first_chatter_enabled: 0, mod_follow_age_enabled: 0, mod_follow_age_minutes: 10,
    mod_action_response: 'delete', mod_escalation_enabled: 0,
    mod_log_discord_enabled: 0, mod_log_discord_channel_id: null,
    mod_exempt_subs: 1, mod_exempt_vips: 1,
    ...overrides,
  };
}

// tmi.js message tags for a regular viewer.
function viewerTags(overrides = {}) {
  return {
    username: 'viewer', 'display-name': 'Viewer', 'user-id': '555', id: 'msg-1',
    badges: null, mod: false, subscriber: false, emotes: null, color: '#123456',
    ...overrides,
  };
}

function fakeClient() {
  const said = [];
  return { said, say: async (channel, text) => { said.push({ channel, text }); } };
}

// Twitch stub: the bot token validates as user 999; Helix answers `status`.
let helixCalls;
function stubTwitch(status = 200) {
  helixCalls = [];
  global.fetch = async (url, opts = {}) => {
    if (String(url) === 'https://id.twitch.tv/oauth2/validate') {
      return {
        ok: true, status: 200,
        json: async () => ({ user_id: '999', client_id: 'synthetic-bot-client-id', login: 'atletabot', scopes: [] }),
      };
    }
    helixCalls.push({
      url: String(url), method: opts.method || 'GET', headers: opts.headers || {},
      body: opts.body ? JSON.parse(opts.body) : undefined, signal: opts.signal,
    });
    return {
      ok: status >= 200 && status < 300, status,
      json: async () => ({}), text: async () => (status >= 400 ? '{"message":"synthetic error"}' : ''),
    };
  };
}

// ── M13: filters that misfired ───────────────────────────────────────

describe('runFilters', () => {
  test('messages in other scripts are not symbol spam', async () => {
    for (const text of [
      'こんにちは、今日のレースすごかった！',
      '你好，今天的比赛太精彩了',
      'Привет всем, отличная гонка сегодня',
      'مرحبا الجميع سباق رائع',
    ]) {
      assert.equal(await mod.runFilters('#chan', viewerTags(), text, streamerRow()), null, text);
    }
    const spam = await mod.runFilters('#chan', viewerTags(), '!!!!!!!!!!!!', streamerRow());
    assert.match(spam.reason, /^Symbol spam/);
  });

  test('typos are not links, real links are', async () => {
    for (const text of ['e.g. 3.5 seconds faster, i.e. great', 'ok.so what now', 'awww...so cute']) {
      assert.equal(await mod.runFilters('#chan', viewerTags(), text, streamerRow()), null, text);
    }
    const link = await mod.runFilters('#chan', viewerTags(), 'check bit.ly/3abcd for skins', streamerRow());
    assert.deepEqual(link, { violated: true, reason: 'Link posted without permission' });
  });

  test('Twitch emotes and short messages do not count as caps', async () => {
    const noSymbols = streamerRow({ mod_symbol_spam_enabled: 0 });
    const emotes = { 425618: ['0-2', '4-6', '8-10', '12-14'] };
    assert.equal(await mod.runFilters('#chan', viewerTags({ emotes }), 'LUL LUL LUL LUL', noSymbols), null);
    assert.equal(await mod.runFilters('#chan', viewerTags(), 'OK!!! OK!!!', noSymbols), null);
    const shout = await mod.runFilters('#chan', viewerTags(), 'WHAT A RACE TODAY', noSymbols);
    assert.match(shout.reason, /^Excessive caps/);
  });
});

describe('banned word warnings', () => {
  test('the warning, mod log and console never repeat the matched word', async () => {
    state.bannedWords = [bannedWord('verybadword'), bannedWord('w[o0]rse', true)];
    const plain = mod.checkBannedWords('you are a VeryBadWord', 1);
    assert.deepEqual(plain, { violated: true, reason: 'Banned word' });
    assert.deepEqual(mod.checkBannedWords('even w0rse', 1), { violated: true, reason: 'Banned pattern' });

    stubTwitch(204);
    const client = fakeClient();
    await mod.executeAction(client, '#chan', viewerTags(), 'warn', plain.reason, streamerRow());
    assert.deepEqual(client.said, [{ channel: '#chan', text: '@viewer, warning: Banned word' }]);
    assert.equal(state.modLog.length, 1);
    const everything = JSON.stringify([client.said, state.modLog, logs]).toLowerCase();
    assert.ok(!everything.includes('verybadword'));
    assert.ok(!everything.includes('w[o0]rse'));
  });
});

// ── M14: !slow, raid protection and !permit ──────────────────────────

const modTags = (overrides = {}) => viewerTags({ username: 'somemod', 'display-name': 'SomeMod', mod: true, ...overrides });
const SETTINGS_URL = 'https://api.twitch.tv/helix/chat/settings?broadcaster_id=111&moderator_id=999';

// Lets the async work behind a fired (mocked) timer finish.
async function flush() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}

function assertSettingsRequest(call, body) {
  assert.equal(call.url, SETTINGS_URL);
  assert.equal(call.method, 'PATCH');
  assert.equal(call.headers.Authorization, 'Bearer synthetic-bot-token');
  assert.equal(call.headers['Client-ID'], 'synthetic-bot-client-id');
  assert.equal(call.headers['Content-Type'], 'application/json');
  assert.ok(call.signal instanceof AbortSignal, 'the request has a timeout');
  assert.deepEqual(call.body, body);
}

describe('!slow and !slowoff', () => {
  const slowOn = () => streamerRow({ mod_slow_mode_cmd_enabled: 1 });

  test('set slow mode through Helix and announce it after Twitch accepts', async () => {
    stubTwitch(200);
    const client = fakeClient();
    assert.equal(await mod.handleModCommand(client, '#chan', modTags(), '!slow 45', slowOn()), true);
    assert.equal(helixCalls.length, 1);
    assertSettingsRequest(helixCalls[0], { slow_mode: true, slow_mode_wait_time: 45 });
    assert.deepEqual(client.said, [{ channel: '#chan', text: 'Slow mode enabled (45s).' }]);

    await mod.handleModCommand(client, '#chan', modTags(), '!slowoff', slowOn());
    assertSettingsRequest(helixCalls[1], { slow_mode: false });
    assert.equal(client.said[1].text, 'Slow mode disabled.');
  });

  test('keep the wait time inside the 3-120 s range Twitch accepts', async () => {
    stubTwitch(200);
    const client = fakeClient();
    for (const message of ['!slow', '!slow 500', '!slow 1', '!slow abc']) {
      await mod.handleModCommand(client, '#chan', modTags(), message, slowOn());
    }
    assert.deepEqual(helixCalls.map((c) => c.body.slow_mode_wait_time), [30, 120, 3, 30]);
  });

  for (const status of [401, 403, 500]) {
    test(`post nothing when Twitch answers ${status}`, async () => {
      stubTwitch(status);
      const client = fakeClient();
      await mod.handleModCommand(client, '#chan', modTags(), '!slow 10', slowOn());
      await mod.handleModCommand(client, '#chan', modTags(), '!slowoff', slowOn());
      assert.equal(helixCalls.length, 2);
      assert.deepEqual(client.said, []);
    });
  }

  test('post nothing when the request itself fails', async () => {
    stubTwitch(200);
    const answerTwitch = global.fetch;
    global.fetch = async (url, opts) => {
      if (String(url).startsWith('https://api.twitch.tv/helix/chat/settings')) throw new Error('socket hang up');
      return answerTwitch(url, opts);
    };
    const client = fakeClient();
    await mod.handleModCommand(client, '#chan', modTags(), '!slow 10', slowOn());
    assert.deepEqual(client.said, []);
    assert.ok(logs.some((l) => l.level === 'error' && l.text.includes('Chat settings update failed in #chan: socket hang up')));
  });

  test('log a missing bot scope once per streamer, not on every attempt', async () => {
    // Streamers 3 and 4 have not been warned by earlier tests (the record is
    // module state, kept for a day).
    const first = streamerRow({ id: 3, twitch_user_id: '111', mod_slow_mode_cmd_enabled: 1 });
    const second = streamerRow({ id: 4, twitch_user_id: '111', mod_slow_mode_cmd_enabled: 1 });
    const scopeWarnings = () => logs.filter((l) => l.level === 'warn' && l.text.includes('moderator:manage:chat_settings'));
    const client = fakeClient();

    stubTwitch(401);
    for (let i = 0; i < 3; i++) await mod.handleModCommand(client, '#first', modTags(), '!slow 10', first);
    await mod.handleModCommand(client, '#second', modTags(), '!slow 10', second);
    assert.deepEqual(scopeWarnings().map((l) => l.text.match(/#\w+ \(\d+\)/)[0]), ['#first (401)', '#second (401)']);

    // Once Twitch accepts a change again (token fixed), a later refusal is logged again.
    stubTwitch(200);
    await mod.handleModCommand(client, '#first', modTags(), '!slow 10', first);
    stubTwitch(403);
    await mod.handleModCommand(client, '#first', modTags(), '!slow 10', first);
    assert.equal(scopeWarnings().length, 3);
    assert.match(scopeWarnings()[2].text, /#first \(403\)/);
    assert.deepEqual(client.said, [{ channel: '#first', text: 'Slow mode enabled (10s).' }]);
  });

  test('only work for mods, and only when the streamer enabled the command', async () => {
    stubTwitch(200);
    const client = fakeClient();
    assert.equal(await mod.handleModCommand(client, '#chan', viewerTags(), '!slow 10', slowOn()), false);
    assert.equal(await mod.handleModCommand(client, '#chan', modTags(), '!slow 10', streamerRow()), false);
    assert.equal(helixCalls.length, 0);
    assert.deepEqual(client.said, []);
  });
});

describe('raid protection', () => {
  const protectedRow = (overrides = {}) => streamerRow({ mod_raid_protection_enabled: 1, mod_raid_protection_duration: 120, ...overrides });

  test('turns on followers-only mode, then off again after the configured time', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    stubTwitch(200);
    const client = fakeClient();
    await mod.activateRaidProtection(client, 'somestreamer', protectedRow());
    assert.equal(helixCalls.length, 1);
    assertSettingsRequest(helixCalls[0], { follower_mode: true, follower_mode_duration: 10 });
    assert.deepEqual(client.said, [{ channel: 'somestreamer', text: 'Raid protection activated for 120 seconds. Followers-only mode enabled.' }]);

    t.mock.timers.tick(119_000);
    await flush();
    assert.equal(helixCalls.length, 1, 'still on before the duration ends');

    t.mock.timers.tick(1_000);
    await flush();
    assert.equal(helixCalls.length, 2);
    assertSettingsRequest(helixCalls[1], { follower_mode: false });
    assert.equal(client.said[1].text, 'Raid protection ended. Followers-only mode disabled.');
  });

  test('announces nothing and schedules nothing when Twitch refuses', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    stubTwitch(403);
    const client = fakeClient();
    await mod.activateRaidProtection(client, 'somestreamer', protectedRow());
    t.mock.timers.tick(600_000);
    await flush();
    assert.equal(helixCalls.length, 1);
    assert.deepEqual(client.said, []);
  });

  test('does nothing when the streamer has not enabled it', async () => {
    stubTwitch(200);
    const client = fakeClient();
    await mod.activateRaidProtection(client, 'somestreamer', streamerRow());
    assert.equal(helixCalls.length, 0);
    assert.deepEqual(client.said, []);
  });
});

describe('!permit', () => {
  test('grants a single link pass for the dashboard permit duration', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    const client = fakeClient();
    const streamer = streamerRow({ mod_link_permit_seconds: 90 });
    assert.equal(await mod.handleModCommand(client, '#chan', modTags(), '!permit @Viewer', streamer), true);
    assert.deepEqual(client.said, [{ channel: '#chan', text: '@viewer has been permitted to post a link for 90 seconds.' }]);

    assert.equal(await mod.runFilters('#chan', viewerTags(), 'my clip: https://clips.example.com/x', streamer), null);
    const second = await mod.runFilters('#chan', viewerTags(), 'and https://example.com', streamer);
    assert.equal(second.reason, 'Link posted without permission');

    await mod.handleModCommand(client, '#chan', modTags(), '!permit viewer', streamer);
    t.mock.timers.tick(91_000);
    const late = await mod.runFilters('#chan', viewerTags(), 'https://example.com', streamer);
    assert.equal(late.reason, 'Link posted without permission', 'the pass expires');
  });

  test('ignores names that cannot be Twitch logins', async () => {
    const client = fakeClient();
    assert.equal(await mod.handleModCommand(client, '#chan', modTags(), '!permit some.thing!', streamerRow()), true);
    assert.deepEqual(client.said, []);
  });
});

// ── M10: the follow-age filter ───────────────────────────────────────

describe('the follow-age filter', () => {
  // Only the follow check is on, so nothing else can act on the message.
  const gateOn = (overrides = {}) => streamerRow({
    mod_follow_age_enabled: 1, mod_follow_age_minutes: 60,
    mod_link_protection_enabled: 0, mod_caps_enabled: 0, mod_symbol_spam_enabled: 0,
    ...overrides,
  });
  let chatters = 0; // a new chatter per check, so the 5-minute cache never answers
  const someone = () => {
    chatters++;
    return viewerTags({ username: `chatter${chatters}`, 'user-id': String(7000 + chatters) });
  };
  const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

  beforeEach(() => {
    followStub.calls = [];
    followStub.answer = null;
    followStub.fail = null;
  });

  test('asks with the streamer and the viewer\'s Twitch id, and lets an old enough follower through', async () => {
    followStub.answer = { following: true, followedAt: minutesAgo(120) };
    const tags = someone();
    assert.equal(await mod.runFilters('#chan', tags, 'hello', gateOn()), null);
    assert.deepEqual(followStub.calls, [{ streamerId: 1, userId: tags['user-id'] }]);
  });

  test('acts on Twitch\'s answer: not following, or following for less than the limit', async () => {
    followStub.answer = { following: false, followedAt: null };
    assert.deepEqual(await mod.runFilters('#chan', someone(), 'hello', gateOn()), { violated: true, reason: 'Not following the channel' });
    followStub.answer = { following: true, followedAt: minutesAgo(10) };
    assert.match((await mod.runFilters('#chan', someone(), 'hello', gateOn())).reason, /^Follow age too short/);
  });

  test('lets the message through when Twitch cannot say, and asks again next time', async () => {
    followStub.fail = new Error('Followers API error: 500');
    const tags = someone();
    assert.equal(await mod.runFilters('#chan', tags, 'hello', gateOn()), null);
    assert.equal(await mod.runFilters('#chan', tags, 'hello again', gateOn()), null);
    assert.equal(followStub.calls.length, 2, 'an error is not kept as an answer');
  });

  test('a failing check is logged once an hour per streamer, not on every message', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 5_000_000 });
    followStub.fail = Object.assign(new Error('The broadcaster token cannot read followers'), { code: 'NO_FOLLOWER_ACCESS' });
    const streamer = gateOn({ id: 42 });
    for (let i = 0; i < 3; i++) assert.equal(await mod.runFilters('#chan', someone(), 'hello', streamer), null);
    t.mock.timers.tick(3_600_000);
    await mod.runFilters('#chan', someone(), 'hello', streamer);
    const warnings = logs.filter((l) => l.level === 'warn' && l.text.includes('Follow-age check failed'));
    assert.equal(warnings.length, 2);
    assert.match(warnings[0].text, /streamer 42/);
  });
});

// ── Regex banned word guards (C5) ────────────────────────────────────

describe('regex banned word guards', () => {
  const realTest = RegExp.prototype.test;

  test('each regex word is warmed up once, when it is compiled', (t) => {
    const warmups = {};
    t.mock.method(RegExp.prototype, 'test', function (input) {
      if (input === '') warmups[this.source] = (warmups[this.source] || 0) + 1;
      return realTest.call(this, input);
    });
    state.bannedWords = [bannedWord('w[a4]rmup', true), bannedWord('plainword')];
    mod.checkBannedWords('first message', 1);
    mod.checkBannedWords('second message', 1);
    assert.deepEqual(warmups, { 'w[a4]rmup': 1 });

    state.bannedWords.push(bannedWord('c[o0]ld', true));
    mod.checkBannedWords('third message', 1);
    assert.deepEqual(warmups, { 'w[a4]rmup': 1, 'c[o0]ld': 1 });
  });

  test('regex words see the first 500 UTF-16 code units, plain words 500 characters', () => {
    state.bannedWords = [bannedWord('c[a@4]pt[e3]st', true), bannedWord('plaintail')];
    const pad = '\u{1F600}'.repeat(260); // 260 characters, 520 code units
    assert.equal(mod.checkBannedWords(pad + ' c4pt3st', 1), null);
    assert.deepEqual(mod.checkBannedWords(pad + ' plaintail', 1), { violated: true, reason: 'Banned word' });
    assert.deepEqual(mod.checkBannedWords('\u{1F600}'.repeat(240) + ' c4pt3st', 1), { violated: true, reason: 'Banned pattern' });
  });

  test('over 250 ms of regex matching in 10 s means plain-text matching for an hour', (t) => {
    // Each run of this regex on a real message takes 130 ms on the fake clock.
    let regexRuns = 0;
    t.mock.method(RegExp.prototype, 'test', function (input) {
      if (this.source === 'sl[o0]wpattern' && input !== '') {
        regexRuns++;
        budgetClock.t += 130;
      }
      return realTest.call(this, input);
    });
    state.bannedWords = [bannedWord('sl[o0]wpattern', true)];
    const streamerId = 42; // no other test uses this streamer's budget
    budgetLogs.length = 0;

    assert.equal(mod.checkBannedWords('hello', streamerId), null);
    assert.equal(mod.checkBannedWords('hello again', streamerId), null); // 260 ms: switched off
    assert.equal(regexRuns, 2);
    assert.deepEqual(budgetLogs.map(([level]) => level), ['warn']);

    // While off, the word is matched as its own text and the regex no longer runs.
    assert.equal(mod.checkBannedWords('sl0wpattern', streamerId), null);
    assert.deepEqual(mod.checkBannedWords('typed sl[o0]wpattern as is', streamerId), { violated: true, reason: 'Banned pattern' });
    assert.equal(regexRuns, 2);

    budgetClock.t += 60 * 60 * 1000;
    assert.deepEqual(mod.checkBannedWords('sl0wpattern', streamerId), { violated: true, reason: 'Banned pattern' });
    assert.equal(regexRuns, 3);
    assert.deepEqual(budgetLogs.map(([level]) => level), ['warn', 'log']);
  });
});

// ── The moderation requests to Twitch have a deadline ────────────────

describe('the Twitch moderation requests give up after 10 seconds', () => {
  const slowOn = () => streamerRow({ mod_slow_mode_cmd_enabled: 1 });
  const modAction = (fresh, action) => fresh.executeAction(fakeClient(), '#chan', viewerTags(), action, 'a reason', streamerRow());

  // The bot's user id is looked up once and kept, so each test gets a copy of the
  // module that has not looked it up yet.
  function freshModeration() {
    const file = require.resolve('./chatModeration');
    const outer = Module._load;
    Module._load = function (request, parent, isMain) {
      if (parent && parent.filename.endsWith(`${path.sep}chatModeration.js`)) {
        if (request === '../db') return dbStub;
        if (request === '../config') return configStub;
        if (request === './regexBudget') return budgetStub;
      }
      return outer.call(this, request, parent, isMain);
    };
    delete require.cache[file];
    try {
      return require('./chatModeration');
    } finally {
      Module._load = outer;
      delete require.cache[file];
    }
  }

  // Every AbortSignal.timeout(ms) the code makes is kept, and fired by hand with expire(i).
  let timeouts;
  const realTimeout = AbortSignal.timeout;
  beforeEach(() => {
    timeouts = [];
    AbortSignal.timeout = (ms) => {
      const controller = new AbortController();
      timeouts.push({ ms, controller });
      return controller.signal;
    };
  });
  afterEach(() => { AbortSignal.timeout = realTimeout; });
  const expire = (i) => timeouts[i].controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

  // A Twitch that takes the request and never answers it, until its signal fires.
  const neverAnswers = (signal) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

  // fetch that answers like stubTwitch(200), except for the requests `hangs(url)` picks, which
  // never get an answer; `started` resolves once such a request has been made.
  function twitchHangingOn(hangs) {
    stubTwitch(200);
    const answer = global.fetch;
    const requests = [];
    let begun;
    const started = new Promise((resolve) => { begun = resolve; });
    global.fetch = (url, opts = {}) => {
      requests.push({ url: String(url).split('?')[0], signal: opts.signal });
      if (!hangs(String(url))) return answer(url, opts);
      begun();
      return neverAnswers(opts.signal);
    };
    return { requests, started };
  }

  test('looking up the bot, deleting a message and timing out a viewer each have the 10 s limit', async () => {
    const fresh = freshModeration();
    const { requests } = twitchHangingOn(() => false);
    await modAction(fresh, 'delete');
    await modAction(fresh, 'timeout_10');

    assert.deepEqual(requests.map((r) => r.url), [
      'https://id.twitch.tv/oauth2/validate',
      'https://api.twitch.tv/helix/moderation/chat',
      'https://api.twitch.tv/helix/moderation/bans',
    ]);
    assert.deepEqual(timeouts.map((t) => t.ms), [10_000, 10_000, 10_000]);
    requests.forEach((request, i) => assert.equal(request.signal, timeouts[i].controller.signal, request.url));
  });

  test('a bot lookup Twitch never answers is given up on; !slow says nothing, and works on the next try', async () => {
    const fresh = freshModeration();
    const twitch = twitchHangingOn((url) => url === 'https://id.twitch.tv/oauth2/validate');
    const client = fakeClient();

    const attempt = fresh.handleModCommand(client, '#chan', modTags(), '!slow 10', slowOn());
    await twitch.started;
    expire(0);
    assert.equal(await attempt, true);
    assert.deepEqual(client.said, []);
    assert.ok(logs.some((l) => l.level === 'error' && l.text.includes('Failed to get bot user ID: The operation was aborted due to timeout')), JSON.stringify(logs));
    assert.deepEqual(twitch.requests.map((r) => r.url), ['https://id.twitch.tv/oauth2/validate'], 'no settings request without the bot\'s id');

    // The failure was not kept: the next try asks again.
    twitchHangingOn(() => false);
    await fresh.handleModCommand(client, '#chan', modTags(), '!slow 10', slowOn());
    assert.deepEqual(client.said, [{ channel: '#chan', text: 'Slow mode enabled (10s).' }]);
  });

  test('a message delete Twitch never answers is given up on, and the action still finishes', async () => {
    const fresh = freshModeration();
    const twitch = twitchHangingOn((url) => url.startsWith('https://api.twitch.tv/helix/moderation/chat'));
    const before = state.modLog.length;

    const action = modAction(fresh, 'delete');
    await twitch.started;
    expire(1); // 0 was the bot lookup
    await action;

    assert.ok(logs.some((l) => l.level === 'error' && l.text === '[Mod] The operation was aborted due to timeout'), JSON.stringify(logs));
    assert.equal(state.modLog.length, before + 1, 'and it is still recorded');
  });

  test('a timeout or ban Twitch never answers is given up on, and the action still finishes', async () => {
    const fresh = freshModeration();
    const twitch = twitchHangingOn((url) => url.startsWith('https://api.twitch.tv/helix/moderation/bans'));
    const before = state.modLog.length;

    const action = modAction(fresh, 'timeout_600');
    await twitch.started;
    expire(1);
    await action;

    assert.ok(logs.some((l) => l.level === 'error' && l.text === '[Mod] The operation was aborted due to timeout'), JSON.stringify(logs));
    assert.equal(state.modLog.length, before + 1);
  });
});
