/* ═══ COSMOS — space: a liftoff, moons in orbit, a meteor shower, a transmission, a fleet, a supernova ═══
   Runs inside the page's IIFE after 90-core.js: add(), FAMS, SOUNDS and the helpers are in scope. */
FAMS.cs = {
  name: 'Cosmos', order: 8, badge: 'new',
  sw: 'radial-gradient(circle at 34% 34%,#FF7A45 0 16%,#6C3CF0 17% 46%,#070A1A 47%)',
  desc: 'Space: a countdown and liftoff, moons in orbit, a meteor shower, an incoming transmission, a fleet warping in and a supernova.',
};

SOUND_NAMES.csFollow = 'Countdown and liftoff';
SOUNDS.csFollow = function () {
  [0.2, 0.38, 0.56].forEach(function (t) { tone({ f: 880, d: 0.09, v: 0.05, type: 'sine', t: t }); });
  tone({ f: 1320, d: 0.16, v: 0.05, type: 'sine', t: 0.74 });
  noise({ ft: 'lowpass', f: 180, f2: 900, q: 0.8, d: 1.0, v: 0.26, a: 0.08, t: 0.7 });
  tone({ f: 70, f2: 42, d: 0.9, v: 0.1, type: 'sine', t: 0.72 });
};
SOUND_NAMES.csSub = 'Orbit chime';
SOUNDS.csSub = function () {
  [523, 659, 784, 1046].forEach(function (f, i) { tone({ f: f, d: 0.9, v: 0.06, type: 'sine', a: 0.01, t: 0.45 + i * 0.12 }); });
  tone({ f: 2093, d: 1.2, v: 0.02, type: 'sine', a: 0.05, t: 0.9 });
};
SOUND_NAMES.csBits = 'Meteor impacts';
SOUNDS.csBits = function () {
  [0.3, 0.44, 0.58, 0.72, 0.86].forEach(function (t, i) {
    noise({ ft: 'bandpass', f: 3200 - i * 200, f2: 500, q: 1.2, d: 0.2, v: 0.16, t: t });
    tone({ f: 95, f2: 50, d: 0.16, v: 0.08, type: 'sine', t: t + 0.18 });
  });
};
SOUND_NAMES.csDon = 'Radar pings';
SOUNDS.csDon = function () {
  noise({ ft: 'bandpass', f: 1800, q: 2.5, d: 0.18, v: 0.14, t: 0.05 });
  [0.2, 0.5, 0.8].forEach(function (t) { tone({ f: 1320, d: 0.45, v: 0.06, type: 'sine', a: 0.004, t: t }); });
};
SOUND_NAMES.csRaid = 'Warp jumps';
SOUNDS.csRaid = function () {
  for (var i = 0; i < 5; i++) tone({ f: 180, f2: 1400, d: 0.22, v: 0.045, type: 'triangle', t: 0.45 + i * 0.09 });
  noise({ ft: 'bandpass', f: 600, f2: 4000, q: 0.8, d: 0.6, v: 0.12, a: 0.1, t: 0.4 });
};
SOUND_NAMES.csGive = 'Supernova';
SOUNDS.csGive = function () {
  tone({ f: 220, f2: 1400, d: 0.65, v: 0.05, type: 'sine', a: 0.2, t: 0.08 });
  noise({ ft: 'lowpass', f: 2400, f2: 160, q: 0.7, d: 1.3, v: 0.28, a: 0.01, t: 0.72 });
  tone({ f: 82, f2: 40, d: 0.9, v: 0.11, type: 'sine', t: 0.72 });
  [1568, 2093, 2637].forEach(function (f, i) { tone({ f: f, d: 0.8, v: 0.025, type: 'sine', a: 0.02, t: 1.0 + i * 0.1 }); });
};

var CS_IN = { in: 'csPanelIn', dur: '.35s', ease: 'cubic-bezier(.2,.8,.2,1)' };
var CS_EXIT = { out: 'csExit', dur: '.45s', ease: 'cubic-bezier(.5,0,.8,.4)' };

