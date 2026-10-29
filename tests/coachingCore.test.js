'use strict';

// The booking page's pure helpers (public/js/coaching-core.js), loaded as Node loads them: the day strip in the
// viewer's own time zone, and the times and dates it prints.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../public/js/coaching-core.js');

const HALF_HOUR = 30 * 60e3;
// Monday 19 October 2026, before Lisbon's clock change (Sunday 25 October): Lisbon is UTC+1, Tokyo UTC+9.
// Lisbon's 18:00 is 17:00 UTC, which is 02:00 on Tuesday in Tokyo.
const LISBON_18H = Date.UTC(2026, 9, 19, 17, 0);
const EVENING = Array.from({ length: 8 }, (_, i) => LISBON_18H + i * HALF_HOUR); // 18:00 ... 21:30 in Lisbon
const MONDAY_MORNING = Date.UTC(2026, 9, 19, 9, 0); // 10:00 in Lisbon, 18:00 in Tokyo: Monday in both

describe('groupByLocalDay', () => {
  test("groupByLocalDay puts Lisbon's 18:00 to 22:00 on the next day in Asia/Tokyo (Review Focus 2)", () => {
    const tokyo = core.groupByLocalDay(EVENING, 'Asia/Tokyo', MONDAY_MORNING, 3);
    assert.deepEqual(tokyo.map((d) => d.date), ['2026-10-19', '2026-10-20', '2026-10-21']);
    assert.deepEqual(tokyo.map((d) => d.starts.length), [0, 8, 0], 'the whole evening is on Tuesday in Tokyo');
    assert.deepEqual(tokyo[1].starts, EVENING);
    assert.equal(core.timeLabel(tokyo[1].starts[0], 'Asia/Tokyo', 'en'), '02:00');
    assert.equal(core.timeLabel(tokyo[1].starts[7] + HALF_HOUR, 'Asia/Tokyo', 'en'), '06:00', 'the last session ends at 06:00');

    const lisbon = core.groupByLocalDay(EVENING, 'Europe/Lisbon', MONDAY_MORNING, 3);
    assert.deepEqual(lisbon.map((d) => d.starts.length), [8, 0, 0], 'on Monday in Lisbon');
    assert.equal(core.timeLabel(lisbon[0].starts[0], 'Europe/Lisbon', 'en'), '18:00');
  });

  test('groupByLocalDay lists every day of the strip, empty ones included', () => {
    // From Thursday 22 October to Wednesday 4 November: across Lisbon's clock change and the end of the month.
    const today = Date.UTC(2026, 9, 22, 12, 0);
    const oneAfterTheChange = Date.UTC(2026, 9, 26, 18, 0); // Monday 26 October, 18:00 in Lisbon (UTC+0 now)
    const last = Date.UTC(2026, 10, 4, 21, 30); // Wednesday 4 November, 21:30
    const days = core.groupByLocalDay([oneAfterTheChange, last], 'Europe/Lisbon', today, 14);
    assert.equal(days.length, 14);
    assert.deepEqual(days.map((d) => d.date), [
      '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28',
      '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04',
    ]);
    assert.deepEqual(days.filter((d) => d.starts.length).map((d) => d.date), ['2026-10-26', '2026-11-04']);
    assert.equal(days.filter((d) => !d.starts.length).length, 12, 'the empty days are there too');
  });

  test('a start past the strip is left out, and daysToShow makes the strip long enough for every start', () => {
    const today = Date.UTC(2026, 9, 19, 9, 0);
    const lateStart = Date.UTC(2026, 10, 1, 21, 0); // Sunday 1 November 21:00 in Lisbon: Monday 06:00 in Tokyo
    assert.equal(core.groupByLocalDay([lateStart], 'Asia/Tokyo', today, 14).some((d) => d.starts.length), false);
    assert.equal(core.daysToShow([lateStart], 'Asia/Tokyo', today, 14), 15, 'Tokyo needs a fifteenth day');
    assert.equal(core.daysToShow([lateStart], 'Europe/Lisbon', today, 14), 14);
    assert.equal(core.daysToShow([], 'Asia/Tokyo', today, 14), 14);
  });
});

describe('bookableStarts', () => {
  test('a page left open drops the starts that came inside the hour of notice', () => {
    const now = Date.UTC(2026, 10, 2, 17, 0);
    const lead = 3600e3;
    const starts = [now + 30 * 60e3, now + lead - 1, now + lead, now + lead + HALF_HOUR];
    assert.deepEqual(core.bookableStarts(starts, now, lead), [now + lead, now + lead + HALF_HOUR], 'as the server: at least an hour from now');
    assert.deepEqual(core.bookableStarts(starts, now + HALF_HOUR, lead), [now + lead + HALF_HOUR], 'half an hour later');
    assert.deepEqual(core.bookableStarts(starts, now, undefined), starts, 'without a lead from the server: the starts still to come');
    assert.deepEqual(core.bookableStarts(null, now, lead), []);
  });
});

describe('the labels', () => {
  test('timeLabel is HH:MM on a 24-hour clock in every language', () => {
    const midnight = Date.UTC(2026, 10, 2, 0, 0);
    for (const lang of ['en', 'pt', 'es', 'fr', 'de', 'zh', 'ja']) {
      assert.equal(core.timeLabel(midnight, 'Europe/Lisbon', lang), '00:00', lang);
      assert.equal(core.timeLabel(midnight + 21.5 * 3600e3, 'Europe/Lisbon', lang), '21:30', lang);
    }
  });

  test('dayLabel names the weekday of a date and its day of the month, whatever the zone', () => {
    assert.deepEqual(core.dayLabel('2026-11-03', 'en'), { weekday: 'Tue', day: 3 });
    assert.equal(core.dayLabel('2026-11-01', 'pt').day, 1);
    assert.equal(typeof core.dayLabel('2026-11-03', 'ja').weekday, 'string');
  });

  test("the date of a booking is in the viewer's zone", () => {
    assert.match(core.dateLabel(LISBON_18H, 'Asia/Tokyo', 'en'), /Tue/);
    assert.match(core.dateLabel(LISBON_18H, 'Europe/Lisbon', 'en'), /Mon/);
  });

  test('upcoming and cancellable bookings: waiting or confirmed, not yet started', () => {
    const now = Date.UTC(2026, 10, 2, 12, 0);
    const later = now + 3600e3;
    const bookings = [
      { id: 1, startsAt: later, state: 'waiting' }, { id: 2, startsAt: later, state: 'confirmed' },
      { id: 3, startsAt: later, state: 'declined' }, { id: 4, startsAt: now - 60e3, state: 'confirmed' },
      { id: 5, startsAt: later, state: 'withdrawn' },
    ];
    assert.equal(core.upcomingCount(bookings, now), 2);
    assert.deepEqual(bookings.filter((b) => core.canCancel(b, now)).map((b) => b.id), [1, 2]);
  });
});
