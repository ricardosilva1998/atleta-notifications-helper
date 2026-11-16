'use strict';

// The coaching minute tick (planning decision 12): unpaid bookings expire (a PayPal order is read back first), stale
// PayPal orders are read back, `making` rooms a restart left are finished or cleaned up, and rooms past their close time
// get their transcripts and are deleted. One run at a time; a step that throws never stops the others, and nothing
// here needs Discord to be up (the room steps wait for it). The first run comes 20 s after boot.

const TICK_MS = 60e3;
const FIRST_MS = 20e3;

let timer = null;
let first = null;
let busy = false;

// `deps` is for the tests; by default the real modules are loaded on first use.
async function runOnce({ now = Date.now(), deps = null } = {}) {
  if (busy) return null;
  busy = true;
  const d = deps || {
    payments: require('./coachingPayments'),
    rooms: require('./coachingRooms'),
  };
  const result = {};
  const step = async (name, fn) => {
    try { result[name] = await fn(); } catch (e) { console.error(`[Coaching] tick step ${name} failed:`, e && e.message); }
  };
  try {
    await step('expire', () => d.payments.expireDue({ now }));
    await step('stale', () => d.payments.reconcileStale({ now }));
    await step('making', () => d.rooms.finishOrCleanMaking({ now }));
    await step('close', () => d.rooms.closeDue({ now }));
  } finally {
    busy = false;
  }
  return result;
}

function startTicks() {
  if (timer) return;
  timer = setInterval(() => { runOnce().catch(() => {}); }, TICK_MS);
  timer.unref();
  first = setTimeout(() => { runOnce().catch(() => {}); }, FIRST_MS);
  first.unref();
}

function stopTicks() {
  if (timer) clearInterval(timer);
  if (first) clearTimeout(first);
  timer = null;
  first = null;
}

module.exports = { runOnce, startTicks, stopTicks, TICK_MS };
