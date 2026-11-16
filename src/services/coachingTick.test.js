'use strict';

// The coaching minute tick (services/coachingTick.js) with fake steps: the order they run in, that a step which throws
// does not stop the others, that one run goes at a time, and that the reschedule step gets the tick's clock.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const FILE = path.join(__dirname, 'coachingTick.js');
let tick;
const savedError = console.error;

before(() => {
  console.error = () => {};
  delete require.cache[FILE];
  tick = require(FILE);
});
after(() => { console.error = savedError; });

const NOW = Date.UTC(2026, 10, 2, 12, 0);

function deps(log, over = {}) {
  return {
    payments: { expireDue: async () => { log.push('expire'); return 1; }, reconcileStale: async () => { log.push('stale'); return 2; } },
    bookings: { runDueReschedules: async ({ now }) => { log.push(`reschedules@${now}`); return { dropped: 1, closed: 0 }; } },
    rooms: { finishOrCleanMaking: async () => { log.push('making'); return 3; }, closeDue: async () => { log.push('close'); return 4; } },
    ...over,
  };
}

describe('the tick', () => {
  test('runs expire, stale, reschedules, making and close in that order, the reschedules with the tick\'s clock', async () => {
    const log = [];
    const result = await tick.runOnce({ now: NOW, deps: deps(log) });
    assert.deepEqual(log, ['expire', 'stale', `reschedules@${NOW}`, 'making', 'close']);
    assert.deepEqual(result, { expire: 1, stale: 2, reschedules: { dropped: 1, closed: 0 }, making: 3, close: 4 });
  });

  test('a reschedule step that throws (Discord down, a bad row) does not stop the rooms\' steps', async () => {
    const log = [];
    const result = await tick.runOnce({ now: NOW, deps: deps(log, { bookings: { runDueReschedules: async () => { throw new Error('boom'); } } }) });
    assert.deepEqual(log, ['expire', 'stale', 'making', 'close']);
    assert.equal(result.reschedules, undefined);
    assert.equal(result.close, 4);
  });

  test('one run at a time: a run started while another is going does nothing', async () => {
    const log = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const slow = deps(log, { payments: { expireDue: async () => { await gate; log.push('expire'); return 1; }, reconcileStale: async () => 2 } });
    const first = tick.runOnce({ now: NOW, deps: slow });
    assert.equal(await tick.runOnce({ now: NOW, deps: deps(log) }), null);
    release();
    await first;
    assert.equal(log.filter((x) => x === 'expire').length, 1);
    assert.notEqual(await tick.runOnce({ now: NOW, deps: deps([]) }), null, 'free again afterwards');
  });

  test('start and stop leave no timer behind', () => {
    tick.startTicks();
    tick.startTicks();
    tick.stopTicks();
    tick.stopTicks();
  });
});
