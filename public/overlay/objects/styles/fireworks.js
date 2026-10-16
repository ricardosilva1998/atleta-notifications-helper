'use strict';

/**
 * Fireworks (docs/superpowers/specs/2026-10-15-alert-styles-design.md, Appendix A), ported from the proposal
 * (docs/superpowers/specs/assets/2026-10-15-alert-styles/parts/fam/fwk.js and .css).
 * Its names and descriptions are in the locale files (overlayBuilder.families.fireworks, overlayBuilder.looks.<id>,
 * overlayBuilder.sounds.<key>). Its classes start with .o-fwk and its keyframes with fwk.
 */
/* ═══ Fireworks — a night sky celebration ═══
   Rockets climb on white-gold trails, a beat of silence, then the shell bursts in the streamer's colour:
   every trail runs out from the centre with a star riding at its end, the sparks droop and dim a little,
   then the sky holds still. Pacifico for names written in light, Josefin Sans for everything else.
   Everything private to this family lives inside this function, so its helper names cannot collide with
   another family's. */
(function (root) {
  var K = (root && root.ATLETA_KIT) || require('../kit.js');
  var FAMILY = 'fireworks';
  var esc = K.esc, money = K.money, nm = K.nm, fmt = K.fmt, label = K.label, odo = K.odo, hash = K.hash, rng = K.rng, intOf = K.intOf, tone = K.tone, noise = K.noise;
  var SOUNDS = {};
  function hold(dur) { return { in: 'hold', dur: dur, ease: 'linear' }; }
  // Every look takes the streamer's colour and its speed, and its main text when it shows one.
  var CONTROLS = { colour: 'accent', label: true, speed: true };
  var CONTROLS_NO_TEXT = { colour: 'accent', label: false, speed: true };
  K.registerFamily({ key: FAMILY, order: 22, fonts: ["Pacifico","Josefin+Sans:wght@600;700"] });


  /* ── Sounds, timed to the animations ── */
  SOUNDS.fwkFollow = function () {
    noise({ ft: 'bandpass', f: 2400, q: 1.4, d: 0.14, v: 0.12, t: 0.28 });                     // it lights
    noise({ ft: 'highpass', f: 4200, f2: 6400, q: 0.8, d: 0.9, v: 0.09, a: 0.06, t: 0.42 });    // the fizz while it writes
    [0.48, 0.6, 0.69, 0.81, 0.9, 1.02, 1.12].forEach(function (t, i) { noise({ ft: 'bandpass', f: 5200 + (i % 3) * 700, q: 6, d: 0.03, v: 0.14, t: t }); });
    tone({ f: 1568, d: 0.45, v: 0.035, type: 'triangle', t: 1.3 });                              // it glows on
    tone({ f: 2349, d: 0.5, v: 0.025, t: 1.38 });
  };
  SOUNDS.fwkSub = function () {
    [0.22, 0.5, 0.78].forEach(function (t, i) { tone({ f: i === 2 ? 1175 : 880, d: 0.1, v: 0.05, type: 'square', t: t }); });
    tone({ f: 620, f2: 2300, d: 0.32, v: 0.03, t: 0.78 });                                      // the rocket whistles up
    tone({ f: 105, f2: 38, d: 0.75, v: 0.12, a: 0.004, t: 1.16 });                             // boom
    noise({ ft: 'lowpass', f: 1000, f2: 150, d: 0.55, v: 0.28, t: 1.16 });
    for (var i = 0; i < 8; i++) noise({ ft: 'highpass', f: 3200 + (i % 4) * 400, d: 0.03, v: 0.12 - i * 0.01, t: 1.36 + i * 0.065 });
  };
  SOUNDS.fwkBits = function () {
    for (var i = 0; i < 5; i++) {
      var t = 0.2 + i * 0.12;
      noise({ ft: 'bandpass', f: 700, f2: 3000, q: 1.3, d: 0.36, v: 0.07, a: 0.12, t: t });      // whoosh up
      noise({ ft: 'lowpass', f: 1400, f2: 220, d: 0.24, v: 0.22, t: t + 0.44 });                // pop
      tone({ f: 150 - i * 8, f2: 55, d: 0.3, v: 0.07, t: t + 0.44 });
    }
    tone({ f: 1319, d: 0.5, v: 0.035, type: 'triangle', t: 1.3 });                               // the amount glows
    tone({ f: 1760, d: 0.5, v: 0.025, type: 'triangle', t: 1.38 });
  };
  SOUNDS.fwkDonation = function () {
    noise({ ft: 'lowpass', f: 380, d: 0.1, v: 0.24, t: 0.2 });                                  // the mortar thump
    tone({ f: 480, f2: 1900, d: 0.4, v: 0.03, t: 0.24 });                                       // whistle
    tone({ f: 92, f2: 30, d: 1, v: 0.12, a: 0.004, t: 0.68 });                                  // the big boom
    noise({ ft: 'lowpass', f: 1400, f2: 120, d: 0.9, v: 0.3, t: 0.68 });
    for (var i = 0; i < 10; i++) noise({ ft: 'highpass', f: 3000 + (i % 5) * 450, d: 0.03, v: 0.13 - i * 0.008, t: 0.95 + i * 0.07 });
    tone({ f: 1047, d: 0.45, v: 0.04, type: 'triangle', t: 1.02 });
    tone({ f: 1568, d: 0.6, v: 0.035, type: 'triangle', t: 1.12 });
  };
  SOUNDS.fwkRaid = function () {
    for (var i = 0; i < 10; i++) {
      var t = 0.24 + i * 0.075;
      noise({ ft: 'bandpass', f: 900, f2: 2800, q: 1.5, d: 0.3, v: 0.05, a: 0.1, t: t });
      noise({ ft: 'lowpass', f: 1300, f2: 200, d: 0.2, v: 0.2, t: t + 0.42 });
      tone({ f: 140 - (i % 3) * 18, f2: 50, d: 0.26, v: 0.06, t: t + 0.42 });
    }
  };
  SOUNDS.fwkGiveaway = function () {
    tone({ f: 520, f2: 2100, d: 0.42, v: 0.03, t: 0.2 });                                       // whistle
    tone({ f: 96, f2: 32, d: 0.9, v: 0.12, a: 0.004, t: 0.7 });                                 // boom
    noise({ ft: 'lowpass', f: 1200, f2: 140, d: 0.7, v: 0.26, t: 0.7 });
    noise({ ft: 'highpass', f: 5200, f2: 3000, d: 1.2, v: 0.06, a: 0.2, t: 0.8 });              // the willow hisses as it falls
    for (var i = 0; i < 12; i++) noise({ ft: 'highpass', f: 3600 + (i % 4) * 500, d: 0.025, v: 0.12 - i * 0.007, t: 0.9 + i * 0.075 });
    [784, 988, 1175, 1568].forEach(function (f, i) { tone({ f: f, d: i === 3 ? 0.7 : 0.16, v: 0.045, type: 'triangle', t: 1.05 + i * 0.12 }); });
  };

  /* ── Drawing helpers (short SVG paths, no ids, so any number of tiles can show the same look) ── */
  function n1(x) { return String(Math.round(x * 10) / 10); }
  function circ(x, y, r) {
    var w = n1(2 * r);
    return 'M' + n1(x - r) + ' ' + n1(y) + 'a' + n1(r) + ' ' + n1(r) + ' 0 1 0 ' + w + ' 0a' + n1(r) + ' ' + n1(r) + ' 0 1 0 -' + w + ' 0Z';
  }
  function exit(name, dur) { return { out: name, dur: dur, ease: 'cubic-bezier(.5,0,.85,.4)' }; }
  function tierOf(d) {
    var t = String(d.tier || '1');
    if (/^[123]000$/.test(t)) t = t.charAt(0);
    return /^[123]$/.test(t) ? t : '1';
  }
  // The town along the bottom of a sky: rockets launch from behind its roofs.
  var TOWN = '<i class="o-fwk-town"></i>';
  // A rocket climbing from y0 to y1 at x on a white-gold trail, from t for dur seconds; it fades at the top.
  function rocket(x, y0, y1, t, dur) {
    var rise = n1(y0 - y1);
    return '<i class="o-fwk-rk" style="left:' + n1(x - 1.5) + 'px;top:' + n1(y1) + 'px;height:' + rise + 'px;--rise:' + rise + 'px;--lt:' + t.toFixed(2) + 's;--rd:' + dur.toFixed(2) + 's"></i>';
  }
  // A shell bursting at (x, y), `size` px across, at o.t seconds. Each trail is one dash on its own ray
  // (pathLength 100): the group's stroke-dashoffset runs every dash out from the centre at once and a star
  // rides at the end of each, so a whole shell is three animated parts whatever its number of rays.
  // o: { rays, t, seed, sw (trail width in px), inner (rays in a short white-gold inner ring), tw (its stars twinkle: hero shells only) }
  function shell(x, y, size, o) {
    var r = rng(o.seed), u = 100 / size, rot = r() * 360;
    function ring(count, l0, l1, turn, big, small) {
      var p = '', s1 = '', s2 = '', step = 360 / count;
      for (var i = 0; i < count; i++) {
        var a = (rot + turn + i * step + (r() - 0.5) * step * 0.3) * Math.PI / 180, L = l0 + r() * (l1 - l0);
        var ex = 50 + Math.cos(a) * L, ey = 50 + Math.sin(a) * L;          // the centre is (50, 50)
        p += '<path pathLength="100" d="M50 50L' + n1(ex) + ' ' + n1(ey) + '"/>';
        s1 += circ(ex, ey, big * u);
        if (small) s2 += circ(ex, ey, small * u);
      }
      return { p: p, s1: s1, s2: s2 };
    }
    var out = ring(o.rays || 12, 40, 47, 0, 2.4, 1.05), inn = o.inner ? ring(o.inner, 19, 26, 180 / o.inner, 1.7, 0) : null;
    return '<i class="o-fwk-b' + (o.tw ? ' tw' : '') + '" style="left:' + n1(x - size / 2) + 'px;top:' + n1(y - size / 2) + 'px;width:' + size + 'px;height:' + size + 'px;--bt:' + o.t.toFixed(2) + 's">'
      + '<svg viewBox="0 0 100 100" aria-hidden="true">'
      + (inn ? '<g class="o-fwk-tr w" stroke-width="' + n1(1.4 * u) + '">' + inn.p + '</g>' : '')
      + '<g class="o-fwk-tr" stroke-width="' + n1((o.sw || 1.7) * u) + '">' + out.p + '</g>'
      + '<g class="o-fwk-st"><path class="o-fwk-s1" d="' + out.s1 + '"/><path class="o-fwk-s2" d="' + out.s2 + '"/>'
      + (inn ? '<path class="o-fwk-s3" d="' + inn.s1 + '"/>' : '') + '</g></svg></i>';
  }

  /* ── follow — Sparkler ── */
  // The sparkler lights at .3s and writes from .44s, a little longer for a longer name.
  var WRITE_AT = 0.44;
  function writeTime(name) { return Math.max(0.55, Math.min(1, Array.from(String(name || '')).length * 0.055)); }
  K.register({
    key: 'follow-fireworks', eventType: 'follow', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'fwkFollow', fx: 'none', anim: hold('1.4s'), exit: exit('fwkFadeUp', '0.42s'),
    len: function (d) { return WRITE_AT + writeTime(d.username) + 0.3; },
    render: function (d) {
      var wd = writeTime(d.username), r = rng(hash(d.username + 'sparkler')), sparks = '';
      for (var i = 0; i < 10; i++) {
        var a = (-90 + (r() - 0.5) * 230) * Math.PI / 180, dist = 12 + r() * 16, sd = 0.24 + r() * 0.12;
        sparks += '<i class="o-fwkf-spk" style="--sx:' + n1(Math.cos(a) * dist) + 'px;--sy:' + n1(Math.sin(a) * dist) + 'px;--sd:' + sd.toFixed(2)
          + 's;--sl:' + (WRITE_AT - 0.04 + i * 0.03).toFixed(2) + 's;--sn:' + Math.max(1, Math.floor((wd + 0.08 - i * 0.03) / sd)) + '"></i>';
      }
      return '<div class="obj o-fwk o-fwkf" style="--wd:' + wd.toFixed(2) + 's;--wn:' + Math.max(2, Math.round(wd / 0.16)) + '">'
        + '<div class="o-fwk-sky o-fwkf-sky"><div class="o-fwkf-txt"><div class="o-fwk-cap o-fwkf-lbl">' + label(d, 'New follower') + '</div>'
        + '<div class="o-fwkf-write">' + nm('o-fwk-name o-fwkf-name', d.username, 12)
        + '<div class="o-fwkf-pen"><div class="o-fwkf-tip"><i class="o-fwkf-wire"></i><i class="o-fwkf-flame"><i class="o-fwk-star o-fwkf-star"></i></i>' + sparks + '</div></div>'
        + '</div></div></div></div>';
    },
  });

  /* ── subscription — Countdown ── */
  // 3, 2, 1 from .22s, the rocket climbs during the 1, and the shell bursts at 1.16s; tier 2 and 3 add bursts.
  var MAIN_AT = 1.16, SATS = [MAIN_AT + 0.2, MAIN_AT + 0.36];
  K.register({
    key: 'subscriber-fireworks', eventType: 'subscription', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'fwkSub', fx: 'none', anim: hold('1.7s'), exit: exit('fwkFall', '0.45s'),
    len: function (d) { var t = tierOf(d); return t === '3' ? 1.95 : t === '2' ? 1.82 : 1.72; },
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), tier = tierOf(d), seed = hash(d.username + months), digits = String(months).length;
      var heading = months > 1 ? 'Resubscribed' : 'New subscriber', cd = '', pips = '';
      ['3', '2', '1'].forEach(function (c, i) { cd += '<b class="o-fwks-cd" style="--cd:' + (0.22 + i * 0.28).toFixed(2) + 's">' + c + '</b>'; });
      for (var i = 0; i < 3; i++) pips += '<i class="o-fwk-star o-fwks-pip' + (i < Number(tier) ? ' on' : '') + '" style="--pd:' + (i ? SATS[i - 1] : MAIN_AT).toFixed(2) + 's"></i>';
      return '<div class="obj o-fwk o-fwks"><div class="o-fwk-sky o-fwks-sky">' + cd + rocket(90, 176, 84, 0.76, 0.34)
        + (tier === '3' ? shell(32, 132, 56, { rays: 10, t: SATS[1], seed: seed + 2 }) : '')
        + (tier !== '1' ? shell(150, 38, 64, { rays: 10, t: SATS[0], seed: seed + 1 }) : '')
        + shell(90, 84, 156, { rays: 16, t: MAIN_AT, seed: seed, sw: 1.9, tw: true }) + TOWN
        + '<div class="o-fwks-disc"><b class="o-fwks-num" style="font-size:' + (digits <= 2 ? 32 : 25) + 'px">' + odo(String(months), MAIN_AT + 0.05, 0.6) + '</b>'
        + '<small class="o-fwks-unit">' + (months === 1 ? 'month' : 'months') + '</small></div>'
        + '<div class="o-fwks-txt"><div class="o-fwk-cap o-fwks-lbl">' + label(d, heading) + '</div>'
        + nm('o-fwk-name o-fwks-name', d.username, 10)
        + '<div class="o-fwks-tier"><span class="o-fwk-cap">Tier ' + esc(tier) + '</span><span class="o-fwks-pips">' + pips + '</span></div>'
        + (d.message ? '<div class="o-fwks-msg">“' + esc(d.message) + '”</div>' : '')
        + '</div></div></div>';
    },
  });

  /* ── bits — Volley ── */
  // 50 bits → 3 rockets, 500 → 5, 10,000 → 8 (never fewer than 2); bigger shells from 100 and from 1,000.
  function volley(n) {
    var count = Math.max(2, Math.min(8, Math.round(2.5 * Math.log10(n + 1) - 1.3))), st = Math.min(0.12, 0.6 / count);
    var last = 0.2 + (count - 1) * st + 0.44;
    return { count: count, st: st, last: last, glow: last + 0.08, len: Math.max(last + 0.55, last + 0.08 + 0.72) };
  }
  K.register({
    key: 'bits-fireworks', eventType: 'bits', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'fwkBits', fx: 'sparks', anim: hold('1.5s'), exit: exit('fwkFall', '0.45s'),
    len: function (d) { return volley(intOf(K.sizeOf(d, 'bits'))).len; },
    render: function (d) {
      var n = intOf(d.amount != null ? d.amount : d.bits), size = intOf(K.sizeOf(d, 'bits')), V = volley(size), r = rng(hash(d.username + size)), lvl = size >= 1000 ? 2 : size >= 100 ? 1 : 0;
      var order = [], rockets = '', shells = '', sp = 340 / V.count, mid = (V.count - 1) / 2, i;
      for (i = 0; i < V.count; i++) order.push(i);
      order.sort(function (a, b) { return Math.abs(a - mid) - Math.abs(b - mid) || a - b; });   // the middle goes first
      order.forEach(function (k, j) {
        var x = 40 + sp * (k + 0.5) + (r() - 0.5) * sp * 0.3, y = (k % 2 ? 58 : 34) + (r() - 0.5) * 10, lt = 0.2 + j * V.st;
        rockets += rocket(x, 158, y, lt, 0.36);
        shells += shell(x, y, [54, 64, 74][lvl] + Math.round((r() - 0.5) * 10), { rays: 11, t: lt + 0.44, seed: hash(d.username) + k * 7 });
      });
      return '<div class="obj o-fwk o-fwkb" style="--gt:' + V.glow.toFixed(2) + 's"><div class="o-fwk-sky o-fwkb-sky">' + rockets + shells + TOWN
        + '<i class="o-fwkb-smoke" style="--sm:' + (0.2 + 0.44 + 0.1).toFixed(2) + 's"></i>'
        + '<div class="o-fwkb-amt" style="font-size:' + (fmt(n).length > 5 ? 40 : 46) + 'px"><span class="o-fwkb-plus">+</span>' + odo(fmt(n), V.glow, 0.7) + '<span class="o-fwkb-unit">bits</span></div>'
        + '<div class="o-fwkb-who"><span class="o-fwk-cap o-fwkb-by">' + label(d, 'Cheered by') + '</span>' + nm('o-fwk-name o-fwkb-name', d.username, 15) + '</div>'
        + '</div></div>';
    },
  });

  /* ── donation — Big shell ── */
  // Under 10 → a 150px shell of 18 rays; 10 to 99 → 180px, 22 rays and a white-gold inner ring; 100 or more → 206px, 26 rays.
  function bigShell(amount) {
    var a = Number(amount) || 0, lvl = a >= 100 ? 2 : a >= 10 ? 1 : 0;
    return { size: [150, 180, 206][lvl], rays: [18, 22, 26][lvl], inner: [0, 10, 14][lvl] };
  }
  K.register({
    key: 'donation-fireworks', eventType: 'donation', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'fwkDonation', fx: 'none', anim: hold('1.5s'), exit: exit('fwkFlashOut', '0.5s'), len: 1.65,
    render: function (d) {
      var size = K.sizeOf(d, 'donation'), B = bigShell(size), amt = money(d.amount, d.currency), al = Array.from(amt).length, msg = d.message || '';
      return '<div class="obj o-fwk o-fwkd"><div class="o-fwk-sky o-fwkd-sky">' + rocket(210, 116, 58, 0.22, 0.38)
        + shell(210, 58, B.size, { rays: B.rays, inner: B.inner, t: 0.68, seed: hash(d.username + money(size, d.currency)), sw: 2, tw: true }) + TOWN
        + '<i class="o-fwkd-puff"></i><div class="o-fwkd-amt" style="font-size:' + (al <= 6 ? 42 : al <= 8 ? 36 : 30) + 'px">' + odo(amt, 0.72, 0.6) + '</div></div>'
        + '<div class="o-fwk-plate o-fwkd-plate' + (msg ? '' : ' solo') + '">'
        + (msg ? '<div class="o-fwkd-msg">“' + esc(msg) + '”</div>' : '')
        + '<div class="o-fwkd-from"><span class="o-fwk-cap">from</span>' + nm('o-fwk-name o-fwkd-name', d.username, msg ? 20 : 15) + '</div></div>'
        + '<div class="o-fwkd-tag"><span class="o-fwkd-tt">' + label(d, 'Thank you!') + '</span></div>'
        + '</div>';
    },
  });

  /* ── raid — Barrage ── */
  // One shell per raider up to twelve, launched left to right; they come faster, and smaller, the more there are.
  function barrage(v) {
    var n = Math.max(1, Math.min(12, v)), st = Math.min(0.1, 0.85 / n), last = 0.24 + (n - 1) * st + 0.42;
    return { n: n, st: st, last: last, len: last + 0.5 };
  }
  K.register({
    key: 'raid-fireworks', eventType: 'raid', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'fwkRaid', fx: 'none', anim: hold('1.6s'), exit: exit('fwkFall', '0.45s'),
    len: function (d) { return barrage(intOf(K.sizeOf(d, 'raid'))).len; },
    render: function (d) {
      var v = intOf(d.viewers), drawn = intOf(K.sizeOf(d, 'raid')), B = barrage(drawn), r = rng(hash(d.username + drawn)), sp = 372 / B.n, size = Math.round(Math.max(48, Math.min(86, 250 / B.n + 34))), sky = '';
      for (var i = 0; i < B.n; i++) {
        var x = 24 + sp * (i + 0.5), y = (B.n === 1 ? 52 : i % 2 ? 66 : 40) + (r() - 0.5) * 8, lt = 0.24 + i * B.st;
        sky += rocket(x, 130, y, lt, 0.36) + shell(x, y, size + Math.round((r() - 0.5) * 8), { rays: 10, t: lt + 0.42, seed: hash(d.username) + i * 7 });
      }
      return '<div class="obj o-fwk o-fwkr"><div class="o-fwk-sky o-fwkr-sky">' + sky + TOWN + '</div>'
        + '<div class="o-fwk-plate o-fwkr-plate"><div class="o-fwk-cap o-fwkr-lbl">' + label(d, 'Raid incoming') + '</div>'
        + '<div class="o-fwkr-row">' + nm('o-fwk-name o-fwkr-name', d.username, 11)
        + '<b class="o-fwkr-cnt"><span class="o-fwkr-plus">+</span>' + odo(fmt(v), 0.5, Math.max(0.5, B.last - 0.5)) + '</b>'
        + '<span class="o-fwk-cap o-fwkr-unit">' + (v === 1 ? 'raider' : 'raiders') + '</span></div></div></div>';
    },
  });

  /* ── giveaway — Grand finale ── */
  // The willow: seven streams a side rise from the break at (210, 36) and fall away as parabolas (a quadratic
  // curve whose control point sits halfway across), wide enough to frame the name and the prize between them.
  var WILLOW = (function () {
    var cx = 210, cy = 36, list = [];
    for (var k = 0; k < 7; k++) {
      var th = (26 + k * 4.5) * Math.PI / 180, X = 196 - k * 8, D = 172 - k * 9;
      [-1, 1].forEach(function (s) {
        var q = [cx, cy, cx + s * X / 2, cy - X / 2 * Math.tan(th), cx + s * X, cy + D];
        list.push({ k: k, q: q, d: 'M' + cx + ' ' + cy + 'Q' + n1(q[2]) + ' ' + n1(q[3]) + ' ' + n1(q[4]) + ' ' + n1(q[5]) });
      });
    }
    return list;
  })();
  var WILLOW_PATHS = WILLOW.map(function (w) { return '<path pathLength="100" d="' + w.d + '"/>'; }).join('');
  // One glitter star per stream, lit when the stream's falling dash reaches it (the draw eases out).
  var GLITTER = WILLOW.map(function (w, i) {
    var t = 0.56 + 0.12 * ((w.k + i) % 3), m = 1 - t, q = w.q;
    var x = m * m * q[0] + 2 * t * m * q[2] + t * t * q[4], y = m * m * q[1] + 2 * t * m * q[3] + t * t * q[5];
    return '<i class="o-fwkg-gl" style="left:' + n1(x - 2) + 'px;top:' + n1(y - 2) + 'px;--gd:' + (0.72 + 0.85 * (1 - Math.sqrt(1 - t))).toFixed(2) + 's"></i>';
  }).join('');
  K.register({
    key: 'giveaway-fireworks', eventType: 'giveaway_winner', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'fwkGiveaway', fx: 'confetti', anim: hold('1.8s'), exit: exit('fwkFlashOut', '0.5s'), len: 1.9,
    render: function (d) {
      return '<div class="obj o-fwk o-fwkg"><div class="o-fwk-sky o-fwkg-sky">' + rocket(210, 206, 36, 0.2, 0.42)
        + '<svg class="o-fwkg-wil" viewBox="0 0 420 216" aria-hidden="true"><g class="o-fwkg-glo">' + WILLOW_PATHS + '</g><g class="o-fwkg-st">' + WILLOW_PATHS + '</g></svg>'
        + GLITTER + shell(210, 36, 60, { rays: 12, t: 0.7, seed: hash(d.username + 'finale'), tw: true }) + TOWN
        + '<div class="o-fwkg-txt"><div class="o-fwk-cap o-fwkg-lbl">' + label(d, 'Giveaway winner') + '</div>' + nm('o-fwk-name o-fwkg-name', d.username, 9) + '</div>'
        + (d.prize ? '<div class="o-fwkg-pw"><div class="o-fwkg-prize"><span class="o-fwkg-pk">Prize</span><span class="o-fwkg-pv">' + esc(d.prize) + '</span></div></div>' : '')
        + '</div></div>';
    },
  });

  Object.keys(SOUNDS).forEach(function (k) { K.registerSound(k, FAMILY, SOUNDS[k]); });
})(typeof window !== 'undefined' ? window : null);
