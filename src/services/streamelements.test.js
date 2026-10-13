'use strict';

const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { EventEmitter } = require('events');

// ── Stubs for everything streamelements.js talks to ──────────────────

let streamer;
let calls;
let logDonationResult;

const dbStub = {
  getStreamerById: () => streamer,
  logDonation: (id, d) => {
    calls.logDonation.push({ id, ...d });
    if (logDonationResult instanceof Error) throw logDonationResult;
    return logDonationResult;
  },
  logOverlayEvent: (id, type, username, data) => calls.logOverlayEvent.push({ id, type, username, data }),
};
const busStub = new EventEmitter();
const chatStub = { chatManager: { sendEventMessage: (id, type, data) => calls.chat.push({ id, type, data }) } };
const tipGoalsStub = { recordDonation: (id, amount, currency) => calls.recordDonation.push({ id, amount, currency }) };

const SE_FILE = path.join(__dirname, 'streamelements.js');
const Module = require('module');
const origLoad = Module._load.bind(Module);
// Stays on for the whole file: streamelements.js requires ./tipGoals lazily.
Module._load = function (request, parent, isMain) {
  if (parent && parent.filename === SE_FILE) {
    if (request === 'socket.io-client') return () => { throw new Error('no network in tests'); };
    if (request === '../db') return dbStub;
    if (request === './overlayBus') return busStub;
    if (request === './twitchChat') return chatStub;
    if (request === './tipGoals') return tipGoalsStub;
  }
  return origLoad(request, parent, isMain);
};
after(() => { Module._load = origLoad; });

delete require.cache[SE_FILE];
const { handleTip } = require('./streamelements');

const tipEvent = (over) => ({
  _id: 'se-event-1', type: 'tip',
  data: { username: 'Viewer', amount: 5, currency: 'EUR', message: 'gg' },
  ...over,
});

beforeEach(() => {
  streamer = { id: 7, overlay_donation_enabled: 1 };
  calls = { logDonation: [], logOverlayEvent: [], chat: [], recordDonation: [], alerts: [] };
  logDonationResult = true;
  busStub.removeAllListeners();
  busStub.on('overlay:7', (e) => calls.alerts.push(e));
});

test('a real tip is logged, counted toward the goal once, alerted and thanked', () => {
  handleTip(7, tipEvent(), false);
  assert.equal(calls.logDonation.length, 1);
  assert.equal(calls.logDonation[0].external_id, 'se-event-1');
  assert.equal(calls.logDonation[0].source, 'streamelements');
  assert.deepEqual(calls.recordDonation, [{ id: 7, amount: 5, currency: 'EUR' }]);
  assert.equal(calls.alerts.length, 1);
  assert.equal(calls.alerts[0].type, 'donation');
  assert.equal(calls.logOverlayEvent.length, 1);
  assert.equal(calls.chat.length, 1);
});

test('a replayed tip (same StreamElements id) still shows but is not counted again', () => {
  logDonationResult = false;
  handleTip(7, tipEvent(), false);
  assert.equal(calls.logDonation.length, 1);
  assert.deepEqual(calls.recordDonation, []);
  assert.deepEqual(calls.logOverlayEvent, [], 'a replay is not another donation in the 7-day stats');
  assert.equal(calls.alerts.length, 1);
  assert.equal(calls.chat.length, 1);
});

test('StreamElements test tips play the alert but are not logged or counted', () => {
  handleTip(7, tipEvent(), true);
  assert.equal(calls.alerts.length, 1);
  assert.equal(calls.chat.length, 1);
  assert.deepEqual(calls.logOverlayEvent, [], 'test tips stay out of the 7-day overlay stats');
  assert.deepEqual(calls.logDonation, []);
  assert.deepEqual(calls.recordDonation, []);
});

test('with the donation alert off, a real tip is still logged and counted', () => {
  streamer = { id: 7, overlay_donation_enabled: 0 };
  handleTip(7, tipEvent(), false);
  assert.equal(calls.logDonation.length, 1);
  assert.equal(calls.recordDonation.length, 1);
  assert.equal(calls.alerts.length, 0);
  assert.equal(calls.logOverlayEvent.length, 0);
  assert.equal(calls.chat.length, 0);
});

test('when the donation cannot be logged it is not counted toward the goal', () => {
  logDonationResult = new Error('database is locked');
  const errors = [];
  const { error } = console;
  console.error = (...args) => errors.push(args.join(' '));
  try { handleTip(7, tipEvent(), false); } finally { console.error = error; }
  assert.equal(errors.length, 1);
  assert.match(errors[0], /logDonation error/);
  assert.deepEqual(calls.recordDonation, []);
  assert.equal(calls.alerts.length, 1, 'the alert still plays');
});

test('other StreamElements events are ignored', () => {
  handleTip(7, { _id: 'x', type: 'follower', data: { username: 'Viewer' } }, false);
  handleTip(7, null, false);
  assert.deepEqual(calls.logDonation, []);
  assert.deepEqual(calls.alerts, []);
});
