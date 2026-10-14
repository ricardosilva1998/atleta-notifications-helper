'use strict';

// The weekly digest poller (M19, R-a): a week with streams but no clips is
// posted, a post that did not go out is not recorded as posted, and a failed
// digest is tried again, at most three times in the hour. db, config, Discord
// and Twitch are stubs; nothing leaves the machine. All ids and names are synthetic.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const POLLER_FILE = path.join(__dirname, 'weeklyDigest.js');
const G1 = '400000000000000051';
const G2 = '400000000000000052';

const world = {}; // everything the stubs know; rebuilt before each test
const dbStub = {
  getGuildsWithWeeklyHighlights: () => world.guilds,
  getStreamerTier: () => world.tier,
  getWeeklyDigestState: (guildId) => (world.postedOn[guildId] ? { last_digest_date: world.postedOn[guildId] } : undefined),
  getDigestChannelForGuild: (guildId) => world.channelOf[guildId] || null,
  getWatchedChannelsForGuild: (guildId) => (world.watched[guildId] || []).map((twitch_username) => ({ twitch_username })),
  getChannelState: () => ({ twitch_broadcaster_id: '777' }),
  updateChannelState: () => {},
  updateWeeklyDigestDate: (guildId, date) => { world.postedOn[guildId] = date; world.recorded.push([guildId, date]); },
};
const configStub = { tiers: { free: { weeklyHighlights: true }, none: { weeklyHighlights: false } } };
const discordStub = {
  buildWeeklyDigestEmbed: (summary) => ({ digest: summary }),
  sendNotification: async (channelId, embed, meta) => {
    world.sends.push({ channelId, embed, meta });
    const outcome = world.sendOutcome(meta.guildId, world.sends.length);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  },
};
const twitchStub = {
  getUserId: async () => '777',
  getVideos: async (...args) => { world.twitchCalls.push(['videos', ...args]); if (world.twitchDown) throw new Error('Twitch API error: 500'); return world.videos; },
  getClips: async (...args) => { world.twitchCalls.push(['clips', ...args]); if (world.twitchDown) throw new Error('Twitch API error: 500'); return world.clips; },
  getGameNames: async (ids) => { world.twitchCalls.push(['games', ids]); return ids.map((id) => `Game ${id}`); },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent && parent.filename === POLLER_FILE) {
    if (request === '../db') return dbStub;
    if (request === '../config') return configStub;
    if (request === '../discord') return discordStub;
    if (request === '../services/twitch') return twitchStub;
  }
  return origLoad.call(this, request, parent, isMain);
};
const { pollWeeklyDigest, summarizeWeek, parseTwitchDuration, MAX_ATTEMPTS, RETRY_GAP_MS } = require('./weeklyDigest');
Module._load = origLoad;

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const realConsole = { log: console.log, error: console.error };
let logs;
let weekNumber = 0;
let monday; // the date (YYYY-MM-DD) of this test's own Monday: 2026-10-12 is one

beforeEach(() => {
  // The poller remembers its tries per server and week; a Monday of its own keeps one test from affecting the next.
  monday = new Date(Date.UTC(2026, 9, 12) + (weekNumber++) * 7 * DAY).toISOString().slice(0, 10);
  Object.keys(world).forEach((key) => delete world[key]);
  Object.assign(world, {
    guilds: [{ guild_id: G1, streamer_id: 1 }],
    tier: 'free',
    postedOn: {},
    channelOf: { [G1]: 'DIGEST-CHANNEL', [G2]: 'DIGEST-CHANNEL-2' },
    watched: { [G1]: ['some_channel'], [G2]: ['some_channel'] },
    videos: [{ duration: '2h30m10s', created_at: '2026-10-08T18:00:00Z' }, { duration: '45m', created_at: '2026-10-10T18:00:00Z' }],
    clips: [],
    twitchDown: false,
    twitchCalls: [],
    sends: [],
    recorded: [],
    sendOutcome: () => true,
  });
  logs = [];
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => logs.push(`error: ${args.join(' ')}`);
});

afterEach(() => {
  Object.assign(console, realConsole);
});

// A tick of the poller at a time of this test's Monday, such as '09:25'.
const tick = (time, date = monday) => pollWeeklyDigest(new Date(`${date}T${time}:00Z`));
const dayAfter = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

