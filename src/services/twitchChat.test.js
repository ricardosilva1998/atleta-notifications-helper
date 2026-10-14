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
  bot: { twitchUsername: 'atletabot', twitchToken: 'oauth:synthetic-bot-token', chatMessagesPer30s: 20 },
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

// The real chat dispatcher (bot-wide limit, 1.5 s per channel, merged
// thank-yous), on a clock that only the tests move.
const chatClock = (() => {
  let t = 0;
  let timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const timer = { at: t + ms, fn }; timers.push(timer); return timer; },
    clearTimer: (timer) => { timers = timers.filter((x) => x !== timer); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        t = next.at;
        next.fn();
      }
      t = end;
    },
  };
})();
const realDispatcher = require('./chatDispatcher');
const dispatcherStub = {
  ...realDispatcher,
  created: null, // the options twitchChat.js passed
  createChatDispatcher(options) {
    dispatcherStub.created = options;
    return realDispatcher.createChatDispatcher({ ...options, now: chatClock.now, setTimer: chatClock.setTimer, clearTimer: chatClock.clearTimer });
  },
};

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const from = parent && parent.filename;
  if (from && (from.endsWith(`${path.sep}twitchChat.js`) || from.endsWith(`${path.sep}chatModeration.js`))) {
    if (request === '../db') return dbStub;
    if (request === '../config') return configStub;
    if (request === 'tmi.js') return { Client: FakeTmiClient };
    if (request === './chatDispatcher') return dispatcherStub;
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
    // Let the protection end: a timer left pending in chatModeration would be
    // cleared by the next test's mocked timers and break them.
    t.mock.timers.tick(120_000);
    await flush();
  });

  test('while the bot is still in the chat, the end of raid protection is announced', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    chatManager.startRaidProtection(1);
    await flush();
    t.mock.timers.tick(120_000);
    await flush();
    chatClock.advance(1_500);
    assert.deepEqual(helixCalls.map((c) => c.body), [{ follower_mode: true, follower_mode_duration: 10 }, { follower_mode: false }]);
    assert.ok(tmiClient.said.some((m) => m.text.startsWith('Raid protection ended')));
  });

  test('a chat the bot has left (account disabled, chatbot off) gets no "ended" notice, but followers-only still goes off', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    chatManager.startRaidProtection(1);
    await flush();
    assert.ok(tmiClient.said.some((m) => m.text.startsWith('Raid protection activated')));

    streamer = streamerRow({ enabled: 0 });
    chatManager.stopForStreamer(1); // what disabling the account does
    t.mock.timers.tick(120_000);
    await flush();
    chatClock.advance(5_000);
    assert.deepEqual(helixCalls.map((c) => c.body), [{ follower_mode: true, follower_mode_duration: 10 }, { follower_mode: false }]);
    assert.ok(!tmiClient.said.some((m) => m.text.startsWith('Raid protection ended')));
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

// ── Thank-you templates filled with viewers' text (M9) ───────────────

describe('event thank-yous', () => {
  test('a donor\'s name and message are plain text on one line that cannot start a command', () => {
    streamer = streamerRow({ chat_donation_enabled: 1, chat_donation_template: '{username} donated {amount}! {message}' });
    chatManager.sendEventMessage(1, 'donation', { username: '!somecommand $&', amount: 'USD 5', message: "$'$'\r\nPRIVMSG #other :hi" });
    assert.deepEqual(tmiClient.said, [{ channel: 'somestreamer', text: "somecommand $& donated USD 5! $'$' PRIVMSG #other :hi" }]);
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

  test('a stored cooldown of zero or less still holds the command for 5 seconds, so it cannot be called in a flood', async () => {
    for (const cooldown of [0, -10, 1]) {
      chatClock.advance(1_500); // the bot's own gap between two lines in one chat
      tmiClient.said.length = 0;
      chatCommands = { [`cmd${cooldown < 0 ? 'n' : ''}${Math.abs(cooldown)}`]: { ...command('x', 'Follow us!'), cooldown } };
      const name = Object.keys(chatCommands)[0];
      await chat(`!${name}`, tags());
      await chat(`!${name}`, tags({ id: 'msg-2' }));
      await chat(`!${name}`, tags({ id: 'msg-3' }));
      assert.equal(tmiClient.said.length, 1, `cooldown ${cooldown}`);
    }
  });

  test('other messages that merely start with ! still reach their commands', async () => {
    chatCommands = { hi: command('hi', 'hello!') };
    await chat('!HI there', tags());
    assert.deepEqual(tmiClient.said.map((m) => m.text), ['hello!']);
  });
});

// ── Everything the bot says goes through the dispatcher (H11) ────────

describe('the bot\'s chat output', () => {
  const command = (name, response) => ({ id: 1, command: name, response, cooldown: 5, enabled: 1 });
  const texts = () => tmiClient.said.map((m) => m.text);

  test('uses the bot-wide limit from the configuration', () => {
    assert.equal(dispatcherStub.created.maxMessages, configStub.bot.chatMessagesPer30s);
  });

  test('two replies in one chat are 1.5 seconds apart', async () => {
    chatCommands = { a: command('a', 'first'), b: command('b', 'second') };
    await chat('!a', tags());
    await chat('!b', tags({ id: 'msg-2' }));
    assert.deepEqual(texts(), ['first']);
    chatClock.advance(1_499);
    assert.deepEqual(texts(), ['first']);
    chatClock.advance(1);
    assert.deepEqual(texts(), ['first', 'second']);
  });

  test('a moderation warning goes before a waiting thank-you, and that before a sponsor message', async () => {
    streamer = streamerRow({ mod_action_response: 'warn' });
    chatManager.sendMessage(1, 'sponsor going now', { priority: 'low' });
    chatManager.sendMessage(1, 'sponsor waiting', { priority: 'low' });
    chatManager.sendEventMessage(1, 'raid', { username: 'RaidLeader', viewers: 42 });
    await chat('look https://example.com', tags());
    chatClock.advance(10_000);
    assert.deepEqual(texts(), [
      'sponsor going now',
      '@viewer, warning: Link posted without permission',
      'Welcome raiders from RaidLeader!',
      'sponsor waiting',
    ]);
  });

  test('follows that arrive together are thanked in one line; a dashboard test goes at once, on its own', () => {
    streamer = streamerRow({ chat_follow_enabled: 1, chat_follow_template: 'Welcome to the pit crew, {username}!' });
    chatManager.sendEventMessage(1, 'follow', { username: 'A' });
    chatClock.advance(1_000);
    chatManager.sendEventMessage(1, 'follow', { username: 'B' });
    chatManager.sendEventMessage(1, 'follow', { username: '!C' });
    chatManager.sendEventMessage(1, 'follow', { username: 'TestRacer' }, { test: true });
    assert.deepEqual(texts(), ['Welcome to the pit crew, TestRacer!']);
    chatClock.advance(4_000);
    assert.deepEqual(texts(), ['Welcome to the pit crew, TestRacer!', 'Welcome to the pit crew, A, B and C!']);
  });

  test('subs share a line only with the same tier and months; bits never do', () => {
    streamer = streamerRow({
      chat_sub_enabled: 1, chat_sub_template: '{username}: Tier {tier}, {months} months',
      chat_bits_enabled: 1, chat_bits_template: '{username} cheered {amount} bits',
    });
    chatManager.sendEventMessage(1, 'subscription', { username: 'A', tier: '1', months: 1, message: null });
    chatManager.sendEventMessage(1, 'subscription', { username: 'B', tier: '1', months: 1, message: null });
    chatManager.sendEventMessage(1, 'subscription', { username: 'C', tier: '2', months: 1, message: null });
    chatManager.sendEventMessage(1, 'bits', { username: 'D', amount: 100, message: null });
    chatManager.sendEventMessage(1, 'bits', { username: 'E', amount: 100, message: null });
    chatClock.advance(30_000);
    assert.deepEqual(texts().sort(), ['A and B: Tier 1, 1 months', 'C: Tier 2, 1 months', 'D cheered 100 bits', 'E cheered 100 bits']);
  });

  test('a disabled account\'s chat gets nothing, and switching a chat off drops what waits for it', async () => {
    streamer = streamerRow({ enabled: 0 });
    chatCommands = { socials: command('socials', 'Follow us!') };
    chatManager.sendMessage(1, 'a giveaway line');
    await chat('!socials', tags());
    assert.deepEqual(texts(), []);

    streamer = streamerRow();
    chatManager.sendMessage(1, 'first');
    chatManager.sendMessage(1, 'second');
    chatManager.stopForStreamer(1);
    chatClock.advance(5_000);
    assert.deepEqual(texts(), ['first']);
  });
});

// ── Merged thank-yous through the real template (H11 + M9) ───────────

describe('merged follow thank-yous, filled from the real template', () => {
  const TEMPLATES = ['Welcome to the pit crew, {username}!', 'Welcome to the pit crew, {username}! 🏎️'];
  const PREFIX = 'Welcome to the pit crew, ';
  const texts = () => tmiClient.said.map((m) => m.text);

  // Every line ends as the template does, fits in one chat message, and every
  // follower is thanked exactly once.
  function assertEveryoneThanked(template, names) {
    const ending = template.slice(template.indexOf('{username}') + '{username}'.length);
    const thanked = [];
    for (const line of texts()) {
      assert.ok(line.startsWith(PREFIX) && line.endsWith(ending), `line ends as the template does: ...${line.slice(-40)}`);
      assert.ok(line.length <= 499, `${line.length} UTF-16 units`);
      thanked.push(...line.slice(PREFIX.length, line.length - ending.length).split(/, | and /));
    }
    assert.deepEqual(thanked.sort(), [...names].sort());
  }

  for (const template of TEMPLATES) {
    test(`a line filled to the brim takes no more names; the next one starts a new line (${template})`, () => {
      streamer = streamerRow({ chat_follow_enabled: 1, chat_follow_template: template });
      // With the first template these 34 names make a line of exactly 499 units.
      const names = [...Array.from({ length: 33 }, (_, i) => `follower${String(i).padStart(4, '0')}`), 'eightchr', 'LateViewer'];
      for (const username of names) chatManager.sendEventMessage(1, 'follow', { username });
      chatClock.advance(30_000);
      assert.equal(texts().length, 2);
      assertEveryoneThanked(template, names);
    });

    test(`a burst of 120 follows thanks every name once (${template})`, () => {
      streamer = streamerRow({ chat_follow_enabled: 1, chat_follow_template: template });
      // Twitch logins are 4-25 characters; a fixed pseudo-random sequence of lengths.
      let seed = 12345;
      const names = Array.from({ length: 120 }, (_, i) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        const length = 4 + (seed % 22);
        return `f${i}_`.concat('x'.repeat(30)).slice(0, Math.max(length, `f${i}_`.length));
      });
      for (const username of names) chatManager.sendEventMessage(1, 'follow', { username });
      chatClock.advance(120_000);
      assertEveryoneThanked(template, names);
    });
  }
});
