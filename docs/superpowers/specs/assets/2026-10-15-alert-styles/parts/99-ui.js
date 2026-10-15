/* ── Screen effects, drawn on a 1920x1080 layer ────────────────────────── */
function fx(layer, kind) {
  if (!layer || !kind || kind === 'none' || REDUCE) return;
  var r = Math.random, made = [], frag = document.createDocumentFragment(), i;
  function addFx(cls, style) { var e = document.createElement('i'); e.className = 'fx ' + cls; e.setAttribute('style', style); frag.appendChild(e); made.push(e); }
  function n(v, d) { return v.toFixed(d == null ? 0 : d); }
  if (kind === 'smoke') {
    for (i = 0; i < 20; i++) {
      var s = 220 + r() * 300;
      addFx('fx-smoke', 'left:' + n(i % 2 ? 4 + r() * 20 : 76 + r() * 20, 1) + '%;top:' + n(98 + r() * 6, 1) + '%;width:' + n(s) + 'px;height:' + n(s) + 'px;--dx:' + n((i % 2 ? 1 : -1) * (60 + r() * 220)) + 'px;--dy:' + n(-(220 + r() * 460)) + 'px;--du:' + n(2 + r() * 1.3, 2) + 's;--dd:' + n(r() * 0.7, 2) + 's');
    }
  } else if (kind === 'checker' || kind === 'confetti') {
    var cols = ['#ff4444', '#00ff88', '#f7c948', '#4285f4', '#ff88cc', '#ffffff', '#bf00ff', '#00ccff'];
    for (i = 0; i < 60; i++) {
      var common = 'left:' + n(r() * 100, 1) + '%;top:' + n(-4 - r() * 8, 1) + '%;--dx:' + n((r() - 0.5) * 260) + 'px;--fall:1240px;--rx:' + n(360 + r() * 720) + 'deg;--rz:' + n(r() * 540) + 'deg;--du:' + n(2.2 + r() * 1.4, 2) + 's;--dd:' + n(r() * 0.9, 2) + 's;';
      if (kind === 'checker') {
        var fill = i % 3 === 0 ? 'repeating-conic-gradient(#111 0 25%,#f4f4f4 0 50%) 0 0/50% 50%' : (i % 2 ? '#f4f4f4' : '#111');
        addFx('fx-check', common + '--s:' + n(18 + r() * 26) + 'px;--fill:' + fill);
      } else {
        addFx('fx-conf', common + '--w:' + n(8 + r() * 10) + 'px;--ht:' + n(12 + r() * 12) + 'px;--fill:' + cols[i % cols.length]);
      }
    }
  } else if (kind === 'speed') {
    for (i = 0; i < 48; i++) addFx('fx-speed', 'left:50%;top:44%;width:' + n(160 + r() * 340) + 'px;--t:' + n(r() * 360) + 'deg;--r0:' + n(90 + r() * 160) + 'px;--r1:' + n(900 + r() * 500) + 'px;--du:' + n(0.45 + r() * 0.35, 2) + 's;--dd:' + n(r() * 0.4, 2) + 's');
  } else if (kind === 'sparks') {
    for (i = 0; i < 56; i++) {
      var dir = r() < 0.5 ? -1 : 1;
      addFx('fx-spark', 'left:' + n(18 + r() * 64, 1) + '%;top:' + n(97 + r() * 2, 1) + '%;--dx:' + n(dir * (100 + r() * 460)) + 'px;--dy:' + n(-(200 + r() * 420)) + 'px;--a0:' + (dir * 20) + 'deg;--a1:' + (dir * 60) + 'deg;--a2:' + (dir * 130) + 'deg;--du:' + n(0.6 + r() * 0.5, 2) + 's;--dd:' + n(r() * 0.8, 2) + 's');
    }
  } else if (kind === 'champagne') {
    [-1, 1].forEach(function (side) {
      for (var j = 0; j < 40; j++) addFx('fx-drop', 'left:' + (side < 0 ? 6 : 94) + '%;top:97%;--dx:' + n(-side * (220 + r() * 760)) + 'px;--dy:' + n(-(320 + r() * 560)) + 'px;--du:' + n(1.1 + r() * 0.9, 2) + 's;--dd:' + n(r(), 2) + 's');
    });
  }
  layer.appendChild(frag);
  setTimeout(function () { made.forEach(function (e) { e.remove(); }); }, 5200);
}

