/* ═════════ COZY — paper and stickers ═════════
   Six looks made of paper: a sticky note, a polaroid, a jar of stars, a love letter, paper boats and a
   gift box. Handwriting is Caveat, labels are Nunito stickers; doodles draw themselves. */
FAMS.cz = {
  name: 'Cozy', order: 7, badge: 'new',
  sw: 'linear-gradient(135deg,#FFE7A3 0 34%,#BFF0D4 34% 67%,#C9B8FF 67%)',
  desc: 'Paper and stickers: a sticky note, a polaroid, a jar of stars, a love letter, paper boats and a gift box, all written by hand.',
};

SOUND_NAMES.czFollow = 'Paper and chime';
SOUNDS.czFollow = function () {
  noise({ ft: 'bandpass', f: 2400, q: 0.8, d: 0.14, v: 0.18, t: 0.02 });
  tone({ f: 520, f2: 260, d: 0.09, v: 0.08, t: 0.36 });
  tone({ f: 1047, d: 0.4, v: 0.05, t: 1.15 });
  tone({ f: 1568, d: 0.6, v: 0.045, t: 1.27 });
};
SOUND_NAMES.czSub = 'Camera click and leaves';
SOUNDS.czSub = function () {
  noise({ ft: 'highpass', f: 3500, d: 0.04, v: 0.28, t: 0.3 });
  noise({ ft: 'bandpass', f: 1400, q: 3, d: 0.07, v: 0.18, t: 0.36 });
  [784, 880, 1047, 1175, 1319].forEach(function (f, i) { tone({ f: f, d: 0.22, v: 0.04, t: 1.05 + i * 0.09 }); });
};
SOUND_NAMES.czBits = 'Twinkling stars';
SOUNDS.czBits = function () {
  [1047, 1175, 1319, 1568, 1760, 2093, 1760, 2349].forEach(function (f, i) { tone({ f: f, d: 0.22, v: 0.035, t: 0.45 + i * 0.07 }); });
  tone({ f: 2637, d: 0.5, v: 0.03, t: 1.1 });
};
SOUND_NAMES.czDonation = 'Envelope and bell';
SOUNDS.czDonation = function () {
  noise({ ft: 'bandpass', f: 900, f2: 2400, q: 0.7, d: 0.38, v: 0.16 });
  noise({ ft: 'bandpass', f: 1800, q: 2, d: 0.08, v: 0.14, t: 0.6 });
  tone({ f: 784, d: 0.6, v: 0.06, t: 1.3 });
  tone({ f: 1175, d: 0.9, v: 0.05, t: 1.38 });
};
SOUND_NAMES.czRaid = 'Splash and toot';
SOUNDS.czRaid = function () {
  noise({ ft: 'lowpass', f: 900, f2: 300, d: 0.5, v: 0.2, t: 0.1 });
  tone({ f: 330, d: 0.22, v: 0.07, type: 'triangle', t: 0.7 });
  tone({ f: 392, d: 0.32, v: 0.07, type: 'triangle', t: 0.95 });
};
SOUND_NAMES.czGiveaway = 'Rustle, pop and sparkle';
SOUNDS.czGiveaway = function () {
  [0, 0.12, 0.24].forEach(function (t) { noise({ ft: 'bandpass', f: 3000, q: 1, d: 0.07, v: 0.12, t: 0.45 + t }); });
  tone({ f: 480, f2: 180, d: 0.12, v: 0.1, t: 1.0 });
  noise({ ft: 'highpass', f: 2500, d: 0.05, v: 0.2, t: 1.0 });
  [1047, 1319, 1568, 2093].forEach(function (f, i) { tone({ f: f, d: 0.3, v: 0.05, t: 1.15 + i * 0.08 }); });
};

function czExit(name) { return { out: name, dur: '.45s', ease: 'cubic-bezier(.5,0,.9,.4)' }; }
var CZ_HEART = '<path class="o-cz-ink" pathLength="100" d="M21 34C10 26 3 19 4 11 5 4 14 2 21 10 28 2 37 4 38 11 39 19 32 26 21 34Z"/>';
function czStarCount(n) { return Math.max(3, Math.min(20, Math.round(3 + Math.log10(Math.max(1, n)) * 4))); }

