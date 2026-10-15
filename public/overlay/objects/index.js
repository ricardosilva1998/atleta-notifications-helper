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

// ── Styles: an alert drawn in another look than its own object ──────────────
// STYLES holds objects filed under a style id, each naming the alert it draws
// (eventType). An alert whose saved design names a style (overlay_designs.style)
// renders that style's object instead of its own: objectFor() in overlay.js and
// previewObjectFor() in the builder pick with the same rule. Today there is one:
// andre_vilela_'s C1.

// The C1: a racing first-generation Citroën C1 tows the donation in on a billboard
// trailer (docs/superpowers/specs/2026-10-15-vilela-c1-donation-design.md). The car
// is an inline SVG, viewBox 0 0 320 140: rear axle x 57, front axle x 249, ground
// y 132. Its outline was measured from the CC0 Wikimedia Commons drawing
// "File:Citroën C1.svg"; never redraw it from memory.
var C1_BODY = 'M30,108L27,108C24.5,107.5 23.4,104 23.2,98L23.1,86C23.5,82 24.6,79.5 26,77.5C28.5,74.5 30.5,71.5 31.5,68.5L33.6,61.5C37,50 43,37 49.5,29C50.6,27.6 51.2,24 51.6,20.3C52.5,19 54,18.6 56,18.4C88,11.2 128,9.6 160,14.2C163.5,14.6 166.5,15.6 169,17.2C190,25 215,37.4 236,49.8C240,51.1 246,51.8 252,52.2C262,53 272,57 279,63C283,66.6 285.5,70 287,72.5C292,74.5 297,79 299,86C300.6,91 300.6,99 299.4,104C298.4,108.5 295.8,111.6 291.5,113C287,114.2 281,114.4 275.3,114A27,27 0 1 0 223.4,116.7L82.6,116.7A27,27 0 1 0 30,108Z';
var C1_DOOR_GLASS = 'M116,20.2L150,20.6C165,21.4 178,24.6 188,30.8C196,36 201.6,42 203.8,52L204.2,56.4C204.3,57.6 203.4,58.2 202.2,58.1L119.6,50C118.4,49.9 117.6,49.2 117.5,48.2Z';
var C1_QUARTER_GLASS = 'M108.6,19.9L110.4,50.6L80,47.6C73.5,46.9 68.2,43.6 66,38.4C64.4,34.4 64.4,28.6 66,24.8C67.4,21.8 70.4,20.6 74,20.3Z';
var C1_WELLS = 'M275.3,114A27,27 0 1 0 223.4,116.7Z M82.6,116.7A27,27 0 1 0 30,108Z';
// A long amount is set smaller: 7 characters fit the board of a 340px alert at 46px.
var C1_AMOUNT_HOLDS = 7;
var C1_AMOUNT_FLOOR = 0.6;
// Each alert gets its own SVG ids, so two alerts on one page never share a gradient or a clip path.
var c1Count = 0;

function c1AmountFit(text) {
  var length = Array.from(text).length;
  if (length <= C1_AMOUNT_HOLDS) return '';
  return ' style="--afit:' + Math.max(C1_AMOUNT_FLOOR, C1_AMOUNT_HOLDS / length).toFixed(2) + '"';
}

// Smoke puffs: [delay s, drift x px, drift y px, final scale]
function c1Puffs(list) {
  var html = '';
  for (var i = 0; i < list.length; i++) {
    html += '<i style="--pd:' + list[i][0] + 's;--dx:' + list[i][1] + 'px;--dy:' + list[i][2] + 'px;--ps:' + list[i][3] + '"></i>';
  }
  return html;
}

function c1Wheel(u, cx, side) {
  var spokes = '';
  for (var a = 0; a < 360; a += 72) {
    spokes += '<path d="M-1.8,-3.6L-2.7,-14.2L2.7,-14.2L1.8,-3.6Z" style="fill:var(--o-c1-rim)" transform="rotate(' + a + ')"/>';
  }
  return '<g class="o-c1-wheel ' + side + '" transform="translate(' + cx + ' 108.5)">'
    + '<circle r="23.5" fill="#0E1013"/>'
    + '<circle r="21.9" fill="none" stroke="#262A30" stroke-width="1.3"/>'
    + '<circle r="15.6" fill="#23272C"/>'
    + '<circle r="12" fill="#555C64"/>'
    + '<circle class="o-c1-glow" r="12.4" fill="url(#' + u + 'h)"/>'
    + '<path d="M3.2,-11.4A11.8,11.8 0 0 1 11.2,-3.6L8.1,-2.6A8.5,8.5 0 0 0 2.3,-8.2Z" style="fill:var(--o-c1-caliper)"/>'
    + '<g class="o-c1-spin">'
    +   '<circle r="15.2" fill="none" style="stroke:var(--o-c1-rim)" stroke-width="2.6"/>' + spokes
    +   '<circle r="4" style="fill:var(--o-c1-rim)"/><circle r="1.5" fill="#0E1013"/>'
    + '</g>'
    + '<circle class="o-c1-blur" r="15.6" fill="url(#' + u + 'd)"/>'
    + '</g>';
}

