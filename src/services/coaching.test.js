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

test('the default lengths: 1 h to 5 h on at the owner\'s prices, 30 min off, and a row with none gets them', () => {
  assert.deepEqual(C.LENGTHS, [30, 60, 120, 180, 240, 300]);
  const d = C.lengthsFor(null);
  assert.deepEqual(d[30], { on: false, price: 0 });
  assert.deepEqual([60, 120, 180, 240, 300].map((m) => d[m].price), [2500, 4500, 6000, 7000, 8000]);
  assert.ok([60, 120, 180, 240, 300].every((m) => d[m].on));
  assert.deepEqual(C.lengthsFor({ lengths: null }), d);
  assert.deepEqual(C.lengthsFor({ lengths: 'not json' }), d);
  const saved = { ...d, 60: { on: false, price: 1 } };
  assert.equal(C.lengthsFor({ lengths: JSON.stringify(saved) })[60].price, 1);
  C.lengthsFor(null)[60].price = 1;
  assert.equal(C.lengthsFor(null)[60].price, 2500, 'the defaults are never shared');
  assert.deepEqual(C.HOLDING, ['waiting', 'awaiting_payment', 'confirmed', 'rescheduling']);
  assert.ok(C.STATES.includes('awaiting_payment') && C.STATES.includes('expired'));
});

test('parseLengths refuses what is not six lengths with a switch and whole-cent prices, and all off', () => {
  const ok = C.lengthsFor(null);
  assert.deepEqual(C.parseLengths(ok), { ok: true, lengths: ok });
  const bad = { ok: false, code: 'bad_lengths' };
  assert.deepEqual(C.parseLengths(null), bad);
  assert.deepEqual(C.parseLengths([]), bad);
  const without = { ...ok }; delete without[300];
  assert.deepEqual(C.parseLengths(without), bad);
  assert.deepEqual(C.parseLengths({ ...ok, 45: { on: true, price: 1 } }), bad);
  assert.deepEqual(C.parseLengths({ ...ok, 60: { on: 'yes', price: 1 } }), bad);
  assert.deepEqual(C.parseLengths({ ...ok, 60: { on: true, price: 12.5 } }), bad);
  assert.deepEqual(C.parseLengths({ ...ok, 60: { on: true, price: -1 } }), bad);
  assert.deepEqual(C.parseLengths({ ...ok, 60: { on: true, price: 100001 } }), bad);
  assert.equal(C.parseLengths({ ...ok, 60: { on: true, price: 100000 } }).ok, true);
  assert.equal(C.parseLengths({ ...ok, 30: { on: true, price: 0 } }).ok, true, 'free is allowed');
  const off = Object.fromEntries(C.LENGTHS.map((m) => [m, { on: false, price: 0 }]));
  assert.deepEqual(C.parseLengths(off), { ok: false, code: 'no_length' });
});

test('payBy is two hours after accepting, never later than 15 minutes before the start', () => {
  const H = 3600e3; const M = 60e3;
  assert.equal(C.payBy(0, 10 * H), 2 * H);
  assert.equal(C.payBy(0, 2 * H), 2 * H - 15 * M);
  assert.equal(C.payBy(0, 2 * H + 15 * M), 2 * H);
  assert.equal(C.payBy(0, 30 * M), 15 * M);
});

test('canAcceptPaid needs 10 minutes left to pay: allowed 26 minutes before the start, refused at 24', () => {
  const M = 60e3; const start = 1e9;
  assert.equal(C.canAcceptPaid(start - 26 * M, start), true);
  assert.equal(C.canAcceptPaid(start - 25 * M, start), true);
  assert.equal(C.canAcceptPaid(start - 24 * M, start), false);
  assert.equal(C.canAcceptPaid(start - 3 * 3600e3, start), true);
});

test('freeStarts lists 5 h starts only where the session ends inside the window', () => {
  const now = at('2026-11-02T00:00:00Z');
  const hours = C.DEFAULT_HOURS.map((d) => ({ ...d, start: 600, end: 1320 }));
  const starts = C.freeStarts({ hours, timeZone: 'UTC', daysOff: [], held: [], now, minutes: 300 });
  assert.ok(starts.length > 0);
  const first = new Date(starts[0]);
  assert.equal(first.getUTCHours() * 60 + first.getUTCMinutes(), 600);
  assert.ok(starts.every((s) => { const d = new Date(s); return d.getUTCHours() * 60 + d.getUTCMinutes() + 300 <= 1320; }));
});

test('states and holding include rescheduling; not_rescheduled is a state that holds nothing', () => {
  assert.ok(C.HOLDING.includes('rescheduling'));
  assert.ok(C.STATES.includes('rescheduling') && C.STATES.includes('not_rescheduled'));
  assert.ok(!C.HOLDING.includes('not_rescheduled'));
  assert.equal(C.PROPOSAL_LAPSE_MS, 48 * 3600e3);
  assert.equal(C.RESCHEDULE_WINDOW_MS, 7 * 86400e3);
  assert.equal(C.CANCEL_REASON_MAX, 500);
  assert.equal(C.PROPOSAL_NOTE_MAX, 300);
});

