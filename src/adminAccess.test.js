'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { parseAdminDiscordIds, isAdminStreamer } = require('./adminAccess');

// The built-in admin (streamer #3's Discord user id).
const OWNER_ID = '1424474220976672940';

describe('admin access by Discord user id', () => {
  test('the built-in admin id is an admin with no env var set', () => {
    const ids = parseAdminDiscordIds(undefined);
    assert.deepEqual(ids, [OWNER_ID]);
    assert.equal(isAdminStreamer({ id: 3, discord_user_id: OWNER_ID }, ids), true);
  });

  test('a streamer named "Ricardo Apple" with another id is not an admin', () => {
    const ids = parseAdminDiscordIds('');
    const sameName = {
      id: 99,
      discord_user_id: '888888888888888888',
      discord_display_name: 'Ricardo Apple',
      discord_username: 'r1c4rd098',
    };
    assert.equal(isAdminStreamer(sameName, ids), false);
  });

  test('an id added through ADMIN_DISCORD_IDS is an admin', () => {
    const ids = parseAdminDiscordIds(' 111111111111111111 , 222222222222222222,');
    assert.equal(isAdminStreamer({ discord_user_id: '111111111111111111' }, ids), true);
    assert.equal(isAdminStreamer({ discord_user_id: '222222222222222222' }, ids), true);
    assert.equal(isAdminStreamer({ discord_user_id: OWNER_ID }, ids), true, 'the built-in id stays an admin');
    assert.equal(isAdminStreamer({ discord_user_id: '333333333333333333' }, ids), false);
  });

  test('names in ADMIN_DISCORD_IDS are ignored, only numeric ids count', () => {
    assert.deepEqual(parseAdminDiscordIds('Ricardo Apple,r1c4rd098'), [OWNER_ID]);
  });

  test('a repeated id is listed once', () => {
    assert.deepEqual(parseAdminDiscordIds(`${OWNER_ID},${OWNER_ID}`), [OWNER_ID]);
  });

  test('a missing streamer or Discord id is not an admin', () => {
    const ids = parseAdminDiscordIds('');
    assert.equal(isAdminStreamer(null, ids), false);
    assert.equal(isAdminStreamer(undefined, ids), false);
    assert.equal(isAdminStreamer({ id: 5 }, ids), false);
  });
});
