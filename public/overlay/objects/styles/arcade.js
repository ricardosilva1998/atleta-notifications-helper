'use strict';

/**
 * Arcade (docs/superpowers/specs/2026-10-15-alert-styles-design.md, Appendix A), ported from the proposal
 * (docs/superpowers/specs/assets/2026-10-15-alert-styles/parts/90-core.js and 40-styles.css).
 * Its names and descriptions are in the locale files (overlayBuilder.families.arcade, overlayBuilder.looks.<id>,
 * overlayBuilder.sounds.<key>). Its classes start with .o-ar and its keyframes with ar.
 */
(function (root) {
  var K = (root && root.ATLETA_KIT) || require('../kit.js');
  var FAMILY = 'arcade';
  var esc = K.esc, money = K.money, fitStyle = K.fitStyle, nm = K.nm, fmt = K.fmt, label = K.label, odo = K.odo, typed = K.typed, hash = K.hash, rng = K.rng, intOf = K.intOf, tone = K.tone;
  var SOUNDS = {};
  function hold(dur) { return { in: 'hold', dur: dur, ease: 'linear' }; }
  // Every look takes the streamer's colour and its speed, and its main text when it shows one.
  var CONTROLS = { colour: 'accent', label: true, speed: true };
  var CONTROLS_NO_TEXT = { colour: 'accent', label: false, speed: true };
  K.registerFamily({ key: FAMILY, order: 4, fonts: ["Press+Start+2P","Racing+Sans+One"] });

  var AR_IN = { in: 'arPop', dur: '0.24s', ease: 'steps(4)' };
  var AR_EXIT = { out: 'arExit', dur: '0.3s', ease: 'steps(4)' };

  SOUNDS.checkpoint = function () { [988, 1319, 1568, 1976].forEach(function (f, i) { tone({ f: f, d: 0.09, v: 0.05, type: 'square', t: 0.1 + i * 0.07 }); }); };
  SOUNDS.oneup = function () { [659, 784, 1319, 1047, 1175, 1568].forEach(function (f, i) { tone({ f: f, d: 0.1, v: 0.05, type: 'square', t: 0.5 + i * 0.085 }); }); };
  SOUNDS.coins = function () { for (var i = 0; i < 4; i++) { tone({ f: 988, d: 0.07, v: 0.05, type: 'square', t: 0.2 + i * 0.1 }); tone({ f: 1319, d: 0.18, v: 0.05, type: 'square', t: 0.27 + i * 0.1 }); } };
  SOUNDS.record = function () { [523, 659, 784, 1046, 784, 1046].forEach(function (f, i) { tone({ f: f, d: 0.11, v: 0.05, type: 'square', t: 0.74 + i * 0.09 }); }); };
  SOUNDS.siren = function () { for (var i = 0; i < 4; i++) tone({ f: 520, f2: 880, d: 0.2, v: 0.04, type: 'sawtooth', t: 0.08 + i * 0.22 }); };
  SOUNDS.winner = function () { [784, 784, 784, 1046].forEach(function (f, i) { tone({ f: f, d: i === 3 ? 0.5 : 0.1, v: 0.06, type: 'square', t: 0.2 + i * 0.13 }); }); };

  var AR_PAL = ['var(--ara)', 'var(--ar-c)', 'var(--ar-y)', '#FFFFFF', 'var(--ar-o)', '#8CFF6B'];
  K.register({
    key: 'follow-arcade', eventType: 'follow', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'checkpoint', fx: 'speed', anim: AR_IN, exit: AR_EXIT,
    len: function (d) { return 0.7 + Array.from(d.username || '').length * 0.045; },
    render: function (d) {
      var t = typed(d.username, 0.62, 0.045, 40), lines = '', widths = [120, 180, 90, 150, 110], tops = [20, 36, 54, 70, 86];
      for (var i = 0; i < 5; i++) lines += '<i class="o-arf-line" style="top:' + tops[i] + '%;width:' + widths[i] + 'px;--ld:' + (0.05 + i * 0.05).toFixed(2) + 's"></i>';
      return '<div class="obj o-ar o-arf"><div class="o-arf-title o-ar-chrome">CHECKPOINT!</div>'
        + '<div class="o-ar-plate o-ar-scan o-arf-plate"><div class="o-arf-lines">' + lines + '</div>'
        + '<div class="o-ar-px o-arf-lbl">' + label(d, 'New racer joined') + '</div>'
        + '<div class="o-ar-name o-typed" style="' + fitStyle(d.username, 21) + t.style + '">' + t.html + '<span class="o-ar-cur"></span></div>'
        + '</div></div>';
    },
  });
  K.register({
    key: 'subscriber-arcade', eventType: 'subscription', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'oneup', fx: 'none', anim: hold('0.3s'), exit: AR_EXIT,
    len: function (d) { return 1.1 + Array.from(d.username || '').length * 0.045; },
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), cls = { '1': 'C', '2': 'B', '3': 'A' }[String(d.tier || '1')] || 'C';
      var t = typed(d.username, 1.06, 0.045, 40);
      return '<div class="obj o-ar o-ars"><div class="o-ars-scene o-ar-scan"><div class="o-ars-sun"></div><div class="o-ars-hills"></div><div class="o-ars-floor"><div class="o-ars-grid"></div></div></div>'
        + '<div class="o-ars-stage o-ar-chrome">STAGE ' + months + '</div>'
        + '<div class="o-ar-px o-ars-sub">' + label(d, months > 1 ? 'Extended play!' : 'New player!') + ' · Class ' + cls + '</div>'
        + '<div class="o-ars-band"><div class="o-ar-name o-typed" style="' + fitStyle(d.username, 22) + t.style + '">' + t.html + '</div></div></div>';
    },
  });
  K.register({
    key: 'bits-arcade', eventType: 'bits', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'coins', fx: 'confetti', anim: AR_IN, exit: AR_EXIT, len: 1.4,
    render: function (d) {
      var n = intOf(d.amount != null ? d.amount : d.bits), size = intOf(K.sizeOf(d, 'bits')), lvl = size >= 1000 ? 'big' : size >= 100 ? 'medium' : 'small';
      var count = { small: 4, medium: 7, big: 12 }[lvl], r = rng(hash(d.username + size)), coins = '';
      for (var i = 0; i < count; i++) coins += '<i class="o-arb-coin" style="--cx:' + (-70 + r() * 260).toFixed(0) + 'px;--cy:' + (-40 - r() * 50).toFixed(0) + 'px;--cd:' + (0.3 + i * 0.06).toFixed(2) + 's"></i>';
      return '<div class="obj o-ar o-arb lvl-' + lvl + '"><div class="o-arb-plus o-ar-chrome">+' + fmt(n) + '</div>'
        + '<div class="o-ar-plate o-ar-scan o-arb-plate"><div class="o-arb-cred"><span class="o-ar-px">Credits</span><b>' + odo(String(n).padStart(6, '0'), 0.3, 0.75) + '</b></div>'
        + '<div class="o-arb-who"><div class="o-ar-px o-arb-bonus">' + label(d, lvl === 'big' ? 'High score!' : 'Bonus!') + '</div>' + nm('o-ar-name', d.username, 17) + '</div></div>'
        + '<div class="o-arb-coins">' + coins + '</div></div>';
    },
  });
  K.register({
    key: 'donation-arcade', eventType: 'donation', family: FAMILY, controls: CONTROLS_NO_TEXT, grows: false,
    sound: 'record', fx: 'confetti', anim: AR_IN, exit: AR_EXIT,
    len: function (d) { var n = Array.from(d.message || '').length; return 1.3 + Math.min(1.6, n * 0.03); },
    render: function (d) {
      var amt = Number(d.amount) || 0, n = Array.from(d.message || '').length;
      var t = typed(d.message || '', 1.15, Math.min(0.03, 1.6 / Math.max(1, n)), 120);
      return '<div class="obj o-ar o-ard"><div class="o-ard-title o-ar-chrome">NEW RECORD!</div>'
        + '<div class="o-ar-plate o-ar-scan o-ard-plate"><div class="o-ard-head o-ar-px"><span class="o-ard-col">Rank</span><span class="o-ard-col">Name</span><span class="o-ard-col">Score</span></div>'
        + '<div class="o-ard-rows"><span class="o-ard-rank" style="--r:0">1ST</span><span class="o-ard-rank" style="--r:1">2ND</span><span class="o-ard-rank" style="--r:2">3RD</span>'
        + '<div class="o-ard-row ghost" style="--r:1"><span>ACE</span><span>' + esc(money((amt * 0.8).toFixed(2), d.currency)) + '</span></div>'
        + '<div class="o-ard-row ghost" style="--r:2"><span>JET</span><span>' + esc(money((amt * 0.45).toFixed(2), d.currency)) + '</span></div>'
        + '<div class="o-ard-row me" style="--r:0">' + nm('o-ar-name', d.username, 16) + '<span>' + esc(money(d.amount, d.currency)) + '</span></div></div>'
        + (t.n ? '<div class="o-ar-px o-ard-msg o-typed" style="' + t.style + '">' + t.html + '<span class="o-ar-cur"></span></div>' : '')
        + '</div></div>';
    },
  });
  K.register({
    key: 'raid-arcade', eventType: 'raid', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'siren', fx: 'none', anim: { in: 'arrShake', dur: '0.5s', ease: 'linear' }, exit: AR_EXIT,
    len: function (d) { return 1.5 + Math.min(10, intOf(K.sizeOf(d, 'raid'))) * 0.08; },
    render: function (d) {
      var v = intOf(d.viewers), n = Math.min(intOf(K.sizeOf(d, 'raid')), 10), cars = '';
      for (var i = 0; i < n; i++) cars += '<i class="o-arr-car" style="--ci:' + i + ';--cn:' + n + ';--cc:' + AR_PAL[i % AR_PAL.length] + '"></i>';
      return '<div class="obj o-ar o-arr"><div class="o-arr-haz t"></div>'
        + '<div class="o-ar-plate o-ar-scan o-arr-plate"><div class="o-arr-warn o-ar-chrome">WARNING!</div>'
        + '<div class="o-ar-px o-arr-sub">' + label(d, 'Rival team approaching') + '</div>'
        + nm('o-ar-name', d.username, 22)
        + '<div class="o-arr-lane">' + cars + '</div>'
        + '<div class="o-ar-px o-arr-count">×' + odo(fmt(v), 0.9, 0.6) + ' ' + (v === 1 ? 'racer' : 'racers') + '</div></div>'
        + '<div class="o-arr-haz b"></div></div>';
    },
  });
  K.register({
    key: 'giveaway-arcade', eventType: 'giveaway_winner', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'winner', fx: 'confetti', anim: hold('0.2s'), exit: AR_EXIT,
    len: function (d) { return 1.3 + Array.from(d.username || '').length * 0.045; },
    render: function (d) {
      var t = typed(d.username, 0.66, 0.045, 40), r = rng(hash(d.username)), conf = '';
      for (var i = 0; i < 18; i++) conf += '<i class="o-arg-piece" style="--x:' + (r() * 100).toFixed(0) + '%;--cc:' + AR_PAL[i % AR_PAL.length] + ';--rot:' + (180 + r() * 540).toFixed(0) + 'deg;--du:' + (1.1 + r() * 0.8).toFixed(2) + 's;--dd:' + (0.5 + r() * 0.6).toFixed(2) + 's"></i>';
      return '<div class="obj o-ar o-arg"><div class="o-arg-burst"></div><div class="o-arg-title o-ar-chrome">WINNER!</div>'
        + '<div class="o-ar-plate o-ar-scan o-arg-plate"><div class="o-ar-px o-arg-lbl">' + label(d, 'Giveaway · player 1') + '</div>'
        + '<div class="o-ar-name o-typed" style="' + fitStyle(d.username, 22) + t.style + '">' + t.html + '</div>'
        + (d.prize ? '<div class="o-ar-px o-arg-prize">Prize: ' + esc(d.prize) + '</div>' : '') + '</div>'
        + '<div class="o-arg-conf">' + conf + '</div></div>';
    },
  });

  Object.keys(SOUNDS).forEach(function (k) { K.registerSound(k, FAMILY, SOUNDS[k]); });
})(typeof window !== 'undefined' ? window : null);
