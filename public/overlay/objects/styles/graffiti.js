'use strict';

/**
 * Graffiti (docs/superpowers/specs/2026-10-15-alert-styles-design.md, Appendix A), ported from the proposal
 * (docs/superpowers/specs/assets/2026-10-15-alert-styles/parts/fam/gfi.js and .css).
 * Its names and descriptions are in the locale files (overlayBuilder.families.graffiti, overlayBuilder.looks.<id>,
 * overlayBuilder.sounds.<key>). Its classes start with .o-gfi and its keyframes with gfi.
 */
/* ═══ Graffiti — street art ═══
   Brick and concrete walls; spray-can tags, a bubble-letter piece, stencils, stickers and a paste-up.
   Paint arrives the way paint does: a reveal that follows the can (with mist at the nozzle), drips that
   run down once the pass is over, stickers slapped on. Everything private to this family lives inside
   this function, so its helper names cannot collide with another family's. */
(function (root) {
  var K = (root && root.ATLETA_KIT) || require('../kit.js');
  var FAMILY = 'graffiti';
  var esc = K.esc, money = K.money, nm = K.nm, fmt = K.fmt, label = K.label, odo = K.odo, hash = K.hash, rng = K.rng, intOf = K.intOf, tone = K.tone, noise = K.noise;
  var SOUNDS = {};
  function hold(dur) { return { in: 'hold', dur: dur, ease: 'linear' }; }
  // Every look takes the streamer's colour and its speed, and its main text when it shows one.
  var CONTROLS = { colour: 'accent', label: true, speed: true };
  var CONTROLS_NO_TEXT = { colour: 'accent', label: false, speed: true };
  K.registerFamily({ key: FAMILY, order: 14, fonts: ["Saira+Condensed:wght@400;500;600;700","Rubik+Spray+Paint","Permanent+Marker"] });


  var GFI_EXIT = { out: 'gfiBuff', dur: '0.42s', ease: 'cubic-bezier(.55,0,.8,.4)' };

  // The spray can, side on: nozzle, dome, a body in the paint's colour, a dark label band and a shine.
  var GFI_CAN = '<svg class="o-gfi-can" viewBox="0 0 24 54" aria-hidden="true">'
    + '<rect class="o-gfi-can-nz" x="9" y="0" width="7" height="5" rx="1"/>'
    + '<path class="o-gfi-can-dome" d="M4 12C4 6 8 4 12 4S20 6 20 12Z"/>'
    + '<rect class="o-gfi-can-body" x="3" y="11" width="18" height="41" rx="3"/>'
    + '<rect class="o-gfi-can-band" x="3" y="24" width="18" height="12"/>'
    + '<rect class="o-gfi-can-stripe" x="3" y="28.5" width="18" height="3"/>'
    + '<rect class="o-gfi-can-shine" x="6" y="13" width="3" height="37" rx="1.5"/></svg>';

  // Stencil lettering: closed letters get a bridge (a thin gap), as if sprayed through a cut card.
  // The value is where the gap sits across the letter.
  var GFI_BRIDGE = { O: 50, Q: 50, D: 36, B: 33, P: 33, R: 33, A: 50, 0: 50, 8: 50 };
  function gfiStencil(text) {
    return Array.from(String(text == null ? '' : text)).map(function (c) {
      var bx = GFI_BRIDGE[c.toUpperCase()];
      return bx ? '<b class="o-gfi-br" style="--bx:' + bx + '%">' + esc(c) + '</b>' : esc(c);
    }).join('');
  }
  // The look's main label in stencil: the same rule as label(d, text) (the streamer's own text wins),
  // escaped one character at a time so the closed letters can get their bridges.
  function gfiLabel(d, text) { return gfiStencil(d && d.label ? d.label : text); }

  // A sprayed tag: a black buff patch rolled on first, the name in spray paint revealed left to right,
  // a rail that carries the mist (and the can) along the reveal edge, and drips that run down once the
  // spray has passed them. o: { t0, dur } of the pass, drips (how many), can (true to show the can).
  function gfiTag(cls, name, holds, o) {
    var r = rng(hash(name + cls)), drips = '', i;
    for (i = 0; i < o.drips; i++) {
      var x = 12 + (i + 0.5) / o.drips * 70 + (r() - 0.5) * 14;
      drips += '<i class="o-gfi-drip" style="--x:' + x.toFixed(0) + '%;--dl:' + (9 + r() * 12).toFixed(0) + 'px;--dd:' + (o.t0 + x / 100 * o.dur + 0.06).toFixed(2) + 's"></i>';
    }
    return '<div class="o-gfi-tagbox ' + cls + '-box" style="--gt0:' + o.t0 + 's;--gtd:' + o.dur + 's;--gbd:' + Math.max(0, o.t0 - 0.24).toFixed(2) + 's">'
      + '<i class="o-gfi-buff"></i>' + nm('o-gfi-tag ' + cls, name, holds) + drips
      + '<div class="o-gfi-rail"><i class="o-gfi-mist"></i>' + (o.can ? GFI_CAN : '') + '</div></div>';
  }

  // A paint splat in a -50..50 box, one path: a lumpy blob, tapering rays with a drop at each tip and
  // a few loose specks. Every part winds the same way, so the overlaps fill instead of cutting holes.
  function gfiDot(x, y, rr) {
    return 'M' + (x - rr).toFixed(1) + ' ' + y.toFixed(1) + 'a' + rr.toFixed(1) + ' ' + rr.toFixed(1) + ' 0 1 1 ' + (2 * rr).toFixed(1) + ' 0'
      + 'a' + rr.toFixed(1) + ' ' + rr.toFixed(1) + ' 0 1 1 ' + (-2 * rr).toFixed(1) + ' 0Z';
  }
  function gfiSplat(seed) {
    var r = rng(seed), n = 12, pts = [], i, a, rad, d;
    function f(v) { return v.toFixed(1); }
    function mid(p, q) { return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; }
    for (i = 0; i < n; i++) {
      a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.25;
      rad = 19 + r() * 7;
      pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
    }
    var m = mid(pts[n - 1], pts[0]);
    d = 'M' + f(m[0]) + ' ' + f(m[1]);
    for (i = 0; i < n; i++) { m = mid(pts[i], pts[(i + 1) % n]); d += 'Q' + f(pts[i][0]) + ' ' + f(pts[i][1]) + ' ' + f(m[0]) + ' ' + f(m[1]); }
    d += 'Z';
    var rays = 5 + Math.floor(r() * 3);
    for (i = 0; i < rays; i++) {
      a = (i / rays) * Math.PI * 2 + r() * 0.6;
      var len = 30 + r() * 13, w = 3.4 + r() * 2.4, ca = Math.cos(a), sa = Math.sin(a), bx = ca * 14, by = sa * 14, dr = 2.4 + r() * 2.4;
      d += 'M' + f(bx + sa * w) + ' ' + f(by - ca * w) + 'L' + f(ca * len) + ' ' + f(sa * len) + 'L' + f(bx - sa * w) + ' ' + f(by + ca * w) + 'Z';
      d += gfiDot(ca * (len + dr * 0.6), sa * (len + dr * 0.6), dr);
    }
    for (i = 0; i < 4; i++) { a = r() * Math.PI * 2; rad = 36 + r() * 10; d += gfiDot(Math.cos(a) * rad, Math.sin(a) * rad, 1.4 + r() * 1.8); }
    return d;
  }
  var GFI_SPLATS = [gfiSplat(11), gfiSplat(23), gfiSplat(37)];

  // A torn paper edge as a clip-path: every side is nibbled a little, deterministically.
  function gfiTorn(r) {
    var pts = [], i, n = 14, m = 6;
    function pc(v) { return v.toFixed(1) + '%'; }
    for (i = 0; i <= n; i++) pts.push(pc(i / n * 100) + ' ' + pc(r() * 2.4));
    for (i = 1; i < m; i++) pts.push(pc(100 - r() * 1.3) + ' ' + pc(i / m * 100));
    for (i = n; i >= 0; i--) pts.push(pc(i / n * 100) + ' ' + pc(100 - r() * 2.8));
    for (i = m - 1; i > 0; i--) pts.push(pc(r() * 1.3) + ' ' + pc(i / m * 100));
    return 'polygon(' + pts.join(',') + ')';
  }

  function gfiRattle(t, n) {
    for (var i = 0; i < n; i++) {
      noise({ ft: 'bandpass', f: 3400, q: 7, d: 0.035, v: 0.24, t: t + i * 0.085 });
      tone({ f: 2600, d: 0.03, v: 0.02, type: 'square', t: t + i * 0.085 });
    }
  }

  SOUNDS.gfiFollow = function () {
    gfiRattle(0.02, 3);
    noise({ ft: 'highpass', f: 4200, f2: 6400, d: 0.72, v: 0.12, a: 0.05, t: 0.42 });
    noise({ ft: 'bandpass', f: 1500, q: 1.2, d: 0.14, v: 0.12, a: 0.02, t: 1.1 });
  };
  SOUNDS.gfiSub = function () {
    noise({ ft: 'highpass', f: 4400, f2: 6200, d: 0.5, v: 0.11, a: 0.04, t: 0.25 });
    noise({ ft: 'highpass', f: 3400, f2: 4600, d: 0.38, v: 0.09, a: 0.04, t: 0.7 });
    noise({ ft: 'highpass', f: 5000, d: 0.45, v: 0.08, a: 0.05, t: 1.0 });
    tone({ f: 1568, d: 0.22, v: 0.05, type: 'triangle', t: 1.2 });
    tone({ f: 2093, d: 0.4, v: 0.045, type: 'triangle', t: 1.28 });
  };
  SOUNDS.gfiBits = function () {
    [0.28, 0.4, 0.52, 0.64].forEach(function (t, i) {
      noise({ ft: 'lowpass', f: 1300 - i * 120, f2: 240, d: 0.14, v: 0.26, t: t });
      tone({ f: 240 - i * 20, f2: 90, d: 0.1, v: 0.07, t: t });
    });
    noise({ ft: 'lowpass', f: 700, d: 0.07, v: 0.28, t: 0.97 });
    noise({ ft: 'bandpass', f: 2600, q: 1, d: 0.05, v: 0.12, t: 0.97 });
    tone({ f: 1700, f2: 2100, d: 0.12, v: 0.025, type: 'triangle', t: 1.27 });
    tone({ f: 1900, f2: 1500, d: 0.14, v: 0.025, type: 'triangle', t: 1.43 });
  };
  SOUNDS.gfiDonation = function () {
    noise({ ft: 'bandpass', f: 800, f2: 1700, q: 0.8, d: 0.75, v: 0.17, a: 0.18, t: 0.34 });
    noise({ ft: 'highpass', f: 2600, d: 0.6, v: 0.05, a: 0.2, t: 0.38 });
    noise({ ft: 'lowpass', f: 650, d: 0.07, v: 0.2, t: 0.36 });
    tone({ f: 1500, f2: 1900, d: 0.11, v: 0.025, type: 'triangle', t: 1.17 });
    tone({ f: 1750, f2: 1350, d: 0.13, v: 0.025, type: 'triangle', t: 1.33 });
    tone({ f: 1600, f2: 2000, d: 0.1, v: 0.022, type: 'triangle', t: 1.48 });
  };
  SOUNDS.gfiRaid = function () {
    gfiRattle(0, 2);
    noise({ ft: 'highpass', f: 4300, f2: 6000, d: 0.55, v: 0.11, a: 0.04, t: 0.38 });
    for (var i = 0; i < 7; i++) noise({ ft: 'highpass', f: 4800 + (i % 3) * 500, d: 0.09, v: 0.09, a: 0.01, t: 1.0 + i * 0.09 });
  };
  SOUNDS.gfiGiveaway = function () {
    gfiRattle(0.05, 2);
    noise({ ft: 'highpass', f: 4200, f2: 6200, d: 0.6, v: 0.11, a: 0.04, t: 0.45 });
    noise({ ft: 'highpass', f: 5000, d: 0.45, v: 0.08, a: 0.04, t: 1.0 });
    [1568, 2093, 2637, 3136].forEach(function (f, i) { tone({ f: f, d: 0.3, v: 0.045, type: 'triangle', t: 1.3 + i * 0.09 }); });
    noise({ ft: 'lowpass', f: 700, d: 0.07, v: 0.26, t: 1.56 });
  };

  K.register({
    key: 'follow-graffiti', eventType: 'follow', family: FAMILY, controls: CONTROLS_NO_TEXT, grows: false,
    sound: 'gfiFollow', fx: 'none', anim: hold('1.5s'), exit: GFI_EXIT, len: 1.5,
    render: function (d) {
      return '<div class="obj o-gfi o-gfif"><i class="o-gfi-wall"></i><div class="o-gfif-in">'
        + '<div class="o-gfi-sten o-gfif-lbl">' + gfiLabel(d, 'New follower') + '</div>'
        + gfiTag('o-gfif-name', d.username, 13, { t0: 0.42, dur: 0.7, drips: 2, can: true })
        + '</div></div>';
    },
  });

  // Bubble letters drawn as fat round strokes along a centre line, in layers: a blue 3D block with a
  // black rim, the black outline, the fill in the paint colour and a dashed white shine.
  var GFI_SUB = [
    'M50 26C48 16 36 14 30 15C20 16 16 24 18 31C21 40 34 42 40 46C48 51 50 60 46 68C42 78 26 80 16 72',
    'M80 18V60C80 82 112 82 112 60V18',
    'M140 82V17H158C178 17 178 47 158 47H140H161C181 47 181 81 161 81H140',
  ];
  var GFI_SUB_SHINE = [12, 3, 14];   // where each letter's shine starts, in % of its centre line (its upper left)
  var GFI_STAR = 'M10 1.5l2.6 5.5 6 .7-4.4 4.1 1.2 5.9L10 14.8l-5.4 2.9 1.2-5.9-4.4-4.1 6-.7z';
  function gfiPiece(paths) {
    var dk = '', dp = '', ol = '', fill = '', hi = '';
    paths.forEach(function (p, i) {
      dk += '<path class="o-gfis-dk" d="' + p + '"/>';
      dp += '<path class="o-gfis-dp" d="' + p + '"/>';
      ol += '<path class="o-gfis-ol" pathLength="100" style="--ld:' + (0.7 + i * 0.07).toFixed(2) + 's" d="' + p + '"/>';
      fill += '<path class="o-gfis-fill" pathLength="100" style="--ld:' + (0.25 + i * 0.1).toFixed(2) + 's" d="' + p + '"/>';
      hi += '<path class="o-gfis-hi" pathLength="100" style="stroke-dashoffset:-' + GFI_SUB_SHINE[i] + '" d="' + p + '"/>';
    });
    return '<svg class="o-gfis-piece" viewBox="0 0 200 104" aria-hidden="true"><g class="o-gfis-depth">' + dk + dp + '</g>'
      + ol + fill + '<g class="o-gfis-shine">' + hi + '</g></svg>';
  }

  K.register({
    key: 'subscriber-graffiti', eventType: 'subscription', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'gfiSub', fx: 'none', anim: hold('1.9s'), exit: GFI_EXIT, len: 1.95,
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), tier = Math.min(3, Math.max(1, intOf(d.tier) || 1)), stars = '';
      for (var i = 0; i < tier; i++) stars += '<svg class="o-gfis-star" style="--sd:' + (1.5 + i * 0.07).toFixed(2) + 's" viewBox="0 0 20 20" aria-hidden="true"><path class="o-gfis-starp" d="' + GFI_STAR + '"/></svg>';
      return '<div class="obj o-gfi o-gfis"><i class="o-gfi-wall"></i>' + gfiPiece(GFI_SUB)
        + '<div class="o-gfis-side"><div class="o-gfis-lbl">' + label(d, months > 1 ? 'Resubscribed' : 'New subscriber') + '</div>'
        + '<div class="o-gfi-sten o-gfis-mo"><span class="o-gfis-num">' + odo(String(months), 1.3, 0.6) + '</span><span class="o-gfis-unit">' + gfiStencil(months === 1 ? 'month' : 'months') + '</span></div>'
        + '<div class="o-gfi-sten o-gfis-tier"><span class="o-gfis-tl">' + gfiStencil('Tier ' + tier) + '</span>' + stars + '</div>'
        + (d.message ? '<div class="o-gfis-msg">' + esc(d.message) + '</div>' : '')
        + '</div><div class="o-gfis-row">' + gfiTag('o-gfis-name', d.username, 16, { t0: 1.0, dur: 0.5, drips: 2 }) + '</div></div>';
    },
  });

  K.register({
    key: 'bits-graffiti', eventType: 'bits', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'gfiBits', fx: 'none', anim: hold('1.6s'), exit: GFI_EXIT, len: 1.75,
    render: function (d) {
      var n = intOf(d.amount != null ? d.amount : d.bits), size = intOf(K.sizeOf(d, 'bits')), lg = Math.log10(size + 1);
      var count = Math.max(2, Math.min(12, Math.round(-1.6 + lg * 2.9)));
      var r = rng(hash(d.username + size)), step = Math.min(0.14, 0.62 / count), span = Math.min(300, 60 + count * 30);
      var cols = ['var(--gfia)', 'var(--gfi-lime)', 'var(--gfi-blue)', '#F2F2F2'], splats = '', drips = '', i;
      for (i = 0; i < count; i++) {
        var x = 26 + (i + 0.5) / count * span + (r() - 0.5) * 36, y = 32 + r() * 88;
        var s = Math.min(96, (38 + lg * 13) * (0.8 + r() * 0.4)), c = cols[i % cols.length], t = 0.28 + i * step;
        splats += '<div class="o-gfib-sp" style="left:' + x.toFixed(0) + 'px;top:' + y.toFixed(0) + 'px;--s:' + s.toFixed(0) + 'px;--c:' + c + ';--r:' + Math.round(r() * 360) + 'deg;--sd:' + t.toFixed(2) + 's">'
          + '<svg class="o-gfib-svg" viewBox="-50 -50 100 100" aria-hidden="true"><path class="o-gfib-ink" d="' + GFI_SPLATS[i % 3] + '"/></svg></div>';
        if (i < 3) drips += '<i class="o-gfi-drip" style="--x:' + x.toFixed(0) + 'px;--dt:' + (y + s * 0.16).toFixed(0) + 'px;--dl:' + (12 + r() * 16).toFixed(0) + 'px;--dc:' + c + ';--dd:' + (t + 0.2).toFixed(2) + 's"></i>';
      }
      return '<div class="obj o-gfi o-gfib"><i class="o-gfi-wall o-gfi-conc"></i><div class="o-gfib-splats">' + splats + drips + '</div>'
        + '<div class="o-gfib-stk"><div class="o-gfib-band">' + label(d, 'Thanks for the bits') + '</div>'
        + '<div class="o-gfib-body"><div class="o-gfib-amt">' + odo('+' + fmt(n), 1.05, 0.7) + '<span class="o-gfib-unit">' + (n === 1 ? 'bit' : 'bits') + '</span></div>'
        + nm('o-gfib-name', d.username, 12) + '</div></div></div>';
    },
  });

  K.register({
    key: 'donation-graffiti', eventType: 'donation', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'gfiDonation', fx: 'none', anim: hold('1.5s'), exit: GFI_EXIT, len: 1.6,
    render: function (d) {
      var r = rng(hash(d.username + d.amount));
      return '<div class="obj o-gfi o-gfid"><i class="o-gfi-wall"></i><div class="o-gfid-poster"><div class="o-gfid-reveal"><i class="o-gfid-paste"></i>'
        + '<div class="o-gfid-paper" style="clip-path:' + gfiTorn(r) + '"><div class="o-gfid-head">' + label(d, 'Thank you') + '</div>'
        + '<div class="o-gfid-body"><div class="o-gfid-amt">' + odo(money(d.amount, d.currency), 0.62, 0.6) + '</div>'
        + (d.message ? '<div class="o-gfid-msg">“' + esc(d.message) + '”</div>' : '')
        + nm('o-gfid-sign', '— ' + d.username, 17) + '</div><i class="o-gfid-wet"></i></div></div>'
        + '<div class="o-gfid-rail"><i class="o-gfid-brush"></i></div></div></div>';
    },
  });

  // Made-up crew tags (no real crews or brands), and where they go (centre x, y in the 420px object):
  // both side columns first, then the bottom row.
  var GFI_CREW = ['ZAP', 'RAD', 'JAX', 'BOLT', 'MOJO', 'FLY', 'NOVA', 'PIX', 'YOYO', 'KOI', 'VIBE', 'ZIGGY', 'DUKE', 'REX', 'LUMA', 'TOFU'];
  var GFI_SLOTS = [[46, 50], [374, 50], [40, 98], [380, 98], [50, 146], [370, 146], [128, 174], [292, 174], [210, 180]];

  K.register({
    key: 'raid-graffiti', eventType: 'raid', family: FAMILY, controls: CONTROLS_NO_TEXT, grows: true,
    sound: 'gfiRaid', fx: 'none', anim: hold('1.6s'), exit: GFI_EXIT,
    len: function (d) { var n = Math.min(9, intOf(K.sizeOf(d, 'raid'))); return Math.max(1.6, n ? 1.2 + (n - 1) * 0.09 : 0); },
    render: function (d) {
      var v = intOf(d.viewers), size = intOf(K.sizeOf(d, 'raid')), n = Math.min(size, 9), r = rng(hash(d.username + size)), words = GFI_CREW.slice(), crew = '', i;
      for (i = words.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), w = words[i]; words[i] = words[j]; words[j] = w; }
      var cols = ['#FFFFFF', 'var(--gfi-lime)', 'var(--gfia)', '#5C9BFF'];
      for (i = 0; i < n; i++) {
        crew += '<span class="o-gfir-ct' + (i % 3 === 1 ? ' o-gfir-spray' : '') + '" style="left:' + GFI_SLOTS[i][0] + 'px;top:' + GFI_SLOTS[i][1] + 'px;--r:' + (r() * 24 - 12).toFixed(0)
          + 'deg;--fs:' + (15 + r() * 5).toFixed(0) + 'px;--c:' + cols[i % cols.length] + ';--cd:' + (1.0 + i * 0.09).toFixed(2) + 's">' + esc(words[i]) + '</span>';
      }
      return '<div class="obj o-gfi o-gfir"><i class="o-gfi-wall o-gfi-conc"></i><div class="o-gfi-sten o-gfir-lbl">' + gfiLabel(d, 'Raid') + '</div>'
        + '<div class="o-gfir-main">' + gfiTag('o-gfir-name', d.username, 7, { t0: 0.38, dur: 0.55, drips: 2 })
        + '<div class="o-gfi-sten o-gfir-crew"><span class="o-gfir-w">' + gfiStencil('crew ·') + '</span><span class="o-gfir-n">' + odo(fmt(v), 0.98, 0.6) + '</span>'
        + '<span class="o-gfir-w">' + gfiStencil('deep') + '</span></div></div>' + crew + '</div>';
    },
  });

  // The crown: three points with a ball on each tip, a band with three gems and a blue 3D block behind.
  var GFI_CROWN_D = 'M20 74V64L13 26L44 46L70 14L96 46L127 26L120 64V74Z';
  function gfiBalls(cls) {
    return '<circle class="' + cls + '" cx="13" cy="20" r="6"/><circle class="' + cls + '" cx="70" cy="8" r="6.5"/><circle class="' + cls + '" cx="127" cy="20" r="6"/>';
  }
  var GFI_CROWN = '<svg class="o-gfig-crown" viewBox="0 0 140 84" aria-hidden="true">'
    + '<g class="o-gfig-depth"><path class="o-gfig-cb" d="' + GFI_CROWN_D + '"/>' + gfiBalls('o-gfig-cb') + '</g>'
    + '<path class="o-gfig-cf" d="' + GFI_CROWN_D + '"/>' + gfiBalls('o-gfig-cf') + '<path class="o-gfig-band" d="M21 64H119"/>'
    + '<circle class="o-gfig-gem" cx="45" cy="69" r="3.2"/><circle class="o-gfig-gem" cx="70" cy="69" r="3.2"/><circle class="o-gfig-gem" cx="95" cy="69" r="3.2"/>'
    + '<path class="o-gfig-shine" d="M24 56L20 36M50 50L66 29"/></svg>';

  K.register({
    key: 'giveaway-graffiti', eventType: 'giveaway_winner', family: FAMILY, controls: CONTROLS_NO_TEXT, grows: false,
    sound: 'gfiGiveaway', fx: 'confetti', anim: hold('1.9s'), exit: GFI_EXIT, len: 1.95,
    render: function (d) {
      var r = rng(hash(d.username + 'crown')), sparks = '', drips = '';
      [[-18, 4, 15], [148, -2, 12], [-26, 50, 10], [158, 46, 11]].forEach(function (s, k) {
        sparks += '<i class="o-gfig-spark" style="left:' + s[0] + 'px;top:' + s[1] + 'px;--ss:' + s[2] + 'px;--sd:' + (1.3 + k * 0.09).toFixed(2) + 's"></i>';
      });
      [30, 52, 74].forEach(function (x) {
        drips += '<i class="o-gfi-drip" style="--x:' + x + '%;--dt:80%;--dl:' + (8 + r() * 12).toFixed(0) + 'px;--dc:var(--gfi-lime);--dd:' + (0.45 + x / 100 * 0.6 + 0.1).toFixed(2) + 's"></i>';
      });
      return '<div class="obj o-gfi o-gfig"><i class="o-gfi-wall"></i>'
        + '<div class="o-gfig-crownbox">' + GFI_CROWN + drips + '<div class="o-gfi-rail o-gfig-rail"><i class="o-gfi-mist o-gfig-mist"></i>' + GFI_CAN + '</div>' + sparks + '</div>'
        + '<div class="o-gfig-main">' + gfiTag('o-gfig-name', d.username, 14, { t0: 1.0, dur: 0.5, drips: 2 }) + '</div>'
        + '<div class="o-gfig-foot"><div class="o-gfi-sten o-gfig-lbl">' + gfiLabel(d, 'Giveaway winner') + '</div>'
        + (d.prize ? '<div class="o-gfig-stk"><span class="o-gfig-won">Won</span><span class="o-gfig-prize">' + esc(d.prize) + '</span></div>' : '')
        + '</div></div>';
    },
  });

  Object.keys(SOUNDS).forEach(function (k) { K.registerSound(k, FAMILY, SOUNDS[k]); });
})(typeof window !== 'undefined' ? window : null);
