'use strict';

/**
 * Dino (docs/superpowers/specs/2026-10-15-alert-styles-design.md, Appendix A), ported from the proposal
 * (docs/superpowers/specs/assets/2026-10-15-alert-styles/parts/fam/dno.js and .css).
 * Its names and descriptions are in the locale files (overlayBuilder.families.dino, overlayBuilder.looks.<id>,
 * overlayBuilder.sounds.<key>). Its classes start with .o-dno and its keyframes with dno.
 */
/* ═══ Dino — a friendly prehistoric adventure ═══
   Footprints, eggs, a volcano, fossils, a herd and a drop of amber, drawn as chunky cartoons with a dark
   ink outline. Every dinosaur wears the streamer's colour (and so do the gems, the egg's spots and the
   amber); rocks, sand, bone and ferns stay natural. Stompy, bouncy motion: the alert gives a small shake
   on every stomp, things squash as they land, then everything holds still. Everything private to this
   family lives inside this function, so its helper names cannot collide with another family's. */
(function (root) {
  var K = (root && root.ATLETA_KIT) || require('../kit.js');
  var FAMILY = 'dino';
  var esc = K.esc, money = K.money, nm = K.nm, fmt = K.fmt, label = K.label, odo = K.odo, hash = K.hash, rng = K.rng, intOf = K.intOf, tone = K.tone, noise = K.noise, engine = K.engine;
  var SOUNDS = {};
  function hold(dur) { return { in: 'hold', dur: dur, ease: 'linear' }; }
  // Every look takes the streamer's colour and its speed, and its main text when it shows one.
  var CONTROLS = { colour: 'accent', label: true, speed: true };
  var CONTROLS_NO_TEXT = { colour: 'accent', label: false, speed: true };
  K.registerFamily({ key: FAMILY, order: 23, fonts: ["Bangers","Nunito:wght@700;800;900","Luckiest+Guy"] });


  /* ── Sounds, timed to the animations ── */
  SOUNDS.dnoFollow = function () {
    [0.35, 0.5, 0.65, 0.8].forEach(function (t, i) {                                   // four stomps
      tone({ f: 96 - i * 4, f2: 44, d: 0.24, v: 0.12, a: 0.004, t: t });
      noise({ ft: 'lowpass', f: 420, f2: 160, d: 0.14, v: 0.24, t: t });
    });
    tone({ f: 520, f2: 980, d: 0.12, v: 0.06, type: 'triangle', t: 1.06 });              // the dino pops up and chirps
    tone({ f: 760, f2: 1320, d: 0.16, v: 0.05, type: 'triangle', t: 1.2 });
  };
  SOUNDS.dnoSub = function () {
    noise({ ft: 'lowpass', f: 360, d: 0.1, v: 0.18, t: 0.3 });                          // the egg lands in the nest
    tone({ f: 150, f2: 80, d: 0.12, v: 0.07, t: 0.3 });
    [0.5, 0.62, 0.74, 0.86].forEach(function (t) { noise({ ft: 'bandpass', f: 2600, q: 3, d: 0.03, v: 0.1, t: t }); });   // it rocks
    noise({ ft: 'highpass', f: 2400, d: 0.09, v: 0.22, t: 0.96 });                       // crack
    noise({ ft: 'bandpass', f: 1300, q: 2, d: 0.12, v: 0.14, t: 0.97 });
    tone({ f: 1250, f2: 1750, d: 0.09, v: 0.06, type: 'triangle', t: 1.16 });            // peep peep
    tone({ f: 1350, f2: 1950, d: 0.12, v: 0.06, type: 'triangle', t: 1.32 });
    noise({ ft: 'bandpass', f: 3000, q: 4, d: 0.03, v: 0.1, t: 1.42 });                  // the shell lands on its head
  };
  SOUNDS.dnoBits = function () {
    engine({ f: 36, f2: 50, d: 0.5, v: 0.1, t: 0.28 });                                  // the volcano rumbles
    noise({ ft: 'lowpass', f: 180, d: 0.48, v: 0.22, a: 0.15, t: 0.28 });
    noise({ ft: 'lowpass', f: 700, f2: 120, d: 0.4, v: 0.28, t: 0.74 });                 // boom
    tone({ f: 72, f2: 34, d: 0.42, v: 0.12, t: 0.74 });
    [1568, 1976, 2349, 2637, 3136].forEach(function (f, i) { tone({ f: f, d: 0.28, v: 0.035, t: 1.12 + i * 0.08 }); });   // gems land
  };
  SOUNDS.dnoDonation = function () {
    noise({ ft: 'lowpass', f: 320, d: 0.12, v: 0.2, t: 0.3 });                          // the slab lands
    tone({ f: 120, f2: 64, d: 0.14, v: 0.08, t: 0.3 });
    noise({ ft: 'bandpass', f: 3200, q: 0.9, d: 0.48, v: 0.1, a: 0.1, t: 0.38 });         // brush, left to right
    noise({ ft: 'bandpass', f: 2700, q: 0.9, d: 0.44, v: 0.1, a: 0.1, t: 0.88 });         // and back
    tone({ f: 1319, d: 0.5, v: 0.05, type: 'triangle', t: 1.38 });                       // found it
    tone({ f: 1976, d: 0.6, v: 0.04, type: 'triangle', t: 1.46 });
  };
  SOUNDS.dnoRaid = function () {
    for (var i = 0; i < 12; i++) noise({ ft: 'lowpass', f: 260, d: 0.07, v: 0.1 + (i < 6 ? i : 11 - i) * 0.025, t: 0.34 + i * 0.08 });   // feet
    tone({ f: 330, f2: 440, d: 0.16, v: 0.06, type: 'triangle', t: 1.3 });              // a happy honk
    tone({ f: 440, f2: 560, d: 0.22, v: 0.06, type: 'triangle', t: 1.46 });
  };
  SOUNDS.dnoGiveaway = function () {
    noise({ ft: 'lowpass', f: 340, d: 0.1, v: 0.18, t: 0.26 });                         // the tablet lands
    tone({ f: 900, f2: 1500, d: 0.1, v: 0.05, t: 0.56 });                                // plip
    tone({ f: 420, f2: 130, d: 0.16, v: 0.08, t: 0.86 });                                // splat
    noise({ ft: 'lowpass', f: 800, d: 0.12, v: 0.14, t: 0.86 });
    tone({ f: 220, d: 0.6, v: 0.04, type: 'triangle', a: 0.15, t: 1.0 });                // it glows
    [1568, 1976, 2349, 3136].forEach(function (f, i) { tone({ f: f, d: 0.3, v: 0.035, t: 1.32 + i * 0.08 }); });   // and sets
  };

  /* ── Shared pieces ── */
  function n1(x) { return String(Math.round(x * 10) / 10); }
  function exit(name, dur) { return { out: name, dur: dur, ease: 'cubic-bezier(.45,0,.8,.45)' }; }
  // Sand puffs, each [x, y, size, dx, dy, delay] in px and seconds, placed in their parent. They puff once.
  function puffs(list) {
    return list.map(function (p) {
      return '<i class="o-dno-puff" style="left:' + p[0] + 'px;top:' + p[1] + 'px;--ps:' + p[2] + 'px;--dx:' + p[3] + 'px;--dy:' + p[4] + 'px;--pd:' + p[5].toFixed(2) + 's"></i>';
    }).join('');
  }
  function tierOf(d) {
    var t = String(d.tier || '1');
    if (/^[123]000$/.test(t)) t = t.charAt(0);
    return t === '2' || t === '3' ? t : '1';
  }
  // Width of a number in Nunito 900, in em (digits and signs are .6em, a comma or a point .27em).
  function numEm(text) { return Array.from(String(text)).reduce(function (w, c) { return w + (c === ',' || c === '.' ? 0.272 : c === ' ' ? 0.286 : 0.6); }, 0); }
  function fitPx(text, room, max, min) { return Math.max(min, Math.min(max, Math.floor(room / numEm(text)))); }

  // A cartoon eye: white, a pupil looking (lx, ly) away from the centre, and a glint.
  function eye(cx, cy, r, lx, ly) {
    var pr = r * 0.54;
    return '<ellipse class="o-dno-wh" cx="' + n1(cx) + '" cy="' + n1(cy) + '" rx="' + n1(r) + '" ry="' + n1(r * 1.14) + '"/>'
      + '<ellipse class="o-dno-in" cx="' + n1(cx + lx) + '" cy="' + n1(cy + ly) + '" rx="' + n1(pr) + '" ry="' + n1(pr * 1.22) + '"/>'
      + '<circle class="o-dno-gl" cx="' + n1(cx + lx - pr * 0.36) + '" cy="' + n1(cy + ly - pr * 0.5) + '" r="' + n1(pr * 0.44) + '"/>';
  }
  // A circle as a path (so several can share one outlined shape).
  function circ(x, y, r) { return 'M' + n1(x - r) + ' ' + n1(y) + 'a' + n1(r) + ' ' + n1(r) + ' 0 1 0 ' + n1(2 * r) + ' 0a' + n1(r) + ' ' + n1(r) + ' 0 1 0 ' + n1(-2 * r) + ' 0Z'; }
  // A shape drawn twice: in the dino's colour with the ink outline, then a shade on top (dk darker, lt lighter).
  function skin(d, shade) { return '<path class="o-dno-sk" d="' + d + '"/>' + (shade ? '<path class="o-dno-' + shade + '" d="' + d + '"/>' : ''); }

  // A three-toed footprint, toes up (rotated by its parent).
  var PRINT = '<svg viewBox="0 0 30 30" aria-hidden="true"><path class="o-dno-pr" d="M15 30C10 30 7.5 26.5 7.5 22.5C7.5 18 11 15 15 15S22.5 18 22.5 22.5C22.5 26.5 20 30 15 30Z'
    + 'M15 14.5C12.6 14.5 11.6 11 11.8 7.5C12 4 13.2 1 15 1S18 4 18.2 7.5C18.4 11 17.4 14.5 15 14.5Z'
    + 'M9.6 16.6C7.6 18 4.4 16.4 2.6 13.4C.9 10.6.6 7.6 2.3 6.5C4 5.4 6.6 7.4 8.2 10.2C9.9 13.1 11.4 15.3 9.6 16.6Z'
    + 'M20.4 16.6C22.4 18 25.6 16.4 27.4 13.4C29.1 10.6 29.4 7.6 27.7 6.5C26 5.4 23.4 7.4 21.8 10.2C20.1 13.1 18.6 15.3 20.4 16.6Z"/></svg>';
  // A fern frond: a curved stem with leaflets (natural green, ink outline).
  function fern(w, h, flip) {
    var leaves = '', i;
    for (i = 0; i < 6; i++) {
      var t = i / 6, x = 6 + t * (w - 14), y = h - 4 - Math.sin(t * Math.PI * 0.5) * (h - 10), s = 7.5 - i * 0.8;
      leaves += 'M' + n1(x) + ' ' + n1(y) + 'q' + n1(-s * 0.5) + ' ' + n1(-s * 1.4) + ' ' + n1(s * 0.3) + ' ' + n1(-s * 1.7) + 'q' + n1(s * 0.5) + ' ' + n1(s * 0.9) + ' ' + n1(-s * 0.3) + ' ' + n1(s * 1.7) + 'Z';
      leaves += 'M' + n1(x) + ' ' + n1(y) + 'q' + n1(s * 1.2) + ' ' + n1(s * 0.2) + ' ' + n1(s * 1.6) + ' ' + n1(s * 0.9) + 'q' + n1(-s * 1.1) + ' ' + n1(s * 0.5) + ' ' + n1(-s * 1.6) + ' ' + n1(-s * 0.9) + 'Z';
    }
    return '<svg class="o-dno-fern" viewBox="0 0 ' + w + ' ' + h + '"' + (flip ? ' style="transform:scaleX(-1)"' : '') + ' aria-hidden="true">'
      + '<path class="o-dno-fl" d="' + leaves + '"/><path class="o-dno-fs" d="M4 ' + (h - 2) + 'Q' + n1(w * 0.55) + ' ' + n1(h - 4) + ' ' + (w - 6) + ' 6"/></svg>';
  }

  /* ── follow — Footprints ── */
  // A friendly dino facing left, peeking up from behind the ground with one hand on the sign's edge.
  var PEEK = '<svg viewBox="0 0 134 120" aria-hidden="true">'
    + skin('M97 14L104 2L112 15ZM115 19L128 12L125 28ZM125 35L134 34L128 48ZM124 82L133 87L128 97Z', 'dk')
    + skin('M60 124C56 98 70 74 96 72C120 70 133 90 131 124Z')
    + '<path class="o-dno-lt" d="M70 124C68 105 76 93 90 91C102 91 108 105 106 124Z"/>'
    + skin('M70 86C58 84 46 85 37 87C32 88 30 91 30 94C30 97 32 100 37 100C48 101 59 101 70 99Z')
    + skin(circ(28.6, 87.4, 4.6) + circ(26.4, 94, 4.8) + circ(28.6, 100.6, 4.6))
    + skin('M72 80C58 80 44 75 38 66C32 58 33 46 41 40C49 34 57 32 63 26C71 15 86 10 100 11C117 13 128 27 126 45C125 62 112 76 96 80C88 81 80 81 72 80Z')
    + '<path class="o-dno-lt" d="M40 62C46 70 58 74 72 75C80 75 86 74 90 72C82 79 66 80 54 77C47 75 42 70 40 62Z"/>'
    + eye(74, 40, 10, -3.5, 2)
    + '<ellipse class="o-dno-in" cx="44" cy="47" rx="1.7" ry="2.3" transform="rotate(-20 44 47)"/>'
    + '<path class="o-dno-ln" d="M40 59Q51 69 66 63"/><path class="o-dno-th" d="M48 63.6L50.4 68.4L53 64.8Z"/>'
    + '<ellipse class="o-dno-bl" cx="80" cy="59" rx="7" ry="4"/></svg>';

  K.register({
    key: 'follow-dino', eventType: 'follow', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'dnoFollow', fx: 'none', anim: hold('1.4s'), exit: exit('dnoDuckOut', '0.42s'), len: 1.4,
    render: function (d) {
      var prints = '';
      [[40, 15, 84], [112, 21, 96], [184, 15, 84], [256, 21, 96]].forEach(function (p, i) {
        prints += '<i class="o-dnof-print o-dno-pic" style="left:' + (p[0] - 14) + 'px;top:' + (p[1] - 14) + 'px;--pr:' + p[2] + 'deg;--pd:' + (0.24 + i * 0.15).toFixed(2) + 's">' + PRINT + '</i>';
      });
      return '<div class="obj o-dno o-dnof"><div class="o-dno-sh">'
        + '<div class="o-dnof-rise"><div class="o-dnof-up">'
        + '<div class="o-dno-stone o-dnof-sign"><div class="o-dnof-txt"><div class="o-dno-tag o-dnof-tag">' + label(d, 'New follower') + '</div>'
        + nm('o-dno-name o-dnof-name', d.username, 15) + '</div></div>'
        + '<div class="o-dnof-dino o-dno-pic">' + PEEK + '</div></div></div>'
        + '<div class="o-dnof-ground">' + prints + '<i class="o-dnof-peb" style="left:296px;top:17px;width:15px;height:10px"></i><i class="o-dnof-peb" style="left:313px;top:21px;width:9px;height:7px"></i><i class="o-dnof-peb" style="left:392px;top:15px;width:13px;height:9px"></i></div>'
        + puffs([[40, 108, 22, -12, -6, 0.35], [112, 114, 22, 12, -6, 0.5], [184, 108, 22, -12, -6, 0.65], [256, 114, 22, 12, -6, 0.8], [312, 104, 26, -16, -8, 1.22], [404, 104, 26, 16, -8, 1.22]])
        + '</div></div>';
    },
  });

  /* ── subscriber — Egg hatch ── */
  // The egg (100 × 122) splits along a zigzag: the top becomes the baby's hat, the bottom stays in the nest.
  var ZIG = 'L17.75 39L28.5 50L39.25 39L50 51L60.75 39L71.5 50L82.25 39L93 46';
  var EGG_TOP = 'M7 46C6 22 26 2 50 2C74 2 94 22 93 46', EGG_BOT = 'M93 46C96 56 98 66 98 76C98 104 78 120 50 120C22 120 2 104 2 76C2 66 4 56 7 46';
  var TOP_FILL = EGG_TOP + 'L82.25 39L71.5 50L60.75 39L50 51L39.25 39L28.5 50L17.75 39Z';
  var BOT_FILL = 'M7 46' + ZIG + 'C96 56 98 66 98 76C98 104 78 120 50 120C22 120 2 104 2 76C2 66 4 56 7 46Z';
  var SPOTS = { '1': [[50, 86, 13, 10.5]], '2': [[31, 78, 11, 9], [66, 95, 12, 10]], '3': [[25, 73, 10, 8], [62, 68, 9.5, 7.5], [52, 99, 12, 9.5]] };
  function spots(tier) {
    return SPOTS[tier].map(function (s) {
      return '<ellipse class="o-dno-spot" cx="' + s[0] + '" cy="' + s[1] + '" rx="' + s[2] + '" ry="' + s[3] + '"/>'
        + '<ellipse class="o-dno-gl" cx="' + n1(s[0] - s[2] * 0.35) + '" cy="' + n1(s[1] - s[3] * 0.4) + '" rx="' + n1(s[2] * 0.26) + '" ry="' + n1(s[3] * 0.22) + '"/>';
    }).join('');
  }
  // The baby (in a 120 × 96 window whose bottom is the shell's rim): front view, hands on its stone tablet.
  var BABY = '<svg viewBox="0 0 120 96" aria-hidden="true">'
    + skin('M32 96C30 80 42 70 60 70S90 80 88 96Z')
    + skin('M34 42L37 25L46 34ZM74 34L83 25L86 42Z', 'dk')
    + skin('M60 18C80 18 92 30 92 45C92 61 78 71 60 71S28 61 28 45C28 30 40 18 60 18Z')
    + '<path class="o-dno-lt" d="M60 50C71 50 78 55 78 60C78 66 70 70 60 70S42 66 42 60C42 55 49 50 60 50Z"/>'
    + eye(47, 41, 7.2, 1, 1.4) + eye(73, 41, 7.2, -1, 1.4)
    + '<ellipse class="o-dno-in" cx="55.5" cy="56" rx="1.6" ry="1.9"/><ellipse class="o-dno-in" cx="64.5" cy="56" rx="1.6" ry="1.9"/>'
    + '<path class="o-dno-ln" d="M53 62.5Q60 67.5 67 62.5"/>'
    + '<ellipse class="o-dno-bl" cx="38" cy="55" rx="5" ry="3"/><ellipse class="o-dno-bl" cx="82" cy="55" rx="5" ry="3"/></svg>';
  var NEST = '<svg viewBox="0 0 136 32" aria-hidden="true"><path class="o-dno-nest" d="M3 6C24 15 112 15 133 6C131 23 106 31 68 31S5 23 3 6Z"/>'
    + '<path class="o-dno-twig" d="M12 14C30 22 54 24 76 22M28 24C52 28 86 27 110 18M60 16C80 18 104 14 124 10M18 9L36 18M98 20L118 13M48 25L70 21"/></svg>';

  K.register({
    key: 'subscriber-dino', eventType: 'subscription', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'dnoSub', fx: 'confetti', anim: hold('1.6s'), exit: exit('dnoEggOut', '0.42s'), len: 1.9,
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), tier = tierOf(d), digits = String(months).length;
      var heading = months > 1 ? 'Resubscribed' : 'New subscriber', dots = '';
      for (var i = 0; i < Number(tier); i++) dots += '<i class="o-dnos-dot"></i>';
      return '<div class="obj o-dno o-dnos"><div class="o-dno-sh">'
        + '<div class="o-dno-stone o-dnos-plate"><div class="o-dno-tag o-dnos-tag">' + label(d, heading) + '</div>'
        + nm('o-dno-name o-dnos-name', d.username, 14)
        + '<div class="o-dnos-meta"><span class="o-dnos-mo"><b class="o-dnos-mn">' + months + '</b> ' + (months === 1 ? 'month' : 'months') + '</span><i class="o-dnos-sep"></i><span>Tier ' + tier + '</span><span class="o-dnos-dots">' + dots + '</span></div>'
        + (d.message ? '<div class="o-dnos-msg">“' + esc(d.message) + '”</div>' : '') + '</div>'
        + '<div class="o-dnos-egg">'
        + '<svg class="o-dnos-back" viewBox="0 0 100 122" aria-hidden="true"><ellipse class="o-dnos-hole" cx="50" cy="45" rx="42" ry="8.5"/></svg>'
        + '<div class="o-dnos-babyw"><div class="o-dnos-baby">' + BABY
        + '<div class="o-dno-stone o-dnos-tab"><b class="o-dnos-num" style="font-size:' + (digits <= 2 ? 26 : digits === 3 ? 21 : 17) + 'px">' + odo(String(months), 1.26, 0.6) + '</b></div>'
        + '<i class="o-dnos-hand o-dnos-handl"></i><i class="o-dnos-hand o-dnos-handr"></i></div></div>'
        + '<svg class="o-dnos-front" viewBox="0 0 100 122" aria-hidden="true"><path class="o-dno-shell" d="' + BOT_FILL + '"/>'
        + '<path class="o-dno-shd" d="M98 76C98 104 78 120 50 120C70 112 84 98 86 76C87 64 84 54 80 46L93 46C96 56 98 66 98 76Z"/>'
        + spots(tier) + '<path class="o-dno-eo" d="' + EGG_BOT + '"/><path class="o-dnos-crack" pathLength="100" d="M7 46' + ZIG + '"/></svg>'
        + '<div class="o-dnos-topw"><svg class="o-dnos-top" viewBox="0 0 100 56" aria-hidden="true"><path class="o-dno-shell" d="' + TOP_FILL + '"/>'
        + '<path class="o-dno-hl" d="M20 30C20 20 28 11 38 8"/><path class="o-dno-eo" d="' + EGG_TOP + '"/><path class="o-dnos-crack" pathLength="100" d="M7 46' + ZIG + '"/></svg></div>'
        + '</div>'
        + '<div class="o-dnos-nest">' + NEST + '</div>'
        + '</div></div>';
    },
  });

  /* ── bits — Volcano ── */
  // 50 bits → 5 gems, 500 → 8, 10,000 → 12 (never fewer than 3 or more than 14).
  function gemCount(n) { return Math.max(3, Math.min(14, Math.round(3.2 * Math.log10(n + 1) - 0.8))); }
  var CRATER = [106, 46];
  var VOLCANO = '<svg viewBox="0 0 196 120" aria-hidden="true">'
    + '<path class="o-dnob-rock" d="M2 126C20 104 44 62 62 28C66 20 71 16 79 16L117 16C125 16 130 20 134 28C152 62 176 104 194 126Z"/>'
    + '<path class="o-dno-dk2" d="M117 16C125 16 130 20 134 28C152 62 176 104 194 126L120 126C130 96 128 60 112 18Z"/>'
    + '<path class="o-dno-hi" d="M62 28C66 20 71 16 79 16L84 16C70 40 56 72 44 104L30 104C40 86 52 52 62 28Z"/>'
    + '<path class="o-dnob-crack" d="M48 86L58 80L56 70M150 82L140 74L144 64M98 104L102 92L96 84"/>'
    + '<path class="o-dnob-edge" d="M2 126C20 104 44 62 62 28C66 20 71 16 79 16L117 16C125 16 130 20 134 28C152 62 176 104 194 126"/>'
    + '<ellipse class="o-dnob-crater" cx="98" cy="17" rx="29" ry="7"/><ellipse class="o-dnob-core" cx="98" cy="17" rx="17" ry="3.6"/></svg>';
  var LAVA = '<svg viewBox="0 0 196 120" aria-hidden="true"><path class="o-dnob-lava" d="M72 18C68 30 62 42 62 52C62 60 72 60 73 51C74 42 78 32 84 22Z'
    + 'M90 22C88 40 90 58 95 64C99 69 104 62 102 54C100 44 102 32 105 22Z'
    + 'M112 20C118 30 125 42 127 51C129 59 121 61 119 54C117 46 113 34 108 23Z"/>'
    + '<path class="o-dno-hl" d="M66 50C66 42 70 34 74 28M93 52C92 44 92 36 93 28M122 50C121 44 118 38 115 32"/></svg>';
  var GEM = '<svg viewBox="0 0 22 20" aria-hidden="true"><path class="o-dnob-gem" d="M6 1.5H16L21 7.5L11 18.8L1 7.5Z"/><path class="o-dno-lt" d="M6 1.5H16L14 7.5H8Z"/>'
    + '<path class="o-dno-dk" d="M14 7.5H21L11 18.8Z"/><path class="o-dnob-facet" d="M1 7.5H21M8 7.5L11 18.8L14 7.5"/></svg>';

  K.register({
    key: 'bits-dino', eventType: 'bits', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'dnoBits', fx: 'sparks', anim: hold('1.5s'), exit: exit('dnoQuakeOut', '0.45s'),
    len: function (d) { return Math.max(1.6, 0.74 + (gemCount(intOf(K.sizeOf(d, 'bits'))) - 1) * 0.035 + 0.64); },
    render: function (d) {
      var n = intOf(d.amount != null ? d.amount : d.bits), drawn = intOf(K.sizeOf(d, 'bits')), count = gemCount(drawn), r = rng(hash(d.username + drawn)), gems = '', i;
      var size = drawn >= 1000 ? 22 : 20, front = Math.ceil(count / 2);
      for (i = 0; i < count; i++) {
        var row = i < front ? 0 : 1, k = row ? i - front : i, inRow = row ? count - front : front;
        var gx = 24 + (k + 0.5 + (row ? 0.5 : 0)) * (176 / Math.max(inRow, 1)) + (r() - 0.5) * 8;
        var gy = (row ? 148 : 157) + (r() - 0.5) * 3;
        gx = Math.max(16, Math.min(198, gx));
        var sx = CRATER[0] - gx, sy = CRATER[1] - gy, h = 46 + r() * 34;
        gems += '<i class="o-dnob-gemw" style="left:' + n1(gx - size / 2) + 'px;top:' + n1(gy - size * 0.45) + 'px;width:' + size + 'px;height:' + n1(size * 0.9)
          + 'px;--sx:' + n1(sx) + 'px;--sy:' + n1(sy) + 'px;--h:' + n1(h) + 'px;--gr:' + Math.round((r() - 0.5) * 720) + 'deg;--fr:' + Math.round((r() - 0.5) * 30) + 'deg;--gd:' + (0.74 + i * 0.035).toFixed(3) + 's">' + GEM + '</i>';
      }
      var amt = '+' + fmt(n), px = fitPx(amt, 126, 40, 22);
      return '<div class="obj o-dno o-dnob"><div class="o-dno-sh">'
        + '<i class="o-dnob-glow"></i>'
        + '<div class="o-dnob-volc">' + VOLCANO + '<div class="o-dnob-lavaw o-dno-pic">' + LAVA + '</div></div>'
        + '<i class="o-dnob-smoke" style="--sd:.34s;--sx2:-10px"></i><i class="o-dnob-smoke" style="--sd:.48s;--sx2:8px"></i><i class="o-dnob-smoke" style="--sd:.6s;--sx2:-4px"></i>'
        + '<div class="o-dnob-ground"><i class="o-dnob-fern">' + fern(34, 26, true) + '</i></div>'
        + gems
        + '<div class="o-dno-stone o-dnob-plate"><div class="o-dno-tag o-dnob-tag">' + label(d, 'Gem eruption!') + '</div>'
        + '<div class="o-dnob-amt" style="font-size:' + px + 'px"><span class="o-dnob-plus">+</span>' + odo(fmt(n), 0.74, 0.85) + '<span class="o-dnob-unit">bits</span></div>'
        + nm('o-dno-name o-dnob-name', d.username, 13) + '</div>'
        + '</div></div>';
    },
  });

  /* ── donation — Fossil dig ── */
  // A cute skeleton facing right: tail, spine with vertebrae, ribs, legs and a big round skull.
  var BONES = 'M10 148C18 136 30 120 48 112C62 106 76 104 88 98C96 92 100 82 104 72';
  var RIBS = 'M64 107C62 118 64 128 70 133M72 105C70 116 72 126 78 131M80 102C79 112 81 121 86 126M88 98C88 107 90 115 94 119';
  var LEGS = 'M46 114L40 134L48 150L60 151M54 113L56 134L64 149L76 150M92 100L98 112L106 113';
  var SKULL = 'M98 70C94 60 98 46 110 42C122 38 138 40 144 50C148 57 146 64 138 67L118 74C108 77 101 76 98 70Z';
  var FOSSIL = '<svg viewBox="0 0 150 160" aria-hidden="true">'
    + '<path class="o-dnod-bo o-dnod-bov" d="' + BONES + '"/><path class="o-dnod-bo" d="' + RIBS + LEGS + '"/>'
    + '<path class="o-dnod-bb" d="' + RIBS + LEGS + '"/><path class="o-dnod-bb o-dnod-bbv" d="' + BONES + '"/>'
    + '<path class="o-dnod-bt" d="' + RIBS + LEGS + '"/><path class="o-dnod-bt o-dnod-btv" d="' + BONES + '"/>'
    + '<path class="o-dnod-skull" d="' + SKULL + '"/><path class="o-dnod-tint" d="' + SKULL + '"/>'
    + '<ellipse class="o-dnod-hole" cx="117" cy="53" rx="7" ry="7.5"/><ellipse class="o-dnod-hole" cx="139.5" cy="52" rx="1.6" ry="2"/>'
    + '<path class="o-dnod-jaw" d="M108 70L140 61"/><path class="o-dnod-teeth" d="M114 68.6L116 73L118.6 67.2ZM122 66.4L124 70.8L126.6 65ZM130 64.2L132 68.6L134.6 62.8Z"/></svg>';
  var BRUSH = '<svg viewBox="0 0 70 28" aria-hidden="true"><path class="o-dnod-handle" d="M2 11.5C2 9.5 3.5 9 6 9H38V19H6C3.5 19 2 18.5 2 16.5Z"/>'
    + '<path class="o-dnod-band" d="M37 7H45V21H37Z"/><path class="o-dnod-hair" d="M45 6L66 1.5C68 8 68 20 66 26.5L45 22Z"/><path class="o-dnod-hl2" d="M48 9L64 6M48 14H66M48 19L64 22"/></svg>';

  K.register({
    key: 'donation-dino', eventType: 'donation', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'dnoDonation', fx: 'none', anim: hold('1.4s'), exit: exit('dnoSinkOut', '0.42s'), len: 1.5,
    render: function (d) {
      var amt = money(d.amount, d.currency), msg = String(d.message || ''), px = fitPx(amt, 150, msg ? 30 : 34, 18);
      return '<div class="obj o-dno o-dnod"><div class="o-dno-sh">'
        + '<div class="o-dno-stone o-dnod-slab"><i class="o-dnod-strata"></i>'
        + '<div class="o-dnod-fossil">' + FOSSIL + '</div>'
        + '<div class="o-dnod-txt"><div class="o-dno-tag o-dnod-tag">' + label(d, 'Fossil find!') + '</div>'
        + '<div class="o-dnod-amt"><b style="font-size:' + px + 'px">' + odo(amt, 0.56, 0.75) + '</b></div>'
        + (msg ? '<div class="o-dnod-msg">“' + esc(msg) + '”</div>' : '')
        + '<div class="o-dnod-sign"><i class="o-dnod-stamp">' + PRINT + '</i><span class="o-dno-cap">from</span>' + nm('o-dno-name o-dnod-name', d.username, 13) + '</div></div>'
        + '<i class="o-dnod-sand o-dnod-sandt"></i><i class="o-dnod-sand o-dnod-sandb"></i></div>'
        + '<div class="o-dnod-brush"><div class="o-dnod-bri">' + BRUSH + '</div></div>'
        + puffs([[120, 48, 20, -10, -14, 0.5], [230, 40, 22, 4, -16, 0.62], [330, 52, 20, 12, -12, 0.74], [300, 150, 22, 10, 12, 1.0], [190, 160, 20, -4, 14, 1.12], [80, 150, 22, -12, 10, 1.24]])
        + '</div></div>';
    },
  });

  /* ── raid — Stampede ── */
  // A running dino facing right (56 × 46), legs mid-stride.
  var RUN_BODY = 'M1 15C6 22 12 25 17 25C19 17 26 12 34 13C36 6 41 2 47 3C53 4 56 9 55 14C54 19 50 21 45 21C44 26 41 32 34 35C26 38 18 37 14 33C8 30 3 23 1 15Z';
  function runner(back) {
    return '<svg viewBox="0 0 56 46" aria-hidden="true">'
      + skin('M22 13L25 6L29 12ZM29 11L33 4L36 11Z', 'dk')
      + '<path class="o-dno-leg" d="M21 31L15 41L10 42M30 31L36 40L42 40"/><path class="o-dno-legc" d="M21 31L15 41L10 42M30 31L36 40L42 40"/>'
      + (back ? '<path class="o-dno-legd" d="M21 31L15 41L10 42M30 31L36 40L42 40"/>' : '')
      + skin(RUN_BODY, back ? 'dk' : '')
      + '<path class="o-dno-lt" d="M18 30C22 34 30 34 35 31C38 29 41 25 42 21C40 27 34 31 27 32C23 32 20 31 18 30Z"/>'
      + eye(46, 9.5, 3.6, 1.2, 0.4)
      + '<path class="o-dno-ln" d="M45 16.5Q49.5 19 53.5 16"/><path class="o-dno-ln" d="M37 23L41 25"/></svg>';
  }
  var FAR = '<svg viewBox="0 0 56 46" aria-hidden="true"><path class="o-dnor-farp" d="M1 15C6 22 12 25 17 25C19 17 26 12 34 13C36 6 41 2 47 3C53 4 56 9 55 14C54 19 50 21 45 21C44 26 41 32 34 35L37 44L32 44L28 36C24 37 20 37 17 35L13 44L8 44L13 32C8 30 3 23 1 15Z"/></svg>';
  function herd(v) {
    var n = Math.min(v, 8), far = v > 8 ? Math.min(6, Math.round(Math.log10(v) * 2)) : 0;
    var last = n ? 0.3 + (n - 1) * 0.07 + 0.62 + 0.26 : 0.6;
    return { n: n, far: far, len: Math.max(1.4, last, far ? 1.0 + (far - 1) * 0.06 + 0.4 : 0) };
  }

  K.register({
    key: 'raid-dino', eventType: 'raid', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'dnoRaid', fx: 'smoke', anim: hold('1.4s'), exit: exit('dnoRunOut', '0.45s'),
    len: function (d) { return herd(intOf(K.sizeOf(d, 'raid'))).len; },
    render: function (d) {
      var v = intOf(d.viewers), q = herd(intOf(K.sizeOf(d, 'raid'))), n = q.n, sp = n > 1 ? Math.min(48, 330 / (n - 1)) : 0, dinos = '', far = '', dust = [], i;
      for (i = 0; i < n; i++) {
        var back = i % 2 === 1, w = back ? 44 : 56, cx = 214 + ((n - 1) / 2 - i) * sp, rd = 0.3 + i * 0.07;
        dinos += '<div class="o-dnor-dino' + (back ? ' o-dnor-back' : '') + '" style="left:' + Math.round(cx - w / 2) + 'px;--x:' + Math.round(cx + w / 2) + 'px;--rd:' + rd.toFixed(2) + 's"><div class="o-dnor-bob">' + runner(back) + '</div></div>';
        dust.push([Math.round(cx - w * 0.45), back ? 84 : 98, back ? 18 : 24, -14, -6, rd + 0.55]);
      }
      for (i = 0; i < q.far; i++) far += '<i class="o-dnor-far" style="left:' + (300 + i * 17) + 'px;top:' + (31 + (i % 2) * 2) + 'px;--fd:' + (1.0 + i * 0.06).toFixed(2) + 's">' + FAR + '</i>';
      return '<div class="obj o-dno o-dnor"><div class="o-dno-sh">'
        + '<div class="o-dnor-scene"><i class="o-dnor-volc"></i><i class="o-dnor-ridge"></i><i class="o-dnor-hills"></i>' + far + '<i class="o-dnor-ground"></i>'
        + '<i class="o-dnor-fern">' + fern(36, 30) + '</i>' + dinos + puffs(dust) + '</div>'
        + '<div class="o-dno-stone o-dnor-plate">' + nm('o-dno-name o-dnor-name', d.username + '’s herd', 20)
        + '<div class="o-dnor-line"><span class="o-dno-tag o-dnor-tag">' + label(d, 'Stampede!') + '</span>'
        + '<b class="o-dnor-num">' + odo(fmt(v), 0.45, 0.9) + '</b><span class="o-dnor-unit">' + (v === 1 ? 'dino' : 'dinos') + '</span></div></div>'
        + '</div></div>';
    },
  });

  /* ── giveaway — Amber ── */
  var TWIG = 'M-4 6C40 4 90 10 140 16C170 20 196 24 214 30';
  var BRANCH = '<svg viewBox="0 0 230 40" aria-hidden="true"><path class="o-dnog-twigo" d="' + TWIG + '"/><path class="o-dnog-twig" d="' + TWIG + '"/>'
    + '<path class="o-dno-fl" d="M40 6C36 -2 44 -6 50 -2C52 2 48 6 40 6ZM78 9C76 18 84 22 90 18C92 14 88 10 78 9ZM118 13C114 5 122 1 128 5C130 9 126 13 118 13ZM158 19C156 28 164 32 170 28C172 24 168 20 158 19ZM190 24C188 16 196 12 202 16C204 20 200 24 190 24Z"/></svg>';

  K.register({
    key: 'giveaway-dino', eventType: 'giveaway_winner', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'dnoGiveaway', fx: 'confetti', anim: hold('1.7s'), exit: exit('dnoAmberOut', '0.45s'), len: 1.8,
    render: function (d) {
      var r = rng(hash(d.username + 'amber')), bubbles = '';
      for (var i = 0; i < 5; i++) bubbles += '<i class="o-dnog-bub" style="left:' + (8 + r() * 84).toFixed(0) + '%;top:' + (14 + r() * 70).toFixed(0) + '%;--bs:' + (3 + r() * 5).toFixed(1) + 'px"></i>';
      return '<div class="obj o-dno o-dnog"><div class="o-dno-sh">'
        + '<i class="o-dnog-halo"></i>'
        + '<div class="o-dno-stone o-dnog-tab"><span class="o-dno-cap o-dnog-pl">' + (d.prize ? 'Prize' : 'Giveaway') + '</span>'
        + '<b class="o-dnog-prize">' + (d.prize ? esc(d.prize) : 'Well played!') + '</b></div>'
        + '<div class="o-dnog-branch">' + BRANCH + '</div>'
        + '<i class="o-dnog-drop"></i>'
        + '<div class="o-dnog-amber">' + bubbles + '<i class="o-dnog-gloss"></i><i class="o-dnog-sweep"></i>'
        + '<div class="o-dnog-cap">' + label(d, 'Giveaway winner') + '</div>' + nm('o-dno-name o-dnog-name', d.username, 14) + '</div>'
        + '</div></div>';
    },
  });

  Object.keys(SOUNDS).forEach(function (k) { K.registerSound(k, FAMILY, SOUNDS[k]); });
})(typeof window !== 'undefined' ? window : null);
