/* ═════════ CYBER — neon cyberpunk ═════════
   Hologram panels on black glass: a panel boots from a line of light, tears in a few glitch slices and
   settles on a still frame. Text carries an RGB split (two offset coloured copies); scanlines and a neon
   edge run under everything. Everything private lives inside this function, so its names cannot clash. */
(function () {
  FAMS.cyb = {
    name: 'Cyber', order: 11, badge: 'new',
    sw: 'linear-gradient(135deg,#FF2BD6 0 36%,#05030B 36% 64%,#22F0FF 64%)',
    desc: 'Neon cyberpunk: access granted for a follow, a system upgrade for a sub, a data stream of credits for bits, a decrypted message for a donation, a system breach for a raid and a hologram for the giveaway winner.',
  };

  SOUND_NAMES.cybFollow = 'Glitch and access chime';
  SOUNDS.cybFollow = function () {
    [[0.2, 3200], [0.25, 1700], [0.31, 4300]].forEach(function (p) { noise({ ft: 'bandpass', f: p[1], q: 3, d: 0.04, v: 0.16, t: p[0] }); });
    tone({ f: 500, f2: 1500, d: 0.26, v: 0.03, t: 0.32 });
    noise({ ft: 'highpass', f: 5000, d: 0.03, v: 0.2, t: 0.62 });
    tone({ f: 1046, d: 0.09, v: 0.06, type: 'square', t: 0.62 });
    tone({ f: 1568, d: 0.34, v: 0.06, type: 'square', t: 0.72 });
  };
  SOUND_NAMES.cybSub = 'Install and power-up';
  SOUNDS.cybSub = function () {
    for (var i = 0; i < 8; i++) tone({ f: 620 + i * 105, d: 0.035, v: 0.035, type: 'square', t: 0.4 + i * 0.08 });
    tone({ f: 220, f2: 880, d: 0.3, v: 0.045, type: 'sawtooth', t: 1.0 });
    [784, 988, 1175, 1568].forEach(function (f, j) { tone({ f: f, d: 0.4, v: 0.05, type: 'triangle', t: 1.08 + j * 0.06 }); });
  };
  SOUND_NAMES.cybBits = 'Data rain and locks';
  SOUNDS.cybBits = function () {
    var r = rng(4242);
    for (var i = 0; i < 10; i++) tone({ f: 1700 + Math.floor(r() * 6) * 230, d: 0.03, v: 0.028, type: 'square', t: 0.38 + i * 0.05 });
    [0.9, 1.0, 1.1].forEach(function (t) {
      noise({ ft: 'bandpass', f: 2600, q: 6, d: 0.03, v: 0.22, t: t });
      tone({ f: 1318, d: 0.06, v: 0.045, type: 'square', t: t });
    });
    tone({ f: 1760, d: 0.45, v: 0.05, type: 'triangle', t: 1.22 });
  };
  SOUND_NAMES.cybDonation = 'Decrypt chatter';
  SOUNDS.cybDonation = function () {
    tone({ f: 1318, d: 0.08, v: 0.05, type: 'square', t: 0.42 });
    noise({ ft: 'bandpass', f: 2400, q: 2, d: 0.36, v: 0.12, t: 0.7 });
    for (var i = 0; i < 12; i++) tone({ f: 2000 + (i % 3) * 380, d: 0.02, v: 0.028, type: 'square', t: 1.0 + i * 0.068 });
    tone({ f: 1318, d: 0.12, v: 0.055, type: 'triangle', t: 1.84 });
    tone({ f: 1760, d: 0.45, v: 0.055, type: 'triangle', t: 1.94 });
  };
  SOUND_NAMES.cybRaid = 'Breach alarm';
  SOUNDS.cybRaid = function () {
    noise({ ft: 'lowpass', f: 700, f2: 120, d: 0.28, v: 0.26 });
    tone({ f: 70, f2: 40, d: 0.3, v: 0.1 });
    [0.22, 0.42, 0.62].forEach(function (t) {
      tone({ f: 880, d: 0.09, v: 0.055, type: 'square', t: t });
      tone({ f: 622, d: 0.09, v: 0.055, type: 'square', t: t + 0.1 });
    });
    for (var i = 0; i < 8; i++) tone({ f: 1200 + i * 90, d: 0.03, v: 0.03, type: 'square', t: 0.66 + i * 0.09 });
  };
  SOUND_NAMES.cybGiveaway = 'Hologram power-up';
  SOUNDS.cybGiveaway = function () {
    tone({ f: 1200, d: 0.05, v: 0.04, type: 'square', t: 0.04 });
    tone({ f: 180, f2: 1100, d: 0.86, v: 0.04, type: 'sawtooth', t: 0.16 });
    noise({ ft: 'highpass', f: 4500, d: 0.7, v: 0.06, a: 0.25, t: 0.2 });
    noise({ ft: 'bandpass', f: 1800, q: 3, d: 0.08, v: 0.2, t: 0.98 });
    [523, 659, 784, 1046].forEach(function (f, i) { tone({ f: f, d: 0.32, v: 0.055, type: 'triangle', t: 1.2 + i * 0.08 }); });
    tone({ f: 1568, d: 0.8, v: 0.045, t: 1.52 });
  };

  var EXIT = { out: 'cybExit', dur: '.42s', ease: 'linear' };
  var LOCK = '<svg class="o-cybf-brk" viewBox="0 0 68 68" aria-hidden="true"><path d="M2 16V2h14M52 2h14v14M66 52v14H52M16 66H2V52"/></svg>'
    + '<svg class="o-cybf-pad" viewBox="0 0 40 46" aria-hidden="true"><path class="o-cybf-shk" d="M12 21v-7a8 8 0 0 1 16 0v7"/>'
    + '<rect class="o-cybf-body" x="6" y="21" width="28" height="21" rx="3"/><circle cx="20" cy="29" r="2.6"/><path d="M20 31.6V36"/></svg>';
  var WARN = '<svg class="o-cybr-tri" viewBox="0 0 24 22" aria-hidden="true"><path d="M12 2L22.5 20H1.5Z"/><path d="M12 8.5v5.5M12 16.8v.2"/></svg>';
  var GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ#&*@=';
  var HEX = '0123456789ABCDEF';
  var DEC_T0 = 1.0, DEC_MAX = 110;

  function isDigit(c) { return c >= '0' && c <= '9'; }
  // A four-digit hex code from a name: decoration that stays the same every time the alert plays.
  function hex4(s) { return ('000' + (hash(s) & 0xFFFF).toString(16).toUpperCase()).slice(-4); }
  // Three bands that tear sideways while a panel boots (glitch slices). A --bd on the panel delays them with it.
  function slices(seed) {
    var r = rng(seed), out = '';
    for (var i = 0; i < 3; i++) {
      var dir = i % 2 ? 1 : -1;
      out += '<i class="o-cyb-sl" style="top:' + (10 + i * 28 + r() * 14).toFixed(0) + '%;height:' + (6 + Math.round(r() * 9)) + 'px;--x:' + (dir * (7 + r() * 9)).toFixed(0)
        + 'px;--x2:' + (-dir * (3 + r() * 5)).toFixed(0) + 'px;--sd:' + (0.2 + i * 0.045).toFixed(3) + 's"></i>';
    }
    return out;
  }
  // A hologram panel: chamfered black glass with a neon edge; the caller closes the div.
  function panel(cls, seed) { return '<div class="o-cyb-panel ' + cls + '">' + slices(seed); }
  // Glitch text (already escaped): two coloured copies (data-t) tear across in bands, then it holds with a slight RGB split.
  function gt(cls, text, delay) { return '<div class="o-cyb-gt ' + cls + '" data-t="' + text + '" style="--gd:' + delay + 's">' + text + '</div>'; }
  // The same for a name, which also scales down and ends in an ellipsis like nm().
  function gname(cls, name, holds, delay) {
    return '<div class="o-cyb-gt ' + cls + ' o-nm" data-t="' + esc(name) + '" style="' + fitStyle(name, holds) + '--gd:' + delay + 's"><span class="o-nm-t">' + esc(name) + '</span></div>';
  }
  // Seconds per typed character for a name, so that any name is typed within about half a second.
  function typePer(n) { return n ? Math.min(0.045, 0.55 / n) : 0.045; }
  function tierOf(t) { var n = intOf(t); if (n >= 1000) n = Math.round(n / 1000); return Math.max(1, Math.min(3, n || 1)); }
  // A cipher of the text: letters and digits swapped for random ones, spaces, punctuation and wide
  // characters kept, so in a monospaced font it wraps onto the same lines as the message it hides.
  function cipher(chars, r) {
    return esc(chars.map(function (c) {
      if (isDigit(c)) return String(Math.floor(r() * 10));
      if (isWide(c.codePointAt(0))) return c;
      if (/\p{L}/u.test(c)) return GLYPHS.charAt(Math.floor(r() * GLYPHS.length));
      return c;
    }).join(''));
  }
  // What the decrypt block shows and when it finishes (the same truncation as typed()).
  function decryptPlan(d) {
    var text = d.message ? String(d.message) : 'Transfer received. Thank you!', chars = Array.from(text);
    if (chars.length > DEC_MAX) chars = chars.slice(0, DEC_MAX - 1).concat('…');
    var per = Math.min(0.025, 0.85 / Math.max(1, chars.length));
    return { text: text, chars: chars, per: per, end: DEC_T0 + chars.length * per + 0.05 };
  }
  function bitsOf(d) { return intOf(d.amount != null ? d.amount : d.bits); }
  // The amount's last column locks at this time; one column a tenth of a second after the other.
  function bitsLast(d) { var digits = fmt(bitsOf(d)).replace(/[^0-9]/g, '').length; return 0.9 + Math.max(0, digits - 1) * 0.1; }
  function rainCol(r, len) { var s = ''; for (var i = 0; i < len; i++) s += (i ? '<br>' : '') + HEX.charAt(Math.floor(r() * 16)); return s; }

  add({
    id: 'follow-cyber', alert: 'follow', fam: 'cyb', isNew: true, title: 'Access granted',
    desc: 'A hologram panel boots from a line of light and tears in glitch slices; a scan opens the lock, ACCESS GRANTED glitches in and the name types out, connected.',
    sound: 'cybFollow', fx: 'none', anim: hold('1.5s'), exit: EXIT,
    len: function (d) { var n = Math.min(26, Array.from(d.username || '').length); return 0.8 + n * typePer(n) + 0.28; },
    render: function (d) {
      var n = Math.min(26, Array.from(d.username || '').length), per = typePer(n);
      var t = typed(d.username, 0.8, per, 26), end = 0.8 + t.n * per;
      return '<div class="obj o-cyb o-cybf">' + panel('o-cybf-panel', hash(d.username))
        + '<div class="o-cybf-lock">' + LOCK + '<i class="o-cybf-beam"></i></div>'
        + '<div class="o-cybf-txt"><div class="o-cyb-micro o-cybf-micro">New follower · ID ' + hex4(d.username) + '</div>'
        + gt('o-cybf-title', label(d, 'Access granted'), 0.6)
        + '<div class="o-cybf-name o-typed" style="' + fitStyle(d.username, 16) + t.style + '">' + t.html + '</div>'
        + '<div class="o-cyb-micro o-cybf-conn" style="--cd:' + end.toFixed(2) + 's">&gt; connected<i class="o-cybf-cur"></i></div></div>'
        + '</div></div>';
    },
  });

  add({
    id: 'subscriber-cyber', alert: 'subscription', fam: 'cyb', isNew: true, title: 'Upgrade', amount: 'Months as the version',
    desc: 'A segmented bar installs to 100%, then UPGRADE v4.0 glitches in with the months as the version number, the name scans in and the tier lights up as the clearance level.',
    sound: 'cybSub', fx: 'none', anim: hold('1.7s'), exit: EXIT, len: 1.85,
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), tier = tierOf(d.tier), segs = '', pips = '', i;
      for (i = 0; i < 24; i++) segs += '<i class="o-cybs-seg" style="--i:' + i + '"></i>';
      for (i = 0; i < 3; i++) pips += '<i class="o-cybs-pip' + (i < tier ? ' on' : '') + '" style="--pd:' + (1.46 + i * 0.08).toFixed(2) + 's"></i>';
      return '<div class="obj o-cyb o-cybs">' + panel('o-cybs-panel', hash(d.username) + months)
        + '<div class="o-cybs-head"><span class="o-cyb-micro o-cybs-lbl">' + label(d, months > 1 ? 'Resubscribed' : 'New subscriber') + '</span>'
        + '<span class="o-cyb-micro o-cybs-pct"><span>Install</span><span class="o-cybs-pn">' + odo('100', 0.38, 0.64) + '%</span></span></div>'
        + '<div class="o-cybs-bar">' + segs + '</div>'
        + '<div class="o-cybs-main"><div class="o-cyb-frame o-cybs-ver"><span class="o-cyb-micro o-cybs-up">Upgrade</span>'
        + '<b class="o-cybs-v"><span class="o-cybs-vv">v</span>' + odo(String(months), 1.08, 0.5) + '<span class="o-cybs-vv">.0</span></b></div>'
        + '<div class="o-cybs-who">' + nm('o-cybs-name o-cyb-name', d.username, 14)
        + '<div class="o-cyb-micro o-cybs-clr"><span>Clearance level ' + tier + '</span><span class="o-cybs-pips">' + pips + '</span></div>'
        + (d.message ? '<div class="o-cybs-msg o-cyb-mono">' + esc(d.message) + '</div>' : '')
        + '</div></div></div></div>';
    },
  });

  add({
    id: 'bits-cyber', alert: 'bits', fam: 'cyb', isNew: true, title: 'Data stream', amount: 'Grows with the amount',
    desc: 'Columns of neon digits rain down and lock one by one into the amount, with more rain for more bits; then +500 CREDITS and the name scan in.',
    sound: 'cybBits', fx: 'sparks', anim: hold('1.6s'), exit: EXIT,
    len: function (d) { return bitsLast(d) + 0.5; },
    render: function (d) {
      var n = bitsOf(d), chars = Array.from(fmt(n)), r = rng(hash(d.username + n)), last = bitsLast(d);
      var digits = chars.filter(isDigit).length, size = digits > 5 ? Math.max(28, Math.round(44 * 5 / digits)) : 44, cells = '', di = 0, i;
      chars.forEach(function (c) {
        if (!isDigit(c)) { cells += '<span class="o-cybb-sep">' + esc(c) + '</span>'; return; }
        var lock = 0.9 + di * 0.1, k = Math.max(6, Math.round((lock - 0.38) / 0.055)), strip = '<b class="o-cybb-f">' + c + '</b>';
        for (var j = 0; j < k; j++) strip += '<br>' + Math.floor(r() * 10);
        cells += '<span class="o-cybb-cell" style="--ld:' + lock.toFixed(2) + 's"><span class="o-cybb-strip" style="--k:' + k + ';--fd:' + (lock - 0.38).toFixed(2) + 's">' + strip + '</span></span>';
        di++;
      });
      var cols = Math.max(5, Math.min(14, Math.round(3 + Math.log10(n + 1) * 2.6))), rain = '';
      for (i = 0; i < cols; i++) {
        rain += '<span class="o-cybb-rain" style="left:' + ((i + 0.5) * 100 / cols).toFixed(1) + '%;--ro:' + Math.round(-r() * 60) + 'px;--rs:' + (5 + Math.floor(r() * 4))
          + ';--rd:' + (0.3 + r() * 0.35).toFixed(2) + 's">' + rainCol(r, 12) + '</span>';
      }
      return '<div class="obj o-cyb o-cybb' + (n >= 1000 ? ' o-cybb-big' : '') + '" style="--ul:' + (last + 0.1).toFixed(2) + 's;--wd:' + (last + 0.16).toFixed(2) + 's">'
        + panel('o-cybb-panel', hash(d.username) + 7)
        + '<div class="o-cybb-head"><span class="o-cyb-micro o-cybb-lbl">' + label(d, 'Incoming bits') + '</span><span class="o-cyb-micro o-cybb-rx">Uplink ' + hex4(d.username + n) + '</span></div>'
        + '<div class="o-cybb-field"><div class="o-cybb-rainbox">' + rain + '</div>'
        + '<div class="o-cybb-amt" style="font-size:' + size + 'px"><span class="o-cybb-plus">+</span>' + cells + '<span class="o-cybb-unit">credits</span></div></div>'
        + '<div class="o-cybb-who"><span class="o-cyb-micro o-cybb-from">From</span>' + nm('o-cybb-name o-cyb-name', d.username, 20) + '</div>'
        + '</div></div>';
    },
  });

  add({
    id: 'donation-cyber', alert: 'donation', fam: 'cyb', isNew: true, title: 'Decrypt',
    desc: 'The amount flickers on in a neon tag and the sender scans in; an encrypted block scrambles, then the message decrypts character by character.',
    sound: 'cybDonation', fx: 'none', anim: hold('1.6s'), exit: EXIT,
    len: function (d) { return decryptPlan(d).end + 0.1; },
    render: function (d) {
      var p = decryptPlan(d), r = rng(hash(d.username + p.text)), t = typed(p.text, DEC_T0, p.per, DEC_MAX);
      return '<div class="obj o-cyb o-cybd" style="--de:' + p.end.toFixed(2) + 's">' + panel('o-cybd-panel', hash(d.username) + 5)
        + '<div class="o-cybd-tagwrap"><div class="o-cyb-frame o-cybd-tag"><b class="o-cybd-amt">' + esc(money(d.amount, d.currency)) + '</b></div></div>'
        + '<div class="o-cyb-micro o-cybd-lbl">' + label(d, 'Encrypted donation') + '</div>'
        + '<div class="o-cybd-from"><span class="o-cyb-micro o-cybd-k">From</span>' + nm('o-cybd-name o-cyb-name', d.username, 18) + '</div>'
        + '<div class="o-cybd-box"><div class="o-cybd-enc a o-cyb-mono">' + cipher(p.chars, r) + '</div><div class="o-cybd-enc b o-cyb-mono">' + cipher(p.chars, r) + '</div>'
        + '<div class="o-cybd-msg o-cyb-mono o-typed" style="' + t.style + '">' + t.html + '</div></div>'
        + '<div class="o-cyb-micro o-cybd-stat"><i class="o-cybd-dot"></i><span class="o-cybd-st"><span class="o-cybd-ing">Decrypting…</span>'
        + '<span class="o-cybd-ok">' + (d.message ? 'Message decrypted' : 'Transfer verified') + '</span></span></div>'
        + '</div></div>';
    },
  });

  add({
    id: 'raid-cyber', alert: 'raid', fam: 'cyb', isNew: true, title: 'Breach', amount: 'Grows with the viewers',
    desc: 'Red alert bars slam in with SYSTEM BREACH; a grid of nodes lights up one per raider, up to sixteen, and the raider scans in with the count of runners.',
    sound: 'cybRaid', fx: 'speed', anim: hold('1.6s'), exit: EXIT,
    len: function (d) { return Math.max(1.7, 0.62 + Math.min(16, intOf(d.viewers)) * 0.05 + 0.3); },
    render: function (d) {
      var v = intOf(d.viewers), lit = Math.min(v, 16), r = rng(hash(d.username + v)), list = [], nodes = '', x, y;
      // The breach spreads from one corner: the nodes light in order of distance from it, with a little noise.
      var sx = r() < 0.5 ? 0 : 3, sy = r() < 0.5 ? 0 : 3;
      for (y = 0; y < 4; y++) for (x = 0; x < 4; x++) list.push({ x: x, y: y, k: Math.sqrt((x - sx) * (x - sx) + (y - sy) * (y - sy)) + r() * 1.2 });
      list.sort(function (a, b) { return a.k - b.k; });
      list.forEach(function (p, i) {
        nodes += '<i class="o-cybr-node' + (i < lit ? ' on' : '') + '" style="left:' + p.x * 26 + 'px;top:' + p.y * 26 + 'px' + (i < lit ? ';--nd:' + (0.62 + i * 0.05).toFixed(2) + 's' : '') + '"></i>';
      });
      return '<div class="obj o-cyb o-cybr" style="--ne:' + (0.62 + lit * 0.05 + 0.05).toFixed(2) + 's">'
        + '<div class="o-cybr-bar"><i class="o-cybr-haz"></i><div class="o-cybr-alarm">' + WARN + gt('o-cybr-title', label(d, 'System breach'), 0.12) + '</div><i class="o-cybr-haz"></i></div>'
        + panel('o-cybr-panel', hash(d.username) + 9)
        + '<div class="o-cybr-grid">' + nodes + '</div>'
        + '<div class="o-cybr-txt"><div class="o-cyb-micro o-cybr-lbl">Raid detected</div>'
        + nm('o-cybr-name o-cyb-name', d.username, 15)
        + '<div class="o-cybr-count"><span class="o-cybr-plus">+</span><span class="o-cybr-n">' + odo(fmt(v), 0.95, 0.7) + '</span><span class="o-cybr-unit">' + (v === 1 ? 'runner' : 'runners') + '</span></div>'
        + '<div class="o-cyb-micro o-cybr-nodes">' + lit + ' of 16 nodes lit</div></div>'
        + '</div></div>';
    },
  });

  add({
    id: 'giveaway-cyber', alert: 'giveaway', fam: 'cyb', isNew: true, title: 'Hologram',
    desc: 'A projector lights up and a wireframe cube spins up in its beam, then folds flat into a line of light that opens into a glowing name plate: WINNER, the name and the prize.',
    sound: 'cybGiveaway', fx: 'confetti', anim: hold('1.9s'), exit: EXIT, len: 1.95,
    render: function (d) {
      var faces = '';
      for (var i = 1; i <= 6; i++) faces += '<i class="o-cybg-face f' + i + '"></i>';
      return '<div class="obj o-cyb o-cybg"><i class="o-cybg-beam"></i><i class="o-cybg-base"></i><i class="o-cybg-lens"></i>'
        + '<div class="o-cybg-stage"><div class="o-cybg-cube">' + faces + '</div></div>'
        + panel('o-cybg-plate', hash(d.username) + 3)
        + gt('o-cybg-lbl', label(d, 'Winner'), 1.22)
        + gname('o-cybg-name o-cyb-name', d.username, 17, 1.34)
        + '<div class="o-cyb-micro o-cybg-id">Giveaway · ID ' + hex4(d.username) + '</div></div>'
        + (d.prize ? '<div class="o-cybg-prizewrap"><div class="o-cyb-frame o-cybg-prize"><span class="o-cyb-micro o-cybg-pk">Prize</span><b class="o-cybg-pv">' + esc(d.prize) + '</b></div></div>' : '')
        + '</div>';
    },
  });
})();
