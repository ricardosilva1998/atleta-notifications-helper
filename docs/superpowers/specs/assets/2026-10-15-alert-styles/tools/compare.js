// Compare every look laid out with and without the overlay's reset (.alert-pos *{box-sizing:border-box}).
window.compareReset = function (fams) {
  var sheet = null, idx = -1, text = '';
  Array.prototype.forEach.call(document.styleSheets, function (s) { var rules; try { rules = s.cssRules; } catch (e) { return; }
    for (var i = 0; i < rules.length; i++) if (rules[i].selectorText === '.alert-pos *') { sheet = s; idx = i; text = rules[i].cssText; } });
  if (!sheet) return 'reset rule not found';
  var host = document.createElement('div'); host.style.cssText = 'position:absolute;left:0;top:0;width:460px'; document.body.appendChild(host);
  function measure() {
    var out = {};
    document.querySelectorAll('.tile').forEach(function (tile) {
      if (fams && fams.indexOf(tile.dataset.fam) < 0) return;
      var id = tile.querySelector('.pid').textContent, c = tile.querySelector('.crop').cloneNode(true); c.style.setProperty('--k', 1); host.appendChild(c);
      var slot = c.querySelector('.alert-pos'); slot.classList.remove('playing', 'exiting');
      var obj = slot.firstElementChild, list = [];
      obj.querySelectorAll('*').forEach(function (el) { var r = el.getBoundingClientRect(); list.push([(typeof el.className === 'string' ? el.className : (el.className.baseVal || el.tagName)).split(' ')[0] || el.tagName, Math.round(r.width), Math.round(r.height)]); });
      out[id] = { h: Math.round(obj.getBoundingClientRect().height), list: list }; c.remove();
    });
    return out;
  }
  var after = measure(); sheet.deleteRule(idx); var before = measure(); sheet.insertRule(text, idx); host.remove();
  var report = [];
  Object.keys(after).forEach(function (id) {
    var A = after[id], B = before[id], notes = [];
    if (Math.abs(A.h - B.h) > 2) notes.push('height ' + B.h + '→' + A.h);
    A.list.forEach(function (a, k) { var b = B.list[k]; if (b && (Math.abs(a[1] - b[1]) > 3 || Math.abs(a[2] - b[2]) > 3)) notes.push(a[0] + ' ' + b[1] + 'x' + b[2] + '→' + a[1] + 'x' + a[2]); });
    if (notes.length) report.push(id + ': ' + notes.filter(function (v, i, s) { return s.indexOf(v) === i; }).slice(0, 4).join('; '));
  });
  return report.length ? report : ['no difference'];
};
