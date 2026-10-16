'use strict';

/**
 * Kawaii (docs/superpowers/specs/2026-10-15-alert-styles-design.md, Appendix A), ported from the proposal
 * (docs/superpowers/specs/assets/2026-10-15-alert-styles/parts/fam/kwi.js and .css).
 * Its names and descriptions are in the locale files (overlayBuilder.families.kawaii, overlayBuilder.looks.<id>,
 * overlayBuilder.sounds.<key>). Its classes start with .o-kwi and its keyframes with kwi.
 */
/* ═══ Kawaii — cute and pastel ═══
   Round friends with thick soft outlines, blush cheeks and little sparkles: a cat that waves, a bubble
   tea, bouncing mochi, a bunny with a card, a parade of friends and a gacha machine. Everything arrives
   with squash, stretch and a springy overshoot, then sits still. Everything private to this family lives
   inside this function, so its helper names cannot collide with another family's. */
(function (root) {
  var K = (root && root.ATLETA_KIT) || require('../kit.js');
  var FAMILY = 'kawaii';
  var esc = K.esc, money = K.money, nm = K.nm, fmt = K.fmt, label = K.label, odo = K.odo, typed = K.typed, hash = K.hash, rng = K.rng, intOf = K.intOf, tone = K.tone, noise = K.noise;
  var SOUNDS = {};
  function hold(dur) { return { in: 'hold', dur: dur, ease: 'linear' }; }
  // Every look takes the streamer's colour and its speed, and its main text when it shows one.
  var CONTROLS = { colour: 'accent', label: true, speed: true };
  var CONTROLS_NO_TEXT = { colour: 'accent', label: false, speed: true };
  K.registerFamily({ key: FAMILY, order: 15, fonts: ["Nunito:wght@700;800;900","Baloo+2:wght@600;700;800"] });


  /* ── Sounds: soft pops, boings and chimes ── */
  SOUNDS.kwiFollow = function () {
    tone({ f: 420, f2: 980, d: 0.1, v: 0.07 });
    noise({ ft: 'highpass', f: 2600, d: 0.04, v: 0.08 });
    tone({ f: 300, f2: 620, d: 0.16, v: 0.06, t: 0.3 });
    tone({ f: 760, f2: 1120, d: 0.12, v: 0.05, type: 'triangle', t: 0.95 });
    tone({ f: 1120, f2: 680, d: 0.22, v: 0.05, type: 'triangle', t: 1.07 });
    [1568, 1976, 2349].forEach(function (f, i) { tone({ f: f, d: 0.3, v: 0.035, t: 1.12 + i * 0.11 }); });
  };
  SOUNDS.kwiSub = function () {
    tone({ f: 260, f2: 520, d: 0.14, v: 0.06 });
    noise({ ft: 'lowpass', f: 500, f2: 1600, q: 0.8, d: 0.45, v: 0.12, a: 0.12, t: 0.45 });
    for (var i = 0; i < 4; i++) tone({ f: 760, f2: 260, d: 0.08, v: 0.07, t: 1.0 + i * 0.06 });
    noise({ ft: 'bandpass', f: 1800, q: 1.2, d: 0.05, v: 0.14, t: 1.44 });
    tone({ f: 500, f2: 1000, d: 0.12, v: 0.06, t: 1.45 });
    tone({ f: 1319, d: 0.25, v: 0.04, type: 'triangle', t: 1.58 });
    tone({ f: 1760, d: 0.35, v: 0.035, type: 'triangle', t: 1.66 });
  };
  SOUNDS.kwiBits = function () {
    for (var i = 0; i < 5; i++) {
      tone({ f: 300 + i * 45, f2: 620 + i * 90, d: 0.12, v: 0.06, t: 0.12 + i * 0.075 });
      tone({ f: 180, f2: 120, d: 0.07, v: 0.05, t: 0.54 + i * 0.075 });
    }
    tone({ f: 520, f2: 1040, d: 0.09, v: 0.05, t: 0.32 });
    [1760, 2093, 2637].forEach(function (f, i) { tone({ f: f, d: 0.25, v: 0.03, t: 1.0 + i * 0.08 }); });
  };
  SOUNDS.kwiDonation = function () {
    tone({ f: 380, f2: 760, d: 0.09, v: 0.05 });
    [0.2, 0.53].forEach(function (t) { tone({ f: 330, f2: 660, d: 0.12, v: 0.06, t: t }); });
    tone({ f: 620, f2: 1240, d: 0.1, v: 0.05, t: 0.47 });
    [0.52, 0.84].forEach(function (t) { noise({ ft: 'lowpass', f: 420, d: 0.07, v: 0.12, t: t }); });
    tone({ f: 784, d: 0.35, v: 0.05, type: 'triangle', t: 1.0 });
    tone({ f: 1047, d: 0.45, v: 0.045, type: 'triangle', t: 1.1 });
    tone({ f: 1319, d: 0.6, v: 0.04, type: 'triangle', t: 1.2 });
  };
  SOUNDS.kwiRaid = function () {
    tone({ f: 400, f2: 800, d: 0.09, v: 0.05 });
    for (var i = 0; i < 8; i++) tone({ f: i % 2 ? 1250 : 1050, f2: i % 2 ? 1450 : 1250, d: 0.05, v: 0.04, type: 'triangle', t: 0.6 + i * 0.1 });
    [523, 659, 784].forEach(function (f, i) { tone({ f: f, d: 0.14, v: 0.05, type: 'triangle', t: 1.4 + i * 0.1 }); });
    tone({ f: 1047, d: 0.4, v: 0.05, type: 'triangle', t: 1.7 });
  };
  SOUNDS.kwiGiveaway = function () {
    tone({ f: 300, f2: 600, d: 0.12, v: 0.05 });
    for (var i = 0; i < 5; i++) noise({ ft: 'bandpass', f: 3200, q: 5, d: 0.03, v: 0.2, t: 0.32 + i * 0.1 });
    noise({ ft: 'bandpass', f: 900, q: 0.8, d: 0.4, v: 0.08, t: 0.36 });
    tone({ f: 260, f2: 160, d: 0.1, v: 0.07, t: 0.8 });
    noise({ ft: 'lowpass', f: 600, d: 0.3, v: 0.1, t: 0.84 });
    noise({ ft: 'highpass', f: 3000, d: 0.05, v: 0.18, t: 1.12 });
    tone({ f: 420, f2: 1260, d: 0.12, v: 0.07, t: 1.12 });
    [1319, 1568, 2093, 2637].forEach(function (f, i) { tone({ f: f, d: 0.3, v: 0.04, type: 'triangle', t: 1.3 + i * 0.08 }); });
  };

  /* ── Exits: a jelly poof, a melt into the floor, a hop away ── */
  var KWI_EXIT = { out: 'kwiExit', dur: '0.42s', ease: 'ease-in' };
  var KWI_MELT = { out: 'kwiMelt', dur: '0.4s', ease: 'ease-in' };
  var KWI_HOP = { out: 'kwiHopOut', dur: '0.5s', ease: 'ease-in-out' };

  /* ── Drawing helpers (short SVG paths, no ids, so any number of tiles can show the same look) ── */
  function n1(x) { return String(Math.round(x * 10) / 10); }
  function oval(x, y, rx, ry) {
    var w = n1(2 * rx);
    return 'M' + n1(x - rx) + ' ' + n1(y) + 'a' + n1(rx) + ' ' + n1(ry) + ' 0 1 0 ' + w + ' 0a' + n1(rx) + ' ' + n1(ry) + ' 0 1 0 -' + w + ' 0Z';
  }
  function circ(x, y, r) { return oval(x, y, r, r); }
  // One face for every friend: dot eyes with a glint (or happy ^ ^ eyes), blush, and a mouth.
  // (cx, cy) is the point between the eyes; k scales it (at 1 the eyes are 15 units apart).
  function face(cx, cy, k, eyes, mouth) {
    var ex = 7.5 * k, er = 2.4 * k, sw = n1(Math.max(1.3, 1.8 * k)), my = cy + 2.6 * k, out = '';
    if (eyes === 'happy') {
      var arc = function (x) { return 'M' + n1(x - er * 1.1) + ' ' + n1(cy + er * 0.5) + 'q' + n1(er * 1.1) + ' ' + n1(-er * 2) + ' ' + n1(er * 2.2) + ' 0'; };
      out += '<path class="o-kwi-ln" stroke-width="' + sw + '" d="' + arc(cx - ex) + arc(cx + ex) + '"/>';
    } else {
      out += '<path class="o-kwi-eye" d="' + circ(cx - ex, cy, er) + circ(cx + ex, cy, er) + '"/>'
        + '<path class="o-kwi-glint" d="' + circ(cx - ex + er * 0.38, cy - er * 0.4, er * 0.4) + circ(cx + ex + er * 0.38, cy - er * 0.4, er * 0.4) + '"/>';
    }
    out += '<path class="o-kwi-cheek" d="' + oval(cx - ex - 3 * k, cy + 3.8 * k, 3.3 * k, 2 * k) + oval(cx + ex + 3 * k, cy + 3.8 * k, 3.3 * k, 2 * k) + '"/>';
    if (mouth === 'w') {
      out += '<path class="o-kwi-ln" stroke-width="' + sw + '" d="M' + n1(cx - 3.4 * k) + ' ' + n1(my) + 'q' + n1(1.7 * k) + ' ' + n1(2.2 * k) + ' ' + n1(3.4 * k) + ' 0q' + n1(1.7 * k) + ' ' + n1(2.2 * k) + ' ' + n1(3.4 * k) + ' 0"/>';
    } else if (mouth === 'open') {
      out += '<path class="o-kwi-eye" d="' + oval(cx, my + 1.2 * k, 1.8 * k, 2.1 * k) + '"/>';
    } else if (mouth === 'bunny') {
      out += '<path class="o-kwi-nose" d="' + oval(cx, cy + 1.6 * k, 1.8 * k, 1.25 * k) + '"/>'
        + '<path class="o-kwi-ln" stroke-width="' + sw + '" d="M' + n1(cx) + ' ' + n1(cy + 2.4 * k) + 'v' + n1(1.2 * k)
        + 'M' + n1(cx - 2.6 * k) + ' ' + n1(cy + 3.2 * k) + 'q' + n1(1.3 * k) + ' ' + n1(1.6 * k) + ' ' + n1(2.6 * k) + ' ' + n1(0.4 * k)
        + 'q' + n1(1.3 * k) + ' ' + n1(1.2 * k) + ' ' + n1(2.6 * k) + ' ' + n1(-0.4 * k) + '"/>';
    } else {
      out += '<path class="o-kwi-ln" stroke-width="' + sw + '" d="M' + n1(cx - 2.5 * k) + ' ' + n1(my) + 'q' + n1(2.5 * k) + ' ' + n1(2.8 * k) + ' ' + n1(5 * k) + ' 0"/>';
    }
    return out;
  }
  var MOODS = [['dot', 'smile'], ['happy', 'open'], ['dot', 'w'], ['happy', 'smile'], ['dot', 'open'], ['happy', 'w']];
  var HEART = '<svg viewBox="0 0 24 23" aria-hidden="true"><path class="o-kwi-hrt" d="M12 21.2C5 16.6 1.6 12.8 1.6 8.2 1.6 4.9 4.1 2.5 7.2 2.5c2.1 0 3.8 1.1 4.8 2.7 1-1.6 2.7-2.7 4.8-2.7 3.1 0 5.6 2.4 5.6 5.7 0 4.6-3.4 8.4-10.4 13Z"/>'
    + '<path class="o-kwi-shine" d="M5.6 8.4c.2-1.7 1.3-2.8 2.9-3"/></svg>';
  var SPARK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path class="o-kwi-spkp" d="M10 .8C10.8 6.3 13.7 9.2 19.2 10 13.7 10.8 10.8 13.7 10 19.2 9.2 13.7 6.3 10.8 .8 10 6.3 9.2 9.2 6.3 10 .8Z"/></svg>';
  // A four-point sparkle that twinkles in at `delay` and then stays.
  function spark(x, y, size, rot, colour, delay) {
    return '<i class="o-kwi-ico o-kwi-spk" style="left:' + x + 'px;top:' + y + 'px;--ss:' + size + 'px;--sr:' + rot + 'deg;--sc:' + colour + ';--sd:' + delay.toFixed(2) + 's">' + SPARK + '</i>';
  }
  // A seeded shuffle (render must not use Math.random).
  function shuffled(count, r) {
    var a = [], i, j, t;
    for (i = 0; i < count; i++) a.push(i);
    for (i = count - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* ── follow — Paw wave ── */
  var CAT = '<svg viewBox="0 0 92 96" aria-hidden="true">'
    + '<path class="o-kwi-skin" stroke-width="3.5" d="M11 46L15 10Q16 4 22 7L43 27ZM81 46L77 10Q76 4 70 7L49 27Z"/>'
    + '<path class="o-kwi-bean" d="M18 34L20 16L33 27ZM74 34L72 16L59 27Z"/>'
    + '<ellipse class="o-kwi-skin" stroke-width="3.5" cx="46" cy="59" rx="40" ry="33"/>'
    + face(46, 58, 1.6, 'dot', 'w')
    + '<path class="o-kwi-bow" stroke-width="2.4" d="M68 28L58 21.5V34.5ZM68 28L78 21.5V34.5Z"/><circle class="o-kwi-bow" stroke-width="2.4" cx="68" cy="28" r="3.6"/></svg>';
  var PAW = '<svg viewBox="0 0 30 58" aria-hidden="true"><path class="o-kwi-skin" stroke-width="3" d="M4 60V18a11 11 0 0 1 22 0V60"/>'
    + '<path class="o-kwi-bean" d="' + oval(15, 21.5, 5.2, 4.2) + circ(8.6, 13.4, 2.3) + circ(15, 10.6, 2.4) + circ(21.4, 13.4, 2.3) + '"/></svg>';

  K.register({
    key: 'follow-kawaii', eventType: 'follow', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'kwiFollow', fx: 'none', anim: hold('1.8s'), exit: KWI_EXIT, len: 1.9,
    render: function (d) {
      // The hearts start at the cat's head (about x 76, y 64 in the alert) and float up to their spot.
      var spots = [[30, 6, 17, -14], [62, 0, 21, 6], [96, 10, 15, 16]], hearts = '';
      spots.forEach(function (h, i) {
        hearts += '<i class="o-kwi-ico o-kwif-heart" style="left:' + h[0] + 'px;top:' + h[1] + 'px;width:' + h[2] + 'px;height:' + h[2] + 'px;--sr:' + h[3]
          + 'deg;--hx:' + n1(76 - h[0] - h[2] / 2) + 'px;--hy:' + n1(64 - h[1] - h[2] / 2) + 'px;--hd:' + (1.08 + i * 0.11).toFixed(2) + 's">' + HEART + '</i>';
      });
      return '<div class="obj o-kwi o-kwif"><div class="o-kwi-plate o-kwif-bub"><i class="o-kwif-disc"></i>'
        + '<div class="o-kwif-cat">' + CAT + '</div><div class="o-kwif-paw">' + PAW + '</div>'
        + '<div class="o-kwif-txt"><div class="o-kwi-tag o-kwif-tag">' + label(d, 'New friend!') + '</div>'
        + nm('o-kwif-name', d.username, 13)
        + '<div class="o-kwif-did">followed!<i class="o-kwi-ico o-kwif-mini">' + HEART + '</i></div></div></div>'
        + hearts + '</div>';
    },
  });

  /* ── subscriber — Boba ── */
  // The text lands first; then the tea fills, one pearl per month (up to twelve) drops in, the straw, the tier sticker.
  function bobaTimes(months) {
    var n = Math.min(12, Math.max(1, months)), step = Math.min(0.06, 0.38 / n), straw = 0.78 + (n - 1) * step + 0.33;
    return { n: n, step: step, straw: straw, tier: straw + 0.25, len: straw + 0.62 };
  }
  var TIER_COLOURS = { '1': 'var(--kwi-mint)', '2': 'var(--kwi-lilac)', '3': 'var(--kwi-butter)' };

  K.register({
    key: 'subscriber-kawaii', eventType: 'subscription', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'kwiSub', fx: 'none', anim: hold('1.7s'), exit: KWI_EXIT,
    len: function (d) { return bobaTimes(Math.max(1, intOf(K.sizeOf(d, 'months')))).len; },
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), size = Math.max(1, intOf(K.sizeOf(d, 'months'))), T = bobaTimes(size), r = rng(hash(d.username + size)), pearls = '';
      for (var i = 0; i < T.n; i++) {
        var row = Math.floor(i / 4), col = i % 4, inRow = Math.min(4, T.n - row * 4);
        var x = 25 + (col + (4 - inRow) / 2) * 15 + (row % 2 ? 4 : 0) + (r() * 3 - 1.5), y = 7 + row * 11 + (r() * 2 - 1);
        pearls += '<i class="o-kwis-pearl" style="left:' + n1(x) + 'px;bottom:' + n1(y) + 'px;--pd:' + (0.78 + i * T.step).toFixed(3) + 's"></i>';
      }
      var tier = String(d.tier || '1');
      return '<div class="obj o-kwi o-kwis"><div class="o-kwis-cup"><i class="o-kwis-straw" style="--sd:' + T.straw.toFixed(2) + 's"></i>'
        + '<div class="o-kwis-in"><i class="o-kwis-tea"></i>' + pearls + '</div>'
        + '<svg class="o-kwis-line" viewBox="0 0 112 120" aria-hidden="true"><path class="o-kwis-shine" d="M17 16L23 90"/>'
        + '<path class="o-kwi-ln" stroke-width="3.5" d="M5 4H107L97 110Q96 117 88 117H24Q16 117 15 110Z"/><path class="o-kwi-ln" stroke-width="5" d="M2 4H110"/>'
        + face(56, 52, 1.3, 'dot', 'smile') + '</svg></div>'
        + '<div class="o-kwi-plate o-kwis-plate"><div class="o-kwi-tag o-kwis-tag">' + label(d, months > 1 ? 'Resubscribed!' : 'New subscriber!') + '</div>'
        + nm('o-kwis-name', d.username, 13)
        + '<div class="o-kwis-mo"><span class="o-kwi-pill">' + odo(String(months), 0.6, 0.7) + '</span><span class="o-kwis-mot">' + (months === 1 ? 'month!' : 'months!') + '</span></div></div>'
        + '<div class="o-kwis-tier" style="--tc:' + (TIER_COLOURS[tier] || TIER_COLOURS['1']) + ';--td:' + T.tier.toFixed(2) + 's"><span class="o-kwis-tl">Tier</span><b class="o-kwis-tn">' + esc(tier) + '</b></div>'
        + spark(102, 2, 15, 0, 'var(--kwi-butter)', T.straw + 0.1) + spark(124, 22, 10, 20, 'var(--kwi-mint)', T.straw + 0.17)
        + '</div>';
    },
  });

  /* ── bits — Mochi ── */
  // 50 bits → 3 mochi, 500 → 5, 10,000 → 8 (never fewer than 2 or more than 9).
  function mochiCount(n) { return Math.max(2, Math.min(9, Math.round(Math.log10(n + 1) * 2 - 0.5))); }
  function mochiLen(count) { return Math.max(1.52, 0.1 + (count - 1) * 0.075 + 0.77); }
  var MOCHI_COLOURS = ['#FFFFFF', 'var(--kwia)', 'var(--a-tint,var(--kwi-mint))', 'var(--a-soft,var(--kwi-lilac))', 'var(--a-hi,var(--kwi-butter))', 'var(--a-tint,#FFD3E6)'];

  K.register({
    key: 'bits-kawaii', eventType: 'bits', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'kwiBits', fx: 'none', anim: hold('1.4s'), exit: KWI_MELT,
    len: function (d) { return mochiLen(mochiCount(intOf(K.sizeOf(d, 'bits')))); },
    render: function (d) {
      var n = intOf(d.amount != null ? d.amount : d.bits), size = intOf(K.sizeOf(d, 'bits')), count = mochiCount(size), r = rng(hash(d.username + size));
      var sp = Math.min(56, 330 / Math.max(1, count - 1)), order = shuffled(count, r), first = Math.floor(r() * MOCHI_COLOURS.length), mochi = '';
      for (var i = 0; i < count; i++) {
        var w = 48 + Math.round(r() * 14), h = Math.round(w * 0.8), cx = 210 + (i - (count - 1) / 2) * sp;
        var fw = Math.round(w * 0.7), mood = MOODS[(i + first) % MOODS.length];
        mochi += '<i class="o-kwib-mochi" style="left:' + n1(cx - w / 2) + 'px;width:' + w + 'px;height:' + h + 'px;z-index:' + (10 - Math.round(Math.abs(i - (count - 1) / 2)))
          + ';--mc:' + MOCHI_COLOURS[(i + first) % MOCHI_COLOURS.length] + ';--md:' + (0.1 + order[i] * 0.075).toFixed(3) + 's">'
          + '<svg class="o-kwib-face" viewBox="0 0 40 20" style="width:' + fw + 'px;height:' + Math.round(fw / 2) + 'px;margin-left:-' + Math.round(fw / 2) + 'px" aria-hidden="true">'
          + face(20, 7, 1, mood[0], mood[1]) + '</svg></i>';
      }
      var lvl = size >= 1000 ? 3 : size >= 100 ? 2 : 1;
      var sparks = [[38, 20, 16, -10, 'var(--kwi-butter)', 0.9], [368, 6, 18, 12, 'var(--kwi-mint)', 0.98], [374, 70, 12, 30, 'var(--kwi-butter)', 1.06]].slice(0, lvl)
        .map(function (s) { return spark(s[0], s[1], s[2], s[3], s[4], s[5]); }).join('');
      return '<div class="obj o-kwi o-kwib">' + mochi
        + '<div class="o-kwi-plate o-kwib-bub"><div class="o-kwib-tagrow"><div class="o-kwi-tag o-kwib-tag">' + label(d, 'Cheer!') + '</div></div>'
        + '<div class="o-kwib-amt"><span class="o-kwib-plus">+</span>' + odo(fmt(n), 0.5, 0.85) + '<span class="o-kwib-unit">bits</span></div>'
        + '<div class="o-kwib-from"><span class="o-kwib-fr">from</span>' + nm('o-kwib-name', d.username, 16) + '</div></div>'
        + sparks + '</div>';
    },
  });

  /* ── donation — Bunny card ── */
  var BUNNY = '<svg viewBox="0 0 84 90" aria-hidden="true">'
    + '<ellipse class="o-kwi-skin" stroke-width="3.5" cx="27" cy="28" rx="10" ry="25" transform="rotate(-10 27 28)"/><ellipse class="o-kwi-bean" cx="27" cy="30" rx="4.6" ry="16.5" transform="rotate(-10 27 30)"/>'
    + '<g class="o-kwid-ear"><ellipse class="o-kwi-skin" stroke-width="3.5" cx="57" cy="27" rx="10" ry="25" transform="rotate(12 57 27)"/><ellipse class="o-kwi-bean" cx="57" cy="29" rx="4.6" ry="16.5" transform="rotate(12 57 29)"/></g>'
    + '<ellipse class="o-kwi-skin" stroke-width="3.5" cx="42" cy="62" rx="35" ry="27"/>' + face(42, 57, 1.25, 'dot', 'bunny') + '</svg>';
  var BIG_HEART = '<svg viewBox="0 0 100 92" aria-hidden="true"><path class="o-kwid-hrt" d="M50 86C20.5 66 5 49.5 5 30 5 15.5 16 5 30 5c8.6 0 15.6 4.6 20 11.7C54.4 9.6 61.4 5 70 5c14 0 25 10.5 25 25 0 19.5-15.5 36-45 56Z"/>'
    + '<path class="o-kwid-hs" d="M17 27c.8-6.5 5.2-10.6 11.4-11.4"/></svg>';
  // The message is written once the bunny has landed (from 1.05s), in at most 0.9s.
  function donationTiming(message) {
    var count = Array.from(message || '').length, per = count ? Math.min(0.03, 0.9 / count) : 0;
    return { per: per, len: count ? Math.max(1.75, 1.05 + count * per + 0.1) : 1.75 };
  }

  K.register({
    key: 'donation-kawaii', eventType: 'donation', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'kwiDonation', fx: 'none', anim: hold('1.6s'), exit: KWI_HOP,
    len: function (d) { return donationTiming(d.message).len; },
    render: function (d) {
      var amt = money(d.amount, d.currency), t = typed(d.message || '', 1.05, donationTiming(d.message).per, 140);
      var al = Array.from(amt).length, fs = al <= 6 ? 21 : al === 7 ? 19 : al === 8 ? 17 : 15;
      var card = t.n
        ? '<div class="o-kwid-msg o-typed" style="' + t.style + '">' + t.html + '</div><div class="o-kwid-sign"><span class="o-kwid-fr">from</span>' + nm('o-kwid-name', d.username, 21) + '</div>'
        : '<div class="o-kwid-sign">' + nm('o-kwid-name', d.username, 19) + '</div><div class="o-kwid-sent">sent a tip!</div>';
      return '<div class="obj o-kwi o-kwid"><div class="o-kwid-bunny">' + BUNNY + '</div>'
        + '<div class="o-kwi-plate o-kwid-card' + (t.n ? '' : ' o-kwid-solo') + '">' + card + '</div>'
        + '<i class="o-kwid-paw o-kwid-pawl"></i><i class="o-kwid-paw o-kwid-pawr"></i>'
        + '<div class="o-kwid-say"><span class="o-kwid-sayt">' + label(d, 'Thank you!') + '</span></div>'
        + '<div class="o-kwid-heart"><i class="o-kwi-ico o-kwid-hicon">' + BIG_HEART + '</i><b class="o-kwid-amt" style="font-size:' + fs + 'px">' + esc(amt) + '</b></div>'
        + spark(294, 8, 15, 0, 'var(--kwi-butter)', 1.15) + spark(100, 2, 12, 18, 'var(--kwi-mint)', 1.25)
        + '</div>';
    },
  });

  /* ── raid — Friend parade ── */
  var FRIEND_SKINS = ['#FFFFFF', 'var(--a-tint,#FFE9A6)', 'var(--a-soft,#E2D4FF)', 'var(--a-hi,#C6F6E6)', 'var(--a-tint,#FFD6E8)', 'var(--a-soft,#FFE1CC)'];
  // A little chibi friend (viewBox 40 × 48): cat, bunny, bear, a bow, a sprout or a curl, then the face.
  function friend(kind, mood) {
    var before = '', after = '';
    if (kind === 0) before = '<path class="o-kwi-skin" stroke-width="2.4" d="M6.5 26L8.2 8.6Q8.8 5.4 11.6 7.1L19 14.5ZM33.5 26L31.8 8.6Q31.2 5.4 28.4 7.1L21 14.5Z"/><path class="o-kwi-bean" d="M10.5 20L11.3 11.5L16.5 15.5ZM29.5 20L28.7 11.5L23.5 15.5Z"/>';
    else if (kind === 1) before = '<ellipse class="o-kwi-skin" stroke-width="2.4" cx="14" cy="11" rx="4.4" ry="10.5" transform="rotate(-12 14 11)"/><ellipse class="o-kwi-skin" stroke-width="2.4" cx="26" cy="11" rx="4.4" ry="10.5" transform="rotate(12 26 11)"/>'
      + '<ellipse class="o-kwi-bean" cx="14" cy="12" rx="1.9" ry="7" transform="rotate(-12 14 12)"/><ellipse class="o-kwi-bean" cx="26" cy="12" rx="1.9" ry="7" transform="rotate(12 26 12)"/>';
    else if (kind === 2) before = '<path class="o-kwi-skin" stroke-width="2.4" d="' + circ(8.5, 18, 6) + circ(31.5, 18, 6) + '"/><path class="o-kwi-bean" d="' + circ(8.5, 18, 2.7) + circ(31.5, 18, 2.7) + '"/>';
    else if (kind === 3) after = '<path class="o-kwi-bow" stroke-width="2" d="M27 15.5L20.5 11V20ZM27 15.5L33.5 11V20Z"/><circle class="o-kwi-bow" stroke-width="2" cx="27" cy="15.5" r="2.5"/>';
    else if (kind === 4) before = '<path class="o-kwi-ln" stroke-width="2.2" d="M20 16.5V8"/><path class="o-kwi-leaf" stroke-width="2" d="M20 9.5C15 10 12 7 12.5 4 16.5 3.5 19.5 5.5 20 9.5ZM20 9.5C25 10 28 7 27.5 4 23.5 3.5 20.5 5.5 20 9.5Z"/>';
    else after = '<path class="o-kwi-ln" stroke-width="2.2" d="M18.5 16.5C17 11.5 21.5 8.5 24.5 11 26.5 13 24 16 22 14"/>';
    return '<svg class="o-kwir-face" viewBox="0 0 40 48" aria-hidden="true">' + before + '<circle class="o-kwi-skin" stroke-width="2.4" cx="20" cy="31" r="15.5"/>' + after + face(20, 31, 0.82, mood[0], mood[1]) + '</svg>';
  }
  // Where each friend stops and when: the leader (rightmost) sets off first, everyone hops along at the same
  // speed from just left of the alert, and each one lands with a squash at its own spot.
  function parade(v) {
    var n = Math.min(v, 12), more = v > n, wide = more ? 300 : 368, sp = n ? Math.min(54, wide / n) : 0;
    var fs = Math.min(40, Math.max(30, sp * 1.3)), x0 = more ? 24 : 210 - sp * n / 2, items = [], last = 0;
    for (var i = 0; i < n; i++) {
      var cx = x0 + sp * (i + 0.5), dist = cx + 24, dur = Math.max(0.2, dist / 560), hops = Math.max(1, Math.round(dur / 0.19));
      var dep = 0.55 + (n - 1 - i) * 0.075;
      items.push({ cx: cx, dist: dist, dur: dur, hops: hops, dep: dep, arr: dep + dur });
      last = Math.max(last, dep + dur);
    }
    return { n: n, more: more, fs: fs, items: items, last: last, len: Math.max(1.45, last + 0.36) };
  }

  K.register({
    key: 'raid-kawaii', eventType: 'raid', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'kwiRaid', fx: 'none', anim: hold('1.6s'), exit: KWI_HOP,
    len: function (d) { return parade(intOf(K.sizeOf(d, 'raid'))).len; },
    render: function (d) {
      var v = intOf(d.viewers), size = intOf(K.sizeOf(d, 'raid')), plan = parade(size), r = rng(hash(d.username + size)), k0 = Math.floor(r() * 6), s0 = Math.floor(r() * 6), crowd = '';
      plan.items.forEach(function (it, i) {
        crowd += '<i class="o-kwir-f" style="left:' + n1(it.cx - plan.fs / 2) + 'px;bottom:' + (i % 2 ? 9 : 5) + 'px;width:' + n1(plan.fs) + 'px;height:' + n1(plan.fs * 1.2)
          + 'px;--sk:' + FRIEND_SKINS[(i * 5 + s0) % 6] + ';--px:' + n1(-it.dist) + 'px;--pd:' + it.dep.toFixed(3) + 's;--pdu:' + it.dur.toFixed(3) + 's;--hn:' + it.hops
          + ';--hp:' + (it.dur / it.hops).toFixed(3) + 's;--pa:' + it.arr.toFixed(3) + 's">' + friend((i + k0) % 6, MOODS[(i + s0) % MOODS.length]) + '</i>';
      });
      // The tag counts the raiders left out of the parade; with "grows with the amount" off, the middle parade can hold them all.
      if (plan.more && v > plan.n) crowd += '<b class="o-kwi-tag o-kwir-more" style="--md:' + (plan.last - 0.04).toFixed(2) + 's">+' + fmt(v - plan.n) + '</b>';
      return '<div class="obj o-kwi o-kwir"><div class="o-kwi-plate o-kwir-plate"><div class="o-kwi-tag o-kwir-tag">' + label(d, 'Raid party!') + '</div>'
        + nm('o-kwir-name', d.username, 17)
        + '<div class="o-kwir-cnt"><span class="o-kwir-plus">+</span><span class="o-kwi-pill">' + odo(fmt(v), 0.45, 0.75) + '</span><span class="o-kwir-fr">' + (v === 1 ? 'friend' : 'friends') + '</span></div></div>'
        + '<div class="o-kwir-row">' + crowd + '</div>'
        + spark(16, 0, 16, -10, 'var(--kwi-butter)', 0.62) + spark(390, 4, 14, 14, 'var(--kwi-mint)', 0.7)
        + '</div>';
    },
  });

  /* ── giveaway — Gacha ── */
  // Capsules piled in the dome (centres, in the dome's 109px circle), back row first.
  var DOME_BALLS = [[33, 40], [70, 40], [19, 62], [43, 62], [67, 62], [91, 62], [30, 84], [54.5, 84], [79, 84]];
  var BALL_COLOURS = ['var(--kwia)', 'var(--kwi-mint)', 'var(--kwi-lilac)', 'var(--kwi-butter)', '#FFC4DD'];

  K.register({
    key: 'giveaway-kawaii', eventType: 'giveaway_winner', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'kwiGiveaway', fx: 'confetti', anim: hold('1.9s'), exit: KWI_EXIT, len: 2.0,
    render: function (d) {
      var r = rng(hash(d.username + 'gacha')), balls = '';
      DOME_BALLS.forEach(function (b, i) {
        balls += '<i class="o-kwig-ball" style="left:' + (b[0] - 13) + 'px;top:' + (b[1] - 13) + 'px;--bc:' + BALL_COLOURS[i % BALL_COLOURS.length] + ';--bra:' + Math.round(r() * 360) + 'deg"></i>';
      });
      return '<div class="obj o-kwi o-kwig"><div class="o-kwig-mach"><div class="o-kwig-dome"><div class="o-kwig-balls">' + balls + '</div></div>'
        + '<div class="o-kwig-body"><div class="o-kwig-panel"><svg viewBox="0 0 60 17" aria-hidden="true">' + face(30, 7, 0.95, 'happy', 'smile') + '</svg></div>'
        + '<i class="o-kwig-knob"></i><i class="o-kwig-chute"></i></div></div>'
        + '<div class="o-kwi-plate o-kwig-plate"><div class="o-kwi-tag o-kwig-tag">' + label(d, 'Giveaway winner!') + '</div>' + nm('o-kwig-name', d.username, 12) + '</div>'
        + (d.prize ? '<div class="o-kwig-prize"><span class="o-kwig-pt">Prize: ' + esc(d.prize) + '</span></div>' : '')
        + '<i class="o-kwig-ring"></i><div class="o-kwig-cap"><i class="o-kwig-capb"></i><i class="o-kwig-capt"></i></div>'
        + spark(160, 4, 17, 0, 'var(--kwi-butter)', 1.18) + spark(394, 2, 15, 15, 'var(--kwi-mint)', 1.24) + spark(404, 112, 12, -10, 'var(--kwi-butter)', 1.3)
        + '</div>';
    },
  });

  Object.keys(SOUNDS).forEach(function (k) { K.registerSound(k, FAMILY, SOUNDS[k]); });
})(typeof window !== 'undefined' ? window : null);
