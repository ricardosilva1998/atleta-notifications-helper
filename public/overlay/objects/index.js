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
    render: function (d) { return ''; },
  },
  subscription: {
    key: 'subscription',
    anim: { in: 'hold', dur: '1.26s', ease: 'linear' },
    exit: { out: 'exGateFall', dur: '0.40s', ease: 'cubic-bezier(.5,0,.9,.4)' },
    render: function (d) { return ''; },
  },
  bits: {
    key: 'bits',
    anim: { in: 'oBitsIn', dur: '0.20s', ease: 'cubic-bezier(.2,1,.2,1)' },
    exit: { out: 'exBoardTip', dur: '0.34s', ease: 'ease-in' },
    render: function (d) { return ''; },
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