/* ── Tiles: one 1:1 crop of the screen per look ────────────────────────── */
var groupsEl = document.getElementById('groups');
var tiles = [];
var cropObserver = new ResizeObserver(function (entries) {
  entries.forEach(function (e) { var w = e.contentRect.width; if (w > 0) e.target.style.setProperty('--k', Math.min(1, w / 460).toFixed(4)); });
});
// As many columns as fit (each at least data-min px wide), without leaving one alone on a row.
function bestCols(n, width, min) {
  var best = 1;
  for (var c = Math.min(n, 6); c >= 2; c--) {
    if ((width - (c - 1) * 16) / c < min) continue;
    if (best === 1) best = c;
    if (n % c === 0 || n % c >= 2) return c;
  }
  return best;
}
var gridObserver = new ResizeObserver(function (entries) {
  entries.forEach(function (e) {
    var n = e.target.children.length, w = e.contentRect.width, min = Number(e.target.dataset.min) || 340;
    if (n && w > 0) e.target.style.gridTemplateColumns = 'repeat(' + bestCols(n, w, min) + ',minmax(0,1fr))';
  });
});

function tagsFor(p) {
  var tags = [];
  if (p.edit === 'all') tags.push('<li class="ed">Every colour, font and text editable</li>');
  if (p.amount) tags.push('<li class="amt">' + esc(p.amount) + '</li>');
  tags.push('<li>♪ ' + esc(SOUND_NAMES[p.sound] || 'No sound') + '</li>');
  tags.push('<li>Effect: ' + esc(FX_NAMES[p.fx] || 'None') + '</li>');
  return tags.join('');
}

ALERTS.forEach(function (a) {
  var list = looksFor(a.key);
  var sec = document.createElement('section');
  sec.className = 'sec alert-group';
  sec.dataset.alert = a.key;
  sec.innerHTML = '<div class="wrap"><div class="sec-head"><h2>' + a.name + '<small>' + list.length + ' looks</small></h2><p>' + esc(a.blurb) + '</p></div><div class="tiles"></div></div>';
  var grid = sec.querySelector('.tiles');
  list.forEach(function (p) {
    var el = document.createElement('article');
    el.className = 'tile';
    el.dataset.fam = p.fam;
    el.innerHTML = '<div class="crop" tabindex="0" role="button" aria-label="Replay ' + esc(p.title) + '" style="--h:' + a.h + 'px">'
      + '<div class="scene"><i class="kerb l"></i><i class="kerb r"></i><i class="dash"></i></div>'
      + '<div class="crop-screen"><div class="alert-pos"></div></div></div>'
      + '<div class="tile-meta"><div class="tile-top"><code class="pid">' + (p.label || p.id) + '</code>'
      + (p.before ? '<span class="badge before">Before</span>' : p.improved ? '<span class="badge improved">Improved</span>' : p.isNew ? '<span class="badge new">New</span>' : '<span class="badge today">Today</span>') + '</div>'
      + '<h3>' + esc(p.title) + '</h3><p>' + esc(p.desc) + '</p><ul class="tags">' + tagsFor(p) + '</ul>'
      + '<div class="tile-actions"><button type="button" class="btn" data-act="play">↻ Replay</button><button type="button" class="btn" data-act="exit">Exit</button><button type="button" class="btn" data-act="sound">♪ Sound</button></div></div>';
    var t = { el: el, p: p, crop: el.querySelector('.crop'), slot: el.querySelector('.alert-pos'), timer: 0, gen: 0, visible: false, d: null };
    t.d = draw(t.slot, p);
    el.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-act]');
      if (btn) {
        var act = btn.dataset.act;
        if (act === 'play') playTile(t, state.sound);
        else if (act === 'exit') exitTile(t);
        else playSound(p.sound);
        return;
      }
      if (ev.target.closest('.crop')) playTile(t, state.sound);
    });
    t.crop.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); playTile(t, state.sound); } });
    cropObserver.observe(t.crop);
    tiles.push(t);
    grid.appendChild(el);
  });
  gridObserver.observe(grid);
  groupsEl.appendChild(sec);
});

