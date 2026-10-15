'use strict';

// The looks an alert can take, for the server (docs/superpowers/specs/2026-10-15-alert-styles-design.md).
// Read from the registry the OBS overlay and the Overlay Builder draw with (public/overlay/objects/:
// kit.js and the family files, which also run in Node), so the list of looks exists once.

const fs = require('fs');
const path = require('path');

const OBJECTS_DIR = path.join(__dirname, '..', '..', 'public', 'overlay', 'objects');
const KIT = require(path.join(OBJECTS_DIR, 'kit.js'));
fs.readdirSync(path.join(OBJECTS_DIR, 'styles')).filter((f) => f.endsWith('.js')).sort()
  .forEach((f) => require(path.join(OBJECTS_DIR, 'styles', f)));

// Looks made for one streamer, found by their Twitch user id (never a row number). Only they see
// it in the builder, and the save refuses it for anyone else.
const PRIVATE_STYLES = Object.freeze({
  'donation-c1': Object.freeze({ eventType: 'donation', twitchUserId: '632557806' }),
});

// Looks that belong to no family and that every streamer may pick, for one alert: the C1 billboard
// trailer with the streamer's own Twitch name on its rear window (index.js; the page hands it the
// name). The gallery lists them after a look made for the streamer and before the families.
const STANDALONE_STYLES = Object.freeze({
  'donation-c1-channel': Object.freeze({ eventType: 'donation' }),
});

// What an alert draws while its design names no look: today's object for the five Twitch alerts,
// Racing's Victory lap for the giveaway (improved in place).
const DEFAULT_STYLES = Object.freeze({
  follow: 'follow-samurai', subscription: 'subscriber-samurai', bits: 'bits-samurai',
  donation: 'donation-samurai', raid: 'raid-samurai', giveaway_winner: 'giveaway-racing',
});

function isAlert(eventType) { return KIT.ALERTS.includes(eventType); }
function lookOf(styleId) { return typeof styleId === 'string' && Object.hasOwn(KIT.styles, styleId) ? KIT.styles[styleId] : null; }

function standaloneFor(eventType) {
  return Object.keys(STANDALONE_STYLES).filter((id) => STANDALONE_STYLES[id].eventType === eventType && !!lookOf(id));
}

function ownsPrivate(styleId, eventType, streamer) {
  const owner = PRIVATE_STYLES[styleId];
  return !!owner && owner.eventType === eventType && !!streamer && String(streamer.twitch_user_id) === owner.twitchUserId && !!lookOf(styleId);
}

// Whether `styleId` may be saved for `eventType` by `streamer`: null (the default look) always; a
// public look of that alert (a family's, or one that belongs to none); or the streamer's own private one.
function canUseStyle(styleId, eventType, streamer) {
  if (styleId === null) return true;
  if (typeof styleId !== 'string' || !isAlert(eventType)) return false;
  if (Object.hasOwn(PRIVATE_STYLES, styleId)) return ownsPrivate(styleId, eventType, streamer);
  if (Object.hasOwn(STANDALONE_STYLES, styleId)) return standaloneFor(eventType).includes(styleId);
  return KIT.looksOf(eventType).some((look) => look.key === styleId);
}

// The builder's gallery for one alert: a look made for this streamer first, then the public looks
// that belong to no family, then every family's look in family order. Each entry: { id, family, mine }.
function galleryFor(eventType, streamer) {
  if (!isAlert(eventType)) return [];
  const mine = Object.keys(PRIVATE_STYLES).filter((id) => ownsPrivate(id, eventType, streamer)).map((id) => ({ id, family: null, mine: true }));
  const open = standaloneFor(eventType).map((id) => ({ id, family: null, mine: false }));
  return mine.concat(open, KIT.looksOf(eventType).map((look) => ({ id: look.key, family: look.family, mine: false })));
}

// "Use <family> for all six alerts": the family's look for each alert, or null when the family is
// unknown or does not draw all six.
function familyStyles(familyKey) {
  if (typeof familyKey !== 'string' || !Object.hasOwn(KIT.families, familyKey)) return null;
  const map = {};
  for (const alert of KIT.ALERTS) {
    const look = KIT.looksOf(alert).find((l) => l.family === familyKey);
    if (!look) return null;
    map[alert] = look.key;
  }
  return map;
}

// Families in the gallery's order, every public look id, and the sound keys a design may name
// ('today': the alert's sound before release A; 'none': silent).
function familyKeys() { return Object.keys(KIT.families).sort((a, b) => KIT.families[a].order - KIT.families[b].order); }
function lookIds() { return KIT.ALERTS.flatMap((alert) => KIT.looksOf(alert).map((look) => look.key)); }
function soundKeys() { return ['today', 'none'].concat(Object.keys(KIT.sounds).sort()); }
// The looks' sounds by family, in the gallery's order: [{ family, sounds: [key, …] }].
function soundGroups() {
  return familyKeys().map((family) => ({ family, sounds: Object.keys(KIT.sounds).filter((key) => KIT.soundFamilies[key] === family) }))
    .filter((group) => group.sounds.length);
}
// The Google Fonts specs (for one stylesheet link) of the given families.
function fontsOf(families) {
  return [...new Set(families.flatMap((key) => (KIT.families[key] ? KIT.families[key].fonts : [])))];
}

module.exports = {
  ALERTS: KIT.ALERTS, PRIVATE_STYLES, STANDALONE_STYLES, DEFAULT_STYLES, isAlert, lookOf, canUseStyle, galleryFor, familyStyles, familyKeys, lookIds, soundKeys, soundGroups, fontsOf,
};
