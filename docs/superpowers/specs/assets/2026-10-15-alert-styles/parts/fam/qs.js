/* ═══ Quest — fantasy RPG: parchment, gold leaf, wax and steel ═══ */
FAMS.qs = {
  name: 'Quest', order: 5, badge: 'new',
  sw: 'linear-gradient(135deg,#F1E3C2 0 46%,#E2B53E 46% 62%,#5B1A1A 62%)',
  desc: 'Fantasy RPG: a scroll for follows, LEVEL UP! for subs, a treasure chest for bits, a royal decree for donations, a shield wall for raids and legendary loot for giveaways.',
};

SOUND_NAMES.qsFollow = 'Scroll unfurl';
SOUNDS.qsFollow = function () {
  noise({ ft: 'bandpass', f: 1800, f2: 700, q: 0.8, t: 0.2, d: 0.55, v: 0.16, a: 0.05 });
  tone({ f: 1318, d: 0.5, v: 0.05, t: 0.9 });
  tone({ f: 2637, d: 0.4, v: 0.025, t: 1.06 });
};
SOUND_NAMES.qsSub = 'Level-up fanfare';
SOUNDS.qsSub = function () {
  [523, 659, 784, 1046].forEach(function (f, i) { tone({ f: f, d: 0.16, v: 0.09, type: 'triangle', t: 0.45 + i * 0.09 }); });
  [523, 659, 784].forEach(function (f) { tone({ f: f * 2, d: 0.8, v: 0.04, type: 'triangle', t: 0.85 }); });
  tone({ f: 1568, d: 0.5, v: 0.03, t: 1.42 });
};
SOUND_NAMES.qsBits = 'Chest of gold';
SOUNDS.qsBits = function () {
  tone({ f: 110, f2: 60, d: 0.22, v: 0.3, a: 0.003 });
  noise({ ft: 'lowpass', f: 500, f2: 220, t: 0.36, d: 0.3, v: 0.16 });
  for (var i = 0; i < 7; i++) tone({ f: 2200 + (i % 3) * 500, d: 0.06, v: 0.03, type: 'square', t: 0.55 + i * 0.07 });
};
SOUND_NAMES.qsDonation = 'Wax seal';
SOUNDS.qsDonation = function () {
  noise({ ft: 'bandpass', f: 1500, f2: 600, q: 0.7, t: 0.2, d: 0.6, v: 0.14, a: 0.06 });
  tone({ f: 130, f2: 60, d: 0.3, v: 0.35, a: 0.003, t: 1.12 });
  noise({ ft: 'lowpass', f: 400, t: 1.12, d: 0.12, v: 0.2 });
  tone({ f: 392, d: 0.7, v: 0.05, type: 'triangle', t: 1.2 });
};
SOUND_NAMES.qsRaid = 'War drums';
SOUNDS.qsRaid = function () {
  tone({ f: 220, f2: 233, d: 0.9, v: 0.07, type: 'triangle', t: 0.15 });
  for (var i = 0; i < 5; i++) {
    tone({ f: 92, f2: 44, d: 0.35, v: 0.42, a: 0.003, t: 0.7 + i * 0.18 });
    noise({ ft: 'lowpass', f: 380, d: 0.07, v: 0.18, t: 0.7 + i * 0.18 });
  }
};
SOUND_NAMES.qsGiveaway = 'Legendary chime';
SOUNDS.qsGiveaway = function () {
  tone({ f: 110, f2: 220, d: 1.0, v: 0.06, type: 'triangle', t: 0.1 });
  [1568, 2093, 2637, 3136].forEach(function (f, i) { tone({ f: f, d: 0.8, v: 0.045, t: 0.9 + i * 0.08 }); });
};

