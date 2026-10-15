'use strict';

/**
 * Grand Prix (docs/superpowers/specs/2026-10-15-alert-styles-design.md, Appendix A), ported from the proposal
 * (docs/superpowers/specs/assets/2026-10-15-alert-styles/parts/90-core.js and 40-styles.css).
 * Its names and descriptions are in the locale files (overlayBuilder.families.grandprix, overlayBuilder.looks.<id>,
 * overlayBuilder.sounds.<key>). Its classes start with .o-gp and its keyframes with gp.
 */
(function (root) {
  var K = (root && root.ATLETA_KIT) || require('../kit.js');
  var FAMILY = 'grandprix';
  var esc = K.esc, money = K.money, nm = K.nm, fmt = K.fmt, label = K.label, odo = K.odo, typed = K.typed, hash = K.hash, rng = K.rng, code3 = K.code3, intOf = K.intOf, tone = K.tone, noise = K.noise, engine = K.engine;
  var SOUNDS = {};
  function hold(dur) { return { in: 'hold', dur: dur, ease: 'linear' }; }
  // Every look takes the streamer's colour and its speed, and its main text when it shows one.
  var CONTROLS = { colour: 'accent', label: true, speed: true };
  var CONTROLS_NO_TEXT = { colour: 'accent', label: false, speed: true };
  K.registerFamily({ key: FAMILY, order: 2, fonts: ["Saira+Condensed:wght@400;500;600;700","Titillium+Web:wght@400;600;700;900"] });

  var GP_EXIT = { out: 'gpExit', dur: '0.34s', ease: 'cubic-bezier(.6,0,.9,.4)' };
  var TYRE = { '1': ['S', '#FF3030'], '2': ['M', '#FFD12B'], '3': ['H', '#F2F2F2'] };
  var TROPHY = '<svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="gpgGold" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#B8860B"/><stop offset=".5" stop-color="#FFE27A"/><stop offset="1" stop-color="#C9961A"/></linearGradient></defs><path d="M14 5h20v9a10 10 0 0 1-20 0z" fill="url(#gpgGold)"/><path d="M14 8H8.5a5.5 5.5 0 0 0 6.5 9M34 8h5.5a5.5 5.5 0 0 1-6.5 9" fill="none" stroke="url(#gpgGold)" stroke-width="3"/><rect x="21.5" y="23" width="5" height="9" fill="url(#gpgGold)"/><path d="M15 32h18l2.5 9h-23z" fill="url(#gpgGold)"/></svg>';

  SOUNDS.lights = function () { [0, 0.16, 0.32, 0.48, 0.64].forEach(function (t) { tone({ f: 880, d: 0.1, v: 0.05, type: 'square', t: 0.26 + t }); }); engine({ f: 70, f2: 330, d: 0.75, v: 0.11, t: 1.22 }); };
  SOUNDS.overtake = function () { noise({ ft: 'bandpass', f: 500, f2: 2600, q: 0.7, d: 0.55, v: 0.22, a: 0.2, t: 0.4 }); tone({ f: 660, d: 0.12, v: 0.07, type: 'triangle', t: 1.34 }); tone({ f: 990, d: 0.3, v: 0.07, type: 'triangle', t: 1.46 }); };
  SOUNDS.sectors = function () { [[988, 0.32], [1175, 0.58], [1568, 0.84]].forEach(function (p) { tone({ f: p[0], d: 0.09, v: 0.06, type: 'square', t: p[1] }); }); };
  SOUNDS.radio = function () { noise({ ft: 'bandpass', f: 1800, q: 2.5, d: 0.16, v: 0.3 }); tone({ f: 1250, d: 0.06, v: 0.05, t: 0.18 }); noise({ ft: 'bandpass', f: 2400, q: 3, d: 0.1, v: 0.12, t: 2.2 }); };
  SOUNDS.raceControl = function () { [0, 0.32, 0.64].forEach(function (t) { tone({ f: 740, d: 0.14, v: 0.06, type: 'square', t: t + 0.15 }); tone({ f: 554, d: 0.14, v: 0.06, type: 'square', t: t + 0.31 }); }); };
  SOUNDS.podium = function () { [523, 659, 784, 1046].forEach(function (f, i) { tone({ f: f, d: 0.18, v: 0.1, type: 'triangle', t: 0.7 + i * 0.11 }); }); tone({ f: 1046, d: 0.8, v: 0.1, type: 'triangle', t: 1.16 }); noise({ ft: 'highpass', f: 3000, d: 0.6, v: 0.05, t: 1.0, a: 0.05 }); };

  K.register({
    key: 'follow-grandprix', eventType: 'follow', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'lights', fx: 'speed', anim: hold('1.8s'), exit: GP_EXIT, len: 1.8,
    render: function (d) {
      var pods = '';
      for (var i = 0; i < 5; i++) pods += '<div class="o-gpf-pod" style="--on:' + (0.26 + i * 0.16).toFixed(2) + 's"><i class="o-gpf-lamp"></i><i class="o-gpf-lamp"></i></div>';
      return '<div class="obj o-gp o-gpf"><div class="o-gpf-gantry">' + pods + '</div>'
        + '<div class="o-gp-plate o-gpf-plate"><i class="o-gp-stripe"></i><div class="o-gpf-streaks"><i class="o-gpf-streak"></i><i class="o-gpf-streak"></i><i class="o-gpf-streak"></i></div>'
        + '<div class="o-gpf-txt"><div class="o-gp-label sq">' + label(d, 'New follower') + '</div>' + nm('o-gp-name', d.username, 20) + '</div></div></div>';
    },
  });
  K.register({
    key: 'subscriber-grandprix', eventType: 'subscription', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'overtake', fx: 'checker', anim: hold('1.9s'), exit: GP_EXIT, len: 1.9,
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), tyre = TYRE[String(d.tier || '1')] || TYRE['1'];
      var pos = '', ghosts = '';
      for (var i = 0; i < 5; i++) pos += '<div class="o-gps-pos" style="--p:' + i + '">' + (i + 1) + '</div>';
      var colours = ['#FF8A1E', '#2EC5FF', '#B9B9C6', '#2BD46C'], widths = [46, 58, 38, 52], gd = [1.24, 1.02, 0.80, 0.58];
      for (var j = 0; j < 4; j++) ghosts += '<div class="o-gps-row ghost" style="--slot:' + (j + 1) + ';--gd:' + gd[j] + 's;--tc:' + colours[j] + ';--w:' + widths[j] + 'px"></div>';
      var me = '<div class="o-gps-row me" style="--slot:0"><span class="o-gps-code">' + esc(code3(d.username)) + '</span><span class="o-gps-gain">▲4</span></div>';
      var heading = months > 1 ? 'Resubscribed · ' + months + ' months' : 'New subscriber';
      return '<div class="obj o-gp o-gps"><div class="o-gps-tower"><div class="o-gps-head"><span>Lap</span><b>' + months + '</b></div>' + pos + ghosts + me + '</div>'
        + '<div class="o-gp-plate o-gps-panel"><i class="o-gp-stripe"></i>'
        + '<div class="o-gp-label" style="--k:0">' + label(d, heading) + '</div>'
        + nm('o-gp-name', d.username, 13, '--k:1;')
        + '<div class="o-gps-meta" style="--k:2"><span class="o-gps-tyre" style="--tyre:' + tyre[1] + '">' + tyre[0] + '</span>Tier ' + esc(d.tier || '1') + '</div>'
        + (d.message ? '<div class="o-gps-msg" style="--k:3">' + esc(d.message) + '</div>' : '')
        + '</div></div>';
    },
  });
  K.register({
    key: 'bits-grandprix', eventType: 'bits', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'sectors', fx: 'sparks', anim: hold('1.3s'), exit: GP_EXIT, len: 1.4,
    render: function (d) {
      var n = intOf(d.amount != null ? d.amount : d.bits), size = intOf(K.sizeOf(d, 'bits')), lvl = size >= 1000 ? 'big' : size >= 100 ? 'medium' : 'small';
      var C = { y: 'var(--gp-yellow)', g: 'var(--gp-green)', p: 'var(--gp-purple)' };
      var sets = { small: ['y', 'g', 'g'], medium: ['g', 'g', 'p'], big: ['p', 'p', 'p'] }[lvl];
      var cap = { small: ['Personal best', C.g], medium: ['Fastest sector', C.p], big: ['Purple lap', C.p] }[lvl];
      var sectors = sets.map(function (k, i) { return '<div class="o-gpb-s" style="--sc:' + C[k] + ';--sd:' + (0.32 + i * 0.26).toFixed(2) + 's"><span>S' + (i + 1) + '</span><i class="o-gpb-bar"></i></div>'; }).join('');
      return '<div class="obj o-gp o-gpb lvl-' + lvl + '"><div class="o-gp-plate o-gpb-top"><i class="o-gp-stripe"></i>'
        + '<div class="o-gpb-who"><div class="o-gp-label">' + label(d, 'Bits') + ' · <b style="color:' + cap[1] + '">' + cap[0] + '</b></div>' + nm('o-gp-name', d.username, 12) + '</div>'
        + '<div class="o-gpb-amt">' + odo(fmt(n), 0.3, 0.82) + '<small>bits</small></div></div>'
        + '<div class="o-gpb-sectors">' + sectors + '</div></div>';
    },
  });
  K.register({
    key: 'donation-grandprix', eventType: 'donation', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'radio', fx: 'none', anim: hold('0.9s'), exit: GP_EXIT,
    len: function (d) { var n = Array.from(d.message || '').length; return n ? 0.6 + Math.min(2.2, n * 0.035) : 1; },
    render: function (d) {
      var text = d.message ? '“' + d.message + '”' : '', count = Array.from(text).length;
      var per = count ? Math.min(0.035, 2.0 / count) : 0, T = count ? count * per + 0.25 : 0.9;
      var msg = typed(text, 0.58, per, 160), r = rng(hash(d.username + d.amount)), bars = '';
      for (var i = 0; i < 40; i++) {
        var dur = 0.14 + r() * 0.12, wi = 2 * Math.max(1, Math.round(T / (2 * dur)));
        bars += '<i class="o-gpd-bar" style="--h:' + (0.3 + r() * 0.7).toFixed(2) + ';--wdur:' + dur.toFixed(2) + 's;--wd:' + (0.5 + r() * 0.1).toFixed(2) + 's;--wi:' + wi + '"></i>';
      }
      return '<div class="obj o-gp o-gpd"><div class="o-gp-plate o-gpd-box"><i class="o-gp-stripe"></i>'
        + '<div class="o-gpd-head"><span class="o-gpd-radio">' + label(d, 'Team radio') + '</span><span class="o-gpd-amt">' + esc(money(d.amount, d.currency)) + '</span></div>'
        + nm('o-gp-name', d.username, 18)
        + '<div class="o-gpd-wave">' + bars + '</div>'
        + (msg.n ? '<div class="o-gpd-msg o-typed" style="' + msg.style + '">' + msg.html + '</div>' : '')
        + '</div></div>';
    },
  });
  K.register({
    key: 'raid-grandprix', eventType: 'raid', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'raceControl', fx: 'smoke', anim: hold('1.4s'), exit: GP_EXIT,
    len: function (d) { return 1.4 + Math.min(12, intOf(K.sizeOf(d, 'raid'))) * 0.07; },
    render: function (d) {
      var v = intOf(d.viewers), shown = Math.min(intOf(K.sizeOf(d, 'raid')), 12), cars = '', strips = '';
      var pal = ['var(--gpa)', '#FFFFFF', '#FFD12B', '#2EC5FF', '#FF8A1E', '#2BD46C', '#B9B9C6', '#FF4FA3'];
      for (var i = 0; i < shown; i++) cars += '<i class="o-gpr-car" style="--ci:' + i + ';--cc:' + pal[i % pal.length] + '"></i>';
      for (var s = 0; s < 8; s++) strips += '<i class="o-gpr-strip" style="--i:' + s + '"></i>';
      return '<div class="obj o-gp o-gpr"><div class="o-gpr-flash"></div>'
        + '<div class="o-gpr-head"><div class="o-gpr-flag">' + strips + '</div><div class="o-gpr-headtxt"><small>Race control</small><b>Red flag</b></div></div>'
        + '<div class="o-gp-plate o-gpr-body">'
        + '<div class="o-gp-label" style="--k:0">' + label(d, 'Raid incoming') + '</div>'
        + nm('o-gp-name', d.username, 20, '--k:1;')
        + '<div class="o-gpr-msg" style="--k:2">' + odo(fmt(v), 0.62, 0.7) + '<span>' + (v === 1 ? 'car' : 'cars') + ' entering the pit lane</span></div>'
        + '<div class="o-gpr-lane" style="--k:3">' + cars + (v > shown ? '<span class="o-gpr-more">+' + fmt(v - shown) + '</span>' : '') + '</div>'
        + '</div></div>';
    },
  });
  K.register({
    key: 'giveaway-grandprix', eventType: 'giveaway_winner', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'podium', fx: 'champagne', anim: hold('1.5s'), exit: GP_EXIT, len: 1.8,
    render: function (d) {
      var r = rng(hash(d.username));
      function drops(side) {
        var out = '';
        for (var i = 0; i < 14; i++) {
          var dx = (side === 'l' ? 1 : -1) * (40 + r() * 120), dy = -(30 + r() * 80);
          out += '<i class="o-gpg-drop" style="--dx:' + dx.toFixed(0) + 'px;--dy:' + dy.toFixed(0) + 'px;--du:' + (0.7 + r() * 0.5).toFixed(2) + 's;--dd:' + (1.0 + r() * 0.45).toFixed(2) + 's"></i>';
        }
        return out;
      }
      return '<div class="obj o-gp o-gpg"><div class="o-gpg-trophy">' + TROPHY + '</div>'
        + '<div class="o-gpg-winner"><div class="o-gp-label">' + label(d, 'Giveaway winner') + '</div>' + nm('o-gp-name', d.username, 18) + '</div>'
        + '<div class="o-gpg-podium"><div class="o-gpg-step p2">2</div><div class="o-gpg-step p1">1</div><div class="o-gpg-step p3">3</div></div>'
        + '<div class="o-gpg-base"></div>'
        + '<div class="o-gpg-spray l">' + drops('l') + '</div><div class="o-gpg-spray r">' + drops('r') + '</div>'
        + (d.prize ? '<div class="o-gpg-prize">Won <b>' + esc(d.prize) + '</b></div>' : '')
        + '</div>';
    },
  });

  Object.keys(SOUNDS).forEach(function (k) { K.registerSound(k, FAMILY, SOUNDS[k]); });
})(typeof window !== 'undefined' ? window : null);
