'use strict';

// The poller manager (N12, M21, M22, L6, M18): the real manager, the real live
// and feed pollers and the real src/db.js on in-memory SQLite; Twitch, YouTube
// and Discord are stubs that record what they were asked, so nothing leaves the
// machine. All ids, names and numbers are synthetic.

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
const YOUTUBE_LIVE_FILE = path.join(__dirname, 'youtubeLive.js');
const YOUTUBE_FEED_FILE = path.join(__dirname, 'youtubeFeed.js');

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

// YouTube: what the stubbed service answers and was asked, and the chat manager's calls.
const yt = { feeds: {}, feedFails: new Set(), liveCalls: [], rssCalls: [], detailCalls: [], live: new Map(), failed: new Set(), quotaError: false, backoff: false, details: {}, chat: [], polling: new Map() };
const youtubeStub = {
  quotaBackoffActive: () => yt.backoff,
  getLatestVideos: async (channelId) => {
    yt.rssCalls.push(channelId);
    if (yt.feedFails.has(channelId)) throw new Error('YouTube RSS fetch failed: 500');
    return yt.feeds[channelId] || [];
  },
  getLiveVideos: async (ids) => {
    yt.liveCalls.push(ids.slice());
    if (yt.quotaError) throw Object.assign(new Error('YouTube API quota exceeded'), { code: 'QUOTA_EXCEEDED' });
    return { live: yt.live, failed: yt.failed };
  },
  getVideoDetails: async (ids) => { yt.detailCalls.push(ids.slice()); return yt.details; },
};
const chatManagerStub = {
  youtubeChatManager: {
    isPolling: (streamerId) => yt.polling.has(streamerId),
    getLiveChatId: (streamerId) => yt.polling.get(streamerId) || null,
    startPolling: (streamerId, liveChatId) => { yt.chat.push(['start', streamerId, liveChatId]); yt.polling.set(streamerId, liveChatId); },
    stopPolling: (streamerId) => { yt.chat.push(['stop', streamerId]); yt.polling.delete(streamerId); },
  },
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
  escapeLinkText: (text) => String(text), // the real feed and live pollers use it on the channel's own text
  buildRecapEmbed: (data) => ({ recap: data }),
  buildMilestoneEmbed: (data) => ({ milestone: data }),
  buildInstagramEmbed: () => ({}),
  buildTikTokEmbed: () => ({}),
  buildTwitterEmbed: () => ({}),
  buildIracingResultEmbed: () => ({}),
};

const noopPollers = ['./twitchClips', './subSync', './weeklyDigest', './instagramFeed', './tiktokFeed', './twitterFeed', './iracingResults'];

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
      if (request === '../services/youtube') return youtubeStub;
      if (request === '../services/youtubeLiveChat') return chatManagerStub;
      if (noopPollers.includes(request)) return {};
    }
    if (from === LIVE_FILE) {
      if (request === '../services/twitch') return twitchStub;
      if (request === '../discord') return discordStub;
    }
    if (from === YOUTUBE_LIVE_FILE || from === YOUTUBE_FEED_FILE) {
      if (request === '../services/youtube') return youtubeStub;
      if (request === '../discord') return discordStub;
    }
    return saved.load.call(this, request, parent, isMain);
  };
  for (const file of [DB_FILE, MANAGER_FILE, LIVE_FILE, YOUTUBE_LIVE_FILE, YOUTUBE_FEED_FILE]) delete require.cache[file];
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
  for (const table of ['channel_state', 'channel_milestones', 'youtube_channel_state', 'watched_channels', 'watched_youtube_channels', 'guilds', 'streamers']) {
    db.db.prepare(`DELETE FROM ${table}`).run();
  }
  for (const list of Object.values(calls)) list.length = 0;
  sent.length = 0;
  logs.length = 0;
  liveStreams = {};
  failBatch = null;
  holdBatches = null;
  counts = { followers: 1500, subscribers: 60 };
  Object.assign(yt, { feeds: {}, feedFails: new Set(), liveCalls: [], rssCalls: [], detailCalls: [], live: new Map(), failed: new Set(), quotaError: false, backoff: false, details: {}, chat: [], polling: new Map() });
  configStub.youtube.apiKey = '';
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

