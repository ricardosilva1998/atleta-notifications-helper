'use strict';

// The built-in chat commands. Each test uses its own streamer id, because the
// 5-second command cooldowns are module state. Names are synthetic.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { getBuiltinResponse } = require('./builtinCommands');

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
