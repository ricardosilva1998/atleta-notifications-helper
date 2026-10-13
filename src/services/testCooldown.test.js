'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createTestCooldown, testCooldown, TEST_COOLDOWN_MS } = require('./testCooldown');

function withClock() {
  const clock = { at: 1000 };
  const cooldown = createTestCooldown({ now: () => clock.at });
  return { clock, cooldown };
}

describe('the test cooldown', () => {
  test('is 5 seconds by default', () => {
    assert.equal(TEST_COOLDOWN_MS, 5000);
  });

  test('lets the first test through, and holds the next one until 5 seconds have passed', () => {
    const { clock, cooldown } = withClock();
    assert.equal(cooldown.take(1), 0);
    assert.equal(cooldown.take(1), 5000, 'straight away: the whole cooldown is left');
    clock.at += 1200;
    assert.equal(cooldown.take(1), 3800);
    clock.at += 3799;
    assert.equal(cooldown.take(1), 1);
    clock.at += 1;
    assert.equal(cooldown.take(1), 0, 'exactly 5 s after the last test that went through');
  });

  test('a refused test does not restart the cooldown', () => {
    const { clock, cooldown } = withClock();
    cooldown.take(1);
    clock.at += 3000;
    assert.equal(cooldown.take(1), 2000);
    clock.at += 2000;
    assert.equal(cooldown.take(1), 0, 'still 5 s from the test that went through, not from the refused one');
  });

  test('each streamer has their own cooldown, shared by all of that streamer\'s test buttons', () => {
    const { cooldown } = withClock();
    assert.equal(cooldown.take(1), 0);
    assert.equal(cooldown.take(2), 0, 'another streamer is not held up');
    assert.ok(cooldown.take(1) > 0);
    assert.ok(cooldown.take(2) > 0);
  });

  test('the sweeper forgets streamers whose cooldown is over, and keeps the others', () => {
    const { clock, cooldown } = withClock();
    cooldown.take(1);
    clock.at += 3000;
    cooldown.take(2);
    assert.equal(cooldown.size, 2);
    clock.at += 2000; // streamer 1: 5000 ms ago, streamer 2: 2000 ms ago
    cooldown.sweep();
    assert.equal(cooldown.size, 1);
    assert.ok(cooldown.take(2) > 0, 'streamer 2 is still cooling down');
    assert.equal(cooldown.take(1), 0, 'streamer 1 starts fresh');
    clock.at += 5000;
    cooldown.sweep();
    assert.equal(cooldown.size, 0);
  });

  test('the shared instance works on the real clock', () => {
    const streamerId = `real-clock-${process.pid}`;
    assert.equal(testCooldown.take(streamerId), 0);
    const wait = testCooldown.take(streamerId);
    assert.ok(wait > 0 && wait <= TEST_COOLDOWN_MS, String(wait));
    testCooldown.sweep(); // nothing is due yet
    assert.ok(testCooldown.size >= 1);
  });
});
