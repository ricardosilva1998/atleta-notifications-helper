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

  var HOLDING = ['waiting', 'confirmed'];

  // A booking the viewer can still cancel: waiting or confirmed, and not started.
  function canCancel(booking, now) {
    return HOLDING.indexOf(booking.state) >= 0 && booking.startsAt > now;
  }

  // How many of the viewer's bookings count toward the limit of upcoming ones.
  function upcomingCount(bookings, now) {
    return (bookings || []).filter(function (b) { return canCancel(b, now); }).length;
  }

  var CORE = { localDate: localDate, groupByLocalDay: groupByLocalDay, daysToShow: daysToShow, timeLabel: timeLabel,
    dayLabel: dayLabel, dateLabel: dateLabel, canCancel: canCancel, upcomingCount: upcomingCount };
  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof window !== 'undefined') window.COACHING_CORE = CORE;
})();
