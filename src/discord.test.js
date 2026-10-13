'use strict';

// Every post into Discord goes through fetchGuildChannel: a saved channel id is
// only used when it is a channel of the server the post is for. The Discord
// client never logs in here; servers are fake objects placed in its cache.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const DISCORD_FILE = path.join(__dirname, 'discord.js');

const dbCalls = { logged: [], errors: [], cleared: [] };
let claims = {}; // streamerId -> [{ guild_id }]
const dbStub = {
  logNotification: (...args) => dbCalls.logged.push(args),
  recordDeliveryError: (...args) => dbCalls.errors.push(args),
  clearDeliveryError: (...args) => dbCalls.cleared.push(args),
  getGuildsForStreamer: (id) => claims[id] || [],
};

// src/config.js exits without the real env vars and src/db.js opens the real
// database; discord.js also requires ./db lazily, so the hook stays installed.
const origLoad = Module._load.bind(Module);
Module._load = function (request, parent, isMain) {
  if (parent && parent.filename === DISCORD_FILE) {
    if (request === './config') return {};
    if (request === './db') return dbStub;
  }
  return origLoad(request, parent, isMain);
};
const discord = require('./discord');
const { client, fetchGuildChannel, sendToGuildChannel, sendNotification, streamerGuildForChannel } = discord;

const G1 = '100000000000000001';
const G2 = '100000000000000002';

function fakeChannel(id, guildId, { fail } = {}) {
  const sent = [];
  return {
    id, guildId, name: `chan-${id}`, sent,
    async send(payload) {
      if (fail) throw Object.assign(new Error(fail), { code: 50013, status: 403 });
      sent.push(payload);
    },
  };
}

// remote: channels Discord would return for a fetch that misses the cache.
function fakeGuild(id, channels, remote = []) {
  const fetched = [];
  return {
    id, fetched,
    channels: {
      cache: new Map(channels.map((c) => [c.id, c])),
      async fetch(channelId) {
        fetched.push(channelId);
        const hit = remote.find((c) => c.id === channelId);
        if (!hit) throw Object.assign(new Error('Unknown Channel'), { code: 10003 });
        return hit;
      },
    },
  };
}

let mine, theirs, elsewhere, uncached, broken;
beforeEach(() => {
  for (const key of Object.keys(dbCalls)) dbCalls[key].length = 0;
  claims = {};
  mine = fakeChannel('200000000000000001', G1);
  broken = fakeChannel('200000000000000002', G1, { fail: 'Missing Permissions' });
  uncached = fakeChannel('200000000000000003', G1);
  theirs = fakeChannel('300000000000000001', G2);
  elsewhere = fakeChannel('300000000000000002', G2);
  client.guilds.cache.clear();
  // G1's fallback fetch also "finds" a channel of G2, which must still be refused.
  client.guilds.cache.set(G1, fakeGuild(G1, [mine, broken], [uncached, elsewhere]));
  client.guilds.cache.set(G2, fakeGuild(G2, [theirs]));
});

function quietly(fn) {
  const { error, log } = console;
  console.error = () => {};
  console.log = () => {};
  return Promise.resolve().then(fn).finally(() => { console.error = error; console.log = log; });
}

describe('fetchGuildChannel', () => {
  test('returns a channel of the given server', async () => {
    assert.equal(await fetchGuildChannel(G1, mine.id), mine);
    assert.equal(await fetchGuildChannel(G1, uncached.id), uncached, 'fetched when not cached');
  });

  test('refuses a channel of another server, from the cache or from Discord', async () => {
    assert.equal(await fetchGuildChannel(G1, theirs.id), null);
    assert.equal(await fetchGuildChannel(G1, elsewhere.id), null);
  });

  test('refuses unknown channels, servers the bot is not in, and missing ids', async () => {
    assert.equal(await fetchGuildChannel(G1, '999999999999999999'), null);
    assert.equal(await fetchGuildChannel('100000000000000009', mine.id), null);
    assert.equal(await fetchGuildChannel(undefined, mine.id), null);
    assert.equal(await fetchGuildChannel(G1, null), null);
  });

  test('anything that is not a channel id is refused without asking Discord', async () => {
    const guild = client.guilds.cache.get(G1);
    for (const junk of ['general', '12', [mine.id, theirs.id], { id: mine.id }]) {
      assert.equal(await fetchGuildChannel(G1, junk), null, JSON.stringify(junk));
    }
    assert.deepEqual(guild.fetched, []);
  });
});

