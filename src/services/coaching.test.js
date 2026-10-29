'use strict';

// The coaching rules: weekly hours, the times a viewer can book, booking states.
// Pure: the clock and the zone are passed in.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('./coaching');

const LISBON = 'Europe/Lisbon';
const at = (iso) => Date.parse(iso);

test('parseHours accepts the default week and refuses a start off the half hour, an end before its start, and six days', () => {
  const ok = C.parseHours(C.DEFAULT_HOURS);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.hours, C.DEFAULT_HOURS);
  const week = (patch) => C.DEFAULT_HOURS.map((d, i) => (i === 0 ? { ...d, ...patch } : d));
  assert.deepEqual(C.parseHours(week({ start: 1085 })), { ok: false, code: 'bad_hours' });
  assert.deepEqual(C.parseHours(week({ start: 1200, end: 1080 })), { ok: false, code: 'bad_hours' });
  assert.deepEqual(C.parseHours(week({ end: 1470 })), { ok: false, code: 'bad_hours' });
  assert.deepEqual(C.parseHours(C.DEFAULT_HOURS.slice(0, 6)), { ok: false, code: 'bad_hours' });
  assert.deepEqual(C.parseHours(week({ on: 'yes' })), { ok: false, code: 'bad_hours' });
  assert.deepEqual(C.parseHours(null), { ok: false, code: 'bad_hours' });
});

test('parseInvite reads the three link forms and a bare code, and refuses a link to another site', () => {
  assert.equal(C.parseInvite('https://discord.gg/abc-123'), 'abc-123');
  assert.equal(C.parseInvite('discord.gg/abc123'), 'abc123');
  assert.equal(C.parseInvite(' https://discord.com/invite/XyZ9 '), 'XyZ9');
  assert.equal(C.parseInvite('abc123'), 'abc123');
  assert.equal(C.parseInvite('https://evil.example/abc123'), null);
  assert.equal(C.parseInvite('https://discord.gg.evil.example/abc123'), null);
  assert.equal(C.parseInvite('a'), null);
  assert.equal(C.parseInvite(''), null);
  assert.equal(C.parseInvite(null), null);
});

test('parseDaysOff drops past days, sorts and dedupes, and refuses 61 days', () => {
  const r = C.parseDaysOff(['2026-12-01', '2026-11-05', '2026-11-05', '2026-10-01', '2026-11-01'], '2026-11-01');
  assert.deepEqual(r, { ok: true, daysOff: ['2026-11-01', '2026-11-05', '2026-12-01'] });
  assert.deepEqual(C.parseDaysOff(['2026-02-30'], '2026-01-01'), { ok: false, code: 'bad_days_off' });
  assert.deepEqual(C.parseDaysOff(['tomorrow'], '2026-01-01'), { ok: false, code: 'bad_days_off' });
  assert.deepEqual(C.parseDaysOff('2026-11-05', '2026-01-01'), { ok: false, code: 'bad_days_off' });
  const day = (i) => new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10);
  const sixty = Array.from({ length: 60 }, (_, i) => day(i));
  assert.equal(C.parseDaysOff(sixty, '2026-11-01').ok, true);
  assert.deepEqual(C.parseDaysOff([...sixty, day(60)], '2026-11-01'), { ok: false, code: 'bad_days_off' });
});

test('parseWhere and parseNote trim, drop control characters and cap by code points', () => {
  assert.deepEqual(C.parseWhere('  Voice room 2\u0007 '), { ok: true, where: 'Voice room 2' });
  assert.deepEqual(C.parseWhere(''), { ok: true, where: '' });
  assert.deepEqual(C.parseWhere('x'.repeat(151)), { ok: false, code: 'bad_where' });
  assert.equal(C.parseWhere('x'.repeat(150)).ok, true);
  assert.deepEqual(C.parseNote('hi\nthere'), { ok: true, note: 'hi there' });
  assert.deepEqual(C.parseNote('one\r\ntwo\rthree\nfour'), { ok: true, note: 'one two three four' }, 'each line break is one space (Ruling 10)');
  assert.deepEqual(C.parseWhere('Voice room\n2'), { ok: true, where: 'Voice room 2' });
  assert.equal(C.parseNote('\u{1F600}'.repeat(300)).ok, true);
  assert.deepEqual(C.parseNote('\u{1F600}'.repeat(301)), { ok: false, code: 'bad_note' });
  assert.deepEqual(C.parseNote(5), { ok: false, code: 'bad_note' });
});

const MON = at('2026-11-02T18:00:00Z');
const NOW = at('2026-11-01T12:00:00Z'); // a Sunday
const base = { hours: C.DEFAULT_HOURS, timeZone: LISBON, daysOff: [], held: [], now: NOW };
const onDay = (starts, isoDay) => starts.filter((s) => new Date(s).toISOString().startsWith(isoDay));

test('freeStarts gives 18:00 to 21:30 for 30 minutes and 18:00 to 21:00 for an hour on a Monday', () => {
  const hour = C.freeStarts({ ...base, minutes: 60 });
  assert.equal(hour[0], MON);
  const monHour = onDay(hour, '2026-11-02');
  assert.equal(monHour.length, 7);
  assert.equal(monHour[6], at('2026-11-02T21:00:00Z'));
  const half = onDay(C.freeStarts({ ...base, minutes: 30 }), '2026-11-02');
  assert.equal(half.length, 8);
  assert.equal(half[7], at('2026-11-02T21:30:00Z'));
});

