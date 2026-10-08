'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

// ── Minimal in-memory DB stub ────────────────────────────────────────

let _goal = null;

const dbStub = {
  getActiveTipGoal() {
    return _goal && _goal.status === 'active' ? { ..._goal } : null;
  },
  addToTipGoal(id, amount) {
    const before = { ..._goal };
    _goal.current_amount = Math.max(0, Math.round((_goal.current_amount + amount) * 100) / 100);
    _goal.completed_at = _goal.current_amount >= _goal.target_amount ? (_goal.completed_at || 'now') : null;
    return { before, after: { ..._goal } };
  },
};

const busStub = new EventEmitter();

// ── Module isolation via _load hook ──────────────────────────────────

const Module = require('module');
const origLoad = Module._load.bind(Module);
Module._load = function (request, parent, isMain) {
  if (request === '../db') return dbStub;
  if (request === './overlayBus') return busStub;
  return origLoad(request, parent, isMain);
};
delete require.cache[require.resolve('./tipGoals')];
const tipGoals = require('./tipGoals');
Module._load = origLoad;

let events;
beforeEach(() => {
  _goal = { id: 1, streamer_id: 7, title: 'Pedals', target_amount: 20, current_amount: 0, currency: 'EUR', bar_color: '#ff0000', status: 'active', completed_at: null };
  events = [];
  busStub.removeAllListeners();
  busStub.on(tipGoals.channel(7), e => events.push(e));
});

test('toPayload computes percent and caps at 100', () => {
  assert.equal(tipGoals.toPayload(null), null);
  assert.equal(tipGoals.toPayload({ ..._goal, current_amount: 5 }).percent, 25);
  const over = tipGoals.toPayload({ ..._goal, current_amount: 50 });
  assert.equal(over.percent, 100);
  assert.equal(over.completed, true);
});

test('currencyMatches is case-insensitive and treats missing currency as a match', () => {
  assert.equal(tipGoals.currencyMatches('EUR', 'eur'), true);
  assert.equal(tipGoals.currencyMatches('EUR', undefined), true);
  assert.equal(tipGoals.currencyMatches('EUR', 'USD'), false);
});

test('recordDonation adds matching donations and broadcasts the new state', () => {
  tipGoals.recordDonation(7, '7.5', 'EUR');
  assert.equal(_goal.current_amount, 7.5);
  assert.equal(events.length, 1);
  assert.equal(events[0].added, 7.5);
  assert.equal(events[0].goal.current, 7.5);
  assert.equal(events[0].justCompleted, false);
});

test('recordDonation ignores other currencies, invalid amounts and missing goals', () => {
  tipGoals.recordDonation(7, 10, 'USD');
  tipGoals.recordDonation(7, 'abc', 'EUR');
  tipGoals.recordDonation(7, -5, 'EUR');
  assert.equal(_goal.current_amount, 0);
  _goal.status = 'ended';
  tipGoals.recordDonation(7, 10, 'EUR');
  assert.equal(events.length, 0);
});

test('justCompleted fires only on the donation that crosses the target', () => {
  tipGoals.recordDonation(7, 15, 'EUR');
  tipGoals.recordDonation(7, 10, 'EUR');
  tipGoals.recordDonation(7, 1, 'EUR');
  assert.deepEqual(events.map(e => e.justCompleted), [false, true, false]);
  assert.equal(events[2].goal.completed, true);
});

test('sendTest broadcasts a sanitized simulated state without touching the goal', () => {
  const ok = tipGoals.sendTest(7, {
    goal: { title: 'x'.repeat(100), target: 20, current: 25, currency: 'XXX', barColor: 'red;background:url(x)' },
    added: 5, justCompleted: true,
  });
  tipGoals.endTest(7);
  assert.equal(ok, true);
  assert.equal(_goal.current_amount, 0);
  const e = events[0];
  assert.equal(e.test, true);
  assert.equal(e.goal.id, 1);
  assert.equal(e.goal.title.length, 60);
  assert.equal(e.goal.currency, 'EUR');
  assert.equal(e.goal.barColor, '#22c55e');
  assert.equal(e.goal.completed, true);
  assert.equal(e.justCompleted, true);
  // endTest re-broadcasts the real state
  assert.equal(events[1].test, undefined);
  assert.equal(events[1].goal.current, 0);
});

test('sendTest rejects invalid targets', () => {
  assert.equal(tipGoals.sendTest(7, { goal: { target: 0, current: 1 } }), false);
  assert.equal(tipGoals.sendTest(7, { goal: { target: 'abc', current: 1 } }), false);
  assert.equal(events.length, 0);
});