add({
  id: 'follow-quest', alert: 'follow', fam: 'qs', isNew: true, title: 'Quest accepted',
  desc: 'A parchment scroll drops in and opens between its two wooden rods, showing the follower’s name written on it, then a glint of gold runs across. It rolls back up to leave.',
  sound: 'qsFollow', fx: 'none',
  anim: { in: 'qsDrop', dur: '.22s', ease: 'cubic-bezier(.3,.8,.3,1)' },
  exit: { out: 'qsExitUp', dur: '.55s', ease: 'linear' }, len: 1.3,
  render: function (d) {
    return '<div class="obj o-qs o-qsf"><div class="o-qs-paper o-qsf-paper"><i class="o-qsf-glint"></i><div class="o-qsf-in">'
      + '<div class="o-qs-kicker">' + label(d, 'Quest accepted') + '</div>' + nm('o-qs-name', d.username, 17)
      + '<div class="o-qsf-line">joined the party</div></div></div>'
      + '<div class="o-qsf-half l"><i class="o-qs-rod"></i></div><div class="o-qsf-half r"><i class="o-qs-rod"></i></div></div>';
  },
});

add({
  id: 'subscriber-quest', alert: 'subscription', fam: 'qs', isNew: true, title: 'Level up',
  desc: 'The XP bar fills and flashes, then the level-up: a crest stamps on with the months as the level, rays burst behind it and LEVEL UP! rises. The name follows, with the tier as stars.',
  amount: 'Months as levels', sound: 'qsSub', fx: 'sparks',
  anim: { in: 'hold', dur: '1.5s', ease: 'linear' },
  exit: { out: 'qsExitDown', dur: '.4s', ease: 'cubic-bezier(.5,0,.9,.4)' }, len: 1.45,
  render: function (d) {
    var months = Math.max(1, intOf(d.months)), tier = Math.min(3, Math.max(1, intOf(d.tier) || 1)), stars = '';
    for (var i = 0; i < 3; i++) stars += '<i class="o-qss-star' + (i < tier ? ' on' : '') + '" style="--sd:' + (1.12 + i * 0.08).toFixed(2) + 's"></i>';
    return '<div class="obj o-qs o-qss"><div class="o-qss-plate"></div><div class="o-qss-rays"></div>'
      + '<div class="o-qss-crestw"><div class="o-qss-crest"><i></i><span class="o-qss-lv">LV</span><span class="o-qss-num">' + months + '</span></div></div>'
      + '<div class="o-qss-txt"><div class="o-qss-up">' + label(d, 'Level up!') + '</div>' + nm('o-qs-name', d.username, 15)
      + '<div class="o-qss-meta"><span class="o-qss-stars">' + stars + '</span><span>Tier ' + tier + ' · ' + months + (months === 1 ? ' month' : ' months') + '</span></div>'
      + '<div class="o-qss-xp"><b>XP</b><i></i></div></div></div>';
  },
});