add({
  id: 'follow-cozy', alert: 'follow', fam: 'cz', isNew: true, title: 'Sticky note',
  desc: 'A sticky note drops in and settles, washi tape slaps on, “hi” is written in by hand and a heart doodles itself.',
  sound: 'czFollow', fx: 'none', anim: hold('1.8s'), exit: czExit('czPeel'), len: 1.85,
  render: function (d) {
    return '<div class="obj o-cz o-czf"><div class="o-czf-note"><div class="o-czf-tag o-cz-sticker">' + label(d, 'new friend') + '</div>'
      + '<div class="o-czf-row">' + nm('o-czf-hi o-cz-hand', 'hi ' + d.username + '!', 15)
      + '<svg class="o-czf-heart" viewBox="0 0 42 38" aria-hidden="true">' + CZ_HEART + '</svg></div></div>'
      + '<i class="o-cz-tape o-czf-tape"></i></div>';
  },
});

add({
  id: 'subscriber-cozy', alert: 'subscription', fam: 'cz', isNew: true, title: 'Polaroid', amount: 'Months as leaves',
  desc: 'A polaroid slides in and develops: a doodled plant grows one leaf per month, up to twelve, and flowers after a year.',
  sound: 'czSub', fx: 'none', anim: hold('1.6s'), exit: czExit('czFallOff'),
  len: function (d) { return 1.05 + Math.min(12, Math.max(1, intOf(d.months))) * 0.08 + 0.55; },
  render: function (d) {
    var months = Math.max(1, intOf(d.months)), n = Math.min(12, months), L = 10 + n * 5, top = 80 - L, leaves = '', flower = '', i;
    for (i = 0; i < n; i++) {
      var y = 76 - i * 5, s = i % 2 ? 1 : -1;
      leaves += '<path class="o-czs-leaf" style="transform-origin:60px ' + y + 'px;--ld:' + (1.05 + i * 0.08).toFixed(2) + 's" d="M60 ' + y
        + 'Q' + (60 + s * 8) + ' ' + (y - 12) + ' ' + (60 + s * 17) + ' ' + (y - 7) + 'Q' + (60 + s * 9) + ' ' + (y + 1) + ' 60 ' + y + 'Z"/>';
    }
    var after = 1.05 + n * 0.08;
    if (months >= 12) {
      for (i = 0; i < 5; i++) {
        var a = i * 72 * Math.PI / 180;
        flower += '<circle class="o-czs-petal" cx="' + (60 + 5 * Math.sin(a)).toFixed(1) + '" cy="' + (top - 5 * Math.cos(a)).toFixed(1) + '" r="3.6"/>';
      }
      flower = '<g class="o-czs-flower" style="transform-origin:60px ' + top + 'px;--fd:' + (after + 0.05).toFixed(2) + 's">' + flower
        + '<circle class="o-czs-bud" cx="60" cy="' + top + '" r="2.6"/></g>';
      after += 0.3;
    }
    var stem = 'M60 80C56 ' + (80 - L * 0.35).toFixed(1) + ' 64 ' + (80 - L * 0.65).toFixed(1) + ' 60 ' + top;
    return '<div class="obj o-cz o-czs"><div class="o-czs-pola"><div class="o-czs-photo">'
      + '<svg viewBox="0 0 120 108" aria-hidden="true"><path class="o-czs-stem o-cz-ink" pathLength="100" d="' + stem + '"/>' + leaves + flower
      + '<path class="o-czs-pot" d="M43 84H77L73 107H47Z"/><path class="o-czs-pot" d="M40 79H80V86H40Z"/></svg>'
      + '<i class="o-czs-dev"></i><div class="o-czs-tier o-cz-sticker" style="--td:' + (after + 0.1).toFixed(2) + 's">tier<b>' + esc(d.tier || '1') + '</b></div></div>'
      + '<div class="o-czs-cap">' + nm('o-czs-name o-cz-hand', d.username, 11) + '<span class="o-czs-months">· ' + (months > 1 ? months + ' months' : 'new!') + '</span></div></div>'
      + '<div class="o-cz-tape o-czs-tape">' + label(d, months > 1 ? 'resubscribed' : 'new subscriber') + '</div></div>';
  },
});

