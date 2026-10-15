/* ═══ Steampunk — brass, iron, copper and steam ═══
   Riveted brass nameplates engraved in Cormorant SC, iron housings with a copper rim, gears that turn
   in mesh and come to rest, a gauge needle that swings and settles, short puffs of steam, typed text in
   Special Elite. Everything private to this family lives inside this function, so its helper names
   cannot collide with another family's. */
(function () {
  FAMS.stm = {
    name: 'Steampunk', order: 16, badge: 'new',
    sw: 'radial-gradient(circle at 34% 32%,#F4D892 0 12%,#C8963E 30% 48%,#B5643C 50% 63%,#1E1B18 65%)',
    desc: 'Brass and gears: turning gears drive out a nameplate, a pressure gauge rises to the months, a coin press mints the bits, a pneumatic tube delivers the message, an airship fleet brings the raid and a clockwork box raises the winner’s name.',
  };

  SOUND_NAMES.stmFollow = 'Ratchet and steam';
  SOUNDS.stmFollow = function () {
    [0.22, 0.38, 0.5, 0.6, 0.68, 0.76, 0.84, 0.93, 1.04].forEach(function (t, i) { noise({ ft: 'bandpass', f: 2600 + (i % 2) * 500, q: 6, d: 0.03, v: 0.18, t: t }); });
    tone({ f: 150, f2: 70, d: 0.16, v: 0.12, t: 1.06 });
    noise({ ft: 'highpass', f: 2800, d: 0.5, v: 0.1, a: 0.04, t: 1.02 });
  };
  SOUND_NAMES.stmSub = 'Steam whistle';
  SOUNDS.stmSub = function () {
    tone({ f: 130, f2: 65, d: 0.18, v: 0.1, t: 0.04 });
    noise({ ft: 'bandpass', f: 500, f2: 1600, q: 1.5, d: 0.8, v: 0.06, a: 0.3, t: 0.45 });
    tone({ f: 1046, f2: 1175, d: 0.62, v: 0.06, type: 'triangle', a: 0.04, t: 1.28 });
    tone({ f: 1318, f2: 1480, d: 0.62, v: 0.045, type: 'triangle', a: 0.04, t: 1.28 });
    noise({ ft: 'highpass', f: 3200, d: 0.6, v: 0.1, a: 0.05, t: 1.28 });
    tone({ f: 1568, d: 0.5, v: 0.04, t: 1.4 });
  };
  SOUND_NAMES.stmBits = 'Coin press';
  SOUNDS.stmBits = function () {
    for (var i = 0; i < 6; i++) {
      var t = 0.43 + i * 0.18;
      tone({ f: 130, f2: 55, d: 0.1, v: 0.11, t: t });
      noise({ ft: 'lowpass', f: 1000, d: 0.04, v: 0.2, t: t });
      tone({ f: 2637 + (i % 2) * 300, d: 0.16, v: 0.035, t: t + 0.1 });
    }
    noise({ ft: 'highpass', f: 2800, d: 0.45, v: 0.1, a: 0.04, t: 1.55 });
  };
  SOUND_NAMES.stmDonation = 'Pneumatic whoosh';
  SOUNDS.stmDonation = function () {
    noise({ ft: 'bandpass', f: 300, f2: 2400, q: 1.2, d: 0.42, v: 0.22, a: 0.25, t: 0.18 });
    tone({ f: 190, f2: 90, d: 0.12, v: 0.1, t: 0.52 });
    noise({ ft: 'highpass', f: 2000, d: 0.16, v: 0.18, t: 0.66 });
    noise({ ft: 'bandpass', f: 1200, q: 0.7, d: 0.55, v: 0.08, a: 0.1, t: 0.74 });
    tone({ f: 1760, d: 0.5, v: 0.05, t: 1.3 });
    tone({ f: 2637, d: 0.35, v: 0.02, t: 1.3 });
  };
  SOUND_NAMES.stmRaid = 'Airship horns';
  SOUNDS.stmRaid = function () {
    noise({ ft: 'lowpass', f: 220, f2: 420, d: 1.3, v: 0.12, a: 0.5, t: 0.35 });
    [[147, 1.0, 0.55], [220, 1.42, 0.7]].forEach(function (h) {
      tone({ f: h[0], d: h[2], v: 0.1, type: 'triangle', a: 0.05, t: h[1] });
      tone({ f: h[0], d: h[2], v: 0.03, type: 'sawtooth', a: 0.05, t: h[1] });
    });
  };
  SOUND_NAMES.stmGiveaway = 'Clockwork and music box';
  SOUNDS.stmGiveaway = function () {
    for (var i = 0; i < 7; i++) noise({ ft: 'bandpass', f: 4200, q: 6, d: 0.02, v: 0.14, t: 0.3 + i * 0.1 });
    noise({ ft: 'bandpass', f: 900, q: 1, d: 0.12, v: 0.12, t: 0.98 });
    [1568, 2093, 2349, 2637, 3136].forEach(function (f, i) { tone({ f: f, d: 0.7, v: 0.05, a: 0.003, t: 1.12 + i * 0.12 }); });
  };

  var EXIT = { out: 'stmExit', dur: '.42s', ease: 'cubic-bezier(.55,0,.75,.35)' };
  var RETRACT = { out: 'stmRetract', dur: '.4s', ease: 'cubic-bezier(.5,0,.8,.4)' };

  function n1(v) { return String(Math.round(v * 10) / 10); }
  function pol(r, deg) { var a = deg * Math.PI / 180; return n1(r * Math.cos(a)) + ' ' + n1(r * Math.sin(a)); }

  // A gear outline centred on 0,0: n teeth on a pitch circle of radius r (gears that mesh share the
  // module 2r/n), the first tooth at ph degrees (screen angles, clockwise), sp spokes cut through the
  // web when there is room, and the axle hole. Each shape is built once.
  var GEARS = {};
  function gearPath(n, r, ph, sp) {
    var key = n + ':' + r.toFixed(2) + ':' + ph.toFixed(1) + ':' + sp;
    if (GEARS[key]) return GEARS[key];
    var m = 2 * r / n, ro = r + 0.9 * m, ri = r - 1.15 * m, P = 360 / n, d = '', k;
    for (k = 0; k < n; k++) {
      var c = ph + k * P;
      d += (k ? 'L' : 'M') + pol(ri, c - 0.27 * P) + 'L' + pol(ro, c - 0.14 * P) + 'L' + pol(ro, c + 0.14 * P) + 'L' + pol(ri, c + 0.27 * P);
    }
    d += 'Z';
    var rim = ri - Math.max(2.4, r * 0.16), hub = Math.max(3.2, r * 0.3), ax = Math.max(1.3, r * 0.09);
    if (sp && rim - hub > 3.4) {
      var w = Math.max(1.4, r * 0.07), wo = Math.asin(w / rim) * 180 / Math.PI, wi = Math.asin(Math.min(0.9, w / hub)) * 180 / Math.PI;
      for (k = 0; k < sp; k++) {
        var a0 = ph + k * 360 / sp, a1 = a0 + 360 / sp;
        d += 'M' + pol(rim, a0 + wo) + 'A' + n1(rim) + ' ' + n1(rim) + ' 0 0 1 ' + pol(rim, a1 - wo)
          + 'L' + pol(hub, a1 - wi) + 'A' + n1(hub) + ' ' + n1(hub) + ' 0 0 0 ' + pol(hub, a0 + wi) + 'Z';
      }
    }
    d += 'M' + n1(ax) + ' 0A' + n1(ax) + ' ' + n1(ax) + ' 0 1 0 ' + n1(-ax) + ' 0A' + n1(ax) + ' ' + n1(ax) + ' 0 1 0 ' + n1(ax) + ' 0Z';
    return (GEARS[key] = d);
  }
  // One gear in its own small SVG, centred on its box so CSS can turn it about the axle.
  // g = { n, r, x, y (the centre in the parent), ph, sp, sa (the angle its spin starts from; it turns back to 0) }.
  function gearSvg(cls, g) {
    var R = Math.ceil(g.r + 2 * g.r / g.n + 1.5), s = 2 * R;
    return '<svg class="o-stm-gear' + (cls ? ' ' + cls : '') + '" viewBox="' + -R + ' ' + -R + ' ' + s + ' ' + s + '" aria-hidden="true" style="left:' + n1(g.x - R) + 'px;top:' + n1(g.y - R) + 'px;width:' + s + 'px;height:' + s + 'px;--sa:' + n1(g.sa || 0) + 'deg">'
      + '<path class="o-stm-teeth" fill-rule="evenodd" d="' + gearPath(g.n, g.r, g.ph || 0, g.sp || 0) + '"/>'
      + '<circle class="o-stm-hubring" r="' + n1(Math.max(3.2, g.r * 0.3)) + '"/></svg>';
  }
  // The gear that meshes with gear a: n teeth, its centre at deg degrees from a's centre, phased so each
  // tooth sits in a gap of the other, and turning the other way, faster or slower by the tooth ratio.
  function meshWith(a, n, deg, sp) {
    var r = a.r * n / a.n, t = deg * Math.PI / 180;
    return {
      n: n, r: r, sp: sp, x: a.x + (a.r + r) * Math.cos(t), y: a.y + (a.r + r) * Math.sin(t),
      ph: deg + 180 - (a.n / n) * ((a.ph || 0) - deg) - 180 / n, sa: -(a.sa || 0) * a.n / n,
    };
  }
  // A short puff of steam from one point: soft clouds that swell, drift and fade (each [dx, dy, delay, size]).
  function puffs(x, y, list) {
    return '<div class="o-stm-puffs" style="left:' + x + 'px;top:' + y + 'px">' + list.map(function (p) {
      return '<i style="--px:' + p[0] + 'px;--py:' + p[1] + 'px;--pd:' + p[2] + 's;--ps:' + p[3] + 'px"></i>';
    }).join('') + '</div>';
  }
  function glint(at) { return '<i class="o-stm-glint" style="--gd:' + at + 's"></i>'; }

  /* follow — Gear engage */
  var FOLLOW_GEARS = (function () {
    var a = { n: 14, r: 34, x: 54, y: 66, ph: 0, sp: 5, sa: -250 };
    return gearSvg('', a) + gearSvg('o-stm-gcu', meshWith(a, 9, -48, 4)) + gearSvg('o-stm-gdk', meshWith(a, 8, 150, 4));
  })();
  add({
    id: 'follow-steampunk', alert: 'follow', fam: 'stm', isNew: true, title: 'Gear engage',
    desc: 'Three gears spin up in mesh and drive a brass nameplate out of its slot; it locks with a puff of steam and “joined the guild” is typed under the name.',
    sound: 'stmFollow', fx: 'none', anim: hold('1.6s'), exit: RETRACT, len: 1.6,
    render: function (d) {
      var t = typed('joined the guild', 1.08, 0.03, 40);
      return '<div class="obj o-stm o-stmf">'
        + '<div class="o-stmf-track"><div class="o-stm-plate o-stmf-plate">' + glint(1.45)
        + '<div class="o-stm-kick">' + label(d, 'New follower') + '</div>' + nm('o-stm-name o-stmf-name', d.username, 12)
        + '<div class="o-stm-type o-stmf-line o-typed" style="' + t.style + '">' + t.html + '</div></div></div>'
        + '<div class="o-stm-iron o-stmf-box">' + FOLLOW_GEARS + '<i class="o-stmf-slot"></i></div>'
        + puffs(126, 22, [[16, -16, 1.0, 20], [26, -8, 1.06, 16], [6, -22, 1.12, 22]])
        + '</div>';
    },
  });

  /* subscriber — Pressure gauge. The dial reads 0 to 24 months on a square-root scale, so one month
     already lifts the needle; past 24 it rests against the stop pin. */
  function gaugeAngle(m) { return -120 + 240 * Math.sqrt(Math.max(0, Math.min(24, m)) / 24); }
  var DIAL = (function () {
    function at(deg, r) { var a = (deg - 90) * Math.PI / 180; return [n1(r * Math.cos(a)), n1(r * Math.sin(a))]; }
    var r0 = at(gaugeAngle(18), 58.5), r1 = at(gaugeAngle(24), 58.5), pin = at(128, 51);
    var s = '<svg class="o-stms-dial" viewBox="-69 -69 138 138" aria-hidden="true"><path class="o-stms-red" d="M' + r0[0] + ' ' + r0[1] + 'A58.5 58.5 0 0 1 ' + r1[0] + ' ' + r1[1] + '"/>';
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 18, 21, 24].forEach(function (m) {
      var major = [0, 1, 3, 6, 12, 24].indexOf(m) >= 0, g = gaugeAngle(m), a = at(g, major ? 50 : 54), b = at(g, 61);
      s += '<line class="' + (major ? 'o-stms-mj' : 'o-stms-mn') + '" x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '"/>';
      if (major) { var l = at(g, 41); s += '<text class="o-stms-num" x="' + l[0] + '" y="' + l[1] + '">' + m + '</text>'; }
    });
    return s + '<circle class="o-stms-pin" cx="' + pin[0] + '" cy="' + pin[1] + '" r="2.4"/><text class="o-stms-unit" x="0" y="47">MONTHS</text></svg>';
  })();
  add({
    id: 'subscriber-steampunk', alert: 'subscription', fam: 'stm', isNew: true, title: 'Pressure gauge', amount: 'Months on the gauge',
    desc: 'A brass pressure gauge bolts on and its needle rises to the months; at the top the valve whistles a puff of steam and the tier lights one, two or three rivet lamps.',
    sound: 'stmSub', fx: 'smoke', anim: hold('1.8s'), exit: EXIT, len: 1.85,
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), tier = Math.max(1, Math.min(3, intOf(d.tier) || 1)), pinned = months > 24, lamps = '';
      for (var i = 0; i < 3; i++) lamps += '<i class="o-stms-lamp' + (i < tier ? ' o-stms-on' : '') + '" style="--ld:' + (1.36 + i * 0.12).toFixed(2) + 's"></i>';
      var heading = months > 1 ? 'Resubscribed · ' + months + ' months' : 'New subscriber';
      return '<div class="obj o-stm o-stms' + (pinned ? ' o-stms-pinned' : '') + '" style="--ang:' + n1(pinned ? 125 : gaugeAngle(months)) + 'deg">'
        + '<div class="o-stm-plate o-stms-plate">' + glint(1.62)
        + '<div class="o-stm-kick o-stms-kick">' + label(d, heading) + '</div>' + nm('o-stm-name o-stms-name', d.username, 11)
        + '<div class="o-stms-tier"><span class="o-stm-type">Tier ' + tier + '</span>' + lamps + '</div>'
        + (d.message ? '<div class="o-stm-type o-stms-msg">' + esc(d.message) + '</div>' : '') + '</div>'
        + '<div class="o-stms-valve"><i class="o-stms-pipe"></i><i class="o-stms-whistle"></i></div>'
        + puffs(146, 22, [[14, -18, 1.3, 22], [26, -10, 1.36, 18], [4, -24, 1.44, 24], [30, -22, 1.52, 20]])
        + '<div class="o-stms-gauge"><div class="o-stms-face">' + DIAL
        + '<div class="o-stms-win">' + odo(String(months).padStart(2, '0'), 0.5, 0.85) + '</div>'
        + '<div class="o-stms-needle"><svg viewBox="0 0 10 72" aria-hidden="true"><path class="o-stms-nb" d="M5 1L6.7 50L6 70H4L3.3 50Z"/><path class="o-stms-nt" d="M5 1L6 22H4Z"/></svg></div>'
        + '<i class="o-stms-hub"></i></div></div></div>';
    },
  });

  /* bits — Coin press. 50 bits strike 3 coins, 500 strike 6, 10,000 strike 10; the strokes speed up so
     the whole run takes about a second. */
  function coinPlan(d) {
    var n = intOf(d.amount != null ? d.amount : d.bits), N = Math.max(2, Math.min(10, Math.round(3 * Math.log10(n + 1) - 2)));
    return { n: n, N: N, T: Math.min(0.22, 1.1 / N), S: 0.36 };
  }
  add({
    id: 'bits-steampunk', alert: 'bits', fam: 'stm', isNew: true, title: 'Coin press', amount: 'Grows with the amount',
    desc: 'A steam press stamps one coin per stroke, more coins for more bits; each coin hops onto the stacks beside it while the counter rolls to the amount.',
    sound: 'stmBits', fx: 'sparks', anim: hold('1.6s'), exit: EXIT,
    len: function (d) { var c = coinPlan(d); return c.S + c.N * c.T + 0.5; },
    render: function (d) {
      var c = coinPlan(d), n = c.n, N = c.N, T = c.T, S = c.S, end = S + N * T, coins = '', i;
      for (i = 0; i < N; i++) {
        var cx = 150 + Math.floor(i / 4) * 44, top = 138 - (i % 4) * 5;
        coins += '<i class="o-stmb-coin" style="left:' + (cx - 15) + 'px;top:' + top + 'px;--fx:' + (63 - cx) + 'px;--fy:' + (120 - top) + 'px;--cd:' + (S + (i + 0.38) * T).toFixed(2) + 's"></i>';
      }
      var a = { n: 12, r: 17, x: 40, y: 30, ph: 0, sp: 4, sa: -60 * N };
      return '<div class="obj o-stm o-stmb">'
        + '<div class="o-stm-plate o-stmb-plate">' + glint((end + 0.15).toFixed(2))
        + '<div class="o-stm-kick">' + label(d, 'Freshly minted') + '</div>'
        + '<div class="o-stmb-row"><span class="o-stmb-ctr">' + odo(fmt(n), S, Math.max(0.8, N * T + 0.3).toFixed(2)) + '</span><span class="o-stmb-unit">' + (n === 1 ? 'bit' : 'bits') + '</span></div>'
        + nm('o-stm-name o-stmb-name', d.username, 14) + '</div>'
        + '<div class="o-stmb-press" style="--rt:' + T.toFixed(3) + 's;--rs:' + S + 's;--rn:' + N + ';--gu:' + (N * T).toFixed(2) + 's">'
        + '<i class="o-stmb-ram"></i><i class="o-stmb-col o-stmb-l"></i><i class="o-stmb-col o-stmb-r"></i><i class="o-stmb-beam"></i>'
        + gearSvg('', a) + gearSvg('o-stm-gcu', meshWith(a, 8, -8, 0))
        + '<i class="o-stmb-anvil"></i><i class="o-stmb-flash"></i><i class="o-stmb-base"></i></div>'
        + '<i class="o-stmb-tray"></i>' + coins
        + puffs(112, 16, [[10, -14, (end + 0.02).toFixed(2), 20], [20, -6, (end + 0.08).toFixed(2), 16], [4, -20, (end + 0.14).toFixed(2), 20]])
        + '</div>';
    },
  });

  /* donation — Pneumatic tube. The message is typed once the scroll is open: at most about a second
     of typing, however long the message. */
  function scrollPlan(d) {
    var text = d.message ? '“' + d.message + '”' : '', count = Array.from(text).length, per = count ? Math.min(0.028, 1 / count) : 0;
    return { text: text, count: count, per: per, end: count ? 1.15 + Math.min(120, count) * per : 1.3 };
  }
  add({
    id: 'donation-steampunk', alert: 'donation', fam: 'stm', isNew: true, title: 'Pneumatic tube',
    desc: 'A brass capsule shoots up a glass tube and pops open; a paper scroll signed by the donor unrolls, the message is typed onto it and the amount swings in on a brass tag.',
    sound: 'stmDonation', fx: 'none', anim: hold('1.6s'), exit: RETRACT,
    len: function (d) { var s = scrollPlan(d); return s.count ? s.end + 0.4 : 1.75; },
    render: function (d) {
      var s = scrollPlan(d), t = typed(s.text, 1.15, s.per, 120), amt = money(d.amount, d.currency);
      return '<div class="obj o-stm o-stmd' + (t.n ? '' : ' o-stmd-nomsg') + '">'
        + '<div class="o-stmd-paper"><div class="o-stmd-kick">' + label(d, 'Special delivery') + '</div>'
        + (t.n ? '<div class="o-stm-type o-stmd-msg o-typed" style="' + t.style + '">' + t.html + '</div>' : '')
        + '<div class="o-stmd-from"><span class="o-stmd-by">from</span>' + nm('o-stmd-name', d.username, t.n ? 16 : 12) + '</div></div>'
        + '<i class="o-stmd-roll"></i>'
        + '<div class="o-stmd-tag"><span class="o-stmd-amt" style="' + fitStyle(amt, 7) + '">' + esc(amt) + '</span></div>'
        + '<div class="o-stmd-tube"><i class="o-stmd-glass"></i><div class="o-stmd-caps"><i class="o-stmd-lid"></i></div><i class="o-stmd-shine"></i>'
        + '<i class="o-stmd-tcap"></i><i class="o-stmd-clamp"></i><i class="o-stmd-bcap"></i></div>'
        + puffs(50, 36, [[18, -10, 0.68, 20], [30, 2, 0.72, 18], [10, -22, 0.76, 22]])
        + '</div>';
    },
  });

  /* raid — Airship fleet. Six berths in the porthole's sky: [centre x, centre y, scale]. The flagship
     (the first berth) arrives last; past six raiders a far-off fleet fills the horizon. */
  var FLEET = [[240, 50, 1], [140, 30, 0.74], [320, 28, 0.62], [84, 60, 0.68], [182, 80, 0.56], [42, 30, 0.54]];
  var FLEET_COLS = ['var(--stma)', '#B5643C', '#D8C7A3', 'var(--stma)', '#8E5A3A', '#D8C7A3'];
  var SHIP = '<svg viewBox="0 0 64 34" aria-hidden="true">'
    + '<path class="o-stmr-fin" d="M15 8L3 1.5L6 13L3 24.5L15 18Z"/>'
    + '<path class="o-stmr-rig" d="M28 22.5L31.5 27.5M46 22.5L42.5 27.5"/>'
    + '<path class="o-stmr-gon" d="M29 27H45L43 32H31Z"/>'
    + '<path class="o-stmr-env" d="M11 13C11 6.5 22 2 37 2C52 2 62.5 7 63 13C62.5 19 52 24 37 24C22 24 11 19.5 11 13Z"/>'
    + '<path class="o-stmr-seam" d="M24 3.6C21.5 9 21.5 17 24 22.4M37 2V24M50 3.2C52.5 9 52.5 17 50 22.8M11.5 13H62.5"/>'
    + '<path class="o-stmr-hi" d="M21 6.2C29 3.8 45 3.8 55 7"/>'
    + '<circle class="o-stmr-lit" cx="34.5" cy="29.5" r="1.1"/><circle class="o-stmr-lit" cx="39.5" cy="29.5" r="1.1"/></svg>';
  function fleetPlan(d) { var v = intOf(d.viewers), n = Math.max(1, Math.min(6, v)); return { v: v, n: n, end: 0.6 + (n - 1) * 0.08 + 0.85 }; }
  add({
    id: 'raid-steampunk', alert: 'raid', fam: 'stm', isNew: true, title: 'Airship fleet', amount: 'Grows with the viewers',
    desc: 'A brass porthole’s shutters open on a sunset sky and small airships sail in, one per raider up to six, with a far-off fleet behind them for bigger raids.',
    sound: 'stmRaid', fx: 'none', anim: hold('1.6s'), exit: EXIT,
    len: function (d) { return fleetPlan(d).end; },
    render: function (d) {
      var f = fleetPlan(d), v = f.v, ships = '', far = '', i;
      for (i = 0; i < f.n; i++) {
        var p = FLEET[i], s = p[2], sd = 0.6 + (i === 0 ? f.n - 1 : i - 1) * 0.08, su = 0.8 + (1 - s) * 0.3;
        ships += '<div class="o-stmr-ship" style="left:' + n1(p[0] - 32 * s) + 'px;top:' + n1(p[1] - 17 * s) + 'px;width:' + n1(64 * s) + 'px;height:' + n1(34 * s) + 'px;--c:' + FLEET_COLS[i] + ';--sd:' + sd.toFixed(2) + 's;--su:' + su.toFixed(2) + 's">'
          + '<div class="o-stmr-bob">' + SHIP + '<i class="o-stmr-prop"></i></div></div>';
      }
      var extra = v > 6 ? Math.min(12, Math.round(4 * Math.log10(v / 6) + 2)) : 0, r = rng(hash(d.username + v));
      for (i = 0; i < extra; i++) far += '<i class="o-stmr-far" style="left:' + (22 + r() * 328).toFixed(0) + 'px;top:' + (54 + r() * 20).toFixed(0) + 'px;--fd:' + (1.2 + i * 0.04).toFixed(2) + 's"></i>';
      return '<div class="obj o-stm o-stmr"><div class="o-stmr-port"><div class="o-stmr-sky">' + far
        + '<i class="o-stmr-cloud" style="left:-24px;top:68px;width:170px;height:60px"></i><i class="o-stmr-cloud" style="left:118px;top:76px;width:190px;height:56px"></i>'
        + '<i class="o-stmr-cloud" style="left:262px;top:64px;width:150px;height:60px"></i><i class="o-stmr-cloud" style="left:268px;top:-6px;width:90px;height:34px;opacity:.75"></i>'
        + ships + '<i class="o-stmr-sht"></i><i class="o-stmr-shb"></i></div></div>'
        + '<div class="o-stm-plate o-stmr-plate">' + glint(1.75)
        + '<div class="o-stm-kick">' + label(d, 'Raid incoming') + '</div>'
        + '<div class="o-stmr-who">' + nm('o-stm-name o-stmr-name', d.username, 12) + '<span class="o-stmr-sfx">’s fleet</span></div>'
        + '<div class="o-stm-type o-stmr-count"><span class="o-stmr-num">' + odo(fmt(v), 0.7, 1.0) + '</span><span>aboard</span></div></div>'
        + '</div>';
    },
  });

  /* giveaway — Clockwork box. The whole box drops in (the root's entrance), then its works run. */
  var BOX_GEARS = (function () {
    var a = { n: 10, r: 13, x: 16, y: 31, ph: 0, sp: 4, sa: -320 };
    return gearSvg('', a) + gearSvg('o-stm-gcu', meshWith(a, 7, -50, 0));
  })();
  var BALANCE = '<svg class="o-stmg-bal" viewBox="-20 -20 40 40" aria-hidden="true"><circle class="o-stmg-bring" r="15"/><path class="o-stmg-bspk" d="M0-15V15M-13 7.5L13-7.5M-13-7.5L13 7.5"/><circle class="o-stmg-bhub" r="3.2"/></svg>';
  var SPARKS = [[52, 14, 12, 1.62], [358, 24, 10, 1.7], [64, 86, 9, 1.78], [346, 84, 13, 1.86]];
  add({
    id: 'giveaway-steampunk', alert: 'giveaway', fam: 'stm', isNew: true, title: 'Clockwork box',
    desc: 'A clockwork box lands and its gears and balance wheel tick; the lid swings open and a glowing brass nameplate rises out with the winner’s name, the prize engraved on the box below.',
    sound: 'stmGiveaway', fx: 'champagne', anim: { in: 'stmDrop', dur: '.38s', ease: 'cubic-bezier(.3,.7,.4,1)' }, exit: EXIT, len: 1.95,
    render: function (d) {
      var sparks = SPARKS.map(function (s) { return '<i class="o-stmg-spark" style="left:' + s[0] + 'px;top:' + s[1] + 'px;--ss:' + s[2] + 'px;--sd:' + s[3] + 's"></i>'; }).join('');
      return '<div class="obj o-stm o-stmg"><i class="o-stmg-glow"></i><i class="o-stmg-lidin"></i><i class="o-stmg-lidedge"></i>'
        + '<div class="o-stmg-rise"><div class="o-stm-plate o-stmg-plate">' + glint(1.72)
        + '<div class="o-stm-kick">' + label(d, 'Giveaway winner') + '</div>' + nm('o-stm-name o-stmg-name', d.username, 12) + '</div></div>'
        + '<div class="o-stmg-box"><div class="o-stmg-win o-stmg-wl">' + BOX_GEARS + '</div>'
        + '<div class="o-stm-plate o-stmg-prize"><span class="o-stmg-pk">' + (d.prize ? 'Prize' : 'Giveaway') + '</span><span class="o-stmg-pv">' + esc(d.prize || 'Congratulations') + '</span></div>'
        + '<div class="o-stmg-win o-stmg-wr">' + BALANCE + '</div></div>'
        + '<i class="o-stmg-key"></i>' + sparks + '</div>';
    },
  });
})();