test('viewerRescheduleStarts never offers the original time or a held one', () => {
  const now = at('2026-11-02T00:00:00Z');
  const hours = C.DEFAULT_HOURS.map((d) => ({ ...d, start: 600, end: 1320 }));
  const args = { hours, timeZone: 'UTC', daysOff: [], held: [], now, minutes: 60 };
  const all = C.freeStarts(args);
  const original = all[5];
  const starts = C.viewerRescheduleStarts({ ...args, originalStartsAt: original });
  assert.equal(starts.includes(original), false);
  assert.equal(starts.length, all.length - 1);
  const heldOne = { startsAt: all[8], minutes: 60 };
  assert.equal(C.viewerRescheduleStarts({ ...args, held: [heldOne], originalStartsAt: original }).includes(all[8]), false);
});

test('coachProposalStarts: any half hour from an hour ahead to 14 days, outside hours and on days off, never held', () => {
  const now = at('2026-11-02T10:10:00Z');
  const held = [{ startsAt: at('2026-11-03T12:00:00Z'), minutes: 60 }];
  const starts = C.coachProposalStarts({ timeZone: 'UTC', held, now, minutes: 60 });
  assert.equal(starts[0], at('2026-11-02T11:30:00Z'), 'the first half hour at least an hour away');
  assert.ok(starts.every((s) => s >= now + 3600e3 && s <= now + 14 * 86400e3));
  assert.ok(starts.every((s) => s % 1800e3 === 0));
  assert.ok(starts.includes(at('2026-11-02T03:00:00Z') + 86400e3), 'outside weekly hours');
  assert.ok(starts.includes(at('2026-11-07T14:00:00Z')), 'a Saturday, a day the default week has off');
  assert.equal(starts.includes(at('2026-11-03T12:00:00Z')), false);
  assert.equal(starts.includes(at('2026-11-03T11:30:00Z')), false, 'overlaps the held hour');
  assert.equal(starts.includes(at('2026-11-03T13:00:00Z')), true);
  const zoned = C.coachProposalStarts({ timeZone: 'Asia/Kathmandu', held: [], now, minutes: 30 });
  assert.ok(zoned.every((s) => (s + 5.75 * 3600e3) % 1800e3 === 0));
});

test('canReschedule and canCoachCancel', () => {
  const now = 1000;
  assert.equal(C.canReschedule({ status: 'confirmed', starts_at: now + 1 }, now), true);
  assert.equal(C.canReschedule({ status: 'confirmed', starts_at: now }, now), false);
  assert.equal(C.canReschedule({ status: 'waiting', starts_at: now + 1 }, now), false);
  assert.equal(C.canReschedule({ status: 'rescheduling', starts_at: now + 1 }, now), false);
  for (const st of ['waiting', 'awaiting_payment', 'confirmed']) {
    assert.equal(C.canCoachCancel({ status: st, starts_at: now + 1 }, now), true, st);
    assert.equal(C.canCoachCancel({ status: st, starts_at: now - 1 }, now), false, st);
  }
  assert.equal(C.canCoachCancel({ status: 'rescheduling', starts_at: now - 5 }, now), true);
  for (const st of ['declined', 'cancelled', 'withdrawn', 'expired', 'not_rescheduled']) assert.equal(C.canCoachCancel({ status: st, starts_at: now + 1 }, now), false, st);
});

test('rescheduleDue: close at 7 days, too close, 48 h lapse by side, otherwise nothing', () => {
  const H = 3600e3; const now = 1e12;
  const b = (over) => ({ status: 'rescheduling', reschedule_started_at: now - H, proposal_starts_at: now + 20 * H, proposal_by: 'coach', proposal_at: now - H, ...over });
  assert.equal(C.rescheduleDue(b({}), now), null);
  assert.equal(C.rescheduleDue({ status: 'confirmed' }, now), null);
  assert.equal(C.rescheduleDue(b({ proposal_starts_at: null, proposal_by: null, proposal_at: null }), now), null);
  assert.equal(C.rescheduleDue(b({ reschedule_started_at: now - 7 * 24 * H }), now), 'close');
  assert.equal(C.rescheduleDue(b({ reschedule_started_at: now - 7 * 24 * H, proposal_starts_at: null }), now), 'close');
  assert.equal(C.rescheduleDue(b({ proposal_starts_at: now + 30 * 60e3 }), now), 'too_close');
  assert.equal(C.rescheduleDue(b({ proposal_at: now - 48 * H }), now), 'lapse_coach');
  assert.equal(C.rescheduleDue(b({ proposal_at: now - 48 * H, proposal_by: 'viewer' }), now), 'lapse_viewer');
  assert.equal(C.rescheduleDue(b({ proposal_at: now - 47 * H }), now), null);
});
