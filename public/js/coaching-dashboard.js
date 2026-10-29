// The streamer's coaching page (views/coaching-dashboard.ejs, routes/coachingDashboard.js). It draws the Schedule (the
// bookings to come by day, with Accept and Decline for a waiting request and Cancel for a confirmed session, and the
// last 30 days below) and the parts of When I coach that the server leaves to it (the seven weekday rows, the days
// off, the status line), from window.COACHING_DASHBOARD_DATA, and redraws from each answer of the JSON routes under
// /dashboard/api/coaching/ ({ ok: true, ... } or { ok: false, code, error }, the error being the route's own text).
// Times arrive as UTC instants and are shown in the streamer's coaching zone (window.COACHING_CORE,
// public/js/coaching-core.js). Texts come from window.COACHING_DASHBOARD_TEXTS, their {{fields}} filled here; every
// text, name and note goes in with textContent. public/js/csrf.js adds the session's token to the POSTs.
(function () {
  'use strict';

  var DATA = window.COACHING_DASHBOARD_DATA || {};
  var T = window.COACHING_DASHBOARD_TEXTS || {};
  var C = window.COACHING_CORE;
  if (!C || !DATA.settings) return;

  var REQUEST_MS = 20000;
  var OK_MS = 4000;
  var DAY_MS = 86400e3;
  var MINUTE_MS = 60e3;
  var MONDAY = '2026-10-26'; // a Monday: the rows' weekday names come from Intl, in the page's language
  var lang = DATA.lang || 'en';
  var setUp = !!DATA.setUp;
  var settings = DATA.settings;
  var schedule = DATA.schedule || { days: [], past: [] };
  var hours = copyHours(settings.hours);
  var daysOff = (settings.daysOff || []).slice();
  var saving = false;

  function copyHours(list) {
    return (list || []).map(function (d) { return { on: !!d.on, start: d.start, end: d.end }; });
  }
  function validZone(z) {
    if (!z) return false;
    try { new Intl.DateTimeFormat('en', { timeZone: z }); return true; } catch (e) { return false; }
  }
  function browserZone() {
    var z = 'UTC';
    try { z = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { z = 'UTC'; }
    return validZone(z) ? z : 'UTC';
  }
  // The zone the schedule is shown in: the one the hours are saved in, else this browser's.
  var zone = validZone(settings.timeZone) ? settings.timeZone : browserZone();

  function $(id) { return document.getElementById(id); }
  function show(el, on) { if (el) el.hidden = !on; }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function make(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }
  function fill(text, values) {
    return String(text == null ? '' : text).replace(/\{\{(\w+)\}\}/g, function (_, k) { return values && values[k] != null ? values[k] : ''; });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(minutes) { return pad(Math.floor(minutes / 60)) + ':' + pad(minutes % 60); }
  function addDays(iso, n) { return new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10); }
  function dateText(iso) { return C.dateLabel(Date.parse(iso + 'T12:00:00Z'), 'UTC', lang); }
  function time(ms) { return C.timeLabel(ms, zone, lang); }
  function lengthText(m) { return m === 30 ? T.minutes30 : T.minutes60; }

  // ── Requests ──
  // { ok: true, data } or { ok: false, code, text }: a redirect (to sign in, which leads off the site) or a 401/403
  // answer (a CSRF refusal included) means the session ended; an answer that is not JSON did not work; no answer in
  // 20 s counts as no network.
  function api(method, url, body) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, REQUEST_MS) : null;
    var options = { method: method, redirect: 'manual', credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (ctrl) options.signal = ctrl.signal;
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    return fetch(url, options).then(function (res) {
      if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400) || res.status === 401 || res.status === 403) {
        return { ok: false, text: T.sessionEnded };
      }
      return res.json().then(function (json) {
        if (res.ok && json && json.ok) return { ok: true, data: json };
        return { ok: false, code: json && json.code, text: (json && json.error) || T.failed };
      }, function () {
        return { ok: false, text: T.failed };
      });
    }, function () {
      return { ok: false, text: T.offline };
    }).then(function (answer) {
      if (timer) clearTimeout(timer);
      return answer;
    });
  }

  // A card's message line: tone 'ok' (fades after a moment), 'warn', or an error (no tone).
  function message(id, text, tone) {
    var box = $(id);
    if (!box) return;
    clearTimeout(box._timer);
    box.textContent = text || '';
    box.className = 'cd-msg' + (tone ? ' ' + tone : '');
    show(box, !!text);
    if (text && tone === 'ok') box._timer = setTimeout(function () { show(box, false); }, OK_MS);
  }

  // ── Schedule ──

  function eachBooking(fn) {
    schedule.days.forEach(function (day) { day.bookings.forEach(fn); });
    schedule.past.forEach(fn);
  }

  // The bookings again by day in the shown zone, after the zone was changed by a save.
  function regroup() {
    var now = Date.now();
    var all = [];
    eachBooking(function (b) { all.push(b); });
    var days = [];
    var past = [];
    all.sort(function (a, b) { return a.startsAt - b.startsAt; }).forEach(function (b) {
      if (b.startsAt + b.minutes * MINUTE_MS <= now) { past.unshift(b); return; }
      var date = C.localDate(b.startsAt, zone);
      var last = days[days.length - 1];
      if (!last || last.date !== date) days.push(last = { date: date, bookings: [] });
      last.bookings.push(b);
    });
    schedule = { days: days, past: past };
  }

  function replaceBooking(updated) {
    var swap = function (list) {
      for (var i = 0; i < list.length; i++) if (list[i].id === updated.id) list[i] = updated;
    };
    schedule.days.forEach(function (day) { swap(day.bookings); });
    swap(schedule.past);
  }

  function iconButton(className, glyph, label, onClick) {
    var button = make('button', 'cd-icon ' + className, glyph);
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', onClick);
    return button;
  }

  function bookingLine(b, now, withDate) {
    var line = make('div', 'cd-line ' + b.state);
    line.appendChild(make('span', 'cd-dot ' + b.state));
    var what = make('div', 'cd-what');
    var top = make('div', 'cd-top');
    var when = time(b.startsAt) + '–' + time(b.startsAt + b.minutes * MINUTE_MS);
    if (withDate) when = C.dateLabel(b.startsAt, zone, lang) + ', ' + when;
    top.appendChild(make('span', 't', when));
    top.appendChild(make('span', 'cd-name', b.viewerName));
    what.appendChild(top);
    var sub = make('div', 'cd-sub');
    var who = b.viewerUsername && b.viewerUsername !== b.viewerName ? '@' + b.viewerUsername + ' · ' : '';
    sub.appendChild(make('span', null, who + lengthText(b.minutes)));
    sub.appendChild(make('span', 'cd-pill ' + b.state, (T.states && T.states[b.state]) || b.state));
    if (b.outside) sub.appendChild(make('span', 'cd-pill warn', T.outside));
    what.appendChild(sub);
    if (b.note) what.appendChild(make('div', 'cd-note-text', b.note));
    if (b.messageError) what.appendChild(make('div', 'cd-warn', fill(T.messageError, { name: b.viewerName })));
    line.appendChild(what);

    var actions = make('div', 'cd-acts');
    if (b.startsAt > now && b.state === 'waiting') {
      actions.appendChild(iconButton('ok', '✓', T.accept, function () { act(b, 'accept', line); }));
      actions.appendChild(iconButton('no', '✕', T.decline, function () { act(b, 'decline', line); }));
    } else if (b.startsAt > now && b.state === 'confirmed') {
      var cancel = make('button', 'cd-sbtn', T.cancel);
      cancel.type = 'button';
      cancel.addEventListener('click', function () { act(b, 'cancel', line); });
      actions.appendChild(cancel);
    }
    if (actions.firstChild) line.appendChild(actions);
    return line;
  }

  function drawSchedule() {
    var now = Date.now();
    $('cd-zone').textContent = fill(T.zone, { zone: zone });
    var box = $('cd-days');
    clear(box);
    schedule.days.forEach(function (day) {
      box.appendChild(make('div', 'cd-group', dateText(day.date)));
      day.bookings.forEach(function (b) { box.appendChild(bookingLine(b, now, false)); });
    });
    var empty = $('cd-empty');
    empty.textContent = setUp ? T.empty : T.emptyNotSetUp;
    show(empty, !schedule.days.length);
    var past = $('cd-past');
    clear(past);
    schedule.past.forEach(function (b) { past.appendChild(bookingLine(b, now, true)); });
    show($('cd-past-box'), schedule.past.length > 0);
  }

  var DONE_TEXTS = { accept: 'accepted', decline: 'declined', cancel: 'cancelled' };

  // Accept, Decline (after asking) or Cancel (after asking); the row is redrawn from the answer, which says whether
  // Atleta could message the viewer.
  function act(b, action, line) {
    if (action === 'decline' && !window.confirm(fill(T.declineConfirm, { name: b.viewerName }))) return;
    if (action === 'cancel' && !window.confirm(fill(T.cancelConfirm, { name: b.viewerName }))) return;
    var buttons = Array.prototype.slice.call(line.querySelectorAll('button'));
    buttons.forEach(function (el) { el.disabled = true; });
    api('POST', '/dashboard/api/coaching/bookings/' + encodeURIComponent(String(b.id)) + '/' + action).then(function (answer) {
      if (!answer.ok) {
        buttons.forEach(function (el) { el.disabled = false; });
        message('cd-schedule-msg', answer.text);
        return;
      }
      var updated = answer.data.booking;
      replaceBooking(updated);
      drawSchedule();
      if (updated.messageError) message('cd-schedule-msg', fill(T.messageError, { name: updated.viewerName }), 'warn');
      else message('cd-schedule-msg', fill(T[DONE_TEXTS[action]], { name: updated.viewerName }), 'ok');
    });
  }

  // ── When I coach ──

  function weekday(i) { return C.dayLabel(addDays(MONDAY, i), lang).weekday; }

  function timeSelect(from, to, value, label) {
    var select = make('select');
    for (var m = from; m <= to; m += 30) {
      var option = make('option', null, hhmm(m));
      option.value = String(m);
      select.appendChild(option);
    }
    select.value = String(value);
    select.setAttribute('aria-label', label);
    return select;
  }

  function drawHours() {
    var box = $('cd-hours');
    clear(box);
    hours.forEach(function (day, i) {
      var name = weekday(i);
      var row = make('div', 'cd-hrow' + (day.on ? '' : ' off'));
      row.appendChild(make('span', 'cd-wd', name));
      var toggle = make('label', 'pill-toggle mini');
      var input = make('input');
      input.type = 'checkbox';
      input.setAttribute('role', 'switch');
      input.checked = day.on;
      input.setAttribute('aria-label', fill(T.dayOn, { day: name }));
      toggle.appendChild(input);
      toggle.appendChild(make('span', 'slider'));
      row.appendChild(toggle);
      var range = make('span', 'cd-rng');
      var from = timeSelect(0, 1410, day.start, fill(T.from, { day: name }));
      var to = timeSelect(30, 1440, day.end, fill(T.to, { day: name }));
      from.disabled = to.disabled = !day.on;
      range.appendChild(from);
      range.appendChild(make('span', 'cd-dash', '–'));
      range.appendChild(to);
      row.appendChild(range);
      input.addEventListener('change', function () {
        day.on = input.checked;
        row.classList.toggle('off', !day.on);
        from.disabled = to.disabled = !day.on;
      });
      // A window always ends after it starts: moving one end past the other moves the other along.
      from.addEventListener('change', function () {
        day.start = Number(from.value);
        if (day.end <= day.start) { day.end = day.start + 30; to.value = String(day.end); }
      });
      to.addEventListener('change', function () {
        day.end = Number(to.value);
        if (day.start >= day.end) { day.start = day.end - 30; from.value = String(day.start); }
      });
      box.appendChild(row);
    });
  }

  // Today in the zone the form names (a zone being typed that Intl does not know yet: the shown one).
  function formZone() {
    var typed = $('cd-zone-input').value.trim();
    return validZone(typed) ? typed : zone;
  }
  function today() { return C.localDate(Date.now(), formZone()); }

  function drawDaysOff() {
    var list = $('cd-daysoff');
    clear(list);
    var first = today();
    daysOff = daysOff.filter(function (d) { return d >= first; }).sort();
    if (!daysOff.length) list.appendChild(make('span', 'cd-chip none', T.daysOffNone));
    daysOff.forEach(function (d) {
      var label = dateText(d);
      var chip = make('span', 'cd-chip', label);
      var remove = make('button', 'cd-chip-x', '✕');
      remove.type = 'button';
      remove.setAttribute('aria-label', fill(T.removeDayOff, { day: label }));
      remove.addEventListener('click', function () {
        daysOff = daysOff.filter(function (x) { return x !== d; });
        drawDaysOff();
      });
      chip.appendChild(remove);
      list.appendChild(chip);
    });
    $('cd-dayoff-input').min = first;
    $('cd-dayoff-add').disabled = daysOff.length >= (DATA.daysOffMax || 60);
  }

  function drawStatus() {
    var status = $('cd-status');
    status.textContent = !setUp ? T.statusNotSetUp : (settings.open ? T.statusOpen : T.statusPaused);
    status.className = 'cd-status' + (setUp && settings.open ? '' : ' off');
    show($('cd-open-switch'), setUp);
    $('cd-open').checked = !!settings.open;
    $('cd-save').textContent = saving ? T.saving : (setUp ? T.save : T.saveFirst);
    show($('cd-invite-broken'), setUp && settings.inviteOk === false);
    show($('cd-link'), setUp);
    show($('cd-link-hint'), setUp);
    show($('cd-link-later'), !setUp);
  }

  function drawAll() {
    drawStatus();
    drawHours();
    drawDaysOff();
    drawSchedule();
  }

  // Bookings open: saved as it moves; a refusal puts it back.
  $('cd-open').addEventListener('change', function () {
    var input = $('cd-open');
    var wanted = input.checked;
    input.disabled = true;
    api('POST', '/dashboard/api/coaching/open', { open: wanted }).then(function (answer) {
      input.disabled = false;
      if (answer.ok) {
        settings.open = !!answer.data.open;
        message('cd-hours-msg', '');
      } else {
        message('cd-hours-msg', answer.text);
      }
      drawStatus();
    });
  });

  $('cd-dayoff-add').addEventListener('click', function () {
    var input = $('cd-dayoff-input');
    var value = input.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < today()) return;
    if (daysOff.indexOf(value) < 0) daysOff.push(value);
    input.value = '';
    drawDaysOff();
  });
  $('cd-zone-input').addEventListener('change', drawDaysOff);

  $('cd-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (saving) return;
    saving = true;
    var save = $('cd-save');
    save.disabled = true;
    drawStatus();
    var server = $('cd-server');
    api('POST', '/dashboard/api/coaching/settings', {
      timeZone: $('cd-zone-input').value.trim(),
      hours: hours,
      daysOff: daysOff,
      guildId: server ? server.value : null,
      invite: $('cd-invite').value.trim(),
      where: $('cd-where').value,
      notifyRequests: $('cd-notify').checked,
    }).then(function (answer) {
      saving = false;
      save.disabled = false;
      if (!answer.ok) {
        drawStatus();
        message('cd-hours-msg', answer.text);
        return;
      }
      var first = !setUp;
      setUp = true;
      settings = answer.data.settings;
      hours = copyHours(settings.hours);
      daysOff = (settings.daysOff || []).slice();
      $('cd-zone-input').value = settings.timeZone;
      $('cd-invite').value = settings.invite;
      $('cd-where').value = settings.where;
      if (settings.timeZone && settings.timeZone !== zone) {
        zone = settings.timeZone;
        regroup();
      }
      var outside = answer.data.outsideHours || [];
      eachBooking(function (b) { b.outside = outside.indexOf(b.id) >= 0; });
      drawAll();
      var text = settings.inviteOk === null ? T.savedUnchecked : (first ? T.savedOpened : T.saved);
      if (outside.length) message('cd-hours-msg', text + ' ' + T.outsideSaved, 'warn');
      else message('cd-hours-msg', text, 'ok');
    });
  });

  var copy = $('cd-copy');
  if (copy) {
    var copyLabel = copy.textContent;
    copy.addEventListener('click', function () {
      var input = $('cd-link-input');
      var done = function () { copy.textContent = T.copied; setTimeout(function () { copy.textContent = copyLabel; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(input.value).then(done, function () { input.select(); });
      else { input.select(); done(); }
    });
  }

  (function fillZones() {
    var list = $('cd-zones');
    var zones = [];
    try { zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []; } catch (e) { zones = []; }
    zones.forEach(function (z) {
      var option = document.createElement('option');
      option.value = z;
      list.appendChild(option);
    });
  })();

  // Before the first save the zone is this browser's.
  if (!$('cd-zone-input').value) $('cd-zone-input').value = zone;
  drawAll();
})();