var CS_ROCKET = '<svg viewBox="0 0 22 44" aria-hidden="true">'
  + '<path class="fin" d="M5 25L1 33V37L5 34Z"/><path class="fin" d="M17 25L21 33V37L17 34Z"/>'
  + '<path class="body" d="M11 1C15.6 6 17 13.5 17 22V32H5V22C5 13.5 6.4 6 11 1Z"/>'
  + '<path class="nose" d="M11 1C13.3 3.6 14.7 6.6 15.4 10H6.6C7.3 6.6 8.7 3.6 11 1Z"/>'
  + '<circle cx="11" cy="17" r="3.2" fill="#4FD1FF" stroke="#0D1233" stroke-width="1.3"/>'
  + '<rect x="7" y="32" width="8" height="3" rx="1" fill="#8A93B8"/></svg>';
var CS_DISH = '<svg viewBox="0 0 34 34" aria-hidden="true">'
  + '<path d="M5 30H17" stroke="#8A93B8" stroke-width="2" stroke-linecap="round"/><path d="M11 30L15 19" stroke="#8A93B8" stroke-width="2"/>'
  + '<path class="bowl" d="M7 9A16 16 0 0 0 25 27Z"/><path d="M16 18L24 10" stroke="#E6ECFF" stroke-width="1.4"/>'
  + '<circle class="feed" cx="24.6" cy="9.4" r="2.1"/></svg>';
var CS_SHIP = '<svg viewBox="0 0 30 16" aria-hidden="true"><path class="wing" d="M8 1.5L17 7V9L8 14.5L11.5 8Z"/>'
  + '<path class="hull" d="M3 6.2L22 6.6L29.5 8L22 9.4L3 9.8L5.2 8Z"/><rect class="glow" x="0" y="6.8" width="4" height="2.4" rx="1.2"/></svg>';
// The fleet's arrowhead, lead ship first: [left in % of the strip, top in px].
var CS_SLOTS = [[80, 36], [72, 22], [72, 50], [64, 10], [64, 62], [56, 24], [56, 48], [48, 36], [40, 14], [40, 58]];
function csMeteorCount(n) { return Math.max(4, Math.min(15, Math.round(2 + 3 * Math.log10(n + 1)))); }

add({
  id: 'follow-cosmos', alert: 'follow', fam: 'cs', isNew: true, title: 'Liftoff',
  desc: 'A countdown flashes 3, 2, 1 and a small rocket launches up the side of the mission panel, leaving a trail; then the new crew member’s name appears.',
  sound: 'csFollow', fx: 'smoke', anim: CS_IN, exit: CS_EXIT, len: 1.75,
  render: function (d) {
    var count = [3, 2, 1].map(function (n, i) { return '<span style="--cd:' + (0.2 + i * 0.18).toFixed(2) + 's">' + n + '</span>'; }).join('');
    return '<div class="obj o-cs o-csf"><div class="o-cs-panel"><i class="o-cs-stars"></i>'
      + '<div class="o-csf-bay"><i class="o-csf-trail"></i><i class="o-csf-pad"></i>'
      + '<i class="o-csf-puff l" style="--px:-14px"></i><i class="o-csf-puff m" style="--pd:.06s"></i><i class="o-csf-puff r" style="--px:14px;--pd:.03s"></i>'
      + '<div class="o-csf-rocket"><i class="o-csf-flame"></i>' + CS_ROCKET + '</div></div>'
      + '<div class="o-csf-txt"><div class="o-cs-label" style="--k:0">' + label(d, 'New crew member') + '</div>'
      + nm('o-cs-name', d.username, 17, '--k:1;')
      + '<div class="o-cs-sub" style="--k:2">Welcome aboard the mission</div></div>'
      + '<div class="o-csf-count" aria-hidden="true">' + count + '</div>'
      + '</div></div>';
  },
});

