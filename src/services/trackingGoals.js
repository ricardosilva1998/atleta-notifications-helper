'use strict';

// Follower and sub goals — one active goal per streamer and kind ('follow', 'sub'), each drawn as a progress bar in
// its own OBS browser source and told about changes on its own bus channel, `trackgoal:<streamerId>:<kind>` (never
// `overlay:<id>`: the alert overlay would queue it as a card).
//
// What a goal counts depends on its period (services/goalPeriods.js):
//   lifetime  the channel's total from Twitch (followers; current subs, the broadcaster's own included, as the
//             milestones read it), plus the follows and the new and gifted subs recorded since that read, plus the
//             streamer's nudge. The total is read when the goal starts and again at most every 10 minutes while one
//             of the goal's sources is open; a read Twitch does not answer keeps the last total.
//   year, month, week, day (calendar or rolling), hours
//             the follows (each viewer once) or the subs (new, gifted, resubs; a gift of 5 is 5) in Atleta's record
//             (tracking_events) inside the goal's window, plus the nudge. A follower goal of a year, month, week or
//             day reads back from Twitch the follows of its window that the record lacks — in the background when it
//             starts, again at most every 30 minutes while one of its sources is open, and after each calendar
//             rollover — at most 50 pages; past that the goal says `capped` while its window reaches back before
//             its start. Subs cannot be read back.
// A calendar goal that reaches the end of its period writes it to the finished periods (reached or missed) and starts
// over with the same target (the minute tick); an hours goal ends at its end time. A goal is reached once: the first
// time its count passes the target it is stamped (completed_at) and the sources celebrate (justCompleted); after that
// the bar stays full, except a rolling goal's, which follows its count while staying reached, until an edit changes
// the target. A goal whose Twitch read says the token lacks the scope, or that the channel has no subs, shows that
// (`unavailable`) instead of a number.
//
// The database and Twitch are handed in (createTrackingGoals), so the unit tests run this on an in-memory database
// with Twitch stubbed and a clock of their own; the app's instance requires them when first used.

const { PERIODS, MODES, ROLLING_DAYS, isTimeZone, windowFor } = require('./goalPeriods');
const bus = require('./overlayBus');

const KINDS = ['follow', 'sub'];
const COUNTED_PERIODS = Object.keys(ROLLING_DAYS); // the periods with a calendar or rolling mode
const TITLE_MAX = 60;
const TARGET_MAX = 10000000;
const HOURS_MAX = 720;
const DEFAULT_COLOR = '#22c55e';
const READ_EVERY_MS = 10 * 60 * 1000; // a lifetime goal's total
const READBACK_EVERY_MS = 30 * 60 * 1000; // a period follower goal's read-back
const READBACK_PAGES = 50; // 100 followers a page: 5,000 followers
const MAX_ROLLS = 400; // periods written in one tick for a goal (a daily goal after a long stop)
const TEST_REVERT_MS = 10000;
const TICK_EVERY_MS = 60 * 1000; // the minute tick (startTicks)
const TEST_SAMPLE_TARGET = 10;
const TEST_ADDED_MAX = 1000;
const LIFETIME_SUB_TYPES = ['new', 'gift']; // a resub is already in Twitch's total
const PERIOD_SUB_TYPES = ['new', 'gift', 'resub'];
const UNAVAILABLE = new Set(['needs_reconnect', 'not_affiliate']);

function channel(streamerId, kind) {
  return `trackgoal:${streamerId}:${kind}`;
}

const round2 = (n) => Math.round(n * 100) / 100;
const hasCountedPeriod = (goal) => COUNTED_PERIODS.includes(goal.period);
const isCalendar = (goal) => hasCountedPeriod(goal) && goal.mode !== 'rolling';
const isRolling = (goal) => hasCountedPeriod(goal) && goal.mode === 'rolling';
// A follower goal of a year, month, week or day reads back the follows of its window from Twitch.
const readsBack = (goal) => goal.kind === 'follow' && hasCountedPeriod(goal);

// A whole number typed as a number or as digits; anything else is NaN.
function wholeNumber(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : NaN;
  if (typeof value === 'string' && /^\s*\d+\s*$/.test(value)) return Number(value);
  return NaN;
}

const pick = (body, ...names) => {
  for (const name of names) if (body[name] !== undefined) return body[name];
  return undefined;
};

