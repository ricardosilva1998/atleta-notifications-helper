'use strict';

// The live poller's reading of one poll (M21): a channel is marked offline, and
// its recap sent, only after two polls in a row found no stream, and the stream
// id tells a hiccup, or the same broadcast coming back, from a new broadcast.
// Twitch and Discord are stubs; nothing leaves the machine. All names and ids
// are synthetic.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const POLLER_FILE = path.join(__dirname, 'twitchLive.js');

let helix; // what the stubbed Twitch answers and was asked
const embeds = [];
const twitchStub = {
  getClips: async (...args) => { helix.clipCalls.push(args); if (helix.down) throw new Error('Twitch API error: 500'); return helix.clips; },
  getVideos: async (...args) => { helix.videoCalls.push(args); if (helix.down) throw new Error('Twitch API error: 500'); return helix.videos; },
  getFollowerCount: async (...args) => { helix.followerCalls.push(args); if (helix.down) throw new Error('Twitch API error: 500'); return helix.followers; },
};
const discordStub = { buildEmbed: (fields) => { embeds.push(fields); return { built: fields }; } };

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent && parent.filename === POLLER_FILE) {
    if (request === '../services/twitch') return twitchStub;
    if (request === '../discord') return discordStub;
  }
  return origLoad.call(this, request, parent, isMain);
};
const { check, classifyPoll, OFFLINE_CONFIRM_POLLS } = require('./twitchLive');
Module._load = origLoad;

const HOUR = 3600 * 1000;

const stream = (over = {}) => ({
  id: '4000000001',
  user_login: 'some_channel',
  user_name: 'Some_Channel',
  title: 'Race night',
  game_name: 'iRacing',
  thumbnail_url: 'https://img.test/live_user_some_channel-{width}x{height}.jpg',
  started_at: '2026-10-13T20:00:00Z',
  viewer_count: 12,
  ...over,
});

// The stored row of a channel that is live since two hours ago.
const liveState = (over = {}) => ({
  twitch_username: 'some_channel',
  twitch_broadcaster_id: '777',
  is_live: 1,
  last_stream_id: '4000000001',
  offline_polls: 0,
  stream_title: 'Race night',
  stream_category: 'iRacing',
  stream_thumbnail_url: 'https://img.test/old.jpg',
  stream_started_at: new Date(Date.now() - 2 * HOUR).toISOString(),
  peak_viewers: 30,
  ...over,
});
const offlineState = (over = {}) => ({ twitch_username: 'some_channel', twitch_broadcaster_id: '777', is_live: 0, last_stream_id: null, offline_polls: 0, ...over });

beforeEach(() => {
  helix = {
    down: false,
    clips: [
      { title: 'small', view_count: 3, url: 'https://clips.test/small' },
      { title: 'big', view_count: 90, url: 'https://clips.test/big' },
      { title: 'mid', view_count: 40, url: 'https://clips.test/mid' },
      { title: 'tiny', view_count: 1, url: 'https://clips.test/tiny' },
    ],
    videos: [{ url: 'https://twitch.test/videos/1', thumbnail_url: 'https://img.test/vod-%{width}x%{height}.jpg' }],
    followers: 1500,
    clipCalls: [], videoCalls: [], followerCalls: [],
  };
  embeds.length = 0;
});

describe('classifyPoll', () => {
  test('no stream for a channel that was not live is nothing', () => {
    assert.deepEqual(classifyPoll(offlineState(), null), { kind: 'offline' });
  });

  test('a stream for a channel that was not live is a start; so is a different stream than the last announced', () => {
    assert.deepEqual(classifyPoll(offlineState(), stream()), { kind: 'started' });
    assert.deepEqual(classifyPoll(offlineState({ last_stream_id: '3999999999' }), stream()), { kind: 'started' });
  });

  test('the broadcast announced before coming back is "resumed", not a new start', () => {
    assert.deepEqual(classifyPoll(offlineState({ last_stream_id: '4000000001' }), stream()), { kind: 'resumed' });
  });

  test('a stream for a live channel is a continuation, whether or not the stored id is known yet', () => {
    assert.deepEqual(classifyPoll(liveState(), stream()), { kind: 'continuing' });
    assert.deepEqual(classifyPoll(liveState({ last_stream_id: null }), stream()), { kind: 'continuing' });
  });

  test('another broadcast than the announced one, while the channel is live, is a replacement', () => {
    assert.deepEqual(classifyPoll(liveState(), stream({ id: '4000000002' })), { kind: 'replaced' });
  });

  test('ids compare as text: a number from the database equals the text from Twitch', () => {
    assert.deepEqual(classifyPoll(liveState({ last_stream_id: 4000000001 }), stream({ id: '4000000001' })), { kind: 'continuing' });
  });

  test('the first poll without a stream is only a miss; the second in a row ends the stream', () => {
    assert.equal(OFFLINE_CONFIRM_POLLS, 2);
    assert.deepEqual(classifyPoll(liveState({ offline_polls: 0 }), null), { kind: 'missed', missed: 1 });
    assert.deepEqual(classifyPoll(liveState({ offline_polls: 1 }), null), { kind: 'ended' });
    assert.deepEqual(classifyPoll(liveState({ offline_polls: null }), null), { kind: 'missed', missed: 1 }, 'a row from before the column existed');
  });
});

