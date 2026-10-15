'use strict';

/**
 * The five screen effects a look can add (docs/superpowers/specs/2026-10-15-alert-styles-design.md):
 * smoke, checker, speed, sparks and champagne. One function draws them for the OBS overlay
 * (spawnEffects in overlay.js) and for the builder preview (renderScreenEffect in
 * overlay-builder.ejs), so the two show the same thing (Overlay Consistency Rule). The styles are
 * fx.css. A layer is the 1920x1080 screen or the builder's preview of it; opts.scale shrinks the
 * particles to the preview's size. At most 60 particles, each runs once, all gone after 5.2 s.
 */
(function (root) {
  var KINDS = ['smoke', 'checker', 'speed', 'sparks', 'champagne'];
  var COLOURS = ['#ff4444', '#00ff88', '#f7c948', '#4285f4', '#ff88cc', '#ffffff', '#bf00ff', '#00ccff'];

  function n(v, d) { return v.toFixed(d == null ? 0 : d); }
  // The particles of one effect: [{ cls, style }], for a layer 1920 px wide (scale 1).
  function particles(kind, random, scale) {
    var r = random || Math.random, k = scale || 1, out = [], i;
    function px(v) { return n(v * k) + 'px'; }
    if (kind === 'smoke') {
      for (i = 0; i < 20; i++) {
        var s = 220 + r() * 300;
        out.push({ cls: 'fx-smoke', style: 'left:' + n(i % 2 ? 4 + r() * 20 : 76 + r() * 20, 1) + '%;top:' + n(98 + r() * 6, 1) + '%;width:' + px(s) + ';height:' + px(s)
          + ';--dx:' + px((i % 2 ? 1 : -1) * (60 + r() * 220)) + ';--dy:' + px(-(220 + r() * 460)) + ';--du:' + n(2 + r() * 1.3, 2) + 's;--dd:' + n(r() * 0.7, 2) + 's' });
      }
    } else if (kind === 'checker') {
      for (i = 0; i < 60; i++) {
        var fill = i % 3 === 0 ? 'repeating-conic-gradient(#111 0 25%,#f4f4f4 0 50%) 0 0/50% 50%' : (i % 2 ? '#f4f4f4' : '#111');
        out.push({ cls: 'fx-check', style: 'left:' + n(r() * 100, 1) + '%;top:' + n(-4 - r() * 8, 1) + '%;--dx:' + px((r() - 0.5) * 260) + ';--fall:' + px(1240)
          + ';--rx:' + n(360 + r() * 720) + 'deg;--rz:' + n(r() * 540) + 'deg;--du:' + n(2.2 + r() * 1.4, 2) + 's;--dd:' + n(r() * 0.9, 2) + 's;--s:' + px(18 + r() * 26) + ';--fill:' + fill });
      }
    } else if (kind === 'speed') {
      for (i = 0; i < 48; i++) {
        out.push({ cls: 'fx-speed', style: 'left:50%;top:44%;width:' + px(160 + r() * 340) + ';--t:' + n(r() * 360) + 'deg;--r0:' + px(90 + r() * 160)
          + ';--r1:' + px(900 + r() * 500) + ';--du:' + n(0.45 + r() * 0.35, 2) + 's;--dd:' + n(r() * 0.4, 2) + 's' });
      }
    } else if (kind === 'sparks') {
      for (i = 0; i < 56; i++) {
        var dir = r() < 0.5 ? -1 : 1;
        out.push({ cls: 'fx-spark', style: 'left:' + n(18 + r() * 64, 1) + '%;top:' + n(97 + r() * 2, 1) + '%;--dx:' + px(dir * (100 + r() * 460)) + ';--dy:' + px(-(200 + r() * 420))
          + ';--a0:' + (dir * 20) + 'deg;--a1:' + (dir * 60) + 'deg;--a2:' + (dir * 130) + 'deg;--du:' + n(0.6 + r() * 0.5, 2) + 's;--dd:' + n(r() * 0.8, 2) + 's' });
      }
    } else if (kind === 'champagne') {
      [-1, 1].forEach(function (side) {
        for (var j = 0; j < 30; j++) {
          out.push({ cls: 'fx-drop', style: 'left:' + (side < 0 ? 6 : 94) + '%;top:97%;--dx:' + px(-side * (220 + r() * 760)) + ';--dy:' + px(-(320 + r() * 560))
            + ';--du:' + n(1.1 + r() * 0.9, 2) + 's;--dd:' + n(r(), 2) + 's' });
        }
      });
    }
    return out;
  }
  // Draws `kind` on `layer`; returns the elements (removed by themselves after 5.2 s).
  function spawn(layer, kind, opts) {
    if (!layer || KINDS.indexOf(kind) < 0) return [];
    var o = opts || {}, doc = layer.ownerDocument || (root && root.document), made = [];
    particles(kind, o.random, o.scale).forEach(function (p) {
      var el = doc.createElement('i');
      el.className = 'fx screen-effect ' + p.cls;
      el.setAttribute('style', p.style);
      layer.appendChild(el);
      made.push(el);
    });
    var later = (root && root.setTimeout) || setTimeout;
    later(function () { made.forEach(function (el) { if (el.remove) el.remove(); }); }, 5200);
    return made;
  }
  var FX = { KINDS: KINDS, COLOURS: COLOURS, particles: particles, spawn: spawn };
  if (typeof module !== 'undefined' && module.exports) module.exports = FX;
  if (root) root.ATLETA_FX = FX;
})(typeof window !== 'undefined' ? window : null);
