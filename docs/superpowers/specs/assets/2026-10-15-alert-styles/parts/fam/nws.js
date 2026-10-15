/* ═══ Breaking News — TV news graphics and the newspaper ═══
   Lower thirds, a ticker, a LIVE bug, a market chart, a weather map and the newspaper. The accent is the
   channel's colour bar (news red by default); the panels stay white, navy and grey, and the paper stays
   paper. Motion is a crisp broadcast wipe, a ticker that runs once and stops, and the spinning newspaper
   that lands still. Everything private to this family lives inside this function, so its helper names
   cannot collide with another family's. */
(function () {
  FAMS.nws = {
    name: 'Breaking News', order: 25, badge: 'new',
    sw: 'linear-gradient(135deg,#E8202A 0 44%,#FFFFFF 44% 60%,#0E1A33 60%)',
    desc: 'TV news and the newspaper: a BREAKING NEWS bar for follows, an EXTRA! front page spinning in for subs, a market chart for bits, a live report for donations, a weather map for raids and the press printing the winner on the front page.',
  };

  /* ── Sounds, timed to the animations ── */
  SOUND_NAMES.nwsFollow = 'Breaking news sting';
  SOUNDS.nwsFollow = function () {
    noise({ ft: 'bandpass', f: 500, f2: 3000, q: 0.9, d: 0.3, v: 0.16, a: 0.12 });                   // the bar wipes in
    tone({ f: 110, f2: 55, d: 0.5, v: 0.12, t: 0.28 });                                              // the hit
    [523, 784, 1047].forEach(function (f, i) { tone({ f: f, d: 0.11, v: 0.05, type: 'square', t: 0.28 + i * 0.09 }); });
    [784, 1047, 1319].forEach(function (f) { tone({ f: f, d: 0.7, v: 0.035, type: 'triangle', t: 0.55 }); });   // the chord holds
    noise({ ft: 'highpass', f: 2600, d: 0.16, v: 0.06, t: 0.5 });                                    // the ticker strip
  };
  SOUND_NAMES.nwsSub = 'Spinning paper and slap';
  SOUNDS.nwsSub = function () {
    noise({ ft: 'bandpass', f: 300, f2: 1800, q: 1.4, d: 0.8, v: 0.12, a: 0.3 });                     // the paper spins in
    [0.16, 0.34, 0.5, 0.62, 0.72].forEach(function (t, i) { noise({ ft: 'bandpass', f: 1200 + i * 260, q: 2, d: 0.05, v: 0.1, t: t }); });
    noise({ ft: 'lowpass', f: 1100, f2: 200, d: 0.14, v: 0.28, t: 0.82 });                            // it lands
    tone({ f: 150, f2: 70, d: 0.14, v: 0.1, t: 0.82 });
    noise({ ft: 'lowpass', f: 600, d: 0.08, v: 0.2, t: 0.95 });                                       // EXTRA! is stamped
    tone({ f: 1568, d: 0.5, v: 0.05, type: 'triangle', t: 1.05 });                                    // the newsroom bell
    tone({ f: 3136, d: 0.35, v: 0.02, t: 1.05 });
  };
  SOUND_NAMES.nwsBits = 'Market blips and bell';
  SOUNDS.nwsBits = function () {
    [523, 587, 659, 784, 880, 1047].forEach(function (f, i) { tone({ f: f, d: 0.08, v: 0.05, t: 0.36 + i * 0.14 }); });   // the line climbs
    [0, 0.16].forEach(function (t) {                                                                                       // ding ding
      tone({ f: 1319, d: 0.5, v: 0.06, type: 'triangle', t: 1.1 + t });
      tone({ f: 2637, d: 0.3, v: 0.025, t: 1.1 + t });
    });
  };
  SOUND_NAMES.nwsDonation = 'Live cue and chime';
  SOUNDS.nwsDonation = function () {
    [0.04, 0.2].forEach(function (t) { tone({ f: 1000, d: 0.08, v: 0.06, t: t }); });                 // the LIVE cue pips
    noise({ ft: 'bandpass', f: 700, f2: 2600, q: 0.8, d: 0.3, v: 0.1, a: 0.1, t: 0.26 });             // the lower third
    noise({ ft: 'bandpass', f: 2600, f2: 900, q: 0.8, d: 0.26, v: 0.07, a: 0.08, t: 0.7 });           // the quote card opens
    [659, 988].forEach(function (f, i) { tone({ f: f, d: 0.6, v: 0.05, type: 'triangle', t: 0.86 + i * 0.12 }); });
  };
  SOUND_NAMES.nwsRaid = 'Wind and thunder';
  SOUNDS.nwsRaid = function () {
    noise({ ft: 'bandpass', f: 380, f2: 900, q: 0.7, d: 1.0, v: 0.14, a: 0.35, t: 0.25 });           // the front blows in
    noise({ ft: 'lowpass', f: 320, f2: 70, d: 0.95, v: 0.3, a: 0.02, t: 0.72 });                     // thunder
    tone({ f: 58, f2: 38, d: 0.8, v: 0.1, t: 0.72 });
    [784, 988, 1175].forEach(function (f, i) { tone({ f: f, d: 0.3, v: 0.045, type: 'triangle', t: 1.0 + i * 0.1 }); });   // the weather jingle
  };
  SOUND_NAMES.nwsGiveaway = 'Printing press';
  SOUNDS.nwsGiveaway = function () {
    noise({ ft: 'lowpass', f: 900, f2: 260, d: 0.12, v: 0.22, t: 0.05 });                            // the sheet lands
    engine({ f: 46, f2: 58, d: 0.85, v: 0.06, t: 0.32 });                                             // the roller rumbles
    for (var i = 0; i < 5; i++) noise({ ft: 'bandpass', f: 1500, q: 2.5, d: 0.04, v: 0.14, t: 0.38 + i * 0.17 });   // the press clacks
    [784, 1047, 1319].forEach(function (f, i) { tone({ f: f, d: i === 2 ? 0.7 : 0.16, v: 0.06, type: 'triangle', t: 1.18 + i * 0.12 }); });
  };

  /* ── Shared pieces ── */
  var WIPE_OUT = { out: 'nwsExit', dur: '.42s', ease: 'cubic-bezier(.5,0,.85,.45)' };
  var PAPER_OUT = { out: 'nwsPaperOut', dur: '.48s', ease: 'cubic-bezier(.4,0,.8,.6)' };
  function f1(x) { return String(Math.round(x * 10) / 10); }
  function tierOf(d) {
    var t = String(d.tier || '1');
    if (/^[123]000$/.test(t)) t = t.charAt(0);
    return /^[123]$/.test(t) ? t : '1';
  }
  // A circle as a path (no ids, so any number of tiles can show the same look).
  function circ(x, y, r) { return 'M' + f1(x - r) + ' ' + f1(y) + 'a' + r + ' ' + r + ' 0 1 0 ' + 2 * r + ' 0a' + r + ' ' + r + ' 0 1 0 -' + 2 * r + ' 0Z'; }
  // The ticker: a tag in the channel colour, then the window the text scrolls through once, from the right.
  // items are HTML that is already escaped.
  function ticker(cls, tag, items) {
    return '<div class="o-nws-tick ' + cls + '"><div class="o-nws-ttag o-nws-acc">' + esc(tag) + '</div><div class="o-nws-twin"><div class="o-nws-ttxt">'
      + items.map(function (s) { return '<span class="o-nws-titem">' + s + '</span>'; }).join('<i class="o-nws-tsep"></i>') + '</div></div></div>';
  }
  function tname(u) { return '<b class="o-nws-tname">' + esc(u) + '</b>'; }
  // The masthead of the paper; the ears are the small print either side of the title.
  function mast(cls, left, right) {
    return '<div class="' + cls + ' o-nws-mast o-nws-acc"><span class="o-nws-ear">' + left + '</span><span class="o-nws-mt">The Daily Stream</span><span class="o-nws-ear r">' + right + '</span></div>';
  }

  // The channel's globe, drawn in white over a disc in the channel colour.
  var GLOBE = '<svg class="o-nwsf-gl" viewBox="0 0 40 40" aria-hidden="true"><circle class="o-nwsf-gf" cx="20" cy="20" r="17"/>'
    + '<path class="o-nwsf-gs" d="M3 20H37M5.3 11.5H34.7M5.3 28.5H34.7M20 3V37"/><ellipse class="o-nwsf-gs" cx="20" cy="20" rx="8" ry="17"/>'
    + '<circle class="o-nwsf-gs" cx="20" cy="20" r="17"/></svg>';

  // The market chart: the line starts at the open (y0) and climbs to ye, higher for more bits
  // (50 → a little, 500 → about half, 10,000 → near the top); a dip before the final rally.
  function chart(n, seed) {
    var f = Math.max(0.15, Math.min(1, (Math.log10(n + 1) - 1) / 3.2)), r = rng(seed);
    var N = 12, X0 = 12, XE = 262, Y0 = 78, YE = Y0 - f * 58, pts = [];
    for (var i = 0; i < N; i++) {
      var t = i / (N - 1), y = Y0 + (YE - Y0) * Math.pow(t, 1.5);
      if (i > 0 && i < N - 1) y += (r() - 0.5) * (8 + 6 * f) * (1 - t * 0.5) + (i === N - 4 ? 6 : 0);
      pts.push([X0 + (XE - X0) * t, Math.max(8, Math.min(92, y))]);
    }
    return { pts: pts, x0: X0, xe: XE, y0: Y0, ye: YE };
  }

  // The donor's message: about 44 characters to a line on the quote card, at most three lines.
  function quoteLines(m) { var n = Array.from(String(m || '').trim()).length; return n ? Math.min(3, Math.ceil(n / 44)) : 0; }

  // The weather map. Landmasses are made up (no real country); the cold front is a curve with its
  // triangles on the side it moves towards; a cloud is three puffs with a drop shadow and rain below.
  var LAND = '<svg class="o-nwsr-land" viewBox="0 0 420 128" aria-hidden="true">'
    + '<path class="o-nwsr-lp" d="M0 0H158C164 12 150 22 168 34C182 44 150 56 160 70C168 84 134 98 112 94C88 90 72 102 50 108C32 113 14 104 0 108Z"/>'
    + '<path class="o-nwsr-lp" d="M222 66C228 52 256 48 272 56C290 64 296 78 282 86C266 95 236 92 226 82C219 76 219 72 222 66Z"/>'
    + '<path class="o-nwsr-lp" d="M420 34C396 38 378 46 366 58C350 72 340 86 352 100C362 112 352 122 360 128H420Z"/>'
    + '<path class="o-nwsr-lp" d="' + circ(196, 112, 6) + circ(312, 28, 5) + '"/></svg>';
  var FRONT = (function () {
    var P0 = [10, -6], P1 = [34, 64], P2 = [10, 134], teeth = '';
    [0.14, 0.32, 0.5, 0.68, 0.86].forEach(function (t) {
      var u = 1 - t, bx = u * u * P0[0] + 2 * u * t * P1[0] + t * t * P2[0], by = u * u * P0[1] + 2 * u * t * P1[1] + t * t * P2[1];
      var dx = 2 * u * (P1[0] - P0[0]) + 2 * t * (P2[0] - P1[0]), dy = 2 * u * (P1[1] - P0[1]) + 2 * t * (P2[1] - P1[1]), l = Math.sqrt(dx * dx + dy * dy);
      var tx = dx / l, ty = dy / l;
      teeth += 'M' + f1(bx - tx * 6) + ' ' + f1(by - ty * 6) + 'L' + f1(bx + ty * 9) + ' ' + f1(by - tx * 9) + 'L' + f1(bx + tx * 6) + ' ' + f1(by + ty * 6) + 'Z';
    });
    return '<svg class="o-nwsr-front" viewBox="0 0 44 128" aria-hidden="true"><path class="o-nwsr-fl" d="M10 -6Q34 64 10 134"/><path class="o-nwsr-ft" d="' + teeth + '"/></svg>';
  })();
  var PUFF = circ(12, 15, 6) + circ(21, 11, 8) + circ(29, 15.5, 5.5) + 'M12 15V21H29V15Z';
  var CLOUD = '<svg class="o-nwsr-cl" viewBox="0 0 40 30" aria-hidden="true"><path class="o-nwsr-cs" transform="translate(0 1.6)" d="' + PUFF + '"/>'
    + '<path class="o-nwsr-cb" d="' + PUFF + '"/><path class="o-nwsr-rain" d="M15 24.5l-1.8 4M21.5 24.5l-1.8 4M28 24.5l-1.8 4"/></svg>';
  var XF = 290, SWEEP_IN = 70;      // where the front stops, and how far left of the map it starts
  // The map's 4 × 3 cells, in the order clouds fill them, so a few clouds are spread over the storm.
  var CELLS = [5, 2, 11, 8, 3, 0, 6, 9, 4, 7, 1, 10];

  // A trophy for the front-page photo.
  var CUP = '<svg class="o-nwsg-cup" viewBox="0 0 28 28" aria-hidden="true"><path class="o-nwsg-ch" d="M8.5 5H5.5A3 3 0 0 0 9 11.5M19.5 5H22.5A3 3 0 0 1 19 11.5"/>'
    + '<path class="o-nwsg-cf" d="M8 3H20V9A6 6 0 0 1 8 9ZM12.5 14H15.5V19H12.5ZM9 19H19L20 24H8Z"/></svg>';

  /* ── follow — Breaking ── */
  add({
    id: 'follow-news', alert: 'follow', fam: 'nws', isNew: true, title: 'Breaking',
    desc: 'A BREAKING NEWS bar wipes in, the lower third names the new follower, and the ticker below runs once and stops.',
    sound: 'nwsFollow', fx: 'none', anim: hold('1.6s'), exit: WIPE_OUT, len: 1.6,
    render: function (d) {
      var head = d && d.label ? d.label : 'Breaking news';
      return '<div class="obj o-nws o-nwsf">'
        + '<div class="o-nwsf-bar o-nws-acc"><div class="o-nwsf-head" style="' + fitStyle(head, 22) + '">' + label(d, 'Breaking news') + '</div>'
        + '<div class="o-nwsf-live"><i class="o-nws-dot"></i>Live</div></div>'
        + '<div class="o-nwsf-band o-nws-white"><div class="o-nwsf-globe o-nws-navy">' + GLOBE + '</div>'
        + '<div class="o-nwsf-txt">' + nm('o-nwsf-name o-nws-name', d.username, 21) + '<div class="o-nws-cap o-nwsf-sub">New follower · welcome to the channel</div></div></div>'
        + ticker('o-nwsf-tick', 'Latest', [tname(d.username) + ' just followed', 'Thank you for the follow', 'More after the break'])
        + '</div>';
    },
  });

  /* ── subscription — Extra! Extra! ── */
  add({
    id: 'subscriber-news', alert: 'subscription', fam: 'nws', isNew: true, title: 'Extra! Extra!', amount: 'Months in the headline',
    desc: 'A newspaper spins in and lands still, EXTRA! EXTRA! is stamped above the headline and the months roll up in it; the tier is in the subhead.',
    sound: 'nwsSub', fx: 'none', anim: hold('1.6s'), exit: PAPER_OUT,
    len: function (d) { return intOf(d.months) > 1 ? 1.6 : 1.25; },
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), tier = tierOf(d), head = d && d.label ? d.label : 'Extra! Extra!';
      var line = months > 1 ? '<span>Subscribes for</span>' + odo(String(months), 0.96, 0.62) + '<span>months</span>' : '<span>Subscribes for the first time</span>';
      var deck = 'Tier ' + tier + ' subscription · ' + (months > 1 ? 'the chat celebrates' : 'welcome aboard');
      return '<div class="obj o-nws o-nwss"><div class="o-nwss-paper o-nws-paper">'
        + mast('o-nwss-mast', 'Late edition', 'Free') + '<i class="o-nwss-rule"></i>'
        + '<div class="o-nwss-kick"><span class="o-nwss-extra o-nws-acc" style="' + fitStyle(head, 26) + '">' + label(d, 'Extra! Extra!') + '</span><i class="o-nwss-krule"></i></div>'
        + nm('o-nwss-name o-nws-name', d.username, 16)
        + '<div class="o-nwss-line">' + line + '</div>'
        + '<div class="o-nwss-deck">' + esc(deck) + '</div>'
        + (d.message ? '<div class="o-nwss-quote">“' + esc(d.message) + '”</div>' : '<div class="o-nwss-cols"><i class="o-nws-col"></i><i class="o-nws-col"></i><i class="o-nws-col"></i></div>')
        + '</div></div>';
    },
  });

  /* ── bits — Market ticker ── */
  add({
    id: 'bits-news', alert: 'bits', fam: 'nws', isNew: true, title: 'Market ticker', amount: 'Grows with the amount',
    desc: 'A market chart draws itself and the line climbs, higher for more bits, to the amount; the ticker underneath carries the name.',
    sound: 'nwsBits', fx: 'none', anim: hold('1.8s'), exit: WIPE_OUT, len: 1.85,
    render: function (d) {
      var n = intOf(d.amount != null ? d.amount : d.bits), c = chart(n, hash(d.username + n));
      var line = 'M' + c.pts.map(function (p) { return f1(p[0]) + ' ' + f1(p[1]); }).join('L');
      return '<div class="obj o-nws o-nwsb"><div class="o-nwsb-panel o-nws-navy">'
        + '<div class="o-nwsb-head"><div class="o-nwsb-chip o-nws-acc"><span class="o-nws-clip">' + label(d, n >= 1000 ? 'Record high' : 'Cheer index') + '</span></div>'
        + '<span class="o-nws-cap o-nwsb-hl">Bits · live</span></div>'
        + '<div class="o-nwsb-chart"><i class="o-nwsb-base" style="top:' + c.y0 + 'px"></i>'
        + '<div class="o-nwsb-draw" style="width:' + (c.xe + 8) + 'px">'
        + '<svg class="o-nwsb-svg" viewBox="0 0 420 98" aria-hidden="true"><path class="o-nwsb-area" d="' + line + 'L' + c.xe + ' 98L' + c.x0 + ' 98Z"/></svg>'
        + '<svg class="o-nwsb-svg o-nwsb-glow" viewBox="0 0 420 98" aria-hidden="true"><path class="o-nwsb-line" d="' + line + '"/></svg></div>'
        + '<i class="o-nwsb-dot" style="left:' + c.xe + 'px;top:' + f1(c.ye) + 'px"><i class="o-nwsb-ring"></i></i>'
        + '<div class="o-nwsb-tagw" style="left:' + (c.xe + 12) + 'px;top:' + f1(c.ye) + 'px"><div class="o-nwsb-tag o-nws-acc"><span class="o-nwsb-num">+' + odo(fmt(n), 1.14, 0.7) + '</span><i class="o-nwsb-up"></i></div></div>'
        + '</div></div>'
        + ticker('o-nwsb-tick', 'Bits', [tname(d.username) + ' cheered ' + fmt(n) + ' bits', 'Chat closes higher', 'Thank you'])
        + '</div>';
    },
  });

  /* ── donation — Live report ── */
  add({
    id: 'donation-news', alert: 'donation', fam: 'nws', isNew: true, title: 'Live report',
    desc: 'A LIVE bug and a lower third wipe in with the amount and the donor, then the donor’s message opens below as a quote card.',
    sound: 'nwsDonation', fx: 'none', anim: hold('1.6s'), exit: WIPE_OUT,
    len: function (d) { var q = quoteLines(d.message); return q ? 0.96 + q * 0.3 + 0.1 : 1.1; },
    render: function (d) {
      var msg = String(d.message || '').trim(), lines = quoteLines(msg);
      return '<div class="obj o-nws o-nwsd">'
        + '<div class="o-nwsd-bug"><div class="o-nwsd-live o-nws-acc"><i class="o-nws-dot"></i>Live</div>'
        + '<div class="o-nwsd-loc o-nws-navy"><span class="o-nws-clip">' + label(d, 'From the chat') + '</span></div></div>'
        + '<div class="o-nwsd-l3"><div class="o-nwsd-amt o-nws-acc">' + odo(money(d.amount, d.currency), 0.42, 0.62) + '</div>'
        + '<div class="o-nwsd-who o-nws-white">' + nm('o-nwsd-name o-nws-name', d.username, 17) + '<div class="o-nws-cap o-nwsd-sub">Sent a tip · thank you!</div></div></div>'
        + (lines ? '<div class="o-nwsd-card o-nws-white"><b class="o-nwsd-qm">“</b><div class="o-nwsd-msg" style="--md:' + (lines * 0.3).toFixed(2) + 's">' + esc(msg) + '</div></div>' : '')
        + '</div>';
    },
  });

  /* ── raid — Weather map ── */
  add({
    id: 'raid-news', alert: 'raid', fam: 'nws', isNew: true, title: 'Weather map', amount: 'Grows with the viewers',
    desc: 'A storm front sweeps across the weather map and leaves one cloud per raider, up to twelve; then the strap: raid front moving in, with the name and the count.',
    sound: 'nwsRaid', fx: 'none', anim: hold('1.8s'), exit: WIPE_OUT, len: 1.8,
    render: function (d) {
      var v = intOf(d.viewers), n = Math.min(v, 12), r = rng(hash(d.username + v)), clouds = '';
      var cw = n <= 4 ? 44 : n <= 8 ? 40 : 36, ri = Math.min(0.88, 0.36 + Math.log10(v + 1) * 0.17);
      for (var i = 0; i < n; i++) {
        var col = CELLS[i] % 4, row = Math.floor(CELLS[i] / 4);
        var cx = 44 + col * 64 + (r() - 0.5) * 16, cy = 27 + row * 34 + (r() - 0.5) * 8;
        // The front moves with an ease-out (about 1 - (1 - t)²): the cloud pops as it passes overhead.
        var p = (cx + SWEEP_IN) / (XF + SWEEP_IN), t = 1 - Math.sqrt(Math.max(0, 1 - p));
        clouds += '<i class="o-nwsr-cloud" style="left:' + f1(cx - cw / 2) + 'px;top:' + f1(cy - cw * 0.375) + 'px;--cw:' + cw + 'px;--cd:' + (0.32 + t * 0.78).toFixed(3) + 's">' + CLOUD + '</i>';
      }
      return '<div class="obj o-nws o-nwsr"><div class="o-nwsr-map">' + LAND + '<i class="o-nwsr-grid"></i>'
        + '<div class="o-nwsr-sys" style="width:' + (XF + 22) + 'px;--sx:' + (XF + SWEEP_IN) + 'px"><i class="o-nwsr-radar" style="--ri:' + ri.toFixed(2) + '"></i>' + FRONT + '</div>'
        + clouds + '<span class="o-nws-cap o-nwsr-chip">Raid radar</span></div>'
        + '<div class="o-nwsr-kw"><div class="o-nwsr-kick o-nws-acc"><span class="o-nws-clip">' + label(d, 'Raid front moving in') + '</span></div></div>'
        + '<div class="o-nwsr-plate o-nws-white">' + nm('o-nwsr-name o-nws-name', d.username, 19)
        + '<span class="o-nwsr-count o-nws-acc">+' + odo(fmt(v), 1.1, 0.7) + '</span><span class="o-nws-cap o-nwsr-unit">' + (v === 1 ? 'viewer' : 'viewers') + '</span></div>'
        + '</div>';
    },
  });

  /* ── giveaway — Front page ── */
  add({
    id: 'giveaway-news', alert: 'giveaway', fam: 'nws', isNew: true, title: 'Front page',
    desc: 'A blank sheet lands and the press roller passes over it, printing a front page with the winner’s name as the headline and the prize as the subhead.',
    sound: 'nwsGiveaway', fx: 'confetti', anim: hold('1.3s'), exit: PAPER_OUT, len: 1.35,
    render: function (d) {
      return '<div class="obj o-nws o-nwsg"><div class="o-nwsg-paper o-nws-paper"><div class="o-nwsg-print">'
        + mast('o-nwsg-mast', 'Special edition', 'Free')
        + '<div class="o-nws-cap o-nwsg-date">Giveaway results · late edition</div>'
        + '<div class="o-nws-cap o-nwsg-kick o-nws-acc">' + label(d, 'Giveaway winner') + '</div>'
        + nm('o-nwsg-name', d.username, 15)
        + '<div class="o-nwsg-deck">' + esc(d.prize ? 'Wins ' + d.prize : 'Wins the giveaway') + '</div>'
        + '<div class="o-nwsg-cols"><i class="o-nws-col"></i><div class="o-nwsg-photo">' + CUP + '</div><i class="o-nws-col"></i></div>'
        + '</div></div>'
        + '<div class="o-nwsg-roll"><i class="o-nwsg-tex"></i></div></div>';
    },
  });
})();
