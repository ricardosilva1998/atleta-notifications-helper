/* ═══ Comic — a pop-art comic book ═══
   Panels slam in, sound effects land with a squash, speech bubbles pop. Everything private to this
   family lives inside this function, so its helper names cannot collide with another family's. */
(function () {
  FAMS.cm = {
    name: 'Comic', order: 6, badge: 'new',
    sw: 'radial-gradient(circle at 30% 30%,#FFE135 0 38%,#E8202A 39% 70%,#111 71%)',
    desc: 'A pop-art comic book: panels that slam in, KAPOW! starbursts, speech bubbles, halftone dots and thick black ink.',
  };

  var CM_EXIT = { out: 'cmExit', dur: '.36s', ease: 'cubic-bezier(.5,0,.8,.3)' };
  var CM_STAR = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5l2.5 5.6 6.1.6-4.6 4.1 1.3 6-5.3-3.1-5.3 3.1 1.3-6L1.4 7.7l6.1-.6z"/></svg>';
  var CM_BADGE = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 4l4.7 10.1 11 1.2-8.2 7.5 2.3 10.9L20 28.2 10.2 33.7l2.3-10.9-8.2-7.5 11-1.2z"/></svg>';
  var CM_HERO = '<svg viewBox="0 0 12 18" aria-hidden="true"><circle cx="6" cy="3.4" r="2.5"/><path d="M2.4 17.5V9.6C2.4 7.6 3.9 6.5 6 6.5S9.6 7.6 9.6 9.6V17.5H7.2V13H4.8V17.5Z"/></svg>';

  // A jagged starburst as a clip-path: spikes alternate between the outer and inner radius,
  // each nudged a little (deterministically) so it looks hand-inked.
  function cmBurst(spikes, inner, seed) {
    var r = rng(seed), pts = [];
    for (var i = 0; i < spikes * 2; i++) {
      var a = (Math.PI * i) / spikes - Math.PI / 2;
      var rad = i % 2 === 0 ? 0.9 + r() * 0.1 : inner * (0.85 + r() * 0.3);
      pts.push((50 + 50 * rad * Math.cos(a)).toFixed(1) + '% ' + (50 + 50 * rad * Math.sin(a)).toFixed(1) + '%');
    }
    return 'polygon(' + pts.join(',') + ')';
  }
  // A sign with zig-zag left and right edges.
  function cmZig(teeth, depth) {
    var pts = [], i;
    for (i = 0; i <= teeth; i++) pts.push((i % 2 ? depth : 0) + '% ' + (i * 100 / teeth).toFixed(1) + '%');
    for (i = teeth; i >= 0; i--) pts.push((100 - (i % 2 ? depth : 0)) + '% ' + (i * 100 / teeth).toFixed(1) + '%');
    return 'polygon(' + pts.join(',') + ')';
  }
  function cmBurstEl(cls, clip) {
    return '<div class="o-cm-burst ' + cls + '"><i class="k" style="clip-path:' + clip + '"></i><i class="f" style="clip-path:' + clip + '"></i></div>';
  }

  SOUND_NAMES.cmFollow = 'Pop and boing';
  SOUNDS.cmFollow = function () {
    noise({ ft: 'lowpass', f: 700, d: 0.08, v: 0.22 });
    tone({ f: 260, f2: 880, d: 0.16, v: 0.09, t: 0.5 });
    tone({ f: 880, f2: 440, d: 0.18, v: 0.07, t: 0.66 });
  };
  SOUND_NAMES.cmSub = 'Punch';
  SOUNDS.cmSub = function () {
    noise({ ft: 'lowpass', f: 1200, f2: 180, d: 0.26, v: 0.28, t: 0.05 });
    tone({ f: 130, f2: 45, d: 0.32, v: 0.12, t: 0.05 });
    tone({ f: 660, d: 0.08, v: 0.05, type: 'square', t: 0.82 });
    tone({ f: 990, d: 0.16, v: 0.05, type: 'square', t: 0.9 });
  };
  SOUND_NAMES.cmBits = 'Bam and coins';
  SOUNDS.cmBits = function () {
    noise({ ft: 'lowpass', f: 900, f2: 200, d: 0.22, v: 0.26 });
    tone({ f: 110, f2: 50, d: 0.25, v: 0.12 });
    for (var i = 0; i < 4; i++) {
      tone({ f: 1318, d: 0.06, v: 0.04, type: 'square', t: 0.3 + i * 0.09 });
      tone({ f: 1760, d: 0.1, v: 0.04, type: 'square', t: 0.35 + i * 0.09 });
    }
  };
  SOUND_NAMES.cmDonation = 'Cash register';
  SOUNDS.cmDonation = function () {
    noise({ ft: 'bandpass', f: 2500, q: 2, d: 0.12, v: 0.2, t: 0.3 });
    tone({ f: 2093, d: 0.5, v: 0.06, t: 0.42 });
    tone({ f: 2637, d: 0.6, v: 0.05, t: 0.5 });
    noise({ ft: 'highpass', f: 5000, d: 0.3, v: 0.08, t: 0.45 });
  };
  SOUND_NAMES.cmRaid = 'Alarm and slams';
  SOUNDS.cmRaid = function () {
    for (var i = 0; i < 2; i++) tone({ f: 500, f2: 1100, d: 0.22, v: 0.05, type: 'sawtooth', t: i * 0.24 });
    [0, 0.22, 0.44].forEach(function (t) { noise({ ft: 'lowpass', f: 600, d: 0.09, v: 0.26, t: t + 0.05 }); });
  };
  SOUND_NAMES.cmGiveaway = 'Comic fanfare';
  SOUNDS.cmGiveaway = function () {
    [523, 659, 784, 1046].forEach(function (f, i) { tone({ f: f, d: 0.14, v: 0.07, type: 'square', t: 0.3 + i * 0.1 }); });
    tone({ f: 1046, d: 0.7, v: 0.07, type: 'triangle', t: 0.72 });
    noise({ ft: 'highpass', f: 6000, d: 0.5, v: 0.1, t: 0.7, a: 0.01 });
  };

  add({
    id: 'follow-comic', alert: 'follow', fam: 'cm', isNew: true, title: 'New hero',
    desc: 'A comic panel slams in, a yellow caption box drops onto its corner, a hero badge pops and a speech bubble says the new follower joined.',
    sound: 'cmFollow', fx: 'none', anim: hold('1s'), exit: CM_EXIT, len: 0.95,
    render: function (d) {
      return '<div class="obj o-cm o-cmf"><div class="o-cmf-panel" style="--rot:-1.5deg"><i class="o-cmf-lines"></i>'
        + '<div class="o-cmf-badge">' + CM_BADGE + '</div>'
        + '<div class="o-cm-bubble o-cmf-bubble">' + nm('o-cmf-name', d.username, 17) + '<span class="o-cmf-said">joined!</span></div></div>'
        + '<div class="o-cm-cap o-cmf-cap" style="--rot:-3deg">' + label(d, 'New follower!') + '</div></div>';
    },
  });

  add({
    id: 'subscriber-comic', alert: 'subscription', fam: 'cm', isNew: true, title: 'KAPOW!',
    desc: 'A jagged starburst explodes, KAPOW! slams onto it and a caption box rises with the subscriber’s name, tier and months.',
    sound: 'cmSub', fx: 'confetti', anim: hold('1.1s'), exit: CM_EXIT, len: 1.15,
    render: function (d) {
      var months = Math.max(1, intOf(d.months));
      return '<div class="obj o-cm o-cms">' + cmBurstEl('o-cms-burst', cmBurst(16, 0.66, hash(d.username + 'kapow')))
        + '<div class="o-cm-sfx o-cms-sfx" style="--rot:-6deg">' + label(d, 'KAPOW!') + '</div>'
        + '<div class="o-cm-cap o-cms-cap" style="--rot:1.5deg"><div class="o-cms-who">' + nm('o-cms-name', d.username, 14) + '<span>subscribed!</span></div>'
        + '<span class="o-cms-pill">Tier ' + esc(d.tier || '1') + (months > 1 ? ' · ' + months + ' months' : '') + '</span>'
        + (d.message ? '<div class="o-cms-msg">' + esc(d.message) + '</div>' : '') + '</div></div>';
    },
  });

  add({
    id: 'bits-comic', alert: 'bits', fam: 'cm', isNew: true, title: 'BAM!', amount: 'Grows with the amount',
    desc: 'BAM! bursts, coins fly out of it (more coins for more bits) and a jagged sign slams in with the amount counting up. 1,000 or more adds KA-CHING!',
    sound: 'cmBits', fx: 'none', anim: hold('1.2s'), exit: CM_EXIT, len: 1.3,
    render: function (d) {
      var n = intOf(d.amount != null ? d.amount : d.bits), lvl = n >= 1000 ? 3 : n >= 100 ? 2 : 1;
      var count = [0, 3, 6, 10][lvl], r = rng(hash(d.username + n)), coins = '';
      for (var i = 0; i < count; i++) {
        var a = (-170 + r() * 160) * Math.PI / 180, dist = 60 + r() * 65;
        coins += '<i class="o-cmb-coin" style="--dx:' + (Math.cos(a) * dist).toFixed(0) + 'px;--dy:' + (Math.sin(a) * dist).toFixed(0) + 'px;--cd:' + (0.22 + i * 0.045).toFixed(2) + 's"></i>';
      }
      var zig = cmZig(8, 6);
      return '<div class="obj o-cm o-cmb lvl-' + lvl + '">' + cmBurstEl('o-cmb-burst', cmBurst(14, 0.64, hash(d.username + 'bam')))
        + '<div class="o-cm-sfx o-cmb-sfx" style="--rot:-8deg">' + label(d, 'BAM!') + '</div>'
        + '<div class="o-cmb-coins">' + coins + '</div>'
        + '<div class="o-cmb-sign"><i class="k" style="clip-path:' + zig + '"></i><i class="f" style="clip-path:' + zig + '"></i>'
        + '<div class="o-cmb-amt">' + odo(fmt(n), 0.42, 0.65) + '<small>bits</small></div></div>'
        + '<div class="o-cm-cap o-cmb-cap" style="--rot:-2deg"><span>from</span>' + nm('o-cmb-name', d.username, 12) + '</div>'
        + (lvl === 3 ? '<div class="o-cm-sfx o-cmb-extra" style="--rot:6deg">KA-CHING!</div>' : '')
        + '</div>';
    },
  });

  add({
    id: 'donation-comic', alert: 'donation', fam: 'cm', isNew: true, title: 'CHA-CHING!',
    desc: 'A panel slams in, CHA-CHING! pops on its corner, a caption says who donated how much and the message appears in a speech bubble.',
    sound: 'cmDonation', fx: 'confetti', anim: hold('1.1s'), exit: CM_EXIT, len: 1.1,
    render: function (d) {
      return '<div class="obj o-cm o-cmd"><div class="o-cmd-panel" style="--rot:1deg">'
        + '<div class="o-cm-cap o-cmd-cap">' + nm('o-cmd-name', d.username, 13) + '<span class="o-cmd-did">donated</span><span class="o-cmd-amt">' + esc(money(d.amount, d.currency)) + '</span></div>'
        + (d.message ? '<div class="o-cm-bubble o-cmd-bubble"><span class="o-cmd-msg">' + esc(d.message) + '</span></div>' : '')
        + '</div><div class="o-cm-sfx o-cmd-sfx" style="--rot:-7deg">' + label(d, 'CHA-CHING!') + '</div></div>';
    },
  });

  add({
    id: 'raid-comic', alert: 'raid', fam: 'cm', isNew: true, title: 'Incoming!', amount: 'Grows with the viewers',
    desc: 'A three-panel strip slams in panel by panel: INCOMING!, the raider’s name with speed lines, then the head count with a row of little heroes.',
    sound: 'cmRaid', fx: 'none', anim: hold('1.3s'), exit: CM_EXIT,
    len: function (d) { return 1.0 + Math.min(8, intOf(d.viewers)) * 0.05; },
    render: function (d) {
      var v = intOf(d.viewers), n = Math.min(v, 8), heroes = '';
      for (var i = 0; i < n; i++) heroes += '<i style="--hi:' + i + '">' + CM_HERO + '</i>';
      return '<div class="obj o-cm o-cmr">'
        + '<div class="o-cmr-p p1" style="--rot:-2deg;--pd:0s"><i class="o-cmr-rays"></i><div class="o-cm-sfx o-cmr-alarm">' + label(d, 'Incoming!') + '</div></div>'
        + '<div class="o-cmr-p p2" style="--rot:1deg;--pd:.22s"><i class="o-cmr-speed"></i>' + nm('o-cmr-name', d.username, 8) + '<span class="o-cmr-is">is raiding!</span></div>'
        + '<div class="o-cmr-p p3" style="--rot:-1deg;--pd:.44s"><div class="o-cm-sfx o-cmr-count">' + odo(fmt(v), 0.62, 0.6) + '</div>'
        + '<span class="o-cmr-lbl">' + (v === 1 ? 'hero' : 'heroes') + '</span><div class="o-cmr-heroes">' + heroes + '</div></div></div>';
    },
  });

  add({
    id: 'giveaway-comic', alert: 'giveaway', fam: 'cm', isNew: true, title: 'WINNER!',
    desc: 'A splash page: halftone rays spin in, WINNER! slams down in giant extruded letters, the winner’s name unfurls on a ribbon and the prize lands in a caption.',
    sound: 'cmGiveaway', fx: 'confetti', anim: hold('1.4s'), exit: CM_EXIT, len: 1.45,
    render: function (d) {
      var r = rng(hash(d.username + 'win')), stars = '';
      for (var i = 0; i < 7; i++) {
        stars += '<i style="left:' + (6 + r() * 88).toFixed(0) + '%;top:' + (8 + r() * 56).toFixed(0) + '%;--sd:' + (0.9 + i * 0.06).toFixed(2) + 's;--ss:' + (0.6 + r() * 0.6).toFixed(2) + '">' + CM_STAR + '</i>';
      }
      return '<div class="obj o-cm o-cmg"><div class="o-cmg-splash"><i class="o-cmg-rays"></i><i class="o-cmg-dots"></i></div>'
        + '<div class="o-cmg-stars">' + stars + '</div>'
        + '<div class="o-cm-sfx o-cmg-title" style="--rot:-4deg">' + label(d, 'WINNER!') + '</div>'
        + '<div class="o-cmg-ribbon"><div class="o-cmg-rb">' + nm('o-cmg-name', d.username, 18) + '</div></div>'
        + (d.prize ? '<div class="o-cm-cap o-cmg-cap" style="--rot:-1.5deg">Prize: ' + esc(d.prize) + '</div>' : '')
        + '</div>';
    },
  });
})();
