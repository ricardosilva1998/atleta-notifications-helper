'use strict';

// The Twitch side of the poller manager (N12, M21, L6): the real manager, the
// real live poller and the real src/db.js on in-memory SQLite; Twitch and Discord
// are stubs that record what they were asked, so nothing leaves the machine.
// All ids, names and numbers are synthetic.

const { test, describe, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const RealDatabase = require('better-sqlite3');
const realFs = require('fs');

const SRC = path.join(__dirname, '..');
const DB_FILE = path.join(SRC, 'db.js');
const MANAGER_FILE = path.join(__dirname, 'manager.js');
const LIVE_FILE = path.join(__dirname, 'twitchLive.js');

const HOUR = 3600 * 1000;
const G1 = '400000000000000041';
const G2 = '400000000000000042';

// ── What the stubs record and answer ────────────────────────────────────────

const calls = { getStreams: [], getFollowerCount: [], getSubscriberCount: [], getSubscribers: [] };
const sent = []; // sendNotification: { channelId, type, guildId, streamerId, embed, liveAtSend }
let liveStreams; // login -> the stream Twitch would return
let failBatch; // (index of the request) => true makes that request fail
let holdBatches; // when set, getStreams waits for this promise
let counts; // { followers, subscribers } Twitch would report

const configStub = {
  tiers: { free: { recaps: true, milestones: true } },
  intervals: { twitchLive: 60_000, twitchClips: 300_000, youtubeFeed: 300_000, youtubeLive: 120_000, subSync: 600_000, weeklyDigest: 1_200_000 },
  youtube: { apiKey: '' },
};

const twitchStub = {
  STREAMS_PER_REQUEST: 100,
  getStreams: async (logins) => {
    calls.getStreams.push(logins.slice());
    if (holdBatches) await holdBatches;
    if (failBatch && failBatch(calls.getStreams.length - 1)) throw new Error('Twitch API error: 500');
    const streams = new Map();
    for (const login of logins) if (liveStreams[login]) streams.set(login, liveStreams[login]);
    return streams;
  },
  getFollowerCount: async (...args) => { calls.getFollowerCount.push(args); return counts.followers; },
  getSubscriberCount: async (...args) => { calls.getSubscriberCount.push(args); return counts.subscribers; },
  getSubscribers: async () => { calls.getSubscribers.push(true); throw new Error('the whole subscriber list must not be read for a count'); },
  getClips: async () => [{ title: 'best clip', view_count: 50, url: 'https://clips.test/best' }],
  getVideos: async () => [{ url: 'https://twitch.test/videos/9', thumbnail_url: '' }],
};

// The channel a post is about, read from its embed, so the test can check the
// stored state at the moment the post went out.
function loginOf(embed) {
  const built = embed && (embed.built || embed.recap);
  const name = built && (built.twitchUsername || built.url);
  return name ? String(name).replace('https://twitch.tv/', '') : null;
}

const discordStub = {
  sendNotification: async (channelId, embed, meta) => {
    const login = loginOf(embed);
    sent.push({ channelId, type: meta.type, guildId: meta.guildId, streamerId: meta.streamerId, embed, liveAtSend: login ? db.getChannelState(login).is_live : undefined });
    return true;
  },
  buildEmbed: (fields) => ({ built: fields }),
  buildRecapEmbed: (data) => ({ recap: data }),
  buildMilestoneEmbed: (data) => ({ milestone: data }),
  buildInstagramEmbed: () => ({}),
  buildTikTokEmbed: () => ({}),
  buildTwitterEmbed: () => ({}),
  buildIracingResultEmbed: () => ({}),
};

const noopPollers = ['./twitchClips', './youtubeFeed', './youtubeLive', './subSync', './weeklyDigest', './instagramFeed', './tiktokFeed', './twitterFeed', './iracingResults'];

let db;
let manager;
const saved = {};
const logs = [];

before(() => {
  saved.load = Module._load;
  Module._load = function (request, parent, isMain) {
    const from = parent && parent.filename;
    if (from === DB_FILE) {
      if (request === 'better-sqlite3') return function MemoryDatabase(_file, opts) { return new RealDatabase(':memory:', opts); };
      if (request === 'fs') return { ...realFs, existsSync: () => true, mkdirSync: () => {} };
      if (request === './config') return { adminDiscordIds: [] }; // src/config.js exits without the real env vars
    }
    if (from === MANAGER_FILE) {
      if (request === '../config') return configStub;
      if (request === '../discord') return discordStub;
      if (request === '../services/twitch') return twitchStub;
      if (request === '../services/iracing') return { isConfigured: () => false };
      if (noopPollers.includes(request)) return {};
    }
    if (from === LIVE_FILE) {
      if (request === '../services/twitch') return twitchStub;
      if (request === '../discord') return discordStub;
    }
    return saved.load.call(this, request, parent, isMain);
  };
  for (const file of [DB_FILE, MANAGER_FILE, LIVE_FILE]) delete require.cache[file];
  const { log, error } = console;
  console.log = () => {}; // a fresh database prints one line per migration
  console.error = () => {};
  try {
    db = require(DB_FILE);
    manager = require(MANAGER_FILE);
  } finally {
    console.log = log;
    console.error = error;
  }
});

after(() => {
  Module._load = saved.load;
});

let streamerA;
let streamerB;
let disabled;
let counter = 0;

function addStreamer(over = {}) {
  const n = ++counter;
  const cols = { discord_user_id: `70000000000000${String(n).padStart(4, '0')}`, discord_username: `user${n}`, ...over };
  const names = Object.keys(cols);
  return Number(db.db.prepare(`INSERT INTO streamers (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((k) => cols[k])).lastInsertRowid);
}

function claim(guildId, streamerId) {
  db.upsertGuild(guildId, streamerId, 'Pit Lane');
  db.db.prepare('UPDATE guilds SET recap_enabled = 1, milestones_enabled = 1 WHERE guild_id = ? AND streamer_id = ?').run(guildId, streamerId);
}

function watch(guildId, streamerId, login) {
  db.addWatchedChannel(guildId, streamerId, login, `5${guildId.slice(-4)}${streamerId}`, null, true, false);
}

const stream = (login, over = {}) => ({
  id: '4000000001',
  user_login: login,
  user_name: login,
  title: 'Race night',
  game_name: 'iRacing',
  thumbnail_url: 'https://img.test/{width}x{height}.jpg',
  started_at: new Date(Date.now() - 2 * HOUR).toISOString(),
  viewer_count: 10,
  ...over,
});

beforeEach(() => {
  db.db.exec('DELETE FROM channel_state; DELETE FROM channel_milestones; DELETE FROM watched_channels; DELETE FROM guilds; DELETE FROM streamers;');
  for (const list of Object.values(calls)) list.length = 0;
  sent.length = 0;
  logs.length = 0;
  liveStreams = {};
  failBatch = null;
  holdBatches = null;
  counts = { followers: 1500, subscribers: 60 };
  for (const level of ['log', 'warn', 'error']) { saved[level] = console[level]; console[level] = (...args) => logs.push(`${level}: ${args.join(' ')}`); }

  streamerA = addStreamer({ twitch_username: 'streamer_a', broadcaster_access_token: 'token-a' });
  streamerB = addStreamer({ twitch_username: 'streamer_b', broadcaster_access_token: 'token-b' });
  disabled = addStreamer({ twitch_username: 'streamer_off', broadcaster_access_token: 'token-off' });
  db.db.prepare('UPDATE streamers SET enabled = 0 WHERE id = ?').run(disabled);
  claim(G1, streamerA);
  claim(G2, streamerA);
  claim(G1, streamerB);
  claim(G1, disabled);
});

afterEach(() => {
  mock.timers.reset();
  for (const level of ['log', 'warn', 'error']) console[level] = saved[level];
});

const pollTwitchLive = () => manager.pollAllTwitchLive();
const typesSent = () => sent.map((s) => s.type);
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve)); };

// ── Batching (N12) ──────────────────────────────────────────────────────────

describe('pollAllTwitchLive: one request for a batch of channels', () => {
  const login = (i) => `chan_${String(i).padStart(3, '0')}`;

  test('250 channels, some watched in several servers and by several streamers, are asked about once each: 100 + 100 + 50', async () => {
    for (let i = 0; i < 250; i++) watch(G1, streamerA, login(i));
    for (let i = 0; i < 30; i++) watch(G2, streamerA, login(i)); // the same channels in another server
    for (let i = 0; i < 10; i++) watch(G1, streamerB, login(i)); // and by another streamer

    await pollTwitchLive();

    assert.deepEqual(calls.getStreams.map((batch) => batch.length), [100, 100, 50]);
    const asked = calls.getStreams.flat();
    assert.equal(asked.length, 250);
    assert.equal(new Set(asked).size, 250, 'no channel twice');
    assert.deepEqual([...asked].sort(), Array.from({ length: 250 }, (_, i) => login(i)));
  });

  test('a channel only a disabled account watches is not asked about', async () => {
    watch(G1, streamerA, 'active_channel');
    watch(G1, disabled, 'disabled_only_channel');
    watch(G1, disabled, 'both_watch');
    watch(G1, streamerB, 'both_watch');

    await pollTwitchLive();

    assert.deepEqual(calls.getStreams.flat().sort(), ['active_channel', 'both_watch']);
  });

  test('with nothing to watch Twitch is not asked at all', async () => {
    await pollTwitchLive();
    assert.equal(calls.getStreams.length, 0);
  });

  test('a request that fails leaves its channels as they were, and the other batches go on', async () => {
    for (let i = 0; i < 150; i++) watch(G1, streamerA, login(i));
    // A channel in each batch is live in the database; Twitch lists no streams at all.
    for (const name of [login(0), login(120)]) {
      db.getChannelState(name);
      db.updateChannelState(name, { is_live: 1, last_stream_id: '4000000001', stream_started_at: new Date(Date.now() - 2 * HOUR).toISOString() });
    }
    failBatch = (index) => index === 0;

    await pollTwitchLive();

    assert.equal(calls.getStreams.length, 2, 'the second batch was still asked');
    const unreached = db.getChannelState(login(0));
    assert.equal(unreached.is_live, 1, 'a failed request is not "offline"');
    assert.equal(unreached.offline_polls, 0);
    assert.equal(db.getChannelState(login(120)).offline_polls, 1, 'the other batch was processed: a first miss');
    assert.ok(logs.some((l) => /Could not check 100 channel\(s\): Twitch API error: 500/.test(l)), logs.join('\n'));
    assert.deepEqual(typesSent(), [], 'no recap for a stream nobody saw end');
  });
});

// ── Going live, and the offline debounce (M21) ──────────────────────────────

describe('pollAllTwitchLive: going live and going offline', () => {
  test('a channel that goes live is announced to every watcher once, after its state is stored', async () => {
    watch(G1, streamerA, 'some_channel');
    watch(G2, streamerA, 'some_channel');
    liveStreams.some_channel = stream('some_channel');

    await pollTwitchLive();

    assert.deepEqual(calls.getStreams, [['some_channel']], 'one request, though two servers watch it');
    assert.deepEqual(sent.map((s) => [s.type, s.guildId]).sort(), [['twitch_live', G1], ['twitch_live', G2]]);
    assert.ok(sent.every((s) => s.liveAtSend === 1), 'the stored state already said live when the post went out');
    const state = db.getChannelState('some_channel');
    assert.equal(state.is_live, 1);
    assert.equal(state.last_stream_id, '4000000001');

    sent.length = 0;
    await pollTwitchLive(); // still live
    assert.deepEqual(sent, [], 'not announced again');
  });

  test('one empty answer is a blip: no recap, no offline, and no second announcement when the stream is back', async () => {
    watch(G1, streamerA, 'some_channel');
    liveStreams.some_channel = stream('some_channel');
    await pollTwitchLive();
    sent.length = 0;

    delete liveStreams.some_channel;
    await pollTwitchLive();
    assert.deepEqual(sent, [], 'no recap after one miss');
    assert.equal(db.getChannelState('some_channel').is_live, 1);
    assert.equal(db.getChannelState('some_channel').offline_polls, 1);

    liveStreams.some_channel = stream('some_channel', { viewer_count: 25 });
    await pollTwitchLive();
    assert.deepEqual(sent, [], 'the same stream is back: nothing to say');
    const state = db.getChannelState('some_channel');
    assert.equal(state.offline_polls, 0, 'the count starts over');
    assert.equal(state.peak_viewers, 25);
  });

  test('two empty answers in a row end the stream: the recap goes out, the session is cleared, the broadcast id is kept', async () => {
    watch(G1, streamerA, 'some_channel');
    db.getChannelState('some_channel');
    db.updateChannelState('some_channel', { twitch_broadcaster_id: '777' }); // the recap looks up the VOD and clips by it
    liveStreams.some_channel = stream('some_channel');
    await pollTwitchLive();
    sent.length = 0;

    delete liveStreams.some_channel;
    await pollTwitchLive();
    await pollTwitchLive();

    assert.deepEqual(typesSent(), ['twitch_recap', 'twitch_recap'], 'the VOD link, then the stats');
    const state = db.getChannelState('some_channel');
    assert.equal(state.is_live, 0);
    assert.equal(state.stream_started_at, null);
    assert.equal(state.offline_polls, 0);
    assert.equal(state.last_stream_id, '4000000001');
    assert.ok(logs.some((l) => /some_channel went OFFLINE/.test(l)));

    sent.length = 0;
    await pollTwitchLive(); // still offline
    assert.deepEqual(sent, []);
  });

  test('the same broadcast reappearing after it was marked offline is live again but not announced twice', async () => {
    watch(G1, streamerA, 'some_channel');
    liveStreams.some_channel = stream('some_channel');
    await pollTwitchLive();
    delete liveStreams.some_channel;
    await pollTwitchLive();
    await pollTwitchLive(); // marked offline
    sent.length = 0;

    liveStreams.some_channel = stream('some_channel');
    await pollTwitchLive();

    assert.deepEqual(sent, [], 'no second "is live" post');
    const state = db.getChannelState('some_channel');
    assert.equal(state.is_live, 1);
    assert.equal(state.stream_started_at, liveStreams.some_channel.started_at, 'the recap will count the whole broadcast');
  });

  test('a new broadcast after a real end is announced', async () => {
    watch(G1, streamerA, 'some_channel');
    liveStreams.some_channel = stream('some_channel');
    await pollTwitchLive();
    delete liveStreams.some_channel;
    await pollTwitchLive();
    await pollTwitchLive();
    sent.length = 0;

    liveStreams.some_channel = stream('some_channel', { id: '4000000002', title: 'Next day' });
    await pollTwitchLive();

    assert.deepEqual(typesSent(), ['twitch_live']);
    assert.equal(db.getChannelState('some_channel').last_stream_id, '4000000002');
  });

  test('a different broadcast while the old one was thought live: the old gets its recap first, then the new one is announced with a fresh session', async () => {
    watch(G1, streamerA, 'some_channel');
    liveStreams.some_channel = stream('some_channel', { viewer_count: 80 });
    await pollTwitchLive();
    sent.length = 0;

    // The stream ended and a new one began between two polls: one miss, then the new broadcast.
    delete liveStreams.some_channel;
    await pollTwitchLive();
    liveStreams.some_channel = stream('some_channel', { id: '4000000002', title: 'Second stream', viewer_count: 5, started_at: new Date(Date.now() - 30_000).toISOString() });
    await pollTwitchLive();

    assert.deepEqual(typesSent(), ['twitch_recap', 'twitch_live'], 'the recap of the one that ended comes before the announcement of the next');
    const recap = sent[0].embed.recap;
    assert.equal(recap.title, 'Race night');
    assert.equal(recap.peakViewers, 80);
    assert.equal(recap.vodUrl, null);
    const state = db.getChannelState('some_channel');
    assert.equal(state.last_stream_id, '4000000002');
    assert.equal(state.stream_title, 'Second stream');
    assert.equal(state.peak_viewers, 5, 'the new session does not inherit the old peak');
    assert.equal(state.offline_polls, 0);
    assert.equal(state.is_live, 1);
  });

  test('a channel that was live before this version (no stored broadcast id) keeps going and learns the id', async () => {
    watch(G1, streamerA, 'some_channel');
    db.getChannelState('some_channel');
    db.updateChannelState('some_channel', { is_live: 1, stream_title: 'Old row', stream_started_at: new Date(Date.now() - HOUR).toISOString() });
    liveStreams.some_channel = stream('some_channel');

    await pollTwitchLive();

    assert.deepEqual(sent, []);
    assert.equal(db.getChannelState('some_channel').last_stream_id, '4000000001');
  });

  test('one broken channel does not stop the others in the batch', async () => {
    watch(G1, streamerA, 'broken_channel');
    watch(G1, streamerA, 'fine_channel');
    liveStreams.broken_channel = { ...stream('broken_channel'), thumbnail_url: undefined }; // formatThumbnail throws
    liveStreams.fine_channel = stream('fine_channel');

    await pollTwitchLive();

    assert.ok(logs.some((l) => /Error for broken_channel/.test(l)));
    assert.deepEqual(typesSent(), ['twitch_live']);
    assert.equal(db.getChannelState('fine_channel').is_live, 1);
  });
});

// ── Milestones (L6) ─────────────────────────────────────────────────────────

describe('pollAllTwitchLive: milestones', () => {
  function enableMilestones() {
    watch(G1, streamerA, 'some_channel');
    db.getChannelState('some_channel');
    db.updateChannelState('some_channel', { twitch_broadcaster_id: '777' });
  }
  const milestonePosts = () => sent.filter((s) => s.type === 'twitch_milestone').map((s) => s.embed.milestone);

  test('the first look records the counts and announces nothing; a later milestone is announced once', async () => {
    enableMilestones();
    liveStreams.some_channel = stream('some_channel');
    await pollTwitchLive();

    assert.deepEqual(milestonePosts(), [], 'no false "just hit"');
    let row = db.getChannelMilestones('some_channel');
    assert.equal(row.last_follower_count, 1500);
    assert.equal(row.last_follower_milestone, 1500);
    assert.equal(row.last_subscriber_count, 60);
    assert.equal(row.last_subscriber_milestone, 50);

    // The stream ends; next time it is live the channel has grown past a follower milestone.
    delete liveStreams.some_channel;
    await pollTwitchLive();
    await pollTwitchLive();
    counts = { followers: 2010, subscribers: 63 };
    liveStreams.some_channel = stream('some_channel', { id: '4000000002' });
    await pollTwitchLive();

    assert.deepEqual(milestonePosts().map((m) => [m.milestoneType, m.count]), [['follower', 2000]]);
    row = db.getChannelMilestones('some_channel');
    assert.equal(row.last_follower_milestone, 2000);
    assert.equal(row.last_subscriber_count, 63);
  });

  test('subscribers are counted with one small request, never by reading the whole list', async () => {
    enableMilestones();
    liveStreams.some_channel = stream('some_channel');
    await pollTwitchLive();

    assert.equal(calls.getSubscribers.length, 0);
    assert.deepEqual(calls.getSubscriberCount, [['777', 'token-a']]);
    assert.deepEqual(calls.getFollowerCount, [['777', 'token-a']]);
  });

  test('a milestone is not looked at when the broadcast only resumes after a hiccup', async () => {
    enableMilestones();
    liveStreams.some_channel = stream('some_channel');
    await pollTwitchLive();
    delete liveStreams.some_channel;
    await pollTwitchLive();
    await pollTwitchLive();
    counts = { followers: 3000, subscribers: 200 };
    calls.getFollowerCount.length = 0;

    liveStreams.some_channel = stream('some_channel'); // the same broadcast
    await pollTwitchLive();

    assert.equal(calls.getFollowerCount.length, 0, 'milestones are looked at when a broadcast starts, not when it resumes');
    assert.deepEqual(milestonePosts(), []);
  });
});

// ── The guard on the timers ─────────────────────────────────────────────────

describe('startAll: a slow run is not started over', () => {
  test('ticks that fire while the live poller is still waiting on Twitch are skipped', async () => {
    watch(G1, streamerA, 'some_channel');
    let release;
    holdBatches = new Promise((resolve) => { release = resolve; });
    mock.timers.enable({ apis: ['setInterval'] });

    manager.startAll(); // the first poll runs at once and waits on Twitch
    await settle();
    assert.equal(calls.getStreams.length, 1);

    mock.timers.tick(configStub.intervals.twitchLive * 3); // three ticks while it waits
    await settle();
    assert.equal(calls.getStreams.length, 1, 'no second run started');
    assert.ok(logs.some((l) => /\[TwitchLive\] The previous run is still going/.test(l)), logs.join('\n'));

    holdBatches = null;
    release();
    await settle();
    mock.timers.tick(configStub.intervals.twitchLive);
    await settle();
    assert.equal(calls.getStreams.length, 2, 'the next tick after the run ended starts a new run');
  });
});
