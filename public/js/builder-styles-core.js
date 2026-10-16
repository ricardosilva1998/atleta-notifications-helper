'use strict';

/**
 * The Overlay Builder's Style section (docs/superpowers/specs/2026-10-15-alert-styles-design.md, 4.6),
 * the parts that need no page: which alerts have looks, which controls a look shows, what picking
 * another look does to the working design, the gallery's order and what a save sends. The page code
 * is in src/views/overlay-builder.ejs. Dual-exported: a browser global for <script src>, CommonJS
 * for tests/builderStylesCore.test.js.
 */
(function (root) {
  // The six alerts that have looks; YouTube's alerts and timed messages keep today's card.
  var STYLED_ALERTS = ['follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner'];
  function isStyled(type) { return STYLED_ALERTS.indexOf(type) >= 0; }

  function copy(design) {
    var out = {}, k;
    for (k in design) if (Object.prototype.hasOwnProperty.call(design, k)) out[k] = design[k];
    return out;
  }

  // A look's settings, as another look starts them (the server does the same in
  // db.setOverlayDesignStyle): its colour, main text, sound and growing with the amount empty (the
  // look's own), the screen effect 'default' (the look's own) and the speed 1. Where the alert sits,
  // its width and Racing's colours stay.
  var LOOK_SETTINGS = { style_accent: null, style_label: null, style_sound: null, style_grows: null, screen_effect: 'default', animation_speed: 1 };
  function startLook(design) {
    var out = copy(design), k;
    for (k in LOOK_SETTINGS) out[k] = LOOK_SETTINGS[k];
    return out;
  }
  function withLook(design, previousStyle, nextStyle) {
    return (previousStyle || null) === (nextStyle || null) ? copy(design) : startLook(design);
  }
  // After "Use <family> for all six alerts": an alert's working design takes the look the server
  // stored and that look's settings (started afresh there), and keeps what the streamer edited and
  // has not saved yet. An alert whose tab was never opened is the stored row.
  function lookApplied(working, row) {
    var out = copy(working || row), k;
    out.style = row.style;
    for (k in LOOK_SETTINGS) out[k] = row[k];
    return out;
  }

  // The look the page shows for an alert: the one picked or saved, else the alert's default look
  // (the server's DEFAULT_STYLES, services/alertStyles.js); null for the tabs without looks.
  function shownStyle(type, alertStyles, defaults) {
    if (!isStyled(type)) return null;
    return (alertStyles && alertStyles[type]) || (defaults && defaults[type]) || null;
  }

  // An alert nobody has given a look (no stored look) is shown as its default look (Glass's) comes,
  // with that look's own settings: what an older builder saved for today's card (an effect, a speed)
  // is not what the OBS overlay plays (kit.js ownSettings), so the builder does not show it either.
  function untouched(type, design, storedStyle) {
    if (storedStyle || !isStyled(type)) return design;
    return startLook(design);
  }

  // The controls a look shows (its `controls`, objects/kit.js): its colour (the accent, or Racing's
  // card, accent and name colours and the name's font), its main text and its speed; the screen
  // effect for a look of the styles (today's objects and the C1 never play one); the sound for
  // every look; growing with the amount where the look grows.
  function controlsFor(look) {
    var c = (look && look.controls) || {};
    return {
      accent: c.colour === 'accent', racing: c.colour === 'racing', label: !!c.label, speed: !!c.speed,
      effect: !!(look && look.family), sound: !!look, grows: !!(look && look.grows),
    };
  }

  // One alert's gallery (the server's entries { id, family, mine }, in family order): a look made for
  // this streamer first ('mine', "Made for you"), then the alert's default look ('default', Glass's),
  // then the others.
  function orderGallery(entries, type, defaults) {
    var def = defaults && defaults[type];
    var mine = [], first = [], rest = [];
    (entries || []).forEach(function (e) {
      if (e.mine) mine.push({ id: e.id, family: e.family, badge: 'mine' });
      else if (e.id === def) first.push({ id: e.id, family: e.family, badge: 'default' });
      else rest.push({ id: e.id, family: e.family, badge: null });
    });
    return mine.concat(first, rest);
  }
  // The gallery for a family filter: 'all', or one family's looks.
  function filterGallery(ordered, family) {
    return family === 'all' ? ordered.slice() : ordered.filter(function (e) { return e.family === family; });
  }

  // The body of a save: the alert, its design, and for the six alerts the look the page shows.
  function savePayload(type, design, style) {
    var body = { eventType: type, design: design };
    if (isStyled(type)) body.style = style || null;
    return body;
  }

  // The Sound row lists the sounds by theme (docs/features/look-sounds.md). The theme it shows: the one
  // the streamer is browsing, else the saved sound's, else the look's own family's, else the first.
  // `groups` is the page's [{ family, sounds: [{ key, name }] }] (each sound followed by its version 2).
  function soundThemeOf(browsing, styleSound, look, groups) {
    var families = groups.map(function (g) { return g.family; });
    if (browsing && families.indexOf(browsing) >= 0) return browsing;
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].sounds.some(function (s) { return s.key === styleSound; })) return groups[i].family;
    }
    if (look && look.family && families.indexOf(look.family) >= 0) return look.family;
    return families.length ? families[0] : null;
  }
  // A theme's sounds, in the page's order ([] for a theme it does not have).
  function soundsOfTheme(theme, groups) {
    for (var i = 0; i < groups.length; i++) if (groups[i].family === theme) return groups[i].sounds.slice();
    return [];
  }

  var CORE = {
    STYLED_ALERTS: STYLED_ALERTS, isStyled: isStyled, withLook: withLook, lookApplied: lookApplied, shownStyle: shownStyle, untouched: untouched,
    controlsFor: controlsFor, orderGallery: orderGallery, filterGallery: filterGallery, savePayload: savePayload,
    soundThemeOf: soundThemeOf, soundsOfTheme: soundsOfTheme,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (root) root.ATLETA_BUILDER_STYLES = CORE;
})(typeof window !== 'undefined' ? window : null);
