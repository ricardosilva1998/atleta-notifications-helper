'use strict';

// The message-id memory EventSub uses to act on each notification once.
// A fake clock stands in for time.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createMessageDedupe } = require('./messageDedupe');

const TTL = 10 * 60 * 1000;

function withClock() {
  const clock = { t: 0 };
  const dedupe = createMessageDedupe({ ttlMs: TTL, now: () => clock.t });
  return { clock, dedupe };
}

describe('createMessageDedupe', () => {
  test('an id is new the first time and a repeat after that', () => {
    const { dedupe } = withClock();
    assert.equal(dedupe.isRepeat('msg-1'), false);
    assert.equal(dedupe.isRepeat('msg-1'), true);
    assert.equal(dedupe.isRepeat('msg-1'), true);
  });

  test('a repeat is recognised for the whole TTL; once it has passed the id is new again', () => {
    const { clock, dedupe } = withClock();
    assert.equal(dedupe.isRepeat('msg-1'), false);
    clock.t = TTL - 1;
    assert.equal(dedupe.isRepeat('msg-1'), true, 'still within the TTL');
    clock.t = TTL;
    assert.equal(dedupe.isRepeat('msg-1'), false, 'the TTL has passed');
    clock.t = TTL + 1;
    assert.equal(dedupe.isRepeat('msg-1'), true, 'remembered again from its new first sighting');
  });

  test('a repeat does not extend how long the id is remembered', () => {
    const { clock, dedupe } = withClock();
    dedupe.isRepeat('msg-1');
    clock.t = TTL - 1;
    dedupe.isRepeat('msg-1');
    clock.t = TTL;
    assert.equal(dedupe.isRepeat('msg-1'), false);
  });

  test('ids are independent', () => {
    const { dedupe } = withClock();
    assert.equal(dedupe.isRepeat('msg-1'), false);
    assert.equal(dedupe.isRepeat('msg-2'), false);
    assert.equal(dedupe.isRepeat('msg-2'), true);
  });

  test('a message without an id is never a repeat and is not remembered', () => {
    const { dedupe } = withClock();
    for (const id of [undefined, null, '']) {
      assert.equal(dedupe.isRepeat(id), false);
      assert.equal(dedupe.isRepeat(id), false);
    }
    assert.equal(dedupe.size, 0);
  });

  test('sweep forgets ids older than the TTL and keeps the rest', () => {
    const { clock, dedupe } = withClock();
    dedupe.isRepeat('old');
    clock.t = 5 * 60 * 1000;
    dedupe.isRepeat('recent');
    clock.t = TTL;
    dedupe.sweep();
    assert.equal(dedupe.size, 1);
    assert.equal(dedupe.isRepeat('recent'), true, 'kept');
    assert.equal(dedupe.isRepeat('old'), false, 'forgotten');
  });
});
