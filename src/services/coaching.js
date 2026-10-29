'use strict';

// The rules of coaching sessions: a streamer's weekly hours, the times a viewer
// can book, and what state a booking is in. Pure: no database, no network; the
// clock and the zone are passed in. Weekly hours are 7 entries, index 0 =
// Monday ... 6 = Sunday, as { on, start, end } with minutes of the day, in the
// streamer's own zone (so 18:00 stays 18:00 across a clock change).

const { offsetAt, localDate } = require('./goalPeriods');

const LENGTHS = [30, 60];
const STEP_MINUTES = 30;
const HORIZON_DAYS = 14;
const LEAD_MS = 3600000;
const MAX_UPCOMING = 2;
// Requests one viewer may make of one streamer in any 24 h, whatever became of them (each messages the streamer).
const MAX_REQUESTS_PER_DAY = 6;
const NOTE_MAX = 300;
const WHERE_MAX = 150;
const DAYS_OFF_MAX = 60;
const INVITE_CHECK_MS = 3600000;
const HOLDING = ['waiting', 'confirmed'];
const STATES = ['waiting', 'confirmed', 'declined', 'cancelled', 'withdrawn'];

const DAY_MS = 86400e3;
const MINUTE_MS = 60e3;

// Monday to Friday 18:00-22:00; the weekend is off but keeps its window.
const DEFAULT_HOURS = Object.freeze(Array.from({ length: 7 }, (_, i) =>
  Object.freeze({ on: i < 5, start: 1080, end: 1320 })));

function parseHours(value) {
  const bad = { ok: false, code: 'bad_hours' };
  if (!Array.isArray(value) || value.length !== 7) return bad;
  const hours = [];
  for (const d of value) {
    if (!d || typeof d.on !== 'boolean') return bad;
    const { start, end } = d;
    if (!Number.isInteger(start) || !Number.isInteger(end)) return bad;
    if (start % STEP_MINUTES !== 0 || end % STEP_MINUTES !== 0) return bad;
    if (start < 0 || start >= end || end > 1440) return bad;
    hours.push({ on: d.on, start, end });
  }
  return { ok: true, hours };
}

// A real calendar date written YYYY-MM-DD (2026-02-30 is not one).
function isIsoDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  return new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
}

function parseDaysOff(list, todayIso) {
  const bad = { ok: false, code: 'bad_days_off' };
  if (!Array.isArray(list) || !list.every(isIsoDate)) return bad;
  const daysOff = [...new Set(list)].filter((d) => d >= todayIso).sort();
  if (daysOff.length > DAYS_OFF_MAX) return bad;
  return { ok: true, daysOff };
}

const INVITE_CODE = /^[A-Za-z0-9-]{2,32}$/;
const INVITE_LINK = /^(?:https?:\/\/)?(?:discord\.gg|discord\.com\/invite)\/([^/?#\s]+)\/?(?:[?#].*)?$/i;

// The code of a Discord invite, from a link or the bare code; null for anything else.
function parseInvite(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  const link = INVITE_LINK.exec(t);
  const code = link ? link[1] : t;
  return INVITE_CODE.test(code) ? code : null;
}

// Trimmed, each line break one space, the other control characters removed, at most `max` code points.
function cleanText(text, max) {
  if (typeof text !== 'string') return null;
  const clean = text.replace(/\r\n|\r|\n/g, ' ').replace(/\p{Cc}/gu, '').trim();
  return Array.from(clean).length <= max ? clean : null;
}

function parseWhere(text) {
  const where = cleanText(text, WHERE_MAX);
  return where === null ? { ok: false, code: 'bad_where' } : { ok: true, where };
}

function parseNote(text) {
  const note = cleanText(text, NOTE_MAX);
  return note === null ? { ok: false, code: 'bad_note' } : { ok: true, note };
}

const pad = (n, width = 2) => String(n).padStart(width, '0');

function localDateOf(ms, timeZone) {
  const { y, m, d } = localDate(ms, timeZone);
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

// The UTC instant of a wall time on a date in the zone, by the method of
// goalPeriods' localMidnight: the zone's offset the day before and the day
// after are the only ones that can apply; a candidate counts when the zone
// really has that offset there. A time that happens twice takes the earlier
// instant; a time the zone skips has no candidate and gives null.
function localInstant(isoDate, minuteOfDay, timeZone) {
  const wall = Date.parse(`${isoDate}T00:00:00Z`) + minuteOfDay * MINUTE_MS;
  const before = offsetAt(wall - DAY_MS, timeZone);
  const after = offsetAt(wall + DAY_MS, timeZone);
  let earliest = null;
  for (const offset of new Set([before, after])) {
    const candidate = wall - offset;
    if (offsetAt(candidate, timeZone) === offset && (earliest === null || candidate < earliest)) earliest = candidate;
  }
  return earliest;
}

// 0 = Monday ... 6 = Sunday for a YYYY-MM-DD date.
function weekdayOf(isoDate) {
  return (new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7;
}

// Every start (UTC ms, ascending) a viewer can book for `minutes`: the next 14
// local days from today, on the half hours inside each open day's window, at
// least an hour from now, not overlapping a held booking.
function freeStarts({ hours, timeZone, daysOff, held, now, minutes }) {
  const today = localDateOf(now, timeZone);
  const off = new Set(daysOff);
  const starts = [];
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const date = new Date(Date.parse(`${today}T00:00:00Z`) + i * DAY_MS).toISOString().slice(0, 10);
    const day = hours[weekdayOf(date)];
    if (!day.on || off.has(date)) continue;
    for (let m = day.start; m <= day.end - minutes; m += STEP_MINUTES) {
      const s = localInstant(date, m, timeZone);
      if (s === null || s < now + LEAD_MS) continue;
      const end = s + minutes * MINUTE_MS;
      if (held.some((h) => s < h.startsAt + h.minutes * MINUTE_MS && h.startsAt < end)) continue;
      starts.push(s);
    }
  }
  return starts;
}

// A stored 'waiting' whose start has come is 'unanswered' (never stored).
function bookingState(booking, now) {
  if (booking.status === 'waiting' && booking.starts_at <= now) return 'unanswered';
  return booking.status;
}

// Whether a booking no longer fits the streamer's hours (a day was blocked or
// the window shortened after it was made).
function outsideHours(booking, { hours, timeZone, daysOff }) {
  const at = booking.starts_at;
  const date = localDateOf(at, timeZone);
  const day = hours[weekdayOf(date)];
  if (!day.on || daysOff.includes(date)) return true;
  const minute = Math.floor((((at + offsetAt(at, timeZone)) % DAY_MS) + DAY_MS) % DAY_MS / MINUTE_MS);
  return minute < day.start || minute + booking.minutes > day.end;
}

// A viewer can book only when the streamer is open, the server is still theirs,
// and the invite is set and not known to be refused.
function bookable(settings, claimedGuildIds) {
  return !!settings && !!settings.open && claimedGuildIds.includes(settings.guild_id)
    && !!settings.invite_code && settings.invite_ok !== 0;
}

module.exports = {
  LENGTHS, STEP_MINUTES, HORIZON_DAYS, LEAD_MS, MAX_UPCOMING, MAX_REQUESTS_PER_DAY, NOTE_MAX, WHERE_MAX, DAYS_OFF_MAX,
  INVITE_CHECK_MS, HOLDING, STATES, DEFAULT_HOURS,
  parseHours, parseDaysOff, parseInvite, parseWhere, parseNote,
  localDateOf, localInstant, freeStarts, bookingState, outsideHours, bookable,
};
