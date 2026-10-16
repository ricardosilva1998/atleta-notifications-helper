'use strict';

// The Shoutouts card's behaviour (services/shoutouts.js) with fakes for Twitch's lookups, the chat bot and the
// database, and a clock the tests move: who may use !so, the line, the raid minimum, the one-a-minute rule and the
// 10-minute memory of each name. All names and ids are synthetic.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createShoutouts, shoutouts, isShoutoutCommand, shoutoutLine, RAID_MIN_VIEWERS } = require('./shoutouts');

const NOW = Date.parse('2026-10-15T20:00:00Z');
const TEMPLATE = 'Go check out {name}! They were last streaming {game}: {link}';
const OTHER_LINE = 'Go check out OtherStreamer! They were last streaming iRacing: https://twitch.tv/otherstreamer';

function setup({ streamer = {} } = {}) {
  const world = {
    t: NOW, said: [], lookups: [], logged: [], failing: false,
    streamer: {
      id: 7, twitch_username: 'mychannel', chatbot_enabled: 1, shoutout_command_enabled: 1, shoutout_raid_enabled: 1,
      shoutout_raid_min_viewers: 5, shoutout_template: TEMPLATE, ...streamer,
    },
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

  // The chat dispatcher posts nothing while the chatbot is off: the raider is not looked up, and their minute stays
  // free for a moderator's !so once the chatbot is back on.
  test('with the chatbot off: nothing is looked up and the raider\'s minute stays free', async () => {
    const w = setup({ streamer: { chatbot_enabled: 0 } });
    assert.equal(await w.so.afterRaid(7, { login: 'otherstreamer', viewers: 50 }), 'off');
    assert.deepEqual([w.lookups, w.said], [[], []]);
    w.streamer.chatbot_enabled = 1;
    assert.equal(await w.so.fromCommand(w.streamer, '!so otherstreamer'), 'sent');
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

// The app's own instance looks a channel up with Twitch's Get Users, then Get Channel Information; the two share one
// 10-second deadline, so Test in chat answers before the page gives up (20 s). Twitch and the chat bot are stubs.
describe('the app\'s lookup', () => {
  async function withTwitch(t, users, channels, fn) {
    const Module = require('module');
    const FILE = require.resolve('./shoutouts');
    const real = AbortSignal.timeout;
    const deadlines = [];
    t.mock.method(AbortSignal, 'timeout', (ms) => { deadlines.push(ms); return real.call(AbortSignal, ms); });
    const asked = [];
    const sent = [];
    const stubs = {
      './twitch': {
        getUserProfile: async (login, options) => { asked.push(['user', login, options && options.signal]); return users[login] || null; },
        getChannelInfo: async (id, options) => { asked.push(['channel', id, options && options.signal]); return channels[id] || null; },
      },
      './twitchChat': { chatManager: { sendMessage: (streamerId, text, opts) => sent.push([streamerId, text, opts.priority]) } },
    };
    const load = Module._load;
    Module._load = function (request, parent, isMain) {
      if (parent && parent.filename === FILE && Object.hasOwn(stubs, request)) return stubs[request];
      return load.call(this, request, parent, isMain);
    };
    try {
      return { outcome: await fn(), asked, sent, deadlines };
    } finally {
      Module._load = load;
    }
  }
  const streamer = (login) => ({ id: 7, twitch_username: login, shoutout_template: '{name} | {game} | {title} | {link}' });

  test('the display name, the game and the title, from two requests under one deadline', async (t) => {
    const { outcome, asked, sent, deadlines } = await withTwitch(t,
      { synthetic_one: { id: '4242', login: 'synthetic_one', display_name: 'Synthetic_One', profile_image_url: 'https://example.invalid/a.png' } },
      { 4242: { gameName: 'iRacing', title: 'Endurance night' } },
      () => shoutouts.testInChat(streamer('Synthetic_One')));
    assert.equal(outcome, 'sent');
    assert.deepEqual(sent, [[7, 'Synthetic_One | iRacing | Endurance night | https://twitch.tv/synthetic_one', 'high']]);
    assert.deepEqual(asked.map(([what, arg]) => [what, arg]), [['user', 'synthetic_one'], ['channel', '4242']]);
    assert.ok(asked[0][2] instanceof AbortSignal, 'the requests have a deadline');
    assert.equal(asked[1][2], asked[0][2], 'one deadline for both');
    assert.deepEqual(deadlines, [10000]);
  });

  test('no display name: the login; no channel information: no game and no title; no such user: nothing posted', async (t) => {
    const { outcome, sent } = await withTwitch(t,
      { synthetic_two: { id: '4343', login: 'synthetic_two', display_name: '' } }, {},
      () => shoutouts.testInChat(streamer('synthetic_two')));
    assert.equal(outcome, 'sent');
    assert.deepEqual(sent, [[7, 'synthetic_two |  |  | https://twitch.tv/synthetic_two', 'high']]);
    const missing = await withTwitch(t, {}, {}, () => shoutouts.testInChat(streamer('synthetic_three')));
    assert.equal(missing.outcome, 'unknown');
    assert.deepEqual(missing.asked.map(([what]) => what), ['user'], 'Get Channel Information is not asked for');
    assert.deepEqual(missing.sent, []);
  });
});
