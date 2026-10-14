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
const { GatewayIntentBits } = require('discord.js');
const discord = require('./discord');
const { client, fetchGuildChannel, sendToGuildChannel, sendNotification, streamerGuildForChannel, buildWeeklyDigestEmbed, buildRecapEmbed, escapeLinkText } = discord;

const G1 = '100000000000000001';
const G2 = '100000000000000002';

function fakeChannel(id, guildId, { fail, textBased = true } = {}) {
  const sent = [];
  return {
    id, guildId, name: `chan-${id}`, sent,
    isTextBased: () => textBased,
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

let mine, theirs, elsewhere, uncached, broken, category, uncachedCategory;
beforeEach(() => {
  for (const key of Object.keys(dbCalls)) dbCalls[key].length = 0;
  claims = {};
  mine = fakeChannel('200000000000000001', G1);
  broken = fakeChannel('200000000000000002', G1, { fail: 'Missing Permissions' });
  uncached = fakeChannel('200000000000000003', G1);
  category = fakeChannel('200000000000000004', G1, { textBased: false });
  uncachedCategory = fakeChannel('200000000000000005', G1, { textBased: false });
  theirs = fakeChannel('300000000000000001', G2);
  elsewhere = fakeChannel('300000000000000002', G2);
  client.guilds.cache.clear();
  // G1's fallback fetch also "finds" a channel of G2, which must still be refused.
  client.guilds.cache.set(G1, fakeGuild(G1, [mine, broken, category], [uncached, elsewhere, uncachedCategory]));
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

  test('refuses a channel that cannot hold messages, such as a category, cached or fetched', async () => {
    assert.equal(await fetchGuildChannel(G1, category.id), null);
    assert.equal(await fetchGuildChannel(G1, uncachedCategory.id), null);
  });

  test('refuses an object that does not say whether it holds messages', async () => {
    const odd = { id: '200000000000000006', guildId: G1 };
    client.guilds.cache.get(G1).channels.cache.set(odd.id, odd);
    assert.equal(await fetchGuildChannel(G1, odd.id), null);
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

  test('does not post into a category and records why', async () => {
    assert.equal(await sendToGuildChannel(G1, 7, category.id, { content: 'hi' }), false);
    assert.deepEqual(category.sent, []);
    assert.deepEqual(dbCalls.errors, [[G1, 7, category.id, 'channel_unavailable']]);
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
    assert.equal(await sendNotification(mine.id, { title: 'Live' }, meta), true);
    assert.deepEqual(mine.sent, [{ embeds: [{ title: 'Live' }] }]);
    assert.deepEqual(dbCalls.logged, [[7, G1, 'twitch_live', true]]);
  });

  test('posts plain content when asked', async () => {
    await sendNotification(mine.id, null, { ...meta, type: 'twitch_clip', contentOnly: 'https://clips.twitch.tv/x' });
    assert.deepEqual(mine.sent, ['https://clips.twitch.tv/x']);
  });

  test('a channel id from another server is refused, logged as failed, not thrown, and reported as not posted', async () => {
    assert.equal(await quietly(() => sendNotification(theirs.id, { title: 'Live' }, meta)), false);
    assert.deepEqual(theirs.sent, []);
    assert.deepEqual(dbCalls.logged, [[7, G1, 'twitch_live', false]]);
    assert.deepEqual(dbCalls.errors, [[G1, 7, theirs.id, 'channel_unavailable']]);
  });

  test('a Discord error is logged as failed and thrown to the caller', async () => {
    await quietly(() => assert.rejects(sendNotification(broken.id, { title: 'Live' }, meta), /Missing Permissions/));
    assert.deepEqual(dbCalls.logged, [[7, G1, 'twitch_live', false]]);
  });

  test('without a server id nothing is posted, and it says so', async () => {
    assert.equal(await quietly(() => sendNotification(mine.id, { title: 'Live' })), false);
    assert.deepEqual(mine.sent, []);
  });
});

describe('the intents the bot asks Discord for', () => {
  test('servers, members and voice states are asked for; messages are not, because nothing reads them', () => {
    const intents = client.options.intents;
    assert.equal(intents.has(GatewayIntentBits.Guilds), true);
    assert.equal(intents.has(GatewayIntentBits.GuildMembers), true, 'the welcome message and role sync');
    assert.equal(intents.has(GatewayIntentBits.GuildVoiceStates), true, 'the Discord voice overlay');
    assert.equal(intents.has(GatewayIntentBits.GuildMessages), false, 'it made Discord send the bot every message in every server');
    assert.equal(intents.has(GatewayIntentBits.MessageContent), false);
  });

  test('nothing the bot sends may ping anyone unless that send says so', () => {
    assert.deepEqual(client.options.allowedMentions, { parse: [] });
  });
});

describe('buildWeeklyDigestEmbed', () => {
  const fieldsOf = (embed) => embed.toJSON().fields;
  const clip = { title: 'Last-lap pass', url: 'https://clips.twitch.tv/LastLap', view_count: 1234 };

  test('a week with streams but no clips has no empty Categories field (Discord rejects the whole message for one)', () => {
    const embed = buildWeeklyDigestEmbed({ streamCount: 3, totalHours: 7.25, categories: [], topClip: null });
    assert.deepEqual(fieldsOf(embed), [
      { name: 'Streams', value: '3', inline: true },
      { name: 'Total Hours', value: '7.3', inline: true },
    ]);
  });

  test('no field is ever empty, and none is over the 1024 characters Discord allows', () => {
    const cases = [
      { categories: [], topClip: null },
      { categories: [''], topClip: null },
      { categories: [], topClip: clip },
      { categories: ['iRacing', 'Just Chatting'], topClip: clip },
      { categories: Array.from({ length: 200 }, (_, i) => `A fairly long game title number ${i}`), topClip: clip },
    ];
    for (const extra of cases) {
      const embed = buildWeeklyDigestEmbed({ streamCount: 1, totalHours: 0.5, ...extra });
      for (const field of fieldsOf(embed)) {
        assert.ok(field.name.length > 0, JSON.stringify(extra));
        assert.ok(field.value.length > 0 && field.value.length <= 1024, `${field.name}: ${field.value.length}`);
      }
    }
  });

  test('categories are listed when there are some, and blank ones are dropped', () => {
    const embed = buildWeeklyDigestEmbed({ streamCount: 2, totalHours: 4, categories: ['iRacing', '', 'Just Chatting', null], topClip: null });
    assert.deepEqual(fieldsOf(embed).find((f) => f.name === 'Categories'), { name: 'Categories', value: 'iRacing, Just Chatting' });
  });

  test('the top clip shows its real view count, not "undefined views"', () => {
    const embed = buildWeeklyDigestEmbed({ streamCount: 2, totalHours: 4, categories: [], topClip: clip });
    const top = fieldsOf(embed).find((f) => f.name === 'Top Clip');
    assert.equal(top.value, '[Last-lap pass](https://clips.twitch.tv/LastLap) (1234 views)');
    assert.ok(!JSON.stringify(fieldsOf(embed)).includes('undefined'));
  });

  test('a clip whose view count is unknown is shown without a count', () => {
    for (const view_count of [undefined, null, 'x']) {
      const embed = buildWeeklyDigestEmbed({ streamCount: 1, totalHours: 1, categories: [], topClip: { ...clip, view_count } });
      const top = fieldsOf(embed).find((f) => f.name === 'Top Clip');
      assert.ok(!/undefined|NaN|null/.test(top.value), `${view_count}: ${top.value}`);
      assert.ok(top.value.startsWith('[Last-lap pass](https://clips.twitch.tv/LastLap)'));
    }
  });

  test('brackets in a clip title cannot end the link early', () => {
    const embed = buildWeeklyDigestEmbed({ streamCount: 1, totalHours: 1, categories: [], topClip: { ...clip, title: 'x](https://example.test/phish) [y' } });
    const top = fieldsOf(embed).find((f) => f.name === 'Top Clip');
    assert.equal(top.value, '[x\\](https://example.test/phish) \\[y](https://clips.twitch.tv/LastLap) (1234 views)');
  });
});

describe('escapeLinkText', () => {
  test('puts a backslash before each bracket and backslash, and leaves everything else as it is', () => {
    assert.equal(escapeLinkText('Last-lap pass (1:23.4) !!'), 'Last-lap pass (1:23.4) !!');
    assert.equal(escapeLinkText('x](https://example.test/phish) [y'), 'x\\](https://example.test/phish) \\[y');
    assert.equal(escapeLinkText('ends with a backslash \\'), 'ends with a backslash \\\\');
  });

  test('takes anything a title could be', () => {
    assert.equal(escapeLinkText(12345), '12345');
    assert.equal(escapeLinkText(''), '');
  });
});

describe('buildRecapEmbed', () => {
  const recap = (clips) => buildRecapEmbed({
    twitchUsername: 'some_streamer', title: 'Race night', category: 'iRacing', duration: 7200,
    peakViewers: 10, followerCount: 5, clips,
  });
  const topClips = (embed) => embed.toJSON().fields.find((f) => f.name === 'Top Clips').value;
  const clip = { title: 'Last-lap pass', url: 'https://clips.twitch.tv/LastLap', view_count: 1234 };

  test('lists the top clips as links with their view counts', () => {
    assert.equal(topClips(recap([clip, { ...clip, title: 'Second', url: 'https://clips.twitch.tv/Second', view_count: 5 }])),
      '1. [Last-lap pass](https://clips.twitch.tv/LastLap) (1234 views)\n2. [Second](https://clips.twitch.tv/Second) (5 views)');
  });

  test('brackets in a clip title cannot end the link early or start another', () => {
    const value = topClips(recap([{ ...clip, title: 'x](https://example.test/phish) [y' }]));
    assert.equal(value, '1. [x\\](https://example.test/phish) \\[y](https://clips.twitch.tv/LastLap) (1234 views)');
  });

  test('a backslash at the end of a title cannot hide the link\'s closing bracket', () => {
    const value = topClips(recap([{ ...clip, title: 'ends with a backslash \\' }]));
    assert.equal(value, '1. [ends with a backslash \\\\](https://clips.twitch.tv/LastLap) (1234 views)');
  });

  test('a recap without clips has no Top Clips field', () => {
    assert.equal(recap([]).toJSON().fields.some((f) => f.name === 'Top Clips'), false);
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

  test('null for a category, which cannot hold the log', () => {
    claims = { 7: [{ guild_id: G1 }] };
    assert.equal(streamerGuildForChannel(7, category.id), null);
  });
});
