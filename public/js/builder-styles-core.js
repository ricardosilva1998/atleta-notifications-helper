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

  // --- The alert cards and the edit window ---

  // The cards of the builder's grid, in order: the six alerts with looks, the timed messages and the
  // three YouTube alerts. The page shows the ones its features allow.
  var CARD_TYPES = ['follow', 'subscription', 'bits', 'donation', 'raid', 'giveaway_winner', 'timed', 'yt_superchat', 'yt_member', 'yt_giftmember'];

  // The tabs of a card's edit window: the six alerts have a look to animate and customize and a sound;
  // timed messages have their images; YouTube's alerts keep today's design; every card has its place.
  function tabsFor(type) {
    if (isStyled(type)) return ['animation', 'customize', 'sound', 'location'];
    if (type === 'timed') return ['images', 'design', 'location'];
    if (type === 'yt_superchat' || type === 'yt_member' || type === 'yt_giftmember') return ['design', 'location'];
    return [];
  }

  // The card a ?tab= opens: only one the page shows (an unknown or hidden name, or none, opens nothing).
  function cardForTab(tab, shownTypes) {
    return typeof tab === 'string' && (shownTypes || []).indexOf(tab) >= 0 ? tab : null;
  }

  // Which look, and so which alert, each sound belongs to: { [soundKey]: { eventType, look } } for every
  // look of a family that has a sound of its own.
  function soundOwners(styles) {
    var owners = {}, id, look;
    for (id in styles) {
      if (!Object.prototype.hasOwnProperty.call(styles, id)) continue;
      look = styles[id];
      if (look && look.family && look.sound) owners[look.sound] = { eventType: look.eventType, look: look };
    }
    return owners;
  }
  // A sound's owner; a second version ('<key>.2') belongs to its first's. null for what no look owns
  // ('today', 'none', a key nobody registered).
  function ownerOfSound(key, owners) {
    var base = String(key).replace(/\.2$/, '');
    return Object.prototype.hasOwnProperty.call(owners, base) ? owners[base] : null;
  }
  // The page's sound groups ([{ family, sounds: [{ key, name }] }]) cut to one alert's: the sounds of
  // the looks made for it, in the page's order; a theme with none left is dropped.
  function soundGroupsFor(type, groups, owners) {
    var out = [];
    (groups || []).forEach(function (g) {
      var sounds = g.sounds.filter(function (s) {
        var owner = ownerOfSound(s.key, owners);
        return !!owner && owner.eventType === type;
      });
      if (sounds.length) out.push({ family: g.family, sounds: sounds });
    });
    return out;
  }
  function listsSound(groups, key) {
    return (groups || []).some(function (g) { return g.sounds.some(function (s) { return s.key === key; }); });
  }
  // The rows of the Sound tab's "This look" list: the look's own sound, its version 2 when there is
  // one, the classic engine sound and no sound. A saved sound that is none of those and that the alert's
  // own list (`alertGroups`) does not offer comes first as "current", so the list never loses it.
  function thisLookRows(look, styleSound, allGroups, alertGroups) {
    var rows = [], own = look && look.sound;
    if (own) {
      rows.push({ key: own, tag: 'own' });
      if (listsSound(allGroups, own + '.2')) rows.push({ key: own + '.2', tag: 'second' });
    }
    rows.push({ key: 'today', tag: 'today' }, { key: 'none', tag: 'none' });
    if (styleSound && !rows.some(function (r) { return r.key === styleSound; }) && !listsSound(alertGroups, styleSound)) {
      rows.unshift({ key: styleSound, tag: 'current' });
    }
    return rows;
  }

  // The look's speed as the design sets it (0.5-2), 1 for a look with no speed control.
  function speedOf(look, design) {
    var v = design && Number(design.animation_speed);
    if (!(look && look.controls && look.controls.speed) || !isFinite(v) || v <= 0) return 1;
    return Math.min(2, Math.max(0.5, v));
  }
  // How long the preview loop waits for a look: its entrance, and its exit (at least 400 ms, as the
  // OBS overlay holds it) at the speed.
  function loopTimings(look, speed) {
    var s = speed > 0 ? speed : 1;
    var inMs = parseFloat(look && look.anim && look.anim.dur) * 1000 / s;
    var exit = parseFloat(look && look.exit && look.exit.dur) * 1000 / s;
    return { inMs: isFinite(inMs) ? inMs : 0, exitMs: Math.max(400, isFinite(exit) ? exit : 0) };
  }

  // Where an alert sits, as the Location tab shows it: free (dragged: card_custom_x and _y are both
  // numbers, the rule of overlay/placement.js) or one of the nine cells, 0-8 in reading order.
  var VERTICAL = ['top', 'mid', 'bot'], HORIZONTAL = ['left', 'center', 'right'];
  function placeSummary(design) {
    var d = design || {};
    var parts = String(d.card_position || 'top-center').split('-');
    var row = Math.max(0, VERTICAL.indexOf(parts[0]));
    var col = HORIZONTAL.indexOf(parts[1]);
    if (col < 0) col = 1;
    var free = typeof d.card_custom_x === 'number' && isFinite(d.card_custom_x) && typeof d.card_custom_y === 'number' && isFinite(d.card_custom_y);
    return { free: free, position: VERTICAL[row] + '-' + HORIZONTAL[col], cell: free ? -1 : row * 3 + col };
  }
  // A dragged slot's top-left corner (pixels on the 1920x1080 stage) as the fractions the design stores,
  // rounded to three decimals and kept so the w x h slot stays on the stage.
  function clampFree(x, y, w, h) {
    var STAGE_W = 1920, STAGE_H = 1080;
    var cx = Math.min(Math.max(0, STAGE_W - w), Math.max(0, x));
    var cy = Math.min(Math.max(0, STAGE_H - h), Math.max(0, y));
    return { x: Math.round(cx / STAGE_W * 1000) / 1000, y: Math.round(cy / STAGE_H * 1000) / 1000 };
  }

  var CORE = {
    STYLED_ALERTS: STYLED_ALERTS, isStyled: isStyled, withLook: withLook, lookApplied: lookApplied, shownStyle: shownStyle, untouched: untouched,
    controlsFor: controlsFor, orderGallery: orderGallery, filterGallery: filterGallery, savePayload: savePayload,
    CARD_TYPES: CARD_TYPES, tabsFor: tabsFor, cardForTab: cardForTab, soundOwners: soundOwners, ownerOfSound: ownerOfSound,
    soundGroupsFor: soundGroupsFor, thisLookRows: thisLookRows, speedOf: speedOf, loopTimings: loopTimings, placeSummary: placeSummary, clampFree: clampFree,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (root) root.ATLETA_BUILDER_STYLES = CORE;
})(typeof window !== 'undefined' ? window : null);
