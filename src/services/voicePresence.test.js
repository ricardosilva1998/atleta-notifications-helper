'use strict';

// The Discord voice overlay's lookup (services/voicePresence.js): a Discord id
// must be a snowflake, and only a voice channel @everyone can see is reported.
// Guilds, channels and voice states are small fakes shaped like discord.js's;
// the permissions are real discord.js PermissionsBitField values.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const { isSnowflake, isPublicVoiceChannel, findPublicVoiceChannel } = require('./voicePresence');

const PUBLIC = new PermissionsBitField([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]);
const HIDDEN = new PermissionsBitField([PermissionFlagsBits.Connect]);

// A guild with voice channels; `members` maps a user id to the channel they are in.
function fakeGuild(id, channels, members) {
  const everyone = { id, name: '@everyone' };
  const guild = { id, roles: { everyone }, voiceStates: { cache: new Map() } };
  const byName = {};
  for (const [name, everyonePermissions] of Object.entries(channels)) {
    byName[name] = {
      id: `${id}-${name}`,
      name,
      guild,
      permissionsFor: (role) => (role === everyone ? everyonePermissions : null),
    };
  }
  for (const [userId, channelName] of Object.entries(members)) {
    const channel = channelName ? byName[channelName] : null;
    guild.voiceStates.cache.set(userId, { channelId: channel ? channel.id : null, channel });
  }
  return { guild, byName };
}

describe('isSnowflake', () => {
  test('accepts 17 to 20 digits only', () => {
    for (const id of ['12345678901234567', '1424474220976672940', '12345678901234567890']) assert.equal(isSnowflake(id), true, id);
    for (const id of ['1234567890123456', '123456789012345678901', '1424474220976672940a', ' 1424474220976672940', '../1424474220976672', '', null, undefined, 1424474220976672940]) {
      assert.equal(isSnowflake(id), false, String(id));
    }
  });
});

describe('isPublicVoiceChannel', () => {
  const { byName } = fakeGuild('900000000000000001', { lobby: PUBLIC, staff: HIDDEN }, {});

  test('a channel @everyone can view is public', () => {
    assert.equal(isPublicVoiceChannel(byName.lobby), true);
  });

  test('a channel hidden from @everyone is not', () => {
    assert.equal(isPublicVoiceChannel(byName.staff), false);
  });

  test('a missing channel, or one whose permissions cannot be read, is not', () => {
    assert.equal(isPublicVoiceChannel(null), false);
    assert.equal(isPublicVoiceChannel({ name: 'x', guild: null }), false);
    assert.equal(isPublicVoiceChannel({ ...byName.lobby, permissionsFor: () => null }), false);
  });
});

describe('findPublicVoiceChannel', () => {
  const USER = '300000000000000001';
  const OTHER = '300000000000000002';

  test('finds the public channel the user is in, in whichever server', () => {
    const a = fakeGuild('900000000000000001', { lobby: PUBLIC }, { [OTHER]: 'lobby' });
    const b = fakeGuild('900000000000000002', { racing: PUBLIC }, { [USER]: 'racing' });
    assert.equal(findPublicVoiceChannel([a.guild, b.guild], USER), b.byName.racing);
  });

  test('answers nothing for a channel hidden from @everyone, so who is in it is never shown', () => {
    const a = fakeGuild('900000000000000001', { staff: HIDDEN }, { [USER]: 'staff', [OTHER]: 'staff' });
    assert.equal(findPublicVoiceChannel([a.guild], USER), null);
  });

  test('answers nothing when the user is in no voice channel', () => {
    const a = fakeGuild('900000000000000001', { lobby: PUBLIC }, { [USER]: null, [OTHER]: 'lobby' });
    assert.equal(findPublicVoiceChannel([a.guild], USER), null);
    assert.equal(findPublicVoiceChannel([], USER), null);
  });

  test('works on the iterator the route passes (client.guilds.cache.values())', () => {
    const a = fakeGuild('900000000000000001', { lobby: PUBLIC }, { [USER]: 'lobby' });
    assert.equal(findPublicVoiceChannel(new Map([[a.guild.id, a.guild]]).values(), USER), a.byName.lobby);
  });
});
