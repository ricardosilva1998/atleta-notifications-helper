'use strict';

// EventSub does not connect for an account an admin disabled,
// even when something asks them to (a reconnect timer set before the account
// was disabled, a dashboard save). The sockets are fakes: nothing connects.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

let streamers;
const dbStub = {
  getStreamerById: (id) => streamers[id] || null,
  // What startAll starts from: the streamers whose overlay or chatbot is on (the stub lists them all).
  getOverlayOrChatbotStreamers: () => Object.values(streamers),
  getOverlayEnabledStreamers: () => { throw new Error('the managers must start from the streamers whose overlay or chatbot is on'); },
};

const sockets = { webSocket: [] };
class FakeWebSocket {
  constructor(url) { this.url = url; sockets.webSocket.push(this); }
  on() {}
  close() {}
}

const stubs = {
  [`${path.sep}eventsub.js`]: {
    ws: FakeWebSocket,
    '../config': { twitch: { clientId: 'synthetic-client-id' } },
    '../db': dbStub,
    './twitch': { refreshBroadcasterToken: async () => 'token', hasRedemptionScope: () => false, hasPollsScope: () => false },
    './twitchChat': { chatManager: {} },
  },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const from = parent && parent.filename;
  const key = from && Object.keys(stubs).find((suffix) => from.endsWith(suffix));
  if (key && Object.prototype.hasOwnProperty.call(stubs[key], request)) return stubs[key][request];
  return origLoad.call(this, request, parent, isMain);
};
const { eventSubManager } = require('./eventsub');
Module._load = origLoad;

const realLog = console.log;
beforeEach(() => {
  console.log = () => {};
  sockets.webSocket.length = 0;
  streamers = {
    1: { id: 1, enabled: 1, twitch_user_id: '111', twitch_display_name: 'One', broadcaster_access_token: 'tok', streamelements_jwt: 'jwt' },
    2: { id: 2, enabled: 0, twitch_user_id: '222', twitch_display_name: 'Two', broadcaster_access_token: 'tok', streamelements_jwt: 'jwt' },
  };
});

describe('EventSub', () => {
  test('connects for an enabled account', () => {
    eventSubManager.startForStreamer(1);
    console.log = realLog;
    assert.equal(sockets.webSocket.length, 1);
    eventSubManager.stopForStreamer(1);
  });

  test('does not connect for a disabled account', () => {
    eventSubManager.startForStreamer(2);
    console.log = realLog;
    assert.equal(sockets.webSocket.length, 0);
    eventSubManager.stopForStreamer(2);
  });

  test('does not connect when the account is disabled after a start was already asked for', () => {
    eventSubManager.startForStreamer(1);
    eventSubManager.stopForStreamer(1);
    streamers[1].enabled = 0;
    eventSubManager.startForStreamer(1);
    console.log = realLog;
    assert.equal(sockets.webSocket.length, 1, 'only the first start connected');
    eventSubManager.stopForStreamer(1);
  });
});
