/* ═══ Retro OS — a 90s desktop ═══
   Grey bevelled windows whose navy title bar runs into the streamer's colour. A window opens with the
   old zoom-rectangle outline and is then simply there; buttons press, progress bars fill block by block,
   the hourglass turns. A generic old system: no real logos or product names. Everything private to this
   family lives inside this function, so its helper names cannot collide with another family's. */
(function () {
  FAMS.ros = {
    name: 'Retro OS', order: 13, badge: 'new',
    sw: 'linear-gradient(135deg,#008080 0 38%,#C0C0C0 38% 62%,#0A246A 62% 80%,#3A6EA5 80%)',
    desc: 'A 90s desktop: a dialog that zooms open, an install wizard, a file copy, new mail, a cascade of error boxes and the card-game win screen.',
  };

  var ROS_MIN = { out: 'rosMin', dur: '.32s', ease: 'steps(4)' };
  var ROS_CLOSE = { out: 'rosClose', dur: '.32s', ease: 'steps(4)' };

  // Title-bar button glyphs, drawn on their pixel grid.
  var GLYPH = {
    min: '<svg width="8" height="7" viewBox="0 0 8 7" aria-hidden="true"><path d="M1 5h6v2H1z"/></svg>',
    max: '<svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true"><path fill-rule="evenodd" d="M0 0h9v9H0zM1 2v6h7V2z"/></svg>',
    close: '<svg width="8" height="7" viewBox="0 0 8 7" aria-hidden="true"><path d="M0 0h2v1H0zM6 0h2v1H6zM1 1h2v1H1zM5 1h2v1H5zM2 2h4v1H2zM3 3h2v1H3zM2 4h4v1H2zM1 5h2v1H1zM5 5h2v1H5zM0 6h2v1H0zM6 6h2v1H6z"/></svg>',
  };
  var ICON = {
    window: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 2.5h13v11h-13z" fill="#FFF" stroke="#000"/><path d="M2 3h12v2.5H2z" fill="#0A246A"/><path d="M3.5 8.5h6M3.5 11h8" stroke="#808080"/></svg>',
    info: '<svg viewBox="0 0 34 34" aria-hidden="true"><circle cx="18" cy="18" r="15" fill="#000" fill-opacity=".3"/><circle cx="16" cy="16" r="15" fill="#1A50C8" stroke="#000"/><path d="M14 13h4v11h-4zM14 7h4v4h-4z" fill="#FFF"/></svg>',
    error: '<svg viewBox="0 0 34 34" aria-hidden="true"><circle cx="18" cy="18" r="15" fill="#000" fill-opacity=".3"/><circle cx="16" cy="16" r="15" fill="#E01B1B" stroke="#000"/><path d="M10.5 10.5l11 11M21.5 10.5l-11 11" stroke="#FFF" stroke-width="3.6"/></svg>',
    folder: '<svg viewBox="0 0 34 28" aria-hidden="true"><path d="M1.5 3.5h11l3 3h17v20h-31z" fill="#D9A21B" stroke="#000"/><path d="M1.5 10.5h31v16h-31z" fill="#FFD75E" stroke="#000"/><path d="M2.5 11.5h29" stroke="#FFF1B8"/></svg>',
    mail: '<svg viewBox="0 0 38 28" aria-hidden="true"><path d="M1.5 1.5h35v25h-35z" fill="#FFF" stroke="#000"/><path d="M1.5 26.5l13-11.5M36.5 26.5l-13-11.5" fill="none" stroke="#9A9AA6"/><path d="M1.5 1.5L19 15.5 36.5 1.5" fill="#E9E9EF" stroke="#000"/></svg>',
    floppy: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M2.5 2.5h31l4 4v31h-35z" fill="#2F3340" stroke="#000"/><path d="M10.5 2.5h18v12h-18z" fill="#C9CCD4" stroke="#000"/><path d="M22.5 4.5h4v8h-4z" fill="#2F3340"/>'
      + '<path d="M7.5 19.5h25v18h-25z" fill="#FFF" stroke="#000"/><path class="o-ros-flab" d="M8 20h24v3H8z"/><path d="M10 27.5h20M10 31.5h20M10 35.5h13" stroke="#9AA0AE"/></svg>',
    cards: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4.5l6-2 3 9-6 2z" fill="#FFF" stroke="#000"/><path d="M6.5 1.5h8v12h-8z" fill="#FFF" stroke="#000"/><path d="M10.5 5c-.8-1.4-3-.4-2 1.2l2 2.3 2-2.3c1-1.6-1.2-2.6-2-1.2z" fill="#D40000"/></svg>',
  };
  // The destination folder in two layers, so the copied pages can sit inside it.
  var FOLDER_BACK = '<svg viewBox="0 0 34 28" aria-hidden="true"><path d="M1.5 3.5h11l3 3h17v20h-31z" fill="#D9A21B" stroke="#000"/></svg>';
  var FOLDER_FRONT = '<svg viewBox="0 0 34 28" aria-hidden="true"><path d="M1.5 10.5h31v16h-31z" fill="#FFD75E" stroke="#000"/><path d="M2.5 11.5h29" stroke="#FFF1B8"/></svg>';
  var ARROW = '<svg viewBox="0 0 12 19" aria-hidden="true"><path class="o-ros-arrow" d="M.5.5v15.6l3.8-3.6 2.6 6 2.2-.9-2.6-5.9h5.2z"/></svg>';
  var HOURGLASS = '<svg viewBox="0 0 14 22" aria-hidden="true"><path class="o-ros-hgg" d="M2.5 3h9v1.6c0 2.9-3.6 4.4-3.6 6.4s3.6 3.5 3.6 6.4V19h-9v-1.6c0-2.9 3.6-4.4 3.6-6.4S2.5 7.5 2.5 4.6z"/>'
    + '<path d="M1 .5h12V3H1zM1 19h12v2.5H1z"/><path d="M4.4 6.2h5.2C9.2 7.8 7.6 8.8 7 9.9 6.4 8.8 4.8 7.8 4.4 6.2zM3.9 18c.4-2 2.4-2.6 3.1-3.8.7 1.2 2.7 1.8 3.1 3.8z"/></svg>';

  // A title bar: icon, the (already escaped) title, and the buttons on the right.
  function rosBar(title, icon, btns, cls) {
    var b = btns.map(function (k) { return '<i class="o-ros-tb' + (k === 'close' && btns.length > 1 ? ' o-ros-tbx' : '') + '">' + GLYPH[k] + '</i>'; }).join('');
    return '<div class="o-ros-bar' + (cls ? ' ' + cls : '') + '"><i class="o-ros-bi">' + icon + '</i><span class="o-ros-bt">' + title + '</span><span class="o-ros-tbs">' + b + '</span></div>';
  }
  // The zoom rectangle: four outlines, each shown for one frame, growing from `origin` to the window.
  function rosZoom(origin) {
    var out = '';
    [0.16, 0.4, 0.64, 0.86].forEach(function (s, k) { out += '<i class="o-ros-zr" style="--s:' + s + ';--zt:' + (k * 0.055).toFixed(3) + 's"></i>'; });
    return '<div class="o-ros-zoom" style="--zo:' + origin + '">' + out + '</div>';
  }
  function rosBtn(text, cls) { return '<div class="o-ros-btn' + (cls ? ' ' + cls : '') + '"><span class="o-ros-btnt">' + text + '</span></div>'; }

  SOUND_NAMES.rosFollow = 'Ding and click';
  SOUNDS.rosFollow = function () {
    tone({ f: 1318, d: 0.45, v: 0.07, type: 'triangle', t: 0.22 });
    tone({ f: 1976, d: 0.3, v: 0.025, t: 0.22 });
    noise({ ft: 'highpass', f: 2500, d: 0.025, v: 0.2, t: 1.05 });
    noise({ ft: 'highpass', f: 2200, d: 0.025, v: 0.14, t: 1.18 });
  };
  SOUND_NAMES.rosSub = 'Disk drive and chime';
  SOUNDS.rosSub = function () {
    noise({ ft: 'lowpass', f: 220, d: 1.1, v: 0.08, a: 0.08, t: 0.3 });
    [0.32, 0.44, 0.52, 0.7, 0.82, 0.95, 1.12, 1.24, 1.36].forEach(function (t, i) { noise({ ft: 'bandpass', f: 520 + (i % 3) * 170, q: 3, d: 0.05, v: 0.22, t: t }); });
    tone({ f: 1046, d: 0.3, v: 0.06, type: 'triangle', t: 1.46 });
    tone({ f: 1568, d: 0.55, v: 0.05, type: 'triangle', t: 1.56 });
  };
  SOUND_NAMES.rosBits = 'Disk clicks and ding';
  SOUNDS.rosBits = function () {
    for (var i = 0; i < 8; i++) noise({ ft: 'bandpass', f: 1800 + (i % 2) * 500, q: 4, d: 0.03, v: 0.18, t: 0.42 + i * 0.13 });
    tone({ f: 1318, d: 0.45, v: 0.06, type: 'triangle', t: 1.62 });
    tone({ f: 1976, d: 0.3, v: 0.02, t: 1.62 });
  };
  SOUND_NAMES.rosDonation = 'Mail chime';
  SOUNDS.rosDonation = function () {
    tone({ f: 1568, d: 0.35, v: 0.06, t: 0.26 });
    tone({ f: 1175, d: 0.6, v: 0.06, t: 0.4 });
    noise({ ft: 'lowpass', f: 380, d: 0.06, v: 0.2, t: 0.52 });
    noise({ ft: 'lowpass', f: 380, d: 0.05, v: 0.13, t: 0.78 });
  };
  SOUND_NAMES.rosRaid = 'Error beeps';
  SOUNDS.rosRaid = function () {
    for (var i = 0; i < 8; i++) tone({ f: 660 - i * 20, d: 0.06, v: 0.035, type: 'square', t: 0.12 + i * 0.075 });
    [220, 277, 330].forEach(function (f) { tone({ f: f, d: 0.5, v: 0.06, type: 'triangle', t: 0.8 }); });
  };
  SOUND_NAMES.rosGiveaway = 'Card bounces and jingle';
  SOUNDS.rosGiveaway = function () {
    [0.65, 0.8, 0.95, 1.05, 1.2, 1.35].forEach(function (t, i) { tone({ f: 620 - (i % 3) * 40, f2: 300, d: 0.08, v: 0.05, t: t }); });
    [523, 659, 784, 1046].forEach(function (f, i) { tone({ f: f, d: 0.12, v: 0.05, type: 'square', t: 1.42 + i * 0.08 }); });
    tone({ f: 1046, d: 0.45, v: 0.05, type: 'triangle', t: 1.74 });
  };

  add({
    id: 'follow-retro', alert: 'follow', fam: 'ros', isNew: true, title: 'New window',
    desc: 'A dialog zooms open from its outline and says the new follower has joined; then the mouse glides over and clicks OK.',
    sound: 'rosFollow', fx: 'none', anim: hold('1.3s'), exit: ROS_MIN, len: 1.3,
    render: function (d) {
      return '<div class="obj o-ros o-rosf"><div class="o-ros-wrap o-rosf-wrap">' + rosZoom('10% 105%')
        + '<div class="o-ros-win o-rosf-win">' + rosBar(label(d, 'new_follower.exe'), ICON.window, ['close'])
        + '<div class="o-rosf-body"><div class="o-rosf-row"><i class="o-ros-icon">' + ICON.info + '</i>'
        + '<div class="o-rosf-txt">' + nm('o-ros-name o-rosf-name', d.username, 22) + '<div class="o-rosf-sub">has joined.</div></div></div>'
        + rosBtn('OK', 'o-ros-def o-rosf-ok') + '</div></div></div>'
        + '<i class="o-ros-cur o-rosf-cur">' + ARROW + '</i></div>';
    },
  });

  // Twitch sends the tier as 1/2/3 (or 1000/2000/3000); the wizard shows it as the setup type.
  var SETUP = { '1': 'Typical', '2': 'Custom', '3': 'Complete' };
  add({
    id: 'subscriber-retro', alert: 'subscription', fam: 'ros', isNew: true, title: 'Installer', amount: 'Months as the install',
    desc: 'An install wizard opens: the hourglass turns while the bar fills block by block and the month counts up, then Finish lights up. The tier is the setup type: Typical, Custom or Complete.',
    sound: 'rosSub', fx: 'none', anim: hold('1.5s'), exit: ROS_CLOSE, len: 1.55,
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), tier = String(d.tier || '1').charAt(0), opts = '';
      if (!SETUP[tier]) tier = '1';
      ['1', '2', '3'].forEach(function (k) { opts += '<span class="o-ross-opt"><i class="o-ros-radio' + (k === tier ? ' o-ros-on' : '') + '"></i>' + SETUP[k] + '</span>'; });
      return '<div class="obj o-ros o-ross"><div class="o-ros-wrap o-ross-wrap">' + rosZoom('50% 50%')
        + '<div class="o-ros-win o-ross-win">' + rosBar(label(d, 'Subscription Setup'), ICON.floppy, ['close'])
        + '<div class="o-ross-page"><div class="o-ross-art">' + ICON.floppy + '</div><div class="o-ross-main">'
        + '<div class="o-ross-head">Installing subscription…</div>' + nm('o-ros-name o-ross-name', d.username, 23)
        + '<div class="o-ross-prow"><div class="o-ros-prog o-ross-prog"><i class="o-ros-fill"></i></div><div class="o-ross-mo">month' + odo(String(months), 0.32, 1.1) + '</div></div>'
        + '<div class="o-ross-type">Setup type:' + opts + '</div></div></div>'
        + '<i class="o-ros-sep"></i><div class="o-ross-btns">' + rosBtn('&lt; Back', 'o-ros-off') + rosBtn('Finish', 'o-ros-def o-ross-fin') + rosBtn('Cancel') + '</div></div></div>'
        + '<i class="o-ros-cur o-ross-hg">' + HOURGLASS + '</i></div>';
    },
  });

  // File copy: 4 pages for 50 bits, 7 for 500, 11 for 10,000; they leave one after another.
  function rosPages(n) { return Math.max(3, Math.min(12, Math.round(Math.log10(n + 1) * 3.2 - 1.5))); }
  function rosCopy(n) {
    var c = rosPages(n), gap = Math.min(0.14, 0.8 / Math.max(1, c - 1));
    return { c: c, gap: gap, end: 0.38 + (c - 1) * gap + 0.5 };
  }
  add({
    id: 'bits-retro', alert: 'bits', fam: 'ros', isNew: true, title: 'File copy', amount: 'Grows with the amount',
    desc: 'A copy dialog opens and pages fly from one folder to the other, more pages for more bits, while the count rolls up and the bar fills to 100%.',
    sound: 'rosBits', fx: 'none', anim: hold('1.4s'), exit: ROS_MIN,
    len: function (d) { return rosCopy(intOf(d.amount != null ? d.amount : d.bits)).end + 0.1; },
    render: function (d) {
      var n = intOf(d.amount != null ? d.amount : d.bits), T = rosCopy(n), pages = '', sheets = '', i;
      for (i = 0; i < T.c; i++) pages += '<i class="o-rosb-pg o-rosb-paper" style="--pd:' + (0.38 + i * T.gap).toFixed(2) + 's"></i>';
      var stack = n >= 1000 ? 3 : n >= 100 ? 2 : 1, spots = [[5, 3, -8], [12, 1, 4], [17, 4, 11]];
      for (i = 0; i < stack; i++) {
        var lands = 0.38 + Math.floor((i + 1) * (T.c - 1) / stack) * T.gap + 0.46;
        sheets += '<i class="o-rosb-pg o-rosb-sheet" style="left:' + spots[i][0] + 'px;top:' + spots[i][1] + 'px;--sr:' + spots[i][2] + 'deg;--sd:' + lands.toFixed(2) + 's"></i>';
      }
      var run = T.end - 0.38;
      return '<div class="obj o-ros o-rosb" style="--run:' + run.toFixed(2) + 's;--done:' + T.end.toFixed(2) + 's"><div class="o-ros-wrap o-rosb-wrap">' + rosZoom('4% 0%')
        + '<div class="o-ros-win o-rosb-win">' + rosBar(label(d, 'Copying…'), ICON.folder, ['close'])
        + '<div class="o-rosb-body"><div class="o-rosb-lane"><i class="o-rosb-src">' + ICON.folder + '</i>'
        + '<div class="o-rosb-dst"><i class="o-rosb-fold">' + FOLDER_BACK + '</i>' + sheets + '<i class="o-rosb-fold">' + FOLDER_FRONT + '</i></div>' + pages + '</div>'
        + '<div class="o-rosb-copy">Copying' + odo(fmt(n), 0.38, +run.toFixed(2)) + '<span class="o-rosb-u">' + (n === 1 ? 'bit…' : 'bits…') + '</span></div>'
        + '<div class="o-rosb-from"><span class="o-rosb-fw">from</span>' + nm('o-ros-name o-rosb-name', d.username, 30) + '</div>'
        + '<div class="o-rosb-prow"><div class="o-ros-prog o-rosb-prog"><i class="o-ros-fill"></i></div><div class="o-rosb-pct">100%</div></div>'
        + '</div></div></div></div>';
    },
  });

  add({
    id: 'donation-retro', alert: 'donation', fam: 'ros', isNew: true, title: 'New mail',
    desc: 'A mail window opens and its envelope bounces in; the donor fills the From line, the amount is the subject and the message is typed into the body.',
    sound: 'rosDonation', fx: 'none', anim: hold('1.2s'), exit: ROS_MIN,
    len: function (d) { var c = Array.from(d.message || '').length; return c ? 0.9 + Math.min(1.0, c * 0.028) : 0.95; },
    render: function (d) {
      var text = d.message || '', count = Array.from(text).length;
      var t = typed(text, 0.8, count ? Math.min(0.028, 1.0 / count) : 0, 130);
      var menu = ['File', 'Edit', 'View', 'Message', 'Help'].map(function (w) { return '<span class="o-rosd-mi"><u>' + w.charAt(0) + '</u>' + w.slice(1) + '</span>'; }).join('');
      return '<div class="obj o-ros o-rosd"><div class="o-ros-wrap o-rosd-wrap">' + rosZoom('96% 105%')
        + '<div class="o-ros-win o-rosd-win">' + rosBar(label(d, 'New mail'), ICON.mail, ['min', 'max', 'close'])
        + '<div class="o-rosd-menu">' + menu + '</div>'
        + '<div class="o-rosd-body"><div class="o-rosd-head"><div class="o-rosd-env">' + ICON.mail + '</div>'
        + '<div class="o-rosd-fields"><span class="o-rosd-k">From:</span><div class="o-ros-field o-rosd-f">' + nm('o-ros-name o-rosd-name', d.username, 26) + '</div>'
        + '<span class="o-rosd-k">Subject:</span><div class="o-ros-field o-rosd-f"><span class="o-rosd-amt">' + esc(money(d.amount, d.currency)) + '</span><span class="o-rosd-st">donation</span></div></div></div>'
        + (t.n ? '<div class="o-ros-field o-rosd-msg"><div class="o-rosd-mt o-typed" style="' + t.style + '">' + t.html + '</div></div>' : '')
        + '</div></div></div></div>';
    },
  });

  // Error cascade: one box per raider (up to ten), each 12px right and 8px down from the one before.
  var RAID_STEP = 0.075;
  function rosRaid(v) { var n = Math.max(1, Math.min(10, v)); return { n: n, front: 0.12 + (n - 1) * RAID_STEP }; }
  add({
    id: 'raid-retro', alert: 'raid', fam: 'ros', isNew: true, title: 'Error cascade', amount: 'Grows with the viewers',
    desc: 'Error boxes pop up in a diagonal cascade, one per raider up to ten; the last one counts the viewers and names the raider.',
    sound: 'rosRaid', fx: 'none', anim: hold('1.2s'), exit: ROS_CLOSE,
    len: function (d) { return rosRaid(intOf(d.viewers)).front + 0.82; },
    render: function (d) {
      var v = intOf(d.viewers), R = rosRaid(v), n = R.n, W = 300, H = 124, DX = 12, DY = 8;
      var left0 = Math.round((420 - (W + (n - 1) * DX)) / 2), wins = '', i;
      for (i = 0; i < n - 1; i++) {
        wins += '<div class="o-ros-win o-rosr-win o-rosr-back" style="left:' + (left0 + i * DX) + 'px;top:' + (2 + i * DY) + 'px;--wd:' + (0.12 + i * RAID_STEP).toFixed(3) + 's">'
          + rosBar('', ICON.error, ['close'], 'o-ros-idle') + '</div>';
      }
      var front = '<div class="o-ros-win o-rosr-win" style="left:' + (left0 + (n - 1) * DX) + 'px;top:' + (2 + (n - 1) * DY) + 'px;--wd:' + R.front.toFixed(3) + 's">'
        + rosBar(label(d, 'Incoming raid'), ICON.error, ['close'])
        + '<div class="o-rosr-body"><div class="o-rosr-row"><i class="o-ros-icon">' + ICON.error + '</i><div class="o-rosr-txt">'
        + '<div class="o-rosr-count">' + odo(fmt(v), +(R.front + 0.12).toFixed(2), 0.6) + '<span class="o-rosr-cw">' + (v === 1 ? 'viewer' : 'viewers') + ' detected</span></div>'
        + nm('o-ros-name o-rosr-name', d.username, 20) + '</div></div>' + rosBtn('OK', 'o-ros-def') + '</div></div>';
      return '<div class="obj o-ros o-rosr" style="height:' + (2 + (n - 1) * DY + H + 6) + 'px">' + wins + front + '</div>';
    },
  });

  // Card cascade: three kings leave their foundation piles and bounce along the felt. Every frame of a
  // card stays painted where it was (as on the old win screen), so a card leaves a trail of copies,
  // one every 50ms, until it lands for the second time (at most 16 copies; 48 in all).
  var KINGS = [
    { x: 38, dir: 1, suit: 'h', t: 0.3, vx: 15 },
    { x: 338, dir: -1, suit: 's', t: 0.45, vx: 15 },
    { x: 368, dir: -1, suit: 'd', t: 0.6, vx: 9 },
  ];
  var FOUNDATIONS = [[8, 'k'], [38, 'h'], [338, 's'], [368, 'd']].map(function (f) {
    return '<i class="o-rosg-c o-rosg-' + f[1] + '" style="left:' + f[0] + 'px;top:8px">K</i>';
  }).join('');
  function rosTrails(seed) {
    var r = rng(seed), out = '';
    KINGS.forEach(function (k) {
      var x = k.x, y = 8, vx = k.dir * (k.vx + r() * 3), vy = -4 - r() * 2, hits = 0;
      for (var s = 0; s < 16; s++) {
        out += '<i class="o-rosg-c o-rosg-' + k.suit + ' o-rosg-tr" style="left:' + Math.round(x) + 'px;top:' + Math.round(y) + 'px;--cd:' + (k.t + s * 0.05).toFixed(2) + 's">K</i>';
        if (hits === 2) break;
        x += vx; y += vy;
        if (y >= 142) { y = 142; vy = -Math.abs(vy) * 0.55; hits++; } else vy += 9.5;
      }
    });
    return out;
  }
  add({
    id: 'giveaway-retro', alert: 'giveaway', fam: 'ros', isNew: true, title: 'Card cascade',
    desc: 'The old card game’s win screen: three kings bounce across the felt and leave trails, then a dialog pops up with You win!, the winner’s name and the prize.',
    sound: 'rosGiveaway', fx: 'confetti', anim: hold('1.5s'), exit: ROS_CLOSE, len: 1.6,
    render: function (d) {
      return '<div class="obj o-ros o-rosg"><div class="o-ros-wrap o-rosg-wrap">' + rosZoom('50% 50%')
        + '<div class="o-ros-win o-rosg-win">' + rosBar('giveaway.exe', ICON.cards, ['min', 'max', 'close'], 'o-ros-idle o-rosg-bar')
        + '<div class="o-rosg-felt">' + FOUNDATIONS + rosTrails(hash(d.username + 'cards'))
        + '<div class="o-ros-win o-rosg-dlg">' + rosBar(label(d, 'You win!'), ICON.cards, ['close'])
        + '<div class="o-rosg-dbody">' + nm('o-ros-name o-rosg-name', d.username, 17)
        + (d.prize ? '<div class="o-rosg-prize">Prize: <b>' + esc(d.prize) + '</b></div>' : '') + '</div></div>'
        + '</div></div></div></div>';
    },
  });
})();
