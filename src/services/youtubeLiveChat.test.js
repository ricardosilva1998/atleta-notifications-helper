'use strict';

// YouTube live chat commands: a lone "!" names no command, and a stored cooldown is
// held to 5-3600 seconds when it is checked (the same rules as the Twitch chat).
// The module starts a 50-minute interval when it loads, so the timers are mocked
// before it is required; db, YouTube and the built-in commands are stubs, and
// nothing leaves the machine. All ids and names are synthetic.

const { test, describe, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const STREAMER_ID = 7;
const sent = []; // what the bot said: { liveChatId, text }
let pages; // what YouTube answers, one page per poll
let commands = {}; // command name -> row, as db.getChatCommand returns it
let clock = 1_700_000_000_000; // what Date.now() says: the cooldowns are measured on it

const dbStub = {
  getStreamerById: (id) => (id === STREAMER_ID ? { id, yt_chatbot_enabled: 1, mod_link_permit_seconds: 60 } : null),
  getChatCommand: (_streamerId, name) => commands[name] || null,
};
const youtubeStub = {
  refreshYoutubeBotToken: async () => 'bot-token',
  sendYoutubeChatMessage: (liveChatId, text) => { sent.push({ liveChatId, text }); },
  fetchLiveChatMessages: async () => pages.shift() || { items: [], nextPageToken: 'end', pollingIntervalMillis: 5000 },
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
  pages = [];
  commands = {};
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
  pages.push({ items: [], nextPageToken: 'a', pollingIntervalMillis: 5000 });
  pages.push({ items: texts.map(textItem), nextPageToken: 'b', pollingIntervalMillis: 5000 });
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