// The title, target and colour of a goal (camelCase or column names), checked as parseGoalFields and
// parseGoalEdit share them. `color` is null when none was sent.
function parseLook(b) {
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (!title || title.length > TITLE_MAX) return { error: 'bad_title' };

  const target = wholeNumber(b.target);
  if (!Number.isInteger(target) || target < 1 || target > TARGET_MAX) return { error: 'bad_target' };

  let color = pick(b, 'barColor', 'bar_color', 'color');
  if (color === undefined || color === null || color === '') color = null;
  else if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return { error: 'bad_color' };
  return { title, target, color };
}

// A goal as the Tracking page sends it (camelCase or column names): { ok: true, fields } with the column names
// createTrackingGoal takes, or { ok: false, error } with the first thing that is wrong. A calendar goal needs an IANA
// time zone; a rolling, lifetime or hours goal keeps none, and a lifetime or hours goal no mode.
function parseGoalFields(body) {
  const b = body && typeof body === 'object' ? body : {};
  const look = parseLook(b);
  if (look.error) return { ok: false, error: look.error };

  const period = b.period;
  if (!PERIODS.includes(period)) return { ok: false, error: 'bad_period' };

  let mode = 'calendar';
  let hours = null;
  let timeZone = null;
  if (COUNTED_PERIODS.includes(period)) {
    if (b.mode !== undefined && b.mode !== null && b.mode !== '') mode = b.mode;
    if (!MODES.includes(mode)) return { ok: false, error: 'bad_mode' };
    if (mode === 'calendar') {
      timeZone = pick(b, 'timeZone', 'time_zone');
      if (!isTimeZone(timeZone)) return { ok: false, error: 'bad_zone' };
    }
  } else if (period === 'hours') {
    hours = wholeNumber(b.hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > HOURS_MAX) return { ok: false, error: 'bad_hours' };
  }
  return {
    ok: true,
    fields: { title: look.title, target: look.target, bar_color: look.color || DEFAULT_COLOR, period, mode, hours, time_zone: timeZone },
  };
}

// An edit of the active goal: title and target (required) and colour (kept when none is sent), with
// parseGoalFields's rules and error codes. { ok: true, fields: { title, target, bar_color|null } } or { ok: false, error }.
function parseGoalEdit(body) {
  const look = parseLook(body && typeof body === 'object' ? body : {});
  if (look.error) return { ok: false, error: look.error };
  return { ok: true, fields: { title: look.title, target: look.target, bar_color: look.color } };
}

// A time from the database (SQLite's 'YYYY-MM-DD HH:MM:SS', UTC) or a Date; null for nothing or no time.
function toDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value;
  const sqlite = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)$/.exec(String(value));
  const date = new Date(sqlite ? `${sqlite[1]}T${sqlite[2]}Z` : value);
  return Number.isNaN(+date) ? null : date;
}