add({
  id: 'bits-cozy', alert: 'bits', fam: 'cz', isNew: true, title: 'Jar of stars', amount: 'Grows with the amount',
  desc: 'The jar’s lid lifts and paper stars drop in and settle, more stars for more bits; a tag swings in with the amount and a handwritten thank-you.',
  sound: 'czBits', fx: 'none', anim: hold('1.5s'), exit: czExit('czHop'),
  len: function (d) { return 0.42 + czStarCount(intOf(d.amount != null ? d.amount : d.bits)) * 0.06 + 0.65; },
  render: function (d) {
    var n = intOf(d.amount != null ? d.amount : d.bits), count = czStarCount(n), r = rng(hash(d.username + n)), stars = '', i;
    var cols = ['var(--a-hi,#FFD45C)', 'var(--a,#7FD9A8)', 'var(--a-tint,#A98BFF)', 'var(--a-lo,#FF8FAB)', 'var(--a-soft,#FFB86B)'];   // shades of the streamer's colour (five pastels by default)
    for (i = 0; i < count; i++) {
      stars += '<i class="o-czb-star" style="--x:' + (4 + (i % 4) * 22 + r() * 6).toFixed(0) + '%;--y:' + (3 + Math.floor(i / 4) * 15 + r() * 5).toFixed(0)
        + 'px;--s:' + (15 + Math.round(r() * 7)) + 'px;--c:' + cols[i % cols.length] + ';--r:' + Math.round(r() * 70 - 35) + 'deg;--sd:' + (0.42 + i * 0.06).toFixed(2) + 's"></i>';
    }
    return '<div class="obj o-cz o-czb"><div class="o-czb-jar" style="--lidd:' + (0.35 + count * 0.06 + 0.5).toFixed(2) + 's"><i class="o-czb-lid"></i><i class="o-czb-neck"></i>'
      + '<div class="o-czb-glass">' + stars + '<i class="o-czb-shine"></i></div></div>'
      + '<i class="o-czb-string"></i><div class="o-czb-tagwrap"><div class="o-czb-tag">'
      + '<div class="o-czb-amtrow"><span class="o-czb-amt">' + odo(fmt(n), 0.45, 0.8) + '</span><span class="o-czb-unit">bits</span></div>'
      + '<div class="o-czb-ty o-cz-hand">' + label(d, 'thank you,') + '</div>' + nm('o-czb-name o-cz-hand', d.username, 11) + '</div></div></div>';
  },
});

add({
  id: 'donation-cozy', alert: 'donation', fam: 'cz', isNew: true, title: 'Love letter',
  desc: 'An envelope slides in and its flap opens; a letter rises with the message in handwriting, the amount on a postage stamp, signed by the donor.',
  sound: 'czDonation', fx: 'none', anim: hold('1.4s'), exit: czExit('czSlideDown'),
  len: function (d) { var c = Array.from(d.message || '').length; return 1.3 + (c ? Math.min(1.4, c * 0.03) : 0.2) + 0.6; },
  render: function (d) {
    var amt = money(d.amount, d.currency), text = d.message || '', count = Array.from(text).length;
    var per = count ? Math.min(0.03, 1.4 / count) : 0, t = typed(text, 1.3, per, 140);
    var sign = 1.3 + (count ? Math.min(140, count) * per : 0.2) + 0.15;
    return '<div class="obj o-cz o-czd"><div class="o-czd-env"><i class="o-czd-back"></i><i class="o-czd-flap"></i>'
      + '<div class="o-czd-letter"><div class="o-czd-lbl o-cz-sticker">' + label(d, 'you’ve got mail') + '</div>'
      + (t.n ? '<div class="o-czd-msg o-cz-hand o-typed" style="' + t.style + '">' + t.html + '</div>'
        : '<svg class="o-czd-heart" viewBox="0 0 42 38" aria-hidden="true">' + CZ_HEART + '</svg>')
      + nm('o-czd-sign o-cz-hand', '— ' + d.username, 12, '--sgd:' + sign.toFixed(2) + 's;')
      + '<div class="o-czd-stamp"><b style="font-size:' + (Array.from(amt).length > 7 ? 10.5 : 13) + 'px">' + esc(amt) + '</b><span>tip</span></div></div>'
      + '<i class="o-czd-pocket"></i></div></div>';
  },
});

