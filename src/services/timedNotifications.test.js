'use strict';

// The sponsor rotations clamp the numbers they are given where the timers are
// created, so a bad stored value (negative, zero, huge) cannot make a 1 ms loop.
// db and the chat manager are stubs and the clock is mocked; nothing is waited for.

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const STREAMER_ID = 7;
const dbStub = {
  images: [],
  messages: [],
  streamer: null,
  getEnabledSponsorImages: () => dbStub.images,
  getEnabledSponsorMessages: () => dbStub.messages,
  getStreamerById: () => dbStub.streamer,
  getOverlayEnabledStreamers: () => [],
};
const chatSends = [];
const chatStub = { chatManager: { sendMessage: (streamerId, text, options) => chatSends.push({ streamerId, text, ...options }) } };

const realLog = console.log;
const origLoad = Module._load;
let manager;
let bus;

before(() => {
  // Stays installed: the chat rotation requires ./twitchChat when its timer fires.
  Module._load = function (request, parent, isMain) {
    const from = parent && parent.filename;
    if (from && from.endsWith(`${path.sep}timedNotifications.js`)) {
      if (request === '../db') return dbStub;
      if (request === './twitchChat') return chatStub;
    }
    return origLoad.call(this, request, parent, isMain);
  };
  ({ timedNotificationManager: manager } = require('./timedNotifications'));
  bus = require('./overlayBus');
});

after(() => {
  Module._load = origLoad;
});

let shown;
const onShown = (event) => { if (event.type === 'sponsor') shown.push(event.data); };

beforeEach(() => {
  console.log = () => {};
  shown = [];
  chatSends.length = 0;
  dbStub.streamer = { id: STREAMER_ID, twitch_username: 'somechannel', sponsor_rotation_enabled: 1, sponsor_send_chat: 1 };
  bus.on(`overlay:${STREAMER_ID}`, onShown);
});

afterEach(() => {
  manager.stopForStreamer(STREAMER_ID);
  bus.off(`overlay:${STREAMER_ID}`, onShown);
  console.log = realLog;
});

const image = (id, over = {}) => ({ id, filename: `sponsor_${id}.png`, display_name: `Sponsor ${id}`, display_duration: 30, image_scale: 1, ...over });

describe('sponsor images', () => {
  test('a negative duration is shown for 5 seconds, not swapped in a tight loop', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    dbStub.images = [image(1, { display_duration: -5 }), image(2, { display_duration: -5 })];
    manager.restartForStreamer(STREAMER_ID);

    assert.equal(shown.length, 1);
    assert.equal(shown[0].displayDuration, 5);
    t.mock.timers.tick(4999);
    assert.equal(shown.length, 1, 'still the first image just before 5 s');
    t.mock.timers.tick(1);
    assert.equal(shown.length, 2);
    assert.match(shown[1].imageUrl, /sponsor_2\.png$/, 'then the next image');
  });

  test('zero and a missing duration are 5 s and 30 s', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    dbStub.images = [image(1, { display_duration: 0 }), image(2, { display_duration: null })];
    manager.restartForStreamer(STREAMER_ID);
    assert.equal(shown[0].displayDuration, 5);
    t.mock.timers.tick(5000);
    assert.equal(shown[1].displayDuration, 30);
  });

  test('a huge duration is held to 300 seconds', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    dbStub.images = [image(1, { display_duration: 99999 }), image(2)];
    manager.restartForStreamer(STREAMER_ID);
    assert.equal(shown[0].displayDuration, 300);
    t.mock.timers.tick(299_999);
    assert.equal(shown.length, 1);
    t.mock.timers.tick(1);
    assert.equal(shown.length, 2);
  });

  test('a good duration is used as it is', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    dbStub.images = [image(1, { display_duration: 45 }), image(2)];
    manager.restartForStreamer(STREAMER_ID);
    assert.equal(shown[0].displayDuration, 45);
    t.mock.timers.tick(44_999);
    assert.equal(shown.length, 1);
    t.mock.timers.tick(1);
    assert.equal(shown.length, 2);
  });

  test('the image scale sent to the overlay stays inside the slider range', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    dbStub.images = [image(1, { image_scale: 7 }), image(2, { image_scale: -3 }), image(3, { image_scale: 0.6 }), image(4, { image_scale: null })];
    manager.restartForStreamer(STREAMER_ID);
    for (let i = 0; i < 3; i++) t.mock.timers.tick(30_000);
    assert.deepEqual(shown.map((s) => s.imageScale), [1, 0.3, 0.6, 1]);
  });
});

