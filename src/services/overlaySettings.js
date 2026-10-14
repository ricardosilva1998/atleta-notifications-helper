'use strict';

// What a save on the overlay settings page (/dashboard/overlay) stores. The
// form's min/max attributes are a convenience only: every value is read,
// bounded and defaulted here.

// Alert toggles, in the form's order (the master switch comes first).
const TOGGLES = [
  'overlay_enabled',
  'overlay_follow_enabled', 'overlay_sub_enabled', 'overlay_bits_enabled',
  'overlay_donation_enabled', 'overlay_raid_enabled', 'overlay_giveaway_enabled',
];

// How long each alert stays on screen, in whole seconds: [column, default, longest].
// Every duration column holds seconds, the giveaway one included (db.js converts
// a stray 8000 back), and the overlay reads them as seconds. The defaults leave
// viewers time to read who followed, subscribed, cheered, donated or raided: a
// new streamer starts with them (db.js writes them into the new row), and an
// unreadable value falls back to them.
const DURATIONS = [
  ['overlay_follow_duration', 8, 30],
  ['overlay_sub_duration', 10, 30],
  ['overlay_bits_duration', 10, 30],
  ['overlay_donation_duration', 12, 30],
  ['overlay_raid_duration', 10, 30],
  ['overlay_giveaway_duration', 10, 60],
];
// The YouTube alerts' durations, on the same page. Their fields are only there
// while YouTube is shown, so a save without them keeps what is stored.
const YOUTUBE_DURATIONS = [
  ['yt_overlay_superchat_duration', 12, 30],
  ['yt_overlay_member_duration', 8, 30],
  ['yt_overlay_giftmember_duration', 10, 30],
];
const MIN_DURATION_SECONDS = 1;
const GIVEAWAY_DURATION = DURATIONS.find(([column]) => column === 'overlay_giveaway_duration');

// { column: default seconds } for every alert duration.
const DEFAULT_DURATION_SECONDS = Object.freeze(Object.fromEntries(
  [...DURATIONS, ...YOUTUBE_DURATIONS].map(([column, fallback]) => [column, fallback])
));
// The defaults before 2026-10-14. Tables made before then still give a new row
// these (SQLite cannot change a column's DEFAULT), and db.js moves every value
// still on them to the defaults above, once.
const PREVIOUS_DEFAULT_SECONDS = Object.freeze({
  overlay_follow_duration: 5, overlay_sub_duration: 7, overlay_bits_duration: 6,
  overlay_donation_duration: 6, overlay_raid_duration: 7, overlay_giveaway_duration: 8,
  yt_overlay_superchat_duration: 6, yt_overlay_member_duration: 5, yt_overlay_giftmember_duration: 6,
});

const DEFAULT_VOLUME = 0.8;

// A StreamElements JWT is a few hundred characters; anything far beyond that
// is not one.
const STREAMELEMENTS_JWT_MAX = 2000;

function wholeSeconds(value, fallback, longest) {
  const seconds = Number.parseInt(String(value), 10);
  if (!Number.isFinite(seconds)) return fallback;
  return Math.min(Math.max(seconds, MIN_DURATION_SECONDS), longest);
}

// 0 is a real volume (silent); only a missing or unreadable value gets the default.
function volumeOf(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_VOLUME;
  const volume = Number.parseFloat(String(value));
  if (!Number.isFinite(volume)) return DEFAULT_VOLUME;
  return Math.min(Math.max(volume, 0), 1);
}

// The giveaway alert's length in seconds, as the settings page shows it.
function giveawayDurationSeconds(stored) {
  const [, fallback, longest] = GIVEAWAY_DURATION;
  return wholeSeconds(stored, fallback, longest);
}

// A save never reveals or erases the stored StreamElements token by accident:
//   - a typed token replaces it,
//   - the "remove" box clears it (and wins over a typed token),
//   - anything else, a blank field included, keeps what is stored.
// Returns the token held afterwards and whether that differs from `stored`.
function decideStreamElementsJwt({ typed, remove, stored }) {
  const current = stored || null;
  if (remove) return { value: null, changed: current !== null };
  const candidate = typeof typed === 'string' ? typed.trim() : '';
  if (!candidate || candidate.length > STREAMELEMENTS_JWT_MAX) return { value: current, changed: false };
  return { value: candidate, changed: candidate !== current };
}

// body: the submitted form; stored: the streamer's row (only the token is read).
// Returns { columns, streamElementsJwt }: the columns to write (the token's only
// when it changes) and the token held after the save.
function parseOverlaySettings(body, stored) {
  const form = body && typeof body === 'object' ? body : {};
  const columns = {};
  for (const name of TOGGLES) columns[name] = form[name] ? 1 : 0;
  for (const [name, fallback, longest] of DURATIONS) columns[name] = wholeSeconds(form[name], fallback, longest);
  for (const [name, fallback, longest] of YOUTUBE_DURATIONS) {
    if (form[name] !== undefined) columns[name] = wholeSeconds(form[name], fallback, longest);
  }
  columns.overlay_volume = volumeOf(form.overlay_volume);

  const jwt = decideStreamElementsJwt({
    typed: form.streamelements_jwt,
    remove: !!form.streamelements_jwt_remove,
    stored: stored && stored.streamelements_jwt,
  });
  if (jwt.changed) columns.streamelements_jwt = jwt.value;
  return { columns, streamElementsJwt: jwt.value };
}

module.exports = {
  TOGGLES,
  DURATIONS,
  YOUTUBE_DURATIONS,
  DEFAULT_DURATION_SECONDS,
  PREVIOUS_DEFAULT_SECONDS,
  STREAMELEMENTS_JWT_MAX,
  parseOverlaySettings,
  decideStreamElementsJwt,
  giveawayDurationSeconds,
  // Shared with services/overlayConfig.js, which sends the saved values to the
  // OBS overlay with the same bounds a save applies.
  wholeSeconds,
  volumeOf,
};
