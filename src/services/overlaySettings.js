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
// Every duration column holds seconds, the giveaway one included (db.js adds it
// with DEFAULT 8 and converts a stray 8000 back), and the overlay reads them
// as seconds.
const DURATIONS = [
  ['overlay_follow_duration', 5, 30],
  ['overlay_sub_duration', 7, 30],
  ['overlay_bits_duration', 6, 30],
  ['overlay_donation_duration', 6, 30],
  ['overlay_raid_duration', 7, 30],
  ['overlay_giveaway_duration', 8, 60],
];
const MIN_DURATION_SECONDS = 1;
const GIVEAWAY_DURATION = DURATIONS.find(([column]) => column === 'overlay_giveaway_duration');

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
  STREAMELEMENTS_JWT_MAX,
  parseOverlaySettings,
  decideStreamElementsJwt,
  giveawayDurationSeconds,
};
