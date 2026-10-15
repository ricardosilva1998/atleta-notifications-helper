'use strict';

/**
 * Glass (docs/superpowers/specs/2026-10-15-alert-styles-design.md, Appendix A), ported from the proposal
 * (docs/superpowers/specs/assets/2026-10-15-alert-styles/parts/fam/gl.js and .css).
 * Its names and descriptions are in the locale files (overlayBuilder.families.glass, overlayBuilder.looks.<id>,
 * overlayBuilder.sounds.<key>). Its classes start with .o-gl and its keyframes with gl.
 */
/* ═════════ GLASS — clean and minimal (styles in 45-glass.css) ═════════
   For streamers who want something quiet: tinted panels, one sheen, soft chimes. */
(function (root) {
  var K = (root && root.ATLETA_KIT) || require('../kit.js');
  var FAMILY = 'glass';
  var esc = K.esc, money = K.money, fitStyle = K.fitStyle, nm = K.nm, fmt = K.fmt, label = K.label, odo = K.odo, hash = K.hash, rng = K.rng, intOf = K.intOf, tone = K.tone, noise = K.noise;
  var SOUNDS = {};
  function hold(dur) { return { in: 'hold', dur: dur, ease: 'linear' }; }
  // Every look takes the streamer's colour and its speed, and its main text when it shows one.
  var CONTROLS = { colour: 'accent', label: true, speed: true };
  var CONTROLS_NO_TEXT = { colour: 'accent', label: false, speed: true };
  K.registerFamily({ key: FAMILY, order: 9, fonts: ["DM+Sans:ital,wght@0,400;0,500;0,600;1,400","Manrope:wght@500;700;800"] });


  SOUNDS.glFollow = function () { tone({ f: 1046, d: 0.35, v: 0.06, t: 0.12 }); tone({ f: 1568, d: 0.6, v: 0.045, t: 0.2 }); };
  SOUNDS.glSub = function () { [784, 988, 1318].forEach(function (f, i) { tone({ f: f, d: 0.5, v: 0.05, t: 0.3 + i * 0.12 }); }); };
  SOUNDS.glBits = function () { for (var i = 0; i < 6; i++) tone({ f: 2400 + i * 120, d: 0.035, v: 0.035, t: 0.25 + i * 0.09 }); tone({ f: 1760, d: 0.6, v: 0.05, t: 0.85 }); };
  SOUNDS.glDonation = function () { tone({ f: 1046, d: 1.1, v: 0.07, t: 0.3 }); tone({ f: 2093, d: 0.8, v: 0.025, t: 0.3 }); tone({ f: 1568, d: 0.7, v: 0.03, t: 0.32 }); };
  SOUNDS.glRaid = function () { noise({ ft: 'lowpass', f: 300, f2: 1600, d: 0.9, v: 0.12, a: 0.4, t: 0.05 }); [523, 659, 784].forEach(function (f) { tone({ f: f, d: 0.9, v: 0.035, type: 'triangle', t: 0.55 }); }); };
  SOUNDS.glGiveaway = function () { [1046, 1318, 1568, 2093].forEach(function (f, i) { tone({ f: f, d: 0.28, v: 0.05, type: 'triangle', t: 0.4 + i * 0.08 }); }); noise({ ft: 'highpass', f: 6000, d: 0.6, v: 0.04, a: 0.1, t: 0.45 }); };

  var GL_EXIT = { out: 'glOut', dur: '0.36s', ease: 'cubic-bezier(.4,0,.6,1)' };
  var GL_CHECK = '<svg class="o-gld-check" viewBox="0 0 24 24" aria-hidden="true"><circle class="o-gld-cc" cx="12" cy="12" r="10.5" pathLength="100"/><path class="o-gld-ck" d="M7 12.4l3.3 3.2 6.9-7" pathLength="100"/></svg>';
  var GL_PEOPLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 18.5c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/><circle cx="16.5" cy="9" r="2.6"/><path d="M15 13.7c2.6-.2 4.7 1.2 5.5 4.3"/></svg>';
  // The follower's first letter for the round avatar (a whole character, so an emoji or a CJK name works too).
  function glInitial(name) { var c = Array.from(String(name || '').trim())[0] || '?'; return esc(c.toUpperCase()); }

  K.register({
    key: 'follow-glass', eventType: 'follow', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'glFollow', fx: 'none', anim: hold('0.9s'), exit: GL_EXIT, len: 1.0,
    render: function (d) {
      return '<div class="obj o-gl o-glf"><div class="o-gl-panel o-glf-pill"><i class="o-gl-sheen" style="--sh:.5s"></i>'
        + '<div class="o-glf-av"><span>' + glInitial(d.username) + '</span><i class="o-glf-ring"></i></div>'
        + '<div class="o-glf-txt"><div class="o-gl-lbl o-gl-in" style="--k:0">' + label(d, 'New follower') + '</div>'
        + '<div class="o-glf-line o-gl-in" style="--k:1"><span class="o-glf-nm" style="' + fitStyle(d.username, 16) + '">' + esc(d.username) + '</span><span class="o-gl-muted">followed you</span></div></div>'
        + '</div></div>';
    },
  });

  K.register({
    key: 'subscriber-glass', eventType: 'subscription', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'glSub', fx: 'none', anim: hold('1.3s'), exit: GL_EXIT, len: 1.3,
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), ring = Math.max(1, K.sizeOf(d, 'months')), full = ring >= 12;
      var off = (100 - Math.min(ring, 12) / 12 * 100).toFixed(1);
      return '<div class="obj o-gl o-gls"><div class="o-gl-panel o-gls-card"><i class="o-gl-sheen" style="--sh:1s"></i>'
        + '<div class="o-gls-ring' + (full ? ' o-gls-full' : '') + '" style="--off:' + off + '">'
        + '<svg viewBox="0 0 84 84" aria-hidden="true"><circle class="o-gls-rt" cx="42" cy="42" r="36" pathLength="100"/><circle class="o-gls-rp" cx="42" cy="42" r="36" pathLength="100"/></svg>'
        + '<div class="o-gls-c"><b>' + odo(String(months), 0.3, 0.8) + '</b><small>' + (months === 1 ? 'month' : 'months') + '</small></div></div>'
        + '<div class="o-gls-txt"><div class="o-gl-lbl o-gl-in" style="--k:0">' + label(d, months > 1 ? 'Resubscribed' : 'New subscriber') + '</div>'
        + nm('o-gl-name o-gl-in', d.username, 14, '--k:1;')
        + '<div class="o-gl-muted o-gl-in" style="--k:2">Tier ' + esc(d.tier || '1') + ' subscriber</div>'
        + (d.message ? '<div class="o-gl-muted o-gls-msg o-gl-in" style="--k:3">' + esc(d.message) + '</div>' : '')
        + '</div></div></div>';
    },
  });

  K.register({
    key: 'bits-glass', eventType: 'bits', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'glBits', fx: 'none', anim: hold('1.2s'), exit: GL_EXIT, len: 1.3,
    render: function (d) {
      var n = intOf(d.amount != null ? d.amount : d.bits), size = K.sizeOf(d, 'bits');
      var w = Math.max(6, Math.min(100, Math.log10(size + 1) / 4 * 100)).toFixed(0);
      return '<div class="obj o-gl o-glb' + (size >= 1000 ? ' o-glb-big' : '') + '"><div class="o-gl-panel o-glb-card"><i class="o-gl-sheen" style="--sh:1s"></i>'
        + '<div class="o-gl-lbl o-gl-in" style="--k:0">' + label(d, 'Bits') + '</div>'
        + '<div class="o-glb-num o-gl-in" style="--k:1">' + odo(fmt(n), 0.25, 0.85) + '<span>bits</span></div>'
        + '<div class="o-gl-muted o-glb-from o-gl-in" style="--k:2"><span>from</span><b>' + esc(d.username) + '</b></div>'
        + '<div class="o-glb-bar"><i class="o-glb-fill" style="width:' + w + '%"></i></div>'
        + '</div></div>';
    },
  });

  K.register({
    key: 'donation-glass', eventType: 'donation', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'glDonation', fx: 'none', anim: hold('1s'), exit: GL_EXIT, len: 1.1,
    render: function (d) {
      return '<div class="obj o-gl o-gld"><div class="o-gl-panel o-gld-card"><i class="o-gl-sheen" style="--sh:1.05s"></i>'
        + '<div class="o-gld-top o-gl-in" style="--k:0"><span class="o-gl-lbl">' + label(d, 'Donation') + '</span>' + GL_CHECK + '</div>'
        + '<div class="o-gld-amt o-gl-in" style="--k:1">' + esc(money(d.amount, d.currency)) + '</div>'
        + '<div class="o-gl-muted o-gld-from o-gl-in" style="--k:2">from <b>' + esc(d.username) + '</b></div>'
        + (d.message ? '<div class="o-gld-msg o-gl-in" style="--k:3"><i class="o-gld-line"></i>“' + esc(d.message) + '”</div>' : '')
        + '</div></div>';
    },
  });

  K.register({
    key: 'raid-glass', eventType: 'raid', family: FAMILY, controls: CONTROLS, grows: true,
    sound: 'glRaid', fx: 'none', anim: hold('1s'), exit: GL_EXIT,
    len: function (d) { return 0.8 + Math.min(12, K.sizeOf(d, 'raid')) * 0.05; },
    render: function (d) {
      var v = intOf(d.viewers), size = K.sizeOf(d, 'raid'), shown = Math.min(size, 12), r = rng(hash(d.username + size)), crowd = '';
      for (var i = 0; i < shown; i++) {
        var h = Math.floor(r() * 360);
        crowd += '<i class="o-glr-av" style="--i:' + i + ';--h1:' + h + ';--h2:' + ((h + 40) % 360) + '"></i>';
      }
      if (v > shown) crowd += '<span class="o-glr-more" style="--i:' + shown + '">+' + fmt(v - shown) + '</span>';
      return '<div class="obj o-gl o-glr"><div class="o-gl-panel o-glr-card"><i class="o-gl-sheen" style="--sh:1.15s"></i>'
        + '<div class="o-glr-top"><div class="o-glr-icon">' + GL_PEOPLE + '<i class="o-glr-wave"></i><i class="o-glr-wave o-glr-w2"></i></div>'
        + '<div class="o-glr-txt"><div class="o-gl-lbl o-gl-in" style="--k:0">' + label(d, 'Raid') + '</div>'
        + nm('o-gl-name o-gl-in', d.username, 15, '--k:1;')
        + '<div class="o-gl-muted o-glr-count o-gl-in" style="--k:2"><span>is raiding with</span><b>' + odo(fmt(v), 0.4, 0.7) + '</b><span>' + (v === 1 ? 'viewer' : 'viewers') + '</span></div></div></div>'
        + '<div class="o-glr-crowd">' + crowd + '</div>'
        + '</div></div>';
    },
  });

  K.register({
    key: 'giveaway-glass', eventType: 'giveaway_winner', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'glGiveaway', fx: 'confetti', anim: hold('1.3s'), exit: GL_EXIT, len: 1.4,
    render: function (d) {
      var r = rng(hash(d.username)), sparks = '';
      for (var i = 0; i < 5; i++) {
        var left = i % 2 ? 82 + r() * 12 : 4 + r() * 12;
        sparks += '<i class="o-glg-spark" style="left:' + left.toFixed(0) + '%;top:' + (10 + r() * 66).toFixed(0) + '%;--ss:' + (6 + r() * 7).toFixed(0) + 'px;--sd:' + (0.7 + i * 0.09).toFixed(2) + 's"></i>';
      }
      return '<div class="obj o-gl o-glg"><i class="o-glg-spot"></i><div class="o-gl-panel o-glg-card"><i class="o-gl-sheen" style="--sh:1.25s"></i>' + sparks
        + '<div class="o-glg-lbl o-gl-in" style="--k:0">' + label(d, 'Winner') + '</div>'
        + nm('o-glg-name o-gl-in', d.username, 17, '--k:1;')
        + (d.prize ? '<div class="o-gl-muted o-glg-prize o-gl-in" style="--k:2">Won <b>' + esc(d.prize) + '</b></div>' : '')
        + '</div></div>';
    },
  });

  Object.keys(SOUNDS).forEach(function (k) { K.registerSound(k, FAMILY, SOUNDS[k]); });
})(typeof window !== 'undefined' ? window : null);
