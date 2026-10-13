'use strict';

// Drives the real chat handler through chatManager with a fake tmi.js client:
// no IRC connection, no Twitch API (fetch is stubbed), no database.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// ── Stubs ────────────────────────────────────────────────────────────

let streamer;
let bannedWords = [];
let bannedWordReads = 0;
let chatCommands = {}; // command name -> row, as db.getChatCommand returns it

const dbStub = {
  getStreamerById: (id) => (streamer && streamer.id === id ? { ...streamer } : null),
  getBannedWords: () => { bannedWordReads++; return bannedWords; },
  addModLogEntry: () => {},
  getChatbotEnabledStreamers: () => [],
  getChatCommand: (_streamerId, name) => chatCommands[name] || null,
};

// Synthetic credentials; src/config.js would exit without real env vars.
const configStub = {
  bot: { twitchUsername: 'atletabot', twitchToken: 'oauth:synthetic-bot-token' },
  twitch: { clientId: 'synthetic-app-client-id' },
};

let tmiClient = null;
class FakeTmiClient {
  constructor() {
    this.handlers = {};
    this.said = [];
    tmiClient = this;
  }
  on(event, handler) { this.handlers[event] = handler; }
  connect() { return Promise.resolve(); }
  join() { return Promise.resolve(); }
  part() { return Promise.resolve(); }
  say(channel, text) { this.said.push({ channel, text }); return Promise.resolve(); }
  readyState() { return 'OPEN'; }
  disconnect() { return Promise.resolve(); }
}

// A message that starts with "!" lazily loads these, which would load the real
// db and config (config.js exits the process without real env vars).
function stubModule(file, exports) {
  const resolved = require.resolve(file);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stubModule('./builtinCommands', { handleBuiltinCommand: async () => false });
stubModule('./giveawayManager', { tryAddEntry: () => false });

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const from = parent && parent.filename;
  if (from && (from.endsWith(`${path.sep}twitchChat.js`) || from.endsWith(`${path.sep}chatModeration.js`))) {
    if (request === '../db') return dbStub;
    if (request === '../config') return configStub;
    if (request === 'tmi.js') return { Client: FakeTmiClient };
  }
  return origLoad.call(this, request, parent, isMain);
};
const { chatManager } = require('./twitchChat');
const bus = require('./overlayBus');
Module._load = origLoad;

const realFetch = global.fetch;
const realConsole = { log: console.log, warn: console.warn, error: console.error };
let helixCalls;

// The bot token validates as user 999; every Helix call answers `status`.
function stubTwitch(status = 200) {
  helixCalls = [];
  global.fetch = async (url, opts = {}) => {
    if (String(url) === 'https://id.twitch.tv/oauth2/validate') {
      return { ok: true, status: 200, json: async () => ({ user_id: '999', client_id: 'synthetic-bot-client-id', login: 'atletabot', scopes: [] }) };
    }
    helixCalls.push({ url: String(url), method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined });
    return { ok: status >= 200 && status < 300, status, json: async () => ({}), text: async () => '' };
  };
}

// Lets fire-and-forget async work (Helix calls, announcements) finish.
async function flush() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}

function streamerRow(overrides = {}) {
  return {
    id: 1, twitch_user_id: '111', twitch_username: 'somestreamer',
    overlay_enabled: 1, chatbot_enabled: 1,
    chat_raid_enabled: 1, chat_raid_template: 'Welcome raiders from {username}!',
    mod_banned_words_enabled: 0, mod_link_protection_enabled: 1, mod_link_permit_seconds: 90,
    mod_caps_enabled: 0, mod_emote_spam_enabled: 0, mod_repetition_enabled: 0,
    mod_symbol_spam_enabled: 0, mod_slow_mode_cmd_enabled: 0, mod_first_chatter_enabled: 0,
    mod_follow_age_enabled: 0, mod_raid_protection_enabled: 1, mod_raid_protection_duration: 120,
    mod_action_response: 'delete', mod_escalation_enabled: 0, mod_log_discord_enabled: 0,
    mod_exempt_subs: 1, mod_exempt_vips: 1,
    ...overrides,
  };
}