function playTile(t, withSound) {
  clearTimeout(t.timer);
  var gen = ++t.gen;
  t.d = draw(t.slot, t.p);
  start(t.slot);
  if (withSound) playSound(t.p.sound);
  if (state.loop && t.visible && !REDUCE) {
    t.timer = setTimeout(function () { if (gen === t.gen) exitTile(t); }, (lenOf(t.p, t.d) / state.spd + 2.6) * 1000);
  } else {
    t.timer = 0;
  }
}
function exitTile(t) {
  clearTimeout(t.timer);
  var gen = ++t.gen;
  finish(t.slot);
  if (state.loop && t.visible && !REDUCE) {
    t.timer = setTimeout(function () { if (gen === t.gen) playTile(t, false); }, (parseFloat(t.p.exit.dur) / state.spd + 0.8) * 1000);
  } else {
    t.timer = 0;
  }
}
var tileObserver = new IntersectionObserver(function (entries) {
  entries.forEach(function (e) {
    var t = tiles.find(function (x) { return x.el === e.target; });
    if (!t) return;
    t.visible = e.isIntersecting;
    if (t.visible && state.loop && !REDUCE) {
      if (!t.timer) { var gen = ++t.gen; t.timer = setTimeout(function () { if (gen === t.gen) playTile(t, false); }, 250 + Math.random() * 900); }
    } else if (!t.visible) {
      clearTimeout(t.timer); t.timer = 0; t.gen++;
    }
  });
}, { rootMargin: '80px' });
tiles.forEach(function (t) { tileObserver.observe(t.el); });

function redrawTiles() {
  tiles.forEach(function (t) {
    if (t.visible && state.loop && !REDUCE) playTile(t, false);
    else { clearTimeout(t.timer); t.timer = 0; t.gen++; t.d = draw(t.slot, t.p); rest(t.slot); }
  });
}
function applyFilters() {
  document.querySelectorAll('.alert-group').forEach(function (g) { g.hidden = state.alert !== 'all' && g.dataset.alert !== state.alert; });
  tiles.forEach(function (t) { t.el.hidden = state.fam !== 'all' && t.p.fam !== state.fam; });
  document.querySelectorAll('.alert-group').forEach(function (g) {
    if (g.hidden) return;
    var any = Array.prototype.some.call(g.querySelectorAll('.tile'), function (el) { return !el.hidden; });
    g.hidden = !any;
  });
}

/* ── Controls ──────────────────────────────────────────────────────────── */
var LIVERIES = [
  { key: 'default', name: 'Each family’s own colour' },
  { key: 'papaya', name: 'Papaya', hex: '#FF8000' },
  { key: 'green', name: 'Racing green', hex: '#17A35A' },
  { key: 'ice', name: 'Ice blue', hex: '#36C6FF' },
  { key: 'ronin', name: 'Ronin red', hex: '#D81E26' },
  { key: 'violet', name: 'Twitch violet', hex: '#9146FF' },
];
function hexRgb(h) { var v = parseInt(h.slice(1), 16); return ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255); }
function applyLivery() {
  var l = LIVERIES.find(function (x) { return x.key === state.livery; }), b = document.body.style;
  if (!l || !l.hex) { b.removeProperty('--a'); b.removeProperty('--a-rgb'); b.removeProperty('--a-on'); }
  else { b.setProperty('--a', l.hex); b.setProperty('--a-rgb', hexRgb(l.hex)); b.setProperty('--a-on', onColour(l.hex)); }
  document.querySelectorAll('[data-livery]').forEach(function (s) { s.setAttribute('aria-pressed', String(s.dataset.livery === state.livery)); });
}
function swatchHtml() {
  return LIVERIES.map(function (l) {
    return '<button type="button" class="sw' + (l.hex ? '' : ' def') + '" data-livery="' + l.key + '" style="' + (l.hex ? '--c:' + l.hex : '') + '" title="' + esc(l.name) + '" aria-label="' + esc(l.name) + '" aria-pressed="' + (l.key === state.livery) + '"></button>';
  }).join('');
}
document.getElementById('f-livery').innerHTML = swatchHtml();
document.addEventListener('click', function (ev) {
  var sw = ev.target.closest('[data-livery]');
  if (!sw) return;
  state.livery = sw.dataset.livery;
  applyLivery();
});

