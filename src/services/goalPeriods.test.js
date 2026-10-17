'use strict';

// Period windows for follower and sub goals: lifetime, the last N hours since a
// start, a rolling number of days, or the calendar year/month/week/day in the
// goal's own IANA time zone. Pure: the clock is always passed in.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('./goalPeriods');

const iso = (d) => d.toISOString();

test('a calendar month in Lisbon starts and ends at local midnight', () => {
  const w = P.windowFor({ period: 'month', mode: 'calendar', time_zone: 'Europe/Lisbon' }, new Date('2026-10-16T12:00:00Z'));
  assert.equal(iso(w.start), '2026-09-30T23:00:00.000Z'); // Oct 1, 00:00 WEST
  assert.equal(iso(w.end), '2026-11-01T00:00:00.000Z');   // Nov 1, 00:00 WET
});

test('a calendar week starts on Monday', () => {
  const w = P.windowFor({ period: 'week', mode: 'calendar', time_zone: 'UTC' }, new Date('2026-10-15T10:00:00Z'));
  assert.equal(iso(w.start), '2026-10-12T00:00:00.000Z');
  assert.equal(iso(w.end), '2026-10-19T00:00:00.000Z');
});

test('a Sunday still belongs to the week that began on the Monday before', () => {
  const w = P.windowFor({ period: 'week', mode: 'calendar', time_zone: 'UTC' }, new Date('2026-10-18T23:59:59Z'));
  assert.equal(iso(w.start), '2026-10-12T00:00:00.000Z');
  assert.equal(iso(w.end), '2026-10-19T00:00:00.000Z');
});

test('Los Angeles, 23:59 on Oct 31 is still October', () => {
  const w = P.windowFor({ period: 'month', mode: 'calendar', time_zone: 'America/Los_Angeles' }, new Date('2026-11-01T06:59:00Z'));
  assert.equal(iso(w.start), '2026-10-01T07:00:00.000Z');
  assert.equal(iso(w.end), '2026-11-01T07:00:00.000Z'); // Nov 1, 00:00 PDT; the clocks go back later that day
});

test('the instant the local month turns over belongs to the next month', () => {
  const tz = 'America/Los_Angeles';
  const before = P.windowFor({ period: 'month', mode: 'calendar', time_zone: tz }, new Date('2026-11-01T06:59:59Z'));
  const after = P.windowFor({ period: 'month', mode: 'calendar', time_zone: tz }, new Date('2026-11-01T07:00:00Z'));
  assert.equal(iso(before.start), '2026-10-01T07:00:00.000Z');
  assert.equal(iso(after.start), '2026-11-01T07:00:00.000Z');
  assert.equal(+before.end, +after.start);
});

test('the day the clocks go back lasts 25 hours', () => {
  const w = P.windowFor({ period: 'day', mode: 'calendar', time_zone: 'Europe/Lisbon' }, new Date('2026-10-25T12:00:00Z'));
  assert.equal(w.end - w.start, 25 * 3600e3);
});

test('the day the clocks go forward lasts 23 hours', () => {
  const w = P.windowFor({ period: 'day', mode: 'calendar', time_zone: 'Europe/Lisbon' }, new Date('2026-03-29T12:00:00Z'));
  assert.equal(w.end - w.start, 23 * 3600e3);
});

test('a day whose midnight the clocks skip begins at the jump (Azores)', () => {
  const tz = 'Atlantic/Azores';
  const w = P.windowFor({ period: 'day', mode: 'calendar', time_zone: tz }, new Date('2026-03-29T01:30:00Z'));
  assert.equal(iso(w.start), '2026-03-29T01:00:00.000Z'); // local 00:00 never happens: 00:00 -01 jumps to 01:00 +00
  const earlier = P.windowFor({ period: 'day', mode: 'calendar', time_zone: tz }, new Date('2026-03-29T00:30:00Z'));
  assert.equal(+earlier.end, +w.start);
  assert.ok(earlier.start <= new Date('2026-03-29T00:30:00Z') && new Date('2026-03-29T00:30:00Z') < earlier.end);
});