function createTrackingGoals({ db, twitch, emit, now = Date.now, logger = console }) {
  const sources = new Map(); // `${streamerId}:${kind}` → how many of the goal's OBS sources are open
  const triedAt = new Map(); // goal id → when its last Twitch read was tried (ms on this module's clock)
  const reading = new Set(); // goal ids with a Twitch read under way
  const failing = new Set(); // `${streamerId}:${kind}` whose last Twitch read got no answer (logged once)
  const testTimers = new Map(); // `${streamerId}:${kind}` → the timer that reverts a test
  let tickTimer = null; // the minute tick, while startTicks has started it

  const clock = () => new Date(now());
  const keyOf = (streamerId, kind) => `${Number(streamerId)}:${kind}`;

  // The window a goal counts in now: [start, end), end null for "up to now" (a rolling window ends now, and nothing
  // is recorded later than now). A calendar goal counts in the period its period_start names, so until the tick rolls
  // it over, a period that just ended keeps its count, nudge and celebration together. Null for a lifetime goal.
  function countWindow(goal, at) {
    if (goal.period === 'lifetime') return null;
    if (goal.period === 'hours') return windowFor(goal, at);
    if (isRolling(goal)) return { start: windowFor(goal, at).start, end: null };
    return windowFor(goal, toDate(goal.period_start) || at);
  }

  // What the record (and, for a lifetime goal, Twitch's last total) gives, before the nudge.
  function recordCount(goal, at) {
    const subTypes = goal.kind === 'sub' ? (goal.period === 'lifetime' ? LIFETIME_SUB_TYPES : PERIOD_SUB_TYPES) : undefined;
    if (goal.period === 'lifetime') {
      return (Number(goal.lifetime_total) || 0)
        + db.countTrackingEvents(goal.streamer_id, goal.kind, goal.lifetime_read_at || null, null, { subTypes });
    }
    const w = countWindow(goal, at);
    return db.countTrackingEvents(goal.streamer_id, goal.kind, w.start, w.end, { subTypes });
  }

  // The number the bar shows: the count plus the nudge, never below 0. A goal whose stored period or time zone
  // cannot be read (parseGoalFields lets none through) counts only its nudge rather than everything.
  function shownCount(goal, at) {
    let base = 0;
    try {
      base = recordCount(goal, at);
    } catch (err) {
      logger.error(`[TrackingGoal] Goal ${goal.id} cannot be counted: ${err.message}`);
    }
    return Math.max(0, base + (Number(goal.nudge) || 0));
  }

  function unavailableOf(goal) {
    if (UNAVAILABLE.has(goal.twitch_unavailable)) return goal.twitch_unavailable;
    if (goal.kind === 'sub') {
      const streamer = db.getStreamerById(goal.streamer_id);
      if (streamer && streamer.cp_affiliate_status === 'not_affiliate') return 'not_affiliate';
    }
    return null;
  }

  // Whether the read-back stopped at its cap AND the window still reaches back before the goal started (what came
  // after the start is in Atleta's record: a rolling window that has moved past the start, a later calendar period).
  function cappedNow(goal, at) {
    if (!goal.readback_capped || !readsBack(goal)) return false;
    const started = toDate(goal.started_at);
    if (!started) return true;
    try {
      return +countWindow(goal, at).start < +started;
    } catch {
      return true;
    }
  }

  // The shape the OBS source and the Tracking page get — only what they draw.
  function toPayload(goal, at) {
    const unavailable = unavailableOf(goal);
    const target = Number(goal.target) || 0;
    const completed = !!goal.completed_at;
    const current = unavailable ? null : shownCount(goal, at);
    let percent = 0;
    if (current !== null) {
      percent = completed && !isRolling(goal) ? 100 : (target > 0 ? Math.min(100, round2((current / target) * 100)) : 0);
    }
    return {
      id: goal.id,
      kind: goal.kind,
      title: goal.title,
      current,
      target,
      percent,
      completed,
      barColor: goal.bar_color || DEFAULT_COLOR,
      period: goal.period,
      mode: hasCountedPeriod(goal) ? goal.mode : null,
      unavailable,
      capped: cappedNow(goal, at),
    };
  }

  function progressOf(streamerId, kind) {
    const goal = db.getActiveTrackingGoal(streamerId, kind);
    return goal ? toPayload(goal, clock()) : null;
  }

  // Tells the open sources the goal's state as it is (null: no active goal).
  function broadcast(streamerId, kind, extra) {
    emit(channel(streamerId, kind), { type: 'track_goal', goal: progressOf(streamerId, kind), ...(extra || {}) });
  }

  // After a change to a goal: stamps it reached the first time its count passes the target, then tells the open
  // sources, with `added` (how much the shown count went up, when it did) and `justCompleted`. Returns the payload.
  function settle(goal, added) {
    let payload = progressOf(goal.streamer_id, goal.kind);
    let justCompleted = false;
    if (payload && payload.current !== null && !payload.completed && payload.current >= payload.target
        && db.setTrackingGoalCompleted(payload.id)) {
      justCompleted = true;
      payload = progressOf(goal.streamer_id, goal.kind);
      logger.log(`[TrackingGoal] ${goal.kind} goal "${goal.title}" reached for streamer ${goal.streamer_id}`);
    }
    const message = { type: 'track_goal', goal: payload };
    if (payload && payload.current !== null && added > 0) message.added = added;
    message.justCompleted = justCompleted;
    emit(channel(goal.streamer_id, goal.kind), message);
    return payload;
  }

  // ── Twitch reads ──
  // Each re-reads the streamer row first: a refresh rotates the stored refresh token, so a row read earlier may
  // carry one Twitch no longer accepts.

  // { ok: true, value } or { ok: false, code } with code 'needs_reconnect', 'not_affiliate' or 'twitch_failed'. A
  // read Twitch does not answer is logged once until a read of that goal works again.
  async function ask(streamerId, kind, what, read) {
    const key = keyOf(streamerId, kind);
    try {
      const value = await read(db.getStreamerById(streamerId));
      failing.delete(key);
      return { ok: true, value };
    } catch (err) {
      const code = err && UNAVAILABLE.has(err.code) ? err.code : 'twitch_failed';
      if (code === 'twitch_failed' && !failing.has(key)) {
        failing.add(key);
        logger.warn(`[TrackingGoal] ${what} for streamer ${streamerId}: Twitch did not answer (${err && err.message}); keeping what was there`);
      }
      return { ok: false, code };
    }
  }

  const readTotal = (streamerId, kind) => ask(streamerId, kind, `${kind} total`,
    (streamer) => (kind === 'follow' ? twitch.followerTotal(streamer) : twitch.subscriberTotal(streamer)));

  // Reads back the follows of the goal's window and writes the ones the record lacks. Returns the goal's new Twitch
  // state for setTrackingGoalTwitchState, or null when Twitch did not answer (nothing changes; it is tried again).
  async function readBack(streamerId, goal, at) {
    const since = countWindow(goal, at).start;
    const result = await ask(streamerId, 'follow', 'Follower read-back',
      (streamer) => twitch.followersSince(streamer, since.toISOString(), READBACK_PAGES));
    if (result.ok) {
      const { followers, complete } = result.value || {};
      const written = db.backfillTrackingFollows(streamerId, followers, since);
      if (written) logger.log(`[TrackingGoal] Read back ${written} follows for streamer ${streamerId}${complete ? '' : ' (capped)'}`);
      return { unavailable: null, readbackAt: at, capped: !complete };
    }
    return result.code === 'twitch_failed' ? null : { unavailable: result.code };
  }

  function noteUnavailable(goal, code) {
    if (code && goal.twitch_unavailable !== code) {
      logger.log(`[TrackingGoal] ${goal.kind} goal of streamer ${goal.streamer_id}: ${code}`);
    }
  }

  // ── Lifecycle ──

  // Starts a goal of this kind (ending the active one). A lifetime goal reads the Twitch total first (one request): a
  // token without the scope or a channel without subs starts it showing that, while a read Twitch does not answer
  // refuses the start (rejects with code 'twitch_failed') and leaves the active goal as it was. A follower goal of a
  // year, month, week or day starts at once from the record and reads back the follows of its window in the
  // background. `fields` come from parseGoalFields. Resolves to the payload.
  async function startGoal(streamer, kind, fields) {
    if (!KINDS.includes(kind)) throw new Error(`unknown goal kind: ${kind}`);
    const streamerId = streamer.id;
    const at = clock();
    const draft = { ...fields, kind, started_at: at };
    if (isCalendar(draft)) draft.period_start = windowFor(draft, at).start;

    const goalFields = { ...fields, period_start: draft.period_start || null };
    let state = null;
    if (fields.period === 'lifetime') {
      const result = await readTotal(streamerId, kind);
      if (result.ok) {
        goalFields.lifetime_total = Number(result.value) || 0;
      } else if (result.code === 'twitch_failed') {
        const err = new Error('Twitch did not answer');
        err.code = 'twitch_failed';
        throw err;
      } else {
        state = { unavailable: result.code };
      }
    }

    const goal = db.createTrackingGoal(streamerId, kind, goalFields);
    if (state) {
      db.setTrackingGoalTwitchState(goal.id, state);
      noteUnavailable(goal, state.unavailable);
    }
    triedAt.set(goal.id, +at);
    const payload = settle(goal);
    // The read-back can take up to 50 requests: the goal counts from the record at once, and its sources get the
    // new count when the read-back is done.
    if (readsBack(goal)) refreshFromTwitch(goal, at);
    return payload;
  }

  // Writes a follow or a sub to the record (whether or not a goal is active: the stream report reads it too) and,
  // while a goal of that kind is active, tells its sources what changed. Never throws.
  function recordEvent(streamerId, kind, ev) {
    try {
      if (!KINDS.includes(kind)) return;
      const e = ev || {};
      const goal = db.getActiveTrackingGoal(streamerId, kind);
      const at = clock();
      const before = goal ? shownCount(goal, at) : 0;
      db.recordTrackingEvent(streamerId, { kind, subType: e.subType, twitchUserId: e.twitchUserId, username: e.username, count: e.count });
      if (!goal) return;
      settle(goal, shownCount(goal, at) - before);
    } catch (err) {
      logger.error('[TrackingGoal] recordEvent error:', err.message);
    }
  }

  // Changes the active goal's title, target and colour (the colour stays when none is sent; the period cannot
  // change). `body` is checked with parseGoalEdit. { ok: true, goal: payload } or { ok: false, error } with
  // parseGoalEdit's codes or 'not_found' (no active goal of that kind).
  function editGoal(streamerId, kind, body) {
    const parsed = parseGoalEdit(body);
    if (!parsed.ok) return parsed;
    const goal = db.getActiveTrackingGoal(streamerId, kind);
    if (!goal) return { ok: false, error: 'not_found' };
    const { title, target, bar_color: color } = parsed.fields;
    db.updateTrackingGoal(goal.id, streamerId, { title, target, bar_color: color || goal.bar_color });
    return { ok: true, goal: settle(goal) };
  }

  // Moves the shown count by a whole number (a calendar goal's current period only); never below 0. Null for no
  // active goal or a step that is not a whole number other than 0.
  function nudgeGoal(streamerId, kind, delta) {
    const step = Number(delta);
    if (!Number.isInteger(step) || step === 0 || Math.abs(step) > TARGET_MAX) return null;
    const goal = db.getActiveTrackingGoal(streamerId, kind);
    if (!goal) return null;
    const at = clock();
    const before = shownCount(goal, at);
    const row = db.nudgeTrackingGoal(goal.id, streamerId, step, before);
    if (!row) return null;
    return settle(row, shownCount(row, at) - before);
  }

  function endGoal(streamerId, kind) {
    const goal = db.getActiveTrackingGoal(streamerId, kind);
    if (!goal) return false;
    const ended = db.endTrackingGoal(goal.id, streamerId).changes > 0;
    broadcast(streamerId, kind);
    return ended;
  }

  // ── The minute tick ──

  // Writes every period of a calendar goal that ended by `at` and starts the next. Returns the goal row after its
  // last rollover, or null when none was due.
  function rollIfDue(goal, at) {
    let row = goal;
    let rolled = false;
    for (let i = 0; i < MAX_ROLLS; i++) {
      const w = countWindow(row, at);
      if (+at < +w.end) break;
      const count = shownCount(row, at);
      const next = db.rollTrackingGoal(row.id, {
        periodStart: w.start, periodEnd: w.end, count, target: row.target, reached: count >= row.target, nextStart: w.end,
      });
      if (!next) break;
      row = next;
      rolled = true;
    }
    if (!rolled) return null;
    // A follower goal reads back its new period as soon as one of its sources is open (follows around the rollover
    // that EventSub missed).
    if (readsBack(row)) {
      db.setTrackingGoalTwitchState(row.id, { readbackAt: null, capped: false });
      triedAt.delete(row.id);
      row = db.getActiveTrackingGoal(row.streamer_id, row.kind) || row;
    }
    return row;
  }

  // Whether the goal should ask Twitch now: one of its sources is open, nothing is being read, and it has something
  // to read — a lifetime total last read (or tried) 10 minutes ago or more, or a follower read-back last done (or
  // tried) 30 minutes ago or more; right after a calendar rollover the read-back is due at once.
  function readDue(goal, at) {
    if (!sources.get(keyOf(goal.streamer_id, goal.kind)) || reading.has(goal.id)) return false;
    let every;
    let doneAt;
    if (goal.period === 'lifetime') {
      every = READ_EVERY_MS;
      doneAt = toDate(goal.lifetime_read_at);
    } else if (readsBack(goal)) {
      every = READBACK_EVERY_MS;
      doneAt = toDate(goal.readback_at);
    } else {
      return false;
    }
    const last = Math.max(triedAt.get(goal.id) || 0, doneAt ? +doneAt : 0);
    return +at - last >= every;
  }

  // Resolves true when Twitch answered (with a number, or with why there is none), false when it did not.
  async function refreshFromTwitch(goal, at) {
    reading.add(goal.id);
    triedAt.set(goal.id, +at);
    try {
      let state;
      if (goal.period === 'lifetime') {
        const result = await readTotal(goal.streamer_id, goal.kind);
        if (result.ok) {
          db.setTrackingGoalLifetime(goal.id, Number(result.value) || 0);
          state = { unavailable: null };
        } else if (result.code !== 'twitch_failed') {
          state = { unavailable: result.code };
        }
      } else {
        state = await readBack(goal.streamer_id, goal, at);
      }
      if (state) {
        db.setTrackingGoalTwitchState(goal.id, state);
        noteUnavailable(goal, state.unavailable);
      }
      const fresh = db.getActiveTrackingGoal(goal.streamer_id, goal.kind);
      if (fresh && fresh.id === goal.id) settle(fresh);
      return !!state;
    } catch (err) {
      logger.error(`[TrackingGoal] Twitch read for goal ${goal.id} failed: ${err.message}`);
      return false;
    } finally {
      reading.delete(goal.id);
    }
  }

  // Every minute: ends hours goals past their end, rolls calendar goals past their period, and re-reads Twitch for
  // goals whose sources are open (see readDue). Resolves when the reads it started are done.
  async function tick(when) {
    const at = when == null ? clock() : new Date(when);
    let goals;
    try {
      goals = db.getActiveTrackingGoals();
    } catch (err) {
      logger.error('[TrackingGoal] tick error:', err.message);
      return;
    }
    const active = new Set(goals.map((g) => g.id));
    const activeKeys = new Set(goals.map((g) => keyOf(g.streamer_id, g.kind)));
    for (const id of triedAt.keys()) if (!active.has(id)) triedAt.delete(id);
    for (const key of failing) if (!activeKeys.has(key)) failing.delete(key);

    const reads = [];
    for (const goal of goals) {
      try {
        if (goal.period === 'hours') {
          if (+at >= +windowFor(goal, at).end && db.endTrackingGoal(goal.id, goal.streamer_id).changes > 0) {
            logger.log(`[TrackingGoal] ${goal.kind} goal "${goal.title}" of streamer ${goal.streamer_id} ended (its hours are over)`);
            broadcast(goal.streamer_id, goal.kind);
          }
          continue;
        }
        let row = goal;
        if (isCalendar(goal)) {
          const rolled = rollIfDue(goal, at);
          if (rolled) {
            row = rolled;
            settle(row);
          }
        }
        if (readDue(row, at)) reads.push(refreshFromTwitch(row, at));
      } catch (err) {
        logger.error(`[TrackingGoal] tick error for goal ${goal.id}:`, err.message);
      }
    }
    await Promise.all(reads);
  }

  // The minute tick, from boot (src/index.js) until shutdown. One timer however often it is started; it never holds
  // the process open, and a tick that fails is logged, never thrown.
  function startTicks() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      tick().catch((err) => logger.error('[TrackingGoal] tick error:', err && err.message));
    }, TICK_EVERY_MS);
    if (typeof tickTimer.unref === 'function') tickTimer.unref();
  }

  function stopTicks() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
  }

  // After the streamer authorized Twitch again (the broadcaster callback in routes/auth.js, once the new scopes are
  // stored): each of the streamer's active goals that reads Twitch — a lifetime total, a period follower goal's
  // read-back — reads it now, whatever was tried lately and whether or not one of its sources is open, so a goal
  // that showed "Reconnect Twitch" shows its number as soon as Twitch answers. Twitch's answer sets the goal's state
  // (an answer with a number clears the unavailable one); a read Twitch does not answer leaves the goal as it was
  // (never a lifetime count without its total) and is tried again on the next tick while a source is open. A read
  // already under way is left to finish. Resolves when the reads are done; never rejects.
  async function recheck(streamerId) {
    const at = clock();
    const reads = [];
    for (const kind of KINDS) {
      try {
        const goal = db.getActiveTrackingGoal(streamerId, kind);
        if (!goal || reading.has(goal.id) || !(goal.period === 'lifetime' || readsBack(goal))) continue;
        reads.push(refreshFromTwitch(goal, at).then((answered) => { if (!answered) triedAt.delete(goal.id); }));
      } catch (err) {
        logger.error(`[TrackingGoal] recheck error for streamer ${streamerId}:`, err.message);
      }
    }
    await Promise.all(reads);
  }

  // An OBS source of the goal opened (+1) or closed (-1). Never below 0; a streamer and kind with none is forgotten.
  function connected(streamerId, kind, delta) {
    const key = keyOf(streamerId, kind);
    const n = Math.max(0, (sources.get(key) || 0) + (Math.trunc(Number(delta)) || 0));
    if (n) sources.set(key, n);
    else sources.delete(key);
    return n;
  }

  // ── Test mode (the Tracking page's test buttons) ──
  // Shows a simulated state on the live bar without touching the database, then reverts to the real state after
  // 10 s, so a forgotten test never leaves fake numbers on stream. `added` (1–1000, default 1) adds to the real count,
  // or `share` that part of the target (at least 1, at most 1000); `reach` fills the bar and celebrates. Without an
  // active goal a sample bar is drawn (titled `title`), then cleared. Returns the message it emitted (the Tracking page
  // draws the same in its preview), or null for a kind that is not a goal's.

  function sendTest(streamerId, kind, input) {
    if (!KINDS.includes(kind)) return null;
    const i = input || {};
    const base = progressOf(streamerId, kind) || {
      id: 'test', kind, title: String(i.title || '').trim().slice(0, TITLE_MAX), current: 0, target: TEST_SAMPLE_TARGET,
      percent: 0, completed: false, barColor: DEFAULT_COLOR, period: 'lifetime', mode: null, unavailable: null, capped: false,
    };
    const target = base.target > 0 ? base.target : TEST_SAMPLE_TARGET;
    let current;
    let added;
    if (i.reach) {
      current = Math.max(target, base.current || 0);
    } else {
      const share = Number(i.share);
      const n = share > 0 && share <= 1 ? Math.max(1, Math.round(target * share)) : wholeNumber(i.added);
      added = Number.isInteger(n) && n >= 1 ? Math.min(n, TEST_ADDED_MAX) : 1;
      current = (base.current || 0) + added;
    }
    const goal = {
      ...base, current, percent: Math.min(100, round2((current / target) * 100)), completed: base.completed || current >= target, unavailable: null,
    };
    const message = { type: 'track_goal', goal, test: true, justCompleted: !!i.reach };
    if (added) message.added = added;
    emit(channel(streamerId, kind), message);

    const key = keyOf(streamerId, kind);
    clearTimeout(testTimers.get(key));
    const timer = setTimeout(() => { testTimers.delete(key); broadcast(streamerId, kind); }, TEST_REVERT_MS);
    timer.unref();
    testTimers.set(key, timer);
    return message;
  }

  // Drops any test state at once and shows the real goal again.
  function endTest(streamerId, kind) {
    const key = keyOf(streamerId, kind);
    clearTimeout(testTimers.get(key));
    testTimers.delete(key);
    broadcast(streamerId, kind);
  }

  return {
    startGoal, progressOf, broadcast, recordEvent, editGoal, nudgeGoal, endGoal, tick, startTicks, stopTicks, recheck,
    connected, sendTest, endTest,
  };
}

