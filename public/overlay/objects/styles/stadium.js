'use strict';

/**
 * Stadium (docs/superpowers/specs/2026-10-15-alert-styles-design.md, Appendix A), ported from the proposal
 * (docs/superpowers/specs/assets/2026-10-15-alert-styles/parts/fam/std.js and .css).
 * Its names and descriptions are in the locale files (overlayBuilder.families.stadium, overlayBuilder.looks.<id>,
 * overlayBuilder.sounds.<key>). Its classes start with .o-std and its keyframes with std.
 */
/* ═══ Stadium — match night at the arena ═══
   Dark steel, LED boards and floodlights: a jumbotron, a turnstile, a goal and its scoreboard, the LED
   sponsor boards, the stands and a trophy on its plinth. Bebas Neue on the boards and the ticket, Teko
   for the small print. Big, punchy broadcast moves (a camera flash, letters lighting up column by
   column, a scoreboard flap turning, the crowd on its feet), then everything holds still. The accent
   is the home team's colour. Generic on purpose: no real teams, leagues or brands. Everything private
   to this family lives inside this function, so its helper names cannot collide with another family's. */
(function (root) {
  var K = (root && root.ATLETA_KIT) || require('../kit.js');
  var FAMILY = 'stadium';
  var esc = K.esc, money = K.money, fitStyle = K.fitStyle, nm = K.nm, fmt = K.fmt, label = K.label, odo = K.odo, hash = K.hash, rng = K.rng, intOf = K.intOf, tone = K.tone, noise = K.noise;
  var SOUNDS = {};
  function hold(dur) { return { in: 'hold', dur: dur, ease: 'linear' }; }
  // Every look takes the streamer's colour and its speed, and its main text when it shows one.
  var CONTROLS = { colour: 'accent', label: true, speed: true };
  var CONTROLS_NO_TEXT = { colour: 'accent', label: false, speed: true };
  K.registerFamily({ key: FAMILY, order: 21, fonts: ["Bebas+Neue","Teko:wght@500;600;700"] });


  /* ── Sounds, timed to the animations ── */
  SOUNDS.stdFollow = function () {
    noise({ ft: 'lowpass', f: 320, d: 0.12, v: 0.2, t: 0.17 });                        // the screen swings into place
    [0.36, 0.47, 0.56].forEach(function (t) {                                            // it flickers on
      tone({ f: 118, d: 0.05, v: 0.05, type: 'sawtooth', t: t });
      noise({ ft: 'bandpass', f: 2600, q: 2, d: 0.03, v: 0.06, t: t });
    });
    tone({ f: 1800, f2: 5200, d: 0.16, v: 0.025, t: 0.35 });                             // the camera flash charges
    noise({ ft: 'highpass', f: 2600, d: 0.08, v: 0.24, t: 0.51 });                        // and pops
    [523, 659, 784].forEach(function (f) { tone({ f: f, d: 0.14, v: 0.03, type: 'square', t: 0.62 }); });    // the stadium organ
    [659, 784, 1047].forEach(function (f) { tone({ f: f, d: 0.5, v: 0.03, type: 'square', t: 0.86 }); });
  };
  SOUNDS.stdSub = function () {
    noise({ ft: 'lowpass', f: 300, d: 0.1, v: 0.18, t: 0.17 });                         // the turnstile lands
    tone({ f: 1320, d: 0.07, v: 0.05, type: 'square', t: 0.3 });                          // the reader says go
    tone({ f: 1760, d: 0.12, v: 0.05, type: 'square', t: 0.39 });
    noise({ ft: 'bandpass', f: 900, q: 3, d: 0.05, v: 0.22, t: 0.4 });                    // the arms clack round
    noise({ ft: 'lowpass', f: 520, d: 0.07, v: 0.2, t: 0.66 });
    noise({ ft: 'bandpass', f: 1400, f2: 2600, q: 1.2, d: 0.48, v: 0.09, a: 0.05, t: 0.52 });   // the ticket feeds out
    noise({ ft: 'lowpass', f: 600, d: 0.08, v: 0.2, t: 1.08 });                           // the class is stamped
    tone({ f: 1568, d: 0.35, v: 0.05, type: 'triangle', t: 1.1 });
    tone({ f: 2093, d: 0.45, v: 0.035, type: 'triangle', t: 1.18 });
  };
  SOUNDS.stdBits = function () {
    noise({ ft: 'lowpass', f: 400, d: 0.08, v: 0.26, t: 0.24 });                          // the kick
    tone({ f: 150, f2: 70, d: 0.1, v: 0.1, t: 0.24 });
    noise({ ft: 'bandpass', f: 600, f2: 1800, q: 0.9, d: 0.38, v: 0.08, a: 0.12, t: 0.26 });    // the ball flies
    noise({ ft: 'highpass', f: 2000, f2: 900, d: 0.24, v: 0.2, t: 0.64 });                 // it rips into the net
    noise({ ft: 'lowpass', f: 300, d: 0.1, v: 0.16, t: 0.64 });
    noise({ ft: 'bandpass', f: 500, f2: 1100, q: 0.5, d: 1.2, v: 0.17, a: 0.3, t: 0.66 });      // the crowd roars
    [[0.74, 0.2], [1.0, 0.45]].forEach(function (h) {                                      // and the air horns go
      tone({ f: 233, d: h[1], v: 0.04, type: 'sawtooth', t: h[0] });
      tone({ f: 349, d: h[1], v: 0.035, type: 'sawtooth', t: h[0] });
    });
  };
  SOUNDS.stdDonation = function () {
    [[784, 0.04], [659, 0.24], [523, 0.44]].forEach(function (p) {                        // ding, dong, ding on the PA
      tone({ f: p[0], d: 0.7, v: 0.07, t: p[1] });
      tone({ f: p[0] * 2, d: 0.35, v: 0.02, t: p[1] });
    });
    noise({ ft: 'bandpass', f: 3000, f2: 1200, q: 1.5, d: 0.4, v: 0.06, a: 0.04, t: 0.44 });    // the boards scroll
    noise({ ft: 'bandpass', f: 3000, f2: 1200, q: 1.5, d: 0.45, v: 0.05, a: 0.04, t: 0.98 });
  };
  SOUNDS.stdRaid = function () {
    [0.14, 0.22].forEach(function (t) { noise({ ft: 'lowpass', f: 240, d: 0.12, v: 0.18, t: t }); });   // the floodlights
    noise({ ft: 'bandpass', f: 400, f2: 1500, q: 0.6, d: 0.6, v: 0.16, a: 0.25, t: 0.36 });     // the wave rolls round
    noise({ ft: 'bandpass', f: 1500, f2: 600, q: 0.6, d: 0.55, v: 0.12, t: 0.96 });
    [392, 523, 659, 784].forEach(function (f, i) { tone({ f: f, d: 0.1, v: 0.05, type: 'square', t: 1.0 + i * 0.1 }); });   // the organ: charge!
    tone({ f: 659, d: 0.12, v: 0.05, type: 'square', t: 1.5 });
    tone({ f: 784, d: 0.5, v: 0.05, type: 'square', t: 1.62 });
  };
  SOUNDS.stdGiveaway = function () {
    [0.02, 0.1].forEach(function (t) {                                                    // the floodlights clunk on
      noise({ ft: 'lowpass', f: 260, d: 0.14, v: 0.24, t: t });
      tone({ f: 62, d: 0.18, v: 0.08, t: t });
    });
    tone({ f: 100, f2: 120, d: 0.45, v: 0.025, type: 'sawtooth', t: 0.14 });             // and hum
    [[523, 0.5, 0.12], [659, 0.62, 0.12], [784, 0.74, 0.12], [1047, 0.88, 0.65]].forEach(function (n) {   // the trophy rises: brass
      tone({ f: n[0], d: n[2], v: 0.06, type: 'triangle', t: n[1] });
      tone({ f: n[0], d: n[2], v: 0.02, type: 'sawtooth', t: n[1] });
    });
    noise({ ft: 'bandpass', f: 700, f2: 1200, q: 0.5, d: 1.2, v: 0.12, a: 0.3, t: 0.95 });      // the crowd cheers
    tone({ f: 2637, d: 0.4, v: 0.03, t: 1.12 });                                          // the glint on the cup
  };

  /* ── Exits: a screen switching off, a scoreboard flap turning away, lowered out of sight ── */
  var OFF = { out: 'stdOff', dur: '0.4s', ease: 'cubic-bezier(.55,0,.85,.4)' };
  var FLIP = { out: 'stdFlipOut', dur: '0.42s', ease: 'cubic-bezier(.5,0,.8,.4)' };
  var SINK = { out: 'stdSink', dur: '0.45s', ease: 'cubic-bezier(.5,0,.85,.35)' };

  /* ── Shared pieces (short SVG paths, no ids, so any number of tiles can show the same look) ── */
  function n1(x) { return String(Math.round(x * 10) / 10); }
  var CLASSES = { '1': 'General', '2': 'Premium', '3': 'VIP' };
  function tierOf(d) {
    var t = String(d.tier || '1');
    if (/^[123]000$/.test(t)) t = t.charAt(0);
    return CLASSES[t] ? t : '1';
  }
  // Three chevrons pointing right; the right-hand set is mirrored in CSS.
  var CHEV = '<svg viewBox="0 0 30 16" aria-hidden="true"><path d="M0 0h4.5l7 8-7 8H0l7-8zM9 0h4.5l7 8-7 8H9l7-8zM18 0h4.5l7 8-7 8H18l7-8z"/></svg>';
  // The turnstile: the reader's arrow, the three arms round their hub, the crest on the ticket.
  var GO = '<svg class="o-stds-go" viewBox="0 0 26 20" aria-hidden="true"><path d="M1 7H13V1L25 10L13 19V13H1Z"/></svg>';
  var ARMS = 'M42 42H4M42 42L61 9.1M42 42L61 74.9';
  var ROTOR = '<svg class="o-stds-rotor" viewBox="0 0 84 84" aria-hidden="true"><g class="o-stds-arms"><path class="o-stds-armsh" d="' + ARMS + '"/><path class="o-stds-arm" d="' + ARMS + '"/></g>'
    + '<circle class="o-stds-hub" cx="42" cy="42" r="8"/></svg>';
  var CREST = '<svg class="o-stds-crest" viewBox="0 0 16 19" aria-hidden="true"><path class="o-stds-shield" d="M8 0L16 3V9C16 14 12.5 17 8 19C3.5 17 0 14 0 9V3Z"/>'
    + '<path class="o-stds-cstar" d="M8 4.2L9.2 7.6H12.8L9.9 9.7L11 13.1L8 11L5 13.1L6.1 9.7L3.2 7.6H6.8Z"/></svg>';
  // A classic black-and-white ball: a pentagon in the middle, five more round the edge, the seams between.
  var BALL = (function () {
    function p(a, r) { var t = a * Math.PI / 180; return n1(20 + r * Math.cos(t)) + ' ' + n1(20 + r * Math.sin(t)); }
    var patches = '', seams = '', k, j;
    for (k = 0; k < 5; k++) patches += (k ? 'L' : 'M') + p(-90 + 72 * k, 6.6);
    patches += 'Z';
    for (k = 0; k < 5; k++) {
      var a = -90 + 72 * k, A = a * Math.PI / 180, cx = 20 + 16.8 * Math.cos(A), cy = 20 + 16.8 * Math.sin(A);
      for (j = 0; j < 5; j++) {
        var b = (180 + 72 * j) * Math.PI / 180, u = Math.cos(b) * 3.8, w = Math.sin(b) * 6;   // flattened by the curve of the ball
        patches += (j ? 'L' : 'M') + n1(cx + u * Math.cos(A) - w * Math.sin(A)) + ' ' + n1(cy + u * Math.sin(A) + w * Math.cos(A));
      }
      patches += 'Z';
      seams += 'M' + p(a, 6.6) + 'L' + p(a, 13);
    }
    return '<svg viewBox="0 0 40 40" aria-hidden="true"><path class="o-stdb-seam" d="' + seams + '"/><path class="o-stdb-patch" d="' + patches + '"/></svg>';
  })();
  // The trophy: a cup in the home colour (shaded and lit), a star on the bowl, an ebony base with a band.
  var CUP = '<svg viewBox="0 0 96 106" aria-hidden="true">'
    + '<path class="o-stdg-hdl" d="M21 15C7 13 4 29 11 37C15 42 21 44 28 46M75 15C89 13 92 29 85 37C81 42 75 44 68 46"/>'
    + '<path class="o-stdg-hdlh" d="M19 18C10 18 8 28 13 34M77 18C86 18 88 28 83 34"/>'
    + '<path class="o-stdg-metal" d="M15 6H81C81 37 69 57 48 61C27 57 15 37 15 6Z"/><path class="o-stdg-shade" d="M48 6H81C81 37 69 57 48 61Z"/>'
    + '<path class="o-stdg-metal" d="M12 2H84V9H12Z"/><path class="o-stdg-shade" d="M48 2H84V9H48Z"/>'
    + '<path class="o-stdg-emb" d="M48 18L50.6 25.4L58.5 25.6L52.2 30.4L54.5 37.9L48 33.4L41.5 37.9L43.8 30.4L37.5 25.6L45.4 25.4Z"/>'
    + '<path class="o-stdg-hi" d="M23 12C24 31 30 45 39 53"/>'
    + '<path class="o-stdg-metal" d="M44 60H52L50.5 73H45.5ZM38 72H58V77H38ZM33 77H63L67 88H29Z"/>'
    + '<path class="o-stdg-shade" d="M48 60H52L50.5 73H48ZM48 72H58V77H48ZM48 77H63L67 88H48Z"/>'
    + '<path class="o-stdg-ebony" d="M24 88H72V104H24Z"/><path class="o-stdg-band" d="M24 94H72V97H24Z"/></svg>';
  var TAPE = ['var(--stda)', '#FFFFFF', 'var(--stda)', '#DDE3EA'];

  /* ── follow — Jumbotron ── */
  K.register({
    key: 'follow-stadium', eventType: 'follow', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'stdFollow', fx: 'none', anim: hold('1.3s'), exit: OFF, len: 1.35,
    render: function (d) {
      var hello = d && d.label ? d.label : 'Welcome';
      return '<div class="obj o-std o-stdf"><div class="o-stdf-rig"><i class="o-stdf-strut l"></i><i class="o-stdf-strut r"></i>'
        + '<div class="o-stdf-box o-std-steel"><div class="o-stdf-screen o-std-led"><div class="o-stdf-on">'
        + '<div class="o-stdf-row"><i class="o-std-chev l">' + CHEV + '</i>'
        + '<div class="o-std-bb o-std-lit o-stdf-hello" style="' + fitStyle(hello, 11) + '">' + label(d, 'Welcome') + '</div>'
        + '<i class="o-std-chev r">' + CHEV + '</i></div>'
        + nm('o-stdf-name o-std-bb', d.username, 22)
        + '<div class="o-stdf-cap">New follower</div></div>'
        + '<i class="o-stdf-flash"></i></div></div></div>'
        + '<i class="o-std-pop o-stdf-pop"></i></div>';
    },
  });

  /* ── subscription — Season ticket ── */
  K.register({
    key: 'subscriber-stadium', eventType: 'subscription', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'stdSub', fx: 'none', anim: hold('1.6s'), exit: FLIP,
    len: function (d) { return tierOf(d) === '1' ? 1.45 : 1.9; },
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), tier = tierOf(d), digits = String(months).length, msg = !!d.message, stars = '';
      for (var i = 0; i < Number(tier); i++) stars += '<i class="o-stds-star" style="--sd:' + (1.16 + i * 0.07).toFixed(2) + 's"></i>';
      var size = (msg ? 33 : 38) - (digits >= 4 ? 9 : digits === 3 ? 5 : 0);
      return '<div class="obj o-std o-stds t' + tier + (msg ? ' o-stds-hasmsg' : '') + '">'
        + '<div class="o-stds-gate o-std-steel"><i class="o-stds-lid"></i><div class="o-stds-reader">' + GO + '</div><i class="o-stds-slot"></i><i class="o-stds-foot"></i>' + ROTOR + '</div>'
        + '<div class="o-stds-feed"><div class="o-stds-ticket">'
        + '<div class="o-stds-main"><div class="o-stds-head">' + CREST + '<span class="o-std-cap o-stds-lbl">' + label(d, 'Season ticket') + '</span></div>'
        + '<div class="o-stds-season" style="font-size:' + size + 'px"><span class="o-std-bb o-stds-sw">Season</span><b class="o-std-bb o-stds-num">' + odo(String(months), 0.96, 0.6) + '</b></div>'
        + nm('o-stds-name o-std-bb', d.username, 16)
        + (msg ? '<div class="o-stds-msg">“' + esc(d.message) + '”</div>' : '')
        + '</div><i class="o-stds-perf"></i>'
        + '<div class="o-stds-stub"><span class="o-std-cap o-stds-ck">Class</span><b class="o-std-bb o-stds-class">' + CLASSES[tier] + '</b>'
        + '<span class="o-stds-stars">' + stars + '</span><i class="o-stds-bar"></i></div>'
        + (tier !== '1' ? '<i class="o-stds-sheen"></i>' : '')
        + '</div></div></div>';
    },
  });

  /* ── bits — Goal! ── */
  // 50 bits: a small burst and three camera flashes in the crowd; 500: the full burst and six; 1,000 or more: the biggest and ten.
  function shot(n) { var lvl = n >= 1000 ? 2 : n >= 100 ? 1 : 0; return { bs: [0.78, 1, 1.28][lvl], ds: [0.82, 1, 1.18][lvl], flashes: [3, 6, 10][lvl] }; }
  K.register({
    key: 'bits-stadium', eventType: 'bits', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'stdBits', fx: 'confetti', anim: hold('1.5s'), exit: OFF, len: 1.6,
    render: function (d) {
      var n = intOf(d.amount != null ? d.amount : d.bits), sized = K.sizeOf(d, 'bits'), s = shot(sized), r = rng(hash(d.username + sized)), flashes = '', i;
      for (i = 0; i < s.flashes; i++) flashes += '<i class="o-stdb-fl" style="left:' + n1(8 + r() * 184) + 'px;top:' + n1(5 + r() * 20) + 'px;--fd:' + (0.68 + i * 0.045).toFixed(3) + 's"></i>';
      // The amount fits the board: Bebas digits are about .4em wide and a comma about .19em.
      var text = '+' + fmt(n), wem = Array.from(text).reduce(function (w, c) { return w + (c === ',' ? 0.21 : 0.42); }, 0);
      var size = Math.max(22, Math.min(40, Math.floor(116 / wem))), lift = Math.max(0, 0.2 * size - 3.9).toFixed(1);
      var goal = d && d.label ? d.label : 'Goal!';
      return '<div class="obj o-std o-stdb" style="--bs:' + s.bs + ';--ds:' + s.ds + '">'
        + '<div class="o-stdb-cam o-std-steel"><div class="o-stdb-view"><i class="o-stdb-crowd"></i><i class="o-stdb-ads"></i><i class="o-stdb-turf"></i>' + flashes
        + '<div class="o-stdb-goal"><i class="o-stdb-net"></i><i class="o-stdb-dent"></i></div>'
        + '<div class="o-stdb-bw"><i class="o-stdb-burst"></i></div>'
        + '<div class="o-stdb-ball">' + BALL + '</div></div></div>'
        + '<div class="o-stdb-board o-std-steel"><div class="o-stdb-led o-std-led">'
        + '<div class="o-std-bb o-std-lit o-stdb-gt" style="' + fitStyle(goal, 6) + '">' + label(d, 'Goal!') + '</div>'
        + '<i class="o-stdb-rule"></i>'
        + '<div class="o-std-bb o-stdb-amt" style="font-size:' + size + 'px"><span class="o-stdb-plus">+</span>' + odo(fmt(n), 0.86, 0.7)
        + '<span class="o-stdb-unit" style="margin-bottom:' + lift + 'px">bits</span></div>'
        + '<div class="o-stdb-who"><span class="o-std-cap o-stdb-by">by</span>' + nm('o-stdb-name o-std-bb', d.username, 14) + '</div>'
        + '<i class="o-stdb-wash"></i></div></div></div>';
    },
  });

  /* ── donation — Sponsor board ── */
  K.register({
    key: 'donation-stadium', eventType: 'donation', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'stdDonation', fx: 'none', anim: hold('1.2s'), exit: OFF,
    len: function (d) { return d.message ? 1.62 : 1.05; },
    render: function (d) {
      var amt = money(d.amount, d.currency), al = Array.from(amt).length, fs = al <= 6 ? 36 : al <= 8 ? 31 : 26;
      return '<div class="obj o-std o-stdd"><div class="o-stdd-frame o-std-steel">'
        + '<div class="o-stdd-rib o-std-led"><i class="o-stdd-on"></i><div class="o-stdd-ribin">'
        + '<div class="o-stdd-who"><span class="o-std-cap o-stdd-lbl">' + label(d, 'Thank you') + '</span>' + nm('o-stdd-name o-std-bb', d.username, 18) + '</div>'
        + '<div class="o-std-bb o-stdd-amt" style="font-size:' + fs + 'px">' + esc(amt) + '</div></div></div>'
        + (d.message ? '<div class="o-stdd-msgb o-std-led"><div class="o-stdd-msgin"><span class="o-std-bb o-std-lit o-stdd-q">“</span><div class="o-stdd-msg">' + esc(d.message) + '</div></div></div>' : '')
        + '</div></div>';
    },
  });

  /* ── raid — Crowd wave ── */
  // Twelve sections; the wave runs left to right and one section per raider (a block in the middle) raises cards.
  function wave(v) {
    var n = Math.min(v, 12), first = Math.floor((12 - n) / 2), list = [];
    for (var i = 0; i < 12; i++) list.push({ lit: i >= first && i < first + n, wd: 0.36 + i * 0.055 });
    return list;
  }
  K.register({
    key: 'raid-stadium', eventType: 'raid', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'stdRaid', fx: 'none', anim: hold('1.5s'), exit: SINK, len: 1.6,
    render: function (d) {
      var v = intOf(d.viewers), secs = '';
      wave(K.sizeOf(d, 'raid')).forEach(function (s) {
        secs += '<div class="o-stdr-sec"><div class="o-stdr-fans" style="--wd:' + s.wd.toFixed(3) + 's">' + (s.lit ? '<i class="o-stdr-cards"></i>' : '') + '</div></div>';
      });
      return '<div class="obj o-std o-stdr"><div class="o-stdr-arena"><i class="o-stdr-roof"></i>'
        + '<i class="o-std-flood o-stdr-fl l"></i><i class="o-std-flood o-stdr-fl r"></i>'
        + '<div class="o-stdr-stand"><div class="o-stdr-secs">' + secs + '</div></div></div>'
        + '<div class="o-stdr-board o-std-steel"><div class="o-stdr-led o-std-led">'
        + '<div class="o-stdr-who"><span class="o-std-cap o-stdr-lbl">' + label(d, 'Raid · fans in the stands') + '</span>' + nm('o-stdr-name o-std-bb', d.username + '’s fans', 22) + '</div>'
        + '<b class="o-std-bb o-stdr-count">' + odo(fmt(v), 0.9, 0.7) + '</b></div></div></div>';
    },
  });

  /* ── giveaway — Trophy lift ── */
  K.register({
    key: 'giveaway-stadium', eventType: 'giveaway_winner', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'stdGiveaway', fx: 'champagne', anim: hold('1.5s'), exit: SINK, len: 1.6,
    render: function (d) {
      var r = rng(hash(d.username + 'tape')), tape = '';
      for (var i = 0; i < 18; i++) {
        tape += '<i class="o-stdg-tape" style="left:' + n1(14 + r() * 386) + 'px;--tc:' + TAPE[i % TAPE.length] + ';--fy:' + n1(160 + r() * 60) + 'px;--fx:' + n1((r() - 0.5) * 50)
          + 'px;--tr:' + Math.round(r() * 360) + 'deg;--td:' + (0.95 + r() * 0.5).toFixed(2) + 's;--tu:' + (1.0 + r() * 0.4).toFixed(2) + 's"></i>';
      }
      return '<div class="obj o-std o-stdg"><i class="o-stdg-beam l"></i><i class="o-stdg-beam r"></i>'
        + '<i class="o-std-flood o-stdg-fl l"></i><i class="o-std-flood o-stdg-fl r"></i><i class="o-stdg-halo"></i>'
        + '<div class="o-stdg-lift"><div class="o-stdg-cup">' + CUP + '</div></div><i class="o-std-glint o-stdg-glint"></i>'
        + '<div class="o-stdg-plinth"><div class="o-stdg-plate"><span class="o-std-cap o-stdg-lbl">' + label(d, 'Giveaway winner') + '</span>' + nm('o-stdg-name o-std-bb', d.username, 20) + '</div></div>'
        + (d.prize ? '<div class="o-stdg-prize"><span class="o-std-cap o-stdg-pk">Prize</span><b class="o-stdg-pv">' + esc(d.prize) + '</b></div>' : '')
        + '<div class="o-stdg-tapes">' + tape + '</div></div>';
    },
  });

  Object.keys(SOUNDS).forEach(function (k) { K.registerSound(k, FAMILY, SOUNDS[k]); });
})(typeof window !== 'undefined' ? window : null);
