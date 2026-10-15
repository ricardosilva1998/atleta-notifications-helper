/* ═══ Racing — today's racing card, rebuilt as night-race motion graphics ═══ */
FAMS.racing = {
  name: 'Racing', order: 1, badge: 'improved',
  sw: 'linear-gradient(115deg,#0B0B12 0 34%,#ff4444 34% 46%,#0B0B12 46% 52%,#f7c948 52% 58%,#0B0B12 58%)',
  desc: 'Today’s racing card, rebuilt as night-race graphics: a headlight streak flies past and leaves a carbon panel behind it, then a race number, nitro, a sponsor decal, headlights and a victory lap. Every colour, font and text stays editable.',
};

(function () {
  // Each alert's colours and label are the builder's defaults today (EVENT_DEFAULTS in
  // overlayDesign.js); a streamer's saved design takes their place.
  var THEME = {
    follow: { bg: '#1a1a3e', accent: '#8888cc', label: 'New Pit Crew Member' },
    subscription: { bg: '#061a10', accent: '#00ff88', label: 'Podium Finish' },
    bits: { bg: '#1c1200', accent: '#f7c948', label: 'Nitro Boost' },
    donation: { bg: '#110022', accent: '#bf00ff', label: 'Sponsor Alert' },
    raid: { bg: '#1c0505', accent: '#ff4444', label: 'Incoming Raid' },
    giveaway: { bg: '#1c1200', accent: '#f59e0b', label: 'Giveaway Winner!' },
  };
  function vars(alert) {
    var t = THEME[alert], b = rgbOf(t.bg);
    return '--rc-bg:' + t.bg + ';--rc-bg2:rgb(' + b.map(function (x) { return Math.round(x * 0.3); }).join(',') + ');--rc-a:' + t.accent
      + ';--rc-a-rgb:' + rgbOf(t.accent).join(',') + ';--rc-a-on:' + onColour(t.accent) + ';';
  }
  var LINES = [[18, 90, 0.08], [34, 150, 0.15], [63, 110, 0.11], [81, 170, 0.19]].map(function (l) {
    return '<i style="--y:' + l[0] + '%;--w:' + l[1] + 'px;--ld:' + l[2] + 's"></i>';
  }).join('');
  // What every look shares: the carbon body (and what a look adds inside it), the speed lines,
  // the look's own content, then the streak on top.
  function shell(alert, cls, o) {
    return '<div class="obj o-rc ' + cls + '" style="' + vars(alert) + '"><div class="o-rc-panel"><div class="o-rc-body">'
      + (o.ghost ? '<span class="o-rc-ghost" aria-hidden="true">' + o.ghost + '</span>' : '') + (o.liv === false ? '' : '<i class="o-rc-liv"></i>') + (o.body || '')
      + '<i class="o-rc-sheen"></i></div><div class="o-rc-lines">' + LINES + '</div>' + (o.panel || '') + '</div>'
      + (o.after || '') + '<i class="o-rc-streak"></i></div>';
  }
  function chip(d, alert) { return '<div class="o-rc-chip">' + label(d, THEME[alert].label) + '</div>'; }
  var EXIT = { out: 'rcExit', dur: '.36s', ease: 'cubic-bezier(.5,0,.9,.4)' };

  // Today's giveaway card, for comparison (the legacy .lg styles in 40-styles.css).
  function legacyGiveaway(d) {
    var prize = d.prize ? '<div class="detail">won <b>' + esc(d.prize) + '</b> 🎁</div>' : '';
    return '<div class="obj lg"><div class="alert-card" style="background:linear-gradient(160deg,rgba(10,6,0,1),rgba(28,18,0,1) 40%,rgba(10,6,0,1));border:2px solid rgba(245,158,11,.5);box-shadow:0 8px 32px 0 rgba(245,158,11,.25),0 4px 24px rgba(0,0,0,.6)">'
      + '<div class="top-accent" style="background:linear-gradient(90deg,rgb(147,95,7),#f59e0b,rgb(147,95,7))"></div>'
      + '<div class="card-body"><div class="cup-row"><span class="cup">🎉</span><div class="card-inner">'
      + '<div class="event-label" style="color:#f59e0b">Giveaway Winner!</div>'
      + '<div class="username">@' + esc(d.username) + '</div>' + prize
      + '</div><span class="cup">🎉</span></div></div>'
      + '<div class="car-track" style="background:rgba(245,158,11,.06)"><div class="race-line"></div><div class="speed-dot sd1"></div><div class="speed-dot sd2"></div><div class="speed-dot sd3"></div><div class="track-car">🏎️</div></div>'
      + '</div></div>';
  }
  add({ id: 'giveaway-racing-today', label: 'giveaway-racing (today)', alert: 'giveaway', fam: 'racing', before: true, title: 'Today’s racing card', desc: 'For comparison: today’s giveaway card with the builder’s default colours. With no saved design it is see-through.', sound: 'rev', fx: 'confetti', render: legacyGiveaway, anim: { in: 'slideDown', dur: '.4s', ease: 'ease-out' }, exit: { out: 'lgFade', dur: '.3s', ease: 'ease-in' }, len: 0.5 });

  function whoosh(t, v) {
    var w = v || 0.2;
    noise({ ft: 'bandpass', f: 500, f2: 2600, q: 0.8, t: t, d: 0.2, v: w, a: 0.12 });
    noise({ ft: 'bandpass', f: 2600, f2: 380, q: 0.8, t: t + 0.2, d: 0.32, v: w * 0.85, a: 0.01 });
  }
  SOUND_NAMES.rcFlyby = 'Fly-by';
  SOUNDS.rcFlyby = function () { whoosh(0); engine({ f: 110, f2: 300, d: 0.5, v: 0.07 }); };
  SOUND_NAMES.rcNumber = 'Fly-by and decal slap';
  SOUNDS.rcNumber = function () {
    whoosh(0); noise({ ft: 'lowpass', f: 900, t: 0.3, d: 0.08, v: 0.3 });
    tone({ f: 1320, d: 0.08, v: 0.05, type: 'square', t: 0.62 }); tone({ f: 1760, d: 0.22, v: 0.05, type: 'square', t: 0.7 });
  };
  SOUND_NAMES.rcNitro = 'Nitro boost';
  SOUNDS.rcNitro = function () {
    whoosh(0, 0.16);
    for (var i = 0; i < 6; i++) tone({ f: 600 + i * 180, d: 0.05, v: 0.04, type: 'square', t: 0.46 + i * 0.08 });
    engine({ f: 140, f2: 440, d: 0.6, v: 0.1, t: 0.95 }); noise({ ft: 'highpass', f: 1200, f2: 5200, d: 0.5, v: 0.22, t: 0.98, a: 0.02 });
  };
  SOUND_NAMES.rcSponsor = 'Decal slap';
  SOUNDS.rcSponsor = function () {
    whoosh(0); noise({ ft: 'lowpass', f: 1000, t: 0.32, d: 0.08, v: 0.32 });
    tone({ f: 2637, d: 0.3, v: 0.03, t: 0.92 }); tone({ f: 3136, d: 0.3, v: 0.025, t: 1.0 });
  };
  SOUND_NAMES.rcConvoy = 'Convoy fly-by';
  SOUNDS.rcConvoy = function () { [0, 0.12, 0.26, 0.42].forEach(function (t, i) { whoosh(t, 0.16 - i * 0.02); }); engine({ f: 70, f2: 210, d: 0.9, v: 0.08, t: 0.3 }); };
  SOUND_NAMES.rcVictory = 'Victory lap';
  SOUNDS.rcVictory = function () {
    whoosh(0); engine({ f: 90, f2: 360, d: 0.9, v: 0.08, t: 0.45 });
    [784, 988, 1175, 1568].forEach(function (f, i) { tone({ f: f, d: i === 3 ? 0.5 : 0.14, v: 0.07, type: 'triangle', t: 1.2 + i * 0.09 }); });
  };

  add({
    id: 'follow-racing', alert: 'follow', fam: 'racing', improved: true, edit: 'all', title: 'Fly-by',
    desc: 'A headlight streak flies past and leaves the panel behind it, the name lands with a speed smear and three chevrons light up. It launches off to the right to leave.',
    sound: 'rcFlyby', fx: 'none', anim: hold('1.1s'), exit: EXIT, len: 1.1,
    render: function (d) {
      var chev = '';
      for (var i = 0; i < 3; i++) chev += '<i style="--ci:' + i + '"></i>';
      return shell('follow', 'o-rcf', { ghost: 'FOLLOW', panel: '<div class="o-rc-txt">' + chip(d, 'follow') + nm('o-rc-name', d.username, 11) + '</div><div class="o-rcf-chev">' + chev + '</div>' });
    },
  });

  add({
    id: 'subscriber-racing', alert: 'subscription', fam: 'racing', improved: true, edit: 'all', title: 'Race number',
    desc: 'After the fly-by a race-number roundel slaps onto the panel with the months as the number, then the name and the tier.',
    amount: 'Months as the race number', sound: 'rcNumber', fx: 'checker', anim: hold('1.2s'), exit: EXIT, len: 1.2,
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), tier = Math.min(3, Math.max(1, intOf(d.tier) || 1));
      return shell('subscription', 'o-rcs', {
        panel: '<div class="o-rcs-num"><div class="o-rcs-n">' + odo(String(months), 0.34, 0.62) + '</div><div class="o-rcs-cap">' + (months === 1 ? 'month' : 'months') + '</div></div>'
          + '<div class="o-rc-txt">' + chip(d, 'subscription') + nm('o-rc-name', d.username, 9) + '<div class="o-rcs-meta">Tier <b>' + tier + '</b> subscriber</div></div>',
      });
    },
  });

  add({
    id: 'bits-racing', alert: 'bits', fam: 'racing', improved: true, edit: 'all', title: 'Nitro',
    desc: 'The nitro gauge charges, further for more bits, then the flame fires, the panel kicks forward and the amount rolls up.',
    amount: 'Grows with the amount', sound: 'rcNitro', fx: 'speed', anim: hold('1.4s'), exit: EXIT, len: 1.45,
    render: function (d) {
      var n = intOf(d.amount != null ? d.amount : d.bits), amt = fmt(n), segs = '';
      var lit = Math.max(2, Math.min(10, Math.round(10 * Math.log10(n + 1) / 4)));
      for (var i = 0; i < 10; i++) segs += '<i class="o-rcb-seg' + (i < lit ? ' on" style="--gd:' + (0.46 + i * 0.5 / lit).toFixed(3) + 's' : '') + '"></i>';
      return shell('bits', 'o-rcb', {
        panel: '<i class="o-rcb-flame" style="--fl:' + (0.55 + 0.45 * lit / 10).toFixed(2) + '"></i>'
          + '<div class="o-rc-txt">' + chip(d, 'bits') + nm('o-rc-name', d.username, 13) + '</div>'
          + '<div class="o-rcb-row"><div class="o-rcb-amt"' + (amt.length > 5 ? ' style="--af:.82"' : '') + '><b class="o-rcb-n">+' + odo(amt, 0.42, 0.62) + '</b><span class="o-rcb-u">bits</span></div>'
          + '<div class="o-rcb-gauge">' + segs + '</div></div>',
      });
    },
  });

  add({
    id: 'donation-racing', alert: 'donation', fam: 'racing', improved: true, edit: 'all', title: 'Sponsor decal',
    desc: 'After the fly-by the amount is slapped on like a sponsor’s sticker and a gloss runs across it. The donor’s name and the message sit below.',
    sound: 'rcSponsor', fx: 'confetti', anim: hold('1.2s'), exit: EXIT, len: 1.2,
    render: function (d) {
      return shell('donation', 'o-rcd', {
        after: '<div class="o-rcd-in"><div class="o-rcd-row"><div class="o-rcd-decal">' + esc(money(d.amount, d.currency)) + '</div>' + chip(d, 'donation') + '</div>'
          + nm('o-rc-name', d.username, 14) + (d.message ? '<div class="o-rcd-msg">“' + esc(d.message) + '”</div>' : '') + '</div>',
      });
    },
  });

  add({
    id: 'raid-racing', alert: 'raid', fam: 'racing', improved: true, edit: 'all', title: 'Headlights',
    desc: 'After the fly-by a formation of headlights switches on, one pair per raider up to twelve, the far rows first, while the count of drivers rolls up.',
    amount: 'Grows with the viewers', sound: 'rcConvoy', fx: 'smoke', anim: hold('1.4s'), exit: EXIT,
    len: function (d) { return 0.9 + Math.min(12, intOf(d.viewers)) * 0.06; },
    render: function (d) {
      var v = intOf(d.viewers), n = Math.min(v, 12), rows = ['', '', ''], k, order = 0, slots = [];
      // The near row fills first; the far rows switch on first, as if the cars were arriving.
      for (k = 0; k < n; k++) slots.push({ r: Math.floor(k / 4), c: k % 4 });
      slots.sort(function (a, b) { return b.r - a.r || a.c - b.c; }).forEach(function (s) {
        rows[s.r] += '<i class="o-rcr-hl" style="left:' + (s.c * 34 + (s.r === 1 ? 17 : 0)) + 'px;--hd:' + (0.5 + order++ * 0.06).toFixed(2) + 's"></i>';
      });
      return shell('raid', 'o-rcr', {
        panel: '<div class="o-rc-txt">' + chip(d, 'raid') + nm('o-rc-name', d.username, 7)
          + '<div class="o-rcr-count"><b class="o-rcr-n">+' + odo(fmt(v), 0.48, 0.6) + '</b><span class="o-rcr-u">' + (v === 1 ? 'driver' : 'drivers') + '</span></div></div>'
          + '<div class="o-rcr-grid"><div class="o-rcr-row" style="top:0;transform:scale(.74);opacity:.8">' + rows[2] + '</div>'
          + '<div class="o-rcr-row" style="top:40px;transform:scale(.87);opacity:.9">' + rows[1] + '</div><div class="o-rcr-row" style="top:82px">' + rows[0] + '</div></div>',
      });
    },
  });

  add({
    id: 'giveaway-racing', alert: 'giveaway', fam: 'racing', improved: true, edit: 'all', title: 'Victory lap',
    desc: 'After the fly-by a light laps the panel’s outline once and leaves it lit, then the winner’s name glows. The prize sits on a tag.',
    sound: 'rcVictory', fx: 'checker', anim: hold('1.5s'), exit: EXIT, len: 1.5,
    render: function (d) {
      var lap = '<svg class="o-rcg-lap" viewBox="0 0 396 172" preserveAspectRatio="none" aria-hidden="true">'
        + ['o-rcg-trace', 'o-rcg-glow', 'o-rcg-car'].map(function (c) { return '<rect class="' + c + '" x="1.5" y="1.5" width="393" height="169" pathLength="100"/>'; }).join('') + '</svg>';
      return shell('giveaway', 'o-rcg', {
        liv: false, body: '<i class="o-rcg-chk"></i><i class="o-rcg-chk b"></i>' + lap,
        panel: '<div class="o-rc-txt">' + chip(d, 'giveaway') + nm('o-rc-name', d.username, 11) + (d.prize ? '<div class="o-rcg-prize">Prize · <b>' + esc(d.prize) + '</b></div>' : '') + '</div>',
      });
    },
  });
})();
