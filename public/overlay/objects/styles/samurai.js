'use strict';

/**
 * Samurai (docs/superpowers/specs/2026-10-15-alert-styles-design.md): today's five looks under the
 * names the owner gave them, and the omikuji, the family's giveaway. The presets point at the
 * objects in index.js (nothing is copied), so the five keep their own code and their own CSS
 * (objects.css), which reads the streamer's colour with today's red as the fallback.
 */
(function (root) {
  var K = (root && root.ATLETA_KIT) || require('../kit.js');
  var OBJECTS = (root && root.ATLETA_OBJECTS) || require('../index.js');

  K.registerFamily({ key: 'samurai', order: 0, fonts: ['Noto+Serif+JP:wght@700'] });

  // [event type, style id, seconds until its entrance has finished, its sound]
  [
    ['follow', 'follow-samurai', 0.8, 'samuraiBlade'], ['subscription', 'subscriber-samurai', 1.35, 'samuraiTaiko'],
    ['bits', 'bits-samurai', 1.1, 'samuraiTally'], ['donation', 'donation-samurai', 1.2, 'samuraiKoto'],
    ['raid', 'raid-samurai', 1.0, 'samuraiTaiko3'],
  ].forEach(function (p) {
    var object = OBJECTS[p[0]];
    K.register({
      key: p[1], eventType: p[0], family: 'samurai', preset: true,
      anim: object.anim, exit: object.exit, len: p[2],
      // A streamer who picks the look gets its Samurai recording; an alert with no look picked still
      // draws today's object (index.js) with today's sound. No screen effect, as today.
      sound: p[3], fx: 'none', grows: false,
      controls: { colour: 'accent', label: false, speed: false },
      render: object.render,
    });
  });

  K.registerSound('samuraiBlade', 'samurai', function () {
    K.noise({ ft: 'highpass', f: 2400, f2: 9000, d: 0.32, v: 0.16, a: 0.01 });
    K.tone({ f: 2900, f2: 3600, d: 0.7, v: 0.035, t: 0.03 });
    K.tone({ f: 5800, d: 0.55, v: 0.015, t: 0.03 });
  });
  K.registerSound('samuraiTaiko', 'samurai', function () {
    K.tone({ f: 95, f2: 48, d: 0.5, v: 0.55, a: 0.003 });
    K.noise({ ft: 'lowpass', f: 500, d: 0.09, v: 0.25 });
  });
  K.registerSound('samuraiTaiko3', 'samurai', function () {
    [0, 0.2, 0.55].forEach(function (t, i) {
      K.tone({ f: 95 - i * 8, f2: 46, d: 0.45, v: 0.5, a: 0.003, t: t });
      K.noise({ ft: 'lowpass', f: 480, d: 0.08, v: 0.22, t: t });
    });
  });
  K.registerSound('samuraiTally', 'samurai', function () {
    K.noise({ ft: 'highpass', f: 2400, f2: 7000, d: 0.2, v: 0.12, a: 0.01, t: 0.04 });
    [0.12, 0.2, 0.28, 0.36].forEach(function (t) { K.noise({ ft: 'bandpass', f: 1800, q: 3, d: 0.04, v: 0.2, t: t }); });
    K.noise({ ft: 'bandpass', f: 2600, q: 2, d: 0.08, v: 0.35, t: 0.68 });
  });
  K.registerSound('samuraiKoto', 'samurai', function () {
    [392, 523, 587, 784].forEach(function (f, i) { K.tone({ f: f, d: 0.9, v: 0.09, type: 'triangle', a: 0.002, t: 0.55 + i * 0.1 }); });
  });
  K.registerSound('samuraiBell', 'samurai', function () {
    [[220, 0.28, 3.2], [440, 0.14, 2.6], [661, 0.07, 2], [1100, 0.04, 1.4]].forEach(function (p) { K.tone({ f: p[0], v: p[1], d: p[2], a: 0.004, t: 0.8 }); });
  });

  // The omikuji: the fortune box is shaken twice, a stick strikes out and the slip unrolls with
  // the winner, stamped "great blessing".
  K.register({
    key: 'giveaway-samurai', eventType: 'giveaway_winner', family: 'samurai',
    anim: { in: 'hold', dur: '1.5s', ease: 'linear' },
    exit: { out: 'exOmi', dur: '0.36s', ease: 'cubic-bezier(.5,0,.9,.4)' }, len: 1.7,
    sound: 'samuraiBell', fx: 'none', grows: false,
    controls: { colour: 'accent', label: true, speed: true },
    render: function (d) {
      return '<div class="obj o-omi"><div class="o-omi-stick"></div>'
        + '<div class="o-omi-box"><i class="o-omi-hole"></i><div class="o-omi-band t"></div><div class="o-omi-kanji">御神籤</div><div class="o-omi-band b"></div><div class="o-mesh"></div></div>'
        + '<div class="o-omi-slip"><div class="o-omi-stamp">大吉</div><div class="o-omi-txt"><div class="o-omi-mark">' + K.label(d, 'Great blessing · giveaway') + '</div>'
        + K.samName(d.username, 15) + (d.prize ? '<div class="o-meta">Won ' + K.esc(d.prize) + '</div>' : '') + '</div></div></div>';
    },
  });
})(typeof window !== 'undefined' ? window : null);
