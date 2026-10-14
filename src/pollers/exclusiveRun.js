'use strict';

// A poller whose previous run is still going when its next tick fires must not
// start a second run: two overlapping runs read the same stored state and both
// post the same go-live message.
//
// exclusiveRun(name, task) returns a function that calls task(...args) unless
// the previous call has not finished yet; then that tick is skipped.
//
// A run that never finishes (a call that hangs) must not silence the poller for
// good, so once a run is older than maxRunMs a new run may start. Whatever the
// old run still does afterwards is no longer counted as the current run.
// A run that throws is logged, so a timer never ends in an unhandled rejection.

const DEFAULT_MAX_RUN_MS = 15 * 60 * 1000;

const seconds = (ms) => Math.round(ms / 1000);

function exclusiveRun(name, task, { maxRunMs = DEFAULT_MAX_RUN_MS, now = Date.now, log = console } = {}) {
  let current = null; // the run in progress: { startedAt, skipped }

  return async function exclusive(...args) {
    const startedAt = now();
    if (current) {
      const age = startedAt - current.startedAt;
      if (age < maxRunMs) {
        current.skipped += 1;
        // Once per run: a run that hangs would otherwise log every tick.
        if (current.skipped === 1) log.warn(`[${name}] The previous run is still going after ${seconds(age)} s; skipping this tick`);
        return undefined;
      }
      log.error(`[${name}] The previous run has not finished after ${seconds(age)} s; starting a new one`);
    }

    const run = { startedAt, skipped: 0 };
    current = run;
    try {
      return await task(...args);
    } catch (error) {
      log.error(`[${name}] Run failed: ${error && error.message ? error.message : error}`);
      return undefined;
    } finally {
      if (current === run) current = null;
      if (run.skipped > 0) log.warn(`[${name}] Run finished after ${seconds(now() - startedAt)} s; ${run.skipped} tick(s) were skipped meanwhile`);
    }
  };
}

module.exports = { exclusiveRun, DEFAULT_MAX_RUN_MS };
