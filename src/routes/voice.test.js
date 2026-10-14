'use strict';

// GET /api/voice/:discordUserId through the real router (routes/voice.js) on a
// small Express app. The Discord client is a stub shaped like discord.js's (real
// Collection and PermissionsBitField), so it answers as the Atleta Racing app's
// Discord overlay sees it: 400 for an id that is not a snowflake, nothing for a
// channel @everyone cannot see, and the members of a public one in the shape the
// overlay reads. All ids and names are synthetic.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');
const { Collection, PermissionsBitField, PermissionFlagsBits } = require('discord.js');

const VOICE_FILE = path.join(__dirname, 'voice.js');

const STREAMER = '300000000000000001';
const FRIEND = '300000000000000002';
const BOT = '300000000000000003';

const guilds = new Map(); // what client.guilds.cache holds
const discordStub = { client: { guilds: { cache: guilds } } };
const tracker = { joined: [], scheduled: 0, speaking: new Set() };
const voiceTrackerStub = {
  ensureConnected: async (channel) => { tracker.joined.push(channel.name); },
  scheduleDisconnect: () => { tracker.scheduled += 1; },
  isSpeaking: (id) => tracker.speaking.has(id),
};

let server;
let port;
const saved = {};
const errors = [];

before(async () => {
  saved.load = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === VOICE_FILE) {
      if (request === '../discord') return discordStub;
      if (request === '../services/voiceTracker') return voiceTrackerStub;
    }
    return saved.load.call(this, request, parent, isMain);
  };
  saved.error = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  delete require.cache[VOICE_FILE];
  const app = express();
  app.use('/api/voice', require('./voice'));
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = server.address().port;
});

after(async () => {
  console.error = saved.error;
  Module._load = saved.load;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  guilds.clear();
  discordStub.client.guilds.cache = guilds;
  tracker.joined.length = 0;
  tracker.scheduled = 0;
  tracker.speaking.clear();
  errors.length = 0;
});

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath, agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    }).on('error', reject);
  });
}

// A server with one voice channel; `visible` says whether @everyone may view it.
function voiceChannel(name, { visible }) {
  const guild = { id: '900000000000000001', roles: { everyone: { id: '900000000000000001' } }, voiceStates: { cache: new Map() } };
  const channel = {
    id: '910000000000000001',
    name,
    guild,
    members: new Collection(),
    permissionsFor: (role) => (role === guild.roles.everyone
      ? new PermissionsBitField(visible ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] : [PermissionFlagsBits.Connect])
      : null),
  };
  guilds.set(guild.id, guild);
  return channel;
}

// Puts a user in the channel, with their voice state (mute, deafen, stream, camera).
function join(channel, user, voice = {}) {
  const { guild } = channel;
  const state = { channelId: channel.id, channel, ...voice };
  guild.voiceStates.cache.set(user.id, state);
  channel.members.set(user.id, { id: user.id, user, displayName: user.nick, guild, voice: state });
}

const user = (id, extra = {}) => ({ id, username: `user${id.slice(-1)}`, displayName: `User ${id.slice(-1)}`, avatar: null, bot: false, ...extra });

describe('GET /api/voice/:discordUserId', () => {
  test('an id that is not a 17-20 digit snowflake is a 400', async () => {
    for (const id of ['abc', '1234567890123456', '123456789012345678901', `${STREAMER}a`, '%2E%2E']) {
      const res = await get(`/api/voice/${id}`);
      assert.equal(res.status, 400, id);
      assert.deepEqual(res.body, { error: 'Invalid Discord user id' });
    }
  });

  test('someone in a channel @everyone cannot see is answered like someone in no channel, and the bot does not join it', async () => {
    const staff = voiceChannel('Staff room', { visible: false });
    join(staff, user(STREAMER));
    join(staff, user(FRIEND));
    const res = await get(`/api/voice/${STREAMER}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { channelName: null, members: [] });
    assert.deepEqual(tracker.joined, []);
  });

  test('someone in no voice channel gets the same empty answer', async () => {
    voiceChannel('Racing', { visible: true });
    const res = await get(`/api/voice/${STREAMER}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { channelName: null, members: [] });
  });

  test('a public channel answers with its people, in the shape the overlay reads, without bots', async () => {
    const racing = voiceChannel('Racing', { visible: true });
    join(racing, user(STREAMER, { avatar: 'a1b2c3', nick: 'Streamer Nick' }), { selfMute: true, streaming: true });
    join(racing, user(FRIEND), { selfDeaf: true, serverMute: true, serverDeaf: true, selfVideo: true });
    join(racing, user(BOT, { bot: true }));
    tracker.speaking.add(FRIEND);

    const res = await get(`/api/voice/${STREAMER}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      channelName: 'Racing',
      members: [
        {
          id: STREAMER, username: 'user1', displayName: 'Streamer Nick',
          avatar: `https://cdn.discordapp.com/avatars/${STREAMER}/a1b2c3.webp?size=64`,
          selfMute: true, selfDeaf: false, serverMute: false, serverDeaf: false,
          streaming: true, camera: false, speaking: false, isStreamer: true,
        },
        {
          id: FRIEND, username: 'user2', displayName: 'User 2',
          avatar: `https://cdn.discordapp.com/embed/avatars/${(BigInt(FRIEND) >> 22n) % 6n}.png`,
          selfMute: false, selfDeaf: true, serverMute: true, serverDeaf: true,
          streaming: false, camera: true, speaking: true, isStreamer: false,
        },
      ],
    });
    assert.deepEqual(tracker.joined, ['Racing'], 'the bot joins only a public channel');
    assert.equal(tracker.scheduled, 1);
  });

  test('an unexpected error is a 500 that does not repeat the error, which goes to the log', async () => {
    discordStub.client.guilds.cache = { values() { throw new Error('cache exploded at 0xdeadbeef'); } };
    const res = await get(`/api/voice/${STREAMER}`);
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: 'Internal error' });
    assert.match(errors.join('\n'), /\[Voice API\] cache exploded/);
  });
});
