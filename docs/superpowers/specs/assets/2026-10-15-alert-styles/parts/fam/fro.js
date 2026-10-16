/* ═══ Frost — winter and festive ═══
   A snow globe, an ornament on a pine branch, a stack of presents, hot cocoa, a reindeer sleigh across the
   moon and the northern lights. Text sits on frosted navy plates that wear a snow cap with icicles; labels are
   Mountains of Christmas, names and numbers Quicksand. Everything private to this family lives inside this
   function, so its helper names cannot collide with another family's. */
(function () {
  FAMS.fro = {
    name: 'Frost', order: 17, badge: 'new',
    sw: 'linear-gradient(135deg,#F4F9FF 0 30%,#8ED8FF 30% 58%,#C8234A 58% 70%,#0E1A33 70%)',
    desc: 'Winter and festive: a snow globe shakes for follows, an ornament spins onto a pine branch for subs, presents stack up for bits, a mug of hot cocoa steams for donations, a reindeer sleigh crosses the moon for raids and the northern lights light up the giveaway winner.',
  };

  /* ── Sounds (timed to the animations) ── */
  SOUND_NAMES.froFollow = 'Snow globe music box';
  SOUNDS.froFollow = function () {
    tone({ f: 180, f2: 110, d: 0.14, v: 0.09, t: 0.24 });
    [0.5, 0.64, 0.78, 0.92].forEach(function (t, i) { noise({ ft: 'highpass', f: 4200 + i * 500, q: 0.8, d: 0.09, v: 0.1, t: t }); });
    [1568, 2093, 2637, 2349, 2093].forEach(function (f, i) { tone({ f: f, d: 0.55, v: 0.045, t: 1.04 + i * 0.12 }); });
  };
  SOUND_NAMES.froSub = 'Glass bauble chime';
  SOUNDS.froSub = function () {
    tone({ f: 2637, d: 0.3, v: 0.06, t: 0.62 });
    tone({ f: 3951, d: 0.22, v: 0.03, t: 0.62 });
    noise({ ft: 'highpass', f: 5000, d: 0.4, v: 0.06, a: 0.03, t: 0.64 });
    noise({ ft: 'bandpass', f: 1100, f2: 2600, q: 3, d: 0.8, v: 0.05, a: 0.06, t: 0.7 });
    [1047, 1319, 1568].forEach(function (f, i) { tone({ f: f, d: 0.9, v: 0.05, type: 'triangle', t: 1.42 + i * 0.06 }); });
  };
  SOUND_NAMES.froBits = 'Gift thumps and jingle';
  SOUNDS.froBits = function () {
    for (var i = 0; i < 5; i++) {
      tone({ f: 170 - i * 8, f2: 85, d: 0.12, v: 0.1, t: 0.58 + i * 0.11 });
      noise({ ft: 'lowpass', f: 700, d: 0.06, v: 0.12, t: 0.58 + i * 0.11 });
    }
    [0, 0.07, 0.14].forEach(function (t) { noise({ ft: 'highpass', f: 6500, q: 0.7, d: 0.08, v: 0.12, t: 1.38 + t }); });
    tone({ f: 2637, d: 0.3, v: 0.04, t: 1.4 });
    tone({ f: 3136, d: 0.45, v: 0.035, t: 1.47 });
  };
  SOUND_NAMES.froDonation = 'Cocoa pour and chime';
  SOUNDS.froDonation = function () {
    noise({ ft: 'lowpass', f: 500, f2: 1300, q: 1, d: 0.6, v: 0.14, a: 0.08, t: 0.36 });
    [1.19, 1.27, 1.35].forEach(function (t, i) { tone({ f: 520 - i * 40, f2: 240, d: 0.08, v: 0.06, t: t }); });
    tone({ f: 784, d: 0.7, v: 0.06, t: 1.3 });
    tone({ f: 1175, d: 0.9, v: 0.045, t: 1.38 });
  };
  SOUND_NAMES.froRaid = 'Sleigh bells';
  SOUNDS.froRaid = function () {
    noise({ ft: 'bandpass', f: 500, f2: 1800, q: 0.8, d: 1.0, v: 0.08, a: 0.3, t: 0.25 });
    for (var i = 0; i < 9; i++) {
      var t = 0.32 + i * 0.13;
      noise({ ft: 'highpass', f: 6000, q: 0.7, d: 0.07, v: 0.12, t: t });
      tone({ f: i % 2 ? 2794 : 3136, d: 0.12, v: 0.03, t: t });
    }
    [1568, 2093].forEach(function (f, i) { tone({ f: f, d: 0.6, v: 0.04, type: 'triangle', t: 1.45 + i * 0.1 }); });
  };
  SOUND_NAMES.froGiveaway = 'Aurora shimmer';
  SOUNDS.froGiveaway = function () {
    tone({ f: 262, d: 1.7, v: 0.05, type: 'triangle', a: 0.5, t: 0.15 });
    tone({ f: 392, d: 1.6, v: 0.035, type: 'triangle', a: 0.5, t: 0.25 });
    noise({ ft: 'highpass', f: 6000, d: 1.2, v: 0.05, a: 0.4, t: 0.3 });
    [1568, 1976, 2349, 2637, 3136].forEach(function (f, i) { tone({ f: f, d: 0.6, v: 0.04, t: 0.86 + i * 0.09 }); });
  };

  /* ── Shared drawings ── */
  // A six-armed snowflake on a 24×24 grid, stroked, built once.
  var FLAKE_D = (function () {
    var d = '', k, s;
    function p(x, y) { return (12 + x).toFixed(1) + ' ' + (12 + y).toFixed(1); }
    for (k = 0; k < 6; k++) {
      var a = k * Math.PI / 3, ux = Math.sin(a), uy = -Math.cos(a);
      d += 'M12 12L' + p(ux * 10.5, uy * 10.5);
      for (s = -1; s <= 1; s += 2) {
        var b = a + s * 0.8;
        d += 'M' + p(ux * 6, uy * 6) + 'L' + p(ux * 6 + Math.sin(b) * 3.6, uy * 6 - Math.cos(b) * 3.6);
      }
    }
    return d;
  })();
  function flake(cls, style) {
    return '<svg class="o-fro-flake ' + cls + '"' + (style ? ' style="' + style + '"' : '') + ' viewBox="0 0 24 24" aria-hidden="true"><path d="' + FLAKE_D + '"/></svg>';
  }
  // A small snowy pine (30×40).
  function pine(cls) {
    return '<svg class="o-fro-pine ' + cls + '" viewBox="0 0 30 40" aria-hidden="true"><path class="o-fro-pine-k" d="M12.8 34H17.2V40H12.8Z"/>'
      + '<path class="o-fro-pine-t" d="M15 1L24.5 13.5H19.5L27 24.5H21.5L29.5 35.5H.5L8.5 24.5H3L10.5 13.5H5.5Z"/>'
      + '<path class="o-fro-pine-s" d="M15 1.6L17.6 5H12.4ZM6.5 13.5H10M20 13.5H23.5M4 24.5H8.5M21.5 24.5H26M1.6 35.4H28.4"/></svg>';
  }

  // The pine bough across the top of the ornament look: a twig with needles on both sides and clumps of snow.
  // It is the same for every alert, so it is built once from a fixed seed.
  var BOUGH = (function () {
    var r = rng(7), P = [[0, 21], [110, 12], [250, 34], [432, 22]], dk = '', lt = '', snow = '', i, s;
    function at(t) {
      var u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
      return [a * P[0][0] + b * P[1][0] + c * P[2][0] + e * P[3][0], a * P[0][1] + b * P[1][1] + c * P[2][1] + e * P[3][1]];
    }
    function seg(p, ang, len) { return 'M' + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + 'l' + (Math.cos(ang) * len).toFixed(1) + ' ' + (Math.sin(ang) * len).toFixed(1); }
    for (i = 0; i <= 34; i++) {
      var t = i / 34, p = at(t), q = at(Math.min(1, t + 0.01)), ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
      for (s = -1; s <= 1; s += 2) {
        var outer = seg(p, ang + s * (0.85 + r() * 0.3), 10 + r() * 5), inner = seg(p, ang + s * (0.45 + r() * 0.25), 8 + r() * 4);
        if ((i + (s > 0 ? 1 : 0)) % 2) { dk += outer; lt += inner; } else { lt += outer; dk += inner; }
      }
    }
    [0.08, 0.24, 0.4, 0.55, 0.7, 0.86].forEach(function (t, k) {
      var p = at(t);
      snow += '<ellipse class="o-fros-snow" cx="' + p[0].toFixed(1) + '" cy="' + (p[1] - 4.5).toFixed(1) + '" rx="' + (9 + (k % 3) * 2.5) + '" ry="' + (3.6 + (k % 2)) + '"/>';
    });
    return '<svg class="o-fros-bough" viewBox="0 0 432 52" aria-hidden="true"><path class="o-fros-twig" d="M0 21C110 12 250 34 432 22"/>'
      + '<path class="o-fros-nlt" d="' + lt + '"/><path class="o-fros-ndk" d="' + dk + '"/>' + snow + '</svg>';
  })();

  // Presents: where each one sits in the pile (left, bottom, width, height), in the order they land,
  // so every count makes a stable pile. Then each one's paper, ribbon and pattern.
  var BOXES = [[2, 0, 62, 46], [68, 0, 58, 46], [14, 46, 54, 38], [130, 0, 44, 34], [72, 46, 50, 38], [34, 84, 54, 34], [128, 34, 42, 30], [46, 118, 34, 26]];
  var DOTS = 'radial-gradient(circle,rgba(255,255,255,.3) 0 1.8px,rgba(255,255,255,0) 2.3px) 0 0/11px 11px';
  var WRAPS = [
    ['#C8234A', '#F2C14E', DOTS],
    ['#1F6B4A', '#F4F9FF', 'repeating-linear-gradient(135deg,rgba(255,255,255,0) 0 6px,rgba(255,255,255,.13) 6px 10px)'],
    ['var(--froa)', '#C8234A', ''],
    ['#EEF5FF', '#C8234A', 'radial-gradient(circle,rgba(200,35,74,.35) 0 1.8px,rgba(200,35,74,0) 2.3px) 0 0/10px 10px'],
    ['#F2C14E', '#1F6B4A', ''],
    ['#C8234A', '#F4F9FF', 'repeating-linear-gradient(45deg,rgba(255,255,255,0) 0 5px,rgba(255,255,255,.14) 5px 9px)'],
    ['#1F6B4A', '#F2C14E', DOTS],
    ['var(--froa)', '#F2C14E', ''],
  ];
  var BOW = '<svg class="o-frob-bsvg" viewBox="0 0 38 26" aria-hidden="true">'
    + '<path class="o-frob-tail" d="M17 15L10.5 25H14.5L19 18ZM21 15L27.5 25H23.5L19 18Z"/>'
    + '<path class="o-frob-loop" d="M19 14C13.5 4.5 4 2.5 3 9C2.2 14.5 11.5 15.5 19 14ZM19 14C24.5 4.5 34 2.5 35 9C35.8 14.5 26.5 15.5 19 14Z"/>'
    + '<circle class="o-frob-knot" cx="19" cy="14" r="3.6"/></svg>';
  // 2 presents for a few bits, 3 for 50, 5 for 500, 8 from 10,000.
  function giftCount(n) { return Math.max(2, Math.min(8, Math.round(0.3 + Math.log10(n + 1) * 1.8))); }

  // Hot cocoa: marshmallow spots on the surface (left, bottom, tilt); the last two sit on top of the others.
  var MALLOWS = [[10, 77, -14], [30, 80, 8], [50, 78, -6], [68, 81, 15], [20, 87, 24], [56, 88, -18]];
  // 2 marshmallows for €2.50, 3 for €25, 5 for €250, 6 from €1,000.
  function mallowCount(a) { return Math.max(2, Math.min(6, Math.round(1 + Math.log10(Math.max(1, a)) * 1.6))); }
  var CANE = '<svg class="o-frod-cane" viewBox="0 0 30 80" aria-hidden="true"><path class="o-frod-cw" d="M9 78V16Q9 5 18 5Q27 5 27 14"/><path class="o-frod-cr" d="M9 78V16Q9 5 18 5Q27 5 27 14"/></svg>';
  var STEAM = '<svg class="o-frod-steam" viewBox="0 0 84 62" aria-hidden="true">'
    + '<path class="o-frod-wisp" pathLength="100" style="--wd:1s" d="M22 60C14 50 30 42 22 31S18 13 26 4"/>'
    + '<path class="o-frod-wisp" pathLength="100" style="--wd:1.08s" d="M42 60C50 49 34 40 44 28S50 11 42 2"/>'
    + '<path class="o-frod-wisp" pathLength="100" style="--wd:1.16s" d="M62 60C54 51 70 43 60 32S56 17 64 8"/></svg>';

  // The sleigh team as one silhouette: the sleigh with a sack of gifts, gold runners and reins, and n reindeer
  // in single file, each a little higher than the one behind it. Returns its size so the look can place it.
  var LEGS = ['M23 15L29.5 19M21 15.5L26 21.5M10 15.5L3.5 18.5M11.5 16L6 21.5M6.5 12L2.5 10', 'M23 15L28 21M21 15.5L27.5 18.5M10 15.5L4.5 21M11.5 16L3 18.5M6.5 12L2.5 10.5'];
  function team(n) {
    var S = 30, rise = 2.6, sy = (n - 1) * rise + 3, W = 54 + (n - 1) * S + 36, H = Math.ceil(sy + 28), deer = '', i;
    for (i = 0; i < n; i++) {
      deer += '<g transform="translate(' + (54 + i * S) + ' ' + ((n - 1 - i) * rise).toFixed(1) + ')">'
        + '<path class="o-fror-dk" stroke-width="7" d="M8 13.5Q15 10.5 22 12.5"/>'
        + '<path class="o-fror-dk" stroke-width="3.6" d="M21.5 12L26.5 6.4L31.5 7.6"/>'
        + '<path class="o-fror-dk" stroke-width="2" d="' + LEGS[i % 2] + '"/>'
        + '<path class="o-fror-dk" stroke-width="1.3" d="M26 5.2L24.4 1.2M25.1 3.1L22.4 2.4M27.2 5.2L28.6 1M28 2.9L30.6 2.3"/></g>';
    }
    var sleigh = '<g transform="translate(0 ' + sy.toFixed(1) + ')">'
      + '<path class="o-fror-df" d="M16 10Q13 2.5 19 1.2Q24 0 26 3.2Q28.5 .6 31 3Q33 6.5 30 10Z"/>'
      + '<path class="o-fror-df" d="M3 3.5Q3 .5 6 .5H11Q14 .5 14 3.5V10H38Q42.5 10 42.5 14V16.5Q42.5 20 38 20H8.5Q3 20 3 14.5Z"/>'
      + '<path class="o-fror-gd" d="M10 20V25M34 20V25M2 25H40Q46.5 25 48 19.5Q49 16 45.5 15.5"/></g>';
    var rein = '<path class="o-fror-rein" d="M42 ' + (sy + 12).toFixed(1) + 'L' + (54 + (n - 1) * S + 25) + ' 12"/>';
    return {
      W: W, H: H, sy: sy,
      svg: '<svg class="o-fror-svg" width="' + W + '" height="' + H + '" viewBox="0 -2 ' + W + ' ' + H + '" aria-hidden="true">' + rein + sleigh + deer + '</svg>',
    };
  }

  // Northern lights: a curtain's wavy lower edge, and the pine ridge under the sky, both as clip-paths.
  function wave(r, base, amp) {
    var pts = ['0% 0%', '100% 0%'], ph = r() * 6.283, k;
    for (k = 0; k <= 16; k++) {
      var y = base + amp * Math.sin(ph + k * 0.95) + (r() - 0.5) * 5;
      pts.push((100 - k * 6.25).toFixed(1) + '% ' + Math.max(30, Math.min(100, y)).toFixed(1) + '%');
    }
    return 'polygon(' + pts.join(',') + ')';
  }
  function ridge(r) {
    var pts = ['0% 100%', '0% 80%'], x = 0;
    while (x < 100) {
      var w = 2.4 + r() * 3.4;
      pts.push(Math.min(100, x + w / 2).toFixed(1) + '% ' + (6 + r() * 50).toFixed(0) + '%');
      x = Math.min(100, x + w);
      pts.push(x.toFixed(1) + '% ' + (70 + r() * 18).toFixed(0) + '%');
    }
    pts.push('100% 100%');
    return 'polygon(' + pts.join(',') + ')';
  }
  var GIFT = '<svg class="o-frog-gift" viewBox="0 0 26 24" aria-hidden="true"><path class="o-frog-gb" d="M3 10H23V23H3Z"/><path class="o-frog-gl" d="M1.5 6.5H24.5V11H1.5Z"/>'
    + '<path class="o-frog-gr" d="M11 6.5H15V23H11Z"/><path class="o-frog-gw" d="M13 6.5C10.5 1 5.5 1.5 6.5 4.5C7.2 6.4 10.5 6.6 13 6.5ZM13 6.5C15.5 1 20.5 1.5 19.5 4.5C18.8 6.4 15.5 6.6 13 6.5Z"/></svg>';

  /* ── The six looks ── */
  add({
    id: 'follow-frost', alert: 'follow', fam: 'fro', isNew: true, title: 'Snow globe',
    desc: 'A snow globe lands with a soft bounce and gives a little shake; the snow swirls up and settles, and the name appears inside the glass. “New follower” sits on the brass plate of its wooden base.',
    sound: 'froFollow', fx: 'none', anim: hold('1.7s'),
    exit: { out: 'froExitSink', dur: '.45s', ease: 'cubic-bezier(.5,0,.9,.4)' }, len: 1.75,
    render: function (d) {
      var r = rng(hash(d.username + 'globe')), snow = '', i;
      for (i = 0; i < 14; i++) {
        // Eight flakes come to rest on the snow, six stay floating beside the name (never over it).
        var floating = i >= 8, x, y;
        if (floating) { x = (i % 2 ? 244 : 44) + r() * 36; y = 34 + r() * 36; } else { x = 30 + r() * 264; y = 84 + r() * 8; }
        var xs = x + (r() - 0.5) * 60, ys = 86 + r() * 6, xm = 60 + r() * 204, ym = 12 + r() * 30, xn = xm + (r() - 0.5) * 90, yn = ym + 10 + r() * 20;
        snow += '<i class="o-frof-sn" style="--x:' + x.toFixed(0) + 'px;--y:' + y.toFixed(0) + 'px;--s:' + (3 + r() * 3).toFixed(1) + 'px;--o:' + (floating ? 0.85 : 1)
          + ';--sx:' + (xs - x).toFixed(0) + 'px;--sy:' + (ys - y).toFixed(0) + 'px;--mx:' + (xm - x).toFixed(0) + 'px;--my:' + (ym - y).toFixed(0)
          + 'px;--nx:' + (xn - x).toFixed(0) + 'px;--ny:' + (yn - y).toFixed(0) + 'px;--sd:' + (0.44 + r() * 0.12).toFixed(2) + 's;--du:' + (1.05 + r() * 0.2).toFixed(2) + 's"></i>';
      }
      return '<div class="obj o-fro o-frof"><div class="o-frof-globe">'
        + '<div class="o-frof-glass"><i class="o-frof-ground"></i>' + pine('o-frof-tree o-frof-tl') + pine('o-frof-tree o-frof-tr')
        + '<div class="o-frof-txt">' + nm('o-fro-name o-frof-name', d.username, 13) + '</div>' + snow + '<i class="o-frof-rim"></i></div>'
        + '<div class="o-frof-base"><div class="o-frof-plaque"><span class="o-frof-lbl">' + label(d, 'New follower') + '</span></div></div>'
        + '</div></div>';
    },
  });

  add({
    id: 'subscriber-frost', alert: 'subscription', fam: 'fro', isNew: true, title: 'Ornament', amount: 'Months on the ornament',
    desc: 'An ornament drops onto a snowy pine branch, catches with a little bounce and spins to a stop with the months engraved on it. The tier sets its colour: berry red, frost blue or gold.',
    sound: 'froSub', fx: 'none', anim: hold('1.7s'),
    exit: { out: 'froExitLift', dur: '.4s', ease: 'cubic-bezier(.5,0,.9,.4)' }, len: 1.75,
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), tier = Math.min(3, Math.max(1, intOf(d.tier) || 1));
      var digits = String(months).length, nfs = digits <= 2 ? 34 : digits === 3 ? 26 : 20;
      var r = rng(hash(d.username + 'orn')), puff = '', i;
      // A little snow falls off the branch where the ornament catches.
      for (i = 0; i < 5; i++) {
        puff += '<i class="o-fros-fl" style="--x:' + (78 + r() * 30).toFixed(0) + 'px;--s:' + (3 + r() * 3).toFixed(1) + 'px;--dx:' + ((r() - 0.5) * 30).toFixed(0)
          + 'px;--dy:' + (40 + r() * 34).toFixed(0) + 'px;--fd:' + (0.6 + i * 0.04).toFixed(2) + 's;--du:' + (0.6 + r() * 0.25).toFixed(2) + 's"></i>';
      }
      return '<div class="obj o-fro o-fros o-fros-t' + tier + '">'
        + '<div class="o-fro-plate o-fros-plate"><i class="o-fro-cap"></i>'
        + '<div class="o-fro-lbl o-fros-lbl">' + label(d, months > 1 ? 'Resubscribed' : 'New subscriber') + '</div>'
        + nm('o-fro-name o-fros-name', d.username, 12)
        + '<div class="o-fros-meta"><span class="o-fros-tier">Tier ' + tier + '</span><span class="o-fros-mo"><b class="o-fros-mn">' + odo(String(months), 1.0, 0.7) + '</b>' + (months === 1 ? 'month' : 'months') + '</span></div>'
        + (d.message ? '<div class="o-fros-msg">“' + esc(d.message) + '”</div>' : '')
        + '</div>'
        + '<div class="o-fros-orn"><div class="o-fros-sw"><i class="o-fros-str"></i><i class="o-fros-capm"></i>'
        + '<div class="o-fros-ball"><div class="o-fros-skin"><b class="o-fros-num" style="font-size:' + nfs + 'px">' + months + '</b></div><i class="o-fros-shade"></i><i class="o-fros-glint"></i></div>'
        + '</div></div>' + BOUGH + puff + '</div>';
    },
  });

  add({
    id: 'bits-frost', alert: 'bits', fam: 'fro', isNew: true, title: 'Gift stack', amount: 'Grows with the amount',
    desc: 'Wrapped presents drop onto a snowdrift and stack up with a soft bounce, more presents for more bits, and a bow lands on top while the amount counts up.',
    sound: 'froBits', fx: 'none', anim: hold('1.6s'),
    exit: { out: 'froExitSlide', dur: '.42s', ease: 'cubic-bezier(.5,0,.9,.4)' },
    len: function (d) { var c = giftCount(intOf(d.amount != null ? d.amount : d.bits)); return Math.max(1.4, 0.28 + (c - 1) * 0.11 + 0.36 + 0.5); },
    render: function (d) {
      var n = intOf(d.amount != null ? d.amount : d.bits), c = giftCount(n), boxes = '', top = 0, i;
      for (i = 0; i < c; i++) {
        var b = BOXES[i], w = WRAPS[i];
        if (b[1] + b[3] > BOXES[top][1] + BOXES[top][3]) top = i;
        boxes += '<i class="o-frob-box" style="left:' + b[0] + 'px;bottom:' + b[1] + 'px;width:' + b[2] + 'px;height:' + b[3] + 'px;--bx:' + w[0] + ';--rib:' + w[1]
          + (w[2] ? ';--pat:' + w[2] : '') + ';--bd:' + (0.28 + i * 0.11).toFixed(2) + 's"></i>';
      }
      // The bow lands on the highest present; on a gold or white one it is berry red so it still shows.
      var tb = BOXES[top], bowd = 0.28 + (c - 1) * 0.11 + 0.36, berry = top === 3 || top === 4;
      var amt = '+' + fmt(n), afs = amt.length <= 4 ? 42 : amt.length <= 6 ? 36 : amt.length <= 8 ? 30 : 24;
      return '<div class="obj o-fro o-frob">'
        + '<div class="o-fro-plate o-frob-plate"><i class="o-fro-cap"></i>'
        + '<div class="o-fro-lbl o-frob-lbl">' + label(d, 'A gift of bits') + '</div>'
        + '<div class="o-frob-amt"><span class="o-frob-num" style="font-size:' + afs + 'px">' + odo(amt, 0.42, 0.95) + '</span><span class="o-frob-unit">bits</span></div>'
        + nm('o-fro-name o-frob-name', d.username, 11) + '</div>'
        + '<div class="o-frob-pile"><i class="o-frob-drift"></i><i class="o-frob-poof"></i>' + boxes
        + '<div class="o-frob-bow' + (berry ? ' o-frob-bow-b' : '') + '" style="left:' + (tb[0] + tb[2] / 2 - 19) + 'px;bottom:' + (tb[1] + tb[3] - 9) + 'px;--bwd:' + bowd.toFixed(2) + 's">' + BOW + '</div>'
        + '</div></div>';
    },
  });

  add({
    id: 'donation-frost', alert: 'donation', fam: 'fro', isNew: true, title: 'Hot cocoa', amount: 'Grows with the amount',
    desc: 'A glass mug fills with hot cocoa and marshmallows drop in, more for a bigger tip; the steam curls up into the amount, and the message and the name sit on a frosted card beside it.',
    sound: 'froDonation', fx: 'none', anim: hold('1.6s'),
    exit: { out: 'froExitFog', dur: '.45s', ease: 'cubic-bezier(.4,0,.8,.4)' },
    len: 1.7,
    render: function (d) {
      var amt = money(d.amount, d.currency), alen = Array.from(amt).length, afs = alen <= 6 ? 32 : alen === 7 ? 28 : alen === 8 ? 25 : 22;
      var mc = mallowCount(Number(d.amount) || 0), mm = '', i;
      for (i = 0; i < mc; i++) {
        var m = MALLOWS[i];
        mm += '<i class="o-frod-mm" style="left:' + m[0] + 'px;bottom:' + m[1] + 'px;--r:' + m[2] + 'deg;--mc:' + (i % 2 ? '#FFDCEA' : '#EEEAF6') + ';--md:' + (0.9 + i * 0.08).toFixed(2) + 's"></i>';
      }
      return '<div class="obj o-fro o-frod">'
        + '<div class="o-fro-plate o-frod-card"><i class="o-fro-cap"></i>'
        + '<div class="o-fro-lbl o-frod-lbl">' + label(d, 'A warm donation') + '</div>'
        + nm('o-fro-name o-frod-name', d.username, 13)
        + '<div class="o-frod-rule">' + flake('o-frod-rflake', '') + '</div>'
        + (d.message ? '<div class="o-frod-msg">“' + esc(d.message) + '”</div>' : '<div class="o-frod-thanks">Warm thanks!</div>')
        + '</div>'
        + STEAM + '<div class="o-frod-amt" style="font-size:' + afs + 'px">' + esc(amt) + '</div>'
        + '<div class="o-frod-mug">' + CANE + '<i class="o-frod-handle"></i><div class="o-frod-glass"><i class="o-frod-cocoa"></i></div>' + mm + '<i class="o-frod-rim"></i></div>'
        + '</div>';
    },
  });

  add({
    id: 'raid-frost', alert: 'raid', fam: 'fro', isNew: true, title: 'Sleigh parade', amount: 'Grows with the viewers',
    desc: 'A sleigh pulled by a line of reindeer, one per raider up to eight, glides across the moon and leaves a trail of sparkles; then the raider’s name and the number of elves.',
    sound: 'froRaid', fx: 'none', anim: hold('1.6s'),
    exit: { out: 'froExitFly', dur: '.45s', ease: 'cubic-bezier(.5,0,.9,.4)' }, len: 1.7,
    render: function (d) {
      var v = intOf(d.viewers), n = Math.max(1, Math.min(8, v)), t = team(n);
      // The team stops in front of the moon (its centre is at x 284), never past the sky's edges.
      var left = Math.round(Math.max(12, Math.min(420 - 12 - t.W, 284 - t.W / 2 + 30))), top = Math.round(58 - t.H / 2), g = left + t.W + 24;
      var r = rng(hash(d.username + v)), cols = ['#F2C14E', '#FFFFFF', 'var(--froa)'], sp = '', i;
      // The sparkle trail follows the path the sleigh flew in on (it glides up 24px over the whole way), with a
      // slight swoosh, so it stays above the snowy hills; each sparkle lights up as the sleigh passes it.
      var x0 = left - 4, y0 = top + t.sy + 18, x2 = -12, y2 = y0 + 24 * (x0 - x2) / g, x1 = (x0 + x2) / 2, y1 = (y0 + y2) / 2 + 7;
      for (i = 0; i < 10; i++) {
        var f = (i + 0.6) / 10.6, u = 1 - f;
        var x = u * u * x0 + 2 * u * f * x1 + f * f * x2 + (r() - 0.5) * 8, y = u * u * y0 + 2 * u * f * y1 + f * f * y2 + (r() - 0.5) * 10;
        if (x < 4) continue;
        var tau = 1 - Math.pow(Math.max(0, left - x) / g, 1 / 3);
        sp += '<i class="o-fror-sp" style="left:' + x.toFixed(0) + 'px;top:' + y.toFixed(0) + 'px;--ss:' + (5 + r() * 6).toFixed(1) + 'px;--sc:' + cols[i % 3]
          + ';--o:' + (0.95 - f * 0.45).toFixed(2) + ';--sd:' + (0.3 + 1.15 * tau).toFixed(2) + 's"></i>';
      }
      return '<div class="obj o-fro o-fror"><div class="o-fror-sky"><i class="o-fro-stars"></i><i class="o-fror-moon"></i><i class="o-fror-hills"></i>' + sp
        + '<div class="o-fror-team" style="left:' + left + 'px;top:' + top + 'px;--gx:' + (-g) + 'px">' + t.svg + '</div></div>'
        + '<div class="o-fro-plate o-fror-plate"><i class="o-fro-cap"></i><div class="o-fro-lbl o-fror-lbl">' + label(d, 'Here comes a raid!') + '</div>'
        + '<div class="o-fror-line">' + nm('o-fro-name o-fror-name', d.username, 14)
        + '<span class="o-fror-cnt">+<b class="o-fror-cn">' + odo(fmt(v), 0.95, 0.7) + '</b>' + (v === 1 ? 'elf' : 'elves') + '</span></div></div></div>';
    },
  });

  add({
    id: 'giveaway-frost', alert: 'giveaway', fam: 'fro', isNew: true, title: 'Northern lights',
    desc: 'The northern lights ripple across a starry sky over a pine ridge, the winner’s name appears in their light while a few snowflakes drift down, and the prize lands on a frosted panel.',
    sound: 'froGiveaway', fx: 'confetti', anim: hold('1.7s'),
    exit: { out: 'froExitGlow', dur: '.5s', ease: 'ease-in' }, len: 1.75,
    render: function (d) {
      var r = rng(hash(d.username + 'aurora')), fl = '', i;
      // Flakes drift into spots around the edges, away from the name.
      var spots = [[30, 26], [392, 30], [40, 100], [380, 104], [14, 64], [404, 70], [208, 12]];
      for (i = 0; i < spots.length; i++) {
        fl += flake('o-frog-fl', 'left:' + (spots[i][0] + (r() - 0.5) * 14).toFixed(0) + 'px;top:' + (spots[i][1] + (r() - 0.5) * 10).toFixed(0) + 'px;--fs:' + (10 + r() * 8).toFixed(0)
          + 'px;--o:' + (0.6 + r() * 0.3).toFixed(2) + ';--fd:' + (0.3 + i * 0.05).toFixed(2) + 's;--du:' + (1.0 + r() * 0.15).toFixed(2) + 's');
      }
      // Three curtains: [top, height, edge %, wave %, three colours (rgb), opacity, delay]. The green and blue bands are the accent once a colour is picked.
      var aur = [
        ['6px', '96px', 82, 12, 'var(--a-rgb,110,255,190)', 'var(--froa-rgb)', '170,130,255', 0.8, 0.22],
        ['0px', '82px', 76, 14, 'var(--froa-rgb)', '170,130,255', '255,120,200', 0.5, 0.34],
        ['20px', '86px', 86, 9, 'var(--a-rgb,120,255,210)', 'var(--a-rgb,90,200,255)', '160,120,255', 0.6, 0.44],
      ].map(function (a) {
        return '<i class="o-frog-aur" style="top:' + a[0] + ';height:' + a[1] + ';clip-path:' + wave(r, a[2], a[3]) + ';--c1:' + a[4] + ';--c2:' + a[5] + ';--c3:' + a[6] + ';--ao:' + a[7] + ';--ad:' + a[8] + 's"></i>';
      }).join('');
      return '<div class="obj o-fro o-frog"><div class="o-frog-sky"><i class="o-fro-stars"></i><div class="o-frog-aurw">' + aur + '</div>'
        + '<i class="o-frog-ridge" style="clip-path:' + ridge(r) + '"></i><i class="o-frog-snowline"></i><i class="o-frog-halo"></i>'
        + '<div class="o-frog-txt"><div class="o-fro-lbl o-frog-lbl">' + label(d, 'Giveaway winner') + '</div>' + nm('o-fro-name o-frog-name', d.username, 16) + '</div>' + fl + '</div>'
        + (d.prize ? '<div class="o-fro-plate o-frog-prize"><i class="o-fro-cap"></i>' + GIFT + '<span class="o-frog-pl">Prize</span><span class="o-frog-pv">' + esc(d.prize) + '</span></div>' : '')
        + '</div>';
    },
  });
})();