describe('check', () => {
  test('a start announces the stream and stores the broadcast', async () => {
    const result = await check('some_channel', offlineState(), null, stream());
    assert.equal(result.kind, 'started');
    assert.equal(result.notify, true);
    assert.deepEqual(result.embed, { built: embeds[0] });
    assert.equal(embeds[0].title, 'Race night');
    assert.equal(embeds[0].image, 'https://img.test/live_user_some_channel-1280x720.jpg');
    assert.equal(embeds[0].url, 'https://twitch.tv/some_channel');
    assert.deepEqual(result.stateUpdate, {
      is_live: 1, offline_polls: 0, last_stream_id: '4000000001', stream_title: 'Race night', stream_category: 'iRacing',
      stream_thumbnail_url: 'https://img.test/live_user_some_channel-1280x720.jpg', stream_started_at: '2026-10-13T20:00:00Z', peak_viewers: 12,
    });
    assert.equal(result.recapData, undefined);
    assert.equal(result.clearSession, undefined);
  });

  test('a still-live channel updates its numbers, clears the missed count and says nothing', async () => {
    const result = await check('some_channel', liveState({ offline_polls: 1 }), null, stream({ viewer_count: 77, title: 'New title' }));
    assert.equal(result.kind, 'continuing');
    assert.equal(result.notify, false);
    assert.equal(result.stateUpdate.offline_polls, 0);
    assert.equal(result.stateUpdate.peak_viewers, 77);
    assert.equal(result.stateUpdate.stream_title, 'New title');
    assert.equal(result.stateUpdate.is_live, undefined, 'it is already live');
    assert.equal(helix.clipCalls.length, 0);
  });

  test('the first miss changes nothing but the count: no recap, not offline', async () => {
    const result = await check('some_channel', liveState(), 'broadcaster-token', null);
    assert.deepEqual(result, { kind: 'missed', notify: false, stateUpdate: { offline_polls: 1 } });
    assert.equal(helix.clipCalls.length + helix.videoCalls.length + helix.followerCalls.length, 0, 'Twitch is not asked for a recap');
  });

  test('the second miss in a row ends the stream with a recap of the stored broadcast', async () => {
    const result = await check('some_channel', liveState({ offline_polls: 1 }), 'broadcaster-token', null);
    assert.equal(result.kind, 'ended');
    assert.equal(result.notify, false);
    assert.equal(result.clearSession, true);
    assert.deepEqual(result.stateUpdate, { is_live: 0, offline_polls: 0 });

    const recap = result.recapData;
    assert.equal(recap.title, 'Race night');
    assert.equal(recap.category, 'iRacing');
    assert.equal(recap.peakViewers, 30);
    assert.ok(recap.duration >= 2 * 3600 && recap.duration < 2 * 3600 + 60, `duration ${recap.duration}`);
    assert.deepEqual(recap.clips.map((c) => c.title), ['big', 'mid', 'small'], 'the three most viewed');
    assert.equal(recap.vodUrl, 'https://twitch.test/videos/1');
    assert.equal(recap.thumbnailUrl, 'https://img.test/vod-1280x720.jpg');
    assert.equal(recap.followerCount, 1500);
    assert.deepEqual(helix.followerCalls, [['777', 'broadcaster-token']]);
  });

  test('a stream under five minutes ends without a recap', async () => {
    const short = liveState({ offline_polls: 1, stream_started_at: new Date(Date.now() - 4 * 60 * 1000).toISOString() });
    const result = await check('some_channel', short, null, null);
    assert.equal(result.kind, 'ended');
    assert.equal(result.recapData, null);
    assert.equal(result.clearSession, true);
    assert.deepEqual(result.stateUpdate, { is_live: 0, offline_polls: 0 });
  });

  test('the same broadcast back after being marked offline is live again, with no second announcement', async () => {
    const result = await check('some_channel', offlineState({ last_stream_id: '4000000001' }), null, stream());
    assert.equal(result.kind, 'resumed');
    assert.equal(result.notify, false);
    assert.equal(result.embed, undefined);
    assert.equal(result.stateUpdate.is_live, 1);
    assert.equal(result.stateUpdate.stream_started_at, '2026-10-13T20:00:00Z', 'the recap will count the whole broadcast');
    assert.equal(embeds.length, 0);
  });

  test('another broadcast while the channel is live: the old one gets its recap (no VOD link) and the new one is announced', async () => {
    const result = await check('some_channel', liveState({ offline_polls: 1 }), 'broadcaster-token', stream({ id: '4000000002', title: 'Second stream' }));
    assert.equal(result.kind, 'replaced');
    assert.equal(result.notify, true);
    assert.equal(embeds[0].title, 'Second stream');
    assert.equal(result.clearSession, true, 'the old session is cleared before the new one is stored');
    assert.equal(result.stateUpdate.last_stream_id, '4000000002');
    assert.equal(result.stateUpdate.is_live, 1);
    assert.equal(result.stateUpdate.offline_polls, 0);

    assert.equal(result.recapData.title, 'Race night', 'the recap is of the broadcast that ended');
    assert.equal(result.recapData.vodUrl, null, 'the newest VOD already belongs to the new broadcast');
    assert.equal(helix.videoCalls.length, 0);
    assert.deepEqual(result.recapData.clips.map((c) => c.title), ['big', 'mid', 'small']);
  });

  test('no stream and not live is nothing at all', async () => {
    assert.equal(await check('some_channel', offlineState(), null, null), null);
  });

  test('a recap that cannot reach Twitch still ends the stream', async () => {
    helix.down = true;
    const { error } = console;
    console.error = () => {};
    try {
      const result = await check('some_channel', liveState({ offline_polls: 1 }), null, null);
      assert.equal(result.kind, 'ended');
      assert.deepEqual(result.recapData.clips, []);
      assert.equal(result.recapData.vodUrl, null);
    } finally {
      console.error = error;
    }
  });
});