describe('what gets posted', () => {
  test('a week with streams but no clips is posted, with no categories and no top clip', async () => {
    await tick('09:05');

    assert.equal(world.sends.length, 1);
    assert.equal(world.sends[0].channelId, 'DIGEST-CHANNEL');
    assert.deepEqual(world.sends[0].embed.digest, { streamCount: 2, totalHours: (2 * 3600 + 30 * 60 + 10 + 45 * 60) / 3600, categories: [], topClip: null });
    assert.deepEqual(world.sends[0].meta, { streamerId: 1, guildId: G1, type: 'weekly_digest' });
    assert.deepEqual(world.recorded, [[G1, monday]]);
  });

  test('the top clip carries its view count under the name Twitch gives it, and the games of the clips are listed', async () => {
    world.clips = [
      { title: 'Small', url: 'https://clips.test/s', view_count: 5, game_id: '1' },
      { title: 'Big', url: 'https://clips.test/b', view_count: 400, game_id: '2' },
      { title: 'Other', url: 'https://clips.test/o', view_count: 7, game_id: '1' },
    ];
    await tick('09:05');

    const summary = world.sends[0].embed.digest;
    assert.deepEqual(summary.topClip, { title: 'Big', url: 'https://clips.test/b', view_count: 400 });
    assert.deepEqual(summary.categories, ['Game 1', 'Game 2']);
  });

  test('a week with nothing in it is not posted, and not recorded', async () => {
    world.videos = [];
    await tick('09:05');
    assert.deepEqual(world.sends, []);
    assert.deepEqual(world.recorded, []);
  });

  test('only on Monday between 09:00 and 09:59 UTC', async () => {
    await tick('09:05', dayAfter(monday, 1)); // Tuesday
    await tick('09:30', dayAfter(monday, -1)); // Sunday
    await tick('08:59');
    await tick('10:00');
    assert.deepEqual(world.sends, []);
    assert.deepEqual(world.twitchCalls, []);
  });

  test('a server whose plan has no weekly highlights, or that has no channel to post in, is skipped', async () => {
    world.tier = 'none';
    await tick('09:05');
    world.tier = 'free';
    world.channelOf = {};
    await tick('09:25');
    assert.deepEqual(world.sends, []);
  });

  test('a digest already posted this week is not posted again', async () => {
    await tick('09:05');
    await tick('09:25');
    await tick('09:45');
    assert.equal(world.sends.length, 1);
    assert.equal(world.twitchCalls.filter((c) => c[0] === 'videos').length, 1, 'and Twitch is not asked again');
  });

  test('a channel several servers watch is read from Twitch once per run', async () => {
    world.guilds = [{ guild_id: G1, streamer_id: 1 }, { guild_id: G2, streamer_id: 2 }];
    await tick('09:05');
    assert.equal(world.sends.length, 2);
    assert.equal(world.twitchCalls.filter((c) => c[0] === 'videos').length, 1);
  });
});

