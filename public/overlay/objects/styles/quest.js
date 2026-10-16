'use strict';

/**
 * Quest (docs/superpowers/specs/2026-10-15-alert-styles-design.md, Appendix A), ported from the proposal
 * (docs/superpowers/specs/assets/2026-10-15-alert-styles/parts/fam/qs.js and .css).
 * Its names and descriptions are in the locale files (overlayBuilder.families.quest, overlayBuilder.looks.<id>,
 * overlayBuilder.sounds.<key>). Its classes start with .o-qs and its keyframes with qs.
 */
/* ═══ Quest — fantasy RPG: parchment, gold leaf, wax and steel ═══ */
(function (root) {
  var K = (root && root.ATLETA_KIT) || require('../kit.js');
  var FAMILY = 'quest';
  var esc = K.esc, money = K.money, nm = K.nm, fmt = K.fmt, label = K.label, odo = K.odo, hash = K.hash, rng = K.rng, intOf = K.intOf, tone = K.tone, noise = K.noise;
  var SOUNDS = {};
  // Every look takes the streamer's colour and its speed, and its main text when it shows one.
  var CONTROLS = { colour: 'accent', label: true, speed: true };
  var CONTROLS_NO_TEXT = { colour: 'accent', label: false, speed: true };
  K.registerFamily({ key: FAMILY, order: 5, fonts: ["Cinzel:wght@600;700;900","EB+Garamond:ital,wght@0,500;0,600;1,500"] });


  SOUNDS.qsFollow = function () {
    noise({ ft: 'bandpass', f: 1800, f2: 700, q: 0.8, t: 0.2, d: 0.55, v: 0.16, a: 0.05 });
    tone({ f: 1318, d: 0.5, v: 0.05, t: 0.9 });
    tone({ f: 2637, d: 0.4, v: 0.025, t: 1.06 });
  };
  SOUNDS.qsSub = function () {
    [523, 659, 784, 1046].forEach(function (f, i) { tone({ f: f, d: 0.16, v: 0.09, type: 'triangle', t: 0.45 + i * 0.09 }); });
    [523, 659, 784].forEach(function (f) { tone({ f: f * 2, d: 0.8, v: 0.04, type: 'triangle', t: 0.85 }); });
    tone({ f: 1568, d: 0.5, v: 0.03, t: 1.42 });
  };
  SOUNDS.qsBits = function () {
    tone({ f: 110, f2: 60, d: 0.22, v: 0.3, a: 0.003 });
    noise({ ft: 'lowpass', f: 500, f2: 220, t: 0.36, d: 0.3, v: 0.16 });
    for (var i = 0; i < 7; i++) tone({ f: 2200 + (i % 3) * 500, d: 0.06, v: 0.03, type: 'square', t: 0.55 + i * 0.07 });
  };
  SOUNDS.qsDonation = function () {
    noise({ ft: 'bandpass', f: 1500, f2: 600, q: 0.7, t: 0.2, d: 0.6, v: 0.14, a: 0.06 });
    tone({ f: 130, f2: 60, d: 0.3, v: 0.35, a: 0.003, t: 1.12 });
    noise({ ft: 'lowpass', f: 400, t: 1.12, d: 0.12, v: 0.2 });
    tone({ f: 392, d: 0.7, v: 0.05, type: 'triangle', t: 1.2 });
  };
  SOUNDS.qsRaid = function () {
    tone({ f: 220, f2: 233, d: 0.9, v: 0.07, type: 'triangle', t: 0.15 });
    for (var i = 0; i < 5; i++) {
      tone({ f: 92, f2: 44, d: 0.35, v: 0.42, a: 0.003, t: 0.7 + i * 0.18 });
      noise({ ft: 'lowpass', f: 380, d: 0.07, v: 0.18, t: 0.7 + i * 0.18 });
    }
  };
  SOUNDS.qsGiveaway = function () {
    tone({ f: 110, f2: 220, d: 1.0, v: 0.06, type: 'triangle', t: 0.1 });
    [1568, 2093, 2637, 3136].forEach(function (f, i) { tone({ f: f, d: 0.8, v: 0.045, t: 0.9 + i * 0.08 }); });
  };

  K.register({
    key: 'follow-quest', eventType: 'follow', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'qsFollow', fx: 'none',
    anim: { in: 'qsDrop', dur: '0.22s', ease: 'cubic-bezier(.3,.8,.3,1)' },
    exit: { out: 'qsExitUp', dur: '0.55s', ease: 'linear' }, len: 1.3,
    render: function (d) {
      return '<div class="obj o-qs o-qsf"><div class="o-qs-paper o-qsf-paper"><i class="o-qsf-glint"></i><div class="o-qsf-in">'
        + '<div class="o-qs-kicker">' + label(d, 'Quest accepted') + '</div>' + nm('o-qs-name', d.username, 17)
        + '<div class="o-qsf-line">joined the party</div></div></div>'
        + '<div class="o-qsf-half l"><i class="o-qs-rod"></i></div><div class="o-qsf-half r"><i class="o-qs-rod"></i></div></div>';
    },
  });

  K.register({
    key: 'subscriber-quest', eventType: 'subscription', family: FAMILY, controls: CONTROLS, grows: false,
    amount: 'Months as levels', sound: 'qsSub', fx: 'sparks',
    anim: { in: 'hold', dur: '1.5s', ease: 'linear' },
    exit: { out: 'qsExitDown', dur: '0.4s', ease: 'cubic-bezier(.5,0,.9,.4)' }, len: 1.45,
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), tier = Math.min(3, Math.max(1, intOf(d.tier) || 1)), stars = '';
      for (var i = 0; i < 3; i++) stars += '<i class="o-qss-star' + (i < tier ? ' on' : '') + '" style="--sd:' + (1.12 + i * 0.08).toFixed(2) + 's"></i>';
      return '<div class="obj o-qs o-qss"><div class="o-qss-plate"></div><div class="o-qss-rays"></div>'
        + '<div class="o-qss-crestw"><div class="o-qss-crest"><i></i><span class="o-qss-lv">LV</span><span class="o-qss-num">' + months + '</span></div></div>'
        + '<div class="o-qss-txt"><div class="o-qss-up">' + label(d, 'Level up!') + '</div>' + nm('o-qs-name', d.username, 15)
        + '<div class="o-qss-meta"><span class="o-qss-stars">' + stars + '</span><span>Tier ' + tier + ' · ' + months + (months === 1 ? ' month' : ' months') + '</span></div>'
        + '<div class="o-qss-xp"><b>XP</b><i class="o-qss-fill"></i></div></div></div>';
    },
  });

  K.register({
    key: 'bits-quest', eventType: 'bits', family: FAMILY, controls: CONTROLS, grows: true,
    amount: 'Grows with the amount', sound: 'qsBits', fx: 'none',
    anim: { in: 'hold', dur: '1.3s', ease: 'linear' },
    exit: { out: 'qsExitDown', dur: '0.4s', ease: 'cubic-bezier(.5,0,.9,.4)' }, len: 1.4,
    render: function (d) {
      var n = intOf(d.amount != null ? d.amount : d.bits), size = intOf(K.sizeOf(d, 'bits')), r = rng(hash(d.username + size));
      var count = Math.max(4, Math.min(14, 3 + Math.round(Math.log10(size + 1) * 2.6))), coins = '';
      for (var i = 0; i < count; i++) {
        var side = i % 3, cx, cl;
        if (side === 0) { cx = -(46 + r() * 26); cl = 54 + r() * 8; }
        else if (side === 1) { cx = 46 + r() * 20; cl = 54 + r() * 8; }
        else { cx = -26 + r() * 52; cl = -(2 + r() * 8); }
        coins += '<i class="o-qsb-coin" style="--cx:' + cx.toFixed(0) + 'px;--cl:' + cl.toFixed(0) + 'px;--cy:' + (-(34 + r() * 40)).toFixed(0) + 'px;--cd:' + (0.5 + i * 0.05).toFixed(2) + 's"></i>';
      }
      return '<div class="obj o-qs o-qsb"><div class="o-qsb-beams"></div>'
        + '<div class="o-qsb-chest"><div class="o-qsb-glow"></div><div class="o-qsb-lid"></div><div class="o-qsb-body"><i class="o-qsb-lock"></i></div></div>' + coins
        + '<div class="o-qsb-ribbon"><span class="o-qsb-n">+' + odo(fmt(n), 0.75, 0.7) + '</span><small>gold</small></div>'
        + '<div class="o-qs-paper o-qsb-plaque">' + nm('o-qs-name', d.username, 15) + '<div class="o-qsb-sub">' + label(d, 'filled the treasury') + '</div></div></div>';
    },
  });

  K.register({
    key: 'donation-quest', eventType: 'donation', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'qsDonation', fx: 'none',
    anim: { in: 'qsDrop', dur: '0.22s', ease: 'cubic-bezier(.3,.8,.3,1)' },
    exit: { out: 'qsExitUp', dur: '0.55s', ease: 'linear' }, len: 1.3,
    render: function (d) {
      return '<div class="obj o-qs o-qsd"><i class="o-qsd-rod"></i><div class="o-qsd-sheet"><div class="o-qs-paper o-qsd-paper">'
        + '<div class="o-qs-kicker">' + label(d, 'By royal decree') + '</div>'
        + '<div class="o-qsd-amt">' + esc(money(d.amount, d.currency)) + '</div>'
        + '<div class="o-qsd-by">granted by</div>' + nm('o-qs-name', d.username, 16)
        + (d.message ? '<div class="o-qsd-msg">“' + esc(d.message) + '”</div>' : '')
        + '</div><div class="o-qsd-carrier"><i class="o-qsd-rod"></i></div>'
        + '<div class="o-qsd-seal"><i class="o-qsd-emblem"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h18l-1.6-10-4.4 4-3-7-3 7-4.4-4z" fill="rgba(60,0,4,.55)"/><path d="M3 20.5h18" stroke="rgba(60,0,4,.55)" stroke-width="2"/></svg></i></div>'
        + '</div></div>';
    },
  });

  K.register({
    key: 'raid-quest', eventType: 'raid', family: FAMILY, controls: CONTROLS, grows: true,
    amount: 'Grows with the viewers', sound: 'qsRaid', fx: 'smoke',
    anim: { in: 'hold', dur: '1.5s', ease: 'linear' },
    exit: { out: 'qsExitDown', dur: '0.45s', ease: 'cubic-bezier(.5,0,.9,.4)' },
    len: function (d) { return 0.95 + Math.min(9, intOf(K.sizeOf(d, 'raid'))) * 0.08; },
    render: function (d) {
      var v = intOf(d.viewers), n = Math.min(intOf(K.sizeOf(d, 'raid')), 9), shields = '', bans = '';
      var fields = ['#5B1A1A', '#1F3A6B', '#22502E', '#1A1A1E', '#6B4A12'];
      for (var i = 0; i < n; i++) shields += '<span class="o-qsr-sh c' + (i % 5) + '" style="--sf:' + fields[(i * 2) % 5] + ';--sd:' + (0.66 + i * 0.08).toFixed(2) + 's"><i class="o-qsr-arms"></i></span>';
      if (v > n) shields += '<span class="o-qsr-more" style="--sd:' + (0.66 + n * 0.08).toFixed(2) + 's">+' + fmt(v - n) + '</span>';
      [22, 50, 78].forEach(function (x, j) { bans += '<span class="o-qsr-ban" style="--bx:' + x + '%;--bd:' + (0.2 + j * 0.08).toFixed(2) + 's"><span class="o-qsr-flag"><i class="o-qsr-field"></i><b></b></span></span>'; });
      return '<div class="obj o-qs o-qsr"><div class="o-qsr-banners">' + bans + '</div><div class="o-qsr-plate">'
        + '<div class="o-qsr-title">' + label(d, 'The horde approaches') + '</div>'
        + '<div class="o-qsr-line">' + nm('o-qsr-who', d.username, 12) + '<span>leads</span><b class="o-qsr-count">' + odo(fmt(v), 0.5, 0.6) + '</b><span>' + (v === 1 ? 'warrior' : 'warriors') + '</span></div>'
        + '<div class="o-qsr-shields">' + shields + '</div></div></div>';
    },
  });

  K.register({
    key: 'giveaway-quest', eventType: 'giveaway_winner', family: FAMILY, controls: CONTROLS, grows: false,
    sound: 'qsGiveaway', fx: 'sparks',
    anim: { in: 'hold', dur: '1.2s', ease: 'linear' },
    exit: { out: 'qsExitShrink', dur: '0.4s', ease: 'cubic-bezier(.5,0,.9,.4)' }, len: 1.2,
    render: function (d) {
      return '<div class="obj o-qs o-qsg"><div class="o-qsg-rays"></div><div class="o-qsg-card"><div class="o-qsg-flip">'
        + '<div class="o-qsg-face o-qsg-back"><i class="o-qsg-emblem"></i></div>'
        + '<div class="o-qsg-face o-qsg-front"><div class="o-qsg-rarity" style="--k:0">' + label(d, 'Legendary') + '</div><div class="o-qsg-gem" style="--k:1"></div>'
        + nm('o-qs-name', d.username, 16, '--k:2;') + '<div class="o-qsg-type" style="--k:3">Giveaway winner</div>'
        + (d.prize ? '<div class="o-qsg-desc" style="--k:4">Grants: <b>' + esc(d.prize) + '</b></div>' : '')
        + '</div></div></div></div>';
    },
  });

  Object.keys(SOUNDS).forEach(function (k) { K.registerSound(k, FAMILY, SOUNDS[k]); });
})(typeof window !== 'undefined' ? window : null);