// The app's instance. The database and Twitch are required when first used: they load the app's config, which this
// file's unit tests do without.
let app = null;
function instance() {
  if (!app) {
    app = createTrackingGoals({
      db: require('../db'),
      twitch: require('./twitch'),
      emit: (name, payload) => bus.emit(name, payload),
    });
  }
  return app;
}

module.exports = {
  KINDS,
  channel,
  parseGoalFields,
  parseGoalEdit,
  createTrackingGoals,
  READ_EVERY_MS,
  READBACK_EVERY_MS,
  TEST_REVERT_MS,
  startGoal: (...args) => instance().startGoal(...args),
  progressOf: (...args) => instance().progressOf(...args),
  broadcast: (...args) => instance().broadcast(...args),
  recordEvent: (...args) => instance().recordEvent(...args),
  editGoal: (...args) => instance().editGoal(...args),
  nudgeGoal: (...args) => instance().nudgeGoal(...args),
  endGoal: (...args) => instance().endGoal(...args),
  tick: (...args) => instance().tick(...args),
  startTicks: (...args) => instance().startTicks(...args),
  stopTicks: (...args) => instance().stopTicks(...args),
  recheck: (...args) => instance().recheck(...args),
  connected: (...args) => instance().connected(...args),
  sendTest: (...args) => instance().sendTest(...args),
  endTest: (...args) => instance().endTest(...args),
};
