(function () {
'use strict';

var OBJ = window.ATLETA_OBJECTS || {};
var REDUCE = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/* ── Helpers: the same ideas as public/overlay/objects/index.js ─────────── */
var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }

function money(amount, currency) {
  var code = String(currency == null ? '' : currency).trim().toUpperCase();
  var number = Number(amount);
  if (amount == null || String(amount).trim() === '' || !isFinite(number)) return ((code ? code + ' ' : '') + String(amount == null ? '' : amount)).trim();
  if (/^[A-Z]{3}$/.test(code)) {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(number); } catch (e) { /* plain form below */ }
  }
  return (code ? code + ' ' : '') + number.toFixed(2);
}
function isWide(cp) {
  return (cp >= 0x1100 && cp <= 0x11FF) || (cp >= 0x2E80 && cp <= 0xA4CF) || (cp >= 0xAC00 && cp <= 0xD7A3)
    || (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0xFE30 && cp <= 0xFE6F) || (cp >= 0xFF00 && cp <= 0xFF60)
    || (cp >= 0xFFE0 && cp <= 0xFFE6) || cp >= 0x1F000;
}
function nameWidth(name) {
  var chars = Array.from(String(name == null ? '' : name)), w = 0;
  for (var i = 0; i < chars.length; i++) w += isWide(chars[i].codePointAt(0)) ? 1.5 : 1;
  return w;
}
// --fit scales a long name down (never below 0.6); what still does not fit ends in an ellipsis.
function fitStyle(name, holds) {
  var w = nameWidth(name);
  var f = w > holds ? Math.max(0.6, holds / w) : 1;
  return f < 1 ? '--fit:' + f.toFixed(2) + ';' : '';
}
function nm(cls, name, holds, extra) {
  return '<div class="' + cls + ' o-nm" style="' + fitStyle(name, holds) + (extra || '') + '"><span class="o-nm-t">' + esc(name) + '</span></div>';
}
function samName(name, holds) {
  return '<div class="o-name" style="' + fitStyle(name, holds) + '"><span class="o-name-text">' + esc(name) + '</span></div>';
}
function fmt(n) { return Math.max(0, Math.round(Number(n) || 0)).toLocaleString('en-US'); }
function label(d, fallback) { return esc(d && d.label ? d.label : fallback); }

