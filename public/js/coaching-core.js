'use strict';

// The coaching booking page's pure helpers, apart from its script (public/js/coaching-page.js) so node:test loads them
// (tests/coachingCore.test.js). Dual-exported: window.COACHING_CORE for the page, module.exports for Node. Served as it
// is (no build step).
//
// The server sends instants (UTC milliseconds); the page shows them in the viewer's own time zone, so a streamer in
// Lisbon coaching 18:00-22:00 is seen from Tokyo the next morning, 02:00-06:00, on the next day of the strip.
(function () {
  var DAY_MS = 86400e3;
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };

  // { year, month, day, hour, minute } of an instant in a zone, by Intl's parts (the numbers, whatever the language).
  var partsFormats = {};
  function partsOf(ms, timeZone) {
    if (!partsFormats[timeZone]) {
      partsFormats[timeZone] = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      });
    }
    var out = {};
    partsFormats[timeZone].formatToParts(new Date(ms)).forEach(function (p) { if (p.type !== 'literal') out[p.type] = Number(p.value); });
    if (out.hour === 24) out.hour = 0; // an engine that still writes midnight as 24 with h23
    return out;
  }

  // The date (YYYY-MM-DD) of an instant in a zone.
  function localDate(ms, timeZone) {
    var p = partsOf(ms, timeZone);
    return p.year + '-' + pad(p.month) + '-' + pad(p.day);
  }

  // A YYYY-MM-DD date plus whole days (calendar arithmetic: no zone, no clock change).
  function addDays(isoDate, days) {
    return new Date(Date.parse(isoDate + 'T00:00:00Z') + days * DAY_MS).toISOString().slice(0, 10);
  }

  // Every one of `days` local dates from today's (in the zone), each with the starts that fall on it, in order;
  // a day without one keeps an empty list. A start outside the strip is left out.
  function groupByLocalDay(starts, timeZone, todayMs, days) {
    var today = localDate(todayMs, timeZone);
    var strip = [];
    var index = {};
    for (var i = 0; i < days; i++) {
      var date = addDays(today, i);
      index[date] = strip.length;
      strip.push({ date: date, starts: [] });
    }
    (starts || []).slice().sort(function (a, b) { return a - b; }).forEach(function (s) {
      var at = index[localDate(s, timeZone)];
      if (at !== undefined) strip[at].starts.push(s);
    });
    return strip;
  }

  // How many days the strip needs to reach the last start in this zone, at least `min`: the streamer's 14 days can end
  // on a fifteenth day of a viewer east of them.
  function daysToShow(starts, timeZone, todayMs, min) {
    if (!starts || !starts.length) return min;
    var last = Math.max.apply(null, starts);
    var today = Date.parse(localDate(todayMs, timeZone) + 'T00:00:00Z');
    var lastDay = Date.parse(localDate(last, timeZone) + 'T00:00:00Z');
    return Math.max(min, Math.round((lastDay - today) / DAY_MS) + 1);
  }

  // 'HH:MM' on a 24-hour clock, in the zone. Every language the site speaks writes these with Latin digits, so the
  // numbers come from the zone's parts and `lang` changes nothing.
  function timeLabel(ms, timeZone, lang) {
    var p = partsOf(ms, timeZone);
    return pad(p.hour) + ':' + pad(p.minute);
  }

  function safeFormat(lang, options) {
    try { return new Intl.DateTimeFormat(lang, options); } catch (e) { return new Intl.DateTimeFormat('en', options); }
  }

  // The short weekday name and the day of the month of a YYYY-MM-DD date, in the language (a calendar date, so it is
  // read in UTC).
  function dayLabel(isoDate, lang) {
    var at = new Date(isoDate + 'T12:00:00Z');
    return { weekday: safeFormat(lang, { weekday: 'short', timeZone: 'UTC' }).format(at), day: at.getUTCDate() };
  }

  // A booking's date in the viewer's zone and language: "Tue, 3 Nov".
  function dateLabel(ms, timeZone, lang) {
    return safeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short', timeZone: timeZone }).format(new Date(ms));
  }

  // A booking that holds its time: waiting, awaiting payment, confirmed or rescheduling, and not started.
  var HOLDING = ['waiting', 'awaiting_payment', 'payment_processing', 'confirmed', 'rescheduling'];
  function holds(booking, now) {
    if (booking.state === 'rescheduling') return true; // startsAt is the original time, which limits nothing now
    return HOLDING.indexOf(booking.state) >= 0 && booking.startsAt > now;
  }

  // A booking the viewer can still cancel: one that holds its time and is not paid (a paid one has no Cancel).
  function canCancel(booking, now) {
    return holds(booking, now) && !booking.paid && booking.state !== 'payment_processing';
  }

  // A booking the viewer can pay now: accepted, priced, and before its pay-by time.
  function canPay(booking, now) {
    return booking.state === 'awaiting_payment' && !booking.paid && booking.priceCents > 0
      && Number(booking.payBy) > now && booking.startsAt > now;
  }

  // What the viewer can do about a session that is being rescheduled (only the coach starts one): 'answer' when the
  // coach's proposal waits (accept it, or propose another time), 'pick' when there is none (the coach asked, or it
  // lapsed: pick a time), 'wait' when the viewer's own proposal waits for the coach; null for any other booking.
  function rescheduleMode(booking, now) {
    if (!booking || booking.state !== 'rescheduling' || !(booking.startsAt > now)) return null;
    var proposal = booking.proposal;
    if (!proposal) return 'pick';
    return proposal.by === 'coach' ? 'answer' : 'wait';
  }

  // The refund line of a booking: 'pending' (the coach will refund), 'refunded', or null (nothing owed). Only the flags
  // the server sends the viewer; never anything about the payer.
  function refundLine(booking) {
    if (!booking) return null;
    if (booking.refundState === 'pending' || booking.refundPending === true) return 'pending';
    if (booking.refundState === 'refunded') return 'refunded';
    return null;
  }

  // ?booking=<id> (the link in the Discord message of a session to reschedule): the id, or null.
  function bookingFromSearch(search) {
    var match = /(?:^|[?&])booking=(\d{1,15})(?:&|$)/.exec(String(search || ''));
    return match ? Number(match[1]) : null;
  }

  // How many of the viewer's bookings count toward the limit of upcoming ones (paid ones count too).
  function upcomingCount(bookings, now) {
    return (bookings || []).filter(function (b) { return holds(b, now); }).length;
  }

  // A price in cents as the viewer's language writes it ("EUR 25" as "25,00 EUR" or "EUR25.00"); no price (0, null) is
  // `freeText`. A currency this engine does not know prints as "25.00 XXX".
  function formatPrice(cents, currency, lang, freeText) {
    if (!(Number(cents) > 0)) return freeText;
    var amount = Number(cents) / 100;
    try {
      return new Intl.NumberFormat(lang, { style: 'currency', currency: currency || 'EUR' }).format(amount);
    } catch (e) {
      return amount.toFixed(2) + ' ' + (currency || 'EUR');
    }
  }

  // A session length as text: 30 -> "30 min", 60 -> "1 h", 120 -> "2 h", 90 -> "90 min". `texts` holds lengthMin and
  // lengthHour with their {{n}}.
  function lengthLabel(minutes, texts) {
    var hours = minutes / 60;
    var text = minutes >= 60 && minutes % 60 === 0 ? texts.lengthHour : texts.lengthMin;
    return String(text == null ? '' : text).replace('{{n}}', String(minutes >= 60 && minutes % 60 === 0 ? hours : minutes));
  }

  // The deadline to pay, in the viewer's zone: "Tue, 3 Nov, 18:30".
  function payByLabel(ms, timeZone, lang) {
    return dateLabel(ms, timeZone, lang) + ', ' + timeLabel(ms, timeZone, lang);
  }

  // The lengths the page offers: the ones the server lists ({ minutes, priceCents }) that still have a free start at
  // least `leadMs` away (slots: minutes -> starts).
  function lengthsToShow(lengths, slots, now, leadMs) {
    return (lengths || []).filter(function (l) {
      return bookableStarts((slots && slots[l.minutes]) || [], now, leadMs).length > 0;
    });
  }

  var RETURN_CODES = ['pay_invalid', 'pay_unconfirmed', 'not_paid', 'late', 'paid', 'pay_closed'];

  // What PayPal's return left in the address (?paid=1, ?error=<code>, and &order=<id> for a payment not confirmed yet):
  // { kind: 'paid' }, { kind: 'error', code, order } or null. A code or order id of another shape is ignored.
  function returnNotice(search) {
    var params = {};
    String(search || '').replace(/^\?/, '').split('&').forEach(function (pair) {
      if (!pair) return;
      var at = pair.indexOf('=');
      var key = at < 0 ? pair : pair.slice(0, at);
      var value = at < 0 ? '' : pair.slice(at + 1);
      try { params[decodeURIComponent(key)] = decodeURIComponent(value); } catch (e) { /* a broken escape is ignored */ }
    });
    if (params.paid === '1') return { kind: 'paid' };
    if (RETURN_CODES.indexOf(params.error) >= 0) {
      var order = /^[A-Za-z0-9-]{1,64}$/.test(params.order || '') ? params.order : null;
      return { kind: 'error', code: params.error, order: params.error === 'pay_unconfirmed' ? order : null };
    }
    return null;
  }

  // Only a PayPal page is gone to after Pay, and only a Discord channel link is shown as a room.
  function isPayPalUrl(url) { return /^https:\/\/([a-z0-9-]+\.)*paypal\.com\//i.test(String(url || '')); }
  function isRoomUrl(url) { return /^https:\/\/discord\.com\/channels\/\d+\/\d+$/.test(String(url || '')); }

  // The starts a page left open still offers: at least `leadMs` from now, as the server counts them (the hour of
  // notice, /state's leadMs); without a lead, the starts still to come.
  function bookableStarts(starts, now, leadMs) {
    var lead = Number(leadMs) > 0 ? Number(leadMs) : 0;
    return (starts || []).filter(function (s) { return lead ? s >= now + lead : s > now; });
  }

  // The step the booking page opens at: 1 connect Discord (no viewer), 2 join the server (the bot does not see them in it),
  // 3 length (a member, or Discord could not say: member null lets them go on, with a warning). Step 4 (day, time and
  // message) is only ever reached with Next.
  function stepFor(state) {
    if (!state || !state.viewer) return 1;
    return state.member === false ? 2 : 3;
  }

  // Where Back goes from a step: 4 -> 3; 3 -> 2 unless they are a member (joining is done); 2 and 1 have no Back (the
  // viewer is connected already).
  function backStep(step, state) {
    if (step === 4) return 3;
    if (step === 3) return state && state.member === true ? null : 2;
    return null;
  }

  var CORE = { stepFor: stepFor, backStep: backStep, localDate: localDate, groupByLocalDay: groupByLocalDay, daysToShow: daysToShow, timeLabel: timeLabel,
    dayLabel: dayLabel, dateLabel: dateLabel, holds: holds, canCancel: canCancel, canPay: canPay, upcomingCount: upcomingCount,
    bookableStarts: bookableStarts, formatPrice: formatPrice, lengthLabel: lengthLabel, payByLabel: payByLabel,
    lengthsToShow: lengthsToShow, rescheduleMode: rescheduleMode, refundLine: refundLine, bookingFromSearch: bookingFromSearch, returnNotice: returnNotice, isPayPalUrl: isPayPalUrl, isRoomUrl: isRoomUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof window !== 'undefined') window.COACHING_CORE = CORE;
})();