function c1Car(u) {
  return '<svg class="o-c1-svg" viewBox="0 0 320 140" aria-hidden="true" focusable="false">'
    + '<defs>'
    +   '<linearGradient id="' + u + 'p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--o-c1-hi)"/><stop offset=".45" style="stop-color:var(--o-c1-mid)"/><stop offset="1" style="stop-color:var(--o-c1-lo)"/></linearGradient>'
    +   '<linearGradient id="' + u + 'g" x1="0" y1="0" x2=".5" y2="1"><stop offset="0" stop-color="#3A4D60"/><stop offset=".5" stop-color="#152029"/><stop offset="1" stop-color="#090D12"/></linearGradient>'
    +   '<radialGradient id="' + u + 'd"><stop offset="0" stop-color="#AAB2BB"/><stop offset=".6" stop-color="#7A828B"/><stop offset=".86" stop-color="#4A5057"/><stop offset="1" stop-color="#2A2F35"/></radialGradient>'
    +   '<radialGradient id="' + u + 'h"><stop offset="0" stop-color="#FFD27A"/><stop offset=".45" stop-color="#FF7A1A" stop-opacity=".95"/><stop offset="1" stop-color="#FF3D00" stop-opacity="0"/></radialGradient>'
    +   '<radialGradient id="' + u + 's"><stop offset="0" stop-color="#000" stop-opacity=".6"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>'
    +   '<clipPath id="' + u + 'w"><path d="' + C1_DOOR_GLASS + '"/><path d="' + C1_QUARTER_GLASS + '"/></clipPath>'
    + '</defs>'
    // shadow, wheel wells (they pitch with the body), wheels
    + '<ellipse cx="162" cy="131.5" rx="150" ry="6" fill="url(#' + u + 's)"/>'
    + '<g class="o-c1-pitch"><g transform="translate(0 2)"><path d="' + C1_WELLS + '" fill="#06070A"/></g></g>'
    + c1Wheel(u, 57, 'o-c1-rear') + c1Wheel(u, 249, 'o-c1-front')
    + '<g class="o-c1-pitch"><g class="o-c1-shake"><g transform="translate(0 2)">'
    +   '<path d="' + C1_BODY + '" fill="url(#' + u + 'p)"/>'
    // the windscreen seen edge-on along the A-pillar
    +   '<path d="M166.6,16.4C188,24.4 213,36.6 235.4,50L233.6,52.2C211.4,39.6 186.6,27.6 165.6,19.4Z" fill="url(#' + u + 'g)"/>'
    // the rear haunch over the back wheel and the front arch flare
    +   '<path d="M26.5,78.5C36,72 48,67.6 60,67.4C74,67.2 84,74 88.5,90C89.6,94.5 89.4,99 88.6,103.8" stroke="rgba(0,0,0,.3)" stroke-width="1.1" fill="none"/>'
    +   '<path d="M27.5,77C37,70.6 48.5,66.4 60,66.2C73,66 82,71.6 86.6,84" stroke="rgba(255,255,255,.2)" stroke-width="1" fill="none"/>'
    +   '<path d="M211.5,109C215,88 230,75.5 249,74.6C266,74 279,84 281.5,102" stroke="rgba(0,0,0,.3)" stroke-width="1.1" fill="none"/>'
    // black side skirt, front intake and fog-lamp housing, splitter
    +   '<path d="M82.6,108.4L223.7,108.4L223.4,116.7L82.6,116.7Z" fill="#0B0D10"/>'
    +   '<path d="M283,103.2L298.6,103.2C297.8,107.4 295.4,110.6 291.4,112C288.6,112.9 285.6,113.3 282.6,113.4Z" fill="#0B0D10"/>'
    +   '<path d="M289.6,85.6C293.6,85 297.4,85 299.6,85.8C300.4,89.6 300.4,94.8 299.8,98.6C296.6,98.8 293,98.7 290,98.2C289,94.4 288.9,89.4 289.6,85.6Z" fill="#0B0D10"/>'
    +   '<circle cx="295" cy="92.1" r="2.4" fill="#D9DDE2"/>'
    +   '<path d="M276,113.6L304,112.8L304,115L277.5,116.2Z" fill="#0B0D10"/>'
    // livery: two stripes from the headlight to the tail light
    +   '<path d="M246,62C190,60.6 120,59.8 56.5,60.6" style="stroke:var(--o-c1-stripe)" stroke-width="3.2" fill="none"/>'
    +   '<path d="M246,66.4C190,65 120,64.2 57,65" style="stroke:var(--o-c1-stripe)" stroke-width="1.2" fill="none" opacity=".9"/>'
    +   '<path d="M60,56.5C120,53.5 190,55.5 240,58.6" stroke="rgba(255,255,255,.2)" stroke-width="1.1" fill="none"/>'
    // door: shut lines, bottom edge, handle; indicator on the front wing
    +   '<path d="M217.5,59C219.2,72 219.6,86 218,98C217.4,101.6 216.8,103 216.6,104" stroke="rgba(0,0,0,.4)" stroke-width="1" fill="none"/>'
    +   '<path d="M110.8,51.2C111.4,70 112,88 112.8,104" stroke="rgba(0,0,0,.4)" stroke-width="1" fill="none"/>'
    +   '<path d="M112.8,104L216.6,104" stroke="rgba(0,0,0,.28)" stroke-width="1" fill="none"/>'
    +   '<rect x="121" y="54.4" width="11" height="3" rx="1.5" fill="rgba(0,0,0,.5)"/>'
    +   '<ellipse cx="226" cy="67.8" rx="2.6" ry="1.4" fill="#FFB347" stroke="rgba(0,0,0,.35)" stroke-width=".6"/>'
    // race number
    +   '<circle cx="166" cy="80.5" r="13.5" fill="#FFFFFF" style="stroke:var(--o-c1-ring)" stroke-width="1.6"/>'
    +   '<text class="o-c1-num" x="166" y="87.6" text-anchor="middle">1</text>'
    // glass, roll cage, the driver in a helmet, the name on the rear side window
    +   '<path d="' + C1_DOOR_GLASS + '" fill="url(#' + u + 'g)" stroke="#0B0D10" stroke-width=".8"/>'
    +   '<path d="' + C1_QUARTER_GLASS + '" fill="url(#' + u + 'g)" stroke="#0B0D10" stroke-width=".8"/>'
    +   '<g clip-path="url(#' + u + 'w)">'
    +     '<path d="M158,22.4C172,24.4 186,31 196,42.6" stroke="#7A8592" stroke-width="2.4" fill="none" stroke-linecap="round"/>'
    +     '<path d="M104.5,20.6L105.6,50" stroke="#7A8592" stroke-width="2.4" stroke-linecap="round"/>'
    +     '<path d="M104,22L74,46.5" stroke="#7A8592" stroke-width="2.4" stroke-linecap="round"/>'
    +     '<path d="M139.6,52C140.8,45.6 145.6,42.8 152,42.8C158.4,42.8 163.2,45.6 164.4,52Z" fill="#1F2A36"/>'
    +     '<path d="M141,35.6C140.6,27.8 145.8,22.6 152.4,22.6C158.8,22.6 162.6,27 162.8,32.6L162.8,37.4C162.8,39.4 161.6,40.6 159.8,40.6L146,40.6C143.2,40.6 141.2,38.6 141,35.6Z" fill="#BFC6CE" opacity=".85"/>'
    +     '<path d="M154.8,28.2L162.7,28.2L162.8,33.8L154.8,33.8C153.4,33.8 152.8,32.8 152.8,31C152.8,29.2 153.4,28.2 154.8,28.2Z" fill="#141D27"/>'
    +     '<path d="M144.2,27C147.4,24.4 151.6,23.4 156,23.8" stroke="#D81E26" stroke-width="1.8" fill="none"/>'
    +     '<path d="M168,18L182,18L146,58L132,58Z" fill="rgba(255,255,255,.07)"/>'
    +     '<text class="o-c1-decal" x="88" y="38" text-anchor="middle">VILELA</text>'
    +   '</g>'
    +   '<path d="M108.6,19.6L116.4,19.6L118.4,50.8L110.4,51.2Z" fill="#0B0D10"/>'
    // tail light high on the rear corner, with its two round lamps
    +   '<path d="M34.2,58.7C37.3,48.6 43,37 49.5,29C51,27.3 52.6,26.2 54.4,26L55.2,58.7Z" fill="#3A0B10" stroke="rgba(0,0,0,.5)" stroke-width=".7"/>'
    +   '<circle cx="48.4" cy="36.2" r="3.7" fill="#D0141C"/>'
    +   '<circle cx="44.2" cy="50" r="4.4" fill="#E9E3E3" opacity=".9"/>'
    +   '<circle cx="44.2" cy="50" r="2.2" fill="#F4A3A6" opacity=".7"/>'
    // headlight, swept back along the wing
    +   '<path d="M249,56.2C256,57.2 265,58.6 271.2,60.4C276.5,61.9 281.5,65.4 284,71.5C284.8,73.5 283.8,75.2 282,75C278,74.6 272,71.8 267.8,69.8C262,67 254.5,61.6 249,56.2Z" fill="#E3E8EE" stroke="rgba(0,0,0,.4)" stroke-width=".8"/>'
    +   '<circle cx="277.6" cy="68.6" r="3.2" fill="#FFF6D2"/>'
    // mirror, its black sail, exhaust, tow straps
    +   '<path d="M215,46.6L228.6,60.2L215.8,60.2Z" fill="#0B0D10"/>'
    +   '<path d="M203,54.4L215,53.6C217.2,53.6 217.6,55.6 216.2,56.8L213.6,58.4L205,58.6C203.2,58.6 202.4,56.4 203,54.4Z" fill="#0B0D10"/>'
    +   '<path d="M197.6,50C197.6,44.6 203,42.4 208.6,43C213.6,43.6 216.4,47 215.6,50.4C214.8,53.8 210.2,55.2 205.2,54.8C200.8,54.4 197.6,53 197.6,50Z" fill="url(#' + u + 'p)" stroke="#0B0D10" stroke-width=".8"/>'
    +   '<rect x="19" y="106.2" width="12" height="4.2" rx="2.1" fill="#3B4148"/>'
    +   '<ellipse cx="20.2" cy="108.3" rx="1.1" ry="1.5" fill="#0B0D10"/>'
    +   '<path d="M299.6,100.4h6a3,3 0 0 1 0,6h-6" stroke="#FF2A2A" stroke-width="1.9" fill="none"/>'
    +   '<path d="M23.4,92h-6a3,3 0 0 0 0,6h6" stroke="#FF2A2A" stroke-width="1.9" fill="none"/>'
    + '</g></g></g>'
    + '</svg>';
}

