'use strict';

/**
 * Cockpit (docs/superpowers/specs/2026-10-15-alert-styles-design.md, Appendix A), ported from the proposal
 * (docs/superpowers/specs/assets/2026-10-15-alert-styles/parts/90-core.js and 40-styles.css).
 * Its names and descriptions are in the locale files (overlayBuilder.families.cockpit, overlayBuilder.looks.<id>,
 * overlayBuilder.sounds.<key>). Its classes start with .o-ck and its keyframes with ck.
 */
(function (root) {
  var K = (root && root.ATLETA_KIT) || require('../kit.js');
  var FAMILY = 'cockpit';
  var esc = K.esc, money = K.money, nm = K.nm, fmt = K.fmt, label = K.label, odo = K.odo, hash = K.hash, rng = K.rng, intOf = K.intOf, tone = K.tone, noise = K.noise, engine = K.engine;
  var SOUNDS = {};
  // Every look takes the streamer's colour and its speed, and its main text when it shows one.
  var CONTROLS = { colour: 'accent', label: true, speed: true };
  var CONTROLS_NO_TEXT = { colour: 'accent', label: false, speed: true };
  K.registerFamily({ key: FAMILY, order: 3, fonts: ["Saira+Condensed:wght@400;500;600;700","Chakra+Petch:wght@500;600;700","Share+Tech+Mono"] });

  var CK_IN = { in: 'ckBoot', dur: '0.32s', ease: 'cubic-bezier(.2,.8,.2,1)' };
  var CK_EXIT = { out: 'ckOff', dur: '0.34s', ease: 'ease-in' };
  var GAUGE = (function () {
    var cx = 62, cy = 62, R = 50;
    function pt(phi, r) { var a = phi * Math.PI / 180; return [(cx + r * Math.sin(a)).toFixed(2), (cy - r * Math.cos(a)).toFixed(2)]; }
    var s = pt(-120, R), e = pt(120, R), rz = pt(84, R), ticks = '', labels = '';
    for (var k = 0; k <= 20; k++) {
      var phi = -120 + 12 * k, major = k % 2 === 0, a = pt(phi, major ? 34 : 37), b = pt(phi, 41);
      ticks += '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" class="' + (major ? 'o-ckb-mj' : 'o-ckb-mn') + '"/>';
      if (k % 4 === 0) { var l = pt(phi, 26); labels += '<text x="' + l[0] + '" y="' + l[1] + '">' + (k / 2) + '</text>'; }
    }
    var arc = 'M' + s[0] + ' ' + s[1] + ' A' + R + ' ' + R + ' 0 1 1 ' + e[0] + ' ' + e[1];
    return '<svg viewBox="0 0 124 124" aria-hidden="true"><path class="o-ckb-arc" d="' + arc + '"/>'
      + '<path class="o-ckb-red" d="M' + rz[0] + ' ' + rz[1] + ' A' + R + ' ' + R + ' 0 0 1 ' + e[0] + ' ' + e[1] + '"/>'
      + '<path class="o-ckb-fill" pathLength="100" d="' + arc + '"/>' + ticks + labels + '</svg>';
  })();

  SOUNDS.upshift = function () { engine({ f: 70, f2: 420, d: 0.58, v: 0.1, t: 0.3 }); tone({ f: 2200, d: 0.04, v: 0.05, type: 'square', t: 0.88 }); engine({ f: 230, f2: 300, d: 0.45, v: 0.09, t: 0.92 }); };
  SOUNDS.pb = function () { tone({ f: 784, d: 0.12, v: 0.1, t: 1.0 }); tone({ f: 1175, d: 0.5, v: 0.1, t: 1.1 }); };
  SOUNDS.limiter = function () { engine({ f: 80, f2: 520, d: 0.82, v: 0.1, t: 0.3 }); for (var i = 0; i < 7; i++) engine({ f: 500, f2: 520, d: 0.06, v: 0.09, t: 1.12 + i * 0.08 }); };
  SOUNDS.wheelgun = function () { [0, 0.08, 0.16, 0.24].forEach(function (t, i) { noise({ ft: 'bandpass', f: 2600 + i * 200, q: 5, d: 0.07, v: 0.3, t: 0.42 + t }); }); engine({ f: 80, f2: 260, d: 0.55, v: 0.1, t: 0.98 }); };
  SOUNDS.spotter = function () { [0, 0.25, 0.5].forEach(function (t) { tone({ f: 1560, d: 0.07, v: 0.06, t: 0.35 + t }); }); };
  SOUNDS.finish = function () { engine({ f: 90, f2: 380, d: 0.7, v: 0.09, t: 0.2 }); [784, 988, 1175, 1568].forEach(function (f, i) { tone({ f: f, d: 0.14, v: 0.07, type: 'square', t: 0.95 + i * 0.07 }); }); };

  function ledColour(i) { return i < 5 ? 'var(--ck-g)' : i < 10 ? 'var(--ck-y)' : 'var(--ck-r)'; }
  K.register({
    key: 'follow-cockpit', eventType: 'follow', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'upshift', fx: 'speed', anim: CK_IN, exit: CK_EXIT, len: 1.45,
    render: function (d) {
      var leds = '';
      for (var i = 0; i < 15; i++) leds += '<i class="o-ck-led' + (i < 3 ? ' idle lit' : '') + '" style="--li:' + i + ';--c:' + ledColour(i) + '"></i>';
      return '<div class="obj o-ck o-ckf"><div class="o-ck-dash"><div class="o-ck-glass"><div class="o-ck-leds">' + leds + '</div>'
        + '<div class="o-ckf-row"><div class="o-ckf-gear"><small>Gear</small><span class="o-ckf-gv o-ckf-n">N</span><span class="o-ckf-gv o-ckf-g">1</span></div>'
        + '<div class="o-ckf-txt"><div class="o-ck-lbl">' + label(d, 'New follower') + '</div>' + nm('o-ck-name', d.username, 19) + '</div></div>'
        + '</div></div></div>';
    },
  });
  K.register({
    key: 'subscriber-cockpit', eventType: 'subscription', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'pb', fx: 'none', anim: CK_IN, exit: CK_EXIT, len: 1.6,
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), h = hash(d.username);
      var neg = (0.1 + (h % 700) / 1000).toFixed(3), pos = (0.3 + ((h >>> 8) % 600) / 1000).toFixed(3);
      var gw = Math.round(14 + (Number(neg) / 0.8) * 30);
      var heading = months > 1 ? 'Resubscribed · ' + months + ' months' : 'New subscriber';
      return '<div class="obj o-ck o-cks"><div class="o-ck-dash"><div class="o-ck-glass">'
        + '<div class="o-cks-top"><div class="o-cks-box"><span class="o-ck-lbl">Lap</span><b>' + odo(String(months).padStart(2, '0'), 0.3, 0.7) + '</b></div>'
        + '<div class="o-cks-delta"><div class="o-cks-dhead"><span class="o-ck-lbl">Delta</span><span class="o-cks-time"><span class="o-cks-tv o-cks-pos">+' + pos + '</span><span class="o-cks-tv o-cks-neg">-' + neg + '</span></span></div>'
        + '<div class="o-cks-bar"><i class="o-cks-red"></i><i class="o-cks-green" style="--gw:' + gw + '%"></i></div></div>'
        + '<div class="o-cks-box"><span class="o-ck-lbl">Map</span><b>T' + esc(d.tier || '1') + '</b></div></div>'
        + '<div class="o-cks-pb">Personal best</div>'
        + '<div class="o-cks-who"><div class="o-ck-lbl">' + label(d, heading) + '</div>' + nm('o-ck-name', d.username, 22) + '</div>'
        + '</div></div></div>';
    },
  });
  K.register({
    key: 'bits-cockpit', eventType: 'bits', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'limiter', fx: 'sparks', anim: CK_IN, exit: CK_EXIT, len: 1.5,
    render: function (d) {
      // The gauge, its rpm reading and the limiter are the picture (sizeOf); the odometer shows the real amount.
      var n = intOf(d.amount != null ? d.amount : d.bits), sized = K.sizeOf(d, 'bits');
      var raw = 2 + 2.2 * Math.log10(sized + 1), rpm = Math.min(10, raw), lim = raw >= 10;
      var ang = (-120 + rpm * 24).toFixed(1), off = (100 - rpm * 10).toFixed(1);
      return '<div class="obj o-ck o-ckb' + (lim ? ' limiter' : '') + '" style="--ang:' + ang + 'deg;--off:' + off + '"><div class="o-ck-dash"><div class="o-ck-glass o-ckb-glass">'
        + '<div class="o-ckb-gauge">' + GAUGE + '<div class="o-ckb-needle"></div><div class="o-ckb-hub"></div><div class="o-ckb-x">×1000 rpm</div></div>'
        + '<div class="o-ckb-info"><div class="o-ck-lbl" style="--k:0">' + label(d, 'Bits') + ' · <b>' + fmt(Math.round(rpm * 20) * 50) + ' rpm</b></div>'
        + '<div class="o-ckb-amt" style="--k:1">' + odo(fmt(n), 0.32, 0.8) + '<small>bits</small></div>'
        + nm('o-ck-name', d.username, 14, '--k:2;') + '</div>'
        + '<div class="o-ckb-lim">Limiter</div></div></div></div>';
    },
  });
  K.register({
    key: 'donation-cockpit', eventType: 'donation', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'wheelgun', fx: 'smoke', anim: CK_IN, exit: CK_EXIT, len: 1.8,
    render: function (d) {
      // The fuel cells and the stop time are the picture (sizeOf); the amount line shows the real donation.
      var amt = K.sizeOf(d, 'donation'), lg = Math.log10(Math.max(1, amt));
      var stop = Math.max(1.8, Math.min(4.0, 4.2 - lg * 1.1)).toFixed(1);
      var fuel = Math.max(2, Math.min(10, Math.round(2 + lg * 3))), cells = '', tyres = '';
      for (var i = 0; i < 10; i++) cells += '<i class="o-ckd-cell' + (i < fuel ? ' o-ck-lit' : '') + '" style="--fi:' + i + ';--c:var(--cka)"></i>';
      ['fl', 'fr', 'rl', 'rr'].forEach(function (k, j) { tyres += '<i class="o-ckd-tyre ' + k + '" style="--td:' + (0.42 + j * 0.08).toFixed(2) + 's"></i>'; });
      return '<div class="obj o-ck o-ckd"><div class="o-ck-dash"><div class="o-ck-glass">'
        + '<div class="o-ckd-top"><span class="o-ck-lbl">' + label(d, 'Pit stop') + '</span><span class="o-ckd-fuel"><span class="o-ck-lbl">Fuel</span><span class="o-ckd-cells">' + cells + '</span></span>'
        + '<span class="o-ckd-timer">' + odo(stop, 0.36, 0.62) + '<small>s</small></span></div>'
        + '<div class="o-ckd-main"><div class="o-ckd-car"><i class="o-ckd-rw"></i><i class="o-ckd-body"></i><i class="o-ckd-fw"></i>' + tyres + '</div>'
        + '<div class="o-ckd-info"><div class="o-ckd-amt">+' + esc(money(d.amount, d.currency)) + '</div><div class="o-ck-lbl">From</div>' + nm('o-ck-name', d.username, 16) + '</div>'
        + '<div class="o-ckd-go">GO GO GO</div></div>'
        + (d.message ? '<div class="o-ckd-msg">“' + esc(d.message) + '”</div>' : '')
        + '</div></div></div>';
    },
  });
  K.register({
    key: 'raid-cockpit', eventType: 'raid', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'spotter', fx: 'none', anim: CK_IN, exit: CK_EXIT, len: 1.6,
    render: function (d) {
      var v = intOf(d.viewers), sized = K.sizeOf(d, 'raid'), n = Math.min(sized, 22), r = rng(hash(d.username + sized)), blips = '';
      for (var i = 0; i < n; i++) {
        var th = r() * 360, rad = 16 + r() * 34;
        var x = rad * Math.sin(th * Math.PI / 180), y = -rad * Math.cos(th * Math.PI / 180);
        blips += '<i class="o-ckr-blip" style="--x:' + x.toFixed(1) + ';--y:' + y.toFixed(1) + ';--r:' + (th + (r() * 30 - 15)).toFixed(0) + 'deg;--bd:' + (0.3 + th / 360 * 1.2).toFixed(2) + 's"></i>';
      }
      return '<div class="obj o-ck o-ckr"><div class="o-ck-dash"><div class="o-ck-glass o-ckr-glass"><i class="o-ckr-side l"></i><i class="o-ckr-side r"></i>'
        + '<div class="o-ckr-radar"><i class="o-ckr-ring r1"></i><i class="o-ckr-ring r2"></i><i class="o-ckr-cross"></i><i class="o-ckr-sweep"></i>' + blips + '<i class="o-ckr-me"></i></div>'
        + '<div class="o-ckr-info"><div class="o-ck-lbl" style="--k:0">' + label(d, 'Spotter · raid') + '</div>' + nm('o-ck-name', d.username, 14, '--k:1;')
        + '<div class="o-ckr-count" style="--k:2">' + odo(fmt(v), 0.5, 0.8) + '<small>' + (v === 1 ? 'car inbound' : 'cars inbound') + '</small></div></div>'
        + '</div></div></div>';
    },
  });
  K.register({
    key: 'giveaway-cockpit', eventType: 'giveaway_winner', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'finish', fx: 'checker', anim: CK_IN, exit: CK_EXIT, len: 2.0,
    render: function (d) {
      var leds = '';
      for (var i = 0; i < 15; i++) leds += '<i class="o-ck-led lit" style="--li:' + i + ';--c:' + (i % 2 ? '#FFD12B' : 'var(--cka)') + '"></i>';
      return '<div class="obj o-ck o-ckg"><div class="o-ck-dash"><div class="o-ck-glass"><div class="o-ckg-checks"></div><div class="o-ck-leds">' + leds + '</div>'
        + '<div class="o-ckg-row"><div class="o-ckg-p1"><small>Pos</small><b>P1</b></div>'
        + '<div class="o-ckg-txt"><div class="o-ckg-flag o-ck-lbl"><span class="o-ckg-ft o-ckg-last">Last lap</span><span class="o-ckg-ft o-ckg-fin">' + label(d, 'Finish · giveaway winner') + '</span></div>'
        + nm('o-ck-name', d.username, 17)
        + (d.prize ? '<div class="o-ckg-prize"><span class="o-ck-lbl">Prize</span>' + esc(d.prize) + '</div>' : '')
        + '</div></div></div></div></div>';
    },
  });

  Object.keys(SOUNDS).forEach(function (k) { K.registerSound(k, FAMILY, SOUNDS[k]); });
})(typeof window !== 'undefined' ? window : null);