add({
  id: 'subscriber-cosmos', alert: 'subscription', fam: 'cs', isNew: true, title: 'New orbit', amount: 'Months as orbits',
  desc: 'A ringed planet appears and its moons swing into orbit, one per tier, while the months count up as the orbit number.',
  sound: 'csSub', fx: 'none', anim: CS_IN, exit: CS_EXIT, len: 1.8,
  render: function (d) {
    var months = Math.max(1, intOf(d.months)), tier = Math.min(3, Math.max(1, intOf(d.tier) || 1));
    var colours = ['#4FD1FF', '#FFFFFF', 'var(--csa)'], angles = [35, 155, 275], moons = '';
    for (var i = 0; i < tier; i++) {
      moons += '<i class="o-csu-arm" style="--ma:' + angles[i] + 'deg;--md:' + (0.45 + i * 0.12).toFixed(2) + 's"><i class="o-csu-moon" style="--mc:' + colours[i] + '"></i></i>';
    }
    return '<div class="obj o-cs o-csu"><div class="o-cs-panel"><i class="o-cs-stars"></i>'
      + '<div class="o-csu-sys"><i class="o-csu-orbit"></i><i class="o-csu-ring back"></i><i class="o-csu-planet"></i><i class="o-csu-ring front"></i>' + moons + '</div>'
      + '<div class="o-csu-txt"><div class="o-cs-label" style="--k:0">' + label(d, months > 1 ? 'Still in orbit' : 'New orbit') + '</div>'
      + nm('o-cs-name', d.username, 13, '--k:1;')
      + '<div class="o-csu-count" style="--k:2">Orbit ' + odo(String(months), 0.85, 0.7) + '<span>· Tier ' + tier + '</span></div>'
      + (d.message ? '<div class="o-cs-sub o-csu-msg" style="--k:3">' + esc(d.message) + '</div>' : '')
      + '</div></div></div>';
  },
});

add({
  id: 'bits-cosmos', alert: 'bits', fam: 'cs', isNew: true, title: 'Meteor shower', amount: 'Grows with the amount',
  desc: 'Meteors streak across the panel and light up where they land, more of them for more bits, while the amount counts up as stardust.',
  sound: 'csBits', fx: 'sparks', anim: CS_IN, exit: CS_EXIT,
  len: function (d) { return 0.25 + csMeteorCount(intOf(d.amount != null ? d.amount : d.bits)) * 0.07 + 0.9; },
  render: function (d) {
    var n = intOf(d.amount != null ? d.amount : d.bits), count = csMeteorCount(n), r = rng(hash(d.username + n)), mets = '';
    for (var i = 0; i < count; i++) {
      // Each meteor lands on the curved horizon of the planet at the bottom of the panel.
      var x = 130 + r() * 270, dx = (x - 210) / 252, y = 188 - 100 * Math.sqrt(Math.max(0, 1 - dx * dx)) + 2;
      var st = '--mx:' + x.toFixed(0) + 'px;--my:' + y.toFixed(0) + 'px;--ma:' + (125 + r() * 20).toFixed(0) + 'deg;--md:' + (0.25 + i * 0.07).toFixed(2) + 's';
      mets += '<i class="o-csb-crater" style="' + st + '"></i><i class="o-csb-met" style="' + st + '"></i><i class="o-csb-hit" style="' + st + '"></i>';
    }
    return '<div class="obj o-cs o-csb"><div class="o-cs-panel"><i class="o-cs-stars"></i><i class="o-csb-ground"></i>' + mets
      + '<div class="o-csb-txt"><div class="o-cs-label" style="--k:0">' + label(d, 'Meteor shower') + '</div>'
      + '<div class="o-csb-amt" style="--k:1">' + odo(fmt(n), 0.3, 0.9) + '<small>stardust</small></div>'
      + nm('o-cs-name', d.username, 16, '--k:2;') + '</div></div></div>';
  },
});

add({
  id: 'donation-cosmos', alert: 'donation', fam: 'cs', isNew: true, title: 'Transmission',
  desc: 'A radar dish pings, a signal waveform draws itself and the donor’s message is typed out like a decoded transmission, with the amount on a credits tag.',
  sound: 'csDon', fx: 'none', anim: CS_IN, exit: CS_EXIT,
  len: function (d) { var n = Array.from(d.message || '').length + 2; return d.message ? 0.95 + Math.min(2.2, n * 0.035) : 1.3; },
  render: function (d) {
    var r = rng(hash(d.username + d.amount)), pts = [];
    for (var x = 0; x <= 380; x += 6) {
      var env = Math.sin(x / 380 * Math.PI);
      pts.push(x + ' ' + (13 + (r() * 2 - 1) * 11 * env * (0.4 + r() * 0.6)).toFixed(1));
    }
    var text = d.message ? '“' + d.message + '”' : '', count = Array.from(text).length;
    var per = count ? Math.min(0.035, 2.2 / count) : 0, msg = typed(text, 0.95, per, 160);
    var pings = [0.2, 0.5, 0.8].map(function (t) { return '<i class="o-csd-ping" style="--pd:' + t + 's"></i>'; }).join('');
    return '<div class="obj o-cs o-csd"><div class="o-cs-panel"><i class="o-cs-stars"></i>'
      + '<div class="o-csd-head"><div class="o-csd-dish">' + CS_DISH + pings + '</div>'
      + '<div class="o-csd-headtxt"><div class="o-cs-label" style="--k:0">' + label(d, 'Incoming transmission') + '</div>' + nm('o-cs-name', d.username, 15, '--k:1;') + '</div>'
      + '<div class="o-csd-tag">' + esc(money(d.amount, d.currency)) + '<small>credits</small></div></div>'
      + '<div class="o-csd-wave"><svg viewBox="0 0 380 26" preserveAspectRatio="none" aria-hidden="true"><path d="M' + pts.join(' L') + '"/></svg></div>'
      + (msg.n ? '<div class="o-csd-msg o-typed" style="' + msg.style + '">' + msg.html + '</div>' : '<div class="o-csd-msg o-csd-ok">Signal received. Thank you!</div>')
      + '</div></div>';
  },
});

