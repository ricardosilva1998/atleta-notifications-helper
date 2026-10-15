/* ═══ Deep Sea — under the sea: navy water, light rays from above, rising bubbles, glowing sea life ═══
   The accent is the bioluminescence and each look's hero: the bubble and its fish, the pearl, the school,
   the bottle glass, the dolphins and the jellyfish, plus the rim glow of every panel and the labels.
   Motion is buoyant: things rise or drift down, overshoot a little and settle, then hold still.
   Everything private to this family lives inside this function, so its helper names cannot collide
   with another family's. */
(function () {
  FAMS.sea = {
    name: 'Deep Sea', order: 19, badge: 'new',
    sw: 'radial-gradient(circle at 50% 72%,#3EF0D0 0 20%,#0C3A5C 52%,#041A30 82%)',
    desc: 'Under the sea: a bubble pops into the follower’s name, a clam opens on a glowing pearl, a school of fish swirls round the bits, a message in a bottle brings the donation, a pod of dolphins leaps in for raids and jellyfish light up the giveaway winner.',
  };

  /* ── Sounds: bubbles, water and soft chimes, timed to the animations ── */
  SOUND_NAMES.seaFollow = 'Bubbles and a pop';
  SOUNDS.seaFollow = function () {
    [0.06, 0.17, 0.27, 0.37, 0.46].forEach(function (t, i) { tone({ f: 320 + i * 60, f2: 720 + i * 110, d: 0.07, v: 0.045, t: t }); });   // the bubble rises
    noise({ ft: 'highpass', f: 2400, d: 0.05, v: 0.22, t: 0.6 });                                                                          // and pops
    tone({ f: 880, f2: 1760, d: 0.08, v: 0.07, t: 0.6 });
    [1.04, 1.14].forEach(function (t) { noise({ ft: 'bandpass', f: 700, f2: 2400, q: 1.6, d: 0.2, v: 0.08, a: 0.03, t: t }); });         // two fish dart past
  };
  SOUND_NAMES.seaSub = 'Clam and shimmer';
  SOUNDS.seaSub = function () {
    noise({ ft: 'lowpass', f: 420, d: 0.2, v: 0.16, a: 0.03, t: 0.52 });                                                                  // the shell opens
    tone({ f: 150, f2: 105, d: 0.32, v: 0.07, type: 'triangle', t: 0.52 });
    [1319, 1760, 2093, 2637].forEach(function (f, i) { tone({ f: f, d: 0.8, v: 0.04, t: 0.78 + i * 0.07 }); });                           // the pearl glows
    [1.16, 1.29, 1.42].forEach(function (t, i) { tone({ f: 2349 + i * 290, d: 0.22, v: 0.028, type: 'triangle', t: t }); });             // starfish light up
  };
  SOUND_NAMES.seaBits = 'Swirling school';
  SOUNDS.seaBits = function () {
    noise({ ft: 'bandpass', f: 280, f2: 1300, q: 0.9, d: 0.95, v: 0.12, a: 0.25, t: 0.15 });                                              // the water swirls
    for (var i = 0; i < 6; i++) tone({ f: 1100 + i * 130, f2: 1500 + i * 150, d: 0.05, v: 0.03, t: 0.42 + i * 0.13 });                    // little fins flick
    [784, 1175, 1568].forEach(function (f, i) { tone({ f: f, d: 0.6, v: 0.045, t: 1.32 + i * 0.06 }); });                                  // the school settles
  };
  SOUND_NAMES.seaDonation = 'Cork pop and scroll';
  SOUNDS.seaDonation = function () {
    noise({ ft: 'lowpass', f: 650, f2: 260, d: 0.6, v: 0.08, a: 0.18, t: 0.1 });                                                          // the bottle sinks
    tone({ f: 2350, d: 0.2, v: 0.035, type: 'triangle', t: 0.78 });                                                                       // glass on sand
    noise({ ft: 'highpass', f: 2600, d: 0.04, v: 0.22, t: 0.9 });                                                                         // the cork pops
    tone({ f: 520, f2: 1240, d: 0.08, v: 0.08, t: 0.9 });
    [0.95, 1.03, 1.1].forEach(function (t, i) { tone({ f: 480 + i * 90, f2: 980 + i * 150, d: 0.06, v: 0.04, t: t }); });                 // bubbles
    noise({ ft: 'bandpass', f: 1900, f2: 900, q: 0.8, d: 0.5, v: 0.07, a: 0.06, t: 1.22 });                                               // the scroll unrolls
    tone({ f: 1047, d: 0.5, v: 0.04, type: 'triangle', t: 1.74 });
    tone({ f: 1568, d: 0.6, v: 0.03, type: 'triangle', t: 1.82 });
  };
  SOUND_NAMES.seaRaid = 'Dolphin calls and splashes';
  SOUNDS.seaRaid = function () {
    tone({ f: 1700, f2: 3100, d: 0.16, v: 0.04, t: 0.28 });                                                                                // a whistle
    tone({ f: 3000, f2: 1900, d: 0.14, v: 0.035, t: 0.46 });
    for (var i = 0; i < 6; i++) noise({ ft: 'bandpass', f: 1500, f2: 500, q: 0.8, d: 0.24, v: 0.15, t: 0.9 + i * 0.1 });                 // splashes, one after another
    tone({ f: 2200, f2: 3300, d: 0.12, v: 0.035, t: 1.62 });
  };
  SOUND_NAMES.seaGiveaway = 'Jellyfish glow';
  SOUNDS.seaGiveaway = function () {
    [220, 330].forEach(function (f) { tone({ f: f, d: 1.1, v: 0.045, a: 0.45, t: 0.08 }); });                                              // a deep hum as they rise
    tone({ f: 175, f2: 118, d: 0.4, v: 0.08, t: 1.02 });                                                                                  // the pulse
    [1047, 1319, 1568, 2093].forEach(function (f, i) { tone({ f: f, d: 0.85, v: 0.04, t: 1.1 + i * 0.08 }); });                           // the name glows
    tone({ f: 620, f2: 1240, d: 0.08, v: 0.05, t: 1.4 });                                                                                 // the shell tag
  };

  /* ── Exits: float up and dissolve, sink into the dark, drift off with the current ── */
  var EXIT_FLOAT = { out: 'seaFloatOut', dur: '.45s', ease: 'cubic-bezier(.4,0,.8,.5)' };
  var EXIT_SINK = { out: 'seaSinkOut', dur: '.45s', ease: 'cubic-bezier(.5,0,.85,.4)' };
  var EXIT_DRIFT = { out: 'seaDriftOut', dur: '.5s', ease: 'cubic-bezier(.45,0,.8,.45)' };

  /* ── Drawing helpers (short SVG paths, no ids, so any number of tiles can show the same look) ── */
  function n1(x) { return String(Math.round(x * 10) / 10); }
  function oval(x, y, rx, ry) {
    var w = n1(2 * rx);
    return 'M' + n1(x - rx) + ' ' + n1(y) + 'a' + n1(rx) + ' ' + n1(ry) + ' 0 1 0 ' + w + ' 0a' + n1(rx) + ' ' + n1(ry) + ' 0 1 0 -' + w + ' 0Z';
  }
  function circ(x, y, r) { return oval(x, y, r, r); }
  // A scallop fan from the hinge (hx, hy) with radii (rx, ry), between the angles a0 and a1 (degrees,
  // 0 = right, 90 = down), with k scallops bulging out by `bump` (a share of the radius). Outline and ribs.
  function fan(hx, hy, rx, ry, a0, a1, k, bump) {
    function pt(a, s) { var t = a * Math.PI / 180; return [hx + rx * s * Math.cos(t), hy + ry * s * Math.sin(t)]; }
    var p = pt(a0, 1), out = 'M' + n1(hx) + ' ' + n1(hy) + 'L' + n1(p[0]) + ' ' + n1(p[1]), ribs = '';
    for (var i = 0; i < k; i++) {
      var am = a0 + (a1 - a0) * (i + 0.5) / k, c = pt(am, 1 + bump), e = pt(a0 + (a1 - a0) * (i + 1) / k, 1), m = pt(am, 0.94);
      out += 'Q' + n1(c[0]) + ' ' + n1(c[1]) + ' ' + n1(e[0]) + ' ' + n1(e[1]);
      ribs += 'M' + n1(hx) + ' ' + n1(hy) + 'L' + n1(m[0]) + ' ' + n1(m[1]);
    }
    return { outline: out + 'Z', ribs: ribs };
  }
  // Rising bubbles, each [x, y, size, drift, rise, delay, duration] in px and seconds: they rise once and are gone.
  function bubbles(list) {
    return list.map(function (b) {
      return '<i class="o-sea-bub" style="left:' + n1(b[0]) + 'px;top:' + n1(b[1]) + 'px;--bs:' + b[2] + 'px;--bx:' + b[3] + 'px;--by:' + (-b[4]) + 'px;--bd:' + b[5].toFixed(2) + 's;--bu:' + b[6].toFixed(2) + 's"></i>';
    }).join('');
  }
  // Bubbles that stay where they are, each [x, y, size].
  function orbs(list) {
    return list.map(function (b) { return '<i class="o-sea-orb" style="left:' + b[0] + 'px;top:' + b[1] + 'px;--bs:' + b[2] + 'px"></i>'; }).join('');
  }
  function tierOf(d) {
    var t = String(d.tier || '1');
    if (/^[123]000$/.test(t)) t = t.charAt(0);
    return /^[123]$/.test(t) ? Number(t) : 1;
  }

  // A little fish facing right (32 × 18): the accent body, a light belly, a fin and an eye.
  var FISH = '<svg viewBox="0 0 32 18" aria-hidden="true">'
    + '<path class="o-sea-fb" d="M8.5 9L1 2.8L3.4 9L1 15.2ZM6.8 9C9.6 3.6 15.4 1.6 21 2.2C26 2.8 29.6 5.6 31.2 9C29.6 12.4 26 15.2 21 15.8C15.4 16.4 9.6 14.4 6.8 9Z"/>'
    + '<path class="o-sea-fl" d="M10 10.2C14 13.6 20.5 14.4 26 12.6C24 14.6 20 15.6 16.5 15C13.6 14.6 11.4 12.8 10 10.2Z"/>'
    + '<path class="o-sea-fd" d="M17 9.6L20.6 12.8L15.4 12.4Z"/>'
    + '<circle class="o-sea-fe" cx="25.4" cy="7.8" r="1.6"/><circle class="o-sea-fg" cx="25.9" cy="7.3" r=".55"/></svg>';
  // A dolphin facing right (64 × 28): a round melon and a short beak with a smile, the dorsal fin, flukes and a
  // flipper; a darker back and a light belly.
  var DOLPHIN = '<svg viewBox="0 0 64 28" aria-hidden="true">'
    + '<path class="o-sea-fb" d="M62.6 15.6C61.6 15 60.4 14.6 59 14.4C58 11.6 55.6 8.8 51 7.8C46.6 6.8 42 6.2 38.4 6.4C36.6 4 34.8 2 32.4 .8C33.2 3 33.2 5.4 31.4 7.6'
    + 'C24.6 9 17.4 11.2 11 13.6L6.8 14.3C5 12.3 3 10.4 .6 9.2C2.2 11.4 3.4 13.2 4.4 14.9C3.2 16.6 2 18.6 .8 20.6C3 19.6 5 17.6 6.8 15.7'
    + 'C12 17 17.6 18.8 24 20.2C29 21.2 34 21.6 39.6 21.3C38.6 23.2 37.6 25.2 36.4 26.8C39.4 25.8 41.8 23.4 43.6 20.9C48.6 20.4 53.4 19 57.6 17.2C59.6 16.8 61.4 16.3 62.6 15.6Z"/>'
    + '<path class="o-sea-fd" d="M51 7.8C45 6.4 38.4 6.2 31.4 7.6C24.6 9 17.4 11.2 11 13.6C17.6 12.4 25 11 32 10.2C39 9.4 45 9 51 7.8Z"/>'
    + '<path class="o-sea-fl" d="M57.4 17.3C53 19 48 20.2 43.6 20.9C36 21.9 27.6 21.2 20 19.3C27 19.7 35 19.6 42 18.6C47.6 17.9 53 17.6 57.4 17.3Z"/>'
    + '<path class="o-sea-fm" d="M62.2 15.7Q60 16.1 57.9 15.3"/><circle class="o-sea-fe" cx="54.2" cy="12.6" r="1.15"/></svg>';

  /* ── follow — Bubble up ── */
  add({
    id: 'follow-deepsea', alert: 'follow', fam: 'sea', isNew: true, title: 'Bubble up',
    desc: 'A bubble rises from the deep and grows, then pops into a glowing plate with the name. Two little fish dart in and stop to look.',
    sound: 'seaFollow', fx: 'none', anim: hold('1.5s'), exit: EXIT_FLOAT, len: 1.65,
    render: function (d) {
      var drops = '';
      for (var k = 0; k < 7; k++) {
        var a = (k * 360 / 7 + 14) * Math.PI / 180;
        drops += '<i class="o-seaf-drop" style="--dx:' + n1(Math.cos(a) * 50) + 'px;--dy:' + n1(Math.sin(a) * 34) + 'px"></i>';
      }
      return '<div class="obj o-sea o-seaf"><div class="o-sea-water o-seaf-plate"><i class="o-seaf-shine"></i>'
        + orbs([[352, 50, 15], [371, 68, 9], [349, 79, 6]])
        + '<div class="o-seaf-txt"><div class="o-sea-tag o-seaf-tag">' + label(d, 'New follower') + '</div>'
        + nm('o-seaf-name o-sea-name', d.username, 14)
        + '<div class="o-sea-cap o-seaf-cap">Welcome to the deep!</div></div></div>'
        + '<div class="o-seaf-bw"><div class="o-seaf-bubble"></div></div><i class="o-seaf-ring"></i>' + drops
        + '<i class="o-sea-fish o-seaf-fish a">' + FISH + '</i><i class="o-sea-fish o-seaf-fish b">' + FISH + '</i></div>';
    },
  });

  /* ── subscriber — Pearl ── */
  var LID = (function () {
    var f = fan(66, 82, 70, 70, -160, -20, 7, 0.09);
    return '<svg viewBox="0 0 132 84" aria-hidden="true"><path class="o-seas-lf" d="' + f.outline + '"/><path class="o-seas-lr" d="' + f.ribs + '"/></svg>';
  })();
  // The lower shell: the scalloped outside with its ribs, the pearly inside behind the front lip, and the lip
  // catching the pearl's light.
  var BOWL = (function () {
    var f = fan(75, 6, 73, 44, 8, 172, 8, 0.07);
    return '<svg viewBox="0 0 150 56" aria-hidden="true"><path class="o-seas-bo" d="' + f.outline + '"/><path class="o-seas-br" d="' + f.ribs + '"/>'
      + '<path class="o-seas-bi" d="M2.7 12.1L75 6L147.3 12.1Q75 32 2.7 12.1Z"/><path class="o-seas-bl" d="M5 13Q75 31 145 13"/></svg>';
  })();
  var STAR = (function () {
    var d = '';
    for (var i = 0; i < 10; i++) {
      var r = i % 2 ? 4.2 : 9.6, a = (-90 + i * 36) * Math.PI / 180;
      d += (i ? 'L' : 'M') + n1(12 + r * Math.cos(a)) + ' ' + n1(12.6 + r * Math.sin(a));
    }
    return d + 'Z';
  })();
  var STAR_DOTS = (function () {
    var d = circ(12, 12.6, 1);
    for (var i = 0; i < 5; i++) { var a = (-90 + i * 72) * Math.PI / 180; d += circ(12 + 5.4 * Math.cos(a), 12.6 + 5.4 * Math.sin(a), 0.85); }
    return d;
  })();
  function starTimes(tier) { return { last: 1.16 + (tier - 1) * 0.13 }; }

  add({
    id: 'subscriber-deepsea', alert: 'subscription', fam: 'sea', isNew: true, title: 'Pearl', amount: 'Months on the pearl',
    desc: 'A clam on the sea floor opens on a glowing pearl engraved with the months. Starfish light up in the sand for the tier: one, two or three.',
    sound: 'seaSub', fx: 'none', anim: hold('1.6s'), exit: EXIT_SINK,
    len: function (d) { return Math.max(1.7, starTimes(tierOf(d)).last + 0.45); },
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), tier = tierOf(d), digits = String(months).length, stars = '';
      for (var i = 0; i < 3; i++) {
        var on = i < tier;
        stars += '<i class="o-seas-star' + (on ? ' on' : '') + '" style="--sr:' + [-12, 8, -4][i] + 'deg' + (on ? ';--sd:' + (1.16 + i * 0.13).toFixed(2) + 's' : '') + '">'
          + '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="o-seas-stp" d="' + STAR + '"/>'
          + (on ? '<path class="o-seas-stl" d="' + STAR + '"/><path class="o-seas-std" d="' + STAR_DOTS + '"/>' : '') + '</svg></i>';
      }
      var heading = months > 1 ? 'Resubscribed' : 'New subscriber';
      return '<div class="obj o-sea o-seas"><div class="o-sea-water o-seas-water"><i class="o-sea-floor o-seas-floor"></i>'
        + '<div class="o-seas-clam"><div class="o-seas-lid">' + LID + '</div><i class="o-seas-glow"></i>'
        + '<div class="o-seas-pearl"><b class="o-seas-num" style="font-size:' + (digits <= 1 ? 32 : digits === 2 ? 28 : 21) + 'px">' + odo(String(months), 0.86, 0.75) + '</b></div>'
        + '<div class="o-seas-bowl">' + BOWL + '</div></div>'
        + '<div class="o-seas-txt"><div class="o-sea-tag o-seas-tag">' + label(d, heading) + '</div>'
        + nm('o-seas-name o-sea-name', d.username, 11)
        + '<div class="o-seas-mo">' + (months > 1 ? '<b class="o-seas-mn">' + fmt(months) + '</b> months · thank you!' : 'First month · welcome!') + '</div>'
        + (d.message ? '<div class="o-seas-msg">“' + esc(d.message) + '”</div>' : '') + '</div>'
        + '<div class="o-seas-tier">' + stars + '<span class="o-seas-tl">Tier ' + tier + '</span></div>'
        + '</div></div>';
    },
  });

  /* ── bits — School of fish ── */
  // The ring the school settles on, in the panel (412 × 156): round the amount and clear of the text, which
  // stays inside it (the label and the "from" line are at most 176px wide).
  var RING = { cx: 206, cy: 80, rx: 176, ry: 66 };
  var SWIRL_T = [0, 0.2, 0.4, 0.6, 0.8, 1];
  // 50 bits → 6 fish, 500 → 12, 10,000 → 20 (never fewer than 4 or more than 24).
  function schoolPlan(n) {
    var count = Math.max(4, Math.min(24, Math.round(6 * Math.log10(n + 1) - 4.3))), st = Math.min(0.045, 0.55 / count);
    return { count: count, st: st, len: 0.15 + (count - 1) * st + 0.95 + 0.12 };
  }
  // Where a fish is at progress p (0..1) of its swim: it trails 200° behind its spot and starts on a ring
  // almost twice as wide (out of sight), so the school spirals in clockwise and slows as it arrives.
  function swirlAt(af, ff, p) {
    var q = Math.max(0, 1 - p), a = (af - 200 * q) * Math.PI / 180, f = ff * (1 + 0.9 * Math.pow(q, 1.4));
    return [RING.cx + RING.rx * f * Math.cos(a), RING.cy + RING.ry * f * Math.sin(a)];
  }
  function school(n, seed) {
    var plan = schoolPlan(n), r = rng(seed), c = plan.count, a0 = r() * 360, gap = 360 / c;
    var base = c <= 8 ? 24 : c <= 14 ? 21 : 18, html = '';
    for (var i = 0; i < c; i++) {
      var af = a0 + i * gap + (r() - 0.5) * gap * 0.4, ff = 1 + (r() - 0.5) * 0.06, w = base * (0.88 + r() * 0.24), h = w * 0.5625;
      var vars = '', prev = null;
      SWIRL_T.forEach(function (t, k) {
        var p = 1 - Math.pow(1 - t, 2.2), pos = swirlAt(af, ff, p);
        var from = swirlAt(af, ff, Math.max(0, p - 0.02)), to = swirlAt(af, ff, Math.min(1, p + 0.02));
        var hd = Math.atan2(to[1] - from[1], to[0] - from[0]) * 180 / Math.PI;
        if (prev !== null) { while (hd - prev > 180) hd -= 360; while (hd - prev < -180) hd += 360; }
        prev = hd;
        vars += '--x' + k + ':' + n1(pos[0]) + 'px;--y' + k + ':' + n1(pos[1]) + 'px;--r' + k + ':' + Math.round(hd) + 'deg;';
      });
      // The fish furthest round the ring sets off first, so the school streams in as one ribbon.
      html += '<i class="o-sea-fish o-seab-fish" style="width:' + n1(w) + 'px;height:' + n1(h) + 'px;margin:' + n1(-h / 2) + 'px 0 0 ' + n1(-w / 2) + 'px;'
        + vars + '--fd:' + (0.15 + (c - 1 - i) * plan.st).toFixed(3) + 's">' + FISH + '</i>';
    }
    return html;
  }

  add({
    id: 'bits-deepsea', alert: 'bits', fam: 'sea', isNew: true, title: 'School of fish', amount: 'Grows with the amount',
    desc: 'A school of glowing fish swirls in from the open water, more fish for more bits, and settles in a ring round the amount as it counts up.',
    sound: 'seaBits', fx: 'none', anim: hold('1.5s'), exit: EXIT_SINK,
    len: function (d) { return Math.max(1.5, schoolPlan(intOf(d.amount != null ? d.amount : d.bits)).len); },
    render: function (d) {
      var n = intOf(d.amount != null ? d.amount : d.bits);
      var wem = 0.55 + Array.from(fmt(n)).reduce(function (w, c) { return w + (c === ',' ? 0.26 : 0.57); }, 0) + 0.8;
      var size = Math.max(26, Math.min(46, Math.floor(200 / wem)));
      return '<div class="obj o-sea o-seab"><div class="o-sea-water o-seab-water"><i class="o-seab-halo"></i>' + school(n, hash(d.username + n))
        + '<div class="o-seab-txt"><div class="o-sea-tag o-seab-tag">' + label(d, 'Thank you!') + '</div>'
        + '<div class="o-seab-amt" style="font-size:' + size + 'px"><span class="o-seab-plus">+</span>' + odo(fmt(n), 0.5, 0.9) + '<span class="o-seab-unit">bits</span></div>'
        + '<div class="o-seab-from"><span class="o-sea-cap">from</span>' + nm('o-seab-name o-sea-name', d.username, 11) + '</div></div></div></div>';
    },
  });

  /* ── donation — Message in a bottle ── */
  // The bottle (56 × 124, neck up) settles at 32°; its neck then ends at NECK in the panel.
  var NECK = [91, 74];
  var BOTTLE = '<svg viewBox="0 0 56 124" aria-hidden="true">'
    + '<g class="o-sead-inner"><rect class="o-sead-pp" x="17" y="66" width="22" height="44" rx="4"/><path class="o-sead-pln" d="M21 74H35M21 80H33M21 86H35M21 92H31M21 98H34"/></g>'
    + '<path class="o-sead-glass" d="M22.5 12H33.5V35C33.5 41 49.5 45.5 49.5 57V111C49.5 116.5 45.5 120 40.5 120H15.5C10.5 120 6.5 116.5 6.5 111V57C6.5 45.5 22.5 41 22.5 35Z"/>'
    + '<path class="o-sead-shade" d="M39.5 50C44.5 53 46.5 56 46.5 62V110C46.5 114 44 116.5 40.5 117H37C40.5 115.5 42.5 113 42.5 109V63C42.5 57.5 41.5 54 39.5 50Z"/>'
    + '<path class="o-sead-hi" d="M11.5 64V106"/><path class="o-sead-hi2" d="M26 15V31M12.5 112Q14 115.6 18 116.4"/>'
    + '<rect class="o-sead-lip" x="20.5" y="8" width="15" height="5.5" rx="2"/></svg>';

  add({
    id: 'donation-deepsea', alert: 'donation', fam: 'sea', isNew: true, title: 'Message in a bottle',
    desc: 'A bottle drifts down and settles on the sand. The cork pops in a burst of bubbles and the scroll inside unrolls with the amount, the message and the donor’s name.',
    sound: 'seaDonation', fx: 'none', anim: hold('1.6s'), exit: EXIT_DRIFT, len: 1.85,
    render: function (d) {
      var amt = money(d.amount, d.currency), al = Array.from(amt).length, fs = al <= 6 ? 26 : al === 7 ? 24 : al === 8 ? 22 : 19;
      var body = d.message
        ? '<div class="o-sead-msg">“' + esc(d.message) + '”</div><div class="o-sead-sign"><span class="o-sead-from">from</span>' + nm('o-sead-name', d.username, 15) + '</div>'
        : '<div class="o-sead-sign solo"><span class="o-sead-from">from</span>' + nm('o-sead-name', d.username, 12) + '</div><div class="o-sead-sent">sent a tip from the deep</div>';
      return '<div class="obj o-sea o-sead"><div class="o-sea-water o-sead-water"><i class="o-sea-floor o-sead-floor"></i>'
        + '<div class="o-sead-bw"><div class="o-sead-bottle">' + BOTTLE + '<i class="o-sead-cork"></i></div></div>'
        + bubbles([[NECK[0], NECK[1], 7, -5, 52, 0.92, 0.85], [NECK[0] + 5, NECK[1] + 4, 5, 6, 44, 0.98, 0.8], [NECK[0] - 3, NECK[1] + 6, 4, -8, 36, 1.04, 0.75]])
        + '<div class="o-sead-scroll"><div class="o-sead-sheet"><div class="o-sead-head">' + label(d, 'Message in a bottle') + '</div>'
        + '<div class="o-sead-amtw"><b class="o-sead-amt" style="font-size:' + fs + 'px">' + esc(amt) + '</b></div>' + body + '</div>'
        + '<i class="o-sead-rod l"></i><i class="o-sead-rod r"></i></div>'
        + '</div></div>';
    },
  });

  /* ── raid — Pod ── */
  // One dolphin per raider up to eight, in two rows, the leader in front (right). Each one leaps from
  // 160px behind its spot: up through the surface, an arc above it, back in, and a glide to its place.
  var SURF = 44;
  function pod(v) {
    var n = Math.min(v, 8), sp = n > 1 ? Math.min(42, 250 / (n - 1)) : 0, st = n > 4 ? 0.09 : 0.13, list = [];
    for (var i = 0; i < n; i++) list.push({ x: 250 + ((n - 1) / 2 - i) * sp, y: i % 2 ? 94 : 74, t: 0.3 + i * st });
    return { n: n, list: list, len: Math.max(1.3, n ? 0.3 + (n - 1) * st + 1.0 : 0) };
  }

  add({
    id: 'raid-deepsea', alert: 'raid', fam: 'sea', isNew: true, title: 'Pod', amount: 'Grows with the viewers',
    desc: 'Dolphins leap out of the water one after another, one per raider up to eight, splash back in and swim on together as a pod.',
    sound: 'seaRaid', fx: 'none', anim: hold('1.5s'), exit: EXIT_DRIFT,
    len: function (d) { return pod(intOf(d.viewers)).len; },
    render: function (d) {
      var v = intOf(d.viewers), p = pod(v), dol = '', spl = '';
      p.list.forEach(function (o) {
        dol += '<div class="o-sear-dol" style="left:' + n1(o.x) + 'px;top:' + o.y + 'px;--ya:' + (SURF + 2 - o.y) + 'px;--yb:' + (SURF - 30 - o.y) + 'px;--yc:' + (SURF + 4 - o.y) + 'px;--dd:' + o.t.toFixed(2) + 's">'
          + '<div class="o-sear-dy"><div class="o-sea-fish o-sear-dr">' + DOLPHIN + '</div></div></div>';
        spl += '<i class="o-sear-spl" style="left:' + n1(o.x - 52) + 'px;top:' + SURF + 'px;--sd:' + (o.t + 0.6).toFixed(2) + 's"></i>';
      });
      return '<div class="obj o-sea o-sear"><div class="o-sea-water o-sear-scene"><i class="o-sear-sky"></i><i class="o-sear-surf"></i>' + dol + spl + '</div>'
        + '<div class="o-sea-water o-sear-plate"><div class="o-sear-pin">' + nm('o-sear-name o-sea-name', d.username + '’s pod', 22)
        + '<div class="o-sear-line"><span class="o-sea-tag o-sear-tag">' + label(d, 'Raid') + '</span><b class="o-sear-num">' + odo(fmt(v), 0.5, 0.9) + '</b>'
        + '<span class="o-sear-unit">' + (v === 1 ? 'friend' : 'friends') + '</span></div></div></div></div>';
    },
  });

  /* ── giveaway — Jellyfish glow ── */
  var BELL = '<svg viewBox="0 0 80 48" aria-hidden="true">'
    + '<path class="o-seag-bp" d="M4 42C3 20 18 4 40 4S77 20 76 42C72 45 67 41.5 62 44.5C57 41.5 51 45 46 42.5C42 45 38 45 34 42.5C29 45 23 41.5 18 44.5C13 41.5 8 45 4 42Z"/>'
    + '<path class="o-seag-bc" d="' + oval(40, 31, 22, 9) + '"/>'
    + '<path class="o-seag-bh" d="M13 27C14 16 24 9 36 7.5C28 12 21 18 17 28Z"/>'
    + '<path class="o-seag-bs" d="' + circ(28, 20, 1.6) + circ(50, 15, 1.4) + circ(60, 26, 1.3) + circ(41, 12, 1.1) + circ(22, 32, 1.1) + '"/></svg>';
  var ARMS = 'M33 0C29 10 37 17 32 27C28 35 34 42 31 52M47 0C51 10 43 18 48 28C52 36 46 43 49 54';
  var TENT = '<svg viewBox="0 0 80 56" aria-hidden="true">'
    + '<path class="o-seag-tt" d="M9 0C7 11 13 21 9 32C6 40 10 47 8 54M21 0C19 9 24 19 20 29C17 37 21 44 19 50M59 0C61 9 56 19 60 29C63 37 59 44 61 50M71 0C73 11 67 21 71 32C74 40 70 47 72 54"/>'
    + '<path class="o-seag-ta" d="' + ARMS + '"/><path class="o-seag-tl" d="' + ARMS + '"/></svg>';
  // A scallop for the prize tag: the fan, its two small ears at the hinge, tinted with the accent.
  var SHELL = (function () {
    var f = fan(16, 26, 22, 22, -132, -48, 6, 0.1), ears = 'M16 26H9.8L11 22.6L15.2 23.8ZM16 26H22.2L21 22.6L16.8 23.8Z';
    return '<svg viewBox="0 0 32 28" aria-hidden="true"><path class="o-seag-sf" d="' + ears + f.outline + '"/>'
      + '<path class="o-seag-sa" d="' + ears + f.outline + '"/><path class="o-seag-sr" d="' + f.ribs + '"/></svg>';
  })();
  // Each jellyfish: [left, top, width, delay]; it is 1.2 × its width tall, bell on top, tentacles below.
  var JELLIES = [[37, 16, 58, 0.22], [174, 6, 72, 0.12], [324, 22, 52, 0.3]];

  add({
    id: 'giveaway-deepsea', alert: 'giveaway', fam: 'sea', isNew: true, title: 'Jellyfish glow',
    desc: 'Three jellyfish rise from the deep and pulse once together. The winner’s name glows in their light and the prize sits on a shell tag.',
    sound: 'seaGiveaway', fx: 'none', anim: hold('1.7s'), exit: EXIT_FLOAT, len: 1.85,
    render: function (d) {
      var jel = JELLIES.map(function (j) {
        return '<div class="o-seag-jw" style="left:' + j[0] + 'px;top:' + j[1] + 'px;width:' + j[2] + 'px;height:' + n1(j[2] * 1.2) + 'px;--jd:' + j[3].toFixed(2) + 's">'
          + '<i class="o-seag-jglow"></i><div class="o-seag-tw">' + TENT + '</div><div class="o-seag-bell">' + BELL + '</div></div>';
      }).join('');
      return '<div class="obj o-sea o-seag"><div class="o-sea-water o-seag-water"><i class="o-seag-light"></i>'
        + bubbles([[118, 206, 7, -6, 118, 0.12, 1.1], [304, 202, 6, 6, 104, 0.24, 1.0], [214, 210, 5, 0, 92, 0.38, 0.95]])
        + jel
        + '<div class="o-seag-txt"><div class="o-sea-tag o-seag-tag">' + label(d, 'Giveaway winner') + '</div>' + nm('o-seag-name o-sea-name', d.username, 17) + '</div>'
        + (d.prize ? '<div class="o-seag-pw"><div class="o-seag-prize"><i class="o-seag-shell">' + SHELL + '</i><span class="o-seag-pk">Prize</span><b class="o-seag-pv">' + esc(d.prize) + '</b></div></div>' : '')
        + '</div></div>';
    },
  });
})();