describe('sendToGuildChannel', () => {
  test('posts and clears the server\'s delivery error for that channel', async () => {
    assert.equal(await sendToGuildChannel(G1, 7, mine.id, { content: 'hi' }), true);
    assert.deepEqual(mine.sent, [{ content: 'hi' }]);
    assert.deepEqual(dbCalls.cleared, [[G1, 7, mine.id]]);
    assert.deepEqual(dbCalls.errors, []);
  });

  test('does not post into another server\'s channel and records why', async () => {
    assert.equal(await sendToGuildChannel(G1, 7, theirs.id, { content: 'hi' }), false);
    assert.deepEqual(theirs.sent, []);
    assert.deepEqual(dbCalls.errors, [[G1, 7, theirs.id, 'channel_unavailable']]);
  });

  test('records Discord\'s error and rethrows it', async () => {
    await assert.rejects(sendToGuildChannel(G1, 7, broken.id, { content: 'hi' }), /Missing Permissions/);
    assert.deepEqual(dbCalls.errors, [[G1, 7, broken.id, 'Missing Permissions']]);
    assert.deepEqual(dbCalls.cleared, []);
  });
});

describe('sendNotification', () => {
  const meta = { streamerId: 7, guildId: G1, type: 'twitch_live' };

  test('posts an embed into the watcher\'s server and logs it', async () => {
    await sendNotification(mine.id, { title: 'Live' }, meta);
    assert.deepEqual(mine.sent, [{ embeds: [{ title: 'Live' }] }]);
    assert.deepEqual(dbCalls.logged, [[7, G1, 'twitch_live', true]]);
  });

  test('posts plain content when asked', async () => {
    await sendNotification(mine.id, null, { ...meta, type: 'twitch_clip', contentOnly: 'https://clips.twitch.tv/x' });
    assert.deepEqual(mine.sent, ['https://clips.twitch.tv/x']);
  });

  test('a channel id from another server is refused, logged as failed, and not thrown', async () => {
    await quietly(() => sendNotification(theirs.id, { title: 'Live' }, meta));
    assert.deepEqual(theirs.sent, []);
    assert.deepEqual(dbCalls.logged, [[7, G1, 'twitch_live', false]]);
    assert.deepEqual(dbCalls.errors, [[G1, 7, theirs.id, 'channel_unavailable']]);
  });

  test('a Discord error is logged as failed and thrown to the caller', async () => {
    await quietly(() => assert.rejects(sendNotification(broken.id, { title: 'Live' }, meta), /Missing Permissions/));
    assert.deepEqual(dbCalls.logged, [[7, G1, 'twitch_live', false]]);
  });

  test('without a server id nothing is posted', async () => {
    await quietly(() => sendNotification(mine.id, { title: 'Live' }));
    assert.deepEqual(mine.sent, []);
  });
});

describe('streamerGuildForChannel', () => {
  test('finds the claimed server a moderation-log channel belongs to', () => {
    claims = { 7: [{ guild_id: G2 }, { guild_id: G1 }] };
    assert.equal(streamerGuildForChannel(7, mine.id), G1);
    assert.equal(streamerGuildForChannel(7, theirs.id), G2);
  });

  test('null for a channel outside the streamer\'s servers', () => {
    claims = { 7: [{ guild_id: G1 }] };
    assert.equal(streamerGuildForChannel(7, theirs.id), null);
    assert.equal(streamerGuildForChannel(8, mine.id), null);
    assert.equal(streamerGuildForChannel(7, null), null);
  });
});
