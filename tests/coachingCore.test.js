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

describe('payment helpers', () => {
  const now = Date.UTC(2026, 10, 2, 12, 0);
  const later = now + 24 * 3600e3;

  test('formatPrice writes the amount in the currency and the language, and Free for none', () => {
    assert.match(core.formatPrice(2500, 'EUR', 'en', 'Free'), /€\s?25\.00/);
    assert.match(core.formatPrice(2500, 'EUR', 'pt', 'Grátis'), /25,00/);
    assert.match(core.formatPrice(4550, 'USD', 'en', 'Free'), /\$45\.50/);
    assert.equal(core.formatPrice(0, 'EUR', 'en', 'Free'), 'Free');
    assert.equal(core.formatPrice(null, 'EUR', 'en', 'Free'), 'Free');
    assert.equal(core.formatPrice(1000, 'nope', 'en', 'Free'), '10.00 nope', 'an unknown currency still prints the amount');
  });

  test('lengthLabel: minutes under an hour, whole hours as hours', () => {
    const texts = { lengthMin: '{{n}} min', lengthHour: '{{n}} h' };
    assert.deepEqual([30, 60, 120, 300].map((m) => core.lengthLabel(m, texts)), ['30 min', '1 h', '2 h', '5 h']);
  });

  test('payByLabel is the date and time in the viewer zone', () => {
    const at = Date.UTC(2026, 10, 3, 17, 30);
    assert.match(core.payByLabel(at, 'Europe/Lisbon', 'en'), /Tue.*17:30/);
    assert.match(core.payByLabel(at, 'Asia/Tokyo', 'en'), /Wed.*02:30/);
  });

  test('lengthsToShow keeps only the lengths with a free start far enough away', () => {
    const lengths = [{ minutes: 60, priceCents: 2500 }, { minutes: 120, priceCents: 4500 }, { minutes: 180, priceCents: 0 }];
    const lead = 3600e3;
    const slots = { 60: [later], 120: [now + 1800e3], 180: [] };
    assert.deepEqual(core.lengthsToShow(lengths, slots, now, lead).map((l) => l.minutes), [60]);
    assert.deepEqual(core.lengthsToShow(null, slots, now, lead), []);
  });

  test('a paid booking counts toward the limit but has no Cancel; Pay needs a price and time left', () => {
    const awaiting = { id: 1, startsAt: later, state: 'awaiting_payment', priceCents: 2500, payBy: now + 3600e3, paid: false };
    const paid = { id: 2, startsAt: later, state: 'confirmed', priceCents: 2500, paid: true };
    const old = { id: 3, startsAt: later, state: 'confirmed', priceCents: null, paid: false };
    const expired = { id: 4, startsAt: later, state: 'expired', priceCents: 2500, paid: false };
    const all = [awaiting, paid, old, expired];
    assert.equal(core.upcomingCount(all, now), 3);
    assert.deepEqual(all.filter((b) => core.canCancel(b, now)).map((b) => b.id), [1, 3]);
    assert.deepEqual(all.filter((b) => core.canPay(b, now)).map((b) => b.id), [1]);
    assert.equal(core.canPay({ ...awaiting, payBy: now - 1 }, now), false, 'past its pay-by time');
    assert.equal(core.canPay({ ...awaiting, priceCents: 0 }, now), false);
  });

  test('returnNotice reads what PayPal left in the address and nothing else', () => {
    assert.deepEqual(core.returnNotice('?paid=1'), { kind: 'paid' });
    assert.deepEqual(core.returnNotice('?error=late'), { kind: 'error', code: 'late', order: null });
    assert.deepEqual(core.returnNotice('?error=pay_unconfirmed&order=5O190127TN364715T'), { kind: 'error', code: 'pay_unconfirmed', order: '5O190127TN364715T' });
    assert.equal(core.returnNotice('?error=pay_unconfirmed&order=a%20b').order, null, 'an order id of another shape is dropped');
    assert.equal(core.returnNotice('?error=late&order=ABC').order, null, 'only an unconfirmed payment keeps its order');
    assert.equal(core.returnNotice('?error=<script>'), null);
    assert.equal(core.returnNotice('?paid=2'), null);
    assert.equal(core.returnNotice(''), null);
    assert.equal(core.returnNotice('?error=%E0%A4%A'), null, 'a broken escape does not throw');
  });

  test('only a PayPal page is gone to and only a Discord channel is linked as a room', () => {
    assert.equal(core.isPayPalUrl('https://www.sandbox.paypal.com/checkoutnow?token=X'), true);
    assert.equal(core.isPayPalUrl('https://paypal.com.evil.test/x'), false);
    assert.equal(core.isPayPalUrl('javascript:alert(1)'), false);
    assert.equal(core.isRoomUrl('https://discord.com/channels/123/456'), true);
    assert.equal(core.isRoomUrl('https://discord.com/channels/123/456/'), false);
    assert.equal(core.isRoomUrl('https://evil.test/channels/1/2'), false);
  });
});

describe('reschedule and refund helpers', () => {
  const NOW = Date.UTC(2026, 9, 19, 9, 0);
  const base = { state: 'rescheduling', startsAt: NOW + 86400e3, paid: true, proposal: null };

  test('rescheduleMode says what the viewer can do', () => {
    assert.equal(core.rescheduleMode({ ...base, proposal: { startsAt: NOW + 2 * 86400e3, by: 'coach' } }, NOW), 'answer');
    assert.equal(core.rescheduleMode({ ...base, proposal: { startsAt: NOW + 2 * 86400e3, by: 'viewer' } }, NOW), 'wait');
    assert.equal(core.rescheduleMode(base, NOW), 'pick', 'asked to pick, or the proposal lapsed');
    assert.equal(core.rescheduleMode({ ...base, state: 'confirmed' }, NOW), null);
    assert.equal(core.rescheduleMode({ ...base, startsAt: NOW - 1 }, NOW), null);
    assert.equal(core.rescheduleMode(null, NOW), null);
  });

  test('a rescheduling booking holds its place, and a paid one has no Cancel while an unpaid one has Withdraw', () => {
    assert.equal(core.holds(base, NOW), true);
    assert.equal(core.upcomingCount([base, { ...base, state: 'cancelled' }], NOW), 1);
    assert.equal(core.canCancel(base, NOW), false);
    assert.equal(core.canCancel({ ...base, paid: false }, NOW), true);
  });

  test('refundLine reads only the flags', () => {
    assert.equal(core.refundLine({ refundState: 'pending', refundPending: true }), 'pending');
    assert.equal(core.refundLine({ refundState: 'refunded' }), 'refunded');
    assert.equal(core.refundLine({ refundState: null }), null);
    assert.equal(core.refundLine(null), null);
  });

  test('bookingFromSearch takes only a plain number', () => {
    assert.equal(core.bookingFromSearch('?booking=42'), 42);
    assert.equal(core.bookingFromSearch('?paid=1&booking=7'), 7);
    assert.equal(core.bookingFromSearch('?booking=abc'), null);
    assert.equal(core.bookingFromSearch('?booking=1<script>'), null);
    assert.equal(core.bookingFromSearch(''), null);
  });
});