describe('the sponsor a new connection is shown', () => {
  const urlOf = (n) => `/sponsors/${STREAMER_ID}/sponsor_${n}.png`;

  test('an overlay that connects while a sponsor is showing is handed that sponsor', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    dbStub.images = [image(1), image(2)];
    manager.restartForStreamer(STREAMER_ID);
    assert.equal(manager.getCurrentSponsor(STREAMER_ID).data.imageUrl, urlOf(1));
    t.mock.timers.tick(30000);
    assert.equal(manager.getCurrentSponsor(STREAMER_ID).data.imageUrl, urlOf(2), 'the next one once the rotation moved on');
  });

  test('a sponsor that was switched off while it was showing is not replayed', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    dbStub.images = [image(1), image(2)];
    manager.restartForStreamer(STREAMER_ID);
    dbStub.images = [image(2)]; // image 1 is disabled or deleted; the rotation has not ticked yet
    assert.equal(manager.getCurrentSponsor(STREAMER_ID), null);
  });

  test('with every sponsor switched off nothing is replayed, even after the rotation noticed', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    dbStub.images = [image(1)];
    manager.restartForStreamer(STREAMER_ID);
    assert.ok(manager.getCurrentSponsor(STREAMER_ID));
    dbStub.images = [];
    manager.restartForStreamer(STREAMER_ID);
    assert.equal(manager.getCurrentSponsor(STREAMER_ID), null);
  });

  test('the rotation running out of images at its next turn forgets the last one', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    dbStub.images = [image(1)];
    manager.restartForStreamer(STREAMER_ID);
    dbStub.images = [];
    t.mock.timers.tick(30000); // the timer for the next image finds none
    assert.equal(manager.getCurrentSponsor(STREAMER_ID), null);
  });

  test('switching the rotation off stops the replay', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    dbStub.images = [image(1)];
    manager.restartForStreamer(STREAMER_ID);
    dbStub.streamer = { ...dbStub.streamer, sponsor_rotation_enabled: 0 };
    manager.restartForStreamer(STREAMER_ID);
    assert.equal(manager.getCurrentSponsor(STREAMER_ID), null);
  });

  test('stopping the streamer\'s rotations (a disabled account) stops it too', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    dbStub.images = [image(1)];
    manager.restartForStreamer(STREAMER_ID);
    manager.stopForStreamer(STREAMER_ID);
    assert.equal(manager.getCurrentSponsor(STREAMER_ID), null);
  });

  test('a streamer that never had a rotation has nothing to replay', () => {
    assert.equal(manager.getCurrentSponsor(9999), null);
  });

  test('stopping every rotation forgets what each was showing', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    dbStub.images = [image(1)];
    manager.restartForStreamer(STREAMER_ID);
    manager.stopAll();
    assert.equal(manager.getCurrentSponsor(STREAMER_ID), null);
  });
});

describe('sponsor chat messages', () => {
  const message = { message_text: 'Thanks to our sponsors', url: null };

  // The chat rotation is switched on per streamer; images are not needed for it.
  function startChat(t, minutes) {
    t.mock.timers.enable({ apis: ['setInterval'] });
    dbStub.messages = [message];
    dbStub.streamer = { ...dbStub.streamer, sponsor_chat_interval_minutes: minutes };
    manager.restartChatForStreamer(STREAMER_ID);
  }

  test('a negative interval is every minute, not every millisecond', (t) => {
    startChat(t, -3);
    t.mock.timers.tick(59_999);
    assert.equal(chatSends.length, 0);
    t.mock.timers.tick(1);
    assert.deepEqual(chatSends, [{ streamerId: STREAMER_ID, text: 'Thanks to our sponsors', priority: 'low' }], 'sponsor lines are the least important');
  });

  test('zero is every minute as well', (t) => {
    startChat(t, 0);
    t.mock.timers.tick(60_000);
    assert.equal(chatSends.length, 1);
  });

  test('a missing interval is every 10 minutes', (t) => {
    startChat(t, null);
    t.mock.timers.tick(599_999);
    assert.equal(chatSends.length, 0);
    t.mock.timers.tick(1);
    assert.equal(chatSends.length, 1);
  });

  test('an interval of more than a day is held to a day', (t) => {
    startChat(t, 99999);
    t.mock.timers.tick(1440 * 60_000 - 1);
    assert.equal(chatSends.length, 0);
    t.mock.timers.tick(1);
    assert.equal(chatSends.length, 1);
  });

  test('a good interval is used as it is', (t) => {
    startChat(t, 15);
    t.mock.timers.tick(15 * 60_000 - 1);
    assert.equal(chatSends.length, 0);
    t.mock.timers.tick(1);
    assert.equal(chatSends.length, 1);
  });
});
