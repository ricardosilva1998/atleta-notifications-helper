'use strict';

// The time window a follower or sub goal counts in. A goal has a period
// (lifetime, a year, month, week or day, or a number of hours from its start)
// and, for the year/month/week/day periods, a mode: `calendar` (the local
// period that contains now, in the goal's own IANA time zone, weeks starting
// on Monday) or `rolling` (the last 365/30/7/1 days up to now). Pure: the clock
// is passed in, nothing is stored. Time zones come from Intl (Node's full ICU),
// so no dependency is needed.

const PERIODS = ['lifetime', 'year', 'month', 'week', 'day', 'hours'];
const MODES = ['calendar', 'rolling'];
const ROLLING_DAYS = { year: 365, month: 30, week: 7, day: 1 };

const DAY_MS = 86400e3;
const HOUR_MS = 3600e3;

// One formatter per zone (building one is the slow part), kept under the
// zone's canonical name (Intl's: 'europe/lisbon' is Europe/Lisbon, US/Pacific
// is America/Los_Angeles), so it holds at most the IANA list however a name is
// spelled. A name that is not canonical costs one probe each time it is asked.
const formatters = new Map();

function buildFormatter(timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
}

// Throws (RangeError) for a name Intl does not know.
function formatterFor(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
    f = formatters.get(canonical);
    if (!f) {
      f = buildFormatter(canonical);
      formatters.set(canonical, f);
    }
  }
  return f;
}

// The zone's canonical name, or null when Intl does not know it (or none is given).
function canonicalTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return null;
  try {
    return formatterFor(tz).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

// Whether Intl accepts the name (IANA names such as Europe/Lisbon, and UTC).
function isTimeZone(tz) {
  return canonicalTimeZone(tz) !== null;
}

// The zones the formatters are kept for (for the tests).
function formatterZones() {
  return [...formatters.keys()];
}

// The zone's offset from UTC at an instant, in ms (east of UTC is positive).
function offsetAt(ms, timeZone) {
  const parts = {};
  for (const p of formatterFor(timeZone).formatToParts(new Date(ms))) parts[p.type] = Number(p.value);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// The local calendar date (year, month 1-12, day) at an instant in the zone.
function localDate(ms, timeZone) {
  const parts = {};
  for (const p of formatterFor(timeZone).formatToParts(new Date(ms))) parts[p.type] = Number(p.value);
  return { y: parts.year, m: parts.month, d: parts.day };
}

// The UTC instant of local 00:00 on a date in the zone. The zone's offset on
// the day before and the day after are the only ones that can apply (a day has
// at most one change); each gives a candidate instant, valid when the zone
// really has that offset there. Midnight that happens twice (clocks go back)
// takes the earlier one; midnight that never happens (clocks jump over it,
// as in Azores, Havana, Santiago) is the instant of the jump, where the day
// really begins. `d` may run past the month's end (or below 1); Date.UTC
// rolls it over.
function localMidnight(y, m, d, timeZone) {
  const wall = Date.UTC(y, m - 1, d);
  const before = offsetAt(wall - DAY_MS, timeZone);
  const after = offsetAt(wall + DAY_MS, timeZone);
  let earliest = null;
  for (const offset of new Set([before, after])) {
    const candidate = wall - offset;
    if (offsetAt(candidate, timeZone) === offset && (earliest === null || candidate < earliest)) earliest = candidate;
  }
  return earliest === null ? wall - before : earliest;
}

function calendarWindow(period, now, timeZone) {
  const { y, m, d } = localDate(+now, timeZone);
  let first;
  let next;
  if (period === 'year') {
    first = [y, 1, 1];
    next = [y + 1, 1, 1];
  } else if (period === 'month') {
    first = [y, m, 1];
    next = [y, m + 1, 1];
  } else if (period === 'week') {
    const sinceMonday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    first = [y, m, d - sinceMonday];
    next = [y, m, d - sinceMonday + 7];
  } else {
    first = [y, m, d];
    next = [y, m, d + 1];
  }
  return {
    start: new Date(localMidnight(...first, timeZone)),
    end: new Date(localMidnight(...next, timeZone)),
  };
}

// started_at arrives as a Date, an ISO string, or SQLite's 'YYYY-MM-DD HH:MM:SS'
// (UTC, no zone marker).
function parseStartedAt(value) {
  if (value instanceof Date) return value;
  if (typeof value !== 'string') return new Date(NaN);
  const text = value.trim();
  const sqlite = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(text);
  return new Date(sqlite ? `${sqlite[1]}T${sqlite[2]}Z` : text);
}

// goal: { period, mode, time_zone, hours, started_at }. { start, end } are Dates,
// or both null for a lifetime goal (no window). Throws a RangeError for a goal
// that cannot be read (unknown period or zone, an hours goal with no usable
// start or length) rather than silently counting everything.
function windowFor(goal, now) {
  const { period } = goal;
  if (!PERIODS.includes(period)) throw new RangeError(`unknown goal period: ${period}`);
  if (period === 'lifetime') return { start: null, end: null };

  if (period === 'hours') {
    const start = parseStartedAt(goal.started_at);
    const hours = Number(goal.hours);
    if (Number.isNaN(+start)) throw new RangeError('an hours goal needs a readable started_at');
    if (!Number.isFinite(hours) || hours <= 0) throw new RangeError('an hours goal needs hours above 0');
    return { start, end: new Date(+start + hours * HOUR_MS) };
  }

  if (goal.mode === 'rolling') {
    return { start: new Date(+now - ROLLING_DAYS[period] * DAY_MS), end: new Date(+now) };
  }

  const timeZone = goal.time_zone || 'UTC';
  if (!isTimeZone(timeZone)) throw new RangeError(`unknown time zone: ${timeZone}`);
  return calendarWindow(period, now, timeZone);
}

// When a goal next resets: the end of its calendar period or of its hours.
// Rolling and lifetime goals never reset on a date.
function nextRollover(goal, now) {
  if (goal.period === 'hours' || (goal.period !== 'lifetime' && goal.mode !== 'rolling')) {
    return windowFor(goal, now).end;
  }
  return null;
}

module.exports = { PERIODS, MODES, ROLLING_DAYS, isTimeZone, canonicalTimeZone, formatterZones, windowFor, nextRollover };
