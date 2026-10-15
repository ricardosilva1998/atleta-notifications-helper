'use strict';

/**
 * UFO (docs/superpowers/specs/2026-10-15-alert-styles-design.md, Appendix A), ported from the proposal
 * (docs/superpowers/specs/assets/2026-10-15-alert-styles/parts/fam/ufo.js and .css).
 * Its names and descriptions are in the locale files (overlayBuilder.families.ufo, overlayBuilder.looks.<id>,
 * overlayBuilder.sounds.<key>). Its classes start with .o-ufo and its keyframes with ufo.
 */
/* ═══ UFO — playful aliens: a flying saucer, a tractor beam, crop circles and little round aliens ═══
   Comic, not scary. A silver saucer with a little alien in its glass dome swoops in and wobbles to a
   hover, its lights run round the rim, the beam slides down and things float up into it; then
   everything holds still. The accent (alien green by default) is everything that glows: the beams,
   the lights, the aliens themselves, the crop circle, the glyphs and the screens. The hull stays
   silver and the night stays dark. Audiowide for signs and numbers, Nunito for names. Everything
   private to this family lives inside this function, so its helper names cannot collide with
   another family's. */
(function (root) {
  var K = (root && root.ATLETA_KIT) || require('../kit.js');
  var FAMILY = 'ufo';
  var esc = K.esc, money = K.money, fitStyle = K.fitStyle, nm = K.nm, fmt = K.fmt, label = K.label, odo = K.odo, intOf = K.intOf, isWide = K.isWide, tone = K.tone, noise = K.noise;
  var SOUNDS = {};
  function hold(dur) { return { in: 'hold', dur: dur, ease: 'linear' }; }
  // Every look takes the streamer's colour and its speed, and its main text when it shows one.
  var CONTROLS = { colour: 'accent', label: true, speed: true };
  var CONTROLS_NO_TEXT = { colour: 'accent', label: false, speed: true };
  K.registerFamily({ key: FAMILY, order: 24, fonts: ["Nunito:wght@700;800;900","Orbitron:wght@600;800","Audiowide"] });


  /* ── Sounds: hums, beams, blips and bloops, timed to the animations ── */
  SOUNDS.ufoFollow = function () {
    tone({ f: 150, f2: 230, d: 0.56, v: 0.05, a: 0.14 });                                    // the saucer swoops in
    tone({ f: 153, f2: 236, d: 0.56, v: 0.04, type: 'triangle', a: 0.14 });                 // (a second, detuned hum)
    for (var i = 0; i < 7; i++) tone({ f: 1320 + i * 110, d: 0.05, v: 0.022, type: 'square', t: 0.42 + i * 0.05 });   // the lights run round
    tone({ f: 320, f2: 1100, d: 0.34, v: 0.055, a: 0.05, t: 0.5 });                         // the beam slides down
    noise({ ft: 'bandpass', f: 1600, f2: 4200, q: 1.4, d: 0.3, v: 0.05, a: 0.06, t: 0.5 });
    tone({ f: 784, d: 0.1, v: 0.05, type: 'triangle', t: 1.1 });                            // the plate lands
    tone({ f: 1175, d: 0.24, v: 0.045, type: 'triangle', t: 1.2 });
  };
  SOUNDS.ufoSub = function () {
    tone({ f: 260, f2: 170, d: 0.4, v: 0.05, a: 0.1, t: 0.22 });                             // the saucer arrives over the field
    noise({ ft: 'bandpass', f: 500, f2: 1800, q: 5, d: 0.7, v: 0.07, a: 0.15, t: 0.52 });   // it spins
    [0, 1, 2].forEach(function (k) { tone({ f: 523 * (1 + k * 0.25), f2: 784 * (1 + k * 0.25), d: 0.32, v: 0.04, t: 0.56 + k * 0.13 }); });   // the rings draw
    tone({ f: 500, f2: 1500, d: 0.22, v: 0.04, t: 1.16 });                                   // it zips off
    tone({ f: 1047, d: 0.4, v: 0.05, type: 'triangle', t: 1.22 });                          // the months appear
    tone({ f: 1568, d: 0.55, v: 0.035, type: 'triangle', t: 1.3 });
  };
  SOUNDS.ufoBits = function () {
    tone({ f: 140, f2: 210, d: 0.5, v: 0.05, a: 0.12 });                                     // the saucer swoops in
    tone({ f: 143, f2: 215, d: 0.5, v: 0.035, type: 'triangle', a: 0.12 });
    tone({ f: 280, f2: 900, d: 0.3, v: 0.05, a: 0.05, t: 0.52 });                            // the beam
    [0, 1, 2].forEach(function (i) { tone({ f: 330 + i * 70, f2: 700 + i * 140, d: 0.16, v: 0.045, t: 0.74 + i * 0.11 }); });   // cows float up
    tone({ f: 200, f2: 140, d: 0.55, v: 0.045, type: 'sawtooth', a: 0.08, t: 0.98 });       // and one of them moos
    tone({ f: 100, f2: 72, d: 0.55, v: 0.05, type: 'triangle', a: 0.08, t: 0.98 });
  };
  SOUNDS.ufoDonation = function () {
    tone({ f: 160, f2: 220, d: 0.5, v: 0.045, a: 0.12 });                                    // the saucer
    noise({ ft: 'bandpass', f: 2600, q: 3, d: 0.12, v: 0.12, t: 0.55 });                     // the screen switches on
    tone({ f: 880, d: 0.06, v: 0.04, type: 'square', t: 0.58 });
    [1320, 990, 1760, 1180, 1480, 880, 1660, 1100, 1400].forEach(function (f, i) { tone({ f: f, d: 0.045, v: 0.028, type: 'square', t: 0.9 + i * 0.08 }); });   // glyph chatter while it decodes
    tone({ f: 784, d: 0.18, v: 0.05, type: 'triangle', t: 1.7 });                           // decoded
    tone({ f: 1175, d: 0.4, v: 0.045, type: 'triangle', t: 1.8 });
  };
  SOUNDS.ufoRaid = function () {
    [0, 0.14, 0.28].forEach(function (t, i) { tone({ f: 210 - i * 24, f2: 130 - i * 14, d: 0.85, v: 0.04, type: 'triangle', a: 0.2, t: 0.28 + t }); });   // the fleet descends
    noise({ ft: 'lowpass', f: 1400, f2: 300, d: 0.9, v: 0.1, a: 0.25, t: 0.3 });
    tone({ f: 98, d: 0.45, v: 0.08, t: 1.18 });                                              // the leader lands
    tone({ f: 147, d: 0.45, v: 0.04, type: 'triangle', t: 1.18 });
    tone({ f: 300, f2: 900, d: 0.25, v: 0.04, t: 1.24 });                                    // and switches on its beam
  };
  SOUNDS.ufoGiveaway = function () {
    tone({ f: 55, f2: 62, d: 1.2, v: 0.1, a: 0.3 });                                         // the deep hum
    tone({ f: 110, f2: 124, d: 1.0, v: 0.04, type: 'triangle', a: 0.3 });
    for (var i = 0; i < 6; i++) tone({ f: 1480 + i * 90, d: 0.04, v: 0.02, type: 'square', t: 0.4 + i * 0.07 });   // the lights chase
    noise({ ft: 'lowpass', f: 900, f2: 260, d: 0.3, v: 0.14, t: 0.8 });                      // the hatch opens
    tone({ f: 300, f2: 1200, d: 0.36, v: 0.05, t: 1.0 });                                    // the spotlight
    noise({ ft: 'highpass', f: 3000, d: 0.4, v: 0.05, a: 0.08, t: 1.0 });
    [523, 784, 659, 1047].forEach(function (f, i) { tone({ f: f, d: 0.2, v: 0.06, type: 'triangle', t: 1.22 + i * 0.12 }); });   // a little alien tune
    [1047, 1319, 1568].forEach(function (f) { tone({ f: f, d: 0.7, v: 0.03, type: 'triangle', t: 1.7 }); });
  };

  /* ── Exits: beamed back up, switched off like a screen, zipped away, lifted off ── */
  var UFO_SUCK = { out: 'ufoSuck', dur: '0.42s', ease: 'cubic-bezier(.5,0,.85,.4)' };
  var UFO_WARP = { out: 'ufoWarp', dur: '0.4s', ease: 'ease-in' };
  var UFO_ZIP = { out: 'ufoZip', dur: '0.45s', ease: 'cubic-bezier(.45,0,.8,.4)' };
  var UFO_LIFT = { out: 'ufoLiftOff', dur: '0.5s', ease: 'cubic-bezier(.45,0,.8,.45)' };

  /* ── Drawing helpers (short SVG, no ids, so any number of tiles can show the same look) ── */
  function n1(x) { return String(Math.round(x * 10) / 10); }
  function circ(x, y, r) {
    var w = n1(2 * r);
    return 'M' + n1(x - r) + ' ' + n1(y) + 'a' + n1(r) + ' ' + n1(r) + ' 0 1 0 ' + w + ' 0a' + n1(r) + ' ' + n1(r) + ' 0 1 0 -' + w + ' 0Z';
  }
  function tierOf(d) {
    var t = String(d.tier || '1');
    if (/^[123]000$/.test(t)) t = t.charAt(0);
    return /^[123]$/.test(t) ? t : '1';
  }

  // The saucer, side on (viewBox 120 × 64): the beam's lens underneath, a little round alien in a
  // glass dome, a silver hull, and seven lights on the rim. The lens sits at (60, 50.5), 32 wide.
  var LAMPS = [[14, 40.2], [28, 42.7], [44, 44.1], [60, 44.5], [76, 44.1], [92, 42.7], [106, 40.2]];
  var SAUCER_BODY = '<ellipse class="o-ufo-lens" cx="60" cy="50.5" rx="16" ry="5"/>'
    + '<path class="o-ufo-ln" stroke-width="1.5" d="M57 10.5L54.6 6.4M63 10.5L65.4 6.4"/>'
    + '<path class="o-ufo-skin" stroke-width="1.2" d="' + circ(54.5, 6, 2) + circ(65.5, 6, 2) + '"/>'
    + '<ellipse class="o-ufo-skin" stroke-width="1.6" cx="60" cy="17.5" rx="9.5" ry="8.2"/>'
    + '<ellipse class="o-ufo-eye" cx="56.2" cy="16.6" rx="2.3" ry="3.1"/><ellipse class="o-ufo-eye" cx="63.8" cy="16.6" rx="2.3" ry="3.1"/>'
    + '<path class="o-ufo-gl" d="' + circ(57, 15.4, 0.9) + circ(64.6, 15.4, 0.9) + '"/>'
    + '<path class="o-ufo-glass" stroke-width="2" d="M37 31C37 12.5 47 2.5 60 2.5S83 12.5 83 31Z"/>'
    + '<path class="o-ufo-shine" d="M43.5 22C44.5 15 48.5 9.8 54 7.6"/>'
    + '<ellipse class="o-ufo-hd" stroke-width="2" cx="60" cy="37" rx="57" ry="12"/>'
    + '<ellipse class="o-ufo-hl" stroke-width="1.2" cx="60" cy="31" rx="57" ry="9"/>'
    + '<path class="o-ufo-hi" d="M13.5 29.6C24 25.6 40 23.5 56 23.3"/>';
  function lamp(x, y, i, big) {
    return '<g class="o-ufo-lamp" style="--bi:' + i + '"><circle class="o-ufo-halo" cx="' + n1(x) + '" cy="' + n1(y) + '" r="' + (big ? 5 : 4.4)
      + '"/><circle class="o-ufo-bulb" cx="' + n1(x) + '" cy="' + n1(y) + '" r="' + (big ? 2.8 : 2.4) + '"/></g>';
  }
  var SAUCER = '<svg viewBox="0 0 120 64" aria-hidden="true">' + SAUCER_BODY
    + LAMPS.map(function (p, i) { return lamp(p[0], p[1], i); }).join('') + '</svg>';
  // The same saucer seen from above (viewBox 50 × 50), for the crop circle.
  var SAUCER_TOP = (function () {
    var bulbs = '';
    for (var k = 0; k < 8; k++) {
      var a = k * Math.PI / 4;
      bulbs += '<circle class="o-ufo-bulb" cx="' + n1(25 + 18.9 * Math.cos(a)) + '" cy="' + n1(25 + 18.9 * Math.sin(a)) + '" r="1.9"/>';
    }
    return '<svg viewBox="0 0 50 50" aria-hidden="true"><circle class="o-ufo-hd" stroke-width="1.6" cx="25" cy="25" r="22.5"/>'
      + '<circle class="o-ufo-hl" stroke-width="1" cx="25" cy="25" r="15.6"/><circle class="o-ufo-glass" stroke-width="1.5" cx="25" cy="25" r="9"/>'
      + '<circle class="o-ufo-skin" stroke-width="1" cx="25" cy="25" r="4.6"/><path class="o-ufo-hi" d="M12.5 17C15 12.4 19.6 9.6 24.6 9.4"/>' + bulbs + '</svg>';
  })();
  // A tractor beam: a wrapper (it slides down) around the cone of light; rings may float up inside it.
  function beam(cls, opts) {
    opts = opts || {};
    return '<div class="o-ufo-bw ' + cls + '"' + (opts.style ? ' style="' + opts.style + '"' : '') + '><i class="o-ufo-beam' + (opts.soft ? ' o-ufo-soft' : '') + '"></i>'
      + (opts.rings || []).map(function (r) { return '<i class="o-ufo-ring" style="--rw:' + r[0] + 'px;--ry:' + r[1] + 'px;--rd:' + r[2] + 's"></i>'; }).join('') + '</div>';
  }

  /* ── follow — Beam up ── */
  K.register({
    key: 'follow-ufo', eventType: 'follow', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'ufoFollow', fx: 'none', anim: hold('1.5s'), exit: UFO_SUCK, len: 1.5,
    render: function (d) {
      return '<div class="obj o-ufo o-ufof">'
        + beam('o-ufof-bw', { rings: [[80, -32, 0.86], [80, -32, 1.08]] })
        + '<div class="o-ufo-sau o-ufo-chase o-ufof-sau">' + SAUCER + '</div>'
        + '<div class="o-ufof-pw"><div class="o-ufo-plate o-ufof-plate">'
        + nm('o-ufof-name o-ufo-name', d.username, 14)
        + '<div class="o-ufo-cap o-ufof-cap"><span class="o-ufof-did">followed</span> (resistance was futile)</div></div>'
        + '<div class="o-ufof-tagrow"><div class="o-ufo-tag o-ufof-tag">' + label(d, 'New follower') + '</div></div></div>'
        + '</div>';
    },
  });

  /* ── subscriber — Crop circle ── */
  // Seen from above, in a 172 × 172 field: one ring per tier around the months, a faint swirl of flattened
  // crop, and two arms out to small satellite circles, as crop circles have. Rings are paths (pathLength 100)
  // so CSS can draw them; centre (86, 86).
  var RINGS = { '1': [56], '2': [48, 62], '3': [44, 56, 68] };
  function ringPath(r) { return 'M' + (86 - r) + ' 86a' + r + ' ' + r + ' 0 1 1 ' + 2 * r + ' 0a' + r + ' ' + r + ' 0 1 1 -' + 2 * r + ' 0'; }
  function swirl(R) {
    var r = R - 4, ang = 0, d = 'M' + n1(86 + r) + ' 86';
    while (r > 37) {
      var r2 = r - 4.5;
      ang += Math.PI / 2;
      d += 'A' + n1(r) + ' ' + n1(r) + ' 0 0 1 ' + n1(86 + r2 * Math.cos(ang)) + ' ' + n1(86 + r2 * Math.sin(ang));
      r = r2;
    }
    return d;
  }
  function cropCircle(tier) {
    var rs = RINGS[tier], R = rs[rs.length - 1], b = n1(86 + (R + 2) * 0.7071), c = n1(86 - (R + 2) * 0.7071), out = '';
    rs.forEach(function (r, k) {
      out += '<path class="o-ufos-glow" pathLength="100" style="--rk:' + k + '" d="' + ringPath(r) + '"/>'
        + '<path class="o-ufos-ring" pathLength="100" style="--rk:' + k + '" d="' + ringPath(r) + '"/>';
    });
    var arm1 = 'M' + b + ' ' + c + 'L144.3 27.7a8 8 0 1 1 11.3 -11.3a8 8 0 1 1 -11.3 11.3';
    var arm2 = 'M' + c + ' ' + b + 'L28.6 143.4a6.5 6.5 0 1 1 -9.2 9.2a6.5 6.5 0 1 1 9.2 -9.2';
    return '<svg class="o-ufos-crop" viewBox="0 0 172 172" aria-hidden="true">'
      + '<circle class="o-ufos-flat" cx="86" cy="86" r="' + (R + 5) + '"/><path class="o-ufos-swirl" d="' + swirl(R) + '"/>' + out
      + '<path class="o-ufos-arm" pathLength="100" style="--rk:' + rs.length + '" d="' + arm1 + '"/>'
      + '<path class="o-ufos-arm" pathLength="100" style="--rk:' + rs.length + '" d="' + arm2 + '"/></svg>';
  }

  K.register({
    key: 'subscriber-ufo', eventType: 'subscription', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'ufoSub', fx: 'none', anim: hold('1.6s'), exit: UFO_WARP, len: 1.85,
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), tier = tierOf(d), digits = String(months).length;
      var fs = digits <= 2 ? 28 : digits === 3 ? 21 : 16, ri = '';
      for (var i = 0; i < Number(tier); i++) ri += '<i class="o-ufos-ri"></i>';
      return '<div class="obj o-ufo o-ufos"><div class="o-ufos-field">' + cropCircle(tier)
        + '<div class="o-ufos-core"><b class="o-ufos-mn" style="font-size:' + fs + 'px">' + odo(String(months), 1.24, 0.55) + '</b>'
        + '<small class="o-ufos-mu">' + (months === 1 ? 'month' : 'months') + '</small></div>'
        + '<div class="o-ufos-top"><i class="o-ufos-shade"></i>' + SAUCER_TOP + '</div></div>'
        + '<div class="o-ufo-plate o-ufos-plate"><div class="o-ufo-tag o-ufos-tag">' + label(d, months > 1 ? 'Resubscribed' : 'New subscriber') + '</div>'
        + nm('o-ufos-name o-ufo-name', d.username, 11)
        + '<div class="o-ufos-mo"><b class="o-ufos-mb">' + months + '</b>' + (months === 1 ? 'month' : 'months') + ' in the field</div>'
        + '<div class="o-ufos-tier"><span class="o-ufos-rs">' + ri + '</span>Tier ' + tier + '</div>'
        + (d.message ? '<div class="o-ufos-msg">“' + esc(d.message) + '”</div>' : '')
        + '</div></div>';
    },
  });

  /* ── bits — Cow lift ── */
  // A cow, side on and floating (viewBox 44 × 30): legs dangling, a curly tail, a surprised face.
  var COW = '<svg viewBox="0 0 44 30" aria-hidden="true">'
    + '<path class="o-ufo-ln" stroke-width="2.6" d="M10 20.5L7.5 27M16.5 21.5L16.5 28M24.5 21.5L25 28M30.5 20.5L33.5 26.5"/>'
    + '<path class="o-ufo-ln" stroke-width="1.6" d="M5.5 12C2.5 12.5 1.5 16.5 3 19.5"/>'
    + '<rect class="o-ufob-hide" stroke-width="1.8" x="4.5" y="7" width="31" height="16" rx="8"/>'
    + '<path class="o-ufob-spot" d="M11 7.8C14 9 15.2 12.4 13.2 15C10.8 17.6 7 15.8 5.4 12.8C6.6 9.8 8.6 8.2 11 7.8ZM22.5 15.4C25.4 14.2 28.6 15.6 28.4 18.6C28 21.4 24.4 22.3 21.8 22.1C20.8 20 21 17 22.5 15.4Z"/>'
    + '<path class="o-ufo-ln" stroke-width="1.6" d="M34.5 7.5L33.5 3.8M40.5 7.5L41.8 3.8"/>'
    + '<rect class="o-ufob-hide" stroke-width="1.8" x="31.5" y="5.5" width="11.5" height="12" rx="4.6"/>'
    + '<rect class="o-ufob-nose" stroke-width="1.3" x="32.5" y="12.6" width="11" height="6.6" rx="3.3"/>'
    + '<path class="o-ufo-eye" d="' + circ(35.4, 9.6, 1.3) + circ(39.8, 9.6, 1.3) + '"/></svg>';
  // Where the cows float in the beam (the middle of each cow, its tilt and its width), the highest
  // (first lifted) first. The beam is centred on x 97 and widens from 40px at y 60 to 180px at y 154.
  var COW_SLOTS = [[97, 88, -12, 34], [76, 116, 10, 37], [119, 108, -16, 36], [100, 138, 6, 40], [59, 146, 14, 40], [139, 146, -10, 40]];
  // 50 bits → 1 cow, 500 → 3, 10,000 → 5, never more than 6.
  function cowCount(n) { return Math.max(1, Math.min(6, Math.round(1.6 * Math.log10(n + 1) - 1.5))); }
  // The amount's size: Audiowide digits are .925em wide and a comma .225em; with the "+" (.36em at its
  // size) and the unit, the row has 181px, of which 141 scale with the amount.
  function bitsSize(n) {
    var wem = Array.from(fmt(n)).reduce(function (w, ch) { return w + (ch === ',' ? 0.225 : 0.925); }, 0);
    return Math.max(18, Math.min(40, Math.floor(141 / (wem + 0.36))));
  }

  K.register({
    key: 'bits-ufo', eventType: 'bits', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'ufoBits', fx: 'none', anim: hold('1.5s'), exit: UFO_SUCK,
    len: function (d) { return Math.max(1.4, 0.72 + (cowCount(K.sizeOf(d, 'bits')) - 1) * 0.11 + 0.64); },
    render: function (d) {
      var n = intOf(d.amount != null ? d.amount : d.bits), c = cowCount(K.sizeOf(d, 'bits')), cows = '';
      for (var i = 0; i < c; i++) {
        var s = COW_SLOTS[i], w = s[3], h = Math.round(w * 30 / 44);
        cows += '<i class="o-ufob-cow" style="left:' + n1(s[0] - w / 2) + 'px;top:' + n1(s[1] - h / 2) + 'px;width:' + w + 'px;height:' + h
          + 'px;--r:' + s[2] + 'deg;--dy:' + Math.round(156 - s[1]) + 'px;--cd:' + (0.72 + i * 0.11).toFixed(2) + 's">' + COW + '</i>';
      }
      return '<div class="obj o-ufo o-ufob"><i class="o-ufob-ground"></i>'
        + beam('o-ufob-bw', { rings: [[150, -72, 0.8], [150, -72, 1.06]] })
        + cows
        + '<div class="o-ufo-sau o-ufo-chase o-ufob-sau">' + SAUCER + '</div>'
        + '<div class="o-ufo-plate o-ufob-plate"><div class="o-ufo-tag o-ufob-tag">' + label(d, 'Bits beamed up') + '</div>'
        + '<div class="o-ufo-num o-ufob-amt" style="font-size:' + bitsSize(n) + 'px"><span class="o-ufob-plus">+</span>' + odo(fmt(n), 0.42, 0.85) + '<span class="o-ufob-unit">bits</span></div>'
        + nm('o-ufob-name o-ufo-name', d.username, 11)
        + '<div class="o-ufo-cap o-ufob-cap">' + c + (c === 1 ? ' cow' : ' cows') + ' beamed up</div></div>'
        + '</div>';
    },
  });

  /* ── donation — Transmission ── */
  // The message arrives as rows of alien glyphs (one masked row per line of text, the last one as long
  // as the last line), and a scan line sweeps across turning them into English. With no message, the
  // donor's name is what gets decoded.
  // The screen starts at 74px and ends 2px above the bottom: 83px of frame, head and signature plus the
  // message lines, or 85px when the name alone is decoded. Three lines make the tallest donation, 213px.
  var LINE = 18;
  // Nunito 800 widths in em, a little generous, to wrap the message as the screen will (384px at 14.5px)
  // and size the glyph rows: erring wide costs an empty line at worst, never a cut message.
  function charEm(c) {
    if (c === ' ') return 0.28;
    if (/[ijlftr.,:;!|'’]/.test(c)) return 0.33;
    if (/[mwMW]/.test(c)) return 0.96;
    if (/[A-Z]/.test(c)) return 0.71;
    if (/[0-9]/.test(c)) return 0.61;
    return isWide(c.codePointAt(0)) ? 1 : 0.6;
  }
  function wrapWidths(text, size, room) {
    var lines = [], cur = 0, sp = 0.28 * size;
    String(text).split(/\s+/).forEach(function (word) {
      var w = Array.from(word).reduce(function (s, c) { return s + charEm(c); }, 0) * size;
      if (cur && cur + sp + w > room) { lines.push(cur); cur = w; } else cur = cur ? cur + sp + w : w;
      while (cur > room) { lines.push(room); cur -= room; }   // a word longer than a line breaks anywhere
    });
    lines.push(cur);
    return lines;
  }
  function transmission(d) {
    var msg = String(d.message || '').trim(), count = Array.from(msg).length;
    if (!count) return { lines: 0, d0: 1.02, dt: 0.5, h: 161 };
    var widths = wrapWidths(msg, 14.5, 372), lines = Math.min(3, widths.length);
    return { lines: lines, widths: widths, d0: 1.02, dt: Math.max(0.45, Math.min(0.85, count * 0.01 + 0.2)), h: 159 + lines * LINE };
  }
  function glyphRow(top, width, i) {
    return '<i class="o-ufod-gr" style="top:' + top + 'px;width:' + width + ';--gx:' + (-((i * 37) % 96)) + 'px"></i>';
  }
  function decoded(cls, h, t, inner, rows) {
    return '<div class="o-ufod-dec ' + cls + '" style="height:' + h + 'px;--d0:' + t.d0 + 's;--dt:' + t.dt.toFixed(2) + 's">' + inner
      + '<div class="o-ufod-gly"><div class="o-ufod-glw">' + rows + '</div></div><i class="o-ufod-scan"></i></div>';
  }

  K.register({
    key: 'donation-ufo', eventType: 'donation', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'ufoDonation', fx: 'none', anim: hold('1.4s'), exit: UFO_WARP,
    len: function (d) { var t = transmission(d); return t.d0 + t.dt + 0.12; },
    render: function (d) {
      var t = transmission(d), body;
      if (t.lines) {
        var rows = '';
        for (var i = 0; i < t.lines; i++) {
          var full = i < t.lines - 1 || t.widths.length > t.lines;
          rows += glyphRow(i * LINE + 3, full ? '100%' : Math.max(30, Math.round(t.widths[i])) + 'px', i);
        }
        body = decoded('o-ufod-msg', t.lines * LINE, t, '<div class="o-ufod-en o-ufod-text" style="-webkit-line-clamp:' + t.lines + '">' + esc(d.message) + '</div>', rows)
          + '<div class="o-ufod-from o-ufod-sig"><span class="o-ufo-cap">from</span>' + nm('o-ufod-name o-ufo-name', d.username, 18) + '</div>';
      } else {
        // One glyph row as long as "from" and the name (Nunito 900 at 26px, scaled down like the name).
        var nameW = Array.from(String(d.username)).reduce(function (s, c) { return s + charEm(c) * 1.05; }, 0) * 26 * Number((fitStyle(d.username, 17).match(/[\d.]+/) || [1])[0]);
        body = decoded('o-ufod-solo', 30, t, '<div class="o-ufod-en o-ufod-from"><span class="o-ufo-cap">from</span>' + nm('o-ufod-name o-ufod-big o-ufo-name', d.username, 17) + '</div>',
          glyphRow(9, Math.min(384, Math.round(40 + nameW)) + 'px', 1));
      }
      return '<div class="obj o-ufo o-ufod" style="height:' + t.h + 'px">'
        + beam('o-ufod-bw')
        + '<div class="o-ufo-sau o-ufo-chase o-ufod-sau">' + SAUCER + '</div>'
        + '<div class="o-ufod-scr"><div class="o-ufod-head"><div class="o-ufo-tag o-ufod-tag">' + label(d, 'Incoming transmission') + '</div>'
        + '<div class="o-ufod-amt">' + odo(money(d.amount, d.currency), 0.84, 0.7) + '</div></div>'
        + body + '</div></div>';
    },
  });

  /* ── raid — Invasion ── */
  // Formation slots in the sky (x and y of the saucer's middle, and its width), the leader first.
  // FILL is the order they fill in, so the formation stays balanced; DEPTH draws the far ones first
  // (they also arrive first, and the leader lands last). FAR: lights far off, for a raid past ten.
  var SLOTS = [[207, 68, 84], [138, 54, 66], [276, 54, 66], [78, 42, 54], [336, 42, 54], [30, 32, 42], [384, 32, 42], [172, 28, 46], [242, 28, 46], [207, 14, 38]];
  var FILL = [0, 1, 2, 3, 4, 7, 8, 5, 6, 9];
  var DEPTH = [9, 7, 8, 5, 6, 3, 4, 1, 2, 0];
  var FAR = [[116, 12], [296, 10], [34, 74], [382, 72], [62, 10], [352, 12]];
  function fleet(v) {
    var n = Math.max(1, Math.min(v, 10)), used = FILL.slice(0, n);
    var order = DEPTH.filter(function (s) { return used.indexOf(s) >= 0; });
    var far = v > 10 ? Math.min(6, Math.round(Math.log10(v) * 2)) : 0, land = 0.3 + (n - 1) * 0.05 + 0.62;
    return { n: n, order: order, far: far, land: land, len: Math.max(1.45, land + 0.3, far ? 0.95 + (far - 1) * 0.07 + 0.3 : 0) };
  }

  K.register({
    key: 'raid-ufo', eventType: 'raid', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'ufoRaid', fx: 'none', anim: hold('1.5s'), exit: UFO_ZIP,
    len: function (d) { return fleet(K.sizeOf(d, 'raid')).len; },
    render: function (d) {
      var v = intOf(d.viewers), f = fleet(K.sizeOf(d, 'raid')), ships = '', far = '', bd = '--bd:' + (f.land - 0.04).toFixed(2) + 's';
      f.order.forEach(function (s, i) {
        var p = SLOTS[s], w = p[2], h = w * 64 / 120;
        ships += '<div class="o-ufo-sau o-ufor-ship" style="left:' + n1(p[0] - w / 2) + 'px;top:' + n1(p[1] - h / 2) + 'px;width:' + w + 'px;height:' + n1(h)
          + 'px;--fd:' + (0.3 + i * 0.05).toFixed(2) + 's">' + SAUCER + '</div>';
      });
      for (var i = 0; i < f.far; i++) far += '<i class="o-ufor-far" style="left:' + FAR[i][0] + 'px;top:' + FAR[i][1] + 'px;--fd:' + (0.95 + i * 0.07).toFixed(2) + 's"></i>';
      return '<div class="obj o-ufo o-ufor"><div class="o-ufor-sky">' + far + '<i class="o-ufor-hills"></i>'
        + '<i class="o-ufor-spot" style="' + bd + '"></i>' + beam('o-ufor-bw', { style: bd }) + ships + '</div>'
        + '<div class="o-ufo-plate o-ufor-plate"><div class="o-ufor-tagrow"><div class="o-ufo-tag o-ufor-tag">' + label(d, 'Invasion!') + '</div></div>'
        + '<div class="o-ufor-row">' + nm('o-ufor-name o-ufo-name', d.username + '’s fleet', 17) + '<i class="o-ufor-sep"></i>'
        + '<b class="o-ufo-num o-ufor-num">' + odo(fmt(v), 0.45, 0.9) + '</b></div></div>'
        + '</div>';
    },
  });

  /* ── giveaway — Mothership ── */
  // The mothership (viewBox 408 × 74): a wide deck with five windows (a crew member in each), a huge
  // silver disc with fifteen lights on its rim, and a hatch underneath at (204, 64).
  var MOTHER = (function () {
    var lamps = '', crew = '';
    for (var k = 0; k < 15; k++) {
      var x = 22 + 26 * k, s = Math.sqrt(1 - Math.pow((x - 204) / 200, 2));
      lamps += lamp(x, 42.5 + 11.5 * s, k, true);
    }
    [164, 184, 204, 224, 244].forEach(function (cx, i) {
      crew += '<circle class="o-ufog-win" stroke-width="1.6" cx="' + cx + '" cy="20" r="7"/>'
        + '<g class="o-ufog-face" style="--wi:' + i + '"><circle class="o-ufo-skin" stroke-width="1" cx="' + cx + '" cy="21.6" r="4.4"/>'
        + '<path class="o-ufo-eye" d="' + circ(cx - 1.7, 20.9, 1) + circ(cx + 1.7, 20.9, 1) + '"/></g>';
    });
    return '<svg viewBox="0 0 408 74" aria-hidden="true">'
      + '<path class="o-ufo-hl" stroke-width="2" d="M120 34C128 12 170 4 204 4S280 12 288 34Z"/><path class="o-ufo-hi" d="M134 25C143 14 166 8.6 192 8"/>'
      + crew
      + '<ellipse class="o-ufog-under" stroke-width="2" cx="204" cy="58" rx="76" ry="10"/>'
      + '<ellipse class="o-ufo-hd" stroke-width="2" cx="204" cy="45" rx="200" ry="14"/>'
      + '<ellipse class="o-ufo-hl" stroke-width="1.2" cx="204" cy="40" rx="200" ry="9"/>'
      + '<path class="o-ufo-hi" d="M30 37.4C70 33.4 130 31.4 196 31.2"/>'
      + lamps + '</svg>';
  })();

  K.register({
    key: 'giveaway-ufo', eventType: 'giveaway_winner', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'ufoGiveaway', fx: 'confetti', anim: hold('1.8s'), exit: UFO_LIFT, len: 1.95,
    render: function (d) {
      return '<div class="obj o-ufo o-ufog">'
        + beam('o-ufog-spot', { soft: true }) + '<i class="o-ufog-pool"></i>'
        + '<div class="o-ufog-shipw">' + MOTHER + '<i class="o-ufog-hglow"></i><i class="o-ufog-door o-ufog-dl"></i><i class="o-ufog-door o-ufog-dr"></i></div>'
        + '<div class="o-ufog-pw"><div class="o-ufo-plate o-ufog-plate">' + nm('o-ufog-name o-ufo-name', d.username, 13) + '</div>'
        + '<div class="o-ufog-tagrow"><div class="o-ufo-tag o-ufog-tag">' + label(d, 'Giveaway winner') + '</div></div></div>'
        + (d.prize ? '<div class="o-ufog-prow"><div class="o-ufog-holo"><span class="o-ufog-pl">Prize</span><b class="o-ufog-pt">' + esc(d.prize) + '</b></div></div>' : '')
        + '</div>';
    },
  });

  Object.keys(SOUNDS).forEach(function (k) { K.registerSound(k, FAMILY, SOUNDS[k]); });
})(typeof window !== 'undefined' ? window : null);