describe('a post that did not go out is not recorded, and is tried again', () => {
  test('a refused channel (sendNotification returns false) is not recorded as posted; the next tick tries again and records the success', async () => {
    world.sendOutcome = (_guild, n) => n > 1;
    await tick('09:05');
    assert.deepEqual(world.recorded, [], 'a normal return from a refused post is not a post');
    assert.match(logs.join('\n'), /Attempt 1 of 3 failed for guild 400000000000000051: the channel is not one the bot can reach/);

    await tick('09:25');
    assert.equal(world.sends.length, 2);
    assert.deepEqual(world.recorded, [[G1, monday]]);
    assert.match(logs.join('\n'), /Posted digest for guild 400000000000000051 \(attempt 2 of 3\)/);

    await tick('09:45');
    assert.equal(world.sends.length, 2, 'once posted, no more tries');
  });

  test('Discord rejecting the post is a failed attempt too', async () => {
    world.sendOutcome = (_guild, n) => (n === 1 ? new Error('Invalid Form Body') : true);
    await tick('09:05');
    assert.deepEqual(world.recorded, []);
    assert.match(logs.join('\n'), /Attempt 1 of 3 failed .*Invalid Form Body/);
    await tick('09:25');
    assert.deepEqual(world.recorded, [[G1, monday]]);
  });

  test('three tries and no more, 20 minutes apart; then it gives up until next week', async () => {
    world.sendOutcome = () => false;
    for (const minute of ['05', '25', '45']) await tick(`09:${minute}`);
    assert.equal(MAX_ATTEMPTS, 3);
    assert.equal(world.sends.length, 3);
    assert.match(logs.join('\n'), /Attempt 3 of 3 failed .* - giving up until next week/);

    await tick('09:59'); // still in the hour, but the tries are used up
    assert.equal(world.sends.length, 3);
    assert.deepEqual(world.recorded, []);
  });

  test('a tick soon after a failed attempt waits: tries are at least 15 minutes apart', async () => {
    assert.equal(RETRY_GAP_MS, 15 * MINUTE);
    world.sendOutcome = () => false;
    await tick('09:00');
    await tick('09:10'); // 10 minutes later: too soon
    assert.equal(world.sends.length, 1);
    await tick('09:15'); // exactly 15 minutes: allowed
    assert.equal(world.sends.length, 2);
  });

  test('the tries are counted per server: one that failed does not hold back, or repeat, another', async () => {
    world.guilds = [{ guild_id: G1, streamer_id: 1 }, { guild_id: G2, streamer_id: 2 }];
    world.sendOutcome = (guildId, n) => !(guildId === G1 && n <= 2); // G1 fails on its first try only
    await tick('09:05');
    assert.deepEqual(world.recorded, [[G2, monday]]);

    await tick('09:25');
    assert.deepEqual(world.sends.map((s) => s.meta.guildId), [G1, G2, G1], 'only G1 was tried again');
    assert.deepEqual(world.recorded, [[G2, monday], [G1, monday]]);
  });

  test('a new week starts with fresh tries', async () => {
    world.sendOutcome = () => false;
    for (const minute of ['05', '25', '45']) await tick(`09:${minute}`);
    assert.equal(world.sends.length, 3);

    world.sendOutcome = () => true;
    const nextMonday = dayAfter(monday, 7);
    await tick('09:05', nextMonday);
    assert.equal(world.sends.length, 4);
    assert.deepEqual(world.recorded, [[G1, nextMonday]]);
  });
});

describe('Twitch not answering', () => {
  test('is a failed attempt: nothing is posted or recorded, the week is read again on the next try', async () => {
    world.twitchDown = true;
    await tick('09:05');
    assert.deepEqual(world.sends, [], 'not a digest built from half a week');
    assert.deepEqual(world.recorded, []);
    assert.match(logs.join('\n'), /Attempt 1 of 3 failed .*Twitch API error: 500/);

    world.twitchDown = false;
    await tick('09:25');
    assert.equal(world.sends.length, 1);
    assert.deepEqual(world.recorded, [[G1, monday]]);
  });
});

describe('summarizeWeek and parseTwitchDuration', () => {
  test('durations: hours, minutes and seconds in any combination', () => {
    assert.equal(parseTwitchDuration('1h2m3s'), 3723);
    assert.equal(parseTwitchDuration('45m12s'), 2712);
    assert.equal(parseTwitchDuration('30s'), 30);
    assert.equal(parseTwitchDuration('2h'), 7200);
    assert.equal(parseTwitchDuration(''), 0);
    assert.equal(parseTwitchDuration(undefined), 0);
  });

  test('sums streams and hours over the channels, lists each game once, and picks the most viewed clip of all', () => {
    const summary = summarizeWeek([
      { videos: [{ duration: '1h' }, { duration: '30m' }], clips: [{ title: 'a', url: 'ua', view_count: 10 }], categories: ['iRacing', 'Just Chatting'] },
      { videos: [{ duration: '30m' }], clips: [{ title: 'b', url: 'ub', view_count: 99 }, { title: 'c', url: 'uc', view_count: 3 }], categories: ['iRacing'] },
    ]);
    assert.deepEqual(summary, { streamCount: 3, totalHours: 2, categories: ['iRacing', 'Just Chatting'], topClip: { title: 'b', url: 'ub', view_count: 99 } });
  });

  test('a week with no clips has no categories and no top clip', () => {
    const summary = summarizeWeek([{ videos: [{ duration: '1h' }], clips: [], categories: [] }]);
    assert.deepEqual(summary, { streamCount: 1, totalHours: 1, categories: [], topClip: null });
  });

  test('nothing watched gives an empty week', () => {
    assert.deepEqual(summarizeWeek([]), { streamCount: 0, totalHours: 0, categories: [], topClip: null });
  });
});
