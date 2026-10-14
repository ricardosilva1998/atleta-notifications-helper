'use strict';

// What a YouTube live poll means for a channel (M22): given the live video found
// among the channel's latest videos, the post to make and the state to store.
// Discord is a stub; nothing leaves the machine. All ids and names are synthetic.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const POLLER_FILE = path.join(__dirname, 'youtubeLive.js');
const built = [];
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent && parent.filename === POLLER_FILE && request === '../discord') return { buildEmbed: (fields) => { built.push(fields); return { embed: fields }; } };
  return origLoad.call(this, request, parent, isMain);
};
const { decide, LIVE_CHECK_VIDEOS } = require('./youtubeLive');
Module._load = origLoad;

const liveVideo = (over = {}) => ({ id: 'live1', title: 'Race night', description: 'Come and watch', thumbnail: 'https://img.test/live1.jpg', liveChatId: 'chat-live1', ...over });

describe('decide', () => {
  test('a broadcast on air for a channel that was not live is announced, and stored', () => {
    built.length = 0;
    const result = decide({ is_live: 0 }, liveVideo());
    assert.equal(result.notify, true);
    assert.deepEqual(result.stateUpdate, { is_live: 1, live_video_id: 'live1' });
    assert.deepEqual(result.embed, { embed: built[0] });
    assert.equal(built[0].title, 'Race night');
    assert.equal(built[0].url, 'https://www.youtube.com/watch?v=live1');
    assert.equal(built[0].image, 'https://img.test/live1.jpg');
    assert.equal(built[0].author.name, 'Live on YouTube!');
    assert.equal(built[0].footer.text, 'YouTube Live');
  });

  test('a long description is cut to 200 characters, and a missing one is left out', () => {
    built.length = 0;
    decide({ is_live: 0 }, liveVideo({ description: 'x'.repeat(500) }));
    decide({ is_live: 0 }, liveVideo({ description: '' }));
    assert.equal(built[0].description.length, 200);
    assert.equal(built[1].description, undefined);
  });

  test('a broadcast that is still on air, for a channel already live, is nothing new', () => {
    assert.equal(decide({ is_live: 1, live_video_id: 'live1' }, liveVideo()), null);
  });

  test('a channel that was live and has no broadcast on air any more is marked offline, without a post', () => {
    assert.deepEqual(decide({ is_live: 1, live_video_id: 'live1' }, null), { notify: false, stateUpdate: { is_live: 0, live_video_id: null } });
  });

  test('a channel that was not live and still is not is nothing', () => {
    assert.equal(decide({ is_live: 0 }, null), null);
  });

  test('five of a channel\'s latest videos are looked at', () => {
    assert.equal(LIVE_CHECK_VIDEOS, 5);
  });
});