function c1TrailerWheel(u, left) {
  var spokes = '';
  for (var a = 0; a < 360; a += 120) spokes += '<rect x="-1" y="-6.4" width="2" height="5" fill="#9AA3AD" transform="rotate(' + a + ')"/>';
  return '<svg class="o-c1-tw" style="left:' + left + '" viewBox="-12 -12 24 24" aria-hidden="true" focusable="false">'
    + '<circle r="11.5" fill="#0E1013"/>'
    + '<g class="o-c1-spin"><circle r="6.6" fill="none" stroke="#9AA3AD" stroke-width="1.6"/>' + spokes + '<circle r="2" fill="#9AA3AD"/></g>'
    + '<circle class="o-c1-blur" r="7" fill="url(#' + u + 'd)"/>'
    + '</svg>';
}

var STYLES = {
  'donation-c1': {
    key: 'donation-c1',
    eventType: 'donation',
    anim: { in: 'hold', dur: '1.25s', ease: 'linear' },
    exit: { out: 'hold', dur: '0.90s', ease: 'linear' },
    render: function (d) {
      var u = 'oc1u' + (++c1Count);
      var amount = money(d.amount, d.currency);
      return '<div class="obj o-c1"><div class="o-c1-rig">'
        + '<div class="o-c1-streaks"><i></i><i></i><i></i><i></i></div>'
        + '<div class="o-c1-trailer">'
        +   '<div class="o-c1-board"><div class="o-mesh"></div>'
        +     '<div class="o-c1-head">Sponsor</div>'
        +     '<div class="o-c1-amt"' + c1AmountFit(amount) + '>' + esc(amount) + '</div>'
        +     (d.message ? '<div class="o-c1-msg">&quot;' + esc(d.message) + '&quot;</div>' : '')
        +     '<div class="o-c1-from">' + esc(d.username) + '</div>'
        +   '</div>'
        +   '<div class="o-c1-tframe"></div>'
        +   c1TrailerWheel(u, '14%') + c1TrailerWheel(u, '66%')
        +   '<div class="o-c1-hitch"></div>'
        + '</div>'
        + '<div class="o-c1-car">' + c1Car(u)
        +   '<div class="o-c1-flame"></div>'
        +   '<div class="o-c1-bsmoke">' + c1Puffs([[0.46, 16, -7, 2.1], [0.52, 26, -12, 2.6], [0.58, 10, -4, 1.8]]) + '</div>'
        + '</div>'
        + '</div>'
        + '<div class="o-c1-exsmoke">' + c1Puffs([[0, -26, -8, 2.4], [0.06, -46, -14, 3], [0.12, -30, -4, 2.6], [0.2, -58, -18, 3.2]]) + '</div>'
        + '</div>';
    },
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OBJECTS;
  // Not enumerable: Object.keys(OBJECTS) stays the five Twitch event types.
  Object.defineProperty(module.exports, 'STYLES', { value: STYLES });
}
if (typeof window !== 'undefined') {
  window.ATLETA_OBJECTS = OBJECTS;
  window.ATLETA_OBJECT_STYLES = STYLES;
}
