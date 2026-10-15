'use strict';

/**
 * Western (docs/superpowers/specs/2026-10-15-alert-styles-design.md, Appendix A), ported from the proposal
 * (docs/superpowers/specs/assets/2026-10-15-alert-styles/parts/fam/wst.js and .css).
 * Its names and descriptions are in the locale files (overlayBuilder.families.western, overlayBuilder.looks.<id>,
 * overlayBuilder.sounds.<key>). Its classes start with .o-wst and its keyframes with wst.
 */
/* ═══ Western — the wild west: weathered paper, leather, wood and sheriff gold ═══
   Weighty motion: a poster slaps onto a wall and is nailed up, a badge spins in and pins on, nuggets
   tumble into a pan, a telegram feeds out and is stamped, a posse rides in through the dust and saloon
   doors burst open. Rye on the posters, Special Elite where a machine typed it. Everything private to
   this family lives inside this function, so its helper names cannot collide with another family's. */
(function (root) {
  var K = (root && root.ATLETA_KIT) || require('../kit.js');
  var FAMILY = 'western';
  var esc = K.esc, money = K.money, fitStyle = K.fitStyle, nm = K.nm, fmt = K.fmt, label = K.label, odo = K.odo, typed = K.typed, hash = K.hash, rng = K.rng, intOf = K.intOf, tone = K.tone, noise = K.noise;
  var SOUNDS = {};
  function hold(dur) { return { in: 'hold', dur: dur, ease: 'linear' }; }
  // Every look takes the streamer's colour and its speed, and its main text when it shows one.
  var CONTROLS = { colour: 'accent', label: true, speed: true };
  var CONTROLS_NO_TEXT = { colour: 'accent', label: false, speed: true };
  K.registerFamily({ key: FAMILY, order: 12, fonts: ["Rye","Special+Elite"] });


  /* ── Sounds, timed to the animations ── */
  SOUNDS.wstFollow = function () {
    noise({ ft: 'lowpass', f: 900, f2: 220, d: 0.16, v: 0.22, t: 0.26 });          // the poster slaps the wall
    noise({ ft: 'bandpass', f: 1600, q: 0.8, d: 0.07, v: 0.1, t: 0.26 });
    [0.47, 0.97].forEach(function (t) {                                              // two nails, one blow each
      noise({ ft: 'lowpass', f: 380, d: 0.09, v: 0.24, t: t });
      noise({ ft: 'bandpass', f: 2600, q: 4, d: 0.05, v: 0.18, t: t });
      tone({ f: 1850, f2: 1650, d: 0.12, v: 0.05, type: 'triangle', t: t });
    });
  };
  SOUNDS.wstSub = function () {
    noise({ ft: 'bandpass', f: 500, f2: 2600, q: 1.2, d: 0.42, v: 0.14, a: 0.12, t: 0.18 });   // the badge spins in
    noise({ ft: 'lowpass', f: 420, d: 0.1, v: 0.22, t: 0.64 });                                  // it pins on
    tone({ f: 2637, d: 0.4, v: 0.06, t: 0.64 });
    tone({ f: 3951, d: 0.28, v: 0.03, t: 0.65 });
    tone({ f: 3136, d: 0.5, v: 0.035, t: 1.12 });                                                // the shine
    tone({ f: 4186, d: 0.45, v: 0.02, t: 1.2 });
  };
  SOUNDS.wstBits = function () {
    [0.48, 0.55, 0.62, 0.68, 0.75, 0.81, 0.88, 0.95].forEach(function (t, i) {          // nuggets land in the pan
      tone({ f: 2300 + (i % 4) * 310, d: 0.05, v: 0.045, type: 'triangle', t: t });
      noise({ ft: 'bandpass', f: 3200, q: 5, d: 0.03, v: 0.1, t: t });
    });
    noise({ ft: 'bandpass', f: 2400, q: 1.5, d: 0.4, v: 0.1, a: 0.08, t: 1.08 });          // the pan shakes
    tone({ f: 2794, d: 0.55, v: 0.04, t: 1.3 });                                              // a glint
    tone({ f: 4186, d: 0.4, v: 0.02, t: 1.36 });
  };
  SOUNDS.wstDonation = function () {
    noise({ ft: 'bandpass', f: 1300, q: 0.9, d: 0.4, v: 0.08, a: 0.05, t: 0.14 });   // the slip feeds out
    var t = 0.62;                                                                      // the key taps as it types
    [0.05, 0.05, 0.05, 0.14, 0.14, 0.05, 0.14, 0.05].forEach(function (d) { tone({ f: 760, d: d, v: 0.04, type: 'square', t: t }); t += d + 0.07; });
    noise({ ft: 'lowpass', f: 520, d: 0.12, v: 0.26, t: 1.72 });                       // PAID is stamped
    tone({ f: 130, f2: 70, d: 0.14, v: 0.08, t: 1.72 });
  };
  SOUNDS.wstRaid = function () {
    for (var i = 0; i < 6; i++) {
      var base = 0.3 + i * 0.2, v = i < 3 ? 0.12 + i * 0.05 : 0.27 - (i - 3) * 0.06;
      [0, 0.055, 0.11].forEach(function (o) { noise({ ft: 'lowpass', f: 300, d: 0.06, v: v, t: base + o }); });
    }
    [392, 494, 587].forEach(function (f) { tone({ f: f, d: 0.5, v: 0.03, type: 'sawtooth', a: 0.04, t: 1.5 }); });
  };
  SOUNDS.wstGiveaway = function () {
    [0.18, 0.32].forEach(function (t) { noise({ ft: 'bandpass', f: 700, q: 3, d: 0.06, v: 0.12, t: t }); });   // the doors rattle
    noise({ ft: 'lowpass', f: 700, f2: 160, d: 0.26, v: 0.26, t: 0.4 });                                       // bang
    noise({ ft: 'bandpass', f: 1400, f2: 500, q: 7, d: 0.42, v: 0.07, t: 0.42 });                               // creak
    [523, 659, 784, 1047].forEach(function (f, i) {                                                             // an out-of-tune piano
      tone({ f: f, d: 0.32, v: 0.05, type: 'triangle', t: 0.7 + i * 0.09 });
      tone({ f: f * 1.009, d: 0.32, v: 0.03, type: 'triangle', t: 0.7 + i * 0.09 });
    });
    [523, 659, 784].forEach(function (f) { tone({ f: f, d: 0.9, v: 0.035, type: 'triangle', t: 1.1 }); });
  };

  /* ── Shared pieces ── */
  function exit(name, dur) { return { out: name, dur: dur, ease: 'cubic-bezier(.5,0,.85,.35)' }; }
  // Dust puffs, each [x, y, size, dx, dy, delay] in px and seconds, placed in their parent. They puff once.
  function dust(list) {
    return list.map(function (p) {
      return '<i class="o-wst-puff" style="left:' + p[0] + 'px;top:' + p[1] + 'px;--ps:' + p[2] + 'px;--dx:' + p[3] + 'px;--dy:' + p[4] + 'px;--pd:' + p[5].toFixed(2) + 's"></i>';
    }).join('');
  }
  // Four-point glints, each [left, top, size, delay]: they twinkle once and stay as a small sparkle.
  function glints(list) {
    return list.map(function (g) { return '<i class="o-wst-glint" style="left:' + g[0] + ';top:' + g[1] + ';--gs:' + g[2] + 'px;--gd:' + g[3].toFixed(2) + 's"></i>'; }).join('');
  }
  function tierOf(d) {
    var t = String(d.tier || '1');
    if (/^[123]000$/.test(t)) t = t.charAt(0);
    return TIERS[t] ? t : '1';
  }

  // The outlaw on the wanted poster: a hat, a bandana and two eyes.
  var FIGURE = '<svg viewBox="0 0 52 70" aria-hidden="true">'
    + '<path class="o-wstf-fig" d="M3 70C4 56 13 49 26 49S48 56 49 70Z"/><path class="o-wstf-fig" d="M21 40H31V51H21Z"/>'
    + '<ellipse class="o-wstf-fig" cx="26" cy="33" rx="9.5" ry="11"/><path class="o-wstf-band" d="M15.6 35.5H36.4L26 49Z"/>'
    + '<circle class="o-wstf-eye" cx="22.4" cy="31" r="1.4"/><circle class="o-wstf-eye" cx="29.6" cy="31" r="1.4"/>'
    + '<path class="o-wstf-fig" d="M16.5 25C16.5 13 19.5 8.5 26 10.5C32.5 8.5 35.5 13 35.5 25Z"/>'
    + '<path class="o-wstf-fig" d="M3 25.5C11 20 41 20 49 25.5C42 30 10 30 3 25.5Z"/></svg>';
  // A rider on a galloping horse, facing right, as one silhouette.
  var RIDER = '<svg class="o-wstr-horse" viewBox="0 0 48 40" aria-hidden="true"><path d="'
    + 'M12 17.5C17 16 25 16.5 30 16.5C33 12 35 9 38 6.5L40.5 5L41 8C43.5 9 45.5 10.5 46.5 12.5L45.5 14.5C43.5 14.5 41.5 14 40 14.5'
    + 'C38.5 17.5 37.5 20 37 23C36 25.5 33 26.5 29 26.5L18 27C15 27 12 26 10.5 23.5C10 21 10.5 18.5 12 17.5Z'
    + 'M11.5 18.5C8 18 5 19.5 2 23.5C5 23 7.5 22 10.5 21.5Z'
    + 'M35 24.5L44.5 31.5L43 33.5L33 27ZM31.5 26L36.5 33.5L34.5 34.5L29.5 27ZM14 25L5.5 30.5L4.5 28.5L12 23.5ZM18 26.5L13.5 34.5L11.5 33.5L16 26Z'
    + 'M21 17.5C21 13 22 9.8 24.8 9C27.2 9.4 28.2 11.4 28 14L32 15L31.6 16.6L27.4 16.2C27 17 26.6 17.6 26 18Z'
    + 'M27.7 6.3A2.4 2.4 0 1 1 22.9 6.3A2.4 2.4 0 1 1 27.7 6.3Z'
    + 'M19.8 4.6C22.5 3.4 28.5 3.4 31.2 4.6C28.5 5.3 22.5 5.3 19.8 4.6ZM23 4.4C23 1.8 24 1 25.5 1.6C27 1 28 1.8 28 4.4Z'
    + 'M23 17L25.3 23.5L23.6 24.2L21.4 17.6Z"/></svg>';
  var CACTUS = '<svg class="o-wstr-cactus" viewBox="0 0 22 40" aria-hidden="true"><path d="M8.5 40V5.5a2.5 2.5 0 0 1 5 0V40Z'
    + 'M8.5 22H5.5a2 2 0 0 1-2-2v-7a1.6 1.6 0 0 1 3.2 0v5.8h1.8ZM13.5 18h2.4v-6.5a1.6 1.6 0 0 1 3.2 0V18a2.5 2.5 0 0 1-2.5 2.5h-3.1Z"/></svg>';
  var TIERS = { '1': 'Trusty', '2': 'Polished', '3': 'Gleaming' };
  // Where the riders far off stand: on top of the two mesas, the first ones in front of the sun.
  var RIDGE = [[266, 62], [52, 61], [250, 62], [36, 61], [282, 62], [68, 61]];
  // The six ball tips of the sheriff's star, as % of the badge.
  var BALLS = [[50, 3], [90.7, 26.5], [90.7, 73.5], [50, 97], [9.3, 73.5], [9.3, 26.5]];

  // The gold pan: more nuggets for more bits (3 to 18, and a big one on top from 1,000), the pan shakes
  // once the last one has landed, then the gold glints.
  function pour(n) {
    var count = Math.max(3, Math.min(18, Math.round(2.2 * Math.log2(n + 1) - 6))), lode = n >= 1000, total = count + (lode ? 1 : 0);
    var st = Math.max(0.033, Math.min(0.065, 0.6 / total)), last = 0.25 + (total - 1) * st, shake = last + 0.27;
    var g = n >= 1000 ? 4 : n >= 100 ? 3 : 2, glint = shake + 0.22;
    return { count: count, lode: lode, total: total, st: st, shake: shake, g: g, glint: glint, len: glint + (g - 1) * 0.08 + 0.4 };
  }
  // A telegram ends every sentence in STOP.
  function stops(text) {
    var s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    var parts = s.split(/[.!?…]+(?:\s+|$)/).map(function (p) { return p.replace(/[\s,;:–—-]+$/, '').trim(); }).filter(Boolean);
    return parts.length ? parts.join(' STOP ') + ' STOP' : s + ' STOP';
  }
  function telegram(d) {
    var text = stops(d.message) || 'Tip received STOP', n = Array.from(text).length;
    var per = Math.min(0.026, 0.85 / Math.max(1, n)), t = typed(text, 0.6, per, 104), end = 0.6 + t.n * per;
    return { t: t, end: end, stamp: end + 0.12, taps: Math.max(2, Math.min(12, Math.round((end - 0.6) / 0.14))) };
  }
  // The posse: one rider per raider up to eight, alternating front and back rows; more than eight
  // also puts a few riders far off, on top of the mesas.
  function posse(v) {
    var n = Math.min(v, 8), far = v > 8 ? Math.min(6, Math.round(Math.log10(v) * 2)) : 0;
    var lenRiders = n ? 0.3 + (n - 1) * 0.07 + 0.75 : 0.6, lenFar = far ? 0.75 + (far - 1) * 0.08 + 0.5 : 0;
    return { n: n, far: far, len: Math.max(lenRiders, lenFar, 0.9) + 0.1 };
  }

  /* ── follow — Wanted ── */
  K.register({
    key: 'follow-western', eventType: 'follow', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'wstFollow', fx: 'none', anim: hold('1.3s'), exit: exit('wstTearDown', '0.45s'), len: 1.35,
    render: function (d) {
      var head = d && d.label ? d.label : 'Wanted';
      return '<div class="obj o-wst o-wstf"><div class="o-wstf-wallw"><div class="o-wstf-wall"></div></div>'
        + dust([[40, 92, 26, -16, -2, 0.25], [380, 88, 26, 16, -2, 0.25], [120, 124, 24, -8, 6, 0.27], [300, 124, 24, 8, 6, 0.27]])
        + '<div class="o-wstf-pw"><div class="o-wstf-poster o-wst-paper"><div class="o-wstf-mug">' + FIGURE + '</div>'
        + '<div class="o-wstf-txt"><div class="o-wst-head o-wstf-head" style="' + fitStyle(head, 8) + '">' + label(d, 'Wanted') + '</div>'
        + nm('o-wstf-name o-wst-name', d.username, 13)
        + '<div class="o-wst-cap o-wstf-for">for following</div></div></div>'
        + '<i class="o-wst-nail o-wstf-nail" style="left:14px;top:11px;--nd:.36s"></i><i class="o-wst-nail o-wstf-nail" style="left:336px;top:11px;--nd:.86s"></i>'
        + dust([[14, 11, 12, -9, -5, 0.46], [14, 11, 10, 8, 6, 0.46], [336, 11, 12, 9, -5, 0.96], [336, 11, 10, -8, 6, 0.96]])
        + '</div></div>';
    },
  });

  /* ── subscription — Sheriff badge ── */
  K.register({
    key: 'subscriber-western', eventType: 'subscription', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'wstSub', fx: 'none', anim: hold('1.6s'), exit: exit('wstBadgeOut', '0.42s'),
    len: function (d) { var t = tierOf(d); return t === '3' ? 1.95 : t === '2' ? 1.8 : 1.35; },
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), tier = tierOf(d), digits = String(months).length;
      var heading = months > 1 ? 'Deputy for ' + months + ' months' : 'New deputy', head = d && d.label ? d.label : heading;
      var balls = BALLS.map(function (b) { return '<i class="o-wsts-ball" style="left:' + b[0] + '%;top:' + b[1] + '%"></i>'; }).join('');
      return '<div class="obj o-wst o-wsts t' + tier + '"><div class="o-wsts-patch"></div>'
        + (tier === '3' ? '<i class="o-wsts-halo"></i>' : '')
        + '<div class="o-wsts-bw"><div class="o-wsts-spin"><div class="o-wsts-star"><i class="o-wsts-shine"></i></div>' + balls
        + '<div class="o-wsts-disc"><b class="o-wsts-num" style="font-size:' + (digits <= 2 ? 30 : digits === 3 ? 23 : 18) + 'px">' + odo(String(months), 0.7, 0.6) + '</b>'
        + '<small class="o-wsts-unit">' + (months === 1 ? 'month' : 'months') + '</small></div></div>'
        + (tier === '3' ? glints([['50%', '3%', 15, 1.2], ['91%', '27%', 13, 1.28], ['9%', '74%', 13, 1.36], ['91%', '74%', 15, 1.44]]) : '') + '</div>'
        + dust([[44, 152, 22, -16, 5, 0.64], [68, 160, 18, -7, 6, 0.66], [100, 160, 18, 7, 6, 0.66], [124, 152, 22, 16, 5, 0.64]])
        + '<div class="o-wsts-txt"><div class="o-wsts-lbl" style="' + fitStyle(head, 21) + '">' + label(d, heading) + '</div>'
        + nm('o-wsts-name o-wst-name', d.username, 13)
        + '<div class="o-wst-cap o-wsts-tier">Tier ' + tier + ' · ' + TIERS[tier] + ' badge</div>'
        + (d.message ? '<div class="o-wsts-msg">“' + esc(d.message) + '”</div>' : '')
        + '</div></div>';
    },
  });

  /* ── bits — Gold pan ── */
  K.register({
    key: 'bits-western', eventType: 'bits', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'wstBits', fx: 'sparks', anim: hold('1.6s'), exit: exit('wstPanOut', '0.42s'),
    len: function (d) { return pour(intOf(K.sizeOf(d, 'bits'))).len; },
    render: function (d) {
      var n = intOf(d.amount != null ? d.amount : d.bits), heap = intOf(K.sizeOf(d, 'bits')), p = pour(heap), r = rng(hash(d.username + heap)), spots = [], left = p.count, i;
      // Rows of the heap inside the pan: [how many fit, height, half width]; each row fills from the middle out.
      [[7, 50, 56], [6, 41, 45], [5, 32, 34]].forEach(function (row) {
        var k = Math.min(row[0], left), sp = (2 * row[2]) / (row[0] - 1), order = [], j;
        left -= k;
        for (j = 0; j < k; j++) order.push(j);
        order.sort(function (a, b) { return (Math.abs(a - (k - 1) / 2) - Math.abs(b - (k - 1) / 2)) || (a - b); });
        order.forEach(function (o) { spots.push([80 + (o - (k - 1) / 2) * sp, row[1], 0]); });
      });
      if (p.lode) spots.push([80, 23, 1]);
      var nuggets = '', shine = [];
      for (i = 0; i < spots.length; i++) {
        var big = spots[i][2], s = big ? 27 : 15 + r() * 5 + (heap >= 1000 ? 2 : 0);
        var x = spots[i][0] + (big ? 0 : (r() - 0.5) * 5), y = spots[i][1] + (big ? 0 : (r() - 0.5) * 3);
        nuggets += '<i class="o-wstb-nug k' + (i % 3) + '" style="--x:' + x.toFixed(1) + 'px;--y:' + y.toFixed(1) + 'px;--s:' + s.toFixed(1) + 'px;--r:' + Math.round(r() * 80 - 40)
          + 'deg;--fx:' + Math.round((r() - 0.5) * 30) + 'px;--nd:' + (0.25 + i * p.st).toFixed(3) + 's"></i>';
        shine.push([x - s * 0.18, y - s * 0.22]);
      }
      var gl = shine.slice(-p.g).map(function (q, k) { return [q[0].toFixed(0) + 'px', q[1].toFixed(0) + 'px', 12 + Math.round(r() * 4), p.glint + k * 0.08]; });
      var wem = 0.526 + Array.from(fmt(n)).reduce(function (w, c) { return w + (c === ',' ? 0.342 : 0.646); }, 0);
      var size = Math.max(20, Math.min(38, Math.floor(139 / wem))), lift = Math.max(0, 0.139 * size - 2.36).toFixed(1);
      return '<div class="obj o-wst o-wstb"><div class="o-wstb-pan" style="--sh:' + p.shake.toFixed(2) + 's"><i class="o-wstb-shadow"></i><i class="o-wstb-rim"></i><i class="o-wstb-bowl"></i>'
        + '<div class="o-wstb-pile">' + nuggets + glints(gl) + '</div><i class="o-wstb-lip"></i></div>'
        + '<div class="o-wstb-card o-wst-paper"><i class="o-wst-nail" style="left:50%;top:10px"></i>'
        + '<div class="o-wst-cap o-wstb-lbl">' + label(d, 'Struck gold!') + '</div>'
        + '<div class="o-wstb-amt" style="font-size:' + size + 'px"><span class="o-wstb-plus">+</span>' + odo(fmt(n), 0.3, Math.max(0.5, (p.total - 1) * p.st + 0.3))
        + '<span class="o-wstb-unit" style="margin-bottom:' + lift + 'px">gold</span></div>'
        + nm('o-wstb-name o-wst-name', d.username, 12) + '</div></div>';
    },
  });

  /* ── donation — Telegram ── */
  K.register({
    key: 'donation-western', eventType: 'donation', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'wstDonation', fx: 'none', anim: hold('1.2s'), exit: exit('wstSlipOut', '0.38s'),
    len: function (d) { return telegram(d).stamp + 0.4; },
    render: function (d) {
      var g = telegram(d), amt = money(d.amount, d.currency), title = d && d.label ? d.label : 'Telegram';
      return '<div class="obj o-wst o-wstd" style="--st:' + g.stamp.toFixed(2) + 's;--taps:' + g.taps + '">'
        + '<div class="o-wstd-dev"><i class="o-wstd-slot"></i><div class="o-wstd-key"><i class="o-wstd-post"></i><i class="o-wstd-lever"><i class="o-wstd-knob"></i></i></div></div>'
        + '<div class="o-wstd-feed"><div class="o-wstd-slip o-wst-paper"><div class="o-wstd-top">'
        + '<div class="o-wstd-title"><div class="o-wstd-tt" style="' + fitStyle(title, 9) + '">' + label(d, 'Telegram') + '</div><i class="o-wstd-rule"></i></div>'
        + '<div class="o-wst-stamp o-wstd-stamp"><span>Paid</span><b style="font-size:' + (Array.from(amt).length > 8 ? 16 : 20) + 'px">' + esc(amt) + '</b></div></div>'
        + '<div class="o-wstd-from"><span class="o-wst-cap">From</span>' + nm('o-wstd-name o-wst-name', d.username, 13) + '</div>'
        + '<i class="o-wstd-rule wide"></i>'
        + '<div class="o-wstd-msg o-typed" style="' + g.t.style + '">' + g.t.html + '</div>'
        + '</div></div></div>';
    },
  });

  /* ── raid — Posse ── */
  K.register({
    key: 'raid-western', eventType: 'raid', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'wstRaid', fx: 'smoke', anim: hold('1.4s'), exit: exit('wstRideOff', '0.45s'),
    len: function (d) { return posse(intOf(K.sizeOf(d, 'raid'))).len; },
    render: function (d) {
      var v = intOf(d.viewers), q = posse(intOf(K.sizeOf(d, 'raid'))), n = q.n, sp = n > 1 ? Math.min(46, 300 / (n - 1)) : 0, riders = '', far = '', puffs = [], i;
      for (i = 0; i < n; i++) {
        var back = i % 2 === 1, w = back ? 36.8 : 46, cx = 210 + ((n - 1) / 2 - i) * sp, rd = 0.3 + i * 0.07;
        riders += '<div class="o-wstr-rider' + (back ? ' back' : '') + '" style="--x:' + Math.round(cx - w / 2) + 'px;--rd:' + rd.toFixed(2) + 's">' + RIDER + '</div>';
        puffs.push([Math.round(cx - w * 0.3), back ? 92 : 100, back ? 18 : 24, -16, -7, rd + 0.5]);
      }
      if (n) puffs.push([Math.round(210 - ((n - 1) / 2) * sp - 40), 96, 38, -14, -12, 0.3 + (n - 1) * 0.07 + 0.42]);
      for (i = 0; i < q.far; i++) far += '<div class="o-wstr-far" style="--x:' + RIDGE[i][0] + 'px;--b:' + RIDGE[i][1] + 'px;--fd:' + (0.75 + i * 0.08).toFixed(2) + 's">' + RIDER + '</div>';
      return '<div class="obj o-wst o-wstr"><div class="o-wstr-scene"><i class="o-wstr-sun"></i><i class="o-wstr-mesa"></i><i class="o-wstr-ground"></i>' + CACTUS + far
        + dust(puffs) + '<div class="o-wstr-riders">' + riders + '</div></div>'
        + '<div class="o-wstr-sign"><i class="o-wst-nail" style="left:16px;top:50%"></i><i class="o-wst-nail" style="left:calc(100% - 16px);top:50%"></i>'
        + nm('o-wstr-name o-wst-name', d.username + '’s posse', 20)
        + '<div class="o-wstr-line"><span class="o-wstr-lbl">' + label(d, 'rides in') + '</span><i class="o-wstr-sep"></i>'
        + '<b class="o-wstr-num">' + odo(fmt(v), 0.4, 0.95) + '</b><span class="o-wstr-unit">' + (v === 1 ? 'rider' : 'riders') + '</span></div></div></div>';
    },
  });

  /* ── giveaway — Saloon doors ── */
  function door(side) { return '<div class="o-wstg-door ' + side + '"><i class="o-wstg-leaf"></i><i class="o-wstg-hinge t"></i><i class="o-wstg-hinge b"></i></div>'; }
  K.register({
    key: 'giveaway-western', eventType: 'giveaway_winner', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'wstGiveaway', fx: 'confetti', anim: hold('1.5s'), exit: exit('wstSaloonOut', '0.42s'), len: 1.75,
    render: function (d) {
      var head = d && d.label ? d.label : 'Reward';
      return '<div class="obj o-wst o-wstg"><div class="o-wstg-pw"><div class="o-wstg-poster o-wst-paper">'
        + '<div class="o-wstg-head"><span class="o-wst-head o-wstg-ht" style="' + fitStyle(head, 6) + '">' + label(d, 'Reward') + '</span></div>'
        + '<div class="o-wst-cap o-wstg-sub">Giveaway winner</div>'
        + nm('o-wstg-name o-wst-name', d.username, 13)
        + (d.prize ? '<div class="o-wstg-bounty"><span class="o-wst-cap">Bounty</span><b class="o-wstg-prize">' + esc(d.prize) + '</b></div>' : '')
        + '</div><i class="o-wst-nail" style="left:14px;top:12px"></i><i class="o-wst-nail" style="left:276px;top:12px"></i></div>'
        + dust([[70, 184, 26, -14, 4, 0.48], [140, 192, 22, -6, 6, 0.52], [280, 192, 22, 6, 6, 0.52], [350, 184, 26, 14, 4, 0.48]])
        + door('l') + door('r')
        + glints([['120px', '38px', 15, 1.1], ['300px', '34px', 13, 1.22], ['292px', '68px', 11, 1.34]])
        + '</div>';
    },
  });

  Object.keys(SOUNDS).forEach(function (k) { K.registerSound(k, FAMILY, SOUNDS[k]); });
})(typeof window !== 'undefined' ? window : null);