function segment(id, onChange) {
  var el = document.getElementById(id);
  el.addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-v]');
    if (!b) return;
    el.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    onChange(b.dataset.v);
  });
}
function toggle(id, initial, onChange) {
  var el = document.getElementById(id);
  el.setAttribute('aria-pressed', String(initial));
  el.addEventListener('click', function () {
    var on = el.getAttribute('aria-pressed') !== 'true';
    el.setAttribute('aria-pressed', String(on));
    onChange(on);
  });
  return el;
}
// The family lists are drawn from FAMS, so a family file only has to register itself.
var FAM_KEYS = Object.keys(FAMS).sort(function (a, b) { return FAMS[a].order - FAMS[b].order; });
var BADGE_TEXT = { today: 'Today', improved: 'Improved', new: 'New' };
document.getElementById('fam-grid').innerHTML = FAM_KEYS.map(function (k) {
  var f = FAMS[k];
  return '<li class="fam"><i style="--sw:' + f.sw + '"></i><b>' + esc(f.name) + '</b><span>' + esc(f.desc) + '</span><em><span class="badge ' + f.badge + '">' + BADGE_TEXT[f.badge] + '</span></em></li>';
}).join('');
var famGrid = document.getElementById('fam-grid');
famGrid.dataset.min = '250';
gridObserver.observe(famGrid);
document.getElementById('f-fam').insertAdjacentHTML('beforeend', FAM_KEYS.map(function (k) {
  return '<button type="button" data-v="' + k + '" aria-pressed="false">' + esc(FAMS[k].name) + '</button>';
}).join(''));
document.getElementById('stage-fam').innerHTML = FAM_KEYS.map(function (k) {
  return '<button type="button" data-v="' + k + '" aria-pressed="' + (k === state.stageFam) + '"><i style="--sw:' + FAMS[k].sw + '"></i>' + esc(FAMS[k].name) + '</button>';
}).join('');
var looksCount = P.filter(function (p) { return !p.before; }).length;
document.getElementById('facts-line').textContent = FAM_KEYS.length + ' families · ' + looksCount + ' looks across six alerts · 5 new screen effects · a sound for every look';

segment('f-alert', function (v) { state.alert = v; applyFilters(); });
segment('f-fam', function (v) { state.fam = v; applyFilters(); });
segment('f-level', function (v) { state.level = v; redrawTiles(); stageRest(); bmRender(true); });
segment('f-speed', function (v) { state.spd = Number(v); document.body.style.setProperty('--spd', String(state.spd)); redrawTiles(); });
toggle('f-long', false, function (on) { state.long = on; redrawTiles(); stageRest(); bmRender(true); });
toggle('f-loop', state.loop, function (on) { state.loop = on; redrawTiles(); });
var soundBtns = [];
function setSound(on) { state.sound = on; soundBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(on)); }); if (on) ac(); }
soundBtns.push(toggle('f-sound', false, setSound));
soundBtns.push(toggle('stage-sound-t', false, setSound));

/* ── The stage: a whole family on a 1080p stream ───────────────────────── */
var stageEl = document.getElementById('stage');
var stageScreen = document.getElementById('stage-screen');
var stageSlot = document.getElementById('stage-slot');
var stageFx = document.getElementById('stage-fx');
var stageCap = document.getElementById('stage-cap');
var stagePlayBtn = document.getElementById('stage-play');
var stageRun = 0, stageTimer = 0, stageZoom = false;
// Real size shows the whole 1080p screen; close-up enlarges the top middle, where the alerts sit.
function fitStage() {
  var w = stageEl.clientWidth, k = (w / 1920) * (stageZoom ? 2.4 : 1);
  stageScreen.style.transform = 'translate(' + ((w - 1920 * k) / 2).toFixed(1) + 'px,0) scale(' + k.toFixed(5) + ')';
}
new ResizeObserver(fitStage).observe(stageEl);
function stagePresets() {
  return ALERTS.map(function (a) { return famPreset(a.key, state.stageFam); }).filter(Boolean);
}
function stageShow(p, play) {
  var d = draw(stageSlot, p);
  if (play) start(stageSlot); else rest(stageSlot);
  stageCap.innerHTML = '<code>' + p.id + '</code><span>' + esc(p.title) + '</span>';
  return d;
}
function stageRest() {
  if (stagePlayBtn.dataset.running === '1') return;
  var list = stagePresets();
  if (list.length) stageShow(list[0], false);
}
function stageStop() {
  stageRun++; clearTimeout(stageTimer);
  stagePlayBtn.dataset.running = '0';
  stagePlayBtn.textContent = '▶ Play all six alerts';
  stageRest();
}
function stagePlay() {
  var run = ++stageRun, list = stagePresets(), i = 0;
  stagePlayBtn.dataset.running = '1';
  stagePlayBtn.textContent = '■ Stop';
  function step() {
    if (run !== stageRun) return;
    if (i >= list.length) { stageStop(); return; }
    var p = list[i++], d = stageShow(p, true);
    if (state.sound) playSound(p.sound);
    if (state.stageFx) fx(stageFx, p.fx);
    stageTimer = setTimeout(function () {
      if (run !== stageRun) return;
      finish(stageSlot);
      stageTimer = setTimeout(step, (parseFloat(p.exit.dur) / state.spd + 0.6) * 1000);
    }, (lenOf(p, d) / state.spd + 2.4) * 1000);
  }
  step();
}
function stageToggle() { if (stagePlayBtn.dataset.running === '1') stageStop(); else stagePlay(); }
stagePlayBtn.addEventListener('click', function (ev) { ev.stopPropagation(); stageToggle(); });
stageEl.addEventListener('click', stageToggle);
stageEl.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); stageToggle(); } });
segment('stage-fam', function (v) { state.stageFam = v; stageStop(); });
toggle('stage-fx-t', true, function (on) { state.stageFx = on; });
toggle('stage-zoom-t', false, function (on) { stageZoom = on; fitStage(); });
stageRest();

