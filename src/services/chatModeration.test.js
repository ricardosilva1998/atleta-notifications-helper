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

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent && parent.filename.endsWith(`${path.sep}chatModeration.js`)) {
    if (request === '../db') return dbStub;
    if (request === '../config') return configStub;
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
    global.fetch = async (url) => {
      if (String(url).includes('/oauth2/validate')) throw new Error('validate must already be cached');
      throw new Error('socket hang up');
    };
    const client = fakeClient();
    await mod.handleModCommand(client, '#chan', modTags(), '!slow 10', slowOn());
    assert.deepEqual(client.said, []);
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
