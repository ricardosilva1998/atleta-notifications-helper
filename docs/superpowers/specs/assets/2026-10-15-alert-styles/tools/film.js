// Filmstrip: film('follow-quest', [0, .1, 'x.2'], k, cols) copies a tile's look once per moment and
// freezes each copy there (a number plays the entrance at that second; 'x0.2' is 0.2 s into the exit).
window.film = function (id, times, k, cols) {
  k = k || 0.55; cols = cols || 4;
  var tile = Array.prototype.find.call(document.querySelectorAll('.tile'), function (t) { var p = t.querySelector('.pid'); return p && p.textContent === id; });
  if (!tile) return 'no tile ' + id;
  var crop = tile.querySelector('.crop'), W = Math.round(460 * k);
  var old = document.getElementById('film'); if (old) old.remove();
  var host = document.createElement('div'); host.id = 'film';
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;background:#111;display:grid;grid-template-columns:repeat(' + cols + ',' + W + 'px);gap:6px;padding:6px;font:12px/1 monospace;color:#ddd';
  document.body.appendChild(host);
  times.forEach(function (t) {
    var exit = typeof t === 'string', s = exit ? Number(t.slice(1)) : t;
    var cell = document.createElement('div'); cell.style.cssText = 'position:relative;width:' + W + 'px';
    var c = crop.cloneNode(true); c.style.setProperty('--k', k); c.removeAttribute('tabindex');
    var lab = document.createElement('div'); lab.textContent = (exit ? 'exit ' : '') + s.toFixed(2) + 's';
    lab.style.cssText = 'position:absolute;left:4px;top:4px;z-index:99;background:rgba(0,0,0,.75);padding:2px 4px;border-radius:3px';
    cell.appendChild(c); cell.appendChild(lab); host.appendChild(cell);
    var slot = c.querySelector('.alert-pos');
    slot.classList.remove('playing', 'exiting'); void slot.offsetWidth; slot.classList.add(exit ? 'exiting' : 'playing');
    slot.getAnimations({ subtree: true }).forEach(function (a) { a.pause(); a.currentTime = s * 1000; });
  });
  var r = host.getBoundingClientRect(); return Math.ceil(r.width) + 'x' + Math.ceil(r.height);
};
window.unfilm = function () { var f = document.getElementById('film'); if (f) f.remove(); };
// Gallery: several looks side by side, each frozen at the same moment (default: finished).
window.gallery = function (ids, t, k, cols) {
  k = k || 0.7; cols = cols || 2; t = t == null ? 9 : t;
  var old = document.getElementById('film'); if (old) old.remove();
  var W = Math.round(460 * k), host = document.createElement('div'); host.id = 'film';
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;background:#111;display:grid;grid-template-columns:repeat(' + cols + ',' + W + 'px);gap:6px;padding:6px;font:12px/1 monospace;color:#ddd';
  document.body.appendChild(host);
  ids.forEach(function (id) {
    var tile = Array.prototype.find.call(document.querySelectorAll('.tile'), function (x) { var p = x.querySelector('.pid'); return p && p.textContent === id; });
    if (!tile) return;
    var cell = document.createElement('div'); cell.style.cssText = 'position:relative;width:' + W + 'px';
    var c = tile.querySelector('.crop').cloneNode(true); c.style.setProperty('--k', k);
    var lab = document.createElement('div'); lab.textContent = id;
    lab.style.cssText = 'position:absolute;left:4px;bottom:4px;z-index:99;background:rgba(0,0,0,.75);padding:2px 4px;border-radius:3px';
    cell.appendChild(c); cell.appendChild(lab); host.appendChild(cell);
    var slot = c.querySelector('.alert-pos');
    slot.classList.remove('playing', 'exiting'); void slot.offsetWidth; slot.classList.add('playing');
    slot.getAnimations({ subtree: true }).forEach(function (a) { a.pause(); a.currentTime = t * 1000; });
  });
  var r = host.getBoundingClientRect(); return Math.ceil(r.width) + 'x' + Math.ceil(r.height);
};
// Audit: every tile's finished look, measured at full size. Reports looks taller than their
// alert's budget and visible parts that reach far outside the 420px slot.
window.audit = function (fams) {
  var BUDGET = { follow: 140, subscription: 190, bits: 170, donation: 215, raid: 205, giveaway: 220 };
  var host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:0;top:0;width:460px;visibility:visible;z-index:-1';
  document.body.appendChild(host);
  var out = [];
  document.querySelectorAll('.tile').forEach(function (tile) {
    if (fams && fams.indexOf(tile.dataset.fam) < 0) return;
    var id = tile.querySelector('.pid').textContent, alert = (tile.closest('.alert-group') || {}).dataset.alert;
    var c = tile.querySelector('.crop').cloneNode(true); c.style.setProperty('--k', 1); host.appendChild(c);
    var slot = c.querySelector('.alert-pos'); slot.classList.remove('playing', 'exiting');
    var sr = slot.getBoundingClientRect(), obj = slot.firstElementChild, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    function shown(el) { for (var e = el; e && e !== slot; e = e.parentElement) { var cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false; } return true; }
    // What an element shows once its clipping ancestors (overflow other than visible) cut it.
    function visibleRect(el) {
      var r = el.getBoundingClientRect(), L = r.left, R = r.right, T = r.top, B = r.bottom;
      for (var e = el.parentElement; e && e !== slot; e = e.parentElement) {
        var cs = getComputedStyle(e);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || (cs.clipPath && cs.clipPath !== 'none')) { var q = e.getBoundingClientRect(); L = Math.max(L, q.left); R = Math.min(R, q.right); T = Math.max(T, q.top); B = Math.min(B, q.bottom); }
      }
      return R > L && B > T ? { left: L, right: R, top: T, bottom: B } : null;
    }
    var deco = [];
    [obj].concat(Array.prototype.slice.call(obj.querySelectorAll('*'))).forEach(function (el) {
      if (!shown(el)) return;
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') return;
      var r = visibleRect(el); if (!r) return;
      var cs = getComputedStyle(el), masked = (cs.webkitMaskImage && cs.webkitMaskImage !== 'none') || (cs.maskImage && cs.maskImage !== 'none');
      if (masked) { deco.push(r); return; }
      minX = Math.min(minX, r.left); maxX = Math.max(maxX, r.right); minY = Math.min(minY, r.top); maxY = Math.max(maxY, r.bottom);
    });
    var objH = obj.getBoundingClientRect().height, visH = maxY - minY, issues = [];
    if (BUDGET[alert] && Math.max(objH, visH) > BUDGET[alert] + 2) issues.push('height ' + Math.round(objH) + '/' + Math.round(visH) + ' > ' + BUDGET[alert]);
    if (minX < sr.left - 24) issues.push('left ' + Math.round(sr.left - minX) + 'px out');
    if (maxX > sr.right + 24) issues.push('right ' + Math.round(maxX - sr.right) + 'px out');
    if (minY < sr.top - 16) issues.push('top ' + Math.round(sr.top - minY) + 'px out');
    if (issues.length) out.push(id + ': ' + issues.join(', '));
    c.remove();
  });
  host.remove();
  return out.length ? out : ['all within budgets'];
};
