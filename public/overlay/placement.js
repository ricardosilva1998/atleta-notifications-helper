'use strict';

/**
 * Where an alert sits on the 1920x1080 canvas, read from a saved design
 * (card_position, card_custom_x/y, card_width). Consumed by BOTH render paths,
 * like the object registry, so they cannot read a design differently:
 *   1. public/overlay/overlay.js        (the real OBS overlay)
 *   2. src/views/overlay-builder.ejs    (the builder's live preview)
 *
 * Dual-exported: a browser global for <script src>, CommonJS for node:test.
 * Do not add a build step; this file is served verbatim by express.static.
 */

(function () {
  var MARGIN = 16;          // px from the screen edge for the nine grid positions
  var DEFAULT_WIDTH = 420;
  var MIN_WIDTH = 200;      // the resize handle in the builder, and the server, allow 200-900
  var MAX_WIDTH = 900;

  function isNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  // { width, vertical: top|mid|bot, horizontal: left|center|right, custom: {x, y}|null }
  // A value that is missing or not usable gets its default (top-center, 420px). 0 is a
  // real position: a card dragged to the very left edge has card_custom_x 0.
  function placementOf(design) {
    var d = design || {};
    var width = isNumber(d.card_width)
      ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(d.card_width)))
      : DEFAULT_WIDTH;
    var parts = String(d.card_position || 'top-center').split('-');
    var vertical = parts[0] === 'bot' ? 'bot' : parts[0] === 'mid' ? 'mid' : 'top';
    var horizontal = parts[1] === 'left' ? 'left' : parts[1] === 'right' ? 'right' : 'center';
    var custom = isNumber(d.card_custom_x) && isNumber(d.card_custom_y)
      ? { x: Math.min(1, Math.max(0, d.card_custom_x)), y: Math.min(1, Math.max(0, d.card_custom_y)) }
      : null;
    return { width: width, vertical: vertical, horizontal: horizontal, custom: custom };
  }

  // The inline style that puts an alert's slot there on the OBS page. Every edge is
  // set (the unused ones to "auto"), never cleared: a cleared edge would let the
  // stylesheet's own top/left come back and the slot would be stretched or shifted.
  function slotStyle(placement) {
    var p = placement || placementOf();
    var style = {
      width: p.width + 'px',
      maxWidth: '96%',
      top: 'auto', right: 'auto', bottom: 'auto', left: 'auto',
      transform: 'none',
    };
    if (p.custom) {
      // Free drag: x/y are the card's top-left corner, as a fraction of the screen.
      style.left = (p.custom.x * 100) + '%';
      style.top = (p.custom.y * 100) + '%';
      return style;
    }
    var shiftX = '0';
    var shiftY = '0';
    if (p.horizontal === 'left') style.left = MARGIN + 'px';
    else if (p.horizontal === 'right') style.right = MARGIN + 'px';
    else { style.left = '50%'; shiftX = '-50%'; }
    if (p.vertical === 'bot') style.bottom = MARGIN + 'px';
    else if (p.vertical === 'mid') { style.top = '50%'; shiftY = '-50%'; }
    else style.top = MARGIN + 'px';
    if (shiftX !== '0' || shiftY !== '0') style.transform = 'translate(' + shiftX + ', ' + shiftY + ')';
    return style;
  }

  var PLACEMENT = { MARGIN: MARGIN, DEFAULT_WIDTH: DEFAULT_WIDTH, MIN_WIDTH: MIN_WIDTH, MAX_WIDTH: MAX_WIDTH, placementOf: placementOf, slotStyle: slotStyle };

  if (typeof module !== 'undefined' && module.exports) module.exports = PLACEMENT;
  if (typeof window !== 'undefined') window.ATLETA_PLACEMENT = PLACEMENT;
})();
