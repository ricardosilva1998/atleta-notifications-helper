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

var CURRENCY = { EUR: '€', USD: '$', GBP: '£', BRL: 'R$', JPY: '¥' };
function money(amount, currency) {
  var sym = CURRENCY[String(currency || '').toUpperCase()] || String(currency || '');
  return sym + String(amount == null ? '' : amount);
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
        +   (d.message ? '<div class="o-sub-msg">' + esc(d.message) + '</div>' : '')
        + '</div></div>';
    },
  },
  bits: {
    key: 'bits',
    anim: { in: 'oBitsIn', dur: '0.20s', ease: 'cubic-bezier(.2,1,.2,1)' },
    exit: { out: 'exBoardTip', dur: '0.34s', ease: 'ease-in' },
    render: function (d) {
      // Every real producer (eventsub.js, overlay.js test route, dashboard.js
      // test routes) emits `amount`; `bits` is kept only as a defensive fallback.
      var digits = String(Math.max(0, parseInt(d.amount != null ? d.amount : d.bits, 10) || 0));
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
    render: function (d) {
      var panels = '';
      for (var i = 0; i < 6; i++) {
        panels += '<div class="o-don-panel" style="--rdelay:calc('
               + (0.06 * (i + 1)).toFixed(2) + 's / var(--spd))"><div class="o-mesh"></div></div>';
      }
      return '<div class="obj o-don">'
        + '<div class="o-don-screen">' + panels + '</div>'
        + '<div class="o-don-rail t"></div><div class="o-don-rail b"></div>'
        + '<div class="o-don-face">'
        +   '<div class="o-don-head">Tribute</div>'
        +   '<div class="o-don-amt">' + esc(money(d.amount, d.currency)) + '</div>'
        +   (d.message ? '<div class="o-don-msg">&quot;' + esc(d.message) + '&quot;</div>' : '')
        +   '<div class="o-don-from">' + esc(d.username) + '</div>'
        + '</div></div>';
    },
  },
  raid: {
    key: 'raid',
    anim: { in: 'hold', dur: '0.94s', ease: 'linear' },
    exit: { out: 'exStrike', dur: '0.36s', ease: 'cubic-bezier(.5,0,.9,.4)' },
    render: function (d) {
      var count = Math.max(0, parseInt(d.viewers, 10) || 0);
      // Delays plant the rank outside-in; the standard (main) lands last.
      var rankDef = [
        { cls: 'o-raid-ban s',    delay: 0.00 },
        { cls: 'o-raid-ban m',    delay: 0.10 },
        { cls: 'o-raid-ban main', delay: 0.26 },
        { cls: 'o-raid-ban m',    delay: 0.16 },
        { cls: 'o-raid-ban s',    delay: 0.05 },
      ];
      var rank = '';
      for (var i = 0; i < rankDef.length; i++) {
        var b = rankDef[i];
        var inner = b.cls.indexOf('main') > -1
          ? '<div class="o-mesh"></div><div class="o-raid-cnt">' + count + '</div>'
            + '<div class="o-raid-clbl">raiders</div>'
          : '';
        rank += '<div class="' + b.cls + '" style="--rdelay:calc('
             + b.delay.toFixed(2) + 's / var(--spd))">' + inner + '</div>';
      }
      return '<div class="obj o-raid">'
        + '<div class="o-raid-rank">' + rank + '</div>'
        + '<div class="o-raid-plaque">'
        +   '<div class="o-name">' + esc(d.username) + '</div>'
        +   '<div class="o-meta">brought the grid</div>'
        + '</div></div>';
    },
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = OBJECTS;
if (typeof window !== 'undefined') window.ATLETA_OBJECTS = OBJECTS;
