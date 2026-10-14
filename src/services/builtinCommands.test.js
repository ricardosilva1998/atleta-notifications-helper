'use strict';

// The built-in chat commands. Each test uses its own streamer id, because the
// 5-second command cooldowns are module state. Names are synthetic.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

// What the stubbed Twitch follow check does: answer `follow`, or throw `fail`.
const twitchStub = {
  calls: [],
  follow: null,
  fail: null,
  async getFollowAge(streamer, userId) {
    twitchStub.calls.push({ streamerId: streamer.id, userId });
    if (twitchStub.fail) throw twitchStub.fail;
    return twitchStub.follow;
  },
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './twitch' && parent && parent.filename.endsWith(`${path.sep}builtinCommands.js`)) return twitchStub;
  return origLoad.call(this, request, parent, isMain);
};
const { getBuiltinResponse, handleBuiltinCommand } = require('./builtinCommands');

let nextStreamerId = 1;
const streamerWith = (columns) => ({ id: nextStreamerId++, ...columns });

describe('!roast', () => {
  test('a target that starts with a command character cannot start the bot\'s line with a command', () => {
    for (const target of ['!title', '/ban', '.timeout', '\\x', '@!title']) {
      const { response } = getBuiltinResponse('roast', [target], streamerWith({ cmd_roast_enabled: 1 }), 'Viewer');
      assert.match(response, /^[a-z]+, /, target);
    }
  });

  test('a target that is only command characters roasts the viewer who asked', () => {
    const { response } = getBuiltinResponse('roast', ['!!'], streamerWith({ cmd_roast_enabled: 1 }), 'Viewer');
    assert.match(response, /^Viewer, /);
  });

  test('an ordinary target is used as it is', () => {
    const { response } = getBuiltinResponse('roast', ['@SomeDriver'], streamerWith({ cmd_roast_enabled: 1 }), 'Viewer');
    assert.match(response, /^SomeDriver, /);
  });
});

describe('!followage (M10)', () => {
  let said; // a new array per test, so a failure report shows that test's replies
  const client = { say: (channel, text) => { said.push(text); return Promise.resolve(); } };
  const viewer = { username: 'viewer', 'display-name': 'Viewer', 'user-id': '555' };
  const realWarn = console.warn;
  let warnings;

  beforeEach(() => {
    said = [];
    twitchStub.calls.length = 0;
    twitchStub.follow = null;
    twitchStub.fail = null;
    warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
  });
  afterEach(() => { console.warn = realWarn; });

  const followage = (streamer) => handleBuiltinCommand(client, '#somestreamer', viewer, 'followage', [], streamer);

  test('is checked with the streamer and the viewer\'s Twitch id', async () => {
    twitchStub.follow = { following: true, followedAt: new Date(Date.now() - 3 * 86_400_000 - 60_000).toISOString() };
    const streamer = streamerWith({ cmd_followage_enabled: 1 });
    assert.equal(await followage(streamer), true);
    assert.deepEqual(twitchStub.calls, [{ streamerId: streamer.id, userId: '555' }]);
    assert.deepEqual(said, ['🏁 Viewer has been following for 3 days!']);
  });

  test('says "not following" only when Twitch answered that', async () => {
    twitchStub.follow = { following: false, followedAt: null };
    await followage(streamerWith({ cmd_followage_enabled: 1 }));
    assert.deepEqual(said, ['Viewer is not following the channel.']);
  });

  test('when Twitch cannot be asked or answers an error, the reply is neutral, never "not following"', async () => {
    const failures = [Object.assign(new Error('The broadcaster token cannot read followers'), { code: 'NO_FOLLOWER_ACCESS' }), new Error('Followers API error: 500')];
    for (const failure of failures) {
      said = [];
      twitchStub.fail = failure;
      assert.equal(await followage(streamerWith({ cmd_followage_enabled: 1 })), true);
      assert.deepEqual(said, ['Could not check follow age.'], failure.message);
    }
    assert.equal(warnings.length, 2, 'each failure is logged');
    assert.match(warnings[0], /!followage could not be checked in #somestreamer/);
  });

  test('a follow with no date is not guessed either', async () => {
    twitchStub.follow = { following: true, followedAt: null };
    await followage(streamerWith({ cmd_followage_enabled: 1 }));
    assert.deepEqual(said, ['Could not check follow age.']);
  });

  test('is off unless the streamer turned it on', async () => {
    assert.equal(await followage(streamerWith({ cmd_followage_enabled: 0 })), false);
    assert.deepEqual(twitchStub.calls, []);
    assert.deepEqual(said, []);
  });
});