/* ── Layers: the new screen effects and every sound ────────────────────── */
var FX_LIST = [
  ['smoke', 'Tyre smoke', 'Burnout smoke rolls in from both bottom corners.'],
  ['checker', 'Chequered confetti', 'Black and white squares tumble down, a finish flag torn to pieces.'],
  ['speed', 'Speed lines', 'Lines rush out from the centre for half a second, like hitting the boost.'],
  ['sparks', 'Titanium sparks', 'Sparks spray up from the bottom of the screen, like a car bottoming out on a straight.'],
  ['champagne', 'Champagne', 'Two sprays arc in from the bottom corners, podium-style.'],
];
var fxGrid = document.getElementById('fx-grid');
var fxTiles = [];
FX_LIST.forEach(function (f) {
  var el = document.createElement('article');
  el.className = 'fx-tile';
  el.innerHTML = '<div class="stage" role="button" tabindex="0" aria-label="Play ' + esc(f[1]) + '"><div class="screen1080"><div class="scene"><i class="kerb l"></i><i class="kerb r"></i><i class="dash"></i></div><div class="fx-layer"></div></div></div>'
    + '<div class="tile-meta"><div class="tile-top"><h3>' + esc(f[1]) + '</h3><span class="badge new">New</span></div><p>' + esc(f[2]) + '</p></div>';
  var st = el.querySelector('.stage'), screen = el.querySelector('.screen1080'), layer = el.querySelector('.fx-layer');
  new ResizeObserver(function () { screen.style.setProperty('--k', (st.clientWidth / 1920).toFixed(5)); }).observe(st);
  var t = { el: el, layer: layer, kind: f[0], timer: 0 };
  function run() { fx(layer, f[0]); }
  st.addEventListener('click', run);
  st.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); run(); } });
  fxTiles.push(t);
  fxGrid.appendChild(el);
});
var fxObserver = new IntersectionObserver(function (entries) {
  entries.forEach(function (e) {
    var t = fxTiles.find(function (x) { return x.el === e.target; });
    if (!t) return;
    clearInterval(t.timer); t.timer = 0;
    if (e.isIntersecting && !REDUCE) {
      fx(t.layer, t.kind);
      t.timer = setInterval(function () { if (state.loop) fx(t.layer, t.kind); }, 4600);
    }
  });
});
fxTiles.forEach(function (t) { fxObserver.observe(t.el); });
fxGrid.dataset.min = '300';
gridObserver.observe(fxGrid);

var soundList = document.getElementById('sound-list');
FAM_KEYS.map(function (k) { return [k, FAMS[k].name]; }).forEach(function (g) {
  var looks = P.filter(function (p) { return p.fam === g[0] && !p.before; });
  var seen = {}, chips = '';
  looks.forEach(function (p) {
    if (seen[p.sound]) return;
    seen[p.sound] = true;
    chips += '<button type="button" class="chip" data-sound="' + p.sound + '">' + esc(SOUND_NAMES[p.sound]) + '</button>';
  });
  var row = document.createElement('div');
  row.className = 'sound-fam';
  row.innerHTML = '<b>' + g[1] + '</b>' + chips;
  soundList.appendChild(row);
});
soundList.addEventListener('click', function (ev) { var c = ev.target.closest('[data-sound]'); if (c) playSound(c.dataset.sound); });

