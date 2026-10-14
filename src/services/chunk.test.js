'use strict';

// The batching chunker: Twitch /streams takes 100 logins per request and
// YouTube videos.list 50 ids, so longer lists go out as several requests.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chunk } = require('./chunk');

const numbers = (n) => Array.from({ length: n }, (_, i) => i + 1);

test('an empty list gives no slices', () => {
  assert.deepEqual(chunk([], 100), []);
});

test('a list that fits in one slice stays one slice', () => {
  assert.deepEqual(chunk([1, 2, 3], 100), [[1, 2, 3]]);
  assert.deepEqual(chunk([1, 2, 3], 3), [[1, 2, 3]]);
});

test('the last slice takes what is left', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('size 1 gives one slice per item', () => {
  assert.deepEqual(chunk(['a', 'b', 'c'], 1), [['a'], ['b'], ['c']]);
});

test('Twitch batches: 100 logins are one request, 101 are two, 250 are 100 + 100 + 50', () => {
  assert.deepEqual(chunk(numbers(100), 100).map((s) => s.length), [100]);
  assert.deepEqual(chunk(numbers(101), 100).map((s) => s.length), [100, 1]);
  assert.deepEqual(chunk(numbers(250), 100).map((s) => s.length), [100, 100, 50]);
});

test('YouTube batches: 50 ids are one request, 51 are two, 120 are 50 + 50 + 20', () => {
  assert.deepEqual(chunk(numbers(50), 50).map((s) => s.length), [50]);
  assert.deepEqual(chunk(numbers(51), 50).map((s) => s.length), [50, 1]);
  assert.deepEqual(chunk(numbers(120), 50).map((s) => s.length), [50, 50, 20]);
});

test('every item appears once, in order, and the input is not changed', () => {
  const input = numbers(237);
  const copy = input.slice();
  const slices = chunk(input, 100);
  assert.deepEqual(slices.flat(), copy);
  assert.deepEqual(input, copy);
});

test('a size that is not a number of at least 1 is refused', () => {
  for (const size of [0, -1, NaN, Infinity, undefined, 'x', 0.5]) {
    assert.throws(() => chunk([1, 2, 3], size), RangeError, String(size));
  }
});
