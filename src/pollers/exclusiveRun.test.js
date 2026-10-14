'use strict';

// The exclusive-run guard of the pollers: a tick that fires while the previous
// run is still going is skipped, so two runs never read the same stored state
// and post the same go-live message twice. Runs are held open with promises
// the test settles itself; the clock is a variable. Nothing waits for real time.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { exclusiveRun, DEFAULT_MAX_RUN_MS } = require('./exclusiveRun');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(taskImpl, options = {}) {
  const lines = { warn: [], error: [] };
  const log = { warn: (line) => lines.warn.push(line), error: (line) => lines.error.push(line) };
  let clock = 1_000_000;
  const advance = (ms) => { clock += ms; };
  const calls = [];
  const task = async (...args) => { calls.push(args); return taskImpl ? taskImpl(...args) : undefined; };
  const guarded = exclusiveRun('TestPoller', task, { now: () => clock, log, ...options });
  return { guarded, calls, lines, advance };
}

test('ticks that arrive one after another all run', async () => {
  const { guarded, calls } = setup();
  await guarded();
  await guarded();
  await guarded();
  assert.equal(calls.length, 3);
});

test('a tick while the previous run is still going does not start a second run', async () => {
  const gate = deferred();
  const { guarded, calls } = setup(() => gate.promise);

  const first = guarded();
  await guarded(); // the next tick: skipped at once
  await guarded();
  assert.equal(calls.length, 1, 'only the first run started');

  gate.resolve();
  await first;
});

test('once the run has finished the next tick runs again', async () => {
  const gate = deferred();
  let hold = true;
  const { guarded, calls } = setup(() => (hold ? gate.promise : undefined));

  const first = guarded();
  await guarded();
  assert.equal(calls.length, 1);

  hold = false;
  gate.resolve();
  await first;

  await guarded();
  assert.equal(calls.length, 2, 'the guard was released');
});

test('the skip is reported once per run, with a summary when the run ends', async () => {
  const gate = deferred();
  const { guarded, lines, advance } = setup(() => gate.promise);

  const first = guarded();
  advance(61_000);
  await guarded();
  advance(60_000);
  await guarded();
  await guarded();
  assert.equal(lines.warn.length, 1, 'one line however many ticks were skipped');
  assert.match(lines.warn[0], /\[TestPoller\] The previous run is still going after 61 s; skipping this tick/);

  gate.resolve();
  await first;
  assert.equal(lines.warn.length, 2);
  assert.match(lines.warn[1], /Run finished after 121 s; 3 tick\(s\) were skipped meanwhile/);
});

test('a run that was never held up says nothing', async () => {
  const { guarded, lines } = setup();
  await guarded();
  await guarded();
  assert.deepEqual(lines, { warn: [], error: [] });
});

test('the arguments reach the task and its result comes back', async () => {
  const { guarded, calls } = setup((a, b) => a + b);
  assert.equal(await guarded(2, 3), 5);
  assert.deepEqual(calls, [[2, 3]]);
});

test('a task that throws is logged, never rejected, and does not block the next tick', async () => {
  let fail = true;
  const { guarded, calls, lines } = setup(() => { if (fail) throw new Error('database is locked'); return 'ok'; });

  assert.equal(await guarded(), undefined);
  assert.deepEqual(lines.error, ['[TestPoller] Run failed: database is locked']);

  fail = false;
  assert.equal(await guarded(), 'ok');
  assert.equal(calls.length, 2);
});

test('a run that hangs for good is given up on after maxRunMs, so the poller is not silenced forever', async () => {
  const hung = deferred();
  const second = deferred();
  const third = deferred();
  third.resolve();
  const gates = [hung, second, third];
  const { guarded, calls, lines, advance } = setup(() => gates[calls.length - 1].promise, { maxRunMs: 10 * 60 * 1000 });

  const firstRun = guarded();
  advance(9 * 60 * 1000);
  await guarded();
  assert.equal(calls.length, 1, 'still within maxRunMs: skipped');

  advance(2 * 60 * 1000); // 11 minutes after the first run began
  const secondRun = guarded();
  assert.equal(calls.length, 2, 'the stuck run was abandoned and a new one started');
  assert.ok(lines.error.some((line) => /has not finished after 660 s; starting a new one/.test(line)), lines.error.join('\n'));

  // The abandoned run finally ends. It must not release the lock of the run that replaced it.
  hung.resolve();
  await firstRun;
  await guarded();
  assert.equal(calls.length, 2, 'the new run is still the current one, so this tick is skipped');

  second.resolve();
  await secondRun;
  await guarded();
  assert.equal(calls.length, 3, 'after the current run ends the guard is free again');
});

test('a run that legitimately takes long is not interrupted: the default limit is 15 minutes', async () => {
  assert.equal(DEFAULT_MAX_RUN_MS, 15 * 60 * 1000);
  const gate = deferred();
  const { guarded, calls, advance } = setup(() => gate.promise);
  const first = guarded();
  advance(14 * 60 * 1000);
  await guarded();
  assert.equal(calls.length, 1);
  gate.resolve();
  await first;
});

test('each guard keeps its own run: one poller being busy does not hold up another', async () => {
  const gate = deferred();
  const busy = setup(() => gate.promise);
  const other = setup();

  const first = busy.guarded();
  await other.guarded();
  await other.guarded();
  assert.equal(other.calls.length, 2);
  assert.equal(busy.calls.length, 1);
  gate.resolve();
  await first;
});
