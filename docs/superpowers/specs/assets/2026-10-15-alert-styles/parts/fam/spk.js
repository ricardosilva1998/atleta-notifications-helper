/* ═════════ SPOOKY — playful Halloween ═════════
   Cute, never gory: a little ghost says boo, a cauldron brews the months, a treat bucket fills with
   candy, a tombstone rises with the tip, bats swarm across the moon and a jack-o'-lantern pops its
   top. Creepster headlines, Nunito names, night-purple plates rimmed in the accent (pumpkin orange
   by default). Everything private to this family lives inside this function, so its helper names
   cannot collide with another family's. */
(function () {
  FAMS.spk = {
    name: 'Spooky', order: 10, badge: 'new',
    sw: 'radial-gradient(circle at 32% 30%,#FF7A1A 0 32%,#6A3FA0 33% 62%,#120B1F 63%)',
    desc: 'Playful Halloween: a ghost pops up to say boo, a cauldron brews the months, a treat bucket fills with candy, a tombstone rises with the tip, bats swarm across the moon and a jack-o’-lantern pops its top for the winner.',
  };

  /* ── Sounds ── */
  SOUND_NAMES.spkFollow = 'Ghostly whoo';
  SOUNDS.spkFollow = function () {
    tone({ f: 300, f2: 520, d: 0.5, v: 0.06, t: 0.26, a: 0.16 });
    tone({ f: 600, f2: 1040, d: 0.5, v: 0.022, t: 0.26, a: 0.16, type: 'triangle' });
    for (var i = 0; i < 7; i++) noise({ ft: 'bandpass', f: 1700 + (i % 3) * 260, q: 1.4, d: 0.035, v: 0.1, t: 0.44 + i * 0.1 });
    tone({ f: 523, f2: 392, d: 0.2, v: 0.06, t: 0.96, type: 'triangle' });
    tone({ f: 1319, d: 0.3, v: 0.03, t: 1.22 });
    tone({ f: 1760, d: 0.4, v: 0.025, t: 1.38 });
  };
  SOUND_NAMES.spkSub = 'Bubbling brew';
  SOUNDS.spkSub = function () {
    tone({ f: 130, f2: 70, d: 0.2, v: 0.09, t: 0.2 });
    noise({ ft: 'lowpass', f: 400, d: 0.12, v: 0.16, t: 0.2 });
    [0.42, 0.55, 0.66, 0.78, 0.97, 1.16, 1.3].forEach(function (t, i) { tone({ f: 240 + (i % 3) * 70, f2: 420 + (i % 3) * 90, d: 0.07, v: 0.045, t: t }); });
    [0.85, 1.08].forEach(function (t) { tone({ f: 760, f2: 1500, d: 0.06, v: 0.07, t: t }); noise({ ft: 'highpass', f: 3000, d: 0.03, v: 0.12, t: t }); });
    tone({ f: 1976, d: 0.35, v: 0.035, type: 'triangle', t: 1.34 });
    tone({ f: 2637, d: 0.45, v: 0.025, type: 'triangle', t: 1.42 });
  };
  SOUND_NAMES.spkBits = 'Candy rattle';
  SOUNDS.spkBits = function () {
    tone({ f: 150, f2: 80, d: 0.16, v: 0.08, t: 0.2 });
    for (var i = 0; i < 10; i++) noise({ ft: 'bandpass', f: 3000 + (i % 4) * 450, q: 5, d: 0.03, v: 0.14, t: 0.78 + i * 0.065 });
    noise({ ft: 'lowpass', f: 500, f2: 1400, d: 0.3, v: 0.1, t: 1.25, a: 0.08 });
    [659, 784, 988].forEach(function (f, i) { tone({ f: f, d: 0.35, v: 0.045, type: 'triangle', t: 1.32 + i * 0.07 }); });
  };
  SOUND_NAMES.spkDonation = 'Stone and chisel';
  SOUNDS.spkDonation = function () {
    noise({ ft: 'lowpass', f: 240, f2: 520, d: 0.62, v: 0.26, a: 0.12, t: 0.04 });
    tone({ f: 72, f2: 52, d: 0.6, v: 0.08, t: 0.04, a: 0.1 });
    [0.64, 0.82, 1.0].forEach(function (t) { noise({ ft: 'highpass', f: 3800, d: 0.028, v: 0.15, t: t }); tone({ f: 2400, d: 0.05, v: 0.03, t: t }); });
    tone({ f: 392, f2: 523, d: 0.45, v: 0.05, t: 1.1, a: 0.14 });
  };
  SOUND_NAMES.spkRaid = 'Bat wings';
  SOUNDS.spkRaid = function () {
    noise({ ft: 'bandpass', f: 420, f2: 900, q: 0.8, d: 0.9, v: 0.12, a: 0.3, t: 0.02 });
    for (var i = 0; i < 16; i++) noise({ ft: 'bandpass', f: 1300 + (i % 4) * 260, q: 1.3, d: 0.04, v: 0.11, t: 0.62 + i * 0.075 });
    tone({ f: 3300, f2: 3900, d: 0.05, v: 0.025, t: 0.9 });
    tone({ f: 3500, f2: 4100, d: 0.05, v: 0.025, t: 1.32 });
  };
  SOUND_NAMES.spkGiveaway = 'Pop and sparkle';
  SOUNDS.spkGiveaway = function () {
    tone({ f: 140, f2: 75, d: 0.18, v: 0.09, t: 0.2 });
    noise({ ft: 'lowpass', f: 500, f2: 1500, d: 0.32, v: 0.14, t: 0.46, a: 0.08 });
    tone({ f: 540, f2: 170, d: 0.12, v: 0.1, t: 0.9 });
    noise({ ft: 'highpass', f: 2600, d: 0.05, v: 0.2, t: 0.9 });
    [1047, 1319, 1568, 2093].forEach(function (f, i) { tone({ f: f, d: 0.28, v: 0.05, type: 'triangle', t: 0.96 + i * 0.07 }); });
    tone({ f: 1568, d: 0.6, v: 0.035, t: 1.32 });
  };

  /* ── Shared drawings ── */
  var EXIT = { out: 'spkExit', dur: '.45s', ease: 'cubic-bezier(.5,0,.9,.4)' };
  var SINK = { out: 'spkSink', dur: '.5s', ease: 'cubic-bezier(.5,0,.9,.4)' };
  var FLY = { out: 'spkFlyOff', dur: '.4s', ease: 'cubic-bezier(.5,0,.9,.4)' };

  // A sheet ghost with a scalloped hem, big eyes, an "o" mouth and blush.
  var GHOST = '<svg class="o-spk-ghost" viewBox="4 4 36 46" aria-hidden="true">'
    + '<path class="o-spk-sheet" d="M6 22a16 16 0 0 1 32 0v22q-4 6-8 0q-4 6-8 0q-4 6-8 0q-4 6-8 0z"/>'
    + '<ellipse class="o-spk-face" cx="16.5" cy="21" rx="2.5" ry="3.4"/><ellipse class="o-spk-face" cx="27.5" cy="21" rx="2.5" ry="3.4"/>'
    + '<circle class="o-spk-shine" cx="15.6" cy="19.7" r=".9"/><circle class="o-spk-shine" cx="26.6" cy="19.7" r=".9"/>'
    + '<ellipse class="o-spk-face" cx="22" cy="29.5" rx="2.4" ry="3"/>'
    + '<circle class="o-spk-blush" cx="12.4" cy="27" r="2.3"/><circle class="o-spk-blush" cx="31.6" cy="27" r="2.3"/></svg>';
  // A bat: pointed ears, scalloped wings, two little eyes in the accent.
  var BAT_D = 'M20 6L21.2 3.4 22.2 6.4C26 3 32 1.5 38 3Q35 7.4 33.5 12.6Q31 9.4 28.5 11.4Q26.2 11.4 24.2 14.2Q21.8 14.4 20 17.5'
    + 'Q18.2 14.4 15.8 14.2Q13.8 11.4 11.5 11.4Q9 9.4 6.5 12.6Q5 7.4 2 3C8 1.5 14 3 17.8 6.4L18.8 3.4Z';
  function bat(cls) {
    return '<svg class="o-spk-bat ' + cls + '" viewBox="0 0 40 20" aria-hidden="true"><path class="o-spk-batb" d="' + BAT_D + '"/>'
      + '<circle class="o-spk-bate" cx="19" cy="7.8" r=".8"/><circle class="o-spk-bate" cx="21" cy="7.8" r=".8"/></svg>';
  }

  /* ── follow — Ghost hello ── */
  add({
    id: 'follow-spooky', alert: 'follow', fam: 'spk', isNew: true, title: 'Ghost hello',
    desc: 'A little ghost rises from behind a tombstone and two bats flutter off. It says “boo!” in a wisp with the follower’s name, then waves.',
    sound: 'spkFollow', fx: 'none', anim: hold('1.8s'), exit: EXIT, len: 1.85,
    render: function (d) {
      return '<div class="obj o-spk o-spkf">'
        + '<i class="o-spkf-puff o-spkf-p1"></i><i class="o-spkf-puff o-spkf-p2"></i>'
        + '<div class="o-spk-plate o-spkf-wisp"><div class="o-spk-lbl o-spkf-boo">' + label(d, 'boo!') + '</div>'
        + nm('o-spk-name o-spkf-name', d.username, 15)
        + '<div class="o-spk-meta o-spkf-sub">followed you</div></div>'
        + '<i class="o-spkf-bat o-spkf-ba">' + bat('o-spkf-wing') + '</i><i class="o-spkf-bat o-spkf-bb">' + bat('o-spkf-wing') + '</i>'
        + '<div class="o-spkf-ghost"><i class="o-spkf-arm"></i>' + GHOST + '</div>'
        + '<div class="o-spkf-stone"><span class="o-spkf-rip">RIP</span></div><i class="o-spkf-ground"></i></div>';
    },
  });

  /* ── subscriber — Cauldron ── */
  var POT = '<svg class="o-spks-svg" viewBox="0 0 140 112" aria-hidden="true">'
    + '<path class="o-spks-leg" d="M38 100l-7 11h12l4-11zM102 100l7 11H97l-4-11z"/>'
    + '<path class="o-spks-body" d="M12 38C0 64 12 100 46 106H94C128 100 140 64 128 38Z"/>'
    + '<path class="o-spks-shine" d="M26 54C21 66 23 82 32 92"/>'
    + '<ellipse class="o-spks-rim" cx="70" cy="37" rx="62" ry="11"/>'
    + '<ellipse class="o-spks-brew" cx="70" cy="36" rx="53" ry="7.5"/>'
    + '<ellipse class="o-spks-foam" cx="62" cy="34.5" rx="26" ry="3"/>'
    + '<path class="o-spks-drip" d="M94 45v7a3.5 3.5 0 0 0 7 0v-7z"/></svg>';
  var BOTTLE_C = ['#8BE13A', '#B98CFF', 'var(--spka)'];
  function bottle(i, delay) {
    return '<svg class="o-spks-bottle" viewBox="0 0 18 26" aria-hidden="true" style="--bc:' + BOTTLE_C[i] + ';--bd:' + delay.toFixed(2) + 's">'
      + '<path class="o-spks-glass" d="M6.5 1.5h5v2h-.8v4.6a7.6 7.6 0 1 1-3.4 0V3.5h-.8z"/>'
      + '<path class="o-spks-liq" d="M2.5 14.2A6.6 6.6 0 1 0 15.5 14.2Z"/>'
      + '<ellipse class="o-spks-glint" cx="6.2" cy="13.4" rx="1.1" ry="2.1"/>'
      + '<rect class="o-spks-cork" x="7" y="0" width="4" height="2.8" rx=".8"/></svg>';
  }
  // Twitch sends tiers as 1000/2000/3000; the samples use 1/2/3.
  function tierOf(v) { var t = intOf(v); if (t >= 1000) t = Math.round(t / 1000); return Math.min(3, Math.max(1, t || 1)); }
  add({
    id: 'subscriber-spooky', alert: 'subscription', fam: 'spk', isNew: true, title: 'Cauldron', amount: 'Months as the brew',
    desc: 'A cauldron lands and its brew glows while the months count up on its side. Two bubbles float up and pop to reveal the label and the name, then the tier lines up as one to three potion bottles.',
    sound: 'spkSub', fx: 'none', anim: hold('1.7s'), exit: EXIT, len: 1.8,
    render: function (d) {
      var months = Math.max(1, intOf(d.months)), tier = tierOf(d.tier), bottles = '', sims = '', i;
      for (i = 0; i < tier; i++) bottles += bottle(i, 1.22 + i * 0.1);
      [[44, 34, 9, 0.45], [76, 31, 12, 0.62], [98, 35, 8, 0.79]].forEach(function (s) {
        sims += '<i class="o-spks-sim" style="left:' + (s[0] - s[2] / 2) + 'px;top:' + (s[1] - s[2] / 2) + 'px;--s:' + s[2] + 'px;--sd:' + s[3] + 's"></i>';
      });
      return '<div class="obj o-spk o-spks">'
        + '<div class="o-spk-plate o-spks-plate"><div class="o-spk-lbl o-spks-lbl">' + label(d, months > 1 ? 'Brewing for ' + months + ' months' : 'New subscriber!') + '</div>'
        + nm('o-spk-name o-spks-name', d.username, 12)
        + '<div class="o-spks-tier"><span class="o-spks-bottles">' + bottles + '</span><span class="o-spk-meta o-spks-tiertxt">Tier ' + tier + '</span></div></div>'
        + '<div class="o-spks-pot"><i class="o-spks-glow"></i>' + POT + sims
        + '<div class="o-spks-num">' + odo(String(months), 0.5, 0.8) + '<span class="o-spks-mo">' + (months === 1 ? 'month' : 'months') + '</span></div></div>'
        + '<i class="o-spks-bub" style="--tx:106px;--ty:-60px;--bd:.45s"></i><i class="o-spks-bub" style="--tx:106px;--ty:-28px;--bd:.68s"></i></div>';
    },
  });

  /* ── bits — Treat bucket ── */
  var FACE_B = 'M42 70l18 0-8-15zM90 70l18 0-10-15zM71 81h8l-4-7zM38 87Q75 122 112 87Q75 101 38 87Z';
  var TEETH_B = 'M58 92h8v6h-8zM85 92h8v6h-8z';
  var BUCKET_BACK = '<svg class="o-spkb-svg" viewBox="0 0 150 132" aria-hidden="true"><ellipse class="o-spkb-hole" cx="75" cy="40" rx="52" ry="9"/></svg>';
  var BUCKET_FRONT = '<svg class="o-spkb-svg" viewBox="0 0 150 132" aria-hidden="true">'
    + '<path class="o-spkb-body" d="M23 40A52 9 0 0 0 127 40C146 52 150 98 124 120C102 130 48 130 26 120C0 98 4 52 23 40Z"/>'
    + '<path class="o-spkb-rib" d="M57 49C49 72 49 100 57 124M93 49C101 72 101 100 93 124"/>'
    + '<path class="o-spkb-hi" d="M34 58C28 72 29 92 36 104"/>'
    + '<path class="o-spkb-cut" d="' + FACE_B + '"/><path class="o-spkb-tooth" d="' + TEETH_B + '"/></svg>';
  var BUCKET_LIGHT = '<svg class="o-spkb-svg o-spkb-light" viewBox="0 0 150 132" aria-hidden="true"><path class="o-spkb-lit" d="' + FACE_B + '"/><path class="o-spkb-tooth" d="' + TEETH_B + '"/></svg>';
  var CANDY_C = ['var(--spka)', '#B98CFF', '#8BE13A', '#F4F1FF', '#FF6FA8'];
  var ROWS = [5, 4, 3, 2, 1];
  function candyCount(n) { return Math.max(3, Math.min(15, Math.round(1 + Math.log10(Math.max(1, n)) * 3.6))); }
  function glowAt(count) { return 0.45 + count * 0.045 + 0.2; }
  // The slots of a row, middle first, so a half-filled row still looks like a heap.
  function middleOut(slots) {
    var idx = [], mid = (slots - 1) / 2, k;
    for (k = 0; k < slots; k++) idx.push(k);
    return idx.sort(function (a, b) { return Math.abs(a - mid) - Math.abs(b - mid) || a - b; });
  }
  add({
    id: 'bits-spooky', alert: 'bits', fam: 'spk', isNew: true, title: 'Treat bucket', amount: 'Grows with the amount',
    desc: 'A jack-o’-lantern bucket lands and wrapped candies drop in, more for more bits, while “+500 treats” counts up. Then its carved face lights up.',
    sound: 'spkBits', fx: 'none', anim: hold('1.6s'), exit: EXIT,
    len: function (d) { return glowAt(candyCount(intOf(d.amount != null ? d.amount : d.bits))) + 0.6; },
    render: function (d) {
      var n = intOf(d.amount != null ? d.amount : d.bits), count = candyCount(n), r = rng(hash(d.username + n)), candies = '', i = 0, row;
      for (row = 0; row < ROWS.length && i < count; row++) {
        var slots = ROWS[row], order = middleOut(slots).slice(0, Math.min(slots, count - i));
        for (var k = 0; k < order.length; k++, i++) {
          var x = 60 + (order[k] - (slots - 1) / 2) * 21 + (r() * 4 - 2);
          candies += '<i class="o-spkb-candy" style="left:' + (x - 12).toFixed(0) + 'px;bottom:' + (row * 8 + r() * 2).toFixed(0) + 'px;--c:' + CANDY_C[(i * 2) % CANDY_C.length]
            + ';--r:' + Math.round(r() * 70 - 35) + 'deg;--cd:' + (0.45 + i * 0.045).toFixed(3) + 's"></i>';
        }
      }
      return '<div class="obj o-spk o-spkb" style="--gd:' + glowAt(count).toFixed(2) + 's">'
        + '<div class="o-spk-plate o-spkb-plate"><div class="o-spk-lbl o-spkb-lbl">' + label(d, 'Trick or treat!') + '</div>'
        + '<div class="o-spkb-amt"><span class="o-spkb-plus">+</span>' + odo(fmt(n), 0.45, 0.9) + '<span class="o-spkb-unit">' + (n === 1 ? 'treat' : 'treats') + '</span></div>'
        + nm('o-spk-name o-spkb-name', d.username, 13) + '</div>'
        + '<div class="o-spkb-bucket"><i class="o-spkb-handle"></i>' + BUCKET_BACK + '<div class="o-spkb-pile">' + candies + '</div>' + BUCKET_FRONT + BUCKET_LIGHT + '</div></div>';
    },
  });

  /* ── donation — Haunted tombstone ── */
  var DIRT = [[30, -16, 0.12], [56, -8, 0.18], [356, 8, 0.15], [382, 16, 0.21]];
  function typing(msg) {
    var text = msg ? '“' + msg + '”' : '', count = Array.from(text).length;
    return { text: text, per: count ? Math.min(0.03, 0.7 / count) : 0, count: Math.min(count, 110) };
  }
  add({
    id: 'donation-spooky', alert: 'donation', fam: 'spk', isNew: true, title: 'Haunted tombstone',
    desc: 'A tombstone rises out of the ground and “Here lies €25.00 from <name>” is carved into it line by line, with the message carved below. A little ghost peeks over the top.',
    sound: 'spkDonation', fx: 'none', anim: hold('1.5s'), exit: SINK,
    len: function (d) { var m = typing(d.message); return m.count ? 1.12 + m.count * m.per + 0.15 : 1.6; },
    render: function (d) {
      var m = typing(d.message), t = typed(m.text, 1.12, m.per, 110), dirt = '';
      DIRT.forEach(function (p) { dirt += '<i class="o-spkd-dirt" style="left:' + p[0] + 'px;--dx:' + p[1] + 'px;--dd:' + p[2] + 's"></i>'; });
      return '<div class="obj o-spk o-spkd"><div class="o-spkd-pit"><div class="o-spkd-ghost">' + GHOST + '</div>'
        + '<div class="o-spkd-stone"><div class="o-spk-lbl o-spkd-lbl">' + label(d, 'Here lies') + '</div>'
        + '<div class="o-spkd-amt">' + esc(money(d.amount, d.currency)) + '</div>'
        + nm('o-spkd-from', 'from ' + d.username, 24)
        + (t.n ? '<div class="o-spkd-msg o-typed" style="' + t.style + '">' + t.html + '</div>' : '')
        + '</div></div>' + dirt + '<i class="o-spkd-ground"></i></div>';
    },
  });

  /* ── raid — Bat swarm ── */
  // Where the bats settle, relative to the moon's centre (x, y, wingspan); the first ones are the middle of the swarm.
  var SPOTS = [[-6, -10, 34], [44, -44, 28], [-44, -50, 24], [56, 22, 30], [4, 44, 26], [-52, 14, 24],
    [12, -72, 20], [82, -14, 22], [-30, 70, 20], [52, 66, 22], [84, -62, 18], [-54, -16, 18]];
  var MOON_X = 312, MOON_Y = 96;
  add({
    id: 'raid-spooky', alert: 'raid', fam: 'spk', isNew: true, title: 'Bat swarm', amount: 'Grows with the viewers',
    desc: 'A big moon rises, the raider’s name and “brings 42 ghouls” appear, and a swarm of bats flaps out from behind the card across the moon, one per raider up to twelve.',
    sound: 'spkRaid', fx: 'none', anim: hold('1.5s'), exit: FLY,
    len: function (d) { var n = Math.min(12, intOf(d.viewers)); return n ? 0.62 + (n - 1) * 0.06 + 0.65 : 1.2; },
    render: function (d) {
      var v = intOf(d.viewers), n = Math.min(v, 12), r = rng(hash(d.username + v)), bats = '', i;
      for (i = 0; i < n; i++) {
        var s = SPOTS[i], cx = MOON_X + s[0], cy = MOON_Y + s[1], w = s[2];
        var sx = 160 - cx + (r() * 20 - 10), sy = 100 - cy + (r() * 16 - 8);
        bats += '<i class="o-spkr-bat" style="left:' + (cx - w / 2).toFixed(0) + 'px;top:' + (cy - w / 4).toFixed(0) + 'px;width:' + w + 'px;height:' + (w / 2) + 'px'
          + ';--sx:' + sx.toFixed(0) + 'px;--sy:' + sy.toFixed(0) + 'px;--arc:' + (i % 2 ? -16 : 14) + 'px;--rt:' + Math.round(r() * 24 - 12) + 'deg;--bd:' + (0.62 + i * 0.06).toFixed(2) + 's">'
          + bat('o-spkr-wing') + '</i>';
      }
      return '<div class="obj o-spk o-spkr"><div class="o-spkr-moon"><i class="o-spkr-crater o-spkr-c1"></i><i class="o-spkr-crater o-spkr-c2"></i><i class="o-spkr-crater o-spkr-c3"></i><i class="o-spkr-crater o-spkr-c4"></i></div>'
        + '<div class="o-spkr-bats">' + bats + '</div>'
        + '<div class="o-spk-plate o-spkr-plate"><div class="o-spk-lbl o-spkr-lbl">' + label(d, 'Incoming raid!') + '</div>'
        + nm('o-spk-name o-spkr-name', d.username, 11)
        + '<div class="o-spkr-count"><span class="o-spkr-word">brings</span><b class="o-spkr-num">' + odo(fmt(v), 0.6, 0.75) + '</b><span class="o-spkr-word">' + (v === 1 ? 'ghoul' : 'ghouls') + '</span></div></div></div>';
    },
  });

  /* ── giveaway — Pumpkin reveal ── */
  var FACE_G = 'M60 86l19 0-9-17zM89 86l19 0-10-17zM80 98h8l-4-8zM54 108Q84 140 114 108Q84 121 54 108Z';
  var TEETH_G = 'M68 111h7v5h-7zM93 111h7v5h-7z';
  var PUMPKIN = '<svg class="o-spkg-svg" viewBox="0 0 168 152" aria-hidden="true">'
    + '<ellipse class="o-spkg-lobe" cx="56" cy="96" rx="46" ry="52"/><ellipse class="o-spkg-lobe" cx="112" cy="96" rx="46" ry="52"/>'
    + '<ellipse class="o-spkg-shade" cx="56" cy="96" rx="46" ry="52"/><ellipse class="o-spkg-shade" cx="112" cy="96" rx="46" ry="52"/>'
    + '<ellipse class="o-spkg-lobe" cx="84" cy="94" rx="44" ry="56"/>'
    + '<path class="o-spkg-hi" d="M64 62C58 76 58 104 64 122"/>'
    + '<ellipse class="o-spkg-hole" cx="84" cy="46" rx="25" ry="6.5"/>'
    + '<path class="o-spkg-cut" d="' + FACE_G + '"/><path class="o-spkg-tooth" d="' + TEETH_G + '"/></svg>';
  var PUMPKIN_LIGHT = '<svg class="o-spkg-svg o-spkg-light" viewBox="0 0 168 152" aria-hidden="true"><ellipse class="o-spkg-lit" cx="84" cy="46" rx="25" ry="6.5"/>'
    + '<path class="o-spkg-lit" d="' + FACE_G + '"/><path class="o-spkg-tooth" d="' + TEETH_G + '"/></svg>';
  var LID = '<svg class="o-spkg-svg" viewBox="0 0 168 152" aria-hidden="true">'
    + '<path class="o-spkg-stem" d="M80 32c-1-8 1-15 6-19l5 3c-4 4-5 9-4 16z"/>'
    + '<path class="o-spkg-vine" d="M89 27c7 1 9 8 4 11"/>'
    + '<path class="o-spkg-leaf" d="M90 21c4-9 15-11 22-5-5 7-15 8-22 5z"/>'
    + '<path class="o-spkg-cap" d="M58 47C58 36 70 30 84 30S110 36 110 47L103 43 96 48 90 43 84 48 78 43 72 48 65 43Z"/>'
    + '<path class="o-spkg-hi" d="M68 40C72 35 78 33 84 33"/></svg>';
  add({
    id: 'giveaway-spooky', alert: 'giveaway', fam: 'spk', isNew: true, title: 'Pumpkin reveal',
    desc: 'A jack-o’-lantern lands and its carved face lights up. Its top pops off and sparkles fly out, the winner’s name glows in, and the prize swings in on a tag.',
    sound: 'spkGiveaway', fx: 'confetti', anim: hold('1.8s'), exit: EXIT, len: 1.9,
    render: function (d) {
      var r = rng(hash(d.username)), sparks = '', i;
      for (i = 0; i < 8; i++) {
        var ang = (-165 + i * (130 / 7) + (r() * 10 - 5)) * Math.PI / 180, dist = 44 + r() * 36;
        sparks += '<i class="o-spkg-spark" style="--dx:' + (Math.cos(ang) * dist).toFixed(0) + 'px;--dy:' + (Math.sin(ang) * dist * 0.95).toFixed(0) + 'px;--z:' + (8 + Math.round(r() * 6))
          + 'px;--ss:' + (0.6 + r() * 0.35).toFixed(2) + ';--sd:' + (0.9 + i * 0.04).toFixed(2) + 's"></i>';
      }
      return '<div class="obj o-spk o-spkg">'
        + '<div class="o-spk-plate o-spkg-plate"><div class="o-spk-lbl o-spkg-lbl">' + label(d, 'Giveaway winner!') + '</div>' + nm('o-spk-name o-spkg-name', d.username, 12) + '</div>'
        + (d.prize ? '<div class="o-spkg-tagwrap"><i class="o-spkg-string"></i><div class="o-spkg-tag"><span class="o-spkg-ptl">Prize</span><span class="o-spkg-prize">' + esc(d.prize) + '</span></div></div>' : '')
        + '<div class="o-spkg-pumpkin">' + PUMPKIN + PUMPKIN_LIGHT + '<div class="o-spkg-lid">' + LID + '</div></div>'
        + '<div class="o-spkg-sparks">' + sparks + '</div></div>';
    },
  });
})();