// ── YouTube: live detection in batches, the chat after a restart, the quota (M22, M18) ──

describe('pollAllYouTubeLive', () => {
  const GUILD_LIVE_CHANNEL = 'LIVE-CHANNEL';
  const feedOf = (...ids) => ids.map((id) => ({ id, title: `Video ${id}`, url: `https://www.youtube.com/watch?v=${id}`, author: 'Some Channel' }));
  const onAir = (id, liveChatId = `chat-${id}`) => ({ id, title: `Stream ${id}`, description: 'Race night', thumbnail: `https://img.test/${id}.jpg`, liveChatId });

  // streamer owns YouTube channel `channelId`; `watcher` watches it for live posts.
  function watchYoutube(channelId, streamerId = streamerA, guildId = G1) {
    db.addWatchedYoutubeChannel(guildId, streamerId, channelId, 'Some Channel', 'VIDEOS-CH', GUILD_LIVE_CHANNEL, null);
  }
  function ownerWithChat(channelId, chatbot = 1) {
    db.db.prepare('UPDATE streamers SET youtube_channel_id = ?, yt_chatbot_enabled = ? WHERE id = ?').run(channelId, chatbot, streamerA);
  }
  const youtubePosts = () => sent.filter((s) => s.type === 'youtube_live');

  beforeEach(() => {
    configStub.youtube.apiKey = 'api-key';
  });

  test('without an API key, as in production today, nothing is asked and nothing is logged', async () => {
    configStub.youtube.apiKey = '';
    watchYoutube('UCa');
    await manager.pollAllYouTubeLive();
    assert.deepEqual(yt.rssCalls, []);
    assert.deepEqual(yt.liveCalls, []);
    assert.deepEqual(logs, []);
  });

  test('the videos of all the channels are checked together: one lookup, not one per channel', async () => {
    for (let i = 0; i < 14; i++) {
      watchYoutube(`UCchan${i}`);
      yt.feeds[`UCchan${i}`] = feedOf(...Array.from({ length: 8 }, (_, n) => `v${i}-${n}`));
    }
    await manager.pollAllYouTubeLive();

    assert.equal(yt.rssCalls.length, 14, 'each channel\'s feed is read once');
    assert.equal(yt.liveCalls.length, 1, 'but all their videos go to YouTube together');
    assert.equal(yt.liveCalls[0].length, 14 * 5, 'the latest five videos of each');
    assert.equal(new Set(yt.liveCalls[0]).size, 70);
  });

  test('a channel that goes live is announced and its owner\'s chat is started', async () => {
    ownerWithChat('UCa');
    watchYoutube('UCa');
    yt.feeds.UCa = feedOf('v1', 'v2');
    yt.live = new Map([['v1', onAir('v1')]]);

    await manager.pollAllYouTubeLive();

    assert.deepEqual(youtubePosts().map((p) => p.channelId), [GUILD_LIVE_CHANNEL]);
    assert.equal(db.getYoutubeChannelState('UCa').is_live, 1);
    assert.equal(db.getYoutubeChannelState('UCa').live_video_id, 'v1');
    assert.deepEqual(yt.chat, [['start', streamerA, 'chat-v1']]);
  });

  test('after a restart in the middle of a stream the chat starts again, with no new announcement', async () => {
    ownerWithChat('UCa');
    watchYoutube('UCa');
    db.getYoutubeChannelState('UCa');
    db.updateYoutubeChannelState('UCa', { is_live: 1, live_video_id: 'v1' }); // what the database says after the restart
    yt.feeds.UCa = feedOf('v1');
    yt.live = new Map([['v1', onAir('v1')]]);

    await manager.pollAllYouTubeLive();

    assert.deepEqual(youtubePosts(), [], 'the stream was announced before the restart');
    assert.deepEqual(yt.chat, [['start', streamerA, 'chat-v1']], 'but its chat is polled again');

    await manager.pollAllYouTubeLive(); // the next poll finds the chat already running
    assert.deepEqual(yt.chat, [['start', streamerA, 'chat-v1']], 'and leaves it alone');
  });

  test('a new stream with another chat replaces the old chat polling', async () => {
    ownerWithChat('UCa');
    watchYoutube('UCa');
    db.getYoutubeChannelState('UCa');
    db.updateYoutubeChannelState('UCa', { is_live: 1, live_video_id: 'v1' });
    yt.polling.set(streamerA, 'chat-v1');
    yt.feeds.UCa = feedOf('v2', 'v1');
    yt.live = new Map([['v2', onAir('v2')]]);

    await manager.pollAllYouTubeLive();

    assert.deepEqual(yt.chat, [['start', streamerA, 'chat-v2']]);
  });

  test('the chat is only started for the channel\'s owner, and only when the chatbot is on', async () => {
    watchYoutube('UCa'); // streamerA watches UCa but does not own it
    watchYoutube('UCa', streamerB);
    yt.feeds.UCa = feedOf('v1');
    yt.live = new Map([['v1', onAir('v1')]]);
    await manager.pollAllYouTubeLive();
    assert.deepEqual(yt.chat, [], 'nobody owns the channel');

    db.db.prepare('UPDATE streamers SET youtube_channel_id = ?, yt_chatbot_enabled = 0 WHERE id = ?').run('UCa', streamerA);
    await manager.pollAllYouTubeLive();
    assert.deepEqual(yt.chat, [], 'the owner has the chatbot off');
  });

  test('a broadcast with no chat to read does not start one', async () => {
    ownerWithChat('UCa');
    watchYoutube('UCa');
    yt.feeds.UCa = feedOf('v1');
    yt.live = new Map([['v1', onAir('v1', null)]]);
    await manager.pollAllYouTubeLive();
    assert.deepEqual(yt.chat, []);
  });

  test('when the stream ends the channel is marked offline and the chat is stopped', async () => {
    ownerWithChat('UCa');
    watchYoutube('UCa');
    db.getYoutubeChannelState('UCa');
    db.updateYoutubeChannelState('UCa', { is_live: 1, live_video_id: 'v1' });
    yt.polling.set(streamerA, 'chat-v1');
    yt.feeds.UCa = feedOf('v1');

    await manager.pollAllYouTubeLive();

    assert.equal(db.getYoutubeChannelState('UCa').is_live, 0);
    assert.deepEqual(yt.chat, [['stop', streamerA]]);
    assert.deepEqual(youtubePosts(), []);
  });

  test('a lookup that failed for a channel\'s videos leaves the channel exactly as it was', async () => {
    ownerWithChat('UCa');
    watchYoutube('UCa');
    db.getYoutubeChannelState('UCa');
    db.updateYoutubeChannelState('UCa', { is_live: 1, live_video_id: 'v1' });
    yt.polling.set(streamerA, 'chat-v1');
    yt.feeds.UCa = feedOf('v1');
    yt.failed = new Set(['v1']);

    await manager.pollAllYouTubeLive();

    assert.equal(db.getYoutubeChannelState('UCa').is_live, 1, 'unknown is not offline');
    assert.deepEqual(yt.chat, [], 'and the chat keeps running');
  });

  test('a channel whose feed cannot be read is skipped; the others are still checked', async () => {
    watchYoutube('UCbroken');
    watchYoutube('UCfine');
    yt.feedFails.add('UCbroken');
    yt.feeds.UCfine = feedOf('v1');
    yt.live = new Map([['v1', onAir('v1')]]);

    await manager.pollAllYouTubeLive();

    assert.ok(logs.some((l) => /Error for UCbroken: YouTube RSS fetch failed: 500/.test(l)));
    assert.equal(db.getYoutubeChannelState('UCfine').is_live, 1);
    assert.deepEqual(yt.liveCalls.map((ids) => ids), [['v1']]);
  });

  test('an exhausted quota ends the run quietly and changes nothing', async () => {
    ownerWithChat('UCa');
    watchYoutube('UCa');
    db.getYoutubeChannelState('UCa');
    db.updateYoutubeChannelState('UCa', { is_live: 1, live_video_id: 'v1' });
    yt.feeds.UCa = feedOf('v1');
    yt.quotaError = true;

    await manager.pollAllYouTubeLive();

    assert.equal(db.getYoutubeChannelState('UCa').is_live, 1);
    assert.deepEqual(yt.chat, []);
    assert.deepEqual(logs, [], 'the service logged the pause; the poller adds nothing');
  });

  test('while YouTube is paused for the quota nothing is asked, by the live poller or the feed poller', async () => {
    watchYoutube('UCa');
    yt.feeds.UCa = feedOf('v1');
    yt.backoff = true;
    await manager.pollAllYouTubeLive();
    await manager.pollAllYouTubeFeed();
    assert.deepEqual(yt.rssCalls, []);
    assert.deepEqual(yt.liveCalls, []);
    assert.deepEqual(yt.detailCalls, []);
  });

  test('a channel with no live notifications set up, or only disabled watchers, is not looked at', async () => {
    db.addWatchedYoutubeChannel(G1, streamerA, 'UCnolive', 'No live', 'VIDEOS-CH', null, null);
    db.addWatchedYoutubeChannel(G1, disabled, 'UCdisabled', 'Disabled', 'VIDEOS-CH', GUILD_LIVE_CHANNEL, null);
    await manager.pollAllYouTubeLive();
    assert.deepEqual(yt.rssCalls, []);
    assert.deepEqual(yt.liveCalls, []);
  });
});