add({
  id: 'raid-cozy', alert: 'raid', fam: 'cz', isNew: true, title: 'Paper boats', amount: 'Grows with the viewers',
  desc: 'Paper boats sail in on paper waves and bob, one per raider up to eight; the count is circled in doodle and the raider’s name is written in.',
  sound: 'czRaid', fx: 'none', anim: hold('1.4s'), exit: czExit('czSailOut'),
  len: function (d) { return 0.35 + Math.min(8, intOf(d.viewers)) * 0.12 + 0.9; },
  render: function (d) {
    var v = intOf(d.viewers), n = Math.min(v, 8), sp = n ? Math.min(70, 340 / n) : 0, boats = '', i;
    var cols = ['var(--cza)', 'var(--a-tint,#FFFDF8)', 'var(--a-hi,#FFE7A3)', 'var(--a-soft,#BFF0D4)', 'var(--a-tint,#FFC9D6)', 'var(--a-lo,#E7D3B5)', 'var(--a-soft,#C9B8FF)', 'var(--a-tint,#FFFDF8)'];   // shades of the streamer's colour (pastel paper by default)
    for (i = 0; i < n; i++) {
      var cx = 210 + ((n - 1) / 2 - i) * sp;
      boats += '<div class="o-czr-boat" style="--bx:' + (cx - 23).toFixed(0) + 'px;--bc:' + cols[i % cols.length] + ';--bd:' + (0.35 + i * 0.12).toFixed(2) + 's">'
        + '<svg viewBox="0 0 46 34" aria-hidden="true"><path class="o-czr-hull" d="M23 3L37 19H9Z"/><path class="o-czr-fold" d="M23 3V19H9Z"/>'
        + '<path class="o-czr-hull" d="M2 19H44L36 31H10Z"/><path class="o-czr-shade" d="M2 19H23L18 31H10Z"/></svg></div>';
    }
    return '<div class="obj o-cz o-czr"><div class="o-czr-card"><div class="o-czr-count"><svg viewBox="0 0 86 70" aria-hidden="true">'
      + '<path class="o-cz-ink" pathLength="100" d="M70 16C88 26 80 62 44 64 10 66 2 40 14 22 24 8 52 4 74 14"/></svg>' + odo(fmt(v), 0.35, 0.8) + '</div>'
      + '<div class="o-czr-txt"><div class="o-czr-lbl o-cz-sticker">' + label(d, 'raid!') + '</div>' + nm('o-czr-name o-cz-hand', d.username, 12)
      + '<div class="o-czr-sub o-cz-hand">brought friends!</div></div></div>'
      + '<div class="o-czr-sea"><i class="o-czr-wave back"></i>' + boats + '<i class="o-czr-wave front"></i></div></div>';
  },
});

add({
  id: 'giveaway-cozy', alert: 'giveaway', fam: 'cz', isNew: true, title: 'Gift box',
  desc: 'A wrapped box drops in and wiggles, the lid pops off with paper confetti and a gift tag rises out with the winner’s name and the prize.',
  sound: 'czGiveaway', fx: 'confetti', anim: hold('1.9s'), exit: czExit('czGiftOut'), len: 2.0,
  render: function (d) {
    var r = rng(hash(d.username)), conf = '', i, cols = ['#FFE7A3', '#BFF0D4', '#C9B8FF', '#FFC9D6', '#FFFFFF', 'var(--cza)'];
    for (i = 0; i < 14; i++) {
      var ang = (-150 + r() * 120) * Math.PI / 180, dist = 40 + r() * 60;
      conf += '<i style="--dx:' + (Math.cos(ang) * dist).toFixed(0) + 'px;--dy:' + (Math.sin(ang) * dist).toFixed(0) + 'px;--rr:' + Math.round(r() * 540 - 270)
        + 'deg;--w:' + (5 + Math.round(r() * 4)) + 'px;--h:' + (7 + Math.round(r() * 5)) + 'px;--br:' + (i % 3 ? '1px' : '50%') + ';--cc:' + cols[i % cols.length]
        + ';--du:' + (0.9 + r() * 0.4).toFixed(2) + 's;--dd:' + (1.02 + r() * 0.12).toFixed(2) + 's"></i>';
    }
    return '<div class="obj o-cz o-czg"><div class="o-czg-tagwrap"><div class="o-czg-tag"><div class="o-czg-lbl o-cz-sticker">' + label(d, 'giveaway winner') + '</div>'
      + nm('o-czg-for o-cz-hand', 'for ' + d.username, 13) + (d.prize ? '<div class="o-czg-prize">' + esc(d.prize) + '</div>' : '') + '</div></div>'
      + '<div class="o-czg-box"><div class="o-czg-body"></div><div class="o-czg-lid"><div class="o-czg-bow"><i></i><i></i></div></div></div>'
      + '<div class="o-czg-conf">' + conf + '</div></div>';
  },
});