add({
  id: 'bits-quest', alert: 'bits', fam: 'qs', isNew: true, title: 'Treasure chest',
  desc: 'The chest lands with a thud, its lid swings open, gold light pours out and coins spill around it, more for more bits. The amount unfurls on a ribbon.',
  amount: 'Grows with the amount', sound: 'qsBits', fx: 'none',
  anim: { in: 'hold', dur: '1.3s', ease: 'linear' },
  exit: { out: 'qsExitDown', dur: '.4s', ease: 'cubic-bezier(.5,0,.9,.4)' }, len: 1.4,
  render: function (d) {
    var n = intOf(d.amount != null ? d.amount : d.bits), r = rng(hash(d.username + n));
    var count = Math.max(4, Math.min(14, 3 + Math.round(Math.log10(n + 1) * 2.6))), coins = '';
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

add({
  id: 'donation-quest', alert: 'donation', fam: 'qs', isNew: true, title: 'Royal decree',
  desc: 'A decree unrolls downwards from its rod and shows, line by line, the amount in gold, the donor’s name and the message. A red wax seal stamps on last.',
  sound: 'qsDonation', fx: 'none',
  anim: { in: 'qsDrop', dur: '.22s', ease: 'cubic-bezier(.3,.8,.3,1)' },
  exit: { out: 'qsExitUp', dur: '.55s', ease: 'linear' }, len: 1.3,
  render: function (d) {
    return '<div class="obj o-qs o-qsd"><i class="o-qsd-rod"></i><div class="o-qsd-sheet"><div class="o-qs-paper o-qsd-paper">'
      + '<div class="o-qs-kicker">' + label(d, 'By royal decree') + '</div>'
      + '<div class="o-qsd-amt">' + esc(money(d.amount, d.currency)) + '</div>'
      + '<div class="o-qsd-by">granted by</div>' + nm('o-qs-name', d.username, 16)
      + (d.message ? '<div class="o-qsd-msg">“' + esc(d.message) + '”</div>' : '')
      + '</div><div class="o-qsd-carrier"><i class="o-qsd-rod"></i></div>'
      + '<div class="o-qsd-seal"><i><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h18l-1.6-10-4.4 4-3-7-3 7-4.4-4z" fill="rgba(60,0,4,.55)"/><path d="M3 20.5h18" stroke="rgba(60,0,4,.55)" stroke-width="2"/></svg></i></div>'
      + '</div></div>';
  },
});

add({
  id: 'raid-quest', alert: 'raid', fam: 'qs', isNew: true, title: 'The horde approaches',
  desc: 'The board appears, war banners rise from behind it, and a wall of shields slams in, one per raider up to nine, while the count of warriors rolls up.',
  amount: 'Grows with the viewers', sound: 'qsRaid', fx: 'smoke',
  anim: { in: 'hold', dur: '1.5s', ease: 'linear' },
  exit: { out: 'qsExitDown', dur: '.45s', ease: 'cubic-bezier(.5,0,.9,.4)' },
  len: function (d) { return 0.95 + Math.min(9, intOf(d.viewers)) * 0.08; },
  render: function (d) {
    var v = intOf(d.viewers), n = Math.min(v, 9), shields = '', bans = '';
    var fields = ['#5B1A1A', '#1F3A6B', '#22502E', '#1A1A1E', '#6B4A12'];
    for (var i = 0; i < n; i++) shields += '<span class="o-qsr-sh c' + (i % 5) + '" style="--sf:' + fields[(i * 2) % 5] + ';--sd:' + (0.66 + i * 0.08).toFixed(2) + 's"><i></i></span>';
    if (v > n) shields += '<span class="o-qsr-more" style="--sd:' + (0.66 + n * 0.08).toFixed(2) + 's">+' + fmt(v - n) + '</span>';
    [22, 50, 78].forEach(function (x, j) { bans += '<span class="o-qsr-ban" style="--bx:' + x + '%;--bd:' + (0.2 + j * 0.08).toFixed(2) + 's"><span class="o-qsr-flag"><i></i><b></b></span></span>'; });
    return '<div class="obj o-qs o-qsr"><div class="o-qsr-banners">' + bans + '</div><div class="o-qsr-plate">'
      + '<div class="o-qsr-title">' + label(d, 'The horde approaches') + '</div>'
      + '<div class="o-qsr-line">' + nm('o-qsr-who', d.username, 12) + '<span>leads</span><b class="o-qsr-count">' + odo(fmt(v), 0.5, 0.6) + '</b><span>' + (v === 1 ? 'warrior' : 'warriors') + '</span></div>'
      + '<div class="o-qsr-shields">' + shields + '</div></div></div>';
  },
});

add({
  id: 'giveaway-quest', alert: 'giveaway', fam: 'qs', isNew: true, title: 'Legendary loot',
  desc: 'An item card lands face down, then turns over to its glowing legendary front while rays fan out behind it: the winner is the item, the prize its description.',
  sound: 'qsGiveaway', fx: 'sparks',
  anim: { in: 'hold', dur: '1.2s', ease: 'linear' },
  exit: { out: 'qsExitShrink', dur: '.4s', ease: 'cubic-bezier(.5,0,.9,.4)' }, len: 1.2,
  render: function (d) {
    return '<div class="obj o-qs o-qsg"><div class="o-qsg-rays"></div><div class="o-qsg-card"><div class="o-qsg-flip">'
      + '<div class="o-qsg-face o-qsg-back"><i></i></div>'
      + '<div class="o-qsg-face o-qsg-front"><div class="o-qsg-rarity" style="--k:0">' + label(d, 'Legendary') + '</div><div class="o-qsg-gem" style="--k:1"></div>'
      + nm('o-qs-name', d.username, 16, '--k:2;') + '<div class="o-qsg-type" style="--k:3">Giveaway winner</div>'
      + (d.prize ? '<div class="o-qsg-desc" style="--k:4">Grants: <b>' + esc(d.prize) + '</b></div>' : '')
      + '</div></div></div></div>';
  },
});