test('a Sao Paulo day that lost its midnight lasts 23 hours (2017-10-15)', () => {
  const w = P.windowFor({ period: 'day', mode: 'calendar', time_zone: 'America/Sao_Paulo' }, new Date('2017-10-15T12:00:00Z'));
  assert.equal(iso(w.start), '2017-10-15T03:00:00.000Z');
  assert.equal(w.end - w.start, 23 * 3600e3);
});

test('days stay contiguous across a skipped midnight (Havana, Santiago, Asuncion)', () => {
  const cases = [
    ['America/Havana', '2026-03-08T12:00:00Z'],
    ['America/Santiago', '2026-09-06T12:00:00Z'],
    ['America/Asuncion', '2018-10-07T12:00:00Z'],
  ];
  for (const [tz, noon] of cases) {
    const day = { period: 'day', mode: 'calendar', time_zone: tz };
    const t = new Date(noon);
    const w = P.windowFor(day, t);
    assert.ok(w.start <= t && t < w.end, tz);
    const previous = P.windowFor(day, new Date(+w.start - 1));
    assert.equal(+previous.end, +w.start, tz);
    const following = P.windowFor(day, w.end);
    assert.equal(+following.start, +w.end, tz);
  }
});

test('Asuncion 2018: the October month spans the jump and the 7th starts at it', () => {
  const tz = 'America/Asuncion';
  const month = P.windowFor({ period: 'month', mode: 'calendar', time_zone: tz }, new Date('2018-10-15T12:00:00Z'));
  assert.equal(iso(month.start), '2018-10-01T04:00:00.000Z'); // 00:00 at -04
  assert.equal(iso(month.end), '2018-11-01T03:00:00.000Z');   // 00:00 at -03
  const day = P.windowFor({ period: 'day', mode: 'calendar', time_zone: tz }, new Date('2018-10-07T12:00:00Z'));
  assert.equal(iso(day.start), '2018-10-07T04:00:00.000Z');   // local 00:00 skipped: 00:00 -04 jumps to 01:00 -03
});

test('a calendar year runs from Jan 1 to the next Jan 1 in the goal zone', () => {
  const w = P.windowFor({ period: 'year', mode: 'calendar', time_zone: 'Asia/Tokyo' }, new Date('2026-12-31T16:00:00Z')); // already 2027-01-01 01:00 in Tokyo
  assert.equal(iso(w.start), '2026-12-31T15:00:00.000Z');
  assert.equal(iso(w.end), '2027-12-31T15:00:00.000Z');
});

test('a calendar goal without a zone counts in UTC', () => {
  const w = P.windowFor({ period: 'day', mode: 'calendar' }, new Date('2026-10-16T12:00:00Z'));
  assert.equal(iso(w.start), '2026-10-16T00:00:00.000Z');
  assert.equal(iso(w.end), '2026-10-17T00:00:00.000Z');
});

test('rolling month is the last 30 days', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  const w = P.windowFor({ period: 'month', mode: 'rolling' }, now);
  assert.equal(now - w.start, 30 * 86400e3); assert.equal(+w.end, +now);
});

test('rolling year, week and day use their day counts', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  for (const [period, days] of Object.entries(P.ROLLING_DAYS)) {
    const w = P.windowFor({ period, mode: 'rolling' }, now);
    assert.equal(now - w.start, days * 86400e3, period);
  }
  assert.deepEqual(P.ROLLING_DAYS, { year: 365, month: 30, week: 7, day: 1 });
});

test('an hours goal ends started_at + hours; lifetime has no window', () => {
  const w = P.windowFor({ period: 'hours', hours: 4, started_at: '2026-10-16T10:00:00Z' }, new Date('2026-10-16T11:00:00Z'));
  assert.equal(iso(w.end), '2026-10-16T14:00:00.000Z');
  assert.equal(iso(w.start), '2026-10-16T10:00:00.000Z');
  assert.deepEqual(P.windowFor({ period: 'lifetime' }, new Date()), { start: null, end: null });
});

