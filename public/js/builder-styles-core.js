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

  // The look the page shows for an alert: the one picked or saved, else the alert's default look
  // (the server's DEFAULT_STYLES, services/alertStyles.js); null for the tabs without looks.
  function shownStyle(type, alertStyles, defaults) {
    if (!isStyled(type)) return null;
    return (alertStyles && alertStyles[type]) || (defaults && defaults[type]) || null;
  }

  // An alert nobody has restyled since the looks came (no stored look) is shown with its default
  // look's own settings: what an older builder saved for today's card (an effect, a speed) is not
  // what the OBS overlay plays, so the builder does not show it either. The giveaway keeps its
  // saved effect and speed: they carry over to its Victory lap.
  function untouched(type, design, storedStyle) {
    if (storedStyle || !isStyled(type) || type === 'giveaway_winner') return design;
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
  // this streamer first ('mine', "Made for you"), then the alert's default look ('today', or 'default'
  // for the giveaway, whose default is not today's card), then the others.
  function orderGallery(entries, type, defaults) {
    var def = defaults && defaults[type];
    var mine = [], first = [], rest = [];
    (entries || []).forEach(function (e) {
      if (e.mine) mine.push({ id: e.id, family: e.family, badge: 'mine' });
      else if (e.id === def) first.push({ id: e.id, family: e.family, badge: type === 'giveaway_winner' ? 'default' : 'today' });
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

  var CORE = {
    STYLED_ALERTS: STYLED_ALERTS, isStyled: isStyled, withLook: withLook, shownStyle: shownStyle, untouched: untouched,
    controlsFor: controlsFor, orderGallery: orderGallery, filterGallery: filterGallery, savePayload: savePayload,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (root) root.ATLETA_BUILDER_STYLES = CORE;
})(typeof window !== 'undefined' ? window : null);
