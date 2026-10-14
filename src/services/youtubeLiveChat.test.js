'use strict';

// YouTube live chat commands: a lone "!" names no command, and a stored cooldown is
// held to 5-3600 seconds when it is checked (the same rules as the Twitch chat).
// The bot's access token is replaced when it has expired. The polling runs on
// timers, so they are mocked before the module is required; db, YouTube and the
// built-in commands are stubs, and nothing leaves the machine. All ids and names
// are synthetic.

const { test, describe, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const STREAMER_ID = 7;
const OTHER_STREAMER_ID = 8;
const sent = []; // what the bot said: { liveChatId, text }
const tokensUsed = []; // the access token each of those messages was sent with
let tokenRequests; // how many times a new access token was asked for
let tokenAnswer; // what the token endpoint answers: () => { accessToken, expiresAt } | null | a promise of either
let fetchCalls; // how many times the chat was read
let pages; // what YouTube answers, one page per poll
let commands = {}; // command name -> row, as db.getChatCommand returns it
let clock = 1_700_000_000_000; // what Date.now() says: the cooldowns are measured on it

let streamerExtra = {}; // more columns of the streamer row, set by a test
const dbStub = {
  getStreamerById: (id) => ((id === STREAMER_ID || id === OTHER_STREAMER_ID) ? { id, yt_chatbot_enabled: 1, mod_link_permit_seconds: 60, ...streamerExtra } : null),
  getChatCommand: (_streamerId, name) => commands[name] || null,
};
const youtubeStub = {
  requestYoutubeBotToken: async () => { tokenRequests += 1; return tokenAnswer(); },
  sendYoutubeChatMessage: (liveChatId, text, token) => { sent.push({ liveChatId, text }); tokensUsed.push(token); },
  fetchLiveChatMessages: async () => { fetchCalls += 1; return pages.shift() || { items: [], nextPageToken: 'end', pollingIntervalMillis: 5000 }; },
};
const stubs = {
  '../config': {},
  '../db': dbStub,
  './youtube': youtubeStub,
  './builtinCommands': { getBuiltinResponse: () => null, getCommandsList: () => [] },
  './youtubeModeration': { moderateYoutubeMessage: async () => ({ moderated: false }), grantYoutubePermit: () => false },
};

const origLoad = Module._load;
const realLog = console.log;
let dateNow;
let youtubeChatManager;

before(() => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  dateNow = mock.method(Date, 'now', () => clock);
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename && parent.filename.endsWith(`${path.sep}youtubeLiveChat.js`) && request in stubs) return stubs[request];
    return origLoad.call(this, request, parent, isMain);
  };
  ({ youtubeChatManager } = require('./youtubeLiveChat'));
});

after(() => {
  Module._load = origLoad;
  dateNow.mock.restore();
  mock.timers.reset();
});

beforeEach(() => {
  sent.length = 0;
  tokensUsed.length = 0;
  tokenRequests = 0;
  fetchCalls = 0;
  tokenAnswer = () => ({ accessToken: 'bot-token', expiresAt: clock + 59 * 60_000 });
  pages = [];
  commands = {};
  streamerExtra = {};
  console.log = () => {};
});
afterEach(() => {
  youtubeChatManager.stopAll();
  console.log = realLog;
});

const textItem = (text) => ({
  snippet: { type: 'textMessageEvent', textMessageDetails: { messageText: text } },
  authorDetails: { displayName: 'Viewer' },
});

// Lets the polling and the message handling (promises) run to the end.
async function flush() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}

// Starts polling and delivers `texts` as chat messages. The first poll's messages
// are skipped by the module (so old chat is not replayed), so they arrive on the second.
async function say(...texts) {
  await deliver(texts.map(textItem));
}

async function deliver(items) {
  pages.push({ items: [], nextPageToken: 'a', pollingIntervalMillis: 5000 });
  pages.push({ items, nextPageToken: 'b', pollingIntervalMillis: 5000 });
  youtubeChatManager.startPolling(STREAMER_ID, 'chat-1');
  await flush();
  mock.timers.tick(5000);
  await flush();
}

const command = (name, response, cooldown = 5) => ({ id: 1, command: name, response, cooldown, enabled: 1 });

