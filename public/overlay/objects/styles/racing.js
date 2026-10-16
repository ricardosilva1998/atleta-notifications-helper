'use strict';

/**
 * Racing (docs/superpowers/specs/2026-10-15-alert-styles-design.md): today's racing card, rebuilt as
 * night-race motion graphics. A headlight streak flies past and leaves a carbon panel behind it, the
 * text lands with a speed smear, and each alert adds one thing: a race number, nitro, a sponsor
 * decal, headlights, a victory lap. Racing keeps today's settings: the card, accent and name colours,
 * the name's font and the main text come from the alert's saved design (bg_color, accent_color,
 * username_color or else text_color, username_font_family, event_label), which kit.lookData() hands
 * the look as d.colours and d.label. Without a saved design the builder's defaults apply (the
 * family's `defaults`, the same as EVENT_DEFAULTS in src/services/overlayDesign.js: a test keeps the
 * two in step). The giveaway's default look, giveaway-racing, is the Victory lap.
 */
(function (root) {
  var K = (root && root.ATLETA_KIT) || require('../kit.js');

  var DEFAULTS = {
    follow: { bg: '#1a1a3e', accent: '#8888cc', label: 'New Pit Crew Member' },
    subscription: { bg: '#061a10', accent: '#00ff88', label: 'Podium Finish' },
    bits: { bg: '#1c1200', accent: '#f7c948', label: 'Nitro Boost' },
    donation: { bg: '#110022', accent: '#bf00ff', label: 'Sponsor Alert' },
    raid: { bg: '#1c0505', accent: '#ff4444', label: 'Incoming Raid' },
    giveaway_winner: { bg: '#1c1200', accent: '#f59e0b', label: 'Giveaway Winner!' },
  };
  K.registerFamily({
    key: 'racing', order: 1, defaults: DEFAULTS,
    fonts: ['Kanit:ital,wght@0,800;0,900;1,800;1,900', 'Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,700;1,800'],
  });

  var HEX = /^#[0-9a-fA-F]{6}$/;
  function pick(value, fallback) { return typeof value === 'string' && HEX.test(value) ? value : fallback; }
  // The root's colours: the saved design's (d.colours), else the alert's defaults. The font is one of
  // the builder's fonts (letters, digits and spaces only), quoted for CSS.
  function vars(eventType, d) {
    var t = DEFAULTS[eventType], c = (d && d.colours) || {};
    var bg = pick(c.bg, t.bg), accent = pick(c.accent, t.accent), b = K.rgbOf(bg);
    var out = '--rc-bg:' + bg + ';--rc-bg2:rgb(' + b.map(function (x) { return Math.round(x * 0.3); }).join(',') + ');--rc-a:' + accent
      + ';--rc-a-rgb:' + K.rgbOf(accent).join(',') + ';--rc-a-on:' + K.onColour(accent) + ';';
    var ink = pick(c.name, null);
    if (ink) out += '--rc-ink:' + ink + ';';
    if (typeof c.font === 'string' && c.font !== 'System Default' && /^[A-Za-z0-9 ]{1,40}$/.test(c.font)) out += '--rc-font:&quot;' + c.font + '&quot;;';
    return out;
  }
  var LINES = [[18, 90, 0.08], [34, 150, 0.15], [63, 110, 0.11], [81, 170, 0.19]].map(function (l) {
    return '<i style="--y:' + l[0] + '%;--w:' + l[1] + 'px;--ld:' + l[2] + 's"></i>';
  }).join('');
  // What every look shares: the carbon body (and what a look adds inside it), the speed lines,
  // the look's own content, then the streak on top.
  function shell(eventType, cls, d, o) {
    return '<div class="obj o-rc ' + cls + '" style="' + vars(eventType, d) + '"><div class="o-rc-panel"><div class="o-rc-body">'
      + (o.ghost ? '<span class="o-rc-ghost" aria-hidden="true">' + o.ghost + '</span>' : '') + (o.liv === false ? '' : '<i class="o-rc-liv"></i>') + (o.body || '')
      + '<i class="o-rc-sheen"></i></div><div class="o-rc-lines">' + LINES + '</div>' + (o.panel || '') + '</div>'
      + (o.after || '') + '<i class="o-rc-streak"></i></div>';
  }
  function chip(d, eventType) { return '<div class="o-rc-chip">' + K.label(d, DEFAULTS[eventType].label) + '</div>'; }
  var EXIT = { out: 'rcExit', dur: '0.36s', ease: 'cubic-bezier(.5,0,.9,.4)' };
  var CONTROLS = { colour: 'racing', label: true, speed: true };
  function hold(dur) { return { in: 'hold', dur: dur, ease: 'linear' }; }

  function whoosh(t, v) {
    var w = v || 0.2;
    K.noise({ ft: 'bandpass', f: 500, f2: 2600, q: 0.8, t: t, d: 0.2, v: w, a: 0.12 });
    K.noise({ ft: 'bandpass', f: 2600, f2: 380, q: 0.8, t: t + 0.2, d: 0.32, v: w * 0.85, a: 0.01 });
  }
  K.registerSound('rcFlyby', 'racing', function () { whoosh(0); K.engine({ f: 110, f2: 300, d: 0.5, v: 0.07 }); });
  K.registerSound('rcNumber', 'racing', function () {
    whoosh(0); K.noise({ ft: 'lowpass', f: 900, t: 0.3, d: 0.08, v: 0.3 });
    K.tone({ f: 1320, d: 0.08, v: 0.05, type: 'square', t: 0.62 }); K.tone({ f: 1760, d: 0.22, v: 0.05, type: 'square', t: 0.7 });
  });
  K.registerSound('rcNitro', 'racing', function () {
    whoosh(0, 0.16);
    for (var i = 0; i < 6; i++) K.tone({ f: 600 + i * 180, d: 0.05, v: 0.04, type: 'square', t: 0.46 + i * 0.08 });
    K.engine({ f: 140, f2: 440, d: 0.6, v: 0.1, t: 0.95 }); K.noise({ ft: 'highpass', f: 1200, f2: 5200, d: 0.5, v: 0.22, t: 0.98, a: 0.02 });
  });
  K.registerSound('rcSponsor', 'racing', function () {
    whoosh(0); K.noise({ ft: 'lowpass', f: 1000, t: 0.32, d: 0.08, v: 0.32 });
    K.tone({ f: 2637, d: 0.3, v: 0.03, t: 0.92 }); K.tone({ f: 3136, d: 0.3, v: 0.025, t: 1.0 });
  });
  K.registerSound('rcConvoy', 'racing', function () {
    [0, 0.12, 0.26, 0.42].forEach(function (t, i) { whoosh(t, 0.16 - i * 0.02); });
    K.engine({ f: 70, f2: 210, d: 0.9, v: 0.08, t: 0.3 });
  });
  K.registerSound('rcVictory', 'racing', function () {
    whoosh(0); K.engine({ f: 90, f2: 360, d: 0.9, v: 0.08, t: 0.45 });
    [784, 988, 1175, 1568].forEach(function (f, i) { K.tone({ f: f, d: i === 3 ? 0.5 : 0.14, v: 0.07, type: 'triangle', t: 1.2 + i * 0.09 }); });
  });

  K.register({
    key: 'follow-racing', eventType: 'follow', family: 'racing', controls: CONTROLS, grows: false,
    sound: 'rcFlyby', fx: 'none', anim: hold('1.1s'), exit: EXIT, len: 1.1,
    render: function (d) {
      var chev = '';
      for (var i = 0; i < 3; i++) chev += '<i style="--ci:' + i + '"></i>';
      return shell('follow', 'o-rcf', d, { ghost: 'FOLLOW', panel: '<div class="o-rc-txt">' + chip(d, 'follow') + K.nm('o-rc-name', d.username, 11) + '</div><div class="o-rcf-chev">' + chev + '</div>' });
    },
  });

  K.register({
    key: 'subscriber-racing', eventType: 'subscription', family: 'racing', controls: CONTROLS, grows: false,
    sound: 'rcNumber', fx: 'checker', anim: hold('1.2s'), exit: EXIT, len: 1.2,
    render: function (d) {
      var months = Math.max(1, K.intOf(d.months)), tier = Math.min(3, Math.max(1, K.intOf(d.tier) || 1));
      return shell('subscription', 'o-rcs', d, {
        panel: '<div class="o-rcs-num"><div class="o-rcs-n">' + K.odo(String(months), 0.34, 0.62) + '</div><div class="o-rcs-cap">' + (months === 1 ? 'month' : 'months') + '</div></div>'
          + '<div class="o-rc-txt">' + chip(d, 'subscription') + K.nm('o-rc-name', d.username, 9) + '<div class="o-rcs-meta">Tier <b>' + tier + '</b> subscriber</div></div>',
      });
    },
  });

  K.register({
    key: 'bits-racing', eventType: 'bits', family: 'racing', controls: CONTROLS, grows: true,
    sound: 'rcNitro', fx: 'speed', anim: hold('1.4s'), exit: EXIT, len: 1.45,
    render: function (d) {
      var amount = K.fmt(K.intOf(d.amount != null ? d.amount : d.bits)), size = K.sizeOf(d, 'bits'), segs = '';
      var lit = Math.max(2, Math.min(10, Math.round(10 * Math.log10(size + 1) / 4)));
      for (var i = 0; i < 10; i++) segs += '<i class="o-rcb-seg' + (i < lit ? ' on" style="--gd:' + (0.46 + i * 0.5 / lit).toFixed(3) + 's' : '') + '"></i>';
      return shell('bits', 'o-rcb', d, {
        panel: '<i class="o-rcb-flame" style="--fl:' + (0.55 + 0.45 * lit / 10).toFixed(2) + '"></i>'
          + '<div class="o-rc-txt">' + chip(d, 'bits') + K.nm('o-rc-name', d.username, 13) + '</div>'
          + '<div class="o-rcb-row"><div class="o-rcb-amt"' + (amount.length > 5 ? ' style="--af:.82"' : '') + '><b class="o-rcb-n">+' + K.odo(amount, 0.42, 0.62) + '</b><span class="o-rcb-u">bits</span></div>'
          + '<div class="o-rcb-gauge">' + segs + '</div></div>',
      });
    },
  });

  K.register({
    key: 'donation-racing', eventType: 'donation', family: 'racing', controls: CONTROLS, grows: false,
    sound: 'rcSponsor', fx: 'confetti', anim: hold('1.2s'), exit: EXIT, len: 1.2,
    render: function (d) {
      return shell('donation', 'o-rcd', d, {
        after: '<div class="o-rcd-in"><div class="o-rcd-row"><div class="o-rcd-decal">' + K.esc(K.money(d.amount, d.currency)) + '</div>' + chip(d, 'donation') + '</div>'
          + K.nm('o-rc-name', d.username, 14) + (d.message ? '<div class="o-rcd-msg">“' + K.esc(d.message) + '”</div>' : '') + '</div>',
      });
    },
  });

  K.register({
    key: 'raid-racing', eventType: 'raid', family: 'racing', controls: CONTROLS, grows: true,
    sound: 'rcConvoy', fx: 'smoke', anim: hold('1.4s'), exit: EXIT,
    len: function (d) { return 0.9 + Math.min(12, K.sizeOf(d, 'raid')) * 0.06; },
    render: function (d) {
      var viewers = K.intOf(d.viewers), n = Math.min(12, K.sizeOf(d, 'raid')), rows = ['', '', ''], order = 0, slots = [], k;
      // The near row fills first; the far rows switch on first, as if the cars were arriving.
      for (k = 0; k < n; k++) slots.push({ r: Math.floor(k / 4), c: k % 4 });
      slots.sort(function (a, b) { return b.r - a.r || a.c - b.c; }).forEach(function (s) {
        rows[s.r] += '<i class="o-rcr-hl" style="left:' + (s.c * 34 + (s.r === 1 ? 17 : 0)) + 'px;--hd:' + (0.5 + order++ * 0.06).toFixed(2) + 's"></i>';
      });
      return shell('raid', 'o-rcr', d, {
        panel: '<div class="o-rc-txt">' + chip(d, 'raid') + K.nm('o-rc-name', d.username, 7)
          + '<div class="o-rcr-count"><b class="o-rcr-n">+' + K.odo(K.fmt(viewers), 0.48, 0.6) + '</b><span class="o-rcr-u">' + (viewers === 1 ? 'driver' : 'drivers') + '</span></div></div>'
          + '<div class="o-rcr-grid"><div class="o-rcr-row" style="top:0;transform:scale(.74);opacity:.8">' + rows[2] + '</div>'
          + '<div class="o-rcr-row" style="top:40px;transform:scale(.87);opacity:.9">' + rows[1] + '</div><div class="o-rcr-row" style="top:82px">' + rows[0] + '</div></div>',
      });
    },
  });

  K.register({
    key: 'giveaway-racing', eventType: 'giveaway_winner', family: 'racing', controls: CONTROLS, grows: false,
    sound: 'rcVictory', fx: 'checker', anim: hold('1.5s'), exit: EXIT, len: 1.5,
    render: function (d) {
      var lap = '<svg class="o-rcg-lap" viewBox="0 0 396 172" preserveAspectRatio="none" aria-hidden="true">'
        + ['o-rcg-trace', 'o-rcg-glow', 'o-rcg-car'].map(function (c) { return '<rect class="' + c + '" x="1.5" y="1.5" width="393" height="169" pathLength="100"/>'; }).join('') + '</svg>';
      return shell('giveaway_winner', 'o-rcg', d, {
        liv: false, body: '<i class="o-rcg-chk"></i><i class="o-rcg-chk b"></i>' + lap,
        panel: '<div class="o-rc-txt">' + chip(d, 'giveaway_winner') + K.nm('o-rc-name', d.username, 11) + (d.prize ? '<div class="o-rcg-prize">Prize · <b>' + K.esc(d.prize) + '</b></div>' : '') + '</div>',
      });
    },
  });
})(typeof window !== 'undefined' ? window : null);