add({
  id: 'raid-cosmos', alert: 'raid', fam: 'cs', isNew: true, title: 'Fleet arrival', amount: 'Grows with the viewers',
  desc: 'Ships warp in from the left as streaks and snap into formation, one per raider up to ten, while the fleet size counts up.',
  sound: 'csRaid', fx: 'speed', anim: CS_IN, exit: { out: 'csWarpOut', dur: '.45s', ease: 'cubic-bezier(.5,0,.9,.4)' },
  len: function (d) { return 0.95 + Math.min(10, intOf(d.viewers)) * 0.07; },
  render: function (d) {
    var v = intOf(d.viewers), n = Math.min(v, 10), ships = '';
    for (var i = 0; i < n; i++) {
      ships += '<i class="o-csr-ship" style="--sx:' + CS_SLOTS[i][0] + '%;--sy:' + CS_SLOTS[i][1] + 'px;--sd:' + (0.45 + i * 0.07).toFixed(2) + 's"><i class="o-csr-streak"></i>' + CS_SHIP + '</i>';
    }
    return '<div class="obj o-cs o-csr"><div class="o-cs-panel"><i class="o-cs-stars"></i>'
      + '<div class="o-csr-txt"><div class="o-cs-label" style="--k:0">' + label(d, 'Fleet incoming') + '</div>' + nm('o-cs-name', d.username, 20, '--k:1;')
      + '<div class="o-csr-count" style="--k:2">' + odo(fmt(v), 0.4, 0.8) + '<small>' + (v === 1 ? 'ship' : 'ships') + '</small></div></div>'
      + '<div class="o-csr-strip">' + ships + (v > n ? '<span class="o-csr-more">+' + fmt(v - n) + '</span>' : '') + '</div></div></div>';
  },
});

add({
  id: 'giveaway-cosmos', alert: 'giveaway', fam: 'cs', isNew: true, title: 'Supernova',
  desc: 'A star swells and collapses, then explodes in a flash and a shockwave; the winner’s name glows in the light and the prize appears below.',
  sound: 'csGive', fx: 'confetti', anim: CS_IN, exit: CS_EXIT, len: 1.6,
  render: function (d) {
    var r = rng(hash(d.username)), sparks = '';
    for (var i = 0; i < 14; i++) {
      var a = (i / 14) * Math.PI * 2 + r() * 0.3, dist = 70 + r() * 90;
      sparks += '<i class="o-csg-spark" style="--dx:' + (Math.cos(a) * dist).toFixed(0) + 'px;--dy:' + (Math.sin(a) * dist * 0.55).toFixed(0) + 'px;--sd:' + (0.74 + r() * 0.08).toFixed(2) + 's"></i>';
    }
    return '<div class="obj o-cs o-csg"><div class="o-cs-panel"><i class="o-cs-stars"></i><i class="o-csg-halo"></i>'
      + '<i class="o-csg-flash"></i><i class="o-csg-wave"></i>' + sparks + '<i class="o-csg-star"></i>'
      + '<div class="o-csg-mid"><div class="o-cs-label">' + label(d, 'Giveaway winner') + '</div>' + nm('o-cs-name', d.username, 18) + '</div>'
      + (d.prize ? '<div class="o-csg-prow"><div class="o-csg-prize"><span class="o-cs-label">Prize</span><b>' + esc(d.prize) + '</b></div></div>' : '')
      + '</div></div>';
  },
});
