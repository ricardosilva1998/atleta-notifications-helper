'use strict';

// The YouTube feed poller (L6, R-e): an upload is announced as a video or a
// Short, a live or upcoming broadcast is left to the live poller, and a video
// the feed reports without any duration information is announced as a normal
// video, whatever the reason. YouTube is a stub; nothing leaves the machine.
// All ids and names are synthetic.

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const POLLER_FILE = path.join(__dirname, 'youtubeFeed.js');

const world = {};
const youtubeStub = {
  getLatestVideos: async () => world.feed,
  getVideoDetails: async (ids, apiKey) => {
    world.detailCalls.push({ ids, apiKey });
    if (world.detailsFail) throw new Error(world.detailsFail);
    return world.details;
  },
};

const origLoad = Module._load;
let check;

before(() => {
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === POLLER_FILE && request === '../services/youtube') return youtubeStub;
    return origLoad.call(this, request, parent, isMain);
  };
});

after(() => {
  Module._load = origLoad;
});

const video = (id, title = `Title ${id}`) => ({ id, title, url: `https://www.youtube.com/watch?v=${id}`, author: 'Some Channel' });
const detail = (over = {}) => ({ duration: 600, isShort: false, isLiveOrUpcoming: false, ...over });
const state = (over = {}) => ({ known_video_ids: '[]', live_video_id: null, ...over });

const realConsole = { log: console.log, warn: console.warn, error: console.error };
let warnings;

beforeEach(() => {
  // A fresh module each time: it remembers whether it has already warned about a failed lookup.
  delete require.cache[POLLER_FILE];
  ({ check } = require('./youtubeFeed'));
  Object.keys(world).forEach((key) => delete world[key]);
  Object.assign(world, { feed: [], details: {}, detailCalls: [], detailsFail: null });
  warnings = [];
  console.log = () => {};
  console.warn = (...args) => warnings.push(args.join(' '));
  console.error = () => {};
});

afterEach(() => {
  Object.assign(console, realConsole);
});

describe('what is announced', () => {
  test('a new upload is announced as a video, and remembered', async () => {
    world.feed = [video('up1', 'Race recap')];
    world.details = { up1: detail() };
    const result = await check('UCchannel', state({ known_video_ids: '["old1"]' }), 'api-key');
    assert.equal(result.notify, true);
    assert.deepEqual(result.videoData, [{ message: '🎬 **Some Channel uploaded a new video!** — Race recap\nhttps://www.youtube.com/watch?v=up1', isShort: false }]);
    assert.deepEqual(JSON.parse(result.stateUpdate.known_video_ids), ['old1', 'up1']);
  });

  test('a video of 3 minutes or less is announced as a Short', async () => {
    world.feed = [video('short1', 'Quick pass')];
    world.details = { short1: detail({ duration: 180, isShort: true }) };
    const result = await check('UCchannel', state(), 'api-key');
    assert.equal(result.videoData[0].isShort, true);
    assert.match(result.videoData[0].message, /^📱 \*\*Some Channel posted a Short!\*\* — Quick pass/);
  });

  test('a live broadcast, and one that is only announced, are left to the live poller but remembered, so they are not announced as uploads later', async () => {
    world.feed = [video('onair1'), video('soon1')];
    world.details = { onair1: detail({ isLiveOrUpcoming: true }), soon1: detail({ isLiveOrUpcoming: true }) };
    const result = await check('UCchannel', state(), 'api-key');
    assert.equal(result.notify, false);
    assert.deepEqual(result.videoData, []);
    assert.deepEqual(JSON.parse(result.stateUpdate.known_video_ids), ['onair1', 'soon1']);

    // The broadcast has ended and is now an ordinary video of the channel: already known.
    world.feed = [video('onair1'), video('soon1')];
    world.details = { onair1: detail(), soon1: detail() };
    assert.equal(await check('UCchannel', state({ known_video_ids: result.stateUpdate.known_video_ids }), 'api-key'), null);
  });

  test('an upload next to a broadcast: only the upload is announced', async () => {
    world.feed = [video('onair1'), video('up1')];
    world.details = { onair1: detail({ isLiveOrUpcoming: true }), up1: detail() };
    const result = await check('UCchannel', state(), 'api-key');
    assert.deepEqual(result.videoData.map((v) => v.message.split('\n')[1]), ['https://www.youtube.com/watch?v=up1']);
    assert.deepEqual(JSON.parse(result.stateUpdate.known_video_ids), ['onair1', 'up1']);
  });

  test('videos already known, and the broadcast the live poller is on, are not announced', async () => {
    world.feed = [video('known1'), video('onair1')];
    world.details = {};
    const result = await check('UCchannel', state({ known_video_ids: '["known1"]', live_video_id: 'onair1' }), 'api-key');
    assert.equal(result.notify, false, 'nothing new');
    assert.equal(world.detailCalls.length, 0, 'and YouTube is not asked about anything');
  });
});

describe('a video without duration information is a normal video (R-e)', () => {
  test('with no API key, as in production today: nothing is asked and nothing is logged, and every new video is announced', async () => {
    world.feed = [video('a1'), video('a2')];
    const result = await check('UCchannel', state(), '');
    assert.equal(result.videoData.length, 2);
    assert.ok(result.videoData.every((v) => v.isShort === false));
    assert.equal(world.detailCalls.length, 0);
    assert.deepEqual(warnings, []);
  });

  test('when the lookup fails the new videos are still announced, as normal videos, and the failure is logged once', async () => {
    world.feed = [video('a1')];
    world.detailsFail = 'YouTube API error: 500';
    const first = await check('UCchannel', state(), 'api-key');
    assert.equal(first.notify, true);
    assert.equal(first.videoData[0].isShort, false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Could not read the details of new videos \(YouTube API error: 500\) - announcing them as normal videos/);

    world.feed = [video('a1'), video('a2')];
    const second = await check('UCchannel', state({ known_video_ids: '["a1"]' }), 'api-key');
    assert.equal(second.videoData.length, 1);
    assert.equal(warnings.length, 1, 'the same outage is not logged again');
  });

  test('a lookup that works again re-arms the warning for the next outage', async () => {
    world.feed = [video('a1')];
    world.detailsFail = 'YouTube API error: 500';
    await check('UCchannel', state(), 'api-key');
    assert.equal(warnings.length, 1);

    world.detailsFail = null;
    world.feed = [video('b1')];
    world.details = { b1: detail() };
    await check('UCchannel', state(), 'api-key');

    world.detailsFail = 'YouTube API error: 503';
    world.feed = [video('c1')];
    await check('UCchannel', state(), 'api-key');
    assert.equal(warnings.length, 2);
  });

  test('a video YouTube does not list is a normal video, while the others keep their details', async () => {
    world.feed = [video('known-to-api'), video('unlisted')];
    world.details = { 'known-to-api': detail({ duration: 45, isShort: true }) };
    const result = await check('UCchannel', state(), 'api-key');
    assert.deepEqual(result.videoData.map((v) => v.isShort), [true, false]);
    assert.deepEqual(warnings, [], 'nothing failed');
  });

  test('the quota running out is a failed lookup too: the videos are announced as normal ones', async () => {
    world.feed = [video('a1')];
    world.detailsFail = 'YouTube API quota exceeded';
    const result = await check('UCchannel', state(), 'api-key');
    assert.equal(result.videoData.length, 1);
  });
});