describe('pollAllYouTubeFeed', () => {
  const feedOf = (...ids) => ids.map((id) => ({ id, title: `Video ${id}`, url: `https://www.youtube.com/watch?v=${id}`, author: 'Some Channel' }));

  test('announces a new upload, a Short under its own type, and not a live broadcast', async () => {
    configStub.youtube.apiKey = 'api-key';
    db.addWatchedYoutubeChannel(G1, streamerA, 'UCa', 'Some Channel', 'VIDEOS-CH', null, JSON.stringify(['old']));
    yt.feeds.UCa = feedOf('old', 'up1', 'short1', 'onair1');
    yt.details = {
      up1: { duration: 600, isShort: false, isLiveOrUpcoming: false },
      short1: { duration: 150, isShort: true, isLiveOrUpcoming: false },
      onair1: { duration: 0, isShort: false, isLiveOrUpcoming: true },
    };

    await manager.pollAllYouTubeFeed();

    assert.deepEqual(sent.map((s) => s.type).sort(), ['youtube_short', 'youtube_video']);
    assert.deepEqual(yt.detailCalls, [['up1', 'short1', 'onair1']], 'the details of the new videos come in one lookup');
    assert.deepEqual(JSON.parse(db.getYoutubeChannelState('UCa').known_video_ids), ['old', 'up1', 'short1', 'onair1']);
  });

  test('without an API key the feed still announces new videos, and asks YouTube for nothing', async () => {
    db.addWatchedYoutubeChannel(G1, streamerA, 'UCa', 'Some Channel', 'VIDEOS-CH', null, JSON.stringify(['old']));
    yt.feeds.UCa = feedOf('old', 'up1');

    await manager.pollAllYouTubeFeed();

    assert.deepEqual(sent.map((s) => s.type), ['youtube_video']);
    assert.deepEqual(yt.detailCalls, []);
    assert.deepEqual(logs.filter((l) => /warn|error/.test(l)), []);
  });
});

describe('startAll: the first run', () => {
  test('the YouTube live poller also runs at once, so a stream that is on when the server starts gets its chat back', async () => {
    configStub.youtube.apiKey = 'api-key';
    db.addWatchedYoutubeChannel(G1, streamerA, 'UCa', 'Some Channel', 'VIDEOS-CH', 'LIVE-CHANNEL', null);
    yt.feeds.UCa = [{ id: 'v1', title: 'T', url: 'u', author: 'a' }];
    mock.timers.enable({ apis: ['setInterval'] });

    manager.startAll();
    await settle();

    assert.equal(yt.liveCalls.length, 1, 'without waiting for the first two-minute tick');
  });
});