test('started_at may be an ISO string, a SQLite UTC string or a Date', () => {
  const now = new Date('2026-10-16T11:00:00Z');
  for (const started_at of ['2026-10-16T10:00:00Z', '2026-10-16 10:00:00', new Date('2026-10-16T10:00:00Z')]) {
    const w = P.windowFor({ period: 'hours', hours: 2, started_at }, now);
    assert.equal(iso(w.start), '2026-10-16T10:00:00.000Z');
    assert.equal(iso(w.end), '2026-10-16T12:00:00.000Z');
  }
});

test('an hours goal that cannot be read throws instead of counting everything', () => {
  const now = new Date('2026-10-16T11:00:00Z');
  assert.throws(() => P.windowFor({ period: 'hours', hours: 4 }, now), RangeError);
  assert.throws(() => P.windowFor({ period: 'hours', hours: 4, started_at: 'soon' }, now), RangeError);
  assert.throws(() => P.windowFor({ period: 'hours', hours: 0, started_at: '2026-10-16T10:00:00Z' }, now), RangeError);
});

test('an unknown period or time zone throws', () => {
  const now = new Date('2026-10-16T11:00:00Z');
  assert.throws(() => P.windowFor({ period: 'decade', mode: 'calendar' }, now), RangeError);
  assert.throws(() => P.windowFor({ period: 'day', mode: 'calendar', time_zone: 'Mars/Base' }, now), RangeError);
});

test('nextRollover is the calendar or hours end, else null', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  const calendar = { period: 'month', mode: 'calendar', time_zone: 'Europe/Lisbon' };
  assert.equal(iso(P.nextRollover(calendar, now)), '2026-11-01T00:00:00.000Z');
  assert.equal(+P.nextRollover(calendar, now), +P.windowFor(calendar, now).end);
  const hours = { period: 'hours', hours: 4, started_at: '2026-10-16T10:00:00Z' };
  assert.equal(iso(P.nextRollover(hours, now)), '2026-10-16T14:00:00.000Z');
  assert.equal(P.nextRollover({ period: 'week', mode: 'rolling' }, now), null);
  assert.equal(P.nextRollover({ period: 'lifetime' }, now), null);
});

test('the lists name every period and both modes', () => {
  assert.deepEqual(P.PERIODS, ['lifetime', 'year', 'month', 'week', 'day', 'hours']);
  assert.deepEqual(P.MODES, ['calendar', 'rolling']);
});

test('isTimeZone accepts IANA names and refuses others', () => {
  assert.ok(P.isTimeZone('Asia/Tokyo'));
  assert.ok(!P.isTimeZone('Mars/Base'));
  assert.ok(!P.isTimeZone(''));
  assert.ok(!P.isTimeZone(undefined));
  assert.ok(!P.isTimeZone(42));
});

// A zone typed in another case, or under an older alias, is the same zone: the goal stores the canonical name, and the
// formatters are kept once per zone (never once per spelling).
test('canonicalTimeZone gives Intl\'s name for a zone (case and aliases), null for no zone; the formatters are kept by it', () => {
  assert.equal(P.canonicalTimeZone('europe/lisbon'), 'Europe/Lisbon');
  assert.equal(P.canonicalTimeZone('US/Pacific'), 'America/Los_Angeles');
  assert.equal(P.canonicalTimeZone('Mars/Base'), null);
  assert.equal(P.canonicalTimeZone(''), null);
  assert.equal(P.canonicalTimeZone(null), null);
  for (const spelling of ['EUROPE/LISBON', 'europe/lisbon', 'Europe/Lisbon', 'eUrOpE/lIsBoN']) P.isTimeZone(spelling);
  const now = Date.parse('2026-10-16T12:00:00Z');
  assert.deepEqual(P.windowFor({ period: 'month', mode: 'calendar', time_zone: 'europe/lisbon' }, now),
    P.windowFor({ period: 'month', mode: 'calendar', time_zone: 'Europe/Lisbon' }, now));
  const zones = P.formatterZones();
  assert.ok(zones.includes('Europe/Lisbon'));
  assert.deepEqual(zones.filter((z) => z.toLowerCase() === 'europe/lisbon'), ['Europe/Lisbon']);
});
