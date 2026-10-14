'use strict';

// What the OBS alert overlay is told about a streamer's saved settings: which
// alerts are on, how long each one stays (seconds), the volume, and the URLs of
// the streamer's custom sounds. Every path that sends it goes through this one
// builder (a new connection, and the push after each save), so an overlay that
// has been open for hours and one that has just loaded always agree.

const { DURATIONS, YOUTUBE_DURATIONS, wholeSeconds, volumeOf } = require('./overlaySettings');
const customSounds = require('./customSounds');

// [alert type the overlay receives, enabled column, duration column]. The
// durations' defaults and limits are the ones a save applies (overlaySettings).
const TWITCH_ALERTS = [
  ['follow', 'overlay_follow_enabled', 'overlay_follow_duration'],
  ['subscription', 'overlay_sub_enabled', 'overlay_sub_duration'],
  ['bits', 'overlay_bits_enabled', 'overlay_bits_duration'],
  ['donation', 'overlay_donation_enabled', 'overlay_donation_duration'],
  ['raid', 'overlay_raid_enabled', 'overlay_raid_duration'],
  ['giveaway_winner', 'overlay_giveaway_enabled', 'overlay_giveaway_duration'],
];

// The YouTube alerts: the toggles are saved on the YouTube chatbot page, the
// durations on the overlay settings page.
const YOUTUBE_ALERTS = [
  ['yt_superchat', 'yt_overlay_superchat_enabled', 'yt_overlay_superchat_duration'],
  ['yt_member', 'yt_overlay_member_enabled', 'yt_overlay_member_duration'],
  ['yt_giftmember', 'yt_overlay_giftmember_enabled', 'yt_overlay_giftmember_duration'],
];
const SECONDS = new Map([...DURATIONS, ...YOUTUBE_DURATIONS].map(([column, fallback, longest]) => [column, { fallback, longest }]));

// An alert is on unless its column holds an explicit 0 (the columns default to 1).
function isOn(value) {
  return value === undefined || value === null || Number(value) !== 0;
}

// { follow: { enabled, duration }, ..., volume, sounds } for a streamer row.
// `options.soundsRoot` only exists so tests can point at a temporary folder.
function buildOverlayConfig(streamer, options = {}) {
  const config = {};
  for (const [type, enabledColumn, durationColumn] of [...TWITCH_ALERTS, ...YOUTUBE_ALERTS]) {
    const { fallback, longest } = SECONDS.get(durationColumn);
    config[type] = { enabled: isOn(streamer[enabledColumn]), duration: wholeSeconds(streamer[durationColumn], fallback, longest) };
  }
  // 0 is a real volume (silent); only a missing or unreadable value gets the default.
  config.volume = volumeOf(streamer.overlay_volume);
  // { type: '/overlay/sounds/<token>/<type>?v=<mtimeMs>' } for each custom sound
  config.sounds = customSounds.soundUrls(streamer, options.soundsRoot);
  return config;
}

module.exports = { buildOverlayConfig, TWITCH_ALERTS, YOUTUBE_ALERTS };
