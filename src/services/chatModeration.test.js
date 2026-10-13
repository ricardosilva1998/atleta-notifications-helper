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