function tags(overrides = {}) {
  return {
    username: 'viewer', 'display-name': 'Viewer', 'user-id': '555', id: 'msg-1',
    badges: null, mod: false, subscriber: false, emotes: null, color: '#123456',
    ...overrides,
  };
}

function chat(text, messageTags) {
  return tmiClient.handlers.message('#somestreamer', messageTags, text, false);
}

beforeEach(() => {
  for (const level of ['log', 'warn', 'error']) console[level] = () => {};
  streamer = streamerRow();
  bannedWords = [];
  bannedWordReads = 0;
  chatCommands = {};
  stubTwitch(200);
  chatManager.connect();
  chatManager.joinChannel(1, 'somestreamer');
});

afterEach(() => {
  chatManager.disconnect();
  Object.assign(console, realConsole);
  global.fetch = realFetch;
});

// ── !permit (M14) ────────────────────────────────────────────────────

describe('!permit in chat', () => {
  test('uses the dashboard permit duration and lets one link through', async () => {
    await chat('!permit @Viewer', tags({ username: 'somemod', mod: true }));
    assert.deepEqual(tmiClient.said, [{ channel: '#somestreamer', text: '@viewer has been permitted to post a link for 90 seconds.' }]);

    await chat('my clip https://clips.example.com/abc', tags());
    assert.equal(helixCalls.length, 0, 'the permitted link is not deleted');
    await chat('another one https://example.com', tags({ id: 'msg-2' }));
    assert.equal(helixCalls.length, 1);
    assert.equal(helixCalls[0].method, 'DELETE');
    assert.match(helixCalls[0].url, /message_id=msg-2/);
  });
});

// ── Raid protection triggers (M14) ───────────────────────────────────

describe('raid protection triggers', () => {
  test('a real raid turns on followers-only mode', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    chatManager.startRaidProtection(1);
    await flush();
    assert.deepEqual(helixCalls.map((c) => [c.method, c.body]), [['PATCH', { follower_mode: true, follower_mode_duration: 10 }]]);
    assert.ok(tmiClient.said.some((m) => m.text.startsWith('Raid protection activated')));
  });

  test('the raid thank-you (also used by dashboard test alerts) never changes chat settings', async () => {
    chatManager.sendEventMessage(1, 'raid', { username: 'RaidLeader', viewers: 42 });
    await flush();
    assert.deepEqual(tmiClient.said, [{ channel: 'somestreamer', text: 'Welcome raiders from RaidLeader!' }]);
    assert.equal(helixCalls.length, 0);
  });
});

// ── Chat overlay only after moderation (H12) ─────────────────────────

describe('chat overlay events', () => {
  let emitted;
  const listener = (event) => emitted.push(event);
  beforeEach(() => {
    emitted = [];
    bus.on('overlay:1', listener);
  });
  afterEach(() => bus.off('overlay:1', listener));

  test('a message that passes moderation is sent with the same payload as before', async () => {
    await chat('hello there', tags());
    await chat('no display name or colour', tags({ 'display-name': undefined, color: null }));
    assert.deepEqual(emitted, [
      { type: 'chat', data: { platform: 'twitch', username: 'Viewer', message: 'hello there', color: '#123456' } },
      { type: 'chat', data: { platform: 'twitch', username: 'viewer', message: 'no display name or colour', color: '#9146ff' } },
    ]);
  });

  test('a message the bot removes never reaches the overlay', async () => {
    streamer = streamerRow({ mod_banned_words_enabled: 1 });
    bannedWords = [{ id: 1, streamer_id: 1, word: 'scamlink', is_regex: 0, created_at: '2026-01-01 12:00:00' }];
    await chat('free stuff at scamlink', tags({ id: 'msg-a' }));
    await chat('look https://example.com', tags({ username: 'linkposter', id: 'msg-b' }));
    assert.deepEqual(emitted, []);
    assert.deepEqual(helixCalls.map((c) => c.url.match(/message_id=([\w-]+)/)[1]), ['msg-a', 'msg-b']);
  });

  test('a flagged but kept message, and messages from mods, still reach the overlay', async () => {
    streamer = streamerRow({ mod_first_chatter_enabled: 1 });
    await chat('first time here!', tags({ 'first-msg': true }));
    await chat('mods can post https://example.com', tags({ username: 'somemod', 'display-name': 'SomeMod', mod: true }));
    assert.deepEqual(emitted.map((e) => e.data.message), ['first time here!', 'mods can post https://example.com']);
    assert.equal(helixCalls.length, 0);
  });

  test('nothing is sent when the overlay is off', async () => {
    streamer = streamerRow({ overlay_enabled: 0 });
    await chat('hello there', tags());
    assert.deepEqual(emitted, []);
  });
});