/* ── Builder mock-up ───────────────────────────────────────────────────── */
var bm = {
  alert: 'follow',
  sel: { follow: 'follow-grandprix', subscription: 'subscriber-samurai', bits: 'bits-cockpit', donation: 'donation-grandprix', raid: 'raid-arcade', giveaway: 'giveaway-samurai' },
  labels: {}, fx: {}, sound: {}, grows: {}, spd: 1, msg: '',
};
var bmPanel = document.getElementById('bm-panel');
var bmSlot = document.getElementById('bm-slot');
var bmCanvas = document.getElementById('bm-canvas');
new ResizeObserver(function () { bmCanvas.style.setProperty('--k', Math.min(1.3, bmCanvas.clientWidth / 460).toFixed(4)); }).observe(bmCanvas);
function bmSel() { return byId(bm.sel[bm.alert]) || pickable(bm.alert)[0]; }
function canLabel(p) { return !!(p.isNew || p.edit); }
function canColour(p) { return !!(p.edit || (p.isNew && p.fam !== 'samurai')); }
function bmData(p) { var d = sample(p.alert); if (canLabel(p) && bm.labels[p.id]) d.label = bm.labels[p.id]; return d; }
function options(map, chosen) { return Object.keys(map).map(function (k) { return '<option value="' + k + '"' + (k === chosen ? ' selected' : '') + '>' + esc(map[k]) + '</option>'; }).join(''); }
function bmRender(play) {
  var sel = bmSel(), alert = ALERTS.find(function (a) { return a.key === bm.alert; });
  var fam = FAMS[sel.fam], famAll = ALERTS.every(function (a) { return famPreset(a.key, sel.fam); });
  var fxKey = bm.fx[sel.id] || sel.fx, soundKey = bm.sound[sel.id] || sel.sound;
  var cards = pickable(bm.alert).map(function (p) {
    return '<button type="button" class="bm-card" data-id="' + p.id + '" aria-pressed="' + (p.id === sel.id) + '">'
      + '<span class="bm-thumb"><span class="scene"></span><span class="bm-mini">' + p.render(sample(p.alert)) + '</span></span>'
      + '<span class="bm-label"><b>' + esc(p.title) + '</b><em>' + p.id + '</em></span></button>';
  }).join('');
  bmPanel.innerHTML = '<div class="bm-tabs">' + ALERTS.map(function (a) { return '<button type="button" class="bm-tab" data-alert="' + a.key + '" aria-pressed="' + (a.key === bm.alert) + '">' + a.name + '</button>'; }).join('') + '</div>'
    + '<div class="bm-sec"><div class="bm-sec-h">Style <code>' + sel.id + '</code></div><div class="bm-grid">' + cards + '</div>'
    + '<button type="button" class="btn bm-wide" data-bm="family"' + (famAll ? '' : ' disabled') + '>' + (famAll ? 'Use ' + fam.name + ' for all six alerts' : fam.name + ' has only this alert') + '</button>'
    + '<div class="bm-msg" role="status">' + esc(bm.msg) + '</div></div>'
    + '<div class="bm-sec"><div class="bm-sec-h">Colour</div><div class="bm-row"><span>Accent</span><span class="swatches">' + (canColour(sel) ? swatchHtml() : '<em style="font-style:normal;color:var(--fg-3)">Fixed for this look</em>') + '</span></div>'
    + (sel.edit === 'all' ? '<div class="bm-row"><span>Card</span><em style="font-style:normal;color:var(--fg-3);text-align:right">Background, text colour and the name’s font: as today</em></div>' : '') + '</div>'
    + '<div class="bm-sec"><div class="bm-sec-h">Text</div><div class="bm-row"><label for="bm-label">Label</label><input type="text" id="bm-label" maxlength="40" value="' + esc(bm.labels[sel.id] || '') + '" placeholder="' + (canLabel(sel) ? 'Default text' : 'Fixed for this look') + '"' + (canLabel(sel) ? '' : ' disabled') + '></div></div>'
    + '<div class="bm-sec"><div class="bm-sec-h">Speed</div><div class="bm-row"><label for="bm-speed">Speed</label><span class="bm-inline"><input type="range" id="bm-speed" min="0.5" max="2" step="0.1" value="' + bm.spd + '"><output id="bm-speed-o">' + bm.spd.toFixed(1) + '×</output></span></div></div>'
    + '<div class="bm-sec"><div class="bm-sec-h">On top of the style</div>'
    + '<div class="bm-row"><label for="bm-fx">Screen effect</label><select id="bm-fx">' + options(FX_NAMES, fxKey) + '</select></div>'
    + '<div class="bm-row"><label for="bm-sound">Sound</label><span class="bm-inline"><select id="bm-sound">' + options(SOUND_NAMES, soundKey) + '</select><button type="button" class="btn" data-bm="hear" aria-label="Listen">▶</button></span></div>'
    + '<div class="bm-row"><span>Grows with the amount</span>' + (sel.amount ? '<button type="button" class="toggle" data-bm="grows" aria-pressed="' + (bm.grows[sel.id] !== false) + '">' + (bm.grows[sel.id] !== false ? 'On' : 'Off') + '</button>' : '<em style="font-style:normal;color:var(--fg-3)">' + (sel.alert === 'follow' || sel.alert === 'giveaway' ? 'No amount in this alert' : 'Not in this look') + '</em>') + '</div></div>';
  document.getElementById('bm-badge').textContent = alert.name;
  document.getElementById('bm-id').textContent = sel.id;
  document.getElementById('bm-foot').innerHTML = '<span><b>' + esc(sel.title) + '.</b> ' + esc(sel.desc) + '</span><span>Test plays it here and, in the real builder, in your OBS overlay too. Save stores the style for this alert only; the family button sets all six.</span>';
  bmSlot.style.setProperty('--spd', String(bm.spd));
  draw(bmSlot, sel, bmData(sel));
  if (play && !REDUCE) start(bmSlot); else rest(bmSlot);
}
bmPanel.addEventListener('click', function (ev) {
  var tab = ev.target.closest('[data-alert]');
  if (tab) { bm.alert = tab.dataset.alert; bm.msg = ''; bmRender(true); return; }
  var card = ev.target.closest('.bm-card');
  if (card) { bm.sel[bm.alert] = card.dataset.id; bm.msg = ''; bmRender(true); return; }
  var act = ev.target.closest('[data-bm]');
  if (!act) return;
  var sel = bmSel();
  if (act.dataset.bm === 'family') {
    ALERTS.forEach(function (a) { var p = famPreset(a.key, sel.fam); if (p) bm.sel[a.key] = p.id; });
    bm.msg = FAMS[sel.fam].name + ' is now the style of all six alerts.';
    bmRender(true);
  } else if (act.dataset.bm === 'hear') {
    playSound(bm.sound[sel.id] || sel.sound);
  } else if (act.dataset.bm === 'grows') {
    bm.grows[sel.id] = bm.grows[sel.id] === false;
    bmRender(false);
  }
});
bmPanel.addEventListener('input', function (ev) {
  var sel = bmSel();
  if (ev.target.id === 'bm-label') {
    bm.labels[sel.id] = ev.target.value;
    draw(bmSlot, sel, bmData(sel)); rest(bmSlot);
  } else if (ev.target.id === 'bm-speed') {
    bm.spd = Number(ev.target.value);
    document.getElementById('bm-speed-o').textContent = bm.spd.toFixed(1) + '×';
    bmSlot.style.setProperty('--spd', String(bm.spd));
  }
});
bmPanel.addEventListener('change', function (ev) {
  var sel = bmSel();
  if (ev.target.id === 'bm-fx') bm.fx[sel.id] = ev.target.value;
  else if (ev.target.id === 'bm-sound') { bm.sound[sel.id] = ev.target.value; playSound(ev.target.value); }
  else if (ev.target.id === 'bm-speed') { draw(bmSlot, sel, bmData(sel)); start(bmSlot); }
});
document.getElementById('bm-test').addEventListener('click', function () {
  var sel = bmSel();
  draw(bmSlot, sel, bmData(sel)); start(bmSlot);
  playSound(bm.sound[sel.id] || sel.sound);
});
document.getElementById('bm-save').addEventListener('click', function () {
  bm.msg = 'Saved (in this mock-up nothing is stored).';
  bmRender(false);
});
bmRender(false);

applyLivery();
applyFilters();
})();
