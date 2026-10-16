/* ═══ Music — stage and DJ booth: vinyl, decks, speakers, an EQ rack, a tape deck and stage lights ═══
   Everything lands on the beat (120 bpm, a beat every half second): a deck, a rack or a frame drops on
   the downbeat and bounces once, the lights switch on, the text drops in on the next beats, then the
   alert holds still. The accent (electric violet by default) is the light and the labels: the record
   label and its LED ring, the EQ bars, the speakers' LED rings, the cassette label, the stage wash and
   the framed record. Hardware stays black and grey. Righteous for names and numbers, Bebas Neue for the
   small caps. Everything private to this family lives inside this function, so its helper names cannot
   collide with another family's. */
(function () {
  FAMS.mus = {
    name: 'Music', order: 20, badge: 'new',
    sw: 'radial-gradient(circle,#EDEDF3 0 8%,#9B5CFF 9% 38%,#121216 40% 63%,#2C2C34 64% 67%,#121216 68%)',
    desc: 'Stage and DJ booth: the needle drops on a spinning record for follows, an equalizer settles at the months for subs, speakers pump out a bass drop for bits, a cassette plays the request for donations, a crowd raises its hands for raids and a framed record is engraved with the winner.',
  };

  /* ── Sounds: a small drum kit and a few chords, on the same beat grid as the animations ── */
  function kick(t, v) { tone({ f: 150, f2: 46, d: 0.24, v: v || 0.12, a: 0.002, t: t }); noise({ ft: 'lowpass', f: 220, d: 0.05, v: 0.12, t: t }); }
  function hat(t, v) { noise({ ft: 'highpass', f: 7500, d: 0.045, v: v || 0.07, t: t }); }
  function chord(fs, t, d, v, type) { fs.forEach(function (f) { tone({ f: f, d: d, v: v, type: type || 'triangle', a: 0.01, t: t }); }); }

  SOUND_NAMES.musFollow = 'Needle drop and crackle';
  SOUNDS.musFollow = function () {
    noise({ ft: 'lowpass', f: 300, d: 0.09, v: 0.14, t: 0.2 });                                // the deck lands
    noise({ ft: 'bandpass', f: 180, f2: 620, q: 2.5, d: 0.7, v: 0.05, a: 0.25, t: 0.22 });      // the platter spins up
    noise({ ft: 'lowpass', f: 160, d: 0.12, v: 0.26, t: 0.96 });                                // the needle drops
    [0.98, 1.05, 1.17, 1.24, 1.38, 1.47, 1.61].forEach(function (t) { noise({ ft: 'highpass', f: 4200, d: 0.014, v: 0.1, t: t }); });
    kick(1.0); hat(1.25); kick(1.5); hat(1.75);                                                  // and the record plays
    chord([262, 330, 392], 1.0, 0.32, 0.035);
    chord([294, 370, 440], 1.5, 0.42, 0.035);
  };
  SOUND_NAMES.musSub = 'EQ sweep and chimes';
  SOUNDS.musSub = function () {
    kick(0.2, 0.1);                                                                              // the rack lands
    noise({ ft: 'bandpass', f: 220, f2: 3200, q: 1.6, d: 0.32, v: 0.12, a: 0.06, t: 0.26 });    // the bars jump
    noise({ ft: 'bandpass', f: 3000, f2: 500, q: 1.6, d: 0.6, v: 0.07, t: 0.58 });              // and fall back
    kick(0.5, 0.08); kick(1.0, 0.11);                                                            // the plate lands
    [784, 988, 1175].forEach(function (f, i) {                                                   // the stars light
      tone({ f: f, d: 0.26, v: 0.06, type: 'triangle', t: 1.3 + i * 0.12 });
      tone({ f: f * 2, d: 0.2, v: 0.02, t: 1.3 + i * 0.12 });
    });
  };
  SOUND_NAMES.musBits = 'Sub bass drop';
  SOUNDS.musBits = function () {
    noise({ ft: 'bandpass', f: 300, f2: 2600, q: 1.4, d: 0.42, v: 0.09, a: 0.3, t: 0.06 });     // the build-up
    tone({ f: 110, f2: 34, d: 0.75, v: 0.12, t: 0.5 });                                          // the drop
    noise({ ft: 'lowpass', f: 140, d: 0.18, v: 0.26, t: 0.5 });
    kick(0.5, 0.12); kick(0.75, 0.08); kick(1.0, 0.11); kick(1.25, 0.08);
    hat(0.875); hat(1.125); hat(1.375);
  };
  SOUND_NAMES.musDonation = 'Cassette clunk and jingle';
  SOUNDS.musDonation = function () {
    noise({ ft: 'lowpass', f: 300, d: 0.08, v: 0.12, t: 0.2 });                                 // the deck lands
    noise({ ft: 'bandpass', f: 900, f2: 400, q: 1.2, d: 0.26, v: 0.06, t: 0.22 });              // the tape slides in
    noise({ ft: 'bandpass', f: 1800, q: 3, d: 0.03, v: 0.22, t: 0.5 });                         // clunk
    noise({ ft: 'lowpass', f: 260, d: 0.08, v: 0.22, t: 0.51 });
    tone({ f: 140, f2: 90, d: 0.08, v: 0.06, t: 0.5 });
    noise({ ft: 'bandpass', f: 2600, q: 4, d: 0.02, v: 0.18, t: 0.6 });                         // the play key
    noise({ ft: 'bandpass', f: 1200, q: 0.7, d: 1.1, v: 0.03, a: 0.08, t: 0.62 });             // tape hiss
    chord([523, 659], 0.9, 0.24, 0.045); chord([587, 740], 1.15, 0.24, 0.045); chord([659, 784, 988], 1.4, 0.6, 0.04);
  };
  SOUND_NAMES.musRaid = 'Crowd cheer';
  SOUNDS.musRaid = function () {
    kick(0.22, 0.1);                                                                             // the stage lands
    noise({ ft: 'lowpass', f: 400, d: 0.06, v: 0.14, t: 0.3 });                                 // the lights clunk on
    noise({ ft: 'bandpass', f: 1000, q: 0.6, d: 1.5, v: 0.16, a: 0.4, t: 0.45 });               // the crowd roars
    noise({ ft: 'bandpass', f: 2400, q: 1.2, d: 1.2, v: 0.06, a: 0.3, t: 0.6 });
    [0.85, 0.93, 1.02, 1.08, 1.17, 1.25, 1.31, 1.4, 1.47].forEach(function (t, i) { noise({ ft: 'bandpass', f: 1500 + (i % 3) * 300, q: 1.4, d: 0.035, v: 0.1, t: t }); });
    tone({ f: 2100, f2: 2700, d: 0.22, v: 0.03, t: 1.0 });                                      // a whistle
    tone({ f: 2700, f2: 2000, d: 0.3, v: 0.03, t: 1.24 });
    kick(1.0, 0.1); kick(1.5, 0.1);
  };
  SOUND_NAMES.musGiveaway = 'Record whoosh and fanfare';
  SOUNDS.musGiveaway = function () {
    kick(0.22, 0.1);                                                                             // the frame lands
    noise({ ft: 'bandpass', f: 300, f2: 1800, q: 1.2, d: 0.5, v: 0.1, a: 0.2, t: 0.3 });        // the record spins in
    kick(0.8, 0.12);                                                                             // it lands: a cymbal
    noise({ ft: 'highpass', f: 5000, d: 0.7, v: 0.08, a: 0.01, t: 0.8 });
    noise({ ft: 'bandpass', f: 3600, q: 6, d: 0.4, v: 0.05, t: 1.16 });                         // the engraving
    [523, 659, 784, 1047].forEach(function (f, i) { tone({ f: f, d: 0.2, v: 0.06, type: 'triangle', t: 1.06 + i * 0.1 }); });
    chord([523, 659, 784, 1047], 1.5, 0.9, 0.04);
    tone({ f: 2093, d: 0.8, v: 0.02, t: 1.55 });
  };

  /* ── Shared pieces ── */
  function exitOf(name, dur) { return { out: name, dur: dur, ease: 'cubic-bezier(.5,0,.85,.35)' }; }
  function n1(x) { return String(Math.round(x * 10) / 10); }
  function tierOf(d) {
    var t = String(d.tier || '1');
    if (/^[123]000$/.test(t)) t = t.charAt(0);
    return /^[123]$/.test(t) ? t : '1';
  }
  // The odometer gives every digit the width of a 0 (0.642em in Righteous); a comma or point is 0.264em.
  function odoEm(text) { return Array.from(text).reduce(function (w, c) { return w + (c >= '0' && c <= '9' ? 0.642 : c === ',' || c === '.' ? 0.264 : 0.6); }, 0); }
  // A seeded shuffle (render must not use Math.random).
  function shuffled(count, r) {
    var a = [], i, j, t;
    for (i = 0; i < count; i++) a.push(i);
    for (i = count - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  // Four-point glints, each [left, top, size, delay] in px and seconds: they twinkle once and stay small.
  function glints(list) {
    return list.map(function (g) { return '<i class="o-mus-glint" style="left:' + g[0] + 'px;top:' + g[1] + 'px;--gs:' + g[2] + 'px;--gd:' + g[3].toFixed(2) + 's"></i>'; }).join('');
  }

  /* ── follow — Needle drop ── */
  add({
    id: 'follow-music', alert: 'follow', fam: 'mus', isNew: true, title: 'Needle drop',
    desc: 'The record spins up on the turntable, the tonearm swings over and the needle drops; the light ring around the platter comes on and the name lands under NOW PLAYING.',
    sound: 'musFollow', fx: 'none', anim: hold('1.5s'), exit: exitOf('musScratch', '.36s'), len: 1.55,
    render: function (d) {
      var bars = [0.55, 0.95, 0.4, 0.75].map(function (h, i) { return '<i class="o-musf-bar' + (i % 2 ? ' o-musf-bb' : '') + '" style="--h:' + h + '"></i>'; }).join('');
      return '<div class="obj o-mus o-musf"><div class="o-mus-deck o-musf-deck">'
        + '<i class="o-musf-glow"></i><i class="o-musf-plat"></i><i class="o-musf-leds"></i>'
        + '<i class="o-musf-rec"></i><i class="o-musf-sheen"></i><i class="o-musf-lab"></i><i class="o-musf-pin"></i>'
        + '<i class="o-musf-ripple"></i><i class="o-musf-base"></i>'
        + '<div class="o-musf-arm"><i class="o-musf-cw"></i><i class="o-musf-tube"></i><i class="o-musf-head"></i><i class="o-musf-cap"></i></div>'
        + '<div class="o-musf-txt"><div class="o-mus-pill o-musf-tag"><span class="o-musf-eq">' + bars + '</span><span class="o-mus-pt">' + label(d, 'Now playing') + '</span></div>'
        + nm('o-musf-name o-mus-name', d.username, 13)
        + '<div class="o-mus-cap o-musf-sub">New follower</div></div>'
        + '</div></div>';
    },
  });

  /* ── subscriber — Equalizer ── */
  // Ten bands of ten LED segments (6px lit, 2px gap). The level they settle at grows with the months
  // (about 4 of 10 at one month, 5 to 6 at four, 8 to 10 from two years), shaped like a mix with some bass.
  var EQ_HZ = ['32', '64', '125', '250', '500', '1K', '2K', '4K', '8K', '16K'];
  var EQ_SHAPE = [0.8, 0.96, 1, 0.86, 0.7, 0.78, 0.9, 0.76, 0.6, 0.48];
  var SEG = 8, SEGS = 10, COLH = 78;
  function segTop(k) { return k <= 0 ? COLH : COLH - SEG * k + 2; }   // the clip that leaves k segments lit
  function eqBands(months, r) {
    var f = Math.min(1, 0.32 + 0.78 * Math.log(months + 1) / Math.log(37));
    return EQ_SHAPE.map(function (p) {
      var lit = Math.max(1, Math.min(SEGS, Math.round(SEGS * f * (p + (r() - 0.5) * 0.08))));
      return { lit: lit, peak: Math.min(SEGS, lit + 2 + Math.floor(r() * 3)), dip: Math.max(0, lit - 2 - Math.floor(r() * 2)), bump: Math.min(SEGS, lit + 1) };
    });
  }
  add({
    id: 'subscriber-music', alert: 'subscription', fam: 'mus', isNew: true, title: 'Equalizer', amount: 'Months as the level',
    desc: 'A rack equalizer drops in and its bars jump up, fall back and settle at a level for the months, with the months on its display; the name lands below and the tier lights one to three stars.',
    sound: 'musSub', fx: 'none', anim: hold('1.6s'), exit: exitOf('musPowerOff', '.34s'),
    len: function (d) { return 1.64 + (Number(tierOf(d)) - 1) * 0.12; },
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), tier = tierOf(d), r = rng(hash(d.username + '|' + months)), cols = '', hz = '', stars = '';
      eqBands(months, r).forEach(function (c, i) {
        var top = segTop(c.lit + 1);
        cols += '<div class="o-muss-col" style="left:' + i * 25 + 'px;--r:' + segTop(c.lit) + 'px;--p:' + segTop(c.peak) + 'px;--dp:' + segTop(c.dip) + 'px;--bp:' + segTop(c.bump) + 'px;--cd:' + (0.26 + i * 0.02).toFixed(2) + 's">'
          + '<i class="o-muss-lit"></i>'
          + (c.lit < SEGS ? '<i class="o-muss-pk" style="top:' + top + 'px;--k0:' + (COLH - top) + 'px;--k1:' + (segTop(Math.min(SEGS, c.peak + 1)) - top) + 'px"></i>' : '')
          + '</div>';
        hz += '<span class="o-muss-hz" style="left:' + i * 25 + 'px">' + EQ_HZ[i] + '</span>';
      });
      for (var s = 0; s < 3; s++) stars += '<i class="o-muss-star">' + (s < Number(tier) ? '<i class="o-muss-sf" style="--sd:' + (1.28 + s * 0.12).toFixed(2) + 's"></i>' : '') + '</i>';
      var heading = months > 1 ? months + ' months on repeat' : 'New subscriber', digits = String(months).length;
      return '<div class="obj o-mus o-muss"><div class="o-mus-deck o-muss-rack"><i class="o-muss-ear o-muss-el"></i><i class="o-muss-ear o-muss-er"></i>'
        + '<div class="o-muss-scr"><div class="o-muss-eq">' + cols + '</div><div class="o-muss-hzrow">' + hz + '</div></div>'
        + '<div class="o-muss-lcd"><span class="o-muss-num" style="font-size:' + (digits <= 2 ? 58 : digits === 3 ? 46 : 36) + 'px">' + odo(String(months), 0.4, 0.8) + '</span>'
        + '<span class="o-mus-cap o-muss-unit">' + (months === 1 ? 'month' : 'months') + '</span></div></div>'
        + '<div class="o-mus-plate o-muss-plate"><div class="o-muss-who"><div class="o-mus-pill o-muss-tag"><span class="o-mus-pt">' + label(d, heading) + '</span></div>'
        + nm('o-muss-name o-mus-name', d.username, 18) + '</div>'
        + '<div class="o-muss-tier"><div class="o-muss-stars">' + stars + '</div><span class="o-mus-cap o-muss-tl">Tier ' + tier + '</span></div></div>'
        + '</div>';
    },
  });

  /* ── bits — Bass drop ── */
  // More bits: more and wider rings of light, more pumps of the cones, more of the level meter lit, and
  // from 1,000 the whole rig shakes on the drop.
  function bitsPlan(n) {
    var P = n >= 1000 ? { lvl: 'big', rings: 3, scale: 1.75, pumps: 4, len: 1.7 }
      : n >= 100 ? { lvl: 'medium', rings: 2, scale: 1.6, pumps: 3, len: 1.45 }
        : { lvl: 'small', rings: 1, scale: 1.45, pumps: 2, len: 1.3 };
    P.leds = Math.max(2, Math.min(12, Math.round(Math.log10(n + 1) * 2.8 - 0.5)));
    return P;
  }
  add({
    id: 'bits-music', alert: 'bits', fam: 'mus', isNew: true, title: 'Bass drop', amount: 'Grows with the amount',
    desc: 'Two speakers drop in and the bass hits on the downbeat: the cones pump and rings of light ripple out, more and wider for more bits, while the amount rolls up and the level meter fills.',
    sound: 'musBits', fx: 'sparks', anim: hold('1.4s'), exit: exitOf('musDropOut', '.38s'),
    len: function (d) { return bitsPlan(intOf(d.amount != null ? d.amount : d.bits)).len; },
    render: function (d) {
      var n = intOf(d.amount != null ? d.amount : d.bits), P = bitsPlan(n), num = fmt(n), leds = '', i;
      // The plate is 172px inside: "+" and the number get what the unit leaves (132px), at most 44px tall.
      var size = Math.max(24, Math.min(44, Math.floor(132 / (0.486 + odoEm(num))))), lift = Math.max(0, 0.136 * size - 3.4).toFixed(1);
      function cab(side) {
        return '<div class="o-musb-cab o-musb-' + side + '" style="--pn:' + P.pumps + '"><i class="o-musb-tw"></i><i class="o-musb-woof"></i><i class="o-musb-cone"></i></div>';
      }
      // The rings of light ripple out of both woofers inside a layer that stops at the alert's bottom edge.
      var waves = '';
      for (i = 0; i < P.rings; i++) {
        var wave = '" style="--wd:' + (0.5 + i * 0.25).toFixed(2) + 's;--ws:' + P.scale + '"></i>';
        waves += '<i class="o-musb-wave o-musb-wl' + wave + '<i class="o-musb-wave o-musb-wr' + wave;
      }
      for (i = 0; i < 12; i++) leds += '<i class="o-musb-led' + (i < P.leds ? ' o-musb-on' : '') + '" style="--ld:' + (0.56 + i * 0.035).toFixed(3) + 's"></i>';
      return '<div class="obj o-mus o-musb' + (P.lvl === 'big' ? ' o-musb-big' : '') + '"><div class="o-musb-rig">' + cab('l') + cab('r') + '<div class="o-musb-waves">' + waves + '</div>'
        + '<div class="o-mus-plate o-musb-plate"><div class="o-mus-pill o-musb-tag"><span class="o-mus-pt">' + label(d, 'Bass drop!') + '</span></div>'
        + '<div class="o-musb-amt" style="font-size:' + size + 'px"><span class="o-musb-plus">+</span>' + odo(num, 0.5, 0.85)
        + '<span class="o-mus-cap o-musb-unit" style="margin-bottom:' + lift + 'px">bits</span></div>'
        + '<div class="o-musb-vu">' + leds + '</div>'
        + '<div class="o-musb-from"><span class="o-mus-cap o-musb-fr">from</span>' + nm('o-musb-name o-mus-name', d.username, 12) + '</div>'
        + '</div></div></div>';
    },
  });

  /* ── donation — Request line ── */
  // The message is the track title: written in on the label once the tape plays (from 0.82s, in at most
  // 0.8s), then the donor signs it. A long message gets a smaller pen.
  function tapePlan(message) {
    var text = message ? '“' + message + '”' : '', count = Array.from(text).length;
    var per = count ? Math.min(0.028, 0.8 / count) : 0, by = count ? 0.82 + count * per + 0.05 : 0.82;
    return { text: text, count: count, size: count > 100 ? 'o-musd-xs' : count > 58 ? 'o-musd-sm' : '', per: per, by: by, len: Math.max(1.45, by + 0.3) };
  }
  var VUH = 94;   // twelve segments of 6px with 2px gaps
  function vuTop(k) { return k <= 0 ? VUH : VUH - SEG * k + 2; }
  function meter(side, rest, b) {
    return '<div class="o-musd-vu o-musd-' + side + '" style="--r:' + vuTop(rest) + 'px;--v1:' + vuTop(b[0]) + 'px;--v2:' + vuTop(b[1]) + 'px;--v3:' + vuTop(b[2]) + 'px;--v4:' + vuTop(b[3]) + 'px"><i class="o-musd-vul"></i></div>';
  }
  add({
    id: 'donation-music', alert: 'donation', fam: 'mus', isNew: true, title: 'Request line',
    desc: 'A cassette slides into the tape deck with a clunk, ON AIR lights up and the reels turn; the amount is on the label and the message is written in as the track title, signed by the donor.',
    sound: 'musDonation', fx: 'none', anim: hold('1.5s'), exit: exitOf('musEject', '.38s'),
    len: function (d) { return tapePlan(d.message).len; },
    render: function (d) {
      var T = tapePlan(d.message), amt = money(d.amount, d.currency), al = Array.from(amt).length, strip;
      if (T.count) {
        var t = typed(T.text, 0.82, T.per, 120);   // the label holds about that much; the rest would be clipped anyway
        strip = '<div class="o-musd-msg o-typed ' + T.size + '" style="' + t.style + '">' + t.html + '</div>'
          + '<div class="o-musd-by" style="--bd:' + T.by.toFixed(2) + 's"><span class="o-musd-dash">—</span>' + nm('o-musd-name', d.username, 22) + '</div>';
      } else {
        strip = '<div class="o-musd-solo"><span class="o-mus-cap o-musd-fr">Tip from</span>' + nm('o-musd-sname', d.username, 15) + '</div>';
      }
      return '<div class="obj o-mus o-musd"><div class="o-mus-deck o-musd-deck">'
        + '<div class="o-musd-bay"><div class="o-musd-tape"><i class="o-musd-screws"></i>'
        + '<div class="o-musd-label"><div class="o-musd-top"><span class="o-musd-side">A</span><span class="o-musd-title">' + label(d, 'Request line') + '</span>'
        + '<span class="o-musd-amt" style="font-size:' + (al <= 7 ? 22 : al === 8 ? 20 : 18) + 'px">' + esc(amt) + '</span></div>'
        + '<div class="o-musd-strip">' + strip + '</div>'
        + '<div class="o-musd-band"><div class="o-musd-win"><i class="o-musd-pack o-musd-pl"></i><i class="o-musd-pack o-musd-pr"></i>'
        + '<i class="o-musd-hub o-musd-hl"></i><i class="o-musd-hub o-musd-hr"></i></div></div></div>'
        + '<i class="o-musd-foot"></i></div>'
        + '<i class="o-musd-glass"></i><i class="o-musd-sweep"></i></div>'
        + '<div class="o-musd-air">On air</div>'
        + '<div class="o-musd-well">' + meter('l', 9, [11, 6, 10, 8]) + meter('r', 7, [10, 5, 9, 6])
        + '<span class="o-mus-cap o-musd-ch o-musd-cl">L</span><span class="o-mus-cap o-musd-ch o-musd-cr">R</span></div>'
        + '<i class="o-musd-btn o-musd-play"></i><i class="o-musd-btn o-musd-stop"></i>'
        + '</div></div>';
    },
  });

  /* ── raid — Crowd ── */
  // Paths for the crowd: every circle, oval and rectangle is wound the same way, so a row of heads and
  // shoulders fills as one silhouette.
  function oval(x, y, rx, ry) { return 'M' + n1(x - rx) + ' ' + n1(y) + 'a' + n1(rx) + ' ' + n1(ry) + ' 0 1 0 ' + n1(2 * rx) + ' 0a' + n1(rx) + ' ' + n1(ry) + ' 0 1 0 ' + n1(-2 * rx) + ' 0Z'; }
  function capsule(x, y1, y2, w) { var h = w / 2; return 'M' + n1(x - h) + ' ' + n1(y1 + h) + 'V' + n1(y2) + 'H' + n1(x + h) + 'V' + n1(y1 + h) + 'A' + n1(h) + ' ' + n1(h) + ' 0 0 0 ' + n1(x - h) + ' ' + n1(y1 + h) + 'Z'; }
  var ROWS = [   // back, middle, front: head radius, spacing, row height, head centre
    { r: 6, s: 14.5, h: 44, y: 13 }, { r: 8, s: 19, h: 40, y: 13 }, { r: 10.5, s: 25, h: 34, y: 13 },
  ];
  function crowdRow(k, r) {
    var R = ROWS[k], d = '', x = -r() * R.s * 0.5;
    while (x < 420 + R.s) {   // whole pixels: a head in a crowd needs no finer place, and the path stays short
      var rr = Math.round(R.r * (0.88 + r() * 0.24)), hy = Math.round(R.y + (r() - 0.5) * 3), hx = Math.round(x + (r() - 0.5) * R.s * 0.3);
      d += oval(hx, hy, rr, rr) + oval(hx, hy + Math.round(rr * 2.05), Math.round(rr * 1.75), Math.round(rr * 1.15));
      x += R.s * (0.85 + r() * 0.3);
    }
    d += 'M0 ' + Math.round(R.y + R.r * 2.2) + 'V' + R.h + 'H420V' + Math.round(R.y + R.r * 2.2) + 'Z';
    return '<svg class="o-musr-row o-musr-k' + k + '" viewBox="0 0 420 ' + R.h + '" aria-hidden="true"><path d="' + d + '"/></svg>';
  }
  // Raised hands, 24 × 52: an open hand, a fist, a rock-on hand and a phone held up (its screen lit).
  var ARM = 'M9.6 25L8.2 52H16.8L15.2 25Z', PALM = 'M7.4 14.5V27H16.6V14.5Z', THUMB = 'M8.2 25.6L8.6 20L6.6 15.2L5 17Z' + oval(4.9, 15.9, 1.6, 1.6);
  var HAND = [
    ARM + PALM + THUMB + capsule(8.6, 5.5, 16, 2.5) + capsule(11, 3.8, 16, 2.5) + capsule(13.4, 4.6, 16, 2.5) + capsule(15.6, 7.4, 16, 2.4),
    ARM + 'M7 12.8V26.5H17V12.8Z' + oval(8.6, 13, 1.7, 1.7) + oval(11, 12.4, 1.7, 1.7) + oval(13.4, 12.6, 1.7, 1.7) + oval(15.5, 13.4, 1.6, 1.6),
    ARM + 'M7.4 16V27H16.6V16Z' + THUMB + capsule(8.7, 4.6, 17, 2.5) + capsule(15.4, 7.2, 17, 2.4) + 'M10 13.6V17H14.4V13.6Z',
    ARM + 'M7.4 16V27H16.6V16Z' + THUMB + 'M6.2 1.5V17.5H17.8V1.5Z',
  ];
  function handSvg(kind) {
    return '<svg viewBox="0 0 24 52" aria-hidden="true"><path class="o-musr-sil" d="' + HAND[kind] + '"/>'
      + (kind === 3 ? '<path class="o-musr-scr" d="M7.8 3.2V15.6H16.2V3.2Z"/>' : '') + '</svg>';
  }
  function crowdPlan(v, r) {
    var n = Math.min(v, 14), order = shuffled(n, r), step = n ? Math.min(0.06, 0.56 / n) : 0, hands = [], i;
    for (i = 0; i < n; i++) {
      var w = 376 / n;
      hands.push({ x: 22 + (i + 0.5) * w + (r() - 0.5) * w * 0.5, kind: Math.floor(r() * 4), tilt: Math.round((r() - 0.5) * 28), scale: 0.86 + r() * 0.26, lift: Math.round(r() * 9), d: 0.78 + order[i] * step });
    }
    var last = n ? 0.78 + (n - 1) * step + 0.44 : 0;
    return { n: n, rows: v >= 100 ? 3 : v >= 10 ? 2 : 1, hands: hands, len: Math.max(1.65, last) };
  }
  var CANS = [46, 128, 210, 292, 374], BEAM_REST = [-26, -12, 0, 12, 26];
  add({
    id: 'raid-music', alert: 'raid', fam: 'mus', isNew: true, title: 'Crowd', amount: 'Grows with the viewers',
    desc: 'The stage lights come on and sweep over a concert crowd that fills in from the back, and one hand goes up for every raider, up to fourteen; the plate says who brings how many to the show.',
    sound: 'musRaid', fx: 'smoke', anim: hold('1.5s'), exit: exitOf('musLightsOut', '.4s'),
    len: function (d) { return crowdPlan(intOf(d.viewers), rng(hash(d.username + '|' + intOf(d.viewers)))).len; },
    render: function (d) {
      var v = intOf(d.viewers), r = rng(hash(d.username + '|' + v)), plan = crowdPlan(v, r), beams = '', cans = '', rows = '', hands = '', k;
      CANS.forEach(function (x, i) {
        var rest = BEAM_REST[i];
        beams += '<i class="o-musr-beam" style="left:' + x + 'px;--ba:' + rest + 'deg;--b0:' + (rest + 30) + 'deg;--b1:' + (rest - 18) + 'deg;--bd:' + (0.3 + i * 0.04).toFixed(2) + 's"></i>';
        cans += '<i class="o-musr-can" style="left:' + x + 'px"></i>';
      });
      for (k = 3 - plan.rows; k < 2; k++) rows += crowdRow(k, r);
      plan.hands.forEach(function (h) {
        hands += '<i class="o-musr-hand" style="left:' + n1(h.x) + 'px;--hy:' + h.lift + 'px;--hr:' + h.tilt + 'deg;--hs:' + h.scale.toFixed(2) + ';--hd:' + h.d.toFixed(3) + 's">' + handSvg(h.kind) + '</i>';
      });
      return '<div class="obj o-mus o-musr"><div class="o-musr-stage"><i class="o-musr-wash"></i>' + beams + '<i class="o-musr-truss"></i>' + cans
        + rows + '<div class="o-musr-hands">' + hands + '</div>' + crowdRow(2, r) + '</div>'
        + '<div class="o-mus-plate o-musr-plate"><div class="o-mus-pill o-musr-tag"><span class="o-mus-pt">' + label(d, 'Raid!') + '</span></div>'
        + nm('o-musr-name o-mus-name', d.username, 20)
        + '<div class="o-musr-line"><span class="o-mus-cap o-musr-w">brings</span><span class="o-musr-num">' + odo(fmt(v), 0.95, 0.7) + '</span>'
        + '<span class="o-mus-cap o-musr-w">' + (v === 1 ? 'friend to the show' : 'to the show') + '</span></div>'
        + '</div></div>';
    },
  });

  /* ── giveaway — Gold record ── */
  add({
    id: 'giveaway-music', alert: 'giveaway', fam: 'mus', isNew: true, title: 'Gold record',
    desc: 'A record in your colour spins into the frame and lands under a spotlight; the plaque beside it is engraved with the winner’s name, then the prize.',
    sound: 'musGiveaway', fx: 'confetti', anim: hold('1.7s'), exit: exitOf('musFrameOut', '.42s'),
    len: function (d) { return d.prize ? 1.9 : 1.62; },
    render: function (d) {
      return '<div class="obj o-mus o-musg"><div class="o-musg-frame"><div class="o-musg-mat"><i class="o-musg-spot"></i>'
        + '<div class="o-musg-disc"><i class="o-musg-vinyl"></i><i class="o-musg-sheen"></i><div class="o-musg-lab"><span class="o-musg-lt">Winner</span></div></div>'
        + glints([[40, 36, 14, 0.9], [160, 64, 12, 0.98], [52, 158, 11, 1.06]])
        + '<div class="o-musg-plaque"><div class="o-musg-eng o-musg-e1"><div class="o-mus-cap o-musg-lbl">' + label(d, 'Giveaway winner') + '</div></div>'
        + '<i class="o-musg-rule"></i>'
        + '<div class="o-musg-e2w"><div class="o-musg-eng o-musg-e2">' + nm('o-musg-name', d.username, 12) + '</div><i class="o-musg-track"><i class="o-musg-tool"></i></i></div>'
        + (d.prize ? '<div class="o-musg-eng o-musg-e3"><div class="o-mus-cap o-musg-prize"><span class="o-musg-pk">Prize</span><span class="o-musg-pv">' + esc(d.prize) + '</span></div></div>' : '')
        + '</div><i class="o-musg-glass"></i><i class="o-musg-sweep"></i></div></div></div>';
    },
  });
})();
