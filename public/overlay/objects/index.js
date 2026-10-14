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

// A donation amount as the currency writes it ("€10.50", "$1,234.50", "CA$7.50").
// The locale is fixed so the OBS overlay and the builder preview print the same
// text whatever language each browser runs in. A code Intl cannot format (not
// three letters) is shown in front of the amount, and an amount that is not a
// number is shown as it came.
function money(amount, currency) {
  var code = String(currency == null ? '' : currency).trim().toUpperCase();
  var prefix = code ? code + ' ' : '';
  var number = Number(amount);
  if (amount == null || String(amount).trim() === '' || !isFinite(number)) {
    return (prefix + String(amount == null ? '' : amount)).trim();
  }
  if (/^[A-Z]{3}$/.test(code)) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(number);
    } catch (e) { /* fall through to the plain form */ }
  }
  return prefix + number.toFixed(2);
}

// A name wider than its plaque is shown smaller, and the stylesheet cuts what
// still does not fit with an ellipsis (.o-name). NAME_HOLDS is how many typical
// capitals each plaque holds at full size, measured with Oxanium 800 (about
// 0.66em per capital) at the default 420px width; a wide character (CJK, Hangul,
// full-width forms, emoji) counts 1.5. The floor keeps a name readable.
var NAME_HOLDS = { follow: 22, subscription: 16, bits: 23, raid: 22 };
var NAME_FIT_FLOOR = 0.6;

function isWide(codePoint) {
  return (codePoint >= 0x1100 && codePoint <= 0x11FF)
    || (codePoint >= 0x2E80 && codePoint <= 0xA4CF)
    || (codePoint >= 0xAC00 && codePoint <= 0xD7A3)
    || (codePoint >= 0xF900 && codePoint <= 0xFAFF)
    || (codePoint >= 0xFE30 && codePoint <= 0xFE6F)
    || (codePoint >= 0xFF00 && codePoint <= 0xFF60)
    || (codePoint >= 0xFFE0 && codePoint <= 0xFFE6)
    || codePoint >= 0x1F000;
}

function nameWidth(name) {
  var chars = Array.from(String(name == null ? '' : name));
  var width = 0;
  for (var i = 0; i < chars.length; i++) width += isWide(chars[i].codePointAt(0)) ? 1.5 : 1;
  return width;
}

// The style attribute for a .o-name: --fit scales its font size (see objects.css).
function nameFit(name, holds) {
  var width = nameWidth(name);
  var fit = width > holds ? Math.max(NAME_FIT_FLOOR, holds / width) : 1;
  return fit < 1 ? ' style="--fit:' + fit.toFixed(2) + '"' : '';
}

// A name on its plaque. The box carries the size (--fit) and the one line it occupies; the
// span inside clips a name that is still too long with an ellipsis (see .o-name-text).
function nameBox(extraClass, name, holds) {
  return '<div class="' + (extraClass ? extraClass + ' ' : '') + 'o-name"' + nameFit(name, holds) + '>'
    + '<span class="o-name-text">' + esc(name) + '</span></div>';
}

// The raid count sits on a 118px banner at 46px; digits are 0.533em wide in
// Oxanium, so from five digits on it is set smaller to keep every digit inside.
var COUNT_FULL_SIZE = 46;
var COUNT_WIDTH_BUDGET = 108;
function countFit(digits) {
  var size = Math.floor(COUNT_WIDTH_BUDGET / (digits.length * 0.533));
  size = Math.max(14, size);
  return size < COUNT_FULL_SIZE ? ' style="font-size:' + size + 'px"' : '';
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
        +   nameBox('', d.username, NAME_HOLDS.follow)
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
        +   nameBox('', d.username, NAME_HOLDS.subscription)
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
        + nameBox('o-bits-who', d.username, NAME_HOLDS.bits)
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
          ? '<div class="o-mesh"></div><div class="o-raid-cnt"' + countFit(String(count)) + '>' + count + '</div>'
            + '<div class="o-raid-clbl">raiders</div>'
          : '';
        rank += '<div class="' + b.cls + '" style="--rdelay:calc('
             + b.delay.toFixed(2) + 's / var(--spd))">' + inner + '</div>';
      }
      return '<div class="obj o-raid">'
        + '<div class="o-raid-rank">' + rank + '</div>'
        + '<div class="o-raid-plaque">'
        +   nameBox('', d.username, NAME_HOLDS.raid)
        +   '<div class="o-meta">brought the grid</div>'
        + '</div></div>';
    },
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = OBJECTS;
if (typeof window !== 'undefined') window.ATLETA_OBJECTS = OBJECTS;