test('freeStarts leaves out a held hour and the half hours it covers', () => {
  const held = [{ startsAt: at('2026-11-02T19:00:00Z'), minutes: 60 }];
  const clock = (list) => onDay(list, '2026-11-02').map((s) => new Date(s).toISOString().slice(11, 16));
  const half = clock(C.freeStarts({ ...base, held, minutes: 30 }));
  assert.ok(!half.includes('19:00') && !half.includes('19:30'));
  assert.ok(half.includes('18:30') && half.includes('20:00'));
  const hour = clock(C.freeStarts({ ...base, held, minutes: 60 }));
  for (const t of ['18:30', '19:00', '19:30']) assert.ok(!hour.includes(t), t);
  assert.ok(hour.includes('18:00') && hour.includes('20:00'));
});

test('freeStarts leaves out days off, switched-off weekdays, starts less than an hour away, and days past the fourteenth', () => {
  const off = C.freeStarts({ ...base, daysOff: ['2026-11-02'], minutes: 60 });
  assert.equal(off[0], at('2026-11-03T18:00:00Z'));
  // Saturday 7 and Sunday 8 are switched off.
  const all = C.freeStarts({ ...base, minutes: 60 });
  assert.equal(onDay(all, '2026-11-07').length, 0);
  assert.equal(onDay(all, '2026-11-08').length, 0);
  // Less than an hour away: at 17:30 on Monday the first start allowed is 18:30.
  const soon = C.freeStarts({ ...base, now: at('2026-11-02T17:30:00Z'), minutes: 60 });
  assert.equal(soon[0], at('2026-11-02T18:30:00Z'));
  const exact = C.freeStarts({ ...base, now: at('2026-11-02T17:00:00Z'), minutes: 60 });
  assert.equal(exact[0], MON);
  // Today (the 1st) plus 13 days: the 14th is last, the 15th (a Sunday) is out anyway, so use hours on all days.
  const everyDay = C.DEFAULT_HOURS.map((d) => ({ ...d, on: true }));
  const wide = C.freeStarts({ ...base, hours: everyDay, minutes: 60 });
  assert.equal(onDay(wide, '2026-11-14').length, 7);
  assert.equal(onDay(wide, '2026-11-15').length, 0);
});

test('freeStarts keeps 18:00 local across the October clock change (Review Focus 1)', () => {
  const starts = C.freeStarts({ ...base, now: at('2026-10-22T12:00:00Z'), minutes: 60 });
  assert.equal(onDay(starts, '2026-10-23')[0], at('2026-10-23T17:00:00Z'));
  assert.equal(onDay(starts, '2026-10-26')[0], at('2026-10-26T18:00:00Z'));
});

test('localInstant answers null for 01:30 on the night Lisbon skips it', () => {
  assert.equal(C.localInstant('2026-03-29', 90, LISBON), null);
  assert.equal(C.localInstant('2026-03-29', 120, LISBON), at('2026-03-29T01:00:00Z'));
});

test('localInstant takes the earlier instant for a time that happens twice', () => {
  // 01:30 on 25 October 2026 happens at 00:30Z (WEST) and 01:30Z (WET).
  assert.equal(C.localInstant('2026-10-25', 90, LISBON), at('2026-10-25T00:30:00Z'));
});

test('localDateOf gives the date on the zone\'s wall', () => {
  assert.equal(C.localDateOf(at('2026-11-01T23:30:00Z'), 'Asia/Tokyo'), '2026-11-02');
  assert.equal(C.localDateOf(at('2026-11-01T23:30:00Z'), LISBON), '2026-11-01');
});

test('bookingState calls a waiting booking past its start unanswered and leaves the stored states as they are', () => {
  const now = at('2026-11-02T18:00:00Z');
  const b = (status, starts_at) => ({ status, starts_at });
  assert.equal(C.bookingState(b('waiting', now - 1), now), 'unanswered');
  assert.equal(C.bookingState(b('waiting', now), now), 'unanswered');
  assert.equal(C.bookingState(b('waiting', now + 1), now), 'waiting');
  for (const s of ['confirmed', 'declined', 'cancelled', 'withdrawn']) {
    assert.equal(C.bookingState(b(s, now - 1), now), s);
  }
});

test('outsideHours flags a booking on a day off and one after the window was shortened', () => {
  const booking = { starts_at: at('2026-11-02T20:00:00Z'), minutes: 60 };
  const ctx = { hours: C.DEFAULT_HOURS, timeZone: LISBON, daysOff: [] };
  assert.equal(C.outsideHours(booking, ctx), false);
  assert.equal(C.outsideHours(booking, { ...ctx, daysOff: ['2026-11-02'] }), true);
  const shorter = C.DEFAULT_HOURS.map((d, i) => (i === 0 ? { ...d, end: 1230 } : d));
  assert.equal(C.outsideHours(booking, { ...ctx, hours: shorter }), true);
  const sunday = { starts_at: at('2026-11-08T19:00:00Z'), minutes: 30 };
  assert.equal(C.outsideHours(sunday, ctx), true);
});

test('bookable is false while paused, without a claimed server, without an invite, or with an invite Discord refused', () => {
  const s = { open: 1, guild_id: 'g1', invite_code: 'abc', invite_ok: 1 };
  assert.equal(C.bookable(s, ['g1']), true);
  assert.equal(C.bookable({ ...s, invite_ok: null }, ['g1']), true);
  assert.equal(C.bookable({ ...s, open: 0 }, ['g1']), false);
  assert.equal(C.bookable(s, ['g2']), false);
  assert.equal(C.bookable({ ...s, invite_code: '' }, ['g1']), false);
  assert.equal(C.bookable({ ...s, invite_ok: 0 }, ['g1']), false);
  assert.equal(C.bookable(null, ['g1']), false);
});