// An odometer: every digit rolls to its value, the units spin twice, the tens once.
var STRIP = (function () { var s = ''; for (var i = 0; i < 30; i++) s += '<i>' + (i % 10) + '</i>'; return s; })();
function odo(text, delay, dur) {
  var chars = Array.from(String(text));
  var digits = chars.filter(function (c) { return c >= '0' && c <= '9'; }).length, seen = 0;
  var out = '<span class="o-odo" style="--odel:' + delay + 's;--odur:' + dur + 's">';
  chars.forEach(function (c) {
    if (c >= '0' && c <= '9') {
      var place = digits - 1 - seen++;
      var spins = place === 0 ? 2 : place === 1 ? 1 : 0;
      out += '<span class="o-odo-d"><span class="o-odo-strip" style="--to:' + (spins * 10 + Number(c)) + '">' + STRIP + '</span></span>';
    } else {
      out += '<span class="o-odo-s">' + esc(c) + '</span>';
    }
  });
  return out + '</span>';
}
// Typed text: one span per character, each shown a little after the one before.
function typed(text, t0, per, max) {
  var chars = Array.from(String(text || ''));
  if (chars.length > max) chars = chars.slice(0, max - 1).concat('…');
  return {
    n: chars.length,
    style: '--t0:' + t0 + 's;--tper:' + per.toFixed(3) + 's;',
    html: chars.map(function (c, i) { return '<span class="o-ch" style="--ti:' + i + '">' + esc(c) + '</span>'; }).join(''),
  };
}
function hash(s) {
  var h = 2166136261 >>> 0, chars = Array.from(String(s));
  for (var i = 0; i < chars.length; i++) { h ^= chars[i].codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function rng(seed) {
  var a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function code3(name) {
  var letters = Array.from(String(name || '')).filter(function (c) { return /[\p{L}\p{N}]/u.test(c); });
  return (letters.slice(0, 3).join('') || 'NEW').toUpperCase();
}
function intOf(v) { return Math.max(0, parseInt(v, 10) || 0); }
function rgbOf(hex) { var v = parseInt(hex.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
// Dark or white text on a colour, whichever reads better.
function onColour(hex) {
  var c = rgbOf(hex).map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.179 ? '#0B0B12' : '#FFFFFF';
}

/* ── Sample alerts (Small / Medium / Big, normal or long name) ─────────── */
var state = { alert: 'all', fam: 'all', level: 'medium', long: false, livery: 'default', spd: 1, loop: !REDUCE, sound: false, stageFam: 'gp', stageFx: true };
var NAMES = { follow: 'ApexAndre', subscription: 'RacerDan', bits: 'TurboTina', donation: 'PitBoss92', raid: 'GridWalker', giveaway: 'LuckyViewer42' };
var LONG_NAME = 'TheLateBrakingLegend_2026';
function sample(alert) {
  var L = state.level, u = state.long ? LONG_NAME : NAMES[alert];
  switch (alert) {
    case 'follow': return { username: u };
    case 'subscription': return { username: u, tier: { small: '1', medium: '2', big: '3' }[L], months: { small: 1, medium: 4, big: 27 }[L], message: '' };
    case 'bits': return { username: u, amount: { small: 50, medium: 500, big: 10000 }[L] };
    case 'donation': return {
      username: u, currency: 'EUR', amount: { small: '2.50', medium: '25.00', big: '250.00' }[L],
      message: L === 'small' ? '' : L === 'big' ? 'Box box! New tyres for the whole season, and a coffee for the pit wall too. Send it!' : 'Box box! This one is for new tyres.',
    };
    case 'raid': return { username: u, viewers: { small: 6, medium: 42, big: 850 }[L] };
    default: return { username: u, prize: 'Season pass' };
  }
}

/* ── The looks ─────────────────────────────────────────────────────────── */
var GP_EXIT = { out: 'gpExit', dur: '.34s', ease: 'cubic-bezier(.6,0,.9,.4)' };
var CK_IN = { in: 'ckBoot', dur: '.32s', ease: 'cubic-bezier(.2,.8,.2,1)' };
var CK_EXIT = { out: 'ckOff', dur: '.34s', ease: 'ease-in' };
var AR_IN = { in: 'arPop', dur: '.24s', ease: 'steps(4)' };
var AR_EXIT = { out: 'arExit', dur: '.3s', ease: 'steps(4)' };
function hold(dur) { return { in: 'hold', dur: dur, ease: 'linear' }; }

var TYRE = { '1': ['S', '#FF3030'], '2': ['M', '#FFD12B'], '3': ['H', '#F2F2F2'] };
var TROPHY = '<svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="gpgGold" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#B8860B"/><stop offset=".5" stop-color="#FFE27A"/><stop offset="1" stop-color="#C9961A"/></linearGradient></defs><path d="M14 5h20v9a10 10 0 0 1-20 0z" fill="url(#gpgGold)"/><path d="M14 8H8.5a5.5 5.5 0 0 0 6.5 9M34 8h5.5a5.5 5.5 0 0 1-6.5 9" fill="none" stroke="url(#gpgGold)" stroke-width="3"/><rect x="21.5" y="23" width="5" height="9" fill="url(#gpgGold)"/><path d="M15 32h18l2.5 9h-23z" fill="url(#gpgGold)"/></svg>';

var GAUGE = (function () {
  var cx = 62, cy = 62, R = 50;
  function pt(phi, r) { var a = phi * Math.PI / 180; return [(cx + r * Math.sin(a)).toFixed(2), (cy - r * Math.cos(a)).toFixed(2)]; }
  var s = pt(-120, R), e = pt(120, R), rz = pt(84, R), ticks = '', labels = '';
  for (var k = 0; k <= 20; k++) {
    var phi = -120 + 12 * k, major = k % 2 === 0, a = pt(phi, major ? 34 : 37), b = pt(phi, 41);
    ticks += '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" class="' + (major ? 'mj' : 'mn') + '"/>';
    if (k % 4 === 0) { var l = pt(phi, 26); labels += '<text x="' + l[0] + '" y="' + l[1] + '">' + (k / 2) + '</text>'; }
  }
  var arc = 'M' + s[0] + ' ' + s[1] + ' A' + R + ' ' + R + ' 0 1 1 ' + e[0] + ' ' + e[1];
  return '<svg viewBox="0 0 124 124" aria-hidden="true"><path class="o-ckb-arc" d="' + arc + '"/>'
    + '<path class="o-ckb-red" d="M' + rz[0] + ' ' + rz[1] + ' A' + R + ' ' + R + ' 0 0 1 ' + e[0] + ' ' + e[1] + '"/>'
    + '<path class="o-ckb-fill" pathLength="100" d="' + arc + '"/>' + ticks + labels + '</svg>';
})();

var P = [];
function add(p) { P.push(p); }

/* Today's looks, rendered by today's code */
if (OBJ.follow) {
  add({ id: 'follow-samurai', alert: 'follow', fam: 'samurai', title: 'Iaido band', desc: 'A blade crosses at 22° and the band appears along the cut. Short, because follows come often.', sound: 'blade', fx: 'none', render: function (d) { return OBJ.follow.render(d); }, anim: OBJ.follow.anim, exit: OBJ.follow.exit, len: 0.8 });
  add({ id: 'subscriber-samurai', alert: 'subscription', fam: 'samurai', title: 'Torii gate', desc: 'Pillars plant, both beams drop and the name plaque hangs from its cords.', sound: 'taiko', fx: 'none', render: function (d) { return OBJ.subscription.render(d); }, anim: OBJ.subscription.anim, exit: OBJ.subscription.exit, len: 1.35 });
  add({ id: 'bits-samurai', alert: 'bits', fam: 'samurai', title: 'Tally board', desc: 'The blade crosses the board and flips each digit tile as it passes.', sound: 'blade', fx: 'none', render: function (d) { return OBJ.bits.render(d); }, anim: OBJ.bits.anim, exit: OBJ.bits.exit, len: 1.1 });
  add({ id: 'donation-samurai', alert: 'donation', fam: 'samurai', title: 'Byōbu screen', desc: 'Six panels unfold, the rails snap across and the amount is struck at 50px.', sound: 'koto', fx: 'none', render: function (d) { return OBJ.donation.render(d); }, anim: OBJ.donation.anim, exit: OBJ.donation.exit, len: 1.2 });
  add({ id: 'raid-samurai', alert: 'raid', fam: 'samurai', title: 'Banner rank', desc: 'Five banners plant outside-in; the standard lands last, carrying the count.', sound: 'taiko3', fx: 'none', render: function (d) { return OBJ.raid.render(d); }, anim: OBJ.raid.anim, exit: OBJ.raid.exit, len: 1.0 });
}

/* New: the samurai giveaway */
add({
  id: 'giveaway-samurai', alert: 'giveaway', fam: 'samurai', isNew: true, title: 'Omikuji',
  desc: 'The fortune box is shaken twice, a stick strikes out and the slip unrolls with the winner, stamped “great blessing”.',
  sound: 'bell', fx: 'none', anim: hold('1.5s'), exit: { out: 'exOmi', dur: '.36s', ease: 'cubic-bezier(.5,0,.9,.4)' }, len: 1.7,
  render: function (d) {
    return '<div class="obj o-omi"><div class="o-omi-stick"></div>'
      + '<div class="o-omi-box"><i class="o-omi-hole"></i><div class="o-omi-band t"></div><div class="o-omi-kanji">御神籤</div><div class="o-omi-band b"></div><div class="o-mesh"></div></div>'
      + '<div class="o-omi-slip"><div class="o-omi-stamp">大吉</div><div class="o-omi-txt"><div class="o-omi-mark">' + label(d, 'Great blessing · giveaway') + '</div>'
      + samName(d.username, 15) + (d.prize ? '<div class="o-meta">Won ' + esc(d.prize) + '</div>' : '') + '</div></div></div>';
  },
});

/* ── Grand Prix ── */
add({
  id: 'follow-grandprix', alert: 'follow', fam: 'gp', isNew: true, title: 'Lights out',
  desc: 'Five red lights come on one by one and go out together, and the name launches off the line.',
  sound: 'lights', fx: 'speed', anim: hold('1.8s'), exit: GP_EXIT, len: 1.8,
  render: function (d) {
    var pods = '';
    for (var i = 0; i < 5; i++) pods += '<div class="o-gpf-pod" style="--on:' + (0.26 + i * 0.16).toFixed(2) + 's"><i></i><i></i></div>';
    return '<div class="obj o-gp o-gpf"><div class="o-gpf-gantry">' + pods + '</div>'
      + '<div class="o-gp-plate o-gpf-plate"><i class="o-gp-stripe"></i><div class="o-gpf-streaks"><i></i><i></i><i></i></div>'
      + '<div class="o-gpf-txt"><div class="o-gp-label sq">' + label(d, 'New follower') + '</div>' + nm('o-gp-name', d.username, 20) + '</div></div></div>';
  },
});
add({
  id: 'subscriber-grandprix', alert: 'subscription', fam: 'gp', isNew: true, title: 'Timing tower', amount: 'Months as laps',
  desc: 'The subscriber overtakes all the way up the timing tower to P1. The tier is the tyre: soft, medium or hard.',
  sound: 'overtake', fx: 'checker', anim: hold('1.9s'), exit: GP_EXIT, len: 1.9,
  render: function (d) {
    var months = Math.max(1, intOf(d.months)), tyre = TYRE[String(d.tier || '1')] || TYRE['1'];
    var pos = '', ghosts = '';
    for (var i = 0; i < 5; i++) pos += '<div class="o-gps-pos" style="--p:' + i + '">' + (i + 1) + '</div>';
    var colours = ['#FF8A1E', '#2EC5FF', '#B9B9C6', '#2BD46C'], widths = [46, 58, 38, 52], gd = [1.24, 1.02, 0.80, 0.58];
    for (var j = 0; j < 4; j++) ghosts += '<div class="o-gps-row ghost" style="--slot:' + (j + 1) + ';--gd:' + gd[j] + 's;--tc:' + colours[j] + ';--w:' + widths[j] + 'px"></div>';
    var me = '<div class="o-gps-row me" style="--slot:0"><span class="o-gps-code">' + esc(code3(d.username)) + '</span><span class="o-gps-gain">▲4</span></div>';
    var heading = months > 1 ? 'Resubscribed · ' + months + ' months' : 'New subscriber';
    return '<div class="obj o-gp o-gps"><div class="o-gps-tower"><div class="o-gps-head"><span>Lap</span><b>' + months + '</b></div>' + pos + ghosts + me + '</div>'
      + '<div class="o-gp-plate o-gps-panel"><i class="o-gp-stripe"></i>'
      + '<div class="o-gp-label" style="--k:0">' + label(d, heading) + '</div>'
      + nm('o-gp-name', d.username, 13, '--k:1;')
      + '<div class="o-gps-meta" style="--k:2"><span class="o-gps-tyre" style="--tyre:' + tyre[1] + '">' + tyre[0] + '</span>Tier ' + esc(d.tier || '1') + '</div>'
      + (d.message ? '<div class="o-gps-msg" style="--k:3">' + esc(d.message) + '</div>' : '')
      + '</div></div>';
  },
});
add({
  id: 'bits-grandprix', alert: 'bits', fam: 'gp', isNew: true, title: 'Purple sector', amount: 'Grows with the amount',
  desc: 'Three sectors light up as the amount counts up. The more bits, the more purple; 1,000 or more is a purple lap.',
  sound: 'sectors', fx: 'sparks', anim: hold('1.3s'), exit: GP_EXIT, len: 1.4,
  render: function (d) {
    var n = intOf(d.amount != null ? d.amount : d.bits), lvl = n >= 1000 ? 'big' : n >= 100 ? 'medium' : 'small';
    var C = { y: 'var(--gp-yellow)', g: 'var(--gp-green)', p: 'var(--gp-purple)' };
    var sets = { small: ['y', 'g', 'g'], medium: ['g', 'g', 'p'], big: ['p', 'p', 'p'] }[lvl];
    var cap = { small: ['Personal best', C.g], medium: ['Fastest sector', C.p], big: ['Purple lap', C.p] }[lvl];
    var sectors = sets.map(function (k, i) { return '<div class="o-gpb-s" style="--sc:' + C[k] + ';--sd:' + (0.32 + i * 0.26).toFixed(2) + 's"><span>S' + (i + 1) + '</span><i></i></div>'; }).join('');
    return '<div class="obj o-gp o-gpb lvl-' + lvl + '"><div class="o-gp-plate o-gpb-top"><i class="o-gp-stripe"></i>'
      + '<div class="o-gpb-who"><div class="o-gp-label">' + label(d, 'Bits') + ' · <b style="color:' + cap[1] + '">' + cap[0] + '</b></div>' + nm('o-gp-name', d.username, 12) + '</div>'
      + '<div class="o-gpb-amt">' + odo(fmt(n), 0.3, 0.82) + '<small>bits</small></div></div>'
      + '<div class="o-gpb-sectors">' + sectors + '</div></div>';
  },
});
add({
  id: 'donation-grandprix', alert: 'donation', fam: 'gp', isNew: true, title: 'Team radio',
  desc: 'The radio waveform plays while the donor’s message is typed out, like a driver’s radio on the broadcast.',
  sound: 'radio', fx: 'none', anim: hold('.9s'), exit: GP_EXIT,
  len: function (d) { var n = Array.from(d.message || '').length; return n ? 0.6 + Math.min(2.2, n * 0.035) : 1; },
  render: function (d) {
    var text = d.message ? '“' + d.message + '”' : '', count = Array.from(text).length;
    var per = count ? Math.min(0.035, 2.0 / count) : 0, T = count ? count * per + 0.25 : 0.9;
    var msg = typed(text, 0.58, per, 160), r = rng(hash(d.username + d.amount)), bars = '';
    for (var i = 0; i < 40; i++) {
      var dur = 0.14 + r() * 0.12, wi = 2 * Math.max(1, Math.round(T / (2 * dur)));
      bars += '<i style="--h:' + (0.3 + r() * 0.7).toFixed(2) + ';--wdur:' + dur.toFixed(2) + 's;--wd:' + (0.5 + r() * 0.1).toFixed(2) + 's;--wi:' + wi + '"></i>';
    }
    return '<div class="obj o-gp o-gpd"><div class="o-gp-plate o-gpd-box"><i class="o-gp-stripe"></i>'
      + '<div class="o-gpd-head"><span class="o-gpd-radio">' + label(d, 'Team radio') + '</span><span class="o-gpd-amt">' + esc(money(d.amount, d.currency)) + '</span></div>'
      + nm('o-gp-name', d.username, 18)
      + '<div class="o-gpd-wave">' + bars + '</div>'
      + (msg.n ? '<div class="o-gpd-msg o-typed" style="' + msg.style + '">' + msg.html + '</div>' : '')
      + '</div></div>';
  },
});
add({
  id: 'raid-grandprix', alert: 'raid', fam: 'gp', isNew: true, title: 'Red flag', amount: 'Grows with the viewers',
  desc: 'Race control throws the red flag, and one car per raider fills the pit lane.',
  sound: 'raceControl', fx: 'smoke', anim: hold('1.4s'), exit: GP_EXIT,
  len: function (d) { return 1.4 + Math.min(12, intOf(d.viewers)) * 0.07; },
  render: function (d) {
    var v = intOf(d.viewers), shown = Math.min(v, 12), cars = '', strips = '';
    var pal = ['var(--gpa)', '#FFFFFF', '#FFD12B', '#2EC5FF', '#FF8A1E', '#2BD46C', '#B9B9C6', '#FF4FA3'];
    for (var i = 0; i < shown; i++) cars += '<i class="o-gpr-car" style="--ci:' + i + ';--cc:' + pal[i % pal.length] + '"></i>';
    for (var s = 0; s < 8; s++) strips += '<i style="--i:' + s + '"></i>';
    return '<div class="obj o-gp o-gpr"><div class="o-gpr-flash"></div>'
      + '<div class="o-gpr-head"><div class="o-gpr-flag">' + strips + '</div><div class="o-gpr-headtxt"><small>Race control</small><b>Red flag</b></div></div>'
      + '<div class="o-gp-plate o-gpr-body">'
      + '<div class="o-gp-label" style="--k:0">' + label(d, 'Raid incoming') + '</div>'
      + nm('o-gp-name', d.username, 20, '--k:1;')
      + '<div class="o-gpr-msg" style="--k:2">' + odo(fmt(v), 0.62, 0.7) + '<span>' + (v === 1 ? 'car' : 'cars') + ' entering the pit lane</span></div>'
      + '<div class="o-gpr-lane" style="--k:3">' + cars + (v > shown ? '<span class="o-gpr-more">+' + fmt(v - shown) + '</span>' : '') + '</div>'
      + '</div></div>';
  },
});
add({
  id: 'giveaway-grandprix', alert: 'giveaway', fam: 'gp', isNew: true, title: 'Podium',
  desc: 'The podium rises step by step, the winner lands on P1, the trophy appears and champagne sprays from both sides.',
  sound: 'podium', fx: 'champagne', anim: hold('1.5s'), exit: GP_EXIT, len: 1.8,
  render: function (d) {
    var r = rng(hash(d.username));
    function drops(side) {
      var out = '';
      for (var i = 0; i < 14; i++) {
        var dx = (side === 'l' ? 1 : -1) * (40 + r() * 120), dy = -(30 + r() * 80);
        out += '<i class="o-gpg-drop" style="--dx:' + dx.toFixed(0) + 'px;--dy:' + dy.toFixed(0) + 'px;--du:' + (0.7 + r() * 0.5).toFixed(2) + 's;--dd:' + (1.0 + r() * 0.45).toFixed(2) + 's"></i>';
      }
      return out;
    }
    return '<div class="obj o-gp o-gpg"><div class="o-gpg-trophy">' + TROPHY + '</div>'
      + '<div class="o-gpg-winner"><div class="o-gp-label">' + label(d, 'Giveaway winner') + '</div>' + nm('o-gp-name', d.username, 18) + '</div>'
      + '<div class="o-gpg-podium"><div class="o-gpg-step p2">2</div><div class="o-gpg-step p1">1</div><div class="o-gpg-step p3">3</div></div>'
      + '<div class="o-gpg-base"></div>'
      + '<div class="o-gpg-spray l">' + drops('l') + '</div><div class="o-gpg-spray r">' + drops('r') + '</div>'
      + (d.prize ? '<div class="o-gpg-prize">Won <b>' + esc(d.prize) + '</b></div>' : '')
      + '</div>';
  },
});

/* ── Cockpit ── */
function ledColour(i) { return i < 5 ? 'var(--ck-g)' : i < 10 ? 'var(--ck-y)' : 'var(--ck-r)'; }
add({
  id: 'follow-cockpit', alert: 'follow', fam: 'ck', isNew: true, title: 'Shift up',
  desc: 'The shift lights build, flash blue, the gear changes from N to 1 and the name scans onto the display.',
  sound: 'upshift', fx: 'speed', anim: CK_IN, exit: CK_EXIT, len: 1.45,
  render: function (d) {
    var leds = '';
    for (var i = 0; i < 15; i++) leds += '<i class="o-ck-led' + (i < 3 ? ' idle lit' : '') + '" style="--li:' + i + ';--c:' + ledColour(i) + '"></i>';
    return '<div class="obj o-ck o-ckf"><div class="o-ck-dash"><div class="o-ck-glass"><div class="o-ck-leds">' + leds + '</div>'
      + '<div class="o-ckf-row"><div class="o-ckf-gear"><small>Gear</small><span class="n">N</span><span class="g">1</span></div>'
      + '<div class="o-ckf-txt"><div class="o-ck-lbl">' + label(d, 'New follower') + '</div>' + nm('o-ck-name', d.username, 19) + '</div></div>'
      + '</div></div></div>';
  },
});
add({
  id: 'subscriber-cockpit', alert: 'subscription', fam: 'ck', isNew: true, title: 'Personal best', amount: 'Months as laps',
  desc: 'The delta swings from red to green and PERSONAL BEST flashes. The lap counter is the months; the engine map is the tier.',
  sound: 'pb', fx: 'none', anim: CK_IN, exit: CK_EXIT, len: 1.6,
  render: function (d) {
    var months = Math.max(1, intOf(d.months)), h = hash(d.username);
    var neg = (0.1 + (h % 700) / 1000).toFixed(3), pos = (0.3 + ((h >>> 8) % 600) / 1000).toFixed(3);
    var gw = Math.round(14 + (Number(neg) / 0.8) * 30);
    var heading = months > 1 ? 'Resubscribed · ' + months + ' months' : 'New subscriber';
    return '<div class="obj o-ck o-cks"><div class="o-ck-dash"><div class="o-ck-glass">'
      + '<div class="o-cks-top"><div class="o-cks-box"><span class="o-ck-lbl">Lap</span><b>' + odo(String(months).padStart(2, '0'), 0.3, 0.7) + '</b></div>'
      + '<div class="o-cks-delta"><div class="o-cks-dhead"><span class="o-ck-lbl">Delta</span><span class="o-cks-time"><span class="pos">+' + pos + '</span><span class="neg">-' + neg + '</span></span></div>'
      + '<div class="o-cks-bar"><i class="o-cks-red"></i><i class="o-cks-green" style="--gw:' + gw + '%"></i></div></div>'
      + '<div class="o-cks-box"><span class="o-ck-lbl">Map</span><b>T' + esc(d.tier || '1') + '</b></div></div>'
      + '<div class="o-cks-pb">Personal best</div>'
      + '<div class="o-cks-who"><div class="o-ck-lbl">' + label(d, heading) + '</div>' + nm('o-ck-name', d.username, 22) + '</div>'
      + '</div></div></div>';
  },
});
add({
  id: 'bits-cockpit', alert: 'bits', fam: 'ck', isNew: true, title: 'Redline', amount: 'Grows with the amount',
  desc: 'The rev needle sweeps as far as the bits take it. 1,000 or more hits the red line and bounces off the limiter.',
  sound: 'limiter', fx: 'sparks', anim: CK_IN, exit: CK_EXIT, len: 1.5,
  render: function (d) {
    var n = intOf(d.amount != null ? d.amount : d.bits);
    var raw = 2 + 2.2 * Math.log10(n + 1), rpm = Math.min(10, raw), lim = raw >= 10;
    var ang = (-120 + rpm * 24).toFixed(1), off = (100 - rpm * 10).toFixed(1);
    return '<div class="obj o-ck o-ckb' + (lim ? ' limiter' : '') + '" style="--ang:' + ang + 'deg;--off:' + off + '"><div class="o-ck-dash"><div class="o-ck-glass o-ckb-glass">'
      + '<div class="o-ckb-gauge">' + GAUGE + '<div class="o-ckb-needle"></div><div class="o-ckb-hub"></div><div class="o-ckb-x">×1000 rpm</div></div>'
      + '<div class="o-ckb-info"><div class="o-ck-lbl" style="--k:0">' + label(d, 'Bits') + ' · <b>' + fmt(Math.round(rpm * 20) * 50) + ' rpm</b></div>'
      + '<div class="o-ckb-amt" style="--k:1">' + odo(fmt(n), 0.32, 0.8) + '<small>bits</small></div>'
      + nm('o-ck-name', d.username, 14, '--k:2;') + '</div>'
      + '<div class="o-ckb-lim">Limiter</div></div></div></div>';
  },
});
add({
  id: 'donation-cockpit', alert: 'donation', fam: 'ck', isNew: true, title: 'Pit stop', amount: 'Grows with the amount',
  desc: 'The car stops in the box, four tyres change and the fuel fills with the amount. A bigger tip gets a faster stop. Then GO GO GO.',
  sound: 'wheelgun', fx: 'smoke', anim: CK_IN, exit: CK_EXIT, len: 1.8,
  render: function (d) {
    var amt = Number(d.amount) || 0, lg = Math.log10(Math.max(1, amt));
    var stop = Math.max(1.8, Math.min(4.0, 4.2 - lg * 1.1)).toFixed(1);
    var fuel = Math.max(2, Math.min(10, Math.round(2 + lg * 3))), cells = '', tyres = '';
    for (var i = 0; i < 10; i++) cells += '<i class="' + (i < fuel ? 'lit' : '') + '" style="--fi:' + i + ';--c:var(--cka)"></i>';
    ['fl', 'fr', 'rl', 'rr'].forEach(function (k, j) { tyres += '<i class="o-ckd-tyre ' + k + '" style="--td:' + (0.42 + j * 0.08).toFixed(2) + 's"></i>'; });
    return '<div class="obj o-ck o-ckd"><div class="o-ck-dash"><div class="o-ck-glass">'
      + '<div class="o-ckd-top"><span class="o-ck-lbl">' + label(d, 'Pit stop') + '</span><span class="o-ckd-fuel"><span class="o-ck-lbl">Fuel</span><span class="o-ckd-cells">' + cells + '</span></span>'
      + '<span class="o-ckd-timer">' + odo(stop, 0.36, 0.62) + '<small>s</small></span></div>'
      + '<div class="o-ckd-main"><div class="o-ckd-car"><i class="o-ckd-rw"></i><i class="o-ckd-body"></i><i class="o-ckd-fw"></i>' + tyres + '</div>'
      + '<div class="o-ckd-info"><div class="o-ckd-amt">+' + esc(money(d.amount, d.currency)) + '</div><div class="o-ck-lbl">From</div>' + nm('o-ck-name', d.username, 16) + '</div>'
      + '<div class="o-ckd-go">GO GO GO</div></div>'
      + (d.message ? '<div class="o-ckd-msg">“' + esc(d.message) + '”</div>' : '')
      + '</div></div></div>';
  },
});
add({
  id: 'raid-cockpit', alert: 'raid', fam: 'ck', isNew: true, title: 'Spotter', amount: 'Grows with the viewers',
  desc: 'The spotter calls cars left and right while the radar sweeps and fills with one blip per raider.',
  sound: 'spotter', fx: 'none', anim: CK_IN, exit: CK_EXIT, len: 1.6,
  render: function (d) {
    var v = intOf(d.viewers), n = Math.min(v, 22), r = rng(hash(d.username + v)), blips = '';
    for (var i = 0; i < n; i++) {
      var th = r() * 360, rad = 16 + r() * 34;
      var x = rad * Math.sin(th * Math.PI / 180), y = -rad * Math.cos(th * Math.PI / 180);
      blips += '<i class="o-ckr-blip" style="--x:' + x.toFixed(1) + ';--y:' + y.toFixed(1) + ';--r:' + (th + (r() * 30 - 15)).toFixed(0) + 'deg;--bd:' + (0.3 + th / 360 * 1.2).toFixed(2) + 's"></i>';
    }
    return '<div class="obj o-ck o-ckr"><div class="o-ck-dash"><div class="o-ck-glass o-ckr-glass"><i class="o-ckr-side l"></i><i class="o-ckr-side r"></i>'
      + '<div class="o-ckr-radar"><i class="o-ckr-ring r1"></i><i class="o-ckr-ring r2"></i><i class="o-ckr-cross"></i><i class="o-ckr-sweep"></i>' + blips + '<i class="o-ckr-me"></i></div>'
      + '<div class="o-ckr-info"><div class="o-ck-lbl" style="--k:0">' + label(d, 'Spotter · raid') + '</div>' + nm('o-ck-name', d.username, 14, '--k:1;')
      + '<div class="o-ckr-count" style="--k:2">' + odo(fmt(v), 0.5, 0.8) + '<small>' + (v === 1 ? 'car inbound' : 'cars inbound') + '</small></div></div>'
      + '</div></div></div>';
  },
});
add({
  id: 'giveaway-cockpit', alert: 'giveaway', fam: 'ck', isNew: true, title: 'Chequered flag',
  desc: 'LAST LAP, then FINISH: P1 lights up in gold and a rainbow runs across the shift lights.',
  sound: 'finish', fx: 'checker', anim: CK_IN, exit: CK_EXIT, len: 2.0,
  render: function (d) {
    var leds = '';
    for (var i = 0; i < 15; i++) leds += '<i class="o-ck-led lit" style="--li:' + i + ';--c:' + (i % 2 ? '#FFD12B' : 'var(--cka)') + '"></i>';
    return '<div class="obj o-ck o-ckg"><div class="o-ck-dash"><div class="o-ck-glass"><div class="o-ckg-checks"></div><div class="o-ck-leds">' + leds + '</div>'
      + '<div class="o-ckg-row"><div class="o-ckg-p1"><small>Pos</small><b>P1</b></div>'
      + '<div class="o-ckg-txt"><div class="o-ckg-flag o-ck-lbl"><span class="last">Last lap</span><span class="fin">' + label(d, 'Finish · giveaway winner') + '</span></div>'
      + nm('o-ck-name', d.username, 17)
      + (d.prize ? '<div class="o-ckg-prize"><span class="o-ck-lbl">Prize</span>' + esc(d.prize) + '</div>' : '')
      + '</div></div></div></div></div>';
  },
});

/* ── Arcade ── */
var AR_PAL = ['var(--ara)', 'var(--ar-c)', 'var(--ar-y)', '#FFFFFF', 'var(--ar-o)', '#8CFF6B'];
add({
  id: 'follow-arcade', alert: 'follow', fam: 'ar', isNew: true, title: 'Checkpoint!',
  desc: 'CHECKPOINT! zooms in over speed lines, and the name is typed in with a blinking cursor.',
  sound: 'checkpoint', fx: 'speed', anim: AR_IN, exit: AR_EXIT,
  len: function (d) { return 0.7 + Array.from(d.username || '').length * 0.045; },
  render: function (d) {
    var t = typed(d.username, 0.62, 0.045, 40), lines = '', widths = [120, 180, 90, 150, 110], tops = [20, 36, 54, 70, 86];
    for (var i = 0; i < 5; i++) lines += '<i style="top:' + tops[i] + '%;width:' + widths[i] + 'px;--ld:' + (0.05 + i * 0.05).toFixed(2) + 's"></i>';
    return '<div class="obj o-ar o-arf"><div class="o-arf-title o-ar-chrome">CHECKPOINT!</div>'
      + '<div class="o-ar-plate o-ar-scan o-arf-plate"><div class="o-arf-lines">' + lines + '</div>'
      + '<div class="o-ar-px o-arf-lbl">' + label(d, 'New racer joined') + '</div>'
      + '<div class="o-ar-name o-typed" style="' + fitStyle(d.username, 21) + t.style + '">' + t.html + '<span class="o-ar-cur"></span></div>'
      + '</div></div>';
  },
});
add({
  id: 'subscriber-arcade', alert: 'subscription', fam: 'ar', isNew: true, title: 'Stage clear', amount: 'Months as stages',
  desc: 'A sunset road scene opens like an attract screen. The months are the stage number; the tier is the class.',
  sound: 'oneup', fx: 'none', anim: hold('.3s'), exit: AR_EXIT,
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
add({
  id: 'bits-arcade', alert: 'bits', fam: 'ar', isNew: true, title: 'Bonus!', amount: 'Grows with the amount',
  desc: 'The amount pops in chrome, the credits counter rolls up and coins burst out. 1,000 or more says HIGH SCORE!',
  sound: 'coins', fx: 'confetti', anim: AR_IN, exit: AR_EXIT, len: 1.4,
  render: function (d) {
    var n = intOf(d.amount != null ? d.amount : d.bits), lvl = n >= 1000 ? 'big' : n >= 100 ? 'medium' : 'small';
    var count = { small: 4, medium: 7, big: 12 }[lvl], r = rng(hash(d.username + n)), coins = '';
    for (var i = 0; i < count; i++) coins += '<i class="o-arb-coin" style="--cx:' + (-70 + r() * 260).toFixed(0) + 'px;--cy:' + (-40 - r() * 50).toFixed(0) + 'px;--cd:' + (0.3 + i * 0.06).toFixed(2) + 's"></i>';
    return '<div class="obj o-ar o-arb lvl-' + lvl + '"><div class="o-arb-plus o-ar-chrome">+' + fmt(n) + '</div>'
      + '<div class="o-ar-plate o-ar-scan o-arb-plate"><div class="o-arb-cred"><span class="o-ar-px">Credits</span><b>' + odo(String(n).padStart(6, '0'), 0.3, 0.75) + '</b></div>'
      + '<div class="o-arb-who"><div class="o-ar-px o-arb-bonus">' + label(d, lvl === 'big' ? 'High score!' : 'Bonus!') + '</div>' + nm('o-ar-name', d.username, 17) + '</div></div>'
      + '<div class="o-arb-coins">' + coins + '</div></div>';
  },
});
add({
  id: 'donation-arcade', alert: 'donation', fam: 'ar', isNew: true, title: 'New record!',
  desc: 'The donor slides onto the high-score table in 1st place, NEW RECORD! zooms in and the message is typed like name entry.',
  sound: 'record', fx: 'confetti', anim: AR_IN, exit: AR_EXIT,
  len: function (d) { var n = Array.from(d.message || '').length; return 1.3 + Math.min(1.6, n * 0.03); },
  render: function (d) {
    var amt = Number(d.amount) || 0, n = Array.from(d.message || '').length;
    var t = typed(d.message || '', 1.15, Math.min(0.03, 1.6 / Math.max(1, n)), 120);
    return '<div class="obj o-ar o-ard"><div class="o-ard-title o-ar-chrome">NEW RECORD!</div>'
      + '<div class="o-ar-plate o-ar-scan o-ard-plate"><div class="o-ard-head o-ar-px"><span>Rank</span><span>Name</span><span>Score</span></div>'
      + '<div class="o-ard-rows"><span class="o-ard-rank" style="--r:0">1ST</span><span class="o-ard-rank" style="--r:1">2ND</span><span class="o-ard-rank" style="--r:2">3RD</span>'
      + '<div class="o-ard-row ghost" style="--r:1"><span>ACE</span><span>' + esc(money((amt * 0.8).toFixed(2), d.currency)) + '</span></div>'
      + '<div class="o-ard-row ghost" style="--r:2"><span>JET</span><span>' + esc(money((amt * 0.45).toFixed(2), d.currency)) + '</span></div>'
      + '<div class="o-ard-row me" style="--r:0">' + nm('o-ar-name', d.username, 16) + '<span>' + esc(money(d.amount, d.currency)) + '</span></div></div>'
      + (t.n ? '<div class="o-ar-px o-ard-msg o-typed" style="' + t.style + '">' + t.html + '<span class="o-ar-cur"></span></div>' : '')
      + '</div></div>';
  },
});
add({
  id: 'raid-arcade', alert: 'raid', fam: 'ar', isNew: true, title: 'Warning!', amount: 'Grows with the viewers',
  desc: 'The screen shakes, hazard stripes roll, WARNING! flashes and the rival convoy drives in: one car per raider, up to ten.',
  sound: 'siren', fx: 'none', anim: { in: 'arrShake', dur: '.5s', ease: 'linear' }, exit: AR_EXIT,
  len: function (d) { return 1.5 + Math.min(10, intOf(d.viewers)) * 0.08; },
  render: function (d) {
    var v = intOf(d.viewers), n = Math.min(v, 10), cars = '';
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
add({
  id: 'giveaway-arcade', alert: 'giveaway', fam: 'ar', isNew: true, title: 'Winner!',
  desc: 'Chrome WINNER! over a spinning starburst, the name typed as player 1, and pixel confetti.',
  sound: 'winner', fx: 'confetti', anim: hold('.2s'), exit: AR_EXIT,
  len: function (d) { return 1.3 + Array.from(d.username || '').length * 0.045; },
  render: function (d) {
    var t = typed(d.username, 0.66, 0.045, 40), r = rng(hash(d.username)), conf = '';
    for (var i = 0; i < 18; i++) conf += '<i style="--x:' + (r() * 100).toFixed(0) + '%;--cc:' + AR_PAL[i % AR_PAL.length] + ';--rot:' + (180 + r() * 540).toFixed(0) + 'deg;--du:' + (1.1 + r() * 0.8).toFixed(2) + 's;--dd:' + (0.5 + r() * 0.6).toFixed(2) + 's"></i>';
    return '<div class="obj o-ar o-arg"><div class="o-arg-burst"></div><div class="o-arg-title o-ar-chrome">WINNER!</div>'
      + '<div class="o-ar-plate o-ar-scan o-arg-plate"><div class="o-ar-px o-arg-lbl">' + label(d, 'Giveaway · player 1') + '</div>'
      + '<div class="o-ar-name o-typed" style="' + fitStyle(d.username, 22) + t.style + '">' + t.html + '</div>'
      + (d.prize ? '<div class="o-ar-px o-arg-prize">Prize: ' + esc(d.prize) + '</div>' : '') + '</div>'
      + '<div class="o-arg-conf">' + conf + '</div></div>';
  },
});

// Every family the page shows. A family file adds its own entry (FAMS.xx = {...}) and its six looks.
// badge: today | improved | new; sw: the swatch drawn next to its name.
var FAMS = {
  samurai: { name: 'Samurai', order: 0, badge: 'today', sw: 'linear-gradient(135deg,#D81E26 0 45%,#070B10 45%)', desc: 'One decisive stroke, then stillness. The five looks you have today, plus a new giveaway: the omikuji.' },
  gp: { name: 'Grand Prix', order: 2, badge: 'new', sw: 'linear-gradient(135deg,#E8002D 0 50%,#15161E 50%)', desc: 'TV broadcast graphics: start lights, the timing tower, sector colours, team radio, race control and the podium.' },
  ck: { name: 'Cockpit', order: 3, badge: 'new', sw: 'radial-gradient(circle at 30% 30%,#29E0FF,#080A0E 72%)', desc: 'The display on your wheel: shift lights, gear, delta, the rev counter, the pit stop and the spotter.' },
  ar: { name: 'Arcade', order: 4, badge: 'new', sw: 'linear-gradient(180deg,#FFE86B,#FF2E88 55%,#7A2CFF)', desc: 'A 90s arcade racer: chrome letters, CHECKPOINT!, NEW RECORD!, coins and a sunset road.' },
};
var ALERTS = [
  { key: 'follow', name: 'Follow', h: 168, blurb: 'Follows come most often, so every look here finishes its entrance in under two seconds.' },
  { key: 'subscription', name: 'Subscriber', h: 216, blurb: 'Months and tier are part of every new look, not just a line of small text.' },
  { key: 'bits', name: 'Bits', h: 196, blurb: 'Most looks grow with the amount: try Small, Medium and Big.' },
  { key: 'donation', name: 'Donation', h: 252, blurb: 'Every look shows the donor’s message. Big shows a long one.' },
  { key: 'raid', name: 'Raid', h: 240, blurb: 'The raid size drives the picture: a headlight, a shield or a bat for each raider, up to a limit. Try Small, Medium and Big.' },
  { key: 'giveaway', name: 'Giveaway', h: 256, blurb: 'Today it has only the racing card, see-through without a saved design. Every family brings a giveaway of its own.' },
];
var SOUND_NAMES = {
  blade: 'Blade draw', taiko: 'Taiko drum', taiko3: 'Three taiko hits', koto: 'Koto', bell: 'Temple bell', rev: 'Engine rev',
  lights: 'Start lights', overtake: 'Overtake', sectors: 'Sector beeps', radio: 'Radio click', raceControl: 'Race control alarm', podium: 'Podium fanfare',
  upshift: 'Upshift', pb: 'Personal best chime', limiter: 'Rev limiter', wheelgun: 'Wheel guns', spotter: 'Spotter beeps', finish: 'Finish line',
  checkpoint: 'Checkpoint jingle', oneup: '1UP', coins: 'Coins', record: 'High score', siren: 'Warning siren', winner: 'Winner fanfare',
  turbo: 'Turbo blow-off', pack: 'Engines and screech',
};
var FX_NAMES = { none: 'None', smoke: 'Tyre smoke', checker: 'Chequered confetti', speed: 'Speed lines', sparks: 'Titanium sparks', champagne: 'Champagne', confetti: 'Confetti' };
function byId(id) { for (var i = 0; i < P.length; i++) if (P[i].id === id) return P[i]; return null; }
function order(p) { return FAMS[p.fam].order + (p.fam === 'samurai' && p.isNew ? 0.5 : 0) - (p.before ? 0.2 : 0); }
function looksFor(alert) { return P.filter(function (p) { return p.alert === alert; }).sort(function (a, b) { return order(a) - order(b); }); }
function pickable(alert) { return looksFor(alert).filter(function (p) { return !p.before; }); }
function famPreset(alert, fam) { for (var i = 0; i < P.length; i++) if (P[i].alert === alert && P[i].fam === fam && !P[i].before) return P[i]; return null; }
function lenOf(p, d) { return typeof p.len === 'function' ? p.len(d) : p.len; }

/* ── Playing a look in a slot, as overlay.js does (.playing, then .exiting) ── */
function setVars(slot, p) {
  var s = slot.style;
  s.setProperty('--in', p.anim.in); s.setProperty('--dur', p.anim.dur); s.setProperty('--ease', p.anim.ease);
  s.setProperty('--out', p.exit.out); s.setProperty('--outdur', p.exit.dur); s.setProperty('--outease', p.exit.ease);
}
function draw(slot, p, data) { var d = data || sample(p.alert); slot.innerHTML = p.render(d); setVars(slot, p); return d; }
function start(slot) { slot.classList.remove('playing', 'exiting'); void slot.offsetWidth; slot.classList.add('playing'); }
function finish(slot) { slot.classList.remove('playing'); slot.classList.add('exiting'); }
function rest(slot) { slot.classList.remove('playing', 'exiting'); }

/* ── Sounds, made in the browser like today's overlay sounds ───────────── */
var AC = null, NOISE = null;
function ac() {
  if (!AC) { var C = window.AudioContext || window.webkitAudioContext; if (!C) return null; AC = new C(); }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function env(g, t0, v, a, d) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d); }
function tone(o) {
  var c = ac(); if (!c) return;
  var t0 = c.currentTime + (o.t || 0), d = o.d || 0.2, osc = c.createOscillator(), g = c.createGain();
  osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(o.f, t0);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t0 + d);
  env(g, t0, o.v || 0.1, o.a || 0.005, d); osc.connect(g); g.connect(c.destination); osc.start(t0); osc.stop(t0 + d + 0.05);
}
function noise(o) {
  var c = ac(); if (!c) return;
  if (!NOISE) { NOISE = c.createBuffer(1, c.sampleRate * 1.5, c.sampleRate); var ch = NOISE.getChannelData(0); for (var i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1; }
  var t0 = c.currentTime + (o.t || 0), d = o.d || 0.2, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = NOISE; f.type = o.ft || 'bandpass'; f.frequency.setValueAtTime(o.f || 1000, t0);
  if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t0 + d);
  f.Q.value = o.q || 1; env(g, t0, o.v || 0.1, o.a || 0.005, d);
  src.connect(f); f.connect(g); g.connect(c.destination); src.start(t0); src.stop(t0 + d + 0.05);
}
function engine(o) {
  var c = ac(); if (!c) return;
  var t0 = c.currentTime + (o.t || 0), d = o.d || 0.6, ws = c.createWaveShaper(), curve = new Float32Array(256), g = c.createGain();
  for (var i = 0; i < 256; i++) { var x = i * 2 / 256 - 1; curve[i] = (Math.PI + 3.4) * x / (Math.PI + 3.4 * Math.abs(x)); }
  ws.curve = curve;
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(o.v || 0.1, t0 + 0.02);
  g.gain.setValueAtTime(o.v || 0.1, t0 + d * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  [1, 0.5].forEach(function (m) {
    var osc = c.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(o.f * m, t0); osc.frequency.exponentialRampToValueAtTime(o.f2 * m, t0 + d * 0.75);
    osc.connect(ws); osc.start(t0); osc.stop(t0 + d);
  });
  ws.connect(g); g.connect(c.destination);
}
var SOUNDS = {
  blade: function () { noise({ ft: 'highpass', f: 2400, f2: 9000, d: 0.32, v: 0.16, a: 0.01 }); tone({ f: 2900, f2: 3600, d: 0.7, v: 0.035, t: 0.03 }); tone({ f: 5800, d: 0.55, v: 0.015, t: 0.03 }); },
  taiko: function () { tone({ f: 95, f2: 48, d: 0.5, v: 0.55, a: 0.003 }); noise({ ft: 'lowpass', f: 500, d: 0.09, v: 0.25 }); },
  taiko3: function () { [0, 0.2, 0.55].forEach(function (t, i) { tone({ f: 95 - i * 8, f2: 46, d: 0.45, v: 0.5, a: 0.003, t: t }); noise({ ft: 'lowpass', f: 480, d: 0.08, v: 0.22, t: t }); }); },
  koto: function () { [392, 523, 587, 784].forEach(function (f, i) { tone({ f: f, d: 0.9, v: 0.09, type: 'triangle', a: 0.002, t: 0.55 + i * 0.1 }); }); },
  bell: function () { [[220, 0.28, 3.2], [440, 0.14, 2.6], [661, 0.07, 2], [1100, 0.04, 1.4]].forEach(function (p) { tone({ f: p[0], v: p[1], d: p[2], a: 0.004, t: 0.8 }); }); },
  rev: function () { engine({ f: 60, f2: 220, d: 0.7, v: 0.1 }); },
  lights: function () { [0, 0.16, 0.32, 0.48, 0.64].forEach(function (t) { tone({ f: 880, d: 0.1, v: 0.05, type: 'square', t: 0.26 + t }); }); engine({ f: 70, f2: 330, d: 0.75, v: 0.11, t: 1.22 }); },
  overtake: function () { noise({ ft: 'bandpass', f: 500, f2: 2600, q: 0.7, d: 0.55, v: 0.22, a: 0.2, t: 0.4 }); tone({ f: 660, d: 0.12, v: 0.07, type: 'triangle', t: 1.34 }); tone({ f: 990, d: 0.3, v: 0.07, type: 'triangle', t: 1.46 }); },
  sectors: function () { [[988, 0.32], [1175, 0.58], [1568, 0.84]].forEach(function (p) { tone({ f: p[0], d: 0.09, v: 0.06, type: 'square', t: p[1] }); }); },
  radio: function () { noise({ ft: 'bandpass', f: 1800, q: 2.5, d: 0.16, v: 0.3 }); tone({ f: 1250, d: 0.06, v: 0.05, t: 0.18 }); noise({ ft: 'bandpass', f: 2400, q: 3, d: 0.1, v: 0.12, t: 2.2 }); },
  raceControl: function () { [0, 0.32, 0.64].forEach(function (t) { tone({ f: 740, d: 0.14, v: 0.06, type: 'square', t: t + 0.15 }); tone({ f: 554, d: 0.14, v: 0.06, type: 'square', t: t + 0.31 }); }); },
  podium: function () { [523, 659, 784, 1046].forEach(function (f, i) { tone({ f: f, d: 0.18, v: 0.1, type: 'triangle', t: 0.7 + i * 0.11 }); }); tone({ f: 1046, d: 0.8, v: 0.1, type: 'triangle', t: 1.16 }); noise({ ft: 'highpass', f: 3000, d: 0.6, v: 0.05, t: 1.0, a: 0.05 }); },
  upshift: function () { engine({ f: 70, f2: 420, d: 0.58, v: 0.1, t: 0.3 }); tone({ f: 2200, d: 0.04, v: 0.05, type: 'square', t: 0.88 }); engine({ f: 230, f2: 300, d: 0.45, v: 0.09, t: 0.92 }); },
  pb: function () { tone({ f: 784, d: 0.12, v: 0.1, t: 1.0 }); tone({ f: 1175, d: 0.5, v: 0.1, t: 1.1 }); },
  limiter: function () { engine({ f: 80, f2: 520, d: 0.82, v: 0.1, t: 0.3 }); for (var i = 0; i < 7; i++) engine({ f: 500, f2: 520, d: 0.06, v: 0.09, t: 1.12 + i * 0.08 }); },
  wheelgun: function () { [0, 0.08, 0.16, 0.24].forEach(function (t, i) { noise({ ft: 'bandpass', f: 2600 + i * 200, q: 5, d: 0.07, v: 0.3, t: 0.42 + t }); }); engine({ f: 80, f2: 260, d: 0.55, v: 0.1, t: 0.98 }); },
  spotter: function () { [0, 0.25, 0.5].forEach(function (t) { tone({ f: 1560, d: 0.07, v: 0.06, t: 0.35 + t }); }); },
  finish: function () { engine({ f: 90, f2: 380, d: 0.7, v: 0.09, t: 0.2 }); [784, 988, 1175, 1568].forEach(function (f, i) { tone({ f: f, d: 0.14, v: 0.07, type: 'square', t: 0.95 + i * 0.07 }); }); },
  checkpoint: function () { [988, 1319, 1568, 1976].forEach(function (f, i) { tone({ f: f, d: 0.09, v: 0.05, type: 'square', t: 0.1 + i * 0.07 }); }); },
  oneup: function () { [659, 784, 1319, 1047, 1175, 1568].forEach(function (f, i) { tone({ f: f, d: 0.1, v: 0.05, type: 'square', t: 0.5 + i * 0.085 }); }); },
  coins: function () { for (var i = 0; i < 4; i++) { tone({ f: 988, d: 0.07, v: 0.05, type: 'square', t: 0.2 + i * 0.1 }); tone({ f: 1319, d: 0.18, v: 0.05, type: 'square', t: 0.27 + i * 0.1 }); } },
  record: function () { [523, 659, 784, 1046, 784, 1046].forEach(function (f, i) { tone({ f: f, d: 0.11, v: 0.05, type: 'square', t: 0.74 + i * 0.09 }); }); },
  siren: function () { for (var i = 0; i < 4; i++) tone({ f: 520, f2: 880, d: 0.2, v: 0.04, type: 'sawtooth', t: 0.08 + i * 0.22 }); },
  winner: function () { [784, 784, 784, 1046].forEach(function (f, i) { tone({ f: f, d: i === 3 ? 0.5 : 0.1, v: 0.06, type: 'square', t: 0.2 + i * 0.13 }); }); },
  turbo: function () { engine({ f: 90, f2: 300, d: 0.5, v: 0.1, t: 0.2 }); tone({ f: 2000, f2: 6000, d: 0.3, v: 0.03, t: 0.45 }); noise({ ft: 'bandpass', f: 4000, f2: 800, q: 2, d: 0.25, v: 0.25, t: 0.78 }); },
  pack: function () { [0, 0.12, 0.24].forEach(function (t, i) { engine({ f: 55 + i * 8, f2: 170 + i * 20, d: 0.6, v: 0.09, t: 0.2 + t }); }); noise({ ft: 'highpass', f: 3000, f2: 6000, q: 6, d: 0.3, v: 0.12, t: 0.9 }); },
};
function playSound(key) { try { if (SOUNDS[key]) SOUNDS[key](); } catch (e) { /* no audio here */ } }

