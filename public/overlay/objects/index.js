'use strict';

/**
 * Alert object registry — the single source of truth for the five Twitch
 * alert objects. Consumed by BOTH render paths:
 *   1. public/overlay/overlay.js        (the real OBS overlay)
 *   2. src/views/overlay-builder.ejs    (the builder's live preview)
 *
 * Dual-exported: a browser global for <script src>, CommonJS for node:test.
 * Do not add a build step; this file is served verbatim by express.static.
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

var OBJECTS = {
  follow: {
    key: 'follow',
    anim: { in: 'cutWipe', dur: '0.40s', ease: 'cubic-bezier(.25,0,.15,1)' },
    exit: { out: 'exSheathe', dur: '0.34s', ease: 'cubic-bezier(.5,0,.9,.3)' },
    render: function (d) {
      return '<div class="obj o-follow">'
        + '<div class="o-follow-hatch"></div><div class="o-mesh"></div>'
        + '<div class="o-follow-glyph">✦</div>'
        + '<div class="o-follow-txt">'
        +   '<div class="o-name">' + esc(d.username) + '</div>'
        +   '<div class="o-meta">started following</div>'
        + '</div>'
        + '<div class="o-follow-scar"></div><div class="o-blade"></div>'
        + '</div>';
    },
  },
  subscription: {
    key: 'subscription',
    anim: { in: 'hold', dur: '1.26s', ease: 'linear' },
    exit: { out: 'exGateFall', dur: '0.40s', ease: 'cubic-bezier(.5,0,.9,.4)' },
    render: function (d) {
      var meta = 'Tier ' + esc(d.tier || '1');
      if (d.months) meta += ' · ' + esc(d.months) + ' months';
      return '<div class="obj o-sub">'
        + '<div class="o-sub-pillar l"></div><div class="o-sub-pillar r"></div>'
        + '<div class="o-sub-base l"></div><div class="o-sub-base r"></div>'
        + '<div class="o-sub-dust"></div>'
        + '<div class="o-sub-kasagi"></div><div class="o-sub-nuki"></div>'
        + '<div class="o-sub-cords"></div>'
        + '<div class="o-sub-gaku"><div class="o-mesh"></div>'
        +   '<div class="o-sub-mark">Subscriber</div>'
        +   '<div class="o-name">' + esc(d.username) + '</div>'
        +   '<div class="o-meta">' + meta + '</div>'
        + '</div></div>';
    },
  },
  bits: {
    key: 'bits',
    anim: { in: 'oBitsIn', dur: '0.20s', ease: 'cubic-bezier(.2,1,.2,1)' },
    exit: { out: 'exBoardTip', dur: '0.34s', ease: 'ease-in' },
    render: function (d) {
      var digits = String(Math.max(0, parseInt(d.bits, 10) || 0));
      var tiles = '';
      for (var i = 0; i < digits.length; i++) {
        tiles += '<span class="o-bits-tile" style="--rdelay:calc('
              + (0.20 + i * 0.12).toFixed(2) + 's / var(--spd))">' + digits.charAt(i) + '</span>';
      }
      return '<div class="obj o-bits">'
        + '<div class="o-bits-br tl"></div><div class="o-bits-br tr"></div>'
        + '<div class="o-bits-br bl"></div><div class="o-bits-br rb"></div>'
        + '<div class="o-bits-cells">' + tiles + '</div>'
        + '<div class="o-bits-who o-name">' + esc(d.username) + '</div>'
        + '<div class="o-bits-unit o-meta">bits</div>'
        + '<div class="o-blade"></div>'
        + '</div>';
    },
  },
  donation: {
    key: 'donation',
    anim: { in: 'hold', dur: '1.12s', ease: 'linear' },
    exit: { out: 'exScreenFold', dur: '0.36s', ease: 'cubic-bezier(.5,0,.9,.4)' },
    render: function (d) { return ''; },
  },
  raid: {
    key: 'raid',
    anim: { in: 'hold', dur: '0.94s', ease: 'linear' },
    exit: { out: 'exStrike', dur: '0.36s', ease: 'cubic-bezier(.5,0,.9,.4)' },
    render: function (d) { return ''; },
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = OBJECTS;
if (typeof window !== 'undefined') window.ATLETA_OBJECTS = OBJECTS;
