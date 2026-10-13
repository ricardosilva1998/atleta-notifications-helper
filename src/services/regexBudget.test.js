'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createRegexBudget, LIMIT_MS, WINDOW_MS, COOLDOWN_MS } = require('./regexBudget');

// A budget on a fake clock (milliseconds) with a logger that records lines.
function fakeBudget() {
  const fake = { clock: 1_000_000, logs: [] };
  fake.budget = createRegexBudget({
    now: () => fake.clock,
    log: { log: (line) => fake.logs.push(['log', line]), warn: (line) => fake.logs.push(['warn', line]) },
  });
  return fake;
}

describe('regex time budget', () => {
  test('uses the agreed limits: 250 ms per rolling 10 s, off for an hour', () => {
    assert.equal(LIMIT_MS, 250);
    assert.equal(WINDOW_MS, 10_000);
    assert.equal(COOLDOWN_MS, 60 * 60 * 1000);
  });

  test('trips only when more than 250 ms is spent within 10 s', () => {
    const fake = fakeBudget();
    fake.budget.record(7, 200);
    fake.clock += 9_000;
    fake.budget.record(7, 50);
    assert.equal(fake.budget.allows(7), true, 'exactly 250 ms is still within budget');
    fake.clock += 500;
    fake.budget.record(7, 1);
    assert.equal(fake.budget.allows(7), false);
    assert.equal(fake.logs.length, 1);
    assert.equal(fake.logs[0][0], 'warn');
    assert.match(fake.logs[0][1], /streamer 7 took 251 ms of matching within 10 s/);
  });

  test('time older than the rolling 10 s window stops counting', () => {
    const fake = fakeBudget();
    fake.budget.record(7, 200);
    fake.clock += 10_000; // the first 200 ms are now 10 s old
    fake.budget.record(7, 100);
    assert.equal(fake.budget.allows(7), true);
    fake.clock += 1;
    fake.budget.record(7, 151); // 100 + 151 within the window
    assert.equal(fake.budget.allows(7), false);
  });

  test('stays off for an hour, then comes back on, logging each change once', () => {
    const fake = fakeBudget();
    fake.budget.record(7, 300);
    assert.equal(fake.budget.allows(7), false);
    fake.clock += COOLDOWN_MS - 1;
    assert.equal(fake.budget.allows(7), false);
    fake.budget.record(7, 1000); // ignored while off
    fake.clock += 1;
    assert.equal(fake.budget.allows(7), true);
    assert.equal(fake.budget.allows(7), true);
    assert.deepEqual(fake.logs.map(([level]) => level), ['warn', 'log']);
    assert.match(fake.logs[1][1], /back on for streamer 7/);
  });

  test('each streamer has their own budget', () => {
    const fake = fakeBudget();
    fake.budget.record(7, 300);
    assert.equal(fake.budget.allows(7), false);
    assert.equal(fake.budget.allows(8), true);
  });

  test('the sweeper drops idle streamers and ends expired trips, logging once', () => {
    const fake = fakeBudget();
    fake.budget.record(7, 10);
    fake.budget.record(8, 300);
    fake.clock += WINDOW_MS;
    fake.budget.sweep();
    assert.equal(fake.budget.size, 1, 'the idle streamer is dropped, the switched-off one kept');
    fake.clock += COOLDOWN_MS;
    fake.budget.sweep();
    assert.equal(fake.budget.size, 0);
    assert.equal(fake.budget.allows(8), true);
    assert.deepEqual(fake.logs.map(([level]) => level), ['warn', 'log']);
  });
});
