/* ═══ Neon Sign — night-time neon on a dark brick wall ═══
   Glass tubes that flicker on with a buzz (a couple of quick on/off steps, then steady) and bulbs that
   chase once, on signs bolted to a brick wall: an open sign, a motel sign, a diner counter, a billboard,
   a street of little signs and a theatre marquee. Monoton for the block tubes, Neonderthaw for the cursive
   tubes, Tilt Neon for everything else. The accent is the tube colour (and the bulbs' glow); the wall, the
   metal, the mounts and the wires stay neutral. Everything private to this family lives inside this
   function, so its helper names cannot collide with another family's. */
(function () {
  FAMS.neo = {
    name: 'Neon Sign', order: 18, badge: 'new',
    sw: 'radial-gradient(circle at 50% 50%,#FFFFFF 0 9%,#FF2BD6 24%,rgba(255,43,214,.35) 42%,#2A1C1E 60%)',
    desc: 'Neon signs on a brick wall at night: an open sign flickers on for follows, a motel sign for subs, a diner counter for bits, a billboard for donations, a street of little signs for raids and a theatre marquee for the giveaway winner.',
  };

  /* ── Sounds: the transformer hum, the tick-buzz of a tube striking, bulb clicks, a bell ── */
  function tick(t, f, v) { noise({ ft: 'highpass', f: f, q: 0.8, d: 0.03, v: v, t: t }); }
  function zap(t, d, v) {
    tone({ f: 118, type: 'sawtooth', d: d, v: v, a: 0.004, t: t });
    tone({ f: 236, type: 'square', d: d * 0.8, v: v * 0.35, a: 0.004, t: t });
  }
  // A tube lighting the way neoFlick draws it: on, off, on, off, then steady (dur = the CSS duration).
  function flicker(t0, dur, v) {
    tick(t0 + 0.1 * dur, 3600, v); zap(t0 + 0.1 * dur, 0.05, 0.035);
    tick(t0 + 0.34 * dur, 3200, v); zap(t0 + 0.34 * dur, 0.05, 0.035);
    tick(t0 + 0.52 * dur, 2800, v); zap(t0 + 0.52 * dur, 0.24, 0.04);
  }
  function hum(t, d, v) { engine({ f: 59, f2: 61, d: d, v: v, t: t }); }
  function chase(t0, n, step, f0, f1) {
    for (var i = 0; i < n; i++) tone({ f: f0 + (f1 - f0) * i / Math.max(1, n - 1), d: 0.035, v: 0.028, type: 'square', t: t0 + i * step });
  }
  function ding(t, f, v) { tone({ f: f, d: 1.1, v: v, a: 0.003, t: t }); tone({ f: f * 2.4, d: 0.5, v: v * 0.3, a: 0.003, t: t }); }

  SOUND_NAMES.neoFollow = 'Neon buzz';
  SOUNDS.neoFollow = function () {
    hum(0.26, 1.3, 0.024);
    flicker(0.26, 0.5, 0.12);                                   // NEW FOLLOWER
    flicker(0.6, 0.5, 0.12);                                    // the name
    [1.08, 1.34].forEach(function (t) {                         // the arrow blinks once
      tick(t, 4400, 0.09);
      tone({ f: 1320, d: 0.05, v: 0.03, type: 'square', t: t });
    });
  };
  SOUND_NAMES.neoSub = 'Bulb chase and buzz';
  SOUNDS.neoSub = function () {
    hum(0.3, 1.5, 0.022);
    chase(0.3, 14, 0.044, 1300, 2300);                          // the bulbs chase round once
    flicker(0.5, 0.5, 0.1);                                     // MONTH and the months
    flicker(0.8, 0.5, 0.07);                                    // the label box
    flicker(1.02, 0.5, 0.12);                                   // the name
    ding(1.36, 1760, 0.05);                                     // a star lights on top
    tone({ f: 2637, d: 0.4, v: 0.02, t: 1.42 });
  };
  SOUND_NAMES.neoBits = 'Bulbs and a diner bell';
  SOUNDS.neoBits = function () {
    hum(0.22, 1.4, 0.022);
    flicker(0.22, 0.5, 0.08);                                   // the tab
    flicker(0.34, 0.45, 0.1);                                   // the amount
    chase(0.45, 12, 0.062, 1100, 2200);                         // the bulbs light round the counter
    ding(1.24, 2093, 0.07);                                     // order up
    ding(1.24, 2637, 0.025);
  };
  SOUND_NAMES.neoDonation = 'Breaker, buzz and light box';
  SOUNDS.neoDonation = function () {
    noise({ ft: 'lowpass', f: 420, d: 0.12, v: 0.22, t: 0.2 });   // the breaker
    tone({ f: 90, f2: 60, d: 0.14, v: 0.08, t: 0.2 });
    hum(0.24, 1.75, 0.022);
    for (var i = 0; i < 6; i++) {                                  // the frame, section by section
      var t = 0.28 + i * 0.07 + 0.072;
      tick(t, 2800 + i * 260, 0.1);
      zap(t, 0.05, 0.03);
    }
    flicker(0.74, 0.45, 0.1);                                      // the amount
    noise({ ft: 'bandpass', f: 5200, f2: 2600, q: 1.5, d: 0.42, v: 0.05, a: 0.05, t: 0.98 });   // signed
    [1.49, 1.63, 1.73].forEach(function (s) {                     // the light box: tink, tink, on
      tick(s, 5600, 0.08);
      tone({ f: 4400, d: 0.03, v: 0.02, t: s });
    });
  };
  SOUND_NAMES.neoRaid = 'A street of buzzes';
  SOUNDS.neoRaid = function () {
    hum(0.26, 1.6, 0.024);
    flicker(0.26, 0.5, 0.11);                                      // the crew's name
    for (var i = 0; i < 10; i++) {                                 // sign after sign
      var t = 0.62 + i * 0.085 + 0.04;
      tick(t, 2400 + (i % 4) * 520, 0.11);
      zap(t, 0.06, 0.028);
    }
  };
  SOUND_NAMES.neoGiveaway = 'Marquee chase and ta-da';
  SOUNDS.neoGiveaway = function () {
    hum(0.28, 1.6, 0.02);
    flicker(0.28, 0.5, 0.11);                                      // WINNER
    chase(0.36, 16, 0.054, 1200, 2400);                            // the bulbs run round the marquee
    for (var i = 0; i < 6; i++) noise({ ft: 'bandpass', f: 1700 + i * 140, q: 4, d: 0.035, v: 0.16, t: 0.94 + i * 0.07 });   // letters on the board
    [523, 659, 784].forEach(function (f, k) { tone({ f: f, d: 0.16, v: 0.06, type: 'triangle', t: 1.42 + k * 0.1 }); });
    [523, 659, 784, 1047].forEach(function (f) { tone({ f: f, d: 0.9, v: 0.035, type: 'triangle', t: 1.72 }); });
  };

  /* ── Shared pieces ── */
  // The whole sign fades up with its wall, then the tubes strike; it leaves by sputtering out.
  var ON = { in: 'neoOn', dur: '.26s', ease: 'ease-out' };
  var OFF = { out: 'neoExit', dur: '.42s', ease: 'linear' };
  function n1(x) { return String(Math.round(x * 10) / 10); }
  // A glass tube: the coloured glass (wide stroke in the accent) with its hot core (thin pale stroke) on top.
  function tubes(d) { return '<path class="o-neo-tg" d="' + d + '"/><path class="o-neo-tc" d="' + d + '"/>'; }
  function sign(cls, vb, d, style) {
    return '<svg class="o-neo-ico ' + cls + '" viewBox="' + vb + '"' + (style ? ' style="' + style + '"' : '') + ' aria-hidden="true">' + tubes(d) + '</svg>';
  }
  // One bulb, centred on p = [x, y]; a lit one pops on at `delay` (the chase).
  function bulb(p, on, delay) {
    return '<i class="o-neo-bulb ' + (on ? 'on' : 'off') + '" style="left:' + n1(p[0]) + 'px;top:' + n1(p[1]) + 'px;--bd:' + delay.toFixed(3) + 's"></i>';
  }
  // A rounded tube frame that wraps whatever box it sits in.
  var FRAME = '<svg class="o-neo-ico o-neo-frame" aria-hidden="true"><rect class="o-neo-tg" width="100%" height="100%" rx="7"/><rect class="o-neo-tc" width="100%" height="100%" rx="7"/></svg>';
  function tierOf(d) {
    var t = String(d.tier || '1');
    if (/^[123]000$/.test(t)) t = t.charAt(0);
    return t === '3' ? 3 : t === '2' ? 2 : 1;
  }

  /* ── follow — Open sign ── */
  var ARROW = 'M4 12.5H38V5L61.5 18L38 31V23.5H4Z';
  // The power cable from the arrow's tail, down and out of the bottom of the wall.
  var WIRE = '<svg class="o-neof-wire" viewBox="0 0 60 128" aria-hidden="true"><path class="o-neo-cable" d="M22 85C19 100 33 110 28 130"/></svg>';

  add({
    id: 'follow-neon', alert: 'follow', fam: 'neo', isNew: true, title: 'Open sign',
    desc: 'A neon sign on a brick wall flickers on in two parts: NEW FOLLOWER in block tubes, then the name in cursive tube lettering, and a little arrow sign blinks once.',
    sound: 'neoFollow', fx: 'none', anim: ON, exit: OFF, len: 1.5,
    render: function (d) {
      var head = d && d.label ? d.label : 'New follower';
      return '<div class="obj o-neo o-neof"><div class="o-neo-wall"><i class="o-neo-spill o-neof-spill"></i>' + WIRE
        + sign('o-neof-arrow', '0 0 66 36', ARROW)
        + '<div class="o-neof-lbl o-neo-tube o-neo-mono o-neo-clip" style="' + fitStyle(head, 17) + '">' + label(d, 'New follower') + '</div>'
        + nm('o-neof-name o-neo-tube o-neo-script o-neo-nm', d.username, 10)
        + '</div></div>';
    },
  });

  /* ── subscription — Motel sign ── */
  var STAR = 'M12 2.2L14.8 8.7L21.8 9.3L16.5 14L18.1 20.9L12 17.3L5.9 20.9L7.5 14L2.2 9.3L9.2 8.7Z';
  // Bulbs round a rectangle, a bulb on every corner: nw gaps across, nh down, clockwise from the top left.
  function rectBulbs(x0, y0, w, h, nw, nh) {
    var out = [], i;
    for (i = 0; i < nw; i++) out.push([x0 + i * w / nw, y0]);
    for (i = 0; i < nh; i++) out.push([x0 + w, y0 + i * h / nh]);
    for (i = 0; i < nw; i++) out.push([x0 + w - i * w / nw, y0 + h]);
    for (i = 0; i < nh; i++) out.push([x0, y0 + h - i * h / nh]);
    return out;
  }
  var MOTEL = rectBulbs(10, 10, 108, 130, 6, 7);

  add({
    id: 'subscriber-neon', alert: 'subscription', fam: 'neo', isNew: true, title: 'Motel sign', amount: 'Months on the sign',
    desc: 'A tall motel sign lights up: its bulb border chases round once, MONTH flickers on while the months roll up, the name lights in cursive tube and the tier lights as one to three stars on top.',
    sound: 'neoSub', fx: 'none', anim: ON, exit: OFF,
    len: function (d) { return 1.54 + tierOf(d) * 0.12; },
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), tier = tierOf(d), digits = String(months).length;
      var heading = months > 1 ? 'Resubscribed' : 'New subscriber', head = d && d.label ? d.label : heading;
      var size = digits <= 1 ? 72 : digits === 2 ? 64 : digits === 3 ? 46 : 36;
      var bulbs = MOTEL.map(function (p, i) { return bulb(p, true, 0.3 + i * 0.022); }).join(''), stars = '';
      for (var s = 0; s < 3; s++) stars += sign('o-neos-star ' + (s < tier ? 'on' : 'off'), '0 0 24 24', STAR, '--sd:' + (1.3 + s * 0.12).toFixed(2) + 's');
      return '<div class="obj o-neo o-neos"><div class="o-neo-wall"><i class="o-neo-spill o-neos-spill"></i>'
        + '<div class="o-neos-stars"><i class="o-neos-rail"></i>' + stars + '</div>'
        + '<div class="o-neo-board o-neos-sign">' + bulbs
        + '<div class="o-neos-word o-neo-tube o-neo-mono">Month</div>'
        + '<div class="o-neos-num o-neo-num" style="top:' + n1(88 - 0.519 * size) + 'px;font-size:' + size + 'px">' + odo(String(months), 0.62, 0.62) + '</div></div>'
        + '<div class="o-neos-box">' + FRAME + '<div class="o-neos-lbl o-neo-tube o-neo-clip" style="' + fitStyle(head, 20) + '">' + label(d, heading) + '</div></div>'
        + nm('o-neos-name o-neo-tube o-neo-script o-neo-nm', d.username, 8)
        + '<div class="o-neos-tier">Tier ' + tier + ' subscriber</div>'
        + (d.message ? '<div class="o-neos-msg">“' + esc(d.message) + '”</div>' : '')
        + '</div></div>';
    },
  });

  /* ── bits — Diner counter ── */
  // n points spaced evenly round the counter's rounded ends (a stadium shape, in the sign's 400 × 132 box),
  // clockwise from the top centre, so the lit bulbs read like a gauge filling up.
  function stadium(n) {
    var R = 55, L = 268, cy = 66, arc = Math.PI * R, P = 2 * L + 2 * arc, out = [];
    for (var i = 0; i < n; i++) {
      var s = i * P / n, a;
      if (s < L / 2) out.push([200 + s, cy - R]);
      else if (s < L / 2 + arc) { a = -Math.PI / 2 + (s - L / 2) / R; out.push([334 + R * Math.cos(a), cy + R * Math.sin(a)]); }
      else if (s < 1.5 * L + arc) out.push([334 - (s - L / 2 - arc), cy + R]);
      else if (s < 1.5 * L + 2 * arc) { a = Math.PI / 2 + (s - 1.5 * L - arc) / R; out.push([66 + R * Math.cos(a), cy + R * Math.sin(a)]); }
      else out.push([66 + (s - 1.5 * L - 2 * arc), cy - R]);
    }
    return out;
  }
  var DINER = stadium(34);
  // How far round the bulbs light: 50 bits about 40 %, 500 about two thirds, 10,000 all the way (then they blink twice).
  function counter(n) {
    var N = DINER.length, lit = Math.max(3, Math.min(N, Math.round(N * Math.log10(n + 1) / 4)));
    var step = Math.min(0.032, 0.72 / lit), end = 0.45 + (lit - 1) * step + 0.24;
    return { lit: lit, step: step, end: end, full: lit === N, len: end + (lit === N ? 0.5 : 0.3) };
  }

  add({
    id: 'bits-neon', alert: 'bits', fam: 'neo', isNew: true, title: 'Diner counter', amount: 'Grows with the amount',
    desc: 'A diner counter sign lights up: the amount rolls up in neon digits while the bulb border lights further round for more bits, all the way round from 10,000; then the name lights.',
    sound: 'neoBits', fx: 'sparks', anim: ON, exit: OFF,
    len: function (d) { return counter(intOf(d.amount != null ? d.amount : d.bits)).len; },
    render: function (d) {
      var n = intOf(d.amount != null ? d.amount : d.bits), c = counter(n), txt = fmt(n), head = d && d.label ? d.label : 'Cheers!';
      var size = txt.length <= 3 ? 54 : txt.length <= 5 ? 48 : 42;
      var bulbs = DINER.map(function (p, i) { return bulb(p, i < c.lit, 0.45 + i * c.step); }).join('');
      return '<div class="obj o-neo o-neob' + (c.full ? ' full' : '') + '" style="--fl:' + (c.end + 0.06).toFixed(2) + 's;--wd:' + (c.end - 0.14).toFixed(2) + 's">'
        + '<div class="o-neo-wall"><i class="o-neo-spill o-neob-spill"></i>'
        + '<div class="o-neo-board o-neob-sign">' + bulbs
        + '<div class="o-neob-amt"><span class="o-neob-num o-neo-num" style="font-size:' + size + 'px">+' + odo(txt, 0.42, Math.max(0.5, c.end - 0.56)) + '</span>'
        + '<span class="o-neob-unit o-neo-tube o-neo-script" style="margin-bottom:' + n1(0.141 * size - 5) + 'px">' + (n === 1 ? 'bit' : 'bits') + '</span></div>'
        + '<div class="o-neob-who"><span class="o-neob-from">from</span>' + nm('o-neob-name o-neo-tube o-neo-nm', d.username, 16) + '</div></div>'
        + '<div class="o-neo-board o-neob-tab"><div class="o-neob-lbl o-neo-tube o-neo-mono o-neo-clip" style="' + fitStyle(head, 9) + '">' + label(d, 'Cheers!') + '</div></div>'
        + '</div></div>';
    },
  });

  /* ── donation — Billboard ── */
  // The frame's six tubes, in the board's 396 × 132 box, in the order they light: clockwise from the top left.
  var SEGS = [
    'left:14px;top:7px;width:180px;height:5px', 'left:202px;top:7px;width:180px;height:5px', 'left:384px;top:14px;width:5px;height:104px',
    'left:202px;top:120px;width:180px;height:5px', 'left:14px;top:120px;width:180px;height:5px', 'left:7px;top:14px;width:5px;height:104px',
  ];
  var SWOOSH = '<svg class="o-neo-ico o-neod-swoosh" viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden="true">'
    + '<path class="o-neo-tg" vector-effect="non-scaling-stroke" d="M4 9C40 3 72 12 110 7S172 4 196 8"/><path class="o-neo-tc" vector-effect="non-scaling-stroke" d="M4 9C40 3 72 12 110 7S172 4 196 8"/></svg>';

  add({
    id: 'donation-neon', alert: 'donation', fam: 'neo', isNew: true, title: 'Billboard',
    desc: 'A billboard’s neon frame lights section by section and the amount flickers on in big neon digits; the donor signs it in cursive tube, and the message lights up on a light box below.',
    sound: 'neoDonation', fx: 'none', anim: ON, exit: OFF,
    len: function (d) { return d.message ? 1.9 : 1.62; },
    render: function (d) {
      var amt = money(d.amount, d.currency), al = Array.from(amt).length, size = al <= 6 ? 52 : al === 7 ? 48 : al === 8 ? 44 : 38;
      var head = d && d.label ? d.label : 'Thank you';
      var segs = SEGS.map(function (s, i) { return '<i class="o-neo-bar o-neod-seg" style="' + s + ';--gd:' + (0.28 + i * 0.07).toFixed(2) + 's"></i>'; }).join('');
      return '<div class="obj o-neo o-neod' + (d.message ? '' : ' nomsg') + '"><div class="o-neo-wall"><i class="o-neo-spill o-neod-spill"></i>'
        + (d.message ? '<i class="o-neod-rod l"></i><i class="o-neod-rod r"></i>' : '')
        + '<div class="o-neo-board o-neod-board">' + segs
        + '<div class="o-neod-tagrow"><div class="o-neod-tag"><div class="o-neod-lbl o-neo-tube o-neo-mono o-neo-clip" style="' + fitStyle(head, 15) + '">' + label(d, 'Thank you') + '</div></div></div>'
        + '<div class="o-neod-amt o-neo-num" style="font-size:' + size + 'px">' + odo(amt, 0.78, 0.6) + '</div>'
        + '<div class="o-neod-sig"><span class="o-neod-from">from</span><div class="o-neod-sw">' + nm('o-neod-name o-neo-tube o-neo-script o-neo-nm', d.username, 13) + SWOOSH + '</div></div></div>'
        + (d.message ? '<div class="o-neod-box"><div class="o-neod-face"><div class="o-neod-msg">' + esc(d.message) + '</div></div></div>' : '')
        + '</div></div>';
    },
  });

  /* ── raid — Street of signs ── */
  // Ten little shop signs, each a different simple shape (40 × 40).
  var SHAPES = [
    'M20 4L24.2 15.2L36.2 15.7L26.8 23.2L30 34.8L20 28.2L10 34.8L13.2 23.2L3.8 15.7L15.8 15.2Z',                                       // star
    'M20 34C9 26 4 19.5 4 13.5C4 8.5 7.8 5 12.3 5C15.6 5 18.4 6.8 20 9.8C21.6 6.8 24.4 5 27.7 5C32.2 5 36 8.5 36 13.5C36 19.5 31 26 20 34Z', // heart
    'M24 3L9 22.5H19.5L15.5 37L31.5 16.5H21L24 3Z',                                                                                       // bolt
    'M24 5.5A15 15 0 1 0 24 34.5A16 16 0 0 1 24 5.5Z',                                                                                    // moon
    'M8 16H28V25C28 31 24 34 18 34C12 34 8 31 8 25ZM28 19C33 19 34.5 21 34.5 23C34.5 25.5 32 27 28 27M14 11C12.5 9 15.5 7.5 14 4.5M21 11C19.5 9 22.5 7.5 21 4.5', // cup
    'M19.2 28.8V5C24 8 31 9.5 30 17.5M9 31.2C8.4 28.3 11.6 25.6 15.2 25.6C18.2 25.6 19.6 27.3 19.2 29C18.6 31.8 15.3 34.2 12.2 34.2C10.4 34.2 9.3 33 9 31.2Z', // note
    'M11.2 19.5C9.8 10.5 14.5 5 20 5S30.2 10.5 28.8 19.5ZM12.5 19.5L20 37L27.5 19.5M15.5 26L24.5 22',                                    // ice cream
    'M12 7H28L35 16L20 35L5 16ZM5 16H35M14 16L20 35L26 16',                                                                               // gem
    'M6 30L4 12L13 20L20 7L27 20L36 12L34 30ZM8 35H32',                                                                                   // crown
    'M4 14.5H22V7L36 20L22 33V25.5H4Z',                                                                                                   // arrow
  ];
  // One sign per raider up to ten, spread along the street; fewer raiders get bigger signs.
  function street(v) {
    var n = Math.min(v, 10), sp = n > 1 ? Math.min(66, 344 / (n - 1)) : 0, s = n <= 5 ? 48 : n <= 7 ? 44 : n <= 8 ? 40 : 36;
    return { n: n, sp: sp, s: s, st: 0.085, len: Math.max(1.3, 0.62 + Math.max(0, n - 1) * 0.085 + 0.42) };
  }

  add({
    id: 'raid-neon', alert: 'raid', fam: 'neo', isNew: true, title: 'Street of signs', amount: 'Grows with the viewers',
    desc: 'A row of little neon signs flickers on one by one down the street, one per raider up to ten and each a different shape, above the raider’s crew and the head count.',
    sound: 'neoRaid', fx: 'none', anim: ON, exit: OFF,
    len: function (d) { return street(intOf(d.viewers)).len; },
    render: function (d) {
      var v = intOf(d.viewers), q = street(v), r = rng(hash(d.username + v)), k0 = Math.floor(r() * SHAPES.length), signs = '';
      for (var i = 0; i < q.n; i++) {
        var cx = 210 + (i - (q.n - 1) / 2) * q.sp, cy = 54 + (r() - 0.5) * 22, rot = (r() - 0.5) * 16;
        signs += sign('o-neor-sign', '0 0 40 40', SHAPES[(k0 + i) % SHAPES.length], 'left:' + n1(cx - q.s / 2) + 'px;top:' + n1(cy - q.s / 2) + 'px;width:' + q.s
          + 'px;height:' + q.s + 'px;transform:rotate(' + n1(rot) + 'deg);--sd:' + (0.62 + i * q.st).toFixed(3) + 's');
      }
      return '<div class="obj o-neo o-neor"><div class="o-neo-wall"><i class="o-neo-spill o-neor-spill"></i>' + signs
        + '<div class="o-neo-board o-neor-plate">'
        + nm('o-neor-name o-neo-tube o-neo-script o-neo-nm', d.username + '’s crew', 17)
        + '<div class="o-neor-info"><span class="o-neor-lbl o-neo-clip">' + label(d, 'is here') + '</span><i class="o-neor-dot"></i>'
        + '<b class="o-neor-num o-neo-num">' + odo(fmt(v), 0.56, Math.max(0.5, (q.n - 1) * q.st + 0.3)) + '</b><span class="o-neor-unit">' + (v === 1 ? 'raider' : 'raiders') + '</span></div>'
        + '</div></div></div>';
    },
  });

  /* ── giveaway — Marquee ── */
  // The marquee's bulbs: four rows of 19px bulbs, lit in turn by a stepped wipe (one bulb per step).
  function strip(side) { return '<i class="o-neo-strip o-neog-s ' + side + '"><i class="o-neo-lit"></i></i>'; }

  add({
    id: 'giveaway-neon', alert: 'giveaway', fam: 'neo', isNew: true, title: 'Marquee',
    desc: 'A theatre marquee lights up: WINNER flickers on in tubes, the bulbs chase once round the frame and the winner’s name goes up on the letter board one letter at a time; the prize lights up on a light box below.',
    sound: 'neoGiveaway', fx: 'confetti', anim: ON, exit: OFF,
    len: function (d) { return d.prize ? 1.8 : 1.56; },
    render: function (d) {
      var head = d && d.label ? d.label : 'Winner', count = Math.min(20, Array.from(String(d.username || '')).length);
      var t = typed(d.username, 0.92, Math.min(0.045, 0.42 / Math.max(1, count)), 20);
      return '<div class="obj o-neo o-neog' + (d.prize ? '' : ' nopz') + '"><div class="o-neo-wall"><i class="o-neo-spill o-neog-spill"></i>'
        + '<div class="o-neo-board o-neog-mq">' + strip('t') + strip('r') + strip('b') + strip('l')
        + '<div class="o-neog-face"><div class="o-neog-row">Giveaway</div>'
        + '<div class="o-neog-name o-typed" style="' + fitStyle(d.username, 15) + t.style + '">' + t.html + '</div></div></div>'
        + '<div class="o-neo-board o-neog-crest"><div class="o-neog-lbl o-neo-tube o-neo-mono o-neo-clip" style="' + fitStyle(head, 8) + '">' + label(d, 'Winner') + '</div></div>'
        + (d.prize ? '<div class="o-neog-pzrow"><div class="o-neog-pz"><div class="o-neog-pzf"><span class="o-neog-pk">Prize</span><b class="o-neog-pv">' + esc(d.prize) + '</b></div></div></div>' : '')
        + '</div></div>';
    },
  });
})();
