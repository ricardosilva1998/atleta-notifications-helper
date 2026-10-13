'use strict';

// Disabling, enabling and removing an account, against fake services that
// record what was called and in which order.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { disableAccount, enableAccount, removeAccount } = require('./accountLifecycle');

function fakeServices(streamer, { failing = [] } = {}) {
  const calls = [];
  const rec = (name) => (...args) => {
    calls.push([name, ...args]);
    if (failing.includes(name)) throw new Error(`${name} exploded`);
  };
  return {
    calls,
    services: {
      db: {
        disableStreamer: rec('db.disable'), enableStreamer: rec('db.enable'), deleteStreamer: rec('db.delete'),
        getStreamerById: () => streamer,
      },
      bus: { emit: rec('bus.emit') },
      eventSubManager: { startForStreamer: rec('eventsub.start'), stopForStreamer: rec('eventsub.stop') },
      streamElementsManager: { startForStreamer: rec('se.start'), stopForStreamer: rec('se.stop') },
      chatManager: { startForStreamer: rec('chat.start'), stopForStreamer: rec('chat.stop') },
      timedNotificationManager: {
        stopForStreamer: rec('sponsors.stop'),
        restartForStreamer: rec('sponsors.restart'),
        restartChatForStreamer: rec('sponsors.restartChat'),
      },
    },
  };
}

const names = (calls) => calls.map((c) => c[0]);

const FULLY_ON = {
  id: 5, overlay_enabled: 1, broadcaster_access_token: 'tok', streamelements_jwt: 'jwt',
  chatbot_enabled: 1, twitch_username: 'some_streamer',
};

describe('disableAccount', () => {
  test('marks the account (which also closes its sessions) and then stops every live connection', () => {
    const { calls, services } = fakeServices(FULLY_ON);
    disableAccount(5, 'Disabled by admin', services);
    assert.deepEqual(calls[0], ['db.disable', 5, 'Disabled by admin']);
    assert.deepEqual(names(calls).slice(1).sort(), ['bus.emit', 'chat.stop', 'eventsub.stop', 'se.stop', 'sponsors.stop']);
    assert.deepEqual(calls.find((c) => c[0] === 'eventsub.stop'), ['eventsub.stop', 5]);
    assert.deepEqual(calls.find((c) => c[0] === 'bus.emit'), ['bus.emit', 'overlay-disabled:5']);
  });

  test('stops the others when one manager throws, and says so', () => {
    const { calls, services } = fakeServices(FULLY_ON, { failing: ['eventsub.stop', 'chat.stop'] });
    const logged = [];
    const original = console.error;
    console.error = (...args) => logged.push(args.join(' '));
    try {
      disableAccount(5, null, services);
    } finally {
      console.error = original;
    }
    assert.deepEqual(names(calls).slice(1).sort(), ['bus.emit', 'chat.stop', 'eventsub.stop', 'se.stop', 'sponsors.stop']);
    assert.equal(logged.length, 2);
    assert.match(logged[0], /EventSub stop failed for streamer 5: eventsub\.stop exploded/);
  });
});

describe('enableAccount', () => {
  test('clears the flag and restarts what the streamer had switched on', () => {
    const { calls, services } = fakeServices(FULLY_ON);
    enableAccount(5, services);
    assert.deepEqual(calls[0], ['db.enable', 5]);
    assert.deepEqual(names(calls).slice(1).sort(),
      ['chat.start', 'eventsub.start', 'se.start', 'sponsors.restart', 'sponsors.restartChat']);
    assert.equal(names(calls).some((n) => n.endsWith('.stop')), false);
  });

  test('starts nothing the streamer had off (no overlay, no StreamElements token, no chatbot)', () => {
    const quiet = { id: 5, overlay_enabled: 0, broadcaster_access_token: 'tok', streamelements_jwt: 'jwt', chatbot_enabled: 0, twitch_username: 'x' };
    const { calls, services } = fakeServices(quiet);
    enableAccount(5, services);
    assert.deepEqual(names(calls), ['db.enable']);
  });

  test('without a StreamElements token it connects EventSub only', () => {
    const { calls, services } = fakeServices({ ...FULLY_ON, streamelements_jwt: null, chatbot_enabled: 0 });
    enableAccount(5, services);
    assert.deepEqual(names(calls).slice(1).sort(), ['eventsub.start', 'sponsors.restart', 'sponsors.restartChat']);
  });

  test('the chatbot alone needs no overlay, matching how the app boots', () => {
    const { calls, services } = fakeServices({ id: 5, overlay_enabled: 0, chatbot_enabled: 1, twitch_username: 'some_streamer' });
    enableAccount(5, services);
    assert.deepEqual(names(calls), ['db.enable', 'chat.start']);
  });

  test('the overlay needs a broadcaster token to connect', () => {
    const { calls, services } = fakeServices({ id: 5, overlay_enabled: 1, broadcaster_access_token: '', chatbot_enabled: 0 });
    enableAccount(5, services);
    assert.deepEqual(names(calls), ['db.enable']);
  });

  test('a missing streamer starts nothing', () => {
    const { calls, services } = fakeServices(undefined);
    enableAccount(5, services);
    assert.deepEqual(names(calls), ['db.enable']);
  });
});

describe('removeAccount', () => {
  test('stops the live connections before the rows are deleted', () => {
    const { calls, services } = fakeServices(FULLY_ON);
    removeAccount(5, services);
    assert.equal(names(calls).at(-1), 'db.delete');
    assert.deepEqual(calls.at(-1), ['db.delete', 5]);
    assert.deepEqual(names(calls).slice(0, -1).sort(), ['bus.emit', 'chat.stop', 'eventsub.stop', 'se.stop', 'sponsors.stop']);
  });
});