// ── Banned words: one pass per message (C5) ──────────────────────────

describe('banned words', () => {
  test('are tested once per message, and still apply to subs and VIPs exempt from other filters', async () => {
    streamer = streamerRow({ mod_banned_words_enabled: 1 });
    bannedWords = [{ id: 1, streamer_id: 1, word: 'scamlink', is_regex: 0, created_at: '2026-01-01 12:00:00' }];

    await chat('just a normal message', tags());
    assert.equal(bannedWordReads, 1, 'a regular viewer\'s message tests the list once');

    await chat('scamlink from a sub', tags({ subscriber: true, id: 'msg-sub' }));
    assert.equal(bannedWordReads, 2);
    assert.match(helixCalls[0].url, /message_id=msg-sub/, 'the sub\'s message is still removed');

    await chat('mods are not checked', tags({ username: 'somemod', mod: true }));
    assert.equal(bannedWordReads, 2);
  });
});

// ── An account an admin disabled ─────────────────────────────────────

describe('an account an admin disabled', () => {
  test('the chatbot does not join its channel (it joins an enabled one)', () => {
    chatManager.stopForStreamer(1);
    assert.deepEqual(chatManager.getJoinedChannels(), []);

    streamer = streamerRow({ enabled: 0 });
    chatManager.startForStreamer(1);
    assert.deepEqual(chatManager.getJoinedChannels(), [], 'disabled: not joined');

    streamer = streamerRow({ enabled: 1 });
    chatManager.startForStreamer(1);
    assert.deepEqual(chatManager.getJoinedChannels(), ['somestreamer'], 'enabled: joined');
  });

  test('event thank-yous are not posted for it, so a tip to its page cannot make the bot speak', () => {
    streamer = streamerRow({ enabled: 0 });
    chatManager.sendEventMessage(1, 'raid', { username: 'RaidLeader', viewers: 42 });
    assert.deepEqual(tmiClient.said, []);

    streamer = streamerRow({ enabled: 1 });
    chatManager.sendEventMessage(1, 'raid', { username: 'RaidLeader', viewers: 42 });
    assert.equal(tmiClient.said.length, 1);
    assert.equal(tmiClient.said[0].text, 'Welcome raiders from RaidLeader!');
  });
});

// ── Custom commands: a lone "!" names no command (N16) ───────────────

describe('custom commands in chat', () => {
  const command = (name, response) => ({ id: 1, command: name, response, cooldown: 5, enabled: 1 });

  test('a command is answered', async () => {
    chatCommands = { socials: command('socials', 'Follow us!') };
    await chat('!socials', tags());
    assert.deepEqual(tmiClient.said, [{ channel: '#somestreamer', text: 'Follow us!' }]);
  });

  test('a lone "!" is ignored, even if a command with a blank name was saved earlier', async () => {
    chatCommands = { '': command('', 'I answer everything') };
    await chat('!', tags());
    await chat('! hello there', tags({ id: 'msg-2' }));
    await chat('!   ', tags({ id: 'msg-3' }));
    assert.deepEqual(tmiClient.said, []);
  });

  test('other messages that merely start with ! still reach their commands', async () => {
    chatCommands = { hi: command('hi', 'hello!') };
    await chat('!HI there', tags());
    assert.deepEqual(tmiClient.said.map((m) => m.text), ['hello!']);
  });
});