describe('custom commands in YouTube live chat', () => {
  test('a command is answered', async () => {
    commands = { socials: command('socials', 'Follow us!') };
    await say('!socials');
    assert.deepEqual(sent, [{ liveChatId: 'chat-1', text: 'Follow us!' }]);
  });

  test('a lone "!" is ignored, even if a command with a blank name was saved earlier', async () => {
    commands = { '': command('', 'I answer everything') };
    await say('!', '! hello there', '!   ');
    assert.deepEqual(sent, []);
  });

  test('other messages that merely start with ! still reach their commands', async () => {
    commands = { hi: command('hi', 'hello!') };
    await say('!HI there');
    assert.deepEqual(sent.map((m) => m.text), ['hello!']);
  });

  test('a stored cooldown of zero or less still holds the command for 5 seconds, so it cannot be called in a flood', async () => {
    commands = { floodzero: command('floodzero', 'zero', 0), floodneg: command('floodneg', 'negative', -10), floodone: command('floodone', 'one', 1) };
    await say('!floodzero', '!floodzero', '!floodzero', '!floodneg', '!floodneg', '!floodone', '!floodone');
    assert.deepEqual(sent.map((m) => m.text).sort(), ['negative', 'one', 'zero']);
  });

  test('a cooldown that has run out lets the command answer again, and not a second sooner', async () => {
    commands = { again: command('again', 'once more', 10) };
    await say('!again');
    assert.equal(sent.length, 1);
    clock += 9_000;
    await say('!again');
    assert.equal(sent.length, 1, '9 s into a 10 s cooldown');
    clock += 1_000;
    await say('!again');
    assert.equal(sent.length, 2, 'the 10 s are over');
  });

  test('a stored cooldown of years is held to an hour', async () => {
    commands = { huge: command('huge', 'still here', 4_000_000_000) };
    await say('!huge');
    assert.equal(sent.length, 1);
    clock += 3_599_000;
    await say('!huge');
    assert.equal(sent.length, 1, 'one second short of an hour');
    clock += 1_000;
    await say('!huge');
    assert.equal(sent.length, 2, 'an hour later it answers again');
  });
});

describe('Super Chat thank-yous', () => {
  const superChat = (displayName, comment) => ({
    snippet: { type: 'superChatEvent', superChatDetails: { amountDisplayString: '$5.00', userComment: comment } },
    authorDetails: { displayName },
  });

  test('the viewer\'s name and comment are filled in as plain text that cannot start a command', async () => {
    streamerExtra = { yt_chat_superchat_enabled: 1, yt_chat_superchat_template: '{username} sent {amount}! {message}' };
    await deliver([superChat('!commands $&$&', "$'$'$' and\nmore")]);
    assert.deepEqual(sent, [{ liveChatId: 'chat-1', text: "commands $&$& sent $5.00! $'$'$' and more" }]);
  });
});

describe('the bot\'s access token', () => {
  const HOUR = 3_600_000;
  const quiet = (fn) => {
    const { error } = console;
    console.error = () => {};
    return Promise.resolve().then(fn).finally(() => { console.error = error; });
  };

  // Whatever an earlier test left cached has run out; the next token is numbered by request.
  beforeEach(() => {
    clock += 2 * HOUR;
    tokenAnswer = () => ({ accessToken: `token-${tokenRequests}`, expiresAt: clock + 59 * 60_000 });
    commands = { hi: command('hi', 'hello', 5) };
  });

  test('is asked for once and kept while it is valid', async () => {
    await say('!hi');
    clock += 30 * 60_000;
    await say('!hi');
    assert.equal(sent.length, 2);
    assert.equal(tokenRequests, 1);
    assert.deepEqual(tokensUsed, ['token-1', 'token-1']);
  });

  test('a token kept from the last stream has expired by the next one, and is replaced before it is used', async () => {
    await say('!hi');
    assert.deepEqual(tokensUsed, ['token-1']);

    youtubeChatManager.stopAll(); // the stream ends; the bot idles for two hours
    clock += 2 * HOUR;

    await say('!hi'); // the next stream
    assert.equal(tokenRequests, 2, 'a new token was asked for, not the old one reused');
    assert.deepEqual(tokensUsed, ['token-1', 'token-2']);
    assert.ok(fetchCalls >= 3, 'and the chat was read with it');
  });

  test('the chat polled by two streamers at the same moment shares one refresh', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    tokenAnswer = async () => { await gate; return { accessToken: 'shared-token', expiresAt: clock + 59 * 60_000 }; };

    youtubeChatManager.startPolling(STREAMER_ID, 'chat-1');
    youtubeChatManager.startPolling(OTHER_STREAMER_ID, 'chat-2');
    await flush();
    assert.equal(tokenRequests, 1, 'the second asker waits for the refresh already under way');

    release();
    await flush();
    assert.equal(tokenRequests, 1);
    assert.ok(fetchCalls >= 2, 'both chats are read once the token is there');
  });

  test('when no token can be had the chat is not read with a dead one, and the next poll asks again', async () => {
    tokenAnswer = () => null;
    await quiet(async () => {
      youtubeChatManager.startPolling(STREAMER_ID, 'chat-1');
      await flush();
      assert.equal(fetchCalls, 0, 'nothing was read without a token');
      assert.equal(tokenRequests, 1);

      tokenAnswer = () => ({ accessToken: 'recovered', expiresAt: clock + 59 * 60_000 });
      mock.timers.tick(30_000); // the retry the module schedules
      await flush();
    });
    assert.equal(tokenRequests, 2);
    assert.ok(fetchCalls >= 1, 'read as soon as a token came');
  });
});
